import { Request, Response } from 'express';
import { db } from '../../lib/db';
import { RowDataPacket } from 'mysql2';
import { LeaveRulesEvaluator } from '../leave-management/services/leaveRulesEvaluator';
import { v4 as uuidv4 } from 'uuid';

export const processEntitlementsForEmployee = async (employeeId: string) => {
  const [empRows] = await db.query<RowDataPacket[]>('SELECT * FROM employee_information_employees WHERE id = ? LIMIT 1', [employeeId]);
  const employee = empRows[0];
  if (!employee) throw new Error('Employee not found');
  if (employee.isActive === 0) throw new Error('Employee must be active to allocate leaves.');

  const joinDate = employee.dateJoined;
  if (!joinDate) throw new Error('Employee has no join date configured');

  const currentYear = new Date().getFullYear();
  const [lyRows] = await db.query<RowDataPacket[]>('SELECT * FROM leave_years WHERE year = ? LIMIT 1', [currentYear]);
  let leaveYear = lyRows[0];

  if (!leaveYear) {
    const newId = uuidv4();
    await db.query(`
      INSERT INTO leave_years (id, year, displayName, startDate, endDate, isActive, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
    `, [newId, currentYear, currentYear.toString(), new Date(`${currentYear}-01-01`), new Date(`${currentYear}-12-31`), 1]);
    const [newLyRows] = await db.query<RowDataPacket[]>('SELECT * FROM leave_years WHERE id = ?', [newId]);
    leaveYear = newLyRows[0];
  }

  const [leaveTypes] = await db.query<RowDataPacket[]>('SELECT * FROM leave_types WHERE isActive = 1');
  const generated = [];

  for (const lt of leaveTypes) {
    try {
      const scriptName = `${lt.name.replace(/ /g, '_')}_Sri_Lanka`;
      const [scriptRows] = await db.query<RowDataPacket[]>('SELECT content, name FROM leave_rule_scripts WHERE name = ? LIMIT 1', [scriptName]);
      let specificScript = scriptRows[0];

      if (!specificScript) {
        const [defScriptRows] = await db.query<RowDataPacket[]>('SELECT content, name FROM leave_rule_scripts WHERE isDefault = 1 LIMIT 1');
        specificScript = defScriptRows[0];
      }

      const result = await LeaveRulesEvaluator.evaluate(
        { employeeId: employee.id, leaveTypeId: lt.id, leaveYear: leaveYear.year },
        specificScript?.content
      );

      const calculatedDays = result.entitlement;
      const hasCarryForwardRule = /output\s*\.\s*carryForwardAmount\s*=/.test(specificScript?.content || '');

      const [entRows] = await db.query<RowDataPacket[]>(
        'SELECT id FROM leave_entitlements WHERE userId = ? AND leaveTypeId = ? AND leaveYearId = ? LIMIT 1',
        [employee.userId, lt.id, leaveYear.id]
      );
      const existing = entRows[0];

      if (existing) {
        if (hasCarryForwardRule) {
          await db.query('UPDATE leave_entitlements SET totalDays = ?, carryForwardDays = ?, updatedAt = NOW() WHERE id = ?', [calculatedDays, result.carryForwardAmount, existing.id]);
        } else {
          // Do not erase manually maintained carry-forward when no script sets it.
          await db.query('UPDATE leave_entitlements SET totalDays = ?, updatedAt = NOW() WHERE id = ?', [calculatedDays, existing.id]);
        }
        generated.push({ type: lt.code, days: calculatedDays });
      } else {
        await db.query(`
          INSERT INTO leave_entitlements (id, userId, leaveTypeId, leaveYearId, totalDays, usedDays, pendingDays, carryForwardDays, earnedDays, status, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, 0, 0, ?, 0, 'PROCESSED', NOW(), NOW())
        `, [uuidv4(), employee.userId, lt.id, leaveYear.id, calculatedDays, hasCarryForwardRule ? result.carryForwardAmount : 0]);
        generated.push({ type: lt.code, days: calculatedDays });
      }
    } catch (err: any) {
      console.error(`Error calculating entitlement for ${lt.code} for employee ${employeeId}:`, err.message);
    }
  }

  return generated;
};

export const generateEntitlements = async (req: Request, res: Response) => {
  try {
    const employeeId = req.params.id as string;
    const generated = await processEntitlementsForEmployee(employeeId);

    return res.json({
      success: true,
      message: 'Leave entitlements generated successfully',
      data: generated
    });
  } catch (error: any) {
    console.error('Error generating entitlements:', error);
    return res.status(error.message === 'Employee not found' ? 404 : 400).json({ success: false, message: error.message || 'Failed to generate entitlements' });
  }
};

export const getEntitlementsReport = async (req: Request, res: Response) => {
  try {
    const [users] = await db.query<RowDataPacket[]>(`SELECT u.id,u.name,u.role FROM users u JOIN employee_information_employees e ON e.userId=u.id WHERE u.role<>'CANDIDATE' AND u.isActive=1 AND e.isActive=1`);
    const [years] = await db.query<RowDataPacket[]>('SELECT id,year FROM leave_years WHERE isActive=1 ORDER BY year DESC LIMIT 1');
    const [entitlements] = await db.query<RowDataPacket[]>('SELECT * FROM leave_entitlements WHERE leaveYearId=?',[years[0]?.id||'']);
    const [leaveTypes] = await db.query<RowDataPacket[]>('SELECT id, code FROM leave_types');

    const reportData = [];

    for (const u of users) {
      const [empRows] = await db.query<RowDataPacket[]>('SELECT id, employeeNo, dateJoined FROM employee_information_employees WHERE userId = ? LIMIT 1', [u.id]);
      const emp = empRows[0];
      let joinDateObj = null;

      if (emp && emp.dateJoined) {
        joinDateObj = new Date(emp.dateJoined);
      }

      if (!joinDateObj) {
        const [invRows] = await db.query<RowDataPacket[]>('SELECT joinedDate FROM invites WHERE invitedUserId = ? LIMIT 1', [u.id]);
        if (invRows.length > 0 && invRows[0].joinedDate) {
          joinDateObj = new Date(invRows[0].joinedDate);
        }
      }

      const userEnts = entitlements.filter(ent => ent.userId === u.id);
      const balances = leaveTypes.reduce((acc: any, type) => {
        const ent = userEnts.find(ent => ent.leaveTypeId === type.id);
        let code = type.code.toUpperCase();
        if (code === 'AL001' || code === 'ANN' || code === 'ANNUAL') code = 'AL';
        if (code === 'MED' || code === 'MEDICAL') code = 'ML';
        if (code === 'CAS' || code === 'CASUAL') code = 'CL';
        acc[code] = ent ? Number(ent.totalDays||0)+Number(ent.carryForwardDays||0)-Number(ent.usedDays||0)-Number(ent.pendingDays||0) : 0;
        return acc;
      }, {});

      reportData.push({
        employeeId: emp?.employeeNo || u.id.substring(0,8),
        name: u.name || `User ${u.id.substring(0,5)}`,
        joinDate: joinDateObj ? joinDateObj.toISOString().split('T')[0] : 'N/A',
        balances,
        leaveYear:years[0]?.year||null
      });
    }

    return res.json({ success: true, data: reportData });
  } catch (error) {
    console.error('Error fetching entitlement report:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch report data' });
  }
};

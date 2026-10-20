import { Request, Response } from 'express';
import { db } from '../../lib/db';
import { RowDataPacket } from 'mysql2';
import { v4 as uuidv4 } from 'uuid';
import { organizationAccess } from '../../shared/services/organization.service';
import { monthlyAttendance } from './attendance-scope.service';
import { dashboardFor, localToday } from '../../shared/services/dashboard.service';
import { assignRoster, rosterDefault, RosterError, validRosterDate, validateRosterShifts } from './roster.service';

// ==========================================
// SHIFT MANAGEMENT
// ==========================================

const shiftCrossesMidnight = (startTime: string, endTime: string, storedValue: unknown) => {
  const start = String(startTime).slice(0, 5);
  const end = String(endTime).slice(0, 5);
  return start === end ? Boolean(storedValue) : end < start;
};

const shiftDurationHours = (startTime: string, endTime: string) => {
  const [startHour, startMinute] = String(startTime).slice(0, 5).split(':').map(Number);
  const [endHour, endMinute] = String(endTime).slice(0, 5).split(':').map(Number);
  if (![startHour, startMinute, endHour, endMinute].every(Number.isFinite)) return 0;
  const minutes = ((endHour * 60 + endMinute) - (startHour * 60 + startMinute) + 1440) % 1440;
  return Number((minutes / 60).toFixed(2));
};

const resolvedShiftHours = (value: unknown, startTime: string, endTime: string) =>
  Number(value) > 0 ? Number(value) : shiftDurationHours(startTime, endTime);

export const getShifts = async (req: Request, res: Response) => {
  try {
    const [rows] = await db.query<RowDataPacket[]>(req.query.includeArchived === 'true'
      ? 'SELECT * FROM attendance_shifts ORDER BY createdAt DESC'
      : "SELECT * FROM attendance_shifts WHERE COALESCE(status,'Active') <> 'Archived' ORDER BY createdAt DESC");
    const shifts = rows.map(r => ({
      ...r,
      weeklyWorkingDays: r.weeklyWorkingDays ? JSON.parse(r.weeklyWorkingDays) : [],
      weeklyOffDays: r.weeklyOffDays ? JSON.parse(r.weeklyOffDays) : [],
      applicableEmploymentTypes: r.applicableEmploymentTypes ? JSON.parse(r.applicableEmploymentTypes) : []
    }));
    return res.json({ success: true, data: shifts });
  } catch (error: any) {
    console.error('Error fetching shifts:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const createShift = async (req: Request, res: Response) => {
  try {
    const {
      code, name, description, shiftType, startTime, endTime, crossMidnight,
      totalHours, minWorkingHours, fullDayHours, halfDayHours,
      breakDuration, breakType, earliestIn, latestOut,
      graceLate, graceEarly, overtimeEligible, overtimeStart,
      weeklyWorkingDays, weeklyOffDays, holidayRule, applicableEmploymentTypes, status,
      allowDuplicateCode
    } = req.body;

    const shiftCode = String(code || '').trim();
    const shiftName = String(name || '').trim();
    if (!shiftCode || !shiftName || !startTime || !endTime) {
      return res.status(400).json({ success: false, message: 'Shift code, name, start time and end time are required.' });
    }
    const scheduledHours = resolvedShiftHours(totalHours, startTime, endTime);
    if (!scheduledHours) {
      return res.status(400).json({ success: false, message: 'Start and end times must define a shift longer than zero hours.' });
    }

    const id = uuidv4();
    const [existing] = await db.query<RowDataPacket[]>("SELECT id FROM attendance_shifts WHERE TRIM(code) = ? AND COALESCE(status,'Active') <> 'Archived' LIMIT 1", [shiftCode]);
    if (existing.length > 0 && allowDuplicateCode !== true) {
      return res.status(400).json({ success: false, message: 'Shift code already exists' });
    }
    if (existing.length === 0 && allowDuplicateCode === true) {
      return res.status(400).json({ success: false, message: 'The shift group does not exist.' });
    }

    await db.query(
      `INSERT INTO attendance_shifts (
        id, code, name, description, shiftType, startTime, endTime, crossMidnight,
        totalHours, minWorkingHours, fullDayHours, halfDayHours,
        breakDuration, breakType, earliestIn, latestOut,
        graceLate, graceEarly, overtimeEligible, overtimeStart,
        weeklyWorkingDays, weeklyOffDays, holidayRule, applicableEmploymentTypes, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, shiftCode, shiftName, description, shiftType, startTime, endTime, shiftCrossesMidnight(startTime, endTime, crossMidnight),
        scheduledHours, minWorkingHours, fullDayHours, halfDayHours,
        breakDuration, breakType, earliestIn, latestOut,
        graceLate, graceEarly, overtimeEligible, overtimeStart,
        JSON.stringify(weeklyWorkingDays || []), JSON.stringify(weeklyOffDays || []), holidayRule, JSON.stringify(applicableEmploymentTypes || []), status
      ]
    );

    const [created] = await db.query<RowDataPacket[]>('SELECT * FROM attendance_shifts WHERE id = ?', [id]);
    return res.status(201).json({ success: true, message: 'Shift created successfully', data: created[0] });
  } catch (error: any) {
    console.error('Error creating shift:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const updateShift = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const [existing] = await db.query<RowDataPacket[]>("SELECT id FROM attendance_shifts WHERE id=? AND COALESCE(status,'Active') <> 'Archived'", [id]);
    if (!existing.length) return res.status(404).json({ success: false, message: 'Shift not found or already deleted.' });
    const {
      name, description, shiftType, startTime, endTime, crossMidnight,
      totalHours, minWorkingHours, fullDayHours, halfDayHours,
      breakDuration, breakType, earliestIn, latestOut,
      graceLate, graceEarly, overtimeEligible, overtimeStart,
      weeklyWorkingDays, weeklyOffDays, holidayRule, applicableEmploymentTypes, status
    } = req.body;

    const scheduledHours = resolvedShiftHours(totalHours, startTime, endTime);
    if (!scheduledHours) {
      return res.status(400).json({ success: false, message: 'Start and end times must define a shift longer than zero hours.' });
    }

    await db.query(
      `UPDATE attendance_shifts SET
        name=?, description=?, shiftType=?, startTime=?, endTime=?, crossMidnight=?,
        totalHours=?, minWorkingHours=?, fullDayHours=?, halfDayHours=?,
        breakDuration=?, breakType=?, earliestIn=?, latestOut=?,
        graceLate=?, graceEarly=?, overtimeEligible=?, overtimeStart=?,
        weeklyWorkingDays=?, weeklyOffDays=?, holidayRule=?, applicableEmploymentTypes=?, status=?
       WHERE id=? AND COALESCE(status,'Active') <> 'Archived'`,
      [
        name, description, shiftType, startTime, endTime, shiftCrossesMidnight(startTime, endTime, crossMidnight),
        scheduledHours, minWorkingHours, fullDayHours, halfDayHours,
        breakDuration, breakType, earliestIn, latestOut,
        graceLate, graceEarly, overtimeEligible, overtimeStart,
        JSON.stringify(weeklyWorkingDays || []), JSON.stringify(weeklyOffDays || []), holidayRule, JSON.stringify(applicableEmploymentTypes || []), status,
        id
      ]
    );
    return res.json({ success: true, message: 'Shift updated successfully' });
  } catch (error: any) {
    console.error('Error updating shift:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// Soft deletion keeps saved roster/calendar and attendance references intact.
export const deleteShift = async (req: Request, res: Response) => {
  let connection: Awaited<ReturnType<typeof db.getConnection>> | undefined;
  try {
    if (req.query.scope != null && req.query.scope !== 'code') {
      return res.status(400).json({ success: false, message: 'Invalid shift deletion scope.' });
    }
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [rows] = await connection.query<RowDataPacket[]>('SELECT id,code,status FROM attendance_shifts WHERE id=? FOR UPDATE', [req.params.id]);
    if (!rows.length) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Shift not found.' });
    }
    if (rows[0].status === 'Archived') {
      await connection.rollback();
      return res.json({ success: true, message: 'Shift has already been deleted.' });
    }
    if (req.query.scope === 'code') {
      await connection.query("UPDATE attendance_shifts SET status='Archived',updatedAt=NOW() WHERE LOWER(TRIM(code))=LOWER(TRIM(?)) AND COALESCE(status,'Active')<>'Archived'", [rows[0].code]);
    } else {
      await connection.query("UPDATE attendance_shifts SET status='Archived',updatedAt=NOW() WHERE id=?", [rows[0].id]);
    }
    await connection.commit();
    return res.json({ success: true, message: 'Shift deleted. Existing rosters and attendance history have been preserved.' });
  } catch (error) {
    await connection?.rollback();
    console.error('Error deleting shift:', error);
    return res.status(500).json({ success: false, message: 'Could not delete shift. Please try again.' });
  } finally {
    connection?.release();
  }
};

// ==========================================
// ROSTER GROUPS MANAGEMENT
// ==========================================

export const getRosterGroups = async (req: Request, res: Response) => {
  try {
    const [rows] = await db.query<RowDataPacket[]>(`SELECT g.*,
      (SELECT COUNT(DISTINCT a.employeeId) FROM attendance_roster_assignments a
       JOIN employee_information_employees e ON e.id=a.employeeId
       WHERE (a.groupId=g.id OR a.rosterGroupId=g.id) AND a.status='Active') AS employeeCount
      FROM attendance_roster_groups g ORDER BY g.createdAt DESC`);
    for (let i = 0; i < rows.length; i++) {
      try {
        rows[i].applicableEmploymentTypes = rows[i].applicableEmploymentTypes ? JSON.parse(rows[i].applicableEmploymentTypes) : [];
      } catch {
        rows[i].applicableEmploymentTypes = rows[i].applicableEmploymentTypes ? rows[i].applicableEmploymentTypes.split(',').map((s: string) => s.trim()) : [];
      }
      const [shiftsRows] = await db.query<RowDataPacket[]>(
        `SELECT s.*, m.isDefault, m.displayOrder 
         FROM attendance_roster_group_shifts m 
         JOIN attendance_shifts s ON m.shiftId = s.id 
         WHERE m.groupId = ? OR m.rosterGroupId = ? ORDER BY m.displayOrder ASC`,
        [rows[i].id, rows[i].id]
      );
      rows[i].shifts = shiftsRows;
      const [calendarRows] = await db.query<RowDataPacket[]>(
        `SELECT DATE_FORMAT(date, '%Y-%m-%d') AS date, shiftId, isOffDay
         FROM attendance_roster_calendars WHERE rosterGroupId = ? ORDER BY date`,
        [rows[i].id]
      );
      rows[i].calendarAssignments = calendarRows;
    }
    return res.json({ success: true, data: rows });
  } catch (error: any) {
    console.error('Error fetching roster groups:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const createRosterGroup = async (req: Request, res: Response) => {
  try {
    const {
      code, name, description, departmentId, branchId, effectiveStartDate, effectiveEndDate,
      rosterCycle, applicableEmploymentTypes, minRestHours, maxConsecutiveDays, maxWeeklyHours, lockPeriod, status,
      shifts, calendarAssignments
    } = req.body;

    if (!String(name || '').trim() || !Array.isArray(shifts) || shifts.length === 0 || shifts.filter((shift: any) => shift.isDefault).length !== 1) {
      return res.status(400).json({ success: false, message: 'A roster name and one default shift are required.' });
    }

    const id = uuidv4();
    const rosterCode = String(code || '').trim() || `RST-${id.slice(0, 8).toUpperCase()}`;
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      await validateRosterShifts(connection, shifts, calendarAssignments);
      await connection.query(
        `INSERT INTO attendance_roster_groups (
          id, code, name, description, departmentId, branchId, effectiveStartDate, effectiveEndDate,
          rosterCycle, applicableEmploymentTypes, minRestHours, maxConsecutiveDays, maxWeeklyHours, lockPeriod, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, rosterCode, String(name).trim(), description || null, departmentId || null, branchId || null, effectiveStartDate || null, effectiveEndDate || null,
          rosterCycle || 'Monthly', JSON.stringify(applicableEmploymentTypes || []), minRestHours ?? 8, maxConsecutiveDays ?? 6, maxWeeklyHours ?? 48, lockPeriod ?? null, status || 'Draft'
        ]
      );
      if (shifts && Array.isArray(shifts)) {
        for (const s of shifts) {
          await connection.query(
            'INSERT INTO attendance_roster_group_shifts (id, groupId, rosterGroupId, shiftId, isDefault, displayOrder) VALUES (?, ?, ?, ?, ?, ?)',
            [uuidv4(), id, id, s.shiftId, s.isDefault || false, s.displayOrder || 0]
          );
        }
      }
      if (Array.isArray(calendarAssignments)) {
        for (const assignment of calendarAssignments) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(assignment.date) || (!assignment.clear && !assignment.isOffDay && !assignment.shiftId)) {
            throw new Error('Invalid roster calendar assignment');
          }
          if (!assignment.clear) await connection.query(
            'INSERT INTO attendance_roster_calendars (id, rosterGroupId, date, shiftId, isOffDay) VALUES (?, ?, ?, ?, ?)',
            [uuidv4(), id, assignment.date, assignment.isOffDay ? null : assignment.shiftId, assignment.isOffDay ? 1 : 0]
          );
        }
      }
      await connection.commit();
      return res.status(201).json({ success: true, message: 'Roster created successfully' });
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  } catch (error: any) {
    console.error('Error creating roster group:', error);
    return res.status(error instanceof RosterError ? error.status : 500).json({ success: false, message: error instanceof RosterError ? error.message : 'Could not create roster. Please check the details and try again.' });
  }
};

export const updateRosterGroup = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      name, description, departmentId, branchId, effectiveStartDate, effectiveEndDate,
      rosterCycle, applicableEmploymentTypes, minRestHours, maxConsecutiveDays, maxWeeklyHours, lockPeriod, status,
      shifts, calendarAssignments
    } = req.body;

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [existing] = await connection.query<RowDataPacket[]>('SELECT id FROM attendance_roster_groups WHERE id=? FOR UPDATE', [id]);
      if (!existing.length) throw new RosterError(404, 'Roster not found.');
      if (!String(name || '').trim()) throw new RosterError(400, 'Enter a roster name.');
      const [currentShifts] = await connection.query<RowDataPacket[]>('SELECT shiftId,isDefault FROM attendance_roster_group_shifts WHERE groupId=? OR rosterGroupId=?', [id,id]);
      const preservedShiftIds = currentShifts.map(s => String(s.shiftId));
      if (!shifts && calendarAssignments != null) {
        await validateRosterShifts(connection, currentShifts, calendarAssignments, preservedShiftIds);
      }
      if (shifts) {
        await validateRosterShifts(connection, shifts, calendarAssignments, preservedShiftIds);
        const [savedCalendar] = await connection.query<RowDataPacket[]>('SELECT DATE_FORMAT(date, \'%Y-%m-%d\') date, shiftId FROM attendance_roster_calendars WHERE rosterGroupId=? AND isOffDay=0', [id]);
        const changedDates = new Set((calendarAssignments || []).map((a: any) => a.date));
        if (savedCalendar.some(a => !changedDates.has(a.date) && !shifts.some((s: any) => s.shiftId === a.shiftId))) {
          throw new RosterError(400, 'Keep shifts used by saved calendar dates, or update those dates first.');
        }
      }
      await connection.query(
        `UPDATE attendance_roster_groups SET
          name=?, description=?, departmentId=?, branchId=?, effectiveStartDate=?, effectiveEndDate=?,
          rosterCycle=?, applicableEmploymentTypes=?, minRestHours=?, maxConsecutiveDays=?, maxWeeklyHours=?, lockPeriod=?, status=?
         WHERE id=?`,
        [
          name, description, departmentId || null, branchId || null, effectiveStartDate || null, effectiveEndDate || null,
          rosterCycle, JSON.stringify(applicableEmploymentTypes || []), minRestHours, maxConsecutiveDays, maxWeeklyHours ?? 48, lockPeriod ?? null, status,
          id
        ]
      );
      if (shifts) {
        await connection.query('DELETE FROM attendance_roster_group_shifts WHERE groupId = ? OR rosterGroupId = ?', [id, id]);
        for (const s of shifts) {
          await connection.query(
            'INSERT INTO attendance_roster_group_shifts (id, groupId, rosterGroupId, shiftId, isDefault, displayOrder) VALUES (?, ?, ?, ?, ?, ?)',
            [uuidv4(), id, id, s.shiftId, s.isDefault || false, s.displayOrder || 0]
          );
        }
        const defaultShift = shifts.find((s: any) => s.isDefault);
        await connection.query("UPDATE attendance_roster_assignments SET shiftId=?, groupId=?, rosterGroupId=? WHERE COALESCE(groupId,rosterGroupId)=? AND status='Active'", [defaultShift.shiftId, id, id, id]);
      }
      if (Array.isArray(calendarAssignments)) {
        for (const assignment of calendarAssignments) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(assignment.date) || (!assignment.clear && !assignment.isOffDay && !assignment.shiftId)) {
            throw new Error('Invalid roster calendar assignment');
          }
          await connection.query('DELETE FROM attendance_roster_calendars WHERE rosterGroupId = ? AND date = ?', [id, assignment.date]);
          if (!assignment.clear) await connection.query(
            'INSERT INTO attendance_roster_calendars (id, rosterGroupId, date, shiftId, isOffDay) VALUES (?, ?, ?, ?, ?)',
            [uuidv4(), id, assignment.date, assignment.isOffDay ? null : assignment.shiftId, assignment.isOffDay ? 1 : 0]
          );
        }
      }
      await connection.commit();
      return res.json({ success: true, message: 'Roster updated successfully' });
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  } catch (error: any) {
    console.error('Error updating roster group:', error);
    return res.status(error instanceof RosterError ? error.status : 500).json({ success: false, message: error instanceof RosterError ? error.message : 'Could not update roster. Your saved roster has not been changed.' });
  }
};

// ==========================================
// ROSTER ASSIGNMENTS
// ==========================================

// Remove only this roster's relationships; shared shifts and employee/attendance records stay intact.
export const deleteRosterGroup = async (req: Request, res: Response) => {
  let connection: Awaited<ReturnType<typeof db.getConnection>> | undefined;
  try {
    const { id } = req.params;
    connection = await db.getConnection();
    await connection.beginTransaction();
    // Assignment and edit flows lock this same parent, preventing new links during deletion.
    const [rosters] = await connection.query<RowDataPacket[]>(
      'SELECT id,name FROM attendance_roster_groups WHERE id=? FOR UPDATE', [id]);
    if (!rosters.length) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Roster not found or already deleted. Refresh the roster list.' });
    }
    const [assignments] = await connection.query<RowDataPacket[]>(
      'SELECT id,employeeId FROM attendance_roster_assignments WHERE groupId=? OR rosterGroupId=? FOR UPDATE', [id,id]);
    await connection.query('DELETE FROM attendance_roster_assignments WHERE groupId=? OR rosterGroupId=?', [id,id]);
    await connection.query('DELETE FROM attendance_roster_calendars WHERE rosterGroupId=?', [id]);
    await connection.query('DELETE FROM attendance_roster_group_shifts WHERE groupId=? OR rosterGroupId=?', [id,id]);
    await connection.query('DELETE FROM attendance_roster_groups WHERE id=?', [id]);
    await connection.commit();
    return res.json({ success: true,
      message: 'Roster deleted with all employee assignments, calendar dates and shift mappings. Employee records, attendance history and shared shifts have not been deleted.',
      data: { id, removedAssignments: assignments.length, affectedEmployees: new Set(assignments.map(a => a.employeeId)).size }
    });
  } catch (error) {
    await connection?.rollback();
    console.error('Error deleting roster:', error);
    return res.status(500).json({ success: false, message: 'Could not delete roster. No roster or employee assignment changes were saved. Please try again.' });
  } finally {
    connection?.release();
  }
};

export const getAssignments = async (req: Request, res: Response) => {
  try {
    const access = await organizationAccess(req.user!.userId);
    const ids = access.visibleIds.length ? access.visibleIds : [''];
    const query = `
      SELECT a.*, COALESCE(a.groupId, a.rosterGroupId) AS assignedRosterId,
             e.employeeNo,
             COALESCE(NULLIF(TRIM(CONCAT_WS(' ', pd.firstName, pd.lastName)), ''),
                      NULLIF(TRIM(CONCAT_WS(' ', e.firstName, e.lastName)), ''),
                      u.name, e.callingName, 'Employee') AS employeeName,
             g.name as groupName
      FROM attendance_roster_assignments a
      JOIN employee_information_employees e ON a.employeeId = e.id
      LEFT JOIN employee_information_personal_details pd ON pd.employeeId = e.id
      LEFT JOIN users u ON e.userId = u.id
      JOIN attendance_roster_groups g ON COALESCE(a.groupId, a.rosterGroupId) = g.id
      WHERE a.employeeId IN (?)
      ORDER BY a.createdAt DESC
    `;
    const [rows] = await db.query<RowDataPacket[]>(query, [ids]);
    return res.json({ success: true, data: rows });
  } catch (error: any) {
    console.error('Error fetching assignments:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const assignEmployees = async (req: Request, res: Response) => {
  try {
    const { employeeIds, departmentId, groupId, effectiveStartDate, effectiveEndDate } = req.body;
    const byDepartment = departmentId != null;
    const validTarget = byDepartment
      ? typeof departmentId === 'string' && Boolean(departmentId.trim()) && employeeIds == null
      : Array.isArray(employeeIds) && employeeIds.length > 0 && employeeIds.every(id => typeof id === 'string' && id)
        && new Set(employeeIds).size === employeeIds.length;
    if (!validTarget || typeof groupId !== 'string' || !groupId ||
        !validRosterDate(effectiveStartDate) ||
        (effectiveEndDate && (!validRosterDate(effectiveEndDate) || effectiveEndDate < effectiveStartDate))) {
      return res.status(400).json({ success: false, message: 'Missing required assignment fields' });
    }

    const access = await organizationAccess(req.user!.userId);
    if (!byDepartment && employeeIds.some((id: string) => !access.visibleIds.includes(id))) {
      return res.status(403).json({ success: false, message: 'You cannot assign a roster to an employee outside your scope.' });
    }
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      let targetIds: string[] = employeeIds || [];
      let departmentName: string | undefined;
      if (byDepartment) {
        // Use the same lock order as individual assignment, roster edits and deletion.
        await rosterDefault(connection, groupId);
        const [departments] = await connection.query<RowDataPacket[]>(
          "SELECT id,name FROM eim_structures WHERE id=? AND structureType='Department' AND COALESCE(isActive,1)=1 AND COALESCE(status,'Active')='Active' FOR UPDATE", [departmentId]);
        if (!departments.length) throw new RosterError(400, 'Select an active department.');
        departmentName = departments[0].name;
        // Resolve membership at save time by ID, never by a possibly duplicated department name.
        const [members] = await connection.query<RowDataPacket[]>(`SELECT e.id
          FROM employee_information_employees e
          LEFT JOIN employee_information_workstation_details w ON w.employeeId=e.id
          WHERE COALESCE(NULLIF(w.departmentId,''),e.departmentId)=?
            AND e.status='Active' AND COALESCE(e.isActive,1)=1 ORDER BY e.id FOR UPDATE`, [departmentId]);
        targetIds = [...new Set(members.map(e => String(e.id)))];
        if (!targetIds.length) throw new RosterError(400, 'No active employees are assigned to this department.');
        if (targetIds.some(id => !access.visibleIds.includes(id))) {
          throw new RosterError(403, 'You need access to every employee in this department. No roster assignments were changed.');
        }
      }
      for (const empId of [...targetIds].sort()) {
        await assignRoster(connection, empId, groupId, effectiveStartDate, effectiveEndDate || null);
      }
      await connection.commit();
      return res.status(201).json({ success: true, message: 'Roster assigned successfully',
        data: { assignedCount: targetIds.length, departmentId: byDepartment ? departmentId : null, departmentName } });
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  } catch (error: any) {
    console.error('Error assigning employees:', error);
    return res.status(error instanceof RosterError ? error.status : 500).json({ success: false, message: error instanceof RosterError ? error.message : 'Could not save roster assignment. No assignment changes were saved.' });
  }
};

// ==========================================
// ATTENDANCE RECORDS & EXCEPTIONS
// ==========================================

export const getDashboardStats = async (req: Request, res: Response) => {
  try {
    return res.json({
      success: true,
      data: (await dashboardFor(req.user!.userId)).attendance
    });
  } catch (error: any) {
    console.error('Error fetching dashboard stats:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const getRecords = async (req: Request, res: Response) => {
  try {
    const access = await organizationAccess(req.user!.userId);
    const ids = access.visibleIds.length ? access.visibleIds : [''];
    const from = String(req.query.from || '1900-01-01'); const to = String(req.query.to || '2100-12-31');
    const [rows] = await db.query<RowDataPacket[]>(`
      SELECT 
        r.*, 
        e.employeeNo, 
        COALESCE(NULLIF(TRIM(pd.fullName), ''), NULLIF(TRIM(CONCAT(COALESCE(pd.firstName, ''), ' ', COALESCE(pd.lastName, ''))), ''), u.name, 'Unknown Employee') as employeeName, 
        s.name as shiftName 
      FROM attendance_records r 
      LEFT JOIN employee_information_employees e ON r.employeeId = e.id 
      LEFT JOIN employee_information_personal_details pd ON e.id = pd.employeeId 
      LEFT JOIN users u ON e.userId = u.id
      LEFT JOIN attendance_shifts s ON r.shiftId = s.id
      WHERE r.employeeId IN (?) AND r.date BETWEEN ? AND ?
      ORDER BY r.date DESC
    `, [ids, from, to]);
    return res.json({ success: true, data: rows });
  } catch (error: any) {
    console.error('Error fetching records:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const getExceptions = async (req: Request, res: Response) => {
  try {
    const access = await organizationAccess(req.user!.userId);
    const [rows] = await db.query<RowDataPacket[]>('SELECT * FROM attendance_exceptions WHERE employeeId IN (?) ORDER BY createdAt DESC', [access.visibleIds.length?access.visibleIds:['']]);
    return res.json({ success: true, data: rows });
  } catch (error: any) {
    console.error('Error fetching exceptions:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const getCalendar = async (req: Request, res: Response) => {
  try {
    const [rows] = await db.query<RowDataPacket[]>('SELECT * FROM attendance_roster_calendars ORDER BY date DESC');
    return res.json({ success: true, data: rows });
  } catch (error: any) {
    console.error('Error fetching calendar:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// ==========================================
// EMPLOYEE SELF SERVICE
// ==========================================

export const getMyTodayAttendance = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const [empRows] = await db.query<RowDataPacket[]>('SELECT id FROM employee_information_employees WHERE userId = ? LIMIT 1', [userId]);
    if (empRows.length === 0) return res.status(404).json({ success: false, message: 'Employee profile not found' });
    const employeeId = empRows[0].id;
    const todayStr = localToday();
    const [logs] = await db.query<RowDataPacket[]>(
      'SELECT id, timestamp, logType, source FROM attendance_raw_logs WHERE employeeId = ? AND DATE(timestamp) = ? ORDER BY timestamp ASC',
      [employeeId, todayStr]
    );
    return res.json({ success: true, data: logs });
  } catch (error: any) {
    console.error('Error fetching my today attendance:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const punchAttendance = async (req: Request, res: Response) => {
  const connection = await db.getConnection();
  try {
    const userId = (req as any).user?.userId;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const { logType, source, location } = req.body;
    if (!['In', 'Out', 'BreakIn', 'BreakOut'].includes(logType)) {
      return res.status(400).json({ success: false, message: 'Invalid log type' });
    }
    await connection.beginTransaction();
    // Serialize all punches for this employee, including requests from another tab.
    const [empRows] = await connection.query<RowDataPacket[]>('SELECT id FROM employee_information_employees WHERE userId = ? AND isActive=1 AND status=\'Active\' LIMIT 1 FOR UPDATE', [userId]);
    if (empRows.length === 0) return res.status(404).json({ success: false, message: 'Employee profile not found' });
    const employeeId = empRows[0].id;
    const now = new Date();
    const todayStr = localToday();
    
    const [lastLog] = await connection.query<RowDataPacket[]>(
      'SELECT logType, timestamp FROM attendance_raw_logs WHERE employeeId = ? AND DATE(timestamp) = ? ORDER BY timestamp DESC LIMIT 1',
      [employeeId, todayStr]
    );
    if (lastLog.length > 0 && lastLog[0].logType === logType) {
      return res.status(400).json({ success: false, message: `You are already Clocked ${logType}` });
    }
    // Legacy logs have second precision; do not create ambiguous ordering.
    if (lastLog[0] && now.getTime() - new Date(lastLog[0].timestamp).getTime() < 1000) {
      return res.status(409).json({ success: false, message: 'Your previous attendance action was just recorded. Wait one second before the next action.' });
    }
    const previous = lastLog[0]?.logType;
    const valid = logType === 'In' ? !previous || previous === 'Out'
      : logType === 'Out' ? ['In', 'BreakOut', 'BreakIn'].includes(previous)
      : logType === 'BreakIn' ? ['In', 'BreakOut'].includes(previous)
      : previous === 'BreakIn';
    if (!valid) return res.status(400).json({ success: false, message: 'That attendance action does not match your current clock status. Check My Attendance first.' });
    
    const logId = uuidv4();
    await connection.query(
      'INSERT INTO attendance_raw_logs (id, employeeId, timestamp, logType, source, location, createdAt) VALUES (?, ?, ?, ?, ?, ?, NOW())',
      [logId, employeeId, now, logType, source || 'Web', location || null]
    );

    // Update attendance_records
    const [existingRecord] = await connection.query<RowDataPacket[]>('SELECT * FROM attendance_records WHERE employeeId = ? AND date = ? LIMIT 1', [employeeId, todayStr]);
    
    if (logType === 'In' || logType === 'BreakOut') {
       if (existingRecord.length === 0) {
         await connection.query('INSERT INTO attendance_records (id, employeeId, date, inTime, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, NOW(), NOW())', 
         [uuidv4(), employeeId, todayStr, now, 'Present']);
       } else if (!existingRecord[0].inTime) {
         await connection.query('UPDATE attendance_records SET inTime = ?, status = \'Present\', updatedAt = NOW() WHERE id = ?', [now, existingRecord[0].id]);
       }
    } else if (logType === 'Out' || logType === 'BreakIn') {
       if (existingRecord.length > 0 && existingRecord[0].inTime) {
         const inTs = new Date(existingRecord[0].inTime).getTime();
         const outTs = now.getTime();
         let totalHours = parseFloat(((outTs - inTs) / 3600000).toFixed(2));
         if (totalHours < 0) totalHours = 0;
         await connection.query('UPDATE attendance_records SET outTime = ?, totalHours = ?, regularHours = ?, overtimeHours = ?, updatedAt = NOW() WHERE id = ?', 
         [now, totalHours, Math.min(totalHours, 9), Math.max(0, totalHours - 9), existingRecord[0].id]);
       }
    }

    await connection.commit();
    return res.json({ success: true, message: `Successfully clocked ${logType.toLowerCase()}`, data: { id: logId, date: todayStr, logType } });
  } catch (error: any) {
    console.error('Error punching attendance:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  } finally { await connection.rollback(); connection.release(); }
};

export const getMyAttendanceHistory = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const [empRows] = await db.query<RowDataPacket[]>('SELECT id FROM employee_information_employees WHERE userId = ? LIMIT 1', [userId]);
    if (empRows.length === 0) return res.status(404).json({ success: false, message: 'Employee profile not found' });
    const employeeId = empRows[0].id;
    const [records] = await db.query<RowDataPacket[]>('SELECT * FROM attendance_records WHERE employeeId = ? ORDER BY date DESC', [employeeId]);
    return res.json({ success: true, data: records });
  } catch (error: any) {
    console.error('Error fetching attendance history:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const createManualAttendance = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const { date, inTime, outTime } = req.body;
    if (!date || !inTime || !outTime) return res.status(400).json({ success: false, message: 'date, inTime and outTime are required' });
    const [empRows] = await db.query<RowDataPacket[]>('SELECT id FROM employee_information_employees WHERE userId = ? LIMIT 1', [userId]);
    if (empRows.length === 0) return res.status(404).json({ success: false, message: 'Employee profile not found' });
    const employeeId = empRows[0].id;
    const [existing] = await db.query<RowDataPacket[]>('SELECT id FROM attendance_records WHERE employeeId = ? AND date = ? LIMIT 1', [employeeId, date]);
    if (existing.length > 0) return res.status(400).json({ success: false, message: 'Attendance already exists for this date' });
    const inDateTime = `${date} ${inTime}:00`;
    const outDateTime = `${date} ${outTime}:00`;
    const totalHours = parseFloat(((new Date(`${date}T${outTime}`).getTime() - new Date(`${date}T${inTime}`).getTime()) / 3600000).toFixed(2));
    await db.query('INSERT INTO attendance_raw_logs (id, employeeId, timestamp, logType, source, createdAt) VALUES (?, ?, ?, ?, ?, NOW())', [uuidv4(), employeeId, inDateTime, 'In', 'Manual']);
    await db.query('INSERT INTO attendance_raw_logs (id, employeeId, timestamp, logType, source, createdAt) VALUES (?, ?, ?, ?, ?, NOW())', [uuidv4(), employeeId, outDateTime, 'Out', 'Manual']);
    await db.query('INSERT INTO attendance_records (id, employeeId, date, inTime, outTime, totalHours, regularHours, overtimeHours, lateMinutes, earlyDepartureMinutes, isLate, status, isException, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())', [uuidv4(), employeeId, date, inDateTime, outDateTime, totalHours, Math.min(totalHours, 9), Math.max(0, totalHours - 9), 0, 0, 0, 'Present', 0]);
    return res.status(201).json({ success: true, message: 'Attendance marked successfully' });
  } catch (error: any) {
    console.error('Error creating manual attendance:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const updateMyAttendance = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const { idOrDate } = req.params;
    const { inTime, outTime, date } = req.body;
    const [empRows] = await db.query<RowDataPacket[]>('SELECT id FROM employee_information_employees WHERE userId = ? LIMIT 1', [userId]);
    if (empRows.length === 0) return res.status(404).json({ success: false, message: 'Employee profile not found' });
    const employeeId = empRows[0].id;
    const [records] = await db.query<RowDataPacket[]>('SELECT * FROM attendance_records WHERE employeeId = ? AND (id = ? OR date = ?) LIMIT 1', [employeeId, idOrDate, date || idOrDate]);
    if (records.length === 0) return res.status(404).json({ success: false, message: 'Attendance record not found' });
    const record = records[0];
    const dateStr = record.date instanceof Date ? record.date.toISOString().split('T')[0] : String(record.date).split('T')[0];
    const inDateTime = `${dateStr} ${inTime}:00`;
    const outDateTime = `${dateStr} ${outTime}:00`;
    const totalHours = parseFloat(((new Date(`${dateStr}T${outTime}`).getTime() - new Date(`${dateStr}T${inTime}`).getTime()) / 3600000).toFixed(2));
    await db.query('UPDATE attendance_records SET inTime = ?, outTime = ?, totalHours = ?, regularHours = ?, overtimeHours = ?, updatedAt = NOW() WHERE id = ?', [inDateTime, outDateTime, totalHours, Math.min(totalHours, 9), Math.max(0, totalHours - 9), record.id]);
    await db.query('UPDATE attendance_raw_logs SET timestamp = ? WHERE employeeId = ? AND DATE(timestamp) = ? AND logType = ?', [inDateTime, employeeId, dateStr, 'In']);
    await db.query('UPDATE attendance_raw_logs SET timestamp = ? WHERE employeeId = ? AND DATE(timestamp) = ? AND logType = ?', [outDateTime, employeeId, dateStr, 'Out']);
    return res.json({ success: true, message: 'Attendance updated successfully' });
  } catch (error: any) {
    console.error('Error updating attendance:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const getMyShift = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const [empRows] = await db.query<RowDataPacket[]>('SELECT id FROM employee_information_employees WHERE userId = ? LIMIT 1', [userId]);
    if (empRows.length === 0) return res.status(404).json({ success: false, message: 'Employee profile not found' });
    const employeeId = empRows[0].id;

    const [assignmentRows] = await db.query<RowDataPacket[]>(
      `SELECT g.id, g.name, g.description, g.rosterCycle
       FROM attendance_roster_assignments a
       JOIN attendance_roster_groups g ON COALESCE(a.groupId, a.rosterGroupId) = g.id
       WHERE a.employeeId = ? AND a.status = 'Active'
         AND a.effectiveStartDate <= CURRENT_DATE()
         AND (a.effectiveEndDate IS NULL OR a.effectiveEndDate >= CURRENT_DATE())
       ORDER BY a.effectiveStartDate DESC, a.createdAt DESC LIMIT 1`,
      [employeeId]
    );

    if (assignmentRows.length === 0) {
      return res.json({ success: true, data: null, message: 'No active shift assigned' });
    }

    const group = assignmentRows[0];
    const groupId = group.id;
    const [shiftsRows] = await db.query<RowDataPacket[]>(
      `SELECT s.*, m.isDefault, m.displayOrder 
       FROM attendance_roster_group_shifts m 
       JOIN attendance_shifts s ON m.shiftId = s.id 
       WHERE m.rosterGroupId = ? OR m.groupId = ? 
       ORDER BY m.displayOrder ASC`,
      [groupId, groupId]
    );

    const [calendarRows] = await db.query<RowDataPacket[]>(
      `SELECT DATE_FORMAT(date, '%Y-%m-%d') as date, shiftId, isOffDay, isHoliday 
       FROM attendance_roster_calendars 
       WHERE rosterGroupId = ?`,
      [groupId]
    );

    return res.json({ success: true, data: { 
      id: group.id,
      name: group.name,
      description: group.description,
      rosterCycle: group.rosterCycle,
      shifts: shiftsRows, 
      calendarAssignments: calendarRows 
    }});
  } catch (error: any) {
    console.error('Error fetching my shift:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const getTeamMonthly = async (req: Request, res: Response) => {
  try { res.json({success:true,data:await monthlyAttendance(req.user!.userId,req.query.year,req.query.month)}); }
  catch(error:any) {res.status(400).json({success:false,message:error.message});}
};

export const getOrganizationMonthly = async (req: Request, res: Response) => {
  try { res.json({success:true,data:await monthlyAttendance(req.user!.userId,req.query.year,req.query.month,true)}); }
  catch(error:any) {res.status(400).json({success:false,message:error.message});}
};



export const requestMissedAttendance = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const { date, inTime, outTime, reason, recordId } = req.body;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) ||
        new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date ||
        typeof inTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(inTime) ||
        typeof outTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(outTime)) {
      return res.status(400).json({ success: false, message: 'A valid date and both times are required' });
    }
    if (inTime === outTime) return res.status(400).json({ success: false, message: 'In and out times cannot be the same' });

    const [empRows] = await db.query<RowDataPacket[]>('SELECT id FROM employee_information_employees WHERE userId = ? LIMIT 1', [userId]);
    if (empRows.length === 0) return res.status(404).json({ success: false, message: 'Employee profile not found' });
    const employeeId = empRows[0].id;
    const [existingRecords] = await db.query<RowDataPacket[]>(
      recordId
        ? 'SELECT id FROM attendance_records WHERE id = ? AND employeeId = ? AND date = ? LIMIT 1'
        : 'SELECT id FROM attendance_records WHERE employeeId = ? AND date = ? LIMIT 1',
      recordId ? [recordId, employeeId, date] : [employeeId, date]
    );
    if (recordId && existingRecords.length === 0) return res.status(404).json({ success: false, message: 'Attendance record not found for this employee and date' });

    // Check if a pending exception already exists
    const [existingExc] = await db.query<RowDataPacket[]>('SELECT id FROM attendance_exceptions WHERE employeeId = ? AND date = ? AND exceptionType = \'MISSED_PUNCH\' AND status = \'PENDING\' LIMIT 1', [employeeId, date]);
    if (existingExc.length > 0) return res.status(400).json({ success: false, message: 'A pending request already exists for this date' });

    const requestedValue = JSON.stringify({ inTime, outTime });
    
    await db.query(
      'INSERT INTO attendance_exceptions (id, employeeId, recordId, date, exceptionType, status, reason, requestedValue, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())',
      [uuidv4(), employeeId, existingRecords[0]?.id || null, date, 'MISSED_PUNCH', 'PENDING', reason, requestedValue]
    );

    res.status(201).json({ success: true, message: 'Missed attendance request submitted successfully' });
  } catch (error: any) {
    console.error('Error requesting missed attendance:', error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const getTeamExceptions = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    const access = await organizationAccess(userId);
    if (!access.admin && !access.isExecutive && !access.isManager) return res.status(403).json({ success: false, message: 'Manager access required' });
    const empIds = access.visibleIds.filter(id => id !== access.employeeId);
    if (empIds.length === 0) return res.json({ success: true, data: [] });

    const [exceptions] = await db.query<RowDataPacket[]>(`
      SELECT e.id, e.employeeId, e.date, e.exceptionType, e.status, e.reason, e.requestedValue, e.createdAt,
             COALESCE(NULLIF(TRIM(CONCAT(COALESCE(pd.firstName,''),' ',COALESCE(pd.lastName,''))),''  ), u.name, 'Unknown') as employeeName,
             emp.employeeNo
      FROM attendance_exceptions e
      JOIN employee_information_employees emp ON e.employeeId = emp.id
      LEFT JOIN employee_information_personal_details pd ON emp.id = pd.employeeId
      LEFT JOIN users u ON emp.userId = u.id
      WHERE e.employeeId IN (?) AND e.exceptionType = 'MISSED_PUNCH'
      ORDER BY e.createdAt DESC
    `, [empIds]);

    res.json({ success: true, data: exceptions });
  } catch (error: any) {
    console.error('Error getting team exceptions:', error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

export const resolveException = async (req: Request, res: Response) => {
  const userId = (req as any).user?.userId;
  const access = userId ? await organizationAccess(userId) : null;
  if (!access || (!access.admin && !access.isExecutive && !access.isManager)) {
    return res.status(403).json({ success: false, message: 'Manager or executive access is required' });
  }
  const { id } = req.params;
  const { status, resolutionNotes } = req.body;
  if (!['APPROVED', 'REJECTED'].includes(status)) return res.status(400).json({ success: false, message: 'Invalid status' });
  if (!access.employeeId) return res.status(401).json({ success: false, message: 'No employee profile for approver' });
  const connection = await db.getConnection();
  let started = false;
  try {
    const managerId = access.employeeId;
    await connection.beginTransaction();
    started = true;
    const [excRows] = await connection.query<RowDataPacket[]>('SELECT * FROM attendance_exceptions WHERE id = ? AND status = \'PENDING\' LIMIT 1 FOR UPDATE', [id]);
    if (excRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Pending request not found' });
    }
    const exc = excRows[0];
    if (String(exc.employeeId) === String(managerId) ||
        (!access.admin && !access.isExecutive && !access.visibleIds.includes(String(exc.employeeId)))) {
      return res.status(403).json({ success: false, message: 'You can resolve requests only for employees in your reporting scope.' });
    }

    if (status === 'APPROVED') {
      const requestedValue = JSON.parse(exc.requestedValue || '{}');
      const inTime = requestedValue.inTime;
      const outTime = requestedValue.outTime;
      
      if (inTime && outTime) {
        // Build correct date strings (preventing local timezone offset issues on dates)
        const dateStr = exc.date instanceof Date ? exc.date.toISOString().split('T')[0] : String(exc.date).split('T')[0];
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(inTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(outTime)) {
          throw new Error('Invalid attendance correction times');
        }
        const startMinutes = Number(inTime.slice(0, 2)) * 60 + Number(inTime.slice(3));
        const endMinutes = Number(outTime.slice(0, 2)) * 60 + Number(outTime.slice(3));
        const crossesMidnight = endMinutes < startMinutes;
        if (startMinutes === endMinutes) throw new Error('In and out times cannot be the same');
        const outDate = new Date(`${dateStr}T12:00:00Z`);
        if (crossesMidnight) outDate.setUTCDate(outDate.getUTCDate() + 1);
        const outDateStr = outDate.toISOString().slice(0, 10);
        const inDateTime = `${dateStr} ${inTime}:00`;
        const outDateTime = `${outDateStr} ${outTime}:00`;
        const totalHours = Number((((endMinutes - startMinutes + (crossesMidnight ? 1440 : 0)) / 60)).toFixed(2));

        let recordId = uuidv4();
        // An approved correction changes the normalized record. Preserve original
        // punch logs as audit evidence instead of creating duplicate punches.
        const [existing] = await connection.query<RowDataPacket[]>(
          exc.recordId
            ? 'SELECT id FROM attendance_records WHERE id = ? AND employeeId = ? AND date = ? LIMIT 1 FOR UPDATE'
            : 'SELECT id FROM attendance_records WHERE employeeId = ? AND date = ? LIMIT 1 FOR UPDATE',
          exc.recordId ? [exc.recordId, exc.employeeId, exc.date] : [exc.employeeId, exc.date]
        );
        if (exc.recordId && existing.length === 0) throw new Error('The attendance record for this correction no longer exists');
        
        if (existing.length > 0) {
          recordId = existing[0].id;
          await connection.query('UPDATE attendance_records SET inTime = ?, outTime = ?, totalHours = ?, regularHours = ?, overtimeHours = ?, status = ?, isException = 1, updatedAt = NOW() WHERE id = ?', 
            [inDateTime, outDateTime, totalHours, Math.min(totalHours, 9), Math.max(0, totalHours - 9), 'APPROVED', existing[0].id]);
        } else {
          await connection.query('INSERT INTO attendance_raw_logs (id, employeeId, timestamp, logType, source, createdAt) VALUES (?, ?, ?, ?, ?, NOW())', [uuidv4(), exc.employeeId, inDateTime, 'In', 'Manual (Approved)']);
          await connection.query('INSERT INTO attendance_raw_logs (id, employeeId, timestamp, logType, source, createdAt) VALUES (?, ?, ?, ?, ?, NOW())', [uuidv4(), exc.employeeId, outDateTime, 'Out', 'Manual (Approved)']);
          await connection.query('INSERT INTO attendance_records (id, employeeId, date, inTime, outTime, totalHours, regularHours, overtimeHours, lateMinutes, earlyDepartureMinutes, isLate, status, isException, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())', 
            [recordId, exc.employeeId, exc.date, inDateTime, outDateTime, totalHours, Math.min(totalHours, 9), Math.max(0, totalHours - 9), 0, 0, 0, 'APPROVED', 1]);
        }
        
        await connection.query('UPDATE attendance_exceptions SET status = ?, resolvedBy = ?, resolvedAt = NOW(), resolutionNotes = ?, recordId = ?, updatedAt = NOW() WHERE id = ?',
          [status, managerId, resolutionNotes || null, recordId, id]);
      } else {
        throw new Error('Invalid requested value format');
      }
    } else {
      await connection.query('UPDATE attendance_exceptions SET status = ?, resolvedBy = ?, resolvedAt = NOW(), resolutionNotes = ?, updatedAt = NOW() WHERE id = ?',
        [status, managerId, resolutionNotes || null, id]);
    }

    await connection.commit();
    started = false;

    res.json({ success: true, message: `Request ${status.toLowerCase()} successfully` });
  } catch (error: any) {
    if (started) { await connection.rollback(); started = false; }
    console.error('Error resolving exception:', error);
    res.status(500).json({ success: false, message: 'Server Error' });
  } finally {
    if (started) await connection.rollback();
    connection.release();
  }
}

export const getMyExceptions = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    const [empRows] = await db.query<RowDataPacket[]>('SELECT id FROM employee_information_employees WHERE userId = ? LIMIT 1', [userId]);
    if (empRows.length === 0) return res.json({ success: true, data: [] });
    const employeeId = empRows[0].id;

    const [exceptions] = await db.query<RowDataPacket[]>(
      `SELECT id, date, exceptionType, status, reason, requestedValue, resolutionNotes, resolvedAt, createdAt, resolvedBy
       FROM attendance_exceptions 
       WHERE employeeId = ? AND exceptionType = 'MISSED_PUNCH'`,
      [employeeId]
    );

    res.json({ success: true, data: exceptions });
  } catch (error: any) {
    console.error('Error fetching my exceptions:', error);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

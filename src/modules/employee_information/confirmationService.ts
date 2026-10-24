import { db } from '../../lib/db';
import { RowDataPacket } from 'mysql2';
import { LeaveRulesEvaluator } from '../leave-management/services/leaveRulesEvaluator';
import { v4 as uuidv4 } from 'uuid';
import { confirmPermanentNative } from './confirmation.native';

export interface ConfirmationResult {
  success: boolean;
  employeeId: string;
  permanentEffectiveDate: Date;
  leaveGroupAssigned: string;
  entitlements: {
    leaveTypeId: string;
    leaveTypeCode: string;
    leaveTypeName: string;
    calculatedDays: number;
    alreadyGranted: number;
    alreadyUsed: number;
    netNewEntitlement: number;
  }[];
  auditLogId: string;
}

export class ProbationConfirmationService {

  static async confirmPermanent(
    employeeId: string,
    permanentEffectiveDate: Date,
    performedByUserId: string
  ): Promise<ConfirmationResult> {
    if (process.env.DATABASE_PROVIDER === 'dynamodb') return confirmPermanentNative(employeeId, permanentEffectiveDate, performedByUserId);

    const [empRows] = await db.query<RowDataPacket[]>('SELECT * FROM employee_information_employees WHERE id = ? LIMIT 1', [employeeId]);
    const employee = empRows[0];
    if (!employee) throw new Error('Employee not found');
    if (!employee.userId) throw new Error('Employee has no linked user account');

    const currentStatus = employee.probationStatus || employee.employeeStatus;
    const dateJoined = employee.dateJoined;
    if (!dateJoined) throw new Error('Employee has no date of joining. Cannot calculate leave entitlements.');

    const [lgRows] = await db.query<RowDataPacket[]>(
      'SELECT id, name FROM leave_groups WHERE (employmentType = "Permanent" OR name LIKE "%Permanent%") AND isActive = 1 LIMIT 1'
    );
    const permanentLeaveGroup = lgRows[0];
    if (!permanentLeaveGroup) throw new Error('No active Permanent Leave Group found.');

    const [lgTypes] = await db.query<RowDataPacket[]>(
      'SELECT lt.id, lt.code, lt.name FROM leave_group_types lgt JOIN leave_types lt ON lgt.leaveTypeId = lt.id WHERE lgt.leaveGroupId = ? AND lgt.isActive = 1',
      [permanentLeaveGroup.id]
    );

    // Also fetch ALL active leave types to evaluate (covers Maternity/Paternity not in group)
    const [allLeaveTypes] = await db.query<RowDataPacket[]>('SELECT id, code, name FROM leave_types WHERE isActive = 1');
    
    // Merge: use group types as base, add any active types not already covered
    const groupTypeIds = new Set(lgTypes.map((t: any) => t.id));
    const leaveTypesToEvaluate = [
      ...lgTypes,
      ...allLeaveTypes.filter((t: any) => !groupTypeIds.has(t.id))
    ];

    const effectiveDateObj = new Date(permanentEffectiveDate);
    const currentYear = new Date().getFullYear();
    const [lyRows] = await db.query<RowDataPacket[]>('SELECT * FROM leave_years WHERE isActive = 1 AND year = ? LIMIT 1', [currentYear]);
    let activeLeaveYear = lyRows[0];
    if (!activeLeaveYear) {
      const [fallbackLyRows] = await db.query<RowDataPacket[]>('SELECT * FROM leave_years WHERE isActive = 1 LIMIT 1');
      if (fallbackLyRows.length === 0) throw new Error('No active Leave Year found.');
      activeLeaveYear = fallbackLyRows[0];
    }

    const entitlementResults: ConfirmationResult['entitlements'] = [];
    const appliedScripts: any[] = [];

    const [defScriptRows] = await db.query<RowDataPacket[]>('SELECT * FROM leave_rule_scripts WHERE isDefault = 1 LIMIT 1');
    const fallbackScript = defScriptRows[0];

    // Fetch all scripts once for case-insensitive matching
    const [allScripts] = await db.query<RowDataPacket[]>('SELECT * FROM leave_rule_scripts');

    for (const lt of leaveTypesToEvaluate) {
      try {
        const scriptName = `${lt.name.replace(/ /g, '_')}_Sri_Lanka`;
        // Case-insensitive script matching
        const scriptToUse = allScripts.find((s: any) => s.name.toLowerCase() === scriptName.toLowerCase()) || fallbackScript;

        const result = await LeaveRulesEvaluator.evaluate(
          {
            employeeId: employee.id,
            leaveTypeId: lt.id,
            leaveYear: activeLeaveYear.year,
            assumeConfirmed: true
          },
          scriptToUse?.content
        );

        const calculatedDays = result.entitlement;
        appliedScripts.push({ scriptName: scriptToUse ? scriptToUse.name : `Built-in ${lt.code} Rule`, leaveType: lt.code, calculatedEntitlement: calculatedDays });

        const [entRows] = await db.query<RowDataPacket[]>(
          'SELECT totalDays, usedDays FROM leave_entitlements WHERE userId = ? AND leaveTypeId = ? AND leaveYearId = ? LIMIT 1',
          [employee.userId, lt.id, activeLeaveYear.id]
        );
        const existingEntitlement = entRows[0];

        const alreadyGranted = existingEntitlement?.totalDays || 0;
        const alreadyUsed = existingEntitlement?.usedDays || 0;
        const netNew = Math.max(0, calculatedDays - alreadyGranted);

        entitlementResults.push({
          leaveTypeId: lt.id, leaveTypeCode: lt.code, leaveTypeName: lt.name,
          calculatedDays, alreadyGranted, alreadyUsed, netNewEntitlement: netNew
        });
      } catch (err: any) {
        entitlementResults.push({
          leaveTypeId: lt.id, leaveTypeCode: lt.code, leaveTypeName: lt.name,
          calculatedDays: 0, alreadyGranted: 0, alreadyUsed: 0, netNewEntitlement: 0
        });
      }
    }

    let transitionLogId = uuidv4();
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      for (const ent of entitlementResults) {
        if (ent.calculatedDays > 0) {
          let remarks = `Auto-calculated on confirmation. Previous: ${ent.alreadyGranted}, New: ${ent.calculatedDays}`;
          if (ent.leaveTypeCode.toUpperCase() === 'CASUAL' && ent.alreadyUsed > 0) {
            remarks = `Casual Leave topped up by ${ent.netNewEntitlement} days. Previous used leave (${ent.alreadyUsed} days) correctly offset from new Permanent Entitlement of ${ent.calculatedDays} days.`;
          }

          const [extRows] = await connection.query<RowDataPacket[]>(
            'SELECT id FROM leave_entitlements WHERE userId = ? AND leaveTypeId = ? AND leaveYearId = ? LIMIT 1',
            [employee.userId, ent.leaveTypeId, activeLeaveYear.id]
          );
          if (extRows.length > 0) {
            await connection.query(
              'UPDATE leave_entitlements SET totalDays = ?, leaveGroupId = ?, status = "PROCESSED", remarks = ? WHERE id = ?',
              [ent.calculatedDays, permanentLeaveGroup.id, remarks, extRows[0].id]
            );
          } else {
            await connection.query(
              'INSERT INTO leave_entitlements (id, userId, leaveTypeId, leaveYearId, totalDays, usedDays, leaveGroupId, status, remarks, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, "PROCESSED", ?, NOW(), NOW())',
              [uuidv4(), employee.userId, ent.leaveTypeId, activeLeaveYear.id, ent.calculatedDays, ent.alreadyUsed, permanentLeaveGroup.id, remarks]
            );
          }
        }
      }

      await connection.query('UPDATE employee_information_employees SET probationStatus = "Confirmed", permanentEffectiveDate = ? WHERE id = ?', [effectiveDateObj, employee.id]);

      // Update the employmentTypeId on the main employee record to Permanent
      const [permTypeRows] = await connection.query<RowDataPacket[]>('SELECT id FROM employment_types WHERE name = "Permanent" LIMIT 1');
      if (permTypeRows.length > 0) {
        await connection.query('UPDATE employee_information_employees SET employmentTypeId = ?, updatedAt = NOW() WHERE id = ?', [permTypeRows[0].id, employee.id]);
      }

      await connection.query(
        'INSERT INTO employee_information_employment_type_transitions (id, employeeId, previousEmploymentType, newEmploymentType, effectiveDate, previousLeaveGroupId, newLeaveGroupId, appliedScripts, calculatedEntitlements, performedBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
        [transitionLogId, employee.id, currentStatus || 'Probation', 'Permanent', effectiveDateObj, null, permanentLeaveGroup.id, JSON.stringify(appliedScripts), JSON.stringify(entitlementResults.map(e => ({ leaveTypeId: e.leaveTypeId, leaveTypeCode: e.leaveTypeCode, entitled: e.calculatedDays, alreadyUsed: e.alreadyUsed, netNew: e.netNewEntitlement }))), performedByUserId]
      );

      await connection.query(
        'INSERT INTO employee_information_audit_logs (id, employeeId, userId, action, fieldChanged, previousValue, newValue, createdAt) VALUES (?, ?, ?, "CONFIRM_PERMANENT", "probationStatus", ?, "Permanent (Confirmed)", NOW())',
        [uuidv4(), employee.id, performedByUserId, currentStatus || 'Probation']
      );

      await connection.commit();
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }

    return {
      success: true,
      employeeId: employee.id,
      permanentEffectiveDate: effectiveDateObj,
      leaveGroupAssigned: permanentLeaveGroup.name,
      entitlements: entitlementResults,
      auditLogId: transitionLogId
    };
  }
}

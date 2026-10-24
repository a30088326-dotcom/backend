import { randomUUID } from 'node:crypto';
import { repository, type RepositorySession } from '../../storage/repository';
import { processEntitlementsNative } from '../leave/entitlements.native';
import type { ConfirmationResult } from './confirmationService';
import { assertEmployee, isoDay } from './native-utils';
import { touchEimReferences } from '../eim/eim.dynamo.service';

export async function confirmPermanentNative(employeeId: string, effective: Date, actorId: string, session?: RepositorySession): Promise<ConfirmationResult> {
  const run = async (tx: RepositorySession): Promise<ConfirmationResult> => {
    await touchEimReferences(tx);
    const employee = await tx.get('employee_information_employees', { id: employeeId });
    assertEmployee(employee, 'Employee not found', 404);
    assertEmployee(employee.userId, 'Employee has no linked user account');
    assertEmployee(employee.dateJoined, 'Employee has no date of joining. Cannot calculate leave entitlements.');
    const effectiveDay = isoDay(effective); assertEmployee(effectiveDay && effectiveDay >= String(employee.dateJoined).slice(0, 10), 'Permanent effective date cannot precede the joining date.');
    const groups = await tx.find('leave_groups', g => !!g.isActive && (g.employmentType === 'Permanent' || /permanent/i.test(g.name)));
    const group = groups[0]; assertEmployee(group, 'No active Permanent Leave Group found.');
    const permanent = (await tx.find('employment_types', t => String(t.name).toLowerCase() === 'permanent'))[0];
    const before = await tx.find('leave_entitlements', e => e.userId === employee.userId);
    await tx.replace('employee_information_employees', { ...employee, probationStatus: 'Confirmed', permanentEffectiveDate: effectiveDay,
      ...(permanent ? { employmentTypeId: permanent.id, employmentType: permanent.name } : {}) });
    const workstation = (await tx.find('employee_information_workstation_details', w => w.employeeId === employeeId))[0];
    if (workstation && permanent) await tx.replace('employee_information_workstation_details', { ...workstation, employmentTypeId: permanent.id });
    const generated = await processEntitlementsNative(employeeId, tx, { assumeConfirmed: true });
    const year = Number(new Date(Date.now() + 330 * 60000).toISOString().slice(0, 4));
    const leaveYear = (await tx.find('leave_years', y => Number(y.year) === year))[0]; assertEmployee(leaveYear, 'No active Leave Year found.');
    const types = await tx.find('leave_types', t => !!t.isActive), scripts = await tx.find('leave_rule_scripts', () => true);
    const entitlements: ConfirmationResult['entitlements'] = [], appliedScripts = [];
    for (const type of types) {
      const row = (await tx.find('leave_entitlements', e => e.userId === employee.userId && e.leaveTypeId === type.id && e.leaveYearId === leaveYear.id))[0];
      if (!row) continue;
      const old = before.find(e => e.leaveTypeId === type.id && e.leaveYearId === leaveYear.id);
      const total = Number(row.totalDays || 0), previous = Number(old?.totalDays || 0), used = Number(old?.usedDays || 0);
      entitlements.push({ leaveTypeId: type.id, leaveTypeCode: type.code, leaveTypeName: type.name, calculatedDays: total, alreadyGranted: previous, alreadyUsed: used, netNewEntitlement: Math.max(0, total - previous) });
      const scriptName = `${String(type.name).replace(/ /g, '_')}_Sri_Lanka`, script = scripts.find(s => String(s.name).toLowerCase() === scriptName.toLowerCase()) || scripts.find(s => !!s.isDefault);
      appliedScripts.push({ scriptName: script?.name || `Built-in ${type.code} Rule`, leaveType: type.code, calculatedEntitlement: total });
      await tx.replace('leave_entitlements', { ...row, leaveGroupId: group.id, status: 'PROCESSED', remarks: `Auto-calculated on confirmation. Previous: ${previous}, New: ${total}. Used leave retained: ${used}.` });
    }
    void generated;
    const transitionId = randomUUID();
    await tx.create('employee_information_employment_type_transitions', { id: transitionId, employeeId, previousEmploymentType: employee.probationStatus || employee.employeeStatus || 'Probation', newEmploymentType: 'Permanent', effectiveDate: effectiveDay, previousLeaveGroupId: before.find(e => e.leaveGroupId)?.leaveGroupId || null, newLeaveGroupId: group.id, appliedScripts, calculatedEntitlements: entitlements.map(e => ({ leaveTypeId: e.leaveTypeId, leaveTypeCode: e.leaveTypeCode, entitled: e.calculatedDays, alreadyUsed: e.alreadyUsed, netNew: e.netNewEntitlement })), performedBy: actorId });
    await tx.create('employee_information_audit_logs', { id: randomUUID(), employeeId, userId: actorId, action: 'CONFIRM_PERMANENT', fieldChanged: 'probationStatus', previousValue: employee.probationStatus || employee.employeeStatus || 'Probation', newValue: 'Permanent (Confirmed)' });
    return { success: true, employeeId, permanentEffectiveDate: new Date(`${effectiveDay}T00:00:00Z`), leaveGroupAssigned: group.name, entitlements, auditLogId: transitionId };
  };
  return session ? run(session) : repository().transaction(run);
}

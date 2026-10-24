import { randomUUID } from 'node:crypto';
import { repository, type RepositorySession } from '../../storage/repository';
import { validateHierarchy, type DirectoryEmployee, type Rank } from './organization.service';

const employeeName = (e: any, p?: any) => [p?.firstName, p?.lastName].filter(Boolean).join(' ').trim()
  || [e?.firstName, e?.lastName].filter(Boolean).join(' ').trim() || e?.callingName || e?.employeeNumber || '';

export async function directoryNative(session: RepositorySession = repository()): Promise<DirectoryEmployee[]> {
  const [employees, personal, structures, designations] = await Promise.all([
    session.find('employee_information_employees', () => true),
    session.find('employee_information_personal_details', () => true),
    session.find('eim_structures', () => true), session.find('designations', () => true),
  ]);
  const personalByEmployee = new Map(personal.map(p => [p.employeeId, p]));
  const byId = new Map(employees.map(e => [e.id, e]));
  return employees.map(e => ({ id: e.id, userId: e.userId || null,
    name: employeeName(e, personalByEmployee.get(e.id)), employeeNumber: e.employeeNumber ?? e.employeeNo ?? '',
    department: structures.find(d => d.id === e.departmentId)?.name ?? e.department ?? '',
    designation: designations.find(d => d.id === e.designationId)?.name ?? e.designation ?? '',
    organizationalRank: e.organizationalRank as Rank, managerId: e.reportingManagerId || null,
    managerName: employeeName(byId.get(e.reportingManagerId), personalByEmployee.get(e.reportingManagerId)),
    active: e.status === 'Active' && Number(e.isActive ?? 1) === 1,
  })) as DirectoryEmployee[];
}

/** Every hierarchy mutation touches the same record. This gives cycle validation a
 * common CAS boundary, including inserts not visible to an earlier enumeration. */
export async function changeReportingNative(session: RepositorySession,
  changes: { employeeId: string; managerId: string | null; organizationalRank?: Rank }[],
  actorId: string, effectiveDate: string, reason: string) {
  if (new Set(changes.map(c => c.employeeId)).size !== changes.length) throw new Error('Duplicate employee changes are not allowed.');
  const lock = await session.get('eim_hierarchy_settings', { id: 'organization-hierarchy-lock' });
  if (lock) await session.replace('eim_hierarchy_settings', { ...lock, revision: Number(lock.revision || 0) + 1 });
  else await session.create('eim_hierarchy_settings', { id: 'organization-hierarchy-lock', revision: 1 });
  const employees = await session.find('employee_information_employees', () => true);
  const proposed = employees.map(e => ({ id: e.id, managerId: e.reportingManagerId || null,
    organizationalRank: e.organizationalRank, active: e.status === 'Active' && Number(e.isActive ?? 1) === 1 }));
  for (const change of changes) {
    const e = proposed.find(r => r.id === change.employeeId);
    if (!e) throw new Error('Employee not found.');
    if (change.managerId && !proposed.some(r => r.id === change.managerId)) throw new Error('Reporting manager not found.');
    e.managerId = change.managerId;
    if (change.organizationalRank) e.organizationalRank = change.organizationalRank;
  }
  validateHierarchy(proposed as any);
  for (const change of changes) {
    const previous = employees.find(e => e.id === change.employeeId)!;
    const next: any = await session.replace('employee_information_employees', { ...previous,
      reportingManagerId: change.managerId, organizationalRank: change.organizationalRank || previous.organizationalRank,
      reportingEffectiveFrom: effectiveDate });
    if (previous.reportingManagerId !== change.managerId) {
      for (const relation of await session.find('reporting_relationships', r => r.employee_id === change.employeeId && r.relationship_type === 'PRIMARY' && r.status === 'Active')) {
        await session.replace('reporting_relationships', { ...relation, status: 'Previous', effective_end_date: effectiveDate, updated_by: actorId });
      }
      if (change.managerId) await session.create('reporting_relationships', { id: randomUUID(), employee_id: change.employeeId,
        manager_id: change.managerId, relationship_type: 'PRIMARY', effective_start_date: effectiveDate, reason, status: 'Active', created_by: actorId, updated_by: actorId });
      await session.create('reporting_hierarchy_audit', { id: randomUUID(), employee_id: change.employeeId,
        action: 'REASSIGN', previous_manager_id: previous.reportingManagerId || null, new_manager_id: change.managerId,
        effective_date: effectiveDate, reason, changed_by: actorId });
    }
    if (next.userId) {
      const user = await session.get('users', { id: next.userId });
      const manager = change.managerId ? await session.get('employee_information_employees', { id: change.managerId }) : undefined;
      if (user) await session.replace('users', { ...user, supervisorId: manager?.userId || null });
    }
  }
}

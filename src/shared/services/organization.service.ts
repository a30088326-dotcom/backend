import { randomUUID } from 'crypto';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { db } from '../../lib/db';

export const RANKS = ['OWNER', 'CEO', 'DIRECTOR', 'DEPARTMENT_HEAD', 'MANAGER', 'TEAM_LEAD', 'SENIOR', 'EMPLOYEE'] as const;
export type Rank = typeof RANKS[number];
export type DirectoryEmployee = { id: string; userId: string | null; name: string; employeeNumber: string; department: string; designation: string; organizationalRank: Rank; managerId: string | null; managerName: string; active: boolean };
type Connection = typeof db | PoolConnection;

export async function directory(connection: Connection = db): Promise<DirectoryEmployee[]> {
  const [rows] = await connection.query<RowDataPacket[]>(`SELECT e.id, e.userId, e.reportingManagerId AS managerId, e.organizationalRank,
    COALESCE(NULLIF(TRIM(CONCAT_WS(' ', p.firstName, p.lastName)), ''), NULLIF(TRIM(CONCAT_WS(' ', e.firstName, e.lastName)), ''), e.callingName, e.employeeNumber) AS name,
    COALESCE(e.employeeNumber, e.employeeNo, '') AS employeeNumber,
    COALESCE(d.name, e.department, '') AS department, COALESCE(j.name, e.designation, '') AS designation,
    COALESCE(NULLIF(TRIM(CONCAT_WS(' ', mp.firstName, mp.lastName)), ''), NULLIF(TRIM(CONCAT_WS(' ', m.firstName, m.lastName)), ''), m.callingName, '') AS managerName,
    (e.status = 'Active' AND COALESCE(e.isActive, 1) = 1) AS active
    FROM employee_information_employees e
    LEFT JOIN employee_information_personal_details p ON p.employeeId = e.id
    LEFT JOIN eim_structures d ON d.id = e.departmentId
    LEFT JOIN designations j ON j.id = e.designationId
    LEFT JOIN employee_information_employees m ON m.id = e.reportingManagerId
    LEFT JOIN employee_information_personal_details mp ON mp.employeeId = m.id`);
  return rows.map(r => ({ ...r, active: !!r.active })) as DirectoryEmployee[];
}

export function descendants(employees: { id: string; managerId: string | null; active: boolean }[], root: string | null): string[] {
  if (!root) return [];
  const seen = new Set([root]); const queue = [root]; const result: string[] = [];
  for (let i = 0; i < queue.length; i++) for (const e of employees) {
    if (e.active && e.managerId === queue[i] && !seen.has(e.id)) { seen.add(e.id); queue.push(e.id); result.push(e.id); }
  }
  return result;
}

export async function organizationAccess(userId: string) {
  const [rows] = await db.query<RowDataPacket[]>('SELECT role FROM users WHERE id = ? AND isActive = 1', [userId]);
  const employees = await directory(); const own = employees.find(e => e.userId === userId && e.active);
  const rank = own?.organizationalRank || null;
  const admin = ['SUPER_ADMIN', 'ADMIN'].includes(rows[0]?.role);
  const isExecutive = rank === 'OWNER' || rank === 'CEO';
  const teamIds = descendants(employees, own?.id || null);
  return { employeeId: own?.id || null, organizationalRank: rank, isOwner: rank === 'OWNER', isExecutive,
    isManager: teamIds.length > 0, admin, employees, teamIds,
    visibleIds: admin || isExecutive ? employees.filter(e => e.active).map(e => e.id) : [own?.id, ...teamIds].filter(Boolean) as string[] };
}

export async function identityFor(userId: string) {
  const a = await organizationAccess(userId);
  return { employeeId: a.employeeId, organizationalRank: a.organizationalRank, isOwner: a.isOwner, isExecutive: a.isExecutive, isManager: a.isManager };
}

export function validateHierarchy(rows: { id: string; managerId: string | null; organizationalRank: string; active: boolean }[]) {
  const active = rows.filter(e => e.active);
  const owners = active.filter(e => e.organizationalRank === 'OWNER');
  
  for (const e of active) {
    if (!RANKS.includes(e.organizationalRank as Rank)) throw new Error('Select a valid organizational rank.');
    if (owners.length > 0 && e.id === owners[0].id) { if (e.managerId) throw new Error('The Owner cannot have a reporting manager.'); continue; }
    
    // Manager selection allows any rank or active state; only cycles are rejected.
    
    const seen = new Set([e.id]); let cursor: string | null = e.managerId;
    while (cursor) {
      if (seen.has(cursor)) throw new Error('Circular reporting is not allowed.');
      seen.add(cursor); 
      const parent = rows.find(r => r.id === cursor);
      cursor = parent ? parent.managerId : null;
    }
  }
}

// Lock the organization before validating changes, so simultaneous moves cannot introduce a cycle.
export async function changeReporting(connection: PoolConnection, changes: { employeeId: string; managerId: string | null; organizationalRank?: Rank }[], actorId: string, effectiveDate: string, reason: string) {
  const [rows] = await connection.query<RowDataPacket[]>('SELECT id, reportingManagerId AS managerId, organizationalRank, status, isActive FROM employee_information_employees ORDER BY id FOR UPDATE');
  const proposed = rows.map(r => ({ ...r, active: r.status === 'Active' && r.isActive !== 0 })) as any[];
  if (new Set(changes.map(c => c.employeeId)).size !== changes.length) throw new Error('Duplicate employee changes are not allowed.');
  for (const change of changes) {
    const e = proposed.find(r => r.id === change.employeeId);
    if (!e) throw new Error('Employee not found.');
    e.managerId = change.managerId;
    if (change.organizationalRank) e.organizationalRank = change.organizationalRank;
  }
  validateHierarchy(proposed);
  for (const change of changes) {
    const previous = rows.find(r => r.id === change.employeeId)!;
    await connection.query('UPDATE employee_information_employees SET reportingManagerId = ?, organizationalRank = ?, reportingEffectiveFrom = ?, updatedAt = NOW() WHERE id = ?', [change.managerId, change.organizationalRank || previous.organizationalRank, effectiveDate, change.employeeId]);
    if (previous.managerId !== change.managerId) {
      await connection.query(`UPDATE reporting_relationships SET status = 'Previous', effective_end_date = ?, updated_by = ?, updated_at = NOW() WHERE employee_id = ? AND relationship_type = 'PRIMARY' AND status = 'Active'`, [effectiveDate, actorId, change.employeeId]);
      if (change.managerId) await connection.query(`INSERT INTO reporting_relationships (id, employee_id, manager_id, relationship_type, effective_start_date, reason, status, created_by, updated_by) VALUES (?, ?, ?, 'PRIMARY', ?, ?, 'Active', ?, ?)`, [randomUUID(), change.employeeId, change.managerId, effectiveDate, reason, actorId, actorId]);
      await connection.query(`INSERT INTO reporting_hierarchy_audit (id, employee_id, action, previous_manager_id, new_manager_id, effective_date, reason, changed_by, created_at) VALUES (?, ?, 'REASSIGN', ?, ?, ?, ?, ?, NOW())`, [randomUUID(), change.employeeId, previous.managerId, change.managerId, effectiveDate, reason, actorId]);
    }
    await connection.query(`UPDATE users u JOIN employee_information_employees e ON e.userId = u.id LEFT JOIN employee_information_employees m ON m.id = e.reportingManagerId SET u.supervisorId = m.userId WHERE e.id = ?`, [change.employeeId]);
  }
}

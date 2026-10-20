import { randomUUID } from 'crypto';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { db } from '../../lib/db';
import type { Actor, Review } from './types';
import { ensure } from './rules';
import { directory } from '../../shared/services/organization.service';
import { isOrganizationScope } from '../../shared/services/access-scope';

export type Entity = 'templates' | 'cycles' | 'library' | 'reviews';
const tables: Record<Entity, string> = { templates: 'hr_performance_templates', cycles: 'hr_performance_cycles', library: 'hr_performance_library', reviews: 'hr_performance_reviews' };
type Connection = typeof db | PoolConnection;
export const parseData = <T>(data: unknown): T => (typeof data === 'string' ? JSON.parse(data) : data) as T;
export async function list<T>(entity: Entity, connection: Connection = db): Promise<T[]> {
  const [rows] = await connection.query<RowDataPacket[]>(`SELECT data FROM ${tables[entity]}`);
  return rows.map(row => parseData<T>(row.data));
}
export async function get<T>(entity: Entity, id: string, connection: Connection = db, lock = false): Promise<T> {
  const [rows] = await connection.query<RowDataPacket[]>(`SELECT data FROM ${tables[entity]} WHERE id = ?${lock ? ' FOR UPDATE' : ''}`, [id]);
  ensure(rows[0], 'Record not found.', 404);
  return parseData<T>(rows[0].data);
}
export async function save(entity: Entity, value: { id: string }, connection: Connection = db, create = false) {
  if (create && entity === 'reviews') {
    const r = value as Review;
    await connection.query(`INSERT INTO ${tables[entity]} (id, cycle_id, employee_id, data) VALUES (?, ?, ?, ?)`, [r.id, r.cycleId, r.employeeId, JSON.stringify(r)]);
  } else if (create) {
    await connection.query(`INSERT INTO ${tables[entity]} (id, data) VALUES (?, ?)`, [value.id, JSON.stringify(value)]);
  } else {
    await connection.query(`UPDATE ${tables[entity]} SET data = ? WHERE id = ?`, [JSON.stringify(value), value.id]);
  }
}
export async function transaction<T>(fn: (connection: PoolConnection) => Promise<T>): Promise<T> {
  const connection = await db.getConnection();
  try { await connection.beginTransaction(); const result = await fn(connection); await connection.commit(); return result; }
  catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}
export async function audit(id: string, actor: Actor, event: string, connection: Connection) {
  await connection.query('INSERT INTO hr_performance_audit (id, entity_id, actor_id, event) VALUES (?, ?, ?, ?)', [randomUUID(), id, actor.userId, event]);
}
export async function notify(employeeId: string, reviewId: string, message: string, actor: Actor, connection: Connection) {
  const userId = actor.employees.find(e => e.id === employeeId)?.userId;
  if (userId) await connection.query('INSERT INTO hr_performance_notifications (id, user_id, review_id, message) VALUES (?, ?, ?, ?)', [randomUUID(), userId, reviewId, message]);
}
export async function actorFor(userId: string): Promise<Actor> {
  const [users] = await db.query<RowDataPacket[]>('SELECT role, isActive FROM users WHERE id = ?', [userId]);
  ensure(users[0]?.isActive && users[0].role !== 'CANDIDATE', 'Performance access is available to active staff only.', 403);
  const employees = await directory();
  const own = employees.find(e => e.userId === userId && e.active);
  // An unassigned employee is NOT automatically the CEO.
  const executive = !!own && ['OWNER', 'CEO'].includes(own.organizationalRank);
  const [[permission]]=await db.query<RowDataPacket[]>('SELECT * FROM user_module_permissions WHERE userId=? AND moduleId=\'performance_management\'',[userId]);
  if (users[0].role !== 'SUPER_ADMIN' && permission) ensure(permission.moduleAccess && permission.canView,'Performance module access is not enabled.',403);
  const delegated = permission && isOrganizationScope(permission.dataScope) && ['moduleAccess','canView','canCreate','canEdit','canDelete','canApprove','canExport'].every(key=>!!permission[key]);
  return { userId, employeeId: own?.id || null, admin: ['SUPER_ADMIN', 'ADMIN'].includes(users[0].role) || delegated, executive, employees };
}

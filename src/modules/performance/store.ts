import { randomUUID } from 'crypto';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { db } from '../../lib/db';
import type { Actor, Review } from './types';
import { ensure } from './rules';
import { directory } from '../../shared/services/organization.service';
import { isOrganizationScope } from '../../shared/services/access-scope';
import * as native from './store.dynamo';
import { repository, type RepositorySession } from '../../storage/repository';
import type { EntityName } from '../../storage/table-definitions';
const useDynamo = () => process.env.DATABASE_PROVIDER === 'dynamodb';

export type Entity = 'templates' | 'cycles' | 'library' | 'reviews';
const tables: Record<Entity, string> = { templates: 'hr_performance_templates', cycles: 'hr_performance_cycles', library: 'hr_performance_library', reviews: 'hr_performance_reviews' };
type Connection = typeof db | PoolConnection | RepositorySession;
export const parseData = <T>(data: unknown): T => (typeof data === 'string' ? JSON.parse(data) : data) as T;
export async function list<T>(entity: Entity, connection: Connection = db): Promise<T[]> {
  if (useDynamo()) return native.list<T>(entity, connection === db ? undefined : connection as RepositorySession);
  const [rows] = await (connection as typeof db).query<RowDataPacket[]>(`SELECT data FROM ${tables[entity]}`);
  return rows.map(row => parseData<T>(row.data));
}
export async function get<T>(entity: Entity, id: string, connection: Connection = db, lock = false): Promise<T> {
  if (useDynamo()) return native.get<T>(entity, id, connection === db ? undefined : connection as RepositorySession, lock);
  const [rows] = await (connection as typeof db).query<RowDataPacket[]>(`SELECT data FROM ${tables[entity]} WHERE id = ?${lock ? ' FOR UPDATE' : ''}`, [id]);
  ensure(rows[0], 'Record not found.', 404);
  return parseData<T>(rows[0].data);
}
export async function save(entity: Entity, value: { id: string }, connection: Connection = db, create = false) {
  if (useDynamo()) return native.save(entity, value, connection === db ? undefined : connection as RepositorySession, create);
  const sql = connection as typeof db;
  if (create && entity === 'reviews') {
    const r = value as Review;
    await sql.query(`INSERT INTO ${tables[entity]} (id, cycle_id, employee_id, data) VALUES (?, ?, ?, ?)`, [r.id, r.cycleId, r.employeeId, JSON.stringify(r)]);
  } else if (create) {
    await sql.query(`INSERT INTO ${tables[entity]} (id, data) VALUES (?, ?)`, [value.id, JSON.stringify(value)]);
  } else {
    await sql.query(`UPDATE ${tables[entity]} SET data = ? WHERE id = ?`, [JSON.stringify(value), value.id]);
  }
}
export async function transaction<T>(fn: (connection: Connection) => Promise<T>): Promise<T> {
  if (useDynamo()) return native.transaction(fn);
  const connection = await db.getConnection();
  try { await connection.beginTransaction(); const result = await fn(connection); await connection.commit(); return result; }
  catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}
export async function audit(id: string, actor: Actor, event: string, connection: Connection) {
  if (useDynamo()) return native.audit(id, actor, event, connection as RepositorySession);
  await (connection as typeof db).query('INSERT INTO hr_performance_audit (id, entity_id, actor_id, event) VALUES (?, ?, ?, ?)', [randomUUID(), id, actor.userId, event]);
}
export async function notify(employeeId: string, reviewId: string, message: string, actor: Actor, connection: Connection) {
  if (useDynamo()) return native.notify(employeeId, reviewId, message, actor, connection as RepositorySession);
  const userId = actor.employees.find(e => e.id === employeeId)?.userId;
  if (userId) await (connection as typeof db).query('INSERT INTO hr_performance_notifications (id, user_id, review_id, message) VALUES (?, ?, ?, ?)', [randomUUID(), userId, reviewId, message]);
}
export async function actorFor(userId: string): Promise<Actor> {
  if (useDynamo()) return native.actorFor(userId);
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

export async function removeEntity(entity: Entity, id: string, connection: Connection) {
  if (useDynamo()) {
    const tx = connection as RepositorySession;
    const row = await tx.get(tables[entity] as EntityName, { id });
    ensure(row, 'Record not found.', 404);
    if (entity === 'cycles') ensure(!row._launch, 'This cycle is launching. Choose Launch again to resume before deleting it.', 409);
    await tx.remove(tables[entity] as EntityName, { id }, row._version);
  } else await (connection as typeof db).query(`DELETE FROM ${tables[entity]} WHERE id = ?`, [id]);
}
export async function removeCycleRecords(id: string, connection: Connection) {
  if (useDynamo()) {
    const tx = connection as RepositorySession;
    const reviews = await tx.find('hr_performance_reviews', row => row.cycle_id === id);
    const ids = new Set(reviews.map(row => row.id));
    for (const row of await tx.find('hr_performance_notifications', row => ids.has(row.review_id))) await tx.remove('hr_performance_notifications', { id: row.id }, row._version);
    for (const row of await tx.find('hr_performance_audit', row => row.entity_id === id || ids.has(row.entity_id))) await tx.remove('hr_performance_audit', { id: row.id }, row._version);
    for (const row of reviews) await tx.remove('hr_performance_reviews', { id: row.id }, row._version);
    await removeEntity('cycles', id, tx);
  } else {
    const sql = connection as typeof db;
    await sql.query('DELETE n FROM hr_performance_notifications n INNER JOIN hr_performance_reviews r ON n.review_id = r.id WHERE r.cycle_id = ?', [id]);
    await sql.query('DELETE a FROM hr_performance_audit a INNER JOIN hr_performance_reviews r ON a.entity_id = r.id WHERE r.cycle_id = ?', [id]);
    await sql.query('DELETE FROM hr_performance_reviews WHERE cycle_id = ?', [id]);
    await sql.query('DELETE FROM hr_performance_audit WHERE entity_id = ?', [id]);
    await sql.query('DELETE FROM hr_performance_cycles WHERE id = ?', [id]);
  }
}
export async function history(id: string, connection?: Connection, recentOnly = false): Promise<any[]> {
  if (useDynamo()) return (await ((connection as RepositorySession) || repository()).find('hr_performance_audit', row => row.entity_id === id && (!recentOnly || row.event === 'REMIND' && new Date(row.at).getTime() > Date.now() - 86400000))).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const [rows] = await ((connection as typeof db) || db).query<RowDataPacket[]>(`SELECT id,event,at FROM hr_performance_audit WHERE entity_id = ?${recentOnly ? " AND event='REMIND' AND at > DATE_SUB(NOW(), INTERVAL 1 DAY)" : ''} ORDER BY at DESC,id`, [id]);
  return rows;
}
export async function notifications(userId: string): Promise<any[]> {
  if (useDynamo()) return (await native.visibleLaunchRecords(await repository().find('hr_performance_notifications', row => row.user_id === userId))).sort((a,b) => String(b.at).localeCompare(String(a.at))).slice(0,50).map(row => ({ id: row.id, reviewId: row.review_id, message: row.message, readAt: row.read_at, at: row.at }));
  const [rows] = await db.query<RowDataPacket[]>('SELECT id,review_id AS reviewId,message,read_at AS readAt,at FROM hr_performance_notifications WHERE user_id=? ORDER BY at DESC LIMIT 50', [userId]);
  return rows;
}
export async function readNotification(id: string, userId: string) {
  if (useDynamo()) return repository().transaction(async tx => { const row = await tx.get('hr_performance_notifications', { id }); if (row?.user_id === userId) await tx.replace('hr_performance_notifications', { ...row, read_at: new Date().toISOString() }); });
  await db.query('UPDATE hr_performance_notifications SET read_at=NOW(3) WHERE id=? AND user_id=?', [id, userId]);
}

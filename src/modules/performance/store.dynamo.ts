import { randomUUID } from 'crypto';
import { repository, type RepositorySession } from '../../storage/repository';
import type { EntityName } from '../../storage/table-definitions';
import type { Actor, Review } from './types';
import { ensure } from './rules';
import { directory } from '../../shared/services/organization.service';
import { isOrganizationScope } from '../../shared/services/access-scope';

export type Entity = 'templates' | 'cycles' | 'library' | 'reviews';
const tables: Record<Entity, EntityName> = { templates: 'hr_performance_templates', cycles: 'hr_performance_cycles', library: 'hr_performance_library', reviews: 'hr_performance_reviews' };
export const parseData = <T>(data: unknown): T => (typeof data === 'string' ? JSON.parse(data) : data) as T;
export async function launchRecordVisible(row: any, connection: RepositorySession = repository()) {
  if (!row._launchToken) return true;
  const cycle = await connection.get('hr_performance_cycles', { id: row._launchCycleId || row.cycle_id });
  return !!cycle && cycle._publishedLaunchToken === row._launchToken && parseData<CycleState>(cycle.data).status !== 'DRAFT';
}
type CycleState = { status: string };
export async function visibleLaunchRecords<T extends Record<string, any>>(rows: T[], connection: RepositorySession = repository()): Promise<T[]> {
  const result: T[] = [];
  const visibility = new Map<string, boolean>();
  for (const row of rows) {
    if (!row._launchToken) { result.push(row); continue; }
    const key = `${row._launchCycleId || row.cycle_id}:${row._launchToken}`;
    if (!visibility.has(key)) visibility.set(key, await launchRecordVisible(row, connection));
    if (visibility.get(key)) result.push(row);
  }
  return result;
}
export async function list<T>(entity: Entity, connection: RepositorySession = repository()): Promise<T[]> {
  const rows = await connection.find(tables[entity], () => true);
  return (entity === 'reviews' ? await visibleLaunchRecords(rows, connection) : rows).map(row => parseData<T>(row.data));
}
export async function get<T>(entity: Entity, id: string, connection: RepositorySession = repository(), _lock = false): Promise<T> {
  const row = await connection.get(tables[entity], { id });
  ensure(row, 'Record not found.', 404);
  if (entity === 'reviews') ensure(await launchRecordVisible(row, connection), 'Record not found.', 404);
  return parseData<T>(row.data);
}
export async function save(entity: Entity, value: { id: string }, connection: RepositorySession = repository(), create = false) {
  const review = value as Review;
  if (create) {
    if (entity === 'reviews') ensure(!(await connection.find(tables.reviews, row => row.cycle_id === review.cycleId && row.employee_id === review.employeeId)).length, 'This employee already has a review in this cycle.', 409);
    await connection.create(tables[entity], { id: value.id, data: value, ...(entity === 'reviews' ? { cycle_id: review.cycleId, employee_id: review.employeeId } : { created_at: new Date().toISOString() }) });
  } else {
    const previous = await connection.get(tables[entity], { id: value.id });
    ensure(previous, 'Record not found.', 404);
    if (entity === 'cycles') ensure(!previous._launch, 'This cycle is launching. Choose Launch again to resume before editing it.', 409);
    await connection.replace(tables[entity], { ...previous, data: value });
  }
}
export async function transaction<T>(fn: (connection: RepositorySession) => Promise<T>): Promise<T> {
  return repository().transaction(fn);
}
export async function audit(id: string, actor: Actor, event: string, connection: RepositorySession) {
  await connection.create('hr_performance_audit', { id: randomUUID(), entity_id: id, actor_id: actor.userId, event, at: new Date().toISOString() });
}
export async function notify(employeeId: string, reviewId: string, message: string, actor: Actor, connection: RepositorySession) {
  const userId = actor.employees.find(e => e.id === employeeId)?.userId;
  if (userId) await connection.create('hr_performance_notifications', { id: randomUUID(), user_id: userId, review_id: reviewId, message, read_at: null, at: new Date().toISOString() });
}
export async function actorFor(userId: string): Promise<Actor> {
  const user = await repository().get('users', { id: userId });
  ensure(user?.isActive && user.role !== 'CANDIDATE', 'Performance access is available to active staff only.', 403);
  const employees = await directory();
  const own = employees.find(e => e.userId === userId && e.active);
  const executive = !!own && ['OWNER', 'CEO'].includes(own.organizationalRank);
  const permission = (await repository().find('user_module_permissions', row => row.userId === userId && row.moduleId === 'performance_management'))[0];
  if (user.role !== 'SUPER_ADMIN' && permission) ensure(permission.moduleAccess && permission.canView, 'Performance module access is not enabled.', 403);
  const delegated = permission && isOrganizationScope(permission.dataScope) && ['moduleAccess','canView','canCreate','canEdit','canDelete','canApprove','canExport'].every(key => !!permission[key]);
  return { userId, employeeId: own?.id || null, admin: ['SUPER_ADMIN', 'ADMIN'].includes(user.role) || !!delegated, executive, employees };
}

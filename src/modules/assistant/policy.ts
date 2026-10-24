import { db } from '../../lib/db';
import type { RowDataPacket } from 'mysql2/promise';
import { organizationAccess } from '../../shared/services/organization.service';
import type { Context, Tool, Settings, Permission } from './types';
import { ensure } from './types';
import { closest } from './matching';
import { isOrganizationScope } from '../../shared/services/access-scope';
import { repository } from '../../storage/repository';

export async function contextFor(userId: string, authorization = ''): Promise<Context> {
  const native = process.env.DATABASE_PROVIDER === 'dynamodb';
  const user = native ? await repository().get('users', { id:userId }) : (await db.query<RowDataPacket[]>('SELECT id, name, role, isActive, mustChangePassword FROM users WHERE id=?', [userId]))[0][0];
  ensure(user?.isActive && ['SUPER_ADMIN', 'ADMIN', 'EMPLOYEE'].includes(user.role), 'Active staff access is required.', 403);
  ensure(!user.mustChangePassword, 'Complete your initial password change before using the assistant.', 403);
  const a = await organizationAccess(userId);
  const permissions = native ? await repository().find('user_module_permissions', row => row.userId === userId) : (await db.query<RowDataPacket[]>('SELECT moduleId,moduleAccess,canView,canCreate,canEdit,canDelete,canApprove,canExport,dataScope FROM user_module_permissions WHERE userId=?', [userId]))[0];
  return { userId, name: user.name, role: user.role, employeeId: a.employeeId, admin: a.admin, superAdmin: user.role === 'SUPER_ADMIN', executive: a.isExecutive, manager: a.isManager, employees: a.employees, visibleIds: a.visibleIds, permissions, authorization };
}
export function moduleAllowed(c: Context, module: string, permission: Permission) {
  if (c.superAdmin) return true;
  if (module === 'assistant') return true;
  
  const p = c.permissions.find(p => p.moduleId === module);
  if (p) return !!p.moduleAccess && !!p[permission];
  if (c.executive) return true;

  if (module === 'self_service') return !!c.employeeId || c.admin;
  if (module === 'reporting_hierarchy') return !!c.employeeId || c.admin;
  
  if (c.admin) return !c.permissions.length;
  
  if (['leave_approval', 'leave_management', 'reports_analytics'].includes(module)) {
    return c.manager && permission === 'canView';
  }
  
  return false;
}
export function hasFullModuleAccess(c: Context, module: string) {
  if (c.superAdmin || c.executive) return true;
  const p=c.permissions.find(p=>p.moduleId===module);
  return !!p && isOrganizationScope(p.dataScope) && ['moduleAccess','canView','canCreate','canEdit','canDelete','canApprove','canExport'].every(key=>!!p[key]);
}
export function allowed(c: Context, t: Tool, settings?: Settings) {
  if (c.superAdmin || c.executive && !c.permissions.some(p=>p.moduleId===t.module)) {
    if (settings?.disabledTools.includes(t.id)) return false;
    if (settings && !settings.enabled && !c.superAdmin) return false;
    return true;
  }
  const p = c.permissions.find(p => p.moduleId === t.module);
  if (p && !isOrganizationScope(p.dataScope) && (t.scope === 'admin' || t.id === 'dashboard.summary')) return false;
  if (settings?.disabledTools.includes(t.id)) return false;
  if (settings && !settings.enabled) return false;
  if (t.scope === 'super') return false;
  const delegated = hasFullModuleAccess(c,t.module) && (t.module==='performance_management' || ['employee.updateDetails','attendance.createShift','attendance.assignRoster','eim.createCollection','eim.viewCollection','eim.addCollectionRecord'].includes(t.id));
  if (t.scope === 'admin' && !c.admin && !delegated) return false;
  if (t.scope === 'own' && !c.employeeId) return false;
  // Match canonical performance access: active staff can work on their assigned
  // review without HR maintenance privileges. Explicit module disable still wins;
  // each performance service checks review ownership and manager scope again.
  if (c.employeeId && ['performance.summary','performance.review','performance.invitations','performance.cycles','performance.assessment','performance.action','performance.checkin'].includes(t.id)) {
    return !p || !!p.moduleAccess && !!p.canView;
  }
  // These are employee workflows, not HR record-maintenance privileges. The
  // same authenticated self-service page already permits them without CRUD flags.
  if (t.scope === 'own' && ['leave.apply', 'leave.cancel', 'attendance.correction', 'attendance.punch'].includes(t.id)) {
    return moduleAllowed(c, 'self_service', 'canView');
  }
  // A staff member with no reports should receive an empty team, not a role error.
  if (c.employeeId && !c.manager && !c.executive && !c.admin && ['leave.team', 'leave.pending', 'attendance.team'].includes(t.id)) {
    return (!p || !!p.moduleAccess && !!p.canView) && moduleAllowed(c, 'self_service', 'canView');
  }
  if (t.scope === 'team' && !c.manager && !c.executive && !c.admin) return false;
  // Assigned approvers have a workflow capability even without an admin module grant.
  if (t.module === 'leave_approval' && t.permission === 'canApprove' && (c.manager || c.executive)) {
    const p = c.permissions.find(p => p.moduleId === t.module);
    return p ? !!p.moduleAccess && !!p.canApprove : true;
  }
  return moduleAllowed(c, t.module, t.permission);
}
export function authorize(c: Context, t: Tool, settings?: Settings) {
  ensure(allowed(c, t, settings), `${t.label} is not enabled for this account. Ask your Peoples Management administrator to enable the ${t.module.replace(/_/g, ' ')} action; your own leave and attendance tasks are available through Self Service.`, 403);
}
export function scopedContext(c: Context, module: string): Context {
  const p = c.permissions.find(p => p.moduleId === module);
  if (c.superAdmin || !p) return c;
  if (p.moduleAccess && isOrganizationScope(p.dataScope)) return { ...c, visibleIds:c.employees.filter(e=>e.active).map(e=>e.id) };
  if (p.moduleAccess && p.dataScope==='DEPARTMENT') {
    const own=c.employees.find(e=>e.id===c.employeeId);
    return {...c,visibleIds:c.employees.filter(e=>e.active&&(e.id===c.employeeId||!!own?.department&&e.department===own.department)).map(e=>e.id)};
  }
  const ids = new Set<string>(c.employeeId ? [c.employeeId] : []);
  if (p.dataScope === 'DIRECT_REPORTS' && c.employeeId) {
    for (const e of c.employees) if (e.managerId === c.employeeId) ids.add(e.id);
  }
  if (p.dataScope === 'TEAM') {
    let changed = true;
    while (changed) { changed = false; for (const e of c.employees) if (e.managerId && ids.has(e.managerId) && !ids.has(e.id)) { ids.add(e.id); changed = true; } }
  }
  return { ...c, visibleIds: c.visibleIds.filter(id => ids.has(id)) };
}
export function employeeFor(c: Context, text: string, ownOnly = false) {
  const term = text.trim().toLowerCase();
  const candidates = c.employees.filter(e => e.active && (ownOnly ? e.id === c.employeeId : c.visibleIds.includes(e.id)));
  if (['me', 'myself', 'my', 'own'].includes(term)) {
    const own = candidates.find(e => e.id === c.employeeId); ensure(own, 'Your account has no active employee profile.'); return own;
  }
  const exact = candidates.filter(e => [e.id, e.employeeNumber, e.name].some(v => v.toLowerCase() === term));
  const partial = candidates.filter(e => e.name.toLowerCase().includes(term));
  const found = exact.length ? exact : partial.length ? partial : closest(candidates, text, e => [e.name, e.employeeNumber]);
  ensure(found.length, 'No matching employee is available in your permitted scope.');
  ensure(found.length === 1, `More than one employee matches. Use an employee number: ${found.map(e => `${e.name} (${e.employeeNumber})`).join(', ')}.`);
  return found[0];
}
export function assertEnglish(message: string) {
  ensure(!/[\p{Script=Sinhala}\p{Script=Tamil}\p{Script=Devanagari}\p{Script=Han}\p{Script=Arabic}\p{Script=Cyrillic}]/u.test(message), 'Please write your request in English. This assistant supports English only.');
  ensure(!/\b(?:mata|mama|oya|oyata|karanna|hadanna|kiyanna|penanna|puluwanda|tiyenawa|wenna|denna|kohomada)\b/i.test(message), 'Please write your request in English. Employee names may be included.');
}

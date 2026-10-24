import type { Request, Response, NextFunction } from 'express';
import type { RowDataPacket } from 'mysql2/promise';
import { db } from '../lib/db';
import { isOrganizationScope } from '../shared/services/access-scope';
import { repository } from '../storage/repository';
const useDynamo = () => process.env.DATABASE_PROVIDER === 'dynamodb';
const permission = async (userId: string, moduleId: string) => useDynamo()
  ? (await repository().find('user_module_permissions', p => p.userId === userId && p.moduleId === moduleId))[0]
  : (await db.query<RowDataPacket[]>('SELECT * FROM user_module_permissions WHERE userId=? AND moduleId=?', [userId, moduleId]))[0][0];

type Action = 'canView' | 'canCreate' | 'canEdit' | 'canDelete' | 'canApprove';
async function executiveReader(userId:string) {
  if (useDynamo()) return (await repository().find('employee_information_employees', e => e.userId === userId && e.status === 'Active' && Number(e.isActive ?? 1) === 1 && ['OWNER', 'CEO'].includes(e.organizationalRank))).length > 0;
  const [[row]]=await db.query<RowDataPacket[]>('SELECT id FROM employee_information_employees WHERE userId=? AND status=\'Active\' AND COALESCE(isActive,1)=1 AND organizationalRank IN (\'OWNER\',\'CEO\') LIMIT 1',[userId]);
  return !!row;
}
export function requireModuleAction(module: string, action: Action, organizationOnly = false) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) return void res.status(401).json({ success:false,message:'Authentication required' });
      if (req.user.role === 'SUPER_ADMIN') return next();
      const p = await permission(req.user.userId, module);
      if (p ? p.moduleAccess && p[action] && (!organizationOnly || isOrganizationScope(p.dataScope)) : req.user.role === 'ADMIN') return next();
      if (!p && action==='canView' && await executiveReader(req.user.userId)) return next();
      res.status(403).json({success:false,message:`Enable ${module} ${action.replace('can','')} access for this account first.`});
    } catch { res.status(500).json({success:false,message:'Unable to verify module access.'}); }
  };
}
export async function organizationModuleScope(user: {userId:string;role:string}, module: string) {
  if (user.role === 'SUPER_ADMIN') return true;
  const p = await permission(user.userId, module);
  return p ? !!p.moduleAccess && isOrganizationScope(p.dataScope) : user.role === 'ADMIN' || await executiveReader(user.userId);
}
export async function canManageCandidate(user: {userId:string;role:string}, candidateId: string, module = 'onboarding') {
  if (await organizationModuleScope(user,module)) return true;
  if (useDynamo()) return (await repository().find('invites', i => i.invitedUserId === candidateId && i.invitedById === user.userId)).length > 0;
  const [[invite]] = await db.query<RowDataPacket[]>('SELECT id FROM invites WHERE invitedUserId=? AND invitedById=? LIMIT 1',[candidateId,user.userId]);
  return !!invite;
}

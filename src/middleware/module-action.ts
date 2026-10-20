import type { Request, Response, NextFunction } from 'express';
import type { RowDataPacket } from 'mysql2/promise';
import { db } from '../lib/db';
import { isOrganizationScope } from '../shared/services/access-scope';

type Action = 'canView' | 'canCreate' | 'canEdit' | 'canDelete' | 'canApprove';
async function executiveReader(userId:string) {
  const [[row]]=await db.query<RowDataPacket[]>('SELECT id FROM employee_information_employees WHERE userId=? AND status=\'Active\' AND COALESCE(isActive,1)=1 AND organizationalRank IN (\'OWNER\',\'CEO\') LIMIT 1',[userId]);
  return !!row;
}
export function requireModuleAction(module: string, action: Action, organizationOnly = false) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) return void res.status(401).json({ success:false,message:'Authentication required' });
      if (req.user.role === 'SUPER_ADMIN') return next();
      const [[p]] = await db.query<RowDataPacket[]>('SELECT * FROM user_module_permissions WHERE userId=? AND moduleId=?',[req.user.userId,module]);
      if (p ? p.moduleAccess && p[action] && (!organizationOnly || isOrganizationScope(p.dataScope)) : req.user.role === 'ADMIN') return next();
      if (!p && action==='canView' && await executiveReader(req.user.userId)) return next();
      res.status(403).json({success:false,message:`Enable ${module} ${action.replace('can','')} access for this account first.`});
    } catch { res.status(500).json({success:false,message:'Unable to verify module access.'}); }
  };
}
export async function organizationModuleScope(user: {userId:string;role:string}, module: string) {
  if (user.role === 'SUPER_ADMIN') return true;
  const [[p]] = await db.query<RowDataPacket[]>('SELECT moduleAccess,dataScope FROM user_module_permissions WHERE userId=? AND moduleId=?',[user.userId,module]);
  return p ? !!p.moduleAccess && isOrganizationScope(p.dataScope) : user.role === 'ADMIN' || await executiveReader(user.userId);
}
export async function canManageCandidate(user: {userId:string;role:string}, candidateId: string, module = 'onboarding') {
  if (await organizationModuleScope(user,module)) return true;
  const [[invite]] = await db.query<RowDataPacket[]>('SELECT id FROM invites WHERE invitedUserId=? AND invitedById=? LIMIT 1',[candidateId,user.userId]);
  return !!invite;
}

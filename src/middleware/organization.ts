import type { Request, Response, NextFunction } from 'express';
import { organizationAccess } from '../shared/services/organization.service';
export async function requireExecutiveReader(req: Request, res: Response, next: NextFunction) {
  try {
    const a = await organizationAccess(req.user!.userId);
    if (!a.admin && !a.isExecutive) { res.status(403).json({success:false,message:'Executive access required.'}); return; }
    next();
  } catch (e) { next(e); }
}

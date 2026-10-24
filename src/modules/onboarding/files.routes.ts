import { Router } from 'express';
import path from 'node:path';
import { realpath } from 'node:fs/promises';
import type { RowDataPacket } from 'mysql2/promise';
import { db } from '../../lib/db';
import { requireAuth } from '../../middleware/auth';
import { canManageCandidate } from '../../middleware/module-action';
import { organizationAccess } from '../../shared/services/organization.service';

export function portableFileUrl(value: string | null) {
  if (!value) return value;
  const pathname=new URL(value,'http://local.invalid').pathname;
  return pathname.startsWith('/uploads/') ? '/api/files/'+encodeURIComponent(decodeURIComponent(pathname.slice(9))) : value;
}
const router=Router();
router.use(requireAuth);
router.get('/:filename',async(req,res,next)=>{
  try {
    const filename=String(req.params.filename);
    if(!filename || filename!==path.basename(filename) || /[\\/\x00]/.test(filename) || filename==='.' || filename==='..') {
      res.status(400).json({success:false,message:'Invalid file.'});return;
    }
    const user=req.user!;
    const [docs]=await db.query<RowDataPacket[]>('SELECT candidateId,fileName FROM documents WHERE SUBSTRING_INDEX(fileUrl,\'/\',-1) IN (?,?)',[filename,encodeURIComponent(filename)]);
    const [attachments]=await db.query<RowDataPacket[]>(`SELECT a.employeeId,a.fileName,e.userId FROM employee_information_employee_attachments a
      JOIN employee_information_employees e ON e.id=a.employeeId WHERE SUBSTRING_INDEX(a.fileUrl,'/',-1) IN (?,?)`,[filename,encodeURIComponent(filename)]);
    let permitted=docs.some(d=>d.candidateId===user.userId)||attachments.some(a=>a.userId===user.userId);
    if(!permitted && attachments.length) {
      const [[assigned]]=await db.query<RowDataPacket[]>(`SELECT l.id FROM leave_applications l JOIN employee_information_employee_attachments a ON a.employeeId=l.employeeId
        WHERE l.approverId=? AND SUBSTRING_INDEX(l.attachmentUrl,'/',-1) IN (?,?) AND SUBSTRING_INDEX(a.fileUrl,'/',-1) IN (?,?) LIMIT 1`,[user.userId,filename,encodeURIComponent(filename),filename,encodeURIComponent(filename)]);
      permitted=Boolean(assigned);
    }
    if(!permitted && user.role==='SUPER_ADMIN')permitted=docs.length+attachments.length>0;
    if(!permitted && docs.length+attachments.length>0) {
      const [grants]=await db.query<RowDataPacket[]>("SELECT moduleId,moduleAccess,canView FROM user_module_permissions WHERE userId=? AND moduleId IN ('document_verification','employee_information')",[user.userId]);
      const canView=(module:string)=>{const grant=grants.find(g=>g.moduleId===module);return grant?Boolean(grant.moduleAccess&&grant.canView):user.role==='ADMIN';};
      if(canView('document_verification')) for(const doc of docs) if(await canManageCandidate(user,doc.candidateId,'document_verification'))permitted=true;
      if(!permitted && canView('employee_information')) {
        const access=await organizationAccess(user.userId);
        if(attachments.some(a=>access.visibleIds.includes(a.employeeId)))permitted=true;
        if(!permitted && docs.length) {
          const [employees]=await db.query<RowDataPacket[]>('SELECT id FROM employee_information_employees WHERE userId IN (?)',[docs.map(d=>d.candidateId)]);
          permitted=employees.some(e=>access.visibleIds.includes(e.id));
        }
      }
    }
    if(!permitted){res.status(404).json({success:false,message:'File not found or outside your access.'});return;}
    const root=await realpath(path.resolve('uploads'));
    let target:string;
    try{target=await realpath(path.join(root,filename));}catch{res.status(404).json({success:false,message:'File is missing from storage. Restore the uploaded file from backup.'});return;}
    if(path.dirname(target)!==root){res.status(404).end();return;}
    res.setHeader('Cache-Control','private, no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox");
    if(!/\.(pdf|png|jpe?g)$/i.test(filename)) {
      res.setHeader('Content-Type','application/octet-stream');
      res.setHeader('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(filename));
    }
    res.sendFile(target,error=>{if(error)next(error);});
  }catch(error){next(error);}
});
export default router;

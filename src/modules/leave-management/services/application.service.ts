import { randomUUID } from 'crypto';
import { z } from 'zod';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { db } from '../../../lib/db';
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(d=>!isNaN(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d,'Invalid date');
const input=z.object({leaveTypeId:z.string().uuid(),startDate:date,endDate:date,totalDays:z.coerce.number().positive(),halfDayType:z.enum(['NONE','FIRST_HALF','SECOND_HALF']).default('NONE'),reason:z.string().max(4000).optional(),comments:z.string().max(4000).optional(),applicantId:z.string().uuid().optional(),coveringEmployeeId:z.string().nullish(),medCertSubmitted:z.boolean().optional(),medCertRefNo:z.string().optional(),medCertIssuedDate:z.string().nullish(),attachmentUrl:z.string().nullish()});
export class LeaveError extends Error { constructor(public status:number,message:string){super(message);} }
const check=(test:unknown,message:string,status=400)=>{if(!test)throw new LeaveError(status,message);};
async function transaction<T>(fn:(c:PoolConnection)=>Promise<T>) {const c=await db.getConnection();try{await c.beginTransaction();const r=await fn(c);await c.commit();return r;}catch(e){await c.rollback();throw e;}finally{c.release();}}
async function managerUser(c:PoolConnection,employeeId:string) {
  const [[row]]=await c.query<RowDataPacket[]>(`SELECT u.id FROM employee_information_employees e JOIN employee_information_employees m ON m.id=e.reportingManagerId JOIN users u ON u.id=m.userId WHERE e.id=? AND m.status='Active' AND m.isActive=1 AND u.isActive=1`,[employeeId]);
  return row?.id as string|undefined;
}
export async function submitLeave(actor:{userId:string;role:string},payload:unknown) {
  return persistLeave(actor, payload, false);
}
export async function importApprovedLeave(actor:{userId:string;role:string},payload:unknown) {
  check(['ADMIN','SUPER_ADMIN'].includes(actor.role),'Administrator access is required for leave imports.',403);
  return persistLeave(actor, payload, true);
}
async function persistLeave(actor:{userId:string;role:string},payload:unknown,approvedImport:boolean) {
  const v=input.parse(payload); const admin=['ADMIN','SUPER_ADMIN'].includes(actor.role);
  const applicantId=v.applicantId||actor.userId;
  check(admin||applicantId===actor.userId,'You cannot apply on behalf of another employee.',403);
  check(v.startDate<=v.endDate,'End date must not precede the start date.');
  const span=(Date.parse(v.endDate)-Date.parse(v.startDate))/86400000+1;
  const total=v.halfDayType==='NONE'?span:0.5;
  check(v.halfDayType==='NONE'||span===1,'Half-day leave must be on one date.');
  check(Math.abs(v.totalDays-total)<0.001,'Requested days must match the selected dates. Submit separate requests for non-consecutive dates.');
  return transaction(async c=>{
    // Serialize requests for one employee, including different leave types, before testing overlaps.
    const [[employee]]=await c.query<RowDataPacket[]>(`SELECT id,organizationalRank FROM employee_information_employees WHERE userId=? AND status='Active' AND isActive=1 FOR UPDATE`,[applicantId]);
    check(employee,'Active employee profile not found.',404);
    const [[type]]=await c.query<RowDataPacket[]>('SELECT * FROM leave_types WHERE id=? AND isActive=1',[v.leaveTypeId]); check(type,'Leave type not found.',404);
    check(v.halfDayType==='NONE'||type.allowHalfDays,'This leave type does not allow half days.');
    check(!type.commentMandatory||!!(v.reason||v.comments)?.trim(),'A reason is required.');
    check(!type.requireCoveringEmp||!!v.coveringEmployeeId,'Select a covering employee.');
    check(!type.requireAttachment||!!v.attachmentUrl,'An attachment is required for this leave type.');
    check(!type.needMedicalCertificate || total<=Number(type.maxDaysWithoutMedCert||0) || v.medCertSubmitted,'A medical certificate is required for this leave type.');
    check(!Number(type.maxDaysPerInstance) || total<=Number(type.maxDaysPerInstance),'This request exceeds the maximum days per instance.');
    const [[year]]=await c.query<RowDataPacket[]>('SELECT id FROM leave_years WHERE isActive=1 AND startDate<=? AND endDate>=? LIMIT 1',[v.startDate,v.endDate]); check(year,'No active leave year covers these dates.');
    const [[overlap]]=await c.query<RowDataPacket[]>(`SELECT id FROM leave_applications WHERE applicantId=? AND (status LIKE 'PENDING%' OR status='APPROVED') AND startDate<=? AND endDate>=? LIMIT 1`,[applicantId,v.endDate,v.startDate]);
    check(!overlap,'An approved or pending leave request already overlaps these dates.',409);
    const [[entitlement]]=await c.query<RowDataPacket[]>('SELECT * FROM leave_entitlements WHERE userId=? AND leaveTypeId=? AND leaveYearId=? FOR UPDATE',[applicantId,v.leaveTypeId,year.id]);
    const balance=Number(entitlement?.totalDays||0)+Number(entitlement?.carryForwardDays||0)-Number(entitlement?.usedDays||0)-Number(entitlement?.pendingDays||0);
    check(type.isNoPayLeave||type.allowNegativeBalance||(entitlement&&balance>=total),'Insufficient leave balance. Ask HR to configure your entitlement.');
    let approver=await managerUser(c,employee.id);
    if(!approver&&employee.organizationalRank==='OWNER') {
      const [[hr]]=await c.query<RowDataPacket[]>(`SELECT id FROM users WHERE role='ADMIN' AND isActive=1 AND id<>? ORDER BY createdAt LIMIT 1`,[applicantId]); approver=hr?.id;
    }
    check(approver&&approver!==applicantId,'An active reporting approver is required.');
    const id=randomUUID();
    await c.query(`INSERT INTO leave_applications (id,applicantId,employeeId,leaveTypeId,leaveYearId,startDate,endDate,totalDays,halfDayType,reason,comments,coveringEmployeeId,medCertSubmitted,medCertRefNo,medCertIssuedDate,attachmentUrl,status,approverId,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW())`,[id,applicantId,employee.id,v.leaveTypeId,year.id,v.startDate,v.endDate,total,v.halfDayType,v.reason||v.comments||null,v.comments||v.reason||null,v.coveringEmployeeId||null,v.medCertSubmitted?1:0,v.medCertRefNo||null,v.medCertIssuedDate||null,v.attachmentUrl||null,approvedImport?'APPROVED':'PENDING',approver]);
    if(entitlement) await c.query(`UPDATE leave_entitlements SET ${approvedImport?'usedDays':'pendingDays'}=COALESCE(${approvedImport?'usedDays':'pendingDays'},0)+?,updatedAt=NOW() WHERE id=?`,[total,entitlement.id]);
    if(approvedImport) {
      await c.query('UPDATE leave_applications SET approvedAt=NOW(),actionedAt=NOW(),actionedById=? WHERE id=?',[actor.userId,id]);
      await c.query(`INSERT INTO leave_approval_history (id,leave_application_id,approver_user_id,action,level,comment,created_at) VALUES (?,?,?,'APPROVED',1,'Administrator bulk import',NOW())`,[randomUUID(),id,actor.userId]);
    }
    const [[created]]=await c.query<RowDataPacket[]>('SELECT * FROM leave_applications WHERE id=?',[id]); return created;
  });
}
export async function decideLeave(actor:{userId:string;role:string},id:string,action:string,comment?:string) {
  check(['APPROVED','REJECTED'].includes(action),'Invalid approval action.');
  if(action==='REJECTED')check(!!comment?.trim(),'A rejection reason is required.');
  return transaction(async c=>{
    const [[app]]=await c.query<RowDataPacket[]>('SELECT * FROM leave_applications WHERE id=? FOR UPDATE',[id]);check(app,'Leave request not found.',404);
    check(String(app.status).startsWith('PENDING'),'This request has already been actioned.',409);
    check(app.applicantId!==actor.userId,'You cannot approve your own request.',403);
    const [[employee]]=await c.query<RowDataPacket[]>('SELECT id FROM employee_information_employees WHERE userId=?',[app.applicantId]);check(employee,'Applicant mapping not found.');
    const currentApprover=app.approverId||await managerUser(c,employee.id);
    check(currentApprover===actor.userId,'Only the assigned approver can action this request.',403);
    const [[count]]=await c.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM leave_approval_history WHERE leave_application_id=?',[id]);
    const status=action;
    await c.query(`INSERT INTO leave_approval_history (id,leave_application_id,approver_user_id,action,level,comment,created_at) VALUES (?,?,?,?,?,?,NOW())`,[randomUUID(),id,actor.userId,action,Number(count.n)+1,comment||null]);
    await c.query(`UPDATE leave_applications SET status=?,approverId=?,actionedById=?,actionedAt=NOW(),approvedAt=IF(?='APPROVED',NOW(),NULL),rejectedReason=?,updatedAt=NOW() WHERE id=?`,[status,actor.userId,actor.userId,status,action==='REJECTED'?comment:null,id]);
    if(!String(status).startsWith('PENDING')) await c.query(`UPDATE leave_entitlements SET pendingDays=GREATEST(0,COALESCE(pendingDays,0)-?),usedDays=COALESCE(usedDays,0)+?,updatedAt=NOW() WHERE userId=? AND leaveTypeId=? AND leaveYearId=?`,[app.totalDays,status==='APPROVED'?app.totalDays:0,app.applicantId,app.leaveTypeId,app.leaveYearId]);
    const [[updated]]=await c.query<RowDataPacket[]>('SELECT * FROM leave_applications WHERE id=?',[id]);return updated;
  });
}
export async function cancelLeave(userId:string,id:string,reason?:string) {
  return transaction(async c=>{
    const [[app]]=await c.query<RowDataPacket[]>('SELECT * FROM leave_applications WHERE id=? FOR UPDATE',[id]);check(app,'Leave request not found.',404);
    check(app.applicantId===userId,'You can cancel only your own requests.',403);
    check(app.status==='APPROVED'||String(app.status).startsWith('PENDING'),'This request cannot be cancelled.',409);
    const field=app.status==='APPROVED'?'usedDays':'pendingDays';
    await c.query(`UPDATE leave_entitlements SET ${field}=GREATEST(0,COALESCE(${field},0)-?),updatedAt=NOW() WHERE userId=? AND leaveTypeId=? AND leaveYearId=?`,[app.totalDays,userId,app.leaveTypeId,app.leaveYearId]);
    await c.query(`UPDATE leave_applications SET status='CANCELLED',cancelledAt=NOW(),cancelReason=?,updatedAt=NOW() WHERE id=?`,[reason||null,id]);
    await c.query(`INSERT INTO leave_approval_history (id,leave_application_id,approver_user_id,action,comment,created_at) VALUES (?,?,?,'CANCELLED',?,NOW())`,[randomUUID(),id,userId,reason||null]);
    const [[updated]]=await c.query<RowDataPacket[]>('SELECT * FROM leave_applications WHERE id=?',[id]);return updated;
  });
}

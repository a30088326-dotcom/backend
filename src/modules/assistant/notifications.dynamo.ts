import { createHash } from 'crypto';
import { nativeRows, sourceTime } from './native-data';
import type { Context } from './types';
import type { AssistantUpdate } from './notifications';
import { moduleAllowed, scopedContext } from './policy';
import { organizationModuleScope } from '../../middleware/module-action';
import { visibleLaunchRecords } from '../performance/store.dynamo';

export async function updates(c: Context): Promise<AssistantUpdate[]> {
  const items: AssistantUpdate[] = [];
  const add = (kind:string,r:any,message:string,path:string) => items.push({id:createHash('sha256').update(`${kind}:${r.id}:${r.status}`).digest('hex'),message,path,pending:['leave-pending','attendance-pending','document-pending','agreement-ready','agreement-signed'].includes(kind),recordId:r.id,kind,at:String(r.updatedAt||'')});
  const recent = (r:any) => sourceTime(r.updatedAt) >= Date.now()-30*86400000;
  const order = (a:any,b:any) => sourceTime(b.updatedAt)-sourceTime(a.updatedAt);
  if(c.employeeId && moduleAllowed(c,'self_service','canView')) {
    const leaves=(await nativeRows('leave_applications',r=>r.applicantId===c.userId&&['APPROVED','REJECTED','PENDING_MANAGER_APPROVAL'].includes(r.status)&&recent(r))).sort(order).slice(0,20);
    leaves.forEach(r=>add('leave-decision',r,r.status==='PENDING_MANAGER_APPROVAL'?`Your leave for ${r.startDate} to ${r.endDate} passed the first approval and is awaiting the next manager.`:`Your leave for ${r.startDate} to ${r.endDate} was ${r.status.toLowerCase()}.`,'/self_service#requests'));
    const corrections=(await nativeRows('attendance_exceptions',r=>r.employeeId===c.employeeId&&['APPROVED','REJECTED'].includes(r.status)&&recent(r))).sort(order).slice(0,20);
    corrections.forEach(r=>add('attendance-decision',r,`Your attendance correction for ${r.date} was ${r.status.toLowerCase()}.`,'/self_service#requests'));
  }
  if((c.manager||c.admin||c.executive)&&moduleAllowed(c,'leave_approval','canView')) {
    const scope=scopedContext(c,'leave_approval');
    const rows=await nativeRows('leave_applications',r=>r.approverId===c.userId&&r.applicantId!==c.userId&&r.status.startsWith('PENDING'));
    rows.sort(order).forEach(r=>{const e=c.employees.find(e=>e.userId===r.applicantId);if(e&&scope.visibleIds.includes(e.id))add('leave-pending',r,`${e.name} has a leave request (ID: ${r.id}) from ${r.startDate} awaiting your decision.`,'/supervisor');});
    const corrections=await nativeRows('attendance_exceptions',r=>r.status==='PENDING');
    corrections.sort(order).forEach(r=>{const e=c.employees.find(e=>e.id===r.employeeId&&e.managerId===c.employeeId);if(e&&scope.visibleIds.includes(e.id))add('attendance-pending',r,`${e.name} submitted an attendance correction (ID: ${r.id}) for ${r.date}.`,'/team-attendance');});
  }
  if(moduleAllowed(c,'onboarding','canView')) {
    (await nativeRows('invites',r=>r.invitedById===c.userId&&['ACCEPTED','DECLINED'].includes(r.status)&&recent(r))).sort(order).slice(0,20).forEach(r=>add('invite-response',r,`${r.name} ${r.status.toLowerCase()} your onboarding invitation.`,'/onboarding'));
    const all=await organizationModuleScope(c,'onboarding');
    const [contracts,users,invites,employees]=await Promise.all([nativeRows('contracts',r=>r.status==='SIGNED'),nativeRows('users',r=>r.role==='CANDIDATE'),nativeRows('invites',r=>r.invitedById===c.userId),nativeRows('employee_information_employees')]);
    contracts.sort(order).forEach(r=>{const u=users.find(u=>u.id===r.candidateId);if(u&&!employees.some(e=>e.userId===u.id)&&(all||invites.some(i=>i.invitedUserId===u.id)))add('agreement-signed',r,`${u.name} signed their agreement. Complete onboarding to assign their department, reporting manager and roster.`,'/assistant');});
  }
  if(moduleAllowed(c,'document_verification','canView')) {
    const all=await organizationModuleScope(c,'document_verification');
    const [documents,users,invites,contracts]=await Promise.all([nativeRows('documents'),nativeRows('users'),nativeRows('invites'),nativeRows('contracts')]);
    documents.filter(r=>r.status==='PENDING'&&(all||invites.some(i=>i.invitedUserId===r.candidateId&&i.invitedById===c.userId))).sort(order).forEach(r=>add('document-pending',r,`${users.find(u=>u.id===r.candidateId)?.name||'Candidate'} uploaded ${r.label}. Review the document before approving it.`,'/verification'));
    for(const invite of invites.filter(i=>all||i.invitedById===c.userId)) {
      const docs=documents.filter(d=>d.candidateId===invite.invitedUserId);
      if(!contracts.some(x=>x.candidateId===invite.invitedUserId)&&docs.length>=3&&docs.every(d=>d.status==='APPROVED')&&['NATIONAL_ID','BANK_STATEMENT','PASSPORT_PHOTO'].every(type=>docs.some(d=>d.type===type)))add('agreement-ready',{...invite,status:'READY',updatedAt:docs.sort(order)[0]?.updatedAt},`${invite.name}'s required documents are approved. Would you like to prepare an agreement? Supply the approved agreement text before sending.`,'/onboarding');
    }
  }
  if(moduleAllowed(c,'performance_management','canView')) (await visibleLaunchRecords(await nativeRows('hr_performance_notifications',r=>r.user_id===c.userId&&!r.read_at))).sort((a,b)=>sourceTime(b.at)-sourceTime(a.at)).slice(0,20).forEach(r=>add('performance',{...r,status:'UNREAD',updatedAt:r.at},r.message,`/performance?review=${encodeURIComponent(r.review_id)}#overview`));
  const read=new Set((await nativeRows('hr_assistant_read_updates',r=>r.user_id===c.userId)).map(r=>r.event_id));
  return [...items.filter(r=>r.pending).sort((a,b)=>b.at.localeCompare(a.at)),...items.filter(r=>!r.pending&&!read.has(r.id)).sort((a,b)=>b.at.localeCompare(a.at)).slice(0,50)];
}

import { createHash } from 'crypto';
import type { RowDataPacket } from 'mysql2/promise';
import { db } from '../../lib/db';
import type { Context } from './types';
import { moduleAllowed, scopedContext } from './policy';
import { organizationModuleScope } from '../../middleware/module-action';
import { ensurePerformanceSchema } from '../performance/schema';

export interface AssistantUpdate { id: string; message: string; path: string; at: string; pending: boolean; recordId?: string; kind?: string; }
let ready: Promise<unknown> | undefined;
export function ensureNotifications() {
  return ready ||= db.query(`CREATE TABLE IF NOT EXISTS hr_assistant_read_updates (
    user_id VARCHAR(191) NOT NULL, event_id CHAR(64) NOT NULL, read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(user_id,event_id))`).catch(e => { ready = undefined; throw e; });
}
/** Rebuild from committed workflow state, including changes made outside chat.
 * Only the recipient's currently authorized records are returned. No email, files
 * or private document contents are copied into the notification store. */
export async function updates(c: Context): Promise<AssistantUpdate[]> {
  await ensureNotifications();
  const items: AssistantUpdate[] = [];
  const add = (kind: string, r: any, message: string, path: string) => items.push({
    id: createHash('sha256').update(`${kind}:${r.id}:${r.status}`).digest('hex'), message, path,
    pending: ['leave-pending','attendance-pending','document-pending','agreement-ready','agreement-signed'].includes(kind),
    recordId: r.id,
    kind: kind,
    at: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt || ''),
  });
  if (c.employeeId && moduleAllowed(c, 'self_service', 'canView')) {
    const [rows] = await db.query<RowDataPacket[]>(`SELECT id,status,startDate,endDate,updatedAt FROM leave_applications
      WHERE applicantId=? AND status IN ('APPROVED','REJECTED','PENDING_MANAGER_APPROVAL') AND updatedAt>=DATE_SUB(NOW(),INTERVAL 30 DAY) ORDER BY updatedAt DESC LIMIT 20`, [c.userId]);
    rows.forEach(r => add('leave-decision', r, r.status === 'PENDING_MANAGER_APPROVAL'
      ? `Your leave for ${r.startDate} to ${r.endDate} passed the first approval and is awaiting the next manager.`
      : `Your leave for ${r.startDate} to ${r.endDate} was ${r.status.toLowerCase()}.`, '/self_service#requests'));
    const [corrections] = await db.query<RowDataPacket[]>(`SELECT id,status,date,updatedAt FROM attendance_exceptions
      WHERE employeeId=? AND status IN ('APPROVED','REJECTED') AND updatedAt>=DATE_SUB(NOW(),INTERVAL 30 DAY) ORDER BY updatedAt DESC LIMIT 20`, [c.employeeId]);
    corrections.forEach(r => add('attendance-decision', r, `Your attendance correction for ${r.date} was ${r.status.toLowerCase()}.`, '/self_service#requests'));
  }
  if ((c.manager || c.admin || c.executive) && moduleAllowed(c, 'leave_approval', 'canView')) {
    const teamScope = scopedContext(c,'leave_approval');
    const [rows] = await db.query<RowDataPacket[]>(`SELECT a.id,a.status,a.startDate,a.updatedAt,e.id employeeId,u.name
      FROM leave_applications a JOIN users u ON u.id=a.applicantId JOIN employee_information_employees e ON e.userId=u.id
      WHERE a.approverId=? AND a.applicantId<>? AND a.status LIKE 'PENDING%' ORDER BY a.updatedAt DESC`, [c.userId,c.userId]);
    rows.filter(r => teamScope.visibleIds.includes(r.employeeId)).forEach(r => add('leave-pending', r, `${r.name} has a leave request (ID: ${r.id}) from ${r.startDate} awaiting your decision.`, '/supervisor'));
    const [corrections] = await db.query<RowDataPacket[]>(`SELECT a.id,a.status,a.date,a.updatedAt,e.id employeeId,u.name
      FROM attendance_exceptions a JOIN employee_information_employees e ON e.id=a.employeeId JOIN users u ON u.id=e.userId
      WHERE e.reportingManagerId=? AND a.status='PENDING' ORDER BY a.updatedAt DESC`, [c.employeeId]);
    corrections.filter(r => teamScope.visibleIds.includes(r.employeeId)).forEach(r => add('attendance-pending', r, `${r.name} submitted an attendance correction (ID: ${r.id}) for ${r.date}.`, '/team-attendance'));
  }
  if (moduleAllowed(c, 'onboarding', 'canView')) {
    const [invites] = await db.query<RowDataPacket[]>(`SELECT id,name,status,updatedAt FROM invites WHERE invitedById=?
      AND status IN ('ACCEPTED','DECLINED') AND updatedAt>=DATE_SUB(NOW(),INTERVAL 30 DAY) ORDER BY updatedAt DESC LIMIT 20`, [c.userId]);
    invites.forEach(r => add('invite-response', r, `${r.name} ${r.status.toLowerCase()} your onboarding invitation.`, '/onboarding'));
    const allCandidates=await organizationModuleScope(c,'onboarding');
    const [signed]=await db.query<RowDataPacket[]>(`SELECT x.id,x.status,x.updatedAt,u.name FROM contracts x JOIN users u ON u.id=x.candidateId
      WHERE x.status='SIGNED' AND u.role='CANDIDATE' AND (?=1 OR EXISTS(SELECT 1 FROM invites i WHERE i.invitedUserId=x.candidateId AND i.invitedById=?))
      AND NOT EXISTS(SELECT 1 FROM employee_information_employees e WHERE e.userId=x.candidateId) ORDER BY x.updatedAt DESC`,[allCandidates?1:0,c.userId]);
    signed.forEach(r=>add('agreement-signed',r,`${r.name} signed their agreement. Complete onboarding to assign their department, reporting manager and roster.`, '/assistant'));
  }
  if (moduleAllowed(c, 'document_verification', 'canView')) {
    const allCandidates = await organizationModuleScope(c,'document_verification');
    const [docs] = await db.query<RowDataPacket[]>(`SELECT d.id,d.status,d.label,d.updatedAt,u.name FROM documents d
      JOIN users u ON u.id=d.candidateId WHERE d.status='PENDING'
      AND (?=1 OR EXISTS(SELECT 1 FROM invites i WHERE i.invitedUserId=d.candidateId AND i.invitedById=?))
      ORDER BY d.updatedAt DESC`, [allCandidates ? 1 : 0, c.userId]);
    docs.forEach(r => add('document-pending', r, `${r.name} uploaded ${r.label}. Review the document before approving it.`, '/verification'));
    const [verified] = await db.query<RowDataPacket[]>(`SELECT i.id,i.name,'READY' status,MAX(d.updatedAt) updatedAt FROM invites i
      JOIN documents d ON d.candidateId=i.invitedUserId WHERE (?=1 OR i.invitedById=?)
      AND NOT EXISTS(SELECT 1 FROM contracts x WHERE x.candidateId=i.invitedUserId)
      GROUP BY i.id,i.name HAVING COUNT(*)>=3 AND SUM(d.status<>'APPROVED')=0
      AND COUNT(DISTINCT CASE WHEN d.type IN ('NATIONAL_ID','BANK_STATEMENT','PASSPORT_PHOTO') THEN d.type END)=3
      ORDER BY updatedAt DESC`, [allCandidates ? 1 : 0,c.userId]);
    verified.forEach(r => add('agreement-ready', r, `${r.name}'s required documents are approved. Would you like to prepare an agreement? Supply the approved agreement text before sending.`, '/onboarding'));
  }
  if (moduleAllowed(c,'performance_management','canView')) {
    await ensurePerformanceSchema();
    const [rows] = await db.query<RowDataPacket[]>('SELECT id,review_id,message,at updatedAt FROM hr_performance_notifications WHERE user_id=? AND read_at IS NULL ORDER BY at DESC LIMIT 20',[c.userId]);
    rows.forEach(r=>add('performance',{...r,status:'UNREAD'},r.message,`/performance?review=${encodeURIComponent(r.review_id)}#overview`));
  }
  const [read] = await db.query<RowDataPacket[]>('SELECT event_id FROM hr_assistant_read_updates WHERE user_id=?', [c.userId]);
  const seen = new Set(read.map(r => r.event_id));
  // A read receipt is not a workflow decision. Never hide unresolved work,
  // including requests acknowledged before this behavior was introduced.
  const pending = items.filter(r => r.pending).sort((a,b) => b.at.localeCompare(a.at));
  const news = items.filter(r => !r.pending && !seen.has(r.id)).sort((a,b) => b.at.localeCompare(a.at)).slice(0,50);
  return [...pending, ...news];
}

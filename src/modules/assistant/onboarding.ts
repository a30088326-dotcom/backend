import { z } from 'zod';
import type { RowDataPacket } from 'mysql2/promise';
import { db } from '../../lib/db';
import { api, rowsTable } from './gateway';
import { ensure, type Tool } from './types';
import { canManageCandidate, organizationModuleScope } from '../../middleware/module-action';

const text = z.string().trim().min(1).max(500);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const base = (id: string, label: string, description: string, examples: string[]): Omit<Tool, 'schema' | 'execute'> => ({ id, label, description, examples, module: 'onboarding', scope: 'staff', permission: 'canView', risk: 'read', fields: [], service: 'Peoples Management onboarding workflow' });

export const onboardingTools: Tool[] = [
  {
    ...base('onboarding.resend','Resend a pending onboarding invitation','Send the existing, unexpired invitation again without creating a duplicate.',['Resend an onboarding invitation']),permission:'canCreate',risk:'high',
    fields:[{name:'email',label:'Candidate email',required:true}],schema:z.object({email:z.string().trim().email().transform(v=>v.toLowerCase())}).strict(),
    prepare:async(c,v)=>{const all=await organizationModuleScope(c,'onboarding');const [rows]=await db.query<RowDataPacket[]>('SELECT id,name,email,status,expiresAt FROM invites WHERE LOWER(email)=? AND status=\'PENDING\' AND (?=1 OR invitedById=?)',[v.email,all?1:0,c.userId]);ensure(rows.length===1,'Choose one pending invitation in your onboarding scope.');const r=rows[0];ensure(new Date(r.expiresAt).getTime()>Date.now(),'This invitation has expired. Create a new invitation after resolving the expired record.');return {args:{id:r.id},summary:`Resend the existing onboarding invitation to ${r.name} (${r.email}). No new invitation or user account will be created.`,before:{status:r.status,expiresAt:String(r.expiresAt)}};},
    execute:async(c,v)=>{const r=await api(c,'POST',`/api/invites/${v.id}/resend`,{});return {message:r.delivery?.sent?'The mail server accepted the resent invitation.':'Email was not sent. The existing invitation is retained; check SMTP before resending.',recordId:v.id};}
  },
  {
    ...base('onboarding.agreement','Prepare and send an employment agreement','Use supplied, approved agreement wording for a verified candidate. The assistant does not invent contract terms.',['Send an employment agreement']),permission:'canCreate',risk:'high',
    fields:[{name:'email',label:'Candidate email',required:true},{name:'title',label:'Agreement title',required:true},{name:'templateContent',label:'Approved agreement text',type:'textarea',required:true},{name:'fieldValues',label:'Template values (JSON, optional)',type:'json'}],
    schema:z.object({email:z.string().email(),title:z.string().trim().min(1).max(200),templateContent:z.string().trim().min(1).max(10000),fieldValues:z.record(z.string().max(2000)).default({})}).strict(),
    prepare:async(c,v)=>{const [[candidate]]=await db.query<RowDataPacket[]>('SELECT id,name FROM users WHERE LOWER(email)=? AND isActive=1',[v.email.toLowerCase()]);ensure(candidate,'Candidate must accept the invitation first.');ensure(await canManageCandidate(c,candidate.id),'Candidate is outside your onboarding scope.',403);const [docs]=await db.query<RowDataPacket[]>('SELECT type,status FROM documents WHERE candidateId=? ORDER BY type',[candidate.id]);ensure(['NATIONAL_ID','BANK_STATEMENT','PASSPORT_PHOTO'].every(type=>docs.some(d=>d.type===type&&d.status==='APPROVED'))&&docs.every(d=>d.status==='APPROVED'),'Approve the required documents before sending an agreement.');const [[old]]=await db.query<RowDataPacket[]>('SELECT id FROM contracts WHERE candidateId=?',[candidate.id]);ensure(!old,'An agreement already exists. Open Onboarding to review or resend it.');ensure(!/\{\{[^}]+\}\}/.test(v.templateContent.replace(/\{\{([^}]+)\}\}/g,(_s:string,key:string)=>v.fieldValues[key]??`{{${key}}}`)),'Fill all agreement template placeholders.');return {args:{candidateId:candidate.id,title:v.title,templateContent:v.templateContent,fieldValues:v.fieldValues},summary:`Create and email agreement "${v.title}" to ${candidate.name} (${v.email}). Review this wording before confirming:\n${v.templateContent.replace(/\{\{([^}]+)\}\}/g,(_s:string,key:string)=>v.fieldValues[key]??'')}`,before:{documents:docs}};},
    execute:async(c,v)=>{const contract=await api(c,'POST','/api/contracts',v);const sent=await api(c,'POST',`/api/contracts/${contract.id}/send-link`,{});return {message:sent.delivery?.sent?'Agreement created; its email was accepted by the mail server.':'Agreement created, but email was not sent. Check SMTP and resend the existing agreement; do not create a duplicate.',recordId:contract.id,links:[{label:'Onboarding',path:'/onboarding'}]};}
  },
  {
    ...base('onboarding.invites', 'View onboarding invitations', 'Show real onboarding invitations and their current status.', ['Show pending onboarding requests', 'List incomplete onboarding invitations']),
    fields: [{ name: 'status', label: 'Status', type: 'select', options: ['PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED'] }],
    schema: z.object({ status: z.enum(['PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED']).optional() }).strict(),
    execute: async (c, v) => {
      const query = v.status ? `?status=${encodeURIComponent(v.status)}&limit=100` : '?limit=100';
      const rows = await api(c, 'GET', `/api/invites${query}`) as any[];
      return { message: `${rows.length} onboarding invitation(s) found${v.status ? ` with status ${v.status}` : ''}.`, table: rowsTable(['ID', 'Name', 'Email', 'Status', 'Designation', 'Team', 'Join date'], rows.map(row => [row.id, row.name, row.email, row.status, row.designation, row.team, String(row.joinedDate || '').slice(0, 10)])), links: [{ label: 'Onboarding', path: '/onboarding' }] };
    },
  },
  {
    ...base('onboarding.invite', 'Send an onboarding invitation', 'Create and send an invitation through the existing Peoples Management onboarding workflow.', ['Onboard a new employee', 'Send an onboarding request']),
    permission: 'canCreate', risk: 'high',
    fields: [{ name: 'name', label: 'Full name', required: true }, { name: 'email', label: 'Email', required: true }, { name: 'role', label: 'Account role', type: 'select', options: ['CANDIDATE'] }, { name: 'employmentType', label: 'Employment type (optional)', type: 'select', options: ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN'] }, { name: 'designation', label: 'Designation (optional)' }, { name: 'team', label: 'Team / department (optional)' }, { name: 'joinedDate', label: 'Join date (optional)', type: 'date' }],
    schema: z.object({ name: z.string().trim().min(2).max(100), email: z.string().trim().email().max(254).transform(value => value.toLowerCase()), role: z.enum(['CANDIDATE', 'ADMIN']).default('CANDIDATE'), employmentType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN']).optional(), designation: text.optional(), team: text.optional(), joinedDate: date.optional() }).strict(),
    prepare: async (c, v) => {
      ensure(v.role !== 'ADMIN' || c.admin, 'Only an administrator can invite another administrator.', 403);
      const [[user]] = await db.query<RowDataPacket[]>('SELECT id FROM users WHERE LOWER(email)=? LIMIT 1', [v.email]);
      const [[pending]] = await db.query<RowDataPacket[]>('SELECT id FROM invites WHERE LOWER(email)=? AND status="PENDING" LIMIT 1', [v.email]);
      ensure(!user, `A user with ${v.email} already exists.`); ensure(!pending, `A pending invitation for ${v.email} already exists.`);
      return { args: v, summary: `Send onboarding invitation to ${v.name} (${v.email}). ${v.designation || 'Designation not set'}; ${v.team || 'Team not set'}; join date ${v.joinedDate || 'not set'}. This sends an email; missing employment details can be completed later.` };
    },
    execute: async (c, v) => {
      const result = await api(c, 'POST', '/api/invites', v);
      const [[saved]] = await db.query<RowDataPacket[]>('SELECT id,status,email FROM invites WHERE id=? LIMIT 1', [result.invite?.id]);
      ensure(saved?.status === 'PENDING' && saved.email === v.email, 'The onboarding invitation could not be verified.', 502);
      return { message: result.delivery?.sent ? `Onboarding invitation created for ${v.name}; the mail server accepted the email. I will show an update after acceptance in Workflow updates.` : `Invitation created for ${v.name}, but no email delivery was confirmed. ${result.delivery?.reason || 'Check mail delivery before retrying.'}`, recordId: saved.id, links: [{ label: 'Onboarding', path: '/onboarding' }] };
    },
  },
  {
    ...base('onboarding.documents', 'View documents awaiting verification', 'Show onboarding documents that are waiting for an administrator decision.', ['Show pending onboarding documents']),
    module: 'document_verification', permission: 'canView',
    schema: z.object({}).strict(),
    execute: async c => {
      const [rows] = await db.query<RowDataPacket[]>('SELECT d.id,d.label,d.type,d.status,d.createdAt,u.name,u.email FROM documents d LEFT JOIN users u ON u.id=d.candidateId WHERE d.status="PENDING" AND (?=1 OR EXISTS(SELECT 1 FROM invites i WHERE i.invitedUserId=d.candidateId AND i.invitedById=?)) ORDER BY d.createdAt ASC LIMIT 100',[await organizationModuleScope(c,'document_verification')?1:0,c.userId]);
      return { message: `${rows.length} onboarding document(s) await verification.`, table: rowsTable(['Document ID', 'Candidate', 'Email', 'Document', 'Type', 'Submitted'], rows.map(row => [row.id, row.name, row.email, row.label, row.type, String(row.createdAt || '').slice(0, 10)])), links: [{ label: 'Document Verification', path: '/verification' }] };
    },
  },
  {
    ...base('onboarding.documentDecision', 'Approve or reject an onboarding document', 'Use the existing document verification workflow and verify the stored result.', ['Approve an onboarding document', 'Reject an onboarding document']),
    module: 'document_verification', permission: 'canApprove', risk: 'high',
    fields: [{ name: 'documentId', label: 'Document ID', required: true }, { name: 'decision', label: 'Decision', type: 'select', required: true, options: ['APPROVED', 'REJECTED'] }, { name: 'rejectionNote', label: 'Rejection note', type: 'textarea' }],
    schema: z.object({ documentId: z.string().uuid(), decision: z.enum(['APPROVED', 'REJECTED']), rejectionNote: z.string().trim().max(2000).optional() }).strict().superRefine((v, ctx) => { if (v.decision === 'REJECTED' && !v.rejectionNote) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['rejectionNote'], message: 'A rejection note is required.' }); }),
    prepare: async (c, v) => {
      const [[row]] = await db.query<RowDataPacket[]>('SELECT id,label,status,candidateId FROM documents WHERE id=? LIMIT 1', [v.documentId]);
      ensure(row, 'Document not found.', 404); ensure(row.status === 'PENDING', 'Only a pending document can be verified.', 409);
      ensure(await canManageCandidate(c,row.candidateId,'document_verification'), 'Choose a document within your document verification scope.',403);
      return { args: v, summary: `${v.decision === 'APPROVED' ? 'Approve' : 'Reject'} onboarding document "${row.label}" (${row.id})${v.rejectionNote ? `: ${v.rejectionNote}` : ''}.`, before: { status: row.status, candidateId: row.candidateId } };
    },
    execute: async (c, v) => {
      await api(c, 'PATCH', `/api/documents/${v.documentId}/verify`, { status: v.decision, rejectionNote: v.rejectionNote });
      const [[row]] = await db.query<RowDataPacket[]>('SELECT status FROM documents WHERE id=? LIMIT 1', [v.documentId]);
      ensure(row?.status === v.decision, 'The document decision could not be verified.', 502);
      return { message: `Your document decision (${v.decision.toLowerCase()}) was saved.`, recordId: v.documentId, links: [{ label: 'Document Verification', path: '/verification' }] };
    },
  },
];

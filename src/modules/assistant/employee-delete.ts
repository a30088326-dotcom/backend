import { useDynamo } from './native-data';
import * as native from './employee-delete.dynamo';
import { z } from 'zod';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { db } from '../../lib/db';
import { ensure, AssistantError, type Context, type Tool } from './types';
import { moduleAllowed } from './policy';

const identifier = (s:string) => { ensure(/^[a-zA-Z0-9_]+$/.test(s),'Unexpected database identifier.'); return `\`${s}\``; };
type Target = { table:string; column:string; value:string };
const employeeTables = new Set(['attendance_exceptions','attendance_raw_logs','attendance_records','attendance_roster_assignments','earned_leaves','employee_requests','employee_salary_histories','hr_assistant_field_values','hr_performance_reviews','performance_audit_logs','performance_cycle_eligible_employees','performance_development_actions','performance_development_plans','performance_feedback','performance_goals','performance_review_history','performance_reviews','reporting_hierarchy_audit','reporting_relationships']);
const userTables = new Set(['contracts','documents','onboarding_profiles','invites','leave_applications','leave_entitlements','user_module_permissions','hr_assistant_messages','hr_assistant_conversations','hr_assistant_read_updates','hr_performance_notifications']);
async function plan(c:Context, employeeNumber:string, connection:typeof db|PoolConnection=db) {
  const e = c.employees.find(e=>e.employeeNumber.toLowerCase()===employeeNumber.toLowerCase());
  ensure(e && c.visibleIds.includes(e.id),'Use an exact employee number in your authorized employee scope.');
  ensure(e.id!==c.employeeId && e.userId!==c.userId && e.organizationalRank!=='OWNER','The Owner and your current account cannot be deleted.');
  ensure(c.superAdmin || moduleAllowed(c,'employee_information','canDelete'),'Employee Information Delete permission is required.',403);
  const [[row]]=await connection.query<RowDataPacket[]>('SELECT id,userId FROM employee_information_employees WHERE id=?',[e.id]); ensure(row,'Employee no longer exists.',404);
  if(e.userId){const [[u]]=await connection.query<RowDataPacket[]>('SELECT role FROM users WHERE id=?',[e.userId]);ensure(u?.role!=='SUPER_ADMIN','The Owner account cannot be deleted.');}
  const [[reports]]=await connection.query<RowDataPacket[]>('SELECT COUNT(*) n FROM employee_information_employees WHERE reportingManagerId=?',[e.id]);
  ensure(!reports.n,'Reassign this employee’s direct reports before permanently deleting their manager.');
  if(e.userId){const [[pending]]=await connection.query<RowDataPacket[]>('SELECT COUNT(*) n FROM leave_applications WHERE approverId=? AND applicantId<>? AND status LIKE \'PENDING%\'',[e.userId,e.userId]);ensure(!pending.n,'Reassign pending leave approvals before deleting this approver.');}
  const [columns]=await connection.query<RowDataPacket[]>('SELECT TABLE_NAME t,COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,COLUMN_NAME');
  const exists=(t:string,col:string)=>columns.some(r=>r.t===t&&r.c===col);
  // File deletion needs a separate verified storage cleanup; do not orphan uploads.
  for(const [table,col,value] of [['documents','candidateId',e.userId],['contracts','candidateId',e.userId],['employee_information_employee_attachments','employeeId',e.id]] as const){
    if(value&&exists(table,col)){const [[count]]=await connection.query<RowDataPacket[]>(`SELECT COUNT(*) n FROM ${identifier(table)} WHERE ${identifier(col)}=?`,[value]);ensure(!count.n,`Permanent deletion is blocked by ${table} records. Their stored documents/signatures need an approved storage cleanup first; no data has been deleted.`);}
  }
  const targets:Target[]=[];
  for(const r of columns){
    if((r.t.startsWith('employee_information_')&&r.t!=='employee_information_employees'||employeeTables.has(r.t)||r.t==='hr_assistant_collection_rows')&&['employeeId','employee_id'].includes(r.c)) targets.push({table:r.t,column:r.c,value:e.id});
    if(e.userId&&userTables.has(r.t)&&['userId','user_id','candidateId','applicantId','invitedUserId'].includes(r.c)) targets.push({table:r.t,column:r.c,value:e.userId});
  }
  // Known detail tables belong to a selected review/goal/application, not to the actor.
  const children=[['leave_approval_history','leave_application_id','leave_applications','applicantId',e.userId],['performance_goal_checkins','goal_id','performance_goals','employee_id',e.id],['performance_review_answers','review_id','performance_reviews','employee_id',e.id],['performance_360_feedback','review_id','performance_reviews','employee_id',e.id],['hr_performance_notifications','review_id','hr_performance_reviews','employee_id',e.id]];
  const details:{table:string;where:string;values:any[]}[]=[];
  for(const [table,col,parent,parentCol,value] of children) if(value&&exists(table!,col!)&&exists(parent!,parentCol!)) details.push({table:table!,where:`${identifier(col!)} IN (SELECT id FROM ${identifier(parent!)} WHERE ${identifier(parentCol!)}=?)`,values:[value]});
  const operations=[...details,...targets.map(t=>({table:t.table,where:`${identifier(t.column)}=?`,values:[t.value]})),{table:'employee_information_employees',where:'id=?',values:[e.id]},...(e.userId?[{table:'users',where:'id=?',values:[e.userId]}]:[])];
  const counts=[];
  for(const op of operations){const [[r]]=await connection.query<RowDataPacket[]>(`SELECT COUNT(*) n FROM ${identifier(op.table)} WHERE ${op.where}`,op.values);if(r.n)counts.push({table:op.table,count:Number(r.n)});}
  return {e,operations,counts,exists};
}
export const deleteEmployeeTool:Tool={
  id:'employee.delete',label:'Permanently delete an employee',module:'employee_information',scope:'staff',permission:'canDelete',risk:'high',service:'Transactional employee removal',
  description:'Remove a non-Owner employee and supported dependent records. Shared reporting obligations and stored files must be resolved first. A minimal deletion audit receipt remains.',examples:['Delete employee EMP-027'],
  fields:[{name:'employeeNumber',label:'Exact employee number',required:true},{name:'confirmation',label:'Type DELETE to confirm permanent removal',required:true}],
  schema:z.object({employeeNumber:z.string().trim().min(1).max(60),confirmation:z.literal('DELETE')}).strict(),
  prepare:async(c,v)=>{if(useDynamo())return native.prepare(c,v);const p=await plan(c,v.employeeNumber);return {args:{employeeNumber:p.e.employeeNumber,confirmation:v.confirmation},summary:`PERMANENTLY DELETE ${p.e.name} (${p.e.employeeNumber}) and their login. Cannot be undone without a backup. Dependent rows: ${p.counts.map(r=>`${r.table}: ${r.count}`).join('; ')}. A minimal deletion audit receipt is retained.`,before:p.counts};},
  execute:async(c,v)=>{if(useDynamo())return native.execute(c,v);const conn=await db.getConnection();try{await conn.beginTransaction();const target=c.employees.find(e=>e.employeeNumber===v.employeeNumber);ensure(target,'Employee not found.');await conn.query('SELECT id FROM employee_information_employees WHERE id=? FOR UPDATE',[target.id]);const p=await plan(c,v.employeeNumber,conn);
    if(p.exists('hr_performance_reviews','data')){
      const [reviews]=await conn.query<RowDataPacket[]>('SELECT id,data FROM hr_performance_reviews WHERE employee_id<>? FOR UPDATE',[p.e.id]);
      for(const r of reviews){const d=typeof r.data==='string'?JSON.parse(r.data):r.data;ensure(!(d.feedback||[]).some((f:any)=>f.reviewerId===p.e.id)&&!(d.development||[]).some((a:any)=>a.ownerId===p.e.id),'Reassign this employee’s feedback invitations and development actions before deletion.');}
    }
    if(p.exists('hr_performance_cycles','data')){const [cycles]=await conn.query<RowDataPacket[]>('SELECT id,data FROM hr_performance_cycles FOR UPDATE');for(const r of cycles){const d=typeof r.data==='string'?JSON.parse(r.data):r.data;if(d.employeeIds?.includes(p.e.id)){d.employeeIds=d.employeeIds.filter((id:string)=>id!==p.e.id);await conn.query('UPDATE hr_performance_cycles SET data=? WHERE id=?',[JSON.stringify(d),r.id]);}}}
    for(const op of p.operations) await conn.query(`DELETE FROM ${identifier(op.table)} WHERE ${op.where}`,op.values);
    await conn.commit();return {message:`${p.e.name} (${p.e.employeeNumber}) and the listed dependent database records were permanently deleted. Login is no longer available. This cannot be undone without a backup.`,recordId:p.e.id};
  }catch(error:any){await conn.rollback();if(error.code==='ER_ROW_IS_REFERENCED_2')throw new AssistantError(409,'Deletion rolled back: other shared records still reference this employee. Reassign those records first. No records were deleted.');throw error;}finally{conn.release();}}
};

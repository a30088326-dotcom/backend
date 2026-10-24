import { repository, type RepositorySession } from '../../storage/repository';
import schemas from '../../storage/entity-schemas.json';
import { tableDefinitions, type EntityName } from '../../storage/table-definitions';
import { ensure, type Context } from './types';
import { moduleAllowed } from './policy';
import { parse } from './store';

const employeeTables = new Set(['attendance_exceptions','attendance_raw_logs','attendance_records','attendance_roster_assignments','earned_leaves','employee_requests','employee_salary_histories','hr_assistant_field_values','hr_performance_reviews','performance_audit_logs','performance_cycle_eligible_employees','performance_development_actions','performance_development_plans','performance_feedback','performance_goals','performance_review_history','performance_reviews','reporting_hierarchy_audit','reporting_relationships']);
const userTables = new Set(['contracts','documents','onboarding_profiles','invites','leave_applications','leave_entitlements','user_module_permissions','hr_assistant_messages','hr_assistant_conversations','hr_assistant_read_updates','hr_performance_notifications']);
type Operation = { table:EntityName; row:any };
async function plan(c:Context, employeeNumber:string, tx:RepositorySession=repository()) {
  const e=c.employees.find(e=>e.employeeNumber.toLowerCase()===employeeNumber.toLowerCase());
  ensure(e&&c.visibleIds.includes(e.id),'Use an exact employee number in your authorized employee scope.');
  ensure(e.id!==c.employeeId&&e.userId!==c.userId&&e.organizationalRank!=='OWNER','The Owner and your current account cannot be deleted.');
  ensure(c.superAdmin||moduleAllowed(c,'employee_information','canDelete'),'Employee Information Delete permission is required.',403);
  const row=await tx.get('employee_information_employees',{id:e.id});ensure(row,'Employee no longer exists.',404);
  ensure(row.organizationalRank!=='OWNER','The Owner account cannot be deleted.');
  const user=e.userId?await tx.get('users',{id:e.userId}):undefined;ensure(user?.role!=='SUPER_ADMIN','The Owner account cannot be deleted.');
  ensure(!(await tx.find('employee_information_employees',r=>r.reportingManagerId===e.id)).length,'Reassign this employee’s direct reports before permanently deleting their manager.');
  if(e.userId)ensure(!(await tx.find('leave_applications',r=>r.approverId===e.userId&&r.applicantId!==e.userId&&r.status.startsWith('PENDING'))).length,'Reassign pending leave approvals before deleting this approver.');
  for(const [table,column,value] of [['documents','candidateId',e.userId],['contracts','candidateId',e.userId],['employee_information_employee_attachments','employeeId',e.id]] as const) if(value)ensure(!(await tx.find(table,r=>r[column]===value)).length,`Permanent deletion is blocked by ${table} records. Their stored documents/signatures need an approved storage cleanup first; no data has been deleted.`);
  const operations:Operation[]=[];
  const add=(table:EntityName,rows:any[])=>rows.forEach(row=>operations.push({table,row}));
  for(const table of Object.keys(tableDefinitions) as EntityName[]) {
    const columns=Object.keys(schemas[table].columns);
    const employeeOwned=(table.startsWith('employee_information_')&&table!=='employee_information_employees')||employeeTables.has(table)||table==='hr_assistant_collection_rows';
    const employeeColumns=employeeOwned?columns.filter(column=>['employeeId','employee_id'].includes(column)):[];
    const userColumns=e.userId&&userTables.has(table)?columns.filter(column=>['userId','user_id','candidateId','applicantId','invitedUserId'].includes(column)):[];
    if(employeeColumns.length||userColumns.length)add(table,await tx.find(table,r=>employeeColumns.some(column=>r[column]===e.id)||userColumns.some(column=>r[column]===e.userId)));
  }
  const children:[EntityName,string,EntityName,string,string|null][]=[['leave_approval_history','leave_application_id','leave_applications','applicantId',e.userId],['performance_goal_checkins','goal_id','performance_goals','employee_id',e.id],['performance_review_answers','review_id','performance_reviews','employee_id',e.id],['performance_360_feedback','review_id','performance_reviews','employee_id',e.id],['hr_performance_notifications','review_id','hr_performance_reviews','employee_id',e.id]];
  for(const [table,column,parent,parentColumn,value] of children)if(value){const ids=new Set((await tx.find(parent,r=>r[parentColumn]===value)).map(r=>r.id));if(ids.size)add(table,await tx.find(table,r=>ids.has(r[column])));}
  add('employee_information_employees',[row]);if(user)add('users',[user]);
  const unique=new Map(operations.map(operation=>[`${operation.table}:${JSON.stringify(repository().store.key(operation.table,operation.row))}`,operation]));
  const counts=new Map<string,number>();for(const operation of unique.values())counts.set(operation.table,(counts.get(operation.table)||0)+1);
  return {e,operations:[...unique.values()],counts:[...counts].sort(([a],[b])=>a.localeCompare(b)).map(([table,count])=>({table,count}))};
}
export async function prepare(c:Context,v:any) {
  const p=await plan(c,v.employeeNumber);
  return {args:{employeeNumber:p.e.employeeNumber,confirmation:v.confirmation},summary:`PERMANENTLY DELETE ${p.e.name} (${p.e.employeeNumber}) and their login. Cannot be undone without a backup. Dependent rows: ${p.counts.map(r=>`${r.table}: ${r.count}`).join('; ')}. A minimal deletion audit receipt is retained.`,before:p.counts};
}
export async function execute(c:Context,v:any) {
  return repository().transaction(async tx=>{
    const p=await plan(c,v.employeeNumber,tx);
    for(const row of await tx.find('hr_performance_reviews',r=>r.employee_id!==p.e.id)) {const data=parse(row.data);ensure(!(data.feedback||[]).some((f:any)=>f.reviewerId===p.e.id)&&!(data.development||[]).some((a:any)=>a.ownerId===p.e.id),'Reassign this employee’s feedback invitations and development actions before deletion.');}
    for(const row of await tx.find('hr_performance_cycles',()=>true)){const data=parse(row.data);if(data.employeeIds?.includes(p.e.id))await tx.replace('hr_performance_cycles',{...row,data:{...data,employeeIds:data.employeeIds.filter((id:string)=>id!==p.e.id)}});}
    for(const {table,row} of p.operations)await tx.remove(table,repository().store.key(table,row),row._version);
    return {message:`${p.e.name} (${p.e.employeeNumber}) and the listed dependent database records were permanently deleted. Login is no longer available. This cannot be undone without a backup.`,recordId:p.e.id};
  });
}

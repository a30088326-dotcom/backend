import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { repository, type RepositorySession } from '../../storage/repository';
import { requireAdmin } from '../../middleware/auth';
import { requireModuleAction } from '../../middleware/module-action';
import { organizationAccess } from '../../shared/services/organization.service';
import { assignRoster, rosterDefault, RosterError, validateRosterShifts, validRosterDate } from './roster.service';
import { nativeRun as run, requiredNative as required, newestNative as newest, parsedArray, pickNative as pick } from './native-http';
const router=Router();
async function lockSetup(tx:RepositorySession){
  const lock=await tx.get('eim_hierarchy_settings',{id:'attendance-setup-lock'});
  if(lock)await tx.replace('eim_hierarchy_settings',{...lock,revision:Number(lock.revision||0)+1});
  else await tx.create('eim_hierarchy_settings',{id:'attendance-setup-lock',revision:1});
}
const shiftFields=['name','description','shiftType','startTime','endTime','crossMidnight','totalHours','minWorkingHours','fullDayHours','halfDayHours','breakDuration','breakType','earliestIn','latestOut','graceLate','graceEarly','overtimeEligible','overtimeStart','weeklyWorkingDays','weeklyOffDays','holidayRule','applicableEmploymentTypes','status'];
function shiftValue(body:any){
  const value=pick(body,shiftFields),start=String(body.startTime||'').slice(0,5),end=String(body.endTime||'').slice(0,5);
  if(![start,end].every(v=>/^([01]\d|2[0-3]):[0-5]\d$/.test(v))||start===end)throw new RosterError(400,'Start and end times must define a valid shift longer than zero hours.');
  const mins=(v:string)=>Number(v.slice(0,2))*60+Number(v.slice(3));
  value.totalHours=Number(body.totalHours)>0?Number(body.totalHours):Number((((mins(end)-mins(start)+1440)%1440)/60).toFixed(2));value.crossMidnight=end<start?1:0;
  for(const key of ['weeklyWorkingDays','weeklyOffDays','applicableEmploymentTypes'])value[key]=JSON.stringify(body[key]||[]);
  value.status=body.status||'Active';return value;
}
router.get('/shifts',run(async(req:any,res:any)=>{const rows=await repository().find('attendance_shifts',r=>req.query.includeArchived==='true'||r.status!=='Archived');res.json({success:true,data:rows.sort(newest).map(r=>({...r,weeklyWorkingDays:parsedArray(r.weeklyWorkingDays),weeklyOffDays:parsedArray(r.weeklyOffDays),applicableEmploymentTypes:parsedArray(r.applicableEmploymentTypes)}))});}));
router.post('/shifts',requireModuleAction('attendance_management','canCreate',true),run(async(req:any,res:any)=>{
  const code=String(req.body.code||'').trim();if(!code||!String(req.body.name||'').trim())throw new RosterError(400,'Shift code and name are required.');
  const data=await repository().transaction(async tx=>{await lockSetup(tx);const existing=await tx.find('attendance_shifts',r=>String(r.code).trim().toLowerCase()===code.toLowerCase()&&r.status!=='Archived');if(existing.length&&req.body.allowDuplicateCode!==true)throw new RosterError(400,'Shift code already exists');if(!existing.length&&req.body.allowDuplicateCode===true)throw new RosterError(400,'The shift group does not exist.');return tx.create('attendance_shifts',{id:randomUUID(),code,...shiftValue(req.body)});});res.status(201).json({success:true,message:'Shift created successfully',data});
}));
router.put('/shifts/:id',requireAdmin,run(async(req:any,res:any)=>{await repository().transaction(async tx=>{const old=await required(tx,'attendance_shifts',req.params.id);if(old.status==='Archived')throw new RosterError(404,'Shift not found or already deleted.');await tx.replace('attendance_shifts',{...old,...shiftValue({...old,...req.body})});});res.json({success:true,message:'Shift updated successfully'});}));
router.delete('/shifts/:id',requireAdmin,run(async(req:any,res:any)=>{
  if(req.query.scope!=null&&req.query.scope!=='code')throw new RosterError(400,'Invalid shift deletion scope.');
  await repository().transaction(async tx=>{const old=await required(tx,'attendance_shifts',req.params.id);const rows=req.query.scope==='code'?await tx.find('attendance_shifts',r=>String(r.code).trim().toLowerCase()===String(old.code).trim().toLowerCase()&&r.status!=='Archived'):[old];for(const row of rows)await tx.replace('attendance_shifts',{...row,status:'Archived'});});res.json({success:true,message:'Shift deleted. Existing rosters and attendance history have been preserved.'});
}));
export async function rosterViewNative(id?:string){
  const repo=repository(),[groups,maps,shifts,calendar,assignments,employees]=await Promise.all([repo.find('attendance_roster_groups',r=>!id||r.id===id),repo.find('attendance_roster_group_shifts',r=>!id||r.groupId===id||r.rosterGroupId===id),repo.find('attendance_shifts',()=>true),repo.find('attendance_roster_calendars',r=>!id||r.rosterGroupId===id),repo.find('attendance_roster_assignments',r=>r.status==='Active'),repo.find('employee_information_employees',()=>true)]);
  return groups.sort(newest).map(g=>({...g,applicableEmploymentTypes:parsedArray(g.applicableEmploymentTypes),employeeCount:new Set(assignments.filter(a=>(a.groupId===g.id||a.rosterGroupId===g.id)&&employees.some(e=>e.id===a.employeeId)).map(a=>a.employeeId)).size,
    shifts:maps.filter(m=>m.groupId===g.id||m.rosterGroupId===g.id).sort((a,b)=>Number(a.displayOrder)-Number(b.displayOrder)).flatMap(m=>{const s=shifts.find(s=>s.id===m.shiftId);return s?[{...s,isDefault:m.isDefault,displayOrder:m.displayOrder}]:[];}),calendarAssignments:calendar.filter(c=>c.rosterGroupId===g.id).map(c=>({...c,date:String(c.date).slice(0,10)})).sort((a,b)=>a.date.localeCompare(b.date))}));
}
router.get('/roster-groups',run(async(_req:any,res:any)=>res.json({success:true,data:await rosterViewNative()})));
const groupFields=['name','description','departmentId','branchId','effectiveStartDate','effectiveEndDate','rosterCycle','applicableEmploymentTypes','minRestHours','maxConsecutiveDays','maxWeeklyHours','lockPeriod','status'];
for(const method of ['post','put'] as const)router[method]('/roster-groups'+(method==='put'?'/:id':''),requireAdmin,run(async(req:any,res:any)=>{
  const updating=method==='put',id=updating?req.params.id:randomUUID(),body=req.body;
  await repository().transaction(async tx=>{
    const old=updating?await required(tx,'attendance_roster_groups',id):null;
    if(!String(body.name||'').trim())throw new RosterError(400,'Enter a roster name.');
    const current=await tx.find('attendance_roster_group_shifts',r=>r.groupId===id||r.rosterGroupId===id),shifts=body.shifts||current;
    await validateRosterShifts(tx,shifts,body.calendarAssignments,current.map(m=>String(m.shiftId)));
    const saved=await tx.find('attendance_roster_calendars',r=>r.rosterGroupId===id),changed=new Set((body.calendarAssignments||[]).map((a:any)=>a.date));
    if(saved.some(a=>!a.isOffDay&&!changed.has(a.date)&&!shifts.some((s:any)=>s.shiftId===a.shiftId)))throw new RosterError(400,'Keep shifts used by saved calendar dates, or update those dates first.');
    const value={...pick(body,groupFields),name:String(body.name).trim(),applicableEmploymentTypes:JSON.stringify(body.applicableEmploymentTypes||[]),description:body.description||null,departmentId:body.departmentId||null,branchId:body.branchId||null,effectiveStartDate:body.effectiveStartDate||null,effectiveEndDate:body.effectiveEndDate||null,rosterCycle:body.rosterCycle||'Monthly',minRestHours:body.minRestHours??8,maxConsecutiveDays:body.maxConsecutiveDays??6,maxWeeklyHours:body.maxWeeklyHours??48,lockPeriod:body.lockPeriod??null,status:body.status||'Draft'};
    if(old)await tx.replace('attendance_roster_groups',{...old,...value});else await tx.create('attendance_roster_groups',{id,code:String(body.code||'').trim()||`RST-${id.slice(0,8).toUpperCase()}`,...value});
    if(body.shifts||!old){for(const row of current)await tx.remove('attendance_roster_group_shifts',{id:row.id},row._version);for(const row of shifts)await tx.create('attendance_roster_group_shifts',{id:randomUUID(),groupId:id,rosterGroupId:id,shiftId:row.shiftId,isDefault:row.isDefault?1:0,displayOrder:row.displayOrder||0});const defaultShift=shifts.find((s:any)=>s.isDefault);for(const row of await tx.find('attendance_roster_assignments',r=>(r.groupId===id||r.rosterGroupId===id)&&r.status==='Active'))await tx.replace('attendance_roster_assignments',{...row,shiftId:defaultShift.shiftId,groupId:id,rosterGroupId:id});}
    for(const day of body.calendarAssignments||[]){const existing=saved.find(r=>r.date===day.date);if(existing)await tx.remove('attendance_roster_calendars',{id:existing.id},existing._version);if(!day.clear)await tx.create('attendance_roster_calendars',{id:randomUUID(),rosterGroupId:id,date:day.date,shiftId:day.isOffDay?null:day.shiftId,isOffDay:day.isOffDay?1:0});}
  });res.status(updating?200:201).json({success:true,message:updating?'Roster updated successfully':'Roster created successfully',data:{id}});
}));
router.delete('/roster-groups/:id',requireAdmin,run(async(req:any,res:any)=>{
  const data=await repository().transaction(async tx=>{const id=req.params.id,old=await required(tx,'attendance_roster_groups',id),assignments=await tx.find('attendance_roster_assignments',r=>r.groupId===id||r.rosterGroupId===id);for(const row of assignments)await tx.remove('attendance_roster_assignments',{id:row.id},row._version);for(const entity of ['attendance_roster_calendars','attendance_roster_group_shifts']as const)for(const row of await tx.find(entity,r=>r.rosterGroupId===id||r.groupId===id))await tx.remove(entity,{id:row.id},row._version);await tx.remove('attendance_roster_groups',{id},old._version);return {id,removedAssignments:assignments.length,affectedEmployees:new Set(assignments.map(a=>a.employeeId)).size};});res.json({success:true,message:'Roster deleted with its assignments and mappings. Shared shifts and attendance history preserved.',data});
}));
router.get('/assignments',run(async(req:any,res:any)=>{const access=await organizationAccess(req.user.userId),[rows,groups]=await Promise.all([repository().find('attendance_roster_assignments',r=>access.visibleIds.includes(r.employeeId)),repository().find('attendance_roster_groups',()=>true)]);res.json({success:true,data:rows.sort(newest).flatMap(r=>{const employee=access.employees.find(e=>e.id===r.employeeId),group=groups.find(g=>g.id===(r.groupId||r.rosterGroupId));return employee&&group?[{...r,assignedRosterId:group.id,employeeNo:employee.employeeNumber,employeeName:employee.name,groupName:group.name}]:[];})});}));
router.post('/assignments',requireModuleAction('attendance_management','canCreate',true),run(async(req:any,res:any)=>{
  const {employeeIds,departmentId,groupId,effectiveStartDate:start,effectiveEndDate:end}=req.body,byDepartment=departmentId!=null;
  if(typeof groupId!=='string'||!validRosterDate(start)||(end&&(!validRosterDate(end)||end<start))||(byDepartment?(typeof departmentId!=='string'||!departmentId||employeeIds!=null):(!Array.isArray(employeeIds)||!employeeIds.length||employeeIds.some(id=>typeof id!=='string'||!id)||new Set(employeeIds).size!==employeeIds.length)))throw new RosterError(400,'Missing required assignment fields');
  const access=await organizationAccess(req.user.userId);
  const data=await repository().transaction(async tx=>{await rosterDefault(tx,groupId);let targetIds:string[]=employeeIds||[],departmentName;
    if(byDepartment){const department=await required(tx,'eim_structures',departmentId);if(department.structureType!=='Department'||department.isActive===0||(department.status||'Active')!=='Active')throw new RosterError(400,'Select an active department.');departmentName=department.name;const workstations=await tx.find('employee_information_workstation_details',()=>true);targetIds=(await tx.find('employee_information_employees',e=>e.status==='Active'&&e.isActive!==0&&(workstations.find(w=>w.employeeId===e.id)?.departmentId||e.departmentId)===departmentId)).map(e=>e.id);if(!targetIds.length)throw new RosterError(400,'No active employees are assigned to this department.');}
    if(targetIds.some(id=>!access.visibleIds.includes(id)))throw new RosterError(403,'You need access to every selected employee. No assignments changed.');
    for(const id of [...targetIds].sort())await assignRoster(tx,id,groupId,start,end||null);return {assignedCount:targetIds.length,departmentId:byDepartment?departmentId:null,departmentName};});res.status(201).json({success:true,message:'Roster assigned successfully',data});
}));
export default router;

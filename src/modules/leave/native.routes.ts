import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { repository, type RepositorySession } from '../../storage/repository';
import type { EntityName } from '../../storage/table-definitions';
import { requireAuth, requireAdmin } from '../../middleware/auth';
import { generateEntitlements, getEntitlementsReport } from './leave.controller';
import { RosterError, validRosterDate } from '../attendance/roster.service';

const router=Router();
router.use(requireAuth);
const run=(fn:any)=>async(req:any,res:any)=>{try{await fn(req,res);}catch(error:any){res.status(error.status||(/conflict|changed|duplicate|exists/i.test(error.message)?409:400)).json({success:false,message:error.message||'Could not save leave configuration.'});}};
async function required(tx:RepositorySession,entity:EntityName,id:string){const row=await tx.get(entity,{id});if(!row)throw new RosterError(404,'Record not found.');return row;}
const pick=(body:any,fields:string[])=>Object.fromEntries(fields.filter(key=>body[key]!==undefined).map(key=>[key,body[key]]));
const num=(value:any,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
const newest=(a:any,b:any)=>String(b.createdAt).localeCompare(String(a.createdAt));
const typeFields=['name','code','category','unit','paymentType','yearlyEntitlement','allowFullDay','allowHalfDays','showReason','requireAttachment','isActive'];
const groupFields=['name','code','employmentType','country','startingMonth','effectiveFrom','effectiveTo','isActive'];
const dayFields=['name','description','type','halfDaySegment','leaveAmount','displayColor','excludeInHolidayAsLeave','workflowStatus'];

router.post('/employee/:id/generate-entitlements',requireAdmin,generateEntitlements);
router.get('/reports/entitlements',requireAdmin,getEntitlementsReport);
router.get('/types',run(async(_req:any,res:any)=>res.json({success:true,data:(await repository().find('leave_types',()=>true)).sort((a,b)=>String(a.name).localeCompare(String(b.name)))})));
router.post('/types',requireAdmin,run(async(req:any,res:any)=>{
  if(!String(req.body.name||'').trim()||!String(req.body.code||'').trim())throw new RosterError(400,'Leave type name and code are required.');
  const data=await repository().create('leave_types',{id:randomUUID(),...pick(req.body,typeFields),yearlyEntitlement:num(req.body.yearlyEntitlement),allowFullDay:req.body.allowFullDay??1,allowHalfDays:req.body.allowHalfDays??1,showReason:req.body.showReason??1,requireAttachment:req.body.requireAttachment??0,isActive:req.body.isActive??1});
  res.status(201).json({success:true,data});
}));
router.put('/types/:id',requireAdmin,run(async(req:any,res:any)=>{const data=await repository().transaction(async tx=>{const old=await required(tx,'leave_types',req.params.id);return tx.replace('leave_types',{...old,...pick(req.body,typeFields),yearlyEntitlement:num(req.body.yearlyEntitlement,old.yearlyEntitlement)});});res.json({success:true,data});}));
router.delete('/types/:id',requireAdmin,run(async(req:any,res:any)=>{
  await repository().transaction(async tx=>{
    const id=req.params.id,old=await required(tx,'leave_types',id);
    const applications=await tx.find('leave_applications',r=>r.leaveTypeId===id);
    for(const app of applications){for(const row of await tx.find('leave_approval_history',r=>r.leave_application_id===app.id))await tx.remove('leave_approval_history',{id:row.id},row._version);await tx.remove('leave_applications',{id:app.id},app._version);}
    for(const entity of ['leave_group_types','leave_entitlements','earned_leaves'] as const)for(const row of await tx.find(entity,r=>r.leaveTypeId===id))await tx.remove(entity,{id:row.id},row._version);
    for(const row of await tx.find('leave_types',r=>r.carriedForwardToLeaveTypeId===id||r.subsequentLeaveTypeNotAllowedId===id))await tx.replace('leave_types',{...row,...(row.carriedForwardToLeaveTypeId===id?{carriedForwardToLeaveTypeId:null}:{}),...(row.subsequentLeaveTypeNotAllowedId===id?{subsequentLeaveTypeNotAllowedId:null}:{})});
    await tx.remove('leave_types',{id},old._version);
  });res.json({success:true,message:'Leave type and its related records deleted.'});
}));
router.get('/groups',run(async(_req:any,res:any)=>{
  const [groups,maps,types]=await Promise.all([repository().find('leave_groups',()=>true),repository().find('leave_group_types',()=>true),repository().find('leave_types',()=>true)]);
  res.json({success:true,data:groups.map(g=>({...g,leaveTypes:maps.filter(m=>m.leaveGroupId===g.id).map(m=>{const type=types.find(t=>t.id===m.leaveTypeId);return {...m,leaveTypeName:type?.name,leaveTypeCode:type?.code,leaveType:{name:type?.name,code:type?.code}};})}))});
}));
async function saveGroup(req:any,update:boolean){return repository().transaction(async tx=>{
  const body=req.body;if(!String(body.name||'').trim()||!String(body.code||'').trim())throw new RosterError(400,'Leave group name and code are required.');
  const old=update?await required(tx,'leave_groups',req.params.id):(await tx.find('leave_groups',r=>r.code===body.code||r.name===body.name))[0];
  const value={...pick(body,groupFields),startingMonth:num(body.startingMonth,1),effectiveFrom:body.effectiveFrom?String(body.effectiveFrom).slice(0,10):null,effectiveTo:body.effectiveTo?String(body.effectiveTo).slice(0,10):null,isActive:body.isActive??1};
  if(value.startingMonth<1||value.startingMonth>12)throw new RosterError(400,'Starting month must be between 1 and 12.');
  return old?tx.replace('leave_groups',{...old,...value}):tx.create('leave_groups',{id:randomUUID(),...value});
});}
router.post('/groups',requireAdmin,run(async(req:any,res:any)=>res.status(201).json({success:true,data:await saveGroup(req,false)})));
router.put('/groups/:id',requireAdmin,run(async(req:any,res:any)=>res.json({success:true,data:await saveGroup(req,true)})));
router.delete('/groups/:id',requireAdmin,run(async(req:any,res:any)=>{await repository().transaction(async tx=>{const old=await required(tx,'leave_groups',req.params.id);for(const row of await tx.find('leave_group_types',r=>r.leaveGroupId===old.id))await tx.remove('leave_group_types',{id:row.id},row._version);for(const row of await tx.find('employee_information_employees',r=>r.leaveGroupId===old.id))await tx.replace('employee_information_employees',{...row,leaveGroupId:null});await tx.remove('leave_groups',{id:old.id},old._version);});res.json({success:true,message:'Leave group deleted.'});}));
router.post('/groups/:id/types',requireAdmin,run(async(req:any,res:any)=>{
  const data=await repository().transaction(async tx=>{await required(tx,'leave_groups',req.params.id);await required(tx,'leave_types',req.body.leaveTypeId);return tx.create('leave_group_types',{id:randomUUID(),leaveGroupId:req.params.id,...pick(req.body,['leaveTypeId','entitlementDays','unit','allocationMethod','allowProration','allowCarryForward','carryForwardLimit','minimumServiceMonths','maximumConsecutiveDays','approvalWorkflow']),entitlementDays:num(req.body.entitlementDays),allowProration:req.body.allowProration??1,allowCarryForward:req.body.allowCarryForward??0,carryForwardLimit:num(req.body.carryForwardLimit),minimumServiceMonths:num(req.body.minimumServiceMonths),maximumConsecutiveDays:req.body.maximumConsecutiveDays?num(req.body.maximumConsecutiveDays):null,approvalWorkflow:req.body.approvalWorkflow||'Manager -> HR'});});res.status(201).json({success:true,data});
}));
router.post('/employee/:employeeId/assign',requireAdmin,run(async(req:any,res:any)=>{
  const groupId=req.body.leaveGroupId||req.body.groupId;
  const {processEntitlementsNative}=await import('./entitlements.native');
  const data=await repository().transaction(async tx=>{const employee=await required(tx,'employee_information_employees',req.params.employeeId);await required(tx,'leave_groups',groupId);await tx.replace('employee_information_employees',{...employee,leaveGroupId:groupId});return processEntitlementsNative(req.params.employeeId,tx);});
  res.json({success:true,message:'Leave group assigned and balances calculated.',data});
}));

router.get('/day-types',requireAdmin,run(async(_req:any,res:any)=>res.json({success:true,data:(await repository().find('daytype',()=>true)).sort(newest)})));
for(const method of ['post','put'] as const)router[method]('/day-types'+(method==='put'?'/:id':''),requireAdmin,run(async(req:any,res:any)=>{
  if(!String(req.body.name||'').trim())throw new RosterError(400,'Day type name is required.');
  const data=await repository().transaction(async tx=>{const body={...pick(req.body,dayFields),halfDaySegment:req.body.halfDaySegment||null,leaveAmount:num(req.body.leaveAmount),excludeInHolidayAsLeave:req.body.excludeInHolidayAsLeave?1:0,workflowStatus:req.body.workflowStatus||'PENDING'};return method==='put'?tx.replace('daytype',{...await required(tx,'daytype',req.params.id),...body}):tx.create('daytype',{id:randomUUID(),...body});});res.status(method==='post'?201:200).json({success:true,data});
}));
router.delete('/day-types/:id',requireAdmin,run(async(req:any,res:any)=>{await repository().transaction(async tx=>{const old=await required(tx,'daytype',req.params.id);if((await tx.find('calendarday',r=>r.dayTypeId===old.id)).length)throw new RosterError(409,'This day type is used by saved calendar dates. Change those dates first.');await tx.remove('daytype',{id:old.id},old._version);});res.json({success:true,message:'Day type deleted.'});}));
router.get('/calendar-groups',requireAdmin,run(async(_req:any,res:any)=>res.json({success:true,data:(await repository().find('calendargroup',()=>true)).sort(newest)})));
for(const method of ['post','put'] as const)router[method]('/calendar-groups'+(method==='put'?'/:id':''),requireAdmin,run(async(req:any,res:any)=>{
  if(!String(req.body.displayName||'').trim())throw new RosterError(400,'Calendar group display name is required.');
  const data=await repository().transaction(async tx=>{const old=method==='put'?await required(tx,'calendargroup',req.params.id):null;if(req.body.isCompanyCalendar)for(const other of await tx.find('calendargroup',r=>!!r.isCompanyCalendar&&r.id!==old?.id))await tx.replace('calendargroup',{...other,isCompanyCalendar:0});const body={displayName:req.body.displayName,description:req.body.description||null,isCompanyCalendar:req.body.isCompanyCalendar?1:0,weekendConfiguration:req.body.weekendConfiguration?JSON.stringify(req.body.weekendConfiguration):null};return old?tx.replace('calendargroup',{...old,...body}):tx.create('calendargroup',{id:randomUUID(),...body});});res.status(method==='post'?201:200).json({success:true,data});
}));
router.delete('/calendar-groups/:id',requireAdmin,run(async(req:any,res:any)=>{await repository().transaction(async tx=>{const old=await required(tx,'calendargroup',req.params.id);if((await tx.find('holidaycalendar',r=>r.calendarGroupId===old.id)).length)throw new RosterError(409,'This group has a saved holiday calendar. Remove or reassign its dates before deleting it.');await tx.remove('calendargroup',{id:old.id},old._version);});res.json({success:true,message:'Calendar group deleted.'});}));
async function calendarView(calendar:any){if(!calendar)return null;const [days,types]=await Promise.all([repository().find('calendarday',r=>r.holidayCalendarId===calendar.id&&(calendar.activeRevision?r.revision===calendar.activeRevision:!r.revision)),repository().find('daytype',()=>true)]);return {...calendar,days:days.map(day=>({...day,holidayCalendarId:calendar.id,dayType:types.find(type=>type.id===day.dayTypeId)}))};}
router.get('/holiday-calendar/:year/:groupId',requireAdmin,run(async(req:any,res:any)=>{const calendar=(await repository().find('holidaycalendar',r=>Number(r.year)===Number(req.params.year)&&r.calendarGroupId===req.params.groupId))[0];res.json({success:true,data:await calendarView(calendar)});}));
router.post('/holiday-calendar',requireAdmin,run(async(req:any,res:any)=>{
  const year=Number(req.body.year),groupId=req.body.calendarGroupId,days=req.body.days;
  if(!Number.isInteger(year)||year<1900||year>2100||!Array.isArray(days)||days.length>366||new Set(days.map((d:any)=>d.date)).size!==days.length||days.some((d:any)=>!validRosterDate(String(d.date).slice(0,10))||!String(d.date).startsWith(year+'-')))throw new RosterError(400,'Supply a valid year and unique calendar dates within that year.');
  const repo=repository(),group=await repo.get('calendargroup',{id:groupId});if(!group)throw new RosterError(400,'Select a valid calendar group.');
  const types=await repo.find('daytype',()=>true);if(days.some((d:any)=>!types.some(t=>t.id===d.dayTypeId)))throw new RosterError(400,'Select a valid day type for each date.');
  const old=(await repo.find('holidaycalendar',r=>Number(r.year)===year&&r.calendarGroupId===groupId))[0],revision=randomUUID(),calendarId=old?.id||randomUUID(),created:any[]=[];let published=false;
  try {
    // Stage a complete year in bounded transactions. Readers only see the revision after one atomic parent switch.
    for(let start=0;start<days.length;start+=80)created.push(...await repo.transaction(async tx=>{const rows=[];for(const day of days.slice(start,start+80))rows.push(await tx.create('calendarday',{id:randomUUID(),date:String(day.date).slice(0,10),holidayCalendarId:calendarId,revision,dayTypeId:day.dayTypeId}));return rows;}));
    const calendar=await repo.transaction(async tx=>{const currentGroup=await required(tx,'calendargroup',groupId);await tx.replace('calendargroup',{...currentGroup});if(old){const current=await required(tx,'holidaycalendar',old.id);if(current._version!==old._version)throw new RosterError(409,'Calendar changed during editing. Reload before saving.');return tx.replace('holidaycalendar',{...current,activeRevision:revision});}return tx.create('holidaycalendar',{id:calendarId,year,calendarGroupId:groupId,activeRevision:revision});});published=true;
    // A cleanup failure cannot turn an already published save into a false failure.
    if(old)for(const obsolete of await repo.find('calendarday',r=>r.holidayCalendarId===old.id&&(old.activeRevision?r.revision===old.activeRevision:!r.revision)))await repo.remove('calendarday',{id:obsolete.id},obsolete._version).catch(()=>{console.warn('Obsolete holiday calendar revision retained for cleanup.');});
    res.json({success:true,data:await calendarView(calendar)});
  }catch(error){if(!published)for(const row of created)await repo.remove('calendarday',{id:row.id},row._version);throw error;}
}));
export default router;

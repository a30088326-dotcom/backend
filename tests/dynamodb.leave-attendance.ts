import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { once } from 'node:events';
import { memory } from './dynamodb.domain-memory';
import { withRepositoryForTests } from '../src/storage/repository';
import { db } from '../src/lib/db';
import { generateToken } from '../src/middleware/auth';
import { processEntitlementsNative } from '../src/modules/leave/entitlements.native';
import { LeaveRulesEvaluator } from '../src/modules/leave-management/services/leaveRulesEvaluator';
import { evaluateLeaveRule, compileLeaveRule } from '../src/modules/leave-management/services/restricted-rule';
import { submitLeave, decideLeave, cancelLeave } from '../src/modules/leave-management/services/application.service';
import { assignRoster } from '../src/modules/attendance/roster.service';
import { shiftForDate, calculateAttendance } from '../src/modules/attendance/calculation.service';

process.env.NODE_ENV='test';process.env.DATABASE_PROVIDER='dynamodb';process.env.JWT_SECRET='native-tests-only-not-a-production-secret';
(db as any).query=async()=>{throw new Error('SQL reached from native runtime');};
(db as any).getConnection=async()=>{throw new Error('SQL connection reached from native runtime');};
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Colombo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const year=Number(today.slice(0,4));
async function fixture(){
  const state=memory(),employeeId=randomUUID(),userId=randomUUID(),managerId=randomUUID(),managerUser=randomUUID(),casualId=randomUUID(),annualId=randomUUID();
  await state.repo.create('users',{id:managerUser,email:'manager@test.invalid',name:'Test Manager',role:'SUPER_ADMIN',isActive:1});
  await state.repo.create('users',{id:userId,email:'employee@test.invalid',name:'Test Employee',role:'EMPLOYEE',isActive:1});
  await state.repo.create('employee_information_employees',{id:managerId,userId:managerUser,employeeNo:'TEST-MANAGER',status:'Active',isActive:1,organizationalRank:'OWNER',firstName:'Test',lastName:'Manager',dateJoined:`${year-2}-01-01`,probationStatus:'Confirmed'});
  await state.repo.create('employee_information_employees',{id:employeeId,userId,employeeNo:'TEST-EMPLOYEE',status:'Active',isActive:1,organizationalRank:'EMPLOYEE',firstName:'Test',lastName:'Employee',reportingManagerId:managerId,dateJoined:`${year}-01-01`,probationStatus:'Probation'});
  await state.repo.create('employee_information_personal_details',{id:randomUUID(),employeeId,gender:'Male'});
  await state.repo.create('leave_types',{id:casualId,code:'CL',name:'Casual',isActive:1,allowHalfDays:1});
  await state.repo.create('leave_types',{id:annualId,code:'AL',name:'Annual',isActive:1,allowHalfDays:1});
  return {...state,employeeId,userId,managerId,managerUser,casualId,annualId};
}
async function http(state:Awaited<ReturnType<typeof fixture>>,work:(request:(userId:string,path:string,body?:any,method?:string)=>Promise<{status:number;body:any}>)=>Promise<void>){
  const app=express();app.use(express.json());
  app.use((req,res,next)=>{void withRepositoryForTests(state.repo,async()=>next());});
  app.use('/api/leaves',(await import('../src/modules/leave-management/routes/index')).default);
  app.use('/api/leave-management',(await import('../src/modules/leave/leave.routes')).default);
  app.use('/api/attendance',(await import('../src/modules/attendance/attendance.routes')).default);
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');const port=(server.address() as any).port;
  const request=async(userId:string,path:string,body?:any,method=body?'POST':'GET')=>{
    const user=await state.repo.get('users',{id:userId});
    const response=await fetch(`http://127.0.0.1:${port}${path}`,{method,headers:{Authorization:`Bearer ${generateToken({userId,email:user!.email,role:user!.role})}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    return{status:response.status,body:await response.json()};
  };
  try{await work(request);}finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
}

test('restricted leave rules preserve arithmetic, branching, logging and reject server access/loops/deep expressions',()=>{
  const result=evaluateLeaveRule('const days = Math.min(ServiceMonths, 12) / 2; if (LeaveType === "CL") { output.entitlement = days; } else { output.entitlement = 0; } output.carryForwardAmount=2; console.log("calculated", days);',{ServiceMonths:12,LeaveType:'CL'});
  assert.equal(result.entitlement,6);assert.equal(result.carryForwardAmount,2);assert.deepEqual(result.logs,['calculated 6']);
  for(const script of ['process.exit(0);','output.entitlement=globalThis.process.env.SECRET;','while(true){}','output.entitlement=Function("return process")();','output.entitlement=1/0;','output.entitlement='+ '!'.repeat(100)+'1;'])assert.throws(()=>evaluateLeaveRule(script,{}),/Unsupported leave rule/);
  assert.throws(()=>compileLeaveRule('output.entitlement = '+ '('.repeat(60)+'1'+')'.repeat(60)),/nesting/);
});
test('native standard probation and confirmation rules are atomic and retain used/pending/carry balances',async()=>{
  const state=await fixture();await withRepositoryForTests(state.repo,async()=>{
    let generated=await processEntitlementsNative(state.employeeId);assert.equal(generated.find(r=>r.type==='CL')?.days,6);assert.equal(generated.find(r=>r.type==='AL')?.days,0);
    const cl=(await state.repo.find('leave_entitlements',r=>r.userId===state.userId&&r.leaveTypeId===state.casualId))[0];await state.repo.replace('leave_entitlements',{...cl,usedDays:1,pendingDays:0.5,carryForwardDays:2});
    await state.repo.transaction(async tx=>{const e=(await tx.get('employee_information_employees',{id:state.employeeId}))!;await tx.replace('employee_information_employees',{...e,probationStatus:'Confirmed'});generated=await processEntitlementsNative(state.employeeId,tx,{assumeConfirmed:true});});
    const saved=(await state.repo.find('leave_entitlements',r=>r.id===cl.id))[0];assert.equal(saved.totalDays,7);assert.equal(saved.usedDays,1);assert.equal(saved.pendingDays,0.5);assert.equal(saved.carryForwardDays,2);
    assert.equal((await LeaveRulesEvaluator.evaluate({employeeId:state.employeeId,leaveTypeId:state.annualId,leaveYear:year+1})).entitlement,14);
    const before=(await state.repo.get('employee_information_employees',{id:state.employeeId}))!;
    await state.repo.create('leave_rule_scripts',{id:randomUUID(),name:'Casual_Sri_Lanka',content:'process.exit(0);output.entitlement=20;',isDefault:0});
    await assert.rejects(state.repo.transaction(async tx=>{const e=(await tx.get('employee_information_employees',{id:state.employeeId}))!;await tx.replace('employee_information_employees',{...e,probationStatus:'Probation'});await processEntitlementsNative(state.employeeId,tx);}),/Unsupported leave rule/);
    assert.equal((await state.repo.get('employee_information_employees',{id:state.employeeId}))?._version,before._version);
  });
});
test('native leave submit/approve/cancel saves balances and immutable history and rejects duplicate approvals/self approval',async()=>{
  const state=await fixture();await withRepositoryForTests(state.repo,async()=>{
    await processEntitlementsNative(state.employeeId);
    const request={leaveTypeId:state.casualId,startDate:today,endDate:today,totalDays:1,reason:'Native leave test'};
    const app=await submitLeave({userId:state.userId,role:'EMPLOYEE'},request);
    let cl=(await state.repo.find('leave_entitlements',r=>r.userId===state.userId&&r.leaveTypeId===state.casualId))[0];assert.equal(cl.pendingDays,1);
    await assert.rejects(decideLeave({userId:state.userId,role:'EMPLOYEE'},app.id,'APPROVED'),/own request/);
    await decideLeave({userId:state.managerUser,role:'SUPER_ADMIN'},app.id,'APPROVED');
    cl=(await state.repo.find('leave_entitlements',r=>r.id===cl.id))[0];assert.equal(cl.pendingDays,0);assert.equal(cl.usedDays,1);
    await assert.rejects(decideLeave({userId:state.managerUser,role:'SUPER_ADMIN'},app.id,'APPROVED'),/already been actioned/);
    await cancelLeave(state.userId,app.id,'Testing restoration');cl=(await state.repo.find('leave_entitlements',r=>r.id===cl.id))[0];assert.equal(cl.usedDays,0);assert.equal((await state.repo.find('leave_approval_history',r=>r.leave_application_id===app.id)).length,2);
  });
});
test('native concurrent overlapping requests serialize across leave types with no partial balance reservations',async()=>{
  const state=await fixture();await withRepositoryForTests(state.repo,async()=>{
    const e=(await state.repo.get('employee_information_employees',{id:state.employeeId}))!;await state.repo.replace('employee_information_employees',{...e,probationStatus:'Confirmed',dateJoined:`${year-2}-01-01`});await processEntitlementsNative(state.employeeId);
    const outcomes=await Promise.allSettled([state.casualId,state.annualId].map(leaveTypeId=>submitLeave({userId:state.userId,role:'EMPLOYEE'},{leaveTypeId,startDate:today,endDate:today,totalDays:1})));
    assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal((await state.repo.find('leave_applications',()=>true)).length,1);assert.equal((await state.repo.find('leave_entitlements',r=>r.userId===state.userId)).reduce((sum,r)=>sum+Number(r.pendingDays),0),1);
  });
});
test('native leave HTTP routes enforce scopes and expose saved data, rules validation and team history without SQL',async()=>{
  const state=await fixture();await withRepositoryForTests(state.repo,async()=>{await processEntitlementsNative(state.employeeId);});
  await http(state,async request=>{
    for(const path of ['/api/leaves/types','/api/leaves/years','/api/leaves/holidays','/api/leaves/entitlements','/api/leaves/applications','/api/leaves/covering-employees'])assert.equal((await request(state.userId,path)).status,200,path);
    assert.equal((await request(state.userId,'/api/leaves/ceo/applications')).status,403);
    assert.equal((await request(state.managerUser,'/api/leaves/rules/scripts',{name:'Unsafe test',content:'process.exit(0)'})).status,400);
    const applied=await request(state.userId,'/api/leaves/applications',{leaveTypeId:state.casualId,startDate:today,endDate:today,totalDays:1});assert.equal(applied.status,201);const id=applied.body.data.id;
    const dashboard=await request(state.managerUser,'/api/leaves/team/dashboard');assert.equal(dashboard.status,200);assert.equal(dashboard.body.data.pendingApprovals[0].id,id);
    assert.equal((await request(state.managerUser,`/api/leaves/applications/${id}/approve`,{action:'APPROVED'},'PATCH')).status,200);
    const history=await request(state.userId,`/api/leaves/applications/${id}/history`);assert.equal(history.status,200);assert.deepEqual(history.body.data.map((r:any)=>r.action),['SUBMITTED','APPROVED']);
  });
});
test('native shift/roster setup maps employee dates, archives preserve history, dashboard and punch permissions stay scoped',async()=>{
  const state=await fixture();await http(state,async request=>{
    const shift=await request(state.managerUser,'/api/attendance/shifts',{name:'Day shift',code:'NATIVE-DAY',startTime:'09:00',endTime:'18:00',breakDuration:1,breakType:'Unpaid',fullDayHours:8});assert.equal(shift.status,201);
    const shiftId=shift.body.data.id;
    const roster=await request(state.managerUser,'/api/attendance/roster-groups',{name:'Native roster',code:'NATIVE-ROSTER',status:'Active',shifts:[{shiftId,isDefault:true}]});assert.equal(roster.status,201);const groupId=roster.body.data.id;
    assert.equal((await request(state.managerUser,'/api/attendance/assignments',{groupId,employeeIds:[state.employeeId],effectiveStartDate:today})).status,201);
    assert.equal((await request(state.userId,'/api/attendance/my-shift')).body.data.id,groupId);
    assert.equal((await request(state.userId,'/api/attendance/my-attendance/manual',{date:today,inTime:'09:00',outTime:'18:00'})).status,403);
    assert.equal((await request(state.userId,'/api/attendance/dashboard')).status,200);
    assert.equal((await request(state.userId,'/api/attendance/punch',{logType:'In'})).status,200);
    assert.ok([400,409].includes((await request(state.userId,'/api/attendance/punch',{logType:'In'})).status));
    assert.equal((await request(state.userId,'/api/attendance/records')).body.data.length,1);
    assert.equal((await request(state.managerUser,`/api/attendance/shifts/${shiftId}`,undefined,'DELETE')).status,200);
    assert.equal((await request(state.userId,'/api/attendance/my-shift')).body.data.shifts[0].id,shiftId);
  });
  await withRepositoryForTests(state.repo,async()=>{
    const result=await shiftForDate(state.repo,state.employeeId,today);assert.equal(result.code,'NATIVE-DAY');
    assert.equal(calculateAttendance(today,`${today} 09:00:00`,`${today} 18:00:00`,result).totalHours,8);
    await assert.rejects(state.repo.transaction(tx=>assignRoster(tx,state.employeeId,'missing',today)),/unavailable/);
  });
});
test('native attendance complete In/break/Out flow calculates eight paid working hours and cannot be read by unrelated staff',async t=>{
  const state=await fixture();
  const shiftId=randomUUID(),groupId=randomUUID(),outsider=randomUUID(),outsiderEmployee=randomUUID();
  await state.repo.create('attendance_shifts',{id:shiftId,code:'CLOCK-DAY',name:'Clock Day',startTime:'09:00:00',endTime:'18:00:00',totalHours:9,fullDayHours:8,breakType:'Unpaid',breakDuration:1,status:'Active'});
  await state.repo.create('attendance_roster_groups',{id:groupId,code:'CLOCK-ROSTER',name:'Clock Roster',status:'Active'});
  await state.repo.create('attendance_roster_group_shifts',{id:randomUUID(),groupId,rosterGroupId:groupId,shiftId,isDefault:1});
  await state.repo.transaction(tx=>assignRoster(tx,state.employeeId,groupId,today));
  await state.repo.create('users',{id:outsider,email:'outsider@test.invalid',name:'Other Staff',role:'EMPLOYEE',isActive:1});
  await state.repo.create('employee_information_employees',{id:outsiderEmployee,userId:outsider,employeeNo:'TEST-OTHER',status:'Active',isActive:1,organizationalRank:'EMPLOYEE'});
  t.mock.timers.enable({apis:['Date'],now:new Date(today+'T03:30:00Z')});
  try{await http(state,async request=>{
    assert.equal((await request(state.userId,'/api/attendance/punch',{logType:'In'})).status,200);
    t.mock.timers.tick(3*3600000);
    assert.equal((await request(state.userId,'/api/attendance/punch',{logType:'BreakIn'})).status,200);
    t.mock.timers.tick(3600000);
    assert.equal((await request(state.userId,'/api/attendance/punch',{logType:'BreakOut'})).status,200);
    t.mock.timers.tick(5*3600000);
    assert.equal((await request(state.userId,'/api/attendance/punch',{logType:'Out'})).status,200);
    const own=await request(state.userId,'/api/attendance/my-attendance/history');assert.equal(own.body.data[0].totalHours,8);assert.equal(own.body.data[0].regularHours,8);assert.equal(own.body.data[0].lateMinutes,0);
    const other=await request(outsider,'/api/attendance/records');assert.deepEqual(other.body.data,[]);
    assert.equal((await request(state.userId,'/api/attendance/my-today')).body.data.length,4);
  });}finally{t.mock.timers.reset();}
});
test('native concurrent first shift groups cannot bypass code uniqueness',async()=>{
  const state=await fixture();await http(state,async request=>{
    const results=await Promise.all([1,2].map(n=>request(state.managerUser,'/api/attendance/shifts',{name:'Concurrent shift '+n,code:'ONE-CODE',startTime:'09:00',endTime:'18:00'})));
    assert.equal(results.filter(r=>r.status===201).length,1);assert.equal((await state.repo.find('attendance_shifts',r=>r.code==='ONE-CODE')).length,1);
    const version=await request(state.managerUser,'/api/attendance/shifts',{name:'Intentional version',code:'ONE-CODE',startTime:'10:00',endTime:'19:00',allowDuplicateCode:true});assert.equal(version.status,201);
  });
});
test('native yearly calendar publishes all dates together, retains parent mappings, and validates referenced day types',async()=>{
  const state=await fixture();await http(state,async request=>{
    const group=await request(state.managerUser,'/api/leave-management/calendar-groups',{displayName:'Test Company Calendar',isCompanyCalendar:true,weekendConfiguration:{Saturday:true,Sunday:true}});assert.equal(group.status,201);
    const type=await request(state.managerUser,'/api/leave-management/day-types',{name:'Working Day',type:'WORKING_DAY',leaveAmount:1,displayColor:'#000000'});assert.equal(type.status,201);
    const days=Array.from({length:365},(_,index)=>{const date=new Date(`${year}-01-01T00:00:00Z`);date.setUTCDate(date.getUTCDate()+index);return{date:date.toISOString().slice(0,10),dayTypeId:type.body.data.id};});
    const saved=await request(state.managerUser,'/api/leave-management/holiday-calendar',{year,calendarGroupId:group.body.data.id,days});assert.equal(saved.status,200);assert.equal(saved.body.data.days.length,365);
    const loaded=await request(state.managerUser,`/api/leave-management/holiday-calendar/${year}/${group.body.data.id}`);assert.equal(loaded.body.data.days.length,365);
    const physical=await state.repo.find('calendarday',()=>true);assert.ok(physical.every(r=>r.holidayCalendarId===saved.body.data.id));
    const changed=await request(state.managerUser,'/api/leave-management/holiday-calendar',{year,calendarGroupId:group.body.data.id,days:days.slice(0,2)});assert.equal(changed.status,200);assert.equal(changed.body.data.days.length,2);assert.equal((await state.repo.find('calendarday',()=>true)).length,2);
    assert.equal((await request(state.managerUser,`/api/leave-management/day-types/${type.body.data.id}`,undefined,'DELETE')).status,409);
    assert.equal((await request(state.userId,'/api/leaves/holidays?year='+year)).body.data.holidays.length,2);
  });
});
test('native missed-punch approval creates mapped attendance atomically and rejects self resolution and duplicate actions',async()=>{
  const state=await fixture();await http(state,async request=>{
    const submitted=await request(state.userId,'/api/attendance/exceptions/missed-punch',{date:today,inTime:'09:00',outTime:'18:00',reason:'Forgot punch during native test'});assert.equal(submitted.status,201);
    const own=await request(state.userId,'/api/attendance/my-exceptions');assert.equal(own.body.data.length,1);const id=own.body.data[0].id;
    assert.equal((await request(state.userId,`/api/attendance/exceptions/${id}/resolve`,{status:'APPROVED'})).status,403);
    const team=await request(state.managerUser,'/api/attendance/team-exceptions');assert.equal(team.body.data[0].id,id);
    assert.equal((await request(state.managerUser,`/api/attendance/exceptions/${id}/resolve`,{status:'APPROVED',resolutionNotes:'Verified'})).status,200);
    const saved=await state.repo.get('attendance_exceptions',{id});assert.equal(saved?.status,'APPROVED');assert.equal(saved?.resolvedBy,state.managerId);
    const record=await state.repo.get('attendance_records',{id:saved?.recordId});assert.equal(record?.employeeId,state.employeeId);assert.equal(record?.date,today);assert.equal(record?.totalHours,9);assert.equal(record?.isException,1);
    assert.equal((await request(state.managerUser,`/api/attendance/exceptions/${id}/resolve`,{status:'APPROVED'})).status,404);
    assert.equal((await state.repo.find('attendance_records',()=>true)).length,1);
  });
});

import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import type { RowDataPacket } from 'mysql2/promise';
import { db } from '../src/lib/db';
import router from '../src/modules/attendance/attendance.routes';
import { createShift, deleteShift, getShifts, getMyShift, updateShift, updateRosterGroup } from '../src/modules/attendance/attendance.controller';
import { assignRoster, rosterDefault, RosterError, validateRosterShifts } from '../src/modules/attendance/roster.service';

async function invoke(handler: any, req: any) {
  let status = 200, body: any;
  await handler({ query: {}, ...req }, { status(code: number) { status=code; return this; }, json(data: any) { body=data; return this; } });
  return { status, body };
}

async function main() {
  const deleteRoute = router.stack.find((layer: any) => layer.route?.path === '/shifts/:id' && layer.route.methods.delete);
  assert.ok(deleteRoute, 'DELETE endpoint is registered.');
  let rejected = 0;
  deleteRoute.route.stack[0].handle({ user: { role: 'EMPLOYEE' } }, { status(s: number) { rejected=s; return this; }, json() {} }, () => assert.fail('Unauthorized delete allowed'));
  assert.equal(rejected,403);
  const conn=await db.getConnection();
  const originalQuery=db.query.bind(db), originalConnection=db.getConnection.bind(db);
  const sandbox=new Proxy(conn, { get(target,key) {
    if (['commit','beginTransaction','rollback','release'].includes(String(key))) return async()=>{};
    const value=(target as any)[key]; return typeof value==='function'?value.bind(target):value;
  } });
  const first=randomUUID(), second=randomUUID(), group=randomUUID(), code=`DELETE-TEST-${first.slice(0,8)}`;
  try {
    await conn.beginTransaction();
    (db as any).getConnection=async()=>sandbox;
    (db as any).query=conn.query.bind(conn);
    const [[employee]]=await conn.query<RowDataPacket[]>("SELECT id,userId FROM employee_information_employees WHERE status='Active' AND isActive=1 AND userId IS NOT NULL LIMIT 1");
    assert.ok(employee);
    const [[before]]=await conn.query<RowDataPacket[]>('SELECT COUNT(*) count FROM attendance_records');
    for (const [id,name] of [[first,'Day'],[second,'Night']]) await conn.query(
      "INSERT INTO attendance_shifts (id,code,name,startTime,endTime,totalHours,status) VALUES (?,?,?,'09:00','18:00',9,'Active')", [id,code,name]);
    await conn.query("INSERT INTO attendance_roster_groups (id,code,name,status) VALUES (?,?,?,'Active')", [group,code,'Deletion test roster']);
    await conn.query('INSERT INTO attendance_roster_group_shifts (id,groupId,rosterGroupId,shiftId,isDefault) VALUES (?,?,?,?,1)', [randomUUID(),group,group,first]);
    await conn.query("INSERT INTO attendance_roster_calendars (id,rosterGroupId,date,shiftId,isOffDay) VALUES (?,?,'2026-10-02',?,0)", [randomUUID(),group,first]);
    const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Colombo'});
    await assignRoster(conn,employee.id,group,today);
    const result=await invoke(deleteShift,{params:{id:first},query:{scope:'code'}});
    assert.equal(result.status,200,JSON.stringify(result.body));
    const [remaining]=await conn.query<RowDataPacket[]>('SELECT id,status FROM attendance_shifts WHERE code=?',[code]);
    assert.equal(remaining.length,2,'Both original shift records must remain.');
    assert.ok(remaining.every(r=>r.status==='Archived'),'The whole visible code row is removed.');
    let response=await invoke(getShifts,{});
    assert.equal(response.status,200);assert.ok(!response.body.data.some((s:any)=>s.code===code));
    response=await invoke(getShifts,{query:{includeArchived:'true'}});
    assert.ok(response.body.data.some((s:any)=>s.id===first));
    assert.equal(await rosterDefault(conn,group),first,'Existing default still resolves.');
    response=await invoke(getMyShift,{user:{userId:employee.userId}});
    assert.equal(response.status,200);assert.equal(response.body.data.id,group);
    assert.equal(response.body.data.shifts[0].id,first);
    assert.equal(response.body.data.calendarAssignments[0].shiftId,first);
    await assert.rejects(validateRosterShifts(conn,[{shiftId:first,isDefault:true}],[]),RosterError);
    await validateRosterShifts(conn,[{shiftId:first,isDefault:true}],[],[first]);
    response=await invoke(updateRosterGroup,{params:{id:group},body:{name:'Deletion test roster edited',rosterCycle:'Monthly',minRestHours:8,maxConsecutiveDays:6,status:'Active',shifts:[{shiftId:first,isDefault:true}],calendarAssignments:[]}});
    assert.equal(response.status,200,JSON.stringify(response.body));
    assert.equal((await invoke(updateShift,{params:{id:first},body:{}})).status,404,'Deleted shifts cannot be reactivated accidentally.');
    assert.equal((await invoke(deleteShift,{params:{id:first},query:{scope:'code'}})).status,200,'Retry is safe.');
    assert.equal((await invoke(deleteShift,{params:{id:randomUUID()}})).status,404);
    const third=randomUUID();await conn.query("INSERT INTO attendance_shifts (id,code,name,status) VALUES (?,?,?,'Active')",[third,`SINGLE-${first.slice(0,8)}`,'Single test']);
    assert.equal((await invoke(deleteShift,{params:{id:third}})).status,200);
    response=await invoke(createShift,{body:{code,name:'Replacement shift',startTime:'09:00',endTime:'18:00',status:'Active'}});
    assert.equal(response.status,201,'Deleted codes can be reused without losing old references.');
    const [[after]]=await conn.query<RowDataPacket[]>('SELECT COUNT(*) count FROM attendance_records');assert.equal(after.count,before.count);
    console.log('PASS: DELETE route and admin authorization, grouped/single delete, list refresh, retained shift/roster/calendar/history, stale edit rejection, code reuse. All test changes rolled back.');
  } finally {
    (db as any).query=originalQuery; (db as any).getConnection=originalConnection;
    await conn.rollback();conn.release();
  }
  const [[left]]=await db.query<RowDataPacket[]>('SELECT COUNT(*) count FROM attendance_shifts WHERE code=?',[code]);assert.equal(left.count,0);
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.end());

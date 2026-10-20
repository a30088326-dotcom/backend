import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import type { RowDataPacket } from 'mysql2/promise';
import { db } from '../src/lib/db';
import router from '../src/modules/attendance/attendance.routes';
import { deleteRosterGroup, getRosterGroups, getMyShift, getCalendar, updateRosterGroup } from '../src/modules/attendance/attendance.controller';
import { assignRoster } from '../src/modules/attendance/roster.service';

async function invoke(handler: any, req: any = {}) {
  let status = 200, body: any;
  await handler({ query: {}, ...req }, { status(code: number) { status=code; return this; }, json(data: any) { body=data; return this; } });
  return { status, body };
}

async function main() {
  const route=router.stack.find((layer: any)=>layer.route?.path==='/roster-groups/:id' && layer.route.methods.delete);
  assert.ok(route,'DELETE roster endpoint is registered.');
  for (const role of ['EMPLOYEE','CEO']) {
    let rejected=0;
    route.route.stack[0].handle({user:{role}}, {status(s:number){rejected=s;return this;},json(){}},()=>assert.fail('Reader can delete a roster'));
    assert.equal(rejected,403);
  }
  const conn=await db.getConnection(), originalQuery=db.query.bind(db), originalConnection=db.getConnection.bind(db);
  let failDuringDelete=false;
  const sandbox=new Proxy(conn,{get(target,key) {
    if(key==='beginTransaction') return ()=>target.query('SAVEPOINT roster_delete_test');
    if(key==='commit') return ()=>target.query('RELEASE SAVEPOINT roster_delete_test');
    if(key==='rollback') return ()=>target.query('ROLLBACK TO SAVEPOINT roster_delete_test');
    if(key==='release') return ()=>{};
    if(key==='query') return (sql:any,params:any)=>{
      if(failDuringDelete && String(sql).startsWith('DELETE FROM attendance_roster_group_shifts')) throw new Error('Injected rollback test');
      return target.query(sql,params);
    };
    const value=(target as any)[key];return typeof value==='function'?value.bind(target):value;
  }});
  const roster=randomUUID(), other=randomUUID(), shift=randomUUID();
  const tables=['attendance_roster_groups','attendance_roster_assignments','attendance_roster_calendars','attendance_roster_group_shifts'];
  const count=async(table:string,where='',values:any[]=[])=>{
    const [[row]]=await conn.query<RowDataPacket[]>(`SELECT COUNT(*) count FROM ${table} ${where}`,values);return row.count;
  };
  try {
    await conn.beginTransaction();
    (db as any).query=conn.query.bind(conn);(db as any).getConnection=async()=>sandbox;
    const [employees]=await conn.query<RowDataPacket[]>("SELECT id,userId FROM employee_information_employees WHERE status='Active' AND isActive=1 AND userId IS NOT NULL LIMIT 2");
    assert.equal(employees.length,2);
    const baseline=await Promise.all(['employee_information_employees','attendance_records','attendance_exceptions'].map(t=>count(t)));
    await conn.query("INSERT INTO attendance_shifts (id,code,name,startTime,endTime,totalHours,status) VALUES (?,?,?,'09:00','18:00',9,'Active')",[shift,`RST-DELETE-${shift.slice(0,8)}`,'Shared test shift']);
    for(const id of [roster,other]) {
      await conn.query("INSERT INTO attendance_roster_groups (id,code,name,status) VALUES (?,?,?,'Active')",[id,id,`Test ${id}`]);
      await conn.query('INSERT INTO attendance_roster_group_shifts (id,groupId,rosterGroupId,shiftId,isDefault) VALUES (?,?,?,?,1)',[randomUUID(),id,id,shift]);
      await conn.query("INSERT INTO attendance_roster_calendars (id,rosterGroupId,date,shiftId,isOffDay) VALUES (?,?,'2026-10-02',?,0)",[randomUUID(),id,shift]);
    }
    const [[date]]=await conn.query<RowDataPacket[]>("SELECT DATE_FORMAT(CURRENT_DATE(),'%Y-%m-%d') today");
    await assignRoster(conn,employees[0].id,roster,date.today);
    await assignRoster(conn,employees[1].id,other,date.today);
    // Legacy alias-only and inactive assignments must also disappear, not just current assignments.
    await conn.query("INSERT INTO attendance_roster_assignments (id,employeeId,rosterGroupId,shiftId,status) VALUES (?,?,?,?,'Inactive')",[randomUUID(),employees[0].id,roster,shift]);
    await conn.query("INSERT INTO attendance_roster_assignments (id,employeeId,groupId,shiftId,status) VALUES (?,?,?,?,'Inactive')",[randomUUID(),employees[0].id,roster,shift]);
    const before=await Promise.all(tables.map(t=>count(t)));
    let response=await invoke(getRosterGroups);
    assert.equal(response.status,200);assert.equal(response.body.data.find((g:any)=>g.id===roster).employeeCount,1);
    failDuringDelete=true;
    // Suppress the intentionally injected error only.
    const errorLog=console.error;console.error=()=>{};
    try {response=await invoke(deleteRosterGroup,{params:{id:roster}});} finally {console.error=errorLog;failDuringDelete=false;}
    assert.equal(response.status,500);
    assert.deepEqual(await Promise.all(tables.map(t=>count(t))),before,'Failure restores every removed relationship.');
    response=await invoke(deleteRosterGroup,{params:{id:roster}});
    assert.equal(response.status,200,JSON.stringify(response.body));assert.equal(response.body.data.removedAssignments,3);
    assert.equal(await count('attendance_roster_groups','WHERE id=?',[roster]),0);
    assert.equal(await count('attendance_roster_assignments','WHERE groupId=? OR rosterGroupId=?',[roster,roster]),0);
    assert.equal(await count('attendance_roster_group_shifts','WHERE groupId=? OR rosterGroupId=?',[roster,roster]),0);
    assert.equal(await count('attendance_roster_calendars','WHERE rosterGroupId=?',[roster]),0);
    assert.equal(await count('attendance_shifts','WHERE id=?',[shift]),1,'Shared shift is preserved.');
    response=await invoke(getRosterGroups);assert.ok(!response.body.data.some((g:any)=>g.id===roster));assert.ok(response.body.data.some((g:any)=>g.id===other));
    response=await invoke(getCalendar);assert.ok(!response.body.data.some((c:any)=>c.rosterGroupId===roster));
    response=await invoke(getMyShift,{user:{userId:employees[0].userId}});assert.equal(response.status,200);assert.equal(response.body.data,null,'Deleted roster is removed from employee self-service.');
    response=await invoke(getMyShift,{user:{userId:employees[1].userId}});assert.equal(response.body.data.id,other);assert.equal(response.body.data.shifts[0].id,shift);
    assert.deepEqual(await Promise.all(['employee_information_employees','attendance_records','attendance_exceptions'].map(t=>count(t))),baseline,'Employee and attendance records unchanged.');
    response=await invoke(deleteRosterGroup,{params:{id:roster}});assert.equal(response.status,404);
    response=await invoke(updateRosterGroup,{params:{id:roster},body:{name:'Stale edit'}});assert.equal(response.status,404,'Deleted roster cannot be restored by stale edits.');
    await conn.query('SAVEPOINT stale_assignment');
    await assert.rejects(assignRoster(conn,employees[0].id,roster,date.today),/Selected roster is unavailable/);
    await conn.query('ROLLBACK TO SAVEPOINT stale_assignment');
    console.log('PASS: admin-only roster deletion, employee/calendar/shift-link cleanup, legacy aliases, rollback on failure, employee self-service cleared, other rosters/shared shifts/history retained, stale edit/assignment rejected. All test data rolled back.');
  } finally {
    (db as any).query=originalQuery;(db as any).getConnection=originalConnection;
    await conn.rollback();conn.release();
  }
  const [[left]]=await db.query<RowDataPacket[]>('SELECT COUNT(*) count FROM attendance_roster_groups WHERE id IN (?,?)',[roster,other]);assert.equal(left.count,0);
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.end());

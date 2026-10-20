import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import type { RowDataPacket } from 'mysql2/promise';
import { db } from '../src/lib/db';
import { assignEmployees, getMyShift } from '../src/modules/attendance/attendance.controller';

async function invoke(handler: any, req: any) {
  let status=200,body:any;
  await handler(req,{status(code:number){status=code;return this;},json(data:any){body=data;return this;}});
  return {status,body};
}

async function main() {
  const conn=await db.getConnection(), originalQuery=db.query.bind(db), originalGet=db.getConnection.bind(db), log=console.error;
  const sandbox=new Proxy(conn,{get(target,key){
    if(key==='beginTransaction') return ()=>target.query('SAVEPOINT department_assignment_test');
    if(key==='commit') return ()=>target.query('RELEASE SAVEPOINT department_assignment_test');
    if(key==='rollback') return ()=>target.query('ROLLBACK TO SAVEPOINT department_assignment_test');
    if(key==='release') return ()=>{};
    const value=(target as any)[key];return typeof value==='function'?value.bind(target):value;
  }});
  const department=randomUUID(), sameNameOther=randomUUID(), empty=randomUUID(), roster=randomUUID(), shift=randomUUID();
  try {
    await conn.beginTransaction();
    (db as any).query=conn.query.bind(conn);(db as any).getConnection=async()=>sandbox;
    const [[admin]]=await conn.query<RowDataPacket[]>("SELECT id FROM users WHERE role='SUPER_ADMIN' AND isActive=1 LIMIT 1");
    const [employees]=await conn.query<RowDataPacket[]>("SELECT e.id,e.userId FROM employee_information_employees e JOIN users u ON u.id=e.userId JOIN employee_information_workstation_details w ON w.employeeId=e.id WHERE e.status='Active' AND e.isActive=1 AND u.role='EMPLOYEE' ORDER BY e.id LIMIT 4");
    assert.ok(admin);assert.equal(employees.length,4);
    const user={userId:admin.id};
    for(const id of [department,sameNameOther,empty]) await conn.query("INSERT INTO eim_structures (id,code,name,structureType,isActive,status) VALUES (?,?,?,'Department',1,'Active')",[id,id,id===empty?'Empty department':'Duplicate department name']);
    await conn.query("INSERT INTO attendance_shifts (id,code,name,startTime,endTime,totalHours,status) VALUES (?,?,?,'09:00','18:00',9,'Active')",[shift,shift,'Test shift']);
    await conn.query("INSERT INTO attendance_roster_groups (id,code,name,status) VALUES (?,?,?,'Active')",[roster,roster,'Department test roster']);
    await conn.query('INSERT INTO attendance_roster_group_shifts (id,groupId,rosterGroupId,shiftId,isDefault) VALUES (?,?,?,?,1)',[randomUUID(),roster,roster,shift]);
    for(let i=0;i<employees.length;i++) {
      await conn.query("UPDATE employee_information_employees SET organizationalRank='EMPLOYEE',reportingManagerId=NULL WHERE id=?",[employees[i].id]);
      await conn.query("UPDATE employee_information_employees SET departmentId=?,department='Duplicate department name',status=?,isActive=? WHERE id=?",[i===1||i===2?sameNameOther:department,i===3?'Inactive':'Active',i===3?0:1,employees[i].id]);
      await conn.query('UPDATE employee_information_workstation_details SET departmentId=? WHERE employeeId=?',[i===2?sameNameOther:department,employees[i].id]);
    }
    await conn.query("UPDATE attendance_roster_assignments SET status='Inactive' WHERE employeeId IN (?)",[employees.map(e=>e.id)]);
    const [[dates]]=await conn.query<RowDataPacket[]>("SELECT DATE_FORMAT(CURRENT_DATE(),'%Y-%m-%d') today, DATE_FORMAT(DATE_ADD(CURRENT_DATE(),INTERVAL 1 DAY),'%Y-%m-%d') tomorrow");
    const payload={departmentId:department,groupId:roster,effectiveStartDate:dates.today};
    // A later assignment on one member must roll back changes already made to another member.
    const future=randomUUID();
    await conn.query("INSERT INTO attendance_roster_assignments (id,employeeId,groupId,rosterGroupId,shiftId,effectiveStartDate,status) VALUES (?,?,?,?,?,?,'Active')",[future,employees[1].id,roster,roster,shift,dates.tomorrow]);
    const [before]=await conn.query<RowDataPacket[]>('SELECT * FROM attendance_roster_assignments WHERE employeeId IN (?) ORDER BY id',[employees.map(e=>e.id)]);
    console.error=()=>{};
    let response=await invoke(assignEmployees,{user,body:payload});assert.equal(response.status,409);
    const [afterFailure]=await conn.query<RowDataPacket[]>('SELECT * FROM attendance_roster_assignments WHERE employeeId IN (?) ORDER BY id',[employees.map(e=>e.id)]);
    assert.deepEqual(afterFailure,before,'Department assignment is atomic.');
    await conn.query('DELETE FROM attendance_roster_assignments WHERE id=?',[future]);
    response=await invoke(assignEmployees,{user,body:payload});assert.equal(response.status,201,JSON.stringify(response.body));assert.equal(response.body.data.assignedCount,2);
    const [assigned]=await conn.query<RowDataPacket[]>("SELECT employeeId,groupId,rosterGroupId,shiftId FROM attendance_roster_assignments WHERE groupId=? AND status='Active' ORDER BY employeeId",[roster]);
    assert.deepEqual(assigned.map(a=>a.employeeId),employees.slice(0,2).map(e=>e.id).sort());
    assert.ok(assigned.every(a=>a.groupId===a.rosterGroupId && a.shiftId===shift));
    for(const employee of employees.slice(0,2)) {response=await invoke(getMyShift,{user:{userId:employee.userId}});assert.equal(response.body.data.id,roster);}
    // Same-named department and inactive employees are not included.
    assert.ok(!assigned.some(a=>a.employeeId===employees[2].id||a.employeeId===employees[3].id));
    response=await invoke(assignEmployees,{user,body:{...payload,employeeIds:[employees[0].id]}});assert.equal(response.status,400,'Reject ambiguous bulk/individual target.');
    response=await invoke(assignEmployees,{user,body:{...payload,departmentId:empty}});assert.equal(response.status,400);
    response=await invoke(assignEmployees,{user,body:{...payload,departmentId:randomUUID()}});assert.equal(response.status,400);
    response=await invoke(assignEmployees,{user:{userId:employees[2].userId},body:payload});assert.equal(response.status,403,'Do not partially assign a department outside actor scope.');
    // A new department member does not inherit the previous bulk assignment.
    await conn.query('UPDATE employee_information_employees SET departmentId=? WHERE id=?',[department,employees[2].id]);
    await conn.query('UPDATE employee_information_workstation_details SET departmentId=? WHERE employeeId=?',[department,employees[2].id]);
    const [[newMember]]=await conn.query<RowDataPacket[]>("SELECT COUNT(*) count FROM attendance_roster_assignments WHERE employeeId=? AND groupId=? AND status='Active'",[employees[2].id,roster]);assert.equal(newMember.count,0);
    const [existingBefore]=await conn.query<RowDataPacket[]>('SELECT * FROM attendance_roster_assignments WHERE employeeId IN (?) ORDER BY id',[employees.slice(0,2).map(e=>e.id)]);
    response=await invoke(assignEmployees,{user,body:{employeeIds:[employees[2].id],groupId:roster,effectiveStartDate:dates.today}});assert.equal(response.status,201);assert.equal(response.body.data.assignedCount,1);
    const [existingAfter]=await conn.query<RowDataPacket[]>('SELECT * FROM attendance_roster_assignments WHERE employeeId IN (?) ORDER BY id',[employees.slice(0,2).map(e=>e.id)]);assert.deepEqual(existingAfter,existingBefore,'Individual assignment does not rewrite department colleagues.');
    response=await invoke(getMyShift,{user:{userId:employees[2].userId}});assert.equal(response.body.data.id,roster);
    console.error=log;
    console.log('PASS: ID-based whole-department assignment, canonical workstation mapping, inactive/other-department exclusion, atomic rollback, scope/empty/ambiguous validation, employee roster readback and later individual assignment without changing colleagues. All test changes rolled back.');
  } finally {
    console.error=log;(db as any).query=originalQuery;(db as any).getConnection=originalGet;
    await conn.rollback();conn.release();
  }
  const [[left]]=await db.query<RowDataPacket[]>('SELECT COUNT(*) count FROM eim_structures WHERE id IN (?,?,?)',[department,sameNameOther,empty]);assert.equal(left.count,0);
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.end());

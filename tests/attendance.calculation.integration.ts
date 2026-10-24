import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import mysql from 'mysql2/promise';
import { attendanceRange, attendanceDateTime, calculateAttendance, saveAttendance, shiftForDate, workingDate, workingLogs } from '../src/modules/attendance/calculation.service';
import { rosterCategory } from '../src/shared/services/dashboard.service';

async function main(){
 const source=new URL(process.env.DATABASE_URL!);
 const name='hr_attendance_calc_'+randomUUID().replace(/-/g,'');
 const connection=await mysql.createConnection({host:source.hostname,port:Number(source.port)||3306,user:decodeURIComponent(source.username),password:decodeURIComponent(source.password),multipleStatements:true,timezone:'+05:30'});
 let passed=0;const check=(label:string,fn:()=>void)=>{fn();console.log(`PASS ${++passed}: ${label}`);};
 try{
  const date='2026-10-23',day={id:'day',startTime:'09:00:00',endTime:'18:00:00',totalHours:9,fullDayHours:8,breakDuration:1,breakType:'Unpaid',overtimeEligible:1,overtimeStart:30,graceLate:10,graceEarly:10};
  const log=(time:string,logType:string)=>({timestamp:date+' '+time+':00',logType});
  const logs=[log('09:00','In'),log('12:00','BreakIn'),log('13:00','BreakOut'),log('18:00','Out')];
  const calc=(shift:any=day,last='18:00',entries:any=logs)=>calculateAttendance(date,date+' 09:00:00',date+' '+last+':00',shift,entries);
  check('Unpaid break is excluded once; assigned eight-hour regular threshold',()=>{const r=calc();assert.equal(r.totalHours,8);assert.equal(r.regularHours,8);assert.equal(r.overtimeHours,0);});
  check('Paid break remains paid',()=>assert.equal(calc({...day,breakType:'Paid',fullDayHours:9}).totalHours,9));
  check('Manual interval deducts configured unpaid break',()=>assert.equal(calc(day,'18:00',null).totalHours,8));
  check('Separate In/Out sessions exclude time away',()=>assert.equal(calc(day,'18:00',[log('09:00','In'),log('12:00','Out'),log('14:00','In'),log('18:00','Out')]).totalHours,7));
  check('Overtime follows assigned hours and eligibility',()=>{const r=calc(day,'20:00',[...logs.slice(0,-1),log('20:00','Out')]);assert.equal(r.totalHours,10);assert.equal(r.regularHours,8);assert.equal(r.overtimeHours,2);assert.equal(calc({...day,overtimeEligible:0},'20:00',[...logs.slice(0,-1),log('20:00','Out')]).overtimeHours,0);});
  check('Overtime grace is respected',()=>assert.equal(calc(day,'18:15',[...logs.slice(0,-1),log('18:15','Out')]).overtimeHours,0));
  check('Unassigned attendance does not invent overtime',()=>{const r=calc(null);assert.equal(r.totalHours,8);assert.equal(r.overtimeHours,0);assert.equal(r.shiftId,null);});
  check('Late/early grace uses shift times',()=>{const r=calculateAttendance(date,date+' 09:20:00',date+' 17:30:00',day);assert.equal(r.lateMinutes,10);assert.equal(r.earlyDepartureMinutes,20);});
  check('Night shift ends on following date',()=>{const range=attendanceRange(date,'22:00','06:00');assert.equal(range.outTime,'2026-10-24 06:00:00');const r=calculateAttendance(date,range.inTime,range.outTime,{...day,startTime:'22:00',endTime:'06:00',fullDayHours:7,totalHours:8});assert.equal(r.totalHours,7);assert.equal(r.lateMinutes,0);assert.equal(r.earlyDepartureMinutes,0);});
  check('Invalid dates and identical times are rejected',()=>{assert.throws(()=>attendanceRange('2026-02-30','09:00','18:00'));assert.throws(()=>attendanceRange(date,'09:00','09:00'));});
  check('Punch formatting is independent of server timezone',()=>assert.equal(attendanceDateTime(new Date('2026-10-23T03:30:00Z')),date+' 09:00:00'));
  check('Fixed shifts appear in the correct roster dashboard bucket',()=>{assert.equal(rosterCategory({shiftType:'Fixed',startTime:'09:00:00'}),'day');assert.equal(rosterCategory({shiftType:'Fixed',startTime:'15:00:00'}),'late');assert.equal(rosterCategory({shiftType:'Fixed',startTime:'22:00:00'}),'night');assert.equal(rosterCategory({shiftType:'Rotational',startTime:'09:00:00'}),'rotational');});
  await connection.query('CREATE DATABASE ??',[name]);await connection.query('USE ??',[name]);await connection.query(readFileSync('database/schema.sql','utf8'));
  await connection.query("INSERT INTO attendance_shifts (id,code,name,startTime,endTime,totalHours,fullDayHours,breakDuration,breakType,overtimeEligible,overtimeStart) VALUES ('day','TEST','Test shift','09:00','18:00',9,8,1,'Unpaid',1,30),('night','NIGHT','Night shift','22:00','06:00',8,7,1,'Unpaid',1,30)");
  await connection.query("INSERT INTO attendance_roster_groups (id,code,name,status) VALUES ('roster','TEST','Test roster','Active')");
  await connection.query("INSERT INTO attendance_roster_group_shifts (id,groupId,rosterGroupId,shiftId,isDefault) VALUES ('member','roster','roster','day',1)");
  await connection.query("INSERT INTO attendance_roster_assignments (id,employeeId,groupId,effectiveStartDate,status) VALUES ('assignment','employee','roster','2026-10-23','Active')");
  const pooled=connection as any;
  check('Assignment is not active before its effective date',()=>{});assert.equal(await shiftForDate(pooled,'employee','2026-10-22'),null);
  assert.equal((await shiftForDate(pooled,'employee',date))?.id,'day');check('Roster default resolves for attendance date',()=>{});
  await connection.query("INSERT INTO attendance_roster_calendars (id,rosterGroupId,date,shiftId) VALUES ('calendar','roster',?,'night')",[date]);
  assert.equal((await shiftForDate(pooled,'employee',date))?.id,'night');check('Dated calendar overrides default shift',()=>{});
  await connection.query("UPDATE attendance_roster_calendars SET isOffDay=1 WHERE id='calendar'");assert.equal(await shiftForDate(pooled,'employee',date),null);check('Roster off day does not acquire a default shift',()=>{});
  await connection.query("UPDATE attendance_roster_calendars SET isOffDay=0,shiftId='day' WHERE id='calendar'");
  await connection.query("INSERT INTO attendance_records (id,employeeId,date) VALUES ('record','employee',?)",[date]);
  await saveAttendance(pooled,'record','employee',date,date+' 09:00:00',date+' 18:00:00',{logs});
  const [[saved]]:any=await connection.query("SELECT * FROM attendance_records WHERE id='record'");check('Calculated shift, hours and overtime persist in MySQL',()=>{assert.equal(saved.shiftId,'day');assert.equal(Number(saved.totalHours),8);assert.equal(Number(saved.regularHours),8);assert.equal(Number(saved.overtimeHours),0);});
  await connection.query("INSERT INTO attendance_raw_logs(id,employeeId,timestamp,logType) VALUES ('in','night-employee','2026-10-23 22:00','In'),('break','night-employee','2026-10-24 01:00','BreakIn')");
  const now=new Date('2026-10-24T02:00:00+05:30');assert.equal(await workingDate(pooled,'night-employee',now),date);assert.equal((await workingLogs(pooled,'night-employee',date,now)).length,2);check('After-midnight punches remain on the opening attendance day',()=>{});
  console.log(JSON.stringify({passed,sourceWrites:0}));
 }finally{if(/^hr_attendance_calc_[a-f0-9]{32}$/.test(name))await connection.query('DROP DATABASE IF EXISTS ??',[name]);await connection.end();const {db}=await import('../src/lib/db');await db.end();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});

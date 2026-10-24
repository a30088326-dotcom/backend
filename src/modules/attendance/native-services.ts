import { randomUUID } from 'node:crypto';
import type { RepositorySession } from '../../storage/repository';
import { attendanceDateTime, attendanceDate, attendanceTimestamp, calculateAttendance } from './calculation.service';
import { RosterError, validRosterDate } from './roster.service';

export async function rosterDefaultNative(tx:RepositorySession,groupId:string) {
  const group=await tx.get('attendance_roster_groups',{id:groupId});
  if(!group||!['Active','Draft'].includes(group.status))throw new RosterError(400,'Selected roster is unavailable.');
  const maps=await tx.find('attendance_roster_group_shifts',r=>(r.groupId===groupId||r.rosterGroupId===groupId)&&!!r.isDefault);
  const shifts=await Promise.all(maps.map(r=>tx.get('attendance_shifts',{id:r.shiftId})));
  if(shifts.length!==1||!shifts[0])throw new RosterError(400,'Configure exactly one default shift for this roster before assigning employees.');
  return String(shifts[0].id);
}
export async function assignRosterNative(tx:RepositorySession,employeeId:string,groupId:string,start:string,end?:string|null) {
  if(!validRosterDate(start)||(end!=null&&(!validRosterDate(end)||end<start)))throw new RosterError(400,'Enter valid assignment dates; the end date cannot precede the start date.');
  const shiftId=await rosterDefaultNative(tx,groupId);
  const employee=await tx.get('employee_information_employees',{id:employeeId});
  if(!employee||employee.status!=='Active'||employee.isActive===0)throw new RosterError(400,'Employee is inactive or does not exist.');
  // Version this aggregate so concurrent assignments and punches cannot both commit from the same snapshot.
  await tx.replace('employee_information_employees',{...employee,updatedAt:attendanceDateTime(new Date())});
  const previous=await tx.find('attendance_roster_assignments',r=>r.employeeId===employeeId&&r.status==='Active');
  if(previous.some(r=>r.effectiveStartDate&&String(r.effectiveStartDate)>start))throw new RosterError(409,'A later roster assignment already exists. Choose a date on or after that assignment.');
  const prior=new Date(start+'T12:00:00Z');prior.setUTCDate(prior.getUTCDate()-1);const before=prior.toISOString().slice(0,10);
  for(const row of previous) {const date=String(row.effectiveStartDate||row.effectiveFrom||start);const until=date>before?date:before;await tx.replace('attendance_roster_assignments',{...row,status:'Inactive',effectiveEndDate:until,effectiveTo:until});}
  const id=randomUUID();await tx.create('attendance_roster_assignments',{id,employeeId,groupId,rosterGroupId:groupId,shiftId,effectiveStartDate:start,effectiveEndDate:end||null,effectiveFrom:start,effectiveTo:end||null,status:'Active'});
  return {id,rosterGroupId:groupId,shiftId};
}
export async function validateRosterShiftsNative(tx:RepositorySession,shifts:any,calendar:any,preserved:string[]=[]) {
  if(!Array.isArray(shifts)||!shifts.length||shifts.some(s=>!s||typeof s!=='object'||typeof s.shiftId!=='string'||!s.shiftId)||shifts.filter(s=>s.isDefault===true||s.isDefault===1).length!==1||new Set(shifts.map(s=>s.shiftId)).size!==shifts.length)throw new RosterError(400,'Select valid, unique shifts and exactly one default shift.');
  const found=await Promise.all(shifts.map(s=>tx.get('attendance_shifts',{id:s.shiftId})));
  if(found.some(s=>!s))throw new RosterError(400,'One of the selected shifts no longer exists. Refresh the shifts and try again.');
  if(found.some(s=>s!.status==='Archived'&&!preserved.includes(s!.id)))throw new RosterError(400,'A selected shift was deleted. Refresh and select another created shift.');
  if(calendar!=null&&(!Array.isArray(calendar)||calendar.some(a=>!a||!validRosterDate(a.date)||(!a.clear&&!a.isOffDay&&!shifts.some(s=>s.shiftId===a.shiftId)))||new Set(calendar.map(a=>a.date)).size!==calendar.length))throw new RosterError(400,'Each calendar date must be valid and use a shift linked to this roster, or an off day.');
}
export async function assignmentForDateNative(tx:RepositorySession,employeeId:string,date:string) {
  return (await tx.find('attendance_roster_assignments',r=>r.employeeId===employeeId&&r.status==='Active'&&String(r.effectiveStartDate||r.effectiveFrom)<=date&&(!(r.effectiveEndDate||r.effectiveTo)||String(r.effectiveEndDate||r.effectiveTo)>=date))).sort((a,b)=>String(b.effectiveStartDate||b.effectiveFrom).localeCompare(String(a.effectiveStartDate||a.effectiveFrom))||String(b.createdAt).localeCompare(String(a.createdAt)))[0];
}
export async function shiftForDateNative(tx:RepositorySession,employeeId:string,date:string,savedShiftId?:string) {
  if(savedShiftId){const saved=await tx.get('attendance_shifts',{id:savedShiftId});if(saved)return saved;}
  const assignment=await assignmentForDateNative(tx,employeeId,date);if(!assignment)return null;
  const groupId=assignment.groupId||assignment.rosterGroupId;
  const calendar=(await tx.find('attendance_roster_calendars',r=>r.rosterGroupId===groupId&&String(r.date).slice(0,10)===date))[0];
  if(calendar?.isOffDay)return null;
  if(calendar?.shiftId)return await tx.get('attendance_shifts',{id:calendar.shiftId})||null;
  const mappings=(await tx.find('attendance_roster_group_shifts',r=>r.groupId===groupId||r.rosterGroupId===groupId)).sort((a,b)=>Number(b.isDefault)-Number(a.isDefault)||Number(a.displayOrder)-Number(b.displayOrder)||String(a.shiftId).localeCompare(String(b.shiftId)));
  for(const map of mappings){const shift=await tx.get('attendance_shifts',{id:map.shiftId});if(shift)return shift;}
  return assignment.shiftId?await tx.get('attendance_shifts',{id:assignment.shiftId})||null:null;
}
export async function workingDateNative(tx:RepositorySession,employeeId:string,now=new Date()) {
  const until=attendanceDateTime(now),from=attendanceDateTime(new Date(now.getTime()-36*3600000));
  const logs=(await tx.find('attendance_raw_logs',r=>r.employeeId===employeeId&&String(r.timestamp)>=from&&String(r.timestamp)<=until)).sort((a,b)=>String(b.timestamp).localeCompare(String(a.timestamp))||String(b.id).localeCompare(String(a.id)));
  if(logs[0]&&logs[0].logType!=='Out'){
    const opened=(await tx.find('attendance_raw_logs',r=>r.employeeId===employeeId&&r.logType==='In'&&String(r.timestamp)<=until)).sort((a,b)=>String(b.timestamp).localeCompare(String(a.timestamp)))[0];
    if(opened)return attendanceDate(opened.timestamp);
  }
  return attendanceDate(now);
}
export async function workingLogsNative(tx:RepositorySession,employeeId:string,date:string,now=new Date()) {
  const until=attendanceDateTime(now);
  return (await tx.find('attendance_raw_logs',r=>r.employeeId===employeeId&&String(r.timestamp)>=date+' 00:00:00'&&String(r.timestamp)<=until)).sort((a,b)=>String(a.timestamp).localeCompare(String(b.timestamp))||String(a.id).localeCompare(String(b.id)));
}
export async function saveAttendanceNative(tx:RepositorySession,recordId:string,employeeId:string,date:string,firstIn:Date|string,lastOut:Date|string,options:any={}) {
  const record=await tx.get('attendance_records',{id:recordId});if(!record)throw new RosterError(404,'Attendance record not found.');
  const shift=await shiftForDateNative(tx,employeeId,date,options.savedShiftId);
  const result=calculateAttendance(date,firstIn,lastOut,shift,options.logs);
  await tx.replace('attendance_records',{...record,...result,inTime:attendanceDateTime(new Date(attendanceTimestamp(firstIn))),outTime:attendanceDateTime(new Date(attendanceTimestamp(lastOut))),status:options.status||'Present',isException:options.isException||0});
  return result;
}

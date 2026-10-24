import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { repository } from '../../storage/repository';
import { requireAdmin } from '../../middleware/auth';
import { attendanceDate, attendanceDateTime, attendanceRange, attendanceTimestamp, saveAttendance, shiftForDate, workingDate, workingLogs } from './calculation.service';
import { assignmentForDateNative } from './native-services';
import { rosterViewNative } from './setup.native';
import { RosterError } from './roster.service';
import { nativeRun as run, employeeNative as employee, newestNative as newest } from './native-http';
const router=Router();
router.get('/my-today',run(async(req:any,res:any)=>{const repo=repository(),emp=await employee(repo,req.user.userId),date=await workingDate(repo,emp.id);res.json({success:true,data:await workingLogs(repo,emp.id,date)});}));
router.post('/punch',run(async(req:any,res:any)=>{
  const {logType,source,location}=req.body;if(!['In','Out','BreakIn','BreakOut'].includes(logType))throw new RosterError(400,'Invalid log type');
  const data=await repository().transaction(async tx=>{
    const emp=await employee(tx,req.user.userId,true);await tx.replace('employee_information_employees',{...emp});
    const now=new Date(),date=await workingDate(tx,emp.id,now),logs=await workingLogs(tx,emp.id,date,now),last=logs.at(-1),previous=last?.logType;
    if(previous===logType)throw new RosterError(400,`You are already Clocked ${logType}`);
    if(last&&now.getTime()-attendanceTimestamp(last.timestamp)<1000)throw new RosterError(409,'Your previous attendance action was just recorded. Wait one second before the next action.');
    const valid=logType==='In'?!previous||previous==='Out':logType==='Out'?['In','BreakOut','BreakIn'].includes(previous):logType==='BreakIn'?['In','BreakOut'].includes(previous):previous==='BreakIn';
    if(!valid)throw new RosterError(400,'This attendance action does not follow your last recorded action.');
    const id=randomUUID(),timestamp=attendanceDateTime(now);await tx.create('attendance_raw_logs',{id,employeeId:emp.id,timestamp,logType,source:source||'Web',location:location||null});
    let record=(await tx.find('attendance_records',r=>r.employeeId===emp.id&&r.date===date))[0];
    if(logType==='In'||logType==='BreakOut'){
      if(!record){const shift=await shiftForDate(tx,emp.id,date);record=await tx.create('attendance_records',{id:randomUUID(),employeeId:emp.id,date,shiftId:shift?.id||null,inTime:timestamp,status:'Present'});}
      else if(!record.inTime)await tx.replace('attendance_records',{...record,inTime:timestamp,status:'Present'});
      else if(logType==='In')await tx.replace('attendance_records',{...record,outTime:null});
    }else if(logType==='Out'&&record?.inTime)await saveAttendance(tx,record.id,emp.id,date,record.inTime,now,{logs:[...logs,{timestamp:now,logType:'Out'}],savedShiftId:record.shiftId});
    return {id,date,logType};
  });res.json({success:true,message:`Successfully clocked ${logType.toLowerCase()}`,data});
}));
router.get('/my-attendance/history',run(async(req:any,res:any)=>{const emp=await employee(repository(),req.user.userId);res.json({success:true,data:(await repository().find('attendance_records',r=>r.employeeId===emp.id)).sort((a,b)=>String(b.date).localeCompare(String(a.date)))});}));
router.post('/my-attendance/manual',requireAdmin,run(async(req:any,res:any)=>{
  const {date,inTime,outTime}=req.body;let range;try{range=attendanceRange(date,inTime,outTime);}catch{throw new RosterError(400,'A valid date and different in/out times are required.');}
  await repository().transaction(async tx=>{const emp=await employee(tx,req.user.userId);await tx.replace('employee_information_employees',{...emp});if((await tx.find('attendance_records',r=>r.employeeId===emp.id&&r.date===date)).length)throw new RosterError(400,'Attendance already exists for this date');
    for(const [timestamp,logType]of [[range.inTime,'In'],[range.outTime,'Out']])await tx.create('attendance_raw_logs',{id:randomUUID(),employeeId:emp.id,timestamp,logType,source:'Manual'});
    const record=await tx.create('attendance_records',{id:randomUUID(),employeeId:emp.id,date});await saveAttendance(tx,record.id,emp.id,date,range.inTime,range.outTime);
  });res.status(201).json({success:true,message:'Attendance marked successfully'});
}));
router.put('/my-attendance/:idOrDate',requireAdmin,run(async(req:any,res:any)=>{
  await repository().transaction(async tx=>{const emp=await employee(tx,req.user.userId);await tx.replace('employee_information_employees',{...emp});const record=(await tx.find('attendance_records',r=>r.employeeId===emp.id&&(r.id===req.params.idOrDate||r.date===(req.body.date||req.params.idOrDate))))[0];if(!record)throw new RosterError(404,'Attendance record not found');let range;try{range=attendanceRange(String(record.date).slice(0,10),req.body.inTime,req.body.outTime);}catch{throw new RosterError(400,'A valid date and different in/out times are required.');}await saveAttendance(tx,record.id,emp.id,record.date,range.inTime,range.outTime,{savedShiftId:record.shiftId,isException:1});});res.json({success:true,message:'Attendance updated successfully'});
}));
router.get('/my-shift',run(async(req:any,res:any)=>{const repo=repository(),emp=await employee(repo,req.user.userId),assignment=await assignmentForDateNative(repo,emp.id,attendanceDate(new Date()));const data=assignment?(await rosterViewNative(assignment.groupId||assignment.rosterGroupId))[0]:null;res.json({success:true,data:data||null,...(!data?{message:'No active shift assigned'}:{})});}));
router.get('/my-exceptions',run(async(req:any,res:any)=>{const emp=await employee(repository(),req.user.userId);res.json({success:true,data:(await repository().find('attendance_exceptions',r=>r.employeeId===emp.id&&r.exceptionType==='MISSED_PUNCH')).sort(newest)});}));
export default router;

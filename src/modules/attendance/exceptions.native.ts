import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { repository, storageNow, type RepositorySession } from '../../storage/repository';
import { organizationAccess } from '../../shared/services/organization.service';
import { attendanceRange, saveAttendance } from './calculation.service';
import { RosterError } from './roster.service';
import { nativeRun as run, employeeNative as employee, requiredNative as required, newestNative as newest } from './native-http';
const router=Router();
async function approvalActor(tx:RepositorySession,userId:string,targetId:string){
  const user=await tx.get('users',{id:userId});
  const own=(await tx.find('employee_information_employees',e=>e.userId===userId&&e.status==='Active'&&Number(e.isActive??1)===1))[0];
  if(!user||!Number(user.isActive)||!own)throw new RosterError(403,'An active employee profile is required for the approver.');
  if(own.id===targetId)throw new RosterError(403,'You cannot resolve your own attendance request.');
  if(['ADMIN','SUPER_ADMIN'].includes(user.role)||['OWNER','CEO'].includes(own.organizationalRank))return own.id;
  let cursor=await tx.get('employee_information_employees',{id:targetId});
  const seen=new Set<string>();
  while(cursor&&cursor.status==='Active'&&Number(cursor.isActive??1)===1&&cursor.reportingManagerId&&!seen.has(cursor.id)){
    seen.add(cursor.id);
    if(cursor.reportingManagerId===own.id)return own.id;
    cursor=await tx.get('employee_information_employees',{id:cursor.reportingManagerId});
  }
  throw new RosterError(403,'You can resolve requests only for employees in your current reporting scope.');
}
router.post('/exceptions/missed-punch',run(async(req:any,res:any)=>{
  const {date,inTime,outTime,reason,recordId}=req.body;try{attendanceRange(date,inTime,outTime);}catch{throw new RosterError(400,'A valid date and different in/out times are required.');}
  await repository().transaction(async tx=>{const emp=await employee(tx,req.user.userId);await tx.replace('employee_information_employees',{...emp});
    const records=await tx.find('attendance_records',r=>r.employeeId===emp.id&&r.date===date&&(!recordId||r.id===recordId));if(recordId&&!records.length)throw new RosterError(404,'Attendance record not found for this employee and date');
    if((await tx.find('attendance_exceptions',r=>r.employeeId===emp.id&&r.date===date&&r.exceptionType==='MISSED_PUNCH'&&r.status==='PENDING')).length)throw new RosterError(400,'A pending request already exists for this date');
    await tx.create('attendance_exceptions',{id:randomUUID(),employeeId:emp.id,recordId:records[0]?.id||null,date,exceptionType:'MISSED_PUNCH',status:'PENDING',reason,requestedValue:JSON.stringify({inTime,outTime})});
  });res.status(201).json({success:true,message:'Missed attendance request submitted successfully'});
}));
router.get('/team-exceptions',run(async(req:any,res:any)=>{const access=await organizationAccess(req.user.userId);if(!access.admin&&!access.isExecutive&&!access.isManager)throw new RosterError(403,'Manager access required');const ids=access.visibleIds.filter(id=>id!==access.employeeId),rows=await repository().find('attendance_exceptions',r=>ids.includes(r.employeeId)&&r.exceptionType==='MISSED_PUNCH');res.json({success:true,data:rows.sort(newest).map(r=>{const emp=access.employees.find(e=>e.id===r.employeeId);return {...r,employeeName:emp?.name||'Unknown',employeeNo:emp?.employeeNumber};})});}));
router.post('/exceptions/:id/resolve',run(async(req:any,res:any)=>{
  const access=await organizationAccess(req.user.userId),{status,resolutionNotes}=req.body;if(!access.admin&&!access.isExecutive&&!access.isManager)throw new RosterError(403,'Manager or executive access is required');if(!['APPROVED','REJECTED'].includes(status))throw new RosterError(400,'Invalid status');if(!access.employeeId)throw new RosterError(401,'No employee profile for approver');
  await repository().transaction(async tx=>{
    const exc=await required(tx,'attendance_exceptions',req.params.id);if(exc.status!=='PENDING')throw new RosterError(404,'Pending request not found');
    if(exc.employeeId===access.employeeId||(!access.admin&&!access.isExecutive&&!access.visibleIds.includes(exc.employeeId)))throw new RosterError(403,'You can resolve requests only for employees in your reporting scope.');
    const resolvedBy=await approvalActor(tx,req.user.userId,exc.employeeId);
    const emp=await required(tx,'employee_information_employees',exc.employeeId);await tx.replace('employee_information_employees',{...emp});
    let recordId=exc.recordId;
    if(status==='APPROVED'){
      const value=typeof exc.requestedValue==='string'?JSON.parse(exc.requestedValue):exc.requestedValue;let range;try{range=attendanceRange(String(exc.date).slice(0,10),value?.inTime,value?.outTime);}catch{throw new RosterError(400,'Invalid attendance correction times');}
      let record=(await tx.find('attendance_records',r=>r.employeeId===exc.employeeId&&r.date===exc.date&&(!exc.recordId||r.id===exc.recordId)))[0];if(exc.recordId&&!record)throw new RosterError(404,'The attendance record for this correction no longer exists');
      if(!record){record=await tx.create('attendance_records',{id:randomUUID(),employeeId:exc.employeeId,date:exc.date});for(const [timestamp,logType]of [[range.inTime,'In'],[range.outTime,'Out']])await tx.create('attendance_raw_logs',{id:randomUUID(),employeeId:exc.employeeId,timestamp,logType,source:'Manual (Approved)'});}
      recordId=record.id;await saveAttendance(tx,record.id,exc.employeeId,exc.date,range.inTime,range.outTime,{savedShiftId:record.shiftId,status:'APPROVED',isException:1});
    }
    await tx.replace('attendance_exceptions',{...exc,status,resolvedBy,resolvedAt:storageNow(),resolutionNotes:resolutionNotes||null,recordId});
  });res.json({success:true,message:`Request ${status.toLowerCase()} successfully`});
}));
export default router;

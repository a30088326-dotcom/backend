import { Router } from 'express';
import { repository } from '../../../storage/repository';
import { organizationAccess } from '../../../shared/services/organization.service';
import { localToday } from '../../../shared/services/dashboard.service';
import { decideLeave, LeaveError } from '../services/application.service';
import { formatApplication, leaveReferences, nativeHandler as handler, paging } from './native-shared';

const router = Router();
router.patch('/applications/:id/approve', handler(async (req,res)=>{
  res.json({success:true,data:await decideLeave(req.user!,String(req.params.id),req.body.action,req.body.rejectedReason||req.body.comment)});
}));

router.get('/ceo/applications',handler(async(req,res)=>{
  const access=await organizationAccess(req.user!.userId);
  if(!access.admin&&!access.isExecutive)throw new LeaveError(403,'Executive access is required to view organization-wide requests.');
  const refs=await leaveReferences(),{page,limit,offset}=paging(req,50);
  const rows=(await repository().find('leave_applications',row=>req.query.pendingForMe!=='true'||row.approverId===req.user!.userId&&String(row.status).startsWith('PENDING'))).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
  res.json({success:true,data:rows.slice(offset,offset+limit).map(row=>formatApplication(row,refs)),meta:{total:rows.length,page,limit,totalPages:Math.ceil(rows.length/limit)}});
}));

router.get('/applications/:id/history',handler(async(req,res)=>{
  const repo=repository(),id=String(req.params.id),app=await repo.get('leave_applications',{id});
  if(!app)return res.json({success:true,data:[]});
  const access=await organizationAccess(req.user!.userId);
  const employee=access.employees.find(e=>e.userId===app.applicantId);
  if(!access.admin&&!(employee&&access.visibleIds.includes(employee.id)))throw new LeaveError(403,'You do not have access to this request history.');
  const users=await repo.find('users',()=>true);
  const approvals=(await repo.find('leave_approval_history',h=>h.leave_application_id===id)).sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)));
  const history:any[]=[{id:`submitted-${id}`,action:'SUBMITTED',created_at:app.createdAt,approver_name:null,level:null,comment:app.comments||null}];
  history.push(...approvals.map(h=>({id:h.id,action:h.action,level:h.level,comment:h.comment,created_at:h.created_at,approver_name:users.find(u=>u.id===h.approver_user_id)?.name||null})));
  if(!approvals.length&&['APPROVED','REJECTED'].includes(app.status))history.push({id:`actioned-${id}`,action:app.status,created_at:app.approvedAt||app.actionedAt||null,approver_name:users.find(u=>u.id===app.approverId)?.name||null,level:1,comment:app.status==='REJECTED'?app.rejectedReason||null:null});
  if(app.status==='CANCELLED'&&!approvals.some(h=>h.action==='CANCELLED'))history.push({id:`cancelled-${id}`,action:'CANCELLED',created_at:app.cancelledAt,approver_name:null,level:null,comment:app.cancelReason||null});
  return res.json({success:true,data:history});
}));

router.get('/team/dashboard',handler(async(req,res)=>{
  const access=await organizationAccess(req.user!.userId);
  if(!access.admin&&!access.isExecutive&&!access.isManager)throw new LeaveError(403,'A reporting team is required.');
  const team=access.employees.filter(e=>e.active&&e.id!==access.employeeId&&access.visibleIds.includes(e.id));
  const employeeIds=new Set(team.map(e=>e.id)),userIds=new Set(team.map(e=>e.userId).filter(Boolean));
  const today=localToday(),first=new Date(today+'T00:00:00Z');first.setUTCDate(first.getUTCDate()-365);
  const final=new Date(today+'T00:00:00Z');final.setUTCDate(final.getUTCDate()+6);
  const from=first.toISOString().slice(0,10),to=final.toISOString().slice(0,10);
  const repo=repository(),refs=await leaveReferences();
  const [applications,attendance]=await Promise.all([
    repo.find('leave_applications',r=>userIds.has(r.applicantId)),
    repo.find('attendance_records',r=>employeeIds.has(r.employeeId)&&r.date>=from&&r.date<=today)
  ]);
  const pending=applications.filter(r=>r.approverId===req.user!.userId&&String(r.status).startsWith('PENDING')).sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));
  const leave=applications.filter(r=>r.status==='APPROVED'&&r.endDate>=from&&r.startDate<=to);
  const onLeaveToday=leave.filter((row,index,all)=>row.startDate<=today&&row.endDate>=today&&all.findIndex(r=>r.applicantId===row.applicantId&&r.startDate<=today&&r.endDate>=today)===index);
  const onLeaveUsers=new Set(onLeaveToday.map(r=>r.applicantId));
  const todayAttendance=attendance.filter(r=>r.date===today),absentRecords=attendance.filter(r=>r.status==='Absent');
  const presentIds=new Set(todayAttendance.filter(r=>r.inTime||['Present','Late','APPROVED'].includes(r.status)).map(r=>r.employeeId));
  const absentIds=new Set(todayAttendance.filter(r=>r.status==='Absent').map(r=>r.employeeId));
  const present=team.filter(e=>presentIds.has(e.id)&&!onLeaveUsers.has(e.userId)).length;
  const absent=team.filter(e=>absentIds.has(e.id)||onLeaveUsers.has(e.userId)).length;
  const next7Days=Array.from({length:7},(_,offset)=>{
    const day=new Date(today+'T00:00:00Z');day.setUTCDate(day.getUTCDate()+offset);const date=day.toISOString().slice(0,10);
    const out=new Set(leave.filter(r=>r.startDate<=date&&r.endDate>=date).map(r=>r.applicantId)),available=team.length-out.size;
    return{date,dayName:day.toLocaleDateString('en-GB',{weekday:'short',timeZone:'UTC'}),present:available,absent:out.size,percentage:team.length?Math.round(available/team.length*100):0};
  });
  const bradfordFactor=team.map(e=>{
    const dates=[...new Set(absentRecords.filter(r=>r.employeeId===e.id).map(r=>String(r.date)))].sort();
    let episodes=0,previous='';for(const date of dates){if(!previous||Math.round((Date.parse(date)-Date.parse(previous))/86400000)>1)episodes++;previous=date;}
    const score=episodes*episodes*dates.length;
    return{userId:e.userId||e.id,name:e.name,email:'',episodes,totalDays:dates.length,score,risk:score>450?'Very High':score>200?'High':score>50?'Medium':'Low'};
  }).filter(r=>r.totalDays>0).sort((a,b)=>b.score-a.score);
  const recentLimit=new Date(today+'T00:00:00Z');recentLimit.setUTCDate(recentLimit.getUTCDate()-29);
  const recent=attendance.filter(r=>r.date>=recentLimit.toISOString().slice(0,10));
  const recordedDays=recent.filter(r=>r.inTime||['Present','Late','Absent','APPROVED'].includes(r.status)).length;
  const approvedDays=leave.filter(r=>r.endDate<=today).reduce((sum,r)=>sum+Number(r.totalDays||0),0);
  res.json({success:true,data:{
    todaysAvailability:{total:team.length,present,absent,notRecorded:Math.max(0,team.length-present-absent),onLeave:onLeaveToday.map(r=>({name:team.find(e=>e.userId===r.applicantId)?.name||'Employee',leaveType:refs.types.get(r.leaveTypeId)?.name,leaveTypeColor:refs.types.get(r.leaveTypeId)?.color}))},
    next7Days,bradfordFactor,pendingApprovals:pending.map(r=>({...formatApplication(r,refs),employeeId:r.employeeId||r.applicantId,medCertSubmitted:Boolean(r.medCertSubmitted),applicant:{id:r.applicantId,name:refs.users.get(r.applicantId)?.name,email:refs.users.get(r.applicantId)?.email}})),
    stats:{teamLeaveAvg:team.length?+(approvedDays/team.length).toFixed(1):0,absenceRate:recordedDays?+(recent.filter(r=>r.status==='Absent').length/recordedDays*100).toFixed(1):0,totalPendingCount:pending.length,totalOnLeaveToday:onLeaveToday.length}
  }});
}));
router.post('/seed-defaults',(_req,res)=>{res.status(501).json({success:false,message:'Demo seeding is disabled for live employee data.'});});
export default router;

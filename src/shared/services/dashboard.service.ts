import type { RowDataPacket } from 'mysql2/promise';
import { db } from '../../lib/db';
import { organizationAccess } from './organization.service';
import { dashboardInputsNative } from './dashboard.dynamo';
export const localToday = () => new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Colombo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const rosterCategory = (shift: {shiftType?:string;startTime?:string;[key:string]:unknown}) => {
  const type=shift.shiftType||'';
  if(/rotat/i.test(type))return 'rotational';
  if(/night/i.test(type))return 'night';
  if(/late/i.test(type))return 'late';
  if(/day/i.test(type))return 'day';
  if(!shift.startTime)return null;
  const hour=Number(String(shift.startTime).slice(0,2));
  return hour<6||hour>=18?'night':hour>=14?'late':'day';
};
export async function dashboardFor(userId: string) {
  const access = await organizationAccess(userId);
  const employees = access.employees.filter(e => access.visibleIds.includes(e.id));
  const ids = employees.map(e=>e.id); const users = employees.map(e=>e.userId).filter(Boolean);
  const date = localToday();
  const native = process.env.DATABASE_PROVIDER === 'dynamodb' ? await dashboardInputsNative(ids, users as string[], date) : null;
  const [attendance] = native ? [native.attendance] : await db.query<RowDataPacket[]>('SELECT employeeId,status,isLate,inTime,outTime FROM attendance_records WHERE employeeId IN (?) AND date=?', [ids.length?ids:[''],date]);
  const [leave] = native ? [native.leave] : await db.query<RowDataPacket[]>(`SELECT applicantId,status,startDate,endDate,totalDays,approverId FROM leave_applications WHERE applicantId IN (?)`, [users.length?users:['']]);
  const [exceptions] = native ? [native.exceptions] : await db.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM attendance_exceptions WHERE employeeId IN (?) AND status='PENDING'`, [ids.length?ids:['']]);
  const [assignments] = native ? [native.assignments] : await db.query<RowDataPacket[]>(`SELECT DISTINCT a.employeeId,s.shiftType,s.startTime FROM attendance_roster_assignments a JOIN attendance_roster_groups g ON g.id=COALESCE(a.groupId,a.rosterGroupId) LEFT JOIN attendance_roster_group_shifts gs ON (gs.groupId=g.id OR gs.rosterGroupId=g.id) AND gs.isDefault=1 LEFT JOIN attendance_shifts s ON s.id=gs.shiftId WHERE a.employeeId IN (?) AND a.status='Active' AND a.effectiveStartDate<=? AND (a.effectiveEndDate IS NULL OR a.effectiveEndDate>=?)`,[ids.length?ids:[''],date,date]);
  const [reviews] = native ? [native.reviews] : await db.query<RowDataPacket[]>('SELECT data FROM hr_performance_reviews WHERE employee_id IN (?)',[ids.length?ids:['']]);
  const performance = reviews.map(r=>typeof r.data==='string'?JSON.parse(r.data):r.data);
  const onLeave = new Set(leave.filter(l=>l.status==='APPROVED' && String(l.startDate).slice(0,10)<=date && String(l.endDate).slice(0,10)>=date).map(l=>l.applicantId));
  const present = new Set(attendance.filter(a=>a.inTime || ['Present','Late'].includes(a.status)).map(a=>a.employeeId));
  const absent = attendance.filter(a=>a.status==='Absent').length;
  const departments = [...new Set(employees.map(e=>e.department))].map(name=>({name,total:employees.filter(e=>e.department===name).length}));
  const assigned = new Set(assignments.map(a=>a.employeeId));
  return { scope:access.admin||access.isExecutive?'Company':access.isManager?'My team':'My profile', rank:access.organizationalRank,
    employees:employees.map(({userId,...e})=>e), totalEmployees:employees.length, departments,
    directReports:employees.filter(e=>e.managerId===access.employeeId).length,
    attendance:{date,present:present.size,absent,late:attendance.filter(a=>a.isLate).length,onLeave:onLeave.size,
      notRecorded:Math.max(0,employees.length-new Set([...present,...employees.filter(e=>onLeave.has(e.userId)).map(e=>e.id),...attendance.filter(a=>a.status==='Absent').map(a=>a.employeeId)]).size),pendingExceptions:Number(exceptions[0].n),
      roster:{total:employees.length,day:assignments.filter(a=>rosterCategory(a)==='day').length,late:assignments.filter(a=>rosterCategory(a)==='late').length,night:assignments.filter(a=>rosterCategory(a)==='night').length,rotational:assignments.filter(a=>rosterCategory(a)==='rotational').length,unassigned:employees.length-assigned.size}},
    leave:{pending:leave.filter(l=>String(l.status).startsWith('PENDING')).length,pendingForMe:leave.filter(l=>String(l.status).startsWith('PENDING')&&l.approverId===userId).length,onLeaveToday:onLeave.size},
    performance:{reviews:performance.length,open:performance.filter(r=>!r.closedAt).length,closed:performance.filter(r=>r.closedAt).length,cycles:new Set(performance.filter(r=>!r.closedAt).map(r=>r.cycleId)).size},
    own:employees.find(e=>e.id===access.employeeId)||null };
}

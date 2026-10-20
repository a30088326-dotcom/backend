import type { RowDataPacket } from 'mysql2/promise';
import { db } from '../../lib/db';
import { organizationAccess } from '../../shared/services/organization.service';
export async function monthlyAttendance(userId:string, year:unknown, month:unknown, company=false) {
  const y=Number(year||new Date().getFullYear()), m=Number(month||new Date().getMonth()+1);
  if (!Number.isInteger(y)||y<1900||y>2100||!Number.isInteger(m)||m<1||m>12) throw new Error('Select a valid year and month.');
  const access=await organizationAccess(userId);
  if (company&&!access.admin&&!access.isExecutive) throw new Error('Executive access required.');
  const ids=company?access.visibleIds:access.teamIds;
  const employees=access.employees.filter(e=>ids.includes(e.id)).map(e=>({id:e.id,employeeNo:e.employeeNumber,employeeName:e.name,department:e.department,designation:e.designation}));
  if(!ids.length) return {employees,attendance:{},leaves:{}};
  const from=`${y}-${String(m).padStart(2,'0')}-01`, to=`${y}-${String(m).padStart(2,'0')}-${new Date(y,m,0).getDate()}`;
  const [records]=await db.query<RowDataPacket[]>('SELECT employeeId,date,inTime,outTime,totalHours,status,isLate FROM attendance_records WHERE employeeId IN (?) AND date BETWEEN ? AND ? ORDER BY date',[ids,from,to]);
  const [leave]=await db.query<RowDataPacket[]>(`SELECT e.id AS employeeId,la.startDate,la.endDate,lt.name AS leaveType,lt.color AS colorCode FROM leave_applications la JOIN employee_information_employees e ON e.userId=la.applicantId JOIN leave_types lt ON lt.id=la.leaveTypeId WHERE e.id IN (?) AND la.status='APPROVED' AND la.startDate<=? AND la.endDate>=?`,[ids,to,from]);
  const attendance:Record<string,Record<string,unknown>>={}, leaves:Record<string,unknown[]>={};
  for(const row of records) { attendance[row.employeeId] ||= {}; attendance[row.employeeId][String(row.date).slice(0,10)]={...row,isLate:!!row.isLate}; }
  for(const row of leave) { leaves[row.employeeId] ||= []; leaves[row.employeeId].push(row); }
  return {employees,attendance,leaves};
}

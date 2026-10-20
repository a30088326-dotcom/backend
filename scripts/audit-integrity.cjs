// Read-only production integrity checks. Outputs counts, never personal records.
require('dotenv').config();
const mysql=require('mysql2/promise');
const fs=require('node:fs');
const path=require('node:path');
async function main(){
 const c=await mysql.createConnection(process.env.DATABASE_URL);
 try {
  const checks={};
  const queries={
   employeeMissingUser:'SELECT COUNT(*) n FROM employee_information_employees e LEFT JOIN users u ON u.id=e.userId WHERE u.id IS NULL',
   duplicateEmployeeUser:'SELECT COUNT(*) n FROM (SELECT userId FROM employee_information_employees WHERE userId IS NOT NULL GROUP BY userId HAVING COUNT(*)>1) q',
   employeeNameMismatch:`SELECT COUNT(*) n FROM employee_information_employees e JOIN employee_information_personal_details p ON p.employeeId=e.id WHERE (NULLIF(p.firstName,'') IS NOT NULL AND NOT(e.firstName<=>p.firstName)) OR (NULLIF(p.lastName,'') IS NOT NULL AND NOT(e.lastName<=>p.lastName))`,
   employeeDepartmentMismatch:'SELECT COUNT(*) n FROM employee_information_employees e JOIN employee_information_workstation_details w ON w.employeeId=e.id WHERE w.departmentId IS NOT NULL AND NOT(e.departmentId<=>w.departmentId)',
   employeeDesignationMismatch:'SELECT COUNT(*) n FROM employee_information_employees e JOIN employee_information_workstation_details w ON w.employeeId=e.id WHERE w.designationId IS NOT NULL AND NOT(e.designationId<=>w.designationId)',
   employeeNumberMissing:`SELECT COUNT(*) n FROM employee_information_employees WHERE (employeeNumber IS NULL OR employeeNumber='') AND employeeNo IS NOT NULL`,
   missingManager:'SELECT COUNT(*) n FROM employee_information_employees e LEFT JOIN employee_information_employees m ON m.id=e.reportingManagerId WHERE e.reportingManagerId IS NOT NULL AND m.id IS NULL',
   leaveEmployeeMapping:'SELECT COUNT(*) n FROM leave_applications a JOIN employee_information_employees e ON e.userId=a.applicantId WHERE NOT(a.employeeId<=>e.id)',
   leaveMissingApplicant:'SELECT COUNT(*) n FROM leave_applications a LEFT JOIN users u ON u.id=a.applicantId WHERE u.id IS NULL',
   pendingLeaveMissingApprover:`SELECT COUNT(*) n FROM leave_applications a LEFT JOIN users u ON u.id=a.approverId WHERE a.status LIKE 'PENDING%' AND (u.id IS NULL OR u.isActive=0)`,
   attendanceMissingEmployee:'SELECT COUNT(*) n FROM attendance_records a LEFT JOIN employee_information_employees e ON e.id=a.employeeId WHERE e.id IS NULL',
   rosterMissingEmployee:'SELECT COUNT(*) n FROM attendance_roster_assignments a LEFT JOIN employee_information_employees e ON e.id=a.employeeId WHERE e.id IS NULL',
   rosterMissingGroup:'SELECT COUNT(*) n FROM attendance_roster_assignments a LEFT JOIN attendance_roster_groups g ON g.id=COALESCE(a.groupId,a.rosterGroupId) WHERE g.id IS NULL',
   duplicateActiveRosters:`SELECT COUNT(*) n FROM (SELECT employeeId FROM attendance_roster_assignments WHERE status='Active' GROUP BY employeeId HAVING COUNT(*)>1) q`,
   reversedRosterDates:'SELECT COUNT(*) n FROM attendance_roster_assignments WHERE effectiveEndDate<effectiveStartDate',
   orphanPersonal:'SELECT COUNT(*) n FROM employee_information_personal_details p LEFT JOIN employee_information_employees e ON e.id=p.employeeId WHERE e.id IS NULL',
   orphanWorkstation:'SELECT COUNT(*) n FROM employee_information_workstation_details p LEFT JOIN employee_information_employees e ON e.id=p.employeeId WHERE e.id IS NULL',
   duplicateAttendanceDays:'SELECT COUNT(*) n FROM (SELECT employeeId,date FROM attendance_records GROUP BY employeeId,date HAVING COUNT(*)>1) q'
  };
  for(const [name,sql]of Object.entries(queries)){const [[row]]=await c.query(sql);checks[name]=Number(row.n);}
  const [fks]=await c.query(`SELECT TABLE_NAME,COLUMN_NAME,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME,CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL`);
  const foreignKeys=[];
  for(const f of fks){const [[row]]=await c.query('SELECT COUNT(*) n FROM ?? child LEFT JOIN ?? parent ON child.??=parent.?? WHERE child.?? IS NOT NULL AND parent.?? IS NULL',[f.TABLE_NAME,f.REFERENCED_TABLE_NAME,f.COLUMN_NAME,f.REFERENCED_COLUMN_NAME,f.COLUMN_NAME,f.REFERENCED_COLUMN_NAME]);foreignKeys.push({table:f.TABLE_NAME,column:f.COLUMN_NAME,missing:Number(row.n)});}
  const [[counts]]=await c.query(`SELECT (SELECT COUNT(*) FROM users) users,(SELECT COUNT(*) FROM employee_information_employees) employees,(SELECT COUNT(*) FROM leave_applications) leaves,(SELECT COUNT(*) FROM leave_types) leaveTypes,(SELECT COUNT(*) FROM leave_entitlements) entitlements`);
  const [[legacy]]=await c.query(`SELECT
    (SELECT COUNT(*) FROM leave_applications a LEFT JOIN users u ON u.id=a.approverId JOIN employee_information_employees m ON m.id=a.approverId JOIN users mapped ON mapped.id=m.userId WHERE a.status LIKE 'PENDING%' AND u.id IS NULL) derivablePendingApprovers,
    (SELECT COUNT(*) FROM attendance_records a LEFT JOIN employee_information_employees old ON old.id=a.employeeId JOIN employee_information_employees canonical ON canonical.userId=a.employeeId WHERE old.id IS NULL) derivableAttendanceEmployees`);
  const report={at:new Date().toISOString(),checks,foreignKeys,counts,legacy,readOnly:true};
  const dir=path.resolve(__dirname,'../repair-audit');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'system-integrity.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
 }finally{await c.end();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});

/** Repair only links derivable from existing records; never delete or guess identities. */
import 'dotenv/config';
import { db } from '../src/lib/db';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
async function main() {
 const c=await db.getConnection();
 try {
  await c.beginTransaction();
  const [employees]:any=await c.query(`SELECT e.id,e.firstName,e.lastName,e.employeeNumber,e.userId,u.name AS previousUserName,p.firstName AS mappedFirstName,p.lastName AS mappedLastName,e.employeeNo
   FROM employee_information_employees e JOIN employee_information_personal_details p ON p.employeeId=e.id JOIN users u ON u.id=e.userId
   WHERE (NULLIF(p.firstName,'') IS NOT NULL AND NOT(e.firstName<=>p.firstName)) OR (NULLIF(p.lastName,'') IS NOT NULL AND NOT(e.lastName<=>p.lastName)) OR ((e.employeeNumber IS NULL OR e.employeeNumber='') AND e.employeeNo IS NOT NULL)`);
  const [leaves]:any=await c.query(`SELECT a.id,a.applicantId,a.employeeId,a.approverId,
    COALESCE(byUser.userId,byEmployee.userId) AS mappedUserId,COALESCE(byUser.id,byEmployee.id) AS mappedEmployeeId
    FROM leave_applications a LEFT JOIN employee_information_employees byUser ON byUser.userId=a.applicantId
    LEFT JOIN employee_information_employees byEmployee ON byEmployee.id=a.applicantId
    JOIN users u ON u.id=COALESCE(byUser.userId,byEmployee.userId)
    WHERE NOT(a.applicantId<=>u.id) OR NOT(a.employeeId<=>COALESCE(byUser.id,byEmployee.id))`);
  if(!process.argv.includes('--apply')) { console.log(JSON.stringify({dryRun:true,employeeRepairs:employees.length,leaveRepairs:leaves.length}));await c.rollback();return; }
  const folder=resolve('backups');mkdirSync(folder,{recursive:true});
  const file=resolve(folder,`derived-mappings-${new Date().toISOString().replace(/[:.]/g,'-')}.json`);
  writeFileSync(file,JSON.stringify({employees,leaves},null,2),{flag:'wx'});
  for(const e of employees){
    await c.query('UPDATE employee_information_employees SET firstName=?,lastName=?,employeeNumber=COALESCE(NULLIF(employeeNumber,\'\'),employeeNo),updatedAt=NOW() WHERE id=?',[e.mappedFirstName||e.firstName,e.mappedLastName||e.lastName,e.id]);
    const name=[e.mappedFirstName||e.firstName,e.mappedLastName||e.lastName].filter(Boolean).join(' ');
    if(name)await c.query('UPDATE users SET name=?,updatedAt=NOW() WHERE id=?',[name,e.userId]);
  }
  for(const a of leaves)await c.query('UPDATE leave_applications SET applicantId=?,employeeId=?,updatedAt=NOW() WHERE id=?',[a.mappedUserId,a.mappedEmployeeId,a.id]);
  await c.commit();console.log(JSON.stringify({employeeRepairs:employees.length,leaveRepairs:leaves.length,backup:file,noDeletes:true,unresolvedLinksUnchanged:true}));
 }catch(e){await c.rollback();throw e;}finally{c.release();await db.end();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});

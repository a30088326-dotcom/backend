/** Uses the installed schema only; clones NO real user/employee data. */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import mysql from 'mysql2/promise';

async function main() {
  const source=new URL(process.env.DATABASE_URL||'mysql://root:@localhost:3306/hr_onboarding');
  const sourceName=source.pathname.slice(1), name='hr_assistant_test_'+randomUUID().replace(/-/g,'');
  assert(/^[A-Za-z0-9_]+$/.test(sourceName));
  const admin=await mysql.createConnection({host:source.hostname,port:Number(source.port||3306),user:decodeURIComponent(source.username),password:decodeURIComponent(source.password)});
  let pool:import('mysql2/promise').Pool|undefined,server:import('node:http').Server|undefined;
  try {
    await admin.query('CREATE DATABASE `'+name+'`');
    const [tables]=await admin.query<any[]>('SELECT TABLE_NAME t FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_TYPE=\'BASE TABLE\'',[sourceName]);
    for(const {t} of tables) {assert(/^[A-Za-z0-9_]+$/.test(t));await admin.query('CREATE TABLE `'+name+'`.`'+t+'` LIKE `'+sourceName+'`.`'+t+'`');}
    source.pathname='/'+name; process.env.DATABASE_URL=source.toString();process.env.SMTP_USER='';process.env.SMTP_PASS='';process.env.JWT_SECRET='isolated-test-only';
    const {db}=await import('../src/lib/db');pool=db;
    const {ensureSchema}=await import('../src/modules/assistant/store');await ensureSchema();
    const {generateToken}=await import('../src/middleware/auth');
    const {contextFor}=await import('../src/modules/assistant/policy');
    const {invoke,confirm}=await import('../src/modules/assistant/runtime');
    const owner=randomUUID(),employee=randomUUID(),delegate=randomUUID();
    for(const [id,first,role,rank] of [[owner,'Owner','SUPER_ADMIN','OWNER'],[employee,'Detail','EMPLOYEE','EMPLOYEE'],[delegate,'Delegate','EMPLOYEE','MANAGER']]) {
      await db.query('INSERT INTO users (id,email,password,name,role,isActive,mustChangePassword,createdAt,updatedAt) VALUES (?,?,?, ?,?,1,0,NOW(),NOW())',[id,first.toLowerCase()+'@assistant.test','not-a-login-hash',first+' Test',role]);
      await db.query('INSERT INTO employee_information_employees (id,userId,employeeNumber,employeeNo,firstName,lastName,status,employeeStatus,isActive,organizationalRank,reportingManagerId,createdAt,updatedAt) VALUES (?,?,?,?,?,\'Test\',\'Active\',\'Active\',1,?,?,NOW(),NOW())',[id,id,'TEST-'+first,'TEST-'+first,first,rank,id===owner?null:owner]);
      await db.query('INSERT INTO employee_information_personal_details (id,employeeId,firstName,lastName,fullName) VALUES (?,?,?,?,?)',[randomUUID(),id,first,'Test',first+' Test']);
    }
    await db.query('INSERT INTO employee_information_contact_details (id,employeeId,permanent,working,official,residential,linkedIn) VALUES (?,?,?,?,?,?,?)',[randomUUID(),employee,JSON.stringify({address:'Original address'}),JSON.stringify({city:'Original city'}),JSON.stringify({email:'work@assistant.test'}),JSON.stringify({personal:{email:'personal@assistant.test',mobile:'0000000000'},emergencyContacts:[{name:'Contact Test',primaryPhone:'0000000001'}]}),'https://www.linkedin.com/in/original']);
    const type=randomUUID();await db.query('INSERT INTO employment_types (id,name,code) VALUES (?,?,?)',[type,'Test Full Time','TEST_FT']);
    await db.query('INSERT INTO user_module_permissions (id,userId,moduleId,moduleAccess,canView,canCreate,canEdit,canDelete,canApprove,canExport,dataScope) VALUES (?,?,\'employee_information\',1,1,1,1,1,1,1,\'ALL\')',[randomUUID(),delegate]);
    const express=(await import('express')).default;const app=express();app.use(express.json());
    app.use('/api/employee_information/audit',(await import('../src/modules/employee_information/employee_information_audit.routes')).default);
    app.use('/api/attendance',(await import('../src/modules/attendance/attendance.routes')).default);
    app.use('/api/access-control',(await import('../src/modules/access_control/access_control.routes')).default);
    server=app.listen(0,'127.0.0.1');await once(server,'listening');process.env.PORT=String((server.address() as import('node:net').AddressInfo).port);
    const context=async(id:string)=>contextFor(id,'Bearer '+generateToken({userId:id,role:id===owner?'SUPER_ADMIN':'EMPLOYEE',email:'unused@assistant.test'}));
    const grantPreview=await invoke(await context(owner),'users.grantModule',{employee:'TEST-Delegate',module:'employee_information'},randomUUID());assert.equal(grantPreview.kind,'confirmation');await confirm(await context(owner),grantPreview.actionId!);
    const [[grantSaved]]=await db.query<any[]>('SELECT dataScope FROM user_module_permissions WHERE userId=? AND moduleId=\'employee_information\'',[delegate]);assert.equal(grantSaved.dataScope,'ALL');
    console.log('PASS: Full-access grant persists using the installed dataScope enum.');
    async function change(field:string,value:string) {console.log('Checking field:',field);const p=await invoke(await context(delegate),'employee.updateDetails',{employee:'TEST-Detail',field,value},randomUUID());assert.equal(p.kind,'confirmation');const result=await confirm(await context(delegate),p.actionId!);assert.match(result.result.message,/updated and verified/);}
    await change('firstName','Updated'); await change('personalEmail','new-personal@assistant.test');await change('mobile','0000000002');await change('employmentType','Test Full Time');await change('dateJoined','2026-01-05');await change('payrollNo','PAY-TEST');
    const [[saved]]=await db.query<any[]>('SELECT * FROM employee_information_employees WHERE id=?',[employee]);assert.equal(saved.firstName,'Updated');assert.equal(saved.employmentTypeId,type);assert.equal(saved.employmentType,'Test Full Time');assert.equal(saved.payrollNo,'PAY-TEST');assert.equal(saved.reportingManagerId,owner);
    const [[user]]=await db.query<any[]>('SELECT email,name FROM users WHERE id=?',[employee]);assert.equal(user.name,'Updated Test');assert.equal(user.email,'detail@assistant.test');
    const [[contact]]=await db.query<any[]>('SELECT * FROM employee_information_contact_details WHERE employeeId=?',[employee]);assert.equal(JSON.parse(contact.permanent).address,'Original address');assert.equal(JSON.parse(contact.official).email,'work@assistant.test');assert.equal(JSON.parse(contact.residential).emergencyContacts.length,1);assert.equal(JSON.parse(contact.residential).personal.email,'new-personal@assistant.test');assert.equal(JSON.parse(contact.residential).personal.mobile,'0000000002');
    const bad=await invoke(await context(delegate),'employee.updateDetails',{employee:'TEST-Detail',field:'role',value:'SUPER_ADMIN'},randomUUID());assert.equal(bad.kind,'form');
    console.log('PASS: Employee updates preserve unrelated contact, manager and login data; employment mappings and names stay synchronized.');
    const shift=await invoke(await context(owner),'attendance.createShift',{code:'TEST_SHIFT',name:'Test Shift',startTime:'09:00',endTime:'17:00',breakDuration:60},randomUUID());assert.equal(shift.kind,'confirmation');const shiftSaved=await confirm(await context(owner),shift.actionId!);assert(shiftSaved.result.recordId);
    const group=randomUUID();await db.query('INSERT INTO attendance_roster_groups (id,code,name,status) VALUES (?,?,?,\'Active\')',[group,'TEST_GROUP','Test roster group']);
    await db.query('INSERT INTO attendance_roster_group_shifts (id,groupId,shiftId,isDefault,displayOrder) VALUES (?,?,?,1,0)',[randomUUID(),group,shiftSaved.result.recordId]);
    const assignment=await invoke(await context(owner),'attendance.assignRoster',{employee:'TEST-Detail',group:'test_group',startDate:'2026-01-05'},randomUUID());assert.equal(assignment.kind,'confirmation');await confirm(await context(owner),assignment.actionId!);
    const [[roster]]=await db.query<any[]>('SELECT groupId FROM attendance_roster_assignments WHERE employeeId=? AND status=\'Active\'',[employee]);assert.equal(roster.groupId,group);
    console.log('PASS: Canonical shift creation and case-insensitive roster assignment persist against the installed schema.');
    const candidate=randomUUID();await db.query('INSERT INTO users (id,email,password,name,role,isActive,mustChangePassword,createdAt,updatedAt) VALUES (?,?,?, ?,\'CANDIDATE\',1,0,NOW(),NOW())',[candidate,'candidate@assistant.test','not-a-login-hash','Candidate Test']);
    await db.query('INSERT INTO onboarding_profiles (id,candidateId,firstName,lastName,phoneNumber) VALUES (?,?,?,?,?)',[randomUUID(),candidate,'Candidate','Test','0000000003']);
    for(const t of ['NATIONAL_ID','BANK_STATEMENT','PASSPORT_PHOTO'])await db.query('INSERT INTO documents (id,candidateId,type,label,status,fileUrl,fileName,fileSize,fileType,createdAt,updatedAt) VALUES (?,?,?,?,\'APPROVED\',\'test-only\',\'test.pdf\',\'1 KB\',\'PDF\',NOW(),NOW())',[randomUUID(),candidate,t,t]);
    const contract=randomUUID();await db.query('INSERT INTO contracts (id,candidateId,title,templateContent,renderedContent,fieldValues,status,createdById,createdAt,updatedAt) VALUES (?,?,\'Test agreement\',\'Test\',\'Test\',\'{}\',\'SENT\',?,NOW(),NOW())',[contract,candidate,owner]);
    const company=randomUUID(),location=randomUUID(),department=randomUUID(),designation=randomUUID();
    await db.query('INSERT INTO eim_companies (id,name) VALUES (?,\'Test Company\')',[company]);await db.query('INSERT INTO eim_locations (id,name) VALUES (?,\'Test Location\')',[location]);await db.query('INSERT INTO eim_structures (id,name,structureType) VALUES (?,\'Test Department\',\'Department\')',[department]);await db.query('INSERT INTO designations (id,name) VALUES (?,\'Test Job\')',[designation]);
    const activation={email:'candidate@assistant.test',joinDate:'2026-01-05',company,location,department,designation,employmentType:type,roster:group,manager:'TEST-Owner'};
    await assert.rejects(async()=>invoke(await context(owner),'onboarding.complete',activation,randomUUID()),/sign the employment agreement/);
    await db.query('UPDATE contracts SET status=\'SIGNED\' WHERE id=?',[contract]);
    const activate=await invoke(await context(owner),'onboarding.complete',activation,randomUUID());assert.equal(activate.kind,'confirmation');const activated=await confirm(await context(owner),activate.actionId!);
    const [[newEmployee]]=await db.query<any[]>('SELECT * FROM employee_information_employees WHERE id=?',[activated.result.recordId]);assert.equal(newEmployee.userId,candidate);assert.equal(newEmployee.departmentId,department);assert.equal(newEmployee.reportingManagerId,owner);assert.equal(newEmployee.status,'Active');
    const [[newUser]]=await db.query<any[]>('SELECT role FROM users WHERE id=?',[candidate]);assert.equal(newUser.role,'EMPLOYEE');
    const [[newAssignment]]=await db.query<any[]>('SELECT groupId FROM attendance_roster_assignments WHERE employeeId=?',[newEmployee.id]);assert.equal(newAssignment.groupId,group);
    await assert.rejects(async()=>invoke(await context(owner),'onboarding.complete',activation,randomUUID()),/not already an employee/);
    console.log('PASS: Signed candidate activation links employee, login, organization, manager and roster; unsigned and duplicate activation are blocked.');
  } finally {if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));if(pool)await pool.end();if(/^hr_assistant_test_[a-f0-9]{32}$/.test(name))await admin.query('DROP DATABASE `'+name+'`');await admin.end();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});

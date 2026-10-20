/** Whole-system audit on a private copy. Never writes to the source HR database. */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { randomUUID, randomBytes } from 'node:crypto';
import { writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { once } from 'node:events';
import assert from 'node:assert/strict';

async function main() {
  const source = new URL(process.env.DATABASE_URL || 'mysql://root:@localhost:3306/hr_onboarding');
  const originalDatabase = source.pathname.slice(1);
  const testDatabase = `hr_system_audit_${randomUUID().replace(/-/g, '')}`;
  const connection = await mysql.createConnection({ host: source.hostname, port: Number(source.port || 3306), user: decodeURIComponent(source.username), password: decodeURIComponent(source.password), dateStrings: true });
  let server: any, pool: any;
  const checks: any[] = [], failures: any[] = [];
  const uploadPrefix=`audit-${randomUUID()}-`;
  const reportDirectory = resolve('repair-audit'); mkdirSync(reportDirectory, { recursive: true });
  const check = (name: string, fn: () => unknown) => {
    try { fn(); checks.push({ name, passed: true }); }
    catch (e: any) { checks.push({ name, passed: false }); failures.push({ name, message: e.message }); console.log(`FAIL: ${name}: ${e.message}`); }
  };
  try {
    await connection.query('CREATE DATABASE ??', [testDatabase]);
    await connection.query('USE ??', [testDatabase]);
    await connection.query('SET FOREIGN_KEY_CHECKS=0');
    const [tables]: any = await connection.query('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_TYPE=\'BASE TABLE\'', [originalDatabase]);
    for (const { TABLE_NAME: table } of tables) {
      const [definition]: any = await connection.query('SHOW CREATE TABLE ??.??', [originalDatabase, table]);
      await connection.query(definition[0]['Create Table']);
      await connection.query('INSERT INTO ?? SELECT * FROM ??.??', [table, originalDatabase, table]);
    }
    await connection.query('SET FOREIGN_KEY_CHECKS=1');
    source.pathname = `/${testDatabase}`;
    process.env.DATABASE_URL = source.toString(); process.env.JWT_SECRET = randomBytes(32).toString('hex');
    // Do not email real staff from the copied database.
    process.env.SMTP_USER = ''; process.env.SMTP_PASS = '';
    process.env.PORT = '3107';
    const { db } = await import('../src/lib/db'); pool = db;
    await (await import('../src/modules/employee_information/profile-requests')).ensureProfileRequestStorage();
    const bcrypt = (await import('bcryptjs')).default;
    const password = randomBytes(18).toString('base64url');
    const ids = { admin: randomUUID(), manager: randomUUID(), employee: randomUUID(), outsider: randomUUID() };
    const tokens: Record<string, string> = {};
    const { generateToken } = await import('../src/middleware/auth');
    for (const who of Object.keys(ids) as (keyof typeof ids)[]) {
      const role = who === 'admin' ? 'SUPER_ADMIN' : 'EMPLOYEE';
      await db.query('INSERT INTO users (id,email,password,name,role,isActive,mustChangePassword,createdAt,updatedAt) VALUES (?,?,?,?,?,1,0,NOW(),NOW())', [ids[who], `audit-${who}@example.test`, await bcrypt.hash(password, 10), `Audit ${who}`, role]);
      tokens[who] = generateToken({ userId: ids[who], email: `audit-${who}@example.test`, role });
    }
    const [[department]]: any = await db.query("SELECT id,name FROM eim_structures WHERE structureType='Department' LIMIT 1");
    const [[designation]]: any = await db.query('SELECT id,name FROM designations LIMIT 1');
    const [[employmentType]]: any = await db.query('SELECT id,name FROM employment_types LIMIT 1');
    for (const who of ['admin', 'manager', 'outsider'] as const) {
      await db.query(`INSERT INTO employee_information_employees (id,userId,employeeNo,employeeNumber,firstName,lastName,status,employeeStatus,isActive,organizationalRank,dateJoined,departmentId,department,designationId,designation) VALUES (?,?,?,?,'Audit',?,'Active','Active',1,?,'2024-01-01',?,?,?,?)`, [ids[who], ids[who], `AUDIT-${who}`, `AUDIT-${who}`, who, who === 'manager' ? 'MANAGER' : 'EMPLOYEE', department.id, department.name, designation.id, designation.name]);
    }
    const express = (await import('express')).default; const app = express();
    app.use((await import('cors')).default({origin:['http://localhost:5181','http://127.0.0.1:5181']}));
    app.use(express.json());
    app.use('/uploads',express.static(resolve('uploads')));
    const routes: Record<string, string> = {
      auth: 'auth/auth.routes', users: 'auth/users.routes', invites: 'onboarding/invites.routes', onboarding: 'onboarding/onboarding.routes', documents: 'onboarding/documents.routes', contracts: 'onboarding/contracts.routes',
      'employee_information/audit': 'employee_information/employee_information_audit.routes', leaves: 'leave-management/routes/index', 'leave-management': 'leave/leave.routes', attendance: 'attendance/attendance.routes', eim: 'eim/eim.routes', 'reporting-hierarchy': 'reporting_hierarchy/reporting_hierarchy.routes', 'access-control': 'access_control/access_control.routes', performance: 'performance/performance.routes', assistant: 'assistant/routes'
    };
    for (const [prefix, file] of Object.entries(routes)) app.use(`/api/${prefix}`, (await import(`../src/modules/${file}`)).default);
    app.use('/api/organization', (await import('../src/shared/organization.routes')).default);
    app.use((err: any, _req: any, res: any, _next: any) => res.status(500).json({ success: false, message: err.message }));
    server = app.listen(3107); await once(server, 'listening');
    async function request(who: string, method: string, path: string, body?: unknown, expected = 200) {
      const response = await fetch(`http://127.0.0.1:3107${path}`, { method, headers: { 'Content-Type': 'application/json', ...(tokens[who] ? { Authorization: `Bearer ${tokens[who]}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(25000) });
      let result: any; try { result = await response.json(); } catch { result = {}; }
      check(`${who} ${method} ${path}`, () => assert.equal(response.status, expected, result.message || result.error || `HTTP ${response.status}`));
      return result;
    }
    await request('anonymous', 'GET', '/api/auth/me', undefined, 401);
    await request('anonymous', 'POST', '/api/auth/login', { email: 'audit-employee@example.test', password });
    const created = await request('admin', 'POST', '/api/employee_information/audit', {
      userId: ids.employee,
      personalDetails: { firstName: 'Audit', lastName: 'Employee', fullName: 'Audit Employee', gender: 'Male' },
      employmentDetails: { dateJoined: '2024-01-01', employmentTypeId: employmentType.id, probationStatus: 'Confirmed', organizationalRank: 'EMPLOYEE' },
      workstationDetails: { departmentId: department.id, designationId: designation.id, supervisorId: ids.manager },
      contactDetails: { official: { email: 'audit-employee@example.test' } }
    }, 201);
    const employeeId = created.data?.id;
    if (!employeeId) throw new Error('Demo employee creation failed; cannot continue employee workflows.');
    const onboarding={firstName:'Audit',lastName:'Outsider',dateOfBirth:'2000-01-01',gender:'Male',nationality:'Sri Lankan',addressLine1:'Audit road',city:'Colombo',phoneNumber:'0770000000',emergencyContactName:'Audit parent',emergencyContactRelation:'Father',emergencyContactPhone:'0770000001',bankName:'Audit bank',accountHolderName:'Audit outsider',accountNumber:'12345678',accountType:'SAVINGS',currency:'LKR'};
    await request('outsider','POST','/api/onboarding',{...onboarding,emergencyContactRelation:'Friend'},400);
    await request('outsider','POST','/api/onboarding',{...onboarding,dateOfBirth:'2000-02-30'},400);
    await request('outsider','POST','/api/onboarding',onboarding,201);
    const onboardingSaved=await request('outsider','GET','/api/onboarding');
    check('Onboarding contact and bank fields persist',()=>{assert.equal(onboardingSaved.data.emergencyContactRelation,'Father');assert.equal(onboardingSaved.data.accountNumber,'12345678');});
    check('New employee canonical mapping', () => {
      assert.equal(created.data.firstName, 'Audit'); assert.equal(created.data.departmentId, department.id);
      assert.equal(created.data.designationId, designation.id); assert.ok(created.data.employeeNumber);
      assert.equal(created.data.reportingManagerId, ids.manager);
    });
    const common = ['/api/auth/me','/api/organization/dashboard','/api/users/me','/api/employee_information/audit/me','/api/reporting-hierarchy/tree?mode=all','/api/reporting-hierarchy/my-node','/api/reporting-hierarchy/my-manager','/api/performance/workspace','/api/attendance/my-today','/api/attendance/my-shift','/api/attendance/my-attendance/history','/api/attendance/my-exceptions','/api/leaves/types','/api/leaves/years','/api/leaves/entitlements','/api/leaves/applications','/api/leaves/holidays','/api/assistant/capabilities','/api/assistant/notifications'];
    for (const who of ['employee','manager','admin']) for (const path of common) await request(who, 'GET', path);
    const eimReads = ['dashboard-stats','companies','locations','structures','hierarchy-config','cost-centres','designations','salary-grades','corporate-titles','employment-types','employee-titles','functions','functional-roles','statutory-classifications','qual-types','quals','qual-classifications','subjects','rating-methods','languages','proficiency-levels','genders','marital-statuses','nationalities','religions','blood-groups','relationship-types','attachment-types','currencies','membership-types','extracurricular-categories','extracurricular-types','geography','benefits','dynamic-fields','audit-logs'];
    for (const path of eimReads) await request('admin','GET',`/api/eim/${path}`);
    for (const path of ['/api/access-control/users','/api/leaves/team/dashboard','/api/leaves/ceo/applications','/api/leaves/rules/scripts','/api/leave-management/types','/api/leave-management/groups','/api/leave-management/reports/entitlements','/api/attendance/shifts','/api/attendance/roster-groups','/api/attendance/assignments','/api/attendance/dashboard','/api/attendance/records','/api/attendance/exceptions','/api/attendance/team-monthly','/api/attendance/organization-monthly','/api/attendance/team-exceptions','/api/reporting-hierarchy/employees','/api/reporting-hierarchy/audit','/api/reporting-hierarchy/unassigned','/api/reporting-hierarchy/levels','/api/documents','/api/invites','/api/contracts','/api/assistant/admin']) await request('admin','GET',path);
    await request('outsider','GET',`/api/employee_information/audit/${employeeId}`,undefined,403);
    await request('outsider','GET',`/api/employee_information/audit/attachments/${employeeId}`,undefined,403);
    await request('employee','GET',`/api/employee_information/audit/attachments/${employeeId}`);
    async function upload(who:string,path:string,field:string,documentType?:string,expected=201) {
      const data=new FormData();
      data.append(field,new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64')],{type:'image/png'}),`${uploadPrefix}${randomUUID()}.png`);
      if(documentType)data.append('documentType',documentType);
      const r=await fetch(`http://127.0.0.1:3107${path}`,{method:'POST',headers:{Authorization:`Bearer ${tokens[who]}`},body:data});
      const json:any=await r.json();check(`${who} upload ${documentType||field}`,()=>assert.equal(r.status,expected,json.message));return json;
    }
    const attachment=await upload('employee',`/api/employee_information/audit/attachments/${employeeId}`,'files',undefined,200);
    check('Employee attachment persisted',()=>assert.ok(attachment.data?.[0]?.id));
    if(attachment.data?.[0]?.id)await request('outsider','DELETE',`/api/employee_information/audit/attachments/${attachment.data[0].id}`,undefined,403);
    await upload('outsider',`/api/employee_information/audit/attachments/${employeeId}`,'files',undefined,403);
    const documents=[];
    for(let i=0;i<4;i++)documents.push(await upload('employee','/api/documents/upload','file','NATIONAL_ID'));
    await upload('employee','/api/documents/upload','file','NATIONAL_ID',409);
    if(documents[0]?.data?.id)await request('admin','PATCH',`/api/documents/${documents[0].data.id}/verify`,{status:'APPROVED'});
    if(documents[1]?.data?.id)await request('admin','PATCH',`/api/documents/${documents[1].data.id}/verify`,{status:'REJECTED',rejectionNote:'Audit retry'});
    const retry=await upload('employee','/api/documents/upload','file','NATIONAL_ID');
    check('Rejected document re-upload preserves category limit',()=>assert.equal(retry.data?.id,documents[1]?.data?.id));
    const linkedDocs=await request('employee','GET',`/api/employee_information/audit/attachments/${employeeId}`);
    check('Verified onboarding document maps to employee attachments',()=>assert.ok(linkedDocs.data?.some((d:any)=>d.id===documents[0]?.data?.id&&d.status==='Verified')));
    for(const category of ['BANK_STATEMENT','PASSPORT_PHOTO','EMPLOYMENT_DOCS','PREVIOUS_SERVICE']){
      for(let i=0;i<4;i++)await upload('employee','/api/documents/upload','file',category);
      await upload('employee','/api/documents/upload','file',category,409);
    }
    const invalidFile=new FormData();invalidFile.append('file',new Blob(['test'],{type:'text/plain'}),`${uploadPrefix}invalid.txt`);invalidFile.append('documentType','OTHER');
    const invalidUpload=await fetch('http://127.0.0.1:3107/api/documents/upload',{method:'POST',headers:{Authorization:`Bearer ${tokens.employee}`},body:invalidFile});
    check('Invalid document format returns input error, not Server Error',()=>assert.equal(invalidUpload.status,400));
    await request('admin','PUT',`/api/employee_information/audit/${employeeId}`,{personalDetails:{firstName:'Audit',lastName:'Updated'},workstationDetails:{departmentId:department.id,designationId:designation.id}});
    const edited = await request('employee','GET','/api/employee_information/audit/me');
    check('Profile edit stays mapped for employee',()=>assert.equal(edited.data.firstName,'Audit'));
    const profilePath='/api/employee_information/audit/profile-requests';
    await request('outsider','POST',profilePath,{section:'qualifications',operation:'add',values:{qualification:'BSc',type:'Degree',institute:'Audit Institute',year:'2024'},reason:'Missing manager'},409);
    await request('employee','POST',profilePath,{section:'basic',operation:'update',values:{role:'SUPER_ADMIN'},reason:'Invalid fields'},400);
    const profileExamples:Record<string,any>={
      basic:{firstName:'Audit',lastName:'Updated',fullName:'Audit Updated',title:'Mr.',gender:'Male',dob:'1998-01-01',maritalStatus:'Single',nationality:'Sri Lankan'},
      contact:{address:'Audit street',city:'Colombo',country:'Sri Lanka',mobile:'0770000000',telephone:'0110000000',email:'audit-contact@example.test',workingAddress:'Audit office'},
      emergency:{name:'Audit parent',relationship:'Father',primaryPhone:'0770000001'},
      dependents:{name:'Audit dependent',relationship:'Child',dob:'2020-01-01',gender:'Female'},
      qualifications:{qualification:'BSc',type:'Degree',institute:'Audit Institute',year:'2024'},
      workExperience:{role:'Engineer',company:'Audit prior company',from:'2020-01-01',to:'2023-12-31'},
      expertise:{skill:'Audit skill',domain:'Technology'},
      memberships:{organization:'Audit association',number:'123',type:'Member',expiry:'2030-01-01'},
      bank:{bankName:'Audit bank',branch:'Colombo',accountNo:'123456789',accountHolderName:'Audit Updated',accountType:'Savings',currency:'LKR'},
      identification:{nicNo:'199812345678',passportNo:'N1234567'}
    };
    for(const [section,values] of Object.entries(profileExamples)){
      const operation=['basic','contact','identification'].includes(section)?'update':'add';
      const before=await request('employee','GET','/api/employee_information/audit/me');
      const submitted=await request('employee','POST',profilePath,{section,operation,values,reason:`Audit ${section} request`},201);
      const inbox=await request('manager','GET',profilePath+'/team');
      check(`Manager receives ${section} request`,()=>assert.ok(inbox.data?.some((r:any)=>r.id===submitted.data?.id)));
      const unchanged=await request('employee','GET','/api/employee_information/audit/me');
      check(`${section} waits for approval`,()=>assert.deepEqual(unchanged.data,before.data));
      if(submitted.data?.id){
        await request('outsider','PATCH',profilePath+`/${submitted.data.id}/resolve`,{action:'APPROVED'},403);
        await request('manager','PATCH',profilePath+`/${submitted.data.id}/resolve`,{action:'APPROVED'});
        await request('manager','PATCH',profilePath+`/${submitted.data.id}/resolve`,{action:'APPROVED'},409);
      }
    }
    const updated=await request('employee','GET','/api/employee_information/audit/me');
    check('Approved professional records mapped to profile',()=>assert.equal(updated.data.otherDetails.qualifications[0].qualification,'BSc'));
    check('Approved dependents mapped to profile',()=>assert.equal(updated.data.payrollDetails.dependents[0].name,'Audit dependent'));
    check('Approved contact changes preserve official email',()=>assert.equal(updated.data.contactDetails.official.email,'audit-employee@example.test'));
    const bank=updated.data.bankDetails.find((b:any)=>b.bankName==='Audit bank');
    const bankUpdate=await request('employee','POST',profilePath,{section:'bank',operation:'update',itemId:bank?.id,values:{...profileExamples.bank,accountNo:'987654321'},reason:'Bank update'},201);
    if(bankUpdate.data?.id)await request('manager','PATCH',profilePath+`/${bankUpdate.data.id}/resolve`,{action:'APPROVED'});
    const qual=updated.data.otherDetails.qualifications[0];
    const removal=await request('employee','POST',profilePath,{section:'qualifications',operation:'remove',itemId:qual?.id,values:{},reason:'Audit remove'},201);
    if(removal.data?.id){await request('manager','PATCH',profilePath+`/${removal.data.id}/resolve`,{action:'REJECTED'},400);await request('manager','PATCH',profilePath+`/${removal.data.id}/resolve`,{action:'REJECTED',reason:'Keep audit qualification'});}
    const cancelledProfile=await request('employee','POST',profilePath,{section:'expertise',operation:'add',values:{skill:'Cancelled skill',domain:''},reason:'Audit cancel'},201);
    if(cancelledProfile.data?.id){await request('employee','PATCH',profilePath+`/${cancelledProfile.data.id}/cancel`);await request('manager','PATCH',profilePath+`/${cancelledProfile.data.id}/resolve`,{action:'APPROVED'},409);}
    const stale=await request('employee','POST',profilePath,{section:'identification',operation:'update',values:{nicNo:'199899999999',passportNo:'N1234567'},reason:'Stale request test'},201);
    await db.query('UPDATE employee_information_personal_details SET nicNo=? WHERE employeeId=?',['199800000000',employeeId]);
    if(stale.data?.id)await request('manager','PATCH',profilePath+`/${stale.data.id}/resolve`,{action:'APPROVED'},409);
    const [[safe]]:any=await db.query('SELECT nicNo FROM employee_information_personal_details WHERE employeeId=?',[employeeId]);
    check('Stale approval cannot overwrite newer profile details',()=>assert.equal(safe.nicNo,'199800000000'));
    // Create/edit/delete each simple EIM lookup using synthetic names only.
    for (const resource of ['genders','marital-statuses','nationalities','religions','blood-groups','relationship-types','attachment-types','languages','subjects','qual-types','qual-classifications','rating-methods','proficiency-levels','membership-types','extracurricular-categories']) {
      const name=`Audit ${resource}`;
      await request('admin','POST',`/api/eim/${resource}`,{name,code:`A${randomUUID().slice(0,7)}`,description:'Synthetic audit',isActive:true},201);
      const list = await request('admin','GET',`/api/eim/${resource}`);
      const row = list.data?.find((r:any)=>r.name===name);
      check(`EIM ${resource} persisted`,()=>assert.ok(row?.id));
      if(row) {
        await request('admin','PUT',`/api/eim/${resource}/${row.id}`,{...row,name:`${name} edited`});
        await request('admin','DELETE',`/api/eim/${resource}/${row.id}`);
      }
    }
    await request('employee','GET','/api/access-control/users',undefined,403);
    // Request submit → assigned manager inbox → decision → employee history/balance.
    const leaveTypeId = randomUUID(), leaveYearId = randomUUID();
    await db.query("UPDATE leave_years SET isActive=0");
    await db.query("INSERT INTO leave_years (id,year,displayName,isActive,startDate,endDate,createdAt,updatedAt) VALUES (?,2090,'Audit year',1,'2090-01-01','2090-12-31',NOW(),NOW())", [leaveYearId]);
    await db.query("INSERT INTO leave_types (id,code,name,color,isActive,allowHalfDays,commentMandatory,yearlyEntitlement,createdAt,updatedAt) VALUES (?,'AUDIT','Audit leave','#2563eb',1,1,1,20,NOW(),NOW())",[leaveTypeId]);
    await db.query('INSERT INTO leave_entitlements (id,userId,leaveTypeId,leaveYearId,totalDays,usedDays,pendingDays,carryForwardDays,earnedDays,createdAt,updatedAt) VALUES (?,?,?,?,20,0,0,0,20,NOW(),NOW())',[randomUUID(),ids.employee,leaveTypeId,leaveYearId]);
    const payload = { leaveTypeId,startDate:'2090-10-10',endDate:'2090-10-10',totalDays:1,reason:'Synthetic audit request' };
    const leave = await request('employee','POST','/api/leaves/applications',payload,201);
    if (leave.data?.id) {
      check('Leave user/employee/approver mapping',()=>{ assert.equal(leave.data.applicantId,ids.employee);assert.equal(leave.data.employeeId,employeeId);assert.equal(leave.data.approverId,ids.manager); });
      await request('employee','POST','/api/leaves/applications',payload,409);
      await request('outsider','PATCH',`/api/leaves/applications/${leave.data.id}/approve`,{action:'APPROVED'},403);
      const inbox = await request('manager','GET','/api/leaves/team/dashboard');
      check('Manager sees demo leave request',()=>assert.ok(inbox.data?.pendingApprovals?.some((a:any)=>a.id===leave.data.id)));
      await request('manager','PATCH',`/api/leaves/applications/${leave.data.id}/approve`,{action:'APPROVED'});
      await request('manager','PATCH',`/api/leaves/applications/${leave.data.id}/approve`,{action:'APPROVED'},409);
      await request('employee','GET',`/api/leaves/applications/${leave.data.id}/history`);
      const [[balance]]:any = await db.query('SELECT usedDays,pendingDays FROM leave_entitlements WHERE userId=? AND leaveTypeId=?',[ids.employee,leaveTypeId]);
      check('Approval updates balance once',()=>{assert.equal(Number(balance.usedDays),1);assert.equal(Number(balance.pendingDays),0);});
    }
    const rejected = await request('employee','POST','/api/leaves/applications',{...payload,startDate:'2090-10-11',endDate:'2090-10-11'},201);
    if (rejected.data?.id) await request('manager','PATCH',`/api/leaves/applications/${rejected.data.id}/approve`,{action:'REJECTED',rejectedReason:'Audit rejection'});
    const canceled = await request('employee','POST','/api/leaves/applications',{...payload,startDate:'2090-10-12',endDate:'2090-10-12'},201);
    if (canceled.data?.id) await request('employee','PATCH',`/api/leaves/applications/${canceled.data.id}/cancel`,{cancelReason:'Audit cancellation'});
    await request('employee','POST','/api/attendance/exceptions/missed-punch',{date:'2026-10-01',inTime:'09:00',outTime:'18:00',reason:'Synthetic audit correction'},201);
    const exceptions = await request('employee','GET','/api/attendance/my-exceptions');
    const exception = exceptions.data?.find((e:any)=>e.date==='2026-10-01');
    check('Attendance request appears for employee',()=>assert.ok(exception?.id));
    if (exception) {
      const inbox = await request('manager','GET','/api/attendance/team-exceptions');
      check('Attendance request appears for manager',()=>assert.ok(inbox.data?.some((e:any)=>e.id===exception.id)));
      await request('manager','POST',`/api/attendance/exceptions/${exception.id}/resolve`,{status:'APPROVED',resolutionNotes:'Audit approved'});
      const history = await request('employee','GET','/api/attendance/my-attendance/history');
      check('Approved correction updates hours',()=>assert.ok(history.data?.some((r:any)=>r.date==='2026-10-01'&&Number(r.totalHours)===9)));
    }
    // Bulk import must resolve both canonical employee and login user IDs.
    await request('admin','POST','/api/leaves/applications/bulk',[{empId:created.data.employeeNo,leaveTypeCode:'AUDIT',startDate:'2090-10-13',endDate:'2090-10-13',totalDays:1,reason:'Audit bulk'}],201);
    const [[bulk]]:any = await db.query("SELECT applicantId,employeeId FROM leave_applications WHERE comments='Audit bulk' ORDER BY createdAt DESC LIMIT 1");
    check('Bulk leave import maps to employee, not administrator',()=>{assert.equal(bulk?.applicantId,ids.employee);assert.equal(bulk?.employeeId,employeeId);});
    await request('admin','DELETE',`/api/users/${ids.employee}`,undefined,409);
    const [[retained]]:any=await db.query('SELECT COUNT(*) n FROM users WHERE id=?',[ids.employee]);
    check('Deleting an employee cannot erase request history',()=>assert.equal(Number(retained.n),1));
    const report = { at:new Date().toISOString(),sourceDatabase:originalDatabase,testDatabase,uploadPrefix,checks,failures,sourceWrites:0 };
    writeFileSync(resolve(reportDirectory,'system-integration.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({checks:checks.length,passed:checks.length-failures.length,failures,report:'repair-audit/system-integration.json'},null,2));
    if (process.env.SYSTEM_AUDIT_KEEP === '1') {
      await db.query('UPDATE leave_years SET isActive=IF(year=?,1,0)',[new Date().getFullYear()]);
      writeFileSync(resolve(reportDirectory,'system-audit-credentials.json'),JSON.stringify({testDatabase,api:'http://127.0.0.1:3107',employeeEmail:'audit-employee@example.test',managerEmail:'audit-manager@example.test',adminEmail:'audit-admin@example.test',password,employeeId}));
      console.log('Isolated audit server ready for browser checks. No real emails or source DB writes.');
      await new Promise<void>(done=>{process.once('SIGTERM',done);process.once('SIGINT',done);});
    }
    if (failures.length) process.exitCode=1;
  } finally {
    if(server) await new Promise<void>(done=>server.close(()=>done()));
    if(pool) await pool.end();
    for(const file of readdirSync(resolve('uploads')))if(file.includes(uploadPrefix))unlinkSync(resolve('uploads',file));
    // Only this random, newly-created test database may be removed.
    if(/^hr_system_audit_[a-f0-9]{32}$/.test(testDatabase)&&testDatabase!==originalDatabase) await connection.query('DROP DATABASE IF EXISTS ??',[testDatabase]);
    await connection.end();
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});

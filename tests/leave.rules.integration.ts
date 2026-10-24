/** Exercises the existing leave policy and approval workflow in an isolated DB. */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import mysql from 'mysql2/promise';

async function main() {
  const source = new URL(process.env.DATABASE_URL!);
  const testName = `hr_leave_test_${randomUUID().replace(/-/g, '')}`;
  const admin = await mysql.createConnection({ host: source.hostname, port: Number(source.port) || 3306,
    user: decodeURIComponent(source.username), password: decodeURIComponent(source.password), multipleStatements: true });
  let pool: import('mysql2/promise').Pool | undefined;
  const checks: string[] = [];
  const check = (name: string) => { checks.push(name); console.log(`PASS: ${name}`); };
  try {
    await admin.query('CREATE DATABASE ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci', [testName]);
    await admin.query('USE ??', [testName]);
    await admin.query(readFileSync('database/schema.sql', 'utf8'));
    source.pathname = `/${testName}`; process.env.DATABASE_URL = source.toString();
    process.env.SMTP_USER = ''; process.env.SMTP_PASS = '';
    const { db } = await import('../src/lib/db'); pool = db;
    const { LeaveRulesEvaluator } = await import('../src/modules/leave-management/services/leaveRulesEvaluator');
    const { processEntitlementsForEmployee } = await import('../src/modules/leave/leave.controller');
    const { submitLeave, decideLeave, cancelLeave } = await import('../src/modules/leave-management/services/application.service');
    const employee = randomUUID(), manager = randomUUID(), employeeUser = randomUUID(), managerUser = randomUUID();
    const year = new Date().getFullYear();
    for (const [id, name] of [[employeeUser, 'Employee'], [managerUser, 'Manager']]) {
      await db.query("INSERT INTO users (id,email,name,role,isActive) VALUES (?,?,?,'EMPLOYEE',1)", [id, `${id}@leave.test`, name]);
    }
    for (const [id, user, rank] of [[manager, managerUser, 'MANAGER'], [employee, employeeUser, 'EMPLOYEE']]) {
      await db.query("INSERT INTO employee_information_employees (id,userId,employeeNo,employeeNumber,firstName,lastName,status,isActive,dateJoined,probationStatus,organizationalRank,reportingManagerId) VALUES (?,?,?,?,?,'Test','Active',1,?,'Confirmed',?,?)",
        [id, user, id, id, rank, `${year - 3}-01-01`, rank, id === employee ? manager : null]);
    }
    await db.query("INSERT INTO employee_information_personal_details (id,employeeId,gender) VALUES (?,?,'Male')", [randomUUID(), employee]);
    const types: Record<string, string> = {};
    for (const [code, name] of [['ANN', 'Annual Leave'], ['CAS', 'Casual Leave'], ['MED', 'Medical Leave'], ['MAT', 'Maternity Leave'], ['PAT', 'Paternity Leave']]) {
      types[code] = randomUUID();
      await db.query('INSERT INTO leave_types (id,code,name,isActive,allowHalfDays,yearlyEntitlement) VALUES (?,?,?,1,1,0)', [types[code], code, name]);
    }
    const evaluate = (code: string, script?: string) => LeaveRulesEvaluator.evaluate({ employeeId: employee, leaveTypeId: types[code], leaveYear: year }, script);
    const join = (date: string, probation = 'Confirmed') => db.query('UPDATE employee_information_employees SET dateJoined=?,probationStatus=? WHERE id=?', [date, probation, employee]);
    await join(`${year}-01-01`);
    assert.equal((await evaluate('ANN')).entitlement, 0); assert.equal((await evaluate('MED')).entitlement, 0);
    check('Existing joined-year annual and medical rules remain zero');
    for (const [month, days] of [[1, 14], [4, 10], [7, 7], [10, 4]]) {
      await join(`${year - 1}-${String(month).padStart(2, '0')}-01`);
      assert.equal((await evaluate('ANN')).entitlement, days);
    }
    check('Existing second-year annual quarter rules: 14 / 10 / 7 / 4');
    await join(`${year - 1}-06-01`); assert.equal((await evaluate('MED')).entitlement, 3);
    await join(`${year - 3}-01-01`); assert.equal((await evaluate('ANN')).entitlement, 14);
    assert.equal((await evaluate('MED')).entitlement, 7); assert.equal((await evaluate('CAS')).entitlement, 7);
    check('Existing medical proration and confirmed-staff annual/medical/casual totals');
    await join(`${year}-01-01`, 'Probation');
    assert.equal((await evaluate('CAS')).entitlement, 6); assert.equal((await evaluate('ANN')).entitlement, 0);
    check('Existing probation policy: casual six, annual unavailable');
    await join(`${year - 3}-01-01`);
    const genderId = randomUUID(); await db.query("INSERT INTO eim_genders (id,name) VALUES (?,'Male')", [genderId]);
    await db.query('UPDATE employee_information_personal_details SET gender=? WHERE employeeId=?', [genderId, employee]);
    assert.equal((await evaluate('PAT')).entitlement, 1); assert.equal((await evaluate('MAT')).entitlement, 0);
    await db.query("UPDATE employee_information_personal_details SET gender='Female' WHERE employeeId=?", [employee]);
    assert.equal((await evaluate('MAT')).entitlement, 84); assert.equal((await evaluate('PAT')).entitlement, 0);
    check('Existing gender-based rules accept both onboarding lookup IDs and legacy names');
    const custom = 'output.entitlement=11; output.carryForwardAmount=2;';
    assert.equal((await evaluate('ANN', custom)).entitlement, 11);
    assert.equal((await evaluate('ANN', custom)).carryForwardAmount, 2);
    check('Custom rule assignment works with or without whitespace');
    await db.query('INSERT INTO leave_rule_scripts (id,name,content,isDefault) VALUES (?,?,?,0)', [randomUUID(), 'Annual_Leave_Sri_Lanka', custom]);
    await processEntitlementsForEmployee(employee);
    const [[allocation]]: any = await db.query('SELECT * FROM leave_entitlements WHERE userId=? AND leaveTypeId=?', [employeeUser, types.ANN]);
    assert.equal(Number(allocation.totalDays), 11); assert.equal(Number(allocation.carryForwardDays), 2);
    check('Saved type-specific custom rule and carry-forward reach the employee balance');
    await db.query('UPDATE leave_entitlements SET usedDays=2,pendingDays=1 WHERE id=?', [allocation.id]);
    await processEntitlementsForEmployee(employee);
    const [[preserved]]: any = await db.query('SELECT usedDays,pendingDays FROM leave_entitlements WHERE id=?', [allocation.id]);
    assert.equal(Number(preserved.usedDays), 2); assert.equal(Number(preserved.pendingDays), 1);
    check('Recalculation preserves used and pending balances');
    await db.query('DELETE FROM leave_rule_scripts');
    await processEntitlementsForEmployee(employee);
    const [[manualCarry]]: any = await db.query('SELECT carryForwardDays FROM leave_entitlements WHERE id=?', [allocation.id]);
    assert.equal(Number(manualCarry.carryForwardDays),2);
    check('Default recalculation preserves existing carry-forward when no custom rule changes it');
    await db.query('UPDATE leave_entitlements SET usedDays=0,pendingDays=0,carryForwardDays=0 WHERE userId=?', [employeeUser]);
    const actor = { userId: employeeUser, role: 'EMPLOYEE' }, approver = { userId: managerUser, role: 'EMPLOYEE' };
    const payload = { leaveTypeId: types.ANN, startDate: `${year}-12-01`, endDate: `${year}-12-01`, totalDays: 1, reason: 'Isolated workflow test' };
    const request = await submitLeave(actor, payload);
    await assert.rejects(submitLeave(actor, payload), /overlap/i);
    await assert.rejects(decideLeave(actor, request.id, 'APPROVED'), /own request/i);
    await assert.rejects(decideLeave({userId: randomUUID(),role:'EMPLOYEE'}, request.id, 'APPROVED'), /assigned approver/i);
    await decideLeave(approver, request.id, 'APPROVED');
    await assert.rejects(decideLeave(approver, request.id, 'APPROVED'), /already been actioned/i);
    const [[approved]]: any = await db.query('SELECT usedDays,pendingDays FROM leave_entitlements WHERE id=?', [allocation.id]);
    assert.equal(Number(approved.usedDays), 1); assert.equal(Number(approved.pendingDays), 0);
    check('Submit, manager approval, overlap/self-approval restrictions and one-time balance update');
    const canceled = await submitLeave(actor, {...payload,startDate:`${year}-12-02`,endDate:`${year}-12-02`});
    await cancelLeave(employeeUser,canceled.id,'Test cancellation');
    const rejected = await submitLeave(actor, {...payload,startDate:`${year}-12-03`,endDate:`${year}-12-03`});
    await decideLeave(approver,rejected.id,'REJECTED','Test rejection');
    const [[finalBalance]]: any = await db.query('SELECT usedDays,pendingDays FROM leave_entitlements WHERE id=?', [allocation.id]);
    assert.equal(Number(finalBalance.usedDays),1);assert.equal(Number(finalBalance.pendingDays),0);
    check('Cancellation and rejection release reserved days without consuming leave');
    mkdirSync('repair-audit',{recursive:true});
    writeFileSync('repair-audit/leave-rules-validation.json',JSON.stringify({at:new Date().toISOString(),checks,passed:checks.length,policy:'Existing project rules, unchanged allocations',sourceWrites:0},null,2));
    console.log(`${checks.length} leave rule and workflow groups passed.`);
  } finally {
    if(pool) await pool.end();
    assert.match(testName,/^hr_leave_test_[a-f0-9]{32}$/);
    await admin.query('DROP DATABASE IF EXISTS ??',[testName]);await admin.end();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});

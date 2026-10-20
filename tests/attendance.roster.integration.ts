import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import type { RowDataPacket } from 'mysql2/promise';
import { db } from '../src/lib/db';
import { assignRoster, RosterError, validateRosterShifts, validRosterDate } from '../src/modules/attendance/roster.service';
import { assignEmployees, createRosterGroup, updateRosterGroup, getAssignments, getRosterGroups, getMyShift } from '../src/modules/attendance/attendance.controller';

async function invoke(handler: any, req: any) {
  let status = 200, body: any;
  await handler(req, { status(code: number) { status = code; return this; }, json(data: any) { body = data; return this; } });
  return { status, body };
}

async function main() {
  assert.equal(validRosterDate('2026-02-30'), false);
  assert.equal(validRosterDate('2026-10-02'), true);
  const conn = await db.getConnection();
  const originalGetConnection = db.getConnection.bind(db);
  const originalError = console.error;
  // Controller commits/releases are intercepted: every test write is rolled back.
  const sandbox = new Proxy(conn, { get(target, key) {
    if (key === 'commit' || key === 'release' || key === 'beginTransaction') return async () => {};
    const value = (target as any)[key]; return typeof value === 'function' ? value.bind(target) : value;
  } });
  try {
    const [[admin]] = await db.query<RowDataPacket[]>("SELECT id FROM users WHERE role='SUPER_ADMIN' AND isActive=1 LIMIT 1");
    const [[employee]] = await db.query<RowDataPacket[]>("SELECT id,userId FROM employee_information_employees WHERE status='Active' AND isActive=1 AND userId IS NOT NULL LIMIT 1");
    const [shifts] = await db.query<RowDataPacket[]>("SELECT id FROM attendance_shifts WHERE status='Active' ORDER BY id LIMIT 2");
    assert.ok(admin && employee && shifts.length === 2, 'Test needs one admin, employee and two configured shifts.');
    const user = { userId: admin.id };
    (db as any).getConnection = async () => sandbox;
    await conn.beginTransaction();
    const groupId = randomUUID(), code = `TEST-${groupId.slice(0, 8)}`;
    const payload = { code, name: 'Rollback-only roster test', rosterCycle: 'Monthly', minRestHours: 8, maxConsecutiveDays: 6, status: 'Active',
      shifts: [{ shiftId: shifts[0].id, isDefault: true, displayOrder: 0 }, { shiftId: shifts[1].id, isDefault: false, displayOrder: 1 }],
      calendarAssignments: [{ date: '2026-10-04', shiftId: shifts[1].id, isOffDay: false }] };
    let result = await invoke(createRosterGroup, { user, body: payload });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    const [[group]] = await conn.query<RowDataPacket[]>('SELECT id FROM attendance_roster_groups WHERE code=?', [code]);
    const [mapping] = await conn.query<RowDataPacket[]>('SELECT * FROM attendance_roster_group_shifts WHERE groupId=?', [group.id]);
    assert.equal(mapping.length, 2);
    assert.ok(mapping.every(m => m.groupId === m.rosterGroupId));
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' });
    result = await invoke(assignEmployees, { user, body: { employeeIds: [employee.id], groupId: group.id, effectiveStartDate: today } });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    await assignRoster(conn, employee.id, group.id, today);
    const [active] = await conn.query<RowDataPacket[]>("SELECT * FROM attendance_roster_assignments WHERE employeeId=? AND status='Active'", [employee.id]);
    assert.equal(active.length, 1);
    assert.equal(active[0].groupId, group.id);
    assert.equal(active[0].rosterGroupId, group.id);
    assert.equal(active[0].shiftId, shifts[0].id);
    assert.equal(active[0].effectiveStartDate, active[0].effectiveFrom);
    const [[dates]] = await conn.query<RowDataPacket[]>('SELECT COUNT(*) count FROM attendance_roster_assignments WHERE employeeId=? AND effectiveEndDate<effectiveStartDate', [employee.id]);
    assert.equal(dates.count, 0, 'Same-day changes must not reverse history dates.');
    await assert.rejects(assignRoster(conn, employee.id, group.id, '2026-02-30'), RosterError);
    await assert.rejects(assignRoster(conn, randomUUID(), group.id, today), RosterError);
    await assert.rejects(validateRosterShifts(conn, [{ shiftId: randomUUID(), isDefault: true }], []), RosterError);
    await assert.rejects(validateRosterShifts(conn, [null], []), RosterError);
    // Repeated editing must replace both legacy and canonical links, not accumulate them.
    const updated = { ...payload, shifts: payload.shifts.map((s,i) => ({ ...s, isDefault: i === 1 })), calendarAssignments: [] };
    result = await invoke(updateRosterGroup, { user, params: { id: group.id }, body: updated });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    const [saved] = await conn.query<RowDataPacket[]>('SELECT * FROM attendance_roster_group_shifts WHERE groupId=? OR rosterGroupId=?', [group.id,group.id]);
    assert.equal(saved.length, 2);
    const [[assigned]] = await conn.query<RowDataPacket[]>("SELECT shiftId FROM attendance_roster_assignments WHERE employeeId=? AND status='Active'", [employee.id]);
    assert.equal(assigned.shiftId, shifts[1].id);
    console.error = () => {}; // Expected validation failures are asserted, not server crashes.
    result = await invoke(updateRosterGroup, { user, params: { id: group.id }, body: { ...updated, shifts: [payload.shifts[0]] } });
    assert.equal(result.status, 400, 'Cannot remove a shift used by an unchanged calendar date.');
    // The invalid request rolled back all the test writes. No fixture remains in the DB.
    const [[remaining]] = await conn.query<RowDataPacket[]>('SELECT COUNT(*) count FROM attendance_roster_groups WHERE code=?', [code]);
    assert.equal(remaining.count, 0);
    console.error = originalError;
    (db as any).getConnection = originalGetConnection;
    await conn.rollback();
    assert.equal((await invoke(getAssignments, { user })).status, 200);
    assert.equal((await invoke(getRosterGroups, { user })).status, 200);
    assert.equal((await invoke(getMyShift, { user: { userId: employee.userId } })).status, 200);
    console.log('PASS: roster create/update, calendar preservation, employee assignment, same-day history, validation, read APIs; test writes rolled back.');
  } finally {
    console.error = originalError;
    (db as any).getConnection = originalGetConnection;
    await conn.rollback(); conn.release();
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => db.end());

import 'dotenv/config';
import { randomUUID } from 'crypto';
import type { RowDataPacket } from 'mysql2/promise';
import { db } from '../src/lib/db';
import { validRosterDate } from '../src/modules/attendance/roster.service';

// Dry-run by default. --apply stores original rows in the database before repairing.
// No employee, shift, roster, calendar, attendance record or assignment is deleted.
async function main() {
  const apply = process.argv.includes('--apply');
  const runId = randomUUID();
  const tables = ['attendance_roster_assignments', 'attendance_roster_group_shifts', 'attendance_roster_groups', 'attendance_roster_calendars'];
  const conn = await db.getConnection();
  try {
    if (apply) await conn.query(`CREATE TABLE IF NOT EXISTS attendance_roster_repair_backups (
      id VARCHAR(36) PRIMARY KEY, runId VARCHAR(36) NOT NULL, tableName VARCHAR(64) NOT NULL,
      rowId VARCHAR(36) NOT NULL, rowData JSON NOT NULL, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX repair_run (runId)
    ) ENGINE=InnoDB`);
    await conn.beginTransaction();
    const originals: Record<string, RowDataPacket[]> = {};
    // Same lock order as roster writes: rosters first, then employee/assignment rows.
    for (const table of [tables[2], tables[1], tables[0], tables[3]]) {
      const [rows] = await conn.query<RowDataPacket[]>(`SELECT * FROM ${table} ORDER BY id FOR UPDATE`);
      originals[table] = rows;
      if (apply) for (const row of rows) await conn.query(
        'INSERT INTO attendance_roster_repair_backups (id,runId,tableName,rowId,rowData) VALUES (?,?,?,?,?)',
        [randomUUID(), runId, table, row.id, JSON.stringify(row)]);
    }
    const [employees] = await conn.query<RowDataPacket[]>('SELECT id FROM employee_information_employees');
    const [shifts] = await conn.query<RowDataPacket[]>('SELECT id FROM attendance_shifts');
    const employeeIds = new Set(employees.map(e => e.id));
    const shiftIds = new Set(shifts.map(s => s.id));
    const [recordCounts] = await conn.query<RowDataPacket[]>('SELECT COUNT(*) count FROM attendance_records');
    const groups = originals.attendance_roster_groups;
    const groupIds = new Set(groups.map(g => g.id));
    const assignments = originals.attendance_roster_assignments;
    const mappings = originals.attendance_roster_group_shifts;
    const summary = { assignmentsNormalized: 0, archivedOrphans: 0, recoveredRosterDefaults: 0, incompleteUnassignedDrafts: 0 };
    const defaults = new Map<string, string>();
    for (const g of groups) {
      const linked = mappings.filter(m => (m.groupId || m.rosterGroupId) === g.id);
      const existingDefault = linked.filter(m => m.isDefault === 1);
      if (existingDefault.length > 1) throw new Error(`Multiple default shifts for roster ${g.id}; manual review needed.`);
      if (existingDefault.length === 1) {
        if (!shiftIds.has(existingDefault[0].shiftId)) throw new Error('Default shift not found.');
        defaults.set(g.id, existingDefault[0].shiftId);
      } else {
        const evidence = [...new Set(assignments.filter(a => a.status === 'Active' && employeeIds.has(a.employeeId) &&
          (a.groupId || a.rosterGroupId) === g.id && shiftIds.has(a.shiftId)).map(a => a.shiftId))];
        if (linked.length === 0 && evidence.length === 1) {
          const shiftId = evidence[0];
          await conn.query('INSERT INTO attendance_roster_group_shifts (id,groupId,rosterGroupId,shiftId,isDefault,displayOrder) VALUES (?,?,?,?,1,0)',
            [randomUUID(), g.id, g.id, shiftId]);
          defaults.set(g.id, shiftId);
          summary.recoveredRosterDefaults++;
        } else if (g.status === 'Draft' && linked.length === 0 && !assignments.some(a => a.status === 'Active' && (a.groupId || a.rosterGroupId) === g.id)) {
          summary.incompleteUnassignedDrafts++;
        } else throw new Error(`Cannot infer a default shift safely for roster ${g.id}.`);
      }
    }
    for (const m of mappings) {
      const groupId = m.groupId || m.rosterGroupId;
      if (!groupIds.has(groupId) || !shiftIds.has(m.shiftId)) throw new Error('Invalid roster-shift mapping needs review.');
      if (m.groupId !== groupId || m.rosterGroupId !== groupId) {
        await conn.query('UPDATE attendance_roster_group_shifts SET groupId=?,rosterGroupId=? WHERE id=?', [groupId, groupId, m.id]);
      }
    }
    for (const a of assignments) {
      const groupId = a.groupId || a.rosterGroupId;
      if (!groupIds.has(groupId)) throw new Error('Missing roster needs manual review.');
      if (!employeeIds.has(a.employeeId)) {
        if (a.status === 'Active') {
          await conn.query("UPDATE attendance_roster_assignments SET status='Inactive' WHERE id=?", [a.id]);
          summary.archivedOrphans++;
        }
        continue; // Preserve the full old mapping as inactive history.
      }
      const start = a.effectiveStartDate || a.effectiveFrom || (a.createdAt instanceof Date ? a.createdAt.toISOString().slice(0, 10) : String(a.createdAt).slice(0, 10));
      const end = a.effectiveEndDate || a.effectiveTo || null;
      if (!validRosterDate(start) || (end && (!validRosterDate(end) || end < start))) throw new Error('Assignment date needs manual review.');
      const shiftId = a.status === 'Active' ? defaults.get(groupId) : a.shiftId;
      if (a.status === 'Active' && !shiftId) throw new Error('Active assignment has no roster default.');
      if (a.groupId !== groupId || a.rosterGroupId !== groupId || a.shiftId !== shiftId || a.effectiveStartDate !== start ||
          a.effectiveFrom !== start || a.effectiveEndDate !== end || a.effectiveTo !== end) {
        await conn.query(`UPDATE attendance_roster_assignments SET groupId=?,rosterGroupId=?,shiftId=?,
          effectiveStartDate=?,effectiveFrom=?,effectiveEndDate=?,effectiveTo=? WHERE id=?`, [groupId, groupId, shiftId, start, start, end, end, a.id]);
        summary.assignmentsNormalized++;
      }
    }
    const [bad] = await conn.query<RowDataPacket[]>(`SELECT COUNT(*) count FROM attendance_roster_assignments a
      LEFT JOIN employee_information_employees e ON e.id=a.employeeId
      LEFT JOIN attendance_roster_groups g ON g.id=a.groupId
      LEFT JOIN attendance_roster_group_shifts m ON m.groupId=a.groupId AND m.shiftId=a.shiftId AND m.isDefault=1
      WHERE a.status='Active' AND (e.id IS NULL OR g.id IS NULL OR m.id IS NULL OR a.groupId<>a.rosterGroupId
        OR a.rosterGroupId IS NULL OR a.effectiveStartDate IS NULL)`);
    if (bad[0].count) throw new Error('Post-repair assignment validation failed.');
    for (const table of [tables[0], tables[2], tables[3]]) {
      const [rows] = await conn.query<RowDataPacket[]>(`SELECT COUNT(*) count FROM ${table}`);
      if (rows[0].count !== originals[table].length) throw new Error(`Unexpected row count change in ${table}.`);
    }
    const [after] = await conn.query<RowDataPacket[]>(`SELECT (SELECT COUNT(*) FROM employee_information_employees) employees,
      (SELECT COUNT(*) FROM attendance_shifts) shifts,(SELECT COUNT(*) FROM attendance_records) records`);
    if (after[0].employees !== employees.length || after[0].shifts !== shifts.length || after[0].records !== recordCounts[0].count) {
      throw new Error('Unrelated data changed during repair.');
    }
    if (apply) await conn.commit(); else await conn.rollback();
    console.log(JSON.stringify({ mode: apply ? 'applied' : 'dry-run rolled back', backupRunId: apply ? runId : null, ...summary }));
  } catch (error) { await conn.rollback(); throw error; }
  finally { conn.release(); }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => db.end());

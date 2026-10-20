import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { randomUUID } from 'crypto';

export class RosterError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function validRosterDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export async function rosterDefault(connection: PoolConnection, groupId: string) {
  const [groups] = await connection.query<RowDataPacket[]>(
    "SELECT id FROM attendance_roster_groups WHERE id=? AND status IN ('Active','Draft') FOR UPDATE", [groupId]);
  if (!groups.length) throw new RosterError(400, 'Selected roster is unavailable.');
  const [shifts] = await connection.query<RowDataPacket[]>(
    `SELECT s.id FROM attendance_roster_group_shifts m JOIN attendance_shifts s ON s.id=m.shiftId
     WHERE (m.groupId=? OR m.rosterGroupId=?) AND m.isDefault=1`, [groupId, groupId]);
  if (shifts.length !== 1) throw new RosterError(400, 'Configure exactly one default shift for this roster before assigning employees.');
  return String(shifts[0].id);
}

// Caller owns the transaction. Locking the employee serializes simultaneous assignments.
export async function assignRoster(connection: PoolConnection, employeeId: string, groupId: string, start: string, end?: string | null) {
  if (!validRosterDate(start) || (end != null && (!validRosterDate(end) || end < start))) {
    throw new RosterError(400, 'Enter valid assignment dates; the end date cannot precede the start date.');
  }
  const shiftId = await rosterDefault(connection, groupId);
  const [employees] = await connection.query<RowDataPacket[]>(
    "SELECT id FROM employee_information_employees WHERE id=? AND status='Active' AND COALESCE(isActive,1)=1 FOR UPDATE", [employeeId]);
  if (!employees.length) throw new RosterError(400, 'Employee is inactive or does not exist.');
  const [previous] = await connection.query<RowDataPacket[]>(
    "SELECT id, effectiveStartDate FROM attendance_roster_assignments WHERE employeeId=? AND status='Active' FOR UPDATE", [employeeId]);
  if (previous.some(row => row.effectiveStartDate && String(row.effectiveStartDate) > start)) {
    throw new RosterError(409, 'A later roster assignment already exists. Choose a date on or after that assignment.');
  }
  await connection.query(
    `UPDATE attendance_roster_assignments SET status='Inactive',
     effectiveEndDate=GREATEST(COALESCE(effectiveStartDate,effectiveFrom,?),DATE_SUB(?,INTERVAL 1 DAY)),
     effectiveTo=GREATEST(COALESCE(effectiveStartDate,effectiveFrom,?),DATE_SUB(?,INTERVAL 1 DAY)),updatedAt=NOW()
     WHERE employeeId=? AND status='Active'`, [start, start, start, start, employeeId]);
  const id = randomUUID();
  await connection.query(
    `INSERT INTO attendance_roster_assignments
     (id,employeeId,groupId,rosterGroupId,shiftId,effectiveStartDate,effectiveEndDate,effectiveFrom,effectiveTo,status)
     VALUES (?,?,?,?,?,?,?,?,?,'Active')`, [id, employeeId, groupId, groupId, shiftId, start, end || null, start, end || null]);
  return { id, rosterGroupId: groupId, shiftId };
}

export async function validateRosterShifts(connection: PoolConnection, shifts: unknown, calendar: unknown, preservedShiftIds: string[] = []) {
  if (!Array.isArray(shifts) || !shifts.length || shifts.some(s => !s || typeof s !== 'object') || shifts.filter(s => s.isDefault === true || s.isDefault === 1).length !== 1 ||
      shifts.some(s => typeof s.shiftId !== 'string' || !s.shiftId) || new Set(shifts.map(s => s.shiftId)).size !== shifts.length) {
    throw new RosterError(400, 'Select valid, unique shifts and exactly one default shift.');
  }
  const ids = shifts.map(s => s.shiftId);
  const [found] = await connection.query<RowDataPacket[]>('SELECT id,status FROM attendance_shifts WHERE id IN (?)', [ids]);
  if (found.length !== ids.length) throw new RosterError(400, 'One of the selected shifts no longer exists. Refresh the shifts and try again.');
  if (found.some(s => s.status === 'Archived' && !preservedShiftIds.includes(s.id))) {
    throw new RosterError(400, 'A selected shift was deleted. Refresh and select another created shift.');
  }
  if (calendar != null && (!Array.isArray(calendar) || calendar.some(a => !a || !validRosterDate(a.date) ||
      (!a.clear && !a.isOffDay && !ids.includes(a.shiftId))) || new Set(calendar.map(a => a.date)).size !== calendar.length)) {
    throw new RosterError(400, 'Each calendar date must be valid and use a shift linked to this roster, or an off day.');
  }
}

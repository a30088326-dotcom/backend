import { repository } from '../../storage/repository';
import { visibleLaunchRecords } from '../../modules/performance/store.dynamo';
export async function dashboardInputsNative(ids: string[], users: string[], date: string) {
  const repo = repository(), employeeIds = new Set(ids), userIds = new Set(users);
  const [attendance, leave, exceptions, assignments, groups, defaults, shifts, reviews] = await Promise.all([
    repo.find('attendance_records', a => employeeIds.has(a.employeeId) && String(a.date).slice(0, 10) === date),
    repo.find('leave_applications', l => userIds.has(l.applicantId)),
    repo.find('attendance_exceptions', e => employeeIds.has(e.employeeId) && String(e.status).toUpperCase() === 'PENDING'),
    repo.find('attendance_roster_assignments', a => employeeIds.has(a.employeeId) && a.status === 'Active'
      && String(a.effectiveStartDate || a.effectiveFrom).slice(0, 10) <= date && (!(a.effectiveEndDate || a.effectiveTo) || String(a.effectiveEndDate || a.effectiveTo).slice(0, 10) >= date)),
    repo.find('attendance_roster_groups', () => true), repo.find('attendance_roster_group_shifts', r => !!r.isDefault),
    repo.find('attendance_shifts', () => true), repo.find('hr_performance_reviews', r => employeeIds.has(r.employee_id)),
  ]);
  const roster = new Map<string, any>();
  for (const assignment of assignments) {
    const group = groups.find(g => g.id === (assignment.groupId || assignment.rosterGroupId));
    if (!group) continue;
    const matches = defaults.filter(d => (d.groupId || d.rosterGroupId) === group.id);
    for (const d of matches.length ? matches : [null]) {
      const shift = shifts.find(s => s.id === d?.shiftId);
      const row = { employeeId: assignment.employeeId, shiftType: shift?.shiftType || null, startTime: shift?.startTime || null };
      roster.set(JSON.stringify(row), row);
    }
  }
  return { attendance, leave, exceptions: [{ n: exceptions.length }], assignments: [...roster.values()], reviews: await visibleLaunchRecords(reviews) };
}

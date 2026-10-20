import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { changeReporting, type Rank } from './organization.service';

export async function syncEmployeeMappings(c: PoolConnection, employeeId: string) {
  const [rows] = await c.query<RowDataPacket[]>(`SELECT e.*, w.departmentId AS wd, w.designationId AS wj, w.companyId AS wc, w.locationId AS wl, w.jobProfileId AS wp FROM employee_information_employees e LEFT JOIN employee_information_workstation_details w ON w.employeeId=e.id WHERE e.id=?`, [employeeId]);
  const e = rows[0]; if (!e) throw new Error('Employee not found.');
  const departmentId = e.wd || e.departmentId; const designationId = e.wj || e.designationId;
  const [[department]] = await c.query<RowDataPacket[]>('SELECT name FROM eim_structures WHERE id=?', [departmentId]);
  const [[designation]] = await c.query<RowDataPacket[]>('SELECT name FROM designations WHERE id=?', [designationId]);
  const [[type]] = await c.query<RowDataPacket[]>('SELECT name FROM employment_types WHERE id=?', [e.employmentTypeId]);
  if (departmentId && !department) throw new Error('Selected department does not exist.');
  if (designationId && !designation) throw new Error('Selected designation does not exist.');
  if (e.employmentTypeId && !type) throw new Error('Selected employment type does not exist.');
  if (e.wp) {
    const [[profile]] = await c.query<RowDataPacket[]>('SELECT designationId, departmentId FROM eim_job_profiles WHERE id=?', [e.wp]);
    // An old profile must not silently describe a different job after a transfer.
    if (!profile || (profile.designationId && profile.designationId !== designationId) || (profile.departmentId && profile.departmentId !== departmentId)) {
      await c.query('UPDATE employee_information_workstation_details SET jobProfileId=NULL WHERE employeeId=?', [employeeId]);
      e.wp = null;
    }
  }
  await c.query(`UPDATE employee_information_employees SET departmentId=?,department=?,designationId=?,designation=?,companyId=?,locationId=?,jobProfileId=?,employmentType=?,status=IF(isActive=0,'Inactive',employeeStatus),updatedAt=NOW() WHERE id=?`, [departmentId || null, department?.name || e.department, designationId || null, designation?.name || e.designation, e.wc || e.companyId, e.wl || e.locationId, e.wp || null, type?.name || e.employmentType, employeeId]);
  await c.query('UPDATE employee_information_workstation_details SET employmentTypeId=? WHERE employeeId=?', [e.employmentTypeId, employeeId]);
  await c.query(`UPDATE employee_information_employees e JOIN users u ON u.id=e.userId
    SET e.employeeNumber=COALESCE(NULLIF(e.employeeNumber,''),e.employeeNo),e.email=u.email WHERE e.id=?`, [employeeId]);
  const [[personal]] = await c.query<RowDataPacket[]>('SELECT firstName,lastName FROM employee_information_personal_details WHERE employeeId=?', [employeeId]);
  if (personal) {
    await c.query('UPDATE employee_information_employees SET firstName=?,lastName=? WHERE id=?', [personal.firstName,personal.lastName,employeeId]);
    await c.query('UPDATE users SET name=?,updatedAt=NOW() WHERE id=?', [[personal.firstName,personal.lastName].filter(Boolean).join(' '),e.userId]);
  }
}

export async function updateEmployeeReporting(c: PoolConnection, employeeId: string, body: any, actorId: string) {
  const [[employee]] = await c.query<RowDataPacket[]>('SELECT reportingManagerId, organizationalRank FROM employee_information_employees WHERE id=?', [employeeId]);
  if (!employee) throw new Error('Employee not found.');
  const ws = body.workstationDetails || {}; const employment = body.employmentDetails || {};
  const supplied = ws.reportingManagerId !== undefined ? ws.reportingManagerId : ws.supervisorId;
  const rank = employment.organizationalRank ?? body.organizationalRank ?? employee.organizationalRank;
  if (supplied !== undefined || rank !== employee.organizationalRank) await changeReporting(c, [{employeeId, managerId:supplied === undefined ? employee.reportingManagerId : supplied || null, organizationalRank:rank as Rank}], actorId, new Date().toISOString().slice(0,10), 'Employee Information update');
}

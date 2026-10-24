import { Router } from 'express';
import { repository } from '../../../storage/repository';
import { submitLeave, importApprovedLeave, cancelLeave, LeaveError } from '../services/application.service';
import { formatApplication, leaveReferences, nativeHandler as handler, paging } from './native-shared';

const router = Router();
router.get('/covering-employees', handler(async (req, res) => {
  const repo = repository();
  const [employees, workstations, users] = await Promise.all([repo.find('employee_information_employees', row => row.status === 'Active' && !!Number(row.isActive)), repo.find('employee_information_workstation_details', () => true), repo.find('users', row => !!Number(row.isActive) && row.role !== 'CANDIDATE')]);
  const own = employees.find(employee => employee.userId === req.user!.userId);
  if (!own) throw new LeaveError(404, 'Active employee profile not found.');
  const companyId = workstations.find(workstation => workstation.employeeId === own.id)?.companyId;
  const data = employees.filter(employee => employee.userId !== req.user!.userId && (!companyId || workstations.find(workstation => workstation.employeeId === employee.id)?.companyId === companyId)).flatMap(employee => {
    const user = users.find(user => user.id === employee.userId);
    return user ? [{ id: user.id, name: user.name, employeeNo: employee.employeeNo }] : [];
  }).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  res.json({ success: true, data });
}));

router.get('/entitlements', handler(async (req, res) => {
  const repo = repository();
  const userId = ['ADMIN', 'SUPER_ADMIN'].includes(req.user!.role) && req.query.userId ? String(req.query.userId) : req.user!.userId;
  const years = (await repo.find('leave_years', row => req.query.year ? Number(row.year) === Number(req.query.year) : !!Number(row.isActive))).sort((a, b) => Number(b.year) - Number(a.year));
  if (!years.length) return res.json({ success: true, data: [] });
  const year = years[0];
  let entries = await repo.find('leave_entitlements', row => row.userId === userId && row.leaveYearId === year.id);
  if (!entries.length) {
    const employee = (await repo.find('employee_information_employees', row => row.userId === userId))[0];
    if (employee) {
      const { processEntitlementsForEmployee } = await import('../../leave/leave.controller');
      await processEntitlementsForEmployee(employee.id);
      entries = await repo.find('leave_entitlements', row => row.userId === userId && row.leaveYearId === year.id);
    }
  }
  const types = await repo.find('leave_types', () => true);
  const data = entries.map(entry => {
    const type = types.find(type => type.id === entry.leaveTypeId);
    const { _version, _migration, ...fields } = entry;
    return { ...fields, leaveType: type ? { id: type.id, name: type.name, color: type.color, code: type.code } : null,
      leaveYear: { id: year.id, year: year.year, displayName: year.displayName } };
  }).sort((a, b) => String(a.leaveType?.name).localeCompare(String(b.leaveType?.name)));
  return res.json({ success: true, data });
}));

router.get('/applications', handler(async (req, res) => {
  const repo = repository();
  const refs = await leaveReferences();
  const year = req.query.year ? [...refs.years.values()].find(year => Number(year.year) === Number(req.query.year)) : undefined;
  const applications = (await repo.find('leave_applications', row => row.applicantId === req.user!.userId && (!req.query.status || row.status === req.query.status) && (!req.query.year || row.leaveYearId === year?.id))).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const { page, limit, offset } = paging(req);
  res.json({ success: true, data: applications.slice(offset, offset + limit).map(app => formatApplication(app, refs)), meta: { total: applications.length, page, limit, totalPages: Math.ceil(applications.length / limit) } });
}));
router.post('/applications', handler(async (req, res) => { res.status(201).json({ success: true, data: await submitLeave(req.user!, req.body), message: 'Leave request submitted.' }); }));
router.patch('/applications/:id/cancel', handler(async (req, res) => { res.json({ success: true, data: await cancelLeave(req.user!.userId, String(req.params.id), req.body.cancelReason) }); }));

router.post('/applications/bulk', handler(async (req, res) => {
  if (!['ADMIN', 'SUPER_ADMIN'].includes(req.user!.role)) throw new LeaveError(403, 'Forbidden');
  if (!Array.isArray(req.body) || req.body.length > 500) throw new LeaveError(400, 'Expected an array containing at most 500 records.');
  const repo = repository(), employees = await repo.find('employee_information_employees', () => true), types = await repo.find('leave_types', () => true);
  const results = { success: 0, failed: 0, errors: [] as string[] };
  for (let index = 0; index < req.body.length; index++) {
    try {
      const row = req.body[index] || {};
      const employee = employees.find(employee => employee.employeeNo === row.empId || employee.employeeNumber === row.empId);
      const type = types.find(type => String(type.code).toUpperCase() === String(row.leaveTypeCode).toUpperCase());
      if (!employee || !type) throw new LeaveError(400, 'Employee number or leave type code not found.');
      await importApprovedLeave(req.user!, { applicantId: employee.userId, leaveTypeId: type.id, startDate: row.startDate, endDate: row.endDate, totalDays: row.totalDays, reason: row.reason || 'Bulk import', comments: row.reason || 'Bulk import' });
      results.success++;
    } catch (error) { results.failed++; results.errors.push(`Row ${index + 1}: ${error instanceof Error ? error.message : 'Import failed.'}`); }
  }
  res.status(201).json({ success: true, data: results, message: 'Bulk upload processed' });
}));
export default router;

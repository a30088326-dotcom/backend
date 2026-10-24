import { randomUUID } from 'node:crypto';
import { repository, type RepositorySession, storageNow } from '../../../storage/repository';
import { type Document } from '../../../storage/dynamodb';
import { LeaveError, leaveInput } from './application.service';

function check(test: unknown, message: string, status = 400): asserts test { if (!test) throw new LeaveError(status, message); }
type Actor = { userId: string; role: string };

async function managerUser(tx: RepositorySession, employee: Document) {
  if (!employee.reportingManagerId) return undefined;
  const manager = await tx.get('employee_information_employees', { id: employee.reportingManagerId });
  if (!manager || manager.status !== 'Active' || !Number(manager.isActive) || !manager.userId) return undefined;
  const user = await tx.get('users', { id: manager.userId });
  return user && Number(user.isActive) ? String(user.id) : undefined;
}

async function entitlement(tx: RepositorySession, applicantId: string, leaveTypeId: string, leaveYearId: string) {
  const rows = await tx.find('leave_entitlements', row => row.userId === applicantId && row.leaveTypeId === leaveTypeId && row.leaveYearId === leaveYearId);
  check(rows.length <= 1, 'Duplicate entitlement records require HR reconciliation.', 409);
  return rows[0];
}

export async function persistLeaveDynamo(actor: Actor, payload: unknown, approvedImport: boolean) {
  const v = leaveInput.parse(payload);
  const admin = ['ADMIN', 'SUPER_ADMIN'].includes(actor.role);
  const applicantId = v.applicantId || actor.userId;
  check(!approvedImport || admin, 'Administrator access is required for leave imports.', 403);
  check(admin || applicantId === actor.userId, 'You cannot apply on behalf of another employee.', 403);
  check(v.startDate <= v.endDate, 'End date must not precede the start date.');
  const span = (Date.parse(v.endDate) - Date.parse(v.startDate)) / 86400000 + 1;
  const total = v.halfDayType === 'NONE' ? span : 0.5;
  check(v.halfDayType === 'NONE' || span === 1, 'Half-day leave must be on one date.');
  check(Math.abs(v.totalDays - total) < 0.001, 'Requested days must match the selected dates. Submit separate requests for non-consecutive dates.');
  return repository().transaction(async tx => {
    const employees = await tx.find('employee_information_employees', row => row.userId === applicantId && row.status === 'Active' && !!Number(row.isActive));
    check(employees.length === 1, 'Active employee profile not found.', 404);
    const employee = employees[0];
    // This aggregate write serializes overlap checks across different leave types.
    await tx.replace('employee_information_employees', employee);
    const type = await tx.get('leave_types', { id: v.leaveTypeId });
    check(type && Number(type.isActive), 'Leave type not found.', 404);
    check(v.halfDayType === 'NONE' || Number(type.allowHalfDays), 'This leave type does not allow half days.');
    check(!Number(type.commentMandatory) || !!(v.reason || v.comments)?.trim(), 'A reason is required.');
    check(!Number(type.requireCoveringEmp) || !!v.coveringEmployeeId, 'Select a covering employee.');
    if (v.coveringEmployeeId) {
      check(v.coveringEmployeeId !== applicantId, 'Choose another active employee as cover.');
      const coverUser = await tx.get('users', { id: v.coveringEmployeeId });
      const covers = await tx.find('employee_information_employees', row => row.userId === v.coveringEmployeeId && row.status === 'Active' && !!Number(row.isActive));
      check(coverUser && Number(coverUser.isActive) && covers.length === 1, 'Choose another active employee as cover.');
      const ownWorkstation = (await tx.find('employee_information_workstation_details', row => row.employeeId === employee.id))[0];
      const coverWorkstation = (await tx.find('employee_information_workstation_details', row => row.employeeId === covers[0].id))[0];
      check(!ownWorkstation?.companyId || ownWorkstation.companyId === coverWorkstation?.companyId, 'Choose a covering employee from your company.');
    }
    check(!Number(type.requireAttachment) || !!v.attachmentUrl, 'An attachment is required for this leave type.');
    const certificateRequired = Number(type.needMedicalCertificate) && total > Number(type.maxDaysWithoutMedCert || 0);
    check(!certificateRequired || v.medCertSubmitted, 'A medical certificate is required for this leave type.');
    if (v.attachmentUrl) {
      let filename = '';
      try {
        const pathname = new URL(v.attachmentUrl, 'http://local.invalid').pathname;
        check(/^\/(api\/files|uploads)\//.test(pathname), 'Upload a supporting document through this application.');
        filename = decodeURIComponent(pathname.split('/').pop() || '');
      } catch { throw new LeaveError(400, 'Upload a valid supporting document.'); }
      check(filename && !/[\\/\x00]/.test(filename), 'Upload a valid supporting document.');
      const owned = await tx.find('employee_information_employee_attachments', row => {
        if (row.employeeId !== employee.id) return false;
        try { return decodeURIComponent(String(row.fileUrl).split('/').pop() || '') === filename; } catch { return false; }
      });
      check(owned.length, 'Choose a supporting document uploaded to this employee profile.');
      v.attachmentUrl = '/api/files/' + encodeURIComponent(filename);
    }
    check(!certificateRequired || !!v.attachmentUrl, 'Upload the medical certificate for this request.');
    check(!Number(type.maxDaysPerInstance) || total <= Number(type.maxDaysPerInstance), 'This request exceeds the maximum days per instance.');
    const years = await tx.find('leave_years', row => !!Number(row.isActive) && row.startDate <= v.startDate && row.endDate >= v.endDate);
    check(years.length === 1, 'No unique active leave year covers these dates.');
    const year = years[0];
    const overlaps = await tx.find('leave_applications', row => row.applicantId === applicantId && (String(row.status).startsWith('PENDING') || row.status === 'APPROVED') && row.startDate <= v.endDate && row.endDate >= v.startDate);
    check(!overlaps.length, 'An approved or pending leave request already overlaps these dates.', 409);
    const allocation = await entitlement(tx, applicantId, v.leaveTypeId, year.id);
    const balance = Number(allocation?.totalDays || 0) + Number(allocation?.carryForwardDays || 0) - Number(allocation?.usedDays || 0) - Number(allocation?.pendingDays || 0);
    check(Number(type.isNoPayLeave) || Number(type.allowNegativeBalance) || (allocation && balance >= total), 'Insufficient leave balance. Ask HR to configure your entitlement.');
    let approver = await managerUser(tx, employee);
    if (!approver && employee.organizationalRank === 'OWNER') {
      const hr = (await tx.find('users', row => row.role === 'ADMIN' && !!Number(row.isActive) && row.id !== applicantId)).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))[0];
      approver = hr?.id;
    }
    check(approver && approver !== applicantId, 'An active reporting approver is required.');
    const id = randomUUID();
    let created = await tx.create('leave_applications', { id, applicantId, employeeId: employee.id, leaveTypeId: v.leaveTypeId, leaveYearId: year.id,
      startDate: v.startDate, endDate: v.endDate, totalDays: total, halfDayType: v.halfDayType, reason: v.reason || v.comments || null,
      comments: v.comments || v.reason || null, coveringEmployeeId: v.coveringEmployeeId || null, medCertSubmitted: v.medCertSubmitted ? 1 : 0,
      medCertRefNo: v.medCertRefNo || null, medCertIssuedDate: v.medCertIssuedDate || null, attachmentUrl: v.attachmentUrl || null,
      status: approvedImport ? 'APPROVED' : 'PENDING', approverId: approver });
    if (allocation) {
      const field = approvedImport ? 'usedDays' : 'pendingDays';
      await tx.replace('leave_entitlements', { ...allocation, [field]: Number(allocation[field] || 0) + total });
    }
    if (approvedImport) {
      created = await tx.replace('leave_applications', { ...created, approvedAt: storageNow(), actionedAt: storageNow(), actionedById: actor.userId });
      await tx.create('leave_approval_history', { id: randomUUID(), leave_application_id: id, approver_user_id: actor.userId, action: 'APPROVED', level: 1, comment: 'Administrator bulk import' });
    }
    return created;
  });
}

export async function decideLeaveDynamo(actor: Actor, id: string, action: string, comment?: string) {
  check(['APPROVED', 'REJECTED'].includes(action), 'Invalid approval action.');
  if (action === 'REJECTED') check(comment?.trim(), 'A rejection reason is required.');
  return repository().transaction(async tx => {
    const app = await tx.get('leave_applications', { id });
    check(app, 'Leave request not found.', 404);
    check(String(app.status).startsWith('PENDING'), 'This request has already been actioned.', 409);
    check(app.applicantId !== actor.userId, 'You cannot approve your own request.', 403);
    const employees = await tx.find('employee_information_employees', row => row.userId === app.applicantId);
    check(employees.length === 1, 'Applicant mapping not found.');
    const approver = app.approverId || await managerUser(tx, employees[0]);
    check(approver === actor.userId, 'Only the assigned approver can action this request.', 403);
    const history = await tx.find('leave_approval_history', row => row.leave_application_id === id);
    await tx.create('leave_approval_history', { id: randomUUID(), leave_application_id: id, approver_user_id: actor.userId, action, level: history.length + 1, comment: comment || null });
    const updated = await tx.replace('leave_applications', { ...app, id, status: action, approverId: actor.userId, actionedById: actor.userId,
      actionedAt: storageNow(), approvedAt: action === 'APPROVED' ? storageNow() : null, rejectedReason: action === 'REJECTED' ? comment : null });
    const allocation = await entitlement(tx, app.applicantId, app.leaveTypeId, app.leaveYearId);
    if (allocation) await tx.replace('leave_entitlements', { ...allocation, pendingDays: Math.max(0, Number(allocation.pendingDays || 0) - Number(app.totalDays)), usedDays: Number(allocation.usedDays || 0) + (action === 'APPROVED' ? Number(app.totalDays) : 0) });
    return updated;
  });
}

export async function cancelLeaveDynamo(userId: string, id: string, reason?: string) {
  return repository().transaction(async tx => {
    const app = await tx.get('leave_applications', { id });
    check(app, 'Leave request not found.', 404);
    check(app.applicantId === userId, 'You can cancel only your own requests.', 403);
    check(app.status === 'APPROVED' || String(app.status).startsWith('PENDING'), 'This request cannot be cancelled.', 409);
    const allocation = await entitlement(tx, userId, app.leaveTypeId, app.leaveYearId);
    if (allocation) {
      const field = app.status === 'APPROVED' ? 'usedDays' : 'pendingDays';
      await tx.replace('leave_entitlements', { ...allocation, [field]: Math.max(0, Number(allocation[field] || 0) - Number(app.totalDays)) });
    }
    const updated = await tx.replace('leave_applications', { ...app, id, status: 'CANCELLED', cancelledAt: storageNow(), cancelReason: reason || null });
    await tx.create('leave_approval_history', { id: randomUUID(), leave_application_id: id, approver_user_id: userId, action: 'CANCELLED', comment: reason || null });
    return updated;
  });
}

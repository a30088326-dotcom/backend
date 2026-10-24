import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import type { Request, Response } from 'express';
import { repository } from '../../storage/repository';
import { organizationAccess } from '../../shared/services/organization.service';
import { organizationModuleScope } from '../../middleware/module-action';
import { putStoredUpload, deleteStoredUpload, uploadStorageProvider } from '../../storage/upload-storage';
import { employeeProfileNative } from './employee.native.read';
import { saveEmployeeNative } from './employee.native.write';
import { assertEmployee, nativeHandler } from './native-utils';

export const getEmployees = nativeHandler(async (req, res) => {
  const access = await organizationAccess(req.user!.userId);
  const employees = await repository().find('employee_information_employees', e => access.visibleIds.includes(e.id));
  employees.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const details = await Promise.all(employees.map(e => employeeProfileNative(e)));
  const data = access.admin || access.isExecutive ? details : details.map(e => ({ id: e.id, userId: e.userId, employeeNo: e.employeeNo, isActive: e.isActive, departmentId: e.workstationDetails?.departmentId || e.departmentId, department: e.department, designation: e.designation, organizationalRank: e.organizationalRank, personalDetails: e.personalDetails ? { firstName: e.personalDetails.firstName, lastName: e.personalDetails.lastName } : null }));
  res.json({ success: true, data });
});
export const getEmployeeById = nativeHandler(async (req, res) => {
  const id = String(req.params.id), access = await organizationAccess(req.user!.userId);
  const p = (await repository().find('user_module_permissions', p => p.userId === req.user!.userId && p.moduleId === 'employee_information'))[0];
  const delegated = p?.moduleAccess && p.canView && await organizationModuleScope(req.user!, 'employee_information');
  assertEmployee(access.admin || delegated || access.visibleIds.includes(id), 'Private employee details are available only to the employee and authorized reporting managers.', 403);
  const employee = await repository().get('employee_information_employees', { id }); assertEmployee(employee, 'Employee not found.', 404);
  res.json({ success: true, data: await employeeProfileNative(employee) });
});
export const getMyEmployee = nativeHandler(async (req, res) => {
  const employee = (await repository().find('employee_information_employees', e => e.userId === req.user!.userId))[0];
  res.json({ success: true, data: await employeeProfileNative(employee, req.user!.userId) });
});
export const createEmployee = nativeHandler(async (req, res) => {
  const employee = await saveEmployeeNative(req.body, req.user!.userId, undefined, req.ip);
  res.status(201).json({ success: true, message: `Employee successfully created. Employee No: ${employee!.employeeNo}`, data: employee });
});
export const updateEmployee = nativeHandler(async (req, res) => {
  await saveEmployeeNative(req.body, req.user!.userId, String(req.params.id), req.ip);
  res.json({ success: true, message: 'Employee updated successfully' });
});
export const convertCandidate = nativeHandler(async (req, res) => {
  const candidateId = String(req.params.candidateId), user = await repository().get('users', { id: candidateId });
  assertEmployee(user?.role === 'CANDIDATE', 'Candidate not found or invalid role', 404);
  const employee = await saveEmployeeNative({ userId: candidateId }, req.user!.userId, undefined, req.ip);
  res.json({ success: true, message: 'Candidate successfully converted to Employee.', data: employee });
});
export const checkEmployeeNo = nativeHandler(async (req, res) => {
  const no = String(req.params.empNo).toLowerCase();
  const rows = await repository().find('employee_information_employees', e => String(e.employeeNo).toLowerCase() === no);
  res.json({ success: true, available: rows.length === 0 });
});
async function uploadFiles(req: Request, res: Response, picture = false) {
  const files = picture ? req.file ? [req.file] : [] : req.files as Express.Multer.File[] || [];
  const uploaded: string[] = [];
  try {
    const access = await organizationAccess(req.user!.userId), employeeId = picture ? access.employeeId : String(req.params.employeeId);
    assertEmployee(employeeId && (access.admin || access.employeeId === employeeId), 'You can upload attachments only to your own employee profile.', 403);
    assertEmployee(files.length, 'No files uploaded');
    for (const file of files) {
      assertEmployee(['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'].includes(file.mimetype) && (!picture || file.mimetype.startsWith('image/')), 'Only PDF, JPG and PNG files are supported.');
      await putStoredUpload(file.path, file.filename, file.mimetype); uploaded.push(file.filename);
    }
    const attachments = await repository().transaction(async tx => {
      const employee = await tx.get('employee_information_employees', { id: employeeId! }); assertEmployee(employee, 'Employee not found.', 404);
      const result = [];
      for (const file of files) result.push(await tx.create('employee_information_employee_attachments', { id: randomUUID(), employeeId, fileName: file.originalname, fileType: file.mimetype, fileSize: file.size, fileUrl: `/api/files/${encodeURIComponent(file.filename)}` }));
      if (picture) await tx.replace('employee_information_employees', { ...employee, avatar: `/api/files/${encodeURIComponent(files[0].filename)}` });
      return result;
    });
    if (uploadStorageProvider() === 's3') for (const file of files) await unlink(file.path).catch(() => undefined);
    return picture ? res.json({ success: true, filePath: `/api/files/${encodeURIComponent(files[0].filename)}` }) : res.json({ success: true, data: attachments });
  } catch (error) {
    const retained = new Set<string>();
    // A lost transaction response can follow a successful commit. Keep the object
    // unless a consistent read proves that no saved metadata references it.
    for (const name of uploaded) {
      try {
        const url = `/api/files/${encodeURIComponent(name)}`;
        const references = await repository().find('employee_information_employee_attachments', r => r.fileUrl === url);
        const avatars = await repository().find('employee_information_employees', r => r.avatar === url);
        if (references.length || avatars.length) retained.add(name);
        else await deleteStoredUpload(name);
      } catch (cleanupError) { retained.add(name); console.error('[Employee uncertain upload retained]', name, cleanupError); }
    }
    for (const file of files) if (!retained.has(file.filename) || uploadStorageProvider() === 's3') await unlink(file.path).catch(() => undefined);
    throw error;
  }
}
export const uploadAttachment = nativeHandler((req, res) => uploadFiles(req, res));
export const uploadProfilePicture = nativeHandler((req, res) => uploadFiles(req, res, true));
export const getAttachments = nativeHandler(async (req, res) => {
  const employeeId = String(req.params.employeeId), access = await organizationAccess(req.user!.userId);
  assertEmployee(access.admin || access.visibleIds.includes(employeeId), 'You do not have access to these employee documents.', 403);
  const employee = await repository().get('employee_information_employees', { id: employeeId }); assertEmployee(employee, 'Employee not found.', 404);
  const attachments = await repository().find('employee_information_employee_attachments', a => a.employeeId === employeeId);
  const documents = await repository().find('documents', d => d.candidateId === employee.userId);
  const linked = documents.map(d => ({ id: d.id, employeeId, originalName: d.fileName, fileName: d.fileName, fileUrl: d.fileUrl, fileType: d.fileType, fileSize: d.fileSize, uploadedAt: d.createdAt, uploadedBy: 'Onboarding', category: d.type === 'PREVIOUS_SERVICE' ? 'Previous Service' : d.label, status: d.status === 'APPROVED' ? 'Verified' : d.status === 'REJECTED' ? 'Rejected' : 'Pending', source: 'onboarding' }));
  res.json({ success: true, data: [...linked, ...attachments].sort((a: any, b: any) => String(b.uploadedAt).localeCompare(String(a.uploadedAt))) });
});
export const deleteAttachment = nativeHandler(async (req, res) => {
  const id = String(req.params.id), access = await organizationAccess(req.user!.userId);
  const attachment = await repository().transaction(async tx => {
    const row = await tx.get('employee_information_employee_attachments', { id }); assertEmployee(row, 'Attachment not found.', 404);
    assertEmployee(access.admin || access.employeeId === row.employeeId, 'You can delete only your own attachments.', 403);
    assertEmployee(!(await tx.find('leave_applications', l => l.attachmentUrl === row.fileUrl)).length, 'This file is retained with a leave application and cannot be deleted.', 409);
    const employee = await tx.get('employee_information_employees', { id: row.employeeId });
    if (employee && employee.avatar === row.fileUrl) await tx.replace('employee_information_employees', { ...employee, avatar: null });
    await tx.remove('employee_information_employee_attachments', { id }, row._version); return row;
  });
  const filename = decodeURIComponent(String(attachment.fileUrl).split('/').pop()!);
  try {
    const [attachments, documents, contracts, avatars] = await Promise.all([
      repository().find('employee_information_employee_attachments', r => r.fileUrl === attachment.fileUrl),
      repository().find('documents', r => r.fileUrl === attachment.fileUrl),
      repository().find('contracts', r => r.signatureUrl === attachment.fileUrl),
      repository().find('employee_information_employees', r => r.avatar === attachment.fileUrl),
    ]);
    if (!attachments.length && !documents.length && !contracts.length && !avatars.length) await deleteStoredUpload(filename);
  } catch (error) { console.error('[Employee file cleanup retained]', error); }
  res.json({ success: true, message: 'Attachment deleted successfully' });
});

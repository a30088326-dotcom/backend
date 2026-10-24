import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { repository, storageNow, type RepositorySession } from '../../storage/repository';
import { requireAuth } from '../../middleware/auth';
import { profileSchemas, identifiedContacts } from './profile-requests';
import { syncNativeEmployee, upsertEmployeeDetail } from './employee.native.write';
import { assertEmployee, nativeHandler, parseProfile } from './native-utils';

const router = Router(); router.use(requireAuth);
const sections = ['basic', 'contact', 'emergency', 'dependents', 'qualifications', 'workExperience', 'expertise', 'memberships', 'bank', 'identification'] as const;
type Section = typeof sections[number];
const requestSchema = z.object({ section: z.enum(sections), operation: z.enum(['update', 'add', 'remove']), itemId: z.string().optional(), values: z.record(z.string(), z.unknown()), reason: z.string().trim().min(1).max(2000) }).strict();
const parseInput = <T>(schema: z.ZodType<T>, input: unknown): T => { const parsed = schema.safeParse(input); assertEmployee(parsed.success, parsed.success ? '' : parsed.error.issues.map(e => e.message).join(' ')); return parsed.data; };
async function own(userId: string, tx: RepositorySession = repository()) {
  const employee = (await tx.find('employee_information_employees', e => e.userId === userId && !!e.isActive))[0];
  assertEmployee(employee, 'An active employee profile is required.', 404); return employee;
}
export async function snapshotNative(tx: RepositorySession, employeeId: string, section: Section) {
  if (section === 'basic' || section === 'identification') {
    const source = (await tx.find('employee_information_personal_details', p => p.employeeId === employeeId))[0] || {};
    const keys = section === 'basic' ? ['firstName', 'lastName', 'fullName', 'title', 'gender', 'dob', 'maritalStatus', 'nationality'] : ['nicNo', 'passportNo'];
    const aliases: any = { maritalStatus: source.civilStatus, dob: source.dateOfBirth, nicNo: source.nic || source.nicNumber, passportNo: source.passportNumber };
    return Object.fromEntries(keys.map(k => [k, source[k] || aliases[k] || '']));
  }
  if (section === 'contact' || section === 'emergency') {
    const source = (await tx.find('employee_information_contact_details', p => p.employeeId === employeeId))[0];
    const residential = parseProfile(source?.residential), permanent = parseProfile(source?.permanent), working = parseProfile(source?.working);
    if (section === 'emergency') return identifiedContacts(residential.emergencyContacts || []);
    return { address: permanent.address || '', city: permanent.city || '', country: permanent.country || '', mobile: residential.personal?.mobile || '', telephone: residential.personal?.telephone || '', email: residential.personal?.email || '', workingAddress: working.address || '' };
  }
  if (section === 'bank') return tx.find('employee_information_bank_details', p => p.employeeId === employeeId);
  const extras = await tx.get('employee_profile_extras', { employeeId }); return parseProfile(extras?.data)[section] || [];
}
const changeList = (current: any[], p: any) => p.operation === 'add' ? [...current, { id: randomUUID(), ...p.values, status: 'Approved' }] : p.operation === 'remove' ? current.filter(v => v.id !== p.itemId) : current.map(v => v.id === p.itemId ? { ...v, ...p.values } : v);
async function apply(tx: RepositorySession, employeeId: string, p: any) {
  const current = await snapshotNative(tx, employeeId, p.section), list = Array.isArray(current);
  const previous = list ? current.find(v => v.id === p.itemId) : current;
  assertEmployee(p.operation === 'add' || (previous !== undefined && isDeepStrictEqual(previous, p.before)), 'The profile has changed since this request. Ask the employee to submit a new request.', 409);
  assertEmployee(list || p.operation === 'update', 'This section supports updates only.');
  const values = p.values;
  if (p.section === 'basic' || p.section === 'identification') {
    const update: any = { ...values };
    if (update.dob === '') update.dob = null;
    if (p.section === 'basic') { update.civilStatus = values.maritalStatus; update.dateOfBirth = update.dob; }
    else { update.nic = values.nicNo; update.nicNumber = values.nicNo; update.passportNumber = values.passportNo; }
    await upsertEmployeeDetail(tx, 'employee_information_personal_details', employeeId, update);
    if (p.section === 'basic') await syncNativeEmployee(tx, employeeId);
  } else if (p.section === 'bank') {
    assertEmployee(p.operation !== 'remove', 'Bank accounts cannot be removed through this request.');
    const update = { ...values, accountNumber: values.accountNo, branchName: values.branch };
    if (p.operation === 'add') await tx.create('employee_information_bank_details', { id: randomUUID(), employeeId, ...update });
    else { const bank = await tx.get('employee_information_bank_details', { id: p.itemId }); assertEmployee(bank && bank.employeeId === employeeId, 'Bank account not found.', 404); await tx.replace('employee_information_bank_details', { ...bank, ...update }); }
  } else if (p.section === 'contact' || p.section === 'emergency') {
    const old = (await tx.find('employee_information_contact_details', p => p.employeeId === employeeId))[0];
    const residential = parseProfile(old?.residential), permanent = parseProfile(old?.permanent), working = parseProfile(old?.working);
    if (p.section === 'contact') { Object.assign(permanent, { address: values.address, city: values.city, country: values.country }); working.address = values.workingAddress; residential.personal = { ...residential.personal, mobile: values.mobile, telephone: values.telephone, email: values.email }; }
    else residential.emergencyContacts = changeList(current as any[], p);
    await upsertEmployeeDetail(tx, 'employee_information_contact_details', employeeId, { permanent, working, residential });
  } else {
    const row = await tx.get('employee_profile_extras', { employeeId }), extras = parseProfile(row?.data); extras[p.section] = changeList(current as any[], p);
    if (row) await tx.replace('employee_profile_extras', { ...row, data: extras }); else await tx.create('employee_profile_extras', { employeeId, data: extras });
  }
}
async function requestsFor(predicate: (r: any) => boolean) {
  const [rows, employees, users] = await Promise.all([repository().find('employee_requests', predicate), repository().find('employee_information_employees', () => true), repository().find('users', () => true)]);
  return rows.map(row => { const e = employees.find(e => e.id === row.employeeId), approver = users.find(u => u.id === parseProfile(row.dataPayload).approverId); return { ...row, employeeName: [e?.firstName, e?.lastName].filter(Boolean).join(' '), employeeNo: e?.employeeNo, approverName: approver?.name || null }; }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}
router.get('/my', nativeHandler(async (req, res) => { const e = await own(req.user!.userId); res.json({ success: true, data: await requestsFor(r => r.employeeId === e.id) }); }));
router.get('/team', nativeHandler(async (req, res) => { res.json({ success: true, data: await requestsFor(r => parseProfile(r.dataPayload).approverId === req.user!.userId) }); }));
router.post('/', nativeHandler(async (req, res) => {
  const input = parseInput(requestSchema, req.body);
  const result = await repository().transaction(async tx => {
    const e = await own(req.user!.userId, tx); await tx.replace('employee_information_employees', { ...e });
    const manager = e.reportingManagerId ? await tx.get('employee_information_employees', { id: e.reportingManagerId }) : null;
    const managerUser = manager?.userId ? await tx.get('users', { id: manager.userId }) : null;
    assertEmployee(manager?.isActive && managerUser?.isActive && managerUser.id !== req.user!.userId, 'A valid reporting manager must be assigned before submitting profile requests.', 409);
    const current = await snapshotNative(tx, e.id, input.section), list = Array.isArray(current);
    assertEmployee(list || input.operation === 'update', 'This section supports updates only.');
    assertEmployee(!list || input.operation === 'add' || current.some((v: any) => v.id === input.itemId), 'The selected profile item was not found.', 404);
    assertEmployee(input.section !== 'bank' || input.operation !== 'remove', 'Bank account removal is not supported.');
    const values = input.operation === 'remove' ? {} : parseInput(profileSchemas[input.section] as z.ZodType<any>, input.values);
    const payload = { version: 1, section: input.section, operation: input.operation, itemId: input.itemId || null, values, before: list ? current.find((v: any) => v.id === input.itemId) || null : current, approverId: managerUser.id };
    const id = randomUUID(); await tx.create('employee_requests', { id, employeeId: e.id, requestType: 'PROFILE_CHANGE', title: `${input.operation} ${input.section}`, description: input.reason, dataPayload: payload, status: 'PENDING' });
    return { id, status: 'PENDING', approverId: managerUser.id };
  });
  res.status(201).json({ success: true, data: result });
}));
router.patch('/:id/cancel', nativeHandler(async (req, res) => {
  await repository().transaction(async tx => { const e = await own(req.user!.userId, tx), row = await tx.get('employee_requests', { id: String(req.params.id) }); assertEmployee(row && row.employeeId === e.id && row.status === 'PENDING', 'Only your pending profile requests can be cancelled.', 409); await tx.replace('employee_requests', { ...row, status: 'CANCELLED' }); });
  res.json({ success: true });
}));
router.patch('/:id/resolve', nativeHandler(async (req, res) => {
  const { action, reason } = parseInput(z.object({ action: z.enum(['APPROVED', 'REJECTED']), reason: z.string().trim().max(2000).optional() }).strict(), req.body);
  assertEmployee(action !== 'REJECTED' || reason, 'Give a reason for rejecting the request.');
  const result = await repository().transaction(async tx => {
    const row = await tx.get('employee_requests', { id: String(req.params.id) }); assertEmployee(row, 'Request not found.', 404);
    const payload = parseProfile(row.dataPayload); assertEmployee(payload.approverId === req.user!.userId, 'Only the assigned reporting manager can decide this request.', 403);
    assertEmployee(row.status === 'PENDING', 'This request has already been processed.', 409);
    const employee = await tx.get('employee_information_employees', { id: row.employeeId }); assertEmployee(employee?.isActive, 'The employee is no longer active.', 409);
    await tx.replace('employee_information_employees', { ...employee });
    if (action === 'APPROVED') await apply(tx, row.employeeId, payload);
    await tx.replace('employee_requests', { ...row, status: action, rejectionReason: reason || null, approvedBy: req.user!.userId, approvedAt: storageNow() });
    return { id: row.id, status: action };
  }); res.json({ success: true, data: result });
}));
export default router;

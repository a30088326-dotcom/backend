import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import bcrypt from 'bcryptjs';
import { mkdir, writeFile, access, unlink } from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { memory } from './dynamodb.domain-memory';
import { withRepositoryForTests } from '../src/storage/repository';
import { db } from '../src/lib/db';
import { generateToken } from '../src/middleware/auth';
import { saveEmployeeNative } from '../src/modules/employee_information/employee.native.write';
import { employeeProfileNative } from '../src/modules/employee_information/employee.native.read';
import { confirmPermanentNative } from '../src/modules/employee_information/confirmation.native';
import * as http from '../src/modules/employee_information/employee.native.http';
import profileRequests from '../src/modules/employee_information/profile-requests';

process.env.NODE_ENV = 'test'; process.env.DATABASE_PROVIDER = 'dynamodb'; process.env.JWT_SECRET = 'native-test-secret-never-used-outside-test';
(db as any).query = async () => { throw new Error('Unexpected SQL employee query'); };
(db as any).getConnection = async () => { throw new Error('Unexpected SQL employee connection'); };
const year = new Date(Date.now() + 330 * 60000).getUTCFullYear();
async function seed(repo: ReturnType<typeof memory>['repo']) {
  const ids = Object.fromEntries(['owner', 'manager', 'staff', 'employee', 'company', 'location', 'department', 'designation', 'probation', 'permanent', 'gender', 'nationality', 'casual', 'annual', 'medical', 'group'].map(k => [k, randomUUID()]));
  await repo.create('users', { id: ids.owner, email: 'owner@test.invalid', name: 'Owner Manager', role: 'SUPER_ADMIN', password: 'never-expose', isActive: 1 });
  await repo.create('employee_information_employees', { id: ids.manager, userId: ids.owner, employeeNo: 'EMP-000001', employeeNumber: 'EMP-000001', firstName: 'Owner', lastName: 'Manager', status: 'Active', isActive: 1, organizationalRank: 'OWNER' });
  await repo.create('users', { id: ids.staff, email: 'employee@test.invalid', name: 'Sample Employee', role: 'CANDIDATE', password: 'never-expose', isActive: 1 });
  for (const [entity, id, name] of [['eim_companies', ids.company, 'Test Company'], ['eim_locations', ids.location, 'Colombo'], ['eim_structures', ids.department, 'Finance'], ['designations', ids.designation, 'Analyst'], ['employment_types', ids.probation, 'Probation'], ['employment_types', ids.permanent, 'Permanent'], ['eim_genders', ids.gender, 'Male'], ['eim_nationalities', ids.nationality, 'Sri Lankan']] as const) await repo.create(entity, { id, name, code: id, isActive: 1 });
  for (const [id, code, name] of [[ids.casual, 'CASUAL', 'Casual'], [ids.annual, 'ANNUAL', 'Annual'], [ids.medical, 'MEDICAL', 'Medical']]) await repo.create('leave_types', { id, code, name, isActive: 1 });
  await repo.create('leave_groups', { id: ids.group, name: 'Permanent Staff', employmentType: 'Permanent', isActive: 1 });
  return ids;
}
function body(ids: Record<string, string>) { return { userId: ids.staff, personalDetails: { firstName: 'Sample', lastName: 'Employee', gender: ids.gender, nationality: ids.nationality }, employmentDetails: { dateJoined: `${year}-10-23`, employmentTypeId: ids.probation, organizationalRank: 'EMPLOYEE', basicSalary: 150000 }, workstationDetails: { companyId: ids.company, locationId: ids.location, departmentId: ids.department, designationId: ids.designation, supervisorId: ids.manager }, contactDetails: { official: { email: 'employee@test.invalid' }, personal: { mobile: '0770000000' }, emergencyContacts: [{ name: 'Test Relative', relationship: 'Other', primaryPhone: '0770000001' }] }, payrollDetails: { bankDetails: { bank: 'Test Bank', branch: 'Colombo', accountName: 'Sample Employee', accountNumber: 'TEST-0001', currency: 'LKR' } }, costCentres: [{ id: ids.department, percentage: 100 }] }; }
async function call(handler: any, req: any) { const result = { status: 200, body: undefined as any }; const res = { status(n: number) { result.status = n; return this; }, json(value: any) { result.body = value; return this; } }; await handler(req, res); return result; }

test('native employee creation persists maps, account, every profile section, probation leave and audit atomically', async () => {
  const { repo } = memory(); await withRepositoryForTests(repo, async () => {
    const ids = await seed(repo), e = await saveEmployeeNative(body(ids), ids.owner);
    assert.equal(e!.employeeNo, 'EMP-000002'); assert.equal(e!.department, 'Finance'); assert.equal(e!.designation, 'Analyst'); assert.equal(e!.reportingManagerId, ids.manager);
    assert.equal((await repo.get('users', { id: ids.staff }))!.role, 'EMPLOYEE'); assert.equal((await repo.get('users', { id: ids.staff }))!.supervisorId, ids.owner);
    const profile = await employeeProfileNative(e);
    assert.equal(profile.personalDetails.gender, 'Male'); assert.equal(profile.personalDetails.nationality, 'Sri Lankan'); assert.equal(profile.workstationDetails.companyName, 'Test Company');
    assert.equal(profile.contactDetails.residential.personal.mobile, '0770000000'); assert.equal(profile.contactDetails.residential.emergencyContacts[0].name, 'Test Relative');
    assert.equal(profile.bankDetails[0].accountNo, 'TEST-0001'); assert.equal(profile.employmentDetails.basicSalary, 150000); assert.equal(profile.costCentres[0].percentage, 100);
    assert.equal((await repo.find('leave_entitlements', r => r.leaveTypeId === ids.casual))[0].totalDays, 6); assert.equal((await repo.find('leave_entitlements', r => r.leaveTypeId === ids.annual))[0].totalDays, 0);
    assert.ok(!JSON.stringify(profile).includes('never-expose')); assert.equal((await repo.find('employee_information_audit_logs', () => true)).length, 1);
  });
});
test('native partial employee edits preserve bank/contact/employment values and sync names', async () => {
  const { repo } = memory(); await withRepositoryForTests(repo, async () => {
    const ids = await seed(repo), e = await saveEmployeeNative(body(ids), ids.owner);
    await saveEmployeeNative({ personalDetails: { firstName: 'Updated' }, contactDetails: { linkedIn: 'https://example.invalid/test' } }, ids.owner, e!.id);
    const updated = await repo.get('employee_information_employees', { id: e!.id }), profile = await employeeProfileNative(updated);
    assert.equal(updated!.dateJoined, `${year}-10-23`); assert.equal(updated!.reportingManagerId, ids.manager); assert.equal(profile.personalDetails.lastName, 'Employee'); assert.equal(profile.personalDetails.fullName, 'Updated Employee');
    assert.equal(profile.bankDetails.length, 1); assert.equal(profile.contactDetails.residential.personal.mobile, '0770000000'); assert.equal(profile.contactDetails.linkedIn, 'https://example.invalid/test');
    assert.equal((await repo.get('users', { id: ids.staff }))!.name, 'Updated Employee');
  });
});
test('bad mappings and bad allocations roll back user conversion, employee and audit', async () => {
  const { repo } = memory(); await withRepositoryForTests(repo, async () => {
    const ids = await seed(repo), before = (await repo.find('employee_information_employees', () => true)).length;
    await assert.rejects(saveEmployeeNative({ ...body(ids), costCentres: [{ percentage: 99 }] }, ids.owner), /100/);
    await assert.rejects(saveEmployeeNative({ ...body(ids), workstationDetails: { departmentId: randomUUID() } }, ids.owner), /does not exist/);
    assert.equal((await repo.find('employee_information_employees', () => true)).length, before); assert.equal((await repo.get('users', { id: ids.staff }))!.role, 'CANDIDATE');
    assert.equal((await repo.find('employee_information_audit_logs', () => true)).length, 0); assert.equal((await repo.find('leave_entitlements', () => true)).length, 0);
  });
});
test('leave calculation errors abort the entire employee creation transaction', async () => {
  const { repo } = memory(); await withRepositoryForTests(repo, async () => {
    const ids = await seed(repo); await repo.create('leave_rule_scripts', { id: randomUUID(), name: 'Default', isDefault: 1, content: 'output.entitlement = process.env.JWT_SECRET;' });
    await assert.rejects(saveEmployeeNative(body(ids), ids.owner));
    assert.equal((await repo.find('employee_information_employees', e => e.userId === ids.staff)).length, 0); assert.equal((await repo.get('users', { id: ids.staff }))!.role, 'CANDIDATE');
  });
});
test('onboarding conversion retains all contact/bank fields and lookup labels without duplicate login', async () => {
  const { repo } = memory(); await withRepositoryForTests(repo, async () => {
    const ids = await seed(repo); await repo.create('onboarding_profiles', { id: randomUUID(), candidateId: ids.staff, firstName: 'Pawan', lastName: 'Perera', dateOfBirth: '2000-10-23', gender: ids.gender, nationality: ids.nationality, addressLine1: 'Test Street', city: 'Colombo', postalCode: '00100', phoneNumber: '0770000000', alternatePhone: '0770000001', linkedIn: 'https://example.invalid/pawan', emergencyContactName: 'Relative', emergencyContactRelation: 'Other', emergencyContactPhone: '0770000002', bankName: 'Test Bank', accountNumber: 'TEST-1234', accountHolderName: 'Pawan Perera', accountType: 'Savings', currency: 'LKR' });
    const e = await saveEmployeeNative({ userId: ids.staff }, ids.owner), p = await employeeProfileNative(e);
    assert.equal(p.personalDetails.fullName, 'Pawan Perera'); assert.equal(p.personalDetails.gender, 'Male'); assert.equal(p.contactDetails.permanent.postalCode, '00100'); assert.equal(p.contactDetails.residential.personal.alternatePhone, '0770000001'); assert.equal(p.bankDetails[0].accountHolderName, 'Pawan Perera');
    await assert.rejects(saveEmployeeNative({ userId: ids.staff }, ids.owner), /already linked/); assert.equal((await repo.find('users', () => true)).length, 2);
  });
});
test('employee detail and attachment reads reject unrelated employees and scope list fields', async () => {
  const { repo } = memory(); await withRepositoryForTests(repo, async () => {
    const ids = await seed(repo), e = await saveEmployeeNative(body(ids), ids.owner), outsider = randomUUID();
    await repo.create('users', { id: outsider, email: 'outsider@test.invalid', role: 'EMPLOYEE', isActive: 1 });
    const denied = await call(http.getEmployeeById, { params: { id: e!.id }, user: { userId: outsider, role: 'EMPLOYEE' } }); assert.equal(denied.status, 403);
    const self = await call(http.getEmployeeById, { params: { id: e!.id }, user: { userId: ids.staff, role: 'EMPLOYEE' } }); assert.equal(self.status, 200);
    const list = await call(http.getEmployees, { user: { userId: ids.staff, role: 'EMPLOYEE' } }); assert.equal(list.body.data.length, 1); assert.ok(!('bankDetails' in list.body.data[0])); assert.ok(!('contactDetails' in list.body.data[0]));
  });
});
test('permanent confirmation updates one transaction, retains used/pending leave, transition history and master labels', async () => {
  const { repo } = memory(); await withRepositoryForTests(repo, async () => {
    const ids = await seed(repo), e = await saveEmployeeNative(body(ids), ids.owner), balance = (await repo.find('leave_entitlements', r => r.leaveTypeId === ids.casual))[0];
    await repo.replace('leave_entitlements', { ...balance, usedDays: 2, pendingDays: 1 });
    const confirmation = await confirmPermanentNative(e!.id, new Date(`${year}-10-24T00:00:00Z`), ids.owner);
    const saved = await repo.get('employee_information_employees', { id: e!.id }), after = await repo.get('leave_entitlements', { id: balance.id });
    assert.equal(saved!.probationStatus, 'Confirmed'); assert.equal(saved!.employmentTypeId, ids.permanent); assert.equal(saved!.employmentType, 'Permanent'); assert.equal(after!.totalDays, 7); assert.equal(after!.usedDays, 2); assert.equal(after!.pendingDays, 1); assert.equal(after!.leaveGroupId, ids.group);
    assert.equal(confirmation.entitlements.find(e => e.leaveTypeCode === 'CASUAL')!.netNewEntitlement, 1); assert.equal((await repo.find('employee_information_employment_type_transitions', () => true)).length, 1);
  });
});
test('permanent confirmation calculation failure leaves status, balances and transition unchanged', async () => {
  const { repo } = memory(); await withRepositoryForTests(repo, async () => {
    const ids = await seed(repo), e = await saveEmployeeNative(body(ids), ids.owner);
    await repo.create('leave_rule_scripts', { id: randomUUID(), name: 'Default', isDefault: 1, content: 'output.entitlement = process.exit();' });
    await assert.rejects(confirmPermanentNative(e!.id, new Date(`${year}-10-24T00:00:00Z`), ids.owner));
    assert.equal((await repo.get('employee_information_employees', { id: e!.id }))!.probationStatus, 'Probation'); assert.equal((await repo.find('employee_information_employment_type_transitions', () => true)).length, 0);
    assert.equal((await repo.find('leave_entitlements', r => r.leaveTypeId === ids.casual))[0].totalDays, 6);
  });
});
test('self-service profile approval enforces assigned manager, stale snapshot guard and persistent bank update', async () => {
  const { repo } = memory(); await withRepositoryForTests(repo, async () => {
    const ids = await seed(repo), e = await saveEmployeeNative(body(ids), ids.owner);
    const app = express(); app.use(express.json()); app.use((req, res, next) => { void withRepositoryForTests(repo, async () => { profileRequests(req, res, next); }); });
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const url = `http://127.0.0.1:${(server.address() as any).port}`;
    const token = (id: string, role: any) => generateToken({ userId: id, email: `${id}@test.invalid`, role });
    const request = async (path: string, actor: string, role: any, method = 'GET', body?: any) => { const response = await fetch(url + path, { method, headers: { Authorization: `Bearer ${token(actor, role)}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: response.status, data: await response.json() as any }; };
    try {
      const bank = (await repo.find('employee_information_bank_details', b => b.employeeId === e!.id))[0];
      const submitted = await request('/', ids.staff, 'EMPLOYEE', 'POST', { section: 'bank', operation: 'update', itemId: bank.id, reason: 'Update test bank branch', values: { bankName: 'Test Bank', branch: 'Kandy', accountNo: 'TEST-0001', accountHolderName: 'Sample Employee', accountType: 'Savings', currency: 'LKR' } });
      assert.equal(submitted.status, 201); assert.equal(submitted.data.data.approverId, ids.owner);
      assert.equal((await request(`/${submitted.data.data.id}/resolve`, ids.staff, 'EMPLOYEE', 'PATCH', { action: 'APPROVED' })).status, 403);
      const resolved = await request(`/${submitted.data.data.id}/resolve`, ids.owner, 'SUPER_ADMIN', 'PATCH', { action: 'APPROVED' }); assert.equal(resolved.status, 200);
      assert.equal((await repo.get('employee_information_bank_details', { id: bank.id }))!.branch, 'Kandy');
      assert.equal((await request(`/${submitted.data.data.id}/resolve`, ids.owner, 'SUPER_ADMIN', 'PATCH', { action: 'APPROVED' })).status, 409);
      const second = await request('/', ids.staff, 'EMPLOYEE', 'POST', { section: 'identification', operation: 'update', reason: 'Identity test', values: { nicNo: 'TEST-NIC', passportNo: '' } }); assert.equal(second.status, 201);
      await saveEmployeeNative({ personalDetails: { nicNo: 'HR-NEWER' } }, ids.owner, e!.id);
      assert.equal((await request(`/${second.data.data.id}/resolve`, ids.owner, 'SUPER_ADMIN', 'PATCH', { action: 'APPROVED' })).status, 409);
      assert.equal((await repo.get('employee_requests', { id: second.data.data.id }))!.status, 'PENDING');
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});

test('concurrent employee creation cannot duplicate employee numbers or leave a half-converted login', async () => {
  const { repo } = memory(); await withRepositoryForTests(repo, async () => {
    const ids = await seed(repo), second = randomUUID(); await repo.create('users', { id: second, email: 'second@test.invalid', role: 'CANDIDATE', isActive: 1 });
    const attempts = await Promise.allSettled([saveEmployeeNative({ userId: ids.staff }, ids.owner), saveEmployeeNative({ userId: second }, ids.owner)]);
    assert.equal(attempts.filter(a => a.status === 'fulfilled').length, 1);
    const employees = await repo.find('employee_information_employees', () => true); assert.equal(employees.length, 2); assert.equal(new Set(employees.map(e => e.employeeNo)).size, 2);
    const linked = employees.find(e => e.organizationalRank !== 'OWNER')!;
    assert.equal((await repo.get('users', { id: linked.userId }))!.role, 'EMPLOYEE'); assert.equal((await repo.get('users', { id: linked.userId === ids.staff ? second : ids.staff }))!.role, 'CANDIDATE');
  });
});
test('new direct employee accounts use an unexposed random credential and require password setup', async () => {
  const { repo } = memory(); await withRepositoryForTests(repo, async () => {
    const ids = await seed(repo), employee = await saveEmployeeNative({ personalDetails: { firstName: 'New', lastName: 'Account' }, contactDetails: { official: { email: 'new@test.invalid' } } }, ids.owner);
    const user = await repo.get('users', { id: employee!.userId }); assert.equal(user!.mustChangePassword, 1); assert.equal(await bcrypt.compare('Emp@123', user!.password), false);
    assert.ok(!JSON.stringify(await employeeProfileNative(employee)).includes(user!.password));
  });
});
test('backdated probation joining date confirms and allocates inside the same employee update', async () => {
  const { repo } = memory(); await withRepositoryForTests(repo, async () => {
    const ids = await seed(repo), e = await saveEmployeeNative(body(ids), ids.owner);
    await saveEmployeeNative({ employmentDetails: { dateJoined: `${year - 2}-01-01` } }, ids.owner, e!.id);
    const updated = await repo.get('employee_information_employees', { id: e!.id }); assert.equal(updated!.probationStatus, 'Confirmed'); assert.equal(updated!.permanentEffectiveDate, `${year - 1}-01-01`);
    assert.equal((await repo.find('leave_entitlements', r => r.leaveTypeId === ids.annual))[0].totalDays, 14); assert.equal((await repo.find('employee_information_employment_type_transitions', () => true)).length, 1);
  });
});
test('an uncertain attachment commit retains bytes referenced by committed metadata', async () => {
  const { repo } = memory(); await withRepositoryForTests(repo, async () => {
    const ids = await seed(repo), e = await saveEmployeeNative(body(ids), ids.owner), filename = `native-upload-test-${randomUUID()}.png`, localPath = path.resolve('uploads', filename);
    await mkdir(path.dirname(localPath), { recursive: true }); await writeFile(localPath, 'test-only-bytes'); process.env.UPLOAD_STORAGE = 'local';
    const transaction = repo.transaction.bind(repo); let simulated = false;
    repo.transaction = (async (work: any) => { const result = await transaction(work); if (!simulated) { simulated = true; throw new Error('Simulated response lost after commit'); } return result; }) as any;
    try {
      const result = await call(http.uploadAttachment, { params: { employeeId: e!.id }, user: { userId: ids.owner, role: 'SUPER_ADMIN' }, files: [{ path: localPath, filename, originalname: 'test.png', mimetype: 'image/png', size: 15 }] });
      assert.equal(result.status, 500); assert.match(result.body.message, /Refresh/); await access(localPath);
      assert.equal((await repo.find('employee_information_employee_attachments', a => a.employeeId === e!.id)).length, 1);
    } finally { repo.transaction = transaction; await unlink(localPath).catch(() => undefined); }
  });
});
test('definitely rejected attachment metadata removes only the newly uploaded test bytes', async () => {
  const { repo } = memory(); await withRepositoryForTests(repo, async () => {
    const ids = await seed(repo), filename = `native-upload-test-${randomUUID()}.png`, localPath = path.resolve('uploads', filename);
    await mkdir(path.dirname(localPath), { recursive: true }); await writeFile(localPath, 'test-only-bytes'); process.env.UPLOAD_STORAGE = 'local';
    const result = await call(http.uploadAttachment, { params: { employeeId: randomUUID() }, user: { userId: ids.owner, role: 'SUPER_ADMIN' }, files: [{ path: localPath, filename, originalname: 'test.png', mimetype: 'image/png', size: 15 }] });
    assert.equal(result.status, 404); await assert.rejects(access(localPath)); assert.equal((await repo.find('employee_information_employee_attachments', () => true)).length, 0);
  });
});

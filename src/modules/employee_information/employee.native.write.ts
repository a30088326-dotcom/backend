import { randomUUID, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { repository, type RepositorySession } from '../../storage/repository';
import type { EntityName } from '../../storage/table-definitions';
import { changeReportingNative, type Rank } from '../../shared/services/organization.service';
import { assignRoster } from '../attendance/roster.service';
import { processEntitlementsNative } from '../leave/entitlements.native';
import { touchEimReferences } from '../eim/eim.dynamo.service';
import { confirmPermanentNative } from './confirmation.native';
import { onboardingContact } from './onboarding-mapping';
import { assertEmployee, columnData, isoDay, parseProfile } from './native-utils';

const personalLookups = { bloodGroup: 'eim_blood_groups', religion: 'eim_religions', civilStatus: 'eim_marital_statuses', maritalStatus: 'eim_marital_statuses', gender: 'eim_genders', nationality: 'eim_nationalities', title: 'eim_employee_titles' } as const;
const mappingTables: Record<string, EntityName> = { companyId: 'eim_companies', locationId: 'eim_locations', departmentId: 'eim_structures', designationId: 'designations', sectionId: 'eim_structures', divisionId: 'eim_structures', functionalRole: 'eim_functional_roles', shiftId: 'attendance_shifts', salaryGradeId: 'eim_salary_grades', employmentTypeId: 'employment_types', employeeGroupId: 'eim_employee_groups', jobProfileId: 'eim_job_profiles', costCentreId: 'eim_cost_centres' };
const clean = (data: any): any => Object.fromEntries(Object.entries(data || {}).map(([k, v]) => [k, v === '' ? null : v]));

export async function upsertEmployeeDetail(tx: RepositorySession, table: EntityName, employeeId: string, supplied: any) {
  const existing = (await tx.find(table, r => r.employeeId === employeeId))[0];
  const data = columnData(table, supplied);
  return existing ? tx.replace(table, { ...existing, ...data }) : tx.create(table, { id: randomUUID(), employeeId, ...data });
}
export async function syncNativeEmployee(tx: RepositorySession, employeeId: string) {
  await touchEimReferences(tx);
  const e = await tx.get('employee_information_employees', { id: employeeId });
  assertEmployee(e, 'Employee not found.', 404);
  let w = (await tx.find('employee_information_workstation_details', r => r.employeeId === employeeId))[0];
  const effective = { ...e, ...Object.fromEntries(Object.entries(w || {}).filter(([k, v]) => k in mappingTables && v)) };
  for (const [field, table] of Object.entries(mappingTables)) if (effective[field]) assertEmployee(await tx.get(table, { id: effective[field] }), `Selected ${field.replace(/Id$/, '')} does not exist.`);
  if (effective.jobProfileId) {
    const profile = await tx.get('eim_job_profiles', { id: effective.jobProfileId });
    if (profile && ((profile.designationId && profile.designationId !== effective.designationId) || (profile.departmentId && profile.departmentId !== effective.departmentId))) {
      if (w) w = await tx.replace('employee_information_workstation_details', { ...w, jobProfileId: null });
      effective.jobProfileId = null;
    }
  }
  const department = effective.departmentId ? await tx.get('eim_structures', { id: effective.departmentId }) : null;
  const designation = effective.designationId ? await tx.get('designations', { id: effective.designationId }) : null;
  const location = effective.locationId ? await tx.get('eim_locations', { id: effective.locationId }) : null;
  if (effective.companyId && location?.companyId) assertEmployee(location.companyId === effective.companyId, 'Selected location belongs to a different company.');
  if (effective.companyId && department?.companyId) assertEmployee(department.companyId === effective.companyId, 'Selected department belongs to a different company.');
  if (effective.locationId && department?.locationId) assertEmployee(department.locationId === effective.locationId, 'Selected department belongs to a different location.');
  if (effective.departmentId && designation?.departmentId) assertEmployee(designation.departmentId === effective.departmentId, 'Selected designation belongs to a different department.');
  const type = effective.employmentTypeId ? await tx.get('employment_types', { id: effective.employmentTypeId }) : null;
  const user = e.userId ? await tx.get('users', { id: e.userId }) : null;
  const personal = (await tx.find('employee_information_personal_details', r => r.employeeId === employeeId))[0];
  const result = await tx.replace('employee_information_employees', { ...e, departmentId: effective.departmentId || null,
    department: department?.name || e.department, designationId: effective.designationId || null, designation: designation?.name || e.designation,
    companyId: effective.companyId || null, locationId: effective.locationId || null, jobProfileId: effective.jobProfileId || null,
    salaryGradeId: effective.salaryGradeId || null, employeeGroupId: effective.employeeGroupId || null,
    employmentType: type?.name || e.employmentType, status: Number(e.isActive) === 0 ? 'Inactive' : e.employeeStatus,
    employeeNumber: e.employeeNumber || e.employeeNo, email: user?.email || e.email,
    ...(personal ? { firstName: personal.firstName, lastName: personal.lastName } : {}) });
  if (w) await tx.replace('employee_information_workstation_details', { ...w, employmentTypeId: e.employmentTypeId || null });
  if (personal && user) await tx.replace('users', { ...user, name: [personal.firstName, personal.lastName].filter(Boolean).join(' ') });
  return result;
}

async function normalizePersonal(tx: RepositorySession, value: any) {
  const p = clean(value);
  for (const field of ['dob', 'dateOfBirth']) if (p[field] !== undefined) p[field] = isoDay(p[field]);
  for (const [field, table] of Object.entries(personalLookups)) if (/^[0-9a-f-]{36}$/i.test(String(p[field] || ''))) {
    const master = await tx.get(table, { id: p[field] }); assertEmployee(master, `Selected ${field} does not exist.`); p[field] = master.name;
  }
  if (p.maritalStatus !== undefined) p.civilStatus = p.maritalStatus;
  if (p.civilStatus !== undefined) p.maritalStatus = p.civilStatus;
  if (p.dob !== undefined) p.dateOfBirth = p.dob;
  if (p.nicNo !== undefined) { p.nic = p.nicNo; p.nicNumber = p.nicNo; }
  if (p.passportNo !== undefined) p.passportNumber = p.passportNo;
  return p;
}
async function saveContacts(tx: RepositorySession, employeeId: string, input: any) {
  const old = (await tx.find('employee_information_contact_details', r => r.employeeId === employeeId))[0];
  const data: any = {};
  for (const field of ['permanent', 'working', 'official']) if (input[field] !== undefined) data[field] = input[field] === null ? null : { ...parseProfile(old?.[field]), ...input[field] };
  if (input.personal !== undefined || input.emergencyContacts !== undefined || input.residential !== undefined) data.residential = { ...parseProfile(old?.residential), ...parseProfile(input.residential), ...(input.personal !== undefined ? { personal: input.personal } : {}), ...(input.emergencyContacts !== undefined ? { emergencyContacts: input.emergencyContacts } : {}) };
  if (input.primaryContactPreference !== undefined || input.primaryContactOption !== undefined) data.primaryContactOption = input.primaryContactPreference ?? input.primaryContactOption;
  if (input.linkedIn !== undefined) data.linkedIn = input.linkedIn;
  return upsertEmployeeDetail(tx, 'employee_information_contact_details', employeeId, data);
}

export async function saveEmployeeNative(body: any, actorId: string, id?: string, ip?: string) {
  assertEmployee(body && typeof body === 'object' && !Array.isArray(body), 'Enter valid employee details.');
  for (const field of ['personalDetails','employmentDetails','workstationDetails','contactDetails','payrollDetails','salaryPayrollDetails','resignationDetails','otherDetails']) if (body[field] !== undefined) assertEmployee(body[field] && typeof body[field] === 'object' && !Array.isArray(body[field]), `Enter valid ${field}.`);
  for (const field of ['timeAndAttendanceActive','payrollActive','isActive']) if (body.employmentDetails?.[field] !== undefined) assertEmployee([true,false,0,1].includes(body.employmentDetails[field]), `Enter a valid ${field} flag.`);
  if (body.costCentres !== undefined) assertEmployee(Array.isArray(body.costCentres), 'Choose valid cost centre allocations.');
  return repository().transaction(async tx => {
    const existing = id ? await tx.get('employee_information_employees', { id }) : undefined;
    if (id) assertEmployee(existing, 'Employee not found.', 404);
    const employeeId = id || randomUUID();
    const employment = clean(body.employmentDetails), workstation = clean(body.workstationDetails);
    if (employment.companyId !== undefined) workstation.companyId = employment.companyId;
    if (workstation.functionalRoleId !== undefined) workstation.functionalRole = workstation.functionalRoleId;
    let user = existing?.userId ? await tx.get('users', { id: existing.userId }) : body.userId ? await tx.get('users', { id: body.userId }) : undefined;
    if (!existing && body.userId) assertEmployee(user, 'User account to link not found.', 404);
    if (!existing && user) assertEmployee(!(await tx.find('employee_information_employees', e => e.userId === user!.id)).length, 'This user account is already linked to an employee.', 409);
    if (!user) {
      const email = body.contactDetails?.official?.email || `emp_${randomUUID()}@company.com`;
      user = await tx.create('users', { id: randomUUID(), email, password: await bcrypt.hash(randomBytes(32).toString('base64url'), 12), name: body.personalDetails?.fullName || 'New Employee', role: 'EMPLOYEE', isActive: 1, mustChangePassword: 1 });
    } else if (user.role === 'CANDIDATE') user = await tx.replace('users', { ...user, role: 'EMPLOYEE' });
    let number = existing?.employeeNo;
    if (!number) {
      const all = await tx.find('employee_information_employees', () => true);
      const max = Math.max(0, ...all.map(e => Number(/^EMP-(\d+)$/.exec(String(e.employeeNo || e.employeeNumber))?.[1] || 0)));
      number = `EMP-${String(max + 1).padStart(6, '0')}`;
    }
    let typeId = employment.employmentTypeId === undefined ? existing?.employmentTypeId ?? null : employment.employmentTypeId;
    if (!typeId && employment.employmentType) typeId = (await tx.find('employment_types', t => String(t.name).toLowerCase() === String(employment.employmentType).toLowerCase()))[0]?.id || null;
    const patch: any = { ...(existing || {}), id: employeeId, userId: user.id, employeeNo: number, employeeNumber: existing?.employeeNumber || number,
      ...Object.fromEntries(['companyId','locationId','departmentId','designationId','salaryGradeId','employeeGroupId','jobProfileId'].filter(k => workstation[k] !== undefined).map(k => [k, workstation[k]])),
      employmentTypeId: typeId, isActive: existing?.isActive ?? 1, employeeStatus: employment.employmentStatus ?? existing?.employeeStatus ?? 'Active',
      organizationalRank: employment.organizationalRank ?? body.organizationalRank ?? existing?.organizationalRank ?? 'EMPLOYEE',
      probationStatus: employment.probationStatus ?? existing?.probationStatus ?? 'Probation',
      payrollNo: employment.payrollNo ?? body.salaryPayrollDetails?.payrollNo ?? existing?.payrollNo ?? null,
      timeAndAttendanceActive: employment.timeAndAttendanceActive === undefined ? existing?.timeAndAttendanceActive ?? 1 : Number(!!employment.timeAndAttendanceActive),
      payrollActive: employment.payrollActive === undefined ? existing?.payrollActive ?? 1 : Number(!!employment.payrollActive),
      employeeGroup: employment.employeeGroup ?? existing?.employeeGroup ?? null,
      dateJoined: employment.dateJoined === undefined ? existing?.dateJoined ?? null : isoDay(employment.dateJoined),
      permanentEffectiveDate: employment.permanentEffectiveDate === undefined ? existing?.permanentEffectiveDate ?? null : isoDay(employment.permanentEffectiveDate),
      reportingManagerId: existing?.reportingManagerId || null };
    assertEmployee(existing?.organizationalRank !== 'OWNER' || patch.organizationalRank === 'OWNER', 'The Owner cannot be demoted through an employee profile edit.', 403);
    if (employment.isActive !== undefined) patch.isActive = Number(!!employment.isActive);
    patch.status = patch.isActive ? patch.employeeStatus : 'Inactive';
    if (existing) await tx.replace('employee_information_employees', patch); else await tx.create('employee_information_employees', patch);
    const onboarding = !existing ? (await tx.find('onboarding_profiles', p => p.candidateId === user!.id))[0] : null;
    let personal = body.personalDetails;
    if (!personal && onboarding) personal = { firstName: onboarding.firstName, lastName: onboarding.lastName, dob: onboarding.dateOfBirth, gender: onboarding.gender, nationality: onboarding.nationality };
    if (personal) {
      const data = await normalizePersonal(tx, personal);
      const old = (await tx.find('employee_information_personal_details', p => p.employeeId === employeeId))[0];
      if (data.fullName === undefined) data.fullName = [data.firstName ?? old?.firstName, data.lastName ?? old?.lastName].filter(Boolean).join(' ');
      await upsertEmployeeDetail(tx, 'employee_information_personal_details', employeeId, data);
    }
    if (body.workstationDetails || employment.companyId !== undefined) await upsertEmployeeDetail(tx, 'employee_information_workstation_details', employeeId, workstation);
    let contact = body.contactDetails;
    if (onboarding) contact = onboardingContact(contact ? { ...contact, residential: { ...contact.residential, personal: contact.personal, emergencyContacts: contact.emergencyContacts } } : null, onboarding, user.email);
    if (contact) await saveContacts(tx, employeeId, contact);
    const bank = body.payrollDetails?.bankDetails || (onboarding?.bankName ? { bank: onboarding.bankName, accountHolderName: onboarding.accountHolderName, accountNumber: onboarding.accountNumber, accountType: onboarding.accountType, currency: onboarding.currency } : null);
    if (bank?.bank) {
      for (const old of await tx.find('employee_information_bank_details', b => b.employeeId === employeeId)) await tx.remove('employee_information_bank_details', { id: old.id }, old._version);
      const allocation = bank.paymentAllocation == null || bank.paymentAllocation === '' ? 100 : Number(bank.paymentAllocation);
      assertEmployee(Number.isFinite(allocation) && allocation >= 0 && allocation <= 100, 'Enter a valid bank payment allocation.');
      await tx.create('employee_information_bank_details', { id: randomUUID(), employeeId, bankName: bank.bank, branch: bank.branch || '', branchName: bank.branch || '', accountHolderName: bank.accountName || bank.accountHolderName || null,
        accountType: bank.accountType || 'Savings', accountNo: bank.accountNumber || '', accountNumber: bank.accountNumber || '', currency: bank.currency || 'LKR', transferMode: 'Percentage', amountOrPercentage: allocation, priority: Number(bank.priority || 1), isActive: bank.isActive === false ? 0 : 1 });
    }
    if (body.resignationDetails) await upsertEmployeeDetail(tx, 'employee_information_resignation_details', employeeId, { ...clean(body.resignationDetails), ...(body.resignationDetails.dateResigned !== undefined ? { dateResigned: isoDay(body.resignationDetails.dateResigned) } : {}) });
    const extrasRow = await tx.get('employee_profile_extras', { employeeId });
    const extras = parseProfile(extrasRow?.data);
    for (const field of ['costCentres', 'salaryPayrollDetails', 'payrollDetails', 'otherDetails']) if (body[field] !== undefined) {
      if (field === 'otherDetails') Object.assign(extras, body[field]); else extras[field] = body[field];
    }
    if (body.costCentres?.length) assertEmployee(Math.abs(body.costCentres.reduce((sum: number, c: any) => sum + Number(c.percentage || 0), 0) - 100) < 0.00001, 'Cost Centre percentage must equal 100%.');
    if (body.employmentDetails) extras.employmentDetails = { ...(extras.employmentDetails || {}), ...body.employmentDetails };
    if (body.personalDetails) extras.personalDetails = { ...(extras.personalDetails || {}), ...body.personalDetails };
    if (extrasRow) await tx.replace('employee_profile_extras', { ...extrasRow, data: extras }); else await tx.create('employee_profile_extras', { employeeId, data: extras });
    await syncNativeEmployee(tx, employeeId);
    const manager = workstation.reportingManagerId !== undefined ? workstation.reportingManagerId : workstation.supervisorId;
    await changeReportingNative(tx, [{ employeeId, managerId: manager === undefined ? existing?.reportingManagerId || null : manager || null, organizationalRank: patch.organizationalRank as Rank }], actorId, new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10), existing ? 'Employee Information update' : 'Employee created');
    if (employment.rosterGroupId || body.attendance?.rosterGroupId) await assignRoster(tx, employeeId, employment.rosterGroupId || body.attendance.rosterGroupId, isoDay(body.attendance?.effectiveStartDate || patch.dateJoined) || new Date().toISOString().slice(0, 10));
    await tx.create('employee_information_audit_logs', { id: randomUUID(), employeeId, userId: actorId, action: existing ? 'UPDATE_EMPLOYEE' : 'CREATED', ipAddress: ip || null, fieldChanged: existing ? 'multiple' : null, previousValue: null, newValue: null });
    if (patch.status === 'Active' && patch.dateJoined && (!existing || ['dateJoined', 'employmentType', 'employmentTypeId', 'employmentStatus', 'probationStatus', 'permanentEffectiveDate'].some(k => employment[k] !== undefined))) {
      const anniversary = new Date(`${String(patch.dateJoined).slice(0,10)}T00:00:00Z`); anniversary.setUTCFullYear(anniversary.getUTCFullYear() + 1);
      const autoConfirm = !!existing && employment.dateJoined !== undefined && patch.probationStatus !== 'Confirmed' && anniversary.valueOf() <= Date.now();
      if (autoConfirm) await confirmPermanentNative(employeeId, anniversary, actorId, tx);
      else await processEntitlementsNative(employeeId, tx);
    }
    return tx.get('employee_information_employees', { id: employeeId });
  });
}

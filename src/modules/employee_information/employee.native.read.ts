import { repository, type RepositorySession } from '../../storage/repository';
import type { EntityName } from '../../storage/table-definitions';
import { onboardingContact, populateDetailLabels } from './onboarding-mapping';
import { identifiedContacts } from './profile-requests';
import { parseProfile } from './native-utils';

export async function employeeProfileNative(employee: any, userId?: string, tx: RepositorySession = repository()) {
  const id = employee?.id, uid = employee?.userId || userId;
  const one = async (table: EntityName) => id ? (await tx.find(table, r => r.employeeId === id))[0] || null : null;
  const many = async (table: EntityName) => id ? tx.find(table, r => r.employeeId === id) : [];
  let [personalDetails, workstationDetails, contactDetails, resignationDetails, salaryHistories, bankDetails, extrasRow]: any[] = await Promise.all([
    one('employee_information_personal_details'), one('employee_information_workstation_details'), one('employee_information_contact_details'),
    one('employee_information_resignation_details'), many('employee_salary_histories'), many('employee_information_bank_details'),
    id ? tx.get('employee_profile_extras', { employeeId: id }) : null,
  ]);
  const user = uid ? await tx.get('users', { id: uid }) : null;
  const onboarding = uid ? (await tx.find('onboarding_profiles', p => p.candidateId === uid))[0] : null;
  const invites = user ? await tx.find('invites', i => String(i.email).toLowerCase() === String(user.email).toLowerCase()) : [];
  const invite = invites.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  if (contactDetails) for (const field of ['permanent', 'working', 'official', 'residential']) contactDetails[field] = parseProfile(contactDetails[field], null);
  if (onboarding || invite) {
    personalDetails ||= {};
    const defaults: any = { firstName: onboarding?.firstName || String(user?.name || '').split(' ')[0], lastName: onboarding?.lastName || String(user?.name || '').split(' ').slice(1).join(' '), fullName: onboarding ? `${onboarding.firstName} ${onboarding.lastName}`.trim() : user?.name, dob: onboarding?.dateOfBirth, gender: onboarding?.gender, nationality: onboarding?.nationality };
    for (const [key, value] of Object.entries(defaults)) if (!personalDetails[key]) personalDetails[key] = value;
    if (onboarding) contactDetails = onboardingContact(contactDetails, onboarding, user?.email || '');
    if (!bankDetails.length && onboarding?.bankName) bankDetails = [{ bankName: onboarding.bankName, accountHolderName: onboarding.accountHolderName, accountNo: onboarding.accountNumber, accountType: onboarding.accountType, currency: onboarding.currency }];
  }
  if (contactDetails?.residential?.emergencyContacts) contactDetails.residential.emergencyContacts = identifiedContacts(contactDetails.residential.emergencyContacts);
  const employmentType = employee?.employmentTypeId ? await tx.get('employment_types', { id: employee.employmentTypeId }) : null;
  if (workstationDetails) {
    workstationDetails.supervisorId = employee?.reportingManagerId || null;
    workstationDetails.functionalRoleId = workstationDetails.functionalRole;
  }
  await populateDetailLabels(personalDetails, workstationDetails);
  const manager = employee?.reportingManagerId ? await tx.get('employee_information_employees', { id: employee.reportingManagerId }) : null;
  const assignments = id ? await tx.find('attendance_roster_assignments', a => a.employeeId === id && a.status === 'Active') : [];
  const assignment = assignments.sort((a, b) => String(b.effectiveStartDate).localeCompare(String(a.effectiveStartDate)) || String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  const extras = parseProfile(extrasRow?.data);
  if (extras.personalDetails) personalDetails = { ...extras.personalDetails, ...(personalDetails || {}) };
  return { ...(employee || {}), otherDetails: extras, costCentres: extras.costCentres || [], salaryPayrollDetails: extras.salaryPayrollDetails || {},
    payrollDetails: { ...(extras.payrollDetails || {}), dependents: extras.dependents ?? extras.payrollDetails?.dependents ?? [] },
    isActive: !!employee?.isActive, timeAndAttendanceActive: !!employee?.timeAndAttendanceActive, payrollActive: !!employee?.payrollActive,
    employmentType, personalDetails, workstationDetails, contactDetails, resignationDetails, salaryHistories, bankDetails,
    employmentDetails: { ...(extras.employmentDetails || {}), dateJoined: employee?.dateJoined || invite?.joinedDate || null,
      probationStatus: employee?.probationStatus, permanentEffectiveDate: employee?.permanentEffectiveDate,
      designation: employee?.designation || invite?.designation, department: employee?.department || invite?.team,
      employmentType: employmentType?.name || employee?.employmentType || invite?.employmentType,
      organizationalRank: employee?.organizationalRank, reportingManager: manager ? [manager.firstName, manager.lastName].filter(Boolean).join(' ') || manager.callingName : employee?.organizationalRank === 'OWNER' ? 'Owner / no manager' : 'Not assigned' },
    attendance: assignment ? { rosterGroupId: assignment.groupId || assignment.rosterGroupId, effectiveStartDate: assignment.effectiveStartDate } : null,
    user: user ? { id: user.id, name: user.name, email: user.email, role: user.role } : null };
}

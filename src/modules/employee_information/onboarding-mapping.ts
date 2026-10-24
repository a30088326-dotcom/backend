import { db } from '../../lib/db';

// Fill missing onboarding contact fields without overwriting HR-maintained data.
export function onboardingContact(current: any, profile: any, email = '') {
  const fill = (saved: any, defaults: any) => {
    const result = { ...(saved || {}) };
    for (const [key, value] of Object.entries(defaults)) {
      if (result[key] === undefined || result[key] === null || result[key] === '') result[key] = value;
    }
    return result;
  };
  const contact = { ...(current || {}) };
  contact.permanent = fill(contact.permanent, {
    address: [profile.addressLine1, profile.addressLine2].filter(Boolean).join(' '),
    city: profile.city || '', postalCode: profile.postalCode || '',
  });
  contact.linkedIn ||= profile.linkedIn || '';
  contact.official = fill(contact.official, { email });
  contact.residential = { ...(contact.residential || {}) };
  contact.residential.personal = fill(contact.residential.personal || contact.personal, {
    mobile: profile.phoneNumber || '', alternatePhone: profile.alternatePhone || '', email,
  });
  if (!contact.residential.emergencyContacts?.length && profile.emergencyContactName) {
    contact.residential.emergencyContacts = [{
      name: profile.emergencyContactName, relationship: profile.emergencyContactRelation || 'Other',
      primaryPhone: profile.emergencyContactPhone || '', isPrimary: true, priority: 1,
    }];
  }
  return contact;
}
// Read labels from the same master records used by HR forms. Older onboarding
// profiles may contain lookup IDs instead of the display names.
export async function populateDetailLabels(personal: any, workstation: any) {
  for (const [field, table] of [['gender', 'eim_genders'], ['nationality', 'eim_nationalities']]) {
    if (personal && /^[0-9a-f-]{36}$/i.test(personal[field] || '')) {
      const [[lookup]] = await db.query<any[]>('SELECT name FROM ?? WHERE id=?', [table, personal[field]]);
      if (lookup) personal[field] = lookup.name;
    }
  }
  if (!workstation) return;
  for (const [field, table, label] of [
    ['companyId', 'eim_companies', 'companyName'], ['locationId', 'eim_locations', 'locationName'],
    ['departmentId', 'eim_structures', 'departmentName'], ['designationId', 'designations', 'designationName'],
  ]) {
    if (!workstation[field]) continue;
    const [[lookup]] = await db.query<any[]>('SELECT name FROM ?? WHERE id=?', [table, workstation[field]]);
    workstation[label] = lookup?.name || null;
  }
}

import { Router, type RequestHandler } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../../middleware/auth';
import { repository } from '../../storage/repository';
import schemas from '../../storage/entity-schemas.json';
import type { EntityName } from '../../storage/table-definitions';
import { organizationAccess } from '../../shared/services/organization.service';
import { sendEmail } from '../../lib/email';

const router = Router();
const route = (handler: RequestHandler): RequestHandler => (req, res, next) => { Promise.resolve(handler(req, res, next)).catch(next); };
const latest = (rows: any[]) => rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || String(a.id).localeCompare(String(b.id)))[0];
const profileFields = ['firstName','lastName','city','dateOfBirth','gender','nationality','addressLine1','addressLine2','postalCode','phoneNumber','alternatePhone','linkedIn','emergencyContactName','emergencyContactRelation','emergencyContactPhone','bankName','accountHolderName','accountNumber','accountType','currency','createdAt','updatedAt'];
const pick = (row: any, fields: string[]) => Object.fromEntries(fields.map(key => [key, row[key]]));
const html = (v: string) => v.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]!));

export async function nativeUserDetails(user: any, privateDetails: boolean, full = false) {
  const repo = repository();
  const [profiles, invites, contracts, employees, documents] = await Promise.all([
    repo.find('onboarding_profiles', p => p.candidateId === user.id),
    repo.find('invites', i => String(i.email).toLowerCase() === String(user.email).toLowerCase()),
    repo.find('contracts', c => c.candidateId === user.id),
    repo.find('employee_information_employees', e => e.userId === user.id),
    repo.find('documents', d => d.candidateId === user.id),
  ]);
  const profile = profiles[0], invite = latest(invites), contract = latest(contracts), employee = employees[0];
  return { ...pick(user, ['id','name','email','role','createdAt']), isActive: Boolean(user.isActive),
    onboardingProfile: privateDetails && profile?.firstName ? pick(profile, profileFields) : null,
    receivedInvite: invite?.designation ? pick(invite, ['designation','team','employmentType','joinedDate','status']) : null,
    documents: full ? documents.map(d => pick(d, ['id','type','status','label','createdAt'])) : documents.map(d => ({ status: d.status })),
    contract: contract ? full ? pick(contract, ['id','title','status','signedAt']) : { status: contract.status } : null,
    employee: employee ? { ...pick(employee, ['id','designation','department','employmentType','organizationalRank','dateJoined','employeeStatus','employeeNo']) } : null };
}

router.use(requireAuth);
router.get('/', route(async (req, res) => {
  const access = await organizationAccess(req.user!.userId);
  const repo = repository();
  const employees = await repo.find('employee_information_employees', () => true);
  let users = await repo.find('users', u => (!req.query.role || u.role === req.query.role)
    && (access.admin || employees.some(e => e.userId === u.id && access.visibleIds.includes(e.id))));
  users.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
  const limit = Math.max(1, Math.min(500, parseInt(String(req.query.limit || '50'), 10) || 50));
  const data = await Promise.all(users.slice((page - 1) * limit, page * limit).map(u => nativeUserDetails(u, access.admin)));
  res.json({ success: true, data, meta: { total: users.length, page, limit, totalPages: Math.ceil(users.length / limit) } });
}));
router.get('/me', route(async (req, res) => {
  const user = await repository().get('users', { id: req.user!.userId });
  if (!user) return void res.status(404).json({ success: false, message: 'User not found' });
  res.json({ success: true, data: await nativeUserDetails(user, true) });
}));
router.get('/:id', requireAdmin, route(async (req, res) => {
  const user = await repository().get('users', { id: String(req.params.id) });
  if (!user) return void res.status(404).json({ success: false, message: 'User not found' });
  res.json({ success: true, data: await nativeUserDetails(user, true, true) });
}));
for (const [path, active] of [['deactivate', 0], ['activate', 1]] as const) router.patch(`/:id/${path}`, requireAdmin, route(async (req, res) => {
  if (!active && req.user!.userId === req.params.id) return void res.status(400).json({ success: false, message: 'Cannot deactivate your own account' });
  const user = await repository().get('users', { id: String(req.params.id) });
  if (!user) return void res.status(404).json({ success: false, message: 'User not found' });
  if (user.role === 'SUPER_ADMIN' && !active) return void res.status(403).json({ success: false, message: 'The Owner account cannot be deactivated.' });
  await repository().replace('users', { ...user, isActive: active });
  res.json({ success: true, message: active ? 'User activated' : 'User deactivated' });
}));
router.delete('/:id', requireAdmin, route(async (req, res) => {
  const id = String(req.params.id);
  if (id === req.user!.userId) return void res.status(400).json({ success: false, message: 'Cannot delete your own account' });
  // Keep HR history intact. The dedicated employee removal workflow validates the complete domain graph.
  const result = await repository().transaction(async tx => {
    const user = await tx.get('users', { id });
    if (!user) return { status: 404, message: 'User not found' };
    if (user.role === 'SUPER_ADMIN') return { status: 403, message: 'The Owner account cannot be deleted.' };
    if (user.role !== 'CANDIDATE') return { status: 409, message: 'Deactivate staff accounts to preserve their HR and administration history.' };
    const employees = await tx.find('employee_information_employees', e => e.userId === id);
    const history = await tx.find('leave_applications', l => l.applicantId === id || l.approverId === id);
    if (employees.length || history.length) return { status: 409, message: 'This account has HR records. Deactivate it to retain HR history.' };
    // Retained documents and domain history require their dedicated deletion workflows.
    const removable = new Set(['users', 'onboarding_profiles', 'invites', 'user_module_permissions']);
    for (const entity of Object.keys(schemas) as EntityName[]) {
      if (removable.has(entity)) continue;
      const references = Object.keys(schemas[entity].columns).filter(k => /(?:user_?id|candidate_?id|applicant_?id|approver_?id|supervisor_?id|created_?by(?:id)?|updated_?by(?:id)?|changed_?by|verified_?by(?:id)?|approved_?by(?:id)?|invited_?by(?:id)?)$/i.test(k));
      if (references.length && (await tx.find(entity, r => references.some(k => r[k] === id))).length) return { status: 409, message: 'This account has dependent records. Deactivate it to retain HR history.' };
    }
    for (const row of await tx.find('onboarding_profiles', r => r.candidateId === id)) await tx.remove('onboarding_profiles', { id: row.id }, row._version);
    for (const row of await tx.find('invites', i => String(i.email).toLowerCase() === String(user.email).toLowerCase())) await tx.remove('invites', { id: row.id }, row._version);
    for (const row of await tx.find('user_module_permissions', p => p.userId === id)) await tx.remove('user_module_permissions', { id: row.id }, row._version);
    await tx.remove('users', { id }, user._version);
    return { status: 200, message: 'User completely deleted from the system.' };
  });
  res.status(result.status).json({ success: result.status === 200, message: result.message });
}));
router.patch('/:id/reset-password', requireAdmin, route(async (req, res) => {
  const parsed = z.string().min(3).max(72).safeParse(req.body.newPassword);
  if (!parsed.success) return void res.status(400).json({ success: false, message: 'Password must be 3–72 characters' });
  const user = await repository().get('users', { id: String(req.params.id) });
  if (!user) return void res.status(404).json({ success: false, message: 'User not found' });
  if (['ADMIN','SUPER_ADMIN'].includes(user.role) && req.user!.role !== 'SUPER_ADMIN') return void res.status(403).json({ success: false, message: 'Only the Owner can change administrator login details.' });
  await repository().replace('users', { ...user, password: await bcrypt.hash(parsed.data, 12), mustChangePassword: 1 });
  res.json({ success: true, message: 'Password has been reset successfully' });
}));
const editSchema = z.object({ name: z.string().trim().min(1).max(255).optional(), email: z.string().trim().email().max(255).optional(), role: z.enum(['SUPER_ADMIN','ADMIN','EMPLOYEE','CANDIDATE']).optional(), newPassword: z.string().min(6).max(72).optional() }).strict();
router.patch('/:id/update', requireAdmin, route(async (req, res) => {
  const parsed = editSchema.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ success: false, message: 'Enter a valid name, email, and password of 6–72 characters.' });
  const user = await repository().get('users', { id: String(req.params.id) });
  if (!user) return void res.status(404).json({ success: false, message: 'Employee login account not found.' });
  if (['ADMIN','SUPER_ADMIN'].includes(user.role) && req.user!.role !== 'SUPER_ADMIN') return void res.status(403).json({ success: false, message: 'Only the Owner can change administrator login details.' });
  const { name, email, role, newPassword } = parsed.data;
  if (role && role !== user.role && (req.user!.role !== 'SUPER_ADMIN' || role === 'SUPER_ADMIN' || user.role === 'SUPER_ADMIN' || user.id === req.user!.userId)) return void res.status(403).json({ success: false, message: 'Only the Owner can assign non-owner roles.' });
  if (newPassword && (!process.env.SMTP_USER || !process.env.SMTP_PASS)) return void res.status(503).json({ success: false, message: 'Email delivery is not configured. No password change was saved. Configure SMTP and try again.' });
  const next: any = { ...user, ...(name ? { name } : {}), ...(email ? { email } : {}), ...(role ? { role } : {}),
    ...(newPassword ? { password: await bcrypt.hash(newPassword, 12), mustChangePassword: 1 } : {}) };
  await repository().replace('users', next);
  if (!newPassword) return void res.json({ success: true, message: 'Employee updated. Password unchanged; no credentials email was sent.' });
  const loginUrl = process.env.EXTERNAL_FRONTEND_URL || process.env.FRONTEND_URL || 'http://localhost:5174';
  const delivery = await sendEmail({ to: next.email, subject: 'Your Peoples Management login details',
    html: `<div><h2>Your Peoples Management login details</h2><p>Hello ${html(next.name)},</p><p>Username / email: ${html(next.email)}</p><p>Temporary password: ${html(newPassword)}</p><p><a href="${html(loginUrl)}">Open Peoples Management</a></p><p>Change this password when you first sign in. Do not share it.</p></div>` });
  res.json({ success: true, message: delivery.sent ? 'Employee saved and login details emailed.' : 'Employee saved, but the credentials email was not sent.', recipient: next.email, delivery });
}));
export default router;

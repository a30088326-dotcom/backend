import { Router } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { requireAuth, requireAdmin, generateToken } from '../../middleware/auth';
import { requireModuleAction, organizationModuleScope } from '../../middleware/module-action';
import { validate } from '../../middleware/validate';
import { createInviteSchema } from '../../lib/validations';
import { sendEmail } from '../../lib/email';
import { repository, storageNow } from '../../storage/repository';
import { nativeRoute as route, requireValue as ensure, htmlText, frontendUrl, storedInstant } from '../../lib/native-http';

const router = Router();
const inviteForToken = async (token: string) => (await repository().find('invites', i => i.token === token))[0];
const publicUser = (u: any) => u ? { id: u.id, name: u.name, email: u.email } : null;
const sendInvitation = (invite: any, subject = "You're invited to join Peoples Management") => sendEmail({ to: invite.email, subject,
  html: `<div><h2>Welcome to the Team!</h2><p>Hi ${htmlText(invite.name)},</p><p>Please complete your Peoples Management onboarding.</p><p><a href="${htmlText(frontendUrl() + '/invite/' + invite.token)}">Accept Invitation</a></p><p>This invitation expires on ${htmlText(invite.expiresAt)}.</p></div>` });

router.post('/', requireAuth, requireModuleAction('onboarding', 'canCreate'), validate(createInviteSchema), route(async (req, res) => {
  const { name, email, role, employmentType, designation, team, joinedDate } = req.body;
  ensure(role !== 'ADMIN' || ['ADMIN','SUPER_ADMIN'].includes(req.user!.role), 'Delegated onboarding can create candidate invitations, not administrator accounts.', 403);
  const hours = Number(process.env.INVITE_TOKEN_EXPIRES_HOURS || 168);
  ensure(Number.isFinite(hours) && hours > 0 && hours <= 8760, 'Invitation expiry configuration is invalid.', 503);
  const invite = await repository().transaction(async tx => {
    ensure(!(await tx.find('users', u => String(u.email).toLowerCase() === email.toLowerCase())).length, 'A user with this email already exists in the system.', 409);
    ensure(!(await tx.find('invites', i => String(i.email).toLowerCase() === email.toLowerCase() && i.status === 'PENDING')).length, 'A pending invite already exists for this email.', 409);
    const inviter = await tx.get('users', { id: req.user!.userId });
    ensure(inviter?.isActive, 'Inviter account is inactive.', 403);
    return tx.create('invites', { id: randomUUID(), token: randomBytes(32).toString('hex'), email: email.toLowerCase(), name, role,
      employmentType: employmentType || null, designation: designation || null, team: team || null,
      joinedDate: joinedDate ? String(joinedDate).slice(0, 10) : null,
      expiresAt: new Date(Date.now() + hours * 3600000).toISOString(), invitedById: req.user!.userId, status: 'PENDING' });
  });
  const delivery = await sendInvitation(invite);
  res.status(201).json({ success: true, message: delivery.sent ? `Invitation email accepted by the mail server for ${name}` : `Invitation saved, but email was not sent. ${delivery.reason}`,
    data: { invite: { ...invite, invitedBy: publicUser(await repository().get('users', { id: req.user!.userId })) }, inviteLink: `${frontendUrl()}/invite/${invite.token}`, delivery } });
}));
router.get('/', requireAuth, requireModuleAction('onboarding', 'canView'), route(async (req, res) => {
  const organization = await organizationModuleScope(req.user!, 'onboarding');
  const invites = await repository().find('invites', i => (!req.query.status || i.status === req.query.status) && (organization || i.invitedById === req.user!.userId));
  invites.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const page = Math.max(1, parseInt(String(req.query.page || 1), 10) || 1), limit = Math.max(1, Math.min(100, parseInt(String(req.query.limit || 20), 10) || 20));
  const data = await Promise.all(invites.slice((page - 1) * limit, page * limit).map(async i => ({ ...i,
    invitedBy: publicUser(i.invitedById ? await repository().get('users', { id: i.invitedById }) : null),
    invitedUser: publicUser(i.invitedUserId ? await repository().get('users', { id: i.invitedUserId }) : null) })));
  res.json({ success: true, data, meta: { total: invites.length, page, limit, totalPages: Math.ceil(invites.length / limit) } });
}));
router.post('/:id/send-login', requireAuth, requireAdmin, route(async (req, res) => {
  ensure(process.env.SMTP_USER && process.env.SMTP_PASS, 'Email delivery is not configured. No login account was created.', 503);
  const password = randomBytes(12).toString('base64url'), hash = await bcrypt.hash(password, 12);
  const user = await repository().transaction(async tx => {
    const invite = await tx.get('invites', { id: String(req.params.id) });
    ensure(invite, 'Invitation not found', 404);
    ensure(invite.status === 'ACCEPTED', 'Invitation must be accepted by the candidate first.');
    ensure(!invite.invitedUserId, 'Login has already been sent to this user.', 409);
    const user = await tx.create('users', { id: randomUUID(), name: invite.name, email: invite.email,
      role: invite.role, password: hash, isActive: 1, mustChangePassword: 1 });
    await tx.replace('invites', { ...invite, invitedUserId: user.id });
    return user;
  });
  const delivery = await sendEmail({ to: user.email, subject: 'Your Peoples HR Login Credentials',
    html: `<p>Hi ${htmlText(user.name)},</p><p>Username / email: ${htmlText(user.email)}</p><p>Temporary password: ${htmlText(password)}</p><p><a href="${htmlText(frontendUrl())}">Log In Now</a></p><p>Change your temporary password when you sign in.</p>` });
  res.json({ success: true, message: delivery.sent ? 'Login credentials generated and sent to the candidate.' : 'Login saved, but email was not sent. Use the HR password reset workflow to retry delivery.', data: { user: publicUser(user), delivery } });
}));
router.get('/:token', route(async (req, res) => {
  const invite = await inviteForToken(String(req.params.token));
  ensure(invite, 'Invitation not found', 404);
  if (invite.status === 'PENDING' && (!Number.isFinite(storedInstant(invite.expiresAt)) || storedInstant(invite.expiresAt) <= Date.now())) {
    await repository().replace('invites', { ...invite, status: 'EXPIRED' });
    res.status(410).json({ success: false, message: 'This invitation has expired' }); return;
  }
  res.json({ success: true, data: { ...invite, invitedBy: publicUser(invite.invitedById ? await repository().get('users', { id: invite.invitedById }) : null) },
    ...(invite.status !== 'PENDING' ? { message: `Invitation already ${String(invite.status).toLowerCase()}` } : {}) });
}));
router.post('/:token/accept', route(async (req, res) => {
  const password = z.string().min(3).max(72).parse(req.body.password), hash = await bcrypt.hash(password, 12);
  const invite = await inviteForToken(String(req.params.token));
  ensure(invite, 'Invitation not found', 404);
  if (!Number.isFinite(storedInstant(invite.expiresAt)) || storedInstant(invite.expiresAt) <= Date.now()) {
    if (invite.status === 'PENDING') await repository().replace('invites', { ...invite, status: 'EXPIRED' });
    res.status(410).json({ success: false, message: 'This invitation has expired' }); return;
  }
  const result = await repository().transaction(async tx => {
    const current = await tx.get('invites', { id: invite.id });
    ensure(current?.status === 'PENDING' && current.token === req.params.token, 'Invitation is no longer pending.', 409);
    ensure(storedInstant(current.expiresAt) > Date.now(), 'This invitation has expired', 410);
    const user = await tx.create('users', { id: randomUUID(), email: current.email, name: current.name, role: current.role, password: hash, isActive: 1, mustChangePassword: 0 });
    const updated = await tx.replace('invites', { ...current, status: 'ACCEPTED', acceptedAt: storageNow(), invitedUserId: user.id });
    return { user, invite: updated };
  });
  res.json({ success: true, message: 'Invitation accepted successfully!', data: { invite: result.invite,
    token: generateToken({ userId: result.user.id, email: result.user.email, role: result.user.role }), user: { ...publicUser(result.user), role: result.user.role } } });
}));
router.post('/:token/decline', route(async (req, res) => {
  const invite = await inviteForToken(String(req.params.token)); ensure(invite, 'Invitation not found', 404);
  ensure(invite.status === 'PENDING', 'Invitation is no longer pending.', 409);
  await repository().replace('invites', { ...invite, status: 'DECLINED', declinedAt: storageNow() });
  res.json({ success: true, message: 'Invitation declined' });
}));
router.post('/:id/resend', requireAuth, requireModuleAction('onboarding', 'canCreate'), route(async (req, res) => {
  const invite = await repository().get('invites', { id: String(req.params.id) }); ensure(invite, 'Invitation not found.', 404);
  ensure(invite.invitedById === req.user!.userId || await organizationModuleScope(req.user!, 'onboarding'), 'Invitation is outside your onboarding scope.', 403);
  ensure(invite.status === 'PENDING' && storedInstant(invite.expiresAt) > Date.now(), 'Only an unexpired pending invitation can be resent.', 409);
  const delivery = await sendInvitation(invite, 'Your Peoples Management onboarding invitation');
  res.json({ success: true, data: { id: invite.id, delivery }, message: delivery.sent ? 'Invitation email accepted by the mail server.' : 'Invitation retained. Email was not sent.' });
}));
router.delete('/:id', requireAuth, requireAdmin, route(async (req, res) => {
  await repository().transaction(async tx => {
    const invite = await tx.get('invites', { id: String(req.params.id) }); ensure(invite, 'Invite not found', 404);
    ensure(!invite.invitedUserId && invite.status !== 'ACCEPTED', 'This invitation has a login account. Manage that account separately to preserve HR records.', 409);
    await tx.remove('invites', { id: invite.id }, invite._version);
  });
  res.json({ success: true, message: 'Invitation deleted completely' });
}));
export default router;

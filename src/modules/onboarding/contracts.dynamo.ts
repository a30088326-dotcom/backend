import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { requireAuth } from '../../middleware/auth';
import { requireModuleAction, canManageCandidate } from '../../middleware/module-action';
import { validate } from '../../middleware/validate';
import { createContractSchema, signContractSchema } from '../../lib/validations';
import { sendEmail } from '../../lib/email';
import { repository, storageNow } from '../../storage/repository';
import { putStoredUpload, deleteStoredUpload } from '../../storage/upload-storage';
import { nativeRoute as route, requireValue as ensure, htmlText, frontendUrl } from '../../lib/native-http';

const router = Router();
router.use(requireAuth);
const render = (template: string, values: Record<string, string>) => Object.entries(values).reduce((text, [key, value]) => text.split(`{{${key}}}`).join(value), template);
function content(template: unknown, values: unknown): asserts template is string {
  ensure(typeof template === 'string' && template.trim() && template.length <= 10000, 'Contract template must contain between 1 and 10,000 characters.');
  ensure(values && typeof values === 'object' && !Array.isArray(values) && Object.keys(values).length <= 100 && Object.values(values).every(v => typeof v === 'string') && JSON.stringify(values).length <= 40000, 'Contract values are invalid.');
}
async function decorated(contract: any) {
  const [candidate, creator] = await Promise.all([repository().get('users', { id: contract.candidateId }), contract.createdById ? repository().get('users', { id: contract.createdById }) : undefined]);
  return { ...contract, candidate: candidate ? { id: candidate.id, name: candidate.name, email: candidate.email } : null,
    createdBy: creator ? { id: creator.id, name: creator.name } : null };
}
router.post('/', requireModuleAction('onboarding','canCreate'), validate(createContractSchema), route(async (req, res) => {
  const { candidateId, title, templateContent, fieldValues } = req.body;
  content(templateContent, fieldValues);
  ensure(await canManageCandidate(req.user!, candidateId), 'Candidate is outside your onboarding scope.', 403);
  const contract = await repository().transaction(async tx => {
    const candidate = await tx.get('users', { id: candidateId }); ensure(candidate, 'Candidate not found', 404);
    ensure(!(await tx.find('contracts', c => c.candidateId === candidateId)).length, 'A contract already exists for this candidate', 409);
    // The candidate aggregate serializes concurrent contract creation.
    await tx.replace('users', { ...candidate, contractRevision: Number(candidate.contractRevision || 0) + 1 });
    return tx.create('contracts', { id: randomUUID(), title, templateContent, renderedContent: render(templateContent, fieldValues),
      fieldValues, status: 'SENT', candidateId, createdById: req.user!.userId });
  });
  res.status(201).json({ success: true, message: 'Contract created and available in the candidate portal. Email has not been sent yet.', data: contract });
}));
router.put('/:id', requireModuleAction('onboarding','canCreate'), route(async (req, res) => {
  const { templateContent, fieldValues } = req.body; content(templateContent, fieldValues);
  const current = await repository().get('contracts', { id: String(req.params.id) }); ensure(current, 'Contract not found', 404);
  ensure(await canManageCandidate(req.user!, current.candidateId), 'Candidate is outside your onboarding scope.', 403);
  ensure(!['SIGNED','CANCELLED'].includes(current.status), `A ${String(current.status).toLowerCase()} contract cannot be edited.`, 409);
  const saved = await repository().replace('contracts', { ...current, templateContent, renderedContent: render(templateContent, fieldValues), fieldValues });
  res.json({ success: true, message: 'Contract changes saved.', data: saved });
}));
router.get('/', route(async (req, res) => {
  const rows = await repository().find('contracts', c => ['ADMIN','SUPER_ADMIN'].includes(req.user!.role) || c.candidateId === req.user!.userId);
  rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  res.json({ success: true, data: await Promise.all(rows.map(decorated)) });
}));
router.get('/:id', route(async (req, res) => {
  const contract = await repository().get('contracts', { id: String(req.params.id) }); ensure(contract, 'Contract not found', 404);
  ensure(['ADMIN','SUPER_ADMIN'].includes(req.user!.role) || contract.candidateId === req.user!.userId, 'Access denied', 403);
  res.json({ success: true, data: await decorated(contract) });
}));
router.post('/:id/sign', validate(signContractSchema), route(async (req, res) => {
  const contract = await repository().get('contracts', { id: String(req.params.id) }); ensure(contract, 'Contract not found', 404);
  ensure(contract.candidateId === req.user!.userId, 'You can only sign your own contract', 403);
  ensure(contract.status === 'SENT', `Contract cannot be signed in status: ${contract.status}`, 409);
  const signature = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(req.body.signatureDataUrl);
  ensure(signature && signature[2].length <= 1400000, 'Use a PNG or JPEG signature image no larger than 1 MB.');
  const bytes = Buffer.from(signature[2], 'base64');
  ensure(bytes.length > 16 && bytes.length <= 1024 * 1024 && (signature[1] === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : bytes[0] === 255 && bytes[1] === 216), 'Invalid signature image.');
  const filename = `signature-${randomUUID()}.${signature[1] === 'png' ? 'png' : 'jpg'}`;
  const folder = await mkdtemp(path.join(tmpdir(), 'hr-signature-'));
  let persisted = false, committed = false;
  try {
    const local = path.join(folder, filename); await writeFile(local, bytes, { mode: 0o600 });
    await putStoredUpload(local, filename); persisted = true;
    const signed = await repository().transaction(async tx => {
      const current = await tx.get('contracts', { id: contract.id });
      ensure(current?.status === 'SENT' && current._version === contract._version, 'Contract changed. Review it again before signing.', 409);
      const saved = await tx.replace('contracts', { ...current, status: 'SIGNED', signatureUrl: `/api/files/${filename}`, signedAt: storageNow(), signerIp: req.ip || req.socket.remoteAddress || 'unknown' });
      const user = await tx.get('users', { id: current.candidateId });
      const employee = (await tx.find('employee_information_employees', e => e.userId === current.candidateId && e.status === 'Active' && Number(e.isActive) === 1))[0];
      if (user?.role === 'CANDIDATE' && employee) await tx.replace('users', { ...user, role: 'EMPLOYEE' });
      return saved;
    });
    committed = true;
    res.json({ success: true, message: 'Contract signed successfully', data: signed });
  } finally {
    if (persisted && !committed) {
      // A transport timeout may follow a successful DynamoDB commit. Keep the object
      // whenever its reference cannot be authoritatively checked.
      try {
        const saved = await repository().get('contracts', { id: contract.id });
        if (saved?.signatureUrl !== `/api/files/${filename}`) await deleteStoredUpload(filename);
      } catch (error: any) { console.error('Signature cleanup deferred until storage audit:', error.name); }
    }
    await unlink(path.join(folder, filename)).catch(() => undefined);
    await rmdir(folder).catch(() => undefined);
  }
}));
router.post('/:id/send-link', requireModuleAction('onboarding','canCreate'), route(async (req, res) => {
  const contract = await repository().get('contracts', { id: String(req.params.id) }); ensure(contract, 'Contract not found', 404);
  ensure(await canManageCandidate(req.user!, contract.candidateId), 'Candidate is outside your onboarding scope.', 403);
  const candidate = await repository().get('users', { id: contract.candidateId }); ensure(candidate?.email, 'Candidate has no email address');
  const delivery = await sendEmail({ to: candidate.email, subject: 'Action Required: Sign Employment Contract',
    html: `<h2>Action Required: Sign Employment Contract</h2><p>Hi ${htmlText(candidate.name)},</p><p>Your employment contract (${htmlText(contract.title)}) is ready for review.</p><p><a href="${htmlText(frontendUrl())}">Go to My Onboarding</a></p>` });
  res.json({ success: true, message: delivery.sent ? 'Contract email accepted by the mail server' : delivery.reason, data: { delivery } });
}));
export default router;

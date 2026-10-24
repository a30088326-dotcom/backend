import { Router } from 'express';
import path from 'node:path';
import { requireAuth } from '../../middleware/auth';
import { canManageCandidate } from '../../middleware/module-action';
import { repository } from '../../storage/repository';
import { streamStoredUpload } from '../../storage/upload-storage';
import { organizationAccess } from '../../shared/services/organization.service';
import { nativeRoute as route, requireValue as ensure } from '../../lib/native-http';

export function fileNameInUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !url) return null;
  try {
    const parsed = new URL(url, 'http://local.invalid');
    if (!/^\/(?:api\/files|uploads)\//.test(parsed.pathname)) return null;
    const filename = decodeURIComponent(parsed.pathname.split('/').pop()!);
    return filename === path.basename(filename) && !/[\\/\x00]/.test(filename) ? filename : null;
  } catch { return null; }
}
const router = Router(); router.use(requireAuth);
router.get('/:filename', route(async (req, res) => {
  const filename = String(req.params.filename);
  ensure(filename && filename === path.basename(filename) && !/[\\/\x00]/.test(filename) && filename !== '.' && filename !== '..', 'Invalid file.');
  const repo = repository(), user = req.user!;
  const [docs, attachments, signatures, avatars, grants] = await Promise.all([
    repo.find('documents', d => fileNameInUrl(d.fileUrl) === filename),
    repo.find('employee_information_employee_attachments', a => fileNameInUrl(a.fileUrl) === filename),
    repo.find('contracts', c => fileNameInUrl(c.signatureUrl) === filename),
    repo.find('employee_information_employees', e => fileNameInUrl(e.avatar) === filename),
    repo.find('user_module_permissions', p => p.userId === user.userId),
  ]);
  const employees = await repo.find('employee_information_employees', e => attachments.some(a => a.employeeId === e.id) || docs.some(d => d.candidateId === e.userId));
  const hasReference = docs.length + attachments.length + signatures.length + avatars.length > 0;
  let permitted = docs.some(d => d.candidateId === user.userId) || signatures.some(c => c.candidateId === user.userId)
    || avatars.some(e => e.userId === user.userId) || attachments.some(a => employees.some(e => e.id === a.employeeId && e.userId === user.userId));
  if (!permitted && attachments.length) permitted = (await repo.find('leave_applications', l => l.approverId === user.userId && fileNameInUrl(l.attachmentUrl) === filename && attachments.some(a => a.employeeId === l.employeeId))).length > 0;
  if (!permitted && user.role === 'SUPER_ADMIN') permitted = hasReference;
  if (!permitted && avatars.length && ['ADMIN','EMPLOYEE'].includes(user.role)) {
    const own = (await repo.find('employee_information_employees', e => e.userId === user.userId && e.status === 'Active' && Number(e.isActive ?? 1) === 1))[0];
    permitted = !!own && avatars.some(e => e.id === own.reportingManagerId && e.status === 'Active' && Number(e.isActive ?? 1) === 1);
  }
  const canView = (moduleId: string) => {
    const p = grants.find(p => p.moduleId === moduleId);
    return p ? !!p.moduleAccess && !!p.canView : user.role === 'ADMIN';
  };
  if (!permitted && canView('document_verification')) for (const doc of docs) if (await canManageCandidate(user, doc.candidateId, 'document_verification')) permitted = true;
  if (!permitted && canView('onboarding')) for (const contract of signatures) if (await canManageCandidate(user, contract.candidateId, 'onboarding')) permitted = true;
  if (!permitted && canView('employee_information') && hasReference) {
    const access = await organizationAccess(user.userId);
    permitted = attachments.some(a => access.visibleIds.includes(a.employeeId)) || avatars.some(e => access.visibleIds.includes(e.id))
      || employees.some(e => access.visibleIds.includes(e.id));
  }
  if (!permitted) { res.status(404).json({ success: false, message: 'File not found or outside your access.' }); return; }
  if (!await streamStoredUpload(filename, res)) res.status(404).json({ success: false, message: 'File is missing from storage. Restore the uploaded file from backup.' });
}));
export default router;

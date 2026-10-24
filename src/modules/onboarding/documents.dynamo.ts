import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { requireAuth } from '../../middleware/auth';
import { requireModuleAction, canManageCandidate } from '../../middleware/module-action';
import { validate } from '../../middleware/validate';
import { verifyDocumentSchema } from '../../lib/validations';
import { sendEmail } from '../../lib/email';
import { nativeRoute as route, requireValue as ensure, htmlText, frontendUrl } from '../../lib/native-http';
import { repository, storageNow } from '../../storage/repository';
import { putStoredUpload, deleteStoredUpload, uploadStorageProvider } from '../../storage/upload-storage';
import { fileNameInUrl } from './files.dynamo';
import { portableFileUrl } from './files.routes';

const router = Router(); router.use(requireAuth);
const documentTypes = ['NATIONAL_ID','BANK_STATEMENT','PASSPORT_PHOTO','EMPLOYMENT_DOCS','PREVIOUS_SERVICE','OTHER'];
const upload = multer({ storage: multer.diskStorage({ destination: (_req, _file, callback) => {
  mkdirSync(path.resolve('uploads'), { recursive: true }); callback(null, path.resolve('uploads'));
}, filename: (_req, file, callback) => callback(null, `${randomUUID()}${file.mimetype === 'application/pdf' ? '.pdf' : file.mimetype === 'image/png' ? '.png' : '.jpg'}`) }),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => ['application/pdf','image/jpeg','image/jpg','image/png'].includes(file.mimetype) ? callback(null, true) : callback(new Error('Only PDF, JPG, and PNG files are allowed')) });
router.post('/upload', upload.single('file'), route(async (req, res) => {
  ensure(req.file, 'No file uploaded');
  const file = req.file, docId = randomUUID();
  let savedId = docId, persisted = false, committed = false, confirmedUnreferenced = false;
  try {
    const { documentType, label } = req.body;
    ensure(documentTypes.includes(documentType), 'Select a valid document type.');
    ensure(label === undefined || typeof label === 'string' && label.length <= 255, 'Document label must be at most 255 characters.');
    await putStoredUpload(file.path, file.filename, file.mimetype); persisted = true;
    const document = await repository().transaction(async tx => {
      const candidate = await tx.get('users', { id: req.user!.userId }); ensure(candidate, 'Candidate not found', 404);
      const existing = await tx.find('documents', d => d.candidateId === req.user!.userId && d.type === documentType);
      existing.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      const rejected = existing.find(d => d.status === 'REJECTED');
      ensure(existing.length < 4 || rejected, `You can upload up to 4 files for ${label || documentType}.`, 409);
      // A shared parent write serializes the per-candidate upload limit, including new documents.
      await tx.replace('users', { ...candidate, documentRevision: Number(candidate.documentRevision || 0) + 1 });
      const kb = Math.round(file.size / 1024);
      const values = { label: label ?? documentType.replace('_', ' '), fileUrl: `/api/files/${file.filename}`, fileName: file.originalname,
        fileSize: kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`, fileType: file.mimetype === 'application/pdf' ? 'PDF' : file.mimetype.split('/')[1].toUpperCase(),
        status: 'PENDING', rejectionNote: null, rejectionReason: null, verifiedById: null, verifiedAt: null };
      savedId = rejected?.id || docId;
      return rejected ? tx.replace('documents', { ...rejected, ...values })
        : tx.create('documents', { id: docId, type: documentType, candidateId: req.user!.userId, ...values });
    });
    committed = true;
    res.status(201).json({ success: true, message: 'Document uploaded successfully', data: document });
  } finally {
    if (persisted && !committed) {
      try {
        const saved = await repository().get('documents', { id: savedId });
        if (fileNameInUrl(saved?.fileUrl) !== file.filename) { confirmedUnreferenced = true; await deleteStoredUpload(file.filename); }
      } catch (error: any) { console.error('Document cleanup deferred until storage audit:', error.name); }
    }
    if (uploadStorageProvider() === 's3' || !persisted || confirmedUnreferenced) await unlink(file.path).catch(() => undefined);
  }
}));
router.get('/', route(async (req, res) => {
  const id = typeof req.query.candidateId === 'string' ? req.query.candidateId : req.user!.userId;
  if (id !== req.user!.userId) {
    const p = (await repository().find('user_module_permissions', p => p.userId === req.user!.userId && p.moduleId === 'document_verification'))[0];
    const allowed = req.user!.role === 'SUPER_ADMIN' || (p ? p.moduleAccess && p.canView : req.user!.role === 'ADMIN');
    ensure(allowed && await canManageCandidate(req.user!, id, 'document_verification'), 'This candidate is outside your document verification access.', 403);
  }
  const docs = await repository().find('documents', d => d.candidateId === id);
  docs.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const data = await Promise.all(docs.map(async d => {
    const verifier = d.verifiedById ? await repository().get('users', { id: d.verifiedById }) : undefined;
    return { ...d, fileUrl: portableFileUrl(d.fileUrl), verifiedBy: verifier ? { id: verifier.id, name: verifier.name } : null };
  }));
  res.json({ success: true, data });
}));
async function notifyReupload(document: any) {
  const candidate = await repository().get('users', { id: document.candidateId });
  if (!candidate?.email) return { sent: false, reason: 'Candidate has no email address.' };
  return sendEmail({ to: candidate.email, subject: `Upload Request: ${document.label}`,
    html: `<h2>Document Re-upload Required</h2><p>Hi ${htmlText(candidate.name)},</p><p>Please upload a valid copy of ${htmlText(document.label)}.</p>${document.rejectionNote ? `<p>Note from HR: ${htmlText(document.rejectionNote)}</p>` : ''}<p><a href="${htmlText(frontendUrl() + '/onboarding')}">Open My Onboarding</a></p>` });
}
router.patch('/:id/verify', requireModuleAction('document_verification','canApprove'), validate(verifyDocumentSchema), route(async (req, res) => {
  const doc = await repository().get('documents', { id: String(req.params.id) }); ensure(doc, 'Document not found', 404);
  ensure(await canManageCandidate(req.user!, doc.candidateId, 'document_verification'), 'This candidate is outside your onboarding scope.', 403);
  ensure(doc.status === 'PENDING', 'Document was already reviewed. Refresh before taking another action.', 409);
  const { status, rejectionNote } = req.body;
  ensure(status !== 'REJECTED' || typeof rejectionNote === 'string' && rejectionNote.trim(), 'Rejection note is required when rejecting a document');
  ensure(rejectionNote === undefined || rejectionNote.length <= 5000, 'Rejection note is too long.');
  const saved = await repository().replace('documents', { ...doc, status, rejectionNote: status === 'REJECTED' ? rejectionNote : null,
    verifiedById: req.user!.userId, verifiedAt: storageNow() });
  const candidate = await repository().get('users', { id: doc.candidateId });
  const delivery = status === 'REJECTED' ? await notifyReupload(saved) : undefined;
  res.json({ success: true, message: `Document ${status.toLowerCase()} successfully`, data: { ...saved, candidate: candidate ? { id: candidate.id, name: candidate.name, email: candidate.email } : null }, ...(delivery ? { delivery } : {}) });
}));
router.post('/:id/request-reupload', requireModuleAction('document_verification','canEdit'), route(async (req, res) => {
  const document = await repository().get('documents', { id: String(req.params.id) }); ensure(document, 'Document not found', 404);
  ensure(await canManageCandidate(req.user!, document.candidateId, 'document_verification'), 'This candidate is outside your document verification access.', 403);
  const delivery = await notifyReupload(document);
  res.json({ success: true, message: delivery.sent ? 'Upload link sent successfully' : delivery.reason, data: { delivery } });
}));
export default router;

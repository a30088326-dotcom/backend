// @ts-nocheck
import { Router, Request, Response } from 'express';
import multer from 'multer';
import { db } from '../../lib/db';
import { RowDataPacket } from 'mysql2';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth, requireAdmin, generateToken } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { verifyDocumentSchema } from '../../lib/validations';
import { sendEmail } from '../../lib/email';
import { requireModuleAction, canManageCandidate } from '../../middleware/module-action';

type DocumentType = 'NATIONAL_ID' | 'BANK_STATEMENT' | 'PASSPORT_PHOTO' | 'EMPLOYMENT_DOCS' | 'PREVIOUS_SERVICE' | 'OTHER';
const MAX_DOCUMENTS_PER_TYPE = 4;

const router = Router();

import fs from 'fs';
import path from 'path';

const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

// ─── Configure Multer ─────────────────────────────────────────────
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF, JPG, and PNG files are allowed'));
    }
  },
});

// ─── POST /api/documents/upload ──────────────────────────────────────────────
// Candidate uploads a document to local storage and saves its URL in the database.
router.post(
  '/upload',
  requireAuth,
  upload.single('file'),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      if (req.file?.path) await fs.promises.unlink(req.file.path).catch(() => undefined);
      res.status(401).json({ success: false, message: 'Not authenticated' });
      return;
    }

    if (!req.file) {
      res.status(400).json({ success: false, message: 'No file uploaded' });
      return;
    }
    const removeNewFile = async () => {
      if (req.file?.path) await fs.promises.unlink(req.file.path).catch(() => undefined);
    };

    const { documentType, label } = req.body as {
      documentType: string;
      label?: string;
    };

    const validTypes: DocumentType[] = [
      'NATIONAL_ID', 'BANK_STATEMENT', 'PASSPORT_PHOTO', 'EMPLOYMENT_DOCS', 'PREVIOUS_SERVICE', 'OTHER',
    ];

    if (!validTypes.includes(documentType as DocumentType)) {
      await removeNewFile();
      res.status(400).json({
        success: false,
        message: `Invalid documentType. Must be one of: ${validTypes.join(', ')}`,
      });
      return;
    }

    let connection;
    try {
      connection = await db.getConnection();
      await connection.beginTransaction();
      // Lock the candidate so concurrent uploads cannot both pass the four-file limit.
      const [candidateRows] = await connection.query<RowDataPacket[]>(
        'SELECT id FROM users WHERE id = ? FOR UPDATE', [req.user.userId]
      );
      if (!candidateRows.length) {
        await connection.rollback();
        await removeNewFile();
        res.status(404).json({ success: false, message: 'Candidate not found' });
        return;
      }
      const [existingDocs] = await connection.query<RowDataPacket[]>(
        'SELECT id, status FROM documents WHERE candidateId = ? AND type = ? ORDER BY createdAt ASC FOR UPDATE',
        [req.user.userId, documentType]
      );
      const rejectedDoc = existingDocs.find(doc => doc.status === 'REJECTED');
      if (existingDocs.length >= MAX_DOCUMENTS_PER_TYPE && !rejectedDoc) {
        await connection.rollback();
        await removeNewFile();
        res.status(409).json({ success: false, message: `You can upload up to ${MAX_DOCUMENTS_PER_TYPE} files for ${label || documentType}.` });
        return;
      }

      const filename = req.file.filename;
      const url = `http://localhost:${process.env.PORT || 3001}/uploads/${filename}`;

      const fileSizeKB = Math.round(req.file.size / 1024);
      const fileSize = fileSizeKB > 1024
        ? `${(fileSizeKB / 1024).toFixed(1)} MB`
        : `${fileSizeKB} KB`;

      const fileType = req.file.mimetype === 'application/pdf'
        ? 'PDF'
        : req.file.mimetype.split('/')[1].toUpperCase();

      // A rejected file is resubmitted in place; approved and pending files stay intact.
      const docId = rejectedDoc?.id || uuidv4();
      const docLabel = label ?? documentType.replace('_', ' ');
      if (rejectedDoc) {
        await connection.query(
          'UPDATE documents SET label = ?, fileUrl = ?, fileName = ?, fileSize = ?, fileType = ?, status = "PENDING", rejectionNote = NULL, rejectionReason = NULL, verifiedById = NULL, verifiedAt = NULL, updatedAt = NOW() WHERE id = ?',
          [docLabel, url, req.file.originalname, fileSize, fileType, docId]
        );
      } else {
        await connection.query(
          'INSERT INTO documents (id, type, label, fileUrl, fileName, fileSize, fileType, candidateId, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, "PENDING", NOW(), NOW())',
          [docId, documentType, docLabel, url, req.file.originalname, fileSize, fileType, req.user.userId]
        );
      }

      const [docRows] = await connection.query<RowDataPacket[]>('SELECT * FROM documents WHERE id = ? LIMIT 1', [docId]);
      const document = docRows[0];
      await connection.commit();

      res.status(201).json({
        success: true,
        message: 'Document uploaded successfully',
        data: document,
      });
    } catch (error) {
      if (connection) await connection.rollback();
      await removeNewFile();
      console.error('[Documents] Upload error:', error);
      res.status(500).json({ success: false, message: 'Failed to upload document' });
    } finally {
      connection?.release();
    }
  },
);

// ─── GET /api/documents ───────────────────────────────────────────────────────
// Get documents — candidate sees their own, admin can query by candidateId
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ success: false, message: 'Not authenticated' });
    return;
  }

  const { candidateId } = req.query as { candidateId?: string };

  const targetId = candidateId || req.user.userId;

  try {
    if (targetId !== req.user.userId) {
      const [[p]] = await db.query<RowDataPacket[]>('SELECT moduleAccess,canView FROM user_module_permissions WHERE userId=? AND moduleId=\'document_verification\'',[req.user.userId]);
      const permitted = req.user.role === 'SUPER_ADMIN' || (p ? p.moduleAccess && p.canView : req.user.role === 'ADMIN');
      if (!permitted || !await canManageCandidate(req.user,targetId,'document_verification')) {
        res.status(403).json({success:false,message:'This candidate is outside your document verification access.'}); return;
      }
    }
    const query = `
      SELECT d.*, u.id as vb_id, u.name as vb_name
      FROM documents d
      LEFT JOIN users u ON d.verifiedById = u.id
      WHERE d.candidateId = ?
      ORDER BY d.createdAt DESC
    `;
    const [rows] = await db.query<RowDataPacket[]>(query, [targetId]);
    
    const documents = rows.map((row) => ({
      ...row,
      verifiedBy: row.vb_id ? { id: row.vb_id, name: row.vb_name } : null
    }));

    res.json({ success: true, data: documents });
  } catch (error) {
    console.error('[Documents] List error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch documents' });
  }
});

// ─── PATCH /api/documents/:id/verify ─────────────────────────────────────────
// Admin approves or rejects a document
router.patch(
  '/:id/verify',
  requireAuth,
  requireModuleAction('document_verification', 'canApprove'),
  validate(verifyDocumentSchema),
  async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id as string;
    const { status, rejectionNote } = req.body as {
      status: 'APPROVED' | 'REJECTED';
      rejectionNote?: string;
    };

    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated' });
      return;
    }

    if (status === 'REJECTED' && !rejectionNote?.trim()) {
      res.status(400).json({
        success: false,
        message: 'Rejection note is required when rejecting a document',
      });
      return;
    }

    try {
      const [docRows] = await db.query<RowDataPacket[]>('SELECT * FROM documents WHERE id = ? LIMIT 1', [id]);
      const document = docRows[0];

      if (!document) {
        res.status(404).json({ success: false, message: 'Document not found' });
        return;
      }

      if (!await canManageCandidate(req.user, document.candidateId, 'document_verification')) {
        res.status(403).json({success:false,message:'This candidate is outside your onboarding scope.'}); return;
      }
      const note = status === 'REJECTED' ? rejectionNote : null;
      const [decisionResult] = await db.query(
        'UPDATE documents SET status = ?, rejectionNote = ?, verifiedById = ?, verifiedAt = NOW(), updatedAt = NOW() WHERE id = ? AND status = \'PENDING\'',
        [status, note, req.user.userId, id]
      );

      if(!decisionResult.affectedRows) {res.status(409).json({success:false,message:'Document was already reviewed. Refresh before taking another action.'}); return;}

      const [updatedRows] = await db.query<RowDataPacket[]>(`
        SELECT d.*, c.id as c_id, c.name as c_name, c.email as c_email 
        FROM documents d 
        LEFT JOIN users c ON d.candidateId = c.id 
        WHERE d.id = ? LIMIT 1
      `, [id]);
      const updatedRow = updatedRows[0];
      const updated = {
        ...updatedRow,
        candidate: updatedRow.c_id ? { id: updatedRow.c_id, name: updatedRow.c_name, email: updatedRow.c_email } : null
      };

      // Send email if rejected
      if (status === 'REJECTED' && updated.candidate?.email) {
        const candidateToken = generateToken({
          userId: updated.candidate.id,
          email: updated.candidate.email,
          role: 'CANDIDATE'
        });
        const loginUrl = `${process.env.FRONTEND_URL ?? 'http://localhost:5174'}/login?auth_token=${candidateToken}`;
        await sendEmail({
          to: updated.candidate.email,
          subject: 'Action Required: Document Rejected',
          html: `
            <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
              <h2>Action Required: Document Rejected</h2>
              <p>Hi ${updated.candidate.name || 'Candidate'},</p>
              <p>Your uploaded document (<strong>${updated.label}</strong>) has been reviewed and requires your attention.</p>
              <div style="background-color: #fef2f2; border: 1px solid #fecaca; padding: 15px; border-radius: 8px; margin: 20px 0;">
                <strong>Reason:</strong> ${rejectionNote}
              </div>
              <p>Please log in to your onboarding portal to re-upload the document:</p>
              <a href="${loginUrl}" style="display: inline-block; background: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; margin: 10px 0;">Go to My Onboarding</a>
              <p style="color: #666; font-size: 12px; mt: 20px;">If the button doesn't work, copy and paste this link: ${loginUrl}</p>
            </div>
          `,
        });
      }

      res.json({
        success: true,
        message: `Document ${status.toLowerCase()} successfully`,
        data: updated,
      });
    } catch (error) {
      console.error('[Documents] Verify error:', error);
      res.status(500).json({ success: false, message: 'Failed to update document status' });
    }
  },
);

// ─── POST /api/documents/:id/request-reupload ────────────────────────────────
router.post(
  '/:id/request-reupload',
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id as string;
    try {
      const [docRows] = await db.query<RowDataPacket[]>(`
        SELECT d.*, c.id as c_id, c.name as c_name, c.email as c_email
        FROM documents d
        LEFT JOIN users c ON d.candidateId = c.id
        WHERE d.id = ? LIMIT 1
      `, [id]);
      const row = docRows[0];
      const document = row ? {
        ...row,
        candidate: row.c_id ? { id: row.c_id, name: row.c_name, email: row.c_email } : null
      } : null;

      if (!document) {
        res.status(404).json({ success: false, message: 'Document not found' });
        return;
      }

      if (document.candidate?.email) {
        const candidateToken = generateToken({
          userId: document.candidate.id,
          email: document.candidate.email,
          role: 'CANDIDATE'
        });
        const loginUrl = `${process.env.FRONTEND_URL ?? 'http://localhost:5174'}/login?auth_token=${candidateToken}`;
        await sendEmail({
          to: document.candidate.email,
          subject: `Upload Request: ${document.label}`,
          html: `
            <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
              <h2>Document Re-upload Required</h2>
              <p>Hi ${document.candidate.name || 'Candidate'},</p>
              <p>Please upload a valid copy of your <strong>${document.label}</strong>.</p>
              ${document.rejectionNote ? `
              <div style="background-color: #fef2f2; border: 1px solid #fecaca; padding: 15px; border-radius: 8px; margin: 20px 0;">
                <strong>Note from Admin:</strong> ${document.rejectionNote}
              </div>` : ''}
              <p>Click the link below to log in and upload this document:</p>
              <a href="${loginUrl}" style="display: inline-block; background: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; margin: 10px 0;">Upload Document</a>
            </div>
          `,
        });
      }

      res.json({ success: true, message: 'Upload link sent successfully' });
    } catch (error) {
      console.error('[Documents] Request reupload error:', error);
      res.status(500).json({ success: false, message: 'Failed to send upload link' });
    }
  },
);

// Invalid files are input errors, not unexpected server failures.
router.use((error:any,_req:Request,res:Response,next:any)=>{
  if(error instanceof multer.MulterError || error.message==='Only PDF, JPG, and PNG files are allowed'){
    res.status(error.code==='LIMIT_FILE_SIZE'?413:400).json({success:false,message:error.code==='LIMIT_FILE_SIZE'?'Each document must be 10 MB or smaller.':error.message});return;
  }
  next(error);
});
export default router;

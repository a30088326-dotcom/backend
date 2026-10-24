import { Router, Request, Response } from 'express';
import { v2 as cloudinary } from 'cloudinary';
import { db } from '../../lib/db';
import { RowDataPacket } from 'mysql2';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { createContractSchema, signContractSchema } from '../../lib/validations';
import { sendEmail } from '../../lib/email';
import { requireModuleAction, canManageCandidate } from '../../middleware/module-action';
import nativeRoutes from './contracts.dynamo';

const router = Router();
router.use((req, res, next) => process.env.DATABASE_PROVIDER === 'dynamodb' ? nativeRoutes(req, res, next) : next());

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ─── Helper: render template ──────────────────────────────────────────────────
function renderTemplate(template: string, values: Record<string, string>): string {
  let rendered = template;
  Object.entries(values).forEach(([key, value]) => {
    rendered = rendered.split(`{{${key}}}`).join(value);
  });
  return rendered;
}

// ─── Helper: upload base64 signature to Cloudinary ───────────────────────────
async function uploadSignature(dataUrl: string, candidateId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload(
      dataUrl,
      {
        folder: `hr-onboarding/signatures`,
        public_id: `sig-${candidateId}-${Date.now()}`,
        resource_type: 'image',
      },
      (error, result) => {
        if (error || !result) reject(error ?? new Error('Signature upload failed'));
        else resolve(result.secure_url);
      },
    );
  });
}

// ─── POST /api/contracts ─────────────────────────────────────────────────────
// Admin creates a contract for a candidate
router.post(
  '/',
  requireAuth,
  requireModuleAction('onboarding','canCreate'),
  validate(createContractSchema),
  async (req: Request, res: Response): Promise<void> => {
    const { candidateId, title, templateContent, fieldValues } = req.body as {
      candidateId: string;
      title: string;
      templateContent: string;
      fieldValues: Record<string, string>;
    };

    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated' });
      return;
    }

    try {
      if (!await canManageCandidate(req.user,candidateId)) { res.status(403).json({success:false,message:'Candidate is outside your onboarding scope.'}); return; }
      // Verify candidate exists
      const [candidateRows] = await db.query<RowDataPacket[]>('SELECT id FROM users WHERE id = ? LIMIT 1', [candidateId]);
      const candidate = candidateRows[0];
      if (!candidate) {
        res.status(404).json({ success: false, message: 'Candidate not found' });
        return;
      }

      const [existingRows] = await db.query<RowDataPacket[]>('SELECT id FROM contracts WHERE candidateId = ? LIMIT 1', [candidateId]);
      const existing = existingRows[0];
      if (existing) {
        res.status(409).json({
          success: false,
          message: 'A contract already exists for this candidate',
        });
        return;
      }

      const renderedContent = renderTemplate(templateContent, fieldValues);
      
      const contractId = uuidv4();
      await db.query(
        'INSERT INTO contracts (id, title, templateContent, renderedContent, fieldValues, status, candidateId, createdById, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, "SENT", ?, ?, NOW(), NOW())',
        [contractId, title, templateContent, renderedContent, JSON.stringify(fieldValues), candidateId, req.user.userId]
      );
      
      const [contractRows] = await db.query<RowDataPacket[]>('SELECT * FROM contracts WHERE id = ? LIMIT 1', [contractId]);
      const contract = contractRows[0];

      res.status(201).json({
        success: true,
        message: 'Contract created and available in the candidate portal. Email has not been sent yet.',
        data: contract,
      });
    } catch (error) {
      console.error('[Contracts] Create error:', error);
      res.status(500).json({ success: false, message: 'Failed to create contract' });
    }
  },
);

// ─── PUT /api/contracts/:id ──────────────────────────────────────────────────
// Admin edits an unsigned contract's template and values before signature.
router.put('/:id', requireAuth, requireModuleAction('onboarding','canCreate'), async (req: Request, res: Response): Promise<void> => {
  const { templateContent, fieldValues } = req.body as {
    templateContent?: string;
    fieldValues?: Record<string, string>;
  };

  if (!req.user) {
    res.status(401).json({ success: false, message: 'Not authenticated' });
    return;
  }
  if (typeof templateContent !== 'string' || !templateContent.trim() || templateContent.length > 10000) {
    res.status(400).json({ success: false, message: 'Contract template must contain between 1 and 10,000 characters.' });
    return;
  }
  if (!fieldValues || typeof fieldValues !== 'object' || Array.isArray(fieldValues)) {
    res.status(400).json({ success: false, message: 'Contract values are invalid.' });
    return;
  }

  try {
    const [rows] = await db.query<RowDataPacket[]>('SELECT * FROM contracts WHERE id = ? LIMIT 1', [req.params.id]);
    const contract = rows[0];
    if (!contract) {
      res.status(404).json({ success: false, message: 'Contract not found' });
      return;
    }
    if (!await canManageCandidate(req.user, contract.candidateId)) {
      res.status(403).json({ success: false, message: 'Candidate is outside your onboarding scope.' });
      return;
    }
    if (contract.status === 'SIGNED') {
      res.status(409).json({ success: false, message: 'A signed contract cannot be edited.' });
      return;
    }
    if (contract.status === 'CANCELLED') {
      res.status(409).json({ success: false, message: 'A cancelled contract cannot be edited.' });
      return;
    }

    const renderedContent = renderTemplate(templateContent, fieldValues);
    await db.query(
      'UPDATE contracts SET templateContent = ?, renderedContent = ?, fieldValues = ?, updatedAt = NOW() WHERE id = ?',
      [templateContent, renderedContent, JSON.stringify(fieldValues), req.params.id],
    );
    const [updatedRows] = await db.query<RowDataPacket[]>('SELECT * FROM contracts WHERE id = ? LIMIT 1', [req.params.id]);
    res.json({ success: true, message: 'Contract changes saved.', data: updatedRows[0] });
  } catch (error) {
    console.error('[Contracts] Update error:', error);
    res.status(500).json({ success: false, message: 'Failed to save contract changes' });
  }
});

// ─── GET /api/contracts ───────────────────────────────────────────────────────
// Admin lists all contracts OR candidate views their own
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ success: false, message: 'Not authenticated' });
    return;
  }

  try {
    let whereClause = '';
    const queryParams: any[] = [];
    if (req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN') {
      whereClause = 'WHERE c.candidateId = ?';
      queryParams.push(req.user.userId);
    }
    
    const query = `
      SELECT c.*, u1.id as can_id, u1.name as can_name, u1.email as can_email, u2.id as cb_id, u2.name as cb_name
      FROM contracts c
      LEFT JOIN users u1 ON c.candidateId = u1.id
      LEFT JOIN users u2 ON c.createdById = u2.id
      ${whereClause}
      ORDER BY c.createdAt DESC
    `;
    
    const [rows] = await db.query<RowDataPacket[]>(query, queryParams);
    const contracts = rows.map((row) => ({
      ...row,
      candidate: row.can_id ? { id: row.can_id, name: row.can_name, email: row.can_email } : null,
      createdBy: row.cb_id ? { id: row.cb_id, name: row.cb_name } : null
    }));

    res.json({ success: true, data: contracts });
  } catch (error) {
    console.error('[Contracts] List error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch contracts' });
  }
});

// ─── GET /api/contracts/:id ───────────────────────────────────────────────────
router.get('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;

  if (!req.user) {
    res.status(401).json({ success: false, message: 'Not authenticated' });
    return;
  }

  try {
    const query = `
      SELECT c.*, u1.id as can_id, u1.name as can_name, u1.email as can_email, u2.id as cb_id, u2.name as cb_name
      FROM contracts c
      LEFT JOIN users u1 ON c.candidateId = u1.id
      LEFT JOIN users u2 ON c.createdById = u2.id
      WHERE c.id = ? LIMIT 1
    `;
    const [rows] = await db.query<RowDataPacket[]>(query, [id]);
    const row = rows[0];
    const contract: any = row ? {
      ...row,
      candidate: row.can_id ? { id: row.can_id, name: row.can_name, email: row.can_email } : null,
      createdBy: row.cb_id ? { id: row.cb_id, name: row.cb_name } : null
    } : null;

    if (!contract) {
      res.status(404).json({ success: false, message: 'Contract not found' });
      return;
    }

    // Candidate can only view their own contract
    if (req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN' && contract.candidateId !== req.user.userId) {
      res.status(403).json({ success: false, message: 'Access denied' });
      return;
    }

    res.json({ success: true, data: contract });
  } catch (error) {
    console.error('[Contracts] Get error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch contract' });
  }
});

// ─── POST /api/contracts/:id/sign ────────────────────────────────────────────
// Candidate digitally signs the contract
router.post(
  '/:id/sign',
  requireAuth,
  validate(signContractSchema),
  async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id as string;
    const { signatureDataUrl } = req.body as { signatureDataUrl: string };

    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated' });
      return;
    }

    try {
      const [contractRows] = await db.query<RowDataPacket[]>(
        'SELECT c.*, u.email as candidateEmail FROM contracts c LEFT JOIN users u ON c.candidateId = u.id WHERE c.id = ? LIMIT 1', 
        [id]
      );
      const contract = contractRows[0];

      if (!contract) {
        res.status(404).json({ success: false, message: 'Contract not found' });
        return;
      }

      if (contract.candidateId !== req.user.userId) {
        res.status(403).json({ success: false, message: 'You can only sign your own contract' });
        return;
      }

      if (contract.status === 'SIGNED') {
        res.status(400).json({ success: false, message: 'Contract is already signed' });
        return;
      }

      if (contract.status !== 'SENT') {
        res.status(400).json({
          success: false,
          message: `Contract cannot be signed in status: ${contract.status}`,
        });
        return;
      }

      let signatureUrl = '';
      try {
        signatureUrl = await uploadSignature(signatureDataUrl, req.user.userId);
      } catch {
        signatureUrl = signatureDataUrl.substring(0, 500);
      }

      const signerIp = req.ip ?? req.socket.remoteAddress ?? 'unknown';

      await db.query(
        'UPDATE contracts SET status = "SIGNED", signatureUrl = ?, signedAt = NOW(), signerIp = ?, updatedAt = NOW() WHERE id = ?',
        [signatureUrl, signerIp, id]
      );
      
      const [signedRows] = await db.query<RowDataPacket[]>('SELECT * FROM contracts WHERE id = ? LIMIT 1', [id]);
      const signed = signedRows[0];

      // A signature alone does not create the HR profile, roster or reporting
      // mapping. Keep unactivated candidates in HR's onboarding queue.
      await db.query(`UPDATE users u JOIN employee_information_employees e ON e.userId=u.id
        SET u.role='EMPLOYEE',u.updatedAt=NOW()
        WHERE u.id=? AND u.role='CANDIDATE' AND e.status='Active' AND e.isActive=1`, [contract.candidateId]);

      res.json({
        success: true,
        message: 'Contract signed successfully',
        data: signed,
      });
    } catch (error) {
      console.error('[Contracts] Sign error:', error);
      res.status(500).json({ success: false, message: 'Failed to sign contract' });
    }
  },
);

// ─── POST /api/contracts/:id/send-link ───────────────────────────────────────
// Admin sends email with link to sign contract
router.post(
  '/:id/send-link',
  requireAuth,
  requireModuleAction('onboarding','canCreate'),
  async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id as string;

    try {
      const [contractRows] = await db.query<RowDataPacket[]>(`
        SELECT c.*, u.id as can_id, u.name as can_name, u.email as can_email
        FROM contracts c
        LEFT JOIN users u ON c.candidateId = u.id
        WHERE c.id = ? LIMIT 1
      `, [id]);
      const row = contractRows[0];
      const contract: any = row ? {
        ...row,
        candidate: row.can_id ? { id: row.can_id, name: row.can_name, email: row.can_email } : null
      } : null;

      if (!contract) {
        res.status(404).json({ success: false, message: 'Contract not found' });
        return;
      }

      if (!contract.candidate?.email) {
        res.status(400).json({ success: false, message: 'Candidate has no email address' });
        return;
      }
      if (!req.user || !await canManageCandidate(req.user,contract.candidate.id)) { res.status(403).json({success:false,message:'Candidate is outside your onboarding scope.'}); return; }

      const loginUrl = `${process.env.FRONTEND_URL ?? 'http://localhost:5174'}`;
      
      const delivery = await sendEmail({
        to: contract.candidate.email,
        subject: 'Action Required: Sign Employment Contract',
        html: `
          <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
            <h2>Action Required: Sign Employment Contract</h2>
            <p>Hi ${contract.candidate.name || 'Candidate'},</p>
            <p>Your employment contract (<strong>${contract.title}</strong>) is ready for your review and signature.</p>
            <p>Please log in to your onboarding portal to review and sign the contract:</p>
            <a href="${loginUrl}" style="display: inline-block; background: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; margin: 10px 0;">Go to My Onboarding</a>
            <p style="color: #666; font-size: 12px; mt: 20px;">If the button doesn't work, copy and paste this link: ${loginUrl}</p>
          </div>
        `,
      });

      res.json({ success: true, message: delivery.sent ? 'Contract email accepted by the mail server' : delivery.reason, data: { delivery } });
    } catch (error) {
      console.error('[Contracts] Send link error:', error);
      res.status(500).json({ success: false, message: 'Failed to send contract link' });
    }
  },
);

export default router;

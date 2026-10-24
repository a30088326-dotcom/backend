import { Router, Request, Response } from 'express';
import { db } from '../../lib/db';
import { RowDataPacket } from 'mysql2';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { onboardingProfileSchema } from '../../lib/validations';
import { repository } from '../../storage/repository';

const router = Router();

// ─── POST /api/onboarding ─────────────────────────────────────────────────────
// Candidate submits personal, contact, and bank details
router.post(
  '/',
  requireAuth,
  validate(onboardingProfileSchema),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated' });
      return;
    }

    const candidateId = req.user.userId;

    try {
      if (process.env.DATABASE_PROVIDER === 'dynamodb') {
        const profile = await repository().transaction(async tx => {
          const owner = await tx.get('users', { id: candidateId });
          if (!owner) throw new Error('Candidate not found.');
          await tx.replace('users', { ...owner, profileRevision: Number(owner.profileRevision || 0) + 1 });
          const existing = (await tx.find('onboarding_profiles', p => p.candidateId === candidateId))[0];
          const data = { ...req.body, dateOfBirth: String(req.body.dateOfBirth).slice(0, 10) };
          return existing ? tx.replace('onboarding_profiles', { ...existing, ...data })
            : tx.create('onboarding_profiles', { ...data, id: uuidv4(), candidateId });
        });
        res.status(201).json({ success: true, message: 'Onboarding details saved successfully', data: profile });
        return;
      }
      const [rows] = await db.query<RowDataPacket[]>('SELECT id FROM onboarding_profiles WHERE candidateId = ? LIMIT 1', [candidateId]);
      const existing = rows[0];

      const data = {
        ...req.body,
        dateOfBirth: new Date(req.body.dateOfBirth as string),
        updatedAt: new Date(),
      };

      let profile;

      if (existing) {
        const keys = Object.keys(data);
        const setClause = keys.map(k => `${k} = ?`).join(', ');
        const values = keys.map(k => data[k]);
        await db.query(`UPDATE onboarding_profiles SET ${setClause} WHERE candidateId = ?`, [...values, candidateId]);
        
        const [updated] = await db.query<RowDataPacket[]>('SELECT * FROM onboarding_profiles WHERE candidateId = ? LIMIT 1', [candidateId]);
        profile = updated[0];
      } else {
        const id = uuidv4();
        data.id = id;
        data.candidateId = candidateId;
        data.createdAt = new Date();
        const keys = Object.keys(data);
        const placeholders = keys.map(() => '?').join(', ');
        const values = keys.map(k => data[k]);
        await db.query(`INSERT INTO onboarding_profiles (${keys.join(', ')}) VALUES (${placeholders})`, values);
        
        const [inserted] = await db.query<RowDataPacket[]>('SELECT * FROM onboarding_profiles WHERE candidateId = ? LIMIT 1', [candidateId]);
        profile = inserted[0];
      }

      res.status(201).json({
        success: true,
        message: 'Onboarding details saved successfully',
        data: profile,
      });
    } catch (error) {
      console.error('[Onboarding] Submit error:', error);
      res.status(500).json({ success: false, message: 'Failed to save onboarding details' });
    }
  },
);

// ─── GET /api/onboarding ──────────────────────────────────────────────────────
// Get current candidate's onboarding profile
router.get(
  '/',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated' });
      return;
    }

    try {
      if (process.env.DATABASE_PROVIDER === 'dynamodb') {
        const profile = (await repository().find('onboarding_profiles', p => p.candidateId === req.user!.userId))[0] || null;
        res.json({ success: true, data: profile }); return;
      }
      const [rows] = await db.query<RowDataPacket[]>('SELECT * FROM onboarding_profiles WHERE candidateId = ? LIMIT 1', [req.user.userId]);
      const profile = rows[0] || null;

      res.json({
        success: true,
        data: profile,
      });
    } catch (error) {
      console.error('[Onboarding] Get error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch onboarding profile' });
    }
  },
);

// ─── GET /api/onboarding/:candidateId (Admin) ────────────────────────────────
router.get(
  '/:candidateId',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const candidateId = req.params.candidateId as string;

    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated' });
      return;
    }

    // Allow admin, super_admin, or the candidate themselves
    if (req.user.role !== 'ADMIN' && req.user.role !== 'SUPER_ADMIN' && req.user.userId !== candidateId) {
      res.status(403).json({ success: false, message: 'Access denied' });
      return;
    }

    try {
      if (process.env.DATABASE_PROVIDER === 'dynamodb') {
        const profile = (await repository().find('onboarding_profiles', p => p.candidateId === candidateId))[0];
        if (!profile) { res.status(404).json({ success: false, message: 'Onboarding profile not found' }); return; }
        const candidate = await repository().get('users', { id: candidateId });
        res.json({ success: true, data: { ...profile, candidate: candidate ? { id: candidate.id, name: candidate.name, email: candidate.email, role: candidate.role } : null } }); return;
      }
      const query = `
        SELECT op.*, c.id as c_id, c.name as c_name, c.email as c_email, c.role as c_role
        FROM onboarding_profiles op
        LEFT JOIN users c ON op.candidateId = c.id
        WHERE op.candidateId = ? LIMIT 1
      `;
      const [rows] = await db.query<RowDataPacket[]>(query, [candidateId]);
      
      if (rows.length === 0) {
        res.status(404).json({ success: false, message: 'Onboarding profile not found' });
        return;
      }

      const row = rows[0];
      const profile = {
        ...row,
        candidate: row.c_id ? { id: row.c_id, name: row.c_name, email: row.c_email, role: row.c_role } : null
      };

      res.json({ success: true, data: profile });
    } catch (error) {
      console.error('[Onboarding] Get by ID error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch profile' });
    }
  },
);

export default router;

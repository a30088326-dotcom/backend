// @ts-nocheck
import { Router, Request, Response } from 'express';
import { randomBytes, createHash } from 'crypto';
import { db } from '../../lib/db';
import { RowDataPacket } from 'mysql2';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth, requireAdmin, generateToken } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { createInviteSchema } from '../../lib/validations';
import { sendEmail } from '../../lib/email';
import { requireModuleAction, organizationModuleScope } from '../../middleware/module-action';
import nativeRoutes from './invites.dynamo';

const router = Router();
router.use((req, res, next) => process.env.DATABASE_PROVIDER === 'dynamodb' ? nativeRoutes(req, res, next) : next());
const htmlText = (value:string) => value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

// ─── Helper: generate secure token ───────────────────────────────────────────
function generateSecureToken(): string {
  return randomBytes(32).toString('hex');
}

// ─── Helper: compute expiry date ─────────────────────────────────────────────
function getExpiryDate(): Date {
  const hours = parseInt(process.env.INVITE_TOKEN_EXPIRES_HOURS ?? '168', 10);
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

// ─── POST /api/invites ────────────────────────────────────────────────────────
// Admin creates and sends a new invite
router.post(
  '/',
  requireAuth,
  requireModuleAction('onboarding', 'canCreate'),
  validate(createInviteSchema),
  async (req: Request, res: Response): Promise<void> => {
    const { name, email, role, employmentType, designation, team, joinedDate } = req.body as {
      name: string; email: string; role: 'ADMIN' | 'CANDIDATE';
      employmentType: 'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'INTERN';
      designation: string; team: string; joinedDate: string;
    };

    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated' });
      return;
    }

    const inviteLockConnection=await db.getConnection();
    const inviteLock='invite:'+createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0,50);
    try {
      const [[lock]]=await inviteLockConnection.query('SELECT GET_LOCK(?,2) acquired',[inviteLock]);
      if(lock.acquired!==1) {res.status(409).json({success:false,message:'An invitation for this email is already being processed. Refresh invitations before retrying.'});return;}
      if (role === 'ADMIN' && !['ADMIN','SUPER_ADMIN'].includes(req.user.role)) {
        res.status(403).json({success:false,message:'Delegated onboarding can create candidate invitations, not administrator accounts.'}); return;
      }
      // Check if user already exists in the company
      const [userRows] = await db.query<RowDataPacket[]>('SELECT id FROM users WHERE email = ? LIMIT 1', [email.toLowerCase()]);
      const existingUser = userRows[0];

      if (existingUser) {
        res.status(409).json({
          success: false,
          message: `A user with the email ${email} already exists in the system`,
        });
        return;
      }

      // Check for existing pending invite
      const [inviteRows] = await db.query<RowDataPacket[]>('SELECT id FROM invites WHERE email = ? AND status = "PENDING" LIMIT 1', [email.toLowerCase()]);
      const existingInvite = inviteRows[0];

      if (existingInvite) {
        res.status(409).json({
          success: false,
          message: `A pending invite already exists for ${email}`,
        });
        return;
      }

      const token = generateSecureToken();
      const expiresAt = getExpiryDate();

      const inviteId = uuidv4();
      await db.query(
        'INSERT INTO invites (id, token, email, name, role, employmentType, designation, team, joinedDate, expiresAt, invitedById, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())',
        [inviteId, token, email.toLowerCase(), name, role, employmentType || null, designation || null, team || null, joinedDate ? new Date(joinedDate) : null, expiresAt, req.user.userId, 'PENDING']
      );

      const [inviterRows] = await db.query<RowDataPacket[]>('SELECT id, name, email FROM users WHERE id = ? LIMIT 1', [req.user.userId]);
      const invitedBy = inviterRows[0];

      const invite = {
        id: inviteId, email: email.toLowerCase(), name, role, employmentType, designation, team, joinedDate: joinedDate ? new Date(joinedDate) : null, expiresAt, invitedById: req.user.userId, status: 'PENDING', invitedBy
      };

      // Construct invite link
      const inviteLink = `${process.env.EXTERNAL_FRONTEND_URL || process.env.FRONTEND_URL || 'http://localhost:5174'}/invite/${token}`;

      // Send the email
      const delivery = await sendEmail({
        to: email,
        subject: `You're invited to join Peoples Management`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
            <h2 style="color: #2563eb;">Welcome to the Team! 🎉</h2>
            <p>Hi ${htmlText(name)},</p>
            <p>You have been invited to join <strong>Peoples Management</strong> and complete your onboarding details.</p>
            <p>Please click the button below to accept your invitation and begin your onboarding journey.</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${inviteLink}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Accept Invitation</a>
            </div>
            <p style="font-size: 12px; color: #666;">If the button doesn't work, copy and paste this link into your browser: <br/>${inviteLink}</p>
            <p style="font-size: 12px; color: #666;">This invitation will expire in 7 days.</p>
          </div>
        `,
      });

      res.status(201).json({
        success: true,
        message: delivery.sent ? `Invitation email accepted by the mail server for ${name}` : `Invitation saved, but email was not sent. ${delivery.reason}`,
        data: {
          invite,
          inviteLink,
          delivery,
        },
      });
    } catch (error) {
      console.error('[Invites] Create invite error:', error);
      res.status(500).json({ success: false, message: 'Failed to create invitation' });
    } finally {
      await inviteLockConnection.query('SELECT RELEASE_LOCK(?)',[inviteLock]);
      inviteLockConnection.release();
    }
  },
);

// ─── GET /api/invites ─────────────────────────────────────────────────────────
// Admin lists all invites, managers list invites they sent
router.get(
  '/',
  requireAuth,
  requireModuleAction('onboarding','canView'),
  async (req: Request, res: Response): Promise<void> => {
    const { status, page = '1', limit = '20' } = req.query as {
      status?: string; page?: string; limit?: string;
    };

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, parseInt(limit, 10));
    const skip = (pageNum - 1) * limitNum;

    try {
      let whereClause = 'WHERE 1=1';
      const queryParams: any[] = [];
      if (status) {
        whereClause += ' AND i.status = ?';
        queryParams.push(status);
      }
      
      if (req.user && !await organizationModuleScope(req.user,'onboarding')) {
        whereClause += ' AND i.invitedById = ?';
        queryParams.push(req.user.userId);
      }

      const countQuery = `SELECT COUNT(*) as count FROM invites i ${whereClause}`;
      const [[{ count }]] = await db.query<RowDataPacket[]>(countQuery, queryParams);
      const total = Number(count);

      const dataQuery = `
        SELECT 
          i.*,
          u1.id as ib_id, u1.name as ib_name, u1.email as ib_email,
          u2.id as iu_id, u2.name as iu_name, u2.email as iu_email
        FROM invites i
        LEFT JOIN users u1 ON i.invitedById = u1.id
        LEFT JOIN users u2 ON i.invitedUserId = u2.id
        ${whereClause}
        ORDER BY i.createdAt DESC
        LIMIT ? OFFSET ?
      `;

      const [rows] = await db.query<RowDataPacket[]>(dataQuery, [...queryParams, limitNum, skip]);

      const invites = rows.map(row => ({
        id: row.id, token: row.token, email: row.email, name: row.name, role: row.role, employmentType: row.employmentType, designation: row.designation, team: row.team, joinedDate: row.joinedDate, status: row.status, expiresAt: row.expiresAt, acceptedAt: row.acceptedAt, declinedAt: row.declinedAt, invitedById: row.invitedById, invitedUserId: row.invitedUserId, createdAt: row.createdAt, updatedAt: row.updatedAt,
        invitedBy: row.ib_id ? { id: row.ib_id, name: row.ib_name, email: row.ib_email } : null,
        invitedUser: row.iu_id ? { id: row.iu_id, name: row.iu_name, email: row.iu_email } : null
      }));

      res.json({
        success: true,
        data: invites,
        meta: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum),
        },
      });
    } catch (error) {
      console.error('[Invites] List error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch invites' });
    }
  },
);

// ─── POST /api/invites/:id/send-login ─────────────────────────────────────────
// Admin generates a password and creates the user account for an accepted invite
router.post(
  '/:id/send-login',
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id as string;

    try {
      const [inviteRows] = await db.query<RowDataPacket[]>('SELECT * FROM invites WHERE id = ? LIMIT 1', [id]);
      const invite = inviteRows[0];

      if (!invite) {
        res.status(404).json({ success: false, message: 'Invitation not found' });
        return;
      }

      if (invite.status !== 'ACCEPTED') {
        res.status(400).json({ success: false, message: 'Invitation must be accepted by the candidate first.' });
        return;
      }

      if (invite.invitedUserId) {
        res.status(400).json({ success: false, message: 'Login has already been sent to this user.' });
        return;
      }

      // Check if user email already exists
      const [userRows] = await db.query<RowDataPacket[]>('SELECT id FROM users WHERE email = ? LIMIT 1', [invite.email.toLowerCase()]);
      const existingUser = userRows[0];

      if (existingUser) {
        res.status(409).json({ success: false, message: `A user with email ${invite.email} already exists.` });
        return;
      }

      // Generate random password (e.g., 8 chars)
      const crypto = await import('crypto');
      const tempPassword = crypto.randomBytes(4).toString('hex'); // 8 characters

      const bcrypt = await import('bcryptjs');
      const hashedPassword = await bcrypt.default.hash(tempPassword, 10);

      const userId = uuidv4();
      const newUser = { id: userId, email: invite.email, name: invite.name, role: invite.role };

      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();
        await connection.query(
          'INSERT INTO users (id, email, name, password, role, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())',
          [userId, invite.email, invite.name, hashedPassword, invite.role, true]
        );
        await connection.query('UPDATE invites SET invitedUserId = ?, updatedAt = NOW() WHERE id = ?', [userId, invite.id]);
        await connection.commit();
      } catch (err) {
        await connection.rollback();
        throw err;
      } finally {
        connection.release();
      }

      // Send email with login credentials
      const loginUrl = `${process.env.EXTERNAL_FRONTEND_URL || process.env.FRONTEND_URL || 'http://localhost:5174'}`;
      await sendEmail({
        to: newUser.email,
        subject: `Your Peoples HR Login Credentials`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
            <h2 style="color: #2563eb;">Welcome to Peoples HR!</h2>
            <p>Hi ${newUser.name},</p>
            <p>Your profile has been approved by HR. You can now log in to the system and complete your onboarding process (e.g. uploading your documents).</p>
            <div style="background-color: #f8faff; border: 1px solid #e2e8f0; padding: 15px; border-radius: 6px; margin: 20px 0;">
              <p style="margin: 0 0 10px 0;"><strong>Username / Email:</strong> ${newUser.email}</p>
              <p style="margin: 0;"><strong>Temporary Password:</strong> <code style="background-color: #e2e8f0; padding: 2px 6px; border-radius: 4px;">${tempPassword}</code></p>
            </div>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${loginUrl}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Log In Now</a>
            </div>
            <p style="font-size: 12px; color: #666;">For security reasons, we recommend changing your password after your first login.</p>
          </div>
        `,
      });

      res.json({
        success: true,
        message: 'Login credentials generated and sent to the candidate.',
        data: {
          user: { id: newUser.id, email: newUser.email, name: newUser.name },
          tempPassword // Returning for demo purposes
        },
      });
    } catch (error) {
      console.error('[Invites] Send Login error:', error);
      res.status(500).json({ success: false, message: 'Failed to generate login' });
    }
  }
);

// ─── GET /api/invites/:token ──────────────────────────────────────────────────
// Candidate views their invite by token (public, no auth)
router.get('/:token', async (req: Request, res: Response): Promise<void> => {
  const token = req.params.token as string;

  try {
    const dataQuery = `
      SELECT i.*, u.name as ib_name, u.email as ib_email
      FROM invites i
      LEFT JOIN users u ON i.invitedById = u.id
      WHERE i.token = ? LIMIT 1
    `;
    const [inviteRows] = await db.query<RowDataPacket[]>(dataQuery, [token]);

    if (inviteRows.length === 0) {
      res.status(404).json({ success: false, message: 'Invitation not found' });
      return;
    }

    const row = inviteRows[0];
    const invite = {
      ...row,
      invitedBy: row.ib_name ? { name: row.ib_name, email: row.ib_email } : null,
    };

    // Check expiry
    if (invite.expiresAt < new Date() && invite.status === 'PENDING') {
      await db.query('UPDATE invites SET status = "EXPIRED", updatedAt = NOW() WHERE id = ?', [invite.id]);
      res.status(410).json({ success: false, message: 'This invitation has expired' });
      return;
    }

    if (invite.status !== 'PENDING') {
      res.json({
        success: true,
        data: invite,
        message: `Invitation already ${invite.status.toLowerCase()}`,
      });
      return;
    }

    res.json({ success: true, data: invite });
  } catch (error) {
    console.error('[Invites] Get by token error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch invitation' });
  }
});

// ─── POST /api/invites/:token/accept ─────────────────────────────────────────
// Candidate accepts the invite, chooses a password, and creates their account.
router.post('/:token/accept', async (req: Request, res: Response): Promise<void> => {
  const token = req.params.token as string;

  try {
    const [inviteRows] = await db.query<RowDataPacket[]>('SELECT * FROM invites WHERE token = ? LIMIT 1', [token]);
    const invite = inviteRows[0];

    if (!invite) {
      res.status(404).json({ success: false, message: 'Invitation not found' });
      return;
    }

    if (invite.status !== 'PENDING') {
      res.status(400).json({
        success: false,
        message: `Invitation is already ${invite.status.toLowerCase()}`,
      });
      return;
    }

    const { password } = req.body;

    if (invite.expiresAt < new Date()) {
      await db.query('UPDATE invites SET status = "EXPIRED", updatedAt = NOW() WHERE id = ?', [invite.id]);
      res.status(410).json({ success: false, message: 'This invitation has expired' });
      return;
    }

    if (!password || password.length < 3) {
      res.status(400).json({ success: false, message: 'Password must be at least 3 characters' });
      return;
    }

    const bcrypt = await import('bcryptjs');
    const hashedPassword = await bcrypt.default.hash(password, 10);

    const userId = uuidv4();
    const newUser = { id: userId, email: invite.email, name: invite.name, role: invite.role };

    let updatedInvite = { ...invite, status: 'ACCEPTED', acceptedAt: new Date(), invitedUserId: userId };

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query(
        'INSERT INTO users (id, email, name, password, role, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())',
        [userId, invite.email, invite.name, hashedPassword, invite.role, true]
      );
      await connection.query('UPDATE invites SET status = "ACCEPTED", acceptedAt = NOW(), invitedUserId = ?, updatedAt = NOW() WHERE id = ?', [userId, invite.id]);
      await connection.commit();
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }

    // Generate JWT Token
    const jwtToken = generateToken({
      userId: newUser.id,
      email: newUser.email,
      role: newUser.role,
    });

    res.json({
      success: true,
      message: 'Invitation accepted successfully!',
      data: {
        invite: updatedInvite,
        token: jwtToken,
        user: { id: newUser.id, email: newUser.email, name: newUser.name, role: newUser.role },
      },
    });
  } catch (error) {
    console.error('[Invites] Accept error:', error);
    res.status(500).json({ success: false, message: 'Failed to accept invitation' });
  }
});

// ─── POST /api/invites/:token/decline ────────────────────────────────────────
// Candidate declines invite
router.post('/:token/decline', async (req: Request, res: Response): Promise<void> => {
  const token = req.params.token as string;

  try {
    const [inviteRows] = await db.query<RowDataPacket[]>('SELECT * FROM invites WHERE token = ? LIMIT 1', [token]);
    const invite = inviteRows[0];

    if (!invite) {
      res.status(404).json({ success: false, message: 'Invitation not found' });
      return;
    }

    if (invite.status !== 'PENDING') {
      res.status(400).json({
        success: false,
        message: `Invitation is already ${invite.status.toLowerCase()}`,
      });
      return;
    }

    await db.query('UPDATE invites SET status = "DECLINED", declinedAt = NOW(), updatedAt = NOW() WHERE id = ?', [invite.id]);

    res.json({ success: true, message: 'Invitation declined' });
  } catch (error) {
    console.error('[Invites] Decline error:', error);
    res.status(500).json({ success: false, message: 'Failed to decline invitation' });
  }
});

router.post('/:id/resend', requireAuth, requireModuleAction('onboarding','canCreate'), async(req:Request,res:Response)=>{
  try {
    const [[invite]]=await db.query<RowDataPacket[]>('SELECT * FROM invites WHERE id=?',[req.params.id]);
    if(!invite) return res.status(404).json({success:false,message:'Invitation not found.'});
    if(invite.invitedById!==req.user!.userId && !await organizationModuleScope(req.user!,'onboarding')) return res.status(403).json({success:false,message:'Invitation is outside your onboarding scope.'});
    if(invite.status!=='PENDING' || new Date(invite.expiresAt).getTime()<=Date.now()) return res.status(409).json({success:false,message:'Only an unexpired pending invitation can be resent.'});
    const link=`${process.env.EXTERNAL_FRONTEND_URL||process.env.FRONTEND_URL||'http://localhost:5174'}/invite/${invite.token}`;
    const delivery=await sendEmail({to:invite.email,subject:'Your Peoples Management onboarding invitation',html:`<p>Hi ${htmlText(invite.name)},</p><p>Please complete your Peoples Management onboarding.</p><p><a href="${htmlText(link)}">Accept your invitation</a></p>`});
    return res.json({success:true,data:{id:invite.id,delivery},message:delivery.sent?'Invitation email accepted by the mail server.':'Invitation retained. Email was not sent.'});
  }catch{ return res.status(500).json({success:false,message:'Unable to resend the invitation. Check the existing invitation before retrying.'}); }
});

// ─── DELETE /api/invites/:id ──────────────────────────────────────────────────
// Admin cancels an invite
router.delete(
  '/:id',
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id as string;

    try {
      const [inviteRows] = await db.query<RowDataPacket[]>('SELECT id, invitedUserId FROM invites WHERE id = ? LIMIT 1', [id]);
      const invite = inviteRows[0];
      if (!invite) {
        res.status(404).json({ success: false, message: 'Invite not found' });
        return;
      }

      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();

        const uid = invite.invitedUserId;
        if (uid) {
          // Cascade delete user and all related records
          await connection.query('DELETE FROM onboarding_profiles WHERE candidateId = ?', [uid]);
          await connection.query('DELETE FROM documents WHERE candidateId = ?', [uid]);
          await connection.query('DELETE FROM contracts WHERE candidateId = ?', [uid]);
          await connection.query('DELETE FROM users WHERE id = ?', [uid]);
        }
        
        await connection.query('DELETE FROM invites WHERE id = ?', [id]);
        
        await connection.commit();
      } catch (err) {
        await connection.rollback();
        throw err;
      } finally {
        connection.release();
      }

      res.json({ success: true, message: 'Invitation deleted completely' });
    } catch (error) {
      console.error('[Invites] Delete error:', error);
      res.status(500).json({ success: false, message: 'Failed to delete invite' });
    }
  },
);

export default router;

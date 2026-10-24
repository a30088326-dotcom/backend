// @ts-nocheck
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../../lib/db';
import { generateToken } from '../../middleware/auth';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { Request } from 'express';
import { RowDataPacket } from 'mysql2';
import { identityFor } from '../../shared/services/organization.service';
import { repository } from '../../storage/repository';
const useDynamo = () => process.env.DATABASE_PROVIDER === 'dynamodb';
const userPermissions = async (userId: string) => useDynamo()
  ? repository().find('user_module_permissions', p => p.userId === userId)
  : (await db.query<RowDataPacket[]>('SELECT moduleId, moduleAccess, canView, canCreate, canEdit, canDelete, canApprove, canExport, dataScope FROM user_module_permissions WHERE userId = ?', [userId]))[0];

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  // Existing accounts may have shorter passwords created by legacy reset forms.
  // Authentication verifies their hash; password-creation rules are separate.
  password: z.string().min(1).max(72),
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = loginSchema.parse(req.body);

    const user = useDynamo()
      ? (await repository().find('users', u => String(u.email).localeCompare(email, undefined, { sensitivity: 'base' }) === 0))[0]
      : (await db.query<RowDataPacket[]>('SELECT * FROM users WHERE email = ? LIMIT 1', [email]))[0][0];

    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: 'Invalid credentials or inactive account' });
    }

    const isValid = await bcrypt.compare(password, user.password || '');

    if (!isValid) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    
    const identity = await identityFor(user.id);

    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    // Fetch module permissions
    const permRows = await userPermissions(user.id);
    const permissions = permRows.map((p: any) => ({
      moduleId: p.moduleId,
      moduleAccess: Boolean(p.moduleAccess),
      canView: Boolean(p.canView),
      canCreate: Boolean(p.canCreate),
      canEdit: Boolean(p.canEdit),
      canDelete: Boolean(p.canDelete),
      canApprove: Boolean(p.canApprove),
      canExport: Boolean(p.canExport),
      dataScope: p.dataScope || 'OWN',
    }));

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        ...identity,
        isActive: Boolean(user.isActive),
        mustChangePassword: Boolean(user.mustChangePassword),
        permissions
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: 'Invalid input', errors: err.issues });
    }
    console.error(err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req: Request, res) => {
  try {
    const user = useDynamo()
      ? await repository().get('users', { id: req.user?.userId })
      : (await db.query<RowDataPacket[]>('SELECT * FROM users WHERE id = ? LIMIT 1', [req.user?.userId]))[0][0];

    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: 'User not found or inactive' });
    }
    
    const identity = await identityFor(user.id);

    // Fetch module permissions
    const permRows = await userPermissions(user.id);
    const permissions = permRows.map((p: any) => ({
      moduleId: p.moduleId,
      moduleAccess: Boolean(p.moduleAccess),
      canView: Boolean(p.canView),
      canCreate: Boolean(p.canCreate),
      canEdit: Boolean(p.canEdit),
      canDelete: Boolean(p.canDelete),
      canApprove: Boolean(p.canApprove),
      canExport: Boolean(p.canExport),
      dataScope: p.dataScope || 'OWN',
    }));

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        ...identity,
        isActive: Boolean(user.isActive),
        mustChangePassword: Boolean(user.mustChangePassword),
        permissions
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = z.object({ currentPassword: z.string(), newPassword: z.string().min(3).max(72) }).parse(req.body);
    if (useDynamo()) {
      const user = await repository().get('users', { id: req.user.userId });
      if (!user || !await bcrypt.compare(currentPassword, user.password || '')) return res.status(400).json({ success: false, message: 'Current password is incorrect.' });
      const password = await bcrypt.hash(newPassword, 12);
      await repository().replace('users', { ...user, password, mustChangePassword: 0 });
      return res.json({ success: true });
    }
    const [rows] = await db.query('SELECT password FROM users WHERE id=?', [req.user.userId]);
    if (!rows[0] || !await bcrypt.compare(currentPassword, rows[0].password || '')) return res.status(400).json({ success:false, message:'Current password is incorrect.' });
    await db.query('UPDATE users SET password=?,mustChangePassword=0,updatedAt=NOW() WHERE id=?', [await bcrypt.hash(newPassword, 12),req.user.userId]);
    return res.json({ success:true });
  } catch (error) { return res.status(400).json({ success:false, message:'Use a password between 3 and 72 characters.' }); }
});

export default router;

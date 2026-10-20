import { Router, Request, Response } from 'express';
import { db } from '../../lib/db';
import { RowDataPacket } from 'mysql2';
import { requireAuth, requireAdmin } from '../../middleware/auth';
import { z } from 'zod';
import { sendEmail } from '../../lib/email';

import { organizationAccess } from '../../shared/services/organization.service';
const router = Router();
const htmlText = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
const editUserSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  email: z.string().trim().email().max(255).optional(),
  role: z.enum(['SUPER_ADMIN', 'ADMIN', 'EMPLOYEE', 'CANDIDATE']).optional(),
  newPassword: z.string().min(6).max(72).optional(),
}).strict();

// ─── GET /api/users ───────────────────────────────────────────────────────────
// Admin lists all users / team members. If EMPLOYEE, lists their subordinates.
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const { role, page = '1', limit = '50' } = req.query as {
    role?: string; page?: string; limit?: string;
  };

  const pageNum = Math.max(1, parseInt(page, 10)||1);
  const limitNum = Math.max(1, Math.min(500, parseInt(limit, 10)||50));

  try {
    const offset = (pageNum - 1) * limitNum;
    
    let whereClause = 'WHERE 1=1';
    const queryParams: any[] = [];
    
    if (role) {
      whereClause += ' AND u.role = ?';
      queryParams.push(role);
    }

    const access = await organizationAccess(req.user!.userId);
    if (!access.admin) {
      whereClause += ' AND e.id IN (?)'; queryParams.push(access.visibleIds.length?access.visibleIds:['']);
    }
    
    const countQuery = `
      SELECT COUNT(*) as count FROM users u 
      LEFT JOIN employee_information_employees e ON u.id = e.userId
      ${whereClause}
    `;
    const [[{ count }]] = await db.query<RowDataPacket[]>(countQuery, queryParams);
    
    const dataQuery = `
      SELECT 
        u.id, u.name, u.email, u.role, u.isActive, u.createdAt,
        op.firstName as op_firstName, op.lastName as op_lastName, op.city as op_city, op.dateOfBirth as op_dateOfBirth, op.gender as op_gender, op.nationality as op_nationality, op.addressLine1 as op_addressLine1, op.addressLine2 as op_addressLine2, op.postalCode as op_postalCode, op.phoneNumber as op_phoneNumber, op.alternatePhone as op_alternatePhone, op.linkedIn as op_linkedIn, op.emergencyContactName as op_emergencyContactName, op.emergencyContactRelation as op_emergencyContactRelation, op.emergencyContactPhone as op_emergencyContactPhone, op.bankName as op_bankName, op.accountHolderName as op_accountHolderName, op.accountNumber as op_accountNumber, op.accountType as op_accountType, op.currency as op_currency,
        i.designation as inv_designation, i.team as inv_team, i.employmentType as inv_employmentType, i.joinedDate as inv_joinedDate,
        c.status as contract_status,
        e.designation as emp_designation, e.department as emp_department, e.employmentType as emp_employmentType, e.organizationalRank as emp_rank, e.dateJoined as emp_dateJoined,
        e.id as emp_id, e.employeeStatus as emp_employeeStatus, e.employeeNo as emp_employeeNo,
        (SELECT JSON_ARRAYAGG(JSON_OBJECT('status', d.status)) FROM documents d WHERE d.candidateId = u.id) as documents
      FROM users u
      LEFT JOIN onboarding_profiles op ON u.id = op.candidateId
      LEFT JOIN invites i ON i.id = (SELECT ix.id FROM invites ix WHERE ix.email=u.email ORDER BY ix.createdAt DESC, ix.id LIMIT 1)
      LEFT JOIN contracts c ON c.id = (SELECT cx.id FROM contracts cx WHERE cx.candidateId=u.id ORDER BY cx.createdAt DESC, cx.id LIMIT 1)
      LEFT JOIN employee_information_employees e ON u.id = e.userId
      ${whereClause}
      ORDER BY u.createdAt DESC
      LIMIT ? OFFSET ?
    `;
    
    const [rows] = await db.query<RowDataPacket[]>(dataQuery, [...queryParams, limitNum, offset]);
    
    const users = rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      isActive: Boolean(row.isActive),
      createdAt: row.createdAt,
      onboardingProfile: access.admin && row.op_firstName ? { 
        firstName: row.op_firstName, lastName: row.op_lastName, city: row.op_city,
        dateOfBirth: row.op_dateOfBirth, gender: row.op_gender, nationality: row.op_nationality,
        addressLine1: row.op_addressLine1, addressLine2: row.op_addressLine2, postalCode: row.op_postalCode,
        phoneNumber: row.op_phoneNumber, alternatePhone: row.op_alternatePhone, linkedIn: row.op_linkedIn,
        emergencyContactName: row.op_emergencyContactName, emergencyContactRelation: row.op_emergencyContactRelation, emergencyContactPhone: row.op_emergencyContactPhone,
        bankName: row.op_bankName, accountHolderName: row.op_accountHolderName, accountNumber: row.op_accountNumber, accountType: row.op_accountType, currency: row.op_currency
      } : null,
      receivedInvite: row.inv_designation ? { designation: row.inv_designation, team: row.inv_team, employmentType: row.inv_employmentType, joinedDate: row.inv_joinedDate } : null,
      documents: row.documents || [],
      contract: row.contract_status ? { status: row.contract_status } : null,
      employee: row.emp_id ? { designation:row.emp_designation, department:row.emp_department, employmentType:row.emp_employmentType, organizationalRank:row.emp_rank, dateJoined:row.emp_dateJoined, id: row.emp_id, employeeStatus: row.emp_employeeStatus, employeeNo: row.emp_employeeNo } : null,
    }));

    const total = Number(count);

    res.json({
      success: true,
      data: users,
      meta: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error) {
    console.error('[Users] List error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch users' });
  }
});

// ─── GET /api/users/me ────────────────────────────────────────────────────────
router.get('/me', requireAuth, async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ success: false, message: 'Not authenticated' });
    return;
  }

  try {
    const dataQuery = `
      SELECT 
        u.id, u.name, u.email, u.role, u.isActive, u.createdAt,
        op.firstName as op_firstName, op.lastName as op_lastName, op.city as op_city, op.dateOfBirth as op_dateOfBirth, op.gender as op_gender, op.nationality as op_nationality, op.addressLine1 as op_addressLine1, op.addressLine2 as op_addressLine2, op.postalCode as op_postalCode, op.phoneNumber as op_phoneNumber, op.alternatePhone as op_alternatePhone, op.linkedIn as op_linkedIn, op.emergencyContactName as op_emergencyContactName, op.emergencyContactRelation as op_emergencyContactRelation, op.emergencyContactPhone as op_emergencyContactPhone, op.bankName as op_bankName, op.accountHolderName as op_accountHolderName, op.accountNumber as op_accountNumber, op.accountType as op_accountType, op.currency as op_currency, op.createdAt as op_createdAt, op.updatedAt as op_updatedAt,
        i.designation as inv_designation, i.team as inv_team, i.employmentType as inv_employmentType, i.status as inv_status
      FROM users u
      LEFT JOIN onboarding_profiles op ON u.id = op.candidateId
      LEFT JOIN invites i ON i.id = (SELECT ix.id FROM invites ix WHERE ix.email=u.email ORDER BY ix.createdAt DESC, ix.id LIMIT 1)
      WHERE u.id = ? LIMIT 1
    `;
    
    const [rows] = await db.query<RowDataPacket[]>(dataQuery, [req.user.userId]);
    
    if (rows.length === 0) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    const row = rows[0];
    
    const user = {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      isActive: Boolean(row.isActive),
      createdAt: row.createdAt,
      onboardingProfile: row.op_firstName ? { 
        firstName: row.op_firstName, lastName: row.op_lastName, city: row.op_city, dateOfBirth: row.op_dateOfBirth, gender: row.op_gender, nationality: row.op_nationality, addressLine1: row.op_addressLine1, addressLine2: row.op_addressLine2, postalCode: row.op_postalCode, phoneNumber: row.op_phoneNumber, alternatePhone: row.op_alternatePhone, linkedIn: row.op_linkedIn, emergencyContactName: row.op_emergencyContactName, emergencyContactRelation: row.op_emergencyContactRelation, emergencyContactPhone: row.op_emergencyContactPhone, bankName: row.op_bankName, accountHolderName: row.op_accountHolderName, accountNumber: row.op_accountNumber, accountType: row.op_accountType, currency: row.op_currency, createdAt: row.op_createdAt, updatedAt: row.op_updatedAt
      } : null,
      receivedInvite: row.inv_designation ? { designation: row.inv_designation, team: row.inv_team, employmentType: row.inv_employmentType, status: row.inv_status } : null,
    };

    res.json({ success: true, data: user });
  } catch (error) {
    console.error('[Users] Me error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch user' });
  }
});

// ─── GET /api/users/:id ───────────────────────────────────────────────────────
router.get('/:id', requireAuth, requireAdmin, async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;

  try {
    const dataQuery = `
      SELECT 
        u.id, u.name, u.email, u.role, u.isActive, u.createdAt,
        op.firstName as op_firstName, op.lastName as op_lastName, op.city as op_city, op.dateOfBirth as op_dateOfBirth, op.gender as op_gender, op.nationality as op_nationality, op.addressLine1 as op_addressLine1, op.addressLine2 as op_addressLine2, op.postalCode as op_postalCode, op.phoneNumber as op_phoneNumber, op.alternatePhone as op_alternatePhone, op.linkedIn as op_linkedIn, op.emergencyContactName as op_emergencyContactName, op.emergencyContactRelation as op_emergencyContactRelation, op.emergencyContactPhone as op_emergencyContactPhone, op.bankName as op_bankName, op.accountHolderName as op_accountHolderName, op.accountNumber as op_accountNumber, op.accountType as op_accountType, op.currency as op_currency, op.createdAt as op_createdAt, op.updatedAt as op_updatedAt,
        i.designation as inv_designation, i.team as inv_team, i.employmentType as inv_employmentType, i.joinedDate as inv_joinedDate, i.status as inv_status,
        c.id as contract_id, c.title as contract_title, c.status as contract_status, c.signedAt as contract_signedAt
      FROM users u
      LEFT JOIN onboarding_profiles op ON u.id = op.candidateId
      LEFT JOIN invites i ON i.id = (SELECT ix.id FROM invites ix WHERE ix.email=u.email ORDER BY ix.createdAt DESC, ix.id LIMIT 1)
      LEFT JOIN contracts c ON c.id = (SELECT cx.id FROM contracts cx WHERE cx.candidateId=u.id ORDER BY cx.createdAt DESC, cx.id LIMIT 1)
      WHERE u.id = ? LIMIT 1
    `;
    
    const [rows] = await db.query<RowDataPacket[]>(dataQuery, [id]);
    
    if (rows.length === 0) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    const row = rows[0];
    
    // Fetch documents separately
    const [docRows] = await db.query<RowDataPacket[]>('SELECT id, type, status, label, createdAt FROM documents WHERE candidateId = ?', [id]);
    
    const user = {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      isActive: Boolean(row.isActive),
      createdAt: row.createdAt,
      onboardingProfile: row.op_firstName ? { 
        firstName: row.op_firstName, lastName: row.op_lastName, city: row.op_city, dateOfBirth: row.op_dateOfBirth, gender: row.op_gender, nationality: row.op_nationality, addressLine1: row.op_addressLine1, addressLine2: row.op_addressLine2, postalCode: row.op_postalCode, phoneNumber: row.op_phoneNumber, alternatePhone: row.op_alternatePhone, linkedIn: row.op_linkedIn, emergencyContactName: row.op_emergencyContactName, emergencyContactRelation: row.op_emergencyContactRelation, emergencyContactPhone: row.op_emergencyContactPhone, bankName: row.op_bankName, accountHolderName: row.op_accountHolderName, accountNumber: row.op_accountNumber, accountType: row.op_accountType, currency: row.op_currency, createdAt: row.op_createdAt, updatedAt: row.op_updatedAt
      } : null,
      documents: docRows,
      receivedInvite: row.inv_designation ? { designation: row.inv_designation, team: row.inv_team, employmentType: row.inv_employmentType, joinedDate: row.inv_joinedDate, status: row.inv_status } : null,
      contract: row.contract_id ? { id: row.contract_id, title: row.contract_title, status: row.contract_status, signedAt: row.contract_signedAt } : null,
    };

    res.json({ success: true, data: user });
  } catch (error) {
    console.error('[Users] Get error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch user' });
  }
});

// ─── PATCH /api/users/:id/deactivate ─────────────────────────────────────────
router.patch(
  '/:id/deactivate',
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id as string;

    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated' });
      return;
    }

    if (req.user.userId === id) {
      res.status(400).json({ success: false, message: 'Cannot deactivate your own account' });
      return;
    }

    try {
      await db.query('UPDATE users SET isActive = false WHERE id = ?', [id]);
      res.json({ success: true, message: 'User deactivated' });
    } catch {
      res.status(500).json({ success: false, message: 'Failed to deactivate user' });
    }
  },
);

// ─── PATCH /api/users/:id/activate ───────────────────────────────────────────
router.patch(
  '/:id/activate',
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id as string;

    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated' });
      return;
    }

    try {
      await db.query('UPDATE users SET isActive = true WHERE id = ?', [id]);
      res.json({ success: true, message: 'User activated' });
    } catch {
      res.status(500).json({ success: false, message: 'Failed to activate user' });
    }
  },
);

// ─── DELETE /api/users/:id ────────────────────────────────────────────────────
// Delete only accounts without retained HR dependencies, in one transaction.
router.delete(
  '/:id',
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id as string;

    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated' });
      return;
    }

    if (req.user.userId === id) {
      res.status(400).json({ success: false, message: 'Cannot delete your own account' });
      return;
    }

    let deletionConnection;
    try {
      deletionConnection = await db.getConnection();
      await deletionConnection.beginTransaction();
      const [targetRows] = await deletionConnection.query<RowDataPacket[]>('SELECT email, role FROM users WHERE id = ? LIMIT 1 FOR UPDATE', [id]);
      if (!targetRows.length) {
        res.status(404).json({ success: false, message: 'User not found' });
        return;
      }
      if (targetRows[0].role === 'SUPER_ADMIN') {
        res.status(403).json({ success: false, message: 'The Owner account cannot be deactivated.' });
        return;
      }
      const email = targetRows[0].email;
      const [[history]] = await deletionConnection.query<RowDataPacket[]>(`SELECT
        (SELECT COUNT(*) FROM leave_applications WHERE applicantId=? OR approverId=?) +
        (SELECT COUNT(*) FROM attendance_records a JOIN employee_information_employees e ON e.id=a.employeeId WHERE e.userId=?) +
        (SELECT COUNT(*) FROM employee_information_employees m JOIN employee_information_employees e ON e.id=m.reportingManagerId WHERE e.userId=?) +
        (SELECT COUNT(*) FROM employee_requests r JOIN employee_information_employees e ON e.id=r.employeeId WHERE e.userId=?) +
        (SELECT COUNT(*) FROM employee_information_personal_details p JOIN employee_information_employees e ON e.id=p.employeeId WHERE e.userId=?) +
        (SELECT COUNT(*) FROM employee_information_contact_details p JOIN employee_information_employees e ON e.id=p.employeeId WHERE e.userId=?) AS count`,[id,id,id,id,id,id,id]);
      if (Number(history.count)>0) {
        res.status(409).json({success:false,message:'This employee has HR history or reporting employees. Deactivate the account to preserve those records.'});return;
      }
      await deletionConnection.query('DELETE FROM employee_information_employees WHERE userId = ?', [id]);
      await deletionConnection.query('DELETE FROM documents WHERE candidateId = ?', [id]);
      await deletionConnection.query('DELETE FROM contracts WHERE candidateId = ?', [id]);
      await deletionConnection.query('DELETE FROM onboarding_profiles WHERE candidateId = ?', [id]);
      await deletionConnection.query('DELETE FROM invites WHERE email = ?', [email]);
      await deletionConnection.query('DELETE FROM users WHERE id = ?', [id]);
      await deletionConnection.commit();
      res.json({ success: true, message: 'User completely deleted from the system.' });
    } catch (error) {
      console.error('[Users] Delete error:', error);
      res.status((error as any)?.code === 'ER_ROW_IS_REFERENCED_2' ? 409 : 500).json({ success: false, message: 'This account has dependent records. Deactivate it to retain HR history.' });
    } finally {
      if (deletionConnection) { await deletionConnection.rollback(); deletionConnection.release(); }
    }
  },
);

// ─── PATCH /api/users/:id/reset-password ──────────────────────────────────────
router.patch(
  '/:id/reset-password',
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id as string;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 3) {
      res.status(400).json({ success: false, message: 'Password must be at least 3 characters' });
      return;
    }

    try {
      const bcrypt = await import('bcryptjs');
      const hashedPassword = await bcrypt.default.hash(newPassword, 10);
      await db.query('UPDATE users SET password = ?, mustChangePassword = 1, updatedAt = NOW() WHERE id = ?', [hashedPassword, id]);
      res.json({ success: true, message: 'Password has been reset successfully' });
    } catch (error) {
      console.error('[Users] Password reset error:', error);
      res.status(500).json({ success: false, message: 'Failed to reset password' });
    }
  },
);

// ─── PATCH /api/users/:id/update ──────────────────────────────────────────────
router.patch(
  '/:id/update',
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id as string;
    try {
      const parsed = editUserSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, message: 'Enter a valid name, email, and password of 6–72 characters.' });
        return;
      }
      const { name, email, newPassword, role } = parsed.data;
      const [rows] = await db.query<RowDataPacket[]>('SELECT id, name, email, role FROM users WHERE id = ? LIMIT 1', [id]);
      const target = rows[0];
      if (!target) {
        res.status(404).json({ success: false, message: 'Employee login account not found.' });
        return;
      }
      if (['SUPER_ADMIN', 'ADMIN'].includes(target.role) && req.user?.role !== 'SUPER_ADMIN') {
        res.status(403).json({ success: false, message: 'Only the Owner can change administrator login details.' });
        return;
      }
      if (newPassword && (!process.env.SMTP_USER || !process.env.SMTP_PASS)) {
        res.status(503).json({ success: false, message: 'Email delivery is not configured. No password change was saved. Configure SMTP and try again.' });
        return;
      }
      const updates: string[] = [];
      const values: unknown[] = [];
      if (name && name !== target.name) { updates.push('name = ?'); values.push(name); }
      if (email && email !== target.email) { updates.push('email = ?'); values.push(email); }
      if (role && role !== target.role) {
        if (req.user?.role !== 'SUPER_ADMIN' || !['ADMIN', 'EMPLOYEE', 'CANDIDATE'].includes(role) || target.role === 'SUPER_ADMIN' || id === req.user.userId) {
          res.status(403).json({ success: false, message: 'Only the Owner can assign non-owner roles.' });
          return;
        }
        updates.push('role = ?'); values.push(role);
      }
      if (newPassword) {
        const bcrypt = await import('bcryptjs');
        const hashedPassword = await bcrypt.default.hash(newPassword, 12);
        updates.push('password = ?');
        values.push(hashedPassword);
        updates.push('mustChangePassword = 1');
      }

      if (updates.length > 0) {
        updates.push('updatedAt = NOW()');
        values.push(id);
        await db.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);
      }
      if (!newPassword) {
        res.json({ success: true, message: 'Employee updated. Password unchanged; no credentials email was sent.' });
        return;
      }

      const [savedRows] = await db.query<RowDataPacket[]>('SELECT name, email FROM users WHERE id = ? LIMIT 1', [id]);
      const loginEmail = savedRows[0]?.email || email || target.email;
      const employeeName = savedRows[0]?.name || name || target.name || 'Employee';
      const loginUrl = process.env.EXTERNAL_FRONTEND_URL || process.env.FRONTEND_URL || 'http://localhost:5174';
      const delivery = await sendEmail({
        to: loginEmail,
        subject: 'Your Peoples Management login details',
        html: `<div style="font-family:Arial,sans-serif;max-width:600px;color:#1e293b">
          <h2>Your Peoples Management login details</h2>
          <p>Hello ${htmlText(employeeName)},</p>
          <p>Your account password was set by HR. Use these temporary login details:</p>
          <p><strong>Username / email:</strong> ${htmlText(loginEmail)}</p>
          <p><strong>Temporary password:</strong> ${htmlText(newPassword)}</p>
          <p><a href="${htmlText(loginUrl)}">Open Peoples Management</a></p>
          <p>You will be asked to change this password when you first sign in. Do not share it with anyone.</p>
        </div>`,
      });
      res.json({
        success: true,
        message: delivery.sent ? 'Employee saved and login details emailed.' : 'Employee saved, but the credentials email was not sent.',
        recipient: loginEmail,
        delivery,
      });
    } catch (error) {
      console.error('[Users] Update error:', error);
      res.status(500).json({ success: false, message: 'Failed to update user' });
    }
  },
);

export default router;

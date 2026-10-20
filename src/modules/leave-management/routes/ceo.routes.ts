// @ts-nocheck
import { Router, type Response, type Request } from 'express';
import { db } from '../../../lib/db';
import { RowDataPacket } from 'mysql2';
import { requireAuth } from '../../../middleware/auth';
import { organizationAccess } from '../../../shared/services/organization.service';

type AuthRequest = Request & { user?: { userId: string; role: string; email: string } };

const router = Router();
router.use(requireAuth);

// ─── GET /api/leaves/ceo/applications ──────────────────────────────
router.get('/ceo/applications', async (req: AuthRequest, res: Response) => {
  try {
    const access = await organizationAccess(req.user!.userId);
    const hasExecutiveAccess = access.admin || access.isExecutive;

    if (!hasExecutiveAccess) {
      return res.status(403).json({ success: false, message: 'Executive access is required to view organization-wide requests.' });
    }

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit as string) || 50));
    const offset = (page - 1) * limit;

    let whereClause = '1 = 1';
    const params: any[] = [];

    // Allow CEO to filter specifically for requests where they are the current approver
    if (req.query.pendingForMe === 'true') {
      whereClause += ' AND la.approverId = ? AND (la.status = "PENDING_MANAGER_APPROVAL" OR la.status = "PENDING")';
      params.push(req.user!.userId);
    }

    const [totalRows] = await db.query(`SELECT COUNT(*) as total FROM leave_applications la WHERE ${whereClause}`, params);
    const total = totalRows[0].total;

    const [applications] = await db.query(`
      SELECT la.*,
             lt.id as lt_id, lt.name as lt_name, lt.color as lt_color, lt.code as lt_code,
             ly.id as ly_id, ly.year as ly_year, ly.displayName as ly_displayName,
             appr.id as appr_id, appr.name as appr_name, appr.email as appr_email,
             cov.id as cov_id, cov.name as cov_name, cov.email as cov_email,
             applicant.name as applicant_name
      FROM leave_applications la
      JOIN leave_types lt ON la.leaveTypeId = lt.id
      JOIN leave_years ly ON la.leaveYearId = ly.id
      LEFT JOIN users appr ON la.approverId = appr.id
      LEFT JOIN users cov ON la.coveringEmployeeId = cov.id
      LEFT JOIN users applicant ON la.applicantId = applicant.id
      WHERE ${whereClause}
      ORDER BY la.createdAt DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    const formatted = applications.map(app => ({
      id: app.id,
      applicantId: app.applicantId,
      applicantName: app.applicant_name,
      leaveTypeId: app.leaveTypeId,
      leaveYearId: app.leaveYearId,
      startDate: app.startDate,
      endDate: app.endDate,
      totalDays: app.totalDays,
      status: app.status,
      reason: app.reason,
      rejectedReason: app.rejectedReason,
      createdAt: app.createdAt,
      leaveType: { id: app.lt_id, name: app.lt_name, color: app.lt_color, code: app.lt_code },
      leaveYear: { id: app.ly_id, year: app.ly_year, displayName: app.ly_displayName },
      approver: app.appr_id ? { id: app.appr_id, name: app.appr_name, email: app.appr_email } : null,
      coveringEmployee: app.cov_id ? { id: app.cov_id, name: app.cov_name, email: app.cov_email } : null
    }));

    res.json({
      success: true,
      data: formatted,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error('Error fetching CEO applications:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch leave applications' });
  }
});

// ─── GET /api/leaves/applications/:id/history ─────────────────────────────────
router.get('/applications/:id/history', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id;
    // Fetch the application with approver details to build a history
    const [rows] = await db.query(`
      SELECT la.id, la.applicantId, la.status, la.createdAt, la.approvedAt, la.actionedAt, la.rejectedReason,
             la.comments, la.cancelledAt, la.cancelReason,
             appr.id as appr_id, appr.name as appr_name, appr.email as appr_email,
             ae.id as applicant_employee_id
      FROM leave_applications la
      LEFT JOIN users appr ON la.approverId = appr.id
      LEFT JOIN employee_information_employees ae ON ae.userId = la.applicantId
      WHERE la.id = ?
      LIMIT 1
    `, [id]);

    if (!rows || rows.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const app = rows[0];
    const access = await organizationAccess(req.user!.userId);
    if (!access.admin && !access.visibleIds.includes(String(app.applicant_employee_id))) {
      return res.status(403).json({ success: false, message: 'You do not have access to this request history.' });
    }
    const history: any[] = [];

    // Always add submission event
    history.push({
      id: `submitted-${id}`,
      action: 'SUBMITTED',
      created_at: app.createdAt,
      approver_name: null,
      level: null,
      comment: app.comments || null
    });

    // Prefer the immutable approval audit trail (supports multi-level approvals).
    const [approvalRows] = await db.query<RowDataPacket[]>(
      `SELECT h.id, h.action, h.level, h.comment, h.created_at,
              u.name AS approver_name
       FROM leave_approval_history h
       LEFT JOIN users u ON u.id = h.approver_user_id
       WHERE h.leave_application_id = ? ORDER BY h.created_at ASC`, [id]);
    for (const event of approvalRows) history.push({ ...event });
    if (!approvalRows.length && (app.status === 'APPROVED' || app.status === 'REJECTED')) {
      history.push({ id: `actioned-${id}`, action: app.status, created_at: app.approvedAt || app.actionedAt || null,
        approver_name: app.appr_name || null, level: 1, comment: app.status === 'REJECTED' ? (app.rejectedReason || null) : null });
    }

    // Add cancellation event
    if (app.status === 'CANCELLED') {
      history.push({
        id: `cancelled-${id}`,
        action: 'CANCELLED',
        created_at: app.cancelledAt,
        approver_name: null,
        level: null,
        comment: app.cancelReason || null
      });
    }

    res.json({ success: true, data: history });
  } catch (err) {
    console.error('Error fetching leave history:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch leave history' });
  }
});

export default router;

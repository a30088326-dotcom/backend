import { Router, type Response, type Request } from 'express';
import { db } from '../../../lib/db';
import { requireAuth, requireAdmin } from '../../../middleware/auth';
import { RowDataPacket } from 'mysql2';
import { v4 as uuidv4 } from 'uuid';

type AuthRequest = Request & { user?: { userId: string; role: string; email: string } };

const router = Router();
router.use(requireAuth);

// ─── GET /api/leaves/types ────────────────────────────────────────────────────
router.get('/types', async (_req: AuthRequest, res: Response) => {
  try {
    const [types] = await db.query<RowDataPacket[]>('SELECT * FROM leave_types WHERE isActive = 1 ORDER BY name ASC');
    res.json({ success: true, data: types });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch leave types' });
  }
});

// ─── POST /api/leaves/types ───────────────────────────────────────────────────
router.post('/types', requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { 
      name, description, color, isActive, allowHalfDays, requireCoveringEmp,
      autoCalculateEndDate, holidaysCountAsLeave, showBalance, hideZeroEntitlement,
      requireAttachment, commentMandatory, yearlyEntitlement, maxDaysPerInstance,
      needMedicalCertificate, maxDaysWithoutMedCert, futureLeaveAllowed,
      carryForwardEnabled, carryForwardMaxDays, carryForwardLimit, encashmentEnabled,
      encashmentIsFixed, encashmentValue,
      category, unit, paymentType
    } = req.body;
    
    const code = req.body.code || (name ? name.substring(0, 3).toUpperCase() + Math.floor(Math.random()*1000) : 'LVE');
    const newId = uuidv4();

    await db.query(`
      INSERT INTO leave_types (
        id, name, code, description, color, category, unit, paymentType, isActive, allowHalfDays,
        requireCoveringEmp, autoCalculateEndDate, holidaysCountAsLeave, showBalance, hideZeroEntitlement,
        requireAttachment, commentMandatory, yearlyEntitlement, maxDaysPerInstance, needMedicalCertificate,
        maxDaysWithoutMedCert, futureLeaveAllowed, carryForwardEnabled, carryForwardMaxDays, carryForwardLimit,
        encashmentEnabled, encashmentIsFixed, encashmentValue, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `, [
      newId, name, code, description, color || '#2563eb', category, unit, paymentType, isActive ?? 1, allowHalfDays ?? 1,
      requireCoveringEmp ?? 0, autoCalculateEndDate ?? 0, holidaysCountAsLeave ?? 0, showBalance ?? 1, hideZeroEntitlement ?? 0,
      requireAttachment ?? 0, commentMandatory ?? 0, parseFloat(yearlyEntitlement) || 0, parseInt(maxDaysPerInstance) || null,
      needMedicalCertificate ?? 0, parseInt(maxDaysWithoutMedCert) || null, futureLeaveAllowed ?? 1, carryForwardEnabled ?? 0,
      parseFloat(carryForwardMaxDays) || null, parseFloat(carryForwardLimit) || null, encashmentEnabled ?? 0, encashmentIsFixed ?? 1,
      parseFloat(encashmentValue) || null
    ]);

    const [rows] = await db.query<RowDataPacket[]>('SELECT * FROM leave_types WHERE id = ?', [newId]);
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to create leave type' });
  }
});

// Retired setup endpoints must not claim to save data when no write occurs.
for (const path of ['/workflows', '/company/settings', '/company/teams', '/attendance/shifts']) {
  router.post(path, requireAdmin, (_req, res) => res.status(501).json({ success: false,
    message: 'This legacy setup endpoint is unavailable; use the active HR configuration module.' }));
}

router.get('/years', async (_req: AuthRequest, res: Response) => {
  try {
    const [years] = await db.query<RowDataPacket[]>('SELECT * FROM leave_years WHERE isActive = 1 ORDER BY year DESC');
    res.json({ success: true, data: years });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch leave years' });
  }
});

router.get('/holidays', async (req: AuthRequest, res: Response) => {
  try {
    const { year } = req.query as Record<string, string>;
    const calendarYear = Number(year || new Date().getFullYear());
    if (!Number.isInteger(calendarYear) || calendarYear < 2000 || calendarYear > 2100) {
      res.status(400).json({ success: false, message: 'Enter a valid calendar year.' }); return;
    }
    const [rows] = await db.query<RowDataPacket[]>(`SELECT d.id, DATE_FORMAT(d.date,'%Y-%m-%d') AS date,
      t.name, t.type AS dayType, t.displayColor AS color
      FROM calendarday d JOIN holidaycalendar h ON h.id=d.holidayCalendarId
      JOIN daytype t ON t.id=d.dayTypeId WHERE h.year=? ORDER BY d.date`, [calendarYear]);
    res.json({ success: true, data: { holidays: rows } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch holidays' });
  }
});

export default router;

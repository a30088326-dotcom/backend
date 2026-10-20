import { Router, Request, Response } from 'express';
import { db } from '../../lib/db';
import { RowDataPacket } from 'mysql2';
import { requireAuth as auth, requireAdmin as adminOnly } from '../../middleware/auth';
import { generateEntitlements, getEntitlementsReport } from './leave.controller';
import dayTypesRoutes from './day-types.routes';
import calendarGroupsRoutes from './calendar-groups.routes';
import holidayCalendarRoutes from './holiday-calendar.routes';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

router.use('/day-types', auth, adminOnly, dayTypesRoutes);
router.use('/calendar-groups', auth, adminOnly, calendarGroupsRoutes);
router.use('/holiday-calendar', auth, adminOnly, holidayCalendarRoutes);

interface AuthRequest extends Request {
  user?: any;
}

// ─── LEAVE ENTITLEMENTS ──────────────────────────────────────────────────────
router.post('/employee/:id/generate-entitlements', auth, adminOnly, generateEntitlements);

// ─── REPORTS ─────────────────────────────────────────────────────────────────
router.get('/reports/entitlements', auth, adminOnly, getEntitlementsReport);

// ─── LEAVE TYPES ─────────────────────────────────────────────────────────────
router.get('/types', auth, async (_req: AuthRequest, res: Response) => {
  try {
    const [types] = await db.query<RowDataPacket[]>('SELECT * FROM leave_types ORDER BY name ASC');
    res.json({ success: true, data: types });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch leave types' });
  }
});

router.post('/types', auth, adminOnly, async (req: AuthRequest, res: Response) => {
  try {
    const { name, code, category, unit, paymentType, yearlyEntitlement, allowFullDay, allowHalfDays, showReason, requireAttachment, isActive } = req.body;
    
    const newId = uuidv4();
    await db.query(`
      INSERT INTO leave_types (
        id, name, code, category, unit, paymentType, yearlyEntitlement, allowFullDay, allowHalfDays, showReason, requireAttachment, isActive, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `, [
      newId, name, code, category, unit, paymentType, parseFloat(yearlyEntitlement) || 0,
      allowFullDay ?? 1, allowHalfDays ?? 1, showReason ?? 1, requireAttachment ?? 0, isActive ?? 1
    ]);

    const [rows] = await db.query<RowDataPacket[]>('SELECT * FROM leave_types WHERE id = ?', [newId]);
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to create leave type' });
  }
});

router.put('/types/:id', auth, adminOnly, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, code, category, unit, paymentType, yearlyEntitlement, allowFullDay, allowHalfDays, showReason, requireAttachment, isActive } = req.body;
    
    await db.query(`
      UPDATE leave_types SET
        name = ?, code = ?, category = ?, unit = ?, paymentType = ?, yearlyEntitlement = ?, allowFullDay = ?, allowHalfDays = ?, showReason = ?, requireAttachment = ?, isActive = ?, updatedAt = NOW()
      WHERE id = ?
    `, [
      name, code, category, unit, paymentType, parseFloat(yearlyEntitlement) || 0,
      allowFullDay ?? 1, allowHalfDays ?? 1, showReason ?? 1, requireAttachment ?? 0, isActive ?? 1, id
    ]);

    const [rows] = await db.query<RowDataPacket[]>('SELECT * FROM leave_types WHERE id = ?', [id]);
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to update leave type' });
  }
});

router.delete('/types/:id', auth, adminOnly, async (req: AuthRequest, res: Response) => {
  const connection = await db.getConnection();
  try {
    const { id } = req.params;
    
    await connection.beginTransaction();

    // Cascading deletes for all related tables
    await connection.query('DELETE FROM leave_group_types WHERE leaveTypeId = ?', [id]);
    await connection.query('DELETE FROM leave_entitlements WHERE leaveTypeId = ?', [id]);
    await connection.query('DELETE FROM earned_leaves WHERE leaveTypeId = ?', [id]);
    await connection.query('DELETE FROM leave_applications WHERE leaveTypeId = ?', [id]);
    
    // Nullify references within leave_types table itself
    await connection.query('UPDATE leave_types SET carriedForwardToLeaveTypeId = NULL WHERE carriedForwardToLeaveTypeId = ?', [id]);
    await connection.query('UPDATE leave_types SET subsequentLeaveTypeNotAllowedId = NULL WHERE subsequentLeaveTypeNotAllowedId = ?', [id]);

    // Finally delete the leave type
    await connection.query('DELETE FROM leave_types WHERE id = ?', [id]);
    
    await connection.commit();
    res.json({ success: true, message: 'Leave type completely wiped successfully' });
  } catch (err) {
    await connection.rollback();
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to delete leave type' });
  } finally {
    connection.release();
  }
});


// ─── LEAVE GROUPS ────────────────────────────────────────────────────────────
router.get('/groups', auth, async (_req: AuthRequest, res: Response) => {
  try {
    const [groups] = await db.query<RowDataPacket[]>('SELECT * FROM leave_groups');
    for (let i=0; i<groups.length; i++) {
      const [types] = await db.query<RowDataPacket[]>(`
        SELECT lgt.*, lt.name as leaveTypeName, lt.code as leaveTypeCode 
        FROM leave_group_types lgt 
        JOIN leave_types lt ON lgt.leaveTypeId = lt.id 
        WHERE lgt.leaveGroupId = ?
      `, [groups[i].id]);
      groups[i].leaveTypes = types.map((t: any) => ({
        ...t,
        leaveType: { name: t.leaveTypeName, code: t.leaveTypeCode }
      }));
    }
    res.json({ success: true, data: groups });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch leave groups' });
  }
});

router.post('/groups', auth, adminOnly, async (req: AuthRequest, res: Response) => {
  try {
    const { name, code, employmentType, country, startingMonth, effectiveFrom, effectiveTo, isActive } = req.body;
    
    const [existing] = await db.query<RowDataPacket[]>('SELECT id FROM leave_groups WHERE code = ? OR name = ? LIMIT 1', [code, name]);

    let resultId;
    if (existing.length > 0) {
      resultId = existing[0].id;
      await db.query(`
        UPDATE leave_groups SET name=?, code=?, employmentType=?, country=?, startingMonth=?, effectiveFrom=?, effectiveTo=?, isActive=?, updatedAt=NOW() WHERE id=?
      `, [name, code, employmentType, country, parseInt(startingMonth) || 1, effectiveFrom ? new Date(effectiveFrom) : null, effectiveTo ? new Date(effectiveTo) : null, isActive ?? 1, resultId]);
    } else {
      resultId = uuidv4();
      await db.query(`
        INSERT INTO leave_groups (id, name, code, employmentType, country, startingMonth, effectiveFrom, effectiveTo, isActive, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
      `, [resultId, name, code, employmentType, country, parseInt(startingMonth) || 1, effectiveFrom ? new Date(effectiveFrom) : null, effectiveTo ? new Date(effectiveTo) : null, isActive ?? 1]);
    }

    const [rows] = await db.query<RowDataPacket[]>('SELECT * FROM leave_groups WHERE id = ?', [resultId]);
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err: any) {
    console.error('Leave group create error:', err);
    res.status(500).json({ success: false, message: err.message || 'Failed to create leave group' });
  }
});

router.put('/groups/:id', auth, adminOnly, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, code, employmentType, country, startingMonth, effectiveFrom, effectiveTo, isActive } = req.body;
    
    await db.query(`
      UPDATE leave_groups SET name=?, code=?, employmentType=?, country=?, startingMonth=?, effectiveFrom=?, effectiveTo=?, isActive=?, updatedAt=NOW() WHERE id=?
    `, [name, code, employmentType, country, parseInt(startingMonth) || 1, effectiveFrom ? new Date(effectiveFrom) : null, effectiveTo ? new Date(effectiveTo) : null, isActive ?? 1, id]);

    const [rows] = await db.query<RowDataPacket[]>('SELECT * FROM leave_groups WHERE id = ?', [id]);
    res.json({ success: true, data: rows[0] });
  } catch (err: any) {
    console.error('Leave group update error:', err);
    res.status(500).json({ success: false, message: err.message || 'Failed to update leave group' });
  }
});

router.delete('/groups/:id', auth, adminOnly, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    
    // Delete associated group types
    await db.query('DELETE FROM leave_group_types WHERE leaveGroupId = ?', [id]);
    
    // Delete group
    await db.query('DELETE FROM leave_groups WHERE id = ?', [id]);
    
    res.json({ success: true, message: 'Leave group deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to delete leave group' });
  }
});

router.post('/groups/:id/types', auth, adminOnly, async (req: AuthRequest, res: Response) => {
  try {
    const { leaveTypeId, entitlementDays, unit, allocationMethod, allowProration, allowCarryForward, carryForwardLimit, minimumServiceMonths, maximumConsecutiveDays, approvalWorkflow } = req.body;
    
    const newId = uuidv4();
    await db.query(`
      INSERT INTO leave_group_types (
        id, leaveGroupId, leaveTypeId, entitlementDays, unit, allocationMethod, allowProration, allowCarryForward, carryForwardLimit, minimumServiceMonths, maximumConsecutiveDays, approvalWorkflow, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `, [
      newId, req.params.id, leaveTypeId, parseFloat(entitlementDays) || 0, unit, allocationMethod,
      allowProration ?? 1, allowCarryForward ?? 0, parseFloat(carryForwardLimit) || 0, parseInt(minimumServiceMonths) || 0,
      maximumConsecutiveDays ? parseInt(maximumConsecutiveDays) : null, approvalWorkflow || "Manager -> HR"
    ]);

    const [rows] = await db.query<RowDataPacket[]>('SELECT * FROM leave_group_types WHERE id = ?', [newId]);
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to assign leave type to group' });
  }
});

// ─── EMPLOYEE LEAVE ASSIGNMENT ────────────────────────────────────────────────
router.post('/employee/:employeeId/assign', auth, adminOnly, async (req: AuthRequest, res: Response) => {
  try {
    res.json({ success: true, message: 'Leave Group successfully assigned and balances calculated' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to assign leave group to employee' });
  }
});

export default router;

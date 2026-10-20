import { Router, type Response, type Request } from 'express';
import { db } from '../../../lib/db';
import { RowDataPacket } from 'mysql2';
import { requireAuth } from '../../../middleware/auth';

type AuthRequest = Request & { user?: { userId: string; role: string; email: string } };

import { submitLeave, importApprovedLeave, cancelLeave, LeaveError } from '../services/application.service';
import { ZodError } from 'zod';
const router = Router();
router.use(requireAuth);

// ─── GET /api/leaves/entitlements ─────────────────────────────────────────────
router.get('/entitlements', async (req: AuthRequest, res: Response) => {
  try {
    const userId = (['ADMIN','SUPER_ADMIN'].includes(req.user!.role) && req.query.userId) ? (req.query.userId as string) : req.user!.userId;
    const yearParam = req.query.year as string | undefined;

    let leaveYearRows: RowDataPacket[] = [];
    if (yearParam) {
      [leaveYearRows] = await db.query<RowDataPacket[]>('SELECT id FROM leave_years WHERE year = ? LIMIT 1', [parseInt(yearParam)]);
    } else {
      [leaveYearRows] = await db.query<RowDataPacket[]>('SELECT id FROM leave_years WHERE isActive = 1 ORDER BY year DESC LIMIT 1');
    }

    if (leaveYearRows.length === 0) return res.json({ success: true, data: [] });
    const leaveYear = leaveYearRows[0];

    let [entitlements] = await db.query<RowDataPacket[]>(`
      SELECT e.*, 
             lt.id as lt_id, lt.name as lt_name, lt.color as lt_color, lt.code as lt_code,
             ly.id as ly_id, ly.year as ly_year, ly.displayName as ly_displayName
      FROM leave_entitlements e
      JOIN leave_types lt ON e.leaveTypeId = lt.id
      JOIN leave_years ly ON e.leaveYearId = ly.id
      WHERE e.userId = ? AND e.leaveYearId = ?
      ORDER BY lt.name ASC
    `, [userId, leaveYear.id]);

    // Lazy generation fallback for employees who have no entitlements generated for the current year
    if (entitlements.length === 0) {
      try {
        const [empRows] = await db.query<RowDataPacket[]>('SELECT id FROM employee_information_employees WHERE userId = ? LIMIT 1', [userId]);
        if (empRows.length > 0) {
          const { processEntitlementsForEmployee } = await import('../../leave/leave.controller');
          await processEntitlementsForEmployee(empRows[0].id);
          
          // Fetch again after generation
          [entitlements] = await db.query<RowDataPacket[]>(`
            SELECT e.*, 
                   lt.id as lt_id, lt.name as lt_name, lt.color as lt_color, lt.code as lt_code,
                   ly.id as ly_id, ly.year as ly_year, ly.displayName as ly_displayName
            FROM leave_entitlements e
            JOIN leave_types lt ON e.leaveTypeId = lt.id
            JOIN leave_years ly ON e.leaveYearId = ly.id
            WHERE e.userId = ? AND e.leaveYearId = ?
            ORDER BY lt.name ASC
          `, [userId, leaveYear.id]);
        }
      } catch (genErr: any) {
        console.error('Lazy leave generation failed:', genErr.message);
      }
    }

    const formatted = entitlements.map(e => ({
      id: e.id,
      userId: e.userId,
      leaveTypeId: e.leaveTypeId,
      leaveYearId: e.leaveYearId,
      totalDays: e.totalDays,
      usedDays: e.usedDays,
      pendingDays: e.pendingDays,
      earnedDays: e.earnedDays,
      carryForwardDays: e.carryForwardDays,
      status: e.status,
      leaveType: { id: e.lt_id, name: e.lt_name, color: e.lt_color, code: e.lt_code },
      leaveYear: { id: e.ly_id, year: e.ly_year, displayName: e.ly_displayName }
    }));

    res.json({ success: true, data: formatted });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch entitlements' });
  }
});

// ─── GET /api/leaves/applications ─────────────────────────────────────────────
router.get('/applications', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { year, status, page = '1', limit = '20' } = req.query as Record<string, string>;

    let conditions = ['la.applicantId = ?'];
    let params: any[] = [userId];

    if (status) {
      conditions.push('la.status = ?');
      params.push(status);
    }

    if (year) {
      const [lyRows] = await db.query<RowDataPacket[]>('SELECT id FROM leave_years WHERE year = ? LIMIT 1', [parseInt(year)]);
      if (lyRows.length > 0) {
        conditions.push('la.leaveYearId = ?');
        params.push(lyRows[0].id);
      }
    }

    const whereClause = conditions.join(' AND ');

    const [countRows] = await db.query<RowDataPacket[]>(`SELECT COUNT(*) as total FROM leave_applications la WHERE ${whereClause}`, params);
    const total = countRows[0].total;

    const pageNum=Math.max(1,parseInt(page)||1), limitNum=Math.max(1,Math.min(500,parseInt(limit)||20));
    const offset = (pageNum - 1) * limitNum;
    
    const [applications] = await db.query<RowDataPacket[]>(`
      SELECT la.*,
             lt.id as lt_id, lt.name as lt_name, lt.color as lt_color, lt.code as lt_code,
             ly.id as ly_id, ly.year as ly_year, ly.displayName as ly_displayName,
             appr.id as appr_id, appr.name as appr_name, appr.email as appr_email,
             cov.id as cov_id, cov.name as cov_name, cov.email as cov_email
      FROM leave_applications la
      JOIN leave_types lt ON la.leaveTypeId = lt.id
      JOIN leave_years ly ON la.leaveYearId = ly.id
      LEFT JOIN users appr ON la.approverId = appr.id
      LEFT JOIN users cov ON la.coveringEmployeeId = cov.id
      WHERE ${whereClause}
      ORDER BY la.createdAt DESC
      LIMIT ? OFFSET ?
    `, [...params, limitNum, offset]);

    const formatted = applications.map(app => ({
      id: app.id,
      applicantId: app.applicantId,
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
      meta: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch leave applications' });
  }
});

// ─── POST /api/leaves/applications ────────────────────────────────────────────
router.post('/applications', async (req:AuthRequest,res:Response)=>{
  try {res.status(201).json({success:true,data:await submitLeave(req.user!,req.body),message:'Leave request submitted.'});}
  catch(e:any){res.status(e instanceof LeaveError?e.status:e instanceof ZodError?400:500).json({success:false,message:e.message});}
});

// ─── POST /api/leaves/applications/bulk ───────────────────────────────────────
router.post('/applications/bulk', async (req: AuthRequest, res: Response) => {
  try {
    if (!['ADMIN','SUPER_ADMIN'].includes(req.user!.role)) return res.status(403).json({ success: false, message: 'Forbidden' });

    const records = req.body;
    if (!Array.isArray(records)) return res.status(400).json({ success: false, message: 'Expected an array of records' });

    const results = { success: 0, failed: 0, errors: [] as string[] };
    
    for (let i = 0; i < records.length; i++) {
      try {
        const { empId, leaveTypeCode, startDate, endDate, totalDays, reason } = records[i] || {};
        if (!empId || !leaveTypeCode) throw new Error('Employee number and leave type code are required.');
        const [empRows] = await db.query<RowDataPacket[]>('SELECT id,userId FROM employee_information_employees WHERE employeeNo = ? OR employeeNumber = ? LIMIT 1', [empId,empId]);
        if (empRows.length === 0) throw new Error(`Employee ${empId} not found`);
        const employee = empRows[0];

        const [ltRows] = await db.query<RowDataPacket[]>('SELECT id FROM leave_types WHERE code = ? LIMIT 1', [leaveTypeCode]);
        if (ltRows.length === 0) throw new Error(`Leave type ${leaveTypeCode} not found`);
        const leaveType = ltRows[0];

        await importApprovedLeave(req.user!, { applicantId: employee.userId,leaveTypeId:leaveType.id,startDate,endDate,totalDays,reason:reason||'Bulk import',comments:reason||'Bulk import' });

        results.success++;
      } catch (err: any) {
        results.failed++;
        results.errors.push(`Row ${i + 1}: ${err.message}`);
      }
    }

    res.status(201).json({ success: true, data: results, message: 'Bulk upload processed' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Bulk upload failed' });
  }
});

// ─── PATCH /api/leaves/applications/:id/cancel ────────────────────────────────
router.patch('/applications/:id/cancel',async(req:AuthRequest,res:Response)=>{
  try {res.json({success:true,data:await cancelLeave(req.user!.userId,String(req.params.id),req.body.cancelReason)});}
  catch(e:any){res.status(e instanceof LeaveError?e.status:500).json({success:false,message:e.message});}
});

export default router;

import { Router, type Response, type Request } from 'express';
import { db } from '../../../lib/db';
import { RowDataPacket } from 'mysql2';
import { requireAuth } from '../../../middleware/auth';
import { organizationAccess } from '../../../shared/services/organization.service';
import { localToday } from '../../../shared/services/dashboard.service';
import { decideLeave, LeaveError } from '../services/application.service';

type AuthRequest = Request & { user?: { userId: string; role: string; email: string } };
const router = Router();
router.use(requireAuth);

router.patch('/applications/:id/approve', async (req: AuthRequest, res: Response) => {
  try { res.json({ success: true, data: await decideLeave(req.user!, String(req.params.id), req.body.action, req.body.rejectedReason || req.body.comment) }); }
  catch (error: any) { res.status(error instanceof LeaveError ? error.status : 500).json({ success: false, message: error.message }); }
});

router.get('/team/dashboard', async (req: AuthRequest, res: Response) => {
  try {
    const access = await organizationAccess(req.user!.userId);
    if (!access.admin && !access.isExecutive && !access.isManager) {
      res.status(403).json({ success: false, message: 'A reporting team is required.' }); return;
    }
    const team = access.employees.filter(employee => employee.active && employee.id !== access.employeeId && access.visibleIds.includes(employee.id));
    const employeeIds = team.map(employee => employee.id);
    const userIds = team.map(employee => employee.userId).filter((id): id is string => !!id);
    const today = localToday();
    const ids = userIds.length ? userIds : [''];
    const eids = employeeIds.length ? employeeIds : [''];
    const [pending] = await db.query<RowDataPacket[]>(`
      SELECT la.*, u.id AS applicant_id, u.name AS applicant_name, u.email AS applicant_email,
        lt.id AS lt_id, lt.name AS lt_name, lt.color AS lt_color, lt.code AS lt_code,
        ly.id AS ly_id, ly.year AS ly_year, ly.displayName AS ly_displayName,cover.name AS cover_name
      FROM leave_applications la
      JOIN users u ON u.id = la.applicantId
      JOIN leave_types lt ON lt.id = la.leaveTypeId
      JOIN leave_years ly ON ly.id = la.leaveYearId
      LEFT JOIN users cover ON cover.id=la.coveringEmployeeId
      WHERE la.approverId = ? AND la.applicantId IN (?) AND la.status LIKE 'PENDING%'
      ORDER BY la.createdAt ASC`, [req.user!.userId, ids]);
    const [leave] = await db.query<RowDataPacket[]>(`
      SELECT la.applicantId, la.totalDays, DATE_FORMAT(la.startDate, '%Y-%m-%d') AS startDate,
        DATE_FORMAT(la.endDate, '%Y-%m-%d') AS endDate, lt.name AS leaveType, lt.color AS leaveTypeColor
      FROM leave_applications la JOIN leave_types lt ON lt.id=la.leaveTypeId
      WHERE la.applicantId IN (?) AND la.status='APPROVED' AND la.endDate >= DATE_SUB(?, INTERVAL 365 DAY)
      AND la.startDate <= DATE_ADD(?, INTERVAL 6 DAY)`, [ids, today, today]);
    const [attendance] = await db.query<RowDataPacket[]>(`
      SELECT employeeId, DATE_FORMAT(date, '%Y-%m-%d') AS date, status, inTime
      FROM attendance_records WHERE employeeId IN (?) AND date >= DATE_SUB(?, INTERVAL 365 DAY) AND date <= ?`, [eids, today, today]);
    const absentRecords = attendance.filter(row => row.status === 'Absent');
    const todayAttendance = attendance.filter(row => row.date === today);
    const onLeaveToday = leave.filter((row, index, all) => row.startDate <= today && row.endDate >= today &&
      all.findIndex(candidate => candidate.applicantId === row.applicantId && candidate.startDate <= today && candidate.endDate >= today) === index);
    const onLeaveUsers = new Set(onLeaveToday.map(row => row.applicantId));
    const presentIds = new Set(todayAttendance.filter(row => row.inTime || ['Present', 'Late', 'APPROVED'].includes(row.status)).map(row => row.employeeId));
    const absentIds = new Set(todayAttendance.filter(row => row.status === 'Absent').map(row => row.employeeId));
    const present = team.filter(employee => presentIds.has(employee.id) && !onLeaveUsers.has(employee.userId)).length;
    const absent = team.filter(employee => absentIds.has(employee.id) || onLeaveUsers.has(employee.userId)).length;
    const next7Days = Array.from({ length: 7 }, (_, offset) => {
      const day = new Date(`${today}T00:00:00Z`); day.setUTCDate(day.getUTCDate() + offset);
      const date = day.toISOString().slice(0, 10);
      const out = new Set(leave.filter(row => row.startDate <= date && row.endDate >= date).map(row => row.applicantId));
      const available = team.length - out.size;
      return { date, dayName: day.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }),
        present: available, absent: out.size, percentage: team.length ? Math.round(available / team.length * 100) : 0 };
    });
    const bradfordFactor = team.map(employee => {
      const dates = [...new Set(absentRecords.filter(row => row.employeeId === employee.id).map(row => row.date))].sort();
      let episodes = 0; let previous = '';
      for (const date of dates) {
        if (!previous || Math.round((Date.parse(date) - Date.parse(previous)) / 86400000) > 1) episodes++;
        previous = date;
      }
      const score = episodes * episodes * dates.length;
      return { userId: employee.userId || employee.id, name: employee.name, email: '', episodes,
        totalDays: dates.length, score, risk: score > 450 ? 'Very High' : score > 200 ? 'High' : score > 50 ? 'Medium' : 'Low' };
    }).filter(row => row.totalDays > 0).sort((a, b) => b.score - a.score);
    const recentLimit = new Date(`${today}T00:00:00Z`); recentLimit.setUTCDate(recentLimit.getUTCDate() - 29);
    const recent = attendance.filter(row => row.date >= recentLimit.toISOString().slice(0, 10));
    const recordedDays = recent.filter(row => row.inTime || ['Present', 'Late', 'Absent', 'APPROVED'].includes(row.status)).length;
    const approvedDays = leave.filter(row => row.endDate <= today).reduce((sum, row) => sum + Number(row.totalDays || 0), 0);
    res.json({ success: true, data: {
      todaysAvailability: { total: team.length, present, absent, notRecorded: Math.max(0, team.length - present - absent),
        onLeave: onLeaveToday.map(row => ({ name: team.find(employee => employee.userId === row.applicantId)?.name || 'Employee',
          leaveType: row.leaveType, leaveTypeColor: row.leaveTypeColor })) },
      next7Days, bradfordFactor,
      pendingApprovals: pending.map(app => ({ id: app.id, employeeId: app.employeeId || app.applicant_id,
        leaveTypeId: app.leaveTypeId, leaveYearId: app.leaveYearId, startDate: app.startDate,
        endDate: app.endDate, status: app.status, totalDays: app.totalDays, reason: app.reason,
        halfDayType:app.halfDayType,attachmentUrl:app.attachmentUrl,medCertSubmitted:Boolean(app.medCertSubmitted),medCertRefNo:app.medCertRefNo,medCertIssuedDate:app.medCertIssuedDate,
        coveringEmployee:app.coveringEmployeeId?{id:app.coveringEmployeeId,name:app.cover_name}:null,
        createdAt: app.createdAt, applicant: { id: app.applicant_id, name: app.applicant_name, email: app.applicant_email },
        leaveType: { id: app.lt_id, name: app.lt_name, color: app.lt_color, code: app.lt_code },
        leaveYear: { id: app.ly_id, year: app.ly_year, displayName: app.ly_displayName } })),
      stats: { teamLeaveAvg: team.length ? +(approvedDays / team.length).toFixed(1) : 0,
        absenceRate: recordedDays ? +(recent.filter(row => row.status === 'Absent').length / recordedDays * 100).toFixed(1) : 0,
        totalPendingCount: pending.length, totalOnLeaveToday: onLeaveToday.length },
    } });
  } catch (_error) {
    res.status(500).json({ success: false, message: 'Failed to fetch team dashboard' });
  }
});

router.post('/seed-defaults', (_req, res) => res.status(501).json({ success: false, message: 'Demo seeding is disabled for live employee data.' }));
export default router;

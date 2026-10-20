import { Router } from 'express';
import { 
  getShifts, 
  createShift, 
  updateShift,
  deleteShift,
  getRosterGroups,
  createRosterGroup,
  updateRosterGroup,
  deleteRosterGroup,
  getAssignments,
  assignEmployees,
  getDashboardStats,
  getRecords,
  getExceptions,
  getCalendar,
  getMyTodayAttendance,
  punchAttendance,
  getMyAttendanceHistory,
  createManualAttendance,
  updateMyAttendance,
  getMyShift,
  getTeamMonthly,
  getOrganizationMonthly,
  requestMissedAttendance,
  getTeamExceptions,
  resolveException,
  getMyExceptions
} from './attendance.controller';
import { requireAuth, requireAdmin } from '../../middleware/auth';
import { requireExecutiveReader } from '../../middleware/organization';
import { requireModuleAction } from '../../middleware/module-action';

const router = Router();

// Apply auth to all attendance routes
router.use(requireAuth);

// Shifts
router.get('/shifts', getShifts);
router.post('/shifts', requireModuleAction('attendance_management','canCreate',true), createShift);
router.put('/shifts/:id', requireAdmin, updateShift);
router.delete('/shifts/:id', requireAdmin, deleteShift);

// Roster Groups
router.get('/roster-groups', getRosterGroups);
router.post('/roster-groups', requireAdmin, createRosterGroup);
router.put('/roster-groups/:id', requireAdmin, updateRosterGroup);
router.delete('/roster-groups/:id', requireAdmin, deleteRosterGroup);

// Assignments
router.get('/assignments', getAssignments);
router.post('/assignments', requireModuleAction('attendance_management','canCreate',true), assignEmployees);

// Records & Exceptions
router.get('/dashboard', getDashboardStats);
router.get('/records', getRecords);
router.get('/exceptions', getExceptions);
router.get('/calendar', getCalendar);
router.get('/team-monthly', getTeamMonthly);
router.get('/organization-monthly', requireExecutiveReader, getOrganizationMonthly);

// Employee Self Service
router.get('/my-today', getMyTodayAttendance);
router.post('/punch', punchAttendance);
router.get('/my-shift', getMyShift);
router.get('/my-attendance/history', getMyAttendanceHistory);
router.post('/my-attendance/manual', requireAdmin, createManualAttendance); // Employees use missed-punch approval requests.
router.get('/my-exceptions', getMyExceptions);
router.post('/exceptions/missed-punch', requestMissedAttendance);
router.get('/team-exceptions', getTeamExceptions);
router.post('/exceptions/:id/resolve', resolveException);
router.put('/my-attendance/:idOrDate', requireAdmin, updateMyAttendance);

export default router;

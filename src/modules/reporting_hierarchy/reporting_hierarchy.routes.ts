import { Router } from 'express';
import { requireAuth, requireAdmin } from '../../middleware/auth';
import {
  getActiveEmployees,
  getTreeNodes,
  assignManager,
  getAuditHistory,
  getUpwardPath,
  getMyNode,
  getUnassignedEmployees,
  bulkUpdateManagers,
  getMyManager,
  getLevels,
  updateLevel
} from './reporting_hierarchy.controller';

const router = Router();

// Require Authentication for all routes here
router.use(requireAuth);

// GET /api/reporting-hierarchy/employees
router.get('/employees', getActiveEmployees);

// GET /api/reporting-hierarchy/tree
router.get('/tree', getTreeNodes);

// GET /api/reporting-hierarchy/upward-path/:employeeId
router.get('/upward-path/:employeeId', getUpwardPath);

// GET /api/reporting-hierarchy/my-node
router.get('/my-node', getMyNode);

// POST /api/reporting-hierarchy/assign
router.post('/assign', requireAdmin, assignManager);

// GET /api/reporting-hierarchy/audit
router.get('/audit', requireAdmin, getAuditHistory);

// GET /api/reporting-hierarchy/unassigned
router.get('/unassigned', requireAdmin, getUnassignedEmployees);

// POST /api/reporting-hierarchy/bulk-update
router.post('/bulk-update', requireAdmin, bulkUpdateManagers);

// GET /api/reporting-hierarchy/my-manager
router.get('/my-manager', getMyManager);

// GET /api/reporting-hierarchy/levels
router.get('/levels', getLevels);

// PUT /api/reporting-hierarchy/levels/:depth
router.put('/levels/:depth', requireAdmin, updateLevel);

export default router;

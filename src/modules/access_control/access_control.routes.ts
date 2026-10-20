// @ts-nocheck
import { Router } from 'express';
import { requireAuth, requireAdmin } from '../../middleware/auth';
import { 
  getUsers, 
  updateUserRole, 
  getUserPermissions, 
  updateUserPermissions,
  updateUserStatus 
} from './access_control.controller';

const router = Router();

router.use(requireAuth);
router.use(requireAdmin);

// Get all users with EIM data
router.get('/users', getUsers);

// Update a user's role
router.patch('/users/:id/role', updateUserRole);

// Get a user's module permissions
router.get('/users/:id/permissions', getUserPermissions);

// Update a user's module permissions
router.patch('/users/:id/permissions', updateUserPermissions);

// Update a user's active status
router.patch('/users/:id/status', updateUserStatus);

export default router;

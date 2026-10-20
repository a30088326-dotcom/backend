import { Router } from 'express';
import profileRequests from './profile-requests';
import { requireAuth, requireAdmin } from '../../middleware/auth';
import { requireModuleAction } from '../../middleware/module-action';
import { 
  getEmployees,
  createEmployee,
  updateEmployee,
  getEmployeeById,
  getMyEmployee,
  convertCandidate,
  checkEmployeeNo,
  uploadAttachment,
  getAttachments,
  deleteAttachment,
  uploadProfilePicture
} from './employee_information_audit.controller';
import { ProbationConfirmationService } from './confirmationService';
import { organizationAccess } from '../../shared/services/organization.service';
import multer from 'multer';

// Multer Config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage });

const router = Router();
router.use('/profile-requests', profileRequests);

// EIMS Core Routes
router.get('/check-no/:empNo', requireAuth, checkEmployeeNo);
router.get('/', requireAuth, getEmployees);
router.post('/', requireAuth, requireAdmin, createEmployee);

// Probation → Permanent Confirmation
router.post('/confirm-permanent/:employeeId', requireAuth, requireAdmin, async (req: any, res: any) => {
  try {
    const { employeeId } = req.params;
    const { permanentEffectiveDate } = req.body;

    if (!permanentEffectiveDate) {
      return res.status(400).json({ success: false, message: 'Permanent Effective Date is required' });
    }

    const result = await ProbationConfirmationService.confirmPermanent(
      employeeId,
      new Date(permanentEffectiveDate),
      req.user.userId
    );

    res.json({ success: true, data: result });
  } catch (error: any) {
    console.error('Confirm Permanent Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Transition audit log
router.get('/transition-log/:employeeId', requireAuth, async (req: any, res: any) => {
  try {
    const { db } = require('../../lib/db');
    const access = await organizationAccess(req.user.userId);
    if (!access.admin && !access.visibleIds.includes(req.params.employeeId)) {
      return res.status(403).json({ success: false, message: 'You do not have access to this employee history.' });
    }
    const [logs] = await db.query('SELECT * FROM employee_information_employment_type_transitions WHERE employeeId = ? ORDER BY createdAt DESC', [req.params.employeeId]);
    res.json({ success: true, data: logs });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Self-service: get my own employee profile
router.get('/me', requireAuth, getMyEmployee);

router.get('/:id', requireAuth, getEmployeeById);
router.put('/:id', requireAuth, requireModuleAction('employee_information','canEdit',true), updateEmployee);

router.post('/convert/:candidateId', requireAuth, requireAdmin, convertCandidate);

// Attachments
router.post('/attachments/:employeeId', requireAuth, async (req,res,next) => {
  try {
    const access = await organizationAccess(req.user!.userId);
    if (!access.admin && access.employeeId !== req.params.employeeId) return res.status(403).json({success:false,message:'You can upload attachments only to your own employee profile.'});
    next();
  } catch (error) { next(error); }
}, upload.array('files'), uploadAttachment);
router.get('/attachments/:employeeId', requireAuth, getAttachments);
router.delete('/attachments/:id', requireAuth, deleteAttachment);

// Profile Picture
router.post('/profile-picture', requireAuth, upload.single('file'), uploadProfilePicture);

export default router;

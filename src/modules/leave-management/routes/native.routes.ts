import { Router } from 'express';
import { requireAuth } from '../../../middleware/auth';
import config from './native-config.routes';
import apply from './native-apply.routes';
import team from './native-team.routes';
const router = Router();
router.use(requireAuth, config, apply, team);
// A native request must never fall through to legacy SQL handlers.
router.use((_req,res)=>{res.status(404).json({success:false,message:'Leave endpoint not found.'});});
export default router;

import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { dashboardFor } from './services/dashboard.service';
const router=Router(); router.use(requireAuth);
router.get('/dashboard',async(req,res,next)=>{try {res.json({success:true,data:await dashboardFor(req.user!.userId)});}catch(e){next(e);}});
export default router;

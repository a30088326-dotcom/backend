import { Router } from 'express';
import configRoutes from './config.routes';
import applyRoutes from './apply.routes';
import supervisorRoutes from './supervisor.routes';
import rulesRoutes from './rules.routes';
import ceoRoutes from './ceo.routes';
import nativeRoutes from './native.routes';

const router = Router();
router.use((req,res,next)=>process.env.DATABASE_PROVIDER==='dynamodb'?nativeRoutes(req,res,next):next());

// Mount sub-routes
router.use('/', configRoutes);
router.use('/', applyRoutes);
router.use('/', supervisorRoutes);
router.use('/', ceoRoutes);
router.use('/rules', rulesRoutes);

export default router;

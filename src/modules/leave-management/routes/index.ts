import { Router } from 'express';
import configRoutes from './config.routes';
import applyRoutes from './apply.routes';
import supervisorRoutes from './supervisor.routes';
import rulesRoutes from './rules.routes';
import ceoRoutes from './ceo.routes';

const router = Router();

// Mount sub-routes
router.use('/', configRoutes);
router.use('/', applyRoutes);
router.use('/', supervisorRoutes);
router.use('/', ceoRoutes);
router.use('/rules', rulesRoutes);

export default router;

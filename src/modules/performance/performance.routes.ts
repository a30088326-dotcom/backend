import { Router, Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { ensurePerformanceSchema } from './schema';
import { actorFor, readNotification } from './store';
import { idSchema, PerformanceError } from './rules';
import * as setup from './setup.service';
import { changeReview } from './review.service';
import { reviewDetails, workspace } from './query.service';
import { historicalPerformance } from './history.service';
import type { Actor } from './types';
import { StorageConflictError } from '../../storage/dynamodb';

const router = Router();
router.use(requireAuth);
const route = (handler: (actor: Actor, req: Request) => Promise<unknown>) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    await ensurePerformanceSchema();
    const actor = await actorFor(req.user!.userId);
    res.json({ success: true, data: await handler(actor, req) });
  } catch (error) {
    if (error instanceof ZodError) { res.status(400).json({ success: false, message: error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') }); return; }
    if (error instanceof PerformanceError) { res.status(error.status).json({ success: false, message: error.message }); return; }
    if (error instanceof StorageConflictError) { res.status(409).json({ success:false,message:error.message }); return; }
    next(error);
  }
};
const id = (req: Request) => idSchema.parse(req.params.id);
router.get('/workspace', route(actor => workspace(actor)));
router.get('/history', route(actor => historicalPerformance(actor)));
router.get('/reviews/:id', route((actor, req) => reviewDetails(actor, id(req))));
router.post('/reviews/:id/actions', route((actor, req) => changeReview(actor, id(req), req.body)));
router.post('/templates', route((actor, req) => setup.saveTemplate(actor, req.body)));
router.put('/templates/:id', route((actor, req) => setup.saveTemplate(actor, req.body, id(req))));
router.post('/templates/:id/publish', route((actor, req) => setup.publishTemplate(actor, id(req))));
router.delete('/templates/:id', route((actor, req) => setup.deleteTemplate(actor, id(req))));
router.post('/cycles', route((actor, req) => setup.saveCycle(actor, req.body)));
router.put('/cycles/:id', route((actor, req) => setup.saveCycle(actor, req.body, id(req))));
router.post('/cycles/:id/:action', route((actor, req) => setup.transitionCycle(actor, id(req), String(req.params.action))));
router.post('/library', route((actor, req) => setup.saveLibraryGoal(actor, req.body)));
router.put('/library/:id', route((actor, req) => setup.saveLibraryGoal(actor, req.body, id(req))));
router.delete('/library/:id', route((actor, req) => setup.deleteLibraryGoal(actor, id(req))));
router.post('/assign-goals', route((actor, req) => setup.assignGoals(actor, req.body)));
router.post('/notifications/:id/read', route(async (actor, req) => {
  await readNotification(id(req), actor.userId);
  return { read: true };
}));
export default router;

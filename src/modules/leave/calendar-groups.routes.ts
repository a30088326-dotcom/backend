import { Router } from 'express';
import { calendarGroupsController } from './calendar-groups.controller';

const router = Router();

router.get('/', calendarGroupsController.getAll);
router.post('/', calendarGroupsController.create);
router.put('/:id', calendarGroupsController.update);
router.delete('/:id', calendarGroupsController.delete);

export default router;

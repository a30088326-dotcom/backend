import { Router } from 'express';
import { holidayCalendarController } from './holiday-calendar.controller';

const router = Router();

router.get('/:year/:groupId', holidayCalendarController.getCalendar);
router.post('/', holidayCalendarController.saveCalendar);

export default router;

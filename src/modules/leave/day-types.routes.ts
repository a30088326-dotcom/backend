import { Router } from 'express';
import { dayTypesController } from './day-types.controller';

const router = Router();

router.get('/', dayTypesController.getAll);
router.post('/', dayTypesController.create);
router.put('/:id', dayTypesController.update);
router.delete('/:id', dayTypesController.delete);

export default router;

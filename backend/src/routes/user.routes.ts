import { Router } from 'express';
import { body } from 'express-validator';
import { getAll, create, update, remove } from '../controllers/user.controller';
import { authenticate, requireAdmin } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';

export const userRouter = Router();

userRouter.use(authenticate, requireAdmin);

userRouter.get('/', getAll);

const VALID_ROLES = ['ADMIN', 'GESTIONNAIRE_GARANTIES', 'RESPONSABLE_RISQUES', 'ENGAGEMENTS', 'AUDIT_INTERNE'];

userRouter.post(
  '/',
  [
    body('email').isEmail().withMessage('Valid email required'),
    body('password').isLength({ min: 12 }).withMessage('Password must be at least 12 characters'),
    body('nom').notEmpty().withMessage('Nom required'),
    body('prenom').optional().isString(),
    body('role').optional().isIn(VALID_ROLES),
  ],
  validate,
  create,
);

userRouter.put(
  '/:id',
  [
    body('email').optional().isEmail(),
    body('password').optional().isLength({ min: 12 }),
    body('role').optional().isIn(VALID_ROLES),
  ],
  validate,
  update,
);

userRouter.delete('/:id', remove);

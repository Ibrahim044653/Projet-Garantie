import { Router } from 'express';
import { body } from 'express-validator';
import rateLimit from 'express-rate-limit';
import { login, logout, me } from '../controllers/auth.controller';
import { setupMfa, confirmMfa, validateMfa, disableMfa } from '../controllers/mfa.controller';
import { authenticate } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives. Réessayez dans 15 minutes.' },
});

export const authRouter = Router();

authRouter.post(
  '/login',
  authLimiter,
  [
    body('email').isEmail().withMessage('Valid email required'),
    body('password').notEmpty().withMessage('Password required'),
  ],
  validate,
  login,
);

authRouter.post('/logout', logout);
authRouter.get('/me', authenticate, me);

// MFA routes
authRouter.get('/mfa/setup', authenticate, setupMfa);
authRouter.post('/mfa/confirm', authenticate, [body('token').notEmpty()], validate, confirmMfa);
authRouter.post('/mfa/validate', authLimiter, [body('userId').notEmpty(), body('token').notEmpty()], validate, validateMfa);
authRouter.delete('/mfa/disable', authenticate, disableMfa);

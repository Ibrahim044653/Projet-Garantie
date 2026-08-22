import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth.middleware';
import { setCsrfCookie, clearCsrfCookie } from '../middleware/csrf.middleware';
import { sendEmail } from '../services/notification.service';
import { logger } from '../services/logger';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET environment variable is required');
const JWT_EXPIRES_IN = '1h';
const COOKIE_MAX_AGE = 60 * 60 * 1000; // 1 hour

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });

    // Même message générique si l'email n'existe pas (évite l'énumération d'utilisateurs)
    if (!user) {
      res.status(401).json({ error: 'Email ou mot de passe incorrect' });
      return;
    }

    // Vérifier si le compte est verrouillé
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const remaining = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      res.status(423).json({
        error: `Compte temporairement verrouillé. Réessayez dans ${remaining} minute(s).`,
      });
      return;
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      const attempts = user.failedLoginAttempts + 1;
      const shouldLock = attempts >= MAX_FAILED_ATTEMPTS;
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: attempts,
          lockedUntil: shouldLock ? new Date(Date.now() + LOCKOUT_DURATION_MS) : null,
        },
      });

      if (shouldLock) {
        logger.warn(`Account locked after ${MAX_FAILED_ATTEMPTS} failed attempts: ${email}`);
        sendEmail(
          user.email,
          'Alerte sécurité — Compte temporairement verrouillé',
          `<p>Bonjour ${user.prenom},</p>
           <p>Votre compte a été temporairement verrouillé pendant <strong>15 minutes</strong>
           après ${MAX_FAILED_ATTEMPTS} tentatives de connexion échouées.</p>
           <p>Si vous n'êtes pas à l'origine de ces tentatives, contactez l'administrateur immédiatement.</p>`,
        ).catch(() => { /* email non bloquant */ });
      }

      res.status(401).json({ error: 'Email ou mot de passe incorrect' });
      return;
    }

    // Réinitialiser le compteur après une connexion réussie
    if (user.failedLoginAttempts > 0 || user.lockedUntil) {
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
    }

    // MFA : si activé, retourner un challenge au lieu du token
    if (user.mfaEnabled) {
      logger.info(`MFA challenge required for: ${user.email}`);
      res.json({
        mfaRequired: true,
        userId: user.id,
        message: 'Code TOTP requis. Appelez POST /api/auth/mfa/validate avec { userId, token }.',
      });
      return;
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN },
    );

    // Set httpOnly cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: COOKIE_MAX_AGE,
    });

    setCsrfCookie(res);
    logger.info(`User logged in: ${user.email} (${user.role})`);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        nom: user.nom,
        prenom: user.prenom,
        role: user.role,
        mfaEnabled: user.mfaEnabled,
      },
    });
  } catch (err) {
    logger.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const logout = (_req: Request, res: Response): void => {
  res.clearCookie('token');
  clearCsrfCookie(res);
  res.json({ message: 'Logged out successfully' });
};

export const me = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { id: true, email: true, nom: true, prenom: true, role: true, createdAt: true },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json(user);
  } catch (err) {
    logger.error('Me error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

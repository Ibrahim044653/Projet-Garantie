import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';

const CSRF_COOKIE = 'csrf-token';
const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Set a fresh CSRF token cookie. Call after login / MFA validate.
 * Cookie is NOT httpOnly so the frontend JS can read it (Double Submit Cookie pattern).
 */
export function setCsrfCookie(res: Response): void {
  const token = crypto.randomBytes(32).toString('hex');
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 60 * 60 * 1000,
  });
}

/** Clear the CSRF cookie on logout. */
export function clearCsrfCookie(res: Response): void {
  res.clearCookie(CSRF_COOKIE, { sameSite: 'strict' });
}

/**
 * Middleware — validates CSRF token on every state-changing request (POST/PUT/DELETE/PATCH).
 * Skips /api/auth/login and /api/auth/mfa/validate (public endpoints that produce the token).
 */
export function validateCsrf(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  // Skip endpoints that issue the CSRF token (user is not yet authenticated)
  const publicPaths = ['/api/auth/login', '/api/auth/mfa/validate'];
  if (publicPaths.includes(req.path)) {
    next();
    return;
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.headers[CSRF_HEADER];

  if (!cookieToken || !headerToken || cookieToken !== String(headerToken)) {
    res.status(403).json({ error: 'CSRF token invalide ou manquant' });
    return;
  }

  next();
}

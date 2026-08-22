import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET environment variable is required');

export interface AuthRequest extends Request {
  user?: {
    id: number;
    email: string;
    role: string;
    nom: string;
    prenom: string;
  };
}

export const authenticate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    // Check cookie first, then Authorization header
    let token = req.cookies?.token;

    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }
    }

    if (!token) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const decoded = jwt.verify(token, JWT_SECRET) as {
      id: number;
      email: string;
      role: string;
    };

    const user = await prisma.user.findUnique({ where: { id: decoded.id } });
    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      nom: user.nom,
      prenom: user.prenom,
    };

    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

export const requireRole = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        error: 'Insufficient permissions',
        required: roles,
        current: req.user.role,
      });
      return;
    }

    next();
  };
};

// Roles hiérarchie:
// ADMIN                  → accès total
// GESTIONNAIRE_GARANTIES → CRUD hypothèques, réévaluation, exports
// RESPONSABLE_RISQUES    → lecture seule
// ENGAGEMENTS            → lecture hypothèques (suivi encours prêts)
// AUDIT_INTERNE          → lecture complète (audit trail, historique, reporting)

export const requireGestionnaire = requireRole('ADMIN', 'GESTIONNAIRE_GARANTIES');
export const requireAdmin = requireRole('ADMIN');
export const requireLecteur = requireRole(
  'ADMIN',
  'GESTIONNAIRE_GARANTIES',
  'RESPONSABLE_RISQUES',
  'ENGAGEMENTS',
  'AUDIT_INTERNE',
);
export const requireAudit = requireRole('ADMIN', 'AUDIT_INTERNE');

import { Response } from 'express';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth.middleware';

const prisma = new PrismaClient();

/**
 * GET /api/auth/mfa/setup
 * Génère un secret TOTP + QR code pour l'utilisateur connecté.
 */
export const setupMfa = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      res.status(404).json({ error: 'Utilisateur introuvable' });
      return;
    }

    const secret = speakeasy.generateSecret({
      name: `SIGGHY (${user.email})`,
      issuer: 'Banque ICO',
      length: 32,
    });

    // Stocker le secret temporairement (non encore activé)
    await prisma.user.update({
      where: { id: userId },
      data: { mfaSecret: secret.base32, mfaEnabled: false },
    });

    const qrCodeDataUrl = await QRCode.toDataURL(secret.otpauth_url!);

    res.json({
      secret: secret.base32,
      otpauthUrl: secret.otpauth_url,
      qrCode: qrCodeDataUrl,
      message: 'Scannez le QR code avec Google Authenticator ou une app TOTP compatible, puis confirmez avec /api/auth/mfa/confirm',
    });
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la configuration MFA' });
  }
};

/**
 * POST /api/auth/mfa/confirm
 * Valide le premier code TOTP et active le MFA.
 */
export const confirmMfa = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { token } = req.body;

    if (!token) {
      res.status(400).json({ error: 'Code TOTP requis' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.mfaSecret) {
      res.status(400).json({ error: 'MFA non configuré. Appelez /api/auth/mfa/setup d\'abord.' });
      return;
    }

    const verified = speakeasy.totp.verify({
      secret: user.mfaSecret,
      encoding: 'base32',
      token,
      window: 1,
    });

    if (!verified) {
      res.status(400).json({ error: 'Code TOTP invalide ou expiré' });
      return;
    }

    await prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: true },
    });

    res.json({ message: 'MFA activé avec succès. La double authentification est maintenant requise à chaque connexion.' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la confirmation MFA' });
  }
};

/**
 * POST /api/auth/mfa/validate
 * Valide le code TOTP lors de la connexion (2ème étape).
 */
export const validateMfa = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { userId, token } = req.body;

    if (!userId || !token) {
      res.status(400).json({ error: 'userId et token TOTP requis' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: parseInt(userId) } });
    if (!user || !user.mfaSecret || !user.mfaEnabled) {
      res.status(400).json({ error: 'MFA non activé pour cet utilisateur' });
      return;
    }

    const verified = speakeasy.totp.verify({
      secret: user.mfaSecret,
      encoding: 'base32',
      token,
      window: 1,
    });

    if (!verified) {
      res.status(401).json({ error: 'Code TOTP invalide ou expiré' });
      return;
    }

    // Générer le JWT final après validation MFA
    const jwt = await import('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET;
    if (!JWT_SECRET) throw new Error('JWT_SECRET environment variable is required');
    const jwtToken = jwt.default.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '1h' },
    );

    res.cookie('token', jwtToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 60 * 60 * 1000,
    });

    res.json({
      token: jwtToken,
      user: { id: user.id, email: user.email, role: user.role, nom: user.nom, prenom: user.prenom },
    });
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la validation MFA' });
  }
};

/**
 * DELETE /api/auth/mfa/disable
 * Désactive le MFA (admin ou utilisateur lui-même).
 */
export const disableMfa = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    await prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: false, mfaSecret: null },
    });
    res.json({ message: 'MFA désactivé' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la désactivation MFA' });
  }
};

import { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth.middleware';
import { logger } from '../services/logger';

const prisma = new PrismaClient();
const prismaAny = prisma as any;

// ─── GET /api/ged ─────────────────────────────────────────────────────────────
export const getAll = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { type, statut, hypothequeId, pretId, clientId, search, page = '1', limit = '20' } = req.query;

    const where: Record<string, unknown> = {};
    if (type) where.type = type;
    if (statut) where.statut = statut;
    if (hypothequeId) where.hypothequeId = parseInt(hypothequeId as string);
    if (pretId) where.pretId = parseInt(pretId as string);
    if (clientId) where.clientId = parseInt(clientId as string);
    if (search) where.titre = { contains: search as string, mode: 'insensitive' };

    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = Math.min(parseInt(limit as string) || 20, 500);

    const [total, documents] = await Promise.all([
      prismaAny.document.count({ where }),
      prismaAny.document.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          versions: {
            orderBy: { numeroVersion: 'desc' },
            take: 1,
            select: { fileName: true, taille: true, numeroVersion: true },
          },
          _count: { select: { versions: true } },
        },
      }),
    ]);

    const data = documents.map((doc: any) => ({
      ...doc,
      latestVersion: doc.versions[0] || null,
      totalVersions: doc._count.versions,
      _count: undefined,
      versions: undefined,
    }));

    res.json({
      data,
      pagination: {
        total,
        page: parseInt(page as string),
        limit: take,
        totalPages: Math.ceil(total / take),
      },
    });
  } catch (err) {
    logger.error('GED getAll error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ─── GET /api/ged/:id ─────────────────────────────────────────────────────────
export const getById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const doc = await prismaAny.document.findUnique({
      where: { id },
      include: {
        versions: {
          orderBy: { numeroVersion: 'desc' },
          select: { id: true, numeroVersion: true, fileName: true, mimeType: true, taille: true, commentaire: true, createdAt: true },
        },
        hypotheque: { select: { id: true, nomClient: true, numeroPret: true } },
        pret: { select: { id: true, numeroPret: true } },
        client: { select: { id: true, nom: true, codeClient: true } },
      },
    });

    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }
    res.json(doc);
  } catch (err) {
    logger.error('GED getById error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ─── POST /api/ged ────────────────────────────────────────────────────────────
export const upload = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const { titre, type, description, hypothequeId, pretId, clientId, tags, commentaire } = req.body;

    const doc = await prismaAny.document.create({
      data: {
        titre,
        type,
        description: description || null,
        hypothequeId: hypothequeId ? parseInt(hypothequeId) : null,
        pretId: pretId ? parseInt(pretId) : null,
        clientId: clientId ? parseInt(clientId) : null,
        tags: tags || null,
        versionActuelle: 1,
        versions: {
          create: {
            numeroVersion: 1,
            filePath: '',
            fileName: req.file.originalname,
            mimeType: req.file.mimetype,
            taille: req.file.size,
            fileContent: req.file.buffer,
            commentaire: commentaire || null,
            uploadedById: req.user!.id,
          },
        },
      },
      include: { versions: true },
    });

    res.status(201).json(doc);
  } catch (err) {
    logger.error('GED upload error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ─── POST /api/ged/:id/versions ───────────────────────────────────────────────
export const addVersion = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const id = parseInt(req.params.id);
    const doc = await prismaAny.document.findUnique({ where: { id } });
    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    const nextVersion = doc.versionActuelle + 1;
    const { commentaire } = req.body;

    const updated = await prismaAny.document.update({
      where: { id },
      data: {
        versionActuelle: nextVersion,
        versions: {
          create: {
            numeroVersion: nextVersion,
            filePath: '',
            fileName: req.file.originalname,
            mimeType: req.file.mimetype,
            taille: req.file.size,
            fileContent: req.file.buffer,
            commentaire: commentaire || null,
            uploadedById: req.user!.id,
          },
        },
      },
      include: { versions: { orderBy: { numeroVersion: 'desc' } } },
    });

    res.json(updated);
  } catch (err) {
    logger.error('GED addVersion error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ─── PUT /api/ged/:id/archive ─────────────────────────────────────────────────
export const archive = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const existing = await prismaAny.document.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    const doc = await prismaAny.document.update({
      where: { id },
      data: { statut: 'ARCHIVE' },
    });

    res.json(doc);
  } catch (err) {
    logger.error('GED archive error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ─── GET /api/ged/:id/download ────────────────────────────────────────────────
export const download = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const doc = await prismaAny.document.findUnique({
      where: { id },
      include: {
        versions: {
          orderBy: { numeroVersion: 'desc' },
          take: 1,
        },
      },
    });

    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    const latestVersion = doc.versions[0];
    if (!latestVersion) {
      res.status(404).json({ error: 'No version found for this document' });
      return;
    }

    if (!latestVersion.fileContent) {
      res.status(404).json({ error: 'File content not available' });
      return;
    }

    const safeFilename = (latestVersion.fileName ?? 'document')
      .replace(/[^\w.\-]/g, '_')
      .replace(/\s+/g, '_');
    res.set({
      'Content-Type': latestVersion.mimeType || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${safeFilename}"`,
      'Content-Length': latestVersion.fileContent.length,
    });
    res.send(latestVersion.fileContent);
  } catch (err) {
    logger.error('GED download error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ─── DELETE /api/ged/:id ─────────────────────────────────────────────────────
export const deleteDocument = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const existing = await prismaAny.document.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }
    await prismaAny.document.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    logger.error('GED delete error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ─── GET /api/ged/stats ───────────────────────────────────────────────────────
export const getStats = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [totalDocuments, totalVersions, byTypeRaw, recentDocuments, versionSizes] = await Promise.all([
      prismaAny.document.count(),
      prismaAny.documentVersion.count(),
      prismaAny.document.groupBy({ by: ['type'], _count: { id: true } }),
      prismaAny.document.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, titre: true, type: true, statut: true, createdAt: true },
      }),
      prismaAny.documentVersion.aggregate({ _sum: { taille: true } }),
    ]);

    const byType: Record<string, number> = {};
    for (const row of byTypeRaw) {
      byType[row.type] = row._count.id;
    }

    const totalSizeBytes = versionSizes._sum.taille || 0;
    const totalSizeMB = Math.round((totalSizeBytes / (1024 * 1024)) * 100) / 100;

    res.json({
      totalDocuments,
      byType,
      totalVersions,
      totalSizeMB,
      recentDocuments,
    });
  } catch (err) {
    logger.error('GED getStats error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

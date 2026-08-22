import { Response } from 'express';
import { PrismaClient, NatureBien, ZoneGeographique, StatutOccupation } from '@prisma/client';
import path from 'path';
import fs from 'fs';
import * as XLSX from 'xlsx';
import { AuthRequest } from '../middleware/auth.middleware';
import { calculerDecotes } from '../services/calcul.service';
import { logger } from '../services/logger';

const prisma = new PrismaClient();

// Enrich a hypotheque with computed fields + frontend-friendly aliases
function enrichHypotheque(h: Record<string, unknown>) {
  const decotes = calculerDecotes(
    h.valeurExpertiseInitiale as number,
    h.dateExpertise as Date,
    h.zoneGeographique as string,
    h.statutOccupation as string,
    h.soldePret as number,
    h.natureBien as string,
  );
  const ltv = decotes.loanToValue;
  const statut = decotes.hasShortfall
    ? 'SHORTFALL'
    : decotes.decoteAnciennete >= 100
    ? 'EXPERTISE_OBSOLETE'
    : decotes.decoteAnciennete >= 10
    ? 'ALERTE'
    : 'OK';
  return {
    ...h,
    ...decotes,
    // Frontend-friendly aliases
    vnc: decotes.valeurNetteCouverture,
    ltv,
    statut,
  };
}

export const getAll = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { client, search, zone, statut, alerte, page = '1', limit = '20' } = req.query;

    const where: Record<string, unknown> = {};

    const searchTerm = (client || search) as string | undefined;
    if (searchTerm) {
      where.OR = [
        { nomClient: { contains: searchTerm } },
        { codeClient: { contains: searchTerm } },
        { numeroPret: { contains: searchTerm } },
        { numeroTitreFoncier: { contains: searchTerm } },
        { ville: { contains: searchTerm } },
      ];
    }
    if (zone) where.zoneGeographique = zone;

    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = Math.min(parseInt(limit as string) || 20, 500);

    const allHypotheques = await prisma.hypotheque.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { alertes: { where: { lu: false } } },
    });

    let enriched = allHypotheques.map((h) => enrichHypotheque(h as unknown as Record<string, unknown>));

    // Post-enrichment filters (computed fields)
    if (statut) {
      enriched = enriched.filter((h) => (h as Record<string, unknown>).statut === statut);
    }
    if (alerte) {
      enriched = enriched.filter((h) =>
        ((h as Record<string, unknown>).alertes as Array<{ type: string }>)?.some((a) => a.type === alerte),
      );
    }

    const total = enriched.length;
    const paginated = enriched.slice(skip, skip + take);

    res.json({
      data: paginated,
      pagination: {
        total,
        page: parseInt(page as string),
        limit: take,
        totalPages: Math.ceil(total / take),
      },
    });
  } catch (err) {
    logger.error('getAll error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const h = await prisma.hypotheque.findUnique({
      where: { id },
      include: {
        alertes: { orderBy: { createdAt: 'desc' } },
        historique: { orderBy: { dateModification: 'desc' } },
      },
    });

    if (!h) {
      res.status(404).json({ error: 'Hypothèque not found' });
      return;
    }

    res.json(enrichHypotheque(h as unknown as Record<string, unknown>));
  } catch (err) {
    logger.error('getById error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const create = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      codeClient, nomClient, numeroPret, numeroTitreFoncier,
      natureBien, ville, quartier, lot, ilot, zoneGeographique,
      statutOccupation, valeurExpertiseInitiale, dateExpertise,
      montantInscription, rangHypotheque, datePeremptionInscription, soldePret,
      dateEcheancePret,
    } = req.body;

    const pjExpertisePath = req.file ? req.file.filename : undefined;

    const h = await prisma.hypotheque.create({
      data: {
        codeClient,
        nomClient,
        numeroPret,
        numeroTitreFoncier,
        natureBien,
        ville,
        quartier: quartier || null,
        lot: lot || null,
        ilot: ilot || null,
        zoneGeographique,
        statutOccupation,
        valeurExpertiseInitiale: parseFloat(valeurExpertiseInitiale),
        dateExpertise: new Date(dateExpertise),
        montantInscription: parseFloat(montantInscription),
        rangHypotheque: parseInt(rangHypotheque) || 1,
        datePeremptionInscription: new Date(datePeremptionInscription),
        soldePret: parseFloat(soldePret),
        dateEcheancePret: dateEcheancePret ? new Date(dateEcheancePret) : null,
        pjExpertisePath: pjExpertisePath || null,
      },
    });

    logger.info(`Hypothèque created: ${h.numeroPret} by ${req.user!.email}`);
    res.status(201).json(enrichHypotheque(h as unknown as Record<string, unknown>));
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('Unique constraint')) {
      res.status(409).json({ error: 'Numéro de prêt already exists' });
      return;
    }
    logger.error('create error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const update = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);

    const existing = await prisma.hypotheque.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'Hypothèque not found' });
      return;
    }

    const {
      codeClient, nomClient, nomClient: _nc, numeroPret, numeroTitreFoncier,
      natureBien, ville, quartier, lot, ilot, zoneGeographique,
      statutOccupation, valeurExpertiseInitiale, dateExpertise,
      montantInscription, rangHypotheque, datePeremptionInscription, soldePret,
      dateEcheancePret,
    } = req.body;

    const pjExpertisePath = req.file ? req.file.filename : existing.pjExpertisePath;

    const newValeur = valeurExpertiseInitiale != null ? parseFloat(valeurExpertiseInitiale) : Number(existing.valeurExpertiseInitiale);
    const newDate = dateExpertise ? new Date(dateExpertise) : existing.dateExpertise;
    const newZone = zoneGeographique ?? existing.zoneGeographique;
    const newStatut = statutOccupation ?? existing.statutOccupation;
    const newSolde = soldePret != null ? parseFloat(soldePret) : Number(existing.soldePret);

    const h = await prisma.hypotheque.update({
      where: { id },
      data: {
        codeClient: codeClient ?? existing.codeClient,
        nomClient: nomClient ?? existing.nomClient,
        numeroPret: numeroPret ?? existing.numeroPret,
        numeroTitreFoncier: numeroTitreFoncier ?? existing.numeroTitreFoncier,
        natureBien: natureBien ?? existing.natureBien,
        ville: ville ?? existing.ville,
        quartier: quartier !== undefined ? quartier || null : existing.quartier,
        lot: lot !== undefined ? lot || null : existing.lot,
        ilot: ilot !== undefined ? ilot || null : existing.ilot,
        zoneGeographique: newZone,
        statutOccupation: newStatut,
        valeurExpertiseInitiale: newValeur,
        dateExpertise: newDate,
        montantInscription: montantInscription != null ? parseFloat(montantInscription) : existing.montantInscription,
        rangHypotheque: rangHypotheque != null ? parseInt(rangHypotheque) : existing.rangHypotheque,
        datePeremptionInscription: datePeremptionInscription ? new Date(datePeremptionInscription) : existing.datePeremptionInscription,
        soldePret: newSolde,
        dateEcheancePret: dateEcheancePret ? new Date(dateEcheancePret) : (existing as Record<string, unknown>).dateEcheancePret as Date | null ?? null,
        pjExpertisePath,
      },
    });

    // Audit trail : enregistrer toute modification dans l'historique
    const decotesApres = calculerDecotes(newValeur, newDate, newZone, newStatut, newSolde, h.natureBien);
    await prisma.historiqueValeur.create({
      data: {
        hypothequeId: id,
        valeurExpertise: newValeur,
        dateExpertise: newDate,
        zoneGeographique: newZone,
        statutOccupation: newStatut,
        decoteZone: decotesApres.decoteZone,
        decoteAnciennete: decotesApres.decoteAnciennete,
        decoteOccupation: decotesApres.decoteOccupation,
        decoteTotale: decotesApres.decoteTotale,
        valeurNetteCouverture: decotesApres.valeurNetteCouverture,
        loanToValue: decotesApres.loanToValue,
        modifiePar: `${req.user!.prenom} ${req.user!.nom}`,
        motif: 'Modification système',
      },
    });

    logger.info(`Hypothèque updated: ${h.numeroPret} by ${req.user!.email}`);
    res.json(enrichHypotheque(h as unknown as Record<string, unknown>));
    void _nc;
  } catch (err) {
    logger.error('update error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const remove = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);

    const existing = await prisma.hypotheque.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'Hypothèque not found' });
      return;
    }

    // Delete associated file
    if (existing.pjExpertisePath) {
      const filePath = path.join(__dirname, '..', '..', 'uploads', existing.pjExpertisePath);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    await prisma.hypotheque.delete({ where: { id } });
    logger.info(`Hypothèque deleted: ${existing.numeroPret} by ${req.user!.email}`);
    res.json({ message: 'Hypothèque deleted successfully' });
  } catch (err) {
    logger.error('remove error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getHistorique = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const historique = await prisma.historiqueValeur.findMany({
      where: { hypothequeId: id },
      orderBy: { dateModification: 'desc' },
    });
    res.json(historique);
  } catch (err) {
    logger.error('getHistorique error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const reevaluer = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const { motif, nouvelleValeur, nouvelleDate, nouvelleZone, nouveauStatut } = req.body;

    const h = await prisma.hypotheque.findUnique({ where: { id } });
    if (!h) {
      res.status(404).json({ error: 'Hypothèque not found' });
      return;
    }

    const valeur = nouvelleValeur ? parseFloat(nouvelleValeur) : Number(h.valeurExpertiseInitiale);
    const date = nouvelleDate ? new Date(nouvelleDate) : h.dateExpertise;
    const zone = nouvelleZone || h.zoneGeographique;
    const statut = nouveauStatut || h.statutOccupation;

    const decotes = calculerDecotes(valeur, date, zone, statut, Number(h.soldePret), h.natureBien);

    // Save historical record
    const historique = await prisma.historiqueValeur.create({
      data: {
        hypothequeId: id,
        valeurExpertise: valeur,
        dateExpertise: date,
        zoneGeographique: zone,
        statutOccupation: statut,
        decoteZone: decotes.decoteZone,
        decoteAnciennete: decotes.decoteAnciennete,
        decoteOccupation: decotes.decoteOccupation,
        decoteTotale: decotes.decoteTotale,
        valeurNetteCouverture: decotes.valeurNetteCouverture,
        loanToValue: decotes.loanToValue,
        modifiePar: `${req.user!.prenom} ${req.user!.nom}`,
        motif: motif || null,
      },
    });

    // Update hypotheque
    const updated = await prisma.hypotheque.update({
      where: { id },
      data: {
        valeurExpertiseInitiale: valeur,
        dateExpertise: date,
        zoneGeographique: zone,
        statutOccupation: statut,
      },
    });

    logger.info(`Hypothèque re-evaluated: ${h.numeroPret} by ${req.user!.email}`);
    res.json({
      hypotheque: enrichHypotheque(updated as unknown as Record<string, unknown>),
      historique,
    });
  } catch (err) {
    logger.error('reevaluer error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const revaloriser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const { indiceRevalorisation, motif } = req.body;

    if (indiceRevalorisation == null || isNaN(parseFloat(indiceRevalorisation))) {
      res.status(400).json({ error: 'indiceRevalorisation (%) requis' });
      return;
    }

    const h = await prisma.hypotheque.findUnique({ where: { id } });
    if (!h) {
      res.status(404).json({ error: 'Hypothèque not found' });
      return;
    }

    const indice = parseFloat(indiceRevalorisation);
    const nouvelleValeur = Number(h.valeurExpertiseInitiale) * (1 + indice / 100);
    const decotes = calculerDecotes(nouvelleValeur, h.dateExpertise, h.zoneGeographique, h.statutOccupation, Number(h.soldePret), h.natureBien);

    const historique = await prisma.historiqueValeur.create({
      data: {
        hypothequeId: id,
        valeurExpertise: nouvelleValeur,
        dateExpertise: h.dateExpertise,
        zoneGeographique: h.zoneGeographique,
        statutOccupation: h.statutOccupation,
        decoteZone: decotes.decoteZone,
        decoteAnciennete: decotes.decoteAnciennete,
        decoteOccupation: decotes.decoteOccupation,
        decoteTotale: decotes.decoteTotale,
        valeurNetteCouverture: decotes.valeurNetteCouverture,
        loanToValue: decotes.loanToValue,
        modifiePar: `${req.user!.prenom} ${req.user!.nom}`,
        motif: motif || `Revalorisation par indice +${indice}%`,
      },
    });

    const updated = await prisma.hypotheque.update({
      where: { id },
      data: { valeurExpertiseInitiale: nouvelleValeur },
    });

    logger.info(`Hypothèque revaluated by index: ${h.numeroPret} +${indice}% by ${req.user!.email}`);
    res.json({
      hypotheque: enrichHypotheque(updated as unknown as Record<string, unknown>),
      indiceApplique: indice,
      ancienneValeur: h.valeurExpertiseInitiale,
      nouvelleValeur,
      historique,
    });
  } catch (err) {
    logger.error('revaloriser error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const importCSV = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file provided' });
      return;
    }

    const content = req.file.buffer.toString('utf-8');
    const lines = content.split('\n').filter((l) => l.trim());

    if (lines.length < 2) {
      res.status(400).json({ error: 'CSV file is empty or has no data rows' });
      return;
    }

    const headers = lines[0].split(';').map((h) => h.trim().replace(/^"|"$/g, ''));
    const results = { created: 0, errors: [] as string[] };

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(';').map((v) => v.trim().replace(/^"|"$/g, ''));
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => { row[h] = values[idx] || ''; });

      try {
        await prisma.hypotheque.create({
          data: {
            codeClient: row.codeClient,
            nomClient: row.nomClient,
            numeroPret: row.numeroPret,
            numeroTitreFoncier: row.numeroTitreFoncier,
            natureBien: row.natureBien as NatureBien,
            ville: row.ville,
            quartier: row.quartier || null,
            lot: row.lot || null,
            ilot: row.ilot || null,
            zoneGeographique: row.zoneGeographique as ZoneGeographique,
            statutOccupation: row.statutOccupation as StatutOccupation,
            valeurExpertiseInitiale: parseFloat(row.valeurExpertiseInitiale),
            dateExpertise: new Date(row.dateExpertise),
            montantInscription: parseFloat(row.montantInscription),
            rangHypotheque: parseInt(row.rangHypotheque) || 1,
            datePeremptionInscription: new Date(row.datePeremptionInscription),
            soldePret: parseFloat(row.soldePret),
          },
        });
        results.created++;
      } catch (err) {
        results.errors.push(`Row ${i + 1}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }

    logger.info(`CSV import: ${results.created} created, ${results.errors.length} errors`);
    res.json(results);
  } catch (err) {
    logger.error('importCSV error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const exportCsv = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { search, zone, statut } = req.query as Record<string, string>;

    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        { nomClient: { contains: search } },
        { codeClient: { contains: search } },
      ];
    }
    if (zone) where.zoneGeographique = `ZONE_${zone}`;
    if (statut) where.statutOccupation = statut;

    const hypotheques = await prisma.hypotheque.findMany({
      where,
      orderBy: [{ zoneGeographique: 'asc' }, { nomClient: 'asc' }],
      include: { alertes: { where: { lu: false } } },
    });

    const headers = [
      'Code Client', 'Nom Client', 'N° Prêt', 'Titre Foncier', 'Nature Bien',
      'Ville', 'Zone', 'Statut Occupation', 'Valeur Expertise (FCFA)', 'Date Expertise',
      'Décote Zone (%)', 'Décote Ancienneté (%)', 'Décote Occupation (%)', 'Décote Totale (%)',
      'VNC (FCFA)', 'Solde Prêt (FCFA)', 'LTV (%)', 'Montant Inscription (FCFA)',
      'Rang', 'Date Péremption', 'Statut', 'Alertes',
    ];

    const rows = hypotheques.map((h) => {
      const d = calculerDecotes(
        Number(h.valeurExpertiseInitiale), h.dateExpertise, h.zoneGeographique,
        h.statutOccupation, Number(h.soldePret), h.natureBien,
      );
      let statut = 'OK';
      if (d.hasShortfall) statut = 'SHORTFALL';
      else if (d.decoteAnciennete === 100) statut = 'EXPERTISE_EXPIREE';
      else if (d.loanToValue > 80) statut = 'RISQUE_ELEVE';
      else if (h.alertes.length > 0) statut = 'ALERTE';

      const alertTypes = [...new Set(h.alertes.map((a) => a.type))].join('|');

      return [
        h.codeClient, h.nomClient, h.numeroPret, h.numeroTitreFoncier, h.natureBien,
        h.ville, h.zoneGeographique, h.statutOccupation,
        h.valeurExpertiseInitiale.toString(), h.dateExpertise.toLocaleDateString('fr-FR'),
        d.decoteZone.toString(), d.decoteAnciennete.toString(), d.decoteOccupation.toString(),
        d.decoteTotale.toString(), Math.round(d.valeurNetteCouverture).toString(),
        h.soldePret.toString(), d.loanToValue.toFixed(2),
        h.montantInscription.toString(), h.rangHypotheque.toString(),
        h.datePeremptionInscription.toLocaleDateString('fr-FR'),
        statut, alertTypes,
      ].map((v) => `"${v}"`).join(';');
    });

    const csv = [headers.map((h) => `"${h}"`).join(';'), ...rows].join('\n');
    const filename = `hypotheques-${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('﻿' + csv);
  } catch (err) {
    logger.error('exportCsv error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const exportExcel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { search, zone, statut } = req.query as Record<string, string>;

    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        { nomClient: { contains: search } },
        { codeClient: { contains: search } },
      ];
    }
    if (zone) where.zoneGeographique = `ZONE_${zone}`;
    if (statut) where.statutOccupation = statut;

    const hypotheques = await prisma.hypotheque.findMany({
      where,
      orderBy: [{ zoneGeographique: 'asc' }, { nomClient: 'asc' }],
      include: { alertes: { where: { lu: false } } },
    });

    const sheetData = hypotheques.map((h) => {
      const d = calculerDecotes(
        Number(h.valeurExpertiseInitiale), h.dateExpertise, h.zoneGeographique,
        h.statutOccupation, Number(h.soldePret), h.natureBien,
      );
      let statutCalc = 'OK';
      if (d.hasShortfall) statutCalc = 'SHORTFALL';
      else if (d.decoteAnciennete === 100) statutCalc = 'EXPERTISE_EXPIREE';
      else if (d.loanToValue > 80) statutCalc = 'RISQUE_ELEVE';
      else if (h.alertes.length > 0) statutCalc = 'ALERTE';

      return {
        'Code Client': h.codeClient,
        'Nom Client': h.nomClient,
        'N° Prêt': h.numeroPret,
        'Titre Foncier': h.numeroTitreFoncier,
        'Nature Bien': h.natureBien,
        'Ville': h.ville,
        'Zone': h.zoneGeographique,
        'Statut Occupation': h.statutOccupation,
        'Valeur Expertise (FCFA)': h.valeurExpertiseInitiale,
        'Date Expertise': h.dateExpertise.toLocaleDateString('fr-FR'),
        'Décote Zone (%)': d.decoteZone,
        'Décote Ancienneté (%)': d.decoteAnciennete,
        'Décote Occupation (%)': d.decoteOccupation,
        'Décote Totale (%)': d.decoteTotale,
        'VNC (FCFA)': Math.round(d.valeurNetteCouverture),
        'Solde Prêt (FCFA)': h.soldePret,
        'LTV (%)': parseFloat(d.loanToValue.toFixed(2)),
        'Montant Inscription (FCFA)': h.montantInscription,
        'Rang': h.rangHypotheque,
        'Date Péremption': h.datePeremptionInscription.toLocaleDateString('fr-FR'),
        'Statut': statutCalc,
        'Alertes': [...new Set(h.alertes.map((a) => a.type))].join(', '),
      };
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(sheetData);

    // Column widths
    ws['!cols'] = [
      { wch: 14 }, { wch: 22 }, { wch: 20 }, { wch: 18 }, { wch: 16 },
      { wch: 14 }, { wch: 8 }, { wch: 20 }, { wch: 22 }, { wch: 14 },
      { wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 14 }, { wch: 16 },
      { wch: 18 }, { wch: 8 }, { wch: 22 }, { wch: 6 }, { wch: 16 },
      { wch: 16 }, { wch: 30 },
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Hypothèques');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filename = `hypotheques-${new Date().toISOString().slice(0, 10)}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    logger.error('exportExcel error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const downloadDocument = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    const h = await prisma.hypotheque.findUnique({ where: { id } });

    if (!h) {
      res.status(404).json({ error: 'Hypothèque not found' });
      return;
    }

    if (!h.pjExpertisePath) {
      res.status(404).json({ error: 'No document attached' });
      return;
    }

    const filePath = path.join(__dirname, '..', '..', 'uploads', h.pjExpertisePath);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Document file not found' });
      return;
    }

    res.download(filePath, `expertise-${h.numeroPret}${path.extname(h.pjExpertisePath)}`);
  } catch (err) {
    logger.error('downloadDocument error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

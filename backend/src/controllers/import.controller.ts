import { Response } from 'express';
import * as XLSX from 'xlsx';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth.middleware';
import { logger } from '../services/logger';

const prisma = new PrismaClient();
const prismaAny = prisma as any;

// ─── Types ────────────────────────────────────────────────────────────────────

interface ValidRow {
  rowIndex: number;
  data: Record<string, string | number>;
}

interface ErrorRow {
  rowIndex: number;
  errors: string[];
  data: Record<string, string>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Accepte DD/MM/YYYY ou YYYY-MM-DD */
function parseDate(val: string): Date | null {
  if (!val || !val.trim()) return null;
  const ddmmyyyy = /^(\d{2})\/(\d{2})\/(\d{4})$/;
  const match = val.trim().match(ddmmyyyy);
  if (match) {
    const [, d, m, y] = match;
    const date = new Date(`${y}-${m}-${d}T00:00:00.000Z`);
    return isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(val.trim());
  return isNaN(date.getTime()) ? null : date;
}

function isPositiveNumber(val: string): boolean {
  const n = parseFloat(val);
  return !isNaN(n) && n > 0;
}

function toNumber(val: string): number {
  return parseFloat(val);
}

// ─── Validation par type ──────────────────────────────────────────────────────

const NATURE_BIENS = ['TERRAIN_NU', 'VILLA', 'IMMEUBLE_RAPPORT', 'USINE', 'BUREAU'];
const ZONES = ['ZONE_A', 'ZONE_B', 'ZONE_C', 'ZONE_INDUSTRIELLE'];
const STATUTS_OCC = ['LIBRE', 'OCCUPE_PROPRIETAIRE', 'LOUE_AVEC_BAIL'];
const TYPE_CLIENTS = ['PARTICULIER', 'ENTREPRISE'];
const TYPE_AMORTS = ['LINEAIRE', 'CONSTANT', 'IN_FINE'];

function validateHypothequeRow(
  row: Record<string, string>,
  rowIndex: number,
): ValidRow | ErrorRow {
  const errors: string[] = [];

  if (!row.codeClient?.trim()) errors.push('codeClient requis');
  if (!row.nomClient?.trim()) errors.push('nomClient requis');
  if (!row.numeroPret?.trim()) errors.push('numeroPret requis');
  if (!row.numeroTitreFoncier?.trim()) errors.push('numeroTitreFoncier requis');

  if (!row.natureBien?.trim()) {
    errors.push('natureBien requis');
  } else if (!NATURE_BIENS.includes(row.natureBien.trim())) {
    errors.push(`natureBien invalide — valeurs: ${NATURE_BIENS.join(' | ')}`);
  }

  if (!row.ville?.trim()) errors.push('ville requis');

  if (!row.zoneGeographique?.trim()) {
    errors.push('zoneGeographique requis');
  } else if (!ZONES.includes(row.zoneGeographique.trim())) {
    errors.push(`zoneGeographique invalide — valeurs: ${ZONES.join(' | ')}`);
  }

  if (!row.statutOccupation?.trim()) {
    errors.push('statutOccupation requis');
  } else if (!STATUTS_OCC.includes(row.statutOccupation.trim())) {
    errors.push(`statutOccupation invalide — valeurs: ${STATUTS_OCC.join(' | ')}`);
  }

  if (!row.valeurExpertiseInitiale?.trim()) {
    errors.push('valeurExpertiseInitiale requis');
  } else if (!isPositiveNumber(row.valeurExpertiseInitiale)) {
    errors.push('valeurExpertiseInitiale doit être un nombre positif');
  }

  if (!row.dateExpertise?.trim()) {
    errors.push('dateExpertise requis');
  } else if (!parseDate(row.dateExpertise)) {
    errors.push('dateExpertise format invalide (DD/MM/YYYY ou YYYY-MM-DD)');
  }

  if (!row.montantInscription?.trim()) {
    errors.push('montantInscription requis');
  } else if (!isPositiveNumber(row.montantInscription)) {
    errors.push('montantInscription doit être un nombre positif');
  }

  if (!row.datePeremptionInscription?.trim()) {
    errors.push('datePeremptionInscription requis');
  } else if (!parseDate(row.datePeremptionInscription)) {
    errors.push('datePeremptionInscription format invalide (DD/MM/YYYY ou YYYY-MM-DD)');
  }

  if (!row.soldePret?.trim()) {
    errors.push('soldePret requis');
  } else if (!isPositiveNumber(row.soldePret)) {
    errors.push('soldePret doit être un nombre positif');
  }

  if (errors.length > 0) return { rowIndex, errors, data: row };

  const data: Record<string, string | number> = {
    codeClient: row.codeClient.trim(),
    nomClient: row.nomClient.trim(),
    numeroPret: row.numeroPret.trim(),
    numeroTitreFoncier: row.numeroTitreFoncier.trim(),
    natureBien: row.natureBien.trim(),
    ville: row.ville.trim(),
    zoneGeographique: row.zoneGeographique.trim(),
    statutOccupation: row.statutOccupation.trim(),
    valeurExpertiseInitiale: toNumber(row.valeurExpertiseInitiale),
    dateExpertise: parseDate(row.dateExpertise)!.toISOString(),
    montantInscription: toNumber(row.montantInscription),
    datePeremptionInscription: parseDate(row.datePeremptionInscription)!.toISOString(),
    soldePret: toNumber(row.soldePret),
    rangHypotheque: row.rangHypotheque?.trim() ? parseInt(row.rangHypotheque) || 1 : 1,
  };

  if (row.quartier?.trim()) data.quartier = row.quartier.trim();
  if (row.lot?.trim()) data.lot = row.lot.trim();
  if (row.ilot?.trim()) data.ilot = row.ilot.trim();
  if (row.dateEcheancePret?.trim()) {
    const d = parseDate(row.dateEcheancePret);
    if (d) data.dateEcheancePret = d.toISOString();
  }
  if (row.latitude?.trim()) {
    const lat = parseFloat(row.latitude);
    if (!isNaN(lat)) data.latitude = lat;
  }
  if (row.longitude?.trim()) {
    const lon = parseFloat(row.longitude);
    if (!isNaN(lon)) data.longitude = lon;
  }

  return { rowIndex, data };
}

function validateClientRow(
  row: Record<string, string>,
  rowIndex: number,
  seenCodes: Set<string>,
): ValidRow | ErrorRow {
  const errors: string[] = [];

  if (!row.codeClient?.trim()) {
    errors.push('codeClient requis');
  } else if (seenCodes.has(row.codeClient.trim())) {
    errors.push(`codeClient "${row.codeClient.trim()}" dupliqué dans le fichier`);
  } else {
    seenCodes.add(row.codeClient.trim());
  }

  if (!row.nom?.trim()) errors.push('nom requis');

  if (!row.typeClient?.trim()) {
    errors.push('typeClient requis');
  } else if (!TYPE_CLIENTS.includes(row.typeClient.trim())) {
    errors.push(`typeClient invalide — valeurs: ${TYPE_CLIENTS.join(' | ')}`);
  }

  if (errors.length > 0) return { rowIndex, errors, data: row };

  const data: Record<string, string | number> = {
    codeClient: row.codeClient.trim(),
    nom: row.nom.trim(),
    typeClient: row.typeClient.trim(),
  };

  if (row.prenom?.trim()) data.prenom = row.prenom.trim();
  if (row.raisonSociale?.trim()) data.raisonSociale = row.raisonSociale.trim();
  if (row.telephone?.trim()) data.telephone = row.telephone.trim();
  if (row.email?.trim()) data.email = row.email.trim();
  if (row.adresse?.trim()) data.adresse = row.adresse.trim();
  if (row.ville?.trim()) data.ville = row.ville.trim();
  if (row.dateNaissance?.trim()) {
    const d = parseDate(row.dateNaissance);
    if (d) data.dateNaissance = d.toISOString();
  }

  return { rowIndex, data };
}

async function validatePretRow(
  row: Record<string, string>,
  rowIndex: number,
  seenNums: Set<string>,
): Promise<ValidRow | ErrorRow> {
  const errors: string[] = [];

  if (!row.numeroPret?.trim()) {
    errors.push('numeroPret requis');
  } else if (seenNums.has(row.numeroPret.trim())) {
    errors.push(`numeroPret "${row.numeroPret.trim()}" dupliqué dans le fichier`);
  } else {
    seenNums.add(row.numeroPret.trim());
  }

  if (!row.codeClient?.trim()) errors.push('codeClient requis');

  if (!row.montant?.trim()) {
    errors.push('montant requis');
  } else if (!isPositiveNumber(row.montant)) {
    errors.push('montant doit être un nombre positif');
  }

  if (!row.typeAmortissement?.trim()) {
    errors.push('typeAmortissement requis');
  } else if (!TYPE_AMORTS.includes(row.typeAmortissement.trim())) {
    errors.push(`typeAmortissement invalide — valeurs: ${TYPE_AMORTS.join(' | ')}`);
  }

  if (!row.tauxInteret?.trim()) {
    errors.push('tauxInteret requis');
  } else {
    const t = parseFloat(row.tauxInteret);
    if (isNaN(t) || t < 0 || t > 100)
      errors.push('tauxInteret doit être compris entre 0 et 100');
  }

  if (!row.duree?.trim()) {
    errors.push('duree requis (en mois)');
  } else {
    const d = parseInt(row.duree);
    if (isNaN(d) || d <= 0) errors.push('duree doit être un entier positif (en mois)');
  }

  if (!row.dateDebut?.trim()) {
    errors.push('dateDebut requis');
  } else if (!parseDate(row.dateDebut)) {
    errors.push('dateDebut format invalide (DD/MM/YYYY ou YYYY-MM-DD)');
  }

  // Vérif client en base
  if (row.codeClient?.trim() && !errors.some((e) => e.startsWith('codeClient'))) {
    const client = await prisma.client.findFirst({
      where: { codeClient: row.codeClient.trim() },
    });
    if (!client) {
      errors.push(`Client "${row.codeClient.trim()}" introuvable en base de données`);
    }
  }

  if (errors.length > 0) return { rowIndex, errors, data: row };

  const dateDebut = parseDate(row.dateDebut)!;
  const dureeMois = parseInt(row.duree);
  const dateFin = new Date(dateDebut);
  dateFin.setMonth(dateFin.getMonth() + dureeMois);

  const data: Record<string, string | number> = {
    numeroPret: row.numeroPret.trim(),
    codeClient: row.codeClient.trim(),
    montantInitial: toNumber(row.montant),
    montantRestant: toNumber(row.montant),
    tauxInteret: parseFloat(row.tauxInteret),
    dureeMois,
    typeAmortissement: row.typeAmortissement.trim(),
    dateDebut: dateDebut.toISOString(),
    dateFin: dateFin.toISOString(),
    statut: row.statut?.trim() || 'ACTIF',
  };

  if (row.objet?.trim()) data.objet = row.objet.trim();

  return { rowIndex, data };
}

// ─── Controllers ──────────────────────────────────────────────────────────────

/** POST /api/import/preview */
export const previewImport = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Fichier requis (champ: file)' });
      return;
    }

    const type = req.body.type as string;
    if (!['hypotheques', 'clients', 'prets'].includes(type)) {
      res.status(400).json({ error: 'type invalide — attendu: hypotheques | clients | prets' });
      return;
    }

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, {
      raw: false,
      defval: '',
    });

    if (rows.length === 0) {
      res.status(400).json({ error: 'Le fichier ne contient aucune ligne de données' });
      return;
    }

    const valid: ValidRow[] = [];
    const errors: ErrorRow[] = [];

    if (type === 'hypotheques') {
      for (let i = 0; i < rows.length; i++) {
        const result = validateHypothequeRow(rows[i], i + 2);
        if ('errors' in result) errors.push(result);
        else valid.push(result);
      }
    } else if (type === 'clients') {
      const seenCodes = new Set<string>();
      for (let i = 0; i < rows.length; i++) {
        const result = validateClientRow(rows[i], i + 2, seenCodes);
        if ('errors' in result) errors.push(result);
        else valid.push(result);
      }
    } else if (type === 'prets') {
      const seenNums = new Set<string>();
      for (let i = 0; i < rows.length; i++) {
        const result = await validatePretRow(rows[i], i + 2, seenNums);
        if ('errors' in result) errors.push(result);
        else valid.push(result);
      }
    }

    res.json({
      valid,
      errors,
      total: rows.length,
      validCount: valid.length,
      errorCount: errors.length,
    });
  } catch (err) {
    logger.error('import.previewImport error:', err);
    res.status(500).json({ error: "Erreur lors de l'analyse du fichier" });
  }
};

const ALLOWED_IMPORT_TYPES = ['hypotheques', 'clients', 'prets'] as const;

/** POST /api/import/confirm */
export const confirmImport = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { type, rows } = req.body as { type: string; rows: ValidRow[] };

    if (!type || !rows || !Array.isArray(rows)) {
      res.status(400).json({ error: 'type et rows requis' });
      return;
    }

    if (!ALLOWED_IMPORT_TYPES.includes(type as typeof ALLOWED_IMPORT_TYPES[number])) {
      res.status(400).json({ error: `type invalide — valeurs: ${ALLOWED_IMPORT_TYPES.join(', ')}` });
      return;
    }

    // Re-validate row structure: each row must have rowIndex (number) and data (object)
    for (const row of rows) {
      if (typeof row.rowIndex !== 'number' || typeof row.data !== 'object' || row.data === null) {
        res.status(400).json({ error: 'Structure de lignes invalide' });
        return;
      }
    }

    // Re-validate enum fields to prevent bypass of preview validation
    if (type === 'hypotheques') {
      for (const row of rows) {
        const d = row.data;
        if (d.natureBien && !NATURE_BIENS.includes(String(d.natureBien))) {
          res.status(400).json({ error: `natureBien invalide: ${d.natureBien}` });
          return;
        }
        if (d.zoneGeographique && !ZONES.includes(String(d.zoneGeographique))) {
          res.status(400).json({ error: `zoneGeographique invalide: ${d.zoneGeographique}` });
          return;
        }
        if (d.statutOccupation && !STATUTS_OCC.includes(String(d.statutOccupation))) {
          res.status(400).json({ error: `statutOccupation invalide: ${d.statutOccupation}` });
          return;
        }
      }
    }

    if (rows.length === 0) {
      res.json({ inserted: 0, skipped: 0 });
      return;
    }

    let inserted = 0;
    let skipped = 0;

    if (type === 'hypotheques') {
      const data = rows.map((r) => ({
        codeClient: r.data.codeClient as string,
        nomClient: r.data.nomClient as string,
        numeroPret: r.data.numeroPret as string,
        numeroTitreFoncier: r.data.numeroTitreFoncier as string,
        natureBien: r.data.natureBien as any,
        ville: r.data.ville as string,
        quartier: (r.data.quartier as string) || null,
        lot: (r.data.lot as string) || null,
        ilot: (r.data.ilot as string) || null,
        zoneGeographique: r.data.zoneGeographique as any,
        statutOccupation: r.data.statutOccupation as any,
        valeurExpertiseInitiale: r.data.valeurExpertiseInitiale as number,
        dateExpertise: new Date(r.data.dateExpertise as string),
        montantInscription: r.data.montantInscription as number,
        rangHypotheque: (r.data.rangHypotheque as number) || 1,
        datePeremptionInscription: new Date(r.data.datePeremptionInscription as string),
        soldePret: r.data.soldePret as number,
        dateEcheancePret: r.data.dateEcheancePret
          ? new Date(r.data.dateEcheancePret as string)
          : null,
        latitude: r.data.latitude != null ? (r.data.latitude as number) : null,
        longitude: r.data.longitude != null ? (r.data.longitude as number) : null,
      }));

      const result = await prisma.hypotheque.createMany({ data, skipDuplicates: true });
      inserted = result.count;
      skipped = rows.length - inserted;
    } else if (type === 'clients') {
      const data = rows.map((r) => ({
        codeClient: r.data.codeClient as string,
        nom: r.data.nom as string,
        typeClient: r.data.typeClient as any,
        prenom: (r.data.prenom as string) || null,
        raisonSociale: (r.data.raisonSociale as string) || null,
        telephone: (r.data.telephone as string) || null,
        email: (r.data.email as string) || null,
        adresse: (r.data.adresse as string) || null,
        ville: (r.data.ville as string) || null,
        dateNaissance: r.data.dateNaissance ? new Date(r.data.dateNaissance as string) : null,
        statut: 'ACTIF' as any,
      }));

      const result = await prisma.client.createMany({ data, skipDuplicates: true });
      inserted = result.count;
      skipped = rows.length - inserted;
    } else if (type === 'prets') {
      for (const row of rows) {
        try {
          const client = await prisma.client.findFirst({
            where: { codeClient: row.data.codeClient as string },
          });
          if (!client) {
            skipped++;
            continue;
          }

          const existing = await prisma.pret.findFirst({
            where: { numeroPret: row.data.numeroPret as string },
          });
          if (existing) {
            skipped++;
            continue;
          }

          await prisma.pret.create({
            data: {
              numeroPret: row.data.numeroPret as string,
              clientId: client.id,
              montantInitial: row.data.montantInitial as number,
              montantRestant: row.data.montantRestant as number,
              tauxInteret: row.data.tauxInteret as number,
              dureeMois: row.data.dureeMois as number,
              typeAmortissement: row.data.typeAmortissement as any,
              dateDebut: new Date(row.data.dateDebut as string),
              dateFin: new Date(row.data.dateFin as string),
              statut: (row.data.statut as any) || 'ACTIF',
              objet: (row.data.objet as string) || null,
            },
          });
          inserted++;
        } catch (rowErr) {
          logger.error('import.confirmImport — pret row error:', rowErr);
          skipped++;
        }
      }
    }

    // Audit log
    try {
      await prismaAny.auditLog.create({
        data: {
          userId: req.user?.id ?? null,
          action: 'CREATE',
          entite: type,
          details: JSON.stringify({ count: inserted }),
          ip: req.ip ?? null,
          userAgent: req.headers['user-agent'] ?? null,
        },
      });
    } catch (auditErr) {
      logger.error('import.confirmImport — audit log error:', auditErr);
    }

    res.json({ inserted, skipped });
  } catch (err) {
    logger.error('import.confirmImport error:', err);
    res.status(500).json({ error: "Erreur lors de l'import" });
  }
};

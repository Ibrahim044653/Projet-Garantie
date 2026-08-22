'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
} from 'recharts';
import { useAuth } from '@/contexts/AuthContext';
import { biApi } from '@/lib/api';

// ─── Types ───────────────────────────────────────────────────────────────────

interface KpiValue {
  valeur: number;
  delta?: number;
  deltaPct?: number;
}

interface BiOverview {
  vncTotale: KpiValue;
  encoursTotale: KpiValue;
  tauxCouverture: KpiValue;
  expectedLoss: KpiValue;
  tendances: Array<{ mois: string; vnc: number; encours: number }>;
  classifications: Array<{ name: string; value: number }>;
  zones: Array<{
    zone: string;
    hypotheques: number;
    encours: number;
    vnc: number;
    tauxCouverture: number;
    shortfalls: number;
  }>;
  top5Risques: Array<{
    id: number;
    client: string;
    ltv: number;
    classification: string;
    ead: number;
    provision: number;
  }>;
}

interface BiKpi {
  label: string;
  valeur: number | string;
  unite?: string;
  couleur?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const CLASS_COLORS: Record<string, string> = {
  SAIN:              '#22c55e',
  SOUS_SURVEILLANCE: '#eab308',
  DOUTEUX:           '#f97316',
  CONTENTIEUX:       '#ef4444',
};

const CLASS_LABELS: Record<string, string> = {
  SAIN:              'Sain',
  SOUS_SURVEILLANCE: 'Sous surveillance',
  DOUTEUX:           'Douteux',
  CONTENTIEUX:       'Contentieux',
};

const CLASS_BADGE: Record<string, string> = {
  SAIN:              'bg-green-100 text-green-700',
  SOUS_SURVEILLANCE: 'bg-yellow-100 text-yellow-700',
  DOUTEUX:           'bg-orange-100 text-orange-700',
  CONTENTIEUX:       'bg-red-100 text-red-700',
};

function fmtM(n: number): string {
  return (n / 1e6).toFixed(1) + ' M FCFA';
}

function fmtPct(n: number): string {
  return n?.toFixed(1) + ' %';
}

function fmtExact(n: number): string {
  return new Intl.NumberFormat('fr-FR').format(n) + ' F';
}

function DeltaBadge({ delta, pct, unit = '' }: { delta?: number; pct?: number; unit?: string }) {
  if (delta === undefined && pct === undefined) return null;
  const positive = (delta ?? pct ?? 0) >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${positive ? 'text-green-600' : 'text-red-600'}`}>
      {positive ? '↑' : '↓'}
      {pct !== undefined
        ? Math.abs(pct).toFixed(1) + '%'
        : fmtM(Math.abs(delta ?? 0)) + (unit ? ` ${unit}` : '')}
    </span>
  );
}

const Spinner = () => (
  <div className="flex items-center justify-center h-64">
    <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
  </div>
);

// ─── Export PPTX ─────────────────────────────────────────────────────────────

async function exportPPTX(overview: BiOverview | null) {
  try {
    const PptxGenJS = (await import('pptxgenjs')).default;
    const pptx = new PptxGenJS();

    // Slide 1 — Title
    const slide1 = pptx.addSlide();
    slide1.addText('Comité de Crédit — Tableau de bord BI', {
      x: 0.5, y: 1.5, w: 9, h: 1.5,
      fontSize: 28, bold: true, color: '1e3a5f',
    });
    slide1.addText(`Généré le ${new Date().toLocaleDateString('fr-FR')}`, {
      x: 0.5, y: 3.2, w: 9, h: 0.5,
      fontSize: 14, color: '64748b',
    });

    // Slide 2 — KPI table
    const slide2 = pptx.addSlide();
    slide2.addText('Indicateurs clés', { x: 0.5, y: 0.3, w: 9, h: 0.6, fontSize: 20, bold: true, color: '1e3a5f' });
    if (overview) {
      const rows = [
        ['Indicateur', 'Valeur'],
        ['VNC Totale', fmtM(overview.vncTotale.valeur)],
        ['Encours Total', fmtM(overview.encoursTotale.valeur)],
        ['Taux de couverture', fmtPct(overview.tauxCouverture.valeur)],
        ['Expected Loss', fmtM(overview.expectedLoss.valeur)],
      ];
      slide2.addTable(rows as Parameters<typeof slide2.addTable>[0], {
        x: 0.5, y: 1.2, w: 9,
        colW: [4.5, 4.5],
        border: { type: 'solid', color: 'e2e8f0', pt: 1 },
        fill: { color: 'f8fafc' },
      });
    }

    // Slide 3 — Chart placeholder
    const slide3 = pptx.addSlide();
    slide3.addText('Évolution VNC — Graphique', { x: 0.5, y: 0.3, w: 9, h: 0.6, fontSize: 20, bold: true, color: '1e3a5f' });
    slide3.addText('[Insérer graphique LineChart depuis le tableau de bord]', {
      x: 0.5, y: 2, w: 9, h: 2,
      fontSize: 14, color: '94a3b8', italic: true, align: 'center',
    });

    // Use arraybuffer + manual download link — more reliable than writeFile in Next.js
    const buffer = await pptx.write({ outputType: 'arraybuffer' }) as ArrayBuffer;
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'comite-credit.pptx';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    alert('Erreur export PowerPoint : ' + msg);
  }
}

// ─── Period selector ──────────────────────────────────────────────────────────

type Period = 'mois' | 't3' | 'annee' | 'custom';
const PERIOD_LABELS: Record<Period, string> = {
  mois:   'Ce mois',
  t3:     'T3 2026',
  annee:  'Année 2026',
  custom: 'Personnalisé',
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BiPage() {
  const { user } = useAuth();
  const [overview, setOverview] = useState<BiOverview | null>(null);
  const [kpis, setKpis] = useState<BiKpi[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [period, setPeriod] = useState<Period>('mois');
  const [exporting, setExporting] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [ovRes, kpisRes] = await Promise.all([
        biApi.overview(),
        biApi.kpis(),
      ]);

      // API retourne { kpis:{encours,vncTotale,...}, tendances, byZone, classifications, topRisques }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw: any = ovRes.data?.data ?? ovRes.data ?? {};
      const k = raw.kpis ?? {};
      const transformed: BiOverview = {
        vncTotale:      { valeur: Number(k.vncTotale ?? 0),       deltaPct: Number(k.vncGrowthPct ?? 0) },
        encoursTotale:  { valeur: Number(k.encours ?? 0),         deltaPct: Number(k.encoursGrowthPct ?? 0) },
        tauxCouverture: { valeur: Number(k.tauxCouverture ?? 0) },
        expectedLoss:   { valeur: Number(k.provisionsTotal ?? 0) },
        tendances:  (raw.tendances ?? []).map((t: any) => ({ mois: t.mois, vnc: Number(t.vnc), encours: Number(t.encours) })),
        classifications: Object.entries(raw.classifications ?? {}).map(([name, value]) => ({ name, value: Number(value) })),
        zones: (raw.byZone ?? []).map((z: any) => ({
          zone: z.zone,
          hypotheques: z.count ?? 0,
          encours: Number(z.encours ?? 0),
          vnc: Number(z.vnc ?? 0),
          tauxCouverture: Number(z.tauxCouverture ?? 0),
          shortfalls: z.shortfalls ?? 0,
        })),
        top5Risques: (raw.topRisques ?? []).map((r: any) => ({
          id: r.hypothequeId,
          client: r.nomClient ?? '—',
          ltv: Number(r.ltv ?? 0),
          classification: r.classification ?? '',
          ead: Number(r.ead ?? 0),
          provision: Number(r.provision ?? 0),
        })),
      };
      setOverview(transformed);

      // API retourne { role, kpis: { totalHypotheques, ... } }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const kpisRaw: any = kpisRes.data?.data ?? kpisRes.data ?? {};
      const kpisObj = kpisRaw.kpis ?? {};
      const LABEL_MAP: Record<string, string> = {
        totalHypotheques: 'Hypothèques', totalClients: 'Clients', totalPrets: 'Prêts',
        alertesNonLues: 'Alertes non lues', workflowPending: 'Workflow en attente',
        shortfallsCount: 'Shortfalls', tauxCouverture: 'Taux de couverture',
        provisionsTotal: 'Provisions totales', douteux: 'Douteux', contentieux: 'Contentieux',
        newHypotheques: 'Nouvelles hypothèques', documentsUploaded: 'Documents uploadés',
        impayes: 'Impayés', encoursTotalM: 'Encours (M FCFA)',
        inscriptionsPerimees: 'Inscriptions périmées', expertisesAnciennes: 'Expertises > 5 ans',
      };
      const kpisArray: BiKpi[] = Object.entries(kpisObj)
        .filter(([, val]) => typeof val !== 'object' || val === null)
        .map(([key, val]) => ({
          label: LABEL_MAP[key] ?? key,
          valeur: val as number | string,
        }));
      setKpis(kpisArray);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string; error?: string } } })?.response?.data?.message
        || (err as { response?: { data?: { message?: string; error?: string } } })?.response?.data?.error
        || (err instanceof Error ? err.message : 'Impossible de charger le tableau de bord BI.');
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function handleExport() {
    setExporting(true);
    try {
      await exportPPTX(overview);
    } finally {
      setExporting(false);
    }
  }

  if (loading) return <Spinner />;
  if (error) return (
    <div className="flex items-center justify-center h-64 text-red-600 text-sm">{error}</div>
  );

  const tendances = overview?.tendances?.map(t => ({
    ...t,
    vncM: +(t.vnc / 1e6).toFixed(2),
    encoursM: +(t.encours / 1e6).toFixed(2),
  })) ?? [];

  const pieData = overview?.classifications ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Tableau de bord BI</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Analyse avancée · Comparaison inter-périodes · Export comité
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Period selector */}
          <div className="flex gap-1 bg-slate-100 p-1 rounded-xl">
            {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
                  period === p
                    ? 'bg-white text-slate-800 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>

          <button
            onClick={handleExport}
            disabled={exporting}
            className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-60"
          >
            {exporting ? 'Export...' : 'Exporter PowerPoint'}
          </button>
        </div>
      </div>

      {/* KPI row */}
      {overview && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            {
              label: 'VNC Totale',
              value: fmtM(overview.vncTotale.valeur),
              delta: overview.vncTotale.delta,
              pct: overview.vncTotale.deltaPct,
              color: 'text-blue-600',
            },
            {
              label: 'Encours Total',
              value: fmtM(overview.encoursTotale.valeur),
              delta: overview.encoursTotale.delta,
              pct: overview.encoursTotale.deltaPct,
              color: 'text-slate-800',
            },
            {
              label: 'Taux de couverture',
              value: fmtPct(overview.tauxCouverture.valeur),
              delta: overview.tauxCouverture.delta,
              pct: overview.tauxCouverture.deltaPct,
              color: 'text-green-600',
            },
            {
              label: 'Expected Loss',
              value: fmtM(overview.expectedLoss.valeur),
              delta: overview.expectedLoss.delta,
              pct: overview.expectedLoss.deltaPct,
              color: 'text-red-600',
            },
          ].map(kpi => (
            <div key={kpi.label} className="bg-white rounded-xl shadow-sm p-5 border border-slate-100">
              <p className="text-xs text-slate-500 uppercase tracking-wide font-semibold">{kpi.label}</p>
              <p className={`text-xl font-bold mt-1 ${kpi.color}`}>{kpi.value}</p>
              <div className="mt-1">
                <DeltaBadge delta={kpi.delta} pct={kpi.pct} />
                {(kpi.delta !== undefined || kpi.pct !== undefined) && (
                  <span className="text-xs text-slate-400 ml-1">vs mois préc.</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Two-column layout */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        {/* LineChart — 2/3 */}
        <div className="col-span-3 lg:col-span-2 bg-white rounded-xl shadow-sm border border-slate-100 p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">Évolution VNC 24 mois</h2>
          {tendances.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-slate-400 text-sm">Aucune donnée de tendance disponible.</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={tendances} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="mois" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 11, fill: '#94a3b8' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => `${v}M`}
                />
                <Tooltip
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(value: any, name: any) => [
                    `${Number(value).toFixed(1)} M FCFA`,
                    name === 'vncM' ? 'VNC' : 'Encours',
                  ]}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                />
                <Legend
                  formatter={(value: string) => value === 'vncM' ? 'VNC' : 'Encours'}
                  wrapperStyle={{ fontSize: 12 }}
                />
                <Line type="monotone" dataKey="vncM" stroke="#2563eb" strokeWidth={2} dot={false} name="vncM" />
                <Line type="monotone" dataKey="encoursM" stroke="#94a3b8" strokeWidth={2} dot={false} name="encoursM" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* PieChart — 1/3 */}
        <div className="col-span-3 lg:col-span-1 bg-white rounded-xl shadow-sm border border-slate-100 p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">Classification des hypothèques</h2>
          {pieData.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-slate-400 text-sm">Aucune donnée.</div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={CLASS_COLORS[entry.name] ?? '#94a3b8'}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    formatter={(value: any, name: any) => [value, CLASS_LABELS[name as string] ?? name]}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                  />
                </PieChart>
              </ResponsiveContainer>

              <div className="space-y-1.5 mt-2">
                {pieData.map(entry => (
                  <div key={entry.name} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ background: CLASS_COLORS[entry.name] ?? '#94a3b8' }}
                      />
                      <span className="text-slate-600">{CLASS_LABELS[entry.name] ?? entry.name}</span>
                    </div>
                    <span className="font-semibold text-slate-800">{entry.value}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* By Zone table */}
      {overview?.zones && overview.zones.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-700">Performance par zone géographique</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-slate-500 text-xs uppercase">
                  <th className="text-left px-5 py-3 font-semibold">Zone</th>
                  <th className="text-right px-5 py-3 font-semibold">Hypothèques</th>
                  <th className="text-right px-5 py-3 font-semibold">Encours</th>
                  <th className="text-right px-5 py-3 font-semibold">VNC</th>
                  <th className="text-center px-5 py-3 font-semibold">Taux couverture</th>
                  <th className="text-right px-5 py-3 font-semibold">Shortfalls</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {overview.zones.map(z => {
                  const pct = Math.min(100, Math.round(z.tauxCouverture));
                  const barColor = pct >= 80 ? 'bg-green-500' : pct >= 60 ? 'bg-amber-500' : 'bg-red-500';
                  return (
                    <tr key={z.zone} className="hover:bg-slate-50">
                      <td className="px-5 py-3 font-semibold text-slate-800">{z.zone}</td>
                      <td className="px-5 py-3 text-right text-slate-600">{z.hypotheques}</td>
                      <td className="px-5 py-3 text-right text-slate-600">{fmtM(z.encours)}</td>
                      <td className="px-5 py-3 text-right font-medium text-slate-800">{fmtM(z.vnc)}</td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${barColor}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className={`text-xs font-semibold w-12 text-right ${
                            pct >= 80 ? 'text-green-600' : pct >= 60 ? 'text-amber-600' : 'text-red-600'
                          }`}>
                            {fmtPct(z.tauxCouverture)}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-right">
                        {z.shortfalls > 0 ? (
                          <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-bold">
                            {z.shortfalls}
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Top 5 Risques */}
      {overview?.top5Risques && overview.top5Risques.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-700">Top 5 — Hypothèques à risque élevé (LTV)</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-slate-500 text-xs uppercase">
                  <th className="text-left px-5 py-3 font-semibold">Client</th>
                  <th className="text-center px-5 py-3 font-semibold">LTV</th>
                  <th className="text-center px-5 py-3 font-semibold">Classification</th>
                  <th className="text-right px-5 py-3 font-semibold">EAD</th>
                  <th className="text-right px-5 py-3 font-semibold">Provision</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {overview.top5Risques.map((r, i) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3 font-medium text-slate-800">
                      <span className="text-slate-400 mr-2 text-xs">#{i + 1}</span>
                      {r.client}
                    </td>
                    <td className="px-5 py-3 text-center">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700">
                        {fmtPct(r.ltv)}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${CLASS_BADGE[r.classification] ?? 'bg-slate-100 text-slate-600'}`}>
                        {CLASS_LABELS[r.classification] ?? r.classification}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right text-slate-600">{fmtM(r.ead)}</td>
                    <td className="px-5 py-3 text-right font-medium text-red-600">{fmtM(r.provision)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Role-specific KPIs */}
      {kpis.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-1">Indicateurs métier</h2>
          <p className="text-xs text-slate-400 mb-4">
            Spécifiques au rôle {user?.role ? (
              <span className="capitalize font-medium text-slate-500">
                {user.role.toLowerCase().replace(/_/g, ' ')}
              </span>
            ) : '—'}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {kpis.map((kpi, idx) => (
              <div key={idx} className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide">{kpi.label}</p>
                <p
                  className="text-xl font-bold mt-1"
                  style={{ color: kpi.couleur ?? '#1e293b' }}
                >
                  {typeof kpi.valeur === 'number'
                    ? kpi.unite === '%'
                      ? fmtPct(kpi.valeur)
                      : kpi.unite === 'M'
                        ? fmtM(kpi.valeur)
                        : fmtExact(kpi.valeur)
                    : typeof kpi.valeur === 'string'
                      ? kpi.valeur
                      : String(kpi.valeur)}
                </p>
                {kpi.unite && kpi.unite !== '%' && kpi.unite !== 'M' && (
                  <p className="text-xs text-slate-400">{kpi.unite}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

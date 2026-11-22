import type { RegisteredTradeOption, TradeOptionEvaluation, TradeOptionGroupStats } from './types.ts';

const HOUR = 3_600_000;
export const MIN_INDEPENDENT = 30;

const STRATEGY_LABELS: Record<string, string> = {
  trend_pullback: 'Continuación de tendencia',
  mean_reversion: 'Reversión a la media',
  derivatives_squeeze: 'Squeeze de derivados',
  range_breakout: 'Ruptura de rango',
};

const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const pct = (num: number, den: number) => (den > 0 ? Number(((num / den) * 100).toFixed(1)) : null);
const r2 = (v: number | null, d = 2) => (v === null ? null : Number(v.toFixed(d)));

/** Intervalo de Wilson al 95 %. */
function wilson(k: number, n: number): [number, number] | null {
  if (n <= 0) return null;
  const z = 1.96;
  const p = k / n;
  const den = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return [Number(((centre - half) * 100).toFixed(1)), Number(((centre + half) * 100).toFixed(1))];
}

/** p-valor bilateral de un test binomial frente a p0 = 0,5 (exacto hasta n = 500, normal después). */
function binomialP(k: number, n: number): number | null {
  if (n <= 0) return null;
  if (n > 500) {
    const z = (Math.abs(k - n / 2) - 0.5) / Math.sqrt(n / 4);
    const t = 1 / (1 + 0.2316419 * z);
    const d = 0.3989423 * Math.exp((-z * z) / 2);
    const tail = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return Number(Math.min(1, 2 * tail).toFixed(4));
  }
  let pmf = Math.pow(0.5, n);
  let cdfLow = 0;
  let cdfHigh = 0;
  for (let i = 0; i <= n; i++) {
    if (i <= k) cdfLow += pmf;
    if (i >= k) cdfHigh += pmf;
    pmf = (pmf * (n - i)) / (i + 1);
  }
  return Number(Math.min(1, 2 * Math.min(cdfLow, cdfHigh)).toFixed(4));
}

/** Selecciona opciones sin solape temporal por activo + estrategia + horizonte. */
function independentSubset(rows: RegisteredTradeOption[]): RegisteredTradeOption[] {
  const byKey = new Map<string, RegisteredTradeOption[]>();
  for (const r of rows) {
    const k = `${r.asset}|${r.strategyKey}|${r.horizonHours}`;
    (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(r);
  }
  const out: RegisteredTradeOption[] = [];
  for (const list of byKey.values()) {
    list.sort((a, b) => a.createdTs - b.createdTs);
    let nextFree = -Infinity;
    for (const r of list) {
      if (r.createdTs >= nextFree) {
        out.push(r);
        nextFree = r.createdTs + r.horizonHours * HOUR;
      }
    }
  }
  return out;
}

export function groupStats(key: string, label: string, rows: RegisteredTradeOption[]): TradeOptionGroupStats {
  const finished = rows.filter((r) => r.status === 'tp_hit' || r.status === 'sl_hit' || r.status === 'expired');
  const tpHit = rows.filter((r) => r.status === 'tp_hit').length;
  const slHit = rows.filter((r) => r.status === 'sl_hit').length;
  const expired = rows.filter((r) => r.status === 'expired').length;

  const withMirror = rows.filter((r) => r.mirrorStatus);
  const mirrorTp = withMirror.filter((r) => r.mirrorStatus === 'tp_hit').length;

  const dirRows = rows.filter((r) => typeof r.dirCorrect === 'boolean');
  const dirOk = dirRows.filter((r) => r.dirCorrect).length;
  const indep = independentSubset(dirRows);
  const indepOk = indep.filter((r) => r.dirCorrect).length;

  const pnls = finished.map((r) => r.realizedPnlPct).filter((v): v is number => v !== null && Number.isFinite(v));
  const closeRets = rows.map((r) => r.closeRetPct).filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v));
  const be = finished.map((r) => ((r.slPct + 0.07) / (r.slPct + r.tp1Pct)) * 100);

  return {
    key,
    label,
    n: rows.length,
    open: rows.filter((r) => r.status === 'open').length,
    tpHit,
    slHit,
    expired,
    tpRatePct: pct(tpHit, finished.length),
    winDecidedPct: pct(tpHit, tpHit + slHit),
    predProbTpPct: r2(mean(finished.map((r) => r.probTpPct)), 1),
    breakevenPct: r2(mean(be), 1),
    mirrorTpRatePct: pct(mirrorTp, withMirror.length),
    dirN: dirRows.length,
    dirAccPct: pct(dirOk, dirRows.length),
    dirIndepN: indep.length,
    dirIndepAccPct: pct(indepOk, indep.length),
    dirCi95: wilson(indepOk, indep.length),
    dirPValue: binomialP(indepOk, indep.length),
    avgPnlPct: r2(mean(pnls)),
    avgCloseRetPct: r2(mean(closeRets)),
  };
}

function groupBy(
  rows: RegisteredTradeOption[],
  keyOf: (r: RegisteredTradeOption) => string,
  labelOf: (k: string) => string,
): TradeOptionGroupStats[] {
  const m = new Map<string, RegisteredTradeOption[]>();
  for (const r of rows) {
    const k = keyOf(r);
    (m.get(k) ?? m.set(k, []).get(k)!).push(r);
  }
  return Array.from(m.entries())
    .map(([k, v]) => groupStats(k, labelOf(k), v))
    .sort((a, b) => b.n - a.n);
}

export function buildEvaluation(rows: RegisteredTradeOption[]): TradeOptionEvaluation {
  const overall = groupStats('all', 'Todas las opciones', rows);

  let verdict: TradeOptionEvaluation['verdict'];
  const n = overall.dirIndepN;
  const acc = overall.dirIndepAccPct;
  const p = overall.dirPValue;
  if (n < MIN_INDEPENDENT || acc === null || p === null) {
    verdict = {
      level: 'insufficient',
      text: `Muestra insuficiente: ${n} de ${MIN_INDEPENDENT} opciones independientes evaluadas. Con menos no se puede distinguir acierto de azar.`,
    };
  } else if (p < 0.05 && acc > 50) {
    verdict = { level: 'edge', text: `Ventaja estadística: acierta la dirección el ${acc.toFixed(1)} % (p = ${p}).` };
  } else if (p < 0.05 && acc < 50) {
    verdict = { level: 'worse', text: `Peor que el azar: acierta la dirección el ${acc.toFixed(1)} % (p = ${p}). Invertir la señal no es una conclusión válida sin más datos.` };
  } else {
    verdict = { level: 'no_edge', text: `Sin ventaja demostrable: acierta la dirección el ${acc.toFixed(1)} % (p = ${p}), indistinguible del 50 %.` };
  }

  return {
    overall,
    byStrategy: groupBy(rows, (r) => r.strategyKey, (k) => STRATEGY_LABELS[k] ?? k),
    byDir: groupBy(rows, (r) => r.dir, (k) => (k === 'long' ? 'Largos' : 'Cortos')),
    byConfidence: groupBy(rows, (r) => r.confidence, (k) => `Confianza ${k}`),
    byAsset: groupBy(rows, (r) => r.asset, (k) => k.toUpperCase()),
    byRank: groupBy(rows, (r) => (r.rank === 1 ? 'top' : r.rank ? 'resto' : 'sin'), (k) =>
      k === 'top' ? 'Nº 1 del ranking' : k === 'resto' ? 'Resto del ranking' : 'Manuales / sin ranking',
    ),
    verdict,
    minIndependent: MIN_INDEPENDENT,
  };
}

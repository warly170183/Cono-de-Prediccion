import type { RegisteredTradeOption, TradeOptionEvaluation, TradeOptionGroupStats } from './types.ts';

const HOUR = 3_600_000;
export const MIN_INDEPENDENT = 30;

const STRATEGY_LABELS: Record<string, string> = {
  trend_pullback: 'Continuación de tendencia',
  mean_reversion: 'Reversión a la media',
  derivatives_squeeze: 'Squeeze de derivados',
  range_breakout: 'Ruptura de rango',
};

const VERDICT_LABELS: Record<string, string> = {
  validada: 'Ventaja validada',
  prometedora: 'Prometedora',
  dudosa: 'Dudosa',
  descartada: 'Sin ventaja (descartada)',
  sin_datos: 'Sin datos suficientes',
  sin: 'Anteriores / manuales',
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

/**
 * Selecciona opciones sin solape temporal.
 * - 'strategy': por activo + estrategia + horizonte (para las tablas por grupo).
 * - 'asset': por activo (cualquier estrategia): conservador, porque las estrategias de un mismo
 *   activo se mueven juntas. Es la base del veredicto principal.
 */
export function independentSubset(rows: RegisteredTradeOption[], mode: 'strategy' | 'asset' = 'strategy'): RegisteredTradeOption[] {
  const byKey = new Map<string, RegisteredTradeOption[]>();
  for (const r of rows) {
    const k = mode === 'asset' ? r.asset : `${r.asset}|${r.strategyKey}|${r.horizonHours}`;
    (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(r);
  }
  const out: RegisteredTradeOption[] = [];
  for (const list of byKey.values()) {
    list.sort((a, b) => a.createdTs - b.createdTs || (a.rank ?? 99) - (b.rank ?? 99));
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

/** ¿Subió el mercado durante el horizonte de esta opción? (independiente de la dirección que propuso) */
function marketUp(r: RegisteredTradeOption): boolean {
  const ret = r.closeRetPct ?? 0;
  return r.dir === 'long' ? ret > 0 : ret < 0;
}

const normCdf = (z: number) => {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const tail = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z >= 0 ? 1 - tail : tail;
};

/**
 * Compara el acierto observado con el que cabría esperar por azar dado el reparto de largos/cortos
 * y la deriva del mercado en la muestra (un "siempre largo" acierta mucho en un mercado alcista sin saber nada).
 */
function skillVsBaseline(rows: RegisteredTradeOption[]) {
  const n = rows.length;
  if (n === 0) return { baselinePct: null, skillPp: null, pValue: null, accPct: null };
  const k = rows.filter((r) => r.dirCorrect).length;
  const pUp = rows.filter(marketUp).length / n;
  let expected = 0;
  let variance = 0;
  for (const r of rows) {
    const p = r.dir === 'long' ? pUp : 1 - pUp;
    expected += p;
    variance += p * (1 - p);
  }
  const acc = (k / n) * 100;
  const baseline = (expected / n) * 100;
  const pValue = variance > 0 ? Number(Math.min(1, 2 * (1 - normCdf(Math.abs(k - expected) / Math.sqrt(variance)))).toFixed(4)) : null;
  return {
    baselinePct: Number(baseline.toFixed(1)),
    skillPp: Number((acc - baseline).toFixed(1)),
    pValue,
    accPct: Number(acc.toFixed(1)),
  };
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
  const indep = independentSubset(dirRows, 'strategy');
  const skill = skillVsBaseline(indep);
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
    dirBaselinePct: skill.baselinePct,
    dirSkillPp: skill.skillPp,
    dirSkillP: skill.pValue,
    avgPnlPct: r2(mean(pnls)),
    avgCloseRetPct: r2(mean(closeRets)),
  };
}

function groupBy(
  rows: RegisteredTradeOption[],
  keyOf: (r: RegisteredTradeOption) => string,
  labelOf: (k: string) => string,
  order?: string[],
): TradeOptionGroupStats[] {
  const m = new Map<string, RegisteredTradeOption[]>();
  for (const r of rows) {
    const k = keyOf(r);
    (m.get(k) ?? m.set(k, []).get(k)!).push(r);
  }
  return Array.from(m.entries())
    .map(([k, v]) => groupStats(k, labelOf(k), v))
    .sort((a, b) => (order ? order.indexOf(a.key) - order.indexOf(b.key) : b.n - a.n));
}

const CONFLUENCE_BINS = ['<55', '55-64', '65-74', '>=75'];
const confluenceBin = (v: number) => (v < 55 ? '<55' : v < 65 ? '55-64' : v < 75 ? '65-74' : '>=75');
const MARKET_REGIME_LABELS: Record<string, string> = { trend: 'Tendencia', gamma_flip: 'Gamma flip', balanced: 'Equilibrado' };

export function buildEvaluation(rows: RegisteredTradeOption[], now = Date.now()): TradeOptionEvaluation {
  const overall = groupStats('all', 'Todas las opciones', rows);

  // ---- Resultado principal: dirección acertada frente al azar, muestra sin solape por activo
  const dirRows = rows.filter((r) => typeof r.dirCorrect === 'boolean');
  const headSet = independentSubset(dirRows, 'asset');
  const headOk = headSet.filter((r) => r.dirCorrect).length;
  const sk = skillVsBaseline(headSet);
  const headline = {
    n: headSet.length,
    accPct: sk.accPct,
    baselinePct: sk.baselinePct,
    skillPp: sk.skillPp,
    pValue: sk.pValue,
    ci95: wilson(headOk, headSet.length),
  };

  let verdict: TradeOptionEvaluation['verdict'];
  if (headline.n < MIN_INDEPENDENT || headline.accPct === null || headline.pValue === null || headline.skillPp === null) {
    verdict = {
      level: 'insufficient',
      text: `Muestra insuficiente: ${headline.n} de ${MIN_INDEPENDENT} opciones independientes evaluadas. Con menos no se puede distinguir acierto de azar.`,
    };
  } else {
    const detail = `acierta la dirección el ${headline.accPct.toFixed(1)} % frente al ${headline.baselinePct?.toFixed(1)} % esperable por azar (${headline.skillPp >= 0 ? '+' : ''}${headline.skillPp.toFixed(1)} pp, p = ${headline.pValue})`;
    if (headline.pValue < 0.05 && headline.skillPp > 0) verdict = { level: 'edge', text: `Ventaja estadística: ${detail}. Confirmar con más datos antes de arriesgar dinero.` };
    else if (headline.pValue < 0.05 && headline.skillPp < 0) verdict = { level: 'worse', text: `Peor que el azar: ${detail}. Invertir la señal no es una conclusión válida sin más datos.` };
    else verdict = { level: 'no_edge', text: `Sin ventaja demostrable: ${detail}.` };
  }

  // ---- Progreso hacia el veredicto (estimación)
  const assets = Math.max(1, new Set(rows.map((r) => r.asset)).size || 3);
  const avgH = rows.length ? rows.reduce((a, r) => a + r.horizonHours, 0) / rows.length : 48;
  const perDay = (assets * 24) / avgH;
  const remaining = Math.max(0, MIN_INDEPENDENT - headline.n);
  const progress = {
    n: headline.n,
    needed: MIN_INDEPENDENT,
    etaDays: remaining === 0 ? 0 : Math.ceil(remaining / perDay + avgH / 24),
    firstTs: rows.length ? Math.min(...rows.map((r) => r.createdTs)) : null,
  };

  // ---- Calibración y Brier de la probabilidad de TP
  const finished = rows.filter((r) => r.status === 'tp_hit' || r.status === 'sl_hit' || r.status === 'expired');
  const bins: Array<{ label: string; lo: number; hi: number }> = [
    { label: '<30 %', lo: 0, hi: 30 },
    { label: '30-40 %', lo: 30, hi: 40 },
    { label: '40-50 %', lo: 40, hi: 50 },
    { label: '>=50 %', lo: 50, hi: 101 },
  ];
  const calibration = bins
    .map((b) => {
      const sub = finished.filter((r) => r.probTpPct >= b.lo && r.probTpPct < b.hi);
      return {
        label: b.label,
        n: sub.length,
        predictedPct: Number((sub.reduce((a, r) => a + r.probTpPct, 0) / Math.max(1, sub.length)).toFixed(1)),
        actualPct: Number(((sub.filter((r) => r.status === 'tp_hit').length / Math.max(1, sub.length)) * 100).toFixed(1)),
      };
    })
    .filter((b) => b.n > 0);
  let brier: TradeOptionEvaluation['brier'] = null;
  if (finished.length >= 10) {
    const y: number[] = finished.map((r) => (r.status === 'tp_hit' ? 1 : 0));
    const score = finished.reduce((a, r, i) => a + (r.probTpPct / 100 - y[i]) ** 2, 0) / finished.length;
    const rate = y.reduce((a, v) => a + v, 0) / y.length;
    brier = { score: Number(score.toFixed(4)), baseline: Number((rate * (1 - rate)).toFixed(4)), n: finished.length };
  }

  // ---- Series temporales
  const ordered = [...headSet].sort((a, b) => a.createdTs + a.horizonHours * HOUR - (b.createdTs + b.horizonHours * HOUR));
  const accuracy: TradeOptionEvaluation['timeline']['accuracy'] = [];
  let ok = 0;
  let upCnt = 0;
  let exp = 0;
  ordered.forEach((r, i) => {
    ok += r.dirCorrect ? 1 : 0;
    upCnt += marketUp(r) ? 1 : 0;
    const pUp = upCnt / (i + 1);
    exp += r.dir === 'long' ? pUp : 1 - pUp; // aproximación incremental de la línea base
    accuracy.push({
      ts: r.createdTs + r.horizonHours * HOUR,
      n: i + 1,
      accPct: Number(((ok / (i + 1)) * 100).toFixed(1)),
      baselinePct: Number(((exp / (i + 1)) * 100).toFixed(1)),
    });
  });
  let cum = 0;
  const pnl = finished
    .filter((r) => r.evaluatedTs !== null && r.realizedPnlPct !== null)
    .sort((a, b) => (a.evaluatedTs as number) - (b.evaluatedTs as number))
    .map((r) => {
      cum += r.realizedPnlPct as number;
      return { ts: r.evaluatedTs as number, cumPnlPct: Number(cum.toFixed(2)) };
    });

  void now;
  return {
    overall,
    byStrategy: groupBy(rows, (r) => r.strategyKey, (k) => STRATEGY_LABELS[k] ?? k),
    byDir: groupBy(rows, (r) => r.dir, (k) => (k === 'long' ? 'Largos' : 'Cortos')),
    byConfidence: groupBy(rows, (r) => r.confidence, (k) => `Confianza ${k}`),
    byVerdict: groupBy(rows, (r) => r.verdict ?? 'sin', (k) => VERDICT_LABELS[k] ?? k),
    byAsset: groupBy(rows, (r) => r.asset, (k) => k.toUpperCase()),
    byRank: groupBy(rows, (r) => (r.rank === 1 ? 'top' : r.rank ? 'resto' : 'sin'), (k) =>
      k === 'top' ? 'Nº 1 del ranking' : k === 'resto' ? 'Resto del ranking' : 'Manuales / sin ranking',
    ),
    byConfluence: groupBy(rows, (r) => confluenceBin(r.confluenceScore), (k) => `Confluencia ${k}`, CONFLUENCE_BINS),
    byRegime: groupBy(rows, (r) => r.ctx?.regime ?? 'sin dato', (k) => (k === 'sin dato' ? 'Sin dato (anteriores)' : `Volatilidad ${k}`)),
    byMarketRegime: groupBy(rows, (r) => r.ctx?.marketRegime ?? 'sin dato', (k) => MARKET_REGIME_LABELS[k] ?? 'Sin dato (anteriores)'),
    calibration,
    brier,
    headline,
    progress,
    timeline: { accuracy: accuracy.slice(-200), pnl: pnl.slice(-300) },
    verdict,
    minIndependent: MIN_INDEPENDENT,
  };
}

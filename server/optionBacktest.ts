/**
 * Backtest histórico (replay) de las estrategias de Opciones de Trading.
 *
 * Repite las MISMAS reglas de `detectSetups` sobre el histórico de velas, cada 4 h, y simula la operación con
 * el mismo criterio que la evaluación en vivo (SL primero si TP1 y SL caen en la misma vela, TP1 como objetivo,
 * expiración al final del horizonte, coste de ida y vuelta incluido).
 *
 * - Las reglas NO se ajustan con estos datos: es un replay, no una optimización.
 * - Solo operaciones sin solape por estrategia (muestras independientes).
 * - La estrategia de derivados no se puede reproducir (no hay histórico de funding/OI a 1 h) y se mide solo en vivo.
 */
import type { Candle, TechnicalParametersSnapshot } from './types.ts';
import { closedDailyUpTo, detectSetups, htfFromDaily, type StrategyKey } from './tradeSignals.ts';

const HOUR = 3_600_000;
export const ROUND_TRIP_COST_PCT = 0.07;

export type EdgeVerdict = 'validada' | 'prometedora' | 'dudosa' | 'descartada' | 'sin_datos';

export interface BacktestStat {
  strategyKey: StrategyKey;
  n: number;
  wins: number;
  winPct: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  expR: number | null;
  avgPnlPct: number | null;
  days: number;
  /** R de cada operación (para combinar con las muestras en vivo). */
  rs: number[];
}

function wilson(k: number, n: number): [number, number] | null {
  if (n <= 0) return null;
  const z = 1.96;
  const p = k / n;
  const den = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return [Number(((centre - half) * 100).toFixed(1)), Number(((centre + half) * 100).toFixed(1))];
}

export function meanSd(xs: number[]): { mean: number; sd: number; se: number } {
  const n = xs.length;
  if (!n) return { mean: 0, sd: 0, se: 0 };
  const mean = xs.reduce((s, v) => s + v, 0) / n;
  const sd = n > 1 ? Math.sqrt(xs.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)) : 0;
  return { mean, sd, se: n > 0 ? sd / Math.sqrt(n) : 0 };
}

export const MIN_EDGE_SAMPLES = 20;

/**
 * Veredicto sobre la esperanza en R (resultado medio por unidad de riesgo, neto de costes):
 *  validada    → límite inferior (90 % unilateral) por encima de 0
 *  prometedora → media positiva pero sin confirmar
 *  dudosa      → media ≤ 0 sin ser significativamente negativa
 *  descartada  → media negativa con significación
 */
export function edgeVerdict(rs: number[]): { verdict: EdgeVerdict; n: number; expR: number | null; seR: number | null } {
  const n = rs.length;
  if (n < MIN_EDGE_SAMPLES) return { verdict: 'sin_datos', n, expR: n ? Number(meanSd(rs).mean.toFixed(3)) : null, seR: null };
  const { mean, se } = meanSd(rs);
  const z = 1.28;
  const verdict: EdgeVerdict =
    mean - z * se > 0 ? 'validada' : mean > 0 ? 'prometedora' : mean + z * se < 0 ? 'descartada' : 'dudosa';
  return { verdict, n, expR: Number(mean.toFixed(3)), seR: Number(se.toFixed(3)) };
}

/** Simula una operación abierta al cierre de la vela `i`. Devuelve null si no hay velas suficientes. */
export function simulateTrade(
  c1h: Candle[],
  i: number,
  dir: 'long' | 'short',
  slPct: number,
  tp1Pct: number,
  horizon: number,
): { r: number; win: boolean; pnlPct: number } | null {
  if (i + horizon > c1h.length - 1) return null;
  const entry = c1h[i][4];
  const sign = dir === 'long' ? 1 : -1;
  const sl = entry * (1 - (sign * slPct) / 100);
  const tp = entry * (1 + (sign * tp1Pct) / 100);
  for (let j = i + 1; j <= i + horizon; j++) {
    const hi = c1h[j][2];
    const lo = c1h[j][3];
    const hitSl = dir === 'long' ? lo <= sl : hi >= sl;
    const hitTp = dir === 'long' ? hi >= tp : lo <= tp;
    if (hitSl) {
      const pnl = -slPct - ROUND_TRIP_COST_PCT;
      return { r: pnl / slPct, win: false, pnlPct: pnl };
    }
    if (hitTp) {
      const pnl = tp1Pct - ROUND_TRIP_COST_PCT;
      return { r: pnl / slPct, win: true, pnlPct: pnl };
    }
  }
  const close = c1h[i + horizon][4];
  const pnl = sign * (close / entry - 1) * 100 - ROUND_TRIP_COST_PCT;
  return { r: pnl / slPct, win: false, pnlPct: pnl };
}

export function backtestStrategies(
  c1h: Candle[],
  c1d: Candle[],
  computeTech: (h: Candle[], d: Candle[]) => TechnicalParametersSnapshot,
  opts: { step?: number; warmup?: number; window?: number } = {},
): Record<string, BacktestStat> {
  const step = opts.step ?? 4;
  const warmup = opts.warmup ?? 260;
  const window = opts.window ?? 500;
  const keys: StrategyKey[] = ['trend_pullback', 'mean_reversion', 'range_breakout'];
  const acc = new Map<StrategyKey, { rs: number[]; pnl: number[]; wins: number; nextFree: number }>();
  for (const k of keys) acc.set(k, { rs: [], pnl: [], wins: 0, nextFree: -1 });

  const n = c1h.length;
  for (let i = warmup; i < n - 1; i += step) {
    const win = c1h.slice(Math.max(0, i - window + 1), i + 1);
    const daily = closedDailyUpTo(c1d, c1h[i][0]);
    if (daily.length < 2) continue;
    const tech = computeTech(win, daily);
    const htf = htfFromDaily(daily);
    const { setups } = detectSetups({ spot: c1h[i][4], tech, htf, candles1h: win });
    for (const s of setups) {
      const a = acc.get(s.strategyKey);
      if (!a || i < a.nextFree) continue;
      const res = simulateTrade(c1h, i, s.dir, s.slPct, s.tp1Pct, s.horizonHours);
      if (!res) continue;
      a.rs.push(res.r);
      a.pnl.push(res.pnlPct);
      if (res.win) a.wins++;
      a.nextFree = i + s.horizonHours;
    }
  }

  const days = n > 0 ? Math.max(0, Math.round(((n - warmup) * HOUR) / 86_400_000)) : 0;
  const out: Record<string, BacktestStat> = {};
  for (const k of keys) {
    const a = acc.get(k)!;
    const m = a.rs.length;
    const ci = wilson(a.wins, m);
    out[k] = {
      strategyKey: k,
      n: m,
      wins: a.wins,
      winPct: m ? Number(((a.wins / m) * 100).toFixed(1)) : null,
      ciLow: ci ? ci[0] : null,
      ciHigh: ci ? ci[1] : null,
      expR: m ? Number(meanSd(a.rs).mean.toFixed(3)) : null,
      avgPnlPct: m ? Number((a.pnl.reduce((s, v) => s + v, 0) / m).toFixed(3)) : null,
      days,
      rs: a.rs,
    };
  }
  return out;
}

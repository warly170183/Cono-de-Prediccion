/**
 * Detección de setups de Opciones de Trading.
 *
 * Módulo puro (sin red ni disco): se usa igual en vivo y en el backtest histórico, de modo que
 * lo que se valida es exactamente lo que luego se propone.
 *
 * Principios:
 *  - Cada estrategia solo propone operación si se cumplen SUS condiciones; si no, devuelve el motivo
 *    por el que no hay operación ("no operar" también es una respuesta).
 *  - Filtro de tendencia diaria: no se opera contra la tendencia del timeframe superior sin un extremo claro.
 *  - SL por estructura (último swing) y TP limitado por el siguiente nivel opuesto (pivote, máx/mín 7d, muros GEX).
 *  - Distancias medidas en rango diario (ATR diario), no en ATR horario: un stop de 0,8 % en un horizonte de 72 h
 *    salta por ruido y condena la estrategia antes de empezar.
 */
import type { Candle, ProposalRegimeTag, TechnicalParametersSnapshot, TradeOptionProposal } from './types.ts';

export type Dir = 'long' | 'short';
export type StrategyKey = TradeOptionProposal['strategyKey'];

const DAY = 86_400_000;
const px = (n: number) => n.toLocaleString('en-US');
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface HtfContext {
  trend: 'alcista' | 'bajista' | 'lateral';
  ema20: number | null;
  ema50: number | null;
  /** ATR(14) diario en % del precio, null si no hay datos. */
  atrDPct: number | null;
}

function emaLast(values: number[], period: number): number {
  const a = 2 / (period + 1);
  let e = values[0];
  for (let i = 1; i < values.length; i++) e = values[i] * a + e * (1 - a);
  return e;
}

/** Tendencia y volatilidad del timeframe diario (solo velas diarias CERRADAS). */
export function htfFromDaily(c1d: Candle[]): HtfContext {
  let atrDPct: number | null = null;
  if (c1d.length >= 15) {
    const trs: number[] = [];
    for (let i = c1d.length - 14; i < c1d.length; i++) {
      const prevClose = c1d[i - 1][4];
      const tr = Math.max(c1d[i][2] - c1d[i][3], Math.abs(c1d[i][2] - prevClose), Math.abs(c1d[i][3] - prevClose));
      trs.push((tr / c1d[i][4]) * 100);
    }
    atrDPct = trs.reduce((s, v) => s + v, 0) / trs.length;
  }
  if (c1d.length < 55) return { trend: 'lateral', ema20: null, ema50: null, atrDPct };
  const closes = c1d.map((c) => c[4]);
  const ema20 = emaLast(closes, 20);
  const ema50 = emaLast(closes, 50);
  const last = closes[closes.length - 1];
  const trend = ema20 > ema50 && last > ema50 ? 'alcista' : ema20 < ema50 && last < ema50 ? 'bajista' : 'lateral';
  return { trend, ema20, ema50, atrDPct };
}

/** Velas diarias cerradas hasta el cierre de la vela horaria con marca de tiempo `hourTs`. */
export function closedDailyUpTo(c1d: Candle[], hourTs: number): Candle[] {
  const end = hourTs + 3_600_000;
  let k = c1d.length;
  while (k > 0 && c1d[k - 1][0] + DAY > end) k--;
  return c1d.slice(0, k);
}

export interface DerivInput {
  fundZ: number | null;
  lsZ: number | null;
  oiChg1d: number | null;
}

export interface GexInput {
  putWall: number | null;
  callWall: number | null;
  flip: number | null;
}

export interface SignalInput {
  spot: number;
  tech: TechnicalParametersSnapshot;
  htf: HtfContext;
  /** Velas 1H cerradas; la última es el precio actual. Se necesitan ≥ 30. */
  candles1h: Candle[];
  deriv?: DerivInput | null;
  gex?: GexInput | null;
}

export interface SetupSpec {
  strategyKey: StrategyKey;
  title: string;
  dir: Dir;
  horizonHours: 24 | 72;
  entryLow: number;
  entryHigh: number;
  slPct: number;
  tp1Pct: number;
  tp2Pct: number;
  regimeTags: ProposalRegimeTag[];
  rationale: string[];
  invalidation: string;
  /** Calidad del setup según sus propias condiciones (0-100). */
  techScore: number;
}

export interface SkippedSetup {
  strategyKey: StrategyKey;
  reason: string;
}

/** Rango "típico de un día" en %: base de todas las distancias SL/TP. */
export function dayRangePct(tech: TechnicalParametersSnapshot, htf: HtfContext): number {
  return Math.max(htf.atrDPct ?? 0, tech.atr14Pct * 3.6, 0.9);
}

/**
 * Niveles que pueden frenar el precio en el sentido de la operación.
 * - Operaciones de 24 h: pivote diario, máx/mín de 7 días y muros GEX.
 * - Operaciones de 72 h: solo muros GEX. El pivote diario es una referencia intradía y el máx/mín de 7 días es justo
 *   el nivel que una continuación de tendencia busca romper; limitarlas con ellos las descartaría casi todas.
 */
function opposingLevels(dir: Dir, tech: TechnicalParametersSnapshot, gex: GexInput | null | undefined, horizon: 24 | 72): number[] {
  const lv: number[] = [];
  if (dir === 'long') {
    if (horizon === 24) lv.push(tech.pivotR1, tech.high7d);
    if (gex?.callWall) lv.push(gex.callWall);
  } else {
    if (horizon === 24) lv.push(tech.pivotS1, tech.low7d);
    if (gex?.putWall) lv.push(gex.putWall);
  }
  return lv;
}

type Stops = { slPct: number; tp1Pct: number; tp2Pct: number; note: string | null } | { skip: string };

/**
 * SL: más allá del último swing (+ un pequeño colchón), acotado en múltiplos del rango diario.
 * TP1: múltiplo del riesgo, pero nunca más allá del siguiente nivel opuesto; si no queda ≥ 1,3 R de recorrido, no hay operación.
 */
function buildStops(o: {
  dir: Dir;
  spot: number;
  swing: number;
  dayR: number;
  slMin: number;
  slMax: number;
  rr: number;
  tp1Override?: number;
  levels: number[];
}): Stops {
  const swingDist = (Math.abs(o.spot - o.swing) / o.spot) * 100;
  const slPct = Number(clamp(clamp(swingDist + 0.12 * o.dayR, o.slMin * o.dayR, o.slMax * o.dayR), 0.8, 8.5).toFixed(2));
  let tp1 = o.tp1Override ?? slPct * o.rr;
  let note: string | null = null;

  const room = o.levels
    .map((l) => (o.dir === 'long' ? (l / o.spot - 1) * 100 : (1 - l / o.spot) * 100))
    .filter((d) => d >= 0.35)
    .sort((a, b) => a - b)[0];
  if (room !== undefined && room < tp1) {
    if (room * 0.92 >= 1.3 * slPct) {
      tp1 = room * 0.92;
      note = `TP1 recortado a ${tp1.toFixed(2)} % para quedar antes del siguiente nivel (${room.toFixed(2)} % de recorrido).`;
    } else {
      return { skip: `Nivel opuesto a solo ${room.toFixed(2)} % limita el recorrido (< 1,3 R con SL de ${slPct} %).` };
    }
  }
  if (tp1 < 1.3 * slPct) return { skip: `Objetivo de ${tp1.toFixed(2)} % no compensa el stop de ${slPct} % (< 1,3 R).` };
  const tp1Pct = Number(clamp(tp1, 1.2, 18).toFixed(2));
  const tp2Pct = Number(Math.max(tp1Pct * 1.5, tp1Pct + slPct).toFixed(2));
  return { slPct, tp1Pct, tp2Pct, note };
}

export function detectSetups(inp: SignalInput): { setups: SetupSpec[]; skipped: SkippedSetup[] } {
  const { spot, tech, htf, candles1h } = inp;
  const setups: SetupSpec[] = [];
  const skipped: SkippedSetup[] = [];
  const skip = (strategyKey: StrategyKey, reason: string) => skipped.push({ strategyKey, reason });
  const n = candles1h.length;
  if (n < 30 || !(spot > 0)) {
    for (const k of ['trend_pullback', 'mean_reversion', 'derivatives_squeeze', 'range_breakout'] as StrategyKey[]) {
      skip(k, 'Histórico insuficiente.');
    }
    return { setups, skipped };
  }

  const dayR = dayRangePct(tech, htf);
  const last = candles1h[n - 1];
  const lows12 = Math.min(...candles1h.slice(-12).map((c) => c[3]));
  const highs12 = Math.max(...candles1h.slice(-12).map((c) => c[2]));
  const lows24 = Math.min(...candles1h.slice(-24).map((c) => c[3]));
  const highs24 = Math.max(...candles1h.slice(-24).map((c) => c[2]));
  const htfTxt = htf.trend === 'lateral' ? 'diaria lateral' : `diaria ${htf.trend}`;
  const aligned = (d: Dir) => (d === 'long' ? htf.trend === 'alcista' : htf.trend === 'bajista');
  const opposed = (d: Dir) => (d === 'long' ? htf.trend === 'bajista' : htf.trend === 'alcista');

  // ───────────── 1. Continuación de tendencia tras retroceso ─────────────
  (() => {
    const key: StrategyKey = 'trend_pullback';
    const dir: Dir | null = tech.trendBias === 'alcista' ? 'long' : tech.trendBias === 'bajista' ? 'short' : null;
    if (!dir) return skip(key, `Sin tendencia horaria definida (ADX ${tech.adx14.toFixed(0)}, EMAs sin alinear).`);
    if (opposed(dir)) return skip(key, `Tendencia horaria ${tech.trendBias} contra la tendencia ${htfTxt}.`);
    const diOk = dir === 'long' ? tech.plusDi14 > tech.minusDi14 : tech.minusDi14 > tech.plusDi14;
    if (!diOk) return skip(key, 'Direccional (DI) en contra de la tendencia.');
    const d = (spot - tech.ema20) / Math.max(1e-9, tech.atr14);
    const inZone = dir === 'long' ? d >= -1.2 && d <= 0.9 : d <= 1.2 && d >= -0.9;
    if (!inZone) {
      return skip(
        key,
        d > 0 === (dir === 'long')
          ? `Precio extendido (${d.toFixed(1)} ATR de la EMA20): esperar retroceso.`
          : `Pérdida de la EMA20 (${d.toFixed(1)} ATR): el retroceso es demasiado profundo.`,
      );
    }
    const rsiOk = dir === 'long' ? tech.rsi14 >= 36 && tech.rsi14 <= 60 : tech.rsi14 >= 40 && tech.rsi14 <= 64;
    if (!rsiOk) return skip(key, `RSI ${tech.rsi14.toFixed(0)} fuera de la zona de retroceso sano.`);

    const stops = buildStops({
      dir,
      spot,
      swing: dir === 'long' ? lows24 : highs24,
      dayR,
      slMin: 0.55,
      slMax: 1.0,
      rr: 2.4,
      levels: opposingLevels(dir, tech, inp.gex, 72),
    });
    if ('skip' in stops) return skip(key, stops.skip);

    let score = 50;
    score += htf.trend === 'lateral' ? 4 : 12;
    score += tech.adx14 >= 25 ? 8 : tech.adx14 >= 20 ? 4 : 0;
    score += (dir === 'long' ? tech.obvTrend === 'alcista' : tech.obvTrend === 'bajista') ? 6 : 0;
    score += tech.rvol24h >= 1 ? 4 : 0;
    score += Math.abs(d) <= 0.5 ? 6 : 0;
    score += Math.abs(tech.plusDi14 - tech.minusDi14) >= 8 ? 4 : 0;

    setups.push({
      strategyKey: key,
      title: dir === 'long' ? 'Continuación alcista tras retroceso a EMA20' : 'Continuación bajista tras rebote a EMA20',
      dir,
      horizonHours: 72,
      entryLow: dir === 'long' ? Math.min(spot, tech.ema20) * 0.998 : spot * 0.998,
      entryHigh: dir === 'long' ? spot * 1.002 : Math.max(spot, tech.ema20) * 1.002,
      slPct: stops.slPct,
      tp1Pct: stops.tp1Pct,
      tp2Pct: stops.tp2Pct,
      regimeTags: ['trend'],
      rationale: [
        `Tendencia horaria ${tech.trendBias} (ADX ${tech.adx14.toFixed(1)}, +DI ${tech.plusDi14.toFixed(1)} / -DI ${tech.minusDi14.toFixed(1)}) y tendencia ${htfTxt}.`,
        `Precio a ${d.toFixed(1)} ATR de la EMA20 ($${px(tech.ema20)}) con RSI ${tech.rsi14.toFixed(0)}: retroceso sin sobreextensión.`,
        `SL tras el ${dir === 'long' ? 'mínimo' : 'máximo'} de 24 h ($${px(dir === 'long' ? lows24 : highs24)}); rango diario de referencia ${dayR.toFixed(2)} %.${stops.note ? ' ' + stops.note : ''}`,
      ],
      invalidation:
        dir === 'long'
          ? `Cierre horario bajo la EMA50 ($${px(tech.ema50)}) o pérdida del mínimo de 24 h ($${px(lows24)}).`
          : `Cierre horario sobre la EMA50 ($${px(tech.ema50)}) o ruptura del máximo de 24 h ($${px(highs24)}).`,
      techScore: clamp(Math.round(score), 30, 92),
    });
  })();

  // ───────────── 2. Reversión a la media en extremos, solo sin tendencia fuerte ─────────────
  (() => {
    const key: StrategyKey = 'mean_reversion';
    if (tech.adx14 >= 28) return skip(key, `Tendencia fuerte (ADX ${tech.adx14.toFixed(0)}): no se opera reversión.`);
    if (tech.rvol24h > 2.5) return skip(key, `Volumen en expansión (RVOL ${tech.rvol24h.toFixed(1)}x): posible capitulación.`);
    const dir: Dir | null =
      tech.bbZ <= -1.7 && tech.rsi14 <= 35 ? 'long' : tech.bbZ >= 1.7 && tech.rsi14 >= 65 ? 'short' : null;
    if (!dir) return skip(key, `Sin extremo (Bollinger z ${tech.bbZ.toFixed(2)}, RSI ${tech.rsi14.toFixed(0)}).`);
    if (opposed(dir) && Math.abs(tech.bbZ) < 2.2) {
      return skip(key, `Contra la tendencia ${htfTxt} sin extremo suficiente (|z| < 2,2).`);
    }
    const turned = dir === 'long' ? last[4] > last[1] : last[4] < last[1];
    if (!turned) return skip(key, 'Sin vela de giro: se espera confirmación del rebote.');

    const toMid = Math.abs(tech.bbMid / spot - 1) * 100;
    const stops = buildStops({
      dir,
      spot,
      swing: dir === 'long' ? lows12 : highs12,
      dayR,
      slMin: 0.4,
      slMax: 0.75,
      rr: 1.8,
      tp1Override: Math.max(toMid, 1.2),
      levels: opposingLevels(dir, tech, inp.gex, 24),
    });
    if ('skip' in stops) return skip(key, stops.skip);

    let score = 48;
    score += Math.min(16, (Math.abs(tech.bbZ) - 1.7) * 20);
    score += (dir === 'long' ? tech.rsi14 <= 30 : tech.rsi14 >= 70) ? 8 : 0;
    score += 6; // vela de giro confirmada
    score += aligned(dir) ? 8 : htf.trend === 'lateral' ? 4 : 0;
    score += tech.adx14 < 20 ? 6 : 0;

    setups.push({
      strategyKey: key,
      title: dir === 'long' ? 'Reversión alcista hacia la media (BB media / VWAP)' : 'Reversión bajista hacia la media (BB media / VWAP)',
      dir,
      horizonHours: 24,
      entryLow: dir === 'long' ? spot * 0.997 : spot * 0.999,
      entryHigh: dir === 'long' ? spot * 1.001 : spot * 1.003,
      slPct: stops.slPct,
      tp1Pct: stops.tp1Pct,
      tp2Pct: stops.tp2Pct,
      regimeTags: ['gamma_flip'],
      rationale: [
        `Extremo: Bollinger z ${tech.bbZ.toFixed(2)}, RSI ${tech.rsi14.toFixed(1)}, estocástico %K ${tech.stochK.toFixed(0)}; ADX ${tech.adx14.toFixed(0)} (sin tendencia fuerte).`,
        `Vela de giro confirmada. Objetivo: banda media ($${px(tech.bbMid)}, ${toMid.toFixed(2)} % de recorrido).`,
        `Contexto ${htfTxt}. SL tras el ${dir === 'long' ? 'mínimo' : 'máximo'} de 12 h ($${px(dir === 'long' ? lows12 : highs12)}).${stops.note ? ' ' + stops.note : ''}`,
      ],
      invalidation:
        dir === 'long'
          ? `Nuevo mínimo de 12 h ($${px(lows12)}) con expansión de volumen.`
          : `Nuevo máximo de 12 h ($${px(highs12)}) con RVOL > 1,3x.`,
      techScore: clamp(Math.round(score), 30, 92),
    });
  })();

  // ───────────── 3. Ruptura de rango comprimido con volumen ─────────────
  (() => {
    const key: StrategyKey = 'range_breakout';
    const prior = candles1h.slice(-25, -1);
    const rh = Math.max(...prior.map((c) => c[2]));
    const rl = Math.min(...prior.map((c) => c[3]));
    const rangePct = ((rh - rl) / spot) * 100;
    const atrH = Math.max(0.05, tech.atr14Pct);
    if (rangePct > 5.5 * atrH) return skip(key, `Rango previo de 24 h no comprimido (${rangePct.toFixed(1)} % vs ATR horario ${atrH.toFixed(2)} %).`);
    const broke: Dir | null = last[4] > rh ? 'long' : last[4] < rl ? 'short' : null;
    if (!broke) return skip(key, 'El precio sigue dentro del rango de 24 h.');
    const dir = broke;
    const level = dir === 'long' ? rh : rl;
    const extension = (Math.abs(spot - level) / Math.max(1e-9, tech.atr14));
    if (extension > 1.0) return skip(key, `Ruptura ya extendida (${extension.toFixed(1)} ATR más allá del rango): no se persigue.`);
    const avgVol = prior.reduce((s, c) => s + c[5], 0) / prior.length;
    const vr = avgVol > 0 ? last[5] / avgVol : 1;
    if (vr < 1.3) return skip(key, `Ruptura sin volumen (${vr.toFixed(1)}x la media de 24 h).`);
    if (opposed(dir)) return skip(key, `Ruptura contra la tendencia ${htfTxt}.`);
    if (tech.adx14 > 35) return skip(key, `ADX ${tech.adx14.toFixed(0)}: movimiento ya maduro.`);

    const stops = buildStops({
      dir,
      spot,
      swing: level - (dir === 'long' ? 1 : -1) * 0.35 * tech.atr14,
      dayR,
      slMin: 0.4,
      slMax: 0.75,
      rr: 2.2,
      levels: opposingLevels(dir, tech, inp.gex, 24),
    });
    if ('skip' in stops) return skip(key, stops.skip);

    let score = 50;
    score += Math.min(12, (vr - 1.3) * 12);
    score += rangePct <= 4 * atrH ? 8 : 0;
    score += aligned(dir) ? 10 : htf.trend === 'lateral' ? 5 : 0;
    score += tech.adx14 >= 15 && tech.adx14 <= 30 ? 4 : 0;

    setups.push({
      strategyKey: key,
      title: dir === 'long' ? 'Ruptura alcista de rango comprimido con volumen' : 'Ruptura bajista de rango comprimido con volumen',
      dir,
      horizonHours: 24,
      entryLow: dir === 'long' ? level : spot * 0.998,
      entryHigh: dir === 'long' ? spot * 1.002 : level,
      slPct: stops.slPct,
      tp1Pct: stops.tp1Pct,
      tp2Pct: stops.tp2Pct,
      regimeTags: ['trend', 'gamma_flip'],
      rationale: [
        `Rango previo de 24 h comprimido (${rangePct.toFixed(2)} %, $${px(rl)} – $${px(rh)}) y cierre horario fuera de él.`,
        `Volumen de la vela de ruptura ${vr.toFixed(1)}x la media de 24 h; ${extension.toFixed(1)} ATR de extensión (sin perseguir).`,
        `Contexto ${htfTxt}; ADX ${tech.adx14.toFixed(0)}. SL de vuelta dentro del rango.${stops.note ? ' ' + stops.note : ''}`,
      ],
      invalidation:
        dir === 'long'
          ? `Cierre horario de vuelta dentro del rango (< $${px(rh)}).`
          : `Cierre horario de vuelta dentro del rango (> $${px(rl)}).`,
      techScore: clamp(Math.round(score), 30, 92),
    });
  })();

  // ───────────── 4. Posicionamiento extremo de derivados (solo en vivo: no hay histórico) ─────────────
  (() => {
    const key: StrategyKey = 'derivatives_squeeze';
    const dv = inp.deriv;
    if (!dv || (dv.fundZ === null && dv.lsZ === null)) return skip(key, 'Sin datos de derivados.');
    const crowdedLong = (dv.fundZ !== null && dv.fundZ >= 1.5) || (dv.lsZ !== null && dv.lsZ >= 1.5);
    const crowdedShort =
      (dv.fundZ !== null && dv.fundZ <= -1.2) || (dv.oiChg1d !== null && dv.oiChg1d <= -4 && (dv.fundZ ?? 0) < 0);
    let dir: Dir | null = null;
    if (crowdedLong && !crowdedShort) {
      if (spot < tech.vwap24h || tech.macdHist < 0) dir = 'short';
      else return skip(key, 'Longs saturados pero el precio aún no se debilita (sobre VWAP y MACD+).');
    } else if (crowdedShort && !crowdedLong) {
      if (spot >= tech.ema20 || tech.rsi14 > 45) dir = 'long';
      else return skip(key, 'Shorts saturados pero el precio aún no se estabiliza.');
    }
    if (!dir) return skip(key, 'Posicionamiento de derivados no extremo.');
    if (opposed(dir) && htf.trend !== 'lateral' && Math.abs(dv.fundZ ?? 0) < 2.2) {
      return skip(key, `Contra la tendencia ${htfTxt} sin extremo de funding suficiente.`);
    }

    const stops = buildStops({
      dir,
      spot,
      swing: dir === 'long' ? lows24 : highs24,
      dayR,
      slMin: 0.55,
      slMax: 1.0,
      rr: 2.2,
      levels: opposingLevels(dir, tech, inp.gex, 72),
    });
    if ('skip' in stops) return skip(key, stops.skip);

    let score = 48;
    score += Math.min(18, Math.abs(dv.fundZ ?? 0) * 6);
    score += dv.lsZ !== null && Math.abs(dv.lsZ) >= 2 ? 6 : 0;
    score += aligned(dir) ? 8 : htf.trend === 'lateral' ? 4 : 0;
    score += dv.oiChg1d !== null && ((dir === 'short' && dv.oiChg1d > 0) || (dir === 'long' && dv.oiChg1d < 0)) ? 4 : 0;

    const f = (v: number | null, d = 2) => (v === null ? 'N/D' : v.toFixed(d));
    setups.push({
      strategyKey: key,
      title: dir === 'long' ? 'Short squeeze: shorts saturados con precio estabilizándose' : 'Descompresión de largos saturados con precio debilitándose',
      dir,
      horizonHours: 72,
      entryLow: spot * 0.996,
      entryHigh: spot * 1.004,
      slPct: stops.slPct,
      tp1Pct: stops.tp1Pct,
      tp2Pct: stops.tp2Pct,
      regimeTags: tech.adx14 >= 18 ? ['gamma_flip', 'trend'] : ['gamma_flip'],
      rationale: [
        `Funding 1d z ${f(dv.fundZ)}, L/S z ${f(dv.lsZ)}, OI 1d ${dv.oiChg1d === null ? 'N/D' : `${dv.oiChg1d >= 0 ? '+' : ''}${dv.oiChg1d.toFixed(1)} %`}: posicionamiento ${dir === 'short' ? 'largo' : 'corto'} saturado.`,
        `Confirmación de precio: ${dir === 'short' ? `bajo VWAP 24 h ($${px(tech.vwap24h)}) o MACD negativo` : `sobre EMA20 ($${px(tech.ema20)}) o RSI ${tech.rsi14.toFixed(0)} > 45`}. Contexto ${htfTxt}.`,
        `SL tras el ${dir === 'long' ? 'mínimo' : 'máximo'} de 24 h ($${px(dir === 'long' ? lows24 : highs24)}).${stops.note ? ' ' + stops.note : ''}`,
      ],
      invalidation:
        dir === 'long'
          ? `Pérdida del mínimo de 24 h ($${px(lows24)}) o pivote S1 ($${px(tech.pivotS1)}).`
          : `Ruptura del máximo de 24 h ($${px(highs24)}) o pivote R1 ($${px(tech.pivotR1)}).`,
      techScore: clamp(Math.round(score), 30, 92),
    });
  })();

  return { setups, skipped };
}

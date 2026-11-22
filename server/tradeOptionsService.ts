import fs from 'fs';
import path from 'path';
import type {
  AssetId,
  Candle,
  ConfluenceFactor,
  MarketBiasSnapshot,
  ProposalRegimeTag,
  RegisteredTradeOption,
  TechnicalParametersSnapshot,
  TradeOptionProposal,
  TradeOptionsResponse,
} from './types.ts';
import {
  fetchDeribitDvol,
  fetchDeribitFundingHistory,
  fetchDeribitOptionsChain,
  fetchOkxCandles,
  fetchOkxFundingHistory,
  fetchOkxRubik,
} from './marketData.ts';
import {
  buildConeBlock,
  classifyRegime,
  computeBiasAnalysis,
  computeDerivativesReadings,
  computeGex,
  fitGjrGarch,
  simulateGarchPaths,
} from './quantEngine.ts';

const JOURNAL_DIR = path.resolve(process.cwd(), 'journal');
const TRADE_OPTIONS_FILE = path.join(JOURNAL_DIR, 'trade_options.jsonl');
const HOUR = 3_600_000;
// Tope conservador: el edge direccional no está validado (AUC ≈ 0,51 en /api/results).
const KELLY_CAP_PCT = 5;
// Drift máximo (%/24 h) que la confluencia puede inyectar en la simulación.
// 0 = neutro: el EV sale solo de geometría SL/TP + costes. Subirlo solo con edge medido forward.
const EDGE_TILT_MAX_PCT_24H = Number(process.env.EDGE_TILT_MAX_PCT_24H ?? 0);
const ROUND_TRIP_COST = 0.0007; // 0.07% mix maker/taker OKX

function roundPx(val: number, spot: number): number {
  const digits = spot >= 1000 ? 1 : spot >= 100 ? 2 : 3;
  return Number(val.toFixed(digits));
}

function emaSeries(values: number[], period: number): number[] {
  if (!values.length) return [];
  const alpha = 2 / (period + 1);
  const out = new Array<number>(values.length);
  out[0] = values[0];
  for (let i = 1; i < values.length; i++) {
    out[i] = values[i] * alpha + out[i - 1] * (1 - alpha);
  }
  return out;
}

export function computeTechnicalParameters(
  candles1h: Candle[],
  candles1d: Candle[],
): TechnicalParametersSnapshot {
  const n = candles1h.length;
  const highs = candles1h.map((c) => c[2]);
  const lows = candles1h.map((c) => c[3]);
  const closes = candles1h.map((c) => c[4]);
  const vols = candles1h.map((c) => c[5]);
  const spot = closes[n - 1];

  const ema20Arr = emaSeries(closes, 20);
  const ema50Arr = emaSeries(closes, 50);
  const ema200Arr = emaSeries(closes, 200);
  const ema20 = ema20Arr[n - 1];
  const ema50 = ema50Arr[n - 1];
  const ema200 = ema200Arr[n - 1];

  const sma50_1d =
    candles1d.length >= 50
      ? candles1d.slice(-50).reduce((s, c) => s + c[4], 0) / 50
      : null;

  // Wilder RSI(14)
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i < n; i++) {
    const diff = closes[i] - closes[i - 1];
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    avgGain = (avgGain * 13 + g) / 14;
    avgLoss = (avgLoss * 13 + l) / 14;
  }
  const rsi14 = avgLoss > 0 ? 100 - 100 / (1 + avgGain / avgLoss) : 100;

  // MACD (12, 26, 9)
  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = emaSeries(macdLine, 9);
  const macd = macdLine[n - 1];
  const macdSignal = signalLine[n - 1];
  const macdHist = macd - macdSignal;

  // ATR(14) & ADX(14)
  let smTr = 0;
  let smPlusDm = 0;
  let smMinusDm = 0;
  let adx14 = 20;
  let plusDi14 = 20;
  let minusDi14 = 20;
  const dxArr: number[] = [];

  for (let i = 1; i < n; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    );
    const upMove = highs[i] - highs[i - 1];
    const dnMove = lows[i - 1] - lows[i];
    const plusDm = upMove > dnMove && upMove > 0 ? upMove : 0;
    const minusDm = dnMove > upMove && dnMove > 0 ? dnMove : 0;

    if (i <= 14) {
      smTr += tr;
      smPlusDm += plusDm;
      smMinusDm += minusDm;
      if (i === 14 && smTr > 0) {
        plusDi14 = (100 * smPlusDm) / smTr;
        minusDi14 = (100 * smMinusDm) / smTr;
        const diSum = plusDi14 + minusDi14;
        dxArr.push(diSum > 0 ? (100 * Math.abs(plusDi14 - minusDi14)) / diSum : 0);
      }
    } else {
      smTr = smTr - smTr / 14 + tr;
      smPlusDm = smPlusDm - smPlusDm / 14 + plusDm;
      smMinusDm = smMinusDm - smMinusDm / 14 + minusDm;
      if (smTr > 0) {
        plusDi14 = (100 * smPlusDm) / smTr;
        minusDi14 = (100 * smMinusDm) / smTr;
        const diSum = plusDi14 + minusDi14;
        const dx = diSum > 0 ? (100 * Math.abs(plusDi14 - minusDi14)) / diSum : 0;
        dxArr.push(dx);
      }
    }
  }
  if (dxArr.length > 0) {
    adx14 = dxArr[0];
    for (let i = 1; i < dxArr.length; i++) {
      adx14 = (adx14 * 13 + dxArr[i]) / 14;
    }
  }
  const atr14 = smTr / 14;
  const atr14Pct = spot > 0 ? (atr14 / spot) * 100 : 1.0;

  // Bollinger Bands (20, 2)
  const bbSlice = closes.slice(-20);
  const bbMid = bbSlice.reduce((s, v) => s + v, 0) / bbSlice.length;
  const bbStd = Math.sqrt(
    bbSlice.reduce((s, v) => s + (v - bbMid) ** 2, 0) / Math.max(1, bbSlice.length - 1),
  );
  const bbUpper = bbMid + 2 * bbStd;
  const bbLower = bbMid - 2 * bbStd;
  const bbZ = bbStd > 0 ? (spot - bbMid) / bbStd : 0;
  const bbWidthPct = bbMid > 0 ? ((bbUpper - bbLower) / bbMid) * 100 : 0;

  // Rolling VWAP 24h & 7d
  const calcVwap = (len: number) => {
    const start = Math.max(0, n - len);
    let pv = 0;
    let vSum = 0;
    for (let i = start; i < n; i++) {
      const tp = (highs[i] + lows[i] + closes[i]) / 3;
      const v = Math.max(0, vols[i]);
      pv += tp * v;
      vSum += v;
    }
    return vSum > 0 ? pv / vSum : spot;
  };
  const vwap24h = calcVwap(24);
  const vwap7d = calcVwap(168);
  const vwapDistPct = vwap24h > 0 ? ((spot / vwap24h) - 1) * 100 : 0;

  // Stochastic Oscillator (14, 3)
  const kHist: number[] = [];
  for (let i = Math.max(14, n - 5); i < n; i++) {
    const hh = Math.max(...highs.slice(i - 13, i + 1));
    const ll = Math.min(...lows.slice(i - 13, i + 1));
    kHist.push(hh > ll ? ((closes[i] - ll) / (hh - ll)) * 100 : 50);
  }
  const stochK = kHist[kHist.length - 1] ?? 50;
  const stochD = kHist.slice(-3).reduce((s, v) => s + v, 0) / Math.max(1, Math.min(3, kHist.length));

  // RVOL (last 24h volume vs average 24h volume over trailing 7d)
  const vol24h = vols.slice(-24).reduce((s, v) => s + v, 0);
  const vol7dAvgDaily = vols.slice(-168).reduce((s, v) => s + v, 0) / Math.max(1, Math.min(7, vols.length / 24));
  const rvol24h = vol7dAvgDaily > 0 ? vol24h / vol7dAvgDaily : 1;

  // OBV trend (OBV vs 24h EMA of OBV)
  const obvArr = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) {
    if (closes[i] > closes[i - 1]) obvArr[i] = obvArr[i - 1] + vols[i];
    else if (closes[i] < closes[i - 1]) obvArr[i] = obvArr[i - 1] - vols[i];
    else obvArr[i] = obvArr[i - 1];
  }
  const obvEma = emaSeries(obvArr.slice(-120), 24);
  const obvLast = obvArr[n - 1];
  const obvRef = obvEma[obvEma.length - 1] ?? obvLast;
  const obvDiffRatio = Math.abs(obvRef) > 1e-6 ? (obvLast - obvRef) / Math.abs(obvRef) : 0;
  const obvTrend: TechnicalParametersSnapshot['obvTrend'] =
    obvDiffRatio > 0.015 ? 'alcista' : obvDiffRatio < -0.015 ? 'bajista' : 'neutral';

  // Structure 24h / 7d & Classic Daily Pivots
  const high24h = Math.max(...highs.slice(-24));
  const low24h = Math.min(...lows.slice(-24));
  const high7d = Math.max(...highs.slice(-168));
  const low7d = Math.min(...lows.slice(-168));

  const prevDay = candles1d.length >= 2 ? candles1d[candles1d.length - 2] : candles1d[0];
  const pivotP = (prevDay[2] + prevDay[3] + prevDay[4]) / 3;
  const pivotR1 = 2 * pivotP - prevDay[3];
  const pivotS1 = 2 * pivotP - prevDay[2];

  const trendBias: TechnicalParametersSnapshot['trendBias'] =
    spot > ema50 && ema20 > ema50 && adx14 >= 18
      ? 'alcista'
      : spot < ema50 && ema20 < ema50 && adx14 >= 18
        ? 'bajista'
        : 'lateral';

  return {
    spot: roundPx(spot, spot),
    ema20: roundPx(ema20, spot),
    ema50: roundPx(ema50, spot),
    ema200: roundPx(ema200, spot),
    sma50_1d: sma50_1d !== null ? roundPx(sma50_1d, spot) : null,
    rsi14: Number(rsi14.toFixed(1)),
    macd: Number(macd.toFixed(spot >= 500 ? 2 : 4)),
    macdSignal: Number(macdSignal.toFixed(spot >= 500 ? 2 : 4)),
    macdHist: Number(macdHist.toFixed(spot >= 500 ? 2 : 4)),
    adx14: Number(adx14.toFixed(1)),
    plusDi14: Number(plusDi14.toFixed(1)),
    minusDi14: Number(minusDi14.toFixed(1)),
    atr14: roundPx(atr14, spot),
    atr14Pct: Number(atr14Pct.toFixed(2)),
    bbUpper: roundPx(bbUpper, spot),
    bbMid: roundPx(bbMid, spot),
    bbLower: roundPx(bbLower, spot),
    bbZ: Number(bbZ.toFixed(2)),
    bbWidthPct: Number(bbWidthPct.toFixed(2)),
    vwap24h: roundPx(vwap24h, spot),
    vwap7d: roundPx(vwap7d, spot),
    vwapDistPct: Number(vwapDistPct.toFixed(2)),
    stochK: Number(stochK.toFixed(1)),
    stochD: Number(stochD.toFixed(1)),
    rvol24h: Number(rvol24h.toFixed(2)),
    obvTrend,
    high24h: roundPx(high24h, spot),
    low24h: roundPx(low24h, spot),
    high7d: roundPx(high7d, spot),
    low7d: roundPx(low7d, spot),
    pivotP: roundPx(pivotP, spot),
    pivotR1: roundPx(pivotR1, spot),
    pivotS1: roundPx(pivotS1, spot),
    trendBias,
  };
}

function evaluateOnPaths(
  cumPaths: Float64Array[],
  horizon: number,
  dir: 'long' | 'short',
  slPct: number,
  tpPct: number,
  drift24hPct: number,
) {
  const N = cumPaths.length;
  const sl = Math.max(0.004, slPct / 100);
  const tp = Math.max(0.005, tpPct / 100);
  const driftPerHour = drift24hPct / 100 / 24;
  const isLong = dir === 'long';

  let winCnt = 0;
  let lossCnt = 0;
  let toCnt = 0;
  let sumOut = 0;
  let sumX = 0;
  let sumX2 = 0;

  for (let i = 0; i < N; i++) {
    const path = cumPaths[i];
    let exitStep = horizon - 1;
    let outcome: 'win' | 'loss' | 'to' = 'to';
    for (let s = 0; s < horizon; s++) {
      const ret = Math.exp(path[s] + driftPerHour * (s + 1)) - 1;
      const hitWin = isLong ? ret >= tp : ret <= -tp;
      const hitLoss = isLong ? ret <= -sl : ret >= sl;
      if (hitWin || hitLoss) {
        exitStep = s;
        outcome = hitWin && !hitLoss ? 'win' : 'loss';
        break;
      }
    }
    if (outcome === 'win') winCnt++;
    else if (outcome === 'loss') lossCnt++;
    else toCnt++;

    const exitRet = Math.exp(path[exitStep] + driftPerHour * (exitStep + 1)) - 1;
    const out = (isLong ? 1 : -1) * exitRet - ROUND_TRIP_COST;
    const rMult = out / sl;
    sumOut += out;
    sumX += rMult;
    sumX2 += rMult * rMult;
  }

  const ev = sumOut / N;
  const evR = sumX / N;
  const meanX2 = sumX2 / N;
  const kelly = evR > 0 && meanX2 > 0 ? evR / meanX2 : 0;

  return {
    probTpPct: Number(((winCnt / N) * 100).toFixed(1)),
    probSlPct: Number(((lossCnt / N) * 100).toFixed(1)),
    probTimeoutPct: Number(((toCnt / N) * 100).toFixed(1)),
    evPct: Number((ev * 100).toFixed(3)),
    evR: Number(evR.toFixed(3)),
    kellyPct: Number(Math.min(KELLY_CAP_PCT, kelly * 100).toFixed(1)),
  };
}

export function loadRegisteredTradeOptions(): RegisteredTradeOption[] {
  if (!fs.existsSync(TRADE_OPTIONS_FILE)) return [];
  const raw = fs.readFileSync(TRADE_OPTIONS_FILE, 'utf-8');
  return raw
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as RegisteredTradeOption);
}

function writeRegisteredTradeOptions(rows: RegisteredTradeOption[]) {
  fs.mkdirSync(JOURNAL_DIR, { recursive: true });
  const sorted = [...rows].sort((a, b) => b.createdTs - a.createdTs);
  fs.writeFileSync(
    TRADE_OPTIONS_FILE,
    sorted.map((r) => JSON.stringify(r)).join('\n') + (sorted.length ? '\n' : ''),
    'utf-8',
  );
}

export function upsertRegisteredTradeOption(row: RegisteredTradeOption): RegisteredTradeOption {
  const existing = loadRegisteredTradeOptions();
  const byId = new Map<string, RegisteredTradeOption>();
  for (const r of existing) byId.set(r.id, r);
  byId.set(row.id, row);
  writeRegisteredTradeOptions(Array.from(byId.values()));
  return row;
}

export function deleteRegisteredTradeOptionById(id: string): boolean {
  const existing = loadRegisteredTradeOptions();
  const filtered = existing.filter((r) => r.id !== id);
  if (filtered.length === existing.length) return false;
  writeRegisteredTradeOptions(filtered);
  return true;
}

export function closeRegisteredTradeOptionManual(
  id: string,
  exitPrice: number,
): RegisteredTradeOption | null {
  const existing = loadRegisteredTradeOptions();
  const idx = existing.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  const item = existing[idx];
  if (item.status !== 'open') return item;
  const sign = item.dir === 'long' ? 1 : -1;
  const rawPnl = sign * ((exitPrice / item.entryPrice) - 1) - ROUND_TRIP_COST;
  const updated: RegisteredTradeOption = {
    ...item,
    status: 'closed_manual',
    evaluatedTs: Date.now(),
    exitPrice: roundPx(exitPrice, item.entryPrice),
    realizedPnlPct: Number((rawPnl * 100).toFixed(2)),
  };
  existing[idx] = updated;
  writeRegisteredTradeOptions(existing);
  return updated;
}

/**
 * Evaluates open registered trade options against subsequent closed 1H OKX candles.
 */
export function evaluateTradeOptionsWithCandles(
  asset: AssetId,
  candles1h: Candle[],
): { all: RegisteredTradeOption[]; changed: boolean } {
  const all = loadRegisteredTradeOptions();
  let changed = false;

  for (let i = 0; i < all.length; i++) {
    const op = all[i];
    if (op.asset !== asset || op.status !== 'open') continue;

    const expiryTs = op.createdTs + op.horizonHours * HOUR;
    const future = candles1h.filter((c) => c[0] > op.createdTs && c[0] <= expiryTs);
    if (future.length === 0) continue;

    const isLong = op.dir === 'long';
    let mfe = 0;
    let mae = 0;
    let resolved: RegisteredTradeOption | null = null;

    for (const c of future) {
      const high = c[2];
      const low = c[3];
      const favMove = isLong ? (high / op.entryPrice - 1) * 100 : (1 - low / op.entryPrice) * 100;
      const advMove = isLong ? (low / op.entryPrice - 1) * 100 : (1 - high / op.entryPrice) * 100;
      mfe = Math.max(mfe, favMove);
      mae = Math.min(mae, advMove);

      const hitSl = isLong ? low <= op.stopLoss : high >= op.stopLoss;
      const hitTp = isLong ? high >= op.takeProfit1 : low <= op.takeProfit1;

      // Conservative ordering: if both SL and TP occur in the same 1H candle, SL triggers first
      if (hitSl) {
        const pnl = isLong
          ? (op.stopLoss / op.entryPrice - 1) - ROUND_TRIP_COST
          : (1 - op.stopLoss / op.entryPrice) - ROUND_TRIP_COST;
        resolved = {
          ...op,
          status: 'sl_hit',
          evaluatedTs: c[0],
          exitPrice: op.stopLoss,
          realizedPnlPct: Number((pnl * 100).toFixed(2)),
          mfePct: Number(mfe.toFixed(2)),
          maePct: Number(mae.toFixed(2)),
        };
        break;
      }
      if (hitTp) {
        const pnl = isLong
          ? (op.takeProfit1 / op.entryPrice - 1) - ROUND_TRIP_COST
          : (1 - op.takeProfit1 / op.entryPrice) - ROUND_TRIP_COST;
        resolved = {
          ...op,
          status: 'tp_hit',
          evaluatedTs: c[0],
          exitPrice: op.takeProfit1,
          realizedPnlPct: Number((pnl * 100).toFixed(2)),
          mfePct: Number(mfe.toFixed(2)),
          maePct: Number(mae.toFixed(2)),
        };
        break;
      }
    }

    if (!resolved) {
      const latestTs = future[future.length - 1][0];
      const lastClose = future[future.length - 1][4];
      if (latestTs >= expiryTs - HOUR) {
        const pnl =
          (isLong ? lastClose / op.entryPrice - 1 : 1 - lastClose / op.entryPrice) - ROUND_TRIP_COST;
        resolved = {
          ...op,
          status: 'expired',
          evaluatedTs: latestTs,
          exitPrice: roundPx(lastClose, op.entryPrice),
          realizedPnlPct: Number((pnl * 100).toFixed(2)),
          mfePct: Number(mfe.toFixed(2)),
          maePct: Number(mae.toFixed(2)),
        };
      }
    }

    if (resolved) {
      all[i] = resolved;
      changed = true;
    }
  }

  if (changed) writeRegisteredTradeOptions(all);
  return { all, changed };
}

function summarizeTradeOptionStats(rows: RegisteredTradeOption[]) {
  const closed = rows.filter((r) => r.status !== 'open');
  const tpHit = rows.filter((r) => r.status === 'tp_hit').length;
  const slHit = rows.filter((r) => r.status === 'sl_hit').length;
  const expired = rows.filter((r) => r.status === 'expired').length;
  const decided = tpHit + slHit;
  const pnls = closed
    .map((r) => r.realizedPnlPct)
    .filter((v): v is number => v !== null && Number.isFinite(v));

  return {
    total: rows.length,
    open: rows.filter((r) => r.status === 'open').length,
    tpHit,
    slHit,
    expired,
    winRatePct: decided > 0 ? Number(((tpHit / decided) * 100).toFixed(1)) : null,
    avgPnlPct: pnls.length > 0 ? Number((pnls.reduce((s, v) => s + v, 0) / pnls.length).toFixed(2)) : null,
  };
}

export function proposalToRegisteredRecord(
  p: TradeOptionProposal,
  source: 'auto' | 'manual',
  createdTs: number,
  bucketSuffix?: string,
): RegisteredTradeOption {
  const safeId = bucketSuffix ? `${p.asset}_${p.strategyKey}_${bucketSuffix}` : p.id;
  return {
    id: safeId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120),
    asset: p.asset,
    strategyKey: p.strategyKey,
    title: p.title,
    dir: p.dir,
    horizonHours: p.horizonHours,
    createdTs,
    createdIso: new Date(createdTs).toISOString(),
    entryPrice: p.entryMid,
    entryLow: p.entryLow,
    entryHigh: p.entryHigh,
    stopLoss: p.stopLoss,
    slPct: p.slPct,
    takeProfit1: p.takeProfit1,
    tp1Pct: p.tp1Pct,
    takeProfit2: p.takeProfit2,
    rr: p.rr,
    probTpPct: p.probTpPct,
    evPct: p.evPct,
    confluenceScore: p.confluenceScore,
    confidence: p.confidence,
    source,
    status: 'open',
    evaluatedTs: null,
    exitPrice: null,
    realizedPnlPct: null,
    mfePct: null,
    maePct: null,
    summary: p.rationale[0]?.slice(0, 200) ?? `${p.title} (${p.dir})`,
  };
}

const cache = new Map<string, { ts: number; data: TradeOptionsResponse }>();
const inflight = new Map<string, Promise<TradeOptionsResponse>>();

export async function computeTradeOptions(
  asset: AssetId,
  refresh = false,
  autoRecordTop = true,
): Promise<TradeOptionsResponse> {
  const key = asset;
  const cached = cache.get(key);
  if (!refresh && cached && Date.now() - cached.ts < 60_000) {
    // Re-attach latest registered list in case a manual trade was saved
    const registered = loadRegisteredTradeOptions();
    return {
      ...cached.data,
      registered,
      stats: summarizeTradeOptionStats(registered),
    };
  }

  const pending = inflight.get(key);
  if (pending) return pending;

  const job = (async (): Promise<TradeOptionsResponse> => {
    const [candles1h, candles1d, oiDaily, lsDaily] = await Promise.all([
      fetchOkxCandles(asset, '1H', 1100, refresh),
      fetchOkxCandles(asset, '1D', 200, refresh),
      fetchOkxRubik(asset, 'contracts/open-interest-history', {}, 140, refresh),
      fetchOkxRubik(asset, 'contracts/long-short-account-ratio-contract', {}, 140, refresh),
    ]);

    const [deribitFund, okxFund, dvolHourly, chainSnapshot] = await Promise.all([
      asset === 'sol' ? Promise.resolve(undefined) : fetchDeribitFundingHistory(asset, 140, refresh),
      asset === 'sol' ? fetchOkxFundingHistory(asset, 400, refresh) : Promise.resolve(undefined),
      asset === 'sol' ? Promise.resolve(undefined) : fetchDeribitDvol(asset, 140, refresh),
      asset === 'sol' ? Promise.resolve(null) : fetchDeribitOptionsChain(asset, refresh),
    ]);

    const tech = computeTechnicalParameters(candles1h, candles1d);
    const closes = candles1h.map((c) => c[4]);
    const spot = closes[closes.length - 1];
    const regime = classifyRegime(closes);
    const { block } = buildConeBlock(candles1h, 72, HOUR, 3000, '1H', 168);

    const readings = computeDerivativesReadings({
      candles1h,
      oiDaily,
      lsDaily,
      deribitFunding: deribitFund,
      okxFunding: okxFund,
      dvolHourly,
    });
    const bias = computeBiasAnalysis({
      asset,
      candles1d,
      oiDaily,
      lsDaily,
      deribitFunding: deribitFund,
      okxFunding: okxFund,
      dvolHourly,
    });
    const gex = chainSnapshot && asset !== 'sol' ? computeGex(asset, chainSnapshot) : null;

    const inTrendRegime = tech.adx14 >= 20 && tech.trendBias !== 'lateral';
    let marketBias: MarketBiasSnapshot;
    if (gex) {
      const positiveGexM = Number(
        gex.term_buckets.reduce((s, b) => s + Math.max(0, b.call_gex_m), 0).toFixed(2),
      );
      const negativeGexM = Number(
        gex.term_buckets.reduce((s, b) => s + Math.min(0, b.put_gex_m), 0).toFixed(2),
      );
      const netGexDiffM = Number((positiveGexM + negativeGexM).toFixed(2));
      const totalAbs = positiveGexM + Math.abs(negativeGexM);
      const imbalancePct = totalAbs > 0 ? Number(((netGexDiffM / totalAbs) * 100).toFixed(1)) : 0;
      const gammaFlip = gex.flip;
      const flipDistancePct =
        gammaFlip !== null && spot > 0
          ? Number((((spot - gammaFlip) / spot) * 100).toFixed(2))
          : null;
      const inGammaFlipZone =
        (flipDistancePct !== null && Math.abs(flipDistancePct) <= 2.5) || netGexDiffM < 0;
      const activeRegime: MarketBiasSnapshot['activeRegime'] = inGammaFlipZone
        ? 'gamma_flip'
        : inTrendRegime
          ? 'trend'
          : 'balanced';

      const biasDirection: MarketBiasSnapshot['biasDirection'] =
        netGexDiffM > 2 || (flipDistancePct !== null && flipDistancePct > 1.0 && netGexDiffM >= 0)
          ? 'alcista'
          : netGexDiffM < -2 || (flipDistancePct !== null && flipDistancePct < -1.0)
            ? 'bajista'
            : 'neutral';

      const fmtSignedNet = `${netGexDiffM >= 0 ? '+$' : '-$'}${Math.abs(netGexDiffM).toFixed(1)}M`;
      const biasLabel =
        biasDirection === 'alcista'
          ? `GEX Positivo Dominante (${fmtSignedNet})`
          : biasDirection === 'bajista'
            ? `GEX Negativo Dominante (${fmtSignedNet})`
            : `GEX Equilibrado (${fmtSignedNet})`;

      marketBias = {
        gexAvailable: true,
        positiveGexM,
        negativeGexM,
        netGexDiffM,
        imbalancePct,
        gammaFlip,
        flipDistancePct,
        inGammaFlipZone,
        inTrendRegime,
        activeRegime,
        biasDirection,
        biasLabel,
        termGex: gex.term_buckets.map((b) => ({
          bucket: b.bucket,
          positiveM: Number(b.call_gex_m.toFixed(2)),
          negativeM: Number(b.put_gex_m.toFixed(2)),
          netM: Number(b.net_gex_m.toFixed(2)),
        })),
      };
    } else {
      const biasDirection: MarketBiasSnapshot['biasDirection'] =
        tech.trendBias === 'alcista' ? 'alcista' : tech.trendBias === 'bajista' ? 'bajista' : 'neutral';
      marketBias = {
        gexAvailable: false,
        positiveGexM: null,
        negativeGexM: null,
        netGexDiffM: null,
        imbalancePct: null,
        gammaFlip: null,
        flipDistancePct: null,
        inGammaFlipZone: false,
        inTrendRegime,
        activeRegime: inTrendRegime ? 'trend' : 'balanced',
        biasDirection,
        biasLabel: `Sin cadena GEX Deribit · Sesgo técnico ${tech.trendBias}`,
        termGex: [],
      };
    }

    // Fit GJR-GARCH once for fast multi-setup probability simulation
    const lr: number[] = [];
    for (let i = 1; i < closes.length; i++) lr.push(Math.log(closes[i] / closes[i - 1]));
    const rPct = lr.map((x) => x * 100);
    const fit = fitGjrGarch(rPct);
    const cumPaths = simulateGarchPaths(fit, rPct[rPct.length - 1], 72, 4000, 17, true);

    const anchorTs = block.last_ts;
    const bucketKey = String(Math.floor(anchorTs / (4 * HOUR)));

    // Build Confluence Factor Pool
    const buildFactorsForDir = (targetDir: 'long' | 'short'): ConfluenceFactor[] => {
      const f: ConfluenceFactor[] = [];

      // 1. EMA Alignment
      const emaBull = spot > tech.ema20 && tech.ema20 > tech.ema50;
      const emaBear = spot < tech.ema20 && tech.ema20 < tech.ema50;
      f.push({
        name: 'Estructura EMA 20/50',
        category: 'técnico',
        reading: `Spot $${spot.toLocaleString('en-US')} vs EMA20 $${tech.ema20.toLocaleString('en-US')} / EMA50 $${tech.ema50.toLocaleString('en-US')}`,
        signal: emaBull ? 'long' : emaBear ? 'short' : 'neutral',
        weight: 16,
      });

      // 2. MACD Histogram
      f.push({
        name: 'MACD (12,26,9)',
        category: 'técnico',
        reading: `Hist ${tech.macdHist >= 0 ? '+' : ''}${tech.macdHist} (${tech.macd >= tech.macdSignal ? 'cruce alcista' : 'cruce bajista'})`,
        signal: tech.macdHist > 0 && tech.macd > tech.macdSignal ? 'long' : tech.macdHist < 0 && tech.macd < tech.macdSignal ? 'short' : 'neutral',
        weight: 12,
      });

      // 3. ADX + DI
      f.push({
        name: 'Fuerza Tendencial ADX(14)',
        category: 'técnico',
        reading: `ADX ${tech.adx14.toFixed(1)} · +DI ${tech.plusDi14.toFixed(1)} / -DI ${tech.minusDi14.toFixed(1)}`,
        signal:
          tech.adx14 >= 20
            ? tech.plusDi14 > tech.minusDi14
              ? 'long'
              : 'short'
            : 'neutral',
        weight: 12,
      });

      // 4. RSI & Bollinger Mean Reversion vs Extension
      const rsiSig: ConfluenceFactor['signal'] =
        tech.rsi14 <= 38 || tech.bbZ <= -1.4
          ? 'long'
          : tech.rsi14 >= 62 || tech.bbZ >= 1.4
            ? 'short'
            : targetDir === 'long' && tech.rsi14 >= 50 && tech.rsi14 < 65
              ? 'long'
              : targetDir === 'short' && tech.rsi14 <= 50 && tech.rsi14 > 35
                ? 'short'
                : 'neutral';
      f.push({
        name: 'Osciladores RSI(14) & BB(20)',
        category: 'técnico',
        reading: `RSI ${tech.rsi14.toFixed(1)} · Bollinger Z ${tech.bbZ >= 0 ? '+' : ''}${tech.bbZ.toFixed(2)}`,
        signal: rsiSig,
        weight: 14,
      });

      // 5. VWAP 24h & OBV Flow
      f.push({
        name: 'Flujo VWAP 24h & OBV',
        category: 'técnico',
        reading: `Dist. VWAP ${tech.vwapDistPct >= 0 ? '+' : ''}${tech.vwapDistPct.toFixed(2)}% · OBV ${tech.obvTrend} · RVOL ${tech.rvol24h.toFixed(2)}x`,
        signal:
          tech.vwapDistPct > 0.15 && tech.obvTrend === 'alcista'
            ? 'long'
            : tech.vwapDistPct < -0.15 && tech.obvTrend === 'bajista'
              ? 'short'
              : 'neutral',
        weight: 12,
      });

      // 6. Derivatives Positioning (Funding Z & OI 1d)
      const fz = readings.fund_1d_z;
      const oic = readings.oi_chg_1d;
      let derivSig: ConfluenceFactor['signal'] = 'neutral';
      if ((fz !== null && fz < -1.2) || (oic !== null && oic < -4)) derivSig = 'long';
      else if ((fz !== null && fz > 1.5) || (readings.ls_z !== null && readings.ls_z > 1.5)) derivSig = 'short';
      f.push({
        name: 'Derivados (Funding Z / OI / L-S)',
        category: 'derivados',
        reading: `Fund z ${fz !== null ? fz.toFixed(2) : '—'} · OI 1d ${oic !== null ? `${oic >= 0 ? '+' : ''}${oic.toFixed(1)}%` : '—'}`,
        signal: derivSig,
        weight: 14,
      });

      // 7. GEX Dealer Positioning (BTC/ETH) or IV/Vol Percentile
      if (gex) {
        const aboveFlip = gex.flip !== null ? spot >= gex.flip : gex.net_gex_m > 0;
        f.push({
          name: 'Gamma Exposición (GEX Deribit)',
          category: 'gex',
          reading: `Net GEX $${gex.net_gex_m.toFixed(1)}M · Put Wall $${gex.put_wall?.toLocaleString('en-US') ?? '—'} · Call Wall $${gex.call_wall?.toLocaleString('en-US') ?? '—'}`,
          signal: aboveFlip ? 'long' : 'short',
          weight: 10,
        });
      } else {
        f.push({
          name: 'Régimen de Volatilidad',
          category: 'volatilidad',
          reading: `${regime.current} (P${block.vol_pctile.toFixed(0)} · Vol ${ (block.vol_now_ann * 100).toFixed(1)}%)`,
          signal: regime.current === 'Calma' ? targetDir : 'neutral',
          weight: 10,
        });
      }

      // 8. Logistic Model B & GARCH P(up)
      const pUp = bias.p_up.B1 ?? (block.p_close_up['up_24'] ?? 0.5) * 100;
      f.push({
        name: 'Modelo Logístico P(subida 24h)',
        category: 'volatilidad',
        reading: `P(up) ${pUp.toFixed(1)}% (Base ${bias.p_up.base1 !== null ? `${bias.p_up.base1.toFixed(1)}%` : '50%'})`,
        signal: pUp >= 53 ? 'long' : pUp <= 47 ? 'short' : 'neutral',
        weight: 10,
      });

      return f;
    };

    const scoreConfluence = (factors: ConfluenceFactor[], targetDir: 'long' | 'short') => {
      let totalW = 0;
      let alignedW = 0;
      for (const f of factors) {
        totalW += f.weight;
        if (f.signal === targetDir) alignedW += f.weight;
        else if (f.signal === 'neutral') alignedW += f.weight * 0.45;
      }
      return Math.round(Math.min(95, Math.max(25, (alignedW / Math.max(1, totalW)) * 100)));
    };

    const atrPct = Math.max(0.45, tech.atr14Pct);

    // Helper to build a single evaluated TradeOptionProposal
    const makeProposal = (spec: {
      strategyKey: TradeOptionProposal['strategyKey'];
      title: string;
      dir: 'long' | 'short';
      horizonHours: 24 | 72;
      entryLow: number;
      entryHigh: number;
      slPct: number;
      tp1Pct: number;
      tp2Pct: number;
      regimeTags: ProposalRegimeTag[];
      rationale: string[];
      invalidation: string;
    }): TradeOptionProposal => {
      const isLong = spec.dir === 'long';
      const entryMid = roundPx((spec.entryLow + spec.entryHigh) / 2, spot);
      const slPct = Number(Math.min(8.5, Math.max(0.8, spec.slPct)).toFixed(2));
      const tp1Pct = Number(Math.min(18.0, Math.max(1.2, spec.tp1Pct)).toFixed(2));
      const tp2Pct = Number(Math.max(tp1Pct * 1.45, spec.tp2Pct).toFixed(2));

      const stopLoss = roundPx(spot * (1 + (isLong ? -slPct : slPct) / 100), spot);
      const takeProfit1 = roundPx(spot * (1 + (isLong ? tp1Pct : -tp1Pct) / 100), spot);
      const takeProfit2 = roundPx(spot * (1 + (isLong ? tp2Pct : -tp2Pct) / 100), spot);

      const factors = buildFactorsForDir(spec.dir);
      const confluenceScore = scoreConfluence(factors, spec.dir);
      // Drift condicional por confluencia, DESACTIVADO por defecto (EDGE_TILT_MAX_PCT_24H=0).
      const edgeTilt = ((confluenceScore - 50) / 50) * EDGE_TILT_MAX_PCT_24H * (isLong ? 1 : -1);
      const sim = evaluateOnPaths(cumPaths, spec.horizonHours, spec.dir, slPct, tp1Pct, edgeTilt);

      const confidence: TradeOptionProposal['confidence'] =
        confluenceScore >= 68 && sim.probTpPct >= 44
          ? 'Alta'
          : confluenceScore >= 54 && sim.probTpPct >= 34
            ? 'Media'
            : 'Moderada';

      return {
        id: `${asset}_${spec.strategyKey}_${bucketKey}`,
        asset,
        strategyKey: spec.strategyKey,
        title: spec.title,
        dir: spec.dir,
        horizonHours: spec.horizonHours,
        spot: roundPx(spot, spot),
        entryLow: roundPx(Math.min(spec.entryLow, spec.entryHigh), spot),
        entryHigh: roundPx(Math.max(spec.entryLow, spec.entryHigh), spot),
        entryMid,
        stopLoss,
        slPct,
        takeProfit1,
        tp1Pct,
        takeProfit2,
        tp2Pct,
        rr: Number((tp1Pct / slPct).toFixed(2)),
        probTpPct: sim.probTpPct,
        probSlPct: sim.probSlPct,
        probTimeoutPct: sim.probTimeoutPct,
        evPct: sim.evPct,
        evR: sim.evR,
        kellyPct: sim.kellyPct,
        confluenceScore,
        confidence,
        regimeTags: spec.regimeTags,
        rationale: spec.rationale,
        invalidation: spec.invalidation,
        factors,
      };
    };

    // 1. Trend Pullback / Continuation Setup
    const trendDir: 'long' | 'short' =
      tech.trendBias === 'bajista' || (tech.ema20 < tech.ema50 && tech.macdHist < 0) ? 'short' : 'long';
    const trendSlPct = Math.max(1.2, atrPct * 1.9);
    const trendTp1Pct = Math.max(2.2, atrPct * 3.4);
    const trendProp = makeProposal({
      strategyKey: 'trend_pullback',
      title:
        trendDir === 'long'
          ? 'Continuación Alcista sobre EMA20 / VWAP'
          : 'Continuación Bajista bajo EMA20 / VWAP',
      dir: trendDir,
      horizonHours: 72,
      entryLow: trendDir === 'long' ? Math.min(spot, tech.ema20) * 0.997 : spot * 0.998,
      entryHigh: trendDir === 'long' ? spot * 1.002 : Math.max(spot, tech.ema20) * 1.003,
      slPct: trendSlPct,
      tp1Pct: trendTp1Pct,
      tp2Pct: trendTp1Pct * 1.6,
      regimeTags:
        marketBias.netGexDiffM !== null && marketBias.netGexDiffM < -5
          ? ['trend', 'gamma_flip']
          : ['trend'],
      rationale: [
        `Sesgo técnico ${tech.trendBias} con ADX(14) en ${tech.adx14.toFixed(1)} (+DI ${tech.plusDi14.toFixed(1)} / -DI ${tech.minusDi14.toFixed(1)}).`,
        `Spot frente a EMA20 ($${tech.ema20.toLocaleString('en-US')}) y EMA50 ($${tech.ema50.toLocaleString('en-US')}); MACD hist ${tech.macdHist >= 0 ? '+' : ''}${tech.macdHist}.`,
        `Horizonte de 72h alineado con ATR(14) de ${atrPct.toFixed(2)} % (${trendDir === 'long' ? 'objetivo hacia cuantil 75 GARCH' : 'objetivo hacia cuantil 25 GARCH'}).`,
      ],
      invalidation:
        trendDir === 'long'
          ? `Cierre horario bajo EMA50 ($${tech.ema50.toLocaleString('en-US')}) o pérdida de $${roundPx(spot * (1 - trendSlPct / 100), spot).toLocaleString('en-US')}.`
          : `Recuperación sobre EMA50 ($${tech.ema50.toLocaleString('en-US')}) o ruptura sobre $${roundPx(spot * (1 + trendSlPct / 100), spot).toLocaleString('en-US')}.`,
    });

    // 2. Mean Reversion Setup (RSI + Bollinger + GEX Walls / 24h Range)
    const mrDir: 'long' | 'short' =
      tech.bbZ < -0.35 || tech.rsi14 < 48 || (gex?.put_wall && Math.abs(spot / gex.put_wall - 1) < 0.025)
        ? 'long'
        : 'short';
    const mrSlPct = Math.max(1.0, atrPct * 1.6);
    const mrTp1Pct = Math.max(1.8, Math.min(4.2, Math.abs(tech.vwapDistPct) + atrPct * 2.1));
    const mrProp = makeProposal({
      strategyKey: 'mean_reversion',
      title:
        mrDir === 'long'
          ? 'Reversión a la Media hacia VWAP / BB Media (Largo)'
          : 'Reversión a la Media hacia VWAP / BB Media (Corto)',
      dir: mrDir,
      horizonHours: 24,
      entryLow: mrDir === 'long' ? Math.max(tech.low24h, spot * 0.994) : spot * 0.999,
      entryHigh: mrDir === 'long' ? spot * 1.001 : Math.min(tech.high24h, spot * 1.006),
      slPct: mrSlPct,
      tp1Pct: mrTp1Pct,
      tp2Pct: mrTp1Pct * 1.5,
      regimeTags: ['gamma_flip'],
      rationale: [
        `RSI(14) en ${tech.rsi14.toFixed(1)}, Estocástico %K ${tech.stochK.toFixed(1)} y Bollinger Z en ${tech.bbZ >= 0 ? '+' : ''}${tech.bbZ.toFixed(2)}.`,
        gex
          ? `Gamma neta Deribit ${gex.net_gex_m >= 0 ? 'positiva' : 'negativa'} ($${gex.net_gex_m.toFixed(1)}M); Put Wall $${gex.put_wall?.toLocaleString('en-US') ?? '—'} / Call Wall $${gex.call_wall?.toLocaleString('en-US') ?? '—'}.`
          : `Rango 24h entre $${tech.low24h.toLocaleString('en-US')} y $${tech.high24h.toLocaleString('en-US')} con VWAP en $${tech.vwap24h.toLocaleString('en-US')}.`,
        `Cono GARCH 24h proyecta dispersión ±${(((block.cone['90'][24] / spot) - 1) * 100).toFixed(1)} % en banda del 90 %.`,
      ],
      invalidation:
        mrDir === 'long'
          ? `Pérdida del mínimo 24h ($${tech.low24h.toLocaleString('en-US')}) con expansión de volumen.`
          : `Ruptura limpia sobre el máximo 24h ($${tech.high24h.toLocaleString('en-US')}) con RVOL > 1.3x.`,
    });

    // 3. Derivatives Positioning / Squeeze Setup
    const derivDir: 'long' | 'short' =
      (readings.fund_1d_z !== null && readings.fund_1d_z > 0.8) ||
      (readings.ls_z !== null && readings.ls_z > 1.0)
        ? 'short'
        : 'long';
    const derivSlPct = Math.max(1.5, atrPct * 2.1);
    const derivTp1Pct = Math.max(2.6, atrPct * 3.8);
    const derivProp = makeProposal({
      strategyKey: 'derivatives_squeeze',
      title:
        derivDir === 'long'
          ? 'Asimetría de Derivados / Short-Squeeze Potencial'
          : 'Asimetría de Derivados / Descompresión Larga',
      dir: derivDir,
      horizonHours: 72,
      entryLow: spot * 0.996,
      entryHigh: spot * 1.004,
      slPct: derivSlPct,
      tp1Pct: derivTp1Pct,
      tp2Pct: derivTp1Pct * 1.55,
      regimeTags:
        marketBias.inGammaFlipZone || tech.adx14 >= 18
          ? ['gamma_flip', 'trend']
          : ['gamma_flip'],
      rationale: [
        `Funding 1d z-score ${readings.fund_1d_z !== null ? readings.fund_1d_z.toFixed(2) : 'N/D'}, OI 1d ${readings.oi_chg_1d !== null ? `${readings.oi_chg_1d >= 0 ? '+' : ''}${readings.oi_chg_1d.toFixed(1)}%` : 'N/D'} y L/S z ${readings.ls_z !== null ? readings.ls_z.toFixed(2) : 'N/D'}.`,
        `Diferencial IV-RV en ${readings.iv_rv !== null ? `${readings.iv_rv >= 0 ? '+' : ''}${readings.iv_rv.toFixed(1)} pts` : 'N/D'}; DVOL ${readings.dvol !== null ? `${readings.dvol.toFixed(1)}%` : 'N/D'}.`,
        `Modelo logístico B estima P(subida 72h) = ${bias.p_up.B3 !== null ? `${bias.p_up.B3.toFixed(1)}%` : `${((block.p_close_up['up_72'] ?? 0.5) * 100).toFixed(1)}%`}.`,
      ],
      invalidation: `Cambio adverso de flujo OBV (${tech.obvTrend}) o ruptura de Pivot ${derivDir === 'long' ? `S1 ($${tech.pivotS1.toLocaleString('en-US')})` : `R1 ($${tech.pivotR1.toLocaleString('en-US')})`}.`,
    });

    // 4. Volatility Breakout / Range Pivot Setup
    const brkDir: 'long' | 'short' =
      spot >= tech.pivotP && tech.obvTrend !== 'bajista' ? 'long' : 'short';
    const brkSlPct = Math.max(1.1, atrPct * 1.7);
    const brkTp1Pct = Math.max(2.0, atrPct * 3.0);
    const brkProp = makeProposal({
      strategyKey: 'range_breakout',
      title:
        brkDir === 'long'
          ? 'Ruptura de Pivote Diario hacia R1 / Banda Superior'
          : 'Quiebre de Pivote Diario hacia S1 / Banda Inferior',
      dir: brkDir,
      horizonHours: 24,
      entryLow: brkDir === 'long' ? Math.min(spot, tech.pivotP) : spot * 0.998,
      entryHigh: brkDir === 'long' ? spot * 1.003 : Math.max(spot, tech.pivotP),
      slPct: brkSlPct,
      tp1Pct: brkTp1Pct,
      tp2Pct: brkTp1Pct * 1.5,
      regimeTags: ['trend', 'gamma_flip'],
      rationale: [
        `Ancho Bollinger ${tech.bbWidthPct.toFixed(2)} % y RVOL 24h de ${tech.rvol24h.toFixed(2)}x respecto a la media de 7 días.`,
        `Nivel Pivote P en $${tech.pivotP.toLocaleString('en-US')} (S1 $${tech.pivotS1.toLocaleString('en-US')} / R1 $${tech.pivotR1.toLocaleString('en-US')}).`,
        `Régimen HMM actual: ${regime.current} (${(regime.probs[regime.current] * 100).toFixed(0)} % probabilidad).`,
      ],
      invalidation:
        brkDir === 'long'
          ? `Fallo y cierre por debajo del Pivote P ($${tech.pivotP.toLocaleString('en-US')}).`
          : `Reclamación horaria por encima del Pivote P ($${tech.pivotP.toLocaleString('en-US')}).`,
    });

    const proposals = [trendProp, mrProp, derivProp, brkProp].sort(
      (a, b) =>
        b.confluenceScore * 0.6 + b.probTpPct * 0.4 - (a.confluenceScore * 0.6 + a.probTpPct * 0.4),
    );

    // Auto-register the highest-ranked proposal for this 4h bucket if not yet logged
    if (autoRecordTop && proposals.length > 0) {
      const top = proposals[0];
      const existingAll = loadRegisteredTradeOptions();
      const hasForBucket = existingAll.some(
        (r) => r.asset === asset && r.id.endsWith(`_${bucketKey}`),
      );
      if (!hasForBucket) {
        upsertRegisteredTradeOption(
          proposalToRegisteredRecord(top, 'auto', anchorTs, bucketKey),
        );
      }
    }

    // Evaluate all open registered options for this asset against latest 1H candles
    const { all: evaluatedAll } = evaluateTradeOptionsWithCandles(asset, candles1h);
    const registered = [...evaluatedAll].sort((a, b) => b.createdTs - a.createdTs);

    const out: TradeOptionsResponse = {
      generated: Date.now(),
      asset,
      inst: `${asset.toUpperCase()}-USDT-SWAP`,
      spot: roundPx(spot, spot),
      regime,
      technicals: tech,
      marketBias,
      marketSummary: {
        pUp24hPct: Number(((block.p_close_up['up_24'] ?? 0.5) * 100).toFixed(1)),
        pUp72hPct: Number(((block.p_close_up['up_72'] ?? 0.5) * 100).toFixed(1)),
        dvol: readings.dvol !== null ? Number(readings.dvol.toFixed(1)) : null,
        ivRv: readings.iv_rv !== null ? Number(readings.iv_rv.toFixed(1)) : null,
        fund1dZ: readings.fund_1d_z !== null ? Number(readings.fund_1d_z.toFixed(2)) : null,
        oiChg1d: readings.oi_chg_1d !== null ? Number(readings.oi_chg_1d.toFixed(2)) : null,
        lsZ: readings.ls_z !== null ? Number(readings.ls_z.toFixed(2)) : null,
        netGexM: gex ? gex.net_gex_m : null,
        gammaFlip: gex ? gex.flip : null,
        callWall: gex ? gex.call_wall : null,
        putWall: gex ? gex.put_wall : null,
        biasModelB1d: bias.p_up.B1,
        biasModelB3d: bias.p_up.B3,
      },
      proposals,
      registered,
      stats: summarizeTradeOptionStats(registered),
    };

    cache.set(key, { ts: Date.now(), data: out });
    return out;
  })();

  inflight.set(key, job);
  try {
    return await job;
  } finally {
    inflight.delete(key);
  }
}

export async function ensureAutoTradeOptionsForAllAssets(): Promise<void> {
  const assets: AssetId[] = ['btc', 'eth', 'sol'];
  for (const a of assets) {
    try {
      await computeTradeOptions(a, false, true);
      await new Promise((r) => setTimeout(r, 250));
    } catch (err) {
      console.warn(`Auto trade options failed for ${a}:`, err);
    }
  }
}

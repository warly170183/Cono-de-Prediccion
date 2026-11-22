import type { RotationResponse, RotationVariantStats } from './types.ts';
import { dsr, expectedMaxSharpe, nwTstat, psr, sharpe } from './quantEngine.ts';

const OKX_API = 'https://www.okx.com/api/v5';
const N_UNI = 40;
const STABLE = new Set(['USDC', 'USDG', 'DAI', 'TUSD', 'FDUSD', 'USDD', 'PYUSD', 'USTC']);
const LOOKS = [7, 14, 30, 60, 90] as const;
const KS = [3, 5, 8] as const;
const REBS = [3, 7, 14] as const;
const COST = 0.0005;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let cachedMatrix: {
  expiresAt: number;
  symbols: string[];
  dates: string[];
  prices: Array<Array<number | null>>;
} | null = null;

let cachedRotation: { expiresAt: number; data: RotationResponse } | null = null;
let inflightRotation: Promise<RotationResponse> | null = null;

async function fetchJsonRetry<T>(url: string, timeoutMs = 18000): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Trading-Predictor/1.0',
        },
      });
      if (res.status === 429 && attempt < 3) {
        clearTimeout(timer);
        await sleep(350 * Math.pow(2, attempt));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err;
      if (attempt < 3) {
        await sleep(300 * Math.pow(2, attempt));
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`Failed request ${url}`);
}

async function fetchDailyCloseSeries(inst: string, nBars = 1100): Promise<Map<string, number>> {
  const raw: string[][] = [];
  let after: string | undefined;

  const latest = await fetchJsonRetry<{ data?: string[][] }>(
    `${OKX_API}/market/candles?instId=${inst}&bar=1D&limit=100`,
  );
  if (latest.data?.length) {
    raw.push(...latest.data);
    after = latest.data[latest.data.length - 1][0];
  }

  const maxPages = Math.ceil(nBars / 100);
  for (let p = 0; p < maxPages && raw.length < nBars; p++) {
    const qs = new URLSearchParams({ instId: inst, bar: '1D', limit: '100' });
    if (after) qs.set('after', after);
    const res = await fetchJsonRetry<{ data?: string[][] }>(
      `${OKX_API}/market/history-candles?${qs.toString()}`,
    );
    const d = res.data ?? [];
    if (!d.length) break;
    raw.push(...d);
    after = d[d.length - 1][0];
    await sleep(95);
  }

  const map = new Map<string, number>();
  for (const row of raw) {
    if (row[8] !== '1') continue;
    const day = new Date(Number(row[0])).toISOString().slice(0, 10);
    map.set(day, Number(row[4]));
  }
  return map;
}

async function loadUniverseMatrix(forceRefresh: boolean) {
  const now = Date.now();
  if (!forceRefresh && cachedMatrix && cachedMatrix.expiresAt > now) {
    return cachedMatrix;
  }

  const tickers = await fetchJsonRetry<{
    data?: Array<{ instId: string; volCcy24h: string; last: string }>;
  }>(`${OKX_API}/market/tickers?instType=SWAP`);

  const candidates = (tickers.data ?? [])
    .filter((t) => t.instId.endsWith('-USDT-SWAP'))
    .map((t) => ({
      instId: t.instId,
      base: t.instId.split('-')[0],
      dollarVol: Number(t.volCcy24h) * Number(t.last),
    }))
    .filter((r) => !STABLE.has(r.base) && Number.isFinite(r.dollarVol))
    .sort((a, b) => b.dollarVol - a.dollarVol)
    .slice(0, N_UNI + 6);

  const seriesMap = new Map<string, Map<string, number>>();
  // Fetch with low concurrency (2) to stay well within OKX rate limits
  let cursor = 0;
  async function worker() {
    while (cursor < candidates.length && seriesMap.size < N_UNI) {
      const idx = cursor++;
      const c = candidates[idx];
      if (!c) break;
      try {
        const s = await fetchDailyCloseSeries(c.instId, 1100);
        if (s.size >= 120 && seriesMap.size < N_UNI) {
          seriesMap.set(c.base, s);
        }
      } catch (err) {
        console.warn(`Skipping ${c.instId} in rotation fetch:`, err);
      }
      await sleep(80);
    }
  }
  await Promise.all([worker(), worker()]);

  const symbols = Array.from(seriesMap.keys());
  const dateSet = new Set<string>();
  for (const m of seriesMap.values()) {
    for (const d of m.keys()) dateSet.add(d);
  }
  const dates = Array.from(dateSet).sort();
  const prices: Array<Array<number | null>> = dates.map((d) =>
    symbols.map((sym) => seriesMap.get(sym)?.get(d) ?? null),
  );

  cachedMatrix = {
    expiresAt: Date.now() + 30 * 60_000,
    symbols,
    dates,
    prices,
  };
  return cachedMatrix;
}

function statsFor(x: number[]): RotationVariantStats {
  const n = x.length;
  if (n < 4) {
    return { n_days: n, sharpe_ann: 0, mean_bps_day: 0, nw_t: 0, sharpe_h1: 0, sharpe_h2: 0 };
  }
  const half = Math.floor(n / 2);
  let meanVal = 0;
  for (let i = 0; i < n; i++) meanVal += x[i];
  meanVal /= n;
  return {
    n_days: n,
    sharpe_ann: Number((sharpe(x) * Math.sqrt(365)).toFixed(3)),
    mean_bps_day: Number((meanVal * 1e4).toFixed(2)),
    nw_t: Number(nwTstat(x).toFixed(3)),
    sharpe_h1: Number((sharpe(x.slice(0, half)) * Math.sqrt(365)).toFixed(3)),
    sharpe_h2: Number((sharpe(x.slice(half)) * Math.sqrt(365)).toFixed(3)),
  };
}

export function backtestVariant(
  prices: Array<Array<number | null>>,
  symbolsCount: number,
  look: number,
  k: number,
  reb: number,
  phase = 0,
) {
  const T = prices.length;
  const R: Array<Array<number | null>> = new Array(T);
  R[0] = new Array(symbolsCount).fill(null);
  for (let t = 1; t < T; t++) {
    const row = new Array<number | null>(symbolsCount);
    for (let j = 0; j < symbolsCount; j++) {
      const p1 = prices[t][j];
      const p0 = prices[t - 1][j];
      row[j] = p1 !== null && p0 !== null && p0 > 0 ? p1 / p0 - 1 : null;
    }
    R[t] = row;
  }

  const w: Float64Array[] = Array.from({ length: T }, () => new Float64Array(symbolsCount));
  let cur = new Float64Array(symbolsCount);

  for (let i = 0; i < T; i++) {
    if (i > look + 1 && i % reb === phase % reb) {
      const scored: Array<{ j: number; s: number }> = [];
      for (let j = 0; j < symbolsCount; j++) {
        const p1 = prices[i - 1][j];
        const p0 = prices[i - look - 1][j];
        if (p1 !== null && p0 !== null && p1 > 0 && p0 > 0) {
          scored.push({ j, s: Math.log(p1 / p0) });
        }
      }
      if (scored.length >= k + 5) {
        scored.sort((a, b) => b.s - a.s);
        cur = new Float64Array(symbolsCount);
        for (let idx = 0; idx < k; idx++) {
          cur[scored[idx].j] = 1 / k;
        }
      }
    }
    w[i] = new Float64Array(cur);
  }

  const start = look + 3;
  const exc: number[] = [];
  const netArr: number[] = [];
  const ewArr: number[] = [];
  let turnSum = 0;
  let turnN = 0;

  for (let t = start; t < T; t++) {
    const prevHeld = t >= 2 ? w[t - 2] : new Float64Array(symbolsCount);
    const held = w[t - 1];
    let turn = 0;
    let gross = 0;
    let ewSum = 0;
    let ewCnt = 0;

    for (let j = 0; j < symbolsCount; j++) {
      turn += Math.abs(held[j] - prevHeld[j]);
      const r = R[t][j];
      if (r !== null) {
        gross += held[j] * r;
        ewSum += r;
        ewCnt++;
      }
    }
    if (ewCnt === 0) continue;
    const ewRet = ewSum / ewCnt;
    turnSum += turn;
    turnN++;
    const netRet = gross - COST * turn;
    exc.push(netRet - ewRet);
    netArr.push(netRet);
    ewArr.push(ewRet);
  }

  return { exc, netArr, ewArr, avgTurnover: turnN ? turnSum / turnN : 0 };
}

export type RotationVerdict = 'sin_ventaja' | 'indicios' | 'robusta_con_sesgo';

/** Veredicto conservador: nunca 'validada', porque el universo actual arrastra sesgo de supervivencia. */
export function rotationVerdict(p: {
  dsr: number;
  nw_t: number;
  ci_lo: number;
  sharpe_h1: number;
  sharpe_h2: number;
  phase_pos_share: number;
}): RotationVerdict {
  const both = p.sharpe_h1 > 0 && p.sharpe_h2 > 0;
  if (p.dsr > 0.95 && p.nw_t > 3 && p.ci_lo > 0 && both && p.phase_pos_share >= 0.8) return 'robusta_con_sesgo';
  if (p.nw_t > 2 && both && p.phase_pos_share >= 0.6) return 'indicios';
  return 'sin_ventaja';
}

function createRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function getRotationAnalysis(forceRefresh = false): Promise<RotationResponse> {
  const now = Date.now();
  if (!forceRefresh && cachedRotation && cachedRotation.expiresAt > now) {
    return cachedRotation.data;
  }
  if (!forceRefresh && inflightRotation) {
    return inflightRotation;
  }

  inflightRotation = (async () => {
    const matrix = await loadUniverseMatrix(forceRefresh);
    const { symbols, dates, prices } = matrix;
    const variants: Record<string, RotationVariantStats> = {};
    const seriesMap: Record<string, number[]> = {};
    const dailySrs: number[] = [];

    for (const look of LOOKS) {
      for (const k of KS) {
        for (const reb of REBS) {
          const key = `L${look}_k${k}_r${reb}`;
          const { exc } = backtestVariant(prices, symbols.length, look, k, reb);
          variants[key] = statsFor(exc);
          seriesMap[key] = exc;
          dailySrs.push(sharpe(exc));
        }
      }
    }

    const nTrials = Object.keys(variants).length;
    const meanSr = dailySrs.reduce((s, v) => s + v, 0) / Math.max(1, nTrials);
    const varSr =
      dailySrs.reduce((s, v) => s + (v - meanSr) ** 2, 0) / Math.max(1, nTrials - 1);

    const primary = 'L30_k5_r7';
    const xPrim = seriesMap[primary] ?? [];
    const { netArr: primNet, ewArr: ewRet, avgTurnover } = backtestVariant(prices, symbols.length, 30, 5, 7);

    // Block bootstrap 95% CI (block = 14 days)
    const blk = 14;
    const rng = createRng(5);
    const boots: number[] = [];
    if (xPrim.length > blk) {
      const nb = Math.ceil(xPrim.length / blk);
      const maxStart = xPrim.length - blk + 1;
      for (let b = 0; b < 1800; b++) {
        let sum = 0;
        let cnt = 0;
        for (let blockIdx = 0; blockIdx < nb; blockIdx++) {
          const st = Math.floor(rng() * maxStart);
          for (let off = 0; off < blk && cnt < xPrim.length; off++) {
            sum += xPrim[st + off];
            cnt++;
          }
        }
        boots.push((sum / Math.max(1, cnt)) * 1e4);
      }
      boots.sort((a, b) => a - b);
    }
    const ciLo = boots.length ? Number(boots[Math.floor(0.025 * (boots.length - 1))].toFixed(2)) : 0;
    const ciHi = boots.length ? Number(boots[Math.floor(0.975 * (boots.length - 1))].toFixed(2)) : 0;

    // Robustez a la fase de rebalanceo: la misma regla desplazada 0..6 días no debería cambiar el resultado.
    const phaseSrs: number[] = [];
    for (let ph = 0; ph < 7; ph++) {
      const { exc } = backtestVariant(prices, symbols.length, 30, 5, 7, ph);
      phaseSrs.push(Number((sharpe(exc) * Math.sqrt(365)).toFixed(3)));
    }
    const phasePosShare = phaseSrs.filter((v) => v > 0).length / phaseSrs.length;
    const primStats = variants[primary];
    const primaryResult: RotationVariantStats = {
      ...primStats,
      psr0: Number(psr(xPrim).toFixed(3)),
      dsr: Number(dsr(xPrim, nTrials, varSr).toFixed(3)),
      exp_max_sharpe_day: Number(expectedMaxSharpe(nTrials, varSr).toFixed(4)),
      mean_ci95_bps_day: [ciLo, ciHi],
    };

    const bestVariant = Object.keys(variants).reduce((a, b) =>
      variants[b].sharpe_ann > variants[a].sharpe_ann ? b : a,
    );
    const bestDsr = Number(dsr(seriesMap[bestVariant], nTrials, varSr).toFixed(3));
    const sharePos =
      Object.values(variants).filter((v) => v.sharpe_ann > 0).length / Math.max(1, nTrials);

    // Current ranking by L30 (skipping last day: ln(P[T-2]/P[T-32]))
    const T = prices.length;
    const rankRows = symbols
      .map((sym, j) => {
        const pLast = prices[T - 1]?.[j];
        const p1 = prices[T - 2]?.[j];
        const p31 = prices[T - 32]?.[j];
        const p8 = prices[T - 8]?.[j];
        if (pLast === null || p1 === null || p31 === null || p1 <= 0 || p31 <= 0) return null;
        const mom30 = (Math.log(p1 / p31)) * 100;
        const mom7 = p8 !== null && p8 > 0 ? Math.log(pLast / p8) * 100 : 0;
        return {
          symbol: sym,
          last_close: pLast,
          mom_30d_pct: Number(mom30.toFixed(2)),
          mom_7d_pct: Number(mom7.toFixed(2)),
          in_top5: false,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => b.mom_30d_pct - a.mom_30d_pct)
      .map((r, idx) => ({ ...r, in_top5: idx < 5 }));

    const result: RotationResponse = {
      universe: symbols,
      n_assets: symbols.length,
      from: dates[0] ?? '',
      to: dates[dates.length - 1] ?? '',
      n_trials: nTrials,
      primary,
      primary_result: primaryResult,
      primary_abs_net: statsFor(primNet),
      benchmark_ew: statsFor(ewRet),
      best_variant: bestVariant,
      best_variant_result: variants[bestVariant],
      best_dsr: bestDsr,
      phase_sharpes: phaseSrs,
      phase_pos_share: Number(phasePosShare.toFixed(3)),
      avg_turnover_day: Number(avgTurnover.toFixed(3)),
      verdict: rotationVerdict({
        dsr: primaryResult.dsr ?? 0,
        nw_t: primaryResult.nw_t,
        ci_lo: ciLo,
        sharpe_h1: primaryResult.sharpe_h1,
        sharpe_h2: primaryResult.sharpe_h2,
        phase_pos_share: phasePosShare,
      }),
      share_variants_sharpe_pos: Number(sharePos.toFixed(3)),
      variants,
      current_ranking: rankRows,
    };

    cachedRotation = { expiresAt: Date.now() + 30 * 60_000, data: result };
    return result;
  })().finally(() => {
    inflightRotation = null;
  });

  return inflightRotation;
}

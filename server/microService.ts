import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { getInstId } from './marketData.ts';
import type { AssetId, CollectorStatus, MicroTick } from './types.ts';
import { DATA_DIR, JOURNAL_DIR } from './paths.ts';
import { updateSettings } from './storage.ts';

const OKX_API = 'https://www.okx.com/api/v5';
const MICRO_ARCHIVE_DIR = path.join(JOURNAL_DIR, 'micro');
const MICRO_LIVE_DIR = path.join(DATA_DIR, 'micro');
const liveBuffer: MicroTick[] = [];

export function pushLiveMicroTick(tick: MicroTick) {
  liveBuffer.push(tick);
  if (liveBuffer.length > 2000) {
    liveBuffer.shift();
  }
}

export function getLiveBuffer() {
  return [...liveBuffer];
}

// --- Background 1-Minute Microstructure Collector (mirrors micro_collect.py) ---
interface CollectorState {
  running: boolean;
  asset: AssetId;
  ctVal: number;
  started_at: number | null;
  bars_collected: number;
  last_bar_ts: number | null;
  last_mid: number | null;
  missed_bars: number;
  trades_polled: number;
  lastTid: number;
  seenLiq: Set<string>;
  acc: { buy: number; sell: number; n: number; notional: number; missed: number };
  liq: { long: number; short: number };
  tradeTimer: NodeJS.Timeout | null;
  barTimer: NodeJS.Timeout | null;
}

const collector: CollectorState = {
  running: false,
  asset: 'btc',
  ctVal: 0.01,
  started_at: null,
  bars_collected: 0,
  last_bar_ts: null,
  last_mid: null,
  missed_bars: 0,
  trades_polled: 0,
  lastTid: 0,
  seenLiq: new Set(),
  acc: { buy: 0, sell: 0, n: 0, notional: 0, missed: 0 },
  liq: { long: 0, short: 0 },
  tradeTimer: null,
  barTimer: null,
};

async function okxGet<T>(urlPath: string, params: Record<string, string | number>): Promise<T | null> {
  try {
    const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    try {
      const res = await fetch(`${OKX_API}/${urlPath}?${qs.toString()}`, {
        signal: controller.signal,
        headers: { Accept: 'application/json', 'User-Agent': 'Trading-Predictor/1.0' },
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { code: string; data?: T };
      return json.code === '0' ? json.data ?? null : null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

async function pollTradesForCollector() {
  const inst = getInstId(collector.asset);
  const d = await okxGet<Array<{ tradeId: string; px: string; sz: string; side: string }>>('market/trades', {
    instId: inst,
    limit: 500,
  });
  if (!d || !d.length) return;

  const newTrades = d.filter((x) => Number(x.tradeId) > collector.lastTid);
  if (collector.lastTid > 0 && newTrades.length > 0) {
    let minTid = Infinity;
    for (const t of newTrades) {
      const id = Number(t.tradeId);
      if (id < minTid) minTid = id;
    }
    if (minTid > collector.lastTid + 1) {
      collector.acc.missed = 1;
    }
  }

  let maxTid = collector.lastTid;
  for (const x of newTrades) {
    const id = Number(x.tradeId);
    if (id > maxTid) maxTid = id;
    const q = Number(x.sz) * collector.ctVal;
    if (x.side === 'buy') collector.acc.buy += q;
    else collector.acc.sell += q;
    collector.acc.n += 1;
    collector.acc.notional += q * Number(x.px);
  }
  if (newTrades.length > 0) {
    collector.lastTid = maxTid;
    collector.trades_polled += newTrades.length;
  }
}

async function pollLiqForCollector() {
  const uly = `${collector.asset.toUpperCase()}-USDT`;
  const d = await okxGet<Array<{ details?: Array<{ ts: string; bkPx: string; sz: string; posSide: string }> }>>(
    'public/liquidation-orders',
    { instType: 'SWAP', uly, state: 'filled', limit: 100 },
  );
  if (!d) return;
  for (const blk of d) {
    for (const x of blk.details ?? []) {
      const key = `${x.ts}:${x.bkPx}:${x.sz}:${x.posSide}`;
      if (collector.seenLiq.has(key)) continue;
      collector.seenLiq.add(key);
      if (collector.seenLiq.size > 5000) collector.seenLiq.clear();
      const q = Number(x.sz) * collector.ctVal;
      if (x.posSide === 'long') collector.liq.long += q;
      else if (x.posSide === 'short') collector.liq.short += q;
    }
  }
}

async function writeCollectorBar() {
  if (!collector.running) return;
  const inst = getInstId(collector.asset);
  const spotInst = `${collector.asset.toUpperCase()}-USDT`;
  const ts = Math.floor(Date.now() / 60_000) * 60_000;

  await Promise.all([pollTradesForCollector(), pollLiqForCollector()]);

  const [book, mk, ix, fr, oi] = await Promise.all([
    okxGet<Array<{ bids: string[][]; asks: string[][] }>>('market/books', { instId: inst, sz: 20 }),
    okxGet<Array<{ markPx: string }>>('public/mark-price', { instType: 'SWAP', instId: inst }),
    okxGet<Array<{ idxPx: string }>>('market/index-tickers', { instId: spotInst }),
    okxGet<Array<{ fundingRate: string }>>('public/funding-rate', { instId: inst }),
    okxGet<Array<{ oiCcy: string }>>('public/open-interest', { instType: 'SWAP', instId: inst }),
  ]);

  if (!book?.[0]?.bids?.length || !book?.[0]?.asks?.length) {
    // La barra se pierde: el flujo acumulado pasa a la siguiente, que queda marcada como incompleta.
    collector.acc.missed = 1;
    return;
  }
  const bids = book[0].bids.map((x) => [Number(x[0]), Number(x[1]) * collector.ctVal] as [number, number]);
  const asks = book[0].asks.map((x) => [Number(x[0]), Number(x[1]) * collector.ctVal] as [number, number]);
  const bb = bids[0];
  const ba = asks[0];
  const mid = (bb[0] + ba[0]) / 2;
  const spread_bps = ((ba[0] - bb[0]) / mid) * 1e4;
  const microprice_bps =
    (((bb[0] * ba[1] + ba[0] * bb[1]) / (bb[1] + ba[1]) - mid) / mid) * 1e4;

  const sumN = (arr: [number, number][], n: number) => arr.slice(0, n).reduce((s, x) => s + x[1], 0);
  const b5 = sumN(bids, 5);
  const a5 = sumN(asks, 5);
  const b20 = sumN(bids, 20);
  const a20 = sumN(asks, 20);

  const mark = mk?.[0]?.markPx ? Number(mk[0].markPx) : null;
  const index = ix?.[0]?.idxPx ? Number(ix[0].idxPx) : null;
  const totalVol = collector.acc.buy + collector.acc.sell;

  const tick: MicroTick = {
    ts,
    mid,
    spread_bps,
    microprice_bps,
    imb5: b5 + a5 > 0 ? (b5 - a5) / (b5 + a5) : null,
    imb20: b20 + a20 > 0 ? (b20 - a20) / (b20 + a20) : null,
    depth_bid_btc: bids.filter((x) => x[0] >= mid * (1 - 0.0005)).reduce((s, x) => s + x[1], 0),
    depth_ask_btc: asks.filter((x) => x[0] <= mid * (1 + 0.0005)).reduce((s, x) => s + x[1], 0),
    mark,
    index,
    basis_bps: mark !== null && index !== null ? (mark / index - 1) * 1e4 : null,
    funding: fr?.[0]?.fundingRate ? Number(fr[0].fundingRate) : null,
    oi_btc: oi?.[0]?.oiCcy ? Number(oi[0].oiCcy) : null,
    tk_buy_btc: collector.acc.buy,
    tk_sell_btc: collector.acc.sell,
    n_trades: collector.acc.n,
    vwap: totalVol > 0 ? collector.acc.notional / totalVol : null,
    missed: collector.acc.missed,
    liq_long_btc: collector.liq.long,
    liq_short_btc: collector.liq.short,
  };

  if (tick.missed === 1) collector.missed_bars++;
  collector.bars_collected++;
  collector.last_bar_ts = ts;
  collector.last_mid = mid;

  collector.acc = { buy: 0, sell: 0, n: 0, notional: 0, missed: 0 };
  collector.liq = { long: 0, short: 0 };

  pushLiveMicroTick(tick);

  try {
    fs.mkdirSync(MICRO_LIVE_DIR, { recursive: true });
    const day = new Date(ts).toISOString().slice(0, 10);
    const outFile = path.join(MICRO_LIVE_DIR, `${inst}_${day}.jsonl`);
    fs.appendFileSync(outFile, JSON.stringify(tick) + '\n', 'utf-8');
  } catch (e) {
    console.warn('Micro collector file write skipped:', e);
  }
}

export async function startMicroCollector(asset: AssetId): Promise<CollectorStatus> {
  if (collector.running) {
    stopMicroCollector();
  }
  const inst = getInstId(asset);
  const instInfo = await okxGet<Array<{ ctVal: string }>>('public/instruments', {
    instType: 'SWAP',
    instId: inst,
  });

  collector.running = true;
  collector.asset = asset;
  collector.ctVal = Number(instInfo?.[0]?.ctVal ?? (asset === 'btc' ? 0.01 : asset === 'eth' ? 0.1 : 1));
  collector.started_at = Date.now();
  collector.bars_collected = 0;
  collector.missed_bars = 0;
  collector.trades_polled = 0;
  collector.lastTid = 0;
  collector.seenLiq.clear();
  collector.acc = { buy: 0, sell: 0, n: 0, notional: 0, missed: 0 };
  collector.liq = { long: 0, short: 0 };

  // Seed initial trade watermark and immediately write an opening bar
  await pollTradesForCollector();
  await pollLiqForCollector();
  collector.acc = { buy: 0, sell: 0, n: 0, notional: 0, missed: 0 };
  collector.liq = { long: 0, short: 0 };
  await writeCollectorBar();

  collector.tradeTimer = setInterval(() => {
    void pollTradesForCollector();
  }, 10_000);
  collector.barTimer = setInterval(() => {
    void writeCollectorBar();
  }, 60_000);

  updateSettings({ micro: { running: true, asset } });
  return getCollectorStatus();
}

export function stopMicroCollector(): CollectorStatus {
  collector.running = false;
  if (collector.tradeTimer) {
    clearInterval(collector.tradeTimer);
    collector.tradeTimer = null;
  }
  if (collector.barTimer) {
    clearInterval(collector.barTimer);
    collector.barTimer = null;
  }
  updateSettings({ micro: { running: false, asset: collector.asset } });
  return getCollectorStatus();
}

export function getCollectorStatus(): CollectorStatus {
  return {
    running: collector.running,
    asset: collector.asset,
    inst: getInstId(collector.asset),
    started_at: collector.started_at,
    bars_collected: collector.bars_collected,
    last_bar_ts: collector.last_bar_ts,
    last_mid: collector.last_mid,
    missed_bars: collector.missed_bars,
    trades_polled: collector.trades_polled,
  };
}

function parseCsvLine(headers: string[], line: string): MicroTick | null {
  const cols = line.split(',');
  if (cols.length < headers.length) return null;
  const obj: Record<string, number | null> = {};
  for (let i = 0; i < headers.length; i++) {
    const v = cols[i].trim();
    obj[headers[i]] = v === '' ? null : Number(v);
  }
  if (!obj.ts || !obj.mid) return null;
  return {
    ts: obj.ts,
    mid: obj.mid,
    spread_bps: obj.spread_bps ?? 0,
    microprice_bps: obj.microprice_bps ?? 0,
    imb5: obj.imb5 ?? null,
    imb20: obj.imb20 ?? null,
    depth_bid_btc: obj.depth_bid_btc ?? 0,
    depth_ask_btc: obj.depth_ask_btc ?? 0,
    mark: obj.mark ?? null,
    index: obj.index ?? null,
    basis_bps: obj.basis_bps ?? null,
    funding: obj.funding ?? null,
    oi_btc: obj.oi_btc ?? null,
    tk_buy_btc: obj.tk_buy_btc ?? 0,
    tk_sell_btc: obj.tk_sell_btc ?? 0,
    n_trades: obj.n_trades ?? 0,
    vwap: obj.vwap ?? null,
    missed: obj.missed ?? 0,
    liq_long_btc: obj.liq_long_btc ?? 0,
    liq_short_btc: obj.liq_short_btc ?? 0,
  };
}

export function loadArchivedMicroTicks(): { files: string[]; rows: MicroTick[] } {
  const files: string[] = [];
  const rowsMap = new Map<number, MicroTick>();

  if (fs.existsSync(MICRO_ARCHIVE_DIR)) {
    const gzFiles = fs.readdirSync(MICRO_ARCHIVE_DIR).filter((f) => f.endsWith('.csv.gz')).sort();
    for (const f of gzFiles) {
      files.push(f);
      const gz = fs.readFileSync(path.join(MICRO_ARCHIVE_DIR, f));
      const text = zlib.gunzipSync(gz).toString('utf-8');
      const lines = text.split('\n').filter((l) => l.trim().length > 0);
      if (lines.length < 2) continue;
      const headers = lines[0].split(',').map((h) => h.trim());
      for (let i = 1; i < lines.length; i++) {
        const tick = parseCsvLine(headers, lines[i]);
        if (tick) rowsMap.set(tick.ts, tick);
      }
    }
  }

  if (fs.existsSync(MICRO_LIVE_DIR)) {
    const jsonlFiles = fs.readdirSync(MICRO_LIVE_DIR).filter((f) => f.endsWith('.jsonl')).sort();
    for (const f of jsonlFiles) {
      files.push(f);
      const raw = fs.readFileSync(path.join(MICRO_LIVE_DIR, f), 'utf-8');
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try {
          const tick = JSON.parse(line) as MicroTick;
          if (tick.ts && tick.mid) rowsMap.set(tick.ts, tick);
        } catch {
          // ignore malformed line
        }
      }
    }
  }

  for (const t of liveBuffer) {
    rowsMap.set(t.ts, t);
  }

  const rows = Array.from(rowsMap.values()).sort((a, b) => a.ts - b.ts);
  return { files, rows };
}

export function exportMicroData(format: 'csv' | 'jsonl'): string {
  const { rows } = loadArchivedMicroTicks();
  if (format === 'jsonl') {
    return rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
  }
  const cols: (keyof MicroTick)[] = [
    'ts', 'mid', 'spread_bps', 'microprice_bps', 'imb5', 'imb20',
    'depth_bid_btc', 'depth_ask_btc', 'mark', 'index', 'basis_bps',
    'funding', 'oi_btc', 'tk_buy_btc', 'tk_sell_btc', 'n_trades',
    'vwap', 'missed', 'liq_long_btc', 'liq_short_btc',
  ];
  const header = cols.join(',');
  const lines = rows.map((r) => cols.map((c) => (r[c] === null ? '' : String(r[c]))).join(','));
  return [header, ...lines].join('\n') + '\n';
}

function rankArray(vals: number[]): number[] {
  const indexed = vals.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(vals.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1].v === indexed[i].v) j++;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[indexed[k].i] = avgRank;
    i = j + 1;
  }
  return ranks;
}

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t) *
      Math.exp(-ax * ax);
  return sign * y;
}

function spearmanCorr(x: number[], y: number[]): { rho: number; p: number } {
  const n = x.length;
  if (n < 10) return { rho: 0, p: 1 };
  const rx = rankArray(x);
  const ry = rankArray(y);
  const mx = (n + 1) / 2;
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i++) {
    const a = rx[i] - mx;
    const b = ry[i] - mx;
    num += a * b;
    dx2 += a * a;
    dy2 += b * b;
  }
  const denom = Math.sqrt(dx2 * dy2);
  const rho = denom > 0 ? num / denom : 0;
  const t = Math.abs(rho) * Math.sqrt((n - 2) / Math.max(1e-9, 1 - rho * rho));
  const p = Math.min(1, 2 * (1 - 0.5 * (1 + erf(t / Math.SQRT2))));
  return { rho, p };
}

/** Comisión taker por lado en OKX (bps), supuesto conservador para el coste de viabilidad. */
export const TAKER_FEE_BPS = 5;
const MIN_MS = 60_000;

/** Las barras deben ser contiguas: tras reinicios del colector hay huecos y no se pueden mezclar. */
function contiguous(rows: MicroTick[], i: number, j: number, minutes: number): boolean {
  if (i < 0 || j >= rows.length || i >= j) return false;
  return Math.abs(rows[j].ts - rows[i].ts - minutes * MIN_MS) <= MIN_MS / 2;
}

export function computeMicroStudy() {
  const { files, rows } = loadArchivedMicroTicks();
  return studyFromRows(files, rows);
}

export function studyFromRows(files: string[], rows: MicroTick[]) {
  const nRows = rows.length;
  const minRowsRequired = 5000;
  const readyForWalkForward = nRows >= minRowsRequired;

  const features = ['imb5', 'imb20', 'microprice_bps', 'depth_ratio', 'flow_1m', 'basis_bps', 'ret_15m'] as const;
  const horizons = [5, 15, 60] as const;

  const series = rows.map((r, i) => {
    const totFlow = r.tk_buy_btc + r.tk_sell_btc;
    const flow1m = r.missed === 0 && totFlow > 0 ? (r.tk_buy_btc - r.tk_sell_btc) / totFlow : null;
    const depthRatio =
      r.depth_bid_btc > 0 && r.depth_ask_btc > 0 ? Math.log(r.depth_bid_btc / r.depth_ask_btc) : null;
    const ret15m = contiguous(rows, i - 15, i, 15) && rows[i - 15].mid > 0 ? Math.log(r.mid / rows[i - 15].mid) * 1e4 : null;
    return {
      ts: r.ts,
      mid: r.mid,
      imb5: r.imb5,
      imb20: r.imb20,
      microprice_bps: r.microprice_bps,
      depth_ratio: depthRatio,
      flow_1m: flow1m,
      basis_bps: r.basis_bps,
      ret_15m: ret15m,
      spread_bps: r.spread_bps,
      missed: r.missed,
      tk_buy_btc: r.tk_buy_btc,
      tk_sell_btc: r.tk_sell_btc,
      liq_long_btc: r.liq_long_btc,
      liq_short_btc: r.liq_short_btc,
    };
  });

  const icResults: Array<{
    h: number;
    feature: string;
    ic: number;
    p: number;
    p_bonf: number;
    n: number;
    /** Movimiento esperado (bps) por 1 desv. típica de señal: |IC|·σ del retorno. */
    edge_bps: number;
    /** Coste ida y vuelta (bps): spread medio + 2 comisiones taker. */
    cost_bps: number;
    /** Nº de tercios temporales (de 3) con el mismo signo de IC que el total; null si hay pocos datos. */
    folds_same_sign: number | null;
    viable: boolean;
  }> = [];
  const meanSpreadAll = nRows ? rows.reduce((s, r) => s + r.spread_bps, 0) / nRows : 0;
  const costBps = meanSpreadAll + 2 * TAKER_FEE_BPS;

  const nTests = features.length * horizons.length;
  for (const h of horizons) {
    for (const feat of features) {
      const xs: number[] = [];
      const ys: number[] = [];
      const idx: number[] = [];
      for (let i = 0; i < nRows - h; i += h) {
        if (!contiguous(rows, i, i + h, h)) continue;
        const xv = series[i][feat];
        const yv = Math.log(series[i + h].mid / series[i].mid);
        if (xv !== null && Number.isFinite(xv) && Number.isFinite(yv)) {
          xs.push(xv);
          ys.push(yv);
          idx.push(i);
        }
      }
      if (xs.length >= 12) {
        const { rho, p } = spearmanCorr(xs, ys);
        const mY = ys.reduce((a, b) => a + b, 0) / ys.length;
        const sdY = Math.sqrt(ys.reduce((a, b) => a + (b - mY) ** 2, 0) / Math.max(1, ys.length - 1));
        let folds: number | null = null;
        if (xs.length >= 45) {
          const third = Math.floor(xs.length / 3);
          folds = 0;
          for (let f = 0; f < 3; f++) {
            const a = f * third;
            const b = f === 2 ? xs.length : a + third;
            const r = spearmanCorr(xs.slice(a, b), ys.slice(a, b)).rho;
            if (Math.sign(r) === Math.sign(rho) && rho !== 0) folds++;
          }
        }
        const edgeBps = Math.abs(rho) * sdY * 1e4;
        icResults.push({
          h,
          feature: feat,
          ic: Number(rho.toFixed(4)),
          p: Number(p.toFixed(4)),
          p_bonf: Number(Math.min(1, p * nTests).toFixed(4)),
          n: xs.length,
          edge_bps: Number(edgeBps.toFixed(3)),
          cost_bps: Number(costBps.toFixed(3)),
          folds_same_sign: folds,
          viable: edgeBps > costBps && p * nTests < 0.05 && (folds ?? 0) >= 3,
        });
      }
    }
  }

  icResults.sort((a, b) => a.p - b.p);

  const missedCount = rows.filter((r) => r.missed === 1).length;
  const meanSpread = nRows ? rows.reduce((s, r) => s + r.spread_bps, 0) / nRows : 0;
  const meanBasis = nRows ? rows.reduce((s, r) => s + (r.basis_bps ?? 0), 0) / nRows : 0;

  return {
    files,
    n_rows: nRows,
    min_rows_required: minRowsRequired,
    ready_for_walk_forward: readyForWalkForward,
    coverage_days: Number((nRows / 1440).toFixed(2)),
    from_ts: nRows ? rows[0].ts : null,
    to_ts: nRows ? rows[nRows - 1].ts : null,
    missed_pct: nRows ? Number(((missedCount / nRows) * 100).toFixed(2)) : 0,
    mean_spread_bps: Number(meanSpread.toFixed(3)),
    mean_basis_bps: Number(meanBasis.toFixed(3)),
    n_tests: nTests,
    ic: icResults,
    recent_series: series.slice(-180),
  };
}

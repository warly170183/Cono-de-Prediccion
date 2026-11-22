import type { AssetId, Candle } from './types.ts';

const OKX_API = 'https://www.okx.com/api/v5';
const DERIBIT_API = 'https://www.deribit.com/api/v2/public';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchJson<T>(url: string, timeoutMs = 15000): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Trading-Predictor/1.0',
        },
      });
      if (res.status === 429 && attempt < 3) {
        clearTimeout(timer);
        await sleep(350 * Math.pow(2, attempt));
        continue;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} for ${url}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err;
      if (attempt < 3 && err instanceof Error && err.message.includes('HTTP 429')) {
        await sleep(350 * Math.pow(2, attempt));
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`Failed request for ${url}`);
}

async function cached<T>(key: string, ttlMs: number, forceRefresh: boolean, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (!forceRefresh && hit && hit.expiresAt > now) {
    return hit.value as T;
  }
  if (!forceRefresh) {
    const existing = inflight.get(key);
    if (existing) return existing as Promise<T>;
  }
  const promise = fn()
    .then((value) => {
      cache.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, promise);
  return promise;
}

export function getInstId(asset: AssetId): string {
  return `${asset.toUpperCase()}-USDT-SWAP`;
}

export async function fetchOkxCandles(
  asset: AssetId,
  bar: '1H' | '1D',
  nTarget: number,
  forceRefresh = false,
): Promise<Candle[]> {
  const inst = getInstId(asset);
  const key = `candles:${inst}:${bar}:${nTarget}`;
  return cached(key, 5 * 60_000, forceRefresh, async () => {
    const raw: string[][] = [];
    let after: string | undefined;

    // Fetch latest page from /market/candles first so we include most recent closed bars
    const latest = await fetchJson<{ code: string; data?: string[][] }>(
      `${OKX_API}/market/candles?instId=${inst}&bar=${bar}&limit=100`,
    );
    if (latest.data?.length) {
      raw.push(...latest.data);
      after = latest.data[latest.data.length - 1][0];
    }

    const maxPages = Math.ceil(nTarget / 100) + 2;
    for (let page = 0; page < maxPages && raw.length < nTarget; page++) {
      const qs = new URLSearchParams({ instId: inst, bar, limit: '100' });
      if (after) qs.set('after', after);
      const res = await fetchJson<{ code: string; data?: string[][] }>(
        `${OKX_API}/market/history-candles?${qs.toString()}`,
      );
      const d = res.data ?? [];
      if (!d.length) break;
      raw.push(...d);
      after = d[d.length - 1][0];
      await sleep(120);
    }

    const seen = new Set<number>();
    const clean: Candle[] = [];
    for (const x of raw) {
      const ts = Number(x[0]);
      if (seen.has(ts) || x[8] !== '1') continue; // confirm === '1' closed bar
      seen.add(ts);
      clean.push([ts, Number(x[1]), Number(x[2]), Number(x[3]), Number(x[4]), Number(x[5])]);
    }
    clean.sort((a, b) => a[0] - b[0]);
    return clean.slice(-nTarget);
  });
}

export async function fetchOkxRubik(
  asset: AssetId,
  path: string,
  extra: Record<string, string> = {},
  nTarget = 140,
  forceRefresh = false,
): Promise<number[][]> {
  const inst = getInstId(asset);
  const key = `rubik:${inst}:${path}:${JSON.stringify(extra)}:${nTarget}`;
  return cached(key, 5 * 60_000, forceRefresh, async () => {
    const map = new Map<number, number[]>();
    let end: string | undefined;
    const maxPages = Math.ceil(nTarget / 100) + 2;

    for (let i = 0; i < maxPages; i++) {
      const qs = new URLSearchParams({ instId: inst, period: '1D', limit: '100', ...extra });
      if (end) qs.set('end', end);
      const res = await fetchJson<{ data?: string[][] }>(`${OKX_API}/rubik/stat/${path}?${qs.toString()}`);
      const d = res.data ?? [];
      if (!d.length) break;
      for (const row of d) {
        const ts = Number(row[0]);
        map.set(ts, row.map(Number));
      }
      end = d[d.length - 1][0];
      if (map.size >= nTarget) break;
      await sleep(100);
    }

    return Array.from(map.values()).sort((a, b) => a[0] - b[0]);
  });
}

export async function fetchDeribitFundingHistory(
  asset: 'btc' | 'eth',
  days = 130,
  forceRefresh = false,
): Promise<Array<{ timestamp: number; interest_1h: number; interest_8h: number }>> {
  const inst = asset === 'btc' ? 'BTC-PERPETUAL' : 'ETH-PERPETUAL';
  const key = `deribit:funding:${inst}:${days}`;
  return cached(key, 5 * 60_000, forceRefresh, async () => {
    const now = Date.now();
    const start = now - days * 86_400_000;
    const step = 30 * 86_400_000;
    const map = new Map<number, { timestamp: number; interest_1h: number; interest_8h: number }>();

    for (let t = start; t < now; t += step) {
      const end = Math.min(now, t + step);
      const qs = new URLSearchParams({
        instrument_name: inst,
        start_timestamp: String(t),
        end_timestamp: String(end),
      });
      const res = await fetchJson<{
        result?: Array<{ timestamp: number; interest_1h: number; interest_8h: number }>;
      }>(`${DERIBIT_API}/get_funding_rate_history?${qs.toString()}`);
      for (const item of res.result ?? []) {
        map.set(item.timestamp, item);
      }
      await sleep(80);
    }

    return Array.from(map.values()).sort((a, b) => a.timestamp - b.timestamp);
  });
}

export async function fetchOkxFundingHistory(
  asset: AssetId,
  limit = 400,
  forceRefresh = false,
): Promise<Array<[number, number]>> {
  const inst = getInstId(asset);
  const key = `okx:funding:${inst}:${limit}`;
  return cached(key, 5 * 60_000, forceRefresh, async () => {
    const map = new Map<number, number>();
    let after: string | undefined;
    for (let i = 0; i < Math.ceil(limit / 100); i++) {
      const qs = new URLSearchParams({ instId: inst, limit: '100' });
      if (after) qs.set('after', after);
      const res = await fetchJson<{
        data?: Array<{ fundingTime: string; realizedRate?: string; fundingRate?: string }>;
      }>(`${OKX_API}/public/funding-rate-history?${qs.toString()}`);
      const d = res.data ?? [];
      if (!d.length) break;
      for (const item of d) {
        const ts = Number(item.fundingTime);
        const rate = Number(item.realizedRate || item.fundingRate || 0);
        map.set(ts, rate);
      }
      after = d[d.length - 1].fundingTime;
      await sleep(80);
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  });
}

export async function fetchDeribitDvol(
  asset: 'btc' | 'eth',
  days = 130,
  forceRefresh = false,
): Promise<number[][]> {
  const cur = asset.toUpperCase();
  const key = `deribit:dvol:${cur}:${days}`;
  return cached(key, 5 * 60_000, forceRefresh, async () => {
    const now = Date.now();
    const start = now - days * 86_400_000;
    const step = 40 * 86_400_000;
    const map = new Map<number, number[]>();

    for (let t = start; t < now; t += step) {
      const end = Math.min(now, t + step);
      const qs = new URLSearchParams({
        currency: cur,
        start_timestamp: String(t),
        end_timestamp: String(end),
        resolution: '3600',
      });
      const res = await fetchJson<{ result?: { data?: number[][] } }>(
        `${DERIBIT_API}/get_volatility_index_data?${qs.toString()}`,
      );
      for (const row of res.result?.data ?? []) {
        map.set(row[0], row);
      }
      await sleep(80);
    }

    return Array.from(map.values()).sort((a, b) => a[0] - b[0]);
  });
}

export interface DeribitOptionSummary {
  instrument_name: string;
  mark_iv: number;
  open_interest: number;
  underlying_price: number;
}

export async function fetchDeribitOptionsChain(
  asset: 'btc' | 'eth',
  forceRefresh = false,
): Promise<{ ts: number; index: number; chain: DeribitOptionSummary[] }> {
  const cur = asset.toUpperCase();
  const idxName = `${asset}_usd`;
  const key = `deribit:chain:${cur}`;
  return cached(key, 3 * 60_000, forceRefresh, async () => {
    const [chainRes, idxRes] = await Promise.all([
      fetchJson<{ result?: DeribitOptionSummary[] }>(
        `${DERIBIT_API}/get_book_summary_by_currency?currency=${cur}&kind=option`,
      ),
      fetchJson<{ result?: { index_price?: number } }>(
        `${DERIBIT_API}/get_index_price?index_name=${idxName}`,
      ),
    ]);
    return {
      ts: Date.now(),
      index: Number(idxRes.result?.index_price ?? 0),
      chain: chainRes.result ?? [],
    };
  });
}

export async function fetchOkxLiveMicroSnapshot(asset: AssetId) {
  const inst = getInstId(asset);
  const spotInst = `${asset.toUpperCase()}-USDT`;

  const ctVal = await cached<number>(`okx:ctVal:${inst}`, 60 * 60_000, false, async () => {
    const res = await fetchJson<{ code: string; data?: Array<{ ctVal: string }> }>(
      `${OKX_API}/public/instruments?instType=SWAP&instId=${inst}`,
    );
    return Number(res.data?.[0]?.ctVal ?? (asset === 'btc' ? 0.01 : asset === 'eth' ? 0.1 : 1));
  });

  const [bookRes, markRes, idxRes, fundRes, oiRes, tradesRes, liqRes] = await Promise.all([
    fetchJson<{ code: string; data?: Array<{ bids: string[][]; asks: string[][] }> }>(
      `${OKX_API}/market/books?instId=${inst}&sz=20`,
    ),
    fetchJson<{ code: string; data?: Array<{ markPx: string }> }>(
      `${OKX_API}/public/mark-price?instType=SWAP&instId=${inst}`,
    ),
    fetchJson<{ code: string; data?: Array<{ idxPx: string }> }>(
      `${OKX_API}/market/index-tickers?instId=${spotInst}`,
    ),
    fetchJson<{ code: string; data?: Array<{ fundingRate: string; nextFundingRate?: string }> }>(
      `${OKX_API}/public/funding-rate?instId=${inst}`,
    ),
    fetchJson<{ code: string; data?: Array<{ oiCcy: string }> }>(
      `${OKX_API}/public/open-interest?instType=SWAP&instId=${inst}`,
    ),
    fetchJson<{ code: string; data?: Array<{ tradeId: string; px: string; sz: string; side: string; ts: string }> }>(
      `${OKX_API}/market/trades?instId=${inst}&limit=200`,
    ),
    fetchJson<{
      code: string;
      data?: Array<{ details?: Array<{ ts: string; bkPx: string; sz: string; posSide: string }> }>;
    }>(`${OKX_API}/public/liquidation-orders?instType=SWAP&uly=${spotInst}&state=filled&limit=50`).catch(() => ({
      code: '0',
      data: [],
    })),
  ]);

  const book = bookRes.data?.[0];
  const bids = (book?.bids ?? []).map((x) => [Number(x[0]), Number(x[1]) * ctVal] as [number, number]);
  const asks = (book?.asks ?? []).map((x) => [Number(x[0]), Number(x[1]) * ctVal] as [number, number]);

  if (!bids.length || !asks.length) {
    throw new Error(`Orderbook unavailable for ${inst}`);
  }

  const bb = bids[0];
  const ba = asks[0];
  const mid = (bb[0] + ba[0]) / 2;
  const spread_bps = ((ba[0] - bb[0]) / mid) * 1e4;
  const microprice = (bb[0] * ba[1] + ba[0] * bb[1]) / (bb[1] + ba[1]);
  const microprice_bps = ((microprice - mid) / mid) * 1e4;

  const sumN = (arr: [number, number][], n: number) => arr.slice(0, n).reduce((s, x) => s + x[1], 0);
  const b5 = sumN(bids, 5);
  const a5 = sumN(asks, 5);
  const b20 = sumN(bids, 20);
  const a20 = sumN(asks, 20);

  const imb5 = b5 + a5 > 0 ? (b5 - a5) / (b5 + a5) : null;
  const imb20 = b20 + a20 > 0 ? (b20 - a20) / (b20 + a20) : null;
  const depth_bid_btc = bids.filter((x) => x[0] >= mid * (1 - 0.0005)).reduce((s, x) => s + x[1], 0);
  const depth_ask_btc = asks.filter((x) => x[0] <= mid * (1 + 0.0005)).reduce((s, x) => s + x[1], 0);

  const mark = markRes.data?.[0]?.markPx ? Number(markRes.data[0].markPx) : null;
  const index = idxRes.data?.[0]?.idxPx ? Number(idxRes.data[0].idxPx) : null;
  const basis_bps = mark !== null && index !== null ? (mark / index - 1) * 1e4 : null;
  const funding = fundRes.data?.[0]?.fundingRate ? Number(fundRes.data[0].fundingRate) : null;
  const oi_btc = oiRes.data?.[0]?.oiCcy ? Number(oiRes.data[0].oiCcy) : null;

  const trades = tradesRes.data ?? [];
  let tk_buy_btc = 0;
  let tk_sell_btc = 0;
  let notional = 0;
  for (const t of trades) {
    const q = Number(t.sz) * ctVal;
    const px = Number(t.px);
    if (t.side === 'buy') tk_buy_btc += q;
    else tk_sell_btc += q;
    notional += q * px;
  }
  const totalVol = tk_buy_btc + tk_sell_btc;
  const vwap = totalVol > 0 ? notional / totalVol : null;

  let liq_long_btc = 0;
  let liq_short_btc = 0;
  const recentLiqs: Array<{ ts: number; px: number; qty: number; side: string }> = [];
  const cutoff = Date.now() - 3600_000;
  for (const blk of liqRes.data ?? []) {
    for (const d of blk.details ?? []) {
      const ts = Number(d.ts);
      const qty = Number(d.sz) * ctVal;
      if (ts >= cutoff) {
        if (d.posSide === 'long') liq_long_btc += qty;
        else if (d.posSide === 'short') liq_short_btc += qty;
      }
      if (recentLiqs.length < 15) {
        recentLiqs.push({ ts, px: Number(d.bkPx), qty, side: d.posSide });
      }
    }
  }

  return {
    inst,
    ctVal,
    tick: {
      ts: Date.now(),
      mid,
      spread_bps,
      microprice_bps,
      imb5,
      imb20,
      depth_bid_btc,
      depth_ask_btc,
      mark,
      index,
      basis_bps,
      funding,
      oi_btc,
      tk_buy_btc,
      tk_sell_btc,
      n_trades: trades.length,
      vwap,
      missed: 0,
      liq_long_btc,
      liq_short_btc,
    },
    orderbook: {
      bids: bids.slice(0, 12),
      asks: asks.slice(0, 12),
    },
    recentTrades: trades.slice(0, 20).map((t) => ({
      ts: Number(t.ts),
      px: Number(t.px),
      qty: Number(t.sz) * ctVal,
      side: t.side as 'buy' | 'sell',
    })),
    recentLiqs,
  };
}

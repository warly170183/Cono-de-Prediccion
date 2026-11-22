import fs from 'fs';
import path from 'path';
import type { AssetId, AutoJournalStatus, Candle, JournalRecord, ScoredRow } from './types.ts';
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
  computeDerivativesReadings,
  computeEnsembleRatio,
  computeGex,
  computeOptionsCone,
} from './quantEngine.ts';

import { kupiecPof } from './quantEngine.ts';
import { JOURNAL_DIR, atomicWrite } from './paths.ts';
import { readJsonl, readSettings, updateSettings } from './storage.ts';
const HOUR = 3_600_000;
const HZ = [24, 72] as const;
const QS = ['5', '10', '25', '50', '75', '90', '95'] as const;
export const MIN_SCORED_INDEP = 20;
/** ≈100 días de velas 1H: antes eran 500 (≈20 días) y las predicciones antiguas dejaban de puntuarse. */
export const SCORING_CANDLES = 2400;

/** Pérdida pinball media sobre los cuantiles del cono (menor = mejor). Es una regla de puntuación propia. */
export function pinballLoss(y: number, q: Record<string, number>): number {
  let tot = 0;
  for (const k of QS) {
    const tau = Number(k) / 100;
    const d = y - q[k];
    tot += d >= 0 ? tau * d : (tau - 1) * d;
  }
  return tot / QS.length;
}

function predPath(asset: AssetId) {
  return path.join(JOURNAL_DIR, asset === 'btc' ? 'predictions.jsonl' : `predictions_${asset}.jsonl`);
}

export function loadJournalPredictions(asset: AssetId): JournalRecord[] {
  return readJsonl<JournalRecord>(predPath(asset), (r) => normalizeRecord(asset, r));
}

/** Compatibilidad: los registros antiguos guardaban el régimen en `hmm`; ahora es `gmm`. */
function normalizeRecord(asset: AssetId, raw: JournalRecord): JournalRecord {
  const r = { asset, ...raw } as JournalRecord & { hmm?: JournalRecord['gmm'] };
  if (r.hmm && !r.gmm) r.gmm = r.hmm;
  delete r.hmm;
  return r;
}

export function saveJournalPrediction(asset: AssetId, record: JournalRecord) {
  fs.mkdirSync(JOURNAL_DIR, { recursive: true });
  const existing = loadJournalPredictions(asset);
  const byId = new Map<string, JournalRecord>();
  for (const r of existing) byId.set(r.id, r);
  byId.set(record.id, record);
  const sorted = Array.from(byId.keys())
    .sort()
    .map((k) => JSON.stringify(byId.get(k)));
  atomicWrite(predPath(asset), sorted.join('\n') + '\n');
}

function interpPit(x: number, q: Record<string, number>): number {
  const levels = QS.map((k) => Number(k) / 100);
  const prices = QS.map((k) => q[k]);
  if (x <= prices[0]) return 0.0;
  if (x >= prices[prices.length - 1]) return 1.0;
  for (let i = 0; i < prices.length - 1; i++) {
    if (x >= prices[i] && x <= prices[i + 1]) {
      const span = prices[i + 1] - prices[i];
      if (span <= 0) return levels[i];
      const frac = (x - prices[i]) / span;
      return levels[i] + frac * (levels[i + 1] - levels[i]);
    }
  }
  return 0.5;
}

export function scorePredictions(
  asset: AssetId,
  preds: JournalRecord[],
  candles1h: Candle[],
): ScoredRow[] {
  const closeByTs = new Map<number, number>();
  for (const c of candles1h) closeByTs.set(c[0], c[4]);

  const rows: ScoredRow[] = [];
  for (const r of preds) {
    for (const h of HZ) {
      const endTs = r.anchor_ts + h * HOUR;
      const y = closeByTs.get(endTs);
      if (y === undefined) continue;
      const q = r.cone[String(h)];
      const qe = r.cone_ens?.[String(h)];
      const qo = r.cone_opt?.[String(h)];
      if (!q) continue;

      rows.push({
        asset,
        id: r.id,
        h,
        spot: r.spot,
        close: y,
        ret_pct: Number((((y / r.spot) - 1) * 100).toFixed(3)),
        in50: y >= q['25'] && y <= q['75'] ? 1 : 0,
        in90: y >= q['5'] && y <= q['95'] ? 1 : 0,
        pit: Number(interpPit(y, q).toFixed(3)),
        in90_ens: qe ? (y >= qe['5'] && y <= qe['95'] ? 1 : 0) : null,
        in90_opt: qo ? (y >= qo['5'] && y <= qo['95'] ? 1 : 0) : null,
        pin: Number(((pinballLoss(y, q) / r.spot) * 100).toFixed(5)),
        pin_ens: qe ? Number(((pinballLoss(y, qe) / r.spot) * 100).toFixed(5)) : null,
        pin_opt: qo ? Number(((pinballLoss(y, qo) / r.spot) * 100).toFixed(5)) : null,
        p_up: r.p_up?.[String(h)] ?? null,
        fund: r.flags.fund,
        oi_flush: r.flags.oi_flush,
        gmm: r.gmm?.state ?? null,
      });
    }
  }

  rows.sort((a, b) => a.id.localeCompare(b.id) || a.h - b.h);
  return rows;
}

export function summarizeCoverage(rows: ScoredRow[]) {
  return HZ.map((h) => {
    const sub = rows.filter((r) => r.h === h);
    const subEns = sub.filter((r) => r.in90_ens !== null);
    const subOpt = sub.filter((r) => r.in90_opt !== null);
    const mean = (arr: number[]) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null);

    // Las predicciones diarias con horizonte 72 h se solapan: se evalúa sobre una submuestra
    // independiente (una de cada h/24 días), ordenada por fecha.
    const step = Math.max(1, Math.round(h / 24));
    const indep = [...sub].sort((a, b) => a.id.localeCompare(b.id)).filter((_, i) => i % step === 0);
    const nI = indep.length;
    const enough = nI >= MIN_SCORED_INDEP;
    const kup = nI > 0 ? kupiecPof(indep.map((r) => 1 - r.in90), 0.1).p : null;

    // PIT: bajo calibración perfecta es U(0,1). KS contra la uniforme, con valor crítico al 5 %.
    const pits = indep.map((r) => r.pit).sort((a, b) => a - b);
    let ks: number | null = null;
    if (nI > 0) {
      ks = 0;
      pits.forEach((v, i) => {
        ks = Math.max(ks as number, Math.abs((i + 1) / nI - v), Math.abs(v - i / nI));
      });
    }
    const ksCrit = nI > 0 ? 1.358 / Math.sqrt(nI) : null;

    // Brier de p_up frente a la referencia ingenua 0,5 (Brier = 0,25).
    const withP = sub.filter((r) => r.p_up !== null);
    const brier = withP.length
      ? mean(withP.map((r) => ((r.p_up as number) - (r.ret_pct > 0 ? 1 : 0)) ** 2))
      : null;

    const bad = enough && ((kup !== null && kup < 0.05) || (ks !== null && ksCrit !== null && ks > ksCrit));
    return {
      horizon: h,
      n: sub.length,
      c50: mean(sub.map((r) => r.in50 * 100)),
      c90: mean(sub.map((r) => r.in90 * 100)),
      c90_ens: mean(subEns.map((r) => (r.in90_ens ?? 0) * 100)),
      c90_opt: mean(subOpt.map((r) => (r.in90_opt ?? 0) * 100)),
      n_indep: nI,
      kupiec_p: kup,
      pit_mean: mean(sub.map((r) => r.pit)),
      pit_ks: ks,
      pit_ks_crit: ksCrit,
      pin: mean(sub.map((r) => r.pin)),
      pin_ens: mean(subEns.map((r) => r.pin_ens as number)),
      pin_opt: mean(subOpt.map((r) => r.pin_opt as number)),
      brier,
      brier_ref: withP.length ? 0.25 : null,
      verdict: !enough ? ('datos_insuficientes' as const) : bad ? ('sesgado' as const) : ('calibrado' as const),
    };
  });
}

export function summarizeByFlag(rows: ScoredRow[]) {
  const groups: Array<{ label: string; pred: (r: ScoredRow) => boolean }> = [
    { label: 'Funding muy negativo', pred: (r) => r.fund === 'neg' },
    { label: 'Funding muy positivo', pred: (r) => r.fund === 'pos' },
    { label: 'OI con caída fuerte en 1 d', pred: (r) => r.oi_flush === true },
    { label: 'Sin lectura extrema', pred: (r) => r.fund === 'none' && !r.oi_flush },
  ];

  const out: Array<{
    reading: string;
    horizon: number;
    n: number;
    mean_pct: number | null;
    up_pct: number | null;
  }> = [];

  for (const g of groups) {
    for (const h of HZ) {
      const sub = rows.filter((r) => r.h === h && g.pred(r));
      out.push({
        reading: g.label,
        horizon: h,
        n: sub.length,
        mean_pct: sub.length ? sub.reduce((s, r) => s + r.ret_pct, 0) / sub.length : null,
        up_pct: sub.length ? (sub.filter((r) => r.ret_pct > 0).length / sub.length) * 100 : null,
      });
    }
  }
  return out;
}

export async function runLivePredictionSnapshot(asset: AssetId, forceRefresh = true) {
  const [candles1h, oiDaily, lsDaily] = await Promise.all([
    fetchOkxCandles(asset, '1H', 1100, forceRefresh),
    fetchOkxRubik(asset, 'contracts/open-interest-history', {}, 140, forceRefresh),
    fetchOkxRubik(asset, 'contracts/long-short-account-ratio-contract', {}, 140, forceRefresh),
  ]);

  const [deribitFund, okxFund, dvolHourly, chainSnapshot] = await Promise.all([
    asset === 'sol' ? Promise.resolve(undefined) : fetchDeribitFundingHistory(asset, 130, forceRefresh),
    asset === 'sol' ? fetchOkxFundingHistory(asset, 400, forceRefresh) : Promise.resolve(undefined),
    asset === 'sol' ? Promise.resolve(undefined) : fetchDeribitDvol(asset, 130, forceRefresh),
    asset === 'sol' ? Promise.resolve(null) : fetchDeribitOptionsChain(asset, forceRefresh),
  ]);

  const closes = candles1h.map((c) => c[4]);
  const lr: number[] = [];
  for (let i = 1; i < closes.length; i++) lr.push(Math.log(closes[i] / closes[i - 1]));

  const { block, fit } = buildConeBlock(candles1h, 72, HOUR, 3000, '1H', 168);
  const ratio = computeEnsembleRatio(lr, fit, [24, 72]);
  const regimeInfo = classifyRegime(closes);
  const readings = computeDerivativesReadings({
    candles1h,
    oiDaily,
    lsDaily,
    deribitFunding: deribitFund,
    okxFunding: okxFund,
    dvolHourly,
  });
  const gex = asset === 'btc' && chainSnapshot ? computeGex('btc', chainSnapshot) : null;
  const optCone =
    asset !== 'sol' && chainSnapshot ? computeOptionsCone(asset, chainSnapshot, [24, 72]) : null;

  const anchor = block.last_ts;
  const day = new Date(anchor).toISOString().slice(0, 10);
  const spot = block.spot;

  const cone: Record<string, Record<string, number>> = {};
  const cone_ens: Record<string, Record<string, number>> = {};
  const cone_opt: Record<string, Record<string, number>> | null = optCone ? {} : null;
  for (const h of HZ) {
    cone[String(h)] = {};
    cone_ens[String(h)] = {};
    if (cone_opt && optCone) cone_opt[String(h)] = {};
    for (const q of QS) {
      const val = block.cone[q][h];
      cone[String(h)][q] = Number(val.toFixed(2));
      cone_ens[String(h)][q] = Number((spot * Math.exp(ratio[h] * Math.log(val / spot))).toFixed(2));
      if (cone_opt && optCone) {
        const pctOpt = optCone.cone[String(h) as '24' | '72'].q[q];
        cone_opt[String(h)][q] = Number((spot * (1 + pctOpt / 100)).toFixed(2));
      }
    }
  }

  const record: JournalRecord = {
    id: day,
    asset,
    anchor_ts: anchor,
    spot,
    vol_ann_pct: Number((block.vol_now_ann * 100).toFixed(1)),
    vol_pctile: Number(block.vol_pctile.toFixed(1)),
    regime_vol: regimeInfo.current,
    gmm:
      asset === 'btc'
        ? { state: regimeInfo.current, p: Number(regimeInfo.probs[regimeInfo.current].toFixed(3)) }
        : { state: null, p: null },
    readings: {
      fund: readings.fund,
      fund_1d_z: readings.fund_1d_z,
      fund_7d_z: readings.fund_7d_z,
      dvol: readings.dvol,
      dvol_z: readings.dvol_z,
      iv_rv: readings.iv_rv,
      oi_chg_1d: readings.oi_chg_1d,
      oi_chg_7d: readings.oi_chg_7d,
      oi_z: readings.oi_z,
      ls: readings.ls,
      ls_z: readings.ls_z,
    },
    gex: gex
      ? {
          net_gex_m: gex.net_gex_m,
          flip: gex.flip,
          call_wall: gex.call_wall,
          put_wall: gex.put_wall,
          put_call_oi: gex.put_call_oi,
        }
      : { net_gex_m: null, flip: null, call_wall: null, put_wall: null, put_call_oi: null },
    flags: readings.flags,
    bias_applied_pct: 0.0,
    cone,
    cone_ens,
    cone_opt,
    ens_ratio: { '24': Number(ratio[24].toFixed(4)), '72': Number(ratio[72].toFixed(4)) },
    p_up: {
      '24': Number((block.p_close_up['up_24'] ?? 0.5).toFixed(4)),
      '72': Number((block.p_close_up['up_72'] ?? 0.5).toFixed(4)),
    },
  };

  saveJournalPrediction(asset, record);
  return record;
}

export async function exportJournalData(
  asset: AssetId,
  type: 'predictions' | 'scores' | 'report',
): Promise<{ content: string; contentType: string; filename: string }> {
  const preds = loadJournalPredictions(asset);
  if (type === 'predictions') {
    const content = preds.map((p) => JSON.stringify(p)).join('\n') + (preds.length ? '\n' : '');
    return {
      content,
      contentType: 'application/x-ndjson',
      filename: asset === 'btc' ? 'predictions.jsonl' : `predictions_${asset}.jsonl`,
    };
  }

  let candles1h: Candle[] = [];
  try {
    candles1h = await fetchOkxCandles(asset, '1H', SCORING_CANDLES, false);
  } catch {
    candles1h = [];
  }
  const scored = scorePredictions(asset, preds, candles1h);

  if (type === 'scores') {
    const headers = ['asset', 'id', 'h', 'spot', 'close', 'ret_pct', 'in50', 'in90', 'pit', 'in90_ens', 'in90_opt', 'pin', 'pin_ens', 'pin_opt', 'p_up', 'fund', 'oi_flush', 'gmm'];
    const lines = scored.map((r) =>
      [
        r.asset, r.id, r.h, r.spot, r.close, r.ret_pct, r.in50, r.in90, r.pit,
        r.in90_ens === null ? '' : r.in90_ens, r.in90_opt === null ? '' : r.in90_opt,
        r.pin, r.pin_ens ?? '', r.pin_opt ?? '', r.p_up ?? '',
        r.fund, r.oi_flush === null ? '' : r.oi_flush, r.gmm ?? '',
      ].join(','),
    );
    return {
      content: [headers.join(','), ...lines].join('\n') + '\n',
      contentType: 'text/csv; charset=utf-8',
      filename: asset === 'btc' ? 'scores.csv' : `scores_${asset}.csv`,
    };
  }

  const cov = summarizeCoverage(scored);
  const flags = summarizeByFlag(scored);
  const lines = [
    `# Diario de predicciones (${asset.toUpperCase()})`,
    '',
    `Predicciones guardadas: **${preds.length}**. Puntuadas (vencidas): **${scored.length}**.`,
    '',
    '## Cobertura del cono',
    '| Horizonte | n | Dentro del 50 % | Dentro del 90 % | Dentro del 90 % (Ensamble) | Dentro del 90 % (Opciones SVI) |',
    '|---|---|---|---|---|---|',
    ...cov.map(
      (c) =>
        `| ${c.horizon} h | ${c.n} | ${c.c50 !== null ? `${c.c50.toFixed(0)} %` : '—'} | ${c.c90 !== null ? `${c.c90.toFixed(0)} %` : '—'} | ${c.c90_ens !== null ? `${c.c90_ens.toFixed(0)} %` : '—'} | ${c.c90_opt !== null ? `${c.c90_opt.toFixed(0)} %` : '—'} |`,
    ),
    '',
    '## Calibración estadística',
    '| Horizonte | n indep. | p Kupiec (90 %) | PIT medio | KS / crítico | Pinball base | Ens. | Opt. | Brier p↑ (ref 0,25) | Veredicto |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...cov.map(
      (c) =>
        `| ${c.horizon} h | ${c.n_indep} | ${c.kupiec_p !== null ? c.kupiec_p.toFixed(3) : '—'} | ${c.pit_mean !== null ? c.pit_mean.toFixed(3) : '—'} | ${c.pit_ks !== null && c.pit_ks_crit !== null ? `${c.pit_ks.toFixed(3)} / ${c.pit_ks_crit.toFixed(3)}` : '—'} | ${c.pin !== null ? c.pin.toFixed(4) : '—'} | ${c.pin_ens !== null ? c.pin_ens.toFixed(4) : '—'} | ${c.pin_opt !== null ? c.pin_opt.toFixed(4) : '—'} | ${c.brier !== null ? c.brier.toFixed(3) : '—'} | ${c.verdict} |`,
    ),
    '',
    '## Retorno posterior según lectura',
    '| Lectura | Horizonte | n | Retorno medio | % subidas |',
    '|---|---|---|---|---|',
    ...flags.map(
      (f) =>
        `| ${f.reading} | ${f.horizon} h | ${f.n} | ${f.mean_pct !== null ? `${f.mean_pct.toFixed(2)} %` : '—'} | ${f.up_pct !== null ? `${f.up_pct.toFixed(0)} %` : '—'} |`,
    ),
    '',
  ];
  return {
    content: lines.join('\n'),
    contentType: 'text/markdown; charset=utf-8',
    filename: `REPORT_${asset}.md`,
  };
}

// ---------------------------------------------------------------------------
// Automatic Daily Journal Scheduler (runs at startup & every 15 min)
// ---------------------------------------------------------------------------

const ALL_ASSETS: AssetId[] = ['btc', 'eth', 'sol'];
let autoEnabled = readSettings().autoJournal ?? true;
let autoRunning = false;
let lastCheckTs: number | null = null;
let lastSavedTs: number | null = null;
let lastError: string | null = null;
let autoTimer: ReturnType<typeof setInterval> | null = null;

export function getAutoJournalStatus(): AutoJournalStatus {
  const savedDates = {} as Record<AssetId, string | null>;
  for (const a of ALL_ASSETS) {
    const preds = loadJournalPredictions(a);
    savedDates[a] = preds.length ? preds[preds.length - 1].id : null;
  }
  return {
    enabled: autoEnabled,
    running: autoRunning,
    lastCheckTs,
    lastSavedTs,
    savedDates,
    lastError,
  };
}

export async function ensureTodayJournalSnapshots(): Promise<JournalRecord[]> {
  if (!autoEnabled || autoRunning) return [];
  autoRunning = true;
  lastError = null;
  const saved: JournalRecord[] = [];
  try {
    const latestClosedHourOpen = Math.floor(Date.now() / HOUR) * HOUR - HOUR;
    const targetDay = new Date(latestClosedHourOpen).toISOString().slice(0, 10);

    for (const asset of ALL_ASSETS) {
      const existing = loadJournalPredictions(asset);
      const hasTargetDay = existing.some((r) => r.id === targetDay);
      if (!hasTargetDay) {
        try {
          const rec = await runLivePredictionSnapshot(asset, false);
          saved.push(rec);
          await new Promise((r) => setTimeout(r, 250));
        } catch (err) {
          lastError = err instanceof Error ? err.message : `Auto-snapshot error (${asset})`;
          console.warn(`Auto journal snapshot failed for ${asset}:`, err);
        }
      }
    }
    lastCheckTs = Date.now();
    if (saved.length > 0) {
      lastSavedTs = Date.now();
    }
  } finally {
    autoRunning = false;
  }
  return saved;
}

export function setAutoJournalEnabled(enabled: boolean): AutoJournalStatus {
  autoEnabled = enabled;
  updateSettings({ autoJournal: enabled });
  if (enabled) {
    void ensureTodayJournalSnapshots();
  }
  return getAutoJournalStatus();
}

export function startAutoJournalScheduler() {
  if (autoTimer) return;
  setTimeout(() => {
    void ensureTodayJournalSnapshots();
  }, 6000);
  autoTimer = setInterval(() => {
    void ensureTodayJournalSnapshots();
  }, 15 * 60_000);
}


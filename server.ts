import express from 'express';
import path from 'path';
import { exec } from 'child_process';
import type { AssetId, RadarAssetItem } from './server/types.ts';
import {
  fetchDeribitDvol,
  fetchDeribitFundingHistory,
  fetchDeribitOptionsChain,
  fetchOkxCandles,
  fetchOkxFundingHistory,
  fetchOkxLiveMicroSnapshot,
  fetchOkxRubik,
} from './server/marketData.ts';
import {
  buildConeBlock,
  classifyRegime,
  computeBiasAnalysis,
  computeDerivativesReadings,
  computeEnsembleRatio,
  computeGex,
  computeOptionsCone,
  computeTradeGrid,
  runWalkForwardCalibration,
  simulateCustomTrade,
} from './server/quantEngine.ts';
import { computeTargetProbability } from './server/coneTarget.ts';
import {
  ensureTodayJournalSnapshots,
  exportJournalData,
  getAutoJournalStatus,
  loadJournalPredictions,
  runLivePredictionSnapshot,
  scorePredictions,
  setAutoJournalEnabled,
  startAutoJournalScheduler,
  summarizeByFlag,
  summarizeCoverage,
} from './server/journalService.ts';
import {
  computeMicroStudy,
  exportMicroData,
  getCollectorStatus,
  getLiveBuffer,
  pushLiveMicroTick,
  startMicroCollector,
  stopMicroCollector,
} from './server/microService.ts';
import { getRotationAnalysis } from './server/rotationService.ts';
import { IS_PACKAGED } from './server/paths.ts';
import { backupData, dataStatus, heartbeat, migrateLegacyData, readSettings, startSession } from './server/storage.ts';
import {
  closeRegisteredTradeOptionManual,
  contextOf,
  computeTradeOptions,
  deleteRegisteredTradeOptionById,
  ensureAutoTradeOptionsForAllAssets,
  loadRegisteredTradeOptions,
  proposalToRegisteredRecord,
  upsertRegisteredTradeOption,
} from './server/tradeOptionsService.ts';

// Inyectado por el empaquetado (esbuild/CJS): ruta de la carpeta del bundle dentro del ejecutable.
declare const __dirname: string;

// El .exe siempre sirve la interfaz ya compilada (sin Vite en caliente).
if (IS_PACKAGED) process.env.NODE_ENV = 'production';

const VALID_ASSETS = new Set<AssetId>(['btc', 'eth', 'sol']);

function parseAsset(raw: unknown): AssetId {
  const s = String(raw ?? 'btc').toLowerCase() as AssetId;
  return VALID_ASSETS.has(s) ? s : 'btc';
}

async function computeAssetOverview(asset: AssetId, refresh = false) {
  const [candles1h, candles1d, oiDaily, lsDaily] = await Promise.all([
    fetchOkxCandles(asset, '1H', 1100, refresh),
    fetchOkxCandles(asset, '1D', 360, refresh),
    fetchOkxRubik(asset, 'contracts/open-interest-history', {}, 140, refresh),
    fetchOkxRubik(asset, 'contracts/long-short-account-ratio-contract', {}, 140, refresh),
  ]);

  const [deribitFund, okxFund, dvolHourly, chainSnapshot] = await Promise.all([
    asset === 'sol' ? Promise.resolve(undefined) : fetchDeribitFundingHistory(asset, 130, refresh),
    asset === 'sol' ? fetchOkxFundingHistory(asset, 400, refresh) : Promise.resolve(undefined),
    asset === 'sol' ? Promise.resolve(undefined) : fetchDeribitDvol(asset, 130, refresh),
    asset === 'sol' ? Promise.resolve(null) : fetchDeribitOptionsChain(asset, refresh),
  ]);

  const closes1h = candles1h.map((c) => c[4]);
  const lr1h: number[] = [];
  for (let i = 1; i < closes1h.length; i++) lr1h.push(Math.log(closes1h[i] / closes1h[i - 1]));

  const { block: b1Pre, fit: fit1h } = buildConeBlock(candles1h, 72, 3_600_000, 3000, '1H', 168);
  const ensRatio = computeEnsembleRatio(lr1h, fit1h, [24, 72]);

  const b1 = {
    ...b1Pre,
    cone_ens: (() => {
      const out: Record<string, number[]> = {};
      const qs = Object.keys(b1Pre.cone);
      for (const q of qs) out[q] = [b1Pre.spot];
      const r24 = ensRatio[24] ?? 1.0;
      const r72 = ensRatio[72] ?? 1.0;
      for (let step = 1; step <= b1Pre.H; step++) {
        const r = step <= 24 ? 1 + (r24 - 1) * (step / 24) : r24 + (r72 - r24) * ((step - 24) / 48);
        for (const q of qs) {
          const v = b1Pre.cone[q][step];
          out[q].push(Number((b1Pre.spot * Math.exp(r * Math.log(v / b1Pre.spot))).toFixed(2)));
        }
      }
      return out;
    })(),
  };

  const { block: bd } = buildConeBlock(candles1d, 30, 86_400_000, 3000, '1D', 90);
  const regime = classifyRegime(closes1h);
  const readings = computeDerivativesReadings({
    candles1h,
    oiDaily,
    lsDaily,
    deribitFunding: deribitFund,
    okxFunding: okxFund,
    dvolHourly,
  });

  const gex = chainSnapshot && asset !== 'sol' ? computeGex(asset, chainSnapshot) : null;
  const options_cone = chainSnapshot && asset !== 'sol' ? computeOptionsCone(asset, chainSnapshot, [24, 72]) : null;

  return {
    generated: Date.now(),
    asset,
    inst: `${asset.toUpperCase()}-USDT-SWAP`,
    n_hours: candles1h.length,
    n_days: candles1d.length,
    regime,
    ens_ratio: { '24': Number(ensRatio[24].toFixed(4)), '72': Number(ensRatio[72].toFixed(4)) },
    h1: b1,
    d1: bd,
    readings,
    gex,
    options_cone,
    candles1h,
  };
}

async function startServer() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, ts: Date.now() });
  });

  // Main asset overview
  app.get('/api/overview', async (req, res) => {
    try {
      const asset = parseAsset(req.query.asset);
      const refresh = req.query.refresh === '1';
      const ov = await computeAssetOverview(asset, refresh);
      const { candles1h: _omit, ...payload } = ov;
      res.json(payload);
    } catch (err) {
      console.error('Overview error:', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to compute overview' });
    }
  });

  // Multi-asset radar summary (BTC, ETH, SOL side-by-side)
  app.get('/api/radar', async (req, res) => {
    try {
      const refresh = req.query.refresh === '1';
      const assets: AssetId[] = ['btc', 'eth', 'sol'];
      const results = [];
      for (const a of assets) {
        results.push(await computeAssetOverview(a, refresh));
      }
      const items: RadarAssetItem[] = results.map((ov) => {
        const c = ov.candles1h;
        const spot = ov.h1.spot;
        const close24Ago = c.length > 25 ? c[c.length - 25][4] : spot;
        const chg24 = close24Ago > 0 ? ((spot / close24Ago) - 1) * 100 : 0;
        return {
          asset: ov.asset,
          inst: ov.inst,
          spot,
          chg_24h_pct: Number(chg24.toFixed(2)),
          vol_ann_pct: Number((ov.h1.vol_now_ann * 100).toFixed(1)),
          vol_pctile: Number(ov.h1.vol_pctile.toFixed(1)),
          regime: ov.regime.current,
          ens_ratio_72: ov.ens_ratio['72'],
          cone24_lo: ov.h1.cone['5'][24],
          cone24_hi: ov.h1.cone['95'][24],
          net_gex_m: ov.gex ? ov.gex.net_gex_m : null,
          fund_1d_z: ov.readings.fund_1d_z,
          oi_chg_1d: ov.readings.oi_chg_1d,
          flags: ov.readings.flags,
        };
      });
      res.json({ generated: Date.now(), items });
    } catch (err) {
      console.error('Radar error:', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to compute radar' });
    }
  });

  // Probabilidad de alcanzar un precio objetivo (cono GJR-GARCH + ensamble)
  app.get('/api/cone/target', async (req, res) => {
    try {
      const asset = parseAsset(req.query.asset);
      const price = Number(req.query.price);
      const hours = Number(req.query.hours ?? 24);
      if (!Number.isFinite(price) || price <= 0) {
        res.status(400).json({ error: 'price inválido' });
        return;
      }
      res.json(await computeTargetProbability(asset, price, Number.isFinite(hours) ? hours : 24));
    } catch (err) {
      console.error('Target probability error:', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to compute target probability' });
    }
  });

  // Walk-forward calibration & 10-bin PIT histogram
  app.get('/api/walkforward', async (req, res) => {
    try {
      const asset = parseAsset(req.query.asset);
      const candles1h = await fetchOkxCandles(asset, '1H', 1100, false);
      const wf = runWalkForwardCalibration(asset, candles1h);
      res.json(wf);
    } catch (err) {
      console.error('Walk-forward error:', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to run walk-forward' });
    }
  });

  // bias.py 8 predefined rules + logistic Models A/B
  app.get('/api/bias', async (req, res) => {
    try {
      const asset = parseAsset(req.query.asset);
      const refresh = req.query.refresh === '1';
      const [candles1d, oiDaily, lsDaily] = await Promise.all([
        fetchOkxCandles(asset, '1D', 200, refresh),
        fetchOkxRubik(asset, 'contracts/open-interest-history', {}, 140, refresh),
        fetchOkxRubik(asset, 'contracts/long-short-account-ratio-contract', {}, 140, refresh),
      ]);
      const [deribitFund, okxFund, dvolHourly] = await Promise.all([
        asset === 'sol' ? Promise.resolve(undefined) : fetchDeribitFundingHistory(asset, 140, refresh),
        asset === 'sol' ? fetchOkxFundingHistory(asset, 400, refresh) : Promise.resolve(undefined),
        asset === 'sol' ? Promise.resolve(undefined) : fetchDeribitDvol(asset, 140, refresh),
      ]);
      const bias = computeBiasAnalysis({
        asset,
        candles1d,
        oiDaily,
        lsDaily,
        deribitFunding: deribitFund,
        okxFunding: okxFund,
        dvolHourly,
      });
      res.json(bias);
    } catch (err) {
      console.error('Bias analysis error:', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to compute bias analysis' });
    }
  });

  // Dedicated Deribit Options GEX endpoint (BTC or ETH)
  app.get('/api/gex', async (req, res) => {
    try {
      const raw = String(req.query.asset ?? 'btc').toLowerCase();
      const asset: 'btc' | 'eth' = raw === 'eth' ? 'eth' : 'btc';
      const refresh = req.query.refresh === '1';
      const chainSnapshot = await fetchDeribitOptionsChain(asset, refresh);
      const gex = computeGex(asset, chainSnapshot);
      res.json(gex);
    } catch (err) {
      console.error('GEX error:', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to compute GEX' });
    }
  });

  // Stop/Target EV, Kelly & Contrarian Events Grid
  app.get('/api/trades', async (req, res) => {
    try {
      const asset = parseAsset(req.query.asset);
      const refresh = req.query.refresh === '1';
      const candles1h = await fetchOkxCandles(asset, '1H', 1600, refresh);
      const result = computeTradeGrid(asset, candles1h);
      res.json(result);
    } catch (err) {
      console.error('Trades error:', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to compute trade grid' });
    }
  });

  // Interactive What-If trade simulator (custom SL/TP/Fee/Drift)
  app.post('/api/trades/simulate', async (req, res) => {
    try {
      const asset = parseAsset(req.body?.asset);
      const dir = req.body?.dir === 'short' ? 'short' : 'long';
      const slPct = Number(req.body?.sl_pct ?? 2);
      const tpPct = Number(req.body?.tp_pct ?? 4);
      const costPct = Number(req.body?.cost_pct ?? 0.1);
      const drift24hPct = Number(req.body?.drift_24h_pct ?? 0);

      if (!Number.isFinite(slPct) || !Number.isFinite(tpPct) || slPct <= 0 || tpPct <= 0) {
        return res.status(400).json({ error: 'SL y TP deben ser mayores a 0' });
      }
      const candles1h = await fetchOkxCandles(asset, '1H', 1600, false);
      const row = simulateCustomTrade({
        candles1h,
        dir,
        slPct,
        tpPct,
        costPct,
        drift24hPct,
      });
      res.json(row);
    } catch (err) {
      console.error('Trade simulate error:', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Simulation failed' });
    }
  });

  // Opciones de Trading: Market + Technical Confluence + Registered Operations
  app.get('/api/trade-options', async (req, res) => {
    try {
      const asset = parseAsset(req.query.asset);
      const refresh = req.query.refresh === '1';
      const data = await computeTradeOptions(asset, refresh, true);
      res.json(data);
    } catch (err) {
      console.error('Trade options error:', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to compute trade options' });
    }
  });

  // Estado de los datos guardados: dónde están, cuántos hay, huecos por apagados y copias de seguridad.
  app.get('/api/data-status', (_req, res) => {
    try {
      const opts = loadRegisteredTradeOptions();
      const preds = (['btc', 'eth', 'sol'] as AssetId[]).flatMap((a) => loadJournalPredictions(a));
      const stamps = [...opts.map((o) => o.createdTs), ...preds.map((p) => p.anchor_ts)];
      res.json(
        dataStatus({
          options: opts.length,
          predictions: preds.length,
          firstRecordTs: stamps.length ? Math.min(...stamps) : null,
        }),
      );
    } catch (err) {
      console.error('Data status error:', err);
      res.status(500).json({ error: 'Failed to read data status' });
    }
  });

  // Exportación de todas las opciones guardadas con su evaluación (copia de seguridad / análisis externo).
  app.get('/api/trade-options/export', (req, res) => {
    try {
      const rows = loadRegisteredTradeOptions();
      if (String(req.query.format ?? 'csv') === 'jsonl') {
        res.setHeader('Content-Type', 'application/x-ndjson');
        res.setHeader('Content-Disposition', 'attachment; filename="trade_options.jsonl"');
        res.send(rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
        return;
      }
      const cols = [
        'id', 'asset', 'strategyKey', 'rank', 'dir', 'horizonHours', 'createdIso', 'entryPrice', 'stopLoss',
        'takeProfit1', 'takeProfit2', 'rr', 'probTpPct', 'evPct', 'confluenceScore', 'confidence', 'status',
        'exitPrice', 'realizedPnlPct', 'mfePct', 'maePct', 'tp2Hit', 'closeRetPct', 'dirCorrect', 'mirrorStatus',
        'horizonDone', 'source',
      ] as const;
      const esc = (v: unknown) => {
        const t = v === null || v === undefined ? '' : String(v);
        return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
      };
      const lines = [cols.join(',')];
      for (const r of rows) lines.push(cols.map((c) => esc((r as unknown as Record<string, unknown>)[c])).join(','));
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="trade_options.csv"');
      res.send(lines.join('\n') + '\n');
    } catch (err) {
      console.error('Trade options export error:', err);
      res.status(500).json({ error: 'Export failed' });
    }
  });

  app.post('/api/trade-options/register', async (req, res) => {
    try {
      const asset = parseAsset(req.body?.asset);
      const strategyKey = req.body?.strategyKey ? String(req.body.strategyKey) : null;
      const data = await computeTradeOptions(asset, false, false);
      const match = strategyKey
        ? data.proposals.find((p) => p.strategyKey === strategyKey)
        : data.proposals[0];
      if (!match) {
        return res.status(404).json({ error: 'No se encontró la opción de trading solicitada' });
      }
      const now = Date.now();
      const record = proposalToRegisteredRecord(match, 'manual', now, `m_${now}`, undefined, contextOf(data.regime, data.technicals, data.marketBias));
      upsertRegisteredTradeOption(record);
      const updated = await computeTradeOptions(asset, false, false);
      res.json({ saved: record, options: updated });
    } catch (err) {
      console.error('Trade option register error:', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to register trade option' });
    }
  });

  app.patch('/api/trade-options/:id', async (req, res) => {
    try {
      const id = String(req.params.id ?? '').trim();
      const asset = parseAsset(req.body?.asset);
      const current = loadRegisteredTradeOptions().find((r) => r.id === id);
      if (!current) {
        return res.status(404).json({ error: 'Operación registrada no encontrada' });
      }
      const candles = await fetchOkxCandles(current.asset ?? asset, '1H', 5, false);
      const exitPrice = candles.length ? candles[candles.length - 1][4] : current.entryPrice;
      const updated = closeRegisteredTradeOptionManual(id, exitPrice);
      res.json({ updated });
    } catch (err) {
      console.error('Trade option close error:', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update trade option' });
    }
  });

  app.delete('/api/trade-options/:id', (req, res) => {
    try {
      const id = String(req.params.id ?? '').trim();
      const removed = deleteRegisteredTradeOptionById(id);
      if (!removed) {
        return res.status(404).json({ error: 'Operación no encontrada' });
      }
      res.json({ ok: true });
    } catch (err) {
      console.error('Trade option delete error:', err);
      res.status(500).json({ error: 'Failed to delete trade option' });
    }
  });

  // Prediction Journal & Forward Validation Scoring
  app.get('/api/journal', async (req, res) => {
    try {
      const raw = String(req.query.asset ?? 'all').toLowerCase();
      const assets: AssetId[] = raw === 'all' ? ['btc', 'eth', 'sol'] : [parseAsset(raw)];

      const out = await Promise.all(
        assets.map(async (asset) => {
          const preds = loadJournalPredictions(asset);
          let candles1h: Awaited<ReturnType<typeof fetchOkxCandles>> = [];
          try {
            candles1h = await fetchOkxCandles(asset, '1H', 500, false);
          } catch (e) {
            console.warn(`Unable to fetch 1H candles for ${asset} scoring:`, e);
          }
          const scored = scorePredictions(asset, preds, candles1h);
          return {
            asset,
            predictions: preds,
            scored,
            coverage: summarizeCoverage(scored),
            by_flag: summarizeByFlag(scored),
          };
        }),
      );

      res.json({ assets: out, auto: getAutoJournalStatus() });
    } catch (err) {
      console.error('Journal GET error:', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load journal' });
    }
  });

  app.get('/api/journal/auto', (_req, res) => {
    res.json(getAutoJournalStatus());
  });

  app.post('/api/journal/auto', async (req, res) => {
    try {
      if (typeof req.body?.enabled === 'boolean') {
        const status = setAutoJournalEnabled(req.body.enabled);
        return res.json(status);
      }
      if (req.body?.trigger === true) {
        await ensureTodayJournalSnapshots();
        return res.json(getAutoJournalStatus());
      }
      return res.json(getAutoJournalStatus());
    } catch (err) {
      console.error('Journal auto config error:', err);
      res.status(500).json({ error: 'Auto journal config failed' });
    }
  });

  app.get('/api/journal/export', async (req, res) => {
    try {
      const asset = parseAsset(req.query.asset);
      const rawType = String(req.query.type ?? 'scores');
      const type = rawType === 'predictions' || rawType === 'report' ? rawType : 'scores';
      const exported = await exportJournalData(asset, type);
      res.setHeader('Content-Type', exported.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
      res.send(exported.content);
    } catch (err) {
      console.error('Journal export error:', err);
      res.status(500).json({ error: 'Export failed' });
    }
  });

  // Run live prediction snapshot and append to journal
  app.post('/api/journal/run', async (req, res) => {
    try {
      const raw = req.body?.assets;
      const assets: AssetId[] = Array.isArray(raw) && raw.length
        ? raw.map(parseAsset)
        : ['btc', 'eth', 'sol'];

      const saved = [];
      for (const a of assets) {
        const rec = await runLivePredictionSnapshot(a, true);
        saved.push(rec);
      }
      res.json({ saved, auto: getAutoJournalStatus() });
    } catch (err) {
      console.error('Journal run error:', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to run snapshot' });
    }
  });

  // Live OKX orderbook + microstructure snapshot
  app.get('/api/micro/live', async (req, res) => {
    try {
      const asset = parseAsset(req.query.asset);
      const recordTick = req.query.record === '1';
      const snap = await fetchOkxLiveMicroSnapshot(asset);
      if (recordTick) {
        pushLiveMicroTick(snap.tick);
      }
      res.json({
        ...snap,
        buffer_len: getLiveBuffer().length,
        collector: getCollectorStatus(),
      });
    } catch (err) {
      console.error('Micro live error:', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to fetch live microstructure' });
    }
  });

  // Background 1-minute microstructure collector control
  app.get('/api/micro/collector', (_req, res) => {
    res.json(getCollectorStatus());
  });

  app.post('/api/micro/collector', async (req, res) => {
    try {
      const action = String(req.body?.action ?? '');
      const asset = parseAsset(req.body?.asset);
      if (action === 'start') {
        const status = await startMicroCollector(asset);
        return res.json(status);
      }
      if (action === 'stop') {
        const status = stopMicroCollector();
        return res.json(status);
      }
      return res.status(400).json({ error: 'action must be start or stop' });
    } catch (err) {
      console.error('Collector control error:', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Collector error' });
    }
  });

  app.get('/api/micro/export', (req, res) => {
    try {
      const format = req.query.format === 'jsonl' ? 'jsonl' : 'csv';
      const data = exportMicroData(format);
      res.setHeader(
        'Content-Type',
        format === 'jsonl' ? 'application/x-ndjson' : 'text/csv; charset=utf-8',
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="microstructure_data.${format}"`,
      );
      res.send(data);
    } catch (err) {
      console.error('Micro export error:', err);
      res.status(500).json({ error: 'Export failed' });
    }
  });

  // Microstructure historical CSV + live ring buffer Spearman IC study
  app.get('/api/micro/study', (_req, res) => {
    try {
      const study = computeMicroStudy();
      res.json(study);
    } catch (err) {
      console.error('Micro study error:', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to compute microstructure study' });
    }
  });

  // 40-coin OKX SWAP cross-sectional momentum rotation (rotation.py)
  app.get('/api/rotation', async (req, res) => {
    try {
      const refresh = req.query.refresh === '1';
      const data = await getRotationAnalysis(refresh);
      res.json(data);
    } catch (err) {
      console.error('Rotation error:', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to compute rotation' });
    }
  });

  // Empirical walk-forward validation benchmarks from RESULTS.md (sections 1-7)
  app.get('/api/results', (_req, res) => {
    res.json({
      sample_note: 'Velas 1H de OKX (BTC, ETH y SOL, ~3,4 años cada uno) y DVOL de Deribit (BTC y ETH, desde dic-2023). Walk-forward estricto sin look-ahead.',
      vol_ensemble: [
        { asset: 'BTC', horizon: '24 h', har: '+0.05 %', ens: '+0.38 % [0.0; +0.8]', ens_iv: '+0.39 % [-0.2; +1.0]', positive: false },
        { asset: 'BTC', horizon: '72 h', har: '+0.20 %', ens: '+0.78 % [+0.2; +1.4]', ens_iv: '+0.58 % [-0.3; +1.3]', positive: true },
        { asset: 'ETH', horizon: '24 h', har: '+0.66 %', ens: '+0.76 % [+0.4; +1.2]', ens_iv: '+0.90 % [+0.3; +1.5]', positive: true },
        { asset: 'ETH', horizon: '72 h', har: '+1.33 %', ens: '+1.09 % [+0.2; +2.1]', ens_iv: '+1.45 % [+0.2; +2.7]', positive: true },
        { asset: 'SOL', horizon: '24 h', har: '-0.04 %', ens: '+0.40 % [0.0; +0.8]', ens_iv: 'Sin DVOL', positive: false },
        { asset: 'SOL', horizon: '72 h', har: '+1.84 %', ens: '+1.69 % [+0.8; +2.7]', ens_iv: 'Sin DVOL', positive: true },
      ],
      directional_signals: [
        { asset: 'ETH', horizon: '6 h', hit_pct: 51.2, auc: 0.523, net_pct: -0.106, ci: '[-0.162; -0.048]' },
        { asset: 'ETH', horizon: '24 h', hit_pct: 52.7, auc: 0.512, net_pct: 0.082, ci: '[-0.138; +0.316]' },
        { asset: 'ETH', horizon: '72 h', hit_pct: 49.8, auc: 0.512, net_pct: 0.075, ci: '[-0.640; +0.774]' },
        { asset: 'SOL', horizon: '6 h', hit_pct: 51.1, auc: 0.522, net_pct: -0.059, ci: '[-0.121; +0.004]' },
        { asset: 'SOL', horizon: '24 h', hit_pct: 49.5, auc: 0.493, net_pct: -0.009, ci: '[-0.269; +0.250]' },
        { asset: 'SOL', horizon: '72 h', hit_pct: 50.8, auc: 0.505, net_pct: -0.023, ci: '[-0.706; +0.697]' },
      ],
      binance_intraday: [
        { asset: 'BTC', horizon: '5 min', hit_pct: 53.3, auc: 0.551, gross_pct: 0.005, net_pct: -0.095 },
        { asset: 'BTC', horizon: '15 min', hit_pct: 52.5, auc: 0.539, gross_pct: 0.004, net_pct: -0.096 },
        { asset: 'BTC', horizon: '60 min', hit_pct: 52.0, auc: 0.526, gross_pct: -0.002, net_pct: -0.102 },
        { asset: 'ETH', horizon: '5 min', hit_pct: 61.2, auc: 0.672, gross_pct: 0.040, net_pct: -0.060 },
        { asset: 'ETH', horizon: '15 min', hit_pct: 57.6, auc: 0.614, gross_pct: 0.044, net_pct: -0.056 },
        { asset: 'ETH', horizon: '60 min', hit_pct: 54.1, auc: 0.561, gross_pct: 0.035, net_pct: -0.066 },
      ],
      formal_eval_note:
        'DM (CRPS ensamble GARCH+HAR vs GARCH a 72 h): p = 0,006 (BTC), 0,004 (ETH), 0,000 (SOL); a 24 h: p = 0,08 / 0,000 / 0,054. Kupiec 90 % pasa en todos salvo GARCH ETH 72 h (p = 0,03), corregido por el ensamble (p = 0,24).',
      conformal_note:
        'ACI con retroalimentación retrasada (γ = 0,02): cobertura 89,8–90,2 % frente a 90,1–91,4 % estática; ancho similar y Winkler ligeramente peor. Se mantiene como red de seguridad ante cambios de régimen.',
      options_cone_note:
        'Cono SVI + densidad de Breeden-Litzenberger en varianza total (medida neutral al riesgo, error de ajuste típico 0,1–3 pts IV). Guardado hacia adelante como cone_opt para contrastar cobertura frente a GJR-GARCH.',
      rotation_summary: {
        primary_sharpe: 0.60,
        nw_t: 1.01,
        dsr: 0.42,
        best_variant: 'L14_k5_r14',
        best_sharpe: 1.48,
        best_dsr: 0.91,
        note: 'Universo de 40 swaps de OKX con mayor volumen hoy (cota optimista con sesgo de supervivencia). 100 % de las 45 variantes con Sharpe > 0, pero no supera DSR > 0,95 ni t(NW) > 3.',
      },
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    // Nombre en variable a propósito: el empaquetado del .exe no debe arrastrar Vite (solo se usa en desarrollo).
    const viteModule = 'vite';
    const { createServer: createViteServer } = (await import(viteModule)) as typeof import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = IS_PACKAGED ? path.join(__dirname, '..', 'dist') : path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  // Arranque: recupera datos de versiones antiguas, registra la sesión (para medir huecos por apagados)
  // y hace copia de seguridad. Los datos de ejecuciones anteriores se conservan siempre.
  migrateLegacyData();
  const { gapMs } = startSession();
  backupData();
  setInterval(heartbeat, 60_000);
  setInterval(backupData, 6 * 3_600_000);
  const shutdown = () => {
    heartbeat();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  const PORT = Number(process.env.PORT || 3000);
  const HOST = process.env.HOST || (IS_PACKAGED ? '127.0.0.1' : '0.0.0.0');
  app.listen(PORT, HOST, () => {
    console.log(`Trading Predictor server listening on http://${HOST}:${PORT}`);
    if (IS_PACKAGED) {
      const url = `http://localhost:${PORT}`;
      console.log(`\nTrading Predictor en marcha: ${url}\nDeja esta ventana abierta mientras uses la app; ciérrala para detenerla.\n`);
      if (process.env.NO_OPEN !== '1') {
        const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
        exec(cmd, () => undefined);
      }
    }
    if (gapMs !== null && gapMs > 3_600_000) {
      console.log(`La app estuvo apagada ${(gapMs / 3_600_000).toFixed(1)} h; se retoma la recopilación y se evalúan las opciones pendientes.`);
    }
    const micro = readSettings().micro;
    if (micro?.running) {
      void startMicroCollector(micro.asset).catch((e) => console.warn('No se pudo reanudar el colector micro:', e));
    }
    startAutoJournalScheduler();
    setTimeout(() => {
      void ensureAutoTradeOptionsForAllAssets();
    }, 12_000);
    setInterval(() => {
      void ensureAutoTradeOptionsForAllAssets();
    }, 30 * 60_000);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

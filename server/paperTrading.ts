import type { RegisteredTradeOption } from './types.ts';

const HOUR = 3_600_000;

export interface PaperConfig {
  startEquity: number;
  /** Riesgo por operación (% del capital) si el SL se ejecuta. */
  riskPct: number;
  /** Riesgo máximo que se puede abrir en un mismo día UTC. */
  maxDailyRiskPct: number;
  /** Riesgo abierto máximo en la misma dirección (BTC/ETH/SOL están muy correlacionados). */
  maxDirRiskPct: number;
  /** Operaciones abiertas a la vez por activo. */
  maxPerAsset: number;
  /** Qué veredicto mínimo exige para ejecutar. */
  minVerdict: 'validada' | 'prometedora' | 'todas';
  /** Para y no abre nuevas operaciones si el capital cae este % desde máximos. */
  maxDrawdownStopPct: number;
}

export const DEFAULT_PAPER: PaperConfig = {
  startEquity: 10_000,
  riskPct: 0.5,
  maxDailyRiskPct: 2,
  maxDirRiskPct: 1,
  maxPerAsset: 1,
  minVerdict: 'validada',
  maxDrawdownStopPct: 15,
};

export interface PaperTrade {
  id: string;
  asset: string;
  strategyKey: string;
  dir: 'long' | 'short';
  openTs: number;
  closeTs: number | null;
  riskPct: number;
  rMultiple: number | null;
  pnl: number | null;
  equityAfter: number | null;
  status: string;
}

export interface PaperSkipped {
  id: string;
  asset: string;
  ts: number;
  reason: 'veredicto' | 'riesgo_diario' | 'riesgo_direccional' | 'activo_ocupado' | 'parada_drawdown';
}

export interface PaperResult {
  config: PaperConfig;
  trades: PaperTrade[];
  skipped: PaperSkipped[];
  equity: Array<{ ts: number; equity: number }>;
  stats: {
    n_closed: number;
    n_open: number;
    win_rate_pct: number | null;
    total_return_pct: number;
    max_dd_pct: number;
    profit_factor: number | null;
    avg_r: number | null;
    open_risk_pct: number;
    halted: boolean;
  };
}

const RANK: Record<string, number> = { validada: 2, prometedora: 1 };

function passes(v: string | undefined, min: PaperConfig['minVerdict']): boolean {
  if (min === 'todas') return true;
  return (RANK[v ?? ''] ?? 0) >= (min === 'validada' ? 2 : 1);
}

const closed = (r: RegisteredTradeOption) => r.status === 'tp_hit' || r.status === 'sl_hit' || r.status === 'expired' || r.status === 'closed_manual';

/**
 * Cartera de papel: ejecuta las propuestas registradas con tamaño fijo por riesgo (R) y límites de riesgo diario,
 * direccional (activos correlacionados) y por activo. Determinista: se recalcula siempre desde el registro.
 */
export function simulatePaper(rows: RegisteredTradeOption[], cfgIn: Partial<PaperConfig> = {}, now = Date.now()): PaperResult {
  const cfg = { ...DEFAULT_PAPER, ...cfgIn };
  const sorted = [...rows]
    .filter((r) => r.source === 'auto' || r.source === 'manual')
    .sort((a, b) => a.createdTs - b.createdTs);

  const exitTs = (r: RegisteredTradeOption) => r.evaluatedTs ?? r.createdTs + r.horizonHours * HOUR;

  let equity = cfg.startEquity;
  let peak = equity;
  let maxDd = 0;
  let halted = false;
  const curve: PaperResult['equity'] = [];
  const trades: PaperTrade[] = [];
  const skipped: PaperSkipped[] = [];

  // Se procesa por eventos: aperturas y cierres ordenados en el tiempo.
  type Ev = { ts: number; kind: 'open' | 'close'; r: RegisteredTradeOption };
  const evs: Ev[] = [];
  for (const r of sorted) {
    evs.push({ ts: r.createdTs, kind: 'open', r });
    if (closed(r)) evs.push({ ts: exitTs(r), kind: 'close', r });
  }
  evs.sort((a, b) => a.ts - b.ts || (a.kind === 'close' ? -1 : 1));

  const live = new Map<string, PaperTrade & { equityBase: number }>();
  const dayRisk = new Map<string, number>();
  curve.push({ ts: sorted[0]?.createdTs ?? now, equity });

  for (const ev of evs) {
    const r = ev.r;
    if (ev.kind === 'close') {
      const t = live.get(r.id);
      if (!t) continue;
      const rMult = (r.realizedPnlPct ?? 0) / Math.max(r.slPct, 1e-9);
      const pnl = (t.riskPct / 100) * t.equityBase * rMult;
      equity += pnl;
      t.rMultiple = Number(rMult.toFixed(3));
      t.pnl = Number(pnl.toFixed(2));
      t.equityAfter = Number(equity.toFixed(2));
      t.closeTs = ev.ts;
      live.delete(r.id);
      peak = Math.max(peak, equity);
      maxDd = Math.max(maxDd, ((peak - equity) / peak) * 100);
      curve.push({ ts: ev.ts, equity: Number(equity.toFixed(2)) });
      continue;
    }
    // apertura
    if (!passes(r.verdict, cfg.minVerdict)) {
      skipped.push({ id: r.id, asset: r.asset, ts: ev.ts, reason: 'veredicto' });
      continue;
    }
    if (halted || ((peak - equity) / peak) * 100 >= cfg.maxDrawdownStopPct) {
      halted = true;
      skipped.push({ id: r.id, asset: r.asset, ts: ev.ts, reason: 'parada_drawdown' });
      continue;
    }
    const liveList = Array.from(live.values());
    if (liveList.filter((t) => t.asset === r.asset).length >= cfg.maxPerAsset) {
      skipped.push({ id: r.id, asset: r.asset, ts: ev.ts, reason: 'activo_ocupado' });
      continue;
    }
    const dirRisk = liveList.filter((t) => t.dir === r.dir).reduce((s, t) => s + t.riskPct, 0);
    if (dirRisk + cfg.riskPct > cfg.maxDirRiskPct + 1e-9) {
      skipped.push({ id: r.id, asset: r.asset, ts: ev.ts, reason: 'riesgo_direccional' });
      continue;
    }
    const day = new Date(ev.ts).toISOString().slice(0, 10);
    const used = dayRisk.get(day) ?? 0;
    if (used + cfg.riskPct > cfg.maxDailyRiskPct + 1e-9) {
      skipped.push({ id: r.id, asset: r.asset, ts: ev.ts, reason: 'riesgo_diario' });
      continue;
    }
    dayRisk.set(day, used + cfg.riskPct);
    const t = {
      id: r.id, asset: r.asset, strategyKey: r.strategyKey, dir: r.dir, openTs: ev.ts, closeTs: null,
      riskPct: cfg.riskPct, rMultiple: null, pnl: null, equityAfter: null, status: r.status, equityBase: equity,
    };
    live.set(r.id, t);
    trades.push(t);
  }

  const done = trades.filter((t) => t.pnl !== null);
  const wins = done.filter((t) => (t.pnl ?? 0) > 0);
  const gp = wins.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const gl = done.filter((t) => (t.pnl ?? 0) < 0).reduce((s, t) => s - (t.pnl ?? 0), 0);
  const openRisk = Array.from(live.values()).reduce((s, t) => s + t.riskPct, 0);
  for (const t of trades) delete (t as { equityBase?: number }).equityBase;

  return {
    config: cfg,
    trades,
    skipped,
    equity: curve,
    stats: {
      n_closed: done.length,
      n_open: live.size,
      win_rate_pct: done.length ? Number(((wins.length / done.length) * 100).toFixed(1)) : null,
      total_return_pct: Number((((equity - cfg.startEquity) / cfg.startEquity) * 100).toFixed(2)),
      max_dd_pct: Number(maxDd.toFixed(2)),
      profit_factor: gl > 0 ? Number((gp / gl).toFixed(2)) : gp > 0 ? null : null,
      avg_r: done.length ? Number((done.reduce((s, t) => s + (t.rMultiple ?? 0), 0) / done.length).toFixed(3)) : null,
      open_risk_pct: Number(openRisk.toFixed(2)),
      halted,
    },
  };
}

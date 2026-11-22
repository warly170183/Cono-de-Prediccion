import React, { useMemo, useState } from 'react';
import { BookmarkPlus, Check, RefreshCw, Trash2, XCircle } from 'lucide-react';
import { OptionsEvaluationPanel } from './OptionsEvaluationPanel.tsx';
import type {
  AssetId,
  ProposalRegimeTag,
  RegisteredTradeOption,
  TradeOptionProposal,
  TradeOptionStatus,
  TradeOptionsResponse,
} from '../types.ts';

interface Props {
  asset: AssetId;
  data: TradeOptionsResponse | null;
  loading: boolean;
  registeringKey: string | null;
  onRefresh: () => void;
  onRegisterProposal: (proposal: TradeOptionProposal) => void;
  onCloseManual: (optionId: string) => void;
  onDeleteOption: (optionId: string) => void;
}

const VERDICT_UI: Record<string, { label: string; cls: string }> = {
  validada: { label: 'Ventaja validada', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' },
  prometedora: { label: 'Prometedora', cls: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300' },
  sin_datos: { label: 'Sin datos suficientes', cls: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  dudosa: { label: 'Dudosa', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
  descartada: { label: 'Sin ventaja: no operar', cls: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300' },
};

const STRATEGY_TITLES: Record<string, string> = {
  trend_pullback: 'Continuación de tendencia',
  mean_reversion: 'Reversión a la media',
  derivatives_squeeze: 'Squeeze de derivados',
  range_breakout: 'Ruptura de rango',
};

const fmtR = (v: number | null) => (v === null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)} R`);

const STATUS_LABELS: Record<TradeOptionStatus, string> = {
  open: 'Abierta',
  tp_hit: 'TP alcanzado',
  sl_hit: 'SL tocado',
  expired: 'Expirada',
  closed_manual: 'Cerrada manual',
};

function fmtPx(px: number | null | undefined, spot: number): string {
  if (px === null || px === undefined || !Number.isFinite(px)) return '—';
  const digits = spot >= 1000 ? 1 : spot >= 100 ? 2 : 3;
  return `$${px.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export const TradeOptionsView: React.FC<Props> = ({
  asset,
  data,
  loading,
  registeringKey,
  onRefresh,
  onRegisterProposal,
  onCloseManual,
  onDeleteOption,
}) => {
  const [filterMode, setFilterMode] = useState<'all' | 'asset' | 'open' | 'closed'>('all');
  const [proposalRegimeFilter, setProposalRegimeFilter] = useState<'all' | ProposalRegimeTag>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const mergedRegistered = useMemo(
    () => [...(data?.registered ?? [])].sort((a, b) => b.createdTs - a.createdTs),
    [data?.registered],
  );

  const stats = useMemo(() => {
    const closed = mergedRegistered.filter((r) => r.status !== 'open');
    const tpHit = mergedRegistered.filter((r) => r.status === 'tp_hit').length;
    const slHit = mergedRegistered.filter((r) => r.status === 'sl_hit').length;
    const expired = mergedRegistered.filter((r) => r.status === 'expired').length;
    const decided = tpHit + slHit;
    const pnls = closed
      .map((r) => r.realizedPnlPct)
      .filter((v): v is number => v !== null && Number.isFinite(v));
    return {
      total: mergedRegistered.length,
      open: mergedRegistered.filter((r) => r.status === 'open').length,
      tpHit,
      slHit,
      expired,
      winRatePct: decided > 0 ? (tpHit / decided) * 100 : null,
      avgPnlPct: pnls.length > 0 ? pnls.reduce((s, v) => s + v, 0) / pnls.length : null,
    };
  }, [mergedRegistered]);

  const filteredRegistered = useMemo(() => {
    return mergedRegistered.filter((r) => {
      if (filterMode === 'asset') return r.asset === asset;
      if (filterMode === 'open') return r.status === 'open';
      if (filterMode === 'closed') return r.status !== 'open';
      return true;
    });
  }, [mergedRegistered, filterMode, asset]);

  const registeredIds = useMemo(() => new Set(mergedRegistered.map((r) => r.id)), [mergedRegistered]);

  const filteredProposals = useMemo(() => {
    const list = data?.proposals ?? [];
    if (proposalRegimeFilter === 'all') return list;
    return list.filter((p) => p.regimeTags.includes(proposalRegimeFilter));
  }, [data?.proposals, proposalRegimeFilter]);

  const regimeCounts = useMemo(() => {
    const list = data?.proposals ?? [];
    return {
      all: list.length,
      gamma_flip: list.filter((p) => p.regimeTags.includes('gamma_flip')).length,
      trend: list.filter((p) => p.regimeTags.includes('trend')).length,
    };
  }, [data?.proposals]);

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 rounded-lg bg-slate-200/70 dark:bg-slate-800/50 animate-pulse" />
          ))}
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-64 rounded-lg bg-slate-200/70 dark:bg-slate-800/50 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-8 text-center space-y-3">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          No se pudieron cargar las opciones de trading para {asset.toUpperCase()}.
        </p>
        <button
          type="button"
          onClick={onRefresh}
          className="px-4 py-2 text-xs font-medium rounded-md bg-sky-600 text-white hover:bg-sky-500 transition-colors cursor-pointer"
        >
          Reintentar análisis
        </button>
      </div>
    );
  }

  const { technicals: t, marketSummary: m, marketBias: mb } = data;
  const posGexAbs = mb.positiveGexM !== null ? Math.max(0, mb.positiveGexM) : 0;
  const negGexAbs = mb.negativeGexM !== null ? Math.abs(mb.negativeGexM) : 0;
  const totalGexAbs = posGexAbs + negGexAbs;
  const posSharePct = totalGexAbs > 0 ? (posGexAbs / totalGexAbs) * 100 : 50;
  const negSharePct = totalGexAbs > 0 ? (negGexAbs / totalGexAbs) * 100 : 50;
  const activeRegimeLabel =
    mb.activeRegime === 'gamma_flip'
      ? 'Gamma Flip'
      : mb.activeRegime === 'trend'
        ? 'En Tendencia'
        : 'Equilibrado';

  return (
    <div className="space-y-6">
      {/* Header Control Bar */}
      <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1 max-w-3xl">
          <h2 className="text-base font-display font-semibold text-slate-900 dark:text-slate-50">
            Opciones de Trading Propuestas · {data.inst}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Síntesis de parámetros técnicos (EMA, RSI, MACD, ADX, ATR, Bollinger, VWAP, OBV, Pivotes) con simulaciones GJR-GARCH Student-t, derivados OKX y posicionamiento GEX Deribit. La mejor opción de cada ventana de 4 h se registra automáticamente para auditar su resultado real.
          </p>
        </div>

        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-md bg-sky-600 text-white hover:bg-sky-500 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>{loading ? 'Analizando…' : 'Recalcular análisis'}</span>
        </button>
      </div>

      {/* KPI Strip: Technical Bias & Market Probabilities */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Sesgo Técnico · ADX(14)</div>
          <div className="mt-1.5 text-lg font-display font-semibold capitalize text-slate-900 dark:text-slate-50">
            {t.trendBias}{' '}
            <span className="text-xs font-mono tabular-nums font-normal text-slate-500 dark:text-slate-400">
              · ADX {t.adx14.toFixed(1)}
            </span>
          </div>
          <div className="mt-1 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
            +DI {t.plusDi14.toFixed(1)} / -DI {t.minusDi14.toFixed(1)} · OBV {t.obvTrend}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Osciladores RSI(14) · Bollinger Z</div>
          <div className="mt-1.5 text-lg font-display font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-50">
            RSI {t.rsi14.toFixed(1)}{' '}
            <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
              · BB Z {t.bbZ >= 0 ? '+' : ''}{t.bbZ.toFixed(2)}
            </span>
          </div>
          <div className="mt-1 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
            Estocástico %K {t.stochK.toFixed(0)} / %D {t.stochD.toFixed(0)} · RVOL {t.rvol24h.toFixed(2)}x
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">ATR(14) Horario · VWAP 24h</div>
          <div className="mt-1.5 text-lg font-display font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-50">
            {fmtPx(t.atr14, data.spot)}{' '}
            <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
              ({t.atr14Pct.toFixed(2)} %)
            </span>
          </div>
          <div className="mt-1 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
            VWAP {fmtPx(t.vwap24h, data.spot)} ({t.vwapDistPct >= 0 ? '+' : ''}{t.vwapDistPct.toFixed(2)} %)
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Derivados · GARCH P(subida)</div>
          <div className="mt-1.5 text-lg font-display font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-50">
            {m.pUp24hPct.toFixed(1)} % (24h){' '}
            <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
              · {m.pUp72hPct.toFixed(1)} % (72h)
            </span>
          </div>
          <div className="mt-1 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
            Fund z {m.fund1dZ !== null ? m.fund1dZ.toFixed(2) : '—'} · OI 1d{' '}
            {m.oiChg1d !== null ? `${m.oiChg1d >= 0 ? '+' : ''}${m.oiChg1d.toFixed(1)}%` : '—'}
          </div>
        </div>
      </div>

      {/* Main Technical Parameters Matrix */}
      <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-50">
            Parámetros Técnicos y Niveles Estructurales ({asset.toUpperCase()})
          </h3>
          <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
            Régimen GMM: {data.regime.current} ({(data.regime.probs[data.regime.current] * 100).toFixed(0)} %)
            {m.netGexM !== null ? ` · Net GEX $${m.netGexM.toFixed(1)}M` : ''}
            {m.gammaFlip !== null ? ` · Flip ${fmtPx(m.gammaFlip, data.spot)}` : ''}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-2 text-xs font-mono tabular-nums">
          <div className="divide-y divide-slate-100 dark:divide-slate-800/70">
            <div className="py-1.5 flex justify-between">
              <span className="font-sans text-slate-500 dark:text-slate-400">EMA 20 / EMA 50 (1H)</span>
              <span className="text-slate-900 dark:text-slate-100">
                {fmtPx(t.ema20, data.spot)} / {fmtPx(t.ema50, data.spot)}
              </span>
            </div>
            <div className="py-1.5 flex justify-between">
              <span className="font-sans text-slate-500 dark:text-slate-400">EMA 200 (1H) / SMA 50 (1D)</span>
              <span className="text-slate-900 dark:text-slate-100">
                {fmtPx(t.ema200, data.spot)} / {fmtPx(t.sma50_1d, data.spot)}
              </span>
            </div>
            <div className="py-1.5 flex justify-between">
              <span className="font-sans text-slate-500 dark:text-slate-400">MACD (12,26,9) · Señal</span>
              <span className={t.macdHist >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                {t.macd} / {t.macdSignal} (Hist {t.macdHist >= 0 ? '+' : ''}{t.macdHist})
              </span>
            </div>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800/70">
            <div className="py-1.5 flex justify-between">
              <span className="font-sans text-slate-500 dark:text-slate-400">Bandas Bollinger (20, 2σ)</span>
              <span className="text-slate-900 dark:text-slate-100">
                {fmtPx(t.bbLower, data.spot)} – {fmtPx(t.bbUpper, data.spot)}
              </span>
            </div>
            <div className="py-1.5 flex justify-between">
              <span className="font-sans text-slate-500 dark:text-slate-400">VWAP 24h / 7d</span>
              <span className="text-slate-900 dark:text-slate-100">
                {fmtPx(t.vwap24h, data.spot)} / {fmtPx(t.vwap7d, data.spot)}
              </span>
            </div>
            <div className="py-1.5 flex justify-between">
              <span className="font-sans text-slate-500 dark:text-slate-400">Rango 24h (Mín – Máx)</span>
              <span className="text-slate-900 dark:text-slate-100">
                {fmtPx(t.low24h, data.spot)} – {fmtPx(t.high24h, data.spot)}
              </span>
            </div>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800/70">
            <div className="py-1.5 flex justify-between">
              <span className="font-sans text-slate-500 dark:text-slate-400">Pivotes Diarios (S1 / P / R1)</span>
              <span className="text-slate-900 dark:text-slate-100">
                {fmtPx(t.pivotS1, data.spot)} / {fmtPx(t.pivotP, data.spot)} / {fmtPx(t.pivotR1, data.spot)}
              </span>
            </div>
            <div className="py-1.5 flex justify-between">
              <span className="font-sans text-slate-500 dark:text-slate-400">Muros GEX (Put / Call Wall)</span>
              <span className="text-slate-900 dark:text-slate-100">
                {fmtPx(m.putWall, data.spot)} / {fmtPx(m.callWall, data.spot)}
              </span>
            </div>
            <div className="py-1.5 flex justify-between">
              <span className="font-sans text-slate-500 dark:text-slate-400">Modelo B P(subida 1d / 3d)</span>
              <span className="text-slate-900 dark:text-slate-100">
                {m.biasModelB1d !== null ? `${m.biasModelB1d.toFixed(1)}%` : '—'} /{' '}
                {m.biasModelB3d !== null ? `${m.biasModelB3d.toFixed(1)}%` : '—'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Sesgo del Mercado (GEX Positivo vs Negativo & Régimen) */}
      <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-50">
              Sesgo del Mercado · GEX Positivo vs Negativo y Régimen
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {mb.biasLabel} · Régimen detectado:{' '}
              <span
                className={`font-medium ${
                  mb.activeRegime === 'gamma_flip'
                    ? 'text-amber-600 dark:text-amber-400'
                    : mb.activeRegime === 'trend'
                      ? 'text-sky-600 dark:text-sky-400'
                      : 'text-slate-700 dark:text-slate-200'
                }`}
              >
                {activeRegimeLabel}
              </span>
            </p>
          </div>

          {mb.activeRegime !== 'balanced' && (
            <button
              type="button"
              onClick={() =>
                setProposalRegimeFilter((prev) =>
                  prev === mb.activeRegime ? 'all' : (mb.activeRegime as ProposalRegimeTag),
                )
              }
              className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                proposalRegimeFilter === mb.activeRegime
                  ? 'border-sky-500 bg-sky-500/10 text-sky-700 dark:text-sky-300'
                  : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {proposalRegimeFilter === mb.activeRegime
                ? `Mostrando régimen ${activeRegimeLabel}`
                : `Filtrar por régimen actual (${activeRegimeLabel})`}
            </button>
          )}
        </div>

        {mb.gexAvailable &&
        mb.positiveGexM !== null &&
        mb.negativeGexM !== null &&
        mb.netGexDiffM !== null ? (
          <div className="space-y-4">
            {/* GEX Difference KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-xs font-mono tabular-nums">
              <div className="p-3 rounded-md bg-slate-50 dark:bg-slate-950/50 border border-slate-200/80 dark:border-slate-800/80">
                <div className="font-sans text-slate-500 dark:text-slate-400">GEX Positivo (Calls)</div>
                <div className="mt-1 text-base font-semibold text-emerald-600 dark:text-emerald-400">
                  +${mb.positiveGexM.toFixed(2)}M
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  {posSharePct.toFixed(1)} % de gamma bruta
                </div>
              </div>

              <div className="p-3 rounded-md bg-slate-50 dark:bg-slate-950/50 border border-slate-200/80 dark:border-slate-800/80">
                <div className="font-sans text-slate-500 dark:text-slate-400">GEX Negativo (Puts)</div>
                <div className="mt-1 text-base font-semibold text-rose-600 dark:text-rose-400">
                  -${Math.abs(mb.negativeGexM).toFixed(2)}M
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  {negSharePct.toFixed(1)} % de gamma bruta
                </div>
              </div>

              <div className="p-3 rounded-md bg-slate-50 dark:bg-slate-950/50 border border-slate-200/80 dark:border-slate-800/80">
                <div className="font-sans text-slate-500 dark:text-slate-400">Diferencia Neta (Pos − Neg)</div>
                <div
                  className={`mt-1 text-base font-semibold ${
                    mb.netGexDiffM >= 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {mb.netGexDiffM >= 0 ? '+$' : '-$'}
                  {Math.abs(mb.netGexDiffM).toFixed(2)}M
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Desequilibrio {mb.imbalancePct !== null ? `${mb.imbalancePct >= 0 ? '+' : ''}${mb.imbalancePct.toFixed(1)} %` : '—'}
                </div>
              </div>

              <div className="p-3 rounded-md bg-slate-50 dark:bg-slate-950/50 border border-slate-200/80 dark:border-slate-800/80">
                <div className="font-sans text-slate-500 dark:text-slate-400">Nivel Gamma Flip</div>
                <div className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-100">
                  {fmtPx(mb.gammaFlip, data.spot)}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  {mb.flipDistancePct !== null
                    ? `Spot ${mb.flipDistancePct >= 0 ? '+' : ''}${mb.flipDistancePct.toFixed(2)} % vs Flip`
                    : 'Sin cruce de Flip'}
                </div>
              </div>
            </div>

            {/* Diverging GEX Balance Bar */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                <span className="text-emerald-600 dark:text-emerald-400">
                  Calls +${mb.positiveGexM.toFixed(1)}M ({posSharePct.toFixed(0)} %)
                </span>
                <span className="font-sans text-slate-600 dark:text-slate-300">
                  Balance neto {mb.netGexDiffM >= 0 ? '+$' : '-$'}{Math.abs(mb.netGexDiffM).toFixed(1)}M
                </span>
                <span className="text-rose-600 dark:text-rose-400">
                  Puts -${Math.abs(mb.negativeGexM).toFixed(1)}M ({negSharePct.toFixed(0)} %)
                </span>
              </div>
              <div className="h-3 w-full rounded bg-slate-100 dark:bg-slate-800 overflow-hidden flex relative">
                <div
                  className="h-full bg-emerald-500/85 dark:bg-emerald-500/80 transition-all"
                  style={{ width: `${posSharePct.toFixed(1)}%` }}
                />
                <div
                  className="h-full bg-rose-500/85 dark:bg-rose-500/80 transition-all"
                  style={{ width: `${negSharePct.toFixed(1)}%` }}
                />
                <div
                  className="absolute top-0 bottom-0 left-1/2 w-px bg-slate-900/40 dark:bg-white/50"
                  aria-hidden="true"
                />
              </div>
            </div>

            {/* Term Structure GEX Split */}
            {mb.termGex.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-slate-100 dark:border-slate-800/80 text-xs font-mono tabular-nums">
                {mb.termGex.map((tb) => (
                  <div
                    key={tb.bucket}
                    className="flex items-center justify-between py-1 px-2.5 rounded bg-slate-50/70 dark:bg-slate-950/30"
                  >
                    <span className="font-sans text-slate-600 dark:text-slate-300">{tb.bucket}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-emerald-600 dark:text-emerald-400">+{tb.positiveM.toFixed(1)}M</span>
                      <span className="text-slate-400">/</span>
                      <span className="text-rose-600 dark:text-rose-400">{tb.negativeM.toFixed(1)}M</span>
                      <span
                        className={`font-semibold ${
                          tb.netM >= 0
                            ? 'text-emerald-700 dark:text-emerald-300'
                            : 'text-rose-700 dark:text-rose-300'
                        }`}
                      >
                        ({tb.netM >= 0 ? '+' : ''}
                        {tb.netM.toFixed(1)}M)
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="p-3.5 rounded-md bg-slate-50 dark:bg-slate-950/50 border border-slate-200/80 dark:border-slate-800/80 text-xs text-slate-600 dark:text-slate-300 flex flex-wrap items-center justify-between gap-3">
            <span>
              Deribit no lista cadena de opciones para {asset.toUpperCase()}, por lo que el sesgo de mercado se evalúa exclusivamente con tendencia técnica ADX ({t.adx14.toFixed(1)}), +DI/-DI ({t.plusDi14.toFixed(1)} / {t.minusDi14.toFixed(1)}) y posición frente a EMA 20/50.
            </span>
            <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
              Sesgo: {mb.biasDirection.toUpperCase()} · {activeRegimeLabel}
            </span>
          </div>
        )}
      </div>

      {/* Proposed Trading Options Grid */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-50">
              Operaciones Propuestas por Probabilidad y Confluencia
            </h3>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Solo aparecen las estrategias cuyas condiciones se cumplen ahora. Ordenadas por calidad: setup + confluencia + historial medido de la estrategia.
            </span>
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-lg">
            {(
              [
                { id: 'all', label: `Todas (${regimeCounts.all})` },
                { id: 'gamma_flip', label: `Gamma Flip (${regimeCounts.gamma_flip})` },
                { id: 'trend', label: `En Tendencia (${regimeCounts.trend})` },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setProposalRegimeFilter(f.id)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  proposalRegimeFilter === f.id
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-50 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {data.proposals.length === 0 ? (
          <div className="bg-white dark:bg-slate-900/60 border border-dashed border-slate-300 dark:border-slate-700 rounded-lg p-6 space-y-2 text-xs text-slate-600 dark:text-slate-300">
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Sin operación recomendable ahora en {asset.toUpperCase()}
            </div>
            <div>Ninguna estrategia cumple sus condiciones. Esperar también es una decisión: forzar entradas sin señal solo añade costes.</div>
          </div>
        ) : filteredProposals.length === 0 ? (
          <div className="bg-white dark:bg-slate-900/60 border border-dashed border-slate-300 dark:border-slate-700 rounded-lg p-6 text-center space-y-2 text-xs text-slate-500 dark:text-slate-400">
            <div>No hay sugerencias etiquetadas para este filtro de régimen en {asset.toUpperCase()}.</div>
            <button
              type="button"
              onClick={() => setProposalRegimeFilter('all')}
              className="px-3 py-1.5 rounded-md bg-sky-600 text-white hover:bg-sky-500 font-medium cursor-pointer"
            >
              Ver todas las propuestas
            </button>
          </div>
        ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {filteredProposals.map((p, idx) => {
            const isLong = p.dir === 'long';
            const isAlreadyRegistered = registeredIds.has(p.id);
            const isRegistering = registeringKey === p.strategyKey;
            const isExpanded = expandedId === p.id;

            return (
              <div
                key={p.id}
                className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-5 flex flex-col justify-between gap-4"
              >
                <div className="space-y-4">
                  {/* Kicker & Title */}
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <span className="font-mono tabular-nums">0{idx + 1}.</span>
                        <span
                          className={`font-semibold ${
                            isLong ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {isLong ? 'Largo (Compra)' : 'Corto (Venta)'}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">Horizonte {p.horizonHours} h</span>
                        <span aria-hidden="true">·</span>
                        <span>Confianza {p.confidence}</span>
                        <span aria-hidden="true">·</span>
                        <span className="text-sky-600 dark:text-sky-400">
                          {p.regimeTags
                            .map((tag) => (tag === 'gamma_flip' ? 'Gamma Flip' : 'En Tendencia'))
                            .join(' / ')}
                        </span>
                      </div>
                      <h4 className="text-base font-display font-semibold text-slate-900 dark:text-slate-50">
                        {p.title}
                      </h4>
                    </div>

                    <div className="text-right font-mono tabular-nums shrink-0">
                      <div className="text-lg font-semibold text-sky-600 dark:text-sky-400">
                        Calidad {p.quality}/100
                      </div>
                      <span className={`inline-block mt-0.5 px-2 py-0.5 rounded text-[11px] font-sans font-medium ${VERDICT_UI[p.verdict]?.cls ?? ''}`}>
                        {p.recommended ? '★ ' : ''}{VERDICT_UI[p.verdict]?.label ?? p.verdict}
                      </span>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        Confluencia {p.confluenceScore}/100 · tendencia diaria {p.htfTrend}
                      </div>
                    </div>
                  </div>

                  {/* Operational Price Levels */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs font-mono tabular-nums">
                    <div>
                      <div className="font-sans text-slate-500 dark:text-slate-400">Zona Entrada</div>
                      <div className="mt-0.5 font-semibold text-slate-900 dark:text-slate-100">
                        {fmtPx(p.entryLow, data.spot)}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        a {fmtPx(p.entryHigh, data.spot)}
                      </div>
                    </div>

                    <div>
                      <div className="font-sans text-slate-500 dark:text-slate-400">Stop-Loss (-{p.slPct}%)</div>
                      <div className="mt-0.5 font-semibold text-rose-600 dark:text-rose-400">
                        {fmtPx(p.stopLoss, data.spot)}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        P(SL) {p.probSlPct.toFixed(1)} %
                      </div>
                    </div>

                    <div>
                      <div className="font-sans text-slate-500 dark:text-slate-400">Take-Profit 1 / 2</div>
                      <div className="mt-0.5 font-semibold text-emerald-600 dark:text-emerald-400">
                        {fmtPx(p.takeProfit1, data.spot)} (+{p.tp1Pct}%)
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        TP2 {fmtPx(p.takeProfit2, data.spot)} (+{p.tp2Pct}%)
                      </div>
                    </div>

                    <div>
                      <div className="font-sans text-slate-500 dark:text-slate-400">R:R · EV neutral · Riesgo</div>
                      <div className="mt-0.5 font-semibold text-slate-900 dark:text-slate-100">
                        {p.rr.toFixed(2)} R · {p.evPct >= 0 ? '+' : ''}{p.evPct.toFixed(2)} %
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {p.kellyPct > 0 ? `¼ Kelly ${p.kellyPct.toFixed(1)} %` : 'Sin ventaja medida: riesgo mínimo'} · P(TP) sim. {p.probTpPct.toFixed(0)} %
                      </div>
                    </div>
                  </div>

                  {/* Rationale */}
                  <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
                    {p.rationale.map((line, rIdx) => (
                      <div key={rIdx}>• {line}</div>
                    ))}
                    {p.track && (
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 pt-1 font-mono tabular-nums">
                        Historial {p.asset.toUpperCase()}: backtest {p.track.btN} ops
                        {p.track.btWinPct !== null ? ` · TP1 ${p.track.btWinPct.toFixed(0)} %` : ''} · {fmtR(p.track.btExpR)}
                        {' · '}reales {p.track.fwN} ops{p.track.fwN ? ` · ${fmtR(p.track.fwExpR)}` : ''}
                      </div>
                    )}
                    <div className="text-[11px] text-amber-700 dark:text-amber-400 pt-1">
                      Invalidación: {p.invalidation}
                    </div>
                  </div>

                  {/* Expandable Factor Breakdown */}
                  {isExpanded && (
                    <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
                      <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-2">
                        Desglose de Factores Evaluados
                      </div>
                      <div className="divide-y divide-slate-100 dark:divide-slate-800/60 text-xs">
                        {p.factors.map((f, fIdx) => (
                          <div key={fIdx} className="py-1.5 flex items-center justify-between gap-3">
                            <div>
                              <span className="font-medium text-slate-800 dark:text-slate-200">{f.name}</span>
                              <span className="ml-2 text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                                {f.reading}
                              </span>
                            </div>
                            <span
                              className={`text-[11px] font-mono shrink-0 ${
                                f.signal === p.dir
                                  ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                                  : f.signal === 'neutral'
                                    ? 'text-slate-400'
                                    : 'text-rose-600 dark:text-rose-400'
                              }`}
                            >
                              {f.signal === p.dir
                                ? 'A favor'
                                : f.signal === 'neutral'
                                  ? 'Neutral'
                                  : 'En contra'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Card Footer Actions */}
                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : p.id)}
                    className="text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 transition-colors cursor-pointer"
                  >
                    {isExpanded ? 'Ocultar factores' : `Ver desglose de factores (${p.factors.length})`}
                  </button>

                  <div className="flex items-center gap-2">
                    {isAlreadyRegistered && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                        <Check className="w-3.5 h-3.5" />
                        Registrada
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => onRegisterProposal(p)}
                      disabled={isRegistering}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <BookmarkPlus className="w-3.5 h-3.5" />
                      <span>{isRegistering ? 'Registrando…' : 'Registrar operación'}</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        )}
      </div>

      {data && (data.skipped.length > 0 || data.strategyTracks.length > 0) && (
        <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4">
          <div>
            <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-50">
              Estrategias: historial medido y motivos de «no operar»
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Backtest = las mismas reglas repetidas sobre el histórico de {data.strategyTracks[0]?.btDays ?? 0} días (reglas no ajustadas con esos datos).
              Reales = operaciones que la app ha registrado y ya cerradas. La esperanza se mide en R (resultado por unidad de riesgo, neto de costes).
            </p>
          </div>
          {data.strategyTracks.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                    <th className="py-2 text-left font-medium">Estrategia</th>
                    <th className="py-2 text-right font-medium">Backtest (n · TP1 · R)</th>
                    <th className="py-2 text-right font-medium">Reales (n · R)</th>
                    <th className="py-2 text-right font-medium">Combinado (n · R)</th>
                    <th className="py-2 text-left font-medium pl-3">Veredicto</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 font-mono tabular-nums">
                  {data.strategyTracks.map((t) => (
                    <tr key={t.strategyKey}>
                      <td className="py-2 font-sans text-slate-800 dark:text-slate-200">
                        {STRATEGY_TITLES[t.strategyKey] ?? t.strategyKey}
                      </td>
                      <td className="py-2 text-right">
                        {t.strategyKey === 'derivatives_squeeze'
                          ? 'no reproducible'
                          : `${t.btN} · ${t.btWinPct !== null ? t.btWinPct.toFixed(0) + ' %' : '—'} · ${fmtR(t.btExpR)}`}
                      </td>
                      <td className="py-2 text-right">{t.fwN} · {fmtR(t.fwExpR)}</td>
                      <td className="py-2 text-right">{t.n} · {fmtR(t.expR)}</td>
                      <td className="py-2 pl-3">
                        <span className={`px-2 py-0.5 rounded text-[11px] font-sans font-medium ${VERDICT_UI[t.verdict]?.cls ?? ''}`}>
                          {VERDICT_UI[t.verdict]?.label ?? t.verdict}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.skipped.length > 0 && (
            <div className="space-y-1 text-xs text-slate-600 dark:text-slate-300">
              <div className="font-medium text-slate-700 dark:text-slate-200">Hoy sin señal en {asset.toUpperCase()}:</div>
              {data.skipped.map((k) => (
                <div key={k.strategyKey}>
                  • <span className="font-medium">{k.label}</span>: {k.reason}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <OptionsEvaluationPanel evaluation={data?.stats.evaluation} />

      {/* Registered Trade Options Audit Log */}
      <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-50">
              Registro de Operaciones Propuestas y Seguimiento
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono tabular-nums">
              Total: {stats.total} · Abiertas: {stats.open} · TP: {stats.tpHit} · SL: {stats.slHit} · Expiradas: {stats.expired}
              {stats.winRatePct !== null ? ` · Acierto: ${stats.winRatePct.toFixed(1)} %` : ''}
              {stats.avgPnlPct !== null ? ` · PnL medio: ${stats.avgPnlPct >= 0 ? '+' : ''}${stats.avgPnlPct.toFixed(2)} %` : ''}
            </p>
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-lg">
            {(
              [
                { id: 'all', label: 'Todas' },
                { id: 'asset', label: `Solo ${asset.toUpperCase()}` },
                { id: 'open', label: 'Abiertas' },
                { id: 'closed', label: 'Resueltas' },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilterMode(f.id)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  filterMode === f.id
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-50 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {filteredRegistered.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-md space-y-2">
            <div>No hay operaciones registradas para este filtro todavía.</div>
            {data.proposals[0] && (
              <button
                type="button"
                onClick={() => onRegisterProposal(data.proposals[0])}
                className="px-3.5 py-1.5 text-xs font-medium rounded-md bg-sky-600 text-white hover:bg-sky-500 transition-colors cursor-pointer"
              >
                Registrar opción principal ahora
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                  <th className="py-2 text-left font-medium">Fecha</th>
                  <th className="py-2 text-left font-medium">Activo / Estrategia</th>
                  <th className="py-2 text-left font-medium">Lado</th>
                  <th className="py-2 text-right font-medium">Entrada</th>
                  <th className="py-2 text-right font-medium">SL / TP1</th>
                  <th className="py-2 text-right font-medium">P(TP) / Confl.</th>
                  <th className="py-2 text-left font-medium pl-3">Origen</th>
                  <th className="py-2 text-left font-medium">Estado</th>
                  <th className="py-2 text-right font-medium">PnL neto</th>
                  <th className="py-2 text-right font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 font-mono tabular-nums">
                {filteredRegistered.map((row) => {
                  const isLong = row.dir === 'long';
                  return (
                    <tr key={row.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                      <td className="py-2 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {new Date(row.createdTs).toLocaleString('es-ES', {
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="py-2 font-sans">
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          {row.asset.toUpperCase()}
                        </span>
                        <span className="text-slate-500 dark:text-slate-400"> · {row.title}</span>
                      </td>
                      <td
                        className={`py-2 font-sans font-medium ${
                          isLong ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {isLong ? 'Largo' : 'Corto'} ({row.horizonHours}h)
                      </td>
                      <td className="py-2 text-right">{fmtPx(row.entryPrice, row.entryPrice)}</td>
                      <td className="py-2 text-right">
                        <span className="text-rose-600 dark:text-rose-400">-{row.slPct.toFixed(1)}%</span>
                        {' / '}
                        <span className="text-emerald-600 dark:text-emerald-400">+{row.tp1Pct.toFixed(1)}%</span>
                      </td>
                      <td className="py-2 text-right">
                        {row.probTpPct.toFixed(1)}% · {row.confluenceScore}
                      </td>
                      <td className="py-2 font-sans pl-3 text-slate-500 dark:text-slate-400">
                        {row.source === 'auto' ? 'Auto' : 'Manual'}
                      </td>
                      <td
                        className={`py-2 font-sans font-medium ${
                          row.status === 'tp_hit'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : row.status === 'sl_hit'
                              ? 'text-rose-600 dark:text-rose-400'
                              : row.status === 'open'
                                ? 'text-sky-600 dark:text-sky-400'
                                : 'text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {STATUS_LABELS[row.status]}
                      </td>
                      <td
                        className={`py-2 text-right font-medium ${
                          row.realizedPnlPct === null
                            ? 'text-slate-400'
                            : row.realizedPnlPct >= 0
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {row.realizedPnlPct !== null
                          ? `${row.realizedPnlPct >= 0 ? '+' : ''}${row.realizedPnlPct.toFixed(2)} %`
                          : 'En curso'}
                      </td>
                      <td className="py-2 text-right whitespace-nowrap">
                        {row.status === 'open' && (
                          <button
                            type="button"
                            onClick={() => onCloseManual(row.id)}
                            title="Cerrar operación al precio actual"
                            className="text-slate-500 hover:text-amber-600 dark:hover:text-amber-400 p-1 cursor-pointer"
                          >
                            <XCircle className="w-3.5 h-3.5 inline" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onDeleteOption(row.id)}
                          title="Eliminar registro"
                          className="text-slate-400 hover:text-rose-500 p-1 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5 inline" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

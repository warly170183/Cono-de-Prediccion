import React, { useMemo, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import type { RotationResponse } from '../types.ts';

interface Props {
  data: RotationResponse | null;
  loading: boolean;
  onRefresh: () => void;
}

function fmtPrice(v: number): string {
  if (v >= 1000) return `$${v.toLocaleString('en-US', { maximumFractionDigits: 1 })}`;
  if (v >= 1) return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}`;
  return `$${v.toPrecision(4)}`;
}

export const RotationView: React.FC<Props> = ({ data, loading, onRefresh }) => {
  const [showAllCoins, setShowAllCoins] = useState(false);
  const [sortBy, setSortBy] = useState<'sharpe_ann' | 'nw_t' | 'mean_bps_day'>('sharpe_ann');

  const sortedVariants = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.variants)
      .map(([key, stats]) => ({ key, ...stats }))
      .sort((a, b) => b[sortBy] - a[sortBy]);
  }, [data, sortBy]);

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="h-20 rounded-lg bg-slate-200/70 dark:bg-slate-800/50 animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 rounded-lg bg-slate-200/70 dark:bg-slate-800/50 animate-pulse" />
          ))}
        </div>
        <div className="h-96 rounded-lg bg-slate-200/70 dark:bg-slate-800/50 animate-pulse" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-6 text-center space-y-3">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          No se pudieron cargar los datos de rotación transversal de 40 perpetuos OKX.
        </p>
        <button
          type="button"
          onClick={onRefresh}
          className="px-4 py-1.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
        >
          Reintentar carga
        </button>
      </div>
    );
  }

  const prim = data.primary_result;
  const ci = prim.mean_ci95_bps_day;
  const visibleCoins = showAllCoins ? data.current_ranking : data.current_ranking.slice(0, 15);
  const dsrPass = (prim.dsr ?? 0) > 0.95 && prim.nw_t > 3;

  return (
    <div className="space-y-6">
      {/* Protocol & Survivorship Bias Banner */}
      <div className="bg-amber-500/8 border border-amber-500/30 rounded-lg p-4 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3 max-w-4xl">
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
          <div className="space-y-1 text-xs">
            <div className="font-display font-semibold text-slate-900 dark:text-slate-100">
              Rotación Transversal 40 Monedas ({data.n_assets} swaps OKX · {data.from} → {data.to})
            </div>
            <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
              Protocolo preregistrado: momentum 30 d saltando el último día (<span className="font-mono">ln P[t-1]/P[t-31]</span>), Top 5 pesos iguales, rebalanceo semanal, exceso sobre cartera equiponderada (EW), coste 0.10 % ida y vuelta.{' '}
              <span className="font-medium text-amber-700 dark:text-amber-300">
                Sesgo de supervivencia:
              </span>{' '}
              el universo toma los 40 contratos con más volumen hoy; es una cota optimista y no valida ventaja sin histórico de monedas deslistadas.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors cursor-pointer shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>{loading ? 'Recalculando…' : 'Recalcular 40 swaps'}</span>
        </button>
      </div>

      {/* 4-Column KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Primaria {data.primary} (Exceso vs EW)
          </div>
          <div className="mt-1.5 text-2xl font-display font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-50">
            SR {prim.sharpe_ann.toFixed(2)}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            {prim.mean_bps_day >= 0 ? '+' : ''}
            {prim.mean_bps_day.toFixed(1)} pb/d · IC95 [{ci?.[0].toFixed(1)}; {ci?.[1].toFixed(1)}]
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Newey-West t &amp; Sharpe Deflactado ({data.n_trials} ensayos)
          </div>
          <div
            className={`mt-1.5 text-2xl font-display font-semibold font-mono tabular-nums ${
              dsrPass ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
            }`}
          >
            DSR {(prim.dsr ?? 0).toFixed(2)} <span className="text-sm font-normal text-slate-500">· t={prim.nw_t.toFixed(2)}</span>
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            PSR {(prim.psr0 ?? 0).toFixed(2)} · Criterio: DSR &gt; 0.95 y t &gt; 3
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Mitades y Retorno Absoluto Neto</div>
          <div className="mt-1.5 text-2xl font-display font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-50">
            {prim.sharpe_h1.toFixed(2)} / {prim.sharpe_h2.toFixed(2)}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            Abs Neto SR {data.primary_abs_net.sharpe_ann.toFixed(2)} vs EW {data.benchmark_ew.sharpe_ann.toFixed(2)}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Mejor Variante Ex-Post</div>
          <div className="mt-1.5 text-2xl font-display font-semibold font-mono tabular-nums text-sky-600 dark:text-sky-400">
            {data.best_variant_result.sharpe_ann.toFixed(2)} <span className="text-sm font-normal text-slate-500">({data.best_variant})</span>
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            DSR {data.best_dsr.toFixed(2)} · {(data.share_variants_sharpe_pos * 100).toFixed(0)} % variantes SR &gt; 0
          </div>
        </div>
      </div>

      {/* Live Ranking & 45-Variant Audit */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Live Ranking Top-5 + Universe */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-50">
                Ranking Actual (Momentum 30 d, t−1)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Los 5 primeros forman la cesta equiponderada actual del protocolo {data.primary}.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAllCoins((s) => !s)}
              className="text-xs text-sky-600 dark:text-sky-400 hover:underline cursor-pointer shrink-0"
            >
              {showAllCoins ? 'Ver Top 15' : `Ver todos (${data.current_ranking.length})`}
            </button>
          </div>

          <div className="overflow-x-auto max-h-[460px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white dark:bg-slate-900">
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                  <th className="py-2 text-left font-medium">#</th>
                  <th className="py-2 text-left font-medium">Activo</th>
                  <th className="py-2 text-right font-medium">Cierre</th>
                  <th className="py-2 text-right font-medium">Mom. 30 d</th>
                  <th className="py-2 text-right font-medium">Mom. 7 d</th>
                  <th className="py-2 text-right font-medium">Cesta</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 font-mono tabular-nums">
                {visibleCoins.map((row, idx) => (
                  <tr
                    key={row.symbol}
                    className={
                      row.in_top5
                        ? 'bg-emerald-500/6 hover:bg-emerald-500/10'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/30'
                    }
                  >
                    <td className="py-2 text-slate-400">{idx + 1}</td>
                    <td className="py-2 font-sans font-semibold text-slate-900 dark:text-slate-100">
                      {row.symbol}
                    </td>
                    <td className="py-2 text-right text-slate-700 dark:text-slate-300">
                      {fmtPrice(row.last_close)}
                    </td>
                    <td
                      className={`py-2 text-right font-medium ${
                        row.mom_30d_pct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {row.mom_30d_pct >= 0 ? '+' : ''}
                      {row.mom_30d_pct.toFixed(1)} %
                    </td>
                    <td
                      className={`py-2 text-right ${
                        row.mom_7d_pct >= 0 ? 'text-emerald-600/80 dark:text-emerald-400/80' : 'text-rose-600/80 dark:text-rose-400/80'
                      }`}
                    >
                      {row.mom_7d_pct >= 0 ? '+' : ''}
                      {row.mom_7d_pct.toFixed(1)} %
                    </td>
                    <td className="py-2 text-right font-sans">
                      {row.in_top5 ? (
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">Top 5 (20 %)</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* All 45 Variants Table */}
        <div className="lg:col-span-7 bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-50">
                Auditoría de las {data.n_trials} Variantes (Ensayos para DSR)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Rejilla lookback &#123;7, 14, 30, 60, 90&#125; × top-k &#123;3, 5, 8&#125; × rebalanceo &#123;3, 7, 14&#125; d.
              </p>
            </div>
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-lg text-xs">
              {(
                [
                  ['sharpe_ann', 'Sharpe'],
                  ['nw_t', 't (NW)'],
                  ['mean_bps_day', 'pb/día'],
                ] as const
              ).map(([k, lbl]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setSortBy(k)}
                  className={`px-2.5 py-1 rounded-md cursor-pointer transition-colors ${
                    sortBy === k
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-50 font-medium shadow-sm'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto max-h-[460px] overflow-y-auto">
            <table className="w-full text-xs font-mono tabular-nums">
              <thead className="sticky top-0 bg-white dark:bg-slate-900">
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                  <th className="py-2 text-left font-medium">Variante</th>
                  <th className="py-2 text-right font-medium">Días</th>
                  <th className="py-2 text-right font-medium">Sharpe An.</th>
                  <th className="py-2 text-right font-medium">Media (pb/d)</th>
                  <th className="py-2 text-right font-medium">t (NW)</th>
                  <th className="py-2 text-right font-medium">Mitad 1</th>
                  <th className="py-2 text-right font-medium">Mitad 2</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {sortedVariants.map((v) => {
                  const isPrimary = v.key === data.primary;
                  const isBest = v.key === data.best_variant;
                  return (
                    <tr
                      key={v.key}
                      className={
                        isPrimary
                          ? 'bg-sky-500/8 hover:bg-sky-500/12'
                          : isBest
                            ? 'bg-amber-500/6 hover:bg-amber-500/10'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/30'
                      }
                    >
                      <td className="py-2 font-medium text-slate-900 dark:text-slate-100">
                        {v.key}
                        {isPrimary && (
                          <span className="ml-2 font-sans text-[11px] font-semibold text-sky-600 dark:text-sky-400">
                            Primaria
                          </span>
                        )}
                        {!isPrimary && isBest && (
                          <span className="ml-2 font-sans text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                            Máx.
                          </span>
                        )}
                      </td>
                      <td className="py-2 text-right text-slate-500 dark:text-slate-400">{v.n_days}</td>
                      <td
                        className={`py-2 text-right font-semibold ${
                          v.sharpe_ann > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {v.sharpe_ann.toFixed(2)}
                      </td>
                      <td className="py-2 text-right">
                        {v.mean_bps_day >= 0 ? '+' : ''}
                        {v.mean_bps_day.toFixed(1)}
                      </td>
                      <td className="py-2 text-right">{v.nw_t.toFixed(2)}</td>
                      <td className="py-2 text-right text-slate-600 dark:text-slate-300">{v.sharpe_h1.toFixed(2)}</td>
                      <td className="py-2 text-right text-slate-600 dark:text-slate-300">{v.sharpe_h2.toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

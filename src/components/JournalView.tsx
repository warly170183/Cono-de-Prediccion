import React from 'react';
import { Download } from 'lucide-react';
import type { AutoJournalStatus, JournalAssetData, ResultsResponse } from '../types.ts';

interface Props {
  journalAssets: JournalAssetData[];
  results: ResultsResponse | null;
  runningSnapshot: boolean;
  autoStatus: AutoJournalStatus | null;
  onToggleAuto: (enabled: boolean) => void;
  onRunAll: () => void;
}

export const JournalView: React.FC<Props> = ({
  journalAssets,
  results,
  runningSnapshot,
  autoStatus,
  onToggleAuto,
  onRunAll,
}) => {
  const autoEnabled = autoStatus?.enabled ?? true;
  return (
    <div className="space-y-6">
      {/* Header Summary */}
      <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-base font-display font-semibold text-slate-900 dark:text-slate-50">
            Diario de Predicciones y Validación Hacia Adelante
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Sesgo aplicado al cono: 0.0 %. Las lecturas diarias de BTC, ETH y SOL se capturan automáticamente tras el cierre UTC y se sincronizan con tu cuenta si estás conectado.
          </p>
          {autoStatus && (
            <p className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
              {autoStatus.lastCheckTs
                ? `Última comprobación ${new Date(autoStatus.lastCheckTs).toLocaleTimeString('es-ES')}`
                : 'Comprobación inicial en curso'}
              {' · '}
              BTC {autoStatus.savedDates.btc ?? '—'} · ETH {autoStatus.savedDates.eth ?? '—'} · SOL {autoStatus.savedDates.sol ?? '—'}
              {autoStatus.lastError ? ` · Aviso: ${autoStatus.lastError}` : ''}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => onToggleAuto(!autoEnabled)}
            className={`px-3 py-2 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              autoEnabled
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/15'
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            {autoEnabled ? 'Registro automático: Activado' : 'Registro automático: Pausado'}
          </button>

          <button
            type="button"
            onClick={onRunAll}
            disabled={runningSnapshot}
            className="px-4 py-2 text-xs font-medium rounded-md bg-sky-600 text-white hover:bg-sky-500 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {runningSnapshot ? 'Capturando BTC, ETH, SOL…' : 'Capturar ahora (BTC, ETH, SOL)'}
          </button>
        </div>
      </div>

      {/* Per-Asset Journal Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {journalAssets.map((item) => {
          const latest = item.predictions[item.predictions.length - 1];
          return (
            <div
              key={item.asset}
              className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4"
            >
              <div className="flex items-baseline justify-between">
                <h3 className="text-base font-display font-semibold text-slate-900 dark:text-slate-50">
                  {item.asset.toUpperCase()}-USDT-SWAP
                </h3>
                <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  {item.predictions.length} guardadas · {item.scored.length} puntuadas
                </span>
              </div>

              {latest ? (
                <div className="text-xs space-y-1.5 border-t border-slate-100 dark:border-slate-800 pt-3 font-mono tabular-nums">
                  <div className="flex justify-between">
                    <span className="font-sans text-slate-500 dark:text-slate-400">Última fecha</span>
                    <span className="text-slate-900 dark:text-slate-100">{latest.id}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-sans text-slate-500 dark:text-slate-400">Spot / Volatilidad</span>
                    <span className="text-slate-900 dark:text-slate-100">
                      ${latest.spot.toLocaleString('en-US')} · {latest.vol_ann_pct.toFixed(1)} % (P{latest.vol_pctile.toFixed(0)})
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-sans text-slate-500 dark:text-slate-400">Banda 90 % (24 h)</span>
                    <span className="text-slate-700 dark:text-slate-300">
                      ${latest.cone['24']?.['5']?.toLocaleString('en-US')} – ${latest.cone['24']?.['95']?.toLocaleString('en-US')}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-sans text-slate-500 dark:text-slate-400">Ensamble 90 % (72 h)</span>
                    <span className="text-amber-600 dark:text-amber-400">
                      ${latest.cone_ens?.['72']?.['5']?.toLocaleString('en-US') ?? '—'} – $
                      {latest.cone_ens?.['72']?.['95']?.toLocaleString('en-US') ?? '—'}
                    </span>
                  </div>
                  {latest.cone_opt && (
                    <div className="flex justify-between">
                      <span className="font-sans text-slate-500 dark:text-slate-400">Opciones SVI 90 % (24 h)</span>
                      <span className="text-violet-600 dark:text-violet-400">
                        ${latest.cone_opt?.['24']?.['5']?.toLocaleString('en-US') ?? '—'} – $
                        {latest.cone_opt?.['24']?.['95']?.toLocaleString('en-US') ?? '—'}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="font-sans text-slate-500 dark:text-slate-400">Banderas</span>
                    <span>
                      Fund: {latest.flags.fund} · OI flush: {latest.flags.oi_flush ? 'sí' : 'no'}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-slate-500 dark:text-slate-400">Sin predicciones registradas.</div>
              )}

              {/* Coverage Table */}
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Cobertura nominal (50 % / 90 %)
                </div>
                <table className="w-full text-xs font-mono tabular-nums">
                  <thead>
                    <tr className="text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                      <th className="py-1 text-left font-medium">Horiz.</th>
                      <th className="py-1 text-right font-medium">n</th>
                      <th className="py-1 text-right font-medium">50 %</th>
                      <th className="py-1 text-right font-medium">90 %</th>
                      <th className="py-1 text-right font-medium">90 % Ens.</th>
                      <th className="py-1 text-right font-medium">90 % Opt.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                    {item.coverage.map((c) => (
                      <tr key={c.horizon}>
                        <td className="py-1.5">{c.horizon} h</td>
                        <td className="py-1.5 text-right">{c.n}</td>
                        <td className="py-1.5 text-right">{c.c50 !== null ? `${c.c50.toFixed(0)} %` : '—'}</td>
                        <td className="py-1.5 text-right">{c.c90 !== null ? `${c.c90.toFixed(0)} %` : '—'}</td>
                        <td className="py-1.5 text-right">{c.c90_ens !== null ? `${c.c90_ens.toFixed(0)} %` : '—'}</td>
                        <td className="py-1.5 text-right">{c.c90_opt !== null ? `${c.c90_opt.toFixed(0)} %` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Calibración estadística */}
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Calibración estadística (muestra independiente)
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-2">
                  Kupiec: ¿la cobertura del 90 % es compatible con 90 %? PIT/KS: ¿los resultados caen uniformes dentro del cono? Pinball: error del cono (menor = mejor; compara modelos). Brier: acierto probabilístico de P(sube) frente a 0,25 de una moneda al aire. Con menos de 20 muestras independientes no se emite veredicto.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[40rem] text-xs font-mono tabular-nums">
                    <thead>
                      <tr className="text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                        <th className="py-1 px-2 text-left font-medium whitespace-nowrap">Horiz.</th>
                        <th className="py-1 px-2 text-right font-medium whitespace-nowrap">n ind.</th>
                        <th className="py-1 px-2 text-right font-medium whitespace-nowrap">p Kupiec</th>
                        <th className="py-1 px-2 text-right font-medium whitespace-nowrap">PIT μ</th>
                        <th className="py-1 px-2 text-right font-medium whitespace-nowrap">KS/crít.</th>
                        <th className="py-1 px-2 text-right font-medium whitespace-nowrap">Pin. base</th>
                        <th className="py-1 px-2 text-right font-medium whitespace-nowrap">Ens.</th>
                        <th className="py-1 px-2 text-right font-medium whitespace-nowrap">Opt.</th>
                        <th className="py-1 px-2 text-right font-medium whitespace-nowrap">Brier</th>
                        <th className="py-1 px-2 text-right font-medium whitespace-nowrap">Veredicto</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                      {item.coverage.map((c) => (
                        <tr key={c.horizon}>
                          <td className="py-1.5 px-2 whitespace-nowrap">{c.horizon} h</td>
                          <td className="py-1.5 px-2 text-right whitespace-nowrap">{c.n_indep}</td>
                          <td className="py-1.5 px-2 text-right whitespace-nowrap">{c.kupiec_p !== null ? c.kupiec_p.toFixed(3) : '—'}</td>
                          <td className="py-1.5 px-2 text-right whitespace-nowrap">{c.pit_mean !== null ? c.pit_mean.toFixed(2) : '—'}</td>
                          <td className="py-1.5 px-2 text-right whitespace-nowrap">
                            {c.pit_ks !== null && c.pit_ks_crit !== null ? `${c.pit_ks.toFixed(2)}/${c.pit_ks_crit.toFixed(2)}` : '—'}
                          </td>
                          <td className="py-1.5 px-2 text-right whitespace-nowrap">{c.pin !== null ? c.pin.toFixed(3) : '—'}</td>
                          <td className="py-1.5 px-2 text-right whitespace-nowrap">{c.pin_ens !== null ? c.pin_ens.toFixed(3) : '—'}</td>
                          <td className="py-1.5 px-2 text-right whitespace-nowrap">{c.pin_opt !== null ? c.pin_opt.toFixed(3) : '—'}</td>
                          <td className="py-1.5 px-2 text-right whitespace-nowrap">{c.brier !== null ? c.brier.toFixed(3) : '—'}</td>
                          <td
                            className={`py-1.5 px-2 whitespace-nowrap text-right font-sans font-medium ${
                              c.verdict === 'calibrado'
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : c.verdict === 'sesgado'
                                  ? 'text-rose-600 dark:text-rose-400'
                                  : 'text-slate-500 dark:text-slate-400'
                            }`}
                          >
                            {c.verdict === 'calibrado' ? 'Calibrado' : c.verdict === 'sesgado' ? 'Sesgado' : 'Pocos datos'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 1-Click Exports */}
              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-2">
                <a
                  href={`/api/journal/export?asset=${item.asset}&type=scores`}
                  download
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-mono rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <Download className="w-3 h-3" />
                  scores.csv
                </a>
                <a
                  href={`/api/journal/export?asset=${item.asset}&type=predictions`}
                  download
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-mono rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <Download className="w-3 h-3" />
                  predictions.jsonl
                </a>
                <a
                  href={`/api/journal/export?asset=${item.asset}&type=report`}
                  download
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-mono rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <Download className="w-3 h-3" />
                  REPORT.md
                </a>
              </div>
            </div>
          );
        })}
      </div>

      {/* Scored Predictions Detail Table */}
      <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-5">
        <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-50 mb-1">
          Predicciones Puntuadas (Vencidas)
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
          PIT (Probability Integral Transform) cercano a 0.50 indica centro calibrado; valores &lt; 0.05 o &gt; 0.95 quedan fuera de la banda del 90 %.
        </p>

        {journalAssets.every((a) => a.scored.length === 0) ? (
          <div className="py-6 text-center text-xs text-slate-500 dark:text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-md">
            Todavía no hay predicciones vencidas en el diario (las primeras lecturas de 2026-11-21 vencen tras 24 h y 72 h).
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                  <th className="py-2 text-left font-medium">Activo</th>
                  <th className="py-2 text-left font-medium">Fecha</th>
                  <th className="py-2 text-right font-medium">Horiz.</th>
                  <th className="py-2 text-right font-medium">Spot</th>
                  <th className="py-2 text-right font-medium">Cierre</th>
                  <th className="py-2 text-right font-medium">Retorno %</th>
                  <th className="py-2 text-right font-medium">PIT</th>
                  <th className="py-2 text-right font-medium">Dentro 50%</th>
                  <th className="py-2 text-right font-medium">Dentro 90%</th>
                  <th className="py-2 text-right font-medium">90% Opt.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 font-mono tabular-nums">
                {journalAssets
                  .flatMap((a) => a.scored)
                  .map((s) => (
                    <tr key={`${s.asset}-${s.id}-${s.h}`}>
                      <td className="py-2 font-sans font-medium">{s.asset.toUpperCase()}</td>
                      <td className="py-2">{s.id}</td>
                      <td className="py-2 text-right">{s.h} h</td>
                      <td className="py-2 text-right">${s.spot.toLocaleString('en-US')}</td>
                      <td className="py-2 text-right">${s.close.toLocaleString('en-US')}</td>
                      <td
                        className={`py-2 text-right ${
                          s.ret_pct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {s.ret_pct >= 0 ? '+' : ''}
                        {s.ret_pct.toFixed(2)} %
                      </td>
                      <td className="py-2 text-right">{s.pit.toFixed(3)}</td>
                      <td className="py-2 text-right">{s.in50 ? 'Sí' : 'No'}</td>
                      <td className="py-2 text-right">{s.in90 ? 'Sí' : 'No'}</td>
                      <td className="py-2 text-right">
                        {s.in90_opt === null || s.in90_opt === undefined ? '—' : s.in90_opt ? 'Sí' : 'No'}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Walk-Forward Empirical Results (RESULTS.md) */}
      {results && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-5">
            <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-50">
              Benchmark Walk-Forward: Volatilidad (Pinball Loss vs GJR-GARCH)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 mb-3">{results.sample_note}</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                    <th className="py-2 text-left font-medium">Activo</th>
                    <th className="py-2 text-left font-medium">Horiz.</th>
                    <th className="py-2 text-right font-medium">HAR</th>
                    <th className="py-2 text-right font-medium">Ensamble GARCH+HAR [IC 95%]</th>
                    <th className="py-2 text-right font-medium">Con DVOL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 font-mono tabular-nums">
                  {results.vol_ensemble.map((row, idx) => (
                    <tr key={idx}>
                      <td className="py-2 font-sans font-medium">{row.asset}</td>
                      <td className="py-2 font-sans">{row.horizon}</td>
                      <td className="py-2 text-right">{row.har}</td>
                      <td
                        className={`py-2 text-right ${
                          row.positive ? 'text-emerald-600 dark:text-emerald-400 font-medium' : ''
                        }`}
                      >
                        {row.ens}
                      </td>
                      <td className="py-2 text-right text-slate-500 dark:text-slate-400">{row.ens_iv}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-5">
            <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-50">
              Benchmark Walk-Forward: Dirección Precio/Volumen (Coste 0.10 %)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 mb-3">
              Ninguna señal direccional 1H sobrevive a Bonferroni; por ello el cono mantiene deriva cero.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                    <th className="py-2 text-left font-medium">Activo</th>
                    <th className="py-2 text-left font-medium">Horiz.</th>
                    <th className="py-2 text-right font-medium">Acierto</th>
                    <th className="py-2 text-right font-medium">AUC</th>
                    <th className="py-2 text-right font-medium">Neto / op [IC 95 %]</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 font-mono tabular-nums">
                  {results.directional_signals.map((row, idx) => (
                    <tr key={idx}>
                      <td className="py-2 font-sans font-medium">{row.asset}</td>
                      <td className="py-2 font-sans">{row.horizon}</td>
                      <td className="py-2 text-right">{row.hit_pct.toFixed(1)} %</td>
                      <td className="py-2 text-right">{row.auc.toFixed(3)}</td>
                      <td
                        className={`py-2 text-right ${
                          row.net_pct > 0 ? 'text-slate-700 dark:text-slate-200' : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {row.net_pct >= 0 ? '+' : ''}
                        {row.net_pct.toFixed(3)} % {row.ci}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Section 3: Binance 2-Year 1m Intraday Study */}
          <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-5">
            <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-50">
              Benchmark Intradía 2 Años Binance 1m (1.08 M velas · Coste 0.10 % Taker)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 mb-3">
              Reversión a 5–15 min estadísticamente real tras flujo agresor (18 señales Bonferroni BTC, 17 ETH), pero bruto (+0.5 a +4.4 pb) inferior al coste taker (10 pb).
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                    <th className="py-2 text-left font-medium">Activo</th>
                    <th className="py-2 text-left font-medium">Horizonte</th>
                    <th className="py-2 text-right font-medium">Acierto</th>
                    <th className="py-2 text-right font-medium">AUC</th>
                    <th className="py-2 text-right font-medium">Bruto / op</th>
                    <th className="py-2 text-right font-medium">Neto (0.10 %)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 font-mono tabular-nums">
                  {results.binance_intraday.map((row, idx) => (
                    <tr key={idx}>
                      <td className="py-2 font-sans font-medium">{row.asset}</td>
                      <td className="py-2 font-sans">{row.horizon}</td>
                      <td className="py-2 text-right">{row.hit_pct.toFixed(1)} %</td>
                      <td className="py-2 text-right font-medium text-sky-600 dark:text-sky-400">{row.auc.toFixed(3)}</td>
                      <td className="py-2 text-right text-emerald-600 dark:text-emerald-400">
                        {row.gross_pct >= 0 ? '+' : ''}
                        {row.gross_pct.toFixed(3)} %
                      </td>
                      <td className="py-2 text-right text-rose-600 dark:text-rose-400">
                        {row.net_pct.toFixed(3)} %
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Sections 4-7 Summary */}
          <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-3 text-xs">
            <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-50">
              Síntesis Empírica (Evaluación Formal, ACI, Opciones SVI y Rotación 40)
            </h3>
            <div className="space-y-2.5 text-slate-600 dark:text-slate-300 leading-relaxed">
              <div>
                <span className="font-semibold text-slate-900 dark:text-slate-100">Evaluación Formal: </span>
                {results.formal_eval_note}
              </div>
              <div>
                <span className="font-semibold text-slate-900 dark:text-slate-100">Conformal Adaptativo (ACI): </span>
                {results.conformal_note}
              </div>
              <div>
                <span className="font-semibold text-slate-900 dark:text-slate-100">Cono Opciones SVI: </span>
                {results.options_cone_note}
              </div>
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                <span className="font-semibold text-slate-900 dark:text-slate-100">
                  Rotación 40 monedas ({results.rotation_summary.best_variant}):{' '}
                </span>
                <span className="font-mono tabular-nums">
                  Primaria SR {results.rotation_summary.primary_sharpe.toFixed(2)} · NW t={results.rotation_summary.nw_t.toFixed(2)} · DSR {results.rotation_summary.dsr.toFixed(2)} · Mejor SR {results.rotation_summary.best_sharpe.toFixed(2)} (DSR {results.rotation_summary.best_dsr.toFixed(2)}).{' '}
                </span>
                {results.rotation_summary.note}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

import React, { useEffect, useState } from 'react';
import type { OverviewResponse, WalkForwardOutput } from '../types.ts';
import { ProbabilityConeChart } from './ProbabilityConeChart.tsx';
import { TargetProbabilityCard } from './TargetProbabilityCard.tsx';

interface Props {
  data: OverviewResponse;
}

function fmtPrice(v: number): string {
  if (v >= 1000) return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (v >= 100) return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}`;
}

export const ConeView: React.FC<Props> = ({ data }) => {
  const [tf, setTf] = useState<'1H' | '1D'>('1H');
  const [showEnsemble, setShowEnsemble] = useState(true);
  const [showOptionsCone, setShowOptionsCone] = useState(true);
  const [showPaths, setShowPaths] = useState(true);
  const [showGexOverlay, setShowGexOverlay] = useState(true);

  const [wf, setWf] = useState<WalkForwardOutput | null>(null);
  const [wfLoading, setWfLoading] = useState(false);
  const [wfError, setWfError] = useState<string | null>(null);

  useEffect(() => {
    setWf(null);
    setWfError(null);
  }, [data.asset]);

  const runWalkForward = async () => {
    setWfLoading(true);
    setWfError(null);
    try {
      const res = await fetch(`/api/walkforward?asset=${data.asset}`);
      if (!res.ok) throw new Error('Error ejecutando calibración walk-forward');
      setWf((await res.json()) as WalkForwardOutput);
    } catch (e) {
      setWfError(e instanceof Error ? e.message : 'Error de red');
    } finally {
      setWfLoading(false);
    }
  };

  const block = tf === '1H' ? data.h1 : data.d1;
  const volHist = block.vol_hist;
  const minV = Math.min(...volHist);
  const maxV = Math.max(...volHist);
  const volSparkPts = volHist
    .map((v, i) => {
      const x = (i / Math.max(1, volHist.length - 1)) * 320;
      const y = 76 - ((v - minV) / Math.max(1e-6, maxV - minV)) * 64;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const regimeColor =
    data.regime.current === 'Turbulento'
      ? 'text-rose-600 dark:text-rose-400'
      : data.regime.current === 'Calma'
        ? 'text-emerald-600 dark:text-emerald-400'
        : 'text-amber-600 dark:text-amber-400';

  const moveKeys = Object.keys(block.move);

  return (
    <div className="space-y-6">
      {/* 4-Column KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Precio Spot ({data.inst})</div>
          <div className="mt-1.5 text-2xl font-display font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-50">
            {fmtPrice(block.spot)}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            Deriva aplicada: 0.00 % · Sin sesgo
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Volatilidad Anualizada ({block.label})</div>
          <div className="mt-1.5 text-2xl font-display font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-50">
            {(block.vol_now_ann * 100).toFixed(1)} %
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            Percentil histórico: {block.vol_pctile.toFixed(1)} %
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Régimen de Volatilidad (GMM/EM)</div>
          <div className={`mt-1.5 text-2xl font-display font-semibold ${regimeColor}`}>
            {data.regime.current}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            Calma {(data.regime.probs.Calma * 100).toFixed(0)} % · Normal {(data.regime.probs.Normal * 100).toFixed(0)} % · Turb.{' '}
            {(data.regime.probs.Turbulento * 100).toFixed(0)} %
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Cociente Ensamble GARCH + HAR</div>
          <div className="mt-1.5 text-2xl font-display font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-50">
            {data.ens_ratio['72']?.toFixed(3)}× <span className="text-sm font-normal text-slate-500">a 72 h</span>
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            24 h: {data.ens_ratio['24']?.toFixed(3)}× · Banda vs GJR-GARCH
          </div>
        </div>
      </div>

      {/* Main Probability Cone Panel */}
      <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-5">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="text-base font-display font-semibold text-slate-900 dark:text-slate-50">
              Cono de Probabilidad GJR-GARCH(1,1) con Colas Student-t
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Bandas calibradas al 50 % (P25–P75) y 90 % (P5–P95) sobre {data.n_hours.toLocaleString('es-ES')} velas 1H de OKX.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-lg">
              <button
                type="button"
                onClick={() => setTf('1H')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  tf === '1H'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-50 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                1H · 72 h
              </button>
              <button
                type="button"
                onClick={() => setTf('1D')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  tf === '1D'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-50 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                1D · 30 d
              </button>
            </div>

            {tf === '1H' && (
              <button
                type="button"
                onClick={() => setShowEnsemble((s) => !s)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  showEnsemble
                    ? 'border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                }`}
              >
                Ensamble HAR (90 %)
              </button>
            )}

            {tf === '1H' && data.options_cone && (
              <button
                type="button"
                onClick={() => setShowOptionsCone((s) => !s)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  showOptionsCone
                    ? 'border-violet-500/50 bg-violet-500/10 text-violet-700 dark:text-violet-300'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                }`}
              >
                Opciones SVI (90 %)
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowPaths((s) => !s)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                showPaths
                  ? 'border-sky-500/50 bg-sky-500/10 text-sky-700 dark:text-sky-300'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
              }`}
            >
              Trayectorias MC
            </button>

            {data.gex && (
              <button
                type="button"
                onClick={() => setShowGexOverlay((s) => !s)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  showGexOverlay
                    ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                }`}
              >
                Niveles GEX
              </button>
            )}
          </div>
        </div>

        <ProbabilityConeChart
          block={block}
          showEnsemble={tf === '1H' && showEnsemble}
          showPaths={showPaths}
          showOptionsCone={tf === '1H' && showOptionsCone}
          optionsCone={data.options_cone}
          gexOverlay={
            showGexOverlay && data.gex
              ? {
                  callWall: data.gex.call_wall,
                  putWall: data.gex.put_wall,
                  flip: data.gex.flip,
                }
              : null
          }
        />

        {tf === '1H' && data.options_cone && (
          <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-4 text-xs">
            <div>
              <span className="font-medium text-violet-600 dark:text-violet-400">
                Cono Implícito de Opciones (SVI + Breeden-Litzenberger)
              </span>
              <span className="text-slate-500 dark:text-slate-400 ml-2 font-mono tabular-nums">
                {data.options_cone.expiries} vencimientos Deribit · Medida neutral al riesgo
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-6 font-mono tabular-nums text-slate-700 dark:text-slate-300">
              {(['24', '72'] as const).map((hKey) => {
                const oc = data.options_cone!.cone[hKey];
                return (
                  <span key={hKey}>
                    <span className="text-slate-500 dark:text-slate-400">{hKey} h (IV ATM {oc.iv_atm_pct.toFixed(1)}%): </span>
                    <span className="text-rose-600 dark:text-rose-400">{oc.q['5'].toFixed(1)}%</span>
                    {' – '}
                    <span className="text-emerald-600 dark:text-emerald-400">+{oc.q['95'].toFixed(1)}%</span>
                    <span className="text-slate-400 ml-1">
                      ({fmtPrice(oc.prices['5'])}–{fmtPrice(oc.prices['95'])})
                    </span>
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <TargetProbabilityCard asset={data.asset} spot={data.h1.spot} />

      {/* Two-Column Analytics Below Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* First Passage & Move Ranges */}
        <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-5">
          <div>
            <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-50">
              Probabilidad de Barreras (Primer Paso)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Probabilidad de tocar primero el umbral alcista o bajista dentro de {block.H} {block.label === '1H' ? 'horas' : 'días'} (con corrección de toque intravela).
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                  <th className="py-2 text-left font-medium">Barrera simétrica</th>
                  <th className="py-2 text-right font-medium">Toca arriba primero</th>
                  <th className="py-2 text-right font-medium">Toca abajo primero</th>
                  <th className="py-2 text-right font-medium">Sin tocar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 font-mono tabular-nums">
                {block.touch.map((row) => (
                  <tr key={row.up} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                    <td className="py-2.5 font-medium text-slate-800 dark:text-slate-200">
                      ±{(row.up * 100).toFixed(0)} %
                    </td>
                    <td className="py-2.5 text-right text-emerald-600 dark:text-emerald-400">
                      {(row.up_first * 100).toFixed(1)} %
                    </td>
                    <td className="py-2.5 text-right text-rose-600 dark:text-rose-400">
                      {(row.dn_first * 100).toFixed(1)} %
                    </td>
                    <td className="py-2.5 text-right text-slate-500 dark:text-slate-400">
                      {(row.none * 100).toFixed(1)} %
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
            <div className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">
              Rango de retorno esperado y P(cierre &gt; spot)
            </div>
            <div className="grid grid-cols-2 gap-4">
              {moveKeys.map((h) => {
                const mv = block.move[h];
                const pUp = block.p_close_up[`up_${h}`] ?? 0.5;
                return (
                  <div
                    key={h}
                    className="p-3 rounded-md bg-slate-50 dark:bg-slate-800/40 border border-slate-200/70 dark:border-slate-800"
                  >
                    <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                      <span>Horizonte {h}{block.label === '1H' ? ' h' : ' d'}</span>
                      <span className="font-mono tabular-nums">P(alcista): {(pUp * 100).toFixed(1)} %</span>
                    </div>
                    <div className="mt-1.5 font-mono tabular-nums text-xs flex items-center justify-between">
                      <span className="text-rose-600 dark:text-rose-400">{(mv.p5 * 100).toFixed(1)} %</span>
                      <span className="text-slate-700 dark:text-slate-200 font-medium">
                        {(mv.p50 * 100).toFixed(2)} %
                      </span>
                      <span className="text-emerald-600 dark:text-emerald-400">+{(mv.p95 * 100).toFixed(1)} %</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* GJR-GARCH Parameters & Conditional Vol History */}
        <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-5">
          <div>
            <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-50">
              Parámetros GJR-GARCH(1,1) y Volatilidad Condicional
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Estimación por máxima verosimilitud con innovaciones t-Student (colas pesadas y efecto asimétrico).
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3 font-mono tabular-nums text-xs">
            <div className="p-3 rounded-md bg-slate-50 dark:bg-slate-800/40">
              <div className="text-slate-500 dark:text-slate-400">Alpha (α)</div>
              <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                {block.garch.alpha.toFixed(4)}
              </div>
            </div>
            <div className="p-3 rounded-md bg-slate-50 dark:bg-slate-800/40">
              <div className="text-slate-500 dark:text-slate-400">Gamma asim. (γ)</div>
              <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                {block.garch.gamma.toFixed(4)}
              </div>
            </div>
            <div className="p-3 rounded-md bg-slate-50 dark:bg-slate-800/40">
              <div className="text-slate-500 dark:text-slate-400">Beta (β)</div>
              <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                {block.garch.beta.toFixed(4)}
              </div>
            </div>
            <div className="p-3 rounded-md bg-slate-50 dark:bg-slate-800/40">
              <div className="text-slate-500 dark:text-slate-400">Persistencia</div>
              <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                {block.garch.persistence.toFixed(4)}
              </div>
            </div>
            <div className="p-3 rounded-md bg-slate-50 dark:bg-slate-800/40">
              <div className="text-slate-500 dark:text-slate-400">Grados libertad (ν)</div>
              <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                {block.garch.nu.toFixed(2)}
              </div>
            </div>
            <div className="p-3 rounded-md bg-slate-50 dark:bg-slate-800/40">
              <div className="text-slate-500 dark:text-slate-400">Omega (ω)</div>
              <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                {block.garch.omega.toFixed(5)}
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2">
              <span>Volatilidad condicional anualizada (últimas {volHist.length} barras)</span>
              <span className="font-mono tabular-nums">
                Rango: {(minV * 100).toFixed(1)} % – {(maxV * 100).toFixed(1)} %
              </span>
            </div>
            <svg viewBox="0 0 320 84" className="w-full h-24 overflow-visible">
              <polyline
                fill="none"
                className="stroke-sky-500 dark:stroke-sky-400"
                strokeWidth={1.8}
                points={volSparkPts}
              />
            </svg>
          </div>
        </div>
      </div>

      {/* On-Demand Walk-Forward Calibration & PIT Histogram */}
      <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-50">
              Calibración Walk-Forward en Vivo (Cobertura, Winkler Score y PIT)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Evalúa sin mirar al futuro la calibración empírica del cono GJR-GARCH frente al bootstrap histórico sobre las últimas velas 1H.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void runWalkForward()}
            disabled={wfLoading}
            className="px-4 py-1.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors cursor-pointer"
          >
            {wfLoading ? 'Calculando walk-forward…' : wf ? 'Recalcular Walk-Forward' : 'Ejecutar Walk-Forward (1H)'}
          </button>
        </div>

        {wfError && (
          <div className="mt-3 text-xs text-rose-600 dark:text-rose-400">{wfError}</div>
        )}

        {wf && (
          <div className="mt-5 space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="overflow-x-auto">
                <div className="text-xs text-slate-500 dark:text-slate-400 mb-2 font-mono tabular-nums">
                  Ventana: {wf.window} h · Paso: {wf.step} h · {wf.sims} sims · Contraste formal (CRPS, DM, Kupiec, Christoffersen)
                </div>
                <table className="w-full text-xs font-mono tabular-nums">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                      <th className="py-2 text-left font-medium">Horiz. (n)</th>
                      <th className="py-2 text-right font-medium">Cob. 50/80/90%</th>
                      <th className="py-2 text-right font-medium">Winkler (G/B)</th>
                      <th className="py-2 text-right font-medium">CRPS (G/B)</th>
                      <th className="py-2 text-right font-medium">DM (p)</th>
                      <th className="py-2 text-right font-medium">Kupiec / Chr. p</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                    {wf.horizons.map((h) => (
                      <tr key={h.horizon}>
                        <td className="py-2 font-sans font-medium">
                          {h.horizon} h ({h.n})
                        </td>
                        <td className="py-2 text-right">
                          {h.garch['50']} / {h.garch['80']} /{' '}
                          <span className="font-semibold text-sky-600 dark:text-sky-400">{h.garch['90']}%</span>
                        </td>
                        <td className="py-2 text-right">
                          <span className={h.winkler90_garch <= h.winkler90_base ? 'text-emerald-600 dark:text-emerald-400' : ''}>
                            {h.winkler90_garch.toFixed(1)}
                          </span>
                          {' / '}
                          {h.winkler90_base.toFixed(1)}
                        </td>
                        <td className="py-2 text-right">
                          <span className={h.crps_garch <= h.crps_base ? 'text-emerald-600 dark:text-emerald-400' : ''}>
                            {h.crps_garch.toFixed(2)}
                          </span>
                          {' / '}
                          {h.crps_base.toFixed(2)}
                        </td>
                        <td className="py-2 text-right">
                          {h.dm_stat >= 0 ? '+' : ''}
                          {h.dm_stat.toFixed(2)} <span className="text-slate-400">({h.dm_p.toFixed(3)})</span>
                        </td>
                        <td className="py-2 text-right">
                          {h.kupiec90_garch_p.toFixed(2)} / {h.christ_ind90_garch_p.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* 10-bin PIT Histogram for 24h & 72h */}
              <div className="space-y-3">
                {wf.horizons.map((h) => {
                  const maxBin = Math.max(1, ...h.pit_hist);
                  const expected = h.n / 10;
                  return (
                    <div key={h.horizon}>
                      <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
                        <span>Histograma PIT ({h.horizon} h · 10 deciles)</span>
                        <span className="font-mono tabular-nums">Uniforme ideal ≈ {expected.toFixed(1)} / bin</span>
                      </div>
                      <div className="flex items-end gap-1.5 h-16 border-b border-slate-200 dark:border-slate-800 pb-1">
                        {h.pit_hist.map((cnt, idx) => (
                          <div key={idx} className="flex-1 flex flex-col items-center justify-end h-full">
                            <div
                              className="w-full bg-sky-500/75 dark:bg-sky-400/75 rounded-t-xs"
                              style={{ height: `${Math.max(4, (cnt / maxBin) * 100)}%` }}
                              title={`Decil ${idx * 10}–${(idx + 1) * 10}%: ${cnt}`}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ACI Conformal Prediction Comparison */}
            {wf.horizons.some((h) => h.aci !== null) && (
              <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
                <div className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Conformal Adaptativo (ACI, Gibbs &amp; Candès γ = 0.02 con retroalimentación retrasada h/{wf.step})
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {wf.horizons.map((h) =>
                    h.aci ? (
                      <div
                        key={`aci-${h.horizon}`}
                        className="p-3 rounded-md bg-slate-50 dark:bg-slate-800/40 border border-slate-200/70 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums"
                      >
                        <span className="font-sans font-medium text-slate-800 dark:text-slate-200">
                          ACI {h.horizon} h
                        </span>
                        <span>Cob 90%: {h.aci.cov90.toFixed(1)}%</span>
                        <span>Ancho: {h.aci.mean_width_pct.toFixed(2)}%</span>
                        <span>Winkler: {h.aci.winkler90.toFixed(2)}</span>
                        <span className="text-slate-500 dark:text-slate-400">
                          Kupiec p={h.aci.kupiec90_p.toFixed(2)} · α_eff={h.aci.last_alpha_eff.toFixed(3)}
                        </span>
                      </div>
                    ) : null,
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

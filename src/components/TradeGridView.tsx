import React, { useEffect, useMemo, useState } from 'react';
import { BookmarkPlus, Trash2 } from 'lucide-react';
import type { TradeAnalysisResponse, TradeGridRow } from '../types.ts';
import {
  deleteTradePreset,
  loadTradePresets,
  saveTradePreset,
  type LocalTradePreset,
} from '../lib/localPresets.ts';

interface Props {
  data: TradeAnalysisResponse;
}

export const TradeGridView: React.FC<Props> = ({ data }) => {
  const [dir, setDir] = useState<'long' | 'short'>('long');

  // What-If Simulator State
  const [simDir, setSimDir] = useState<'long' | 'short'>('long');
  const [slPct, setSlPct] = useState(2.0);
  const [tpPct, setTpPct] = useState(4.0);
  const [costPct, setCostPct] = useState(0.10);
  const [drift24hPct, setDrift24hPct] = useState(0.0);
  const [simResult, setSimResult] = useState<TradeGridRow | null>(null);
  const [simLoading, setSimLoading] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);
  const [presets, setPresets] = useState<LocalTradePreset[]>(() => loadTradePresets());
  const [savingPreset, setSavingPreset] = useState(false);

  const handleSavePreset = async () => {
    if (!simResult) return;
    setSavingPreset(true);
    try {
      const next = saveTradePreset({
        asset: data.asset,
        dir: simDir,
        slPct,
        tpPct,
        costPct,
        drift24hPct,
        result: simResult,
      });
      setPresets(next);
    } finally {
      setSavingPreset(false);
    }
  };

  const runSimulation = async (override?: {
    dir?: 'long' | 'short';
    sl_pct?: number;
    tp_pct?: number;
    cost_pct?: number;
    drift_24h_pct?: number;
  }) => {
    const payload = {
      asset: data.asset,
      dir: override?.dir ?? simDir,
      sl_pct: override?.sl_pct ?? slPct,
      tp_pct: override?.tp_pct ?? tpPct,
      cost_pct: override?.cost_pct ?? costPct,
      drift_24h_pct: override?.drift_24h_pct ?? drift24hPct,
    };
    setSimLoading(true);
    setSimError(null);
    try {
      const res = await fetch('/api/trades/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Error ejecutando simulación');
      }
      setSimResult((await res.json()) as TradeGridRow);
    } catch (e) {
      setSimError(e instanceof Error ? e.message : 'Error de red');
    } finally {
      setSimLoading(false);
    }
  };

  const rows = useMemo(
    () => data.grid.filter((g) => g.dir === dir).sort((a, b) => a.sl_pct - b.sl_pct || a.tp_pct - b.tp_pct),
    [data.grid, dir],
  );

  const featureLabels: Record<string, string> = {
    mom_6: 'Momentum 6 h (z)',
    mom_24: 'Momentum 24 h (z)',
    mom_72: 'Momentum 72 h (z)',
    bb_z: 'Bollinger (20) z',
    rsi14: 'RSI(14) normalizado',
    vol_ratio: 'Ratio Vol 24h/168h',
    vol_pct: 'Percentil Vol (-0.5..+0.5)',
    ema_dev_50: 'Desviación EMA50 (z)',
    range_pos: 'Posición en rango 7d',
  };

  return (
    <div className="space-y-6">
      {/* Top EV & Required Drift Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Simulaciones Martingala GARCH (72 h)</div>
          <div className="mt-1.5 text-xl font-display font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-50">
            {data.n_sims.toLocaleString('es-ES')} rutas · Coste {data.cost_pct.toFixed(2)} %
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            Combos con EV &gt; 0 significativo: {data.n_sig} / {data.n_combos}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Sin ventaja de dirección, el EV de cada combo es −coste por construcción: lo esperable aquí es ≈ 0.
          </div>
        </div>

        {data.top
          .filter((t) => t.key === 'L1' || t.key === 'S1')
          .map((setup) => (
            <div
              key={setup.key}
              className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-4"
            >
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Menor coste relativo {setup.dir === 'long' ? 'Largo' : 'Corto'} (SL {setup.sl_pct}% / TP {setup.tp_pct}%)
              </div>
              <div className="mt-1.5 text-xl font-display font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-50">
                EV {setup.ev_pct >= 0 ? '+' : ''}
                {setup.ev_pct.toFixed(3)} % <span className="text-xs text-slate-500 font-normal">({setup.ev_r.toFixed(3)} R)</span>
              </div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                Deriva 24 h para EV=0: {setup.req_drift_24h_pct !== null && setup.req_drift_24h_pct !== undefined
                  ? `${setup.req_drift_24h_pct >= 0 ? '+' : ''}${setup.req_drift_24h_pct.toFixed(3)} %`
                  : '—'}
              </div>
            </div>
          ))}
      </div>

      {/* Interactive What-If Trade Simulator */}
      <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-display font-semibold text-slate-900 dark:text-slate-50">
              Simulador Interactivo &laquo;What-If&raquo; (SL / TP / Comisión / Deriva 24 h)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Evalúa cualquier combinación personalizada en vivo sobre 1,200 trayectorias GJR-GARCH o haz clic en una fila de la matriz inferior.
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-slate-500 dark:text-slate-400 mr-1">Tarifas OKX:</span>
            {[
              { label: 'Maker 0.04%', val: 0.04 },
              { label: 'Mixta 0.07%', val: 0.07 },
              { label: 'Taker 0.10%', val: 0.10 },
            ].map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => setCostPct(p.val)}
                className={`px-2.5 py-1 rounded border text-xs font-mono tabular-nums cursor-pointer transition-colors ${
                  Math.abs(costPct - p.val) < 0.005
                    ? 'border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-400 font-medium'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 items-end">
          <div>
            <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Dirección</label>
            <select
              value={simDir}
              onChange={(e) => setSimDir(e.target.value === 'short' ? 'short' : 'long')}
              className="w-full px-3 py-2 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
            >
              <option value="long">Largo (Long)</option>
              <option value="short">Corto (Short)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Stop-Loss (%)</label>
            <input
              type="number"
              min={0.2}
              max={25}
              step={0.25}
              value={slPct}
              onChange={(e) => setSlPct(Number(e.target.value))}
              className="w-full px-3 py-2 text-xs font-mono tabular-nums rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Take-Profit (%)</label>
            <input
              type="number"
              min={0.2}
              max={40}
              step={0.25}
              value={tpPct}
              onChange={(e) => setTpPct(Number(e.target.value))}
              className="w-full px-3 py-2 text-xs font-mono tabular-nums rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Comisión RT (%)</label>
            <input
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={costPct}
              onChange={(e) => setCostPct(Number(e.target.value))}
              className="w-full px-3 py-2 text-xs font-mono tabular-nums rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Deriva hipotética 24h (%)</label>
            <input
              type="number"
              min={-5}
              max={5}
              step={0.25}
              value={drift24hPct}
              onChange={(e) => setDrift24hPct(Number(e.target.value))}
              className="w-full px-3 py-2 text-xs font-mono tabular-nums rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
            />
          </div>

          <button
            type="button"
            onClick={() => void runSimulation()}
            disabled={simLoading}
            className="px-4 py-2 text-xs font-medium rounded-md bg-sky-600 text-white hover:bg-sky-500 disabled:opacity-50 transition-colors cursor-pointer"
          >
            {simLoading ? 'Simulando…' : 'Simular escenario'}
          </button>
        </div>

        {simError && <div className="text-xs text-rose-600 dark:text-rose-400">{simError}</div>}

        {simResult && (
          <div className="space-y-3 pt-3 border-t border-slate-200 dark:border-slate-800">
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 font-mono tabular-nums text-xs">
              <div className="p-2.5 rounded bg-slate-50 dark:bg-slate-800/40">
                <div className="font-sans text-slate-500 dark:text-slate-400">EV neto %</div>
                <div
                  className={`mt-1 text-sm font-semibold ${
                    simResult.ev_pct > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {simResult.ev_pct >= 0 ? '+' : ''}
                  {simResult.ev_pct.toFixed(3)} %
                </div>
              </div>
              <div className="p-2.5 rounded bg-slate-50 dark:bg-slate-800/40">
                <div className="font-sans text-slate-500 dark:text-slate-400">Error estándar</div>
                <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  ±{simResult.ev_se_pct.toFixed(3)} %
                </div>
              </div>
              <div className="p-2.5 rounded bg-slate-50 dark:bg-slate-800/40">
                <div className="font-sans text-slate-500 dark:text-slate-400">EV (R)</div>
                <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {simResult.ev_r.toFixed(3)} R
                </div>
              </div>
              <div className="p-2.5 rounded bg-slate-50 dark:bg-slate-800/40">
                <div className="font-sans text-slate-500 dark:text-slate-400">Kelly %</div>
                <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {simResult.kelly_pct.toFixed(1)} %
                </div>
              </div>
              <div className="p-2.5 rounded bg-slate-50 dark:bg-slate-800/40">
                <div className="font-sans text-slate-500 dark:text-slate-400">P(TP)</div>
                <div className="mt-1 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                  {simResult.p_tp_pct.toFixed(1)} %
                </div>
              </div>
              <div className="p-2.5 rounded bg-slate-50 dark:bg-slate-800/40">
                <div className="font-sans text-slate-500 dark:text-slate-400">P(SL)</div>
                <div className="mt-1 text-sm font-semibold text-rose-600 dark:text-rose-400">
                  {simResult.p_sl_pct.toFixed(1)} %
                </div>
              </div>
              <div className="p-2.5 rounded bg-slate-50 dark:bg-slate-800/40">
                <div className="font-sans text-slate-500 dark:text-slate-400">P(Timeout)</div>
                <div className="mt-1 text-sm font-semibold text-slate-700 dark:text-slate-300">
                  {simResult.p_to_pct.toFixed(1)} %
                </div>
              </div>
              <div className="p-2.5 rounded bg-slate-50 dark:bg-slate-800/40">
                <div className="font-sans text-slate-500 dark:text-slate-400">Acierto BE / R:R</div>
                <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {simResult.be_pct.toFixed(1)}% · {simResult.rr.toFixed(2)}
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => void handleSavePreset()}
                disabled={savingPreset}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <BookmarkPlus className="w-3.5 h-3.5" />
                <span>{savingPreset ? 'Guardando…' : 'Guardar escenario'}</span>
              </button>
            </div>
          </div>
        )}

        {presets.length > 0 && (
          <div className="pt-3 border-t border-slate-200 dark:border-slate-800">
            <div className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-2">
              Escenarios guardados en este navegador ({presets.length})
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono tabular-nums">
                <thead>
                  <tr className="text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                    <th className="py-1.5 text-left font-sans font-medium">Activo / Lado</th>
                    <th className="py-1.5 text-right font-medium">SL / TP</th>
                    <th className="py-1.5 text-right font-medium">Comisión</th>
                    <th className="py-1.5 text-right font-medium">Deriva 24h</th>
                    <th className="py-1.5 text-right font-medium">EV neto %</th>
                    <th className="py-1.5 text-right font-medium">Kelly %</th>
                    <th className="py-1.5 text-right font-sans font-medium">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                  {presets.map((p) => (
                    <tr
                      key={p.id}
                      onClick={() => {
                        setSimDir(p.dir);
                        setSlPct(p.slPct);
                        setTpPct(p.tpPct);
                        setCostPct(p.costPct);
                        setDrift24hPct(p.drift24hPct);
                        void runSimulation({
                          dir: p.dir,
                          sl_pct: p.slPct,
                          tp_pct: p.tpPct,
                          cost_pct: p.costPct,
                          drift_24h_pct: p.drift24hPct,
                        });
                      }}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/30 cursor-pointer"
                    >
                      <td className="py-1.5 font-sans font-medium">
                        {p.asset.toUpperCase()} · {p.dir === 'long' ? 'Largo' : 'Corto'}
                      </td>
                      <td className="py-1.5 text-right">
                        -{p.slPct}% / +{p.tpPct}%
                      </td>
                      <td className="py-1.5 text-right">{p.costPct.toFixed(2)}%</td>
                      <td className="py-1.5 text-right">
                        {p.drift24hPct >= 0 ? '+' : ''}
                        {p.drift24hPct.toFixed(2)}%
                      </td>
                      <td
                        className={`py-1.5 text-right font-medium ${
                          p.evPct > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {p.evPct >= 0 ? '+' : ''}
                        {p.evPct.toFixed(3)}%
                      </td>
                      <td className="py-1.5 text-right">{p.kellyPct.toFixed(1)}%</td>
                      <td className="py-1.5 text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPresets(deleteTradePreset(p.id));
                          }}
                          className="text-slate-400 hover:text-rose-500 p-1 cursor-pointer"
                          title="Eliminar escenario"
                        >
                          <Trash2 className="w-3.5 h-3.5 inline" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* SL / TP Matrix */}
      <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-5">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="text-base font-display font-semibold text-slate-900 dark:text-slate-50">
              Rejilla Stop-Loss / Take-Profit sobre Trayectorias Neutrales
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Toques de SL/TP dentro de la vela (corrección de barrera) con martingala exacta y coste round-trip de {data.cost_pct.toFixed(2)} %. Con deriva neutra no debe haber ventaja por construcción: la columna «Ventaja necesaria» indica los puntos porcentuales de acierto que faltan para EV=0. Haz clic en una fila para cargarla en el simulador.
            </p>
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-lg">
            <button
              type="button"
              onClick={() => setDir('long')}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                dir === 'long'
                  ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Escenario Largo
            </button>
            <button
              type="button"
              onClick={() => setDir('short')}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                dir === 'short'
                  ? 'bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Escenario Corto
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                <th className="py-2 text-left font-medium">SL %</th>
                <th className="py-2 text-left font-medium">TP %</th>
                <th className="py-2 text-right font-medium">R:R</th>
                <th className="py-2 text-right font-medium">P(TP)</th>
                <th className="py-2 text-right font-medium">P(SL)</th>
                <th className="py-2 text-right font-medium">P(Timeout)</th>
                <th className="py-2 text-right font-medium">Acierto BE</th>
                <th className="py-2 text-right font-medium">Ventaja necesaria</th>
                <th className="py-2 text-right font-medium">EV neto %</th>
                <th className="py-2 text-right font-medium">EV (R)</th>
                <th className="py-2 text-right font-medium">Kelly %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 font-mono tabular-nums">
              {rows.map((r) => (
                <tr
                  key={`${r.sl_pct}-${r.tp_pct}`}
                  onClick={() => {
                    setSimDir(r.dir);
                    setSlPct(r.sl_pct);
                    setTpPct(r.tp_pct);
                    void runSimulation({ dir: r.dir, sl_pct: r.sl_pct, tp_pct: r.tp_pct });
                  }}
                  className="hover:bg-slate-50 dark:hover:bg-slate-800/30 cursor-pointer"
                >
                  <td className="py-2 text-rose-600 dark:text-rose-400">-{r.sl_pct.toFixed(1)} %</td>
                  <td className="py-2 text-emerald-600 dark:text-emerald-400">+{r.tp_pct.toFixed(1)} %</td>
                  <td className="py-2 text-right text-slate-700 dark:text-slate-300">{r.rr.toFixed(2)}</td>
                  <td className="py-2 text-right">{r.p_tp_pct.toFixed(1)} %</td>
                  <td className="py-2 text-right">{r.p_sl_pct.toFixed(1)} %</td>
                  <td className="py-2 text-right text-slate-500 dark:text-slate-400">{r.p_to_pct.toFixed(1)} %</td>
                  <td className="py-2 text-right text-slate-500 dark:text-slate-400">{r.be_pct.toFixed(1)} %</td>
                  <td className="py-2 text-right text-slate-500 dark:text-slate-400">
                    {r.be_pct - r.p_tp_pct >= 0 ? '+' : ''}
                    {(r.be_pct - r.p_tp_pct).toFixed(1)} pp
                  </td>
                  <td
                    className={`py-2 text-right font-medium ${
                      r.ev_pct > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {r.ev_pct >= 0 ? '+' : ''}
                    {r.ev_pct.toFixed(3)} %
                  </td>
                  <td className="py-2 text-right">{r.ev_r.toFixed(3)}</td>
                  <td className="py-2 text-right">{r.kelly_pct.toFixed(1)} %</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Technical Features + Contrarian Events */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-5">
          <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-50 mb-3">
            Estado Técnico Actual
          </h3>
          <div className="divide-y divide-slate-100 dark:divide-slate-800/70 text-xs">
            {Object.entries(data.feat_now).map(([k, v]) => (
              <div key={k} className="py-2 flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-400">{featureLabels[k] ?? k}</span>
                <span
                  className={`font-mono tabular-nums font-medium ${
                    Math.abs(v) > 2
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-slate-900 dark:text-slate-100'
                  }`}
                >
                  {v >= 0 ? '+' : ''}
                  {v.toFixed(3)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-2 bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-5">
          <div className="mb-3">
            <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-50">
              Validación de Reglas Contrarian (Sin Solapamiento, Bonferroni)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Comprueba si operar contra extremos de Momentum 24 h o Bollinger Z supera costes tras corrección múltiple.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                  <th className="py-2 text-left font-medium">Regla</th>
                  <th className="py-2 text-right font-medium">Horiz.</th>
                  <th className="py-2 text-right font-medium">n</th>
                  <th className="py-2 text-right font-medium">Acierto</th>
                  <th className="py-2 text-right font-medium">Neto % [IC 95 %]</th>
                  <th className="py-2 text-right font-medium">p Bonf.</th>
                  <th className="py-2 text-right font-medium">Estado ahora</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 font-mono tabular-nums">
                {data.events.map((ev, i) => (
                  <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                    <td className="py-2 font-sans text-slate-800 dark:text-slate-200">{ev.rule}</td>
                    <td className="py-2 text-right">{ev.h} h</td>
                    <td className="py-2 text-right">{ev.n}</td>
                    <td className="py-2 text-right">{ev.hit_pct.toFixed(1)} %</td>
                    <td
                      className={`py-2 text-right ${
                        ev.net_pct > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {ev.net_pct >= 0 ? '+' : ''}
                      {ev.net_pct.toFixed(3)} % [{ev.ci_lo.toFixed(2)}; {ev.ci_hi.toFixed(2)}]
                    </td>
                    <td className="py-2 text-right">{ev.p_bonf.toFixed(2)}</td>
                    <td className="py-2 text-right font-sans">
                      {ev.active_now ? (
                        <span className="text-amber-600 dark:text-amber-400 font-medium">
                          Activa ({ev.dir_now === 'long' ? 'Largo' : 'Corto'})
                        </span>
                      ) : (
                        <span className="text-slate-400">Inactiva</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

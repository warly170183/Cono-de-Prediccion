import React, { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import type { AssetId, CollectorStatus, MicroLiveResponse, MicroStudyResponse } from '../types.ts';

interface Props {
  asset: AssetId;
}

export const MicroView: React.FC<Props> = ({ asset }) => {
  const [live, setLive] = useState<MicroLiveResponse | null>(null);
  const [study, setStudy] = useState<MicroStudyResponse | null>(null);
  const [collector, setCollector] = useState<CollectorStatus | null>(null);
  const [collectorBusy, setCollectorBusy] = useState(false);
  const [autoCapture, setAutoCapture] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async (record = false) => {
    try {
      setError(null);
      const [liveRes, studyRes, colRes] = await Promise.all([
        fetch(`/api/micro/live?asset=${asset}&record=${record ? '1' : '0'}`),
        fetch('/api/micro/study'),
        fetch('/api/micro/collector'),
      ]);
      if (!liveRes.ok) throw new Error('Error cargando libro de órdenes OKX');
      const liveJson = (await liveRes.json()) as MicroLiveResponse;
      setLive(liveJson);
      if (studyRes.ok) {
        const studyJson = (await studyRes.json()) as MicroStudyResponse;
        setStudy(studyJson);
      }
      if (colRes.ok) {
        setCollector((await colRes.json()) as CollectorStatus);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error de red');
    } finally {
      setLoading(false);
    }
  };

  const toggleServerCollector = async () => {
    setCollectorBusy(true);
    setError(null);
    try {
      const action = collector?.running ? 'stop' : 'start';
      const res = await fetch('/api/micro/collector', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, asset }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Error controlando colector continuo');
      }
      setCollector((await res.json()) as CollectorStatus);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error en colector');
    } finally {
      setCollectorBusy(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    void loadData(false);
  }, [asset]);

  useEffect(() => {
    if (!autoCapture && !collector?.running) return;
    const id = setInterval(() => {
      void loadData(autoCapture);
    }, 10_000);
    return () => clearInterval(id);
  }, [autoCapture, collector?.running, asset]);

  const maxDepth = live
    ? Math.max(
        0.001,
        ...live.orderbook.bids.map((b) => b[1]),
        ...live.orderbook.asks.map((a) => a[1]),
      )
    : 1;

  const progressPct = study
    ? Math.min(100, (study.n_rows / study.min_rows_required) * 100)
    : 0;

  // Mini chart for archived mid prices
  const series = study?.recent_series ?? [];
  const midMin = series.length ? Math.min(...series.map((s) => s.mid)) : 0;
  const midMax = series.length ? Math.max(...series.map((s) => s.mid)) : 1;
  const midPts = series
    .map((s, i) => {
      const x = (i / Math.max(1, series.length - 1)) * 520;
      const y = 110 - ((s.mid - midMin) / Math.max(1e-6, midMax - midMin)) * 94;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <div className="space-y-6">
      {/* Control Toolbar */}
      <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-display font-semibold text-slate-900 dark:text-slate-50">
              Microestructura Intradía ({asset.toUpperCase()}-USDT-SWAP)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Libro L2 (20 niveles), microprecio, flujo agresivo taker, base mark/índice y colector continuo 1-min en servidor.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void loadData(true)}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              Capturar tick ahora
            </button>
            <button
              type="button"
              onClick={() => setAutoCapture((v) => !v)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                autoCapture
                  ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                  : 'border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {autoCapture ? 'Detener polling UI (10 s)' : 'Auto-polling UI (10 s)'}
            </button>
            <button
              type="button"
              onClick={() => void toggleServerCollector()}
              disabled={collectorBusy}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer disabled:opacity-50 ${
                collector?.running
                  ? 'bg-rose-600 text-white hover:bg-rose-500'
                  : 'bg-sky-600 text-white hover:bg-sky-500'
              }`}
            >
              {collector?.running ? 'Detener colector 1-min' : 'Iniciar colector 1-min (Servidor)'}
            </button>
          </div>
        </div>

        {/* Server-side Continuous Collector Status Strip */}
        {collector && (
          <div className="pt-2.5 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300">
            <div>
              Colector continuo:{' '}
              <span
                className={
                  collector.running
                    ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                    : 'text-slate-500 dark:text-slate-400'
                }
              >
                {collector.running ? `Activo (${collector.inst})` : 'Detenido'}
              </span>
              {' · '}Barras 1m guardadas: {collector.bars_collected}
              {' · '}Sondeos trades (10s): {collector.trades_polled}
              {' · '}Ventanas missed: {collector.missed_bars}
              {collector.last_mid !== null && ` · Último mid: $${collector.last_mid.toLocaleString('en-US')}`}
            </div>

            <div className="flex items-center gap-2 font-sans">
              <a
                href="/api/micro/export?format=csv"
                download
                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-mono rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <Download className="w-3 h-3" />
                Exportar CSV
              </a>
              <a
                href="/api/micro/export?format=jsonl"
                download
                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-mono rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <Download className="w-3 h-3" />
                Exportar JSONL
              </a>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="p-4 rounded-lg border border-rose-500/30 bg-rose-500/10 text-xs text-rose-600 dark:text-rose-400">
          {error}
        </div>
      )}

      {loading && !live ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-24 rounded-lg bg-slate-200/60 dark:bg-slate-800/50 animate-pulse"
            />
          ))}
        </div>
      ) : live ? (
        <>
          {/* Live Microstructure KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 font-mono tabular-nums">
            <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
              <div className="font-sans text-xs text-slate-500 dark:text-slate-400">Mid &amp; Spread</div>
              <div className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-50">
                ${live.tick.mid.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Spread: {live.tick.spread_bps.toFixed(3)} bps · Micro: {live.tick.microprice_bps >= 0 ? '+' : ''}
                {live.tick.microprice_bps.toFixed(3)} bps
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
              <div className="font-sans text-xs text-slate-500 dark:text-slate-400">Desequilibrio del Libro</div>
              <div
                className={`mt-1 text-xl font-semibold ${
                  (live.tick.imb5 ?? 0) >= 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {live.tick.imb5 !== null ? `${live.tick.imb5 >= 0 ? '+' : ''}${live.tick.imb5.toFixed(3)}` : '—'}{' '}
                <span className="text-xs font-normal text-slate-500">(5 niv.)</span>
              </div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                20 niv.: {live.tick.imb20 !== null ? live.tick.imb20.toFixed(3) : '—'} · Prof 5pb: {live.tick.depth_bid_btc.toFixed(1)} / {live.tick.depth_ask_btc.toFixed(1)}
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
              <div className="font-sans text-xs text-slate-500 dark:text-slate-400">Base Mark / Índice</div>
              <div className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-50">
                {live.tick.basis_bps !== null
                  ? `${live.tick.basis_bps >= 0 ? '+' : ''}${live.tick.basis_bps.toFixed(2)} bps`
                  : '—'}
              </div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Funding: {live.tick.funding !== null ? `${(live.tick.funding * 100).toFixed(4)} %` : '—'}
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
              <div className="font-sans text-xs text-slate-500 dark:text-slate-400">Flujo Taker (últ. 200 ops)</div>
              <div className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-50">
                <span className="text-emerald-600 dark:text-emerald-400">{live.tick.tk_buy_btc.toFixed(2)}</span>
                {' / '}
                <span className="text-rose-600 dark:text-rose-400">{live.tick.tk_sell_btc.toFixed(2)}</span>
              </div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Liq 1h (L/S): {live.tick.liq_long_btc.toFixed(2)} / {live.tick.liq_short_btc.toFixed(2)}
              </div>
            </div>
          </div>

          {/* Orderbook Ladder & Taker Tape */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-5">
              <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-50 mb-3">
                Profundidad L2 OKX (Top 12 Bid / Ask)
              </h3>
              <div className="grid grid-cols-2 gap-4 text-xs font-mono tabular-nums">
                <div>
                  <div className="flex justify-between text-slate-500 dark:text-slate-400 pb-1 border-b border-slate-200 dark:border-slate-800">
                    <span>Cant. Bid</span>
                    <span>Precio</span>
                  </div>
                  <div className="mt-1 space-y-1">
                    {live.orderbook.bids.map(([px, qty], i) => (
                      <div key={i} className="relative flex justify-between py-0.5 px-1">
                        <div
                          className="absolute inset-y-0 right-0 bg-emerald-500/12 pointer-events-none"
                          style={{ width: `${(qty / maxDepth) * 100}%` }}
                        />
                        <span className="relative text-slate-700 dark:text-slate-300">{qty.toFixed(3)}</span>
                        <span className="relative text-emerald-600 dark:text-emerald-400">{px.toLocaleString('en-US')}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-slate-500 dark:text-slate-400 pb-1 border-b border-slate-200 dark:border-slate-800">
                    <span>Precio</span>
                    <span>Cant. Ask</span>
                  </div>
                  <div className="mt-1 space-y-1">
                    {live.orderbook.asks.map(([px, qty], i) => (
                      <div key={i} className="relative flex justify-between py-0.5 px-1">
                        <div
                          className="absolute inset-y-0 left-0 bg-rose-500/12 pointer-events-none"
                          style={{ width: `${(qty / maxDepth) * 100}%` }}
                        />
                        <span className="relative text-rose-600 dark:text-rose-400">{px.toLocaleString('en-US')}</span>
                        <span className="relative text-slate-700 dark:text-slate-300">{qty.toFixed(3)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-5">
              <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-50 mb-3">
                Últimas Operaciones Ejecutadas (Cinta Taker)
              </h3>
              <div className="overflow-x-auto max-h-[290px]">
                <table className="w-full text-xs font-mono tabular-nums">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                      <th className="py-1.5 text-left font-medium">Hora</th>
                      <th className="py-1.5 text-left font-medium">Lado</th>
                      <th className="py-1.5 text-right font-medium">Precio</th>
                      <th className="py-1.5 text-right font-medium">Tamaño</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                    {live.recentTrades.map((t, idx) => (
                      <tr key={idx}>
                        <td className="py-1.5 text-slate-500 dark:text-slate-400">
                          {new Date(t.ts).toLocaleTimeString('es-ES')}
                        </td>
                        <td
                          className={`py-1.5 font-sans font-medium ${
                            t.side === 'buy'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {t.side === 'buy' ? 'Compra' : 'Venta'}
                        </td>
                        <td className="py-1.5 text-right">{t.px.toLocaleString('en-US')}</td>
                        <td className="py-1.5 text-right">{t.qty.toFixed(4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      ) : null}

      {/* Historical Study & Spearman IC */}
      {study && (
        <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-50">
                Estudio de Señales Intradía (Correlación de Spearman y Progreso de Muestra)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Archivos: {study.files.join(', ') || 'buffer en vivo'} · {study.n_rows} barras de 1 min (
                {study.coverage_days} días) · Tasa missed: {study.missed_pct} %
              </p>
            </div>
            <div className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300">
              {study.ready_for_walk_forward
                ? 'Muestra suficiente para walk-forward'
                : `${study.n_rows} / ${study.min_rows_required} filas (~${(study.min_rows_required / 1440).toFixed(1)} días requeridos)`}
            </div>
          </div>

          <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full bg-sky-500 transition-all" style={{ width: `${progressPct}%` }} />
          </div>

          {series.length > 1 && (
            <div>
              <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 mb-1.5">
                <span>Serie acumulada de precio Mid ({series.length} muestras recientes)</span>
                <span className="font-mono tabular-nums">
                  ${midMin.toLocaleString('en-US')} – ${midMax.toLocaleString('en-US')}
                </span>
              </div>
              <svg viewBox="0 0 520 120" className="w-full h-28">
                <polyline
                  fill="none"
                  className="stroke-sky-500 dark:stroke-sky-400"
                  strokeWidth={1.6}
                  points={midPts}
                />
              </svg>
            </div>
          )}

          {study.ic.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                    <th className="py-2 text-left font-medium">Señal</th>
                    <th className="py-2 text-right font-medium">Horizonte</th>
                    <th className="py-2 text-right font-medium">Muestras (sin solape)</th>
                    <th className="py-2 text-right font-medium">IC Spearman (ρ)</th>
                    <th className="py-2 text-right font-medium">p-valor</th>
                    <th className="py-2 text-right font-medium">p Bonferroni</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 font-mono tabular-nums">
                  {study.ic.slice(0, 12).map((row, idx) => (
                    <tr key={idx}>
                      <td className="py-2 font-sans text-slate-800 dark:text-slate-200">{row.feature}</td>
                      <td className="py-2 text-right">{row.h} min</td>
                      <td className="py-2 text-right">{row.n}</td>
                      <td
                        className={`py-2 text-right ${
                          row.ic >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {row.ic >= 0 ? '+' : ''}
                        {row.ic.toFixed(4)}
                      </td>
                      <td className="py-2 text-right">{row.p.toFixed(4)}</td>
                      <td className="py-2 text-right">{row.p_bonf.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Se necesitan al menos 12 muestras sin solapamiento por horizonte para calcular el IC de Spearman preliminar. Activa el colector para acumular datos en vivo.
            </div>
          )}

        </div>
      )}
    </div>
  );
};

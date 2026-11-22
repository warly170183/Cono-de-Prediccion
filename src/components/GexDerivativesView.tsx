import React, { useEffect, useState } from 'react';
import { OptionsPositioningPanel } from './OptionsPositioningPanel.tsx';
import type { AssetId, BiasAnalysisOutput, DerivativesReadings, GexOutput } from '../types.ts';

interface Props {
  asset: AssetId;
  readings: DerivativesReadings;
  gex: GexOutput | null;
  onSelectAsset: (a: AssetId) => void;
}

function fmtNum(v: number | null, suffix = '', decimals = 2): string {
  if (v === null || !Number.isFinite(v)) return '—';
  const sign = v > 0 && suffix.includes('Δ') ? '+' : '';
  return `${sign}${v.toFixed(decimals)}${suffix}`;
}

function zTone(z: number | null): string {
  if (z === null) return 'text-slate-500 dark:text-slate-400';
  if (z >= 2) return 'text-rose-600 dark:text-rose-400 font-semibold';
  if (z <= -2) return 'text-emerald-600 dark:text-emerald-400 font-semibold';
  return 'text-slate-700 dark:text-slate-200';
}

export const GexDerivativesView: React.FC<Props> = ({ asset, readings, gex, onSelectAsset }) => {
  const [hoveredStrike, setHoveredStrike] = useState<number | null>(null);
  const [hoveredSmile, setHoveredSmile] = useState<number | null>(null);

  const [bias, setBias] = useState<BiasAnalysisOutput | null>(null);
  const [biasLoading, setBiasLoading] = useState(true);
  const [biasError, setBiasError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBiasLoading(true);
    setBiasError(null);
    fetch(`/api/bias?asset=${asset}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('Error cargando análisis de sesgo diario');
        return (await res.json()) as BiasAnalysisOutput;
      })
      .then((json) => {
        if (!cancelled) setBias(json);
      })
      .catch((e) => {
        if (!cancelled) setBiasError(e instanceof Error ? e.message : 'Error de red');
      })
      .finally(() => {
        if (!cancelled) setBiasLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [asset]);

  const hoveredRow = gex?.by_strike.find((r) => r.strike === hoveredStrike) ?? null;
  const maxAbsStrikeGex = gex
    ? Math.max(1, ...gex.by_strike.map((r) => Math.max(Math.abs(r.call_gex_m), Math.abs(r.put_gex_m))))
    : 1;

  // Profile curve scales
  const profMinY = gex ? Math.min(0, ...gex.profile.map((p) => p.gex_m)) : -1;
  const profMaxY = gex ? Math.max(0, ...gex.profile.map((p) => p.gex_m)) : 1;
  const profSpanY = Math.max(1e-3, profMaxY - profMinY);

  const profPoints = gex
    ? gex.profile
        .map((p, i) => {
          const x = 16 + (i / Math.max(1, gex.profile.length - 1)) * 428;
          const y = 16 + 148 - ((p.gex_m - profMinY) / profSpanY) * 148;
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' ')
    : '';
  const zeroLineY = 16 + 148 - ((0 - profMinY) / profSpanY) * 148;

  // IV Smile scales
  const smile = gex?.iv_smile ?? [];
  const hoveredSmilePt = smile.find((s) => s.strike === hoveredSmile) ?? null;
  const smileVals = smile.flatMap((s) =>
    [s.avg_iv, s.call_iv, s.put_iv].filter((v): v is number => v !== null && Number.isFinite(v)),
  );
  const smileMinIv = smileVals.length ? Math.max(0, Math.min(...smileVals) - 2) : 20;
  const smileMaxIv = smileVals.length ? Math.max(...smileVals) + 2 : 80;
  const smileSpanIv = Math.max(1, smileMaxIv - smileMinIv);
  const smileMinK = smile.length ? smile[0].strike : 0;
  const smileMaxK = smile.length ? smile[smile.length - 1].strike : 1;
  const smileSpanK = Math.max(1, smileMaxK - smileMinK);

  const mapSmileX = (k: number) => 42 + ((k - smileMinK) / smileSpanK) * 576;
  const mapSmileY = (iv: number) => 16 + 150 - ((iv - smileMinIv) / smileSpanIv) * 150;

  const avgSmilePts = smile.map((p) => `${mapSmileX(p.strike).toFixed(1)},${mapSmileY(p.avg_iv).toFixed(1)}`).join(' ');
  const callSmilePts = smile
    .filter((p) => p.call_iv !== null)
    .map((p) => `${mapSmileX(p.strike).toFixed(1)},${mapSmileY(p.call_iv as number).toFixed(1)}`)
    .join(' ');
  const putSmilePts = smile
    .filter((p) => p.put_iv !== null)
    .map((p) => `${mapSmileX(p.strike).toFixed(1)},${mapSmileY(p.put_iv as number).toFixed(1)}`)
    .join(' ');

  return (
    <div className="space-y-6">
      {/* Derivatives Z-Score Matrix */}
      <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div>
            <h2 className="text-base font-display font-semibold text-slate-900 dark:text-slate-50">
              Lecturas de Derivados y Z-Scores (Ventana 90 días)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Contexto direccional sin sesgo aplicado al cono. Banderas extremas: |z funding| &gt; 2.0 o caída de OI &lt; -5 % en 24 h.
            </p>
          </div>
          <div className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300">
            Bandera funding:{' '}
            <span
              className={
                readings.flags.fund === 'neg'
                  ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                  : readings.flags.fund === 'pos'
                    ? 'text-rose-600 dark:text-rose-400 font-semibold'
                    : ''
              }
            >
              {readings.flags.fund === 'neg'
                ? 'Muy negativo (z < -2)'
                : readings.flags.fund === 'pos'
                  ? 'Muy positivo (z > +2)'
                  : readings.flags.fund === 'none'
                    ? 'Neutral'
                    : 'N/D'}
            </span>
            {' · '}
            Limpieza OI:{' '}
            <span className={readings.flags.oi_flush ? 'text-amber-600 dark:text-amber-400 font-semibold' : ''}>
              {readings.flags.oi_flush ? 'Activa (< -5 %)' : 'No'}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 font-mono tabular-nums">
          <div className="p-3.5 rounded-md bg-slate-50 dark:bg-slate-800/40 border border-slate-200/70 dark:border-slate-800">
            <div className="font-sans text-xs text-slate-500 dark:text-slate-400">Funding diario</div>
            <div className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">
              {fmtNum(readings.fund, ' bps/d')}
            </div>
            <div className={`mt-1 text-xs ${zTone(readings.fund_1d_z)}`}>
              z 1d: {fmtNum(readings.fund_1d_z)} · z 7d: {fmtNum(readings.fund_7d_z)}
            </div>
          </div>

          <div className="p-3.5 rounded-md bg-slate-50 dark:bg-slate-800/40 border border-slate-200/70 dark:border-slate-800">
            <div className="font-sans text-xs text-slate-500 dark:text-slate-400">Volatilidad Implícita (DVOL)</div>
            <div className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">
              {fmtNum(readings.dvol, ' %')}
            </div>
            <div className={`mt-1 text-xs ${zTone(readings.dvol_z)}`}>
              z: {fmtNum(readings.dvol_z)} · IV - RV: {fmtNum(readings.iv_rv, ' pts')}
            </div>
          </div>

          <div className="p-3.5 rounded-md bg-slate-50 dark:bg-slate-800/40 border border-slate-200/70 dark:border-slate-800">
            <div className="font-sans text-xs text-slate-500 dark:text-slate-400">Open Interest (OKX)</div>
            <div className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">
              {readings.oi_chg_1d !== null
                ? `${readings.oi_chg_1d >= 0 ? '+' : ''}${readings.oi_chg_1d.toFixed(2)} % (1 d)`
                : '—'}
            </div>
            <div className={`mt-1 text-xs ${zTone(readings.oi_z)}`}>
              7 d: {readings.oi_chg_7d !== null ? `${readings.oi_chg_7d >= 0 ? '+' : ''}${readings.oi_chg_7d.toFixed(2)} %` : '—'} · z: {fmtNum(readings.oi_z)}
            </div>
          </div>

          <div className="p-3.5 rounded-md bg-slate-50 dark:bg-slate-800/40 border border-slate-200/70 dark:border-slate-800">
            <div className="font-sans text-xs text-slate-500 dark:text-slate-400">Ratio Largos / Cortos</div>
            <div className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">
              {fmtNum(readings.ls)}
            </div>
            <div className={`mt-1 text-xs ${zTone(readings.ls_z)}`}>z 90d: {fmtNum(readings.ls_z)}</div>
          </div>
        </div>
      </div>

      {/* Deribit Options GEX */}
      {!gex ? (
        <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-8 text-center">
          <p className="text-sm text-slate-700 dark:text-slate-300">
            {asset.toUpperCase()} no dispone de cadena de opciones líquida en Deribit para cálculo de Gamma Exposure (GEX).
          </p>
          <div className="mt-4 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => onSelectAsset('btc')}
              className="px-4 py-2 text-xs font-medium rounded-md bg-sky-600 text-white hover:bg-sky-500 transition-colors cursor-pointer"
            >
              Ver GEX en BTC
            </button>
            <button
              type="button"
              onClick={() => onSelectAsset('eth')}
              className="px-4 py-2 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              Ver GEX en ETH
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* GEX KPI Row */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
              <div className="text-xs text-slate-500 dark:text-slate-400">Net GEX ({gex.asset})</div>
              <div
                className={`mt-1 text-xl font-display font-semibold font-mono tabular-nums ${
                  gex.net_gex_m >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {gex.net_gex_m >= 0 ? '+' : ''}
                {gex.net_gex_m.toFixed(2)} $M
              </div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                7d: {gex.net_gex_7d_m >= 0 ? '+' : ''}{gex.net_gex_7d_m.toFixed(2)} $M
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
              <div className="text-xs text-slate-500 dark:text-slate-400">Gamma Flip</div>
              <div className="mt-1 text-xl font-display font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-50">
                {gex.flip ? `$${gex.flip.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—'}
              </div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                Spot: ${gex.spot.toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
              <div className="text-xs text-slate-500 dark:text-slate-400">Call Wall</div>
              <div className="mt-1 text-xl font-display font-semibold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                {gex.call_wall ? `$${gex.call_wall.toLocaleString('en-US')}` : '—'}
              </div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Resistencia por gamma</div>
            </div>

            <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
              <div className="text-xs text-slate-500 dark:text-slate-400">Put Wall</div>
              <div className="mt-1 text-xl font-display font-semibold font-mono tabular-nums text-rose-600 dark:text-rose-400">
                {gex.put_wall ? `$${gex.put_wall.toLocaleString('en-US')}` : '—'}
              </div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Soporte / imán put</div>
            </div>

            <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-4 col-span-2 md:col-span-1">
              <div className="text-xs text-slate-500 dark:text-slate-400">Put / Call OI</div>
              <div className="mt-1 text-xl font-display font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-50">
                {gex.put_call_oi?.toFixed(3) ?? '—'}
              </div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                {gex.n_contracts.toLocaleString('es-ES')} contratos
              </div>
            </div>
          </div>

          {/* GEX by Strike + GEX vs Spot Profile */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div>
                  <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-50">
                    Gamma Exposure por Strike (±15 % del Spot)
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {gex.regime} · $M por cada 1 % de movimiento del spot.
                  </p>
                </div>
                {hoveredRow && (
                  <div className="text-xs font-mono tabular-nums text-slate-700 dark:text-slate-200">
                    Strike ${hoveredRow.strike.toLocaleString('en-US')} · Call +{hoveredRow.call_gex_m}M · Put{' '}
                    {hoveredRow.put_gex_m}M · Neto {hoveredRow.net_gex_m}M
                  </div>
                )}
              </div>

              <div className="overflow-x-auto">
                <svg viewBox="0 0 640 260" className="w-full h-auto">
                  <line x1={12} x2={628} y1={130} y2={130} className="stroke-slate-300 dark:stroke-slate-700" />
                  {gex.by_strike.map((row, idx) => {
                    const slotW = 616 / Math.max(1, gex.by_strike.length);
                    const barW = Math.max(4, slotW * 0.68);
                    const x = 12 + idx * slotW + (slotW - barW) / 2;
                    const callH = (Math.abs(row.call_gex_m) / maxAbsStrikeGex) * 105;
                    const putH = (Math.abs(row.put_gex_m) / maxAbsStrikeGex) * 105;
                    const isSpotNear =
                      Math.abs(row.strike - gex.spot) <=
                      Math.min(...gex.by_strike.map((r) => Math.abs(r.strike - gex.spot))) + 0.01;

                    return (
                      <g
                        key={row.strike}
                        onMouseEnter={() => setHoveredStrike(row.strike)}
                        onMouseLeave={() => setHoveredStrike(null)}
                        className="cursor-pointer"
                      >
                        <rect x={x} y={130 - callH} width={barW} height={callH} className="fill-emerald-500/80" />
                        <rect x={x} y={130} width={barW} height={putH} className="fill-rose-500/80" />
                        {isSpotNear && (
                          <line
                            x1={x + barW / 2}
                            x2={x + barW / 2}
                            y1={16}
                            y2={244}
                            className="stroke-sky-500"
                            strokeWidth={1.5}
                            strokeDasharray="3 3"
                          />
                        )}
                        {(idx % Math.max(1, Math.floor(gex.by_strike.length / 7)) === 0 || isSpotNear) && (
                          <text
                            x={x + barW / 2}
                            y={254}
                            textAnchor="middle"
                            className="fill-slate-500 dark:fill-slate-400 text-[9px] font-mono tabular-nums"
                          >
                            {row.strike >= 1000 ? `${(row.strike / 1000).toFixed(0)}k` : row.strike}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </svg>
              </div>
            </div>

            {/* GEX vs Spot Profile */}
            <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-5 flex flex-col justify-between">
              <div>
                <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-50">
                  Perfil GEX vs Precio Spot (±25 %)
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Cruce por cero marca el nivel Gamma Flip.
                </p>
              </div>

              <svg viewBox="0 0 460 190" className="w-full h-auto my-3">
                <line
                  x1={16}
                  x2={444}
                  y1={zeroLineY}
                  y2={zeroLineY}
                  className="stroke-slate-300 dark:stroke-slate-700"
                  strokeDasharray="3 3"
                />
                <polyline
                  fill="none"
                  className="stroke-sky-500 dark:stroke-sky-400"
                  strokeWidth={2.2}
                  points={profPoints}
                />
              </svg>

              <div className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400 flex justify-between border-t border-slate-200 dark:border-slate-800 pt-2">
                <span>${gex.profile[0]?.spot.toLocaleString('en-US')}</span>
                <span>Flip: {gex.flip ? `$${gex.flip.toLocaleString('en-US')}` : 'N/A'}</span>
                <span>${gex.profile[gex.profile.length - 1]?.spot.toLocaleString('en-US')}</span>
              </div>
            </div>
          </div>

          {/* GEX Term Structure & IV Smile */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Term Structure Buckets */}
            <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-5">
              <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-50">
                Estructura Temporal del GEX por Vencimiento
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 mb-3">
                Desglose del gamma neto según días al vencimiento (≤ 7 d concentra el efecto pin a corto plazo).
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono tabular-nums">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                      <th className="py-2 text-left font-medium font-sans">Vencimiento</th>
                      <th className="py-2 text-right font-medium">Call GEX</th>
                      <th className="py-2 text-right font-medium">Put GEX</th>
                      <th className="py-2 text-right font-medium">Net GEX</th>
                      <th className="py-2 text-right font-medium">Contratos</th>
                      <th className="py-2 text-right font-medium">OI Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                    {gex.term_buckets.map((b) => (
                      <tr key={b.bucket} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                        <td className="py-2.5 font-sans font-medium text-slate-800 dark:text-slate-200">{b.bucket}</td>
                        <td className="py-2.5 text-right text-emerald-600 dark:text-emerald-400">
                          +{b.call_gex_m.toFixed(2)} $M
                        </td>
                        <td className="py-2.5 text-right text-rose-600 dark:text-rose-400">
                          {b.put_gex_m.toFixed(2)} $M
                        </td>
                        <td
                          className={`py-2.5 text-right font-semibold ${
                            b.net_gex_m >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {b.net_gex_m >= 0 ? '+' : ''}
                          {b.net_gex_m.toFixed(2)} $M
                        </td>
                        <td className="py-2.5 text-right text-slate-600 dark:text-slate-300">
                          {b.n_contracts.toLocaleString('es-ES')}
                        </td>
                        <td className="py-2.5 text-right text-slate-500 dark:text-slate-400">
                          {b.oi_contracts.toLocaleString('es-ES')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* IV Smile */}
            <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div>
                  <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-50">
                    Sonrisa de Volatilidad Implícita (Mark IV ±20 % Spot)
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Skew entre puts (rojo), calls (verde) y media ponderada por OI (azul).
                  </p>
                </div>
                {hoveredSmilePt && (
                  <div className="text-xs font-mono tabular-nums text-slate-700 dark:text-slate-200">
                    K ${hoveredSmilePt.strike.toLocaleString('en-US')} · Media {hoveredSmilePt.avg_iv.toFixed(1)}%
                  </div>
                )}
              </div>

              {smile.length > 1 ? (
                <>
                  <svg viewBox="0 0 640 190" className="w-full h-auto">
                    {/* Horizontal grid */}
                    {[0, 0.5, 1].map((frac) => {
                      const y = 16 + frac * 150;
                      const ivVal = smileMaxIv - frac * smileSpanIv;
                      return (
                        <g key={frac}>
                          <line x1={42} x2={618} y1={y} y2={y} className="stroke-slate-200 dark:stroke-slate-800" />
                          <text
                            x={36}
                            y={y + 3}
                            textAnchor="end"
                            className="fill-slate-500 dark:fill-slate-400 text-[9px] font-mono tabular-nums"
                          >
                            {ivVal.toFixed(0)}%
                          </text>
                        </g>
                      );
                    })}

                    {/* Spot vertical */}
                    {gex.spot >= smileMinK && gex.spot <= smileMaxK && (
                      <line
                        x1={mapSmileX(gex.spot)}
                        x2={mapSmileX(gex.spot)}
                        y1={16}
                        y2={166}
                        className="stroke-slate-400 dark:stroke-slate-600"
                        strokeDasharray="3 3"
                      />
                    )}

                    {putSmilePts && (
                      <polyline
                        fill="none"
                        className="stroke-rose-500/80"
                        strokeWidth={1.5}
                        strokeDasharray="3 2"
                        points={putSmilePts}
                      />
                    )}
                    {callSmilePts && (
                      <polyline
                        fill="none"
                        className="stroke-emerald-500/80"
                        strokeWidth={1.5}
                        strokeDasharray="3 2"
                        points={callSmilePts}
                      />
                    )}
                    <polyline
                      fill="none"
                      className="stroke-sky-500 dark:stroke-sky-400"
                      strokeWidth={2.2}
                      points={avgSmilePts}
                    />

                    {smile.map((pt, i) => {
                      const cx = mapSmileX(pt.strike);
                      const cy = mapSmileY(pt.avg_iv);
                      return (
                        <g
                          key={pt.strike}
                          onMouseEnter={() => setHoveredSmile(pt.strike)}
                          onMouseLeave={() => setHoveredSmile(null)}
                          className="cursor-pointer"
                        >
                          <circle cx={cx} cy={cy} r={3} className="fill-sky-500 dark:fill-sky-400" />
                          {i % Math.max(1, Math.floor(smile.length / 6)) === 0 && (
                            <text
                              x={cx}
                              y={182}
                              textAnchor="middle"
                              className="fill-slate-500 dark:fill-slate-400 text-[9px] font-mono tabular-nums"
                            >
                              {pt.strike >= 1000 ? `${(pt.strike / 1000).toFixed(0)}k` : pt.strike}
                            </text>
                          )}
                        </g>
                      );
                    })}
                  </svg>
                </>
              ) : (
                <div className="py-10 text-center text-xs text-slate-500 dark:text-slate-400">
                  Insuficientes strikes con Mark IV líquido para construir la sonrisa.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {gex && <OptionsPositioningPanel gex={gex} />}

      {/* bias.py Parity Section: Models A/B + 8 Daily Funding/OI Rules */}
      <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-display font-semibold text-slate-900 dark:text-slate-50">
              Análisis Direccional Diario y Reglas Funding/OI (bias.py)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Modelos logísticos L2 fuera de muestra y auditoría de las 8 reglas históricas con corrección Bonferroni ({bias ? `${bias.n_days} días` : 'cargando…'}).
            </p>
          </div>
        </div>

        {biasLoading ? (
          <div className="h-32 rounded-md bg-slate-100 dark:bg-slate-800/50 animate-pulse" />
        ) : biasError ? (
          <div className="text-xs text-rose-600 dark:text-rose-400">{biasError}</div>
        ) : bias ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 font-mono tabular-nums">
              <div className="p-4 rounded-md bg-slate-50 dark:bg-slate-800/40 border border-slate-200/70 dark:border-slate-800">
                <div className="font-sans text-xs text-slate-500 dark:text-slate-400">
                  Probabilidad P(alcista) a 1 día · Base histórica {bias.p_up.base1 !== null ? `${bias.p_up.base1.toFixed(1)} %` : '—'}
                </div>
                <div className="mt-2 flex items-baseline gap-6">
                  <div>
                    <div className="font-sans text-[11px] text-slate-500 dark:text-slate-400">Modelo A (Precio / Vol)</div>
                    <div className="text-lg font-semibold text-slate-900 dark:text-slate-50">
                      {bias.p_up.A1 !== null ? `${bias.p_up.A1.toFixed(1)} %` : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="font-sans text-[11px] text-slate-500 dark:text-slate-400">Modelo B (+ Derivados)</div>
                    <div className="text-lg font-semibold text-sky-600 dark:text-sky-400">
                      {bias.p_up.B1 !== null ? `${bias.p_up.B1.toFixed(1)} %` : '—'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-md bg-slate-50 dark:bg-slate-800/40 border border-slate-200/70 dark:border-slate-800">
                <div className="font-sans text-xs text-slate-500 dark:text-slate-400">
                  Probabilidad P(alcista) a 3 días · Base histórica {bias.p_up.base3 !== null ? `${bias.p_up.base3.toFixed(1)} %` : '—'}
                </div>
                <div className="mt-2 flex items-baseline gap-6">
                  <div>
                    <div className="font-sans text-[11px] text-slate-500 dark:text-slate-400">Modelo A (Precio / Vol)</div>
                    <div className="text-lg font-semibold text-slate-900 dark:text-slate-50">
                      {bias.p_up.A3 !== null ? `${bias.p_up.A3.toFixed(1)} %` : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="font-sans text-[11px] text-slate-500 dark:text-slate-400">Modelo B (+ Derivados)</div>
                    <div className="text-lg font-semibold text-sky-600 dark:text-sky-400">
                      {bias.p_up.B3 !== null ? `${bias.p_up.B3.toFixed(1)} %` : '—'}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                    <th className="py-2 text-left font-medium">Regla Funding / OI</th>
                    <th className="py-2 text-right font-medium">Horiz.</th>
                    <th className="py-2 text-right font-medium">n</th>
                    <th className="py-2 text-right font-medium">Acierto</th>
                    <th className="py-2 text-right font-medium">Neto % [IC 95 %]</th>
                    <th className="py-2 text-right font-medium">p-valor</th>
                    <th className="py-2 text-right font-medium">p Bonf.</th>
                    <th className="py-2 text-right font-medium">Estado hoy</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 font-mono tabular-nums">
                  {bias.rules.map((r, idx) => (
                    <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                      <td className="py-2 font-sans text-slate-800 dark:text-slate-200">{r.rule}</td>
                      <td className="py-2 text-right">{r.h} d</td>
                      <td className="py-2 text-right">{r.n}</td>
                      <td className="py-2 text-right">{r.hit_pct !== null ? `${r.hit_pct.toFixed(1)} %` : '—'}</td>
                      <td
                        className={`py-2 text-right ${
                          r.net_pct !== null && r.net_pct > 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : r.net_pct !== null && r.net_pct < 0
                              ? 'text-rose-600 dark:text-rose-400'
                              : 'text-slate-500'
                        }`}
                      >
                        {r.net_pct !== null
                          ? `${r.net_pct >= 0 ? '+' : ''}${r.net_pct.toFixed(2)} % ${
                              r.ci ? `[${r.ci[0].toFixed(2)}; ${r.ci[1].toFixed(2)}]` : ''
                            }`
                          : '—'}
                      </td>
                      <td className="py-2 text-right">{r.p !== null ? r.p.toFixed(3) : '—'}</td>
                      <td className="py-2 text-right">{r.p_bonf !== null ? r.p_bonf.toFixed(3) : '—'}</td>
                      <td className="py-2 text-right font-sans">
                        {r.active_now ? (
                          <span className="text-amber-600 dark:text-amber-400 font-semibold">Activa</span>
                        ) : (
                          <span className="text-slate-400">Inactiva</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
};

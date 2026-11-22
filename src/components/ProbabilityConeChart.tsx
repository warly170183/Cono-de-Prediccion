import React, { useMemo, useState } from 'react';
import type { ConeBlock, OptionsConeOutput } from '../types.ts';

interface GexOverlay {
  callWall: number | null;
  putWall: number | null;
  flip: number | null;
}

interface Props {
  block: ConeBlock;
  showEnsemble: boolean;
  showPaths: boolean;
  showOptionsCone?: boolean;
  optionsCone?: OptionsConeOutput | null;
  gexOverlay?: GexOverlay | null;
}

function fmtPrice(v: number): string {
  if (v >= 1000) return `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  if (v >= 100) return `$${v.toLocaleString('en-US', { maximumFractionDigits: 1 })}`;
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtTime(ts: number, label: '1H' | '1D'): string {
  const d = new Date(ts);
  if (label === '1H') {
    return d.toLocaleString('es-ES', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('es-ES', { month: 'short', day: 'numeric' });
}

export const ProbabilityConeChart: React.FC<Props> = ({
  block,
  showEnsemble,
  showPaths,
  showOptionsCone = false,
  optionsCone = null,
  gexOverlay,
}) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const histLen = Math.min(block.candles.length, block.label === '1H' ? 72 : 45);
  const histCandles = useMemo(() => block.candles.slice(-histLen), [block.candles, histLen]);
  const totalSteps = histCandles.length + block.H;

  const width = 920;
  const height = 390;
  const pad = { top: 22, right: 82, bottom: 32, left: 16 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const { yMin, yMax, yTicks } = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of histCandles) {
      if (c[3] < lo) lo = c[3];
      if (c[2] > hi) hi = c[2];
    }
    for (const q of ['5', '95']) {
      for (const v of block.cone[q] ?? []) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    if (showEnsemble && block.cone_ens) {
      for (const q of ['5', '95']) {
        for (const v of block.cone_ens[q] ?? []) {
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
    }
    if (showOptionsCone && block.label === '1H' && optionsCone) {
      for (const hKey of ['24', '72'] as const) {
        for (const qKey of ['5', '95']) {
          const val = optionsCone.cone[hKey]?.prices[qKey];
          if (val !== undefined) {
            if (val < lo) lo = val;
            if (val > hi) hi = val;
          }
        }
      }
    }
    if (gexOverlay) {
      for (const lvl of [gexOverlay.callWall, gexOverlay.putWall, gexOverlay.flip]) {
        if (lvl !== null && Math.abs(lvl / block.spot - 1) <= 0.22) {
          if (lvl < lo) lo = lvl;
          if (lvl > hi) hi = lvl;
        }
      }
    }
    const span = Math.max(1e-6, hi - lo);
    const minP = lo - span * 0.06;
    const maxP = hi + span * 0.06;
    const ticks: number[] = [];
    for (let i = 0; i <= 4; i++) {
      ticks.push(minP + ((maxP - minP) * i) / 4);
    }
    return { yMin: minP, yMax: maxP, yTicks: ticks };
  }, [histCandles, block.cone, block.cone_ens, block.spot, block.label, showEnsemble, showOptionsCone, optionsCone, gexOverlay]);

  const xScale = (idx: number) => pad.left + (idx / Math.max(1, totalSteps - 1)) * plotW;
  const yScale = (price: number) =>
    pad.top + plotH - ((price - yMin) / Math.max(1e-9, yMax - yMin)) * plotH;

  const anchorXIdx = histCandles.length - 1;

  const makeAreaPath = (upper: number[], lower: number[]) => {
    if (!upper.length || !lower.length) return '';
    const topPts = upper.map((v, k) => `${xScale(anchorXIdx + k).toFixed(1)},${yScale(v).toFixed(1)}`);
    const botPts = [...lower]
      .reverse()
      .map((v, k) => `${xScale(anchorXIdx + (lower.length - 1 - k)).toFixed(1)},${yScale(v).toFixed(1)}`);
    return `M ${topPts.join(' L ')} L ${botPts.join(' L ')} Z`;
  };

  const makeLinePath = (vals: number[], startIdx: number) => {
    if (!vals.length) return '';
    return vals
      .map((v, k) => `${k === 0 ? 'M' : 'L'} ${xScale(startIdx + k).toFixed(1)},${yScale(v).toFixed(1)}`)
      .join(' ');
  };

  const histCloseLine = useMemo(
    () => makeLinePath(histCandles.map((c) => c[4]), 0),
    [histCandles, yMin, yMax],
  );

  const area90 = useMemo(
    () => makeAreaPath(block.cone['95'] ?? [], block.cone['5'] ?? []),
    [block.cone, anchorXIdx, yMin, yMax],
  );
  const area50 = useMemo(
    () => makeAreaPath(block.cone['75'] ?? [], block.cone['25'] ?? []),
    [block.cone, anchorXIdx, yMin, yMax],
  );

  const p50Line = useMemo(
    () => makeLinePath(block.cone['50'] ?? [], anchorXIdx),
    [block.cone, anchorXIdx, yMin, yMax],
  );

  const ensUpperLine = useMemo(
    () => (showEnsemble && block.cone_ens ? makeLinePath(block.cone_ens['95'] ?? [], anchorXIdx) : ''),
    [showEnsemble, block.cone_ens, anchorXIdx, yMin, yMax],
  );
  const ensLowerLine = useMemo(
    () => (showEnsemble && block.cone_ens ? makeLinePath(block.cone_ens['5'] ?? [], anchorXIdx) : ''),
    [showEnsemble, block.cone_ens, anchorXIdx, yMin, yMax],
  );

  // Smooth sqrt(t) interpolated curve through (0, spot), (24h, SVI), (72h, SVI)
  const optArrays = useMemo(() => {
    if (!showOptionsCone || block.label !== '1H' || !optionsCone) return null;
    const c24 = optionsCone.cone['24'];
    const c72 = optionsCone.cone['72'];
    if (!c24 || !c72) return null;
    const interpSeries = (qKey: string) => {
      const p0 = block.spot;
      const l24 = Math.log(c24.prices[qKey] / p0);
      const l72 = Math.log(c72.prices[qKey] / p0);
      const out = new Array<number>(block.H + 1);
      for (let h = 0; h <= block.H; h++) {
        if (h <= 24) {
          const w = Math.sqrt(h / 24);
          out[h] = p0 * Math.exp(l24 * w);
        } else {
          const w = (Math.sqrt(h) - Math.sqrt(24)) / (Math.sqrt(72) - Math.sqrt(24));
          out[h] = p0 * Math.exp(l24 + (l72 - l24) * w);
        }
      }
      return out;
    };
    return { p5: interpSeries('5'), p95: interpSeries('95') };
  }, [showOptionsCone, block.label, block.H, block.spot, optionsCone]);

  const optUpperLine = useMemo(
    () => (optArrays ? makeLinePath(optArrays.p95, anchorXIdx) : ''),
    [optArrays, anchorXIdx, yMin, yMax],
  );
  const optLowerLine = useMemo(
    () => (optArrays ? makeLinePath(optArrays.p5, anchorXIdx) : ''),
    [optArrays, anchorXIdx, yMin, yMax],
  );

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * width;
    const norm = (relX - pad.left) / plotW;
    const idx = Math.round(norm * (totalSteps - 1));
    if (idx >= 0 && idx < totalSteps) {
      setHoverIdx(idx);
    } else {
      setHoverIdx(null);
    }
  };

  const hoveredInfo = useMemo(() => {
    if (hoverIdx === null) return null;
    if (hoverIdx < anchorXIdx) {
      const c = histCandles[hoverIdx];
      return {
        isForecast: false,
        ts: c[0],
        price: c[4],
        high: c[2],
        low: c[3],
      };
    }
    const step = hoverIdx - anchorXIdx;
    const ts = block.last_ts + step * block.step_ms;
    return {
      isForecast: true,
      step,
      ts,
      p5: block.cone['5']?.[step],
      p25: block.cone['25']?.[step],
      p50: block.cone['50']?.[step],
      p75: block.cone['75']?.[step],
      p95: block.cone['95']?.[step],
      ens5: block.cone_ens?.['5']?.[step],
      ens95: block.cone_ens?.['95']?.[step],
      opt5: optArrays?.p5[step],
      opt95: optArrays?.p95[step],
    };
  }, [hoverIdx, anchorXIdx, histCandles, block, optArrays]);

  const xTickIndices = [0, Math.floor(anchorXIdx / 2), anchorXIdx, anchorXIdx + Math.floor(block.H / 2), totalSteps - 1];

  const gexLevels = useMemo(() => {
    if (!gexOverlay) return [];
    const list: Array<{ label: string; value: number; stroke: string; text: string }> = [];
    if (gexOverlay.callWall !== null && gexOverlay.callWall >= yMin && gexOverlay.callWall <= yMax) {
      list.push({
        label: `Call Wall ${fmtPrice(gexOverlay.callWall)}`,
        value: gexOverlay.callWall,
        stroke: 'stroke-emerald-500/75',
        text: 'fill-emerald-600 dark:fill-emerald-400',
      });
    }
    if (gexOverlay.putWall !== null && gexOverlay.putWall >= yMin && gexOverlay.putWall <= yMax) {
      list.push({
        label: `Put Wall ${fmtPrice(gexOverlay.putWall)}`,
        value: gexOverlay.putWall,
        stroke: 'stroke-rose-500/75',
        text: 'fill-rose-600 dark:fill-rose-400',
      });
    }
    if (gexOverlay.flip !== null && gexOverlay.flip >= yMin && gexOverlay.flip <= yMax) {
      list.push({
        label: `Gamma Flip ${fmtPrice(gexOverlay.flip)}`,
        value: gexOverlay.flip,
        stroke: 'stroke-amber-500/80',
        text: 'fill-amber-600 dark:fill-amber-400',
      });
    }
    return list;
  }, [gexOverlay, yMin, yMax]);

  return (
    <div className="relative w-full select-none">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto overflow-visible cursor-crosshair"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {/* Horizontal Grid Lines & Y-Axis Labels */}
        {yTicks.map((tick, i) => {
          const y = yScale(tick);
          return (
            <g key={i}>
              <line
                x1={pad.left}
                x2={width - pad.right}
                y1={y}
                y2={y}
                className="stroke-slate-200 dark:stroke-slate-800/80"
                strokeDasharray="2 3"
              />
              <text
                x={width - pad.right + 8}
                y={y + 4}
                className="fill-slate-500 dark:fill-slate-400 text-[11px] font-mono tabular-nums"
              >
                {fmtPrice(tick)}
              </text>
            </g>
          );
        })}

        {/* GEX Overlays (Call Wall, Put Wall, Gamma Flip) */}
        {gexLevels.map((lvl, idx) => {
          const y = yScale(lvl.value);
          return (
            <g key={`${lvl.label}-${idx}`}>
              <line
                x1={pad.left}
                x2={width - pad.right}
                y1={y}
                y2={y}
                className={lvl.stroke}
                strokeWidth={1.2}
                strokeDasharray="6 4"
              />
              <text
                x={pad.left + 6}
                y={y - 4}
                className={`${lvl.text} text-[10px] font-mono tabular-nums font-medium`}
              >
                {lvl.label}
              </text>
            </g>
          );
        })}

        {/* Anchor "Now" Vertical Line */}
        <line
          x1={xScale(anchorXIdx)}
          x2={xScale(anchorXIdx)}
          y1={pad.top}
          y2={height - pad.bottom}
          className="stroke-slate-400/60 dark:stroke-slate-600"
          strokeDasharray="4 4"
        />

        {/* Probability Cones (90% and 50%) */}
        <path d={area90} className="fill-sky-500/12 dark:fill-sky-400/12" />
        <path d={area50} className="fill-sky-500/24 dark:fill-sky-400/22" />

        {/* Sample Monte Carlo Paths */}
        {showPaths &&
          block.sample_paths.slice(0, 18).map((p, i) => (
            <path
              key={i}
              d={makeLinePath(p, anchorXIdx)}
              fill="none"
              className="stroke-slate-400/25 dark:stroke-slate-500/25"
              strokeWidth={1}
            />
          ))}

        {/* Historical Candlesticks + Close Line */}
        {histCandles.map((c, idx) => {
          const x = xScale(idx);
          const yH = yScale(c[2]);
          const yL = yScale(c[3]);
          const yO = yScale(c[1]);
          const yC = yScale(c[4]);
          const isUp = c[4] >= c[1];
          return (
            <g key={c[0]}>
              <line
                x1={x}
                x2={x}
                y1={yH}
                y2={yL}
                className={isUp ? 'stroke-emerald-500/45' : 'stroke-rose-500/45'}
                strokeWidth={1}
              />
              <rect
                x={x - 1.8}
                y={Math.min(yO, yC)}
                width={3.6}
                height={Math.max(1.5, Math.abs(yC - yO))}
                className={isUp ? 'fill-emerald-500/70' : 'fill-rose-500/70'}
              />
            </g>
          );
        })}

        <path
          d={histCloseLine}
          fill="none"
          className="stroke-slate-700 dark:stroke-slate-200"
          strokeWidth={1.6}
        />

        {/* Cone Median (P50) & Outer Boundaries */}
        <path
          d={p50Line}
          fill="none"
          className="stroke-sky-600 dark:stroke-sky-400"
          strokeWidth={2}
          strokeDasharray="5 3"
        />
        <path
          d={makeLinePath(block.cone['95'] ?? [], anchorXIdx)}
          fill="none"
          className="stroke-sky-500/50 dark:stroke-sky-400/50"
          strokeWidth={1}
        />
        <path
          d={makeLinePath(block.cone['5'] ?? [], anchorXIdx)}
          fill="none"
          className="stroke-sky-500/50 dark:stroke-sky-400/50"
          strokeWidth={1}
        />

        {/* Optional Ensemble GARCH+HAR 90% Envelope */}
        {showEnsemble && block.cone_ens && (
          <>
            <path
              d={ensUpperLine}
              fill="none"
              className="stroke-amber-500 dark:stroke-amber-400"
              strokeWidth={1.5}
              strokeDasharray="3 3"
            />
            <path
              d={ensLowerLine}
              fill="none"
              className="stroke-amber-500 dark:stroke-amber-400"
              strokeWidth={1.5}
              strokeDasharray="3 3"
            />
          </>
        )}

        {/* Optional SVI + Breeden-Litzenberger Risk-Neutral Options Cone */}
        {optArrays && (
          <>
            <path
              d={optUpperLine}
              fill="none"
              className="stroke-violet-500 dark:stroke-violet-400"
              strokeWidth={1.6}
              strokeDasharray="6 3"
            />
            <path
              d={optLowerLine}
              fill="none"
              className="stroke-violet-500 dark:stroke-violet-400"
              strokeWidth={1.6}
              strokeDasharray="6 3"
            />
          </>
        )}

        {/* Spot Marker */}
        <circle
          cx={xScale(anchorXIdx)}
          cy={yScale(block.spot)}
          r={4}
          className="fill-sky-500 stroke-white dark:stroke-slate-950"
          strokeWidth={1.5}
        />

        {/* X-Axis Timestamps */}
        {xTickIndices.map((idx, i) => {
          const ts =
            idx <= anchorXIdx
              ? histCandles[idx]?.[0] ?? block.last_ts
              : block.last_ts + (idx - anchorXIdx) * block.step_ms;
          return (
            <text
              key={i}
              x={xScale(idx)}
              y={height - 8}
              textAnchor={i === 0 ? 'start' : i === xTickIndices.length - 1 ? 'end' : 'middle'}
              className="fill-slate-500 dark:fill-slate-400 text-[11px] font-mono tabular-nums"
            >
              {idx === anchorXIdx ? 'Ahora' : fmtTime(ts, block.label)}
            </text>
          );
        })}

        {/* Hover Crosshair */}
        {hoverIdx !== null && (
          <line
            x1={xScale(hoverIdx)}
            x2={xScale(hoverIdx)}
            y1={pad.top}
            y2={height - pad.bottom}
            className="stroke-slate-500/60 dark:stroke-slate-400/50"
            strokeWidth={1}
          />
        )}
      </svg>

      {/* Interactive Tooltip Readout Bar */}
      <div className="mt-2 min-h-[28px] flex flex-wrap items-center gap-x-5 gap-y-1 text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300 border-t border-slate-200 dark:border-slate-800/80 pt-2">
        {hoveredInfo ? (
          hoveredInfo.isForecast ? (
            <>
              <span className="font-sans font-medium text-slate-900 dark:text-slate-100">
                +{hoveredInfo.step}{block.label === '1H' ? 'h' : 'd'} · {fmtTime(hoveredInfo.ts, block.label)}
              </span>
              <span>P5: {fmtPrice(hoveredInfo.p5 ?? 0)}</span>
              <span>P25: {fmtPrice(hoveredInfo.p25 ?? 0)}</span>
              <span className="text-sky-600 dark:text-sky-400 font-semibold">
                P50: {fmtPrice(hoveredInfo.p50 ?? 0)}
              </span>
              <span>P75: {fmtPrice(hoveredInfo.p75 ?? 0)}</span>
              <span>P95: {fmtPrice(hoveredInfo.p95 ?? 0)}</span>
              {showEnsemble && hoveredInfo.ens5 !== undefined && hoveredInfo.ens95 !== undefined && (
                <span className="text-amber-600 dark:text-amber-400">
                  Ensamble 90%: {fmtPrice(hoveredInfo.ens5)} – {fmtPrice(hoveredInfo.ens95)}
                </span>
              )}
              {optArrays && hoveredInfo.opt5 !== undefined && hoveredInfo.opt95 !== undefined && (
                <span className="text-violet-600 dark:text-violet-400">
                  Opciones SVI 90%: {fmtPrice(hoveredInfo.opt5)} – {fmtPrice(hoveredInfo.opt95)}
                </span>
              )}
            </>
          ) : (
            <>
              <span className="font-sans font-medium text-slate-900 dark:text-slate-100">
                Histórico · {fmtTime(hoveredInfo.ts, block.label)}
              </span>
              <span>Cierre: {fmtPrice(hoveredInfo.price ?? 0)}</span>
              <span>Máx: {fmtPrice(hoveredInfo.high ?? 0)}</span>
              <span>Mín: {fmtPrice(hoveredInfo.low ?? 0)}</span>
            </>
          )
        ) : (
          <span className="font-sans text-slate-500 dark:text-slate-400">
            Mueve el cursor sobre el gráfico para inspeccionar los cuantiles del cono GJR-GARCH(1,1) ({block.H}{' '}
            {block.label === '1H' ? 'horas' : 'días'} vista)
          </span>
        )}
      </div>
    </div>
  );
};

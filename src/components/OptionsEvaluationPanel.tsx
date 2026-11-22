import React from 'react';
import { Download } from 'lucide-react';
import { DataStatusBar } from './DataStatusBar.tsx';
import type { TradeOptionEvaluation, TradeOptionGroupStats } from '../types.ts';

interface Props {
  evaluation: TradeOptionEvaluation | undefined;
}

const fmt = (v: number | null, d = 1, suffix = ' %') => (v === null ? '—' : `${v.toFixed(d)}${suffix}`);
const signed = (v: number | null) => (v === null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)} %`);

const VERDICT_STYLES: Record<TradeOptionEvaluation['verdict']['level'], string> = {
  insufficient: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200',
  no_edge: 'border-slate-300 bg-slate-50 text-slate-800 dark:border-slate-600 dark:bg-slate-800/60 dark:text-slate-200',
  edge: 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200',
  worse: 'border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200',
};

const Kpi: React.FC<{ label: string; value: string; hint?: string }> = ({ label, value, hint }) => (
  <div className="rounded-md border border-slate-200 dark:border-slate-800 p-3">
    <div className="text-[11px] text-slate-500 dark:text-slate-400">{label}</div>
    <div className="mt-0.5 text-lg font-display font-semibold tabular-nums text-slate-900 dark:text-slate-50">{value}</div>
    {hint && <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{hint}</div>}
  </div>
);


interface Series { color: string; dash?: boolean; points: number[] }

/** Mini gráfico de líneas en SVG (sin dependencias). */
const MiniChart: React.FC<{ series: Series[]; zeroLine?: boolean; fmtY: (v: number) => string; empty: string }> = ({ series, zeroLine, fmtY, empty }) => {
  const all = series.flatMap((s) => s.points);
  if (all.length < 2) {
    return <div className="h-28 flex items-center justify-center text-[11px] text-slate-500 dark:text-slate-400">{empty}</div>;
  }
  const W = 320;
  const H = 110;
  let lo = Math.min(...all, zeroLine ? 0 : Infinity);
  let hi = Math.max(...all, zeroLine ? 0 : -Infinity);
  if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
  const pad = (hi - lo) * 0.1;
  lo -= pad; hi += pad;
  const n = Math.max(...series.map((s) => s.points.length));
  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * (W - 8) + 4);
  const y = (v: number) => H - 4 - ((v - lo) / (hi - lo)) * (H - 8);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-28" role="img">
      {zeroLine && <line x1="0" x2={W} y1={y(0)} y2={y(0)} stroke="currentColor" strokeOpacity="0.25" strokeDasharray="3 3" />}
      {series.map((s, k) => (
        <polyline key={k} fill="none" stroke={s.color} strokeWidth="1.6" strokeDasharray={s.dash ? '4 3' : undefined}
          points={s.points.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')} />
      ))}
      <text x="4" y="10" fontSize="9" fill="currentColor" fillOpacity="0.6">{fmtY(hi)}</text>
      <text x="4" y={H - 2} fontSize="9" fill="currentColor" fillOpacity="0.6">{fmtY(lo)}</text>
    </svg>
  );
};

const Section: React.FC<{ title: string; rows: TradeOptionGroupStats[] }> = ({ title, rows }) => {
  if (!rows.length) return null;
  return (
    <>
      <tr>
        <td colSpan={7} className="pt-3 pb-1 text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-sans">
          {title}
        </td>
      </tr>
      {rows.map((g) => (
        <tr key={`${title}-${g.key}`} className="border-t border-slate-100 dark:border-slate-800/60">
          <td className="py-1.5 pr-2 font-sans text-slate-800 dark:text-slate-200 whitespace-nowrap">{g.label}</td>
          <td className="py-1.5 text-right">{g.n}</td>
          <td className="py-1.5 text-right whitespace-nowrap">
            {g.tpHit}/{g.slHit}/{g.expired}
          </td>
          <td className="py-1.5 text-right whitespace-nowrap">
            {fmt(g.tpRatePct)} <span className="text-slate-400">({fmt(g.predProbTpPct, 0, '')} pred.)</span>
          </td>
          <td className="py-1.5 text-right">{fmt(g.mirrorTpRatePct)}</td>
          <td className="py-1.5 text-right whitespace-nowrap">
            {fmt(g.dirIndepAccPct)} <span className="text-slate-400">(n={g.dirIndepN})</span>
          </td>
          <td className="py-1.5 text-right">{signed(g.avgPnlPct)}</td>
        </tr>
      ))}
    </>
  );
};

export const OptionsEvaluationPanel: React.FC<Props> = ({ evaluation }) => {
  if (!evaluation) return null;
  const o = evaluation.overall;

  return (
    <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-50">
            Evaluación: ¿acierta la app?
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Cada opción generada se guarda en local y se compara con las velas posteriores hasta su horizonte (24 h / 72 h).
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href="/api/trade-options/export?format=csv"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <Download className="w-3.5 h-3.5" /> CSV
          </a>
          <a
            href="/api/trade-options/export?format=jsonl"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <Download className="w-3.5 h-3.5" /> JSONL
          </a>
        </div>
      </div>

      <DataStatusBar />

      <div className={`rounded-md border px-3 py-2 text-xs ${VERDICT_STYLES[evaluation.verdict.level]}`}>
        {evaluation.verdict.text}
      </div>

      <div>
        <div className="flex justify-between text-[11px] text-slate-500 dark:text-slate-400 mb-1">
          <span>Progreso hacia un veredicto fiable</span>
          <span className="tabular-nums">
            {evaluation.progress.n} / {evaluation.progress.needed} independientes
            {evaluation.progress.etaDays !== null && evaluation.progress.etaDays > 0 ? ` · ~${evaluation.progress.etaDays} días (estimado)` : ''}
          </span>
        </div>
        <div className="h-1.5 rounded bg-slate-200 dark:bg-slate-800 overflow-hidden">
          <div className="h-full bg-sky-500" style={{ width: `${Math.min(100, (evaluation.progress.n / evaluation.progress.needed) * 100)}%` }} />
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi
          label="Dirección acertada"
          value={fmt(evaluation.headline.accPct)}
          hint={`Azar esperable: ${fmt(evaluation.headline.baselinePct)} · ${evaluation.headline.ci95 ? `IC 95 %: ${evaluation.headline.ci95[0].toFixed(0)}–${evaluation.headline.ci95[1].toFixed(0)} %` : 'IC —'}`}
        />
        <Kpi
          label="Ventaja sobre el azar"
          value={evaluation.headline.skillPp === null ? '—' : `${evaluation.headline.skillPp >= 0 ? '+' : ''}${evaluation.headline.skillPp.toFixed(1)} pp`}
          hint={`p = ${evaluation.headline.pValue ?? '—'} · n = ${evaluation.headline.n}`}
        />
        <Kpi
          label="TP1 antes que SL"
          value={fmt(o.tpRatePct)}
          hint={`La app predijo ${fmt(o.predProbTpPct)} · espejo ${fmt(o.mirrorTpRatePct)}`}
        />
        <Kpi
          label="PnL medio por operación"
          value={signed(o.avgPnlPct)}
          hint={`Necesario para no perder: ${fmt(o.breakevenPct)} de acierto (TP vs SL) · real ${fmt(o.winDecidedPct)}`}
        />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mb-1">
            Acierto acumulado de dirección <span style={{ color: '#0ea5e9' }}>— app</span> <span className="text-slate-400">- - azar esperable</span>
          </div>
          <MiniChart
            empty="Aún no hay suficientes opciones evaluadas"
            fmtY={(v) => `${v.toFixed(0)} %`}
            series={[
              { color: '#0ea5e9', points: evaluation.timeline.accuracy.map((p) => p.accPct) },
              { color: '#94a3b8', dash: true, points: evaluation.timeline.accuracy.map((p) => p.baselinePct) },
            ]}
          />
        </div>
        <div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mb-1">
            PnL acumulado de todas las opciones (suma, no es una cuenta real)
          </div>
          <MiniChart
            empty="Aún no hay operaciones resueltas"
            zeroLine
            fmtY={(v) => `${v.toFixed(0)} %`}
            series={[{ color: '#10b981', points: evaluation.timeline.pnl.map((p) => p.cumPnlPct) }]}
          />
        </div>
      </div>

      {evaluation.calibration.length > 0 && (
        <div className="text-xs">
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mb-1">
            Calibración: probabilidad de TP anunciada vs. real
            {evaluation.brier ? ` · Brier ${evaluation.brier.score} (referencia ${evaluation.brier.baseline}; menor es mejor)` : ''}
          </div>
          <div className="flex flex-wrap gap-2 font-mono tabular-nums">
            {evaluation.calibration.map((c) => (
              <span key={c.label} className="rounded border border-slate-200 dark:border-slate-800 px-2 py-1">
                {c.label}: pred. {c.predictedPct.toFixed(0)} % → real {c.actualPct.toFixed(0)} % <span className="text-slate-400">(n={c.n})</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs font-mono tabular-nums">
          <thead>
            <tr className="text-slate-500 dark:text-slate-400">
              <th className="py-1.5 text-left font-sans font-medium">Grupo</th>
              <th className="py-1.5 text-right font-medium">Guardadas</th>
              <th className="py-1.5 text-right font-medium">TP/SL/Exp</th>
              <th className="py-1.5 text-right font-medium">TP1 real (pred.)</th>
              <th className="py-1.5 text-right font-medium">Espejo</th>
              <th className="py-1.5 text-right font-medium">Dirección</th>
              <th className="py-1.5 text-right font-medium">PnL medio</th>
            </tr>
          </thead>
          <tbody>
            <Section title="Por estrategia" rows={evaluation.byStrategy} />
            <Section title="Por dirección" rows={evaluation.byDir} />
            <Section title="Por posición en el ranking" rows={evaluation.byRank} />
            <Section title="Por confluencia (¿puntuar más alto acierta más?)" rows={evaluation.byConfluence} />
            <Section title="Por confianza" rows={evaluation.byConfidence} />
            <Section title="Por veredicto de la estrategia" rows={evaluation.byVerdict} />
            <Section title="Por volatilidad del mercado al crearla" rows={evaluation.byRegime} />
            <Section title="Por régimen de mercado al crearla" rows={evaluation.byMarketRegime} />
            <Section title="Por activo" rows={evaluation.byAsset} />
          </tbody>
        </table>
      </div>

      <div className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400 space-y-1">
        <p>
          <b>Cómo leerlo.</b> «Espejo» es la operación contraria con las mismas distancias SL/TP: si la app no supera a su espejo, no aporta dirección. «Dirección» usa solo opciones sin solape temporal (por activo y estrategia); las demás se solapan y repetirían la misma información. El veredicto usa una opción por activo y horizonte (las estrategias de un mismo activo se mueven juntas) y compara con el azar real: un «siempre largo» acierta mucho en un mercado alcista sin saber nada. BTC, ETH y SOL se mueven juntos, así que la muestra efectiva es aún menor. Con tantos grupos en las tablas, alguno saldrá «bueno» por casualidad: no concluyas con un solo grupo.
        </p>
        <p>
          Si TP y SL se tocan en la misma vela de 1 h se cuenta SL (criterio conservador). Los costes de ida y vuelta (0,07 %) están incluidos en el PnL.
        </p>
      </div>
    </div>
  );
};

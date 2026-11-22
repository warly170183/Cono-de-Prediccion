import React from 'react';
import { Download } from 'lucide-react';
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
  const ci = o.dirCi95 ? `IC 95 %: ${o.dirCi95[0].toFixed(0)}–${o.dirCi95[1].toFixed(0)} %` : 'IC 95 %: —';

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

      <div className={`rounded-md border px-3 py-2 text-xs ${VERDICT_STYLES[evaluation.verdict.level]}`}>
        {evaluation.verdict.text}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi
          label="Dirección acertada al horizonte"
          value={fmt(o.dirIndepAccPct)}
          hint={`${ci} · n indep. = ${o.dirIndepN} (mín. ${evaluation.minIndependent})`}
        />
        <Kpi
          label="TP1 alcanzado antes que SL"
          value={fmt(o.tpRatePct)}
          hint={`La app predijo ${fmt(o.predProbTpPct)} · espejo ${fmt(o.mirrorTpRatePct)}`}
        />
        <Kpi
          label="Acierto entre decididas (TP vs SL)"
          value={fmt(o.winDecidedPct)}
          hint={`Necesario para no perder: ${fmt(o.breakevenPct)}`}
        />
        <Kpi
          label="PnL medio por operación"
          value={signed(o.avgPnlPct)}
          hint={`${o.tpHit} TP · ${o.slHit} SL · ${o.expired} exp. · ${o.open} abiertas`}
        />
      </div>

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
            <Section title="Por confianza" rows={evaluation.byConfidence} />
            <Section title="Por activo" rows={evaluation.byAsset} />
          </tbody>
        </table>
      </div>

      <div className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400 space-y-1">
        <p>
          <b>Cómo leerlo.</b> «Espejo» es la operación contraria con las mismas distancias SL/TP: si la app no supera a su espejo, no aporta dirección. «Dirección» usa solo opciones sin solape temporal (por activo y estrategia); las demás se solapan y repetirían la misma información. BTC, ETH y SOL se mueven juntos, así que la muestra efectiva es aún menor.
        </p>
        <p>
          Si TP y SL se tocan en la misma vela de 1 h se cuenta SL (criterio conservador). Los costes de ida y vuelta (0,07 %) están incluidos en el PnL.
        </p>
      </div>
    </div>
  );
};

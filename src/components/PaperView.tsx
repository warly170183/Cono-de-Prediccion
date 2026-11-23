import { useCallback, useEffect, useState } from 'react';
import type { PaperConfigT, PaperResponse } from '../types.ts';

const card = 'bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-5';
const input =
  'w-full px-2.5 py-1.5 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100';

const REASONS: Record<string, string> = {
  veredicto: 'Veredicto insuficiente',
  riesgo_diario: 'Tope de riesgo diario',
  riesgo_direccional: 'Tope direccional (correlación)',
  activo_ocupado: 'Activo ya con posición',
  parada_drawdown: 'Parada por drawdown',
};

function Curve({ pts }: { pts: Array<{ ts: number; equity: number }> }) {
  if (pts.length < 2) return <div className="text-xs text-slate-500">Aún no hay operaciones cerradas.</div>;
  const w = 640;
  const h = 140;
  const xs = pts.map((p) => p.ts);
  const ys = pts.map((p) => p.equity);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const px = (v: number) => ((v - x0) / Math.max(1, x1 - x0)) * (w - 8) + 4;
  const py = (v: number) => h - 6 - ((v - y0) / Math.max(1e-9, y1 - y0)) * (h - 12);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-36">
      <polyline fill="none" className="stroke-sky-500 dark:stroke-sky-400" strokeWidth={1.8} points={pts.map((p) => `${px(p.ts)},${py(p.equity)}`).join(' ')} />
    </svg>
  );
}

export function PaperView() {
  const [data, setData] = useState<PaperResponse | null>(null);
  const [cfg, setCfg] = useState<PaperConfigT | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/paper');
    if (res.ok) {
      const j = (await res.json()) as PaperResponse;
      setData(j);
      setCfg(j.config);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const apply = async () => {
    if (!cfg) return;
    const res = await fetch('/api/paper/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg) });
    if (res.ok) setData((await res.json()) as PaperResponse);
  };

  if (!data || !cfg) return <div className="text-xs text-slate-500">Cargando…</div>;
  const s = data.stats;
  const last = data.equity[data.equity.length - 1]?.equity ?? cfg.startEquity;
  const num = (k: keyof PaperConfigT) => (
    <input className={input} type="number" step="any" value={cfg[k] as number} onChange={(e) => setCfg({ ...cfg, [k]: Number(e.target.value) })} />
  );
  const skippedBy = data.skipped.reduce<Record<string, number>>((a, r) => ((a[r.reason] = (a[r.reason] ?? 0) + 1), a), {});

  return (
    <div className="space-y-6">
      <div className={card}>
        <h2 className="text-base font-display font-semibold text-slate-900 dark:text-slate-50">Paper trading con riesgo de cartera</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Ejecuta en papel las propuestas registradas por la app, con tamaño fijo por riesgo y límites diario, direccional (BTC/ETH/SOL se mueven juntos) y por activo. Se recalcula siempre desde el registro; no hay dinero real.
        </p>
        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4 font-mono tabular-nums">
          <div>
            <div className="text-xs font-sans text-slate-500">Capital</div>
            <div className="text-xl font-display font-semibold">{last.toLocaleString('es-ES', { maximumFractionDigits: 0 })}</div>
            <div className={`text-xs ${s.total_return_pct >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{s.total_return_pct >= 0 ? '+' : ''}{s.total_return_pct.toFixed(2)} %</div>
          </div>
          <div>
            <div className="text-xs font-sans text-slate-500">Drawdown máx.</div>
            <div className="text-xl font-display font-semibold">{s.max_dd_pct.toFixed(2)} %</div>
            <div className="text-xs text-slate-500">{s.halted ? 'Parada activada' : 'Sin parada'}</div>
          </div>
          <div>
            <div className="text-xs font-sans text-slate-500">Cerradas / abiertas</div>
            <div className="text-xl font-display font-semibold">{s.n_closed} / {s.n_open}</div>
            <div className="text-xs text-slate-500">Riesgo abierto {s.open_risk_pct.toFixed(2)} %</div>
          </div>
          <div>
            <div className="text-xs font-sans text-slate-500">Acierto · R medio · PF</div>
            <div className="text-xl font-display font-semibold">{s.win_rate_pct === null ? '—' : `${s.win_rate_pct.toFixed(0)} %`}</div>
            <div className="text-xs text-slate-500">R {s.avg_r === null ? '—' : s.avg_r.toFixed(2)} · PF {s.profit_factor === null ? '—' : s.profit_factor.toFixed(2)}</div>
          </div>
        </div>
        <div className="mt-4">
          <Curve pts={data.equity} />
        </div>
        {s.n_closed < 30 && (
          <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-2">Con menos de 30 operaciones cerradas el resultado no es concluyente.</p>
        )}
      </div>

      <div className={card}>
        <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-50 mb-3">Reglas de riesgo</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <label className="text-xs space-y-1"><span className="text-slate-500">Capital inicial</span>{num('startEquity')}</label>
          <label className="text-xs space-y-1"><span className="text-slate-500">Riesgo por operación %</span>{num('riskPct')}</label>
          <label className="text-xs space-y-1"><span className="text-slate-500">Riesgo diario máx. %</span>{num('maxDailyRiskPct')}</label>
          <label className="text-xs space-y-1"><span className="text-slate-500">Riesgo mismo sentido máx. %</span>{num('maxDirRiskPct')}</label>
          <label className="text-xs space-y-1"><span className="text-slate-500">Operaciones por activo</span>{num('maxPerAsset')}</label>
          <label className="text-xs space-y-1"><span className="text-slate-500">Parada por drawdown %</span>{num('maxDrawdownStopPct')}</label>
          <label className="text-xs space-y-1">
            <span className="text-slate-500">Veredicto mínimo</span>
            <select className={input} value={cfg.minVerdict} onChange={(e) => setCfg({ ...cfg, minVerdict: e.target.value as PaperConfigT['minVerdict'] })}>
              <option value="validada">Solo validadas</option>
              <option value="prometedora">Validadas y prometedoras</option>
              <option value="todas">Todas (control)</option>
            </select>
          </label>
          <div className="flex items-end">
            <button type="button" onClick={() => void apply()} className="px-3 py-1.5 text-xs font-medium rounded-md bg-sky-600 text-white hover:bg-sky-500 cursor-pointer">
              Aplicar y recalcular
            </button>
          </div>
        </div>
        {Object.keys(skippedBy).length > 0 && (
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-3">
            Descartadas: {Object.entries(skippedBy).map(([k, v]) => `${REASONS[k] ?? k} ${v}`).join(' · ')}
          </p>
        )}
      </div>

      <div className={card}>
        <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-50 mb-3">Operaciones</h3>
        {data.trades.length === 0 ? (
          <div className="text-xs text-slate-500">Todavía ninguna propuesta cumple el veredicto exigido. Prueba «Todas (control)» para ver cómo iría sin filtro.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono tabular-nums">
              <thead>
                <tr className="text-slate-500 border-b border-slate-200 dark:border-slate-800">
                  <th className="py-1 text-left font-medium">Fecha</th>
                  <th className="py-1 text-left font-medium">Activo</th>
                  <th className="py-1 text-left font-medium">Estrategia</th>
                  <th className="py-1 text-left font-medium">Dir.</th>
                  <th className="py-1 text-right font-medium">R</th>
                  <th className="py-1 text-right font-medium">P&amp;L</th>
                  <th className="py-1 text-right font-medium">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {[...data.trades].reverse().slice(0, 60).map((t) => (
                  <tr key={t.id}>
                    <td className="py-1.5">{new Date(t.openTs).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}</td>
                    <td className="py-1.5 font-sans">{t.asset.toUpperCase()}</td>
                    <td className="py-1.5 font-sans">{t.strategyKey}</td>
                    <td className="py-1.5 font-sans">{t.dir === 'long' ? 'Largo' : 'Corto'}</td>
                    <td className="py-1.5 text-right">{t.rMultiple === null ? '—' : t.rMultiple.toFixed(2)}</td>
                    <td className={`py-1.5 text-right ${(t.pnl ?? 0) > 0 ? 'text-emerald-600' : (t.pnl ?? 0) < 0 ? 'text-rose-600' : ''}`}>{t.pnl === null ? '—' : t.pnl.toFixed(0)}</td>
                    <td className="py-1.5 text-right font-sans">{t.pnl === null ? 'Abierta' : t.status === 'tp_hit' ? 'TP' : t.status === 'sl_hit' ? 'SL' : 'Cierre'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

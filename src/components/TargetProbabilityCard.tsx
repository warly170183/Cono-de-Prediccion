import React, { useEffect, useState } from 'react';
import type { AssetId, TargetProbability } from '../types.ts';

interface Props {
  asset: AssetId;
  spot: number;
}

const HOURS = [6, 12, 24, 48, 72];
const CHIPS = [-5, -3, -2, -1, 1, 2, 3, 5];

const fmt = (v: number) =>
  `$${v.toLocaleString('en-US', { minimumFractionDigits: v >= 100 ? 2 : 3, maximumFractionDigits: v >= 100 ? 2 : 3 })}`;

/** Calculadora: ¿qué probabilidad hay de que el precio llegue a un nivel dentro de X horas? */
export const TargetProbabilityCard: React.FC<Props> = ({ asset, spot }) => {
  const [price, setPrice] = useState<string>(String(Number((spot * 1.02).toFixed(spot >= 100 ? 2 : 3))));
  const [hours, setHours] = useState(24);
  const [res, setRes] = useState<TargetProbability | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setPrice(String(Number((spot * 1.02).toFixed(spot >= 100 ? 2 : 3))));
    setRes(null);
    // solo al cambiar de activo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset]);

  useEffect(() => {
    const p = Number(price);
    if (!Number.isFinite(p) || p <= 0) return;
    let alive = true;
    const t = setTimeout(() => {
      fetch(`/api/cone/target?asset=${asset}&price=${p}&hours=${hours}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('No se pudo calcular'))))
        .then((j) => {
          if (!alive) return;
          setRes(j as TargetProbability);
          setErr(null);
        })
        .catch((e) => alive && setErr(e instanceof Error ? e.message : 'Error de red'));
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [asset, price, hours]);

  return (
    <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4">
      <div>
        <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-50">
          Probabilidad de alcanzar un precio
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Mismo modelo que el cono (GJR-GARCH + ensamble HAR, 4,000 rutas) con corrección de toque intravela. Mide la probabilidad
          que da la volatilidad: no hay ventaja direccional ni predicción.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <label className="text-xs text-slate-600 dark:text-slate-300 space-y-1">
          <span className="block">Precio objetivo</span>
          <input
            type="number"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="w-40 px-2.5 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono tabular-nums text-sm text-slate-900 dark:text-slate-100"
          />
        </label>

        <div className="text-xs space-y-1">
          <span className="block text-slate-600 dark:text-slate-300">Horizonte</span>
          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-lg">
            {HOURS.map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setHours(h)}
                className={`px-2.5 py-1 font-medium rounded-md cursor-pointer ${
                  hours === h
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-50 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {h} h
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1 text-[11px]">
          {CHIPS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setPrice(String(Number((spot * (1 + c / 100)).toFixed(spot >= 100 ? 2 : 3))))}
              className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 font-mono tabular-nums text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              {c > 0 ? '+' : ''}
              {c} %
            </button>
          ))}
        </div>
      </div>

      {err && <div className="text-xs text-rose-600 dark:text-rose-400">{err}</div>}

      {res && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div className="p-3 rounded-md bg-slate-50 dark:bg-slate-800/40 border border-slate-200/70 dark:border-slate-800">
            <div className="text-slate-500 dark:text-slate-400">Toca {fmt(res.price)} ({res.distPct >= 0 ? '+' : ''}{res.distPct} %)</div>
            <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-sky-600 dark:text-sky-400">{res.pTouchPct.toFixed(1)} %</div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              en {res.hours} h{res.medianHoursToTouch ? ` · mediana ${res.medianHoursToTouch} h` : ''}
            </div>
          </div>
          <div className="p-3 rounded-md bg-slate-50 dark:bg-slate-800/40 border border-slate-200/70 dark:border-slate-800">
            <div className="text-slate-500 dark:text-slate-400">Cierra por encima del objetivo</div>
            <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">{res.pCloseAbovePct.toFixed(1)} %</div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">a las {res.hours} h</div>
          </div>
          <div className="p-3 rounded-md bg-slate-50 dark:bg-slate-800/40 border border-slate-200/70 dark:border-slate-800">
            <div className="text-slate-500 dark:text-slate-400">Cierra por debajo del objetivo</div>
            <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-rose-600 dark:text-rose-400">{res.pCloseBelowPct.toFixed(1)} %</div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">a las {res.hours} h</div>
          </div>
          <div className="p-3 rounded-md bg-slate-50 dark:bg-slate-800/40 border border-slate-200/70 dark:border-slate-800">
            <div className="text-slate-500 dark:text-slate-400">Rango a {res.hours} h (90 %)</div>
            <div className="mt-1 font-mono tabular-nums text-slate-800 dark:text-slate-100">
              {fmt(res.quantiles.p5)} – {fmt(res.quantiles.p95)}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              50 %: {fmt(res.quantiles.p25)} – {fmt(res.quantiles.p75)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

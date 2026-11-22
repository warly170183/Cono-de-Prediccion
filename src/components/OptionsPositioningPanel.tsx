import React from 'react';
import type { GexOutput } from '../types.ts';

const px = (v: number) => `$${v.toLocaleString('en-US', { maximumFractionDigits: v >= 100 ? 0 : 2 })}`;

/** Lectura de posicionamiento del mercado de opciones: max pain, skew 25Δ, estructura temporal y Gamma Flip. */
export const OptionsPositioningPanel: React.FC<{ gex: GexOutput }> = ({ gex }) => {
  const term = gex.atm_term;
  const front = term[0];
  const back = term.length > 1 ? term[term.length - 1] : null;
  const slope = front && back ? front.iv - back.iv : null;
  const rr = gex.skew25?.rr25 ?? null;
  const flipDist = gex.flip !== null ? ((gex.spot / gex.flip - 1) * 100) : null;

  const skewRead =
    rr === null
      ? 'Sin datos suficientes para el skew.'
      : rr <= -2
        ? 'Los puts cotizan más caros que los calls: demanda de protección (sesgo defensivo).'
        : rr >= 2
          ? 'Los calls cotizan más caros que los puts: apetito por subidas (sesgo especulativo alcista).'
          : 'Skew casi neutro: el mercado no paga una prima clara por ninguno de los lados.';
  const termRead =
    slope === null
      ? 'Sin estructura temporal suficiente.'
      : slope > 1
        ? 'Backwardation: la IV a corto plazo supera a la de largo plazo, típico de estrés o de un evento cercano.'
        : slope < -1
          ? 'Contango: la IV sube con el plazo, estructura normal sin estrés inmediato.'
          : 'Estructura plana: sin prima de estrés a corto plazo.';
  const flipRead =
    flipDist === null
      ? 'No hay cruce por cero del perfil gamma en ±25 % del spot.'
      : flipDist >= 0
        ? `El spot está ${flipDist.toFixed(1)} % por encima del Gamma Flip (${px(gex.flip as number)}): zona de gamma positiva, movimientos amortiguados mientras no se pierda ese nivel.`
        : `El spot está ${Math.abs(flipDist).toFixed(1)} % por debajo del Gamma Flip (${px(gex.flip as number)}): zona de gamma negativa, movimientos amplificados.`;

  return (
    <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4">
      <div>
        <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-50">
          Posicionamiento del mercado de opciones
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Lectura de contexto, no señal de entrada: describe cómo está posicionado el mercado de opciones de Deribit.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
        <div className="p-3 rounded-md bg-slate-50 dark:bg-slate-800/40 border border-slate-200/70 dark:border-slate-800 space-y-1.5">
          <div className="font-medium text-slate-700 dark:text-slate-200">Gamma Flip</div>
          <div className="text-slate-600 dark:text-slate-300">{flipRead}</div>
        </div>

        <div className="p-3 rounded-md bg-slate-50 dark:bg-slate-800/40 border border-slate-200/70 dark:border-slate-800 space-y-1.5">
          <div className="font-medium text-slate-700 dark:text-slate-200">
            Skew 25Δ {gex.skew25 ? `(${gex.skew25.expiry}, ${gex.skew25.days.toFixed(0)} d)` : ''}
          </div>
          {gex.skew25 && (
            <div className="font-mono tabular-nums text-slate-800 dark:text-slate-100">
              RR25 {gex.skew25.rr25 >= 0 ? '+' : ''}{gex.skew25.rr25.toFixed(2)} pts · BF25 {gex.skew25.bf25 >= 0 ? '+' : ''}{gex.skew25.bf25.toFixed(2)} pts · ATM {gex.skew25.atm_iv.toFixed(1)} %
            </div>
          )}
          <div className="text-slate-600 dark:text-slate-300">{skewRead}</div>
        </div>

        <div className="p-3 rounded-md bg-slate-50 dark:bg-slate-800/40 border border-slate-200/70 dark:border-slate-800 space-y-1.5">
          <div className="font-medium text-slate-700 dark:text-slate-200">Estructura temporal de IV ATM</div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono tabular-nums text-slate-800 dark:text-slate-100">
            {term.map((t) => (
              <span key={t.expiry}>
                {t.days.toFixed(0)}d {t.iv.toFixed(1)} %
              </span>
            ))}
          </div>
          <div className="text-slate-600 dark:text-slate-300">{termRead}</div>
        </div>

        <div className="p-3 rounded-md bg-slate-50 dark:bg-slate-800/40 border border-slate-200/70 dark:border-slate-800 space-y-1.5">
          <div className="font-medium text-slate-700 dark:text-slate-200">Max pain (strike que menos pagan los vendedores)</div>
          <div className="space-y-0.5 font-mono tabular-nums text-slate-800 dark:text-slate-100">
            {gex.max_pain.map((m) => {
              const d = (m.strike / gex.spot - 1) * 100;
              return (
                <div key={m.expiry}>
                  {m.expiry} ({m.days.toFixed(0)} d): {px(m.strike)}{' '}
                  <span className="text-slate-500 dark:text-slate-400">({d >= 0 ? '+' : ''}{d.toFixed(1)} % vs spot)</span>
                </div>
              );
            })}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            Referencia que suele atraer al precio cerca del vencimiento; el efecto es débil lejos de él.
          </div>
        </div>
      </div>

      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        Supuesto: el GEX asume dealers largos en calls y cortos en puts (convención habitual). En Deribit no se conoce el
        posicionamiento real, así que el signo es una aproximación.
      </p>
    </div>
  );
};

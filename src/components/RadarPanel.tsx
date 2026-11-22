import React from 'react';
import type { AssetId, RadarAssetItem } from '../types.ts';

interface Props {
  items: RadarAssetItem[];
  activeAsset: AssetId;
  onSelectAsset: (a: AssetId) => void;
}

export const RadarPanel: React.FC<Props> = ({ items, activeAsset, onSelectAsset }) => {
  if (!items.length) return null;

  return (
    <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-display font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Radar Multi-Activo (BTC · ETH · SOL)
        </h3>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          Haz clic en una fila para cambiar el activo principal
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
              <th className="py-1.5 text-left font-medium">Contrato</th>
              <th className="py-1.5 text-right font-medium">Spot</th>
              <th className="py-1.5 text-right font-medium">24 h</th>
              <th className="py-1.5 text-right font-medium">Vol (Percentil)</th>
              <th className="py-1.5 text-left font-medium pl-4">Régimen</th>
              <th className="py-1.5 text-right font-medium">Banda 90 % (24 h)</th>
              <th className="py-1.5 text-right font-medium">Ensamble 72h</th>
              <th className="py-1.5 text-right font-medium">Net GEX</th>
              <th className="py-1.5 text-right font-medium">Fund z / OI 1d</th>
              <th className="py-1.5 text-right font-medium">Banderas</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 font-mono tabular-nums">
            {items.map((item) => {
              const selected = item.asset === activeAsset;
              const flagParts: string[] = [];
              if (item.flags.fund === 'neg') flagParts.push('Fund z < -2');
              if (item.flags.fund === 'pos') flagParts.push('Fund z > +2');
              if (item.flags.oi_flush) flagParts.push('OI Flush');

              return (
                <tr
                  key={item.asset}
                  onClick={() => onSelectAsset(item.asset)}
                  className={`cursor-pointer transition-colors ${
                    selected
                      ? 'bg-sky-500/10 dark:bg-sky-500/10'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <td className="py-2 font-sans font-semibold text-slate-900 dark:text-slate-100">
                    {item.inst}
                  </td>
                  <td className="py-2 text-right text-slate-900 dark:text-slate-100">
                    ${item.spot.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                  </td>
                  <td
                    className={`py-2 text-right ${
                      item.chg_24h_pct >= 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {item.chg_24h_pct >= 0 ? '+' : ''}
                    {item.chg_24h_pct.toFixed(2)} %
                  </td>
                  <td className="py-2 text-right">
                    {item.vol_ann_pct.toFixed(1)} % <span className="text-slate-400">(P{item.vol_pctile.toFixed(0)})</span>
                  </td>
                  <td
                    className={`py-2 pl-4 font-sans font-medium ${
                      item.regime === 'Turbulento'
                        ? 'text-rose-600 dark:text-rose-400'
                        : item.regime === 'Calma'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-amber-600 dark:text-amber-400'
                    }`}
                  >
                    {item.regime}
                  </td>
                  <td className="py-2 text-right text-slate-600 dark:text-slate-300">
                    ${item.cone24_lo.toLocaleString('en-US', { maximumFractionDigits: 1 })} – $
                    {item.cone24_hi.toLocaleString('en-US', { maximumFractionDigits: 1 })}
                  </td>
                  <td className="py-2 text-right">{item.ens_ratio_72.toFixed(3)}×</td>
                  <td
                    className={`py-2 text-right ${
                      item.net_gex_m === null
                        ? 'text-slate-400'
                        : item.net_gex_m >= 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {item.net_gex_m !== null ? `${item.net_gex_m >= 0 ? '+' : ''}${item.net_gex_m.toFixed(1)}M` : '—'}
                  </td>
                  <td className="py-2 text-right text-slate-600 dark:text-slate-300">
                    {item.fund_1d_z !== null ? item.fund_1d_z.toFixed(2) : '—'} /{' '}
                    {item.oi_chg_1d !== null ? `${item.oi_chg_1d >= 0 ? '+' : ''}${item.oi_chg_1d.toFixed(1)}%` : '—'}
                  </td>
                  <td className="py-2 text-right font-sans">
                    {flagParts.length ? (
                      <span className="text-amber-600 dark:text-amber-400 font-medium">
                        {flagParts.join(' · ')}
                      </span>
                    ) : (
                      <span className="text-slate-400">Neutral</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

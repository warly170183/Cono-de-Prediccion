import type { AssetId, TradeGridRow } from '../types.ts';

/** Escenarios What-If guardados en el navegador (localStorage). */
export interface LocalTradePreset {
  id: string;
  asset: AssetId;
  dir: 'long' | 'short';
  slPct: number;
  tpPct: number;
  costPct: number;
  drift24hPct: number;
  evPct: number;
  evR: number;
  kellyPct: number;
}

const KEY = 'trading-predictor:presets:v1';

export function loadTradePresets(): LocalTradePreset[] {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? (JSON.parse(raw) as LocalTradePreset[]) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function persist(items: LocalTradePreset[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items.slice(0, 100)));
  } catch {
    /* almacenamiento no disponible */
  }
}

export function saveTradePreset(params: {
  asset: AssetId;
  dir: 'long' | 'short';
  slPct: number;
  tpPct: number;
  costPct: number;
  drift24hPct: number;
  result: TradeGridRow;
}): LocalTradePreset[] {
  const item: LocalTradePreset = {
    id: `preset_${params.asset}_${Date.now()}`,
    asset: params.asset,
    dir: params.dir,
    slPct: params.slPct,
    tpPct: params.tpPct,
    costPct: params.costPct,
    drift24hPct: params.drift24hPct,
    evPct: params.result.ev_pct,
    evR: params.result.ev_r,
    kellyPct: params.result.kelly_pct,
  };
  const next = [item, ...loadTradePresets()];
  persist(next);
  return next;
}

export function deleteTradePreset(id: string): LocalTradePreset[] {
  const next = loadTradePresets().filter((p) => p.id !== id);
  persist(next);
  return next;
}

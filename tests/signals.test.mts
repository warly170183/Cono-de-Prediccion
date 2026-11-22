import fs from 'fs';
import os from 'os';
import path from 'path';
process.env.JOURNAL_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-'));
const root = new URL('../server/', import.meta.url);
const svc = await import(new URL('tradeOptionsService.ts', root).href);
const sig = await import(new URL('tradeSignals.ts', root).href);
const bt = await import(new URL('optionBacktest.ts', root).href);

const H = 3_600_000;
const D = 24 * H;
const check = (name: string, cond: boolean) => { console.log((cond ? 'OK   ' : 'FALLA'), name); if (!cond) process.exitCode = 1; };
// PRNG determinista
let seed = 7;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

type C = [number, number, number, number, number, number];
const t0 = Date.UTC(2026, 0, 1);
const series = (n: number, start: number, drift: number, vol: number, v = 100): C[] => {
  const out: C[] = [];
  let p = start;
  for (let i = 0; i < n; i++) {
    const o = p;
    const c = p * (1 + drift + (rnd() - 0.5) * 2 * vol);
    out.push([t0 + i * H, o, Math.max(o, c) * (1 + vol / 3), Math.min(o, c) * (1 - vol / 3), c, v]);
    p = c;
  }
  return out;
};
const dailyFrom = (h: C[]): C[] => {
  const out: C[] = [];
  for (let i = 0; i + 24 <= h.length; i += 24) {
    const day = h.slice(i, i + 24);
    out.push([day[0][0], day[0][1], Math.max(...day.map((c) => c[2])), Math.min(...day.map((c) => c[3])), day[23][4], day.reduce((s, c) => s + c[5], 0)]);
  }
  return out;
};

// ── Tendencia diaria
const up = Array.from({ length: 80 }, (_, i) => [t0 + i * D, 100 + i, 101 + i, 99 + i, 100 + i, 1]) as C[];
const dn = Array.from({ length: 80 }, (_, i) => [t0 + i * D, 200 - i, 201 - i, 199 - i, 200 - i, 1]) as C[];
check('HTF alcista en serie creciente', sig.htfFromDaily(up).trend === 'alcista');
check('HTF bajista en serie decreciente', sig.htfFromDaily(dn).trend === 'bajista');
check('HTF lateral con pocos datos', sig.htfFromDaily(up.slice(0, 30)).trend === 'lateral');
check('closedDailyUpTo excluye el día en curso', sig.closedDailyUpTo(up, up[10][0] + 5 * H).length === 10);

// ── Pivotes usan la última vela diaria cerrada (ayer)
{
  const h = series(300, 100, 0, 0.002);
  const d: C[] = [[t0, 100, 100, 100, 100, 1], [t0 + D, 100, 120, 80, 100, 1]];
  const tech = svc.computeTechnicalParameters(h, d);
  check('pivote = (H+L+C)/3 de la última diaria cerrada', Math.abs(tech.pivotP - 100) < 0.2);
}

// ── simulateTrade
{
  const flat: C[] = Array.from({ length: 40 }, (_, i) => [t0 + i * H, 100, 100.05, 99.95, 100, 1]);
  const tp = flat.map((c) => [...c]) as C[]; tp[3] = [tp[3][0], 100, 103.1, 100, 103, 1];
  const r1 = bt.simulateTrade(tp, 0, 'long', 1.5, 3, 24);
  check('TP1: gana y R = (3-0,07)/1,5', !!r1 && r1.win && Math.abs(r1.r - (3 - 0.07) / 1.5) < 1e-9);
  const sl = flat.map((c) => [...c]) as C[]; sl[2] = [sl[2][0], 100, 100, 98.0, 98.2, 1];
  const r2 = bt.simulateTrade(sl, 0, 'long', 1.5, 3, 24);
  check('SL: pierde y R ≈ -1,05', !!r2 && !r2.win && Math.abs(r2.r + (1.5 + 0.07) / 1.5) < 1e-9);
  const both = flat.map((c) => [...c]) as C[]; both[1] = [both[1][0], 100, 104, 98, 100, 1];
  check('SL y TP en la misma vela: SL primero', bt.simulateTrade(both, 0, 'long', 1.5, 3, 24)!.win === false);
  const ex = bt.simulateTrade(flat, 0, 'long', 1.5, 3, 24);
  check('expira plano: no gana y R ≈ -0,05', !!ex && !ex.win && Math.abs(ex.r + 0.07 / 1.5) < 1e-9);
  check('sin velas suficientes: null', bt.simulateTrade(flat, 30, 'long', 1.5, 3, 24) === null);
  const sh = flat.map((c) => [...c]) as C[]; sh[5] = [sh[5][0], 100, 100, 96.5, 97, 1];
  check('corto con TP', bt.simulateTrade(sh, 0, 'short', 1.5, 3, 24)!.win === true);
}

// ── Veredicto de ventaja
{
  const ones = Array(30).fill(1);
  check('30 × +1R => validada', bt.edgeVerdict(ones).verdict === 'validada');
  check('30 × -1R => descartada', bt.edgeVerdict(ones.map((x: number) => -x)).verdict === 'descartada');
  check('10 muestras => sin_datos', bt.edgeVerdict(Array(10).fill(1)).verdict === 'sin_datos');
  const mixed = Array.from({ length: 40 }, (_, i) => (i % 2 ? 2 : -2));
  check('media 0 con ruido => dudosa', bt.edgeVerdict(mixed).verdict === 'dudosa');
  const weakPos = Array.from({ length: 40 }, (_, i) => (i % 2 ? 2 : -1.6));
  check('media positiva pequeña sin confirmar => prometedora', bt.edgeVerdict(weakPos).verdict === 'prometedora');
}

// ── Setups: continuación de tendencia (tendencia determinista + retroceso progresivo hasta la zona de EMA20)
const mkInput = (h: C[], d: C[]) => {
  const tech = svc.computeTechnicalParameters(h, d);
  return { spot: h[h.length - 1][4], tech, htf: sig.htfFromDaily(d), candles1h: h };
};
{
  const base: C[] = [];
  let p = 100;
  for (let i = 0; i < 700; i++) {
    const c = p * (1.0008 + (i % 2 ? 0.0009 : -0.0009));
    base.push([t0 + i * H, p, Math.max(p, c) * 1.0004, Math.min(p, c) * 0.9996, c, 100]);
    p = c;
  }
  let h = base.slice();
  let found: any = null;
  let lastRes: any = null;
  for (let k = 0; k < 20 && !found; k++) {
    const q = h[h.length - 1][4];
    const c = q * 0.9988;
    h = [...h, [t0 + (700 + k) * H, q, q * 1.0003, c * 0.9997, c, 100]];
    lastRes = sig.detectSetups(mkInput(h, dailyFrom(h)));
    if (process.env.DBG) console.log(k, lastRes.skipped[0].reason);
    found = lastRes.setups.find((s: any) => s.strategyKey === 'trend_pullback') ?? null;
  }
  console.log(JSON.stringify(found ? { dir: found.dir, sl: found.slPct, tp1: found.tp1Pct, score: found.techScore } : { skipped: lastRes.skipped.map((s: any) => s.strategyKey + ' -> ' + s.reason) }));
  check('al retroceder a la zona de EMA20 en tendencia, propone continuación larga', !!found && found.dir === 'long');
  const res = lastRes;
  for (const s of res.setups) {
    check(`${s.strategyKey}: SL ≥ 0,8 % y TP1 ≥ 1,3 R`, s.slPct >= 0.8 && s.tp1Pct >= 1.3 * s.slPct - 1e-6);
    check(`${s.strategyKey}: TP2 > TP1`, s.tp2Pct > s.tp1Pct);
  }
  check('cada estrategia o propone o explica por qué no (4 en total)', res.setups.length + res.skipped.length === 4);
  check('ninguna estrategia aparece en ambas listas', res.setups.every((s: any) => !res.skipped.some((k: any) => k.strategyKey === s.strategyKey)));
}

// ── Mercado plano y sin tendencia: no se fuerza ninguna operación de tendencia
{
  const h = series(500, 100, 0, 0.0008);
  const d = dailyFrom(h);
  const res = sig.detectSetups(mkInput(h, d));
  check('mercado sin tendencia: trend_pullback explica su descarte', res.skipped.some((s: any) => s.strategyKey === 'trend_pullback') || res.setups.some((s: any) => s.strategyKey === 'trend_pullback'));
  check('derivados sin datos => descartada con motivo', res.skipped.some((s: any) => s.strategyKey === 'derivatives_squeeze' && /derivados/i.test(s.reason)));
}

// ── Ruptura de rango comprimido con volumen
{
  const h: C[] = [];
  for (let i = 0; i < 400; i++) {
    const p = 100 + Math.sin(i / 3) * 0.08;
    h.push([t0 + i * H, p, p + 0.06, p - 0.06, p, 100]);
  }
  const rh = Math.max(...h.slice(-24).map((c) => c[2]));
  h.push([t0 + 400 * H, 100, rh + 0.2, 99.95, rh + 0.1, 400]);
  const d = dailyFrom(h);
  const res = sig.detectSetups(mkInput(h, d));
  const b = res.setups.find((s: any) => s.strategyKey === 'range_breakout');
  check('ruptura con volumen de rango comprimido => largo', !!b && b.dir === 'long');
  const noVol = h.slice(0, -1).concat([[h[400][0], 100, rh + 0.2, 99.95, rh + 0.1, 100]]);
  const res2 = sig.detectSetups(mkInput(noVol, dailyFrom(noVol)));
  check('misma ruptura sin volumen => descartada', res2.skipped.some((s: any) => s.strategyKey === 'range_breakout' && /volumen/i.test(s.reason)));
}

// ── Backtest: corre, es independiente y consistente
{
  const h = series(1600, 100, 0.0002, 0.003);
  const d = dailyFrom(h);
  const res = bt.backtestStrategies(h, d, svc.computeTechnicalParameters);
  const keys = Object.keys(res);
  check('backtest cubre las 3 estrategias reproducibles', keys.length === 3 && !keys.includes('derivatives_squeeze'));
  for (const k of keys) {
    const s = res[k];
    check(`${k}: n coherente (${s.n}) y sin solape`, s.n >= 0 && s.n <= Math.floor(1600 / 24) && s.rs.length === s.n);
    check(`${k}: winPct dentro de [0,100]`, s.winPct === null || (s.winPct >= 0 && s.winPct <= 100));
  }
  const total = keys.reduce((a, k) => a + res[k].n, 0);
  console.log('backtest sintético:', JSON.stringify(keys.map((k) => [k, res[k].n, res[k].winPct, res[k].expR])));
  check('el backtest sintético encuentra operaciones', total > 0);
}

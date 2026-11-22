import fs from 'fs';
import os from 'os';
import path from 'path';
process.env.JOURNAL_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cone-'));
const check = (name: string, cond: boolean) => { console.log((cond ? 'OK   ' : 'FALLA'), name); if (!cond) process.exitCode = 1; };
const H = 3_600_000;
const lastHour = Math.floor(Date.now() / H) * H - H;
let seed = 5;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const hourly: number[][] = [];
{ let p = 100; for (let i = 0; i < 1300; i++) { const o = p; const c = p * (1 + (rnd() - 0.5) * 0.008); hourly.push([lastHour - (1299 - i) * H, o, Math.max(o, c) * 1.001, Math.min(o, c) * 0.999, c, 100]); p = c; } }
globalThis.fetch = (async (input: any) => {
  const url = new URL(String(input));
  const after = url.searchParams.get('after');
  const src = url.pathname.endsWith('history-candles') && after ? hourly.filter((c) => c[0] < Number(after)) : hourly;
  const data = src.slice(-100).reverse().map((c) => [String(c[0]), String(c[1]), String(c[2]), String(c[3]), String(c[4]), String(c[5]), '0', '0', '1']);
  return new Response(JSON.stringify({ code: '0', data }), { status: 200 });
}) as any;

const root = new URL('../server/', import.meta.url);
const q = await import(new URL('quantEngine.ts', root).href);
const ct = await import(new URL('coneTarget.ts', root).href);

// Residuos estandarizados
const r = hourly.slice(1).map((c, i) => Math.log(c[4] / hourly[i][4]) * 100);
const fit = q.fitGjrGarch(r);
const m = fit.stdResids.reduce((s: number, v: number) => s + v, 0) / fit.stdResids.length;
const v = fit.stdResids.reduce((s: number, x: number) => s + (x - m) ** 2, 0) / fit.stdResids.length;
check('residuos con media ≈ 0', Math.abs(m) < 1e-9);
check('residuos con varianza ≈ 1', Math.abs(v - 1) < 1e-6);

const spot = hourly[hourly.length - 1][4];
const a = await ct.computeTargetProbability('btc', spot * 1.01, 24);
const b = await ct.computeTargetProbability('btc', spot * 1.05, 24);
const c = await ct.computeTargetProbability('btc', spot * 0.97, 24);
const d = await ct.computeTargetProbability('btc', spot * 1.01, 6);
const e = await ct.computeTargetProbability('btc', spot, 24);
console.log(JSON.stringify({ a: a.pTouchPct, b: b.pTouchPct, c: c.pTouchPct, d: d.pTouchPct, up: a.pCloseAbovePct }));
check('más lejos => menos probable', b.pTouchPct < a.pTouchPct);
check('más horizonte => más probable', a.pTouchPct > d.pTouchPct);
check('tocar ≥ cerrar por encima (objetivo al alza)', a.pTouchPct >= a.pCloseAbovePct);
check('cierre por encima + por debajo = 100', Math.abs(a.pCloseAbovePct + a.pCloseBelowPct - 100) < 0.11);
check('objetivo a la baja: tocar ≥ cerrar por debajo', c.pTouchPct >= c.pCloseBelowPct);
check('precio = spot => toca con 100 %', e.pTouchPct === 100);
check('cuantiles ordenados', a.quantiles.p5 < a.quantiles.p25 && a.quantiles.p25 < a.quantiles.p50 && a.quantiles.p50 < a.quantiles.p75 && a.quantiles.p75 < a.quantiles.p95);
// Corrección intravela: con barrera lejana la probabilidad de primer paso ≈ 2·P(cierre por encima)
check('principio de reflexión: toque ≈ 2×cierre (±35 %)', b.pTouchPct === 0 || (b.pTouchPct / (2 * b.pCloseAbovePct) > 0.65 && b.pTouchPct / (2 * b.pCloseAbovePct) < 1.5));

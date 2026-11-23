import { fitGjrGarch, simulateGarchPaths, simulateBarrierTrade, neutralGrossBias } from '../server/quantEngine.ts';
let fail = 0;
const ok = (c: boolean, m: string) => { console.log((c ? 'OK    ' : 'FALLO ') + m); if (!c) fail++; };
let seed = 21;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const g = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
// Retornos horarios (%) de un GJR-GARCH con fuerte efecto apalancamiento y colas pesadas
const r: number[] = []; let h = 0.2, prev = 0;
for (let i = 0; i < 4000; i++) {
  h = 0.004 + (0.04 + 0.12 * (prev < 0 ? 1 : 0)) * prev * prev + 0.88 * h;
  const z = g() * Math.sqrt(0.6) + (rnd() < 0.03 ? g() * 2.2 : 0);
  prev = Math.sqrt(h) * z / 1.0; r.push(prev);
}
const fit = fitGjrGarch(r);
const H = 72, N = 8000;
const paths = simulateGarchPaths(fit, r[r.length - 1], H, N, 11, true);
const sig = fit.condVolPct[fit.condVolPct.length - 1] / 100;
let worst = 0, worstSe = 0, worstTag = '';
for (const [sl, tp] of [[0.04, 0.01], [0.015, 0.08], [0.02, 0.04], [0.03, 0.02]]) for (const long of [true, false]) {
  let s = 0, s2 = 0;
  for (const p of paths) { const x = simulateBarrierTrade(p, H, long, sl, tp, 0, sig).gross; s += x; s2 += x * x; }
  const ev = s / N, se = Math.sqrt(Math.max(0, s2 / N - ev * ev) / N);
  console.log(`sl ${sl} tp ${tp} ${long ? 'L' : 'S'} EV bruto ${(ev * 100).toFixed(3)} % (SE ${(se * 100).toFixed(3)})`);
  if (Math.abs(ev) / se > Math.abs(worst) / (worstSe || 1)) { worst = ev; worstSe = se; worstTag = `${sl}/${tp}/${long}`; }
}
ok(Math.abs(worst) < 3.5 * worstSe + 0.0003, `sin ventaja bruta con deriva neutra (peor ${worstTag}: ${(worst * 100).toFixed(3)} % = ${(worst / worstSe).toFixed(1)} SE)`);
// Control variate: sin deriva el EV corregido es exactamente cero; con deriva alcista el largo gana y el corto pierde.
const mean = (long: boolean, drift: number) => {
  const b = neutralGrossBias(paths, H, long, 0.02, 0.04, sig);
  let s2 = 0;
  for (const p of paths) s2 += simulateBarrierTrade(p, H, long, 0.02, 0.04, drift, sig).gross - b;
  return s2 / N;
};
ok(Math.abs(mean(true, 0)) < 1e-12 && Math.abs(mean(false, 0)) < 1e-12, 'EV corregido sin deriva = 0 (largo y corto)');
ok(mean(true, 0.0003) > 0.002 && mean(false, 0.0003) < -0.002, 'con deriva alcista: largo > 0 y corto < 0');
if (fail) process.exit(1);

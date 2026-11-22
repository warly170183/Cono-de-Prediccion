import { backtestVariant, rotationVerdict } from '../server/rotationService.ts';
import { sharpe } from '../server/quantEngine.ts';
let fail = 0;
const ok = (c: boolean, m: string) => { console.log((c ? 'OK    ' : 'FALLO ') + m); if (!c) fail++; };
let seed = 3;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
function world(T: number, N: number, momentum: number) {
  const drift = Array.from({ length: N }, () => (rnd() - 0.5) * 0.012 * momentum);
  const prices: number[][] = [Array(N).fill(100)];
  for (let t = 1; t < T; t++) prices.push(prices[t - 1].map((p, j) => p * (1 + drift[j] + gauss() * 0.03)));
  return prices;
}
const sr = (x: number[]) => sharpe(x) * Math.sqrt(365);
const noise = world(900, 30, 0);
const sig = world(900, 30, 1);
const srNoise = sr(backtestVariant(noise, 30, 30, 5, 7).exc);
const srSig = sr(backtestVariant(sig, 30, 30, 5, 7).exc);
ok(srSig > srNoise + 0.5 && srSig > 1, `momentum plantado se detecta (SR ${srSig.toFixed(2)} vs ruido ${srNoise.toFixed(2)})`);
ok(Math.abs(srNoise) < 1.5, 'ruido: SR cerca de 0');
const r0 = backtestVariant(sig, 30, 30, 5, 7, 0);
const r3 = backtestVariant(sig, 30, 30, 5, 7, 3);
ok(r0.avgTurnover > 0 && r0.avgTurnover < 1, `rotación media razonable (${r0.avgTurnover.toFixed(3)})`);
ok(r0.exc.length === r3.exc.length, 'fases distintas con misma longitud de serie');
ok(rotationVerdict({ dsr: 0.99, nw_t: 4, ci_lo: 1, sharpe_h1: 1, sharpe_h2: 1, phase_pos_share: 1 }) === 'robusta_con_sesgo', 'veredicto robusto');
ok(rotationVerdict({ dsr: 0.6, nw_t: 2.5, ci_lo: -1, sharpe_h1: 1, sharpe_h2: 1, phase_pos_share: 0.7 }) === 'indicios', 'veredicto indicios');
ok(rotationVerdict({ dsr: 0.99, nw_t: 4, ci_lo: 1, sharpe_h1: 1, sharpe_h2: -1, phase_pos_share: 1 }) === 'sin_ventaja', 'una mitad negativa => sin ventaja');
if (fail) process.exit(1);

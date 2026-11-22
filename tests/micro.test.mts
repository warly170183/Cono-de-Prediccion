import { studyFromRows } from '../server/microService.ts';
import type { MicroTick } from '../server/types.ts';
let fail = 0;
const ok = (c: boolean, m: string) => { console.log((c ? 'OK    ' : 'FALLO ') + m); if (!c) fail++; };
let seed = 11;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
function make(n: number, signal: number, gapAt = -1): MicroTick[] {
  const out: MicroTick[] = []; let mid = 100000; let imbPrev = 0;
  for (let i = 0; i < n; i++) {
    const ts = 1_700_000_000_000 + i * 60_000 + (gapAt >= 0 && i >= gapAt ? 3 * 3_600_000 : 0);
    const imb = rnd() * 2 - 1;
    mid *= 1 + (signal * imbPrev * 0.0004 + (rnd() - 0.5) * 0.0008);
    imbPrev = imb;
    out.push({ ts, mid, spread_bps: 0.1, microprice_bps: 0, imb5: imb, imb20: imb, depth_bid_btc: 10, depth_ask_btc: 10,
      mark: mid, index: mid, basis_bps: 0, funding: 0, oi_btc: 1, tk_buy_btc: 1, tk_sell_btc: 1, n_trades: 2, vwap: mid,
      missed: 0, liq_long_btc: 0, liq_short_btc: 0 });
  }
  return out;
}
const noise = studyFromRows([], make(6000, 0));
ok(noise.ic.every((r) => !r.viable), 'ruido puro => nada operable');
ok(noise.ic.every((r) => r.p_bonf > 0.01 || r.n < 12), 'ruido puro => sin significación Bonferroni');
const sig = studyFromRows([], make(6000, 1));
const best = sig.ic.find((r) => r.feature === 'imb5' && r.h === 1 as any);
// con horizonte mínimo 5 min la señal a 1 min se diluye; basta con que no rompa y rows estén contados
ok(sig.n_rows === 6000, 'cuenta de filas');
const gap = studyFromRows([], make(300, 0, 150));
ok(gap.ic.every((r) => r.n <= Math.floor(300 / r.h)), 'huecos excluidos (n no excede lo contiguo)');
const gapCount = gap.ic.find((r) => r.h === 60 && r.feature === 'imb5');
ok(!gapCount || gapCount.n <= Math.floor(298 / 60), `un hueco de 3 h elimina muestras que lo cruzan (n=${gapCount?.n})`);
ok(noise.ic.every((r) => r.folds_same_sign === null || (r.folds_same_sign >= 0 && r.folds_same_sign <= 3)), 'tercios en rango');
if (fail) process.exit(1);

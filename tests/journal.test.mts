import { scorePredictions, summarizeCoverage, pinballLoss } from '../server/journalService.ts';
let fail = 0;
const ok = (c: boolean, m: string) => { console.log((c ? 'OK    ' : 'FALLO ') + m); if (!c) fail++; };
const HOUR = 3_600_000;
// cono normal: cuantiles de N(100, 5)
const z: Record<string, number> = { '5': -1.645, '10': -1.2816, '25': -0.6745, '50': 0, '75': 0.6745, '90': 1.2816, '95': 1.645 };
const mk = (sd: number) => Object.fromEntries(Object.entries(z).map(([k, v]) => [k, 100 + v * sd]));
function run(trueSd: number, n = 200) {
  let seed = 7;
  const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const preds: any[] = []; const candles: any[] = [];
  for (let i = 0; i < n; i++) {
    const ts = 1_700_000_000_000 + i * 24 * HOUR;
    const y = 100 + gauss() * trueSd;
    candles.push([ts + 24 * HOUR, 0, 0, 0, y, 0]);
    preds.push({ id: new Date(ts).toISOString().slice(0, 10) + String(i).padStart(4, '0'), anchor_ts: ts, spot: 100,
      cone: { '24': mk(5), '72': mk(5) }, flags: { fund: 'none', oi_flush: false }, p_up: { '24': 0.5, '72': 0.5 } });
  }
  return summarizeCoverage(scorePredictions('btc', preds, candles))[0];
}
const good = run(5);
ok(good.verdict === 'calibrado', `cono bien calibrado => calibrado (kupiec p=${good.kupiec_p?.toFixed(2)})`);
const bad = run(10);
ok(bad.verdict === 'sesgado', 'cono con la mitad de ancho real => sesgado');
ok((bad.pin as number) > (good.pin as number), 'pinball peor cuando el cono es estrecho');
ok(Math.abs((good.brier as number) - 0.25) < 0.02, 'Brier de p=0,5 ≈ 0,25');
ok(run(5, 8).verdict === 'datos_insuficientes', 'pocas muestras => datos insuficientes');
ok(pinballLoss(100, mk(5)) < pinballLoss(130, mk(5)), 'pinball crece con el error');
if (fail) process.exit(1);

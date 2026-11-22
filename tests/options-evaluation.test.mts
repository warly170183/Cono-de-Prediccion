import fs from 'fs';
import os from 'os';
import path from 'path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opt-'));
process.env.JOURNAL_DIR = tmp;
const root = new URL('../server/', import.meta.url).pathname;
const svc = await import(root + 'tradeOptionsService.ts');
const { buildEvaluation } = await import(root + 'optionStats.ts');

const H = 3_600_000;
const t0 = Date.UTC(2026, 10, 1, 0, 0, 0);
const mk = (id: string, dir: 'long' | 'short', createdTs: number, extra = {}) => ({
  id, asset: 'btc', strategyKey: 'trend_pullback', title: 't', dir, horizonHours: 24, createdTs,
  createdIso: '', entryPrice: 100, entryLow: 99, entryHigh: 101,
  stopLoss: dir === 'long' ? 98 : 102, slPct: 2,
  takeProfit1: dir === 'long' ? 104 : 96, tp1Pct: 4,
  takeProfit2: dir === 'long' ? 106 : 94, rr: 2, probTpPct: 33, evPct: 0, confluenceScore: 70,
  confidence: 'Media', source: 'auto', status: 'open', evaluatedTs: null, exitPrice: null,
  realizedPnlPct: null, mfePct: null, maePct: null, summary: '', rank: 1, ...extra,
});
// candle builder: [ts,o,h,l,c]
const flat = (from: number, n: number, px = 100) =>
  Array.from({ length: n }, (_, i) => [from + (i + 1) * H, px, px + 0.1, px - 0.1, px]);
const candlesFor = (createdTs: number, n: number, mut: (c: number[][]) => void) => { const c = flat(createdTs, n); mut(c); return c; };

let all: number[][] = [];
// A: long, sube a TP2 en la vela 3 y cierra en 106
const A = t0;            all.push(...candlesFor(A, 24, (c) => { c[2] = [c[2][0], 100, 106.5, 100, 106]; for (let i = 3; i < 24; i++) c[i] = [c[i][0], 106, 106.1, 105.9, 106]; }));
// B: short, el precio sube (SL) y cierra arriba
const B = t0 + 100 * H;  all.push(...candlesFor(B, 24, (c) => { c[1] = [c[1][0], 100, 102.5, 100, 102.2]; for (let i = 2; i < 24; i++) c[i] = [c[i][0], 102, 102.1, 101.9, 102]; }));
// C: long, plano -> expira, cierra en 100
const C = t0 + 200 * H;  all.push(...candlesFor(C, 24, () => {}));
// D: long, ventana incompleta (10 de 24 velas), sin toque -> sigue abierta
const D = t0 + 300 * H;  all.push(...candlesFor(D, 10, () => {}));
// E: long, TP1 y SL en la misma vela -> SL primero
const E = t0 + 400 * H;  all.push(...candlesFor(E, 24, (c) => { c[0] = [c[0][0], 100, 105, 97, 100]; }));
// F: long, TP1 en vela 2 (sin TP2) y luego cae a 99 al cierre (TP hit pero dirección incorrecta)
const F = t0 + 500 * H;  all.push(...candlesFor(F, 24, (c) => { c[1] = [c[1][0], 100, 104.5, 100, 104]; for (let i = 2; i < 24; i++) c[i] = [c[i][0], 99, 99.1, 98.9, 99]; }));

for (const [id, d, ts] of [['A','long',A],['B','short',B],['C','long',C],['D','long',D],['E','long',E],['F','long',F]] as const) svc.upsertRegisteredTradeOption(mk(id, d, ts));
// Candles deben estar ordenadas como las devuelve fetchOkxCandles (ascendente)
all.sort((x, y) => x[0] - y[0]);
const { all: res } = svc.evaluateTradeOptionsWithCandles('btc', all as any);
const g = (id: string) => res.find((r: any) => r.id === id)!;
const show = (id: string) => { const r: any = g(id); return `${id}: ${r.status} tp2=${r.tp2Hit} dir=${r.dirCorrect} ret=${r.closeRetPct} mirror=${r.mirrorStatus} done=${r.horizonDone} pnl=${r.realizedPnlPct}`; };
['A','B','C','D','E','F'].forEach((i) => console.log(show(i)));

const check = (name: string, cond: boolean) => { console.log((cond ? 'OK   ' : 'FALLA'), name); if (!cond) process.exitCode = 1; };
check('A tp_hit, tp2, dir ok, espejo sl', g('A').status==='tp_hit' && g('A').tp2Hit===true && g('A').dirCorrect===true && g('A').mirrorStatus==='sl_hit');
check('B sl_hit, dir mal, espejo no llega a TP (+2,5 % < +4 %)', g('B').status==='sl_hit' && g('B').dirCorrect===false && g('B').mirrorStatus==='expired');
check('C expired, dir false (ret 0), espejo expired', g('C').status==='expired' && g('C').dirCorrect===false && g('C').mirrorStatus==='expired');
check('D abierta y sin horizonte', g('D').status==='open' && !g('D').horizonDone);
check('E SL primero en misma vela', g('E').status==='sl_hit');
check('F tp_hit, tp2 false, dir incorrecta', g('F').status==='tp_hit' && g('F').tp2Hit===false && g('F').dirCorrect===false);
// idempotencia
const again = svc.evaluateTradeOptionsWithCandles('btc', all as any);
check('segunda pasada sin cambios', again.changed === false);

const ev = buildEvaluation(res);
console.log(JSON.stringify({ n: ev.overall.n, tp: ev.overall.tpHit, sl: ev.overall.slHit, exp: ev.overall.expired, tpRate: ev.overall.tpRatePct, win: ev.overall.winDecidedPct, mirror: ev.overall.mirrorTpRatePct, dirN: ev.overall.dirN, dirAcc: ev.overall.dirAccPct, indep: ev.overall.dirIndepN, be: ev.overall.breakevenPct, verdict: ev.verdict.level }));
check('verdict insuficiente con 5 muestras', ev.verdict.level === 'insufficient');
// verdict con muestra grande: 60 independientes, 40 aciertos
const rows = Array.from({ length: 60 }, (_, i) => mk('x'+i, 'long', t0 + i * 30 * H, { status: 'tp_hit', dirCorrect: i < 40, mirrorStatus: 'sl_hit', horizonDone: true, closeRetPct: 1 })) as any;
const big = buildEvaluation(rows);
console.log(big.verdict.level, big.overall.dirIndepN, big.overall.dirIndepAccPct, big.overall.dirCi95, big.overall.dirPValue);
check('verdict edge con 40/60', big.verdict.level === 'edge');
const coin = buildEvaluation(Array.from({ length: 60 }, (_, i) => mk('y'+i, 'long', t0 + i * 30 * H, { status: 'sl_hit', dirCorrect: i % 2 === 0, horizonDone: true })) as any);
check('verdict no_edge con 30/60', coin.verdict.level === 'no_edge');
// solape: 60 opciones cada 4h con horizonte 24h -> independientes ~ 60*4/24 = 10
const ov = buildEvaluation(Array.from({ length: 60 }, (_, i) => mk('z'+i, 'long', t0 + i * 4 * H, { status: 'tp_hit', dirCorrect: true, horizonDone: true })) as any);
check('independientes por solape (~10)', ov.overall.dirIndepN >= 9 && ov.overall.dirIndepN <= 11);

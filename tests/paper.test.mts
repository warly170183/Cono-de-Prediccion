import { simulatePaper } from '../server/paperTrading.ts';
import type { RegisteredTradeOption } from '../server/types.ts';
let fail = 0;
const ok = (c: boolean, m: string) => { console.log((c ? 'OK    ' : 'FALLO ') + m); if (!c) fail++; };
const H = 3_600_000, T0 = Date.UTC(2026, 0, 5, 0);
let n = 0;
function opt(o: Partial<RegisteredTradeOption>): RegisteredTradeOption {
  n++;
  return { id: `o${n}`, asset: 'btc', strategyKey: 'trend_pullback', title: '', dir: 'long', horizonHours: 24, createdTs: T0, createdIso: '',
    entryPrice: 100, entryLow: 100, entryHigh: 100, stopLoss: 98, slPct: 2, takeProfit1: 104, tp1Pct: 4, takeProfit2: 106, rr: 2, probTpPct: 40,
    evPct: 0.5, confluenceScore: 70, confidence: 'Alta', source: 'auto', status: 'tp_hit', evaluatedTs: T0 + 5 * H, exitPrice: 104,
    realizedPnlPct: 4, mfePct: 4, maePct: 0, summary: '', verdict: 'validada', ...o } as RegisteredTradeOption;
}
// TP = +2R con riesgo 0,5 % => +1 % de capital
let r = simulatePaper([opt({})]);
ok(Math.abs(r.stats.total_return_pct - 1) < 0.01, `TP de 2R con 0,5 % de riesgo => +1 % (${r.stats.total_return_pct})`);
r = simulatePaper([opt({ status: 'sl_hit', realizedPnlPct: -2, exitPrice: 98 })]);
ok(Math.abs(r.stats.total_return_pct + 0.5) < 0.01, `SL => -0,5 % (${r.stats.total_return_pct})`);
r = simulatePaper([opt({ verdict: 'dudosa' })]);
ok(r.trades.length === 0 && r.skipped[0]?.reason === 'veredicto', 'veredicto insuficiente no se ejecuta');
r = simulatePaper([opt({ verdict: 'dudosa' })], { minVerdict: 'todas' });
ok(r.trades.length === 1, 'con minVerdict=todas sí se ejecuta');
// correlación: BTC y ETH largos a la vez con tope direccional 1 % y riesgo 0,5 => caben 2
r = simulatePaper([opt({ asset: 'btc' }), opt({ asset: 'eth', createdTs: T0 + H }), opt({ asset: 'sol', createdTs: T0 + 2 * H })]);
ok(r.trades.length === 2 && r.skipped.some((s) => s.reason === 'riesgo_direccional'), 'tope direccional bloquea la tercera operación correlacionada');
// activo ocupado
r = simulatePaper([opt({}), opt({ createdTs: T0 + H })]);
ok(r.skipped.some((s) => s.reason === 'activo_ocupado'), 'un activo no abre dos a la vez');
// riesgo diario
r = simulatePaper([opt({ dir: 'long' }), opt({ asset: 'eth', dir: 'short', createdTs: T0 + H }), opt({ asset: 'sol', dir: 'short', createdTs: T0 + 2 * H }), opt({ asset: 'btc', dir: 'long', createdTs: T0 + 8 * H }), opt({ asset: 'eth', dir: 'long', createdTs: T0 + 9 * H })],
  { riskPct: 0.5, maxDailyRiskPct: 1 });
ok(r.skipped.some((s) => s.reason === 'riesgo_diario'), 'tope de riesgo diario');
// parada por drawdown
const losers = Array.from({ length: 12 }, (_, i) => opt({ createdTs: T0 + i * 48 * H, evaluatedTs: T0 + i * 48 * H + 5 * H, status: 'sl_hit', realizedPnlPct: -2 }));
r = simulatePaper(losers, { riskPct: 1, maxDrawdownStopPct: 5, maxDirRiskPct: 5, maxDailyRiskPct: 5 });
ok(r.stats.halted && r.stats.max_dd_pct >= 5 && r.trades.length < 12, `parada por drawdown (${r.trades.length} ops, DD ${r.stats.max_dd_pct} %)`);
// abierta: no liquida
r = simulatePaper([opt({ status: 'open', evaluatedTs: null, realizedPnlPct: null })]);
ok(r.stats.n_open === 1 && r.stats.open_risk_pct === 0.5 && r.stats.total_return_pct === 0, 'operación abierta cuenta como riesgo, no como resultado');
if (fail) process.exit(1);

// Prueba de extremo a extremo de computeTradeOptions con un OKX simulado (fetch sustituido).
import fs from 'fs';
import os from 'os';
import path from 'path';
process.env.JOURNAL_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-'));
process.env.DATA_DIR = process.env.JOURNAL_DIR;
const check = (name: string, cond: boolean) => { console.log((cond ? 'OK   ' : 'FALLA'), name); if (!cond) process.exitCode = 1; };

const H = 3_600_000;
const DAY = 24 * H;
const lastHour = Math.floor(Date.now() / H) * H - H; // última vela cerrada
const N = 5200;
let seed = 11;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const hourly: number[][] = [];
{
  let p = 150;
  for (let i = 0; i < N; i++) {
    const ts = lastHour - (N - 1 - i) * H;
    const o = p;
    const c = p * (1 + 0.00005 + (rnd() - 0.5) * 0.006);
    hourly.push([ts, o, Math.max(o, c) * 1.0015, Math.min(o, c) * 0.9985, c, 1000 + rnd() * 500]);
    p = c;
  }
}
const daily: number[][] = [];
{
  const firstDay = Math.ceil(hourly[0][0] / DAY) * DAY;
  for (let d = firstDay; d + DAY <= lastHour + H; d += DAY) {
    const day = hourly.filter((c) => c[0] >= d && c[0] < d + DAY);
    if (day.length === 24) daily.push([d, day[0][1], Math.max(...day.map((c) => c[2])), Math.min(...day.map((c) => c[3])), day[23][4], day.reduce((s, c) => s + c[5], 0)]);
  }
}
const row = (c: number[]) => [String(c[0]), String(c[1]), String(c[2]), String(c[3]), String(c[4]), String(c[5]), '0', '0', '1'];
const page = (src: number[][], after: string | null) => {
  const older = after ? src.filter((c) => c[0] < Number(after)) : src;
  return older.slice(-100).reverse().map(row);
};
let calls = 0;
globalThis.fetch = (async (input: any) => {
  calls++;
  const url = new URL(String(input));
  const q = url.searchParams;
  const json = (data: unknown) => new Response(JSON.stringify({ code: '0', data }), { status: 200 });
  if (url.pathname.endsWith('/market/candles') || url.pathname.endsWith('/market/history-candles')) {
    const src = q.get('bar') === '1D' ? daily : hourly;
    return json(page(src, url.pathname.endsWith('history-candles') ? q.get('after') : null));
  }
  if (url.pathname.includes('/rubik/')) {
    if (q.get('end')) return json([]);
    return json(daily.slice(-100).reverse().map((d, i) => [String(d[0]), String(1000 + i), String(1.1 + (i % 7) / 10)]));
  }
  if (url.pathname.endsWith('/public/funding-rate-history')) {
    if (q.get('after')) return json([]);
    return json(Array.from({ length: 100 }, (_, i) => ({ fundingTime: String(lastHour - i * 8 * H), realizedRate: String(0.0001 * Math.sin(i / 5)) })));
  }
  return new Response('{}', { status: 404 });
}) as any;

const root = new URL('../server/', import.meta.url);
const svc = await import(new URL('tradeOptionsService.ts', root).href);
const t = Date.now();
const out = await svc.computeTradeOptions('sol', true, true);
console.log(`computeTradeOptions: ${Date.now() - t} ms, ${calls} llamadas simuladas`);
console.log(JSON.stringify({
  proposals: out.proposals.map((p: any) => `${p.strategyKey}:${p.dir} q${p.quality} ${p.verdict} rec=${p.recommended} sl${p.slPct} tp${p.tp1Pct}`),
  skipped: out.skipped.map((s: any) => `${s.strategyKey}: ${s.reason}`),
  tracks: out.strategyTracks.map((x: any) => `${x.strategyKey} bt${x.btN}/${x.btWinPct}%/${x.btExpR}R ${x.verdict}`),
  htf: out.htf,
}, null, 1));

check('respuesta con proposals / skipped / strategyTracks', Array.isArray(out.proposals) && Array.isArray(out.skipped) && out.strategyTracks.length === 4);
check('cada estrategia aparece una sola vez entre propuestas y omitidas', out.proposals.length + out.skipped.length === 4);
check('backtest con operaciones y días > 0', out.strategyTracks.some((x: any) => x.btN > 0) && out.strategyTracks[0].btDays > 50);
check('todas las propuestas cumplen R ≥ 1,3 y SL ≥ 0,8 %', out.proposals.every((p: any) => p.slPct >= 0.8 && p.tp1Pct >= 1.3 * p.slPct - 1e-6));
check('con pocos datos nada se marca como recomendado', out.proposals.every((p: any) => !p.recommended || p.track.n >= 20));
check('propuestas con calidad, veredicto y track', out.proposals.every((p: any) => p.quality >= 20 && p.quality <= 98 && !!p.verdict && p.track));
check('sin ventaja medida => riesgo sugerido 0', out.proposals.every((p: any) => p.verdict === 'validada' || p.kellyPct === 0));
const reg = svc.loadRegisteredTradeOptions();
check('se registran solo las propuestas emitidas', reg.length === out.proposals.length);
check('los registros llevan quality y verdict', reg.every((r: any) => typeof r.quality === 'number' && typeof r.verdict === 'string'));
const t2 = Date.now();
await svc.computeTradeOptions('sol', true, true);
check('el backtest se reutiliza (2.ª llamada rápida)', Date.now() - t2 < 8000);
check('segunda pasada no duplica registros', svc.loadRegisteredTradeOptions().length === reg.length);
check('stats.evaluation incluye byVerdict', Array.isArray(out.stats.evaluation.byVerdict));

import { fetchOkxCandles, getDegradedSources } from '../server/marketData.ts';
let fail = 0;
const ok = (c: boolean, m: string) => { console.log((c ? 'OK    ' : 'FALLO ') + m); if (!c) fail++; };
let up = true;
const rows = Array.from({ length: 100 }, (_, i) => [String(1_700_000_000_000 - i * 86_400_000), '1', '2', '0.5', '1.5', '10', '0', '0', '1']);
(globalThis as any).fetch = async () => {
  if (!up) throw new Error('red caída');
  return { ok: true, status: 200, json: async () => ({ code: '0', data: rows }) } as Response;
};
const a = await fetchOkxCandles('btc', '1D', 100, false);
ok(a.length > 50 && getDegradedSources().length === 0, 'con la API activa no hay degradado');
up = false;
const b = await fetchOkxCandles('btc', '1D', 100, true);
ok(b.length === a.length, 'si la API cae sirve el último dato');
ok(getDegradedSources().length === 1, 'la fuente queda marcada como degradada');
let threw = false;
try { await fetchOkxCandles('eth', '1D', 100, true); } catch { threw = true; }
ok(threw, 'sin dato previo el error se propaga');
up = true;
await fetchOkxCandles('btc', '1D', 100, true);
ok(getDegradedSources().length === 0, 'al recuperarse se limpia el estado degradado');
if (fail) process.exit(1);

const check = (name: string, cond: boolean) => { console.log((cond ? 'OK   ' : 'FALLA'), name); if (!cond) process.exitCode = 1; };
const q = await import(new URL('../server/quantEngine.ts', import.meta.url).href);

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const now = Date.now();
const spot = 100000;
const expName = (days: number) => {
  const d = new Date(now + days * 86400000);
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 8);
  return { name: `${d.getUTCDate()}${MON[d.getUTCMonth()]}${String(d.getUTCFullYear()).slice(2)}`, days: (t - now) / 86400000 };
};
const chain: any[] = [];
for (const days of [6, 31, 62]) {
  const e = expName(days);
  if (e.days < 1) continue;
  for (let k = 70000; k <= 130000; k += 5000) {
    const m = Math.log(k / spot);
    // sonrisa con skew defensivo: los puts de strikes bajos tienen más IV
    const ivC = 55 + 40 * m * m * 10 - 8 * m * 10;
    const ivP = 55 + 40 * m * m * 10 - 20 * m * 10;
    // OI: muros de put en 90k y de call en 110k
    const oiC = k === 110000 ? 800 : 60 + (k > spot ? 40 : 10);
    const oiP = k === 90000 ? 900 : 60 + (k < spot ? 40 : 10);
    chain.push({ instrument_name: `BTC-${e.name}-${k}-C`, mark_iv: ivC, open_interest: oiC, underlying_price: spot });
    chain.push({ instrument_name: `BTC-${e.name}-${k}-P`, mark_iv: ivP, open_interest: oiP, underlying_price: spot });
  }
}
const g = q.computeGex('btc', { ts: now, index: spot, chain });
console.log(JSON.stringify({ flip: g.flip, cw: g.call_wall, pw: g.put_wall, mp: g.max_pain, skew: g.skew25, term: g.atm_term }));
check('call wall en 110k y put wall en 90k', g.call_wall === 110000 && g.put_wall === 90000);
check('max pain para 3 vencimientos', g.max_pain.length === 3 && g.max_pain.every((m: any) => m.strike >= 70000 && m.strike <= 130000));
check('max pain minimiza el pago (fuerza bruta)', (() => {
  const e = expName(31); const name = e.name;
  const opts = chain.filter((o) => o.instrument_name.includes(`-${name}-`));
  const pain = (K: number) => opts.reduce((s, o) => { const [, , ks, cp] = o.instrument_name.split('-'); const k = Number(ks); return s + o.open_interest * (cp === 'C' ? Math.max(0, K - k) : Math.max(0, k - K)); }, 0);
  let best = 0, bp = Infinity; for (let K = 70000; K <= 130000; K += 5000) { const p = pain(K); if (p < bp) { bp = p; best = K; } }
  return g.max_pain.some((m: any) => m.expiry === name && m.strike === best);
})());
check('skew defensivo: RR25 < 0', g.skew25 !== null && g.skew25.rr25 < 0);
check('skew sobre el vencimiento más cercano a 30 d', g.skew25 !== null && g.skew25.days > 25 && g.skew25.days < 36);
check('estructura temporal ordenada por días', g.atm_term.every((t: any, i: number, a: any[]) => i === 0 || t.days > a[i - 1].days));
check('flip es el cruce más cercano al spot', (() => {
  const pr = g.profile as Array<{ spot: number; gex_m: number }>;
  const xs: number[] = [];
  for (let i = 0; i < pr.length - 1; i++) if (pr[i].gex_m * pr[i + 1].gex_m < 0) xs.push((pr[i].spot + pr[i + 1].spot) / 2);
  if (g.flip === null) return xs.length === 0;
  const nearest = xs.reduce((b, x) => (Math.abs(x - spot) < Math.abs(b - spot) ? x : b), xs[0]);
  return Math.abs(nearest - g.flip) / spot < 0.03;
})());

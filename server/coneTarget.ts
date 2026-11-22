/**
 * Probabilidad de que el precio alcance un nivel objetivo, según el cono GJR-GARCH + ensamble HAR.
 * Usa los mismos caminos y el mismo escalado de ensamble que el cono que se dibuja.
 * No contiene ventaja direccional: es la probabilidad de la volatilidad, no una predicción.
 */
import type { AssetId, TargetProbability } from './types.ts';
import { fetchOkxCandles } from './marketData.ts';
import { computeEnsembleRatio, fitGjrGarch, simulateGarchPaths } from './quantEngine.ts';

const H = 72;
const N = 4000;
const BGK = 0.5826; // corrección de toque intravela (Broadie-Glasserman-Kou)

interface State {
  ts: number;
  spot: number;
  sigmaStepPct: number;
  r24: number;
  r72: number;
  /** Caminos ya escalados por el ensamble: log-retorno acumulado por paso. */
  scaled: Float64Array[];
}
const cache = new Map<string, State>();

const ratioAt = (step: number, r24: number, r72: number) =>
  step <= 24 ? 1 + (r24 - 1) * (step / 24) : r24 + (r72 - r24) * ((step - 24) / 48);

async function getState(asset: AssetId, refresh: boolean): Promise<State> {
  const c = cache.get(asset);
  if (!refresh && c && Date.now() - c.ts < 5 * 60_000) return c;
  const candles = await fetchOkxCandles(asset, '1H', 1100, refresh);
  const closes = candles.map((x) => x[4]);
  const lr: number[] = [];
  for (let i = 1; i < closes.length; i++) lr.push(Math.log(closes[i] / closes[i - 1]));
  const rPct = lr.map((x) => x * 100);
  const fit = fitGjrGarch(rPct);
  const paths = simulateGarchPaths(fit, rPct[rPct.length - 1], H, N, 21, false);
  const ens = computeEnsembleRatio(lr, fit, [24, 72]);
  const r24 = ens[24] ?? 1;
  const r72 = ens[72] ?? 1;
  const scaled = paths.map((p) => {
    const q = new Float64Array(H);
    for (let s = 0; s < H; s++) q[s] = p[s] * ratioAt(s + 1, r24, r72);
    return q;
  });
  const st: State = {
    ts: Date.now(),
    spot: closes[closes.length - 1],
    sigmaStepPct: fit.condVolPct[fit.condVolPct.length - 1],
    r24,
    r72,
    scaled,
  };
  cache.set(asset, st);
  return st;
}

const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))];

export async function computeTargetProbability(
  asset: AssetId,
  price: number,
  hours: number,
  refresh = false,
): Promise<TargetProbability> {
  const st = await getState(asset, refresh);
  const h = Math.min(H, Math.max(1, Math.round(hours)));
  const b = Math.log(price / st.spot);
  const sigma = st.sigmaStepPct / 100;
  const shift = BGK * sigma;

  let touched = 0;
  let above = 0;
  const hitSteps: number[] = [];
  for (const p of st.scaled) {
    if (p[h - 1] > b) above++;
    if (Math.abs(b) < 1e-9) continue;
    const barrier = b > 0 ? b - shift : b + shift;
    for (let s = 0; s < h; s++) {
      if (b > 0 ? p[s] >= barrier : p[s] <= barrier) {
        touched++;
        hitSteps.push(s + 1);
        break;
      }
    }
  }
  const atSpot = Math.abs(b) < 1e-9;
  hitSteps.sort((x, y) => x - y);
  const finals = st.scaled.map((p) => st.spot * Math.exp(p[h - 1])).sort((x, y) => x - y);
  const pct = (v: number) => Number((v * 100).toFixed(1));
  return {
    asset,
    spot: st.spot,
    price,
    distPct: Number(((price / st.spot - 1) * 100).toFixed(2)),
    hours: h,
    pTouchPct: atSpot ? 100 : pct(touched / N),
    pCloseAbovePct: pct(above / N),
    pCloseBelowPct: pct(1 - above / N),
    medianHoursToTouch: hitSteps.length ? hitSteps[Math.floor(hitSteps.length / 2)] : null,
    quantiles: {
      p5: Number(quantile(finals, 0.05).toFixed(2)),
      p25: Number(quantile(finals, 0.25).toFixed(2)),
      p50: Number(quantile(finals, 0.5).toFixed(2)),
      p75: Number(quantile(finals, 0.75).toFixed(2)),
      p95: Number(quantile(finals, 0.95).toFixed(2)),
    },
    sigmaHourPct: Number(st.sigmaStepPct.toFixed(3)),
    ensRatio: { '24': Number(st.r24.toFixed(3)), '72': Number(st.r72.toFixed(3)) },
    generated: Date.now(),
  };
}

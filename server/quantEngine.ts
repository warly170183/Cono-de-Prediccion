import type {
  AssetId,
  BiasAnalysisOutput,
  BiasRuleResult,
  Candle,
  ConeBlock,
  ContrarianEvent,
  DerivativesReadings,
  GarchParams,
  GexOutput,
  GexStrikeRow,
  GexTermBucket,
  IvSmilePoint,
  OptionsConeHorizon,
  OptionsConeOutput,
  RegimeInfo,
  TradeAnalysisOutput,
  TradeGridRow,
  WalkForwardHorizon,
  WalkForwardOutput,
} from './types.ts';
import type { DeribitOptionSummary } from './marketData.ts';

const QS = [5, 10, 25, 50, 75, 90, 95] as const;

// Deterministic PRNG (Mulberry32) so simulations are reproducible per request
function createRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lnGamma(z: number): number {
  const c = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-3, -0.5395239384953e-5,
  ];
  let x = z;
  let y = z;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) {
    ser += c[j] / ++y;
  }
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t) *
      Math.exp(-ax * ax);
  return sign * y;
}

function normCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

function normPpf(p: number): number {
  if (p <= 0) return -8;
  if (p >= 1) return 8;
  // Acklam's inverse normal CDF approximation
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= pHigh) {
    const q = p - 0.5;
    const r = q * q;
    return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

function chi2Survival1(lr: number): number {
  if (!Number.isFinite(lr) || lr <= 0) return 1.0;
  return Math.min(1, Math.max(0, 2 * (1 - normCdf(Math.sqrt(lr)))));
}

function chi2Survival2(lr: number): number {
  if (!Number.isFinite(lr) || lr <= 0) return 1.0;
  return Math.min(1, Math.max(0, Math.exp(-lr / 2)));
}

function studentTCdfApprox(tVal: number, df: number): number {
  // Normal approximation with Cornish-Fisher adjustment for two-sided p-value
  if (df <= 2) return 0.5 * (1 + erf(tVal / Math.SQRT2));
  const z = tVal * (1 - 1 / (4 * df)) / Math.sqrt(1 + (tVal * tVal) / (2 * df));
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function mean(arr: number[]): number {
  if (!arr.length) return 0;
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s / arr.length;
}

function std(arr: number[], ddof = 0): number {
  if (arr.length <= ddof) return 0;
  const m = mean(arr);
  let s = 0;
  for (let i = 0; i < arr.length; i++) {
    const d = arr[i] - m;
    s += d * d;
  }
  return Math.sqrt(s / (arr.length - ddof));
}

export interface GarchFitResult {
  params: GarchParams;
  condVolPct: number[];
  stdResids: number[];
}

/**
 * Fits GJR-GARCH(1,1) with Student-t innovations via Nelder-Mead MLE.
 * rPct = log_returns * 100.
 */
export function fitGjrGarch(rPct: number[]): GarchFitResult {
  const n = rPct.length;
  const v0 = Math.max(std(rPct) ** 2, 1e-4);

  // Neg-log-likelihood for Student-t GJR-GARCH(1,1)
  // theta = [log(omega), logit(alpha_raw), logit(gamma_share), logit(beta_raw), log(nu - 2.2)]
  const sig = (x: number) => 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, x))));

  function unpack(th: number[]) {
    const omega = Math.exp(Math.max(-14, Math.min(4, th[0])));
    const persist = 0.996 * sig(th[1]);
    const alpha = persist * sig(th[2]) * 0.45;
    const gamma = persist * sig(th[3]) * 0.45;
    const beta = Math.max(0.01, persist - alpha - 0.5 * gamma);
    const nu = 2.2 + Math.exp(Math.max(-3, Math.min(4, th[4])));
    return { omega, alpha, gamma, beta, nu };
  }

  function nll(th: number[]): number {
    const { omega, alpha, gamma, beta, nu } = unpack(th);
    if (alpha + 0.5 * gamma + beta >= 0.999) return 1e12;
    const c =
      lnGamma((nu + 1) / 2) -
      lnGamma(nu / 2) -
      0.5 * Math.log(Math.PI * (nu - 2));

    let h = v0;
    let ll = 0;
    for (let t = 0; t < n; t++) {
      if (t > 0) {
        const rPrev = rPct[t - 1];
        const ind = rPrev < 0 ? 1 : 0;
        h = omega + (alpha + gamma * ind) * (rPrev * rPrev) + beta * h;
        if (h < 1e-8) h = 1e-8;
      }
      const r = rPct[t];
      ll += c - 0.5 * Math.log(h) - ((nu + 1) / 2) * Math.log(1 + (r * r) / ((nu - 2) * h));
    }
    return -ll;
  }

  // Initial parameter guess typical for 1H/1D crypto GJR-GARCH
  const init = [
    Math.log(Math.max(1e-6, v0 * 0.04)),
    2.4, // persist ~ 0.91
    -1.2, // alpha share
    -1.0, // gamma share
    Math.log(4.5), // nu ~ 6.7
  ];

  // Lightweight Nelder-Mead (80 iterations)
  const dim = init.length;
  const simplex: Array<{ x: number[]; fx: number }> = [
    { x: init, fx: nll(init) },
  ];
  for (let i = 0; i < dim; i++) {
    const x = [...init];
    x[i] += 0.35;
    simplex.push({ x, fx: nll(x) });
  }

  for (let iter = 0; iter < 85; iter++) {
    simplex.sort((a, b) => a.fx - b.fx);
    const best = simplex[0];
    const worst = simplex[dim];
    const secondWorst = simplex[dim - 1];

    const centroid = new Array<number>(dim).fill(0);
    for (let i = 0; i < dim; i++) {
      for (let j = 0; j < dim; j++) centroid[j] += simplex[i].x[j] / dim;
    }

    const reflect = centroid.map((c, j) => c + 1.0 * (c - worst.x[j]));
    const fr = nll(reflect);

    if (fr < best.fx) {
      const expand = centroid.map((c, j) => c + 2.0 * (reflect[j] - c));
      const fe = nll(expand);
      simplex[dim] = fe < fr ? { x: expand, fx: fe } : { x: reflect, fx: fr };
    } else if (fr < secondWorst.fx) {
      simplex[dim] = { x: reflect, fx: fr };
    } else {
      const contract =
        fr < worst.fx
          ? centroid.map((c, j) => c + 0.5 * (reflect[j] - c))
          : centroid.map((c, j) => c + 0.5 * (worst.x[j] - c));
      const fc = nll(contract);
      if (fc < worst.fx) {
        simplex[dim] = { x: contract, fx: fc };
      } else {
        for (let i = 1; i <= dim; i++) {
          simplex[i].x = simplex[i].x.map((v, j) => best.x[j] + 0.5 * (v - best.x[j]));
          simplex[i].fx = nll(simplex[i].x);
        }
      }
    }
  }

  simplex.sort((a, b) => a.fx - b.fx);
  const { omega, alpha, gamma, beta, nu } = unpack(simplex[0].x);
  const persistence = alpha + 0.5 * gamma + beta;

  const condVolPct = new Array<number>(n);
  const stdResids = new Array<number>(n);
  let h = v0;
  for (let t = 0; t < n; t++) {
    if (t > 0) {
      const rPrev = rPct[t - 1];
      const ind = rPrev < 0 ? 1 : 0;
      h = Math.max(1e-8, omega + (alpha + gamma * ind) * (rPrev * rPrev) + beta * h);
    }
    const s = Math.sqrt(h);
    condVolPct[t] = s;
    stdResids[t] = rPct[t] / s;
  }

  return {
    params: { omega, alpha, gamma, beta, nu, persistence },
    condVolPct,
    stdResids,
  };
}

/**
 * Bootstrap GJR-GARCH simulation returning cumulative log returns (N x H).
 */
export function simulateGarchPaths(
  fit: GarchFitResult,
  lastReturnPct: number,
  H: number,
  N: number,
  seed = 7,
  martingaleAdjust = false,
): Float64Array[] {
  const rng = createRng(seed);
  const { omega, alpha, gamma, beta } = fit.params;
  const hLast = fit.condVolPct[fit.condVolPct.length - 1] ** 2;
  const resids = fit.stdResids;
  const rLen = resids.length;

  const cumPaths: Float64Array[] = new Array(N);
  for (let i = 0; i < N; i++) {
    const path = new Float64Array(H);
    let h = hLast;
    let prevR = lastReturnPct;
    let cum = 0;
    for (let step = 0; step < H; step++) {
      const ind = prevR < 0 ? 1 : 0;
      h = Math.max(1e-8, omega + (alpha + gamma * ind) * (prevR * prevR) + beta * h);
      const z = resids[Math.floor(rng() * rLen)];
      const rPct = Math.sqrt(h) * z;
      prevR = rPct;
      cum += rPct / 100.0;
      path[step] = cum;
    }
    cumPaths[i] = path;
  }

  if (martingaleAdjust) {
    // adj[h] = -ln(mean(exp(cum[:, h]))) so E[S_{t+h}/S_t] = 1
    for (let step = 0; step < H; step++) {
      let sumExp = 0;
      for (let i = 0; i < N; i++) {
        sumExp += Math.exp(cumPaths[i][step]);
      }
      const adj = -Math.log(sumExp / N);
      for (let i = 0; i < N; i++) {
        cumPaths[i][step] += adj;
      }
    }
  }

  return cumPaths;
}

/**
 * Analytical GARCH multi-step cumulative variance forecast (sigma_garch).
 */
function sigmaGarchAnalytical(fit: GarchFitResult, lastReturnPct: number, horizons: number[]): Record<number, number> {
  const maxH = Math.max(...horizons);
  const { omega, alpha, gamma, beta, persistence } = fit.params;
  const hLast = fit.condVolPct[fit.condVolPct.length - 1] ** 2;
  const ind = lastReturnPct < 0 ? 1 : 0;
  let h1 = Math.max(1e-8, omega + (alpha + gamma * ind) * (lastReturnPct * lastReturnPct) + beta * hLast);

  const cumVar = new Array<number>(maxH);
  let running = 0;
  let hCurr = h1;
  for (let step = 0; step < maxH; step++) {
    if (step > 0) {
      hCurr = omega + persistence * hCurr;
    }
    running += hCurr / 10_000; // (%^2) -> decimal variance
    cumVar[step] = running;
  }

  const out: Record<number, number> = {};
  for (const h of horizons) {
    out[h] = Math.sqrt(Math.max(1e-12, cumVar[h - 1]));
  }
  return out;
}

/**
 * Gaussian elimination solver for small (4x4) OLS linear systems: A x = b.
 */
function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[pivot][col])) pivot = row;
    }
    [M[col], M[pivot]] = [M[pivot], M[col]];
    const diag = M[col][col] || 1e-12;
    for (let j = col; j <= n; j++) M[col][j] /= diag;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = M[row][col];
      for (let j = col; j <= n; j++) M[row][j] -= factor * M[col][j];
    }
  }
  return M.map((row) => row[n]);
}

/**
 * HAR-RV OLS forecast + GARCH+HAR geometric ensemble ratio (from src/volmodels.py).
 */
export function computeEnsembleRatio(
  logReturns: number[],
  fit: GarchFitResult,
  horizons: number[] = [24, 72],
): Record<number, number> {
  const n = logReturns.length;
  if (n < 800) {
    return Object.fromEntries(horizons.map((h) => [h, 1.0]));
  }

  const cs = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    cs[i + 1] = cs[i] + logReturns[i] * logReturns[i];
  }
  const rvMean = (lo: number, hi: number) => (cs[hi] - cs[lo]) / Math.max(1, hi - lo);

  const gSigma = sigmaGarchAnalytical(fit, logReturns[n - 1] * 100, horizons);
  const ratio: Record<number, number> = {};

  for (const h of horizons) {
    const X: number[][] = [];
    const y: number[] = [];
    for (let j = 720; j <= n - h; j += 6) {
      X.push([
        1,
        Math.log(rvMean(j - 24, j) + 1e-12),
        Math.log(rvMean(j - 168, j) + 1e-12),
        Math.log(rvMean(j - 720, j) + 1e-12),
      ]);
      y.push(Math.log(rvMean(j, j + h) + 1e-12));
    }

    // Normal equations X^T X beta = X^T y
    const p = 4;
    const XtX = Array.from({ length: p }, () => new Array<number>(p).fill(0));
    const Xty = new Array<number>(p).fill(0);
    for (let i = 0; i < X.length; i++) {
      const row = X[i];
      const yi = y[i];
      for (let a = 0; a < p; a++) {
        Xty[a] += row[a] * yi;
        for (let b = 0; b < p; b++) {
          XtX[a][b] += row[a] * row[b];
        }
      }
    }
    // Small ridge for numerical stability
    for (let a = 1; a < p; a++) XtX[a][a] += 1e-8;
    const beta = solveLinearSystem(XtX, Xty);

    let smearSum = 0;
    for (let i = 0; i < X.length; i++) {
      const pred = X[i].reduce((s, v, k) => s + v * beta[k], 0);
      smearSum += Math.exp(y[i] - pred);
    }
    const smear = smearSum / X.length;

    const xNow = [
      1,
      Math.log(rvMean(n - 24, n) + 1e-12),
      Math.log(rvMean(n - 168, n) + 1e-12),
      Math.log(rvMean(n - 720, n) + 1e-12),
    ];
    const logPred = xNow.reduce((s, v, k) => s + v * beta[k], 0);
    const harSigma = Math.sqrt(Math.max(1e-12, h * Math.exp(logPred) * smear));
    ratio[h] = Math.sqrt(harSigma / gSigma[h]);
  }

  return ratio;
}

/**
 * Computes 3-state volatility/return regime (Calma / Normal / Turbulento).
 */
export function classifyRegime(closes: number[]): RegimeInfo {
  const lr: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    lr.push(Math.log(closes[i] / closes[i - 1]));
  }
  const nWin = 24;
  const vol: number[] = [];
  for (let i = 0; i < lr.length; i++) {
    const start = Math.max(0, i - nWin + 1);
    vol.push(std(lr.slice(start, i + 1)));
  }

  const pts: Array<[number, number]> = [];
  for (let i = nWin; i < lr.length; i++) {
    pts.push([lr[i] * 100, vol[i] * 100]);
  }
  const M = pts.length;
  if (M < 60) {
    return { current: 'Normal', probs: { Calma: 0.2, Normal: 0.6, Turbulento: 0.2 } };
  }

  // Initialize 3 states by volatility quantiles
  const sortedVols = pts.map((p) => p[1]).sort((a, b) => a - b);
  const means: Array<[number, number]> = [
    [0, percentile(sortedVols, 20)],
    [0, percentile(sortedVols, 55)],
    [0, percentile(sortedVols, 88)],
  ];
  const vars: Array<[number, number]> = [
    [0.5, Math.max(0.02, sortedVols[Math.floor(M * 0.2)] ** 2)],
    [1.0, Math.max(0.05, sortedVols[Math.floor(M * 0.5)] ** 2)],
    [3.0, Math.max(0.15, sortedVols[Math.floor(M * 0.85)] ** 2)],
  ];
  const weights = [0.33, 0.34, 0.33];
  const resp = Array.from({ length: M }, () => [0, 0, 0]);

  for (let iter = 0; iter < 25; iter++) {
    // E-step
    for (let i = 0; i < M; i++) {
      const [x0, x1] = pts[i];
      let sum = 0;
      for (let k = 0; k < 3; k++) {
        const d0 = x0 - means[k][0];
        const d1 = x1 - means[k][1];
        const v0 = Math.max(1e-4, vars[k][0]);
        const v1 = Math.max(1e-4, vars[k][1]);
        const logP =
          Math.log(Math.max(1e-6, weights[k])) -
          0.5 * (Math.log(v0 * v1) + (d0 * d0) / v0 + (d1 * d1) / v1);
        resp[i][k] = Math.exp(Math.max(-50, logP));
        sum += resp[i][k];
      }
      const inv = sum > 0 ? 1 / sum : 1 / 3;
      for (let k = 0; k < 3; k++) resp[i][k] *= inv;
    }
    // M-step
    for (let k = 0; k < 3; k++) {
      let nk = 0;
      let m0 = 0;
      let m1 = 0;
      for (let i = 0; i < M; i++) {
        const r = resp[i][k];
        nk += r;
        m0 += r * pts[i][0];
        m1 += r * pts[i][1];
      }
      nk = Math.max(nk, 1e-4);
      weights[k] = nk / M;
      means[k][0] = m0 / nk;
      means[k][1] = m1 / nk;
      let v0 = 0;
      let v1 = 0;
      for (let i = 0; i < M; i++) {
        const r = resp[i][k];
        v0 += r * (pts[i][0] - means[k][0]) ** 2;
        v1 += r * (pts[i][1] - means[k][1]) ** 2;
      }
      vars[k][0] = Math.max(1e-3, v0 / nk);
      vars[k][1] = Math.max(1e-4, v1 / nk);
    }
  }

  const order = [0, 1, 2].sort((a, b) => means[a][1] - means[b][1]);
  const lastResp = resp[M - 1];
  const probs: Record<'Calma' | 'Normal' | 'Turbulento', number> = {
    Calma: Number(lastResp[order[0]].toFixed(4)),
    Normal: Number(lastResp[order[1]].toFixed(4)),
    Turbulento: Number(lastResp[order[2]].toFixed(4)),
  };

  let current: 'Calma' | 'Normal' | 'Turbulento' = 'Normal';
  if (probs.Calma >= probs.Normal && probs.Calma >= probs.Turbulento) current = 'Calma';
  else if (probs.Turbulento >= probs.Normal && probs.Turbulento >= probs.Calma) current = 'Turbulento';

  return { current, probs };
}

export function buildConeBlock(
  candles: Candle[],
  H: number,
  stepMs: number,
  N: number,
  label: '1H' | '1D',
  tail: number,
  ensRatio?: Record<number, number>,
): { block: ConeBlock; fit: GarchFitResult } {
  const closes = candles.map((c) => c[4]);
  const lr: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    lr.push(Math.log(closes[i] / closes[i - 1]));
  }
  const rPct = lr.map((x) => x * 100);
  const fit = fitGjrGarch(rPct);
  const cumPaths = simulateGarchPaths(fit, rPct[rPct.length - 1], H, N, label === '1H' ? 7 : 13, false);

  const spot = closes[closes.length - 1];
  const lastTs = candles[candles.length - 1][0];
  const ann = label === '1H' ? 24 * 365 : 365;

  const cone: Record<string, number[]> = {};
  for (const q of QS) {
    cone[String(q)] = [spot];
  }

  for (let step = 0; step < H; step++) {
    const vals = new Array<number>(N);
    for (let i = 0; i < N; i++) {
      vals[i] = spot * Math.exp(cumPaths[i][step]);
    }
    vals.sort((a, b) => a - b);
    for (const q of QS) {
      cone[String(q)].push(Number(percentile(vals, q).toFixed(2)));
    }
  }

  // Optional GARCH+HAR ensemble cone scaled smoothly across horizon
  let cone_ens: Record<string, number[]> | undefined;
  if (label === '1H' && ensRatio) {
    cone_ens = {};
    for (const q of QS) cone_ens[String(q)] = [spot];
    const r24 = ensRatio[24] ?? 1.0;
    const r72 = ensRatio[72] ?? 1.0;
    for (let step = 1; step <= H; step++) {
      const ratioAtH =
        step <= 24 ? 1 + (r24 - 1) * (step / 24) : r24 + (r72 - r24) * ((step - 24) / 48);
      for (const q of QS) {
        const v = cone[String(q)][step];
        cone_ens[String(q)].push(Number((spot * Math.exp(ratioAtH * Math.log(v / spot))).toFixed(2)));
      }
    }
  }

  const sample_paths: number[][] = [];
  for (let i = 0; i < Math.min(24, N); i++) {
    const p = [spot];
    for (let step = 0; step < H; step++) {
      p.push(Number((spot * Math.exp(cumPaths[i][step])).toFixed(2)));
    }
    sample_paths.push(p);
  }

  const condVol = fit.condVolPct[fit.condVolPct.length - 1] / 100;
  const histVol = fit.condVolPct.map((v) => v / 100);
  const leCount = histVol.filter((v) => v <= condVol).length;
  const vol_pctile = (leCount / histVol.length) * 100;

  const p_close_up: Record<string, number> = {};
  const horizonsUp = label === '1H' ? [1, 6, 24, 72] : [1, 7, 14, 30];
  for (const h of horizonsUp) {
    if (h <= H) {
      let up = 0;
      for (let i = 0; i < N; i++) {
        if (cumPaths[i][h - 1] > 0) up++;
      }
      p_close_up[`up_${h}`] = up / N;
    }
  }

  const move: Record<string, { p5: number; p50: number; p95: number }> = {};
  const moveHorizons = label === '1H' ? [24, 72] : [7, 30];
  for (const h of moveHorizons) {
    const vals = cumPaths.map((p) => p[h - 1]).sort((a, b) => a - b);
    move[String(h)] = {
      p5: Math.exp(percentile(vals, 5)) - 1,
      p50: Math.exp(percentile(vals, 50)) - 1,
      p95: Math.exp(percentile(vals, 95)) - 1,
    };
  }

  const levels =
    label === '1H'
      ? ([
          [0.02, 0.02],
          [0.03, 0.03],
          [0.05, 0.05],
        ] as const)
      : ([
          [0.05, 0.05],
          [0.1, 0.1],
          [0.15, 0.15],
        ] as const);

  const touch = levels.map(([up, dn]) => {
    const hiLog = Math.log(1 + up);
    const loLog = Math.log(1 - dn);
    let upFirst = 0;
    let dnFirst = 0;
    let none = 0;
    for (let i = 0; i < N; i++) {
      let iu = H + 1;
      let idn = H + 1;
      const p = cumPaths[i];
      for (let s = 0; s < H; s++) {
        if (iu > H && p[s] >= hiLog) iu = s;
        if (idn > H && p[s] <= loLog) idn = s;
        if (iu <= H && idn <= H) break;
      }
      if (iu < idn) upFirst++;
      else if (idn < iu) dnFirst++;
      else none++;
    }
    return {
      up,
      dn,
      up_first: upFirst / N,
      dn_first: dnFirst / N,
      none: none / N,
    };
  });

  const tailCandles = candles.slice(-tail).map((c) => [c[0], c[1], c[2], c[3], c[4]] as [number, number, number, number, number]);
  const vol_hist = histVol.slice(-tail).map((v) => v * Math.sqrt(ann));
  const vol_hist_ts = candles.slice(1).slice(-tail).map((c) => c[0]);

  return {
    block: {
      label,
      spot,
      last_ts: lastTs,
      step_ms: stepMs,
      H,
      candles: tailCandles,
      cone,
      cone_ens,
      sample_paths,
      garch: fit.params,
      vol_now_ann: condVol * Math.sqrt(ann),
      vol_pctile,
      vol_hist,
      vol_hist_ts,
      p_close_up,
      move,
      touch,
    },
    fit,
  };
}

/**
 * Computes Black-Scholes GEX (Gamma Exposure) from Deribit options snapshot (gex.py).
 */
export function computeGex(
  asset: 'btc' | 'eth',
  chainSnapshot: { ts: number; index: number; chain: DeribitOptionSummary[] },
): GexOutput {
  const nowSec = chainSnapshot.ts / 1000;
  const spot = chainSnapshot.index;
  const MON: Record<string, number> = {
    JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
    JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
  };

  interface ParsedOption {
    K: number;
    T: number;
    iv: number;
    oi: number;
    sg: number;
    fr: number;
    exp: number;
  }

  const parsed: ParsedOption[] = [];
  const prefix = asset.toUpperCase();
  const re = new RegExp(`^${prefix}-(\\d{1,2})([A-Z]{3})(\\d{2})-(\\d+)-([CP])$`);

  for (const o of chainSnapshot.chain) {
    const m = o.instrument_name.match(re);
    if (!m || !o.mark_iv || !o.open_interest || !o.underlying_price) continue;
    const [, dStr, monStr, yyStr, kStr, cp] = m;
    const expMs = Date.UTC(2000 + Number(yyStr), MON[monStr], Number(dStr), 8, 0, 0);
    const exp = expMs / 1000;
    const T = (exp - nowSec) / (365 * 86400);
    if (T <= 0.0005) continue;
    parsed.push({
      K: Number(kStr),
      T,
      iv: o.mark_iv / 100,
      oi: o.open_interest,
      sg: cp === 'C' ? 1 : -1,
      fr: o.underlying_price / spot,
      exp,
    });
  }

  const gexAt = (S: number, filterNear7d = false) => {
    let total = 0;
    for (const o of parsed) {
      if (filterNear7d && o.exp - nowSec > 7 * 86400) continue;
      const F = o.fr * S;
      const sqrtT = Math.sqrt(o.T);
      const d1 = (Math.log(F / o.K) + 0.5 * o.iv * o.iv * o.T) / (o.iv * sqrtT);
      const gamma = normPdf(d1) / (F * o.iv * sqrtT);
      total += o.sg * o.oi * gamma * S * S * 0.01;
    }
    return total;
  };

  const net = gexAt(spot, false);
  const net7d = gexAt(spot, true);

  // Spot profile ±25% (51 points)
  const profile: Array<{ spot: number; gex_m: number }> = [];
  let flip: number | null = null;
  const nGrid = 101;
  const loGrid = spot * 0.75;
  const hiGrid = spot * 1.25;
  const gridVals: Array<{ s: number; g: number }> = [];
  for (let i = 0; i < nGrid; i++) {
    const s = loGrid + ((hiGrid - loGrid) * i) / (nGrid - 1);
    const g = gexAt(s, false);
    gridVals.push({ s, g });
    if (i % 2 === 0) {
      profile.push({ spot: Number(s.toFixed(1)), gex_m: Number((g / 1e6).toFixed(2)) });
    }
  }
  for (let i = 0; i < gridVals.length - 1; i++) {
    if (gridVals[i].g * gridVals[i + 1].g < 0) {
      const { s: s0, g: g0 } = gridVals[i];
      const { s: s1, g: g1 } = gridVals[i + 1];
      flip = Number((s0 - (g0 * (s1 - s0)) / (g1 - g0)).toFixed(2));
      break;
    }
  }

  // By strike ±15%
  const loStrike = spot * 0.85;
  const hiStrike = spot * 1.15;
  const strikeMap = new Map<number, { call: number; put: number; oi: number }>();
  let callOi = 0;
  let putOi = 0;

  for (const o of parsed) {
    if (o.sg > 0) callOi += o.oi;
    else putOi += o.oi;

    if (o.K < loStrike || o.K > hiStrike) continue;
    const F = o.fr * spot;
    const sqrtT = Math.sqrt(o.T);
    const d1 = (Math.log(F / o.K) + 0.5 * o.iv * o.iv * o.T) / (o.iv * sqrtT);
    const gamma = normPdf(d1) / (F * o.iv * sqrtT);
    const g = (o.sg * o.oi * gamma * spot * spot * 0.01) / 1e6;

    const prev = strikeMap.get(o.K) ?? { call: 0, put: 0, oi: 0 };
    if (o.sg > 0) prev.call += g;
    else prev.put += g;
    prev.oi += o.oi;
    strikeMap.set(o.K, prev);
  }

  const by_strike: GexStrikeRow[] = Array.from(strikeMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([strike, v]) => ({
      strike,
      call_gex_m: Number(v.call.toFixed(2)),
      put_gex_m: Number(v.put.toFixed(2)),
      net_gex_m: Number((v.call + v.put).toFixed(2)),
      oi_contracts: Number(v.oi.toFixed(1)),
    }));

  const call_wall = by_strike.length
    ? by_strike.reduce((best, r) => (r.call_gex_m > best.call_gex_m ? r : best), by_strike[0]).strike
    : null;
  const put_wall = by_strike.length
    ? by_strike.reduce((best, r) => (r.put_gex_m < best.put_gex_m ? r : best), by_strike[0]).strike
    : null;

  // Term structure buckets & IV smile (±20%)
  const bucketDefs: Array<{ name: GexTermBucket['bucket']; test: (days: number) => boolean }> = [
    { name: '≤ 7 d', test: (d) => d <= 7 },
    { name: '8–30 d', test: (d) => d > 7 && d <= 30 },
    { name: '> 30 d', test: (d) => d > 30 },
  ];
  const termAcc = bucketDefs.map((b) => ({
    bucket: b.name,
    call: 0,
    put: 0,
    n: 0,
    oi: 0,
    test: b.test,
  }));

  const smileMap = new Map<number, { callIvs: number[]; putIvs: number[] }>();
  const loSmile = spot * 0.8;
  const hiSmile = spot * 1.2;

  for (const o of parsed) {
    const daysToExp = (o.exp - nowSec) / 86400;
    const F = o.fr * spot;
    const sqrtT = Math.sqrt(o.T);
    const d1 = (Math.log(F / o.K) + 0.5 * o.iv * o.iv * o.T) / (o.iv * sqrtT);
    const gamma = normPdf(d1) / (F * o.iv * sqrtT);
    const gM = (o.sg * o.oi * gamma * spot * spot * 0.01) / 1e6;

    for (const b of termAcc) {
      if (b.test(daysToExp)) {
        if (o.sg > 0) b.call += gM;
        else b.put += gM;
        b.n++;
        b.oi += o.oi;
        break;
      }
    }

    if (o.K >= loSmile && o.K <= hiSmile && o.iv > 0.02 && o.iv < 5.0) {
      const entry = smileMap.get(o.K) ?? { callIvs: [], putIvs: [] };
      if (o.sg > 0) entry.callIvs.push(o.iv * 100);
      else entry.putIvs.push(o.iv * 100);
      smileMap.set(o.K, entry);
    }
  }

  const term_buckets: GexTermBucket[] = termAcc.map((b) => ({
    bucket: b.bucket,
    net_gex_m: Number((b.call + b.put).toFixed(2)),
    call_gex_m: Number(b.call.toFixed(2)),
    put_gex_m: Number(b.put.toFixed(2)),
    n_contracts: b.n,
    oi_contracts: Number(b.oi.toFixed(1)),
  }));

  const iv_smile: IvSmilePoint[] = Array.from(smileMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([strike, v]) => {
      const cAvg = v.callIvs.length ? mean(v.callIvs) : null;
      const pAvg = v.putIvs.length ? mean(v.putIvs) : null;
      const all = [...v.callIvs, ...v.putIvs];
      return {
        strike,
        call_iv: cAvg !== null ? Number(cAvg.toFixed(2)) : null,
        put_iv: pAvg !== null ? Number(pAvg.toFixed(2)) : null,
        avg_iv: Number(mean(all).toFixed(2)),
      };
    });

  return {
    asset: asset.toUpperCase(),
    spot,
    as_of: chainSnapshot.ts,
    n_contracts: parsed.length,
    net_gex_m: Number((net / 1e6).toFixed(2)),
    net_gex_7d_m: Number((net7d / 1e6).toFixed(2)),
    flip,
    call_wall,
    put_wall,
    regime:
      net > 0
        ? 'Gamma positiva (los dealers amortiguan los movimientos)'
        : 'Gamma negativa (los dealers amplifican los movimientos)',
    put_call_oi: callOi > 0 ? Number((putOi / callOi).toFixed(3)) : null,
    by_strike,
    profile,
    term_buckets,
    iv_smile,
  };
}

/**
 * Trailing 90-day z-score of the last observation (from readings.py / bias.py).
 */
function zLast(series: Array<number | null>, win = 90): number | null {
  const n = series.length;
  if (n < 2) return null;
  const last = series[n - 1];
  if (last === null || !Number.isFinite(last)) return null;
  const hist: number[] = [];
  for (let i = Math.max(0, n - 1 - win); i < n - 1; i++) {
    const v = series[i];
    if (v !== null && Number.isFinite(v)) hist.push(v);
  }
  if (hist.length < 30) return null;
  const m = mean(hist);
  const s = std(hist, 1);
  return s > 0 ? (last - m) / s : null;
}

export function computeDerivativesReadings(params: {
  candles1h: Candle[];
  oiDaily: number[][];
  lsDaily: number[][];
  deribitFunding?: Array<{ timestamp: number; interest_1h: number }>;
  okxFunding?: Array<[number, number]>;
  dvolHourly?: number[][];
}): DerivativesReadings {
  const DAY = 86_400_000;
  const HOUR = 3_600_000;
  const now = Date.now();
  const today = Math.floor(now / DAY) * DAY;
  const days: number[] = [];
  for (let d = today - 130 * DAY; d < today; d += DAY) days.push(d);

  // Funding daily in bps/day
  let fundSeries: Array<number | null> = new Array(days.length).fill(null);
  if (params.deribitFunding && params.deribitFunding.length > 0) {
    fundSeries = days.map((d) => {
      const pts = params.deribitFunding!.filter((x) => x.timestamp >= d && x.timestamp < d + DAY);
      if (pts.length < 20) return null;
      return pts.reduce((s, x) => s + x.interest_1h, 0) * 1e4;
    });
  } else if (params.okxFunding && params.okxFunding.length > 0) {
    fundSeries = days.map((d) => {
      const pts = params.okxFunding!.filter(([ts]) => ts >= d && ts < d + DAY);
      if (pts.length < 2) return null;
      return pts.reduce((s, [, v]) => s + v, 0) * 1e4;
    });
  }

  const fund7dSeries = fundSeries.map((_, idx) => {
    if (idx < 6) return null;
    const slice = fundSeries.slice(idx - 6, idx + 1);
    if (slice.some((x) => x === null)) return null;
    return slice.reduce<number>((s, x) => s + (x ?? 0), 0);
  });

  // DVOL daily close (last hourly bar of each day)
  let dvolSeries: Array<number | null> = new Array(days.length).fill(null);
  if (params.dvolHourly && params.dvolHourly.length > 0) {
    const dvMap = new Map<number, number>();
    for (const row of params.dvolHourly) dvMap.set(row[0], row[4]);
    dvolSeries = days.map((d) => dvMap.get(d + DAY - HOUR) ?? null);
  }

  // Realized vol 30d annualized vs DVOL -> IV - RV spread
  const closes1h = params.candles1h.map((c) => c[4]);
  const rv30d = (() => {
    if (closes1h.length < 721) return null;
    const lr: number[] = [];
    for (let i = closes1h.length - 720; i < closes1h.length; i++) {
      lr.push(Math.log(closes1h[i] / closes1h[i - 1]));
    }
    return std(lr) * Math.sqrt(24 * 365) * 100;
  })();

  // OI and Long/Short from OKX rubik (aligned to days)
  const oiMap = new Map<number, number>();
  for (const row of params.oiDaily) {
    // row = [ts, oiContracts, oiCcy, oiUsd]
    const dayKey = Math.floor(row[0] / DAY) * DAY;
    oiMap.set(dayKey, row[2]);
  }
  const lsMap = new Map<number, number>();
  for (const row of params.lsDaily) {
    const dayKey = Math.floor(row[0] / DAY) * DAY;
    lsMap.set(dayKey, row[1]);
  }

  const oiSeries = days.map((d) => oiMap.get(d) ?? null);
  const lsSeries = days.map((d) => lsMap.get(d) ?? null);
  const oiChg1dSeries = oiSeries.map((v, i) =>
    i >= 1 && v !== null && oiSeries[i - 1] !== null ? ((v / oiSeries[i - 1]!) - 1) * 100 : null,
  );
  const oiChg7dSeries = oiSeries.map((v, i) =>
    i >= 7 && v !== null && oiSeries[i - 7] !== null ? ((v / oiSeries[i - 7]!) - 1) * 100 : null,
  );

  const lastIdx = days.length - 1;
  const fund = fundSeries[lastIdx];
  const fund_1d_z = zLast(fundSeries);
  const fund_7d_z = zLast(fund7dSeries);
  const dvol = dvolSeries[lastIdx];
  const dvol_z = zLast(dvolSeries);
  const iv_rv = dvol !== null && rv30d !== null ? dvol - rv30d : null;
  const oi_chg_1d = oiChg1dSeries[lastIdx];
  const oi_chg_7d = oiChg7dSeries[lastIdx];
  const oi_z = zLast(oiChg1dSeries);
  const ls = lsSeries[lastIdx];
  const ls_z = zLast(lsSeries);

  const FUND_Z = 2.0;
  const OI_FLUSH = -5.0;

  return {
    as_of: today - DAY,
    fund,
    fund_1d_z,
    fund_7d_z,
    dvol,
    dvol_z,
    iv_rv,
    oi_chg_1d,
    oi_chg_7d,
    oi_z,
    ls,
    ls_z,
    flags: {
      fund:
        fund_1d_z === null
          ? 'na'
          : fund_1d_z < -FUND_Z
            ? 'neg'
            : fund_1d_z > FUND_Z
              ? 'pos'
              : 'none',
      oi_flush: oi_chg_1d === null ? null : oi_chg_1d < OI_FLUSH,
    },
  };
}

/**
 * Computes Stop/Target EV/Kelly grid on martingale-adjusted GARCH paths + technical features + contrarian events (trades.py).
 */
export function computeTradeGrid(asset: AssetId, candles1h: Candle[]): TradeAnalysisOutput {
  const COST = 0.001; // 0.10% round trip
  const H = 72;
  const N = 4000;
  const closes = candles1h.map((c) => c[4]);
  const spot = closes[closes.length - 1];
  const logc = closes.map((c) => Math.log(c));
  const lr: number[] = [];
  for (let i = 1; i < closes.length; i++) lr.push(logc[i] - logc[i - 1]);

  const rPct = lr.map((x) => x * 100);
  const fit = fitGjrGarch(rPct);
  const cumPaths = simulateGarchPaths(fit, rPct[rPct.length - 1], H, N, 11, true);

  const SLs = [0.01, 0.015, 0.02, 0.03, 0.04];
  const TPs = [0.01, 0.02, 0.03, 0.04, 0.06, 0.08];

  const evalCombo = (dir: 'long' | 'short', sl: number, tp: number, driftPerHour = 0) => {
    const isLong = dir === 'long';
    let winCnt = 0;
    let lossCnt = 0;
    let toCnt = 0;
    let sumOut = 0;
    let sumOut2 = 0;
    let sumX = 0;
    let sumX2 = 0;

    for (let i = 0; i < N; i++) {
      const path = cumPaths[i];
      let exitStep = H - 1;
      let outcomeType: 'win' | 'loss' | 'to' = 'to';

      for (let s = 0; s < H; s++) {
        const ret = Math.exp(path[s] + driftPerHour * (s + 1)) - 1;
        const hitWin = isLong ? ret >= tp : ret <= -tp;
        const hitLoss = isLong ? ret <= -sl : ret >= sl;
        if (hitWin || hitLoss) {
          exitStep = s;
          outcomeType = hitWin && !hitLoss ? 'win' : 'loss';
          break;
        }
      }

      if (outcomeType === 'win') winCnt++;
      else if (outcomeType === 'loss') lossCnt++;
      else toCnt++;

      const exitRet = Math.exp(path[exitStep] + driftPerHour * (exitStep + 1)) - 1;
      const out = (isLong ? 1 : -1) * exitRet - COST;
      const rMult = out / sl;
      sumOut += out;
      sumOut2 += out * out;
      sumX += rMult;
      sumX2 += rMult * rMult;
    }

    const ev = sumOut / N;
    const varOut = Math.max(0, sumOut2 / N - ev * ev);
    const evSe = Math.sqrt(varOut / N);
    const evR = sumX / N;
    const meanX2 = sumX2 / N;
    const kelly = evR > 0 && meanX2 > 0 ? evR / meanX2 : 0;

    return {
      dir,
      sl_pct: Number((sl * 100).toFixed(2)),
      tp_pct: Number((tp * 100).toFixed(2)),
      p_tp_pct: Number(((winCnt / N) * 100).toFixed(2)),
      p_sl_pct: Number(((lossCnt / N) * 100).toFixed(2)),
      p_to_pct: Number(((toCnt / N) * 100).toFixed(2)),
      ev_pct: Number((ev * 100).toFixed(3)),
      ev_se_pct: Number((evSe * 100).toFixed(3)),
      ev_r: Number(evR.toFixed(4)),
      kelly_pct: Number((kelly * 100).toFixed(2)),
      be_pct: Number((((sl + COST) / (sl + tp)) * 100).toFixed(2)),
      rr: Number((tp / sl).toFixed(2)),
      sig_pos: ev * 100 - 3 * (evSe * 100) > 0,
    };
  };

  const reqDrift24hPct = (dir: 'long' | 'short', sl: number, tp: number) => {
    let lo = dir === 'long' ? 0.0 : -0.005;
    let hi = dir === 'long' ? 0.005 : 0.0;
    for (let it = 0; it < 20; it++) {
      const mid = (lo + hi) / 2;
      const ev = evalCombo(dir, sl, tp, mid).ev_pct;
      if ((dir === 'long' && ev < 0) || (dir === 'short' && ev > 0)) lo = mid;
      else hi = mid;
    }
    return Number((((lo + hi) / 2) * 24 * 100).toFixed(3));
  };

  const grid: TradeGridRow[] = [];
  for (const dir of ['long', 'short'] as const) {
    for (const sl of SLs) {
      for (const tp of TPs) {
        grid.push(evalCombo(dir, sl, tp));
      }
    }
  }

  const top: TradeGridRow[] = [];
  for (const dir of ['long', 'short'] as const) {
    const sub = grid
      .filter((g) => g.dir === dir)
      .sort((a, b) => b.ev_r - a.ev_r)
      .slice(0, 3);
    sub.forEach((r, idx) => {
      top.push({
        ...r,
        key: `${dir === 'long' ? 'L' : 'S'}${idx + 1}`,
        req_drift_24h_pct: idx === 0 ? reqDrift24hPct(dir, r.sl_pct / 100, r.tp_pct / 100) : null,
      });
    });
  }

  // Technical features (latest & series for contrarian events)
  const n = closes.length;
  const vol168 = new Array<number>(n).fill(NaN);
  for (let i = 168; i < n; i++) {
    vol168[i] = std(lr.slice(i - 168, i));
  }

  const mom = (h: number, i: number) =>
    i >= h && vol168[i] > 0 ? (logc[i] - logc[i - h]) / (vol168[i] * Math.sqrt(h)) : NaN;

  // RSI(14) Wilder EWM
  let avgGain = 0;
  let avgLoss = 0;
  let rsiVal = 50;
  for (let i = 1; i < n; i++) {
    const d = closes[i] - closes[i - 1];
    const g = Math.max(0, d);
    const l = Math.max(0, -d);
    avgGain = avgGain * (13 / 14) + g * (1 / 14);
    avgLoss = avgLoss * (13 / 14) + l * (1 / 14);
    if (i === n - 1) {
      rsiVal = avgLoss > 0 ? 100 - 100 / (1 + avgGain / avgLoss) : 100;
    }
  }

  // EMA(50)
  let ema50 = closes[0];
  const alpha50 = 2 / 51;
  for (let i = 1; i < n; i++) ema50 = closes[i] * alpha50 + ema50 * (1 - alpha50);

  // Bollinger Z(20) series
  const bbZ = new Array<number>(n).fill(NaN);
  for (let i = 20; i < n; i++) {
    const win = closes.slice(i - 19, i + 1);
    const s = std(win, 1);
    bbZ[i] = s > 0 ? (closes[i] - mean(win)) / s : NaN;
  }

  const lastIdx = n - 1;
  const vol24 = lastIdx >= 24 ? std(lr.slice(lastIdx - 24, lastIdx)) : 0;
  const win168Close = closes.slice(Math.max(0, n - 168));
  const min168 = Math.min(...win168Close);
  const max168 = Math.max(...win168Close);
  const vol168Valid = vol168.slice(Math.max(168, n - 2000)).filter(Number.isFinite);
  const volPctRank =
    vol168Valid.length > 0
      ? vol168Valid.filter((v) => v <= vol168[lastIdx]).length / vol168Valid.length - 0.5
      : 0;

  const feat_now: Record<string, number> = {
    mom_6: Number(mom(6, lastIdx).toFixed(3)),
    mom_24: Number(mom(24, lastIdx).toFixed(3)),
    mom_72: Number(mom(72, lastIdx).toFixed(3)),
    bb_z: Number(bbZ[lastIdx].toFixed(3)),
    rsi14: Number(((rsiVal - 50) / 25).toFixed(3)),
    vol_ratio: vol168[lastIdx] > 0 && vol24 > 0 ? Number(Math.log(vol24 / vol168[lastIdx]).toFixed(3)) : 0,
    vol_pct: Number(volPctRank.toFixed(3)),
    ema_dev_50: vol168[lastIdx] > 0 ? Number(((spot / ema50 - 1) / vol168[lastIdx]).toFixed(3)) : 0,
    range_pos: max168 > min168 ? Number(((spot - min168) / (max168 - min168) - 0.5).toFixed(3)) : 0,
  };

  // Contrarian event study (mom_24 and bb_z extremes)
  const events: ContrarianEvent[] = [];
  const tests: Array<{ fnm: 'mom_24' | 'bb_z'; th: number; h: number }> = [];
  for (const fnm of ['mom_24', 'bb_z'] as const) {
    for (const th of [1.5, 2.0, 2.5]) {
      for (const h of [6, 24]) tests.push({ fnm, th, h });
    }
  }
  const nt = tests.length;
  const rngCi = createRng(19);

  for (const { fnm, th, h } of tests) {
    const fades: number[] = [];
    const grosses: number[] = [];
    let i = 200;
    while (i < n - h) {
      const val = fnm === 'mom_24' ? mom(24, i) : bbZ[i];
      if (Number.isFinite(val) && Math.abs(val) > th) {
        const fwdRet = logc[i + h] - logc[i];
        const gross = -Math.sign(val) * fwdRet;
        grosses.push(gross);
        fades.push(gross - COST);
        i += h;
      } else {
        i++;
      }
    }
    if (fades.length < 15) continue;

    const mFade = mean(fades);
    const sFade = std(fades, 1);
    const tStat = sFade > 0 ? mFade / (sFade / Math.sqrt(fades.length)) : 0;
    const pVal = Math.min(1, 2 * (1 - studentTCdfApprox(Math.abs(tStat), fades.length - 1)));

    // Bootstrap CI
    const bsMeans: number[] = [];
    for (let b = 0; b < 800; b++) {
      let s = 0;
      for (let k = 0; k < fades.length; k++) {
        s += fades[Math.floor(rngCi() * fades.length)];
      }
      bsMeans.push((s / fades.length) * 100);
    }
    bsMeans.sort((a, b) => a - b);

    const curVal = feat_now[fnm];
    events.push({
      rule: `${fnm === 'mom_24' ? 'Momentum 24 h' : 'Bollinger z'} extremo (|z| > ${th}) → contrarian`,
      feature: fnm,
      th,
      h,
      n: fades.length,
      hit_pct: Number(((grosses.filter((g) => g > 0).length / grosses.length) * 100).toFixed(1)),
      gross_pct: Number((mean(grosses) * 100).toFixed(3)),
      net_pct: Number((mFade * 100).toFixed(3)),
      ci_lo: Number(percentile(bsMeans, 2.5).toFixed(3)),
      ci_hi: Number(percentile(bsMeans, 97.5).toFixed(3)),
      p: Number(pVal.toFixed(4)),
      p_bonf: Number(Math.min(1, pVal * nt).toFixed(3)),
      active_now: Math.abs(curVal) > th,
      dir_now: curVal < -th ? 'long' : curVal > th ? 'short' : null,
    });
  }

  const bestLong = grid.filter((g) => g.dir === 'long').reduce((a, b) => (b.ev_r > a.ev_r ? b : a));
  const bestShort = grid.filter((g) => g.dir === 'short').reduce((a, b) => (b.ev_r > a.ev_r ? b : a));

  return {
    asset,
    spot,
    cost_pct: COST * 100,
    n_sims: N,
    H,
    n_sig: grid.filter((g) => g.sig_pos).length,
    n_combos: grid.length,
    best_long_ev_pct: bestLong.ev_pct,
    best_short_ev_pct: bestShort.ev_pct,
    grid,
    top,
    events,
    feat_now,
  };
}

/**
 * Interactive What-If SL/TP/Fee/Drift simulator over martingale-adjusted GARCH paths.
 */
export function simulateCustomTrade(params: {
  candles1h: Candle[];
  dir: 'long' | 'short';
  slPct: number;
  tpPct: number;
  costPct: number;
  drift24hPct: number;
}): TradeGridRow {
  const H = 72;
  const N = 4000;
  const closes = params.candles1h.map((c) => c[4]);
  const lr: number[] = [];
  for (let i = 1; i < closes.length; i++) lr.push(Math.log(closes[i] / closes[i - 1]));
  const rPct = lr.map((x) => x * 100);
  const fit = fitGjrGarch(rPct);
  const cumPaths = simulateGarchPaths(fit, rPct[rPct.length - 1], H, N, 11, true);

  const sl = Math.max(0.002, params.slPct / 100);
  const tp = Math.max(0.002, params.tpPct / 100);
  const cost = Math.max(0, params.costPct / 100);
  const driftPerHour = params.drift24hPct / 100 / 24;
  const isLong = params.dir === 'long';

  let winCnt = 0;
  let lossCnt = 0;
  let toCnt = 0;
  let sumOut = 0;
  let sumOut2 = 0;
  let sumX = 0;
  let sumX2 = 0;

  for (let i = 0; i < N; i++) {
    const path = cumPaths[i];
    let exitStep = H - 1;
    let outcomeType: 'win' | 'loss' | 'to' = 'to';
    for (let s = 0; s < H; s++) {
      const ret = Math.exp(path[s] + driftPerHour * (s + 1)) - 1;
      const hitWin = isLong ? ret >= tp : ret <= -tp;
      const hitLoss = isLong ? ret <= -sl : ret >= sl;
      if (hitWin || hitLoss) {
        exitStep = s;
        outcomeType = hitWin && !hitLoss ? 'win' : 'loss';
        break;
      }
    }
    if (outcomeType === 'win') winCnt++;
    else if (outcomeType === 'loss') lossCnt++;
    else toCnt++;

    const exitRet = Math.exp(path[exitStep] + driftPerHour * (exitStep + 1)) - 1;
    const out = (isLong ? 1 : -1) * exitRet - cost;
    const rMult = out / sl;
    sumOut += out;
    sumOut2 += out * out;
    sumX += rMult;
    sumX2 += rMult * rMult;
  }

  const ev = sumOut / N;
  const varOut = Math.max(0, sumOut2 / N - ev * ev);
  const evSe = Math.sqrt(varOut / N);
  const evR = sumX / N;
  const meanX2 = sumX2 / N;
  const kelly = evR > 0 && meanX2 > 0 ? evR / meanX2 : 0;

  return {
    dir: params.dir,
    sl_pct: Number((sl * 100).toFixed(2)),
    tp_pct: Number((tp * 100).toFixed(2)),
    p_tp_pct: Number(((winCnt / N) * 100).toFixed(2)),
    p_sl_pct: Number(((lossCnt / N) * 100).toFixed(2)),
    p_to_pct: Number(((toCnt / N) * 100).toFixed(2)),
    ev_pct: Number((ev * 100).toFixed(3)),
    ev_se_pct: Number((evSe * 100).toFixed(3)),
    ev_r: Number(evR.toFixed(4)),
    kelly_pct: Number((kelly * 100).toFixed(2)),
    be_pct: Number((((sl + cost) / (sl + tp)) * 100).toFixed(2)),
    rr: Number((tp / sl).toFixed(2)),
    sig_pos: ev * 100 - 3 * (evSe * 100) > 0,
  };
}

// ---------------------------------------------------------------------------
// Statistical Evaluation & Conformal Prediction (evaluation.py + conformal.py)
// ---------------------------------------------------------------------------

const EULER_CONST = 0.5772156649015329;

export function crpsQuantiles(y: number[], Q: number[][], taus: number[]): number[] {
  return y.map((yi, idx) => {
    const qRow = Q[idx];
    let sum = 0;
    for (let k = 0; k < taus.length; k++) {
      const d = yi - qRow[k];
      sum += Math.max(taus[k] * d, (taus[k] - 1) * d);
    }
    return 2 * (sum / Math.max(1, taus.length));
  });
}

export function dieboldMariano(
  l1: number[],
  l2: number[],
  h = 1,
  hln = true,
): { stat: number; p: number; dm: number } {
  const n = Math.min(l1.length, l2.length);
  if (n < 3) return { stat: 0, p: 1, dm: 0 };
  const d = new Array<number>(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    d[i] = l1[i] - l2[i];
    sum += d[i];
  }
  const dm = sum / n;
  const dc = d.map((v) => v - dm);
  const L = Math.max(h - 1, 0);
  let g0 = 0;
  for (let i = 0; i < n; i++) g0 += dc[i] * dc[i];
  let varD = g0 / n;
  for (let k = 1; k <= L; k++) {
    let gk = 0;
    for (let i = k; i < n; i++) gk += dc[i] * dc[i - k];
    gk /= n;
    varD += 2 * (1 - k / (L + 1)) * gk;
  }
  varD = Math.max(varD, 1e-18) / n;
  let stat = dm / Math.sqrt(varD);
  let p: number;
  if (hln) {
    const adj = Math.max(0.01, (n + 1 - 2 * h + (h * (h - 1)) / n) / n);
    stat *= Math.sqrt(adj);
    p = Math.min(1, 2 * (1 - studentTCdfApprox(Math.abs(stat), n - 1)));
  } else {
    p = Math.min(1, 2 * (1 - normCdf(Math.abs(stat))));
  }
  return { stat, p, dm };
}

export function kupiecPof(hits: number[], p: number): { lr: number; p: number } {
  const n = hits.length;
  if (n === 0) return { lr: 0, p: 1 };
  const x = hits.reduce((s, v) => s + (v ? 1 : 0), 0);
  const ph = Math.min(Math.max(x / n, 1e-12), 1 - 1e-12);
  const ll0 = (n - x) * Math.log(1 - p) + x * Math.log(p);
  const ll1 = (n - x) * Math.log(1 - ph) + x * Math.log(ph);
  const lr = Math.max(0, -2 * (ll0 - ll1));
  return { lr, p: chi2Survival1(lr) };
}

export function christoffersenInd(hits: number[]): { lr: number; p: number } {
  const n = hits.length;
  if (n < 4) return { lr: 0, p: 1 };
  let n00 = 0;
  let n01 = 0;
  let n10 = 0;
  let n11 = 0;
  for (let i = 0; i < n - 1; i++) {
    const a = hits[i] ? 1 : 0;
    const b = hits[i + 1] ? 1 : 0;
    if (a === 0 && b === 0) n00++;
    else if (a === 0 && b === 1) n01++;
    else if (a === 1 && b === 0) n10++;
    else n11++;
  }
  const ll = (pp: number, nn: number, kk: number) =>
    (nn > 0 ? nn * Math.log(Math.max(1 - pp, 1e-12)) : 0) +
    (kk > 0 ? kk * Math.log(Math.max(pp, 1e-12)) : 0);
  const p01 = n01 / Math.max(n00 + n01, 1);
  const p11 = n11 / Math.max(n10 + n11, 1);
  const p = (n01 + n11) / Math.max(n00 + n01 + n10 + n11, 1);
  const l1 = ll(p01, n00, n01) + ll(p11, n10, n11);
  const l0 = ll(p, n00 + n10, n01 + n11);
  const lr = Math.max(-2 * (l0 - l1), 0);
  return { lr, p: chi2Survival1(lr) };
}

export function christoffersenCc(hits: number[], p: number): { lr: number; p: number } {
  const k = kupiecPof(hits, p);
  const ind = christoffersenInd(hits);
  const lr = k.lr + ind.lr;
  return { lr, p: chi2Survival2(lr) };
}

export function sharpe(r: number[]): number {
  if (r.length < 2) return 0;
  return mean(r) / (std(r, 1) + 1e-18);
}

function skewKurt(r: number[]): { skew: number; kurt: number } {
  const n = r.length;
  if (n < 4) return { skew: 0, kurt: 3 };
  const m = mean(r);
  const s = std(r, 0);
  if (s <= 1e-18) return { skew: 0, kurt: 3 };
  let m3 = 0;
  let m4 = 0;
  for (let i = 0; i < n; i++) {
    const z = (r[i] - m) / s;
    m3 += z ** 3;
    m4 += z ** 4;
  }
  return { skew: m3 / n, kurt: m4 / n };
}

export function psr(r: number[], srBench = 0.0): number {
  const n = r.length;
  if (n < 3) return 0.5;
  const sr = sharpe(r);
  const { skew, kurt } = skewKurt(r);
  const den = Math.sqrt(Math.max(1 - skew * sr + ((kurt - 1) / 4) * sr * sr, 1e-12));
  const z = ((sr - srBench) * Math.sqrt(n - 1)) / den;
  return normCdf(z);
}

export function expectedMaxSharpe(nTrials: number, varSr: number): number {
  if (nTrials <= 1 || varSr <= 0) return 0.0;
  const s = Math.sqrt(varSr);
  return (
    s *
    ((1 - EULER_CONST) * normPpf(1 - 1 / nTrials) +
      EULER_CONST * normPpf(1 - 1 / (nTrials * Math.E)))
  );
}

export function dsr(r: number[], nTrials: number, varSrTrials: number): number {
  return psr(r, expectedMaxSharpe(nTrials, varSrTrials));
}

export function nwTstat(x: number[], lags?: number): number {
  const n = x.length;
  if (n < 3) return 0;
  const L = lags ?? Math.floor(4 * Math.pow(n / 100, 2 / 9));
  const m = mean(x);
  const xc = x.map((v) => v - m);
  let v = 0;
  for (let i = 0; i < n; i++) v += xc[i] * xc[i];
  v /= n;
  for (let k = 1; k <= L; k++) {
    let gk = 0;
    for (let i = k; i < n; i++) gk += xc[i] * xc[i - k];
    gk /= n;
    v += 2 * (1 - k / (L + 1)) * gk;
  }
  v = Math.max(v, 1e-18);
  return m / Math.sqrt(v / n);
}

export function aciIntervals(
  ret: number[],
  sig: number[],
  hLag: number,
  alpha = 0.1,
  gamma = 0.02,
  cal = 300,
  minCal = 80,
): { qOut: Array<number | null>; hit: Array<number | null>; aHist: Array<number | null> } {
  const n = ret.length;
  let aT = alpha;
  const qOut = new Array<number | null>(n).fill(null);
  const hit = new Array<number | null>(n).fill(null);
  const aHist = new Array<number | null>(n).fill(null);
  const s = ret.map((r, i) => (Number.isFinite(r) && sig[i] > 0 ? Math.abs(r) / sig[i] : NaN));

  for (let k = 0; k < n; k++) {
    const known: number[] = [];
    const hiBound = Math.max(k - hLag + 1, 0);
    for (let idx = 0; idx < hiBound; idx++) {
      if (Number.isFinite(s[idx])) known.push(s[idx]);
    }
    const calSlice = known.slice(-cal);
    if (calSlice.length < minCal) continue;

    const j = k - hLag;
    if (j >= 0 && hit[j] !== null) {
      aT = aT + gamma * (alpha - (1 - hit[j]!));
    }
    const aEff = Math.min(Math.max(aT, 0.005), 0.5);
    const sorted = [...calSlice].sort((a, b) => a - b);
    const q = percentile(sorted, (1 - aEff) * 100);
    qOut[k] = q * sig[k];
    hit[k] = Math.abs(ret[k]) <= qOut[k]! ? 1 : 0;
    aHist[k] = aT;
  }
  return { qOut, hit, aHist };
}

/**
 * Walk-forward calibration diagnostics (engine.py + evaluation.py + conformal.py):
 * coverage 50/80/90, Winkler 90, CRPS, Diebold-Mariano, Kupiec/Christoffersen, 10-bin PIT, and ACI.
 */
export function runWalkForwardCalibration(asset: AssetId, candles1h: Candle[]): WalkForwardOutput {
  const closes = candles1h.map((c) => c[4]);
  const lr: number[] = [];
  for (let i = 1; i < closes.length; i++) lr.push(Math.log(closes[i] / closes[i - 1]));

  const window = Math.min(520, Math.floor(lr.length * 0.5));
  const H = 72;
  const step = 12;
  const sims = 450;
  const horizons = [24, 72] as const;
  const taus = [0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95];

  const acc = Object.fromEntries(
    horizons.map((h) => [
      h,
      {
        g50: 0,
        g80: 0,
        g90: 0,
        b50: 0,
        b80: 0,
        b90: 0,
        wg: [] as number[],
        wb: [] as number[],
        yArr: [] as number[],
        sigG: [] as number[],
        qGarch: [] as number[][],
        qBase: [] as number[][],
        miss90Garch: [] as number[],
        pitHist: new Array<number>(10).fill(0),
        n: 0,
      },
    ]),
  );

  const winkler = (lo: number, hi: number, y: number, alpha: number) => {
    let w = hi - lo;
    if (y < lo) w += (2 / alpha) * (lo - y);
    else if (y > hi) w += (2 / alpha) * (y - hi);
    return w;
  };

  const rng = createRng(29);

  for (let i = window; i < lr.length - H; i += step) {
    const winLr = lr.slice(i - window, i);
    const winPct = winLr.map((x) => x * 100);
    const fit = fitGjrGarch(winPct);
    const gPaths = simulateGarchPaths(fit, winPct[winPct.length - 1], H, sims, 31 + i, false);
    const gSig = sigmaGarchAnalytical(fit, winPct[winPct.length - 1], [...horizons]);

    const bPaths: Float64Array[] = new Array(sims);
    for (let s = 0; s < sims; s++) {
      const p = new Float64Array(H);
      let c = 0;
      for (let t = 0; t < H; t++) {
        c += winLr[Math.floor(rng() * winLr.length)];
        p[t] = c;
      }
      bPaths[s] = p;
    }

    for (const h of horizons) {
      let y = 0;
      for (let t = 0; t < h; t++) y += lr[i + t];

      const xg = gPaths.map((p) => p[h - 1]).sort((a, b) => a - b);
      const xb = bPaths.map((p) => p[h - 1]).sort((a, b) => a - b);

      let ltCount = 0;
      for (let k = 0; k < xg.length; k++) if (xg[k] < y) ltCount++;
      const pitVal = ltCount / xg.length;
      const bin = Math.min(9, Math.max(0, Math.floor(pitVal * 10)));
      acc[h].pitHist[bin]++;

      const g05 = percentile(xg, 5);
      const g10 = percentile(xg, 10);
      const g25 = percentile(xg, 25);
      const g50 = percentile(xg, 50);
      const g75 = percentile(xg, 75);
      const g90 = percentile(xg, 90);
      const g95 = percentile(xg, 95);

      const b05 = percentile(xb, 5);
      const b10 = percentile(xb, 10);
      const b25 = percentile(xb, 25);
      const b50 = percentile(xb, 50);
      const b75 = percentile(xb, 75);
      const b90 = percentile(xb, 90);
      const b95 = percentile(xb, 95);

      if (y >= g25 && y <= g75) acc[h].g50++;
      if (y >= g10 && y <= g90) acc[h].g80++;
      if (y >= g05 && y <= g95) acc[h].g90++;
      if (y >= b25 && y <= b75) acc[h].b50++;
      if (y >= b10 && y <= b90) acc[h].b80++;
      if (y >= b05 && y <= b95) acc[h].b90++;

      acc[h].yArr.push(y);
      acc[h].sigG.push(Math.max(1e-6, gSig[h]));
      acc[h].qGarch.push([g05, g10, g25, g50, g75, g90, g95]);
      acc[h].qBase.push([b05, b10, b25, b50, b75, b90, b95]);
      acc[h].miss90Garch.push(y < g05 || y > g95 ? 1 : 0);
      acc[h].wg.push(winkler(g05, g95, y, 0.1));
      acc[h].wb.push(winkler(b05, b95, y, 0.1));
      acc[h].n++;
    }
  }

  const resultHorizons: WalkForwardHorizon[] = horizons.map((h) => {
    const a = acc[h];
    const n = Math.max(1, a.n);
    const hLag = Math.max(1, Math.ceil(h / step));
    const crpsG = crpsQuantiles(a.yArr, a.qGarch, taus);
    const crpsB = crpsQuantiles(a.yArr, a.qBase, taus);
    const dm = dieboldMariano(crpsB, crpsG, hLag, true);
    const kup = kupiecPof(a.miss90Garch, 0.1);
    const chrInd = christoffersenInd(a.miss90Garch);
    const chrCc = christoffersenCc(a.miss90Garch, 0.1);

    const minCal = Math.min(18, Math.max(6, Math.floor(a.yArr.length * 0.25)));
    const aci = aciIntervals(a.yArr, a.sigG, hLag, 0.1, 0.02, 300, minCal);
    const validIdx: number[] = [];
    for (let idx = 0; idx < aci.hit.length; idx++) {
      if (aci.hit[idx] !== null && aci.qOut[idx] !== null) validIdx.push(idx);
    }

    let aciSummary: WalkForwardHorizon['aci'] = null;
    if (validIdx.length >= 8) {
      const hitsValid = validIdx.map((idx) => aci.hit[idx]!);
      const missesValid = hitsValid.map((hv) => 1 - hv);
      const winksValid = validIdx.map((idx) => {
        const q = aci.qOut[idx]!;
        const y = a.yArr[idx];
        return 2 * q + 20 * Math.max(Math.abs(y) - q, 0);
      });
      const widthsValid = validIdx.map((idx) => 2 * aci.qOut[idx]!);
      const lastA = aci.aHist[validIdx[validIdx.length - 1]] ?? 0.1;
      aciSummary = {
        cov90: Number((mean(hitsValid) * 100).toFixed(1)),
        winkler90: Number((mean(winksValid) * 100).toFixed(2)),
        mean_width_pct: Number((mean(widthsValid) * 100).toFixed(2)),
        kupiec90_p: Number(kupiecPof(missesValid, 0.1).p.toFixed(3)),
        christ_ind90_p: Number(christoffersenInd(missesValid).p.toFixed(3)),
        last_alpha_eff: Number(lastA.toFixed(3)),
      };
    }

    return {
      horizon: h,
      n: a.n,
      garch: {
        '50': Number(((a.g50 / n) * 100).toFixed(1)),
        '80': Number(((a.g80 / n) * 100).toFixed(1)),
        '90': Number(((a.g90 / n) * 100).toFixed(1)),
      },
      base: {
        '50': Number(((a.b50 / n) * 100).toFixed(1)),
        '80': Number(((a.b80 / n) * 100).toFixed(1)),
        '90': Number(((a.b90 / n) * 100).toFixed(1)),
      },
      winkler90_garch: Number((mean(a.wg) * 100).toFixed(2)),
      winkler90_base: Number((mean(a.wb) * 100).toFixed(2)),
      crps_garch: Number((mean(crpsG) * 100).toFixed(3)),
      crps_base: Number((mean(crpsB) * 100).toFixed(3)),
      dm_stat: Number(dm.stat.toFixed(2)),
      dm_p: Number(dm.p.toFixed(4)),
      kupiec90_garch_p: Number(kup.p.toFixed(3)),
      christ_ind90_garch_p: Number(chrInd.p.toFixed(3)),
      christ_cc90_garch_p: Number(chrCc.p.toFixed(3)),
      aci: aciSummary,
      pit_hist: a.pitHist,
    };
  });

  return {
    asset,
    window,
    step,
    sims,
    horizons: resultHorizons,
  };
}

/**
 * Risk-neutral implied options cone via SVI smile calibration + Breeden-Litzenberger density (options_cone.py).
 */
export function computeOptionsCone(
  asset: 'btc' | 'eth',
  chainSnapshot: { ts: number; index: number; chain: DeribitOptionSummary[] },
  horizons: Array<24 | 72> = [24, 72],
): OptionsConeOutput | null {
  const spot = chainSnapshot.index;
  if (!spot || !chainSnapshot.chain.length) return null;

  const nowSec = chainSnapshot.ts / 1000;
  const MON: Record<string, number> = {
    JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
    JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
  };
  const prefix = asset.toUpperCase();
  const re = new RegExp(`^${prefix}-(\\d{1,2})([A-Z]{3})(\\d{2})-(\\d+)-([CP])$`);

  type OptPt = { K: number; cp: 'C' | 'P'; iv: number; F: number; T: number };
  const byExp = new Map<number, OptPt[]>();

  for (const o of chainSnapshot.chain) {
    if (!o.mark_iv || o.mark_iv <= 0 || !o.open_interest || !o.underlying_price) continue;
    const m = o.instrument_name.match(re);
    if (!m) continue;
    const [, dStr, monStr, yyStr, kStr, cp] = m;
    const expSec = Date.UTC(2000 + Number(yyStr), MON[monStr], Number(dStr), 8, 0, 0) / 1000;
    const T = (expSec - nowSec) / (365 * 86400);
    if (T <= 0.5 / 365) continue; // discard <12h noisy expiries
    const list = byExp.get(expSec) ?? [];
    list.push({ K: Number(kStr), cp: cp as 'C' | 'P', iv: o.mark_iv / 100, F: o.underlying_price, T });
    byExp.set(expSec, list);
  }

  const sviVal = (p: number[], k: number) => {
    const [a, b, rho, m, s] = p;
    return a + b * (rho * (k - m) + Math.sqrt((k - m) ** 2 + s * s));
  };

  const LO = [-1, 1e-4, -0.999, -2, 1e-3];
  const HI = [5, 5, 0.999, 2, 3];
  const clampVec = (v: number[]) => v.map((x, idx) => Math.min(HI[idx], Math.max(LO[idx], x)));

  function fitSviExpiry(ks: number[], ws: number[]): { p: number[]; cost: number } {
    const obj = (raw: number[]) => {
      const p = clampVec(raw);
      let s = 0;
      for (let i = 0; i < ks.length; i++) {
        const diff = sviVal(p, ks[i]) - ws[i];
        s += diff * diff;
      }
      return s;
    };

    const wMin = Math.min(...ws);
    let bestP = [Math.max(wMin * 0.8, 1e-6), 0.1, -0.2, 0, 0.1];
    let bestCost = obj(bestP);

    for (const s0 of [0.05, 0.2]) {
      const x0 = clampVec([Math.max(wMin * 0.8, 1e-6), 0.1, -0.2, 0.0, s0]);
      const dim = 5;
      const simplex: Array<{ x: number[]; fx: number }> = [{ x: x0, fx: obj(x0) }];
      const steps = [0.05, 0.08, 0.25, 0.15, 0.08];
      for (let i = 0; i < dim; i++) {
        const xi = [...x0];
        xi[i] = clampVec(xi.map((v, j) => (j === i ? v + steps[i] : v)))[i];
        simplex.push({ x: xi, fx: obj(xi) });
      }
      for (let it = 0; it < 140; it++) {
        simplex.sort((a, b) => a.fx - b.fx);
        const best = simplex[0];
        const worst = simplex[dim];
        const second = simplex[dim - 1];
        const cen = new Array<number>(dim).fill(0);
        for (let i = 0; i < dim; i++) for (let j = 0; j < dim; j++) cen[j] += simplex[i].x[j] / dim;
        const ref = clampVec(cen.map((c, j) => c + (c - worst.x[j])));
        const fr = obj(ref);
        if (fr < best.fx) {
          const expd = clampVec(cen.map((c, j) => c + 2 * (ref[j] - c)));
          const fe = obj(expd);
          simplex[dim] = fe < fr ? { x: expd, fx: fe } : { x: ref, fx: fr };
        } else if (fr < second.fx) {
          simplex[dim] = { x: ref, fx: fr };
        } else {
          const con = clampVec(
            fr < worst.fx
              ? cen.map((c, j) => c + 0.5 * (ref[j] - c))
              : cen.map((c, j) => c + 0.5 * (worst.x[j] - c)),
          );
          const fc = obj(con);
          if (fc < worst.fx) {
            simplex[dim] = { x: con, fx: fc };
          } else {
            for (let i = 1; i <= dim; i++) {
              simplex[i].x = clampVec(simplex[i].x.map((v, j) => best.x[j] + 0.5 * (v - best.x[j])));
              simplex[i].fx = obj(simplex[i].x);
            }
          }
        }
      }
      simplex.sort((a, b) => a.fx - b.fx);
      if (simplex[0].fx < bestCost) {
        bestCost = simplex[0].fx;
        bestP = clampVec(simplex[0].x);
      }
    }
    return { p: bestP, cost: bestCost };
  }

  interface SmileExp {
    T: number;
    F: number;
    p: number[];
    rmse_vol_pts: number;
    n: number;
  }

  const smiles: SmileExp[] = [];
  const sortedExps = Array.from(byExp.entries()).sort((a, b) => a[0] - b[0]);

  for (const [, list] of sortedExps) {
    const fs = list.map((x) => x.F).sort((a, b) => a - b);
    const F = fs[Math.floor(fs.length / 2)];
    const T = list[0].T;
    const pts = list
      .filter((x) => (x.K < F && x.cp === 'P') || (x.K >= F && x.cp === 'C'))
      .map((x) => ({ k: Math.log(x.K / F), w: x.iv * x.iv * T }))
      .sort((a, b) => a.k - b.k);

    if (pts.length < 6) continue;
    const ks = pts.map((p) => p.k);
    const ws = pts.map((p) => p.w);
    const { p } = fitSviExpiry(ks, ws);

    let sqErr = 0;
    for (let i = 0; i < ks.length; i++) {
      const ivFit = Math.sqrt(Math.max(sviVal(p, ks[i]), 1e-12) / T);
      const ivObs = Math.sqrt(ws[i] / T);
      sqErr += (ivFit - ivObs) ** 2;
    }
    const rmseVolPts = Math.sqrt(sqErr / ks.length) * 100;
    smiles.push({ T, F, p, rmse_vol_pts: Number(rmseVolPts.toFixed(2)), n: ks.length });
  }

  if (smiles.length === 0) return null;

  const wAt = (T: number, k: number): number => {
    const first = smiles[0];
    const last = smiles[smiles.length - 1];
    if (T <= first.T) return (sviVal(first.p, k) * T) / first.T;
    if (T >= last.T) return (sviVal(last.p, k) * T) / last.T;
    let lo = first;
    let hi = last;
    for (let i = 0; i < smiles.length - 1; i++) {
      if (smiles[i].T <= T && smiles[i + 1].T >= T) {
        lo = smiles[i];
        hi = smiles[i + 1];
        break;
      }
    }
    const wl = sviVal(lo.p, k);
    const wh = sviVal(hi.p, k);
    return wl + ((T - lo.T) / Math.max(1e-9, hi.T - lo.T)) * (wh - wl);
  };

  // Evaluate Breeden-Litzenberger normalized Call CDF on log-moneyness grid
  const nGrid = 1201;
  const kGrid = new Array<number>(nGrid);
  const kExp = new Array<number>(nGrid);
  for (let i = 0; i < nGrid; i++) {
    const k = -1.2 + (2.4 * i) / (nGrid - 1);
    kGrid[i] = k;
    kExp[i] = Math.exp(k);
  }
  const atmIdx = Math.floor(nGrid / 2);

  const coneOut = {} as Record<'24' | '72', OptionsConeHorizon>;
  for (const h of horizons) {
    const T = h / 8760;
    const wArr = kGrid.map((k) => Math.max(wAt(T, k), 1e-10));
    const C = new Array<number>(nGrid);
    for (let i = 0; i < nGrid; i++) {
      const w = wArr[i];
      const sd = Math.sqrt(w);
      const d1 = (-kGrid[i] + w / 2) / sd;
      const d2 = d1 - sd;
      C[i] = normCdf(d1) - kExp[i] * normCdf(d2);
    }

    const cdfRaw = new Array<number>(nGrid);
    for (let i = 0; i < nGrid; i++) {
      let dCdK: number;
      if (i === 0) dCdK = (C[1] - C[0]) / (kExp[1] - kExp[0]);
      else if (i === nGrid - 1) dCdK = (C[nGrid - 1] - C[nGrid - 2]) / (kExp[nGrid - 1] - kExp[nGrid - 2]);
      else dCdK = (C[i + 1] - C[i - 1]) / (kExp[i + 1] - kExp[i - 1]);
      cdfRaw[i] = Math.min(1, Math.max(0, 1 + dCdK));
    }

    let mono = true;
    const cdf = new Array<number>(nGrid);
    let runMax = 0;
    for (let i = 0; i < nGrid; i++) {
      if (i > 0 && cdfRaw[i] < cdfRaw[i - 1] - 1e-6) mono = false;
      runMax = Math.max(runMax, cdfRaw[i]);
      cdf[i] = runMax;
    }

    const qPct: Record<string, number> = {};
    const prices: Record<string, number> = {};
    for (const qVal of QS) {
      const target = qVal / 100;
      let kExpInterp = kExp[nGrid - 1];
      if (target <= cdf[0]) kExpInterp = kExp[0];
      else {
        for (let i = 0; i < nGrid - 1; i++) {
          if (cdf[i] <= target && target <= cdf[i + 1]) {
            const span = cdf[i + 1] - cdf[i];
            const frac = span > 1e-12 ? (target - cdf[i]) / span : 0;
            kExpInterp = kExp[i] + frac * (kExp[i + 1] - kExp[i]);
            break;
          }
        }
      }
      const retPct = (kExpInterp - 1) * 100;
      qPct[String(qVal)] = Number(retPct.toFixed(2));
      prices[String(qVal)] = Number((spot * (1 + retPct / 100)).toFixed(2));
    }

    coneOut[String(h) as '24' | '72'] = {
      q: qPct,
      prices,
      mass_in_grid: Number((cdf[nGrid - 1] - cdf[0]).toFixed(4)),
      arbitrage_free_density: mono,
      iv_atm_pct: Number((Math.sqrt(wArr[atmIdx] / T) * 100).toFixed(2)),
    };
  }

  const fitMap: Record<string, { rmse_vol_pts: number; n: number }> = {};
  for (const s of smiles) {
    fitMap[`${(s.T * 365).toFixed(1)}d`] = { rmse_vol_pts: s.rmse_vol_pts, n: s.n };
  }

  return {
    asset,
    spot,
    ts: new Date(chainSnapshot.ts).toISOString(),
    expiries: smiles.length,
    fit: fitMap,
    cone: coneOut,
  };
}

/**
 * Simple L2-regularized Logistic Regression fit via gradient descent (for bias.py Models A & B).
 */
function fitLogisticL2(X: number[][], y: number[], C = 0.05): { w: number[]; b: number; mu: number[]; sd: number[] } {
  const n = X.length;
  const p = X[0].length;
  const mu = new Array<number>(p).fill(0);
  const sd = new Array<number>(p).fill(1);

  for (let j = 0; j < p; j++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += X[i][j];
    mu[j] = s / n;
    let v = 0;
    for (let i = 0; i < n; i++) v += (X[i][j] - mu[j]) ** 2;
    sd[j] = Math.sqrt(v / n) + 1e-9;
  }

  const Z = X.map((row) => row.map((val, j) => (val - mu[j]) / sd[j]));
  const w = new Array<number>(p).fill(0);
  let b = 0;
  const reg = 1 / Math.max(1e-4, C * n);
  const lr = 0.12;

  for (let iter = 0; iter < 150; iter++) {
    const gradW = new Array<number>(p).fill(0);
    let gradB = 0;
    for (let i = 0; i < n; i++) {
      let z = b;
      for (let j = 0; j < p; j++) z += w[j] * Z[i][j];
      const pred = 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, z))));
      const err = pred - y[i];
      gradB += err;
      for (let j = 0; j < p; j++) gradW[j] += err * Z[i][j];
    }
    b -= lr * (gradB / n);
    for (let j = 0; j < p; j++) {
      w[j] -= lr * (gradW[j] / n + reg * w[j]);
    }
  }

  return { w, b, mu, sd };
}

function predictLogistic(model: { w: number[]; b: number; mu: number[]; sd: number[] }, x: number[]): number {
  let z = model.b;
  for (let j = 0; j < x.length; j++) {
    z += model.w[j] * ((x[j] - model.mu[j]) / model.sd[j]);
  }
  return 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, z))));
}

/**
 * Computes bias.py daily rules (8 funding/OI rules with Bonferroni correction) & L2 logistic P(up) Models A/B.
 */
export function computeBiasAnalysis(params: {
  asset: AssetId;
  candles1d: Candle[];
  oiDaily: number[][];
  lsDaily: number[][];
  deribitFunding?: Array<{ timestamp: number; interest_1h: number }>;
  okxFunding?: Array<[number, number]>;
  dvolHourly?: number[][];
}): BiasAnalysisOutput {
  const DAY = 86_400_000;
  const HOUR = 3_600_000;
  const COST = 0.001;

  // Build aligned daily timeline from candles1d (last 135 days)
  const dailyCandles = params.candles1d.slice(-135);
  const n = dailyCandles.length;
  const closes = dailyCandles.map((c) => c[4]);
  const days = dailyCandles.map((c) => Math.floor(c[0] / DAY) * DAY);

  const oiMap = new Map<number, number>();
  for (const r of params.oiDaily) oiMap.set(Math.floor(r[0] / DAY) * DAY, r[2]);
  const lsMap = new Map<number, number>();
  for (const r of params.lsDaily) lsMap.set(Math.floor(r[0] / DAY) * DAY, r[1]);

  const dvMap = new Map<number, number>();
  for (const r of params.dvolHourly ?? []) dvMap.set(r[0], r[4]);

  const fundDaily: Array<number | null> = days.map((d) => {
    if (params.deribitFunding?.length) {
      const pts = params.deribitFunding.filter((x) => x.timestamp >= d && x.timestamp < d + DAY);
      return pts.length >= 18 ? pts.reduce((s, x) => s + x.interest_1h, 0) * 1e4 : null;
    }
    if (params.okxFunding?.length) {
      const pts = params.okxFunding.filter(([ts]) => ts >= d && ts < d + DAY);
      return pts.length >= 2 ? pts.reduce((s, [, v]) => s + v, 0) * 1e4 : null;
    }
    return null;
  });

  const oiSeries = days.map((d) => oiMap.get(d) ?? null);
  const lsSeries = days.map((d) => lsMap.get(d) ?? null);
  const dvolSeries = days.map((d) => dvMap.get(d + DAY - HOUR) ?? null);

  const lr1d = closes.map((c, i) => (i > 0 ? Math.log(c / closes[i - 1]) : 0));
  const rv14 = closes.map((_, i) =>
    i >= 14 ? std(lr1d.slice(i - 13, i + 1)) * Math.sqrt(365) * 100 : null,
  );

  const rollingZ = (arr: Array<number | null>, win = 60) =>
    arr.map((v, i) => {
      if (v === null) return null;
      const hist = arr.slice(Math.max(0, i - win), i).filter((x): x is number => x !== null && Number.isFinite(x));
      if (hist.length < 20) return null;
      const s = std(hist, 1);
      return s > 0 ? (v - mean(hist)) / s : null;
    });

  const fund1dZ = rollingZ(fundDaily, 60);
  const oiChg1d = oiSeries.map((v, i) =>
    i >= 1 && v !== null && oiSeries[i - 1] !== null ? ((v / oiSeries[i - 1]!) - 1) * 100 : null,
  );
  const lsZ = rollingZ(lsSeries, 60);
  const dvolZ = rollingZ(dvolSeries, 60);

  // 8 predefined funding & OI rules at 1d and 3d
  const ruleDefs: Array<{
    name: string;
    feat: 'fund_1d_z' | 'oi_chg_1d';
    cond: (v: number) => boolean;
    side: 1 | -1;
  }> = [
    { name: 'Funding muy negativo (z < -2) → largo', feat: 'fund_1d_z', cond: (v) => v < -2, side: 1 },
    { name: 'Funding muy positivo (z > +2) → corto', feat: 'fund_1d_z', cond: (v) => v > 2, side: -1 },
    { name: 'Caída fuerte del OI (-5 % en 1 d) → largo', feat: 'oi_chg_1d', cond: (v) => v < -5, side: 1 },
    { name: 'Subida fuerte del OI (+5 % en 1 d) → corto', feat: 'oi_chg_1d', cond: (v) => v > 5, side: -1 },
  ];

  const rules: BiasRuleResult[] = [];
  const nt2 = ruleDefs.length * 2;
  const rng = createRng(41);

  for (const rDef of ruleDefs) {
    const series = rDef.feat === 'fund_1d_z' ? fund1dZ : oiChg1d;
    const latestVal = series[n - 1];
    const activeNow = latestVal !== null && rDef.cond(latestVal);

    for (const h of [1, 3] as const) {
      const gross: number[] = [];
      const net: number[] = [];
      let i = 0;
      while (i < n - h) {
        const v = series[i];
        if (v !== null && Number.isFinite(v) && rDef.cond(v)) {
          const fwd = Math.log(closes[i + h] / closes[i]);
          const g = rDef.side * fwd;
          gross.push(g);
          net.push(g - COST);
          i += h;
        } else {
          i++;
        }
      }

      if (net.length < 4) {
        rules.push({
          rule: rDef.name,
          feature: rDef.feat,
          h,
          n: net.length,
          hit_pct: null,
          gross_pct: null,
          net_pct: null,
          ci: null,
          p: null,
          p_bonf: null,
          active_now: activeNow,
        });
        continue;
      }

      const mNet = mean(net);
      const sNet = std(net, 1);
      const t = sNet > 0 ? mNet / (sNet / Math.sqrt(net.length)) : 0;
      const pVal = Math.min(1, 2 * (1 - studentTCdfApprox(Math.abs(t), net.length - 1)));

      const bs: number[] = [];
      for (let b = 0; b < 500; b++) {
        let s = 0;
        for (let k = 0; k < net.length; k++) s += net[Math.floor(rng() * net.length)];
        bs.push((s / net.length) * 100);
      }
      bs.sort((a, b) => a - b);

      rules.push({
        rule: rDef.name,
        feature: rDef.feat,
        h,
        n: net.length,
        hit_pct: Number(((gross.filter((g) => g > 0).length / gross.length) * 100).toFixed(1)),
        gross_pct: Number((mean(gross) * 100).toFixed(3)),
        net_pct: Number((mNet * 100).toFixed(3)),
        ci: [Number(percentile(bs, 2.5).toFixed(2)), Number(percentile(bs, 97.5).toFixed(2))],
        p: Number(pVal.toFixed(3)),
        p_bonf: Number(Math.min(1, pVal * nt2).toFixed(2)),
        active_now: activeNow,
      });
    }
  }

  // Models A (price/vol) and B (price/vol + derivatives) P(up) at 1d and 3d
  const fitAndPredict = (h: 1 | 3, includeDerivs: boolean): { pUp: number | null; base: number | null } => {
    const X: number[][] = [];
    const y: number[] = [];
    let xNow: number[] | null = null;

    for (let i = 20; i < n; i++) {
      const mom3 = Math.log(closes[i] / closes[i - 3]);
      const mom7 = Math.log(closes[i] / closes[i - 7]);
      const vol = rv14[i];
      if (vol === null) continue;

      let feats = [lr1d[i], mom3, mom7, vol];
      if (includeDerivs) {
        const fz = fund1dZ[i];
        const oic = oiChg1d[i];
        const lsz = lsZ[i];
        if (fz === null || oic === null || lsz === null) continue;
        feats = [...feats, fz, oic, lsz, dvolZ[i] ?? 0];
      }

      if (i === n - 1) {
        xNow = feats;
      } else if (i < n - h) {
        X.push(feats);
        y.push(Math.log(closes[i + h] / closes[i]) > 0 ? 1 : 0);
      }
    }

    if (!xNow || X.length < 25) return { pUp: null, base: null };
    const mdl = fitLogisticL2(X, y, 0.05);
    return {
      pUp: Number((predictLogistic(mdl, xNow) * 100).toFixed(1)),
      base: Number((mean(y) * 100).toFixed(1)),
    };
  };

  const a1 = fitAndPredict(1, false);
  const b1 = fitAndPredict(1, true);
  const a3 = fitAndPredict(3, false);
  const b3 = fitAndPredict(3, true);

  return {
    asset: params.asset,
    n_days: n,
    p_up: {
      A1: a1.pUp,
      B1: b1.pUp,
      base1: a1.base,
      A3: a3.pUp,
      B3: b3.pUp,
      base3: a3.base,
    },
    rules,
  };
}


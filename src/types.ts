export type AssetId = 'btc' | 'eth' | 'sol';
export type NavTab =
  | 'cone'
  | 'gex'
  | 'trades'
  | 'trade_options'
  | 'rotation'
  | 'journal'
  | 'micro'
  | 'architecture';

export interface GarchParams {
  omega: number;
  alpha: number;
  gamma: number;
  beta: number;
  nu: number;
  persistence: number;
}

export interface ConeBlock {
  label: '1H' | '1D';
  spot: number;
  last_ts: number;
  step_ms: number;
  H: number;
  candles: [number, number, number, number, number][];
  cone: Record<string, number[]>;
  cone_ens?: Record<string, number[]>;
  sample_paths: number[][];
  garch: GarchParams;
  vol_now_ann: number;
  vol_pctile: number;
  vol_hist: number[];
  vol_hist_ts: number[];
  p_close_up: Record<string, number>;
  move: Record<string, { p5: number; p50: number; p95: number }>;
  touch: Array<{
    up: number;
    dn: number;
    up_first: number;
    dn_first: number;
    none: number;
  }>;
}

export interface DerivativesReadings {
  as_of: number;
  fund: number | null;
  fund_1d_z: number | null;
  fund_7d_z: number | null;
  dvol: number | null;
  dvol_z: number | null;
  iv_rv: number | null;
  oi_chg_1d: number | null;
  oi_chg_7d: number | null;
  oi_z: number | null;
  ls: number | null;
  ls_z: number | null;
  flags: {
    fund: 'neg' | 'pos' | 'none' | 'na';
    oi_flush: boolean | null;
  };
}

export interface GexTermBucket {
  bucket: '≤ 7 d' | '8–30 d' | '> 30 d';
  net_gex_m: number;
  call_gex_m: number;
  put_gex_m: number;
  n_contracts: number;
  oi_contracts: number;
}

export interface IvSmilePoint {
  strike: number;
  call_iv: number | null;
  put_iv: number | null;
  avg_iv: number;
}

export interface GexOutput {
  asset: string;
  spot: number;
  as_of: number;
  n_contracts: number;
  net_gex_m: number;
  net_gex_7d_m: number;
  flip: number | null;
  call_wall: number | null;
  put_wall: number | null;
  regime: string;
  put_call_oi: number | null;
  by_strike: Array<{
    strike: number;
    call_gex_m: number;
    put_gex_m: number;
    net_gex_m: number;
    oi_contracts: number;
  }>;
  profile: Array<{ spot: number; gex_m: number }>;
  term_buckets: GexTermBucket[];
  iv_smile: IvSmilePoint[];
  /** Strike de máximo dolor por vencimiento (4 más cercanos). */
  max_pain: Array<{ expiry: string; days: number; strike: number; oi: number }>;
  /** IV ATM por vencimiento (estructura temporal). */
  atm_term: Array<{ expiry: string; days: number; iv: number }>;
  /** Risk reversal / butterfly 25Δ del vencimiento más cercano a 30 días. */
  skew25: { expiry: string; days: number; rr25: number; bf25: number; atm_iv: number } | null;
}

export interface WalkForwardOutput {
  asset: AssetId;
  window: number;
  step: number;
  sims: number;
  horizons: Array<{
    horizon: number;
    n: number;
    garch: Record<'50' | '80' | '90', number>;
    base: Record<'50' | '80' | '90', number>;
    winkler90_garch: number;
    winkler90_base: number;
    crps_garch: number;
    crps_base: number;
    dm_stat: number;
    dm_p: number;
    kupiec90_garch_p: number;
    christ_ind90_garch_p: number;
    christ_cc90_garch_p: number;
    aci: {
      cov90: number;
      winkler90: number;
      mean_width_pct: number;
      kupiec90_p: number;
      christ_ind90_p: number;
      last_alpha_eff: number;
    } | null;
    pit_hist: number[];
  }>;
}

export interface OptionsConeHorizon {
  q: Record<string, number>;
  prices: Record<string, number>;
  mass_in_grid: number;
  arbitrage_free_density: boolean;
  iv_atm_pct: number;
}

export interface OptionsConeOutput {
  asset: 'btc' | 'eth';
  spot: number;
  ts: string;
  expiries: number;
  fit: Record<string, { rmse_vol_pts: number; n: number }>;
  cone: Record<'24' | '72', OptionsConeHorizon>;
}

export interface RotationVariantStats {
  n_days: number;
  sharpe_ann: number;
  mean_bps_day: number;
  nw_t: number;
  sharpe_h1: number;
  sharpe_h2: number;
  psr0?: number;
  dsr?: number;
  exp_max_sharpe_day?: number;
  mean_ci95_bps_day?: [number, number];
}

export interface RotationResponse {
  universe: string[];
  n_assets: number;
  from: string;
  to: string;
  n_trials: number;
  primary: string;
  primary_result: RotationVariantStats;
  primary_abs_net: RotationVariantStats;
  benchmark_ew: RotationVariantStats;
  best_variant: string;
  best_variant_result: RotationVariantStats;
  best_dsr: number;
  /** Sharpe anualizado del exceso de la primaria con el rebalanceo desplazado 0..6 días. */
  phase_sharpes: number[];
  phase_pos_share: number;
  avg_turnover_day: number;
  verdict: 'sin_ventaja' | 'indicios' | 'robusta_con_sesgo';
  share_variants_sharpe_pos: number;
  variants: Record<string, RotationVariantStats>;
  current_ranking: Array<{
    symbol: string;
    last_close: number;
    mom_30d_pct: number;
    mom_7d_pct: number;
    in_top5: boolean;
  }>;
}

export interface BiasAnalysisOutput {
  asset: AssetId;
  n_days: number;
  p_up: {
    A1: number | null;
    B1: number | null;
    base1: number | null;
    A3: number | null;
    B3: number | null;
    base3: number | null;
  };
  rules: Array<{
    rule: string;
    feature: string;
    h: number;
    n: number;
    hit_pct: number | null;
    gross_pct: number | null;
    net_pct: number | null;
    ci: [number, number] | null;
    p: number | null;
    p_bonf: number | null;
    active_now: boolean;
  }>;
}

export interface RadarAssetItem {
  asset: AssetId;
  inst: string;
  spot: number;
  chg_24h_pct: number;
  vol_ann_pct: number;
  vol_pctile: number;
  regime: 'Calma' | 'Normal' | 'Turbulento';
  ens_ratio_72: number;
  cone24_lo: number;
  cone24_hi: number;
  net_gex_m: number | null;
  fund_1d_z: number | null;
  oi_chg_1d: number | null;
  flags: {
    fund: 'neg' | 'pos' | 'none' | 'na';
    oi_flush: boolean | null;
  };
}

export interface CollectorStatus {
  running: boolean;
  asset: AssetId;
  inst: string;
  started_at: number | null;
  bars_collected: number;
  last_bar_ts: number | null;
  last_mid: number | null;
  missed_bars: number;
  trades_polled: number;
}

export interface OverviewResponse {
  generated: number;
  asset: AssetId;
  inst: string;
  n_hours: number;
  n_days: number;
  regime: {
    current: 'Calma' | 'Normal' | 'Turbulento';
    probs: Record<'Calma' | 'Normal' | 'Turbulento', number>;
  };
  ens_ratio: Record<string, number>;
  h1: ConeBlock;
  d1: ConeBlock;
  readings: DerivativesReadings;
  gex: GexOutput | null;
  options_cone: OptionsConeOutput | null;
}

export interface TradeGridRow {
  dir: 'long' | 'short';
  sl_pct: number;
  tp_pct: number;
  p_tp_pct: number;
  p_sl_pct: number;
  p_to_pct: number;
  ev_pct: number;
  ev_se_pct: number;
  ev_r: number;
  kelly_pct: number;
  be_pct: number;
  rr: number;
  sig_pos: boolean;
  key?: string;
  req_drift_24h_pct?: number | null;
}

export interface ContrarianEvent {
  rule: string;
  feature: string;
  th: number;
  h: number;
  n: number;
  hit_pct: number;
  gross_pct: number;
  net_pct: number;
  ci_lo: number;
  ci_hi: number;
  p: number;
  p_bonf: number;
  active_now: boolean;
  dir_now: 'long' | 'short' | null;
}

export interface TradeAnalysisResponse {
  asset: AssetId;
  spot: number;
  cost_pct: number;
  n_sims: number;
  H: number;
  n_sig: number;
  n_combos: number;
  best_long_ev_pct: number;
  best_short_ev_pct: number;
  grid: TradeGridRow[];
  top: TradeGridRow[];
  events: ContrarianEvent[];
  feat_now: Record<string, number>;
}

export interface JournalAssetData {
  asset: AssetId;
  predictions: Array<{
    id: string;
    anchor_ts: number;
    spot: number;
    vol_ann_pct: number;
    vol_pctile: number;
    regime_vol: string;
    gmm: { state: string | null; p: number | null };
    readings: Record<string, number | null>;
    gex: Record<string, number | null>;
    flags: { fund: string; oi_flush: boolean | null };
    bias_applied_pct: number;
    cone: Record<string, Record<string, number>>;
    cone_ens?: Record<string, Record<string, number>>;
    cone_opt?: Record<string, Record<string, number>> | null;
    ens_ratio?: Record<string, number>;
    p_up: Record<string, number>;
  }>;
  scored: Array<{
    asset: AssetId;
    id: string;
    h: number;
    spot: number;
    close: number;
    ret_pct: number;
    in50: number;
    in90: number;
    pit: number;
    in90_ens: number | null;
    in90_opt: number | null;
    pin: number;
    pin_ens: number | null;
    pin_opt: number | null;
    p_up: number | null;
    fund: string;
    oi_flush: boolean | null;
    gmm: string | null;
  }>;
  coverage: Array<{
    horizon: number;
    n: number;
    c50: number | null;
    c90: number | null;
    c90_ens: number | null;
    c90_opt: number | null;
    n_indep: number;
    kupiec_p: number | null;
    pit_mean: number | null;
    pit_ks: number | null;
    pit_ks_crit: number | null;
    pin: number | null;
    pin_ens: number | null;
    pin_opt: number | null;
    brier: number | null;
    brier_ref: number | null;
    verdict: 'calibrado' | 'sesgado' | 'datos_insuficientes';
  }>;
  by_flag: Array<{
    reading: string;
    horizon: number;
    n: number;
    mean_pct: number | null;
    up_pct: number | null;
  }>;
}

export interface AutoJournalStatus {
  enabled: boolean;
  running: boolean;
  lastCheckTs: number | null;
  lastSavedTs: number | null;
  savedDates: Record<AssetId, string | null>;
  lastError: string | null;
}

export interface ResultsResponse {
  sample_note: string;
  vol_ensemble: Array<{
    asset: string;
    horizon: string;
    har: string;
    ens: string;
    ens_iv: string;
    positive: boolean;
  }>;
  directional_signals: Array<{
    asset: string;
    horizon: string;
    hit_pct: number;
    auc: number;
    net_pct: number;
    ci: string;
  }>;
  binance_intraday: Array<{
    asset: string;
    horizon: string;
    hit_pct: number;
    auc: number;
    gross_pct: number;
    net_pct: number;
  }>;
  formal_eval_note: string;
  conformal_note: string;
  options_cone_note: string;
  rotation_summary: {
    primary_sharpe: number;
    nw_t: number;
    dsr: number;
    best_variant: string;
    best_sharpe: number;
    best_dsr: number;
    note: string;
  };
}

export interface MicroLiveResponse {
  inst: string;
  ctVal: number;
  buffer_len: number;
  tick: {
    ts: number;
    mid: number;
    spread_bps: number;
    microprice_bps: number;
    imb5: number | null;
    imb20: number | null;
    depth_bid_btc: number;
    depth_ask_btc: number;
    mark: number | null;
    index: number | null;
    basis_bps: number | null;
    funding: number | null;
    oi_btc: number | null;
    tk_buy_btc: number;
    tk_sell_btc: number;
    n_trades: number;
    vwap: number | null;
    missed: number;
    liq_long_btc: number;
    liq_short_btc: number;
  };
  orderbook: {
    bids: [number, number][];
    asks: [number, number][];
  };
  recentTrades: Array<{ ts: number; px: number; qty: number; side: 'buy' | 'sell' }>;
  recentLiqs: Array<{ ts: number; px: number; qty: number; side: string }>;
}

export interface MicroStudyResponse {
  files: string[];
  n_rows: number;
  min_rows_required: number;
  ready_for_walk_forward: boolean;
  coverage_days: number;
  from_ts: number | null;
  to_ts: number | null;
  missed_pct: number;
  mean_spread_bps: number;
  mean_basis_bps: number;
  n_tests: number;
  ic: Array<{
    h: number;
    feature: string;
    ic: number;
    p: number;
    p_bonf: number;
    n: number;
    edge_bps: number;
    cost_bps: number;
    folds_same_sign: number | null;
    viable: boolean;
  }>;
  recent_series: Array<{
    ts: number;
    mid: number;
    imb5: number | null;
    basis_bps: number | null;
    spread_bps: number;
    tk_buy_btc: number;
    tk_sell_btc: number;
  }>;
}

export interface TechnicalParametersSnapshot {
  spot: number;
  ema20: number;
  ema50: number;
  ema200: number;
  sma50_1d: number | null;
  rsi14: number;
  macd: number;
  macdSignal: number;
  macdHist: number;
  adx14: number;
  plusDi14: number;
  minusDi14: number;
  atr14: number;
  atr14Pct: number;
  bbUpper: number;
  bbMid: number;
  bbLower: number;
  bbZ: number;
  bbWidthPct: number;
  vwap24h: number;
  vwap7d: number;
  vwapDistPct: number;
  stochK: number;
  stochD: number;
  rvol24h: number;
  obvTrend: 'alcista' | 'bajista' | 'neutral';
  high24h: number;
  low24h: number;
  high7d: number;
  low7d: number;
  pivotP: number;
  pivotR1: number;
  pivotS1: number;
  trendBias: 'alcista' | 'bajista' | 'lateral';
}

export interface ConfluenceFactor {
  name: string;
  category: 'técnico' | 'derivados' | 'gex' | 'volatilidad';
  reading: string;
  signal: 'long' | 'short' | 'neutral';
  weight: number;
}

export type ProposalRegimeTag = 'gamma_flip' | 'trend';

export interface MarketBiasSnapshot {
  gexAvailable: boolean;
  positiveGexM: number | null;
  negativeGexM: number | null;
  netGexDiffM: number | null;
  imbalancePct: number | null;
  gammaFlip: number | null;
  flipDistancePct: number | null;
  inGammaFlipZone: boolean;
  inTrendRegime: boolean;
  activeRegime: 'gamma_flip' | 'trend' | 'balanced';
  biasDirection: 'alcista' | 'bajista' | 'neutral';
  biasLabel: string;
  termGex: Array<{
    bucket: string;
    positiveM: number;
    negativeM: number;
    netM: number;
  }>;
}

export interface TradeOptionProposal {
  id: string;
  asset: AssetId;
  strategyKey: 'trend_pullback' | 'mean_reversion' | 'derivatives_squeeze' | 'range_breakout';
  title: string;
  dir: 'long' | 'short';
  horizonHours: 24 | 72;
  spot: number;
  entryLow: number;
  entryHigh: number;
  entryMid: number;
  stopLoss: number;
  slPct: number;
  takeProfit1: number;
  tp1Pct: number;
  takeProfit2: number;
  tp2Pct: number;
  rr: number;
  probTpPct: number;
  probSlPct: number;
  probTimeoutPct: number;
  evPct: number;
  evR: number;
  kellyPct: number;
  confluenceScore: number;
  confidence: 'Alta' | 'Media' | 'Moderada';
  regimeTags: ProposalRegimeTag[];
  rationale: string[];
  invalidation: string;
  factors: ConfluenceFactor[];
  /** Calidad global 0-100: setup + confluencia + historial de la estrategia. */
  quality: number;
  /** Veredicto sobre la ventaja medida de la estrategia (backtest + operaciones reales registradas). */
  verdict: EdgeVerdict;
  /** Resultado medido de la estrategia en este activo. */
  track: StrategyTrack | null;
  /** true = ventaja validada o prometedora y calidad suficiente. */
  recommended: boolean;
  htfTrend: 'alcista' | 'bajista' | 'lateral';
}

export type EdgeVerdict = 'validada' | 'prometedora' | 'dudosa' | 'descartada' | 'sin_datos';

export interface StrategyTrack {
  strategyKey: string;
  /** Backtest histórico (replay de las mismas reglas). */
  btN: number;
  btWinPct: number | null;
  btExpR: number | null;
  btDays: number;
  /** Operaciones reales registradas por la app (independientes y ya cerradas). */
  fwN: number;
  fwWinPct: number | null;
  fwExpR: number | null;
  /** Combinado. */
  n: number;
  expR: number | null;
  seR: number | null;
  verdict: EdgeVerdict;
}

export interface SkippedStrategy {
  strategyKey: string;
  label: string;
  reason: string;
}

export type TradeOptionStatus = 'open' | 'tp_hit' | 'sl_hit' | 'expired' | 'closed_manual';

export interface RegisteredTradeOption {
  id: string;
  asset: AssetId;
  strategyKey: string;
  title: string;
  dir: 'long' | 'short';
  horizonHours: 24 | 72;
  createdTs: number;
  createdIso: string;
  entryPrice: number;
  entryLow: number;
  entryHigh: number;
  stopLoss: number;
  slPct: number;
  takeProfit1: number;
  tp1Pct: number;
  takeProfit2: number;
  rr: number;
  probTpPct: number;
  evPct: number;
  confluenceScore: number;
  confidence: 'Alta' | 'Media' | 'Moderada';
  source: 'auto' | 'manual';
  status: TradeOptionStatus;
  evaluatedTs: number | null;
  exitPrice: number | null;
  realizedPnlPct: number | null;
  mfePct: number | null;
  maePct: number | null;
  summary: string;
  /** Posición en el ranking de su tanda (1 = la mejor según confluencia y probabilidad). */
  rank?: number;
  /** ¿Llegó a TP2 antes que al SL dentro del horizonte? (solo con horizonte completo) */
  tp2Hit?: boolean | null;
  /** Retorno bruto (%) al final del horizonte, con signo según la dirección de la operación. */
  closeRetPct?: number | null;
  /** ¿El precio terminó el horizonte en la dirección prevista? */
  dirCorrect?: boolean | null;
  /** Resultado de la operación espejo (dirección contraria, mismas distancias SL/TP): control de azar. */
  mirrorStatus?: 'tp_hit' | 'sl_hit' | 'expired' | null;
  /** true cuando ya se evaluó el horizonte completo. */
  horizonDone?: boolean;
  quality?: number;
  verdict?: string;
  /** Contexto de mercado congelado al crear la opción (para saber en qué condiciones funciona). */
  ctx?: {
    regime: string;
    trendBias: string;
    marketRegime: string;
    biasDirection: string;
    adx: number;
  };
}

export interface TradeOptionGroupStats {
  key: string;
  label: string;
  /** Opciones guardadas en el grupo (incluye abiertas). */
  n: number;
  open: number;
  tpHit: number;
  slHit: number;
  expired: number;
  /** TP1 sobre todas las cerradas por el sistema (TP + SL + expiradas). */
  tpRatePct: number | null;
  /** TP1 sobre las decididas (TP + SL). */
  winDecidedPct: number | null;
  /** Probabilidad media de TP que predijo la app para esas mismas opciones. */
  predProbTpPct: number | null;
  /** Tasa de acierto mínima (entre decididas) para no perder dinero con esas distancias SL/TP y costes. */
  breakevenPct: number | null;
  /** Tasa de TP de la operación espejo (control de azar). */
  mirrorTpRatePct: number | null;
  /** Dirección acertada al final del horizonte: todas las evaluadas (se solapan en el tiempo). */
  dirN: number;
  dirAccPct: number | null;
  /** Misma métrica con opciones sin solape temporal por activo+estrategia (la que cuenta para concluir). */
  dirIndepN: number;
  dirIndepAccPct: number | null;
  dirCi95: [number, number] | null;
  dirPValue: number | null;
  /** Acierto esperado si la dirección no tuviera relación con el resultado (depende de cuántos largos/cortos y de cuánto subió el mercado). */
  dirBaselinePct: number | null;
  /** Acierto observado menos acierto esperado por azar (puntos porcentuales). */
  dirSkillPp: number | null;
  /** p-valor de ese exceso sobre el azar (test normal sobre suma de Bernoullis, bilateral). */
  dirSkillP: number | null;
  avgPnlPct: number | null;
  avgCloseRetPct: number | null;
}

export interface TradeOptionEvaluation {
  overall: TradeOptionGroupStats;
  byStrategy: TradeOptionGroupStats[];
  byDir: TradeOptionGroupStats[];
  byConfidence: TradeOptionGroupStats[];
  byVerdict: TradeOptionGroupStats[];
  byAsset: TradeOptionGroupStats[];
  byRank: TradeOptionGroupStats[];
  byConfluence: TradeOptionGroupStats[];
  byRegime: TradeOptionGroupStats[];
  byMarketRegime: TradeOptionGroupStats[];
  /** Fiabilidad de la probabilidad de TP que anuncia la app. */
  calibration: Array<{ label: string; n: number; predictedPct: number; actualPct: number }>;
  brier: { score: number; baseline: number; n: number } | null;
  /** Resultado principal: opciones sin solape por activo (conservador). */
  headline: {
    n: number;
    accPct: number | null;
    baselinePct: number | null;
    skillPp: number | null;
    pValue: number | null;
    ci95: [number, number] | null;
  };
  progress: { n: number; needed: number; etaDays: number | null; firstTs: number | null };
  timeline: {
    accuracy: Array<{ ts: number; n: number; accPct: number; baselinePct: number }>;
    pnl: Array<{ ts: number; cumPnlPct: number }>;
  };
  verdict: { level: 'insufficient' | 'no_edge' | 'edge' | 'worse'; text: string };
  minIndependent: number;
}

export interface TradeOptionsResponse {
  generated: number;
  asset: AssetId;
  inst: string;
  spot: number;
  regime: {
    current: 'Calma' | 'Normal' | 'Turbulento';
    probs: Record<'Calma' | 'Normal' | 'Turbulento', number>;
  };
  technicals: TechnicalParametersSnapshot;
  marketBias: MarketBiasSnapshot;
  marketSummary: {
    pUp24hPct: number;
    pUp72hPct: number;
    dvol: number | null;
    ivRv: number | null;
    fund1dZ: number | null;
    oiChg1d: number | null;
    lsZ: number | null;
    netGexM: number | null;
    gammaFlip: number | null;
    callWall: number | null;
    putWall: number | null;
    biasModelB1d: number | null;
    biasModelB3d: number | null;
  };
  proposals: TradeOptionProposal[];
  /** Estrategias que hoy NO proponen operación y por qué. */
  skipped: SkippedStrategy[];
  /** Historial medido de cada estrategia en este activo. */
  strategyTracks: StrategyTrack[];
  htf: { trend: 'alcista' | 'bajista' | 'lateral'; atrDPct: number | null };
  registered: RegisteredTradeOption[];
  stats: {
    total: number;
    open: number;
    tpHit: number;
    slHit: number;
    expired: number;
    winRatePct: number | null;
    avgPnlPct: number | null;
    evaluation: TradeOptionEvaluation;
  };
}

export interface TargetProbability {
  asset: AssetId;
  spot: number;
  price: number;
  distPct: number;
  hours: number;
  /** Probabilidad de tocar el nivel (con corrección de toque intravela). */
  pTouchPct: number;
  pCloseAbovePct: number;
  pCloseBelowPct: number;
  medianHoursToTouch: number | null;
  quantiles: { p5: number; p25: number; p50: number; p75: number; p95: number };
  sigmaHourPct: number;
  ensRatio: { '24': number; '72': number };
  generated: number;
}

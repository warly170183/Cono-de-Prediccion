import type { AssetId, Candle } from './types.ts';
import { fetchOkxCandles, getDegradedSources } from './marketData.ts';
import { loadJournalPredictions, scorePredictions, summarizeCoverage, SCORING_CANDLES } from './journalService.ts';
import { loadRegisteredTradeOptions } from './tradeOptionsService.ts';
import { buildEvaluation } from './optionStats.ts';
import { computeMicroStudy, getCollectorStatus } from './microService.ts';
import { peekRotation } from './rotationService.ts';

export type HealthLevel = 'ok' | 'warn' | 'bad' | 'wait';
export interface HealthItem {
  id: string;
  module: string;
  level: HealthLevel;
  text: string;
}

/** Duración objetivo de la campaña de medición antes de fiarse de los veredictos. */
export const CAMPAIGN_DAYS = 28;

export function campaignProgress(firstTs: number | null, now = Date.now()) {
  if (!firstTs) return { startTs: null, days: 0, targetDays: CAMPAIGN_DAYS, pct: 0, done: false };
  const days = Math.max(0, (now - firstTs) / 86_400_000);
  return {
    startTs: firstTs,
    days: Number(days.toFixed(1)),
    targetDays: CAMPAIGN_DAYS,
    pct: Number(Math.min(100, (days / CAMPAIGN_DAYS) * 100).toFixed(0)),
    done: days >= CAMPAIGN_DAYS,
  };
}

export async function computeHealth(now = Date.now()) {
  const items: HealthItem[] = [];
  let firstTs: number | null = null;

  // Cono / diario
  for (const asset of ['btc', 'eth', 'sol'] as AssetId[]) {
    const preds = loadJournalPredictions(asset);
    if (preds.length) firstTs = Math.min(firstTs ?? Infinity, preds[0].anchor_ts);
    let candles: Candle[] = [];
    try {
      candles = await fetchOkxCandles(asset, '1H', SCORING_CANDLES, false);
    } catch {
      /* sin velas: se reporta como espera */
    }
    const cov = summarizeCoverage(scorePredictions(asset, preds, candles));
    for (const c of cov) {
      const lvl: HealthLevel = c.verdict === 'calibrado' ? 'ok' : c.verdict === 'sesgado' ? 'bad' : 'wait';
      items.push({
        id: `cone_${asset}_${c.horizon}`,
        module: `Cono ${asset.toUpperCase()} ${c.horizon} h`,
        level: lvl,
        text:
          c.verdict === 'datos_insuficientes'
            ? `${c.n_indep} de 20 muestras independientes`
            : `Cobertura 90 %: ${c.c90?.toFixed(0)} % · Kupiec p=${c.kupiec_p?.toFixed(2)} · ${c.verdict}`,
      });
    }
  }

  // Opciones de trading
  const rows = loadRegisteredTradeOptions();
  if (rows.length) firstTs = Math.min(firstTs ?? Infinity, ...rows.map((r) => r.createdTs));
  const ev = buildEvaluation(rows, now);
  items.push({
    id: 'options',
    module: 'Opciones de trading',
    level: ev.verdict.level === 'edge' ? 'ok' : ev.verdict.level === 'worse' ? 'bad' : ev.verdict.level === 'no_edge' ? 'warn' : 'wait',
    text: ev.verdict.text,
  });

  // Microestructura
  try {
    const m = computeMicroStudy();
    const viable = m.ic.filter((r) => r.viable).length;
    items.push({
      id: 'micro',
      module: 'Microestructura',
      level: !m.ready_for_walk_forward ? 'wait' : viable > 0 ? 'ok' : 'warn',
      text: !m.ready_for_walk_forward
        ? `${m.n_rows} de ${m.min_rows_required} barras de 1 min (${m.coverage_days} días)`
        : viable > 0
          ? `${viable} señal(es) operables tras costes`
          : 'Ninguna señal supera costes y múltiples contrastes',
    });
  } catch {
    items.push({ id: 'micro', module: 'Microestructura', level: 'wait', text: 'Sin datos' });
  }

  // Rotación
  const rot = peekRotation();
  items.push({
    id: 'rotation',
    module: 'Rotación 40',
    level: !rot ? 'wait' : rot.verdict === 'robusta_con_sesgo' ? 'ok' : rot.verdict === 'indicios' ? 'warn' : 'bad',
    text: !rot
      ? 'Aún no calculada (abre la pestaña Rotación 40)'
      : rot.verdict === 'robusta_con_sesgo'
        ? 'Robusta, pero con sesgo de supervivencia sin descontar'
        : rot.verdict === 'indicios'
          ? 'Indicios, no concluyente'
          : 'Sin ventaja demostrada',
  });

  // Fuentes en modo degradado
  const deg = getDegradedSources();
  items.push({
    id: 'sources',
    module: 'Fuentes de datos',
    level: deg.length ? 'warn' : 'ok',
    text: deg.length ? `${deg.length} fuente(s) sirviendo datos antiguos por fallo de la API` : 'OKX y Deribit responden',
  });

  const col = getCollectorStatus();
  const cnt = (l: HealthLevel) => items.filter((i) => i.level === l).length;
  const overall: HealthLevel = cnt('bad') > 0 ? 'bad' : cnt('warn') > 0 ? 'warn' : cnt('wait') > cnt('ok') ? 'wait' : 'ok';
  return {
    generated: now,
    overall,
    campaign: campaignProgress(firstTs, now),
    items,
    degraded: deg,
    collector: { running: col.running, bars: col.bars_collected },
  };
}

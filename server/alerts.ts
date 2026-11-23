import fs from 'fs';
import path from 'path';
import { DATA_DIR, atomicWrite } from './paths.ts';
import { readSettings, updateSettings, type AlertSettings } from './storage.ts';
import type { RegisteredTradeOption } from './types.ts';
import type { HealthItem } from './health.ts';

const STATE_FILE = path.join(DATA_DIR, 'alerts_state.json');
const COOLDOWN_MS = 6 * 3_600_000;

export const DEFAULT_ALERTS: AlertSettings = {
  enabled: false,
  events: { setup: true, gex: true, cono: true, fuentes: true },
  gexProximityPct: 0.5,
};

export interface AlertCandidate {
  key: string;
  event: keyof AlertSettings['events'];
  text: string;
  /** true: se avisa una sola vez por clave; false: se repite pasado el enfriamiento. */
  once: boolean;
}

export function getAlertSettings(): AlertSettings {
  return { ...DEFAULT_ALERTS, ...(readSettings().alerts ?? {}), events: { ...DEFAULT_ALERTS.events, ...(readSettings().alerts?.events ?? {}) } };
}

/** Versión segura para la interfaz: nunca devuelve el token. */
export function publicAlertSettings() {
  const a = getAlertSettings();
  const { telegramToken, ...rest } = a;
  return { ...rest, telegramConfigured: Boolean(telegramToken && a.telegramChatId), webhookConfigured: Boolean(a.webhookUrl) };
}

export function saveAlertSettings(patchIn: Partial<AlertSettings>): void {
  const patch = Object.fromEntries(Object.entries(patchIn).filter(([, v]) => v !== undefined)) as Partial<AlertSettings>;
  const cur = getAlertSettings();
  const next: AlertSettings = { ...cur, ...patch, events: { ...cur.events, ...(patch.events ?? {}) } };
  // Un campo vacío borra el secreto; undefined lo conserva.
  for (const k of ['telegramToken', 'telegramChatId', 'webhookUrl'] as const) {
    if (patch[k] === '') delete next[k];
  }
  updateSettings({ alerts: next });
}

interface AlertState { sent: Record<string, number> }
function readState(): AlertState {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) as AlertState;
  } catch {
    return { sent: {} };
  }
}

/** Candidatos de aviso a partir de datos ya calculados (función pura, testeable). */
export function collectAlertCandidates(input: {
  options: RegisteredTradeOption[];
  now: number;
  gex?: { spot: number; flip: number | null; callWall: number | null; putWall: number | null } | null;
  health?: HealthItem[];
  proximityPct: number;
}): AlertCandidate[] {
  const out: AlertCandidate[] = [];
  for (const o of input.options) {
    if (o.status === 'open' && o.verdict === 'validada' && input.now - o.createdTs < 48 * 3_600_000) {
      out.push({
        key: `setup:${o.id}`,
        event: 'setup',
        once: true,
        text: `Setup validado ${o.asset.toUpperCase()} ${o.dir === 'long' ? 'LARGO' : 'CORTO'} (${o.strategyKey}): entrada ${o.entryPrice}, SL ${o.stopLoss}, TP ${o.takeProfit1}, R:R ${o.rr}.`,
      });
    }
  }
  const g = input.gex;
  if (g && g.spot > 0) {
    for (const [name, lvl] of [['gamma flip', g.flip], ['call wall', g.callWall], ['put wall', g.putWall]] as const) {
      if (lvl && Math.abs(g.spot / lvl - 1) * 100 <= input.proximityPct) {
        out.push({ key: `gex:${name}`, event: 'gex', once: false, text: `BTC a ${(Math.abs(g.spot / lvl - 1) * 100).toFixed(2)} % del ${name} (${lvl.toFixed(0)}). Precio ${g.spot.toFixed(0)}.` });
      }
    }
  }
  for (const h of input.health ?? []) {
    if (h.id.startsWith('cone_') && h.level === 'bad') out.push({ key: `cono:${h.id}`, event: 'cono', once: false, text: `${h.module} descalibrado: ${h.text}` });
    if (h.id === 'sources' && h.level === 'warn') out.push({ key: 'fuentes', event: 'fuentes', once: false, text: h.text });
  }
  return out;
}

async function post(url: string, body: unknown): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function sendAlert(text: string, cfg = getAlertSettings()): Promise<{ telegram: boolean | null; webhook: boolean | null }> {
  const tg = cfg.telegramToken && cfg.telegramChatId
    ? await post(`https://api.telegram.org/bot${cfg.telegramToken}/sendMessage`, { chat_id: cfg.telegramChatId, text: `Trading Predictor: ${text}` })
    : null;
  const wh = cfg.webhookUrl ? await post(cfg.webhookUrl, { text: `Trading Predictor: ${text}`, source: 'trading-predictor' }) : null;
  return { telegram: tg, webhook: wh };
}

/** Envía los candidatos nuevos respetando duplicados y enfriamiento. Devuelve los enviados. */
export async function dispatchCandidates(cands: AlertCandidate[], now = Date.now(), cfg = getAlertSettings()): Promise<AlertCandidate[]> {
  if (!cfg.enabled) return [];
  const state = readState();
  const sent: AlertCandidate[] = [];
  for (const c of cands) {
    if (!cfg.events[c.event]) continue;
    const last = state.sent[c.key];
    if (last !== undefined && (c.once || now - last < COOLDOWN_MS)) continue;
    const r = await sendAlert(c.text, cfg);
    if (r.telegram === false && r.webhook !== true) continue; // fallo de envío: se reintenta en el siguiente ciclo
    if (r.webhook === false && r.telegram !== true) continue;
    state.sent[c.key] = now;
    sent.push(c);
  }
  const cutoff = now - 30 * 86_400_000;
  for (const k of Object.keys(state.sent)) if (state.sent[k] < cutoff) delete state.sent[k];
  atomicWrite(STATE_FILE, JSON.stringify(state));
  return sent;
}

export async function runAlertChecks(): Promise<AlertCandidate[]> {
  const cfg = getAlertSettings();
  if (!cfg.enabled) return [];
  const { loadRegisteredTradeOptions } = await import('./tradeOptionsService.ts');
  const { computeHealth } = await import('./health.ts');
  const { fetchDeribitOptionsChain } = await import('./marketData.ts');
  const { computeGex } = await import('./quantEngine.ts');
  let gex = null;
  try {
    const snap = await fetchDeribitOptionsChain('btc', false);
    const g = computeGex('btc', snap);
    gex = { spot: snap.index, flip: g.flip, callWall: g.call_wall, putWall: g.put_wall };
  } catch {
    /* sin cadena: se omite el aviso GEX */
  }
  let health: HealthItem[] = [];
  try {
    health = (await computeHealth()).items;
  } catch {
    /* ignorar */
  }
  const cands = collectAlertCandidates({ options: loadRegisteredTradeOptions(), now: Date.now(), gex, health, proximityPct: cfg.gexProximityPct });
  return dispatchCandidates(cands, Date.now(), cfg);
}

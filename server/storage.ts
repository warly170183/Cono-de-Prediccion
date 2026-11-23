import fs from 'fs';
import path from 'path';
import { DATA_DIR, JOURNAL_DIR, LEGACY_JOURNAL_DIR, atomicWrite } from './paths.ts';
import type { AssetId } from './types.ts';

const HOUR = 3_600_000;
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const KEEP_BACKUPS = 14;

/** Lee un .jsonl tolerando líneas dañadas: las salta y las guarda aparte en <fichero>.corrupt. */
export function readJsonl<T>(file: string, map?: (raw: T) => T): T[] {
  if (!fs.existsSync(file)) return [];
  const out: T[] = [];
  const bad: string[] = [];
  for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const v = JSON.parse(line) as T;
      out.push(map ? map(v) : v);
    } catch {
      bad.push(line);
    }
  }
  if (bad.length) {
    try {
      const cf = `${file}.corrupt`;
      const known = new Set(fs.existsSync(cf) ? fs.readFileSync(cf, 'utf-8').split('\n') : []);
      const fresh = bad.filter((l) => !known.has(l));
      if (fresh.length) {
        fs.appendFileSync(cf, fresh.join('\n') + '\n', 'utf-8');
        console.warn(`[storage] ${fresh.length} línea(s) dañada(s) en ${path.basename(file)}; copiadas a .corrupt`);
      }
    } catch {
      /* ignorar */
    }
  }
  return out;
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

// ---------- Migración desde ./journal (ubicación antigua, versionada en git)
export function migrateLegacyData(): string[] {
  const copied: string[] = [];
  if (process.env.JOURNAL_DIR || LEGACY_JOURNAL_DIR === JOURNAL_DIR || !fs.existsSync(LEGACY_JOURNAL_DIR)) return copied;
  const walk = (rel: string) => {
    const dir = path.join(LEGACY_JOURNAL_DIR, rel);
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = path.join(rel, e.name);
      if (e.isDirectory()) walk(r);
      else if (/\.(jsonl|gz)$/.test(e.name)) {
        const dest = path.join(JOURNAL_DIR, r);
        if (!fs.existsSync(dest)) {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.copyFileSync(path.join(LEGACY_JOURNAL_DIR, r), dest);
          copied.push(r);
        }
      }
    }
  };
  walk('');
  if (copied.length) console.log(`[storage] datos antiguos copiados a ${JOURNAL_DIR}: ${copied.join(', ')}`);
  return copied;
}

// ---------- Copias de seguridad diarias (se conservan las últimas 14)
export function backupData(): void {
  try {
    if (!fs.existsSync(JOURNAL_DIR)) return;
    const day = new Date().toISOString().slice(0, 10);
    const dest = path.join(BACKUP_DIR, day);
    fs.mkdirSync(dest, { recursive: true });
    for (const f of fs.readdirSync(JOURNAL_DIR)) {
      if (f.endsWith('.jsonl')) fs.copyFileSync(path.join(JOURNAL_DIR, f), path.join(dest, f));
    }
    for (const f of [SESSIONS_FILE, SETTINGS_FILE]) {
      if (fs.existsSync(f)) fs.copyFileSync(f, path.join(dest, path.basename(f)));
    }
    const days = fs.readdirSync(BACKUP_DIR).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    for (const old of days.slice(0, Math.max(0, days.length - KEEP_BACKUPS))) {
      fs.rmSync(path.join(BACKUP_DIR, old), { recursive: true, force: true });
    }
  } catch (e) {
    console.warn('[storage] copia de seguridad omitida:', e);
  }
}

// ---------- Sesiones (cuándo estuvo encendida la app) y huecos
interface Session { startTs: number; lastSeenTs: number }
interface SessionsFile { sessions: Session[] }

export function startSession(now = Date.now()): { gapMs: number | null } {
  const f = readJson<SessionsFile>(SESSIONS_FILE, { sessions: [] });
  const prev = f.sessions[f.sessions.length - 1];
  const gapMs = prev ? Math.max(0, now - prev.lastSeenTs) : null;
  f.sessions.push({ startTs: now, lastSeenTs: now });
  atomicWrite(SESSIONS_FILE, JSON.stringify({ sessions: f.sessions.slice(-365) }));
  return { gapMs };
}

export function heartbeat(now = Date.now()): void {
  try {
    const f = readJson<SessionsFile>(SESSIONS_FILE, { sessions: [] });
    const last = f.sessions[f.sessions.length - 1];
    if (!last) return;
    last.lastSeenTs = now;
    atomicWrite(SESSIONS_FILE, JSON.stringify(f));
  } catch {
    /* ignorar */
  }
}

// ---------- Ajustes persistentes (sobreviven a reinicios)
export interface AppSettings {
  autoJournal?: boolean;
  micro?: { running: boolean; asset: AssetId };
  alerts?: AlertSettings;
  paper?: Partial<import('./paperTrading.ts').PaperConfig>;
}

export interface AlertSettings {
  enabled: boolean;
  telegramToken?: string;
  telegramChatId?: string;
  webhookUrl?: string;
  events: { setup: boolean; gex: boolean; cono: boolean; fuentes: boolean };
  /** Distancia (%) al nivel GEX que dispara el aviso. */
  gexProximityPct: number;
}

export const readSettings = (): AppSettings => readJson<AppSettings>(SETTINGS_FILE, {});

export function updateSettings(patch: Partial<AppSettings>): void {
  try {
    atomicWrite(SETTINGS_FILE, JSON.stringify({ ...readSettings(), ...patch }));
  } catch (e) {
    console.warn('[storage] ajustes no guardados:', e);
  }
}

// ---------- Estado de los datos para la interfaz
export function dataStatus(counts: { options: number; predictions: number; firstRecordTs: number | null }) {
  const f = readJson<SessionsFile>(SESSIONS_FILE, { sessions: [] });
  const now = Date.now();
  const sessions = f.sessions;
  const first = sessions.length ? sessions[0].startTs : null;
  const up = sessions.reduce((a, s) => a + Math.max(0, s.lastSeenTs - s.startTs), 0);
  const span = first ? Math.max(HOUR, now - first) : null;
  const cur = sessions[sessions.length - 1];
  const prev = sessions[sessions.length - 2];
  const backups = fs.existsSync(BACKUP_DIR)
    ? fs.readdirSync(BACKUP_DIR).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()
    : [];
  return {
    dataDir: DATA_DIR,
    journalDir: JOURNAL_DIR,
    options: counts.options,
    predictions: counts.predictions,
    firstRecordTs: counts.firstRecordTs,
    sessionsCount: sessions.length,
    currentSessionStartTs: cur?.startTs ?? null,
    lastGapHours: cur && prev ? Number(((cur.startTs - prev.lastSeenTs) / HOUR).toFixed(1)) : null,
    coveragePct: span && first ? Number(Math.min(100, (up / span) * 100).toFixed(0)) : null,
    backups: backups.length,
    lastBackup: backups[backups.length - 1] ?? null,
  };
}

import fs from 'fs';
import path from 'path';
import type { NextFunction, Request, Response } from 'express';

/**
 * Verificación de ID tokens de Firebase sin firebase-admin: usa el endpoint
 * público accounts:lookup de Identity Toolkit con la apiKey web del proyecto.
 *
 * - ALLOW_ANON_API=1      -> desactiva la exigencia de login (solo desarrollo local).
 * - ALLOWED_UIDS=a,b,c    -> lista opcional de UIDs autorizados a escribir.
 */
const TOKEN_TTL_MS = 5 * 60_000;
const tokenCache = new Map<string, { uid: string; expiresAt: number }>();

function loadApiKey(): string | null {
  try {
    const p = path.resolve(process.cwd(), 'firebase-applet-config.json');
    const cfg = JSON.parse(fs.readFileSync(p, 'utf-8')) as { apiKey?: string };
    return cfg.apiKey ?? null;
  } catch {
    return null;
  }
}

const API_KEY = loadApiKey();
const ALLOWED_UIDS = new Set(
  (process.env.ALLOWED_UIDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

async function verifyIdToken(idToken: string): Promise<string | null> {
  if (!API_KEY) return null;
  const hit = tokenCache.get(idToken);
  if (hit && hit.expiresAt > Date.now()) return hit.uid;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(API_KEY)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
        signal: controller.signal,
      },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { users?: Array<{ localId?: string; emailVerified?: boolean }> };
    const u = json.users?.[0];
    if (!u?.localId || u.emailVerified !== true) return null;
    if (ALLOWED_UIDS.size > 0 && !ALLOWED_UIDS.has(u.localId)) return null;
    tokenCache.set(idToken, { uid: u.localId, expiresAt: Date.now() + TOKEN_TTL_MS });
    if (tokenCache.size > 500) {
      const now = Date.now();
      for (const [k, v] of tokenCache) if (v.expiresAt <= now) tokenCache.delete(k);
    }
    return u.localId;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

declare module 'express-serve-static-core' {
  interface Request {
    uid?: string;
  }
}

const anonAllowed = () => process.env.ALLOW_ANON_API === '1';

/** Auth opcional: rellena req.uid si hay Bearer válido; sin sesión degrada ?refresh=1. */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) {
    const uid = await verifyIdToken(h.slice(7));
    if (uid) req.uid = uid;
  }
  // Un visitante anónimo no puede saltarse la caché y machacar OKX/Deribit.
  if (!req.uid && !anonAllowed() && req.query.refresh !== undefined) {
    delete req.query.refresh;
  }
  next();
}

/** Exige sesión Firebase válida (email verificado) para endpoints de escritura. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.uid || anonAllowed()) return next();
  res.status(401).json({ error: 'Se requiere iniciar sesión' });
}

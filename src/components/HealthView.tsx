import { useCallback, useEffect, useState } from 'react';
import type { AlertSettingsPublic, HealthLevel, HealthResponse } from '../types.ts';

const LEVEL: Record<HealthLevel, { label: string; cls: string }> = {
  ok: { label: 'Fiable', cls: 'text-emerald-600 dark:text-emerald-400' },
  warn: { label: 'Atención', cls: 'text-amber-600 dark:text-amber-400' },
  bad: { label: 'Problema', cls: 'text-rose-600 dark:text-rose-400' },
  wait: { label: 'Midiendo', cls: 'text-slate-500 dark:text-slate-400' },
};

const card = 'bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-5';
const input =
  'w-full px-2.5 py-1.5 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100';

export function HealthView() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [alerts, setAlerts] = useState<AlertSettingsPublic | null>(null);
  const [token, setToken] = useState('');
  const [chat, setChat] = useState('');
  const [hook, setHook] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [h, a] = await Promise.all([fetch('/api/model-health'), fetch('/api/alerts')]);
      if (h.ok) setHealth((await h.json()) as HealthResponse);
      if (a.ok) {
        const al = (await a.json()) as AlertSettingsPublic;
        setAlerts(al);
        setChat(al.telegramChatId ?? '');
        setHook(al.webhookUrl ?? '');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (patch: Record<string, unknown>) => {
    const res = await fetch('/api/alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (res.ok) setAlerts((await res.json()) as AlertSettingsPublic);
  };

  const test = async () => {
    setMsg('Enviando…');
    const res = await fetch('/api/alerts/test', { method: 'POST' });
    const r = (await res.json()) as { telegram: boolean | null; webhook: boolean | null };
    if (r.telegram === null && r.webhook === null) setMsg('Configura Telegram o un webhook primero.');
    else setMsg(`Telegram: ${r.telegram === null ? '—' : r.telegram ? 'enviado' : 'falló'} · Webhook: ${r.webhook === null ? '—' : r.webhook ? 'enviado' : 'falló'}`);
  };

  if (!health) return <div className="text-xs text-slate-500">{loading ? 'Calculando salud del modelo…' : 'Sin datos.'}</div>;
  const o = LEVEL[health.overall];

  return (
    <div className="space-y-6">
      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-display font-semibold text-slate-900 dark:text-slate-50">Salud del modelo</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Resumen de cuánto se puede confiar en cada módulo. «Midiendo» = faltan datos para opinar, no que funcione mal.
            </p>
          </div>
          <div className="text-right">
            <div className={`text-lg font-display font-semibold ${o.cls}`}>{o.label}</div>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="text-[11px] text-slate-500 underline cursor-pointer disabled:opacity-50"
            >
              {loading ? 'Actualizando…' : 'Actualizar'}
            </button>
          </div>
        </div>

        <div className="mt-4">
          <div className="flex justify-between text-xs text-slate-600 dark:text-slate-300">
            <span>Campaña de medición</span>
            <span className="font-mono tabular-nums">
              {health.campaign.days.toFixed(1)} / {health.campaign.targetDays} días
              {health.campaign.done ? ' · completa' : ''}
            </span>
          </div>
          <div className="mt-1 h-2 rounded bg-slate-200 dark:bg-slate-800 overflow-hidden">
            <div className="h-full bg-sky-500" style={{ width: `${health.campaign.pct}%` }} />
          </div>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Mantén la app encendida: tras ~4 semanas de datos continuos los veredictos de abajo ya son interpretables.
          </p>
        </div>
      </div>

      <div className={card}>
        <div className="divide-y divide-slate-100 dark:divide-slate-800/70 text-xs">
          {health.items.map((it) => (
            <div key={it.id} className="py-2 flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium text-slate-800 dark:text-slate-200">{it.module}</span>
              <span className="text-slate-500 dark:text-slate-400 flex-1 min-w-[12rem] text-right">{it.text}</span>
              <span className={`font-medium w-20 text-right ${LEVEL[it.level].cls}`}>{LEVEL[it.level].label}</span>
            </div>
          ))}
        </div>
      </div>

      {alerts && (
        <div className={`${card} space-y-4`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-50">Alertas</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Avisos a tu móvil por Telegram (crea un bot con @BotFather) o a un webhook. Los datos se guardan solo en tu equipo.
              </p>
            </div>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={alerts.enabled} onChange={(e) => void save({ enabled: e.target.checked })} />
              Activadas
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="text-xs space-y-1">
              <span className="text-slate-500">Token del bot {alerts.telegramConfigured && '(guardado)'}</span>
              <input className={input} type="password" placeholder={alerts.telegramConfigured ? '••••••••' : '123456:ABC…'} value={token} onChange={(e) => setToken(e.target.value)} />
            </label>
            <label className="text-xs space-y-1">
              <span className="text-slate-500">Chat ID</span>
              <input className={input} value={chat} onChange={(e) => setChat(e.target.value)} />
            </label>
            <label className="text-xs space-y-1">
              <span className="text-slate-500">Webhook (opcional)</span>
              <input className={input} placeholder="https://…" value={hook} onChange={(e) => setHook(e.target.value)} />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs">
            {(
              [
                ['setup', 'Setup validado'],
                ['gex', 'Zona GEX'],
                ['cono', 'Cono descalibrado'],
                ['fuentes', 'Fuentes caídas'],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={alerts.events[k]}
                  onChange={(e) => void save({ events: { ...alerts.events, [k]: e.target.checked } })}
                />
                {label}
              </label>
            ))}
            <label className="flex items-center gap-1.5">
              Distancia GEX
              <input
                className={`${input} w-16`}
                type="number"
                step="0.1"
                min="0.1"
                max="5"
                defaultValue={alerts.gexProximityPct}
                onBlur={(e) => void save({ gexProximityPct: Number(e.target.value) })}
              />
              %
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                void save({ telegramToken: token || undefined, telegramChatId: chat, webhookUrl: hook }).then(() => {
                  setToken('');
                  setMsg('Guardado.');
                });
              }}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-sky-600 text-white hover:bg-sky-500 cursor-pointer"
            >
              Guardar
            </button>
            <button
              type="button"
              onClick={() => void test()}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              Enviar aviso de prueba
            </button>
            {msg && <span className="text-xs text-slate-500 dark:text-slate-400">{msg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

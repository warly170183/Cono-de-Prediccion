import React, { useEffect, useState } from 'react';

interface DataStatus {
  dataDir: string;
  options: number;
  predictions: number;
  firstRecordTs: number | null;
  sessionsCount: number;
  lastGapHours: number | null;
  coveragePct: number | null;
  backups: number;
  lastBackup: string | null;
}

/** Resume qué datos se están conservando y cuánto tiempo estuvo apagada la app. */
export const DataStatusBar: React.FC = () => {
  const [s, setS] = useState<DataStatus | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch('/api/data-status')
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => alive && j && setS(j as DataStatus))
        .catch(() => undefined);
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (!s) return null;
  const since = s.firstRecordTs ? new Date(s.firstRecordTs).toLocaleDateString('es-ES') : '—';
  return (
    <div className="rounded-md border border-slate-200 dark:border-slate-800 px-3 py-2 text-[11px] text-slate-600 dark:text-slate-300 space-y-0.5">
      <div>
        <b>Datos conservados:</b> {s.options} opciones · {s.predictions} lecturas del diario · desde {since}
      </div>
      <div className="text-slate-500 dark:text-slate-400">
        {s.sessionsCount} arranques
        {s.lastGapHours !== null ? ` · apagada ${s.lastGapHours} h antes de este arranque` : ''}
        {s.coveragePct !== null ? ` · encendida el ${s.coveragePct} % del tiempo` : ''}
        {' · '}copias de seguridad: {s.backups}
        {s.lastBackup ? ` (última ${s.lastBackup})` : ''}
      </div>
      <div className="text-slate-500 dark:text-slate-400 break-all">Carpeta: {s.dataDir}</div>
    </div>
  );
};

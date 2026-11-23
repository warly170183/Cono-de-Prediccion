import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Moon, RefreshCw, Sun } from 'lucide-react';
import type {
  AssetId,
  AutoJournalStatus,
  JournalAssetData,
  NavTab,
  OverviewResponse,
  RadarAssetItem,
  RegisteredTradeOption,
  ResultsResponse,
  RotationResponse,
  TradeAnalysisResponse,
  TradeOptionProposal,
  TradeOptionsResponse,
} from './types.ts';
type PredictionRecord = JournalAssetData['predictions'][number];
import { ConeView } from './components/ConeView.tsx';
import { GexDerivativesView } from './components/GexDerivativesView.tsx';
import { TradeGridView } from './components/TradeGridView.tsx';
import { TradeOptionsView } from './components/TradeOptionsView.tsx';
import { RotationView } from './components/RotationView.tsx';
import { JournalView } from './components/JournalView.tsx';
import { MicroView } from './components/MicroView.tsx';
import { HealthView } from './components/HealthView.tsx';
import { PaperView } from './components/PaperView.tsx';
import { ArchitectureView } from './components/ArchitectureView.tsx';
import { RadarPanel } from './components/RadarPanel.tsx';

const NAV_ITEMS: Array<{ id: NavTab; label: string }> = [
  { id: 'cone', label: 'Cono & Vol' },
  { id: 'gex', label: 'Derivados & GEX' },
  { id: 'trades', label: 'Rejilla EV' },
  { id: 'trade_options', label: 'Opciones de Trading' },
  { id: 'rotation', label: 'Rotación 40' },
  { id: 'journal', label: 'Diario' },
  { id: 'micro', label: 'Microestructura' },
  { id: 'health', label: 'Salud & Alertas' },
  { id: 'paper', label: 'Paper' },
  { id: 'architecture', label: 'Arquitectura' },
];

const ASSETS: Array<{ id: AssetId; label: string }> = [
  { id: 'btc', label: 'BTC' },
  { id: 'eth', label: 'ETH' },
  { id: 'sol', label: 'SOL' },
];

export default function App() {
  const [tab, setTab] = useState<NavTab>('cone');
  const [asset, setAsset] = useState<AssetId>('btc');
  const [dark, setDark] = useState(true);

  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [trades, setTrades] = useState<TradeAnalysisResponse | null>(null);
  const [tradeOptions, setTradeOptions] = useState<TradeOptionsResponse | null>(null);
  const [rotation, setRotation] = useState<RotationResponse | null>(null);
  const [journal, setJournal] = useState<JournalAssetData[]>([]);
  const [autoJournal, setAutoJournal] = useState<AutoJournalStatus | null>(null);
  const [results, setResults] = useState<ResultsResponse | null>(null);
  const [showRadar, setShowRadar] = useState(false);
  const [radarItems, setRadarItems] = useState<RadarAssetItem[]>([]);
  const [loadingRadar, setLoadingRadar] = useState(false);

  const [loadingOverview, setLoadingOverview] = useState(true);
  const [loadingTrades, setLoadingTrades] = useState(false);
  const [loadingTradeOptions, setLoadingTradeOptions] = useState(false);
  const [registeringOptionKey, setRegisteringOptionKey] = useState<string | null>(null);
  const [loadingRotation, setLoadingRotation] = useState(false);
  const [loadingJournal, setLoadingJournal] = useState(false);
  const [runningSnapshot, setRunningSnapshot] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mergedJournal = journal;

  useEffect(() => {
    const root = document.documentElement;
    if (dark) root.classList.add('dark');
    else root.classList.remove('dark');
  }, [dark]);

  const fetchOverview = useCallback(
    async (targetAsset: AssetId, forceRefresh = false) => {
      setLoadingOverview(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/overview?asset=${targetAsset}${forceRefresh ? '&refresh=1' : ''}`,
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Error ${res.status} al calcular el cono`);
        }
        const json = (await res.json()) as OverviewResponse;
        setOverview(json);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No se pudo conectar con OKX/Deribit');
      } finally {
        setLoadingOverview(false);
      }
    },
    [],
  );

  const fetchTrades = useCallback(async (targetAsset: AssetId, forceRefresh = false) => {
    setLoadingTrades(true);
    try {
      const res = await fetch(
        `/api/trades?asset=${targetAsset}${forceRefresh ? '&refresh=1' : ''}`,
      );
      if (res.ok) {
        setTrades((await res.json()) as TradeAnalysisResponse);
      }
    } finally {
      setLoadingTrades(false);
    }
  }, []);

  const fetchTradeOptions = useCallback(
    async (targetAsset: AssetId, forceRefresh = false, opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoadingTradeOptions(true);
      try {
        const res = await fetch(
          `/api/trade-options?asset=${targetAsset}${forceRefresh ? '&refresh=1' : ''}`,
        );
        if (res.ok) {
          setTradeOptions((await res.json()) as TradeOptionsResponse);
        }
      } finally {
        if (!opts?.silent) setLoadingTradeOptions(false);
      }
    },
    [],
  );

  const fetchJournalAndResults = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoadingJournal(true);
    try {
      const [jRes, rRes] = await Promise.all([
        fetch('/api/journal?asset=all'),
        fetch('/api/results'),
      ]);
      if (jRes.ok) {
        const jJson = (await jRes.json()) as {
          assets: JournalAssetData[];
          auto?: AutoJournalStatus;
        };
        setJournal(jJson.assets);
        if (jJson.auto) setAutoJournal(jJson.auto);
      }
      if (rRes.ok) {
        setResults((await rRes.json()) as ResultsResponse);
      }
    } finally {
      if (!opts?.silent) setLoadingJournal(false);
    }
  }, []);

  const fetchRotation = useCallback(async (forceRefresh = false) => {
    setLoadingRotation(true);
    try {
      const res = await fetch(`/api/rotation${forceRefresh ? '?refresh=1' : ''}`);
      if (res.ok) {
        setRotation((await res.json()) as RotationResponse);
      }
    } finally {
      setLoadingRotation(false);
    }
  }, []);

  const fetchRadar = useCallback(async (forceRefresh = false) => {
    setLoadingRadar(true);
    try {
      const res = await fetch(`/api/radar${forceRefresh ? '?refresh=1' : ''}`);
      if (res.ok) {
        const json = (await res.json()) as { items: RadarAssetItem[] };
        setRadarItems(json.items);
      }
    } finally {
      setLoadingRadar(false);
    }
  }, []);

  useEffect(() => {
    void fetchOverview(asset, false);
    setTrades(null);
    setTradeOptions(null);
  }, [asset, fetchOverview]);

  useEffect(() => {
    if (tab === 'trades' && (!trades || trades.asset !== asset)) {
      void fetchTrades(asset, false);
    }
    if (tab === 'trade_options' && (!tradeOptions || tradeOptions.asset !== asset)) {
      void fetchTradeOptions(asset, false);
    }
    if (tab === 'rotation' && !rotation) {
      void fetchRotation(false);
    }
    if (tab === 'journal' && journal.length === 0) {
      void fetchJournalAndResults();
    }
  }, [
    tab,
    asset,
    trades,
    tradeOptions,
    rotation,
    journal.length,
    fetchTrades,
    fetchTradeOptions,
    fetchRotation,
    fetchJournalAndResults,
  ]);

  // Background sync of daily predictions from server scheduler
  useEffect(() => {
    const t1 = setTimeout(() => void fetchJournalAndResults({ silent: true }), 2500);
    const t2 = setTimeout(() => void fetchJournalAndResults({ silent: true }), 9000);
    const interval = setInterval(() => {
      void fetchJournalAndResults({ silent: true });
    }, 15 * 60_000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearInterval(interval);
    };
  }, [fetchJournalAndResults]);

  const handleRegisterTradeOption = useCallback(
    async (proposal: TradeOptionProposal) => {
      setRegisteringOptionKey(proposal.strategyKey);
      try {
        const res = await fetch('/api/trade-options/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            asset: proposal.asset,
            strategyKey: proposal.strategyKey,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || 'Error registrando opción de trading');
        }
        const json = (await res.json()) as {
          saved?: RegisteredTradeOption;
          options?: TradeOptionsResponse;
        };
        if (json.options) setTradeOptions(json.options);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No se pudo registrar la operación');
      } finally {
        setRegisteringOptionKey(null);
      }
    },
    [],
  );

  const handleCloseTradeOptionManual = useCallback(
    async (optionId: string) => {
      try {
        const res = await fetch(`/api/trade-options/${encodeURIComponent(optionId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ asset }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || 'No se pudo cerrar la operación');
        }
        const json = (await res.json()) as { updated?: RegisteredTradeOption | null };
        const updated = json.updated;
        if (updated) {
          setTradeOptions((prev) =>
            prev
              ? {
                  ...prev,
                  registered: prev.registered.map((r) => (r.id === updated.id ? updated : r)),
                }
              : prev,
          );
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error cerrando operación');
      }
    },
    [asset],
  );

  const handleDeleteTradeOption = useCallback(
    async (optionId: string) => {
      try {
        const res = await fetch(`/api/trade-options/${encodeURIComponent(optionId)}`, {
          method: 'DELETE',
        });
        if (!res.ok && res.status !== 404) {
          throw new Error('No se pudo eliminar el registro');
        }
        setTradeOptions((prev) =>
          prev
            ? {
                ...prev,
                registered: prev.registered.filter((r) => r.id !== optionId),
              }
            : prev,
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error eliminando registro');
      }
    },
    [],
  );

  const handleToggleAutoJournal = useCallback(
    async (enabled: boolean) => {
      try {
        const res = await fetch('/api/journal/auto', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled }),
        });
        if (res.ok) {
          const status = (await res.json()) as AutoJournalStatus;
          setAutoJournal(status);
          if (enabled) {
            setTimeout(() => void fetchJournalAndResults({ silent: true }), 3500);
          }
        }
      } catch (err) {
        console.warn('Error toggling auto journal:', err);
      }
    },
    [fetchJournalAndResults],
  );

  const handleSaveSnapshot = async (assetsToRun: AssetId[]) => {
    setRunningSnapshot(true);
    setError(null);
    try {
      const res = await fetch('/api/journal/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assets: assetsToRun }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Error guardando lectura en el diario');
      }
      const resJson = (await res.json()) as {
        saved?: Array<PredictionRecord & { asset?: AssetId }>;
        auto?: AutoJournalStatus;
      };
      if (resJson.auto) setAutoJournal(resJson.auto);
      await Promise.all([fetchJournalAndResults(), fetchOverview(asset, true)]);
      setTab('journal');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error guardando snapshot');
    } finally {
      setRunningSnapshot(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 dark:bg-[#0B1120] dark:text-slate-100">
      {/* 3-Zone Top Bar */}
      <header className="border-b border-slate-200 dark:border-slate-800/90 bg-white/95 dark:bg-[#0B1120]/95 sticky top-0 z-30 backdrop-blur-sm">
        <div className="max-w-[1360px] mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4 lg:gap-6">
          <button
            type="button"
            onClick={() => setTab('cone')}
            className="text-lg font-display font-bold tracking-tight text-slate-900 dark:text-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
          >
            Trading Predictor
          </button>

          <nav className="hidden lg:flex items-center gap-3.5 xl:gap-5 text-xs xl:text-[13px] font-medium">
            {NAV_ITEMS.map((item) => {
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`py-4 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'border-sky-500 text-slate-900 dark:text-slate-50'
                      : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void handleSaveSnapshot([asset])}
              disabled={runningSnapshot}
              className="px-4 py-1.5 text-xs font-medium rounded-md bg-sky-600 text-white hover:bg-sky-500 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {runningSnapshot ? 'Guardando…' : 'Guardar lectura'}
            </button>

          </div>
        </div>

        {/* Mobile / Tablet Navigation Strip */}
        <div className="lg:hidden border-t border-slate-200 dark:border-slate-800 px-4 py-2 flex items-center gap-4 overflow-x-auto text-xs font-medium">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`whitespace-nowrap shrink-0 py-1 ${
                tab === item.id
                  ? 'text-sky-600 dark:text-sky-400 font-semibold'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-[1360px] w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Workspace Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800/80">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-1 p-1 bg-slate-200/70 dark:bg-slate-800/80 rounded-lg">
              {ASSETS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setAsset(a.id)}
                  className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    asset === a.id
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-50 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {a.label}
                </button>
              ))}
            </div>

            <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              {asset.toUpperCase()}-USDT-SWAP · OKX &amp; Deribit · Sin sesgo direccional
              {overview && (
                <>
                  {' · '}
                  <span>Actualizado {new Date(overview.generated).toLocaleTimeString('es-ES')}</span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const next = !showRadar;
                setShowRadar(next);
                if (next && radarItems.length === 0) {
                  void fetchRadar(false);
                }
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                showRadar
                  ? 'border-sky-500/60 bg-sky-500/10 text-sky-700 dark:text-sky-300'
                  : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {loadingRadar ? 'Cargando radar…' : 'Radar 3 Activos'}
            </button>

            <button
              type="button"
              onClick={() => {
                void fetchOverview(asset, true);
                if (tab === 'trades') void fetchTrades(asset, true);
                if (tab === 'trade_options') void fetchTradeOptions(asset, true);
                if (showRadar) void fetchRadar(true);
              }}
              disabled={loadingOverview}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingOverview ? 'animate-spin' : ''}`} />
              <span>Actualizar</span>
            </button>

            <button
              type="button"
              onClick={() => setDark((d) => !d)}
              aria-label="Cambiar tema claro u oscuro"
              className="inline-flex items-center justify-center w-8 h-8 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Multi-Asset Radar */}
        {showRadar && (
          loadingRadar && radarItems.length === 0 ? (
            <div className="h-32 rounded-lg bg-slate-200/70 dark:bg-slate-800/50 animate-pulse" />
          ) : (
            <RadarPanel
              items={radarItems}
              activeAsset={asset}
              onSelectAsset={(a) => setAsset(a)}
            />
          )
        )}

        {/* Global Error Banner */}
        {error && (
          <div className="p-4 rounded-lg border border-rose-500/30 bg-rose-500/10 flex items-center justify-between gap-4 text-xs text-rose-600 dark:text-rose-400">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => void fetchOverview(asset, true)}
              className="px-3 py-1 rounded border border-rose-500/40 hover:bg-rose-500/10 font-medium cursor-pointer"
            >
              Reintentar
            </button>
          </div>
        )}

        {/* Active View */}
        {tab === 'cone' && (
          loadingOverview && !overview ? (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-24 rounded-lg bg-slate-200/70 dark:bg-slate-800/50 animate-pulse" />
                ))}
              </div>
              <div className="h-[440px] rounded-lg bg-slate-200/70 dark:bg-slate-800/50 animate-pulse" />
            </div>
          ) : overview ? (
            <ConeView data={overview} />
          ) : null
        )}

        {tab === 'gex' && overview && (
          <GexDerivativesView
            asset={asset}
            readings={overview.readings}
            gex={overview.gex}
            onSelectAsset={(a) => setAsset(a)}
          />
        )}

        {tab === 'trades' && (
          loadingTrades && !trades ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-24 rounded-lg bg-slate-200/70 dark:bg-slate-800/50 animate-pulse" />
                ))}
              </div>
              <div className="h-96 rounded-lg bg-slate-200/70 dark:bg-slate-800/50 animate-pulse" />
            </div>
          ) : trades ? (
            <TradeGridView data={trades} />
          ) : null
        )}

        {tab === 'trade_options' && (
          <TradeOptionsView
            asset={asset}
            data={tradeOptions}
            loading={loadingTradeOptions}
            registeringKey={registeringOptionKey}
            onRefresh={() => void fetchTradeOptions(asset, true)}
            onRegisterProposal={(p) => void handleRegisterTradeOption(p)}
            onCloseManual={(id) => void handleCloseTradeOptionManual(id)}
            onDeleteOption={(id) => void handleDeleteTradeOption(id)}
          />
        )}

        {tab === 'rotation' && (
          <RotationView
            data={rotation}
            loading={loadingRotation}
            onRefresh={() => void fetchRotation(true)}
          />
        )}

        {tab === 'journal' && (
          loadingJournal && journal.length === 0 ? (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-72 rounded-lg bg-slate-200/70 dark:bg-slate-800/50 animate-pulse" />
              ))}
            </div>
          ) : (
            <JournalView
              journalAssets={mergedJournal}
              results={results}
              runningSnapshot={runningSnapshot}
              autoStatus={autoJournal}
              onToggleAuto={(enabled) => void handleToggleAutoJournal(enabled)}
              onRunAll={() => void handleSaveSnapshot(['btc', 'eth', 'sol'])}
            />
          )
        )}

        {tab === 'micro' && <MicroView asset={asset} />}

        {tab === 'health' && <HealthView />}

        {tab === 'paper' && <PaperView />}

        {tab === 'architecture' && (
          <ArchitectureView
            asset={asset}
            onNavigateTab={(nextTab) => setTab(nextTab)}
          />
        )}
      </main>

      <footer className="border-t border-slate-200 dark:border-slate-800/80 py-4 px-6 text-xs text-slate-500 dark:text-slate-400">
        <div className="max-w-[1360px] mx-auto flex flex-wrap items-center justify-between gap-2">
          <span>Trading Predictor · Datos públicos de OKX y Deribit</span>
          <span>Herramienta de análisis cuantitativo. No constituye recomendación de inversión.</span>
        </div>
      </footer>
    </div>
  );
}

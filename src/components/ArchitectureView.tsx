import React, { useMemo, useState } from 'react';
import { ArrowRight, Layers, RefreshCw } from 'lucide-react';
import type { AssetId, NavTab } from '../types.ts';
import { DataStatusBar } from './DataStatusBar.tsx';

interface Props {
  asset: AssetId;
  onNavigateTab: (tab: NavTab) => void;
}

type FlowScenarioId = 'all' | 'cone_gex' | 'trade_options' | 'journal_cloud' | 'micro_l2';

type ArchLayer = 'Ingesta Externa' | 'Servicios & Motor' | 'Persistencia & Cron' | 'Interfaz SPA';

interface ArchNode {
  id: string;
  layer: ArchLayer;
  col: 0 | 1 | 2 | 3;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  subtitle: string;
  accent: 'sky' | 'emerald' | 'amber' | 'violet';
  summary: string;
  inputs: string[];
  outputs: string[];
  endpoints: string[];
  details: string[];
  targetTab?: NavTab;
  targetLabel?: string;
}

interface ArchEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  scenarios: FlowScenarioId[];
}

const FLOW_SCENARIOS: Array<{ id: FlowScenarioId; label: string; description: string }> = [
  {
    id: 'all',
    label: 'Flujo Completo',
    description:
      'Vista integral de extremo a extremo: APIs públicas de mercado, motores cuantitativos en Express, persistencia local y vistas interactivas en React 19.',
  },
  {
    id: 'cone_gex',
    label: 'Cono GARCH & GEX',
    description:
      'Ingesta de velas 1H/1D en OKX y cadena completa de opciones Deribit para estimar GJR-GARCH Student-t (3,000 rutas), densidad SVI y perfil de Gamma Exposure.',
  },
  {
    id: 'trade_options',
    label: 'Opciones de Trading',
    description:
      'Cada estrategia propone solo si cumple sus condiciones (con filtro de tendencia diaria y SL/TP por estructura). Su historial se mide con un backtest de las mismas reglas y con las operaciones reales; cada opción se registra y se evalúa contra el precio posterior.',
  },
  {
    id: 'journal_cloud',
    label: 'Diario & Datos Locales',
    description:
      'El programador interno ejecuta capturas diarias cada 30 min para BTC/ETH/SOL, evalúa cobertura real a 24 h / 72 h contra OKX y guarda todo en ficheros locales.',
  },
  {
    id: 'micro_l2',
    label: 'Microestructura L2',
    description:
      'Muestreo cada 60 s del libro de órdenes L2 (top 20), trades y liquidaciones en OKX para calcular desequilibrio, spread, microprecio y correlación Spearman IC con ajuste Bonferroni.',
  },
];

const NODES: ArchNode[] = [
  // Col 0: External Data Sources
  {
    id: 'okx_api',
    layer: 'Ingesta Externa',
    col: 0,
    x: 24,
    y: 78,
    w: 224,
    h: 132,
    title: 'OKX Public REST API',
    subtitle: 'Spot, Swaps, OI, L/S y Orderbook L2',
    accent: 'sky',
    summary:
      'Fuente principal de series OHLCV (1H y 1D), contratos perpetuos USDT-SWAP, interés abierto, ratio Long/Short, tasas de funding y libro de órdenes de alta frecuencia.',
    inputs: ['Instrumentos BTC / ETH / SOL-USDT-SWAP', 'Universo 40 swaps líquidos (rotación)'],
    outputs: ['Velas OHLCV hasta 1,600 barras 1H', 'Métricas Rubik OI/LS y ticks L2 cada 60 s'],
    endpoints: ['okx.com/api/v5/market/*', 'okx.com/api/v5/rubik/stat/*'],
    details: [
      'Paginación automática para reconstruir historiales de ~1,100–1,600 velas 1H.',
      'Provee las velas futuras reales con las que el sistema audita el Diario y las Opciones de Trading.',
      'Alimenta tanto la vista principal como el colector continuo de microestructura.',
    ],
  },
  {
    id: 'deribit_api',
    layer: 'Ingesta Externa',
    col: 0,
    x: 24,
    y: 266,
    w: 224,
    h: 132,
    title: 'Deribit Public API',
    subtitle: 'Cadena de Opciones, IV, DVOL y Funding',
    accent: 'violet',
    summary:
      'Provee la cadena completa de opciones europeas activas para BTC y ETH, el índice de volatilidad implícita DVOL y el historial de funding perpetuo.',
    inputs: ['Monedas con mercado de opciones: BTC y ETH'],
    outputs: ['Cadena de strikes (Calls/Puts, OI, Delta, Gamma, IV)', 'Series DVOL horarias'],
    endpoints: ['deribit.com/api/v2/public/get_book_summary_by_currency', 'get_volatility_index_data'],
    details: [
      'Para SOL, que carece de cadena de opciones listada en Deribit, el sistema omite GEX y usa exclusivamente señales OKX + análisis técnico sin inventar datos.',
      'Permite separar la gamma de Calls (positiva) y Puts (negativa) en tiempo real.',
    ],
  },

  // Col 1: Backend Services & Quant Engines
  {
    id: 'market_cache',
    layer: 'Servicios & Motor',
    col: 1,
    x: 298,
    y: 44,
    w: 236,
    h: 84,
    title: 'Conector & Caché TTL',
    subtitle: 'Control de concurrencia y reintentos',
    accent: 'sky',
    summary:
      'Orquesta las descargas paralelas hacia OKX y Deribit, evita solicitudes duplicadas en vuelo y mantiene cachés TTL en memoria con invalidación explícita (?refresh=1).',
    inputs: ['Respuestas crudas OKX & Deribit'],
    outputs: ['Series limpias, ordenadas cronológicamente y tipadas'],
    endpoints: ['/api/overview', '/api/radar', '/api/health'],
    details: [
      'Deduplicación de peticiones en vuelo para evitar saturar los límites públicos de los exchanges.',
      'Conversión uniforme de marcas temporales a milisegundos UTC.',
    ],
  },
  {
    id: 'quant_engine',
    layer: 'Servicios & Motor',
    col: 1,
    x: 298,
    y: 142,
    w: 236,
    h: 104,
    title: 'Motor Cuantitativo GARCH & GEX',
    subtitle: 'GJR-GARCH, SVI, GMM, EV/Kelly',
    accent: 'emerald',
    summary:
      'Núcleo matemático en TypeScript puro: ajusta GJR-GARCH(1,1) Student-t, simula conos de densidad Monte Carlo, ajusta superficie SVI libre de arbitraje y calcula perfil Gamma Flip.',
    inputs: ['Retornos logarítmicos 1H/1D', 'Cadena de opciones Deribit', 'Derivados OKX'],
    outputs: ['Conos 50/80/90%', 'GEX por strike y vencimiento', 'Rejilla SL×TP y Regresión Logística'],
    endpoints: ['/api/overview', '/api/gex', '/api/trades', '/api/walkforward', '/api/bias'],
    details: [
      'Ajuste GJR-GARCH Student-t asimétrico + ensamble HAR-RV para reducir error en horizontes de 24 h y 72 h.',
      'Walk-forward estricto con pruebas Kupiec, Christoffersen, Diebold-Mariano y histograma PIT de 10 bins.',
      'Calcula GEX Positivo (Calls), GEX Negativo (Puts), diferencia neta y nivel exacto de Gamma Flip.',
    ],
    targetTab: 'cone',
    targetLabel: 'Ir a Cono & Vol',
  },
  {
    id: 'trade_options_svc',
    layer: 'Servicios & Motor',
    col: 1,
    x: 298,
    y: 260,
    w: 236,
    h: 92,
    title: 'Motor Opciones de Trading',
    subtitle: 'Técnicos + GEX + confluencia + calidad',
    accent: 'amber',
    summary:
      'Calcula 12+ indicadores técnicos, aplica el detector de setups y puntúa cada propuesta: calidad = setup + confluencia de 9 factores (incluida la tendencia diaria) + historial medido de la estrategia.',
    inputs: ['EMA 20/50/200, RSI, MACD, ADX, ATR, BB, VWAP, OBV, Pivotes', 'GEX, funding, L/S, OI', 'Setups y veredicto del backtest'],
    outputs: ['Solo propuestas con condiciones cumplidas', 'Calidad 0-100, ★ recomendada y riesgo ¼ Kelly'],
    endpoints: ['/api/trade-options', '/api/trade-options/register', '/api/trade-options/:id'],
    details: [
      '4,000 trayectorias GARCH siguen estimando P(TP), P(SL) y EV, pero con deriva neutra: es solo geometría SL/TP + costes, no ventaja direccional.',
      'El riesgo sugerido sale de la esperanza MEDIDA (backtest + reales), y es mínimo mientras la estrategia no tenga ventaja validada.',
    ],
    targetTab: 'trade_options',
    targetLabel: 'Ir a Opciones de Trading',
  },
  {
    id: 'signals_backtest',
    layer: 'Servicios & Motor',
    col: 1,
    x: 298,
    y: 366,
    w: 236,
    h: 92,
    title: 'Detector de Setups & Backtest',
    subtitle: 'Condiciones de entrada + veredicto por estrategia',
    accent: 'emerald',
    summary:
      'Módulo puro, usado igual en vivo y en el histórico. Cada estrategia entra solo si cumple sus condiciones y, si no, explica por qué no opera. Repite las mismas reglas sobre ~160 días y mide la esperanza en R.',
    inputs: ['Velas 1H (hasta 4,000) y 1D (320)', 'Funding, L/S, OI y muros GEX (solo en vivo)'],
    outputs: ['Setups con SL tras swing y TP limitado por niveles', 'Veredicto: validada / prometedora / dudosa / descartada / sin datos'],
    endpoints: ['/api/trade-options (campos skipped y strategyTracks)'],
    details: [
      'Filtro de tendencia diaria: no se opera contra ella sin un extremo claro. Distancias medidas en rango diario.',
      'Backtest sin ajustar parámetros, operaciones sin solape, SL primero si coinciden en la misma vela, coste de 0,07 % incluido. Se recalcula cada 3 h por activo.',
      'La estrategia de derivados no es reproducible en histórico (no hay funding/OI a 1 h) y se mide solo con operaciones en vivo.',
    ],
    targetTab: 'trade_options',
    targetLabel: 'Ir a Opciones de Trading',
  },
  {
    id: 'batch_services',
    layer: 'Servicios & Motor',
    col: 1,
    x: 298,
    y: 472,
    w: 236,
    h: 64,
    title: 'Rotación 40 & Microestructura',
    subtitle: 'Momentum cross-seccional y Spearman IC',
    accent: 'violet',
    summary:
      'Evalúa 45 variantes de rotación sobre 40 swaps OKX (Sharpe, Newey-West t, DSR) y calcula el Information Coefficient (Spearman IC) sobre datos intradía L2.',
    inputs: ['40 swaps líquidos (150 d)', 'Buffer L2 en vivo + CSV histórico'],
    outputs: ['Ranking top-5 actual', 'Tabla IC con corrección Bonferroni'],
    endpoints: ['/api/rotation', '/api/micro/live', '/api/micro/study'],
    details: [
      'Mide el sesgo de selección múltiple mediante Deflated Sharpe Ratio (DSR).',
      'Calcula desequilibrio de libro (top 5 y top 20), spread bps, microprecio y liquidaciones.',
    ],
    targetTab: 'rotation',
    targetLabel: 'Ir a Rotación 40',
  },

  // Col 2: Persistence & Schedulers
  {
    id: 'schedulers_jsonl',
    layer: 'Persistencia & Cron',
    col: 2,
    x: 584,
    y: 60,
    w: 224,
    h: 132,
    title: 'Programadores & Diario Local',
    subtitle: 'Registro automático cada 4 h + Diario diario',
    accent: 'amber',
    summary:
      'Ejecuta tareas automáticas cada 30 min: guarda las lecturas diarias del Diario (00:00 UTC) y registra TODAS las opciones emitidas (una por activo, estrategia y tanda de 4 h) para evaluarlas después contra velas reales.',
    inputs: ['Motor cuantitativo', 'Colector L2 cada 60 s', 'Velas 1H de cierre real'],
    outputs: ['data/journal/predictions_*.jsonl', 'data/journal/trade_options.jsonl', 'Export CSV/JSONL'],
    endpoints: ['/api/journal', '/api/journal/auto', '/api/micro/collector'],
    details: [
      'Orden conservador en auditoría: si SL y TP ocurren en la misma vela 1H, se contabiliza SL primero.',
      'Funciona mientras la app esté abierta, aunque no haya ninguna pestaña del navegador. Al reabrirla retoma el registro y evalúa lo pendiente con el histórico necesario.',
    ],
    targetTab: 'journal',
    targetLabel: 'Ir a Diario',
  },

  {
    id: 'eval_engine',
    layer: 'Persistencia & Cron',
    col: 2,
    x: 584,
    y: 212,
    w: 224,
    h: 132,
    title: 'Evaluación Forward & Estadística',
    subtitle: '¿Acierta la app? Con línea base y significancia',
    accent: 'emerald',
    summary:
      'Compara cada opción guardada con las velas 1H posteriores: TP1/TP2/SL, dirección acertada al final del horizonte y operación espejo como control de azar. Emite un veredicto solo con muestra suficiente.',
    inputs: ['trade_options.jsonl', 'Velas 1H cerradas posteriores a cada opción'],
    outputs: ['Veredicto con línea base y p-valor', 'Calibración, Brier, curvas y tablas por estrategia / veredicto / contexto'],
    endpoints: ['/api/trade-options', '/api/trade-options/export?format=csv|jsonl'],
    details: [
      'Muestras independientes (sin solape), intervalo de Wilson, test binomial y test ajustado por la línea base (mezcla largos/cortos y mercado alcista).',
      'Veredicto principal con al menos 30 muestras independientes; antes muestra el progreso y una estimación de cuándo se alcanzará.',
      'Mide también si las estrategias «validadas» rinden mejor que el resto, que es la prueba de que el backtest sirve.',
    ],
    targetTab: 'trade_options',
    targetLabel: 'Ir a Opciones de Trading',
  },
  {
    id: 'data_store',
    layer: 'Persistencia & Cron',
    col: 2,
    x: 584,
    y: 364,
    w: 224,
    h: 132,
    title: 'Almacén Local (data/)',
    subtitle: 'Persistencia entre ejecuciones',
    accent: 'sky',
    summary:
      'Todo se guarda en la carpeta data/ junto a la app (o al .exe) y se conserva al apagar el equipo o actualizar la versión. Cada arranque retoma lo anterior y añade datos nuevos.',
    inputs: ['Opciones, lecturas del diario, microestructura, ajustes'],
    outputs: ['JSONL con escritura atómica', 'Backups diarios (últimos 14) y registro de sesiones'],
    endpoints: ['/api/data-status'],
    details: [
      'Escritura atómica (fichero temporal + renombrado) y lector tolerante: una línea dañada se aparta sin perder el resto.',
      'Registra cuándo estuvo encendida la app para mostrar huecos y cobertura; los ajustes (diario automático, colector) se recuerdan.',
      'Migra los datos de la antigua carpeta journal/ y se puede mover con DATA_DIR / JOURNAL_DIR.',
    ],
  },

  // Col 3: Frontend SPA Views
  {
    id: 'ui_quant',
    layer: 'Interfaz SPA',
    col: 3,
    x: 860,
    y: 54,
    w: 236,
    h: 112,
    title: 'Cono & Vol · Derivados & GEX',
    subtitle: 'Gráficos SVG interactivos + Radar 3 activos',
    accent: 'sky',
    summary:
      'Presenta el cono probabilístico 1H/1D interactivo, bandas de ensamble HAR y SVI, historial PIT walk-forward, perfil Gamma Flip y mapa strike por strike de Deribit.',
    inputs: ['/api/overview', '/api/walkforward', '/api/gex', '/api/radar'],
    outputs: ['Inspección por horizonte y cuantil', 'Cambio rápido BTC / ETH / SOL'],
    endpoints: ['Vista: Cono & Vol', 'Vista: Derivados & GEX'],
    details: [
      'Selector dual de tema claro/oscuro sincronizado mediante Tailwind v4.',
      'Panel lateral/superior Radar para comparar BTC, ETH y SOL de un vistazo.',
    ],
    targetTab: 'gex',
    targetLabel: 'Ir a Derivados & GEX',
  },
  {
    id: 'ui_trading',
    layer: 'Interfaz SPA',
    col: 3,
    x: 860,
    y: 194,
    w: 236,
    h: 112,
    title: 'Rejilla EV · Opciones de Trading',
    subtitle: 'Simulador What-If + Sesgo GEX + Registro',
    accent: 'emerald',
    summary:
      'Integra la matriz de esperanza matemática (EV/Kelly), simulador interactivo SL/TP, visualización de Sesgo del Mercado (GEX Positivo vs Negativo) y registro auditable de operaciones.',
    inputs: ['/api/trades', '/api/trades/simulate', '/api/trade-options'],
    outputs: ['Propuestas ★ con riesgo sugerido', 'Panel de evaluación forward y registro de operaciones'],
    endpoints: ['Vista: Rejilla EV', 'Vista: Opciones de Trading'],
    details: [
      'Calidad y veredicto en cada propuesta, desglose de los 9 factores de confluencia, historial medido por estrategia y motivos de «no operar».',
      'Cada opción generada se guarda en local y se evalúa contra el precio posterior (TP1/TP2/SL y dirección al horizonte).',
    ],
    targetTab: 'trade_options',
    targetLabel: 'Ir a Opciones de Trading',
  },
  {
    id: 'ui_audit',
    layer: 'Interfaz SPA',
    col: 3,
    x: 860,
    y: 334,
    w: 236,
    h: 112,
    title: 'Rotación 40 · Diario · Micro L2',
    subtitle: 'Validación fuera de muestra y orden en vivo',
    accent: 'violet',
    summary:
      'Muestra el ranking de momentum de 40 swaps, la auditoría histórica de cobertura del Diario automático, benchmarks empíricos y el monitor de orden L2 en vivo.',
    inputs: ['/api/rotation', '/api/journal', '/api/results', '/api/micro/*'],
    outputs: ['Exportación de reportes y series', 'Control de colector y auto-diario'],
    endpoints: ['Vista: Rotación 40', 'Vista: Diario', 'Vista: Microestructura'],
    details: [
      'Permite activar/pausar el guardado automático diario y el colector de microestructura de 1 min.',
    ],
    targetTab: 'micro',
    targetLabel: 'Ir a Microestructura',
  },
];

const EDGES: ArchEdge[] = [
  {
    id: 'e_okx_cache',
    from: 'okx_api',
    to: 'market_cache',
    label: 'OHLCV 1H/1D + OI + L/S',
    scenarios: ['all', 'cone_gex', 'trade_options', 'journal_cloud', 'micro_l2'],
  },
  {
    id: 'e_deribit_cache',
    from: 'deribit_api',
    to: 'market_cache',
    label: 'Cadena Opciones + DVOL',
    scenarios: ['all', 'cone_gex', 'trade_options', 'journal_cloud'],
  },
  {
    id: 'e_cache_quant',
    from: 'market_cache',
    to: 'quant_engine',
    label: 'Series normalizadas',
    scenarios: ['all', 'cone_gex', 'journal_cloud'],
  },
  {
    id: 'e_cache_options',
    from: 'market_cache',
    to: 'trade_options_svc',
    label: 'Velas + Opciones',
    scenarios: ['all', 'trade_options'],
  },
  {
    id: 'e_quant_options',
    from: 'quant_engine',
    to: 'trade_options_svc',
    label: 'GJR-GARCH + GEX + Bias',
    scenarios: ['all', 'trade_options'],
  },
  {
    id: 'e_cache_batch',
    from: 'market_cache',
    to: 'batch_services',
    label: '40 swaps + Orderbook L2',
    scenarios: ['all', 'micro_l2'],
  },
  {
    id: 'e_quant_journal',
    from: 'quant_engine',
    to: 'schedulers_jsonl',
    label: 'Capturas diarias',
    scenarios: ['all', 'journal_cloud'],
  },
  {
    id: 'e_options_journal',
    from: 'trade_options_svc',
    to: 'schedulers_jsonl',
    label: 'Auto-registro 4 h',
    scenarios: ['all', 'trade_options'],
  },
  {
    id: 'e_batch_journal',
    from: 'batch_services',
    to: 'schedulers_jsonl',
    label: 'Barras L2 60 s',
    scenarios: ['all', 'micro_l2'],
  },
  {
    id: 'e_cache_signals',
    from: 'market_cache',
    to: 'signals_backtest',
    label: 'Velas 1H (4,000) + 1D',
    scenarios: ['all', 'trade_options'],
  },
  {
    id: 'e_signals_options',
    from: 'signals_backtest',
    to: 'trade_options_svc',
    label: 'Setups + veredicto',
    scenarios: ['all', 'trade_options'],
  },
  {
    id: 'e_options_eval',
    from: 'trade_options_svc',
    to: 'eval_engine',
    label: 'Opciones registradas',
    scenarios: ['all', 'trade_options'],
  },
  {
    id: 'e_options_store',
    from: 'trade_options_svc',
    to: 'data_store',
    label: 'Escritura atómica JSONL',
    scenarios: ['all', 'trade_options', 'journal_cloud'],
  },
  {
    id: 'e_eval_ui',
    from: 'eval_engine',
    to: 'ui_trading',
    label: 'Veredicto de acierto',
    scenarios: ['all', 'trade_options'],
  },
  {
    id: 'e_store_ui',
    from: 'data_store',
    to: 'ui_audit',
    label: 'Estado, backups, sesiones',
    scenarios: ['all', 'journal_cloud'],
  },
  {
    id: 'e_quant_ui',
    from: 'quant_engine',
    to: 'ui_quant',
    label: 'Conos + GEX + SVI',
    scenarios: ['all', 'cone_gex'],
  },
  {
    id: 'e_options_ui',
    from: 'trade_options_svc',
    to: 'ui_trading',
    label: 'Propuestas + Sesgo GEX',
    scenarios: ['all', 'trade_options'],
  },
  {
    id: 'e_journal_ui_audit',
    from: 'schedulers_jsonl',
    to: 'ui_audit',
    label: 'Diario + Estudio IC',
    scenarios: ['all', 'journal_cloud', 'micro_l2'],
  },
  {
    id: 'e_batch_ui_audit',
    from: 'batch_services',
    to: 'ui_audit',
    label: 'Ranking 40 + L2 vivo',
    scenarios: ['all', 'micro_l2'],
  },
];

interface PipelineBenchmarkRow {
  id: string;
  module: string;
  endpoint: string;
  cadence: string;
  candlesUsed: number;
  mcPaths: number;
  horizonLabel: string;
  mathNotes: string;
  targetTab: NavTab;
}

const PIPELINE_ROWS: PipelineBenchmarkRow[] = [
  {
    id: 'cone',
    module: 'Cono de Probabilidad 1H / 1D',
    endpoint: 'GET /api/overview',
    cadence: 'Bajo demanda + caché 60 s',
    candlesUsed: 1100,
    mcPaths: 3000,
    horizonLabel: '72 h / 30 d',
    mathNotes:
      'Estima GJR-GARCH(1,1) Student-t, mezcla con relación HAR-RV (ensamble), clasifica régimen GMM — mezcla gaussiana de 3 componentes (Calma/Normal/Turbulento) y acopla densidad SVI libre de arbitraje cuando hay cadena Deribit.',
    targetTab: 'cone',
  },
  {
    id: 'trade_options',
    module: 'Opciones de Trading & Sesgo GEX',
    endpoint: 'GET /api/trade-options',
    cadence: 'Auto cada 30 min (ventanas 4 h)',
    candlesUsed: 1100,
    mcPaths: 4000,
    horizonLabel: '24 h / 72 h',
    mathNotes:
      'Cada estrategia entra solo si cumple sus condiciones (filtro de tendencia diaria, SL tras swing, TP limitado por niveles). Puntúa con confluencia de 9 factores y el historial medido; las 4,000 rutas GARCH dan P(TP) y EV con deriva neutra.',
    targetTab: 'trade_options',
  },
  {
    id: 'backtest',
    module: 'Backtest de Estrategias & Evaluación Forward',
    endpoint: 'GET /api/trade-options',
    cadence: 'Backtest cada 3 h por activo; evaluación en cada consulta',
    candlesUsed: 4000,
    mcPaths: 0,
    horizonLabel: '24 h / 72 h',
    mathNotes:
      'Replay de las mismas reglas sobre ~160 días (cada 4 h, sin solape, SL primero, coste 0,07 %) y esperanza en R con error estándar. Veredicto: validada si el límite inferior (90 %) supera 0. Las operaciones reales se evalúan con línea base y operación espejo.',
    targetTab: 'trade_options',
  },
  {
    id: 'trade_grid',
    module: 'Rejilla EV & Simulador What-If',
    endpoint: 'GET /api/trades',
    cadence: 'Bajo demanda',
    candlesUsed: 1600,
    mcPaths: 5000,
    horizonLabel: '24 h (SL×TP)',
    mathNotes:
      'Evalúa combinaciones SL×TP descontando 0.07 %–0.10 % de fricción, calcula esperanza matemática, fracción óptima de Kelly y reglas contrarian de derivados con significancia Bonferroni.',
    targetTab: 'trades',
  },
  {
    id: 'walkforward',
    module: 'Calibración Walk-Forward',
    endpoint: 'GET /api/walkforward',
    cadence: 'Bajo demanda',
    candlesUsed: 1100,
    mcPaths: 1500,
    horizonLabel: 'Ventana 500 h',
    mathNotes:
      'Reentrena periódicamente sin look-ahead para construir el histograma PIT de 10 bins y ejecutar pruebas formales de cobertura Kupiec, independencia Christoffersen y Diebold-Mariano.',
    targetTab: 'cone',
  },
  {
    id: 'rotation',
    module: 'Rotación 40 Swaps OKX',
    endpoint: 'GET /api/rotation',
    cadence: 'Bajo demanda + caché',
    candlesUsed: 150,
    mcPaths: 45,
    horizonLabel: '150 d × 40 pares',
    mathNotes:
      'Descarga 150 velas diarias de los 40 contratos perpetuos más líquidos, evalúa 45 variantes Lookback×TopK×Rebalanceo y reporta Sharpe anualizado, Newey-West t y Deflated Sharpe Ratio.',
    targetTab: 'rotation',
  },
  {
    id: 'micro',
    module: 'Microestructura L2 & Spearman IC',
    endpoint: 'GET /api/micro/study',
    cadence: 'Colector continuo cada 60 s',
    candlesUsed: 20,
    mcPaths: 0,
    horizonLabel: '5 m / 15 m / 60 m',
    mathNotes:
      'Captura libro L2 (top 20 niveles), tasa de funding, base de futuros, flujo taker y liquidaciones; calcula correlación de rangos Spearman IC y significancia ajustada por Bonferroni.',
    targetTab: 'micro',
  },
];

const ACCENT_MAP: Record<
  ArchNode['accent'],
  { border: string; title: string; dot: string; activeBg: string }
> = {
  sky: {
    border: 'stroke-sky-500/70 dark:stroke-sky-400/70',
    title: 'fill-sky-700 dark:fill-sky-300',
    dot: 'bg-sky-500',
    activeBg: 'fill-sky-50 dark:fill-sky-950/50',
  },
  emerald: {
    border: 'stroke-emerald-500/70 dark:stroke-emerald-400/70',
    title: 'fill-emerald-700 dark:fill-emerald-300',
    dot: 'bg-emerald-500',
    activeBg: 'fill-emerald-50 dark:fill-emerald-950/50',
  },
  amber: {
    border: 'stroke-amber-500/70 dark:stroke-amber-400/70',
    title: 'fill-amber-700 dark:fill-amber-300',
    dot: 'bg-amber-500',
    activeBg: 'fill-amber-50 dark:fill-amber-950/50',
  },
  violet: {
    border: 'stroke-violet-500/70 dark:stroke-violet-400/70',
    title: 'fill-violet-700 dark:fill-violet-300',
    dot: 'bg-violet-500',
    activeBg: 'fill-violet-50 dark:fill-violet-950/50',
  },
};

function buildCurvePath(from: ArchNode, to: ArchNode): { d: string; midX: number; midY: number } {
  const x1 = from.x + from.w;
  const y1 = from.y + from.h / 2;
  const x2 = to.x;
  const y2 = to.y + to.h / 2;
  const dx = Math.max(36, (x2 - x1) * 0.5);
  const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  return { d, midX: (x1 + x2) / 2, midY: (y1 + y2) / 2 };
}

export const ArchitectureView: React.FC<Props> = ({ asset, onNavigateTab }) => {
  const [scenario, setScenario] = useState<FlowScenarioId>('all');
  const [selectedNodeId, setSelectedNodeId] = useState<string>('trade_options_svc');
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [chartMetric, setChartMetric] = useState<'mcPaths' | 'candlesUsed'>('mcPaths');
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>('trade_options');

  const nodeMap = useMemo(() => {
    const map = new Map<string, ArchNode>();
    for (const n of NODES) map.set(n.id, n);
    return map;
  }, []);

  const focusNodeId = hoveredNodeId ?? selectedNodeId;
  const selectedNode = nodeMap.get(selectedNodeId) ?? NODES[0];

  const activeScenario = useMemo(
    () => FLOW_SCENARIOS.find((s) => s.id === scenario) ?? FLOW_SCENARIOS[0],
    [scenario],
  );

  // Determine highlighted nodes & edges based on selected scenario + focused node
  const { activeEdgeIds, connectedNodeIds } = useMemo(() => {
    const scenarioEdges = EDGES.filter((e) => e.scenarios.includes(scenario));
    const edgeSet = new Set<string>();
    const nodeSet = new Set<string>();

    if (scenario === 'all') {
      // Highlight paths touching the focused node
      for (const e of scenarioEdges) {
        if (e.from === focusNodeId || e.to === focusNodeId) {
          edgeSet.add(e.id);
          nodeSet.add(e.from);
          nodeSet.add(e.to);
        }
      }
      nodeSet.add(focusNodeId);
    } else {
      for (const e of scenarioEdges) {
        edgeSet.add(e.id);
        nodeSet.add(e.from);
        nodeSet.add(e.to);
      }
    }
    return { activeEdgeIds: edgeSet, connectedNodeIds: nodeSet };
  }, [scenario, focusNodeId]);

  const maxMetricVal = useMemo(() => {
    return Math.max(
      1,
      ...PIPELINE_ROWS.map((r) => (chartMetric === 'mcPaths' ? r.mcPaths : r.candlesUsed)),
    );
  }, [chartMetric]);

  const selectedPipeline = useMemo(
    () => PIPELINE_ROWS.find((r) => r.id === selectedPipelineId) ?? PIPELINE_ROWS[0],
    [selectedPipelineId],
  );

  const handleSelectScenario = (next: FlowScenarioId) => {
    setScenario(next);
    if (next === 'cone_gex') setSelectedNodeId('quant_engine');
    else if (next === 'trade_options') setSelectedNodeId('trade_options_svc');
    else if (next === 'journal_cloud') setSelectedNodeId('schedulers_jsonl');
    else if (next === 'micro_l2') setSelectedNodeId('batch_services');
  };

  return (
    <div className="space-y-6">
      {/* Header Explanation */}
      <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1 max-w-3xl">
          <h2 className="text-base font-display font-semibold text-slate-900 dark:text-slate-50">
            Arquitectura del Sistema · Flujo Cuantitativo, Validación y Datos Locales
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Diagrama interactivo de la estructura real de Trading Predictor para {asset.toUpperCase()}-USDT-SWAP. Selecciona un flujo operativo o haz clic sobre cualquier módulo para inspeccionar entradas, salidas, modelos matemáticos y endpoints.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setScenario('all');
            setSelectedNodeId('trade_options_svc');
            setHoveredNodeId(null);
          }}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Restablecer vista</span>
        </button>
      </div>

      {/* Estado real de los datos locales */}
      <DataStatusBar />

      {/* Ciclo de vida de una opción de trading */}
      <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-3">
        <div>
          <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-50">
            Ciclo de vida de una opción de trading
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            De los datos de mercado a saber si la app acierta: cada paso se puede inspeccionar en el diagrama.
          </p>
        </div>
        <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
          {[
            { t: 'Datos', d: 'Velas 1H/1D de OKX, derivados y cadena de opciones de Deribit, con caché y reintentos.', node: 'market_cache' },
            { t: 'Condiciones', d: 'Cada estrategia propone solo si se cumplen sus condiciones; si no, explica por qué no opera.', node: 'signals_backtest' },
            { t: 'Historial medido', d: 'Las mismas reglas se repiten sobre ~160 días y se combinan con las operaciones reales: veredicto por estrategia.', node: 'signals_backtest' },
            { t: 'Calidad y riesgo', d: 'Calidad = setup + confluencia + historial. El riesgo sugerido es mínimo sin ventaja validada.', node: 'trade_options_svc' },
            { t: 'Registro local', d: 'Cada opción emitida se guarda en data/ con su contexto de mercado congelado.', node: 'data_store' },
            { t: 'Evaluación forward', d: 'Se compara con el precio posterior (TP1/TP2/SL, dirección, operación espejo) y se emite un veredicto con significancia.', node: 'eval_engine' },
          ].map((st, i) => (
            <li key={st.t}>
              <button
                type="button"
                onClick={() => {
                  setScenario('trade_options');
                  setSelectedNodeId(st.node);
                }}
                className="w-full h-full text-left rounded-md border border-slate-200 dark:border-slate-800 p-3 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors cursor-pointer"
              >
                <div className="font-semibold text-slate-900 dark:text-slate-100">
                  <span className="font-mono tabular-nums text-sky-600 dark:text-sky-400 mr-1.5">{i + 1}.</span>
                  {st.t}
                </div>
                <div className="mt-1 text-slate-600 dark:text-slate-300">{st.d}</div>
              </button>
            </li>
          ))}
        </ol>
      </div>

      {/* Structural Summary KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Capa 1 · Fuentes Públicas</div>
          <div className="mt-1.5 text-lg font-display font-semibold text-slate-900 dark:text-slate-50">
            OKX &amp; Deribit
          </div>
          <div className="mt-1 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
            OHLCV 1H/1D · Opciones · L2
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Capa 2 · Backend Express + TS</div>
          <div className="mt-1.5 text-lg font-display font-semibold text-slate-900 dark:text-slate-50 font-mono tabular-nums">
            8 Módulos · 26 Endpoints
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            GARCH, SVI, GEX, Backtest, Evaluación
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Capa 3 · Persistencia local</div>
          <div className="mt-1.5 text-lg font-display font-semibold text-slate-900 dark:text-slate-50">
            JSONL Local
          </div>
          <div className="mt-1 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
            data/ · se conserva entre ejecuciones
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Capa 4 · Cliente React 19 SPA</div>
          <div className="mt-1.5 text-lg font-display font-semibold text-slate-900 dark:text-slate-50 font-mono tabular-nums">
            8 Vistas · Radar Global
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Vite + Tailwind v4 (Claro / Oscuro)
          </div>
        </div>
      </div>

      {/* Interactive Topology Diagram + Live Component Inspector */}
      <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-50">
              Mapa Interactivo de Flujo de Datos y Dependencias
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {activeScenario.description}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-lg">
            {FLOW_SCENARIOS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => handleSelectScenario(s.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  scenario === s.id
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-50 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Interactive SVG Architecture Canvas */}
        <div className="overflow-x-auto border border-slate-200/80 dark:border-slate-800/80 rounded-md bg-slate-50/70 dark:bg-slate-950/50">
          <svg
            viewBox="0 0 1120 560"
            className="w-full min-w-[860px] h-auto select-none"
            role="img"
            aria-label="Diagrama interactivo de la arquitectura de Trading Predictor"
          >
            <defs>
              <marker
                id="arch-arrow-active"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 1.5 L 8.5 5 L 0 8.5 z" className="fill-sky-500 dark:fill-sky-400" />
              </marker>
              <marker
                id="arch-arrow-muted"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="5"
                markerHeight="5"
                orient="auto-start-reverse"
              >
                <path d="M 0 1.5 L 8.5 5 L 0 8.5 z" className="fill-slate-400/50 dark:fill-slate-600/60" />
              </marker>
            </defs>

            {/* Layer Column Headers */}
            {(
              [
                { col: 0, x: 24, w: 224, label: '01. Ingesta Externa' },
                { col: 1, x: 298, w: 236, label: '02. Motor Backend (Express)' },
                { col: 2, x: 584, w: 224, label: '03. Evaluación & Datos' },
                { col: 3, x: 860, w: 236, label: '04. Vistas React SPA' },
              ] as const
            ).map((hdr) => (
              <g key={hdr.col}>
                <rect
                  x={hdr.x}
                  y={10}
                  width={hdr.w}
                  height={24}
                  rx={4}
                  className="fill-slate-200/70 dark:fill-slate-800/70"
                />
                <text
                  x={hdr.x + hdr.w / 2}
                  y={26}
                  textAnchor="middle"
                  className="text-[11px] font-semibold fill-slate-700 dark:fill-slate-200 font-sans"
                >
                  {hdr.label}
                </text>
              </g>
            ))}

            {/* Edges */}
            {EDGES.map((edge) => {
              const from = nodeMap.get(edge.from);
              const to = nodeMap.get(edge.to);
              if (!from || !to) return null;
              const { d, midX, midY } = buildCurvePath(from, to);
              const isHighlighted = activeEdgeIds.has(edge.id);

              return (
                <g key={edge.id}>
                  <path
                    d={d}
                    fill="none"
                    strokeWidth={isHighlighted ? 2.2 : 1.1}
                    markerEnd={isHighlighted ? 'url(#arch-arrow-active)' : 'url(#arch-arrow-muted)'}
                    className={`transition-opacity duration-200 ${
                      isHighlighted
                        ? 'stroke-sky-500 dark:stroke-sky-400 opacity-95'
                        : 'stroke-slate-300 dark:stroke-slate-700 opacity-35'
                    }`}
                  />
                  {isHighlighted && (
                    <circle r="3.2" className="fill-sky-500 dark:fill-sky-300 motion-reduce:hidden">
                      <animateMotion dur="2.6s" repeatCount="indefinite" path={d} />
                    </circle>
                  )}
                  {isHighlighted && scenario !== 'all' && (
                    <g transform={`translate(${midX}, ${midY - 6})`}>
                      <rect
                        x={-54}
                        y={-9}
                        width={108}
                        height={15}
                        rx={3}
                        className="fill-white/95 dark:fill-slate-900/95 stroke-slate-200 dark:stroke-slate-700"
                        strokeWidth={0.8}
                      />
                      <text
                        x={0}
                        y={2}
                        textAnchor="middle"
                        className="text-[9px] font-mono fill-slate-700 dark:fill-slate-200"
                      >
                        {edge.label}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}

            {/* Nodes */}
            {NODES.map((node) => {
              const isSelected = selectedNodeId === node.id;
              const isConnected = connectedNodeIds.has(node.id);
              const acc = ACCENT_MAP[node.accent];

              return (
                <g
                  key={node.id}
                  onClick={() => setSelectedNodeId(node.id)}
                  onMouseEnter={() => setHoveredNodeId(node.id)}
                  onMouseLeave={() => setHoveredNodeId(null)}
                  className="cursor-pointer"
                  opacity={isConnected || isSelected ? 1 : 0.42}
                >
                  <rect
                    x={node.x}
                    y={node.y}
                    width={node.w}
                    height={node.h}
                    rx={8}
                    strokeWidth={isSelected ? 2 : 1}
                    className={`transition-all duration-150 ${
                      isSelected
                        ? `${acc.activeBg} ${acc.border}`
                        : 'fill-white dark:fill-slate-900 stroke-slate-200 dark:stroke-slate-800'
                    }`}
                  />

                  <text
                    x={node.x + 12}
                    y={node.y + 22}
                    className={`text-[10px] font-mono uppercase tracking-wide ${
                      isSelected ? acc.title : 'fill-slate-400 dark:fill-slate-500'
                    }`}
                  >
                    {node.layer}
                  </text>

                  <text
                    x={node.x + 12}
                    y={node.y + 42}
                    className="text-[13px] font-semibold fill-slate-900 dark:fill-slate-50 font-display"
                  >
                    {node.title}
                  </text>

                  <text
                    x={node.x + 12}
                    y={node.y + 59}
                    className="text-[10.5px] fill-slate-500 dark:fill-slate-400 font-sans"
                  >
                    {node.subtitle.length > 34 ? `${node.subtitle.slice(0, 33)}…` : node.subtitle}
                  </text>

                  {node.h >= 90 && (
                    <text
                      x={node.x + 12}
                      y={node.y + node.h - 14}
                      className="text-[10px] font-mono fill-slate-500 dark:fill-slate-400"
                    >
                      {node.endpoints[0]?.slice(0, 30)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>

        {/* Selected Node Inspector */}
        <div className="pt-4 border-t border-slate-100 dark:border-slate-800 grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 space-y-2.5">
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <Layers className="w-3.5 h-3.5 text-sky-500" />
              <span>{selectedNode.layer}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">{selectedNode.subtitle}</span>
            </div>
            <h4 className="text-base font-display font-semibold text-slate-900 dark:text-slate-50">
              {selectedNode.title}
            </h4>
            <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              {selectedNode.summary}
            </p>
            {selectedNode.targetTab && selectedNode.targetLabel && (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => onNavigateTab(selectedNode.targetTab!)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-md bg-sky-600 text-white hover:bg-sky-500 transition-colors cursor-pointer"
                >
                  <span>{selectedNode.targetLabel}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div className="space-y-1.5">
              <div className="font-semibold text-slate-800 dark:text-slate-200">Entradas</div>
              <ul className="space-y-1 text-slate-600 dark:text-slate-300">
                {selectedNode.inputs.map((inp, idx) => (
                  <li key={idx}>• {inp}</li>
                ))}
              </ul>
            </div>

            <div className="space-y-1.5">
              <div className="font-semibold text-slate-800 dark:text-slate-200">Salidas</div>
              <ul className="space-y-1 text-slate-600 dark:text-slate-300">
                {selectedNode.outputs.map((out, idx) => (
                  <li key={idx}>• {out}</li>
                ))}
              </ul>
            </div>

            <div className="space-y-1.5">
              <div className="font-semibold text-slate-800 dark:text-slate-200">Rutas / Colecciones</div>
              <ul className="space-y-1 font-mono text-[11px] text-sky-600 dark:text-sky-400">
                {selectedNode.endpoints.map((ep, idx) => (
                  <li key={idx} className="truncate" title={ep}>
                    {ep}
                  </li>
                ))}
              </ul>
            </div>

            <div className="sm:col-span-3 pt-2 border-t border-slate-100 dark:border-slate-800/80 space-y-1 text-slate-600 dark:text-slate-300">
              {selectedNode.details.map((d, idx) => (
                <div key={idx}>• {d}</div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Interactive Compute & Data Horizon Chart */}
      <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-50">
              Carga Analítica y Ventanas de Datos por Módulo
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Haz clic en cualquier barra para inspeccionar el cálculo exacto, frecuencia de ejecución y horizonte evaluado.
            </p>
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-lg">
            <button
              type="button"
              onClick={() => setChartMetric('mcPaths')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                chartMetric === 'mcPaths'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-50 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Rutas / Variantes Simulación
            </button>
            <button
              type="button"
              onClick={() => setChartMetric('candlesUsed')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                chartMetric === 'candlesUsed'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-50 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Profundidad de Datos (Barras / Niveles)
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Interactive Bar Chart */}
          <div className="lg:col-span-7 space-y-2.5">
            {PIPELINE_ROWS.map((row) => {
              const val = chartMetric === 'mcPaths' ? row.mcPaths : row.candlesUsed;
              const pct = Math.max(val > 0 ? 4 : 0, (val / maxMetricVal) * 100);
              const isActive = selectedPipeline.id === row.id;

              return (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => setSelectedPipelineId(row.id)}
                  className={`w-full text-left p-2.5 rounded-md border transition-colors cursor-pointer ${
                    isActive
                      ? 'border-sky-500/60 bg-sky-500/5 dark:bg-sky-500/10'
                      : 'border-slate-200/70 dark:border-slate-800/70 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-xs mb-1.5">
                    <span className="font-medium text-slate-800 dark:text-slate-100">
                      {row.module}
                    </span>
                    <span className="font-mono tabular-nums text-slate-600 dark:text-slate-300">
                      {chartMetric === 'mcPaths'
                        ? row.mcPaths > 0
                          ? `${row.mcPaths.toLocaleString('en-US')} simulaciones/variantes`
                          : 'Estadístico directo (sin MC)'
                        : `${row.candlesUsed.toLocaleString('en-US')} barras/niveles`}
                    </span>
                  </div>
                  <div className="h-2 w-full rounded bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-200 ${
                        isActive
                          ? 'bg-sky-600 dark:bg-sky-400'
                          : 'bg-slate-400 dark:bg-slate-600'
                      }`}
                      style={{ width: `${pct.toFixed(1)}%` }}
                    />
                  </div>
                </button>
              );
            })}
          </div>

          {/* Pipeline Module Detail */}
          <div className="lg:col-span-5 p-4 rounded-md border border-slate-200/80 dark:border-slate-800/80 bg-slate-50/70 dark:bg-slate-950/40 space-y-3">
            <div className="flex items-baseline justify-between gap-2">
              <h4 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-50">
                {selectedPipeline.module}
              </h4>
              <span className="text-[11px] font-mono tabular-nums text-sky-600 dark:text-sky-400">
                {selectedPipeline.horizonLabel}
              </span>
            </div>

            <div className="divide-y divide-slate-200/70 dark:divide-slate-800/70 text-xs font-mono tabular-nums">
              <div className="py-1.5 flex justify-between gap-2">
                <span className="font-sans text-slate-500 dark:text-slate-400">Endpoint API</span>
                <span className="text-slate-800 dark:text-slate-100">{selectedPipeline.endpoint}</span>
              </div>
              <div className="py-1.5 flex justify-between gap-2">
                <span className="font-sans text-slate-500 dark:text-slate-400">Frecuencia</span>
                <span className="font-sans text-slate-800 dark:text-slate-100">{selectedPipeline.cadence}</span>
              </div>
              <div className="py-1.5 flex justify-between gap-2">
                <span className="font-sans text-slate-500 dark:text-slate-400">Ventana de datos</span>
                <span className="text-slate-800 dark:text-slate-100">
                  {selectedPipeline.candlesUsed.toLocaleString('en-US')} muestras
                </span>
              </div>
            </div>

            <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              {selectedPipeline.mathNotes}
            </p>

            <button
              type="button"
              onClick={() => onNavigateTab(selectedPipeline.targetTab)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <span>Abrir módulo en vivo</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Architectural Layers & Hybrid Storage Explanation */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-3">
          <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-50">
            Diseño de Capas y Desacoplamiento
          </h3>
          <div className="divide-y divide-slate-100 dark:divide-slate-800/70 text-xs">
            <div className="py-2.5 space-y-1">
              <div className="font-semibold text-slate-800 dark:text-slate-200">
                1. Proxy Backend y Seguridad de Datos
              </div>
              <p className="text-slate-600 dark:text-slate-300">
                El servidor Express centraliza las consultas hacia OKX y Deribit, aplica cachés TTL para no agotar límites públicos y mantiene la lógica matemática pesada en TypeScript fuera del hilo principal del navegador.
              </p>
            </div>
            <div className="py-2.5 space-y-1">
              <div className="font-semibold text-slate-800 dark:text-slate-200">
                2. Transparencia por Cobertura de Activo
              </div>
              <p className="text-slate-600 dark:text-slate-300">
                BTC y ETH integran cadena de opciones Deribit (DVOL, SVI y GEX Positivo/Negativo). En SOL, donde no existe cadena de opciones listada, los módulos degradan con elegancia hacia modelos OKX y parámetros técnicos puros.
              </p>
            </div>
            <div className="py-2.5 space-y-1">
              <div className="font-semibold text-slate-800 dark:text-slate-200">
                3. Auditoría Sin Sesgo Retrospectivo
              </div>
              <p className="text-slate-600 dark:text-slate-300">
                Tanto el Diario automático como las Opciones de Trading registran su precio y parámetros al momento de generarse la lectura, y posteriormente evalúan el resultado real vela por vela.
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-3">
          <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-50">
            Persistencia local (JSONL)
          </h3>
          <div className="divide-y divide-slate-100 dark:divide-slate-800/70 text-xs">
            <div className="py-2.5 space-y-1">
              <div className="font-semibold text-slate-800 dark:text-slate-200">
                Archivos locales de ejecución continua
              </div>
              <p className="text-slate-600 dark:text-slate-300">
                Los programadores automáticos guardan predicciones diarias, barras L2 y operaciones registradas en disco para garantizar continuidad inmediata y exportación directa en CSV/JSONL.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

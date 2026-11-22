# Trading Predictor

Conos de volatilidad, derivados/GEX, opciones de trading y un sistema que evalúa si esas opciones aciertan.

## Ejecutable (.exe)

- **Sin instalar nada:** en GitHub → *Releases* → «Última versión (.exe)» → descarga `TradingPredictor.exe`.
  Se regenera solo cada vez que se actualiza `main` (workflow `.github/workflows/build-exe.yml`).
- **Generarlo tú:** `npm install` y `npm run build:exe` → `release/TradingPredictor.exe`.
- Pon el `.exe` en una carpeta propia (p. ej. `TradingPredictor/`): al abrirlo arranca el servidor, abre el navegador y crea la carpeta `data/` **junto al .exe** con todos tus datos. Para actualizar a una versión nueva, reemplaza solo el `.exe`; `data/` se conserva.
- Deja la ventana negra abierta mientras usas la app; al cerrarla se detiene. Windows puede mostrar el aviso «SmartScreen» la primera vez (el ejecutable no está firmado): *Más información → Ejecutar de todas formas*.
- El `.exe` solo escucha en tu equipo (`127.0.0.1`).

## Arrancar desde el código

- Windows: doble clic en `iniciar.bat`
- Mac/Linux: `./iniciar.sh`
- Manual: `npm install` y `npm run dev`, y abrir http://localhost:3000

## Cómo se generan las Opciones de Trading

- Cada estrategia **solo propone operación si se cumplen sus condiciones**; si no, la sección explica por qué no opera (esperar también es una decisión).
  - *Continuación de tendencia*: tendencia horaria y diaria alineadas, retroceso hasta la zona de la EMA20 sin sobreextensión.
  - *Reversión a la media*: extremo de Bollinger + RSI, sin tendencia fuerte, con vela de giro.
  - *Ruptura de rango*: rango de 24 h comprimido, cierre fuera con volumen, sin perseguir.
  - *Squeeze de derivados*: funding / L-S saturados con el precio ya girando.
- No se opera contra la tendencia diaria sin un extremo claro. SL tras el último swing; TP1 nunca más allá del siguiente nivel (pivote, máx/mín 7 d, muros GEX); distancias medidas en rango diario.
- **Historial medido:** las mismas reglas se repiten sobre el histórico (backtest, sin ajustar parámetros) y se combinan con las operaciones reales registradas. Veredicto por estrategia: *validada / prometedora / dudosa / descartada / sin datos*. Solo se marca ★ recomendada con ventaja validada (o prometedora con muestra amplia) y el riesgo sugerido (¼ Kelly) es 0 sin ventaja validada.
- El sistema de evaluación mide además si las opciones «validadas» rinden mejor que el resto («Por veredicto de la estrategia»).

## Dónde se guardan tus datos

Todo en la carpeta `data/` (no se sube a git y no se sobrescribe al actualizar el código):

| Qué | Dónde |
|---|---|
| Opciones de trading y su evaluación | `data/journal/trade_options.jsonl` |
| Lecturas diarias del diario | `data/journal/predictions*.jsonl` |
| Microestructura | `data/micro/` y `data/journal/micro/` |
| Ajustes (diario automático, colector) | `data/settings.json` |
| Cuándo estuvo encendida la app | `data/sessions.json` |
| Copias de seguridad diarias (últimas 14) | `data/backups/AAAA-MM-DD/` |

Cada vez que abres la app: conserva todo lo anterior, retoma la recopilación, evalúa las opciones que vencieron mientras estaba apagada y registra cuántas horas estuvo apagada. Mientras está apagada no se generan opciones nuevas (no se inventan con retraso).

Para llevarte los datos a otro equipo, copia la carpeta `data/`. Variables opcionales en `.env.example`.

## Pruebas

`npm test`

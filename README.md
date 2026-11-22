# Trading Predictor

Conos de volatilidad, derivados/GEX, opciones de trading y un sistema que evalúa si esas opciones aciertan.

## Arrancar

- Windows: doble clic en `iniciar.bat`
- Mac/Linux: `./iniciar.sh`
- Manual: `npm install` y `npm run dev`, y abrir http://localhost:3000

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

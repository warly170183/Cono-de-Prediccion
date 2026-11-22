#!/usr/bin/env bash
# Arranca la app en local y abre el navegador. Los datos se guardan en ./data y se conservan entre ejecuciones.
cd "$(dirname "$0")"
[ -d node_modules ] || npm install
export HOST=127.0.0.1
( sleep 8; (xdg-open http://localhost:3000 || open http://localhost:3000) >/dev/null 2>&1 ) &
npm run dev

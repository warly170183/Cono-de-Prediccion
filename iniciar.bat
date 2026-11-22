@echo off
cd /d "%~dp0"
if not exist node_modules ( call npm install )
set HOST=127.0.0.1
start "" cmd /c "timeout /t 8 /nobreak >nul & start http://localhost:3000"
npm run dev

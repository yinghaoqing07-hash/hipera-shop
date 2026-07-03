@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found.
  echo Install Node.js LTS from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)

if not exist ".env" (
  echo Missing .env. Run setup-store-pc.ps1 first.
  pause
  exit /b 1
)

if not exist "config.local.json" (
  echo Missing config.local.json. Run setup-store-pc.ps1 first.
  pause
  exit /b 1
)

rem La automatizacion web de Pedidos usa puppeteer-core (dependencia npm).
rem Si node_modules no existe (primer arranque tras descomprimir), se
rem instala aqui una sola vez. Necesita conexion a internet.
if not exist "node_modules" (
  echo Installing dependencies for the first time (puppeteer-core)...
  call npm install
  if errorlevel 1 (
    echo npm install failed. Check your internet connection and run start-bot.cmd again.
    pause
    exit /b 1
  )
)

node src\bot.js --config config.local.json
pause

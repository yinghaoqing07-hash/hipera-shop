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

node src\bot.js --config config.local.json
pause

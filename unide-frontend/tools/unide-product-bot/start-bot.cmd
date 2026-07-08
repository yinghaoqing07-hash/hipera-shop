@echo off
setlocal
cd /d "%~dp0"

rem UnideGes corre como administrador; Windows (UIPI) descarta EN SILENCIO
rem los clics/teclas que le mande un proceso sin elevar. El bot debe correr
rem elevado tambien: si no lo esta, se relanza pidiendo UAC.
net session >nul 2>&1
if errorlevel 1 (
  echo Pidiendo permisos de administrador para poder controlar UnideGes...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b 0
)

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

rem La automatizacion web de Pedidos usa puppeteer-core, una dependencia
rem npm. Si node_modules no existe -primer arranque tras descomprimir- se
rem instala aqui una sola vez. Necesita conexion a internet.
rem IMPORTANTE: sin parentesis en los echo dentro de bloques if, porque un
rem ) suelto cierra el bloque y rompe el script.
if not exist "node_modules" goto npm_install
goto run

:npm_install
echo Instalando dependencias por primera vez. Necesita internet y tarda un poco...
call npm install
if errorlevel 1 goto npm_failed

:run
node src\bot.js --config config.local.json
pause
exit /b 0

:npm_failed
echo.
echo npm install fallo. Revisa la conexion a internet y vuelve a abrir start-bot.cmd.
pause
exit /b 1

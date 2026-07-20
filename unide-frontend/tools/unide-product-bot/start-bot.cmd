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
rem Bucle vigilante: si el bot muere con error, se relanza solo a los 5 s.
rem NO se relanza cuando: salio limpio (codigo 0: panel "stop"), stop-bot o
rem el updater dejaron logs\stop.flag (parada a proposito), o ya hay otro
rem bot corriendo (codigo 3, puerto del panel ocupado). Si se cae 6 veces
rem seguidas nada mas arrancar, algo va mal de verdad y se para de insistir.
set REINICIOS=0

:bucle
if exist "logs\stop.flag" del /q "logs\stop.flag" >nul 2>&1
for /f %%t in ('powershell -NoProfile -Command "[DateTimeOffset]::Now.ToUnixTimeSeconds()"') do set INICIO=%%t
node src\bot.js --config config.local.json
set CODIGO=%errorlevel%
if "%CODIGO%"=="0" exit /b 0
if "%CODIGO%"=="3" (
  echo Ya hay otro bot corriendo. Esta ventana sobra y se cierra.
  timeout /t 5 /nobreak >nul
  exit /b 0
)
if exist "logs\stop.flag" (
  del /q "logs\stop.flag" >nul 2>&1
  exit /b 0
)
for /f %%t in ('powershell -NoProfile -Command "[DateTimeOffset]::Now.ToUnixTimeSeconds()"') do set AHORA=%%t
set /a DURACION=AHORA-INICIO
if %DURACION% GEQ 300 set REINICIOS=0
set /a REINICIOS+=1
if %REINICIOS% GEQ 6 (
  echo El bot se ha caido %REINICIOS% veces seguidas nada mas arrancar.
  echo Mira el ultimo archivo de la carpeta logs y manda el error a Claude.
  pause
  exit /b 1
)
echo El bot se cerro con error %CODIGO%. Reinicio %REINICIOS%/5 en 5 segundos...
timeout /t 5 /nobreak >nul
goto bucle

:npm_failed
echo.
echo npm install fallo. Revisa la conexion a internet y vuelve a abrir start-bot.cmd.
pause
exit /b 1

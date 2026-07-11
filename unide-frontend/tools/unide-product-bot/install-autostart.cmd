@echo off
setlocal
cd /d "%~dp0"

rem Instala el arranque automatico: al iniciar sesion en Windows, el bot se
rem arranca solo (tarea programada con privilegios elevados, sin ventana de
rem UAC en cada arranque). Ejecutar UNA vez. Para quitarlo:
rem   schtasks /Delete /TN "UnideProductBot" /F

net session >nul 2>&1
if errorlevel 1 (
  echo Pidiendo permisos de administrador para crear la tarea programada...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b 0
)

rem wscript + run-bot-hidden.vbs: el bot arranca sin ninguna ventana.
schtasks /Create /F /TN "UnideProductBot" /SC ONLOGON /RL HIGHEST /TR "wscript.exe \"%~dp0run-bot-hidden.vbs\""
if errorlevel 1 goto fallo

echo.
echo Listo: el bot arrancara solo al iniciar sesion en Windows.
echo Para probarlo ahora sin reiniciar:  schtasks /Run /TN "UnideProductBot"
echo Para desinstalarlo:                 schtasks /Delete /TN "UnideProductBot" /F
pause
exit /b 0

:fallo
echo.
echo No se pudo crear la tarea. Copia el error de arriba y mandalo a Claude.
pause
exit /b 1

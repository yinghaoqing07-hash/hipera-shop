@echo off
setlocal
cd /d "%~dp0"

rem Para el bot que corre OCULTO (desde install-autostart/panel.cmd ya no
rem hay ventana negra que cerrar). Para volver a arrancarlo: panel.cmd,
rem abrir-panel.vbs o start-bot.cmd.

net session >nul 2>&1
if errorlevel 1 (
  echo Pidiendo permisos de administrador para poder parar el bot...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b 0
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-bot.ps1"
pause
exit /b 0

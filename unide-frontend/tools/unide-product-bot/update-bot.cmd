@echo off
setlocal
cd /d "%~dp0"
rem Ruta ABSOLUTA al .ps1 ("%~dp0" acaba en "\"): con rutas OneDrive/中文
rem el -File relativo a veces no resolvia y daba "does not exist".
if not exist "%~dp0update-bot.ps1" goto no_ps1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update-bot.ps1"
pause
exit /b 0

:no_ps1
echo No se encuentra update-bot.ps1 junto a este .cmd.
echo Carpeta actual: "%~dp0"
echo Vuelve a extraer el paquete unide-product-bot-store-pc.zip completo aqui.
pause
exit /b 1

@echo off
setlocal
cd /d "%~dp0"

rem Panel del bot con aspecto de programa de escritorio:
rem  1. Si el bot no esta corriendo (nada escucha en el puerto), lo arranca.
rem  2. Espera a que el panel responda.
rem  3. Lo abre en una ventana app de Edge (sin barra de direcciones).

set PORT=8765

powershell -NoProfile -Command "try { (New-Object Net.Sockets.TcpClient('127.0.0.1',%PORT%)).Close(); exit 0 } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 goto abrir

echo El bot no esta corriendo. Arrancandolo...
start "" "%~dp0start-bot.cmd"
echo Esperando a que el bot este listo (hasta 60 s)...
powershell -NoProfile -Command "for($i=0;$i -lt 60;$i++){ try{(New-Object Net.Sockets.TcpClient('127.0.0.1',%PORT%)).Close(); exit 0}catch{Start-Sleep -Seconds 1} }; exit 1" >nul 2>&1
if errorlevel 1 goto sin_bot

:abrir
rem Ventana app (icono propio en la barra de tareas, sin pestanas). Si Edge
rem no estuviera, cae al navegador por defecto.
start "" msedge --app=http://127.0.0.1:%PORT%/ 2>nul || start "" "http://127.0.0.1:%PORT%/"
exit /b 0

:sin_bot
echo.
echo El bot no llego a arrancar. Mira la ventana negra de start-bot.cmd
echo (puede estar pidiendo permisos de administrador o instalando npm).
echo Cuando este corriendo, vuelve a abrir panel.cmd.
pause
exit /b 1

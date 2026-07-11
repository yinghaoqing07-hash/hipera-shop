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

echo El bot no esta corriendo. Arrancandolo en segundo plano...
rem Sin ventanas: si existe la tarea programada (install-autostart.cmd),
rem se usa (corre elevada y oculta, sin UAC). Si no, se eleva wscript con
rem un aviso UAC y el bot corre oculto igualmente.
schtasks /Query /TN "UnideProductBot" >nul 2>&1
if not errorlevel 1 (
  schtasks /Run /TN "UnideProductBot" >nul 2>&1
) else (
  powershell -NoProfile -Command "Start-Process -FilePath 'wscript.exe' -ArgumentList '\"%~dp0run-bot-hidden.vbs\"' -Verb RunAs"
)
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
echo El bot no llego a arrancar. Para ver que pasa, abre start-bot.cmd
echo directamente (ahi se ven los mensajes y errores) o mira la carpeta logs.
echo Cuando este corriendo, vuelve a abrir panel.cmd.
pause
exit /b 1

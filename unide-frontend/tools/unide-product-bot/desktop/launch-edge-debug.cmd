@echo off
rem =====================================================================
rem  Lanza Microsoft Edge con el puerto de depuracion -CDP- abierto, en un
rem  perfil DEDICADO, para que el bot pueda conducir la pagina de Pedidos
rem  -unideges30.unide.es- directamente por el DOM.
rem
rem  Por que un perfil dedicado: --remote-debugging-port SOLO tiene efecto
rem  al ARRANCAR un Edge nuevo. Si ya hay un Edge abierto con tu perfil
rem  normal, la bandera se ignora. Con un user-data-dir propio arrancamos
rem  una instancia separada que no molesta a tu navegacion habitual.
rem
rem  Solo hay que iniciar sesion en UnideGes UNA VEZ en esta ventana; el
rem  perfil recuerda la sesion. Deja la ventana y la pagina de Pedidos
rem  abiertas mientras uses /pedido_nuevo.
rem
rem  NOTA: se evitan bloques con parentesis y for-in porque
rem  %ProgramFiles(x86)% y los ) sueltos rompen el parser de cmd.
rem =====================================================================
setlocal

set "PROFILE=%USERPROFILE%\edge-unide-automation"
set "URL=https://unideges30.unide.es/OrderT_ListView"

set "EDGE="
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if exist "%LocalAppData%\Microsoft\Edge\Application\msedge.exe" set "EDGE=%LocalAppData%\Microsoft\Edge\Application\msedge.exe"

if not defined EDGE goto no_edge

echo Lanzando Edge -perfil de automatizacion- con el puerto 9222...
start "" "%EDGE%" --remote-debugging-port=9222 --user-data-dir="%PROFILE%" "%URL%"

echo.
echo En la ventana de Edge que se acaba de abrir:
echo   1. Inicia sesion en UnideGes -solo la primera vez-.
echo   2. Deja abierta la pagina de Pedidos -Gestion Tiendas, Pedidos-.
echo.
echo Luego, en Telegram, envia:  /pedido_web_test
echo.
timeout /t 6 >nul
exit /b 0

:no_edge
echo No se encontro msedge.exe en las rutas habituales.
echo Abre Edge manualmente anadiendo estos parametros:
echo    --remote-debugging-port=9222 --user-data-dir="%PROFILE%"
echo.
pause
exit /b 1

@echo off
rem =====================================================================
rem  Lanza Microsoft Edge con el puerto de depuracion (CDP) abierto, en un
rem  perfil DEDICADO, para que el bot pueda conducir la pagina de Pedidos
rem  (unideges30.unide.es) directamente por el DOM.
rem
rem  Por que un perfil dedicado: --remote-debugging-port SOLO tiene efecto
rem  al ARRANCAR un Edge nuevo. Si ya hay un Edge abierto con tu perfil
rem  normal, la bandera se ignora. Con un user-data-dir propio arrancamos
rem  una instancia separada que no molesta a tu navegacion habitual.
rem
rem  Solo hay que iniciar sesion en UnideGes UNA VEZ en esta ventana; el
rem  perfil recuerda la sesion. Deja la ventana y la pagina de Pedidos
rem  abiertas mientras uses /pedido_nuevo.
rem =====================================================================
setlocal enabledelayedexpansion

set "PROFILE=%USERPROFILE%\edge-unide-automation"
set "URL=https://unideges30.unide.es/OrderT_ListView"

set "EDGE="
for %%P in (
  "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
  "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
  "%LocalAppData%\Microsoft\Edge\Application\msedge.exe"
) do (
  if exist "%%~P" set "EDGE=%%~P"
)

if not defined EDGE (
  echo No se encontro msedge.exe en las rutas habituales.
  echo Abre Edge manualmente anadiendo estos parametros:
  echo    --remote-debugging-port=9222 --user-data-dir="%PROFILE%"
  echo.
  pause
  exit /b 1
)

echo Lanzando Edge (perfil de automatizacion) con el puerto 9222...
start "" "!EDGE!" --remote-debugging-port=9222 --user-data-dir="%PROFILE%" "%URL%"

echo.
echo En la ventana de Edge que se acaba de abrir:
echo   1) Inicia sesion en UnideGes (solo la primera vez).
echo   2) Deja abierta la pagina de Pedidos (Gestion Tiendas ^> Pedidos).
echo.
echo Luego, en Telegram, envia:  /pedido_web_test
echo (comprueba que el bot se conecta y ve la pagina).
echo.

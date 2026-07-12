@echo off
setlocal
cd /d "%~dp0"

rem Crea (o repone) el acceso directo JARVIS en el escritorio: abre el panel
rem sin ninguna consola (abrir-panel.vbs) y con su icono propio (jarvis.ico).
rem No necesita permisos de administrador. Ejecutar UNA vez; si se ejecuta
rem otra vez simplemente vuelve a crear el acceso.

rem La ruta va por variable de entorno (no por la linea de comandos) para
rem que las carpetas con caracteres chinos/OneDrive no se estropeen.
set "BOTDIR=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$dir = $env:BOTDIR; $ws = New-Object -ComObject WScript.Shell; $lnk = $ws.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'JARVIS.lnk')); $lnk.TargetPath = 'wscript.exe'; $lnk.Arguments = '\"' + (Join-Path $dir 'abrir-panel.vbs') + '\"'; $lnk.WorkingDirectory = $dir; $lnk.IconLocation = (Join-Path $dir 'jarvis.ico') + ',0'; $lnk.Description = 'JARVIS - panel de la tienda'; $lnk.Save(); Write-Host ('Listo: acceso directo JARVIS creado en el escritorio (' + [Environment]::GetFolderPath('Desktop') + ')')"
if errorlevel 1 goto fallo
pause
exit /b 0

:fallo
echo.
echo No se pudo crear el acceso directo. Copia el error de arriba y mandalo a Claude.
pause
exit /b 1

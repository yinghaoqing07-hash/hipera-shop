@echo off
REM ====================================================================
REM HIPERA - lanzador del agente de impresion
REM ====================================================================
REM Hace cd a su propia carpeta y arranca el agente. Si el agente se
REM detiene por cualquier motivo, lo reinicia automaticamente a los 5 s.
REM Para detenerlo manualmente: cierra esta ventana o pulsa Ctrl+C.
REM ====================================================================
cd /d "%~dp0"
title HIPERA - Agente de impresion

:loop
node index.js
echo.
echo [%date% %time%] El agente se detuvo. Reiniciando en 5 segundos...
echo (Cierra esta ventana para no reiniciar)
timeout /t 5 /nobreak >nul
goto loop

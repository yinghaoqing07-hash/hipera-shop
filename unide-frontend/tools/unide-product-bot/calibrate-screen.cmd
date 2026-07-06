@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0desktop\calibrate-screen.ps1" -WatchSeconds 30
pause

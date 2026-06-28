@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File desktop\calibrate-screen.ps1 -WatchSeconds 30
pause

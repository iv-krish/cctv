@echo off
cd /d "%~dp0"
title CCTV Dashboard (No AI Mode)

echo ========================================================
echo   Starting CCTV Dashboard (Lightweight - No AI Detector)
echo ========================================================

if not exist "logs" mkdir "logs"

set "PATH=%~dp0tools\node;%PATH%"

:: 1. Start go2rtc media engine in minimized window
echo [1/2] Starting go2rtc media engine...
start "CCTV-go2rtc" /min "%~dp0tools\go2rtc\go2rtc.exe" -c "go2rtc.yaml"

ping 127.0.0.1 -n 2 >nul

:: 2. Start Dashboard Web Server in minimized window
echo [2/2] Starting Node.js Web Dashboard...
start "CCTV-Dashboard" /min "%~dp0tools\node\node.exe" --env-file=".env" "server.js"

ping 127.0.0.1 -n 3 >nul

echo.
echo Dashboard launched in low-RAM mode!
echo Opening Dashboard in your browser...
start http://localhost:3000

echo ========================================================
echo   Dashboard: http://localhost:3000
echo   To stop, run: stop-all.bat
echo ========================================================
ping 127.0.0.1 -n 3 >nul

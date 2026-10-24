@echo off
cd /d "%~dp0"
title CCTV Dashboard Launcher

echo ========================================================
echo   Starting CCTV Dashboard (Native Windows)
echo ========================================================

:: Ensure logs directory exists
if not exist "logs" mkdir "logs"

:: Cap log sizes to 5MB each to keep disk usage lean
for %%F in (logs\go2rtc.log logs\dashboard.log logs\detector.log) do (
    if exist "%%F" (
        for %%S in ("%%F") do (
            if %%~zS gtr 5242880 (
                echo [Log rotated - capped at 5MB] > "%%F"
            )
        )
    )
)

:: Set local tools in PATH
set "PATH=%~dp0tools\node;%~dp0detector\venv\Scripts;%PATH%"

:: 1. Start go2rtc media engine in minimized window
echo [1/3] Starting go2rtc media engine...
start "CCTV-go2rtc" /min "%~dp0tools\go2rtc\go2rtc.exe" -c "go2rtc.yaml"

:: Wait for go2rtc to bind port 1984
ping 127.0.0.1 -n 2 >nul

:: 2. Start Dashboard Web Server in minimized window
echo [2/3] Starting Node.js Web Dashboard...
start "CCTV-Dashboard" /min "%~dp0tools\node\node.exe" --env-file=".env" "server.js"

:: Wait for Dashboard to start
ping 127.0.0.1 -n 3 >nul

:: 3. Start AI Detector in minimized window
echo [3/3] Starting YOLO AI Detector...
start "CCTV-Detector" /min "%~dp0detector\venv\Scripts\python.exe" "detector\detector.py"

echo.
echo All services launched!
echo Opening Dashboard in your browser...
ping 127.0.0.1 -n 2 >nul
start http://localhost:3000

echo ========================================================
echo   Dashboard: http://localhost:3000
echo   To stop all services anytime, run: stop-all.bat
echo ========================================================
ping 127.0.0.1 -n 3 >nul

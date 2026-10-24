@echo off
cd /d "%~dp0"
title CCTV Dashboard Stopper

echo ========================================================
echo   Stopping all CCTV Dashboard services...
echo ========================================================

:: Close minimized windows by title
taskkill /F /FI "WINDOWTITLE eq CCTV-go2rtc*" >nul 2>&1
taskkill /F /FI "WINDOWTITLE eq CCTV-Dashboard*" >nul 2>&1
taskkill /F /FI "WINDOWTITLE eq CCTV-Detector*" >nul 2>&1

:: Terminate go2rtc and cloudflared processes
taskkill /F /IM go2rtc.exe >nul 2>&1
taskkill /F /IM cloudflared.exe >nul 2>&1

:: Cleanly free ports 3000 and 1984 if still bound
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3000, 1984 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }" >nul 2>&1

:: Kill any detector python process
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"CommandLine LIKE '%%detector.py%%'\" -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1

echo.
echo [OK] All CCTV Dashboard services have been stopped cleanly.
echo ========================================================
ping 127.0.0.1 -n 2 >nul

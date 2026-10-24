@echo off
cd /d "%~dp0"
title CCTV - Cloudflare Tunnel

echo ========================================================
echo   Starting Cloudflare Quick Tunnel for CCTV Dashboard
echo ========================================================
echo.
echo This creates a temporary public URL for your dashboard.
echo Anyone with the URL can reach your login page.
echo The URL changes every time you restart this tunnel.
echo.
echo Press Ctrl+C to stop the tunnel.
echo ========================================================
echo.

"%~dp0tools\cloudflared\cloudflared.exe" tunnel --url http://127.0.0.1:3000

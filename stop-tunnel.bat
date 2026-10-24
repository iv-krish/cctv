@echo off
cd /d "%~dp0"
title CCTV Tunnel Stopper

echo Stopping Cloudflare Tunnel...
taskkill /F /IM cloudflared.exe >nul 2>&1

echo [OK] Cloudflare Tunnel stopped.
ping 127.0.0.1 -n 2 >nul

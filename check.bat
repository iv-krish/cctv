@echo off
cd /d "%~dp0"
title CCTV Dashboard Self-Test

echo ========================================================
echo   Running CCTV Dashboard Self-Test Checks...
echo ========================================================

set "PATH=%~dp0tools\node;%PATH%"

"%~dp0tools\node\node.exe" --env-file="%~dp0.env" "%~dp0check.js"

echo.
echo ========================================================
echo Self-test completed.
echo ========================================================
pause

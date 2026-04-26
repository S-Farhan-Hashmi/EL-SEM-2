@echo off
title Charge Flow - Startup
echo ============================================
echo   Charge Flow - Starting All Services
echo ============================================
echo.

:: Start Flask backend in a new minimized window
echo [1/2] Starting Flask backend (port 5000)...
start "Charge Flow Backend" /min cmd /k "cd /d "%~dp0backend-ml" && python app.py"

:: Wait a moment for Flask to spin up
echo      Waiting for server to initialize...
timeout /t 3 /nobreak >nul

:: Open the frontend in the default browser
echo [2/2] Opening Charge Flow in browser...
start "" "%~dp0index.html"

echo.
echo ============================================
echo   All services started!
echo   - Backend: http://localhost:5000
echo   - Frontend: Opened in browser
echo.
echo   To stop: close the "Charge Flow Backend"
echo   command window.
echo ============================================
timeout /t 5

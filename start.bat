@echo off
setlocal
cd /d "%~dp0"

echo ==================================================
echo   Neuromicon Studio - Starting Local Server
echo ==================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js was not found in PATH.
    echo Please install Node.js LTS from https://nodejs.org/ and run install.bat first.
    echo.
    pause
    exit /b 1
)

if not exist "node_modules\" (
    echo [INFO] Dependencies not installed yet. Running npm install...
    echo.
    call npm install --legacy-peer-deps
    if errorlevel 1 (
        echo.
        echo [ERROR] Dependency installation failed.
        pause
        exit /b 1
    )
    echo.
)

echo Opening http://localhost:3000 in your default browser...
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:3000"

echo Starting Vite dev server on port 3000 (press Ctrl+C to stop)...
echo.
call npm run dev
if errorlevel 1 (
    echo.
    echo [ERROR] Server stopped with an error.
    pause
    exit /b 1
)

pause

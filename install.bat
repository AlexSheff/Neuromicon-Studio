@echo off
setlocal
cd /d "%~dp0"

echo ==================================================
echo   Neuromicon Studio - Windows Setup
echo ==================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js was not found in PATH.
    echo Please install Node.js LTS from https://nodejs.org/ and try again.
    echo.
    pause
    exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm was not found in PATH.
    echo Please reinstall Node.js LTS from https://nodejs.org/ and try again.
    echo.
    pause
    exit /b 1
)

for /f "delims=" %%v in ('node -v') do set NODE_VER=%%v
for /f "delims=" %%v in ('npm -v') do set NPM_VER=%%v
echo Node.js: %NODE_VER%
echo npm:     %NPM_VER%
echo.
echo Installing dependencies...
echo.

call npm install --legacy-peer-deps
if errorlevel 1 (
    echo.
    echo [ERROR] Dependency installation failed.
    pause
    exit /b 1
)

echo.
echo ==================================================
echo   Installation complete!
echo   Run start.bat to launch Neuromicon Studio.
echo ==================================================
echo.
pause

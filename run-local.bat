@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or later is required.
  echo Download it from https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing required packages for the first run...
  call npm install
  if errorlevel 1 (
    echo Installation failed. Check the internet connection.
    pause
    exit /b 1
  )
)

start "" cmd /c "timeout /t 5 /nobreak >nul & start http://localhost:3000/"
echo CRX Lab is starting at http://localhost:3000/
echo Press Ctrl+C to stop.
call npm run dev

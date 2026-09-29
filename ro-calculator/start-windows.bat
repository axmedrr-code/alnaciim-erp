@echo off
REM RO System Engineering Calculator - Windows launcher
REM Double-click this file. First run installs dependencies and builds the app (internet needed once).
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install Node.js 22 LTS from https://nodejs.org and run this file again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies - this is needed only once...
  call npm install
  if errorlevel 1 (
    echo npm install failed. See the messages above.
    pause
    exit /b 1
  )
)

if not exist dist\client\index.html (
  echo Building the user interface...
  call npm run build
  if errorlevel 1 (
    echo Build failed. See the messages above.
    pause
    exit /b 1
  )
)

echo Starting RO System Engineering Calculator at http://localhost:3000
start "" cmd /c "timeout /t 4 /nobreak >nul & start http://localhost:3000"
call npm start
pause

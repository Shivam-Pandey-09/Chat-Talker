@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install the current LTS version from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)
if not exist node_modules\next\package.json (
  echo Installing ChatTalker dependencies for the first time...
  call npm install
  if errorlevel 1 (
    echo.
    echo Dependency installation failed. Check your internet connection, then try again.
    pause
    exit /b 1
  )
)
start "ChatTalker" cmd /c "timeout /t 2 /nobreak ^>nul ^& start http://localhost:3000"
call npm run dev

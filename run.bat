@echo off
setlocal

echo [1/3] Checking for Bun...
where bun >nul 2>nul
if %errorlevel% neq 0 (
  echo ERROR: Bun is not installed or not on PATH.
  echo Install Bun, then run this script again.
  exit /b 1
)

echo [2/3] Building project...
bun run build
if %errorlevel% neq 0 (
  echo ERROR: Build failed.
  exit /b 1
)

echo [3/3] Starting preview server...
bun run preview

endlocal

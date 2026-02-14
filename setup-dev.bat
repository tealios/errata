@echo off
setlocal enabledelayedexpansion

echo [1/4] Checking for Bun...
where bun >nul 2>nul
if %errorlevel% neq 0 (
  echo Bun was not found on PATH.
  echo [2/4] Installing Bun with winget...

  where winget >nul 2>nul
  if %errorlevel% neq 0 (
    echo ERROR: winget is not available on this machine.
    echo Please install Bun manually from https://bun.sh and run this script again.
    exit /b 1
  )

  winget install --id Oven-sh.Bun -e --source winget --accept-package-agreements --accept-source-agreements
  if %errorlevel% neq 0 (
    echo ERROR: Bun installation failed.
    exit /b 1
  )

  rem Try common Bun install locations in case PATH is not refreshed yet.
  if exist "%USERPROFILE%\.bun\bin\bun.exe" set "PATH=%USERPROFILE%\.bun\bin;%PATH%"
  if exist "%ProgramFiles%\Bun\bin\bun.exe" set "PATH=%ProgramFiles%\Bun\bin;%PATH%"

  where bun >nul 2>nul
  if %errorlevel% neq 0 (
    echo ERROR: Bun installed, but this shell cannot find it yet.
    echo Open a new terminal and run setup-dev.bat again.
    exit /b 1
  )
) else (
  echo Bun is already installed.
)

echo [3/4] Installing dependencies...
bun install
if %errorlevel% neq 0 (
  echo ERROR: bun install failed.
  exit /b 1
)

echo [4/4] Starting dev server...
bun run dev

endlocal

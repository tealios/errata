@echo off
setlocal enabledelayedexpansion

echo [1/3] Checking for Bun...
where bun >nul 2>nul
if %errorlevel% neq 0 (
  echo ERROR: Bun is not installed or not on PATH.
  echo Install Bun, then run this script again.
  exit /b 1
)

set "NEEDS_BUILD=0"

where git >nul 2>nul
if %errorlevel% equ 0 (
  if exist ".git" (
    rem Capture HEAD before pull
    for /f %%h in ('git rev-parse HEAD') do set "OLD_HEAD=%%h"

    set /p PULL="Pull latest changes from git? [Y/n] "
    if /i "!PULL!" neq "n" (
      git pull --ff-only
      for /f %%h in ('git rev-parse HEAD') do set "NEW_HEAD=%%h"
      if not "!OLD_HEAD!"=="!NEW_HEAD!" (
        echo Changes pulled, rebuild needed.
        set "NEEDS_BUILD=1"
      )
    )
  )
)

rem Build if .output doesn't exist yet
if not exist ".output" (
  echo No build output found, build needed.
  set "NEEDS_BUILD=1"
)

if "!NEEDS_BUILD!"=="1" (
  echo [2/3] Building project...
  bun run build
  if %errorlevel% neq 0 (
    echo ERROR: Build failed.
    exit /b 1
  )
) else (
  echo [2/3] Build is up to date, skipping.
)

echo [3/3] Starting preview server...
bun run preview

endlocal

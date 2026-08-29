@echo off
setlocal

cd /d "%~dp0"

set "PORT=%~1"
if "%PORT%"=="" set "PORT=8084"
set "URL=http://127.0.0.1:%PORT%"

echo ============================================================
echo PREVENT - Inicio local
echo Puerto: %PORT%
echo URL: %URL%
echo ============================================================
echo.

start "PREVENT" powershell -ExecutionPolicy Bypass -File ".\start_prevent_local.ps1" -Port %PORT%

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$url = '%URL%/api'; " ^
  "$ok = $false; " ^
  "for ($i = 0; $i -lt 20; $i++) { " ^
  "  try { Invoke-WebRequest -UseBasicParsing $url -TimeoutSec 2 | Out-Null; $ok = $true; break } catch { Start-Sleep -Seconds 1 } " ^
  "}; " ^
  "if (-not $ok) { exit 1 }"

set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
    echo.
    echo PREVENT no respondio a tiempo en %URL%.
    echo Revise la ventana del servidor para ver el error.
    pause
    exit /b %EXIT_CODE%
)

start "" "%URL%"
exit /b 0

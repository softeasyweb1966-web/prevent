@echo off
setlocal

cd /d "%~dp0"

set "PORT=%~1"
if "%PORT%"=="" set "PORT=8084"

echo ============================================================
echo PREVENT - Detener aplicativo
echo Puerto: %PORT%
echo ============================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$port = %PORT%; " ^
  "$conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; " ^
  "if (-not $conn) { Write-Host 'No se encontro ningun proceso escuchando en ese puerto.'; exit 1 }; " ^
  "$proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue; " ^
  "if (-not $proc) { Write-Host 'Se encontro el puerto, pero no fue posible resolver el proceso.'; exit 1 }; " ^
  "Stop-Process -Id $conn.OwningProcess -Force; " ^
  "Write-Host ('Proceso detenido: PID ' + $conn.OwningProcess + ' (' + $proc.ProcessName + ')')"

set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
    echo.
    echo No fue posible detener PREVENT en el puerto %PORT%.
    pause
)

exit /b %EXIT_CODE%

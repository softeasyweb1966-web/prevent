param(
    [string]$Port = "8080",
    [string]$DatabaseUrl = "",
    [ValidateSet("development", "production")]
    [string]$Environment = "production"
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

$pythonExe = Join-Path $projectRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $pythonExe)) {
    throw "No se encontro $pythonExe. Revisa que la .venv exista antes de arrancar PREVENT."
}

if (-not $DatabaseUrl) {
    $DatabaseUrl = $env:DATABASE_URL
}

if (-not $DatabaseUrl) {
    $DatabaseUrl = "postgresql+psycopg2://postgres:PreventPg2026Local1@127.0.0.1:5432/prevent_utf8"
}

$env:DATABASE_URL = $DatabaseUrl
$env:FLASK_ENV = $Environment
$env:PORT = $Port

Write-Host ""
Write-Host "============================================================"
Write-Host "PREVENT - Arranque local"
Write-Host "============================================================"
Write-Host "Entorno : $Environment"
Write-Host "Puerto  : $Port"
Write-Host "Base    : PostgreSQL local"
Write-Host "URL DB  : $($DatabaseUrl -replace '://([^:]+):([^@]+)@', '://$1:***@')"
Write-Host "============================================================"
Write-Host ""

& $pythonExe ".\run.py"

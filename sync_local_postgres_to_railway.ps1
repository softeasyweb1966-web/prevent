param(
    [string]$LocalDatabaseUrl = "",
    [string]$RailwayDatabaseUrl = "",
    [string]$BackupDir = "",
    [switch]$SkipSqliteRemainder,
    [switch]$KeepTargetData
)

$ErrorActionPreference = "Stop"

function Mask-DbUrl {
    param([string]$Url)

    if (-not $Url) {
        return "(sin definir)"
    }

    return ($Url -replace '://([^:]+):([^@]+)@', '://$1:***@')
}

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

$pythonExe = Join-Path $projectRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $pythonExe)) {
    throw "No se encontro $pythonExe. Revisa que la .venv exista antes de sincronizar."
}

if (-not $LocalDatabaseUrl) {
    $LocalDatabaseUrl = $env:LOCAL_DATABASE_URL
}

if (-not $RailwayDatabaseUrl) {
    $RailwayDatabaseUrl = $env:RAILWAY_DATABASE_URL
}

if (-not $LocalDatabaseUrl) {
    $LocalDatabaseUrl = "postgresql+psycopg2://postgres:PreventPg2026Local1@127.0.0.1:5432/prevent_utf8"
}

if (-not $RailwayDatabaseUrl) {
    throw "Debes enviar -RailwayDatabaseUrl o definir RAILWAY_DATABASE_URL."
}

Write-Host ""
Write-Host "============================================================"
Write-Host "PREVENT - Sincronizacion PostgreSQL local -> Railway"
Write-Host "============================================================"
Write-Host "Origen local : $(Mask-DbUrl $LocalDatabaseUrl)"
Write-Host "Destino web  : $(Mask-DbUrl $RailwayDatabaseUrl)"
if ($BackupDir) {
    Write-Host "Backup       : reutilizar $BackupDir"
} else {
    Write-Host "Backup       : se generara uno nuevo desde la BD local"
}
Write-Host "Limpiar web  : $([bool](-not $KeepTargetData))"
Write-Host "SQLite extra : $([bool](-not $SkipSqliteRemainder))"
Write-Host "============================================================"
Write-Host ""

if (-not $BackupDir) {
    Write-Host "[1/4] Creando respaldo logico desde la base local..."
    $backupOutput = & $pythonExe ".\backup_postgres_logical.py" --database-url $LocalDatabaseUrl --output-root ".\backups" 2>&1
    $backupOutput | ForEach-Object { Write-Host $_ }
    if ($LASTEXITCODE -ne 0) {
        throw "Fallo la creacion del respaldo logico."
    }

    $backupLine = $backupOutput | Where-Object { $_ -like "BACKUP_DIR=*" } | Select-Object -Last 1
    if (-not $backupLine) {
        throw "No se pudo identificar la ruta del respaldo generado."
    }

    $BackupDir = $backupLine.ToString().Substring("BACKUP_DIR=".Length).Trim()
}

if (-not (Test-Path $BackupDir)) {
    throw "No existe el directorio de respaldo indicado: $BackupDir"
}

$env:DATABASE_URL = $RailwayDatabaseUrl
$env:FLASK_ENV = "production"

Write-Host ""
Write-Host "[2/4] Aplicando migraciones en la base de Railway..."
$flaskArgs = @("-m", "flask", "--app", ".\run.py", "db", "upgrade")
& $pythonExe @flaskArgs
if ($LASTEXITCODE -ne 0) {
    throw "Fallo la migracion hacia Railway."
}

Write-Host ""
Write-Host "[3/4] Restaurando el respaldo en Railway..."
$restoreArgs = @(
    ".\restore_postgres_logical.py",
    "--backup-dir", $BackupDir,
    "--target-url", $RailwayDatabaseUrl
)
if (-not $KeepTargetData) {
    $restoreArgs += "--clean-target"
}
& $pythonExe @restoreArgs
if ($LASTEXITCODE -ne 0) {
    throw "Fallo la restauracion del respaldo en Railway."
}

if (-not $SkipSqliteRemainder) {
    Write-Host ""
    Write-Host "[4/4] Migrando remanente que aun exista solo en SQLite..."
    $sqliteArgs = @(
        ".\migrar_sqlite_restante_a_postgres.py",
        "--target-url", $RailwayDatabaseUrl
    )
    & $pythonExe @sqliteArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Fallo la migracion complementaria desde SQLite."
    }
} else {
    Write-Host ""
    Write-Host "[4/4] Paso SQLite omitido por solicitud."
}

Write-Host ""
Write-Host "Sincronizacion finalizada."
Write-Host "Respaldo usado: $BackupDir"
Write-Host "Reporte restore: .\restore_postgres_report.txt"
Write-Host "Reporte SQLite : .\sqlite_restante_a_postgres_report.txt"

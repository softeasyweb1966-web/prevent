# PostgreSQL Desde Este Equipo

## Base recomendada

La base mas solida disponible en este equipo es el respaldo:

`backups/pg_logical_backup_20260325_031434`

Ese backup corresponde a la informacion que estuvo en PostgreSQL y trae mas historico operativo que la `SQLite` local.

## 1. Definir la URL de PostgreSQL

Ejemplo para PostgreSQL local:

```powershell
$env:DATABASE_URL = "postgresql+psycopg2://postgres:TU_PASSWORD@localhost:5432/prevent"
```

Ejemplo para nube:

```powershell
$env:DATABASE_URL = "postgresql+psycopg2://usuario:password@host:puerto/base?sslmode=require"
```

## 2. Crear el esquema actual del proyecto

```powershell
cmd /c .venv\Scripts\python.exe -m flask --app .\run.py db upgrade
```

## 3. Restaurar el backup solido

```powershell
.\.venv\Scripts\python.exe .\restore_postgres_logical.py --backup-dir .\backups\pg_logical_backup_20260325_031434
```

Si la base destino ya tiene datos y quieres reemplazarlos:

```powershell
.\.venv\Scripts\python.exe .\restore_postgres_logical.py --backup-dir .\backups\pg_logical_backup_20260325_031434 --clean-target
```

## 4. Arrancar la app contra PostgreSQL

```powershell
cmd /c .venv\Scripts\python.exe .\run.py
```

## Nota importante

El backup solido no trae las pruebas recientes del modulo Comercial de abril de 2026.  
La recomendacion es restaurar primero este backup y luego volver a digitar esas pruebas comerciales.

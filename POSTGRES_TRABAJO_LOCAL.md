# PostgreSQL Desde Este Equipo

## Base recomendada

La base mas solida disponible en este equipo es el respaldo:

`backups/pg_logical_backup_20260325_031434`

Ese backup corresponde a la informacion que estuvo en PostgreSQL y trae mas historico operativo que la `SQLite` local.

## Cambio importante

PREVENT ya no debe arrancar con SQLite.

Ahora la app exige `DATABASE_URL` valida de PostgreSQL para iniciar.  
Si no existe, la aplicacion falla de forma explicita para evitar volver a trabajar por error sobre SQLite.

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

## 3.1 Migrar lo restante que hoy solo exista en SQLite

Despues de restaurar la base historica de PostgreSQL, este paso sirve para subir a PostgreSQL
las tablas que hoy siguen en SQLite y que en el destino aun esten vacias.

```powershell
.\.venv\Scripts\python.exe .\migrar_sqlite_restante_a_postgres.py
```

Si quieres limitarlo a tablas concretas:

```powershell
.\.venv\Scripts\python.exe .\migrar_sqlite_restante_a_postgres.py --tables clientes_comerciales,clientes_comerciales_tarifas,clientes_atenciones,clientes_atenciones_detalle,clientes_seguimiento_documentos,clientes_seguimiento_pagos,comercial_catalogo_items,comercial_paquetes_detalle,vendedores
```

## 4. Arrancar la app contra PostgreSQL

```powershell
cmd /c .venv\Scripts\python.exe .\run.py
```

## 5. Ver con que informacion contamos en PostgreSQL

Para sacar un inventario rapido de tablas y conteos:

```powershell
.\.venv\Scripts\python.exe .\ver_postgres_resumen.py
```

Ese comando:
- muestra conteo general por tabla
- muestra resumen especifico del modulo comercial
- y guarda un archivo `postgres_resumen.json`

## Nota importante

El backup solido no trae las pruebas recientes del modulo Comercial de abril de 2026.  
Ahora ya existe tambien un paso intermedio para pasar automaticamente a PostgreSQL
todo lo que siga estando solo en SQLite y cuya tabla destino siga vacia.

## Aclaracion sobre SQLite

PREVENT ya no usa SQLite en el runtime normal, ni en desarrollo, porque ahora exige
una `DATABASE_URL` valida de PostgreSQL para iniciar.

Las referencias que todavia quedan a SQLite son solo:
- scripts de migracion historica
- reportes viejos
- logs antiguos

Esas referencias no significan que la app siga funcionando sobre SQLite.

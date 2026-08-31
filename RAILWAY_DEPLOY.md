# Railway: subir codigo y reemplazar datos con tu version local

## Idea clave

En Railway hay que tratar **codigo** y **datos** por separado:

- El codigo se actualiza cuando haces `git push` al repo que Railway esta desplegando.
- La base de datos **no** se reemplaza solo por subir codigo.
- Los adjuntos en disco tampoco se conservan si no usas un volumen persistente.

## Lo que ya queda preparado en este repo

- `railway.json`
  - corre `flask db upgrade` antes de cada deploy
  - arranca la app con `gunicorn`
- `app/config.py`
  - ahora acepta `UPLOAD_FOLDER` por variable de entorno para poder usar un volumen en Railway

## Paso 1. Verifica que Railway apunte a PostgreSQL

Este proyecto ya exige PostgreSQL por `DATABASE_URL`.

En el servicio web de Railway configura:

```text
DATABASE_URL=${{Postgres.DATABASE_URL}}
FLASK_ENV=production
SESSION_COOKIE_SECURE=true
```

Si el servicio PostgreSQL de Railway tiene otro nombre distinto a `Postgres`, usa el nombre real de ese servicio.

## Paso 2. Configura adjuntos persistentes

La app guarda archivos subidos. En Railway no conviene dejarlos dentro del contenedor sin volumen.

Haz esto en Railway:

1. Crea o adjunta un Volume al servicio web.
2. Montalo en `/data`.
3. Agrega esta variable:

```text
UPLOAD_FOLDER=/data/uploads
```

## Paso 3. Sube el codigo local

Railway normalmente despliega desde GitHub. En este repo el remoto es:

`https://github.com/softeasyweb1966-web/prevent.git`

Entonces los cambios locales deben llegar al branch desplegado:

```powershell
git add .
git commit -m "Actualiza PREVENT para Railway"
git push origin main
```

Con eso Railway tomara el codigo nuevo y ejecutara la migracion antes de arrancar.

## Paso 4. Reemplaza la base de datos web con tu version local

Si quieres que la base de Railway quede como la que tienes local, no basta con deploy.
Tienes que exportar tu PostgreSQL local y restaurarlo en la base PostgreSQL de Railway.

### Opcion rapida: copiar la BD local completa hacia Railway

Si lo que quieres es que la web quede igual a tu PostgreSQL local actual, ya puedes hacerlo con un solo script:

```powershell
$env:RAILWAY_DATABASE_URL = "postgresql://usuario:password@host:puerto/base?sslmode=require"
.\sync_local_postgres_to_railway.ps1
```

Ese flujo hace esto:

1. crea un backup logico nuevo desde tu PostgreSQL local
2. corre `db upgrade` contra Railway
3. reemplaza la base web con `--clean-target`
4. migra a Railway cualquier remanente que aun exista solo en `instance\prevent.db`

Si ya tienes un backup exacto que quieres reutilizar:

```powershell
.\sync_local_postgres_to_railway.ps1 -RailwayDatabaseUrl "postgresql://usuario:password@host:puerto/base?sslmode=require" -BackupDir ".\backups\pg_logical_backup_20260830_163128"
```

### 4.1 Crear backup logico desde tu PostgreSQL local

Primero apunta `DATABASE_URL` a tu PostgreSQL local:

```powershell
$env:DATABASE_URL = "postgresql+psycopg2://postgres:TU_PASSWORD_LOCAL@127.0.0.1:5432/prevent_utf8"
.\.venv\Scripts\python.exe .\backup_postgres_logical.py
```

Ese comando te crea una carpeta nueva dentro de `backups\pg_logical_backup_YYYYMMDD_HHMMSS`.

### 4.2 Apuntar al PostgreSQL de Railway

Luego cambia `DATABASE_URL` a la base de Railway.

Usa la URL publica del Postgres de Railway, normalmente con SSL:

```powershell
$env:DATABASE_URL = "postgresql://usuario:password@host:puerto/base?sslmode=require"
```

### 4.3 Crear el esquema actual en Railway

```powershell
cmd /c .venv\Scripts\python.exe -m flask --app .\run.py db upgrade
```

### 4.4 Restaurar y reemplazar datos en Railway

```powershell
.\.venv\Scripts\python.exe .\restore_postgres_logical.py --backup-dir .\backups\NOMBRE_DEL_BACKUP --clean-target
```

`--clean-target` vacia primero la base destino. Ese es el paso que realmente "reemplaza lo de la web".

## Paso 5. Si todavia hay datos que solo existen en SQLite local

Este repo tambien tiene un paso complementario para migrar tablas que aun esten solo en `instance\prevent.db`:

```powershell
.\.venv\Scripts\python.exe .\migrar_sqlite_restante_a_postgres.py
```

Hazlo solo despues de que `DATABASE_URL` siga apuntando a Railway PostgreSQL.

## Orden recomendado para no romper produccion

1. Confirmar que Railway tenga servicio PostgreSQL.
2. Configurar `DATABASE_URL`, `FLASK_ENV` y `UPLOAD_FOLDER`.
3. Adjuntar volumen para `/data`.
4. Hacer `git push origin main`.
5. Crear backup de tu PostgreSQL local.
6. Ejecutar `db upgrade` contra Railway.
7. Restaurar backup en Railway con `--clean-target`.
8. Si aplica, correr `migrar_sqlite_restante_a_postgres.py`.
9. Validar login, usuarios, comercial, adjuntos y reportes.

## Importante

- Si solo haces deploy, Railway actualiza codigo, no datos.
- Si solo restauras datos sin correr migraciones, pueden faltar columnas o tablas nuevas.
- Si no montas volumen, los adjuntos subidos al servidor pueden perderse al redeployar.

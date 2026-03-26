# Migraciones seguras en PostgreSQL / Railway

Este proyecto ya usa `Flask-Migrate` y queda preparado para trabajar con una
base de datos PostgreSQL existente en Railway.

## Principios

- No usar `db.create_all()` en produccion para cambios estructurales.
- Siempre respaldar la base productiva antes de una migracion.
- Probar primero en una base espejo de staging.
- Aplicar cambios con `flask db upgrade` junto con el despliegue.

## Variables importantes

- `DATABASE_URL`: cadena de conexion PostgreSQL.
- `FLASK_ENV=production`: entorno de Railway / produccion.
- `AUTO_CREATE_TABLES=false`: recomendado en produccion.
- `AUTO_SEED_ADMIN=false`: recomendado en produccion.

## Entry point para Flask

Usar `wsgi:app` para comandos de Flask:

```powershell
python -m flask --app wsgi:app routes
python -m flask --app wsgi:app db init
python -m flask --app wsgi:app db migrate -m "descripcion"
python -m flask --app wsgi:app db upgrade
```

## Flujo recomendado para una base existente

1. Sacar backup de produccion.
2. Restaurar backup en staging.
3. Comparar el esquema real de PostgreSQL contra los modelos actuales.
4. Crear la migracion correspondiente.
5. Ejecutar `db upgrade` en staging y validar datos.
6. Desplegar el codigo a Railway.
7. Ejecutar `db upgrade` en produccion.

## Nota operativa

`init-db` y `seed-admin` quedan disponibles como comandos manuales para
entornos locales o controlados. No deben ser el mecanismo principal de
despliegue en produccion.

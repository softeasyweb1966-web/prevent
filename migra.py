from app import create_app
from app.models import db, Usuario, Role, Empleado, TipoNovedad, ConceptoAutomatico

import sqlite3

# ✅ BASE REAL
SQLITE_PATH = "prevent.db"

sqlite_conn = sqlite3.connect(SQLITE_PATH)
sqlite_cursor = sqlite_conn.cursor()

app = create_app("production")

with app.app_context():

    print("🔹 Migrando ROLES...")
    sqlite_cursor.execute("SELECT * FROM roles")
    for r in sqlite_cursor.fetchall():
        if not Role.query.get(r[0]):
            db.session.add(Role(id=r[0], nombre=r[1], descripcion=r[2]))

    print("🔹 Migrando USUARIOS...")
    sqlite_cursor.execute("SELECT * FROM usuarios")
    for u in sqlite_cursor.fetchall():
        if not Usuario.query.get(u[0]):
            db.session.add(Usuario(
                id=u[0],
                usuario=u[1],
                email=u[2],
                nombre_completo=u[3],
                password_hash=u[4],
                role_id=u[5],
                activo=u[6]
            ))

    print("🔹 Migrando EMPLEADOS...")
    sqlite_cursor.execute("SELECT * FROM empleados")
    for e in sqlite_cursor.fetchall():
        if not Empleado.query.get(e[0]):
            db.session.add(Empleado(
                id=e[0],
                nombre=e[1],
                documento=e[2],
                cargo=e[3],
                salario=e[4],
                activo=e[5]
            ))

    print("🔹 Migrando TIPOS NOVEDAD...")
    sqlite_cursor.execute("SELECT * FROM tipos_novedad")
    for t in sqlite_cursor.fetchall():
        if not TipoNovedad.query.get(t[0]):
            db.session.add(TipoNovedad(
                id=t[0],
                nombre=t[1],
                tipo_movimiento=t[2],
                requiere_autorizacion=t[3],
                descripcion=t[4]
            ))

    print("🔹 Migrando CONCEPTOS AUTOMÁTICOS...")
    sqlite_cursor.execute("SELECT * FROM conceptos_automaticos")
    for c in sqlite_cursor.fetchall():
        if not ConceptoAutomatico.query.get(c[0]):
            db.session.add(ConceptoAutomatico(
                id=c[0],
                nombre=c[1],
                tipo=c[2],
                anio=c[3],
                porcentaje=c[4]
            ))

    db.session.commit()

print("✅ MIGRACIÓN TERMINADA")
from app import create_app
from app.models import db
import sqlite3
from sqlalchemy import text

SQLITE_PATH = "prevent.db"

sqlite_conn = sqlite3.connect(SQLITE_PATH)
sqlite_cursor = sqlite_conn.cursor()

# 🔥 detectar tablas reales
sqlite_cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
tablas = [t[0] for t in sqlite_cursor.fetchall()]

print("📦 TABLAS EN SQLITE:")
for t in tablas:
    print(" -", t)

app = create_app("production")

with app.app_context():

    for tabla in tablas:

        print(f"\n🚀 Migrando {tabla}...")

        sqlite_cursor.execute(f"SELECT * FROM {tabla}")
        filas = sqlite_cursor.fetchall()

        if not filas:
            print("   (vacía)")
            continue

        columnas = [desc[0] for desc in sqlite_cursor.description]

        for fila in filas:

            valores = dict(zip(columnas, fila))

            columnas_sql = ", ".join(valores.keys())
            params_sql = ", ".join([f":{k}" for k in valores.keys()])

            sql = text(f"INSERT INTO {tabla} ({columnas_sql}) VALUES ({params_sql})")

            try:
                db.session.execute(sql, valores)
            except Exception as e:
                print("⚠️ error:", e)

        db.session.commit()

print("\n✅ MIGRACIÓN COMPLETA TERMINADA")
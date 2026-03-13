import os
import mimetypes
import platform

# Evitar que mimetypes lea el registro de Windows
try:
    mimetypes.init([])
except Exception:
    pass

# Evitar problemas con platform.win32_ver en algunos entornos
if os.name == "nt":
    try:
        def _safe_win32_ver():
            return ("10", "0", "", "")
        platform.win32_ver = _safe_win32_ver
    except Exception:
        pass


if __name__ == "__main__":
    import json

    # Importar app aquí (evita problemas en Railway)
    from app import create_app

    # ✅ Crear aplicación (SIN migración automática)
    app = create_app(os.getenv("FLASK_ENV", "production"))

    # Importar db y modelos después de crear la app
    from app.models import db, Usuario, Role, Permiso, Empleado, TipoNovedad, ConceptoAutomatico
    from werkzeug.security import generate_password_hash

    @app.shell_context_processor
    def make_shell_context():
        return {
            "db": db,
            "Usuario": Usuario,
            "Role": Role,
            "Permiso": Permiso,
            "Empleado": Empleado,
            "TipoNovedad": TipoNovedad,
            "ConceptoAutomatico": ConceptoAutomatico
        }

    # INFO AL INICIAR
    info = {
        "mensaje": "Bienvenido a PREVENT",
        "version": "0.1.0",
        "status": "OK",
        "endpoints": {
            "auth": "/api/auth",
            "dashboard": "/api/dashboard",
            "nomina": "/api/nomina",
            "usuarios": "/api/usuarios"
        }
    }

    print("\n" + "=" * 60)
    print("PREVENT - SISTEMA DE GESTION INTEGRAL PARA IPS")
    print("=" * 60)
    print(json.dumps(info, indent=2, ensure_ascii=False))
    print("=" * 60)

    # 🚀 IMPORTANTE PARA RAILWAY
    port = int(os.environ.get("PORT", 8080))

    # 🔥 crear admin automáticamente (solo si no existe)
    with app.app_context():
        db.create_all()

        admin_role = Role.query.filter_by(nombre="Administrador").first()
        if not admin_role:
            admin_role = Role(nombre="Administrador", descripcion="Acceso total")
            db.session.add(admin_role)
            db.session.commit()

        if not Usuario.query.filter_by(usuario="admin").first():
            admin = Usuario(
                usuario="admin",
                email="admin@test.com",
                nombre_completo="Administrador",
                password_hash=generate_password_hash("admin123"),
                role_id=admin_role.id,
                activo=True
            )
            db.session.add(admin)
            db.session.commit()
            print("✅ admin creado")

    app.run(
        host="0.0.0.0",
        port=port,
        debug=False
    )
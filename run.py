import json
import mimetypes
import os
import platform

from app import create_app


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


app = create_app(os.getenv("FLASK_ENV", "production"))


if __name__ == "__main__":
    info = {
        "mensaje": "Bienvenido a PREVENT",
        "version": "0.1.0",
        "status": "OK",
        "endpoints": {
            "auth": "/api/auth",
            "dashboard": "/api/dashboard",
            "nomina": "/api/nomina",
            "usuarios": "/api/usuarios",
        },
    }

    print("\n" + "=" * 60)
    print("PREVENT - SISTEMA DE GESTION INTEGRAL PARA IPS")
    print("=" * 60)
    print(json.dumps(info, indent=2, ensure_ascii=False))
    print("=" * 60)

    port = int(os.environ.get("PORT", 8080))
    app.run(
        host="0.0.0.0",
        port=port,
        debug=False,
    )

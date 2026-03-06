import os
import mimetypes
from dotenv import load_dotenv
import platform

# Evitar que `mimetypes` lea el registro de Windows (puede bloquear/levantar
# excepciones en algunos entornos). Inicializamos con una lista vacía para
# usar solo la tabla interna y no acceder al registro.
try:
    mimetypes.init([])
except (Exception, KeyboardInterrupt):
    # Si falla no es crítico; continuar con la importación normal
    pass

# Evitar que llamadas internas a `platform.win32_ver()` intenten ejecutar
# comandos del sistema en entornos donde esto puede bloquear (al importar
# librerías como SQLAlchemy). Sobrescribimos la función en Windows por una
# versión segura que devuelve valores por defecto sin lanzar subprocess.
if os.name == 'nt':
    try:
        def _safe_win32_ver():
            # Devolver una tupla (release, version, csd, ptype)
            return ('10', '0', '', '')
        platform.win32_ver = _safe_win32_ver
    except Exception:
        # Si no se puede sobrescribir, continuar normalmente
        pass


# Cargar variables de entorno
load_dotenv()


if __name__ == '__main__':
    import json

    # Importar la aplicación aquí para evitar imports pesados durante la
    # carga del módulo (evita bloqueos en algunos entornos Windows)
    from app import create_app

    # Crear aplicación
    app = create_app(os.getenv('FLASK_ENV', 'development'))

    # Importar db y modelos después de crear la app para que estén
    # disponibles en el contexto de la aplicación sin exponerlos al
    # import-time del módulo.
    from app.models import db, Usuario, Role, Permiso, Empleado, TipoNovedad, ConceptoAutomatico

    @app.shell_context_processor
    def make_shell_context():
        return {
            'db': db,
            'Usuario': Usuario,
            'Role': Role,
            'Permiso': Permiso,
            'Empleado': Empleado,
            'TipoNovedad': TipoNovedad,
            'ConceptoAutomatico': ConceptoAutomatico
        }

    @app.cli.command()
    def init_db():
        """Inicializar base de datos con datos por defecto"""
        print("Inicializando base de datos...")
        
        with app.app_context():
            # Crear tablas
            db.create_all()
            
            # Crear roles si no existen
            if not Role.query.filter_by(nombre='Administrador').first():
                admin_role = Role(nombre='Administrador', descripcion='Acceso total al sistema')
                db.session.add(admin_role)
            
            if not Role.query.filter_by(nombre='Gerente').first():
                gerente_role = Role(nombre='Gerente', descripcion='Acceso a módulos principales')
                db.session.add(gerente_role)
            
            if not Role.query.filter_by(nombre='Usuario').first():
                usuario_role = Role(nombre='Usuario', descripcion='Acceso limitado')
                db.session.add(usuario_role)
            
            # Crear tipos de novedad por defecto
            tipos_novedad_default = [
                ('Anticipo', 'CREDITO', False, 'Anticipo de salario'),
                ('Préstamo', 'CREDITO', True, 'Préstamo a empleado'),
                ('Hora Extra', 'DEBITO', False, 'Hora extra autorizada'),
                ('Incapacidad', 'DEBITO', True, 'Incapacidad médica'),
                ('Licencia', 'DEBITO', True, 'Licencia autorizada'),
                ('Pensión', 'CREDITO', False, 'Aporte pensión (automático)'),
                ('Salud', 'CREDITO', False, 'Aporte salud (automático)'),
                ('Caja Compensación', 'CREDITO', False, 'Caja de compensación (automático)')
            ]
            
            for nombre, tipo, requiere_auth, desc in tipos_novedad_default:
                if not TipoNovedad.query.filter_by(nombre=nombre).first():
                    tipo_novedad = TipoNovedad(
                        nombre=nombre,
                        tipo_movimiento=tipo,
                        requiere_autorizacion=requiere_auth,
                        descripcion=desc
                    )
                    db.session.add(tipo_novedad)
            
            # Crear conceptos automáticos
            year = 2025
            conceptos_default = [
                ('Pensión', 'PENSION', year, 4.0),
                ('Salud', 'SALUD', year, 8.5),
                ('Caja Compensación', 'CAJA_COMPENSACION', year, 4.0)
            ]
            
            for nombre, tipo, anio, porcentaje in conceptos_default:
                if not ConceptoAutomatico.query.filter_by(nombre=nombre, anio=year).first():
                    concepto = ConceptoAutomatico(
                        nombre=nombre,
                        tipo=tipo,
                        anio=anio,
                        porcentaje=porcentaje
                    )
                    db.session.add(concepto)
            
            db.session.commit()
            print("✓ Base de datos inicializada correctamente")

    @app.cli.command()
    def create_admin():
        """Crear usuario administrador"""
        print("Crear usuario administrador...")
        
        with app.app_context():
            usuario = input("Ingrese nombre de usuario: ")
            email = input("Ingrese email: ")
            password = input("Ingrese contraseña: ")
            nombre = input("Ingrese nombre completo: ")
            
            if Usuario.query.filter_by(usuario=usuario).first():
                print("✗ El usuario ya existe")
                return
            
            from werkzeug.security import generate_password_hash
            
            admin_role = Role.query.filter_by(nombre='Administrador').first()
            if not admin_role:
                print("✗ Primero debe inicializar la BD con 'flask init-db'")
                return
            
            nuevo_usuario = Usuario(
                usuario=usuario,
                email=email,
                nombre_completo=nombre,
                password_hash=generate_password_hash(password),
                role_id=admin_role.id,
                activo=True
            )
            
            db.session.add(nuevo_usuario)
            db.session.commit()
            
            print(f"✓ Usuario administrador '{usuario}' creado correctamente")
    
    # Mostrar información del sistema al iniciar
    info = {
        "mensaje": "Bienvenido a PREVENT",
        "version": "0.1.0",
        "status": "OK",
        "endpoints": {
            "auth": "/api/auth",
            "dashboard": "/api/dashboard",
            "nomina": "/api/nomina",
            "usuarios": "/api/usuarios"
        },
        "instrucciones": "Primero: POST /api/auth/login con usuario y contraseña"
    }
    
    print("\n" + "="*60)
    print("PREVENT - SISTEMA DE GESTION INTEGRAL PARA IPS")
    print("="*60)
    print(json.dumps(info, indent=2, ensure_ascii=False))
    print("="*60)
    print("\nServidor corriendo en: http://localhost:5000")
    print("Usuario: admin | Password: admin123")
    print("="*60 + "\n")
    
    app.run(
        host='0.0.0.0',
        port=5000,
        debug=True,
        use_reloader=False
    )

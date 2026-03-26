import logging
import os

import click
from flask_migrate import Migrate
from sqlalchemy.engine import make_url

from app.config import config


migrate = Migrate(compare_type=True)


def _safe_database_url(raw_url):
    """Oculta la contrasena al registrar la URL de base de datos."""
    if not raw_url:
        return "(sin DATABASE_URL)"

    try:
        return make_url(raw_url).render_as_string(hide_password=True)
    except Exception:
        return "(url invalida)"


def _seed_admin_user(app):
    """Crear un administrador por defecto de manera idempotente."""
    from werkzeug.security import generate_password_hash

    from app.models import Role, Usuario, db

    username = app.config['DEFAULT_ADMIN_USERNAME']
    email = app.config['DEFAULT_ADMIN_EMAIL']
    password = app.config['DEFAULT_ADMIN_PASSWORD']

    admin_role = Role.query.filter_by(nombre="Administrador").first()
    if not admin_role:
        admin_role = Role(nombre="Administrador", descripcion="Acceso total")
        db.session.add(admin_role)
        db.session.commit()

    admin_user = Usuario.query.filter_by(usuario=username).first()
    if admin_user:
        app.logger.info("[DB] Usuario administrador '%s' ya existe", username)
        return False

    admin = Usuario(
        usuario=username,
        email=email,
        nombre_completo="Administrador",
        password_hash=generate_password_hash(password),
        role_id=admin_role.id,
        activo=True,
    )
    db.session.add(admin)
    db.session.commit()
    app.logger.info("[DB] Usuario administrador '%s' creado", username)
    return True


def _initialize_database_schema(app):
    """Crear tablas automaticamente solo cuando el entorno lo permita."""
    from app.models import db

    if not app.config.get('AUTO_CREATE_TABLES', False):
        app.logger.info(
            "[DB] AUTO_CREATE_TABLES deshabilitado; usa migraciones controladas con 'flask db upgrade'"
        )
        return

    try:
        db.create_all()
        app.logger.info("[OK] Tablas de base de datos creadas/verificadas")
    except Exception as exc:
        app.logger.warning("[WARN] No se pudieron crear tablas automaticamente: %s", exc)
        app.logger.warning("[WARN] Usa migraciones controladas con 'flask db upgrade'")


def register_shell_context(app):
    """Registrar objetos utiles para flask shell."""

    @app.shell_context_processor
    def make_shell_context():
        from app.models import (
            ConceptoAutomatico,
            Empleado,
            LiquidoQuincena,
            Pago,
            ParametroDescuento,
            Permiso,
            PrestamoEmpresa,
            PrestamoNovedad,
            PrestamoPago,
            Quincena,
            Role,
            Servicio,
            ServicioNovedad,
            ServicioPago,
            ServicioPeriodo,
            TipoNovedad,
            Usuario,
            db,
        )

        return {
            "db": db,
            "Usuario": Usuario,
            "Role": Role,
            "Permiso": Permiso,
            "Empleado": Empleado,
            "TipoNovedad": TipoNovedad,
            "ConceptoAutomatico": ConceptoAutomatico,
            "Quincena": Quincena,
            "LiquidoQuincena": LiquidoQuincena,
            "Pago": Pago,
            "Servicio": Servicio,
            "ServicioNovedad": ServicioNovedad,
            "ServicioPago": ServicioPago,
            "ServicioPeriodo": ServicioPeriodo,
            "PrestamoEmpresa": PrestamoEmpresa,
            "PrestamoNovedad": PrestamoNovedad,
            "PrestamoPago": PrestamoPago,
            "ParametroDescuento": ParametroDescuento,
        }


def register_cli_commands(app):
    """Registrar comandos operativos seguros."""

    @app.cli.command("init-db")
    @click.option(
        "--with-admin",
        is_flag=True,
        help="Crea tablas y, si se indica, tambien un admin por defecto.",
    )
    def init_db_command(with_admin):
        """Comando manual para entornos locales/controlados."""
        from app.models import db

        if not app.config.get('AUTO_CREATE_TABLES', False):
            raise click.ClickException(
                "init-db esta deshabilitado en este entorno. Usa migraciones controladas con 'flask db upgrade'."
            )

        db.create_all()
        click.echo("Tablas creadas/verificadas correctamente.")

        if with_admin or app.config.get('AUTO_SEED_ADMIN', False):
            created = _seed_admin_user(app)
            click.echo("Usuario administrador creado." if created else "Usuario administrador ya existia.")

    @app.cli.command("seed-admin")
    def seed_admin_command():
        """Crear el administrador por defecto de forma idempotente."""
        created = _seed_admin_user(app)
        click.echo("Usuario administrador creado." if created else "Usuario administrador ya existia.")


def create_app(config_name='development'):
    """Factory function para crear la aplicacion Flask."""
    from flask import Flask
    from flask_cors import CORS
    from flask_login import LoginManager

    from app.models import db

    app = Flask(__name__)
    app.config.from_object(config[config_name])

    if not os.path.exists(app.config['UPLOAD_FOLDER']):
        os.makedirs(app.config['UPLOAD_FOLDER'])

    db.init_app(app)
    migrate.init_app(app, db)
    CORS(app)

    login_manager = LoginManager()
    login_manager.init_app(app)
    login_manager.login_view = 'auth.login'
    login_manager.login_message = 'Por favor inicia sesion para acceder a esta pagina.'

    @login_manager.user_loader
    def load_user(user_id):
        from app.models import Usuario

        return Usuario.query.get(int(user_id))

    setup_logging()
    app.logger.info(
        "[DB] DATABASE_URL configurada: %s",
        _safe_database_url(os.environ.get("DATABASE_URL")),
    )

    register_shell_context(app)
    register_cli_commands(app)
    register_blueprints(app)

    with app.app_context():
        try:
            app.logger.info(
                "[DB] Conexion activa: %s",
                db.engine.url.render_as_string(hide_password=True),
            )
            app.logger.info("[DB] Dialecto activo: %s", db.engine.dialect.name)
        except Exception as exc:
            app.logger.warning("[WARN] No se pudo inicializar la conexion de base de datos: %s", exc)

        _initialize_database_schema(app)

        if app.config.get('AUTO_SEED_ADMIN', False):
            try:
                _seed_admin_user(app)
            except Exception as exc:
                app.logger.warning("[WARN] No se pudo crear/verificar el admin por defecto: %s", exc)

    return app


def register_blueprints(app):
    """Registrar todos los blueprints de la aplicacion."""
    from flask import render_template

    from app.routes import (
        auth_bp,
        bancos_bp,
        dashboard_bp,
        nomina_bp,
        parametros_bp,
        servicios_bp,
        usuarios_bp,
    )

    @app.route('/')
    def index():
        return render_template('login.html')

    @app.route('/dashboard')
    def dashboard():
        return render_template('dashboard.html')

    @app.route('/api')
    def api_info():
        return {
            'mensaje': 'Bienvenido a PREVENT API',
            'version': '0.1.0',
            'status': 'OK',
            'endpoints': {
                'auth': '/api/auth',
                'dashboard': '/api/dashboard',
                'nomina': '/api/nomina',
                'usuarios': '/api/usuarios',
                'parametros': '/api/parametros',
                'servicios': '/api/servicios',
                'bancos': '/api/bancos',
            },
            'instrucciones': 'Primero: POST /api/auth/login con usuario y contrasena',
        }

    @app.route('/api/test/empleados', methods=['GET'])
    def test_empleados():
        """Endpoint de prueba sin autenticacion - lista empleados."""
        try:
            from app.models import Empleado

            empleados = Empleado.query.filter_by(activo=True).all()
            datos = [
                {
                    'id': empleado.id,
                    'nro_documento': empleado.nro_documento,
                    'nombres': empleado.nombres,
                    'apellidos': empleado.apellidos,
                    'cargo': empleado.cargo,
                    'sueldo_base': float(empleado.sueldo_base),
                }
                for empleado in empleados
            ]

            return {
                'total': len(datos),
                'empleados': datos,
                'mensaje': 'Para acceso protegido, usa /api/nomina/empleados',
            }, 200
        except Exception as exc:
            return {'error': str(exc)}, 500

    app.register_blueprint(auth_bp)
    app.register_blueprint(dashboard_bp)
    app.register_blueprint(nomina_bp)
    app.register_blueprint(usuarios_bp)
    app.register_blueprint(parametros_bp)
    app.register_blueprint(servicios_bp)
    app.register_blueprint(bancos_bp)


def setup_logging():
    """Configurar logging de la aplicacion."""
    if not os.path.exists('logs'):
        os.makedirs('logs')

    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        handlers=[
            logging.FileHandler('logs/app.log'),
            logging.StreamHandler(),
        ],
    )

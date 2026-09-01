import logging
import os
from datetime import datetime, timezone
from decimal import Decimal

import click
from flask_migrate import Migrate
from sqlalchemy import text
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


def _validate_database_url(app):
    """Exige PostgreSQL como base oficial del proyecto."""
    configured_url = app.config.get("SQLALCHEMY_DATABASE_URI")
    if not configured_url:
        raise RuntimeError(
            "DATABASE_URL no esta definida. PREVENT ya no usa SQLite; "
            "configura una URL valida de PostgreSQL antes de iniciar la app."
        )

    try:
        parsed_url = make_url(configured_url)
    except Exception as exc:
        raise RuntimeError(
            "La URL configurada en DATABASE_URL no es valida para SQLAlchemy."
        ) from exc

    if not parsed_url.drivername.startswith("postgresql"):
        raise RuntimeError(
            "La base configurada no es PostgreSQL. "
            "PREVENT ya no usa SQLite ni otros motores en esta instancia."
        )


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


def _seed_menu_permissions(app):
    """Garantiza permisos base para el menú lateral y se los asigna al rol administrador."""
    from app.models import Permiso, Role, db
    from app.security import MENU_OPTION_DEFINITIONS, ROLE_PERMISSION_DEFINITIONS

    created = False
    updated = False

    permisos_by_name = {
        permiso.nombre: permiso
        for permiso in Permiso.query.all()
        if permiso.nombre
    }

    for definition in ROLE_PERMISSION_DEFINITIONS:
        permiso = permisos_by_name.get(definition['permiso'])
        if permiso is None:
            permiso = Permiso(
                nombre=definition['permiso'],
                descripcion=definition['descripcion'],
            )
            db.session.add(permiso)
            permisos_by_name[definition['permiso']] = permiso
            created = True
        elif permiso.descripcion != definition['descripcion']:
            permiso.descripcion = definition['descripcion']
            updated = True

    if created or updated:
        db.session.commit()

    admin_role = Role.query.filter_by(nombre="Administrador").first()
    if admin_role is None:
        return False

    role_permission_names = {permiso.nombre for permiso in admin_role.permisos if permiso.nombre}
    missing_for_admin = [
        permisos_by_name[definition['permiso']]
        for definition in ROLE_PERMISSION_DEFINITIONS
        if definition['permiso'] not in role_permission_names
    ]

    if missing_for_admin:
        for permiso in missing_for_admin:
            admin_role.permisos.append(permiso)
        db.session.commit()
        return True

    recepcion_role = Role.query.filter_by(nombre="Recepcion").first()
    chat_permission = permisos_by_name.get("menu_chat")
    recepcion_has_base_access = (
        recepcion_role is not None
        and Role.query.filter(
            Role.id == recepcion_role.id,
            Role.permisos.any(nombre="menu_recepcion"),
        ).first() is not None
    )
    recepcion_has_chat = (
        recepcion_role is not None
        and Role.query.filter(
            Role.id == recepcion_role.id,
            Role.permisos.any(nombre="menu_chat"),
        ).first() is not None
    )

    if (
        recepcion_role is not None
        and chat_permission is not None
        and recepcion_has_base_access
        and not recepcion_has_chat
    ):
        recepcion_role.permisos.append(chat_permission)
        db.session.commit()
        app.logger.info("[DB] Rol 'Recepcion' actualizado con permiso menu_chat")
        return True

    return created or updated


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
            ClienteComercial,
            ClienteComercialAdjunto,
            ClienteComercialTarifa,
            ComercialCatalogoItem,
            ComercialPaqueteDetalle,
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
            Vendedor,
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
            "ClienteComercial": ClienteComercial,
            "ClienteComercialAdjunto": ClienteComercialAdjunto,
            "ClienteComercialTarifa": ClienteComercialTarifa,
            "ComercialCatalogoItem": ComercialCatalogoItem,
            "ComercialPaqueteDetalle": ComercialPaqueteDetalle,
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
            "Vendedor": Vendedor,
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

    @app.cli.command("seed-comercial-demo")
    def seed_comercial_demo_command():
        """Crear datos demo del modulo comercial de forma idempotente."""
        from app.models import (
            ClienteComercial,
            ClienteComercialTarifa,
            ComercialCatalogoItem,
            ComercialPaqueteDetalle,
            Vendedor,
            db,
        )

        def upsert_vendedor(documento, **fields):
            vendedor = Vendedor.query.filter_by(documento=documento).first()
            if vendedor is None:
                vendedor = Vendedor(documento=documento)
                db.session.add(vendedor)
            for key, value in fields.items():
                setattr(vendedor, key, value)
            return vendedor

        def upsert_item(codigo, **fields):
            item = ComercialCatalogoItem.query.filter_by(codigo=codigo).first()
            if item is None:
                item = ComercialCatalogoItem(codigo=codigo)
                db.session.add(item)
            for key, value in fields.items():
                setattr(item, key, value)
            return item

        def upsert_cliente(nit, **fields):
            cliente = ClienteComercial.query.filter_by(nit=nit).first()
            if cliente is None:
                cliente = ClienteComercial(nit=nit)
                db.session.add(cliente)
            for key, value in fields.items():
                setattr(cliente, key, value)
            return cliente

        try:
            vendedor_1 = upsert_vendedor(
                '9001001',
                nombre='Laura Comercial',
                telefono='3001112233',
                email='laura.comercial@prevent.local',
                porcentaje_comision_venta=Decimal('4.50'),
                porcentaje_comision_recaudo=Decimal('1.50'),
                monto_base_comision=Decimal('0'),
                descripcion='Vendedora demo para pruebas del modulo comercial',
                activo=True,
            )
            vendedor_2 = upsert_vendedor(
                '9001002',
                nombre='Carlos Convenios',
                telefono='3001112244',
                email='carlos.convenios@prevent.local',
                porcentaje_comision_venta=Decimal('5.00'),
                porcentaje_comision_recaudo=Decimal('2.00'),
                monto_base_comision=Decimal('0'),
                descripcion='Gerencia comercial demo',
                activo=True,
            )

            item_consulta = upsert_item(
                'CONS001',
                tipo_item='EXAMEN',
                tipo_examen='CONSULTA',
                subtipo_laboratorio=None,
                clasificacion_completa=True,
                nombre='Consulta ocupacional de ingreso',
                descripcion='Consulta medica ocupacional para ingreso',
                tarifa_base=Decimal('45000'),
                activo=True,
            )
            item_para = upsert_item(
                'PARA001',
                tipo_item='EXAMEN',
                tipo_examen='PARACLINICO',
                subtipo_laboratorio=None,
                clasificacion_completa=True,
                nombre='Audiometria ocupacional',
                descripcion='Paraclinico demo para pruebas',
                tarifa_base=Decimal('38000'),
                activo=True,
            )
            item_lab_rem = upsert_item(
                'LABR001',
                tipo_item='EXAMEN',
                tipo_examen='LABORATORIO',
                subtipo_laboratorio='REMITIDO',
                clasificacion_completa=True,
                nombre='Perfil lipidico remitido',
                descripcion='Examen de laboratorio remitido',
                tarifa_base=Decimal('52000'),
                activo=True,
            )
            item_lab_real = upsert_item(
                'LABI001',
                tipo_item='EXAMEN',
                tipo_examen='LABORATORIO',
                subtipo_laboratorio='REALIZADO',
                clasificacion_completa=True,
                nombre='Glicemia laboratorio interno',
                descripcion='Examen realizado en laboratorio propio',
                tarifa_base=Decimal('18000'),
                activo=True,
            )
            item_pendiente = upsert_item(
                'PEND001',
                tipo_item='EXAMEN',
                tipo_examen=None,
                subtipo_laboratorio=None,
                clasificacion_completa=False,
                nombre='Examen pendiente de clasificar',
                descripcion='Item demo para validar pendientes de clasificacion',
                tarifa_base=Decimal('0'),
                activo=True,
            )
            paquete = upsert_item(
                'PKG001',
                tipo_item='PAQUETE',
                tipo_examen=None,
                subtipo_laboratorio=None,
                clasificacion_completa=True,
                nombre='Paquete ingreso administrativo',
                descripcion='Paquete demo con consulta, audiometria y laboratorio',
                tarifa_base=Decimal('120000'),
                activo=True,
            )

            db.session.flush()

            paquete.paquete_componentes.clear()
            for examen in [item_consulta, item_para, item_lab_real]:
                paquete.paquete_componentes.append(
                    ComercialPaqueteDetalle(examen_id=examen.id, cantidad=1)
                )

            cliente = upsert_cliente(
                '901234567-8',
                vendedor_id=vendedor_1.id,
                razon_social='Empresa Demo Comercial SAS',
                nombre_comercial='Demo Comercial',
                ciudad='Bogota',
                direccion='Calle 123 # 45-67',
                telefono_empresa='6015550101',
                email_empresa='compras@demo-comercial.local',
                contacto_principal='Paula Compras',
                celular_contacto_principal='3005550101',
                email_contacto_principal='paula@demo-comercial.local',
                contacto_facturacion='Andres Facturacion',
                celular_facturacion='3005550102',
                email_facturacion='facturacion@demo-comercial.local',
                condicion_comercial='CREDITO',
                requiere_factura=True,
                fechas_facturacion='5 y 20 de cada mes',
                examenes_convenidos='Consulta ocupacional, audiometria y glicemia',
                servicios_convenidos='Ingreso, periodicos y retiro',
                tarifas_convenidas='Tarifas negociadas segun volumen mensual',
                documentos_legales_completos=True,
                documentos_legales_detalle='RUT, camara de comercio y cedula del representante',
                pagare_firmado=True,
                pagare_detalle='Pagare firmado para credito a 30 dias',
                observaciones='Cliente demo para validacion de CRUD comercial',
                activo=True,
            )

            db.session.flush()

            tarifas_demo = [
                (cliente.id, item_consulta.id, Decimal('42000'), '2026-01-01', None, 'Tarifa preferencial de consulta'),
                (cliente.id, item_lab_real.id, Decimal('15000'), '2026-01-01', None, 'Tarifa interna negociada'),
                (cliente.id, paquete.id, Decimal('110000'), '2026-01-01', None, 'Paquete comercial demo'),
            ]

            for cliente_id, item_id, tarifa, desde, hasta, observacion in tarifas_demo:
                registro = ClienteComercialTarifa.query.filter_by(
                    cliente_id=cliente_id,
                    catalogo_item_id=item_id,
                ).first()
                if registro is None:
                    registro = ClienteComercialTarifa(
                        cliente_id=cliente_id,
                        catalogo_item_id=item_id,
                    )
                    db.session.add(registro)
                registro.tarifa_negociada = tarifa
                registro.vigencia_desde = datetime.strptime(desde, '%Y-%m-%d')
                registro.vigencia_hasta = datetime.strptime(hasta, '%Y-%m-%d') if hasta else None
                registro.observacion = observacion
                registro.activo = True

            db.session.commit()
            click.echo('Datos demo del modulo comercial creados/actualizados correctamente.')
        except Exception as exc:
            db.session.rollback()
            raise click.ClickException(f'No fue posible crear datos demo: {exc}')

    @app.cli.command("seed-easy-user")
    @click.option('--password', prompt=True, hide_input=True,
                  confirmation_prompt=True,
                  help='Contraseña para el usuario EASY (mínimo 8 caracteres).')
    def seed_easy_user_command(password):
        """Crear el superusuario EASY de forma idempotente. Solo SOFTEASY-WEB debe ejecutar este comando."""
        from werkzeug.security import generate_password_hash
        from app.models import Role, Usuario, db

        if len(password) < 8:
            raise click.ClickException('La contraseña debe tener al menos 8 caracteres.')

        # Verificar que no exista ya un usuario EASY
        existing = Usuario.query.filter_by(is_easy=True).first()
        if existing:
            raise click.ClickException(
                f"Ya existe el usuario EASY: '{existing.usuario}'. "
                "Para cambiar la contraseña usa: flask reset-easy-password"
            )

        # Usar el rol Administrador (o crearlo si no existe)
        admin_role = Role.query.filter_by(nombre='Administrador').first()
        if not admin_role:
            admin_role = Role(nombre='Administrador', descripcion='Acceso total')
            db.session.add(admin_role)
            db.session.flush()

        easy = Usuario(
            usuario='EASY',
            nombre_completo='SOFTEASY-WEB Superusuario',
            email='easy@softeasy-web.internal',
            password_hash=generate_password_hash(password),
            role_id=admin_role.id,
            is_easy=True,
            activo=True,
        )
        db.session.add(easy)
        db.session.commit()
        click.echo("Usuario EASY creado correctamente. Guarde la contraseña en un lugar seguro.")

    @app.cli.command("reset-easy-password")
    @click.option('--password', prompt=True, hide_input=True,
                  confirmation_prompt=True,
                  help='Nueva contraseña para el usuario EASY (mínimo 8 caracteres).')
    def reset_easy_password_command(password):
        """Restablecer la contraseña del superusuario EASY. Solo ejecutar con acceso al servidor."""
        from werkzeug.security import generate_password_hash
        from app.models import Usuario, db

        if len(password) < 8:
            raise click.ClickException('La contraseña debe tener al menos 8 caracteres.')

        easy = Usuario.query.filter_by(is_easy=True).first()
        if not easy:
            raise click.ClickException(
                "No existe el usuario EASY. Créalo primero con: flask seed-easy-user"
            )

        easy.password_hash = generate_password_hash(password)
        db.session.commit()
        click.echo(f"Contraseña del usuario EASY ('{easy.usuario}') restablecida correctamente.")


def register_template_helpers(app):
    """Helpers de plantillas para evitar cache agresivo de archivos estaticos."""
    from flask import url_for

    @app.context_processor
    def inject_asset_helpers():
        def asset_url(filename):
            static_path = os.path.join(app.static_folder, *filename.split('/'))
            version = None
            try:
                version = int(os.path.getmtime(static_path))
            except OSError:
                version = None

            if version is not None:
                return url_for('static', filename=filename, v=version)
            return url_for('static', filename=filename)

        def _mtime_token(*parts):
            path = os.path.join(*parts)
            try:
                stamp = os.path.getmtime(path)
                return datetime.fromtimestamp(stamp, tz=timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')
            except OSError:
                return 'N/D'

        commit = (
            os.environ.get('RAILWAY_GIT_COMMIT_SHA')
            or os.environ.get('GITHUB_SHA')
            or os.environ.get('RENDER_GIT_COMMIT')
            or ''
        ).strip()
        commit_short = commit[:7] if commit else 'local'

        build_info = {
            'commit': commit_short,
            'ui_dashboard_js': _mtime_token(app.static_folder, 'js', 'dashboard.js'),
            'api_dashboard_py': _mtime_token(app.root_path, 'routes', 'dashboard.py'),
        }

        return {
            "asset_url": asset_url,
            "build_info": build_info,
        }


def create_app(config_name='development'):
    """Factory function para crear la aplicacion Flask."""
    from flask import Flask
    from flask_cors import CORS
    from flask_login import LoginManager

    from app.models import db

    app = Flask(__name__)
    app.config.from_object(config[config_name])
    _validate_database_url(app)

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

    @login_manager.unauthorized_handler
    def unauthorized():
        from flask import jsonify, redirect, request, url_for

        if request.path.startswith('/api/'):
            return jsonify({'error': 'Sesion expirada o no autenticada'}), 401
        return redirect(url_for('index'))

    setup_logging()
    app.logger.info(
        "[DB] DATABASE_URL configurada: %s",
        _safe_database_url(os.environ.get("DATABASE_URL")),
    )

    register_shell_context(app)
    register_cli_commands(app)
    register_template_helpers(app)
    register_blueprints(app)

    with app.app_context():
        try:
            # Fuerza una conexion real para detectar credenciales invalidas al iniciar
            db.session.execute(text("SELECT 1"))
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

        try:
            _seed_menu_permissions(app)
        except Exception as exc:
            app.logger.warning("[WARN] No se pudieron crear/verificar los permisos base del menú: %s", exc)

    return app


def register_blueprints(app):
    """Registrar todos los blueprints de la aplicacion."""
    from flask import render_template

    from app.routes import (
        auth_bp,
        chat_bp,
        comercial_bp,
        contable_bp,
        dashboard_bp,
        parametros_bp,
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
                'usuarios': '/api/usuarios',
                'parametros': '/api/parametros',
                'comercial': '/api/comercial',
                'contable': '/api/contable',
                'chat': '/api/chat',
            },
            'instrucciones': 'Primero: POST /api/auth/login con usuario y contrasena',
        }

    app.register_blueprint(auth_bp)
    app.register_blueprint(dashboard_bp)
    app.register_blueprint(usuarios_bp)
    app.register_blueprint(parametros_bp)
    app.register_blueprint(comercial_bp)
    app.register_blueprint(contable_bp)
    app.register_blueprint(chat_bp)


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

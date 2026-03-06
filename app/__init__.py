from app.config import config
import logging
import os


def create_app(config_name='development'):
    """Factory function para crear la aplicación Flask"""
    # Importar Flask localmente para evitar import-time pesado
    from flask import Flask

    # Crear instancia de Flask
    app = Flask(__name__)

    # Cargar configuración
    app.config.from_object(config[config_name])

    # Crear carpeta de uploads si no existe
    if not os.path.exists(app.config['UPLOAD_FOLDER']):
        os.makedirs(app.config['UPLOAD_FOLDER'])

    # Inicializar extensiones
    # Importar modelos aquí para evitar cargas pesadas al importar el paquete
    from app.models import db, Usuario

    # Importar extensiones localmente para evitar cargar Flask/Werkzeug
    # durante el import del paquete (reduce riesgo de bloqueos en Windows)
    from flask_cors import CORS
    from flask_login import LoginManager

    db.init_app(app)
    CORS(app)

    # Configurar Login Manager
    login_manager = LoginManager()
    login_manager.init_app(app)
    login_manager.login_view = 'auth.login'
    login_manager.login_message = 'Por favor inicia sesión para acceder a esta página.'

    @login_manager.user_loader
    def load_user(user_id):
        # Importar modelo dentro del loader para evitar dependencias en el
        # momento de importar el paquete a nivel de módulo.
        from app.models import Usuario as _Usuario
        return _Usuario.query.get(int(user_id))

    # Configurar logging
    setup_logging()

    # Registrar rutas y blueprints
    register_blueprints(app)

    # Crear tablas de base de datos (con manejo de errores)
    with app.app_context():
        try:
            db.create_all()
            app.logger.info("[OK] Tablas de base de datos creadas/verificadas")
        except Exception as e:
            app.logger.warning(f"[WARN] No se pudieron crear tablas automáticamente: {str(e)}")
            app.logger.warning("Ejecuta: flask init-db")

    return app


def register_blueprints(app):
    """Registrar todos los blueprints de la aplicación"""
    # Importar render_template y blueprints aquí
    from flask import render_template
    from app.routes import auth_bp, dashboard_bp, nomina_bp, usuarios_bp, parametros_bp, servicios_bp, bancos_bp

    # Ruta raíz - Login
    @app.route('/')
    def index():
        return render_template('login.html')

    # Ruta Dashboard
    @app.route('/dashboard')
    def dashboard():
        return render_template('dashboard.html')

    # API Info endpoint
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
                'bancos': '/api/bancos'
            },
            'instrucciones': 'Primero: POST /api/auth/login con usuario y contraseña'
        }

    # Test sin autenticación
    @app.route('/api/test/empleados', methods=['GET'])
    def test_empleados():
        """Endpoint de prueba sin autenticación - lista empleados"""
        try:
            from app.models import Empleado
            empleados = Empleado.query.filter_by(activo=True).all()

            datos = [{
                'id': e.id,
                'nro_documento': e.nro_documento,
                'nombres': e.nombres,
                'apellidos': e.apellidos,
                'cargo': e.cargo,
                'sueldo_base': float(e.sueldo_base)
            } for e in empleados]

            return {
                'total': len(datos),
                'empleados': datos,
                'mensaje': 'Para acceso protegido, usa /api/nomina/empleados'
            }, 200
        except Exception as e:
            return {'error': str(e)}, 500

    # Registrar blueprints
    app.register_blueprint(auth_bp)
    app.register_blueprint(dashboard_bp)
    app.register_blueprint(nomina_bp)
    app.register_blueprint(usuarios_bp)
    app.register_blueprint(parametros_bp)
    app.register_blueprint(servicios_bp)
    app.register_blueprint(bancos_bp)


def setup_logging():
    """Configurar logging de la aplicación"""

    if not os.path.exists('logs'):
        os.makedirs('logs')

    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        handlers=[
            logging.FileHandler('logs/app.log'),
            logging.StreamHandler()
        ]
    )

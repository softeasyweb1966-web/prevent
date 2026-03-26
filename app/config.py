import os
from datetime import timedelta


def _normalize_database_url(url):
    """Normaliza URLs de Postgres compatibles con SQLAlchemy."""
    if not url:
        return 'sqlite:///prevent.db'

    if url.startswith('postgres://'):
        return 'postgresql://' + url[len('postgres://'):]

    return url


class Config:
    """Configuracion base de la aplicacion."""

    # Flask
    SECRET_KEY = os.environ.get('SECRET_KEY') or 'dev-secret-key-change-in-production'

    # Base de datos
    # SQLite para desarrollo, PostgreSQL para produccion.
    SQLALCHEMY_DATABASE_URI = _normalize_database_url(os.environ.get('DATABASE_URL'))
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ECHO = os.environ.get('SQLALCHEMY_ECHO', 'false').lower() == 'true'

    # Seguridad operativa
    AUTO_CREATE_TABLES = False
    AUTO_SEED_ADMIN = False

    # Datos por defecto para entornos controlados
    DEFAULT_ADMIN_USERNAME = os.environ.get('DEFAULT_ADMIN_USERNAME', 'admin')
    DEFAULT_ADMIN_EMAIL = os.environ.get('DEFAULT_ADMIN_EMAIL', 'admin@test.com')
    DEFAULT_ADMIN_PASSWORD = os.environ.get('DEFAULT_ADMIN_PASSWORD', 'admin123')

    # Sesiones
    PERMANENT_SESSION_LIFETIME = timedelta(hours=24)
    SESSION_COOKIE_SECURE = False
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = 'Lax'

    # JWT
    JWT_SECRET_KEY = os.environ.get('JWT_SECRET_KEY') or 'jwt-secret-key-change-in-production'
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(hours=24)

    # Uploads
    MAX_CONTENT_LENGTH = 16 * 1024 * 1024
    UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), 'uploads')

    # Configuracion de nomina
    PAYROLL_FREQUENCY_OPTIONS = ['QUINCENAL', 'MENSUAL']
    PAYROLL_DAYS = [5, 20]


class DevelopmentConfig(Config):
    """Configuracion para desarrollo."""

    DEBUG = True
    TESTING = False
    AUTO_CREATE_TABLES = os.environ.get('AUTO_CREATE_TABLES', 'true').lower() == 'true'
    AUTO_SEED_ADMIN = os.environ.get('AUTO_SEED_ADMIN', 'true').lower() == 'true'


class TestingConfig(Config):
    """Configuracion para pruebas."""

    TESTING = True
    SQLALCHEMY_DATABASE_URI = 'sqlite:///:memory:'
    WTF_CSRF_ENABLED = False
    AUTO_CREATE_TABLES = True
    AUTO_SEED_ADMIN = False


class ProductionConfig(Config):
    """Configuracion para produccion."""

    DEBUG = False
    TESTING = False
    SESSION_COOKIE_SECURE = True
    AUTO_CREATE_TABLES = os.environ.get('AUTO_CREATE_TABLES', 'false').lower() == 'true'
    AUTO_SEED_ADMIN = os.environ.get('AUTO_SEED_ADMIN', 'false').lower() == 'true'


config = {
    'development': DevelopmentConfig,
    'testing': TestingConfig,
    'production': ProductionConfig,
    'default': DevelopmentConfig,
}

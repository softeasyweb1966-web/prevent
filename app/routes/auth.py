from flask import request, jsonify
from app.routes import auth_bp
from app.models import db, Usuario, Empresa
from app.security import (
    get_allowed_menu_modules_for_role,
    get_permission_names_for_role,
    get_permission_names_for_user,
)
from werkzeug.security import generate_password_hash, check_password_hash
from flask_login import login_user, logout_user, current_user, login_required
import logging

logger = logging.getLogger(__name__)


def _build_user_session_payload(usuario):
    """Construye el payload de sesión unificado para login y /me."""
    try:
        permission_names = get_permission_names_for_user(usuario)
    except Exception:
        permission_names = get_permission_names_for_role(getattr(usuario, 'role', None))

    is_easy = bool(getattr(usuario, 'is_easy', False))

    # El usuario EASY tiene acceso a todos los módulos del menú
    if is_easy or '*' in permission_names:
        from app.security import MENU_OPTION_DEFINITIONS
        menu_modules = [d['module'] for d in MENU_OPTION_DEFINITIONS]
    else:
        menu_modules = get_allowed_menu_modules_for_role(usuario.role)

    return {
        'usuario_id': usuario.id,
        'usuario': usuario.usuario,
        'nombre': usuario.nombre_completo,
        'email': usuario.email,
        'role': usuario.role.nombre if usuario.role else None,
        'role_id': usuario.role_id,
        'is_easy': is_easy,
        'menu_modules': menu_modules,
        'permission_names': sorted(permission_names - {'*'}) if '*' in permission_names else sorted(permission_names),
        'is_superuser': is_easy or '*' in permission_names,
    }


@auth_bp.route('/register', methods=['POST'])
def register():
    """Registro de nuevo usuario"""
    data = request.get_json()

    try:
        if not data.get('usuario') or not data.get('password') or not data.get('email'):
            return jsonify({'error': 'Campos requeridos faltantes'}), 400

        if Usuario.query.filter_by(usuario=data['usuario']).first():
            return jsonify({'error': 'El usuario ya existe'}), 409

        usuario = Usuario(
            usuario=data['usuario'],
            email=data['email'],
            nombre_completo=data.get('nombre_completo', ''),
            password_hash=generate_password_hash(data['password']),
            role_id=data.get('role_id', 1),
        )

        db.session.add(usuario)
        db.session.commit()

        logger.info(f"Nuevo usuario registrado: {usuario.usuario}")
        return jsonify({'mensaje': 'Usuario registrado exitosamente'}), 201

    except Exception as e:
        db.session.rollback()
        logger.error(f"Error registrando usuario: {str(e)}")
        return jsonify({'error': 'Error al registrar usuario'}), 500


@auth_bp.route('/login', methods=['POST'])
def login():
    """Login de usuario"""
    data = request.get_json()

    try:
        username = data.get('username') or data.get('usuario')
        password = data.get('password')

        if not username or not password:
            logger.warning("Intento de login sin usuario o password")
            return jsonify({'error': 'Usuario y contraseña requeridos'}), 400

        usuario = Usuario.query.filter_by(usuario=username).first()

        if not usuario:
            logger.warning(f"Intento de login fallido para usuario inexistente: {username}")
            return jsonify({'error': 'Usuario o contraseña incorrectos'}), 401

        if not check_password_hash(usuario.password_hash, password):
            logger.warning(f"Intento de login fallido para: {username}")
            return jsonify({'error': 'Usuario o contraseña incorrectos'}), 401

        if not usuario.activo:
            return jsonify({'error': 'Usuario inactivo'}), 403

        login_user(usuario)
        logger.info(f"Usuario logueado: {usuario.usuario}")

        payload = _build_user_session_payload(usuario)
        payload['mensaje'] = 'Sesión iniciada'
        return jsonify(payload), 200

    except Exception as e:
        logger.error(f"Error en login: {str(e)}")
        return jsonify({'error': 'Error en la autenticación'}), 500


@auth_bp.route('/logout', methods=['POST'])
@login_required
def logout():
    """Cerrar sesión"""
    logout_user()
    logger.info("Usuario deslogueado")
    return jsonify({'mensaje': 'Sesión cerrada'}), 200


@auth_bp.route('/me', methods=['GET'])
@login_required
def get_current_user():
    """Obtener información del usuario actual"""
    return jsonify(_build_user_session_payload(current_user)), 200

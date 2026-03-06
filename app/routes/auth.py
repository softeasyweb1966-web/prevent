from flask import request, jsonify
from app.routes import auth_bp
from app.models import db, Usuario, Empresa
from werkzeug.security import generate_password_hash, check_password_hash
from flask_login import login_user, logout_user, current_user, login_required
import logging

logger = logging.getLogger(__name__)

@auth_bp.route('/register', methods=['POST'])
def register():
    """Registro de nuevo usuario"""
    data = request.get_json()
    
    try:
        # Validar datos
        if not data.get('usuario') or not data.get('password') or not data.get('email'):
            return jsonify({'error': 'Campos requeridos faltantes'}), 400
        
        # Verificar si usuario existe
        if Usuario.query.filter_by(usuario=data['usuario']).first():
            return jsonify({'error': 'El usuario ya existe'}), 409
        
        # Crear nuevo usuario
        usuario = Usuario(
            usuario=data['usuario'],
            email=data['email'],
            nombre_completo=data.get('nombre_completo', ''),
            password_hash=generate_password_hash(data['password']),
            role_id=data.get('role_id', 1)  # Role por defecto
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
        # Aceptar 'usuario' o 'username' como campo
        username = data.get('username') or data.get('usuario')
        password = data.get('password')
        
        # Validar que ambos campos estén presentes
        if not username or not password:
            logger.warning(f"Intento de login sin usuario o password")
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
        
        return jsonify({
            'mensaje': 'Sesión iniciada',
            'usuario_id': usuario.id,
            'usuario': usuario.usuario,
            'nombre': usuario.nombre_completo,
            'role': usuario.role.nombre if usuario.role else None
        }), 200
    
    except Exception as e:
        logger.error(f"Error en login: {str(e)}")
        return jsonify({'error': 'Error en la autenticación'}), 500


@auth_bp.route('/logout', methods=['POST'])
@login_required
def logout():
    """Cerrar sesión"""
    logout_user()
    logger.info(f"Usuario deslogueado")
    return jsonify({'mensaje': 'Sesión cerrada'}), 200


@auth_bp.route('/me', methods=['GET'])
@login_required
def get_current_user():
    """Obtener información del usuario actual"""
    return jsonify({
        'usuario_id': current_user.id,
        'usuario': current_user.usuario,
        'nombre': current_user.nombre_completo,
        'email': current_user.email,
        'role': current_user.role.nombre if current_user.role else None
    }), 200

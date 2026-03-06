from flask import request, jsonify
from app.routes import usuarios_bp
from app.models import db, Usuario, Role, AuditLog
from flask_login import login_required, current_user
from werkzeug.security import generate_password_hash
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

@usuarios_bp.route('/', methods=['GET'])
@login_required
def get_usuarios():
    """Obtener lista de usuarios"""
    try:
        usuarios = Usuario.query.all()
        
        datos = [{
            'id': u.id,
            'usuario': u.usuario,
            'nombre_completo': u.nombre_completo,
            'email': u.email,
            'role': u.role.nombre if u.role else None,
            'activo': u.activo,
            'ultimo_acceso': u.ultimo_acceso.strftime('%Y-%m-%d %H:%M:%S') if u.ultimo_acceso else None,
            'created_at': u.created_at.strftime('%Y-%m-%d %H:%M:%S')
        } for u in usuarios]
        
        return jsonify(datos), 200
    
    except Exception as e:
        logger.error(f"Error obteniendo usuarios: {str(e)}")
        return jsonify({'error': 'Error al obtener usuarios'}), 500


@usuarios_bp.route('/<int:usuario_id>', methods=['GET'])
@login_required
def get_usuario(usuario_id):
    """Obtener detalle de un usuario"""
    try:
        usuario = Usuario.query.get_or_404(usuario_id)
        
        datos = {
            'id': usuario.id,
            'usuario': usuario.usuario,
            'nombre_completo': usuario.nombre_completo,
            'email': usuario.email,
            'role': usuario.role.nombre if usuario.role else None,
            'activo': usuario.activo,
            'ultimo_acceso': usuario.ultimo_acceso.strftime('%Y-%m-%d %H:%M:%S') if usuario.ultimo_acceso else None
        }
        
        return jsonify(datos), 200
    
    except Exception as e:
        logger.error(f"Error obteniendo usuario: {str(e)}")
        return jsonify({'error': 'Error al obtener usuario'}), 500


@usuarios_bp.route('/<int:usuario_id>', methods=['PUT'])
@login_required
def actualizar_usuario(usuario_id):
    """Actualizar usuario"""
    data = request.get_json()
    
    try:
        usuario = Usuario.query.get_or_404(usuario_id)
        
        usuario.nombre_completo = data.get('nombre_completo', usuario.nombre_completo)
        usuario.email = data.get('email', usuario.email)
        usuario.activo = data.get('activo', usuario.activo)
        
        if data.get('role_id'):
            usuario.role_id = data.get('role_id')
        
        db.session.commit()
        logger.info(f"Usuario actualizado: {usuario.usuario}")
        
        return jsonify({'mensaje': 'Usuario actualizado'}), 200
    
    except Exception as e:
        db.session.rollback()
        logger.error(f"Error actualizando usuario: {str(e)}")
        return jsonify({'error': 'Error al actualizar usuario'}), 500


@usuarios_bp.route('/<int:usuario_id>/cambiar-password', methods=['POST'])
@login_required
def cambiar_password(usuario_id):
    """Cambiar contraseña de usuario"""
    data = request.get_json()
    
    try:
        usuario = Usuario.query.get_or_404(usuario_id)
        
        # Solo permitir cambio propio o si es administrador
        if current_user.id != usuario_id and not is_admin():
            return jsonify({'error': 'No tienes permiso'}), 403
        
        usuario.password_hash = generate_password_hash(data.get('nueva_password'))
        
        db.session.commit()
        logger.info(f"Contraseña cambiada para usuario: {usuario.usuario}")
        
        return jsonify({'mensaje': 'Contraseña actualizada'}), 200
    
    except Exception as e:
        db.session.rollback()
        logger.error(f"Error cambiando password: {str(e)}")
        return jsonify({'error': 'Error al cambiar contraseña'}), 500


@usuarios_bp.route('/roles', methods=['GET'])
@login_required
def get_roles():
    """Obtener lista de roles"""
    try:
        roles = Role.query.all()
        
        datos = [{
            'id': r.id,
            'nombre': r.nombre,
            'descripcion': r.descripcion
        } for r in roles]
        
        return jsonify(datos), 200
    
    except Exception as e:
        logger.error(f"Error obteniendo roles: {str(e)}")
        return jsonify({'error': 'Error al obtener roles'}), 500


@usuarios_bp.route('/audit-log', methods=['GET'])
@login_required
def get_audit_log():
    """Obtener log de auditoría"""
    try:
        # Solo administradores pueden ver auditoría
        if not is_admin():
            return jsonify({'error': 'No tienes permiso'}), 403
        
        logs = AuditLog.query.order_by(AuditLog.created_at.desc()).limit(100).all()
        
        datos = [{
            'id': log.id,
            'usuario': log.usuario.usuario if log.usuario else 'Sistema',
            'tabla': log.tabla,
            'accion': log.accion,
            'created_at': log.created_at.strftime('%Y-%m-%d %H:%M:%S'),
            'ip_address': log.ip_address
        } for log in logs]
        
        return jsonify(datos), 200
    
    except Exception as e:
        logger.error(f"Error obteniendo audit log: {str(e)}")
        return jsonify({'error': 'Error al obtener auditoría'}), 500


def is_admin():
    """Verificar si usuario actual es administrador"""
    return current_user.role and current_user.role.nombre == 'Administrador'

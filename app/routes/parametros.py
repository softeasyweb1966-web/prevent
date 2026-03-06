"""
Rutas para parámetros y configuración de la aplicación
- Descuentos (Salud, Pensión, Caja de Compensación)
- Otras tablas parametrizadas
"""

from flask import request, jsonify
from app.routes import parametros_bp
from app.models import db, ParametroDescuento
from flask_login import login_required, current_user
from datetime import datetime
from decimal import Decimal
import logging

logger = logging.getLogger(__name__)


# ==================== PARAMETROS DE DESCUENTO ====================

@parametros_bp.route('/descuentos', methods=['GET'])
@login_required
def obtener_descuentos():
    """Obtener todos los parámetros de descuento (activos e inactivos)"""
    try:
        descuentos = ParametroDescuento.query.all()  # Mostrar todos para ver cuáles existen
        datos = [{
            'id': d.id,
            'nombre': d.nombre,
            'porcentaje': float(d.porcentaje),
            'descripcion': d.descripcion,
            'activo': d.activo,
            'created_at': d.created_at.strftime('%Y-%m-%d %H:%M:%S'),
            'updated_at': d.updated_at.strftime('%Y-%m-%d %H:%M:%S')
        } for d in descuentos]
        
        return jsonify({'descuentos': datos}), 200
    
    except Exception as e:
        logger.error(f"Error obteniendo descuentos: {str(e)}")
        return jsonify({'error': 'Error al obtener descuentos'}), 500


@parametros_bp.route('/descuentos/<int:descuento_id>', methods=['GET'])
@login_required
def obtener_descuento(descuento_id):
    """Obtener detalle de un parámetro de descuento"""
    try:
        descuento = ParametroDescuento.query.get_or_404(descuento_id)
        
        dato = {
            'id': descuento.id,
            'nombre': descuento.nombre,
            'porcentaje': float(descuento.porcentaje),
            'descripcion': descuento.descripcion,
            'activo': descuento.activo
        }
        
        return jsonify(dato), 200
    
    except Exception as e:
        logger.error(f"Error obteniendo descuento: {str(e)}")
        return jsonify({'error': 'Descuento no encontrado'}), 404


@parametros_bp.route('/descuentos', methods=['POST'])
@login_required
def crear_descuento():
    """Crear nuevo parámetro de descuento"""
    data = request.get_json()
    
    try:
        # Validar que el nombre sea único
        if ParametroDescuento.query.filter_by(nombre=data.get('nombre')).first():
            return jsonify({'error': 'El parámetro de descuento ya existe'}), 409
        
        descuento = ParametroDescuento(
            nombre=data.get('nombre'),
            porcentaje=Decimal(str(data.get('porcentaje'))),
            descripcion=data.get('descripcion'),
            activo=data.get('activo', True)
        )
        
        db.session.add(descuento)
        db.session.commit()
        
        logger.info(f"Descuento creado: {descuento.nombre}")
        return jsonify({'mensaje': 'Descuento creado', 'id': descuento.id}), 201
    
    except Exception as e:
        db.session.rollback()
        logger.error(f"Error creando descuento: {str(e)}")
        return jsonify({'error': 'Error al crear descuento'}), 500


@parametros_bp.route('/descuentos/<int:descuento_id>', methods=['PUT'])
@login_required
def actualizar_descuento(descuento_id):
    """Actualizar parámetro de descuento"""
    data = request.get_json()
    
    try:
        descuento = ParametroDescuento.query.get_or_404(descuento_id)
        
        descuento.porcentaje = Decimal(str(data.get('porcentaje', descuento.porcentaje)))
        descuento.descripcion = data.get('descripcion', descuento.descripcion)
        descuento.activo = data.get('activo', descuento.activo)
        
        db.session.commit()
        logger.info(f"Descuento actualizado: {descuento.nombre}")
        
        return jsonify({'mensaje': 'Descuento actualizado'}), 200
    
    except Exception as e:
        db.session.rollback()
        logger.error(f"Error actualizando descuento: {str(e)}")
        return jsonify({'error': 'Error al actualizar descuento'}), 500


@parametros_bp.route('/descuentos/<int:descuento_id>', methods=['DELETE'])
@login_required
def eliminar_descuento(descuento_id):
    """Desactivar parámetro de descuento"""
    try:
        descuento = ParametroDescuento.query.get_or_404(descuento_id)
        
        # En lugar de eliminar, desactivar
        descuento.activo = False
        
        db.session.commit()
        logger.info(f"Descuento desactivado: {descuento.nombre}")
        
        return jsonify({'mensaje': 'Descuento desactivado'}), 200
    
    except Exception as e:
        db.session.rollback()
        logger.error(f"Error eliminando descuento: {str(e)}")
        return jsonify({'error': 'Error al eliminar descuento'}), 500

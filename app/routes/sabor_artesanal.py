import logging

from flask import jsonify, request
from flask_login import current_user, login_required
from sqlalchemy import func, inspect
from sqlalchemy.orm import selectinload

from app.models import SaborArtesanalTablaItem, db
from app.routes import sabor_artesanal_bp

logger = logging.getLogger(__name__)

SABOR_ARTESANAL_CATEGORIAS = {
    'entradas': 'Entradas',
    'principios': 'Principios',
    'proteinas': 'Proteinas',
    'basicos': 'Basicos',
    'acompanamientos': 'Acompanamientos',
    'ensaladas': 'Ensaladas',
}


def _normalizar_categoria(valor):
    clave = (valor or '').strip().lower()
    if clave == 'poroteinas':
        clave = 'proteinas'
    return clave if clave in SABOR_ARTESANAL_CATEGORIAS else None


def _parse_bool(valor, default=True):
    if valor is None:
        return default
    if isinstance(valor, bool):
        return valor
    return str(valor).strip().lower() in {'1', 'true', 't', 'si', 'yes', 'y', 'on'}


def _ensure_sabor_artesanal_schema():
    inspector = inspect(db.engine)
    if not inspector.has_table(SaborArtesanalTablaItem.__tablename__):
        SaborArtesanalTablaItem.__table__.create(bind=db.engine, checkfirst=True)


def _serialize_sabor_item(item):
    hijos = sorted(
        list(item.children or []),
        key=lambda child: ((child.nombre or '').strip().lower(), child.id),
    )
    return {
        'id': item.id,
        'categoria': item.categoria,
        'categoria_label': SABOR_ARTESANAL_CATEGORIAS.get(item.categoria, item.categoria),
        'nombre': item.nombre,
        'descripcion': item.descripcion,
        'parent_id': item.parent_id,
        'parent_nombre': item.parent.nombre if item.parent else None,
        'activo': bool(item.activo),
        'created_at': item.created_at.isoformat() if item.created_at else None,
        'updated_at': item.updated_at.isoformat() if item.updated_at else None,
        'children': [
            {
                'id': child.id,
                'categoria': child.categoria,
                'nombre': child.nombre,
                'descripcion': child.descripcion,
                'parent_id': child.parent_id,
                'parent_nombre': item.nombre,
                'activo': bool(child.activo),
                'created_at': child.created_at.isoformat() if child.created_at else None,
                'updated_at': child.updated_at.isoformat() if child.updated_at else None,
            }
            for child in hijos
        ],
        'children_count': len(hijos),
    }


def _buscar_item_existente(categoria, nombre, parent_id, excluding_id=None):
    query = SaborArtesanalTablaItem.query.filter(
        SaborArtesanalTablaItem.categoria == categoria,
        func.lower(SaborArtesanalTablaItem.nombre) == (nombre or '').strip().lower(),
    )

    if parent_id is None:
        query = query.filter(SaborArtesanalTablaItem.parent_id.is_(None))
    else:
        query = query.filter(SaborArtesanalTablaItem.parent_id == parent_id)

    if excluding_id is not None:
        query = query.filter(SaborArtesanalTablaItem.id != excluding_id)

    return query.first()


def _resolver_parent_id(data, categoria_actual, item_actual=None):
    if 'parent_id' not in data and item_actual is not None:
        return item_actual.parent_id, None

    raw_parent_id = data.get('parent_id')
    if raw_parent_id in (None, '', 0, '0'):
        return None, None

    try:
        parent_id = int(raw_parent_id)
    except (TypeError, ValueError):
        return None, 'El item principal seleccionado no es valido.'

    parent = SaborArtesanalTablaItem.query.get(parent_id)
    if parent is None:
        return None, 'El item principal seleccionado no existe.'
    if parent.categoria != categoria_actual:
        return None, 'El item principal debe pertenecer a la misma categoria.'
    if parent.parent_id is not None:
        return None, 'Solo puedes asociar variantes directamente a un item principal.'
    if item_actual is not None and parent.id == item_actual.id:
        return None, 'Un item no puede depender de si mismo.'

    return parent_id, None


@sabor_artesanal_bp.route('/tablas/<string:categoria>', methods=['GET'])
@login_required
def listar_tabla_sabor_artesanal(categoria):
    categoria_normalizada = _normalizar_categoria(categoria)
    if categoria_normalizada is None:
        return jsonify({'error': 'Categoria no valida'}), 400

    try:
        _ensure_sabor_artesanal_schema()
        items = (
            SaborArtesanalTablaItem.query.options(
                selectinload(SaborArtesanalTablaItem.children),
                selectinload(SaborArtesanalTablaItem.parent),
            )
            .filter(
                SaborArtesanalTablaItem.categoria == categoria_normalizada,
                SaborArtesanalTablaItem.parent_id.is_(None),
            )
            .order_by(
                SaborArtesanalTablaItem.activo.desc(),
                SaborArtesanalTablaItem.nombre.asc(),
                SaborArtesanalTablaItem.id.asc(),
            )
            .all()
        )

        return jsonify({
            'categoria': categoria_normalizada,
            'label': SABOR_ARTESANAL_CATEGORIAS[categoria_normalizada],
            'items': [_serialize_sabor_item(item) for item in items],
        }), 200
    except Exception as exc:
        logger.error('Error listando tabla de Sabor Artesanal (%s): %s', categoria_normalizada, exc)
        return jsonify({'error': 'No se pudo cargar la tabla solicitada'}), 500


@sabor_artesanal_bp.route('/tablas/<string:categoria>', methods=['POST'])
@login_required
def crear_tabla_sabor_artesanal(categoria):
    categoria_normalizada = _normalizar_categoria(categoria)
    if categoria_normalizada is None:
        return jsonify({'error': 'Categoria no valida'}), 400

    data = request.get_json() or {}
    nombre = (data.get('nombre') or '').strip()
    if not nombre:
        return jsonify({'error': 'El nombre es obligatorio'}), 400

    try:
        _ensure_sabor_artesanal_schema()
    except Exception as exc:
        logger.error('No se pudo preparar el esquema de Sabor Artesanal: %s', exc)
        return jsonify({'error': 'No se pudo preparar la tabla de datos'}), 500

    parent_id, parent_error = _resolver_parent_id(data, categoria_normalizada)
    if parent_error:
        return jsonify({'error': parent_error}), 400

    if _buscar_item_existente(categoria_normalizada, nombre, parent_id):
        return jsonify({'error': 'Ya existe un item con ese nombre en esta tabla'}), 409

    try:
        item = SaborArtesanalTablaItem(
            categoria=categoria_normalizada,
            nombre=nombre,
            descripcion=(data.get('descripcion') or '').strip() or None,
            parent_id=parent_id,
            activo=_parse_bool(data.get('activo'), True),
            usuario_id=getattr(current_user, 'id', None),
        )
        db.session.add(item)

        variantes = data.get('variantes') if isinstance(data.get('variantes'), list) else []
        if parent_id is None and variantes:
            seen = set()
            for variante in variantes:
                if isinstance(variante, dict):
                    variante_nombre = (variante.get('nombre') or '').strip()
                    variante_descripcion = (variante.get('descripcion') or '').strip() or None
                    variante_activo = _parse_bool(variante.get('activo'), True)
                else:
                    variante_nombre = str(variante or '').strip()
                    variante_descripcion = None
                    variante_activo = True

                if not variante_nombre:
                    continue
                if variante_nombre.lower() == nombre.lower():
                    continue
                if variante_nombre.lower() in seen:
                    continue

                seen.add(variante_nombre.lower())
                db.session.add(SaborArtesanalTablaItem(
                    categoria=categoria_normalizada,
                    nombre=variante_nombre,
                    descripcion=variante_descripcion,
                    parent=item,
                    activo=variante_activo,
                    usuario_id=getattr(current_user, 'id', None),
                ))

        db.session.commit()
        return jsonify({
            'mensaje': 'Item creado correctamente',
            'item': _serialize_sabor_item(item),
        }), 201
    except Exception as exc:
        db.session.rollback()
        logger.error('Error creando item de Sabor Artesanal (%s): %s', categoria_normalizada, exc)
        return jsonify({'error': 'No se pudo crear el item'}), 500


@sabor_artesanal_bp.route('/tablas/items/<int:item_id>', methods=['PUT'])
@login_required
def actualizar_tabla_sabor_artesanal(item_id):
    _ensure_sabor_artesanal_schema()
    item = SaborArtesanalTablaItem.query.options(
        selectinload(SaborArtesanalTablaItem.parent)
    ).get_or_404(item_id)
    data = request.get_json() or {}

    nombre = (data.get('nombre') or item.nombre or '').strip()
    if not nombre:
        return jsonify({'error': 'El nombre es obligatorio'}), 400

    parent_id, parent_error = _resolver_parent_id(data, item.categoria, item_actual=item)
    if parent_error:
        return jsonify({'error': parent_error}), 400

    if _buscar_item_existente(item.categoria, nombre, parent_id, excluding_id=item.id):
        return jsonify({'error': 'Ya existe un item con ese nombre en esta tabla'}), 409

    try:
        item.nombre = nombre
        item.descripcion = (data.get('descripcion') or '').strip() or None
        item.parent_id = parent_id
        if 'activo' in data:
            item.activo = _parse_bool(data.get('activo'), True)
        db.session.commit()
        return jsonify({
            'mensaje': 'Item actualizado correctamente',
            'item': _serialize_sabor_item(item),
        }), 200
    except Exception as exc:
        db.session.rollback()
        logger.error('Error actualizando item de Sabor Artesanal (%s): %s', item_id, exc)
        return jsonify({'error': 'No se pudo actualizar el item'}), 500


@sabor_artesanal_bp.route('/tablas/items/<int:item_id>', methods=['DELETE'])
@login_required
def eliminar_tabla_sabor_artesanal(item_id):
    _ensure_sabor_artesanal_schema()
    item = SaborArtesanalTablaItem.query.options(
        selectinload(SaborArtesanalTablaItem.children)
    ).get_or_404(item_id)

    try:
        item_nombre = item.nombre
        cantidad_hijos = len(item.children or [])
        db.session.delete(item)
        db.session.commit()

        if cantidad_hijos > 0:
            mensaje = f'Se elimino {item_nombre} junto con {cantidad_hijos} variante(s).'
        else:
            mensaje = f'Se elimino {item_nombre}.'

        return jsonify({'mensaje': mensaje}), 200
    except Exception as exc:
        db.session.rollback()
        logger.error('Error eliminando item de Sabor Artesanal (%s): %s', item_id, exc)
        return jsonify({'error': 'No se pudo eliminar el item'}), 500

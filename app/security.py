from __future__ import annotations

from typing import Iterable


MENU_OPTION_DEFINITIONS = [
    {
        'module': 'gestion_informacion',
        'permiso': 'menu_gestion_informacion',
        'nombre': 'Atenciones',
        'descripcion': 'Acceso al modulo de atenciones',
        'orden': 10,
    },
    {
        'module': 'ventas',
        'permiso': 'menu_ventas',
        'nombre': 'Ventas',
        'descripcion': 'Acceso al modulo de ventas',
        'orden': 20,
    },
    {
        'module': 'compras',
        'permiso': 'menu_compras',
        'nombre': 'Compras',
        'descripcion': 'Acceso al modulo de compras',
        'orden': 30,
    },
    {
        'module': 'comercial',
        'permiso': 'menu_comercial',
        'nombre': 'Vendedores',
        'descripcion': 'Acceso al modulo Vendedores',
        'orden': 40,
    },
    {
        'module': 'informes',
        'permiso': 'menu_informes',
        'nombre': 'Informes',
        'descripcion': 'Acceso al modulo de informes',
        'orden': 50,
    },
    {
        'module': 'usuarios',
        'permiso': 'menu_usuarios',
        'nombre': 'Usuarios',
        'descripcion': 'Acceso al modulo de usuarios y roles',
        'orden': 60,
    },
    {
        'module': 'tablas',
        'permiso': 'menu_tablas',
        'nombre': 'Tablas',
        'descripcion': 'Acceso al modulo de tablas',
        'orden': 70,
    },
]

def _build_commercial_crud_definitions(entity: str, nombre: str, orden_base: int):
    acciones = [
        ('read', 'Consultar', f'Puede consultar {nombre.lower()}'),
        ('create', 'Crear', f'Puede crear {nombre.lower()}'),
        ('update', 'Editar', f'Puede editar {nombre.lower()}'),
        ('delete', 'Eliminar', f'Puede eliminar {nombre.lower()}'),
    ]
    definitions = []
    for index, (action, action_name, description) in enumerate(acciones, start=1):
        definitions.append({
            'category': 'comercial',
            'module': 'comercial',
            'group': nombre,
            'entity': entity,
            'action': action,
            'permiso': f'comercial_{entity}_{action}',
            'nombre': f'{nombre}: {action_name}',
            'descripcion': description,
            'orden': orden_base + index,
        })
    return definitions


COMMERCIAL_PERMISSION_DEFINITIONS = (
    _build_commercial_crud_definitions('vendedores', 'Vendedores', 1000)
    + _build_commercial_crud_definitions('clientes', 'Clientes Comerciales', 1100)
    + _build_commercial_crud_definitions('examenes', 'Examenes', 1200)
    + _build_commercial_crud_definitions('paquetes', 'Paquetes', 1300)
    + _build_commercial_crud_definitions('tarifas', 'Tarifas Comerciales', 1400)
    + _build_commercial_crud_definitions('atenciones', 'Atenciones Comerciales', 1500)
    + _build_commercial_crud_definitions('documentos', 'Documentos de Seguimiento', 1600)
    + _build_commercial_crud_definitions('pagos', 'Pagos de Seguimiento', 1700)
    + _build_commercial_crud_definitions('comisiones', 'Comisiones', 1800)
    + [
        {
            'category': 'comercial',
            'module': 'comercial',
            'group': 'Comisiones',
            'entity': 'comisiones',
            'action': 'validate',
            'permiso': 'comercial_comisiones_validate',
            'nombre': 'Comisiones: Validar sin soporte',
            'descripcion': 'Puede aprobar o rechazar comisiones de pagos que no tienen soporte adjunto',
            'orden': 1805,
        },
    ]
)


def _commercial_section_permissions(*entities: str, include_validate: bool = False) -> list[str]:
    actions = ('read', 'create', 'update', 'delete')
    permissions = [
        f'comercial_{entity}_{action}'
        for entity in entities
        for action in actions
    ]
    if include_validate:
        permissions.append('comercial_comisiones_validate')
    return permissions


def _commercial_section_definition(
    section: str,
    nombre: str,
    descripcion: str,
    orden: int,
    *entities: str,
    include_validate: bool = False,
):
    section_permission = f'comercial_section_{section}'
    return {
        'category': 'comercial_section',
        'module': 'comercial',
        'group': 'Vendedores',
        'section': section,
        'permiso': section_permission,
        'permission_names': [
            section_permission,
            *_commercial_section_permissions(*entities, include_validate=include_validate),
        ],
        'nombre': nombre,
        'descripcion': descripcion,
        'orden': orden,
    }


COMMERCIAL_SECTION_DEFINITIONS = [
    _commercial_section_definition('vendedores', 'Vendedores', 'Acceso a la pestana Vendedores', 2000, 'vendedores'),
    _commercial_section_definition('examenes', 'Examenes', 'Acceso a la pestana Examenes', 2010, 'examenes', 'paquetes'),
    _commercial_section_definition('clientes', 'Clientes', 'Acceso a la pestana Clientes', 2020, 'clientes', 'tarifas', 'documentos', 'pagos'),
    _commercial_section_definition('gestion_informacion', 'Gestion Informacion', 'Acceso a la pestana Gestion Informacion', 2030, 'atenciones'),
    _commercial_section_definition('caja', 'Registro Caja', 'Acceso a la pestana Registro Caja', 2040, 'atenciones'),
    _commercial_section_definition('mes', 'Mes', 'Acceso a la pestana Mes', 2050),
    _commercial_section_definition('comisiones', 'Comisiones', 'Acceso a la pestana Comisiones', 2060, 'comisiones', include_validate=True),
    _commercial_section_definition('inicio', 'Inicio', 'Acceso a la pestana Inicio', 2070),
]


ROLE_PERMISSION_DEFINITIONS = (
    MENU_OPTION_DEFINITIONS
    + COMMERCIAL_PERMISSION_DEFINITIONS
    + COMMERCIAL_SECTION_DEFINITIONS
)


def get_menu_definition_by_permission(permission_name: str):
    for definition in MENU_OPTION_DEFINITIONS:
        if definition['permiso'] == permission_name:
            return definition
    return None


def get_role_permission_definition(permission_name: str):
    for definition in ROLE_PERMISSION_DEFINITIONS:
        if definition['permiso'] == permission_name:
            return definition
    return None


def get_menu_definition_by_module(module_name: str):
    for definition in MENU_OPTION_DEFINITIONS:
        if definition['module'] == module_name:
            return definition
    return None


def get_allowed_menu_modules_for_role(role) -> list[str]:
    if role is None:
        return []

    permission_names = get_permission_names_for_role(role)
    modules = []
    for definition in MENU_OPTION_DEFINITIONS:
        if definition['permiso'] in permission_names:
            modules.append(definition['module'])
    return modules


def get_permission_names_for_role(role) -> set[str]:
    if role is None:
        return set()
    return {
        permiso.nombre
        for permiso in getattr(role, 'permisos', [])
        if getattr(permiso, 'nombre', None)
    }


def get_permission_names_for_user(usuario) -> set[str]:
    """Combina permisos del rol + permisos extra asignados directamente al usuario.
    Si el usuario es EASY devuelve {'*'} (acceso total).
    Es tolerante a fallos si la tabla usuario_permiso aún no existe (migración pendiente)."""
    if usuario is None:
        return set()
    if getattr(usuario, 'is_easy', False):
        return {'*'}
    role_perms = get_permission_names_for_role(getattr(usuario, 'role', None))
    try:
        extra_perms = {
            permiso.nombre
            for permiso in getattr(usuario, 'permisos_extra', [])
            if getattr(permiso, 'nombre', None)
        }
    except Exception:
        # La tabla usuario_permiso puede no existir si la migración está pendiente
        extra_perms = set()
    return role_perms | extra_perms


def sort_role_permission_records(records: Iterable) -> list:
    order_map = {definition['permiso']: definition['orden'] for definition in ROLE_PERMISSION_DEFINITIONS}
    return sorted(
        list(records),
        key=lambda record: order_map.get(getattr(record, 'nombre', ''), 9999),
    )


def sort_menu_permission_records(records: Iterable) -> list:
    return sort_role_permission_records(records)

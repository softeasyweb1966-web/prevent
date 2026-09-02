from flask import Blueprint

# Blueprint de autenticación
auth_bp = Blueprint('auth', __name__, url_prefix='/api/auth')

# Blueprint de dashboard
dashboard_bp = Blueprint('dashboard', __name__, url_prefix='/api/dashboard')

# Blueprint de nómina

# Blueprint de usuarios
usuarios_bp = Blueprint('usuarios', __name__, url_prefix='/api/usuarios')

# Blueprint de parámetros

# Blueprint de servicios

# Blueprint de bancos / préstamos de empresa
comercial_bp = Blueprint('comercial', __name__, url_prefix='/api/comercial')
contable_bp = Blueprint('contable', __name__, url_prefix='/api/contable')

# Importar las rutas
from app.routes import auth, dashboard, usuarios, comercial, contable, cargue_atenciones


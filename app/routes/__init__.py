from flask import Blueprint

# Blueprint de autenticación
auth_bp = Blueprint('auth', __name__, url_prefix='/api/auth')

# Blueprint de dashboard
dashboard_bp = Blueprint('dashboard', __name__, url_prefix='/api/dashboard')

# Blueprint de nómina
nomina_bp = Blueprint('nomina', __name__, url_prefix='/api/nomina')

# Blueprint de usuarios
usuarios_bp = Blueprint('usuarios', __name__, url_prefix='/api/usuarios')

# Blueprint de parámetros
parametros_bp = Blueprint('parametros', __name__, url_prefix='/api/parametros')

# Blueprint de servicios
servicios_bp = Blueprint('servicios', __name__, url_prefix='/api/servicios')

# Blueprint de bancos / préstamos de empresa
bancos_bp = Blueprint('bancos', __name__, url_prefix='/api/bancos')

# Importar las rutas
from app.routes import auth, dashboard, nomina, usuarios, parametros, servicios, bancos


"""Integración real en PostgreSQL aislado prevent_test_ac_* (nunca producción)."""
from datetime import datetime, date
from decimal import Decimal
from io import BytesIO
import os
import unittest

from flask import Flask, g
from flask_login import LoginManager
from openpyxl import Workbook
from sqlalchemy import text
from sqlalchemy.engine import make_url

from app.models import (db, Role, Permiso, Usuario, Vendedor, ClienteComercial, ContactoCliente,
    ComercialCatalogoItem, ClienteComercialTarifa, SiigoCarga, SiigoComprobante, SiigoMovimiento,
    PrefacturaComercial, OrdenServicioCaja, ClienteVendedorHistorial)
from app.routes import comercial_bp, contable_bp, dashboard_bp
from app.security import ROLE_PERMISSION_DEFINITIONS


class MaestroTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        url = os.environ.get('TEST_DATABASE_URL')
        if not url:
            raise unittest.SkipTest('Requiere PostgreSQL TEST_DATABASE_URL')
        parsed = make_url(url)
        if not parsed.drivername.startswith('postgresql') or not parsed.database.startswith('prevent_test_ac_'):
            raise RuntimeError('Use una base exclusiva prevent_test_ac_*')
        cls.app = Flask(__name__, template_folder='../app/templates', static_folder='../app/static')
        cls.app.config.update(TESTING=True, SECRET_KEY='test-only', SQLALCHEMY_DATABASE_URI=url)
        db.init_app(cls.app)
        login = LoginManager(cls.app)
        login.user_loader(lambda uid: db.session.get(Usuario, int(uid)))
        login.unauthorized_handler(lambda: ({'error':'Sesion requerida'},401))
        for bp in (comercial_bp, contable_bp, dashboard_bp):
            cls.app.register_blueprint(bp)
        cls.app.jinja_env.globals['asset_url'] = lambda path:'/static/'+path
        with cls.app.app_context():
            db.create_all()
            # Prueba también las restricciones reales de la migración del maestro.
            import importlib
            from alembic.migration import MigrationContext
            from alembic.operations import Operations
            module = importlib.import_module('migrations.versions.20260911_040_maestro_clientes')
            with db.engine.begin() as connection:
                with Operations.context(MigrationContext.configure(connection)):
                    module.upgrade()

    def setUp(self):
        self.ctx = self.app.app_context(); self.ctx.push()
        self.limpiar()
        admin_role = Role(nombre='Administrador')
        seller_role = Role(nombre='Vendedor prueba')
        seller_role.permisos = [Permiso(nombre=n) for n in sorted({x['permiso'] for x in ROLE_PERMISSION_DEFINITIONS})]
        db.session.add_all([admin_role,seller_role]); db.session.flush()
        self.users = [Usuario(nombre_completo='Login '+str(i), usuario='login'+str(i), email=f'login{i}@example.test',
                              password_hash='no-login',role_id=admin_role.id if i==0 else seller_role.id) for i in range(4)]
        db.session.add_all(self.users); db.session.flush()
        self.v1 = Vendedor(nombre='Vendedor Excel Uno',usuario_id=self.users[1].id)
        self.v2 = Vendedor(nombre='Vendedor Excel Dos',usuario_id=self.users[2].id)
        db.session.add_all([self.v1,self.v2]); db.session.flush()
        self.c1 = ClienteComercial(nit='9001',razon_social='Empresa Uno',vendedor_id=self.v1.id,telefono_empresa='123')
        self.c2 = ClienteComercial(nit='9002',razon_social='Empresa Dos',vendedor_id=self.v2.id,telefono_empresa='456')
        self.c3 = ClienteComercial(nit='9003',razon_social='Sin vendedor',telefono_empresa='789')
        db.session.add_all([self.c1,self.c2,self.c3]);db.session.commit()
        self.http = self.app.test_client()

    def limpiar(self):
        db.session.rollback()
        tables = ','.join('"'+t.name+'"' for t in db.metadata.sorted_tables)
        db.session.execute(text('TRUNCATE '+tables+' RESTART IDENTITY CASCADE'));db.session.commit()

    def tearDown(self):
        self.limpiar(); db.session.remove();self.ctx.pop()

    def login(self, index):
        g.pop('_login_user', None)
        with self.http.session_transaction() as session:
            session['_user_id']=str(self.users[index].id);session['_fresh']=True

    def factura(self, nit, nombre, total, numero):
        carga=SiigoCarga(tipo_archivo='COMPROBANTES',nombre_archivo='test.xlsx',hash_archivo=str(numero))
        db.session.add(carga);db.session.flush()
        doc=SiigoComprobante(tipo_documento='FV',codigo_comprobante='2',numero_comprobante=str(numero),
            fecha_elaboracion=date(2026,1,1),carga_id=carga.id,total_debito=total,total_credito=0)
        doc.movimientos.append(SiigoMovimiento(secuencia=1,codigo_contable='13050501',cuenta_contable='Clientes',
            identificacion=nit,nombre_tercero=nombre,debito=total,credito=0,
            detalle=f'FV-2-{numero} Cuota: 1 Fecha: 31/01/2026'))
        db.session.add(doc);db.session.commit();return doc

    def excel(self, rows):
        workbook=Workbook();sheet=workbook.active
        sheet.append(['Nombre tercero','Identificacion','VENDEDOR','CONTACTO','TELEFONO CONTACTO'])
        for row in rows:sheet.append(row)
        stream=BytesIO();workbook.save(stream);stream.seek(0);return stream

    def test_cliente_nuevo_asignado_y_visible_en_todos_los_modulos(self):
        self.login(1)
        response=self.http.post('/api/comercial/maestro/clientes',json={'nit':'9010','razon_social':'Nueva empresa'})
        self.assertEqual(response.status_code,201,response.json)
        self.assertEqual(response.json['vendedor_id'],self.v1.id)
        for path in ['/api/comercial/maestro/clientes','/api/comercial/clientes']:
            self.assertEqual(len(self.http.get(path).json),2)
        self.assertEqual(len(self.http.get('/api/contable/clientes').json['clientes']),2)
        r=self.http.get('/api/comercial/cargue-atenciones/clientes-sugeridos?q=Nueva')
        self.assertEqual(r.json['clientes'][0]['id'],response.json['id'])
        self.login(2)
        self.assertEqual(len(self.http.get('/api/comercial/maestro/clientes').json),1)

    def test_vendedor_no_puede_asignarse_a_otro_ni_editar_cliente_ajeno(self):
        self.login(1)
        self.assertEqual(self.http.post('/api/comercial/maestro/clientes',json={'nit':'9010','razon_social':'Nueva','vendedor_id':self.v2.id}).status_code,403)
        self.assertEqual(self.http.put(f'/api/comercial/maestro/clientes/{self.c2.id}',json={'nit':'9002','razon_social':'Cambio'}).status_code,403)

    def test_usuario_sin_vendedor_no_recibe_datos_generales(self):
        self.login(3)
        for path in ['/api/comercial/clientes','/api/comercial/comisiones/liquidaciones','/api/comercial/recaudos/comision-acumulada','/api/contable/resumen']:
            self.assertEqual(self.http.get(path).status_code,403,path)
        self.assertEqual(self.http.get('/api/dashboard/comercial').json['clientes_activos'],0)

    def test_cartera_y_exportacion_filtran_vendedor_aunque_envie_otro(self):
        self.factura('9.001-1','Empresa Uno',Decimal('100'),1)
        self.factura('9002','Empresa Dos',Decimal('900'),2)
        self.login(1)
        path='/api/contable/cartera-dinamica?fecha_corte=2026-03-01&informe=vencidas'
        data=self.http.get(path).json
        self.assertEqual(data['total_vencido'],100)
        self.assertEqual(data['clientes'][0]['vendedor'],self.v1.nombre)
        self.assertEqual(self.http.get(path+f'&vendedor_id={self.v2.id}').json['cantidad_clientes'],0)
        self.assertEqual(self.http.get(path+'&formato=xlsx').status_code,200)
        self.assertEqual(self.http.get('/api/contable/seguimiento-cartera?identificacion=9002').status_code,404)
        self.login(0)
        self.assertEqual(self.http.get(path).json['total_vencido'],1000)

    def test_comprobante_con_varios_terceros_no_revela_total_ajeno(self):
        doc=self.factura('9001','Empresa Uno',Decimal('100'),1)
        doc.movimientos.append(SiigoMovimiento(secuencia=2,codigo_contable='13050501',cuenta_contable='Clientes',identificacion='9002',nombre_tercero='Empresa Dos',debito=900,credito=0))
        doc.total_debito=1000;db.session.commit();self.login(1)
        data=self.http.get('/api/contable/comprobantes').json['comprobantes']
        self.assertEqual(data[0]['debito'],100);self.assertEqual(data[0]['movimientos'],1)

    def test_detalle_prefactura_y_pagos_rechazan_otro_vendedor(self):
        pref=PrefacturaComercial(cliente_id=self.c2.id,nombre_empresa='Empresa Dos',fecha_desde=datetime(2026,1,1),fecha_hasta=datetime(2026,1,31),forma_pago='CREDITO')
        db.session.add(pref);db.session.commit();self.login(1)
        for suffix in ['', '/cartera']:
            self.assertEqual(self.http.get(f'/api/comercial/prefacturas/{pref.id}'+suffix).status_code,403)
        self.assertEqual(self.http.post(f'/api/comercial/prefacturas/{pref.id}/cartera',json={}).status_code,403)

    def test_importacion_conserva_nuevos_y_agrupa_contactos_sin_duplicar(self):
        self.login(0)
        rows=[['Empresa A','9011','Vendedor Excel Uno','Contacto compartido','555'],['Empresa B','9012','Vendedor Excel Uno','Contacto compartido','555']]
        response=self.http.post('/api/contable/cargar-clientes',data={'archivo':(self.excel(rows),'clientes.xlsx')})
        self.assertEqual(response.status_code,200,response.json)
        self.assertEqual(response.json['creados'],2)
        self.assertEqual(response.json['conservados_fuera_archivo'],3)
        self.assertTrue(db.session.get(ClienteComercial,self.c1.id).activo)
        contacto=ContactoCliente.query.one();self.assertEqual(len(contacto.clientes),2)
        response=self.http.post('/api/contable/cargar-clientes',data={'archivo':(self.excel(rows),'clientes.xlsx')})
        self.assertEqual(ClienteComercial.query.count(),5)
        self.assertEqual(ContactoCliente.query.count(),1)
        self.assertEqual(Vendedor.query.count(),2)

    def test_reemplazo_destructivo_rechazado(self):
        self.login(0)
        r=self.http.post('/api/contable/cargar-clientes',data={'reemplazar':'1','archivo':(self.excel([['A','9011','','','']]),'clientes.xlsx')})
        self.assertEqual(r.status_code,400);self.assertEqual(ClienteComercial.query.count(),3)

    def test_paquetes_por_empresa_y_tarifa_ajena(self):
        item=ComercialCatalogoItem(nombre='Paquete prueba',tipo_item='PAQUETE',tarifa_base=100)
        db.session.add(item);db.session.flush()
        tarifa=ClienteComercialTarifa(cliente_id=self.c1.id,catalogo_item_id=item.id,tarifa_negociada=90)
        db.session.add(tarifa);db.session.commit();self.login(1)
        clientes=self.http.get('/api/comercial/maestro/clientes').json
        self.assertEqual(clientes[0]['paquetes_vigentes'],1)
        self.login(2)
        self.assertEqual(self.http.get('/api/comercial/tarifas').json,[])
        self.assertEqual(self.http.delete(f'/api/comercial/tarifas/{tarifa.id}').status_code,403)

    def test_cambio_vendedor_conserva_historial(self):
        self.login(0)
        r=self.http.put(f'/api/comercial/maestro/clientes/{self.c1.id}',json={'nit':'9001','razon_social':'Empresa Uno','vendedor_id':self.v2.id})
        self.assertEqual(r.status_code,200,r.json)
        h=ClienteVendedorHistorial.query.one()
        self.assertEqual((h.vendedor_anterior_id,h.vendedor_nuevo_id),(self.v1.id,self.v2.id))
        self.assertEqual(h.usuario_id,self.users[0].id)

    def test_pantalla_maestro_renderiza(self):
        self.login(0)
        r=self.http.get('/api/comercial/maestros')
        self.assertEqual(r.status_code,200)
        self.assertIn('Empresas agrupadas',r.text)

    def test_reasignar_vendedor_conserva_contacto_y_visibilidad(self):
        from app.clientes_maestro import vincular_contacto
        self.c3.vendedor_id = self.v1.id
        db.session.flush()
        contacto = vincular_contacto(self.c1, 'Contacto compartido', '555')
        vincular_contacto(self.c3, 'Contacto compartido', '555')
        db.session.commit()
        self.login(0)
        response = self.http.put(f'/api/comercial/maestro/clientes/{self.c1.id}', json={
            'razon_social': self.c1.razon_social, 'nit': self.c1.nit,
            'vendedor_id': self.v2.id, 'contactos_ids': [contacto.id]})
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(response.json['contactos'][0]['telefono'], '555')
        self.assertNotEqual(response.json['contactos_ids'], [contacto.id])
        self.assertEqual(contacto.vendedor_id, self.v1.id)
        self.assertEqual(self.c3.contactos, [contacto])
        self.factura('9001', 'Empresa Uno', Decimal('100'), 1)
        self.login(2)
        self.assertIn(self.c1.id, [c['id'] for c in self.http.get('/api/comercial/clientes').json])
        reporte = self.http.get('/api/contable/cartera-dinamica?informe=vencidas&fecha_corte=2026-03-01').json
        self.assertEqual(reporte['clientes'][0]['vendedor'], self.v2.nombre)
        self.login(1)
        self.assertNotIn(self.c1.id, [c['id'] for c in self.http.get('/api/comercial/clientes').json])

    def test_recuperar_tabla_siigo_anterior_y_reimportar_mismo_archivo(self):
        import importlib
        from hashlib import sha256
        from alembic.migration import MigrationContext
        from alembic.operations import Operations
        contenido = self.excel([['Nombre anterior', '9001', '', '', ''], ['Recuperada', '9011', 'Vendedor Excel Dos', '', '']]).getvalue()
        carga = SiigoCarga(tipo_archivo='CLIENTES', nombre_archivo='anterior.xlsx', hash_archivo=sha256(contenido).hexdigest())
        db.session.add(carga); db.session.flush()
        db.session.execute(text('''CREATE TABLE IF NOT EXISTS siigo_clientes (
            id integer PRIMARY KEY, identificacion varchar(50), sucursal varchar(30),
            nombre varchar(255), tipo_identificacion varchar(30), digito_verificacion varchar(10),
            direccion varchar(255), ciudad varchar(120), telefono varchar(80), estado varchar(30),
            carga_id integer REFERENCES siigo_cargas(id), created_at timestamp, updated_at timestamp)'''))
        db.session.execute(text('''INSERT INTO siigo_clientes (id,identificacion,sucursal,nombre,telefono,estado,carga_id,created_at)
            VALUES (1,'9.001-1','0','Nombre anterior','999','ACTIVO',:carga,now()),
                   (2,'9011','0','Recuperada','222','ACTIVO',:carga,now()),
                   (3,'9011','1','Otra sucursal','333','ACTIVO',:carga,now())'''), {'carga': carga.id})
        module = importlib.import_module('migrations.versions.20260913_043_recuperar_clientes_siigo')
        with Operations.context(MigrationContext.configure(db.session.connection())):
            module.upgrade(); module.upgrade()
        db.session.commit(); db.session.expire_all()
        self.assertEqual(ClienteComercial.query.count(), 4)
        self.assertEqual(self.c1.vendedor_id, self.v1.id)
        self.assertEqual(self.c1.telefono_empresa, '123')
        self.assertEqual(self.c1.razon_social, 'Empresa Uno')
        recuperada = ClienteComercial.query.filter_by(nit='9011').one()
        self.assertIn('Otra sucursal', recuperada.nombres_alternativos)
        self.assertIsNone(recuperada.vendedor_id)
        self.login(0)
        self.assertEqual(self.http.get('/api/contable/resumen').json['clientes'], 4)
        response = self.http.post('/api/contable/cargar-clientes', data={'archivo': (BytesIO(contenido), 'anterior.xlsx')})
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(recuperada.vendedor_id, self.v2.id)
        self.assertEqual(ClienteComercial.query.count(), 4)

    def test_consulta_ventas_no_oculta_clientes_despues_de_cien(self):
        db.session.add_all([ClienteComercial(nit=str(80000+i), razon_social=f'Cliente {i}') for i in range(105)])
        db.session.commit(); self.login(0)
        self.assertEqual(len(self.http.get('/api/contable/clientes').json['clientes']), 108)
        self.assertEqual(self.http.get('/api/contable/resumen').json['clientes_sin_vendedor'], 106)


if __name__ == '__main__':
    unittest.main()

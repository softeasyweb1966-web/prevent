"""Prueba manual automatizada: TEST_DATABASE_URL aislada y Playwright/Chrome."""
import json
import logging
import os
from pathlib import Path
import sys
import threading

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from test_clientes_maestro import MaestroTest
from app.models import db, ComercialCatalogoItem, ClienteComercial
from werkzeug.serving import make_server
from playwright.sync_api import sync_playwright, expect


def main():
    logging.getLogger('werkzeug').setLevel(logging.ERROR)
    MaestroTest.setUpClass()
    fixture = MaestroTest(); fixture.setUp(); fixture.login(0)
    item = ComercialCatalogoItem(nombre='Servicio navegador', tipo_item='EXAMEN', tipo_examen='CONSULTA', tarifa_base=100)
    db.session.add(item); db.session.commit()
    item_id = item.id
    db.session.add_all([ClienteComercial(nit=str(700000+i), razon_social=f'Empresa volumen {i:04d}') for i in range(1005)])
    db.session.commit()
    server = make_server('127.0.0.1', 5087, fixture.app, threaded=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel='chrome', headless=True)
            context = browser.new_context(viewport={'width':1366, 'height':900})
            context.add_cookies([{'name':'session', 'value':fixture.http.get_cookie('session').value,
                                 'domain':'127.0.0.1', 'path':'/'}])
            page = context.new_page(); errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto('http://127.0.0.1:5087/api/comercial/maestros')
            page.wait_for_function('M.clientes.length === 1008')
            expect(page.locator('#panel-grupos')).to_have_class('maestros-panel active')
            assert page.locator('.grupo-vendedor').count() == 3
            assert page.locator('.grupo-vendedor[open]').count() == 0
            assert page.locator('.empresa-fila').count() == 0
            assert page.locator('#tbodyClientes tr').count() == 1  # Solo el marcador inicial.
            assert page.locator('#serviciosCliente option').count() == 0
            sin_asignar = page.locator('.grupo-vendedor').filter(has=page.locator('summary', has_text='Sin asignar'))
            sin_asignar.locator(':scope > summary').click()
            expect(sin_asignar.locator('.grupo-contacto')).to_have_count(1)
            expect(sin_asignar.locator('.grupo-contacto > summary')).to_contain_text('Empresas sin contacto')
            expect(sin_asignar.locator('.grupo-contacto > summary')).to_contain_text('1006 empresas')
            sin_asignar.locator('.grupo-contacto > summary').click()
            expect(sin_asignar.locator('.empresa-fila')).to_have_count(50)
            assert sin_asignar.locator('.empresa-nombre').first.inner_text() == 'Empresa volumen 0000'
            sin_asignar.get_by_role('button', name='Siguiente').click()
            expect(sin_asignar.locator('.empresa-nombre').first).to_have_text('Empresa volumen 0050')
            sin_asignar.get_by_role('button', name='Anterior').click()
            expect(sin_asignar.locator('.empresa-nombre').first).to_have_text('Empresa volumen 0000')
            sin_asignar.locator(':scope > summary').click()
            expect(sin_asignar.locator('.empresa-fila')).to_have_count(0)

            def buscar(texto, nombre):
                page.locator('#buscarMaestro').fill(texto)
                page.wait_for_function('(q)=>vistaMaestro.firma.split("|")[0]===q', arg=texto)
                expect(page.locator('.empresa-nombre', has_text=nombre)).to_be_visible()

            buscar('Empresa Uno', 'Empresa Uno')
            page.get_by_role('button', name='Ver Empresa Uno', exact=True).click()
            expect(page.locator('#tituloVerEmpresa')).to_have_text('Empresa Uno')
            page.locator('#modalVerEmpresa').get_by_role('button', name='Editar', exact=True).click()
            expect(page.locator('#clienteNit')).to_have_value('9001')
            page.locator('#clienteCiudad').fill('Bogotá')
            page.locator('#modalCliente').get_by_role('button', name='Guardar', exact=True).click()
            page.wait_for_function("M.clientes.some(c=>c.nit==='9001' && c.ciudad==='Bogotá')")
            expect(page.locator('#buscarMaestro')).to_have_value('Empresa Uno')
            expect(page.get_by_role('button', name='Ver Empresa Uno', exact=True)).to_be_visible()
            page.get_by_role('button', name='Ver Empresa Uno', exact=True).click()
            page.locator('#modalVerEmpresa').get_by_role('button', name='Agregar contacto').click()
            assert page.locator('#contactoVendedor').input_value() == str(fixture.v1.id)
            assert page.locator('#contactoClientes input:checked').count() == 1
            assert page.locator('#contactoClientes input:checked').input_value() == str(fixture.c1.id)
            page.locator('#contactoNombre').fill('Contacto desde agrupadas')
            page.locator('#contactoTelefono').fill('555123')
            page.locator('#modalContacto').get_by_role('button', name='Guardar', exact=True).click()
            page.wait_for_function("M.clientes.some(c => c.contactos_agrupacion?.some(p => p.nombre === 'Contacto desde agrupadas'))")
            for consulta in ('9.001', 'Contacto desde agrupadas', '555-123', fixture.v1.nombre):
                buscar(consulta, 'Empresa Uno')
            assert page.locator('#gruposEmpresas').get_by_role('button', name='Servicios', exact=True).count() == 0
            page.locator('#filtroRevisionMaestro').select_option('sin_contacto')
            expect(page.locator('.empresa-nombre', has_text='Empresa Uno')).to_have_count(0)
            page.locator('#filtroRevisionMaestro').select_option('')
            buscar('Empresa volumen 1004', 'Empresa volumen 1004')
            page.set_viewport_size({'width':390, 'height':844})
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
            page.get_by_role('button', name='Ver Empresa volumen 1004', exact=True).click()
            expect(page.locator('#detalleVerEmpresa')).to_contain_text('Sin asignar')
            assert page.locator('#modalVerEmpresa .m-modal-card').evaluate('(el)=>el.getBoundingClientRect().right <= innerWidth')
            page.screenshot(path=str(Path(os.environ.get('TEMP','.'))/'prevent-maestro-mobile.png'), full_page=True)
            page.locator('#modalVerEmpresa').get_by_role('button', name='Cerrar', exact=True).click()
            page.set_viewport_size({'width':1366, 'height':900})
            page.locator('#buscarMaestro').fill('no existe ninguna empresa')
            expect(page.locator('#gruposEmpresas')).to_contain_text('No hay empresas')
            page.locator('#buscarMaestro').fill('')
            page.wait_for_function('document.querySelectorAll(".grupo-vendedor").length === 3')
            page.locator('[data-tab=clientes]').click()
            page.locator('#btnNuevoCliente').click()
            page.locator('#clienteNit').fill('9999')
            page.locator('#clienteRazon').fill('Cliente navegador')
            page.locator('#clienteVendedor').select_option(str(fixture.v1.id))
            page.locator('#modalCliente').get_by_role('button', name='Guardar', exact=True).click()
            page.wait_for_function('M.clientes.length === 1009')
            page.locator('#filtroRevisionMaestro').select_option('sin_vendedor')
            assert page.locator('#tbodyClientes tr').count() == 50
            page.locator('#filtroRevisionMaestro').select_option('')
            page.locator('[data-tab=servicios]').click()
            page.locator('#serviciosCliente').select_option(str(fixture.c1.id))
            page.locator('#btnNuevaTarifa').click()
            page.locator('#tarifaMaestroItem').select_option(str(item_id))
            page.locator('#tarifaMaestroValor').fill('75')
            page.locator('#formTarifaMaestro').get_by_role('button', name='Guardar', exact=True).click()
            page.wait_for_function('M.tarifas.length === 1')
            assert 'Servicio navegador' in page.locator('#serviciosEmpresaDetalle').inner_text()
            page.locator('#serviciosEmpresaDetalle').get_by_role('button', name='Editar').click()
            page.locator('#tarifaMaestroValor').fill('80')
            page.locator('#formTarifaMaestro').get_by_role('button', name='Guardar', exact=True).click()
            page.wait_for_function('M.tarifas[0]?.tarifa_negociada === 80')
            # El detalle reutiliza la consulta existente de servicios y de historial.
            page.locator('[data-tab=grupos]').click()
            buscar('9001', 'Empresa Uno')
            page.get_by_role('button', name='Ver Empresa Uno', exact=True).click()
            page.locator('#modalVerEmpresa').get_by_role('button', name='Servicios', exact=True).click()
            expect(page.locator('#serviciosEmpresaDetalle')).to_contain_text('Servicio navegador')
            page.locator('[data-tab=grupos]').click()
            page.get_by_role('button', name='Ver Empresa Uno', exact=True).click()
            page.locator('#modalVerEmpresa').get_by_role('button', name='Origen e historial', exact=True).click()
            expect(page.locator('#origenMaestroDetalle')).to_contain_text('Empresa Uno')
            page.locator('#modalOrigenMaestro').get_by_role('button', name='Cerrar', exact=True).click()
            # Ver no ofrece editar cuando el perfil carece del permiso.
            page.evaluate('M.permisos.clientes.update=false')
            page.get_by_role('button', name='Ver Empresa Uno', exact=True).click()
            expect(page.locator('#modalVerEmpresa').get_by_role('button', name='Editar', exact=True)).to_have_count(0)
            page.locator('#modalVerEmpresa').get_by_role('button', name='Cerrar', exact=True).click()
            fixture.login(1)
            vendedor_context = browser.new_context(viewport={'width':390, 'height':844})
            vendedor_context.add_cookies([{'name':'session', 'value':fixture.http.get_cookie('session').value,
                                          'domain':'127.0.0.1', 'path':'/'}])
            vendedor_page = vendedor_context.new_page()
            vendedor_page.on('pageerror', lambda error: errors.append(str(error)))
            vendedor_page.goto('http://127.0.0.1:5087/api/comercial/maestros')
            vendedor_page.wait_for_function('M.clientes.length === 2')
            expect(vendedor_page.locator('#filtroVendedorMaestro')).to_be_disabled()
            assert vendedor_page.locator('.grupo-vendedor').count() == 1
            assert vendedor_page.locator('.grupo-vendedor[open]').count() == 0
            assert vendedor_page.evaluate('M.clientes.every(c=>c.vendedor_id===M.vendedores[0].id)')
            respuesta = vendedor_page.request.get(f'http://127.0.0.1:5087/api/comercial/maestro/clientes/{fixture.c2.id}/origen')
            assert respuesta.status in (403,404), respuesta.status
            vendedor_context.close()
            for filename in ('dashboard.js','contable.js','maestros_relaciones.js'):
                source = (Path(__file__).resolve().parents[1]/'app'/'static'/'js'/filename).read_text(encoding='utf-8')
                page.evaluate('(source)=>{new Function(source);}', source)
            screenshot = Path(os.environ.get('TEMP','.'))/'prevent-maestro-browser.png'
            page.screenshot(path=str(screenshot), full_page=True)
            assert not errors, errors
            print(json.dumps({'navegador':'Chrome', 'resultado':'OK', 'errores_js':errors, 'captura':str(screenshot)}))
            browser.close()
    finally:
        server.shutdown(); fixture.tearDown()


if __name__ == '__main__':
    main()

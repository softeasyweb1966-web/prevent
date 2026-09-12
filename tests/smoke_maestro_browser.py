"""Prueba manual automatizada: TEST_DATABASE_URL aislada y Playwright/Chrome."""
import json
import logging
import os
from pathlib import Path
import sys
import threading

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from test_clientes_maestro import MaestroTest
from app.models import db, ComercialCatalogoItem
from werkzeug.serving import make_server
from playwright.sync_api import sync_playwright


def main():
    logging.getLogger('werkzeug').setLevel(logging.ERROR)
    MaestroTest.setUpClass()
    fixture = MaestroTest(); fixture.setUp(); fixture.login(0)
    item = ComercialCatalogoItem(nombre='Servicio navegador', tipo_item='EXAMEN', tipo_examen='CONSULTA', tarifa_base=100)
    db.session.add(item); db.session.commit()
    item_id = item.id
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
            page.wait_for_function('M.clientes.length === 3')
            page.locator('[data-tab=grupos]').click()
            page.wait_for_selector('#gruposEmpresas details')
            page.locator('[data-tab=clientes]').click()
            page.locator('#btnNuevoCliente').click()
            page.locator('#clienteNit').fill('9999')
            page.locator('#clienteRazon').fill('Cliente navegador')
            page.locator('#clienteVendedor').select_option(str(fixture.v1.id))
            page.locator('#modalCliente').get_by_role('button', name='Guardar', exact=True).click()
            page.wait_for_function('M.clientes.length === 4')
            page.locator('#filtroRevisionMaestro').select_option('sin_vendedor')
            assert page.locator('#tbodyClientes tr').count() == 1
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

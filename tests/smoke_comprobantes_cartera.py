"""Prueba Chrome contra PostgreSQL aislado configurado con TEST_DATABASE_URL."""
import base64
from datetime import date
from decimal import Decimal
import logging
from pathlib import Path
import sys
import threading

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from test_clientes_maestro import MaestroTest
from app.models import db, SiigoSeguimientoCartera
from playwright.sync_api import sync_playwright
from werkzeug.serving import make_server


def main():
    logging.getLogger('werkzeug').setLevel(logging.ERROR)
    MaestroTest.setUpClass()
    fixture = MaestroTest(); fixture.setUp(); fixture.login(1)
    fixture.factura('9001', 'Empresa Uno', Decimal('100'), 1)
    registro = SiigoSeguimientoCartera(identificacion='9001', cliente_nombre='Empresa Uno',
        fecha_gestion=date(2026, 9, 13), medio='CORREO', observaciones='Soporte recibido',
        usuario_id=fixture.users[1].id, usuario_nombre='Gestor')
    db.session.add(registro); db.session.commit()
    fixture.app.add_url_rule('/prueba-comprobantes', view_func=lambda:
        '<section id="siigoFacturasVencidasPanel"><p data-alertas-cartera></p></section>')
    server = make_server('127.0.0.1', 5089, fixture.app, threaded=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    contenido = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=')
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel='chrome', headless=True)
            context = browser.new_context()
            context.add_cookies([dict(name='session', value=fixture.http.get_cookie('session').value,
                                     domain='127.0.0.1', path='/')])
            page = context.new_page(); errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.goto('http://127.0.0.1:5089/prueba-comprobantes')
            page.add_script_tag(content=Path('app/static/js/contable.js').read_text(encoding='utf-8'))
            page.add_style_tag(content=Path('app/static/css/styles.css').read_text(encoding='utf-8'))
            page.evaluate('''async () => {
                const cliente = {identificacion:'9001', cliente:'Empresa Uno', vendedor:'Gestor', seguimientos:[]};
                document.getElementById('siigoFacturasVencidasPanel')._datosVencidas={clientes:[cliente]};
                await abrirSeguimientoCarteraSiigo(cliente);
            }''')
            page.locator('[data-adjuntos-seguimiento]').set_input_files(
                [dict(name='pago.png', mimeType='image/png', buffer=contenido)])
            page.get_by_text('Comprobantes guardados. Ya puede verlos o descargarlos.').wait_for()
            with page.expect_popup() as popup:
                page.get_by_role('link', name='Ver', exact=True).click()
            vista = popup.value
            vista.wait_for_load_state()
            assert vista.locator('img').evaluate('(img) => img.complete && img.naturalWidth === 1')
            vista.close()
            with page.expect_download() as download:
                page.get_by_role('link', name='Descargar', exact=True).click()
            assert download.value.suggested_filename == 'pago.png'
            assert Path(download.value.path()).read_bytes() == contenido
            page.get_by_role('button', name='Cerrar', exact=True).click()
            page.evaluate("abrirSeguimientoCarteraSiigo({identificacion:'9001',cliente:'Empresa Uno',vendedor:'Gestor'})")
            assert page.get_by_role('link', name='Descargar', exact=True).count() == 1
            assert not errors, errors
            browser.close()
        print('Chrome: subir, visualizar, descargar y reabrir comprobantes OK')
    finally:
        server.shutdown()
        fixture.tearDown()


if __name__ == '__main__':
    main()

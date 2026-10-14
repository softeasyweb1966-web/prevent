const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function contexto() {
    const context = vm.createContext({ M: {}, document: { addEventListener() {} } });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../app/static/js/maestros_relaciones.js'), 'utf8'), context);
    return context;
}

test('Primero pendientes por fecha de factura pendiente; luego pagados; excluye nunca facturados', () => {
    const ctx = contexto();
    const factura = (fecha, saldo) => ({ fecha_factura: fecha, saldo });
    const indice = ctx.indexarFacturacionMaestro({ cartera_clientes: [
        { identificacion: '100-1', facturas: [factura('2026-01-01', 100), factura('2026-10-01', 0)] },
        { identificacion: '200', facturas: [factura('2026-08-01', 20)] },
        { identificacion: '300', facturas: [factura('2026-09-01', 0)] },
        { identificacion: '400', facturas: [factura('2025-12-01', 0)] },
        { identificacion: '500', facturas: [] },
    ] });
    const clientes = [400, 500, 300, 100, 200, 600].map(nit => ({ id: nit, nit: String(nit), razon_social: String(nit) }));
    const resultado = ctx.ordenarClientesFacturadosMaestro(clientes, indice);
    assert.deepEqual(Array.from(resultado, c => c.id), [200, 100, 300, 400]);
    assert.deepEqual(clientes.map(c => c.id), [400, 500, 300, 100, 200, 600]);
    assert.equal(indice.get('100').ultimaPendiente, '2026-01-01');
    assert.equal(indice.get('100').ultima, '2026-10-01');
});

test('Agrupa NIT con digito de verificacion y resuelve empates por nombre', () => {
    const ctx = contexto();
    const indice = ctx.indexarFacturacionMaestro({ cartera_clientes: [
        { identificacion: '900.123-4', facturas: [{ fecha_factura: '2026-01-01', saldo: 1 }] },
        { identificacion: '900123', facturas: [{ fecha_factura: '2026-02-01', saldo: 2 }] },
        { identificacion: '800', facturas: [{ fecha_factura: '2026-02-01', saldo: 1 }] },
    ] });
    assert.equal(indice.get('900123').cantidad, 2);
    assert.equal(indice.get('900123').pendientes, 2);
    const resultado = ctx.ordenarClientesFacturadosMaestro([
        { id: 1, nit: '900123-4', razon_social: 'Zeta' },
        { id: 2, nit: '800', razon_social: 'Alfa' },
    ], indice);
    assert.deepEqual(Array.from(resultado, c => c.id), [2, 1]);
});

test('Error de consulta no se presenta como lista vacia ni conserva saldos viejos; permite reintentar', async () => {
    const ctx = contexto();
    ctx.M.facturacion = new Map([['100', {}]]);
    ctx.renderClientes = () => {};
    ctx.api = async () => { throw new Error('Consulta no disponible'); };
    await ctx.cargarFacturacionListaMaestro();
    assert.equal(ctx.M.facturacion, null);
    assert.equal(ctx.M.errorFacturacion, 'Consulta no disponible');
    ctx.api = async () => ({ cartera_clientes: [] });
    await ctx.cargarFacturacionListaMaestro();
    assert.equal(ctx.M.facturacion.size, 0);
    assert.equal(ctx.M.errorFacturacion, '');
});

# Plan Maestro del Aplicativo PREVENT

## Objetivo
Dejar definido el modelo funcional y técnico del aplicativo para continuar el desarrollo con una sola lógica transversal, proteger la información existente y evitar que cada módulo crezca con reglas distintas.

## Regla General del Sistema
Cada módulo debe seguir esta estructura:

1. Catálogo base
2. Tabla(s) maestras o de parametrización
3. Tabla(s) de movimientos o historial
4. Proceso por período
5. Dashboard del módulo
6. Informes

## Regla de Catálogos
El catálogo registra las condiciones base con las que nace una entidad.

Ejemplos:
- Empleado
- Servicio
- Préstamo
- Vendedor
- Comisión
- Cliente
- Proveedor

La tabla principal conserva el estado vigente para consulta rápida, pero los cambios de negocio deben registrarse en historial o movimientos.

## Regla de Movimientos
Toda modificación relevante debe quedar en una tabla de movimientos con mínimo:

- tipo_movimiento o novedad
- fecha_movimiento
- observacion

Cuando aplique, también debe guardar:

- valor_anterior
- valor_nuevo
- estado_anterior
- estado_nuevo
- usuario_responsable

## Regla de Períodos
Los módulos operativos deben trabajar por períodos controlados:

- Nómina: quincenal
- Servicios: mensual
- Bancos: mensual
- Comisiones: mensual
- Compras: mensual
- Ventas: mensual

El sistema debe:

- pedir el período al inicio
- mantener el período actual activo
- impedir avanzar si el período anterior no está finalizado
- permitir historial y consulta de períodos cerrados

## Regla de Interfaz
Todos los módulos operativos deben entrar con la misma estructura:

- dashboard del módulo
- bloque de período actual
- barra de acciones consistente
- acceso a historial
- acceso a consulta
- flujo visual por etapas dentro del período

Patrón de botones:

- `Nuevo ...`
- `Consultar ...`
- `Quincena` o `Mes`
- `Ver Historial`

## Módulos Operativos

### 1. Nómina
Estado: módulo más avanzado y módulo patrón.

Debe cubrir:

- catálogo de empleados
- historial laboral
- áreas
- cargos
- asignaciones laborales
- clases de novedad
- novedades por quincena
- pre-liquidación
- pagos
- cierre de quincena
- tablero anual de pagos por empleado

Regla especial:
El catálogo de empleados no debe absorber los cambios históricos del empleado. Retiro, reintegro, cambio de área, cambio de cargo, aumento salarial y cambios de forma de pago deben ir a movimientos o historiales especializados.

### 2. Servicios
Debe cubrir:

- catálogo de servicios/gastos
- novedades del mes
- pagos
- cierre de período
- análisis por área cuando aplique distribución de gastos

### 3. Bancos
Debe cubrir:

- catálogo de préstamos/obligaciones
- novedades del préstamo
- pagos
- finalización anticipada
- extensión o reestructuración
- historial de movimientos del préstamo

### 4. Comisiones
Debe cubrir:

- catálogo base de condiciones de comisión
- movimientos mensuales
- pre-liquidación
- pagos
- cierre del período
- análisis por vendedor, área y período

### 5. Compras
Módulo clave para el análisis financiero.

Debe cubrir:

- catálogo de proveedores
- órdenes o registros base
- movimientos del período
- cuentas por pagar
- pagos
- cierres mensuales
- análisis por área

### 6. Ventas
Módulo clave para el análisis financiero.

Debe cubrir:

- catálogo de clientes y/o vendedores
- movimientos comerciales
- facturación o ventas del período
- recaudos
- cierres mensuales
- análisis por vendedor, área y período

## Módulos No Operativos

### Tablas
No es un módulo operativo. Es un módulo de parametrización.

Debe crecer por grupos funcionales:

- Organización
- Nómina
- Servicios
- Bancos
- Comisiones
- Compras
- Ventas
- Global

Organización debe incluir:

- áreas
- cargos
- asignaciones laborales

### Informes
No parametriza ni procesa períodos. Es solo de lectura y análisis.

Debe consolidar:

- indicadores por módulo
- indicadores financieros
- análisis por área
- análisis por período
- trazabilidad y auditoría

## Modelo Organizacional
La relación correcta es:

- un área puede tener muchos cargos
- un empleado se relaciona históricamente con área y cargo por medio de una asignación laboral

Modelo objetivo:

- `areas`
- `cargos`
- `empleado_asignaciones_laborales`

No se debe depender solo del campo de texto `cargo` en `empleados`.

## Modelo de Empleados
Debe quedar separado así:

### Catálogo de empleado
Guarda condiciones base:

- identificación
- nombres
- apellidos
- fecha de ingreso
- datos bancarios
- condición base de pago
- sueldo vigente
- estado vigente

### Movimientos laborales
Registra:

- ingreso
- retiro
- reintegro
- cambio de área
- cambio de cargo
- suspensión
- otros movimientos laborales

Tabla objetivo:

- `empleado_movimientos_laborales`

### Historial salarial
Debe crearse como tabla separada.

Debe registrar:

- salario_anterior
- salario_nuevo
- fecha_inicio_vigencia
- motivo
- observacion

Tabla propuesta:

- `empleado_historial_salarial`

## Criterio Transversal para Todos los Módulos
Los catálogos definen la entidad base.
Las modificaciones de negocio van a historial.

Esto aplica a:

- empleados
- préstamos
- servicios
- vendedores
- comisiones
- compras
- ventas

## Estado Actual ya Avanzado
Ya quedó adelantado:

- estructura visual más uniforme entre módulos
- botón de consulta en varios módulos
- módulo base de comisiones
- área, cargo y asignación laboral preparados en interfaz
- retiro y reintegro de empleados preparados en backend/frontend
- migración inicial para trazabilidad laboral y estructura organizacional

## Orden Recomendado de Implementación

### Fase 1
- estabilizar Nómina como módulo patrón
- ejecutar migración en staging
- validar retiro, reintegro, áreas, cargos y asignaciones

### Fase 2
- crear historial salarial
- ajustar catálogo de empleados para que no absorba cambios históricos
- completar dashboard anual de nómina

### Fase 3
- completar Servicios y Bancos bajo el mismo patrón catálogo + movimientos + período

### Fase 4
- implementar Comisiones

### Fase 5
- construir Compras y Ventas desde el mismo patrón

### Fase 6
- construir Informes consolidados
- construir dashboard principal dinámico
- incorporar usuarios, roles y permisos transversales

## Regla de Seguridad
No aplicar cambios estructurales directo en producción sin:

1. respaldo
2. staging con copia real
3. migración controlada
4. validación funcional
5. despliegue controlado

## Cierre de Hoy
El foco de la siguiente sesión debe ser:

1. correr migración en staging
2. revisar visualmente en la nube
3. validar flujo de empleados
4. corregir ajustes finos
5. definir historial salarial

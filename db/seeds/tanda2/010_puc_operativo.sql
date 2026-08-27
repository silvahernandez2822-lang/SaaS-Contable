-- =============================================================================
-- 010_puc_operativo.sql — Agente A1, Ola 1, Tanda 2 (sección 7.8)
--
-- IMPORTANTE — ALCANCE REAL DE ESTE ARCHIVO: el Decreto 2650 de 1993 define
-- del orden de 2.470 cuentas (clase → grupo → cuenta → subcuenta → auxiliar).
-- Este archivo NO transcribe esas 2.470 filas: transcribir de memoria un
-- catálogo de ese tamaño, cuenta por cuenta, es exactamente el tipo de
-- ejercicio en el que un solo dígito mal recordado pasa desapercibido y
-- contamina el plan de cuentas de todas las firmas. Lo que carga es un PUC
-- OPERATIVO: las 9 clases completas, los grupos de nivel 2 más usados en
-- las clases 1 a 7, y una selección de cuentas de nivel 3 (4 dígitos) de las
-- que A1 tiene alta confianza por ser extremadamente estándar y citadas de
-- forma consistente en la literatura contable colombiana.
--
-- NO llega a subcuenta (6 dígitos) ni a auxiliar (7+): esos niveles los debe
-- completar cada firma según su propia operación (el esquema ya lo permite:
-- `account` con tenant_id/company_id propios), o una carga posterior contra
-- el texto oficial del decreto, no contra la memoria de un agente.
--
-- `account` no lleva columna `requiere_verificacion_humana` (no es una
-- tabla de vigencia: es catálogo de identidad, como `ciiu_activity`). El
-- aviso va aquí, en el propio archivo de seed, y en el reporte de A1: NO es
-- una tarifa que pueda estar mal por norma nueva, es un catálogo estructural
-- que un contador debe cotejar contra el decreto antes de producción.
-- Se documenta así en vez de callarlo (advertencia 17.5).
--
-- Naturaleza: sigue la del grupo/clase excepto en las cuentas "contra" que
-- se marcan explícitamente (depreciación acumulada, amortización acumulada),
-- que son de naturaleza crédito aunque estén bajo la clase 1 ACTIVO.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Clases (nivel 1) — las que faltan de tanda 1 (1, 2 y 5 ya existen).
-- -----------------------------------------------------------------------------
INSERT INTO account (tenant_id, company_id, codigo, nombre, nivel, parent_id, naturaleza, permite_movimiento)
SELECT NULL, NULL, v.codigo, v.nombre, 1, NULL, v.naturaleza, false
FROM (VALUES
  ('3', 'PATRIMONIO', 'credito'),
  ('4', 'INGRESOS', 'credito'),
  ('6', 'COSTOS DE VENTAS', 'debito'),
  ('7', 'COSTOS DE PRODUCCIÓN O DE OPERACIÓN', 'debito'),
  ('8', 'CUENTAS DE ORDEN DEUDORAS', 'debito'),
  ('9', 'CUENTAS DE ORDEN ACREEDORAS', 'credito')
) AS v(codigo, nombre, naturaleza)
WHERE NOT EXISTS (
  SELECT 1 FROM account e WHERE e.tenant_id IS NULL AND e.company_id IS NULL AND e.codigo = v.codigo
);

-- -----------------------------------------------------------------------------
-- Grupos (nivel 2)
-- -----------------------------------------------------------------------------
INSERT INTO account (tenant_id, company_id, codigo, nombre, nivel, parent_id, naturaleza, permite_movimiento)
SELECT NULL, NULL, v.codigo, v.nombre, 2, p.id, v.naturaleza, false
FROM (VALUES
  -- Clase 1 · ACTIVO
  ('11', 'DISPONIBLE', '1', 'debito'),
  ('12', 'INVERSIONES', '1', 'debito'),
  ('13', 'DEUDORES', '1', 'debito'),
  ('14', 'INVENTARIOS', '1', 'debito'),
  ('15', 'PROPIEDADES, PLANTA Y EQUIPO', '1', 'debito'),
  ('16', 'INTANGIBLES', '1', 'debito'),
  ('17', 'DIFERIDOS', '1', 'debito'),
  ('18', 'OTROS ACTIVOS', '1', 'debito'),
  ('19', 'VALORIZACIONES', '1', 'debito'),
  -- Clase 2 · PASIVO (23 y 22 ya existen de tanda 1)
  ('21', 'OBLIGACIONES FINANCIERAS', '2', 'credito'),
  ('24', 'IMPUESTOS, GRAVÁMENES Y TASAS', '2', 'credito'),
  ('25', 'OBLIGACIONES LABORALES', '2', 'credito'),
  ('26', 'PASIVOS ESTIMADOS Y PROVISIONES', '2', 'credito'),
  ('27', 'DIFERIDOS', '2', 'credito'),
  ('28', 'OTROS PASIVOS', '2', 'credito'),
  -- Clase 3 · PATRIMONIO
  ('31', 'CAPITAL SOCIAL', '3', 'credito'),
  ('32', 'SUPERÁVIT DE CAPITAL', '3', 'credito'),
  ('33', 'RESERVAS', '3', 'credito'),
  ('36', 'RESULTADOS DEL EJERCICIO', '3', 'credito'),
  ('37', 'RESULTADOS DE EJERCICIOS ANTERIORES', '3', 'credito'),
  -- Clase 4 · INGRESOS
  ('41', 'OPERACIONALES', '4', 'credito'),
  ('42', 'NO OPERACIONALES', '4', 'credito'),
  -- Clase 5 · GASTOS
  ('51', 'OPERACIONALES DE ADMINISTRACIÓN', '5', 'debito'),
  ('52', 'OPERACIONALES DE VENTAS', '5', 'debito'),
  ('53', 'NO OPERACIONALES', '5', 'debito'),
  ('54', 'IMPUESTO DE RENTA Y COMPLEMENTARIOS', '5', 'debito'),
  -- Clase 6 · COSTOS DE VENTAS
  ('61', 'COSTO DE VENTAS Y DE PRESTACIÓN DE SERVICIOS', '6', 'debito'),
  ('62', 'COMPRAS', '6', 'debito'),
  -- Clase 7 · COSTOS DE PRODUCCIÓN
  ('71', 'MATERIA PRIMA', '7', 'debito'),
  ('72', 'MANO DE OBRA DIRECTA', '7', 'debito'),
  ('73', 'COSTOS INDIRECTOS', '7', 'debito'),
  ('74', 'CONTRATOS DE SERVICIOS', '7', 'debito')
) AS v(codigo, nombre, parent_codigo, naturaleza)
JOIN account p ON p.tenant_id IS NULL AND p.company_id IS NULL AND p.codigo = v.parent_codigo AND p.nivel = 1
WHERE NOT EXISTS (
  SELECT 1 FROM account e WHERE e.tenant_id IS NULL AND e.company_id IS NULL AND e.codigo = v.codigo
);

-- -----------------------------------------------------------------------------
-- Cuentas (nivel 3, 4 dígitos) — selección operativa, no exhaustiva.
-- (2205, 2365, 2367, 2368 ya existen de tanda 1.)
-- -----------------------------------------------------------------------------
INSERT INTO account (tenant_id, company_id, codigo, nombre, nivel, parent_id, naturaleza, permite_movimiento, requiere_tercero)
SELECT NULL, NULL, v.codigo, v.nombre, 3, p.id, v.naturaleza, true, v.requiere_tercero
FROM (VALUES
  -- 11 Disponible
  ('1105', 'CAJA', '11', 'debito', false),
  ('1110', 'BANCOS', '11', 'debito', false),
  ('1120', 'CUENTAS DE AHORRO', '11', 'debito', false),
  -- 13 Deudores
  ('1305', 'CLIENTES', '13', 'debito', true),
  ('1355', 'ANTICIPO DE IMPUESTOS Y CONTRIBUCIONES O SALDOS A FAVOR', '13', 'debito', false),
  ('1365', 'CUENTAS POR COBRAR A TRABAJADORES', '13', 'debito', true),
  ('1380', 'DEUDORES VARIOS', '13', 'debito', true),
  -- 14 Inventarios
  ('1435', 'MERCANCÍAS NO FABRICADAS POR LA EMPRESA', '14', 'debito', false),
  -- 15 Propiedades, planta y equipo
  ('1504', 'TERRENOS', '15', 'debito', false),
  ('1516', 'CONSTRUCCIONES Y EDIFICACIONES', '15', 'debito', false),
  ('1524', 'EQUIPO DE OFICINA', '15', 'debito', false),
  ('1528', 'EQUIPO DE COMPUTACIÓN Y COMUNICACIÓN', '15', 'debito', false),
  ('1540', 'FLOTA Y EQUIPO DE TRANSPORTE', '15', 'debito', false),
  ('1592', 'DEPRECIACIÓN ACUMULADA', '15', 'credito', false), -- contra-cuenta
  -- 16 Intangibles
  ('1605', 'CRÉDITO MERCANTIL', '16', 'debito', false),
  ('1610', 'MARCAS', '16', 'debito', false),
  ('1698', 'AMORTIZACIÓN ACUMULADA', '16', 'credito', false), -- contra-cuenta
  -- 17 Diferidos
  ('1705', 'GASTOS PAGADOS POR ANTICIPADO', '17', 'debito', false),
  -- 21 Obligaciones financieras
  ('2105', 'BANCOS NACIONALES', '21', 'credito', false),
  -- 22 Proveedores (2205 ya existe)
  ('2210', 'PROVEEDORES DEL EXTERIOR', '22', 'credito', true),
  -- 23 Cuentas por pagar (2365/2367/2368 ya existen)
  ('2335', 'COSTOS Y GASTOS POR PAGAR', '23', 'credito', true),
  ('2355', 'DEUDAS CON ACCIONISTAS O SOCIOS', '23', 'credito', true),
  ('2360', 'DIVIDENDOS O PARTICIPACIONES POR PAGAR', '23', 'credito', true),
  ('2370', 'RETENCIONES Y APORTES DE NÓMINA', '23', 'credito', false),
  ('2380', 'ACREEDORES VARIOS', '23', 'credito', true),
  -- 24 Impuestos, gravámenes y tasas
  ('2404', 'DE RENTA Y COMPLEMENTARIOS', '24', 'credito', false),
  ('2408', 'IMPUESTO SOBRE LAS VENTAS POR PAGAR', '24', 'credito', false),
  ('2412', 'DE INDUSTRIA Y COMERCIO', '24', 'credito', false),
  -- 25 Obligaciones laborales
  ('2505', 'SALARIOS POR PAGAR', '25', 'credito', true),
  ('2510', 'CESANTÍAS CONSOLIDADAS', '25', 'credito', true),
  ('2515', 'INTERESES SOBRE CESANTÍAS', '25', 'credito', true),
  ('2520', 'PRIMA DE SERVICIOS', '25', 'credito', true),
  ('2525', 'VACACIONES CONSOLIDADAS', '25', 'credito', true),
  -- 26 Pasivos estimados y provisiones
  ('2610', 'PARA OBLIGACIONES LABORALES', '26', 'credito', false),
  ('2615', 'PARA OBLIGACIONES FISCALES', '26', 'credito', false),
  -- 27 Diferidos
  ('2705', 'INGRESOS RECIBIDOS POR ANTICIPADO', '27', 'credito', false),
  -- 28 Otros pasivos
  ('2805', 'ANTICIPOS Y AVANCES RECIBIDOS', '28', 'credito', true),
  -- 31 Capital social
  ('3105', 'CAPITAL SUSCRITO Y PAGADO', '31', 'credito', false),
  -- 32 Superávit de capital
  ('3205', 'PRIMA EN COLOCACIÓN DE ACCIONES, CUOTAS O PARTES DE INTERÉS SOCIAL', '32', 'credito', false),
  -- 33 Reservas
  ('3305', 'RESERVA LEGAL', '33', 'credito', false),
  -- 36 Resultados del ejercicio
  ('3605', 'UTILIDAD DEL EJERCICIO', '36', 'credito', false),
  -- 37 Resultados de ejercicios anteriores
  ('3705', 'UTILIDADES ACUMULADAS', '37', 'credito', false),
  -- 41 Ingresos operacionales
  ('4135', 'COMERCIO AL POR MAYOR Y AL POR MENOR', '41', 'credito', false),
  ('4155', 'ACTIVIDADES DE SERVICIOS', '41', 'credito', false),
  -- 42 No operacionales
  ('4210', 'FINANCIEROS', '42', 'credito', false),
  ('4245', 'RECUPERACIONES', '42', 'credito', false),
  -- 51 Gastos de administración
  ('5105', 'GASTOS DE PERSONAL', '51', 'debito', false),
  ('5110', 'HONORARIOS', '51', 'debito', true),
  ('5120', 'ARRENDAMIENTOS', '51', 'debito', true),
  ('5135', 'SERVICIOS', '51', 'debito', true),
  ('5195', 'DIVERSOS', '51', 'debito', false),
  -- 52 Gastos de ventas
  ('5205', 'GASTOS DE PERSONAL', '52', 'debito', false),
  ('5220', 'ARRENDAMIENTOS', '52', 'debito', true),
  ('5235', 'SERVICIOS', '52', 'debito', true),
  -- 53 No operacionales
  ('5305', 'FINANCIEROS', '53', 'debito', false),
  ('5395', 'GASTOS DIVERSOS', '53', 'debito', false),
  -- 54 Impuesto de renta
  ('5405', 'IMPUESTO DE RENTA Y COMPLEMENTARIOS', '54', 'debito', false),
  -- 61 Costo de ventas
  ('6135', 'COMERCIO AL POR MAYOR Y AL POR MENOR', '61', 'debito', false),
  ('6155', 'DE SERVICIOS', '61', 'debito', false),
  -- 62 Compras
  ('6205', 'DE MERCANCÍAS', '62', 'debito', true),
  -- 71-74 Costos de producción
  ('7105', 'MATERIA PRIMA', '71', 'debito', false),
  ('7205', 'MANO DE OBRA DIRECTA', '72', 'debito', false),
  ('7305', 'COSTOS INDIRECTOS', '73', 'debito', false),
  ('7405', 'CONTRATOS DE SERVICIOS', '74', 'debito', true)
) AS v(codigo, nombre, parent_codigo, naturaleza, requiere_tercero)
JOIN account p ON p.tenant_id IS NULL AND p.company_id IS NULL AND p.codigo = v.parent_codigo AND p.nivel = 2
WHERE NOT EXISTS (
  SELECT 1 FROM account e WHERE e.tenant_id IS NULL AND e.company_id IS NULL AND e.codigo = v.codigo
);

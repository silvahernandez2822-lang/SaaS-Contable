-- =============================================================================
-- 080_exogena_formatos.sql — Agente A1, Ola 1, Tanda 2 (sección 7.7)
--
-- Requiere la migración 019 (tabla `exogena_format`, nueva, aditiva, rango
-- reservado de A1). Carga solo la IDENTIDAD de los formatos que cita la
-- sección 7.7 (12 de los 69 formatos de la Resolución 000227 de 2025) — no
-- es el listado completo de los 69 formatos, que la sección 7 no trae.
--
-- `tope_uvt` queda NULL en todas las filas a propósito: la sección 7.7 da UN
-- umbral GENERAL de obligación a informar ("personas jurídicas con ingresos
-- brutos >2.400 UVT, AG 2025"), no un tope específico por formato. Meterlo
-- en `tope_uvt` de cada fila sugeriría que es un tope por formato, que no es
-- lo que dice la norma. El umbral general queda documentado en `notas`.
-- =============================================================================

-- NOTA TÉCNICA: `exogena_format` lleva vigencia append-only (D-012 / PR001):
-- después del INSERT solo se puede cerrar `vigente_hasta`, nunca tocar
-- `notas` con un UPDATE posterior. Por eso la nota específica del Formato
-- 1001 va DENTRO del mismo INSERT (por fila), no en una actualización aparte.
INSERT INTO exogena_format (tenant_id, company_id, formato_codigo, nombre, anio_gravable, vigente_desde, vigente_hasta, norma_respaldo, notas)
SELECT NULL, NULL, v.codigo, v.nombre, 2025, DATE '2026-01-01', NULL,
       'Resolución DIAN 000227 de 2025, modificada por Res. 000233 y 000237 de 2025 y Res. 000012 de 2026 (año gravable 2025, a presentar en 2026). Sección 7.7.',
       'Obligados AG 2025: personas jurídicas con ingresos brutos superiores a 2.400 UVT (umbral GENERAL de obligación a informar, no específico de este formato). '
       || 'Plazos 2026: grandes contribuyentes 28-abr a 13-may; personas jurídicas y naturales 14-may a 12-jun, escalonado por NIT. '
       || 'Sanción art. 651 ET: hasta 5% de sumas no informadas, tope 7.500 UVT.'
       || v.nota_extra
FROM (VALUES
  ('1001', 'Pagos o abonos en cuenta y retenciones practicadas',
   ' El Formato 1001 exige además dirección y código de departamento/municipio del informado (art. 1.3.5.2.1 Res. 000227/2025); ya capturado en third_party.direccion / third_party.municipality_id.'),
  ('1003', 'Retenciones en la fuente que le practicaron', ''),
  ('1005', 'IVA descontable', ''),
  ('1006', 'IVA generado', ''),
  ('1007', 'Ingresos recibidos', ''),
  ('1008', 'Cuentas por cobrar', ''),
  ('1009', 'Cuentas por pagar', ''),
  ('1010', 'Socios, accionistas, comuneros o cooperados', ''),
  ('1012', 'Declaraciones tributarias e inversiones', ''),
  ('2276', 'Información de nómina y rentas de trabajo', ''),
  ('2820', 'Enajenación de acciones o participaciones no cotizadas', ''),
  ('2833', 'Enajenación de acciones o participaciones no cotizadas (complementario)', '')
) AS v(codigo, nombre, nota_extra)
WHERE NOT EXISTS (
  SELECT 1 FROM exogena_format e WHERE e.tenant_id IS NULL AND e.company_id IS NULL AND e.formato_codigo = v.codigo
);

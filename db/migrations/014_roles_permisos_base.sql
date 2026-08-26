-- =============================================================================
-- 014_roles_permisos_base.sql — Los cinco roles mínimos de la sección 14.1
--
-- Esto NO es dato tributario (eso es de A1 en la Ola 1): es el modelo de
-- autorización, que forma parte de la fundación. Los roles nacen globales
-- (tenant_id NULL) y toda firma los usa; una firma puede además crear roles
-- propios con su tenant_id.
-- =============================================================================

INSERT INTO permission (codigo, nombre, descripcion, modulo) VALUES
  ('documento.leer',           'Ver documentos',            'Consultar facturas y documentos soporte recibidos',            'documentos'),
  ('documento.cargar',         'Cargar documentos',         'Subir XML/ZIP manualmente al buzón de la empresa',              'documentos'),
  ('documento.reprocesar',     'Reprocesar documentos',     'Volver a extraer y clasificar un documento ya recibido',        'documentos'),
  ('causacion.crear',          'Crear causación',           'Generar el asiento borrador a partir de un documento',          'causacion'),
  ('causacion.editar_borrador','Editar borrador',           'Modificar un asiento aún no publicado',                         'causacion'),
  ('causacion.aprobar',        'Aprobar causación',         'Aprobar la propuesta y habilitar su publicación',               'causacion'),
  ('causacion.reversar',       'Reversar asiento',          'Crear el asiento de reversa de uno publicado',                  'causacion'),
  ('asiento.leer',             'Ver asientos',              'Consultar el libro diario y los auxiliares',                    'ledger'),
  ('asiento.publicar',         'Publicar asiento',          'Pasar un asiento aprobado de borrador a publicado',             'ledger'),
  ('periodo.cerrar',           'Cerrar período',            'Cerrar o bloquear un período fiscal',                           'ledger'),
  ('parametro.leer',           'Ver parámetros',            'Consultar tarifas, bases, UVT y calendarios',                   'parametrizacion'),
  ('parametro.editar',         'Editar parámetros',         'Crear vigencias nuevas de tarifas, bases, UVT y calendarios',   'parametrizacion'),
  ('puc.leer',                 'Ver plan de cuentas',       'Consultar el PUC y su mapeo NIIF',                              'contabilidad'),
  ('puc.editar',               'Editar plan de cuentas',    'Crear cuentas auxiliares y editar el mapeo NIIF',               'contabilidad'),
  ('tercero.leer',             'Ver terceros',              'Consultar terceros y sus atributos fiscales',                   'terceros'),
  ('tercero.editar',           'Editar terceros',           'Crear terceros y registrar vigencias de atributos fiscales',    'terceros'),
  ('concepto.leer',            'Ver conceptos',             'Consultar conceptos de causación',                              'parametrizacion'),
  ('concepto.editar',          'Editar conceptos',          'Crear y modificar conceptos de causación',                      'parametrizacion'),
  ('reporte.leer',             'Ver reportes',              'Consultar libros, balances y relaciones de retenciones',        'reportes'),
  ('reporte.exportar',         'Exportar reportes',         'Descargar los libros y papeles de trabajo en Excel',            'reportes'),
  ('empresa.leer',             'Ver empresas',              'Consultar las empresas-cliente de la firma',                    'administracion'),
  ('empresa.administrar',      'Administrar empresas',      'Crear y configurar empresas-cliente',                           'administracion'),
  ('usuario.leer',             'Ver usuarios',              'Consultar los usuarios de la firma y sus accesos',              'administracion'),
  ('usuario.administrar',      'Administrar usuarios',      'Crear usuarios y otorgar o revocar acceso a empresas',          'administracion'),
  ('auditoria.leer',           'Ver auditoría',             'Consultar el registro de acciones sensibles',                   'administracion');

INSERT INTO role (id, tenant_id, codigo, nombre, descripcion, es_sistema) VALUES
  ('00000000-0000-0000-0000-0000000000a1', NULL, 'admin_firma',
   'Administrador de firma',
   'Control total sobre la firma: empresas, usuarios, parámetros y contabilidad.', true),
  ('00000000-0000-0000-0000-0000000000a2', NULL, 'admin_tributario',
   'Administrador tributario',
   'Único rol que puede crear vigencias nuevas de tarifas, bases y calendarios (sección 6.2, punto 5).', true),
  ('00000000-0000-0000-0000-0000000000a3', NULL, 'contador',
   'Contador',
   'Aprueba causaciones, publica y reversa asientos, cierra períodos y exporta reportes.', true),
  ('00000000-0000-0000-0000-0000000000a4', NULL, 'auxiliar_causacion',
   'Auxiliar de causación',
   'Prepara borradores de causación. No aprueba, no publica y no edita parámetros.', true),
  ('00000000-0000-0000-0000-0000000000a5', NULL, 'solo_lectura',
   'Solo lectura',
   'Consulta sin capacidad de modificar nada.', true);

-- admin_firma: todos los permisos
INSERT INTO role_permission (role_id, permission_codigo)
SELECT '00000000-0000-0000-0000-0000000000a1', codigo FROM permission;

-- admin_tributario
INSERT INTO role_permission (role_id, permission_codigo)
SELECT '00000000-0000-0000-0000-0000000000a2', codigo FROM permission
 WHERE codigo IN (
   'parametro.leer','parametro.editar','puc.leer','puc.editar',
   'concepto.leer','concepto.editar','tercero.leer','tercero.editar',
   'documento.leer','asiento.leer','reporte.leer','reporte.exportar',
   'auditoria.leer','empresa.leer');

-- contador
INSERT INTO role_permission (role_id, permission_codigo)
SELECT '00000000-0000-0000-0000-0000000000a3', codigo FROM permission
 WHERE codigo IN (
   'documento.leer','documento.cargar','documento.reprocesar',
   'causacion.crear','causacion.editar_borrador','causacion.aprobar','causacion.reversar',
   'asiento.leer','asiento.publicar','periodo.cerrar',
   'parametro.leer','puc.leer','concepto.leer','concepto.editar',
   'tercero.leer','tercero.editar','reporte.leer','reporte.exportar','empresa.leer');

-- auxiliar_causacion: prepara, no aprueba ni publica ni parametriza
INSERT INTO role_permission (role_id, permission_codigo)
SELECT '00000000-0000-0000-0000-0000000000a4', codigo FROM permission
 WHERE codigo IN (
   'documento.leer','documento.cargar',
   'causacion.crear','causacion.editar_borrador',
   'asiento.leer','parametro.leer','puc.leer','concepto.leer',
   'tercero.leer','tercero.editar','reporte.leer');

-- solo_lectura
INSERT INTO role_permission (role_id, permission_codigo)
SELECT '00000000-0000-0000-0000-0000000000a5', codigo FROM permission
 WHERE codigo IN (
   'documento.leer','asiento.leer','parametro.leer','puc.leer',
   'concepto.leer','tercero.leer','reporte.leer','empresa.leer');

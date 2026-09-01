/**
 * Permisos y roles — Agente A12.
 *
 * Estas constantes son ESPEJO del catálogo `permission` y de los cinco roles de
 * `db/migrations/014_roles_permisos_base.sql`. No son la fuente de verdad: la
 * fuente de verdad son las tablas, y una prueba de compuerta verifica que las
 * dos listas coincidan exactamente. Existen para que el código de la aplicación
 * no escriba códigos de permiso como cadenas sueltas.
 *
 * La comprobación de permisos NO se hace aquí. La hace la base de datos con
 * `app.exigir_permiso`, disparada por un trigger en cada tabla de escritura
 * (migración 016). Estas funciones sirven para decidir qué mostrar en la
 * interfaz y para fallar temprano con un mensaje útil, no para autorizar.
 */
import type { SqlClient } from '../db/types';

export const PERMISOS = {
  DOCUMENTO_LEER: 'documento.leer',
  DOCUMENTO_CARGAR: 'documento.cargar',
  DOCUMENTO_REPROCESAR: 'documento.reprocesar',
  /** A16 (170, D-068): aprobar o rechazar la corrección de AIU o de municipio
   * que registró OTRO usuario. Es el permiso que separa al junior que corrige
   * del revisor que valida; el estado vive en `document_correction.estado`. */
  DOCUMENTO_APROBAR_CORRECCION: 'documento.aprobar_correccion',
  CAUSACION_CREAR: 'causacion.crear',
  CAUSACION_EDITAR_BORRADOR: 'causacion.editar_borrador',
  CAUSACION_APROBAR: 'causacion.aprobar',
  CAUSACION_REVERSAR: 'causacion.reversar',
  ASIENTO_LEER: 'asiento.leer',
  ASIENTO_PUBLICAR: 'asiento.publicar',
  PERIODO_CERRAR: 'periodo.cerrar',
  PARAMETRO_LEER: 'parametro.leer',
  PARAMETRO_EDITAR: 'parametro.editar',
  PUC_LEER: 'puc.leer',
  PUC_EDITAR: 'puc.editar',
  TERCERO_LEER: 'tercero.leer',
  TERCERO_EDITAR: 'tercero.editar',
  /** A12 (140): los atributos fiscales y la actividad economica de un tercero
   * entran en el calculo de la retencion, asi que se separan del maestro. */
  TERCERO_ATRIBUTOS_FISCALES: 'tercero.atributos_fiscales',
  CONCEPTO_LEER: 'concepto.leer',
  CONCEPTO_EDITAR: 'concepto.editar',
  REPORTE_LEER: 'reporte.leer',
  REPORTE_EXPORTAR: 'reporte.exportar',
  EMPRESA_LEER: 'empresa.leer',
  EMPRESA_ADMINISTRAR: 'empresa.administrar',
  USUARIO_LEER: 'usuario.leer',
  USUARIO_ADMINISTRAR: 'usuario.administrar',
  AUDITORIA_LEER: 'auditoria.leer',
} as const;

export type Permiso = (typeof PERMISOS)[keyof typeof PERMISOS];

/** Los cinco roles mínimos de la sección 14.1, con su UUID fijo de 014. */
export const ROLES = {
  ADMIN_FIRMA: '00000000-0000-0000-0000-0000000000a1',
  ADMIN_TRIBUTARIO: '00000000-0000-0000-0000-0000000000a2',
  CONTADOR: '00000000-0000-0000-0000-0000000000a3',
  AUXILIAR_CAUSACION: '00000000-0000-0000-0000-0000000000a4',
  SOLO_LECTURA: '00000000-0000-0000-0000-0000000000a5',
} as const;

export const CODIGO_ROL = {
  [ROLES.ADMIN_FIRMA]: 'admin_firma',
  [ROLES.ADMIN_TRIBUTARIO]: 'admin_tributario',
  [ROLES.CONTADOR]: 'contador',
  [ROLES.AUXILIAR_CAUSACION]: 'auxiliar_causacion',
  [ROLES.SOLO_LECTURA]: 'solo_lectura',
} as const;

export type CodigoRol = (typeof CODIGO_ROL)[keyof typeof CODIGO_ROL];

export class PermisoInsuficienteError extends Error {
  readonly permiso: string;
  constructor(permiso: string) {
    super(`La sesión no tiene el permiso "${permiso}".`);
    this.name = 'PermisoInsuficienteError';
    this.permiso = permiso;
  }
}

/** Pregunta a la base si la sesión en curso tiene el permiso. */
export async function tienePermiso(tx: SqlClient, permiso: Permiso | string): Promise<boolean> {
  const { rows } = await tx.query<{ tiene: boolean }>('SELECT app.tiene_permiso($1) AS tiene', [
    permiso,
  ]);
  return rows[0]?.tiene === true;
}

/**
 * Falla temprano con un error de dominio si falta el permiso.
 *
 * Es una comodidad de la capa de servicio para dar un mensaje claro. La
 * autorización real la impone el trigger de la base de datos (SE002); esta
 * función no es la que protege.
 */
export async function exigirPermiso(tx: SqlClient, permiso: Permiso | string): Promise<void> {
  if (!(await tienePermiso(tx, permiso))) {
    throw new PermisoInsuficienteError(permiso);
  }
}

/** Permisos efectivos de la sesión en la empresa en contexto. */
export async function permisosDeLaSesion(tx: SqlClient): Promise<string[]> {
  const { rows } = await tx.query<{ permission_codigo: string }>(
    `SELECT DISTINCT permission_codigo
       FROM v_user_permission
      WHERE user_id = app.current_user_id()
        AND (app.current_company_id() IS NULL OR company_id = app.current_company_id())
      ORDER BY permission_codigo`,
  );
  return rows.map((r) => r.permission_codigo);
}

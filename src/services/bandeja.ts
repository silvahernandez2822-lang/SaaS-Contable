/**
 * A7 — Bandeja de causación multi-empresa (Ola 2, sección 4).
 *
 * "El usuario de la firma ve en una sola pantalla las facturas pendientes de
 * sus 30-60 empresas-cliente... y puede aprobar 50 de un golpe." Una sesión
 * (`withSessionContext`, D-021/D-022) solo puede operar sobre UNA empresa a
 * la vez — así lo decidió A12 y así lo prueba A6. La pantalla de una sola
 * empresa la resuelve `consultarEstadoDocumento` /
 * `listarPendientesDeAprobacion` de A6 (Ola 1); lo que faltaba era:
 *
 *   1. Saber CUÁLES son las 30-60 empresas de la sesión, sin "probarlas" una
 *      por una contra `withSessionContext` (cada intento fallido deja un
 *      `ACCESO_DENEGADO` en `audit_log`, D-022). Eso es
 *      `listarEmpresasAccesibles`, que envuelve la función SECURITY DEFINER
 *      `app.empresas_accesibles()` de la migración 070. La orquestación de
 *      "una sesión por empresa, agregadas en una sola pantalla" es de
 *      `app/` (`app/lib/bandeja.ts`), no de este archivo: cada función de
 *      aquí sigue recibiendo un `tx` YA situado en su empresa (D-021), como
 *      el resto de `src/services`.
 *
 *   2. V-7 y V-8 (registro de vulnerabilidades de la Ola 1, asignadas a A7):
 *      capturar el AIU por línea y corregir el municipio de la operación
 *      ANTES de que `causarFactura` (`./causacion.ts`) vuelva a intentar la
 *      causación. `document_correction` (migración 070) es donde vive ese
 *      dato; `obtenerCorreccionesVigentes` es lo que `causacion.ts` lee.
 *
 *   3. La bandeja de "pendientes de revisión": documentos cuyo trabajo de
 *      causación ya corrió y terminó en `revision_manual` (el documento
 *      SIGUE en `recibido`/`parseado` — A6 nunca lo mueve a
 *      `pendiente_aprobacion` a medias). Es el insumo para que el humano
 *      corrija AIU/municipio y pida `reencolarJob` (A6, Ola 1).
 *
 * LÍMITE DECLARADO (no silenciado): una corrección de municipio SOLO se
 * aplica mientras el documento sigue sin causar. Si el municipio quedó mal
 * en un asiento que YA llegó a `pendiente_aprobacion` (la operación se
 * causó con el municipio del tercero, en silencio, tal como describe V-8),
 * esta ola no ofrece un "deshacer el borrador y recalcular": el camino
 * soportado es rechazar esa aprobación (`aprobarAsiento` con
 * `decision: 'rechazado'`, de A6) y volver a cargar el documento. Construir
 * un "recall" de un borrador ya construido es una decisión de ledger que le
 * corresponde a A6/A2, no a A7 en solitario — ver `docs/reportes/ola2-a7.md`.
 */
import type { SqlClient } from '../db/types';
import { exigirPermiso, PERMISOS } from '../auth/permisos';
import { proyectarLineasParaCausacion, type LineaExtraida } from './ingest';
import { reencolarJob, type DocumentProcessingJob } from './cola';

// =============================================================================
// 1. EMPRESAS ACCESIBLES (insumo de la bandeja multi-empresa)
// =============================================================================

export interface EmpresaAccesible {
  companyId: string;
  nit: string;
  razonSocial: string;
  nombreComercial: string | null;
  /** Rol de negocio de la sesión EN ESA empresa (los cinco roles de la sección 14.1). */
  rolCodigo: string;
}

/**
 * Empresas-cliente sobre las que la sesión actual tiene acceso vigente.
 * Puede llamarse con o sin empresa elegida en la sesión (D-022: es
 * precisamente para decidir cuáles hay antes de elegir una).
 */
export async function listarEmpresasAccesibles(tx: SqlClient): Promise<EmpresaAccesible[]> {
  const { rows } = await tx.query<{
    company_id: string;
    nit: string;
    razon_social: string;
    nombre_comercial: string | null;
    role_codigo: string;
  }>(`SELECT company_id, nit, razon_social, nombre_comercial, role_codigo
        FROM app.empresas_accesibles() ORDER BY razon_social`);
  return rows.map((r) => ({
    companyId: r.company_id,
    nit: r.nit,
    razonSocial: r.razon_social,
    nombreComercial: r.nombre_comercial,
    rolCodigo: r.role_codigo,
  }));
}

// =============================================================================
// 2. CORRECCIONES — V-7 (AIU por línea) y V-8 (municipio de la operación)
// =============================================================================

export interface CorreccionesVigentes {
  /** Línea (numeración de A4/A6) -> AIU en centavos, la corrección MÁS RECIENTE por línea. */
  aiuPorLinea: ReadonlyMap<number, number>;
  /** Municipio corregido a nivel de documento, o null si nadie lo corrigió (V-8: se usa el del tercero). */
  municipioOperacionId: string | null;
}

function jsonComoObjeto<T>(valor: unknown): T {
  return (typeof valor === 'string' ? JSON.parse(valor) : valor) as T;
}

/**
 * Lee la corrección MÁS RECIENTE por (documento, línea/tipo). `document_correction`
 * es append-only (Regla de Oro 6): una corrección nueva no borra la anterior,
 * esta función decide cuál vale.
 *
 * A16 (Ola 4, D-068) añadió el filtro `estado = 'aprobado'`. El motor solo usa
 * las correcciones APROBADAS: la que registró alguien sin
 * `documento.aprobar_correccion` queda 'pendiente_revision' y el documento se
 * causa como si no existiera —que es el comportamiento anterior a la Ola 4—
 * hasta que un revisor la apruebe. Nunca se aplica «a medias»: o vale entera o
 * no vale, y en los dos casos la corrección sigue visible y auditada.
 *
 * Nótese que el filtro va también en el `DISTINCT ON`: sin él, una corrección
 * pendiente MÁS RECIENTE ocultaría a la aprobada anterior y el motor perdería
 * un dato que sí estaba autorizado a usar.
 */
export async function obtenerCorreccionesVigentes(
  tx: SqlClient,
  sourceDocumentId: string,
): Promise<CorreccionesVigentes> {
  const { rows } = await tx.query<{
    tipo: string;
    linea_numero: number | null;
    valor_aiu_centavos: string | null;
    municipio_operacion_id: string | null;
  }>(
    `SELECT DISTINCT ON (tipo, linea_numero)
            tipo, linea_numero, valor_aiu_centavos::text, municipio_operacion_id
       FROM document_correction
      WHERE source_document_id = $1
        AND estado = 'aprobado'
      ORDER BY tipo, linea_numero, creado_en DESC`,
    [sourceDocumentId],
  );
  const aiuPorLinea = new Map<number, number>();
  let municipioOperacionId: string | null = null;
  for (const r of rows) {
    if (r.tipo === 'aiu_linea' && r.linea_numero !== null && r.valor_aiu_centavos !== null) {
      aiuPorLinea.set(r.linea_numero, Number(r.valor_aiu_centavos));
    } else if (r.tipo === 'municipio_operacion') {
      municipioOperacionId = r.municipio_operacion_id;
    }
  }
  return { aiuPorLinea, municipioOperacionId };
}

export interface GuardarCorreccionAiuInput {
  sourceDocumentId: string;
  lineaNumero: number;
  /** AIU en centavos (Regla de Oro 5: entero, nunca float). */
  valorAiuCentavos: number;
  motivo: string;
}

/**
 * V-7: captura humana del AIU de una línea. Exige `documento.reprocesar`
 * (mismo permiso que `reencolarJob`, A6/Ola 1): capturar el AIU sin intención
 * de reprocesar no tiene ningún efecto, así que se exige el mismo permiso que
 * la acción completa.
 */
export async function guardarCorreccionAiu(tx: SqlClient, input: GuardarCorreccionAiuInput): Promise<void> {
  await exigirPermiso(tx, PERMISOS.DOCUMENTO_REPROCESAR);
  if (!Number.isInteger(input.valorAiuCentavos) || input.valorAiuCentavos < 0) {
    throw new Error('El AIU debe ser un entero de centavos mayor o igual a cero (Regla de Oro 5).');
  }
  if (!Number.isInteger(input.lineaNumero) || input.lineaNumero <= 0) {
    throw new Error('El número de línea debe ser un entero positivo.');
  }
  if (!input.motivo || input.motivo.trim() === '') {
    throw new Error('Toda corrección exige un motivo (Regla de Oro 6): quién corrige y por qué.');
  }
  await tx.query(
    `INSERT INTO document_correction
       (tenant_id, company_id, source_document_id, tipo, linea_numero, valor_aiu_centavos, motivo, creado_por)
     VALUES (app.current_tenant_id(), app.current_company_id(), $1, 'aiu_linea', $2, $3, $4, app.current_user_id())`,
    [input.sourceDocumentId, input.lineaNumero, input.valorAiuCentavos, input.motivo.trim()],
  );
}

export interface GuardarCorreccionMunicipioInput {
  sourceDocumentId: string;
  municipioOperacionId: string;
  motivo: string;
}

/**
 * V-8: corrige el municipio donde se prestó el servicio (sección 7.5),
 * cuando difiere del municipio del tercero que el motor usa por defecto.
 */
export async function guardarCorreccionMunicipio(
  tx: SqlClient,
  input: GuardarCorreccionMunicipioInput,
): Promise<void> {
  await exigirPermiso(tx, PERMISOS.DOCUMENTO_REPROCESAR);
  if (!input.motivo || input.motivo.trim() === '') {
    throw new Error('Toda corrección exige un motivo (Regla de Oro 6): quién corrige y por qué.');
  }
  await tx.query(
    `INSERT INTO document_correction
       (tenant_id, company_id, source_document_id, tipo, municipio_operacion_id, motivo, creado_por)
     VALUES (app.current_tenant_id(), app.current_company_id(), $1, 'municipio_operacion', $2, $3, app.current_user_id())`,
    [input.sourceDocumentId, input.municipioOperacionId, input.motivo.trim()],
  );
}

/** Envoltorio delgado sobre `reencolarJob` (A6): guardar la corrección y
 * reprocesar son, para el usuario, una sola decisión con un solo permiso. */
export async function reprocesarDocumento(tx: SqlClient, sourceDocumentId: string): Promise<DocumentProcessingJob> {
  return reencolarJob(tx, sourceDocumentId);
}

// =============================================================================
// 3. PENDIENTES DE REVISIÓN — documentos que el worker no pudo causar
// =============================================================================

export interface MotivoRevision {
  codigo: string;
  detalle: string;
}

export interface DocumentoEnRevision {
  sourceDocumentId: string;
  numeroDocumento: string;
  emisorNit: string;
  emisorNombre: string | null;
  fechaHechoEconomico: string;
  intentos: number;
  motivos: MotivoRevision[];
  /** Líneas del documento (parser de A4), para que el humano decida a cuál(es) cargarles el AIU. */
  lineas: readonly LineaExtraida[];
  /** Correcciones YA guardadas, para no perderlas si el humano recarga la pantalla. */
  correcciones: CorreccionesVigentes;
  /** true si algún motivo es de AIU faltante o bajo el mínimo (V-7): la interfaz resalta la captura de AIU. */
  requiereAiu: boolean;
  /** true si algún motivo es de municipio ausente, sin parámetros de ICA, o
   * sin actividad del tercero en ese municipio (V-8): la interfaz resalta la
   * corrección de municipio. */
  requiereMunicipio: boolean;
}

interface FilaJobRevision {
  source_document_id: string;
  resultado: unknown;
  intentos: number;
  numero_documento: string;
  emisor_nit: string;
  emisor_nombre: string | null;
  fecha_hecho_economico: string;
}

const MOTIVOS_AIU = new Set(['concepto_aiu_sin_aiu_declarado', 'aiu_por_debajo_del_minimo_parametrizado']);
const MOTIVOS_MUNICIPIO = new Set([
  'operacion_sin_municipio',
  'municipio_sin_parametros_de_reteica',
  'tercero_sin_actividad_en_el_municipio',
  'varias_actividades_sin_desempate_posible',
]);

/**
 * Documentos cuyo trabajo de causación terminó en revisión manual: siguen
 * en `recibido`/`parseado` (A6 nunca los mueve a `pendiente_aprobacion` a
 * medias, sección "Qué corre en el request y qué corre en la cola" del
 * reporte de A6). Es la mitad de la bandeja que necesita intervención
 * humana ANTES de que exista ningún asiento que aprobar.
 */
export async function listarPendientesRevision(
  tx: SqlClient,
  opciones: { limite?: number } = {},
): Promise<DocumentoEnRevision[]> {
  await exigirPermiso(tx, PERMISOS.DOCUMENTO_LEER);

  const { rows } = await tx.query<FilaJobRevision>(
    `SELECT j.source_document_id, j.resultado, j.intentos,
            d.numero_documento, d.emisor_nit, d.emisor_nombre, d.fecha_hecho_economico::text
       FROM document_processing_job j
       JOIN source_document d ON d.id = j.source_document_id
      WHERE j.tipo = 'causacion' AND j.estado = 'completado'
        AND (j.resultado ->> 'requiereRevisionManual') = 'true'
      ORDER BY d.fecha_hecho_economico
      LIMIT $1`,
    [opciones.limite ?? 50],
  );

  const resultado: DocumentoEnRevision[] = [];
  for (const r of rows) {
    const resultadoJob = jsonComoObjeto<{ motivos?: MotivoRevision[] }>(r.resultado ?? {});
    const motivos = Array.isArray(resultadoJob.motivos) ? resultadoJob.motivos : [];

    const { rows: ext } = await tx.query<{ datos_extraidos: unknown }>(
      `SELECT datos_extraidos FROM extraction
        WHERE source_document_id = $1 AND origen = 'parser_ubl'
        ORDER BY created_at DESC LIMIT 1`,
      [r.source_document_id],
    );
    const lineas = ext[0] ? proyectarLineasParaCausacion(jsonComoObjeto(ext[0].datos_extraidos)).lineas : [];

    const correcciones = await obtenerCorreccionesVigentes(tx, r.source_document_id);

    resultado.push({
      sourceDocumentId: r.source_document_id,
      numeroDocumento: r.numero_documento,
      emisorNit: r.emisor_nit,
      emisorNombre: r.emisor_nombre,
      fechaHechoEconomico: r.fecha_hecho_economico,
      intentos: r.intentos,
      motivos,
      lineas,
      correcciones,
      requiereAiu: motivos.some((m) => MOTIVOS_AIU.has(m.codigo)),
      requiereMunicipio: motivos.some((m) => MOTIVOS_MUNICIPIO.has(m.codigo)),
    });
  }
  return resultado;
}

// =============================================================================
// 4. MUNICIPIOS — insumo del desplegable de corrección (V-8)
// =============================================================================

export interface MunicipioOpcion {
  id: string;
  nombre: string;
  departamento: string;
}

/** Catálogo de municipios visible desde la empresa en contexto (híbrido:
 * global + propio, misma prioridad que usa el motor de A3). Sirve para que
 * el humano elija dónde se prestó el servicio de verdad (V-8). */
export async function listarMunicipiosParaCorreccion(tx: SqlClient): Promise<MunicipioOpcion[]> {
  const { rows } = await tx.query<{ id: string; nombre: string; departamento: string }>(
    `SELECT id, nombre, departamento FROM municipality WHERE activo ORDER BY departamento, nombre`,
  );
  return rows;
}

/**
 * Capa de persistencia del pipeline de ingest. A DIFERENCIA de
 * `procesarAdjuntoXml` (la frontera pura con A6), todo lo de aquí toca la
 * base de datos: resolver el buzón, contar para el límite de tasa, registrar
 * el correo y sus adjuntos, y guardar el documento ya normalizado.
 *
 * A6 no está obligado a usar este archivo — su frontera es `procesar.ts` —
 * pero lo puede reutilizar si le sirve: es lo que las pruebas de este agente
 * usan para probar el pipeline de punta a punta contra PGlite/Postgres.
 *
 * Deduplicación por CUFE (sección 10.3, D-003): la garantía real es el
 * `UNIQUE (company_id, cufe)` de `source_document` (008_documentos.sql). El
 * `SELECT` previo al `INSERT` en `guardarDocumentoProcesado` es una
 * optimización para no abortar la transacción del llamador en el camino
 * feliz (reenvío del mismo correo) — NO es el mecanismo de la garantía. Ante
 * una carrera real (dos procesos insertando el mismo CUFE al mismo tiempo),
 * el `INSERT` sigue protegido por la restricción de la base y lanza
 * `23505`: el que pierda la carrera debe reintentar en una transacción nueva,
 * tal como exige D-003 ("si la garantía no la impone la BD, no cuenta").
 */
import type { SqlClient } from '../db/types.js';
import type { DocumentoNormalizado } from './tipos.js';

// -----------------------------------------------------------------------------
// Serialización segura de bigint a jsonb (Postgres no tiene bigint en JSON).
// -----------------------------------------------------------------------------

/** `datos_extraidos` guarda los bigint como texto: JSON no tiene un tipo entero de 64 bits. */
function serializarParaJsonb(valor: unknown): string {
  return JSON.stringify(valor, (_clave, v) => (typeof v === 'bigint' ? v.toString() : v));
}

// -----------------------------------------------------------------------------
// Resolución de buzón
// -----------------------------------------------------------------------------

export interface EmpresaResuelta {
  tenantId: string;
  companyId: string;
}

/**
 * Busca la empresa dueña de un buzón dedicado (`empresa-{id}@inbox...`,
 * sección 10.1). Devuelve `null` tanto si el buzón no existe como si la
 * empresa no está activa — a propósito no se distingue el motivo aquí (el
 * detalle sí se registra en `email_ingest_log.motivo`, no en el resultado de
 * esta función): un buzón de una empresa archivada no debe seguir recibiendo
 * facturas.
 *
 * Llama a `app.resolver_empresa_por_buzon` (032_ingest_resolver_buzon.sql) en
 * vez de consultar `company` directamente: `company` tiene RLS de tenant
 * estricto (012_rls.sql), así que una sesión sin tenant todavía —que es
 * EXACTAMENTE la situación de un correo recién llegado, cuyo tenant es lo que
 * se está averiguando— vería cero filas. Es el mismo problema, y la misma
 * solución, que D-023 ya resolvió para el login con `app.buscar_credencial`.
 */
export async function resolverEmpresaPorBuzon(
  tx: SqlClient,
  buzonDestino: string,
): Promise<EmpresaResuelta | null> {
  const { rows } = await tx.query<{ company_id: string; tenant_id: string }>(
    'SELECT * FROM app.resolver_empresa_por_buzon($1)',
    [buzonDestino.toLowerCase()],
  );
  const fila = rows[0];
  if (!fila) return null;
  return { tenantId: fila.tenant_id, companyId: fila.company_id };
}

// -----------------------------------------------------------------------------
// Límite de tasa (sección 10.3)
// -----------------------------------------------------------------------------

/** Cuenta cuántos correos ya se registraron para esta empresa dentro de la ventana. */
export async function contarCorreosRecientes(
  tx: SqlClient,
  companyId: string,
  ventanaMinutos: number,
): Promise<number> {
  const { rows } = await tx.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM email_ingest_log
       WHERE company_id = $1 AND recibido_en > now() - ($2 || ' minutes')::interval`,
    [companyId, String(ventanaMinutos)],
  );
  return Number(rows[0]?.total ?? '0');
}

// -----------------------------------------------------------------------------
// Registro del correo (email_ingest_log / email_ingest_attachment)
// -----------------------------------------------------------------------------

export interface DatosCorreoParaRegistro {
  tenantId: string | null;
  companyId: string | null;
  buzonDestino: string;
  messageId: string | null;
  remitenteEmail: string;
  remitenteNombre: string | null;
  asunto: string | null;
  tamanoBytes: number;
  spfResultado: string;
  dkimResultado: string;
  cantidadAdjuntos: number;
  resultado: 'procesado' | 'procesado_parcial' | 'en_cuarentena' | 'rechazado';
  motivo: string | null;
  limiteTasaExcedido: boolean;
}

export async function registrarCorreo(tx: SqlClient, datos: DatosCorreoParaRegistro): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO email_ingest_log
       (tenant_id, company_id, buzon_destino, message_id, remitente_email, remitente_nombre,
        asunto, tamano_bytes, spf_resultado, dkim_resultado, cantidad_adjuntos, resultado,
        motivo, limite_tasa_excedido)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING id`,
    [
      datos.tenantId,
      datos.companyId,
      datos.buzonDestino,
      datos.messageId,
      datos.remitenteEmail,
      datos.remitenteNombre,
      datos.asunto,
      datos.tamanoBytes,
      datos.spfResultado,
      datos.dkimResultado,
      datos.cantidadAdjuntos,
      datos.resultado,
      datos.motivo,
      datos.limiteTasaExcedido,
    ],
  );
  return rows[0]!.id;
}

export interface DatosAdjuntoParaRegistro {
  tenantId: string;
  companyId: string;
  emailIngestLogId: string;
  nombreArchivo: string | null;
  tamanoBytes: number;
  hashSha256: string;
  tipoDocumentoDetectado: string | null;
  contenedorAttachedDocument: boolean;
  resultado: 'procesado' | 'en_cuarentena' | 'duplicado';
  motivoCuarentena: string | null;
  sourceDocumentId: string | null;
}

export async function registrarAdjunto(tx: SqlClient, datos: DatosAdjuntoParaRegistro): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO email_ingest_attachment
       (tenant_id, company_id, email_ingest_log_id, nombre_archivo, tamano_bytes, hash_sha256,
        tipo_documento_detectado, contenedor_attached_document, resultado, motivo_cuarentena,
        source_document_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [
      datos.tenantId,
      datos.companyId,
      datos.emailIngestLogId,
      datos.nombreArchivo,
      datos.tamanoBytes,
      datos.hashSha256,
      datos.tipoDocumentoDetectado,
      datos.contenedorAttachedDocument,
      datos.resultado,
      datos.motivoCuarentena,
      datos.sourceDocumentId,
    ],
  );
  return rows[0]!.id;
}

// -----------------------------------------------------------------------------
// Guardado del documento normalizado (source_document + extraction)
// -----------------------------------------------------------------------------

export interface ContextoGuardado {
  tenantId: string;
  companyId: string;
  documento: DocumentoNormalizado;
  origenDocumento?: 'correo' | 'carga_manual' | 'portal_dian' | 'api' | 'migracion';
  remitenteEmail?: string | null;
  spfValido?: boolean | null;
  dkimValido?: boolean | null;
}

export type ResultadoGuardado =
  | { resultado: 'creado'; sourceDocumentId: string }
  | { resultado: 'duplicado'; sourceDocumentId: string; porQue: 'cufe' | 'hash_contenido' };

/**
 * Busca si el documento ya existe (por CUFE, o por hash cuando no hay CUFE —
 * ApplicationResponse no lo trae). Es la comprobación "camino feliz"; el
 * `UNIQUE` de la base es quien de verdad impone la regla (ver comentario de
 * cabecera).
 */
async function buscarDuplicado(
  tx: SqlClient,
  companyId: string,
  documento: DocumentoNormalizado,
): Promise<ResultadoGuardado | null> {
  if (documento.cufe !== null) {
    const { rows } = await tx.query<{ id: string }>(
      'SELECT id FROM source_document WHERE company_id = $1 AND cufe = $2',
      [companyId, documento.cufe],
    );
    if (rows[0]) return { resultado: 'duplicado', sourceDocumentId: rows[0].id, porQue: 'cufe' };
  }

  const { rows } = await tx.query<{ id: string }>(
    'SELECT id FROM source_document WHERE company_id = $1 AND hash_contenido = $2',
    [companyId, documento.hashContenido],
  );
  if (rows[0]) return { resultado: 'duplicado', sourceDocumentId: rows[0].id, porQue: 'hash_contenido' };

  return null;
}

/** Resuelve `documento_referenciado_id` para notas: el CUFE de la factura que referencian, si ya está en el sistema. */
async function resolverDocumentoReferenciado(
  tx: SqlClient,
  companyId: string,
  documento: DocumentoNormalizado,
): Promise<string | null> {
  const cufeRef = documento.documentoReferenciado?.cufe;
  if (!cufeRef) return null;
  const { rows } = await tx.query<{ id: string }>(
    'SELECT id FROM source_document WHERE company_id = $1 AND cufe = $2',
    [companyId, cufeRef],
  );
  return rows[0]?.id ?? null;
}

export async function guardarDocumentoProcesado(
  tx: SqlClient,
  ctx: ContextoGuardado,
): Promise<ResultadoGuardado> {
  const { tenantId, companyId, documento } = ctx;

  const duplicado = await buscarDuplicado(tx, companyId, documento);
  if (duplicado) return duplicado;

  const documentoReferenciadoId = await resolverDocumentoReferenciado(tx, companyId, documento);

  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO source_document
       (tenant_id, company_id, tipo_documento, cufe, prefijo, numero_documento,
        emisor_nit, emisor_nombre, adquirente_nit, fecha_hecho_economico, fecha_emision,
        moneda, total_bruto, total_descuentos, total_iva, total_neto,
        xml_crudo, hash_contenido, nombre_archivo, origen, remitente_email,
        spf_valido, dkim_valido, estado, documento_referenciado_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
             $12, $13, $14, $15, $16,
             $17, $18, $19, $20, $21,
             $22, $23, $24, $25)
     RETURNING id`,
    [
      tenantId,
      companyId,
      documento.tipoDocumento,
      documento.cufe,
      documento.prefijo,
      documento.numeroDocumento,
      documento.emisor.nit,
      documento.emisor.nombre,
      documento.adquirente.nit,
      documento.fechaHechoEconomico,
      documento.fechaEmision,
      documento.moneda,
      documento.totales.bruto,
      documento.totales.descuentos,
      documento.totales.ivaTotal,
      documento.totales.neto,
      documento.xmlCrudo,
      documento.hashContenido,
      documento.nombreArchivo,
      ctx.origenDocumento ?? 'correo',
      ctx.remitenteEmail ?? null,
      ctx.spfValido ?? null,
      ctx.dkimValido ?? null,
      'parseado',
      documentoReferenciadoId,
    ],
  );

  const sourceDocumentId = rows[0]!.id;

  await tx.query(
    `INSERT INTO extraction (tenant_id, company_id, source_document_id, datos_extraidos, origen)
     VALUES ($1, $2, $3, $4::jsonb, 'parser_ubl')`,
    [tenantId, companyId, sourceDocumentId, serializarParaJsonb(documento)],
  );

  return { resultado: 'creado', sourceDocumentId };
}

// -----------------------------------------------------------------------------
// Lectura del XML sin asumir dónde está guardado (031_ingest_archivado_frio.sql)
// -----------------------------------------------------------------------------

export interface AdaptadorArchivoFrio {
  leer(ubicacion: string): Promise<string>;
}

export interface FilaXmlAlmacenamiento {
  xml_almacenamiento: string;
  xml_crudo: string | null;
  xml_archivo_url: string | null;
}

/**
 * Lee el XML crudo de un `source_document` sin que el llamador tenga que
 * saber si vive en la base o en almacenamiento frío (espacio reservado por
 * 031_ingest_archivado_frio.sql, no implementado en la Ola 1). Hoy SIEMPRE
 * devuelve `xml_crudo`, porque ninguna fila de la Ola 1 se archiva. El día
 * que exista un `AdaptadorArchivoFrio` real, cambia esta función; ningún
 * llamador tiene que tocarse.
 */
export async function leerXmlDocumento(
  fila: FilaXmlAlmacenamiento,
  adaptador?: AdaptadorArchivoFrio,
): Promise<string> {
  if (fila.xml_almacenamiento === 'bd') {
    if (fila.xml_crudo === null) {
      throw new Error('source_document.xml_almacenamiento = bd pero xml_crudo es NULL');
    }
    return fila.xml_crudo;
  }

  if (!adaptador) {
    throw new Error(
      `source_document está en almacenamiento frío (${fila.xml_archivo_url ?? 'sin url'}) ` +
        'pero no se proveyó un AdaptadorArchivoFrio. No implementado en la Ola 1.',
    );
  }
  if (!fila.xml_archivo_url) {
    throw new Error('xml_almacenamiento = archivo_frio pero xml_archivo_url es NULL');
  }
  return adaptador.leer(fila.xml_archivo_url);
}

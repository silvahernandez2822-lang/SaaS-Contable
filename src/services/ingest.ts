/**
 * A6 — Servicio de dominio: ingest de documento (sección 10, entregable 2).
 *
 * FRONTERA CON A4, dos capas:
 *  - `procesarAdjuntoXml` (`src/ingest/procesar.ts`): función PURA, bytes →
 *    `DocumentoNormalizado` o `ResultadoCuarentena`. Nunca se reescribe.
 *  - `guardarDocumentoProcesado` (`src/ingest/persistencia.ts`): A4 la dejó
 *    explícitamente reutilizable ("A6 no está obligado a usar este archivo...
 *    pero lo puede reutilizar si le sirve") y ES el punto que ya resuelve la
 *    deduplicación por CUFE/hash y `documento_referenciado_id` de notas
 *    crédito contra la base real. Este servicio la usa en vez de reescribir
 *    el mismo INSERT: así hay UNA sola función que decide "documento nuevo
 *    vs. duplicado" en todo el sistema (D-003, coordinado con A4 — no una
 *    segunda restricción compitiendo con `source_document_cufe_uq`).
 *
 * Lo que este archivo SÍ es exclusivamente suyo: el permiso de carga, la
 * cuarentena de la vía de carga manual (sección 10.1 — el canal de correo
 * tiene su propia traza en `email_ingest_log`/`email_ingest_attachment`, de
 * A4; carga manual no pasa por ahí), vincular el tercero emisor, y encolar la
 * causación. Nunca resuelve retenciones ni construye un asiento: eso es
 * exclusivamente el worker (`causacion.ts`).
 *
 * QUÉ CORRE EN EL REQUEST Y QUÉ CORRE EN LA COLA (ver también la cabecera de
 * `db/migrations/040_cola_documentos.sql`): decodificar el XML y guardar el
 * documento es CPU y un par de INSERT — no es el "procesamiento de facturas"
 * que la sección 5 prohíbe dentro del request. Lo que SÍ se prohíbe —
 * resolver retenciones (A3) y construir el asiento— vive exclusivamente en
 * `causacion.ts`, que solo ejecuta el worker de la cola. Esta función termina
 * con un INSERT y un encolado; nunca resuelve una retención.
 */
import { procesarAdjuntoXml, type OpcionesProcesarAdjunto } from '../ingest/procesar.js';
import { guardarDocumentoProcesado } from '../ingest/persistencia.js';
import type { DocumentoNormalizado, TipoDocumentoUbl } from '../ingest/tipos.js';
import type { SqlClient } from '../db/types.js';
import { exigirPermiso, PERMISOS } from '../auth/permisos.js';
import { encolarCausacion, type DocumentProcessingJob } from './cola.js';

export interface RecibirDocumentoInput {
  /** Bytes crudos del adjunto, tal como llegaron (antes de cualquier desempaquetado). */
  bytes: Uint8Array;
  nombreArchivo?: string | null;
  tamanoMaximoBytes?: number;
  /** Trazabilidad del canal (sección 10.3). 'carga_manual' si no se indica. */
  origen?: 'correo' | 'carga_manual' | 'portal_dian' | 'api' | 'migracion';
  remitenteEmail?: string | null;
  spfValido?: boolean | null;
  dkimValido?: boolean | null;
}

export type ResultadoIngesta =
  | {
      ok: true;
      sourceDocumentId: string;
      duplicado: boolean;
      job: DocumentProcessingJob | null;
    }
  | {
      ok: false;
      sourceDocumentId: string;
      motivoCuarentena: string;
      detalle: string;
      duplicado: boolean;
    };

/** Resuelve el `third_party` emisor por NIT. No lo crea: eso es maestro de datos, fuera de este servicio. */
async function resolverTerceroPorNit(
  tx: SqlClient,
  companyId: string,
  nit: string,
): Promise<string | null> {
  if (!nit) return null;
  const { rows } = await tx.query<{ id: string }>(
    `SELECT id FROM third_party WHERE company_id = $1 AND numero_documento = $2`,
    [companyId, nit],
  );
  return rows[0]?.id ?? null;
}

async function empresaEnContexto(tx: SqlClient): Promise<{ tenantId: string; companyId: string }> {
  const { rows } = await tx.query<{ tenant_id: string; company_id: string }>(
    `SELECT app.current_tenant_id() AS tenant_id, app.current_company_id() AS company_id`,
  );
  const fila = rows[0];
  if (!fila?.tenant_id || !fila.company_id) {
    throw new Error('recibirDocumento requiere una empresa en el contexto de sesión.');
  }
  return { tenantId: fila.tenant_id, companyId: fila.company_id };
}

/** Documento ya existente por CUFE/hash: se le busca (o se le crea) su trabajo de causación, sin volver a insertar nada. */
async function comoDuplicado(tx: SqlClient, sourceDocumentId: string): Promise<ResultadoIngesta> {
  const job = await encolarCausacion(tx, sourceDocumentId).catch(() => null);
  return { ok: true, sourceDocumentId, duplicado: true, job };
}

async function registrarCuarentena(
  tx: SqlClient,
  ctx: { tenantId: string; companyId: string },
  input: RecibirDocumentoInput,
  cuarentena: { motivo: string; detalle: string },
): Promise<ResultadoIngesta> {
  const { createHash } = await import('node:crypto');
  const hash = createHash('sha256').update(input.bytes).digest('hex');

  const { rows: existente } = await tx.query<{ id: string }>(
    `SELECT id FROM source_document WHERE company_id = $1 AND hash_contenido = $2`,
    [ctx.companyId, hash],
  );
  if (existente[0]) {
    return { ok: false, sourceDocumentId: existente[0].id, ...cuarentena, duplicado: true };
  }

  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO source_document (
       tenant_id, company_id, tipo_documento, numero_documento, emisor_nit,
       fecha_hecho_economico, hash_contenido, nombre_archivo, origen, remitente_email,
       spf_valido, dkim_valido, estado, motivo_rechazo)
     VALUES ($1, $2, 'Otro', $3, '', CURRENT_DATE, $4, $5, $6, $7, $8, $9, 'en_cuarentena', $10)
     RETURNING id`,
    [
      ctx.tenantId,
      ctx.companyId,
      input.nombreArchivo ?? `cuarentena-${hash.slice(0, 12)}`,
      hash,
      input.nombreArchivo ?? null,
      input.origen ?? 'carga_manual',
      input.remitenteEmail ?? null,
      input.spfValido ?? null,
      input.dkimValido ?? null,
      `${cuarentena.motivo}: ${cuarentena.detalle}`,
    ],
  );

  return { ok: false, sourceDocumentId: rows[0]!.id, ...cuarentena, duplicado: false };
}

/**
 * Ingesta un documento: lo decodifica (A4), lo persiste de forma idempotente
 * (reutilizando `guardarDocumentoProcesado` de A4 para el camino feliz) y
 * encola su causación. `tx` debe venir de una sesión normal
 * (`withSessionContext`): RLS decide a qué empresa pertenece, y el trigger de
 * permiso de `source_document`/`document_processing_job` exige
 * `documento.cargar` (D-021 — nunca se fija `tenant_id`/`company_id` a mano).
 */
export async function recibirDocumento(
  tx: SqlClient,
  input: RecibirDocumentoInput,
): Promise<ResultadoIngesta> {
  await exigirPermiso(tx, PERMISOS.DOCUMENTO_CARGAR);
  const ctx = await empresaEnContexto(tx);

  const opciones: OpcionesProcesarAdjunto = {
    nombreArchivo: input.nombreArchivo ?? null,
    ...(input.tamanoMaximoBytes === undefined ? {} : { tamanoMaximoBytes: input.tamanoMaximoBytes }),
  };
  const resultado = procesarAdjuntoXml(input.bytes, opciones);

  if (!resultado.ok) {
    return registrarCuarentena(tx, ctx, input, {
      motivo: resultado.cuarentena.motivo,
      detalle: resultado.cuarentena.detalle,
    });
  }

  const documento = resultado.documento;
  const guardado = await guardarDocumentoProcesado(tx, {
    tenantId: ctx.tenantId,
    companyId: ctx.companyId,
    documento,
    origenDocumento: input.origen ?? 'carga_manual',
    remitenteEmail: input.remitenteEmail ?? null,
    spfValido: input.spfValido ?? null,
    dkimValido: input.dkimValido ?? null,
  });

  if (guardado.resultado === 'duplicado') {
    return comoDuplicado(tx, guardado.sourceDocumentId);
  }

  // Vincular el tercero emisor (fuera del alcance de guardarDocumentoProcesado:
  // es resolución de maestro de datos, no persistencia del documento).
  const terceroId = await resolverTerceroPorNit(tx, ctx.companyId, documento.emisor.nit);
  if (terceroId) {
    await tx.query(`UPDATE source_document SET third_party_id = $1 WHERE id = $2`, [
      terceroId,
      guardado.sourceDocumentId,
    ]);
  }

  const job = await encolarCausacion(tx, guardado.sourceDocumentId);
  return { ok: true, sourceDocumentId: guardado.sourceDocumentId, duplicado: false, job };
}

// -----------------------------------------------------------------------------
// Proyección de líneas para causación (usada por `causacion.ts` al leer
// `extraction.datos_extraidos`, que `guardarDocumentoProcesado` guarda con la
// forma completa de `DocumentoNormalizado`, bigints ya vueltos texto por A4).
// -----------------------------------------------------------------------------

export interface LineaExtraida {
  numero: number;
  descripcion: string | null;
  /** Subtotal de la línea antes de impuestos, en centavos. Es la base gravable de la línea. */
  baseGravable: number | null;
  /** Suma de los impuestos de código UBL "01" (IVA) de la línea, en centavos. */
  valorIva: number;
}

export interface DatosExtraidos {
  tipoDocumento: TipoDocumentoUbl;
  emisor: { nit: string; nombre: string | null };
  adquirente: { nit: string | null; nombre: string | null };
  lineas: LineaExtraida[];
}

const CODIGO_UBL_IVA = '01';

function aNumero(valor: unknown): number | null {
  if (valor === null || valor === undefined) return null;
  return typeof valor === 'string' ? Number(valor) : Number(valor);
}

/**
 * Lee `extraction.datos_extraidos` (guardado por A4 con
 * `DocumentoNormalizado` completo, bigints como texto) y proyecta solo lo que
 * `causacion.ts` necesita: descripción, base gravable e IVA por línea.
 */
export function proyectarLineasParaCausacion(datosExtraidos: unknown): DatosExtraidos {
  const d = datosExtraidos as {
    tipoDocumento: TipoDocumentoUbl;
    emisor: { nit: string; nombre: string | null };
    adquirente: { nit: string | null; nombre: string | null };
    lineas: readonly {
      numero: number;
      descripcion: string | null;
      subtotal: unknown;
      impuestos: readonly { codigo: string | null; valor: unknown }[];
    }[];
  };

  return {
    tipoDocumento: d.tipoDocumento,
    emisor: d.emisor,
    adquirente: d.adquirente,
    lineas: d.lineas.map((l) => ({
      numero: l.numero,
      descripcion: l.descripcion,
      baseGravable: aNumero(l.subtotal),
      valorIva: l.impuestos
        .filter((i) => i.codigo === CODIGO_UBL_IVA)
        .reduce((acc, i) => acc + (aNumero(i.valor) ?? 0), 0),
    })),
  };
}

export type { DocumentoNormalizado };

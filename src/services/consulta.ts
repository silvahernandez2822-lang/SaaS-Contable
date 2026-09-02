/**
 * A6 — Servicio de dominio: consulta de estado (entregable 2).
 *
 * De solo lectura. `tx` viene de una sesión normal (`withSessionContext`):
 * RLS decide qué documento es visible, esta función no filtra por tenant ni
 * por empresa a mano (D-021).
 */
import type { SqlClient } from '../db/types';
import { exigirPermiso, PERMISOS } from '../auth/permisos';
import { estadoJobDeDocumento, type DocumentProcessingJob } from './cola';

export interface RetencionResumen {
  id: string;
  tipo: string;
  base: string;
  tarifa: string;
  valor: string;
  aplicada: boolean;
  motivoNoAplica: string | null;
  normaRespaldo: string;
  // A7, Ola 2 (sección 4, "diferenciador de producto, no detalle técnico"):
  // la regla de oro 6 exige que cada asiento responda "qué regla y qué
  // vigencia se aplicó". `retention_applied` ya guarda estos dos campos
  // desde la Ola 1 (D-017); lo único que faltaba era exponerlos aquí.
  vigenteDesde: string;
  vigenteHasta: string | null;
  /** Municipio usado para el cálculo (solo ReteICA). Visible a propósito: es
   * la trazabilidad de V-8 — si el humano corrigió el municipio antes de
   * causar, este es el que de verdad se usó, no el del tercero por defecto. */
  municipioNombre: string | null;
  conceptoCodigo: string | null;
  conceptoNombre: string | null;
}

export interface PartidaResumen {
  id: string;
  linea: number;
  cuentaCodigo: string;
  cuentaNombre: string;
  side: 'debito' | 'credito';
  monto: string;
  descripcion: string | null;
  retentionAppliedId: string | null;
}

export interface AsientoResumen {
  id: string;
  numero: string;
  estado: string;
  tipo: string;
  postedAt: string | null;
  reversedBy: string | null;
  partidas: PartidaResumen[];
}

export interface EstadoDocumento {
  sourceDocumentId: string;
  estado: string;
  tipoDocumento: string;
  cufe: string | null;
  numeroDocumento: string;
  emisorNit: string;
  emisorNombre: string | null;
  fechaHechoEconomico: string;
  motivoRechazo: string | null;
  /** Total bruto del documento en centavos (Regla de Oro 5), como texto. null
   * si el parser no lo pudo determinar. Insumo del filtro por monto. */
  totalBrutoCentavos: string | null;
  job: DocumentProcessingJob | null;
  retenciones: RetencionResumen[];
  asiento: AsientoResumen | null;
  /** A7 · D-079: score de confianza del motor de clasificación para este
   * documento, en puntos porcentuales 0–100 (de la última `extraction` con
   * score). null si nunca hubo clasificación con score — p. ej. una causación
   * que no necesitó IA. Insumo del filtro por confianza de la bandeja. */
  scoreConfianza: number | null;
}

/** Estado consolidado de un documento: dónde va en el pipeline y por qué. */
export async function consultarEstadoDocumento(
  tx: SqlClient,
  sourceDocumentId: string,
): Promise<EstadoDocumento | null> {
  await exigirPermiso(tx, PERMISOS.DOCUMENTO_LEER);

  const { rows } = await tx.query<{
    id: string;
    estado: string;
    tipo_documento: string;
    cufe: string | null;
    numero_documento: string;
    emisor_nit: string;
    emisor_nombre: string | null;
    fecha_hecho_economico: string;
    motivo_rechazo: string | null;
    total_bruto: string | null;
  }>(
    `SELECT id, estado, tipo_documento, cufe, numero_documento, emisor_nit, emisor_nombre,
            fecha_hecho_economico::text, motivo_rechazo, total_bruto::text
       FROM source_document WHERE id = $1`,
    [sourceDocumentId],
  );
  const doc = rows[0];
  if (!doc) return null; // No existe, o RLS lo esconde: indistinguible desde aquí, como cualquier SELECT.

  const job = await estadoJobDeDocumento(tx, sourceDocumentId);

  const { rows: retenciones } = await tx.query<RetencionResumen>(
    `SELECT ra.id, ra.tipo, ra.base::text, ra.tarifa::text, ra.valor::text, ra.aplicada,
            ra.motivo_no_aplica AS "motivoNoAplica", ra.norma_respaldo AS "normaRespaldo",
            ra.regla_vigente_desde::text AS "vigenteDesde", ra.regla_vigente_hasta::text AS "vigenteHasta",
            m.nombre AS "municipioNombre", cc.codigo AS "conceptoCodigo", cc.nombre AS "conceptoNombre"
       FROM retention_applied ra
       LEFT JOIN municipality m ON m.id = ra.municipality_id
       LEFT JOIN concepto_causacion cc ON cc.id = ra.concepto_causacion_id
      WHERE ra.source_document_id = $1
      ORDER BY ra.tipo, ra.id`,
    [sourceDocumentId],
  );

  const { rows: asientoRows } = await tx.query<{
    id: string;
    numero: string;
    estado: string;
    tipo: string;
    posted_at: string | null;
    reversed_by: string | null;
  }>(
    `SELECT id, numero::text, estado, tipo, posted_at, reversed_by
       FROM v_journal_entry WHERE source_document_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [sourceDocumentId],
  );
  const a = asientoRows[0];

  const { rows: scoreRows } = await tx.query<{ score: string | null }>(
    `SELECT score_confianza::text AS score
       FROM extraction
      WHERE source_document_id = $1 AND score_confianza IS NOT NULL
      ORDER BY created_at DESC LIMIT 1`,
    [sourceDocumentId],
  );
  const scoreConfianza =
    scoreRows[0]?.score != null ? Math.round(Number(scoreRows[0].score) * 100) : null;

  let partidas: PartidaResumen[] = [];
  if (a) {
    const { rows: partidaRows } = await tx.query<PartidaResumen>(
      `SELECT jl.id, jl.linea, acc.codigo AS "cuentaCodigo", acc.nombre AS "cuentaNombre",
              jl.side, jl.monto::text, jl.descripcion, jl.retention_applied_id AS "retentionAppliedId"
         FROM journal_line jl
         JOIN account acc ON acc.id = jl.account_id
        WHERE jl.journal_entry_id = $1
        ORDER BY jl.linea`,
      [a.id],
    );
    partidas = partidaRows;
  }

  return {
    sourceDocumentId: doc.id,
    estado: doc.estado,
    tipoDocumento: doc.tipo_documento,
    cufe: doc.cufe,
    numeroDocumento: doc.numero_documento,
    emisorNit: doc.emisor_nit,
    emisorNombre: doc.emisor_nombre,
    fechaHechoEconomico: doc.fecha_hecho_economico,
    motivoRechazo: doc.motivo_rechazo,
    totalBrutoCentavos: doc.total_bruto,
    job,
    retenciones,
    scoreConfianza,
    asiento: a
      ? {
          id: a.id,
          numero: a.numero,
          estado: a.estado,
          tipo: a.tipo,
          postedAt: a.posted_at,
          reversedBy: a.reversed_by,
          partidas,
        }
      : null,
  };
}

/** Bandeja: documentos pendientes de aprobación de la empresa en contexto (insumo de A7).
 *
 * A7 · D-079: el filtro por rango de fecha del hecho económico se aplica AQUÍ,
 * en la consulta, no después del `LIMIT` — filtrar tras acotar dejaría fuera
 * documentos que sí entran en el rango. Los demás filtros de la bandeja
 * (proveedor, monto, score) sí se aplican sobre el resultado consolidado, en
 * `app/lib/bandeja.ts`: no son monótonos con el orden por fecha, pero el
 * volumen por empresa está acotado por `limite`. */
export async function listarPendientesDeAprobacion(
  tx: SqlClient,
  opciones: { limite?: number; desde?: string | null; hasta?: string | null } = {},
): Promise<EstadoDocumento[]> {
  await exigirPermiso(tx, PERMISOS.DOCUMENTO_LEER);

  const { rows } = await tx.query<{ id: string }>(
    `SELECT id FROM source_document
      WHERE estado = 'pendiente_aprobacion'
        AND ($2::date IS NULL OR fecha_hecho_economico >= $2::date)
        AND ($3::date IS NULL OR fecha_hecho_economico <= $3::date)
      ORDER BY fecha_hecho_economico LIMIT $1`,
    [opciones.limite ?? 100, opciones.desde ?? null, opciones.hasta ?? null],
  );
  const resultados: EstadoDocumento[] = [];
  for (const r of rows) {
    const estado = await consultarEstadoDocumento(tx, r.id);
    if (estado) resultados.push(estado);
  }
  return resultados;
}

// =============================================================================
// A7 · D-079 — insumos de la Fase 2 de la bandeja
// =============================================================================

export interface CuentaImputable {
  codigo: string;
  nombre: string;
  naturaleza: 'debito' | 'credito';
}

/** PUC efectivo de la empresa en contexto, solo las cuentas imputables — para
 * el selector de cuenta al editar una línea de un asiento borrador. */
export async function listarCuentasImputables(tx: SqlClient): Promise<CuentaImputable[]> {
  await exigirPermiso(tx, PERMISOS.PUC_LEER);
  const { rows } = await tx.query<CuentaImputable>(
    `SELECT codigo, nombre, naturaleza
       FROM v_account_efectivo
      WHERE permite_movimiento AND activo
      ORDER BY codigo`,
  );
  return rows;
}

export interface DocumentoOriginal {
  sourceDocumentId: string;
  numeroDocumento: string;
  emisorNit: string;
  tipoDocumento: string;
  /** XML crudo tal como llegó (UBL 2.1). null si el documento se archivó en
   * frío (`xml_almacenamiento = 'archivo_frio'`) y ya no vive en la base. */
  xmlCrudo: string | null;
  xmlAlmacenamiento: string;
  xmlArchivoUrl: string | null;
}

/** Documento original (XML) de una factura, para el visor de la bandeja.
 * RLS decide la visibilidad; esta función no filtra por empresa a mano. */
export async function obtenerDocumentoOriginal(
  tx: SqlClient,
  sourceDocumentId: string,
): Promise<DocumentoOriginal | null> {
  await exigirPermiso(tx, PERMISOS.DOCUMENTO_LEER);
  const { rows } = await tx.query<{
    id: string;
    numero_documento: string;
    emisor_nit: string;
    tipo_documento: string;
    xml_crudo: string | null;
    xml_almacenamiento: string;
    xml_archivo_url: string | null;
  }>(
    `SELECT id, numero_documento, emisor_nit, tipo_documento,
            xml_crudo, xml_almacenamiento, xml_archivo_url
       FROM source_document WHERE id = $1`,
    [sourceDocumentId],
  );
  const d = rows[0];
  if (!d) return null;
  return {
    sourceDocumentId: d.id,
    numeroDocumento: d.numero_documento,
    emisorNit: d.emisor_nit,
    tipoDocumento: d.tipo_documento,
    xmlCrudo: d.xml_crudo,
    xmlAlmacenamiento: d.xml_almacenamiento,
    xmlArchivoUrl: d.xml_archivo_url,
  };
}

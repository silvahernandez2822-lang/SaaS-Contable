/**
 * A6 — Servicio de dominio: consulta de estado (entregable 2).
 *
 * De solo lectura. `tx` viene de una sesión normal (`withSessionContext`):
 * RLS decide qué documento es visible, esta función no filtra por tenant ni
 * por empresa a mano (D-021).
 */
import type { SqlClient } from '../db/types.js';
import { exigirPermiso, PERMISOS } from '../auth/permisos.js';
import { estadoJobDeDocumento, type DocumentProcessingJob } from './cola.js';

export interface RetencionResumen {
  id: string;
  tipo: string;
  base: string;
  tarifa: string;
  valor: string;
  aplicada: boolean;
  motivoNoAplica: string | null;
  normaRespaldo: string;
}

export interface AsientoResumen {
  id: string;
  numero: string;
  estado: string;
  tipo: string;
  postedAt: string | null;
  reversedBy: string | null;
}

export interface EstadoDocumento {
  sourceDocumentId: string;
  estado: string;
  tipoDocumento: string;
  cufe: string | null;
  numeroDocumento: string;
  emisorNit: string;
  fechaHechoEconomico: string;
  motivoRechazo: string | null;
  job: DocumentProcessingJob | null;
  retenciones: RetencionResumen[];
  asiento: AsientoResumen | null;
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
    fecha_hecho_economico: string;
    motivo_rechazo: string | null;
  }>(
    `SELECT id, estado, tipo_documento, cufe, numero_documento, emisor_nit,
            fecha_hecho_economico::text, motivo_rechazo
       FROM source_document WHERE id = $1`,
    [sourceDocumentId],
  );
  const doc = rows[0];
  if (!doc) return null; // No existe, o RLS lo esconde: indistinguible desde aquí, como cualquier SELECT.

  const job = await estadoJobDeDocumento(tx, sourceDocumentId);

  const { rows: retenciones } = await tx.query<RetencionResumen>(
    `SELECT id, tipo, base::text, tarifa::text, valor::text, aplicada, motivo_no_aplica AS "motivoNoAplica",
            norma_respaldo AS "normaRespaldo"
       FROM retention_applied WHERE source_document_id = $1
      ORDER BY tipo, id`,
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

  return {
    sourceDocumentId: doc.id,
    estado: doc.estado,
    tipoDocumento: doc.tipo_documento,
    cufe: doc.cufe,
    numeroDocumento: doc.numero_documento,
    emisorNit: doc.emisor_nit,
    fechaHechoEconomico: doc.fecha_hecho_economico,
    motivoRechazo: doc.motivo_rechazo,
    job,
    retenciones,
    asiento: a
      ? { id: a.id, numero: a.numero, estado: a.estado, tipo: a.tipo, postedAt: a.posted_at, reversedBy: a.reversed_by }
      : null,
  };
}

/** Bandeja: documentos pendientes de aprobación de la empresa en contexto (insumo de A7). */
export async function listarPendientesDeAprobacion(
  tx: SqlClient,
  opciones: { limite?: number } = {},
): Promise<EstadoDocumento[]> {
  await exigirPermiso(tx, PERMISOS.DOCUMENTO_LEER);

  const { rows } = await tx.query<{ id: string }>(
    `SELECT id FROM source_document WHERE estado = 'pendiente_aprobacion'
      ORDER BY fecha_hecho_economico LIMIT $1`,
    [opciones.limite ?? 100],
  );
  const resultados: EstadoDocumento[] = [];
  for (const r of rows) {
    const estado = await consultarEstadoDocumento(tx, r.id);
    if (estado) resultados.push(estado);
  }
  return resultados;
}

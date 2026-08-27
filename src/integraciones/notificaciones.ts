/**
 * A13 — Datos de solo lectura para las notificaciones que n8n programa
 * (sección 13.1: "alertas al contador cuando hay facturas pendientes de
 * revisión, cuando un buzón falla, cuando se acerca un vencimiento
 * tributario").
 *
 * TODO en este archivo es un `SELECT`. Ninguna función calcula una
 * retención, arma un asiento ni decide una tarifa — solo cuenta filas y
 * agrega fechas ya existentes. n8n es quien decide CÓMO avisar (correo,
 * Slack, lo que la firma configure) y CUÁNDO consultar (el `Schedule
 * Trigger` de cada workflow, `n8n/*.workflow.json`); esta capa solo contesta
 * QUÉ hay que avisar, con `tx` ya situado en su empresa (D-021), igual que
 * cualquier otro servicio de `src/services`.
 */
import type { SqlClient } from '../db/types';
import { exigirPermiso, PERMISOS } from '../auth/permisos';

export interface FacturaPendiente {
  sourceDocumentId: string;
  numeroDocumento: string;
  emisorNit: string;
  fechaHechoEconomico: string;
  diasEnEspera: number;
}

/**
 * Documentos en `pendiente_aprobacion` con más de `diasMinimos` días
 * esperando revisión humana — el insumo de "facturas pendientes de
 * revisión" (13.1). Cuenta días de calendario contra `updated_at`, no
 * calcula ningún plazo tributario.
 */
export async function listarFacturasPendientesParaNotificar(
  tx: SqlClient,
  opciones: { diasMinimos?: number; limite?: number } = {},
): Promise<FacturaPendiente[]> {
  await exigirPermiso(tx, PERMISOS.DOCUMENTO_LEER);
  const diasMinimos = opciones.diasMinimos ?? 1;

  const { rows } = await tx.query<{
    id: string;
    numero_documento: string;
    emisor_nit: string;
    fecha_hecho_economico: string;
    dias: string;
  }>(
    `SELECT id, numero_documento, emisor_nit, fecha_hecho_economico::text,
            extract(day FROM now() - updated_at)::text AS dias
       FROM source_document
      WHERE estado = 'pendiente_aprobacion'
        AND updated_at <= now() - ($1 || ' days')::interval
      ORDER BY updated_at
      LIMIT $2`,
    [String(diasMinimos), opciones.limite ?? 200],
  );
  return rows.map((r) => ({
    sourceDocumentId: r.id,
    numeroDocumento: r.numero_documento,
    emisorNit: r.emisor_nit,
    fechaHechoEconomico: r.fecha_hecho_economico,
    diasEnEspera: Number(r.dias),
  }));
}

export interface BuzonConFallas {
  buzonDestino: string;
  companyId: string | null;
  totalFallas: number;
  ultimaFallaEn: string;
  ultimoMotivo: string | null;
}

/**
 * Buzones (de la empresa en contexto, o sin empresa reconocida) con correos
 * rechazados o en cuarentena en la ventana reciente — el insumo de "cuando un
 * buzón falla" (13.1). Cuenta y agrupa filas de `email_ingest_log` (A4),
 * nunca decide si el correo era válido o no: eso ya lo decidió
 * `procesarWebhookCorreo` al escribir cada fila.
 */
export async function listarBuzonesConFallas(
  tx: SqlClient,
  opciones: { ventanaHoras?: number; minimoFallas?: number } = {},
): Promise<BuzonConFallas[]> {
  await exigirPermiso(tx, PERMISOS.DOCUMENTO_LEER);
  const ventanaHoras = opciones.ventanaHoras ?? 24;
  const minimoFallas = opciones.minimoFallas ?? 1;

  const { rows } = await tx.query<{
    buzon_destino: string;
    company_id: string | null;
    total: string;
    ultima_en: string;
    ultimo_motivo: string | null;
  }>(
    `SELECT buzon_destino, company_id, count(*)::text AS total,
            max(recibido_en)::text AS ultima_en,
            (array_agg(motivo ORDER BY recibido_en DESC))[1] AS ultimo_motivo
       FROM email_ingest_log
      WHERE resultado IN ('rechazado', 'en_cuarentena')
        AND recibido_en >= now() - ($1 || ' hours')::interval
      GROUP BY buzon_destino, company_id
     HAVING count(*) >= $2
      ORDER BY max(recibido_en) DESC`,
    [String(ventanaHoras), minimoFallas],
  );
  return rows.map((r) => ({
    buzonDestino: r.buzon_destino,
    companyId: r.company_id,
    totalFallas: Number(r.total),
    ultimaFallaEn: r.ultima_en,
    ultimoMotivo: r.ultimo_motivo,
  }));
}

export interface VencimientoProximo {
  tipoObligacion: string;
  periodo: string;
  fechaVencimiento: string;
  diasRestantes: number;
  norma: string;
}

/**
 * Obligaciones de `tax_calendar` (A1) cuya fecha de vencimiento cae dentro de
 * los próximos `diasVentana` días, para el NIT de la empresa en contexto (por
 * el último dígito, o la fila que aplica a "todos") — el insumo de "cuando se
 * acerca un vencimiento tributario" (13.1). Es un FILTRO sobre fechas ya
 * cargadas por A1 con su propia vigencia y norma de respaldo: no calcula
 * ningún vencimiento nuevo ni interpreta el calendario tributario, solo
 * pregunta cuáles de los ya cargados están cerca.
 */
export async function listarVencimientosProximos(
  tx: SqlClient,
  opciones: { diasVentana?: number } = {},
): Promise<VencimientoProximo[]> {
  await exigirPermiso(tx, PERMISOS.DOCUMENTO_LEER);
  const diasVentana = opciones.diasVentana ?? 15;

  const { rows: empresa } = await tx.query<{ nit: string }>(
    `SELECT nit FROM company WHERE id = app.current_company_id()`,
  );
  const nit = empresa[0]?.nit;
  if (!nit) return [];
  const ultimoDigito = nit.slice(-1);

  const { rows } = await tx.query<{
    tipo_obligacion: string;
    periodo: string;
    fecha_vencimiento: string;
    dias: string;
    norma_respaldo: string;
  }>(
    `SELECT tipo_obligacion, periodo, fecha_vencimiento::text,
            (fecha_vencimiento - CURRENT_DATE)::text AS dias, norma_respaldo
       FROM tax_calendar
      WHERE (ultimo_digito_nit = $1 OR ultimo_digito_nit = 'todos')
        AND fecha_vencimiento BETWEEN CURRENT_DATE AND CURRENT_DATE + ($2 || ' days')::interval
        AND vigente_desde <= CURRENT_DATE AND vigente_hasta IS NULL
      ORDER BY fecha_vencimiento`,
    [ultimoDigito, String(diasVentana)],
  );
  return rows.map((r) => ({
    tipoObligacion: r.tipo_obligacion,
    periodo: r.periodo,
    fechaVencimiento: r.fecha_vencimiento,
    diasRestantes: Number(r.dias),
    norma: r.norma_respaldo,
  }));
}

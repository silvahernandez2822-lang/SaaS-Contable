/**
 * A6 — Servicios de dominio: causación, aprobación y reversa (entregable 2).
 *
 * FRONTERA CON A3 (Regla de Oro 4: la IA nunca calcula, y A6 tampoco calcula
 * ninguna retención por su cuenta): este módulo NUNCA decide una tarifa, una
 * base mínima ni un redondeo. Toda la resolución pasa por `resolverFactura` /
 * `resolverReversaNotaCredito` de `src/domain/index.js`, con
 * `RepositorioTributarioSql` como único acceso a las tablas paramétricas. Lo
 * que este módulo SÍ decide es cómo esos resultados se vuelven un asiento:
 * qué cuenta debita, qué cuenta acredita y en qué orden — mecánica contable,
 * no tributaria.
 *
 * QUIÉN LLAMA QUÉ:
 *  - `procesarJobCausacion` la llama el worker de la cola, en contexto de
 *    administración (`withAdminContext`). NUNCA se llama para servir una
 *    petición de usuario en vivo — es exactamente el "procesamiento" que la
 *    sección 5 prohíbe dentro del request HTTP.
 *  - `aprobarAsiento`, `aprobarAsientosEnLote` y `reversarAsientoPublicado`
 *    las llama una sesión normal (`withSessionContext`): son decisiones
 *    humanas, y la base exige el permiso correspondiente
 *    (`causacion.aprobar` / `causacion.reversar`) con un trigger, no con un
 *    `if` de este archivo.
 */
import {
  RepositorioTributarioSql,
  agregar,
  aplicarAcumuladosIca,
  persistirLista,
  persistirRetenciones,
  proporcion,
  resolverFactura,
  resolverReversaNotaCredito,
  type EntradaFactura,
  type LineaFactura,
  type ResultadoResolucion,
  type RetencionAgregada,
  type RetencionResuelta,
} from '../domain/index';
import { isPostgresError, SQLSTATE } from '../db/types';
import type { SqlClient } from '../db/types';
import { exigirPermiso, PERMISOS } from '../auth/permisos';
// Solo la normalización de A5, que es una función pura y sin I/O. La
// clasificación por IA no se llama desde aquí: el worker de causación resuelve
// contra la memoria y nada más (Regla de Oro 4 y caso dorado 19).
import { patronesDeMemoria } from '../ai/normalizar';
import { proyectarLineasParaCausacion, type DatosExtraidos, type LineaExtraida } from './ingest';
import { completarJob, type DocumentProcessingJob } from './cola';
// V-7/V-8 (Ola 1), cerradas por A7 en la Ola 2: correcciones humanas de AIU
// por línea y de municipio de la operación, capturadas en la bandeja de
// revisión ANTES de que este archivo vuelva a intentar la causación
// (`document_correction`, migración 070). A6 no cambia: sigue sin calcular
// nada; esto solo alimenta la entrada con datos que un humano ya confirmó.
import { obtenerCorreccionesVigentes } from './bandeja';

// =============================================================================
// TIPOS DE RESULTADO
// =============================================================================

export interface MotivoLocal {
  codigo: string;
  detalle: string;
}

export type ResultadoProcesamiento =
  | { estado: 'causado'; journalEntryId: string; huella: string }
  | { estado: 'ya_procesado'; journalEntryId: string | null }
  | { estado: 'revision_manual'; motivos: MotivoLocal[] };

interface FilaSourceDocument {
  id: string;
  tenant_id: string;
  company_id: string;
  tipo_documento: string;
  cufe: string | null;
  third_party_id: string | null;
  fecha_hecho_economico: string;
  estado: string;
  total_bruto: string | null;
  total_descuentos: string | null;
  total_iva: string | null;
  total_neto: string | null;
  documento_referenciado_id: string | null;
}

interface FilaConceptoCuentas {
  id: string;
  cuenta_gasto_id: string | null;
  cuenta_iva_descontable_id: string | null;
  cuenta_contrapartida_id: string | null;
}

/**
 * Lookup de memoria (sección 8.3, paso 2).
 *
 * La Ola 1 normalizaba al mínimo (minúsculas + trim, D-013) y dejaba dicho que
 * el resto lo haría A5. A5 ya normaliza de verdad —sin tildes, sin números
 * variables, sin fechas— y marca sus filas con `normalizador_version = 2`. Las
 * filas escritas antes siguen ahí, con la normalización vieja, y no se
 * reescriben: `patronesDeMemoria` devuelve LOS DOS patrones y se busca con
 * ambos, prefiriendo el nuevo. Así ninguna factura deja de encontrar su
 * memoria por culpa del cambio.
 */
async function buscarConceptoEnMemoria(
  tx: SqlClient,
  companyId: string,
  terceroId: string,
  descripcion: string | null,
): Promise<string | null> {
  const patrones = patronesDeMemoria(descripcion);
  if (patrones.length === 0) return null;
  const { rows } = await tx.query<{ concepto_causacion_id: string }>(
    `SELECT concepto_causacion_id FROM memoria_clasificacion
      WHERE company_id = $1 AND third_party_id = $2
        AND patron_descripcion = ANY($3::text[]) AND activo
      ORDER BY (patron_descripcion = $4) DESC,
               normalizador_version DESC,
               ultima_confirmacion_en DESC
      LIMIT 1`,
    [companyId, terceroId, patrones, patrones[0]],
  );
  return rows[0]?.concepto_causacion_id ?? null;
}

async function abrirPeriodoFiscal(
  tx: SqlClient,
  companyId: string,
  fecha: string,
): Promise<string | null> {
  const { rows } = await tx.query<{ id: string }>(
    `SELECT id FROM fiscal_period
      WHERE company_id = $1 AND estado = 'abierto' AND fecha_inicio <= $2::date AND fecha_fin >= $2::date
      LIMIT 1`,
    [companyId, fecha],
  );
  return rows[0]?.id ?? null;
}

function jsonComoObjeto<T>(valor: unknown): T {
  return (typeof valor === 'string' ? JSON.parse(valor) : valor) as T;
}

/**
 * Clave de idempotencia de un asiento de causación (V-23).
 *
 * El primer intento usa `causacion:<doc>` — retrocompatible con todo lo ya
 * escrito. Solo se versiona (`causacion:<doc>#2`, `#3`, …) por cada asiento de
 * causación ANULADO que el documento dejó atrás — el rastro de una rechazada
 * que se reintegró (`app.reintegrar_documento_rechazado`).
 *
 * Se cuentan SOLO los anulados a propósito: si existe un asiento de causación
 * VIVO con la clave base (otro worker ganó la carrera antes de este INSERT),
 * este intento vuelve a elegir la clave base, choca contra `journal_entry_idem_uq`
 * y el `catch` lo reconoce como `ya_procesado` — nunca crea un segundo asiento
 * vivo (D-043). `#n` es un identificador técnico, no un valor tributario
 * (Regla de Oro 2).
 */
async function idempotencyKeyCausacion(
  tx: SqlClient,
  companyId: string,
  sourceDocumentId: string,
): Promise<string> {
  const base = `causacion:${sourceDocumentId}`;
  const { rows } = await tx.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM journal_entry
      WHERE company_id = $1 AND source_document_id = $2
        AND idempotency_key LIKE 'causacion:%'
        AND estado = 'anulado'`,
    [companyId, sourceDocumentId],
  );
  const anulados = Number(rows[0]?.n ?? '0');
  return anulados === 0 ? base : `${base}#${anulados + 1}`;
}

// =============================================================================
// CONSTRUCCIÓN DE PARTIDAS (mecánica contable, no tributaria)
// =============================================================================

export interface PartidaBorrador {
  accountId: string;
  side: 'debito' | 'credito';
  monto: number;
  thirdPartyId?: string | null;
  baseGravable?: number | null;
  retentionAppliedId?: string | null;
  descripcion?: string | null;
}

interface GrupoConceptoCausacion {
  conceptoId: string;
  baseGravable: number;
  valorIva: number;
  /** V-7 (Ola 1, cerrada por A7 en la Ola 2): AIU capturado a mano por línea,
   * sumado por concepto igual que la base y el IVA. `null` si ninguna línea
   * del grupo trae una corrección de AIU guardada. */
  valorAiu: number | null;
}

/**
 * `aiuPorLinea` viene de `obtenerCorreccionesVigentes` (`./bandeja.js`, A7,
 * V-7): el parser de A4 no discrimina AIU por línea, así que ese dato SOLO
 * existe si un humano lo capturó en la bandeja de revisión.
 */
function agruparLineasPorConcepto(
  lineas: readonly LineaExtraida[],
  conceptoPorLinea: ReadonlyMap<number, string>,
  aiuPorLinea: ReadonlyMap<number, number> = new Map(),
): GrupoConceptoCausacion[] {
  const mapa = new Map<string, GrupoConceptoCausacion>();
  for (const l of lineas) {
    const conceptoId = conceptoPorLinea.get(l.numero);
    if (!conceptoId) continue;
    const base = l.baseGravable ?? 0;
    const aiuLinea = aiuPorLinea.get(l.numero) ?? null;
    const previo = mapa.get(conceptoId);
    if (previo) {
      previo.baseGravable += base;
      previo.valorIva += l.valorIva;
      if (aiuLinea !== null) previo.valorAiu = (previo.valorAiu ?? 0) + aiuLinea;
    } else {
      mapa.set(conceptoId, { conceptoId, baseGravable: base, valorIva: l.valorIva, valorAiu: aiuLinea });
    }
  }
  return [...mapa.values()];
}

/**
 * Arma las partidas de la causación: débito de gasto e IVA descontable por
 * cada concepto presente en la factura, un único crédito de contrapartida
 * (proveedores) por el neto a pagar, y un crédito por cada retención agregada
 * que sí aplicó. Balancea por construcción: la BD lo vuelve a verificar en el
 * COMMIT (LG002) como red de seguridad, no como única defensa.
 *
 * SIMPLIFICACIÓN DOCUMENTADA: si la factura trae conceptos con distinta
 * `cuenta_contrapartida_id` (infrecuente: normalmente todos los conceptos de
 * una empresa comparten la cuenta de proveedores), se usa la del primer
 * concepto en orden de aparición y se marca `contrapartidaAmbigua` en el
 * resultado para que quede visible, en vez de fallar la causación completa.
 */
export function construirPartidasCausacion(
  grupos: readonly GrupoConceptoCausacion[],
  conceptos: ReadonlyMap<string, FilaConceptoCuentas>,
  agregados: readonly RetencionAgregada[],
  idPorAgregado: ReadonlyMap<string, string | null>,
  thirdPartyId: string,
): { partidas: PartidaBorrador[]; contrapartidaAmbigua: boolean; motivos: MotivoLocal[] } {
  const partidas: PartidaBorrador[] = [];
  const motivos: MotivoLocal[] = [];
  let contrapartidaId: string | null = null;
  let contrapartidaAmbigua = false;
  let totalBaseMasIva = 0;

  for (const g of grupos) {
    const c = conceptos.get(g.conceptoId);
    if (!c) {
      motivos.push({
        codigo: 'concepto_inexistente_al_causar',
        detalle: `El concepto ${g.conceptoId} se resolvió en memoria pero no se encontró al construir el asiento.`,
      });
      continue;
    }
    if (!c.cuenta_gasto_id || !c.cuenta_contrapartida_id || (g.valorIva > 0 && !c.cuenta_iva_descontable_id)) {
      motivos.push({
        codigo: 'concepto_sin_cuentas_completas',
        detalle: `El concepto ${g.conceptoId} no tiene todas las cuentas PUC que necesita para causar (gasto, contrapartida${g.valorIva > 0 ? ' e IVA descontable' : ''}).`,
      });
      continue;
    }

    if (g.baseGravable > 0) {
      partidas.push({ accountId: c.cuenta_gasto_id, side: 'debito', monto: g.baseGravable, thirdPartyId });
      totalBaseMasIva += g.baseGravable;
    }
    if (g.valorIva > 0 && c.cuenta_iva_descontable_id) {
      partidas.push({ accountId: c.cuenta_iva_descontable_id, side: 'debito', monto: g.valorIva, thirdPartyId });
      totalBaseMasIva += g.valorIva;
    }

    if (contrapartidaId === null) {
      contrapartidaId = c.cuenta_contrapartida_id;
    } else if (contrapartidaId !== c.cuenta_contrapartida_id) {
      contrapartidaAmbigua = true;
    }
  }

  if (motivos.length > 0) {
    return { partidas: [], contrapartidaAmbigua, motivos };
  }

  let totalRetenciones = 0;
  for (const a of agregados) {
    partidas.push({
      accountId: a.accountId,
      side: 'credito',
      monto: a.valor,
      thirdPartyId,
      baseGravable: a.base,
      retentionAppliedId: idPorAgregado.get(`${a.tipo}|${a.regla.taxRuleId}|${a.accountId}`) ?? null,
    });
    totalRetenciones += a.valor;
  }

  const netoAPagar = totalBaseMasIva - totalRetenciones;
  if (contrapartidaId === null) {
    motivos.push({
      codigo: 'sin_cuenta_contrapartida',
      detalle: 'Ningún concepto de la factura declara cuenta de contrapartida (proveedores).',
    });
    return { partidas: [], contrapartidaAmbigua, motivos };
  }
  if (netoAPagar <= 0) {
    motivos.push({
      codigo: 'neto_a_pagar_no_positivo',
      detalle: `El neto a pagar calculado es ${netoAPagar} centavos; las retenciones agregadas no pueden ser mayores o iguales que el bruto más IVA.`,
    });
    return { partidas: [], contrapartidaAmbigua, motivos };
  }

  partidas.push({ accountId: contrapartidaId, side: 'credito', monto: netoAPagar, thirdPartyId });

  return { partidas, contrapartidaAmbigua, motivos: [] };
}

/** Inserta el asiento borrador y sus partidas. No lo publica: eso exige aprobación humana (`aprobarAsiento`). */
async function insertarAsientoBorrador(
  tx: SqlClient,
  ctx: { tenantId: string; companyId: string; fiscalPeriodId: string; sourceDocumentId: string; approvalId: string; descripcion: string; idempotencyKey: string; tipo?: string; reversesEntryId?: string | null },
  partidas: readonly PartidaBorrador[],
): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO journal_entry (
       tenant_id, company_id, fiscal_period_id, tipo, fecha_hecho_economico, descripcion,
       estado, source_document_id, approval_id, reverses_entry_id, idempotency_key)
     SELECT $1, $2, $3, $4, sd.fecha_hecho_economico, $5, 'draft', $6, $7, $8, $9
       FROM source_document sd WHERE sd.id = $6
     RETURNING id`,
    [
      ctx.tenantId,
      ctx.companyId,
      ctx.fiscalPeriodId,
      ctx.tipo ?? 'causacion',
      ctx.descripcion,
      ctx.sourceDocumentId,
      ctx.approvalId,
      ctx.reversesEntryId ?? null,
      ctx.idempotencyKey,
    ],
  );
  const entryId = rows[0]!.id;

  let linea = 0;
  for (const p of partidas) {
    linea += 1;
    await tx.query(
      `INSERT INTO journal_line (
         tenant_id, company_id, journal_entry_id, linea, account_id, side, monto,
         third_party_id, base_gravable, retention_applied_id, descripcion)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        ctx.tenantId,
        ctx.companyId,
        entryId,
        linea,
        p.accountId,
        p.side,
        p.monto,
        p.thirdPartyId ?? null,
        p.baseGravable ?? null,
        p.retentionAppliedId ?? null,
        p.descripcion ?? null,
      ],
    );
  }

  return entryId;
}

/** approval placeholder EXCLUSIVO del flujo automático de causación: no es la aprobación humana. */
async function crearApprovalPlaceholder(
  tx: SqlClient,
  ctx: { tenantId: string; companyId: string; sourceDocumentId: string },
): Promise<string> {
  // La causación automática deja el asiento en 'draft'. `journal_entry.approval_id`
  // es NOT NULL desde el INSERT (sección 15), pero publicar exige decision =
  // 'aprobado' (LG006): este placeholder queda en 'devuelto' — nunca alcanza
  // por sí mismo a publicar nada — hasta que `aprobarAsiento` INSERTE la
  // aprobación humana real y la use para publicar. No se reutiliza esta fila
  // para aprobar: `aprobarAsiento` siempre crea una fila nueva (Regla de Oro 6:
  // la aprobación queda con su propio usuario, IP y timestamp).
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO approval (tenant_id, company_id, entidad, entidad_id, source_document_id, decision, user_id, ip, motivo)
     SELECT $1, $2, 'source_document', $3, $3, 'devuelto', u.id, '127.0.0.1', 'Causación automática: pendiente de aprobación humana.'
       FROM "user" u WHERE u.tenant_id = $1 ORDER BY u.created_at LIMIT 1
     RETURNING id`,
    [ctx.tenantId, ctx.companyId, ctx.sourceDocumentId],
  );
  if (!rows[0]) {
    throw new Error(
      `No se encontró ningún usuario de la firma ${ctx.tenantId} para dejar la traza del ` +
        'borrador automático (approval placeholder). Cree al menos un usuario en la firma antes de causar.',
    );
  }
  return rows[0].id;
}

// =============================================================================
// EL WORKER DE LA COLA
// =============================================================================

/**
 * Procesa el trabajo de causación de un documento. SIEMPRE en contexto de
 * administración (worker): nunca se invoca para servir una petición de
 * usuario. Es idempotente por el `estado` de `source_document`: si ya pasó de
 * `parseado`, no se vuelve a resolver nada (caso dorado 18).
 */
export async function procesarJobCausacion(
  tx: SqlClient,
  job: Pick<DocumentProcessingJob, 'id' | 'sourceDocumentId'>,
): Promise<ResultadoProcesamiento> {
  const { rows } = await tx.query<FilaSourceDocument>(
    `SELECT id, tenant_id, company_id, tipo_documento, cufe, third_party_id,
            fecha_hecho_economico::text, estado, total_bruto::text, total_descuentos::text,
            total_iva::text, total_neto::text, documento_referenciado_id
       FROM source_document WHERE id = $1`,
    [job.sourceDocumentId],
  );
  const doc = rows[0];
  if (!doc) throw new Error(`source_document ${job.sourceDocumentId} no existe.`);

  // Idempotencia (caso dorado 18): un documento que ya avanzó más allá de
  // "parseado" no se vuelve a resolver. Reprocesar 10 veces produce el mismo
  // asiento porque, a partir de la segunda vez, ni siquiera se intenta.
  //
  // 'rechazado' NO está en la lista a propósito (V-23): el motor nunca recausa
  // una rechazada por su cuenta. El único camino de vuelta es el gate auditado
  // `app.reintegrar_documento_rechazado`, que exige `documento.reprocesar`,
  // comprueba que el asiento en conflicto quedó anulado y deja rastro en
  // `audit_log` (quién, cuándo, desde qué estado) ANTES de devolver el
  // documento a 'parseado'.
  if (!['recibido', 'parseado'].includes(doc.estado)) {
    const { rows: entryRows } = await tx.query<{ id: string }>(
      `SELECT id FROM journal_entry WHERE source_document_id = $1 AND tipo <> 'reversa' LIMIT 1`,
      [doc.id],
    );
    await completarJob(tx, job.id, { yaProcesado: true, estadoDocumento: doc.estado });
    return { estado: 'ya_procesado', journalEntryId: entryRows[0]?.id ?? null };
  }

  if (doc.tipo_documento === 'CreditNote' || doc.tipo_documento === 'DebitNote') {
    if (doc.documento_referenciado_id) {
      return causarNotaCredito(tx, doc, job.id);
    }
    // Nota/débito sin referencia resoluble: no hay documento original que
    // reversar. Va a revisión manual explícita en vez de tratarse como
    // factura normal.
    const motivos: MotivoLocal[] = [
      {
        codigo: 'nota_sin_documento_referenciado',
        detalle: `${doc.tipo_documento} ${doc.id} no referencia (o no se pudo resolver por CUFE) el documento original.`,
      },
    ];
    await completarJob(tx, job.id, { requiereRevisionManual: true, motivos });
    return { estado: 'revision_manual', motivos };
  }

  return causarFactura(tx, doc, job.id);
}

async function causarFactura(
  tx: SqlClient,
  doc: FilaSourceDocument,
  jobId: string,
): Promise<ResultadoProcesamiento> {
  const motivos: MotivoLocal[] = [];

  if (!doc.third_party_id) {
    motivos.push({
      codigo: 'tercero_no_registrado',
      detalle: `El emisor del documento ${doc.id} no está registrado como tercero de la empresa; no se puede resolver retenciones sin sus atributos fiscales.`,
    });
    await completarJob(tx, jobId, { requiereRevisionManual: true, motivos });
    return { estado: 'revision_manual', motivos };
  }

  const { rows: extraccionRows } = await tx.query<{ datos_extraidos: unknown }>(
    // `origen = 'parser_ubl'` es obligatorio, no cosmético: desde la Ola 2, A5
    // deja también filas de `extraction` con la traza de cada propuesta de IA
    // (score, prompt, tokens, costo). Esas filas NO llevan las líneas del
    // documento, así que «la última extracción» ya no es la del parser y sin
    // este filtro la causación se quedaría sin líneas que causar.
    `SELECT datos_extraidos FROM extraction
      WHERE source_document_id = $1 AND origen = 'parser_ubl'
      ORDER BY created_at DESC LIMIT 1`,
    [doc.id],
  );
  const crudo = extraccionRows[0] && jsonComoObjeto(extraccionRows[0].datos_extraidos);
  const datos: DatosExtraidos | null = crudo ? proyectarLineasParaCausacion(crudo) : null;
  if (!datos) {
    motivos.push({
      codigo: 'sin_extraccion',
      detalle: `El documento ${doc.id} no tiene ninguna fila de extraction que describa sus líneas.`,
    });
    await completarJob(tx, jobId, { requiereRevisionManual: true, motivos });
    return { estado: 'revision_manual', motivos };
  }

  // Clasificación (frontera con A5, Ola 2): solo se usa lo YA confirmado en
  // memoria. Regla de Oro 4 — A6 no clasifica, no llama ningún LLM. Si falta
  // una línea, TODO el documento espera: causar parcialmente dejaría un
  // asiento que nadie pidió aprobar a medias.
  const conceptoPorLinea = new Map<number, string>();
  const lineasSinClasificar: number[] = [];
  for (const l of datos.lineas) {
    const conceptoId = await buscarConceptoEnMemoria(tx, doc.company_id, doc.third_party_id, l.descripcion);
    if (conceptoId) conceptoPorLinea.set(l.numero, conceptoId);
    else lineasSinClasificar.push(l.numero);
  }
  if (lineasSinClasificar.length > 0) {
    motivos.push({
      codigo: 'sin_clasificacion_automatica',
      detalle: `${lineasSinClasificar.length} línea(s) sin concepto confirmado en memoria_clasificacion (líneas ${lineasSinClasificar.join(', ')}). Pendiente de clasificación manual o de A5 (Ola 2).`,
    });
    await completarJob(tx, jobId, { requiereRevisionManual: true, motivos });
    return { estado: 'revision_manual', motivos };
  }

  const { rows: terceroRows } = await tx.query<{ municipality_id: string | null }>(
    `SELECT municipality_id FROM third_party WHERE id = $1`,
    [doc.third_party_id],
  );
  // V-8 (Ola 1, cerrada por A7 en la Ola 2): el municipio de la operación NO
  // es el del tercero por defecto cuando un humano lo corrigió explícitamente
  // en la bandeja de revisión (sección 7.5: el ICA depende de dónde se prestó
  // el servicio, no del domicilio del proveedor). Sin corrección, se sigue
  // usando el del tercero — declarado y probado, no silenciado (V-8).
  const correcciones = await obtenerCorreccionesVigentes(tx, doc.id);
  const municipioOperacionId = correcciones.municipioOperacionId ?? terceroRows[0]?.municipality_id ?? null;

  const grupos = agruparLineasPorConcepto(datos.lineas, conceptoPorLinea, correcciones.aiuPorLinea);
  const lineasFactura: LineaFactura[] = grupos.map((g) => ({
    conceptoId: g.conceptoId,
    baseGravable: g.baseGravable,
    valorIva: g.valorIva,
    valorAiu: g.valorAiu,
  }));

  const entradaFactura: EntradaFactura = {
    companyId: doc.company_id,
    terceroId: doc.third_party_id,
    municipioOperacionId,
    fechaHechoEconomico: doc.fecha_hecho_economico,
    lineas: lineasFactura,
    // D-088: la clave anti doble conteo del acumulador de base mínima de ICA
    // por periodo. Sin ella, recausar el documento lo sumaría otra vez.
    sourceDocumentId: doc.id,
  };

  const repo = new RepositorioTributarioSql(tx);
  const resultado: ResultadoResolucion = await resolverFactura(repo, entradaFactura);

  if (resultado.requiereRevisionManual) {
    const motivosResolucion = resultado.motivosRevision.map((m) => ({ codigo: m.codigo, detalle: m.detalle }));
    await completarJob(tx, jobId, {
      requiereRevisionManual: true,
      motivos: motivosResolucion,
      huella: resultado.huella,
    });
    return { estado: 'revision_manual', motivos: motivosResolucion };
  }

  // SAVEPOINT antes de escribir NADA del resultado (corrección de A14 al cerrar
  // la Ola 1, D-043). Cubre la traza de retenciones, el placeholder de
  // aprobación y el asiento: si otro worker gana la carrera, se deshace todo
  // lo que este intento alcanzó a escribir y no quedan filas huérfanas de
  // `retention_applied` sin asiento.
  //
  // Antes de esta corrección la violación de `journal_entry_idem_uq` abortaba
  // la transacción entera y el `catch` de más abajo —que consulta y completa el
  // trabajo— moría con 25P02 «current transaction is aborted»: la rama de
  // carrera era código muerto. El invariante «un solo asiento por documento»
  // nunca estuvo en riesgo (lo impone el UNIQUE); el manejo elegante sí.
  await tx.exec('SAVEPOINT causacion_asiento');

  const idsRetencion = await persistirRetenciones(
    tx,
    { tenantId: doc.tenant_id, companyId: doc.company_id, sourceDocumentId: doc.id, journalEntryId: null },
    resultado,
  );

  // Mapa (tipo|regla|cuenta) -> id de retention_applied, SOLO cuando hay
  // exactamente una fila evaluada detrás del agregado: si dos grupos de
  // concepto produjeron la misma regla, el agregado las suma y la partida del
  // asiento queda sin FK directa a una fila (la traza sigue disponible por
  // journal_entry_id + tipo en retention_applied).
  const idsPorClave = new Map<string, string[]>();
  resultado.retenciones.forEach((r: RetencionResuelta, i: number) => {
    if (!r.aplicada || r.valor === 0) return;
    const clave = `${r.tipo}|${r.regla.taxRuleId}|${r.accountId}`;
    const lista = idsPorClave.get(clave) ?? [];
    lista.push(idsRetencion[i]!);
    idsPorClave.set(clave, lista);
  });
  const idPorAgregado = new Map<string, string | null>(
    [...idsPorClave.entries()].map(([clave, ids]) => [clave, ids.length === 1 ? ids[0]! : null]),
  );

  const conceptoIds = [...new Set(grupos.map((g) => g.conceptoId))];
  const { rows: conceptoRows } = await tx.query<FilaConceptoCuentas>(
    `SELECT id, cuenta_gasto_id, cuenta_iva_descontable_id, cuenta_contrapartida_id
       FROM concepto_causacion WHERE id = ANY($1::uuid[])`,
    [conceptoIds],
  );
  const conceptos = new Map(conceptoRows.map((c) => [c.id, c]));

  const { partidas, contrapartidaAmbigua, motivos: motivosPartidas } = construirPartidasCausacion(
    grupos,
    conceptos,
    resultado.agregados,
    idPorAgregado,
    doc.third_party_id,
  );

  // Las dos salidas a revisión manual que quedan DESPUÉS del SAVEPOINT tienen
  // que deshacer lo ya escrito (A14, V-29). Sin el ROLLBACK, un documento que
  // acaba en revisión manual por falta de período abierto o por una cuenta sin
  // configurar dejaba sus filas de `retention_applied` (con `aplicada = true`)
  // escritas y con `journal_entry_id = NULL`: traza huérfana que NINGÚN asiento
  // respalda, y que la reportería tributaria —certificado de retenciones y
  // exógena leen `retention_applied`, no el ledger— no puede distinguir de una
  // retención realmente practicada.
  if (motivosPartidas.length > 0) {
    await tx.exec('ROLLBACK TO SAVEPOINT causacion_asiento');
    await completarJob(tx, jobId, { requiereRevisionManual: true, motivos: motivosPartidas });
    return { estado: 'revision_manual', motivos: motivosPartidas };
  }

  const fiscalPeriodId = await abrirPeriodoFiscal(tx, doc.company_id, doc.fecha_hecho_economico);
  if (!fiscalPeriodId) {
    await tx.exec('ROLLBACK TO SAVEPOINT causacion_asiento');
    const m = [
      {
        codigo: 'sin_periodo_fiscal_abierto',
        detalle: `No hay un período fiscal abierto que cubra ${doc.fecha_hecho_economico} en la empresa ${doc.company_id}.`,
      },
    ];
    await completarJob(tx, jobId, { requiereRevisionManual: true, motivos: m });
    return { estado: 'revision_manual', motivos: m };
  }

  const approvalId = await crearApprovalPlaceholder(tx, {
    tenantId: doc.tenant_id,
    companyId: doc.company_id,
    sourceDocumentId: doc.id,
  });

  // V-23: clave versionada si el documento ya dejó asientos de causación atrás
  // (una rechazada que se reintegró). El primer intento sigue siendo
  // `causacion:<doc>`.
  const idempotencyKey = await idempotencyKeyCausacion(tx, doc.company_id, doc.id);

  let journalEntryId: string;
  try {
    journalEntryId = await insertarAsientoBorrador(
      tx,
      {
        tenantId: doc.tenant_id,
        companyId: doc.company_id,
        fiscalPeriodId,
        sourceDocumentId: doc.id,
        approvalId,
        descripcion: `Causación automática — documento ${doc.cufe ?? doc.id}`,
        idempotencyKey,
      },
      partidas,
    );
    await tx.exec('RELEASE SAVEPOINT causacion_asiento');
  } catch (error) {
    await tx.exec('ROLLBACK TO SAVEPOINT causacion_asiento');
    // Carrera: otro worker ya causó este documento entre el chequeo de estado
    // de arriba y este INSERT. La atrapa `journal_entry_idem_uq` (misma clave).
    // Se devuelve el asiento de causación VIVO del documento.
    if (isPostgresError(error) && error.code === SQLSTATE.UNIQUE_VIOLATION) {
      const { rows: existente } = await tx.query<{ id: string }>(
        `SELECT id FROM journal_entry
          WHERE company_id = $1 AND source_document_id = $2
            AND tipo <> 'reversa' AND estado <> 'anulado'
          ORDER BY created_at DESC LIMIT 1`,
        [doc.company_id, doc.id],
      );
      await completarJob(tx, jobId, { yaProcesado: true, carreraDetectada: true });
      return { estado: 'ya_procesado', journalEntryId: existente[0]?.id ?? null };
    }
    throw error;
  }

  await tx.query(
    `UPDATE retention_applied SET journal_entry_id = $1 WHERE id = ANY($2::uuid[])`,
    [journalEntryId, idsRetencion],
  );
  await tx.query(`UPDATE source_document SET estado = 'pendiente_aprobacion' WHERE id = $1`, [doc.id]);

  // D-088. El acumulador de base mínima de ICA por periodo se mueve AQUÍ y no
  // antes: el asiento ya está escrito y la transacción es la misma. Todas las
  // salidas anteriores —revisión manual, período cerrado, carrera con otro
  // worker— pasan sin tocarlo, así que el acumulado nunca va por delante del
  // ledger que debería respaldarlo. En medición por factura la lista va vacía.
  await aplicarAcumuladosIca(
    tx,
    { tenantId: doc.tenant_id, companyId: doc.company_id },
    resultado.acumuladosIca,
  );

  await completarJob(tx, jobId, {
    journalEntryId,
    huella: resultado.huella,
    contrapartidaAmbigua,
  });

  return { estado: 'causado', journalEntryId, huella: resultado.huella };
}

// =============================================================================
// NOTA CRÉDITO — reversa proporcional (caso dorado 15)
// =============================================================================

async function causarNotaCredito(
  tx: SqlClient,
  nota: FilaSourceDocument,
  jobId: string,
): Promise<ResultadoProcesamiento> {
  const original = nota.documento_referenciado_id!;
  const { rows: origRows } = await tx.query<FilaSourceDocument>(
    `SELECT id, tenant_id, company_id, tipo_documento, cufe, third_party_id,
            fecha_hecho_economico::text, estado, total_bruto::text, total_descuentos::text,
            total_iva::text, total_neto::text, documento_referenciado_id
       FROM source_document WHERE id = $1`,
    [original],
  );
  const orig = origRows[0];
  const motivos: MotivoLocal[] = [];
  if (!orig || orig.estado !== 'causado') {
    motivos.push({
      codigo: 'documento_original_no_causado',
      detalle: `El documento referenciado ${original} no existe o no está en estado 'causado' todavía; no hay retenciones que reversar.`,
    });
    await completarJob(tx, jobId, { requiereRevisionManual: true, motivos });
    return { estado: 'revision_manual', motivos };
  }

  const { rows: entryRows } = await tx.query<{ id: string }>(
    `SELECT id FROM journal_entry WHERE source_document_id = $1 AND estado = 'posted' AND tipo <> 'reversa' LIMIT 1`,
    [orig.id],
  );
  const entryOriginal = entryRows[0];
  if (!entryOriginal) {
    motivos.push({
      codigo: 'asiento_original_no_publicado',
      detalle: `El documento ${orig.id} no tiene un asiento publicado del que partir la reversa.`,
    });
    await completarJob(tx, jobId, { requiereRevisionManual: true, motivos });
    return { estado: 'revision_manual', motivos };
  }

  const baseOriginal = Number(orig.total_bruto ?? Number(orig.total_neto ?? '0') - Number(orig.total_iva ?? '0'));
  const baseNota = Number(nota.total_bruto ?? Number(nota.total_neto ?? '0') - Number(nota.total_iva ?? '0'));
  const ivaOriginal = orig.total_iva === null ? null : Number(orig.total_iva);
  const ivaNota = nota.total_iva === null ? null : Number(nota.total_iva);

  const reversa = await resolverReversaNotaCredito(tx, {
    documentoOriginalId: orig.id,
    baseOriginal,
    baseNota,
    ivaOriginal,
    ivaNota,
  });

  if (reversa.motivos.length > 0) {
    const m = reversa.motivos.map((x) => ({ codigo: x.codigo, detalle: x.detalle }));
    await completarJob(tx, jobId, { requiereRevisionManual: true, motivos: m });
    return { estado: 'revision_manual', motivos: m };
  }

  // El período fiscal se comprueba ANTES de escribir nada (A14, V-28): con
  // el orden anterior, una nota fuera de todo período abierto ya había dejado
  // escritas sus filas de `retention_applied` con `journal_entry_id = NULL` —
  // traza huérfana que ningún asiento respalda y que la reportería tributaria
  // no puede distinguir de una retención real.
  const fiscalPeriodId = await abrirPeriodoFiscal(tx, nota.company_id, nota.fecha_hecho_economico);
  if (!fiscalPeriodId) {
    const m = [
      {
        codigo: 'sin_periodo_fiscal_abierto',
        detalle: `No hay un período fiscal abierto que cubra ${nota.fecha_hecho_economico}.`,
      },
    ];
    await completarJob(tx, jobId, { requiereRevisionManual: true, motivos: m });
    return { estado: 'revision_manual', motivos: m };
  }

  // SAVEPOINT antes de escribir NADA (misma corrección que `causarFactura`
  // recibió en D-043, y que a la nota crédito NUNCA se le aplicó — A14 lo
  // encontró en la compuerta ampliada de V-23, V-28). Sin él, cualquier
  // violación de unicidad al insertar el asiento (`journal_entry_idem_uq` en
  // una carrera, `journal_entry_reversa_viva_uq` si otro intento vivo ya
  // reversa el mismo original) abortaba la transacción ENTERA del worker: ni
  // se completaba el trabajo, ni se limpiaban las filas de
  // `retention_applied` ya escritas, y el job volvía a fallar en cada intento.
  await tx.exec('SAVEPOINT causacion_nota');

  const idsReversa = await persistirLista(
    tx,
    { tenantId: nota.tenant_id, companyId: nota.company_id, sourceDocumentId: nota.id, journalEntryId: null },
    reversa.reversas,
  );

  // Partidas originales del asiento que se está reversando, para invertirlas
  // (débito<->crédito) y, si la nota es parcial, prorratearlas en la misma
  // proporción base_nota/base_original que usó A3 para las retenciones. El
  // multiplo=1 (redondeo al centavo) es aritmética de reparto, no una regla
  // tributaria: no decide ninguna tarifa ni base.
  const { rows: lineasOriginales } = await tx.query<{
    account_id: string;
    side: 'debito' | 'credito';
    monto: string;
    third_party_id: string | null;
    base_gravable: string | null;
    retention_applied_id: string | null;
  }>(
    `SELECT account_id, side, monto::text, third_party_id, base_gravable::text, retention_applied_id
       FROM journal_line WHERE journal_entry_id = $1 AND retention_applied_id IS NULL
      ORDER BY linea`,
    [entryOriginal.id],
  );

  const total = reversa.total;
  const partidas: PartidaBorrador[] = [];
  for (const l of lineasOriginales) {
    const montoOriginal = BigInt(l.monto);
    const montoReversa = total
      ? montoOriginal
      : proporcion(montoOriginal, BigInt(Math.round(baseNota)), BigInt(Math.round(baseOriginal)), 1n, 'half_up');
    if (montoReversa <= 0n) continue;
    partidas.push({
      accountId: l.account_id,
      side: l.side === 'debito' ? 'credito' : 'debito', // se invierte: es una reversa
      monto: Number(montoReversa),
      thirdPartyId: l.third_party_id,
    });
  }

  const idsPorClave = new Map<string, string[]>();
  reversa.reversas.forEach((r, i) => {
    const clave = `${r.tipo}|${r.regla.taxRuleId}|${r.accountId}`;
    const lista = idsPorClave.get(clave) ?? [];
    lista.push(idsReversa[i]!);
    idsPorClave.set(clave, lista);
  });
  for (const r of agregar(reversa.reversas)) {
    const clave = `${r.tipo}|${r.regla.taxRuleId}|${r.accountId}`;
    const ids = idsPorClave.get(clave) ?? [];
    partidas.push({
      accountId: r.accountId,
      side: 'debito', // se reversa un crédito de retención con un débito
      monto: r.valor,
      thirdPartyId: nota.third_party_id,
      baseGravable: r.base,
      retentionAppliedId: ids.length === 1 ? ids[0]! : null,
    });
  }

  const approvalId = await crearApprovalPlaceholder(tx, {
    tenantId: nota.tenant_id,
    companyId: nota.company_id,
    sourceDocumentId: nota.id,
  });

  let journalEntryId: string;
  try {
    journalEntryId = await insertarAsientoBorrador(
      tx,
      {
        tenantId: nota.tenant_id,
        companyId: nota.company_id,
        fiscalPeriodId,
        sourceDocumentId: nota.id,
        approvalId,
        descripcion: `Reversa ${total ? 'total' : 'proporcional'} por nota — documento ${nota.cufe ?? nota.id}`,
        // V-23: versionada si la nota ya se causó, se rechazó y se reintegró.
        idempotencyKey: await idempotencyKeyCausacion(tx, nota.company_id, nota.id),
        tipo: 'reversa',
        reversesEntryId: entryOriginal.id,
      },
      partidas,
    );
    await tx.exec('RELEASE SAVEPOINT causacion_nota');
  } catch (error) {
    await tx.exec('ROLLBACK TO SAVEPOINT causacion_nota');
    // Misma semántica que en `causarFactura`: si otro intento ya dejó un
    // asiento VIVO para esta nota (misma clave de idempotencia) o una reversa
    // viva sobre el mismo asiento original, esto es una carrera, no un error
    // del documento. Se devuelve el asiento vivo y el trabajo se cierra.
    if (isPostgresError(error) && error.code === SQLSTATE.UNIQUE_VIOLATION) {
      const { rows: existente } = await tx.query<{ id: string }>(
        `SELECT id FROM journal_entry
          WHERE company_id = $1 AND source_document_id = $2 AND estado <> 'anulado'
          ORDER BY created_at DESC LIMIT 1`,
        [nota.company_id, nota.id],
      );
      await completarJob(tx, jobId, { yaProcesado: true, carreraDetectada: true });
      return { estado: 'ya_procesado', journalEntryId: existente[0]?.id ?? null };
    }
    throw error;
  }

  await tx.query(`UPDATE retention_applied SET journal_entry_id = $1 WHERE id = ANY($2::uuid[])`, [
    journalEntryId,
    idsReversa,
  ]);
  await tx.query(`UPDATE source_document SET estado = 'pendiente_aprobacion' WHERE id = $1`, [nota.id]);

  await completarJob(tx, jobId, { journalEntryId, total });
  return { estado: 'causado', journalEntryId, huella: '' };
}

// =============================================================================
// APROBACIÓN (entregable 2): decisión humana, publica si aprueba.
// =============================================================================

export interface AprobarAsientoInput {
  journalEntryId: string;
  decision: 'aprobado' | 'rechazado' | 'devuelto';
  userId: string;
  ip?: string | null;
  userAgent?: string | null;
  motivo?: string | null;
  /** Para agrupar N aprobaciones de un mismo clic (aprobación en lote). */
  loteId?: string | null;
}

export interface ResultadoAprobacion {
  approvalId: string;
  journalEntryId: string;
  decision: 'aprobado' | 'rechazado' | 'devuelto';
  publicado: boolean;
}

/**
 * Aprueba (o rechaza) un asiento borrador. Si `decision = 'aprobado'`,
 * publica de inmediato con `app.publicar_asiento` (D-009: publicar es una
 * transición, no un INSERT). Si `decision = 'rechazado'`, anula el borrador
 * — nunca toca un asiento ya publicado (Regla de Oro 1: eso solo se corrige
 * con `reversarAsientoPublicado`, y la base lo impone con LG001 si se
 * intenta lo contrario).
 */
export async function aprobarAsiento(
  tx: SqlClient,
  input: AprobarAsientoInput,
): Promise<ResultadoAprobacion> {
  await exigirPermiso(tx, PERMISOS.CAUSACION_APROBAR);

  const { rows: entryRows } = await tx.query<{
    source_document_id: string;
    estado: string;
    tipo: string;
    reversa_de_documento: string | null;
  }>(
    `SELECT je.source_document_id, je.estado, je.tipo, original.source_document_id AS reversa_de_documento
       FROM journal_entry je
       LEFT JOIN journal_entry original ON original.id = je.reverses_entry_id
      WHERE je.id = $1`,
    [input.journalEntryId],
  );
  const entry = entryRows[0];
  if (!entry) throw new Error(`journal_entry ${input.journalEntryId} no existe en el contexto actual.`);

  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO approval (tenant_id, company_id, entidad, entidad_id, source_document_id,
                           decision, user_id, ip, user_agent, motivo, lote_id)
     VALUES (app.current_tenant_id(), app.current_company_id(), 'journal_entry', $1, $2,
             $3, $4, COALESCE($5::inet, app.current_ip()), $6, $7, $8)
     RETURNING id`,
    [
      input.journalEntryId,
      entry.source_document_id,
      input.decision,
      input.userId,
      input.ip ?? null,
      input.userAgent ?? null,
      input.motivo ?? null,
      input.loteId ?? null,
    ],
  );
  const approvalId = rows[0]!.id;

  if (input.decision !== 'aprobado') {
    // Un borrador rechazado se anula; el trigger de inmutabilidad rechaza
    // esta misma transición (LG001) si el asiento ya estaba publicado, que es
    // exactamente el comportamiento que se quiere: fallar limpio.
    await tx.query(`UPDATE journal_entry SET estado = 'anulado' WHERE id = $1`, [input.journalEntryId]);
    await tx.query(`UPDATE source_document SET estado = 'rechazado', motivo_rechazo = $2 WHERE id = $1`, [
      entry.source_document_id,
      input.motivo ?? 'Causación rechazada en aprobación.',
    ]);
    return { approvalId, journalEntryId: input.journalEntryId, decision: input.decision, publicado: false };
  }

  await tx.query(
    `UPDATE journal_entry SET approval_id = $1 WHERE id = $2`,
    [approvalId, input.journalEntryId],
  );
  await tx.query('SELECT app.publicar_asiento($1, $2)', [input.journalEntryId, input.userId]);

  // Dos formas de reversa, dos estados distintos para SU PROPIO
  // source_document (Regla de Oro 1: el documento original nunca se toca):
  //  - reversa GENÉRICA (`reversarAsientoPublicado`): el asiento de reversa
  //    referencia el MISMO source_document que el asiento que reversa — ese
  //    documento queda 'anulado' contablemente.
  //  - reversa por NOTA CRÉDITO (`causarNotaCredito`): el asiento de reversa
  //    referencia el documento de la NOTA, distinto del de la factura
  //    original — la nota, como cualquier documento causado, queda 'causado'.
  const esReversaDelMismoDocumento =
    entry.tipo === 'reversa' && entry.reversa_de_documento === entry.source_document_id;
  const nuevoEstado = esReversaDelMismoDocumento ? 'anulado' : 'causado';
  await tx.query(`UPDATE source_document SET estado = $2 WHERE id = $1`, [
    entry.source_document_id,
    nuevoEstado,
  ]);

  return { approvalId, journalEntryId: input.journalEntryId, decision: 'aprobado', publicado: true };
}

export interface ItemLoteAprobacion {
  journalEntryId: string;
  decision: 'aprobado' | 'rechazado' | 'devuelto';
  motivo?: string | null;
}

export interface ResultadoLoteAprobacion {
  loteId: string;
  resultados: (ResultadoAprobacion | { journalEntryId: string; error: string })[];
}

/**
 * Aprobación en lote (sección 4, Ola 2 — "una firma aprueba 50 facturas de un
 * golpe"). CONTRATO PARA A7: un lote opera sobre las empresas accesibles
 * dentro de UNA MISMA sesión (`tx` ya trae su `companyId` fijado por
 * `withSessionContext`, D-021 — la empresa la autoriza la base, no un
 * parámetro). Si el usuario aprueba facturas de varias de sus 30-60 empresas
 * en un solo clic de UI, A7 agrupa por empresa y llama a este servicio una
 * vez por empresa (varias llamadas, cada una con su propio `tx`/sesión); esta
 * función NUNCA acepta un `companyId` por ítem, precisamente para no abrir la
 * puerta a que la sesión "elija" la empresa (D-020).
 *
 * Un fallo en un ítem NO aborta el lote completo: cada ítem se resuelve en su
 * propio intento y el resultado (éxito o error) queda en `resultados`, con el
 * mismo `loteId` en las aprobaciones que sí se crearon. Así 49 aprobaciones
 * buenas no se pierden porque la 50 tenía un asiento ya publicado.
 */
export async function aprobarAsientosEnLote(
  tx: SqlClient,
  input: { items: readonly ItemLoteAprobacion[]; userId: string; ip?: string | null; userAgent?: string | null },
): Promise<ResultadoLoteAprobacion> {
  await exigirPermiso(tx, PERMISOS.CAUSACION_APROBAR);

  const { randomUUID } = await import('node:crypto');
  const loteId = randomUUID();
  const resultados: ResultadoLoteAprobacion['resultados'] = [];

  for (const [indice, item] of input.items.entries()) {
    // SAVEPOINT POR ÍTEM (corrección de A14 al cerrar la Ola 2, D-050).
    //
    // Sin él, el `catch` de abajo era DECORATIVO: en cuanto un ítem provocaba
    // un error del motor —un asiento que otro contador ya publicó, un período
    // cerrado, una cuenta no imputable—, PostgreSQL abortaba la transacción
    // entera y TODOS los ítems siguientes morían con 25P02 «current
    // transaction is aborted». A14 lo midió sobre la bandeja real: en un lote
    // de dos, el primero fallaba por su propio motivo y el segundo —sano—
    // fallaba por contagio. Con 50 filas de 30 empresas, un solo renglón
    // rancio se llevaba por delante el trabajo de toda la pantalla, y el
    // contador solo veía un mensaje de error por fila sin saber cuáles se
    // aprobaron de verdad.
    //
    // Es exactamente el mismo hallazgo que D-043 en `causarFactura`, en el
    // otro extremo del flujo: aislar la escritura de cada unidad de trabajo
    // para que el fallo de una no contamine a las demás.
    const punto = `lote_aprobacion_${indice}`;
    await tx.exec(`SAVEPOINT ${punto}`);
    try {
      const r = await aprobarAsiento(tx, {
        journalEntryId: item.journalEntryId,
        decision: item.decision,
        userId: input.userId,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        motivo: item.motivo ?? null,
        loteId,
      });
      await tx.exec(`RELEASE SAVEPOINT ${punto}`);
      resultados.push(r);
    } catch (error) {
      await tx.exec(`ROLLBACK TO SAVEPOINT ${punto}`);
      await tx.exec(`RELEASE SAVEPOINT ${punto}`);
      resultados.push({
        journalEntryId: item.journalEntryId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { loteId, resultados };
}

// =============================================================================
// REVERSA GENÉRICA de un asiento publicado (Regla de Oro 1: toda corrección
// va por reversa). Crea un borrador que espera la misma aprobación humana.
// =============================================================================

export interface ReversarAsientoInput {
  journalEntryId: string;
  motivo: string;
}

/**
 * Crea el asiento de reversa de uno publicado: mismas partidas, lado
 * invertido. Si `journalEntryId` no está publicado, la base lo rechaza con
 * LG008 al intentar publicar la reversa (fallo limpio, no un `if` de este
 * archivo) — aquí se comprueba antes también, para un mensaje más claro.
 */
export async function reversarAsientoPublicado(
  tx: SqlClient,
  input: ReversarAsientoInput,
): Promise<{ journalEntryId: string }> {
  await exigirPermiso(tx, PERMISOS.CAUSACION_REVERSAR);

  const { rows: entryRows } = await tx.query<{
    id: string;
    tenant_id: string;
    company_id: string;
    fiscal_period_id: string;
    source_document_id: string;
    estado: string;
  }>(
    `SELECT id, tenant_id, company_id, fiscal_period_id, source_document_id, estado
       FROM journal_entry WHERE id = $1`,
    [input.journalEntryId],
  );
  const original = entryRows[0];
  if (!original) throw new Error(`journal_entry ${input.journalEntryId} no existe en el contexto actual.`);
  if (original.estado !== 'posted') {
    throw new Error(
      `El asiento ${input.journalEntryId} está en estado '${original.estado}'; solo se reversa lo publicado (LG008 lo confirmaría en la BD si se insistiera).`,
    );
  }

  const { rows: lineasRows } = await tx.query<{
    account_id: string;
    side: 'debito' | 'credito';
    monto: string;
    third_party_id: string | null;
    cost_center_id: string | null;
    base_gravable: string | null;
  }>(
    `SELECT account_id, side, monto::text, third_party_id, cost_center_id, base_gravable::text
       FROM journal_line WHERE journal_entry_id = $1 ORDER BY linea`,
    [input.journalEntryId],
  );

  const partidas: PartidaBorrador[] = lineasRows.map((l) => ({
    accountId: l.account_id,
    side: l.side === 'debito' ? 'credito' : 'debito',
    monto: Number(l.monto),
    thirdPartyId: l.third_party_id,
    baseGravable: l.base_gravable === null ? null : Number(l.base_gravable),
  }));

  const approvalId = await crearApprovalPlaceholder(tx, {
    tenantId: original.tenant_id,
    companyId: original.company_id,
    sourceDocumentId: original.source_document_id,
  });

  const journalEntryId = await insertarAsientoBorrador(
    tx,
    {
      tenantId: original.tenant_id,
      companyId: original.company_id,
      fiscalPeriodId: original.fiscal_period_id,
      sourceDocumentId: original.source_document_id,
      approvalId,
      descripcion: `Reversa de ${input.journalEntryId} — ${input.motivo}`,
      idempotencyKey: `reversa:${input.journalEntryId}`,
      tipo: 'reversa',
      reversesEntryId: input.journalEntryId,
    },
    partidas,
  );

  return { journalEntryId };
}

// =============================================================================
// EDICIÓN MANUAL DE UN ASIENTO BORRADOR (A7 · D-079).
//
// El motor entrega el asiento cuadrado. Un humano puede, ANTES de aprobarlo,
// reasignar la cuenta contable y/o el monto de una línea — pero:
//   · solo si el asiento sigue en 'draft' (uno publicado se corrige por
//     reversa, Regla de Oro 1);
//   · el asiento resultante tiene que cuadrar (débitos = créditos). La BD solo
//     valida el balance al publicar (trigger sobre 'posted'); aquí se impone
//     TAMBIÉN, para que un borrador descuadrado no se guarde ni saltándose la
//     interfaz;
//   · apartarse de lo que propuso el motor exige una justificación no vacía,
//     que queda en `audit_log` vía `app.registrar_edicion_asiento_borrador`
//     (Regla de Oro 6).
// =============================================================================

export interface EdicionLineaBorrador {
  journalLineId: string;
  /** Cuenta contable destino (código PUC del plan efectivo de la empresa). */
  cuentaCodigo: string;
  /** Monto en centavos, entero como texto (Regla de Oro 5: nunca float). */
  montoCentavos: string;
}

export interface EditarAsientoBorradorInput {
  journalEntryId: string;
  /** TODAS las líneas del asiento (una edición parcial no se acepta). */
  lineas: readonly EdicionLineaBorrador[];
  /** Obligatoria en cuanto haya al menos un cambio respecto del borrador. */
  justificacion: string;
}

export interface ResultadoEdicionBorrador {
  journalEntryId: string;
  lineasCambiadas: number;
}

export async function editarAsientoBorrador(
  tx: SqlClient,
  input: EditarAsientoBorradorInput,
): Promise<ResultadoEdicionBorrador> {
  await exigirPermiso(tx, PERMISOS.CAUSACION_EDITAR_BORRADOR);

  // `FOR UPDATE` (A14, compuerta de D-079): la edición y `aprobarAsiento`
  // compiten por la MISMA fila de `journal_entry`. Sin el bloqueo, la ventana
  // es real: esta transacción lee 'draft', otra publica y hace COMMIT, y el
  // `UPDATE journal_line` de aquí acaba mutando las partidas de un asiento YA
  // publicado — el trigger `journal_line_inmutable` leyó 'draft' al disparar y
  // el de balance no protesta porque la edición cuadra. Con el bloqueo, o bien
  // la aprobación espera a esta transacción, o bien esta relee 'posted' y
  // corta (Regla de Oro 1).
  const { rows: entryRows } = await tx.query<{ estado: string }>(
    `SELECT estado FROM journal_entry WHERE id = $1
      FOR UPDATE`,
    [input.journalEntryId],
  );
  const entry = entryRows[0];
  if (!entry) throw new Error(`El asiento ${input.journalEntryId} no existe en el contexto actual.`);
  if (entry.estado !== 'draft') {
    throw new Error(
      `El asiento ${input.journalEntryId} está en estado '${entry.estado}'; solo se edita un borrador. ` +
        'Un asiento publicado solo se corrige con una reversa (Regla de Oro 1).',
    );
  }

  const { rows: actuales } = await tx.query<{
    id: string;
    linea: number;
    account_id: string;
    cuenta_codigo: string;
    side: 'debito' | 'credito';
    monto: string;
    retention_applied_id: string | null;
  }>(
    `SELECT jl.id, jl.linea, jl.account_id, acc.codigo AS cuenta_codigo, jl.side, jl.monto::text,
            jl.retention_applied_id
       FROM journal_line jl JOIN account acc ON acc.id = jl.account_id
      WHERE jl.journal_entry_id = $1 ORDER BY jl.linea`,
    [input.journalEntryId],
  );
  if (actuales.length === 0) {
    throw new Error(`El asiento ${input.journalEntryId} no tiene partidas para editar.`);
  }
  const actualPorId = new Map(actuales.map((l) => [l.id, l]));

  if (input.lineas.length !== actuales.length) {
    throw new Error(
      `La edición trae ${input.lineas.length} línea(s) y el asiento tiene ${actuales.length}. ` +
        'Envíe todas las líneas del asiento.',
    );
  }

  const entrantePorId = new Map<string, EdicionLineaBorrador>();
  for (const l of input.lineas) {
    if (!actualPorId.has(l.journalLineId)) {
      throw new Error(`La línea ${l.journalLineId} no pertenece al asiento ${input.journalEntryId}.`);
    }
    if (entrantePorId.has(l.journalLineId)) {
      throw new Error(`La línea ${l.journalLineId} llega dos veces en la edición.`);
    }
    if (!/^\d+$/.test(l.montoCentavos) || BigInt(l.montoCentavos) <= 0n) {
      throw new Error(
        `El monto de la línea ${l.journalLineId} debe ser un entero de centavos mayor que cero (Regla de Oro 5).`,
      );
    }
    entrantePorId.set(l.journalLineId, l);
  }

  // Resolver los códigos de cuenta contra el PUC efectivo de la empresa, y
  // exigir que sean imputables (el ledger lo re-valida con LG004 al publicar).
  const codigos = [...new Set(input.lineas.map((l) => l.cuentaCodigo.trim()))];
  const { rows: cuentas } = await tx.query<{
    id: string;
    codigo: string;
    permite_movimiento: boolean;
    activo: boolean;
  }>(`SELECT id, codigo, permite_movimiento, activo FROM v_account_efectivo WHERE codigo = ANY($1)`, [codigos]);
  const cuentaPorCodigo = new Map(cuentas.map((c) => [c.codigo, c]));
  for (const codigo of codigos) {
    const c = cuentaPorCodigo.get(codigo);
    if (!c) {
      throw new Error(`No existe la cuenta PUC "${codigo}" en el plan de cuentas de esta empresa.`);
    }
    if (!c.permite_movimiento) {
      throw new Error(`La cuenta PUC "${codigo}" no es imputable: no acepta partidas (LG004).`);
    }
    // A14, compuerta de D-079: desactivar una cuenta (`activo = false`) es
    // justamente el mecanismo con el que una empresa la retira de su plan
    // (D-064). El selector de la interfaz ya no la ofrece; el servicio tampoco
    // puede aceptarla cuando el formulario llega a mano.
    if (!c.activo) {
      throw new Error(
        `La cuenta PUC "${codigo}" está desactivada en el plan de cuentas de esta empresa y no admite partidas.`,
      );
    }
  }

  // ¿Qué cambió?
  const cambios = actuales.filter((actual) => {
    const nueva = entrantePorId.get(actual.id)!;
    const cambioCuenta = nueva.cuentaCodigo.trim() !== actual.cuenta_codigo;
    const cambioMonto = BigInt(nueva.montoCentavos) !== BigInt(actual.monto);
    return cambioCuenta || cambioMonto;
  });

  if (cambios.length === 0) {
    return { journalEntryId: input.journalEntryId, lineasCambiadas: 0 };
  }

  // A14, compuerta de D-079: una partida que LLEVA una retención
  // (`retention_applied_id`) no se edita a mano. `retention_applied` guarda la
  // base, la tarifa, la regla y su vigencia con las que se produjo ese valor, y
  // es la fuente de los formatos de exógena y de los certificados de retención,
  // mientras el ledger es la fuente del pago o abono en cuenta. Cambiar el
  // monto o la cuenta de esa partida hace divergir para siempre las dos
  // fuentes, sin que ninguna de las dos diga que un humano se apartó del motor
  // — que es exactamente lo que prohíben las Reglas de Oro 4 y 6. La
  // retención se corrige donde se calcula: parámetro/concepto y reproceso, o
  // rechazo y nueva causación.
  const retencionTocada = cambios.find((c) => c.retention_applied_id !== null);
  if (retencionTocada) {
    throw new Error(
      `La línea ${retencionTocada.linea} (cuenta ${retencionTocada.cuenta_codigo}) es una retención calculada por ` +
        'el motor y no se edita a mano: su base, tarifa, regla y vigencia quedaron registradas y alimentan la ' +
        'exógena y los certificados. Corrija el concepto o el parámetro y reprocese el documento, o rechace la ' +
        'causación y vuelva a causarla.',
    );
  }

  if (!input.justificacion || input.justificacion.trim() === '') {
    throw new Error(
      'Editar una línea del asiento propuesto exige una justificación (Regla de Oro 6): ' +
        'qué se cambió respecto de lo que propuso el motor y por qué.',
    );
  }

  // El asiento resultante tiene que cuadrar (el `side` de cada línea no cambia).
  let saldo = 0n;
  for (const actual of actuales) {
    const monto = BigInt(entrantePorId.get(actual.id)!.montoCentavos);
    saldo += actual.side === 'debito' ? monto : -monto;
  }
  if (saldo !== 0n) {
    throw new Error(
      `El asiento editado descuadra en ${saldo} centavos (débitos menos créditos). ` +
        'Ajuste los montos hasta que débitos y créditos sean iguales antes de guardar.',
    );
  }

  const instantanea = (
    filas: { linea: number; cuenta_codigo: string; account_id: string; side: string; monto: string }[],
  ) =>
    filas.map((l) => ({
      linea: l.linea,
      cuenta: l.cuenta_codigo,
      cuentaId: l.account_id,
      side: l.side,
      montoCentavos: l.monto,
    }));
  const antes = instantanea(actuales);

  for (const c of cambios) {
    const nueva = entrantePorId.get(c.id)!;
    await tx.query(
      `UPDATE journal_line SET account_id = $1, monto = $2
        WHERE id = $3 AND journal_entry_id = $4`,
      [cuentaPorCodigo.get(nueva.cuentaCodigo.trim())!.id, nueva.montoCentavos, c.id, input.journalEntryId],
    );
  }

  const { rows: despuesRows } = await tx.query<{
    linea: number;
    cuenta_codigo: string;
    account_id: string;
    side: string;
    monto: string;
  }>(
    `SELECT jl.linea, acc.codigo AS cuenta_codigo, jl.account_id, jl.side, jl.monto::text
       FROM journal_line jl JOIN account acc ON acc.id = jl.account_id
      WHERE jl.journal_entry_id = $1 ORDER BY jl.linea`,
    [input.journalEntryId],
  );

  await tx.query(
    `SELECT app.registrar_edicion_asiento_borrador($1, $2::jsonb, $3::jsonb, $4)`,
    [
      input.journalEntryId,
      JSON.stringify(antes),
      JSON.stringify(instantanea(despuesRows)),
      input.justificacion.trim(),
    ],
  );

  return { journalEntryId: input.journalEntryId, lineasCambiadas: cambios.length };
}

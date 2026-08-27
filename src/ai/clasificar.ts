/**
 * A5 — EL FLUJO DE LA SECCIÓN 8.3, COMPLETO.
 *
 *   1. Llega una factura. Se normaliza la descripción.
 *   2. Consulta a memoria. Si hay coincidencia -> concepto directo, CERO
 *      llamadas al LLM.
 *   3. Si no hay coincidencia -> se llama al LLM, que propone un concepto con
 *      score de confianza.
 *   4. Si el score supera el umbral -> se propone en la bandeja, precargado.
 *   5. Si el score es bajo -> cola de revisión manual SIN propuesta.
 *   6. Cuando el humano aprueba o corrige, la decisión se graba en memoria
 *      (`confirmarClasificacion`, más abajo).
 *
 * Y DOS AHORROS MÁS, que la sección no nombra pero que salen del mismo
 * razonamiento:
 *
 *  · REPROCESO. Si la línea ya tiene fila en la cola, se devuelve esa
 *    propuesta. Reprocesar un documento no vuelve a pagar el modelo, y de paso
 *    es la mitad del determinismo que exige la 8.4: el mismo documento produce
 *    la misma propuesta las veces que se reprocese.
 *  · MISMO PATRÓN YA EN COLA. Si otra factura con el mismo patrón está
 *    esperando decisión humana, se reutiliza su propuesta. Sin esto, las diez
 *    primeras facturas de un proveedor nuevo pagarían diez veces la misma
 *    pregunta antes de que nadie llegue a la bandeja.
 *
 * DÓNDE CORRE. En el worker, en contexto de administración, igual que
 * `procesarJobCausacion`: la función suma aciertos en `memoria_clasificacion`,
 * y esa tabla tiene trigger de permiso ('concepto.editar') que solo se exime
 * cuando no hay sesión. Todas las consultas filtran tenant y empresa de forma
 * explícita, así que la función se comporta igual dentro de una sesión con RLS.
 *
 * LO QUE ESTA FUNCIÓN NO HACE, NUNCA: calcular. No resuelve una retención, no
 * elige una tarifa, no toca una cuenta. Deja un `concepto_causacion_id`
 * propuesto y un score. El cálculo es del motor determinista de A3 (Regla de
 * Oro 4), que lee las reglas paramétricas de ESE concepto por la fecha del
 * hecho económico.
 */
import type { SqlClient } from '../db/types';
import { cargarCatalogo, indicePorCodigo } from './catalogo';
import { costoMicrosUsd } from './costo';
import { buscarEnMemoria, contarAcierto, registrarDecisionHumana } from './memoria';
import { patronCanonico } from './normalizar';
import { cargarParametros, umbralesUtilizables, type ParametrosClasificacion } from './parametros';
import { construirPeticion, cargarPrompt, estimarTokens, type PromptVersionado } from './prompt';
import {
  MOTIVO_CLASIFICACION,
  type ConceptoCatalogo,
  type DecisionClasificacion,
  type ProveedorLlm,
  type ResultadoClasificacion,
  type ResultadoLinea,
} from './tipos';

const MILESIMAS = 1000;

interface FilaDocumento {
  id: string;
  tenant_id: string;
  company_id: string;
  third_party_id: string | null;
  emisor_nombre: string | null;
  emisor_nit: string;
}

interface LineaParaClasificar {
  numero: number;
  descripcion: string | null;
}

interface FilaPendiente {
  id: string;
  estado: string;
  concepto_propuesto_id: string | null;
  concepto_confirmado_id: string | null;
  score_milesimas: number | null;
  origen: string;
  patron_descripcion: string;
}

export interface OpcionesClasificacion {
  /**
   * El puerto. `null` o ausente = no hay modelo disponible: la memoria sigue
   * funcionando y lo que no esté en memoria va a revisión humana. El sistema
   * NO se detiene ni supone nada cuando no hay IA.
   */
  proveedor?: ProveedorLlm | null;
  /** Reloj inyectable, para las pruebas de revalidación de memoria. */
  ahora?: Date;
  /** Sumar aciertos en memoria. Se apaga para consultas de solo lectura. */
  contarAciertos?: boolean;
}

/** Lee las líneas de la extracción del PARSER, que es la que trae `lineas`. */
function proyectarLineas(datos: unknown): LineaParaClasificar[] {
  const d = datos as { lineas?: readonly { numero?: unknown; descripcion?: unknown }[] };
  if (!d || !Array.isArray(d.lineas)) return [];
  return d.lineas
    .map((l, indice) => ({
      numero:
        typeof l.numero === 'number' && Number.isInteger(l.numero) && l.numero > 0
          ? l.numero
          : indice + 1,
      descripcion: typeof l.descripcion === 'string' ? l.descripcion : null,
    }))
    .sort((a, b) => a.numero - b.numero);
}

/** Umbrales -> decisión. Una sola definición, usada también en los reprocesos. */
function decidir(
  scoreMilesimas: number | null,
  p: ParametrosClasificacion,
): DecisionClasificacion {
  if (scoreMilesimas === null) return 'revisar';
  if (!umbralesUtilizables(p)) return 'revisar';
  if (scoreMilesimas >= p.umbralAutoAprobacion!) return 'aplicar';
  if (scoreMilesimas >= p.umbralPropuesta!) return 'proponer';
  return 'revisar';
}

async function registrarExtraccion(
  tx: SqlClient,
  datos: {
    tenantId: string;
    companyId: string;
    sourceDocumentId: string;
    payload: unknown;
    conceptoPropuestoId: string | null;
    scoreMilesimas: number | null;
    origen: 'memoria' | 'llm' | 'manual';
    promptVersion: string | null;
    modelo: string | null;
    temperaturaMilesimas: number | null;
    tokensEntrada: number | null;
    tokensSalida: number | null;
    costoMicrosUsd: number | null;
    memoriaId: string | null;
  },
): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO extraction (
        tenant_id, company_id, source_document_id, datos_extraidos,
        concepto_propuesto_id, score_confianza, origen,
        prompt_version, modelo, temperatura, tokens_entrada, tokens_salida,
        costo_usd_micros, memoria_clasificacion_id)
     VALUES ($1, $2, $3, $4::jsonb, $5,
             CASE WHEN $6::int IS NULL THEN NULL ELSE $6::numeric / 1000 END,
             $7, $8, $9,
             CASE WHEN $10::int IS NULL THEN NULL ELSE $10::numeric / 1000 END,
             $11, $12, $13, $14)
     RETURNING id`,
    [
      datos.tenantId,
      datos.companyId,
      datos.sourceDocumentId,
      JSON.stringify(datos.payload),
      datos.conceptoPropuestoId,
      datos.scoreMilesimas,
      datos.origen,
      datos.promptVersion,
      datos.modelo,
      datos.temperaturaMilesimas,
      datos.tokensEntrada,
      datos.tokensSalida,
      datos.costoMicrosUsd,
      datos.memoriaId,
    ],
  );
  return rows[0]!.id;
}

async function registrarPendiente(
  tx: SqlClient,
  datos: {
    tenantId: string;
    companyId: string;
    sourceDocumentId: string;
    lineaNumero: number;
    terceroId: string;
    descripcion: string | null;
    patron: string;
    conceptoPropuestoId: string | null;
    scoreMilesimas: number | null;
    origen: string;
    extractionId: string | null;
  },
): Promise<string> {
  // El score solo acompaña a una propuesta: la base lo impone
  // (clasificacion_pendiente_propuesta_ck) y aquí se respeta.
  const propuesta = datos.conceptoPropuestoId;
  const score = propuesta === null ? null : datos.scoreMilesimas;

  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO clasificacion_pendiente (
        tenant_id, company_id, source_document_id, linea_numero, third_party_id,
        descripcion_original, patron_descripcion, concepto_propuesto_id,
        score_milesimas, origen, extraction_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (source_document_id, linea_numero) DO UPDATE
        SET concepto_propuesto_id = EXCLUDED.concepto_propuesto_id,
            score_milesimas       = EXCLUDED.score_milesimas,
            origen                = EXCLUDED.origen,
            extraction_id         = EXCLUDED.extraction_id
      WHERE clasificacion_pendiente.estado = 'pendiente'
     RETURNING id`,
    [
      datos.tenantId,
      datos.companyId,
      datos.sourceDocumentId,
      datos.lineaNumero,
      datos.terceroId,
      datos.descripcion,
      datos.patron,
      propuesta,
      score,
      datos.origen,
      datos.extractionId,
    ],
  );
  if (rows[0]) return rows[0].id;

  const { rows: existentes } = await tx.query<{ id: string }>(
    `SELECT id FROM clasificacion_pendiente
      WHERE source_document_id = $1 AND linea_numero = $2`,
    [datos.sourceDocumentId, datos.lineaNumero],
  );
  return existentes[0]!.id;
}

/**
 * Clasifica todas las líneas de un documento. Devuelve, línea por línea, qué
 * concepto se propone, de dónde salió y cuánto costó.
 */
export async function clasificarDocumento(
  tx: SqlClient,
  sourceDocumentId: string,
  opciones: OpcionesClasificacion = {},
): Promise<ResultadoClasificacion> {
  const motivos: string[] = [];
  const vacio = (motivo: string): ResultadoClasificacion => {
    motivos.push(motivo);
    return {
      sourceDocumentId,
      lineas: [],
      llamadasLlm: 0,
      costoMicrosUsd: 0,
      promptCodigo: null,
      promptVersion: null,
      motivos,
    };
  };

  const { rows: documentos } = await tx.query<FilaDocumento>(
    `SELECT id, tenant_id, company_id, third_party_id, emisor_nombre, emisor_nit
       FROM source_document WHERE id = $1`,
    [sourceDocumentId],
  );
  const doc = documentos[0];
  if (!doc) return vacio(MOTIVO_CLASIFICACION.DOCUMENTO_INEXISTENTE);
  if (doc.third_party_id === null) return vacio(MOTIVO_CLASIFICACION.SIN_TERCERO);

  const { rows: extracciones } = await tx.query<{ datos_extraidos: unknown }>(
    `SELECT datos_extraidos FROM extraction
      WHERE source_document_id = $1 AND origen = 'parser_ubl'
      ORDER BY created_at DESC LIMIT 1`,
    [sourceDocumentId],
  );
  if (!extracciones[0]) return vacio(MOTIVO_CLASIFICACION.SIN_EXTRACCION);

  const lineas = proyectarLineas(extracciones[0].datos_extraidos);
  if (lineas.length === 0) return vacio(MOTIVO_CLASIFICACION.SIN_LINEAS);

  const alcance = { tenantId: doc.tenant_id, companyId: doc.company_id };
  const parametros = await cargarParametros(tx, alcance);
  const catalogo = await cargarCatalogo(tx, {
    ...alcance,
    limite: parametros.catalogoMaximo,
  });
  const porCodigo = indicePorCodigo(catalogo);

  // El prompt se carga UNA vez por documento, no una por línea.
  let prompt: PromptVersionado | null = null;
  if (parametros.promptCodigo !== null && parametros.promptVersion !== null) {
    prompt = await cargarPrompt(tx, {
      tenantId: doc.tenant_id,
      codigo: parametros.promptCodigo,
      version: parametros.promptVersion,
    });
  }

  const proveedor = opciones.proveedor ?? null;
  const resultados: ResultadoLinea[] = [];
  let costoAcumulado = 0;
  let llamadas = 0;

  for (const linea of lineas) {
    const patron = patronCanonico(linea.descripcion);
    const base = {
      numero: linea.numero,
      descripcion: linea.descripcion,
      patron,
      conceptoId: null as string | null,
      conceptoCodigo: null as string | null,
      scoreMilesimas: null as number | null,
      memoriaId: null as string | null,
      pendienteId: null as string | null,
      extractionId: null as string | null,
      llamadasLlm: 0,
      costoMicrosUsd: 0,
      motivo: null as string | null,
    };

    // -----------------------------------------------------------------------
    // PASO 2 — memoria. Va SIEMPRE primero. Si acierta, no hay llamada.
    // -----------------------------------------------------------------------
    const recuerdo = await buscarEnMemoria(tx, {
      tenantId: doc.tenant_id,
      companyId: doc.company_id,
      terceroId: doc.third_party_id,
      descripcion: linea.descripcion,
      alcance: parametros.alcanceMemoria,
      revalidarTrasDias: parametros.revalidarTrasDias,
      ahora: opciones.ahora,
    });

    if (recuerdo !== null && !recuerdo.vencida) {
      if (opciones.contarAciertos !== false) await contarAcierto(tx, recuerdo.id);
      const extractionId = await registrarExtraccion(tx, {
        ...alcance,
        sourceDocumentId,
        payload: {
          linea: linea.numero,
          patron,
          fuente: 'memoria_clasificacion',
          conceptoCodigo: recuerdo.conceptoCodigo,
          compartida: recuerdo.compartida,
        },
        conceptoPropuestoId: recuerdo.conceptoId,
        scoreMilesimas: null,
        origen: 'memoria',
        promptVersion: null,
        modelo: null,
        temperaturaMilesimas: null,
        tokensEntrada: null,
        tokensSalida: null,
        costoMicrosUsd: 0,
        memoriaId: recuerdo.id,
      });
      resultados.push({
        ...base,
        conceptoId: recuerdo.conceptoId,
        conceptoCodigo: recuerdo.conceptoCodigo,
        origen: 'memoria',
        decision: 'aplicar',
        memoriaId: recuerdo.id,
        extractionId,
      });
      continue;
    }

    // Memoria vencida: sigue sin costar una llamada, pero pide revalidación.
    if (recuerdo !== null && recuerdo.vencida) {
      const pendienteId = await registrarPendiente(tx, {
        ...alcance,
        sourceDocumentId,
        lineaNumero: linea.numero,
        terceroId: doc.third_party_id,
        descripcion: linea.descripcion,
        patron,
        conceptoPropuestoId: recuerdo.conceptoId,
        scoreMilesimas: MILESIMAS,
        origen: 'memoria_vencida',
        extractionId: null,
      });
      resultados.push({
        ...base,
        conceptoId: recuerdo.conceptoId,
        conceptoCodigo: recuerdo.conceptoCodigo,
        scoreMilesimas: MILESIMAS,
        origen: 'memoria',
        decision: 'proponer',
        memoriaId: recuerdo.id,
        pendienteId,
        motivo: MOTIVO_CLASIFICACION.MEMORIA_VENCIDA,
      });
      continue;
    }

    // -----------------------------------------------------------------------
    // Reproceso: esta misma línea ya se clasificó antes.
    // -----------------------------------------------------------------------
    const { rows: propias } = await tx.query<FilaPendiente>(
      `SELECT id, estado, concepto_propuesto_id, concepto_confirmado_id,
              score_milesimas, origen, patron_descripcion
         FROM clasificacion_pendiente
        WHERE source_document_id = $1 AND linea_numero = $2`,
      [sourceDocumentId, linea.numero],
    );
    const propia = propias[0];
    if (propia) {
      const conceptoId =
        propia.estado === 'resuelto' ? propia.concepto_confirmado_id : propia.concepto_propuesto_id;
      const score = propia.estado === 'resuelto' ? MILESIMAS : propia.score_milesimas;
      resultados.push({
        ...base,
        conceptoId,
        conceptoCodigo: null,
        scoreMilesimas: score === null ? null : Number(score),
        origen: 'reproceso',
        decision:
          propia.estado === 'resuelto'
            ? 'aplicar'
            : decidir(score === null ? null : Number(score), parametros),
        pendienteId: propia.id,
        motivo: conceptoId === null ? MOTIVO_CLASIFICACION.SCORE_BAJO : null,
      });
      continue;
    }

    // -----------------------------------------------------------------------
    // Mismo patrón ya esperando decisión humana en otra factura.
    // -----------------------------------------------------------------------
    const { rows: gemelas } = await tx.query<FilaPendiente>(
      `SELECT id, estado, concepto_propuesto_id, concepto_confirmado_id,
              score_milesimas, origen, patron_descripcion
         FROM clasificacion_pendiente
        WHERE company_id = $1 AND third_party_id = $2 AND patron_descripcion = $3
          AND estado = 'pendiente' AND concepto_propuesto_id IS NOT NULL
        ORDER BY created_at ASC
        LIMIT 1`,
      [doc.company_id, doc.third_party_id, patron],
    );
    const gemela = gemelas[0];
    if (gemela) {
      const score = gemela.score_milesimas === null ? null : Number(gemela.score_milesimas);
      const pendienteId = await registrarPendiente(tx, {
        ...alcance,
        sourceDocumentId,
        lineaNumero: linea.numero,
        terceroId: doc.third_party_id,
        descripcion: linea.descripcion,
        patron,
        conceptoPropuestoId: gemela.concepto_propuesto_id,
        scoreMilesimas: score,
        origen: 'cola',
        extractionId: null,
      });
      resultados.push({
        ...base,
        conceptoId: gemela.concepto_propuesto_id,
        scoreMilesimas: score,
        origen: 'cola',
        decision: decidir(score, parametros),
        pendienteId,
      });
      continue;
    }

    // -----------------------------------------------------------------------
    // PASO 3 — no hubo forma de evitarlo: se le pregunta al modelo.
    // -----------------------------------------------------------------------
    const impedimento = razonParaNoLlamar({
      proveedor,
      prompt,
      catalogo,
      parametros,
    });
    if (impedimento !== null) {
      const pendienteId = await registrarPendiente(tx, {
        ...alcance,
        sourceDocumentId,
        lineaNumero: linea.numero,
        terceroId: doc.third_party_id,
        descripcion: linea.descripcion,
        patron,
        conceptoPropuestoId: null,
        scoreMilesimas: null,
        origen: 'sin_propuesta',
        extractionId: null,
      });
      if (!motivos.includes(impedimento)) motivos.push(impedimento);
      resultados.push({
        ...base,
        origen: 'sin_propuesta',
        decision: 'revisar',
        pendienteId,
        motivo: impedimento,
      });
      continue;
    }

    const peticion = construirPeticion({
      prompt: prompt!,
      catalogo,
      descripcionNormalizada: patron,
      proveedor: doc.emisor_nombre,
    });

    // Techo de costo de A15, comprobado ANTES de gastar.
    const estimado = costoMicrosUsd(
      {
        entrada: estimarTokens(peticion.sistema) + estimarTokens(peticion.usuario),
        salida: peticion.maxTokensSalida,
      },
      {
        entradaPorMillon: parametros.precioEntradaPorMillon ?? 0,
        salidaPorMillon: parametros.precioSalidaPorMillon ?? 0,
      },
    );
    if (
      parametros.costoMaximoPorDocumento !== null &&
      costoAcumulado + estimado > parametros.costoMaximoPorDocumento
    ) {
      const pendienteId = await registrarPendiente(tx, {
        ...alcance,
        sourceDocumentId,
        lineaNumero: linea.numero,
        terceroId: doc.third_party_id,
        descripcion: linea.descripcion,
        patron,
        conceptoPropuestoId: null,
        scoreMilesimas: null,
        origen: 'sin_propuesta',
        extractionId: null,
      });
      if (!motivos.includes(MOTIVO_CLASIFICACION.TECHO_DE_COSTO)) {
        motivos.push(MOTIVO_CLASIFICACION.TECHO_DE_COSTO);
      }
      resultados.push({
        ...base,
        origen: 'sin_propuesta',
        decision: 'revisar',
        pendienteId,
        motivo: MOTIVO_CLASIFICACION.TECHO_DE_COSTO,
      });
      continue;
    }

    let respuesta;
    try {
      respuesta = await proveedor!.clasificar(peticion);
    } catch {
      llamadas += 1;
      const pendienteId = await registrarPendiente(tx, {
        ...alcance,
        sourceDocumentId,
        lineaNumero: linea.numero,
        terceroId: doc.third_party_id,
        descripcion: linea.descripcion,
        patron,
        conceptoPropuestoId: null,
        scoreMilesimas: null,
        origen: 'sin_propuesta',
        extractionId: null,
      });
      if (!motivos.includes(MOTIVO_CLASIFICACION.PROVEEDOR_FALLO)) {
        motivos.push(MOTIVO_CLASIFICACION.PROVEEDOR_FALLO);
      }
      resultados.push({
        ...base,
        origen: 'sin_propuesta',
        decision: 'revisar',
        pendienteId,
        llamadasLlm: 1,
        motivo: MOTIVO_CLASIFICACION.PROVEEDOR_FALLO,
      });
      continue;
    }

    llamadas += 1;
    const costo = costoMicrosUsd(
      { entrada: respuesta.tokensEntrada, salida: respuesta.tokensSalida },
      {
        entradaPorMillon: parametros.precioEntradaPorMillon ?? 0,
        salidaPorMillon: parametros.precioSalidaPorMillon ?? 0,
      },
    );
    costoAcumulado += costo;

    // CATÁLOGO CERRADO (8.4): lo que no esté en la lista no existe.
    const propuesto: ConceptoCatalogo | undefined =
      respuesta.codigo === null ? undefined : porCodigo.get(respuesta.codigo);
    const fueraDeCatalogo = respuesta.codigo !== null && propuesto === undefined;
    const score = Math.max(0, Math.min(MILESIMAS, Math.round(respuesta.scoreMilesimas)));
    const decision = propuesto === undefined ? 'revisar' : decidir(score, parametros);
    // La propuesta solo se guarda si alcanzó el umbral: por debajo, la cola va
    // SIN propuesta (paso 5). Una sugerencia mala precargada se aprueba por
    // inercia; una casilla vacía obliga a mirar.
    const conceptoGuardado = decision === 'revisar' ? null : (propuesto?.id ?? null);

    const extractionId = await registrarExtraccion(tx, {
      ...alcance,
      sourceDocumentId,
      payload: {
        linea: linea.numero,
        patron,
        fuente: 'llm',
        conceptoCodigo: respuesta.codigo,
        fueraDeCatalogo,
        conceptosEnCatalogo: catalogo.length,
        huellaPrompt: peticion.promptHash,
      },
      conceptoPropuestoId: propuesto?.id ?? null,
      scoreMilesimas: score,
      origen: 'llm',
      promptVersion: `${peticion.promptCodigo}@${peticion.promptVersion}`,
      modelo: respuesta.modelo,
      temperaturaMilesimas: peticion.temperaturaMilesimas,
      tokensEntrada: respuesta.tokensEntrada,
      tokensSalida: respuesta.tokensSalida,
      costoMicrosUsd: costo,
      memoriaId: null,
    });

    const pendienteId = await registrarPendiente(tx, {
      ...alcance,
      sourceDocumentId,
      lineaNumero: linea.numero,
      terceroId: doc.third_party_id,
      descripcion: linea.descripcion,
      patron,
      conceptoPropuestoId: conceptoGuardado,
      scoreMilesimas: conceptoGuardado === null ? null : score,
      origen: conceptoGuardado === null ? 'sin_propuesta' : 'llm',
      extractionId,
    });

    resultados.push({
      ...base,
      conceptoId: conceptoGuardado,
      conceptoCodigo: propuesto?.codigo ?? null,
      scoreMilesimas: score,
      origen: 'llm',
      decision,
      pendienteId,
      extractionId,
      llamadasLlm: 1,
      costoMicrosUsd: costo,
      motivo: fueraDeCatalogo
        ? MOTIVO_CLASIFICACION.FUERA_DE_CATALOGO
        : decision === 'revisar'
          ? MOTIVO_CLASIFICACION.SCORE_BAJO
          : null,
    });
  }

  return {
    sourceDocumentId,
    lineas: resultados,
    llamadasLlm: llamadas,
    costoMicrosUsd: resultados.reduce((acc, l) => acc + l.costoMicrosUsd, 0),
    promptCodigo: prompt?.codigo ?? null,
    promptVersion: prompt?.version ?? null,
    motivos,
  };
}

/** Por qué NO se puede llamar al modelo. `null` = se puede. */
function razonParaNoLlamar(estado: {
  proveedor: ProveedorLlm | null;
  prompt: PromptVersionado | null;
  catalogo: readonly ConceptoCatalogo[];
  parametros: ParametrosClasificacion;
}): string | null {
  if (estado.catalogo.length === 0) return MOTIVO_CLASIFICACION.SIN_CATALOGO;
  if (estado.proveedor === null) return MOTIVO_CLASIFICACION.SIN_PROVEEDOR;
  if (estado.prompt === null) return MOTIVO_CLASIFICACION.SIN_PROMPT;
  if (!umbralesUtilizables(estado.parametros)) return MOTIVO_CLASIFICACION.SIN_UMBRALES;
  return null;
}

// =============================================================================
// PASO 6 — la decisión humana
// =============================================================================

export interface ConfirmacionInput {
  pendienteId: string;
  /** El concepto que el humano decidió. Puede no ser el propuesto: eso es corregir. */
  conceptoId: string;
  usuarioId: string | null;
  accountId?: string | null;
  costCenterId?: string | null;
}

export interface ResultadoConfirmacion {
  memoriaId: string;
  pendienteId: string;
  origen: 'aprobacion_humana' | 'correccion_humana';
  conceptoId: string;
}

/**
 * «Cuando el humano aprueba o corrige, la decisión se graba en memoria. La
 *  próxima factura igual de ese proveedor no consume tokens.»
 *
 * Esta función es el único camino por el que se escribe `memoria_clasificacion`
 * desde el subsistema de IA, y exige un humano: un `pendienteId` que alguien
 * miró y un `conceptoId` que alguien eligió. Corre en la sesión del usuario,
 * no en el worker: `memoria_clasificacion` y `clasificacion_pendiente` tienen
 * trigger de permiso ('concepto.editar') y trigger de auditoría, así que la
 * decisión queda atribuida a una persona en `audit_log`.
 */
export async function confirmarClasificacion(
  tx: SqlClient,
  input: ConfirmacionInput,
): Promise<ResultadoConfirmacion> {
  const { rows } = await tx.query<{
    id: string;
    tenant_id: string;
    company_id: string;
    third_party_id: string;
    patron_descripcion: string;
    concepto_propuesto_id: string | null;
    estado: string;
  }>(
    `SELECT id, tenant_id, company_id, third_party_id, patron_descripcion,
            concepto_propuesto_id, estado
       FROM clasificacion_pendiente WHERE id = $1`,
    [input.pendienteId],
  );
  const pendiente = rows[0];
  if (!pendiente) {
    throw new Error(`No existe la fila de clasificación pendiente ${input.pendienteId}.`);
  }
  if (pendiente.estado !== 'pendiente') {
    throw new Error(
      `La fila de clasificación ${input.pendienteId} ya está en estado '${pendiente.estado}': no se decide dos veces.`,
    );
  }

  const decision = await registrarDecisionHumana(tx, {
    tenantId: pendiente.tenant_id,
    companyId: pendiente.company_id,
    terceroId: pendiente.third_party_id,
    patron: pendiente.patron_descripcion,
    conceptoId: input.conceptoId,
    conceptoPropuestoId: pendiente.concepto_propuesto_id,
    usuarioId: input.usuarioId,
    accountId: input.accountId ?? null,
    costCenterId: input.costCenterId ?? null,
  });

  await tx.query(
    `UPDATE clasificacion_pendiente
        SET estado = 'resuelto',
            concepto_confirmado_id = $2,
            memoria_clasificacion_id = $3,
            resuelto_por = $4,
            resuelto_en = now()
      WHERE id = $1 AND estado = 'pendiente'`,
    [input.pendienteId, input.conceptoId, decision.memoriaId, input.usuarioId],
  );

  return {
    memoriaId: decision.memoriaId,
    pendienteId: input.pendienteId,
    origen: decision.origen,
    conceptoId: input.conceptoId,
  };
}

/** La cola de revisión de una empresa, para la bandeja de A7. */
export interface ItemColaRevision {
  id: string;
  sourceDocumentId: string;
  lineaNumero: number;
  descripcionOriginal: string | null;
  patron: string;
  terceroId: string;
  conceptoPropuestoId: string | null;
  conceptoPropuestoCodigo: string | null;
  scoreMilesimas: number | null;
  origen: string;
  creadoEn: string;
}

export async function listarColaRevision(
  tx: SqlClient,
  companyId: string,
  limite = 100,
): Promise<ItemColaRevision[]> {
  const { rows } = await tx.query<{
    id: string;
    source_document_id: string;
    linea_numero: number;
    descripcion_original: string | null;
    patron_descripcion: string;
    third_party_id: string;
    concepto_propuesto_id: string | null;
    concepto_codigo: string | null;
    score_milesimas: number | null;
    origen: string;
    created_at: string;
  }>(
    `SELECT p.id, p.source_document_id, p.linea_numero, p.descripcion_original,
            p.patron_descripcion, p.third_party_id, p.concepto_propuesto_id,
            c.codigo AS concepto_codigo, p.score_milesimas, p.origen,
            p.created_at::text AS created_at
       FROM clasificacion_pendiente p
       LEFT JOIN concepto_causacion c ON c.id = p.concepto_propuesto_id
      WHERE p.company_id = $1 AND p.estado = 'pendiente'
      ORDER BY p.created_at ASC, p.linea_numero ASC
      LIMIT $2`,
    [companyId, limite],
  );
  return rows.map((r) => ({
    id: r.id,
    sourceDocumentId: r.source_document_id,
    lineaNumero: Number(r.linea_numero),
    descripcionOriginal: r.descripcion_original,
    patron: r.patron_descripcion,
    terceroId: r.third_party_id,
    conceptoPropuestoId: r.concepto_propuesto_id,
    conceptoPropuestoCodigo: r.concepto_codigo,
    scoreMilesimas: r.score_milesimas === null ? null : Number(r.score_milesimas),
    origen: r.origen,
    creadoEn: r.created_at,
  }));
}

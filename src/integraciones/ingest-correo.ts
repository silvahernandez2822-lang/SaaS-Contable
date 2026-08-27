/**
 * A13 — Orquestador del webhook de correo (Ola 2, sección 13.3 / cierre de V-9).
 *
 * ESTA ES LA COSTURA ENTRE n8n Y A6/A4. n8n (fuera de este repositorio, sin
 * instancia contratada) recibe el correo real de un proveedor de inbound
 * email, lo traduce a la forma neutra `CorreoEntrante` (A4,
 * `src/ingest/correo/tipos.ts`) y hace UN POST HTTP con un token de
 * integración en la cabecera `Authorization`. Todo lo que decide y calcula
 * pasa de aquí para adentro:
 *
 *   1. Autenticación por token con alcance de tenant (`abrirSesionSistema`,
 *      cierre de V-9) — nunca por el buzón, que V-1 demostró que no es
 *      secreto entre firmas.
 *   2. Resolución de la EMPRESA dentro de esa firma, con un `SELECT` normal
 *      contra `company` (RLS de tenant ya activa: ver el comentario de la
 *      migración 090, no se usa `app.resolver_empresa_por_buzon`).
 *   3. Decodificación y persistencia del documento — delegadas ÍNTEGRAMENTE
 *      a `recibirDocumento` (A6, `src/services/ingest.ts`) y a
 *      `procesarAdjuntoXml` (A4, función pura). Este archivo NUNCA parsea un
 *      XML ni decide una retención: solo orquesta la sesión, el buzón, la
 *      cuarentena por SPF/DKIM y el registro de auditoría del canal.
 *   4. Idempotencia: la única restricción real es `source_document_cufe_uq`
 *      (A2, 008), que `recibirDocumento`/`guardarDocumentoProcesado` (A4/A6)
 *      ya usan. Este archivo no crea una segunda.
 *
 * NINGÚN CÁLCULO TRIBUTARIO NI ESCRITURA DE ASIENTO: la única llamada que
 * toca `causacion.ts` es indirecta y no ejecutiva — `recibirDocumento`
 * ENCOLA el trabajo (`document_processing_job`), nunca lo procesa dentro del
 * request (mismo invariante que ya prueba `tests/services/worker.test.ts` de
 * A6). El worker que sí causa (`ejecutarCicloCola`) es un proceso aparte que
 * A15 programa; este archivo no lo importa ni lo llama.
 */
import type { SqlClient } from '../db/types';
import { withSessionContext, EmpresaNoAutorizadaError, SesionInvalidaError } from '../db/tenant-context';
import { recibirDocumento } from '../services/ingest';
import { sha256Hex } from '../ingest/hash';
import {
  manejarWebhookCorreo,
  manejarWebhookConAdaptador,
  elegirBuzonDestino,
} from '../ingest/correo/webhook';
import { evaluarAutenticacion, autenticacionFalla } from '../ingest/correo/spf-dkim';
import { excedeTamanoCorreo, excedeTamanoAdjunto, excedeLimiteTasa, LIMITE_CORREOS_POR_VENTANA, VENTANA_LIMITE_TASA_MINUTOS } from '../ingest/correo/limites';
import { registrarCorreo, registrarAdjunto, contarCorreosRecientes } from '../ingest/persistencia';
import type { CorreoEntrante, ProveedorCorreoEntrante } from '../ingest/correo/tipos';
import { abrirSesionSistema, cerrarSesionSistema, TokenIntegracionInvalidoError } from './sesion-sistema';
import { registrarLlamada, registrarLlamadaNoAutenticada } from './llamadas';

export const ENDPOINT_INGEST_CORREO = '/api/integraciones/correo';

export type MotivoRechazoWebhook =
  | 'no_autenticado'
  | 'payload_invalido'
  | 'correo_excede_tamano'
  | 'buzon_no_reconocido'
  | 'empresa_no_autorizada'
  | 'limite_tasa_excedido'
  | 'autenticacion_correo_fallida'
  | 'sin_adjuntos';

export interface ResultadoAdjuntoWebhook {
  nombreArchivo: string | null;
  resultado: 'procesado' | 'en_cuarentena' | 'duplicado';
  sourceDocumentId: string | null;
  motivo: string | null;
}

export type ResultadoWebhookCorreo =
  | {
      ok: true;
      emailIngestLogId: string;
      companyId: string;
      procesadoParcial: boolean;
      adjuntos: ResultadoAdjuntoWebhook[];
    }
  | {
      ok: false;
      motivo: MotivoRechazoWebhook;
      detalle: string;
      emailIngestLogId?: string;
    };

export interface OpcionesWebhookCorreo {
  /** Token de integración, tal como llega en `Authorization: Bearer <token>`. */
  token: string;
  /** Payload crudo del body HTTP, ya en JSON. */
  payloadCrudo: unknown;
  /** Si el proveedor de inbound email no entrega ya la forma neutra, aplica su adaptador antes de validar. */
  proveedor?: ProveedorCorreoEntrante;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

function mapearBooleanoAutenticacion(valor: string): boolean | null {
  if (valor === 'pass') return true;
  if (valor === 'no_verificado') return null;
  return false;
}

interface ResultadoAgregado {
  resultado: 'procesado' | 'procesado_parcial' | 'en_cuarentena' | 'rechazado';
  motivo: string | null;
}

function agregarResultados(items: readonly ResultadoAdjuntoWebhook[]): ResultadoAgregado {
  if (items.length === 0) return { resultado: 'rechazado', motivo: 'el correo no traía adjuntos procesables' };
  const procesados = items.filter((i) => i.resultado === 'procesado' || i.resultado === 'duplicado').length;
  const cuarentena = items.filter((i) => i.resultado === 'en_cuarentena').length;
  if (cuarentena === 0) return { resultado: 'procesado', motivo: null };
  if (procesados === 0) {
    return { resultado: 'en_cuarentena', motivo: `${cuarentena} adjunto(s) en cuarentena, ninguno procesado` };
  }
  return { resultado: 'procesado_parcial', motivo: `${cuarentena} de ${items.length} adjunto(s) en cuarentena` };
}

/**
 * Procesa UNA llamada del webhook de correo. Siempre cierra la sesión de
 * sistema que abre, sin importar el desenlace (least exposure, ver
 * `sesion-sistema.ts`).
 */
export async function procesarWebhookCorreo(
  db: SqlClient,
  opciones: OpcionesWebhookCorreo,
): Promise<ResultadoWebhookCorreo> {
  const inicio = Date.now();
  const comun = {
    canal: 'correo' as const,
    endpoint: ENDPOINT_INGEST_CORREO,
    ip: opciones.ip ?? null,
    userAgent: opciones.userAgent ?? null,
    requestId: opciones.requestId ?? null,
  };

  let sesion;
  try {
    sesion = await abrirSesionSistema(db, opciones.token, 'correo', {
      ip: opciones.ip ?? null,
      userAgent: opciones.userAgent ?? null,
    });
  } catch (error) {
    if (error instanceof TokenIntegracionInvalidoError) {
      await registrarLlamadaNoAutenticada(db, {
        ...comun,
        detalle: 'token de integración ausente, inválido o revocado',
      });
      return { ok: false, motivo: 'no_autenticado', detalle: error.message };
    }
    throw error;
  }

  try {
    const resultadoValidacion = opciones.proveedor
      ? manejarWebhookConAdaptador(opciones.proveedor, opciones.payloadCrudo)
      : manejarWebhookCorreo(opciones.payloadCrudo);

    if (!resultadoValidacion.ok) {
      await withSessionContext(
        db,
        { sessionToken: sesion.token, companyId: null, ip: comun.ip, userAgent: comun.userAgent, requestId: comun.requestId },
        (tx) => registrarLlamada(tx, { ...comun, resultado: 'rechazado', detalle: resultadoValidacion.detalle, duracionMs: Date.now() - inicio }),
      );
      return { ok: false, motivo: 'payload_invalido', detalle: resultadoValidacion.detalle };
    }

    const correo: CorreoEntrante = resultadoValidacion.correo;

    if (correo.tamanoBytes !== null && excedeTamanoCorreo(correo.tamanoBytes)) {
      await withSessionContext(
        db,
        { sessionToken: sesion.token, companyId: null, ip: comun.ip, userAgent: comun.userAgent, requestId: comun.requestId },
        (tx) => registrarLlamada(tx, { ...comun, resultado: 'rechazado', detalle: 'correo excede el tamaño máximo', duracionMs: Date.now() - inicio }),
      );
      return { ok: false, motivo: 'correo_excede_tamano', detalle: 'El correo excede el tamaño máximo aceptado.' };
    }

    const buzon = elegirBuzonDestino(correo);
    const auth = evaluarAutenticacion(correo.headers);

    // -------------------------------------------------------------------
    // Transacción 1: resolver la empresa dentro de la firma ya autenticada.
    // Un SELECT normal sobre `company` (RLS de tenant, 012_rls.sql) — NO se
    // usa `app.resolver_empresa_por_buzon` (ver cabecera del archivo, V-1).
    // -------------------------------------------------------------------
    const companyId = await withSessionContext(
      db,
      { sessionToken: sesion.token, companyId: null, ip: comun.ip, userAgent: comun.userAgent, requestId: comun.requestId },
      async (tx) => {
        const { rows } = await tx.query<{ id: string }>(
          `SELECT id FROM company WHERE lower(buzon_email) = lower($1) AND estado = 'activa'`,
          [buzon],
        );
        return rows[0]?.id ?? null;
      },
    );

    if (!companyId) {
      const emailIngestLogId = await withSessionContext(
        db,
        { sessionToken: sesion.token, companyId: null, ip: comun.ip, userAgent: comun.userAgent, requestId: comun.requestId },
        async (tx) => {
          const id = await registrarCorreo(tx, {
            tenantId: sesion.tenantId,
            companyId: null,
            buzonDestino: buzon,
            messageId: correo.messageId,
            remitenteEmail: correo.remitenteEmail,
            remitenteNombre: correo.remitenteNombre,
            asunto: correo.asunto,
            tamanoBytes: correo.tamanoBytes ?? 0,
            spfResultado: auth.spf,
            dkimResultado: auth.dkim,
            cantidadAdjuntos: correo.adjuntos.length,
            resultado: 'rechazado',
            motivo: 'el buzón de destino no corresponde a ninguna empresa activa de esta firma',
            limiteTasaExcedido: false,
          });
          await registrarLlamada(tx, {
            ...comun,
            resultado: 'buzon_no_reconocido',
            detalle: buzon,
            duracionMs: Date.now() - inicio,
          });
          return id;
        },
      );
      return {
        ok: false,
        motivo: 'buzon_no_reconocido',
        detalle: `Ninguna empresa activa de esta firma usa el buzón "${buzon}".`,
        emailIngestLogId,
      };
    }

    // -------------------------------------------------------------------
    // Transacción 2: ya con empresa resuelta — límite de tasa, SPF/DKIM,
    // adjuntos.
    // -------------------------------------------------------------------
    return await withSessionContext(
      db,
      { sessionToken: sesion.token, companyId, ip: comun.ip, userAgent: comun.userAgent, requestId: comun.requestId },
      async (tx) => {
        if (correo.adjuntos.length === 0) {
          const emailIngestLogId = await registrarCorreo(tx, {
            tenantId: sesion.tenantId,
            companyId,
            buzonDestino: buzon,
            messageId: correo.messageId,
            remitenteEmail: correo.remitenteEmail,
            remitenteNombre: correo.remitenteNombre,
            asunto: correo.asunto,
            tamanoBytes: correo.tamanoBytes ?? 0,
            spfResultado: auth.spf,
            dkimResultado: auth.dkim,
            cantidadAdjuntos: 0,
            resultado: 'rechazado',
            motivo: 'el correo no traía ningún adjunto procesable',
            limiteTasaExcedido: false,
          });
          await registrarLlamada(tx, {
            companyId,
            ...comun,
            resultado: 'rechazado',
            detalle: 'sin adjuntos',
            duracionMs: Date.now() - inicio,
          });
          return {
            ok: false,
            motivo: 'sin_adjuntos',
            detalle: 'El correo no traía ningún adjunto.',
            emailIngestLogId,
          } satisfies ResultadoWebhookCorreo;
        }

        const recientes = await contarCorreosRecientes(tx, companyId, VENTANA_LIMITE_TASA_MINUTOS);
        if (excedeLimiteTasa(recientes, LIMITE_CORREOS_POR_VENTANA)) {
          const emailIngestLogId = await registrarCorreo(tx, {
            tenantId: sesion.tenantId,
            companyId,
            buzonDestino: buzon,
            messageId: correo.messageId,
            remitenteEmail: correo.remitenteEmail,
            remitenteNombre: correo.remitenteNombre,
            asunto: correo.asunto,
            tamanoBytes: correo.tamanoBytes ?? 0,
            spfResultado: auth.spf,
            dkimResultado: auth.dkim,
            cantidadAdjuntos: correo.adjuntos.length,
            resultado: 'rechazado',
            motivo: 'límite de tasa del buzón excedido',
            limiteTasaExcedido: true,
          });
          await registrarLlamada(tx, {
            companyId,
            ...comun,
            resultado: 'rechazado',
            detalle: 'límite de tasa excedido',
            duracionMs: Date.now() - inicio,
          });
          return {
            ok: false,
            motivo: 'limite_tasa_excedido',
            detalle: 'Este buzón superó el límite de correos por hora.',
            emailIngestLogId,
          } satisfies ResultadoWebhookCorreo;
        }

        if (autenticacionFalla(auth)) {
          const emailIngestLogId = await registrarCorreo(tx, {
            tenantId: sesion.tenantId,
            companyId,
            buzonDestino: buzon,
            messageId: correo.messageId,
            remitenteEmail: correo.remitenteEmail,
            remitenteNombre: correo.remitenteNombre,
            asunto: correo.asunto,
            tamanoBytes: correo.tamanoBytes ?? 0,
            spfResultado: auth.spf,
            dkimResultado: auth.dkim,
            cantidadAdjuntos: correo.adjuntos.length,
            resultado: 'en_cuarentena',
            motivo: `autenticación de correo fallida (spf=${auth.spf}, dkim=${auth.dkim})`,
            limiteTasaExcedido: false,
          });
          await registrarLlamada(tx, {
            companyId,
            ...comun,
            resultado: 'rechazado',
            detalle: 'SPF/DKIM en fail',
            duracionMs: Date.now() - inicio,
          });
          return {
            ok: false,
            motivo: 'autenticacion_correo_fallida',
            detalle: 'El correo falló la verificación SPF/DKIM del proveedor.',
            emailIngestLogId,
          } satisfies ResultadoWebhookCorreo;
        }

        const spfValido = mapearBooleanoAutenticacion(auth.spf);
        const dkimValido = mapearBooleanoAutenticacion(auth.dkim);

        // Paso 1: decodificar y persistir cada adjunto (A4/A6, vía
        // `recibirDocumento`) — esto YA queda comprometido en la base
        // (`source_document`/`extraction`/`document_processing_job`) dentro
        // de esta misma transacción. `email_ingest_attachment` exige un
        // `email_ingest_log_id` real (append-only, sin UPDATE posible), así
        // que su fila se inserta DESPUÉS, en el paso 2, una vez que se sabe
        // el resultado agregado de todos los adjuntos.
        interface AdjuntoProcesado extends ResultadoAdjuntoWebhook {
          tamanoBytes: number;
          hashSha256: string;
          motivoCuarentena: string | null;
        }
        const procesados: AdjuntoProcesado[] = [];
        for (const adjunto of correo.adjuntos) {
          const bytes = Buffer.from(adjunto.contenidoBase64, 'base64');
          const hash = sha256Hex(bytes);
          if (excedeTamanoAdjunto(bytes.byteLength)) {
            procesados.push({
              nombreArchivo: adjunto.nombreArchivo,
              resultado: 'en_cuarentena',
              sourceDocumentId: null,
              motivo: 'tamano_excedido',
              tamanoBytes: bytes.byteLength,
              hashSha256: hash,
              motivoCuarentena: 'tamano_excedido',
            });
            continue;
          }

          const resultadoIngesta = await recibirDocumento(tx, {
            bytes,
            nombreArchivo: adjunto.nombreArchivo,
            origen: 'correo',
            remitenteEmail: correo.remitenteEmail,
            spfValido,
            dkimValido,
          });

          if (resultadoIngesta.ok) {
            procesados.push({
              nombreArchivo: adjunto.nombreArchivo,
              resultado: resultadoIngesta.duplicado ? 'duplicado' : 'procesado',
              sourceDocumentId: resultadoIngesta.sourceDocumentId,
              motivo: null,
              tamanoBytes: bytes.byteLength,
              hashSha256: hash,
              motivoCuarentena: null,
            });
          } else {
            procesados.push({
              nombreArchivo: adjunto.nombreArchivo,
              resultado: 'en_cuarentena',
              sourceDocumentId: resultadoIngesta.sourceDocumentId,
              motivo: resultadoIngesta.motivoCuarentena,
              tamanoBytes: bytes.byteLength,
              hashSha256: hash,
              motivoCuarentena: `${resultadoIngesta.motivoCuarentena}: ${resultadoIngesta.detalle}`,
            });
          }
        }

        // Paso 2: ahora sí, el correo (con su resultado agregado ya
        // decidido) y, con su id real, cada adjunto.
        const agregado = agregarResultados(procesados);
        const emailIngestLogId = await registrarCorreo(tx, {
          tenantId: sesion.tenantId,
          companyId,
          buzonDestino: buzon,
          messageId: correo.messageId,
          remitenteEmail: correo.remitenteEmail,
          remitenteNombre: correo.remitenteNombre,
          asunto: correo.asunto,
          tamanoBytes: correo.tamanoBytes ?? 0,
          spfResultado: auth.spf,
          dkimResultado: auth.dkim,
          cantidadAdjuntos: correo.adjuntos.length,
          resultado: agregado.resultado,
          motivo: agregado.motivo,
          limiteTasaExcedido: false,
        });

        const resultadosAdjuntos: ResultadoAdjuntoWebhook[] = [];
        for (const p of procesados) {
          await registrarAdjunto(tx, {
            tenantId: sesion.tenantId,
            companyId,
            emailIngestLogId,
            nombreArchivo: p.nombreArchivo,
            tamanoBytes: p.tamanoBytes,
            hashSha256: p.hashSha256,
            tipoDocumentoDetectado: null,
            contenedorAttachedDocument: false,
            resultado: p.resultado,
            motivoCuarentena: p.motivoCuarentena,
            sourceDocumentId: p.sourceDocumentId,
          });
          resultadosAdjuntos.push({
            nombreArchivo: p.nombreArchivo,
            resultado: p.resultado,
            sourceDocumentId: p.sourceDocumentId,
            motivo: p.motivo,
          });
        }

        await registrarLlamada(tx, {
          companyId,
          ...comun,
          resultado: agregado.resultado === 'rechazado' || agregado.resultado === 'en_cuarentena' ? 'rechazado' : 'ok',
          detalle: agregado.motivo,
          duracionMs: Date.now() - inicio,
        });

        return {
          ok: true,
          emailIngestLogId,
          companyId,
          procesadoParcial: agregado.resultado === 'procesado_parcial',
          adjuntos: resultadosAdjuntos,
        } satisfies ResultadoWebhookCorreo;
      },
    );
  } catch (error) {
    if (error instanceof EmpresaNoAutorizadaError) {
      return {
        ok: false,
        motivo: 'empresa_no_autorizada',
        detalle:
          'La sesión de sistema del canal de correo no tiene acceso a esta empresa todavía. ' +
          'Un administrador debe volver a sincronizar el acceso (sincronizarAccesoEmpresasIngesta).',
      };
    }
    if (error instanceof SesionInvalidaError) {
      return { ok: false, motivo: 'no_autenticado', detalle: error.message };
    }
    throw error;
  } finally {
    await cerrarSesionSistema(db, sesion.token);
  }
}

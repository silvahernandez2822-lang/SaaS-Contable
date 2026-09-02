'use server';

/**
 * A7 — Acciones de servidor de la bandeja de causación multi-empresa.
 *
 * Dos familias:
 *  1. Aprobación en lote (sección 4): agrupa las filas seleccionadas POR
 *     EMPRESA y llama `aprobarAsientosEnLote` una vez por empresa — es el
 *     contrato explícito que A6 dejó escrito para A7 (docs/reportes/ola1-a6.md
 *     §4.4): esta función nunca acepta un `companyId` por ítem.
 *  2. Corrección + reproceso (V-7/V-8): guarda la corrección de AIU y/o de
 *     municipio y pide el reproceso en la MISMA transacción de la empresa
 *     correspondiente — para el usuario es una sola decisión.
 *
 * El `userId` de cada aprobación/corrección se lee SIEMPRE de
 * `app.current_user_id()` dentro de la propia sesión ya verificada — nunca de
 * un campo de formulario que el cliente pudiera fijar (D-020/D-021): un
 * `<input type="hidden" name="userId">` sería, literalmente, dejar que el
 * cliente elija a nombre de quién aprueba.
 *
 * V-11 (Ola 2, cierre correctivo antes de la Ola 3): la resolución de la IP
 * de origen (`resolverIpDeOrigen`) y su error de dominio
 * (`IpNoDisponibleError`) viven en `./ip`, NO aquí. Este archivo lleva
 * `"use server"`, y Next.js exige que TODO lo que exporte un módulo
 * `"use server"` sea una función `async` — una clase y una función síncrona
 * exportadas desde aquí invalidan el módulo entero (así se rompió
 * `npx next build` la primera vez). Este archivo solo IMPORTA esas dos
 * piezas y las usa; no las exporta.
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { conSesionEmpresa } from '../lib/sesion';
import {
  aprobarAsientosEnLote,
  editarAsientoBorrador,
  type EdicionLineaBorrador,
  type ItemLoteAprobacion,
} from '../../src/services/causacion';
import {
  archivarDocumentoRechazado,
  guardarCorreccionAiu,
  guardarCorreccionMunicipio,
  reintegrarDocumentoRechazado,
  reprocesarDocumento,
} from '../../src/services/bandeja';
import type { SqlClient } from '../../src/db/types';
import { resolverIpDeOrigen } from './ip';

async function ipYUserAgent(): Promise<{ ip: string; userAgent: string | null }> {
  const cabeceras = await headers();
  return { ip: resolverIpDeOrigen(cabeceras), userAgent: cabeceras.get('user-agent') };
}

async function userIdDeSesion(tx: SqlClient): Promise<string> {
  const { rows } = await tx.query<{ id: string | null }>('SELECT app.current_user_id() AS id');
  const id = rows[0]?.id;
  if (!id) throw new Error('No hay usuario en la sesión actual.');
  return id;
}

/** `sel` llega como `companyId::journalEntryId` — una fila de la tabla puede
 * ser de cualquiera de las 30-60 empresas de la bandeja consolidada. */
function agruparPorEmpresa(formData: FormData): Map<string, string[]> {
  const porEmpresa = new Map<string, string[]>();
  for (const valor of formData.getAll('sel')) {
    if (typeof valor !== 'string') continue;
    const [companyId, journalEntryId] = valor.split('::');
    if (!companyId || !journalEntryId) continue;
    const lista = porEmpresa.get(companyId) ?? [];
    lista.push(journalEntryId);
    porEmpresa.set(companyId, lista);
  }
  return porEmpresa;
}

async function aprobarOResolverLote(formData: FormData, decision: ItemLoteAprobacion['decision']): Promise<void> {
  const porEmpresa = agruparPorEmpresa(formData);
  const motivo = decision === 'aprobado' ? null : 'Rechazado en bandeja de aprobación en lote.';

  // V-11: se resuelve la IP ANTES de abrir ninguna sesión de empresa. Si
  // falta, se corta aquí con el mensaje de negocio — ninguna empresa del
  // lote llega a intentar un INSERT en `approval` sin IP.
  let ip: string;
  let userAgent: string | null;
  try {
    ({ ip, userAgent } = await ipYUserAgent());
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    redirect(`/bandeja?error=${encodeURIComponent(mensaje)}`);
  }

  const errores: string[] = [];
  for (const [companyId, journalEntryIds] of porEmpresa) {
    try {
      await conSesionEmpresa(companyId, async (tx) => {
        const userId = await userIdDeSesion(tx);
        const resultado = await aprobarAsientosEnLote(tx, {
          items: journalEntryIds.map((journalEntryId) => ({ journalEntryId, decision, motivo })),
          userId,
          ip,
          userAgent,
        });
        for (const r of resultado.resultados) {
          if ('error' in r) errores.push(`${r.journalEntryId}: ${r.error}`);
        }
      });
    } catch (error) {
      // Una empresa fallando (permiso insuficiente, sesión vencida) no debe
      // impedir que se reporten los resultados de las demás — el mismo
      // espíritu de "un fallo no aborta el lote" que ya tiene A6 por ítem,
      // aplicado aquí por empresa.
      errores.push(`${companyId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const qs = errores.length > 0 ? `?error=${encodeURIComponent(errores.join(' | '))}` : '';
  redirect(`/bandeja${qs}`);
}

/** Aprueba (y publica) todas las filas seleccionadas de todas las empresas de un golpe. */
export async function aprobarSeleccionAction(formData: FormData): Promise<void> {
  await aprobarOResolverLote(formData, 'aprobado');
}

/** Rechaza (anula el borrador) todas las filas seleccionadas. */
export async function rechazarSeleccionAction(formData: FormData): Promise<void> {
  await aprobarOResolverLote(formData, 'rechazado');
}

function leer(fd: FormData, campo: string): string {
  const v = fd.get(campo);
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * V-7 + V-8 combinadas: guarda el AIU de las líneas que el humano llenó, y/o
 * el municipio corregido, y pide el reproceso — una sola decisión, un solo
 * permiso (`documento.reprocesar`, exigido dentro de cada función).
 */
export async function corregirYReprocesarAction(formData: FormData): Promise<void> {
  const companyId = leer(formData, 'companyId');
  const sourceDocumentId = leer(formData, 'sourceDocumentId');
  const motivo = leer(formData, 'motivo');
  const municipioOperacionId = leer(formData, 'municipioOperacionId');

  try {
    await conSesionEmpresa(companyId, async (tx) => {
      let huboCorreccion = false;

      for (const [campo, valor] of formData.entries()) {
        const m = /^aiuLinea_(\d+)$/.exec(campo);
        if (!m || typeof valor !== 'string' || valor.trim() === '') continue;
        const lineaNumero = Number(m[1]);
        const pesos = Number(valor);
        if (!Number.isFinite(pesos) || pesos < 0) continue;
        await guardarCorreccionAiu(tx, {
          sourceDocumentId,
          lineaNumero,
          valorAiuCentavos: Math.round(pesos) * 100,
          motivo: motivo || 'AIU capturado desde la bandeja de revisión (V-7).',
        });
        huboCorreccion = true;
      }

      if (municipioOperacionId) {
        await guardarCorreccionMunicipio(tx, {
          sourceDocumentId,
          municipioOperacionId,
          motivo: motivo || 'Municipio de la operación corregido desde la bandeja de revisión (V-8).',
        });
        huboCorreccion = true;
      }

      if (huboCorreccion) {
        await reprocesarDocumento(tx, sourceDocumentId);
      }
    });
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    redirect(`/bandeja?error=${encodeURIComponent(mensaje)}`);
  }

  redirect('/bandeja');
}

// =============================================================================
// A7 · D-079 — edición de línea de un asiento borrador
//
// La UI manda TODAS las líneas del asiento: por cada `journal_line` un
// `cuenta__<id>` (código PUC) y un `monto__<id>` (en pesos). El descuadre se
// bloquea en el servicio (`editarAsientoBorrador`), no solo en la interfaz —
// el trigger de publicación es el respaldo final (D-079, verificado por A14).
// =============================================================================

/** Pesos con hasta dos decimales -> centavos enteros (Regla de Oro 5). */
function pesosACentavos(valor: string): string {
  const limpio = valor.replace(/[^\d.-]/g, '').trim();
  if (limpio === '' || !/^-?\d+(\.\d{1,2})?$/.test(limpio)) return '';
  return String(Math.round(Number(limpio) * 100));
}

export async function editarLineaAction(formData: FormData): Promise<void> {
  const companyId = leer(formData, 'companyId');
  const journalEntryId = leer(formData, 'journalEntryId');
  const justificacion = leer(formData, 'justificacion');

  const lineas: EdicionLineaBorrador[] = [];
  for (const [campo, valor] of formData.entries()) {
    const m = /^cuenta__(.+)$/.exec(campo);
    if (!m || typeof valor !== 'string') continue;
    const journalLineId = m[1]!;
    const montoRaw = formData.get(`monto__${journalLineId}`);
    const montoCentavos = pesosACentavos(typeof montoRaw === 'string' ? montoRaw : '');
    if (montoCentavos === '') {
      redirect(
        `/bandeja?error=${encodeURIComponent(
          `El monto de una de las líneas no es un número de pesos válido (máximo dos decimales).`,
        )}`,
      );
    }
    lineas.push({ journalLineId, cuentaCodigo: valor.trim(), montoCentavos });
  }

  try {
    await conSesionEmpresa(companyId, async (tx) => {
      await editarAsientoBorrador(tx, { journalEntryId, lineas, justificacion });
    });
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    redirect(`/bandeja?error=${encodeURIComponent(mensaje)}`);
  }

  redirect('/bandeja?editado=1');
}

// =============================================================================
// A7 · D-079 — sub-bandeja de rechazadas
// =============================================================================

export async function reprocesarRechazadaAction(formData: FormData): Promise<void> {
  const companyId = leer(formData, 'companyId');
  const sourceDocumentId = leer(formData, 'sourceDocumentId');

  try {
    await conSesionEmpresa(companyId, (tx) => reintegrarDocumentoRechazado(tx, sourceDocumentId));
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    redirect(`/bandeja?vista=rechazadas&error=${encodeURIComponent(mensaje)}`);
  }

  redirect('/bandeja?vista=rechazadas&reprocesado=1');
}

export async function archivarRechazadaAction(formData: FormData): Promise<void> {
  const companyId = leer(formData, 'companyId');
  const sourceDocumentId = leer(formData, 'sourceDocumentId');
  const motivo = leer(formData, 'motivo');
  const confirmacion = leer(formData, 'confirmacion');

  if (confirmacion !== 'ARCHIVAR') {
    redirect(
      `/bandeja?vista=rechazadas&error=${encodeURIComponent(
        'Para archivar hay que escribir ARCHIVAR en el campo de confirmación.',
      )}`,
    );
  }

  try {
    await conSesionEmpresa(companyId, (tx) =>
      archivarDocumentoRechazado(tx, sourceDocumentId, motivo),
    );
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    redirect(`/bandeja?vista=rechazadas&error=${encodeURIComponent(mensaje)}`);
  }

  redirect('/bandeja?vista=rechazadas&archivado=1');
}

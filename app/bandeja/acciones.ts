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
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { conSesionEmpresa } from '../lib/sesion.js';
import { aprobarAsientosEnLote, type ItemLoteAprobacion } from '../../src/services/causacion.js';
import { guardarCorreccionAiu, guardarCorreccionMunicipio, reprocesarDocumento } from '../../src/services/bandeja.js';
import type { SqlClient } from '../../src/db/types.js';

async function ipYUserAgent(): Promise<{ ip: string | null; userAgent: string | null }> {
  const cabeceras = await headers();
  return {
    ip: (cabeceras.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null,
    userAgent: cabeceras.get('user-agent'),
  };
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
  const { ip, userAgent } = await ipYUserAgent();
  const motivo = decision === 'aprobado' ? null : 'Rechazado en bandeja de aprobación en lote.';

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

'use server';

/**
 * A8 — Registrar una vigencia nueva de atributos fiscales de un tercero
 * (cierre de V-17). Mismo flujo de dos pasos que `parametrizacion.ts`:
 * `simularAction` solo calcula impacto, `confirmarAction` es la única que
 * escribe (sección 6.2, punto 6).
 */
import { redirect } from 'next/navigation';
import { conSesion } from '../../../lib/sesion';
import {
  registrarAtributosFiscales,
  simularImpactoAtributosFiscales,
  AtributoFiscalIncompletoError,
  EdicionRetroactivaError,
  NormaDeRespaldoRequeridaError,
  TerceroNoEncontradoError,
  VigenciaInvalidaError,
  type FuenteAtributoFiscal,
  type RegimenTributario,
} from '../../../../src/services/terceros';
import { isPostgresError, SQLSTATE } from '../../../../src/db/types';

function leer(fd: FormData, campo: string): string {
  const v = fd.get(campo);
  return typeof v === 'string' ? v.trim() : '';
}

/** 'si' | 'no' | '' (nada marcado) -> boolean | undefined. `undefined`
 * dispara `AtributoFiscalIncompletoError` en el servicio: nunca se traduce
 * "nada marcado" a `false`. */
function leerBanderaFiscal(fd: FormData, campo: string): boolean | undefined {
  const v = leer(fd, campo);
  if (v === 'si') return true;
  if (v === 'no') return false;
  return undefined;
}

const CAMPOS_BANDERA = [
  'esDeclaranteRenta',
  'esAutorretenedorRenta',
  'esGranContribuyente',
  'esRegimenSimple',
  'esResponsableIva',
  'esAgenteRetencionRenta',
  'esAgenteRetencionIva',
  'esAgenteRetencionIca',
  'esAutorretenedorIca',
] as const;

function leerBanderas(fd: FormData): Record<(typeof CAMPOS_BANDERA)[number], boolean | undefined> {
  const salida = {} as Record<(typeof CAMPOS_BANDERA)[number], boolean | undefined>;
  for (const campo of CAMPOS_BANDERA) salida[campo] = leerBanderaFiscal(fd, campo);
  return salida;
}

/** Para propagar por querystring entre el paso de simular y el de confirmar:
 * boolean | undefined -> 'si' | 'no' | ''. */
function banderasComoTexto(b: Record<string, boolean | undefined>): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const [k, v] of Object.entries(b)) salida[k] = v === undefined ? '' : v ? 'si' : 'no';
  return salida;
}

function mensajeDeError(e: unknown): string {
  if (
    e instanceof AtributoFiscalIncompletoError ||
    e instanceof EdicionRetroactivaError ||
    e instanceof NormaDeRespaldoRequeridaError ||
    e instanceof TerceroNoEncontradoError ||
    e instanceof VigenciaInvalidaError
  ) {
    return e.message;
  }
  if (isPostgresError(e) && e.code === SQLSTATE.PERMISO_INSUFICIENTE) {
    return 'Su sesión no tiene permiso para editar atributos fiscales (se requiere "tercero.atributos_fiscales").';
  }
  return e instanceof Error ? e.message : 'Ocurrió un error inesperado guardando el atributo fiscal.';
}

function base(terceroId: string): string {
  return `/terceros/${terceroId}/atributos-fiscales`;
}

export async function simularAction(formData: FormData): Promise<void> {
  const terceroId = leer(formData, 'terceroId');
  const banderas = leerBanderas(formData);
  const campos = {
    regimenTributario: leer(formData, 'regimenTributario') || 'ordinario',
    vigenteDesde: leer(formData, 'vigenteDesde'),
    normaRespaldo: leer(formData, 'normaRespaldo'),
    fuente: leer(formData, 'fuente') || 'declarado_por_cliente',
    notas: leer(formData, 'notas'),
  };

  let destino: string;
  try {
    for (const campo of CAMPOS_BANDERA) {
      if (banderas[campo] === undefined) {
        throw new AtributoFiscalIncompletoError(campo);
      }
    }
    const impacto = await conSesion((tx) => simularImpactoAtributosFiscales(tx, terceroId));
    const qs = new URLSearchParams({
      confirmar: '1',
      terceroId,
      ...banderasComoTexto(banderas),
      ...campos,
      documentosPendientes: String(impacto.documentosPendientes),
      asientosPublicados: String(impacto.asientosPublicados),
    });
    destino = `${base(terceroId)}?${qs.toString()}`;
  } catch (e) {
    const qs = new URLSearchParams({ error: mensajeDeError(e) });
    destino = `${base(terceroId)}?${qs.toString()}`;
  }
  redirect(destino);
}

export async function confirmarAction(formData: FormData): Promise<void> {
  const terceroId = leer(formData, 'terceroId');
  const banderas = leerBanderas(formData);
  const campos = {
    regimenTributario: leer(formData, 'regimenTributario') as RegimenTributario,
    vigenteDesde: leer(formData, 'vigenteDesde'),
    normaRespaldo: leer(formData, 'normaRespaldo'),
    fuente: leer(formData, 'fuente'),
    notas: leer(formData, 'notas'),
  };

  let destino: string;
  try {
    await conSesion((tx) =>
      registrarAtributosFiscales(tx, {
        terceroId,
        ...banderas,
        regimenTributario: campos.regimenTributario,
        vigenteDesde: campos.vigenteDesde,
        normaRespaldo: campos.normaRespaldo,
        fuente: (campos.fuente || 'declarado_por_cliente') as FuenteAtributoFiscal,
        notas: campos.notas || null,
      }),
    );
    destino = `/terceros/${terceroId}?ok=1`;
  } catch (e) {
    destino = `${base(terceroId)}?error=${encodeURIComponent(mensajeDeError(e))}`;
  }
  redirect(destino);
}

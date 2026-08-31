'use server';

/**
 * A8 — Acción de servidor para crear un tercero (cierre de V-17). Un solo
 * paso: el maestro de datos base NO está versionado, así que no hace falta
 * el simulador de impacto (eso es para los atributos fiscales y la
 * actividad económica, que sí tienen consecuencia tributaria — ver
 * `/terceros/[id]/atributos-fiscales` y `/terceros/[id]/actividades`).
 */
import { redirect } from 'next/navigation';
import { conSesion } from '../../lib/sesion';
import { crearTercero, TerceroInvalidoError, type TipoDocumentoTercero } from '../../../src/services/terceros';
import { isPostgresError, SQLSTATE } from '../../../src/db/types';

function leer(fd: FormData, campo: string): string {
  const v = fd.get(campo);
  return typeof v === 'string' ? v.trim() : '';
}

function mensajeDeError(e: unknown): string {
  if (e instanceof TerceroInvalidoError) return e.message;
  if (isPostgresError(e) && e.code === SQLSTATE.PERMISO_INSUFICIENTE) {
    return 'Su sesión no tiene permiso para crear terceros (se requiere el permiso "tercero.editar").';
  }
  if (isPostgresError(e) && e.code === SQLSTATE.UNIQUE_VIOLATION) {
    return 'Ya existe un tercero con ese tipo y número de documento en esta empresa.';
  }
  return e instanceof Error ? e.message : 'Ocurrió un error inesperado creando el tercero.';
}

export async function crearAction(formData: FormData): Promise<void> {
  const esDelExterior = leer(formData, 'esDelExterior') === 'true';
  const campos = {
    tipoDocumento: (leer(formData, 'tipoDocumento') || 'NIT') as TipoDocumentoTercero,
    numeroDocumento: leer(formData, 'numeroDocumento'),
    digitoVerificacion: leer(formData, 'digitoVerificacion'),
    tipoPersona: (leer(formData, 'tipoPersona') || 'juridica') as 'natural' | 'juridica',
    razonSocial: leer(formData, 'razonSocial'),
    direccion: leer(formData, 'direccion'),
    municipalityId: leer(formData, 'municipalityId'),
    pais: leer(formData, 'pais') || 'CO',
    email: leer(formData, 'email'),
    telefono: leer(formData, 'telefono'),
  };

  let destino: string;
  try {
    const { id } = await conSesion((tx) =>
      crearTercero(tx, {
        tipoDocumento: campos.tipoDocumento,
        numeroDocumento: campos.numeroDocumento,
        digitoVerificacion: campos.digitoVerificacion ? Number(campos.digitoVerificacion) : null,
        tipoPersona: campos.tipoPersona,
        razonSocial: campos.razonSocial,
        direccion: esDelExterior ? null : campos.direccion,
        municipalityId: esDelExterior ? null : campos.municipalityId || null,
        pais: esDelExterior ? campos.pais : 'CO',
        esDelExterior,
        email: campos.email || null,
        telefono: campos.telefono || null,
      }),
    );
    destino = `/terceros/${id}?ok=1`;
  } catch (e) {
    const qs = new URLSearchParams({ ...campos, esDelExterior: String(esDelExterior), error: mensajeDeError(e) });
    destino = `/terceros/nuevo?${qs.toString()}`;
  }
  redirect(destino);
}

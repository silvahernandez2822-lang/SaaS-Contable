/**
 * A11 — Identificación de terceros para exógena, y el bloqueo del Formato
 * 1001 (dirección y código de departamento/municipio, art. 1.3.5.2.1 Res.
 * 000227/2025). Este archivo NO rellena esos dos campos con ningún valor por
 * defecto cuando faltan: los deja `null` y los reporta en
 * `tercerosIncompletos` para que el llamador decida qué hacer (bloquear la
 * presentación, avisar al contador, o ambos).
 */
import type { SqlClient } from '../../db/types';
import type { IdentificacionTercero, TerceroIncompleto } from './tipos';

interface FilaTerceroSql {
  id: string;
  tipo_documento: string;
  numero_documento: string;
  digito_verificacion: number | null;
  primer_apellido: string | null;
  segundo_apellido: string | null;
  primer_nombre: string | null;
  otros_nombres: string | null;
  razon_social: string;
  tipo_persona: 'natural' | 'juridica';
  direccion: string | null;
  codigo_dane: string | null;
  codigo_dane_departamento: string | null;
  pais: string;
  es_del_exterior: boolean;
}

const SELECT_TERCERO = `
  SELECT
    tp.id, tp.tipo_documento, tp.numero_documento, tp.digito_verificacion,
    tp.primer_apellido, tp.segundo_apellido, tp.primer_nombre, tp.otros_nombres,
    tp.razon_social, tp.tipo_persona, tp.direccion, tp.codigo_dane,
    m.codigo_dane_departamento, tp.pais, tp.es_del_exterior
  FROM third_party tp
  LEFT JOIN municipality m ON m.id = tp.municipality_id
`;

function aIdentificacion(f: FilaTerceroSql): IdentificacionTercero {
  return {
    terceroId: f.id,
    tipoDocumento: f.tipo_documento,
    numeroDocumento: f.numero_documento,
    digitoVerificacion: f.digito_verificacion,
    primerApellido: f.primer_apellido,
    segundoApellido: f.segundo_apellido,
    primerNombre: f.primer_nombre,
    otrosNombres: f.otros_nombres,
    razonSocial: f.razon_social,
    tipoPersona: f.tipo_persona,
    direccion: f.direccion,
    codigoDepartamento: f.codigo_dane_departamento,
    codigoMunicipio: f.codigo_dane,
    pais: f.pais,
    esDelExterior: f.es_del_exterior,
  };
}

/** Un tercero por id, o `null` si no existe (o RLS lo oculta). */
export async function identificacionTercero(
  tx: SqlClient,
  terceroId: string,
): Promise<IdentificacionTercero | null> {
  const { rows } = await tx.query<FilaTerceroSql>(`${SELECT_TERCERO} WHERE tp.id = $1`, [terceroId]);
  const fila = rows[0];
  return fila ? aIdentificacion(fila) : null;
}

/** Todos los terceros de la empresa en sesión, indexados por id. */
export async function identificacionTercerosPorId(
  tx: SqlClient,
  terceroIds: readonly string[],
): Promise<Map<string, IdentificacionTercero>> {
  if (terceroIds.length === 0) return new Map();
  const { rows } = await tx.query<FilaTerceroSql>(`${SELECT_TERCERO} WHERE tp.id = ANY($1::uuid[])`, [
    terceroIds,
  ]);
  const mapa = new Map<string, IdentificacionTercero>();
  for (const f of rows) mapa.set(f.id, aIdentificacion(f));
  return mapa;
}

/**
 * BLOQUEO del Formato 1001 (art. 1.3.5.2.1 Res. 000227/2025): dirección y
 * código de departamento/municipio del informado. `es_del_exterior = true`
 * no exige municipio colombiano (el propio esquema lo prohíbe, ver
 * `third_party_exterior_ck` en 005_terceros.sql) así que esos terceros no se
 * marcan por falta de municipio, solo por falta de dirección.
 */
export function tercerosIncompletosParaFormato1001(
  terceros: readonly IdentificacionTercero[],
): TerceroIncompleto[] {
  const incompletos: TerceroIncompleto[] = [];
  for (const t of terceros) {
    const faltaDireccion = t.direccion === null || t.direccion.trim() === '';
    const faltaMunicipio = !t.esDelExterior && (t.codigoMunicipio === null || t.codigoDepartamento === null);
    if (faltaDireccion || faltaMunicipio) {
      incompletos.push({
        terceroId: t.terceroId,
        numeroDocumento: t.numeroDocumento,
        razonSocial: t.razonSocial,
        faltaDireccion,
        faltaMunicipio,
      });
    }
  }
  return incompletos;
}

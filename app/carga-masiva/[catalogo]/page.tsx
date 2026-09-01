/**
 * A16 — Pantalla de carga de UN catálogo (Ola 4, Tarea 3).
 *
 * La tabla de columnas que se ve aquí es LA MISMA `DEFINICIONES` que valida el
 * archivo y que genera la plantilla. No hay una segunda descripción de las
 * columnas que pueda quedarse vieja: si el importador cambia, esta pantalla
 * cambia con él.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { conSesion } from '../../lib/sesion';
import { tienePermiso } from '../../../src/auth/permisos';
import { definicionPorClave } from '../../../src/services/carga-masiva/definiciones';
import { FormularioCarga } from './_formulario';

export const dynamic = 'force-dynamic';

export default async function PaginaCargarCatalogo({ params }: { params: Promise<{ catalogo: string }> }) {
  const { catalogo } = await params;
  const definicion = definicionPorClave(catalogo);
  if (!definicion) notFound();

  const puede = await conSesion((tx) => tienePermiso(tx, definicion.permiso));

  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: '24px' }}>
      <h1>Cargar {definicion.titulo}</h1>
      <p>{definicion.descripcion}</p>
      <p>
        Tabla del sistema: <code>{definicion.tabla}</code> · Módulo:{' '}
        <Link href={definicion.moduloRuta}>{definicion.modulo}</Link> ·{' '}
        <a href={`/api/plantillas/${definicion.clave}`}>Descargar la plantilla .xlsx</a>
      </p>

      {definicion.requierePrevio && definicion.requierePrevio.length > 0 && (
        <p style={{ border: '1px solid #b45309', background: '#fffbeb', padding: '10px 14px' }}>
          <strong>Cargue antes estos catálogos:</strong>{' '}
          {definicion.requierePrevio.map((clave, i) => (
            <span key={clave}>
              {i > 0 && ', '}
              <Link href={`/carga-masiva/${clave}`}>{clave}</Link>
            </span>
          ))}
          . Sin ellos, las filas de este archivo no encuentran a qué referirse y se rechazan todas.
        </p>
      )}

      {(definicion.advertencias ?? []).map((a) => (
        <p key={a} role="note" style={{ color: '#b91c1c' }}>
          {a}
        </p>
      ))}

      {!puede ? (
        <p role="alert" style={{ border: '1px solid #b91c1c', padding: '10px 14px' }}>
          Su sesión no tiene el permiso <code>{definicion.permiso}</code>, que es el que exige el motor para
          escribir en <code>{definicion.tabla}</code>. Puede descargar la plantilla y prepararla, pero la carga
          la tiene que hacer alguien con ese permiso. Pídaselo al administrador de la firma en{' '}
          <Link href="/admin/usuarios">Administración</Link>.
        </p>
      ) : (
        <FormularioCarga clave={definicion.clave} titulo={definicion.titulo} />
      )}

      <h2>Columnas que espera este archivo</h2>
      <table style={{ borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #cbd5e1' }}>
            <th style={{ padding: 4 }}>Columna</th>
            <th style={{ padding: 4, width: 110 }}>¿Obligatoria?</th>
            <th style={{ padding: 4 }}>Qué espera</th>
            <th style={{ padding: 4 }}>Valores válidos</th>
            <th style={{ padding: 4, width: 130 }}>Ejemplo</th>
          </tr>
        </thead>
        <tbody>
          {definicion.columnas.map((c) => (
            <tr key={c.nombre} style={{ borderBottom: '1px solid #e2e8f0', verticalAlign: 'top' }}>
              <td style={{ padding: 4 }}>
                <code style={{ color: c.obligatoria ? '#b91c1c' : '#1f4e79' }}>
                  {c.nombre}
                  {c.obligatoria ? ' *' : ''}
                </code>
              </td>
              <td style={{ padding: 4, color: c.obligatoria ? '#b91c1c' : '#1f4e79' }}>
                {c.obligatoria ? 'OBLIGATORIA' : 'opcional'}
              </td>
              <td style={{ padding: 4 }}>{c.descripcion}</td>
              <td style={{ padding: 4 }}>
                {c.valores ? `Uno de: ${c.valores.join(', ')}` : (c.origen ?? '—')}
              </td>
              <td style={{ padding: 4 }}>
                <code>{c.ejemplo || '(vacío)'}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

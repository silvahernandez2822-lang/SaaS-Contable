/**
 * A16 — Pantalla de carga de UN catálogo (Ola 4, Tarea 3).
 *
 * La tabla de columnas que se ve aquí es LA MISMA `DEFINICIONES` que valida el
 * archivo y que genera la plantilla. No hay una segunda descripción de las
 * columnas que pueda quedarse vieja: si el importador cambia, esta pantalla
 * cambia con él.
 *
 * D-090 (A8): migrada al kit de `app/_ui/` (`Panel`, `Tabla`, `MensajeEstado`).
 * El acceso a `/carga-masiva` (la portada) lo filtra `carga_masiva.acceder`;
 * esta subpágina, al entrarse por URL directa, se protege con el mismo
 * permiso — no tendría sentido que la portada lo exigiera y la subpágina de
 * cada catálogo no.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { conSesion } from '../../lib/sesion';
import { tienePermiso, PERMISOS } from '../../../src/auth/permisos';
import { definicionPorClave } from '../../../src/services/carga-masiva/definiciones';
import { Encabezado, MensajeEstado, Panel, Tabla, Td, Th } from '../../_ui/componentes';
import { FormularioCarga } from './_formulario';

export const dynamic = 'force-dynamic';

export default async function PaginaCargarCatalogo({ params }: { params: Promise<{ catalogo: string }> }) {
  const { catalogo } = await params;
  const definicion = definicionPorClave(catalogo);
  if (!definicion) notFound();

  const { puedeAcceder, puedeCargar } = await conSesion(async (tx) => ({
    puedeAcceder: await tienePermiso(tx, PERMISOS.CARGA_MASIVA_ACCEDER),
    puedeCargar: await tienePermiso(tx, definicion.permiso),
  }));

  if (!puedeAcceder) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-8">
        <Encabezado titulo={`Cargar ${definicion.titulo}`} />
        <MensajeEstado tipo="configuracion" titulo="Falta el permiso para entrar a este módulo">
          Se necesita <code>{PERMISOS.CARGA_MASIVA_ACCEDER}</code>. Pídaselo al administrador de la firma.
        </MensajeEstado>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <Encabezado
        titulo={`Cargar ${definicion.titulo}`}
        descripcion={definicion.descripcion}
        acciones={
          <Link
            className="text-menor font-semibold text-primario underline dark:text-primario-tinta-oscura"
            href="/carga-masiva"
          >
            Volver a Carga masiva
          </Link>
        }
      />

      <p className="mb-4 text-menor text-texto-suave">
        Tabla del sistema: <code className="font-mono">{definicion.tabla}</code> · Módulo:{' '}
        <Link className="font-medium text-primario underline dark:text-primario-tinta-oscura" href={definicion.moduloRuta}>
          {definicion.modulo}
        </Link>{' '}
        ·{' '}
        <a
          className="font-medium text-primario underline dark:text-primario-tinta-oscura"
          href={`/api/plantillas/${definicion.clave}`}
        >
          Descargar la plantilla .xlsx
        </a>
      </p>

      {definicion.requierePrevio && definicion.requierePrevio.length > 0 && (
        <div className="mb-4">
          <MensajeEstado tipo="configuracion" titulo="Cargue antes estos catálogos">
            {definicion.requierePrevio.map((clave, i) => (
              <span key={clave}>
                {i > 0 && ', '}
                <Link className="font-semibold underline" href={`/carga-masiva/${clave}`}>
                  {clave}
                </Link>
              </span>
            ))}
            . Sin ellos, las filas de este archivo no encuentran a qué referirse y se rechazan todas.
          </MensajeEstado>
        </div>
      )}

      {(definicion.advertencias ?? []).map((a) => (
        <div key={a} className="mb-4">
          <MensajeEstado tipo="configuracion" titulo={a} />
        </div>
      ))}

      {!puedeCargar ? (
        <MensajeEstado tipo="error" titulo="Falta el permiso para cargar este catálogo">
          Su sesión no tiene el permiso <code>{definicion.permiso}</code>, que es el que exige el motor para
          escribir en <code>{definicion.tabla}</code>. Puede descargar la plantilla y prepararla, pero la carga la
          tiene que hacer alguien con ese permiso. Pídaselo al administrador de la firma en{' '}
          <Link className="font-semibold underline" href="/admin/usuarios">
            Administración
          </Link>
          .
        </MensajeEstado>
      ) : (
        <FormularioCarga clave={definicion.clave} titulo={definicion.titulo} />
      )}

      <Panel titulo="Columnas que espera este archivo" className="mt-6">
        <Tabla alturaMaxima={null}>
          <thead>
            <tr>
              <Th>Columna</Th>
              <Th>¿Obligatoria?</Th>
              <Th>Qué espera</Th>
              <Th>Valores válidos</Th>
              <Th>Ejemplo</Th>
            </tr>
          </thead>
          <tbody>
            {definicion.columnas.map((c) => (
              <tr key={c.nombre} className="border-t border-borde/60 align-top">
                <Td>
                  <code className={c.obligatoria ? 'font-mono text-error-tinta' : 'font-mono text-primario'}>
                    {c.nombre}
                    {c.obligatoria ? ' *' : ''}
                  </code>
                </Td>
                <Td className={c.obligatoria ? 'text-error-tinta' : 'text-primario'}>
                  {c.obligatoria ? 'OBLIGATORIA' : 'opcional'}
                </Td>
                <Td>{c.descripcion}</Td>
                <Td>{c.valores ? `Uno de: ${c.valores.join(', ')}` : (c.origen ?? '—')}</Td>
                <Td>
                  <code className="font-mono">{c.ejemplo || '(vacío)'}</code>
                </Td>
              </tr>
            ))}
          </tbody>
        </Tabla>
      </Panel>
    </main>
  );
}

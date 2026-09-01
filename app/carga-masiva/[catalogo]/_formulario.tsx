'use client';

/**
 * A16 — Formulario de carga y presentación del informe (Ola 4, Tarea 3).
 *
 * Es un componente de CLIENTE porque el informe de errores no cabe en una
 * `query string`: son hasta cientos de filas con su número, su columna y su
 * motivo. `useActionState` deja que la acción de servidor DEVUELVA ese informe
 * y se pinte aquí, sin inventar un almacén intermedio ni recortar la lista.
 *
 * LOS DOS BOTONES DEL INFORME SON LA DECISIÓN QUE EXIGE D-072: «corregir y
 * volver a subir» (no hace nada, es volver al formulario) o «cargar solo las
 * filas válidas», que reenvía el MISMO archivo con `soloValidas = 1`. El
 * segundo camino existe, pero hay que pedirlo: nunca ocurre solo.
 *
 * POR QUÉ HAY QUE VOLVER A ELEGIR EL ARCHIVO PARA LA SEGUNDA OPCIÓN: el
 * navegador no deja rellenar un `<input type="file">` por programa, y guardar
 * el archivo en el servidor entre las dos peticiones significaría escribir en
 * disco un archivo que el usuario todavía no ha aceptado cargar. Se prefiere
 * pedirle que lo vuelva a seleccionar.
 */
import { useActionState } from 'react';
import { cargarArchivoAction, type EstadoCarga } from '../acciones';

export function FormularioCarga({ clave, titulo }: { clave: string; titulo: string }) {
  const [estado, accion, enCurso] = useActionState<EstadoCarga | null, FormData>(cargarArchivoAction, null);

  return (
    <>
      <form action={accion} style={{ border: '1px solid #334155', padding: 16, marginTop: 16 }}>
        <input type="hidden" name="catalogo" value={clave} />
        <div>
          <label>
            <strong>Archivo de {titulo}</strong>{' '}
            <input type="file" name="archivo" accept=".xlsx,.xlsm,.csv" required />
          </label>
        </div>
        <p style={{ fontSize: 13, color: '#475569' }}>
          Se acepta la plantilla <code>.xlsx</code> o un <code>.csv</code> con los mismos encabezados. Máximo
          8 MB y 5.000 filas por archivo.
        </p>
        <button type="submit" disabled={enCurso}>
          {enCurso ? 'Validando y cargando…' : 'Validar y cargar'}
        </button>
      </form>

      {estado && <Informe clave={clave} estado={estado} accion={accion} enCurso={enCurso} />}
    </>
  );
}

function Informe({
  clave,
  estado,
  accion,
  enCurso,
}: {
  clave: string;
  estado: EstadoCarga;
  accion: (formData: FormData) => void;
  enCurso: boolean;
}) {
  const r = estado.resultado;
  return (
    <section
      role="status"
      style={{
        border: `1px solid ${estado.ok ? '#15803d' : '#b91c1c'}`,
        background: estado.ok ? '#f0fdf4' : '#fef2f2',
        padding: 16,
        marginTop: 16,
      }}
    >
      <h2 style={{ marginTop: 0, color: estado.ok ? '#15803d' : '#b91c1c' }}>
        {estado.ok ? 'Carga aplicada' : 'No se cargó nada'}
      </h2>
      <p>{estado.mensaje}</p>

      {r && (
        <ul>
          <li>Archivo: {r.archivo} (hoja «{r.hoja}»)</li>
          <li>Filas leídas: {r.filasLeidas}</li>
          <li>Filas válidas: {r.filasValidas}</li>
          <li>Filas con error: {r.filasConError}</li>
          <li>Filas guardadas: {r.filasInsertadas}</li>
          {r.columnasIgnoradas.length > 0 && (
            <li>
              Columnas del archivo que el importador no conoce y se ignoraron:{' '}
              {r.columnasIgnoradas.join(', ')}
            </li>
          )}
        </ul>
      )}

      {r && r.errores.length > 0 && (
        <>
          <h3>Filas con problema</h3>
          <div style={{ maxHeight: 360, overflowY: 'auto', border: '1px solid #fecaca', background: 'white' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: 'left', position: 'sticky', top: 0, background: '#fff1f2' }}>
                  <th style={{ width: 90, padding: 4 }}>Fila</th>
                  <th style={{ width: 200, padding: 4 }}>Columna</th>
                  <th style={{ padding: 4 }}>Motivo</th>
                </tr>
              </thead>
              <tbody>
                {r.errores.map((e, i) => (
                  <tr key={`${e.numeroFila}-${i}`} style={{ borderTop: '1px solid #fee2e2' }}>
                    <td style={{ padding: 4 }}>{e.numeroFila}</td>
                    <td style={{ padding: 4 }}>{e.columna ?? '—'}</td>
                    <td style={{ padding: 4 }}>{e.motivo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 13, color: '#475569' }}>
            El número de fila es el que ve en Excel: la 1 son los encabezados, así que la primera fila de datos
            es la 2.
          </p>

          {!estado.ok && r.filasValidas > 0 && (
            <form action={accion} style={{ marginTop: 12, borderTop: '1px solid #fecaca', paddingTop: 12 }}>
              <input type="hidden" name="catalogo" value={clave} />
              <input type="hidden" name="soloValidas" value="1" />
              <p>
                <strong>¿Cargar solo las {r.filasValidas} filas válidas?</strong> Las {r.filasConError} con error
                se quedarían sin cargar y tendría que subirlas después. Vuelva a elegir el mismo archivo:
              </p>
              <input type="file" name="archivo" accept=".xlsx,.xlsm,.csv" required />{' '}
              <button type="submit" disabled={enCurso}>
                Cargar solo las válidas
              </button>
            </form>
          )}
        </>
      )}
    </section>
  );
}

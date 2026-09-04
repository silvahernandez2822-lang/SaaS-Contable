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
 *
 * D-090 (A8): migrado al kit de `app/_ui/` (`Boton`, `Badge`, `MensajeEstado`,
 * `Tabla`/`Th`/`Td`) — mismo aspecto que el informe de
 * `app/parametros/ica-municipios/_carga-masiva.tsx` y el del modal genérico
 * `CargaMasiva.tsx`.
 */
import { useActionState } from 'react';
import { cargarArchivoAction, type EstadoCarga } from '../acciones';
import { Badge, Boton, Tabla, Td, Th } from '../../_ui/componentes';

export function FormularioCarga({ clave, titulo }: { clave: string; titulo: string }) {
  const [estado, accion, enCurso] = useActionState<EstadoCarga | null, FormData>(cargarArchivoAction, null);

  return (
    <div className="flex flex-col gap-4">
      <form action={accion} className="flex flex-col gap-3 rounded-[var(--radius-tarjeta)] border border-borde bg-superficie-elevada p-5">
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-texto">Archivo de {titulo}</span>
          <input type="file" name="archivo" accept=".xlsx,.xlsm,.csv" required className="text-[12px]" />
        </label>
        <input type="hidden" name="catalogo" value={clave} />
        <p className="text-metadata text-texto-suave">
          Se acepta la plantilla <code className="font-mono">.xlsx</code> o un <code className="font-mono">.csv</code>{' '}
          con los mismos encabezados. Máximo 8 MB y 5.000 filas por archivo.
        </p>
        <div>
          <Boton tipo="submit" disabled={enCurso}>
            {enCurso ? 'Validando y cargando…' : 'Validar y cargar'}
          </Boton>
        </div>
      </form>

      {estado && <Informe clave={clave} estado={estado} accion={accion} enCurso={enCurso} />}
    </div>
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
    <div className={`rounded-lg border p-4 ${estado.ok ? 'border-exito/40 bg-exito/8' : 'border-error/40 bg-error/8'}`} role="status">
      <p className="text-cuerpo font-semibold text-texto">{estado.ok ? 'Carga aplicada' : 'No se cargó nada'}</p>
      <p className="mt-1 text-menor text-texto-suave">{estado.mensaje}</p>

      {r && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-menor tabular-nums text-texto-suave">
            {r.archivo} · hoja «{r.hoja}» · {r.filasLeidas} filas
          </span>
          <Badge tono="exito">{r.filasValidas} válidas</Badge>
          <Badge tono={r.filasConError ? 'error' : 'neutro'}>{r.filasConError} con error</Badge>
          <Badge tono="neutro">{r.filasInsertadas} guardadas</Badge>
        </div>
      )}

      {r && r.columnasIgnoradas.length > 0 && (
        <p className="mt-2 text-metadata text-texto-suave">
          Columnas del archivo que el importador no conoce y se ignoraron: {r.columnasIgnoradas.join(', ')}
        </p>
      )}

      {r && r.errores.length > 0 && (
        <>
          <p className="mt-3 text-cuerpo font-semibold text-texto">Filas con problema</p>
          <div className="mt-2 rounded-md border border-borde">
            <Tabla alturaMaxima="24rem">
              <thead>
                <tr>
                  <Th>Fila</Th>
                  <Th>Columna</Th>
                  <Th>Motivo</Th>
                </tr>
              </thead>
              <tbody>
                {r.errores.map((e, i) => (
                  <tr key={`${e.numeroFila}-${i}`} className="border-t border-borde/60">
                    <Td numerico className="font-semibold text-error-tinta">{e.numeroFila}</Td>
                    <Td className="font-mono">{e.columna ?? '—'}</Td>
                    <Td className="text-texto-suave">{e.motivo}</Td>
                  </tr>
                ))}
              </tbody>
            </Tabla>
          </div>
          <p className="mt-2 text-metadata text-texto-suave">
            El número de fila es el que ve en Excel: la 1 son los encabezados, así que la primera fila de datos es
            la 2.
          </p>

          {!estado.ok && r.filasValidas > 0 && (
            <form action={accion} className="mt-3 border-t border-borde pt-3">
              <input type="hidden" name="catalogo" value={clave} />
              <input type="hidden" name="soloValidas" value="1" />
              <p className="text-menor text-texto">
                <strong>¿Cargar solo las {r.filasValidas} filas válidas?</strong> Las {r.filasConError} con error se
                quedarían sin cargar y tendría que subirlas después. Vuelva a elegir el mismo archivo:
              </p>
              <div className="mt-2 flex items-center gap-2">
                <input type="file" name="archivo" accept=".xlsx,.xlsm,.csv" required className="text-[12px]" />
                <Boton tipo="submit" variante="secundario" disabled={enCurso}>
                  Cargar solo las válidas
                </Boton>
              </div>
            </form>
          )}
        </>
      )}
    </div>
  );
}

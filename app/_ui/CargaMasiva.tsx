'use client';

/**
 * D-077 · Ola 5 (front) — Patrón reusable de CARGA MASIVA, conectado al
 * importador real.
 *
 * Migrado desde `app/diseno/_ui/CargaMasiva.tsx`, que simulaba la validación.
 * Aquí NO hay simulación: el modal llama a `cargarArchivoAction`
 * (`app/carga-masiva/acciones.ts`) con `useActionState`, exactamente la misma
 * acción de servidor que usa la pantalla `/carga-masiva/[catalogo]`. Todo el
 * archivo se importa dentro de un solo `conSesion` (una transacción): si una
 * fila falla, no se escribe nada (D-072).
 *
 * D-090 (A8): el diálogo PROPIO (`role="dialog"` a mano, sin Escape ni foco
 * atrapado) se cambió por el `Modal` genérico de `componentes.tsx` (D-087),
 * el mismo que usan el selector de dirección DIAN de Terceros y los modales
 * de `/parametros`: Escape, clic-fuera, foco atrapado real y devolución de
 * foco al cerrar. El informe de fila/columna/motivo ahora se pinta con
 * `Tabla`/`Th`/`Td` del kit, igual que `app/parametros/ica-municipios/
 * _carga-masiva.tsx` — mismo aspecto en los dos únicos lugares del producto
 * que hoy muestran ese informe. Solo cambió el envoltorio visual/de
 * accesibilidad: `useActionState`, el informe fila/columna/motivo, «cargar
 * solo las válidas» y el aviso de permiso faltante siguen intactos.
 *
 * Flujo: botón → modal → subir archivo → «Validar y cargar» → si hay filas con
 * error, informe completo (fila + columna + motivo) SIN haber escrito nada, y la
 * opción explícita de «cargar solo las válidas» (vuelve a pedir el archivo
 * porque el navegador no deja rellenar un `<input type=file>` por programa).
 *
 * NO AUTORIZA NADA. La empresa la fija la cookie de sesión ya verificada; el
 * permiso lo exige el trigger de la base sobre cada tabla. `puede` solo decide
 * si se muestra el formulario o el aviso de «pídeselo a un administrador».
 */
import { useActionState, useCallback, useState, type ReactNode } from 'react';
import { cargarArchivoAction, type EstadoCarga } from '../carga-masiva/acciones';
import { Badge, Boton, MensajeEstado, Modal, Tabla, Td, Th } from './componentes';
import { IconoSubir } from './iconos';

const FORMATOS = '.xlsx,.xlsm,.csv';

export function CargaMasiva({
  clave,
  titulo,
  descripcion,
  permiso,
  puede,
  disparador,
}: {
  /** Clave del catálogo en `DEFINICIONES` (p. ej. `third_party`, `account`). */
  clave: string;
  /** Nombre legible del catálogo, para títulos y para el nombre de la plantilla. */
  titulo: string;
  descripcion: ReactNode;
  /** Código del permiso que exige el motor, para el aviso cuando falta. */
  permiso?: string;
  /** Si la sesión tiene el permiso. Si es `false`, se muestra el aviso, no el form. */
  puede: boolean;
  /** Botón/enlace que abre el modal. Si se omite, se usa uno estándar. */
  disparador?: (abrir: () => void) => ReactNode;
}) {
  const [abierto, setAbierto] = useState(false);
  const [estado, accion, enCurso] = useActionState<EstadoCarga | null, FormData>(cargarArchivoAction, null);

  const abrir = useCallback(() => setAbierto(true), []);
  const cerrar = useCallback(() => setAbierto(false), []);

  const r = estado?.resultado ?? null;
  const puedeCargarSoloValidas = estado != null && !estado.ok && r != null && r.filasValidas > 0;

  return (
    <>
      {disparador ? (
        disparador(abrir)
      ) : (
        <Boton variante="secundario" onClick={abrir}>
          <IconoSubir width={15} height={15} />
          Cargar masivo
        </Boton>
      )}

      {abierto && (
        <Modal
          titulo={`Carga masiva · ${titulo}`}
          onCerrar={cerrar}
          ancho="max-w-2xl"
          pie={
            <Boton variante="fantasma" onClick={cerrar}>
              {estado?.ok ? 'Listo' : 'Cerrar'}
            </Boton>
          }
        >
          {!puede ? (
            <MensajeEstado tipo="configuracion" titulo="Falta el permiso para cargar este catálogo">
              Su sesión no tiene el permiso{' '}
              {permiso ? <code className="font-mono text-error-tinta">{permiso}</code> : 'necesario'}, que es el
              que exige el motor para escribir en este catálogo. Puede descargar la plantilla y prepararla, pero
              la carga la tiene que hacer alguien con ese permiso. Pídaselo al administrador de la firma.
            </MensajeEstado>
          ) : (
            <div className="flex flex-col gap-4">
              <p className="text-[13px] text-texto-suave">{descripcion}</p>

              <form action={accion} className="flex flex-col gap-3">
                <input type="hidden" name="catalogo" value={clave} />
                <label className="flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-borde bg-superficie px-4 py-8 text-center hover:border-primario">
                  <IconoSubir width={24} height={24} className="text-texto-suave" />
                  <span className="text-[13px] font-medium text-texto">Selecciona un archivo</span>
                  <span className="text-[11px] text-texto-suave">
                    Plantilla .xlsx o .csv con los mismos encabezados · máx. 8 MB y 5.000 filas
                  </span>
                  <input type="file" name="archivo" accept={FORMATOS} required className="mt-1 text-[12px]" />
                </label>
                <div className="flex items-center justify-between text-[12px]">
                  <a
                    href={`/api/plantillas/${clave}`}
                    className="font-medium text-primario underline dark:text-primario-tinta-oscura"
                  >
                    Descargar plantilla de {titulo}
                  </a>
                  <span className="text-texto-suave">Se validan todas las filas antes de escribir nada.</span>
                </div>
                <div className="flex justify-end">
                  <Boton tipo="submit" disabled={enCurso}>
                    {enCurso ? 'Validando y cargando…' : 'Validar y cargar'}
                  </Boton>
                </div>
              </form>

              {estado && (
                <div
                  role="status"
                  className={`rounded-lg border p-4 text-[13px] ${
                    estado.ok ? 'border-exito/40 bg-exito/8' : 'border-error/40 bg-error/8'
                  }`}
                >
                  <p className="font-semibold text-texto">
                    {estado.ok ? 'Carga aplicada' : 'No se cargó nada'}
                  </p>
                  <p className="mt-1 text-texto-suave">{estado.mensaje}</p>

                  {r && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="tabular-nums text-texto-suave">
                        {r.archivo} · hoja «{r.hoja}» · {r.filasLeidas} filas
                      </span>
                      <Badge tono="exito">{r.filasValidas} válidas</Badge>
                      <Badge tono={r.filasConError ? 'error' : 'neutro'}>{r.filasConError} con error</Badge>
                      <Badge tono="neutro">{r.filasInsertadas} guardadas</Badge>
                    </div>
                  )}

                  {r && r.columnasIgnoradas.length > 0 && (
                    <p className="mt-2 text-[12px] text-texto-suave">
                      Columnas que el importador no conoce y se ignoraron: {r.columnasIgnoradas.join(', ')}
                    </p>
                  )}

                  {r && r.errores.length > 0 && (
                    <div className="mt-3 rounded-md border border-borde">
                      <Tabla alturaMaxima="18rem">
                        <thead>
                          <tr>
                            <Th>Fila</Th>
                            <Th>Columna</Th>
                            <Th>Motivo</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {r.errores.map((e, i) => (
                            <tr key={`${e.numeroFila}-${i}`} className="border-t border-borde">
                              <Td numerico className="font-semibold text-error-tinta">
                                {e.numeroFila}
                              </Td>
                              <Td className="font-mono">{e.columna ?? '—'}</Td>
                              <Td className="text-texto-suave">{e.motivo}</Td>
                            </tr>
                          ))}
                        </tbody>
                      </Tabla>
                    </div>
                  )}

                  {r && r.errores.length > 0 && (
                    <p className="mt-2 text-[12px] text-texto-suave">
                      El número de fila es el de Excel: la 1 son los encabezados, la primera fila de datos es la 2.
                    </p>
                  )}

                  {puedeCargarSoloValidas && (
                    <form action={accion} className="mt-3 border-t border-borde pt-3">
                      <input type="hidden" name="catalogo" value={clave} />
                      <input type="hidden" name="soloValidas" value="1" />
                      <p className="text-[12px] text-texto">
                        <strong>¿Cargar solo las {r!.filasValidas} filas válidas?</strong> Las {r!.filasConError}{' '}
                        con error se quedan sin cargar. Vuelve a elegir el mismo archivo:
                      </p>
                      <div className="mt-2 flex items-center gap-2">
                        <input type="file" name="archivo" accept={FORMATOS} required className="text-[12px]" />
                        <Boton tipo="submit" variante="secundario" disabled={enCurso}>
                          Cargar solo las válidas
                        </Boton>
                      </div>
                    </form>
                  )}
                </div>
              )}
            </div>
          )}
        </Modal>
      )}
    </>
  );
}

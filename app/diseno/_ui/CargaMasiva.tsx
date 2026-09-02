'use client';

/**
 * D-075 · Ola 5 — Patrón reusable de CARGA MASIVA.
 *
 * Uno solo, para Terceros, PUC y Parámetros. Flujo: botón → modal de subida →
 * vista de resultado con filas válidas vs. con error (número de fila + campo +
 * motivo) → «cargar solo las válidas» bajo acción explícita.
 *
 * Refleja D-072 (validación en dos pasadas, informe completo antes de escribir
 * nada, «solo las válidas» solo si el humano lo pide): aquí es maqueta, pero el
 * contrato visual es el que la versión real debe cumplir.
 */
import { useCallback, useId, useRef, useState, type ReactNode } from 'react';
import { Badge, Boton } from './componentes';
import { IconoEquis, IconoSubir } from './iconos';

export type FilaError = { fila: number; campo: string; motivo: string };

export type ResultadoValidacion = {
  archivo: string;
  totalFilas: number;
  validas: number;
  errores: readonly FilaError[];
};

type Fase = 'subir' | 'resultado';

/** Simulación determinista de la validación en dos pasadas (sin backend). */
function validarSimulado(nombreArchivo: string, muestraErrores: readonly FilaError[]): ResultadoValidacion {
  const total = 40;
  return {
    archivo: nombreArchivo,
    totalFilas: total,
    validas: total - muestraErrores.length,
    errores: muestraErrores,
  };
}

export function CargaMasiva({
  catalogo,
  descripcion,
  formatos = '.xlsx, .csv',
  erroresDeMuestra,
  disparador,
}: {
  /** Nombre del catálogo, para títulos y para el nombre de la plantilla. */
  catalogo: string;
  descripcion: ReactNode;
  formatos?: string;
  /** Filas con error que devuelve la maqueta al «validar». */
  erroresDeMuestra: readonly FilaError[];
  /** Botón/enlace que abre el modal. Si se omite, se usa uno estándar. */
  disparador?: (abrir: () => void) => ReactNode;
}) {
  const [abierto, setAbierto] = useState(false);
  const [fase, setFase] = useState<Fase>('subir');
  const [resultado, setResultado] = useState<ResultadoValidacion | null>(null);
  const [nombreArchivo, setNombreArchivo] = useState('');
  const [cargadas, setCargadas] = useState<number | null>(null);
  const tituloId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const cerrar = useCallback(() => {
    setAbierto(false);
    setFase('subir');
    setResultado(null);
    setNombreArchivo('');
    setCargadas(null);
  }, []);

  const abrir = useCallback(() => setAbierto(true), []);

  const validar = useCallback(() => {
    const nombre = nombreArchivo || `${catalogo.toLowerCase().replace(/\s+/g, '-')}.xlsx`;
    setResultado(validarSimulado(nombre, erroresDeMuestra));
    setFase('resultado');
  }, [nombreArchivo, catalogo, erroresDeMuestra]);

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
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-texto/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby={tituloId}
        >
          <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-borde bg-superficie-elevada shadow-2xl">
            <header className="flex items-center justify-between border-b border-borde px-5 py-3">
              <h2 id={tituloId} className="text-[14px] font-semibold text-texto">
                Carga masiva · {catalogo}
              </h2>
              <button
                type="button"
                onClick={cerrar}
                aria-label="Cerrar"
                className="rounded p-1 text-texto-suave hover:bg-superficie"
              >
                <IconoEquis width={16} height={16} />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-auto p-5">
              {fase === 'subir' && (
                <div className="flex flex-col gap-4">
                  <p className="text-[13px] text-texto-suave">{descripcion}</p>
                  <button
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    className="flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-borde bg-superficie px-4 py-10 text-center hover:border-primario"
                  >
                    <IconoSubir width={24} height={24} className="text-texto-suave" />
                    <span className="text-[13px] font-medium text-texto">
                      {nombreArchivo || 'Selecciona o arrastra un archivo'}
                    </span>
                    <span className="text-[11px] text-texto-suave">Formatos aceptados: {formatos}</span>
                  </button>
                  <input
                    ref={inputRef}
                    type="file"
                    accept={formatos}
                    className="hidden"
                    onChange={(e) => setNombreArchivo(e.target.files?.[0]?.name ?? '')}
                  />
                  <div className="flex items-center justify-between text-[12px]">
                    <a href="#" className="font-medium text-primario underline dark:text-primario-tinta-oscura">
                      Descargar plantilla de {catalogo}
                    </a>
                    <span className="text-texto-suave">Se validan todas las filas antes de escribir nada.</span>
                  </div>
                </div>
              )}

              {fase === 'resultado' && resultado && cargadas === null && (
                <div className="flex flex-col gap-4">
                  <div className="flex flex-wrap items-center gap-2 text-[13px]">
                    <span className="tabular-nums text-texto-suave">
                      {resultado.archivo} · {resultado.totalFilas} filas
                    </span>
                    <Badge tono="exito">{resultado.validas} válidas</Badge>
                    <Badge tono={resultado.errores.length ? 'error' : 'neutro'}>
                      {resultado.errores.length} con error
                    </Badge>
                  </div>

                  {resultado.errores.length > 0 ? (
                    <div className="overflow-hidden rounded-md border border-borde">
                      <table className="w-full border-collapse text-[12px]">
                        <thead>
                          <tr className="bg-superficie text-left text-texto-suave">
                            <th className="px-3 py-2 font-medium">Fila</th>
                            <th className="px-3 py-2 font-medium">Campo</th>
                            <th className="px-3 py-2 font-medium">Motivo</th>
                          </tr>
                        </thead>
                        <tbody>
                          {resultado.errores.map((e) => (
                            <tr key={`${e.fila}-${e.campo}`} className="border-t border-borde">
                              <td className="px-3 py-2 tabular-nums font-semibold text-error-tinta">{e.fila}</td>
                              <td className="px-3 py-2 font-mono text-texto">{e.campo}</td>
                              <td className="px-3 py-2 text-texto-suave">{e.motivo}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="rounded-md border border-exito/40 bg-exito/8 px-3 py-2 text-[13px] text-texto">
                      Ninguna fila tiene errores. Se puede cargar el archivo completo.
                    </p>
                  )}
                </div>
              )}

              {cargadas !== null && (
                <p className="rounded-md border border-exito/40 bg-exito/8 px-3 py-3 text-[13px] text-texto">
                  Se cargaron <span className="font-semibold tabular-nums">{cargadas}</span> filas en {catalogo}. Las
                  filas con error no se tocaron; corrígelas en el archivo y vuelve a subirlo.
                </p>
              )}
            </div>

            <footer className="flex items-center justify-end gap-2 border-t border-borde px-5 py-3">
              {fase === 'subir' && (
                <>
                  <Boton variante="fantasma" onClick={cerrar}>
                    Cancelar
                  </Boton>
                  <Boton onClick={validar} disabled={!nombreArchivo}>
                    Validar archivo
                  </Boton>
                </>
              )}
              {fase === 'resultado' && resultado && cargadas === null && (
                <>
                  <Boton variante="fantasma" onClick={() => setFase('subir')}>
                    Subir otro
                  </Boton>
                  {resultado.errores.length > 0 && (
                    <Boton variante="secundario" onClick={() => setCargadas(resultado.validas)}>
                      Cargar solo las {resultado.validas} válidas
                    </Boton>
                  )}
                  <Boton onClick={() => setCargadas(resultado.totalFilas - resultado.errores.length)} disabled={resultado.errores.length > 0}>
                    Cargar todo
                  </Boton>
                </>
              )}
              {cargadas !== null && <Boton onClick={cerrar}>Listo</Boton>}
            </footer>
          </div>
        </div>
      )}
    </>
  );
}

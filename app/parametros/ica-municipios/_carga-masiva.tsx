'use client';

/**
 * A8 — D-088 · TAREA 4. Carga masiva de un municipio completo desde el archivo
 * con el layout del cliente (encabezado + tabla de actividades).
 *
 * La fecha de vigencia, la norma de respaldo y la periodicidad de declaración
 * NO están en el archivo: se piden aquí y aplican a todo el municipio (§6.2).
 * El informe de filas con error (las subclases de 5 dígitos del Distrito, sobre
 * todo) se pinta con `useActionState`: no cabe en una query string.
 */
import { useActionState } from 'react';
import { cargarIcaMunicipioAction, type EstadoCargaIca } from './acciones';
import { Boton, Campo, Entrada, MensajeEstado, Panel, Selector, Tabla, Td, Th } from '../../_ui/componentes';

export function CargaMasivaIca({ puedeEditar }: { puedeEditar: boolean }) {
  const [estado, accion, enCurso] = useActionState<EstadoCargaIca | null, FormData>(
    cargarIcaMunicipioAction,
    null,
  );

  return (
    <Panel titulo="Carga masiva — un archivo por municipio" className="mt-6">
      <div className="space-y-3 p-5">
        <p className="text-menor text-texto-suave">
          Sube el archivo del municipio (encabezado con bases mínimas + tabla de actividades). Los
          códigos CIIU se rellenan a 4 dígitos; las subclases de 5 dígitos del Distrito no se cargan y
          aparecen en el informe. Descarga la plantilla:{' '}
          <a className="font-semibold text-primario underline dark:text-primario-tinta-oscura" href="/api/plantillas/ica_municipio_d088">
            plantilla D-088 (.xlsx)
          </a>
          .
        </p>

        {!puedeEditar ? (
          <MensajeEstado tipo="configuracion" titulo="Solo lectura">
            Se necesita <code>parametro.ica.editar</code> para cargar.
          </MensajeEstado>
        ) : (
          <form action={accion} className="grid max-w-xl grid-cols-1 gap-3">
            <Campo etiqueta="Archivo del municipio (.xlsx)" requerido>
              <input type="file" name="archivo" accept=".xlsx,.xlsm" required />
            </Campo>
            <Campo etiqueta="Vigente desde (aplica a todo el municipio)" requerido>
              <Entrada name="vigenteDesde" type="date" required />
            </Campo>
            <Campo etiqueta="Norma de respaldo" requerido>
              <Entrada name="normaRespaldo" type="text" required placeholder="Acuerdo Municipal ... de ...." />
            </Campo>
            <Campo etiqueta="Periodicidad de declaración">
              <Selector name="periodicidad" defaultValue="mensual">
                <option value="mensual">Mensual</option>
                <option value="bimestral">Bimestral</option>
                <option value="trimestral">Trimestral</option>
                <option value="cuatrimestral">Cuatrimestral</option>
                <option value="anual">Anual</option>
              </Selector>
            </Campo>
            <fieldset className="flex flex-wrap gap-4 text-cuerpo text-texto">
              <label className="flex items-center gap-2"><input type="radio" name="alcance" value="firma" defaultChecked /> Toda la firma</label>
              <label className="flex items-center gap-2"><input type="radio" name="alcance" value="empresa" /> Solo esta empresa</label>
            </fieldset>
            <div>
              <Boton tipo="submit" disabled={enCurso}>
                {enCurso ? 'Cargando…' : 'Validar y cargar municipio'}
              </Boton>
            </div>
          </form>
        )}

        {estado && (
          <div className="space-y-2">
            <MensajeEstado tipo={estado.ok ? 'sin-datos' : 'error'} titulo={estado.mensaje} />
            {estado.resultado && (
              <>
                <ul className="list-disc pl-5 text-menor text-texto-suave">
                  <li>Municipio: {estado.resultado.municipioTexto} ({estado.resultado.municipioDane ?? '—'})</li>
                  <li>Actividades leídas: {estado.resultado.filasLeidas}</li>
                  <li>Válidas: {estado.resultado.filasValidas} · Con error: {estado.resultado.filasConError}</li>
                  <li>Insertadas: {estado.resultado.filasInsertadas}</li>
                </ul>
                {estado.resultado.errores.length > 0 && (
                  <Tabla alturaMaxima="40vh">
                    <thead>
                      <tr><Th>Fila</Th><Th>Columna</Th><Th>Motivo</Th></tr>
                    </thead>
                    <tbody>
                      {estado.resultado.errores.map((e, i) => (
                        <tr key={i} className="border-t border-borde/60">
                          <Td numerico>{e.numeroFila ?? '—'}</Td>
                          <Td>{e.columna ?? '—'}</Td>
                          <Td>{e.motivo}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Tabla>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}

/**
 * D-084 · TAREA 3 — Pestaña «Historial» de un tercero.
 *
 * La ficha (pestaña «Detalle») muestra SOLO el valor vigente hoy de cada
 * atributo fiscal. El historial completo de vigencias —cerradas y abierta— vive
 * aquí, aparte, para que la vista principal no quede amontonada. Es la prueba
 * visual de la Regla de Oro 3: cada edición es una fila nueva, nunca un UPDATE.
 * Solo lectura.
 */
import { conSesion } from '../../../lib/sesion';
import {
  listarHistorialActividadesTercero,
  listarHistorialAtributosFiscales,
  obtenerTercero,
} from '../../../../src/services/terceros';
import { Badge, Encabezado, EstadoVacio, MensajeEstado, Panel, Tabla, Td, Th } from '../../../_ui/componentes';
import { Si } from '../../_componentes';
import { TabsTercero } from '../../_ui';

export const dynamic = 'force-dynamic';

export default async function PaginaHistorialTercero({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [tercero, historialFiscal, historialActividad] = await conSesion((tx) =>
    Promise.all([
      obtenerTercero(tx, id),
      listarHistorialAtributosFiscales(tx, id),
      listarHistorialActividadesTercero(tx, id),
    ]),
  );

  if (!tercero) {
    return (
      <div className="mx-auto max-w-3xl p-5">
        <MensajeEstado tipo="error" titulo={`No existe (o no es visible para esta sesión) el tercero ${id}.`} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-5">
      <Encabezado titulo={tercero.razonSocial} descripcion="Historial completo de vigencias — solo lectura" />
      <TabsTercero id={tercero.id} />

      <div className="flex flex-col gap-4">
        <Panel titulo="Atributos fiscales — todas las vigencias">
          {historialFiscal.length === 0 ? (
            <EstadoVacio titulo="Sin ninguna vigencia fiscal registrada" detalle="Aún no se han declarado los atributos fiscales de este tercero." />
          ) : (
            <Tabla fijarPrimeraColumna>
              <thead>
                <tr>
                  <Th>Vigencia</Th>
                  <Th>Declarante</Th>
                  <Th>Autorret. renta</Th>
                  <Th>Gran contrib.</Th>
                  <Th>Rég. SIMPLE</Th>
                  <Th>Resp. IVA</Th>
                  <Th>Ag. ret. renta</Th>
                  <Th>Ag. ret. IVA</Th>
                  <Th>Ag. ret. ICA</Th>
                  <Th>Autorret. ICA</Th>
                  <Th>Régimen</Th>
                  <Th>Norma de respaldo</Th>
                </tr>
              </thead>
              <tbody>
                {historialFiscal.map((f) => (
                  <tr key={f.id} className="border-t border-borde/60">
                    <Td numerico>
                      {f.vigenteDesde} → {f.vigenteHasta ?? 'vigente'}
                      {f.vigenteHasta === null && (
                        <>
                          {' '}
                          <Badge tono="exito">actual</Badge>
                        </>
                      )}
                    </Td>
                    <Td><Si valor={f.esDeclaranteRenta} /></Td>
                    <Td><Si valor={f.esAutorretenedorRenta} /></Td>
                    <Td><Si valor={f.esGranContribuyente} /></Td>
                    <Td><Si valor={f.esRegimenSimple} /></Td>
                    <Td><Si valor={f.esResponsableIva} /></Td>
                    <Td><Si valor={f.esAgenteRetencionRenta} /></Td>
                    <Td><Si valor={f.esAgenteRetencionIva} /></Td>
                    <Td><Si valor={f.esAgenteRetencionIca} /></Td>
                    <Td><Si valor={f.esAutorretenedorIca} /></Td>
                    <Td>{f.regimenTributario}</Td>
                    <Td>{f.normaRespaldo}</Td>
                  </tr>
                ))}
              </tbody>
            </Tabla>
          )}
        </Panel>

        <Panel titulo="Actividad económica por municipio — todas las vigencias">
          {historialActividad.length === 0 ? (
            <EstadoVacio titulo="Sin actividad económica registrada" detalle="Aún no se ha registrado ninguna actividad de este tercero en ningún municipio." />
          ) : (
            <Tabla fijarPrimeraColumna>
              <thead>
                <tr>
                  <Th>Municipio</Th>
                  <Th>CIIU</Th>
                  <Th>Actividad</Th>
                  <Th>Principal</Th>
                  <Th>Tarifa propia</Th>
                  <Th>Vigencia</Th>
                  <Th>Norma de respaldo</Th>
                </tr>
              </thead>
              <tbody>
                {historialActividad.map((a) => (
                  <tr key={a.id} className="border-t border-borde/60">
                    <Td>{a.municipalityNombre}</Td>
                    <Td numerico>{a.ciiuCodigo}</Td>
                    <Td>{a.ciiuNombre}</Td>
                    <Td><Si valor={a.esPrincipal} /></Td>
                    <Td numerico>{a.tarifaIcaOverride ?? '—'}</Td>
                    <Td numerico>
                      {a.vigenteDesde} → {a.vigenteHasta ?? 'vigente'}
                      {a.vigenteHasta === null && (
                        <>
                          {' '}
                          <Badge tono="exito">actual</Badge>
                        </>
                      )}
                    </Td>
                    <Td>{a.normaRespaldo}</Td>
                  </tr>
                ))}
              </tbody>
            </Tabla>
          )}
        </Panel>
      </div>
    </div>
  );
}

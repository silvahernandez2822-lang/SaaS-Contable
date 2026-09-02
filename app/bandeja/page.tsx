/**
 * A7 — Bandeja de causación multi-empresa (sección 4, Ola 2).
 *
 * "El usuario de la firma ve en una sola pantalla las facturas pendientes de sus
 * 30-60 empresas-cliente... y puede aprobar 50 de un golpe." D-077 (Ola 5,
 * front) la migra al lenguaje visual del sistema de interfaz SIN tocar la lógica:
 * sigue agregando `obtenerBandejaConsolidada` (una sesión real por empresa,
 * D-021/D-022), sigue enviando `sel = companyId::journalEntryId` a la aprobación
 * en lote, y la traza completa de cada retención sigue visible siempre.
 */
import { obtenerBandejaConsolidada } from '../lib/bandeja';
import { aprobarSeleccionAction, corregirYReprocesarAction, rechazarSeleccionAction } from './acciones';
import { Boton, EtiquetaEstado, Encabezado, MensajeEstado, Panel } from '../_ui/componentes';
import {
  LineasConAiu,
  MensajeError,
  MotivosRevision,
  PartidasAsiento,
  SelectorMunicipio,
  TrazaRetenciones,
} from './_componentes';

export const dynamic = 'force-dynamic';

type BusquedaParams = Record<string, string | string[] | undefined>;
function cadena(sp: BusquedaParams, campo: string): string {
  const v = sp[campo];
  return typeof v === 'string' ? v : '';
}

export default async function PaginaBandeja({ searchParams }: { searchParams: Promise<BusquedaParams> }) {
  const sp = await searchParams;
  const { empresas, pendientesAprobacion, pendientesRevision, municipios } = await obtenerBandejaConsolidada();

  return (
    <div className="mx-auto max-w-6xl p-5">
      <Encabezado
        titulo="Bandeja de causación"
        descripcion={`${empresas.length} empresa(s) accesible(s) · ${pendientesAprobacion.length} lista(s) para aprobar · ${pendientesRevision.length} en revisión manual`}
      />

      <MensajeError error={cadena(sp, 'error') || undefined} />

      <section className="mt-2">
        <h2 className="mb-2 text-[13px] font-semibold text-texto">Pendientes de aprobación</h2>
        {pendientesAprobacion.length === 0 ? (
          <MensajeEstado tipo="sin-datos" titulo="No hay facturas listas para aprobar en ninguna de sus empresas." />
        ) : (
          <form action={aprobarSeleccionAction} className="flex flex-col gap-3">
            <div className="flex gap-2">
              <Boton tipo="submit">Aprobar seleccionadas</Boton>
              <Boton tipo="submit" variante="peligro" formAction={rechazarSeleccionAction}>
                Rechazar seleccionadas
              </Boton>
            </div>

            {pendientesAprobacion.map((doc) => (
              <Panel
                key={doc.sourceDocumentId}
                titulo={
                  <span className="flex items-center gap-2">
                    {doc.asiento && (
                      <input
                        type="checkbox"
                        name="sel"
                        value={`${doc.companyId}::${doc.asiento.id}`}
                        aria-label={`Seleccionar documento ${doc.numeroDocumento}`}
                      />
                    )}
                    {doc.companyNombre} · documento {doc.numeroDocumento}
                  </span>
                }
                descripcion={`NIT emisor ${doc.emisorNit} · hecho económico ${doc.fechaHechoEconomico} · estado ${doc.estado}`}
                acciones={
                  doc.asiento ? (
                    <span className="flex items-center gap-2 text-[12px] text-texto-suave">
                      Asiento {doc.asiento.numero}
                      <EtiquetaEstado estado={doc.asiento.estado === 'publicado' ? 'aprobado' : 'pendiente'}>
                        {doc.asiento.estado}
                      </EtiquetaEstado>
                    </span>
                  ) : undefined
                }
              >
                <div className="flex flex-col gap-3 p-4">
                  <TrazaRetenciones retenciones={doc.retenciones} />
                  {doc.asiento && <PartidasAsiento partidas={doc.asiento.partidas} />}
                </div>
              </Panel>
            ))}

            <div className="flex gap-2">
              <Boton tipo="submit">Aprobar seleccionadas</Boton>
              <Boton tipo="submit" variante="peligro" formAction={rechazarSeleccionAction}>
                Rechazar seleccionadas
              </Boton>
            </div>
          </form>
        )}
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-[13px] font-semibold text-texto">
          Pendientes de revisión (V-7 / V-8 y clasificación)
        </h2>
        {pendientesRevision.length === 0 ? (
          <MensajeEstado
            tipo="sin-datos"
            titulo="No hay documentos en revisión manual en ninguna de sus empresas."
          />
        ) : (
          <div className="flex flex-col gap-3">
            {pendientesRevision.map((doc) => (
              <Panel
                key={doc.sourceDocumentId}
                titulo={`${doc.companyNombre} · documento ${doc.numeroDocumento}`}
                descripcion={`NIT emisor ${doc.emisorNit} · hecho económico ${doc.fechaHechoEconomico} · intentos previos ${doc.intentos}`}
              >
                <div className="flex flex-col gap-3 p-4">
                  <div className="flex flex-wrap gap-2 text-[12px]">
                    {doc.requiereAiu && (
                      <span className="rounded bg-pendiente/12 px-2 py-[2px] font-semibold text-pendiente">
                        Necesita AIU por línea (V-7)
                      </span>
                    )}
                    {doc.requiereMunicipio && (
                      <span className="rounded bg-pendiente/12 px-2 py-[2px] font-semibold text-pendiente">
                        Necesita corregir el municipio de la operación (V-8)
                      </span>
                    )}
                  </div>

                  <div>
                    <p className="mb-1 text-[12px] font-medium text-texto">Motivo(s) de la revisión manual:</p>
                    <MotivosRevision motivos={doc.motivos} />
                  </div>

                  <form action={corregirYReprocesarAction} className="flex flex-col gap-3 border-t border-borde pt-3">
                    <input type="hidden" name="companyId" value={doc.companyId} />
                    <input type="hidden" name="sourceDocumentId" value={doc.sourceDocumentId} />

                    {doc.lineas.length > 0 && (
                      <div>
                        <p className="mb-1 text-[12px] font-medium text-texto">
                          Líneas del documento (capture el AIU solo en la(s) que correspondan):
                        </p>
                        <LineasConAiu lineas={doc.lineas} aiuGuardado={doc.correcciones.aiuPorLinea} />
                      </div>
                    )}

                    <label className="flex flex-col gap-1.5 text-[12px] font-medium text-texto">
                      Municipio donde se prestó el servicio (V-8, sección 7.5 — solo si difiere del municipio del
                      tercero):
                      <SelectorMunicipio
                        municipios={municipios}
                        seleccionado={doc.correcciones.municipioOperacionId}
                      />
                    </label>

                    <label className="flex flex-col gap-1.5 text-[12px] font-medium text-texto">
                      Motivo de la corrección (obligatorio, Regla de Oro 6)
                      <input
                        type="text"
                        name="motivo"
                        required
                        placeholder="Ej.: AIU tomado de la representación gráfica; el servicio se prestó en Medellín"
                        className="rounded-md border border-borde bg-superficie-elevada px-3 py-2 text-[13px] text-texto"
                      />
                    </label>

                    <div className="flex justify-end">
                      <Boton tipo="submit">Guardar corrección y reprocesar</Boton>
                    </div>
                  </form>
                </div>
              </Panel>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * A7 — Bandeja de causación multi-empresa (sección 4, Ola 2).
 *
 * "El usuario de la firma ve en una sola pantalla las facturas pendientes de
 * sus 30-60 empresas-cliente... y puede aprobar 50 de un golpe."
 *
 * D-077 (Ola 5) la migró al lenguaje visual del sistema de interfaz. D-079
 * (Fase 2) completa su funcionalidad: filtros (fecha, proveedor, monto,
 * score), selección "todas", edición de cuenta/monto de línea con
 * justificación obligatoria, sub-bandeja de rechazadas y visor del XML
 * original. La lógica sigue agregando `obtenerBandejaConsolidada` (una sesión
 * real por empresa, D-021/D-022) y enviando `sel = companyId::journalEntryId`
 * a la aprobación en lote.
 */
import Link from 'next/link';
import { normalizarFiltros, obtenerBandejaConsolidada } from '../lib/bandeja';
import { conSesionEmpresa } from '../lib/sesion';
import { listarCuentasImputables } from '../../src/services/consulta';
import {
  aprobarSeleccionAction,
  archivarRechazadaAction,
  corregirYReprocesarAction,
  editarLineaAction,
  rechazarSeleccionAction,
  reprocesarRechazadaAction,
} from './acciones';
import { Badge, Boton, EnlaceBoton, Encabezado, MensajeEstado, Panel } from '../_ui/componentes';
import {
  LineasConAiu,
  MensajeError,
  MotivosRevision,
  PartidasAsiento,
  SelectorMunicipio,
  TrazaRetenciones,
  pesos,
} from './_componentes';
import { ConfirmarArchivar, EditorLineasAsiento, SelectorTodas } from './_interactivos';

export const dynamic = 'force-dynamic';

type BusquedaParams = Record<string, string | string[] | undefined>;
function cadena(sp: BusquedaParams, campo: string): string {
  const v = sp[campo];
  return typeof v === 'string' ? v : '';
}

const VISTAS = [
  { id: 'aprobacion', texto: 'Pendientes de aprobación' },
  { id: 'revision', texto: 'Pendientes de revisión' },
  { id: 'rechazadas', texto: 'Rechazadas' },
] as const;

export default async function PaginaBandeja({ searchParams }: { searchParams: Promise<BusquedaParams> }) {
  const sp = await searchParams;
  const vista = (VISTAS.find((v) => v.id === cadena(sp, 'vista'))?.id ?? 'aprobacion') as
    | 'aprobacion'
    | 'revision'
    | 'rechazadas';

  const filtros = normalizarFiltros({
    desde: cadena(sp, 'desde'),
    hasta: cadena(sp, 'hasta'),
    proveedor: cadena(sp, 'proveedor'),
    montoMin: cadena(sp, 'montoMin'),
    montoMax: cadena(sp, 'montoMax'),
    scoreMin: cadena(sp, 'scoreMin'),
  });

  const {
    empresas,
    pendientesAprobacion,
    pendientesRevision,
    rechazadas,
    municipios,
    proveedores,
    totalAprobacionSinFiltrar,
    empresasTruncadas,
  } = await obtenerBandejaConsolidada(filtros);

  // Cuentas imputables por empresa que tiene algún asiento en la bandeja — para
  // el selector del editor de líneas. Una consulta por empresa distinta, no por
  // documento.
  const empresasConAsiento = [...new Set(pendientesAprobacion.filter((d) => d.asiento).map((d) => d.companyId))];
  const cuentasPorEmpresa = new Map<string, { codigo: string; nombre: string }[]>();
  for (const companyId of empresasConAsiento) {
    const cuentas = await conSesionEmpresa(companyId, (tx) => listarCuentasImputables(tx));
    cuentasPorEmpresa.set(
      companyId,
      cuentas.map((c) => ({ codigo: c.codigo, nombre: c.nombre })),
    );
  }

  const hayFiltrosActivos =
    !!filtros.desde ||
    !!filtros.hasta ||
    !!filtros.proveedor ||
    filtros.montoMinCentavos != null ||
    filtros.montoMaxCentavos != null ||
    filtros.scoreMin != null;

  return (
    <div className="mx-auto max-w-6xl p-5">
      <Encabezado
        titulo="Bandeja de causación"
        descripcion={`${empresas.length} empresa(s) accesible(s) · ${pendientesAprobacion.length} lista(s) para aprobar · ${pendientesRevision.length} en revisión · ${rechazadas.length} rechazada(s)`}
      />

      <MensajeError error={cadena(sp, 'error') || undefined} />
      {cadena(sp, 'editado') && (
        <div className="my-3">
          <MensajeEstado tipo="sin-datos" titulo="Cambios del asiento guardados y registrados en auditoría." />
        </div>
      )}
      {cadena(sp, 'reprocesado') && (
        <div className="my-3">
          <MensajeEstado tipo="sin-datos" titulo="Documento devuelto a la cola de causación." />
        </div>
      )}
      {cadena(sp, 'archivado') && (
        <div className="my-3">
          <MensajeEstado tipo="sin-datos" titulo="Documento archivado. Sigue en la base y en la auditoría; hoy no hay pantalla para desarchivarlo." />
        </div>
      )}

      {/* pestañas */}
      <nav className="mt-2 flex gap-1 border-b border-borde">
        {VISTAS.map((v) => (
          <Link
            key={v.id}
            href={`/bandeja?vista=${v.id}`}
            className={`rounded-t-md px-3 py-2 text-[13px] font-semibold ${
              vista === v.id
                ? 'border border-b-0 border-borde bg-superficie-elevada text-texto'
                : 'text-texto-suave hover:text-texto'
            }`}
          >
            {v.texto}
            {v.id === 'aprobacion' && ` (${pendientesAprobacion.length})`}
            {v.id === 'revision' && ` (${pendientesRevision.length})`}
            {v.id === 'rechazadas' && ` (${rechazadas.length})`}
          </Link>
        ))}
      </nav>

      {vista === 'aprobacion' && (
        <section className="mt-4">
          {/* filtros */}
          <form method="get" className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-borde bg-superficie-elevada p-3">
            <input type="hidden" name="vista" value="aprobacion" />
            <label className="flex flex-col gap-1 text-[11px] font-medium text-texto-suave">
              Hecho económico desde
              <input type="date" name="desde" defaultValue={filtros.desde ?? ''} className="rounded-md border border-borde bg-superficie-elevada px-2 py-1 text-[13px] text-texto" />
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-medium text-texto-suave">
              hasta
              <input type="date" name="hasta" defaultValue={filtros.hasta ?? ''} className="rounded-md border border-borde bg-superficie-elevada px-2 py-1 text-[13px] text-texto" />
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-medium text-texto-suave">
              Proveedor (NIT o razón social)
              <input list="proveedores-bandeja" name="proveedor" defaultValue={filtros.proveedor ?? ''} placeholder="empezar a escribir…" className="w-56 rounded-md border border-borde bg-superficie-elevada px-2 py-1 text-[13px] text-texto" />
            </label>
            <datalist id="proveedores-bandeja">
              {proveedores.map((p) => (
                <option key={p.numeroDocumento} value={p.numeroDocumento}>
                  {p.razonSocial}
                </option>
              ))}
            </datalist>
            <label className="flex flex-col gap-1 text-[11px] font-medium text-texto-suave">
              Monto mín. (pesos)
              <input type="number" name="montoMin" defaultValue={filtros.montoMinCentavos != null ? String(Math.round(filtros.montoMinCentavos / 100)) : ''} className="w-28 rounded-md border border-borde bg-superficie-elevada px-2 py-1 text-right text-[13px] text-texto tabular-nums" />
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-medium text-texto-suave">
              Monto máx. (pesos)
              <input type="number" name="montoMax" defaultValue={filtros.montoMaxCentavos != null ? String(Math.round(filtros.montoMaxCentavos / 100)) : ''} className="w-28 rounded-md border border-borde bg-superficie-elevada px-2 py-1 text-right text-[13px] text-texto tabular-nums" />
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-medium text-texto-suave">
              Score mín. (0–100)
              <input type="number" name="scoreMin" min={0} max={100} defaultValue={filtros.scoreMin != null ? String(filtros.scoreMin) : ''} className="w-24 rounded-md border border-borde bg-superficie-elevada px-2 py-1 text-right text-[13px] text-texto tabular-nums" />
            </label>
            <Boton tipo="submit" variante="secundario">Filtrar</Boton>
            {hayFiltrosActivos && (
              <Link href="/bandeja?vista=aprobacion" className="text-[12px] font-semibold text-primario underline dark:text-primario-tinta-oscura">
                Limpiar filtros
              </Link>
            )}
          </form>

          {hayFiltrosActivos && (
            <p className="mb-2 text-[12px] text-texto-suave">
              Mostrando {pendientesAprobacion.length} de {totalAprobacionSinFiltrar} documento(s) pendiente(s)
              {' '}(los filtros de proveedor, monto y score se aplican sobre las 20 más antiguas por empresa,
              que son las que la pantalla trae).
            </p>
          )}

          {empresasTruncadas.length > 0 && (
            <div className="mb-3 rounded-md border border-pendiente/40 bg-pendiente/8 px-3 py-2 text-[12px] text-texto">
              <span className="font-semibold text-pendiente-tinta">Hay más de lo que se ve.</span>{' '}
              {empresasTruncadas.length} empresa(s) llegaron al tope de 20 documentos que esta pantalla trae por
              empresa ({empresasTruncadas.slice(0, 5).join(', ')}
              {empresasTruncadas.length > 5 ? ', …' : ''}). Apruebe o acote por fecha para ver el resto: no
              suponga que la bandeja está vacía cuando termine.
            </div>
          )}

          {pendientesAprobacion.length === 0 ? (
            <MensajeEstado
              tipo="sin-datos"
              titulo={
                hayFiltrosActivos
                  ? 'Ningún documento pendiente coincide con los filtros.'
                  : 'No hay facturas listas para aprobar en ninguna de sus empresas.'
              }
            />
          ) : (
            <form action={aprobarSeleccionAction} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <SelectorTodas total={pendientesAprobacion.length} />
                <div className="flex gap-2">
                  <Boton tipo="submit">Aprobar seleccionadas</Boton>
                  <Boton tipo="submit" variante="peligro" formAction={rechazarSeleccionAction}>
                    Rechazar seleccionadas
                  </Boton>
                </div>
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
                  descripcion={
                    <span className="flex flex-wrap items-center gap-2">
                      <span>
                        {doc.emisorNombre ?? `NIT ${doc.emisorNit}`} · hecho económico {doc.fechaHechoEconomico}
                        {doc.totalBrutoCentavos != null && ` · bruto $${pesos(doc.totalBrutoCentavos)}`}
                      </span>
                      {doc.scoreConfianza != null && (
                        <Badge tono={doc.scoreConfianza >= 80 ? 'exito' : 'pendiente'}>
                          confianza {doc.scoreConfianza}
                        </Badge>
                      )}
                    </span>
                  }
                  acciones={
                    <span className="flex items-center gap-2 text-[12px] text-texto-suave">
                      <Link
                        href={`/bandeja/documento/${doc.sourceDocumentId}?empresa=${doc.companyId}`}
                        className="font-semibold text-primario underline dark:text-primario-tinta-oscura"
                      >
                        Ver XML original
                      </Link>
                    </span>
                  }
                >
                  <div className="flex flex-col gap-3 p-4">
                    <TrazaRetenciones retenciones={doc.retenciones} />
                    {doc.asiento && <PartidasAsiento partidas={doc.asiento.partidas} />}
                    {doc.asiento && doc.asiento.estado !== 'posted' && (
                      <EditorLineasAsiento
                        companyId={doc.companyId}
                        journalEntryId={doc.asiento.id}
                        accion={editarLineaAction}
                        cuentas={cuentasPorEmpresa.get(doc.companyId) ?? []}
                        partidas={doc.asiento.partidas.map((p) => ({
                          id: p.id,
                          cuentaCodigo: p.cuentaCodigo,
                          cuentaNombre: p.cuentaNombre,
                          side: p.side,
                          montoCentavos: p.monto,
                          descripcion: p.descripcion,
                          retentionAppliedId: p.retentionAppliedId,
                        }))}
                      />
                    )}
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
      )}

      {vista === 'revision' && (
        <section className="mt-4">
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
                  acciones={
                    <Link
                      href={`/bandeja/documento/${doc.sourceDocumentId}?empresa=${doc.companyId}`}
                      className="text-[12px] font-semibold text-primario underline dark:text-primario-tinta-oscura"
                    >
                      Ver XML original
                    </Link>
                  }
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
      )}

      {vista === 'rechazadas' && (
        <section className="mt-4">
          <h2 className="mb-2 text-[13px] font-semibold text-texto">Facturas rechazadas</h2>
          <p className="mb-3 text-[12px] text-texto-suave">
            Una factura rechazada sale de la bandeja de aprobación pero no se borra. Desde aquí se puede
            devolver a la cola de causación (solo si no dejó un asiento en conflicto) o archivarla.
          </p>
          {rechazadas.length === 0 ? (
            <MensajeEstado tipo="sin-datos" titulo="No hay facturas rechazadas en ninguna de sus empresas." />
          ) : (
            <div className="flex flex-col gap-3">
              {rechazadas.map((doc) => (
                <Panel
                  key={doc.sourceDocumentId}
                  titulo={`${doc.companyNombre} · documento ${doc.numeroDocumento}`}
                  descripcion={`NIT emisor ${doc.emisorNit} · hecho económico ${doc.fechaHechoEconomico}${
                    doc.rechazadoEn ? ` · rechazada el ${doc.rechazadoEn.slice(0, 10)}` : ''
                  }`}
                  acciones={
                    <Link
                      href={`/bandeja/documento/${doc.sourceDocumentId}?empresa=${doc.companyId}`}
                      className="text-[12px] font-semibold text-primario underline dark:text-primario-tinta-oscura"
                    >
                      Ver XML original
                    </Link>
                  }
                >
                  <div className="flex flex-col gap-3 p-4">
                    {doc.motivoRechazo && (
                      <p className="text-[12px] text-texto">
                        <span className="font-medium">Motivo del rechazo:</span> {doc.motivoRechazo}
                      </p>
                    )}

                    <div className="flex flex-wrap items-start gap-3">
                      {doc.puedeReprocesar ? (
                        <form action={reprocesarRechazadaAction}>
                          <input type="hidden" name="companyId" value={doc.companyId} />
                          <input type="hidden" name="sourceDocumentId" value={doc.sourceDocumentId} />
                          <Boton tipo="submit" variante="secundario">
                            Devolver a la cola de causación
                          </Boton>
                        </form>
                      ) : (
                        <div className="max-w-xl rounded-md border border-pendiente/40 bg-pendiente/8 px-3 py-2 text-[12px] text-texto">
                          <span className="font-semibold text-pendiente-tinta">Reproceso bloqueado.</span>{' '}
                          {doc.motivoBloqueoReproceso}
                        </div>
                      )}

                      <ConfirmarArchivar
                        companyId={doc.companyId}
                        sourceDocumentId={doc.sourceDocumentId}
                        accion={archivarRechazadaAction}
                      />
                    </div>
                  </div>
                </Panel>
              ))}
            </div>
          )}
        </section>
      )}

      {empresas.length === 0 && (
        <div className="mt-6">
          <MensajeEstado
            tipo="configuracion"
            titulo="Su usuario no tiene acceso a ninguna empresa todavía."
          >
            Un administrador de la firma debe darle acceso desde{' '}
            <EnlaceBoton href="/admin/usuarios" variante="secundario">
              Administración de usuarios
            </EnlaceBoton>
            .
          </MensajeEstado>
        </div>
      )}
    </div>
  );
}

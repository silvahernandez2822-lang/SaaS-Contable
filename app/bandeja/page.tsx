/**
 * A7 — Bandeja de causación multi-empresa (sección 4, Ola 2).
 *
 * "El usuario de la firma ve en una sola pantalla las facturas pendientes de
 * sus 30-60 empresas-cliente... y puede aprobar 50 de un golpe." Esta página
 * es esa pantalla: agrega `listarPendientesDeAprobacion` (A6) y
 * `listarPendientesRevision` (A7) de TODAS las empresas accesibles de la
 * sesión (`app/lib/bandeja.ts`), con la traza completa —base, tarifa, norma
 * y vigencia— de cada retención evaluada, visible siempre (sección 4, rol de
 * A7: es diferenciador de producto, no un detalle técnico secundario).
 *
 * V-7 (AIU por línea) y V-8 (municipio de la operación), cerradas por A7: la
 * sección de "pendientes de revisión" es donde el humano las corrige y pide
 * el reproceso — antes de que exista ningún asiento que aprobar.
 */
import { obtenerBandejaConsolidada } from '../lib/bandeja';
import { aprobarSeleccionAction, corregirYReprocesarAction, rechazarSeleccionAction } from './acciones';
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
    <main style={{ maxWidth: '1200px', margin: '0 auto', padding: '24px' }}>
      <h1>Bandeja de causación</h1>
      <p>
        {empresas.length} empresa(s) accesible(s) desde esta sesión. {pendientesAprobacion.length} factura(s) lista(s)
        para aprobar, {pendientesRevision.length} en revisión manual.
      </p>

      <MensajeError error={cadena(sp, 'error') || undefined} />

      <h2>Pendientes de aprobación</h2>
      {pendientesAprobacion.length === 0 ? (
        <p><em>No hay facturas listas para aprobar en ninguna de sus empresas.</em></p>
      ) : (
        <form action={aprobarSeleccionAction}>
          <p>
            <button type="submit">Aprobar seleccionadas</button>{' '}
            <button type="submit" formAction={rechazarSeleccionAction}>Rechazar seleccionadas</button>
          </p>
          {pendientesAprobacion.map((doc) => (
            <section key={doc.sourceDocumentId} style={{ border: '1px solid #334155', padding: '12px', marginBottom: '12px' }}>
              <p>
                {doc.asiento && (
                  <input type="checkbox" name="sel" value={`${doc.companyId}::${doc.asiento.id}`} style={{ marginRight: '8px' }} />
                )}
                <strong>{doc.companyNombre}</strong> — documento {doc.numeroDocumento} (NIT emisor {doc.emisorNit}),
                hecho económico {doc.fechaHechoEconomico}. Estado del documento: {doc.estado}.
                {doc.asiento && <> Asiento {doc.asiento.numero} ({doc.asiento.estado}).</>}
              </p>
              <TrazaRetenciones retenciones={doc.retenciones} />
              {doc.asiento && <PartidasAsiento partidas={doc.asiento.partidas} />}
            </section>
          ))}
          <p>
            <button type="submit">Aprobar seleccionadas</button>{' '}
            <button type="submit" formAction={rechazarSeleccionAction}>Rechazar seleccionadas</button>
          </p>
        </form>
      )}

      <h2>Pendientes de revisión (V-7 / V-8 y clasificación)</h2>
      {pendientesRevision.length === 0 ? (
        <p><em>No hay documentos en revisión manual en ninguna de sus empresas.</em></p>
      ) : (
        pendientesRevision.map((doc) => (
          <section key={doc.sourceDocumentId} style={{ border: '1px solid #b45309', padding: '12px', marginBottom: '12px' }}>
            <p>
              <strong>{doc.companyNombre}</strong> — documento {doc.numeroDocumento} (NIT emisor {doc.emisorNit}),
              hecho económico {doc.fechaHechoEconomico}. Intentos previos: {doc.intentos}.
              {doc.requiereAiu && <> <strong>Necesita AIU por línea (V-7).</strong></>}
              {doc.requiereMunicipio && <> <strong>Necesita corregir el municipio de la operación (V-8).</strong></>}
            </p>
            <p>Motivo(s) de la revisión manual:</p>
            <MotivosRevision motivos={doc.motivos} />

            <form action={corregirYReprocesarAction}>
              <input type="hidden" name="companyId" value={doc.companyId} />
              <input type="hidden" name="sourceDocumentId" value={doc.sourceDocumentId} />

              {doc.lineas.length > 0 && (
                <>
                  <p>Líneas del documento (capture el AIU solo en la(s) que correspondan):</p>
                  <LineasConAiu lineas={doc.lineas} aiuGuardado={doc.correcciones.aiuPorLinea} />
                </>
              )}

              <p style={{ marginTop: '8px' }}>
                Municipio donde se prestó el servicio (V-8, sección 7.5 — solo si difiere del municipio del
                tercero):{' '}
                <SelectorMunicipio municipios={municipios} seleccionado={doc.correcciones.municipioOperacionId} />
              </p>

              <p>
                <label>
                  Motivo de la corrección (obligatorio, Regla de Oro 6){' '}
                  <input type="text" name="motivo" required size={70} placeholder="Ej.: AIU tomado de la representación gráfica; el servicio se prestó en Medellín" />
                </label>
              </p>

              <button type="submit">Guardar corrección y reprocesar</button>
            </form>
          </section>
        ))
      )}
    </main>
  );
}

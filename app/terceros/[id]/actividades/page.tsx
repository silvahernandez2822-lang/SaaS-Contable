/**
 * A8 — Registrar actividad económica de un tercero en un municipio (ReteICA
 * multimunicipio, cierre de V-17). Un proveedor puede tener actividad vigente
 * en varios municipios a la vez: cada terna tercero×municipio×CIIU se versiona
 * por separado.
 *
 * A16 (Ola 4, Tarea 5) — SELECTOR EN CASCADA de dos pasos: (1) elegir municipio
 * y recargar (`method="get"`, es una consulta); (2) con el municipio fijado,
 * elegir entre las actividades que TIENEN tarifa de ReteICA cargada para él. Si
 * el municipio no tiene ninguna, se explica por qué y a dónde ir.
 *
 * D-084 · TAREA 0 — migrado al kit. Las vigentes y el historial se movieron a
 * la pestaña «Historial»: aquí solo queda el formulario.
 */
import { conSesion } from '../../../lib/sesion';
import {
  hoyIso,
  listarActividadesIcaDeMunicipio,
  listarMunicipiosParaSelector,
  obtenerTercero,
  puedeEditarAtributosFiscales,
  type CatalogoActividadesIca,
} from '../../../../src/services/terceros';
import { Boton, Encabezado, EnlaceBoton, MensajeEstado, Panel } from '../../../_ui/componentes';
import { MensajeError, RadioSiNo } from '../../_componentes';
import { TabsTercero } from '../../_ui';
import { confirmarAction, simularAction } from './acciones';

export const dynamic = 'force-dynamic';

type BusquedaParams = Record<string, string | string[] | undefined>;
function cadena(sp: BusquedaParams, campo: string): string {
  const v = sp[campo];
  return typeof v === 'string' ? v : '';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CTRL = 'rounded-md border border-borde bg-superficie-elevada px-3 py-2 text-cuerpo text-texto';
const HIDDEN = ['terceroId', 'municipalityId', 'ciiuActivityId', 'esPrincipal', 'tarifaIcaOverride', 'vigenteDesde', 'normaRespaldo', 'notas'];

export default async function PaginaActividades({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<BusquedaParams>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const municipioElegido = UUID.test(cadena(sp, 'municipalityId')) ? cadena(sp, 'municipalityId') : '';

  const [tercero, municipios, puedeEditar, catalogoIca] = await conSesion((tx) =>
    Promise.all([
      obtenerTercero(tx, id),
      listarMunicipiosParaSelector(tx),
      puedeEditarAtributosFiscales(tx),
      municipioElegido
        ? listarActividadesIcaDeMunicipio(tx, municipioElegido).catch(() => null)
        : Promise.resolve(null),
    ]),
  );

  if (!tercero) {
    return (
      <div className="mx-auto max-w-3xl p-5">
        <MensajeEstado tipo="error" titulo={`No existe (o no es visible para esta sesión) el tercero ${id}.`} />
      </div>
    );
  }

  const confirmando = cadena(sp, 'confirmar') === '1';
  const municipioNombre = (mid: string) => municipios.find((m) => m.id === mid)?.nombre ?? mid;
  const ciiuTexto = (cid: string) => {
    const c = catalogoIca?.opciones.find((x) => x.id === cid);
    return c ? `${c.codigo} — ${c.nombre}` : cid;
  };

  return (
    <div className="mx-auto max-w-3xl p-5">
      <Encabezado
        titulo={tercero.razonSocial}
        descripcion="Actividad económica por municipio (ReteICA) — registrar una vigencia nueva"
      />
      <TabsTercero id={tercero.id} />
      <MensajeError error={cadena(sp, 'error') || undefined} />

      {!puedeEditar && (
        <MensajeEstado tipo="configuracion" titulo='Su sesión no tiene el permiso "tercero.atributos_fiscales"'>
          No puede registrar actividad nueva. Las vigentes y el historial están en la pestaña «Historial».
        </MensajeEstado>
      )}

      {puedeEditar && !confirmando && (
        <div className="flex flex-col gap-4">
          <Panel
            titulo="Paso 1 — Municipio"
            descripcion="Las actividades que se pueden registrar dependen del municipio: solo se ofrecen las que tienen tarifa de ReteICA cargada para él."
          >
            <form method="get" className="flex flex-wrap items-end gap-3 p-4">
              <label className="flex flex-col gap-1.5 text-cuerpo font-medium text-texto">
                Municipio *
                <select name="municipalityId" defaultValue={municipioElegido} required className={CTRL}>
                  <option value="" disabled>
                    Seleccione...
                  </option>
                  {municipios.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nombre} ({m.codigo})
                    </option>
                  ))}
                </select>
              </label>
              <Boton tipo="submit" variante="secundario">
                Ver actividades de este municipio
              </Boton>
            </form>
          </Panel>

          {catalogoIca === null && municipioElegido !== '' && (
            <MensajeEstado tipo="error" titulo="El municipio seleccionado no existe o no es visible para esta sesión." />
          )}

          {catalogoIca && <PasoDos catalogo={catalogoIca} terceroId={tercero.id} />}
        </div>
      )}

      {puedeEditar && confirmando && (
        <Panel titulo="Confirmar vigencia nueva">
          <div className="flex flex-col gap-3 p-4">
            <MensajeEstado
              tipo="configuracion"
              titulo={`Afecta ${cadena(sp, 'documentosPendientes')} documento(s) pendiente(s) y ${cadena(sp, 'asientosPublicados')} asiento(s) de ReteICA ya publicados de este proveedor en este municipio (sección 6.2, punto 6).`}
            />
            <ul className="flex flex-col gap-1 text-cuerpo text-texto">
              <li>Municipio: {municipioNombre(cadena(sp, 'municipalityId'))}</li>
              <li>Actividad: {ciiuTexto(cadena(sp, 'ciiuActivityId'))}</li>
              <li>Principal: {cadena(sp, 'esPrincipal') === 'si' ? 'Sí' : 'No'}</li>
              <li>Vigente desde: {cadena(sp, 'vigenteDesde')}</li>
              <li>Norma de respaldo: {cadena(sp, 'normaRespaldo')}</li>
            </ul>
            <form action={confirmarAction} className="flex gap-2">
              {HIDDEN.map((campo) => (
                <input key={campo} type="hidden" name={campo} value={cadena(sp, campo)} />
              ))}
              <Boton tipo="submit">Confirmar y guardar</Boton>
              <EnlaceBoton href={`/terceros/${tercero.id}/actividades`} variante="fantasma">
                Cancelar
              </EnlaceBoton>
            </form>
          </div>
        </Panel>
      )}
    </div>
  );
}

/** Paso 2: solo aparece con un municipio ya elegido. Cuando ese municipio no
 * tiene tarifas cargadas NO se pinta un desplegable vacío — se explica por qué
 * y a dónde ir. */
function PasoDos({ catalogo, terceroId }: { catalogo: CatalogoActividadesIca; terceroId: string }) {
  if (catalogo.opciones.length === 0) {
    return (
      <MensajeEstado tipo="configuracion" titulo="Este municipio no tiene tarifas de ICA cargadas todavía">
        {catalogo.motivoVacio}
        <div className="mt-2 flex flex-wrap gap-3 text-cuerpo">
          <a href="/parametros/reteica-municipios" className="font-semibold text-primario underline dark:text-primario-tinta-oscura">
            Cargar la regla de ReteICA del municipio
          </a>
          <a href="/parametros/tarifas/reteica" className="font-semibold text-primario underline dark:text-primario-tinta-oscura">
            Cargar tarifas por actividad
          </a>
          <a href="/carga-masiva/municipality_ica_rule" className="font-semibold text-primario underline dark:text-primario-tinta-oscura">
            Carga masiva de reglas de ICA
          </a>
        </div>
      </MensajeEstado>
    );
  }

  return (
    <Panel
      titulo={`Paso 2 — ${catalogo.municipalityNombre}`}
      descripcion={
        catalogo.usaTarifaDeActividad
          ? undefined
          : 'Este municipio aplica una tarifa general: la actividad se registra igual, pero la tarifa no depende de cuál elija.'
      }
    >
      <form action={simularAction} className="flex flex-col gap-4 p-4">
        <input type="hidden" name="terceroId" value={terceroId} />
        <input type="hidden" name="municipalityId" value={catalogo.municipalityId} />
        <label className="flex flex-col gap-1.5 text-cuerpo font-medium text-texto">
          Actividad CIIU con tarifa en este municipio *
          <select name="ciiuActivityId" required defaultValue="" className={CTRL}>
            <option value="" disabled>
              Seleccione...
            </option>
            {catalogo.opciones.map((c) => (
              <option key={c.id} value={c.id}>
                {c.codigo} — {c.nombre}
              </option>
            ))}
          </select>
        </label>
        <div className="rounded-md border border-borde px-3">
          <RadioSiNo nombre="esPrincipal" etiqueta="¿Es la actividad principal en este municipio?" />
        </div>
        <label className="flex flex-col gap-1.5 text-cuerpo font-medium text-texto">
          Tarifa ICA propia de este tercero (excepcional; vacío = se resuelve por municipio+actividad en la parametrización)
          <input name="tarifaIcaOverride" type="number" step="any" min={0} max={1} className={CTRL} />
        </label>
        <label className="flex flex-col gap-1.5 text-cuerpo font-medium text-texto">
          Fecha de vigencia (propuesta: hoy) *
          <input name="vigenteDesde" type="date" required defaultValue={hoyIso()} className={CTRL} />
        </label>
        <label className="flex flex-col gap-1.5 text-cuerpo font-medium text-texto">
          Norma de respaldo (obligatoria) *
          <input name="normaRespaldo" type="text" required placeholder="Ej: RIT municipal, certificado de matrícula" className={CTRL} />
        </label>
        <label className="flex flex-col gap-1.5 text-cuerpo font-medium text-texto">
          Notas
          <input name="notas" type="text" className={CTRL} />
        </label>
        <div>
          <Boton tipo="submit">Simular impacto</Boton>
        </div>
      </form>
    </Panel>
  );
}

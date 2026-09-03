/**
 * A8 — Registrar vigencia de atributos fiscales de un tercero (cierre de V-17).
 * Las nueve banderas son radios "Sí/No" SIN opción preseleccionada: no hay
 * valor por defecto (sección 6.2 / D-014). El paso de confirmación muestra el
 * simulador de impacto antes de guardar.
 *
 * D-084 · TAREA 0/3 — migrado al kit. El historial completo se movió a la
 * pestaña «Historial»: aquí solo queda el formulario de vigencia nueva.
 */
import { conSesion } from '../../../lib/sesion';
import {
  hoyIso,
  listarHistorialAtributosFiscales,
  obtenerTercero,
  puedeEditarAtributosFiscales,
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

const CTRL = 'rounded-md border border-borde bg-superficie-elevada px-3 py-2 text-cuerpo text-texto';
const BANDERAS: Array<{ n: string; e: string }> = [
  { n: 'esDeclaranteRenta', e: '¿Es declarante de renta?' },
  { n: 'esAutorretenedorRenta', e: '¿Es autorretenedor de renta?' },
  { n: 'esGranContribuyente', e: '¿Es gran contribuyente?' },
  { n: 'esRegimenSimple', e: '¿Pertenece al régimen SIMPLE?' },
  { n: 'esResponsableIva', e: '¿Es responsable de IVA?' },
  { n: 'esAgenteRetencionRenta', e: '¿Es agente de retención de renta?' },
  { n: 'esAgenteRetencionIva', e: '¿Es agente de retención de IVA?' },
  { n: 'esAgenteRetencionIca', e: '¿Es agente de retención de ICA?' },
  { n: 'esAutorretenedorIca', e: '¿Es autorretenedor de ICA?' },
];
const HIDDEN = [
  'terceroId',
  ...BANDERAS.map((b) => b.n),
  'regimenTributario',
  'vigenteDesde',
  'normaRespaldo',
  'fuente',
  'notas',
];

export default async function PaginaAtributosFiscales({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<BusquedaParams>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const [tercero, historial, puedeEditar] = await conSesion((tx) =>
    Promise.all([
      obtenerTercero(tx, id),
      listarHistorialAtributosFiscales(tx, id),
      puedeEditarAtributosFiscales(tx),
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
  const siNo = (campo: string) => (cadena(sp, campo) === 'si' ? 'Sí' : 'No');

  return (
    <div className="mx-auto max-w-3xl p-5">
      <Encabezado titulo={tercero.razonSocial} descripcion="Atributos fiscales — registrar una vigencia nueva" />
      <TabsTercero id={tercero.id} />
      <MensajeError error={cadena(sp, 'error') || undefined} />

      {!puedeEditar && (
        <MensajeEstado tipo="configuracion" titulo='Su sesión no tiene el permiso "tercero.atributos_fiscales"'>
          Solo puede consultar. El historial está en la pestaña «Historial»
          {historial.length > 0 ? ` (${historial.length} vigencia(s))` : ''}.
        </MensajeEstado>
      )}

      {puedeEditar && !confirmando && (
        <Panel titulo="Vigencia nueva" descripcion="Declare las nueve banderas explícitamente. Ninguna tiene valor por defecto: si deja alguna sin marcar, el guardado se rechaza en vez de asumir «No».">
          <form action={simularAction} className="flex flex-col gap-4 p-4">
            <input type="hidden" name="terceroId" value={tercero.id} />
            <div className="rounded-md border border-borde">
              <div className="border-b border-borde bg-superficie px-3 py-2 text-cuerpo font-semibold text-texto">
                Las nueve banderas
              </div>
              <div className="px-3">
                {BANDERAS.map((b) => (
                  <RadioSiNo key={b.n} nombre={b.n} etiqueta={b.e} />
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-cuerpo font-medium text-texto">
                Régimen tributario
                <select name="regimenTributario" defaultValue="ordinario" className={CTRL}>
                  <option value="ordinario">Ordinario</option>
                  <option value="simple">SIMPLE</option>
                  <option value="especial">Especial</option>
                  <option value="no_contribuyente">No contribuyente</option>
                  <option value="no_residente">No residente</option>
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-cuerpo font-medium text-texto">
                Fecha de vigencia *
                <input name="vigenteDesde" type="date" required defaultValue={hoyIso()} className={CTRL} />
              </label>
              <label className="flex flex-col gap-1.5 text-cuerpo font-medium text-texto">
                Fuente del dato
                <select name="fuente" defaultValue="declarado_por_cliente" className={CTRL}>
                  <option value="rut">RUT</option>
                  <option value="declarado_por_cliente">Declarado por el cliente</option>
                  <option value="factura">Factura</option>
                  <option value="consulta_dian">Consulta DIAN</option>
                  <option value="otro">Otro</option>
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-cuerpo font-medium text-texto sm:col-span-2">
                Norma de respaldo (obligatoria) *
                <input name="normaRespaldo" type="text" required placeholder="Ej: RUT anexo, casilla 53" className={CTRL} />
              </label>
              <label className="flex flex-col gap-1.5 text-cuerpo font-medium text-texto sm:col-span-2">
                Notas
                <input name="notas" type="text" className={CTRL} />
              </label>
            </div>
            <div>
              <Boton tipo="submit">Simular impacto</Boton>
            </div>
          </form>
        </Panel>
      )}

      {puedeEditar && confirmando && (
        <Panel titulo="Confirmar vigencia nueva">
          <div className="flex flex-col gap-3 p-4">
            <MensajeEstado
              tipo="configuracion"
              titulo={`Afecta ${cadena(sp, 'documentosPendientes')} documento(s) pendiente(s) y ${cadena(sp, 'asientosPublicados')} asiento(s) ya publicados de este proveedor (sección 6.2, punto 6).`}
            />
            <ul className="grid grid-cols-1 gap-x-6 gap-y-1 text-cuerpo text-texto sm:grid-cols-2">
              {BANDERAS.map((b) => (
                <li key={b.n}>
                  {b.e.replace('¿', '').replace('?', '')}: {siNo(b.n)}
                </li>
              ))}
              <li>Régimen tributario: {cadena(sp, 'regimenTributario')}</li>
              <li>Vigente desde: {cadena(sp, 'vigenteDesde')}</li>
              <li className="sm:col-span-2">Norma de respaldo: {cadena(sp, 'normaRespaldo')}</li>
            </ul>
            <form action={confirmarAction} className="flex gap-2">
              {HIDDEN.map((campo) => (
                <input key={campo} type="hidden" name={campo} value={cadena(sp, campo)} />
              ))}
              <Boton tipo="submit">Confirmar y guardar</Boton>
              <EnlaceBoton href={`/terceros/${tercero.id}/atributos-fiscales`} variante="fantasma">
                Cancelar
              </EnlaceBoton>
            </form>
          </div>
        </Panel>
      )}
    </div>
  );
}

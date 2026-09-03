/**
 * A8 — Ficha de un tercero: datos generales editables (NO versionados) y un
 * resumen de su situación fiscal vigente, con enlaces a las pestañas de
 * atributos fiscales, actividad económica e historial.
 *
 * D-084 · TAREA 0 — migrado al kit de `app/_ui/`. TAREA 1 — zona de eliminar /
 * inactivar: eliminar solo si el tercero nunca tuvo movimientos; si los tuvo,
 * el botón se deshabilita con la explicación y solo queda inactivar.
 */
import { conSesion } from '../../lib/sesion';
import {
  listarActividadesVigentes,
  listarHistorialAtributosFiscales,
  listarMunicipiosParaSelector,
  obtenerTercero,
  puedeEditarTerceros,
  terceroTieneMovimientos,
} from '../../../src/services/terceros';
import { Badge, Boton, Encabezado, EnlaceBoton, MensajeEstado, Panel } from '../../_ui/componentes';
import { MensajeError, MensajeGuardado, Si } from '../_componentes';
import { TabsTercero } from '../_ui';
import {
  editarDatosAction,
  eliminarTerceroAction,
  inactivarTerceroAction,
  reactivarTerceroAction,
} from './acciones';

export const dynamic = 'force-dynamic';

type BusquedaParams = Record<string, string | string[] | undefined>;
function cadena(sp: BusquedaParams, campo: string): string {
  const v = sp[campo];
  return typeof v === 'string' ? v : '';
}

const TIPOS_DOC: Array<{ v: string; t: string }> = [
  { v: 'NIT', t: 'NIT' },
  { v: 'CC', t: 'Cédula de ciudadanía' },
  { v: 'CE', t: 'Cédula de extranjería' },
  { v: 'PA', t: 'Pasaporte' },
  { v: 'TI', t: 'Tarjeta de identidad' },
  { v: 'NIT_EXTRANJERO', t: 'NIT del exterior' },
  { v: 'PEP', t: 'PEP' },
  { v: 'PPT', t: 'PPT' },
  { v: 'NUIP', t: 'NUIP' },
  { v: 'DEX', t: 'DEX' },
];

const CTRL = 'rounded-md border border-borde bg-superficie-elevada px-3 py-2 text-cuerpo text-texto';

export default async function PaginaTercero({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<BusquedaParams>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const [tercero, municipios, historialFiscal, actividades, puedeEditar, tieneMovimientos] = await conSesion(
    (tx) =>
      Promise.all([
        obtenerTercero(tx, id),
        listarMunicipiosParaSelector(tx),
        listarHistorialAtributosFiscales(tx, id),
        listarActividadesVigentes(tx, id),
        puedeEditarTerceros(tx),
        terceroTieneMovimientos(tx, id),
      ]),
  );

  if (!tercero) {
    return (
      <div className="mx-auto max-w-3xl p-5">
        <MensajeEstado tipo="error" titulo={`No existe (o no es visible para esta sesión) el tercero ${id}.`}>
          <a href="/terceros" className="font-semibold text-primario underline dark:text-primario-tinta-oscura">
            Volver a terceros
          </a>
        </MensajeEstado>
      </div>
    );
  }

  const fiscalVigente = historialFiscal.find((f) => f.vigenteHasta === null) ?? null;

  return (
    <div className="mx-auto max-w-4xl p-5">
      <Encabezado
        titulo={tercero.razonSocial}
        descripcion={
          <span className="tabular-nums">
            {tercero.tipoDocumento} {tercero.numeroDocumento}
            {tercero.digitoVerificacion != null ? `-${tercero.digitoVerificacion}` : ''}
            {' · '}
            {tercero.esDelExterior ? 'Exterior' : tercero.municipalityNombre ?? '⚠ sin municipio'}
          </span>
        }
        acciones={tercero.activo ? <Badge tono="neutro">Activo</Badge> : <Badge tono="error">Inactivo</Badge>}
      />

      <TabsTercero id={tercero.id} />

      <MensajeError error={cadena(sp, 'error') || undefined} />
      <MensajeGuardado visible={cadena(sp, 'ok') === '1'} />

      <div className="flex flex-col gap-4">
        <Panel titulo="Datos generales" descripcion="Maestro de datos mutable — no versionado, no entra en el cálculo de retención.">
          {puedeEditar ? (
            <form action={editarDatosAction} className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
              <input type="hidden" name="terceroId" value={tercero.id} />
              <label className="flex flex-col gap-1.5 text-cuerpo font-medium text-texto">
                Tipo de documento
                <select name="tipoDocumento" defaultValue={tercero.tipoDocumento} className={CTRL}>
                  {TIPOS_DOC.map((d) => (
                    <option key={d.v} value={d.v}>
                      {d.t}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-cuerpo font-medium text-texto">
                Número de documento *
                <input name="numeroDocumento" type="text" required defaultValue={tercero.numeroDocumento} className={`${CTRL} tabular-nums`} />
              </label>
              <label className="flex flex-col gap-1.5 text-cuerpo font-medium text-texto">
                Dígito de verificación
                <input name="digitoVerificacion" type="number" min={0} max={9} defaultValue={tercero.digitoVerificacion ?? ''} className={CTRL} />
              </label>
              <label className="flex flex-col gap-1.5 text-cuerpo font-medium text-texto">
                Tipo de persona
                <select name="tipoPersona" defaultValue={tercero.tipoPersona} className={CTRL}>
                  <option value="juridica">Jurídica</option>
                  <option value="natural">Natural</option>
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-cuerpo font-medium text-texto sm:col-span-2">
                Razón social / nombre *
                <input name="razonSocial" type="text" required defaultValue={tercero.razonSocial} className={CTRL} />
              </label>
              <fieldset className="flex flex-col gap-1.5 sm:col-span-2">
                <legend className="text-cuerpo font-medium text-texto">¿Es del exterior?</legend>
                <div className="flex gap-4 text-cuerpo text-texto">
                  <label className="flex items-center gap-1.5">
                    <input type="radio" name="esDelExterior" value="false" defaultChecked={!tercero.esDelExterior} /> No
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="radio" name="esDelExterior" value="true" defaultChecked={tercero.esDelExterior} /> Sí
                  </label>
                </div>
              </fieldset>
              <label className="flex flex-col gap-1.5 text-cuerpo font-medium text-texto">
                Dirección {!tercero.esDelExterior && '*'}
                <input name="direccion" type="text" defaultValue={tercero.direccion ?? ''} className={CTRL} />
              </label>
              <label className="flex flex-col gap-1.5 text-cuerpo font-medium text-texto">
                Municipio {!tercero.esDelExterior && '*'}
                <select name="municipalityId" defaultValue={tercero.municipalityId ?? ''} className={CTRL}>
                  <option value="">— (obligatorio salvo exterior)</option>
                  {municipios.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nombre} ({m.codigo})
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-cuerpo font-medium text-texto">
                País (ISO-2, si es del exterior)
                <input name="pais" type="text" maxLength={2} defaultValue={tercero.pais} className={CTRL} />
              </label>
              <label className="flex flex-col gap-1.5 text-cuerpo font-medium text-texto">
                Correo
                <input name="email" type="email" defaultValue={tercero.email ?? ''} className={CTRL} />
              </label>
              <label className="flex flex-col gap-1.5 text-cuerpo font-medium text-texto">
                Teléfono
                <input name="telefono" type="text" defaultValue={tercero.telefono ?? ''} className={CTRL} />
              </label>
              <div className="sm:col-span-2">
                <Boton tipo="submit">Guardar datos generales</Boton>
              </div>
            </form>
          ) : (
            <div className="p-4 text-cuerpo text-texto-suave">
              Dirección: {tercero.direccion ?? '—'} · Municipio: {tercero.municipalityNombre ?? '—'} · Código DANE:{' '}
              {tercero.codigoDane ?? '—'} · Correo: {tercero.email ?? '—'}
            </div>
          )}
        </Panel>

        <Panel
          titulo="Situación fiscal vigente"
          descripcion="Solo el valor vigente hoy. El historial completo está en la pestaña «Historial»."
          acciones={
            <EnlaceBoton href={`/terceros/${tercero.id}/atributos-fiscales`} variante="secundario">
              {fiscalVigente ? 'Registrar vigencia nueva' : 'Declarar atributos fiscales'}
            </EnlaceBoton>
          }
        >
          {fiscalVigente ? (
            <ul className="grid grid-cols-1 gap-x-6 gap-y-1.5 p-4 text-cuerpo text-texto sm:grid-cols-2">
              <li>Declarante de renta: <Si valor={fiscalVigente.esDeclaranteRenta} /></li>
              <li>Autorretenedor de renta: <Si valor={fiscalVigente.esAutorretenedorRenta} /></li>
              <li>Gran contribuyente: <Si valor={fiscalVigente.esGranContribuyente} /></li>
              <li>Régimen SIMPLE: <Si valor={fiscalVigente.esRegimenSimple} /></li>
              <li>Responsable de IVA: <Si valor={fiscalVigente.esResponsableIva} /></li>
              <li>Agente de retención (renta): <Si valor={fiscalVigente.esAgenteRetencionRenta} /></li>
              <li>Agente de retención (IVA): <Si valor={fiscalVigente.esAgenteRetencionIva} /></li>
              <li>Agente de retención (ICA): <Si valor={fiscalVigente.esAgenteRetencionIca} /></li>
              <li>Autorretenedor de ICA: <Si valor={fiscalVigente.esAutorretenedorIca} /></li>
              <li>Régimen tributario: {fiscalVigente.regimenTributario}</li>
              <li className="sm:col-span-2 text-texto-suave">
                Vigente desde {fiscalVigente.vigenteDesde} · respaldo: «{fiscalVigente.normaRespaldo}»
              </li>
            </ul>
          ) : (
            <div className="p-4">
              <MensajeEstado tipo="configuracion" titulo="Sin ninguna vigencia fiscal hoy">
                No hay valor por omisión (sección 6.2): el motor manda a revisión manual cualquier documento de
                este tercero hasta que se declaren las nueve banderas explícitamente.
              </MensajeEstado>
            </div>
          )}
        </Panel>

        <Panel
          titulo="Actividad económica por municipio (ReteICA)"
          descripcion="Vigentes hoy. El historial completo está en la pestaña «Historial»."
          acciones={
            <EnlaceBoton href={`/terceros/${tercero.id}/actividades`} variante="secundario">
              Registrar actividad
            </EnlaceBoton>
          }
        >
          {actividades.length > 0 ? (
            <ul className="flex flex-col gap-1.5 p-4 text-cuerpo text-texto">
              {actividades.map((a) => (
                <li key={a.id}>
                  {a.municipalityNombre} — CIIU {a.ciiuCodigo} ({a.ciiuNombre})
                  {a.esPrincipal ? ' · PRINCIPAL' : ''} · desde {a.vigenteDesde}
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-4 text-cuerpo text-texto-suave">Sin actividad económica registrada en ningún municipio.</p>
          )}
        </Panel>

        {puedeEditar && (
          <Panel titulo="Eliminar o inactivar">
            <div className="flex flex-col gap-3 p-4">
              {tieneMovimientos ? (
                <MensajeEstado tipo="configuracion" titulo="Este tercero tiene movimientos: no se puede eliminar">
                  Aparece en el ledger, en un documento soporte, en una retención aplicada, o tiene una vigencia
                  fiscal en firme. Borrarlo rompería la trazabilidad, la exógena y los certificados de retención
                  que lo citan por su id. El único camino es <strong>inactivarlo</strong>: sigue en la base, pero
                  deja de ofrecerse en los selectores.
                </MensajeEstado>
              ) : (
                <p className="text-cuerpo text-texto-suave">
                  Este tercero nunca ha tenido movimientos, así que se puede eliminar por completo. Si prefiere
                  conservarlo, inactívelo.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {tercero.activo ? (
                  <form action={inactivarTerceroAction}>
                    <input type="hidden" name="terceroId" value={tercero.id} />
                    <Boton tipo="submit" variante="fantasma">
                      Inactivar tercero
                    </Boton>
                  </form>
                ) : (
                  <form action={reactivarTerceroAction}>
                    <input type="hidden" name="terceroId" value={tercero.id} />
                    <Boton tipo="submit" variante="fantasma">
                      Reactivar tercero
                    </Boton>
                  </form>
                )}
                <form action={eliminarTerceroAction}>
                  <input type="hidden" name="terceroId" value={tercero.id} />
                  <Boton
                    tipo="submit"
                    variante="peligro"
                    disabled={tieneMovimientos}
                    title={
                      tieneMovimientos
                        ? 'No se puede eliminar un tercero con movimientos asociados'
                        : undefined
                    }
                  >
                    Eliminar tercero
                  </Boton>
                </form>
              </div>
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}

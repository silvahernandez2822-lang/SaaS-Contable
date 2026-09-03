/**
 * A8 — Crear tercero (cierre de V-17). Dirección y municipio obligatorios salvo
 * "del exterior": es la exigencia concreta que bloqueaba el Formato 1001
 * (Res. 000227/2025, art. 1.3.5.2.1) y debe capturarse desde aquí.
 *
 * D-084 · TAREA 0 — migrado al kit de `app/_ui/`.
 */
import { conSesion } from '../../lib/sesion';
import { listarGeografiaParaSelector, puedeEditarTerceros } from '../../../src/services/terceros';
import { Boton, Encabezado, EnlaceBoton, MensajeEstado, Panel } from '../../_ui/componentes';
import { MensajeError } from '../_componentes';
import { CampoDireccionDian, SelectorGeografia } from '../_direccion-dian';
import {
  normalizarDireccionDian,
  validarDireccionDian,
  type DireccionDian,
} from '../../../src/domain/direccion-dian';
import { crearAction } from './acciones';

export const dynamic = 'force-dynamic';

type BusquedaParams = Record<string, string | string[] | undefined>;
function cadena(sp: BusquedaParams, campo: string): string {
  const v = sp[campo];
  return typeof v === 'string' ? v : '';
}

/** A14/D-086: recupera el desglose que la acción devuelve tras un error, para
 *  que el contador no pierda la dirección que ya compuso en el modal. */
function desgloseDe(crudo: string): DireccionDian | null {
  if (!crudo) return null;
  try {
    const d = JSON.parse(crudo) as DireccionDian;
    return validarDireccionDian(d).length === 0 ? normalizarDireccionDian(d) : null;
  } catch {
    return null;
  }
}

const CTRL = 'rounded-md border border-borde bg-superficie-elevada px-3 py-2 text-cuerpo text-texto';

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

export default async function PaginaNuevoTercero({
  searchParams,
}: {
  searchParams: Promise<BusquedaParams>;
}) {
  const sp = await searchParams;
  const [geografia, puedeEditar] = await conSesion((tx) =>
    Promise.all([listarGeografiaParaSelector(tx), puedeEditarTerceros(tx)]),
  );
  const esDelExterior = cadena(sp, 'esDelExterior') === 'true';

  if (!puedeEditar) {
    return (
      <div className="mx-auto max-w-2xl p-5">
        <MensajeEstado tipo="configuracion" titulo='Su sesión no tiene el permiso "tercero.editar"'>
          No puede crear terceros.{' '}
          <a href="/terceros" className="font-semibold text-primario underline dark:text-primario-tinta-oscura">
            Volver a terceros
          </a>
        </MensajeEstado>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-5">
      <Encabezado
        titulo="Crear tercero"
        descripcion="El Formato 1001 de exógena exige la dirección y el municipio del informado desde ya, no al cierre del año."
        acciones={
          <EnlaceBoton href="/terceros" variante="fantasma">
            Volver
          </EnlaceBoton>
        }
      />

      <MensajeError error={cadena(sp, 'error') || undefined} />

      <Panel>
        <form action={crearAction} className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-cuerpo font-medium text-texto">
            Tipo de documento
            <select name="tipoDocumento" defaultValue={cadena(sp, 'tipoDocumento') || 'NIT'} className={CTRL}>
              {TIPOS_DOC.map((d) => (
                <option key={d.v} value={d.v}>
                  {d.t}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-cuerpo font-medium text-texto">
            Número de documento *
            <input name="numeroDocumento" type="text" required defaultValue={cadena(sp, 'numeroDocumento')} className={`${CTRL} tabular-nums`} />
          </label>
          <label className="flex flex-col gap-1.5 text-cuerpo font-medium text-texto">
            Dígito de verificación (si aplica)
            <input name="digitoVerificacion" type="number" min={0} max={9} defaultValue={cadena(sp, 'digitoVerificacion')} className={CTRL} />
          </label>
          <label className="flex flex-col gap-1.5 text-cuerpo font-medium text-texto">
            Tipo de persona
            <select name="tipoPersona" defaultValue={cadena(sp, 'tipoPersona') || 'juridica'} className={CTRL}>
              <option value="juridica">Jurídica</option>
              <option value="natural">Natural</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-cuerpo font-medium text-texto sm:col-span-2">
            Razón social / nombre *
            <input name="razonSocial" type="text" required defaultValue={cadena(sp, 'razonSocial')} className={CTRL} />
          </label>

          <fieldset className="flex flex-col gap-1.5 sm:col-span-2">
            <legend className="text-cuerpo font-medium text-texto">¿Es del exterior?</legend>
            <div className="flex gap-4 text-cuerpo text-texto">
              <label className="flex items-center gap-1.5">
                <input type="radio" name="esDelExterior" value="false" defaultChecked={!esDelExterior} /> No
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" name="esDelExterior" value="true" defaultChecked={esDelExterior} /> Sí, del exterior
              </label>
            </div>
          </fieldset>

          {!esDelExterior ? (
            <>
              <SelectorGeografia
                departamentos={geografia.departamentos}
                municipios={geografia.municipios}
                municipalityIdInicial={cadena(sp, 'municipalityId') || null}
                requerido
              />
              <CampoDireccionDian
                direccionInicial={cadena(sp, 'direccion') || null}
                estructuraInicial={desgloseDe(cadena(sp, 'direccionDian'))}
                requerido
              />
            </>
          ) : (
            <label className="flex flex-col gap-1.5 text-cuerpo font-medium text-texto">
              País (ISO-2)
              <input name="pais" type="text" maxLength={2} defaultValue={cadena(sp, 'pais') || ''} className={CTRL} />
            </label>
          )}

          <label className="flex flex-col gap-1.5 text-cuerpo font-medium text-texto">
            Correo
            <input name="email" type="email" defaultValue={cadena(sp, 'email')} className={CTRL} />
          </label>
          <label className="flex flex-col gap-1.5 text-cuerpo font-medium text-texto">
            Teléfono
            <input name="telefono" type="text" defaultValue={cadena(sp, 'telefono')} className={CTRL} />
          </label>

          <div className="sm:col-span-2">
            <Boton tipo="submit">Crear tercero</Boton>
          </div>
        </form>
      </Panel>
    </div>
  );
}

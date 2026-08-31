/**
 * A8 — Crear tercero (cierre de V-17). Dirección y municipio son
 * obligatorios salvo "del exterior": es la exigencia concreta que bloqueaba
 * el Formato 1001 (Res. 000227/2025, art. 1.3.5.2.1) y que debe capturarse
 * desde aquí, no al cierre del año.
 */
import Link from 'next/link';
import { conSesion } from '../../lib/sesion';
import { listarMunicipiosParaSelector, puedeEditarTerceros } from '../../../src/services/terceros';
import { MensajeError } from '../_componentes';
import { crearAction } from './acciones';

export const dynamic = 'force-dynamic';

type BusquedaParams = Record<string, string | string[] | undefined>;

function cadena(sp: BusquedaParams, campo: string): string {
  const v = sp[campo];
  return typeof v === 'string' ? v : '';
}

export default async function PaginaNuevoTercero({
  searchParams,
}: {
  searchParams: Promise<BusquedaParams>;
}) {
  const sp = await searchParams;
  const [municipios, puedeEditar] = await conSesion((tx) =>
    Promise.all([listarMunicipiosParaSelector(tx), puedeEditarTerceros(tx)]),
  );
  const esDelExterior = cadena(sp, 'esDelExterior') === 'true';

  if (!puedeEditar) {
    return (
      <main style={{ maxWidth: 700, margin: '0 auto', padding: '24px' }}>
        <p>
          <Link href="/terceros">« Volver</Link>
        </p>
        <p>Su sesión no tiene el permiso "tercero.editar": no puede crear terceros.</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 700, margin: '0 auto', padding: '24px' }}>
      <p>
        <Link href="/terceros">« Volver</Link>
      </p>
      <h1>Crear tercero</h1>

      <MensajeError error={cadena(sp, 'error') || undefined} />

      <form action={crearAction}>
        <div>
          <label>
            Tipo de documento{' '}
            <select name="tipoDocumento" defaultValue={cadena(sp, 'tipoDocumento') || 'NIT'}>
              <option value="NIT">NIT</option>
              <option value="CC">Cédula de ciudadanía</option>
              <option value="CE">Cédula de extranjería</option>
              <option value="PA">Pasaporte</option>
              <option value="TI">Tarjeta de identidad</option>
              <option value="NIT_EXTRANJERO">NIT del exterior</option>
              <option value="PEP">PEP</option>
              <option value="PPT">PPT</option>
              <option value="NUIP">NUIP</option>
              <option value="DEX">DEX</option>
            </select>
          </label>
        </div>
        <div>
          <label>
            Número de documento *{' '}
            <input name="numeroDocumento" type="text" required defaultValue={cadena(sp, 'numeroDocumento')} />
          </label>
        </div>
        <div>
          <label>
            Dígito de verificación (si aplica){' '}
            <input
              name="digitoVerificacion"
              type="number"
              min={0}
              max={9}
              defaultValue={cadena(sp, 'digitoVerificacion')}
            />
          </label>
        </div>
        <div>
          <label>
            Tipo de persona{' '}
            <select name="tipoPersona" defaultValue={cadena(sp, 'tipoPersona') || 'juridica'}>
              <option value="juridica">Jurídica</option>
              <option value="natural">Natural</option>
            </select>
          </label>
        </div>
        <div>
          <label>
            Razón social / nombre *{' '}
            <input name="razonSocial" type="text" required size={50} defaultValue={cadena(sp, 'razonSocial')} />
          </label>
        </div>

        <fieldset style={{ margin: '12px 0' }}>
          <legend>¿Es del exterior?</legend>
          <label style={{ marginRight: '12px' }}>
            <input type="radio" name="esDelExterior" value="false" defaultChecked={!esDelExterior} /> No
          </label>
          <label>
            <input type="radio" name="esDelExterior" value="true" defaultChecked={esDelExterior} /> Sí, del exterior
          </label>
        </fieldset>

        {!esDelExterior && (
          <>
            <p>
              <strong>Obligatorios</strong>: el Formato 1001 de exógena exige la dirección y el
              código DANE del municipio del informado, y deben quedar capturados desde ya.
            </p>
            <div>
              <label>
                Dirección *{' '}
                <input name="direccion" type="text" required size={50} defaultValue={cadena(sp, 'direccion')} />
              </label>
            </div>
            <div>
              <label>
                Municipio *{' '}
                <select name="municipalityId" required defaultValue={cadena(sp, 'municipalityId')}>
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
            </div>
          </>
        )}
        {esDelExterior && (
          <div>
            <label>
              País (ISO-2){' '}
              <input name="pais" type="text" maxLength={2} defaultValue={cadena(sp, 'pais') || ''} />
            </label>
          </div>
        )}

        <div>
          <label>
            Correo <input name="email" type="email" defaultValue={cadena(sp, 'email')} />
          </label>
        </div>
        <div>
          <label>
            Teléfono <input name="telefono" type="text" defaultValue={cadena(sp, 'telefono')} />
          </label>
        </div>

        <button type="submit" style={{ marginTop: '12px' }}>
          Crear tercero
        </button>
      </form>
    </main>
  );
}

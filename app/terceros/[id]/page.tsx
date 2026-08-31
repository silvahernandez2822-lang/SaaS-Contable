/**
 * A8 — Detalle de un tercero (cierre de V-17): datos generales editables
 * (NO versionados) y un resumen con enlaces a los dos módulos versionados
 * (atributos fiscales y actividad económica por municipio).
 */
import Link from 'next/link';
import { conSesion } from '../../lib/sesion';
import {
  obtenerTercero,
  listarMunicipiosParaSelector,
  listarHistorialAtributosFiscales,
  listarActividadesVigentes,
  puedeEditarTerceros,
} from '../../../src/services/terceros';
import { MensajeError, Si } from '../_componentes';
import { editarDatosAction } from './acciones';

export const dynamic = 'force-dynamic';

type BusquedaParams = Record<string, string | string[] | undefined>;
function cadena(sp: BusquedaParams, campo: string): string {
  const v = sp[campo];
  return typeof v === 'string' ? v : '';
}

export default async function PaginaTercero({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<BusquedaParams>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const [tercero, municipios, historialFiscal, actividades, puedeEditar] = await conSesion((tx) =>
    Promise.all([
      obtenerTercero(tx, id),
      listarMunicipiosParaSelector(tx),
      listarHistorialAtributosFiscales(tx, id),
      listarActividadesVigentes(tx, id),
      puedeEditarTerceros(tx),
    ]),
  );

  if (!tercero) {
    return (
      <main style={{ maxWidth: 800, margin: '0 auto', padding: '24px' }}>
        <p>
          <Link href="/terceros">« Volver</Link>
        </p>
        <p>No existe (o no es visible para esta sesión) el tercero {id}.</p>
      </main>
    );
  }

  const fiscalVigente = historialFiscal.find((f) => f.vigenteHasta === null) ?? null;

  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: '24px' }}>
      <p>
        <Link href="/terceros">« Volver a terceros</Link>
      </p>
      <h1>{tercero.razonSocial}</h1>
      <p>
        {tercero.tipoDocumento} {tercero.numeroDocumento}
        {tercero.digitoVerificacion != null ? `-${tercero.digitoVerificacion}` : ''}
      </p>

      <MensajeError error={cadena(sp, 'error') || undefined} />
      {cadena(sp, 'ok') === '1' && (
        <p style={{ color: '#166534', border: '1px solid #166534', padding: '8px 12px' }}>Guardado.</p>
      )}

      <section style={{ border: '1px solid #334155', padding: '16px', margin: '16px 0' }}>
        <h2>Datos generales</h2>
        {puedeEditar ? (
          <form action={editarDatosAction}>
            <input type="hidden" name="terceroId" value={tercero.id} />
            <div>
              <label>
                Tipo de documento{' '}
                <select name="tipoDocumento" defaultValue={tercero.tipoDocumento}>
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
                <input name="numeroDocumento" type="text" required defaultValue={tercero.numeroDocumento} />
              </label>
            </div>
            <div>
              <label>
                Dígito de verificación{' '}
                <input
                  name="digitoVerificacion"
                  type="number"
                  min={0}
                  max={9}
                  defaultValue={tercero.digitoVerificacion ?? ''}
                />
              </label>
            </div>
            <div>
              <label>
                Tipo de persona{' '}
                <select name="tipoPersona" defaultValue={tercero.tipoPersona}>
                  <option value="juridica">Jurídica</option>
                  <option value="natural">Natural</option>
                </select>
              </label>
            </div>
            <div>
              <label>
                Razón social / nombre *{' '}
                <input name="razonSocial" type="text" required size={50} defaultValue={tercero.razonSocial} />
              </label>
            </div>
            <fieldset style={{ margin: '12px 0' }}>
              <legend>¿Es del exterior?</legend>
              <label style={{ marginRight: '12px' }}>
                <input type="radio" name="esDelExterior" value="false" defaultChecked={!tercero.esDelExterior} /> No
              </label>
              <label>
                <input type="radio" name="esDelExterior" value="true" defaultChecked={tercero.esDelExterior} /> Sí
              </label>
            </fieldset>
            <div>
              <label>
                Dirección {!tercero.esDelExterior && '*'}{' '}
                <input name="direccion" type="text" size={50} defaultValue={tercero.direccion ?? ''} />
              </label>
            </div>
            <div>
              <label>
                Municipio {!tercero.esDelExterior && '*'}{' '}
                <select name="municipalityId" defaultValue={tercero.municipalityId ?? ''}>
                  <option value="">— (obligatorio salvo exterior)</option>
                  {municipios.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nombre} ({m.codigo})
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div>
              <label>
                País (ISO-2, si es del exterior){' '}
                <input name="pais" type="text" maxLength={2} defaultValue={tercero.pais} />
              </label>
            </div>
            <div>
              <label>
                Correo <input name="email" type="email" defaultValue={tercero.email ?? ''} />
              </label>
            </div>
            <div>
              <label>
                Teléfono <input name="telefono" type="text" defaultValue={tercero.telefono ?? ''} />
              </label>
            </div>
            <button type="submit" style={{ marginTop: '8px' }}>
              Guardar datos generales
            </button>
          </form>
        ) : (
          <p>
            Dirección: {tercero.direccion ?? '—'} · Municipio: {tercero.municipalityNombre ?? '—'} · Código DANE:{' '}
            {tercero.codigoDane ?? '—'}
          </p>
        )}
      </section>

      <section style={{ border: '1px solid #334155', padding: '16px', margin: '16px 0' }}>
        <h2>Atributos fiscales (vigencia)</h2>
        {fiscalVigente ? (
          <ul>
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
            <li>
              Vigente desde {fiscalVigente.vigenteDesde}, respaldado en «{fiscalVigente.normaRespaldo}»
            </li>
          </ul>
        ) : (
          <p style={{ color: '#b45309' }}>
            <strong>⚠ Sin ninguna vigencia hoy.</strong> No hay valor por omisión (sección 6.2): el motor manda
            a revisión manual cualquier documento de este tercero hasta que se declaren explícitamente.
          </p>
        )}
        <p>
          <Link href={`/terceros/${tercero.id}/atributos-fiscales`}>
            {fiscalVigente ? 'Registrar vigencia nueva' : 'Declarar atributos fiscales'}
          </Link>
          {historialFiscal.length > 0 && ` · ${historialFiscal.length} vigencia(s) en el historial`}
        </p>
      </section>

      <section style={{ border: '1px solid #334155', padding: '16px', margin: '16px 0' }}>
        <h2>Actividad económica por municipio (ReteICA)</h2>
        {actividades.length > 0 ? (
          <table style={{ borderCollapse: 'collapse' }} border={1} cellPadding={4}>
            <thead>
              <tr>
                <th>Municipio</th>
                <th>CIIU</th>
                <th>Principal</th>
                <th>Vigente desde</th>
              </tr>
            </thead>
            <tbody>
              {actividades.map((a) => (
                <tr key={a.id}>
                  <td>{a.municipalityNombre}</td>
                  <td>{a.ciiuCodigo} — {a.ciiuNombre}</td>
                  <td><Si valor={a.esPrincipal} /></td>
                  <td>{a.vigenteDesde}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>Sin actividad económica registrada en ningún municipio.</p>
        )}
        <p>
          <Link href={`/terceros/${tercero.id}/actividades`}>Registrar actividad en un municipio</Link>
        </p>
      </section>
    </main>
  );
}

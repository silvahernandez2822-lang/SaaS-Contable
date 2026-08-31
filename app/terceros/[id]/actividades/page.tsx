/**
 * A8 — Registrar actividad económica de un tercero en un municipio (ReteICA
 * multimunicipio, cierre de V-17). Un proveedor puede tener actividad
 * vigente en varios municipios a la vez: cada terna tercero×municipio×CIIU
 * se versiona por separado (ver `registrarActividad` en el servicio).
 */
import Link from 'next/link';
import { conSesion } from '../../../lib/sesion';
import {
  obtenerTercero,
  listarActividadesVigentes,
  listarMunicipiosParaSelector,
  listarCiiuParaSelector,
  hoyIso,
  puedeEditarAtributosFiscales,
} from '../../../../src/services/terceros';
import { MensajeError, RadioSiNo, Si } from '../../_componentes';
import { confirmarAction, simularAction } from './acciones';

export const dynamic = 'force-dynamic';

type BusquedaParams = Record<string, string | string[] | undefined>;
function cadena(sp: BusquedaParams, campo: string): string {
  const v = sp[campo];
  return typeof v === 'string' ? v : '';
}

export default async function PaginaActividades({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<BusquedaParams>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const [tercero, actividades, municipios, actividadesCiiu, puedeEditar] = await conSesion((tx) =>
    Promise.all([
      obtenerTercero(tx, id),
      listarActividadesVigentes(tx, id),
      listarMunicipiosParaSelector(tx),
      listarCiiuParaSelector(tx),
      puedeEditarAtributosFiscales(tx),
    ]),
  );

  if (!tercero) {
    return (
      <main style={{ maxWidth: 800, margin: '0 auto', padding: '24px' }}>
        <p>No existe (o no es visible para esta sesión) el tercero {id}.</p>
      </main>
    );
  }

  const confirmando = cadena(sp, 'confirmar') === '1';
  const municipioNombre = (mid: string) => municipios.find((m) => m.id === mid)?.nombre ?? mid;
  const ciiuTexto = (cid: string) => {
    const c = actividadesCiiu.find((x) => x.id === cid);
    return c ? `${c.codigo} — ${c.nombre}` : cid;
  };

  return (
    <main style={{ maxWidth: 800, margin: '0 auto', padding: '24px' }}>
      <p>
        <Link href={`/terceros/${id}`}>« Volver a {tercero.razonSocial}</Link>
      </p>
      <h1>Actividad económica por municipio — {tercero.razonSocial}</h1>

      <MensajeError error={cadena(sp, 'error') || undefined} />

      <h2>Vigentes hoy</h2>
      {actividades.length > 0 ? (
        <ul>
          {actividades.map((a) => (
            <li key={a.id}>
              {a.municipalityNombre} — CIIU {a.ciiuCodigo} ({a.ciiuNombre}){a.esPrincipal ? ' — PRINCIPAL' : ''}, desde{' '}
              {a.vigenteDesde}
            </li>
          ))}
        </ul>
      ) : (
        <p>Sin actividad económica registrada en ningún municipio.</p>
      )}

      {!puedeEditar && <p>Su sesión no tiene el permiso "tercero.atributos_fiscales": no puede registrar actividad nueva.</p>}

      {puedeEditar && !confirmando && (
        <form action={simularAction} style={{ border: '1px solid #334155', padding: '16px', marginTop: '16px' }}>
          <input type="hidden" name="terceroId" value={tercero.id} />
          <p>
            Un proveedor puede tener actividad vigente en varios municipios a la vez: registrar aquí una terna
            municipio+CIIU nueva no cierra las demás. Si ya existe una vigencia abierta para EXACTAMENTE el
            mismo municipio y CIIU, esto la reemplaza (cierra la anterior e inserta la nueva).
          </p>
          <div>
            <label>
              Municipio *{' '}
              <select name="municipalityId" required defaultValue="">
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
          <div>
            <label>
              Actividad CIIU *{' '}
              <select name="ciiuActivityId" required defaultValue="">
                <option value="" disabled>
                  Seleccione...
                </option>
                {actividadesCiiu.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.codigo} — {c.nombre}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <RadioSiNo nombre="esPrincipal" etiqueta="¿Es la actividad principal en este municipio?" />
          <div>
            <label>
              Tarifa ICA propia de este tercero (excepcional; vacío = se resuelve por municipio+actividad en
              la parametrización tributaria){' '}
              <input name="tarifaIcaOverride" type="number" step="any" min={0} max={1} />
            </label>
          </div>
          <div>
            <label>
              Fecha de vigencia (propuesta: hoy) *{' '}
              <input name="vigenteDesde" type="date" required defaultValue={hoyIso()} />
            </label>
          </div>
          <div>
            <label>
              Norma de respaldo (obligatoria) *{' '}
              <input name="normaRespaldo" type="text" required size={60} placeholder="Ej: RIT municipal, certificado de matrícula" />
            </label>
          </div>
          <div>
            <label>
              Notas <input name="notas" type="text" size={60} />
            </label>
          </div>
          <button type="submit" style={{ marginTop: '12px' }}>
            Simular impacto
          </button>
        </form>
      )}

      {puedeEditar && confirmando && (
        <section style={{ border: '1px solid #334155', padding: '16px', marginTop: '16px' }}>
          <h2>Confirmar vigencia nueva</h2>
          <p>
            <strong>
              Esta actividad afecta {cadena(sp, 'documentosPendientes')} documento(s) de este proveedor aún
              pendientes de causación y {cadena(sp, 'asientosPublicados')} asiento(s) de ReteICA suyos ya
              publicados en este municipio (sección 6.2, punto 6).
            </strong>
          </p>
          <ul>
            <li>Municipio: {municipioNombre(cadena(sp, 'municipalityId'))}</li>
            <li>Actividad: {ciiuTexto(cadena(sp, 'ciiuActivityId'))}</li>
            <li>Principal: <Si valor={cadena(sp, 'esPrincipal') === 'si'} /></li>
            <li>Vigente desde: {cadena(sp, 'vigenteDesde')}</li>
            <li>Norma de respaldo: {cadena(sp, 'normaRespaldo')}</li>
          </ul>
          <form action={confirmarAction}>
            {[
              'terceroId',
              'municipalityId',
              'ciiuActivityId',
              'esPrincipal',
              'tarifaIcaOverride',
              'vigenteDesde',
              'normaRespaldo',
              'notas',
            ].map((campo) => (
              <input key={campo} type="hidden" name={campo} value={cadena(sp, campo)} />
            ))}
            <button type="submit">Confirmar y guardar</button>
          </form>
        </section>
      )}
    </main>
  );
}

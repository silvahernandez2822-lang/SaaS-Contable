/**
 * A8 — Registrar actividad económica de un tercero en un municipio (ReteICA
 * multimunicipio, cierre de V-17). Un proveedor puede tener actividad
 * vigente en varios municipios a la vez: cada terna tercero×municipio×CIIU
 * se versiona por separado (ver `registrarActividad` en el servicio).
 *
 * A16 (Ola 4, Tarea 5) — SELECTOR EN CASCADA. Hasta esta ola el selector de
 * actividad mostraba las MISMAS opciones para cualquier municipio, porque la
 * página pedía el catálogo CIIU completo. Ahora el formulario tiene DOS pasos
 * explícitos:
 *
 *   1. Elegir municipio y recargar (`method="get"`, sin acción de servidor:
 *      es una consulta, no una escritura, y así la URL queda compartible y el
 *      botón «atrás» del navegador funciona).
 *   2. Con el municipio ya fijado, elegir entre las actividades que TIENEN
 *      tarifa de ReteICA cargada para ESE municipio.
 *
 * Si el municipio no tiene ninguna, no se muestra una lista vacía: se muestra
 * el motivo exacto y a dónde ir a cargarla (`motivoVacio` del servicio).
 */
import Link from 'next/link';
import { conSesion } from '../../../lib/sesion';
import {
  obtenerTercero,
  listarActividadesVigentes,
  listarMunicipiosParaSelector,
  listarActividadesIcaDeMunicipio,
  hoyIso,
  puedeEditarAtributosFiscales,
  type CatalogoActividadesIca,
} from '../../../../src/services/terceros';
import { MensajeError, RadioSiNo, Si } from '../../_componentes';
import { confirmarAction, simularAction } from './acciones';

export const dynamic = 'force-dynamic';

type BusquedaParams = Record<string, string | string[] | undefined>;
function cadena(sp: BusquedaParams, campo: string): string {
  const v = sp[campo];
  return typeof v === 'string' ? v : '';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  const [tercero, actividades, municipios, puedeEditar, catalogoIca] = await conSesion((tx) =>
    Promise.all([
      obtenerTercero(tx, id),
      listarActividadesVigentes(tx, id),
      listarMunicipiosParaSelector(tx),
      puedeEditarAtributosFiscales(tx),
      municipioElegido
        ? listarActividadesIcaDeMunicipio(tx, municipioElegido).catch(() => null)
        : Promise.resolve(null),
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
    const c = catalogoIca?.opciones.find((x) => x.id === cid);
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

      {!puedeEditar && (
        <p>Su sesión no tiene el permiso "tercero.atributos_fiscales": no puede registrar actividad nueva.</p>
      )}

      {puedeEditar && !confirmando && (
        <>
          <h2>Registrar actividad nueva</h2>
          <p>
            Un proveedor puede tener actividad vigente en varios municipios a la vez: registrar aquí una terna
            municipio+CIIU nueva no cierra las demás. Si ya existe una vigencia abierta para EXACTAMENTE el
            mismo municipio y CIIU, esto la reemplaza (cierra la anterior e inserta la nueva).
          </p>

          <form method="get" style={{ border: '1px solid #334155', padding: '16px' }}>
            <label>
              <strong>Paso 1 — Municipio *</strong>{' '}
              <select name="municipalityId" defaultValue={municipioElegido} required>
                <option value="" disabled>
                  Seleccione...
                </option>
                {municipios.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nombre} ({m.codigo})
                  </option>
                ))}
              </select>
            </label>{' '}
            <button type="submit">Ver actividades de este municipio</button>
            <p style={{ fontSize: 13, color: '#475569', margin: '8px 0 0' }}>
              Las actividades económicas que se pueden registrar dependen del municipio: solo se ofrecen las
              que tienen tarifa de ReteICA cargada para él.
            </p>
          </form>

          {catalogoIca === null && municipioElegido !== '' && (
            <p role="alert" style={{ color: '#b91c1c' }}>
              El municipio seleccionado no existe o no es visible para esta sesión.
            </p>
          )}

          {catalogoIca && <PasoDos catalogo={catalogoIca} terceroId={tercero.id} />}
        </>
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
            <li>
              Principal: <Si valor={cadena(sp, 'esPrincipal') === 'si'} />
            </li>
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

/**
 * Paso 2: solo aparece con un municipio ya elegido. Cuando ese municipio no
 * tiene tarifas cargadas NO se pinta un desplegable vacío — se explica por qué
 * está vacío y adónde ir, que era exactamente el defecto reportado.
 */
function PasoDos({ catalogo, terceroId }: { catalogo: CatalogoActividadesIca; terceroId: string }) {
  if (catalogo.opciones.length === 0) {
    return (
      <section
        role="alert"
        style={{ border: '1px solid #b45309', background: '#fffbeb', padding: '12px 16px', marginTop: 16 }}
      >
        <strong>Este municipio no tiene tarifas de ICA cargadas todavía.</strong>
        <p>{catalogo.motivoVacio}</p>
        <p>
          <Link href="/parametros/reteica-municipios">Cargar la regla de ReteICA del municipio</Link>
          {' · '}
          <Link href="/parametros/tarifas/reteica">Cargar tarifas por actividad</Link>
          {' · '}
          <Link href="/carga-masiva/municipality_ica_rule">Carga masiva de reglas de ICA</Link>
        </p>
      </section>
    );
  }

  return (
    <form action={simularAction} style={{ border: '1px solid #334155', padding: '16px', marginTop: 16 }}>
      <input type="hidden" name="terceroId" value={terceroId} />
      <input type="hidden" name="municipalityId" value={catalogo.municipalityId} />
      <p>
        <strong>Paso 2 — {catalogo.municipalityNombre}</strong>
        {!catalogo.usaTarifaDeActividad && (
          <>
            {' '}
            <em>
              (este municipio aplica una tarifa general: la actividad se registra igual, pero la tarifa no
              depende de cuál elija)
            </em>
          </>
        )}
      </p>
      <div>
        <label>
          Actividad CIIU con tarifa en este municipio *{' '}
          <select name="ciiuActivityId" required defaultValue="">
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
      </div>
      <RadioSiNo nombre="esPrincipal" etiqueta="¿Es la actividad principal en este municipio?" />
      <div>
        <label>
          Tarifa ICA propia de este tercero (excepcional; vacío = se resuelve por municipio+actividad en la
          parametrización tributaria){' '}
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
          <input
            name="normaRespaldo"
            type="text"
            required
            size={60}
            placeholder="Ej: RIT municipal, certificado de matrícula"
          />
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
  );
}

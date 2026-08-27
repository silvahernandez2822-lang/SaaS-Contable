/**
 * A8 — ReteICA: catálogo de municipios, bases mínimas y tarifa general.
 *
 * Esta es la pantalla donde se ve, sin adivinar, el hueco que dejó A1 a
 * propósito: Bucaramanga y Cartagena aparecen en la tabla (el municipio SÍ
 * está cargado, es identidad estable, D-013) pero sin ninguna fila de regla
 * — "Sin regla de ReteICA" en vez de un cero silencioso (advertencia 17.5).
 */
import Link from 'next/link';
import { conSesion } from '../../lib/sesion.js';
import { listarMunicipiosIca, puedeEditarParametros, hoyIso } from '../../../src/services/parametrizacion.js';
import { BadgeAlcance, MensajeError } from '../_componentes.js';
import { confirmarAction, simularAction } from './acciones.js';

export const dynamic = 'force-dynamic';

type BusquedaParams = Record<string, string | string[] | undefined>;
function cadena(sp: BusquedaParams, campo: string): string {
  const v = sp[campo];
  return typeof v === 'string' ? v : '';
}

export default async function PaginaReteIcaMunicipios({ searchParams }: { searchParams: Promise<BusquedaParams> }) {
  const sp = await searchParams;

  const [municipios, puedeEditar] = await conSesion((tx) =>
    Promise.all([listarMunicipiosIca(tx), puedeEditarParametros(tx)]),
  );

  const municipioEditandoId = cadena(sp, 'editar');
  const municipioEditando = municipioEditandoId ? municipios.find((m) => m.municipalityId === municipioEditandoId) : undefined;
  const confirmando = cadena(sp, 'confirmar') === '1';

  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: '24px' }}>
      <p>
        <Link href="/parametros">« Volver a parametrización</Link>
      </p>
      <h1>ReteICA — municipios</h1>
      <p>
        La tarifa POR ACTIVIDAD económica de cada municipio se edita en{' '}
        <Link href="/parametros/tarifas/reteica">Retención de ICA por actividad</Link>. Aquí se
        editan las bases mínimas y, cuando el municipio usa una tarifa única (no por actividad), esa
        tarifa general.
      </p>
      <MensajeError error={cadena(sp, 'error') || undefined} />
      {cadena(sp, 'ok') && (
        <p style={{ color: '#166534', border: '1px solid #166534', padding: '8px 12px' }}>
          Vigencia guardada.
        </p>
      )}

      <table style={{ borderCollapse: 'collapse' }} border={1} cellPadding={4}>
        <thead>
          <tr>
            <th>Municipio</th>
            <th>Departamento</th>
            <th>Base mínima servicios (UVT)</th>
            <th>Base mínima compras (UVT)</th>
            <th>¿Tarifa por actividad?</th>
            <th>Tarifa general</th>
            <th>Vigente desde</th>
            <th>Alcance</th>
            <th>Norma</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {municipios.map((m) => (
            <tr key={m.municipalityId} style={m.reglaId === null ? { background: '#fef2f2' } : undefined}>
              <td>{m.municipalityNombre}</td>
              <td>{m.departamento}</td>
              {m.reglaId === null ? (
                <td colSpan={7}>
                  <strong>Sin regla de ReteICA cargada.</strong> No hay valor que copiar: pendiente de
                  verificación normativa humana. El motor no calcula ICA para este municipio hasta
                  que se cargue.
                </td>
              ) : (
                <>
                  <td>{m.baseMinimaServiciosUvt ?? '—'}</td>
                  <td>{m.baseMinimaComprasUvt ?? '—'}</td>
                  <td>{m.usaTarifaDeActividad ? 'Sí' : 'No'}</td>
                  <td>{m.tarifaGeneral ? `${(Number(m.tarifaGeneral) * 1000).toString()}‰` : '—'}</td>
                  <td>{m.vigenteDesde}</td>
                  <td>
                    <BadgeAlcance alcance={m.alcance} />
                  </td>
                  <td>
                    {m.normaRespaldo}
                    {m.requiereVerificacionHumana ? ' ⚠ verificar' : ''}
                  </td>
                </>
              )}
              <td>{puedeEditar && <Link href={`?editar=${m.municipalityId}`}>Editar</Link>}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {municipioEditando && puedeEditar && !confirmando && (
        <section style={{ border: '1px solid #334155', padding: '16px', marginTop: '24px' }}>
          <h2>
            {municipioEditando.reglaId ? 'Editar' : 'Cargar por primera vez'}: {municipioEditando.municipalityNombre}
          </h2>
          <form action={simularAction}>
            <input type="hidden" name="municipalityId" value={municipioEditando.municipalityId} />
            <input type="hidden" name="reglaAnteriorId" value={municipioEditando.reglaId ?? ''} />
            <div>
              <label>
                <input
                  type="checkbox"
                  name="practicaReteica"
                  value="true"
                  defaultChecked={municipioEditando.practicaReteica}
                />{' '}
                Este municipio practica ReteICA
              </label>
            </div>
            <div>
              <label>
                Base mínima servicios (UVT){' '}
                <input name="baseMinimaServiciosUvt" type="number" step="any" defaultValue={municipioEditando.baseMinimaServiciosUvt ?? ''} />
              </label>
            </div>
            <div>
              <label>
                Base mínima compras (UVT){' '}
                <input name="baseMinimaComprasUvt" type="number" step="any" defaultValue={municipioEditando.baseMinimaComprasUvt ?? ''} />
              </label>
            </div>
            <div>
              <label>
                <input type="radio" name="usaTarifaDeActividad" value="true" defaultChecked={municipioEditando.usaTarifaDeActividad} />{' '}
                Usa la tarifa de la actividad económica del proveedor
              </label>
              <br />
              <label>
                <input type="radio" name="usaTarifaDeActividad" value="false" defaultChecked={!municipioEditando.usaTarifaDeActividad} />{' '}
                Usa una tarifa general única (por mil)
              </label>
            </div>
            <div>
              <label>
                Tarifa general (por mil, solo si NO usa tarifa por actividad){' '}
                <input
                  name="tarifaGeneralPorMil"
                  type="number"
                  step="any"
                  defaultValue={municipioEditando.tarifaGeneral ? Number(municipioEditando.tarifaGeneral) * 1000 : ''}
                />
              </label>
            </div>
            <div>
              <label>
                Periodicidad{' '}
                <select name="periodicidad" defaultValue={municipioEditando.periodicidad}>
                  <option value="mensual">Mensual</option>
                  <option value="bimestral">Bimestral</option>
                  <option value="trimestral">Trimestral</option>
                  <option value="cuatrimestral">Cuatrimestral</option>
                  <option value="anual">Anual</option>
                </select>
              </label>
            </div>
            <div>
              <label>
                Vigente desde <input name="vigenteDesde" type="date" required defaultValue={hoyIso()} />
              </label>
            </div>
            <div>
              <label>
                Norma de respaldo <input name="normaRespaldo" type="text" required size={60} />
              </label>
            </div>
            <div>
              <label>
                <input type="radio" name="alcanceNuevo" value="firma" defaultChecked /> Toda la firma
              </label>
              <label style={{ marginLeft: '16px' }}>
                <input type="radio" name="alcanceNuevo" value="empresa" /> Solo esta empresa
              </label>
            </div>
            <button type="submit">Simular impacto</button>
          </form>
        </section>
      )}

      {municipioEditando && puedeEditar && confirmando && (
        <section style={{ border: '1px solid #334155', padding: '16px', marginTop: '24px' }}>
          <h2>Confirmar</h2>
          <p>
            <strong>
              Este cambio afecta {cadena(sp, 'conceptos')} concepto(s) de causación y{' '}
              {cadena(sp, 'proveedores')} proveedor(es) con historial de ReteICA en este municipio.
            </strong>
          </p>
          <form action={confirmarAction}>
            {Object.entries({
              municipalityId: municipioEditando.municipalityId,
              reglaAnteriorId: cadena(sp, 'reglaAnteriorId'),
              practicaReteica: cadena(sp, 'practicaReteica'),
              baseMinimaServiciosUvt: cadena(sp, 'baseMinimaServiciosUvt'),
              baseMinimaComprasUvt: cadena(sp, 'baseMinimaComprasUvt'),
              usaTarifaDeActividad: cadena(sp, 'usaTarifaDeActividad'),
              tarifaGeneralPorMil: cadena(sp, 'tarifaGeneralPorMil'),
              periodicidad: cadena(sp, 'periodicidad'),
              vigenteDesde: cadena(sp, 'vigenteDesde'),
              normaRespaldo: cadena(sp, 'normaRespaldo'),
              alcanceNuevo: cadena(sp, 'alcanceNuevo'),
            }).map(([nombre, valor]) => (
              <input key={nombre} type="hidden" name={nombre} value={valor} />
            ))}
            <button type="submit">Guardar</button>{' '}
            <Link href={`?editar=${municipioEditando.municipalityId}`}>Volver a editar</Link>
          </form>
        </section>
      )}
    </main>
  );
}

/**
 * A8 — ReteICA: catálogo de municipios, bases mínimas y tarifa general.
 *
 * Muestra, sin adivinar, el hueco que dejó A1 a propósito: los municipios sin
 * regla aparecen como "Sin regla de ReteICA" en vez de un cero silencioso
 * (advertencia 17.5).
 *
 * D-087 · TAREA 0 — cuerpo migrado al kit de `app/_ui/`.
 * D-087 · TAREA 2 — permiso de submódulo `reteica`.
 * D-087 · TAREA 3 — el paso "confirmar" ya trae el conteo del simulador; se
 *   añade "Ver detalle".
 */
import {
  detalleImpactoMunicipioIca,
  listarMunicipiosIca,
  puedeEditarParametros,
  simularImpactoMunicipioIca,
  hoyIso,
} from '../../../src/services/parametrizacion';
import { conSesion } from '../../lib/sesion';
import {
  Boton,
  Campo,
  Encabezado,
  EnlaceBoton,
  Entrada,
  MensajeEstado,
  Panel,
  Selector,
  Tabla,
  Td,
  Th,
} from '../../_ui/componentes';
import { BadgeAlcance, MensajeError } from '../_componentes';
import { BotonDetalleImpacto } from '../_detalle-impacto';
import { confirmarAction, simularAction } from './acciones';

export const dynamic = 'force-dynamic';

type BusquedaParams = Record<string, string | string[] | undefined>;
function cadena(sp: BusquedaParams, campo: string): string {
  const v = sp[campo];
  return typeof v === 'string' ? v : '';
}

const CLASE_ENLACE = 'font-semibold text-primario underline dark:text-primario-tinta-oscura';

export default async function PaginaReteIcaMunicipios({
  searchParams,
}: {
  searchParams: Promise<BusquedaParams>;
}) {
  const sp = await searchParams;
  const municipioEditandoId = cadena(sp, 'editar');
  const confirmando = cadena(sp, 'confirmar') === '1';

  // V-40 (A14): el conteo del paso 2 se MIDE contra la base en la misma lectura
  // que el detalle; antes se echaba del query string y podía contradecirlo.
  const { municipios, puedeEditar, impacto, detalle } = await conSesion(async (tx) => {
    const [municipiosR, puedeEditarR] = await Promise.all([
      listarMunicipiosIca(tx),
      puedeEditarParametros(tx, 'reteica'),
    ]);
    const medir = confirmando && !!municipioEditandoId && puedeEditarR;
    return {
      municipios: municipiosR,
      puedeEditar: puedeEditarR,
      impacto: medir ? await simularImpactoMunicipioIca(tx, municipioEditandoId) : null,
      detalle: medir ? await detalleImpactoMunicipioIca(tx, municipioEditandoId) : null,
    };
  });

  const municipioEditando = municipioEditandoId
    ? municipios.find((m) => m.municipalityId === municipioEditandoId)
    : undefined;

  return (
    <div className="mx-auto max-w-5xl p-5">
      <Encabezado
        titulo="ReteICA — municipios"
        descripcion="Bases mínimas y, cuando el municipio usa tarifa única, la tarifa general. La tarifa POR ACTIVIDAD se edita en «Retención de ICA por actividad»."
        acciones={<EnlaceBoton href="/parametros" variante="fantasma">« Parametrización</EnlaceBoton>}
      />

      <p className="mb-3 text-menor text-texto-suave">
        <a className={CLASE_ENLACE} href="/parametros/tarifas/reteica">
          Ir a la tarifa por actividad económica
        </a>
      </p>

      <MensajeError error={cadena(sp, 'error') || undefined} />
      {cadena(sp, 'ok') && (
        <div className="my-3">
          <MensajeEstado tipo="sin-datos" titulo="Vigencia guardada." />
        </div>
      )}

      <Panel titulo="Municipios">
        <Tabla fijarPrimeraColumna>
          <thead>
            <tr>
              <Th>Municipio</Th>
              <Th>Departamento</Th>
              <Th alineado="right">Base mín. servicios (UVT)</Th>
              <Th alineado="right">Base mín. compras (UVT)</Th>
              <Th>¿Tarifa por actividad?</Th>
              <Th alineado="right">Tarifa general</Th>
              <Th>Vigente desde</Th>
              <Th>Alcance</Th>
              <Th>Norma</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {municipios.map((m) => (
              <tr key={m.municipalityId} className="border-t border-borde/60">
                <Td>{m.municipalityNombre}</Td>
                <Td>{m.departamento}</Td>
                {m.reglaId === null ? (
                  <Td className="text-pendiente-tinta">
                    <span className="font-semibold">Sin regla de ReteICA cargada.</span> Pendiente de
                    verificación normativa humana: el motor no calcula ICA para este municipio hasta
                    que se cargue.
                  </Td>
                ) : (
                  <>
                    <Td numerico alineado="right">{m.baseMinimaServiciosUvt ?? '—'}</Td>
                    <Td numerico alineado="right">{m.baseMinimaComprasUvt ?? '—'}</Td>
                    <Td>{m.usaTarifaDeActividad ? 'Sí' : 'No'}</Td>
                    <Td numerico alineado="right">
                      {m.tarifaGeneral ? `${(Number(m.tarifaGeneral) * 1000).toString()}‰` : '—'}
                    </Td>
                    <Td numerico>{m.vigenteDesde}</Td>
                    <Td>
                      <BadgeAlcance alcance={m.alcance} />
                    </Td>
                    <Td>
                      {m.normaRespaldo}
                      {m.requiereVerificacionHumana ? ' ⚠ verificar' : ''}
                    </Td>
                  </>
                )}
                <Td alineado="right">
                  {puedeEditar && (
                    <a href={`?editar=${m.municipalityId}`} className={CLASE_ENLACE}>
                      Editar
                    </a>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Tabla>
      </Panel>

      {!puedeEditar && (
        <div className="my-3">
          <MensajeEstado tipo="configuracion" titulo="Solo lectura">
            Su sesión no tiene el permiso <code>parametro.reteica.editar</code>.
          </MensajeEstado>
        </div>
      )}

      {municipioEditando && puedeEditar && !confirmando && (
        <Panel
          titulo={`${municipioEditando.reglaId ? 'Editar' : 'Cargar por primera vez'}: ${municipioEditando.municipalityNombre}`}
          className="mt-6"
        >
          <div className="p-5">
            <form action={simularAction} className="grid max-w-xl grid-cols-1 gap-3">
              <input type="hidden" name="municipalityId" value={municipioEditando.municipalityId} />
              <input type="hidden" name="reglaAnteriorId" value={municipioEditando.reglaId ?? ''} />
              <label className="flex items-center gap-2 text-cuerpo text-texto">
                <input
                  type="checkbox"
                  name="practicaReteica"
                  value="true"
                  defaultChecked={municipioEditando.practicaReteica}
                />
                Este municipio practica ReteICA
              </label>
              <Campo etiqueta="Base mínima servicios (UVT)">
                <Entrada
                  name="baseMinimaServiciosUvt"
                  type="number"
                  step="any"
                  defaultValue={municipioEditando.baseMinimaServiciosUvt ?? ''}
                />
              </Campo>
              <Campo etiqueta="Base mínima compras (UVT)">
                <Entrada
                  name="baseMinimaComprasUvt"
                  type="number"
                  step="any"
                  defaultValue={municipioEditando.baseMinimaComprasUvt ?? ''}
                />
              </Campo>
              <fieldset className="flex flex-col gap-1.5 text-cuerpo text-texto">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="usaTarifaDeActividad"
                    value="true"
                    defaultChecked={municipioEditando.usaTarifaDeActividad}
                  />
                  Usa la tarifa de la actividad económica del proveedor
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="usaTarifaDeActividad"
                    value="false"
                    defaultChecked={!municipioEditando.usaTarifaDeActividad}
                  />
                  Usa una tarifa general única (por mil)
                </label>
              </fieldset>
              <Campo etiqueta="Tarifa general (por mil, solo si NO usa tarifa por actividad)">
                <Entrada
                  name="tarifaGeneralPorMil"
                  type="number"
                  step="any"
                  defaultValue={
                    municipioEditando.tarifaGeneral ? Number(municipioEditando.tarifaGeneral) * 1000 : ''
                  }
                />
              </Campo>
              <Campo etiqueta="Periodicidad">
                <Selector name="periodicidad" defaultValue={municipioEditando.periodicidad}>
                  <option value="mensual">Mensual</option>
                  <option value="bimestral">Bimestral</option>
                  <option value="trimestral">Trimestral</option>
                  <option value="cuatrimestral">Cuatrimestral</option>
                  <option value="anual">Anual</option>
                </Selector>
              </Campo>
              <Campo etiqueta="Vigente desde" requerido>
                <Entrada name="vigenteDesde" type="date" required defaultValue={hoyIso()} />
              </Campo>
              <Campo etiqueta="Norma de respaldo" requerido>
                <Entrada name="normaRespaldo" type="text" required />
              </Campo>
              <fieldset className="flex flex-wrap gap-4 text-cuerpo text-texto">
                <label className="flex items-center gap-2">
                  <input type="radio" name="alcanceNuevo" value="firma" defaultChecked /> Toda la firma
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="alcanceNuevo" value="empresa" /> Solo esta empresa
                </label>
              </fieldset>
              <div>
                <Boton tipo="submit">Simular impacto</Boton>
              </div>
            </form>
          </div>
        </Panel>
      )}

      {municipioEditando && puedeEditar && confirmando && (
        <Panel titulo="Confirmar" className="mt-6">
          <div className="space-y-3 p-5">
            <MensajeEstado
              tipo="configuracion"
              titulo={`Este cambio afecta ${impacto?.conceptosAfectados ?? 0} concepto(s) de causación y ${
                impacto?.proveedoresAfectados ?? 0
              } proveedor(es) con historial de ReteICA en este municipio.`}
            />

            {detalle && <BotonDetalleImpacto detalle={detalle} />}

            <form action={confirmarAction} className="flex items-center gap-3">
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
                // Testigo del paso 1 (V-39): las cifras que se acaban de mostrar.
                conceptos: String(impacto?.conceptosAfectados ?? ''),
                proveedores: String(impacto?.proveedoresAfectados ?? ''),
              }).map(([nombre, valor]) => (
                <input key={nombre} type="hidden" name={nombre} value={valor} />
              ))}
              <Boton tipo="submit">Guardar</Boton>
              <a href={`?editar=${municipioEditando.municipalityId}`} className={CLASE_ENLACE}>
                Volver a editar
              </a>
            </form>
          </div>
        </Panel>
      )}
    </div>
  );
}

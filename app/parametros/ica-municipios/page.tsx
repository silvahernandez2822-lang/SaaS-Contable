/**
 * A8 — D-088 · TAREA 3. Parametrización de ICA por municipio.
 *
 * Una pantalla por municipio con tres bloques, cada uno con su simulador de
 * impacto BLOQUEANTE antes de guardar (sección 6.2, punto 6; mecanismo de
 * D-087 reutilizado, no uno nuevo):
 *
 *   1. Bases mínimas + tipo de medición ('por_factura' / 'por_periodo') + la
 *      ventana en meses cuando es por periodo.
 *   2. Tabla de actividades gravadas del municipio (código CIIU, descripción,
 *      tarifa por mil, gravada), buscable y editable fila por fila.
 *   3. Alta de una actividad nueva.
 *
 * Toda edición cierra la vigencia anterior e inserta una fila nueva (jamás
 * UPDATE), exige fecha de vigencia y norma de respaldo, y no toca los asientos
 * ya publicados — lo imponen los servicios de `parametrizacion.ts` y los
 * triggers de la base, no esta pantalla.
 */
import {
  detalleImpactoMunicipioIca,
  detalleImpactoTarifa,
  listarMunicipiosIca,
  listarTarifasPorTipo,
  puedeEditarParametros,
  simularImpactoMunicipioIca,
  simularImpactoTarifa,
  hoyIso,
  type FilaTarifa,
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
import { CargaMasivaIca } from './_carga-masiva';
import {
  confirmarActividadAction,
  confirmarBaseAction,
  simularActividadAction,
  simularBaseAction,
} from './acciones';

export const dynamic = 'force-dynamic';

const ENLACE = 'font-semibold text-primario underline dark:text-primario-tinta-oscura';

type SP = Record<string, string | string[] | undefined>;
function s(sp: SP, k: string): string {
  const v = sp[k];
  return typeof v === 'string' ? v : '';
}

export default async function PaginaIcaMunicipios({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const municipioId = s(sp, 'municipio');
  const q = s(sp, 'q').toLowerCase();
  const editarBase = s(sp, 'editar') === '1';
  const confirmarBase = s(sp, 'confirmar') === '1';
  const editarActividadId = s(sp, 'editarActividad');
  const nuevaActividad = s(sp, 'nuevaActividad') === '1';
  const confirmarActividad = s(sp, 'confirmarActividad') === '1';

  const datos = await conSesion(async (tx) => {
    const [municipios, tarifas, puedeEditar] = await Promise.all([
      listarMunicipiosIca(tx),
      municipioId ? listarTarifasPorTipo(tx, 'reteica') : Promise.resolve([] as FilaTarifa[]),
      puedeEditarParametros(tx, 'ica'),
    ]);
    const medirBase = confirmarBase && !!municipioId && puedeEditar;
    const medirAct = confirmarActividad && !!municipioId && puedeEditar;
    const conceptoActId =
      editarActividadId && tarifas.find((t) => t.reglaId === editarActividadId)?.taxConceptId;
    return {
      municipios,
      tarifas,
      puedeEditar,
      impactoBase: medirBase ? await simularImpactoMunicipioIca(tx, municipioId) : null,
      detalleBase: medirBase ? await detalleImpactoMunicipioIca(tx, municipioId) : null,
      impactoAct:
        medirAct && conceptoActId ? await simularImpactoTarifa(tx, conceptoActId) : null,
      detalleAct:
        medirAct && conceptoActId ? await detalleImpactoTarifa(tx, conceptoActId) : null,
    };
  });

  const municipio = datos.municipios.find((m) => m.municipalityId === municipioId);
  const actividades = datos.tarifas
    .filter((t) => t.municipalityId === municipioId && t.ciiuActivityId && t.esEfectiva)
    .filter(
      (t) =>
        !q ||
        (t.ciiuCodigo ?? '').toLowerCase().includes(q) ||
        (t.ciiuNombre ?? '').toLowerCase().includes(q),
    )
    .sort((a, b) => (a.ciiuCodigo ?? '').localeCompare(b.ciiuCodigo ?? ''));
  const filaActEditando = actividades.find((t) => t.reglaId === editarActividadId);

  return (
    <div className="mx-auto max-w-5xl p-5">
      <Encabezado
        titulo="ICA por municipio"
        descripcion="Bases mínimas, forma de medición (por factura o por periodo) y tabla de actividades gravadas de cada municipio. Cada cambio abre una vigencia nueva y muestra su impacto antes de guardar."
        acciones={<EnlaceBoton href="/parametros" variante="fantasma">« Parametrización</EnlaceBoton>}
      />

      <MensajeError error={s(sp, 'error') || undefined} />
      {s(sp, 'ok') && (
        <div className="my-3">
          <MensajeEstado tipo="sin-datos" titulo="Vigencia guardada." >
            La anterior quedó cerrada (nunca sobrescrita) y la nueva rige desde la fecha confirmada.
            Queda en auditoría con su norma de respaldo.
          </MensajeEstado>
        </div>
      )}

      {!datos.puedeEditar && (
        <div className="my-3">
          <MensajeEstado tipo="configuracion" titulo="Solo lectura">
            Su sesión no tiene el permiso <code>parametro.ica.editar</code>. Pídale a un administrador
            tributario (o de la firma) que edite el valor.
          </MensajeEstado>
        </div>
      )}

      <Panel titulo="Municipio">
        <div className="p-5">
          <form method="get" className="flex flex-wrap items-end gap-3">
            <Campo etiqueta="Elija el municipio">
              <Selector name="municipio" defaultValue={municipioId}>
                <option value="">— seleccione —</option>
                {datos.municipios.map((m) => (
                  <option key={m.municipalityId} value={m.municipalityId}>
                    {m.municipalityNombre} ({m.departamento}) · {m.codigoDane}
                    {m.reglaId === null ? ' — sin regla' : ''}
                  </option>
                ))}
              </Selector>
            </Campo>
            <Boton tipo="submit" variante="secundario">Ver</Boton>
          </form>
        </div>
      </Panel>

      {municipio && (
        <>
          <Panel titulo={`Bases mínimas y medición — ${municipio.municipalityNombre}`} className="mt-6">
            <div className="space-y-2 p-5 text-cuerpo text-texto">
              {municipio.reglaId === null ? (
                <p className="text-pendiente-tinta font-semibold">
                  Este municipio todavía no tiene regla de ICA cargada. El motor no calcula ICA aquí
                  hasta que se cargue (pendiente de verificación normativa humana).
                </p>
              ) : (
                <ul className="list-disc pl-5">
                  <li>Base mínima compras: {municipio.baseMinimaComprasUvt ?? '—'} UVT</li>
                  <li>Base mínima servicios: {municipio.baseMinimaServiciosUvt ?? '—'} UVT</li>
                  <li>
                    Medición:{' '}
                    {municipio.tipoMedicionBaseMinima === 'por_periodo'
                      ? `por periodo (ventana de ${municipio.periodoMeses ?? '?'} meses)`
                      : 'por factura'}
                  </li>
                  <li>Periodicidad de declaración: {municipio.periodicidad}</li>
                  <li>Vigente desde: {municipio.vigenteDesde}</li>
                  <li>
                    Alcance: <BadgeAlcance alcance={municipio.alcance} /> · Norma: {municipio.normaRespaldo}
                  </li>
                </ul>
              )}
              {datos.puedeEditar && !editarBase && (
                <a href={`?municipio=${municipioId}&editar=1`} className={ENLACE}>
                  {municipio.reglaId === null ? 'Cargar por primera vez' : 'Editar bases mínimas / medición'}
                </a>
              )}
            </div>
          </Panel>

          {datos.puedeEditar && editarBase && !confirmarBase && (
            <Panel titulo="Editar regla del municipio" className="mt-4">
              <form action={simularBaseAction} className="grid max-w-xl grid-cols-1 gap-3 p-5">
                <input type="hidden" name="municipalityId" value={municipioId} />
                <input type="hidden" name="reglaAnteriorId" value={municipio.reglaId ?? ''} />
                <input type="hidden" name="practicaReteica" value="true" />
                <input type="hidden" name="usaTarifaDeActividad" value="true" />
                <Campo etiqueta="Base mínima compras (UVT)">
                  <Entrada name="baseMinimaComprasUvt" type="number" step="any" defaultValue={municipio.baseMinimaComprasUvt ?? ''} />
                </Campo>
                <Campo etiqueta="Base mínima servicios (UVT)">
                  <Entrada name="baseMinimaServiciosUvt" type="number" step="any" defaultValue={municipio.baseMinimaServiciosUvt ?? ''} />
                </Campo>
                <Campo etiqueta="Tipo de medición de la base mínima">
                  <Selector name="tipoMedicionBaseMinima" defaultValue={municipio.tipoMedicionBaseMinima}>
                    <option value="por_factura">Por factura (se compara cada factura)</option>
                    <option value="por_periodo">Por periodo (se compara el acumulado del tercero)</option>
                  </Selector>
                </Campo>
                <Campo etiqueta="Ventana de acumulación en meses (solo si es «por periodo», 1 a 12)">
                  <Entrada name="periodoMeses" type="number" min="1" max="12" defaultValue={municipio.periodoMeses ?? ''} />
                </Campo>
                <Campo etiqueta="Periodicidad de declaración ante el municipio">
                  <Selector name="periodicidad" defaultValue={municipio.periodicidad}>
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
                  <Entrada name="normaRespaldo" type="text" required placeholder="Acuerdo Municipal ... de ...." />
                </Campo>
                <fieldset className="flex flex-wrap gap-4 text-cuerpo text-texto">
                  <label className="flex items-center gap-2"><input type="radio" name="alcanceNuevo" value="firma" defaultChecked /> Toda la firma</label>
                  <label className="flex items-center gap-2"><input type="radio" name="alcanceNuevo" value="empresa" /> Solo esta empresa</label>
                </fieldset>
                <div><Boton tipo="submit">Simular impacto</Boton></div>
              </form>
            </Panel>
          )}

          {datos.puedeEditar && confirmarBase && (
            <Panel titulo="Confirmar regla del municipio" className="mt-4">
              <div className="space-y-3 p-5">
                <MensajeEstado
                  tipo="configuracion"
                  titulo={`Este cambio afecta ${datos.impactoBase?.conceptosAfectados ?? 0} concepto(s) de causación y ${datos.impactoBase?.proveedoresAfectados ?? 0} proveedor(es) con historial de ReteICA en este municipio.`}
                />
                {datos.detalleBase && <BotonDetalleImpacto detalle={datos.detalleBase} />}
                <form action={confirmarBaseAction} className="flex items-center gap-3">
                  {Object.entries({
                    municipalityId: municipioId,
                    reglaAnteriorId: s(sp, 'reglaAnteriorId'),
                    practicaReteica: s(sp, 'practicaReteica') || 'true',
                    usaTarifaDeActividad: s(sp, 'usaTarifaDeActividad') || 'true',
                    baseMinimaComprasUvt: s(sp, 'baseMinimaComprasUvt'),
                    baseMinimaServiciosUvt: s(sp, 'baseMinimaServiciosUvt'),
                    tipoMedicionBaseMinima: s(sp, 'tipoMedicionBaseMinima'),
                    periodoMeses: s(sp, 'periodoMeses'),
                    periodicidad: s(sp, 'periodicidad'),
                    vigenteDesde: s(sp, 'vigenteDesde'),
                    normaRespaldo: s(sp, 'normaRespaldo'),
                    alcanceNuevo: s(sp, 'alcanceNuevo'),
                    conceptos: String(datos.impactoBase?.conceptosAfectados ?? ''),
                    proveedores: String(datos.impactoBase?.proveedoresAfectados ?? ''),
                  }).map(([n, v]) => (
                    <input key={n} type="hidden" name={n} value={v} />
                  ))}
                  <Boton tipo="submit">Guardar</Boton>
                  <a href={`?municipio=${municipioId}&editar=1`} className={ENLACE}>Volver a editar</a>
                </form>
              </div>
            </Panel>
          )}

          <Panel titulo="Actividades gravadas del municipio" className="mt-6">
            <div className="p-5">
              <form method="get" className="mb-3 flex flex-wrap items-end gap-3">
                <input type="hidden" name="municipio" value={municipioId} />
                <Campo etiqueta="Buscar por código o descripción">
                  <Entrada name="q" type="text" defaultValue={s(sp, 'q')} />
                </Campo>
                <Boton tipo="submit" variante="secundario">Filtrar</Boton>
                {datos.puedeEditar && (
                  <a href={`?municipio=${municipioId}&nuevaActividad=1`} className={ENLACE}>+ Añadir actividad</a>
                )}
              </form>
              <Tabla fijarPrimeraColumna alturaMaxima="60vh">
                <thead>
                  <tr>
                    <Th>CIIU</Th>
                    <Th>Descripción</Th>
                    <Th alineado="right">Tarifa por mil</Th>
                    <Th>Gravada</Th>
                    <Th>Vigente desde</Th>
                    <Th>Alcance</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {actividades.map((t) => (
                    <tr key={t.reglaId} className="border-t border-borde/60">
                      <Td numerico>{t.ciiuCodigo}</Td>
                      <Td>{t.ciiuNombre}</Td>
                      <Td numerico alineado="right">
                        {t.gravada === false ? '—' : `${(Number(t.tarifa) * 1000).toString()}‰`}
                      </Td>
                      <Td>{t.gravada === false ? 'No' : t.gravada === true ? 'Sí' : '(sin declarar)'}</Td>
                      <Td numerico>{t.vigenteDesde}</Td>
                      <Td><BadgeAlcance alcance={t.alcance} /></Td>
                      <Td alineado="right">
                        {datos.puedeEditar && (
                          <a href={`?municipio=${municipioId}&editarActividad=${t.reglaId}`} className={ENLACE}>Editar</a>
                        )}
                      </Td>
                    </tr>
                  ))}
                  {actividades.length === 0 && (
                    <tr><Td>Sin actividades cargadas para este municipio con ese filtro.</Td></tr>
                  )}
                </tbody>
              </Tabla>
            </div>
          </Panel>

          {datos.puedeEditar && (filaActEditando || nuevaActividad) && !confirmarActividad && (
            <Panel titulo={filaActEditando ? `Editar actividad ${filaActEditando.ciiuCodigo}` : 'Añadir actividad'} className="mt-4">
              <form action={simularActividadAction} className="grid max-w-xl grid-cols-1 gap-3 p-5">
                <input type="hidden" name="municipalityId" value={municipioId} />
                <input type="hidden" name="municipioDane" value={municipio.codigoDane} />
                <input type="hidden" name="reglaAnteriorId" value={filaActEditando?.reglaId ?? ''} />
                <input type="hidden" name="taxConceptId" value={filaActEditando?.taxConceptId ?? ''} />
                {!filaActEditando && (
                  <Campo etiqueta="Código CIIU (4 dígitos)" requerido>
                    <Entrada name="ciiuCodigo" type="text" required placeholder="0161" />
                  </Campo>
                )}
                {filaActEditando && <input type="hidden" name="ciiuCodigo" value={filaActEditando.ciiuCodigo ?? ''} />}
                <fieldset className="flex flex-wrap gap-4 text-cuerpo text-texto">
                  <label className="flex items-center gap-2">
                    <input type="radio" name="gravada" value="true" defaultChecked={filaActEditando?.gravada !== false} /> Gravada
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" name="gravada" value="false" defaultChecked={filaActEditando?.gravada === false} /> No gravada (el motor no retiene; la tarifa se ignora y se guarda en 0)
                  </label>
                </fieldset>
                <Campo etiqueta="Tarifa por mil (solo si está gravada)">
                  <Entrada
                    name="tarifaPorMil"
                    type="number"
                    step="any"
                    defaultValue={
                      filaActEditando && filaActEditando.gravada !== false
                        ? (Number(filaActEditando.tarifa) * 1000).toString()
                        : ''
                    }
                  />
                </Campo>
                <Campo etiqueta="Vigente desde" requerido>
                  <Entrada name="vigenteDesde" type="date" required defaultValue={hoyIso()} />
                </Campo>
                <Campo etiqueta="Norma de respaldo" requerido>
                  <Entrada name="normaRespaldo" type="text" required placeholder="Acuerdo Municipal ... art. ..." />
                </Campo>
                <fieldset className="flex flex-wrap gap-4 text-cuerpo text-texto">
                  <label className="flex items-center gap-2"><input type="radio" name="alcanceNuevo" value="firma" defaultChecked /> Toda la firma</label>
                  <label className="flex items-center gap-2"><input type="radio" name="alcanceNuevo" value="empresa" /> Solo esta empresa</label>
                </fieldset>
                <p className="text-menor text-texto-suave">
                  Si marca «No gravada», el motor de causación no practica ReteICA para esta actividad
                  en este municipio, sin importar la tarifa (el esquema obliga tarifa = 0).
                </p>
                <div><Boton tipo="submit">Simular impacto</Boton></div>
              </form>
            </Panel>
          )}

          {datos.puedeEditar && confirmarActividad && (
            <Panel titulo="Confirmar tarifa de actividad" className="mt-4">
              <div className="space-y-3 p-5">
                <MensajeEstado
                  tipo="configuracion"
                  titulo={`Este cambio afecta ${datos.impactoAct?.conceptosAfectados ?? 0} concepto(s) de causación y ${datos.impactoAct?.proveedoresAfectados ?? 0} proveedor(es) con historial de ReteICA.`}
                />
                {datos.detalleAct && <BotonDetalleImpacto detalle={datos.detalleAct} />}
                <ul className="list-disc pl-5 text-cuerpo text-texto">
                  <li>CIIU: {s(sp, 'ciiuCodigo')}</li>
                  <li>Gravada: {s(sp, 'gravada') === 'true' ? 'sí' : 'no'}</li>
                  <li>Tarifa por mil: {s(sp, 'gravada') === 'true' ? s(sp, 'tarifaPorMil') || '—' : '0 (no gravada)'}</li>
                  <li>Vigente desde: {s(sp, 'vigenteDesde')}</li>
                  <li>Norma: {s(sp, 'normaRespaldo')}</li>
                </ul>
                <form action={confirmarActividadAction} className="flex items-center gap-3">
                  {Object.entries({
                    municipalityId: municipioId,
                    municipioDane: municipio.codigoDane,
                    taxConceptId: s(sp, 'taxConceptId'),
                    reglaAnteriorId: s(sp, 'reglaAnteriorId') || editarActividadId,
                    ciiuCodigo: s(sp, 'ciiuCodigo'),
                    gravada: s(sp, 'gravada'),
                    tarifaPorMil: s(sp, 'tarifaPorMil'),
                    vigenteDesde: s(sp, 'vigenteDesde'),
                    normaRespaldo: s(sp, 'normaRespaldo'),
                    alcanceNuevo: s(sp, 'alcanceNuevo'),
                    conceptos: String(datos.impactoAct?.conceptosAfectados ?? ''),
                    proveedores: String(datos.impactoAct?.proveedoresAfectados ?? ''),
                  }).map(([n, v]) => (
                    <input key={n} type="hidden" name={n} value={v} />
                  ))}
                  <Boton tipo="submit">Guardar vigencia nueva</Boton>
                  <a href={`?municipio=${municipioId}`} className={ENLACE}>Cancelar</a>
                </form>
              </div>
            </Panel>
          )}

          <CargaMasivaIca puedeEditar={datos.puedeEditar} />
        </>
      )}
    </div>
  );
}

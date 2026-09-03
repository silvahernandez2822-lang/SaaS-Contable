/**
 * A8 — Editor de `tax_rule`: retefuente, retefuente_salarios, autorretención,
 * ReteIVA, ReteICA por actividad e IVA. Una sola pantalla para las seis
 * familias de la sección 6.3 porque comparten el mismo modelo.
 *
 * D-087 · TAREA 0 — cuerpo migrado al kit de `app/_ui/`.
 * D-087 · TAREA 2 — permiso por submódulo (`tarifas`, o `reteica` para la
 *   tarifa de ReteICA por actividad).
 * D-087 · TAREA 3 — el paso "confirmar" ya trae el conteo del simulador; se
 *   añade "Ver detalle" con los conceptos y proveedores concretos.
 */
import {
  detalleImpactoTarifa,
  listarConceptosSinTarifaVigente,
  listarTarifasPorTipo,
  puedeEditarParametros,
  simularImpactoTarifa,
  hoyIso,
  type FilaTarifa,
  type SubmoduloParametro,
  type TipoTaxRule,
} from '../../../../src/services/parametrizacion';
import { conSesion } from '../../../lib/sesion';
import {
  Boton,
  Campo,
  Encabezado,
  EnlaceBoton,
  Entrada,
  MensajeEstado,
  Panel,
  Tabla,
  Td,
  Th,
} from '../../../_ui/componentes';
import { BadgeAlcance, MensajeError } from '../../_componentes';
import { BotonDetalleImpacto } from '../../_detalle-impacto';
import { confirmarAction, simularAction } from './acciones';

export const dynamic = 'force-dynamic';

const TITULOS: Record<TipoTaxRule, string> = {
  retefuente: 'Retención en la fuente a título de renta',
  retefuente_salarios: 'Retención en la fuente por salarios (tabla progresiva, art. 383 ET)',
  autorretencion: 'Autorretención de renta por CIIU',
  reteiva: 'Retención de IVA (ReteIVA)',
  reteica: 'ReteICA — tarifas por actividad económica',
  iva: 'IVA — tarifas',
};

function submoduloDe(tipo: TipoTaxRule): SubmoduloParametro {
  return tipo === 'reteica' ? 'reteica' : 'tarifas';
}

type BusquedaParams = Record<string, string | string[] | undefined>;

function cadena(sp: BusquedaParams, campo: string): string {
  const v = sp[campo];
  return typeof v === 'string' ? v : '';
}

export default async function PaginaTarifas({
  params,
  searchParams,
}: {
  params: Promise<{ tipo: string }>;
  searchParams: Promise<BusquedaParams>;
}) {
  const { tipo: tipoCrudo } = await params;
  const sp = await searchParams;

  if (!(tipoCrudo in TITULOS)) {
    return (
      <div className="mx-auto max-w-3xl p-5">
        <MensajeEstado tipo="error" titulo={`Tipo de tarifa desconocido: ${tipoCrudo}`} />
      </div>
    );
  }
  const tipo = tipoCrudo as TipoTaxRule;
  const submodulo = submoduloDe(tipo);

  const reglaEditando = cadena(sp, 'editar');
  const confirmando = cadena(sp, 'confirmar') === '1';

  // V-40 / V-41 (A14, compuerta ampliada de D-087): el conteo que ve el contador
  // en el paso 2 se MIDE aquí, contra la base, en la misma lectura que el
  // detalle — antes venía del query string y podía contradecir al detalle (que
  // sí era fresco). Y el `tax_concept` con el que se mide sale de la REGLA que
  // se está editando, nunca del query string.
  const { tarifas, faltantes, puedeEditar, impacto, detalle, filaEditando } = await conSesion(
    async (tx) => {
      const [tarifasR, faltantesR, puedeEditarR] = await Promise.all([
        listarTarifasPorTipo(tx, tipo),
        listarConceptosSinTarifaVigente(tx, tipo),
        puedeEditarParametros(tx, submodulo),
      ]);
      const fila: FilaTarifa | undefined = reglaEditando
        ? tarifasR.find((t) => t.reglaId === reglaEditando)
        : undefined;
      const medir = confirmando && puedeEditarR && fila !== undefined;
      return {
        tarifas: tarifasR,
        faltantes: faltantesR,
        puedeEditar: puedeEditarR,
        filaEditando: fila,
        impacto: medir ? await simularImpactoTarifa(tx, fila.taxConceptId) : null,
        detalle: medir ? await detalleImpactoTarifa(tx, fila.taxConceptId) : null,
      };
    },
  );

  const ok = cadena(sp, 'ok');

  return (
    <div className="mx-auto max-w-5xl p-5">
      <Encabezado
        titulo={TITULOS[tipo]}
        descripcion="Cada edición cierra la vigencia anterior e inserta una nueva, con fecha de vigencia y norma de respaldo obligatorias. No afecta asientos ya publicados."
        acciones={<EnlaceBoton href="/parametros" variante="fantasma">« Parametrización</EnlaceBoton>}
      />

      <MensajeError error={cadena(sp, 'error') || undefined} />
      {ok && (
        <div className="my-3">
          <MensajeEstado tipo="sin-datos" titulo="Vigencia guardada.">
            La vigencia anterior quedó cerrada (nunca se sobrescribió) y la nueva rige desde la fecha
            confirmada. Queda en el registro de auditoría con la norma de respaldo escrita.
          </MensajeEstado>
        </div>
      )}

      {faltantes.length > 0 && (
        <div className="my-3">
          <MensajeEstado
            tipo="configuracion"
            titulo={`${faltantes.length} concepto(s) de este tipo sin ninguna tarifa vigente hoy`}
          >
            <ul className="mt-1 list-disc pl-5">
              {faltantes.map((f) => (
                <li key={f.taxConceptId}>
                  {f.codigo} — {f.nombre}. No hay valor por omisión: el motor manda a revisión manual
                  cualquier documento que dependa de este concepto.
                </li>
              ))}
            </ul>
          </MensajeEstado>
        </div>
      )}

      <Panel titulo="Tarifas vigentes hoy">
        <Tabla fijarPrimeraColumna>
          <thead>
            <tr>
              <Th>Código</Th>
              <Th>Nombre</Th>
              <Th alineado="right">Tarifa</Th>
              <Th alineado="right">Base mín. (UVT)</Th>
              <Th>Vigente desde</Th>
              <Th>Alcance</Th>
              <Th>Norma de respaldo</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {tarifas
              .filter((t) => t.esEfectiva)
              .map((t) => (
                <tr key={t.reglaId} className="border-t border-borde/60">
                  <Td numerico>{t.codigo}</Td>
                  <Td>
                    {t.nombre}
                    {t.municipalityNombre ? ` — ${t.municipalityNombre}` : ''}
                    {t.ciiuCodigo ? ` — CIIU ${t.ciiuCodigo}` : ''}
                    {t.requiereVerificacionHumana ? ' ⚠ verificar' : ''}
                  </Td>
                  <Td numerico alineado="right">{(Number(t.tarifa) * 100).toString()}%</Td>
                  <Td numerico alineado="right">{t.baseMinimaUvt ?? '—'}</Td>
                  <Td numerico>{t.vigenteDesde}</Td>
                  <Td>
                    <BadgeAlcance alcance={t.alcance} />
                  </Td>
                  <Td>{t.normaRespaldo}</Td>
                  <Td alineado="right">
                    {puedeEditar && (
                      <a href={`?editar=${t.reglaId}`} className="font-semibold text-primario underline dark:text-primario-tinta-oscura">
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
            Su sesión no tiene el permiso <code>parametro.{submodulo}.editar</code>: solo puede
            consultar esta tabla. Pídale a un administrador tributario que edite el valor.
          </MensajeEstado>
        </div>
      )}

      {filaEditando && puedeEditar && !confirmando && (
        <Panel titulo={`Editar: ${filaEditando.codigo}`} className="mt-6">
          <div className="p-5">
            <p className="mb-4 text-menor text-texto-suave">
              Vigencia actual: {(Number(filaEditando.tarifa) * 100).toString()}% desde{' '}
              {filaEditando.vigenteDesde}, respaldada en «{filaEditando.normaRespaldo}».
            </p>
            <form action={simularAction} className="grid max-w-xl grid-cols-1 gap-3">
              <input type="hidden" name="tipo" value={tipo} />
              <input type="hidden" name="reglaAnteriorId" value={filaEditando.reglaId} />
              <input type="hidden" name="taxConceptId" value={filaEditando.taxConceptId} />
              <Campo etiqueta="Tarifa nueva (%)" requerido>
                <Entrada
                  name="tarifaPorcentaje"
                  type="number"
                  step="any"
                  required
                  defaultValue={(Number(filaEditando.tarifa) * 100).toString()}
                />
              </Campo>
              <Campo etiqueta="Base mínima (UVT)">
                <Entrada
                  name="baseMinimaUvt"
                  type="number"
                  step="any"
                  defaultValue={filaEditando.baseMinimaUvt ?? ''}
                />
              </Campo>
              <Campo etiqueta="Cuenta contable (código PUC, opcional — vacío conserva la actual)">
                <Entrada name="cuentaCodigo" type="text" placeholder={filaEditando.accountId ?? ''} />
              </Campo>
              <Campo etiqueta="Fecha de vigencia (propuesta: hoy)" requerido>
                <Entrada name="vigenteDesde" type="date" required defaultValue={hoyIso()} />
              </Campo>
              <Campo etiqueta="Norma de respaldo (obligatoria)" requerido>
                <Entrada
                  name="normaRespaldo"
                  type="text"
                  required
                  placeholder="Ej: Decreto 572 de 2025, art. 3"
                />
              </Campo>
              <fieldset className="flex flex-wrap gap-4 text-cuerpo text-texto">
                <label className="flex items-center gap-2">
                  <input type="radio" name="alcanceNuevo" value="firma" defaultChecked /> Compartida
                  entre todas las empresas de la firma
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="alcanceNuevo" value="empresa" /> Solo la empresa en sesión
                </label>
              </fieldset>
              <div>
                <Boton tipo="submit">Simular impacto</Boton>
              </div>
            </form>
          </div>
        </Panel>
      )}

      {filaEditando && puedeEditar && confirmando && (
        <Panel titulo="Confirmar vigencia nueva" className="mt-6">
          <div className="space-y-3 p-5">
            <MensajeEstado
              tipo="configuracion"
              titulo={`Esta tarifa afecta ${impacto?.conceptosAfectados ?? 0} concepto(s) de causación y ${
                impacto?.proveedoresAfectados ?? 0
              } proveedor(es) con historial (sección 6.2, punto 6).`}
            >
              {cadena(sp, 'fechaMinima') && (
                <p>
                  Ya hay asientos publicados con la regla actual hasta el {cadena(sp, 'fechaMinima')}:
                  la vigencia nueva debe empezar después de esa fecha.
                </p>
              )}
            </MensajeEstado>

            {detalle && <BotonDetalleImpacto detalle={detalle} />}

            <ul className="list-disc pl-5 text-cuerpo text-texto">
              <li>Tarifa nueva: {cadena(sp, 'tarifaPorcentaje')}%</li>
              <li>Base mínima UVT: {cadena(sp, 'baseMinimaUvt') || '—'}</li>
              <li>Vigente desde: {cadena(sp, 'vigenteDesde')}</li>
              <li>Norma de respaldo: {cadena(sp, 'normaRespaldo')}</li>
              <li>
                Alcance:{' '}
                {cadena(sp, 'alcanceNuevo') === 'empresa' ? 'solo esta empresa' : 'compartida en la firma'}
              </li>
            </ul>

            <form action={confirmarAction} className="flex items-center gap-3">
              <input type="hidden" name="tipo" value={tipo} />
              <input type="hidden" name="reglaAnteriorId" value={filaEditando.reglaId} />
              <input type="hidden" name="tarifaPorcentaje" value={cadena(sp, 'tarifaPorcentaje')} />
              <input type="hidden" name="baseMinimaUvt" value={cadena(sp, 'baseMinimaUvt')} />
              <input type="hidden" name="cuentaCodigo" value={cadena(sp, 'cuentaCodigo')} />
              <input type="hidden" name="vigenteDesde" value={cadena(sp, 'vigenteDesde')} />
              <input type="hidden" name="normaRespaldo" value={cadena(sp, 'normaRespaldo')} />
              <input type="hidden" name="alcanceNuevo" value={cadena(sp, 'alcanceNuevo')} />
              {/* Testigo del paso 1 (V-39): son las cifras que se acaban de
                  mostrar arriba. La acción las vuelve a medir y solo escribe si
                  siguen siendo las mismas. */}
              <input type="hidden" name="conceptos" value={String(impacto?.conceptosAfectados ?? '')} />
              <input type="hidden" name="proveedores" value={String(impacto?.proveedoresAfectados ?? '')} />
              <Boton tipo="submit">Guardar vigencia nueva</Boton>
              <a
                href={`?editar=${filaEditando.reglaId}`}
                className="font-semibold text-primario underline dark:text-primario-tinta-oscura"
              >
                Volver a editar
              </a>
            </form>
          </div>
        </Panel>
      )}
    </div>
  );
}

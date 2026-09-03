/**
 * A8 — UVT, SMMLV/auxilio de transporte y redondeo general.
 *
 * Las LECTURAS son consultas directas (solo lectura, una tabla, misma
 * prioridad de alcance que el motor). Las ESCRITURAS pasan por el servicio
 * (`editarUvtValue` / `editarSmmlvValue` / `editarRoundingRule`).
 *
 * D-087 · TAREA 0 — cuerpo migrado al kit de `app/_ui/`.
 * D-087 · TAREA 2 — permiso de submódulo `valores_base`.
 * D-087 · TAREA 3 — flujo de DOS pasos: se SIMULA el impacto (bloqueante,
 *   con "Ver detalle") ANTES de que exista el botón de guardar.
 */
import { conSesion } from '../../lib/sesion';
import {
  detalleImpactoValorBase,
  puedeEditarParametros,
  simularImpactoValorBase,
  hoyIso,
  type DetalleImpacto,
  type ImpactoSimulado,
} from '../../../src/services/parametrizacion';
import {
  Boton,
  Campo,
  Encabezado,
  EnlaceBoton,
  Entrada,
  MensajeEstado,
  Panel,
  Selector,
} from '../../_ui/componentes';
import { MensajeError } from '../_componentes';
import { BotonDetalleImpacto } from '../_detalle-impacto';
import {
  confirmarRedondeoAction,
  confirmarSmmlvAction,
  confirmarUvtAction,
  simularRedondeoAction,
  simularSmmlvAction,
  simularUvtAction,
} from './acciones';

export const dynamic = 'force-dynamic';

interface FilaUvt {
  id: string;
  anio: number;
  valor: string;
  vigente_desde: string;
  norma_respaldo: string;
}
interface FilaSmmlv {
  id: string;
  anio: number;
  valor_mensual: string;
  auxilio_transporte: string | null;
  vigente_desde: string;
  norma_respaldo: string;
}
interface FilaRedondeo {
  id: string;
  codigo: string;
  modo: string;
  multiplo: number;
  vigente_desde: string;
  norma_respaldo: string;
}

type BusquedaParams = Record<string, string | string[] | undefined>;
function cadena(sp: BusquedaParams, campo: string): string {
  const v = sp[campo];
  return typeof v === 'string' ? v : '';
}

export default async function PaginaValoresBase({
  searchParams,
}: {
  searchParams: Promise<BusquedaParams>;
}) {
  const sp = await searchParams;
  const cual = cadena(sp, 'cual');
  const confirmando = cadena(sp, 'confirmar') === '1' && !!cual;

  const { uvt, smmlv, redondeo, puedeEditar, impacto, detalle } = await conSesion(async (tx) => {
    const [uvtRes, smmlvRes, redondeoRes, puedeEditarRes, impactoRes] = await Promise.all([
      tx.query<FilaUvt>(
        `SELECT id, anio, valor::text, vigente_desde::text, norma_respaldo FROM uvt_value
          WHERE app.esta_vigente(vigente_desde, vigente_hasta, CURRENT_DATE)
          ORDER BY (company_id IS NOT NULL) DESC, (tenant_id IS NOT NULL) DESC LIMIT 1`,
      ),
      tx.query<FilaSmmlv>(
        `SELECT id, anio, valor_mensual::text, auxilio_transporte::text, vigente_desde::text, norma_respaldo
           FROM smmlv_value
          WHERE app.esta_vigente(vigente_desde, vigente_hasta, CURRENT_DATE)
          ORDER BY (company_id IS NOT NULL) DESC, (tenant_id IS NOT NULL) DESC LIMIT 1`,
      ),
      tx.query<FilaRedondeo>(
        `SELECT id, codigo, modo, multiplo, vigente_desde::text, norma_respaldo FROM rounding_rule
          WHERE aplica_a = 'todos' AND app.esta_vigente(vigente_desde, vigente_hasta, CURRENT_DATE)
          ORDER BY (company_id IS NOT NULL) DESC, (tenant_id IS NOT NULL) DESC LIMIT 1`,
      ),
      puedeEditarParametros(tx, 'valores_base'),
      simularImpactoValorBase(tx),
    ]);
    const detalleRes = confirmando && puedeEditarRes ? await detalleImpactoValorBase(tx) : null;
    return {
      uvt: uvtRes.rows[0] ?? null,
      smmlv: smmlvRes.rows[0] ?? null,
      redondeo: redondeoRes.rows[0] ?? null,
      puedeEditar: puedeEditarRes,
      impacto: impactoRes,
      detalle: detalleRes,
    };
  });

  const impactoTexto = `Cualquiera de estos tres valores afecta hoy a ${impacto.conceptosAfectados} concepto(s) de causación y ${impacto.proveedoresAfectados} proveedor(es) con historial en esta firma (sección 6.2, punto 6): todos calculan con base en la UVT, el SMMLV o el redondeo general.`;

  return (
    <div className="mx-auto max-w-3xl p-5">
      <Encabezado
        titulo="Valores base"
        descripcion="UVT, SMMLV / auxilio de transporte y redondeo general. Cada edición cierra la vigencia anterior e inserta una nueva; no afecta asientos publicados."
        acciones={<EnlaceBoton href="/parametros" variante="fantasma">« Parametrización</EnlaceBoton>}
      />

      <MensajeError error={cadena(sp, 'error') || undefined} />
      {cadena(sp, 'ok') && (
        <div className="my-3">
          <MensajeEstado tipo="sin-datos" titulo="Vigencia guardada: la anterior quedó cerrada, la nueva rige desde la fecha confirmada." />
        </div>
      )}

      {!puedeEditar && (
        <div className="my-3">
          <MensajeEstado tipo="configuracion" titulo="Solo lectura">
            Su sesión no tiene el permiso <code>parametro.valores_base.editar</code>.
          </MensajeEstado>
        </div>
      )}

      {confirmando && puedeEditar ? (
        <PanelConfirmar
          cual={cual}
          sp={sp}
          impacto={impacto}
          impactoTexto={impactoTexto}
          detalle={detalle}
          cadena={cadena}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="my-1">
            <MensajeEstado tipo="configuracion" titulo="Impacto de un cambio en cualquiera de estos valores">
              {impactoTexto}
            </MensajeEstado>
          </div>

          <Panel titulo="UVT — Unidad de Valor Tributario">
            <div className="p-5">
              {uvt ? (
                <p className="mb-3 text-menor text-texto-suave">
                  Año {uvt.anio}: ${(Number(uvt.valor) / 100).toLocaleString('es-CO')} desde{' '}
                  {uvt.vigente_desde}. Norma: {uvt.norma_respaldo}
                </p>
              ) : (
                <p className="mb-3 text-menor text-pendiente-tinta">
                  No hay ninguna UVT vigente hoy visible para esta sesión.
                </p>
              )}
              {puedeEditar && uvt && (
                <form action={simularUvtAction} className="grid max-w-lg grid-cols-1 gap-3">
                  <input type="hidden" name="reglaAnteriorId" value={uvt.id} />
                  <Campo etiqueta="Año" requerido>
                    <Entrada name="anio" type="number" required defaultValue={uvt.anio} />
                  </Campo>
                  <Campo etiqueta="Valor nuevo (pesos)" requerido>
                    <Entrada name="valorPesos" type="number" step="1" required defaultValue={Number(uvt.valor) / 100} />
                  </Campo>
                  <CamposVigencia />
                  <div>
                    <Boton tipo="submit">Simular impacto</Boton>
                  </div>
                </form>
              )}
            </div>
          </Panel>

          <Panel titulo="SMMLV y auxilio de transporte">
            <div className="p-5">
              {smmlv ? (
                <p className="mb-3 text-menor text-texto-suave">
                  Año {smmlv.anio}: ${(Number(smmlv.valor_mensual) / 100).toLocaleString('es-CO')} mensual
                  {smmlv.auxilio_transporte
                    ? `, auxilio $${(Number(smmlv.auxilio_transporte) / 100).toLocaleString('es-CO')}`
                    : ''}{' '}
                  desde {smmlv.vigente_desde}. Norma: {smmlv.norma_respaldo}
                </p>
              ) : (
                <p className="mb-3 text-menor text-pendiente-tinta">
                  No hay ningún SMMLV vigente hoy (ver alerta en la página principal de parametrización).
                </p>
              )}
              {puedeEditar && smmlv && (
                <form action={simularSmmlvAction} className="grid max-w-lg grid-cols-1 gap-3">
                  <input type="hidden" name="reglaAnteriorId" value={smmlv.id} />
                  <Campo etiqueta="Año" requerido>
                    <Entrada name="anio" type="number" required defaultValue={smmlv.anio} />
                  </Campo>
                  <Campo etiqueta="Valor mensual nuevo (pesos)" requerido>
                    <Entrada
                      name="valorMensualPesos"
                      type="number"
                      step="1"
                      required
                      defaultValue={Number(smmlv.valor_mensual) / 100}
                    />
                  </Campo>
                  <Campo etiqueta="Auxilio de transporte (pesos, opcional)">
                    <Entrada
                      name="auxilioTransportePesos"
                      type="number"
                      step="1"
                      defaultValue={smmlv.auxilio_transporte ? Number(smmlv.auxilio_transporte) / 100 : ''}
                    />
                  </Campo>
                  <CamposVigencia />
                  <div>
                    <Boton tipo="submit">Simular impacto</Boton>
                  </div>
                </form>
              )}
            </div>
          </Panel>

          <Panel titulo="Redondeo general">
            <div className="p-5">
              {redondeo ? (
                <p className="mb-3 text-menor text-texto-suave">
                  {redondeo.codigo}: modo «{redondeo.modo}», múltiplo {redondeo.multiplo} centavos, desde{' '}
                  {redondeo.vigente_desde}. Norma: {redondeo.norma_respaldo}
                </p>
              ) : (
                <p className="mb-3 text-menor text-pendiente-tinta">
                  No hay ninguna regla de redondeo general vigente hoy.
                </p>
              )}
              {puedeEditar && redondeo && (
                <form action={simularRedondeoAction} className="grid max-w-lg grid-cols-1 gap-3">
                  <input type="hidden" name="reglaAnteriorId" value={redondeo.id} />
                  <Campo etiqueta="Modo">
                    <Selector name="modo" defaultValue={redondeo.modo}>
                      <option value="half_up">Redondeo comercial (half_up)</option>
                      <option value="half_even">Redondeo bancario (half_even)</option>
                      <option value="truncar">Truncar</option>
                      <option value="techo">Hacia arriba (techo)</option>
                      <option value="piso">Hacia abajo (piso)</option>
                    </Selector>
                  </Campo>
                  <Campo etiqueta="Múltiplo (centavos: 100 = al peso)">
                    <Entrada name="multiplo" type="number" required defaultValue={redondeo.multiplo} />
                  </Campo>
                  <CamposVigencia />
                  <div>
                    <Boton tipo="submit">Simular impacto</Boton>
                  </div>
                </form>
              )}
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}

function CamposVigencia() {
  return (
    <>
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
    </>
  );
}

function PanelConfirmar({
  cual,
  sp,
  impacto,
  impactoTexto,
  detalle,
  cadena,
}: {
  cual: string;
  sp: BusquedaParams;
  impacto: ImpactoSimulado;
  impactoTexto: string;
  detalle: DetalleImpacto | null;
  cadena: (sp: BusquedaParams, campo: string) => string;
}) {
  const titulos: Record<string, string> = {
    uvt: 'UVT',
    smmlv: 'SMMLV y auxilio de transporte',
    redondeo: 'Redondeo general',
  };
  const acciones = {
    uvt: confirmarUvtAction,
    smmlv: confirmarSmmlvAction,
    redondeo: confirmarRedondeoAction,
  } as const;
  const camposPorCual: Record<string, string[]> = {
    uvt: ['reglaAnteriorId', 'anio', 'valorPesos', 'vigenteDesde', 'normaRespaldo', 'alcanceNuevo'],
    smmlv: [
      'reglaAnteriorId',
      'anio',
      'valorMensualPesos',
      'auxilioTransportePesos',
      'vigenteDesde',
      'normaRespaldo',
      'alcanceNuevo',
    ],
    redondeo: ['reglaAnteriorId', 'modo', 'multiplo', 'vigenteDesde', 'normaRespaldo', 'alcanceNuevo'],
  };
  const accion = acciones[cual as keyof typeof acciones];
  const campos = camposPorCual[cual] ?? [];
  if (!accion) {
    return <MensajeEstado tipo="error" titulo={`Valor base desconocido: ${cual}`} />;
  }

  return (
    <Panel titulo={`Confirmar vigencia nueva — ${titulos[cual] ?? cual}`}>
      <div className="space-y-3 p-5">
        <MensajeEstado tipo="configuracion" titulo={impactoTexto} />
        {detalle && <BotonDetalleImpacto detalle={detalle} />}
        <ul className="list-disc pl-5 text-cuerpo text-texto">
          {campos
            .filter((c) => c !== 'reglaAnteriorId')
            .map((c) => (
              <li key={c}>
                {c}: {cadena(sp, c) || '—'}
              </li>
            ))}
        </ul>
        <form action={accion} className="flex items-center gap-3">
          {campos.map((c) => (
            <input key={c} type="hidden" name={c} value={cadena(sp, c)} />
          ))}
          {/* Testigo del paso 1 (V-39): las cifras REALES que se acaban de
              mostrar. La acción las vuelve a medir contra la base y solo escribe
              si siguen siendo las mismas; sin ellas no guarda. */}
          <input type="hidden" name="conceptos" value={String(impacto.conceptosAfectados)} />
          <input type="hidden" name="proveedores" value={String(impacto.proveedoresAfectados)} />
          <Boton tipo="submit">Guardar vigencia nueva</Boton>
          <a
            href="/parametros/valores-base"
            className="font-semibold text-primario underline dark:text-primario-tinta-oscura"
          >
            Cancelar
          </a>
        </form>
      </div>
    </Panel>
  );
}

/**
 * A8 — UVT, SMMLV/auxilio de transporte y redondeo general.
 *
 * Las consultas de LECTURA de esta página son directas (no pasan por una
 * función dedicada del servicio, a diferencia de `listarTarifasPorTipo`):
 * son de solo lectura y de una sola tabla con la misma prioridad de alcance
 * (empresa > firma > global) que usa el motor. La ESCRITURA sí pasa siempre
 * por el servicio (`editarUvtValue` / `editarSmmlvValue` / `editarRoundingRule`),
 * que es donde viven las seis conductas obligatorias y donde A14 las verifica.
 */
import Link from 'next/link';
import { conSesion } from '../../lib/sesion';
import { puedeEditarParametros, simularImpactoValorBase, hoyIso } from '../../../src/services/parametrizacion';
import { MensajeError } from '../_componentes';
import { guardarRedondeoAction, guardarSmmlvAction, guardarUvtAction } from './acciones';

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

export default async function PaginaValoresBase({ searchParams }: { searchParams: Promise<BusquedaParams> }) {
  const sp = await searchParams;

  const { uvt, smmlv, redondeo, puedeEditar, impacto } = await conSesion(async (tx) => {
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
      puedeEditarParametros(tx),
      simularImpactoValorBase(tx),
    ]);
    return {
      uvt: uvtRes.rows[0] ?? null,
      smmlv: smmlvRes.rows[0] ?? null,
      redondeo: redondeoRes.rows[0] ?? null,
      puedeEditar: puedeEditarRes,
      impacto: impactoRes,
    };
  });

  return (
    <main style={{ maxWidth: 800, margin: '0 auto', padding: '24px' }}>
      <p>
        <Link href="/parametros">« Volver a parametrización</Link>
      </p>
      <h1>Valores base</h1>
      <MensajeError error={cadena(sp, 'error') || undefined} />
      {cadena(sp, 'ok') && (
        <p style={{ color: '#166534', border: '1px solid #166534', padding: '8px 12px' }}>
          Vigencia guardada: la anterior quedó cerrada, la nueva rige desde la fecha confirmada.
        </p>
      )}

      <p style={{ border: '1px solid #334155', padding: '8px 12px' }}>
        <strong>
          Cualquiera de estos tres valores afecta hoy a {impacto.conceptosAfectados} concepto(s) de
          causación y {impacto.proveedoresAfectados} proveedor(es) con historial en esta firma
          (sección 6.2, punto 6): todos calculan con base en la UVT, el SMMLV o el redondeo general.
        </strong>
      </p>

      {!puedeEditar && (
        <p>
          <em>Su sesión no tiene el permiso «parametro.editar»: solo puede consultar estos valores.</em>
        </p>
      )}

      <section style={{ marginTop: '24px' }}>
        <h2>UVT — Unidad de Valor Tributario</h2>
        {uvt ? (
          <p>
            Año {uvt.anio}: ${(Number(uvt.valor) / 100).toLocaleString('es-CO')} desde {uvt.vigente_desde}.
            Norma: {uvt.norma_respaldo}
          </p>
        ) : (
          <p style={{ color: '#b45309' }}>No hay ninguna UVT vigente hoy visible para esta sesión.</p>
        )}
        {puedeEditar && uvt && (
          <form action={guardarUvtAction}>
            <input type="hidden" name="reglaAnteriorId" value={uvt.id} />
            <div>
              <label>
                Año <input name="anio" type="number" required defaultValue={uvt.anio} />
              </label>
            </div>
            <div>
              <label>
                Valor nuevo (pesos){' '}
                <input name="valorPesos" type="number" step="1" required defaultValue={Number(uvt.valor) / 100} />
              </label>
            </div>
            <div>
              <label>
                Vigente desde <input name="vigenteDesde" type="date" required defaultValue={hoyIso()} />
              </label>
            </div>
            <div>
              <label>
                Norma de respaldo <input name="normaRespaldo" type="text" required size={50} />
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
            <label>
              <input type="checkbox" required /> He revisado el impacto indicado arriba.
            </label>
            <div>
              <button type="submit">Guardar UVT nueva</button>
            </div>
          </form>
        )}
      </section>

      <section style={{ marginTop: '24px' }}>
        <h2>SMMLV y auxilio de transporte</h2>
        {smmlv ? (
          <p>
            Año {smmlv.anio}: ${(Number(smmlv.valor_mensual) / 100).toLocaleString('es-CO')} mensual
            {smmlv.auxilio_transporte ? `, auxilio $${(Number(smmlv.auxilio_transporte) / 100).toLocaleString('es-CO')}` : ''}
            {' '}desde {smmlv.vigente_desde}. Norma: {smmlv.norma_respaldo}
          </p>
        ) : (
          <p style={{ color: '#b45309' }}>
            No hay ningún SMMLV vigente hoy (ver alerta en la página principal de parametrización).
            Cárguelo aquí por primera vez llamando al servicio, o pida a A1 la verificación normativa.
          </p>
        )}
        {puedeEditar && smmlv && (
          <form action={guardarSmmlvAction}>
            <input type="hidden" name="reglaAnteriorId" value={smmlv.id} />
            <div>
              <label>
                Año <input name="anio" type="number" required defaultValue={smmlv.anio} />
              </label>
            </div>
            <div>
              <label>
                Valor mensual nuevo (pesos){' '}
                <input name="valorMensualPesos" type="number" step="1" required defaultValue={Number(smmlv.valor_mensual) / 100} />
              </label>
            </div>
            <div>
              <label>
                Auxilio de transporte (pesos, opcional){' '}
                <input
                  name="auxilioTransportePesos"
                  type="number"
                  step="1"
                  defaultValue={smmlv.auxilio_transporte ? Number(smmlv.auxilio_transporte) / 100 : ''}
                />
              </label>
            </div>
            <div>
              <label>
                Vigente desde <input name="vigenteDesde" type="date" required defaultValue={hoyIso()} />
              </label>
            </div>
            <div>
              <label>
                Norma de respaldo <input name="normaRespaldo" type="text" required size={50} />
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
            <label>
              <input type="checkbox" required /> He revisado el impacto indicado arriba.
            </label>
            <div>
              <button type="submit">Guardar SMMLV nuevo</button>
            </div>
          </form>
        )}
      </section>

      <section style={{ marginTop: '24px' }}>
        <h2>Redondeo general</h2>
        {redondeo ? (
          <p>
            {redondeo.codigo}: modo «{redondeo.modo}», múltiplo {redondeo.multiplo} centavos, desde{' '}
            {redondeo.vigente_desde}. Norma: {redondeo.norma_respaldo}
          </p>
        ) : (
          <p style={{ color: '#b45309' }}>No hay ninguna regla de redondeo general vigente hoy.</p>
        )}
        {puedeEditar && redondeo && (
          <form action={guardarRedondeoAction}>
            <input type="hidden" name="reglaAnteriorId" value={redondeo.id} />
            <div>
              <label>
                Modo{' '}
                <select name="modo" defaultValue={redondeo.modo}>
                  <option value="half_up">Redondeo comercial (half_up)</option>
                  <option value="half_even">Redondeo bancario (half_even)</option>
                  <option value="truncar">Truncar</option>
                  <option value="techo">Hacia arriba (techo)</option>
                  <option value="piso">Hacia abajo (piso)</option>
                </select>
              </label>
            </div>
            <div>
              <label>
                Múltiplo (centavos: 100 = al peso){' '}
                <input name="multiplo" type="number" required defaultValue={redondeo.multiplo} />
              </label>
            </div>
            <div>
              <label>
                Vigente desde <input name="vigenteDesde" type="date" required defaultValue={hoyIso()} />
              </label>
            </div>
            <div>
              <label>
                Norma de respaldo <input name="normaRespaldo" type="text" required size={50} />
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
            <label>
              <input type="checkbox" required /> He revisado el impacto indicado arriba.
            </label>
            <div>
              <button type="submit">Guardar regla de redondeo</button>
            </div>
          </form>
        )}
      </section>
    </main>
  );
}

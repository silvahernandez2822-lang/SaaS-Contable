/**
 * A8 — Editor de `tax_rule`: retefuente, retefuente_salarios, autorretención,
 * ReteIVA, ReteICA por actividad e IVA. Una sola pantalla para las seis
 * familias de la sección 6.3 porque comparten exactamente el mismo modelo.
 */
import Link from 'next/link';
import {
  listarConceptosSinTarifaVigente,
  listarTarifasPorTipo,
  puedeEditarParametros,
  hoyIso,
  type FilaTarifa,
  type TipoTaxRule,
} from '../../../../src/services/parametrizacion.js';
import { conSesion } from '../../../lib/sesion.js';
import { BadgeAlcance, MensajeError } from '../../_componentes.js';
import { confirmarAction, simularAction } from './acciones.js';

export const dynamic = 'force-dynamic';

const TITULOS: Record<TipoTaxRule, string> = {
  retefuente: 'Retención en la fuente a título de renta',
  retefuente_salarios: 'Retención en la fuente por salarios (tabla progresiva, art. 383 ET)',
  autorretencion: 'Autorretención de renta por CIIU',
  reteiva: 'Retención de IVA (ReteIVA)',
  reteica: 'ReteICA — tarifas por actividad económica',
  iva: 'IVA — tarifas',
};

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
      <main style={{ maxWidth: 900, margin: '0 auto', padding: '24px' }}>
        <p>Tipo de tarifa desconocido: {tipoCrudo}</p>
      </main>
    );
  }
  const tipo = tipoCrudo as TipoTaxRule;

  const [tarifas, faltantes, puedeEditar] = await conSesion((tx) =>
    Promise.all([
      listarTarifasPorTipo(tx, tipo),
      listarConceptosSinTarifaVigente(tx, tipo),
      puedeEditarParametros(tx),
    ]),
  );

  const reglaEditando = cadena(sp, 'editar');
  const filaEditando: FilaTarifa | undefined = reglaEditando
    ? tarifas.find((t) => t.reglaId === reglaEditando)
    : undefined;
  const confirmando = cadena(sp, 'confirmar') === '1';
  const ok = cadena(sp, 'ok');

  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: '24px' }}>
      <p>
        <Link href="/parametros">« Volver a parametrización</Link>
      </p>
      <h1>{TITULOS[tipo]}</h1>

      <MensajeError error={cadena(sp, 'error') || undefined} />
      {ok && (
        <p style={{ color: '#166534', border: '1px solid #166534', padding: '8px 12px' }}>
          Vigencia guardada. La vigencia anterior quedó cerrada (nunca se sobrescribió) y la nueva
          rige desde la fecha confirmada. Queda registrada en el registro de auditoría con la norma
          de respaldo escrita.
        </p>
      )}

      {faltantes.length > 0 && (
        <section style={{ border: '1px solid #b45309', background: '#fffbeb', padding: '12px', margin: '16px 0' }}>
          <strong>{faltantes.length} concepto(s) de este tipo sin ninguna tarifa vigente hoy:</strong>
          <ul>
            {faltantes.map((f) => (
              <li key={f.taxConceptId}>
                {f.codigo} — {f.nombre}. No hay valor por omisión: el motor manda a revisión manual
                cualquier documento que dependa de este concepto.
              </li>
            ))}
          </ul>
        </section>
      )}

      <table style={{ borderCollapse: 'collapse' }} border={1} cellPadding={4}>
        <thead>
          <tr>
            <th>Código</th>
            <th>Nombre</th>
            <th>Tarifa</th>
            <th>Base mínima (UVT)</th>
            <th>Vigente desde</th>
            <th>Alcance</th>
            <th>Norma de respaldo</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {tarifas
            .filter((t) => t.esEfectiva)
            .map((t) => (
              <tr key={t.reglaId}>
                <td>{t.codigo}</td>
                <td>
                  {t.nombre}
                  {t.municipalityNombre ? ` — ${t.municipalityNombre}` : ''}
                  {t.ciiuCodigo ? ` — CIIU ${t.ciiuCodigo}` : ''}
                  {t.requiereVerificacionHumana ? ' ⚠ verificar' : ''}
                </td>
                <td>{(Number(t.tarifa) * 100).toString()}%</td>
                <td>{t.baseMinimaUvt ?? '—'}</td>
                <td>{t.vigenteDesde}</td>
                <td>
                  <BadgeAlcance alcance={t.alcance} />
                </td>
                <td>{t.normaRespaldo}</td>
                <td>
                  {puedeEditar && (
                    <Link href={`?editar=${t.reglaId}`}>Editar</Link>
                  )}
                </td>
              </tr>
            ))}
        </tbody>
      </table>

      {!puedeEditar && (
        <p>
          <em>
            Su sesión no tiene el permiso <code>parametro.editar</code>: solo puede consultar esta
            tabla. Pídale a un administrador tributario que edite el valor.
          </em>
        </p>
      )}

      {filaEditando && puedeEditar && !confirmando && (
        <section style={{ border: '1px solid #334155', padding: '16px', marginTop: '24px' }}>
          <h2>Editar: {filaEditando.codigo}</h2>
          <p>
            Vigencia actual: {(Number(filaEditando.tarifa) * 100).toString()}% desde{' '}
            {filaEditando.vigenteDesde}, respaldada en «{filaEditando.normaRespaldo}».
          </p>
          <form action={simularAction}>
            <input type="hidden" name="tipo" value={tipo} />
            <input type="hidden" name="reglaAnteriorId" value={filaEditando.reglaId} />
            <input type="hidden" name="taxConceptId" value={filaEditando.taxConceptId} />
            <div>
              <label>
                Tarifa nueva (%){' '}
                <input
                  name="tarifaPorcentaje"
                  type="number"
                  step="any"
                  required
                  defaultValue={(Number(filaEditando.tarifa) * 100).toString()}
                />
              </label>
            </div>
            <div>
              <label>
                Base mínima (UVT){' '}
                <input name="baseMinimaUvt" type="number" step="any" defaultValue={filaEditando.baseMinimaUvt ?? ''} />
              </label>
            </div>
            <div>
              <label>
                Cuenta contable (código PUC, opcional — vacío conserva la actual){' '}
                <input name="cuentaCodigo" type="text" placeholder={filaEditando.accountId ?? ''} />
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
                <input name="normaRespaldo" type="text" required size={60} placeholder="Ej: Decreto 572 de 2025, art. 3" />
              </label>
            </div>
            <div>
              <label>
                <input type="radio" name="alcanceNuevo" value="firma" defaultChecked /> Compartida entre
                todas las empresas de la firma
              </label>
              <label style={{ marginLeft: '16px' }}>
                <input type="radio" name="alcanceNuevo" value="empresa" /> Solo la empresa en sesión
              </label>
            </div>
            <button type="submit">Simular impacto</button>
          </form>
        </section>
      )}

      {filaEditando && puedeEditar && confirmando && (
        <section style={{ border: '1px solid #334155', padding: '16px', marginTop: '24px' }}>
          <h2>Confirmar vigencia nueva</h2>
          <p>
            <strong>
              Esta tarifa afecta {cadena(sp, 'conceptos')} concepto(s) de causación y{' '}
              {cadena(sp, 'proveedores')} proveedor(es) con historial (sección 6.2, punto 6).
            </strong>
          </p>
          {cadena(sp, 'fechaMinima') && (
            <p>
              Ya hay asientos publicados con la regla actual hasta el {cadena(sp, 'fechaMinima')}: la
              vigencia nueva debe empezar después de esa fecha.
            </p>
          )}
          <ul>
            <li>Tarifa nueva: {cadena(sp, 'tarifaPorcentaje')}%</li>
            <li>Base mínima UVT: {cadena(sp, 'baseMinimaUvt') || '—'}</li>
            <li>Vigente desde: {cadena(sp, 'vigenteDesde')}</li>
            <li>Norma de respaldo: {cadena(sp, 'normaRespaldo')}</li>
            <li>
              Alcance:{' '}
              {cadena(sp, 'alcanceNuevo') === 'empresa' ? 'solo esta empresa' : 'compartida en la firma'}
            </li>
          </ul>
          <form action={confirmarAction}>
            <input type="hidden" name="tipo" value={tipo} />
            <input type="hidden" name="reglaAnteriorId" value={filaEditando.reglaId} />
            <input type="hidden" name="tarifaPorcentaje" value={cadena(sp, 'tarifaPorcentaje')} />
            <input type="hidden" name="baseMinimaUvt" value={cadena(sp, 'baseMinimaUvt')} />
            <input type="hidden" name="cuentaCodigo" value={cadena(sp, 'cuentaCodigo')} />
            <input type="hidden" name="vigenteDesde" value={cadena(sp, 'vigenteDesde')} />
            <input type="hidden" name="normaRespaldo" value={cadena(sp, 'normaRespaldo')} />
            <input type="hidden" name="alcanceNuevo" value={cadena(sp, 'alcanceNuevo')} />
            <button type="submit">Guardar vigencia nueva</button>{' '}
            <Link href={`?editar=${filaEditando.reglaId}`}>Volver a editar</Link>
          </form>
        </section>
      )}
    </main>
  );
}

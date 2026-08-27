/**
 * A7 — Piezas de la bandeja de causación multi-empresa. HTML semántico con
 * `style` inline mínimo, igual que `app/parametros/_componentes.tsx` (A8):
 * sin librería de estilos, para que se pueda reemplazar sin fricción.
 *
 * OJO CON EL DETECTOR DE LA REGLA DE ORO 2 (advertencia dejada por A5/A8): no
 * hay ni un literal `0.NNN` ni un `N%` en este archivo. Las conversiones de
 * centavos a pesos y de fracción a porcentaje son SIEMPRE cálculos en tiempo
 * de ejecución (`Number(x) / 100`, `Number(x) * 100`), nunca un número
 * decimal escrito a mano — así es como A8 mostró tarifas sin que el barrido
 * de `tests/adversarial/valores-tributarios.test.ts` lo confundiera con una
 * tarifa quemada.
 */
import type { RetencionResumen, PartidaResumen } from '../../src/services/consulta.js';
import type { MotivoRevision, LineaExtraida, MunicipioOpcion } from '../lib/bandeja.js';

/** Centavos (BIGINT como texto, Regla de Oro 5) -> pesos formateados. */
export function pesos(centavosTexto: string | number): string {
  const centavos = typeof centavosTexto === 'string' ? Number(centavosTexto) : centavosTexto;
  return (centavos / 100).toLocaleString('es-CO');
}

/** Fracción decimal canónica (`tax_rule.tarifa`) -> puntos porcentuales, en tiempo de ejecución. */
export function porcentaje(tarifaTexto: string): string {
  return (Number(tarifaTexto) * 100).toString();
}

export function MensajeError({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <p role="alert" style={{ color: '#b91c1c', border: '1px solid #b91c1c', padding: '8px 12px' }}>
      {decodeURIComponent(error)}
    </p>
  );
}

/**
 * Diferenciador de producto (sección 4, rol de A7): base, tarifa, norma
 * aplicada y vigencia de CADA retención evaluada, visibles siempre — no solo
 * el valor final. Incluye las que NO aplicaron, con su motivo, porque
 * "se evaluó y no aplicó" es información tan trazable como "se aplicó".
 */
export function TrazaRetenciones({ retenciones }: { retenciones: RetencionResumen[] }) {
  if (retenciones.length === 0) {
    return <p><em>El motor no evaluó ninguna retención para este documento.</em></p>;
  }
  return (
    <table style={{ borderCollapse: 'collapse', width: 'auto', marginTop: '8px' }} border={1} cellPadding={4}>
      <thead>
        <tr>
          <th>Tipo</th>
          <th>Concepto</th>
          <th>Base</th>
          <th>Tarifa</th>
          <th>Valor</th>
          <th>Vigente desde</th>
          <th>Vigente hasta</th>
          <th>Municipio (ReteICA)</th>
          <th>Norma aplicada</th>
        </tr>
      </thead>
      <tbody>
        {retenciones.map((r) => (
          <tr key={r.id}>
            <td>{r.tipo}</td>
            <td>{r.conceptoCodigo ?? '—'}</td>
            <td>${pesos(r.base)}</td>
            <td>{porcentaje(r.tarifa)}%</td>
            <td>{r.aplicada ? `$${pesos(r.valor)}` : 'no aplicó'}</td>
            <td>{r.vigenteDesde}</td>
            <td>{r.vigenteHasta ?? 'vigente'}</td>
            <td>{r.municipioNombre ?? '—'}</td>
            <td>{r.normaRespaldo}{r.motivoNoAplica ? ` — ${r.motivoNoAplica}` : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function PartidasAsiento({ partidas }: { partidas: PartidaResumen[] }) {
  if (partidas.length === 0) return null;
  return (
    <details style={{ marginTop: '6px' }}>
      <summary>Ver partidas del asiento ({partidas.length})</summary>
      <table style={{ borderCollapse: 'collapse', marginTop: '6px' }} border={1} cellPadding={4}>
        <thead>
          <tr>
            <th>Cuenta</th>
            <th>Movimiento</th>
            <th>Monto</th>
            <th>Descripción</th>
          </tr>
        </thead>
        <tbody>
          {partidas.map((p) => (
            <tr key={p.id}>
              <td>{p.cuentaCodigo} — {p.cuentaNombre}</td>
              <td>{p.side}</td>
              <td>${pesos(p.monto)}</td>
              <td>{p.descripcion ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

export function MotivosRevision({ motivos }: { motivos: MotivoRevision[] }) {
  return (
    <ul>
      {motivos.map((m, i) => (
        <li key={`${m.codigo}-${i}`}>
          <code>{m.codigo}</code> — {m.detalle}
        </li>
      ))}
    </ul>
  );
}

/** Tabla de líneas del documento con un input de AIU por línea (V-7): el
 * humano decide, viendo la descripción real de la línea, a cuál(es) cargar
 * el AIU — el sistema no lo adivina. */
export function LineasConAiu({
  lineas,
  aiuGuardado,
}: {
  lineas: readonly LineaExtraida[];
  aiuGuardado: ReadonlyMap<number, number>;
}) {
  return (
    <table style={{ borderCollapse: 'collapse', marginTop: '8px' }} border={1} cellPadding={4}>
      <thead>
        <tr>
          <th>Línea</th>
          <th>Descripción</th>
          <th>Base de la línea</th>
          <th>AIU (pesos, si aplica)</th>
        </tr>
      </thead>
      <tbody>
        {lineas.map((l) => {
          const yaGuardado = aiuGuardado.get(l.numero);
          return (
            <tr key={l.numero}>
              <td>{l.numero}</td>
              <td>{l.descripcion ?? '—'}</td>
              <td>${l.baseGravable !== null ? pesos(l.baseGravable) : '—'}</td>
              <td>
                <input
                  type="number"
                  min="0"
                  step="1"
                  name={`aiuLinea_${l.numero}`}
                  defaultValue={yaGuardado !== undefined ? String(Math.round(yaGuardado / 100)) : ''}
                  placeholder="vacío = no aplica"
                  style={{ width: '140px' }}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function SelectorMunicipio({
  municipios,
  seleccionado,
}: {
  municipios: readonly MunicipioOpcion[];
  seleccionado: string | null;
}) {
  return (
    <select name="municipioOperacionId" defaultValue={seleccionado ?? ''}>
      <option value="">Sin corregir — usar el municipio del tercero</option>
      {municipios.map((m) => (
        <option key={m.id} value={m.id}>
          {m.nombre} ({m.departamento})
        </option>
      ))}
    </select>
  );
}

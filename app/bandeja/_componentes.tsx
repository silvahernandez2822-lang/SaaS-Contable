/**
 * A7 — Piezas de la bandeja de causación multi-empresa.
 *
 * D-077 (Ola 5, front): migradas al lenguaje visual del sistema de interfaz
 * (`app/_ui/componentes.tsx`). Los NOMBRES de campo de formulario NO cambian
 * (`sel`, `aiuLinea_N`, `municipioOperacionId`, `motivo`): son el contrato con
 * `app/bandeja/acciones.ts` y con la suite. Tampoco cambia qué se muestra: base,
 * tarifa, norma y vigencia de CADA retención evaluada, incluidas las que no
 * aplicaron con su motivo — es diferenciador de producto (sección 4).
 *
 * OJO CON EL DETECTOR DE LA REGLA DE ORO 2: no hay ni un literal `0.NNN` ni un
 * `N%` en este archivo. Las conversiones de centavos a pesos y de fracción a
 * porcentaje son SIEMPRE cálculos en tiempo de ejecución (`Number(x) / 100`,
 * `Number(x) * 100`), nunca un decimal escrito a mano.
 */
import type { RetencionResumen, PartidaResumen } from '../../src/services/consulta';
import type { MotivoRevision, LineaExtraida, MunicipioOpcion } from '../lib/bandeja';
import { MensajeEstado, Tabla, Td, Th } from '../_ui/componentes';

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
    <div className="my-3">
      <MensajeEstado tipo="error" titulo="La operación no se completó">
        {decodeURIComponent(error)}
      </MensajeEstado>
    </div>
  );
}

/**
 * Diferenciador de producto (sección 4): base, tarifa, norma aplicada y vigencia
 * de CADA retención evaluada, visibles siempre — no solo el valor final. Incluye
 * las que NO aplicaron, con su motivo.
 */
export function TrazaRetenciones({ retenciones }: { retenciones: RetencionResumen[] }) {
  if (retenciones.length === 0) {
    return <p className="text-[12px] text-texto-suave italic">El motor no evaluó ninguna retención para este documento.</p>;
  }
  return (
    <Tabla>
      <thead>
        <tr>
          <Th>Tipo</Th>
          <Th>Concepto</Th>
          <Th alineado="right">Base</Th>
          <Th alineado="right">Tarifa</Th>
          <Th alineado="right">Valor</Th>
          <Th>Vigencia</Th>
          <Th>Municipio (ReteICA)</Th>
          <Th>Norma aplicada</Th>
        </tr>
      </thead>
      <tbody>
        {retenciones.map((r) => (
          <tr key={r.id} className={`border-t border-borde/60 ${r.aplicada ? '' : 'text-texto-suave'}`}>
            <Td>{r.tipo}</Td>
            <Td>{r.conceptoCodigo ?? '—'}</Td>
            <Td alineado="right" numerico>${pesos(r.base)}</Td>
            <Td alineado="right" numerico>{porcentaje(r.tarifa)}%</Td>
            <Td alineado="right" numerico>
              {r.aplicada ? `$${pesos(r.valor)}` : <span className="text-texto-suave">no aplicó</span>}
            </Td>
            <Td numerico>
              {r.vigenteDesde} → {r.vigenteHasta ?? 'vigente'}
            </Td>
            <Td>{r.municipioNombre ?? '—'}</Td>
            <Td>
              {r.normaRespaldo}
              {r.motivoNoAplica ? ` — ${r.motivoNoAplica}` : ''}
            </Td>
          </tr>
        ))}
      </tbody>
    </Tabla>
  );
}

export function PartidasAsiento({ partidas }: { partidas: PartidaResumen[] }) {
  if (partidas.length === 0) return null;
  return (
    <details className="mt-2 text-[12.5px]">
      <summary className="cursor-pointer text-primario dark:text-primario-tinta-oscura">
        Ver partidas del asiento ({partidas.length})
      </summary>
      <div className="mt-2">
        <Tabla>
          <thead>
            <tr>
              <Th>Cuenta</Th>
              <Th>Movimiento</Th>
              <Th alineado="right">Monto</Th>
              <Th>Descripción</Th>
            </tr>
          </thead>
          <tbody>
            {partidas.map((p) => (
              <tr key={p.id} className="border-t border-borde/60">
                <Td numerico>
                  {p.cuentaCodigo} — {p.cuentaNombre}
                </Td>
                <Td>{p.side}</Td>
                <Td alineado="right" numerico>${pesos(p.monto)}</Td>
                <Td>{p.descripcion ?? '—'}</Td>
              </tr>
            ))}
          </tbody>
        </Tabla>
      </div>
    </details>
  );
}

export function MotivosRevision({ motivos }: { motivos: MotivoRevision[] }) {
  return (
    <ul className="ml-4 list-disc text-[12.5px] text-texto-suave">
      {motivos.map((m, i) => (
        <li key={`${m.codigo}-${i}`}>
          <code className="font-mono text-texto">{m.codigo}</code> — {m.detalle}
        </li>
      ))}
    </ul>
  );
}

/** Tabla de líneas del documento con un input de AIU por línea (V-7). */
export function LineasConAiu({
  lineas,
  aiuGuardado,
}: {
  lineas: readonly LineaExtraida[];
  aiuGuardado: ReadonlyMap<number, number>;
}) {
  return (
    <Tabla>
      <thead>
        <tr>
          <Th>Línea</Th>
          <Th>Descripción</Th>
          <Th alineado="right">Base de la línea</Th>
          <Th alineado="right">AIU (pesos, si aplica)</Th>
        </tr>
      </thead>
      <tbody>
        {lineas.map((l) => {
          const yaGuardado = aiuGuardado.get(l.numero);
          return (
            <tr key={l.numero} className="border-t border-borde/60">
              <Td numerico>{l.numero}</Td>
              <Td>{l.descripcion ?? '—'}</Td>
              <Td alineado="right" numerico>
                ${l.baseGravable !== null ? pesos(l.baseGravable) : '—'}
              </Td>
              <Td alineado="right">
                <input
                  type="number"
                  min="0"
                  step="1"
                  name={`aiuLinea_${l.numero}`}
                  defaultValue={yaGuardado !== undefined ? String(Math.round(yaGuardado / 100)) : ''}
                  placeholder="vacío = no aplica"
                  className="w-36 rounded-md border border-borde bg-superficie-elevada px-2 py-1 text-right text-[13px] tabular-nums"
                />
              </Td>
            </tr>
          );
        })}
      </tbody>
    </Tabla>
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
    <select
      name="municipioOperacionId"
      defaultValue={seleccionado ?? ''}
      className="rounded-md border border-borde bg-superficie-elevada px-3 py-2 text-[13px] text-texto"
    >
      <option value="">Sin corregir — usar el municipio del tercero</option>
      {municipios.map((m) => (
        <option key={m.id} value={m.id}>
          {m.nombre} ({m.departamento})
        </option>
      ))}
    </select>
  );
}

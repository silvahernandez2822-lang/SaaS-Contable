'use client';

/**
 * A7 · D-079 — piezas interactivas de la bandeja (lo que necesita estado en el
 * cliente). El resto de la bandeja sigue siendo server components en
 * `_componentes.tsx`. Los NOMBRES de campo de formulario son el contrato con
 * `app/bandeja/acciones.ts`:
 *   · selección en lote: `sel` = `companyId::journalEntryId` (ya existía).
 *   · edición de línea: `cuenta__<lineId>` y `monto__<lineId>` por cada
 *     partida, más `journalEntryId`, `companyId` y `justificacion`.
 *   · archivar rechazada: `confirmacion` debe ser exactamente "ARCHIVAR".
 *
 * REGLA DE COLOR (D-075): solo tokens de `app/globals.css`. Ni un `#hex`.
 * REGLA DE ORO 2: ni un literal `0.NNN` ni un `N%` — las conversiones
 * centavos↔pesos son cálculos en tiempo de ejecución.
 */
import { useMemo, useState } from 'react';
import { Boton } from '../_ui/componentes';

const LOCALE = 'es-CO';

function pesosDeCentavos(centavos: number): string {
  return (centavos / 100).toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function centavosDePesos(pesos: string): number | null {
  const limpio = pesos.replace(/[^\d.-]/g, '').trim();
  if (limpio === '' || !/^-?\d+(\.\d{1,2})?$/.test(limpio)) return null;
  return Math.round(Number(limpio) * 100);
}

/* --------------------------------------------- seleccionar todas / ninguna */

export function SelectorTodas({ total }: { total: number }) {
  const [marcado, setMarcado] = useState(false);
  return (
    <label className="flex items-center gap-2 text-[12px] font-medium text-texto">
      <input
        type="checkbox"
        checked={marcado}
        onChange={(e) => {
          const v = e.target.checked;
          setMarcado(v);
          document
            .querySelectorAll<HTMLInputElement>('input[type="checkbox"][name="sel"]')
            .forEach((cb) => {
              cb.checked = v;
            });
        }}
      />
      Seleccionar {marcado ? 'ninguna' : 'todas'} ({total})
    </label>
  );
}

/* ----------------------------------------------- editor de líneas del asiento */

export interface PartidaEditable {
  id: string;
  cuentaCodigo: string;
  cuentaNombre: string;
  side: 'debito' | 'credito';
  montoCentavos: string;
  descripcion: string | null;
  /** Partida que LLEVA una retención calculada por el motor. No se edita a
   * mano (A14, compuerta de D-079): su base, tarifa, regla y vigencia están
   * registradas en `retention_applied` y alimentan la exógena y los
   * certificados. El servicio la rechaza igual si el formulario llega a mano. */
  retentionAppliedId: string | null;
}
export interface CuentaOpcion {
  codigo: string;
  nombre: string;
}

interface EstadoLinea {
  cuentaCodigo: string;
  montoPesos: string;
}

export function EditorLineasAsiento({
  companyId,
  journalEntryId,
  partidas,
  cuentas,
  accion,
}: {
  companyId: string;
  journalEntryId: string;
  partidas: readonly PartidaEditable[];
  cuentas: readonly CuentaOpcion[];
  /** server action `editarLineaAction`. */
  accion: (formData: FormData) => void | Promise<void>;
}) {
  const original = useMemo<Record<string, EstadoLinea>>(() => {
    const o: Record<string, EstadoLinea> = {};
    for (const p of partidas) {
      o[p.id] = { cuentaCodigo: p.cuentaCodigo, montoPesos: pesosDeCentavos(Number(p.montoCentavos)) };
    }
    return o;
  }, [partidas]);

  const [estado, setEstado] = useState<Record<string, EstadoLinea>>(original);
  const [justificacion, setJustificacion] = useState('');
  const [abierto, setAbierto] = useState(false);

  const codigosConocidos = useMemo(() => new Set(cuentas.map((c) => c.codigo)), [cuentas]);

  const filas = partidas.map((p) => {
    const e = estado[p.id]!;
    const cent = centavosDePesos(e.montoPesos);
    const cambiada =
      e.cuentaCodigo !== original[p.id]!.cuentaCodigo || e.montoPesos !== original[p.id]!.montoPesos;
    return { p, e, cent, cambiada };
  });

  const algunMontoInvalido = filas.some((f) => f.cent === null || f.cent <= 0);
  // Las partidas de retención no son editables: su cuenta la puso el motor y
  // no tiene por qué estar en el catálogo de cuentas ofrecidas.
  const algunaCuentaDesconocida = filas.some(
    (f) => !f.p.retentionAppliedId && !codigosConocidos.has(f.e.cuentaCodigo),
  );
  const hayCambios = filas.some((f) => f.cambiada);

  const saldo = filas.reduce((acc, f) => {
    if (f.cent === null) return acc;
    return acc + (f.p.side === 'debito' ? f.cent : -f.cent);
  }, 0);
  const descuadrado = saldo !== 0;

  const puedeGuardar =
    hayCambios &&
    !algunMontoInvalido &&
    !algunaCuentaDesconocida &&
    !descuadrado &&
    justificacion.trim() !== '';

  return (
    <div className="mt-2 rounded-md border border-borde">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="w-full border-b border-borde bg-superficie px-3 py-2 text-left text-[12px] font-semibold text-primario dark:text-primario-tinta-oscura"
      >
        {abierto ? 'Cerrar edición' : 'Editar cuentas y montos del asiento propuesto'}
      </button>

      {abierto && (
        <form action={accion} className="flex flex-col gap-3 p-3">
          <input type="hidden" name="companyId" value={companyId} />
          <input type="hidden" name="journalEntryId" value={journalEntryId} />

          <div className="overflow-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="text-texto-suave">
                  <th className="px-2 py-1 text-left font-medium">Movimiento</th>
                  <th className="px-2 py-1 text-left font-medium">Cuenta contable</th>
                  <th className="px-2 py-1 text-right font-medium">Monto (pesos)</th>
                  <th className="px-2 py-1 text-left font-medium">Detalle</th>
                </tr>
              </thead>
              <tbody>
                {filas.map(({ p, e, cent, cambiada }) =>
                  p.retentionAppliedId ? (
                    <tr key={p.id} className="border-t border-borde/60 align-top text-texto-suave">
                      <td className="px-2 py-1">{p.side}</td>
                      <td className="px-2 py-1">
                        <input type="hidden" name={`cuenta__${p.id}`} value={p.cuentaCodigo} />
                        <span className="font-mono">{p.cuentaCodigo}</span>{' '}
                        <span className="block text-[11px]">{p.cuentaNombre}</span>
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        <input type="hidden" name={`monto__${p.id}`} value={pesosDeCentavos(Number(p.montoCentavos))} />
                        {pesosDeCentavos(Number(p.montoCentavos))}
                      </td>
                      <td className="px-2 py-1 text-[11px]">
                        Retención calculada por el motor: no se edita a mano. Corrija el concepto o el parámetro y
                        reprocese, o rechace la causación.
                      </td>
                    </tr>
                  ) : (
                  <tr key={p.id} className="border-t border-borde/60 align-top">
                    <td className="px-2 py-1">{p.side}</td>
                    <td className="px-2 py-1">
                      <input
                        list={`cuentas-${journalEntryId}`}
                        name={`cuenta__${p.id}`}
                        value={e.cuentaCodigo}
                        onChange={(ev) =>
                          setEstado((s) => ({ ...s, [p.id]: { ...s[p.id]!, cuentaCodigo: ev.target.value } }))
                        }
                        className="w-56 rounded-md border border-borde bg-superficie-elevada px-2 py-1 text-[12px] text-texto"
                      />
                      {!codigosConocidos.has(e.cuentaCodigo) && (
                        <span className="mt-[2px] block text-[11px] font-semibold text-error">
                          Código PUC no imputable o inexistente
                        </span>
                      )}
                      {codigosConocidos.has(e.cuentaCodigo) && (
                        <span className="mt-[2px] block text-[11px] text-texto-suave">
                          {cuentas.find((c) => c.codigo === e.cuentaCodigo)?.nombre}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right">
                      <input
                        name={`monto__${p.id}`}
                        inputMode="decimal"
                        value={e.montoPesos}
                        onChange={(ev) =>
                          setEstado((s) => ({ ...s, [p.id]: { ...s[p.id]!, montoPesos: ev.target.value } }))
                        }
                        className={`w-32 rounded-md border bg-superficie-elevada px-2 py-1 text-right text-[12px] tabular-nums ${
                          cent === null || cent <= 0 ? 'border-error text-error' : 'border-borde text-texto'
                        }`}
                      />
                    </td>
                    <td className="px-2 py-1 text-texto-suave">
                      {p.descripcion ?? '—'}
                      {cambiada && (
                        <span className="ml-1 rounded bg-pendiente/12 px-1 py-[1px] text-[10px] font-semibold text-pendiente">
                          modificada
                        </span>
                      )}
                    </td>
                  </tr>
                  ),
                )}
              </tbody>
            </table>
            <datalist id={`cuentas-${journalEntryId}`}>
              {cuentas.map((c) => (
                <option key={c.codigo} value={c.codigo}>
                  {c.codigo} — {c.nombre}
                </option>
              ))}
            </datalist>
          </div>

          <div
            className={`rounded-md px-3 py-2 text-[12px] font-semibold ${
              descuadrado ? 'bg-error/12 text-error' : 'bg-exito/12 text-exito'
            }`}
          >
            {descuadrado
              ? `El asiento descuadra en ${pesosDeCentavos(Math.abs(saldo))} pesos (débitos − créditos). No se puede guardar hasta que cuadre.`
              : 'El asiento cuadra: débitos = créditos.'}
          </div>

          <label className="flex flex-col gap-1.5 text-[12px] font-medium text-texto">
            Justificación (obligatoria al apartarse de la propuesta del motor — Regla de Oro 6)
            <textarea
              name="justificacion"
              value={justificacion}
              onChange={(ev) => setJustificacion(ev.target.value)}
              rows={2}
              required={hayCambios}
              placeholder="Ej.: el proveedor facturó el servicio como 5135 pero corresponde a 5145 por el objeto del contrato."
              className="rounded-md border border-borde bg-superficie-elevada px-3 py-2 text-[13px] text-texto"
            />
          </label>

          <div className="flex items-center justify-end gap-2">
            {hayCambios && justificacion.trim() === '' && (
              <span className="text-[11px] text-texto-suave">Escriba la justificación para poder guardar.</span>
            )}
            <Boton tipo="submit" disabled={!puedeGuardar}>
              Guardar cambios del asiento
            </Boton>
          </div>
        </form>
      )}
    </div>
  );
}

/* ------------------------------------------------- confirmar archivado fuerte */

export function ConfirmarArchivar({
  companyId,
  sourceDocumentId,
  accion,
}: {
  companyId: string;
  sourceDocumentId: string;
  accion: (formData: FormData) => void | Promise<void>;
}) {
  const [texto, setTexto] = useState('');
  const [motivo, setMotivo] = useState('');
  const [abierto, setAbierto] = useState(false);
  const puede = texto === 'ARCHIVAR' && motivo.trim() !== '';

  if (!abierto) {
    return (
      <Boton variante="peligro" tipo="button" onClick={() => setAbierto(true)}>
        Archivar definitivamente…
      </Boton>
    );
  }

  return (
    <form action={accion} className="flex flex-col gap-2 rounded-md border border-error/40 bg-error/8 p-3">
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="sourceDocumentId" value={sourceDocumentId} />
      <p className="text-[12px] text-texto">
        Archivar retira la factura de todas las vistas de trabajo. <strong>No se borra</strong>: la fila, su
        XML y su historial de auditoría permanecen y siguen saliendo en los reportes de auditoría.{' '}
        <strong>Todavía no hay pantalla para desarchivar</strong>: recuperarla exige intervención de soporte.
      </p>
      <label className="flex flex-col gap-1 text-[12px] font-medium text-texto">
        Motivo (obligatorio)
        <input
          name="motivo"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          className="rounded-md border border-borde bg-superficie-elevada px-2 py-1 text-[13px] text-texto"
        />
      </label>
      <label className="flex flex-col gap-1 text-[12px] font-medium text-texto">
        Escriba <code className="font-mono">ARCHIVAR</code> para confirmar
        <input
          name="confirmacion"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          className="w-40 rounded-md border border-borde bg-superficie-elevada px-2 py-1 text-[13px] text-texto"
        />
      </label>
      <div className="flex gap-2">
        <Boton variante="peligro" tipo="submit" disabled={!puede}>
          Archivar
        </Boton>
        <Boton variante="fantasma" tipo="button" onClick={() => setAbierto(false)}>
          Cancelar
        </Boton>
      </div>
    </form>
  );
}

'use client';

/**
 * D-075 · Ola 5 — Pantalla 6: REPORTES (/diseno/reportes).
 *
 * Libro diario, mayor, auxiliar, balance de prueba y formatos de exógena.
 *
 * Lo que el encargo exige y D-073 ya decidió: diferenciar SIEMPRE los tres
 * motivos por los que un reporte no sale, con tres mensajes visualmente
 * distintos:
 *   · Falta configuración obligatoria → accionable, con enlace.
 *   · No hay datos para el rango/tercero → neutro, sin alarma.
 *   · Error técnico real → genérico, SIN el detalle crudo.
 */
import { useState } from 'react';
import { Boton, Encabezado, MensajeEstado, Panel, Tabla, Td, Th } from '../../_ui/componentes';

type Reporte = { id: string; nombre: string; resultado: 'ok' | 'configuracion' | 'sin-datos' | 'error' };

const REPORTES: readonly Reporte[] = [
  { id: 'diario', nombre: 'Libro diario', resultado: 'ok' },
  { id: 'mayor', nombre: 'Libro mayor', resultado: 'ok' },
  { id: 'auxiliar', nombre: 'Auxiliar por cuenta', resultado: 'sin-datos' },
  { id: 'balance', nombre: 'Balance de prueba', resultado: 'configuracion' },
  { id: 'exogena-1001', nombre: 'Exógena — Formato 1001 (pagos)', resultado: 'error' },
];

export default function Reportes() {
  const [sel, setSel] = useState<string>('diario');
  const r = REPORTES.find((x) => x.id === sel) ?? REPORTES[0]!;

  return (
    <div className="min-h-0 flex-1 overflow-auto p-5">
      <Encabezado
        titulo="Reportes"
        descripcion="Libros contables y formatos de exógena. Solo lectura sobre el ledger."
      />

      <div className="grid grid-cols-[220px_1fr] gap-4">
        <nav className="flex flex-col gap-1">
          {REPORTES.map((x) => (
            <button
              key={x.id}
              type="button"
              onClick={() => setSel(x.id)}
              className={`rounded-md px-3 py-2 text-left text-[13px] ${
                x.id === sel
                  ? 'bg-primario/10 font-semibold text-primario dark:bg-primario-tinta-oscura/15 dark:text-primario-tinta-oscura'
                  : 'text-texto hover:bg-superficie'
              }`}
            >
              {x.nombre}
            </button>
          ))}
        </nav>

        <div className="flex flex-col gap-4">
          <Panel titulo="Parámetros del reporte">
            <div className="flex flex-wrap items-end gap-3 p-4">
              <label className="flex flex-col gap-1.5 text-[12px] font-medium text-texto">
                Desde
                <input type="date" defaultValue="2026-08-01" className="rounded-md border border-borde bg-superficie-elevada px-3 py-2 text-[13px] tabular-nums" />
              </label>
              <label className="flex flex-col gap-1.5 text-[12px] font-medium text-texto">
                Hasta
                <input type="date" defaultValue="2026-08-31" className="rounded-md border border-borde bg-superficie-elevada px-3 py-2 text-[13px] tabular-nums" />
              </label>
              <label className="flex flex-col gap-1.5 text-[12px] font-medium text-texto">
                Tercero (opcional)
                <input placeholder="Todos" className="rounded-md border border-borde bg-superficie-elevada px-3 py-2 text-[13px]" />
              </label>
              <Boton>Generar</Boton>
              <Boton variante="secundario">Exportar a Excel</Boton>
            </div>
          </Panel>

          {r.resultado === 'ok' && (
            <Panel titulo={`${r.nombre} · agosto 2026`}>
              <Tabla>
                <thead>
                  <tr>
                    <Th>Fecha</Th>
                    <Th>Asiento</Th>
                    <Th>Cuenta</Th>
                    <Th alineado="right">Débito</Th>
                    <Th alineado="right">Crédito</Th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-borde/60">
                    <Td numerico>2026-08-11</Td>
                    <Td numerico>2026-08-0442</Td>
                    <Td>521035 — Transporte, fletes y acarreos</Td>
                    <Td alineado="right" numerico>8.400.000</Td>
                    <Td alineado="right" numerico>—</Td>
                  </tr>
                  <tr className="border-t border-borde/60">
                    <Td numerico>2026-08-11</Td>
                    <Td numerico>2026-08-0442</Td>
                    <Td>236515 — Retención en la fuente — transporte</Td>
                    <Td alineado="right" numerico>—</Td>
                    <Td alineado="right" numerico>84.000</Td>
                  </tr>
                  <tr className="border-t border-borde/60">
                    <Td numerico>2026-08-11</Td>
                    <Td numerico>2026-08-0442</Td>
                    <Td>220501 — Proveedores nacionales</Td>
                    <Td alineado="right" numerico>—</Td>
                    <Td alineado="right" numerico>8.316.000</Td>
                  </tr>
                  <tr className="border-t-2 border-primario font-bold">
                    <Td>Totales</Td>
                    <Td />
                    <Td />
                    <Td alineado="right" numerico>8.400.000</Td>
                    <Td alineado="right" numerico>8.400.000</Td>
                  </tr>
                </tbody>
              </Tabla>
            </Panel>
          )}

          {r.resultado === 'configuracion' && (
            <MensajeEstado
              tipo="configuracion"
              titulo="Falta configuración obligatoria para este reporte"
              accion={{ texto: 'Ir a PUC y mapear la cuenta de resultados', href: '/diseno/parametros/puc' }}
            >
              El balance de prueba necesita el mapeo NIIF de la cuenta <b>413536</b>, que esta empresa marcó como
              propia. Sin ese mapeo no se puede clasificar el saldo.
            </MensajeEstado>
          )}

          {r.resultado === 'sin-datos' && (
            <MensajeEstado tipo="sin-datos" titulo="No hay movimientos para el rango y el tercero solicitados">
              Entre el 1 y el 31 de agosto de 2026 no se registraron asientos que afecten la cuenta auxiliar elegida.
              Prueba con otro rango de fechas o quita el filtro de tercero.
            </MensajeEstado>
          )}

          {r.resultado === 'error' && (
            <MensajeEstado tipo="error" titulo="No se pudo generar el reporte">
              Ocurrió un problema técnico al armar el formato 1001. El equipo ya tiene el registro del incidente.
              Intenta de nuevo en unos minutos; si persiste, escribe a soporte con la fecha y hora.
            </MensajeEstado>
          )}
        </div>
      </div>
    </div>
  );
}

'use client';

/**
 * D-075 · Ola 5 — Pantalla 4: PARÁMETROS TRIBUTARIOS (/diseno/parametros).
 *
 * Tarifas de retefuente, ReteIVA, ReteICA por municipio, UVT, SMMLV y
 * calendario. Cada parámetro con vigencia temporal (Regla de Oro 3), editable
 * desde la interfaz sin tocar código (Regla de Oro 2).
 *
 *  · Panel de alertas «dato pendiente de verificación humana»: badge
 *    FALTA DATO (rojo/error) cuando no hay valor, VERIFICAR (ámbar/pendiente)
 *    cuando hay valor pero sin confirmar contra la norma.
 *  · Edición con historial de vigencias.
 *  · Carga masiva por submódulo.
 */
import { useState } from 'react';
import {
  Badge,
  Boton,
  Encabezado,
  HistorialVigencias,
  MensajeEstado,
  Panel,
  Tabla,
  Td,
  Th,
} from '../../_ui/componentes';
import { CargaMasiva } from '../../_ui/CargaMasiva';

type Submodulo = { id: string; nombre: string };

const SUBMODULOS: readonly Submodulo[] = [
  { id: 'retefuente', nombre: 'Retefuente' },
  { id: 'reteiva', nombre: 'ReteIVA' },
  { id: 'reteica', nombre: 'ReteICA por municipio' },
  { id: 'valores', nombre: 'Valores base (UVT, SMMLV)' },
  { id: 'calendario', nombre: 'Calendario tributario' },
];

type Alerta = { tipo: 'falta' | 'verificar'; parametro: string; detalle: string };

const ALERTAS: readonly Alerta[] = [
  { tipo: 'falta', parametro: 'ReteICA · Cali · todas las actividades', detalle: 'El Acuerdo 0321 de 2011 no trae la tarifa por actividad. Sin dato, el motor manda a revisión manual.' },
  { tipo: 'falta', parametro: 'ReteICA · Bogotá · código de actividad municipal', detalle: 'El código municipal de cinco dígitos del Decreto 352/2002 no encaja en el catálogo CIIU nacional de cuatro dígitos.' },
  { tipo: 'verificar', parametro: 'UVT del año en curso — valor por confirmar', detalle: 'Cargado desde el proyecto de resolución DIAN. Confirmar contra la resolución definitiva publicada.' },
  { tipo: 'verificar', parametro: 'Retefuente · servicios · base mínima en UVT', detalle: 'Revisar si el Decreto de ajuste del año modificó la base mínima de servicios.' },
];

type ParametroFila = { concepto: string; base: string; tarifa: string; desde: string; hasta: string; estado: 'ok' | 'verificar' | 'falta' };

const FILAS: Record<string, readonly ParametroFila[]> = {
  retefuente: [
    { concepto: 'Compras generales', base: 'según UVT', tarifa: '[tarifa]', desde: '2025-01-01', hasta: '—', estado: 'ok' },
    { concepto: 'Servicios generales', base: 'según UVT', tarifa: '[tarifa]', desde: '2025-01-01', hasta: '—', estado: 'verificar' },
    { concepto: 'Honorarios (persona jurídica)', base: 'sin base mínima', tarifa: '[tarifa]', desde: '2023-01-01', hasta: '—', estado: 'ok' },
  ],
  reteiva: [{ concepto: 'ReteIVA general', base: 'IVA facturado', tarifa: '[tarifa]', desde: '2023-02-01', hasta: '—', estado: 'ok' }],
  reteica: [
    { concepto: 'Medellín · comercio al por mayor', base: 'Ingresos gravados', tarifa: '7,00‰', desde: '2024-01-01', hasta: '—', estado: 'ok' },
    { concepto: 'Bogotá · comercio al por menor', base: 'Ingresos gravados', tarifa: '4,14‰', desde: '2024-01-01', hasta: '—', estado: 'ok' },
    { concepto: 'Cali · todas las actividades', base: 'Ingresos gravados', tarifa: '—', desde: '—', hasta: '—', estado: 'falta' },
  ],
  valores: [
    { concepto: 'UVT', base: '—', tarifa: '[UVT vigente]', desde: '2026-01-01', hasta: '—', estado: 'verificar' },
    { concepto: 'SMMLV', base: '—', tarifa: '[SMMLV vigente]', desde: '2026-01-01', hasta: '—', estado: 'ok' },
  ],
  calendario: [
    { concepto: 'Declaración de retención — agosto 2026', base: 'NIT termina en 1-2', tarifa: '—', desde: '2026-09-08', hasta: '2026-09-09', estado: 'ok' },
  ],
};

export default function Parametros() {
  const [sub, setSub] = useState<string>('retefuente');
  const filas = FILAS[sub] ?? [];
  const nombreSub = SUBMODULOS.find((s) => s.id === sub)?.nombre ?? '';

  return (
    <div className="flex h-full min-h-0">
      <nav className="w-56 shrink-0 border-r border-borde bg-superficie-elevada p-2">
        <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-texto-suave">Submódulos</p>
        {SUBMODULOS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSub(s.id)}
            className={`block w-full rounded-md px-2.5 py-2 text-left text-[13px] ${
              s.id === sub ? 'bg-primario/10 font-semibold text-primario dark:bg-primario-tinta-oscura/15 dark:text-primario-tinta-oscura' : 'text-texto hover:bg-superficie'
            }`}
          >
            {s.nombre}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-auto p-5">
        <Encabezado
          titulo={nombreSub}
          descripcion="Todo valor se resuelve por la fecha del hecho económico, no por la fecha de proceso."
          acciones={
            <CargaMasiva
              catalogo={nombreSub}
              descripcion={`Sube tarifas y vigencias de ${nombreSub}. Cada fila lleva su vigencia (desde/hasta) y su norma de respaldo.`}
              erroresDeMuestra={[
                { fila: 3, campo: 'tarifa', motivo: 'Formato de tarifa inválido; revisa el separador decimal' },
                { fila: 9, campo: 'vigencia_desde', motivo: 'Fecha posterior a vigencia_hasta' },
              ]}
            />
          }
        />

        {/* alertas */}
        <div className="mb-4 flex flex-col gap-2">
          {ALERTAS.map((a, i) => (
            <div
              key={i}
              className={`flex items-start gap-3 rounded-lg border p-3 ${
                a.tipo === 'falta' ? 'border-error/40 bg-error/8' : 'border-pendiente/40 bg-pendiente/8'
              }`}
            >
              <span className="mt-[2px] shrink-0">
                {a.tipo === 'falta' ? <Badge tono="error">FALTA DATO</Badge> : <Badge tono="pendiente">VERIFICAR</Badge>}
              </span>
              <div className="text-[12.5px]">
                <p className="font-semibold text-texto">{a.parametro}</p>
                <p className="mt-[2px] text-texto-suave">{a.detalle}</p>
              </div>
            </div>
          ))}
        </div>

        <Panel titulo={`Tarifas y vigencias — ${nombreSub}`}>
          {filas.length === 0 ? (
            <div className="p-4">
              <MensajeEstado tipo="sin-datos" titulo="Este submódulo no tiene filas cargadas todavía." />
            </div>
          ) : (
            <Tabla>
              <thead>
                <tr>
                  <Th>Concepto</Th>
                  <Th>Base</Th>
                  <Th alineado="right">Tarifa / valor</Th>
                  <Th>Vigente desde</Th>
                  <Th>Hasta</Th>
                  <Th>Estado</Th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f, i) => (
                  <tr key={i} className="border-t border-borde/60">
                    <Td>{f.concepto}</Td>
                    <Td>{f.base}</Td>
                    <Td alineado="right" numerico>{f.tarifa}</Td>
                    <Td numerico>{f.desde}</Td>
                    <Td numerico>{f.hasta}</Td>
                    <Td>
                      {f.estado === 'ok' && <Badge tono="exito">confirmado</Badge>}
                      {f.estado === 'verificar' && <Badge tono="pendiente">VERIFICAR</Badge>}
                      {f.estado === 'falta' && <Badge tono="error">FALTA DATO</Badge>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Tabla>
          )}
        </Panel>

        <div className="mt-4 grid grid-cols-2 gap-4">
          <Panel titulo="Editar — Servicios generales" descripcion="Editar inserta una vigencia nueva; jamás hace UPDATE.">
            <div className="flex flex-col gap-3 p-4">
              <label className="flex flex-col gap-1.5 text-[12px] font-medium text-texto">
                Tarifa
                <input placeholder="Tarifa vigente" className="rounded-md border border-borde bg-superficie-elevada px-3 py-2 text-[13px] tabular-nums" />
              </label>
              <label className="flex flex-col gap-1.5 text-[12px] font-medium text-texto">
                Vigente desde
                <input type="date" defaultValue="2026-01-01" className="rounded-md border border-borde bg-superficie-elevada px-3 py-2 text-[13px] tabular-nums" />
              </label>
              <label className="flex flex-col gap-1.5 text-[12px] font-medium text-texto">
                Norma de respaldo
                <input defaultValue="Art. 392 ET" className="rounded-md border border-borde bg-superficie-elevada px-3 py-2 text-[13px]" />
              </label>
              <div className="flex justify-end">
                <Boton>Guardar como nueva vigencia</Boton>
              </div>
            </div>
          </Panel>
          <div className="p-1">
            <HistorialVigencias
              titulo="Historial — Retefuente servicios generales"
              filas={[
                { valor: 'tarifa anterior', desde: '2020-01-01', hasta: '2022-12-31', norma: 'Art. 392 ET' },
                { valor: 'tarifa vigente', desde: '2023-01-01', hasta: null, norma: 'Art. 392 ET' },
              ]}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

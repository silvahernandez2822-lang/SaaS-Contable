'use client';

/**
 * D-075 · Ola 5 — Pantalla 7c: ADMINISTRACIÓN · CORRECCIONES
 * (/diseno/admin/correcciones).
 *
 * Bandeja de correcciones pendientes de aprobación. MISMO patrón visual de cola
 * de trabajo que la Bandeja de causación (lista con estado + detalle a la
 * derecha), con badge «Pendiente de revisión». Regla de Oro 1: un asiento
 * publicado no se toca — se corrige por reversa, y esa reversa la aprueba otra
 * persona.
 */
import { useState } from 'react';
import { Boton, EtiquetaEstado, Panel, PuntoEstado, Tabla, Td, Th } from '../../../_ui/componentes';

type Correccion = {
  id: string;
  asiento: string;
  tercero: string;
  solicitante: string;
  fecha: string;
  motivo: string;
  original: string;
  propuesto: string;
  lineas: { cuenta: string; nombre: string; antes: string; despues: string }[];
};

const CORRECCIONES: readonly Correccion[] = [
  {
    id: 'c1',
    asiento: '2026-08-0442',
    tercero: 'Transportes del Llano Ltda.',
    solicitante: 'Carlos Peña',
    fecha: '13 ago 2026',
    motivo: 'La retención se causó como compra general cuando el servicio es transporte de carga, que tiene su propia tarifa.',
    original: 'Retefuente de compras — $210.000',
    propuesto: 'Retefuente de transporte de carga — $84.000',
    lineas: [
      { cuenta: '2365', nombre: 'Retención en la fuente — compras', antes: '210.000', despues: '—' },
      { cuenta: '2365', nombre: 'Retención en la fuente — transporte', antes: '—', despues: '84.000' },
      { cuenta: '2205', nombre: 'Proveedores nacionales', antes: '8.190.000', despues: '8.316.000' },
    ],
  },
  {
    id: 'c2',
    asiento: '2026-08-0501',
    tercero: 'Aseo y Cafetería Integral',
    solicitante: 'Mariana Rueda',
    fecha: '14 ago 2026',
    motivo: 'Falta la autorretención de renta: el tercero pasó a autorretenedor el 01/08/2026.',
    original: 'Sin autorretención',
    propuesto: 'Autorretención de renta — $11.275',
    lineas: [
      { cuenta: '2365', nombre: 'Autorretención de renta', antes: '—', despues: '11.275' },
      { cuenta: '1355', nombre: 'Anticipo de impuestos', antes: '—', despues: '11.275' },
    ],
  },
];

export default function Correcciones() {
  const [sel, setSel] = useState<string>('c1');
  const c = CORRECCIONES.find((x) => x.id === sel) ?? CORRECCIONES[0]!;

  return (
    <div className="flex h-full min-h-0">
      <section className="flex w-[400px] shrink-0 flex-col border-r border-borde bg-superficie-elevada">
        <div className="border-b border-borde px-4 py-3 text-[12px] text-texto-suave">
          {CORRECCIONES.length} correcciones esperan una segunda aprobación
        </div>
        <ul className="min-h-0 flex-1 overflow-auto">
          {CORRECCIONES.map((x) => (
            <li key={x.id}>
              <button
                type="button"
                onClick={() => setSel(x.id)}
                className={`w-full border-b border-borde/60 px-4 py-3 text-left ${
                  x.id === c.id ? 'bg-primario/5' : 'hover:bg-superficie'
                }`}
                style={{ borderLeft: `3px solid ${x.id === c.id ? 'var(--color-pendiente)' : 'transparent'}` }}
              >
                <div className="flex items-center gap-1.5">
                  <PuntoEstado estado="revision" />
                  <span className="text-[13px] font-semibold text-texto">Asiento {x.asiento}</span>
                </div>
                <div className="mt-[2px] text-[12px] text-texto-suave">{x.tercero}</div>
                <div className="mt-1.5">
                  <EtiquetaEstado estado="revision">Pendiente de revisión</EtiquetaEstado>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-4 border-b border-borde bg-superficie-elevada px-5 py-3.5">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-[16px] font-bold text-texto">Corrección al asiento {c.asiento}</h1>
              <EtiquetaEstado estado="revision">Pendiente de revisión</EtiquetaEstado>
            </div>
            <p className="mt-1 text-[12px] text-texto-suave">
              {c.tercero} · solicitada por {c.solicitante} · {c.fecha}
            </p>
          </div>
          <div className="flex gap-2">
            <Boton variante="peligro">Devolver</Boton>
            <Boton>Aprobar reversa + reasiento</Boton>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-5">
          <div className="flex flex-col gap-4">
            <Panel titulo="Motivo de la corrección">
              <p className="p-4 text-[13px] text-texto">{c.motivo}</p>
            </Panel>

            <Panel titulo="Qué cambia" descripcion="El asiento original no se edita: se reversa y se vuelve a asentar.">
              <div className="grid grid-cols-2 gap-4 p-4 text-[13px]">
                <div className="rounded-md border border-borde bg-superficie p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-texto-suave">Antes</p>
                  <p className="mt-1 text-texto">{c.original}</p>
                </div>
                <div className="rounded-md border border-exito/40 bg-exito/8 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-exito-tinta">Después</p>
                  <p className="mt-1 text-texto">{c.propuesto}</p>
                </div>
              </div>
              <div className="border-t border-borde">
                <Tabla>
                  <thead>
                    <tr>
                      <Th>Cuenta</Th>
                      <Th>Nombre</Th>
                      <Th alineado="right">Antes</Th>
                      <Th alineado="right">Después</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.lineas.map((l, i) => (
                      <tr key={i} className="border-t border-borde/60">
                        <Td numerico>{l.cuenta}</Td>
                        <Td>{l.nombre}</Td>
                        <Td alineado="right" numerico className="text-texto-suave">{l.antes}</Td>
                        <Td alineado="right" numerico className="font-semibold">{l.despues}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Tabla>
              </div>
            </Panel>
          </div>
        </div>
      </section>
    </div>
  );
}

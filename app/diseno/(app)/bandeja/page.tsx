'use client';

/**
 * D-075 · Ola 5 — Pantalla 2: BANDEJA DE CAUSACIÓN (/diseno/bandeja).
 *
 * Cola de trabajo tipo inbox, NO dashboard. Dirección A: maestro-detalle
 * SIEMPRE visible — lista a la izquierda, asiento propuesto a la derecha.
 *
 *  · Lista con estado visual (pendiente / aprobado / rechazado).
 *  · Detalle con el asiento propuesto, editable antes de aprobar.
 *  · Trazabilidad: por qué el motor aplicó (o no) cada retención — base,
 *    tarifa, regla, vigencia y norma. Regla de Oro 6.
 *
 * Datos de maqueta en el archivo; la versión real los toma de
 * `src/services/consulta.ts`.
 */
import { useMemo, useState } from 'react';
import {
  Boton,
  EtiquetaEstado,
  MensajeEstado,
  Panel,
  PuntoEstado,
  Tabla,
  Td,
  Th,
  type Estado,
} from '../../_ui/componentes';
import { IconoBuscar, IconoInfo } from '../../_ui/iconos';
import { useDensidad } from '../../_ui/contextos';

type Retencion = {
  tipo: string;
  base: number | null;
  tarifa: string | null;
  regla: string;
  norma: string;
  aplico: boolean;
  advertencia?: string;
};

type Linea = { cuenta: string; nombre: string; debito: number; credito: number; alerta?: string };

type Documento = {
  id: string;
  tercero: string;
  nit: string;
  factura: string;
  cufe: string;
  fecha: string;
  hecho: string;
  total: number;
  retencion: number;
  estado: Estado;
  motivo?: string;
  detalle: string;
  lineas: Linea[];
  retenciones: Retencion[];
};

const DOCS: readonly Documento[] = [
  {
    id: 'd1',
    tercero: 'Ferretería El Tornillo Ltda.',
    nit: '830.114.902',
    factura: 'FE-4471',
    cufe: '8a3f…c19d',
    fecha: '12 ago 2026',
    hecho: '12 ago 2026',
    total: 4_760_000,
    retencion: 233_240,
    estado: 'pendiente',
    motivo: 'ReteICA sin municipio de la operación',
    detalle: 'Compra de inventario. El motor usó el municipio del tercero (Bogotá), no el del documento.',
    lineas: [
      { cuenta: '143501', nombre: 'Inventario — mercancía no fabricada', debito: 4_000_000, credito: 0 },
      { cuenta: '240802', nombre: 'IVA descontable', debito: 760_000, credito: 0 },
      { cuenta: '2365', nombre: 'Retención en la fuente — compras', debito: 0, credito: 100_000 },
      { cuenta: '2368', nombre: 'ReteIVA sobre el IVA', debito: 0, credito: 114_000 },
      { cuenta: '2368', nombre: 'ReteICA — Bogotá', debito: 0, credito: 19_240, alerta: 'municipio sin confirmar' },
      { cuenta: '220501', nombre: 'Proveedores nacionales', debito: 0, credito: 4_526_760 },
    ],
    retenciones: [
      { tipo: 'Retefuente compras', base: 4_000_000, tarifa: '[tarifa]', regla: 'rule#241 · desde 2025-01-01', norma: 'Art. 401 ET · Dec. 1625/2016', aplico: true },
      { tipo: 'ReteIVA', base: 760_000, tarifa: '[tarifa]', regla: 'rule#88 · desde 2023-02-01', norma: 'Art. 437-1 ET', aplico: true },
      { tipo: 'ReteICA', base: 4_000_000, tarifa: '4,81‰', regla: 'municipio tomado del tercero', norma: 'Acuerdo 65/2002 Bogotá', aplico: true, advertencia: 'Confirmar el municipio de la operación antes de aprobar.' },
      { tipo: 'Autorretención', base: null, tarifa: null, regla: '—', norma: 'El tercero no es autorretenedor en la vigencia del hecho económico', aplico: false },
    ],
  },
  {
    id: 'd2',
    tercero: 'Suministros Río Verde S.A.S.',
    nit: '901.556.740',
    factura: 'SETP-9920',
    cufe: '1c07…b4aa',
    fecha: '12 ago 2026',
    hecho: '12 ago 2026',
    total: 1_190_000,
    retencion: 47_600,
    estado: 'pendiente',
    detalle: 'Compra de suministros de oficina. Sin observaciones del motor.',
    lineas: [
      { cuenta: '519995', nombre: 'Elementos de aseo y cafetería', debito: 1_000_000, credito: 0 },
      { cuenta: '240802', nombre: 'IVA descontable', debito: 190_000, credito: 0 },
      { cuenta: '2365', nombre: 'Retención en la fuente — compras', debito: 0, credito: 25_000 },
      { cuenta: '2368', nombre: 'ReteIVA sobre el IVA', debito: 0, credito: 28_500 },
      { cuenta: '220501', nombre: 'Proveedores nacionales', debito: 0, credito: 1_136_500 },
    ],
    retenciones: [
      { tipo: 'Retefuente compras', base: 1_000_000, tarifa: '[tarifa]', regla: 'rule#241 · desde 2025-01-01', norma: 'Art. 401 ET', aplico: true },
      { tipo: 'ReteIVA', base: 190_000, tarifa: '[tarifa]', regla: 'rule#88 · desde 2023-02-01', norma: 'Art. 437-1 ET', aplico: true },
      { tipo: 'ReteICA', base: 1_000_000, tarifa: null, regla: '—', norma: 'El tercero no tiene actividad ICA en el municipio de la operación', aplico: false },
    ],
  },
  {
    id: 'd3',
    tercero: 'Transportes del Llano Ltda.',
    nit: '830.007.201',
    factura: 'TDL-1180',
    cufe: 'ff20…9e31',
    fecha: '11 ago 2026',
    hecho: '11 ago 2026',
    total: 8_400_000,
    retencion: 84_000,
    estado: 'aprobado',
    detalle: 'Servicio de transporte de carga. Aprobado por M. Rueda · asiento 2026-08-0442.',
    lineas: [
      { cuenta: '521035', nombre: 'Transporte, fletes y acarreos', debito: 8_400_000, credito: 0 },
      { cuenta: '2365', nombre: 'Retención en la fuente — transporte de carga', debito: 0, credito: 84_000 },
      { cuenta: '220501', nombre: 'Proveedores nacionales', debito: 0, credito: 8_316_000 },
    ],
    retenciones: [
      { tipo: 'Retefuente transporte de carga', base: 8_400_000, tarifa: '[tarifa]', regla: 'rule#252 · desde 2024-01-01', norma: 'Art. 5 Dec. 1189/1988', aplico: true },
    ],
  },
  {
    id: 'd4',
    tercero: 'Papelería Central',
    nit: '43.118.640',
    factura: 'PC-0031',
    cufe: '77b9…0c4e',
    fecha: '10 ago 2026',
    hecho: '10 ago 2026',
    total: 320_000,
    retencion: 0,
    estado: 'rechazado',
    motivo: 'Factura duplicada (CUFE ya causado)',
    detalle: 'El CUFE ya está causado en el asiento 2026-07-1180. No se genera asiento nuevo.',
    lineas: [],
    retenciones: [],
  },
];

const FILTROS: ReadonlyArray<{ id: Estado | 'todos'; texto: string }> = [
  { id: 'pendiente', texto: 'Pendientes' },
  { id: 'aprobado', texto: 'Aprobados' },
  { id: 'rechazado', texto: 'Rechazados' },
  { id: 'todos', texto: 'Todos' },
];

const pesos = (n: number) => `$${n.toLocaleString('es-CO')}`;

export default function Bandeja() {
  const { densidad } = useDensidad();
  const [filtro, setFiltro] = useState<Estado | 'todos'>('pendiente');
  const [seleccion, setSeleccion] = useState<string>('d1');
  const [editando, setEditando] = useState(false);

  const visibles = useMemo(
    () => DOCS.filter((d) => filtro === 'todos' || d.estado === filtro),
    [filtro],
  );
  const doc = DOCS.find((d) => d.id === seleccion) ?? DOCS[0]!;
  const filaPad = densidad === 'comodo' ? 'py-3' : 'py-2';

  const sumaDebito = doc.lineas.reduce((s, l) => s + l.debito, 0);
  const sumaCredito = doc.lineas.reduce((s, l) => s + l.credito, 0);

  return (
    <div className="flex h-full min-h-0">
      {/* ------------------------ LISTA ------------------------ */}
      <section className="flex w-[430px] shrink-0 flex-col border-r border-borde bg-superficie-elevada">
        <div className="flex items-center gap-2 border-b border-borde px-3.5 py-2.5">
          <div className="flex flex-1 items-center gap-2 rounded-md border border-borde px-2.5 py-1.5">
            <IconoBuscar width={14} height={14} className="text-texto-suave" />
            <input
              className="w-full bg-transparent text-[12px] text-texto placeholder:text-texto-suave/70 focus:outline-none"
              placeholder="Buscar por proveedor, NIT o CUFE"
            />
          </div>
        </div>
        <div className="flex gap-1.5 border-b border-borde px-3.5 py-2 text-[12px]">
          {FILTROS.map((f) => {
            const n = f.id === 'todos' ? DOCS.length : DOCS.filter((d) => d.estado === f.id).length;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setFiltro(f.id)}
                className={`rounded-full px-2.5 py-[2px] ${
                  filtro === f.id ? 'bg-primario text-primario-contraste' : 'bg-superficie text-texto-suave hover:text-texto'
                }`}
              >
                {f.texto} {n}
              </button>
            );
          })}
        </div>

        <ul className="min-h-0 flex-1 overflow-auto">
          {visibles.map((d) => {
            const activo = d.id === doc.id;
            return (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSeleccion(d.id);
                    setEditando(false);
                  }}
                  className={`flex w-full gap-2.5 border-b border-borde/60 px-3.5 text-left ${filaPad} ${
                    activo ? 'bg-primario/5' : 'hover:bg-superficie'
                  }`}
                  style={{ borderLeft: `3px solid ${activo ? 'var(--color-pendiente)' : 'transparent'}` }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <PuntoEstado estado={d.estado} />
                      <span className="truncate text-[13px] font-semibold text-texto">{d.tercero}</span>
                    </div>
                    <div className="mt-[2px] text-[12px] tabular-nums text-texto-suave">
                      {d.factura} · NIT {d.nit} · {d.fecha}
                    </div>
                    {d.motivo ? (
                      <div className="mt-1 inline-block rounded bg-pendiente/12 px-1.5 py-[2px] text-[11px] text-pendiente">
                        Revisar: {d.motivo}
                      </div>
                    ) : (
                      <div className="mt-1 text-[11px] text-texto-suave">{d.retenciones.filter((r) => r.aplico).map((r) => r.tipo).join(' · ') || '—'}</div>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[13px] font-semibold tabular-nums text-texto">{pesos(d.total)}</div>
                    {d.retencion > 0 && (
                      <div className="mt-[2px] text-[11px] tabular-nums text-texto-suave">ret. {pesos(d.retencion)}</div>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
          {visibles.length === 0 && (
            <li className="p-4">
              <MensajeEstado tipo="sin-datos" titulo="No hay documentos en este estado">
                Cambia de filtro o espera a que lleguen nuevas facturas por correo.
              </MensajeEstado>
            </li>
          )}
        </ul>

        <div className="border-t border-borde px-3.5 py-2.5">
          <Boton className="w-full" disabled>
            Aprobar seleccionados (0)
          </Boton>
        </div>
      </section>

      {/* ------------------------ DETALLE ------------------------ */}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start gap-4 border-b border-borde bg-superficie-elevada px-5 py-3.5">
          <div className="flex-1">
            <div className="flex items-center gap-2.5">
              <h1 className="text-[16px] font-bold text-texto">{doc.tercero}</h1>
              <EtiquetaEstado estado={doc.estado} />
            </div>
            <p className="mt-1 text-[12px] tabular-nums text-texto-suave">
              Factura {doc.factura} · CUFE {doc.cufe} · recibida {doc.fecha} · hecho económico {doc.hecho}
            </p>
          </div>
          {doc.estado === 'pendiente' && (
            <div className="flex gap-2">
              <Boton variante="peligro">Rechazar</Boton>
              <Boton variante="secundario" onClick={() => setEditando((v) => !v)}>
                {editando ? 'Dejar de editar' : 'Corregir'}
              </Boton>
              <Boton>Aprobar asiento</Boton>
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-5">
          {doc.lineas.length === 0 ? (
            <MensajeEstado
              tipo="sin-datos"
              titulo="Este documento no genera asiento"
            >
              {doc.detalle}
            </MensajeEstado>
          ) : (
            <div className="flex flex-col gap-4">
              {doc.motivo && (
                <MensajeEstado tipo="configuracion" titulo={`Antes de aprobar: ${doc.motivo}`} accion={{ texto: 'Ir a corregir el municipio de la operación', href: '#' }}>
                  {doc.detalle}
                </MensajeEstado>
              )}

              <Panel
                titulo="Asiento contable propuesto por el motor"
                descripcion={editando ? 'Modo edición: los montos son editables. Débitos deben igualar créditos.' : 'Editable antes de aprobar · débitos = créditos'}
              >
                <Tabla>
                  <thead>
                    <tr>
                      <Th>Cuenta PUC</Th>
                      <Th>Descripción</Th>
                      <Th alineado="right">Débito</Th>
                      <Th alineado="right">Crédito</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {doc.lineas.map((l, i) => (
                      <tr key={i} className="border-t border-borde/60">
                        <Td numerico>{l.cuenta}</Td>
                        <Td>
                          {l.nombre}
                          {l.alerta && <span className="text-error-tinta"> ({l.alerta})</span>}
                        </Td>
                        <Td alineado="right" numerico>
                          {l.debito > 0
                            ? editando
                              ? <input defaultValue={l.debito} className="w-28 rounded border border-borde bg-superficie-elevada px-1.5 py-[2px] text-right tabular-nums" />
                              : l.debito.toLocaleString('es-CO')
                            : <span className="text-borde">—</span>}
                        </Td>
                        <Td alineado="right" numerico>
                          {l.credito > 0
                            ? editando
                              ? <input defaultValue={l.credito} className="w-28 rounded border border-borde bg-superficie-elevada px-1.5 py-[2px] text-right tabular-nums" />
                              : l.credito.toLocaleString('es-CO')
                            : <span className="text-borde">—</span>}
                        </Td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-primario font-bold">
                      <Td>Sumas iguales</Td>
                      <Td />
                      <Td alineado="right" numerico>{sumaDebito.toLocaleString('es-CO')}</Td>
                      <Td alineado="right" numerico>{sumaCredito.toLocaleString('es-CO')}</Td>
                    </tr>
                  </tbody>
                </Tabla>
              </Panel>

              <Panel
                titulo={
                  <span className="flex items-center gap-2">
                    <IconoInfo width={15} height={15} className="text-primario dark:text-primario-tinta-oscura" />
                    Por qué el motor aplicó cada retención
                  </span>
                }
              >
                <Tabla>
                  <thead>
                    <tr>
                      <Th>Retención</Th>
                      <Th>Base</Th>
                      <Th>Tarifa</Th>
                      <Th>Regla / vigencia</Th>
                      <Th>Norma</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {doc.retenciones.map((r, i) => (
                      <tr key={i} className={`border-t border-borde/60 ${r.advertencia ? 'bg-pendiente/8' : ''}`}>
                        <Td>{r.tipo}</Td>
                        <Td numerico>{r.base !== null ? pesos(r.base) : <span className="text-texto-suave">—</span>}</Td>
                        <Td numerico>{r.tarifa ?? <span className="text-texto-suave">—</span>}</Td>
                        <Td className={r.aplico ? '' : 'text-texto-suave'}>{r.regla}</Td>
                        <Td className={r.aplico ? '' : 'text-texto-suave'}>
                          {r.aplico ? r.norma : `No aplicó: ${r.norma}`}
                          {r.advertencia && <span className="block text-pendiente-tinta">{r.advertencia}</span>}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Tabla>
              </Panel>

              <p className="text-[11px] text-texto-suave">
                Trazabilidad completa (Regla de Oro 6): documento de origen, regla y vigencia aplicada, propuesta de la
                IA con su score, quién aprueba y desde dónde — todo queda en el asiento.
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

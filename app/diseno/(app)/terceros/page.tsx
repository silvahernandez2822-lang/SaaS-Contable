'use client';

/**
 * D-075 · Ola 5 — Pantalla 3: TERCEROS (/diseno/terceros).
 *
 * Maestro de proveedores/clientes. Dirección A: lista a la izquierda, ficha a
 * la derecha.
 *
 *  · Atributos fiscales (gran contribuyente, autorretenedor, régimen simple)
 *    con VIGENCIA temporal: nunca se sobreescriben — cada edición cierra la
 *    vigencia anterior y abre una nueva (Regla de Oro 3). El historial está a
 *    la vista, no escondido.
 *  · Actividad económica ligada a un municipio para ReteICA: el selector de
 *    actividad DEPENDE del municipio (cascada). Si el municipio no tiene
 *    ninguna actividad con tarifa cargada, se dice explícitamente — nunca una
 *    lista vacía sin explicación ni actividades de otro municipio.
 */
import { useMemo, useState } from 'react';
import {
  Badge,
  Boton,
  Campo,
  Encabezado,
  Entrada,
  HistorialVigencias,
  Panel,
  Selector,
  Tabla,
  Td,
  Th,
} from '../../_ui/componentes';
import { CargaMasiva } from '../../_ui/CargaMasiva';
import { IconoBuscar } from '../../_ui/iconos';
import { useDensidad } from '../../_ui/contextos';

type Tercero = {
  id: string;
  nombre: string;
  nit: string;
  tipo: 'Proveedor' | 'Cliente' | 'Ambos';
  municipio: string;
  granContribuyente: boolean;
  autorretenedor: boolean;
  regimenSimple: boolean;
};

const TERCEROS: readonly Tercero[] = [
  { id: 't1', nombre: 'Ferretería El Tornillo Ltda.', nit: '830.114.902-1', tipo: 'Proveedor', municipio: 'Bogotá D.C.', granContribuyente: false, autorretenedor: false, regimenSimple: false },
  { id: 't2', nombre: 'Suministros Río Verde S.A.S.', nit: '901.556.740-4', tipo: 'Proveedor', municipio: 'Medellín', granContribuyente: false, autorretenedor: true, regimenSimple: false },
  { id: 't3', nombre: 'Transportes del Llano Ltda.', nit: '830.007.201-9', tipo: 'Ambos', municipio: 'Villavicencio', granContribuyente: true, autorretenedor: true, regimenSimple: false },
  { id: 't4', nombre: 'Aseo y Cafetería Integral', nit: '900.223.881-2', tipo: 'Proveedor', municipio: 'Cali', granContribuyente: false, autorretenedor: false, regimenSimple: true },
];

/** Actividades ICA por municipio. Villavicencio y Cali sin tarifas cargadas
 *  (espeja V-5 de ESTADO_PROYECTO: Bogotá y Cali son huecos de datos reales). */
const ACTIVIDADES_ICA: Record<string, ReadonlyArray<{ codigo: string; nombre: string; tarifa: string }>> = {
  'Bogotá D.C.': [
    { codigo: '4664', nombre: 'Comercio al por mayor de materiales de construcción', tarifa: '11,04‰' },
    { codigo: '4711', nombre: 'Comercio al por menor en establecimientos no especializados', tarifa: '4,14‰' },
  ],
  Medellín: [
    { codigo: '4664', nombre: 'Comercio al por mayor de materiales de construcción', tarifa: '7,00‰' },
    { codigo: '5229', nombre: 'Actividades de apoyo al transporte', tarifa: '2,00‰' },
  ],
  Villavicencio: [],
  Cali: [],
};

export default function Terceros() {
  const { densidad } = useDensidad();
  const [seleccion, setSeleccion] = useState<string>('t1');
  const [busqueda, setBusqueda] = useState('');
  const [municipioForm, setMunicipioForm] = useState('Bogotá D.C.');
  const [actividadForm, setActividadForm] = useState('');

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return TERCEROS;
    return TERCEROS.filter((t) => t.nombre.toLowerCase().includes(q) || t.nit.replace(/\./g, '').includes(q.replace(/\./g, '')));
  }, [busqueda]);

  const t = TERCEROS.find((x) => x.id === seleccion) ?? TERCEROS[0]!;
  const actividades = ACTIVIDADES_ICA[municipioForm] ?? [];
  const filaPad = densidad === 'comodo' ? 'py-2.5' : 'py-1.5';

  return (
    <div className="flex h-full min-h-0">
      {/* lista */}
      <section className="flex w-[360px] shrink-0 flex-col border-r border-borde bg-superficie-elevada">
        <div className="flex flex-col gap-2 border-b border-borde p-3.5">
          <div className="flex items-center gap-2 rounded-md border border-borde px-2.5 py-1.5">
            <IconoBuscar width={14} height={14} className="text-texto-suave" />
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              className="w-full bg-transparent text-[12px] text-texto placeholder:text-texto-suave/70 focus:outline-none"
              placeholder="Buscar por nombre o NIT"
            />
          </div>
          <div className="flex gap-2">
            <CargaMasiva
              catalogo="Terceros"
              descripcion="Sube proveedores y clientes con sus atributos fiscales y su actividad ICA por municipio."
              erroresDeMuestra={[
                { fila: 7, campo: 'nit', motivo: 'Dígito de verificación no coincide con el NIT' },
                { fila: 12, campo: 'municipio_ica', motivo: 'El municipio "Soacha" no existe en el catálogo de municipios' },
                { fila: 28, campo: 'regimen_simple', motivo: 'Valor "sí/no" esperado; llegó "1"' },
              ]}
            />
            <Boton>+ Nuevo tercero</Boton>
          </div>
        </div>
        <ul className="min-h-0 flex-1 overflow-auto">
          {filtrados.map((x) => (
            <li key={x.id}>
              <button
                type="button"
                onClick={() => setSeleccion(x.id)}
                className={`w-full border-b border-borde/60 px-3.5 text-left ${filaPad} ${
                  x.id === t.id ? 'bg-primario/5' : 'hover:bg-superficie'
                }`}
              >
                <div className="text-[13px] font-semibold text-texto">{x.nombre}</div>
                <div className="mt-[2px] flex items-center gap-1.5 text-[11px] tabular-nums text-texto-suave">
                  {x.nit}
                  <span className="text-borde">·</span>
                  {x.tipo}
                </div>
              </button>
            </li>
          ))}
          {filtrados.length === 0 && (
            <li className="px-3.5 py-4 text-[12px] text-texto-suave">Ningún tercero coincide con «{busqueda}».</li>
          )}
        </ul>
      </section>

      {/* ficha / formulario */}
      <section className="min-h-0 flex-1 overflow-auto p-5">
        <Encabezado
          titulo={t.nombre}
          descripcion={`NIT ${t.nit} · ${t.municipio}`}
          acciones={<Boton variante="secundario">Guardar cambios</Boton>}
        />

        <div className="flex flex-col gap-4">
          <Panel titulo="Datos básicos">
            <div className="grid grid-cols-2 gap-4 p-4">
              <Campo etiqueta="Razón social" requerido>
                <Entrada defaultValue={t.nombre} />
              </Campo>
              <Campo etiqueta="NIT" requerido>
                <Entrada defaultValue={t.nit} className="tabular-nums" />
              </Campo>
              <Campo etiqueta="Tipo">
                <Selector defaultValue={t.tipo}>
                  <option>Proveedor</option>
                  <option>Cliente</option>
                  <option>Ambos</option>
                </Selector>
              </Campo>
              <Campo etiqueta="Municipio (domicilio)">
                <Selector defaultValue={t.municipio}>
                  {Object.keys(ACTIVIDADES_ICA).map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </Selector>
              </Campo>
            </div>
          </Panel>

          <Panel
            titulo="Atributos fiscales"
            descripcion="Cada cambio cierra la vigencia anterior y abre una nueva. No se sobreescribe."
          >
            <div className="grid grid-cols-3 gap-4 p-4">
              <div className="flex flex-col gap-1.5">
                <span className="text-[12px] font-medium text-texto">Gran contribuyente</span>
                <Badge tono={t.granContribuyente ? 'primario' : 'neutro'}>{t.granContribuyente ? 'Sí — desde 2024-01-01' : 'No'}</Badge>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-[12px] font-medium text-texto">Autorretenedor de renta</span>
                <Badge tono={t.autorretenedor ? 'primario' : 'neutro'}>{t.autorretenedor ? 'Sí — desde 2023-07-01' : 'No'}</Badge>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-[12px] font-medium text-texto">Régimen simple (RST)</span>
                <Badge tono={t.regimenSimple ? 'primario' : 'neutro'}>{t.regimenSimple ? 'Sí — desde 2025-01-01' : 'No'}</Badge>
              </div>
            </div>
            <div className="border-t border-borde p-4">
              <HistorialVigencias
                titulo="Historial de vigencias — autorretenedor de renta"
                filas={
                  t.autorretenedor
                    ? [
                        { valor: 'No', desde: '2021-01-01', hasta: '2023-06-30' },
                        { valor: 'Sí', desde: '2023-07-01', hasta: null, norma: 'Res. DIAN 000124/2023' },
                      ]
                    : [{ valor: 'No', desde: '2021-01-01', hasta: null }]
                }
              />
            </div>
          </Panel>

          <Panel
            titulo="Actividad económica para ReteICA"
            descripcion="El selector de actividad depende del municipio elegido (cascada)."
          >
            <div className="grid grid-cols-2 gap-4 p-4">
              <Campo etiqueta="Municipio de la actividad" requerido>
                <Selector
                  value={municipioForm}
                  onChange={(e) => {
                    setMunicipioForm(e.target.value);
                    setActividadForm('');
                  }}
                >
                  {Object.keys(ACTIVIDADES_ICA).map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </Selector>
              </Campo>
              <Campo etiqueta="Actividad (código CIIU · tarifa)" requerido>
                {actividades.length > 0 ? (
                  <Selector value={actividadForm} onChange={(e) => setActividadForm(e.target.value)}>
                    <option value="">Elige una actividad…</option>
                    {actividades.map((a) => (
                      <option key={a.codigo} value={a.codigo}>
                        {a.codigo} — {a.nombre} ({a.tarifa})
                      </option>
                    ))}
                  </Selector>
                ) : (
                  <div className="rounded-md border border-pendiente/40 bg-pendiente/8 px-3 py-2 text-[12px] text-texto">
                    <span className="font-semibold text-pendiente-tinta">{municipioForm} no tiene actividades ICA con tarifa cargada.</span>{' '}
                    No se puede asignar una actividad hasta que Parámetros cargue las tarifas de este municipio. No se
                    muestran actividades de otro municipio.
                  </div>
                )}
              </Campo>
            </div>
            {actividades.length > 0 && (
              <div className="border-t border-borde p-4">
                <Tabla>
                  <thead>
                    <tr>
                      <Th>Código</Th>
                      <Th>Actividad</Th>
                      <Th alineado="right">Tarifa ICA</Th>
                      <Th>Vigencia</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {actividades.map((a) => (
                      <tr key={a.codigo} className="border-t border-borde/60">
                        <Td numerico>{a.codigo}</Td>
                        <Td>{a.nombre}</Td>
                        <Td alineado="right" numerico>{a.tarifa}</Td>
                        <Td>desde 2024-01-01</Td>
                      </tr>
                    ))}
                  </tbody>
                </Tabla>
              </div>
            )}
          </Panel>
        </div>
      </section>
    </div>
  );
}

'use client';

/**
 * D-075 · Ola 5 — Pantalla 5: PUC / PLAN DE CUENTAS (/diseno/parametros/puc).
 *
 * PUC genérico global (Decreto 2650/1993) + PUC personalizado por empresa: el
 * propio sobreescribe cuenta por cuenta y COMPLEMENTA, no reemplaza el catálogo
 * entero.
 *
 *  · Interruptor «usar solo mi PUC» por empresa.
 *  · Tabla de cuentas con badge «Propia» vs «Genérica» por fila.
 *  · Carga masiva de PUC.
 */
import { useMemo, useState } from 'react';
import { Badge, Encabezado, Panel, Tabla, Td, Th } from '../../../_ui/componentes';
import { CargaMasiva } from '../../../_ui/CargaMasiva';
import { IconoBuscar } from '../../../_ui/iconos';
import { useEmpresa } from '../../../_ui/contextos';

type Cuenta = { codigo: string; nombre: string; origen: 'propia' | 'generica'; naturaleza: 'Débito' | 'Crédito' };

const CUENTAS: readonly Cuenta[] = [
  { codigo: '1105', nombre: 'Caja', origen: 'generica', naturaleza: 'Débito' },
  { codigo: '110505', nombre: 'Caja general', origen: 'generica', naturaleza: 'Débito' },
  { codigo: '110510', nombre: 'Caja menor — sede norte', origen: 'propia', naturaleza: 'Débito' },
  { codigo: '1435', nombre: 'Mercancías no fabricadas por la empresa', origen: 'generica', naturaleza: 'Débito' },
  { codigo: '143501', nombre: 'Inventario de repuestos importados', origen: 'propia', naturaleza: 'Débito' },
  { codigo: '2205', nombre: 'Proveedores nacionales', origen: 'generica', naturaleza: 'Crédito' },
  { codigo: '236540', nombre: 'Retención en la fuente — compras', origen: 'generica', naturaleza: 'Crédito' },
  { codigo: '413536', nombre: 'Comercio al por mayor de materiales de construcción', origen: 'propia', naturaleza: 'Crédito' },
];

export default function Puc() {
  const { empresa } = useEmpresa();
  const [soloPropio, setSoloPropio] = useState(false);
  const [busqueda, setBusqueda] = useState('');

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return CUENTAS.filter((c) => {
      if (soloPropio && c.origen !== 'propia') return false;
      if (!q) return true;
      return c.codigo.includes(q) || c.nombre.toLowerCase().includes(q);
    });
  }, [busqueda, soloPropio]);

  const propias = CUENTAS.filter((c) => c.origen === 'propia').length;

  return (
    <div className="min-h-0 flex-1 overflow-auto p-5">
      <Encabezado
        titulo="Plan de cuentas (PUC)"
        descripcion={`${empresa.nombre} · ${CUENTAS.length} cuentas visibles · ${propias} propias`}
        acciones={
          <CargaMasiva
            catalogo="PUC"
            descripcion="Sube las cuentas propias de esta empresa. Las que coincidan con un código genérico lo sobreescriben; las nuevas lo complementan."
            erroresDeMuestra={[
              { fila: 5, campo: 'codigo', motivo: 'El código "14350" no respeta la longitud de nivel del PUC (2, 4, 6 u 8 dígitos)' },
              { fila: 15, campo: 'naturaleza', motivo: 'Valor esperado "Débito" o "Crédito"; llegó "D"' },
            ]}
          />
        }
      />

      <div className="mb-4 flex items-center justify-between rounded-lg border border-borde bg-superficie-elevada p-4">
        <div>
          <p className="text-[13px] font-semibold text-texto">Usar solo mi PUC</p>
          <p className="mt-[2px] text-[12px] text-texto-suave">
            Con el interruptor activo, {empresa.nombre} deja de ver las cuentas genéricas que no haya adoptado. Afecta
            solo a esta empresa.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={soloPropio}
          onClick={() => setSoloPropio((v) => !v)}
          className={`relative h-6 w-11 shrink-0 rounded-full transition ${soloPropio ? 'bg-primario' : 'bg-borde'}`}
        >
          <span
            className={`absolute top-[2px] h-5 w-5 rounded-full bg-superficie-elevada transition ${
              soloPropio ? 'left-[22px]' : 'left-[2px]'
            }`}
          />
        </button>
      </div>

      <Panel
        titulo="Cuentas"
        acciones={
          <div className="flex items-center gap-2 rounded-md border border-borde bg-superficie-elevada px-2.5 py-1.5">
            <IconoBuscar width={13} height={13} className="text-texto-suave" />
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar cuenta"
              className="w-40 bg-transparent text-[12px] text-texto placeholder:text-texto-suave/70 focus:outline-none"
            />
          </div>
        }
      >
        <Tabla>
          <thead>
            <tr>
              <Th>Código</Th>
              <Th>Nombre</Th>
              <Th>Naturaleza</Th>
              <Th>Origen</Th>
            </tr>
          </thead>
          <tbody>
            {filtradas.map((c) => (
              <tr key={c.codigo} className="border-t border-borde/60">
                <Td numerico className="font-medium">{c.codigo}</Td>
                <Td>{c.nombre}</Td>
                <Td>{c.naturaleza}</Td>
                <Td>
                  {c.origen === 'propia' ? <Badge tono="primario">Propia</Badge> : <Badge tono="neutro">Genérica</Badge>}
                </Td>
              </tr>
            ))}
            {filtradas.length === 0 && (
              <tr>
                <Td className="text-texto-suave">Ninguna cuenta coincide con el filtro actual.</Td>
              </tr>
            )}
          </tbody>
        </Tabla>
      </Panel>
    </div>
  );
}

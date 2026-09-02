'use client';

/**
 * D-075 · Ola 5 — Pantalla 7b: ADMINISTRACIÓN · ROLES (/diseno/admin/roles).
 *
 * Matriz de permisos: filas = módulos, columnas = Ver / Editar / Aprobar,
 * checkboxes editables. El rol todopoderoso está visualmente BLOQUEADO —todo
 * marcado, sin poder desmarcar— porque quitarle un permiso dejaría a la firma
 * sin nadie que pueda administrar.
 */
import { useState } from 'react';
import { Badge, Boton, Encabezado, Panel } from '../../../_ui/componentes';
import { IconoCandado } from '../../../_ui/iconos';

const MODULOS = [
  'Bandeja de causación',
  'Terceros',
  'Parámetros tributarios',
  'Reportes',
  'PUC / Plan de cuentas',
  'Administración',
] as const;

const ACCIONES = ['Ver', 'Editar', 'Aprobar'] as const;

type Matriz = Record<string, Record<string, boolean>>;

const ROLES: ReadonlyArray<{ id: string; nombre: string; bloqueado: boolean; base: (m: string, a: string) => boolean }> = [
  {
    id: 'admin',
    nombre: 'Administrador de la firma',
    bloqueado: true,
    base: () => true,
  },
  {
    id: 'contador',
    nombre: 'Contador',
    bloqueado: false,
    base: (m, a) => (m === 'Administración' ? a === 'Ver' : true),
  },
  {
    id: 'auxiliar',
    nombre: 'Auxiliar contable',
    bloqueado: false,
    base: (m, a) => a !== 'Aprobar' && m !== 'Administración' && m !== 'Parámetros tributarios',
  },
  {
    id: 'lectura',
    nombre: 'Solo lectura',
    bloqueado: false,
    base: (_m, a) => a === 'Ver',
  },
];

function matrizInicial(base: (m: string, a: string) => boolean): Matriz {
  const m: Matriz = {};
  for (const mod of MODULOS) {
    m[mod] = {};
    for (const acc of ACCIONES) m[mod]![acc] = base(mod, acc);
  }
  return m;
}

export default function Roles() {
  const [rolId, setRolId] = useState<string>('contador');
  const rol = ROLES.find((r) => r.id === rolId) ?? ROLES[1]!;
  const [matriz, setMatriz] = useState<Matriz>(() => matrizInicial(rol.base));

  function elegirRol(id: string) {
    const nuevo = ROLES.find((r) => r.id === id) ?? ROLES[1]!;
    setRolId(id);
    setMatriz(matrizInicial(nuevo.base));
  }

  function alternar(mod: string, acc: string) {
    if (rol.bloqueado) return;
    setMatriz((prev) => ({ ...prev, [mod]: { ...prev[mod]!, [acc]: !prev[mod]![acc] } }));
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto p-5">
      <Encabezado
        titulo="Roles y permisos"
        descripcion="El permiso se impone en el motor (app.exigir_permiso). Esta matriz es la fuente de ese permiso."
        acciones={<Boton disabled={rol.bloqueado}>Guardar rol</Boton>}
      />

      <div className="grid grid-cols-[220px_1fr] gap-4">
        <nav className="flex flex-col gap-1">
          {ROLES.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => elegirRol(r.id)}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-left text-[13px] ${
                r.id === rolId
                  ? 'bg-primario/10 font-semibold text-primario dark:bg-primario-tinta-oscura/15 dark:text-primario-tinta-oscura'
                  : 'text-texto hover:bg-superficie'
              }`}
            >
              {r.bloqueado && <IconoCandado width={13} height={13} />}
              {r.nombre}
            </button>
          ))}
        </nav>

        <Panel
          titulo={rol.nombre}
          descripcion={
            rol.bloqueado
              ? 'Rol del sistema: todos los permisos marcados y bloqueados. No se puede editar ni eliminar.'
              : 'Marca o desmarca cada permiso. Editar y Aprobar implican Ver.'
          }
          acciones={rol.bloqueado ? <Badge tono="neutro">BLOQUEADO</Badge> : undefined}
        >
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium text-texto-suave">Módulo</th>
                  {ACCIONES.map((a) => (
                    <th key={a} className="px-4 py-2.5 text-center font-medium text-texto-suave">
                      {a}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MODULOS.map((mod) => (
                  <tr key={mod} className="border-t border-borde/60">
                    <td className="px-4 py-2.5 text-texto">{mod}</td>
                    {ACCIONES.map((acc) => {
                      const marcado = matriz[mod]?.[acc] ?? false;
                      return (
                        <td key={acc} className="px-4 py-2.5 text-center">
                          <input
                            type="checkbox"
                            checked={marcado}
                            disabled={rol.bloqueado}
                            onChange={() => alternar(mod, acc)}
                            aria-label={`${mod} — ${acc}`}
                            className="h-4 w-4 accent-primario disabled:cursor-not-allowed disabled:opacity-60"
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}

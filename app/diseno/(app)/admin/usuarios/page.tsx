'use client';

/**
 * D-075 · Ola 5 — Pantalla 7a: ADMINISTRACIÓN · USUARIOS (/diseno/admin/usuarios).
 *
 * Listado con estado activo/inactivo, alta de usuario y restablecer contraseña.
 * Ninguna acción borra: desactivar es reversible; restablecer contraseña genera
 * un enlace de un solo uso, no muestra ni fija una clave.
 */
import { useState } from 'react';
import { Badge, Boton, Campo, Encabezado, Entrada, Panel, Selector, Tabla, Td, Th } from '../../../_ui/componentes';

type Usuario = { id: string; nombre: string; correo: string; rol: string; activo: boolean; ultimoAcceso: string };

const USUARIOS: readonly Usuario[] = [
  { id: 'u1', nombre: 'Mariana Rueda', correo: 'mrueda@firma.com', rol: 'Contadora', activo: true, ultimoAcceso: 'hoy 08:41' },
  { id: 'u2', nombre: 'Carlos Peña', correo: 'cpena@firma.com', rol: 'Auxiliar contable', activo: true, ultimoAcceso: 'ayer 17:12' },
  { id: 'u3', nombre: 'Diana Ortiz', correo: 'dortiz@firma.com', rol: 'Revisora fiscal', activo: true, ultimoAcceso: '28 ago 2026' },
  { id: 'u4', nombre: 'Julián Gómez', correo: 'jgomez@firma.com', rol: 'Auxiliar contable', activo: false, ultimoAcceso: '02 jul 2026' },
];

export default function Usuarios() {
  const [creando, setCreando] = useState(false);

  return (
    <div className="min-h-0 flex-1 overflow-auto p-5">
      <Encabezado
        titulo="Usuarios"
        descripcion="Personas con acceso a esta firma. El permiso efectivo lo da el rol; esto solo administra cuentas."
        acciones={<Boton onClick={() => setCreando((v) => !v)}>{creando ? 'Cerrar' : '+ Crear usuario'}</Boton>}
      />

      {creando && (
        <Panel titulo="Nuevo usuario" className="mb-4">
          <div className="grid grid-cols-3 gap-4 p-4">
            <Campo etiqueta="Nombre" requerido>
              <Entrada placeholder="Nombre y apellido" />
            </Campo>
            <Campo etiqueta="Correo" requerido ayuda="Le llega una invitación para fijar su propia contraseña.">
              <Entrada type="email" placeholder="nombre@firma.com" />
            </Campo>
            <Campo etiqueta="Rol" requerido>
              <Selector defaultValue="">
                <option value="" disabled>
                  Elige un rol…
                </option>
                <option>Contadora</option>
                <option>Auxiliar contable</option>
                <option>Revisora fiscal</option>
                <option>Solo lectura</option>
              </Selector>
            </Campo>
          </div>
          <div className="flex justify-end gap-2 border-t border-borde p-4">
            <Boton variante="fantasma" onClick={() => setCreando(false)}>
              Cancelar
            </Boton>
            <Boton>Enviar invitación</Boton>
          </div>
        </Panel>
      )}

      <Panel titulo={`${USUARIOS.length} usuarios`}>
        <Tabla>
          <thead>
            <tr>
              <Th>Nombre</Th>
              <Th>Correo</Th>
              <Th>Rol</Th>
              <Th>Estado</Th>
              <Th>Último acceso</Th>
              <Th alineado="right">Acciones</Th>
            </tr>
          </thead>
          <tbody>
            {USUARIOS.map((u) => (
              <tr key={u.id} className="border-t border-borde/60">
                <Td className="font-medium">{u.nombre}</Td>
                <Td>{u.correo}</Td>
                <Td>{u.rol}</Td>
                <Td>{u.activo ? <Badge tono="exito">Activo</Badge> : <Badge tono="neutro">Inactivo</Badge>}</Td>
                <Td numerico className="text-texto-suave">{u.ultimoAcceso}</Td>
                <Td alineado="right">
                  <div className="flex justify-end gap-2">
                    <button className="text-[12px] font-medium text-primario hover:underline dark:text-primario-tinta-oscura">
                      Restablecer contraseña
                    </button>
                    <button className="text-[12px] font-medium text-texto-suave hover:underline">
                      {u.activo ? 'Desactivar' : 'Reactivar'}
                    </button>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Tabla>
      </Panel>
    </div>
  );
}

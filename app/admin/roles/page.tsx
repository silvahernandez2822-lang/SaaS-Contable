/**
 * A16 — Roles y permisos de la firma (Ola 4, Tarea 7).
 *
 * LA MATRIZ. Los permisos se presentan por MÓDULO y, dentro de cada módulo,
 * por acción: ver / editar / aprobar / administrar. Ese eje vertical lo da
 * `permission.accion_tipo` (migración 170, D-067) y no es una invención de
 * esta pantalla: cada casilla es un código de permiso real, de los que exigen
 * los triggers de la base. No hay permisos «de interfaz».
 *
 * EL CASO QUE PIDIÓ LA OLA 4 — «el junior corrige, el revisor aprueba» — se
 * arma aquí en dos minutos y sin tocar código: un rol «junior» con VER y
 * EDITAR de documentos y causación, y un rol «revisor» que además tenga la
 * columna APROBAR. Quién puede mover el estado lo deciden estos permisos; el
 * estado en sí vive en `document_correction.estado` (D-068), y las
 * correcciones pendientes se revisan en /admin/correcciones.
 *
 * EL ROL TODOPODEROSO SE VE PERO NO SE TOCA (D-066). No es una decisión de
 * esta pantalla: el motor rechaza con RL001 cualquier intento de quitarle un
 * permiso, inactivarlo o borrarlo, venga de donde venga. Aquí simplemente no
 * se dibujan botones que el motor va a rechazar.
 */
import Link from 'next/link';
import { conSesion } from '../../lib/sesion';
import {
  catalogoDePermisos,
  listarRoles,
  puedeAdministrarUsuarios,
  type FilaRol,
  type ModuloPermisos,
  type AccionPermiso,
} from '../../../src/services/administracion';
import { MensajeError } from '../../parametros/_componentes';
import { crearRolAction, editarRolAction, eliminarRolAction } from './acciones';

export const dynamic = 'force-dynamic';

type BusquedaParams = Record<string, string | string[] | undefined>;
function cadena(sp: BusquedaParams, campo: string): string {
  const v = sp[campo];
  return typeof v === 'string' ? v : '';
}

const ACCIONES: Array<{ clave: AccionPermiso; titulo: string; explicacion: string }> = [
  { clave: 'ver', titulo: 'Ver', explicacion: 'Consultar el módulo sin cambiar nada.' },
  { clave: 'editar', titulo: 'Editar', explicacion: 'Crear y modificar datos dentro del módulo.' },
  {
    clave: 'aprobar',
    titulo: 'Aprobar / rechazar',
    explicacion: 'Mover un recurso a un estado que quien solo edita no puede mover.',
  },
  { clave: 'administrar', titulo: 'Administrar', explicacion: 'Tocar la configuración del módulo.' },
];

function MatrizPermisos({
  catalogo,
  seleccionados,
  deshabilitado,
}: {
  catalogo: ModuloPermisos[];
  seleccionados: ReadonlySet<string>;
  deshabilitado?: boolean;
}) {
  return (
    <table style={{ borderCollapse: 'collapse', fontSize: 13, marginTop: 8 }}>
      <thead>
        <tr style={{ textAlign: 'left', borderBottom: '1px solid #cbd5e1' }}>
          <th style={{ padding: 4, width: 150 }}>Módulo</th>
          {ACCIONES.map((a) => (
            <th key={a.clave} style={{ padding: 4 }} title={a.explicacion}>
              {a.titulo}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {catalogo.map((m) => (
          <tr key={m.modulo} style={{ borderBottom: '1px solid #e2e8f0', verticalAlign: 'top' }}>
            <td style={{ padding: 4 }}>
              <strong>{m.modulo}</strong>
            </td>
            {ACCIONES.map((a) => (
              <td key={a.clave} style={{ padding: 4 }}>
                {m.porAccion[a.clave].length === 0 ? (
                  <span style={{ color: '#94a3b8' }}>—</span>
                ) : (
                  m.porAccion[a.clave].map((p) => (
                    <label key={p.codigo} style={{ display: 'block' }} title={p.descripcion}>
                      <input
                        type="checkbox"
                        name="permisos"
                        value={p.codigo}
                        defaultChecked={seleccionados.has(p.codigo)}
                        disabled={deshabilitado}
                      />{' '}
                      {p.nombre}
                    </label>
                  ))
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function PaginaRoles({ searchParams }: { searchParams: Promise<BusquedaParams> }) {
  const sp = await searchParams;
  const rolEditando = cadena(sp, 'rol');

  const { puede, roles, catalogo } = await conSesion(async (tx) => {
    const puede = await puedeAdministrarUsuarios(tx);
    if (!puede) return { puede, roles: [] as FilaRol[], catalogo: [] as ModuloPermisos[] };
    const [roles, catalogo] = await Promise.all([listarRoles(tx), catalogoDePermisos(tx)]);
    return { puede, roles, catalogo };
  });

  if (!puede) {
    return (
      <main style={{ maxWidth: 900, margin: '0 auto', padding: '24px' }}>
        <h1>Roles y permisos</h1>
        <p role="alert" style={{ border: '1px solid #b91c1c', padding: '10px 14px' }}>
          Su sesión no tiene el permiso <code>usuario.administrar</code>.
        </p>
      </main>
    );
  }

  const enEdicion = roles.find((r) => r.id === rolEditando) ?? null;

  return (
    <main style={{ maxWidth: 1200, margin: '0 auto', padding: '24px' }}>
      <h1>Roles y permisos</h1>
      <p>
        <Link href="/admin/usuarios">Usuarios</Link> ·{' '}
        <Link href="/admin/correcciones">Correcciones por revisar</Link>
      </p>

      <MensajeError error={cadena(sp, 'error') || undefined} />
      {cadena(sp, 'ok') && (
        <p role="status" style={{ border: '1px solid #15803d', color: '#15803d', padding: '8px 12px' }}>
          {decodeURIComponent(cadena(sp, 'ok'))}
        </p>
      )}

      <p>
        Cada casilla de la matriz es un permiso real de los que exige el motor, no una etiqueta de esta
        pantalla. El circuito «el junior corrige y el revisor aprueba» se arma dándole a un rol las columnas{' '}
        <strong>Ver</strong> y <strong>Editar</strong> de Documentos y Causación, y al otro además la columna{' '}
        <strong>Aprobar</strong>.
      </p>

      <h2>Roles</h2>
      <table style={{ borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #cbd5e1' }}>
            <th style={{ padding: 4 }}>Rol</th>
            <th style={{ padding: 4 }}>Origen</th>
            <th style={{ padding: 4 }}>Estado</th>
            <th style={{ padding: 4 }}>Personas con este rol</th>
            <th style={{ padding: 4 }}>Acción</th>
          </tr>
        </thead>
        <tbody>
          {roles.map((r) => (
            <tr key={r.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
              <td style={{ padding: 6 }}>
                <strong>{r.nombre}</strong> <code style={{ fontSize: 12 }}>{r.codigo}</code>
                <br />
                <span style={{ fontSize: 12, color: '#475569' }}>{r.descripcion}</span>
              </td>
              <td style={{ padding: 6 }}>
                {r.esTodopoderoso
                  ? 'Todopoderoso (blindado en el motor)'
                  : r.esDeLaFirma
                    ? 'Propio de su firma'
                    : 'Del sistema'}
              </td>
              <td style={{ padding: 6 }}>{r.activo ? 'Activo' : 'Inactivo'}</td>
              <td style={{ padding: 6 }}>{r.usos}</td>
              <td style={{ padding: 6 }}>
                {r.esDeLaFirma && !r.esTodopoderoso ? (
                  <>
                    <Link href={`/admin/roles?rol=${r.id}`}>Editar</Link>{' '}
                    <form action={eliminarRolAction} style={{ display: 'inline' }}>
                      <input type="hidden" name="roleId" value={r.id} />
                      <button type="submit">Eliminar</button>
                    </form>
                  </>
                ) : (
                  <span style={{ color: '#64748b' }}>
                    {r.esTodopoderoso ? 'No se edita ni se degrada' : 'Compartido por todas las firmas'}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {enEdicion && enEdicion.esDeLaFirma && !enEdicion.esTodopoderoso && (
        <section style={{ border: '1px solid #334155', padding: 16, marginTop: 24 }}>
          <h2 style={{ marginTop: 0 }}>Editar «{enEdicion.nombre}»</h2>
          <form action={editarRolAction}>
            <input type="hidden" name="roleId" value={enEdicion.id} />
            <div>
              <label>
                Nombre * <input name="nombre" required defaultValue={enEdicion.nombre} size={30} />
              </label>{' '}
              <label>
                Descripción * <input name="descripcion" required defaultValue={enEdicion.descripcion} size={60} />
              </label>
            </div>
            <div style={{ marginTop: 8 }}>
              <label>
                <input type="radio" name="activo" value="si" defaultChecked={enEdicion.activo} /> Activo
              </label>{' '}
              <label>
                <input type="radio" name="activo" value="no" defaultChecked={!enEdicion.activo} /> Inactivo (no
                concede ningún permiso)
              </label>
            </div>
            <MatrizPermisos catalogo={catalogo} seleccionados={new Set(enEdicion.permisos)} />
            <button type="submit" style={{ marginTop: 12 }}>
              Guardar rol
            </button>{' '}
            <Link href="/admin/roles">Cancelar</Link>
          </form>
        </section>
      )}

      <section style={{ border: '1px solid #334155', padding: 16, marginTop: 24 }}>
        <h2 style={{ marginTop: 0 }}>Crear un rol propio de la firma</h2>
        <form action={crearRolAction}>
          <div>
            <label>
              Código * <input name="codigo" required size={20} placeholder="revisor" pattern="[a-z][a-z0-9_]{2,39}" />
            </label>{' '}
            <label>
              Nombre * <input name="nombre" required size={28} placeholder="Revisor de causación" />
            </label>
          </div>
          <div style={{ marginTop: 8 }}>
            <label>
              Descripción *{' '}
              <input
                name="descripcion"
                required
                size={80}
                placeholder="Revisa y aprueba lo que preparan los auxiliares. No edita parámetros."
              />
            </label>
          </div>
          <MatrizPermisos catalogo={catalogo} seleccionados={new Set()} />
          <button type="submit" style={{ marginTop: 12 }}>
            Crear rol
          </button>
        </form>
      </section>
    </main>
  );
}

/**
 * A16 — Administración de usuarios (Ola 4, Tarea 7).
 *
 * QUÉ SE PUEDE HACER AQUÍ Y QUÉ NO, Y POR QUÉ:
 *
 *  · Crear usuarios, inactivarlos y reactivarlos. NUNCA borrarlos: hay
 *    `audit_log`, `approval` y `journal_entry.created_by` que los referencian,
 *    y la Regla de Oro 6 exige poder responder «quién aprobó esto» dentro de
 *    tres años, cuando esa persona ya no trabaje en la firma.
 *  · Fijarle la contraseña a alguien o forzarle el restablecimiento. Las dos
 *    cosas revocan sus sesiones abiertas en la misma transacción: si no,
 *    «cambiarle la contraseña» no echaría a nadie, que es la mitad de las
 *    veces por lo que se hace.
 *  · Otorgar y revocar roles POR EMPRESA. El acceso es por empresa, no por
 *    firma: es la unidad del aislamiento (D-021/D-022).
 *  · Ver los permisos EFECTIVOS de cada usuario, incluidos los que le da el
 *    rol todopoderoso sin tener fila en `role_permission` (D-066).
 *
 * Esta pantalla no autoriza nada. Si alguien llega aquí sin
 * `usuario.administrar` ve la lista vacía y cada botón le devuelve el rechazo
 * del motor: la garantía es el trigger, no este `if` (D-025).
 */
import Link from 'next/link';
import { conSesion } from '../../lib/sesion';
import {
  listarRoles,
  listarUsuarios,
  permisosEfectivosDe,
  puedeAdministrarUsuarios,
} from '../../../src/services/administracion';
import { listarEmpresasAccesibles } from '../../../src/services/bandeja';
import { MensajeError } from '../../parametros/_componentes';
import { FormularioCrearUsuario, FormularioPassword } from './_formularios';
import {
  asignarRolAction,
  cambiarEstadoAction,
  forzarRestablecimientoAction,
  revocarAccesoAction,
} from './acciones';

export const dynamic = 'force-dynamic';

type BusquedaParams = Record<string, string | string[] | undefined>;
function cadena(sp: BusquedaParams, campo: string): string {
  const v = sp[campo];
  return typeof v === 'string' ? v : '';
}

export default async function PaginaUsuarios({ searchParams }: { searchParams: Promise<BusquedaParams> }) {
  const sp = await searchParams;
  const detalle = cadena(sp, 'usuario');

  const { puede, usuarios, roles, empresas, permisosDetalle } = await conSesion(async (tx) => {
    const puede = await puedeAdministrarUsuarios(tx);
    if (!puede) {
      return { puede, usuarios: [], roles: [], empresas: [], permisosDetalle: [] };
    }
    const [usuarios, roles, empresas] = await Promise.all([
      listarUsuarios(tx),
      listarRoles(tx),
      listarEmpresasAccesibles(tx),
    ]);
    const permisosDetalle = detalle ? await permisosEfectivosDe(tx, detalle) : [];
    return { puede, usuarios, roles, empresas, permisosDetalle };
  });

  if (!puede) {
    return (
      <main style={{ maxWidth: 900, margin: '0 auto', padding: '24px' }}>
        <h1>Administración</h1>
        <p role="alert" style={{ border: '1px solid #b91c1c', padding: '10px 14px' }}>
          Su sesión no tiene el permiso <code>usuario.administrar</code>. Esta pantalla la usa el administrador
          de la firma; pídale a él lo que necesite.
        </p>
      </main>
    );
  }

  const rolesAsignables = roles.filter((r) => r.activo);
  const usuarioDetalle = usuarios.find((u) => u.id === detalle) ?? null;

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: '24px' }}>
      <h1>Usuarios de la firma</h1>
      <p>
        <Link href="/admin/roles">Roles y permisos</Link> ·{' '}
        <Link href="/admin/correcciones">Correcciones por revisar</Link>
      </p>

      <MensajeError error={cadena(sp, 'error') || undefined} />
      {cadena(sp, 'ok') && (
        <p role="status" style={{ border: '1px solid #15803d', color: '#15803d', padding: '8px 12px' }}>
          {decodeURIComponent(cadena(sp, 'ok'))}
        </p>
      )}

      <table style={{ borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #cbd5e1' }}>
            <th style={{ padding: 4 }}>Usuario</th>
            <th style={{ padding: 4 }}>Estado</th>
            <th style={{ padding: 4 }}>Accesos vigentes</th>
            <th style={{ padding: 4, width: 260 }}>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {usuarios.map((u) => (
            <tr key={u.id} style={{ borderBottom: '1px solid #e2e8f0', verticalAlign: 'top' }}>
              <td style={{ padding: 6 }}>
                <strong>{u.nombreCompleto}</strong>
                <br />
                <span style={{ color: '#475569' }}>{u.email}</span>
                <br />
                <span style={{ fontSize: 12, color: '#64748b' }}>
                  {u.mfaHabilitado ? 'MFA activo · ' : ''}
                  {u.debeCambiarPassword ? 'Debe cambiar la contraseña · ' : ''}
                  {u.ultimoAccesoEn ? `Último acceso: ${u.ultimoAccesoEn.slice(0, 16)}` : 'Nunca ha entrado'}
                </span>
              </td>
              <td style={{ padding: 6 }}>{u.estado}</td>
              <td style={{ padding: 6 }}>
                {u.accesos.filter((a) => !a.revocado).length === 0 ? (
                  <em>Sin acceso a ninguna empresa</em>
                ) : (
                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                    {u.accesos
                      .filter((a) => !a.revocado)
                      .map((a) => (
                        <li key={a.accesoId}>
                          {a.companyRazonSocial} — {a.rolNombre}
                          {!a.rolActivo && ' (rol inactivo: no concede nada)'}{' '}
                          <form action={revocarAccesoAction} style={{ display: 'inline' }}>
                            <input type="hidden" name="accesoId" value={a.accesoId} />
                            <button type="submit" style={{ fontSize: 11 }}>
                              revocar
                            </button>
                          </form>
                        </li>
                      ))}
                  </ul>
                )}
                <form action={asignarRolAction} style={{ marginTop: 6 }}>
                  <input type="hidden" name="userId" value={u.id} />
                  <select name="companyId" required defaultValue="">
                    <option value="" disabled>
                      Empresa…
                    </option>
                    {empresas.map((e) => (
                      <option key={e.companyId} value={e.companyId}>
                        {e.razonSocial}
                      </option>
                    ))}
                  </select>{' '}
                  <select name="roleId" required defaultValue="">
                    <option value="" disabled>
                      Rol…
                    </option>
                    {rolesAsignables.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.nombre}
                      </option>
                    ))}
                  </select>{' '}
                  <button type="submit">Otorgar</button>
                </form>
              </td>
              <td style={{ padding: 6 }}>
                <form action={cambiarEstadoAction} style={{ display: 'inline' }}>
                  <input type="hidden" name="userId" value={u.id} />
                  <input type="hidden" name="estado" value={u.estado === 'activo' ? 'inactivo' : 'activo'} />
                  <button type="submit">{u.estado === 'activo' ? 'Inactivar' : 'Reactivar'}</button>
                </form>{' '}
                <form action={forzarRestablecimientoAction} style={{ display: 'inline' }}>
                  <input type="hidden" name="userId" value={u.id} />
                  <button type="submit">Forzar cambio de contraseña</button>
                </form>
                <div style={{ marginTop: 6 }}>
                  <FormularioPassword userId={u.id} email={u.email} />
                </div>
                <div style={{ marginTop: 6 }}>
                  <Link href={`/admin/usuarios?usuario=${u.id}`}>Ver permisos efectivos</Link>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {usuarioDetalle && (
        <section style={{ border: '1px solid #334155', padding: 16, marginTop: 24 }}>
          <h2 style={{ marginTop: 0 }}>
            Permisos efectivos de {usuarioDetalle.nombreCompleto} ({usuarioDetalle.email})
          </h2>
          <p>
            Esto es lo que la BASE DE DATOS le concede hoy, no lo que dice la tabla de otorgamientos: un rol
            todopoderoso concede todo sin tener ni una fila en <code>role_permission</code> (D-066).
          </p>
          {permisosDetalle.length === 0 ? (
            <p>No tiene ningún permiso vigente sobre ninguna empresa.</p>
          ) : (
            permisosDetalle.map((p) => {
              const empresa = empresas.find((e) => e.companyId === p.companyId);
              return (
                <div key={`${p.companyId}-${p.rolCodigo}`} style={{ marginBottom: 12 }}>
                  <strong>
                    {empresa?.razonSocial ?? p.companyId} — rol {p.rolCodigo}
                    {p.esTodopoderoso && ' (TODOPODEROSO: siempre todos los permisos)'}
                  </strong>
                  <div style={{ fontSize: 13, color: '#475569' }}>{p.permisos.join(', ')}</div>
                </div>
              );
            })
          )}
          <p>
            <Link href="/admin/usuarios">Cerrar detalle</Link>
          </p>
        </section>
      )}

      <FormularioCrearUsuario
        empresas={empresas.map((e) => ({ companyId: e.companyId, razonSocial: e.razonSocial }))}
        roles={rolesAsignables.map((r) => ({ id: r.id, nombre: r.nombre, codigo: r.codigo }))}
      />
    </main>
  );
}

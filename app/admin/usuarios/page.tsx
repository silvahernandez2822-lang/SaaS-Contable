/**
 * Administración de usuarios — A16 (Ola 4, Tarea 7), migrada al sistema de
 * interfaz por A12 en D-092.
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
 *  · Ver los permisos EFECTIVOS de cada usuario CON SU ORIGEN (D-092): los que
 *    le da el rol, los que le da un rol todopoderoso sin fila en
 *    `role_permission` (D-066) y los que le da una excepción individual, con el
 *    motivo por el que se la concedieron.
 *
 * Esta pantalla no autoriza nada. Si alguien llega aquí sin
 * `usuario.administrar` ve el aviso y cada acción de servidor le devuelve el
 * rechazo del motor: la garantía es el trigger, no este `if` (D-025).
 */
import Link from 'next/link';
import { conSesion } from '../../lib/sesion';
import {
  listarRoles,
  listarUsuarios,
  permisosEfectivosDe,
  puedeAdministrarUsuarios,
  type PermisoEfectivo,
} from '../../../src/services/administracion';
import { empresasVisiblesParaLaSesion } from '../../lib/empresas';
import { MensajeError } from '../../parametros/_componentes';
import {
  Badge,
  Boton,
  Encabezado,
  EstadoVacio,
  MensajeEstado,
  Panel,
  Selector,
  Tabla,
  Td,
  Th,
} from '../../_ui/componentes';
import { FormularioCrearUsuario, FormularioPassword } from './_formularios';
import { NavegacionAdmin } from '../_navegacion';
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

const ORIGEN_ETIQUETA: Record<PermisoEfectivo['origen'], { texto: string; tono: 'neutro' | 'primario' | 'exito' }> = {
  rol: { texto: 'del rol', tono: 'neutro' },
  rol_todopoderoso: { texto: 'rol todopoderoso', tono: 'primario' },
  excepcion_individual: { texto: 'excepción individual', tono: 'exito' },
  rol_y_excepcion: { texto: 'rol + excepción', tono: 'exito' },
};

export default async function PaginaUsuarios({ searchParams }: { searchParams: Promise<BusquedaParams> }) {
  const sp = await searchParams;
  const detalle = cadena(sp, 'usuario');

  const { puede, usuarios, roles, empresas, permisosDetalle } = await conSesion(async (tx) => {
    const puede = await puedeAdministrarUsuarios(tx);
    if (!puede) {
      return { puede, usuarios: [], roles: [], empresas: [], permisosDetalle: [] };
    }
    // D-092-bis: `listarEmpresasAccesibles` exigía `documento.leer`, así que
    // esta pantalla —la del administrador de usuarios— era imposible de abrir
    // justo para el «administrador acotado» que solo administra usuarios. La
    // lista se resuelve ahora por la puerta que corresponde
    // (`app/lib/empresas.ts`), sin relajar nada del motor.
    const [usuarios, roles, visibles] = await Promise.all([
      listarUsuarios(tx),
      listarRoles(tx),
      empresasVisiblesParaLaSesion(tx),
    ]);
    const empresas = visibles.empresas;
    const permisosDetalle = detalle ? await permisosEfectivosDe(tx, detalle) : [];
    return { puede, usuarios, roles, empresas, permisosDetalle };
  });

  if (!puede) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-8">
        <Encabezado titulo="Administración" />
        <MensajeEstado tipo="configuracion" titulo="Falta el permiso de administración">
          Su sesión no tiene <code>usuario.administrar</code>. Esta pantalla la usa el administrador de la
          firma; pídale a él lo que necesite.
        </MensajeEstado>
      </main>
    );
  }

  const rolesAsignables = roles.filter((r) => r.activo);
  const usuarioDetalle = usuarios.find((u) => u.id === detalle) ?? null;
  const ok = cadena(sp, 'ok');

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <Encabezado
        titulo="Usuarios de la firma"
        descripcion="Quién entra, a qué empresas y con qué rol. Un usuario nunca se borra: se inactiva, para que la auditoría de lo que aprobó siga teniendo nombre."
      />
      <NavegacionAdmin activo="usuarios" />

      <MensajeError error={cadena(sp, 'error') || undefined} />
      {ok && (
        <div className="my-3">
          <MensajeEstado tipo="sin-datos" titulo={decodeURIComponent(ok)} />
        </div>
      )}

      <Panel titulo={`${usuarios.length} usuario(s)`} className="mt-4">
        <Tabla alturaMaxima={null}>
          <thead>
            <tr>
              <Th>Usuario</Th>
              <Th>Estado</Th>
              <Th>Accesos vigentes</Th>
              <Th>Acciones</Th>
            </tr>
          </thead>
          <tbody>
            {usuarios.map((u) => {
              const vigentes = u.accesos.filter((a) => !a.revocado);
              return (
                <tr key={u.id} className="border-t border-borde/60 align-top">
                  <Td>
                    <span className="font-semibold text-texto">{u.nombreCompleto}</span>
                    <span className="block text-menor text-texto-suave">{u.email}</span>
                    <span className="block text-metadata text-texto-suave">
                      {u.mfaHabilitado ? 'MFA activo · ' : ''}
                      {u.debeCambiarPassword ? 'Debe cambiar la contraseña · ' : ''}
                      {u.ultimoAccesoEn ? `Último acceso: ${u.ultimoAccesoEn.slice(0, 16)}` : 'Nunca ha entrado'}
                    </span>
                  </Td>
                  <Td>
                    <Badge tono={u.estado === 'activo' ? 'exito' : 'neutro'}>{u.estado}</Badge>
                  </Td>
                  <Td>
                    {vigentes.length === 0 ? (
                      <span className="text-texto-suave">Sin acceso a ninguna empresa</span>
                    ) : (
                      <ul className="flex flex-col gap-1">
                        {vigentes.map((a) => (
                          <li key={a.accesoId} className="flex flex-wrap items-center gap-2">
                            <span>
                              {a.companyRazonSocial} — {a.rolNombre}
                            </span>
                            {!a.rolActivo && <Badge tono="error">rol inactivo: no concede nada</Badge>}
                            <form action={revocarAccesoAction}>
                              <input type="hidden" name="accesoId" value={a.accesoId} />
                              <Boton tipo="submit" variante="terciario" className="px-2 py-[2px] text-metadata">
                                revocar
                              </Boton>
                            </form>
                          </li>
                        ))}
                      </ul>
                    )}
                    <form action={asignarRolAction} className="mt-2 flex flex-wrap items-center gap-2">
                      <input type="hidden" name="userId" value={u.id} />
                      <Selector name="companyId" required defaultValue="">
                        <option value="" disabled>
                          Empresa…
                        </option>
                        {empresas.map((e) => (
                          <option key={e.companyId} value={e.companyId}>
                            {e.razonSocial}
                          </option>
                        ))}
                      </Selector>
                      <Selector name="roleId" required defaultValue="">
                        <option value="" disabled>
                          Rol…
                        </option>
                        {rolesAsignables.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.nombre}
                          </option>
                        ))}
                      </Selector>
                      <Boton tipo="submit" variante="secundario">
                        Otorgar
                      </Boton>
                    </form>
                  </Td>
                  <Td>
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-wrap gap-2">
                        <form action={cambiarEstadoAction}>
                          <input type="hidden" name="userId" value={u.id} />
                          <input
                            type="hidden"
                            name="estado"
                            value={u.estado === 'activo' ? 'inactivo' : 'activo'}
                          />
                          <Boton tipo="submit" variante={u.estado === 'activo' ? 'peligro' : 'fantasma'}>
                            {u.estado === 'activo' ? 'Inactivar' : 'Reactivar'}
                          </Boton>
                        </form>
                        <form action={forzarRestablecimientoAction}>
                          <input type="hidden" name="userId" value={u.id} />
                          <Boton tipo="submit" variante="fantasma">
                            Forzar cambio de contraseña
                          </Boton>
                        </form>
                      </div>
                      <FormularioPassword userId={u.id} email={u.email} />
                      <div className="flex flex-wrap gap-3 text-menor">
                        <Link
                          href={`/admin/usuarios?usuario=${u.id}`}
                          className="font-semibold text-primario underline dark:text-primario-tinta-oscura"
                        >
                          Ver permisos efectivos
                        </Link>
                        <Link
                          href={`/admin/permisos?usuario=${u.id}`}
                          className="font-semibold text-primario underline dark:text-primario-tinta-oscura"
                        >
                          Permisos individuales
                        </Link>
                      </div>
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Tabla>
      </Panel>

      {usuarioDetalle && (
        <Panel
          className="mt-6"
          titulo={`Permisos efectivos de ${usuarioDetalle.nombreCompleto}`}
          descripcion="Esto es lo que la BASE DE DATOS le concede hoy, no lo que dice la tabla de otorgamientos: un rol todopoderoso concede todo sin tener ni una fila en role_permission (D-066), y una excepción individual concede o quita por encima del rol (D-092)."
          acciones={
            <Link
              href="/admin/usuarios"
              className="text-menor font-semibold text-primario underline dark:text-primario-tinta-oscura"
            >
              Cerrar detalle
            </Link>
          }
        >
          {permisosDetalle.length === 0 ? (
            <EstadoVacio
              titulo="No tiene ningún permiso vigente sobre ninguna empresa"
              detalle="Otórguele un rol sobre una empresa para que pueda hacer algo."
            />
          ) : (
            <div className="flex flex-col gap-5 p-5">
              {permisosDetalle.map((p) => {
                const empresa = empresas.find((e) => e.companyId === p.companyId);
                return (
                  <div key={`${p.companyId}-${p.rolCodigo}`}>
                    <p className="text-menor font-semibold text-texto">
                      {empresa?.razonSocial ?? p.companyId} — rol {p.rolCodigo}
                      {p.esTodopoderoso && ' · TODOPODEROSO: siempre todos los permisos'}
                    </p>
                    <ul className="mt-2 flex flex-wrap gap-2">
                      {p.permisos.map((perm) => (
                        <li key={perm.codigo} className="flex items-center gap-1.5">
                          <code className="text-metadata text-texto">{perm.codigo}</code>
                          <Badge tono={ORIGEN_ETIQUETA[perm.origen].tono}>
                            {ORIGEN_ETIQUETA[perm.origen].texto}
                          </Badge>
                          {perm.motivo && (
                            <span className="text-metadata text-texto-suave" title={perm.motivo}>
                              «{perm.motivo.slice(0, 60)}
                              {perm.motivo.length > 60 ? '…' : ''}»
                              {perm.venceEn ? ` · vence ${perm.venceEn.slice(0, 10)}` : ''}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      )}

      <FormularioCrearUsuario
        empresas={empresas.map((e) => ({ companyId: e.companyId, razonSocial: e.razonSocial }))}
        roles={rolesAsignables.map((r) => ({ id: r.id, nombre: r.nombre, codigo: r.codigo }))}
      />
    </main>
  );
}

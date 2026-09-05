/**
 * Roles y permisos de la firma — A16 (Ola 4, Tarea 7), migrada al sistema de
 * interfaz por A12 en D-092.
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
 *
 * D-092 — LO QUE UN ROL NO SIRVE PARA HACER. Un rol es la herramienta para un
 * REPARTO ESTABLE de responsabilidades. Para la excepción de una persona
 * concreta («este mes, y solo este mes, el auxiliar Pérez exporta la exógena»)
 * fabricar un rol nuevo es peor que no tener nada: acaba habiendo dieciocho
 * roles llamados «contador_2» y nadie recuerda por qué existe cada uno. Esa
 * excepción vive en /admin/permisos, con motivo obligatorio y fecha de
 * vencimiento.
 *
 * D-092 — NADIE METE EN UN ROL UN PERMISO QUE NO EJERCE. La migración 183 lo
 * impone con PO002 sobre el INSERT de `role_permission`: sin ese guardia,
 * `usuario.administrar` era transitivamente equivalente a todos los permisos
 * del producto (bastaba con crear un rol con todo y auto-asignárselo). Quitar
 * un permiso de un rol nunca se restringe: bajar no es escalar.
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
import { Badge, Boton, Campo, Encabezado, Entrada, MensajeEstado, Panel, Tabla, Td, Th } from '../../_ui/componentes';
import { NavegacionAdmin } from '../_navegacion';
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
}: {
  catalogo: ModuloPermisos[];
  seleccionados: ReadonlySet<string>;
}) {
  return (
    <Tabla alturaMaxima="55vh">
      <thead>
        <tr>
          <Th>Módulo</Th>
          {ACCIONES.map((a) => (
            <Th key={a.clave}>{a.titulo}</Th>
          ))}
        </tr>
      </thead>
      <tbody>
        {catalogo.map((m) => (
          <tr key={m.modulo} className="border-t border-borde/60 align-top">
            <Td className="font-semibold text-texto">{m.modulo}</Td>
            {ACCIONES.map((a) => (
              <Td key={a.clave}>
                {m.porAccion[a.clave].length === 0 ? (
                  <span className="text-texto-suave">—</span>
                ) : (
                  m.porAccion[a.clave].map((p) => (
                    <label key={p.codigo} className="flex items-start gap-1.5 py-[2px]" title={p.descripcion}>
                      <input
                        type="checkbox"
                        name="permisos"
                        value={p.codigo}
                        defaultChecked={seleccionados.has(p.codigo)}
                        className="mt-[2px] accent-[var(--color-primario)]"
                      />
                      <span>{p.nombre}</span>
                    </label>
                  ))
                )}
              </Td>
            ))}
          </tr>
        ))}
      </tbody>
    </Tabla>
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
      <main className="mx-auto max-w-5xl px-6 py-8">
        <Encabezado titulo="Roles y permisos" />
        <MensajeEstado tipo="configuracion" titulo="Falta el permiso de administración">
          Su sesión no tiene <code>usuario.administrar</code>.
        </MensajeEstado>
      </main>
    );
  }

  const enEdicion = roles.find((r) => r.id === rolEditando) ?? null;
  const ok = cadena(sp, 'ok');

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <Encabezado
        titulo="Roles y permisos"
        descripcion="Cada casilla de la matriz es un permiso real de los que exige el motor, no una etiqueta de esta pantalla."
      />
      <NavegacionAdmin activo="roles" />

      <MensajeError error={cadena(sp, 'error') || undefined} />
      {ok && (
        <div className="my-3">
          <MensajeEstado tipo="sin-datos" titulo={decodeURIComponent(ok)} />
        </div>
      )}

      <div className="my-4">
        <MensajeEstado tipo="sin-datos" titulo="Un rol es para un reparto estable; una excepción, no">
          El circuito «el junior corrige y el revisor aprueba» se arma dándole a un rol las columnas{' '}
          <strong>Ver</strong> y <strong>Editar</strong> de Documentos y Causación, y al otro además la columna{' '}
          <strong>Aprobar</strong>. Para la excepción de UNA persona («este mes exporta él porque el contador está
          incapacitado») no cree un rol: use{' '}
          <Link href="/admin/permisos" className="font-semibold underline">
            Permisos individuales
          </Link>
          , que exige motivo escrito y admite fecha de vencimiento. Y tenga presente que{' '}
          <strong>no se puede meter en un rol un permiso que usted mismo no ejerce</strong>: lo rechaza el motor.
        </MensajeEstado>
      </div>

      <Panel titulo={`${roles.length} rol(es)`}>
        <Tabla alturaMaxima={null}>
          <thead>
            <tr>
              <Th>Rol</Th>
              <Th>Origen</Th>
              <Th>Estado</Th>
              <Th alineado="right">Personas con este rol</Th>
              <Th>Acción</Th>
            </tr>
          </thead>
          <tbody>
            {roles.map((r) => (
              <tr key={r.id} className="border-t border-borde/60 align-top">
                <Td>
                  <span className="font-semibold text-texto">{r.nombre}</span>{' '}
                  <code className="text-metadata text-texto-suave">{r.codigo}</code>
                  <span className="block text-menor text-texto-suave">{r.descripcion}</span>
                </Td>
                <Td>
                  {r.esTodopoderoso ? (
                    <Badge tono="primario">Todopoderoso (blindado en el motor)</Badge>
                  ) : r.esDeLaFirma ? (
                    <Badge tono="exito">Propio de su firma</Badge>
                  ) : (
                    <Badge tono="neutro">Del sistema</Badge>
                  )}
                </Td>
                <Td>
                  <Badge tono={r.activo ? 'exito' : 'error'}>{r.activo ? 'Activo' : 'Inactivo'}</Badge>
                </Td>
                <Td numerico alineado="right">
                  {r.usos}
                </Td>
                <Td>
                  {r.esDeLaFirma && !r.esTodopoderoso ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/admin/roles?rol=${r.id}`}
                        className="text-menor font-semibold text-primario underline dark:text-primario-tinta-oscura"
                      >
                        Editar
                      </Link>
                      <form action={eliminarRolAction}>
                        <input type="hidden" name="roleId" value={r.id} />
                        <Boton tipo="submit" variante="peligro" className="px-2.5 py-1 text-menor">
                          Eliminar
                        </Boton>
                      </form>
                    </div>
                  ) : (
                    <span className="text-texto-suave">
                      {r.esTodopoderoso ? 'No se edita ni se degrada' : 'Compartido por todas las firmas'}
                    </span>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Tabla>
      </Panel>

      {enEdicion && enEdicion.esDeLaFirma && !enEdicion.esTodopoderoso && (
        <Panel className="mt-6" titulo={`Editar «${enEdicion.nombre}»`}>
          <form action={editarRolAction} className="flex flex-col gap-4 p-5">
            <input type="hidden" name="roleId" value={enEdicion.id} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo etiqueta="Nombre" requerido>
                <Entrada name="nombre" required defaultValue={enEdicion.nombre} />
              </Campo>
              <Campo etiqueta="Descripción" requerido>
                <Entrada name="descripcion" required defaultValue={enEdicion.descripcion} />
              </Campo>
            </div>
            <fieldset className="flex flex-wrap gap-4 text-menor text-texto">
              <legend className="text-[12px] font-medium text-texto">Estado</legend>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="activo"
                  value="si"
                  defaultChecked={enEdicion.activo}
                  className="accent-[var(--color-primario)]"
                />
                Activo
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="activo"
                  value="no"
                  defaultChecked={!enEdicion.activo}
                  className="accent-[var(--color-primario)]"
                />
                Inactivo (no concede ningún permiso)
              </label>
            </fieldset>
            <MatrizPermisos catalogo={catalogo} seleccionados={new Set(enEdicion.permisos)} />
            <div className="flex items-center gap-3">
              <Boton tipo="submit">Guardar rol</Boton>
              <Link
                href="/admin/roles"
                className="text-menor font-semibold text-primario underline dark:text-primario-tinta-oscura"
              >
                Cancelar
              </Link>
            </div>
          </form>
        </Panel>
      )}

      <Panel className="mt-6" titulo="Crear un rol propio de la firma">
        <form action={crearRolAction} className="flex flex-col gap-4 p-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <Campo etiqueta="Código" requerido ayuda="Minúsculas, números y guion bajo.">
              <Entrada name="codigo" required placeholder="revisor" pattern="[a-z][a-z0-9_]{2,39}" />
            </Campo>
            <Campo etiqueta="Nombre" requerido>
              <Entrada name="nombre" required placeholder="Revisor de causación" />
            </Campo>
            <Campo etiqueta="Descripción" requerido ayuda="Dentro de un año, quien la lea tiene que saber para qué se creó.">
              <Entrada
                name="descripcion"
                required
                placeholder="Revisa y aprueba lo que preparan los auxiliares. No edita parámetros."
              />
            </Campo>
          </div>
          <MatrizPermisos catalogo={catalogo} seleccionados={new Set()} />
          <div>
            <Boton tipo="submit">Crear rol</Boton>
          </div>
        </form>
      </Panel>
    </main>
  );
}

/**
 * D-092 — Permisos individuales: la excepción de UNA persona, con motivo.
 *
 * POR QUÉ ESTA PANTALLA EXISTE SI YA HAY ROLES. Hasta D-092 el permiso efectivo
 * de alguien salía 100% de su ROL. Para darle a una sola persona un permiso
 * puntual había que fabricarle un rol a medida — y a los seis meses la firma
 * tiene «contador_2», «contador_2_bis» y nadie recuerda por qué existe cada
 * uno, ni quién lo pidió, ni si sigue haciendo falta. Un rol contesta «qué
 * hace este puesto»; no contesta «por qué esta persona, este mes, puede esto».
 *
 * EL MOTIVO ES OBLIGATORIO y no es burocracia: es lo único que dentro de un año
 * distingue «se le dio porque el contador estaba incapacitado y había que
 * presentar la exógena» de «se le dio». Un permiso especial sin razón
 * documentada es un hueco de trazabilidad (Regla de Oro 6). Lo exige también el
 * motor (`upo_motivo_ck`).
 *
 * LA REVOCACIÓN NO BORRA. `user_permission_override` es append-only (PO003):
 * retirar la excepción inserta una fila nueva con su propio motivo y su propio
 * autor. Si revocar hiciera `DELETE`, la pregunta «¿quién tuvo
 * `asiento.publicar` en marzo y por qué?» quedaría sin respuesta — que es
 * exactamente la pregunta que esta pantalla existe para contestar.
 *
 * NADIE SE ASCIENDE A SÍ MISMO (PO001) Y NADIE CONCEDE LO QUE NO EJERCE
 * (PO002). Los dos los impone la migración 183 en el motor, no este archivo:
 * el catálogo de abajo se filtra a lo que la sesión sí ejerce por cortesía, no
 * por garantía (D-025).
 */
import Link from 'next/link';
import { conSesion } from '../../lib/sesion';
import {
  catalogoDePermisos,
  listarUsuarios,
  overridesDeUsuario,
  overridesVigentes,
  puedeAdministrarUsuarios,
} from '../../../src/services/administracion';
import { permisosDeLaSesion } from '../../../src/auth/permisos';
import { empresasVisiblesParaLaSesion } from '../../lib/empresas';
import { MensajeError } from '../../parametros/_componentes';
import {
  Badge,
  Boton,
  Campo,
  Encabezado,
  Entrada,
  EstadoVacio,
  MensajeEstado,
  Panel,
  Selector,
  Tabla,
  Td,
  Th,
} from '../../_ui/componentes';
import { NavegacionAdmin } from '../_navegacion';
import { decidirPermisoAction } from './acciones';

export const dynamic = 'force-dynamic';

type BusquedaParams = Record<string, string | string[] | undefined>;
function cadena(sp: BusquedaParams, campo: string): string {
  const v = sp[campo];
  return typeof v === 'string' ? v : '';
}

function fecha(iso: string | null): string {
  return iso ? iso.replace('T', ' ').slice(0, 16) : '—';
}

export default async function PaginaPermisosIndividuales({
  searchParams,
}: {
  searchParams: Promise<BusquedaParams>;
}) {
  const sp = await searchParams;
  const usuarioSeleccionado = cadena(sp, 'usuario');

  const datos = await conSesion(async (tx) => {
    const puede = await puedeAdministrarUsuarios(tx);
    if (!puede) return { puede: false as const };
    // D-092-bis: la lista de empresas ya no depende de `documento.leer` (que
    // hacía imposible abrir esta pantalla al administrador acotado). Ver
    // `app/lib/empresas.ts`.
    const [usuarios, catalogo, visibles, propios, vigentes] = await Promise.all([
      listarUsuarios(tx),
      catalogoDePermisos(tx),
      empresasVisiblesParaLaSesion(tx),
      permisosDeLaSesion(tx),
      overridesVigentes(tx),
    ]);
    const empresas = visibles.empresas;
    const historialUsuario = usuarioSeleccionado ? await overridesDeUsuario(tx, usuarioSeleccionado) : [];
    // La empresa de la sesión: la RLS de `user_permission_override` solo deja
    // escribir sobre ella (ver la migración 183). Preguntarlo aquí evita
    // ofrecer un desplegable de empresas que el motor va a rechazar.
    const { rows } = await tx.query<{ company_id: string | null }>(
      'SELECT app.current_company_id() AS company_id',
    );
    return {
      puede: true as const,
      usuarios,
      catalogo,
      empresas,
      propios,
      vigentes,
      historialUsuario,
      companyId: rows[0]?.company_id ?? null,
    };
  });

  if (!datos.puede) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-8">
        <Encabezado titulo="Permisos individuales" />
        <MensajeEstado tipo="configuracion" titulo="Falta el permiso de administración">
          Su sesión no tiene <code>usuario.administrar</code>.
        </MensajeEstado>
      </main>
    );
  }

  const { usuarios, catalogo, empresas, propios, vigentes, historialUsuario, companyId } = datos;
  const empresaActiva = empresas.find((e) => e.companyId === companyId) ?? null;
  const usuario = usuarios.find((u) => u.id === usuarioSeleccionado) ?? null;
  const propiosSet = new Set(propios);
  const ok = cadena(sp, 'ok');

  // Un rol todopoderoso no tiene filas en `role_permission`, así que
  // `permisosDeLaSesion` (que lee `v_user_permission`) le devuelve la lista
  // completa igualmente porque 014 se las insertó. Si algún día no fuera así,
  // el motor seguiría siendo quien decide: esto solo ordena el desplegable.
  const otorgables = catalogo.flatMap((m) =>
    Object.values(m.porAccion)
      .flat()
      .map((p) => ({ ...p, tengo: propiosSet.has(p.codigo) })),
  );

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <Encabezado
        titulo="Permisos individuales"
        descripcion="La excepción de una persona concreta, por encima de lo que le da su rol, con el motivo escrito y —si se quiere— fecha de vencimiento."
      />
      <NavegacionAdmin activo="permisos" />

      <MensajeError error={cadena(sp, 'error') || undefined} />
      {ok && (
        <div className="my-3">
          <MensajeEstado tipo="sin-datos" titulo={decodeURIComponent(ok)} />
        </div>
      )}

      {!empresaActiva && (
        <div className="my-4">
          <MensajeEstado tipo="configuracion" titulo="Elija una empresa en el selector de arriba">
            Un permiso individual se concede sobre UNA empresa: la empresa es la unidad del aislamiento
            (D-021/D-022), no un parámetro de esta pantalla. Sin empresa activa se puede consultar lo ya
            decidido, pero no decidir nada nuevo.
          </MensajeEstado>
        </div>
      )}

      <Panel
        className="mt-4"
        titulo={`${vigentes.length} excepción(es) vigente(s)`}
        descripcion="Lo que MANDA hoy. Cada fila es la decisión más reciente y no vencida para ese usuario, esa empresa y ese permiso."
      >
        {vigentes.length === 0 ? (
          <EstadoVacio
            titulo="Ninguna excepción vigente"
            detalle="Todo el mundo puede exactamente lo que le da su rol. Es el estado sano."
          />
        ) : (
          <Tabla alturaMaxima={null}>
            <thead>
              <tr>
                <Th>Usuario</Th>
                <Th>Empresa</Th>
                <Th>Permiso</Th>
                <Th>Efecto</Th>
                <Th>Motivo</Th>
                <Th>Vence</Th>
                <Th>Lo decidió</Th>
              </tr>
            </thead>
            <tbody>
              {vigentes.map((o) => (
                <tr key={o.id} className="border-t border-borde/60 align-top">
                  <Td>
                    <Link
                      href={`/admin/permisos?usuario=${o.userId}`}
                      className="font-semibold text-primario underline dark:text-primario-tinta-oscura"
                    >
                      {o.usuarioNombre}
                    </Link>
                  </Td>
                  <Td>{o.companyRazonSocial}</Td>
                  <Td>
                    <code className="text-metadata">{o.permisoCodigo}</code>
                    <span className="block text-metadata text-texto-suave">{o.permisoNombre}</span>
                  </Td>
                  <Td>
                    <Badge tono={o.efecto === 'otorgado' ? 'exito' : 'error'}>{o.efecto}</Badge>
                  </Td>
                  <Td>{o.motivo}</Td>
                  <Td className="tabular-nums">{o.venceEn ? o.venceEn.slice(0, 10) : 'sin vencimiento'}</Td>
                  <Td>
                    {o.otorgadoPorNombre ?? '—'}
                    <span className="block text-metadata text-texto-suave tabular-nums">{fecha(o.otorgadoEn)}</span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Tabla>
        )}
      </Panel>

      <Panel className="mt-6" titulo="Decidir una excepción">
        <form action={decidirPermisoAction} className="flex flex-col gap-4 p-5">
          <input type="hidden" name="companyId" value={companyId ?? ''} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo
              etiqueta="Usuario"
              requerido
              ayuda="Si se elige a sí mismo para OTORGAR, el motor lo rechaza (PO001): nadie se concede una excepción a sí mismo."
            >
              <Selector name="userId" required defaultValue={usuarioSeleccionado}>
                <option value="" disabled>
                  Elija un usuario…
                </option>
                {usuarios.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nombreCompleto} ({u.email})
                  </option>
                ))}
              </Selector>
            </Campo>
            <Campo etiqueta="Empresa">
              <Entrada
                readOnly
                value={empresaActiva ? empresaActiva.razonSocial : 'sin empresa activa'}
                aria-label="Empresa sobre la que se concede"
              />
            </Campo>
            <Campo
              etiqueta="Permiso"
              requerido
              ayuda="Solo se puede conceder lo que usted mismo ejerce; lo demás lo rechaza el motor."
            >
              <Selector name="permisoCodigo" required defaultValue="">
                <option value="" disabled>
                  Elija un permiso…
                </option>
                {otorgables.map((p) => (
                  <option key={p.codigo} value={p.codigo}>
                    {p.codigo} — {p.nombre}
                    {p.tengo ? '' : ' (usted no lo tiene)'}
                  </option>
                ))}
              </Selector>
            </Campo>
            <Campo etiqueta="Efecto" requerido>
              <Selector name="efecto" required defaultValue="otorgado">
                <option value="otorgado">Otorgar por encima del rol</option>
                <option value="revocado">Revocar aunque el rol lo dé</option>
              </Selector>
            </Campo>
            <Campo
              etiqueta="Vence el"
              ayuda="Opcional y solo para «otorgar». Una excepción con fecha se apaga sola: es la forma sana de conceder un permiso puntual."
            >
              <Entrada name="venceEn" type="date" />
            </Campo>
            <Campo
              etiqueta="Motivo"
              requerido
              ayuda="Al menos una frase. Dentro de un año, quien lo lea tiene que poder saber por qué se concedió."
            >
              <Entrada
                name="motivo"
                required
                minLength={10}
                placeholder="El contador está incapacitado y hay que presentar la exógena antes del 15."
              />
            </Campo>
          </div>
          <div>
            <Boton tipo="submit" disabled={!empresaActiva}>
              Registrar la decisión
            </Boton>
          </div>
        </form>
      </Panel>

      {usuario && (
        <Panel
          className="mt-6"
          titulo={`Cadena de decisiones de ${usuario.nombreCompleto}`}
          descripcion="Todas, no solo las vigentes: revocar no borra la decisión anterior, le añade otra encima."
          acciones={
            <Link
              href="/admin/permisos"
              className="text-menor font-semibold text-primario underline dark:text-primario-tinta-oscura"
            >
              Cerrar
            </Link>
          }
        >
          {historialUsuario.length === 0 ? (
            <EstadoVacio
              titulo="Nunca se le ha concedido ni retirado una excepción"
              detalle="Sus permisos son exactamente los de su rol."
            />
          ) : (
            <Tabla alturaMaxima={null}>
              <thead>
                <tr>
                  <Th>Cuándo</Th>
                  <Th>Empresa</Th>
                  <Th>Permiso</Th>
                  <Th>Efecto</Th>
                  <Th>Motivo</Th>
                  <Th>Lo decidió</Th>
                  <Th>Estado</Th>
                </tr>
              </thead>
              <tbody>
                {historialUsuario.map((o) => (
                  <tr key={o.id} className="border-t border-borde/60 align-top">
                    <Td className="tabular-nums text-texto-suave">{fecha(o.otorgadoEn)}</Td>
                    <Td>{o.companyRazonSocial}</Td>
                    <Td>
                      <code className="text-metadata">{o.permisoCodigo}</code>
                    </Td>
                    <Td>
                      <Badge tono={o.efecto === 'otorgado' ? 'exito' : 'error'}>{o.efecto}</Badge>
                    </Td>
                    <Td>{o.motivo}</Td>
                    <Td>{o.otorgadoPorNombre ?? '—'}</Td>
                    <Td>
                      {o.vigente ? (
                        <Badge tono="primario">manda hoy</Badge>
                      ) : (
                        <Badge tono="neutro">superada o vencida</Badge>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Tabla>
          )}
        </Panel>
      )}
    </main>
  );
}

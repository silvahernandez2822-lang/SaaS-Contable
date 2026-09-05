/**
 * A16 — Administración de usuarios, roles y permisos (Ola 4, Tarea 7).
 *
 * EXTIENDE lo que ya existía; no lo duplica. `permission`, `role`,
 * `role_permission` y `user_company_access` son de A12/A2 (migraciones 014 y
 * 016) y siguen siendo la fuente de verdad; `app.tiene_permiso` sigue siendo
 * quien autoriza y el trigger `<tabla>_permiso` sigue siendo quien impone. Lo
 * que faltaba era la PANTALLA y las tres piezas de modelo que la hacían
 * imposible, añadidas en la migración 170:
 *
 *   · `role.es_todopoderoso` (D-066) — el rol que siempre lo puede todo,
 *     blindado en el motor y no en la interfaz.
 *   · `role.activo` y `permission.accion_tipo` (D-067) — roles propios de la
 *     firma, presentados como matriz «módulo × ver / editar / aprobar /
 *     administrar».
 *   · `document_correction.estado` (D-068) — «el junior corrige, el revisor
 *     aprueba» como ESTADO del recurso, no como permiso especial.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * D-066 — POR QUÉ EL BLINDAJE DEL ROL TODOPODEROSO NO ESTÁ EN ESTE ARCHIVO
 *
 * La Ola 4 pide un rol que «no se pueda des-otorgar por error desde la UI,
 * blindado a nivel de código, no solo de datos». Un `if` en esta capa
 * cumpliría la letra y no el fondo: la interfaz no es el único camino a la
 * base — están el `psql` del operador, una migración futura y cualquier
 * servicio que se escriba después.
 *
 * El blindaje real son tres cosas del motor (migración 170):
 *   1. `app.tiene_permiso` concede TODO a un rol `es_todopoderoso` SIN mirar
 *      `role_permission`. Vaciar esa tabla no lo desarma.
 *   2. Un trigger rechaza (RL001) todo UPDATE/DELETE sobre las filas de
 *      `role_permission` de ese rol.
 *   3. Otro trigger rechaza degradarlo, inactivarlo o borrarlo — y también
 *      rechaza CREAR uno nuevo desde una sesión de aplicación, porque una
 *      firma que pudiera fabricarse roles todopoderosos convertiría el
 *      blindaje en un adorno.
 *
 * Este archivo solo se asegura de no ofrecer botones que el motor va a
 * rechazar, que es una cortesía, no una garantía (D-025).
 * ─────────────────────────────────────────────────────────────────────────
 *
 * NUNCA SE BORRA UN USUARIO. Se inactiva (`user.estado`), igual que el resto
 * del sistema maneja estados. Un `DELETE` sobre `"user"` dejaría huérfanas las
 * filas de `audit_log`, `journal_entry.created_by` y `approval`: la
 * trazabilidad de la Regla de Oro 6 exige poder responder «quién aprobó esto»
 * también dentro de tres años, cuando esa persona ya no trabaje en la firma.
 */
import type { SqlClient } from '../db/types';
import { randomBytes } from 'node:crypto';
import {
  ALGORITMO_PASSWORD,
  exigirPasswordAceptable,
  hashearPassword,
  verificarPassword,
} from '../auth/password';
import { PERMISOS, exigirPermiso } from '../auth/permisos';
import type { EmpresaAccesible } from './bandeja';

// =============================================================================
// ERRORES DE DOMINIO
// =============================================================================

export class AdministracionInvalidaError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'AdministracionInvalidaError';
  }
}

export class UsuarioNoEncontradoError extends Error {
  constructor(id: string) {
    super(`No existe (o no es visible para esta sesión) el usuario ${id}.`);
    this.name = 'UsuarioNoEncontradoError';
  }
}

export class RolNoEncontradoError extends Error {
  constructor(id: string) {
    super(`No existe (o no es visible para esta sesión) el rol ${id}.`);
    this.name = 'RolNoEncontradoError';
  }
}

/** Se intentó tocar un rol blindado desde la aplicación (D-066). */
export class RolBlindadoError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'RolBlindadoError';
  }
}

// =============================================================================
// CONTEXTO
// =============================================================================

interface Contexto {
  tenantId: string;
  companyId: string | null;
  userId: string | null;
}

async function contexto(tx: SqlClient): Promise<Contexto> {
  const { rows } = await tx.query<{ tenant_id: string | null; company_id: string | null; user_id: string | null }>(
    `SELECT app.current_tenant_id() AS tenant_id,
            app.current_company_id() AS company_id,
            app.current_user_id()    AS user_id`,
  );
  const tenantId = rows[0]?.tenant_id ?? null;
  if (!tenantId) {
    throw new AdministracionInvalidaError('No hay firma en la sesión: la administración exige sesión válida.');
  }
  return { tenantId, companyId: rows[0]?.company_id ?? null, userId: rows[0]?.user_id ?? null };
}

export async function puedeAdministrarUsuarios(tx: SqlClient): Promise<boolean> {
  const { rows } = await tx.query<{ tiene: boolean }>("SELECT app.tiene_permiso('usuario.administrar') AS tiene");
  return rows[0]?.tiene === true;
}

const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Contraseña aleatoria de 192 bits en base64url, igual que el arranque. */
export function generarPasswordInicial(): string {
  return randomBytes(24).toString('base64url');
}

// =============================================================================
// CATÁLOGO DE PERMISOS — la matriz «módulo × acción» de la Ola 4
// =============================================================================

export type AccionPermiso = 'ver' | 'editar' | 'aprobar' | 'administrar';

export interface FilaPermiso {
  codigo: string;
  nombre: string;
  descripcion: string;
  modulo: string;
  accionTipo: AccionPermiso;
}

export interface ModuloPermisos {
  modulo: string;
  /** Los permisos del módulo agrupados por acción: ver / editar / aprobar / administrar. */
  porAccion: Record<AccionPermiso, FilaPermiso[]>;
}

/**
 * El catálogo de permisos, presentado como lo pide un administrador de firma:
 * por módulo, y dentro de cada módulo por «ver / editar / aprobar».
 *
 * No hay ningún permiso inventado para esta pantalla: son los mismos códigos
 * que exigen los triggers de la base. `permission.accion_tipo` (migración 170)
 * es el eje que faltaba para poder agruparlos así.
 */
export async function catalogoDePermisos(tx: SqlClient): Promise<ModuloPermisos[]> {
  const { rows } = await tx.query<{
    codigo: string;
    nombre: string;
    descripcion: string;
    modulo: string;
    accion_tipo: AccionPermiso;
  }>('SELECT codigo, nombre, descripcion, modulo, accion_tipo FROM permission ORDER BY modulo, accion_tipo, codigo');

  const porModulo = new Map<string, ModuloPermisos>();
  for (const r of rows) {
    let m = porModulo.get(r.modulo);
    if (!m) {
      m = { modulo: r.modulo, porAccion: { ver: [], editar: [], aprobar: [], administrar: [] } };
      porModulo.set(r.modulo, m);
    }
    m.porAccion[r.accion_tipo].push({
      codigo: r.codigo,
      nombre: r.nombre,
      descripcion: r.descripcion,
      modulo: r.modulo,
      accionTipo: r.accion_tipo,
    });
  }
  return [...porModulo.values()];
}

// =============================================================================
// ROLES
// =============================================================================

export interface FilaRol {
  id: string;
  codigo: string;
  nombre: string;
  descripcion: string;
  /** Rol global del sistema (los cinco de la sección 14.1) o propio de la firma. */
  esSistema: boolean;
  esTodopoderoso: boolean;
  activo: boolean;
  /** `false` en los roles globales: una firma no puede editar el rol de otra. */
  esDeLaFirma: boolean;
  permisos: string[];
  /** Cuántos accesos vigentes lo usan. Decide si se puede borrar. */
  usos: number;
}

export async function listarRoles(tx: SqlClient): Promise<FilaRol[]> {
  const ctx = await contexto(tx);
  const { rows } = await tx.query<{
    id: string;
    tenant_id: string | null;
    codigo: string;
    nombre: string;
    descripcion: string;
    es_sistema: boolean;
    es_todopoderoso: boolean;
    activo: boolean;
    permisos: string[] | null;
    usos: string;
  }>(
    `SELECT r.id, r.tenant_id, r.codigo, r.nombre, r.descripcion, r.es_sistema, r.es_todopoderoso, r.activo,
            (SELECT array_agg(rp.permission_codigo ORDER BY rp.permission_codigo)
               FROM role_permission rp WHERE rp.role_id = r.id) AS permisos,
            (SELECT count(*) FROM user_company_access uca
              WHERE uca.role_id = r.id AND uca.revocado_en IS NULL) AS usos
       FROM role r
      ORDER BY r.tenant_id NULLS FIRST, r.codigo`,
  );
  return rows.map((r) => ({
    id: r.id,
    codigo: r.codigo,
    nombre: r.nombre,
    descripcion: r.descripcion,
    esSistema: r.es_sistema,
    esTodopoderoso: r.es_todopoderoso,
    activo: r.activo,
    esDeLaFirma: r.tenant_id === ctx.tenantId,
    // Un rol todopoderoso lo puede TODO por definición, no por sus filas.
    permisos: r.es_todopoderoso ? ['(todos)'] : (r.permisos ?? []),
    usos: Number(r.usos),
  }));
}

export interface DatosRol {
  codigo: string;
  nombre: string;
  descripcion: string;
  permisos: readonly string[];
}

const CODIGO_ROL = /^[a-z][a-z0-9_]{2,39}$/;

/**
 * Crea un rol PROPIO de la firma con el conjunto de permisos que se le pase.
 *
 * Nunca crea roles globales ni todopoderosos: `tenant_id` sale de la sesión y
 * `es_todopoderoso` se deja en su valor por defecto (`false`), que además es lo
 * único que el trigger `role_blindaje` deja hacer desde una sesión.
 */
export async function crearRol(tx: SqlClient, input: DatosRol): Promise<{ id: string }> {
  await exigirPermiso(tx, PERMISOS.USUARIO_ADMINISTRAR);
  const ctx = await contexto(tx);
  const codigo = input.codigo.trim().toLowerCase();
  if (!CODIGO_ROL.test(codigo)) {
    throw new AdministracionInvalidaError(
      `"${input.codigo}" no sirve como código de rol: use minúsculas, números y guion bajo, entre 3 y 40 ` +
        'caracteres, empezando por letra. Ej.: "revisor", "junior_causacion".',
    );
  }
  if (!input.nombre.trim()) throw new AdministracionInvalidaError('El rol necesita un nombre legible.');
  if (!input.descripcion.trim()) {
    throw new AdministracionInvalidaError(
      'El rol necesita una descripción: dentro de un año, quien la lea tiene que poder saber para qué se creó.',
    );
  }

  const { rows: choca } = await tx.query<{ id: string }>(
    'SELECT id FROM role WHERE codigo = $1 AND tenant_id IS NOT DISTINCT FROM $2',
    [codigo, ctx.tenantId],
  );
  if (choca[0]) {
    throw new AdministracionInvalidaError(`Su firma ya tiene un rol con el código "${codigo}".`);
  }

  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO role (tenant_id, codigo, nombre, descripcion, es_sistema)
     VALUES ($1, $2, $3, $4, false) RETURNING id`,
    [ctx.tenantId, codigo, input.nombre.trim(), input.descripcion.trim()],
  );
  const id = rows[0]!.id;
  await fijarPermisosDeRol(tx, id, input.permisos);
  return { id };
}

async function cargarRol(tx: SqlClient, roleId: string) {
  const { rows } = await tx.query<{
    id: string;
    tenant_id: string | null;
    codigo: string;
    es_sistema: boolean;
    es_todopoderoso: boolean;
  }>('SELECT id, tenant_id, codigo, es_sistema, es_todopoderoso FROM role WHERE id = $1', [roleId]);
  const rol = rows[0];
  if (!rol) throw new RolNoEncontradoError(roleId);
  return rol;
}

/**
 * Reemplaza el conjunto de permisos de un rol. Se hace por diferencia (borrar
 * los que sobran, insertar los que faltan) y no borrando todo e insertando de
 * nuevo: así el `audit_log` registra solo lo que cambió de verdad, y no
 * cuarenta bajas y cuarenta altas cada vez que se toca una casilla.
 */
export async function fijarPermisosDeRol(
  tx: SqlClient,
  roleId: string,
  permisos: readonly string[],
): Promise<{ agregados: string[]; quitados: string[] }> {
  await exigirPermiso(tx, PERMISOS.USUARIO_ADMINISTRAR);
  const rol = await cargarRol(tx, roleId);

  if (rol.es_todopoderoso) {
    throw new RolBlindadoError(
      `El rol "${rol.codigo}" es el rol todopoderoso de la firma: tiene todos los permisos por definición y ` +
        'no se le pueden quitar. Para que alguien deje de poder todo, quítele ESE rol y déjele otro; el rol ' +
        'en sí no se degrada, porque si se pudiera, un clic dejaría a la firma sin nadie que otorgue permisos.',
    );
  }
  if (rol.tenant_id === null) {
    throw new RolBlindadoError(
      `El rol "${rol.codigo}" es uno de los cinco roles del sistema y lo comparten todas las firmas: sus ` +
        'permisos no se editan. Cree un rol propio con los permisos que necesite.',
    );
  }

  const pedidos = [...new Set(permisos.map((p) => p.trim()).filter((p) => p !== ''))];

  const { rows: validos } = await tx.query<{ codigo: string }>(
    'SELECT codigo FROM permission WHERE codigo = ANY($1::text[])',
    [pedidos],
  );
  const conocidos = new Set(validos.map((v) => v.codigo));
  const desconocidos = pedidos.filter((p) => !conocidos.has(p));
  if (desconocidos.length > 0) {
    throw new AdministracionInvalidaError(
      `Estos permisos no existen en el catálogo: ${desconocidos.join(', ')}. El catálogo de permisos lo fija ` +
        'el código del producto, no la firma: no se pueden inventar permisos nuevos desde esta pantalla.',
    );
  }

  const { rows: actuales } = await tx.query<{ permission_codigo: string }>(
    'SELECT permission_codigo FROM role_permission WHERE role_id = $1',
    [roleId],
  );
  const yaTiene = new Set(actuales.map((a) => a.permission_codigo));

  const agregados = pedidos.filter((p) => !yaTiene.has(p));
  const quitados = [...yaTiene].filter((p) => !conocidos.has(p) || !pedidos.includes(p));

  if (quitados.length > 0) {
    await tx.query('DELETE FROM role_permission WHERE role_id = $1 AND permission_codigo = ANY($2::text[])', [
      roleId,
      quitados,
    ]);
  }
  for (const codigo of agregados) {
    await tx.query('INSERT INTO role_permission (role_id, permission_codigo) VALUES ($1, $2)', [roleId, codigo]);
  }
  return { agregados, quitados };
}

export async function editarRol(
  tx: SqlClient,
  roleId: string,
  input: { nombre: string; descripcion: string; activo: boolean; permisos: readonly string[] },
): Promise<void> {
  await exigirPermiso(tx, PERMISOS.USUARIO_ADMINISTRAR);
  const rol = await cargarRol(tx, roleId);
  if (rol.tenant_id === null) {
    throw new RolBlindadoError(
      `El rol "${rol.codigo}" es global del sistema: lo comparten todas las firmas y no se edita desde aquí.`,
    );
  }
  await tx.query('UPDATE role SET nombre = $2, descripcion = $3, activo = $4, updated_at = now() WHERE id = $1', [
    roleId,
    input.nombre.trim(),
    input.descripcion.trim(),
    input.activo,
  ]);
  await fijarPermisosDeRol(tx, roleId, input.permisos);
}

/**
 * Elimina un rol propio de la firma. Si alguien lo tiene otorgado, NO se borra:
 * se inactiva. Borrarlo arrastraría en cascada sus `role_permission` y dejaría
 * a esos usuarios sin ningún rol de un golpe, sin que nadie lo pidiera.
 */
export async function eliminarRol(tx: SqlClient, roleId: string): Promise<{ borrado: boolean; usos: number }> {
  await exigirPermiso(tx, PERMISOS.USUARIO_ADMINISTRAR);
  const rol = await cargarRol(tx, roleId);
  if (rol.tenant_id === null || rol.es_sistema || rol.es_todopoderoso) {
    throw new RolBlindadoError(
      `El rol "${rol.codigo}" es del sistema y no se borra. Los roles del sistema se pueden dejar de usar, ` +
        'pero no desaparecen: hay accesos históricos que los referencian.',
    );
  }
  const { rows } = await tx.query<{ n: string }>(
    'SELECT count(*) AS n FROM user_company_access WHERE role_id = $1 AND revocado_en IS NULL',
    [roleId],
  );
  const usos = Number(rows[0]?.n ?? 0);
  if (usos > 0) {
    await tx.query('UPDATE role SET activo = false, updated_at = now() WHERE id = $1', [roleId]);
    return { borrado: false, usos };
  }
  await tx.query('DELETE FROM role_permission WHERE role_id = $1', [roleId]);
  await tx.query('DELETE FROM role WHERE id = $1', [roleId]);
  return { borrado: true, usos: 0 };
}

// =============================================================================
// EMPRESAS DE LA FIRMA (para administración de usuarios)
// =============================================================================

/**
 * D-092-bis — las empresas-cliente de la firma, para las pantallas de
 * administración de usuarios y permisos.
 *
 * POR QUÉ EXISTE Y NO SE USA `app.empresas_accesibles()` (migración 070): esa
 * función —la única vía que había para listar empresas— exige
 * `documento.leer`. Es correcto para lo suyo (es el insumo de la BANDEJA), pero
 * convierte a `documento.leer` en un requisito de facto para respirar: un
 * administrador acotado con SOLO `usuario.administrar` —el rol que la propia
 * pantalla `/admin/roles` describe como legítimo, y que D-092 hizo creable
 * desde la interfaz— se quedaba sin ninguna manera de saber a qué empresas
 * asignar a alguien.
 *
 * NO RELAJA NADA DEL MOTOR: `app.empresas_accesibles()` se queda como está.
 * Esta lectura tiene su propia puerta, `usuario.administrar`, y encima de la
 * RLS por tenant de `company` — que es la que impide de verdad ver la empresa
 * de otra firma (Regla de Oro 7). Tampoco revela nada nuevo: `listarUsuarios`,
 * con ese mismo permiso, ya devuelve `companyRazonSocial` de cada acceso.
 *
 * DIFERENCIA DE SEMÁNTICA, DECLARADA: devuelve las empresas de la FIRMA, no
 * «las mías». `user_company_access` tiene RLS estricta por empresa y en una
 * sesión de firma (sin empresa elegida) devuelve cero filas —por eso 070 tuvo
 * que ser `SECURITY DEFINER`—, así que en TypeScript no hay forma de resolver
 * «las mías» sin tocar el motor. Para administrar usuarios la lista de la firma
 * es además la correcta: se asigna acceso a empresas, no solo a las propias.
 * Por eso `rolCodigo` va vacío: aquí no hay un rol del que hablar.
 */
export async function listarEmpresasDeLaFirma(tx: SqlClient): Promise<EmpresaAccesible[]> {
  await exigirPermiso(tx, PERMISOS.USUARIO_ADMINISTRAR);
  const { rows } = await tx.query<{
    id: string;
    nit: string;
    razon_social: string;
    nombre_comercial: string | null;
  }>(
    `SELECT id, nit, razon_social, nombre_comercial
       FROM company
      WHERE estado = 'activa'
      ORDER BY razon_social`,
  );
  return rows.map((r) => ({
    companyId: r.id,
    nit: r.nit,
    razonSocial: r.razon_social,
    nombreComercial: r.nombre_comercial,
    rolCodigo: '',
  }));
}

// =============================================================================
// USUARIOS
// =============================================================================

export interface AccesoUsuario {
  accesoId: string;
  companyId: string;
  companyRazonSocial: string;
  roleId: string;
  rolCodigo: string;
  rolNombre: string;
  rolActivo: boolean;
  revocado: boolean;
}

export interface FilaUsuario {
  id: string;
  email: string;
  nombreCompleto: string;
  estado: 'activo' | 'suspendido' | 'invitado' | 'inactivo';
  mfaHabilitado: boolean;
  debeCambiarPassword: boolean;
  ultimoAccesoEn: string | null;
  accesos: AccesoUsuario[];
}

export async function listarUsuarios(tx: SqlClient): Promise<FilaUsuario[]> {
  const { rows } = await tx.query<{
    id: string;
    email: string;
    nombre_completo: string;
    estado: FilaUsuario['estado'];
    mfa_habilitado: boolean;
    debe_cambiar_password: boolean;
    ultimo_acceso_en: string | null;
  }>(
    `SELECT id, email, nombre_completo, estado, mfa_habilitado, debe_cambiar_password,
            ultimo_acceso_en::text
       FROM "user" ORDER BY estado, nombre_completo`,
  );

  const { rows: accesos } = await tx.query<{
    id: string;
    user_id: string;
    company_id: string;
    razon_social: string;
    role_id: string;
    rol_codigo: string;
    rol_nombre: string;
    rol_activo: boolean;
    revocado_en: string | null;
  }>(
    `SELECT uca.id, uca.user_id, uca.company_id, c.razon_social,
            uca.role_id, r.codigo AS rol_codigo, r.nombre AS rol_nombre, r.activo AS rol_activo,
            uca.revocado_en::text
       FROM user_company_access uca
       JOIN company c ON c.id = uca.company_id
       JOIN role r    ON r.id = uca.role_id
      ORDER BY c.razon_social, r.codigo`,
  );

  const porUsuario = new Map<string, AccesoUsuario[]>();
  for (const a of accesos) {
    const lista = porUsuario.get(a.user_id) ?? [];
    lista.push({
      accesoId: a.id,
      companyId: a.company_id,
      companyRazonSocial: a.razon_social,
      roleId: a.role_id,
      rolCodigo: a.rol_codigo,
      rolNombre: a.rol_nombre,
      rolActivo: a.rol_activo,
      revocado: a.revocado_en !== null,
    });
    porUsuario.set(a.user_id, lista);
  }

  return rows.map((u) => ({
    id: u.id,
    email: u.email,
    nombreCompleto: u.nombre_completo,
    estado: u.estado,
    mfaHabilitado: u.mfa_habilitado,
    debeCambiarPassword: u.debe_cambiar_password,
    ultimoAccesoEn: u.ultimo_acceso_en,
    accesos: porUsuario.get(u.id) ?? [],
  }));
}

export interface CrearUsuarioInput {
  email: string;
  nombreCompleto: string;
  documento?: string | null;
  /** Si falta, se genera una y se devuelve UNA sola vez. */
  password?: string | null;
  /** Acceso inicial. Sin él, el usuario entra y no ve ninguna empresa. */
  companyId?: string | null;
  roleId?: string | null;
}

export interface ResultadoCrearUsuario {
  userId: string;
  /** Solo si la generó el sistema. Se enseña una vez y no se vuelve a poder ver. */
  passwordGenerada: string | null;
}

/**
 * Crea un usuario de la firma en sesión.
 *
 * SIEMPRE queda con `debe_cambiar_password = true` (D-069). Quien crea al
 * usuario CONOCE su contraseña: si esa contraseña siguiera valiendo
 * indefinidamente, el administrador sería un suplantador permanente de
 * cualquiera de su firma, y ningún registro de auditoría podría distinguir al
 * uno del otro.
 */
export async function crearUsuario(
  tx: SqlClient,
  input: CrearUsuarioInput,
): Promise<ResultadoCrearUsuario> {
  await exigirPermiso(tx, PERMISOS.USUARIO_ADMINISTRAR);
  const ctx = await contexto(tx);

  const email = input.email.trim().toLowerCase();
  if (!CORREO.test(email)) {
    throw new AdministracionInvalidaError(`"${input.email}" no parece un correo válido.`);
  }
  if (!input.nombreCompleto.trim()) {
    throw new AdministracionInvalidaError('El usuario necesita un nombre completo: es lo que verá la auditoría.');
  }

  // `user.email` es único GLOBALMENTE (migración 002). Si el correo ya existe
  // —aunque sea en otra firma, que esta sesión NO puede ver por RLS— el INSERT
  // fallaría con un 23505 sin explicación. Se avisa antes, pero sin confirmar
  // a qué firma pertenece: eso sería filtrar la existencia de un usuario ajeno.
  const { rows: propio } = await tx.query<{ id: string }>('SELECT id FROM "user" WHERE email = $1', [email]);
  if (propio[0]) {
    throw new AdministracionInvalidaError(
      `Ya hay un usuario con el correo ${email} en su firma. Si está inactivo, reactívelo en vez de crear otro.`,
    );
  }

  const password = (input.password ?? '').trim() || generarPasswordInicial();
  exigirPasswordAceptable(password);
  const passwordGenerada = (input.password ?? '').trim() === '' ? password : null;
  const hash = await hashearPassword(password);

  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO "user" (tenant_id, email, nombre_completo, documento, password_hash,
                         password_algoritmo, password_actualizado_en, estado, debe_cambiar_password)
     VALUES ($1, $2, $3, $4, $5, $6, now(), 'activo', true)
     RETURNING id`,
    [ctx.tenantId, email, input.nombreCompleto.trim(), input.documento ?? null, hash, ALGORITMO_PASSWORD],
  );
  const userId = rows[0]!.id;

  if (input.companyId && input.roleId) {
    await asignarRol(tx, { userId, companyId: input.companyId, roleId: input.roleId });
  }

  return { userId, passwordGenerada };
}

/**
 * Activa o inactiva un usuario. NUNCA borra: ver la cabecera del archivo.
 *
 * Inactivar REVOCA sus sesiones abiertas en la misma transacción. Sin eso,
 * «inactivar» sería una etiqueta: la persona seguiría trabajando con la sesión
 * que ya tenía hasta que venciera, que es exactamente lo que un administrador
 * cree estar impidiendo cuando pulsa el botón.
 */
export async function cambiarEstadoUsuario(
  tx: SqlClient,
  userId: string,
  estado: 'activo' | 'inactivo' | 'suspendido',
): Promise<void> {
  await exigirPermiso(tx, PERMISOS.USUARIO_ADMINISTRAR);
  const ctx = await contexto(tx);
  if (userId === ctx.userId && estado !== 'activo') {
    throw new AdministracionInvalidaError(
      'No se puede inactivar a sí mismo. Si fuera el único administrador activo, la firma se quedaría sin ' +
        'nadie que pueda volver a activar a nadie.',
    );
  }

  const { rows } = await tx.query<{ id: string }>(
    'UPDATE "user" SET estado = $2, updated_at = now() WHERE id = $1 RETURNING id',
    [userId, estado],
  );
  if (!rows[0]) throw new UsuarioNoEncontradoError(userId);

  if (estado !== 'activo') {
    await tx.query('SELECT app.revocar_sesiones_de_usuario($1)', [userId]);
  }
}

/**
 * Le fija una contraseña a otro usuario y le obliga a cambiarla al entrar.
 *
 * Revoca todas sus sesiones: si no, la persona seguiría dentro con la sesión
 * anterior y el cambio de contraseña no serviría para echar a nadie — que es
 * la mitad de las veces por lo que se hace.
 */
export async function fijarPasswordDeUsuario(
  tx: SqlClient,
  userId: string,
  password?: string | null,
): Promise<{ passwordGenerada: string | null }> {
  await exigirPermiso(tx, PERMISOS.USUARIO_ADMINISTRAR);

  const nueva = (password ?? '').trim() || generarPasswordInicial();
  exigirPasswordAceptable(nueva);
  const passwordGenerada = (password ?? '').trim() === '' ? nueva : null;
  const hash = await hashearPassword(nueva);

  const { rows } = await tx.query<{ id: string }>(
    `UPDATE "user"
        SET password_hash = $2, password_algoritmo = $3, password_actualizado_en = now(),
            intentos_fallidos = 0, bloqueado_hasta = NULL, debe_cambiar_password = true,
            updated_at = now()
      WHERE id = $1
      RETURNING id`,
    [userId, hash, ALGORITMO_PASSWORD],
  );
  if (!rows[0]) throw new UsuarioNoEncontradoError(userId);

  await tx.query('SELECT app.revocar_sesiones_de_usuario($1)', [userId]);
  return { passwordGenerada };
}

/**
 * Fuerza el restablecimiento sin fijar contraseña: marca la bandera y echa las
 * sesiones. Se usa cuando se sospecha de una credencial pero no se le quiere
 * dictar la contraseña nueva por teléfono.
 */
export async function forzarRestablecimiento(tx: SqlClient, userId: string): Promise<void> {
  await exigirPermiso(tx, PERMISOS.USUARIO_ADMINISTRAR);
  const { rows } = await tx.query<{ id: string }>(
    'UPDATE "user" SET debe_cambiar_password = true, updated_at = now() WHERE id = $1 RETURNING id',
    [userId],
  );
  if (!rows[0]) throw new UsuarioNoEncontradoError(userId);
  await tx.query('SELECT app.revocar_sesiones_de_usuario($1)', [userId]);
}

// =============================================================================
// ASIGNACIÓN DE ROLES POR EMPRESA
// =============================================================================

export interface AsignarRolInput {
  userId: string;
  companyId: string;
  roleId: string;
}

/**
 * Otorga (o reactiva) un acceso de un usuario a una empresa con un rol.
 *
 * El acceso es por EMPRESA, no por firma: es la unidad del aislamiento
 * (D-021/D-022). Un rol otorgado sobre la empresa A no da nada sobre la B, y
 * `app.tiene_permiso` lo comprueba en cada llamada.
 */
export async function asignarRol(tx: SqlClient, input: AsignarRolInput): Promise<void> {
  await exigirPermiso(tx, PERMISOS.USUARIO_ADMINISTRAR);
  const ctx = await contexto(tx);

  /* D-092. La RLS de `user_company_access` (012, patrón tenant+company) solo
   * deja escribir filas de la empresa EN CONTEXTO. Hasta esta ficha, otorgar un
   * rol sobre otra empresa de la firma —que la pantalla ofrecía en el
   * desplegable, porque lista todas las accesibles— moría con un 42501 crudo de
   * RLS que `mensajeDeError` traducía a «falló por un problema técnico». El
   * comportamiento no cambia (sigue siendo la empresa la unidad del
   * aislamiento); lo que cambia es que ahora se dice por qué. */
  if (ctx.companyId && input.companyId !== ctx.companyId) {
    throw new AdministracionInvalidaError(
      'Solo se pueden otorgar accesos sobre la empresa que tiene activa: la empresa es la unidad del ' +
        'aislamiento, no un parámetro de la petición. Cámbiese a esa empresa en el selector de arriba y ' +
        'vuelva a intentarlo.',
    );
  }

  const rol = await cargarRol(tx, input.roleId);
  const { rows: activo } = await tx.query<{ activo: boolean }>('SELECT activo FROM role WHERE id = $1', [
    input.roleId,
  ]);
  if (activo[0]?.activo === false) {
    throw new AdministracionInvalidaError(
      `El rol "${rol.codigo}" está inactivo: no concede ningún permiso, así que otorgarlo no serviría de nada. ` +
        'Actívelo primero.',
    );
  }

  const { rows: existente } = await tx.query<{ id: string; revocado_en: string | null }>(
    'SELECT id, revocado_en::text FROM user_company_access WHERE company_id = $1 AND user_id = $2 AND role_id = $3',
    [input.companyId, input.userId, input.roleId],
  );
  if (existente[0]) {
    if (existente[0].revocado_en === null) return; // ya lo tiene, no se toca nada
    await tx.query('UPDATE user_company_access SET revocado_en = NULL, updated_at = now() WHERE id = $1', [
      existente[0].id,
    ]);
    return;
  }

  await tx.query(
    `INSERT INTO user_company_access (tenant_id, company_id, user_id, role_id, otorgado_por)
     VALUES ($1, $2, $3, $4, app.current_user_id())`,
    [ctx.tenantId, input.companyId, input.userId, input.roleId],
  );
}

/**
 * Revoca un acceso. No lo borra: la fila queda con `revocado_en`, para que
 * dentro de dos años se pueda responder «¿quién tenía acceso a esta empresa en
 * marzo?». Un DELETE haría esa pregunta incontestable.
 */
export async function revocarAcceso(tx: SqlClient, accesoId: string): Promise<void> {
  await exigirPermiso(tx, PERMISOS.USUARIO_ADMINISTRAR);
  const ctx = await contexto(tx);

  const { rows: acceso } = await tx.query<{ user_id: string }>(
    'SELECT user_id FROM user_company_access WHERE id = $1 AND revocado_en IS NULL',
    [accesoId],
  );
  if (!acceso[0]) {
    throw new AdministracionInvalidaError('Ese acceso no existe o ya estaba revocado.');
  }
  if (acceso[0].user_id === ctx.userId) {
    throw new AdministracionInvalidaError(
      'No se puede quitar a sí mismo el acceso a la empresa desde la que está administrando: se quedaría ' +
        'fuera de esta pantalla en el mismo clic. Pídaselo a otro administrador.',
    );
  }

  await tx.query('UPDATE user_company_access SET revocado_en = now(), updated_at = now() WHERE id = $1', [
    accesoId,
  ]);
}

export interface PermisoEfectivo {
  codigo: string;
  /** De dónde sale: del rol, de una excepción individual, o de los dos. */
  origen: 'rol' | 'rol_todopoderoso' | 'excepcion_individual' | 'rol_y_excepcion';
  /** Solo cuando lo aporta una excepción individual (D-092). */
  motivo: string | null;
  venceEn: string | null;
}

/**
 * Los permisos que un usuario PUEDE ejercer hoy, por empresa
 * (`v_user_permission_efectivo`, redefinida en 183).
 *
 * Ya no es una lista plana de códigos: cada permiso viene con su ORIGEN. La
 * pregunta que responde esta pantalla no es «¿qué puede hacer?» sino «¿por qué
 * puede hacerlo?», y un permiso que viene de una excepción individual —con su
 * motivo y su vencimiento— es justo el que no se deduce mirando el rol.
 */
export async function permisosEfectivosDe(
  tx: SqlClient,
  userId: string,
): Promise<
  Array<{
    companyId: string;
    rolCodigo: string;
    esTodopoderoso: boolean;
    permisos: PermisoEfectivo[];
  }>
> {
  const { rows } = await tx.query<{
    company_id: string;
    role_codigo: string;
    es_todopoderoso: boolean;
    permission_codigo: string;
    origen: PermisoEfectivo['origen'];
    excepcion_motivo: string | null;
    excepcion_vence_en: string | null;
  }>(
    `SELECT company_id, role_codigo, es_todopoderoso, permission_codigo, origen,
            excepcion_motivo, excepcion_vence_en::text
       FROM v_user_permission_efectivo
      WHERE user_id = $1
      ORDER BY role_codigo, permission_codigo`,
    [userId],
  );

  const porGrupo = new Map<
    string,
    { companyId: string; rolCodigo: string; esTodopoderoso: boolean; permisos: PermisoEfectivo[] }
  >();
  for (const r of rows) {
    const clave = `${r.company_id}|${r.role_codigo}`;
    let g = porGrupo.get(clave);
    if (!g) {
      g = {
        companyId: r.company_id,
        rolCodigo: r.role_codigo,
        esTodopoderoso: r.es_todopoderoso,
        permisos: [],
      };
      porGrupo.set(clave, g);
    }
    g.permisos.push({
      codigo: r.permission_codigo,
      origen: r.origen,
      motivo: r.excepcion_motivo,
      venceEn: r.excepcion_vence_en,
    });
  }
  return [...porGrupo.values()];
}

// =============================================================================
// PERMISO INDIVIDUAL POR USUARIO, POR ENCIMA DEL ROL (D-092, migración 183)
//
// `user_permission_override` es APPEND-ONLY: revocar una excepción no borra la
// fila que la otorgó, inserta una decisión nueva con su propio motivo. Por eso
// aquí no hay ninguna función `eliminarOverride`: no existe tal operación, y el
// trigger `user_permission_override_append_only` (PO003) la rechazaría igual si
// alguien la escribiera.
//
// Ninguna de estas funciones AUTORIZA nada. `usuario.administrar` lo exige el
// trigger de 016; el «no se concede lo que no se tiene» y el «no se asciende a
// sí mismo» los exige `user_permission_override_zz_blindaje` (PO001/PO002).
// Estas comprobaciones existen para dar un mensaje legible antes (D-025).
// =============================================================================

export interface FilaOverride {
  id: string;
  companyId: string;
  companyRazonSocial: string;
  userId: string;
  usuarioNombre: string;
  permisoCodigo: string;
  permisoNombre: string;
  efecto: 'otorgado' | 'revocado';
  motivo: string;
  venceEn: string | null;
  otorgadoPorNombre: string | null;
  otorgadoEn: string;
  /** `true` si esta fila es la que manda hoy para (usuario, empresa, permiso). */
  vigente: boolean;
}

const SQL_OVERRIDES = `
  SELECT o.id, o.company_id, c.razon_social, o.user_id, u.nombre_completo AS usuario_nombre,
         o.permission_codigo, p.nombre AS permiso_nombre, o.efecto, o.motivo,
         o.vence_en::text, o.otorgado_en::text, a.nombre_completo AS otorgado_por_nombre,
         (o.id = (SELECT o2.id
                    FROM user_permission_override o2
                   WHERE o2.user_id           = o.user_id
                     AND o2.company_id        = o.company_id
                     AND o2.permission_codigo = o.permission_codigo
                     AND o2.otorgado_en <= now()
                     AND (o2.vence_en IS NULL OR o2.vence_en > now())
                   ORDER BY o2.otorgado_en DESC, o2.id DESC
                   LIMIT 1)) AS vigente
    FROM user_permission_override o
    JOIN company c    ON c.id = o.company_id
    JOIN "user"  u    ON u.id = o.user_id
    JOIN permission p ON p.codigo = o.permission_codigo
    LEFT JOIN "user" a ON a.id = o.otorgado_por
`;

function aFilaOverride(r: {
  id: string;
  company_id: string;
  razon_social: string;
  user_id: string;
  usuario_nombre: string;
  permission_codigo: string;
  permiso_nombre: string;
  efecto: 'otorgado' | 'revocado';
  motivo: string;
  vence_en: string | null;
  otorgado_en: string;
  otorgado_por_nombre: string | null;
  vigente: boolean | null;
}): FilaOverride {
  return {
    id: r.id,
    companyId: r.company_id,
    companyRazonSocial: r.razon_social,
    userId: r.user_id,
    usuarioNombre: r.usuario_nombre,
    permisoCodigo: r.permission_codigo,
    permisoNombre: r.permiso_nombre,
    efecto: r.efecto,
    motivo: r.motivo,
    venceEn: r.vence_en,
    otorgadoPorNombre: r.otorgado_por_nombre,
    otorgadoEn: r.otorgado_en,
    vigente: r.vigente === true,
  };
}

/** Toda la cadena de decisiones de un usuario, la vigente y las históricas. */
export async function overridesDeUsuario(tx: SqlClient, userId: string): Promise<FilaOverride[]> {
  const { rows } = await tx.query<Parameters<typeof aFilaOverride>[0]>(
    `${SQL_OVERRIDES} WHERE o.user_id = $1 ORDER BY o.otorgado_en DESC, o.id DESC`,
    [userId],
  );
  return rows.map(aFilaOverride);
}

/** Las excepciones que MANDAN hoy en toda la firma. Es la lista que audita un revisor. */
export async function overridesVigentes(tx: SqlClient): Promise<FilaOverride[]> {
  const { rows } = await tx.query<Parameters<typeof aFilaOverride>[0]>(
    `${SQL_OVERRIDES}
      WHERE o.otorgado_en <= now()
        AND (o.vence_en IS NULL OR o.vence_en > now())
      ORDER BY o.otorgado_en DESC, o.id DESC`,
  );
  return rows.map(aFilaOverride).filter((f) => f.vigente);
}

export interface DecidirPermisoInput {
  userId: string;
  companyId: string;
  permisoCodigo: string;
  efecto: 'otorgado' | 'revocado';
  motivo: string;
  /** Solo para `otorgado`: fecha ISO (YYYY-MM-DD) en la que la excepción caduca. */
  venceEn?: string | null;
}

const MOTIVO_MINIMO = 10;

/**
 * Otorga o revoca un permiso individual a UN usuario sobre UNA empresa.
 *
 * El motivo es obligatorio y no es burocracia: es lo único que dentro de un año
 * distingue «se le dio porque el contador estaba incapacitado y había que
 * presentar la exógena» de «se le dio y nadie recuerda por qué». La longitud
 * mínima no garantiza calidad —nada la garantiza— pero corta el «x» que se
 * escribe para pasar de pantalla. La impone también el motor (`upo_motivo_ck`).
 */
export async function decidirPermisoIndividual(
  tx: SqlClient,
  input: DecidirPermisoInput,
): Promise<{ id: string }> {
  await exigirPermiso(tx, PERMISOS.USUARIO_ADMINISTRAR);
  const ctx = await contexto(tx);

  const motivo = input.motivo.trim();
  if (motivo.length < MOTIVO_MINIMO) {
    throw new AdministracionInvalidaError(
      'Toda excepción de permiso exige un motivo escrito (Regla de Oro 6): dentro de un año, quien lo lea ' +
        'tiene que poder saber por qué se concedió. Escriba al menos una frase.',
    );
  }
  if (input.efecto === 'otorgado' && input.userId === ctx.userId) {
    throw new AdministracionInvalidaError(
      'Nadie se concede a sí mismo un permiso que no tiene. Si de verdad lo necesita, pídaselo a otro ' +
        'administrador: así queda quién lo autorizó, y no solo quién lo usó.',
    );
  }

  const { rows: existe } = await tx.query<{ codigo: string }>(
    'SELECT codigo FROM permission WHERE codigo = $1',
    [input.permisoCodigo],
  );
  if (!existe[0]) {
    throw new AdministracionInvalidaError(
      `El permiso "${input.permisoCodigo}" no existe en el catálogo del producto. El catálogo lo fija el ` +
        'código, no la firma.',
    );
  }

  // Cortesía, no garantía (D-025): el motor lo vuelve a comprobar con PO002.
  if (input.efecto === 'otorgado' && !(await tienePermisoLaSesion(tx, input.permisoCodigo))) {
    throw new AdministracionInvalidaError(
      `No se puede conceder "${input.permisoCodigo}": su propia sesión no ejerce ese permiso. Administrar ` +
        'usuarios no equivale a tener todos los permisos del producto.',
    );
  }

  const venceEn = input.efecto === 'otorgado' ? (input.venceEn ?? null) || null : null;

  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO user_permission_override
       (tenant_id, company_id, user_id, permission_codigo, efecto, motivo, vence_en, otorgado_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7::date, app.current_user_id())
     RETURNING id`,
    [ctx.tenantId, input.companyId, input.userId, input.permisoCodigo, input.efecto, motivo, venceEn],
  );
  return { id: rows[0]!.id };
}

async function tienePermisoLaSesion(tx: SqlClient, codigo: string): Promise<boolean> {
  const { rows } = await tx.query<{ tiene: boolean }>('SELECT app.tiene_permiso($1) AS tiene', [codigo]);
  return rows[0]?.tiene === true;
}

// =============================================================================
// HISTORIAL DE CAMBIOS DE PERMISOS (D-092)
//
// POR QUÉ ES UN HISTORIAL PROPIO Y NO UNA FILA MÁS DEL DE CARGA MASIVA O EL DE
// REPORTES: aquellos leen UNA acción sobre UNA entidad (`CARGA_MASIVA`,
// `EXPORT`). La pregunta de este es «¿quién tocó los permisos de quién?», y esa
// respuesta está repartida en CINCO entidades distintas del mismo `audit_log`
// — `user_permission_override`, `user_company_access`, `role`,
// `role_permission` y `"user"`. Un historial por entidad obligaría a cruzar
// cinco pantallas para reconstruir un solo episodio.
//
// No se creó tabla nueva ni permiso nuevo: misma `audit_log` bajo RLS, mismo
// `auditoria.leer` que D-090 y D-091. La RLS de `audit_log` (012) es la única
// que aísla: aquí no hay ni un filtro de aplicación por tenant o empresa.
// =============================================================================

/** Las entidades del `audit_log` que responden «quién tocó los permisos de quién». */
export const ENTIDADES_DE_PERMISOS = [
  'user_permission_override',
  'user_company_access',
  'role',
  'role_permission',
  'user',
] as const;

export interface FilaHistorialPermisos {
  id: string;
  ocurridoEn: string;
  accion: string;
  entidad: string;
  entidadId: string | null;
  autorNombre: string | null;
  autorEmail: string | null;
  /** A quién le cambió algo, cuando la fila lo dice. */
  afectadoNombre: string | null;
  /** Resumen legible de lo que cambió, ya construido para la pantalla. */
  resumen: string;
  motivo: string | null;
}

export interface HistorialPermisosPagina {
  filas: FilaHistorialPermisos[];
  total: number;
  pagina: number;
  porPagina: number;
}

/** Mismo saneo defensivo que `listarHistorialCargaMasiva` (V-52): `NaN` incluido. */
function entero(valor: number | undefined, porDefecto: number, minimo: number, maximo: number): number {
  const n = Math.trunc(Number(valor ?? porDefecto));
  if (!Number.isFinite(n)) return porDefecto;
  return Math.min(maximo, Math.max(minimo, n));
}

interface FilaCruda {
  id: string;
  ocurrido_en: string;
  accion: string;
  entidad: string;
  entidad_id: string | null;
  autor_nombre: string | null;
  autor_email: string | null;
  afectado_nombre: string | null;
  valor_anterior: Record<string, unknown> | null;
  valor_nuevo: Record<string, unknown> | null;
}

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

function resumirCambio(r: FilaCruda): { resumen: string; motivo: string | null } {
  const nuevo = r.valor_nuevo ?? {};
  const viejo = r.valor_anterior ?? {};

  if (r.entidad === 'user_permission_override') {
    const efecto = texto(nuevo.efecto) === 'revocado' ? 'Revocó' : 'Otorgó';
    const vence = texto(nuevo.vence_en);
    return {
      resumen:
        `${efecto} el permiso individual «${texto(nuevo.permission_codigo) ?? '?'}»` +
        (vence ? ` (vence ${vence.slice(0, 10)})` : ''),
      motivo: texto(nuevo.motivo),
    };
  }
  if (r.entidad === 'user_company_access') {
    if (r.accion === 'INSERT') return { resumen: 'Otorgó un rol sobre una empresa', motivo: null };
    const antes = texto(viejo.revocado_en);
    const ahora = texto(nuevo.revocado_en);
    if (!antes && ahora) return { resumen: 'Revocó el acceso a una empresa', motivo: null };
    if (antes && !ahora) return { resumen: 'Reactivó un acceso revocado', motivo: null };
    return { resumen: 'Cambió un acceso a una empresa', motivo: null };
  }
  if (r.entidad === 'role_permission') {
    const codigo = texto(nuevo.permission_codigo) ?? texto(viejo.permission_codigo) ?? '?';
    return {
      resumen: r.accion === 'INSERT' ? `Añadió «${codigo}» a un rol` : `Quitó «${codigo}» de un rol`,
      motivo: null,
    };
  }
  if (r.entidad === 'role') {
    const codigo = texto(nuevo.codigo) ?? texto(viejo.codigo) ?? '?';
    if (r.accion === 'INSERT') return { resumen: `Creó el rol «${codigo}»`, motivo: null };
    if (r.accion === 'DELETE') return { resumen: `Eliminó el rol «${codigo}»`, motivo: null };
    if (viejo.activo === true && nuevo.activo === false) {
      return { resumen: `Inactivó el rol «${codigo}»`, motivo: null };
    }
    if (viejo.activo === false && nuevo.activo === true) {
      return { resumen: `Reactivó el rol «${codigo}»`, motivo: null };
    }
    return { resumen: `Editó el rol «${codigo}»`, motivo: null };
  }
  // "user": el trigger de 016 ya redactó las credenciales antes de escribir.
  const correo = texto(nuevo.email) ?? texto(viejo.email) ?? '?';
  if (r.accion === 'INSERT') return { resumen: `Creó el usuario ${correo}`, motivo: null };
  if (texto(viejo.estado) !== texto(nuevo.estado)) {
    return { resumen: `Cambió el estado de ${correo}: ${texto(viejo.estado)} → ${texto(nuevo.estado)}`, motivo: null };
  }
  if (viejo.password_hash !== nuevo.password_hash || nuevo.debe_cambiar_password === true) {
    return { resumen: `Restableció la contraseña de ${correo}`, motivo: null };
  }
  return { resumen: `Editó el usuario ${correo}`, motivo: null };
}

export async function listarHistorialDePermisos(
  tx: SqlClient,
  opciones: { pagina?: number; porPagina?: number } = {},
): Promise<HistorialPermisosPagina> {
  const pagina = entero(opciones.pagina, 1, 1, 1_000_000);
  const porPagina = entero(opciones.porPagina, 25, 1, 200);
  const offset = (pagina - 1) * porPagina;
  const entidades = [...ENTIDADES_DE_PERMISOS];

  const { rows: totalRows } = await tx.query<{ total: string }>(
    'SELECT count(*)::text AS total FROM audit_log WHERE entidad = ANY($1::text[])',
    [entidades],
  );

  const { rows } = await tx.query<FilaCruda>(
    `SELECT al.id::text,
            al.ocurrido_en::text,
            al.accion,
            al.entidad,
            al.entidad_id,
            autor.nombre_completo AS autor_nombre,
            autor.email           AS autor_email,
            afectado.nombre_completo AS afectado_nombre,
            al.valor_anterior,
            al.valor_nuevo
       FROM audit_log al
       LEFT JOIN "user" autor ON autor.id = al.user_id
       LEFT JOIN "user" afectado
              ON afectado.id = COALESCE(
                   NULLIF(al.valor_nuevo->>'user_id', '')::uuid,
                   NULLIF(al.valor_anterior->>'user_id', '')::uuid,
                   CASE WHEN al.entidad = 'user' THEN NULLIF(al.entidad_id, '')::uuid END)
      WHERE al.entidad = ANY($1::text[])
      ORDER BY al.ocurrido_en DESC, al.id DESC
      LIMIT $2 OFFSET $3`,
    [entidades, porPagina, offset],
  );

  return {
    filas: rows.map((r) => {
      const { resumen, motivo } = resumirCambio(r);
      return {
        id: r.id,
        ocurridoEn: r.ocurrido_en,
        accion: r.accion,
        entidad: r.entidad,
        entidadId: r.entidad_id,
        autorNombre: r.autor_nombre,
        autorEmail: r.autor_email,
        afectadoNombre: r.afectado_nombre,
        resumen,
        motivo,
      };
    }),
    total: Number(totalRows[0]?.total ?? '0'),
    pagina,
    porPagina,
  };
}

// =============================================================================
// APROBACIÓN JERÁRQUICA DE CORRECCIONES (D-068)
//
// «El junior corrige, el revisor aprueba» modelado como ESTADO del recurso, no
// como un permiso especial. El permiso (`documento.aprobar_correccion`) decide
// QUIÉN puede mover el estado; el estado vive en `document_correction.estado` y
// el motor de causación solo usa las correcciones 'aprobado'.
// =============================================================================

export interface CorreccionPendiente {
  id: string;
  sourceDocumentId: string;
  numeroDocumento: string;
  emisorNit: string;
  tipo: 'aiu_linea' | 'municipio_operacion';
  lineaNumero: number | null;
  valorAiuCentavos: string | null;
  municipioNombre: string | null;
  motivo: string;
  creadoPorNombre: string;
  creadoEn: string;
}

export async function listarCorreccionesPendientes(tx: SqlClient): Promise<CorreccionPendiente[]> {
  const { rows } = await tx.query<{
    id: string;
    source_document_id: string;
    numero_documento: string;
    emisor_nit: string;
    tipo: 'aiu_linea' | 'municipio_operacion';
    linea_numero: number | null;
    valor_aiu_centavos: string | null;
    municipio_nombre: string | null;
    motivo: string;
    creado_por_nombre: string;
    creado_en: string;
  }>(
    `SELECT dc.id, dc.source_document_id, sd.numero_documento, sd.emisor_nit,
            dc.tipo, dc.linea_numero, dc.valor_aiu_centavos::text,
            m.nombre AS municipio_nombre, dc.motivo,
            u.nombre_completo AS creado_por_nombre, dc.creado_en::text
       FROM document_correction dc
       JOIN source_document sd ON sd.id = dc.source_document_id
       JOIN "user" u ON u.id = dc.creado_por
       LEFT JOIN municipality m ON m.id = dc.municipio_operacion_id
      WHERE dc.estado = 'pendiente_revision'
      ORDER BY dc.creado_en`,
  );
  return rows.map((r) => ({
    id: r.id,
    sourceDocumentId: r.source_document_id,
    numeroDocumento: r.numero_documento,
    emisorNit: r.emisor_nit,
    tipo: r.tipo,
    lineaNumero: r.linea_numero,
    valorAiuCentavos: r.valor_aiu_centavos,
    municipioNombre: r.municipio_nombre,
    motivo: r.motivo,
    creadoPorNombre: r.creado_por_nombre,
    creadoEn: r.creado_en,
  }));
}

/**
 * Aprueba o rechaza una corrección pendiente.
 *
 * El permiso lo exige el trigger `document_correction_revision` (migración
 * 170) sobre el UPDATE del estado, no esta función: por eso un camino futuro
 * que escriba directamente en la tabla tampoco podrá saltárselo.
 */
export async function revisarCorreccion(
  tx: SqlClient,
  correccionId: string,
  decision: 'aprobado' | 'rechazado',
  motivo: string,
): Promise<void> {
  if (!motivo.trim()) {
    throw new AdministracionInvalidaError(
      'Toda revisión exige un motivo (Regla de Oro 6): quién revisó, qué decidió y por qué.',
    );
  }
  const { rows } = await tx.query<{ id: string }>(
    `UPDATE document_correction
        SET estado = $2, motivo_revision = $3
      WHERE id = $1 AND estado = 'pendiente_revision'
      RETURNING id`,
    [correccionId, decision, motivo.trim()],
  );
  if (!rows[0]) {
    throw new AdministracionInvalidaError(
      'Esa corrección no existe, no es visible para su sesión, o alguien la revisó antes que usted.',
    );
  }
}


// =============================================================================
// CAMBIO DE LA PROPIA CONTRASEÑA (D-069)
//
// Es la otra mitad de `fijarPasswordDeUsuario`. Sin esto, la bandera
// `debe_cambiar_password` sería decorativa: el administrador conocería para
// siempre la contraseña de la persona a la que se la fijó, y ningún registro de
// auditoría podría distinguir al uno del otro.
//
// NO EXIGE `usuario.administrar`: es la propia credencial. El trigger
// `trg_permiso_usuario` (migración 016) ya contempla explícitamente este caso —
// un usuario puede actualizar sus propias columnas de credencial— y por eso
// esta función no necesita ningún privilegio de administración.
// =============================================================================

export interface EstadoCredencial {
  userId: string;
  email: string;
  nombreCompleto: string;
  debeCambiarPassword: boolean;
}

export async function estadoDeMiCredencial(tx: SqlClient): Promise<EstadoCredencial | null> {
  const { rows } = await tx.query<{
    id: string;
    email: string;
    nombre_completo: string;
    debe_cambiar_password: boolean;
  }>(
    `SELECT id, email, nombre_completo, debe_cambiar_password
       FROM "user" WHERE id = app.current_user_id()`,
  );
  const u = rows[0];
  return u
    ? {
        userId: u.id,
        email: u.email,
        nombreCompleto: u.nombre_completo,
        debeCambiarPassword: u.debe_cambiar_password,
      }
    : null;
}

/**
 * Cambia la contraseña del usuario de la sesión.
 *
 * Se exige la ACTUAL aunque la sesión ya esté abierta: una sesión robada
 * (portátil sin bloquear, cookie filtrada) no debe poder convertirse en una
 * toma de control permanente de la cuenta. El coste para el usuario legítimo es
 * escribir una contraseña que acaba de usar.
 *
 * No se revocan las demás sesiones: quien cambia su propia contraseña por
 * higiene no espera que se le cierren las tres pestañas que tiene abiertas. Para
 * echar a alguien está `fijarPasswordDeUsuario`, que sí las revoca.
 */
export async function cambiarMiPassword(
  tx: SqlClient,
  passwordActual: string,
  passwordNueva: string,
): Promise<void> {
  const { rows } = await tx.query<{ id: string; password_hash: string | null; password_algoritmo: string | null }>(
    'SELECT id, password_hash, password_algoritmo FROM "user" WHERE id = app.current_user_id()',
  );
  const u = rows[0];
  if (!u) throw new AdministracionInvalidaError('No hay usuario en la sesión.');
  if (!u.password_hash) {
    throw new AdministracionInvalidaError(
      'Su usuario no tiene contraseña configurada. Pídale al administrador de la firma que se la fije.',
    );
  }

  const correcta = await verificarPassword(passwordActual, u.password_hash);
  if (!correcta) {
    throw new AdministracionInvalidaError('La contraseña actual no es correcta.');
  }
  if (passwordNueva === passwordActual) {
    throw new AdministracionInvalidaError(
      'La contraseña nueva es igual a la actual. Si se la fijó un administrador, él la conoce: elija otra.',
    );
  }
  exigirPasswordAceptable(passwordNueva);

  const hash = await hashearPassword(passwordNueva);
  await tx.query(
    `UPDATE "user"
        SET password_hash = $2, password_algoritmo = $3, password_actualizado_en = now(),
            debe_cambiar_password = false, updated_at = now()
      WHERE id = $1`,
    [u.id, hash, ALGORITMO_PASSWORD],
  );
}

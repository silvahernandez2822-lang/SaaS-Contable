/**
 * A13 — Aprovisionamiento del canal de correo (Ola 2, sección 13.3 / V-9).
 *
 * Tres pasos para que una firma active el canal de correo:
 *
 *   1. `crearUsuarioSistemaIngesta` — una fila real en "user" por firma, sin
 *      contraseña, con el rol de negocio `sistema_ingesta` (permiso mínimo:
 *      documento.leer + documento.cargar, migración 090). `"user"` tiene RLS
 *      de TENANT (no de empresa: la tabla ni siquiera tiene `company_id`),
 *      así que esto corre con cualquier sesión de la firma, con o sin
 *      empresa elegida.
 *   2. `sincronizarAccesoEmpresaIngesta` — le da a ese usuario acceso
 *      (`user_company_access`) a la empresa YA ELEGIDA en la sesión (`tx`).
 *      `user_company_access` tiene RLS de tenant+EMPRESA estricta
 *      (D-021/D-022): una sola sesión no puede escribir el acceso de varias
 *      empresas a la vez, ni aunque sean de la misma firma — es EL MISMO
 *      límite que ya resolvió A7 para la bandeja multi-empresa
 *      (`docs/reportes/ola2-a7.md`: "una sesión por empresa, agregadas en
 *      una sola pantalla"). Por eso esta función es deliberadamente de
 *      UNA empresa, no de "todas": cubrir las 30-60 empresas de una firma es
 *      orquestación de `app/` (`app/lib/integraciones.ts`), que abre, una
 *      por una, una sesión real por empresa con el MISMO token del
 *      administrador — igual que `app/lib/bandeja.ts` de A7.
 *   3. `crearTokenIntegracion` (`./token.ts`) — el secreto que n8n presenta
 *      en el webhook. Es de FIRMA, no de empresa: no hace falta repetirlo
 *      por empresa.
 *
 * `provisionarCanalIngestaCorreo` encadena las tres para la empresa que la
 * sesión tenga elegida en ese momento (o ninguna, si es una sesión de
 * firma — en ese caso el paso 2 no sincroniza nada y el token queda emitido
 * igual: `app/lib/integraciones.ts` es quien completa la cobertura
 * multi-empresa). Todo corre en una sesión NORMAL ya autenticada (D-021): un
 * humano con `usuario.administrar`, nunca el propio canal de correo se
 * aprovisiona a sí mismo.
 */
import type { SqlClient } from '../db/types.js';
import { exigirPermiso, PERMISOS } from '../auth/permisos.js';
import { crearTokenIntegracion, type CanalIntegracion, type TokenIntegracionEmitido } from './token.js';

const ROL_SISTEMA_INGESTA_CODIGO = 'sistema_ingesta';

async function idRolSistemaIngesta(tx: SqlClient): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    'SELECT id FROM role WHERE codigo = $1 AND tenant_id IS NULL',
    [ROL_SISTEMA_INGESTA_CODIGO],
  );
  const fila = rows[0];
  if (!fila) {
    throw new Error(
      `No existe el rol de sistema "${ROL_SISTEMA_INGESTA_CODIGO}" (migración 090). ¿Falta aplicar la migración?`,
    );
  }
  return fila.id;
}

/** Correo técnico, único por firma y canal. Nunca se usa para iniciar sesión humana (sin password_hash). */
function correoTecnico(tenantId: string, canal: CanalIntegracion): string {
  return `sistema.ingesta.${canal}+${tenantId}@integraciones.interno`.toLowerCase();
}

/**
 * Crea (o reutiliza si ya existe) el usuario de sistema del canal indicado
 * para la firma en sesión. Exige `usuario.administrar`: la base lo vuelve a
 * exigir con el trigger de permiso de `"user"` (migración 016), esto solo da
 * un mensaje temprano.
 */
export async function crearUsuarioSistemaIngesta(
  tx: SqlClient,
  input: { tenantId: string; canal: CanalIntegracion },
): Promise<string> {
  await exigirPermiso(tx, PERMISOS.USUARIO_ADMINISTRAR);
  const email = correoTecnico(input.tenantId, input.canal);

  const { rows: existente } = await tx.query<{ id: string }>(
    'SELECT id FROM "user" WHERE email = $1',
    [email],
  );
  if (existente[0]) return existente[0].id;

  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO "user" (tenant_id, email, nombre_completo, estado)
     VALUES ($1, $2, $3, 'activo')
     RETURNING id`,
    [input.tenantId, email, `Sistema — ingesta de ${input.canal}`],
  );
  return rows[0]!.id;
}

/**
 * Lista las empresas ACTIVAS de la firma en sesión. Funciona con o sin
 * empresa elegida: `company` tiene RLS de TENANT (`instalar_rls_tenant`,
 * 012_rls.sql), no de tenant+empresa, así que una sesión "de firma" (sin
 * `companyId`) ya ve todas las suyas — es el mismo hecho que hace innecesario
 * usar `app.resolver_empresa_por_buzon` en `./ingest-correo.ts` (ver su
 * cabecera).
 */
export async function listarEmpresasActivasDeLaFirma(
  tx: SqlClient,
  tenantId: string,
): Promise<{ id: string; razonSocial: string }[]> {
  const { rows } = await tx.query<{ id: string; razon_social: string }>(
    `SELECT id, razon_social FROM company WHERE tenant_id = $1 AND estado = 'activa' ORDER BY razon_social`,
    [tenantId],
  );
  return rows.map((r) => ({ id: r.id, razonSocial: r.razon_social }));
}

/**
 * Da acceso al usuario de sistema sobre la empresa que la sesión (`tx`) YA
 * TIENE elegida (`app.current_company_id()`). Segura de repetir: `ON
 * CONFLICT DO NOTHING`. Si la sesión es "de firma" (sin empresa elegida), no
 * hace nada y lo dice (`false`) — nunca intenta adivinar una empresa.
 */
export async function sincronizarAccesoEmpresaIngesta(
  tx: SqlClient,
  input: { userId: string },
): Promise<boolean> {
  await exigirPermiso(tx, PERMISOS.USUARIO_ADMINISTRAR);
  const roleId = await idRolSistemaIngesta(tx);

  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO user_company_access (tenant_id, company_id, user_id, role_id)
     SELECT app.current_tenant_id(), app.current_company_id(), $1, $2
      WHERE app.current_company_id() IS NOT NULL
     ON CONFLICT (company_id, user_id, role_id) DO NOTHING
     RETURNING id`,
    [input.userId, roleId],
  );
  return rows.length > 0;
}

export interface CanalIngestaProvisionado extends TokenIntegracionEmitido {
  userId: string;
  /** `true` si la sesión tenía una empresa elegida y se le dio acceso. Para cubrir el resto, ver `app/lib/integraciones.ts`. */
  empresaEnSesionSincronizada: boolean;
}

/**
 * Los tres pasos encadenados, para la empresa (si la hay) de la sesión en
 * curso. Cubrir las demás empresas de una firma con 30-60 es orquestación de
 * `app/lib/integraciones.ts` (una sesión por empresa, mismo token — igual
 * que la bandeja multi-empresa de A7), no de este archivo.
 */
export async function provisionarCanalIngestaCorreo(
  tx: SqlClient,
  input: { tenantId: string; nombreToken?: string },
): Promise<CanalIngestaProvisionado> {
  const canal: CanalIntegracion = 'correo';
  const userId = await crearUsuarioSistemaIngesta(tx, { tenantId: input.tenantId, canal });
  const empresaEnSesionSincronizada = await sincronizarAccesoEmpresaIngesta(tx, { userId });
  const emitido = await crearTokenIntegracion(tx, {
    userId,
    canal,
    nombre: input.nombreToken ?? 'Canal de correo (n8n)',
  });
  return { ...emitido, userId, empresaEnSesionSincronizada };
}

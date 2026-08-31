/**
 * Arranque del sistema — Agente A12.
 *
 * PROBLEMA. Hasta hoy no había forma de crear la primera firma, su primera
 * empresa-cliente y su usuario administrador sin escribir SQL a mano. El
 * producto era inarrancable.
 *
 * POR QUÉ ESTO ES UN COMANDO DE OPERADOR Y NO UNA RUTA HTTP. El arranque toca
 * la RAÍZ del modelo de aislamiento: crea el `tenant`. D-020/D-021 establecen
 * que el contexto de tenant se deriva SIEMPRE de un token de sesión verificado
 * y nunca de un dato que el cliente elija. Cualquier endpoint que cree tenants
 * sería, por definición, un escritor sin sesión sobre la raíz del aislamiento:
 * exactamente la clase de agujero que D-021 cerró. Se descartaron, y por qué:
 *
 *   (a) Endpoint público de registro — un escritor anónimo en la raíz del
 *       aislamiento. Además el mega-prompt no pide autoservicio.
 *   (b) Ruta protegida por un secreto de despliegue — deja una puerta HTTP viva
 *       para siempre cuya única defensa es una cadena en una variable de
 *       entorno, que se filtra por logs, por un proxy o por un volcado de
 *       configuración. Y, sobre todo, obligaría al proceso web a ejecutar
 *       `withAdminContext`, que hoy está prohibido de forma explícita (D-004,
 *       documentado en `app/lib/db.ts`): sería romper un invariante que ha
 *       aguantado todo el proyecto para ganar comodidad una sola vez.
 *   (c) "Solo funciona si la base está vacía" — un control que se auto-desactiva
 *       y cuya comprobación es una condición de carrera. Aquí sobrevive como
 *       guarda ADICIONAL (`soloSiVacio`), nunca como el mecanismo.
 *
 * MECANISMO ELEGIDO: un comando de línea de órdenes que corre con la MISMA
 * credencial privilegiada que ya exigen `npm run migrate` y `npm run seed`
 * (superusuario / dueño del esquema / BYPASSRLS, D-015). El argumento de
 * seguridad es que NO CREA NINGUNA VÍA DE CONFIANZA NUEVA: quien puede
 * ejecutarlo ya podía hacer exactamente lo mismo con tres `INSERT`. Lo único
 * que aporta es que esos INSERT queden bien hechos (hash de contraseña
 * correcto, rol correcto, acceso por empresa correcto) en vez de a mano.
 * Superficie de red añadida: cero.
 *
 * DESPUÉS DEL ARRANQUE NO HAY ATAJO. El comando NO emite sesión ni cookie: deja
 * un usuario con contraseña, y ese usuario entra por `/entrar` como cualquier
 * otro, pasando por `iniciarSesion` -> `app.abrir_sesion` con el rol `app_auth`.
 * `withSessionContext` no se entera de que este archivo existe.
 *
 * QUÉ PASA SI SE INVOCA DOS VECES, O CON DATOS YA CARGADOS. Es idempotente por
 * clave de negocio, no por "base vacía": busca la firma por NIT, la empresa por
 * (firma, NIT) y el usuario por correo. Lo que ya existe se reporta y NO se
 * modifica. En particular JAMÁS reescribe la contraseña de un usuario que ya
 * existe: si lo hiciera, reejecutar el arranque sería una primitiva de toma de
 * control de la cuenta administradora de una firma viva. Para ese caso hay que
 * pasar `rotarPassword: true`, que es una decisión explícita del operador y
 * queda en `audit_log` como el UPDATE sobre `"user"` que es (con la credencial
 * redactada, D-029).
 */
import { randomBytes } from 'node:crypto';
import { withAdminContext } from '../db/tenant-context';
import type { SqlClient } from '../db/types';
import { ALGORITMO_PASSWORD, exigirPasswordAceptable, hashearPassword } from '../auth/password';
import { ROLES } from '../auth/permisos';

export class ArranqueError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ArranqueError';
  }
}

export interface OpcionesArranque {
  firmaNit: string;
  firmaRazonSocial: string;
  firmaEmailContacto?: string | null;
  empresaNit: string;
  empresaRazonSocial: string;
  /** Dígito de verificación del NIT de la empresa, si se conoce. */
  empresaDigitoVerificacion?: number | null;
  adminEmail: string;
  adminNombre: string;
  /** Si falta, se genera una contraseña fuerte y se devuelve una sola vez. */
  adminPassword?: string | null;
  /** Reescribe la contraseña de un usuario que ya existía. Decisión explícita. */
  rotarPassword?: boolean;
  /** Guarda adicional: aborta si ya hay alguna firma creada. */
  soloSiVacio?: boolean;
}

export interface ResultadoArranque {
  tenantId: string;
  companyId: string;
  userId: string;
  /** Solo si el arranque la generó en esta ejecución. Se muestra una vez. */
  passwordGenerada: string | null;
  creado: { firma: boolean; empresa: boolean; usuario: boolean; acceso: boolean };
}

/** Contraseña aleatoria de 192 bits en base64url: 32 caracteres imprimibles. */
export function generarPasswordInicial(): string {
  return randomBytes(24).toString('base64url');
}

function exigirTexto(valor: string | null | undefined, campo: string): string {
  const v = (valor ?? '').trim();
  if (v === '') throw new ArranqueError(`Falta ${campo}.`);
  return v;
}

function exigirNit(valor: string | null | undefined, campo: string): string {
  const v = exigirTexto(valor, campo).replace(/[.\s-]/g, '');
  if (!/^\d{5,15}$/.test(v)) {
    throw new ArranqueError(
      `${campo} debe ser un número de 5 a 15 dígitos; llegó ${JSON.stringify(valor)}.`,
    );
  }
  return v;
}

function exigirEmail(valor: string | null | undefined, campo: string): string {
  const v = exigirTexto(valor, campo).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
    throw new ArranqueError(`${campo} no parece un correo válido: ${JSON.stringify(valor)}.`);
  }
  return v;
}

/**
 * Crea (o reconoce) la primera firma, su primera empresa-cliente y su usuario
 * administrador de firma con acceso a esa empresa.
 *
 * Corre entero dentro de `withAdminContext`: una sola transacción, todo o nada.
 */
export async function arrancar(
  db: SqlClient,
  opciones: OpcionesArranque,
): Promise<ResultadoArranque> {
  const firmaNit = exigirNit(opciones.firmaNit, 'el NIT de la firma');
  const firmaRazonSocial = exigirTexto(opciones.firmaRazonSocial, 'la razón social de la firma');
  const empresaNit = exigirNit(opciones.empresaNit, 'el NIT de la empresa-cliente');
  const empresaRazonSocial = exigirTexto(
    opciones.empresaRazonSocial,
    'la razón social de la empresa-cliente',
  );
  const adminEmail = exigirEmail(opciones.adminEmail, 'el correo del administrador');
  const adminNombre = exigirTexto(opciones.adminNombre, 'el nombre del administrador');
  const firmaEmail = opciones.firmaEmailContacto
    ? exigirEmail(opciones.firmaEmailContacto, 'el correo de contacto de la firma')
    : adminEmail;

  // La contraseña se valida ANTES de tocar la base: no se crea media firma para
  // luego morir por una contraseña corta.
  const passwordPedida = (opciones.adminPassword ?? '').trim();
  if (passwordPedida !== '') exigirPasswordAceptable(passwordPedida);

  return withAdminContext(db, async (tx) => {
    if (opciones.soloSiVacio === true) {
      const { rows } = await tx.query<{ n: string | number }>('SELECT count(*) AS n FROM tenant');
      if (Number(rows[0]?.n ?? 0) > 0) {
        throw new ArranqueError(
          'Se pidió arrancar solo con la base vacía y ya existe al menos una firma. No se tocó nada.',
        );
      }
    }

    // ---- Firma -------------------------------------------------------------
    const { rows: firmaExistente } = await tx.query<{ id: string }>(
      'SELECT id FROM tenant WHERE nit = $1',
      [firmaNit],
    );
    let tenantId = firmaExistente[0]?.id ?? null;
    const creoFirma = tenantId === null;
    if (tenantId === null) {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO tenant (nit, razon_social, email_contacto)
         VALUES ($1, $2, $3) RETURNING id`,
        [firmaNit, firmaRazonSocial, firmaEmail],
      );
      tenantId = rows[0]!.id;
    }

    // ---- Empresa-cliente ---------------------------------------------------
    const { rows: empresaExistente } = await tx.query<{ id: string }>(
      'SELECT id FROM company WHERE tenant_id = $1 AND nit = $2',
      [tenantId, empresaNit],
    );
    let companyId = empresaExistente[0]?.id ?? null;
    const creoEmpresa = companyId === null;
    if (companyId === null) {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO company (tenant_id, nit, digito_verificacion, razon_social)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [tenantId, empresaNit, opciones.empresaDigitoVerificacion ?? null, empresaRazonSocial],
      );
      companyId = rows[0]!.id;
    }

    // ---- Usuario administrador de firma ------------------------------------
    const { rows: usuarioExistente } = await tx.query<{ id: string; tenant_id: string }>(
      'SELECT id, tenant_id FROM "user" WHERE email = $1',
      [adminEmail],
    );
    const yaEstaba = usuarioExistente[0];

    if (yaEstaba && yaEstaba.tenant_id !== tenantId) {
      // `user.email` es único GLOBALMENTE (002). Si el correo pertenece a otra
      // firma, adoptarlo aquí sería mover un usuario entre tenants: ni por
      // asomo. Se aborta sin tocar nada.
      throw new ArranqueError(
        `El correo ${adminEmail} ya pertenece a un usuario de OTRA firma. ` +
          'Use un correo distinto: un usuario nunca cambia de firma.',
      );
    }

    let passwordGenerada: string | null = null;
    let userId: string;
    const creoUsuario = yaEstaba === undefined;

    if (yaEstaba === undefined) {
      const password = passwordPedida !== '' ? passwordPedida : generarPasswordInicial();
      passwordGenerada = passwordPedida !== '' ? null : password;
      const hash = await hashearPassword(password);
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO "user" (tenant_id, email, nombre_completo, password_hash,
                             password_algoritmo, password_actualizado_en, estado)
         VALUES ($1, $2, $3, $4, $5, now(), 'activo') RETURNING id`,
        [tenantId, adminEmail, adminNombre, hash, ALGORITMO_PASSWORD],
      );
      userId = rows[0]!.id;
    } else {
      userId = yaEstaba.id;
      if (opciones.rotarPassword === true) {
        const password = passwordPedida !== '' ? passwordPedida : generarPasswordInicial();
        passwordGenerada = passwordPedida !== '' ? null : password;
        const hash = await hashearPassword(password);
        await tx.query(
          `UPDATE "user"
              SET password_hash = $2, password_algoritmo = $3,
                  password_actualizado_en = now(), intentos_fallidos = 0,
                  bloqueado_hasta = NULL, estado = 'activo'
            WHERE id = $1`,
          [userId, hash, ALGORITMO_PASSWORD],
        );
        // Rotar la contraseña invalida lo que se hubiera abierto con la anterior.
        await tx.query('SELECT app.revocar_sesiones_de_usuario($1)', [userId]);
      }
    }

    // ---- Acceso a la empresa con el rol de administrador de firma ----------
    const { rows: accesoExistente } = await tx.query<{ id: string }>(
      `SELECT id FROM user_company_access
        WHERE company_id = $1 AND user_id = $2 AND role_id = $3`,
      [companyId, userId, ROLES.ADMIN_FIRMA],
    );
    const creoAcceso = accesoExistente.length === 0;
    if (creoAcceso) {
      await tx.query(
        `INSERT INTO user_company_access (tenant_id, company_id, user_id, role_id)
         VALUES ($1, $2, $3, $4)`,
        [tenantId, companyId, userId, ROLES.ADMIN_FIRMA],
      );
    } else {
      // Si estaba revocado, se reactiva: el arranque debe dejar al operador
      // dentro, y a este camino solo llega quien ya tiene la credencial
      // privilegiada de la base.
      await tx.query(
        `UPDATE user_company_access SET revocado_en = NULL
          WHERE company_id = $1 AND user_id = $2 AND role_id = $3 AND revocado_en IS NOT NULL`,
        [companyId, userId, ROLES.ADMIN_FIRMA],
      );
    }

    return {
      tenantId,
      companyId,
      userId,
      passwordGenerada,
      creado: { firma: creoFirma, empresa: creoEmpresa, usuario: creoUsuario, acceso: creoAcceso },
    };
  });
}

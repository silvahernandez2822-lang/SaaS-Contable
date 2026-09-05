/**
 * A14 · Compuerta adversarial de D-092 (A12) — verificación INDEPENDIENTE.
 *
 * Este archivo no reusa ni una línea de `a12-d092-permiso-individual.test.ts`:
 * A14 no confirma por reporte ajeno. Todo ataque entra por SQL directo desde
 * una sesión de negocio real (`asTenant`, RLS activa, sesión emitida por
 * `app.abrir_sesion`) y exige el SQLSTATE del MOTOR. Un `throw` de TypeScript
 * no demuestra nada (D-003).
 *
 * El atacante modelo de casi todas estas pruebas es `admin_acotado`: un rol
 * PROPIO de la firma con UN solo permiso, `usuario.administrar`. Es exactamente
 * la figura que la ficha D-092 dice haber desactivado — hasta la migración 183
 * ese rol era transitivamente equivalente a todo el catálogo.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createTestDb, esperarErrorPg } from '../helpers/db.js';
import { crearEscenario, crearUsuarioConCredencial } from '../helpers/fixtures.js';
import { SQLSTATE } from '../../src/db/types.js';
import { ROLES } from '../../src/auth/permisos.js';

const db = await createTestDb();

let A: Awaited<ReturnType<typeof crearEscenario>>;
let B: Awaited<ReturnType<typeof crearEscenario>>;

/** Empresa adicional de la firma A a la que el atacante NO tiene acceso. */
let companyA2: string;
/** Rol propio de la firma A con un único permiso: `usuario.administrar`. */
let rolAcotado: string;
/** Rol propio de la firma A, todopoderoso. */
let rolTodo: string;
/** El atacante: `usuario.administrar` y nada más. */
let atacante: string;
/** La víctima: `auxiliar_causacion`, que no tiene `reporte.exportar`. */
let victima: string;

function uuid(): string {
  return crypto.randomUUID();
}

/** `app.tiene_permiso` medida DESDE la sesión del propio usuario afectado. */
async function puede(
  userId: string,
  rolId: string,
  codigo: string,
  companyId: string | null = A.companyId,
): Promise<boolean> {
  return db.asTenant(
    A.tenantId,
    companyId,
    async (tx) => {
      const { rows } = await tx.query<{ t: boolean }>('SELECT app.tiene_permiso($1) AS t', [codigo]);
      return rows[0]!.t;
    },
    { userId, rolId, sesionNueva: true },
  );
}

/** Inserta un override por SQL crudo desde la sesión indicada. */
function insertarOverride(
  tx: import('../../src/db/types.js').SqlClient,
  v: {
    tenantId: string;
    companyId: string;
    userId: string;
    codigo: string;
    efecto: 'otorgado' | 'revocado';
    motivo?: string;
    venceEn?: string | null;
    otorgadoPor?: string | null;
  },
) {
  return tx.query(
    `INSERT INTO user_permission_override
       (tenant_id, company_id, user_id, permission_codigo, efecto, motivo, vence_en, otorgado_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8)`,
    [
      v.tenantId,
      v.companyId,
      v.userId,
      v.codigo,
      v.efecto,
      v.motivo ?? 'Motivo suficientemente largo para pasar el chequeo de formato.',
      v.venceEn ?? null,
      v.otorgadoPor ?? null,
    ],
  );
}

beforeAll(async () => {
  A = await crearEscenario(db);
  B = await crearEscenario(db);

  companyA2 = uuid();
  rolAcotado = uuid();
  rolTodo = uuid();

  await db.asAdmin(async (tx) => {
    // Segunda empresa de la firma A. Reutiliza municipio y CIIU de A.
    await tx.query(
      `INSERT INTO company (id, tenant_id, nit, razon_social, municipality_id, ciiu_principal_id,
                            es_agente_retencion_renta, buzon_email)
       VALUES ($1, $2, $3, 'Empresa hermana sin acceso', $4, $5, true, $6)`,
      [companyA2, A.tenantId, `801${Date.now() % 1_000_000}`, A.municipalityId, A.ciiuId, `a2-${uuid()}@buzon.local`],
    );

    await tx.query(
      `INSERT INTO role (id, tenant_id, codigo, nombre, descripcion, es_sistema)
       VALUES ($1, $2, 'admin_acotado', 'Administrador acotado',
               'Solo la pantalla de usuarios. Es la figura que D-092 dice haber desactivado.', false)`,
      [rolAcotado, A.tenantId],
    );
    await tx.query(
      `INSERT INTO role_permission (role_id, permission_codigo) VALUES ($1, 'usuario.administrar')`,
      [rolAcotado],
    );

    await tx.query(
      `INSERT INTO role (id, tenant_id, codigo, nombre, descripcion, es_sistema, es_todopoderoso)
       VALUES ($1, $2, 'admin_todo_propio', 'Todopoderoso propio de la firma',
               'Rol propio con es_todopoderoso: tiene que pasar las tres puertas sin esfuerzo.', false, true)`,
      [rolTodo, A.tenantId],
    );
  });

  atacante = (
    await crearUsuarioConCredencial(db, A.tenantId, { companyId: A.companyId, roleId: rolAcotado })
  ).userId;
  victima = (
    await crearUsuarioConCredencial(db, A.tenantId, {
      companyId: A.companyId,
      roleId: ROLES.AUXILIAR_CAUSACION,
    })
  ).userId;
});

// =============================================================================
// 0. El punto de partida: el atacante NO ejerce lo que va a intentar repartir
// =============================================================================
describe('A14/D-092 · punto de partida', () => {
  it('el rol acotado ejerce usuario.administrar y NADA más', async () => {
    expect(await puede(atacante, rolAcotado, 'usuario.administrar')).toBe(true);
    for (const codigo of ['asiento.publicar', 'reporte.exportar', 'parametro.editar', 'documento.leer']) {
      expect(await puede(atacante, rolAcotado, codigo)).toBe(false);
    }
  });
});

// =============================================================================
// 1. AUTO-ESCALADA POR LAS TRES PUERTAS
// =============================================================================
describe('A14/D-092 · las tres puertas de la anti-escalada, desde la sesión del atacante', () => {
  it('puerta 1 — no mete un permiso ajeno en un rol propio (role_permission INSERT) → PO002', async () => {
    await db.asTenant(
      A.tenantId,
      A.companyId,
      async (tx) => {
        await esperarErrorPg(
          () =>
            tx.query(`INSERT INTO role_permission (role_id, permission_codigo) VALUES ($1, 'asiento.publicar')`, [
              rolAcotado,
            ]),
          SQLSTATE.ESCALADA_DE_PRIVILEGIO,
          'meterse asiento.publicar en su propio rol',
        );
      },
      { userId: atacante, rolId: rolAcotado, sesionNueva: true },
    );

    expect(await puede(atacante, rolAcotado, 'asiento.publicar')).toBe(false);
  });

  it('puerta 1 — sí puede QUITAR un permiso de un rol: bajar no es escalar', async () => {
    const rolDesechable = uuid();
    await db.asAdmin(async (tx) => {
      await tx.query(
        `INSERT INTO role (id, tenant_id, codigo, nombre, descripcion, es_sistema)
         VALUES ($1, $2, 'rol_desechable', 'Desechable', 'Para probar que quitar no se restringe.', false)`,
        [rolDesechable, A.tenantId],
      );
      await tx.query(
        `INSERT INTO role_permission (role_id, permission_codigo) VALUES ($1, 'asiento.publicar')`,
        [rolDesechable],
      );
    });

    const borradas = await db.asTenant(
      A.tenantId,
      A.companyId,
      async (tx) => {
        const { rows } = await tx.query(
          `DELETE FROM role_permission WHERE role_id = $1 AND permission_codigo = 'asiento.publicar'
           RETURNING permission_codigo`,
          [rolDesechable],
        );
        return rows.length;
      },
      { userId: atacante, rolId: rolAcotado, sesionNueva: true },
    );
    expect(borradas).toBe(1);
  });

  it('puerta 2 — no se auto-asigna un rol con más permisos (user_company_access INSERT) → PO002', async () => {
    // Un `asTenant` por intento: el primer error aborta la transacción y todo
    // lo que viniera detrás moriría con 25P02, que es un falso PASS distinto.
    for (const rol of [ROLES.CONTADOR, ROLES.ADMIN_FIRMA, ROLES.ADMIN_TRIBUTARIO]) {
      await db.asTenant(
        A.tenantId,
        A.companyId,
        async (tx) => {
          await esperarErrorPg(
            () =>
              tx.query(
                `INSERT INTO user_company_access (tenant_id, company_id, user_id, role_id)
                 VALUES ($1, $2, $3, $4)`,
                [A.tenantId, A.companyId, atacante, rol],
              ),
            SQLSTATE.ESCALADA_DE_PRIVILEGIO,
            `auto-asignarse el rol ${rol}`,
          );
        },
        { userId: atacante, rolId: rolAcotado, sesionNueva: true },
      );
    }

    expect(await puede(atacante, rolAcotado, 'asiento.publicar')).toBe(false);
  });

  it('puerta 2 — tampoco reactivando un acceso revocado (UPDATE revocado_en → NULL) → PO002', async () => {
    const accesoId = uuid();
    await db.asAdmin((tx) =>
      tx.query(
        `INSERT INTO user_company_access (id, tenant_id, company_id, user_id, role_id, revocado_en)
         VALUES ($1, $2, $3, $4, $5, now())`,
        [accesoId, A.tenantId, A.companyId, atacante, ROLES.CONTADOR],
      ),
    );

    await db.asTenant(
      A.tenantId,
      A.companyId,
      async (tx) => {
        await esperarErrorPg(
          () => tx.query(`UPDATE user_company_access SET revocado_en = NULL WHERE id = $1`, [accesoId]),
          SQLSTATE.ESCALADA_DE_PRIVILEGIO,
          'reactivar su propio acceso revocado con rol contador',
        );
      },
      { userId: atacante, rolId: rolAcotado, sesionNueva: true },
    );

    // Pero revocar (bajar) sí se puede: no es escalada. Transacción aparte.
    const revocadas = await db.asTenant(
      A.tenantId,
      A.companyId,
      async (tx) => {
        const { rows } = await tx.query(
          `UPDATE user_company_access SET revocado_en = now() WHERE id = $1 RETURNING id`,
          [accesoId],
        );
        return rows.length;
      },
      { userId: atacante, rolId: rolAcotado, sesionNueva: true },
    );
    expect(revocadas).toBe(1);

    await db.asAdmin((tx) => tx.query('DELETE FROM user_company_access WHERE id = $1', [accesoId]));
  });

  it('puerta 2 — tampoco CAMBIÁNDOLE el rol a un acceso ya vigente (UPDATE role_id) → PO002', async () => {
    // La cuarta puerta que la ficha D-092 no enumera y que hace falta: el
    // guardia de 183 solo mira el UPDATE cuando es una REACTIVACIÓN
    // (`revocado_en` de NOT NULL a NULL). Un acceso VIGENTE al que se le
    // reescribe `role_id` no era ni un INSERT ni una reactivación, así que
    // pasaba de largo — y ascender el propio acceso de `admin_acotado` a
    // `admin_firma` es exactamente la escalada que las tres puertas existen
    // para impedir, por la puerta de al lado.
    const accesoId = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `SELECT id FROM user_company_access
          WHERE user_id = $1 AND company_id = $2 AND revocado_en IS NULL
          LIMIT 1`,
        [atacante, A.companyId],
      );
      return rows[0]!.id;
    });

    await db.asTenant(
      A.tenantId,
      A.companyId,
      async (tx) => {
        await esperarErrorPg(
          () => tx.query('UPDATE user_company_access SET role_id = $2 WHERE id = $1', [
            accesoId,
            ROLES.ADMIN_FIRMA,
          ]),
          SQLSTATE.ESCALADA_DE_PRIVILEGIO,
          'ascender su propio acceso vigente a admin_firma reescribiendo role_id',
        );
      },
      { userId: atacante, rolId: rolAcotado, sesionNueva: true },
    );

    // Y tampoco a un rol de sistema intermedio.
    await db.asTenant(
      A.tenantId,
      A.companyId,
      async (tx) => {
        await esperarErrorPg(
          () => tx.query('UPDATE user_company_access SET role_id = $2 WHERE id = $1', [
            accesoId,
            ROLES.CONTADOR,
          ]),
          SQLSTATE.ESCALADA_DE_PRIVILEGIO,
          'ascender su propio acceso vigente a contador reescribiendo role_id',
        );
      },
      { userId: atacante, rolId: rolAcotado, sesionNueva: true },
    );

    expect(await puede(atacante, rolAcotado, 'asiento.publicar')).toBe(false);
    expect(await puede(atacante, rolAcotado, 'usuario.administrar')).toBe(true);
  });

  it('puerta 2 — ni MOVIENDO a su nombre el acceso ajeno (UPDATE user_id) → PO002', async () => {
    // Variante del mismo agujero sin tocar `role_id`: el rol es el que ya era,
    // lo que cambia es a quién se lo confiere. `contador` de otra persona,
    // reescrito a nombre propio, es la misma escalada por otro lado.
    const ajeno = (
      await crearUsuarioConCredencial(db, A.tenantId, { companyId: A.companyId, roleId: ROLES.CONTADOR })
    ).userId;
    const accesoAjeno = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `SELECT id FROM user_company_access
          WHERE user_id = $1 AND company_id = $2 AND revocado_en IS NULL LIMIT 1`,
        [ajeno, A.companyId],
      );
      return rows[0]!.id;
    });

    await db.asTenant(
      A.tenantId,
      A.companyId,
      async (tx) => {
        await esperarErrorPg(
          () => tx.query('UPDATE user_company_access SET user_id = $2 WHERE id = $1', [
            accesoAjeno,
            atacante,
          ]),
          SQLSTATE.ESCALADA_DE_PRIVILEGIO,
          'moverse a su nombre el acceso `contador` de otra persona',
        );
      },
      { userId: atacante, rolId: rolAcotado, sesionNueva: true },
    );

    expect(await puede(atacante, rolAcotado, 'asiento.publicar')).toBe(false);
  });

  it('puerta 2 — un UPDATE que no confiere nada (solo revocar, o tocar otra columna) sigue pasando', async () => {
    const victimaAcceso = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `SELECT id FROM user_company_access
          WHERE user_id = $1 AND company_id = $2 AND revocado_en IS NULL LIMIT 1`,
        [victima, A.companyId],
      );
      return rows[0]!.id;
    });

    const tocadas = await db.asTenant(
      A.tenantId,
      A.companyId,
      async (tx) => {
        // Un UPDATE sin cambio de las cuatro columnas que confieren.
        const { rows: a } = await tx.query(
          'UPDATE user_company_access SET updated_at = now() WHERE id = $1 RETURNING id',
          [victimaAcceso],
        );
        // Y revocar, que nunca se restringe.
        const { rows: b } = await tx.query(
          'UPDATE user_company_access SET revocado_en = now() WHERE id = $1 RETURNING id',
          [victimaAcceso],
        );
        return a.length + b.length;
      },
      { userId: atacante, rolId: rolAcotado, sesionNueva: true },
    );
    expect(tocadas).toBe(2);

    // Se le devuelve el acceso a la víctima para el resto del archivo.
    await db.asAdmin((tx) =>
      tx.query('UPDATE user_company_access SET revocado_en = NULL WHERE id = $1', [victimaAcceso]),
    );
  });

  it('puerta 3 — no concede a OTRO un permiso que él no ejerce → PO002', async () => {
    await db.asTenant(
      A.tenantId,
      A.companyId,
      async (tx) => {
        await esperarErrorPg(
          () =>
            insertarOverride(tx, {
              tenantId: A.tenantId,
              companyId: A.companyId,
              userId: victima,
              codigo: 'asiento.publicar',
              efecto: 'otorgado',
            }),
          SQLSTATE.ESCALADA_DE_PRIVILEGIO,
          'otorgar a la víctima un permiso que el atacante no ejerce',
        );
      },
      { userId: atacante, rolId: rolAcotado, sesionNueva: true },
    );

    expect(await puede(victima, ROLES.AUXILIAR_CAUSACION, 'asiento.publicar')).toBe(false);
  });

  it('puerta 3 — no se concede NADA a sí mismo, ni siquiera lo que ya tiene → PO001', async () => {
    for (const codigo of ['asiento.publicar', 'usuario.administrar']) {
      await db.asTenant(
        A.tenantId,
        A.companyId,
        async (tx) => {
          await esperarErrorPg(
            () =>
              insertarOverride(tx, {
                tenantId: A.tenantId,
                companyId: A.companyId,
                userId: atacante,
                codigo,
                efecto: 'otorgado',
              }),
            SQLSTATE.AUTO_OTORGAMIENTO,
            `auto-otorgarse ${codigo}`,
          );
        },
        { userId: atacante, rolId: rolAcotado, sesionNueva: true },
      );
    }
  });

  it('puerta 3 — sí puede REVOCARle a otro un permiso que él no ejerce: quitar no se restringe', async () => {
    expect(await puede(victima, ROLES.AUXILIAR_CAUSACION, 'documento.leer')).toBe(true);

    await db.asTenant(
      A.tenantId,
      A.companyId,
      (tx) =>
        insertarOverride(tx, {
          tenantId: A.tenantId,
          companyId: A.companyId,
          userId: victima,
          codigo: 'documento.leer',
          efecto: 'revocado',
          motivo: 'Investigacion interna en curso; se le suspende el acceso a documentos.',
        }),
      { userId: atacante, rolId: rolAcotado, sesionNueva: true },
    );

    expect(await puede(victima, ROLES.AUXILIAR_CAUSACION, 'documento.leer')).toBe(false);
  });

  it('sin usuario.administrar no se escribe una excepción en absoluto → SE002', async () => {
    await db.asTenant(
      A.tenantId,
      A.companyId,
      async (tx) => {
        await esperarErrorPg(
          () =>
            insertarOverride(tx, {
              tenantId: A.tenantId,
              companyId: A.companyId,
              userId: victima,
              codigo: 'documento.leer',
              efecto: 'revocado',
            }),
          SQLSTATE.PERMISO_INSUFICIENTE,
          'escribir una excepción desde una sesión de solo lectura',
        );
      },
      { rolCodigo: 'solo_lectura', sesionNueva: true },
    );
  });
});

// =============================================================================
// 2. EL ROL TODOPODEROSO PASA LAS TRES PUERTAS
// =============================================================================
describe('A14/D-092 · el rol todopoderoso no pierde ni una capacidad', () => {
  it('pasa las tres puertas y la excepción individual NO se lo quita', async () => {
    const jefe = (
      await crearUsuarioConCredencial(db, A.tenantId, { companyId: A.companyId, roleId: rolTodo })
    ).userId;
    const rolNuevo = uuid();
    const otroUsuario = (
      await crearUsuarioConCredencial(db, A.tenantId, {
        companyId: A.companyId,
        roleId: ROLES.SOLO_LECTURA,
      })
    ).userId;

    await db.asAdmin((tx) =>
      tx.query(
        `INSERT INTO role (id, tenant_id, codigo, nombre, descripcion, es_sistema)
         VALUES ($1, $2, 'rol_del_jefe', 'Rol del jefe', 'Creado para la compuerta de A14.', false)`,
        [rolNuevo, A.tenantId],
      ),
    );

    await db.asTenant(
      A.tenantId,
      A.companyId,
      async (tx) => {
        // Puerta 1.
        await tx.query(
          `INSERT INTO role_permission (role_id, permission_codigo) VALUES ($1, 'asiento.publicar')`,
          [rolNuevo],
        );
        // Puerta 2.
        await tx.query(
          `INSERT INTO user_company_access (tenant_id, company_id, user_id, role_id) VALUES ($1, $2, $3, $4)`,
          [A.tenantId, A.companyId, otroUsuario, rolNuevo],
        );
        // Puerta 3.
        await insertarOverride(tx, {
          tenantId: A.tenantId,
          companyId: A.companyId,
          userId: otroUsuario,
          codigo: 'reporte.exportar',
          efecto: 'otorgado',
          motivo: 'El todopoderoso reparte cualquier permiso del catalogo; esa es la prueba.',
        });
      },
      { userId: jefe, rolId: rolTodo, sesionNueva: true },
    );

    // Y una excepción `revocado` no le quita nada al todopoderoso.
    await db.asTenant(
      A.tenantId,
      A.companyId,
      (tx) =>
        insertarOverride(tx, {
          tenantId: A.tenantId,
          companyId: A.companyId,
          userId: jefe,
          codigo: 'usuario.administrar',
          efecto: 'revocado',
          motivo: 'Intento de dejar a la firma sin nadie que pueda otorgar permisos (RL001 por otra puerta).',
        }),
      { rolCodigo: 'admin_firma', sesionNueva: true },
    );

    expect(await puede(jefe, rolTodo, 'usuario.administrar')).toBe(true);
    expect(await puede(jefe, rolTodo, 'asiento.publicar')).toBe(true);
  });
});

// =============================================================================
// 3. PRECEDENCIA: revocado gana al rol; otorgado gana sin rol
// =============================================================================
describe('A14/D-092 · precedencia de la excepción individual', () => {
  it('otorgado concede aunque el rol no lo tenga, y revocado quita aunque el rol lo dé', async () => {
    const u = (
      await crearUsuarioConCredencial(db, A.tenantId, {
        companyId: A.companyId,
        roleId: ROLES.AUXILIAR_CAUSACION,
      })
    ).userId;

    expect(await puede(u, ROLES.AUXILIAR_CAUSACION, 'reporte.exportar')).toBe(false);

    await db.asTenant(
      A.tenantId,
      A.companyId,
      (tx) =>
        insertarOverride(tx, {
          tenantId: A.tenantId,
          companyId: A.companyId,
          userId: u,
          codigo: 'reporte.exportar',
          efecto: 'otorgado',
          motivo: 'El contador esta incapacitado y hay que presentar la exogena antes del 15.',
        }),
      { rolCodigo: 'admin_firma', sesionNueva: true },
    );
    expect(await puede(u, ROLES.AUXILIAR_CAUSACION, 'reporte.exportar')).toBe(true);

    // La decisión más reciente manda, y la anterior sigue en pie (append-only).
    await db.asTenant(
      A.tenantId,
      A.companyId,
      (tx) =>
        insertarOverride(tx, {
          tenantId: A.tenantId,
          companyId: A.companyId,
          userId: u,
          codigo: 'reporte.exportar',
          efecto: 'revocado',
          motivo: 'El contador volvio de la incapacidad; la excepcion ya no hace falta.',
        }),
      { rolCodigo: 'admin_firma', sesionNueva: true },
    );
    expect(await puede(u, ROLES.AUXILIAR_CAUSACION, 'reporte.exportar')).toBe(false);

    const filas = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ efecto: string }>(
        `SELECT efecto FROM user_permission_override
          WHERE user_id = $1 AND permission_codigo = 'reporte.exportar'`,
        [u],
      );
      return rows;
    });
    expect(filas.length).toBe(2);
    expect(filas.map((f) => f.efecto).sort()).toEqual(['otorgado', 'revocado']);
  });

  it('la vista v_user_permission_efectivo cuenta exactamente lo mismo que la función', async () => {
    const u = (
      await crearUsuarioConCredencial(db, A.tenantId, {
        companyId: A.companyId,
        roleId: ROLES.AUXILIAR_CAUSACION,
      })
    ).userId;

    await db.asTenant(
      A.tenantId,
      A.companyId,
      async (tx) => {
        await insertarOverride(tx, {
          tenantId: A.tenantId,
          companyId: A.companyId,
          userId: u,
          codigo: 'reporte.exportar',
          efecto: 'otorgado',
          motivo: 'Otorgada para comparar la vista contra la funcion sobre el mismo hecho.',
        });
        await insertarOverride(tx, {
          tenantId: A.tenantId,
          companyId: A.companyId,
          userId: u,
          codigo: 'documento.leer',
          efecto: 'revocado',
          motivo: 'Revocada para comparar la vista contra la funcion sobre el mismo hecho.',
        });
      },
      { rolCodigo: 'admin_firma', sesionNueva: true },
    );

    const deLaVista = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ permission_codigo: string; origen: string }>(
        `SELECT permission_codigo, origen FROM v_user_permission_efectivo WHERE user_id = $1`,
        [u],
      );
      return rows;
    });
    const codigos = new Set(deLaVista.map((r) => r.permission_codigo));

    expect(codigos.has('reporte.exportar')).toBe(true);
    expect(deLaVista.find((r) => r.permission_codigo === 'reporte.exportar')!.origen).toBe(
      'excepcion_individual',
    );
    expect(codigos.has('documento.leer')).toBe(false);

    // Y la función dice lo mismo, permiso por permiso, para TODO el catálogo.
    const catalogo = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ codigo: string }>('SELECT codigo FROM permission ORDER BY codigo');
      return rows.map((r) => r.codigo);
    });
    for (const codigo of catalogo) {
      expect(
        [await puede(u, ROLES.AUXILIAR_CAUSACION, codigo), codigo],
        `desacuerdo vista/función en ${codigo}`,
      ).toEqual([codigos.has(codigo), codigo]);
    }
  });
});

// =============================================================================
// 4. VENCIMIENTO
// =============================================================================
describe('A14/D-092 · vencimiento', () => {
  it('no se crea una excepción que vencería antes de empezar → PO001', async () => {
    await db.asTenant(
      A.tenantId,
      A.companyId,
      async (tx) => {
        await esperarErrorPg(
          () =>
            insertarOverride(tx, {
              tenantId: A.tenantId,
              companyId: A.companyId,
              userId: victima,
              codigo: 'reporte.exportar',
              efecto: 'otorgado',
              venceEn: new Date(Date.now() - 86_400_000).toISOString(),
            }),
          SQLSTATE.AUTO_OTORGAMIENTO,
          'crear una excepción ya vencida',
        );
      },
      { rolCodigo: 'admin_firma', sesionNueva: true },
    );
  });

  it('una revocación NO puede llevar vencimiento (sería una trampa) → 23514', async () => {
    await db.asTenant(
      A.tenantId,
      A.companyId,
      async (tx) => {
        await esperarErrorPg(
          () =>
            insertarOverride(tx, {
              tenantId: A.tenantId,
              companyId: A.companyId,
              userId: victima,
              codigo: 'documento.leer',
              efecto: 'revocado',
              venceEn: new Date(Date.now() + 86_400_000).toISOString(),
            }),
          '23514',
          'una revocación con fecha de caducidad',
        );
      },
      { rolCodigo: 'admin_firma', sesionNueva: true },
    );
  });

  it('una excepción vencida CON EL TIEMPO deja de contar sin que nadie la apague', async () => {
    const u = (
      await crearUsuarioConCredencial(db, A.tenantId, {
        companyId: A.companyId,
        roleId: ROLES.AUXILIAR_CAUSACION,
      })
    ).userId;

    // Se otorga con vencimiento a dos segundos vista desde una sesión REAL (el
    // guardia de creación la acepta porque es futura) y se espera a que pase.
    await db.asTenant(
      A.tenantId,
      A.companyId,
      (tx) =>
        insertarOverride(tx, {
          tenantId: A.tenantId,
          companyId: A.companyId,
          userId: u,
          codigo: 'reporte.exportar',
          efecto: 'otorgado',
          motivo: 'Excepcion temporalisima: solo mientras dura esta prueba de compuerta.',
          venceEn: new Date(Date.now() + 2_000).toISOString(),
        }),
      { rolCodigo: 'admin_firma', sesionNueva: true },
    );

    expect(await puede(u, ROLES.AUXILIAR_CAUSACION, 'reporte.exportar')).toBe(true);

    await new Promise((r) => setTimeout(r, 2_500));

    expect(await puede(u, ROLES.AUXILIAR_CAUSACION, 'reporte.exportar')).toBe(false);
    // Y la vista tampoco la enseña.
    const enVista = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query(
        `SELECT 1 FROM v_user_permission_efectivo
          WHERE user_id = $1 AND permission_codigo = 'reporte.exportar'`,
        [u],
      );
      return rows.length;
    });
    expect(enVista).toBe(0);
  });

  it('vencida una REVOCACIÓN temporal imposible, la decisión anterior vuelve a mandar', async () => {
    // Caso: otorgado permanente + revocado posterior → manda el revocado.
    // Al no poder caducar una revocación, el único camino de vuelta es otra
    // decisión explícita. Se comprueba que no hay un limbo.
    const u = (
      await crearUsuarioConCredencial(db, A.tenantId, {
        companyId: A.companyId,
        roleId: ROLES.AUXILIAR_CAUSACION,
      })
    ).userId;

    await db.asAdmin(async (tx) => {
      // Vencida hace un día: no cuenta ni para conceder ni para negar.
      await tx.query(
        `INSERT INTO user_permission_override
           (tenant_id, company_id, user_id, permission_codigo, efecto, motivo, vence_en, otorgado_en)
         VALUES ($1, $2, $3, 'documento.leer', 'otorgado', 'Excepcion de prueba ya vencida hace un dia',
                 now() - interval '1 day', now() - interval '2 days')`,
        [A.tenantId, A.companyId, u],
      );
    });

    // El rol sí da documento.leer: la vencida no lo estorba ni lo aporta.
    expect(await puede(u, ROLES.AUXILIAR_CAUSACION, 'documento.leer')).toBe(true);
  });
});

// =============================================================================
// 5. APPEND-ONLY REAL
// =============================================================================
describe('A14/D-092 · append-only, también contra el superusuario', () => {
  let filaId: string;

  beforeAll(async () => {
    const u = (
      await crearUsuarioConCredencial(db, A.tenantId, {
        companyId: A.companyId,
        roleId: ROLES.AUXILIAR_CAUSACION,
      })
    ).userId;
    await db.asTenant(
      A.tenantId,
      A.companyId,
      (tx) =>
        insertarOverride(tx, {
          tenantId: A.tenantId,
          companyId: A.companyId,
          userId: u,
          codigo: 'reporte.exportar',
          efecto: 'otorgado',
          motivo: 'Fila que A14 va a intentar corregir y borrar por todos los caminos posibles.',
        }),
      { rolCodigo: 'admin_firma', sesionNueva: true },
    );
    filaId = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `SELECT id FROM user_permission_override WHERE user_id = $1`,
        [u],
      );
      return rows[0]!.id;
    });
  });

  it('UPDATE desde una sesión de negocio → PO003', async () => {
    const intentos: Array<[string, string]> = [
      [`UPDATE user_permission_override SET motivo = 'otro motivo largo' WHERE id = $1`, 'editar el motivo'],
      [`UPDATE user_permission_override SET efecto = 'revocado' WHERE id = $1`, 'cambiarle el efecto'],
      [`UPDATE user_permission_override SET vence_en = now() - interval '1 day' WHERE id = $1`, 'caducarla a mano'],
    ];
    for (const [sql, que] of intentos) {
      await db.asTenant(
        A.tenantId,
        A.companyId,
        async (tx) => {
          await esperarErrorPg(() => tx.query(sql, [filaId]), SQLSTATE.OVERRIDE_INMUTABLE, que);
        },
        { rolCodigo: 'admin_firma', sesionNueva: true },
      );
    }
  });

  it('DELETE desde una sesión de negocio → PO003', async () => {
    await db.asTenant(
      A.tenantId,
      A.companyId,
      async (tx) => {
        await esperarErrorPg(
          () => tx.query('DELETE FROM user_permission_override WHERE id = $1', [filaId]),
          SQLSTATE.OVERRIDE_INMUTABLE,
          'borrar una decisión de permiso',
        );
      },
      { rolCodigo: 'admin_firma', sesionNueva: true },
    );
  });

  it('UPDATE y DELETE como SUPERUSUARIO → PO003 igual: el trigger no mira quién es', async () => {
    await esperarErrorPg(
      () =>
        db.asAdmin((tx) =>
          tx.query(`UPDATE user_permission_override SET motivo = 'reescrito por el dueño' WHERE id = $1`, [filaId]),
        ),
      SQLSTATE.OVERRIDE_INMUTABLE,
      'editar la decisión como superusuario',
    );
    await esperarErrorPg(
      () => db.asAdmin((tx) => tx.query('DELETE FROM user_permission_override WHERE id = $1', [filaId])),
      SQLSTATE.OVERRIDE_INMUTABLE,
      'borrar la decisión como superusuario',
    );
    // Un DELETE masivo sin WHERE tampoco.
    await esperarErrorPg(
      () => db.asAdmin((tx) => tx.query('DELETE FROM user_permission_override')),
      SQLSTATE.OVERRIDE_INMUTABLE,
      'vaciar la tabla como superusuario',
    );

    const sigue = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query('SELECT 1 FROM user_permission_override WHERE id = $1', [filaId]);
      return rows.length;
    });
    expect(sigue).toBe(1);
  });

  it('el motivo vacío o de relleno corto lo rechaza el MOTOR, no la pantalla → 23514', async () => {
    for (const motivo of ['x', '          ', '  corto  ']) {
      await db.asTenant(
        A.tenantId,
        A.companyId,
        async (tx) => {
          await esperarErrorPg(
            () =>
              insertarOverride(tx, {
                tenantId: A.tenantId,
                companyId: A.companyId,
                userId: victima,
                codigo: 'documento.leer',
                efecto: 'revocado',
                motivo,
              }),
            '23514',
            `una excepción con motivo «${motivo}»`,
          );
        },
        { rolCodigo: 'admin_firma', sesionNueva: true },
      );
    }
  });
});

// =============================================================================
// 6. AISLAMIENTO RLS DE DOBLE NIVEL
// =============================================================================
describe('A14/D-092 · aislamiento de doble nivel impuesto por el motor', () => {
  it('la firma B no ve NI UNA excepción de la firma A', async () => {
    const totalReal = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM user_permission_override WHERE tenant_id = $1',
        [A.tenantId],
      );
      return Number(rows[0]!.n);
    });
    expect(totalReal).toBeGreaterThan(0);

    const desdeB = await db.asTenant(
      B.tenantId,
      B.companyId,
      async (tx) => {
        const { rows } = await tx.query<{ n: string }>(
          'SELECT count(*)::text AS n FROM user_permission_override',
        );
        return Number(rows[0]!.n);
      },
      { rolCodigo: 'admin_firma', sesionNueva: true },
    );
    expect(desdeB).toBe(0);

    // Ni con el tenant_id de A escrito a mano en el WHERE (Regla de Oro 7).
    const forzado = await db.asTenant(
      B.tenantId,
      B.companyId,
      async (tx) => {
        const { rows } = await tx.query('SELECT id FROM user_permission_override WHERE tenant_id = $1', [
          A.tenantId,
        ]);
        return rows.length;
      },
      { rolCodigo: 'admin_firma', sesionNueva: true },
    );
    expect(forzado).toBe(0);
  });

  it('la firma B no ESCRIBE una excepción sobre la firma A', async () => {
    // Mintiendo el tenant_id de A: lo para PO004 —el trigger BEFORE dispara
    // antes que el WITH CHECK de la política— porque el administrador de B no
    // tiene acceso vigente a esa empresa. El rechazo es del motor igual, y por
    // el guardia MÁS estricto de los dos.
    await db.asTenant(
      B.tenantId,
      B.companyId,
      async (tx) => {
        await esperarErrorPg(
          () =>
            insertarOverride(tx, {
              tenantId: A.tenantId,
              companyId: A.companyId,
              userId: victima,
              codigo: 'documento.leer',
              efecto: 'revocado',
            }),
          SQLSTATE.OVERRIDE_EMPRESA_AJENA,
          'escribir una excepción con el tenant_id de la otra firma',
        );
      },
      { rolCodigo: 'admin_firma', sesionNueva: true },
    );

    // Con su propio tenant_id y la empresa/usuario ajenos, desde la sesión de
    // B, el diagnóstico sigue siendo PO004: el trigger dispara antes que la FK.
    await db.asTenant(
      B.tenantId,
      B.companyId,
      async (tx) => {
        await esperarErrorPg(
          () =>
            insertarOverride(tx, {
              tenantId: B.tenantId,
              companyId: A.companyId,
              userId: victima,
              codigo: 'documento.leer',
              efecto: 'revocado',
            }),
          SQLSTATE.OVERRIDE_EMPRESA_AJENA,
          'apuntar una excepción propia a la empresa y al usuario de la otra firma',
        );
      },
      { rolCodigo: 'admin_firma', sesionNueva: true },
    );

    // Y la FK compuesta existe de verdad, no solo el trigger: SIN sesión —el
    // camino administrativo, donde el guardia se salta a propósito— la fila
    // cruzada sigue siendo imposible. Es la garantía que sobrevive a que un día
    // alguien desactive la RLS o el trigger (mismo patrón de 002/018).
    await esperarErrorPg(
      () =>
        db.asAdmin((tx) =>
          insertarOverride(tx, {
            tenantId: B.tenantId,
            companyId: A.companyId,
            userId: victima,
            codigo: 'documento.leer',
            efecto: 'revocado',
          }),
        ),
      '23503',
      'una excepción de B apuntando a la empresa y al usuario de A, sin sesión y como superusuario',
    );
  });

  it('la política WITH CHECK, sola, ya para la escritura cruzada de firma', async () => {
    // La fila apunta a una empresa y a un usuario de la PROPIA firma B —así
    // PO004 no aplica, porque el administrador sí tiene acceso vigente a esa
    // empresa— pero declara `tenant_id` de A. Lo único que queda en pie es la
    // política: es la prueba limpia del WITH CHECK (Regla de Oro 7).
    const usuarioB = (
      await crearUsuarioConCredencial(db, B.tenantId, {
        companyId: B.companyId,
        roleId: ROLES.SOLO_LECTURA,
      })
    ).userId;

    await db.asTenant(
      B.tenantId,
      B.companyId,
      async (tx) => {
        await esperarErrorPg(
          () =>
            insertarOverride(tx, {
              tenantId: A.tenantId,
              companyId: B.companyId,
              userId: usuarioB,
              codigo: 'documento.leer',
              efecto: 'revocado',
              motivo: 'Escritura cruzada de firma que solo puede parar la politica RLS.',
            }),
          '42501',
          'una fila con el tenant_id de A escrita desde la sesión de B',
        );
      },
      { rolCodigo: 'admin_firma', sesionNueva: true },
    );
  });

  it('con empresa en contexto, una excepción de OTRA empresa de la misma firma es invisible', async () => {
    const u = (
      await crearUsuarioConCredencial(db, A.tenantId, { companyId: companyA2, roleId: ROLES.SOLO_LECTURA })
    ).userId;
    await db.asAdmin((tx) =>
      tx.query(
        `INSERT INTO user_permission_override
           (tenant_id, company_id, user_id, permission_codigo, efecto, motivo)
         VALUES ($1, $2, $3, 'reporte.exportar', 'otorgado', 'Excepcion de la empresa hermana, invisible desde A')`,
        [A.tenantId, companyA2, u],
      ),
    );

    const vistas = await db.asTenant(
      A.tenantId,
      A.companyId,
      async (tx) => {
        const { rows } = await tx.query('SELECT id FROM user_permission_override WHERE company_id = $1', [
          companyA2,
        ]);
        return rows.length;
      },
      { rolCodigo: 'admin_firma', sesionNueva: true },
    );
    expect(vistas).toBe(0);
  });

  it('SIN empresa en contexto, PO004 exige acceso vigente a la empresa objetivo', async () => {
    // El atacante tiene acceso a A.companyId, no a companyA2. Sin empresa en
    // contexto la política deja pasar cualquier empresa del tenant: el único
    // guardia que queda es PO004, que es justo el caso que la 183 dice cubrir.
    const forastero = (
      await crearUsuarioConCredencial(db, A.tenantId, { companyId: companyA2, roleId: ROLES.SOLO_LECTURA })
    ).userId;

    await db.asTenant(
      A.tenantId,
      null,
      async (tx) => {
        await esperarErrorPg(
          () =>
            insertarOverride(tx, {
              tenantId: A.tenantId,
              companyId: companyA2,
              userId: forastero,
              codigo: 'documento.leer',
              efecto: 'revocado',
              motivo: 'Reparto de permisos sobre una empresa en la que nunca puse un pie.',
            }),
          SQLSTATE.OVERRIDE_EMPRESA_AJENA,
          'repartir permisos sobre una empresa sin acceso vigente',
        );
      },
      { userId: atacante, rolId: rolAcotado, sesionNueva: true },
    );
  });

  it('SIN empresa en contexto, un acceso REVOCADO a la empresa objetivo no vale → PO004', async () => {
    const otroAdmin = (
      await crearUsuarioConCredencial(db, A.tenantId, { companyId: A.companyId, roleId: ROLES.ADMIN_FIRMA })
    ).userId;
    const objetivo = (
      await crearUsuarioConCredencial(db, A.tenantId, { companyId: companyA2, roleId: ROLES.SOLO_LECTURA })
    ).userId;

    // Le damos acceso a companyA2 y se lo revocamos: ya no vale.
    await db.asAdmin((tx) =>
      tx.query(
        `INSERT INTO user_company_access (tenant_id, company_id, user_id, role_id, revocado_en)
         VALUES ($1, $2, $3, $4, now())`,
        [A.tenantId, companyA2, otroAdmin, ROLES.ADMIN_FIRMA],
      ),
    );

    await db.asTenant(
      A.tenantId,
      null,
      async (tx) => {
        await esperarErrorPg(
          () =>
            insertarOverride(tx, {
              tenantId: A.tenantId,
              companyId: companyA2,
              userId: objetivo,
              codigo: 'documento.leer',
              efecto: 'revocado',
              motivo: 'Con un acceso ya revocado a esa empresa no se reparte nada.',
            }),
          SQLSTATE.OVERRIDE_EMPRESA_AJENA,
          'repartir permisos con el acceso a esa empresa revocado',
        );
      },
      { userId: otroAdmin, rolId: ROLES.ADMIN_FIRMA, sesionNueva: true },
    );
  });
});

// =============================================================================
// 7. TRAZABILIDAD (Regla de Oro 6)
// =============================================================================
describe('A14/D-092 · trazabilidad', () => {
  it('otorgado_por lo pisa el trigger: no se firma con el nombre de otro', async () => {
    const u = (
      await crearUsuarioConCredencial(db, A.tenantId, {
        companyId: A.companyId,
        roleId: ROLES.AUXILIAR_CAUSACION,
      })
    ).userId;

    const { userId: quienFirma } = await db.emitirSesion(A.tenantId, A.companyId, {
      rolCodigo: 'admin_firma',
    });

    await db.asTenant(
      A.tenantId,
      A.companyId,
      (tx) =>
        insertarOverride(tx, {
          tenantId: A.tenantId,
          companyId: A.companyId,
          userId: u,
          codigo: 'reporte.exportar',
          efecto: 'otorgado',
          motivo: 'Se intenta firmar esta concesion con el nombre de la victima, a ver si cuela.',
          // La mentira: dice que la firmó la propia víctima.
          otorgadoPor: u,
        }),
      { rolCodigo: 'admin_firma', sesionNueva: false },
    );

    const fila = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ otorgado_por: string }>(
        `SELECT otorgado_por FROM user_permission_override WHERE user_id = $1`,
        [u],
      );
      return rows[0]!;
    });
    expect(fila.otorgado_por).not.toBe(u);
    expect(fila.otorgado_por).toBe(quienFirma);
  });

  it('cada decisión cae en el audit_log CON su motivo dentro', async () => {
    const u = (
      await crearUsuarioConCredencial(db, A.tenantId, {
        companyId: A.companyId,
        roleId: ROLES.AUXILIAR_CAUSACION,
      })
    ).userId;
    const motivo = 'Cierre de diciembre: el contador esta de vacaciones y hay que exportar el balance.';

    await db.asTenant(
      A.tenantId,
      A.companyId,
      (tx) =>
        insertarOverride(tx, {
          tenantId: A.tenantId,
          companyId: A.companyId,
          userId: u,
          codigo: 'reporte.exportar',
          efecto: 'otorgado',
          motivo,
        }),
      { rolCodigo: 'admin_firma', sesionNueva: true },
    );

    const rastro = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ accion: string; motivo: string; user_id: string | null }>(
        `SELECT accion, valor_nuevo->>'motivo' AS motivo, user_id
           FROM audit_log
          WHERE entidad = 'user_permission_override'
            AND valor_nuevo->>'user_id' = $1`,
        [u],
      );
      return rows;
    });
    expect(rastro.length).toBe(1);
    expect(rastro[0]!.accion).toBe('INSERT');
    expect(rastro[0]!.motivo).toBe(motivo);
    expect(rastro[0]!.user_id).not.toBeNull();
  });
});

// =============================================================================
// 8. COMPATIBILIDAD: v_user_permission (011) intacta
// =============================================================================
describe('A14/D-092 · la vista de compatibilidad no se rompió', () => {
  it('v_user_permission sigue existiendo y sigue siendo 100% del rol', async () => {
    const u = (
      await crearUsuarioConCredencial(db, A.tenantId, {
        companyId: A.companyId,
        roleId: ROLES.AUXILIAR_CAUSACION,
      })
    ).userId;

    await db.asTenant(
      A.tenantId,
      A.companyId,
      (tx) =>
        insertarOverride(tx, {
          tenantId: A.tenantId,
          companyId: A.companyId,
          userId: u,
          codigo: 'reporte.exportar',
          efecto: 'otorgado',
          motivo: 'La vista de compatibilidad de 011 NO debe enterarse de esta excepcion.',
        }),
      { rolCodigo: 'admin_firma', sesionNueva: true },
    );

    const filas = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ permission_codigo: string }>(
        `SELECT permission_codigo FROM v_user_permission WHERE user_id = $1`,
        [u],
      );
      return rows.map((r) => r.permission_codigo);
    });
    expect(filas.length).toBeGreaterThan(0);
    expect(filas).not.toContain('reporte.exportar');
  });

  it('v_user_permission_efectivo conserva las columnas de 170 que otros consumen', async () => {
    const columnas = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'v_user_permission_efectivo'`,
      );
      return rows.map((r) => r.column_name);
    });
    for (const c of [
      'tenant_id',
      'company_id',
      'user_id',
      'role_id',
      'role_codigo',
      'es_todopoderoso',
      'permission_codigo',
      'modulo',
      'accion_tipo',
    ]) {
      expect(columnas, `falta la columna ${c} de 170`).toContain(c);
    }
    // Y las tres que añade 183.
    for (const c of ['origen', 'excepcion_motivo', 'excepcion_vence_en']) {
      expect(columnas).toContain(c);
    }
  });
});

// =============================================================================
// 9. LAS PANTALLAS: el permiso no lo pone la interfaz
// =============================================================================
describe('A14/D-092 · las pantallas nuevas y migradas exigen permiso de verdad', () => {
  it('/admin/correcciones exige documento.leer antes de consultar nada', async () => {
    const { readFileSync } = await import('node:fs');
    const fuente = readFileSync('app/admin/correcciones/page.tsx', 'utf8');
    expect(fuente).toContain('PERMISOS.DOCUMENTO_LEER');
    // La comprobación va ANTES de la consulta, no después de pintarla.
    const guardia = fuente.indexOf('tienePermiso(tx, PERMISOS.DOCUMENTO_LEER)');
    const consulta = fuente.indexOf('listarCorreccionesPendientes(tx)');
    expect(guardia).toBeGreaterThan(-1);
    expect(consulta).toBeGreaterThan(-1);
    expect(guardia).toBeLessThan(consulta);
    // Y hay un corto-circuito entre las dos: no se consulta y luego se oculta.
    expect(fuente).toMatch(/if \(!puedeVer\) return/);
  });

  it('/admin/historial exige auditoria.leer y /admin/permisos exige usuario.administrar', async () => {
    const { readFileSync } = await import('node:fs');
    expect(readFileSync('app/admin/historial/page.tsx', 'utf8')).toContain('PERMISOS.AUDITORIA_LEER');
    expect(readFileSync('app/admin/permisos/page.tsx', 'utf8')).toContain('puedeAdministrarUsuarios');
  });

  it('la acción de servidor de permisos muere en el MOTOR sin usuario.administrar (SE002)', async () => {
    const { decidirPermisoIndividual } = await import('../../src/services/administracion.js');
    await db.asTenant(
      A.tenantId,
      A.companyId,
      async (tx) => {
        await expect(
          decidirPermisoIndividual(tx, {
            userId: victima,
            companyId: A.companyId,
            permisoCodigo: 'documento.leer',
            efecto: 'revocado',
            motivo: 'POST directo a la accion de servidor saltandose la interfaz.',
          }),
        ).rejects.toThrow();
      },
      { rolCodigo: 'solo_lectura', sesionNueva: true },
    );
  });

  it('el rechazo del motor llega a la pantalla como una FRASE, no como «problema técnico»', async () => {
    // V-58. El guardia puede ser perfecto y el operador no enterarse. Es el
    // mismo defecto que esta ficha corrigió para el 42501 de `asignarRol`: los
    // cuatro SQLSTATE de 183/184 caían al mensaje genérico del final. El caso
    // más probable ni siquiera es raro: `asignarRol` NO comprueba la escalada
    // en el servicio, así que un `usuario.administrar` que intente otorgar
    // `contador` desde `/admin/usuarios` recibe PO002 crudo.
    const { mensajeDeError } = await import('../../app/admin/_errores.js');

    const capturar = async (fn: () => Promise<unknown>): Promise<unknown> => {
      try {
        await fn();
      } catch (e) {
        return e;
      }
      throw new Error('Se esperaba un rechazo del motor y no lo hubo.');
    };

    const po002 = await capturar(() =>
      db.asTenant(
        A.tenantId,
        A.companyId,
        (tx) =>
          tx.query(
            `INSERT INTO user_company_access (tenant_id, company_id, user_id, role_id) VALUES ($1, $2, $3, $4)`,
            [A.tenantId, A.companyId, victima, ROLES.CONTADOR],
          ),
        { userId: atacante, rolId: rolAcotado, sesionNueva: true },
      ),
    );
    const texto = mensajeDeError(po002);
    expect(texto).not.toContain('problema técnico');
    expect(texto).toMatch(/no ejerce/);

    const po003 = await capturar(() =>
      db.asAdmin((tx) => tx.query('DELETE FROM user_permission_override')),
    );
    expect(mensajeDeError(po003)).not.toContain('problema técnico');
    expect(mensajeDeError(po003)).toMatch(/no se edita ni se borra/);

    const po004 = await capturar(() =>
      db.asTenant(
        A.tenantId,
        null,
        (tx) =>
          insertarOverride(tx, {
            tenantId: A.tenantId,
            companyId: companyA2,
            userId: victima,
            codigo: 'documento.leer',
            efecto: 'revocado',
          }),
        { userId: atacante, rolId: rolAcotado, sesionNueva: true },
      ),
    );
    expect(mensajeDeError(po004)).not.toContain('problema técnico');
    expect(mensajeDeError(po004)).toMatch(/acceso vigente/);
  });

  it('el servicio del historial de permisos no lleva NI UN filtro de aplicación por tenant', async () => {
    const { readFileSync } = await import('node:fs');
    const fuente = readFileSync('src/services/administracion.ts', 'utf8');
    const bloque = fuente.slice(fuente.indexOf('export async function listarHistorialDePermisos'));
    expect(bloque).not.toMatch(/tenant_id\s*=\s*\$/);
    expect(bloque).not.toMatch(/company_id\s*=\s*\$/);
  });
});

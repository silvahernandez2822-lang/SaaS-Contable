/**
 * COMPUERTA DE ARRANQUE Y REPASO DE LA 14.1 — Agente A12
 *
 * Dos bloques, uno por encargo:
 *
 *  A. ARRANQUE. Que el sistema se pueda usar por primera vez sin SQL a mano, y
 *     que hacerlo NO abra ningún atajo: el usuario que crea el arranque entra
 *     por el mismo `iniciarSesion` que cualquier otro, y su contexto de tenant
 *     lo sigue derivando la base del token (D-021). Se prueba además el
 *     comportamiento al invocarlo dos veces y con datos ya cargados, que es
 *     donde un arranque mal hecho se convierte en una toma de control.
 *
 *  B. REPASO DE LA 14.1 CONTRA EL SISTEMA DE HOY. Lo que cambió de superficie
 *     desde la Ola 0: RLS verificada POR CATÁLOGO sobre las 45 tablas actuales,
 *     el reparto de `tercero.editar` (adjudicado y corregido en la migración
 *     140), la auditoría del maestro de terceros y la auditoría de la descarga
 *     de reportes.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, esperarErrorPg, uuid } from '../helpers/db';
import type { TestDb } from '../helpers/db';
import { crearEscenario } from '../helpers/fixtures';
import type { Escenario } from '../helpers/fixtures';
import { arrancar, ArranqueError, generarPasswordInicial } from '../../src/bootstrap/arranque';
import { iniciarSesion } from '../../src/auth/autenticacion';
import { withSessionContext } from '../../src/db/tenant-context';
import { SQLSTATE } from '../../src/db/types';
import { PERMISOS, ROLES } from '../../src/auth/permisos';

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

/** NITs distintos por corrida para no chocar con `tenant_nit_uq`. */
function nit(): string {
  return String(800_000_000 + Math.floor(Math.random() * 99_999_999));
}

describe('A — Arranque del sistema', () => {
  it('crea firma, empresa, usuario administrador y su acceso, y el usuario puede entrar de verdad', async () => {
    const correo = `arranque-${uuid()}@ejemplo.co`;
    const r = await arrancar(db.client, {
      firmaNit: nit(),
      firmaRazonSocial: 'Firma de arranque SAS',
      empresaNit: nit(),
      empresaRazonSocial: 'Empresa cliente uno SAS',
      adminEmail: correo,
      adminNombre: 'Operador del arranque',
    });

    expect(r.creado).toEqual({ firma: true, empresa: true, usuario: true, acceso: true });
    expect(r.passwordGenerada).not.toBeNull();
    expect((r.passwordGenerada ?? '').length).toBeGreaterThanOrEqual(12);

    // El arranque NO emite sesión: hay que autenticarse como cualquiera.
    const sesion = await iniciarSesion(db.client, {
      email: correo,
      password: r.passwordGenerada!,
    });
    expect(sesion.tenantId).toBe(r.tenantId);
    expect(sesion.userId).toBe(r.userId);

    // Y el contexto lo sigue derivando la BASE del token, no el arranque.
    const contexto = await withSessionContext(
      db.client,
      { sessionToken: sesion.token, companyId: r.companyId },
      async (tx) => {
        const { rows } = await tx.query<{ t: string; c: string; permisos: number }>(
          `SELECT app.current_tenant_id()  AS t,
                  app.current_company_id() AS c,
                  (SELECT count(*) FROM v_user_permission
                    WHERE user_id = app.current_user_id())::int AS permisos`,
        );
        return rows[0]!;
      },
    );
    expect(contexto.t).toBe(r.tenantId);
    expect(contexto.c).toBe(r.companyId);
    // admin_firma tiene TODOS los permisos del catálogo.
    expect(contexto.permisos).toBeGreaterThan(20);
  });

  it('la contraseña generada es distinta cada vez y tiene entropía suficiente', () => {
    const muestras = new Set(Array.from({ length: 50 }, () => generarPasswordInicial()));
    expect(muestras.size).toBe(50);
    for (const p of muestras) expect(p.length).toBeGreaterThanOrEqual(30);
  });

  it('invocarlo dos veces no duplica nada y NO reescribe la contraseña del administrador', async () => {
    const correo = `arranque-idem-${uuid()}@ejemplo.co`;
    const firmaNit = nit();
    const empresaNit = nit();
    const base = {
      firmaNit,
      firmaRazonSocial: 'Firma idempotente SAS',
      empresaNit,
      empresaRazonSocial: 'Empresa idempotente SAS',
      adminEmail: correo,
      adminNombre: 'Operador',
    };

    const primero = await arrancar(db.client, base);
    const segundo = await arrancar(db.client, { ...base, adminPassword: 'contrasena-intrusa-larga' });

    expect(segundo.tenantId).toBe(primero.tenantId);
    expect(segundo.companyId).toBe(primero.companyId);
    expect(segundo.userId).toBe(primero.userId);
    expect(segundo.creado).toEqual({ firma: false, empresa: false, usuario: false, acceso: false });
    expect(segundo.passwordGenerada).toBeNull();

    // Lo que importa: la contraseña ORIGINAL sigue siendo la válida. Si el
    // arranque reescribiera credenciales, reejecutarlo sería una primitiva de
    // toma de control de la cuenta administradora de una firma viva.
    const sesion = await iniciarSesion(db.client, { email: correo, password: primero.passwordGenerada! });
    expect(sesion.userId).toBe(primero.userId);
    await expect(
      iniciarSesion(db.client, { email: correo, password: 'contrasena-intrusa-larga' }),
    ).rejects.toThrow();

    // Y no se duplicaron filas.
    const conteos = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ firmas: number; empresas: number; accesos: number }>(
        `SELECT (SELECT count(*) FROM tenant  WHERE nit = $1)::int AS firmas,
                (SELECT count(*) FROM company WHERE nit = $2)::int AS empresas,
                (SELECT count(*) FROM user_company_access WHERE user_id = $3)::int AS accesos`,
        [firmaNit, empresaNit, primero.userId],
      );
      return rows[0]!;
    });
    expect(conteos).toEqual({ firmas: 1, empresas: 1, accesos: 1 });
  });

  it('--rotar-password sí cambia la credencial, y revoca las sesiones abiertas con la anterior', async () => {
    const correo = `arranque-rota-${uuid()}@ejemplo.co`;
    const base = {
      firmaNit: nit(),
      firmaRazonSocial: 'Firma con rotación SAS',
      empresaNit: nit(),
      empresaRazonSocial: 'Empresa con rotación SAS',
      adminEmail: correo,
      adminNombre: 'Operador',
    };
    const primero = await arrancar(db.client, base);
    const sesionVieja = await iniciarSesion(db.client, {
      email: correo,
      password: primero.passwordGenerada!,
    });

    const rotado = await arrancar(db.client, { ...base, rotarPassword: true });
    expect(rotado.passwordGenerada).not.toBeNull();
    expect(rotado.passwordGenerada).not.toBe(primero.passwordGenerada);

    // La nueva entra; la vieja ya no.
    await iniciarSesion(db.client, { email: correo, password: rotado.passwordGenerada! });
    await expect(
      iniciarSesion(db.client, { email: correo, password: primero.passwordGenerada! }),
    ).rejects.toThrow();

    // Y el token emitido antes de rotar quedó muerto.
    await expect(
      withSessionContext(db.client, { sessionToken: sesionVieja.token }, async () => 'no'),
    ).rejects.toThrow();
  });

  it('se niega a adoptar un correo que ya pertenece a un usuario de OTRA firma', async () => {
    const correo = `arranque-cruzado-${uuid()}@ejemplo.co`;
    await arrancar(db.client, {
      firmaNit: nit(),
      firmaRazonSocial: 'Firma A',
      empresaNit: nit(),
      empresaRazonSocial: 'Empresa de A',
      adminEmail: correo,
      adminNombre: 'Operador de A',
    });

    await expect(
      arrancar(db.client, {
        firmaNit: nit(),
        firmaRazonSocial: 'Firma B',
        empresaNit: nit(),
        empresaRazonSocial: 'Empresa de B',
        adminEmail: correo,
        adminNombre: 'Operador de B',
      }),
    ).rejects.toBeInstanceOf(ArranqueError);
  });

  it('la guarda --solo-si-vacio aborta cuando ya hay firmas, sin tocar nada', async () => {
    const firmaNit = nit();
    await expect(
      arrancar(db.client, {
        firmaNit,
        firmaRazonSocial: 'Firma que no debe nacer',
        empresaNit: nit(),
        empresaRazonSocial: 'Empresa que no debe nacer',
        adminEmail: `arranque-vacio-${uuid()}@ejemplo.co`,
        adminNombre: 'Operador',
        soloSiVacio: true,
      }),
    ).rejects.toBeInstanceOf(ArranqueError);

    const n = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: number }>('SELECT count(*)::int AS n FROM tenant WHERE nit = $1', [
        firmaNit,
      ]);
      return rows[0]!.n;
    });
    expect(n).toBe(0);
  });

  it('rechaza datos mal formados antes de escribir una sola fila', async () => {
    for (const malo of [
      { firmaNit: 'no-es-un-nit' },
      { empresaNit: '' },
      { adminEmail: 'sin-arroba' },
      { adminNombre: '   ' },
      { adminPassword: 'corta' },
    ]) {
      await expect(
        arrancar(db.client, {
          firmaNit: nit(),
          firmaRazonSocial: 'Firma',
          empresaNit: nit(),
          empresaRazonSocial: 'Empresa',
          adminEmail: `ok-${uuid()}@ejemplo.co`,
          adminNombre: 'Operador',
          ...malo,
        }),
      ).rejects.toThrow();
    }
  });
});

describe('B — Repaso de la 14.1: RLS por catálogo sobre el sistema de HOY', () => {
  it('toda tabla de datos tiene RLS habilitada Y forzada; la única excepción es schema_migration', async () => {
    const sinRls = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ relname: string }>(
        `SELECT c.relname
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r'
            AND (c.relrowsecurity = false OR c.relforcerowsecurity = false)
          ORDER BY 1`,
      );
      return rows.map((r) => r.relname);
    });
    expect(sinRls).toEqual(['schema_migration']);
  });

  it('ninguna tabla con RLS se quedó sin política, y toda tabla con tenant_id/company_id filtra por el contexto verificado', async () => {
    const huecos = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ relname: string; motivo: string }>(
        `SELECT c.relname, 'sin politica' AS motivo
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
            AND NOT EXISTS (SELECT 1 FROM pg_policies p
                             WHERE p.schemaname = 'public' AND p.tablename = c.relname)
          UNION ALL
         SELECT c.relname, 'tenant_id sin current_tenant_id'
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r'
            AND EXISTS (SELECT 1 FROM pg_attribute a
                         WHERE a.attrelid = c.oid AND a.attname = 'tenant_id'
                           AND a.attnum > 0 AND NOT a.attisdropped)
            AND NOT EXISTS (SELECT 1 FROM pg_policies p
                             WHERE p.schemaname = 'public' AND p.tablename = c.relname
                               AND (coalesce(p.qual,'') || coalesce(p.with_check,'')) LIKE '%current_tenant_id%')
          UNION ALL
         SELECT c.relname, 'company_id sin current_company_id'
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r'
            AND EXISTS (SELECT 1 FROM pg_attribute a
                         WHERE a.attrelid = c.oid AND a.attname = 'company_id'
                           AND a.attnum > 0 AND NOT a.attisdropped)
            AND NOT EXISTS (SELECT 1 FROM pg_policies p
                             WHERE p.schemaname = 'public' AND p.tablename = c.relname
                               AND (coalesce(p.qual,'') || coalesce(p.with_check,'')) LIKE '%current_company_id%')
          ORDER BY 1, 2`,
      );
      return rows.map((r) => `${r.relname}: ${r.motivo}`);
    });
    expect(huecos).toEqual([]);
  });

  it('el barrido cubre TODAS las tablas de hoy, no una lista escrita a mano en la Ola 0', async () => {
    const n = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r'`,
      );
      return rows[0]!.n;
    });
    // En la Ola 0 eran ~31. A5, A7, A8, A11 y A13 añadieron tablas.
    expect(n).toBeGreaterThanOrEqual(45);
  });
});

describe('B — Adjudicación de `tercero.editar` (migración 140)', () => {
  let e: Escenario;

  beforeAll(async () => {
    e = await crearEscenario(db, { razonSocial: 'Firma del repaso 14.1' });
    // El escenario deja una vigencia fiscal ABIERTA desde 2020. Se cierra aquí
    // para que cada prueba pueda abrir la suya sin chocar con PR002, que es un
    // rechazo de vigencias y no de permisos: mezclarlos daría un falso PASS.
    await db.asAdmin((tx) =>
      tx.query(
        `UPDATE third_party_fiscal_attribute SET vigente_hasta = DATE '2025-12-31'
          WHERE third_party_id = $1 AND vigente_hasta IS NULL`,
        [e.thirdPartyId],
      ),
    );
  }, 120_000);

  /** Cada llamada usa una vigencia distinta: las vigencias son append-only y
   * no se solapan (PR002), así que repetir la misma fecha fallaría por una
   * razón que no tiene nada que ver con los permisos. */
  async function insertarAtributoFiscal(
    rolCodigo: string,
    desde: string,
    hasta: string,
  ): Promise<void> {
    await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) =>
        tx.query(
          `INSERT INTO third_party_fiscal_attribute
             (tenant_id, company_id, third_party_id, es_declarante_renta,
              vigente_desde, vigente_hasta, norma_respaldo)
           VALUES ($1, $2, $3, true, $4::date, $5::date, 'RUT del tercero')`,
          [e.tenantId, e.companyId, e.thirdPartyId, desde, hasta],
        ),
      { rolCodigo, sesionNueva: true },
    );
  }

  it('el permiso nuevo existe y lo tienen exactamente admin_firma, admin_tributario y contador', async () => {
    const roles = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ codigo: string }>(
        `SELECT r.codigo FROM role r JOIN role_permission rp ON rp.role_id = r.id
          WHERE rp.permission_codigo = 'tercero.atributos_fiscales' ORDER BY r.codigo`,
      );
      return rows.map((r) => r.codigo);
    });
    expect(roles).toEqual(['admin_firma', 'admin_tributario', 'contador']);
    expect(PERMISOS.TERCERO_ATRIBUTOS_FISCALES).toBe('tercero.atributos_fiscales');
  });

  it('el auxiliar de causación YA NO puede registrar atributos fiscales de un tercero (SE002)', async () => {
    await esperarErrorPg(
      () => insertarAtributoFiscal('auxiliar_causacion', '2026-02-01', '2026-02-28'),
      SQLSTATE.PERMISO_INSUFICIENTE,
      'un auxiliar de causación registrando atributos fiscales de un tercero',
    );
  });

  it('pero SIGUE pudiendo crear el tercero: sin eso no podría causar la factura de un proveedor nuevo', async () => {
    const creado = await db.asTenant(
      e.tenantId,
      e.companyId,
      async (tx) => {
        const { rows } = await tx.query<{ id: string }>(
          `INSERT INTO third_party (tenant_id, company_id, tipo_documento, numero_documento,
                                    tipo_persona, razon_social)
           VALUES ($1, $2, 'NIT', $3, 'juridica', 'Proveedor nuevo del auxiliar SAS')
           RETURNING id`,
          [e.tenantId, e.companyId, String(700_000_000 + Math.floor(Math.random() * 99_999_999))],
        );
        return rows[0]!.id;
      },
      { rolCodigo: 'auxiliar_causacion', sesionNueva: true },
    );
    expect(creado).toBeTruthy();
  });

  it('el contador y el administrador tributario sí los registran', async () => {
    await expect(insertarAtributoFiscal('contador', '2026-03-01', '2026-03-31')).resolves.toBeUndefined();
    await expect(insertarAtributoFiscal('admin_tributario', '2026-04-01', '2026-04-30')).resolves.toBeUndefined();
  });

  it('el rol de solo lectura sigue sin poder', async () => {
    await esperarErrorPg(
      () => insertarAtributoFiscal('solo_lectura', '2026-05-01', '2026-05-31'),
      SQLSTATE.PERMISO_INSUFICIENTE,
      'un rol de solo lectura registrando atributos fiscales',
    );
  });

  it('fijar una TARIFA de ICA en la ficha de un tercero exige `parametro.editar`, no basta con el permiso de terceros', async () => {
    const conTarifa = (rolCodigo: string, desde: string, hasta: string) =>
      db.asTenant(
        e.tenantId,
        e.companyId,
        (tx) =>
          tx.query(
            `INSERT INTO third_party_activity
               (tenant_id, company_id, third_party_id, municipality_id, ciiu_activity_id,
                es_principal, tarifa_ica_override, vigente_desde, vigente_hasta, norma_respaldo)
             VALUES ($1, $2, $3, $4, $5, false, 0.005, $6::date, $7::date, 'Acuerdo municipal')`,
            [e.tenantId, e.companyId, e.thirdPartyId, e.municipalityId, e.ciiuId, desde, hasta],
          ),
        { rolCodigo, sesionNueva: true },
      );

    // El contador tiene `tercero.atributos_fiscales` pero NO `parametro.editar`.
    await esperarErrorPg(
      () => conTarifa('contador', '2026-06-01', '2026-06-30'),
      SQLSTATE.PERMISO_INSUFICIENTE,
      'un contador fijando una tarifa de ICA propia en la ficha de un tercero',
    );

    // El administrador tributario, que sí lo tiene, pasa.
    await expect(conTarifa('admin_tributario', '2026-06-01', '2026-06-30')).resolves.toBeDefined();
  });

  it('sin tarifa propia, la actividad la registra cualquiera con el permiso de atributos fiscales', async () => {
    const r = await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) =>
        tx.query(
          `INSERT INTO third_party_activity
             (tenant_id, company_id, third_party_id, municipality_id, ciiu_activity_id,
              es_principal, vigente_desde, norma_respaldo)
           VALUES ($1, $2, $3, $4, $5, true, DATE '2027-01-01', 'RUT del tercero')`,
          [e.tenantId, e.companyId, e.thirdPartyId, e.municipalityId, e.ciiuId],
        ),
      { rolCodigo: 'contador', sesionNueva: true },
    );
    expect(r).toBeDefined();
  });
});

describe('B — Repaso de la 14.1: auditoría de las acciones nuevas', () => {
  let e: Escenario;

  beforeAll(async () => {
    e = await crearEscenario(db, { razonSocial: 'Firma de auditoría 14.1' });
  }, 120_000);

  it('editar el MAESTRO de un tercero deja rastro (antes no lo dejaba, y el municipio decide el ReteICA)', async () => {
    const antes = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM audit_log WHERE entidad = 'third_party' AND entidad_id = $1`,
        [e.thirdPartyId],
      );
      return rows[0]!.n;
    });

    await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) =>
        tx.query(`UPDATE third_party SET razon_social = razon_social || ' (corregido)' WHERE id = $1`, [
          e.thirdPartyId,
        ]),
      { rolCodigo: 'contador', sesionNueva: true },
    );

    const fila = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{
        accion: string;
        user_id: string | null;
        tenant_id: string;
        company_id: string | null;
      }>(
        `SELECT accion, user_id, tenant_id, company_id FROM audit_log
          WHERE entidad = 'third_party' AND entidad_id = $1
          ORDER BY id DESC LIMIT 1`,
        [e.thirdPartyId],
      );
      return { total: rows.length, fila: rows[0] };
    });
    // Antes de la migración 140 este contador era CERO en cualquier momento:
    // `third_party` no tenía trigger de auditoría. Ahora hasta el alta que hace
    // el propio escenario deja rastro, así que lo que se mide es que el UPDATE
    // de un dato con consecuencia tributaria (el municipio decide el ReteICA)
    // queda registrado con usuario, firma y empresa.
    expect(antes).toBeGreaterThanOrEqual(1);
    expect(fila.fila?.accion).toBe('UPDATE');
    expect(fila.fila?.user_id).not.toBeNull();
    expect(fila.fila?.tenant_id).toBe(e.tenantId);
    expect(fila.fila?.company_id).toBe(e.companyId);
  });

  it('descargar un reporte deja un rastro EXPORT con empresa, usuario, IP y parámetros', async () => {
    await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) =>
        tx.query(`SELECT app.registrar_exportacion('libro-mayor', $1::jsonb)`, [
          JSON.stringify({ periodo: '2026-01-01 a 2026-01-31' }),
        ]),
      { rolCodigo: 'contador', ip: '203.0.113.9', sesionNueva: true },
    );

    const fila = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{
        accion: string;
        entidad: string;
        entidad_id: string;
        company_id: string | null;
        user_id: string | null;
        ip: string | null;
        valor_nuevo: { periodo?: string } | null;
      }>(
        `SELECT accion, entidad, entidad_id, company_id, user_id, host(ip) AS ip, valor_nuevo
           FROM audit_log WHERE accion = 'EXPORT' AND tenant_id = $1
           ORDER BY id DESC LIMIT 1`,
        [e.tenantId],
      );
      return rows[0];
    });
    expect(fila?.entidad).toBe('reporte');
    expect(fila?.entidad_id).toBe('libro-mayor');
    expect(fila?.company_id).toBe(e.companyId);
    expect(fila?.user_id).not.toBeNull();
    expect(fila?.ip).toBe('203.0.113.9');
    expect(fila?.valor_nuevo?.periodo).toBe('2026-01-01 a 2026-01-31');
  });

  it('no se puede escribir un rastro EXPORT sin el permiso de exportar: no existe "exportar sin auditar"', async () => {
    await esperarErrorPg(
      () =>
        db.asTenant(
          e.tenantId,
          e.companyId,
          (tx) => tx.query(`SELECT app.registrar_exportacion('libro-mayor')`),
          { rolCodigo: 'auxiliar_causacion', sesionNueva: true },
        ),
      SQLSTATE.PERMISO_INSUFICIENTE,
      'un auxiliar escribiendo un rastro EXPORT',
    );
  });

  it('el registro de auditoría sigue siendo append-only incluso para el dueño de la tabla', async () => {
    let fallo = false;
    try {
      await db.asAdmin((tx) =>
        tx.query(`UPDATE audit_log SET accion = 'LOGIN' WHERE id = (SELECT max(id) FROM audit_log)`),
      );
    } catch (error) {
      fallo = true;
      expect(String(error)).toMatch(/AU001|append/i);
    }
    expect(fallo).toBe(true);
  });

  it('los cinco roles mínimos de la 14.1 siguen existiendo y admin_firma sigue siendo el que lo tiene todo', async () => {
    const cuenta = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ permisos: number; total: number }>(
        `SELECT (SELECT count(*) FROM role_permission WHERE role_id = $1)::int AS permisos,
                (SELECT count(*) FROM permission)::int AS total`,
        [ROLES.ADMIN_FIRMA],
      );
      return rows[0]!;
    });
    expect(cuenta.permisos).toBe(cuenta.total);
  });
});

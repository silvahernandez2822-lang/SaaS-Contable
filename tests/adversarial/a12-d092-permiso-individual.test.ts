/**
 * A12 · D-092 — Permiso individual por usuario y anti-escalada.
 *
 * NO se prueba «la función de servicio lanza un error»: eso solo demuestra que
 * la capa de aplicación es amable. Cada aserción de seguridad ataca la BASE por
 * SQL directo desde una sesión de negocio real (`asTenant`, RLS activa, sesión
 * emitida) y exige el SQLSTATE del motor — un `throw` de TypeScript no
 * demuestra nada (convención del harness, D-003).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createTestDb, esperarErrorPg } from '../helpers/db.js';
import { crearEscenario, crearUsuarioConCredencial } from '../helpers/fixtures.js';
import { SQLSTATE } from '../../src/db/types.js';
import { ROLES } from '../../src/auth/permisos.js';
import {
  crearRol,
  crearUsuario,
  decidirPermisoIndividual,
  overridesDeUsuario,
  overridesVigentes,
  permisosEfectivosDe,
  listarHistorialDePermisos,
} from '../../src/services/administracion.js';

const db = await createTestDb();

let e: Awaited<ReturnType<typeof crearEscenario>>;
let otra: Awaited<ReturnType<typeof crearEscenario>>;
/** Usuario víctima: rol `auxiliar_causacion`, que NO tiene `reporte.exportar`. */
let auxiliar: string;

async function tienePermisoComo(userId: string, rolId: string, codigo: string): Promise<boolean> {
  return db.asTenant(
    e.tenantId,
    e.companyId,
    async (tx) => {
      const { rows } = await tx.query<{ t: boolean }>('SELECT app.tiene_permiso($1) AS t', [codigo]);
      return rows[0]!.t;
    },
    { userId, rolId, sesionNueva: true },
  );
}

beforeAll(async () => {
  e = await crearEscenario(db);
  otra = await crearEscenario(db);
  auxiliar = (
    await crearUsuarioConCredencial(db, e.tenantId, {
      companyId: e.companyId,
      roleId: ROLES.AUXILIAR_CAUSACION,
    })
  ).userId;
});

describe('D-092 · la excepción individual concede y quita por encima del rol', () => {
  it('el auxiliar NO tiene reporte.exportar por su rol', async () => {
    expect(await tienePermisoComo(auxiliar, ROLES.AUXILIAR_CAUSACION, 'reporte.exportar')).toBe(false);
  });

  it('otorgada la excepción, el MOTOR se la concede — y la vista lo dice con su origen y su motivo', async () => {
    await db.asTenant(e.tenantId, e.companyId, (tx) =>
      decidirPermisoIndividual(tx, {
        userId: auxiliar,
        companyId: e.companyId,
        permisoCodigo: 'reporte.exportar',
        efecto: 'otorgado',
        motivo: 'El contador está incapacitado y hay que presentar la exógena antes del 15.',
      }),
    );

    expect(await tienePermisoComo(auxiliar, ROLES.AUXILIAR_CAUSACION, 'reporte.exportar')).toBe(true);

    const efectivos = await db.asTenant(e.tenantId, e.companyId, (tx) => permisosEfectivosDe(tx, auxiliar));
    const fila = efectivos.flatMap((g) => g.permisos).find((p) => p.codigo === 'reporte.exportar');
    expect(fila?.origen).toBe('excepcion_individual');
    expect(fila?.motivo).toContain('incapacitado');
  });

  it('revocar NO borra: inserta una decisión nueva, y el permiso se apaga', async () => {
    const antes = await db.asTenant(e.tenantId, e.companyId, (tx) => overridesDeUsuario(tx, auxiliar));

    await db.asTenant(e.tenantId, e.companyId, (tx) =>
      decidirPermisoIndividual(tx, {
        userId: auxiliar,
        companyId: e.companyId,
        permisoCodigo: 'reporte.exportar',
        efecto: 'revocado',
        motivo: 'El contador volvió de la incapacidad; la excepción ya no hace falta.',
      }),
    );

    const despues = await db.asTenant(e.tenantId, e.companyId, (tx) => overridesDeUsuario(tx, auxiliar));
    expect(despues.length).toBe(antes.length + 1);
    // La fila que otorgó SIGUE ahí: es la garantía de trazabilidad.
    expect(despues.some((o) => o.efecto === 'otorgado' && o.motivo.includes('incapacitado'))).toBe(true);
    expect(despues.filter((o) => o.vigente).length).toBe(1);
    expect(despues.find((o) => o.vigente)!.efecto).toBe('revocado');

    expect(await tienePermisoComo(auxiliar, ROLES.AUXILIAR_CAUSACION, 'reporte.exportar')).toBe(false);
  });

  it('una excepción REVOCA un permiso que el rol sí concede', async () => {
    expect(await tienePermisoComo(auxiliar, ROLES.AUXILIAR_CAUSACION, 'documento.leer')).toBe(true);
    await db.asTenant(e.tenantId, e.companyId, (tx) =>
      decidirPermisoIndividual(tx, {
        userId: auxiliar,
        companyId: e.companyId,
        permisoCodigo: 'documento.leer',
        efecto: 'revocado',
        motivo: 'Investigación interna en curso: se le suspende el acceso a documentos mientras dure.',
      }),
    );
    expect(await tienePermisoComo(auxiliar, ROLES.AUXILIAR_CAUSACION, 'documento.leer')).toBe(false);

    // Y se le devuelve, para no dejar el escenario roto para las pruebas siguientes.
    await db.asTenant(e.tenantId, e.companyId, (tx) =>
      decidirPermisoIndividual(tx, {
        userId: auxiliar,
        companyId: e.companyId,
        permisoCodigo: 'documento.leer',
        efecto: 'otorgado',
        motivo: 'Cerrada la investigación sin hallazgos: se le restituye el acceso a documentos.',
      }),
    );
    expect(await tienePermisoComo(auxiliar, ROLES.AUXILIAR_CAUSACION, 'documento.leer')).toBe(true);
  });

  it('una excepción VENCIDA no cuenta: el permiso vuelve a resolverse por el rol', async () => {
    const { userId: usuario } = await crearUsuarioConCredencial(db, e.tenantId, {
      companyId: e.companyId,
      roleId: ROLES.AUXILIAR_CAUSACION,
    });

    // Se inserta con `vence_en` ya pasada desde `asAdmin` (sin sesión, el
    // guardia se salta a propósito) para no tener que esperar en la prueba.
    await db.asAdmin((tx) =>
      tx.query(
        `INSERT INTO user_permission_override
           (tenant_id, company_id, user_id, permission_codigo, efecto, motivo, vence_en)
         VALUES ($1, $2, $3, 'reporte.exportar', 'otorgado', 'Excepcion de prueba ya vencida', now() - interval '1 day')`,
        [e.tenantId, e.companyId, usuario],
      ),
    );

    expect(await tienePermisoComo(usuario, ROLES.AUXILIAR_CAUSACION, 'reporte.exportar')).toBe(false);
  });

  it('el motor exige el motivo, no solo el servicio', async () => {
    await esperarErrorPg(
      () =>
        db.asTenant(e.tenantId, e.companyId, (tx) =>
          tx.query(
            `INSERT INTO user_permission_override
               (tenant_id, company_id, user_id, permission_codigo, efecto, motivo)
             VALUES ($1, $2, $3, 'reporte.exportar', 'otorgado', 'x')`,
            [e.tenantId, e.companyId, auxiliar],
          ),
        ),
      SQLSTATE.CHECK_VIOLATION,
      'un motivo de una letra no es un motivo',
    );
  });

  it('una decisión de permiso no se edita ni se borra (PO003), tampoco desde el superusuario', async () => {
    const id = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const filas = await overridesDeUsuario(tx, auxiliar);
      return filas[0]!.id;
    });

    await esperarErrorPg(
      () =>
        db.asTenant(e.tenantId, e.companyId, (tx) =>
          tx.query("UPDATE user_permission_override SET motivo = 'otro motivo cualquiera' WHERE id = $1", [id]),
        ),
      SQLSTATE.OVERRIDE_INMUTABLE,
      'editar una decisión de permiso',
    );
    await esperarErrorPg(
      () => db.asAdmin((tx) => tx.query('DELETE FROM user_permission_override WHERE id = $1', [id])),
      SQLSTATE.OVERRIDE_INMUTABLE,
      'ni el superusuario borra una decisión de permiso',
    );
  });
});

describe('D-092 · nadie se asciende a sí mismo (PO001) ni concede lo que no ejerce (PO002)', () => {
  /** Rol propio con SOLO `usuario.administrar`: el administrador acotado. */
  let rolAdminAcotado: string;
  let adminAcotado: string;

  beforeAll(async () => {
    rolAdminAcotado = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const { id } = await crearRol(tx, {
        codigo: 'admin_acotado',
        nombre: 'Administrador acotado',
        descripcion: 'Administra usuarios y nada más. Existe para probar la anti-escalada de D-092.',
        permisos: ['usuario.administrar', 'usuario.leer'],
      });
      return id;
    });
    adminAcotado = (
      await crearUsuarioConCredencial(db, e.tenantId, {
        companyId: e.companyId,
        roleId: rolAdminAcotado,
      })
    ).userId;
  });

  it('el administrador acotado NO tiene asiento.publicar', async () => {
    expect(await tienePermisoComo(adminAcotado, rolAdminAcotado, 'asiento.publicar')).toBe(false);
  });

  it('no puede METER asiento.publicar en un rol propio (PO002, INSERT directo)', async () => {
    const rolTitere = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const { id } = await crearRol(tx, {
        codigo: 'titere_prueba',
        nombre: 'Títere',
        descripcion: 'Rol vacío que la prueba intenta llenar desde una sesión acotada.',
        permisos: [],
      });
      return id;
    });

    await esperarErrorPg(
      () =>
        db.asTenant(
          e.tenantId,
          e.companyId,
          (tx) =>
            tx.query('INSERT INTO role_permission (role_id, permission_codigo) VALUES ($1, $2)', [
              rolTitere,
              'asiento.publicar',
            ]),
          { userId: adminAcotado, rolId: rolAdminAcotado, sesionNueva: true },
        ),
      SQLSTATE.ESCALADA_DE_PRIVILEGIO,
      'meter en un rol un permiso que uno no ejerce',
    );
  });

  it('sí puede QUITAR un permiso de un rol: bajar no es escalar', async () => {
    const rolConAlgo = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const { id } = await crearRol(tx, {
        codigo: 'con_algo_prueba',
        nombre: 'Con algo',
        descripcion: 'Rol con un permiso que la sesión acotada debe poder quitar.',
        permisos: ['asiento.publicar'],
      });
      return id;
    });

    await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) => tx.query('DELETE FROM role_permission WHERE role_id = $1', [rolConAlgo]),
      { userId: adminAcotado, rolId: rolAdminAcotado, sesionNueva: true },
    );

    const quedan = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM role_permission WHERE role_id = $1',
        [rolConAlgo],
      );
      return Number(rows[0]!.n);
    });
    expect(quedan).toBe(0);
  });

  it('no puede AUTO-ASIGNARSE un rol de sistema que trae lo que él no tiene (PO002)', async () => {
    await esperarErrorPg(
      () =>
        db.asTenant(
          e.tenantId,
          e.companyId,
          (tx) =>
            tx.query(
              `INSERT INTO user_company_access (tenant_id, company_id, user_id, role_id)
               VALUES ($1, $2, $3, $4)`,
              [e.tenantId, e.companyId, adminAcotado, ROLES.CONTADOR],
            ),
          { userId: adminAcotado, rolId: rolAdminAcotado, sesionNueva: true },
        ),
      SQLSTATE.ESCALADA_DE_PRIVILEGIO,
      'auto-asignarse un rol que confiere lo que uno no ejerce',
    );
  });

  it('tampoco puede repartir el rol todopoderoso (PO002)', async () => {
    const { userId: victima } = await crearUsuarioConCredencial(db, e.tenantId, { companyId: e.companyId });
    await esperarErrorPg(
      () =>
        db.asTenant(
          e.tenantId,
          e.companyId,
          (tx) =>
            tx.query(
              `INSERT INTO user_company_access (tenant_id, company_id, user_id, role_id)
               VALUES ($1, $2, $3, $4)`,
              [e.tenantId, e.companyId, victima, ROLES.ADMIN_FIRMA],
            ),
          { userId: adminAcotado, rolId: rolAdminAcotado, sesionNueva: true },
        ),
      SQLSTATE.ESCALADA_DE_PRIVILEGIO,
      'repartir el rol todopoderoso sin ser todopoderoso',
    );
  });

  it('no puede concederse a SÍ MISMO una excepción, ni siquiera de algo que ya tiene (PO001)', async () => {
    await esperarErrorPg(
      () =>
        db.asTenant(
          e.tenantId,
          e.companyId,
          (tx) =>
            tx.query(
              `INSERT INTO user_permission_override
                 (tenant_id, company_id, user_id, permission_codigo, efecto, motivo)
               VALUES ($1, $2, $3, 'usuario.leer', 'otorgado', 'Me lo doy yo mismo, que para eso administro.')`,
              [e.tenantId, e.companyId, adminAcotado],
            ),
          { userId: adminAcotado, rolId: rolAdminAcotado, sesionNueva: true },
        ),
      SQLSTATE.AUTO_OTORGAMIENTO,
      'concederse una excepción a sí mismo',
    );
  });

  it('no puede conceder a OTRO una excepción de lo que él no ejerce (PO002)', async () => {
    await esperarErrorPg(
      () =>
        db.asTenant(
          e.tenantId,
          e.companyId,
          (tx) =>
            tx.query(
              `INSERT INTO user_permission_override
                 (tenant_id, company_id, user_id, permission_codigo, efecto, motivo)
               VALUES ($1, $2, $3, 'asiento.publicar', 'otorgado', 'Que publique el, total, alguien tiene que hacerlo.')`,
              [e.tenantId, e.companyId, auxiliar],
            ),
          { userId: adminAcotado, rolId: rolAdminAcotado, sesionNueva: true },
        ),
      SQLSTATE.ESCALADA_DE_PRIVILEGIO,
      'conceder una excepción de lo que uno no ejerce',
    );
  });

  it('el administrador de firma (todopoderoso) sigue pudiendo repartirlo todo: las puertas no le estorban', async () => {
    const { userId: victima } = await crearUsuarioConCredencial(db, e.tenantId, { companyId: e.companyId });
    await db.asTenant(e.tenantId, e.companyId, (tx) =>
      decidirPermisoIndividual(tx, {
        userId: victima,
        companyId: e.companyId,
        permisoCodigo: 'asiento.publicar',
        efecto: 'otorgado',
        motivo: 'Prueba de que el rol todopoderoso no queda atrapado por su propia anti-escalada.',
      }),
    );
    expect(await tienePermisoComo(victima, ROLES.CONTADOR, 'asiento.publicar')).toBe(true);
  });

  it('una excepción NO puede quitarle nada al rol todopoderoso: el motor la ignora', async () => {
    const { userId: admin } = await crearUsuarioConCredencial(db, e.tenantId, {
      companyId: e.companyId,
      roleId: ROLES.ADMIN_FIRMA,
    });
    await db.asAdmin((tx) =>
      tx.query(
        `INSERT INTO user_permission_override
           (tenant_id, company_id, user_id, permission_codigo, efecto, motivo)
         VALUES ($1, $2, $3, 'usuario.administrar', 'revocado', 'Intento de dejar a la firma sin administrador.')`,
        [e.tenantId, e.companyId, admin],
      ),
    );
    // Si esto fuera `false`, un clic dejaría a la firma sin nadie que otorgue
    // permisos: exactamente el agujero que D-066 cerró con RL001, reabierto
    // por otra puerta.
    expect(await tienePermisoComo(admin, ROLES.ADMIN_FIRMA, 'usuario.administrar')).toBe(true);
  });
});

describe('D-092 · aislamiento (Regla de Oro 7)', () => {
  it('la firma B no ve ni una excepción de la firma A', async () => {
    const deA = await db.asTenant(e.tenantId, e.companyId, (tx) => overridesVigentes(tx));
    expect(deA.length).toBeGreaterThan(0);

    const deB = await db.asTenant(otra.tenantId, otra.companyId, (tx) => overridesVigentes(tx));
    expect(deB).toEqual([]);
  });

  it('el aislamiento lo impone la RLS, no un filtro de aplicación', async () => {
    const sinRls = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM user_permission_override',
      );
      return Number(rows[0]!.n);
    });
    const conRlsDeB = await db.asTenant(otra.tenantId, otra.companyId, async (tx) => {
      const { rows } = await tx.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM user_permission_override',
      );
      return Number(rows[0]!.n);
    });
    expect(sinRls).toBeGreaterThan(0);
    expect(conRlsDeB).toBe(0);
  });

  it('el servicio no lleva ni un filtro de aplicación por tenant o empresa', async () => {
    const { readFileSync } = await import('node:fs');
    const fuente = readFileSync('src/services/administracion.ts', 'utf8');
    const bloque = fuente.slice(fuente.indexOf('const SQL_OVERRIDES'), fuente.indexOf('export interface DecidirPermisoInput'));
    expect(bloque).not.toContain('tenant_id =');
    expect(bloque).not.toContain('company_id =');
  });

  it('una excepción no puede apuntar al usuario de otra firma', async () => {
    await esperarErrorPg(
      () =>
        db.asTenant(e.tenantId, e.companyId, (tx) =>
          tx.query(
            `INSERT INTO user_permission_override
               (tenant_id, company_id, user_id, permission_codigo, efecto, motivo)
             VALUES ($1, $2, $3, 'reporte.leer', 'otorgado', 'Intento de alcanzar a un usuario ajeno.')`,
            [e.tenantId, e.companyId, otra.userId],
          ),
        ),
      SQLSTATE.FOREIGN_KEY_VIOLATION,
      'la FK compuesta amarra el usuario a la firma',
    );
  });
});

describe('D-092 · el historial de permisos', () => {
  it('registra la excepción con su motivo, y también el alta de usuario y el rol', async () => {
    const historial = await db.asTenant(e.tenantId, e.companyId, (tx) => listarHistorialDePermisos(tx));
    expect(historial.total).toBeGreaterThan(0);

    const excepcion = historial.filas.find((f) => f.entidad === 'user_permission_override');
    expect(excepcion).toBeDefined();
    expect(excepcion!.motivo).toBeTruthy();
    expect(excepcion!.resumen).toMatch(/Otorg|Revoc/);

    expect(historial.filas.some((f) => f.entidad === 'user')).toBe(true);
    expect(historial.filas.some((f) => f.entidad === 'role' || f.entidad === 'role_permission')).toBe(true);
  });

  it('la firma B no ve un solo movimiento de la firma A', async () => {
    const deB = await db.asTenant(otra.tenantId, otra.companyId, (tx) => listarHistorialDePermisos(tx));
    const deA = await db.asTenant(e.tenantId, e.companyId, (tx) => listarHistorialDePermisos(tx));
    expect(deA.total).toBeGreaterThan(0);
    expect(deB.total).toBeLessThan(deA.total);
    expect(deB.filas.some((f) => f.autorEmail?.includes('-' + e.tenantId))).toBe(false);
  });

  it('una página absurda no rompe ni devuelve de más (patrón V-52)', async () => {
    for (const opciones of [
      { pagina: Number.NaN },
      { pagina: Infinity },
      { pagina: -1 },
      { porPagina: 10_000 },
      { porPagina: 0 },
    ]) {
      const r = await db.asTenant(e.tenantId, e.companyId, (tx) => listarHistorialDePermisos(tx, opciones));
      expect(r.filas.length).toBeLessThanOrEqual(200);
      expect(r.pagina).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('D-092 · /admin salió de PREFIJOS_SIN_MIGRAR y no quedó un solo hexadecimal', () => {
  it('el shell ya no pinta /admin con tema claro fijo', async () => {
    const { readFileSync } = await import('node:fs');
    const shell = readFileSync('app/_ui/AppShell.tsx', 'utf8');
    /* Misma lectura que usa la compuerta de D-087, para que las dos midan lo
     * mismo y no se puedan contradecir. */
    const linea = /const PREFIJOS_SIN_MIGRAR = \[([^\]]*)\]/.exec(shell);
    expect(linea).not.toBeNull();
    const contenido = linea![1] ?? '';
    expect(contenido).not.toContain('/admin');
    // Y ya no queda NINGÚN módulo con el cuerpo sin migrar.
    expect(contenido.trim()).toBe('');
  });

  it('ninguna pantalla de /admin lleva `style=` inline ni un `#hex` suelto', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const archivos: string[] = [];
    const recorrer = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = `${dir}/${n}`;
        if (statSync(p).isDirectory()) recorrer(p);
        else if (p.endsWith('.tsx') || p.endsWith('.ts')) archivos.push(p);
      }
    };
    recorrer('app/admin');
    expect(archivos.length).toBeGreaterThanOrEqual(8);

    const sucios = archivos.filter((p) => {
      const t = readFileSync(p, 'utf8');
      return /style=\{\{/.test(t) || /#[0-9a-fA-F]{3,8}\b/.test(t);
    });
    expect(sucios).toEqual([]);
  });
});

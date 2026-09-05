/**
 * A14 — COMPUERTA DE CIERRE DE D-092-bis. Arsenal propio, cero reutilización.
 *
 * A12 corrigió en tercera pasada el defecto del «administrador acotado» (un rol
 * propio de firma con UN solo permiso, `usuario.administrar`, que reventaba
 * TODA ruta porque el layout raíz llama a `app.empresas_accesibles()`, que
 * exige `documento.leer`). Nada de esa ficha se da por bueno aquí: se vuelve a
 * medir contra la base, y se ataca lo que su prueba NO cubre.
 *
 * Lo que esta compuerta añade respecto de la prueba de A12:
 *
 *  · LA FIRMA CON MÁS DE UNA EMPRESA. La prueba de A12 monta un escenario de
 *    UNA empresa por firma, que es justo el caso en el que su parche funciona.
 *    El producto se vende a firmas con 30-60 empresas-cliente. Con dos empresas
 *    y acceso a una sola, `obtenerBandejaConsolidada` recorría la lista de la
 *    FIRMA abriendo una sesión por empresa — incluidas aquellas sobre las que
 *    el usuario no tiene acceso—, y eso lanza `EmpresaNoAutorizadaError`
 *    (`withSessionContext`) además de escribir un `ACCESO_DENEGADO` falso en
 *    `audit_log` por cada empresa ajena. V-59.
 *  · LA BANDEJA POR EMPRESA de verdad: dos empresas con acceso real, excepción
 *    individual que quita `documento.leer` en una sola, y se exige que la otra
 *    salga COMPLETA y que `empresasTruncadas` (D-079) siga funcionando a la vez
 *    que `empresasSinPermiso`.
 *  · LA DEUDA QUE A12 DECLARÓ SIN MEDIR: `/terceros` y `/parametros` con el rol
 *    acotado.
 *  · Que `sin_permiso` no filtre nada (nombres, NITs) por la puerta de atrás.
 *
 * Todo por la interfaz real (acciones/agregadores de `app/`), con la cookie de
 * sesión y la RLS puestas: lo único simulado es el transporte de Next.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDb, uuid, type TestDb } from '../helpers/db';
import { crearEscenario, crearUsuarioConCredencial, type Escenario } from '../helpers/fixtures';
import { ROLES } from '../../src/auth/permisos';
import { SQLSTATE, type DbHandle, type SqlClient } from '../../src/db/types';

// -----------------------------------------------------------------------------
// Transporte de Next simulado — y NADA más
// -----------------------------------------------------------------------------
const cookieState = new Map<string, string>();
const cabeceras = new Map<string, string>([
  ['user-agent', 'A14/compuerta-d092bis'],
  ['x-forwarded-for', '203.0.113.77'],
]);

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nombre: string) => {
      const value = cookieState.get(nombre);
      return value === undefined ? undefined : { name: nombre, value };
    },
  }),
  headers: async () => cabeceras,
}));

let db: TestDb;

vi.mock('../../app/lib/db.js', () => ({
  obtenerDb: async (): Promise<DbHandle> => db.client,
}));

db = await createTestDb();

const { obtenerBandejaConsolidada } = await import('../../app/lib/bandeja');
const { empresasVisiblesParaLaSesion, explicacionDeOrigen, sesionTienePermiso } = await import(
  '../../app/lib/empresas'
);
const { crearRol, listarEmpresasDeLaFirma, decidirPermisoIndividual } = await import(
  '../../src/services/administracion'
);
const { listarEmpresasAccesibles } = await import('../../src/services/bandeja');
const { listarTerceros, puedeEditarTerceros } = await import('../../src/services/terceros');
const { detectarAlertasParametrizacion } = await import('../../src/services/parametrizacion');

async function ponerSesion(
  tenantId: string,
  companyIdAcceso: string,
  extra: { userId?: string; rolId?: string; rolCodigo?: string; companyEnCookie?: string | null } = {},
): Promise<string> {
  const { token, userId } = await db.emitirSesion(tenantId, companyIdAcceso, {
    userId: extra.userId,
    rolId: extra.rolId,
    rolCodigo: extra.rolCodigo,
    sesionNueva: true,
  });
  cookieState.set('session_token', token);
  const enCookie = extra.companyEnCookie === undefined ? companyIdAcceso : extra.companyEnCookie;
  if (enCookie) cookieState.set('company_id', enCookie);
  else cookieState.delete('company_id');
  return userId;
}

/** Ejecuta `fn` como el usuario/rol dados, sin pasar por la cookie. */
async function como<T>(
  tenantId: string,
  userId: string,
  rolId: string,
  companyId: string,
  fn: (tx: SqlClient) => Promise<T>,
): Promise<T> {
  return db.asTenant(tenantId, companyId, fn, { userId, rolId, sesionNueva: true });
}

// =============================================================================
// ESCENARIO — una firma con DOS empresas, que es el producto real
// =============================================================================

let firma: Escenario;
let otraFirma: Escenario;
/** Segunda empresa de la MISMA firma. */
let segundaCompanyId = '';
let segundaRazonSocial = '';
let rolAcotadoId = '';
let acotado = '';
/** Rol sin `documento.leer` ni `usuario.administrar`. */
let rolMudoId = '';
let mudo = '';
/** Contador con acceso a las DOS empresas. */
let contador = '';

async function crearSegundaEmpresa(e: Escenario): Promise<{ id: string; razonSocial: string }> {
  const id = uuid();
  const razonSocial = `Segunda empresa de la firma ${id.slice(0, 8)}`;
  await db.asAdmin(async (tx) => {
    await tx.query(
      `INSERT INTO company (id, tenant_id, nit, razon_social, municipality_id, ciiu_principal_id,
                            es_agente_retencion_renta, buzon_email)
       VALUES ($1, $2, $3, $4, $5, $6, true, $7)`,
      [
        id,
        e.tenantId,
        `801${id.slice(0, 8).replace(/-/g, '')}`,
        razonSocial,
        e.municipalityId,
        e.ciiuId,
        `segunda-${id.slice(0, 8)}@inbox.ejemplo.co`,
      ],
    );
  });
  return { id, razonSocial };
}

beforeAll(async () => {
  firma = await crearEscenario(db, { razonSocial: 'Firma de la compuerta D-092-bis' });
  otraFirma = await crearEscenario(db, { razonSocial: 'Firma ajena de la compuerta D-092-bis' });

  const segunda = await crearSegundaEmpresa(firma);
  segundaCompanyId = segunda.id;
  segundaRazonSocial = segunda.razonSocial;

  const rol = await db.asTenant(firma.tenantId, firma.companyId, (tx) =>
    crearRol(tx, {
      codigo: 'a14_admin_acotado',
      nombre: 'Administrador acotado (A14)',
      descripcion: 'Un solo permiso: usuario.administrar. El caso que /admin/roles ofrece.',
      permisos: ['usuario.administrar'],
    }),
  );
  rolAcotadoId = rol.id;
  acotado = (
    await crearUsuarioConCredencial(db, firma.tenantId, {
      companyId: firma.companyId,
      roleId: rolAcotadoId,
    })
  ).userId;

  const mudoRol = await db.asTenant(firma.tenantId, firma.companyId, (tx) =>
    crearRol(tx, {
      codigo: 'a14_mudo',
      nombre: 'Sin documento.leer ni usuario.administrar (A14)',
      descripcion: 'Solo lee parametros.',
      permisos: ['parametro.leer'],
    }),
  );
  rolMudoId = mudoRol.id;
  mudo = (
    await crearUsuarioConCredencial(db, firma.tenantId, {
      companyId: firma.companyId,
      roleId: rolMudoId,
    })
  ).userId;

  // Contador con acceso a LAS DOS empresas de la firma.
  contador = (
    await crearUsuarioConCredencial(db, firma.tenantId, {
      companyId: firma.companyId,
      roleId: ROLES.CONTADOR,
    })
  ).userId;
  await db.asAdmin((tx) =>
    tx.query(
      `INSERT INTO user_company_access (tenant_id, company_id, user_id, role_id)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [firma.tenantId, segundaCompanyId, contador, ROLES.CONTADOR],
    ),
  );
}, 240_000);

afterAll(async () => {
  await db?.close();
});

// =============================================================================
// 1 — EL MOTOR NO SE RELAJÓ (si esto se pone verde, alguien "arregló" mal)
// =============================================================================

describe('A14 · D-092-bis — el motor sigue igual de estricto', () => {
  it('app.empresas_accesibles() sigue exigiendo documento.leer (SE002) para el rol acotado', async () => {
    const codigo = await como(firma.tenantId, acotado, rolAcotadoId, '', async (tx) => {
      try {
        await listarEmpresasAccesibles(tx);
        return 'NO-FALLO';
      } catch (e) {
        return (e as { code?: string }).code ?? `js:${String(e)}`;
      }
    });
    expect(codigo).toBe(SQLSTATE.PERMISO_INSUFICIENTE);
  });

  it('el rol acotado no tiene documento.leer ni con empresa ni sin empresa', async () => {
    expect(
      await como(firma.tenantId, acotado, rolAcotadoId, '', (tx) => sesionTienePermiso(tx, 'documento.leer')),
    ).toBe(false);
    expect(
      await como(firma.tenantId, acotado, rolAcotadoId, firma.companyId, (tx) =>
        sesionTienePermiso(tx, 'documento.leer'),
      ),
    ).toBe(false);
  });
});

// =============================================================================
// 2 — V-59: LA FIRMA CON MÁS DE UNA EMPRESA
// =============================================================================

describe('A14 · V-59 — la portada de una firma con DOS empresas', () => {
  /**
   * EL ATAQUE. `empresasVisiblesParaLaSesion` con origen `firma` devuelve las
   * empresas de la FIRMA, no «las mías» (así lo declara la propia ficha). El
   * agregador de la bandeja recorría esa lista abriendo `conSesionEmpresa` por
   * cada una, y `withSessionContext` RECHAZA una empresa sobre la que la sesión
   * no tiene acceso: `EmpresaNoAutorizadaError`. Con una empresa por firma
   * —el escenario de la prueba de A12— nunca se ve. Con dos, la portada vuelve
   * a reventar exactamente igual que antes del parche.
   */
  it('la bandeja consolidada NO revienta con una empresa de la firma a la que el acotado no tiene acceso', async () => {
    await ponerSesion(firma.tenantId, firma.companyId, {
      userId: acotado,
      rolId: rolAcotadoId,
      companyEnCookie: null,
    });
    const bandeja = await obtenerBandejaConsolidada();
    expect(bandeja.puedeLeerDocumentos).toBe(false);
    expect(bandeja.pendientesAprobacion).toEqual([]);
  });

  it('y no deja ni un ACCESO_DENEGADO falso en el audit_log al pintar la portada', async () => {
    const antes = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM audit_log
          WHERE tenant_id = $1 AND accion = 'ACCESO_DENEGADO'`,
        [firma.tenantId],
      );
      return Number(rows[0]!.n);
    });
    await ponerSesion(firma.tenantId, firma.companyId, {
      userId: acotado,
      rolId: rolAcotadoId,
      companyEnCookie: null,
    });
    await obtenerBandejaConsolidada();
    const despues = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM audit_log
          WHERE tenant_id = $1 AND accion = 'ACCESO_DENEGADO'`,
        [firma.tenantId],
      );
      return Number(rows[0]!.n);
    });
    // Un usuario que abre su portada no es un intento de intrusión. Si esto
    // sube, la alarma de seguridad se llena de ruido generado por el producto.
    expect(despues).toBe(antes);
  });

  it('el selector del shell sí sigue listando las empresas de la firma para administrarlas', async () => {
    const visibles = await como(firma.tenantId, acotado, rolAcotadoId, '', (tx) =>
      empresasVisiblesParaLaSesion(tx),
    );
    expect(visibles.origen).toBe('firma');
    expect(visibles.empresas.map((x) => x.companyId).sort()).toEqual(
      [firma.companyId, segundaCompanyId].sort(),
    );
  });
});

// =============================================================================
// 3 — AISLAMIENTO DE LA PUERTA NUEVA (Regla de Oro 7)
// =============================================================================

describe('A14 · D-092-bis — listarEmpresasDeLaFirma no cruza de firma', () => {
  it('la firma A no ve ni el id, ni el NIT, ni la razón social de la empresa de la firma B', async () => {
    const empresas = await como(firma.tenantId, acotado, rolAcotadoId, '', (tx) =>
      listarEmpresasDeLaFirma(tx),
    );
    const ajena = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ nit: string; razon_social: string }>(
        'SELECT nit, razon_social FROM company WHERE id = $1',
        [otraFirma.companyId],
      );
      return rows[0]!;
    });
    expect(empresas.map((x) => x.companyId)).not.toContain(otraFirma.companyId);
    expect(empresas.map((x) => x.nit)).not.toContain(ajena.nit);
    expect(empresas.map((x) => x.razonSocial)).not.toContain(ajena.razon_social);
  });

  it('usuario.administrar es NECESARIO: sin él la puerta nueva no se abre ni saltándose la interfaz', async () => {
    await expect(
      como(firma.tenantId, mudo, rolMudoId, firma.companyId, (tx) => listarEmpresasDeLaFirma(tx)),
    ).rejects.toThrow(/usuario\.administrar/);
    await expect(
      como(firma.tenantId, mudo, rolMudoId, '', (tx) => listarEmpresasDeLaFirma(tx)),
    ).rejects.toThrow(/usuario\.administrar/);
  });

  it('usuario.administrar es SUFICIENTE: con ese único permiso lista, con y sin empresa en contexto', async () => {
    const sinEmpresa = await como(firma.tenantId, acotado, rolAcotadoId, '', (tx) =>
      listarEmpresasDeLaFirma(tx),
    );
    const conEmpresa = await como(firma.tenantId, acotado, rolAcotadoId, firma.companyId, (tx) =>
      listarEmpresasDeLaFirma(tx),
    );
    expect(sinEmpresa.length).toBe(2);
    expect(conEmpresa.length).toBe(2);
  });

  it('el origen sin_permiso no filtra NADA: lista vacía y explicación sin nombres ni NITs', async () => {
    const visibles = await como(firma.tenantId, mudo, rolMudoId, '', (tx) =>
      empresasVisiblesParaLaSesion(tx),
    );
    expect(visibles.origen).toBe('sin_permiso');
    expect(visibles.empresas).toEqual([]);
    const texto = explicacionDeOrigen('sin_permiso') ?? '';
    const nombres = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ nit: string; razon_social: string }>('SELECT nit, razon_social FROM company');
      return rows;
    });
    for (const n of nombres) {
      expect(texto).not.toContain(n.nit);
      expect(texto).not.toContain(n.razon_social);
    }
  });

  it('explicacionDeOrigen del camino normal no dice nada (no hay nada que explicar)', () => {
    expect(explicacionDeOrigen('accesibles')).toBeNull();
  });
});

// =============================================================================
// 4 — LA BANDEJA POR EMPRESA, CON DOS EMPRESAS DE VERDAD
// =============================================================================

describe('A14 · D-092-bis — documento.leer revocado en UNA sola empresa', () => {
  it('la empresa sin permiso queda anotada y la otra sale completa', async () => {
    // La excepción individual de D-092 es POR EMPRESA: se le quita
    // `documento.leer` al contador SOLO en la segunda empresa.
    await db.asTenant(firma.tenantId, segundaCompanyId, (tx) =>
      decidirPermisoIndividual(tx, {
        userId: contador,
        companyId: segundaCompanyId,
        permisoCodigo: 'documento.leer',
        efecto: 'revocado',
        motivo: 'Auditoría interna de A14: se le suspende la lectura de documentos en esta empresa.',
      }),
    );

    await ponerSesion(firma.tenantId, firma.companyId, {
      userId: contador,
      rolCodigo: 'contador',
      companyEnCookie: null,
    });
    const bandeja = await obtenerBandejaConsolidada();

    // Camino normal: la sesión de FIRMA sí tiene el permiso (la excepción es
    // por empresa), así que la lista de empresas sale por la vía de siempre.
    expect(bandeja.puedeLeerDocumentos).toBe(true);
    expect(bandeja.empresas.length).toBe(2);
    // ...y la empresa donde el permiso está revocado se SALTA y se anota.
    expect(bandeja.empresasSinPermiso).toEqual([segundaRazonSocial]);
    // `empresasTruncadas` (D-079) no se pisa con el aviso nuevo.
    expect(bandeja.empresasTruncadas).toEqual([]);
  });

  it('devuelto el permiso, la empresa vuelve a la bandeja sin rastro del aviso', async () => {
    await db.asTenant(firma.tenantId, segundaCompanyId, (tx) =>
      decidirPermisoIndividual(tx, {
        userId: contador,
        companyId: segundaCompanyId,
        permisoCodigo: 'documento.leer',
        efecto: 'otorgado',
        motivo: 'Terminada la auditoría interna de A14: se le devuelve la lectura de documentos.',
      }),
    );
    await ponerSesion(firma.tenantId, firma.companyId, {
      userId: contador,
      rolCodigo: 'contador',
      companyEnCookie: null,
    });
    const bandeja = await obtenerBandejaConsolidada();
    expect(bandeja.empresasSinPermiso).toEqual([]);
    expect(bandeja.puedeLeerDocumentos).toBe(true);
    expect(bandeja.empresas.length).toBe(2);
  });
});

// =============================================================================
// 4-bis — V-60: EL ALCANCE DE LA EXCEPCIÓN INDIVIDUAL EN LA SESIÓN DE FIRMA
// =============================================================================

describe('A14 · V-60 — la excepción individual es POR EMPRESA, también en la sesión de firma', () => {
  /** Usuario propio de este bloque para no contaminar los anteriores. */
  let victima = '';

  beforeAll(async () => {
    victima = (
      await crearUsuarioConCredencial(db, firma.tenantId, {
        companyId: firma.companyId,
        roleId: ROLES.CONTADOR,
      })
    ).userId;
    await db.asAdmin((tx) =>
      tx.query(
        `INSERT INTO user_company_access (tenant_id, company_id, user_id, role_id)
         VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [firma.tenantId, segundaCompanyId, victima, ROLES.CONTADOR],
      ),
    );
    await db.asTenant(firma.tenantId, segundaCompanyId, (tx) =>
      decidirPermisoIndividual(tx, {
        userId: victima,
        companyId: segundaCompanyId,
        permisoCodigo: 'documento.leer',
        efecto: 'revocado',
        motivo: 'Compuerta de A14: revocación acotada a UNA de las dos empresas de la firma.',
      }),
    );
  });

  async function tiene(companyId: string, codigo: string): Promise<boolean> {
    return como(firma.tenantId, victima, ROLES.CONTADOR, companyId, (tx) => sesionTienePermiso(tx, codigo));
  }

  it('revocar en la empresa B no toca la empresa A (esto ya era así)', async () => {
    expect(await tiene(firma.companyId, 'documento.leer')).toBe(true);
    expect(await tiene(segundaCompanyId, 'documento.leer')).toBe(false);
  });

  /**
   * EL DEFECTO. Antes de la 185, la sesión de firma —la del LAYOUT RAÍZ, o sea
   * TODA ruta— se quedaba con la excepción más reciente de CUALQUIER empresa y
   * dejaba que decidiera por toda la firma: `false`. Consecuencia real:
   * `app.empresas_accesibles()` (que exige `documento.leer`) rechaza, la
   * aplicación degrada a `sin_permiso`, el selector se queda VACÍO y el
   * contador ya no puede ni volver a la empresa A, donde su permiso está
   * intacto. Bloqueo total, por la puerta de al lado del que cerró D-092-bis.
   */
  it('y NO veta la sesión de firma: sigue habiendo una empresa donde el permiso vive', async () => {
    expect(await tiene('', 'documento.leer')).toBe(true);
  });

  it('la portada del contador con la revocación acotada sigue viva y dice la verdad', async () => {
    await ponerSesion(firma.tenantId, firma.companyId, {
      userId: victima,
      rolCodigo: 'contador',
      companyEnCookie: null,
    });
    const bandeja = await obtenerBandejaConsolidada();
    expect(bandeja.puedeLeerDocumentos).toBe(true);
    expect(bandeja.empresas.length).toBe(2);
    expect(bandeja.empresasSinPermiso).toEqual([segundaRazonSocial]);
  });

  it('revocado en TODAS las empresas sí veta la sesión de firma (no se aflojó nada)', async () => {
    await db.asTenant(firma.tenantId, firma.companyId, (tx) =>
      decidirPermisoIndividual(tx, {
        userId: victima,
        companyId: firma.companyId,
        permisoCodigo: 'documento.leer',
        efecto: 'revocado',
        motivo: 'Compuerta de A14: ahora sí, revocación en la segunda y última empresa.',
      }),
    );
    expect(await tiene(firma.companyId, 'documento.leer')).toBe(false);
    expect(await tiene(segundaCompanyId, 'documento.leer')).toBe(false);
    expect(await tiene('', 'documento.leer')).toBe(false);
  });

  it('un otorgado acotado a una empresa NO concede en la otra empresa', async () => {
    await db.asTenant(firma.tenantId, segundaCompanyId, (tx) =>
      decidirPermisoIndividual(tx, {
        userId: victima,
        companyId: segundaCompanyId,
        permisoCodigo: 'usuario.administrar',
        efecto: 'otorgado',
        motivo: 'Compuerta de A14: otorgado acotado a una sola empresa de la firma.',
      }),
    );
    expect(await tiene(segundaCompanyId, 'usuario.administrar')).toBe(true);
    // La empresa A no se contagia: ahí el contador no administra usuarios.
    expect(await tiene(firma.companyId, 'usuario.administrar')).toBe(false);
  });

  /** La precedencia CON EMPRESA EN CONTEXTO —donde vive toda la seguridad de
   *  D-092— tiene que dar exactamente lo mismo que antes de la 185. Se compara
   *  contra la vista `v_user_permission_efectivo`, que 183 escribió por
   *  separado, para TODO el catálogo de permisos, permiso por permiso. */
  it('con empresa en contexto, función y vista siguen contando lo mismo en TODO el catálogo', async () => {
    for (const companyId of [firma.companyId, segundaCompanyId]) {
      const desacuerdos = await como(firma.tenantId, victima, ROLES.CONTADOR, companyId, async (tx) => {
        const { rows: catalogo } = await tx.query<{ codigo: string }>('SELECT codigo FROM permission ORDER BY codigo');
        const { rows: vista } = await tx.query<{ permission_codigo: string }>(
          `SELECT permission_codigo FROM v_user_permission_efectivo
            WHERE user_id = $1 AND company_id = $2`,
          [victima, companyId],
        );
        const segunLaVista = new Set(vista.map((v) => v.permission_codigo));
        const malos: string[] = [];
        for (const p of catalogo) {
          const { rows } = await tx.query<{ t: boolean }>('SELECT app.tiene_permiso($1) AS t', [p.codigo]);
          if ((rows[0]!.t === true) !== segunLaVista.has(p.codigo)) malos.push(p.codigo);
        }
        return malos;
      });
      expect(desacuerdos).toEqual([]);
    }
  });
});

// =============================================================================
// 5 — LA DEUDA DECLARADA POR A12, MEDIDA: /terceros y /parametros
// =============================================================================

describe('A14 · D-092-bis — la deuda declarada: otros módulos con el rol acotado', () => {
  it('/parametros (detectarAlertasParametrizacion) no exige permiso y no revienta', async () => {
    for (const [u, r] of [
      [acotado, rolAcotadoId],
      [mudo, rolMudoId],
    ] as const) {
      const alertas = await como(firma.tenantId, u, r, firma.companyId, (tx) =>
        detectarAlertasParametrizacion(tx),
      );
      expect(Array.isArray(alertas)).toBe(true);
    }
  });

  it('/terceros (listarTerceros + puedeEditarTerceros) no revienta con el rol acotado', async () => {
    const r = await como(firma.tenantId, acotado, rolAcotadoId, firma.companyId, async (tx) => ({
      terceros: await listarTerceros(tx, { estado: 'activos' }),
      puedeEditar: await puedeEditarTerceros(tx),
    }));
    expect(Array.isArray(r.terceros)).toBe(true);
    // Un rol que solo administra usuarios NO debe poder editar terceros.
    expect(r.puedeEditar).toBe(false);
  });

  it('/terceros tampoco revienta con el rol mudo, y sigue sin poder editar', async () => {
    const r = await como(firma.tenantId, mudo, rolMudoId, firma.companyId, async (tx) => ({
      terceros: await listarTerceros(tx, { estado: 'activos' }),
      puedeEditar: await puedeEditarTerceros(tx),
    }));
    expect(Array.isArray(r.terceros)).toBe(true);
    expect(r.puedeEditar).toBe(false);
  });
});

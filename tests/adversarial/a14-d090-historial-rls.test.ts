/**
 * A14 — compuerta AMPLIADA de D-090, frente 2: el HISTORIAL DE CARGAS MASIVAS
 * atacado como superficie de fuga entre firmas y entre empresas.
 *
 * `src/services/carga-masiva/historial.ts` es una consulta SIN un solo filtro
 * de tenant o empresa escrito a mano: se apoya entera en la RLS de `audit_log`.
 * Eso es exactamente lo que manda la Regla de Oro 7 —y es también la clase de
 * cosa que hay que MEDIR, no creer: si mañana alguien la llamara fuera de
 * `conSesion`, o si la política de `audit_log` cambiara, la pantalla enseñaría
 * quién subió qué archivo en la empresa del vecino sin que nada lo avisara.
 *
 * Todo lo de aquí corre por `db.asTenant`, es decir con `app_user`, RLS activa
 * y token de sesión presentado, que es el único sitio donde un PASS significa
 * algo (D-004). Las filas se siembran llamando a `app.registrar_carga_masiva`
 * —la MISMA función que usa `importar.ts`—, no con un INSERT a mano que podría
 * poner un `company_id` que el camino real nunca pondría.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createTestDb, uuid, type TestDb } from '../helpers/db';
import { crearEscenario, type Escenario } from '../helpers/fixtures';
import { listarHistorialCargaMasiva } from '../../src/services/carga-masiva/historial';

let db: TestDb;
let a: Escenario;
let b: Escenario;
/** Segunda empresa de la MISMA firma A. El vecino de al lado, no el de enfrente. */
let companyA2: string;

/** Siembra una cabecera de carga masiva con la función real del importador. */
async function registrarCarga(
  tenantId: string,
  companyId: string,
  opciones: { entidad: string; archivo: string; catalogo: string; ok?: number; error?: number },
  extra: Parameters<TestDb['asTenant']>[3] = {},
): Promise<void> {
  await db.asTenant(
    tenantId,
    companyId,
    async (tx) => {
      await tx.query(`SELECT app.registrar_carga_masiva($1, $2, $3, $4, $5::jsonb)`, [
        opciones.entidad,
        opciones.archivo,
        opciones.ok ?? 10,
        opciones.error ?? 0,
        JSON.stringify({ catalogo: opciones.catalogo }),
      ]);
    },
    extra,
  );
}

beforeAll(async () => {
  db = await createTestDb();
  a = await crearEscenario(db, { razonSocial: 'Firma A del historial' });
  b = await crearEscenario(db, { razonSocial: 'Firma B del historial' });

  companyA2 = uuid();
  await db.asAdmin(async (tx) => {
    await tx.query(
      `INSERT INTO company (id, tenant_id, nit, razon_social, municipality_id, ciiu_principal_id,
                            es_agente_retencion_renta, buzon_email)
       VALUES ($1, $2, $3, 'Segunda empresa de la firma A', $4, $5, true, $6)`,
      [companyA2, a.tenantId, `800a2${Date.now().toString(36)}`, a.municipalityId, a.ciiuId,
       `a2-${Date.now().toString(36)}@inbox.ejemplo.co`],
    );
  });

  await registrarCarga(a.tenantId, a.companyId, {
    entidad: 'third_party', archivo: 'terceros-de-A.xlsx', catalogo: 'third_party', ok: 400, error: 3,
  });
  await registrarCarga(a.tenantId, companyA2, {
    entidad: 'account', archivo: 'puc-de-la-segunda-empresa-de-A.xlsx', catalogo: 'account', ok: 7, error: 1,
  });
  await registrarCarga(b.tenantId, b.companyId, {
    entidad: 'third_party', archivo: 'SECRETO-clientes-de-B.xlsx', catalogo: 'third_party', ok: 999, error: 0,
  });
}, 300_000);

afterAll(async () => {
  await db.close();
});

function archivos(filas: { archivo: string | null }[]): (string | null)[] {
  return filas.map((f) => f.archivo);
}

describe('A14 · D-090 — el historial de cargas no cruza la frontera de la firma', () => {
  it('la firma A ve SOLO lo suyo: el archivo de B no aparece por ningún lado', async () => {
    const historial = await db.asTenant(a.tenantId, a.companyId, (tx) =>
      listarHistorialCargaMasiva(tx),
    );
    expect(archivos(historial.filas)).toEqual(['terceros-de-A.xlsx']);
    expect(historial.total).toBe(1);
    expect(JSON.stringify(historial)).not.toContain('SECRETO');
  });

  it('la firma B ve SOLO lo suyo, y el total tampoco delata cuántas cargas hizo A', async () => {
    const historial = await db.asTenant(b.tenantId, b.companyId, (tx) =>
      listarHistorialCargaMasiva(tx),
    );
    expect(archivos(historial.filas)).toEqual(['SECRETO-clientes-de-B.xlsx']);
    // A tiene DOS cargas. Si el `count(*)` se saltara la RLS, aquí saldría 3.
    expect(historial.total).toBe(1);
  });

  it('caso dorado 20 sobre esta pantalla: A con el tenant de B en la mano sigue sin ver nada de B', async () => {
    // Se pide la sesión de A y se le pasa la empresa de B: el contexto lo
    // verifica la base (`app.current_company_id` reconsulta el acceso), no la
    // aplicación, así que ni siquiera hace falta que el servicio se entere.
    const filas = await db
      .asTenant(a.tenantId, b.companyId, (tx) => listarHistorialCargaMasiva(tx))
      .catch(() => null);
    if (filas !== null) {
      expect(archivos(filas.filas)).not.toContain('SECRETO-clientes-de-B.xlsx');
      expect(filas.total).toBe(0);
    }
  });

  it('dos empresas de la MISMA firma no se ven las cargas: el aislamiento es de doble nivel', async () => {
    const desdeA1 = await db.asTenant(a.tenantId, a.companyId, (tx) => listarHistorialCargaMasiva(tx));
    const desdeA2 = await db.asTenant(a.tenantId, companyA2, (tx) => listarHistorialCargaMasiva(tx));

    expect(archivos(desdeA1.filas)).toEqual(['terceros-de-A.xlsx']);
    expect(archivos(desdeA2.filas)).toEqual(['puc-de-la-segunda-empresa-de-A.xlsx']);
    expect(desdeA1.total).toBe(1);
    expect(desdeA2.total).toBe(1);
  });

  it('al usuario le revocan el acceso a la empresa A MITAD DE SESIÓN: deja de ver el historial', async () => {
    // La sesión sigue viva y el token sigue siendo válido. Lo que cambia es el
    // acceso, y `app.current_company_id()` lo reconsulta en cada llamada.
    const usuario = uuid();
    await db.asAdmin(async (tx) => {
      await tx.query(
        `INSERT INTO "user" (id, tenant_id, email, nombre_completo, estado)
         VALUES ($1, $2, $3, 'Usuario al que le quitan la empresa', 'activo')`,
        [usuario, a.tenantId, `revocado-${Date.now().toString(36)}@ejemplo.co`],
      );
    });

    const antes = await db.asTenant(
      a.tenantId, a.companyId,
      (tx) => listarHistorialCargaMasiva(tx),
      { userId: usuario, sesionNueva: true },
    );
    expect(archivos(antes.filas)).toEqual(['terceros-de-A.xlsx']);

    await db.asAdmin(async (tx) => {
      await tx.query(
        `UPDATE user_company_access SET revocado_en = now()
          WHERE user_id = $1 AND company_id = $2`,
        [usuario, a.companyId],
      );
    });

    const despues = await db
      .asTenant(a.tenantId, a.companyId, (tx) => listarHistorialCargaMasiva(tx), { userId: usuario })
      .catch(() => null);

    if (despues !== null) {
      expect(despues.filas, 'con el acceso revocado no puede quedar ni una fila').toEqual([]);
      expect(despues.total).toBe(0);
    }
  });

  it('una carga SIN empresa en contexto la ven todas las empresas de SU firma, y ninguna de otra', async () => {
    // No es un defecto, es el contrato de `audit_log` desde la Ola 0: hay
    // acciones de FIRMA, no de empresa (`company_id IS NULL`), y una carga de
    // un catálogo de firma —municipios, por ejemplo— hecha sin la cookie de
    // empresa escribe su cabecera así. Queda MEDIDO en vez de supuesto: el
    // reparto es «toda la firma sí, la firma de al lado no».
    await db.asTenant(a.tenantId, null, async (tx) => {
      await tx.query(`SELECT app.registrar_carga_masiva($1, $2, $3, $4, $5::jsonb)`, [
        'municipality', 'municipios-de-la-firma-A.xlsx', 1120, 0,
        JSON.stringify({ catalogo: 'municipality' }),
      ]);
    });

    const desdeA1 = await db.asTenant(a.tenantId, a.companyId, (tx) => listarHistorialCargaMasiva(tx));
    const desdeA2 = await db.asTenant(a.tenantId, companyA2, (tx) => listarHistorialCargaMasiva(tx));
    const desdeB = await db.asTenant(b.tenantId, b.companyId, (tx) => listarHistorialCargaMasiva(tx));

    expect(archivos(desdeA1.filas)).toContain('municipios-de-la-firma-A.xlsx');
    expect(archivos(desdeA2.filas)).toContain('municipios-de-la-firma-A.xlsx');
    expect(archivos(desdeB.filas)).not.toContain('municipios-de-la-firma-A.xlsx');
    // Y lo de la empresa hermana sigue sin verse desde la otra.
    expect(archivos(desdeA2.filas)).not.toContain('terceros-de-A.xlsx');
  });

  it('el aislamiento lo hace la BASE, no el servicio: el mismo SQL como dueño SÍ ve las tres', async () => {
    // Sin esto, todo lo anterior podría estar pasando por un filtro de
    // aplicación escondido y nadie lo sabría. Aquí se corre la consulta sin
    // RLS: si el motor no fuera el que filtra, este conteo sería 1.
    const { rows } = await db.asAdmin((tx) =>
      tx.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM audit_log WHERE accion = 'CARGA_MASIVA'`,
      ),
    );
    const totalReal = Number(rows[0]!.total);
    const vistoPorB = await db.asTenant(b.tenantId, b.companyId, (tx) =>
      listarHistorialCargaMasiva(tx),
    );
    expect(totalReal).toBeGreaterThanOrEqual(4);
    expect(vistoPorB.total).toBe(1);
    expect(vistoPorB.total).toBeLessThan(totalReal);
  });

  it('el servicio no lleva NI UN filtro de aplicación por tenant o empresa', () => {
    const fuente = readFileSync('src/services/carga-masiva/historial.ts', 'utf8');
    const sql = fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\*.*$/gm, '');
    expect(sql).not.toMatch(/tenant_id\s*=/);
    expect(sql).not.toMatch(/company_id\s*=/);
    expect(sql).not.toMatch(/current_tenant_id\(\)/);
    // Y tampoco recibe un tenant/empresa por parámetro que alguien pueda
    // suplantar desde la URL.
    expect(fuente).not.toMatch(/tenantId|companyId/);
  });

  it('las tres pantallas del módulo son `force-dynamic`: nada de HTML de una firma cacheado para otra', () => {
    // Una página de App Router sin `force-dynamic` se puede prerrenderizar y
    // servir desde caché. En una pantalla cuyo contenido depende de la cookie
    // de empresa, eso es enseñarle a una firma el historial de otra sin que
    // ninguna RLS llegue a enterarse: la consulta ni se repite.
    for (const ruta of [
      'app/carga-masiva/historial/page.tsx',
      'app/carga-masiva/page.tsx',
      'app/carga-masiva/[catalogo]/page.tsx',
    ]) {
      expect(readFileSync(ruta, 'utf8'), ruta).toMatch(
        /export const dynamic\s*=\s*'force-dynamic'/,
      );
    }
  });

  it('la página del historial corre dentro de `conSesion` y exige `auditoria.leer`', () => {
    const pagina = readFileSync('app/carga-masiva/historial/page.tsx', 'utf8');
    expect(pagina).toContain('conSesion');
    expect(pagina).toContain('PERMISOS.AUDITORIA_LEER');
    // El permiso se comprueba ANTES de llamar al servicio, no después de traer
    // las filas: si no se puede leer, no se leen.
    const iPermiso = pagina.indexOf('tienePermiso(tx, PERMISOS.AUDITORIA_LEER)');
    const iConsulta = pagina.indexOf('listarHistorialCargaMasiva(tx');
    expect(iPermiso).toBeGreaterThan(-1);
    expect(iConsulta).toBeGreaterThan(iPermiso);
    // Ninguna empresa viaja por la URL: de `searchParams` solo se lee `pagina`.
    const leidosDeLaUrl = [...pagina.matchAll(/entero\(sp,\s*'([^']+)'/g)].map((m) => m[1]);
    expect(leidosDeLaUrl).toEqual(['pagina']);
    expect(pagina).not.toMatch(/sp\[['"]/);
  });
});

describe('A14 · D-090 — el historial no se puede forzar desde la URL', () => {
  it('una `pagina` absurda (negativa, cero, texto, gigante) no rompe ni devuelve de más', async () => {
    for (const pagina of [0, -1, -999, Number.NaN, 1e9, 3.7]) {
      const r = await db.asTenant(a.tenantId, a.companyId, (tx) =>
        listarHistorialCargaMasiva(tx, { pagina }),
      );
      expect(r.pagina).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(r.pagina)).toBe(true);
      expect(r.filas.length).toBeLessThanOrEqual(r.porPagina);
      // Nunca aparece nada de la otra firma, sea cual sea el desplazamiento.
      expect(archivos(r.filas)).not.toContain('SECRETO-clientes-de-B.xlsx');
    }
  });

  it('`porPagina` está topado: no se puede pedir la tabla entera de una', async () => {
    const r = await db.asTenant(a.tenantId, a.companyId, (tx) =>
      listarHistorialCargaMasiva(tx, { porPagina: 100_000 }),
    );
    expect(r.porPagina).toBeLessThanOrEqual(200);
    const cero = await db.asTenant(a.tenantId, a.companyId, (tx) =>
      listarHistorialCargaMasiva(tx, { porPagina: 0 }),
    );
    expect(cero.porPagina).toBeGreaterThanOrEqual(1);
  });
});

describe('A14 · D-090 — el historial dice la verdad sobre lo que muestra', () => {
  it('el catálogo se resuelve por la CLAVE de DEFINICIONES, no por la tabla física', async () => {
    // `entidad` guarda la tabla (`third_party`); la clave viaja en el JSON. Se
    // siembra una carga cuya tabla NO coincide con la clave para que el título
    // solo pueda salir bien si se resuelve por la clave.
    await registrarCarga(a.tenantId, a.companyId, {
      entidad: 'third_party',
      archivo: 'atributos-fiscales.xlsx',
      catalogo: 'third_party_fiscal_attribute',
    });
    const r = await db.asTenant(a.tenantId, a.companyId, (tx) => listarHistorialCargaMasiva(tx));
    const fila = r.filas.find((f) => f.archivo === 'atributos-fiscales.xlsx')!;
    expect(fila).toBeTruthy();
    expect(fila.catalogoClave).toBe('third_party_fiscal_attribute');
    expect(fila.entidad).toBe('third_party');
    expect(fila.catalogoTitulo).not.toBe('third_party');
    expect(fila.catalogoTitulo.length).toBeGreaterThan(0);
  });

  it('la columna «Quién» trae de verdad el nombre del usuario que subió el archivo', async () => {
    // Si la RLS de `"user"` no deja leer la fila desde `app_user`, el LEFT JOIN
    // devuelve NULL y la pantalla enseña «—» SIEMPRE: el historial perdería lo
    // único que no se puede reconstruir de otro sitio.
    const r = await db.asTenant(a.tenantId, a.companyId, (tx) => listarHistorialCargaMasiva(tx));
    const conNombre = r.filas.filter((f) => f.usuarioNombre !== null);
    expect(
      conNombre.length,
      'ninguna fila trae usuario: el historial no puede responder «quién»',
    ).toBeGreaterThan(0);
  });

  it('las cifras de filas OK / con error salen del JSON de la cabecera, no de un conteo inventado', async () => {
    const r = await db.asTenant(a.tenantId, a.companyId, (tx) => listarHistorialCargaMasiva(tx));
    const fila = r.filas.find((f) => f.archivo === 'terceros-de-A.xlsx')!;
    expect(fila.filasOk).toBe(400);
    expect(fila.filasError).toBe(3);
  });
});

/**
 * A14 — DESBLOQUEO DE LA OLA 3: la ruta de descarga de reportes (V-16).
 *
 * A9 dice haber cerrado V-16 con `app/api/reportes/[libro]/route.ts`. A14 no
 * lo confirma por reporte: lo ataca. Lo que se verifica aquí:
 *
 *   1. El criterio 1 de salida, POR LA RUTA y no por la función: los VEINTE
 *      libros se descargan de verdad, el cuerpo es un `.xlsx` que se vuelve a
 *      abrir, y trae las cuatro hojas obligatorias de la §11.2.
 *   2. Que no quedó ningún libro HUÉRFANO: todo generador exportado por
 *      `src/reports/` está cableado a un slug de la ruta. Un libro sin slug
 *      seguiría sin poder descargarse, que es exactamente V-16.
 *   3. Caso dorado 20 SOBRE ESTA SUPERFICIE: una ruta HTTP que sirve archivos
 *      es el sitio más fácil para filtrar datos de otra firma. Se ataca con
 *      cookie de empresa ajena, con `companyId` en la query, con sesión de otra
 *      firma, sin permiso, sin cookie, con token inválido y con sesión cerrada.
 *   4. Que servir un reporte no escribe NADA en el ledger.
 *
 * Igual que en la prueba de A9, lo único que se sustituye es `next/headers`
 * (que fuera del runtime de Next lanza «outside a request scope») y el
 * singleton de conexión. La autorización real —`withSessionContext`,
 * `app.current_company_id()`, la RLS y `app.exigir_permiso`— corre sin dobles
 * contra la base de datos de pruebas.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { createTestDb, uuid, type TestDb } from '../helpers/db';
import { crearEscenario, type Escenario } from '../helpers/fixtures';
import { ROLES } from '../../src/auth/permisos';
import type { DbHandle } from '../../src/db/types';

/**
 * Todos los archivos de código bajo `raices`, recorriendo el SISTEMA DE
 * ARCHIVOS (no el índice de git: ver V-53 abajo). Devuelve rutas relativas con
 * `/`, como las devolvía `git grep -l`, para que el resto de la prueba no
 * cambie.
 */
function archivosFuente(raices: string[]): string[] {
  const salida: string[] = [];
  const recorrer = (dir: string): void => {
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      const ruta = `${dir}/${entrada.name}`;
      if (entrada.isDirectory()) {
        if (entrada.name === 'node_modules' || entrada.name.startsWith('.')) continue;
        recorrer(ruta);
      } else if (/\.(ts|tsx|js|jsx|mts|cts)$/.test(entrada.name)) {
        salida.push(ruta);
      }
    }
  };
  for (const raiz of raices) recorrer(raiz);
  return salida.sort();
}

let cookieValores: Record<string, string> = {};
let cabeceraValores: Record<string, string> = {};

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nombre: string) =>
      cookieValores[nombre] !== undefined ? { name: nombre, value: cookieValores[nombre] } : undefined,
  }),
  headers: async () => ({
    get: (nombre: string) => cabeceraValores[nombre.toLowerCase()] ?? null,
  }),
}));

let dbHandle: DbHandle;
vi.mock('../../app/lib/db', () => ({
  obtenerDb: async () => dbHandle,
}));

import { GET } from '../../app/api/reportes/[libro]/route';
import { GET as GET_PUC_EXPORTAR } from '../../app/api/parametros/puc/exportar/route';
import { GET as GET_TERCEROS_EXPORTAR } from '../../app/api/terceros/exportar/route';
import { COOKIE_SESSION_TOKEN, COOKIE_COMPANY_ID } from '../../app/lib/sesion';

let db: TestDb;
/** Firma A: la que tiene los datos y la marca. */
let a: Escenario;
/** Firma B: otra firma, sin datos. */
let b: Escenario;
/** Empresa de la firma A a la que el usuario de A NO tiene acceso. */
let companyIdSinAcceso = '';
let tokenA = '';
let tokenB = '';
let tokenSoloLectura = '';

const MARCA_A = 'MARCA-EXCLUSIVA-DE-LA-FIRMA-A-EN-LA-RUTA';
const RANGO = { desde: '2026-06-01', hasta: '2026-06-30' };

interface CasoLibro {
  slug: string;
  query: Record<string, string>;
}

/** Los veinte libros con los parámetros mínimos que exige cada uno. */
function casosDeLibro(esc: Escenario): CasoLibro[] {
  const r = { ...RANGO };
  const exog = { ...r, anioGravable: '2026' };
  return [
    { slug: 'libro-diario', query: r },
    { slug: 'libro-mayor', query: r },
    { slug: 'libro-auxiliar', query: { ...r, accountId: esc.cuentas.gasto } },
    { slug: 'balance-prueba', query: { ...r, nivel: '3' } },
    { slug: 'movimiento-terceros', query: r },
    { slug: 'certificado-retenciones', query: { ...r, terceroId: esc.thirdPartyId } },
    { slug: 'relacion-retenciones', query: r },
    { slug: 'detalle-iva', query: r },
    { slug: 'estado-situacion-financiera', query: { fechaCorte: r.hasta } },
    { slug: 'estado-resultado-integral', query: r },
    { slug: 'estado-cambios-patrimonio', query: r },
    { slug: 'estado-flujos-efectivo', query: r },
    { slug: 'notas-estados-financieros', query: r },
    { slug: 'exogena-1001', query: exog },
    { slug: 'exogena-1003', query: exog },
    { slug: 'exogena-1005', query: exog },
    { slug: 'exogena-1006', query: exog },
    { slug: 'exogena-1007', query: exog },
    { slug: 'exogena-1008', query: { fechaCorte: r.hasta, anioGravable: '2026' } },
    { slug: 'exogena-1009', query: { fechaCorte: r.hasta, anioGravable: '2026' } },
  ];
}

const SLUGS = casosDeLibro({ cuentas: { gasto: '' }, thirdPartyId: '' } as unknown as Escenario).map(
  (c) => c.slug,
);

function llamar(libro: string, query: Record<string, string> = {}): Promise<Response> {
  const url = new URL(`http://localhost/api/reportes/${encodeURIComponent(libro)}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return GET(new Request(url), { params: Promise.resolve({ libro }) });
}

/** Todo el texto de todas las hojas del `.xlsx` que devolvió LA RUTA. */
async function textoDelArchivo(res: Response): Promise<string> {
  const buffer = Buffer.from(await res.arrayBuffer());
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const partes: string[] = [];
  wb.eachSheet((hoja) => {
    partes.push(hoja.name);
    hoja.eachRow((fila) => {
      fila.eachCell({ includeEmpty: false }, (celda) => partes.push(String(celda.value ?? '')));
    });
  });
  return partes.join('\n');
}

async function huellaLedger(): Promise<string> {
  const { rows } = await db.asAdmin((tx) =>
    tx.query<{ h: string }>(
      `SELECT (SELECT count(*) FROM journal_entry)::text || ':' ||
              (SELECT count(*) FROM journal_line)::text || ':' ||
              (SELECT COALESCE(SUM(monto),0) FROM journal_line)::text || ':' ||
              (SELECT count(*) FROM approval)::text || ':' ||
              (SELECT count(*) FROM source_document)::text || ':' ||
              (SELECT count(*) FROM retention_applied)::text AS h`,
    ),
  );
  return rows[0]!.h;
}

beforeAll(async () => {
  db = await createTestDb();
  dbHandle = db.client;
  a = await crearEscenario(db, { razonSocial: 'Firma A de la ruta' });
  b = await crearEscenario(db, { razonSocial: 'Firma B de la ruta' });

  await db.asAdmin(async (tx) => {
    // Un asiento real en A, con una marca que solo existe ahí.
    const entryId = uuid();
    await tx.query(
      `INSERT INTO journal_entry (id, tenant_id, company_id, fiscal_period_id, fecha_hecho_economico,
                                  descripcion, estado, source_document_id, approval_id, idempotency_key, created_by)
       VALUES ($1,$2,$3,$4,'2026-06-15',$5,'draft',$6,$7,$8,$9)`,
      [
        entryId, a.tenantId, a.companyId, a.fiscalPeriodId, `Causación ${MARCA_A}`,
        a.sourceDocumentId, a.approvalId, `idem-a14-ruta-${entryId}`, a.userId,
      ],
    );
    const partidas: [string, 'debito' | 'credito', number][] = [
      [a.cuentas.gasto, 'debito', 1_000_000_00],
      [a.cuentas.proveedores, 'credito', 1_000_000_00],
    ];
    let linea = 0;
    for (const [accountId, side, monto] of partidas) {
      linea += 1;
      await tx.query(
        `INSERT INTO journal_line (tenant_id, company_id, journal_entry_id, linea, account_id, side, monto,
                                   third_party_id, descripcion)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [a.tenantId, a.companyId, entryId, linea, accountId, side, monto, a.thirdPartyId, MARCA_A],
      );
    }
    await tx.query('SELECT app.publicar_asiento($1, $2)', [entryId, a.userId]);

    // Segunda empresa DE LA FIRMA A, sin acceso para el usuario de A.
    companyIdSinAcceso = uuid();
    await tx.query(
      `INSERT INTO company (id, tenant_id, nit, razon_social, municipality_id, ciiu_principal_id,
                            es_agente_retencion_renta, buzon_email)
       VALUES ($1,$2,$3,'Empresa sin acceso',$4,$5,true,$6)`,
      [
        companyIdSinAcceso, a.tenantId, `803${Date.now()}`, a.municipalityId, a.ciiuId,
        `sin-acceso-${Date.now()}@inbox.ejemplo.co`,
      ],
    );
  });

  tokenA = (await db.emitirSesion(a.tenantId, a.companyId, { sesionNueva: true })).token;
  tokenB = (await db.emitirSesion(b.tenantId, b.companyId, { sesionNueva: true })).token;
  tokenSoloLectura = (
    await db.emitirSesion(a.tenantId, a.companyId, { rolId: ROLES.SOLO_LECTURA, sesionNueva: true })
  ).token;
}, 300_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(() => {
  cookieValores = { [COOKIE_SESSION_TOKEN]: tokenA, [COOKIE_COMPANY_ID]: a.companyId };
  cabeceraValores = { 'x-forwarded-for': '192.0.2.14', 'user-agent': 'A14' };
});

// =============================================================================
// 1. Criterio 1 de salida, verificado POR LA RUTA
// =============================================================================

describe('A14 · criterio 1 — los VEINTE libros se descargan de verdad por HTTP', () => {
  it('son veinte, no una muestra', () => {
    expect(SLUGS.length).toBe(20);
    expect(new Set(SLUGS).size).toBe(20);
  });

  it.each(SLUGS)(
    '%s: 200, `.xlsx` real y las cuatro hojas obligatorias al reabrirlo',
    async (slug) => {
      const caso = casosDeLibro(a).find((c) => c.slug === slug)!;
      const res = await llamar(caso.slug, caso.query);
      expect(res.status, `${slug} devolvió ${res.status}`).toBe(200);
      expect(res.headers.get('content-type')).toBe(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      const disposicion = res.headers.get('content-disposition') ?? '';
      // El nombre de archivo no puede llevar nada sin sanear (inyección de cabecera).
      expect(disposicion).toMatch(/^attachment; filename="[A-Za-z0-9_.-]+\.xlsx"$/);

      const buffer = Buffer.from(await res.arrayBuffer());
      expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer as unknown as ArrayBuffer);
      expect(wb.worksheets.slice(0, 4).map((w) => w.name)).toEqual([
        'Datos',
        'Papel de trabajo',
        'Trazabilidad',
        'Parámetros',
      ]);
    },
    180_000,
  );

  it('el libro que baja trae los datos de la empresa en sesión (si no, no probaría nada)', async () => {
    const res = await llamar('libro-diario', RANGO);
    expect(res.status).toBe(200);
    expect(await textoDelArchivo(res)).toContain(MARCA_A);
  });
});

// =============================================================================
// 2. Ningún libro huérfano: todo generador de `src/reports/` tiene slug
// =============================================================================

describe('A14 · V-16 de verdad cerrada: ningún libro se queda sin forma de descargarse', () => {
  const fuenteRuta = readFileSync('app/api/reportes/[libro]/route.ts', 'utf8');

  /**
   * ACOTAMIENTO HECHO POR A16 EN LA OLA 4 — y por qué NO afloja la invariante.
   *
   * La versión original exigía que `app/api/reportes/[libro]/route.ts` fuera el
   * ÚNICO archivo de `app/` y `src/` que mencionara `src/reports`. Eso no es la
   * invariante: la invariante es que ningún GENERADOR de libros quede huérfano
   * ni se sirva por un camino que se salte la ruta auditada —y con ella el
   * rastro EXPORT de la 14.1 que la ruta escribe—.
   *
   * `src/reports/diagnostico.ts` no genera ningún libro: dice qué configuración
   * falta y adónde ir a cargarla. `app/reportes/page.tsx` lo importa para
   * enseñar esos avisos ANTES de que el contador pida un reporte (Ola 4, Tarea
   * 6). Prohibirlo obligaría a duplicar esas consultas fuera de `src/reports/`,
   * que es justo lo contrario de lo que persigue esta compuerta.
   *
   * Así que se comprueba lo que importa: fuera de la ruta, NADIE nombra un
   * `generarXxx`. Un archivo que importara `generarLibroMayor` para servirlo
   * por su cuenta seguiría haciendo fallar esta prueba.
   *
   * A14, compuerta de D-090, V-54 (cierre): la premisa de arriba dejó de ser
   * cierta el día que A9 escribió `app/api/parametros/puc/exportar/route.ts`
   * y `app/api/terceros/exportar/route.ts` — dos exportaciones LEGÍTIMAS fuera
   * de la ruta central, cada una con su propio permiso de módulo. La
   * invariante real nunca fue «solo la ruta nombra un generador»: es «fuera de
   * la ruta, un generador solo vale si el mismo archivo escribe el rastro
   * `EXPORT` (`app.registrar_exportacion`) — igual que hace la ruta central,
   * en la misma transacción». Por eso el regex ahora también reconoce
   * `generarMaestro*` (el agujero que dejaba pasar a `terceros-maestro` sin
   * que esta prueba lo viera), y en vez de exigir cero coincidencias, exige
   * que cada archivo con un generador también llame el rastro.
   */
  it('nadie fuera de la ruta invoca un generador de libros: no hay descarga sin rastro', () => {
    // La afirmación de A9 se comprueba contra el árbol, no contra su palabra.
    //
    // A14, compuerta de D-090 (V-53): esto usaba `git grep`, que solo mira los
    // archivos YA RASTREADOS por git. Como ningún agente comitea —eso lo hace
    // el usuario después de la compuerta—, el archivo nuevo que rompe la
    // invariante era invisible para esta prueba justo cuando se corría la
    // compuerta, y aparecía roto en el commit siguiente. Fue exactamente lo que
    // pasó con `app/api/parametros/puc/exportar/route.ts` en D-089: compuerta
    // «1345 en verde» y árbol rojo un commit después. Ahora se recorre el
    // sistema de archivos, que es lo que de verdad se despliega.
    const importadores = archivosFuente(['app', 'src']).filter((f) => {
      const fuente = readFileSync(f, 'utf8');
      return fuente.includes('src/reports') || fuente.includes('../reports');
    });
    const fuera = importadores.filter(
      (f) => !f.startsWith('src/reports/') && f !== 'app/api/reportes/[libro]/route.ts',
    );

    const conGenerador = fuera.filter((f) =>
      /\bgenerar(Libro|Balance|Certificado|Relacion|Movimiento|Detalle|Estado|Notas|Formato|Maestro)/.test(
        readFileSync(f, 'utf8'),
      ),
    );
    // V-54: un generador fuera de la ruta ya no es, por sí solo, una falla —
    // lo es SOLO si el archivo no deja el mismo rastro EXPORT que la ruta
    // central. `app.registrar_exportacion` es el nombre fijo de esa función
    // (migración 140); un archivo que lo invoque queda auditado igual que si
    // pasara por la ruta.
    const sinRastro = conGenerador.filter((f) => !readFileSync(f, 'utf8').includes('registrar_exportacion'));
    expect(sinRastro).toEqual([]);
    // Y de paso: las dos exportaciones legítimas conocidas siguen estando ahí,
    // para que esta prueba no pase trivialmente por no encontrar candidatos.
    expect(conGenerador).toEqual(
      expect.arrayContaining([
        'app/api/parametros/puc/exportar/route.ts',
        'app/api/terceros/exportar/route.ts',
      ]),
    );
  });

  it('los veinte generadores públicos están cableados a un slug', async () => {
    const modulo = (await import('../../src/reports/index')) as Record<string, unknown>;
    const generadores = Object.keys(modulo).filter(
      (n) =>
        typeof modulo[n] === 'function' &&
        /^generar(Libro|Balance|Certificado|Relacion|Movimiento|Detalle|Estado|Notas|Formato)/.test(n),
    );
    expect(generadores.length).toBe(20);
    const huerfanos = generadores.filter((n) => !fuenteRuta.includes(n));
    expect(huerfanos).toEqual([]);
  });
});

// =============================================================================
// 3. Caso dorado 20 sobre la ruta: atacarla como otra firma
// =============================================================================

describe('A14 · ataques a la ruta (caso dorado 20 sobre la superficie nueva)', () => {
  it('sin cookie de sesión: 401 y ni un byte de Excel', async () => {
    cookieValores = {};
    const res = await llamar('libro-diario', RANGO);
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toMatch(/json/);
    expect(await res.text()).not.toContain(MARCA_A);
  });

  it('token inventado: 401', async () => {
    cookieValores[COOKIE_SESSION_TOKEN] = 'token-que-nadie-emitio-jamas';
    const res = await llamar('libro-diario', RANGO);
    expect(res.status).toBe(401);
  });

  it('sesión CERRADA después de emitirse: 401 aunque la cookie siga en el cliente', async () => {
    const { token } = await db.emitirSesion(a.tenantId, a.companyId, { sesionNueva: true });
    cookieValores[COOKIE_SESSION_TOKEN] = token;
    expect((await llamar('libro-diario', RANGO)).status).toBe(200);
    await db.asAdmin((tx) => tx.query('SELECT app.cerrar_sesion($1)', [token]));
    expect((await llamar('libro-diario', RANGO)).status).toBe(401);
  });

  it('sesión de la firma B pidiendo la empresa de la firma A: 403, con rastro y sin servir el libro', async () => {
    cookieValores = { [COOKIE_SESSION_TOKEN]: tokenB, [COOKIE_COMPANY_ID]: a.companyId };
    const res = await llamar('libro-diario', RANGO);
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain(MARCA_A);
    const { rows } = await db.asAdmin((tx) =>
      tx.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM audit_log
          WHERE accion = 'ACCESO_DENEGADO' AND tenant_id = $1`,
        [b.tenantId],
      ),
    );
    expect(Number(rows[0]!.n)).toBeGreaterThan(0);
  });

  it('empresa de la MISMA firma sobre la que el usuario no tiene acceso: 403', async () => {
    cookieValores[COOKIE_COMPANY_ID] = companyIdSinAcceso;
    const res = await llamar('libro-diario', RANGO);
    expect(res.status).toBe(403);
  });

  it('`companyId` en la QUERY STRING no se lee: la firma B no obtiene los datos de A', async () => {
    cookieValores = { [COOKIE_SESSION_TOKEN]: tokenB, [COOKIE_COMPANY_ID]: b.companyId };
    for (const parametro of ['companyId', 'company_id', 'empresa', 'tenantId']) {
      // eslint-disable-next-line no-await-in-loop
      const res = await llamar('libro-diario', { ...RANGO, [parametro]: a.companyId });
      expect(res.status).toBe(200);
      // eslint-disable-next-line no-await-in-loop
      const texto = await textoDelArchivo(res);
      expect(texto, `el parámetro ${parametro} logró cambiar de empresa`).not.toContain(MARCA_A);
      expect(texto).not.toContain(a.thirdPartyId);
    }
  }, 120_000);

  it('sin el permiso `reporte.exportar` (rol solo_lectura): 403', async () => {
    cookieValores[COOKIE_SESSION_TOKEN] = tokenSoloLectura;
    const res = await llamar('libro-diario', RANGO);
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain(MARCA_A);
  });

  it('slug desconocido, recorrido de ruta y claves del prototipo: 404, nunca 500', async () => {
    const venenos = [
      'no-existe',
      '../../../etc/passwd',
      '..%2f..%2fapp%2flib%2fdb',
      'libro-diario/../../secreto',
      '__proto__',
      'constructor',
      'toString',
      'valueOf',
      'hasOwnProperty',
    ];
    const noDieron404: string[] = [];
    for (const veneno of venenos) {
      // eslint-disable-next-line no-await-in-loop
      const res = await llamar(veneno, RANGO);
      if (res.status !== 404) noDieron404.push(`${veneno} -> ${res.status}`);
    }
    // Se informan TODOS, no solo el primero: `__proto__` daba 500 antes de la
    // corrección de A14 (V-19) y los demás nunca llegaban a ejecutarse.
    expect(noDieron404).toEqual([]);
  });

  it('parámetros faltantes o con formato inválido: 400 con mensaje, no 500', async () => {
    expect((await llamar('libro-diario', {})).status).toBe(400);
    expect((await llamar('libro-diario', { desde: '15/06/2026', hasta: '2026-06-30' })).status).toBe(400);
    expect((await llamar('balance-prueba', { ...RANGO, nivel: '9' })).status).toBe(400);
    expect((await llamar('balance-prueba', { ...RANGO, nivel: '3; DROP TABLE journal_line' })).status).toBe(400);
    expect((await llamar('certificado-retenciones', RANGO)).status).toBe(400);
  });

  it('una inyección SQL por parámetro no llega al motor ni devuelve datos ajenos', async () => {
    const res = await llamar('certificado-retenciones', { ...RANGO, terceroId: "' OR 1=1 --" });
    expect([200, 400, 500]).toContain(res.status);
    if (res.status === 200) {
      expect(await textoDelArchivo(res)).not.toContain(MARCA_A);
    }
    // Y el ledger sigue intacto: la inyección no borró ni cambió nada.
    const { rows } = await db.asAdmin((tx) =>
      tx.query<{ n: string }>(`SELECT count(*)::text AS n FROM journal_line`),
    );
    expect(Number(rows[0]!.n)).toBeGreaterThan(0);
  });
});

// =============================================================================
// 4. Servir reportes no escribe en el ledger
// =============================================================================

describe('A14 · la ruta no escribe nada en el ledger', () => {
  it('descargar los veinte libros deja la huella del ledger idéntica', async () => {
    const antes = await huellaLedger();
    for (const caso of casosDeLibro(a)) {
      // eslint-disable-next-line no-await-in-loop
      const res = await llamar(caso.slug, caso.query);
      expect(res.status).toBe(200);
    }
    expect(await huellaLedger()).toBe(antes);
  }, 300_000);
});

// =============================================================================
// 5. V-54 (cierre): las dos exportaciones fuera de la ruta central dejan el
//    mismo rastro EXPORT, con el mismo permiso, y con la misma RLS.
// =============================================================================

async function exportsDeAuditLog(tenantId: string, entidadId: string): Promise<number> {
  const { rows } = await db.asAdmin((tx) =>
    tx.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit_log
        WHERE accion = 'EXPORT' AND entidad = 'reporte' AND entidad_id = $1 AND tenant_id = $2`,
      [entidadId, tenantId],
    ),
  );
  return Number(rows[0]!.n);
}

describe('A14 · V-54 — el PUC efectivo y el maestro de terceros dejan el mismo rastro EXPORT', () => {
  it('descargar el PUC efectivo escribe una fila EXPORT con entidad_id "puc-efectivo"', async () => {
    const antes = await exportsDeAuditLog(a.tenantId, 'puc-efectivo');
    const res = await GET_PUC_EXPORTAR();
    expect(res.status).toBe(200);
    expect(await exportsDeAuditLog(a.tenantId, 'puc-efectivo')).toBe(antes + 1);
  });

  it('descargar el maestro de terceros escribe una fila EXPORT con entidad_id "terceros-maestro"', async () => {
    const antes = await exportsDeAuditLog(a.tenantId, 'terceros-maestro');
    const res = await GET_TERCEROS_EXPORTAR();
    expect(res.status).toBe(200);
    expect(await exportsDeAuditLog(a.tenantId, 'terceros-maestro')).toBe(antes + 1);
  });

  it('sin rastro, sin archivo: si `app.registrar_exportacion` no se puede ejecutar, ninguna de las dos rutas entrega el .xlsx', async () => {
    await db.asAdmin((tx) =>
      tx.query('REVOKE EXECUTE ON FUNCTION app.registrar_exportacion(text, jsonb) FROM app_user, PUBLIC'),
    );
    try {
      const resPuc = await GET_PUC_EXPORTAR();
      expect(resPuc.status).toBe(500);
      expect(resPuc.headers.get('content-type')).toMatch(/json/);
      const resTerceros = await GET_TERCEROS_EXPORTAR();
      expect(resTerceros.status).toBe(500);
      expect(resTerceros.headers.get('content-type')).toMatch(/json/);
    } finally {
      await db.asAdmin((tx) =>
        tx.query('GRANT EXECUTE ON FUNCTION app.registrar_exportacion(text, jsonb) TO app_user'),
      );
    }
  });

  it('RLS: la firma B no descarga ni el PUC ni el maestro de terceros de la firma A', async () => {
    cookieValores = { [COOKIE_SESSION_TOKEN]: tokenB, [COOKIE_COMPANY_ID]: a.companyId };
    expect((await GET_PUC_EXPORTAR()).status).toBe(403);
    expect((await GET_TERCEROS_EXPORTAR()).status).toBe(403);
  });

  it('apretado a propósito: `solo_lectura` deja de poder exportar (le falta `reporte.exportar`), aunque sí lee el PUC y los terceros', async () => {
    cookieValores[COOKIE_SESSION_TOKEN] = tokenSoloLectura;
    const resPuc = await GET_PUC_EXPORTAR();
    expect(resPuc.status).toBe(403);
    expect((await resPuc.json()).motivo).toBe('permiso_insuficiente');
    const resTerceros = await GET_TERCEROS_EXPORTAR();
    expect(resTerceros.status).toBe(403);
    expect((await resTerceros.json()).motivo).toBe('permiso_insuficiente');
  });
});

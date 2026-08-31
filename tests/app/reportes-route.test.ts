/**
 * A9 — V-16 (cierre de bloqueo de la Ola 3): la ruta de descarga de reportes.
 *
 * `app/api/reportes/[libro]/route.ts` es el ÚNICO punto de entrada HTTP hacia
 * `src/reports/`. A14 ya había verificado los veinte libros como funciones
 * (`tests/reports/*`, `tests/adversarial/compuerta-ola3-entregas.test.ts`);
 * lo que faltaba probar es la RUTA misma: que sirve el `.xlsx` de verdad, que
 * respeta la sesión, y que la empresa no se puede elegir desde fuera.
 *
 * `app/lib/sesion.ts` usa `cookies()`/`headers()` de `next/headers`, que solo
 * funcionan dentro del runtime real de Next (fuera de un `next dev`/`next
 * start` lanzan "called outside a request scope"). Aquí se sustituye ESE
 * módulo por un doble de prueba que lee de un jarro de cookies mutable — la
 * propia documentación de `app/lib/sesion.ts` dice que esa capa "traduce la
 * cookie... la garantía de seguridad NO está ahí": la garantía real
 * (`withSessionContext`, `app.exigir_permiso`) corre sin ningún doble, contra
 * la base de datos real de pruebas (PGlite), exactamente igual que en
 * producción.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { createTestDb, type TestDb } from '../helpers/db';
import { crearEscenario, type Escenario } from '../helpers/fixtures';
import type { DbHandle } from '../../src/db/types';

// -----------------------------------------------------------------------------
// Dobles de prueba: SOLO la traducción HTTP <-> cookie, y el singleton de
// conexión. Ninguno de los dos participa en la autorización real: por eso se
// pueden sustituir sin dejar de probar la garantía de verdad (D-021/D-022),
// que vive en `withSessionContext` y en `app.exigir_permiso`, y que aquí
// corre contra la base de datos real de pruebas (PGlite), sin ningún doble.
// -----------------------------------------------------------------------------

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

// Importados DESPUÉS de los `vi.mock` en el archivo, pero Vitest los eleva
// (hoisting) por encima de estos imports estáticos: cuando `route.ts` y
// `sesion.ts` importen `next/headers` y `../lib/db`, ya reciben el doble.
import { GET } from '../../app/api/reportes/[libro]/route';
import { COOKIE_SESSION_TOKEN, COOKIE_COMPANY_ID } from '../../app/lib/sesion';

let db: TestDb;
let e: Escenario;
let otra: Escenario;

const RANGO = { desde: '2026-06-01', hasta: '2026-06-30' };

function pedir(libro: string, query: Record<string, string> = {}): Request {
  const url = new URL(`http://localhost/api/reportes/${libro}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return new Request(url);
}

function llamar(libro: string, query: Record<string, string> = {}): Promise<Response> {
  return GET(pedir(libro, query), { params: Promise.resolve({ libro }) });
}

beforeAll(async () => {
  db = await createTestDb();
  dbHandle = db.client;
  e = await crearEscenario(db);
  otra = await crearEscenario(db);

  // Un asiento real en `e`, para que el libro diario no salga vacío y el
  // .xlsx resultante tenga al menos una fila de datos que verificar.
  await db.asAdmin(async (tx) => {
    const entryId = crypto.randomUUID();
    await tx.query(
      `INSERT INTO journal_entry (id, tenant_id, company_id, fiscal_period_id, fecha_hecho_economico,
                                  descripcion, estado, source_document_id, approval_id, idempotency_key, created_by)
       VALUES ($1,$2,$3,$4,'2026-06-15','Asiento de prueba de la ruta de reportes (A9)','draft',$5,$6,$7,$8)`,
      [entryId, e.tenantId, e.companyId, e.fiscalPeriodId, e.sourceDocumentId, e.approvalId, `idem-a9-ruta-${entryId}`, e.userId],
    );
    await tx.query(
      `INSERT INTO journal_line (tenant_id, company_id, journal_entry_id, linea, account_id, side, monto, third_party_id)
       VALUES ($1,$2,$3,1,$4,'debito',1000000,$5), ($1,$2,$3,2,$6,'credito',1000000,$5)`,
      [e.tenantId, e.companyId, entryId, e.cuentas.gasto, e.thirdPartyId, e.cuentas.proveedores],
    );
    await tx.query('SELECT app.publicar_asiento($1, $2)', [entryId, e.userId]);
  });
});

afterAll(async () => {
  await db.close();
});

beforeEach(() => {
  cookieValores = {};
  cabeceraValores = {};
});

/** Emite una sesión real (token de `app.abrir_sesion`) y arma el jarro de
 * cookies que verá la ruta — exactamente lo que pondría el navegador. */
async function sesionDe(esc: Escenario, rolCodigo = 'contador'): Promise<void> {
  const { token } = await db.emitirSesion(esc.tenantId, esc.companyId, { rolCodigo });
  cookieValores[COOKIE_SESSION_TOKEN] = token;
  cookieValores[COOKIE_COMPANY_ID] = esc.companyId;
}

describe('V-16 · GET /api/reportes/[libro] — el único punto de entrada a src/reports/', () => {
  it('sin ninguna cookie de sesión: 401, y NO llega a tocar la base de datos', async () => {
    const respuesta = await llamar('libro-diario', RANGO);
    expect(respuesta.status).toBe(401);
    const cuerpo = await respuesta.json();
    expect(cuerpo.ok).toBe(false);
    expect(cuerpo.motivo).toBe('no_autenticado');
    // Content-Type sigue siendo JSON de error, nunca el xlsx.
    expect(respuesta.headers.get('content-type')).toMatch(/application\/json/);
  });

  it('con una cookie de sesión que no resuelve a ninguna sesión vigente: 401', async () => {
    cookieValores[COOKIE_SESSION_TOKEN] = 'token-inventado-que-no-existe-en-user_session';
    cookieValores[COOKIE_COMPANY_ID] = e.companyId;
    const respuesta = await llamar('libro-diario', RANGO);
    expect(respuesta.status).toBe(401);
  });

  it('reporte desconocido: 404 con la lista de reportes válidos, sin exigir sesión primero', async () => {
    const respuesta = await llamar('libro-que-no-existe', RANGO);
    expect(respuesta.status).toBe(404);
    const cuerpo = await respuesta.json();
    expect(cuerpo.motivo).toBe('reporte_desconocido');
    expect(cuerpo.detalle).toContain('libro-diario');
  });

  it('falta un parámetro obligatorio ("hasta"): 400, no 500 ni un xlsx vacío', async () => {
    await sesionDe(e);
    const respuesta = await llamar('libro-diario', { desde: RANGO.desde });
    expect(respuesta.status).toBe(400);
    const cuerpo = await respuesta.json();
    expect(cuerpo.motivo).toBe('parametro_invalido');
  });

  it('sesión válida, permiso "reporte.exportar", empresa propia: 200 con un .xlsx que se vuelve a abrir', async () => {
    await sesionDe(e, 'contador');
    const respuesta = await llamar('libro-diario', RANGO);
    expect(respuesta.status).toBe(200);
    expect(respuesta.headers.get('content-type')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    const disposicion = respuesta.headers.get('content-disposition') ?? '';
    expect(disposicion).toMatch(/^attachment; filename="/);
    // El nombre de archivo trae la empresa (razón social) y el período, no un
    // nombre genérico: sirve para un contador que descarga muchos reportes.
    expect(disposicion).toContain('libro-diario');
    expect(disposicion).toContain('2026_06_01_a_2026_06_30');

    const buffer = Buffer.from(await respuesta.arrayBuffer());
    expect(buffer.byteLength).toBeGreaterThan(0);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const nombresHojas = wb.worksheets.map((h) => h.name);
    expect(nombresHojas).toEqual(['Datos', 'Papel de trabajo', 'Trazabilidad', 'Parámetros']);

    // La razón social de la hoja "Papel de trabajo" es la de LA EMPRESA DE LA
    // SESIÓN (`e`), nunca la de `otra` ni un valor inventado por la petición.
    const hojaPapel = wb.getWorksheet('Papel de trabajo')!;
    const filaEmpresa = String(hojaPapel.getRow(2).getCell(1).value ?? '');
    expect(filaEmpresa).toContain(`Empresa cliente`);
  });

  it('sesión válida pero SIN "reporte.exportar" (rol solo_lectura): 403, y no entrega el archivo', async () => {
    await sesionDe(e, 'solo_lectura');
    const respuesta = await llamar('libro-diario', RANGO);
    expect(respuesta.status).toBe(403);
    const cuerpo = await respuesta.json();
    expect(cuerpo.motivo).toBe('permiso_insuficiente');
    expect(respuesta.headers.get('content-type')).toMatch(/application\/json/);
  });

  it(
    'la cookie de empresa NO es el filtro de seguridad: pedir la empresa AJENA (otro tenant) con un ' +
      'token de sesión válido de OTRA empresa se rechaza en la base, nunca sirve el libro ajeno',
    async () => {
      // Token real, emitido y autorizado SOLO para `e.companyId`.
      const { token } = await db.emitirSesion(e.tenantId, e.companyId, { rolCodigo: 'contador' });
      cookieValores[COOKIE_SESSION_TOKEN] = token;
      // El cliente (o un atacante manipulando la cookie) pide la empresa de
      // OTRO tenant, sobre la que esa sesión nunca tuvo acceso.
      cookieValores[COOKIE_COMPANY_ID] = otra.companyId;

      const respuesta = await llamar('libro-diario', RANGO);
      expect(respuesta.status).toBe(403);
      const cuerpo = await respuesta.json();
      expect(cuerpo.motivo).toBe('empresa_no_autorizada');
      expect(respuesta.headers.get('content-type')).toMatch(/application\/json/);

      // Y quedó el rastro de acceso denegado en la auditoría de LA FIRMA que
      // intentó el acceso (Regla de Oro 6/7).
      await db.asAdmin(async (tx) => {
        const { rows } = await tx.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM audit_log
            WHERE tenant_id = $1 AND accion = 'ACCESO_DENEGADO'`,
          [e.tenantId],
        );
        expect(Number(rows[0]!.n)).toBeGreaterThan(0);
      });
    },
  );

  it('la ruta nunca toma la empresa de un parámetro de la query: un "companyId" en la URL se ignora', async () => {
    await sesionDe(e, 'contador');
    // Si la ruta leyera esto, estaría sorteando RLS por un parámetro de
    // aplicación (justo lo que D-021/D-022 prohíben). El código de
    // `route.ts` no declara ningún `sp.get('companyId')`; esta prueba deja
    // constancia de que, aunque alguien lo mande, no cambia nada.
    const respuesta = await llamar('libro-diario', { ...RANGO, companyId: otra.companyId });
    expect(respuesta.status).toBe(200);
    const buffer = Buffer.from(await respuesta.arrayBuffer());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const filaEmpresa = String(wb.getWorksheet('Papel de trabajo')!.getRow(2).getCell(1).value ?? '');
    expect(filaEmpresa).not.toContain('otra');
  });
});

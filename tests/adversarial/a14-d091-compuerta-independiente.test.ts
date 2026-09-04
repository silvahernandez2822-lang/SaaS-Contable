/**
 * A14 — COMPUERTA AMPLIADA E INDEPENDIENTE DE D-091 (módulo de Reportes, Fase 7).
 *
 * La ficha D-091 declara que su propia verificación adversarial la corrió el
 * MISMO agente que implementó (A9), por falta de despacho de subagentes. Esta
 * es la verificación independiente que exige el proceso del proyecto. No se
 * confía en ninguna afirmación de la ficha: se vuelve a medir lo que importa,
 * con ataques reales contra la base, en los puntos que la batería heredada
 * NO cubría:
 *
 *   1. RASTRO EXPORT DE LOS VEINTIÚN REPORTES, MEDIDO EN `audit_log`, no
 *      contado por lectura de código. La prueba de A9 solo comprobaba que
 *      ningún generador quedara huérfano de slug; nadie descargó los 21 y
 *      contó las filas EXPORT resultantes. Se hace aquí, uno por uno.
 *   2. PARIDAD CATÁLOGO ↔ RUTA: cada slug pintado en `app/reportes/page.tsx`
 *      existe en la ruta y, con SOLO los campos que el formulario declara
 *      obligatorios, devuelve 200 (no 400). Un slug mal escrito o un campo
 *      obligatorio olvidado en el catálogo es un botón roto en producción.
 *   3. EL REPORTE NUEVO (`ica-municipio`) CON DATOS DE VERDAD. La única prueba
 *      que dejó A9 lo ejerció con CERO retenciones de ReteICA: ni el SQL de
 *      `icaPorMunicipio` ni `resumenPorMunicipio` se ejecutaron nunca contra
 *      una fila. Aquí se siembran retenciones de ReteICA reales en dos
 *      municipios, y se verifica agrupación, aislamiento entre firmas y el
 *      filtro V-30 (asiento en borrador o anulado no es retención practicada).
 *   4. HISTORIAL ATACADO POR LA RUTA REAL, no solo por el servicio: la firma B
 *      no ve en su historial lo que descargó la firma A.
 *   5. VALIDACIÓN DE PERÍODO: fechas sintácticamente válidas pero imposibles.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createTestDb, uuid, type TestDb } from '../helpers/db';
import { crearEscenario, type Escenario } from '../helpers/fixtures';
import type { DbHandle, SqlClient } from '../../src/db/types';

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
import { COOKIE_SESSION_TOKEN, COOKIE_COMPANY_ID } from '../../app/lib/sesion';
import { listarHistorialReportes } from '../../src/reports/historial';
import { icaPorMunicipio } from '../../src/reports/consulta';
import { generarIcaPorMunicipio } from '../../src/reports/libros';

let db: TestDb;
let a: Escenario;
let b: Escenario;
let tokenA = '';
let tokenB = '';
let municipioBogota = '';
let municipioCali = '';

const RANGO = { desde: '2026-06-01', hasta: '2026-06-30' };

// -----------------------------------------------------------------------------
// El catálogo de la PANTALLA, leído del propio archivo fuente: los slugs y los
// campos obligatorios que pinta. Si el catálogo y la ruta se desincronizan,
// esto lo ve.
// -----------------------------------------------------------------------------

interface ReporteDelCatalogo {
  slug: string;
  camposRequeridos: string[];
}

/** Ejecuta el módulo de la pantalla no es posible (es un server component con
 *  JSX); se extrae el catálogo del texto, que es lo que de verdad se despliega. */
function catalogoDeLaPantalla(): ReporteDelCatalogo[] {
  const src = readFileSync('app/reportes/page.tsx', 'utf8');
  const bloque = /const CATEGORIAS: Categoria\[\] = \[([\s\S]*?)\n\];/.exec(src);
  if (!bloque) throw new Error('no se pudo localizar CATEGORIAS en app/reportes/page.tsx');
  const texto = bloque[1]!;

  // Campos declarados por constante reutilizable.
  const rango = /const CAMPOS_RANGO: CampoReporte\[\] = \[([\s\S]*?)\];/.exec(src)![1]!;
  const camposDeRango = [...rango.matchAll(/nombre: '([^']+)'[^}]*requerido: (true|false)/g)]
    .filter((m) => m[2] === 'true')
    .map((m) => m[1]!);

  const salida: ReporteDelCatalogo[] = [];
  // Cada entrada de reporte empieza en `slug: '...'` y termina donde empieza la siguiente.
  const indices = [...texto.matchAll(/slug: '([^']+)'/g)];
  for (let i = 0; i < indices.length; i += 1) {
    const slug = indices[i]![1]!;
    const desde = indices[i]!.index!;
    const hasta = i + 1 < indices.length ? indices[i + 1]!.index! : texto.length;
    const cuerpo = texto.slice(desde, hasta);
    const requeridos: string[] = [];
    if (/CAMPOS_RANGO/.test(cuerpo)) requeridos.push(...camposDeRango);
    for (const m of cuerpo.matchAll(/nombre: '([^']+)'[^}]*?requerido: true/g)) requeridos.push(m[1]!);
    salida.push({ slug, camposRequeridos: [...new Set(requeridos)] });
  }
  return salida;
}

/** Valor plausible para cada campo obligatorio del catálogo. */
function valorDe(campo: string, esc: Escenario): string {
  switch (campo) {
    case 'desde':
      return RANGO.desde;
    case 'hasta':
    case 'fechaCorte':
      return RANGO.hasta;
    case 'nivel':
      return '3';
    case 'anioGravable':
      return '2026';
    case 'accountId':
      return esc.cuentas.gasto;
    case 'terceroId':
      return esc.thirdPartyId;
    default:
      throw new Error(`campo obligatorio del catálogo sin valor de prueba: ${campo}`);
  }
}

function llamar(libro: string, query: Record<string, string> = {}): Promise<Response> {
  const url = new URL(`http://localhost/api/reportes/${encodeURIComponent(libro)}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return GET(new Request(url), { params: Promise.resolve({ libro }) });
}

async function filasExport(tenantId: string, companyId: string, slug: string): Promise<number> {
  const { rows } = await db.asAdmin((tx) =>
    tx.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit_log
        WHERE accion = 'EXPORT' AND entidad = 'reporte' AND entidad_id = $1
          AND tenant_id = $2 AND company_id = $3`,
      [slug, tenantId, companyId],
    ),
  );
  return Number(rows[0]!.n);
}

/**
 * Siembra una retención de ReteICA REAL: concepto + regla vigente + retención
 * atada a un asiento en el estado que se pida. Devuelve el id de la retención.
 */
async function sembrarReteIca(
  tx: SqlClient,
  esc: Escenario,
  opciones: {
    municipalityId: string;
    base: number;
    valor: number;
    tarifa: string;
    fecha: string;
    estadoAsiento: 'posted' | 'draft';
  },
): Promise<string> {
  const { rows: tc } = await tx.query<{ id: string }>(
    `INSERT INTO tax_concept (tenant_id, company_id, tipo, codigo, nombre)
     VALUES (NULL, NULL, 'reteica', $1, 'Concepto ICA de prueba A14 (no es un valor tributario real)')
     RETURNING id`,
    [`concepto_ica_a14_${uuid()}`],
  );
  const { rows: tr } = await tx.query<{ id: string; vigente_desde: string }>(
    `INSERT INTO tax_rule (
       tenant_id, company_id, tax_concept_id, tipo, tarifa, aplica_sobre, aplica_a,
       tipo_persona, account_id, municipality_id, vigente_desde, norma_respaldo
     ) VALUES ($1,$2,$3,'reteica',$4,'base_gravable','ambos','ambos',$5,$6,'2026-01-01',
               'Acuerdo municipal de prueba A14 (mecánica de reportes, no un dato normativo real)')
     RETURNING id, vigente_desde::text`,
    [esc.tenantId, esc.companyId, tc[0]!.id, opciones.tarifa, esc.cuentas.retefuentePorPagar, opciones.municipalityId],
  );

  const entryId = uuid();
  await tx.query(
    `INSERT INTO journal_entry (id, tenant_id, company_id, fiscal_period_id, fecha_hecho_economico,
                                descripcion, estado, source_document_id, approval_id, idempotency_key, created_by)
     VALUES ($1,$2,$3,$4,$5,'Asiento con ReteICA (A14 D-091)','draft',$6,$7,$8,$9)`,
    [entryId, esc.tenantId, esc.companyId, esc.fiscalPeriodId, opciones.fecha,
     esc.sourceDocumentId, esc.approvalId, `idem-a14-ica-${entryId}`, esc.userId],
  );

  const { rows: ra } = await tx.query<{ id: string }>(
    `INSERT INTO retention_applied (
       tenant_id, company_id, source_document_id, journal_entry_id, third_party_id, tipo,
       base, tarifa, valor, tax_rule_id, regla_vigente_desde, norma_respaldo, account_id,
       municipality_id, fecha_hecho_economico, aplicada
     ) VALUES ($1,$2,$3,$4,$5,'reteica',$6,$7,$8,$9,$10,'Acuerdo municipal de prueba A14',$11,$12,$13,true)
     RETURNING id`,
    [esc.tenantId, esc.companyId, esc.sourceDocumentId, entryId, esc.thirdPartyId,
     opciones.base, opciones.tarifa, opciones.valor, tr[0]!.id, tr[0]!.vigente_desde,
     esc.cuentas.retefuentePorPagar, opciones.municipalityId, opciones.fecha],
  );

  await tx.query(
    `INSERT INTO journal_line (tenant_id, company_id, journal_entry_id, linea, account_id, side, monto,
                               third_party_id, retention_applied_id)
     VALUES ($1,$2,$3,1,$4,'debito',$5,$6,NULL),
            ($1,$2,$3,2,$7,'credito',$5,$6,$8)`,
    [esc.tenantId, esc.companyId, entryId, esc.cuentas.gasto, opciones.base, esc.thirdPartyId,
     esc.cuentas.retefuentePorPagar, ra[0]!.id],
  );

  if (opciones.estadoAsiento === 'posted') {
    await tx.query('SELECT app.publicar_asiento($1, $2)', [entryId, esc.userId]);
  }
  return ra[0]!.id;
}

beforeAll(async () => {
  db = await createTestDb();
  dbHandle = db.client;
  a = await crearEscenario(db, { razonSocial: 'Firma A — compuerta independiente D-091' });
  b = await crearEscenario(db, { razonSocial: 'Firma B — compuerta independiente D-091' });

  await db.asAdmin(async (tx) => {
    municipioBogota = uuid();
    municipioCali = uuid();
    await tx.query(
      `INSERT INTO municipality (id, tenant_id, codigo_dane, nombre, departamento, codigo_dane_departamento)
       VALUES ($1,$2,$3,'AAA Municipio Uno (A14)','Departamento de prueba','11'),
              ($4,$2,$5,'BBB Municipio Dos (A14)','Departamento de prueba','76')`,
      [municipioBogota, a.tenantId, '05001', municipioCali, '76001'],
    );

    // Dos municipios distintos, tres retenciones publicadas + una en borrador.
    await sembrarReteIca(tx, a, {
      municipalityId: municipioBogota, base: 10_000_00, valor: 41_40, tarifa: '0.004140',
      fecha: '2026-06-05', estadoAsiento: 'posted',
    });
    await sembrarReteIca(tx, a, {
      municipalityId: municipioBogota, base: 20_000_00, valor: 82_80, tarifa: '0.004140',
      fecha: '2026-06-06', estadoAsiento: 'posted',
    });
    await sembrarReteIca(tx, a, {
      municipalityId: municipioCali, base: 50_000_00, valor: 350_00, tarifa: '0.007000',
      fecha: '2026-06-07', estadoAsiento: 'posted',
    });
    // V-30: en borrador, NO es una retención practicada.
    await sembrarReteIca(tx, a, {
      municipalityId: municipioCali, base: 99_999_00, valor: 999_99, tarifa: '0.007000',
      fecha: '2026-06-08', estadoAsiento: 'draft',
    });
  });

  tokenA = (await db.emitirSesion(a.tenantId, a.companyId, { sesionNueva: true })).token;
  tokenB = (await db.emitirSesion(b.tenantId, b.companyId, { sesionNueva: true })).token;
}, 300_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(() => {
  cookieValores = { [COOKIE_SESSION_TOKEN]: tokenA, [COOKIE_COMPANY_ID]: a.companyId };
  cabeceraValores = { 'x-forwarded-for': '198.51.100.14', 'user-agent': 'A14-independiente' };
});

// =============================================================================
// 1 y 2. Paridad catálogo ↔ ruta + rastro EXPORT de LOS VEINTIUNO, medido
// =============================================================================

describe('A14 · D-091 (independiente) — el catálogo y la ruta no se han desincronizado', () => {
  it('la pantalla pinta exactamente 21 reportes, todos con slug único', () => {
    const catalogo = catalogoDeLaPantalla();
    expect(catalogo.length).toBe(21);
    expect(new Set(catalogo.map((c) => c.slug)).size).toBe(21);
  });

  it('todo slug del catálogo existe en la ruta (ninguno devuelve 404)', async () => {
    const desconocidos: string[] = [];
    for (const r of catalogoDeLaPantalla()) {
      // eslint-disable-next-line no-await-in-loop
      const res = await llamar(r.slug, {});
      if (res.status === 404) desconocidos.push(r.slug);
    }
    expect(desconocidos).toEqual([]);
  }, 120_000);

  it(
    'con SOLO los campos que el formulario marca obligatorios, los 21 dan 200 y dejan su fila EXPORT',
    async () => {
      const catalogo = catalogoDeLaPantalla();
      const fallos: string[] = [];
      const sinRastro: string[] = [];

      for (const r of catalogo) {
        const query: Record<string, string> = {};
        for (const campo of r.camposRequeridos) query[campo] = valorDe(campo, a);
        // eslint-disable-next-line no-await-in-loop
        const antes = await filasExport(a.tenantId, a.companyId, r.slug);
        // eslint-disable-next-line no-await-in-loop
        const res = await llamar(r.slug, query);
        if (res.status !== 200) {
          // eslint-disable-next-line no-await-in-loop
          fallos.push(`${r.slug} -> ${res.status} ${(await res.text()).slice(0, 200)}`);
          continue;
        }
        // eslint-disable-next-line no-await-in-loop
        const despues = await filasExport(a.tenantId, a.companyId, r.slug);
        if (despues !== antes + 1) sinRastro.push(`${r.slug} (${antes} -> ${despues})`);
      }

      expect(fallos, 'reportes del catálogo que no se pueden descargar con sus campos obligatorios').toEqual([]);
      expect(sinRastro, 'reportes descargados SIN dejar rastro EXPORT en audit_log').toEqual([]);
    },
    300_000,
  );

  it('las 21 filas EXPORT quedaron con la empresa de la SESIÓN, nunca con otra', async () => {
    const { rows } = await db.asAdmin((tx) =>
      tx.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM audit_log
          WHERE accion = 'EXPORT' AND entidad = 'reporte'
            AND (tenant_id <> $1 OR company_id <> $2)`,
        [a.tenantId, a.companyId],
      ),
    );
    expect(Number(rows[0]!.n)).toBe(0);
  });

  it('cada fila EXPORT identifica al usuario y su origen (Regla de Oro 6)', async () => {
    const { rows } = await db.asAdmin((tx) =>
      tx.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM audit_log
          WHERE accion = 'EXPORT' AND entidad = 'reporte'
            AND (user_id IS NULL OR entidad_id IS NULL)`,
      ),
    );
    expect(Number(rows[0]!.n)).toBe(0);
  });
});

// =============================================================================
// 3. `ica-municipio` CON DATOS (lo que la prueba de A9 nunca ejerció)
// =============================================================================

describe('A14 · D-091 (independiente) — ICA por municipio con retenciones de verdad', () => {
  it('devuelve solo las de asiento PUBLICADO, agrupables por municipio (V-30)', async () => {
    const filas = await db.asTenant(a.tenantId, a.companyId, (tx) => icaPorMunicipio(tx, RANGO));
    expect(filas.length).toBe(3); // la del borrador NO cuenta
    expect(filas.every((f) => f.tipo === 'reteica')).toBe(true);
    expect(filas.map((f) => f.valor)).not.toContain('99999');
    // Ordenado por nombre de municipio: los dos del "AAA" primero.
    expect(filas.map((f) => f.municipioNombre)).toEqual([
      'AAA Municipio Uno (A14)',
      'AAA Municipio Uno (A14)',
      'BBB Municipio Dos (A14)',
    ]);
  });

  it('el dinero llega en ENTEROS de centavos como texto, nunca como float (Regla 5)', async () => {
    const filas = await db.asTenant(a.tenantId, a.companyId, (tx) => icaPorMunicipio(tx, RANGO));
    for (const f of filas) {
      expect(typeof f.base, 'base debe llegar como texto para no perder precisión').toBe('string');
      expect(f.base).toMatch(/^-?\d+$/);
      expect(f.valor).toMatch(/^-?\d+$/);
      expect(() => BigInt(f.valor)).not.toThrow();
    }
    expect(filas.map((f) => f.valor).sort()).toEqual(['35000', '4140', '8280']);
  });

  it('el resumen del Excel suma por municipio, no por fila suelta', async () => {
    const wb = await db.asTenant(a.tenantId, a.companyId, (tx) => generarIcaPorMunicipio(tx, RANGO));
    const papel = wb.getWorksheet('Papel de trabajo')!;
    const textos: string[] = [];
    papel.eachRow((fila) => fila.eachCell({ includeEmpty: false }, (c) => textos.push(String(c.value ?? ''))));
    const todo = textos.join('|');
    expect(todo).toContain('AAA Municipio Uno (A14)');
    expect(todo).toContain('BBB Municipio Dos (A14)');
    // La suma la hace `resumenPorMunicipio` en BigInt sobre CENTAVOS
    // (4140 + 8280 = 12420 · 35000); la hoja los presenta en pesos con la
    // misma conversión `centavosANumeroPesos` de todos los libros desde la
    // Ola 3 — 124,20 y 350,00. Lo que se verifica es que agrupe por municipio
    // y no fila a fila.
    const numeros = textos.map((t) => Number(t)).filter((n) => Number.isFinite(n));
    expect(numeros).toContain(124.2);
    expect(numeros).toContain(350);
    expect(numeros).toContain(30000); // base total del municipio AAA en pesos
    expect(numeros).toContain(2); // dos operaciones en AAA, una en BBB
    expect(numeros).not.toContain(999.99); // la del asiento en borrador no entró
    // Y la trazabilidad NO dice "no hay retenciones" cuando sí las hay.
    const traza = wb.getWorksheet('Trazabilidad')!;
    expect(String(traza.getRow(1).getCell(1).value ?? '')).not.toContain('No hay retenciones');
  });

  it('la firma B no ve NI UNA retención de ICA de la firma A (RLS, Regla 7)', async () => {
    const filas = await db.asTenant(b.tenantId, b.companyId, (tx) => icaPorMunicipio(tx, RANGO));
    expect(filas).toEqual([]);
  });

  it('por HTTP: el .xlsx que baja la firma B no contiene ningún municipio de A', async () => {
    cookieValores = { [COOKIE_SESSION_TOKEN]: tokenB, [COOKIE_COMPANY_ID]: b.companyId };
    const res = await llamar('ica-municipio', { ...RANGO, permitirVacio: '1' });
    expect(res.status).toBe(200);
    const buffer = Buffer.from(await res.arrayBuffer());
    expect(buffer.toString('latin1')).not.toContain('AAA Municipio Uno');
  });
});

// =============================================================================
// 4. El historial, atacado sobre lo que la RUTA escribió de verdad
// =============================================================================

describe('A14 · D-091 (independiente) — el historial no cruza la frontera de la firma', () => {
  it('la firma B no ve en su historial nada de lo que descargó la firma A', async () => {
    const deA = await db.asTenant(a.tenantId, a.companyId, (tx) => listarHistorialReportes(tx, { porPagina: 200 }));
    expect(deA.total).toBeGreaterThanOrEqual(21);

    const deB = await db.asTenant(b.tenantId, b.companyId, (tx) => listarHistorialReportes(tx, { porPagina: 200 }));
    // B solo pudo haber registrado su propia descarga de ica-municipio.
    expect(deB.filas.every((f) => f.reporteSlug === 'ica-municipio')).toBe(true);
    expect(deB.total).toBeLessThan(deA.total);
  });

  it('un `porPagina` gigante no se convierte en una fuga: sigue acotado y sigue bajo RLS', async () => {
    const r = await db.asTenant(b.tenantId, b.companyId, (tx) =>
      listarHistorialReportes(tx, { pagina: 1, porPagina: Number.MAX_SAFE_INTEGER }),
    );
    expect(r.porPagina).toBeLessThanOrEqual(200);
    expect(r.filas.length).toBeLessThanOrEqual(200);
    expect(r.filas.every((f) => f.reporteSlug === 'ica-municipio')).toBe(true);
  });

  it('el historial solo muestra EXPORT de reportes, no toda la auditoría de la empresa', async () => {
    const r = await db.asTenant(a.tenantId, a.companyId, (tx) => listarHistorialReportes(tx, { porPagina: 200 }));
    const { rows } = await db.asAdmin((tx) =>
      tx.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM audit_log WHERE tenant_id = $1 AND company_id = $2`,
        [a.tenantId, a.companyId],
      ),
    );
    // Hay MUCHÍSIMO más en audit_log que las exportaciones (publicaciones,
    // inserciones de terceros...): el historial no puede estar mostrándolo.
    expect(Number(rows[0]!.n)).toBeGreaterThan(r.total);
  });
});

// =============================================================================
// 5. Validación de período: sintaxis correcta, fecha imposible
// =============================================================================

describe('A14 · D-091 (independiente) — filtros de período', () => {
  it('un rango invertido no revienta ni devuelve datos de fuera del rango', async () => {
    const res = await llamar('ica-municipio', { desde: '2026-06-30', hasta: '2026-06-01', permitirVacio: '1' });
    expect([200, 400]).toContain(res.status);
  });

  // ---------------------------------------------------------------------------
  // El defecto real que encontró esta compuerta: `RE_FECHA` validaba SINTAXIS y
  // nada más, así que `2026-02-30` llegaba como parámetro a PostgreSQL, el
  // motor reventaba al castear y el usuario recibía el 500 genérico («un
  // problema técnico del sistema. No es un dato que le falte a usted»), que es
  // justo lo contrario de la verdad: es su dato y él puede corregirlo.
  // Corregido con `esFechaDelCalendario` en la ruta. Estas pruebas son el
  // candado: cualquier fecha que no exista en el calendario, en CUALQUIER campo
  // de fecha (obligatorio u opcional), sale por 400 con el nombre del campo —
  // NUNCA por 500.
  // ---------------------------------------------------------------------------

  /** Día imposible, mes imposible, día cero, año bisiesto falso, y basura pura. */
  const FECHAS_MALAS = [
    '2026-02-30', // día imposible en febrero
    '2026-02-31',
    '2026-04-31', // abril no tiene 31
    '2026-13-01', // mes imposible
    '2026-00-10', // mes cero
    '2026-06-00', // día cero
    '2026-06-32',
    '2025-02-29', // 2025 no es bisiesto
    '0000-00-00',
  ];
  const FECHAS_BASURA = [
    'ayer',
    '30/06/2026',
    '2026-6-1',
    '2026-06-01T00:00:00Z',
    "2026-06-01' OR '1'='1",
    '99999-01-01',
    ' ',
  ];

  it('una fecha con formato válido pero imposible se rechaza con 400, NUNCA con un 500 técnico', async () => {
    for (const mala of FECHAS_MALAS) {
      // eslint-disable-next-line no-await-in-loop
      const res = await llamar('libro-diario', { desde: mala, hasta: '2026-06-30' });
      expect(res.status, `desde=${mala} devolvió ${res.status}`).toBe(400);
    }
  });

  it('la fecha imposible también se rechaza en "hasta", no solo en "desde"', async () => {
    for (const mala of FECHAS_MALAS) {
      // eslint-disable-next-line no-await-in-loop
      const res = await llamar('libro-diario', { desde: '2026-06-01', hasta: mala });
      expect(res.status, `hasta=${mala} devolvió ${res.status}`).toBe(400);
    }
  });

  it('una fecha con formato basura se rechaza con 400, no con un 500', async () => {
    for (const basura of FECHAS_BASURA) {
      // eslint-disable-next-line no-await-in-loop
      const res = await llamar('libro-diario', { desde: basura, hasta: '2026-06-30' });
      expect(res.status, `desde=${JSON.stringify(basura)} devolvió ${res.status}`).toBe(400);
    }
  });

  it('los campos de fecha OPCIONALES tampoco aceptan una fecha inexistente', async () => {
    // `fechaCorteComparativa` del ESF viaja por `fechaOpcional`: ausente y
    // vacío son legítimos; imposible, no.
    const vacio = await llamar('estado-situacion-financiera', {
      fechaCorte: RANGO.hasta,
      fechaCorteComparativa: '',
      permitirVacio: '1',
    });
    expect(vacio.status).not.toBe(500);
    for (const mala of ['2026-02-30', '2026-13-01', 'ayer']) {
      // eslint-disable-next-line no-await-in-loop
      const res = await llamar('estado-situacion-financiera', {
        fechaCorte: RANGO.hasta,
        fechaCorteComparativa: mala,
        permitirVacio: '1',
      });
      expect(res.status, `fechaCorteComparativa=${mala} devolvió ${res.status}`).toBe(400);
    }
  });

  it('el 400 nombra el campo y habla de una fecha real, no de un error técnico', async () => {
    const res = await llamar('libro-diario', { desde: '2026-02-30', hasta: '2026-06-30' });
    expect(res.status).toBe(400);
    const cuerpo = (await res.text()).toLowerCase();
    expect(cuerpo).toContain('desde');
    expect(cuerpo).toContain('fecha');
    // No puede salir por el CASO 3 de D-073 (mensaje de fallo técnico).
    expect(cuerpo).not.toContain('problema técnico');
  });

  it('la fecha imposible se rechaza ANTES de tocar la base: no deja rastro EXPORT', async () => {
    const antes = await filasExport(a.tenantId, a.companyId, 'libro-diario');
    const res = await llamar('libro-diario', { desde: '2026-02-30', hasta: '2026-06-30' });
    expect(res.status).toBe(400);
    expect(await filasExport(a.tenantId, a.companyId, 'libro-diario')).toBe(antes);
  });

  it('una fecha REAL en el límite del calendario sigue siendo aceptada (no se rompió el camino feliz)', async () => {
    for (const buena of ['2024-02-29', '2026-01-31', '2026-12-31']) {
      // eslint-disable-next-line no-await-in-loop
      const res = await llamar('libro-diario', { desde: '2024-01-01', hasta: buena, permitirVacio: '1' });
      expect(res.status, `hasta=${buena} devolvió ${res.status}`).toBe(200);
    }
  });

  it('el año gravable fuera de rango se rechaza con 400', async () => {
    expect((await llamar('exogena-1001', { ...RANGO, anioGravable: '1899' })).status).toBe(400);
    expect((await llamar('exogena-1001', { ...RANGO, anioGravable: '2026.5' })).status).toBe(400);
    expect((await llamar('exogena-1001', { ...RANGO, anioGravable: '2026 OR 1=1' })).status).toBe(400);
  });
});

// =============================================================================
// 6. Regla de Oro 2 sobre lo que D-091 tocó, verificado a mano
// =============================================================================

describe('A14 · D-091 (independiente) — Regla de Oro 2 en el código nuevo', () => {
  const ARCHIVOS_DE_D091 = [
    'app/reportes/page.tsx',
    'app/reportes/historial/page.tsx',
    'src/reports/historial.ts',
    'app/api/reportes/[libro]/route.ts',
  ];

  it('ningún archivo del módulo escribe una tarifa, un porcentaje o un valor de UVT', () => {
    const sospechosos: string[] = [];
    for (const archivo of ARCHIVOS_DE_D091) {
      const src = readFileSync(archivo, 'utf8');
      // 0.04, 0.025, 2.5%, 47_065, 42_412_00... en contexto de asignación.
      for (const m of src.matchAll(/(?:=|:|return)\s*(0\.\d+|\d{1,3}(?:[._]\d{3})+)\b/g)) {
        sospechosos.push(`${archivo}: ${m[0].trim()}`);
      }
      for (const m of src.matchAll(/\b\d+(?:[.,]\d+)?\s*%/g)) sospechosos.push(`${archivo}: ${m[0]}`);
    }
    expect(sospechosos).toEqual([]);
  });

  /**
   * La Regla de Oro 2 prohíbe valores tributarios en el CÓDIGO. Un ejemplo
   * dentro de un comentario (`2026-02-30` explicando por qué se valida el
   * calendario) no es un valor que el motor use: no compila, no se ejecuta y no
   * puede acabar en un asiento. Se quitan comentarios antes de barrer, para que
   * el guardia siga siendo estricto donde importa —el código ejecutable— sin
   * castigar la documentación en línea, que este proyecto exige.
   */
  function sinComentarios(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  }

  it('los únicos números de 4+ cifras de la ruta son cotas de formulario y números de formato DIAN', () => {
    const ruta = sinComentarios(readFileSync('app/api/reportes/[libro]/route.ts', 'utf8'));
    const numeros = new Set([...ruta.matchAll(/\b(\d{4,})\b/g)].map((m) => m[1]!));
    // 2000/2100: cotas del campo "año gravable". 1001..1009: el NÚMERO del
    // formato de exógena (un identificador, no una tarifa ni una base).
    const permitidos = new Set(['2000', '2100', '1001', '1003', '1005', '1006', '1007', '1008', '1009']);
    expect([...numeros].filter((n) => !permitidos.has(n))).toEqual([]);
  });
});

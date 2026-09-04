/**
 * A14 — compuerta AMPLIADA de D-091, frente 2: el HISTORIAL DE REPORTES
 * atacado como superficie de fuga entre firmas y entre empresas.
 *
 * Mismo criterio exacto que `a14-d090-historial-rls.test.ts`:
 * `src/reports/historial.ts` no lleva un solo filtro de tenant/empresa
 * escrito a mano, se apoya entera en la RLS de `audit_log`. Las filas se
 * siembran con `app.registrar_exportacion` — la MISMA función que usan
 * `/api/reportes/[libro]`, `/api/parametros/puc/exportar` y
 * `/api/terceros/exportar` — no con un INSERT a mano.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createTestDb, uuid, type TestDb } from '../helpers/db';
import { crearEscenario, type Escenario } from '../helpers/fixtures';
import { listarHistorialReportes } from '../../src/reports/historial';

let db: TestDb;
let a: Escenario;
let b: Escenario;
let companyA2: string;

async function exportar(
  tenantId: string,
  companyId: string,
  slug: string,
  periodo: string,
): Promise<void> {
  await db.asTenant(tenantId, companyId, async (tx) => {
    await tx.query('SELECT app.registrar_exportacion($1, $2::jsonb)', [
      slug,
      JSON.stringify({ periodo }),
    ]);
  });
}

beforeAll(async () => {
  db = await createTestDb();
  a = await crearEscenario(db, { razonSocial: 'Firma A del historial de reportes' });
  b = await crearEscenario(db, { razonSocial: 'Firma B del historial de reportes' });

  companyA2 = uuid();
  await db.asAdmin(async (tx) => {
    await tx.query(
      `INSERT INTO company (id, tenant_id, nit, razon_social, municipality_id, ciiu_principal_id,
                            es_agente_retencion_renta, buzon_email)
       VALUES ($1, $2, $3, 'Segunda empresa de la firma A (reportes)', $4, $5, true, $6)`,
      [companyA2, a.tenantId, `801a2${Date.now().toString(36)}`, a.municipalityId, a.ciiuId,
       `a2rep-${Date.now().toString(36)}@inbox.ejemplo.co`],
    );
  });

  await exportar(a.tenantId, a.companyId, 'libro-diario', 'SECRETO-A-2026-06');
  await exportar(a.tenantId, companyA2, 'balance-prueba', 'SECRETO-A2-2026-06');
  await exportar(b.tenantId, b.companyId, 'libro-diario', 'SECRETO-B-2026-06');
}, 300_000);

afterAll(async () => {
  await db.close();
});

function periodos(filas: { periodo: string | null }[]): (string | null)[] {
  return filas.map((f) => f.periodo);
}

describe('A14 · D-091 — el historial de reportes no cruza la frontera de la firma', () => {
  it('la firma A ve SOLO lo suyo de su empresa activa: el período de B no aparece', async () => {
    const historial = await db.asTenant(a.tenantId, a.companyId, (tx) => listarHistorialReportes(tx));
    expect(periodos(historial.filas)).toEqual(['SECRETO-A-2026-06']);
    expect(historial.total).toBe(1);
    expect(JSON.stringify(historial)).not.toContain('SECRETO-B');
    expect(JSON.stringify(historial)).not.toContain('SECRETO-A2');
  });

  it('dos empresas de la MISMA firma no se ven las exportaciones: aislamiento de doble nivel', async () => {
    const desdeA1 = await db.asTenant(a.tenantId, a.companyId, (tx) => listarHistorialReportes(tx));
    const desdeA2 = await db.asTenant(a.tenantId, companyA2, (tx) => listarHistorialReportes(tx));
    expect(periodos(desdeA1.filas)).toEqual(['SECRETO-A-2026-06']);
    expect(periodos(desdeA2.filas)).toEqual(['SECRETO-A2-2026-06']);
  });

  it('caso dorado 20: la sesión de A con la empresa de B en la mano no ve nada de B', async () => {
    const filas = await db
      .asTenant(a.tenantId, b.companyId, (tx) => listarHistorialReportes(tx))
      .catch(() => null);
    if (filas !== null) {
      expect(periodos(filas.filas)).not.toContain('SECRETO-B-2026-06');
      expect(filas.total).toBe(0);
    }
  });

  it('el aislamiento lo hace la BASE: sin RLS (admin) se ven las tres, con RLS de B solo una', async () => {
    const { rows } = await db.asAdmin((tx) =>
      tx.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM audit_log WHERE accion = 'EXPORT' AND entidad = 'reporte'`,
      ),
    );
    const totalReal = Number(rows[0]!.total);
    const vistoPorB = await db.asTenant(b.tenantId, b.companyId, (tx) => listarHistorialReportes(tx));
    expect(totalReal).toBeGreaterThanOrEqual(3);
    expect(vistoPorB.total).toBe(1);
    expect(vistoPorB.total).toBeLessThan(totalReal);
  });

  it('el servicio no lleva NI UN filtro de aplicación por tenant o empresa', () => {
    const fuente = readFileSync('src/reports/historial.ts', 'utf8');
    const sql = fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\*.*$/gm, '');
    expect(sql).not.toMatch(/tenant_id\s*=/);
    expect(sql).not.toMatch(/company_id\s*=/);
    expect(sql).not.toMatch(/current_tenant_id\(\)/);
    expect(fuente).not.toMatch(/tenantId|companyId/);
  });

  it('`pagina` y `porPagina` absurdos no rompen ni devuelven de más', async () => {
    for (const pagina of [0, -1, -999, Number.NaN, 1e9, 3.7]) {
      const r = await db.asTenant(a.tenantId, a.companyId, (tx) => listarHistorialReportes(tx, { pagina }));
      expect(r.pagina).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(r.pagina)).toBe(true);
      expect(periodos(r.filas)).not.toContain('SECRETO-B-2026-06');
    }
    const r = await db.asTenant(a.tenantId, a.companyId, (tx) => listarHistorialReportes(tx, { porPagina: 100_000 }));
    expect(r.porPagina).toBeLessThanOrEqual(200);
  });

  it('las dos pantallas del módulo son `force-dynamic`', () => {
    for (const ruta of ['app/reportes/page.tsx', 'app/reportes/historial/page.tsx']) {
      expect(readFileSync(ruta, 'utf8'), ruta).toMatch(/export const dynamic\s*=\s*'force-dynamic'/);
    }
  });

  it('la página del historial corre dentro de `conSesion` y exige `auditoria.leer` ANTES de consultar', () => {
    const pagina = readFileSync('app/reportes/historial/page.tsx', 'utf8');
    expect(pagina).toContain('conSesion');
    expect(pagina).toContain('PERMISOS.AUDITORIA_LEER');
    const iPermiso = pagina.indexOf('tienePermiso(tx, PERMISOS.AUDITORIA_LEER)');
    const iConsulta = pagina.indexOf('listarHistorialReportes(tx');
    expect(iPermiso).toBeGreaterThan(-1);
    expect(iConsulta).toBeGreaterThan(iPermiso);
    const leidosDeLaUrl = [...pagina.matchAll(/entero\(sp,\s*'([^']+)'/g)].map((m) => m[1]);
    expect(leidosDeLaUrl).toEqual(['pagina']);
    expect(pagina).not.toMatch(/sp\[['"]/);
  });

  it('la portada de Reportes nunca lee "companyId" ni "empresa" de la URL o del formulario', () => {
    const pagina = readFileSync('app/reportes/page.tsx', 'utf8');
    expect(pagina).not.toMatch(/companyId|empresaId/i);
    // Todos los formularios apuntan a /api/reportes/ o a las rutas de maestros ya auditadas.
    const acciones = [...pagina.matchAll(/action=\{`([^`]+)`\}/g)].map((m) => m[1]);
    for (const accion of acciones) expect((accion ?? '').startsWith('/api/reportes/')).toBe(true);
  });
});

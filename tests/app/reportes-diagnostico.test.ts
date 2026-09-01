/**
 * A16 — Ola 4, Tarea 6: los TRES motivos por los que un reporte no sale llegan
 * al usuario separados (D-073).
 *
 * Es la parte que no se puede comprobar leyendo el código: que un contador
 * distinga «me falta cargar el PUC» de «no hubo movimiento en marzo» de «el
 * sistema se rompió», porque las tres le exigen hacer cosas distintas y una de
 * las tres no es culpa suya.
 *
 * Mismo criterio de dobles que `reportes-route.test.ts`: se sustituye SOLO la
 * traducción HTTP↔cookie. La autorización, la RLS y los generadores corren
 * contra la base real de pruebas.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/db';
import { crearEscenario, type Escenario } from '../helpers/fixtures';
import type { DbHandle } from '../../src/db/types';

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

let db: TestDb;
let e: Escenario;

const RANGO = { desde: '2026-06-01', hasta: '2026-06-30' };

/** Un navegador de verdad manda `Accept: text/html`; `fetch` y `curl` no. */
function pedir(libro: string, query: Record<string, string>, comoNavegador: boolean): Request {
  const url = new URL(`http://localhost/api/reportes/${libro}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return new Request(url, comoNavegador ? { headers: { accept: 'text/html,application/xhtml+xml' } } : undefined);
}

function llamar(libro: string, query: Record<string, string> = {}, comoNavegador = true): Promise<Response> {
  return GET(pedir(libro, query, comoNavegador), { params: Promise.resolve({ libro }) });
}

beforeAll(async () => {
  db = await createTestDb();
  dbHandle = db.client;
  e = await crearEscenario(db);
}, 180_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  const { token } = await db.emitirSesion(e.tenantId, e.companyId, { sesionNueva: true });
  cookieValores = { [COOKIE_SESSION_TOKEN]: token, [COOKIE_COMPANY_ID]: e.companyId };
  cabeceraValores = { 'user-agent': 'prueba-ola4' };
});

// =============================================================================
// CASO 1 — falta configuración: qué falta y dónde se carga
// =============================================================================

describe('A16 · caso 1: falta configuración obligatoria', () => {
  it('sin ninguna cuenta imputable: 409, con el enlace al plan de cuentas', async () => {
    await db.asAdmin((tx) =>
      tx.query('UPDATE account SET permite_movimiento = false WHERE company_id = $1', [e.companyId]),
    );

    const res = await llamar('libro-diario', RANGO, false);
    expect(res.status).toBe(409);
    const cuerpo = (await res.json()) as { motivo: string; detalle: string; enlace: string };
    expect(cuerpo.motivo).toBe('configuracion_faltante');
    expect(cuerpo.detalle).toContain('plan de cuentas');
    expect(cuerpo.enlace).toBe('/parametros/puc');

    await db.asAdmin((tx) =>
      tx.query(
        "UPDATE account SET permite_movimiento = true WHERE company_id = $1 AND codigo <> '5'",
        [e.companyId],
      ),
    );
  });

  it('a un navegador se le responde en HTML legible, con el enlace pinchable', async () => {
    await db.asAdmin((tx) =>
      tx.query('UPDATE account SET permite_movimiento = false WHERE company_id = $1', [e.companyId]),
    );

    const res = await llamar('libro-diario', RANGO, true);
    expect(res.status).toBe(409);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('Falta configuración para este reporte');
    expect(html).toContain('href="/parametros/puc"');
    // Nunca un volcado JSON crudo en la pestaña del navegador.
    expect(html).not.toContain('{"ok":false');

    await db.asAdmin((tx) =>
      tx.query(
        "UPDATE account SET permite_movimiento = true WHERE company_id = $1 AND codigo <> '5'",
        [e.companyId],
      ),
    );
  });

  it('una cuenta que no está en ESTE PUC es configuración faltante, no «sin datos»', async () => {
    const res = await llamar(
      'libro-auxiliar',
      { ...RANGO, accountId: '00000000-0000-0000-0000-00000000dead' },
      false,
    );
    expect(res.status).toBe(409);
    const cuerpo = (await res.json()) as { motivo: string; detalle: string };
    expect(cuerpo.motivo).toBe('configuracion_faltante');
    expect(cuerpo.detalle).toContain('no existe en el plan de cuentas');
  });

  it('un tercero que no es de esta empresa también, y no filtra si existe en otra', async () => {
    const otra = await crearEscenario(db);
    const res = await llamar('certificado-retenciones', { ...RANGO, terceroId: otra.thirdPartyId }, false);
    expect(res.status).toBe(409);
    const cuerpo = (await res.json()) as { detalle: string };
    expect(cuerpo.detalle).toContain('no existe en esta empresa');
  });
});

// =============================================================================
// CASO 2 — la configuración está y no hay movimiento
// =============================================================================

describe('A16 · caso 2: no hay datos para lo que se pidió', () => {
  it('a una persona se le dice qué preguntó, no se le da una hoja en blanco', async () => {
    const res = await llamar('libro-diario', { desde: '2019-01-01', hasta: '2019-01-31' }, true);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('No hay datos');
    expect(html).toContain('2019-01-01');
    expect(html).toContain('2019-01-31');
    // Y se le ofrece el archivo igual, por si necesita el papel de trabajo vacío.
    expect(html).toContain('permitirVacio=1');
  });

  it('el nombre del tercero aparece en el mensaje, no su identificador', async () => {
    const res = await llamar(
      'certificado-retenciones',
      { desde: '2019-01-01', hasta: '2019-01-31', terceroId: e.thirdPartyId },
      true,
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Proveedor');
  });

  it('a un programa se le entrega el `.xlsx` igual: «todo reporte se descarga»', async () => {
    const res = await llamar('libro-diario', { desde: '2019-01-01', hasta: '2019-01-31' }, false);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('spreadsheetml.sheet');
  });

  it('«descargar igual» entrega el archivo también a la persona que lo pide', async () => {
    const res = await llamar(
      'libro-diario',
      { desde: '2019-01-01', hasta: '2019-01-31', permitirVacio: '1' },
      true,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('spreadsheetml.sheet');
  });
});

// =============================================================================
// CASO 3 — fallo técnico: al usuario nada; al registro del servidor, todo
// =============================================================================

describe('A16 · caso 3: el fallo técnico no se le enseña crudo a nadie', () => {
  it('un error inesperado devuelve 500 genérico y NO el mensaje del motor', async () => {
    const registro = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Se rompe algo que ningún parámetro del usuario controla y que está
    // SIEMPRE en el camino: el rastro EXPORT de la 14.1, que la ruta escribe
    // dentro de la misma transacción («si el rastro no se puede escribir, el
    // archivo no se entrega»). El usuario no puede hacer nada con el detalle
    // interno, y ese detalle le cuenta a un atacante cómo está montado esto.
    await db.asAdmin((tx) =>
      tx.exec(`
        CREATE OR REPLACE FUNCTION app.registrar_exportacion(p_reporte text, p_detalle jsonb DEFAULT '{}'::jsonb)
        RETURNS bigint LANGUAGE plpgsql AS $roto$
        BEGIN
          RAISE EXCEPTION 'relation "audit_log_particion_2026_09" does not exist';
        END $roto$;
      `),
    );
    try {
      const res = await llamar('libro-diario', RANGO, false);
      expect(res.status).toBe(500);
      const cuerpo = (await res.json()) as { motivo: string; detalle: string };
      expect(cuerpo.motivo).toBe('error');
      expect(cuerpo.detalle).toContain('problema técnico');
      expect(cuerpo.detalle).not.toContain('audit_log_particion');
      expect(cuerpo.detalle).not.toContain('relation');
      // Pero el detalle SÍ queda en el registro del servidor.
      expect(registro).toHaveBeenCalled();
    } finally {
      await db.asAdmin((tx) =>
        tx.exec(`
          CREATE OR REPLACE FUNCTION app.registrar_exportacion(p_reporte text, p_detalle jsonb DEFAULT '{}'::jsonb)
          RETURNS bigint
            LANGUAGE plpgsql
            SET search_path = pg_catalog, app, public
            AS $bueno$
          DECLARE
            v_id bigint;
          BEGIN
            IF app.session_id() IS NULL THEN
              RAISE EXCEPTION 'SESION_INVALIDA: no hay sesion que registrar' USING ERRCODE = 'SE001';
            END IF;
            PERFORM app.exigir_permiso('reporte.exportar');
            INSERT INTO audit_log (tenant_id, company_id, user_id, accion, entidad, entidad_id,
                                   valor_nuevo, ip, user_agent, request_id)
            VALUES (app.current_tenant_id(), app.current_company_id(), app.current_user_id(),
                    'EXPORT', 'reporte', p_reporte, COALESCE(p_detalle, '{}'::jsonb),
                    app.current_ip(), NULLIF(current_setting('app.user_agent', true), ''),
                    app.current_request_id())
            RETURNING id INTO v_id;
            RETURN v_id;
          END $bueno$;
        `),
      );
      registro.mockRestore();
    }
  });
});

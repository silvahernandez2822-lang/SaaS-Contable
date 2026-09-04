/**
 * A14 — COMPUERTA AMPLIADA DE D-088 · el SIMULADOR DE IMPACTO de la pantalla
 * `/parametros/ica-municipios` es el bloqueante REAL de D-087, no una copia
 * decorativa del patrón.
 *
 * V-39 (D-087) nació de descubrir que el «flujo de dos pasos» no comprobaba
 * nada: un POST directo al paso 2 abría la vigencia igual. La pantalla de ICA
 * de D-088 reutiliza ese flujo, así que hay que volver a medirlo AQUÍ, en sus
 * dos acciones de confirmación, y comprobar además que el simulador se dispara
 * ante todo lo que D-088 hace editable: la tarifa, el flag `gravada` y los tres
 * parámetros de la base mínima (compras, servicios y el tipo de medición con su
 * ventana).
 *
 * Se cuentan FILAS antes y después. Si el paso 2 escribe sin testigo, hay una
 * vigencia nueva y la prueba lo dice.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDb, uuid, type TestDb } from '../helpers/db';
import { crearEscenario, type Escenario } from '../helpers/fixtures';
import type { DbHandle } from '../../src/db/types';

const cookieState = new Map<string, string>();
const redirecciones: string[] = [];

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nombre: string) => {
      const value = cookieState.get(nombre);
      return value === undefined ? undefined : { name: nombre, value };
    },
  }),
  headers: async () => new Map<string, string>([['x-forwarded-for', '198.51.100.9']]),
}));

vi.mock('next/navigation', () => ({
  redirect: (destino: string) => {
    redirecciones.push(destino);
  },
}));

let db: TestDb;

vi.mock('../../app/lib/db.js', () => ({
  obtenerDb: async (): Promise<DbHandle> => db.client,
}));

const acciones = await import('../../app/parametros/ica-municipios/acciones');

function ultima(): string {
  return redirecciones[redirecciones.length - 1] ?? '';
}

function paramsDe(destino: string): URLSearchParams {
  return new URLSearchParams(destino.includes('?') ? destino.slice(destino.indexOf('?') + 1) : '');
}

let e: Escenario;
let municipioId: string;
let taxConceptId: string;
const DANE = '05002';
const CIIU = '0161';

beforeAll(async () => {
  db = await createTestDb();
  e = await crearEscenario(db);
  await db.asAdmin(async (tx) => {
    municipioId = uuid();
    taxConceptId = uuid();
    await tx.query(
      `INSERT INTO municipality (id, tenant_id, codigo_dane, nombre, departamento, codigo_dane_departamento)
       VALUES ($1, NULL, $2, 'Municipio del flujo bloqueante', 'Antioquia', '05')`,
      [municipioId, DANE],
    );
    await tx.query(
      `INSERT INTO ciiu_activity (id, tenant_id, codigo, nombre) VALUES ($1, NULL, $2, 'Actividad de prueba')
       ON CONFLICT DO NOTHING`,
      [uuid(), CIIU],
    );
    await tx.query(
      `INSERT INTO tax_concept (id, tenant_id, company_id, tipo, codigo, nombre)
       VALUES ($1, NULL, NULL, 'reteica', 'reteica_tarifa_general_municipio', 'ReteICA municipio')
       ON CONFLICT DO NOTHING`,
      [taxConceptId],
    );
  });
  const { token } = await db.emitirSesion(e.tenantId, e.companyId, {
    rolCodigo: 'admin_tributario',
    sesionNueva: true,
  });
  cookieState.set('session_token', token);
  cookieState.set('company_id', e.companyId);
}, 300_000);

afterAll(async () => {
  await db.close();
});

async function reglasDelMunicipio(): Promise<number> {
  const { rows } = await db.asAdmin((tx) =>
    tx.query<{ n: string }>(
      'SELECT count(*)::int AS n FROM municipality_ica_rule WHERE municipality_id = $1',
      [municipioId],
    ),
  );
  return Number(rows[0]!.n);
}

async function tarifasDelMunicipio(): Promise<number> {
  const { rows } = await db.asAdmin((tx) =>
    tx.query<{ n: string }>(
      "SELECT count(*)::int AS n FROM tax_rule WHERE tipo = 'reteica' AND municipality_id = $1",
      [municipioId],
    ),
  );
  return Number(rows[0]!.n);
}

/** Campos de la regla del municipio. Los tres parámetros de la base mínima. */
function formularioBase(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set('municipalityId', municipioId);
  fd.set('reglaAnteriorId', '');
  fd.set('practicaReteica', 'true');
  fd.set('baseMinimaComprasUvt', '15');
  fd.set('baseMinimaServiciosUvt', '4');
  fd.set('tipoMedicionBaseMinima', 'por_factura');
  fd.set('periodoMeses', '');
  fd.set('periodicidad', 'mensual');
  fd.set('usaTarifaDeActividad', 'true');
  fd.set('vigenteDesde', '2027-01-01');
  fd.set('normaRespaldo', 'Acuerdo inventado por A14 para medir el bloqueo');
  fd.set('alcanceNuevo', 'firma');
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
  return fd;
}

function formularioActividad(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set('municipalityId', municipioId);
  fd.set('taxConceptId', taxConceptId);
  fd.set('reglaAnteriorId', '');
  fd.set('municipioDane', DANE);
  fd.set('ciiuCodigo', CIIU);
  fd.set('gravada', 'true');
  fd.set('tarifaPorMil', '9.66');
  fd.set('vigenteDesde', '2027-01-01');
  fd.set('normaRespaldo', 'Acuerdo inventado por A14 para medir el bloqueo');
  fd.set('alcanceNuevo', 'firma');
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
  return fd;
}

/** Ejecuta paso 1 y devuelve el formulario del paso 2 con el testigo dentro. */
async function conTestigo(
  simular: (fd: FormData) => Promise<void>,
  fd: FormData,
): Promise<FormData> {
  await simular(fd);
  const sp = paramsDe(ultima());
  expect(sp.get('error'), `el paso 1 devolvió error: ${sp.get('error')}`).toBeNull();
  const salida = new FormData();
  for (const [k, v] of sp.entries()) salida.set(k, v);
  return salida;
}

// =============================================================================
describe('A14 · D-088 · el paso 2 sin el testigo del paso 1 no escribe NADA', () => {
  it('POST directo a confirmarBaseAction no abre vigencia de la regla del municipio', async () => {
    const antes = await reglasDelMunicipio();
    await acciones.confirmarBaseAction(formularioBase());
    expect(await reglasDelMunicipio(), 'el paso 2 de la regla del municipio escribió sin simular').toBe(
      antes,
    );
    expect(paramsDe(ultima()).get('ok')).toBeNull();
    expect(paramsDe(ultima()).get('error')).toBeTruthy();
  }, 120_000);

  it('POST directo a confirmarActividadAction no abre vigencia de la tarifa', async () => {
    const antes = await tarifasDelMunicipio();
    await acciones.confirmarActividadAction(formularioActividad());
    expect(await tarifasDelMunicipio(), 'el paso 2 de la tarifa escribió sin simular').toBe(antes);
    expect(paramsDe(ultima()).get('ok')).toBeNull();
    expect(paramsDe(ultima()).get('error')).toBeTruthy();
  }, 120_000);

  it('un testigo FALSEADO tampoco pasa: el paso 2 lo revalida contra el impacto real', async () => {
    const antes = await reglasDelMunicipio();
    const fd = formularioBase();
    fd.set('conceptos', '999');
    fd.set('proveedores', '999');
    await acciones.confirmarBaseAction(fd);
    expect(await reglasDelMunicipio(), 'un testigo inventado abrió vigencia').toBe(antes);
    expect(paramsDe(ultima()).get('error')).toBeTruthy();
  }, 120_000);
});

// =============================================================================
describe('A14 · D-088 · el flujo completo SÍ escribe, y el simulador se dispara ante todo lo editable', () => {
  it('los tres parámetros de la base mínima (compras, servicios y tipo de medición con ventana)', async () => {
    // 1) Bases mínimas de compras y servicios.
    const antes = await reglasDelMunicipio();
    await acciones.confirmarBaseAction(
      await conTestigo(acciones.simularBaseAction, formularioBase()),
    );
    expect(paramsDe(ultima()).get('error')).toBeNull();
    expect(await reglasDelMunicipio()).toBe(antes + 1);

    // 2) Cambiar el TIPO DE MEDICIÓN a «por periodo» con su ventana: pasa por
    //    el mismo flujo de dos pasos y abre vigencia nueva, no hace UPDATE.
    const anteriorId = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `SELECT id FROM municipality_ica_rule
          WHERE municipality_id = $1 AND vigente_hasta IS NULL ORDER BY vigente_desde DESC LIMIT 1`,
        [municipioId],
      );
      return rows[0]!.id;
    });
    const fdPeriodo = formularioBase({
      reglaAnteriorId: anteriorId,
      tipoMedicionBaseMinima: 'por_periodo',
      periodoMeses: '2',
      vigenteDesde: '2027-06-01',
    });
    await acciones.confirmarBaseAction(await conTestigo(acciones.simularBaseAction, fdPeriodo));
    expect(paramsDe(ultima()).get('error')).toBeNull();

    const regla = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ tipo: string; meses: number | null; desde: string }>(
        `SELECT tipo_medicion_base_minima AS tipo, periodo_meses AS meses, vigente_desde::text AS desde
           FROM municipality_ica_rule WHERE municipality_id = $1 AND vigente_hasta IS NULL`,
        [municipioId],
      );
      return rows[0]!;
    });
    expect(regla).toEqual({ tipo: 'por_periodo', meses: 2, desde: '2027-06-01' });
    // Y la vigencia anterior quedó CERRADA, no reescrita (Regla de Oro 3).
    const anterior = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ tipo: string; hasta: string | null }>(
        `SELECT tipo_medicion_base_minima AS tipo, vigente_hasta::text AS hasta
           FROM municipality_ica_rule WHERE id = $1`,
        [anteriorId],
      );
      return rows[0]!;
    });
    expect(anterior).toEqual({ tipo: 'por_factura', hasta: '2027-05-31' });
  }, 180_000);

  it('la TARIFA por actividad y el flag GRAVADA disparan el mismo bloqueo y se guardan bien', async () => {
    const antes = await tarifasDelMunicipio();
    await acciones.confirmarActividadAction(
      await conTestigo(acciones.simularActividadAction, formularioActividad()),
    );
    expect(paramsDe(ultima()).get('error')).toBeNull();
    expect(await tarifasDelMunicipio()).toBe(antes + 1);

    const creada = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ id: string; tarifa: string; gravada: boolean | null }>(
        `SELECT id, tarifa::text AS tarifa, gravada FROM tax_rule
          WHERE tipo = 'reteica' AND municipality_id = $1 AND vigente_hasta IS NULL`,
        [municipioId],
      );
      return rows[0]!;
    });
    // 9,66 «por mil» → fracción. La suite no fija la tarifa: comprueba la
    // conversión que hace la pantalla con el número que el contador escribió.
    expect(creada.tarifa).toBe((9.66 / 1000).toFixed(6));
    expect(creada.gravada).toBe(true);

    // Ahora se marca NO GRAVADA por el mismo flujo: la tarifa tiene que caer a
    // cero sola (el CHECK lo exige) y el flag quedar en false, en una VIGENCIA
    // NUEVA. Un POST directo con esos mismos campos sigue sin escribir.
    const desmarcar = () =>
      formularioActividad({
        reglaAnteriorId: creada.id,
        gravada: 'false',
        tarifaPorMil: '9.66',
        vigenteDesde: '2027-09-01',
      });
    const antesDeDesmarcar = await tarifasDelMunicipio();
    await acciones.confirmarActividadAction(desmarcar());
    expect(await tarifasDelMunicipio(), 'desmarcar «gravada» se coló sin simulación').toBe(
      antesDeDesmarcar,
    );

    await acciones.confirmarActividadAction(
      await conTestigo(acciones.simularActividadAction, desmarcar()),
    );
    expect(paramsDe(ultima()).get('error')).toBeNull();
    const nueva = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ tarifa: string; gravada: boolean | null }>(
        `SELECT tarifa::text AS tarifa, gravada FROM tax_rule
          WHERE tipo = 'reteica' AND municipality_id = $1 AND vigente_hasta IS NULL`,
        [municipioId],
      );
      return rows[0]!;
    });
    // La pantalla fuerza la tarifa a cero aunque el formulario traiga 9,66: es
    // el guard de gravada/tarifa, no una tarifa que el sistema se invente.
    expect(Number(nueva.tarifa)).toBe(0);
    expect(nueva.gravada).toBe(false);
  }, 180_000);
});

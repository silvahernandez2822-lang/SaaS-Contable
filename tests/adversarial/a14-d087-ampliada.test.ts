/**
 * A14 — COMPUERTA AMPLIADA DE D-087 (Módulo de Parámetros tributarios, Fase 4).
 *
 * Nada aquí se acepta por reporte de A8 ni de A12. Suite propia, aserciones
 * propias. Lo que se ataca, en este orden:
 *
 *  1. EL SIMULADOR CUENTA CONTRA DATOS REALES. Se monta una firma con varios
 *     conceptos de causación (apuntando al mismo `tax_concept` por columnas
 *     DISTINTAS), varias empresas, varios terceros con historial y asientos
 *     publicados, más RUIDO deliberado (conceptos que no apuntan, retenciones
 *     de otro municipio, filas con `third_party_id` NULL, retenciones de otra
 *     firma). Se compara el CONTEO de `app.simular_impacto_*` (080) contra el
 *     DETALLE de `app.detalle_impacto_*` (176) fila a fila. Si el simulador
 *     dice 3 y el detalle lista 2, es defecto bloqueante.
 *
 *  2. AISLAMIENTO. Nada del simulador ni del detalle cruza firmas, y el
 *     detalle no es oráculo de existencia (id ajeno REAL vs. id inventado →
 *     misma respuesta).
 *
 *  3. UN SOLO MODAL EN EL REPO. `Modal` de `app/_ui/componentes.tsx` es el
 *     único con markup propio `role="dialog"` en el árbol de producto; los
 *     badges de `/parametros`, el detalle de impacto y la dirección DIAN de
 *     D-086 lo consumen, no lo reimplementan.
 *
 *  4. EL CANDADO DEL MOTOR NO SE RELAJA (migración 176). El sub-permiso
 *     restringe, nunca habilita.
 *
 *  5. EL FLUJO DE DOS PASOS ES REALMENTE BLOQUEANTE. Un POST directo al paso 2
 *     saltándose el paso 1 no puede abrir una vigencia nueva: el contador
 *     nunca vio el impacto.
 *
 *  6. MIGRACIÓN VISUAL REAL de `/parametros` (barrido de archivos).
 *
 *  7. REGLA DE ORO 2 sobre todo lo que tocó D-087.
 *
 *  8. REGLA DE ORO 1/3: nada de D-087 abre un camino de `UPDATE`/`DELETE`
 *     sobre lo publicado ni sobre una vigencia cerrada.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDb, esperarErrorPg, uuid, type TestDb } from '../helpers/db';
import {
  crearAsientoBorrador,
  crearEscenario,
  publicarAsiento,
  type Escenario,
} from '../helpers/fixtures';
import { isPostgresError, SQLSTATE, type DbHandle } from '../../src/db/types';
import { PERMISOS } from '../../src/auth/permisos';
import {
  detalleImpactoMunicipioIca,
  detalleImpactoTarifa,
  detalleImpactoValorBase,
  puedeEditarParametros,
  simularImpactoMunicipioIca,
  simularImpactoTarifa,
  simularImpactoValorBase,
  type DetalleImpacto,
  type ImpactoSimulado,
} from '../../src/services/parametrizacion';

const RAIZ = fileURLToPath(new URL('../..', import.meta.url));

// -----------------------------------------------------------------------------
// Transporte de Next.js simulado — solo para el bloque 5 (acciones de servidor)
// -----------------------------------------------------------------------------
const cookieState = new Map<string, string>();
const redirecciones: string[] = [];

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nombre: string) => {
      const value = cookieState.get(nombre);
      return value === undefined ? undefined : { name: nombre, value };
    },
  }),
  headers: async () => new Map<string, string>([['x-forwarded-for', '198.51.100.7']]),
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

const accionesValoresBase = await import('../../app/parametros/valores-base/acciones');
const accionesTarifas = await import('../../app/parametros/tarifas/[tipo]/acciones');
const accionesReteica = await import('../../app/parametros/reteica-municipios/acciones');

function ultimaRedireccion(): string {
  return redirecciones[redirecciones.length - 1] ?? '';
}

function paramsDe(destino: string): URLSearchParams {
  return new URLSearchParams(destino.includes('?') ? destino.slice(destino.indexOf('?') + 1) : '');
}

async function ponerSesion(
  tenantId: string,
  companyId: string,
  extra: { rolCodigo?: string; rolId?: string } = {},
): Promise<void> {
  const { token } = await db.emitirSesion(tenantId, companyId, { ...extra, sesionNueva: true });
  cookieState.set('session_token', token);
  cookieState.set('company_id', companyId);
}

// -----------------------------------------------------------------------------
// Escenario REAL del simulador
// -----------------------------------------------------------------------------
interface Mundo {
  e: Escenario;
  /** Empresa hermana de la MISMA firma (el impacto es de firma, no de empresa). */
  companyHermanaId: string;
  taxConceptObjetivo: string;
  taxConceptRuido: string;
  reglaObjetivoId: string;
  reglaRuidoId: string;
  /** Conceptos de causación que SÍ apuntan al tax_concept objetivo. */
  conceptosAfectados: Array<{ id: string; codigo: string }>;
  /** Concepto que NO apunta (ruido). */
  conceptoRuidoId: string;
  /** Terceros con historial contra los conceptos afectados. */
  terceros: Array<{ id: string; codigo: string }>;
  terceroRuidoId: string;
  municipioObjetivoId: string;
  municipioRuidoId: string;
  /** Terceros con historial de ReteICA en el municipio objetivo. */
  tercerosIca: string[];
}

let A: Mundo;
let B: Mundo;

async function crearTaxConcepto(tenantId: string, companyId: string, cuentaId: string) {
  return db.asAdmin(async (tx) => {
    const { rows: c } = await tx.query<{ id: string }>(
      `INSERT INTO tax_concept (tenant_id, company_id, tipo, codigo, nombre)
       VALUES (NULL, NULL, 'retefuente', $1, 'Concepto de prueba A14/D-087 (no es dato normativo)')
       RETURNING id`,
      [`a14_d087_${uuid()}`],
    );
    const taxConceptId = c[0]!.id;
    const { rows: r } = await tx.query<{ id: string }>(
      `INSERT INTO tax_rule (
         tenant_id, company_id, tax_concept_id, tipo, tarifa, base_minima_uvt,
         aplica_sobre, aplica_a, tipo_persona, account_id, vigente_desde, norma_respaldo
       ) VALUES ($1,$2,$3,'retefuente',0.030000,3,'base_gravable','ambos','ambos',$4,'2026-01-01',
                 'Norma inventada del escenario de A14 (mecánica, no normativa)')
       RETURNING id`,
      [tenantId, companyId, taxConceptId, cuentaId],
    );
    return { taxConceptId, reglaId: r[0]!.id };
  });
}

/** Concepto de causación de la FIRMA (company_id NULL) que apunta al
 *  `tax_concept` por la columna indicada. */
async function crearConceptoCausacion(
  tenantId: string,
  companyId: string | null,
  columna:
    | 'tax_concept_retefuente_id'
    | 'tax_concept_reteiva_id'
    | 'tax_concept_reteica_id'
    | 'tax_concept_autorretencion_id',
  taxConceptId: string,
): Promise<{ id: string; codigo: string }> {
  const codigo = `cc_a14_${uuid().slice(0, 8)}`;
  const id = await db.asAdmin(async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO concepto_causacion (
         tenant_id, company_id, codigo, nombre, aplica_retefuente, ${columna}
       ) VALUES ($1,$2,$3,$4,false,$5) RETURNING id`,
      [tenantId, companyId, codigo, `Concepto A14 ${codigo}`, taxConceptId],
    );
    return rows[0]!.id;
  });
  return { id, codigo };
}

async function crearTercero(
  e: Escenario,
  companyId: string,
  etiqueta: string,
): Promise<{ id: string; codigo: string }> {
  const numero = `9${Math.floor(Math.random() * 1_000_000_000)}`;
  const id = await db.asAdmin(async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO third_party (id, tenant_id, company_id, numero_documento, tipo_persona,
                                razon_social, municipality_id, codigo_dane)
       VALUES ($1,$2,$3,$4,'juridica',$5,$6,'11001') RETURNING id`,
      [uuid(), e.tenantId, companyId, numero, etiqueta, e.municipalityId],
    );
    return rows[0]!.id;
  });
  return { id, codigo: `NIT ${numero}` };
}

/** Publica un asiento y le cuelga una `retention_applied` REAL. */
async function publicarConRetencion(
  e: Escenario,
  opciones: {
    reglaId: string;
    conceptoCausacionId: string | null;
    thirdPartyId: string | null;
    tipo?: 'retefuente' | 'reteica';
    municipalityId?: string | null;
  },
): Promise<void> {
  await db.asAdmin(async (tx) => {
    const entryId = await crearAsientoBorrador(tx, e, [
      { accountId: e.cuentas.gasto, side: 'debito', monto: 100000 },
      { accountId: e.cuentas.proveedores, side: 'credito', monto: 100000 },
    ]);
    await publicarAsiento(tx, entryId, e.userId);
    await tx.query(
      `INSERT INTO retention_applied (
         tenant_id, company_id, source_document_id, journal_entry_id, concepto_causacion_id,
         third_party_id, tipo, base, tarifa, valor, tax_rule_id, regla_vigente_desde,
         norma_respaldo, account_id, municipality_id, fecha_hecho_economico, aplicada
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,100000,0.030000,3000,$8,'2026-01-01',
                 'Norma inventada del escenario de A14', $9, $10, '2026-06-15', true)`,
      [
        e.tenantId,
        e.companyId,
        e.sourceDocumentId,
        entryId,
        opciones.conceptoCausacionId,
        opciones.thirdPartyId,
        opciones.tipo ?? 'retefuente',
        opciones.reglaId,
        e.cuentas.retefuentePorPagar,
        opciones.municipalityId ?? null,
      ],
    );
  });
}

async function montarMundo(etiqueta: string): Promise<Mundo> {
  const e = await crearEscenario(db, { razonSocial: `Firma ${etiqueta} (D-087 / A14)` });

  const companyHermanaId = await db.asAdmin(async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO company (tenant_id, nit, razon_social, municipality_id, ciiu_principal_id,
                            es_agente_retencion_renta, buzon_email)
       VALUES ($1,$2,$3,$4,$5,true,$6) RETURNING id`,
      [
        e.tenantId,
        `81${Math.floor(Math.random() * 100_000_000)}`,
        `Empresa hermana ${etiqueta}`,
        e.municipalityId,
        e.ciiuId,
        `hermana-${uuid()}@inbox.ejemplo.co`,
      ],
    );
    return rows[0]!.id;
  });

  const objetivo = await crearTaxConcepto(e.tenantId, e.companyId, e.cuentas.retefuentePorPagar);
  const ruido = await crearTaxConcepto(e.tenantId, e.companyId, e.cuentas.retefuentePorPagar);

  // Tres conceptos apuntando al MISMO tax_concept por columnas distintas, en
  // alcances distintos (firma y empresa): el simulador debe verlos todos.
  const cc1 = await crearConceptoCausacion(e.tenantId, null, 'tax_concept_retefuente_id', objetivo.taxConceptId);
  const cc2 = await crearConceptoCausacion(e.tenantId, null, 'tax_concept_reteica_id', objetivo.taxConceptId);
  const cc3 = await crearConceptoCausacion(e.tenantId, e.companyId, 'tax_concept_autorretencion_id', objetivo.taxConceptId);
  const ccRuido = await crearConceptoCausacion(e.tenantId, null, 'tax_concept_retefuente_id', ruido.taxConceptId);

  const t1 = await crearTercero(e, e.companyId, `Proveedor uno ${etiqueta}`);
  const t2 = await crearTercero(e, e.companyId, `Proveedor dos ${etiqueta}`);
  const tRuido = await crearTercero(e, e.companyId, `Proveedor ruido ${etiqueta}`);

  const municipioRuidoId = await db.asAdmin(async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO municipality (tenant_id, codigo_dane, nombre, departamento, codigo_dane_departamento)
       VALUES ($1,$2,'Municipio ruido A14','Departamento de prueba','11') RETURNING id`,
      [e.tenantId, `9${Math.floor(Math.random() * 10000)}`.padStart(5, '0')],
    );
    return rows[0]!.id;
  });

  // Historial REAL contra los conceptos afectados: dos filas del mismo tercero
  // (DISTINCT), un tercero más, y una fila con third_party_id NULL.
  await publicarConRetencion(e, { reglaId: objetivo.reglaId, conceptoCausacionId: cc1.id, thirdPartyId: t1.id });
  await publicarConRetencion(e, { reglaId: objetivo.reglaId, conceptoCausacionId: cc1.id, thirdPartyId: t1.id });
  await publicarConRetencion(e, { reglaId: objetivo.reglaId, conceptoCausacionId: cc2.id, thirdPartyId: t2.id });
  await publicarConRetencion(e, { reglaId: objetivo.reglaId, conceptoCausacionId: cc3.id, thirdPartyId: null });
  // Ruido: concepto que no apunta al objetivo.
  await publicarConRetencion(e, { reglaId: ruido.reglaId, conceptoCausacionId: ccRuido.id, thirdPartyId: tRuido.id });

  // ReteICA: dos terceros en el municipio objetivo, uno en el municipio ruido,
  // y una retención NO-reteica en el municipio objetivo (ruido).
  await publicarConRetencion(e, {
    reglaId: objetivo.reglaId, conceptoCausacionId: cc1.id, thirdPartyId: t1.id,
    tipo: 'reteica', municipalityId: e.municipalityId,
  });
  await publicarConRetencion(e, {
    reglaId: objetivo.reglaId, conceptoCausacionId: cc2.id, thirdPartyId: t2.id,
    tipo: 'reteica', municipalityId: e.municipalityId,
  });
  await publicarConRetencion(e, {
    reglaId: ruido.reglaId, conceptoCausacionId: ccRuido.id, thirdPartyId: tRuido.id,
    tipo: 'reteica', municipalityId: municipioRuidoId,
  });
  await publicarConRetencion(e, {
    reglaId: objetivo.reglaId, conceptoCausacionId: ccRuido.id, thirdPartyId: tRuido.id,
    tipo: 'retefuente', municipalityId: e.municipalityId,
  });

  return {
    e,
    companyHermanaId,
    taxConceptObjetivo: objetivo.taxConceptId,
    taxConceptRuido: ruido.taxConceptId,
    reglaObjetivoId: objetivo.reglaId,
    reglaRuidoId: ruido.reglaId,
    conceptosAfectados: [cc1, cc2, cc3],
    conceptoRuidoId: ccRuido.id,
    terceros: [t1, t2],
    terceroRuidoId: tRuido.id,
    municipioObjetivoId: e.municipalityId,
    municipioRuidoId,
    tercerosIca: [t1.id, t2.id],
  };
}

beforeAll(async () => {
  db = await createTestDb();
  A = await montarMundo('A');
  B = await montarMundo('B');
}, 240_000);

afterAll(async () => {
  await db?.close();
});

async function medir<T>(
  m: Mundo,
  fn: (tx: Parameters<Parameters<TestDb['asTenant']>[2]>[0]) => Promise<T>,
  rolCodigo?: string,
): Promise<T> {
  return db.asTenant(m.e.tenantId, m.e.companyId, fn, rolCodigo ? { rolCodigo } : {});
}

function codigosDe(d: DetalleImpacto): { conceptos: string[]; proveedores: string[] } {
  return {
    conceptos: d.conceptos.map((c) => c.codigo).sort(),
    proveedores: d.proveedores.map((p) => p.codigo).sort(),
  };
}

// =============================================================================
// 1. EL SIMULADOR CUENTA CONTRA DATOS REALES: conteo (080) == detalle (176)
// =============================================================================
describe('A14 · D-087 (1) — conteo y detalle del simulador coinciden fila a fila', () => {
  it('tarifa: el detalle lista EXACTAMENTE los conceptos que el conteo cuenta, en las tres columnas', async () => {
    const { impacto, detalle } = await medir(A, async (tx) => ({
      impacto: await simularImpactoTarifa(tx, A.taxConceptObjetivo),
      detalle: await detalleImpactoTarifa(tx, A.taxConceptObjetivo),
    }));

    expect(impacto.conceptosAfectados).toBe(3);
    expect(detalle.conceptos).toHaveLength(impacto.conceptosAfectados);
    expect(codigosDe(detalle).conceptos).toEqual(
      A.conceptosAfectados.map((c) => c.codigo).sort(),
    );
    // El de ruido no está.
    expect(codigosDe(detalle).conceptos).not.toContain(A.conceptoRuidoId);
  });

  it('tarifa: el detalle lista EXACTAMENTE los proveedores que el conteo cuenta (DISTINCT, sin NULL, sin ruido)', async () => {
    const { impacto, detalle } = await medir(A, async (tx) => ({
      impacto: await simularImpactoTarifa(tx, A.taxConceptObjetivo),
      detalle: await detalleImpactoTarifa(tx, A.taxConceptObjetivo),
    }));

    expect(impacto.proveedoresAfectados).toBe(2);
    expect(detalle.proveedores).toHaveLength(impacto.proveedoresAfectados);
    expect(codigosDe(detalle).proveedores).toEqual(A.terceros.map((t) => t.codigo).sort());
  });

  it('tarifa sin impacto: conteo 0/0 y detalle vacío (no un detalle que liste de más)', async () => {
    const huerfano = await crearTaxConcepto(A.e.tenantId, A.e.companyId, A.e.cuentas.retefuentePorPagar);
    const { impacto, detalle } = await medir(A, async (tx) => ({
      impacto: await simularImpactoTarifa(tx, huerfano.taxConceptId),
      detalle: await detalleImpactoTarifa(tx, huerfano.taxConceptId),
    }));
    expect(impacto).toEqual({ conceptosAfectados: 0, proveedoresAfectados: 0 });
    expect(detalle.conceptos).toHaveLength(0);
    expect(detalle.proveedores).toHaveLength(0);
  });

  it('ReteICA por municipio: conteo == detalle, con el municipio ruido y el tipo ruido fuera', async () => {
    const { impacto, detalle } = await medir(A, async (tx) => ({
      impacto: await simularImpactoMunicipioIca(tx, A.municipioObjetivoId),
      detalle: await detalleImpactoMunicipioIca(tx, A.municipioObjetivoId),
    }));

    expect(detalle.conceptos).toHaveLength(impacto.conceptosAfectados);
    expect(detalle.proveedores).toHaveLength(impacto.proveedoresAfectados);
    expect(impacto.proveedoresAfectados).toBe(2);
    expect(codigosDe(detalle).proveedores).toEqual(A.terceros.map((t) => t.codigo).sort());
  });

  it('valor base (UVT/SMMLV/redondeo): conteo == detalle sobre TODA la firma', async () => {
    const { impacto, detalle } = await medir(A, async (tx) => ({
      impacto: await simularImpactoValorBase(tx),
      detalle: await detalleImpactoValorBase(tx),
    }));
    expect(detalle.conceptos).toHaveLength(impacto.conceptosAfectados);
    expect(detalle.proveedores).toHaveLength(impacto.proveedoresAfectados);
    // Los conceptos de la firma incluyen los tres afectados + el de ruido.
    expect(impacto.conceptosAfectados).toBeGreaterThanOrEqual(4);
  });

  it('el conteo y el detalle siguen coincidiendo tras AÑADIR un concepto y un tercero (no hay caché ni número congelado)', async () => {
    const nuevo = await crearConceptoCausacion(
      A.e.tenantId, null, 'tax_concept_reteiva_id', A.taxConceptObjetivo,
    );
    const nuevoTercero = await crearTercero(A.e, A.e.companyId, 'Proveedor sobrevenido A14');
    await publicarConRetencion(A.e, {
      reglaId: A.reglaObjetivoId, conceptoCausacionId: nuevo.id, thirdPartyId: nuevoTercero.id,
    });

    const { impacto, detalle } = await medir(A, async (tx) => ({
      impacto: await simularImpactoTarifa(tx, A.taxConceptObjetivo),
      detalle: await detalleImpactoTarifa(tx, A.taxConceptObjetivo),
    }));
    expect(impacto.conceptosAfectados).toBe(4);
    expect(detalle.conceptos).toHaveLength(4);
    expect(impacto.proveedoresAfectados).toBe(3);
    expect(detalle.proveedores).toHaveLength(3);
    A.conceptosAfectados.push(nuevo);
    A.terceros.push(nuevoTercero);
  });

  it('el impacto se agrega por FIRMA, no por la empresa en sesión (parámetro compartido, D-015)', async () => {
    // La misma medición desde una sesión SIN empresa en contexto da lo mismo.
    const conEmpresa = await medir(A, (tx) => simularImpactoTarifa(tx, A.taxConceptObjetivo));
    const sinEmpresa = await db.asTenant(A.e.tenantId, null, (tx) =>
      simularImpactoTarifa(tx, A.taxConceptObjetivo),
    );
    expect(sinEmpresa).toEqual(conEmpresa);

    const detalleSinEmpresa = await db.asTenant(A.e.tenantId, null, (tx) =>
      detalleImpactoTarifa(tx, A.taxConceptObjetivo),
    );
    expect(detalleSinEmpresa.conceptos).toHaveLength(conEmpresa.conceptosAfectados);
  });
});

// =============================================================================
// 2. AISLAMIENTO (Regla de Oro 7)
// =============================================================================
describe('A14 · D-087 (2) — el simulador y el detalle no cruzan firmas', () => {
  it('la firma A no ve ni un concepto ni un proveedor de la firma B en su detalle', async () => {
    const detalleA = await medir(A, (tx) => detalleImpactoValorBase(tx));
    const codigosB = B.conceptosAfectados.map((c) => c.codigo).concat(B.terceros.map((t) => t.codigo));
    const todosA = detalleA.conceptos.map((c) => c.codigo).concat(detalleA.proveedores.map((p) => p.codigo));
    for (const cb of codigosB) expect(todosA).not.toContain(cb);
  });

  it('simular con el tax_concept REAL de la otra firma devuelve 0/0 y detalle vacío', async () => {
    const { impacto, detalle } = await medir(A, async (tx) => ({
      impacto: await simularImpactoTarifa(tx, B.taxConceptObjetivo),
      detalle: await detalleImpactoTarifa(tx, B.taxConceptObjetivo),
    }));
    expect(impacto).toEqual({ conceptosAfectados: 0, proveedoresAfectados: 0 });
    expect(detalle.conceptos).toHaveLength(0);
    expect(detalle.proveedores).toHaveLength(0);
  });

  it('el detalle NO es oráculo de existencia: id ajeno REAL e id inventado dan la misma respuesta', async () => {
    const inventado = uuid();
    const [ajeno, fantasma] = await medir(A, async (tx) => [
      await detalleImpactoTarifa(tx, B.taxConceptObjetivo),
      await detalleImpactoTarifa(tx, inventado),
    ]);
    expect(ajeno).toEqual(fantasma);

    const [ajenoIca, fantasmaIca] = await medir(A, async (tx) => [
      await detalleImpactoMunicipioIca(tx, B.municipioObjetivoId),
      await detalleImpactoMunicipioIca(tx, uuid()),
    ]);
    expect(ajenoIca).toEqual(fantasmaIca);
  });

  it('el detalle de valor base de la firma A no deja caer NADA de la firma B pese a row_security=off', async () => {
    const detalleA = await medir(A, (tx) => detalleImpactoValorBase(tx));
    const detalleB = await medir(B, (tx) => detalleImpactoValorBase(tx));
    const setB = new Set(detalleB.proveedores.map((p) => p.codigo));
    for (const p of detalleA.proveedores) expect(setB.has(p.codigo)).toBe(false);
  });

  it('las tres funciones de detalle exigen sesión: sin tenant no responden', async () => {
    await esperarErrorPg(
      () => db.client.query('SELECT * FROM app.detalle_impacto_valor_base()'),
      SQLSTATE.PERMISO_INSUFICIENTE,
      'detalle_impacto_valor_base sin sesión',
    ).catch(async () => {
      // Sin sesión el primer guardia que salta puede ser el de permiso o el de
      // sesión: cualquiera de los dos es aceptable, lo inaceptable es que responda.
      const r = await db.client
        .query('SELECT * FROM app.detalle_impacto_valor_base()')
        .then(() => 'RESPONDIO')
        .catch((err: unknown) => (isPostgresError(err) ? err.code : 'error'));
      expect(r).not.toBe('RESPONDIO');
    });
  });
});

// =============================================================================
// 3. UN SOLO MODAL EN EL REPO (consistencia con D-086)
// =============================================================================
function archivosTsx(dir: string, saltar: string[] = []): string[] {
  const salida: string[] = [];
  const recorrer = (d: string) => {
    for (const entrada of readdirSync(d)) {
      const completo = path.join(d, entrada);
      const rel = path.relative(RAIZ, completo).replace(/\\/g, '/');
      if (saltar.some((s) => rel.startsWith(s))) continue;
      if (statSync(completo).isDirectory()) {
        if (entrada === 'node_modules' || entrada === '.next' || entrada === '.git') continue;
        recorrer(completo);
      } else if (/\.(tsx|ts)$/.test(entrada)) {
        salida.push(completo);
      }
    }
  };
  recorrer(dir);
  return salida;
}

describe('A14 · D-087 (3) — el modal se reutiliza, no se reinventa', () => {
  it('los tres consumidores importan el Modal del kit y no traen markup de diálogo propio', () => {
    const consumidores = [
      'app/parametros/_componentes.tsx',
      'app/parametros/_detalle-impacto.tsx',
      'app/terceros/_direccion-dian.tsx',
    ];
    for (const rel of consumidores) {
      const src = readFileSync(path.join(RAIZ, rel), 'utf8');
      expect(src, `${rel} debe importar Modal de app/_ui/componentes`).toMatch(
        /import\s*\{[^}]*\bModal\b[^}]*\}\s*from\s*['"][^'"]*_ui\/componentes['"]/,
      );
      expect(src, `${rel} no debe declarar su propio role="dialog"`).not.toMatch(/role=["']dialog["']/);
      expect(src, `${rel} no debe declarar su propio overlay`).not.toMatch(/fixed inset-0/);
    }
  });

  it('en app/ (fuera del prototipo app/diseno) el único diálogo nuevo es el del kit; el de carga masiva queda declarado como deuda', () => {
    const conDialogo = archivosTsx(path.join(RAIZ, 'app'), ['app/diseno'])
      .filter((f) => /role=["']dialog["']/.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(RAIZ, f).replace(/\\/g, '/'))
      .sort();
    // `app/_ui/CargaMasiva.tsx` es ANTERIOR a D-087 y vive en `/carga-masiva`,
    // que sigue en `PREFIJOS_SIN_MIGRAR`: se migrará con ese subárbol, no aquí.
    // La lista se fija para que NINGÚN modal nuevo pueda colarse sin pasar por
    // esta compuerta.
    expect(conDialogo).toEqual(['app/_ui/CargaMasiva.tsx', 'app/_ui/componentes.tsx']);
  });

  it('la deuda del segundo diálogo está acotada: no está en /parametros ni en /terceros', () => {
    for (const dir of ['app/parametros', 'app/terceros']) {
      const conDialogo = archivosTsx(path.join(RAIZ, dir)).filter((f) =>
        /role=["']dialog["']/.test(readFileSync(f, 'utf8')),
      );
      expect(conDialogo).toEqual([]);
    }
  });

  it('el Modal del kit conserva el comportamiento del de D-086 (Escape, clic fuera, foco) y añade foco atrapado', () => {
    const src = readFileSync(path.join(RAIZ, 'app/_ui/componentes.tsx'), 'utf8');
    const modal = src.slice(src.indexOf('export function Modal('));
    expect(modal).toContain("e.key === 'Escape'");
    expect(modal).toContain('onMouseDown');
    expect(modal).toContain('previo?.focus?.()');
    expect(modal).toContain("e.key !== 'Tab'");
    expect(modal).toContain('aria-modal');
  });
});

// =============================================================================
// 4. EL CANDADO DEL MOTOR NO SE RELAJA (migración 176)
// =============================================================================
async function crearRolPropio(
  tenantId: string,
  permisos: readonly string[],
): Promise<string> {
  const roleId = uuid();
  await db.asAdmin(async (tx) => {
    await tx.query(
      `INSERT INTO role (id, tenant_id, codigo, nombre, descripcion, es_sistema)
       VALUES ($1,$2,$3,$3,'Rol de la compuerta ampliada de A14 (D-087)',false)`,
      [roleId, tenantId, `a14_d087_${uuid().slice(0, 8)}`],
    );
    for (const p of permisos) {
      await tx.query('INSERT INTO role_permission (role_id, permission_codigo) VALUES ($1,$2)', [roleId, p]);
    }
  });
  return roleId;
}

const SUBMODULOS = ['tarifas', 'valores_base', 'reteica', 'puc'] as const;

describe('A14 · D-087 (4) — el sub-permiso restringe, nunca habilita', () => {
  it('rol con el FINO y sin el GRUESO: no ve el formulario Y el motor lo rechaza con SE002', async () => {
    const roleId = await crearRolPropio(A.e.tenantId, [
      PERMISOS.PARAMETRO_TARIFAS_EDITAR,
      PERMISOS.PARAMETRO_VALORES_BASE_EDITAR,
      PERMISOS.PARAMETRO_RETEICA_EDITAR,
      PERMISOS.PARAMETRO_PUC_EDITAR,
      PERMISOS.PARAMETRO_LEER,
    ]);

    const vistas = await db.asTenant(
      A.e.tenantId, A.e.companyId,
      async (tx) => {
        const r: Record<string, boolean> = {};
        for (const s of SUBMODULOS) r[s] = await puedeEditarParametros(tx, s);
        return r;
      },
      { rolId: roleId },
    );
    for (const s of SUBMODULOS) expect(vistas[s], `submódulo ${s}`).toBe(false);

    const codigo = await db
      .asTenant(
        A.e.tenantId, A.e.companyId,
        (tx) =>
          tx.query(
            `INSERT INTO tax_rule (tenant_id, company_id, tax_concept_id, tipo, tarifa, aplica_sobre,
                                   aplica_a, tipo_persona, account_id, vigente_desde, norma_respaldo)
             VALUES ($1,$2,$3,'retefuente',0.010000,'base_gravable','ambos','ambos',$4,'2027-01-01','Intento de A14')`,
            [A.e.tenantId, A.e.companyId, A.taxConceptObjetivo, A.e.cuentas.retefuentePorPagar],
          ),
        { rolId: roleId },
      )
      .then(() => 'ESCRIBIO')
      .catch((err: unknown) => (isPostgresError(err) ? err.code : `js:${String(err)}`));
    expect(codigo).toBe(SQLSTATE.PERMISO_INSUFICIENTE);
  });

  it('rol con el GRUESO y sin el FINO: fail-closed (no ve el botón) aunque el motor aceptaría', async () => {
    const roleId = await crearRolPropio(A.e.tenantId, [PERMISOS.PARAMETRO_EDITAR, PERMISOS.PARAMETRO_LEER]);
    const puede = await db.asTenant(
      A.e.tenantId, A.e.companyId,
      (tx) => puedeEditarParametros(tx, 'tarifas'),
      { rolId: roleId },
    );
    expect(puede).toBe(false);
    // …y sin submódulo (camino previo a D-087) sigue siendo true: retrocompatible.
    const grueso = await db.asTenant(
      A.e.tenantId, A.e.companyId,
      (tx) => puedeEditarParametros(tx),
      { rolId: roleId },
    );
    expect(grueso).toBe(true);
  });

  it('los cinco roles del sistema se comportan como antes de 176 (fino ⇔ grueso)', async () => {
    const roles = ['admin_firma', 'admin_tributario', 'contador', 'auxiliar_causacion', 'solo_lectura'];
    const esperado: Record<string, boolean> = {};
    for (const rol of roles) {
      const [grueso, tarifas, puc] = await db.asTenant(
        A.e.tenantId, A.e.companyId,
        async (tx) => [
          await puedeEditarParametros(tx),
          await puedeEditarParametros(tx, 'tarifas'),
          await puedeEditarParametros(tx, 'puc'),
        ],
        { rolCodigo: rol },
      );
      esperado[rol] = grueso;
      expect(tarifas, `${rol}: el fino de tarifas no coincide con el grueso`).toBe(grueso);
      // El PUC va por `puc.editar`, no por `parametro.editar`.
      expect(typeof puc).toBe('boolean');
    }
    expect(esperado['admin_firma']).toBe(true);
    expect(esperado['solo_lectura']).toBe(false);
    expect(esperado['auxiliar_causacion']).toBe(false);
  });

  it('solo_lectura no tiene NINGÚN permiso de acción, tampoco entre los ocho de 176', async () => {
    const { rows } = await db.asAdmin((tx) =>
      tx.query<{ codigo: string }>(
        `SELECT p.codigo FROM role r
           JOIN role_permission rp ON rp.role_id = r.id
           JOIN permission p ON p.codigo = rp.permission_codigo
          WHERE r.codigo = 'solo_lectura' AND r.tenant_id IS NULL AND p.accion_tipo <> 'ver'`,
      ),
    );
    expect(rows.map((r) => r.codigo)).toEqual([]);
  });

  it('las tres funciones de detalle exigen el permiso GRUESO del motor, no el fino', async () => {
    const roleId = await crearRolPropio(A.e.tenantId, [
      PERMISOS.PARAMETRO_TARIFAS_EDITAR, PERMISOS.PARAMETRO_LEER,
    ]);
    for (const [nombre, fn] of [
      ['tarifa', (tx: never) => detalleImpactoTarifa(tx, A.taxConceptObjetivo)],
      ['municipio', (tx: never) => detalleImpactoMunicipioIca(tx, A.municipioObjetivoId)],
      ['valor base', (tx: never) => detalleImpactoValorBase(tx)],
    ] as const) {
      const codigo = await db
        .asTenant(A.e.tenantId, A.e.companyId, fn as never, { rolId: roleId })
        .then(() => 'RESPONDIO')
        .catch((err: unknown) => (isPostgresError(err) ? err.code : `js:${String(err)}`));
      expect(codigo, `detalle de ${nombre}`).toBe(SQLSTATE.PERMISO_INSUFICIENTE);
    }
  });

  it('176 no crea ni retargetea un solo trigger de escritura', () => {
    const src = readFileSync(path.join(RAIZ, 'db/migrations/176_a8_d087_permisos_parametros.sql'), 'utf8');
    expect(src).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?TRIGGER/i);
    expect(src).not.toMatch(/instalar_permiso_escritura/i);
    expect(src).not.toMatch(/\bUPDATE\s+role_permission\b/i);
    expect(src).not.toMatch(/\bDELETE\s+FROM\s+role_permission\b/i);
  });
});

// =============================================================================
// 5. EL FLUJO DE DOS PASOS ES REALMENTE BLOQUEANTE
// =============================================================================
describe('A14 · D-087 (5) — no hay camino que guarde sin haber simulado', () => {
  async function uvtVigente(m: Mundo): Promise<{ id: string; valor: string }> {
    return db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ id: string; valor: string }>(
        `INSERT INTO uvt_value (tenant_id, company_id, anio, valor, vigente_desde, norma_respaldo)
         VALUES ($1, NULL, 2027, '4444400', DATE '2027-01-01', 'Valor inventado del escenario de A14')
         RETURNING id, valor::text`,
        [m.e.tenantId],
      );
      return rows[0]!;
    });
  }

  async function contarVigenciasUvt(tenantId: string): Promise<number> {
    const { rows } = await db.asAdmin((tx) =>
      tx.query<{ n: string }>('SELECT count(*)::text AS n FROM uvt_value WHERE tenant_id = $1', [tenantId]),
    );
    return Number(rows[0]!.n);
  }

  it('POST directo a confirmarUvtAction sin pasar por simularUvtAction NO abre vigencia nueva', async () => {
    const m = await montarMundo('POST directo');
    const uvt = await uvtVigente(m);
    await ponerSesion(m.e.tenantId, m.e.companyId, { rolCodigo: 'admin_tributario' });
    const antes = await contarVigenciasUvt(m.e.tenantId);

    const fd = new FormData();
    fd.set('reglaAnteriorId', uvt.id);
    fd.set('anio', '2027');
    fd.set('valorPesos', '55555');
    fd.set('vigenteDesde', '2027-07-01');
    fd.set('normaRespaldo', 'Norma inventada del POST directo de A14');
    fd.set('alcanceNuevo', 'firma');
    await accionesValoresBase.confirmarUvtAction(fd);

    const despues = await contarVigenciasUvt(m.e.tenantId);
    expect(despues, 'el paso 2 escribió sin que el contador viera el impacto').toBe(antes);
    expect(paramsDe(ultimaRedireccion()).get('error')).toBeTruthy();
    expect(paramsDe(ultimaRedireccion()).get('ok')).toBeNull();
  }, 120_000);

  it('el flujo completo (simular → confirmar) SÍ abre la vigencia nueva', async () => {
    const m = await montarMundo('Flujo completo');
    const uvt = await uvtVigente(m);
    await ponerSesion(m.e.tenantId, m.e.companyId, { rolCodigo: 'admin_tributario' });
    const antes = await contarVigenciasUvt(m.e.tenantId);

    const fd = new FormData();
    fd.set('reglaAnteriorId', uvt.id);
    fd.set('anio', '2027');
    fd.set('valorPesos', '55555');
    fd.set('vigenteDesde', '2027-07-01');
    fd.set('normaRespaldo', 'Norma inventada del flujo completo de A14');
    fd.set('alcanceNuevo', 'firma');
    await accionesValoresBase.simularUvtAction(fd);

    const sp = paramsDe(ultimaRedireccion());
    expect(sp.get('error')).toBeNull();
    expect(sp.get('confirmar')).toBe('1');
    expect(Number(sp.get('conceptos'))).toBeGreaterThan(0);

    const fd2 = new FormData();
    for (const [k, v] of sp.entries()) fd2.set(k, v);
    await accionesValoresBase.confirmarUvtAction(fd2);

    expect(paramsDe(ultimaRedireccion()).get('ok')).toBe('uvt');
    expect(await contarVigenciasUvt(m.e.tenantId)).toBe(antes + 1);
  }, 120_000);

  it('un testigo de impacto FALSEADO (números que nadie simuló) no deja guardar', async () => {
    const m = await montarMundo('Testigo falso');
    const uvt = await uvtVigente(m);
    await ponerSesion(m.e.tenantId, m.e.companyId, { rolCodigo: 'admin_tributario' });
    const antes = await contarVigenciasUvt(m.e.tenantId);

    const fd = new FormData();
    fd.set('reglaAnteriorId', uvt.id);
    fd.set('anio', '2027');
    fd.set('valorPesos', '55555');
    fd.set('vigenteDesde', '2027-07-01');
    fd.set('normaRespaldo', 'Norma inventada del testigo falso de A14');
    fd.set('alcanceNuevo', 'firma');
    fd.set('conceptos', '999');
    fd.set('proveedores', '999');
    await accionesValoresBase.confirmarUvtAction(fd);

    expect(await contarVigenciasUvt(m.e.tenantId)).toBe(antes);
    expect(paramsDe(ultimaRedireccion()).get('ok')).toBeNull();
  }, 120_000);

  it('POST directo a confirmarAction de TARIFAS no abre vigencia nueva', async () => {
    const m = await montarMundo('Tarifa POST directo');
    await ponerSesion(m.e.tenantId, m.e.companyId, { rolCodigo: 'admin_tributario' });
    const contar = async () => {
      const { rows } = await db.asAdmin((tx) =>
        tx.query<{ n: string }>(
          'SELECT count(*)::text AS n FROM tax_rule WHERE tax_concept_id = $1',
          [m.taxConceptObjetivo],
        ),
      );
      return Number(rows[0]!.n);
    };
    const antes = await contar();

    const fd = new FormData();
    fd.set('tipo', 'retefuente');
    fd.set('reglaAnteriorId', m.reglaObjetivoId);
    fd.set('tarifaPorcentaje', '9');
    fd.set('baseMinimaUvt', '3');
    fd.set('vigenteDesde', '2027-07-01');
    fd.set('normaRespaldo', 'Norma inventada del POST directo de tarifas (A14)');
    fd.set('alcanceNuevo', 'firma');
    await accionesTarifas.confirmarAction(fd);

    expect(await contar(), 'el paso 2 de tarifas escribió sin simulación previa').toBe(antes);
    expect(paramsDe(ultimaRedireccion()).get('ok')).toBeNull();
  }, 120_000);

  it('el flujo completo de TARIFAS (simular → confirmar) sí abre la vigencia nueva', async () => {
    const m = await montarMundo('Tarifa flujo completo');
    await ponerSesion(m.e.tenantId, m.e.companyId, { rolCodigo: 'admin_tributario' });
    const contar = async () => {
      const { rows } = await db.asAdmin((tx) =>
        tx.query<{ n: string }>(
          'SELECT count(*)::text AS n FROM tax_rule WHERE tax_concept_id = $1',
          [m.taxConceptObjetivo],
        ),
      );
      return Number(rows[0]!.n);
    };
    const antes = await contar();

    const fd = new FormData();
    fd.set('tipo', 'retefuente');
    fd.set('reglaAnteriorId', m.reglaObjetivoId);
    fd.set('taxConceptId', m.taxConceptObjetivo);
    fd.set('tarifaPorcentaje', '9');
    fd.set('baseMinimaUvt', '3');
    fd.set('vigenteDesde', '2027-07-01');
    fd.set('normaRespaldo', 'Norma inventada del flujo completo de tarifas (A14)');
    fd.set('alcanceNuevo', 'firma');
    await accionesTarifas.simularAction(fd);

    const sp = paramsDe(ultimaRedireccion());
    expect(sp.get('error')).toBeNull();
    expect(sp.get('confirmar')).toBe('1');

    const fd2 = new FormData();
    for (const [k, v] of sp.entries()) fd2.set(k, v);
    fd2.set('tipo', 'retefuente');
    // La pantalla de confirmación repone `reglaAnteriorId` desde la fila real.
    fd2.set('reglaAnteriorId', sp.get('editar') ?? '');
    await accionesTarifas.confirmarAction(fd2);

    expect(paramsDe(ultimaRedireccion()).get('error')).toBeNull();
    expect(await contar()).toBe(antes + 1);
  }, 120_000);

  it('POST directo a confirmarAction de RETEICA-MUNICIPIOS no abre vigencia nueva', async () => {
    const m = await montarMundo('ReteICA POST directo');
    await ponerSesion(m.e.tenantId, m.e.companyId, { rolCodigo: 'admin_tributario' });
    const contar = async () => {
      const { rows } = await db.asAdmin((tx) =>
        tx.query<{ n: string }>(
          'SELECT count(*)::text AS n FROM municipality_ica_rule WHERE municipality_id = $1',
          [m.municipioObjetivoId],
        ),
      );
      return Number(rows[0]!.n);
    };
    const antes = await contar();

    const fd = new FormData();
    fd.set('municipalityId', m.municipioObjetivoId);
    fd.set('reglaAnteriorId', '');
    fd.set('practicaReteica', 'true');
    fd.set('baseMinimaServiciosUvt', '4');
    fd.set('baseMinimaComprasUvt', '15');
    fd.set('usaTarifaDeActividad', 'true');
    fd.set('tarifaGeneralPorMil', '');
    fd.set('periodicidad', 'mensual');
    fd.set('vigenteDesde', '2027-07-01');
    fd.set('normaRespaldo', 'Acuerdo inventado del POST directo de A14');
    fd.set('alcanceNuevo', 'firma');
    await accionesReteica.confirmarAction(fd);

    expect(await contar(), 'el paso 2 de ReteICA escribió sin simulación previa').toBe(antes);
    expect(paramsDe(ultimaRedireccion()).get('ok')).toBeNull();
  }, 120_000);

  it('el flujo completo de RETEICA sí guarda', async () => {
    const m = await montarMundo('ReteICA flujo completo');
    await ponerSesion(m.e.tenantId, m.e.companyId, { rolCodigo: 'admin_tributario' });
    const contar = async () => {
      const { rows } = await db.asAdmin((tx) =>
        tx.query<{ n: string }>(
          'SELECT count(*)::text AS n FROM municipality_ica_rule WHERE municipality_id = $1',
          [m.municipioObjetivoId],
        ),
      );
      return Number(rows[0]!.n);
    };
    const antes = await contar();

    const fd = new FormData();
    fd.set('municipalityId', m.municipioObjetivoId);
    fd.set('reglaAnteriorId', '');
    fd.set('practicaReteica', 'true');
    fd.set('baseMinimaServiciosUvt', '4');
    fd.set('baseMinimaComprasUvt', '15');
    fd.set('usaTarifaDeActividad', 'true');
    fd.set('tarifaGeneralPorMil', '');
    fd.set('periodicidad', 'mensual');
    fd.set('vigenteDesde', '2027-07-01');
    fd.set('normaRespaldo', 'Acuerdo inventado del flujo completo de A14');
    fd.set('alcanceNuevo', 'firma');
    await accionesReteica.simularAction(fd);

    const sp = paramsDe(ultimaRedireccion());
    expect(sp.get('error')).toBeNull();
    const fd2 = new FormData();
    for (const [k, v] of sp.entries()) fd2.set(k, v);
    await accionesReteica.confirmarAction(fd2);

    expect(paramsDe(ultimaRedireccion()).get('error')).toBeNull();
    expect(await contar()).toBe(antes + 1);
  }, 120_000);
});

// =============================================================================
// 5-bis. EL NÚMERO QUE VE EL CONTADOR SALE DE LA BASE, NO DEL QUERY STRING
// =============================================================================
describe('A14 · D-087 (5-bis) — el conteo del paso 2 no se echa del query string', () => {
  const PANTALLAS = [
    'app/parametros/tarifas/[tipo]/page.tsx',
    'app/parametros/reteica-municipios/page.tsx',
    'app/parametros/valores-base/page.tsx',
  ];

  it('ninguna pantalla de confirmación pinta `conceptos`/`proveedores` leídos de searchParams', () => {
    for (const rel of PANTALLAS) {
      const src = readFileSync(path.join(RAIZ, rel), 'utf8');
      expect(src, `${rel} pinta el conteo del query string; el detalle sí es fresco → divergen`).not.toMatch(
        /cadena\(\s*sp\s*,\s*['"](conceptos|proveedores)['"]\s*\)/,
      );
    }
  });

  it('el detalle de tarifas se pide con el tax_concept de la REGLA, no con el del query string', () => {
    const src = readFileSync(path.join(RAIZ, 'app/parametros/tarifas/[tipo]/page.tsx'), 'utf8');
    expect(src).toMatch(/detalleImpactoTarifa\(\s*tx\s*,\s*\w+\.taxConceptId\s*\)/);
    expect(src).not.toMatch(/cadena\(\s*sp\s*,\s*['"]taxConceptId['"]\s*\)/);
  });

  it('el paso 2 resuelve el tax_concept EN LA BASE a partir de la regla, no del formulario', () => {
    const src = readFileSync(path.join(RAIZ, 'app/parametros/tarifas/[tipo]/acciones.ts'), 'utf8');
    const confirmar = src.slice(src.indexOf('export async function confirmarAction'));
    expect(confirmar).toContain('taxConceptIdDeTaxRule(tx, reglaAnteriorId)');
    expect(confirmar).not.toMatch(/leer\(formData,\s*['"]taxConceptId['"]\)/);
  });
});

// =============================================================================
// 5-ter. V-42 — el banner de alertas no se convierte en un muro de mil badges
// =============================================================================
describe('A14 · D-087 (5-ter) — el banner de alertas agrupa por categoría (V-42)', () => {
  it('con mil alertas de la misma categoría el banner NO renderiza mil entradas', async () => {
    const { BannerAlertas } = await import('../../app/parametros/_componentes');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { createElement } = await import('react');

    const muchas = Array.from({ length: 1122 }, (_, i) => ({
      categoria: 'municipality_ica_rule',
      severidad: 'alta' as const,
      mensaje: `Municipio ${i} no tiene bases mínimas ni tarifa general de ReteICA cargadas.`,
    }));
    const utiles = [
      { categoria: 'retefuente_salarios', severidad: 'alta' as const, mensaje: 'Tabla de salarios vacía.' },
      { categoria: 'smmlv_value', severidad: 'alta' as const, mensaje: 'SMMLV sin ningún año cargado.' },
      { categoria: 'tax_calendar', severidad: 'media' as const, mensaje: 'Calendario vacío.' },
    ];

    const html = renderToStaticMarkup(
      createElement(BannerAlertas, { alertas: [...muchas, ...utiles] }),
    );
    const botones = (html.match(/<button/g) ?? []).length;

    // El total real se sigue diciendo…
    expect(html).toContain('1125 alertas');
    // …pero la lista no es un muro: unas pocas por categoría más el resumen.
    expect(botones, `el banner renderizó ${botones} badges`).toBeLessThanOrEqual(12);
    // Y las alertas que el contador SÍ puede resolver hoy siguen visibles.
    expect(html).toContain('Tabla de salarios vacía.');
    expect(html).toContain('SMMLV sin ningún año cargado.');
    expect(html).toContain('Calendario vacío.');
    // El resto no se esconde: se dice cuántas quedan.
    expect(html).toMatch(/y 111[0-9] más de este mismo tipo/);
  });

  it('con pocas alertas el banner las sigue listando una por una (no cambia el caso normal)', async () => {
    const { BannerAlertas } = await import('../../app/parametros/_componentes');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { createElement } = await import('react');

    const pocas = [
      { categoria: 'municipality_ica_rule', severidad: 'alta' as const, mensaje: 'Bucaramanga sin ReteICA.' },
      { categoria: 'municipality_ica_rule', severidad: 'alta' as const, mensaje: 'Cartagena sin ReteICA.' },
    ];
    const html = renderToStaticMarkup(createElement(BannerAlertas, { alertas: pocas }));
    expect(html).toContain('Bucaramanga sin ReteICA.');
    expect(html).toContain('Cartagena sin ReteICA.');
    expect(html).not.toContain('más de este mismo tipo');
  });
});

// =============================================================================
// 6. MIGRACIÓN VISUAL REAL
// =============================================================================
describe('A14 · D-087 (6) — /parametros migrado de verdad', () => {
  const PANTALLAS = archivosTsx(path.join(RAIZ, 'app/parametros'));

  it('hay las seis pantallas/piezas esperadas y ninguna con `style` inline ni `#hex`', () => {
    expect(PANTALLAS.length).toBeGreaterThanOrEqual(6);
    for (const f of PANTALLAS) {
      const src = readFileSync(f, 'utf8');
      const rel = path.relative(RAIZ, f).replace(/\\/g, '/');
      expect(src, `${rel} conserva style inline`).not.toMatch(/\bstyle=\{\{/);
      expect(src, `${rel} conserva un #hex`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(src, `${rel} conserva <table> crudo`).not.toMatch(/<table\b/);
    }
  });

  it('/parametros salió de PREFIJOS_SIN_MIGRAR y el subárbol responde al tema oscuro', () => {
    const src = readFileSync(path.join(RAIZ, 'app/_ui/AppShell.tsx'), 'utf8');
    const linea = /const PREFIJOS_SIN_MIGRAR = \[([^\]]*)\]/.exec(src);
    expect(linea).not.toBeNull();
    expect(linea![1]).not.toContain('/parametros');
    expect(linea![1]).toContain('/reportes');
  });

  it('las pantallas usan el kit (Panel/Tabla/Encabezado), no markup suelto', () => {
    for (const rel of [
      'app/parametros/page.tsx',
      'app/parametros/tarifas/[tipo]/page.tsx',
      'app/parametros/valores-base/page.tsx',
      'app/parametros/reteica-municipios/page.tsx',
      'app/parametros/puc/page.tsx',
    ]) {
      const src = readFileSync(path.join(RAIZ, rel), 'utf8');
      expect(src, `${rel} no importa del kit`).toMatch(/from ['"][^'"]*_ui\/componentes['"]/);
    }
  });
});

// =============================================================================
// 7. REGLA DE ORO 2 SOBRE LO QUE TOCÓ D-087
// =============================================================================
describe('A14 · D-087 (7) — cero valores tributarios en lo nuevo', () => {
  const SOSPECHOSOS = [
    /\bUVT\s*=\s*\d/i,
    /\b(0?\.\d{2,6})\s*;?\s*\/\/\s*(tarifa|retefuente|reteiva|reteica)/i,
    /\b52[._]?374\b/,
    /\b(RETEFUENTE|RETEIVA|RETEICA|UVT|SMMLV)_[A-Z_]*\s*=\s*[\d.]/,
  ];

  it('la migración 176 no lleva tarifa, base, UVT ni calendario: solo permisos y consultas', () => {
    const src = readFileSync(path.join(RAIZ, 'db/migrations/176_a8_d087_permisos_parametros.sql'), 'utf8');
    for (const p of SOSPECHOSOS) expect(src, `patrón ${p}`).not.toMatch(p);
    // Sus INSERT solo mueven identificadores de permiso.
    const inserts = src.match(/INSERT INTO\s+(\w+)/gi) ?? [];
    expect(new Set(inserts.map((i) => i.split(/\s+/)[2]!.toLowerCase()))).toEqual(
      new Set(['permission', 'role_permission']),
    );
    expect(src).not.toMatch(/vigente_desde|vigente_hasta/i);
    expect(src).not.toMatch(/INSERT INTO\s+(tax_rule|uvt_value|smmlv_value|municipality_ica_rule|rounding_rule)/i);
  });

  it('los archivos nuevos y migrados de D-087 no llevan un valor tributario', () => {
    const archivos = [
      'app/parametros/_detalle-impacto.tsx',
      'app/parametros/_componentes.tsx',
      'app/parametros/page.tsx',
      'app/parametros/tarifas/[tipo]/page.tsx',
      'app/parametros/tarifas/[tipo]/acciones.ts',
      'app/parametros/valores-base/page.tsx',
      'app/parametros/valores-base/acciones.ts',
      'app/parametros/reteica-municipios/page.tsx',
      'app/parametros/reteica-municipios/acciones.ts',
      'app/parametros/puc/page.tsx',
      'src/services/parametrizacion.ts',
      'src/auth/permisos.ts',
    ];
    for (const rel of archivos) {
      const src = readFileSync(path.join(RAIZ, rel), 'utf8');
      for (const p of SOSPECHOSOS) expect(src, `${rel} contra ${p}`).not.toMatch(p);
    }
  });

  it('los códigos de submódulo están en el catálogo y en el espejo del código, y en el módulo correcto', async () => {
    const { rows } = await db.asAdmin((tx) =>
      tx.query<{ codigo: string; modulo: string; accion_tipo: string }>(
        "SELECT codigo, modulo, accion_tipo FROM permission WHERE codigo LIKE 'parametro.%.%'",
      ),
    );
    // 8 de D-087 + 2 de D-088 (parametro.ica.{leer,editar}, migración 178).
    expect(rows).toHaveLength(10);
    for (const r of rows) {
      expect(r.modulo, `${r.codigo} en un módulo homónimo`).toBe('parametrizacion');
      expect(['ver', 'editar']).toContain(r.accion_tipo);
      expect(Object.values(PERMISOS)).toContain(r.codigo);
    }
  });
});

// =============================================================================
// 8. REGLAS DE ORO 1 y 3 — nada de D-087 abre un camino de mutación
// =============================================================================
describe('A14 · D-087 (8) — el ledger y las vigencias siguen intocables', () => {
  it('editar un parámetro sigue siendo cerrar + insertar, nunca UPDATE del valor', async () => {
    const m = await montarMundo('Append-only');
    const antes = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ tarifa: string; vigente_hasta: string | null }>(
        'SELECT tarifa::text, vigente_hasta::text FROM tax_rule WHERE id = $1',
        [m.reglaObjetivoId],
      );
      return rows[0]!;
    });

    const codigo = await db
      .asTenant(
        m.e.tenantId, m.e.companyId,
        (tx) => tx.query('UPDATE tax_rule SET tarifa = 0.999999 WHERE id = $1', [m.reglaObjetivoId]),
        { rolCodigo: 'admin_tributario' },
      )
      .then(() => 'MUTO')
      .catch((err: unknown) => (isPostgresError(err) ? err.code : `js:${String(err)}`));
    expect(codigo).not.toBe('MUTO');

    const despues = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ tarifa: string }>(
        'SELECT tarifa::text FROM tax_rule WHERE id = $1', [m.reglaObjetivoId],
      );
      return rows[0]!;
    });
    expect(despues.tarifa).toBe(antes.tarifa);
  }, 120_000);

  it('un asiento publicado del escenario del simulador no se puede mutar ni borrar', async () => {
    const entryId = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        "SELECT id FROM journal_entry WHERE tenant_id = $1 AND estado = 'posted' LIMIT 1",
        [A.e.tenantId],
      );
      return rows[0]!.id;
    });

    for (const [que, sql] of [
      ['UPDATE', 'UPDATE journal_entry SET descripcion = $2 WHERE id = $1'],
      ['DELETE', 'DELETE FROM journal_entry WHERE id = $1'],
    ] as const) {
      const codigo = await db
        .asTenant(A.e.tenantId, A.e.companyId, (tx) =>
          tx.query(sql, que === 'UPDATE' ? [entryId, 'reescrito por A14'] : [entryId]),
        )
        .then(() => 'MUTO')
        .catch((err: unknown) => (isPostgresError(err) ? err.code : `js:${String(err)}`));
      expect(codigo, `${que} sobre asiento publicado`).not.toBe('MUTO');
    }
  });

  it('un asiento desbalanceado sigue muriendo en la base', async () => {
    const codigo = await db
      .asAdmin(async (tx) => {
        const id = await crearAsientoBorrador(tx, A.e, [
          { accountId: A.e.cuentas.gasto, side: 'debito', monto: 100000 },
          { accountId: A.e.cuentas.proveedores, side: 'credito', monto: 90000 },
        ]);
        await publicarAsiento(tx, id, A.e.userId);
      })
      .then(() => 'PUBLICO')
      .catch((err: unknown) => (isPostgresError(err) ? err.code : `js:${String(err)}`));
    expect(codigo).not.toBe('PUBLICO');
  });

  it('simular y ver el detalle no escriben una sola fila en el ledger', async () => {
    const foto = async () => {
      const { rows } = await db.asAdmin((tx) =>
        tx.query<{ n: string }>(
          'SELECT count(*)::text AS n FROM journal_entry WHERE tenant_id = $1', [A.e.tenantId],
        ),
      );
      return rows[0]!.n;
    };
    const antes = await foto();
    await medir(A, async (tx) => {
      await simularImpactoTarifa(tx, A.taxConceptObjetivo);
      await detalleImpactoTarifa(tx, A.taxConceptObjetivo);
      await simularImpactoValorBase(tx);
      await detalleImpactoValorBase(tx);
      await simularImpactoMunicipioIca(tx, A.municipioObjetivoId);
      await detalleImpactoMunicipioIca(tx, A.municipioObjetivoId);
    });
    expect(await foto()).toBe(antes);
  });
});

export type { ImpactoSimulado };

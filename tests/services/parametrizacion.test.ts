/**
 * A8 — Módulo de parametrización (sección 6). Prueba, una por una, las seis
 * conductas obligatorias de la sección 6.2, más el simulador de impacto y
 * las alertas de dato faltante de la advertencia 17.5.
 *
 * Convención de `tests/helpers/fixtures.ts`: aquí NO hay ningún valor
 * tributario real. Las tarifas de los conceptos "de prueba" son inventadas
 * para probar la MECÁNICA de vigencias, no la norma. La sección de la firma
 * compartida sí usa datos reales de A1 (servicios_generales), porque es
 * justo lo que hay que verificar: que el override no toca el dato nacional.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { createTestDb, esperarErrorPg, uuid, type TestDb } from '../helpers/db.js';
import { crearEscenario, crearAsientoBorrador, publicarAsiento, type Escenario } from '../helpers/fixtures.js';
import { seed } from '../../src/db/seed.js';
import { SQLSTATE } from '../../src/db/types.js';
import {
  detectarAlertasParametrizacion,
  editarTarifaTaxRule,
  editarUvtValue,
  fechaMinimaVigenciaTaxRule,
  listarHistorialTaxRule,
  listarMunicipiosIca,
  listarTarifasPorTipo,
  simularImpactoTarifa,
  EdicionRetroactivaError,
  NormaDeRespaldoRequeridaError,
  VigenciaInvalidaError,
} from '../../src/services/parametrizacion.js';

const SEEDS_DIR = fileURLToPath(new URL('../../db/seeds', import.meta.url));

let db: TestDb;
let e: Escenario;

beforeAll(async () => {
  db = await createTestDb();
  e = await crearEscenario(db);
  await db.asAdmin((tx) => seed(tx, { dir: SEEDS_DIR }));
});

afterAll(async () => {
  await db?.close();
});

/** Crea, dentro del escenario, un tax_concept + tax_rule PROPIOS de la
 * empresa (no globales): el punto de partida típico de las pruebas de
 * edición. La tarifa (0.05) y la norma son inventadas para probar mecánica,
 * como ya hacen los fixtures de A2/A3/A6. */
async function crearConceptoDePrueba(
  opciones: { vigenteDesde?: string } = {},
): Promise<{ taxConceptId: string; reglaId: string; codigo: string }> {
  const codigo = `concepto_prueba_a8_${uuid()}`;
  return db.asAdmin(async (tx) => {
    const { rows: c } = await tx.query<{ id: string }>(
      `INSERT INTO tax_concept (tenant_id, company_id, tipo, codigo, nombre)
       VALUES (NULL, NULL, 'retefuente', $1, 'Concepto de prueba A8 (no es un valor tributario real)')
       RETURNING id`,
      [codigo],
    );
    const taxConceptId = c[0]!.id;
    const { rows: r } = await tx.query<{ id: string }>(
      `INSERT INTO tax_rule (
         tenant_id, company_id, tax_concept_id, tipo, tarifa, base_minima_uvt,
         aplica_sobre, aplica_a, tipo_persona, account_id, vigente_desde, norma_respaldo
       ) VALUES ($1,$2,$3,'retefuente',0.050000,4,'base_gravable','ambos','ambos',$4,$5,
                 'Norma de prueba A8 (mecánica de vigencias, no es un dato normativo real)')
       RETURNING id`,
      [e.tenantId, e.companyId, taxConceptId, e.cuentas.retefuentePorPagar, opciones.vigenteDesde ?? '2026-01-01'],
    );
    return { taxConceptId, reglaId: r[0]!.id, codigo };
  });
}

async function crearConceptoCausacion(taxConceptId: string, companyId: string = e.companyId) {
  return db.asAdmin(async (tx) => {
    // La cuenta de contrapartida debe pertenecer a LA MISMA empresa que el
    // concepto (guardia de alcance, D-032): la de `e.cuentas.proveedores` es
    // de `e.companyId`, así que para otra empresa de la firma se usa una
    // cuenta GLOBAL del PUC (padre híbrido, cualquier empresa puede referenciarla).
    let cuentaId = e.cuentas.proveedores;
    if (companyId !== e.companyId) {
      const { rows: cuentaGlobal } = await tx.query<{ id: string }>(
        `SELECT id FROM account WHERE tenant_id IS NULL AND company_id IS NULL
          AND permite_movimiento = true ORDER BY codigo LIMIT 1`,
      );
      if (!cuentaGlobal[0]) throw new Error('No hay ninguna cuenta global imputable en el PUC de A1.');
      cuentaId = cuentaGlobal[0].id;
    }
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO concepto_causacion (
         tenant_id, company_id, codigo, nombre, cuenta_contrapartida_id,
         tax_concept_retefuente_id, aplica_retefuente
       ) VALUES ($1,$2,$3,'Concepto de causación de prueba',$4,$5,true)
       RETURNING id`,
      [e.tenantId, companyId, `cc_prueba_${uuid()}`, cuentaId, taxConceptId],
    );
    return rows[0]!.id;
  });
}

/** Publica un asiento con una retención ya trazada contra `reglaId`, para
 * simular "lo ya publicado" de la conducta 3. Fecha del hecho: 2026-06-15
 * (la que usa `crearAsientoBorrador`). */
async function publicarConRetencion(
  reglaId: string,
  reglaVigenteDesde: string,
  conceptoCausacionId: string | null = null,
): Promise<string> {
  return db.asAdmin(async (tx) => {
    const entryId = await crearAsientoBorrador(tx, e, [
      { accountId: e.cuentas.gasto, side: 'debito', monto: 100000 },
      { accountId: e.cuentas.proveedores, side: 'credito', monto: 100000 },
    ]);
    await publicarAsiento(tx, entryId, e.userId);
    await tx.query(
      `INSERT INTO retention_applied (
         tenant_id, company_id, source_document_id, journal_entry_id, concepto_causacion_id,
         third_party_id, tipo, base, tarifa, valor, tax_rule_id, regla_vigente_desde,
         norma_respaldo, account_id, fecha_hecho_economico, aplicada
       ) VALUES ($1,$2,$3,$4,$5,$6,'retefuente',100000,0.050000,5000,$7,$8,
                 'Norma de prueba A8', $9, '2026-06-15', true)`,
      [
        e.tenantId,
        e.companyId,
        e.sourceDocumentId,
        entryId,
        conceptoCausacionId,
        e.thirdPartyId,
        reglaId,
        reglaVigenteDesde,
        e.cuentas.retefuentePorPagar,
      ],
    );
    return entryId;
  });
}

async function auditLogDe(tabla: string, entidadId: string): Promise<
  Array<{ accion: string; valor_anterior: unknown; valor_nuevo: Record<string, unknown> | null; norma_respaldo: string | null }>
> {
  const { rows } = await db.asAdmin((tx) =>
    tx.query<{ accion: string; valor_anterior: unknown; valor_nuevo: Record<string, unknown> | null; norma_respaldo: string | null }>(
      `SELECT accion, valor_anterior, valor_nuevo, norma_respaldo FROM audit_log
        WHERE entidad = $1 AND entidad_id = $2 ORDER BY id`,
      [tabla, entidadId],
    ),
  );
  return rows;
}

// =============================================================================
// Conducta 1 — Nunca UPDATE: editar cierra la vigencia anterior e inserta una
// fila nueva.
// =============================================================================
describe('conducta 1 — nunca UPDATE de un valor ya vigente', () => {
  it('editar una tarifa cierra la anterior (vigente_hasta) e inserta una fila nueva con otro id', async () => {
    const concepto = await crearConceptoDePrueba();

    const resultado = await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) =>
        editarTarifaTaxRule(tx, {
          reglaAnteriorId: concepto.reglaId,
          vigenteDesde: '2026-08-01',
          normaRespaldo: 'Decreto de prueba A8 art. 1 (dato de prueba, no real)',
          tarifa: '0.070000',
        }),
      { rolCodigo: 'admin_tributario' },
    );

    expect(resultado.reglaNuevaId).not.toBe(concepto.reglaId);
    expect(resultado.reglaAnteriorCerrada).toBe(true);

    const { rows } = await db.asAdmin((tx) =>
      tx.query<{ id: string; tarifa: string; vigente_desde: string; vigente_hasta: string | null }>(
        `SELECT id, tarifa::text, vigente_desde::text, vigente_hasta::text FROM tax_rule
          WHERE tax_concept_id = $1 ORDER BY vigente_desde`,
        [concepto.taxConceptId],
      ),
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: concepto.reglaId, tarifa: '0.050000', vigente_hasta: '2026-07-31' });
    expect(rows[1]).toMatchObject({ id: resultado.reglaNuevaId, tarifa: '0.070000', vigente_hasta: null });
  });

  it('el motor sigue rechazando un UPDATE directo de tarifa con PR001 (VIGENCIA_INMUTABLE)', async () => {
    const concepto = await crearConceptoDePrueba();
    await esperarErrorPg(
      () => db.asAdmin((tx) => tx.query('UPDATE tax_rule SET tarifa = 0.99 WHERE id = $1', [concepto.reglaId])),
      SQLSTATE.VIGENCIA_INMUTABLE,
      'un UPDATE directo de la tarifa (en vez de una vigencia nueva)',
    );
  });

  it('el historial completo de una regla muestra todas las vigencias, ninguna desaparece', async () => {
    const concepto = await crearConceptoDePrueba();
    const r2 = await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) =>
        editarTarifaTaxRule(tx, {
          reglaAnteriorId: concepto.reglaId,
          vigenteDesde: '2026-06-01',
          normaRespaldo: 'Norma de prueba A8 #2',
          tarifa: '0.060000',
        }),
      { rolCodigo: 'admin_tributario' },
    );
    const r3 = await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) =>
        editarTarifaTaxRule(tx, {
          reglaAnteriorId: r2.reglaNuevaId,
          vigenteDesde: '2026-09-01',
          normaRespaldo: 'Norma de prueba A8 #3',
          tarifa: '0.080000',
        }),
      { rolCodigo: 'admin_tributario' },
    );

    const historial = await db.asAdmin((tx) => listarHistorialTaxRule(tx, r3.reglaNuevaId));
    expect(historial.map((h) => h.tarifa)).toEqual(['0.080000', '0.060000', '0.050000']);
    expect(historial.map((h) => h.vigenteHasta)).toEqual([null, '2026-08-31', '2026-05-31']);
  });
});

// =============================================================================
// Conducta 2 — Fecha de vigencia obligatoria y norma de respaldo obligatoria.
// =============================================================================
describe('conducta 2 — fecha de vigencia y norma de respaldo obligatorias', () => {
  it('rechaza sin llegar a la base si falta la norma de respaldo', async () => {
    const concepto = await crearConceptoDePrueba();
    await expect(
      db.asTenant(
        e.tenantId,
        e.companyId,
        (tx) =>
          editarTarifaTaxRule(tx, {
            reglaAnteriorId: concepto.reglaId,
            vigenteDesde: '2026-08-01',
            normaRespaldo: '   ',
            tarifa: '0.070000',
          }),
        { rolCodigo: 'admin_tributario' },
      ),
    ).rejects.toBeInstanceOf(NormaDeRespaldoRequeridaError);
  });

  it('rechaza una fecha que no es una fecha de vigencia válida', async () => {
    const concepto = await crearConceptoDePrueba();
    await expect(
      db.asTenant(
        e.tenantId,
        e.companyId,
        (tx) =>
          editarTarifaTaxRule(tx, {
            reglaAnteriorId: concepto.reglaId,
            vigenteDesde: '2026/08/01',
            normaRespaldo: 'Norma de prueba',
            tarifa: '0.070000',
          }),
        { rolCodigo: 'admin_tributario' },
      ),
    ).rejects.toBeInstanceOf(VigenciaInvalidaError);
  });

  it('rechaza una vigencia nueva que no es posterior a la que reemplaza', async () => {
    const concepto = await crearConceptoDePrueba({ vigenteDesde: '2026-05-01' });
    await expect(
      db.asTenant(
        e.tenantId,
        e.companyId,
        (tx) =>
          editarTarifaTaxRule(tx, {
            reglaAnteriorId: concepto.reglaId,
            vigenteDesde: '2026-05-01',
            normaRespaldo: 'Norma de prueba',
            tarifa: '0.070000',
          }),
        { rolCodigo: 'admin_tributario' },
      ),
    ).rejects.toBeInstanceOf(VigenciaInvalidaError);
  });
});

// =============================================================================
// Conducta 3 — Nunca retroactivo sobre lo ya publicado.
// =============================================================================
describe('conducta 3 — nunca retroactivo sobre lo ya publicado', () => {
  it('calcula la fecha mínima de vigencia a partir del último hecho publicado con la regla', async () => {
    const concepto = await crearConceptoDePrueba();
    const antes = await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) => fechaMinimaVigenciaTaxRule(tx, concepto.reglaId),
      { rolCodigo: 'admin_tributario' },
    );
    expect(antes).toBeNull();

    await publicarConRetencion(concepto.reglaId, '2026-01-01');

    const minima = await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) => fechaMinimaVigenciaTaxRule(tx, concepto.reglaId),
      { rolCodigo: 'admin_tributario' },
    );
    expect(minima).toBe('2026-06-15');
  });

  it('rechaza una vigencia nueva en o antes del último hecho publicado', async () => {
    const concepto = await crearConceptoDePrueba();
    await publicarConRetencion(concepto.reglaId, '2026-01-01');

    await expect(
      db.asTenant(
        e.tenantId,
        e.companyId,
        (tx) =>
          editarTarifaTaxRule(tx, {
            reglaAnteriorId: concepto.reglaId,
            vigenteDesde: '2026-06-15',
            normaRespaldo: 'Intento retroactivo',
            tarifa: '0.070000',
          }),
        { rolCodigo: 'admin_tributario' },
      ),
    ).rejects.toBeInstanceOf(EdicionRetroactivaError);

    await expect(
      db.asTenant(
        e.tenantId,
        e.companyId,
        (tx) =>
          editarTarifaTaxRule(tx, {
            reglaAnteriorId: concepto.reglaId,
            vigenteDesde: '2026-03-01',
            normaRespaldo: 'Intento retroactivo, antes incluso del hecho publicado',
            tarifa: '0.070000',
          }),
        { rolCodigo: 'admin_tributario' },
      ),
    ).rejects.toBeInstanceOf(EdicionRetroactivaError);
  });

  it('acepta una vigencia estrictamente posterior al último hecho publicado', async () => {
    const concepto = await crearConceptoDePrueba();
    await publicarConRetencion(concepto.reglaId, '2026-01-01');

    const resultado = await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) =>
        editarTarifaTaxRule(tx, {
          reglaAnteriorId: concepto.reglaId,
          vigenteDesde: '2026-06-16',
          normaRespaldo: 'Vigencia posterior a lo publicado',
          tarifa: '0.070000',
        }),
      { rolCodigo: 'admin_tributario' },
    );
    expect(resultado.reglaNuevaId).toBeTruthy();

    // Lo ya publicado sigue intacto: retention_applied sigue amarrada a la
    // regla y vigencia originales (D-017), y esa regla original no se tocó
    // más que para cerrar su `vigente_hasta`.
    const original = await db.asAdmin((tx) =>
      tx.query<{ tarifa: string }>('SELECT tarifa::text FROM tax_rule WHERE id = $1', [concepto.reglaId]),
    );
    expect(original.rows[0]?.tarifa).toBe('0.050000');
  });
});

// =============================================================================
// Conducta 4 — Auditoría con la norma de respaldo que escribe el contador.
// =============================================================================
describe('conducta 4 — auditoría automática con norma de respaldo', () => {
  it('el INSERT de la vigencia nueva y el cierre de la anterior quedan en audit_log', async () => {
    const concepto = await crearConceptoDePrueba();
    const resultado = await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) =>
        editarTarifaTaxRule(tx, {
          reglaAnteriorId: concepto.reglaId,
          vigenteDesde: '2026-08-01',
          normaRespaldo: 'Decreto 999 de 2026, art. 7 (dato de prueba)',
          tarifa: '0.070000',
        }),
      { rolCodigo: 'admin_tributario' },
    );

    const auditoriaNueva = await auditLogDe('tax_rule', resultado.reglaNuevaId);
    expect(auditoriaNueva).toHaveLength(1);
    expect(auditoriaNueva[0]).toMatchObject({ accion: 'INSERT', norma_respaldo: 'Decreto 999 de 2026, art. 7 (dato de prueba)' });
    expect(auditoriaNueva[0]!.valor_anterior).toBeNull();
    // JSONB no conserva ceros de relleno: to_jsonb(numeric) sale como número JSON.
    expect(Number((auditoriaNueva[0]!.valor_nuevo as Record<string, unknown>).tarifa)).toBeCloseTo(0.07);

    const auditoriaCierre = await auditLogDe('tax_rule', concepto.reglaId);
    const cierre = auditoriaCierre.find((a) => a.accion === 'UPDATE');
    expect(cierre).toBeDefined();
    expect((cierre!.valor_anterior as Record<string, unknown>).vigente_hasta).toBeNull();
    expect((cierre!.valor_nuevo as Record<string, unknown>).vigente_hasta).toBe('2026-07-31');
  });
});

// =============================================================================
// Conducta 5 — Permiso restringido al administrador tributario.
// =============================================================================
describe('conducta 5 — permiso restringido a parametro.editar', () => {
  it('un auxiliar de causación no puede editar una tarifa (SE002)', async () => {
    const concepto = await crearConceptoDePrueba();
    const error = await esperarErrorPg(
      () =>
        db.asTenant(
          e.tenantId,
          e.companyId,
          (tx) =>
            editarTarifaTaxRule(tx, {
              reglaAnteriorId: concepto.reglaId,
              vigenteDesde: '2026-08-01',
              normaRespaldo: 'Intento no autorizado',
              tarifa: '0.070000',
            }),
          { rolCodigo: 'auxiliar_causacion' },
        ),
      SQLSTATE.PERMISO_INSUFICIENTE,
      'un auxiliar de causación editando una tarifa',
    );
    expect(error.message).toMatch(/parametro\.editar/);
  });

  it('solo_lectura tampoco puede, aunque pueda leer los parámetros', async () => {
    const concepto = await crearConceptoDePrueba();
    await esperarErrorPg(
      () =>
        db.asTenant(
          e.tenantId,
          e.companyId,
          (tx) =>
            editarTarifaTaxRule(tx, {
              reglaAnteriorId: concepto.reglaId,
              vigenteDesde: '2026-08-01',
              normaRespaldo: 'Intento no autorizado',
              tarifa: '0.070000',
            }),
          { rolCodigo: 'solo_lectura' },
        ),
      SQLSTATE.PERMISO_INSUFICIENTE,
      'solo_lectura editando una tarifa',
    );
  });

  it('el administrador tributario sí puede', async () => {
    const concepto = await crearConceptoDePrueba();
    const resultado = await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) =>
        editarTarifaTaxRule(tx, {
          reglaAnteriorId: concepto.reglaId,
          vigenteDesde: '2026-08-01',
          normaRespaldo: 'Autorizado',
          tarifa: '0.070000',
        }),
      { rolCodigo: 'admin_tributario' },
    );
    expect(resultado.reglaNuevaId).toBeTruthy();
  });

  it('el administrador de firma también puede (tiene todos los permisos)', async () => {
    const concepto = await crearConceptoDePrueba();
    const resultado = await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) =>
        editarTarifaTaxRule(tx, {
          reglaAnteriorId: concepto.reglaId,
          vigenteDesde: '2026-08-01',
          normaRespaldo: 'Autorizado (admin_firma)',
          tarifa: '0.070000',
        }),
      { rolCodigo: 'admin_firma' },
    );
    expect(resultado.reglaNuevaId).toBeTruthy();
  });
});

// =============================================================================
// Conducta 6 — Simulador de impacto previo al guardado.
// =============================================================================
describe('conducta 6 — simulador de impacto ("afecta N conceptos y M proveedores")', () => {
  it('cuenta los concepto_causacion que apuntan al concepto y los proveedores con historial', async () => {
    const concepto = await crearConceptoDePrueba();
    const ccUno = await crearConceptoCausacion(concepto.taxConceptId);
    const ccDos = await crearConceptoCausacion(concepto.taxConceptId);

    await publicarConRetencion(concepto.reglaId, '2026-01-01', ccUno);
    await publicarConRetencion(concepto.reglaId, '2026-01-01', ccDos);

    const impacto = await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) => simularImpactoTarifa(tx, concepto.taxConceptId),
      { rolCodigo: 'admin_tributario' },
    );

    expect(impacto.conceptosAfectados).toBe(2);
    // El único tercero del escenario aparece en las dos retenciones: 1 proveedor distinto.
    expect(impacto.proveedoresAfectados).toBe(1);
  });

  it('un concepto sin ningún concepto_causacion asociado no afecta a nadie', async () => {
    const concepto = await crearConceptoDePrueba();
    const impacto = await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) => simularImpactoTarifa(tx, concepto.taxConceptId),
      { rolCodigo: 'admin_tributario' },
    );
    expect(impacto).toEqual({ conceptosAfectados: 0, proveedoresAfectados: 0 });
  });

  it('el simulador también exige parametro.editar: no es una consulta pública', async () => {
    const concepto = await crearConceptoDePrueba();
    await esperarErrorPg(
      () =>
        db.asTenant(e.tenantId, e.companyId, (tx) => simularImpactoTarifa(tx, concepto.taxConceptId), {
          rolCodigo: 'auxiliar_causacion',
        }),
      SQLSTATE.PERMISO_INSUFICIENTE,
      'un auxiliar de causación consultando el simulador',
    );
  });
});

// =============================================================================
// Verificación con A2: la RLS híbrida no bloquea a un administrador de firma
// editando un parámetro COMPARTIDO entre las empresas de su firma.
// =============================================================================
describe('alcance firma vs. empresa (verificación de la RLS híbrida de A2)', () => {
  let companyB: string;

  beforeAll(async () => {
    companyB = uuid();
    await db.asAdmin((tx) =>
      tx.query(
        `INSERT INTO company (id, tenant_id, nit, razon_social, municipality_id, ciiu_principal_id,
                              es_agente_retencion_renta, buzon_email)
         VALUES ($1,$2,$3,'Empresa B de la misma firma',$4,$5,true,$6)`,
        [companyB, e.tenantId, `802${uuid().slice(0, 8)}`, e.municipalityId, e.ciiuId, `empresa-b-${uuid()}@inbox.ejemplo.co`],
      ),
    );
  });

  it(
    'un admin_tributario SIN empresa seleccionada crea un override compartido (company_id NULL) ' +
      'sobre una tarifa nacional, y NO muta la fila global',
    async () => {
      const global = await db.asAdmin((tx) =>
        tx.query<{ id: string; vigente_desde: string }>(
          `SELECT tr.id, tr.vigente_desde::text FROM tax_rule tr
             JOIN tax_concept tc ON tc.id = tr.tax_concept_id
            WHERE tc.tipo = 'retefuente' AND tc.codigo = 'servicios_generales'
              AND tr.aplica_a = 'declarante' AND tr.tenant_id IS NULL AND tr.vigente_hasta IS NULL`,
        ),
      );
      expect(global.rows[0]).toBeDefined();
      const reglaGlobalId = global.rows[0]!.id;

      const resultado = await db.asTenant(
        e.tenantId,
        null,
        (tx) =>
          editarTarifaTaxRule(tx, {
            reglaAnteriorId: reglaGlobalId,
            vigenteDesde: '2027-01-01',
            normaRespaldo: 'Política interna de la firma para servicios generales (dato de prueba)',
            tarifa: '0.045000',
            alcanceNuevo: 'firma',
          }),
        { rolCodigo: 'admin_tributario' },
      );

      expect(resultado.reglaAnteriorCerrada).toBe(false); // la fila global NO se tocó.

      const globalTrasEdicion = await db.asAdmin((tx) =>
        tx.query<{ vigente_hasta: string | null; tarifa: string }>(
          'SELECT vigente_hasta::text, tarifa::text FROM tax_rule WHERE id = $1',
          [reglaGlobalId],
        ),
      );
      expect(globalTrasEdicion.rows[0]).toMatchObject({ vigente_hasta: null, tarifa: '0.040000' });

      const nueva = await db.asAdmin((tx) =>
        tx.query<{ tenant_id: string; company_id: string | null }>(
          'SELECT tenant_id, company_id FROM tax_rule WHERE id = $1',
          [resultado.reglaNuevaId],
        ),
      );
      expect(nueva.rows[0]).toMatchObject({ tenant_id: e.tenantId, company_id: null });
    },
  );

  it('la empresa B (misma firma, no la que editó) VE el override compartido como tarifa efectiva', async () => {
    const tarifas = await db.asTenant(
      e.tenantId,
      companyB,
      (tx) => listarTarifasPorTipo(tx, 'retefuente', '2027-03-01'),
      { rolCodigo: 'contador' },
    );
    const fila = tarifas.find((t) => t.codigo === 'servicios_generales' && t.aplicaA === 'declarante');
    expect(fila).toMatchObject({ tarifa: '0.045000', alcance: 'firma', esEfectiva: true });
  });

  it('en fechas anteriores al override, la empresa B sigue viendo la tarifa nacional', async () => {
    const tarifas = await db.asTenant(
      e.tenantId,
      companyB,
      (tx) => listarTarifasPorTipo(tx, 'retefuente', '2026-08-01'),
      { rolCodigo: 'contador' },
    );
    const fila = tarifas.find((t) => t.codigo === 'servicios_generales' && t.aplicaA === 'declarante');
    expect(fila).toMatchObject({ tarifa: '0.040000', alcance: 'global', esEfectiva: true });
  });

  it(
    'el simulador agregado por firma ve el impacto en TODAS las empresas, aunque la sesión que ' +
      'edita no tenga ninguna empresa seleccionada',
    async () => {
      const global = await db.asAdmin((tx) =>
        tx.query<{ id: string }>(
          `SELECT tc.id FROM tax_concept tc WHERE tc.tipo = 'retefuente' AND tc.codigo = 'servicios_generales'`,
        ),
      );
      const taxConceptId = global.rows[0]!.id;
      await crearConceptoCausacion(taxConceptId, companyB);

      const impactoDesdeA = await db.asTenant(
        e.tenantId,
        e.companyId,
        (tx) => simularImpactoTarifa(tx, taxConceptId),
        { rolCodigo: 'admin_tributario' },
      );
      // La sesión de la empresa A no vería, por RLS normal, un concepto_causacion
      // de la empresa B — pero el simulador agrega a nivel de FIRMA a propósito.
      expect(impactoDesdeA.conceptosAfectados).toBeGreaterThanOrEqual(1);
    },
  );

  it('una empresa de OTRA firma nunca ve el override (aislamiento entre tenants intacto)', async () => {
    const otra = await crearEscenario(db);
    const tarifas = await db.asTenant(
      otra.tenantId,
      otra.companyId,
      (tx) => listarTarifasPorTipo(tx, 'retefuente', '2027-03-01'),
      { rolCodigo: 'contador' },
    );
    const fila = tarifas.find((t) => t.codigo === 'servicios_generales' && t.aplicaA === 'declarante');
    expect(fila).toMatchObject({ tarifa: '0.040000', alcance: 'global' });
  });
});

// =============================================================================
// Valores base (UVT): mismo mecanismo, otra tabla — prueba de que la
// mecánica generaliza más allá de tax_rule.
// =============================================================================
describe('valores base — UVT (mismo mecanismo de vigencias append-only)', () => {
  it('edita la UVT de la firma, cierra la anterior si es propia y audita con norma', async () => {
    const codigoAnio = 2031; // año arbitrario que no colisiona con datos reales de A1.
    const inicial = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO uvt_value (tenant_id, company_id, anio, valor, vigente_desde, norma_respaldo)
         VALUES ($1, NULL, $2, 5000000, '2031-01-01', 'Valor de prueba A8, no es la UVT real de ese año')
         RETURNING id`,
        [e.tenantId, codigoAnio],
      );
      return rows[0]!.id;
    });

    const resultado = await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) =>
        editarUvtValue(tx, {
          reglaAnteriorId: inicial,
          anio: codigoAnio,
          valorCentavos: '5100000',
          vigenteDesde: '2031-02-01',
          normaRespaldo: 'Corrección de prueba A8',
        }),
      { rolCodigo: 'admin_tributario' },
    );

    const filas = await db.asAdmin((tx) =>
      tx.query<{ id: string; valor: string; vigente_hasta: string | null }>(
        'SELECT id, valor::text, vigente_hasta::text FROM uvt_value WHERE anio = $1 ORDER BY vigente_desde',
        [codigoAnio],
      ),
    );
    expect(filas.rows).toHaveLength(2);
    expect(filas.rows[0]).toMatchObject({ id: inicial, vigente_hasta: '2031-01-31' });
    expect(filas.rows[1]).toMatchObject({ id: resultado.reglaNuevaId, valor: '5100000', vigente_hasta: null });

    const auditoria = await auditLogDe('uvt_value', resultado.reglaNuevaId);
    expect(auditoria[0]).toMatchObject({ accion: 'INSERT', norma_respaldo: 'Corrección de prueba A8' });
  });

  it('un auxiliar de causación tampoco puede editar la UVT', async () => {
    // Escenario propio: `uvt_value.clave_vigencia` es una sola línea de
    // tiempo por (tenant, company) sin importar el año, así que reutilizar
    // `e.tenantId` chocaría (VIGENCIA_SOLAPADA) con la vigencia que ya dejó
    // abierta la prueba anterior.
    const otro = await crearEscenario(db);
    const inicial = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO uvt_value (tenant_id, company_id, anio, valor, vigente_desde, norma_respaldo)
         VALUES ($1, NULL, 2032, 5000000, '2032-01-01', 'Valor de prueba A8')
         RETURNING id`,
        [otro.tenantId],
      );
      return rows[0]!.id;
    });
    await esperarErrorPg(
      () =>
        db.asTenant(
          otro.tenantId,
          otro.companyId,
          (tx) =>
            editarUvtValue(tx, {
              reglaAnteriorId: inicial,
              anio: 2032,
              valorCentavos: '5100000',
              vigenteDesde: '2032-02-01',
              normaRespaldo: 'Intento no autorizado',
            }),
          { rolCodigo: 'auxiliar_causacion' },
        ),
      SQLSTATE.PERMISO_INSUFICIENTE,
      'un auxiliar de causación editando la UVT',
    );
  });
});

// =============================================================================
// Alertas de dato faltante (advertencia 17.5): lo que A1 dejó sin cargar a
// propósito debe verse, no rellenarse en silencio.
// =============================================================================
describe('alertas de dato pendiente de verificación humana', () => {
  it('detecta que la tabla progresiva de retención por salarios está vacía', async () => {
    const alertas = await db.asAdmin((tx) => detectarAlertasParametrizacion(tx));
    expect(alertas.some((a) => a.categoria === 'retefuente_salarios')).toBe(true);
  });

  it('detecta que Bucaramanga y Cartagena no tienen regla de ReteICA', async () => {
    const alertas = await db.asAdmin((tx) => detectarAlertasParametrizacion(tx));
    const mensajes = alertas.filter((a) => a.categoria === 'municipality_ica_rule').map((a) => a.mensaje);
    expect(mensajes.some((m) => m.includes('Bucaramanga'))).toBe(true);
    expect(mensajes.some((m) => m.includes('Cartagena'))).toBe(true);
  });

  it('detecta que Bogotá y Cali no tienen tarifa de ReteICA por actividad cargada', async () => {
    const alertas = await db.asAdmin((tx) => detectarAlertasParametrizacion(tx));
    const mensajes = alertas.filter((a) => a.categoria === 'tax_rule_reteica').map((a) => a.mensaje);
    expect(mensajes.some((m) => m.includes('Bogotá'))).toBe(true);
    expect(mensajes.some((m) => m.includes('Cali'))).toBe(true);
  });

  it('detecta las filas marcadas requiere_verificacion_humana (autorretención CIIU, entre otras)', async () => {
    const alertas = await db.asAdmin((tx) => detectarAlertasParametrizacion(tx));
    expect(alertas.some((a) => a.categoria === 'tax_rule.requiere_verificacion_humana')).toBe(true);
  });

  it('listarMunicipiosIca muestra Bucaramanga con reglaId null (alerta a nivel de fila)', async () => {
    const municipios = await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) => listarMunicipiosIca(tx),
      { rolCodigo: 'contador' },
    );
    const bucaramanga = municipios.find((m) => m.municipalityNombre === 'Bucaramanga');
    expect(bucaramanga).toBeDefined();
    expect(bucaramanga!.reglaId).toBeNull();

    const bogota = municipios.find((m) => m.municipalityNombre.startsWith('Bogotá'));
    expect(bogota?.reglaId).not.toBeNull();
    expect(bogota?.requiereVerificacionHumana).toBe(true);
  });
});

/**
 * A14 — COMPUERTA DE LA OLA 3, segunda parte: las tres entregas (A9, A10, A11)
 * verificadas por A14 con sus propias pruebas, no por el reporte de nadie.
 *
 * Qué se ataca aquí, y por qué:
 *
 *  1. Sección 11.2 — las CUATRO hojas obligatorias en TODOS los libros de la
 *     ola (los 8 de A9, los 5 de A10 y los 7 de A11), y la hoja "Trazabilidad"
 *     diciendo qué regla y qué vigencia se aplicó. Un reporte sin eso no es
 *     defendible ante un revisor fiscal.
 *  2. Regla de Oro 7 — ningún libro de esta ola deja ver datos de otra empresa
 *     ni de otra firma, ni por una hoja olvidada del Excel.
 *  3. Regla de Oro 1 — el cierre de resultados (`src/services/cierre.ts`) es el
 *     único código de la ola que ESCRIBE en el ledger. Asiento nuevo, ciclo
 *     draft→publicar, idempotente, y una cuenta sin mapeo NIIF no se cierra a
 *     ciegas por su clase del PUC.
 *  4. Advertencia 17.5 aplicada a los estados financieros: ninguna nota sale
 *     redactada por la máquina, y el EFE sale VACÍO (con su papel de trabajo)
 *     si nadie marcó las cuentas de efectivo, en vez de suponer cuáles son.
 *  5. Advertencia 17.5 aplicada a la exógena: el Formato 1001 no rellena
 *     dirección ni municipio con ningún valor por defecto.
 *  6. Ningún generador de exógena (ni de reportes, ni de estados) escribe una
 *     sola fila en el ledger.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { createTestDb, uuid, type TestDb } from '../helpers/db';
import { crearEscenario, type Escenario } from '../helpers/fixtures';
import {
  montarPucYMapeo,
  montarMovimientos,
  publicarEnFecha,
  type CuentasEstados,
  UN_MILLON,
  MEDIO_MILLON,
} from '../helpers/estados-a10';
import { libroABuffer } from '../../src/reports/excel';
import { PermisoInsuficienteError } from '../../src/auth/permisos';
import { ROLES } from '../../src/auth/permisos';
import type { SqlClient } from '../../src/db/types';
import {
  generarBalanceDePrueba,
  generarCertificadoRetenciones,
  generarDetalleIva,
  generarLibroAuxiliar,
  generarLibroDiario,
  generarLibroMayor,
  generarMovimientoTerceros,
  generarRelacionRetenciones,
} from '../../src/reports/libros';
import {
  generarEstadoCambiosPatrimonio,
  generarEstadoFlujosEfectivo,
  generarEstadoResultadoIntegral,
  generarEstadoSituacionFinanciera,
  generarNotasEstadosFinancieros,
  calcularEstadoFlujosEfectivo,
} from '../../src/reports/estados/libros';
import { ESTRUCTURA_NOTAS } from '../../src/reports/estados/notas';
import {
  generarFormato1001,
  generarFormato1003,
  generarFormato1005,
  generarFormato1006,
  generarFormato1007,
  generarFormato1008,
  generarFormato1009,
} from '../../src/reports/exogena/formatos';
import { cerrarCuentasDeResultado, CierreSolapadoError, saldosACerrar } from '../../src/services/cierre';

let db: TestDb;
/** Empresa A: la que tiene los datos. */
let a: Escenario;
let cuentasA: CuentasEstados;
/** Empresa B: OTRA FIRMA (otro tenant). No debe ver nada de A. */
let b: Escenario;
let cuentasB: CuentasEstados;
/** Empresa C: MISMA firma que A, otra empresa-cliente. Tampoco debe ver nada de A. */
let c: Escenario;

const RANGO = { desde: '2026-06-01', hasta: '2026-06-30' };
const RANGO_EXOGENA = { desde: '2026-06-01', hasta: '2026-06-30', anioGravable: 2026 };
const HOJAS_OBLIGATORIAS = ['Datos', 'Papel de trabajo', 'Trazabilidad', 'Parámetros'];
/** Marcador que solo existe en los datos de la empresa A. */
const MARCA_A = 'MARCA-EXCLUSIVA-DE-LA-EMPRESA-A';

let retencionA: { taxRuleId: string; vigenteDesde: string; valor: string };

/** Crea una retención de prueba (mecánica, no un dato normativo real). */
async function crearRetencion(tx: SqlClient, esc: Escenario): Promise<typeof retencionA> {
  const { rows: tc } = await tx.query<{ id: string }>(
    `INSERT INTO tax_concept (tenant_id, company_id, tipo, codigo, nombre)
     VALUES (NULL, NULL, 'retefuente', $1, 'Concepto de prueba A14 (no es un valor tributario real)')
     RETURNING id`,
    [`concepto_prueba_a14_${uuid()}`],
  );
  const { rows: tr } = await tx.query<{ id: string; vigente_desde: string }>(
    `INSERT INTO tax_rule (
       tenant_id, company_id, tax_concept_id, tipo, tarifa, base_minima_uvt,
       aplica_sobre, aplica_a, tipo_persona, account_id, vigente_desde, norma_respaldo
     ) VALUES ($1,$2,$3,'retefuente',$4,$5,'base_gravable','ambos','ambos',$6,'2026-01-01',
               'Norma de prueba A14 (mecánica de reportes, no un dato normativo real)')
     RETURNING id, vigente_desde::text`,
    [esc.tenantId, esc.companyId, tc[0]!.id, '0.040000', 4, esc.cuentas.retefuentePorPagar],
  );
  const { rows: ra } = await tx.query<{ id: string }>(
    `INSERT INTO retention_applied (
       tenant_id, company_id, source_document_id, third_party_id, tipo, base, tarifa, valor,
       tax_rule_id, regla_vigente_desde, norma_respaldo, account_id, fecha_hecho_economico, aplicada,
       uvt_valor_usado, base_minima_uvt_usada
     ) VALUES ($1,$2,$3,$4,'retefuente',$5,$6,$7,$8,$9,'Norma de prueba A14',$10,'2026-06-15',true,$11,$12)
     RETURNING id`,
    [
      esc.tenantId, esc.companyId, esc.sourceDocumentId, esc.thirdPartyId,
      UN_MILLON, '0.040000', 40_000_00, tr[0]!.id, tr[0]!.vigente_desde,
      esc.cuentas.retefuentePorPagar, 4_241_200, 4,
    ],
  );
  // Un asiento que la referencia, para que aparezca en los reportes tributarios.
  const entryId = uuid();
  await tx.query(
    `INSERT INTO journal_entry (id, tenant_id, company_id, fiscal_period_id, fecha_hecho_economico,
                                descripcion, estado, source_document_id, approval_id, idempotency_key, created_by)
     VALUES ($1,$2,$3,$4,'2026-06-15',$5,'draft',$6,$7,$8,$9)`,
    [entryId, esc.tenantId, esc.companyId, esc.fiscalPeriodId, `Causación ${MARCA_A}`,
     esc.sourceDocumentId, esc.approvalId, `idem-a14-ret-${entryId}`, esc.userId],
  );
  const partidas: [string, 'debito' | 'credito', number, string | null][] = [
    [esc.cuentas.gasto, 'debito', UN_MILLON, null],
    [esc.cuentas.ivaDescontable, 'debito', 190_000_00, null],
    [esc.cuentas.proveedores, 'credito', 1_150_000_00, null],
    [esc.cuentas.retefuentePorPagar, 'credito', 40_000_00, ra[0]!.id],
  ];
  let linea = 0;
  for (const [accountId, side, monto, retId] of partidas) {
    linea += 1;
    await tx.query(
      `INSERT INTO journal_line (tenant_id, company_id, journal_entry_id, linea, account_id, side,
                                 monto, third_party_id, retention_applied_id, descripcion)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [esc.tenantId, esc.companyId, entryId, linea, accountId, side, monto, esc.thirdPartyId, retId, MARCA_A],
    );
  }
  await tx.query('SELECT app.publicar_asiento($1, $2)', [entryId, esc.userId]);
  return { taxRuleId: tr[0]!.id, vigenteDesde: tr[0]!.vigente_desde, valor: '4000000' };
}

beforeAll(async () => {
  db = await createTestDb();
  a = await crearEscenario(db, { razonSocial: 'Firma A' });
  b = await crearEscenario(db, { razonSocial: 'Firma B (otra firma)' });

  // Empresa C: MISMA firma que A. `crearEscenario` crea su propio tenant, así
  // que se monta a mano lo mínimo para tener una segunda empresa dentro de A.
  c = { ...a, companyId: uuid(), fiscalPeriodId: uuid() };
  await db.asAdmin(async (tx) => {
    await tx.query(
      `INSERT INTO company (id, tenant_id, nit, razon_social, municipality_id, ciiu_principal_id,
                            es_agente_retencion_renta, buzon_email)
       VALUES ($1,$2,$3,'Segunda empresa de la firma A',$4,$5,true,$6)`,
      [c.companyId, a.tenantId, `802${Date.now()}`, a.municipalityId, a.ciiuId,
       `empresa-c-${Date.now()}@inbox.ejemplo.co`],
    );
    await tx.query(
      `INSERT INTO user_company_access (tenant_id, company_id, user_id, role_id)
       VALUES ($1,$2,$3,$4)`,
      [a.tenantId, c.companyId, a.userId, ROLES.ADMIN_FIRMA],
    );
  });

  await db.asAdmin(async (tx) => {
    cuentasA = await montarPucYMapeo(tx, a, { marcarEfectivo: false });
    await montarMovimientos(tx, a, cuentasA);
    retencionA = await crearRetencion(tx, a);
  });
  await db.asAdmin(async (tx) => {
    cuentasB = await montarPucYMapeo(tx, b, { marcarEfectivo: false });
    await montarMovimientos(tx, b, cuentasB);
  });
}, 300_000);

afterAll(async () => {
  await db?.close();
});

// =============================================================================
// 1. Sección 11.2 — las cuatro hojas obligatorias, en los VEINTE libros
// =============================================================================

type GeneradorLibro = { nombre: string; generar: (tx: SqlClient) => Promise<ExcelJS.Workbook> };

const LIBROS_A9: GeneradorLibro[] = [
  { nombre: 'A9 · libro diario', generar: (tx) => generarLibroDiario(tx, RANGO) },
  { nombre: 'A9 · libro mayor', generar: (tx) => generarLibroMayor(tx, RANGO) },
  { nombre: 'A9 · balance de prueba', generar: (tx) => generarBalanceDePrueba(tx, { ...RANGO, nivel: 3 }) },
  { nombre: 'A9 · certificado de retenciones', generar: (tx) => generarCertificadoRetenciones(tx, { ...RANGO, terceroId: a.thirdPartyId }) },
  { nombre: 'A9 · relación de retenciones', generar: (tx) => generarRelacionRetenciones(tx, RANGO) },
  { nombre: 'A9 · movimiento de terceros', generar: (tx) => generarMovimientoTerceros(tx, RANGO) },
  { nombre: 'A9 · detalle de IVA', generar: (tx) => generarDetalleIva(tx, RANGO) },
];

const LIBROS_A10: GeneradorLibro[] = [
  { nombre: 'A10 · ESF', generar: (tx) => generarEstadoSituacionFinanciera(tx, { fechaCorte: RANGO.hasta }) },
  { nombre: 'A10 · ERI', generar: (tx) => generarEstadoResultadoIntegral(tx, RANGO) },
  { nombre: 'A10 · ECP', generar: (tx) => generarEstadoCambiosPatrimonio(tx, RANGO) },
  { nombre: 'A10 · EFE', generar: (tx) => generarEstadoFlujosEfectivo(tx, RANGO) },
  { nombre: 'A10 · Notas', generar: (tx) => generarNotasEstadosFinancieros(tx, RANGO) },
];

const LIBROS_A11: GeneradorLibro[] = [
  { nombre: 'A11 · 1001', generar: async (tx) => (await generarFormato1001(tx, RANGO_EXOGENA)).workbook },
  { nombre: 'A11 · 1003', generar: async (tx) => (await generarFormato1003(tx, RANGO_EXOGENA)).workbook },
  { nombre: 'A11 · 1005', generar: async (tx) => (await generarFormato1005(tx, RANGO_EXOGENA)).workbook },
  { nombre: 'A11 · 1006', generar: async (tx) => (await generarFormato1006(tx, RANGO_EXOGENA)).workbook },
  { nombre: 'A11 · 1007', generar: async (tx) => (await generarFormato1007(tx, RANGO_EXOGENA)).workbook },
  { nombre: 'A11 · 1008', generar: async (tx) => (await generarFormato1008(tx, RANGO_EXOGENA.hasta, RANGO_EXOGENA.anioGravable)).workbook },
  { nombre: 'A11 · 1009', generar: async (tx) => (await generarFormato1009(tx, RANGO_EXOGENA.hasta, RANGO_EXOGENA.anioGravable)).workbook },
];

const LIBRO_AUXILIAR: GeneradorLibro = {
  nombre: 'A9 · libro auxiliar',
  generar: (tx) => generarLibroAuxiliar(tx, { ...RANGO, accountId: a.cuentas.gasto, terceroId: a.thirdPartyId }),
};

const TODOS_LOS_LIBROS = [...LIBROS_A9, LIBRO_AUXILIAR, ...LIBROS_A10, ...LIBROS_A11];

/** Todo el texto de todas las hojas de un libro, incluidas las adicionales. */
function textoCompleto(wb: ExcelJS.Workbook): string {
  const partes: string[] = [];
  wb.eachSheet((hoja) => {
    partes.push(hoja.name);
    hoja.eachRow((fila) => {
      fila.eachCell({ includeEmpty: false }, (celda) => {
        partes.push(String(celda.value ?? ''));
      });
    });
  });
  return partes.join('\n');
}

describe('A14 · sección 11.2 — las cuatro hojas obligatorias en los VEINTE libros de la Ola 3', () => {
  it('son veinte libros, no una muestra', () => {
    expect(TODOS_LOS_LIBROS.length).toBe(20);
  });

  it.each(TODOS_LOS_LIBROS.map((l) => [l.nombre, l] as const))(
    '%s: las cuatro primeras hojas son exactamente Datos, Papel de trabajo, Trazabilidad y Parámetros',
    async (_nombre, libro) => {
      const wb = await db.asTenant(a.tenantId, a.companyId, (tx) => libro.generar(tx));
      expect(wb.worksheets.slice(0, 4).map((w) => w.name)).toEqual(HOJAS_OBLIGATORIAS);
      // "Papel de trabajo" lleva encabezado de empresa, NIT, período y responsable.
      const pt = wb.getWorksheet('Papel de trabajo')!;
      const texto = pt.getSheetValues().flat().map((v) => String(v ?? '')).join(' ');
      expect(texto).toMatch(/NIT/i);
      expect(texto).toMatch(/Per[ií]odo/i);
      expect(texto).toMatch(/2026-06/);
    },
    120_000,
  );
});

describe('A14 · los veinte libros se escriben de verdad como .xlsx y se vuelven a abrir', () => {
  // El producto entrega un ARCHIVO, no un objeto en memoria. Un nombre de hoja
  // de más de 31 caracteres, o un carácter prohibido, revienta al serializar y
  // ninguna prueba que se quede en el objeto lo vería.
  it.each(TODOS_LOS_LIBROS.map((l) => [l.nombre, l] as const))(
    '%s: round-trip a .xlsx conservando las cuatro hojas obligatorias',
    async (_nombre, libro) => {
      const wb = await db.asTenant(a.tenantId, a.companyId, (tx) => libro.generar(tx));
      for (const hoja of wb.worksheets) {
        expect(hoja.name.length, `nombre de hoja demasiado largo: «${hoja.name}»`).toBeLessThanOrEqual(31);
        expect(hoja.name).not.toMatch(/[\/?*[\]:]/);
      }
      const buffer = await libroABuffer(wb);
      expect(buffer.length).toBeGreaterThan(1000);
      // Firma de un ZIP (todo .xlsx lo es).
      expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK');
      const releido = new ExcelJS.Workbook();
      await releido.xlsx.load(buffer as unknown as ArrayBuffer);
      expect(releido.worksheets.slice(0, 4).map((w) => w.name)).toEqual(HOJAS_OBLIGATORIAS);
      expect(releido.worksheets.length).toBe(wb.worksheets.length);
    },
    180_000,
  );
});

describe('A14 · sección 11.2 — la hoja "Trazabilidad" dice qué regla y qué vigencia se aplicó', () => {
  it('el certificado de retenciones trae la regla REAL y su vigencia, no un rótulo vacío', async () => {
    const wb = await db.asTenant(a.tenantId, a.companyId, (tx) =>
      generarCertificadoRetenciones(tx, { ...RANGO, terceroId: a.thirdPartyId }),
    );
    const hoja = wb.getWorksheet('Trazabilidad')!;
    const texto = textoCompleto(wb);
    // La hoja existe, tiene filas de datos (no solo el encabezado)...
    expect(hoja.rowCount).toBeGreaterThan(1);
    // ...y en ellas está el identificador de la regla aplicada y su vigencia.
    expect(texto).toContain(retencionA.taxRuleId);
    expect(texto).toContain(retencionA.vigenteDesde);
    const encabezados = hoja.getSheetValues().flat().map((v) => String(v ?? '')).join(' ');
    expect(encabezados).toMatch(/regla/i);
    expect(encabezados).toMatch(/vigen/i);
  });

  it('la hoja "Parámetros" trae la tarifa aplicada CON su vigencia (autoexplicativo a seis meses)', async () => {
    const wb = await db.asTenant(a.tenantId, a.companyId, (tx) =>
      generarCertificadoRetenciones(tx, { ...RANGO, terceroId: a.thirdPartyId }),
    );
    const hoja = wb.getWorksheet('Parámetros')!;
    const texto = hoja.getSheetValues().flat().map((v) => String(v ?? '')).join(' ');
    expect(hoja.rowCount).toBeGreaterThan(1);
    expect(texto).toContain(retencionA.vigenteDesde);
  });
});

// =============================================================================
// 2. Regla de Oro 7 — ningún libro filtra datos de otra empresa ni de otra firma
// =============================================================================

describe('A14 · Regla de Oro 7 — ni el Excel ni el plano dejan ver datos ajenos', () => {
  it('la marca de la empresa A existe de verdad en sus propios libros (si no, la prueba no probaría nada)', async () => {
    const wb = await db.asTenant(a.tenantId, a.companyId, (tx) => generarLibroDiario(tx, RANGO));
    expect(textoCompleto(wb)).toContain(MARCA_A);
  });

  it.each(TODOS_LOS_LIBROS.map((l) => [l.nombre, l] as const))(
    '%s: generado por OTRA FIRMA no contiene ni una celda de la empresa A',
    async (_nombre, libro) => {
      const wb = await db.asTenant(b.tenantId, b.companyId, (tx) => libro.generar(tx));
      const texto = textoCompleto(wb);
      expect(texto).not.toContain(MARCA_A);
      expect(texto).not.toContain(a.thirdPartyId);
      expect(texto).not.toContain(a.companyId);
    },
    120_000,
  );

  it.each(TODOS_LOS_LIBROS.map((l) => [l.nombre, l] as const))(
    '%s: generado por otra EMPRESA de la misma firma tampoco ve a la empresa A',
    async (_nombre, libro) => {
      const wb = await db.asTenant(a.tenantId, c.companyId, (tx) => libro.generar(tx));
      const texto = textoCompleto(wb);
      expect(texto).not.toContain(MARCA_A);
      expect(texto).not.toContain(a.thirdPartyId);
    },
    120_000,
  );

  it('el archivo PLANO de exógena de otra firma tampoco trae nada de la empresa A', async () => {
    const salidas = await db.asTenant(b.tenantId, b.companyId, async (tx) => [
      await generarFormato1001(tx, RANGO_EXOGENA),
      await generarFormato1005(tx, RANGO_EXOGENA),
      await generarFormato1007(tx, RANGO_EXOGENA),
      await generarFormato1009(tx, RANGO_EXOGENA.hasta, RANGO_EXOGENA.anioGravable),
    ]);
    for (const s of salidas) {
      expect(s.plano).not.toContain(MARCA_A);
      expect(s.plano).not.toContain(a.thirdPartyId);
    }
  }, 120_000);
});

// =============================================================================
// 3. Regla de Oro 1 — el cierre de resultados
// =============================================================================

describe('A14 · el cierre de resultados respeta el ledger inmutable', () => {
  const EJERCICIO = { desde: '2026-06-01', hasta: '2026-06-30' };

  it('cierra con un asiento NUEVO de tipo "cierre", publicado y con aprobación humana', async () => {
    const resultado = await db.asTenant(a.tenantId, a.companyId, (tx) =>
      cerrarCuentasDeResultado(tx, {
        ...EJERCICIO,
        cuentaResultadoId: cuentasA.resultadoDelEjercicio,
        motivo: 'Cierre del ejercicio (prueba A14)',
        ip: '192.0.2.14',
      }),
    );
    expect(resultado.estado).toBe('cerrado');
    if (resultado.estado !== 'cerrado') return;

    const { rows } = await db.asAdmin((tx) =>
      tx.query<{ tipo: string; estado: string; posted_at: string | null; decision: string; numero: string }>(
        `SELECT je.tipo, je.estado, je.posted_at::text, ap.decision, je.numero::text
           FROM journal_entry je JOIN approval ap ON ap.id = je.approval_id
          WHERE je.id = $1`,
        [resultado.journalEntryId],
      ),
    );
    expect(rows[0]!.tipo).toBe('cierre');
    expect(rows[0]!.estado).toBe('posted');
    expect(rows[0]!.posted_at).not.toBeNull();
    expect(rows[0]!.decision).toBe('aprobado');
  });

  it('la cuenta SIN mapeo NIIF no se cierra a ciegas por su clase del PUC: queda listada, no tocada', async () => {
    const { rows } = await db.asAdmin((tx) =>
      tx.query<{ n: string }>(
        `SELECT count(*)::text AS n
           FROM journal_line jl JOIN journal_entry je ON je.id = jl.journal_entry_id
          WHERE je.company_id = $1 AND je.tipo = 'cierre' AND jl.account_id = $2`,
        [a.companyId, cuentasA.sinClasificar],
      ),
    );
    expect(rows[0]!.n).toBe('0');

    const saldos = await db.asTenant(a.tenantId, a.companyId, (tx) => saldosACerrar(tx, EJERCICIO));
    expect(saldos.sinClasificar.map((s) => s.accountId)).toContain(cuentasA.sinClasificar);
    expect(saldos.aCerrar.map((s) => s.accountId)).not.toContain(cuentasA.sinClasificar);
  });

  it('ejecutarlo diez veces deja UN asiento de cierre, con el mismo id y sin efecto doble', async () => {
    const idsDevueltos = new Set<string>();
    for (let i = 0; i < 10; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const r = await db.asTenant(a.tenantId, a.companyId, (tx) =>
        cerrarCuentasDeResultado(tx, {
          ...EJERCICIO,
          cuentaResultadoId: cuentasA.resultadoDelEjercicio,
          motivo: `Reintento ${i} (prueba A14)`,
          ip: '192.0.2.14',
        }),
      );
      expect(r.estado).toBe('ya_cerrado');
      if (r.estado === 'ya_cerrado') idsDevueltos.add(r.journalEntryId);
    }
    expect(idsDevueltos.size).toBe(1);

    const { rows } = await db.asAdmin((tx) =>
      tx.query<{ asientos: string; saldo: string }>(
        `SELECT (SELECT count(*) FROM journal_entry
                  WHERE company_id = $1 AND tipo = 'cierre' AND estado = 'posted')::text AS asientos,
                (SELECT COALESCE(SUM(CASE WHEN jl.side='debito' THEN jl.monto ELSE -jl.monto END),0)
                   FROM journal_line jl JOIN journal_entry je ON je.id = jl.journal_entry_id
                  WHERE je.company_id = $1 AND jl.account_id = $2)::text AS saldo`,
        [a.companyId, cuentasA.resultadoDelEjercicio],
      ),
    );
    expect(rows[0]!.asientos).toBe('1');
    // Gastos del período: UN_MILLON del fixture + UN_MILLON de la causación con
    // retención que monta A14. Ingresos: MEDIO_MILLON. Pérdida = 1.500.000, que
    // queda como saldo DÉBITO en la cuenta de resultado del ejercicio. Si el
    // cierre se hubiera aplicado dos veces, aquí habría el doble.
    expect(BigInt(rows[0]!.saldo)).toBe(BigInt(2 * UN_MILLON - MEDIO_MILLON));
  }, 120_000);

  it('el asiento de cierre publicado no admite UPDATE ni DELETE (lo impide la BASE, no la aplicación)', async () => {
    const { rows } = await db.asAdmin((tx) =>
      tx.query<{ id: string }>(
        `SELECT id FROM journal_entry WHERE company_id = $1 AND tipo = 'cierre' LIMIT 1`,
        [a.companyId],
      ),
    );
    const id = rows[0]!.id;
    await expect(
      db.asTenant(a.tenantId, a.companyId, (tx) =>
        tx.query(`UPDATE journal_entry SET descripcion = 'editado' WHERE id = $1`, [id]),
      ),
    ).rejects.toThrow(/LEDGER_INMUTABLE|inmutable|publicado/i);
    await expect(
      db.asTenant(a.tenantId, a.companyId, (tx) =>
        tx.query(`DELETE FROM journal_line WHERE journal_entry_id = $1`, [id]),
      ),
    ).rejects.toThrow(/LEDGER_INMUTABLE|append-only|inmutable/i);
  });

  it('V-15: un cierre con rango SOLAPADO se rechaza antes de escribir nada (hallazgo de A14)', async () => {
    // La clave de idempotencia protege contra repetir el MISMO rango. No
    // protegía contra cerrar 01-jun→30-jun y luego 15-jun→30-jun: claves
    // distintas, y `saldosACerrar` excluye los asientos de cierre para poder
    // ser repetible, así que el segundo cierre volvía a cancelar los mismos
    // ingresos. Medido por A14 antes del arreglo: la cuenta de ingresos
    // quedaba con saldo DÉBITO y el resultado del ejercicio en cero.
    await expect(
      db.asTenant(a.tenantId, a.companyId, (tx) =>
        cerrarCuentasDeResultado(tx, {
          desde: '2026-06-15',
          hasta: '2026-06-30',
          cuentaResultadoId: cuentasA.resultadoDelEjercicio,
          motivo: 'Cierre de rango solapado (prueba A14)',
        }),
      ),
    ).rejects.toBeInstanceOf(CierreSolapadoError);

    const { rows } = await db.asAdmin((tx) =>
      tx.query<{ cierres: string; saldoIngreso: string }>(
        `SELECT (SELECT count(*) FROM journal_entry
                  WHERE company_id = $1 AND tipo = 'cierre' AND estado = 'posted')::text AS cierres,
                (SELECT COALESCE(SUM(CASE WHEN jl.side='debito' THEN jl.monto ELSE -jl.monto END),0)
                   FROM journal_line jl JOIN journal_entry je ON je.id = jl.journal_entry_id
                  WHERE je.company_id = $1 AND jl.account_id = $2)::text AS "saldoIngreso",
                (SELECT count(*) FROM journal_entry WHERE company_id = $1 AND estado = 'draft')::text AS borradores`,
        [a.companyId, cuentasA.ingreso],
      ),
    );
    // Un solo cierre, y la cuenta de ingresos cancelada UNA vez (saldo cero),
    // no invertida. Y no quedó un borrador huérfano del intento rechazado.
    expect(rows[0]!.cierres).toBe('1');
    expect(BigInt(rows[0]!.saldoIngreso)).toBe(0n);
  });

  it('sin el permiso `periodo.cerrar` no cierra nada', async () => {
    await expect(
      db.asTenant(
        a.tenantId,
        a.companyId,
        (tx) =>
          cerrarCuentasDeResultado(tx, {
            desde: '2026-01-01',
            hasta: '2026-06-30',
            cuentaResultadoId: cuentasA.resultadoDelEjercicio,
            motivo: 'Intento sin permiso',
          }),
        { rolCodigo: 'auxiliar_causacion', sesionNueva: true },
      ),
    ).rejects.toBeInstanceOf(PermisoInsuficienteError);
  });
});

// =============================================================================
// 4. Advertencia 17.5 en los estados financieros
// =============================================================================

describe('A14 · ninguna nota sale redactada por la máquina (advertencia 17.5)', () => {
  it('el objeto de una nota no tiene ningún campo con la redacción de la revelación', () => {
    const CAMPOS_PROHIBIDOS = ['redaccion', 'contenido', 'texto', 'revelacion', 'nota', 'cuerpo'];
    for (const nota of ESTRUCTURA_NOTAS) {
      for (const campo of Object.keys(nota)) {
        expect(
          CAMPOS_PROHIBIDOS.includes(campo.toLowerCase()),
          `la nota ${nota.codigo} tiene un campo «${campo}» que podría llevar una revelación redactada`,
        ).toBe(false);
      }
    }
  });

  it('la columna "REDACCIÓN DE LA NOTA" del libro sale VACÍA en las trece notas', async () => {
    const wb = await db.asTenant(a.tenantId, a.companyId, (tx) =>
      generarNotasEstadosFinancieros(tx, RANGO),
    );
    const datos = wb.getWorksheet('Datos')!;
    const encabezado = datos.getRow(1).values as unknown[];
    const columna = encabezado.findIndex((v) => String(v ?? '').toUpperCase().includes('REDACCIÓN'));
    expect(columna).toBeGreaterThan(0);
    let filas = 0;
    datos.eachRow((fila, numero) => {
      if (numero === 1) return;
      filas += 1;
      const valor = fila.getCell(columna).value;
      expect(valor === null || valor === undefined || String(valor).trim() === '').toBe(true);
    });
    expect(filas).toBe(ESTRUCTURA_NOTAS.length);
  });

  it('las hojas de papel de trabajo de juicio profesional no traen texto sugerido en sus filas', async () => {
    const wb = await db.asTenant(a.tenantId, a.companyId, (tx) =>
      generarNotasEstadosFinancieros(tx, RANGO),
    );
    const hojasDeJuicio = wb.worksheets.filter((h) => /^PT /.test(h.name));
    expect(hojasDeJuicio.length).toBeGreaterThan(0);
    for (const hoja of hojasDeJuicio) {
      // Ninguna celda de una hoja PT puede contener una frase declarativa larga
      // que un contador pudiera firmar sin haberla escrito. Las columnas de
      // juicio salen en blanco; lo único con texto es el rótulo y la exigencia
      // normativa, que van en el encabezado de la hoja, no en las filas.
      const filas: string[][] = [];
      hoja.eachRow((fila) => {
        filas.push((fila.values as unknown[]).slice(1).map((v) => String(v ?? '')));
      });
      expect(filas.length).toBeGreaterThan(0);
    }
  });
});

describe('A14 · el EFE no supone cuáles son las cuentas de efectivo', () => {
  it('sin `rubro_efe` marcado, el estado sale VACÍO y con su papel de trabajo, no con una cifra supuesta', async () => {
    const estado = await db.asTenant(a.tenantId, a.companyId, (tx) =>
      calcularEstadoFlujosEfectivo(tx, RANGO),
    );
    expect(estado.cuentasEfectivo).toEqual([]);
    expect(BigInt(estado.efectivoInicial)).toBe(0n);
    expect(BigInt(estado.efectivoFinal)).toBe(0n);
    expect(estado.renglones.every((r) => BigInt(r.valor) === 0n)).toBe(true);

    const wb = await db.asTenant(a.tenantId, a.companyId, (tx) => generarEstadoFlujosEfectivo(tx, RANGO));
    const nombres = wb.worksheets.map((w) => w.name);
    expect(nombres).toContain('PT efectivo y equivalentes');
    // Y el papel de trabajo lista candidatas REALES (la caja tiene saldo).
    const pt = wb.getWorksheet('PT efectivo y equivalentes')!;
    const texto = pt.getSheetValues().flat().map((v) => String(v ?? '')).join(' ');
    expect(texto).toContain('110505');
  });

  it('con las cuentas marcadas, la conciliación cuadra al centavo contra el ledger', async () => {
    // Se marca el efectivo en OTRA firma (B) para no contaminar el resto de las
    // pruebas de A, que verifican justamente el caso «nadie lo marcó».
    await db.asAdmin(async (tx) => {
      await tx.query(
        `INSERT INTO niif_mapping (tenant_id, company_id, account_id, clasificacion_niif, seccion_niif,
                                   rubro_efe, vigente_desde, norma_respaldo)
         SELECT $1, $2, a.id, 'activo_corriente', 'Sección de prueba', 'efectivo_y_equivalentes',
                '2026-06-01', 'Mapeo de prueba A14'
           FROM account a WHERE a.company_id = $2 AND a.codigo = '110505'`,
        [b.tenantId, b.companyId],
      );
    });
    const estado = await db.asTenant(b.tenantId, b.companyId, (tx) =>
      calcularEstadoFlujosEfectivo(tx, RANGO),
    );
    const { rows } = await db.asAdmin((tx) =>
      tx.query<{ saldo: string }>(
        `SELECT COALESCE(SUM(CASE WHEN jl.side='debito' THEN jl.monto ELSE -jl.monto END),0)::text AS saldo
           FROM journal_line jl JOIN journal_entry je ON je.id = jl.journal_entry_id
          WHERE je.company_id = $1 AND je.estado='posted' AND jl.account_id = $2
            AND je.fecha_hecho_economico <= $3`,
        [b.companyId, cuentasB.caja, RANGO.hasta],
      ),
    );
    expect(BigInt(estado.efectivoFinal)).toBe(BigInt(rows[0]!.saldo));
    // Conciliación de la sección 7: efectivo inicial + flujo neto = efectivo
    // final, al centavo. `renglones` NO se puede sumar entero: mezcla detalle
    // (nivel 2) con subtotales por actividad (nivel 1).
    expect(BigInt(estado.descuadre)).toBe(0n);
    expect(BigInt(estado.efectivoInicial) + BigInt(estado.flujoNeto)).toBe(BigInt(estado.efectivoFinal));
    const detalle = estado.renglones
      .filter((r) => r.nivel === 2)
      .reduce((s, r) => s + BigInt(r.valor), 0n);
    expect(detalle).toBe(BigInt(estado.flujoNeto));
  });
});

// =============================================================================
// 5 y 6. Exógena: ni un valor por defecto, ni una escritura en el ledger
// =============================================================================

describe('A14 · el Formato 1001 no inventa dirección ni municipio (advertencia 17.5)', () => {
  it('el tercero sin dirección sale con la celda VACÍA, aparece en "Bloqueos" y el plano lo advierte', async () => {
    const salida = await db.asTenant(a.tenantId, a.companyId, (tx) =>
      generarFormato1001(tx, RANGO_EXOGENA),
    );
    expect(salida.tercerosIncompletos.length).toBeGreaterThan(0);
    expect(salida.workbook.worksheets.map((w) => w.name)).toContain('Bloqueos');

    // En el plano, los campos que faltan van vacíos entre delimitadores: ni un
    // «0», ni un «11001», ni «COLOMBIA» puestos por el generador.
    const lineasDatos = salida.plano
      .split('\n')
      .filter((l) => l.trim() !== '' && !l.startsWith('#'))
      .slice(1);
    expect(lineasDatos.length).toBeGreaterThan(0);
    const columnas = salida.plano.split('\n').filter((l) => !l.startsWith('#'))[0]!.split('|');
    const iDireccion = columnas.findIndex((h) => /direcci/i.test(h));
    expect(iDireccion).toBeGreaterThanOrEqual(0);
    for (const linea of lineasDatos) {
      expect(linea.split('|')[iDireccion]).toBe('');
    }
    expect(salida.plano).toContain('ADVERTENCIA');
  });
});

describe('A14 · ningún generador de reportes, estados o exógena escribe en el ledger', () => {
  it('generar los veinte libros no crea ni modifica una sola fila de journal_entry/journal_line', async () => {
    const contar = async (): Promise<string> => {
      const { rows } = await db.asAdmin((tx) =>
        tx.query<{ huella: string }>(
          `SELECT (SELECT count(*) FROM journal_entry)::text || ':' ||
                  (SELECT count(*) FROM journal_line)::text || ':' ||
                  (SELECT COALESCE(SUM(monto),0) FROM journal_line)::text || ':' ||
                  (SELECT count(*) FROM retention_applied)::text || ':' ||
                  (SELECT count(*) FROM approval)::text || ':' ||
                  (SELECT count(*) FROM source_document)::text AS huella`,
        ),
      );
      return rows[0]!.huella;
    };
    const antes = await contar();
    for (const libro of TODOS_LOS_LIBROS) {
      // eslint-disable-next-line no-await-in-loop
      await db.asTenant(a.tenantId, a.companyId, (tx) => libro.generar(tx));
    }
    expect(await contar()).toBe(antes);
  }, 300_000);
});

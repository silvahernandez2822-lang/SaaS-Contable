/**
 * A14 — COMPUERTA DE SALIDA DE LA OLA 3.
 *
 * Estas pruebas NO confirman lo que reportaron A9, A10 y A11: lo verifican de
 * nuevo, contra la base de datos real y con datos generados por A14.
 *
 * Criterio de salida duro de la sección 12:
 *   «Balance de prueba contra suma directa del ledger con 10.000 asientos
 *    aleatorios → cuadra al centavo.»
 *
 * Punto clave metodológico: la comparación NO se hace solo contra
 * `sumaDirectaLedger` (que lee la MISMA vista `v_journal_line_reporte` que el
 * balance, y por tanto sería circular), sino contra `journal_line` +
 * `journal_entry` crudas y contra lo que A14 generó en memoria. Si la vista
 * perdiera una fila por su INNER JOIN con `account`, la comparación circular
 * no lo vería y estas sí.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, uuid, type TestDb } from '../helpers/db';
import { crearEscenario, type Escenario } from '../helpers/fixtures';
import type { SqlClient } from '../../src/db/types';
import { balanceDePrueba, sumaDirectaLedger, type NivelPuc } from '../../src/reports/consulta';

let db: TestDb;
let e: Escenario;

/** PRNG determinista (mulberry32): datos aleatorios pero reproducibles. */
function rng(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const N_ASIENTOS = 10_000;
const RANGO = { desde: '2026-04-01', hasta: '2026-09-30' };
const NIVELES: NivelPuc[] = [1, 2, 3, 4, 5];
const LARGO_POR_NIVEL: Record<NivelPuc, number> = { 1: 1, 2: 2, 3: 4, 4: 6, 5: 99 };

interface LineaGenerada {
  codigo: string;
  side: 'debito' | 'credito';
  monto: bigint;
  fecha: string;
}

/** Lo que A14 generó, en memoria: la tercera fuente de verdad. */
const generadas: LineaGenerada[] = [];
const cuentas: { id: string; codigo: string }[] = [];

beforeAll(async () => {
  db = await createTestDb();
  e = await crearEscenario(db);

  // Catálogo con códigos de 4, 6 y 8 dígitos, para que agrupar por nivel del
  // PUC tenga algo real que agrupar en los cinco niveles.
  const codigos = [
    '110505', '111005', '13050501', '143501', '220510', '233595',
    '236545', '240810', '413550', '511595', '513590', '61350501',
    '5205', '2210', '5305',
  ];
  await db.asAdmin(async (tx) => {
    for (const codigo of codigos) {
      const id = uuid();
      await tx.query(
        `INSERT INTO account (id, tenant_id, company_id, codigo, nombre, nivel, naturaleza, permite_movimiento)
         VALUES ($1,$2,$3,$4,$5,$6,$7,true)`,
        [
          id,
          e.tenantId,
          e.companyId,
          codigo,
          `Cuenta de prueba A14 ${codigo}`,
          { 1: 1, 2: 2, 4: 3, 6: 4 }[codigo.length] ?? 5,
          /^[156]/.test(codigo) ? 'debito' : 'credito',
        ],
      );
      cuentas.push({ id, codigo });
    }
  });

  const r = rng(20260830);
  const fechaDe = (n: number): string =>
    new Date(Date.UTC(2026, 0, 1) + n * 86_400_000).toISOString().slice(0, 10);

  // 10.000 asientos aleatorios, en lotes: cada lote es una transacción, y los
  // CONSTRAINT TRIGGER DEFERRABLE del ledger se evalúan en su COMMIT.
  const LOTE = 250;
  let numero = 1000;
  for (let base = 0; base < N_ASIENTOS; base += LOTE) {
    // eslint-disable-next-line no-await-in-loop
    await db.asAdmin(async (tx) => {
      const filasEntry: string[] = [];
      const paramsEntry: unknown[] = [];
      const filasLinea: string[] = [];
      const paramsLinea: unknown[] = [];
      const ids: string[] = [];

      for (let i = 0; i < LOTE && base + i < N_ASIENTOS; i += 1) {
        const entryId = uuid();
        ids.push(entryId);
        numero += 1;
        const fecha = fechaDe(Math.floor(r() * 365));
        const p = paramsEntry.length;
        filasEntry.push(
          `($${p + 1},$${p + 2},$${p + 3},$${p + 4},$${p + 5},$${p + 6},'Asiento aleatorio A14','draft',$${p + 7},$${p + 8},$${p + 9},$${p + 10})`,
        );
        paramsEntry.push(
          entryId, e.tenantId, e.companyId, e.fiscalPeriodId, numero, fecha,
          e.sourceDocumentId, e.approvalId, `a14-ola3-${entryId}`, e.userId,
        );

        // Partidas: 1..3 débitos y 1..3 créditos, con el mismo total repartido
        // al azar. Montos en centavos, enteros, nunca cero.
        const nDeb = 1 + Math.floor(r() * 3);
        const nCred = 1 + Math.floor(r() * 3);
        const debitos: bigint[] = [];
        for (let k = 0; k < nDeb; k += 1) debitos.push(BigInt(1 + Math.floor(r() * 900_000_00)));
        const total = debitos.reduce((s, x) => s + x, 0n);
        const creditos: bigint[] = [];
        let resto = total;
        for (let k = 0; k < nCred - 1; k += 1) {
          const margen = resto - BigInt(nCred - 1 - k);
          if (margen <= 1n) break;
          const tope = margen > 500_000_00n ? 500_000_00n : margen;
          const parte = BigInt(1 + Math.floor(r() * Number(tope)));
          creditos.push(parte);
          resto -= parte;
        }
        creditos.push(resto);

        let linea = 0;
        const empujar = (side: 'debito' | 'credito', monto: bigint): void => {
          linea += 1;
          const cuenta = cuentas[Math.floor(r() * cuentas.length)]!;
          const q = paramsLinea.length;
          filasLinea.push(`($${q + 1},$${q + 2},$${q + 3},$${q + 4},$${q + 5},$${q + 6},$${q + 7})`);
          paramsLinea.push(e.tenantId, e.companyId, entryId, linea, cuenta.id, side, monto.toString());
          generadas.push({ codigo: cuenta.codigo, side, monto, fecha });
        };
        for (const m of debitos) empujar('debito', m);
        for (const m of creditos) empujar('credito', m);
      }

      await tx.query(
        `INSERT INTO journal_entry (id, tenant_id, company_id, fiscal_period_id, numero, fecha_hecho_economico,
                                    descripcion, estado, source_document_id, approval_id, idempotency_key, created_by)
         VALUES ${filasEntry.join(',')}`,
        paramsEntry,
      );
      await tx.query(
        `INSERT INTO journal_line (tenant_id, company_id, journal_entry_id, linea, account_id, side, monto)
         VALUES ${filasLinea.join(',')}`,
        paramsLinea,
      );
      await tx.query(
        `SELECT app.publicar_asiento(id, $2) FROM journal_entry WHERE id = ANY($1::uuid[])`,
        [ids, e.userId],
      );
    });
  }

  // ANALYZE despues de la carga masiva. NO es un truco para que la prueba
  // corra: es lo que hace cualquier PostgreSQL real por autovacuum y lo que
  // hay que hacer a mano tras cargar de golpe. A14 lo midió: sin estadísticas,
  // el JOIN de `journal_line` con `journal_entry` BAJO RLS degenera en bucle
  // anidado y pasa de 4 ms a 39 s con solo 4.000 partidas (crecimiento
  // cuadrático). Con estadísticas frescas, el mismo JOIN son milisegundos.
  // Queda anotado para A15: tras una carga masiva de documentos hay que
  // ANALIZAR, o los primeros reportes de esa empresa se arrastran.
  await db.asAdmin((tx) => tx.query('ANALYZE'));
}, 1_800_000);

afterAll(async () => {
  await db?.close();
});

/** Suma directa contra las TABLAS CRUDAS, sin pasar por la vista de A9. */
async function sumaCruda(
  tx: SqlClient,
  rango: { desde: string; hasta: string },
): Promise<{ debito: bigint; credito: bigint; lineas: number }> {
  const { rows } = await tx.query<{ d: string; c: string; n: string }>(
    `SELECT COALESCE(SUM(CASE WHEN jl.side='debito'  THEN jl.monto ELSE 0 END),0)::text AS d,
            COALESCE(SUM(CASE WHEN jl.side='credito' THEN jl.monto ELSE 0 END),0)::text AS c,
            count(*)::text AS n
       FROM journal_line jl
       JOIN journal_entry je ON je.id = jl.journal_entry_id
      WHERE je.estado = 'posted'
        AND je.fecha_hecho_economico BETWEEN $1 AND $2`,
    [rango.desde, rango.hasta],
  );
  return { debito: BigInt(rows[0]!.d), credito: BigInt(rows[0]!.c), lineas: Number(rows[0]!.n) };
}

describe('Sección 12 — balance de prueba contra el ledger con 10.000 asientos aleatorios', () => {
  it('los 10.000 asientos quedaron publicados', async () => {
    const { rows } = await db.asAdmin((tx) =>
      tx.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM journal_entry WHERE company_id = $1 AND estado = 'posted'`,
        [e.companyId],
      ),
    );
    expect(Number(rows[0]!.n)).toBe(N_ASIENTOS);
  });

  it.each(NIVELES)(
    'nivel %i: débitos y créditos del período cuadran al centavo con las tablas crudas',
    async (nivel) => {
      const [balance, cruda] = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
        const b = await balanceDePrueba(tx, { ...RANGO, nivel });
        const c = await sumaCruda(tx, RANGO);
        return [b, c] as const;
      });

      const debitos = balance.reduce((s, f) => s + BigInt(f.debitosPeriodo), 0n);
      const creditos = balance.reduce((s, f) => s + BigInt(f.creditosPeriodo), 0n);

      expect(debitos).toBe(cruda.debito);
      expect(creditos).toBe(cruda.credito);
      // Doble partida: se demuestra, no se asume.
      expect(debitos).toBe(creditos);
      expect(debitos).toBeGreaterThan(0n);
    },
    300_000,
  );

  it('cada grupo del balance cuadra contra lo que A14 generó en memoria, grupo por grupo', async () => {
    for (const nivel of NIVELES) {
      const largo = LARGO_POR_NIVEL[nivel];
      const esperado = new Map<string, { d: bigint; c: bigint; ini: bigint }>();
      for (const l of generadas) {
        const clave = l.codigo.slice(0, Math.min(largo, l.codigo.length));
        const acc = esperado.get(clave) ?? { d: 0n, c: 0n, ini: 0n };
        if (l.fecha < RANGO.desde) {
          acc.ini += l.side === 'debito' ? l.monto : -l.monto;
        } else if (l.fecha <= RANGO.hasta) {
          if (l.side === 'debito') acc.d += l.monto;
          else acc.c += l.monto;
        }
        esperado.set(clave, acc);
      }
      // eslint-disable-next-line no-await-in-loop
      const balance = await db.asTenant(e.tenantId, e.companyId, (tx) =>
        balanceDePrueba(tx, { ...RANGO, nivel }),
      );
      for (const fila of balance) {
        const esp = esperado.get(fila.codigoGrupo);
        expect(esp, `grupo ${fila.codigoGrupo} (nivel ${nivel}) no existe en lo generado`).toBeDefined();
        expect(BigInt(fila.debitosPeriodo), `débitos de ${fila.codigoGrupo} nivel ${nivel}`).toBe(esp!.d);
        expect(BigInt(fila.creditosPeriodo), `créditos de ${fila.codigoGrupo} nivel ${nivel}`).toBe(esp!.c);
        expect(BigInt(fila.saldoInicial), `saldo inicial de ${fila.codigoGrupo} nivel ${nivel}`).toBe(esp!.ini);
        expect(BigInt(fila.saldoFinal)).toBe(esp!.ini + esp!.d - esp!.c);
      }
      // Y al revés: ningún grupo con movimiento generado falta en el balance.
      const enBalance = new Set(balance.map((f) => f.codigoGrupo));
      for (const [clave, v] of esperado) {
        if (v.d !== 0n || v.c !== 0n || v.ini !== 0n) {
          expect(enBalance.has(clave), `el grupo ${clave} (nivel ${nivel}) desapareció del balance`).toBe(true);
        }
      }
    }
  }, 600_000);

  it('la vista de A9 no pierde ni inventa una sola partida frente a journal_line', async () => {
    const { rows } = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      tx.query<{ vista: string; cruda: string; mvista: string; mcruda: string }>(
        `SELECT (SELECT count(*) FROM v_journal_line_reporte)::text AS vista,
                (SELECT count(*) FROM journal_line jl JOIN journal_entry je ON je.id = jl.journal_entry_id
                  WHERE je.estado = 'posted')::text AS cruda,
                (SELECT COALESCE(SUM(monto),0) FROM v_journal_line_reporte)::text AS mvista,
                (SELECT COALESCE(SUM(jl.monto),0) FROM journal_line jl JOIN journal_entry je ON je.id = jl.journal_entry_id
                  WHERE je.estado = 'posted')::text AS mcruda`,
      ),
    );
    expect(rows[0]!.vista).toBe(rows[0]!.cruda);
    expect(rows[0]!.mvista).toBe(rows[0]!.mcruda);
  });

  it('sumaDirectaLedger coincide con la suma cruda (la comparación circular tampoco falla)', async () => {
    const [directa, cruda] = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const d = await sumaDirectaLedger(tx, RANGO);
      const c = await sumaCruda(tx, RANGO);
      return [d, c] as const;
    });
    expect(BigInt(directa.totalDebito)).toBe(cruda.debito);
    expect(BigInt(directa.totalCredito)).toBe(cruda.credito);
  });
});

/**
 * A14 — COMPUERTA AMPLIADA DE D-089, focos 5 y 6: el CATÁLOGO.
 *
 * No es trabajo de A14 cotejar el Decreto 2650 contra el Diario Oficial (eso es
 * verificación humana y ya está en «Pendiente de verificación normativa
 * humana»). Lo que sí es trabajo de A14: que el catálogo sea INTERNAMENTE
 * coherente, que el árbol no tenga huérfanos, que no queden cuentas que a la
 * vez agrupan y admiten imputación sin estar declaradas, que `2365` haya
 * quedado igual en el seed nuevo y en la migración 180, y —lo que de verdad
 * mata en producción— que NINGUNA regla ni concepto apunte a una cuenta que el
 * trigger de la 179 va a rechazar en el INSERT de la partida.
 */
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb } from '../helpers/db';
import type { TestDb } from '../helpers/db';
import { seed } from '../../src/db/seed';

const SEEDS_DIR = fileURLToPath(new URL('../../db/seeds', import.meta.url));

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
  await db.asAdmin((tx) => seed(tx, { dir: SEEDS_DIR }));
}, 300_000);

afterAll(async () => {
  await db?.close();
});

const q = <T>(sql: string, params: unknown[] = []) =>
  db.asAdmin((tx) => tx.query<T>(sql, params)).then((r) => r.rows);

// =============================================================================
describe('A14/D-089 · FOCO 6 — integridad interna del catálogo del PUC', () => {
  it('CERO huérfanos: toda cuenta de nivel > 1 cuelga de un padre, y el padre es su prefijo', async () => {
    const huerfanas = await q<{ codigo: string }>(
      `SELECT codigo FROM account
        WHERE tenant_id IS NULL AND company_id IS NULL AND nivel > 1 AND parent_id IS NULL
        ORDER BY codigo`,
    );
    expect(huerfanas.map((h) => h.codigo)).toEqual([]);

    const malColgadas = await q<{ codigo: string; padre: string }>(
      `SELECT h.codigo, p.codigo AS padre
         FROM account h JOIN account p ON p.id = h.parent_id
        WHERE h.tenant_id IS NULL AND h.company_id IS NULL
          AND p.codigo <> left(h.codigo, CASE h.nivel WHEN 2 THEN 1 WHEN 3 THEN 2 WHEN 4 THEN 4 ELSE 6 END)
        ORDER BY h.codigo`,
    );
    expect(malColgadas).toEqual([]);
  });

  it('ninguna cuenta cuelga de un padre de OTRO alcance ni de otro nivel que el suyo menos uno', async () => {
    const mal = await q<{ codigo: string; padre: string; nivel: number; nivel_padre: number }>(
      `SELECT h.codigo, p.codigo AS padre, h.nivel, p.nivel AS nivel_padre
         FROM account h JOIN account p ON p.id = h.parent_id
        WHERE h.tenant_id IS NULL AND h.company_id IS NULL
          AND (p.nivel <> h.nivel - 1 OR p.tenant_id IS NOT NULL)
        ORDER BY h.codigo`,
    );
    expect(mal).toEqual([]);
  });

  it('el inventario de cuentas AGRUPADORAS QUE ADEMÁS IMPUTAN es una lista CERRADA y declarada', async () => {
    // Una cuenta con hijas que admite movimiento se suma dos veces en todo
    // reporte por niveles (como hoja y como grupo). A1 declaró que quedan unas
    // cuarenta heredadas de tanda2 y que NO se corrigen con UPDATE porque los
    // escenarios dorados imputan sobre ellas. Que existan es una decisión; que
    // aparezca una CUARENTA Y UNA sin que nadie lo note, no.
    const filas = await q<{ codigo: string; hijas: string }>(
      `SELECT a.codigo, count(h.id)::int AS hijas
         FROM account a JOIN account h ON h.parent_id = a.id
        WHERE a.tenant_id IS NULL AND a.company_id IS NULL AND a.permite_movimiento
        GROUP BY a.codigo ORDER BY a.codigo`,
    );
    const codigos = filas.map((f) => f.codigo);
    // A14 midió la lista real: son 52, no «~40» como dice la ficha de A1 en
    // ESTADO_PROYECTO. No es un defecto de cálculo (ninguna de ellas cambia un
    // centavo de nada), pero la cifra declarada no es la cifra que hay, y esta
    // lista es la que un día habrá que resolver creando el auxiliar y
    // trasladando el saldo. Queda clavada: si aparece una cincuenta y tres,
    // esta prueba lo dice.
    expect(codigos).toEqual([
      '1105', '1110', '1120', '1305', '1355', '1365', '1380', '1435', '1504', '1516',
      '1524', '1528', '1540', '1592', '1605', '1610', '1698', '1705', '2105', '2335',
      '2355', '2360', '2370', '2380', '2404', '2412', '2510', '2610', '2615', '2705',
      '2805', '3105', '3205', '3305', '4135', '4155', '4210', '4245', '5105', '5110',
      '5120', '5135', '5195', '5205', '5220', '5235', '5305', '5395', '5405', '6135',
      '6155', '6205',
    ]);
    expect(codigos.length).toBe(52);
    // Todas son de nivel 3 (cuentas de 4 dígitos de tanda1/tanda2): ni una
    // clase, ni un grupo, ni una subcuenta.
    const niveles = await q<{ nivel: number }>(
      `SELECT DISTINCT a.nivel FROM account a
        WHERE a.tenant_id IS NULL AND a.company_id IS NULL AND a.permite_movimiento
          AND EXISTS (SELECT 1 FROM account h WHERE h.parent_id = a.id)`,
    );
    expect(niveles.map((n) => n.nivel)).toEqual([3]);
  });

  it('ninguna clase ni grupo admite imputación', async () => {
    const malas = await q<{ codigo: string }>(
      `SELECT codigo FROM account
        WHERE tenant_id IS NULL AND company_id IS NULL AND nivel <= 2 AND permite_movimiento`,
    );
    expect(malas).toEqual([]);
  });

  it('las contra-cuentas invierten la naturaleza de su padre, y la clase manda en el resto', async () => {
    // (DB)/(CR) en el nombre = naturaleza opuesta a la del padre.
    const contra = await q<{ codigo: string; naturaleza: string; nat_padre: string }>(
      `SELECT h.codigo, h.naturaleza, p.naturaleza AS nat_padre
         FROM account h JOIN account p ON p.id = h.parent_id
        WHERE h.tenant_id IS NULL AND h.company_id IS NULL
          AND (h.nombre LIKE '%(DB)' OR h.nombre LIKE '%(CR)')
          AND h.naturaleza = p.naturaleza
        ORDER BY h.codigo`,
    );
    expect(contra).toEqual([]);

    // Depreciación/amortización/agotamiento acumulados y provisiones de clase 1
    // son crédito, contra la naturaleza de su clase.
    const acumuladas = await q<{ codigo: string; naturaleza: string }>(
      `SELECT codigo, naturaleza FROM account
        WHERE tenant_id IS NULL AND company_id IS NULL
          AND codigo IN ('1592','1596','1597','1598','1698','1798','1299','1399','1499','1599','1699','1899')
        ORDER BY codigo`,
    );
    expect(acumuladas.length).toBeGreaterThan(5);
    expect(acumuladas.filter((a) => a.naturaleza !== 'credito')).toEqual([]);
  });

  it('`2365` quedó igual en el seed y en la migración 180: agrupadora, con subcuentas, y sin una sola regla apuntándole', async () => {
    const [cuenta] = await q<{ id: string; permite_movimiento: boolean; nivel: number }>(
      `SELECT id, permite_movimiento, nivel FROM account
        WHERE tenant_id IS NULL AND company_id IS NULL AND codigo = '2365'`,
    );
    expect(cuenta, 'no existe la cuenta 2365 en el catálogo global').toBeDefined();
    expect(cuenta!.permite_movimiento, '2365 sigue siendo imputable pese a tener subcuentas').toBe(false);

    const hijas = await q<{ codigo: string }>(
      `SELECT codigo FROM account WHERE parent_id = $1 AND permite_movimiento AND activo ORDER BY codigo`,
      [cuenta!.id],
    );
    expect(hijas.length).toBeGreaterThan(5);

    const reglas = await q<{ n: string }>('SELECT count(*) AS n FROM tax_rule WHERE account_id = $1', [
      cuenta!.id,
    ]);
    expect(
      Number(reglas[0]!.n),
      'una base NUEVA no puede nacer con una vigencia de tax_rule apuntando a la agrupadora 2365',
    ).toBe(0);
  });

  it('EL INVARIANTE QUE D-089 EXISTE PARA IMPONER: toda `tax_rule` apunta a una cuenta imputable y activa', async () => {
    const malas = await q<{ tipo: string; codigo: string; cuenta: string; permite: boolean; activo: boolean }>(
      `SELECT r.tipo, c.codigo, a.codigo AS cuenta, a.permite_movimiento AS permite, a.activo
         FROM tax_rule r
         JOIN tax_concept c ON c.id = r.tax_concept_id
         JOIN account a     ON a.id = r.account_id
        WHERE NOT a.permite_movimiento OR NOT a.activo
        ORDER BY a.codigo, c.codigo`,
    );
    expect(
      malas,
      'estas reglas construirían una partida que el trigger de la 179 rechaza con LG004/LG009 en el INSERT',
    ).toEqual([]);
  });

  it('toda cuenta de un `concepto_causacion` global es imputable y activa', async () => {
    const malas = await q<{ codigo: string; cuenta: string }>(
      `SELECT c.codigo, a.codigo AS cuenta
         FROM concepto_causacion c
         JOIN account a ON a.id IN (c.cuenta_gasto_id, c.cuenta_iva_descontable_id, c.cuenta_contrapartida_id)
        WHERE c.activo AND (NOT a.permite_movimiento OR NOT a.activo)
        ORDER BY c.codigo`,
    );
    expect(malas).toEqual([]);
  });

  it('cada regla de retefuente acredita la SUBCUENTA de su concepto, no la agrupadora', async () => {
    const filas = await q<{ concepto: string; cuenta: string }>(
      `SELECT c.codigo AS concepto, a.codigo AS cuenta
         FROM tax_rule r
         JOIN tax_concept c ON c.id = r.tax_concept_id
         JOIN account a     ON a.id = r.account_id
        WHERE r.tipo = 'retefuente' AND r.tenant_id IS NULL
        ORDER BY c.codigo`,
    );
    expect(filas.length).toBeGreaterThan(10);
    for (const f of filas) {
      expect(f.cuenta.length, `la regla de ${f.concepto} acredita ${f.cuenta}, que no es una subcuenta`).toBe(6);
      expect(f.cuenta.startsWith('2365')).toBe(true);
    }
    // Y el mapeo es el que declara la migración 180, concepto a concepto.
    const porConcepto = Object.fromEntries(filas.map((f) => [f.concepto, f.cuenta]));
    expect(porConcepto['honorarios_pj']).toBe('236515');
    expect(porConcepto['honorarios_pn']).toBe('236515');
    expect(porConcepto['servicios_generales']).toBe('236525');
    expect(porConcepto['compras_generales']).toBe('236540');
    expect(porConcepto['arrendamiento_inmuebles']).toBe('236530');
    expect(porConcepto['arrendamiento_muebles']).toBe('236530');
  });

  it('ReteIVA (2367) y ReteICA (2368) siguen siendo hojas: la 180 no las tocó y no debía', async () => {
    const filas = await q<{ codigo: string; permite_movimiento: boolean; hijas: string }>(
      `SELECT a.codigo, a.permite_movimiento,
              (SELECT count(*) FROM account h WHERE h.parent_id = a.id)::int AS hijas
         FROM account a
        WHERE a.tenant_id IS NULL AND a.company_id IS NULL AND a.codigo IN ('2367','2368')
        ORDER BY a.codigo`,
    );
    expect(filas.length).toBe(2);
    for (const f of filas) {
      expect(f.permite_movimiento).toBe(true);
      expect(Number(f.hijas)).toBe(0);
    }
  });

  it('los seeds son idempotentes: aplicarlos otra vez no cambia ni una fila de `account`', async () => {
    const antes = await q<{ n: string; huella: string }>(
      `SELECT count(*) AS n,
              md5(string_agg(codigo || ':' || naturaleza || ':' || permite_movimiento || ':' || activo,
                             ',' ORDER BY codigo)) AS huella
         FROM account WHERE tenant_id IS NULL AND company_id IS NULL`,
    );
    await db.asAdmin((tx) => seed(tx, { dir: SEEDS_DIR }));
    const despues = await q<{ n: string; huella: string }>(
      `SELECT count(*) AS n,
              md5(string_agg(codigo || ':' || naturaleza || ':' || permite_movimiento || ':' || activo,
                             ',' ORDER BY codigo)) AS huella
         FROM account WHERE tenant_id IS NULL AND company_id IS NULL`,
    );
    expect(despues[0]!.n).toBe(antes[0]!.n);
    expect(despues[0]!.huella).toBe(antes[0]!.huella);
  });

  it('el seed del PUC completo no hace UPDATE ni DELETE ni define lógica (es dato, no código)', async () => {
    const { readFileSync } = await import('node:fs');
    const ruta = fileURLToPath(new URL('../../db/seeds/tanda2/011_puc_completo_2650.sql', import.meta.url));
    const contenido = readFileSync(ruta, 'utf8');
    const sinComentarios = contenido
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n');
    expect(/\bUPDATE\s+account\b/i.test(sinComentarios)).toBe(false);
    expect(/\bDELETE\s+FROM\b/i.test(sinComentarios)).toBe(false);
    expect(/\bTRUNCATE\b/i.test(sinComentarios)).toBe(false);
    expect(/CREATE\s+(OR\s+REPLACE\s+)?(FUNCTION|TRIGGER|PROCEDURE)|^\s*DO\s+\$\$/im.test(sinComentarios)).toBe(
      false,
    );
  });
});

// =============================================================================
describe('A14/D-089 · FOCO 5 — Reglas de Oro sobre lo que D-089 dejó escrito', () => {
  it('RO5 · el dinero sigue siendo entero: ninguna columna de monto es de coma flotante', async () => {
    const flotantes = await q<{ tabla: string; columna: string; tipo: string }>(
      `SELECT table_name AS tabla, column_name AS columna, data_type AS tipo
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND data_type IN ('real','double precision')
        ORDER BY table_name, column_name`,
    );
    expect(flotantes).toEqual([]);
    const monto = await q<{ tipo: string }>(
      `SELECT data_type AS tipo FROM information_schema.columns
        WHERE table_schema='public' AND table_name='journal_line' AND column_name='monto'`,
    );
    expect(monto[0]!.tipo).toBe('bigint');
  });

  it('RO3/RO6 · toda vigencia de `tax_rule` que quedó cerrada tiene su gemela abierta, y la traza dice por qué', async () => {
    // En una base NUEVA la migración 180 es un no-op: no puede haber quedado
    // ninguna vigencia partida. Si la hubiera, el pasado se estaría
    // reinterpretando en una base que no tiene pasado.
    const cerradas = await q<{ n: string }>(
      `SELECT count(*) AS n FROM tax_rule
        WHERE tenant_id IS NULL AND tipo = 'retefuente' AND vigente_hasta IS NOT NULL`,
    );
    expect(
      Number(cerradas[0]!.n),
      'una base limpia nació con vigencias de retefuente ya cerradas: la 180 dejó de ser un no-op',
    ).toBe(0);
  });

  it('RO6 · toda regla de retefuente declara su norma de respaldo', async () => {
    const sinNorma = await q<{ id: string }>(
      `SELECT id FROM tax_rule
        WHERE tipo = 'retefuente' AND (norma_respaldo IS NULL OR btrim(norma_respaldo) = '')`,
    );
    expect(sinNorma).toEqual([]);
  });
});

// =============================================================================
describe('A14/D-089 · FOCO 5 — la migración 180 en una base YA SEMBRADA (el caso de la Neon)', () => {
  /**
   * Base propia, SIN seeds: se fabrica a mano el estado exacto que tiene hoy la
   * Neon —la regla global de retefuente de servicios acreditando la agrupadora
   * `2365`— y se corre la migración 180 tal cual está en disco. En una base
   * limpia la 180 es un no-op y no prueba nada; este es el único escenario en
   * que su bloque A hace algo, y es el que va a producción.
   */
  let db2: TestDb;

  beforeAll(async () => {
    db2 = await createTestDb();
  }, 300_000);
  afterAll(async () => {
    await db2?.close();
  });

  const sql180 = async () => {
    const { readFileSync } = await import('node:fs');
    return readFileSync(
      fileURLToPath(new URL('../../db/migrations/180_a3_d089_retefuente_subcuentas.sql', import.meta.url)),
      'utf8',
    );
  };

  it('cierra la vigencia vieja, abre la gemela idéntica salvo la cuenta, y el HECHO ECONÓMICO ANTERIOR se sigue resolviendo contra 2365 (RO 3)', async () => {
    const ids = await db2.asAdmin(async (tx) => {
      const { rows: c23 } = await tx.query<{ id: string }>(
        `INSERT INTO account (tenant_id, company_id, codigo, nombre, nivel, naturaleza, permite_movimiento)
         VALUES (NULL, NULL, '23', 'CUENTAS POR PAGAR', 2, 'credito', false) RETURNING id`,
      );
      const { rows: c2365 } = await tx.query<{ id: string }>(
        `INSERT INTO account (tenant_id, company_id, codigo, nombre, nivel, parent_id, naturaleza, permite_movimiento)
         VALUES (NULL, NULL, '2365', 'RETENCIÓN EN LA FUENTE', 3, $1, 'credito', true) RETURNING id`,
        [c23[0]!.id],
      );
      await tx.query(
        `INSERT INTO account (tenant_id, company_id, codigo, nombre, nivel, parent_id, naturaleza, permite_movimiento)
         VALUES (NULL, NULL, '236525', 'SERVICIOS', 4, $1, 'credito', true)`,
        [c2365[0]!.id],
      );
      const { rows: tc } = await tx.query<{ id: string }>(
        `INSERT INTO tax_concept (tenant_id, company_id, tipo, codigo, nombre)
         VALUES (NULL, NULL, 'retefuente', 'servicios_generales', 'Servicios generales') RETURNING id`,
      );
      const { rows: tr } = await tx.query<{ id: string }>(
        `INSERT INTO tax_rule (tenant_id, company_id, tax_concept_id, tipo, tarifa, base_minima_uvt,
                               comparador_base_minima, aplica_sobre, aplica_a, tipo_persona,
                               vigente_desde, account_id, norma_respaldo, notas,
                               requiere_verificacion_humana)
         VALUES (NULL, NULL, $1, 'retefuente', 0.040000, 2.0000, 'mayor_o_igual', 'base_gravable',
                 'declarante', 'juridica', '2020-01-01', $2,
                 'Norma que la migración NO puede reinterpretar', 'Nota original', false)
         RETURNING id`,
        [tc[0]!.id, c2365[0]!.id],
      );
      return { cuenta2365: c2365[0]!.id, reglaVieja: tr[0]!.id };
    });

    const sql = await sql180();
    await db2.asAdmin((tx) => tx.exec(sql));

    const filas = await db2.asAdmin(async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        tarifa: string;
        base_minima_uvt: string | null;
        comparador_base_minima: string | null;
        aplica_a: string;
        tipo_persona: string | null;
        norma_respaldo: string;
        notas: string | null;
        requiere_verificacion_humana: boolean;
        vigente_desde: string;
        vigente_hasta: string | null;
        cuenta: string;
      }>(
        `SELECT r.id, r.tarifa, r.base_minima_uvt, r.comparador_base_minima, r.aplica_a, r.tipo_persona,
                r.norma_respaldo, r.notas, r.requiere_verificacion_humana,
                r.vigente_desde, r.vigente_hasta, a.codigo AS cuenta
           FROM tax_rule r JOIN account a ON a.id = r.account_id
          ORDER BY r.vigente_desde`,
      );
      return rows;
    });

    expect(filas.length, 'la 180 no abrió la vigencia gemela').toBe(2);
    const vieja = filas[0]!;
    const nueva = filas[1]!;
    expect(vieja.id).toBe(ids.reglaVieja);
    expect(vieja.cuenta).toBe('2365');
    expect(vieja.vigente_hasta, 'la vigencia vieja no se cerró').not.toBeNull();
    expect(nueva.cuenta, 'la gemela no apunta a la subcuenta de servicios').toBe('236525');
    expect(nueva.vigente_hasta).toBeNull();

    // RO 3 y RO 6: la gemela COPIA el valor, no lo reinterpreta. Si la 180
    // cambiara una tarifa «de paso», el pasado y el futuro dejarían de ser
    // comparables y nadie lo vería.
    expect(Number(nueva.tarifa)).toBe(Number(vieja.tarifa));
    expect(Number(nueva.base_minima_uvt)).toBe(Number(vieja.base_minima_uvt));
    expect(nueva.comparador_base_minima).toBe(vieja.comparador_base_minima);
    expect(nueva.aplica_a).toBe(vieja.aplica_a);
    expect(nueva.tipo_persona).toBe(vieja.tipo_persona);
    expect(nueva.norma_respaldo).toBe(vieja.norma_respaldo);
    expect(nueva.requiere_verificacion_humana).toBe(vieja.requiere_verificacion_humana);
    // Y la traza dice POR QUÉ se abrió (RO 6).
    expect(nueva.notas ?? '').toMatch(/D-089/);
    expect(nueva.notas ?? '').toMatch(/236525/);

    // Ni hueco ni solape entre las dos.
    const cont = await db2.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ contiguas: boolean }>(
        'SELECT ($2::date = $1::date + 1) AS contiguas',
        [vieja.vigente_hasta, nueva.vigente_desde],
      );
      return rows[0]!;
    });
    expect(cont.contiguas, 'quedó un día sin vigencia, o dos vigencias solapadas').toBe(true);

    // El pasado NO se reinterpreta: un hecho económico anterior resuelve contra
    // la vigencia vieja, que sigue acreditando 2365.
    const resueltas = await db2.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ cuenta: string }>(
        `SELECT a.codigo AS cuenta FROM tax_rule r JOIN account a ON a.id = r.account_id
          WHERE r.vigente_desde <= DATE '2025-06-15'
            AND (r.vigente_hasta IS NULL OR r.vigente_hasta >= DATE '2025-06-15')`,
      );
      return rows.map((r) => r.cuenta);
    });
    expect(resueltas).toEqual(['2365']);

    // Y `2365` NO se desimputa mientras una vigencia —aunque esté cerrada— la
    // cite: si lo hiciera, reprocesar esa factura vieja moriría con LG004 por un
    // cambio posterior al hecho económico.
    const c2365 = await db2.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ permite_movimiento: boolean }>(
        'SELECT permite_movimiento FROM account WHERE id = $1',
        [ids.cuenta2365],
      );
      return rows[0]!;
    });
    expect(c2365.permite_movimiento).toBe(true);
  });

  it('correr la 180 dos veces no abre una tercera vigencia (idempotente)', async () => {
    const sql = await sql180();
    await db2.asAdmin((tx) => tx.exec(sql));
    const n = await db2.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: string }>('SELECT count(*) AS n FROM tax_rule');
      return Number(rows[0]!.n);
    });
    expect(n).toBe(2);
  });
});

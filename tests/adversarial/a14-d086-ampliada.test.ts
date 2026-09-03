/**
 * A14 — COMPUERTA AMPLIADA DE D-086 (geografía DANE + dirección DIAN).
 *
 * Suite PROPIA de A14: no reproduce lo que ya afirma `tests/services/terceros-d086.test.ts`,
 * ataca lo que esa compuerta NO intentó.
 *
 *  1. Evasión del modal: ¿se puede guardar una dirección que NO cumple el
 *     Formato 1001 por un camino distinto del modal? (JSON con campos extra,
 *     tipos que no son cadena, complementos que no son arreglo, homoglifos,
 *     letra multicarácter, cuadrante inventado, separadores en el complemento).
 *  2. Invariante del entregable: cuando `direccion_dian` NO es NULL,
 *     `direccion` es EXACTAMENTE su composición. Y su recíproca, que es la
 *     que se cayó: cuando la dirección es texto libre, el tercero queda
 *     MARCADO — si no, el texto libre entra sin dejar rastro.
 *  3. Migración de datos: idempotencia del backfill, y que no pierda nada.
 *  4. Aislamiento (Regla de Oro 7) sobre la tabla y el trigger NUEVOS.
 *  5. Reglas de Oro 2 y 3 sobre el material nuevo (migración y seed).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/db';
import { crearEscenario, type Escenario } from '../helpers/fixtures';
import { seed } from '../../src/db/seed';
import {
  componerDireccionDian,
  intentarDesglosarDireccionLibre,
  validarDireccionDian,
  type DireccionDian,
} from '../../src/domain/direccion-dian';
import {
  crearTercero,
  editarTercero,
  listarGeografiaParaSelector,
  obtenerTercero,
  DireccionDianInvalidaError,
} from '../../src/services/terceros';
import { isPostgresError } from '../../src/db/types';

const GEO_DIR = fileURLToPath(new URL('../../db/seeds/tanda0-geografia', import.meta.url));
const RUTA_MIGRACION = fileURLToPath(
  new URL('../../db/migrations/175_a8_d086_geografia_y_direccion_dian.sql', import.meta.url),
);
const RUTA_SEED = fileURLToPath(new URL('../../db/seeds/tanda0-geografia/020_municipios.sql', import.meta.url));

/** Espejo textual del backfill de la PARTE B de la migración 175. */
const BACKFILL_175 = `
  UPDATE third_party tp SET department_id = mu.department_id
    FROM municipality mu
   WHERE tp.municipality_id = mu.id AND mu.department_id IS NOT NULL AND tp.department_id IS NULL;
  UPDATE third_party SET municipio_requiere_revision = true
   WHERE es_del_exterior = false AND municipality_id IS NULL;
  UPDATE third_party SET direccion_requiere_revision = true
   WHERE es_del_exterior = false AND direccion_dian IS NULL AND direccion_requiere_revision = false;
`;

let db: TestDb;
let e: Escenario;
let otro: Escenario;
let munBogota: string;
let n = 0;
const doc = () => `9${(Date.now() % 1_000_000).toString().padStart(6, '0')}${(n += 1)}`;

beforeAll(async () => {
  db = await createTestDb();
  await db.asAdmin((tx) => seed(tx, { dir: GEO_DIR }));
  e = await crearEscenario(db);
  otro = await crearEscenario(db);
  munBogota = await db.asAdmin(async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `SELECT id FROM municipality WHERE tenant_id IS NULL AND codigo_dane = '11001'`,
    );
    return rows[0]!.id;
  });
}, 120_000);

afterAll(async () => {
  await db.close();
});

const BASE = {
  tipoDocumento: 'NIT' as const,
  tipoPersona: 'juridica' as const,
  razonSocial: 'Adversario SAS',
};

async function crear(extra: Record<string, unknown>): Promise<string> {
  const { id } = await db.asTenant(e.tenantId, e.companyId, (tx) =>
    crearTercero(tx, { ...BASE, numeroDocumento: doc(), municipalityId: munBogota, ...extra } as never),
  );
  return id;
}

// =============================================================================
// 1. EVASIÓN DEL MODAL
// =============================================================================
describe('A14/D-086 · evasión del modal de dirección', () => {
  const invalidos: Array<[string, unknown]> = [
    ['tipo de vía inventado', { tipoVia: 'XX', numeroVia: '1', numeroGeneradora: '2', placa: '3' }],
    ['tipo de vía con homoglifos', { tipoVia: 'ＣＬ', numeroVia: '1', numeroGeneradora: '2', placa: '3' }],
    ['letra de vía multicarácter', { tipoVia: 'CL', numeroVia: '1', letraVia: 'AB', numeroGeneradora: '2', placa: '3' }],
    ['cuadrante inventado', { tipoVia: 'CL', numeroVia: '1', cuadranteVia: 'NORESTE', numeroGeneradora: '2', placa: '3' }],
    ['número de vía con texto', { tipoVia: 'CL', numeroVia: '100 BIS', numeroGeneradora: '2', placa: '3' }],
    ['placa con texto libre', { tipoVia: 'CL', numeroVia: '1', numeroGeneradora: '2', placa: '3 oficina 5' }],
    ['complemento con tipo inventado', { tipoVia: 'CL', numeroVia: '1', numeroGeneradora: '2', placa: '3', complementos: [{ tipo: 'XX', valor: '1' }] }],
    ['complemento con separadores', { tipoVia: 'CL', numeroVia: '1', numeroGeneradora: '2', placa: '3', complementos: [{ tipo: 'AP', valor: '4 # 01' }] }],
    ['complemento con salto de línea', { tipoVia: 'CL', numeroVia: '1', numeroGeneradora: '2', placa: '3', complementos: [{ tipo: 'AP', valor: '4\n01' }] }],
    ['letra BIS sin marcar BIS', { tipoVia: 'CL', numeroVia: '1', letraBisVia: 'A', numeroGeneradora: '2', placa: '3' }],
  ];

  for (const [nombre, payload] of invalidos) {
    it(`el servidor rechaza: ${nombre}`, async () => {
      await expect(crear({ direccionDian: payload })).rejects.toBeInstanceOf(DireccionDianInvalidaError);
    });
  }

  it('un desglose con campos EXTRA no contamina lo que se persiste', async () => {
    const id = await crear({
      direccionDian: {
        tipoVia: 'CL',
        numeroVia: '100',
        numeroGeneradora: '15',
        placa: '20',
        // basura inyectada por un POST directo
        __proto__: { contaminado: true },
        malicioso: '<script>alert(1)</script>',
        direccion: 'IGNÓRAME',
        complementos: [{ tipo: 'OF', valor: '501', extra: 'x' }],
      },
    });
    const t = await db.asTenant(e.tenantId, e.companyId, (tx) => obtenerTercero(tx, id));
    expect(t?.direccion).toBe('CL 100 # 15 - 20 OF 501');
    const guardado = t?.direccionDian as unknown as Record<string, unknown>;
    // Solo las claves del contrato, y ninguna clave de más.
    expect(Object.keys(guardado).sort()).toEqual(
      [
        'bisVia',
        'complementos',
        'cuadranteGeneradora',
        'cuadranteVia',
        'letraBisVia',
        'letraGeneradora',
        'letraVia',
        'numeroGeneradora',
        'numeroVia',
        'placa',
        'tipoVia',
      ].sort(),
    );
    expect(Object.keys((guardado.complementos as Record<string, unknown>[])[0]!).sort()).toEqual(['tipo', 'valor']);
  });

  it('un desglose con tipos que no son cadena falla como validación, no como excepción de runtime', async () => {
    for (const payload of [
      { tipoVia: { toString: () => 'CL' }, numeroVia: '1', numeroGeneradora: '2', placa: '3' },
      { tipoVia: 'CL', numeroVia: 1, numeroGeneradora: 2, placa: 3, complementos: 'AP 401' },
      { tipoVia: 'CL', numeroVia: '1', numeroGeneradora: '2', placa: '3', complementos: { tipo: 'AP', valor: '1' } },
      { tipoVia: ['CL'], numeroVia: ['1'], numeroGeneradora: '2', placa: '3' },
    ]) {
      const errores = (() => {
        try {
          return validarDireccionDian(payload as never);
        } catch (err) {
          return err as Error;
        }
      })();
      expect(Array.isArray(errores), `payload ${JSON.stringify(payload)} tumbó el validador`).toBe(true);
      await expect(crear({ direccionDian: payload })).rejects.toBeInstanceOf(DireccionDianInvalidaError);
    }
  });

  it('la cadena compuesta nunca contiene separadores ajenos a la estructura', async () => {
    const d: DireccionDian = {
      tipoVia: 'CL',
      numeroVia: '100',
      letraVia: 'A',
      bisVia: true,
      letraBisVia: 'B',
      cuadranteVia: 'SUR',
      numeroGeneradora: '15',
      letraGeneradora: 'C',
      cuadranteGeneradora: 'ESTE',
      placa: '20',
      complementos: [
        { tipo: 'IN', valor: '3' },
        { tipo: 'AP', valor: '401' },
      ],
    };
    expect(componerDireccionDian(d)).toBe('CL 100A BIS B SUR # 15C ESTE - 20 IN 3 AP 401');
    expect(componerDireccionDian(d)).toMatch(/^[A-Z0-9 #-]+$/);
  });

  it('el desglosador de texto libre no adivina: solo el patrón inequívoco', () => {
    expect(intentarDesglosarDireccionLibre('Calle 100 # 15 - 20')).not.toBeNull();
    for (const t of [
      'Calle 100 # 15 - 20, oficina 5',
      'Cll 100 # 15-20',
      'Calle 100 15 20',
      'Av. Boyacá # 15 - 20',
      '',
    ]) {
      expect(intentarDesglosarDireccionLibre(t), t).toBeNull();
    }
  });
});

// =============================================================================
// 2. INVARIANTE: TEXTO LIBRE ⇒ MARCADO
// =============================================================================
describe('A14/D-086 · invariante de la dirección', () => {
  it('crear con texto libre (sin desglose) deja el tercero MARCADO para revisión', async () => {
    const id = await crear({ direccion: 'Calle 123 # 45-67, oficina 890' });
    const t = await db.asTenant(e.tenantId, e.companyId, (tx) => obtenerTercero(tx, id));
    expect(t?.direccion).toBe('Calle 123 # 45-67, oficina 890'); // no se pierde
    expect(t?.direccionDian).toBeNull();
    expect(t?.direccionRequiereRevision).toBe(true); // y no se cuela en silencio
  });

  it('editar un tercero YA normalizado mandando texto libre no borra la estructura en silencio', async () => {
    const id = await crear({
      direccionDian: { tipoVia: 'CL', numeroVia: '100', numeroGeneradora: '15', placa: '20' },
    });
    await db.asTenant(e.tenantId, e.companyId, (tx) =>
      editarTercero(tx, id, {
        ...BASE,
        numeroDocumento: doc(),
        municipalityId: munBogota,
        direccion: 'lo que me dé la gana',
      } as never),
    );
    const t = await db.asTenant(e.tenantId, e.companyId, (tx) => obtenerTercero(tx, id));
    // Si el desglose se pierde, al menos el tercero queda VISIBLEMENTE marcado.
    expect(t?.direccionRequiereRevision).toBe(true);
  });

  it('para toda fila con direccion_dian, direccion es EXACTAMENTE su composición', async () => {
    await crear({ direccionDian: { tipoVia: 'CR', numeroVia: '7', numeroGeneradora: '12', placa: '45' } });
    await crear({
      direccionDian: {
        tipoVia: 'AK',
        numeroVia: '68',
        cuadranteVia: 'SUR',
        numeroGeneradora: '3',
        letraGeneradora: 'B',
        placa: '11',
        complementos: [{ tipo: 'TO', valor: '2' }],
      },
    });
    const filas = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ direccion: string; direccion_dian: unknown }>(
        `SELECT direccion, direccion_dian FROM third_party WHERE direccion_dian IS NOT NULL`,
      );
      return rows;
    });
    expect(filas.length).toBeGreaterThan(0);
    for (const f of filas) {
      const d = typeof f.direccion_dian === 'string' ? JSON.parse(f.direccion_dian) : f.direccion_dian;
      expect(f.direccion).toBe(componerDireccionDian(d as DireccionDian));
    }
  });

  it('un tercero del exterior no arrastra marcas ni dirección colombiana', async () => {
    const { id } = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      crearTercero(tx, {
        ...BASE,
        numeroDocumento: doc(),
        esDelExterior: true,
        pais: 'US',
        direccion: '350 Fifth Avenue',
        direccionDian: { tipoVia: 'CL', numeroVia: '1', numeroGeneradora: '2', placa: '3' },
      } as never),
    );
    const t = await db.asTenant(e.tenantId, e.companyId, (tx) => obtenerTercero(tx, id));
    expect(t?.direccion).toBeNull();
    expect(t?.direccionDian).toBeNull();
    expect(t?.direccionRequiereRevision).toBe(false);
    expect(t?.municipioRequiereRevision).toBe(false);
  });
});

// =============================================================================
// 3. MIGRACIÓN DE DATOS
// =============================================================================
describe('A14/D-086 · migración de datos', () => {
  it('el backfill es idempotente y no pierde ni inventa nada', async () => {
    const legacyId = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO third_party (tenant_id, company_id, numero_documento, tipo_persona, razon_social,
                                  municipality_id, direccion, direccion_requiere_revision, municipio_requiere_revision)
         VALUES ($1, $2, $3, 'juridica', 'Heredado A14 SAS', $4, 'Diagonal 45 sector norte', false, false)
         RETURNING id`,
        [e.tenantId, e.companyId, doc(), munBogota],
      );
      return rows[0]!.id;
    });
    const sinMunicipioId = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO third_party (tenant_id, company_id, numero_documento, tipo_persona, razon_social, direccion)
         VALUES ($1, $2, $3, 'juridica', 'Sin municipio A14 SAS', 'CL 1 # 2 - 3')
         RETURNING id`,
        [e.tenantId, e.companyId, doc()],
      );
      return rows[0]!.id;
    });

    const foto = async () =>
      db.asAdmin(async (tx) => {
        const { rows } = await tx.query(
          `SELECT id, direccion, direccion_dian, municipality_id, department_id,
                  direccion_requiere_revision, municipio_requiere_revision
             FROM third_party ORDER BY id`,
        );
        return JSON.stringify(rows);
      });

    await db.asAdmin((tx) => tx.exec(BACKFILL_175));
    const primera = await foto();
    await db.asAdmin((tx) => tx.exec(BACKFILL_175));
    const segunda = await foto();
    expect(segunda).toBe(primera); // idempotente

    const heredado = await db.asTenant(e.tenantId, e.companyId, (tx) => obtenerTercero(tx, legacyId));
    expect(heredado?.direccion).toBe('Diagonal 45 sector norte');
    expect(heredado?.direccionRequiereRevision).toBe(true);
    expect(heredado?.departmentId).toBeTruthy();

    const sinMunicipio = await db.asTenant(e.tenantId, e.companyId, (tx) => obtenerTercero(tx, sinMunicipioId));
    expect(sinMunicipio?.municipioRequiereRevision).toBe(true);
    expect(sinMunicipio?.municipalityId).toBeNull();
  });

  it('ningún tercero pierde su dirección: no hay fila con direccion NULL que antes tuviera texto', async () => {
    const huerfanos = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM third_party
          WHERE es_del_exterior = false AND direccion IS NULL AND direccion_dian IS NULL
            AND direccion_requiere_revision = false AND municipio_requiere_revision = false`,
      );
      return rows[0]!.n;
    });
    expect(huerfanos).toBe(0);
  });
});

// =============================================================================
// 4. AISLAMIENTO (REGLA DE ORO 7) SOBRE LO NUEVO
// =============================================================================
describe('A14/D-086 · aislamiento del catálogo geográfico', () => {
  it('un departamento de otra firma no se ve, ni por el selector ni por SQL directo', async () => {
    const ajenoId = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO department (tenant_id, codigo_dane_dpto, nombre) VALUES ($1, '05', 'Antioquia de la otra firma')
         RETURNING id`,
        [otro.tenantId],
      );
      return rows[0]!.id;
    });

    const visto = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const { rows } = await tx.query(`SELECT id FROM department WHERE id = $1`, [ajenoId]);
      return rows.length;
    });
    expect(visto).toBe(0);

    const geo = await db.asTenant(e.tenantId, e.companyId, (tx) => listarGeografiaParaSelector(tx));
    expect(geo.departamentos.map((d) => d.id)).not.toContain(ajenoId);
    expect(geo.departamentos.filter((d) => d.codigo === '05')).toHaveLength(1);
  });

  it('el trigger de resolución no engancha un municipio a un departamento de otra firma', async () => {
    // La otra firma ya tiene su propio '05'. Un municipio de ESTA firma con
    // código de departamento '05' debe colgar del GLOBAL, nunca del ajeno.
    const ajeno = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `SELECT id FROM department WHERE tenant_id = $1 AND codigo_dane_dpto = '05'`,
        [otro.tenantId],
      );
      return rows[0]?.id ?? null;
    });
    const propio = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ department_id: string | null }>(
        `INSERT INTO municipality (tenant_id, company_id, codigo_dane, nombre, departamento, codigo_dane_departamento)
         VALUES ($1, NULL, '05999', 'Municipio de prueba A14', 'Antioquia', '05')
         RETURNING department_id`,
        [e.tenantId],
      );
      return rows[0]!.department_id;
    });
    expect(propio).not.toBeNull();
    expect(propio).not.toBe(ajeno);
    const global05 = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `SELECT id FROM department WHERE tenant_id IS NULL AND codigo_dane_dpto = '05'`,
      );
      return rows[0]!.id;
    });
    expect(propio).toBe(global05);
  });

  it('la guardia de alcance impide apuntar un tercero al departamento de otra firma', async () => {
    const ajenoId = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `SELECT id FROM department WHERE tenant_id = $1 AND codigo_dane_dpto = '05'`,
        [otro.tenantId],
      );
      return rows[0]!.id;
    });
    const err = await db
      .asAdmin((tx) =>
        tx.query(
          `INSERT INTO third_party (tenant_id, company_id, numero_documento, tipo_persona, razon_social,
                                    direccion, department_id)
           VALUES ($1, $2, $3, 'juridica', 'Cruce de alcance SAS', 'CL 1 # 2 - 3', $4)`,
          [e.tenantId, e.companyId, doc(), ajenoId],
        ),
      )
      .then(() => null)
      .catch((x: unknown) => x);
    expect(err).not.toBeNull();
    expect(isPostgresError(err) && err.code).toBe('AL001');
  });

  it('la guardia de alcance sigue cubriendo municipality_id (no se perdió al recrear el trigger)', async () => {
    const munAjeno = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO municipality (tenant_id, company_id, codigo_dane, nombre, departamento, codigo_dane_departamento)
         VALUES ($1, NULL, '05998', 'Municipio ajeno A14', 'Antioquia', '05') RETURNING id`,
        [otro.tenantId],
      );
      return rows[0]!.id;
    });
    const err = await db
      .asAdmin((tx) =>
        tx.query(
          `INSERT INTO third_party (tenant_id, company_id, numero_documento, tipo_persona, razon_social,
                                    direccion, municipality_id)
           VALUES ($1, $2, $3, 'juridica', 'Cruce municipio SAS', 'CL 1 # 2 - 3', $4)`,
          [e.tenantId, e.companyId, doc(), munAjeno],
        ),
      )
      .then(() => null)
      .catch((x: unknown) => x);
    expect(isPostgresError(err) && err.code).toBe('AL001');
  });

  it('department tiene RLS ENABLE + FORCE y una sola política, como el resto de catálogos híbridos', async () => {
    const info = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'department'`,
      );
      const { rows: pol } = await tx.query<{ policyname: string }>(
        `SELECT policyname FROM pg_policies WHERE tablename = 'department'`,
      );
      return { ...rows[0]!, politicas: pol.map((p) => p.policyname) };
    });
    expect(info.relrowsecurity).toBe(true);
    expect(info.relforcerowsecurity).toBe(true);
    expect(info.politicas).toEqual(['department_rls']);
  });

  it('sin el permiso parametro.editar no se escribe en department', async () => {
    const err = await db
      .asTenant(
        e.tenantId,
        e.companyId,
        (tx) =>
          tx.query(`INSERT INTO department (tenant_id, codigo_dane_dpto, nombre) VALUES ($1, '05', 'Mío')`, [
            e.tenantId,
          ]),
        { rolCodigo: 'auxiliar_causacion' },
      )
      .then(() => null)
      .catch((x: unknown) => x);
    expect(err).not.toBeNull();
  });
});

// =============================================================================
// 5. REGLAS DE ORO 2 Y 3 SOBRE EL MATERIAL NUEVO
// =============================================================================
describe('A14/D-086 · reglas de oro sobre migración y seed', () => {
  const migracion = readFileSync(RUTA_MIGRACION, 'utf8');
  const seedSql = readFileSync(RUTA_SEED, 'utf8');

  it('la migración 175 no inserta ningún dato normativo con vigencia', () => {
    expect(migracion).not.toMatch(
      /INSERT\s+INTO\s+(uvt_value|smmlv_value|tax_rule|tax_concept|municipality_ica_rule|rounding_rule|tax_calendar)\b/i,
    );
    expect(migracion).not.toMatch(/vigente_desde|vigente_hasta/i);
  });

  it('el seed de municipios es SOLO datos: ni un UPDATE, ni un DELETE, ni una función', () => {
    const ejecutable = seedSql.replace(/--.*$/gm, '');
    expect(ejecutable).not.toMatch(/\bUPDATE\b/i);
    expect(ejecutable).not.toMatch(/\bDELETE\b/i);
    expect(ejecutable).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION|DO\s+\$\$/i);
    expect(ejecutable).toMatch(/WHERE NOT EXISTS/i); // idempotente
  });

  it('el catálogo sembrado es íntegro: 1.122 municipios, prefijo == departamento, 100% enlazado', async () => {
    const r = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{
        total: number;
        sin_dept: number;
        prefijo_malo: number;
        dane_malo: number;
        deptos: number;
      }>(
        `SELECT
           (SELECT count(*)::int FROM municipality WHERE tenant_id IS NULL) AS total,
           (SELECT count(*)::int FROM municipality WHERE tenant_id IS NULL AND department_id IS NULL) AS sin_dept,
           (SELECT count(*)::int FROM municipality m JOIN department d ON d.id = m.department_id
             WHERE m.tenant_id IS NULL AND left(m.codigo_dane, 2) <> d.codigo_dane_dpto) AS prefijo_malo,
           (SELECT count(*)::int FROM municipality WHERE tenant_id IS NULL AND codigo_dane !~ '^[0-9]{5}$') AS dane_malo,
           (SELECT count(*)::int FROM department WHERE tenant_id IS NULL) AS deptos`,
      );
      return rows[0]!;
    });
    expect(r.total).toBe(1122);
    expect(r.sin_dept).toBe(0);
    expect(r.prefijo_malo).toBe(0);
    expect(r.dane_malo).toBe(0);
    expect(r.deptos).toBe(33);
  });

  it('conteo por departamento contra DIVIPOLA — los 33, no una muestra', async () => {
    const esperado: Record<string, number> = {
      '05': 125, '08': 23, '11': 1, '13': 46, '15': 123, '17': 27, '18': 16, '19': 42,
      '20': 25, '23': 30, '25': 116, '27': 31, '41': 37, '44': 15, '47': 30, '50': 29,
      '52': 64, '54': 40, '63': 12, '66': 14, '68': 87, '70': 26, '73': 47, '76': 42,
      '81': 7, '85': 19, '86': 13, '88': 2, '91': 11, '94': 8, '95': 4, '97': 6, '99': 4,
    };
    const real = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ cod: string; n: number }>(
        `SELECT d.codigo_dane_dpto AS cod, count(*)::int AS n
           FROM municipality m JOIN department d ON d.id = m.department_id
          WHERE m.tenant_id IS NULL GROUP BY d.codigo_dane_dpto`,
      );
      return Object.fromEntries(rows.map((r) => [r.cod, r.n])) as Record<string, number>;
    });
    expect(real).toEqual(esperado);
    expect(Object.values(esperado).reduce((a, b) => a + b, 0)).toBe(1122);
  });
});

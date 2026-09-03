/**
 * A12 — REVISIÓN DE SEGURIDAD DE D-087: granularidad de permisos por submódulo
 * de `/parametros` (migración 176) y su relación con la RLS.
 *
 * Lo que se ataca aquí, en este orden:
 *
 *  1. Que los ocho códigos finos NO relajen el candado del motor. El trigger de
 *     016 sobre `tax_rule` exige `parametro.editar` y el de `account` exige
 *     `puc.editar`; 176 no retargetea ninguno. Se comprueba con un rol propio
 *     de firma que tiene el fino y NO el grueso: la escritura directa contra la
 *     tabla —saltándose todo servicio— tiene que morir con SE002. Y con el
 *     control positivo: el mismo rol, con el grueso añadido, sí escribe (si no,
 *     la prueba estaría midiendo cualquier otra cosa).
 *
 *  2. Que el `INSERT ... SELECT` de 176 preserve exactamente el reparto previo:
 *     `admin_firma` con todo el catálogo, `solo_lectura` sin un solo permiso de
 *     acción, y cada rol con los finos equivalentes a los gruesos que ya tenía.
 *
 *  3. Que la interfaz no ofrezca lo que el motor rechaza (defecto encontrado y
 *     corregido en esta pasada: `puedeEditarParametros(tx, submodulo)` miraba
 *     SOLO el código fino).
 *
 *  4. Que la RLS de doble nivel siga cubriendo `role_permission` y
 *     `v_user_permission`: ninguna fila de otra firma, ni siquiera ahora que hay
 *     ocho códigos más.
 *
 *  5. Que las tres `app.detalle_impacto_*` (SECURITY DEFINER, `row_security =
 *     off`) no sean oráculos de existencia: misma respuesta ante el id REAL de
 *     otra firma que ante uno inventado.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, uuid, type TestDb } from '../helpers/db';
import { crearEscenario, type Escenario } from '../helpers/fixtures';
import { isPostgresError, SQLSTATE } from '../../src/db/types';
import { PERMISOS } from '../../src/auth/permisos';
import {
  puedeEditarParametros,
  puedeLeerParametros,
} from '../../src/services/parametrizacion';

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db?.close();
});

function codigoDe(e: unknown): string {
  return isPostgresError(e) ? (e.code ?? 'sin-codigo') : `no-es-error-de-motor:${String(e)}`;
}

async function capturarCodigo(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'sin-error';
  } catch (err) {
    return codigoDe(err);
  }
}

/** Crea un rol PROPIO de la firma con exactamente los permisos indicados. */
async function crearRolPropio(
  tenantId: string,
  codigo: string,
  permisos: readonly string[],
): Promise<string> {
  const roleId = uuid();
  await db.asAdmin(async (tx) => {
    await tx.query(
      `INSERT INTO role (id, tenant_id, codigo, nombre, descripcion, es_sistema)
       VALUES ($1, $2, $3, $3, 'Rol de la revisión de seguridad de D-087', false)`,
      [roleId, tenantId, codigo],
    );
    for (const p of permisos) {
      await tx.query(
        'INSERT INTO role_permission (role_id, permission_codigo) VALUES ($1, $2)',
        [roleId, p],
      );
    }
  });
  return roleId;
}

const SUBMODULOS = ['tarifas', 'valores_base', 'reteica', 'puc'] as const;

// =============================================================================
describe('A12 · D-087: los sub-permisos NO relajan el candado del motor', () => {
  let e: Escenario;
  let rolFinoId = '';
  let taxConceptId = '';

  beforeAll(async () => {
    e = await crearEscenario(db, { razonSocial: 'Firma del candado' });
    rolFinoId = await crearRolPropio(e.tenantId, `a12_fino_${uuid().slice(0, 8)}`, [
      PERMISOS.PARAMETRO_LEER,
      PERMISOS.PARAMETRO_TARIFAS_LEER,
      PERMISOS.PARAMETRO_TARIFAS_EDITAR,
      PERMISOS.PARAMETRO_VALORES_BASE_EDITAR,
      PERMISOS.PARAMETRO_RETEICA_EDITAR,
      PERMISOS.PARAMETRO_PUC_EDITAR,
    ]);
    taxConceptId = await db.asAdmin(async (tx) => {
      const id = uuid();
      await tx.query(
        `INSERT INTO tax_concept (id, tenant_id, company_id, tipo, codigo, nombre)
         VALUES ($1,$2,$3,'retefuente',$4,'Concepto de la revisión A12')`,
        [id, e.tenantId, e.companyId, `A12-${id.slice(0, 8)}`],
      );
      return id;
    });
  });

  async function insertarTarifa(rolId: string): Promise<string> {
    return capturarCodigo(() =>
      db.asTenant(
        e.tenantId,
        e.companyId,
        (tx) =>
          tx.query(
            `INSERT INTO tax_rule (id, tenant_id, company_id, tax_concept_id, tipo, tarifa,
                                   aplica_sobre, aplica_a, vigente_desde, norma_respaldo)
             VALUES ($1,$2,$3,$4,'retefuente',$5,'base_gravable','ambos', DATE '2026-01-01',
                     'Prueba de permiso de A12')`,
            [uuid(), e.tenantId, e.companyId, taxConceptId, '0.025000'],
          ),
        { rolId, sesionNueva: true },
      ),
    );
  }

  it('un rol con parametro.tarifas.editar y SIN parametro.editar no puede escribir tax_rule (SE002)', async () => {
    expect(await insertarTarifa(rolFinoId)).toBe(SQLSTATE.PERMISO_INSUFICIENTE);
  });

  it('control positivo: el MISMO rol, con parametro.editar, sí escribe', async () => {
    const rolConGrueso = await crearRolPropio(e.tenantId, `a12_grueso_${uuid().slice(0, 8)}`, [
      PERMISOS.PARAMETRO_LEER,
      PERMISOS.PARAMETRO_EDITAR,
      PERMISOS.PARAMETRO_TARIFAS_EDITAR,
    ]);
    expect(await insertarTarifa(rolConGrueso)).toBe('sin-error');
  });

  it('un rol con parametro.puc.editar y SIN puc.editar no puede escribir account (SE002)', async () => {
    const codigo = await capturarCodigo(() =>
      db.asTenant(
        e.tenantId,
        e.companyId,
        (tx) =>
          tx.query(
            `INSERT INTO account (id, tenant_id, company_id, codigo, nombre, nivel,
                                  naturaleza, permite_movimiento)
             VALUES ($1,$2,$3,$4,'Cuenta que no debería nacer',4,'debito',true)`,
            [uuid(), e.tenantId, e.companyId, `9999${uuid().slice(0, 2)}`],
          ),
        { rolId: rolFinoId, sesionNueva: true },
      ),
    );
    expect(codigo).toBe(SQLSTATE.PERMISO_INSUFICIENTE);
  });

  it('las tres app.detalle_impacto_* siguen exigiendo el permiso GRUESO', async () => {
    const llamadas = [
      'SELECT * FROM app.detalle_impacto_tax_concept($1)',
      'SELECT * FROM app.detalle_impacto_municipio_ica($1)',
    ];
    for (const sql of llamadas) {
      const codigo = await capturarCodigo(() =>
        db.asTenant(e.tenantId, e.companyId, (tx) => tx.query(sql, [taxConceptId]), {
          rolId: rolFinoId,
          sesionNueva: true,
        }),
      );
      expect(`${sql} -> ${codigo}`).toBe(`${sql} -> ${SQLSTATE.PERMISO_INSUFICIENTE}`);
    }
    const codigoValorBase = await capturarCodigo(() =>
      db.asTenant(
        e.tenantId,
        e.companyId,
        (tx) => tx.query('SELECT * FROM app.detalle_impacto_valor_base()'),
        { rolId: rolFinoId, sesionNueva: true },
      ),
    );
    expect(codigoValorBase).toBe(SQLSTATE.PERMISO_INSUFICIENTE);
  });

  /**
   * REGRESIÓN del defecto que encontró A12 en esta revisión: si
   * `puedeEditarParametros` mirara solo el código fino, este rol vería el
   * formulario de guardar de las cuatro pantallas y el motor lo rechazaría al
   * enviarlo (SE002 en la cara del contador). La interfaz no ofrece lo que la
   * base prohíbe.
   */
  it('la interfaz no ofrece guardar a quien el motor va a rechazar', async () => {
    const visto = await db.asTenant(
      e.tenantId,
      e.companyId,
      async (tx) => {
        const r: Record<string, boolean> = {};
        for (const s of SUBMODULOS) r[s] = await puedeEditarParametros(tx, s);
        return r;
      },
      { rolId: rolFinoId, sesionNueva: true },
    );
    expect(visto).toEqual({ tarifas: false, valores_base: false, reteica: false, puc: false });
  });

  it('un administrador de firma sigue viendo los cuatro submódulos, de leer y de editar', async () => {
    const visto = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const r: Record<string, boolean> = {};
      for (const s of SUBMODULOS) {
        r[`editar:${s}`] = await puedeEditarParametros(tx, s);
        r[`leer:${s}`] = await puedeLeerParametros(tx, s);
      }
      r['editar:grueso'] = await puedeEditarParametros(tx);
      r['leer:grueso'] = await puedeLeerParametros(tx);
      return r;
    });
    expect(Object.values(visto).every(Boolean)).toBe(true);
  });

  it('un contador lee los cuatro submódulos y no edita ninguno (igual que antes de 176)', async () => {
    const visto = await db.asTenant(
      e.tenantId,
      e.companyId,
      async (tx) => {
        const r: Record<string, boolean> = {};
        for (const s of SUBMODULOS) {
          r[`editar:${s}`] = await puedeEditarParametros(tx, s);
          r[`leer:${s}`] = await puedeLeerParametros(tx, s);
        }
        return r;
      },
      { rolCodigo: 'contador', sesionNueva: true },
    );
    expect(visto).toEqual({
      'editar:tarifas': false,
      'editar:valores_base': false,
      'editar:reteica': false,
      'editar:puc': false,
      'leer:tarifas': true,
      'leer:valores_base': true,
      'leer:reteica': true,
      'leer:puc': true,
    });
  });
});

// =============================================================================
describe('A12 · D-087: el reparto de permisos que dejó el INSERT ... SELECT de 176', () => {
  const FINOS: Array<[string, string]> = [
    [PERMISOS.PARAMETRO_EDITAR, PERMISOS.PARAMETRO_TARIFAS_EDITAR],
    [PERMISOS.PARAMETRO_EDITAR, PERMISOS.PARAMETRO_VALORES_BASE_EDITAR],
    [PERMISOS.PARAMETRO_EDITAR, PERMISOS.PARAMETRO_RETEICA_EDITAR],
    [PERMISOS.PARAMETRO_LEER, PERMISOS.PARAMETRO_TARIFAS_LEER],
    [PERMISOS.PARAMETRO_LEER, PERMISOS.PARAMETRO_VALORES_BASE_LEER],
    [PERMISOS.PARAMETRO_LEER, PERMISOS.PARAMETRO_RETEICA_LEER],
    [PERMISOS.PUC_EDITAR, PERMISOS.PARAMETRO_PUC_EDITAR],
    [PERMISOS.PUC_LEER, PERMISOS.PARAMETRO_PUC_LEER],
  ];

  async function permisosDe(codigoRol: string): Promise<Set<string>> {
    const filas = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ permission_codigo: string }>(
        `SELECT rp.permission_codigo
           FROM role_permission rp
           JOIN role r ON r.id = rp.role_id
          WHERE r.tenant_id IS NULL AND r.codigo = $1`,
        [codigoRol],
      );
      return rows.map((r) => r.permission_codigo);
    });
    return new Set(filas);
  }

  it('los ocho códigos existen, con accion_tipo válido y en el módulo de parametrización', async () => {
    const filas = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ codigo: string; modulo: string; accion_tipo: string }>(
        `SELECT codigo, modulo, accion_tipo FROM permission
          WHERE codigo LIKE 'parametro.%.%' ORDER BY codigo`,
      );
      return rows;
    });
    expect(filas.map((f) => f.codigo)).toEqual([
      // D-088 (migración 178): submódulo de ICA por municipio.
      'parametro.ica.editar',
      'parametro.ica.leer',
      'parametro.puc.editar',
      'parametro.puc.leer',
      'parametro.reteica.editar',
      'parametro.reteica.leer',
      'parametro.tarifas.editar',
      'parametro.tarifas.leer',
      'parametro.valores_base.editar',
      'parametro.valores_base.leer',
    ]);
    // Todos en el MISMO módulo que `parametro.leer` / `parametro.editar`: la
    // matriz de `/admin/roles` agrupa por `modulo` y dos grupos homónimos serían
    // una trampa al otorgar privilegios.
    expect([...new Set(filas.map((f) => f.modulo))]).toEqual(['parametrizacion']);
    for (const f of filas) {
      expect(`${f.codigo} -> ${f.accion_tipo}`).toBe(
        `${f.codigo} -> ${f.codigo.endsWith('.editar') ? 'editar' : 'ver'}`,
      );
    }
  });

  it('cada rol del sistema recibió el fino EXACTAMENTE cuando ya tenía el grueso', async () => {
    for (const rol of [
      'admin_firma',
      'admin_tributario',
      'contador',
      'auxiliar_causacion',
      'solo_lectura',
    ]) {
      const tiene = await permisosDe(rol);
      for (const [grueso, fino] of FINOS) {
        expect(`${rol}: ${grueso} -> ${fino} = ${tiene.has(fino)}`).toBe(
          `${rol}: ${grueso} -> ${fino} = ${tiene.has(grueso)}`,
        );
      }
    }
  });

  it('admin_firma conserva TODOS los permisos del catálogo, los ocho nuevos incluidos', async () => {
    const faltantes = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ codigo: string }>(
        `SELECT p.codigo FROM permission p
          WHERE NOT EXISTS (
            SELECT 1 FROM role_permission rp
              JOIN role r ON r.id = rp.role_id
             WHERE rp.permission_codigo = p.codigo
               AND r.tenant_id IS NULL AND r.codigo = 'admin_firma')
          ORDER BY p.codigo`,
      );
      return rows.map((r) => r.codigo);
    });
    expect(faltantes).toEqual([]);
  });

  it('solo_lectura no ganó ni un permiso de acción', async () => {
    const acciones = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ codigo: string }>(
        `SELECT p.codigo FROM role_permission rp
           JOIN role r ON r.id = rp.role_id
           JOIN permission p ON p.codigo = rp.permission_codigo
          WHERE r.tenant_id IS NULL AND r.codigo = 'solo_lectura'
            AND p.accion_tipo <> 'ver'
          ORDER BY p.codigo`,
      );
      return rows.map((r) => r.codigo);
    });
    expect(acciones).toEqual([]);
  });

  it('auxiliar_causacion tampoco: lee los parámetros y no edita ninguno', async () => {
    const tiene = await permisosDe('auxiliar_causacion');
    expect([...tiene].filter((c) => c.startsWith('parametro.') && c.endsWith('.editar'))).toEqual(
      [],
    );
    expect(tiene.has(PERMISOS.PARAMETRO_TARIFAS_LEER)).toBe(true);
  });
});

// =============================================================================
describe('A12 · D-087: RLS de doble nivel sobre los permisos y las funciones nuevas', () => {
  let a: Escenario;
  let b: Escenario;
  let rolPropioDeB = '';
  let taxConceptDeB = '';
  let municipioDeB = '';

  beforeAll(async () => {
    a = await crearEscenario(db, { razonSocial: 'Firma A (observadora D-087)' });
    b = await crearEscenario(db, { razonSocial: 'Firma B (objetivo D-087)' });

    rolPropioDeB = await crearRolPropio(b.tenantId, `a12_rol_secreto_de_b_${uuid().slice(0, 8)}`, [
      PERMISOS.PARAMETRO_TARIFAS_EDITAR,
      PERMISOS.PARAMETRO_PUC_LEER,
    ]);

    ({ taxConceptDeB, municipioDeB } = await db.asAdmin(async (tx) => {
      const id = uuid();
      await tx.query(
        `INSERT INTO tax_concept (id, tenant_id, company_id, tipo, codigo, nombre)
         VALUES ($1,$2,$3,'retefuente',$4,'Concepto tributario de B')`,
        [id, b.tenantId, b.companyId, `A12-B-${id.slice(0, 8)}`],
      );
      const { rows } = await tx.query<{ id: string }>(
        'SELECT id FROM municipality WHERE tenant_id = $1 LIMIT 1',
        [b.tenantId],
      );
      return { taxConceptDeB: id, municipioDeB: rows[0]!.id };
    }));
  });

  it('role_permission no expone las filas del rol propio de otra firma', async () => {
    const visto = await db.asTenant(a.tenantId, a.companyId, async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM role_permission WHERE role_id = $1',
        [rolPropioDeB],
      );
      return Number(rows[0]!.n);
    });
    expect(visto).toBe(0);
  });

  it('v_user_permission no devuelve ni un permiso de otra firma', async () => {
    const ajenas = await db.asTenant(a.tenantId, a.companyId, async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM v_user_permission WHERE tenant_id <> $1',
        [a.tenantId],
      );
      return Number(rows[0]!.n);
    });
    expect(ajenas).toBe(0);
  });

  it('v_user_permission solo muestra los códigos finos de la empresa en contexto', async () => {
    const filas = await db.asTenant(a.tenantId, a.companyId, async (tx) => {
      const { rows } = await tx.query<{ company_id: string }>(
        `SELECT DISTINCT company_id FROM v_user_permission
          WHERE permission_codigo LIKE 'parametro.%.%'`,
      );
      return rows.map((r) => r.company_id);
    });
    expect(filas.filter((c) => c !== a.companyId)).toEqual([]);
  });

  async function respuestaComparada(sql: string, idReal: string) {
    const idInventado = uuid();
    return db.asTenant(a.tenantId, a.companyId, async (tx) => {
      const leer = async (id: string): Promise<string> => {
        try {
          const { rows } = await tx.query(sql, [id]);
          return JSON.stringify(rows);
        } catch (err) {
          return `ERROR:${codigoDe(err)}`;
        }
      };
      return { conReal: await leer(idReal), conInventado: await leer(idInventado) };
    });
  }

  it('app.detalle_impacto_tax_concept no distingue un concepto ajeno de uno inexistente', async () => {
    const r = await respuestaComparada(
      'SELECT * FROM app.detalle_impacto_tax_concept($1)',
      taxConceptDeB,
    );
    expect(r.conReal).toBe(r.conInventado);
  });

  it('app.detalle_impacto_municipio_ica no distingue un municipio ajeno de uno inexistente', async () => {
    const r = await respuestaComparada(
      'SELECT * FROM app.detalle_impacto_municipio_ica($1)',
      municipioDeB,
    );
    expect(r.conReal).toBe(r.conInventado);
  });

  it('app.detalle_impacto_valor_base no deja caer nada de la otra firma', async () => {
    const filas = await db.asTenant(a.tenantId, a.companyId, async (tx) => {
      const { rows } = await tx.query<{ clase: string; codigo: string; nombre: string }>(
        'SELECT clase, codigo, nombre FROM app.detalle_impacto_valor_base()',
      );
      return rows;
    });
    const texto = JSON.stringify(filas);
    expect(texto).not.toContain('Firma B');
    expect(texto).not.toContain(b.tenantId);
  });
});

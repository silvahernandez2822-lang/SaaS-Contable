/**
 * A14 — compuerta AMPLIADA de D-090, frente 4: la migración 182 y el permiso
 * `carga_masiva.acceder`.
 *
 * Lo que hay que medir no es que el INSERT corra, sino tres cosas:
 *   1. que reparta el permiso a QUIEN dice el encargo y a nadie más —en
 *      particular, que `solo_lectura` no lo reciba—;
 *   2. que el permiso nuevo NO abra ni un milímetro de escritura: sigue siendo
 *      el permiso propio de cada catálogo el que exige el trigger de la tabla
 *      (016). Un «permiso de acceso» que por accidente valiera como permiso de
 *      escritura sería una escalada de privilegios en toda regla;
 *   3. que sea aplicable dos veces sin duplicar ni pisar nada (append-only,
 *      Regla de Oro 3 en su versión de catálogo: se inserta, no se `UPDATE`a).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createTestDb, esperarErrorPg, uuid, type TestDb } from '../helpers/db';
import { crearEscenario, type Escenario } from '../helpers/fixtures';

const MIGRACION = fileURLToPath(
  new URL('../../db/migrations/182_a8_d090_permiso_carga_masiva.sql', import.meta.url),
);
const CODIGO = 'carga_masiva.acceder';

let db: TestDb;
let e: Escenario;

beforeAll(async () => {
  db = await createTestDb();
  e = await crearEscenario(db);
}, 300_000);

afterAll(async () => {
  await db.close();
});

/** Pregunta por el permiso con la función REAL del motor, desde una sesión de
 *  negocio con el rol pedido. No se consulta `role_permission` a mano: lo que
 *  importa es lo que responde `app.tiene_permiso`, que es lo que usa la app. */
async function puede(rolCodigo: string, codigo: string): Promise<boolean> {
  return db.asTenant(
    e.tenantId,
    e.companyId,
    async (tx) => {
      const { rows } = await tx.query<{ ok: boolean }>('SELECT app.tiene_permiso($1) AS ok', [codigo]);
      return rows[0]!.ok;
    },
    { rolCodigo },
  );
}

describe('A14 · D-090 frente 4 — migración 182', () => {
  it('el código existe en el catálogo de permisos, con módulo y tipo de acción válidos', async () => {
    const { rows } = await db.asAdmin((tx) =>
      tx.query<{ codigo: string; modulo: string; accion_tipo: string }>(
        'SELECT codigo, modulo, accion_tipo FROM permission WHERE codigo = $1',
        [CODIGO],
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.accion_tipo).toBe('ver');
    // El módulo tiene que ser uno de los que ya usa la matriz de /admin/roles,
    // o el permiso nuevo no aparecería en ninguna pestaña de esa pantalla.
    const { rows: modulos } = await db.asAdmin((tx) =>
      tx.query<{ modulo: string }>('SELECT DISTINCT modulo FROM permission WHERE codigo <> $1', [CODIGO]),
    );
    expect(modulos.map((m) => m.modulo)).toContain(rows[0]!.modulo);
  });

  it('lo tienen los cuatro roles que editan algún catálogo; `solo_lectura` NO', async () => {
    expect(await puede('admin_firma', CODIGO)).toBe(true);
    expect(await puede('admin_tributario', CODIGO)).toBe(true);
    expect(await puede('contador', CODIGO)).toBe(true);
    expect(await puede('auxiliar_causacion', CODIGO)).toBe(true);
    expect(await puede('solo_lectura', CODIGO)).toBe(false);
  });

  it('el reparto coincide EXACTAMENTE con «tiene algún permiso editar de catálogo»', async () => {
    // La regla que dice la migración, comprobada contra la tabla: ni un rol de
    // más ni uno de menos. Si mañana alguien le añade el permiso a un rol a
    // mano sin permiso de edición, esta prueba lo dice.
    const { rows } = await db.asAdmin((tx) =>
      tx.query<{ con_acceso: string[]; con_edicion: string[] }>(
        `SELECT
           (SELECT array_agg(DISTINCT r.codigo ORDER BY r.codigo)
              FROM role_permission rp JOIN role r ON r.id = rp.role_id
             WHERE rp.permission_codigo = $1)                            AS con_acceso,
           (SELECT array_agg(DISTINCT r.codigo ORDER BY r.codigo)
              FROM role_permission rp JOIN role r ON r.id = rp.role_id
             WHERE rp.permission_codigo IN ('parametro.editar','puc.editar',
                                            'tercero.editar','concepto.editar')) AS con_edicion`,
        [CODIGO],
      ),
    );
    expect(rows[0]!.con_acceso).toEqual(rows[0]!.con_edicion);
    expect(rows[0]!.con_acceso).not.toContain('solo_lectura');
  });

  it('la migración es reaplicable: correrla otra vez no duplica ni una fila', async () => {
    const sql = readFileSync(MIGRACION, 'utf8');
    const contar = () =>
      db.asAdmin(async (tx) => {
        const { rows } = await tx.query<{ permisos: string; asignaciones: string }>(
          `SELECT (SELECT count(*)::text FROM permission WHERE codigo = $1)                 AS permisos,
                  (SELECT count(*)::text FROM role_permission WHERE permission_codigo = $1) AS asignaciones`,
          [CODIGO],
        );
        return rows[0]!;
      });

    const antes = await contar();
    // `exec` y no `query`: el archivo trae dos sentencias y una sentencia
    // preparada no admite varias. Es la migración TAL CUAL, sin recortes.
    await db.client.exec(sql);
    const despues = await contar();
    expect(despues).toEqual(antes);
  });

  it('la migración no hace UPDATE ni DELETE sobre el modelo de roles', () => {
    const sql = readFileSync(MIGRACION, 'utf8')
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('--'))
      .join('\n');
    expect(sql).not.toMatch(/\bUPDATE\b/i);
    expect(sql).not.toMatch(/\bDELETE\b/i);
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
  });

  it('Regla de Oro 2: la 182 no trae ni una tarifa, base, UVT ni calendario', () => {
    const sql = readFileSync(MIGRACION, 'utf8')
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('--'))
      .join('\n');
    // Los únicos literales de la parte ejecutable son textos: códigos de
    // permiso y descripciones. Ni un número suelto.
    expect(sql).not.toMatch(/\b\d+([.,]\d+)?\s*%/);
    expect(sql.replace(/'[^']*'/g, "''")).not.toMatch(/\d/);
  });
});

describe('A14 · D-090 frente 4 — el permiso de acceso NO es un permiso de escritura', () => {
  it('un rol con `carga_masiva.acceder` y SIN `tercero.editar` sigue sin poder escribir el catálogo', async () => {
    // `auxiliar_causacion` sí tiene tercero.editar, así que no sirve de
    // conejillo. Se fabrica un rol de firma que SOLO tenga el permiso nuevo y
    // los de lectura, y se le pide al motor que escriba un tercero.
    const rolId = uuid();
    await db.asAdmin(async (tx) => {
      await tx.query(
        `INSERT INTO role (id, tenant_id, codigo, nombre, descripcion)
         VALUES ($1, $2, 'solo_puerta', 'Solo la puerta de carga masiva', 'Rol de prueba de A14')`,
        [rolId, e.tenantId],
      );
      await tx.query(
        `INSERT INTO role_permission (role_id, permission_codigo)
         SELECT $1, codigo FROM permission
          WHERE codigo IN ($2, 'tercero.leer', 'parametro.leer', 'puc.leer', 'empresa.leer')`,
        [rolId, CODIGO],
      );
    });

    const abre = await db.asTenant(
      e.tenantId, e.companyId,
      async (tx) => {
        const { rows } = await tx.query<{ ok: boolean }>('SELECT app.tiene_permiso($1) AS ok', [CODIGO]);
        return rows[0]!.ok;
      },
      { rolId, sesionNueva: true },
    );
    expect(abre, 'el rol de prueba sí puede ENTRAR al módulo').toBe(true);

    // ...y aun así el motor le rechaza la escritura. El candado no se movió.
    await esperarErrorPg(
      () =>
        db.asTenant(
          e.tenantId, e.companyId,
          async (tx) => {
            await tx.query(
              `INSERT INTO third_party (tenant_id, company_id, tipo_documento, numero_documento,
                                        razon_social, tipo_persona)
               VALUES ($1, $2, 'NIT', $3, 'Tercero que no debería entrar', 'juridica')`,
              [e.tenantId, e.companyId, `9${Date.now().toString().slice(-8)}`],
            );
          },
          { rolId },
        ),
      'SE002',
    );
  });

  it('quien NO tiene `carga_masiva.acceder` tampoco gana nada por tener el permiso del catálogo', async () => {
    // El caso inverso: `solo_lectura` no entra al módulo, y tampoco escribe.
    expect(await puede('solo_lectura', CODIGO)).toBe(false);
    expect(await puede('solo_lectura', 'tercero.editar')).toBe(false);
  });
});

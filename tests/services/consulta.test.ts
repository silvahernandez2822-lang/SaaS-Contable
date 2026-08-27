/**
 * A6 — Servicio de dominio: consulta de estado (entregable 2).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, uuid, type TestDb } from '../helpers/db';
import { crearEscenario, type Escenario } from '../helpers/fixtures';
import { PermisoInsuficienteError } from '../../src/auth/permisos';
import { consultarEstadoDocumento, listarPendientesDeAprobacion } from '../../src/services/consulta';
import { encolarCausacion } from '../../src/services/cola';

let db: TestDb;
let e: Escenario;

beforeAll(async () => {
  db = await createTestDb();
  e = await crearEscenario(db);
});

afterAll(async () => {
  await db?.close();
});

describe('consultarEstadoDocumento', () => {
  it('devuelve el documento, su trabajo de cola y sus retenciones (vacías si no se ha causado)', async () => {
    await db.asTenant(e.tenantId, e.companyId, (tx) => encolarCausacion(tx, e.sourceDocumentId));

    const estado = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      consultarEstadoDocumento(tx, e.sourceDocumentId),
    );
    expect(estado).toMatchObject({
      sourceDocumentId: e.sourceDocumentId,
      tipoDocumento: 'Invoice',
    });
    expect(estado?.job).toMatchObject({ estado: 'pendiente' });
    expect(estado?.retenciones).toEqual([]);
    expect(estado?.asiento).toBeNull();
  });

  it('un documento inexistente (o invisible por RLS) devuelve null, sin distinguir el motivo', async () => {
    const otra = await crearEscenario(db);
    const invisible = await db.asTenant(otra.tenantId, otra.companyId, (tx) =>
      consultarEstadoDocumento(tx, e.sourceDocumentId),
    );
    expect(invisible).toBeNull();

    const inexistente = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      consultarEstadoDocumento(tx, uuid()),
    );
    expect(inexistente).toBeNull();
  });

  it('exige documento.leer', async () => {
    // Los cinco roles del SISTEMA (014_roles_permisos_base.sql) llevan todos
    // 'documento.leer', así que probar la exigencia real exige un rol propio
    // de la firma sin ningún permiso (D-015: una firma puede crear los
    // suyos), en vez de tocar el catálogo global que comparte toda la suite.
    const esc = await crearEscenario(db);
    const { rows } = await db.asAdmin((tx) =>
      tx.query<{ id: string }>(
        `INSERT INTO role (tenant_id, codigo, nombre, descripcion, es_sistema)
         VALUES ($1, 'sin_permisos', 'Sin permisos', 'Rol de prueba sin ningún permiso', false)
         RETURNING id`,
        [esc.tenantId],
      ),
    );
    const rolSinPermisos = rows[0]!.id;

    await expect(
      db.asTenant(esc.tenantId, esc.companyId, (tx) => consultarEstadoDocumento(tx, esc.sourceDocumentId), {
        rolId: rolSinPermisos,
      }),
    ).rejects.toBeInstanceOf(PermisoInsuficienteError);
  });
});

describe('listarPendientesDeAprobacion', () => {
  it('lista solo los documentos en pendiente_aprobacion de la empresa en contexto', async () => {
    const esc = await crearEscenario(db);
    await db.asAdmin((tx) =>
      tx.query(`UPDATE source_document SET estado = 'pendiente_aprobacion' WHERE id = $1`, [esc.sourceDocumentId]),
    );

    const pendientes = await db.asTenant(esc.tenantId, esc.companyId, (tx) => listarPendientesDeAprobacion(tx));
    expect(pendientes.map((p) => p.sourceDocumentId)).toContain(esc.sourceDocumentId);
    expect(pendientes.every((p) => p.estado === 'pendiente_aprobacion')).toBe(true);
  });
});

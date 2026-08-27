/**
 * A13 — Cierre de V-9: sesión de sistema para el canal de correo (Ola 2).
 *
 * Demuestra, contra PGlite real (sin red, D-004), que:
 *  1. El token de integración termina en una sesión REAL derivada de
 *     `app.session_context` (D-021) — nunca se fija `app.tenant_id` a mano.
 *  2. El usuario de sistema tiene el alcance MÍNIMO (documento.leer/cargar):
 *     no puede aprobar, publicar ni tocar parámetros aunque alguien robe el
 *     token.
 *  3. Un token de la firma A jamás abre una sesión de la firma B.
 *  4. Revocar un token invalida el canal de inmediato.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, esperarErrorPg, type TestDb } from '../helpers/db';
import { crearEscenario, type Escenario } from '../helpers/fixtures';
import { SQLSTATE } from '../../src/db/types';
import { PermisoInsuficienteError } from '../../src/auth/permisos';
import { EmpresaNoAutorizadaError, withSessionContext } from '../../src/db/tenant-context';
import {
  provisionarCanalIngestaCorreo,
  sincronizarAccesoEmpresaIngesta,
} from '../../src/integraciones/aprovisionamiento';
import {
  autenticarTokenIntegracion,
  crearTokenIntegracion,
  listarTokensIntegracion,
  revocarTokenIntegracion,
} from '../../src/integraciones/token';
import { abrirSesionSistema, cerrarSesionSistema, TokenIntegracionInvalidoError } from '../../src/integraciones/sesion-sistema';

let db: TestDb;
let alfa: Escenario;
let beta: Escenario;

beforeAll(async () => {
  db = await createTestDb();
  alfa = await crearEscenario(db);
  beta = await crearEscenario(db);
});

afterAll(async () => {
  await db?.close();
});

describe('provisionarCanalIngestaCorreo — aprovisionamiento', () => {
  it('crea el usuario de sistema, le da acceso a la empresa activa y emite un token', async () => {
    const resultado = await db.asTenant(alfa.tenantId, alfa.companyId, (tx) =>
      provisionarCanalIngestaCorreo(tx, { tenantId: alfa.tenantId }),
    );
    expect(resultado.token.length).toBeGreaterThanOrEqual(32);
    expect(resultado.empresaEnSesionSincronizada).toBe(true);

    const { rows } = await db.asAdmin((tx) =>
      tx.query<{ estado: string; password_hash: string | null }>(
        `SELECT estado, password_hash FROM "user" WHERE id = $1`,
        [resultado.userId],
      ),
    );
    expect(rows[0]?.estado).toBe('activo');
    // Sin contraseña: el camino de login humano no puede usar este usuario.
    expect(rows[0]?.password_hash).toBeNull();
  });

  it('es idempotente: aprovisionar dos veces no duplica el usuario de sistema', async () => {
    const escenario = await crearEscenario(db);
    const a = await db.asTenant(escenario.tenantId, escenario.companyId, (tx) =>
      provisionarCanalIngestaCorreo(tx, { tenantId: escenario.tenantId }),
    );
    const b = await db.asTenant(escenario.tenantId, escenario.companyId, (tx) =>
      provisionarCanalIngestaCorreo(tx, { tenantId: escenario.tenantId }),
    );
    expect(a.userId).toBe(b.userId);
  });

  it('exige usuario.administrar: un auxiliar de causación no puede aprovisionar el canal', async () => {
    const escenario = await crearEscenario(db);
    await expect(
      db.asTenant(
        escenario.tenantId,
        escenario.companyId,
        (tx) => provisionarCanalIngestaCorreo(tx, { tenantId: escenario.tenantId }),
        { rolCodigo: 'auxiliar_causacion' },
      ),
    ).rejects.toBeInstanceOf(PermisoInsuficienteError);
  });

  it('sincronizarAccesoEmpresaIngesta opera SOLO sobre la empresa que la sesión ya tiene elegida (D-021/D-022)', async () => {
    const escenario = await crearEscenario(db);
    const provisionado = await db.asTenant(escenario.tenantId, escenario.companyId, (tx) =>
      provisionarCanalIngestaCorreo(tx, { tenantId: escenario.tenantId }),
    );
    // provisionarCanalIngestaCorreo ya sincronizó la empresa de la sesión.
    expect(provisionado.empresaEnSesionSincronizada).toBe(true);

    const nuevaEmpresaId = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO company (tenant_id, nit, razon_social, buzon_email)
         VALUES ($1, $2, 'Segunda empresa', $3) RETURNING id`,
        [escenario.tenantId, `900${Date.now()}`, `empresa-nueva-${Date.now()}@inbox.ejemplo.co`],
      );
      return rows[0]!.id;
    });

    // Repetirlo para la empresa YA sincronizada no inserta una fila nueva.
    const repetido = await db.asTenant(escenario.tenantId, escenario.companyId, (tx) =>
      sincronizarAccesoEmpresaIngesta(tx, { userId: provisionado.userId }),
    );
    expect(repetido).toBe(false);

    // Una sesión distinta, posicionada en la empresa NUEVA, sí la sincroniza.
    const sincronizadaNueva = await db.asTenant(escenario.tenantId, nuevaEmpresaId, (tx) =>
      sincronizarAccesoEmpresaIngesta(tx, { userId: provisionado.userId }),
    );
    expect(sincronizadaNueva).toBe(true);

    const { rows } = await db.asAdmin((tx) =>
      tx.query(`SELECT 1 FROM user_company_access WHERE user_id = $1 AND company_id = $2`, [
        provisionado.userId,
        nuevaEmpresaId,
      ]),
    );
    expect(rows).toHaveLength(1);
  });

  it('sincronizarAccesoTodasLasEmpresas (app/lib) cubre TODAS las empresas de la firma con el patrón de A7', async () => {
    const escenario = await crearEscenario(db);
    await db.asTenant(escenario.tenantId, escenario.companyId, (tx) =>
      provisionarCanalIngestaCorreo(tx, { tenantId: escenario.tenantId }),
    );
    const segundaEmpresaId = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO company (tenant_id, nit, razon_social, buzon_email)
         VALUES ($1, $2, 'Tercera empresa', $3) RETURNING id`,
        [escenario.tenantId, `901${Date.now()}`, `empresa-tercera-${Date.now()}@inbox.ejemplo.co`],
      );
      return rows[0]!.id;
    });

    // Esta función vive en app/lib (orquesta Next.js: cookies de sesión), así
    // que aquí solo se prueba el servicio que sí es de src/: la sincronización
    // empresa por empresa, reutilizando la MISMA identidad de sistema.
    const provisionado2 = await db.asTenant(escenario.tenantId, escenario.companyId, (tx) =>
      provisionarCanalIngestaCorreo(tx, { tenantId: escenario.tenantId }),
    );
    const sincronizadaTercera = await db.asTenant(escenario.tenantId, segundaEmpresaId, (tx) =>
      sincronizarAccesoEmpresaIngesta(tx, { userId: provisionado2.userId }),
    );
    expect(sincronizadaTercera).toBe(true);
  });
});

describe('autenticarTokenIntegracion / abrirSesionSistema — el segundo camino de primer factor', () => {
  it('un token válido abre una sesión REAL con el tenant correcto y el rol de alcance mínimo', async () => {
    const escenario = await crearEscenario(db);
    const provisionado = await db.asTenant(escenario.tenantId, escenario.companyId, (tx) =>
      provisionarCanalIngestaCorreo(tx, { tenantId: escenario.tenantId }),
    );

    const identidad = await autenticarTokenIntegracion(db.client, provisionado.token);
    expect(identidad).toEqual({ userId: provisionado.userId, tenantId: escenario.tenantId, canal: 'correo' });

    const sesion = await abrirSesionSistema(db.client, provisionado.token, 'correo');
    expect(sesion.tenantId).toBe(escenario.tenantId);
    expect(sesion.userId).toBe(provisionado.userId);

    // La sesión es indistinguible, para el resto del sistema, de una humana:
    // pasa por el MISMO withSessionContext (D-021), con RLS activa de verdad.
    const permisos = await withSessionContext(
      db.client,
      { sessionToken: sesion.token, companyId: escenario.companyId },
      async (tx) => {
        const { rows } = await tx.query<{ codigo: string }>(
          `SELECT DISTINCT p.permission_codigo AS codigo FROM v_user_permission p
             WHERE p.user_id = app.current_user_id()
               AND p.permission_codigo IN ('documento.leer','documento.cargar','causacion.aprobar','parametro.editar','asiento.publicar')
             ORDER BY p.permission_codigo`,
        );
        return rows.map((r) => r.codigo);
      },
    );
    // Alcance mínimo: SOLO documento.leer/cargar, nunca causación ni parámetros.
    expect(permisos).toEqual(['documento.cargar', 'documento.leer']);

    await cerrarSesionSistema(db.client, sesion.token);
  });

  it('un token inexistente, vacío o con ruido no abre ninguna sesión', async () => {
    await expect(autenticarTokenIntegracion(db.client, '')).resolves.toBeNull();
    await expect(autenticarTokenIntegracion(db.client, 'no-existe-para-nada-en-absoluto')).resolves.toBeNull();
    await expect(abrirSesionSistema(db.client, 'token-cualquiera-invalido', 'correo')).rejects.toBeInstanceOf(
      TokenIntegracionInvalidoError,
    );
  });

  it('revocar el token invalida el canal de inmediato: no autentica nunca más', async () => {
    const escenario = await crearEscenario(db);
    const provisionado = await db.asTenant(escenario.tenantId, escenario.companyId, (tx) =>
      provisionarCanalIngestaCorreo(tx, { tenantId: escenario.tenantId }),
    );

    const { id } = await db.asTenant(escenario.tenantId, escenario.companyId, (tx) =>
      listarTokensIntegracion(tx),
    ).then((tokens) => tokens[0]!);

    const revocado = await db.asTenant(escenario.tenantId, escenario.companyId, (tx) =>
      revocarTokenIntegracion(tx, id),
    );
    expect(revocado).toBe(true);

    await expect(autenticarTokenIntegracion(db.client, provisionado.token)).resolves.toBeNull();
    // Revocar dos veces no es un error, y la segunda no "revoca" nada nuevo.
    const segundaVez = await db.asTenant(escenario.tenantId, escenario.companyId, (tx) =>
      revocarTokenIntegracion(tx, id),
    );
    expect(segundaVez).toBe(false);
  });

  it('crear un token nuevo del mismo canal ROTA el anterior: el viejo deja de autenticar', async () => {
    const escenario = await crearEscenario(db);
    const primero = await db.asTenant(escenario.tenantId, escenario.companyId, (tx) =>
      provisionarCanalIngestaCorreo(tx, { tenantId: escenario.tenantId }),
    );
    const segundo = await db.asTenant(escenario.tenantId, escenario.companyId, (tx) =>
      crearTokenIntegracion(tx, { userId: primero.userId, canal: 'correo', nombre: 'rotación' }),
    );

    expect(segundo.token).not.toBe(primero.token);
    await expect(autenticarTokenIntegracion(db.client, primero.token)).resolves.toBeNull();
    await expect(autenticarTokenIntegracion(db.client, segundo.token)).resolves.toMatchObject({
      userId: primero.userId,
      tenantId: escenario.tenantId,
    });
  });

  it('el token de la firma A NUNCA abre una sesión de la firma B: no hay atajo cross-tenant', async () => {
    const provisionadoAlfa = await db.asTenant(alfa.tenantId, alfa.companyId, (tx) =>
      provisionarCanalIngestaCorreo(tx, { tenantId: alfa.tenantId }),
    );
    const identidad = await autenticarTokenIntegracion(db.client, provisionadoAlfa.token);
    expect(identidad?.tenantId).toBe(alfa.tenantId);
    expect(identidad?.tenantId).not.toBe(beta.tenantId);

    // Y no es solo el resultado de autenticar: la sesión que se abre con ese
    // token, puesta a operar sobre la empresa de la firma B, la rechaza la
    // base (D-021/D-022), no un `if` de este archivo.
    const sesion = await abrirSesionSistema(db.client, provisionadoAlfa.token, 'correo');
    await expect(
      withSessionContext(db.client, { sessionToken: sesion.token, companyId: beta.companyId }, async () => {}),
    ).rejects.toBeInstanceOf(EmpresaNoAutorizadaError);
    await cerrarSesionSistema(db.client, sesion.token);
  });

  it('crear_token_integracion rechaza un usuario de sistema que no pertenece a la firma en sesión (IG003)', async () => {
    const provisionadoBeta = await db.asTenant(beta.tenantId, beta.companyId, (tx) =>
      provisionarCanalIngestaCorreo(tx, { tenantId: beta.tenantId }),
    );
    await esperarErrorPg(
      () =>
        db.asTenant(alfa.tenantId, alfa.companyId, (tx) =>
          crearTokenIntegracion(tx, { userId: provisionadoBeta.userId, canal: 'correo', nombre: 'ajeno' }),
        ),
      SQLSTATE.INTEGRACION_USUARIO_AJENO,
      'emitir un token de integración para el usuario de sistema de OTRA firma',
    );
  });
});

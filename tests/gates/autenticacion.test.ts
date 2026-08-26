/**
 * COMPUERTA DE AUTENTICACIÓN — Agente A12, Ola 0
 *
 * Tres bloques:
 *
 *  1. Derivación de clave (scrypt). Se verifica el formato autodescriptivo, que
 *     dos derivaciones de la misma contraseña no coincidan (sal aleatoria) y
 *     que un registro corrupto no haga pasar a nadie.
 *  2. TOTP. Se verifica contra los VECTORES DE PRUEBA DE LOS RFC: RFC 4226
 *     (HOTP, apéndice D) y RFC 6238 (TOTP, apéndice B). Es la única forma
 *     honesta de afirmar que una implementación propia es correcta.
 *  3. Flujo completo contra la base: inicio de sesión correcto, contraseña
 *     equivocada, usuario inexistente, usuario inactivo, bloqueo por intentos,
 *     MFA exigido y cierre de sesión. Cada fallo tiene que dejar rastro en
 *     `audit_log` con usuario, marca de tiempo e IP.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb } from '../helpers/db.js';
import type { TestDb } from '../helpers/db.js';
import { crearEscenario, crearUsuarioConCredencial } from '../helpers/fixtures.js';
import type { Escenario } from '../helpers/fixtures.js';
import {
  ALGORITMO_PASSWORD,
  LONGITUD_MINIMA_PASSWORD,
  PasswordDebilError,
  hashearPassword,
  necesitaRehash,
  verificarPassword,
} from '../../src/auth/password.js';
import {
  base32Decode,
  base32Encode,
  generarCodigoTotp,
  generarSecretoTotp,
  hotp,
  uriOtpauth,
  verificarCodigoTotp,
} from '../../src/auth/totp.js';
import {
  CifradoInvalidoError,
  cifrar,
  claveDesdeBase64,
  descifrar,
  generarClave,
} from '../../src/auth/cifrado.js';
import { CredencialInvalidaError, iniciarSesion } from '../../src/auth/autenticacion.js';
import { cerrarSesion, revocarSesionesDeUsuario } from '../../src/auth/sesion.js';
import { withSessionContext, SesionInvalidaError } from '../../src/db/tenant-context.js';
import { ROLES } from '../../src/auth/permisos.js';

let db: TestDb;
let e: Escenario;
const CLAVE = claveDesdeBase64(generarClave());

beforeAll(async () => {
  db = await createTestDb();
  e = await crearEscenario(db);
});

afterAll(async () => {
  await db?.close();
});

// =============================================================================
describe('Derivación de clave — scrypt, no hash plano', () => {
  it('el registro almacenado dice qué algoritmo y qué parámetros se usaron', async () => {
    const hash = await hashearPassword('contrasena-de-prueba-larga');
    const [algoritmo, params, sal, clave] = hash.split('$');
    expect(algoritmo).toBe(ALGORITMO_PASSWORD);
    expect(params).toBe('N=16384,r=8,p=1');
    expect(Buffer.from(sal!, 'base64url')).toHaveLength(16);
    expect(Buffer.from(clave!, 'base64url')).toHaveLength(32);
  });

  it('no es un SHA plano: la misma contraseña produce registros distintos', async () => {
    const a = await hashearPassword('contrasena-de-prueba-larga');
    const b = await hashearPassword('contrasena-de-prueba-larga');
    expect(a).not.toBe(b);
    expect(await verificarPassword('contrasena-de-prueba-larga', a)).toBe(true);
    expect(await verificarPassword('contrasena-de-prueba-larga', b)).toBe(true);
  });

  it('verifica la correcta y rechaza la incorrecta', async () => {
    const hash = await hashearPassword('Zapatos-de-charol-2026');
    expect(await verificarPassword('Zapatos-de-charol-2026', hash)).toBe(true);
    expect(await verificarPassword('zapatos-de-charol-2026', hash)).toBe(false);
    expect(await verificarPassword('', hash)).toBe(false);
  });

  it('un registro ausente o corrupto devuelve false, no deja pasar ni revienta', async () => {
    expect(await verificarPassword('lo-que-sea', null)).toBe(false);
    expect(await verificarPassword('lo-que-sea', '')).toBe(false);
    expect(await verificarPassword('lo-que-sea', 'sha256$abc$def')).toBe(false);
    expect(await verificarPassword('lo-que-sea', 'scrypt$N=1,r=1,p=1$c2Fs$Y2xhdmU')).toBe(false);
    expect(await verificarPassword('lo-que-sea', 'basura')).toBe(false);
  });

  it('exige longitud mínima de contraseña', async () => {
    await expect(hashearPassword('corta')).rejects.toBeInstanceOf(PasswordDebilError);
    await expect(hashearPassword('a'.repeat(LONGITUD_MINIMA_PASSWORD - 1))).rejects.toThrow();
    await expect(hashearPassword('a'.repeat(LONGITUD_MINIMA_PASSWORD))).resolves.toBeTruthy();
  });

  it('detecta registros derivados con parámetros más débiles que los vigentes', async () => {
    const debil = await hashearPassword('contrasena-de-prueba-larga', { N: 4096, r: 8, p: 1 });
    expect(necesitaRehash(debil)).toBe(true);
    expect(necesitaRehash(await hashearPassword('contrasena-de-prueba-larga'))).toBe(false);
    expect(necesitaRehash(null)).toBe(true);
  });
});

// =============================================================================
describe('TOTP — verificado contra los vectores de prueba de los RFC', () => {
  // RFC 4226, apéndice D. Secreto ASCII "12345678901234567890".
  const SECRETO_RFC = Buffer.from('12345678901234567890', 'ascii');
  const HOTP_RFC4226 = [
    '755224', '287082', '359152', '969429', '338314',
    '254676', '287922', '162583', '399871', '520489',
  ];

  it('HOTP reproduce los diez vectores del RFC 4226', () => {
    const obtenidos = HOTP_RFC4226.map((_, contador) => hotp(SECRETO_RFC, contador, 6, 'sha1'));
    expect(obtenidos).toEqual(HOTP_RFC4226);
  });

  it('TOTP reproduce los vectores SHA-1 del RFC 6238', () => {
    const secretoBase32 = base32Encode(SECRETO_RFC);
    const vectores: [number, string][] = [
      [59, '94287082'],
      [1111111109, '07081804'],
      [1111111111, '14050471'],
      [1234567890, '89005924'],
      [2000000000, '69279037'],
      [20000000000, '65353130'],
    ];
    for (const [segundos, esperado] of vectores) {
      expect(
        generarCodigoTotp(secretoBase32, { ahora: segundos * 1000, digitos: 8, algoritmo: 'sha1' }),
      ).toBe(esperado);
    }
  });

  it('el Base32 va y vuelve sin perder un byte', () => {
    const datos = Buffer.from('12345678901234567890', 'ascii');
    expect(base32Encode(datos)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode(base32Encode(datos)).equals(datos)).toBe(true);
    const aleatorio = Buffer.from(generarSecretoTotp(20), 'ascii');
    expect(base32Decode(base32Encode(aleatorio)).equals(aleatorio)).toBe(true);
  });

  it('acepta el código del paso anterior y del siguiente (reloj corrido), no más', () => {
    const secreto = generarSecretoTotp();
    const ahora = 1_700_000_000_000;

    expect(verificarCodigoTotp(secreto, generarCodigoTotp(secreto, { ahora }), { ahora })).toBe(0);
    expect(
      verificarCodigoTotp(secreto, generarCodigoTotp(secreto, { ahora: ahora - 30_000 }), { ahora }),
    ).toBe(-1);
    expect(
      verificarCodigoTotp(secreto, generarCodigoTotp(secreto, { ahora: ahora + 30_000 }), { ahora }),
    ).toBe(1);
    // Dos pasos fuera ya no vale.
    expect(
      verificarCodigoTotp(secreto, generarCodigoTotp(secreto, { ahora: ahora + 90_000 }), { ahora }),
    ).toBeNull();
  });

  it('rechaza códigos mal formados sin lanzar', () => {
    const secreto = generarSecretoTotp();
    expect(verificarCodigoTotp(secreto, '')).toBeNull();
    expect(verificarCodigoTotp(secreto, '12345')).toBeNull();
    expect(verificarCodigoTotp(secreto, 'abcdef')).toBeNull();
    expect(verificarCodigoTotp(secreto, '0000000')).toBeNull();
  });

  it('el URI otpauth lleva emisor, cuenta y parámetros', () => {
    const uri = uriOtpauth({
      secretoBase32: 'GEZDGNBVGY3TQOJQ',
      cuenta: 'contador@firma.co',
      emisor: 'Contable CO',
    });
    expect(uri).toContain('otpauth://totp/Contable%20CO:contador%40firma.co');
    expect(uri).toContain('secret=GEZDGNBVGY3TQOJQ');
    expect(uri).toContain('algorithm=SHA1');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });
});

// =============================================================================
describe('Sobre de cifrado del secreto de MFA', () => {
  it('cifra y descifra sin perder el secreto', () => {
    const secreto = generarSecretoTotp();
    const envuelto = cifrar(secreto, CLAVE);
    expect(envuelto.startsWith('gcm1$')).toBe(true);
    expect(envuelto).not.toContain(secreto);
    expect(descifrar(envuelto, CLAVE)).toBe(secreto);
  });

  it('dos cifrados del mismo secreto son distintos (IV aleatorio)', () => {
    const secreto = generarSecretoTotp();
    expect(cifrar(secreto, CLAVE)).not.toBe(cifrar(secreto, CLAVE));
  });

  it('con otra clave no descifra: falla, no devuelve basura', () => {
    const envuelto = cifrar('SECRETO', CLAVE);
    expect(() => descifrar(envuelto, claveDesdeBase64(generarClave()))).toThrow(
      CifradoInvalidoError,
    );
  });

  it('detecta la manipulación del texto cifrado (GCM autentica)', () => {
    const envuelto = cifrar('SECRETO', CLAVE);
    const partes = envuelto.split('$');
    const datos = Buffer.from(partes[3]!, 'base64url');
    datos[0] = datos[0]! ^ 0xff;
    partes[3] = datos.toString('base64url');
    expect(() => descifrar(partes.join('$'), CLAVE)).toThrow(CifradoInvalidoError);
  });
});

// =============================================================================
describe('Flujo de autenticación contra la base de datos', () => {
  it('con la contraseña correcta emite una sesión utilizable', async () => {
    const u = await crearUsuarioConCredencial(db, e.tenantId, {
      companyId: e.companyId,
      roleId: ROLES.CONTADOR,
    });

    const sesion = await iniciarSesion(db.client, {
      email: u.email,
      password: u.password,
      ip: '198.51.100.30',
      userAgent: 'vitest',
    });

    expect(sesion.token).toBeTruthy();
    expect(sesion.tenantId).toBe(e.tenantId);
    expect(sesion.userId).toBe(u.userId);
    expect(sesion.expiraEn.getTime()).toBeGreaterThan(Date.now());

    const contexto = await withSessionContext(
      db.client,
      { sessionToken: sesion.token, companyId: e.companyId },
      async (tx) => {
        const { rows } = await tx.query<{ tenant: string; empresa: string; usuario: string }>(
          `SELECT app.current_tenant_id() AS tenant,
                  app.current_company_id() AS empresa,
                  app.current_user_id()   AS usuario`,
        );
        return rows[0]!;
      },
    );

    expect(contexto.tenant).toBe(e.tenantId);
    expect(contexto.empresa).toBe(e.companyId);
    expect(contexto.usuario).toBe(u.userId);
  });

  it('el inicio de sesión correcto queda registrado como LOGIN con IP', async () => {
    const u = await crearUsuarioConCredencial(db, e.tenantId, { companyId: e.companyId });
    await iniciarSesion(db.client, {
      email: u.email,
      password: u.password,
      ip: '198.51.100.31',
    });

    const registro = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ accion: string; ip: string; ocurrido_en: string | Date }>(
        `SELECT accion, host(ip) AS ip, ocurrido_en FROM audit_log
          WHERE user_id = $1 AND accion = 'LOGIN' ORDER BY id DESC LIMIT 1`,
        [u.userId],
      );
      return rows[0];
    });

    expect(registro).toBeDefined();
    expect(registro!.ip).toBe('198.51.100.31');
    expect(new Date(registro!.ocurrido_en).getTime()).toBeGreaterThan(0);
  });

  it('la contraseña equivocada falla y deja rastro ACCESO_DENEGADO con usuario, IP y hora', async () => {
    const u = await crearUsuarioConCredencial(db, e.tenantId, { companyId: e.companyId });

    await expect(
      iniciarSesion(db.client, {
        email: u.email,
        password: 'esta-no-es-la-contrasena',
        ip: '198.51.100.32',
      }),
    ).rejects.toBeInstanceOf(CredencialInvalidaError);

    const registro = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{
        accion: string;
        entidad: string;
        entidad_id: string;
        user_id: string | null;
        ip: string;
        ocurrido_en: string | Date;
        valor_nuevo: Record<string, unknown>;
      }>(
        `SELECT accion, entidad, entidad_id, user_id, host(ip) AS ip, ocurrido_en, valor_nuevo
           FROM audit_log
          WHERE accion = 'ACCESO_DENEGADO' AND entidad = 'autenticacion' AND entidad_id = $1
          ORDER BY id DESC LIMIT 1`,
        [u.email],
      );
      return rows[0];
    });

    expect(registro).toBeDefined();
    expect(registro!.user_id).toBe(u.userId);
    expect(registro!.ip).toBe('198.51.100.32');
    expect(registro!.valor_nuevo['motivo']).toBe('password_incorrecta');
    expect(new Date(registro!.ocurrido_en).getTime()).toBeGreaterThan(0);
  });

  it('un correo que no existe también se registra: si no, el audit_log oculta la enumeración', async () => {
    const inexistente = `fantasma-${Date.now()}@ejemplo.co`;
    await expect(
      iniciarSesion(db.client, {
        email: inexistente,
        password: 'lo-que-sea-largo-aqui',
        ip: '198.51.100.33',
      }),
    ).rejects.toMatchObject({ motivo: 'usuario_inexistente' });

    const registro = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ user_id: string | null; tenant_id: string | null }>(
        `SELECT user_id, tenant_id FROM audit_log
          WHERE accion = 'ACCESO_DENEGADO' AND entidad_id = $1 ORDER BY id DESC LIMIT 1`,
        [inexistente],
      );
      return rows[0];
    });

    expect(registro).toBeDefined();
    expect(registro!.user_id).toBeNull();
  });

  it('un usuario suspendido no entra aunque la contraseña sea correcta', async () => {
    const u = await crearUsuarioConCredencial(db, e.tenantId, {
      companyId: e.companyId,
      estado: 'suspendido',
    });
    await expect(
      iniciarSesion(db.client, { email: u.email, password: u.password }),
    ).rejects.toMatchObject({ motivo: 'usuario_inactivo' });
  });

  it('cinco intentos fallidos bloquean la cuenta, y el bloqueo lo impone la base', async () => {
    const u = await crearUsuarioConCredencial(db, e.tenantId, { companyId: e.companyId });

    for (let i = 0; i < 5; i += 1) {
      await expect(
        iniciarSesion(db.client, { email: u.email, password: 'clave-equivocada-larga' }),
      ).rejects.toBeInstanceOf(CredencialInvalidaError);
    }

    const estado = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ intentos: number; bloqueado: string | Date | null }>(
        'SELECT intentos_fallidos AS intentos, bloqueado_hasta AS bloqueado FROM "user" WHERE id = $1',
        [u.userId],
      );
      return rows[0]!;
    });
    expect(Number(estado.intentos)).toBeGreaterThanOrEqual(5);
    expect(estado.bloqueado).not.toBeNull();

    // Con la contraseña CORRECTA sigue sin entrar mientras dure el bloqueo.
    await expect(
      iniciarSesion(db.client, { email: u.email, password: u.password }),
    ).rejects.toMatchObject({ motivo: 'usuario_bloqueado' });
  });

  it('un inicio de sesión correcto pone el contador de intentos en cero', async () => {
    const u = await crearUsuarioConCredencial(db, e.tenantId, { companyId: e.companyId });
    await expect(
      iniciarSesion(db.client, { email: u.email, password: 'clave-equivocada-larga' }),
    ).rejects.toBeInstanceOf(CredencialInvalidaError);
    await iniciarSesion(db.client, { email: u.email, password: u.password });

    const intentos = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        'SELECT intentos_fallidos AS n FROM "user" WHERE id = $1',
        [u.userId],
      );
      return Number(rows[0]!.n);
    });
    expect(intentos).toBe(0);
  });

  it('con MFA habilitado exige el código TOTP y lo verifica de verdad', async () => {
    const u = await crearUsuarioConCredencial(db, e.tenantId, {
      companyId: e.companyId,
      conMfa: true,
      claveCifrado: CLAVE,
    });
    expect(u.secretoTotp).toBeTruthy();

    // Sin código: no entra.
    await expect(
      iniciarSesion(db.client, {
        email: u.email,
        password: u.password,
        claveCifrado: CLAVE,
      }),
    ).rejects.toMatchObject({ motivo: 'mfa_requerido' });

    // Con un código equivocado: tampoco.
    await expect(
      iniciarSesion(db.client, {
        email: u.email,
        password: u.password,
        codigoTotp: '000000',
        claveCifrado: CLAVE,
      }),
    ).rejects.toMatchObject({ motivo: 'mfa_incorrecto' });

    // Con el código correcto: entra, y la sesión queda marcada con MFA superado.
    const sesion = await iniciarSesion(db.client, {
      email: u.email,
      password: u.password,
      codigoTotp: generarCodigoTotp(u.secretoTotp!),
      claveCifrado: CLAVE,
    });
    expect(sesion.mfaSuperado).toBe(true);
  });

  it('el secreto de MFA se guarda cifrado: la base no tiene el Base32 en claro', async () => {
    const u = await crearUsuarioConCredencial(db, e.tenantId, {
      companyId: e.companyId,
      conMfa: true,
      claveCifrado: CLAVE,
    });

    const guardado = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ secreto: string; alg: string }>(
        'SELECT mfa_secret_cifrado AS secreto, mfa_secret_alg AS alg FROM "user" WHERE id = $1',
        [u.userId],
      );
      return rows[0]!;
    });

    expect(guardado.alg).toBe('gcm1');
    expect(guardado.secreto).not.toContain(u.secretoTotp!);
    expect(descifrar(guardado.secreto, CLAVE)).toBe(u.secretoTotp);
  });

  it('cerrar sesión la invalida de inmediato y lo registra', async () => {
    const u = await crearUsuarioConCredencial(db, e.tenantId, { companyId: e.companyId });
    const sesion = await iniciarSesion(db.client, { email: u.email, password: u.password });

    expect(await cerrarSesion(db.client, sesion.token)).toBe(true);

    await expect(
      withSessionContext(db.client, { sessionToken: sesion.token }, async (tx) =>
        tx.query('SELECT 1'),
      ),
    ).rejects.toBeInstanceOf(SesionInvalidaError);

    const registro = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM audit_log
          WHERE accion = 'LOGOUT' AND entidad_id = $1`,
        [sesion.sessionId],
      );
      return rows[0]!.n;
    });
    expect(registro).toBe(1);

    // Cerrarla dos veces no revienta ni miente.
    expect(await cerrarSesion(db.client, sesion.token)).toBe(false);
  });

  it('revocar las sesiones de un usuario corta todas a la vez', async () => {
    const u = await crearUsuarioConCredencial(db, e.tenantId, { companyId: e.companyId });
    const s1 = await iniciarSesion(db.client, { email: u.email, password: u.password });
    const s2 = await iniciarSesion(db.client, { email: u.email, password: u.password });

    expect(await revocarSesionesDeUsuario(db.client, u.userId)).toBeGreaterThanOrEqual(2);

    for (const s of [s1, s2]) {
      await expect(
        withSessionContext(db.client, { sessionToken: s.token }, async (tx) => tx.query('SELECT 1')),
      ).rejects.toBeInstanceOf(SesionInvalidaError);
    }
  });

  it('el espejo visible user_session concuerda con la autoridad app.session_context', async () => {
    const u = await crearUsuarioConCredencial(db, e.tenantId, { companyId: e.companyId });
    const sesion = await iniciarSesion(db.client, {
      email: u.email,
      password: u.password,
      ip: '198.51.100.34',
    });

    const comparacion = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ iguales: boolean }>(
        `SELECT (us.token_hash = sc.token_hash
                 AND us.tenant_id = sc.tenant_id
                 AND us.user_id   = sc.user_id
                 AND us.expira_en = sc.expira_en) AS iguales
           FROM user_session us JOIN app.session_context sc ON sc.id = us.id
          WHERE us.id = $1`,
        [sesion.sessionId],
      );
      return rows[0];
    });

    expect(comparacion?.iguales).toBe(true);
  });

  it('la aplicación no puede escribir el registro de sesiones a mano', async () => {
    const privilegios = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ p: string }>(
        `SELECT priv.p FROM (VALUES ('INSERT'),('UPDATE'),('DELETE')) AS priv(p)
          WHERE has_table_privilege('app_user', 'public.user_session', priv.p)`,
      );
      return rows.map((r) => r.p);
    });
    expect(privilegios).toEqual([]);
  });

  it('una sesión sin empresa no ve datos de empresa, pero sigue siendo válida', async () => {
    const u = await crearUsuarioConCredencial(db, e.tenantId, { companyId: e.companyId });
    const sesion = await iniciarSesion(db.client, { email: u.email, password: u.password });

    const resultado = await withSessionContext(
      db.client,
      { sessionToken: sesion.token, companyId: null },
      async (tx) => {
        const { rows } = await tx.query<{ tenant: string; empresa: string | null; n: number }>(
          `SELECT app.current_tenant_id()  AS tenant,
                  app.current_company_id() AS empresa,
                  (SELECT count(*)::int FROM third_party) AS n`,
        );
        return rows[0]!;
      },
    );

    expect(resultado.tenant).toBe(e.tenantId);
    expect(resultado.empresa).toBeNull();
    expect(resultado.n).toBe(0);
  });
});

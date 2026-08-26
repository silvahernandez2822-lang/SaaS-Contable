/**
 * Derivación de clave para contraseñas — Agente A12.
 *
 * Se usa **scrypt** de `node:crypto`, no un hash plano. La diferencia no es
 * cosmética: SHA-256 de una contraseña se prueba a miles de millones por
 * segundo en una GPU; scrypt está diseñado para ser costoso en memoria y
 * vuelve inviable ese ataque.
 *
 * NO se instala ninguna dependencia (bcrypt, argon2). Motivos, contra el
 * presupuesto de USD 20/mes y la restricción de 1 desarrollador:
 *  - `scrypt` es primitiva estándar (RFC 7914) y viene en el runtime; argon2 y
 *    bcrypt en Node son módulos nativos que hay que compilar por plataforma y
 *    complican el despliegue sin aportar seguridad relevante a estos
 *    parámetros.
 *  - No se inventa criptografía: se llama a la implementación del runtime.
 *
 * PARÁMETROS: N=2^14, r=8, p=1, clave de 32 bytes, sal de 16 bytes aleatorios.
 * Costo de memoria = 128·N·r ≈ 16 MiB por verificación, dentro del `maxmem`
 * por defecto de Node (32 MiB). Los parámetros van DENTRO del registro, así que
 * subirlos más adelante no invalida las contraseñas ya guardadas.
 *
 * FORMATO ALMACENADO (columna `"user".password_hash`):
 *   scrypt$N=16384,r=8,p=1$<sal base64url>$<clave base64url>
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

export const ALGORITMO_PASSWORD = 'scrypt';

export interface ParametrosScrypt {
  N: number;
  r: number;
  p: number;
}

/** Parámetros vigentes. Subirlos no invalida los registros anteriores. */
export const PARAMETROS_ACTUALES: ParametrosScrypt = { N: 16384, r: 8, p: 1 };

const LONGITUD_CLAVE = 32;
const LONGITUD_SAL = 16;
/** Holgura sobre 128·N·r para que un N mayor no choque con el límite de Node. */
const MAXMEM = 64 * 1024 * 1024;

/** Longitud mínima de contraseña. Doce caracteres, sin exigir símbolos: la
 *  longitud aporta más entropía real que las reglas de composición. */
export const LONGITUD_MINIMA_PASSWORD = 12;

export class PasswordDebilError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'PasswordDebilError';
  }
}

function b64url(b: Buffer): string {
  return b.toString('base64url');
}

/** Verifica la política mínima de contraseña. Lanza si no la cumple. */
export function exigirPasswordAceptable(password: string): void {
  if (typeof password !== 'string' || password.length < LONGITUD_MINIMA_PASSWORD) {
    throw new PasswordDebilError(
      `La contraseña debe tener al menos ${LONGITUD_MINIMA_PASSWORD} caracteres.`,
    );
  }
  if (password.trim().length === 0) {
    throw new PasswordDebilError('La contraseña no puede ser solo espacios.');
  }
}

/** Deriva la contraseña y devuelve el registro autodescriptivo a almacenar. */
export async function hashearPassword(
  password: string,
  parametros: ParametrosScrypt = PARAMETROS_ACTUALES,
): Promise<string> {
  exigirPasswordAceptable(password);
  const sal = randomBytes(LONGITUD_SAL);
  const clave = await scrypt(password.normalize('NFKC'), sal, LONGITUD_CLAVE, {
    ...parametros,
    maxmem: MAXMEM,
  });
  return `${ALGORITMO_PASSWORD}$N=${parametros.N},r=${parametros.r},p=${parametros.p}$${b64url(sal)}$${b64url(clave)}`;
}

interface RegistroPassword {
  parametros: ParametrosScrypt;
  sal: Buffer;
  clave: Buffer;
}

function interpretar(almacenado: string): RegistroPassword | null {
  const partes = almacenado.split('$');
  if (partes.length !== 4) return null;
  const [algoritmo, params, sal, clave] = partes as [string, string, string, string];
  if (algoritmo !== ALGORITMO_PASSWORD) return null;

  const m = /^N=(\d+),r=(\d+),p=(\d+)$/.exec(params);
  if (!m) return null;
  const N = Number(m[1]);
  const r = Number(m[2]);
  const p = Number(m[3]);
  if (!Number.isSafeInteger(N) || !Number.isSafeInteger(r) || !Number.isSafeInteger(p)) return null;
  if (N < 1024 || r < 1 || p < 1) return null;

  try {
    return {
      parametros: { N, r, p },
      sal: Buffer.from(sal, 'base64url'),
      clave: Buffer.from(clave, 'base64url'),
    };
  } catch {
    return null;
  }
}

/**
 * Verifica una contraseña contra el registro almacenado.
 *
 * Devuelve `false` en vez de lanzar cuando el registro está ausente o mal
 * formado: el llamador no debe poder distinguir "usuario sin contraseña" de
 * "contraseña equivocada" por el tipo de error.
 */
export async function verificarPassword(
  password: string,
  almacenado: string | null | undefined,
): Promise<boolean> {
  if (typeof password !== 'string' || password === '') return false;
  if (!almacenado) return false;

  const registro = interpretar(almacenado);
  if (!registro || registro.clave.length === 0) return false;

  let candidata: Buffer;
  try {
    candidata = await scrypt(password.normalize('NFKC'), registro.sal, registro.clave.length, {
      ...registro.parametros,
      maxmem: MAXMEM,
    });
  } catch {
    return false;
  }

  // Comparación en tiempo constante: comparar con === filtra información por
  // el tiempo de respuesta.
  return candidata.length === registro.clave.length && timingSafeEqual(candidata, registro.clave);
}

/** ¿El registro fue creado con parámetros más débiles que los vigentes?
 *  Si es así, conviene volver a derivar al siguiente inicio de sesión. */
export function necesitaRehash(
  almacenado: string | null | undefined,
  parametros: ParametrosScrypt = PARAMETROS_ACTUALES,
): boolean {
  if (!almacenado) return true;
  const registro = interpretar(almacenado);
  if (!registro) return true;
  return (
    registro.parametros.N < parametros.N ||
    registro.parametros.r < parametros.r ||
    registro.parametros.p < parametros.p
  );
}

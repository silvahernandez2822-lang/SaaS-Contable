/**
 * Segundo factor TOTP — Agente A12.
 *
 * Implementa HOTP (RFC 4226) y TOTP (RFC 6238) sobre el HMAC de `node:crypto`.
 * Esto NO es inventar criptografía: la primitiva (HMAC-SHA1/256/512) la pone el
 * runtime; aquí solo está el envoltorio de contador, truncamiento dinámico y
 * ventana de tiempo que describen los RFC, más el Base32 de RFC 4648 que usan
 * las aplicaciones autenticadoras.
 *
 * Se prefiere a una dependencia (`otplib`, `speakeasy`) porque son ~120 líneas
 * de especificación pública, verificables contra los vectores de prueba de los
 * propios RFC — y esas pruebas están en `tests/gates/autenticacion.test.ts`.
 * Una dependencia más es superficie de suministro que hay que auditar y
 * actualizar, con presupuesto de un desarrollador.
 *
 * El secreto se guarda cifrado en `"user".mfa_secret_cifrado` (ver cifrado.ts).
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export type AlgoritmoTotp = 'sha1' | 'sha256' | 'sha512';

export interface OpcionesTotp {
  /** Segundos por paso. RFC 6238 recomienda 30. */
  paso?: number;
  /** Dígitos del código. Las apps autenticadoras usan 6. */
  digitos?: number;
  algoritmo?: AlgoritmoTotp;
  /** Momento de referencia en milisegundos. Por defecto `Date.now()`. */
  ahora?: number;
  /** Pasos de tolerancia hacia atrás y hacia adelante (desfase de reloj). */
  ventana?: number;
}

export const OPCIONES_POR_DEFECTO: Required<Omit<OpcionesTotp, 'ahora'>> = {
  paso: 30,
  digitos: 6,
  algoritmo: 'sha1',
  ventana: 1,
};

// -----------------------------------------------------------------------------
// Base32 (RFC 4648, sin relleno) — el formato que aceptan las apps TOTP.
// -----------------------------------------------------------------------------
const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(datos: Buffer): string {
  let bits = 0;
  let valor = 0;
  let salida = '';
  for (const byte of datos) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      salida += ALFABETO[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) salida += ALFABETO[(valor << (5 - bits)) & 31];
  return salida;
}

export function base32Decode(texto: string): Buffer {
  const limpio = texto.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let valor = 0;
  const bytes: number[] = [];
  for (const c of limpio) {
    const i = ALFABETO.indexOf(c);
    if (i === -1) throw new Error(`Carácter no válido en secreto Base32: ${JSON.stringify(c)}`);
    valor = (valor << 5) | i;
    bits += 5;
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Secreto nuevo. 20 bytes = 160 bits, lo que recomienda RFC 4226 para SHA-1. */
export function generarSecretoTotp(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

// -----------------------------------------------------------------------------
// HOTP (RFC 4226) — truncamiento dinámico
// -----------------------------------------------------------------------------
export function hotp(
  secreto: Buffer,
  contador: number | bigint,
  digitos = 6,
  algoritmo: AlgoritmoTotp = 'sha1',
): string {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(contador));

  const digest = createHmac(algoritmo, secreto).update(buffer).digest();
  const desplazamiento = digest[digest.length - 1]! & 0x0f;
  const binario =
    ((digest[desplazamiento]! & 0x7f) << 24) |
    ((digest[desplazamiento + 1]! & 0xff) << 16) |
    ((digest[desplazamiento + 2]! & 0xff) << 8) |
    (digest[desplazamiento + 3]! & 0xff);

  return (binario % 10 ** digitos).toString().padStart(digitos, '0');
}

// -----------------------------------------------------------------------------
// TOTP (RFC 6238)
// -----------------------------------------------------------------------------
export function contadorTotp(ahoraMs: number, paso: number): number {
  return Math.floor(ahoraMs / 1000 / paso);
}

export function generarCodigoTotp(secretoBase32: string, opciones: OpcionesTotp = {}): string {
  const o = { ...OPCIONES_POR_DEFECTO, ...opciones };
  const ahora = opciones.ahora ?? Date.now();
  return hotp(base32Decode(secretoBase32), contadorTotp(ahora, o.paso), o.digitos, o.algoritmo);
}

/**
 * Verifica un código con tolerancia de ±`ventana` pasos.
 *
 * La comparación es en tiempo constante. Devuelve el desfase en pasos cuando
 * acierta (0 = paso actual) y `null` cuando no; el desfase le sirve al llamador
 * para detectar relojes corridos.
 */
export function verificarCodigoTotp(
  secretoBase32: string,
  codigo: string,
  opciones: OpcionesTotp = {},
): number | null {
  const o = { ...OPCIONES_POR_DEFECTO, ...opciones };
  if (typeof codigo !== 'string') return null;
  const limpio = codigo.replace(/\s+/g, '');
  if (!new RegExp(`^\\d{${o.digitos}}$`).test(limpio)) return null;

  const ahora = opciones.ahora ?? Date.now();
  const base = contadorTotp(ahora, o.paso);
  const secreto = base32Decode(secretoBase32);
  const esperado = Buffer.from(limpio, 'utf8');

  for (let d = -o.ventana; d <= o.ventana; d += 1) {
    const contador = base + d;
    if (contador < 0) continue;
    const candidato = Buffer.from(hotp(secreto, contador, o.digitos, o.algoritmo), 'utf8');
    if (candidato.length === esperado.length && timingSafeEqual(candidato, esperado)) {
      return d;
    }
  }
  return null;
}

/**
 * URI `otpauth://` para el código QR de la app autenticadora.
 * `emisor` y `cuenta` van percent-encoded; el secreto viaja en Base32.
 */
export function uriOtpauth(params: {
  secretoBase32: string;
  cuenta: string;
  emisor: string;
  digitos?: number;
  paso?: number;
  algoritmo?: AlgoritmoTotp;
}): string {
  const digitos = params.digitos ?? OPCIONES_POR_DEFECTO.digitos;
  const paso = params.paso ?? OPCIONES_POR_DEFECTO.paso;
  const algoritmo = (params.algoritmo ?? OPCIONES_POR_DEFECTO.algoritmo).toUpperCase();
  const etiqueta = `${encodeURIComponent(params.emisor)}:${encodeURIComponent(params.cuenta)}`;
  const consulta = new URLSearchParams({
    secret: params.secretoBase32,
    issuer: params.emisor,
    algorithm: algoritmo,
    digits: String(digitos),
    period: String(paso),
  });
  return `otpauth://totp/${etiqueta}?${consulta.toString()}`;
}

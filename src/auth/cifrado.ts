/**
 * Sobre de cifrado de aplicación — Agente A12.
 *
 * PARA QUÉ: el cifrado en reposo del Postgres gestionado (Supabase/Neon) protege
 * el disco, no la fila. Quien obtenga un volcado lógico legítimo —un `pg_dump`,
 * un respaldo restaurado, un soporte del proveedor— ve el contenido en claro.
 * Por eso el secreto TOTP lleva una segunda envoltura hecha por la aplicación:
 * sin `APP_ENCRYPTION_KEY`, un volcado de la base no alcanza para clonar el
 * segundo factor de nadie.
 *
 * QUÉ: AES-256-GCM de `node:crypto`. Cifrado autenticado, con IV de 96 bits
 * aleatorio por operación y etiqueta de 128 bits. El identificador de esquema
 * viaja dentro del registro para poder rotar sin migrar datos.
 *
 * FORMATO: gcm1$<iv base64url>$<tag base64url>$<cifrado base64url>
 *
 * LA CLAVE NO SE GUARDA EN LA BASE. Vive en la variable de entorno
 * `APP_ENCRYPTION_KEY` (32 bytes en base64), que se administra en el proveedor
 * de despliegue. Si estuviera en la misma base que protege, no protegería nada.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const ESQUEMA_CIFRADO = 'gcm1';
const LONGITUD_IV = 12;
const LONGITUD_CLAVE = 32;
export const VARIABLE_CLAVE = 'APP_ENCRYPTION_KEY';

export class ClaveCifradoAusenteError extends Error {
  constructor() {
    super(
      `Falta la variable de entorno ${VARIABLE_CLAVE} (32 bytes en base64). ` +
        'Sin ella no se puede cifrar ni descifrar el secreto de MFA. ' +
        'Genérela con: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
    this.name = 'ClaveCifradoAusenteError';
  }
}

export class CifradoInvalidoError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'CifradoInvalidoError';
  }
}

/** Interpreta una clave de 32 bytes en base64 (o base64url). */
export function claveDesdeBase64(valor: string): Buffer {
  const clave = Buffer.from(valor, 'base64');
  if (clave.length !== LONGITUD_CLAVE) {
    throw new CifradoInvalidoError(
      `La clave de cifrado debe tener ${LONGITUD_CLAVE} bytes; llegaron ${clave.length}.`,
    );
  }
  return clave;
}

/** Clave de aplicación desde el entorno. Lanza si no está configurada. */
export function claveDeEntorno(env: NodeJS.ProcessEnv = process.env): Buffer {
  const valor = env[VARIABLE_CLAVE];
  if (!valor || valor.trim() === '') throw new ClaveCifradoAusenteError();
  return claveDesdeBase64(valor);
}

/** Genera una clave nueva. Para la puesta en marcha y la rotación. */
export function generarClave(): string {
  return randomBytes(LONGITUD_CLAVE).toString('base64');
}

export function cifrar(textoPlano: string, clave: Buffer): string {
  if (clave.length !== LONGITUD_CLAVE) {
    throw new CifradoInvalidoError(`La clave debe tener ${LONGITUD_CLAVE} bytes.`);
  }
  const iv = randomBytes(LONGITUD_IV);
  const cifrador = createCipheriv('aes-256-gcm', clave, iv);
  const datos = Buffer.concat([
    cifrador.update(Buffer.from(textoPlano, 'utf8')),
    cifrador.final(),
  ]);
  const tag = cifrador.getAuthTag();
  return `${ESQUEMA_CIFRADO}$${iv.toString('base64url')}$${tag.toString('base64url')}$${datos.toString('base64url')}`;
}

export function descifrar(registro: string, clave: Buffer): string {
  const partes = registro.split('$');
  if (partes.length !== 4 || partes[0] !== ESQUEMA_CIFRADO) {
    throw new CifradoInvalidoError('El registro cifrado no tiene el formato esperado.');
  }
  const [, ivB64, tagB64, datosB64] = partes as [string, string, string, string];
  const descifrador = createDecipheriv(
    'aes-256-gcm',
    clave,
    Buffer.from(ivB64, 'base64url'),
  );
  // GCM es cifrado autenticado: si el texto fue alterado, `final()` lanza.
  descifrador.setAuthTag(Buffer.from(tagB64, 'base64url'));
  try {
    return Buffer.concat([
      descifrador.update(Buffer.from(datosB64, 'base64url')),
      descifrador.final(),
    ]).toString('utf8');
  } catch {
    throw new CifradoInvalidoError(
      'El registro cifrado no se pudo autenticar: clave equivocada o contenido alterado.',
    );
  }
}

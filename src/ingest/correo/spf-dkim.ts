/**
 * Verificación SPF/DKIM (sección 10.3).
 *
 * LÍMITE HONESTO, documentado también en `docs/ingest-correo.md`: este
 * sistema NO resuelve SPF ni DKIM por sí mismo. Verificar SPF exige una
 * consulta DNS TXT al dominio del sobre (`MAIL FROM`) en el momento exacto de
 * la conexión SMTP, y verificar DKIM exige la clave pública del dominio
 * firmante y la firma criptográfica original del mensaje — ninguna de las dos
 * cosas está disponible después de que un proveedor de inbound email ya
 * recibió el correo y lo entrega por webhook. Por eso este módulo lee el
 * veredicto que el MTA receptor YA calculó y publicó en la cabecera estándar
 * `Authentication-Results` (RFC 8601), y no pretende hacer más que eso.
 *
 * Es una función PURA: solo interpreta texto de cabecera, ya en memoria.
 */

export type ResultadoSpf = 'pass' | 'fail' | 'softfail' | 'neutral' | 'none' | 'temperror' | 'permerror' | 'no_verificado';
export type ResultadoDkim = 'pass' | 'fail' | 'none' | 'no_verificado';

const VALORES_SPF: ReadonlySet<string> = new Set([
  'pass',
  'fail',
  'softfail',
  'neutral',
  'none',
  'temperror',
  'permerror',
]);
const VALORES_DKIM: ReadonlySet<string> = new Set(['pass', 'fail', 'none']);

export interface AutenticacionCorreo {
  spf: ResultadoSpf;
  dkim: ResultadoDkim;
}

/**
 * Busca la cabecera sin distinguir mayúsculas/minúsculas — los proveedores
 * normalizan de formas distintas ("Authentication-Results" vs. minúsculas).
 */
function buscarCabecera(headers: Record<string, string>, nombre: string): string | null {
  const claveExacta = Object.keys(headers).find((k) => k.toLowerCase() === nombre.toLowerCase());
  return claveExacta ? (headers[claveExacta] ?? null) : null;
}

/** Extrae `spf=<valor>` o `dkim=<valor>` de una cabecera Authentication-Results. */
function extraerResultado(cabecera: string, mecanismo: 'spf' | 'dkim'): string | null {
  const m = new RegExp(`\\b${mecanismo}=([a-z]+)`, 'i').exec(cabecera);
  return m ? (m[1] ?? '').toLowerCase() : null;
}

/**
 * Interpreta las cabeceras de un correo ya recibido. Si el proveedor no
 * incluyó `Authentication-Results` (o no trae el mecanismo), el resultado es
 * `no_verificado` — nunca se asume `pass` por defecto: un correo sin
 * verificación reportada se trata como no verificado, no como confiable.
 */
export function evaluarAutenticacion(headers: Record<string, string>): AutenticacionCorreo {
  const cabecera = buscarCabecera(headers, 'authentication-results');
  if (cabecera === null) {
    return { spf: 'no_verificado', dkim: 'no_verificado' };
  }

  const spfCrudo = extraerResultado(cabecera, 'spf');
  const dkimCrudo = extraerResultado(cabecera, 'dkim');

  return {
    spf: spfCrudo !== null && VALORES_SPF.has(spfCrudo) ? (spfCrudo as ResultadoSpf) : 'no_verificado',
    dkim: dkimCrudo !== null && VALORES_DKIM.has(dkimCrudo) ? (dkimCrudo as ResultadoDkim) : 'no_verificado',
  };
}

/** Política de cuarentena: solo `fail` explícito se trata como fallo duro. `no_verificado` no lo es. */
export function autenticacionFalla(auth: AutenticacionCorreo): boolean {
  return auth.spf === 'fail' || auth.dkim === 'fail';
}

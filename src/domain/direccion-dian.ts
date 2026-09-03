/**
 * D-086 · Dirección en formato DIAN (Formato 1001 de exógena).
 *
 * FUENTE de la estructura y de las abreviaturas: documento oficial de
 * nomenclatura de la DIAN (MUISCA, "Nomenclatura", tabla AC…ZN) y el
 * "Generador de Direcciones" del portal MUISCA
 * (muisca.dian.gov.co/WebRutMuisca/.../direcciones.jsp). Verificado 2026-09-02.
 *
 * El generador de la DIAN compone la dirección como una secuencia de tokens de
 * un vocabulario cerrado — NO admite texto libre. La estructura es:
 *
 *   <TIPO_VÍA_PRINCIPAL> <número><letra?> [BIS] [CUADRANTE]
 *     # <número_generadora><letra?> [CUADRANTE]
 *     - <placa>
 *     [<TIPO_COMPLEMENTO> <valor>]...
 *
 * Ejemplo: `CL 100 A BIS SUR # 15 ESTE - 20 IN 3 AP 401`
 *
 * Este módulo es PURO (sin base de datos, sin React): lo usan tanto el modal de
 * la interfaz como la acción de servidor, para que una dirección que no cumpla
 * la estructura no pueda entrar por ningún camino (Regla: sin texto libre fuera
 * de la estructura).
 *
 * Regla de Oro 2: aquí no hay ningún valor tributario. Las abreviaturas son
 * identificadores públicos y estables.
 */

export interface TipoVia {
  /** Abreviatura oficial DIAN (la que va en la cadena compuesta). */
  abrev: string;
  /** Nombre completo para el selector. */
  nombre: string;
}

/**
 * Tipos de VÍA PRINCIPAL ofrecidos por el generador DIAN. Subconjunto de la
 * nomenclatura oficial que puede encabezar una dirección (una "vía"), no los
 * complementos.
 */
export const TIPOS_VIA_PRINCIPAL: readonly TipoVia[] = [
  { abrev: 'CL', nombre: 'Calle' },
  { abrev: 'CR', nombre: 'Carrera' },
  { abrev: 'AV', nombre: 'Avenida' },
  { abrev: 'AC', nombre: 'Avenida Calle' },
  { abrev: 'AK', nombre: 'Avenida Carrera' },
  { abrev: 'DG', nombre: 'Diagonal' },
  { abrev: 'TV', nombre: 'Transversal' },
  { abrev: 'CIR', nombre: 'Circular' },
  { abrev: 'CRV', nombre: 'Circunvalar' },
  { abrev: 'AUT', nombre: 'Autopista' },
  { abrev: 'AVIAL', nombre: 'Anillo vial' },
  { abrev: 'BLV', nombre: 'Boulevard' },
  { abrev: 'PS', nombre: 'Paseo' },
  { abrev: 'PW', nombre: 'Park Way' },
  { abrev: 'VTE', nombre: 'Variante' },
  { abrev: 'CRT', nombre: 'Carretera' },
  { abrev: 'KM', nombre: 'Kilómetro' },
  { abrev: 'VRD', nombre: 'Vereda' },
  { abrev: 'C', nombre: 'Corregimiento' },
] as const;

/**
 * Tipos de COMPLEMENTO (lo que va después de la placa: interior, torre, apto…).
 * Tomados de la misma tabla de nomenclatura DIAN.
 */
export const TIPOS_COMPLEMENTO: readonly TipoVia[] = [
  { abrev: 'IN', nombre: 'Interior' },
  { abrev: 'AP', nombre: 'Apartamento' },
  { abrev: 'CA', nombre: 'Casa' },
  { abrev: 'TO', nombre: 'Torre' },
  { abrev: 'BL', nombre: 'Bloque' },
  { abrev: 'ED', nombre: 'Edificio' },
  { abrev: 'ET', nombre: 'Etapa' },
  { abrev: 'MZ', nombre: 'Manzana' },
  { abrev: 'CD', nombre: 'Ciudadela' },
  { abrev: 'UR', nombre: 'Unidad residencial' },
  { abrev: 'CON', nombre: 'Conjunto' },
  { abrev: 'AGP', nombre: 'Agrupación' },
  { abrev: 'SM', nombre: 'Súper manzana' },
  { abrev: 'LT', nombre: 'Lote' },
  { abrev: 'PD', nombre: 'Predio' },
  { abrev: 'FCA', nombre: 'Finca' },
  { abrev: 'P', nombre: 'Piso' },
  { abrev: 'OF', nombre: 'Oficina' },
  { abrev: 'LC', nombre: 'Local' },
  { abrev: 'BG', nombre: 'Bodega' },
  { abrev: 'CS', nombre: 'Consultorio' },
  { abrev: 'DP', nombre: 'Depósito' },
  { abrev: 'GJ', nombre: 'Garaje' },
  { abrev: 'PQ', nombre: 'Parqueadero' },
  { abrev: 'PH', nombre: 'Penthouse' },
  { abrev: 'ST', nombre: 'Sótano' },
  { abrev: 'MN', nombre: 'Mezzanine' },
  { abrev: 'SS', nombre: 'Semisótano' },
  { abrev: 'ZN', nombre: 'Zona' },
  { abrev: 'ZF', nombre: 'Zona franca' },
  { abrev: 'SEC', nombre: 'Sector' },
  { abrev: 'BRR', nombre: 'Barrio' },
  { abrev: 'URB', nombre: 'Urbanización' },
  { abrev: 'VRD', nombre: 'Vereda' },
  { abrev: 'PRJ', nombre: 'Paraje' },
] as const;

export const CUADRANTES = ['NORTE', 'SUR', 'ESTE', 'OESTE'] as const;
export type Cuadrante = (typeof CUADRANTES)[number];

export interface ComplementoDireccion {
  tipo: string;
  valor: string;
}

export interface DireccionDian {
  tipoVia: string;
  /** Número de la vía principal. Solo dígitos. */
  numeroVia: string;
  /** Letra de la vía principal (opcional). Una letra A–Z. */
  letraVia?: string | null;
  bisVia?: boolean;
  letraBisVia?: string | null;
  cuadranteVia?: Cuadrante | null;
  /** Número de la vía generadora (lo que va tras el "#"). Solo dígitos. */
  numeroGeneradora: string;
  letraGeneradora?: string | null;
  cuadranteGeneradora?: Cuadrante | null;
  /** Placa / número final (lo que va tras el "-"). Solo dígitos. */
  placa: string;
  complementos?: ComplementoDireccion[];
}

const ABREV_VIA = new Set(TIPOS_VIA_PRINCIPAL.map((t) => t.abrev));
const ABREV_COMPLEMENTO = new Set(TIPOS_COMPLEMENTO.map((t) => t.abrev));
const SOLO_DIGITOS = /^\d{1,4}$/;
const UNA_LETRA = /^[A-Z]$/;
/** Valor de un complemento: alfanumérico DIAN, sin separadores de vía. */
const VALOR_COMPLEMENTO = /^[A-Z0-9]{1,6}$/;

export class DireccionDianInvalidaError extends Error {
  readonly errores: string[];
  constructor(errores: string[]) {
    super(`Dirección DIAN inválida: ${errores.join(' · ')}`);
    this.name = 'DireccionDianInvalidaError';
    this.errores = errores;
  }
}

/**
 * Convierte un campo del desglose en su texto normalizado.
 *
 * A14 / D-086: esto NO puede ser `String(x)`. El desglose llega como JSON de
 * un `<input hidden>` — es decir, de fuera —, y `String()` acepta cualquier
 * cosa por coerción: `['CL'].toString()` da `'CL'` y `{toString:() => 'CL'}`
 * también. Así entraba al `jsonb` un valor que NO es del contrato y que, al
 * releerlo, ya no recompone la misma cadena. Solo se admite cadena (o número,
 * que es inequívoco y se valida aparte contra `^\d{1,4}$`); cualquier otra
 * forma se trata como campo ausente y la validación lo reporta.
 */
function texto(v: unknown): string {
  if (typeof v === 'string') return v.trim().toUpperCase();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

/**
 * Normaliza (mayúsculas, sin espacios sobrantes) sin validar, y **acota el
 * objeto a las claves del contrato**: lo que devuelve es exactamente lo que se
 * persiste, así que ninguna clave inyectada por un POST directo llega al
 * `jsonb`.
 */
export function normalizarDireccionDian(d: DireccionDian): DireccionDian {
  const crudos: unknown = (d as unknown as { complementos?: unknown })?.complementos;
  const comps = Array.isArray(crudos) ? (crudos as unknown[]) : [];
  return {
    tipoVia: texto(d?.tipoVia),
    numeroVia: texto(d?.numeroVia),
    letraVia: texto(d?.letraVia) || null,
    bisVia: d?.bisVia === true,
    letraBisVia: texto(d?.letraBisVia) || null,
    cuadranteVia: (texto(d?.cuadranteVia) || null) as Cuadrante | null,
    numeroGeneradora: texto(d?.numeroGeneradora),
    letraGeneradora: texto(d?.letraGeneradora) || null,
    cuadranteGeneradora: (texto(d?.cuadranteGeneradora) || null) as Cuadrante | null,
    placa: texto(d?.placa),
    complementos: comps
      .map((c) => {
        const o = (c ?? {}) as { tipo?: unknown; valor?: unknown };
        return { tipo: texto(o.tipo), valor: texto(o.valor) };
      })
      .filter((c) => c.tipo || c.valor),
  };
}

/** Lista de errores (vacía = válida). No lanza. */
export function validarDireccionDian(entrada: DireccionDian): string[] {
  const d = normalizarDireccionDian(entrada);
  const e: string[] = [];

  const compsCrudos: unknown = (entrada as unknown as { complementos?: unknown })?.complementos;
  if (compsCrudos != null && !Array.isArray(compsCrudos)) {
    e.push('Los complementos deben venir como una lista.');
  }
  if ((entrada as unknown) == null || typeof entrada !== 'object' || Array.isArray(entrada)) {
    e.push('El desglose de la dirección no tiene la forma esperada.');
  }

  if (!d.tipoVia) e.push('Falta el tipo de vía principal.');
  else if (!ABREV_VIA.has(d.tipoVia)) e.push(`Tipo de vía principal no reconocido ("${d.tipoVia}").`);

  if (!d.numeroVia) e.push('Falta el número de la vía principal.');
  else if (!SOLO_DIGITOS.test(d.numeroVia)) e.push('El número de la vía principal debe ser solo dígitos.');

  if (d.letraVia && !UNA_LETRA.test(d.letraVia)) e.push('La letra de la vía principal debe ser una sola letra A–Z.');
  if (d.letraBisVia && !d.bisVia) e.push('Hay letra de BIS pero la casilla BIS no está marcada.');
  if (d.letraBisVia && !UNA_LETRA.test(d.letraBisVia)) e.push('La letra de BIS debe ser una sola letra A–Z.');
  if (d.cuadranteVia && !CUADRANTES.includes(d.cuadranteVia)) e.push('Cuadrante de la vía principal no válido.');

  if (!d.numeroGeneradora) e.push('Falta el número de la vía generadora (el que va tras el "#").');
  else if (!SOLO_DIGITOS.test(d.numeroGeneradora)) e.push('El número de la vía generadora debe ser solo dígitos.');
  if (d.letraGeneradora && !UNA_LETRA.test(d.letraGeneradora)) e.push('La letra de la vía generadora debe ser una sola letra A–Z.');
  if (d.cuadranteGeneradora && !CUADRANTES.includes(d.cuadranteGeneradora)) e.push('Cuadrante de la vía generadora no válido.');

  if (!d.placa) e.push('Falta la placa (el número tras el "-").');
  else if (!SOLO_DIGITOS.test(d.placa)) e.push('La placa debe ser solo dígitos.');

  for (const c of d.complementos ?? []) {
    if (!c.tipo || !ABREV_COMPLEMENTO.has(c.tipo)) e.push(`Complemento con tipo no reconocido ("${c.tipo || '—'}").`);
    if (!c.valor) e.push(`El complemento "${c.tipo}" no tiene valor.`);
    else if (!VALOR_COMPLEMENTO.test(c.valor)) e.push(`El valor del complemento "${c.tipo}" solo admite letras y números (sin espacios ni símbolos).`);
  }

  return e;
}

/**
 * Compone la cadena en el formato exacto que exige la DIAN. Lanza
 * `DireccionDianInvalidaError` si la estructura no es válida — nunca devuelve
 * una cadena a medias.
 */
export function componerDireccionDian(entrada: DireccionDian): string {
  const errores = validarDireccionDian(entrada);
  if (errores.length > 0) throw new DireccionDianInvalidaError(errores);

  const d = normalizarDireccionDian(entrada);
  let via = `${d.tipoVia} ${d.numeroVia}`;
  if (d.letraVia) via += d.letraVia;
  if (d.bisVia) via += ' BIS';
  if (d.letraBisVia) via += ` ${d.letraBisVia}`;
  if (d.cuadranteVia) via += ` ${d.cuadranteVia}`;

  let gen = `${d.numeroGeneradora}`;
  if (d.letraGeneradora) gen += d.letraGeneradora;
  if (d.cuadranteGeneradora) gen += ` ${d.cuadranteGeneradora}`;

  let out = `${via} # ${gen} - ${d.placa}`;
  for (const c of d.complementos ?? []) out += ` ${c.tipo} ${c.valor}`;
  return out;
}

/**
 * Intento CONSERVADOR de desglosar una dirección de texto libre heredada. Solo
 * devuelve estructura cuando el patrón es inequívoco:
 *   <tipo vía> <número><letra?> # <número><letra?> - <placa>
 * sin nada más (una coma, un "oficina 5", cualquier resto => null y el
 * llamador marca el tercero para revisión). No adivina complementos.
 */
const PREFIJOS_TEXTO: Record<string, string> = {
  CALLE: 'CL', CL: 'CL',
  CARRERA: 'CR', CRA: 'CR', KRA: 'CR', KR: 'CR', CR: 'CR',
  AVENIDA: 'AV', AV: 'AV',
  'AVENIDA CALLE': 'AC', AC: 'AC',
  'AVENIDA CARRERA': 'AK', AK: 'AK',
  DIAGONAL: 'DG', DIAG: 'DG', DG: 'DG',
  TRANSVERSAL: 'TV', TRANS: 'TV', TV: 'TV',
  CIRCULAR: 'CIR', CIR: 'CIR',
  AUTOPISTA: 'AUT', AUT: 'AUT',
};

export function intentarDesglosarDireccionLibre(texto: string): DireccionDian | null {
  const t = texto.trim().toUpperCase().replace(/\s+/g, ' ').replace(/N[º°.]\s*/g, '').replace(/\bNO\.\s*/g, '');
  const m = t.match(
    /^(CALLE|CARRERA|CRA|KRA|AVENIDA CALLE|AVENIDA CARRERA|AVENIDA|DIAGONAL|DIAG|TRANSVERSAL|TRANS|CIRCULAR|AUTOPISTA|CL|KR|CR|AK|AC|AV|DG|TV|CIR|AUT)\s+(\d{1,4})\s*([A-Z])?\s*#\s*(\d{1,4})\s*([A-Z])?\s*-\s*(\d{1,4})$/,
  );
  if (!m) return null;
  const tipoVia = PREFIJOS_TEXTO[m[1]!];
  if (!tipoVia) return null;
  return {
    tipoVia,
    numeroVia: m[2]!,
    letraVia: m[3] ?? null,
    numeroGeneradora: m[4]!,
    letraGeneradora: m[5] ?? null,
    placa: m[6]!,
    complementos: [],
  };
}

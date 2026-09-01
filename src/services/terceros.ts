/**
 * A8 — Maestro de terceros (cierre de V-17): crear y editar el `third_party`
 * emisor/receptor de una factura, sus atributos fiscales VERSIONADOS
 * (`third_party_fiscal_attribute`) y sus actividades económicas por
 * municipio (`third_party_activity`, ReteICA multimunicipio — casos dorados
 * 9 y 10).
 *
 * POR QUÉ EXISTE ESTE ARCHIVO: hasta V-17 no había ni un solo `INSERT INTO
 * third_party` fuera de un fixture de prueba. `src/services/ingest.ts`
 * RESUELVE el tercero emisor por NIT a propósito, pero explícitamente "no lo
 * crea: eso es maestro de datos, fuera de este servicio" (ver su cabecera).
 * Este archivo es exactamente ESE maestro de datos: una vez que un contador
 * crea aquí el proveedor con su NIT, `resolverTerceroPorNit` lo encuentra y
 * la causación de su factura deja de bloquearse.
 *
 * ESTE ARCHIVO NO CALCULA NINGUNA RETENCIÓN (Regla de Oro 4): solo guarda los
 * HECHOS que el contador declara (es declarante, tiene actividad en tal
 * municipio...). Quien los interpreta para calcular una retención es
 * `src/domain/repositorio.ts` (A3), a la fecha del hecho económico.
 *
 * ATRIBUTOS FISCALES — LO MÁS DELICADO DE ESTE MÓDULO (ver D-014 de A2 y la
 * cabecera de `db/migrations/005_terceros.sql`): NO HAY VALOR POR DEFECTO.
 * Si esta interfaz dejara sin marcar, por ejemplo, "es declarante de renta"
 * y guardara `false` porque la casilla vino sin marcar, estaría INVENTANDO
 * un dato con consecuencia tributaria real (4% de retefuente si declara,
 * 6% si no — art. 392/401 ET). Por eso `registrarAtributosFiscales` exige
 * las NUEVE banderas explícitas una por una (`requerirBooleano`): si al
 * servicio le falta una, lanza `AtributoFiscalIncompletoError` con el
 * nombre exacto de la que falta, en vez de asumir nada. La interfaz
 * (`app/terceros/[id]/atributos-fiscales/page.tsx`) lo traduce a pares de
 * radios "Sí/No" SIN opción preseleccionada — nunca una casilla que por
 * omisión valga "No" — así que un contador no puede guardar el formulario
 * sin haber tocado los nueve. Si un tercero no tiene NINGUNA vigencia a la
 * fecha del hecho económico, el motor (A3) lo manda a revisión manual: eso
 * ya lo hace `repositorio.ts` devolviendo `null`, este archivo no lo cambia
 * ni lo tapa con un valor inventado.
 *
 * LAS SEIS CONDUCTAS DE LA SECCIÓN 6.2, EN LO QUE APLICA A UN TERCERO (a
 * diferencia de `parametrizacion.ts`, aquí NUNCA hay alcance compartido
 * entre empresas: `third_party.company_id` es `NOT NULL`, sección 005):
 *
 *  1. Nunca UPDATE de una vigencia ya vigente — lo impone el trigger PR001
 *     igual que en 080/parametrizacion; este servicio solo cierra
 *     `vigente_hasta` de la fila que reemplaza, nunca sus demás columnas.
 *  2. Fecha de vigencia obligatoria — `requerirFechaIso` antes de tocar la base.
 *  3. Nunca retroactivo sobre lo publicado — `app.fecha_minima_vigencia_
 *     tercero_fiscal` / `..._tercero_actividad` (migración 081), exactamente
 *     el mismo mecanismo que 080 usa para `tax_rule`.
 *  4. Auditoría con norma de respaldo — la escribe sola la base
 *     (`app.trg_audit`, ya instalado sobre estas dos tablas en 009); este
 *     servicio solo exige que el contador la escriba (`requerirNorma`).
 *  5. Permiso restringido — lo impone el trigger `third_party*_permiso`
 *     (`tercero.editar` para el maestro, `tercero.atributos_fiscales` para las
 *     vigencias fiscales y la actividad — migraciones 016 y 140). Este servicio no lo reimplementa:
 *     si falta, el INSERT/UPDATE falla con SQLSTATE `SE002` y sube sin
 *     envolverse (D-025, igual que en `parametrizacion.ts`).
 *  6. Simulador previo de impacto — `simularImpactoAtributosFiscales` /
 *     `simularImpactoActividad`, sobre `app.simular_impacto_tercero_*`
 *     (migración 081): para UN tercero, "esto afecta N documentos suyos
 *     pendientes y M asientos suyos ya publicados".
 *
 * El tercero (razón social, dirección, municipio, contacto) NO está
 * versionado: es maestro de datos mutable, igual que `company`. Solo lo que
 * tiene consecuencia tributaria (los atributos fiscales, la actividad
 * económica) vive en tablas de vigencia.
 */
import type { SqlClient } from '../db/types';
import {
  EdicionRetroactivaError,
  NormaDeRespaldoRequeridaError,
  VigenciaInvalidaError,
} from './parametrizacion';

export { EdicionRetroactivaError, NormaDeRespaldoRequeridaError, VigenciaInvalidaError };

// =============================================================================
// ERRORES DE DOMINIO
// =============================================================================

export class TerceroInvalidoError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'TerceroInvalidoError';
  }
}

export class TerceroNoEncontradoError extends Error {
  constructor(id: string) {
    super(`No existe (o no es visible para esta sesión) el tercero ${id}.`);
    this.name = 'TerceroNoEncontradoError';
  }
}

/**
 * Falta una de las NUEVE banderas fiscales obligatorias. Es el mecanismo que
 * impide inventar `false` por omisión (ver cabecera del archivo).
 */
export class AtributoFiscalIncompletoError extends Error {
  constructor(campo: string) {
    super(
      `Falta declarar explícitamente "${campo}" (Sí/No). No se guarda ningún atributo fiscal ` +
        'con un valor asumido: sin este dato, el tercero queda pendiente de verificación manual ' +
        'en la causación, en vez de arriesgar una retención calculada con un supuesto falso.',
    );
    this.name = 'AtributoFiscalIncompletoError';
  }
}

export class ContextoSinEmpresaError extends Error {
  constructor() {
    super('No hay una empresa seleccionada en la sesión: el maestro de terceros es siempre de una empresa concreta.');
    this.name = 'ContextoSinEmpresaError';
  }
}

// =============================================================================
// UTILIDADES
// =============================================================================

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function requerirFechaIso(fecha: string): void {
  if (!ISO_DATE.test(fecha)) {
    throw new VigenciaInvalidaError(`La fecha de vigencia debe tener formato AAAA-MM-DD; se recibió "${fecha}".`);
  }
}

function requerirNorma(norma: string | null | undefined): string {
  const limpio = (norma ?? '').trim();
  if (!limpio) throw new NormaDeRespaldoRequeridaError();
  return limpio;
}

function requerirBooleano(valor: boolean | null | undefined, campo: string): boolean {
  if (typeof valor !== 'boolean') throw new AtributoFiscalIncompletoError(campo);
  return valor;
}

/** Día calendario anterior a una fecha ISO, en UTC puro. Aritmética de
 * fechas, no un valor tributario (igual que en `parametrizacion.ts`). */
function diaAnterior(fechaIso: string): string {
  const [anio, mes, dia] = fechaIso.split('-').map(Number) as [number, number, number];
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  fecha.setUTCDate(fecha.getUTCDate() - 1);
  return fecha.toISOString().slice(0, 10);
}

export function hoyIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Dígito de verificación del NIT por el algoritmo módulo once que usa la
 * DIAN (Decreto 2460 de 2013, anexo del RUT). NO es un valor tributario
 * (Regla de Oro 2): es un algoritmo de checksum fijo — no una tarifa, base,
 * UVT, salario mínimo, tope ni calendario —, y no cambia con ninguna reforma.
 * Se usa solo como AYUDA para que la interfaz sugiera el dígito y detecte una
 * transcripción errónea del NIT; nunca sustituye lo que el contador escriba,
 * ni bloquea el guardado si no coincide (un NIT de una entidad especial
 * puede escapar a este cálculo).
 */
const PESOS_DV_NIT = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];

export function calcularDigitoVerificacionNit(numeroDocumento: string): number | null {
  const soloDigitos = numeroDocumento.replace(/\D/g, '');
  if (!soloDigitos) return null;
  const digitos = soloDigitos.split('').map(Number).reverse();
  let suma = 0;
  for (let i = 0; i < digitos.length; i += 1) {
    const peso = PESOS_DV_NIT[i];
    if (peso === undefined) break;
    suma += digitos[i]! * peso;
  }
  const resto = suma % 11;
  if (resto === 0 || resto === 1) return resto;
  return 11 - resto;
}

interface ContextoEmpresa {
  tenantId: string;
  companyId: string;
}

async function contextoEmpresa(tx: SqlClient): Promise<ContextoEmpresa> {
  const { rows } = await tx.query<{ tenant_id: string | null; company_id: string | null }>(
    'SELECT app.current_tenant_id() AS tenant_id, app.current_company_id() AS company_id',
  );
  const tenantId = rows[0]?.tenant_id ?? null;
  const companyId = rows[0]?.company_id ?? null;
  if (!tenantId || !companyId) throw new ContextoSinEmpresaError();
  return { tenantId, companyId };
}

// =============================================================================
// TERCERO — maestro de datos mutable (NO versionado)
// =============================================================================

export type TipoDocumentoTercero =
  | 'NIT'
  | 'CC'
  | 'CE'
  | 'PA'
  | 'TI'
  | 'NIT_EXTRANJERO'
  | 'PEP'
  | 'PPT'
  | 'NUIP'
  | 'DEX';

export interface DatosTercero {
  tipoDocumento: TipoDocumentoTercero;
  numeroDocumento: string;
  digitoVerificacion?: number | null;
  tipoPersona: 'natural' | 'juridica';
  razonSocial: string;
  nombreComercial?: string | null;
  primerNombre?: string | null;
  otrosNombres?: string | null;
  primerApellido?: string | null;
  segundoApellido?: string | null;
  /** Obligatoria salvo `esDelExterior` (Res. 000227/2025, art. 1.3.5.2.1, Formato 1001). */
  direccion?: string | null;
  /** Obligatorio salvo `esDelExterior`: es el que resuelve el código DANE del informado en exógena. */
  municipalityId?: string | null;
  pais?: string;
  esDelExterior?: boolean;
  email?: string | null;
  telefono?: string | null;
}

function requerirDireccionYMunicipio(input: DatosTercero): void {
  if (input.esDelExterior) {
    if (input.municipalityId) {
      throw new TerceroInvalidoError('Un tercero del exterior no lleva municipio colombiano.');
    }
    return;
  }
  if (!input.direccion || !input.direccion.trim()) {
    throw new TerceroInvalidoError(
      'La dirección es obligatoria: el Formato 1001 de exógena (Res. 000227/2025, art. 1.3.5.2.1) ' +
        'exige la dirección del informado, y debe capturarse desde la creación del tercero, no al ' +
        'cierre del año.',
    );
  }
  if (!input.municipalityId) {
    throw new TerceroInvalidoError(
      'El municipio es obligatorio: de él sale el código DANE que el Formato 1001 exige para el ' +
        'informado, y también resuelve el municipio de ReteICA (sección 8.2). Márquelo como ' +
        '"del exterior" si el tercero no tiene municipio colombiano.',
    );
  }
}

async function codigoDaneDe(tx: SqlClient, municipalityId: string | null | undefined): Promise<string | null> {
  if (!municipalityId) return null;
  const { rows } = await tx.query<{ codigo_dane: string }>(
    'SELECT codigo_dane FROM municipality WHERE id = $1',
    [municipalityId],
  );
  const fila = rows[0];
  if (!fila) {
    throw new TerceroInvalidoError(`No existe (o no es visible para esta sesión) el municipio ${municipalityId}.`);
  }
  return fila.codigo_dane;
}

export async function crearTercero(tx: SqlClient, input: DatosTercero): Promise<{ id: string }> {
  if (!input.numeroDocumento?.trim()) throw new TerceroInvalidoError('El número de documento es obligatorio.');
  if (!input.razonSocial?.trim()) {
    throw new TerceroInvalidoError('La razón social (o el nombre, para persona natural) es obligatoria.');
  }
  requerirDireccionYMunicipio(input);

  const ctx = await contextoEmpresa(tx);
  const codigoDane = await codigoDaneDe(tx, input.municipalityId);

  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO third_party (
       tenant_id, company_id, tipo_documento, numero_documento, digito_verificacion,
       tipo_persona, razon_social, nombre_comercial, primer_nombre, otros_nombres,
       primer_apellido, segundo_apellido, direccion, municipality_id, codigo_dane,
       pais, es_del_exterior, email, telefono
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     RETURNING id`,
    [
      ctx.tenantId,
      ctx.companyId,
      input.tipoDocumento,
      input.numeroDocumento.trim(),
      input.digitoVerificacion ?? null,
      input.tipoPersona,
      input.razonSocial.trim(),
      input.nombreComercial ?? null,
      input.primerNombre ?? null,
      input.otrosNombres ?? null,
      input.primerApellido ?? null,
      input.segundoApellido ?? null,
      input.esDelExterior ? null : input.direccion!.trim(),
      input.esDelExterior ? null : input.municipalityId,
      input.esDelExterior ? null : codigoDane,
      input.pais ?? 'CO',
      input.esDelExterior ?? false,
      input.email ?? null,
      input.telefono ?? null,
    ],
  );
  return { id: rows[0]!.id };
}

export async function editarTercero(tx: SqlClient, terceroId: string, input: DatosTercero): Promise<void> {
  if (!input.razonSocial?.trim()) {
    throw new TerceroInvalidoError('La razón social (o el nombre, para persona natural) es obligatoria.');
  }
  requerirDireccionYMunicipio(input);

  const codigoDane = await codigoDaneDe(tx, input.municipalityId);

  const { rows: actualizada } = await tx.query<{ id: string }>(
    `UPDATE third_party SET
       tipo_documento = $2, numero_documento = $3, digito_verificacion = $4,
       tipo_persona = $5, razon_social = $6, nombre_comercial = $7,
       primer_nombre = $8, otros_nombres = $9, primer_apellido = $10, segundo_apellido = $11,
       direccion = $12, municipality_id = $13, codigo_dane = $14,
       pais = $15, es_del_exterior = $16, email = $17, telefono = $18
     WHERE id = $1
     RETURNING id`,
    [
      terceroId,
      input.tipoDocumento,
      input.numeroDocumento.trim(),
      input.digitoVerificacion ?? null,
      input.tipoPersona,
      input.razonSocial.trim(),
      input.nombreComercial ?? null,
      input.primerNombre ?? null,
      input.otrosNombres ?? null,
      input.primerApellido ?? null,
      input.segundoApellido ?? null,
      input.esDelExterior ? null : input.direccion!.trim(),
      input.esDelExterior ? null : input.municipalityId,
      input.esDelExterior ? null : codigoDane,
      input.pais ?? 'CO',
      input.esDelExterior ?? false,
      input.email ?? null,
      input.telefono ?? null,
    ],
  );
  if (!actualizada[0]) throw new TerceroNoEncontradoError(terceroId);
}

export interface FilaTercero {
  id: string;
  tipoDocumento: string;
  numeroDocumento: string;
  digitoVerificacion: number | null;
  tipoPersona: 'natural' | 'juridica';
  razonSocial: string;
  nombreComercial: string | null;
  direccion: string | null;
  municipalityId: string | null;
  municipalityNombre: string | null;
  codigoDane: string | null;
  pais: string;
  esDelExterior: boolean;
  email: string | null;
  telefono: string | null;
  activo: boolean;
  tieneAtributoFiscalVigente: boolean;
}

interface FilaTerceroCruda {
  id: string;
  tipo_documento: string;
  numero_documento: string;
  digito_verificacion: number | null;
  tipo_persona: 'natural' | 'juridica';
  razon_social: string;
  nombre_comercial: string | null;
  direccion: string | null;
  municipality_id: string | null;
  municipality_nombre: string | null;
  codigo_dane: string | null;
  pais: string;
  es_del_exterior: boolean;
  email: string | null;
  telefono: string | null;
  activo: boolean;
  tiene_atributo_fiscal_vigente: boolean;
}

function filaTerceroDe(f: FilaTerceroCruda): FilaTercero {
  return {
    id: f.id,
    tipoDocumento: f.tipo_documento,
    numeroDocumento: f.numero_documento,
    digitoVerificacion: f.digito_verificacion,
    tipoPersona: f.tipo_persona,
    razonSocial: f.razon_social,
    nombreComercial: f.nombre_comercial,
    direccion: f.direccion,
    municipalityId: f.municipality_id,
    municipalityNombre: f.municipality_nombre,
    codigoDane: f.codigo_dane,
    pais: f.pais,
    esDelExterior: f.es_del_exterior,
    email: f.email,
    telefono: f.telefono,
    activo: f.activo,
    tieneAtributoFiscalVigente: f.tiene_atributo_fiscal_vigente,
  };
}

const SELECT_TERCERO = `
  SELECT tp.id, tp.tipo_documento, tp.numero_documento, tp.digito_verificacion, tp.tipo_persona,
         tp.razon_social, tp.nombre_comercial, tp.direccion, tp.municipality_id,
         m.nombre AS municipality_nombre, tp.codigo_dane, tp.pais, tp.es_del_exterior,
         tp.email, tp.telefono, tp.activo,
         EXISTS (
           SELECT 1 FROM third_party_fiscal_attribute fa
            WHERE fa.third_party_id = tp.id
              AND app.esta_vigente(fa.vigente_desde, fa.vigente_hasta, CURRENT_DATE)
         ) AS tiene_atributo_fiscal_vigente
    FROM third_party tp
    LEFT JOIN municipality m ON m.id = tp.municipality_id`;

export async function listarTerceros(
  tx: SqlClient,
  filtro: { busqueda?: string; soloActivos?: boolean } = {},
): Promise<FilaTercero[]> {
  const condiciones: string[] = [];
  const params: unknown[] = [];
  if (filtro.busqueda?.trim()) {
    params.push(`%${filtro.busqueda.trim()}%`);
    condiciones.push(`(tp.razon_social ILIKE $${params.length} OR tp.numero_documento ILIKE $${params.length})`);
  }
  if (filtro.soloActivos) condiciones.push('tp.activo = true');
  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
  const { rows } = await tx.query<FilaTerceroCruda>(
    `${SELECT_TERCERO} ${where} ORDER BY tp.razon_social LIMIT 200`,
    params,
  );
  return rows.map(filaTerceroDe);
}

export async function obtenerTercero(tx: SqlClient, terceroId: string): Promise<FilaTercero | null> {
  const { rows } = await tx.query<FilaTerceroCruda>(`${SELECT_TERCERO} WHERE tp.id = $1`, [terceroId]);
  const fila = rows[0];
  return fila ? filaTerceroDe(fila) : null;
}

export async function puedeEditarTerceros(tx: SqlClient): Promise<boolean> {
  const { rows } = await tx.query<{ tiene: boolean }>("SELECT app.tiene_permiso('tercero.editar') AS tiene");
  return rows[0]?.tiene === true;
}

/**
 * A12, migración 140. Editar el MAESTRO de un tercero y editar sus VIGENCIAS
 * FISCALES no son la misma cosa: lo segundo entra en el cálculo de la
 * retención, así que es parámetro y lleva su propio permiso
 * (`tercero.atributos_fiscales`). Lo tienen admin_firma, admin_tributario y
 * contador; el auxiliar de causación no.
 */
export async function puedeEditarAtributosFiscales(tx: SqlClient): Promise<boolean> {
  const { rows } = await tx.query<{ tiene: boolean }>(
    "SELECT app.tiene_permiso('tercero.atributos_fiscales') AS tiene",
  );
  return rows[0]?.tiene === true;
}

export interface OpcionCatalogo {
  id: string;
  codigo: string;
  nombre: string;
}

/** Catálogo de municipios visibles para la sesión (global + de la firma),
 * para el selector de la interfaz. No es un dato versionado. */
export async function listarMunicipiosParaSelector(tx: SqlClient): Promise<OpcionCatalogo[]> {
  const { rows } = await tx.query<{ id: string; codigo_dane: string; nombre: string; departamento: string }>(
    `SELECT id, codigo_dane, nombre, departamento FROM municipality WHERE activo ORDER BY nombre`,
  );
  return rows.map((r) => ({ id: r.id, codigo: r.codigo_dane, nombre: `${r.nombre} (${r.departamento})` }));
}

/**
 * Catálogo CIIU visible para la sesión, para el selector de actividad económica.
 *
 * Sin `municipalityId` devuelve el catálogo completo — que es lo correcto para
 * una ficha de empresa o una consulta genérica, y lo INCORRECTO para el
 * selector de ReteICA. Ver `listarActividadesIcaDeMunicipio` justo debajo.
 */
export async function listarCiiuParaSelector(
  tx: SqlClient,
  municipalityId?: string | null,
): Promise<OpcionCatalogo[]> {
  if (municipalityId) {
    return (await listarActividadesIcaDeMunicipio(tx, municipalityId)).opciones;
  }
  const { rows } = await tx.query<{ id: string; codigo: string; nombre: string }>(
    `SELECT id, codigo, nombre FROM ciiu_activity WHERE activo ORDER BY codigo`,
  );
  return rows.map((r) => ({ id: r.id, codigo: r.codigo, nombre: r.nombre }));
}

export interface CatalogoActividadesIca {
  municipalityId: string;
  municipalityNombre: string;
  /** Hay una fila de `municipality_ica_rule` vigente para este municipio. */
  tieneReglaMunicipio: boolean;
  /** El municipio practica ReteICA (si no, no hay nada que elegir). */
  practicaReteica: boolean;
  /** La tarifa sale de la actividad económica (lo habitual) o es general. */
  usaTarifaDeActividad: boolean;
  /** Actividades con tarifa de ReteICA cargada para ESTE municipio. */
  opciones: OpcionCatalogo[];
  /**
   * Por qué `opciones` viene vacía, en palabras que un contador entiende.
   * `null` cuando no está vacía. La interfaz lo muestra tal cual: una lista
   * desplegable vacía sin explicación es peor que un error.
   */
  motivoVacio: string | null;
}

/**
 * A16 (Ola 4, Tarea 5) — CIERRE DE UN DEFECTO REAL DE RETEICA.
 *
 * QUÉ ESTABA MAL. El selector de actividad económica de un tercero
 * (`/terceros/[id]/actividades`) llamaba a `listarCiiuParaSelector(tx)` sin
 * ningún filtro, así que ofrecía las MISMAS 40 actividades para Medellín que
 * para Bucaramanga o Cartagena, municipios que hoy no tienen ni una tarifa de
 * ReteICA cargada. Un contador podía guardar «actividad 4711 en Bucaramanga»
 * con toda naturalidad, y el motor —correctamente— no encontraba tarifa y
 * mandaba el documento a revisión manual sin que nadie entendiera por qué.
 * El dato quedaba registrado, con su norma de respaldo y su vigencia, y era
 * inútil.
 *
 * POR QUÉ SE CONSULTA `tax_rule` Y NO UNA TABLA DE «ACTIVIDADES DEL
 * MUNICIPIO». Porque esa tabla no existe ni debe existir: la relación
 * municipio × actividad × tarifa YA ES `tax_rule` (tipo 'reteica',
 * `municipality_id`, `ciiu_activity_id`), versionada por vigencia como todo lo
 * demás. Inventar un catálogo paralelo de «qué actividades aplican en tal
 * municipio» sería un segundo lugar donde el mismo hecho puede estar
 * desactualizado. Aquí se pregunta por la fuente de verdad: qué actividades
 * tienen tarifa VIGENTE en ese municipio a la fecha.
 *
 * MUNICIPIOS CON TARIFA GENERAL. Algunos acuerdos municipales no diferencian
 * por actividad (`municipality_ica_rule.usa_tarifa_de_actividad = false`, con
 * `tarifa_general`). En ese caso limitar la lista a las actividades con
 * `tax_rule` propia dejaría el selector vacío por un motivo equivocado: se
 * devuelve el catálogo completo y se avisa de que la tarifa no depende de la
 * actividad elegida.
 *
 * ESTA FUNCIÓN NO CALCULA NINGUNA TARIFA (Regla de Oro 4) y no devuelve
 * ninguna: solo dice QUÉ actividades tienen una cargada. Quién la resuelve y
 * la aplica sigue siendo `src/domain/repositorio.ts`, a la fecha del hecho
 * económico.
 */
export async function listarActividadesIcaDeMunicipio(
  tx: SqlClient,
  municipalityId: string,
  fecha: string = hoyIso(),
): Promise<CatalogoActividadesIca> {
  requerirFechaIso(fecha);

  const { rows: municipio } = await tx.query<{ nombre: string; departamento: string }>(
    'SELECT nombre, departamento FROM municipality WHERE id = $1',
    [municipalityId],
  );
  const m = municipio[0];
  if (!m) {
    throw new TerceroInvalidoError(
      `No existe (o no es visible para esta sesión) el municipio ${municipalityId}.`,
    );
  }
  const municipalityNombre = `${m.nombre} (${m.departamento})`;

  // Regla del municipio VIGENTE a la fecha, del alcance más específico que
  // exista (empresa > firma > global): la RLS ya limita lo visible, aquí solo
  // se elige cuál de las visibles manda.
  const { rows: regla } = await tx.query<{
    practica_reteica: boolean;
    usa_tarifa_de_actividad: boolean;
  }>(
    `SELECT practica_reteica, usa_tarifa_de_actividad
       FROM municipality_ica_rule
      WHERE municipality_id = $1
        AND app.esta_vigente(vigente_desde, vigente_hasta, $2::date)
      ORDER BY (company_id IS NOT NULL) DESC, (tenant_id IS NOT NULL) DESC
      LIMIT 1`,
    [municipalityId, fecha],
  );
  const r = regla[0] ?? null;

  const { rows: conTarifa } = await tx.query<{ id: string; codigo: string; nombre: string }>(
    `SELECT DISTINCT ci.id, ci.codigo, ci.nombre
       FROM tax_rule tr
       JOIN ciiu_activity ci ON ci.id = tr.ciiu_activity_id
      WHERE tr.tipo = 'reteica'
        AND tr.municipality_id = $1
        AND ci.activo
        AND app.esta_vigente(tr.vigente_desde, tr.vigente_hasta, $2::date)
      ORDER BY ci.codigo`,
    [municipalityId, fecha],
  );

  const base = {
    municipalityId,
    municipalityNombre,
    tieneReglaMunicipio: r !== null,
    practicaReteica: r?.practica_reteica ?? false,
    usaTarifaDeActividad: r?.usa_tarifa_de_actividad ?? true,
  };

  if (r !== null && !r.practica_reteica) {
    return {
      ...base,
      opciones: [],
      motivoVacio:
        `${municipalityNombre} está cargado como municipio que NO practica retención de ICA ` +
        `a la fecha ${fecha}. No hay actividad que registrar aquí para efectos de ReteICA.`,
    };
  }

  if (r !== null && !r.usa_tarifa_de_actividad) {
    const { rows: todas } = await tx.query<{ id: string; codigo: string; nombre: string }>(
      'SELECT id, codigo, nombre FROM ciiu_activity WHERE activo ORDER BY codigo',
    );
    return {
      ...base,
      opciones: todas.map((a) => ({ id: a.id, codigo: a.codigo, nombre: a.nombre })),
      motivoVacio:
        todas.length > 0
          ? null
          : 'No hay ninguna actividad CIIU cargada en el catálogo. Cárguelas en /carga-masiva antes de registrar actividades de terceros.',
    };
  }

  if (conTarifa.length === 0) {
    return {
      ...base,
      opciones: [],
      motivoVacio: r === null
        ? `${municipalityNombre} no tiene ninguna regla de ReteICA cargada todavía (ni bases mínimas ` +
          `ni tarifas por actividad) con vigencia al ${fecha}. Cárguela en ` +
          `/parametros/reteica-municipios, o suba las tarifas por actividad en /carga-masiva, ` +
          'antes de registrar aquí la actividad económica del tercero.'
        : `${municipalityNombre} tiene regla de ReteICA, pero ninguna tarifa por actividad ` +
          `cargada con vigencia al ${fecha}. Cargue las tarifas del acuerdo municipal en ` +
          '/parametros/tarifas/reteica o en /carga-masiva.',
    };
  }

  return {
    ...base,
    opciones: conTarifa.map((a) => ({ id: a.id, codigo: a.codigo, nombre: a.nombre })),
    motivoVacio: null,
  };
}

// =============================================================================
// ATRIBUTOS FISCALES — VERSIONADOS (third_party_fiscal_attribute)
// =============================================================================

export type RegimenTributario = 'ordinario' | 'simple' | 'especial' | 'no_contribuyente' | 'no_residente';
export type FuenteAtributoFiscal = 'rut' | 'declarado_por_cliente' | 'factura' | 'consulta_dian' | 'otro';

/**
 * Las NUEVE banderas son OBLIGATORIAS y explícitas: sin valor por defecto
 * (ver cabecera del archivo). `boolean | null | undefined` en el tipo, no
 * `boolean`, a propósito: así el compilador no oculta que la interfaz debe
 * mandar el valor REAL de un radio "Sí/No" sin marcar, y `requerirBooleano`
 * lo rechaza en tiempo de ejecución si de verdad llega vacío.
 */
export interface AtributosFiscalesInput {
  terceroId: string;
  esDeclaranteRenta: boolean | null | undefined;
  esAutorretenedorRenta: boolean | null | undefined;
  esGranContribuyente: boolean | null | undefined;
  esRegimenSimple: boolean | null | undefined;
  esResponsableIva: boolean | null | undefined;
  esAgenteRetencionRenta: boolean | null | undefined;
  esAgenteRetencionIva: boolean | null | undefined;
  esAgenteRetencionIca: boolean | null | undefined;
  esAutorretenedorIca: boolean | null | undefined;
  regimenTributario: RegimenTributario;
  vigenteDesde: string;
  normaRespaldo: string;
  fuente?: FuenteAtributoFiscal;
  notas?: string | null;
  requiereVerificacionHumana?: boolean;
}

export interface ImpactoTercero {
  documentosPendientes: number;
  asientosPublicados: number;
}

export async function fechaMinimaVigenciaAtributosFiscales(tx: SqlClient, terceroId: string): Promise<string | null> {
  const { rows } = await tx.query<{ fecha: string | null }>(
    'SELECT app.fecha_minima_vigencia_tercero_fiscal($1)::text AS fecha',
    [terceroId],
  );
  return rows[0]?.fecha ?? null;
}

export async function simularImpactoAtributosFiscales(tx: SqlClient, terceroId: string): Promise<ImpactoTercero> {
  const { rows } = await tx.query<{ documentos_pendientes: string; asientos_publicados: string }>(
    'SELECT * FROM app.simular_impacto_tercero_fiscal($1)',
    [terceroId],
  );
  const fila = rows[0];
  return {
    documentosPendientes: Number(fila?.documentos_pendientes ?? 0),
    asientosPublicados: Number(fila?.asientos_publicados ?? 0),
  };
}

interface FilaAtributoFiscalAnterior {
  id: string;
  vigente_desde: string;
}

/**
 * Crea la vigencia nueva de atributos fiscales, cerrando la anterior si
 * existe (nunca UPDATE de sus valores — solo de `vigente_hasta`, para
 * cerrarla). Exige las nueve banderas explícitas, la norma y que la fecha no
 * sea retroactiva sobre lo ya publicado de este tercero.
 */
export async function registrarAtributosFiscales(
  tx: SqlClient,
  input: AtributosFiscalesInput,
): Promise<{ id: string; vigenciaAnteriorCerrada: boolean }> {
  const normaRespaldo = requerirNorma(input.normaRespaldo);
  requerirFechaIso(input.vigenteDesde);

  const esDeclaranteRenta = requerirBooleano(input.esDeclaranteRenta, 'es declarante de renta');
  const esAutorretenedorRenta = requerirBooleano(input.esAutorretenedorRenta, 'es autorretenedor de renta');
  const esGranContribuyente = requerirBooleano(input.esGranContribuyente, 'es gran contribuyente');
  const esRegimenSimple = requerirBooleano(input.esRegimenSimple, 'pertenece al régimen SIMPLE');
  const esResponsableIva = requerirBooleano(input.esResponsableIva, 'es responsable de IVA');
  const esAgenteRetencionRenta = requerirBooleano(input.esAgenteRetencionRenta, 'es agente de retención de renta');
  const esAgenteRetencionIva = requerirBooleano(input.esAgenteRetencionIva, 'es agente de retención de IVA');
  const esAgenteRetencionIca = requerirBooleano(input.esAgenteRetencionIca, 'es agente de retención de ICA');
  const esAutorretenedorIca = requerirBooleano(input.esAutorretenedorIca, 'es autorretenedor de ICA');

  const tercero = await obtenerTercero(tx, input.terceroId);
  if (!tercero) throw new TerceroNoEncontradoError(input.terceroId);

  const { rows } = await tx.query<FilaAtributoFiscalAnterior>(
    `SELECT id, vigente_desde::text FROM third_party_fiscal_attribute
      WHERE third_party_id = $1 AND vigente_hasta IS NULL`,
    [input.terceroId],
  );
  const anterior = rows[0] ?? null;

  if (anterior) {
    const fechaMinima = await fechaMinimaVigenciaAtributosFiscales(tx, input.terceroId);
    if (fechaMinima && input.vigenteDesde <= fechaMinima) throw new EdicionRetroactivaError(fechaMinima);
    if (input.vigenteDesde <= anterior.vigente_desde) {
      throw new VigenciaInvalidaError(
        `La vigencia nueva (${input.vigenteDesde}) debe ser posterior a la que reemplaza ` +
          `(${anterior.vigente_desde}).`,
      );
    }
    await tx.query('UPDATE third_party_fiscal_attribute SET vigente_hasta = $2 WHERE id = $1', [
      anterior.id,
      diaAnterior(input.vigenteDesde),
    ]);
  }

  const ctx = await contextoEmpresa(tx);
  const { rows: nueva } = await tx.query<{ id: string }>(
    `INSERT INTO third_party_fiscal_attribute (
       tenant_id, company_id, third_party_id, es_declarante_renta, es_autorretenedor_renta,
       es_gran_contribuyente, es_regimen_simple, es_responsable_iva, es_agente_retencion_renta,
       es_agente_retencion_iva, es_agente_retencion_ica, es_autorretenedor_ica, regimen_tributario,
       vigente_desde, vigente_hasta, norma_respaldo, fuente, notas, requiere_verificacion_humana,
       created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NULL,$15,$16,$17,$18,
       app.current_user_id())
     RETURNING id`,
    [
      ctx.tenantId,
      ctx.companyId,
      input.terceroId,
      esDeclaranteRenta,
      esAutorretenedorRenta,
      esGranContribuyente,
      esRegimenSimple,
      esResponsableIva,
      esAgenteRetencionRenta,
      esAgenteRetencionIva,
      esAgenteRetencionIca,
      esAutorretenedorIca,
      input.regimenTributario,
      input.vigenteDesde,
      normaRespaldo,
      input.fuente ?? 'declarado_por_cliente',
      input.notas ?? null,
      input.requiereVerificacionHumana ?? false,
    ],
  );
  return { id: nueva[0]!.id, vigenciaAnteriorCerrada: Boolean(anterior) };
}

export interface FilaAtributoFiscal {
  id: string;
  esDeclaranteRenta: boolean;
  esAutorretenedorRenta: boolean;
  esGranContribuyente: boolean;
  esRegimenSimple: boolean;
  esResponsableIva: boolean;
  esAgenteRetencionRenta: boolean;
  esAgenteRetencionIva: boolean;
  esAgenteRetencionIca: boolean;
  esAutorretenedorIca: boolean;
  regimenTributario: string;
  vigenteDesde: string;
  vigenteHasta: string | null;
  normaRespaldo: string;
  fuente: string;
  notas: string | null;
  requiereVerificacionHumana: boolean;
}

interface FilaAtributoFiscalCruda {
  id: string;
  es_declarante_renta: boolean;
  es_autorretenedor_renta: boolean;
  es_gran_contribuyente: boolean;
  es_regimen_simple: boolean;
  es_responsable_iva: boolean;
  es_agente_retencion_renta: boolean;
  es_agente_retencion_iva: boolean;
  es_agente_retencion_ica: boolean;
  es_autorretenedor_ica: boolean;
  regimen_tributario: string;
  vigente_desde: string;
  vigente_hasta: string | null;
  norma_respaldo: string;
  fuente: string;
  notas: string | null;
  requiere_verificacion_humana: boolean;
}

function filaAtributoFiscalDe(f: FilaAtributoFiscalCruda): FilaAtributoFiscal {
  return {
    id: f.id,
    esDeclaranteRenta: f.es_declarante_renta,
    esAutorretenedorRenta: f.es_autorretenedor_renta,
    esGranContribuyente: f.es_gran_contribuyente,
    esRegimenSimple: f.es_regimen_simple,
    esResponsableIva: f.es_responsable_iva,
    esAgenteRetencionRenta: f.es_agente_retencion_renta,
    esAgenteRetencionIva: f.es_agente_retencion_iva,
    esAgenteRetencionIca: f.es_agente_retencion_ica,
    esAutorretenedorIca: f.es_autorretenedor_ica,
    regimenTributario: f.regimen_tributario,
    vigenteDesde: f.vigente_desde,
    vigenteHasta: f.vigente_hasta,
    normaRespaldo: f.norma_respaldo,
    fuente: f.fuente,
    notas: f.notas,
    requiereVerificacionHumana: f.requiere_verificacion_humana,
  };
}

/** Historial completo (vigencias cerradas y la abierta): la prueba visual
 * de "nunca UPDATE" de los valores — cada edición es una fila nueva. */
export async function listarHistorialAtributosFiscales(tx: SqlClient, terceroId: string): Promise<FilaAtributoFiscal[]> {
  const { rows } = await tx.query<FilaAtributoFiscalCruda>(
    `SELECT id, es_declarante_renta, es_autorretenedor_renta, es_gran_contribuyente,
            es_regimen_simple, es_responsable_iva, es_agente_retencion_renta,
            es_agente_retencion_iva, es_agente_retencion_ica, es_autorretenedor_ica,
            regimen_tributario, vigente_desde::text, vigente_hasta::text, norma_respaldo,
            fuente, notas, requiere_verificacion_humana
       FROM third_party_fiscal_attribute
      WHERE third_party_id = $1
      ORDER BY vigente_desde DESC`,
    [terceroId],
  );
  return rows.map(filaAtributoFiscalDe);
}

// =============================================================================
// ACTIVIDAD ECONÓMICA POR MUNICIPIO — VERSIONADA (third_party_activity)
// ReteICA multimunicipio (casos dorados 9 y 10): el mismo tercero puede tener
// actividad principal en un municipio y secundaria en otro, simultáneamente.
// =============================================================================

export interface ActividadInput {
  terceroId: string;
  municipalityId: string;
  ciiuActivityId: string;
  esPrincipal: boolean | null | undefined;
  /** Excepcional (ver comentario de 005_terceros.sql): normalmente NULL, la
   *  tarifa se resuelve en `tax_rule` por municipio+actividad. */
  tarifaIcaOverride?: string | null;
  vigenteDesde: string;
  normaRespaldo: string;
  notas?: string | null;
  requiereVerificacionHumana?: boolean;
}

export async function fechaMinimaVigenciaActividad(
  tx: SqlClient,
  terceroId: string,
  municipalityId: string,
): Promise<string | null> {
  const { rows } = await tx.query<{ fecha: string | null }>(
    'SELECT app.fecha_minima_vigencia_tercero_actividad($1, $2)::text AS fecha',
    [terceroId, municipalityId],
  );
  return rows[0]?.fecha ?? null;
}

export async function simularImpactoActividad(
  tx: SqlClient,
  terceroId: string,
  municipalityId: string,
): Promise<ImpactoTercero> {
  const { rows } = await tx.query<{ documentos_pendientes: string; asientos_publicados: string }>(
    'SELECT * FROM app.simular_impacto_tercero_actividad($1, $2)',
    [terceroId, municipalityId],
  );
  const fila = rows[0];
  return {
    documentosPendientes: Number(fila?.documentos_pendientes ?? 0),
    asientosPublicados: Number(fila?.asientos_publicados ?? 0),
  };
}

interface FilaActividadAnterior {
  id: string;
  vigente_desde: string;
}

/**
 * Registra (o reemplaza) la actividad de un tercero en UN municipio+CIIU.
 * "Cerrar la vigencia anterior" solo aplica a la MISMA terna
 * tercero×municipio×CIIU (`clave_vigencia`); una terna distinta —otro
 * municipio, u otra actividad en el mismo municipio— es una fila
 * INDEPENDIENTE, porque un proveedor puede tener varias actividades vigentes
 * a la vez (multimunicipio).
 */
export async function registrarActividad(
  tx: SqlClient,
  input: ActividadInput,
): Promise<{ id: string; vigenciaAnteriorCerrada: boolean }> {
  const normaRespaldo = requerirNorma(input.normaRespaldo);
  requerirFechaIso(input.vigenteDesde);
  const esPrincipal = requerirBooleano(input.esPrincipal, 'es la actividad principal en este municipio');

  const tercero = await obtenerTercero(tx, input.terceroId);
  if (!tercero) throw new TerceroNoEncontradoError(input.terceroId);

  // A16 (Ola 4, Tarea 5). El selector en cascada impide ELEGIR una actividad
  // sin tarifa en el municipio, pero este servicio también lo recibe de la
  // carga masiva y de las pruebas. Aquí no se BLOQUEA —un contador puede
  // registrar legítimamente la actividad antes de que le carguen el acuerdo
  // municipal— pero la fila queda marcada como pendiente de verificación
  // humana, para que aparezca en el banner de alertas (§17.5) en vez de
  // quedarse callada y luego mandar el documento a revisión sin explicación.
  const catalogo = await listarActividadesIcaDeMunicipio(tx, input.municipalityId, input.vigenteDesde);
  const tieneTarifa =
    input.tarifaIcaOverride != null ||
    catalogo.opciones.some((o) => o.id === input.ciiuActivityId);

  const { rows } = await tx.query<FilaActividadAnterior>(
    `SELECT id, vigente_desde::text FROM third_party_activity
      WHERE third_party_id = $1 AND municipality_id = $2 AND ciiu_activity_id = $3
        AND vigente_hasta IS NULL`,
    [input.terceroId, input.municipalityId, input.ciiuActivityId],
  );
  const anterior = rows[0] ?? null;

  if (anterior) {
    const fechaMinima = await fechaMinimaVigenciaActividad(tx, input.terceroId, input.municipalityId);
    if (fechaMinima && input.vigenteDesde <= fechaMinima) throw new EdicionRetroactivaError(fechaMinima);
    if (input.vigenteDesde <= anterior.vigente_desde) {
      throw new VigenciaInvalidaError(
        `La vigencia nueva (${input.vigenteDesde}) debe ser posterior a la que reemplaza ` +
          `(${anterior.vigente_desde}).`,
      );
    }
    await tx.query('UPDATE third_party_activity SET vigente_hasta = $2 WHERE id = $1', [
      anterior.id,
      diaAnterior(input.vigenteDesde),
    ]);
  }

  const ctx = await contextoEmpresa(tx);
  const { rows: nueva } = await tx.query<{ id: string }>(
    `INSERT INTO third_party_activity (
       tenant_id, company_id, third_party_id, municipality_id, ciiu_activity_id, es_principal,
       tarifa_ica_override, vigente_desde, vigente_hasta, norma_respaldo, notas,
       requiere_verificacion_humana, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL,$9,$10,$11, app.current_user_id())
     RETURNING id`,
    [
      ctx.tenantId,
      ctx.companyId,
      input.terceroId,
      input.municipalityId,
      input.ciiuActivityId,
      esPrincipal,
      input.tarifaIcaOverride ?? null,
      input.vigenteDesde,
      normaRespaldo,
      tieneTarifa
        ? input.notas ?? null
        : [
            input.notas,
            `Sin tarifa de ReteICA cargada para ${catalogo.municipalityNombre} a la fecha ${input.vigenteDesde}.`,
          ]
            .filter(Boolean)
            .join(' — '),
      (input.requiereVerificacionHumana ?? false) || !tieneTarifa,
    ],
  );
  return { id: nueva[0]!.id, vigenciaAnteriorCerrada: Boolean(anterior) };
}

export interface FilaActividad {
  id: string;
  municipalityId: string;
  municipalityNombre: string;
  ciiuActivityId: string;
  ciiuCodigo: string;
  ciiuNombre: string;
  esPrincipal: boolean;
  tarifaIcaOverride: string | null;
  vigenteDesde: string;
  vigenteHasta: string | null;
  normaRespaldo: string;
  notas: string | null;
}

interface FilaActividadCruda {
  id: string;
  municipality_id: string;
  municipality_nombre: string;
  ciiu_activity_id: string;
  ciiu_codigo: string;
  ciiu_nombre: string;
  es_principal: boolean;
  tarifa_ica_override: string | null;
  vigente_desde: string;
  vigente_hasta: string | null;
  norma_respaldo: string;
  notas: string | null;
}

function filaActividadDe(f: FilaActividadCruda): FilaActividad {
  return {
    id: f.id,
    municipalityId: f.municipality_id,
    municipalityNombre: f.municipality_nombre,
    ciiuActivityId: f.ciiu_activity_id,
    ciiuCodigo: f.ciiu_codigo,
    ciiuNombre: f.ciiu_nombre,
    esPrincipal: f.es_principal,
    tarifaIcaOverride: f.tarifa_ica_override,
    vigenteDesde: f.vigente_desde,
    vigenteHasta: f.vigente_hasta,
    normaRespaldo: f.norma_respaldo,
    notas: f.notas,
  };
}

/** Actividades VIGENTES de un tercero, en todos sus municipios — la vista
 * multimunicipio completa del proveedor. */
export async function listarActividadesVigentes(
  tx: SqlClient,
  terceroId: string,
  fecha: string = hoyIso(),
): Promise<FilaActividad[]> {
  requerirFechaIso(fecha);
  const { rows } = await tx.query<FilaActividadCruda>(
    `SELECT ta.id, ta.municipality_id, m.nombre AS municipality_nombre,
            ta.ciiu_activity_id, ci.codigo AS ciiu_codigo, ci.nombre AS ciiu_nombre,
            ta.es_principal, ta.tarifa_ica_override::text,
            ta.vigente_desde::text, ta.vigente_hasta::text, ta.norma_respaldo, ta.notas
       FROM third_party_activity ta
       JOIN municipality m ON m.id = ta.municipality_id
       JOIN ciiu_activity ci ON ci.id = ta.ciiu_activity_id
      WHERE ta.third_party_id = $1 AND app.esta_vigente(ta.vigente_desde, ta.vigente_hasta, $2::date)
      ORDER BY ta.es_principal DESC, m.nombre, ci.codigo`,
    [terceroId, fecha],
  );
  return rows.map(filaActividadDe);
}

/** Historial completo de una terna tercero×municipio×CIIU: prueba visual de
 * "nunca UPDATE" para actividades. */
export async function listarHistorialActividad(
  tx: SqlClient,
  terceroId: string,
  municipalityId: string,
  ciiuActivityId: string,
): Promise<FilaActividad[]> {
  const { rows } = await tx.query<FilaActividadCruda>(
    `SELECT ta.id, ta.municipality_id, m.nombre AS municipality_nombre,
            ta.ciiu_activity_id, ci.codigo AS ciiu_codigo, ci.nombre AS ciiu_nombre,
            ta.es_principal, ta.tarifa_ica_override::text,
            ta.vigente_desde::text, ta.vigente_hasta::text, ta.norma_respaldo, ta.notas
       FROM third_party_activity ta
       JOIN municipality m ON m.id = ta.municipality_id
       JOIN ciiu_activity ci ON ci.id = ta.ciiu_activity_id
      WHERE ta.third_party_id = $1 AND ta.municipality_id = $2 AND ta.ciiu_activity_id = $3
      ORDER BY ta.vigente_desde DESC`,
    [terceroId, municipalityId, ciiuActivityId],
  );
  return rows.map(filaActividadDe);
}

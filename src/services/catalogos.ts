/**
 * A16 — Altas de catálogo y de vigencia (Ola 4, Tareas 1 y 3).
 *
 * POR QUÉ EXISTE ESTE ARCHIVO. `parametrizacion.ts` (A8) resuelve muy bien un
 * problema: EDITAR un parámetro que ya existe, cerrando su vigencia e
 * insertando la nueva. Todas sus funciones piden un `reglaAnteriorId`, porque
 * en la Ola 2 todo lo editable venía ya sembrado por A1. La carga masiva trae
 * el caso que faltaba: la fila del archivo puede ser un ALTA (no existe nada
 * que reemplazar) o un REEMPLAZO (existe una vigencia abierta para esa misma
 * clave lógica).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * D-070 — LA CARGA MASIVA NO ES UN «UPSERT», ES UN ALTA DE VIGENCIA
 *
 * Cada fila de un archivo es una VIGENCIA NUEVA, nunca un `UPDATE` de un
 * valor. Cuando choca con una vigencia abierta de la misma clave lógica, esta
 * capa NO reimplementa el cierre: llama a la función de `parametrizacion.ts`
 * que ya lo sabe hacer (`editarTarifaTaxRule`, `editarUvtValue`,
 * `editarMunicipioIcaRule`, …), con lo cual la carga masiva hereda GRATIS las
 * seis conductas de la sección 6.2 — norma obligatoria, no retroactividad
 * sobre lo publicado, append-only, permiso, auditoría. Una tarifa cargada
 * desde un `.xlsx` queda exactamente igual de bien puesta que una tecleada a
 * mano, porque es el mismo código el que la pone.
 *
 * Los catálogos SIN vigencia (municipio, CIIU, concepto tributario, centro de
 * costo) sí admiten actualización directa: no llevan `vigente_desde`, no
 * entran en ninguna resolución por fecha, y corregirle el nombre a un
 * municipio no reescribe ningún hecho económico.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ESTE ARCHIVO NO CONTIENE NINGÚN VALOR TRIBUTARIO (Regla de Oro 2) y NO
 * CALCULA NINGUNA RETENCIÓN (Regla de Oro 4). Solo resuelve códigos a
 * identificadores y decide si una fila es alta o reemplazo.
 */
import type { SqlClient } from '../db/types';
import {
  editarMunicipioIcaRule,
  editarSmmlvValue,
  editarTarifaTaxRule,
  editarUvtValue,
  NormaDeRespaldoRequeridaError,
  VigenciaInvalidaError,
  type EditarMunicipioIcaInput,
  type ResultadoEdicion,
} from './parametrizacion';

export class CatalogoInvalidoError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'CatalogoInvalidoError';
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function requerirFechaIso(fecha: string, campo = 'La fecha de vigencia'): string {
  if (!ISO_DATE.test(fecha)) {
    throw new VigenciaInvalidaError(`${campo} debe tener formato AAAA-MM-DD; se recibió "${fecha}".`);
  }
  return fecha;
}

function requerirNorma(norma: string | null | undefined): string {
  const limpio = (norma ?? '').trim();
  if (!limpio) throw new NormaDeRespaldoRequeridaError();
  return limpio;
}

interface Contexto {
  tenantId: string;
  companyId: string | null;
}

async function contexto(tx: SqlClient): Promise<Contexto> {
  const { rows } = await tx.query<{ tenant_id: string | null; company_id: string | null }>(
    'SELECT app.current_tenant_id() AS tenant_id, app.current_company_id() AS company_id',
  );
  const tenantId = rows[0]?.tenant_id ?? null;
  if (!tenantId) {
    throw new CatalogoInvalidoError('No hay firma en la sesión: los catálogos solo se editan con sesión válida.');
  }
  return { tenantId, companyId: rows[0]?.company_id ?? null };
}

export type AlcanceNuevo = 'firma' | 'empresa';

/** A qué `company_id` va una fila NUEVA de un catálogo de alcance híbrido. */
function companyDeAlcance(ctx: Contexto, alcance: AlcanceNuevo | undefined): string | null {
  if (alcance !== 'empresa') return null; // compartido en la firma (D-015)
  if (!ctx.companyId) {
    throw new VigenciaInvalidaError(
      'Para crear una fila de una sola empresa hace falta tener una empresa seleccionada en la sesión.',
    );
  }
  return ctx.companyId;
}

// =============================================================================
// RESOLUCIÓN DE CÓDIGOS A IDENTIFICADORES
//
// Todos siguen la misma regla: se busca en lo que la RLS deja ver (global +
// firma + empresa) y gana lo más específico. Nunca se crea nada por el camino:
// si el código no existe, se devuelve `null` y quien llama decide si eso es un
// error de la fila o un campo opcional vacío.
// =============================================================================

export async function resolverMunicipioPorDane(tx: SqlClient, codigoDane: string): Promise<string | null> {
  const { rows } = await tx.query<{ id: string }>(
    `SELECT id FROM municipality WHERE codigo_dane = $1
      ORDER BY (company_id IS NOT NULL) DESC, (tenant_id IS NOT NULL) DESC LIMIT 1`,
    [codigoDane.trim()],
  );
  return rows[0]?.id ?? null;
}

export async function resolverCiiuPorCodigo(tx: SqlClient, codigo: string): Promise<string | null> {
  const { rows } = await tx.query<{ id: string }>(
    `SELECT id FROM ciiu_activity WHERE codigo = $1
      ORDER BY (company_id IS NOT NULL) DESC, (tenant_id IS NOT NULL) DESC LIMIT 1`,
    [codigo.trim()],
  );
  return rows[0]?.id ?? null;
}

export async function resolverTaxConcept(tx: SqlClient, tipo: string, codigo: string): Promise<string | null> {
  const { rows } = await tx.query<{ id: string }>(
    `SELECT id FROM tax_concept WHERE tipo = $1 AND codigo = $2
      ORDER BY (company_id IS NOT NULL) DESC, (tenant_id IS NOT NULL) DESC LIMIT 1`,
    [tipo, codigo.trim()],
  );
  return rows[0]?.id ?? null;
}

export async function resolverTerceroPorDocumento(
  tx: SqlClient,
  tipoDocumento: string,
  numeroDocumento: string,
): Promise<string | null> {
  const { rows } = await tx.query<{ id: string }>(
    'SELECT id FROM third_party WHERE tipo_documento = $1 AND numero_documento = $2',
    [tipoDocumento, numeroDocumento.trim()],
  );
  return rows[0]?.id ?? null;
}

// =============================================================================
// CATÁLOGOS SIN VIGENCIA
// =============================================================================

export interface DatosMunicipio {
  codigoDane: string;
  nombre: string;
  departamento: string;
  codigoDaneDepartamento: string;
  activo?: boolean;
  alcance?: AlcanceNuevo;
}

export async function guardarMunicipio(tx: SqlClient, input: DatosMunicipio): Promise<{ id: string; creado: boolean }> {
  const ctx = await contexto(tx);
  const codigoDane = input.codigoDane.trim();
  const { rows: propio } = await tx.query<{ id: string }>(
    'SELECT id FROM municipality WHERE codigo_dane = $1 AND tenant_id = $2',
    [codigoDane, ctx.tenantId],
  );
  if (propio[0]) {
    await tx.query(
      `UPDATE municipality SET nombre = $2, departamento = $3, codigo_dane_departamento = $4,
                               activo = $5, updated_at = now() WHERE id = $1`,
      [propio[0].id, input.nombre.trim(), input.departamento.trim(), input.codigoDaneDepartamento.trim(), input.activo ?? true],
    );
    return { id: propio[0].id, creado: false };
  }
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO municipality (tenant_id, company_id, codigo_dane, nombre, departamento,
                               codigo_dane_departamento, activo)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [
      ctx.tenantId,
      companyDeAlcance(ctx, input.alcance),
      codigoDane,
      input.nombre.trim(),
      input.departamento.trim(),
      input.codigoDaneDepartamento.trim(),
      input.activo ?? true,
    ],
  );
  return { id: rows[0]!.id, creado: true };
}

export interface DatosCiiu {
  codigo: string;
  nombre: string;
  seccion?: string | null;
  division?: string | null;
  activo?: boolean;
  alcance?: AlcanceNuevo;
}

export async function guardarCiiu(tx: SqlClient, input: DatosCiiu): Promise<{ id: string; creado: boolean }> {
  const ctx = await contexto(tx);
  const codigo = input.codigo.trim();
  const { rows: propio } = await tx.query<{ id: string }>(
    'SELECT id FROM ciiu_activity WHERE codigo = $1 AND tenant_id = $2',
    [codigo, ctx.tenantId],
  );
  if (propio[0]) {
    await tx.query(
      'UPDATE ciiu_activity SET nombre = $2, seccion = $3, division = $4, activo = $5, updated_at = now() WHERE id = $1',
      [propio[0].id, input.nombre.trim(), input.seccion ?? null, input.division ?? null, input.activo ?? true],
    );
    return { id: propio[0].id, creado: false };
  }
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO ciiu_activity (tenant_id, company_id, codigo, nombre, seccion, division, activo)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [
      ctx.tenantId,
      companyDeAlcance(ctx, input.alcance),
      codigo,
      input.nombre.trim(),
      input.seccion ?? null,
      input.division ?? null,
      input.activo ?? true,
    ],
  );
  return { id: rows[0]!.id, creado: true };
}

export type TipoConceptoTributario =
  | 'retefuente'
  | 'reteiva'
  | 'reteica'
  | 'autorretencion'
  | 'iva'
  | 'retefuente_salarios';

export interface DatosTaxConcept {
  tipo: TipoConceptoTributario;
  codigo: string;
  nombre: string;
  descripcion?: string | null;
  activo?: boolean;
  alcance?: AlcanceNuevo;
}

export async function guardarTaxConcept(
  tx: SqlClient,
  input: DatosTaxConcept,
): Promise<{ id: string; creado: boolean }> {
  const ctx = await contexto(tx);
  const companyId = companyDeAlcance(ctx, input.alcance);
  const codigo = input.codigo.trim();
  const { rows: propio } = await tx.query<{ id: string }>(
    `SELECT id FROM tax_concept
      WHERE tipo = $1 AND codigo = $2 AND tenant_id = $3 AND company_id IS NOT DISTINCT FROM $4`,
    [input.tipo, codigo, ctx.tenantId, companyId],
  );
  if (propio[0]) {
    await tx.query(
      'UPDATE tax_concept SET nombre = $2, descripcion = $3, activo = $4, updated_at = now() WHERE id = $1',
      [propio[0].id, input.nombre.trim(), input.descripcion ?? null, input.activo ?? true],
    );
    return { id: propio[0].id, creado: false };
  }
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO tax_concept (tenant_id, company_id, tipo, codigo, nombre, descripcion, activo)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [ctx.tenantId, companyId, input.tipo, codigo, input.nombre.trim(), input.descripcion ?? null, input.activo ?? true],
  );
  return { id: rows[0]!.id, creado: true };
}

export interface DatosCentroCosto {
  codigo: string;
  nombre: string;
  codigoPadre?: string | null;
  activo?: boolean;
}

export async function guardarCentroCosto(
  tx: SqlClient,
  input: DatosCentroCosto,
): Promise<{ id: string; creado: boolean }> {
  const ctx = await contexto(tx);
  if (!ctx.companyId) {
    throw new CatalogoInvalidoError(
      'Un centro de costo pertenece siempre a una empresa concreta: elija la empresa en la portada.',
    );
  }
  let parentId: string | null = null;
  if (input.codigoPadre?.trim()) {
    const { rows } = await tx.query<{ id: string }>(
      'SELECT id FROM cost_center WHERE codigo = $1 AND company_id = $2',
      [input.codigoPadre.trim(), ctx.companyId],
    );
    parentId = rows[0]?.id ?? null;
    if (!parentId) {
      throw new CatalogoInvalidoError(
        `El centro de costo padre "${input.codigoPadre.trim()}" no existe todavía. Ponga los padres antes que los hijos en el archivo.`,
      );
    }
  }
  const { rows: propio } = await tx.query<{ id: string }>(
    'SELECT id FROM cost_center WHERE codigo = $1 AND company_id = $2',
    [input.codigo.trim(), ctx.companyId],
  );
  if (propio[0]) {
    await tx.query(
      'UPDATE cost_center SET nombre = $2, parent_id = $3, activo = $4, updated_at = now() WHERE id = $1',
      [propio[0].id, input.nombre.trim(), parentId, input.activo ?? true],
    );
    return { id: propio[0].id, creado: false };
  }
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO cost_center (tenant_id, company_id, codigo, nombre, parent_id, activo)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [ctx.tenantId, ctx.companyId, input.codigo.trim(), input.nombre.trim(), parentId, input.activo ?? true],
  );
  return { id: rows[0]!.id, creado: true };
}

// =============================================================================
// TABLAS CON VIGENCIA — alta o reemplazo (D-070)
// =============================================================================

export interface AltaTaxRuleInput {
  tipo: TipoConceptoTributario;
  /** Código del `tax_concept` al que cuelga la regla. Debe existir ya. */
  conceptoCodigo: string;
  /** Tarifa como FRACCIÓN (D-005): 2,5 % = "0.025". */
  tarifa: string;
  baseMinimaUvt?: string | null;
  baseMinimaValor?: string | null;
  aplicaSobre?: string;
  aplicaA?: 'declarante' | 'no_declarante' | 'ambos';
  tipoPersona?: 'natural' | 'juridica' | 'ambos';
  /** Código DANE del municipio (ReteICA). Opcional. */
  municipioDane?: string | null;
  /** Código CIIU (ReteICA / autorretención). Opcional. */
  ciiuCodigo?: string | null;
  /** Tramo de la tabla progresiva del art. 383 ET. Opcional. */
  rangoDesdeUvt?: string | null;
  rangoHastaUvt?: string | null;
  uvtAdicionales?: string | null;
  /** Código PUC de la cuenta donde se registra la retención. Opcional. */
  cuentaCodigo?: string | null;
  vigenteDesde: string;
  vigenteHasta?: string | null;
  normaRespaldo: string;
  notas?: string | null;
  requiereVerificacionHumana?: boolean;
  alcance?: AlcanceNuevo;
}

/**
 * Alta o reemplazo de una regla tributaria.
 *
 * Cuando ya existe una vigencia ABIERTA para la misma clave lógica (mismo
 * concepto, tipo, discriminadores y tramo), delega en `editarTarifaTaxRule`:
 * es esa función —no esta— la que cierra la anterior, comprueba que no haya
 * asientos publicados posteriores y escribe la nueva. Aquí solo se decide
 * cuál de los dos caminos toca.
 */
export async function crearOReemplazarTaxRule(
  tx: SqlClient,
  input: AltaTaxRuleInput,
): Promise<ResultadoEdicion> {
  const normaRespaldo = requerirNorma(input.normaRespaldo);
  requerirFechaIso(input.vigenteDesde);
  if (input.vigenteHasta) requerirFechaIso(input.vigenteHasta, 'La fecha de fin de vigencia');
  if (input.baseMinimaUvt != null && input.baseMinimaValor != null) {
    throw new VigenciaInvalidaError('La base mínima se expresa en UVT o en pesos, nunca en las dos a la vez.');
  }

  const conceptoId = await resolverTaxConcept(tx, input.tipo, input.conceptoCodigo);
  if (!conceptoId) {
    throw new CatalogoInvalidoError(
      `No existe el concepto tributario "${input.conceptoCodigo}" de tipo "${input.tipo}". ` +
        'Cárguelo primero (plantilla de conceptos tributarios) y vuelva a subir este archivo.',
    );
  }

  const municipalityId = input.municipioDane?.trim()
    ? await resolverMunicipioPorDane(tx, input.municipioDane)
    : null;
  if (input.municipioDane?.trim() && !municipalityId) {
    throw new CatalogoInvalidoError(
      `No existe ningún municipio con código DANE "${input.municipioDane.trim()}". Cárguelo con la plantilla de municipios.`,
    );
  }
  const ciiuActivityId = input.ciiuCodigo?.trim() ? await resolverCiiuPorCodigo(tx, input.ciiuCodigo) : null;
  if (input.ciiuCodigo?.trim() && !ciiuActivityId) {
    throw new CatalogoInvalidoError(
      `No existe ninguna actividad CIIU con código "${input.ciiuCodigo.trim()}". Cárguela con la plantilla de CIIU.`,
    );
  }

  let accountId: string | null = null;
  if (input.cuentaCodigo?.trim()) {
    const { rows } = await tx.query<{ id: string }>('SELECT id FROM v_account_efectivo WHERE codigo = $1', [
      input.cuentaCodigo.trim(),
    ]);
    accountId = rows[0]?.id ?? null;
    if (!accountId) {
      throw new CatalogoInvalidoError(
        `No existe la cuenta PUC "${input.cuentaCodigo.trim()}" en el plan de cuentas de esta empresa.`,
      );
    }
  }

  const aplicaA = input.aplicaA ?? 'ambos';
  const tipoPersona = input.tipoPersona ?? 'ambos';

  const { rows: abiertas } = await tx.query<{ id: string }>(
    `SELECT id FROM tax_rule
      WHERE tax_concept_id = $1 AND tipo = $2 AND aplica_a = $3 AND tipo_persona = $4
        AND municipality_id  IS NOT DISTINCT FROM $5::uuid
        AND ciiu_activity_id IS NOT DISTINCT FROM $6::uuid
        AND rango_desde_uvt  IS NOT DISTINCT FROM $7::numeric
        AND vigente_hasta IS NULL
      ORDER BY (company_id IS NOT NULL) DESC, (tenant_id IS NOT NULL) DESC
      LIMIT 1`,
    [conceptoId, input.tipo, aplicaA, tipoPersona, municipalityId, ciiuActivityId, input.rangoDesdeUvt ?? null],
  );

  if (abiertas[0]) {
    return editarTarifaTaxRule(tx, {
      reglaAnteriorId: abiertas[0].id,
      vigenteDesde: input.vigenteDesde,
      normaRespaldo,
      tarifa: input.tarifa,
      baseMinimaUvt: input.baseMinimaUvt ?? null,
      baseMinimaValor: input.baseMinimaValor ?? null,
      aplicaSobre: input.aplicaSobre,
      accountId,
      notas: input.notas ?? null,
      requiereVerificacionHumana: input.requiereVerificacionHumana,
      alcanceNuevo: input.alcance,
    });
  }

  const ctx = await contexto(tx);
  const { rows: nueva } = await tx.query<{ id: string }>(
    `INSERT INTO tax_rule (
       tenant_id, company_id, tax_concept_id, tipo, tarifa, base_minima_uvt, base_minima_valor,
       aplica_sobre, aplica_a, tipo_persona, municipality_id, ciiu_activity_id,
       rango_desde_uvt, rango_hasta_uvt, uvt_adicionales, account_id,
       vigente_desde, vigente_hasta, norma_respaldo, notas, requiere_verificacion_humana, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'base_gravable'),$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
               app.current_user_id())
     RETURNING id`,
    [
      ctx.tenantId,
      companyDeAlcance(ctx, input.alcance),
      conceptoId,
      input.tipo,
      input.tarifa,
      input.baseMinimaUvt ?? null,
      input.baseMinimaValor ?? null,
      input.aplicaSobre ?? null,
      aplicaA,
      tipoPersona,
      municipalityId,
      ciiuActivityId,
      input.rangoDesdeUvt ?? null,
      input.rangoHastaUvt ?? null,
      input.uvtAdicionales ?? null,
      accountId,
      input.vigenteDesde,
      input.vigenteHasta ?? null,
      normaRespaldo,
      input.notas ?? null,
      input.requiereVerificacionHumana ?? false,
    ],
  );
  return { reglaNuevaId: nueva[0]!.id, reglaAnteriorCerrada: false };
}

export interface AltaUvtInput {
  anio: number;
  /** Centavos de COP (D-005). UVT de $49.799 → "4979900". */
  valorCentavos: string;
  vigenteDesde: string;
  vigenteHasta?: string | null;
  normaRespaldo: string;
  notas?: string | null;
  requiereVerificacionHumana?: boolean;
  alcance?: AlcanceNuevo;
}

export async function crearOReemplazarUvt(tx: SqlClient, input: AltaUvtInput): Promise<ResultadoEdicion> {
  const normaRespaldo = requerirNorma(input.normaRespaldo);
  requerirFechaIso(input.vigenteDesde);
  if (input.vigenteHasta) requerirFechaIso(input.vigenteHasta, 'La fecha de fin de vigencia');

  // Si la fila del archivo trae fin de vigencia (histórico), no reemplaza a
  // nadie: es una vigencia cerrada que convive con las demás. Solo el alta de
  // una vigencia ABIERTA choca con la abierta que ya hubiera.
  if (!input.vigenteHasta) {
    const { rows } = await tx.query<{ id: string }>(
      `SELECT id FROM uvt_value WHERE vigente_hasta IS NULL
        ORDER BY (company_id IS NOT NULL) DESC, (tenant_id IS NOT NULL) DESC LIMIT 1`,
    );
    if (rows[0]) {
      return editarUvtValue(tx, {
        reglaAnteriorId: rows[0].id,
        anio: input.anio,
        valorCentavos: input.valorCentavos,
        vigenteDesde: input.vigenteDesde,
        normaRespaldo,
        notas: input.notas ?? null,
        requiereVerificacionHumana: input.requiereVerificacionHumana,
        alcanceNuevo: input.alcance,
      });
    }
  }

  const ctx = await contexto(tx);
  const { rows: nueva } = await tx.query<{ id: string }>(
    `INSERT INTO uvt_value (tenant_id, company_id, anio, valor, vigente_desde, vigente_hasta,
                            norma_respaldo, notas, requiere_verificacion_humana, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, app.current_user_id()) RETURNING id`,
    [
      ctx.tenantId,
      companyDeAlcance(ctx, input.alcance),
      input.anio,
      input.valorCentavos,
      input.vigenteDesde,
      input.vigenteHasta ?? null,
      normaRespaldo,
      input.notas ?? null,
      input.requiereVerificacionHumana ?? false,
    ],
  );
  return { reglaNuevaId: nueva[0]!.id, reglaAnteriorCerrada: false };
}

export interface AltaSmmlvInput {
  anio: number;
  valorMensualCentavos: string;
  auxilioTransporteCentavos?: string | null;
  vigenteDesde: string;
  vigenteHasta?: string | null;
  normaRespaldo: string;
  notas?: string | null;
  requiereVerificacionHumana?: boolean;
  alcance?: AlcanceNuevo;
}

export async function crearOReemplazarSmmlv(tx: SqlClient, input: AltaSmmlvInput): Promise<ResultadoEdicion> {
  const normaRespaldo = requerirNorma(input.normaRespaldo);
  requerirFechaIso(input.vigenteDesde);
  if (input.vigenteHasta) requerirFechaIso(input.vigenteHasta, 'La fecha de fin de vigencia');

  if (!input.vigenteHasta) {
    const { rows } = await tx.query<{ id: string }>(
      `SELECT id FROM smmlv_value WHERE vigente_hasta IS NULL
        ORDER BY (company_id IS NOT NULL) DESC, (tenant_id IS NOT NULL) DESC LIMIT 1`,
    );
    if (rows[0]) {
      return editarSmmlvValue(tx, {
        reglaAnteriorId: rows[0].id,
        anio: input.anio,
        valorMensualCentavos: input.valorMensualCentavos,
        auxilioTransporteCentavos: input.auxilioTransporteCentavos ?? null,
        vigenteDesde: input.vigenteDesde,
        normaRespaldo,
        notas: input.notas ?? null,
        requiereVerificacionHumana: input.requiereVerificacionHumana,
        alcanceNuevo: input.alcance,
      });
    }
  }

  const ctx = await contexto(tx);
  const { rows: nueva } = await tx.query<{ id: string }>(
    `INSERT INTO smmlv_value (tenant_id, company_id, anio, valor_mensual, auxilio_transporte,
                              vigente_desde, vigente_hasta, norma_respaldo, notas,
                              requiere_verificacion_humana, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, app.current_user_id()) RETURNING id`,
    [
      ctx.tenantId,
      companyDeAlcance(ctx, input.alcance),
      input.anio,
      input.valorMensualCentavos,
      input.auxilioTransporteCentavos ?? null,
      input.vigenteDesde,
      input.vigenteHasta ?? null,
      normaRespaldo,
      input.notas ?? null,
      input.requiereVerificacionHumana ?? false,
    ],
  );
  return { reglaNuevaId: nueva[0]!.id, reglaAnteriorCerrada: false };
}

export interface AltaMunicipioIcaInput extends Omit<EditarMunicipioIcaInput, 'municipalityId' | 'reglaAnteriorId'> {
  municipioDane: string;
}

/** Alta o reemplazo de la regla de ReteICA de un municipio. */
export async function crearOReemplazarMunicipioIca(
  tx: SqlClient,
  input: AltaMunicipioIcaInput,
): Promise<ResultadoEdicion> {
  const municipalityId = await resolverMunicipioPorDane(tx, input.municipioDane);
  if (!municipalityId) {
    throw new CatalogoInvalidoError(
      `No existe ningún municipio con código DANE "${input.municipioDane}". Cárguelo con la plantilla de municipios ` +
        'antes de cargarle su regla de ICA.',
    );
  }
  const { rows } = await tx.query<{ id: string }>(
    `SELECT id FROM municipality_ica_rule WHERE municipality_id = $1 AND vigente_hasta IS NULL
      ORDER BY (company_id IS NOT NULL) DESC, (tenant_id IS NOT NULL) DESC LIMIT 1`,
    [municipalityId],
  );
  return editarMunicipioIcaRule(tx, {
    ...input,
    municipalityId,
    reglaAnteriorId: rows[0]?.id ?? null,
  });
}

export interface AltaCalendarioInput {
  anio: number;
  tipoObligacion: string;
  periodo: string;
  ultimoDigitoNit: string;
  fechaVencimiento: string;
  municipioDane?: string | null;
  vigenteDesde: string;
  vigenteHasta?: string | null;
  normaRespaldo: string;
  notas?: string | null;
  requiereVerificacionHumana?: boolean;
  alcance?: AlcanceNuevo;
}

/**
 * Calendario tributario. No hay «reemplazo»: cada fila es una obligación
 * concreta de un año, un período y un dígito de NIT. Si ya existe esa misma
 * fila abierta, el trigger PR002 lo dice, y eso es lo correcto — dos fechas de
 * vencimiento distintas para el mismo dígito no se resuelven adivinando.
 */
export async function crearCalendarioTributario(
  tx: SqlClient,
  input: AltaCalendarioInput,
): Promise<{ id: string }> {
  const normaRespaldo = requerirNorma(input.normaRespaldo);
  requerirFechaIso(input.vigenteDesde);
  requerirFechaIso(input.fechaVencimiento, 'La fecha de vencimiento');
  if (input.vigenteHasta) requerirFechaIso(input.vigenteHasta, 'La fecha de fin de vigencia');
  if (!/^([0-9]|[0-9]{2}|todos)$/.test(input.ultimoDigitoNit)) {
    throw new CatalogoInvalidoError(
      `"${input.ultimoDigitoNit}" no es un último dígito de NIT válido: use un dígito (0-9), dos dígitos (00-99) o la palabra "todos".`,
    );
  }

  const municipalityId = input.municipioDane?.trim()
    ? await resolverMunicipioPorDane(tx, input.municipioDane)
    : null;
  if (input.municipioDane?.trim() && !municipalityId) {
    throw new CatalogoInvalidoError(
      `No existe ningún municipio con código DANE "${input.municipioDane.trim()}".`,
    );
  }

  const ctx = await contexto(tx);
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO tax_calendar (tenant_id, company_id, anio, tipo_obligacion, periodo, ultimo_digito_nit,
                               fecha_vencimiento, municipality_id, vigente_desde, vigente_hasta,
                               norma_respaldo, notas, requiere_verificacion_humana, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, app.current_user_id()) RETURNING id`,
    [
      ctx.tenantId,
      companyDeAlcance(ctx, input.alcance),
      input.anio,
      input.tipoObligacion.trim(),
      input.periodo.trim(),
      input.ultimoDigitoNit,
      input.fechaVencimiento,
      municipalityId,
      input.vigenteDesde,
      input.vigenteHasta ?? null,
      normaRespaldo,
      input.notas ?? null,
      input.requiereVerificacionHumana ?? false,
    ],
  );
  return { id: rows[0]!.id };
}

export interface AltaNiifMappingInput {
  cuentaCodigo: string;
  clasificacionNiif: string;
  seccionNiif?: string | null;
  rubroEsf?: string | null;
  rubroEri?: string | null;
  rubroEfe?: string | null;
  vigenteDesde: string;
  vigenteHasta?: string | null;
  normaRespaldo: string;
  notas?: string | null;
  requiereVerificacionHumana?: boolean;
  alcance?: AlcanceNuevo;
}

const CLASIFICACIONES_NIIF = new Set([
  'activo_corriente',
  'activo_no_corriente',
  'pasivo_corriente',
  'pasivo_no_corriente',
  'patrimonio',
  'ingreso',
  'costo',
  'gasto',
  'otro_resultado_integral',
  'cuenta_de_orden',
]);

/**
 * Mapeo de una cuenta PUC a su rubro NIIF. Es lo que necesita A10 para armar
 * los estados financieros: sin él, el Estado de Situación Financiera no sabe
 * en qué línea poner la cuenta y sale incompleto.
 */
export async function crearOReemplazarNiifMapping(
  tx: SqlClient,
  input: AltaNiifMappingInput,
): Promise<ResultadoEdicion> {
  const normaRespaldo = requerirNorma(input.normaRespaldo);
  requerirFechaIso(input.vigenteDesde);
  if (input.vigenteHasta) requerirFechaIso(input.vigenteHasta, 'La fecha de fin de vigencia');
  if (!CLASIFICACIONES_NIIF.has(input.clasificacionNiif)) {
    throw new CatalogoInvalidoError(
      `"${input.clasificacionNiif}" no es una clasificación NIIF válida. Valores admitidos: ` +
        `${[...CLASIFICACIONES_NIIF].join(', ')}.`,
    );
  }

  const { rows: cuenta } = await tx.query<{ id: string }>('SELECT id FROM v_account_efectivo WHERE codigo = $1', [
    input.cuentaCodigo.trim(),
  ]);
  const accountId = cuenta[0]?.id ?? null;
  if (!accountId) {
    throw new CatalogoInvalidoError(
      `No existe la cuenta PUC "${input.cuentaCodigo.trim()}" en el plan de cuentas de esta empresa. ` +
        'Cargue primero el PUC.',
    );
  }

  const ctx = await contexto(tx);

  // Cierre de la vigencia abierta PROPIA, si la hay. La global no se toca (la
  // RLS tampoco lo permitiría): el mapeo de la firma la sobreescribe por
  // resolución de alcance, igual que el resto de paramétricas (D-015).
  const { rows: abierta } = await tx.query<{ id: string; vigente_desde: string }>(
    `SELECT id, vigente_desde::text FROM niif_mapping
      WHERE account_id = $1 AND vigente_hasta IS NULL AND tenant_id = $2`,
    [accountId, ctx.tenantId],
  );
  let cerrada = false;
  if (abierta[0]) {
    if (input.vigenteDesde <= abierta[0].vigente_desde) {
      throw new VigenciaInvalidaError(
        `La vigencia nueva (${input.vigenteDesde}) debe ser posterior a la que reemplaza (${abierta[0].vigente_desde}).`,
      );
    }
    const [anio, mes, dia] = input.vigenteDesde.split('-').map(Number) as [number, number, number];
    const anterior = new Date(Date.UTC(anio, mes - 1, dia));
    anterior.setUTCDate(anterior.getUTCDate() - 1);
    await tx.query('UPDATE niif_mapping SET vigente_hasta = $2 WHERE id = $1', [
      abierta[0].id,
      anterior.toISOString().slice(0, 10),
    ]);
    cerrada = true;
  }

  const { rows: nueva } = await tx.query<{ id: string }>(
    `INSERT INTO niif_mapping (tenant_id, company_id, account_id, clasificacion_niif, seccion_niif,
                               rubro_esf, rubro_eri, rubro_efe, vigente_desde, vigente_hasta,
                               norma_respaldo, notas, requiere_verificacion_humana, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, app.current_user_id()) RETURNING id`,
    [
      ctx.tenantId,
      companyDeAlcance(ctx, input.alcance),
      accountId,
      input.clasificacionNiif,
      input.seccionNiif ?? null,
      input.rubroEsf ?? null,
      input.rubroEri ?? null,
      input.rubroEfe ?? null,
      input.vigenteDesde,
      input.vigenteHasta ?? null,
      normaRespaldo,
      input.notas ?? null,
      input.requiereVerificacionHumana ?? false,
    ],
  );
  return { reglaNuevaId: nueva[0]!.id, reglaAnteriorCerrada: cerrada };
}

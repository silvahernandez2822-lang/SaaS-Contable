/**
 * A3 — Acceso de solo lectura a las tablas paramétricas de A1.
 *
 * Toda consulta lleva la fecha del hecho económico como filtro de vigencia
 * (Regla de Oro 3) y ninguna trae un valor por defecto: si no hay fila vigente
 * a esa fecha, se devuelve `null` y el motor manda el documento a revisión
 * manual. Inventar un valor por omisión —`es_declarante_renta = false`, por
 * ejemplo— cambiaría una retención del 4% a una del 6% sin que nadie lo vea
 * (D-014).
 *
 * El orden de preferencia de alcance es siempre el mismo: lo específico de la
 * empresa gana sobre lo de la firma, y lo de la firma sobre el catálogo global
 * (`tenant_id IS NULL`, D-015).
 */
import type { SqlClient } from '../db/types.js';
import type { FechaIso, TipoOperacionIca } from './tipos.js';

/** Filtro de alcance híbrido: propio de la empresa, propio de la firma, o global. */
const ALCANCE = `(
  (company_id = $COMPANY) OR
  (company_id IS NULL AND tenant_id = $TENANT) OR
  (company_id IS NULL AND tenant_id IS NULL)
)`;

/** Prioridad: empresa > firma > global; y a igualdad, la vigencia más reciente. */
const PRIORIDAD_ALCANCE = `(company_id IS NOT NULL) DESC, (tenant_id IS NOT NULL) DESC, vigente_desde DESC`;

function conAlcance(sql: string, company: string, tenant: string): string {
  return sql.replace(/\$ALCANCE/g, ALCANCE.replace('$COMPANY', company).replace('$TENANT', tenant));
}

// -----------------------------------------------------------------------------
// Filas tal como salen de la base. Los `numeric` llegan como texto: se
// convierten con las utilidades de `dinero.ts`, nunca con `parseFloat`.
// -----------------------------------------------------------------------------

export interface FilaEmpresa {
  id: string;
  tenant_id: string;
  regimen: string;
  es_gran_contribuyente: boolean;
  es_autorretenedor_renta: boolean;
  es_agente_retencion_renta: boolean;
  es_agente_retencion_iva: boolean;
  es_agente_retencion_ica: boolean;
  es_responsable_iva: boolean;
  ciiu_principal_id: string | null;
  municipality_id: string | null;
}

export interface FilaTercero {
  id: string;
  tipo_persona: 'natural' | 'juridica';
  es_del_exterior: boolean;
  municipality_id: string | null;
  pais: string;
}

export interface FilaAtributosFiscales {
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
  vigente_desde: FechaIso;
  vigente_hasta: FechaIso | null;
  norma_respaldo: string;
}

export interface FilaConcepto {
  id: string;
  codigo: string;
  nombre: string;
  naturaleza: string;
  cuenta_gasto_id: string | null;
  cuenta_iva_descontable_id: string | null;
  cuenta_contrapartida_id: string | null;
  tax_concept_retefuente_id: string | null;
  tax_concept_reteiva_id: string | null;
  tax_concept_reteiva_exterior_id: string | null;
  tax_concept_reteica_id: string | null;
  tax_concept_autorretencion_id: string | null;
  aplica_retefuente: boolean;
  aplica_reteiva: boolean;
  aplica_reteica: boolean;
  aplica_autorretencion: boolean;
  base_es_aiu: boolean;
  porcentaje_aiu_minimo: string | null;
  tipo_operacion_ica: TipoOperacionIca | null;
}

export interface FilaTaxRule {
  id: string;
  tenant_id: string | null;
  company_id: string | null;
  tax_concept_id: string;
  tipo: string;
  tarifa: string;
  base_minima_uvt: string | null;
  base_minima_valor: string | null;
  comparador_base_minima: 'mayor_o_igual' | 'mayor';
  aplica_sobre: 'base_gravable' | 'valor_iva' | 'aiu' | 'base_menos_iva';
  aplica_a: 'declarante' | 'no_declarante' | 'ambos';
  tipo_persona: 'natural' | 'juridica' | 'ambos';
  municipality_id: string | null;
  ciiu_activity_id: string | null;
  account_id: string | null;
  vigente_desde: FechaIso;
  vigente_hasta: FechaIso | null;
  norma_respaldo: string;
  especificidad: number;
}

export interface FilaMunicipioIca {
  id: string;
  municipality_id: string;
  practica_reteica: boolean;
  base_minima_servicios_uvt: string | null;
  base_minima_compras_uvt: string | null;
  base_minima_servicios_valor: string | null;
  base_minima_compras_valor: string | null;
  usa_tarifa_de_actividad: boolean;
  tarifa_general: string | null;
  regla_desempate_actividad: 'principal' | 'mayor_tarifa' | 'menor_tarifa';
  vigente_desde: FechaIso;
  vigente_hasta: FechaIso | null;
  norma_respaldo: string;
}

export interface FilaActividadTercero {
  id: string;
  municipality_id: string;
  ciiu_activity_id: string;
  es_principal: boolean;
  tarifa_ica_override: string | null;
  vigente_desde: FechaIso;
  norma_respaldo: string;
}

export interface FilaUvt {
  id: string;
  anio: number;
  valor: string;
  vigente_desde: FechaIso;
  vigente_hasta: FechaIso | null;
  norma_respaldo: string;
}

export interface FilaRedondeo {
  id: string;
  codigo: string;
  modo: string;
  multiplo: string;
  aplica_a: string;
  vigente_desde: FechaIso;
  norma_respaldo: string;
}

export interface CriterioReglaRetefuente {
  taxConceptId: string;
  esDeclarante: boolean;
  tipoPersona: 'natural' | 'juridica';
}

/**
 * Todo lo que el motor necesita leer. Es una interfaz para que las pruebas
 * puedan sustituirla, no para esconder la base: la implementación real es la
 * única que se usa en producción.
 */
export interface RepositorioTributario {
  empresa(companyId: string): Promise<FilaEmpresa | null>;
  tercero(companyId: string, terceroId: string): Promise<FilaTercero | null>;
  atributosFiscales(
    companyId: string,
    terceroId: string,
    fecha: FechaIso,
  ): Promise<FilaAtributosFiscales | null>;
  concepto(empresa: FilaEmpresa, conceptoId: string): Promise<FilaConcepto | null>;
  uvtVigente(empresa: FilaEmpresa, fecha: FechaIso): Promise<FilaUvt | null>;
  reglasRetefuente(
    empresa: FilaEmpresa,
    criterio: CriterioReglaRetefuente,
    fecha: FechaIso,
  ): Promise<FilaTaxRule[]>;
  reglasPorConcepto(
    empresa: FilaEmpresa,
    tipo: string,
    taxConceptId: string,
    fecha: FechaIso,
  ): Promise<FilaTaxRule[]>;
  reglasIca(
    empresa: FilaEmpresa,
    taxConceptId: string | null,
    municipalityId: string,
    ciiuActivityId: string | null,
    fecha: FechaIso,
  ): Promise<FilaTaxRule[]>;
  reglasAutorretencion(
    empresa: FilaEmpresa,
    taxConceptId: string,
    ciiuActivityId: string | null,
    fecha: FechaIso,
  ): Promise<FilaTaxRule[]>;
  municipioIca(
    empresa: FilaEmpresa,
    municipalityId: string,
    fecha: FechaIso,
  ): Promise<FilaMunicipioIca | null>;
  actividadesEnMunicipio(
    companyId: string,
    terceroId: string,
    municipalityId: string,
    fecha: FechaIso,
  ): Promise<FilaActividadTercero[]>;
  redondeo(empresa: FilaEmpresa, aplicaA: string, fecha: FechaIso): Promise<FilaRedondeo | null>;
  ajuste(companyId: string, clave: string): Promise<unknown | null>;
}

/**
 * Implementación sobre SQL. Recibe un `SqlClient` ya situado en su contexto de
 * sesión: el aislamiento lo impone RLS, no esta clase (Regla de Oro 7).
 */
export class RepositorioTributarioSql implements RepositorioTributario {
  constructor(private readonly tx: SqlClient) {}

  async empresa(companyId: string): Promise<FilaEmpresa | null> {
    const { rows } = await this.tx.query<FilaEmpresa>(
      `SELECT id, tenant_id, regimen, es_gran_contribuyente, es_autorretenedor_renta,
              es_agente_retencion_renta, es_agente_retencion_iva, es_agente_retencion_ica,
              es_responsable_iva, ciiu_principal_id, municipality_id
         FROM company WHERE id = $1`,
      [companyId],
    );
    return rows[0] ?? null;
  }

  async tercero(companyId: string, terceroId: string): Promise<FilaTercero | null> {
    const { rows } = await this.tx.query<FilaTercero>(
      `SELECT id, tipo_persona, es_del_exterior, municipality_id, pais
         FROM third_party WHERE id = $1 AND company_id = $2`,
      [terceroId, companyId],
    );
    return rows[0] ?? null;
  }

  async atributosFiscales(
    companyId: string,
    terceroId: string,
    fecha: FechaIso,
  ): Promise<FilaAtributosFiscales | null> {
    const { rows } = await this.tx.query<FilaAtributosFiscales>(
      `SELECT id, es_declarante_renta, es_autorretenedor_renta, es_gran_contribuyente,
              es_regimen_simple, es_responsable_iva, es_agente_retencion_renta,
              es_agente_retencion_iva, es_agente_retencion_ica, es_autorretenedor_ica,
              regimen_tributario, vigente_desde::text, vigente_hasta::text, norma_respaldo
         FROM third_party_fiscal_attribute
        WHERE third_party_id = $1 AND company_id = $2
          AND app.esta_vigente(vigente_desde, vigente_hasta, $3::date)
        ORDER BY vigente_desde DESC
        LIMIT 1`,
      [terceroId, companyId, fecha],
    );
    return rows[0] ?? null;
  }

  async concepto(empresa: FilaEmpresa, conceptoId: string): Promise<FilaConcepto | null> {
    const { rows } = await this.tx.query<FilaConcepto>(
      conAlcance(
        `SELECT id, codigo, nombre, naturaleza, cuenta_gasto_id, cuenta_iva_descontable_id,
                cuenta_contrapartida_id, tax_concept_retefuente_id, tax_concept_reteiva_id,
                tax_concept_reteiva_exterior_id, tax_concept_reteica_id,
                tax_concept_autorretencion_id, aplica_retefuente, aplica_reteiva, aplica_reteica,
                aplica_autorretencion, base_es_aiu, porcentaje_aiu_minimo, tipo_operacion_ica
           FROM concepto_causacion
          WHERE id = $3 AND activo AND $ALCANCE`,
        '$1',
        '$2',
      ),
      [empresa.id, empresa.tenant_id, conceptoId],
    );
    return rows[0] ?? null;
  }

  async uvtVigente(empresa: FilaEmpresa, fecha: FechaIso): Promise<FilaUvt | null> {
    const { rows } = await this.tx.query<FilaUvt>(
      conAlcance(
        `SELECT id, anio, valor::text, vigente_desde::text, vigente_hasta::text, norma_respaldo
           FROM uvt_value
          WHERE app.esta_vigente(vigente_desde, vigente_hasta, $3::date) AND $ALCANCE
          ORDER BY ${PRIORIDAD_ALCANCE}
          LIMIT 1`,
        '$1',
        '$2',
      ),
      [empresa.id, empresa.tenant_id, fecha],
    );
    return rows[0] ?? null;
  }

  /**
   * Columnas comunes de `tax_rule`, con la especificidad calculada en SQL: una
   * regla que nombra el atributo concreto del tercero gana sobre la que dice
   * "ambos". Así el eje "tercero" de la sección 8.2 opera de verdad.
   */
  private static readonly SELECT_REGLA = `
    SELECT id, tenant_id, company_id, tax_concept_id, tipo, tarifa::text, base_minima_uvt::text,
           base_minima_valor::text, comparador_base_minima, aplica_sobre, aplica_a, tipo_persona,
           municipality_id, ciiu_activity_id, account_id, vigente_desde::text,
           vigente_hasta::text, norma_respaldo,
           ((aplica_a <> 'ambos')::int * 4
            + (tipo_persona <> 'ambos')::int * 2
            + (ciiu_activity_id IS NOT NULL)::int) AS especificidad
      FROM tax_rule`;

  async reglasRetefuente(
    empresa: FilaEmpresa,
    criterio: CriterioReglaRetefuente,
    fecha: FechaIso,
  ): Promise<FilaTaxRule[]> {
    const { rows } = await this.tx.query<FilaTaxRule>(
      conAlcance(
        `${RepositorioTributarioSql.SELECT_REGLA}
          WHERE tipo = 'retefuente'
            AND tax_concept_id = $3
            AND app.esta_vigente(vigente_desde, vigente_hasta, $4::date)
            AND aplica_a IN ($5, 'ambos')
            AND tipo_persona IN ($6, 'ambos')
            AND $ALCANCE
          ORDER BY especificidad DESC, ${PRIORIDAD_ALCANCE}`,
        '$1',
        '$2',
      ),
      [
        empresa.id,
        empresa.tenant_id,
        criterio.taxConceptId,
        fecha,
        criterio.esDeclarante ? 'declarante' : 'no_declarante',
        criterio.tipoPersona,
      ],
    );
    return rows;
  }

  async reglasPorConcepto(
    empresa: FilaEmpresa,
    tipo: string,
    taxConceptId: string,
    fecha: FechaIso,
  ): Promise<FilaTaxRule[]> {
    const { rows } = await this.tx.query<FilaTaxRule>(
      conAlcance(
        `${RepositorioTributarioSql.SELECT_REGLA}
          WHERE tipo = $3
            AND tax_concept_id = $4
            AND app.esta_vigente(vigente_desde, vigente_hasta, $5::date)
            AND $ALCANCE
          ORDER BY especificidad DESC, ${PRIORIDAD_ALCANCE}`,
        '$1',
        '$2',
      ),
      [empresa.id, empresa.tenant_id, tipo, taxConceptId, fecha],
    );
    return rows;
  }

  async reglasIca(
    empresa: FilaEmpresa,
    taxConceptId: string | null,
    municipalityId: string,
    ciiuActivityId: string | null,
    fecha: FechaIso,
  ): Promise<FilaTaxRule[]> {
    const { rows } = await this.tx.query<FilaTaxRule>(
      conAlcance(
        `${RepositorioTributarioSql.SELECT_REGLA}
          WHERE tipo = 'reteica'
            AND municipality_id = $3
            AND ($4::uuid IS NULL OR tax_concept_id = $4)
            AND ciiu_activity_id IS NOT DISTINCT FROM $5::uuid
            AND app.esta_vigente(vigente_desde, vigente_hasta, $6::date)
            AND $ALCANCE
          ORDER BY especificidad DESC, ${PRIORIDAD_ALCANCE}`,
        '$1',
        '$2',
      ),
      [empresa.id, empresa.tenant_id, municipalityId, taxConceptId, ciiuActivityId, fecha],
    );
    return rows;
  }

  async reglasAutorretencion(
    empresa: FilaEmpresa,
    taxConceptId: string,
    ciiuActivityId: string | null,
    fecha: FechaIso,
  ): Promise<FilaTaxRule[]> {
    const { rows } = await this.tx.query<FilaTaxRule>(
      conAlcance(
        `${RepositorioTributarioSql.SELECT_REGLA}
          WHERE tipo = 'autorretencion'
            AND tax_concept_id = $3
            AND ciiu_activity_id IS NOT DISTINCT FROM $4::uuid
            AND app.esta_vigente(vigente_desde, vigente_hasta, $5::date)
            AND $ALCANCE
          ORDER BY especificidad DESC, ${PRIORIDAD_ALCANCE}`,
        '$1',
        '$2',
      ),
      [empresa.id, empresa.tenant_id, taxConceptId, ciiuActivityId, fecha],
    );
    return rows;
  }

  async municipioIca(
    empresa: FilaEmpresa,
    municipalityId: string,
    fecha: FechaIso,
  ): Promise<FilaMunicipioIca | null> {
    const { rows } = await this.tx.query<FilaMunicipioIca>(
      conAlcance(
        `SELECT id, municipality_id, practica_reteica, base_minima_servicios_uvt::text,
                base_minima_compras_uvt::text, base_minima_servicios_valor::text,
                base_minima_compras_valor::text, usa_tarifa_de_actividad, tarifa_general::text,
                regla_desempate_actividad, vigente_desde::text, vigente_hasta::text, norma_respaldo
           FROM municipality_ica_rule
          WHERE municipality_id = $3
            AND app.esta_vigente(vigente_desde, vigente_hasta, $4::date)
            AND $ALCANCE
          ORDER BY ${PRIORIDAD_ALCANCE}
          LIMIT 1`,
        '$1',
        '$2',
      ),
      [empresa.id, empresa.tenant_id, municipalityId, fecha],
    );
    return rows[0] ?? null;
  }

  async actividadesEnMunicipio(
    companyId: string,
    terceroId: string,
    municipalityId: string,
    fecha: FechaIso,
  ): Promise<FilaActividadTercero[]> {
    const { rows } = await this.tx.query<FilaActividadTercero>(
      `SELECT id, municipality_id, ciiu_activity_id, es_principal, tarifa_ica_override::text,
              vigente_desde::text, norma_respaldo
         FROM third_party_activity
        WHERE third_party_id = $1 AND company_id = $2 AND municipality_id = $3
          AND app.esta_vigente(vigente_desde, vigente_hasta, $4::date)
        ORDER BY es_principal DESC, ciiu_activity_id`,
      [terceroId, companyId, municipalityId, fecha],
    );
    return rows;
  }

  async redondeo(
    empresa: FilaEmpresa,
    aplicaA: string,
    fecha: FechaIso,
  ): Promise<FilaRedondeo | null> {
    const { rows } = await this.tx.query<FilaRedondeo>(
      conAlcance(
        `SELECT id, codigo, modo, multiplo::text, aplica_a, vigente_desde::text, norma_respaldo
           FROM rounding_rule
          WHERE aplica_a IN ($3, 'todos')
            AND app.esta_vigente(vigente_desde, vigente_hasta, $4::date)
            AND $ALCANCE
          ORDER BY (aplica_a <> 'todos') DESC, ${PRIORIDAD_ALCANCE}
          LIMIT 1`,
        '$1',
        '$2',
      ),
      [empresa.id, empresa.tenant_id, aplicaA, fecha],
    );
    return rows[0] ?? null;
  }

  async ajuste(companyId: string, clave: string): Promise<unknown | null> {
    const { rows } = await this.tx.query<{ valor: unknown }>(
      `SELECT valor FROM company_setting WHERE company_id = $1 AND clave = $2`,
      [companyId, clave],
    );
    if (rows.length === 0) return null;
    const valor = rows[0]!.valor;
    return typeof valor === 'string' ? (JSON.parse(valor) as unknown) : valor;
  }
}

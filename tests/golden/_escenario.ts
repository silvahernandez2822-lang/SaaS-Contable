/**
 * A3 — Montaje de los 20 casos dorados de la sección 12.
 *
 * REGLA QUE GOBIERNA ESTE ARCHIVO: aquí NO se escribe ni un valor tributario.
 * Ni una tarifa, ni una base mínima, ni una UVT. Todo eso lo carga A1 desde
 * `db/seeds/` (todas las tandas, como en producción) y este montaje solo lo lee.
 *
 * Lo que sí monta este archivo, y por qué cada cosa NO es un valor tributario:
 *
 *  · La firma, la empresa-cliente, los terceros y sus atributos fiscales. Son
 *    datos del escenario, no parámetros normativos.
 *
 *  · Los `concepto_causacion`. Por diseño (sección 8.2 y CHECK del esquema) un
 *    concepto NO puede llevar tarifa: solo punteros a `tax_concept`. Lo que se
 *    monta aquí son punteros a los conceptos que cargó A1.
 *
 *  · Una `rounding_rule` de alcance de EMPRESA. A1 no cargó ninguna en ninguna
 *    tanda y sin regla de redondeo el motor —correctamente— manda todo a revisión
 *    manual. El redondeo no es una tarifa ni una base: es cómo se aproxima el
 *    resultado (Regla de Oro 5, «las reglas de redondeo son también parámetros
 *    configurables»). La que se monta aquí redondea al peso y está marcada como
 *    parámetro de prueba en su `norma_respaldo`. Queda anotado como pendiente
 *    de A1 en el reporte de A3.
 *
 *  · Dos `tax_rule` de tipo `reteica`, cuya TARIFA NO SE ESCRIBE: se copia con
 *    un SELECT desde `municipality_ica_rule.tarifa_general` de Medellín, que es
 *    un dato real cargado por A1 con su norma de respaldo. A1 dejó esas filas
 *    sin materializar en `tax_rule` (ver 090_municipio_ica_reglas.sql) y sin
 *    ellas el motor no puede trazar la retención contra una regla, que es lo
 *    que exige la FK compuesta de D-017. También queda anotado como pendiente.
 */
import { fileURLToPath } from 'node:url';
import { createTestDb, uuid, type TestDb } from '../helpers/db.js';
import { seed } from '../../src/db/seed.js';
import type { SqlClient } from '../../src/db/types.js';

const SEEDS_DIR = fileURLToPath(new URL('../../db/seeds', import.meta.url));

/** Convierte pesos a centavos (D-005). No es un valor tributario: es la unidad. */
export function pesos(valor: number): number {
  return valor * 100;
}

export interface ConceptosEscenario {
  servicios: string;
  serviciosSoloRetefuente: string;
  compras: string;
  honorariosPj: string;
  arrendamientoMuebles: string;
  arrendamientoInmuebles: string;
  vigilancia: string;
  serviciosExterior: string;
  serviciosIca: string;
}

export interface MunicipiosEscenario {
  bogota: string;
  medellin: string;
  cali: string;
}

export interface EscenarioDorado {
  db: TestDb;
  tenantId: string;
  companyId: string;
  userId: string;
  municipios: MunicipiosEscenario;
  /** CIIU global que cargó A1. */
  ciiuGlobal: string;
  /** Segunda actividad, de alcance de la firma, para el caso 10. */
  ciiuSecundaria: string;
  conceptos: ConceptosEscenario;
  cuentas: { retefuente: string; reteiva: string; reteica: string };
  roundingRuleId: string;
  /** Regla de ReteICA materializada para Medellín (tarifa copiada de A1). */
  reglaIcaMedellin: string;
  /** Regla de ReteICA materializada para Cali sobre la actividad secundaria. */
  reglaIcaCali: string;
}

async function idCuenta(tx: SqlClient, codigo: string): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `SELECT id FROM account WHERE tenant_id IS NULL AND company_id IS NULL AND codigo = $1`,
    [codigo],
  );
  if (!rows[0]) throw new Error(`El PUC global de A1 no trae la cuenta ${codigo}.`);
  return rows[0].id;
}

async function idMunicipio(tx: SqlClient, dane: string): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `SELECT id FROM municipality WHERE tenant_id IS NULL AND codigo_dane = $1`,
    [dane],
  );
  if (!rows[0]) throw new Error(`A1 no cargó el municipio con código DANE ${dane}.`);
  return rows[0].id;
}

export async function idTaxConcept(tx: SqlClient, tipo: string, codigo: string): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `SELECT id FROM tax_concept
      WHERE tenant_id IS NULL AND company_id IS NULL AND tipo = $1 AND codigo = $2`,
    [tipo, codigo],
  );
  if (!rows[0]) throw new Error(`A1 no cargó el tax_concept ${tipo}/${codigo}.`);
  return rows[0].id;
}

interface OpcionesConcepto {
  codigo: string;
  nombre: string;
  retefuente?: string | null;
  reteiva?: string | null;
  reteivaExterior?: string | null;
  reteica?: string | null;
  tipoOperacionIca?: 'servicios' | 'compras' | null;
}

async function crearConcepto(
  tx: SqlClient,
  tenantId: string,
  companyId: string,
  contrapartida: string,
  o: OpcionesConcepto,
): Promise<string> {
  const id = uuid();
  await tx.query(
    `INSERT INTO concepto_causacion (
       id, tenant_id, company_id, codigo, nombre, naturaleza, cuenta_contrapartida_id,
       tax_concept_retefuente_id, tax_concept_reteiva_id, tax_concept_reteiva_exterior_id,
       aplica_retefuente, aplica_reteiva, aplica_reteica, aplica_autorretencion,
       base_es_aiu, tipo_operacion_ica, tax_concept_reteica_id)
     VALUES ($1,$2,$3,$4,$5,'compra',$6,$7,$8,$9,$10,$11,$12,false,false,$13,$14)`,
    [
      id,
      tenantId,
      companyId,
      o.codigo,
      o.nombre,
      contrapartida,
      o.retefuente ?? null,
      o.reteiva ?? null,
      o.reteivaExterior ?? null,
      o.retefuente != null,
      o.reteiva != null || o.reteivaExterior != null,
      o.reteica != null,
      o.tipoOperacionIca ?? null,
      o.reteica ?? null,
    ],
  );
  return id;
}

/**
 * Materializa en `tax_rule` una regla de ReteICA cuya tarifa se COPIA de
 * `municipality_ica_rule.tarifa_general` de Medellín — dato de A1, con su
 * norma. No se escribe ningún número.
 */
async function materializarReglaIca(
  tx: SqlClient,
  opciones: {
    tenantId: string;
    taxConceptId: string;
    municipalityId: string;
    ciiuActivityId: string | null;
    municipioOrigenTarifa: string;
    accountId: string;
  },
): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO tax_rule (
       tenant_id, company_id, tax_concept_id, tipo, tarifa, aplica_sobre, aplica_a, tipo_persona,
       municipality_id, ciiu_activity_id, account_id, vigente_desde, norma_respaldo,
       requiere_verificacion_humana, notas)
     SELECT $6, NULL, $1, 'reteica', mir.tarifa_general, 'base_gravable', 'ambos', 'ambos',
            $2, $3::uuid, $4, mir.vigente_desde,
            'Tarifa copiada de municipality_ica_rule (' || mir.norma_respaldo || ')',
            true,
            'Materializada por la suite de casos dorados de A3 porque la tanda 1 de A1 no creó '
            || 'filas de tax_rule tipo reteica y retention_applied exige amarrar la retención a '
            || 'una regla con vigencia (D-017). La TARIFA no se escribió: se copió de la fila de A1.'
       FROM municipality_ica_rule mir
       JOIN municipality m ON m.id = mir.municipality_id
      WHERE m.codigo_dane = $5 AND mir.tarifa_general IS NOT NULL
     RETURNING id`,
    [
      opciones.taxConceptId,
      opciones.municipalityId,
      opciones.ciiuActivityId,
      opciones.accountId,
      opciones.municipioOrigenTarifa,
      opciones.tenantId,
    ],
  );
  if (!rows[0]) {
    throw new Error(
      'No se pudo materializar la regla de ReteICA: A1 no dejó ninguna tarifa general de la que ' +
        'copiarla. La suite no inventa tarifas.',
    );
  }
  return rows[0].id;
}

export async function montarEscenario(): Promise<EscenarioDorado> {
  const db = await createTestDb();

  const tenantId = uuid();
  const companyId = uuid();
  const userId = uuid();
  const ciiuSecundaria = uuid();
  const roundingRuleId = uuid();

  const escenario = await db.asAdmin(async (tx) => {
    // 1. Datos normativos reales de A1.
    await seed(tx, { dir: SEEDS_DIR });

    const cuentas = {
      retefuente: await idCuenta(tx, '2365'),
      reteiva: await idCuenta(tx, '2367'),
      reteica: await idCuenta(tx, '2368'),
    };
    const contrapartida = await idCuenta(tx, '2205');
    const municipios: MunicipiosEscenario = {
      bogota: await idMunicipio(tx, '11001'),
      medellin: await idMunicipio(tx, '05001'),
      cali: await idMunicipio(tx, '76001'),
    };
    const { rows: ciiu } = await tx.query<{ id: string }>(
      `SELECT id FROM ciiu_activity WHERE tenant_id IS NULL AND company_id IS NULL LIMIT 1`,
    );
    if (!ciiu[0]) throw new Error('A1 no cargó ninguna actividad CIIU global.');
    const ciiuGlobal = ciiu[0].id;

    // 2. Firma, empresa agente de retención de los tres tipos, y usuario.
    await tx.query(
      `INSERT INTO tenant (id, nit, razon_social, email_contacto)
       VALUES ($1, 'NIT-A3-DORADOS', 'Firma de los casos dorados', 'a3@pruebas.local')`,
      [tenantId],
    );
    await tx.query(
      `INSERT INTO ciiu_activity (id, tenant_id, codigo, nombre)
       VALUES ($1, $2, '0111', 'Actividad secundaria del escenario de pruebas de A3')`,
      [ciiuSecundaria, tenantId],
    );
    await tx.query(
      `INSERT INTO company (id, tenant_id, nit, razon_social, municipality_id, ciiu_principal_id,
                            es_agente_retencion_renta, es_agente_retencion_iva,
                            es_agente_retencion_ica, es_responsable_iva, buzon_email)
       VALUES ($1, $2, 'NIT-EMPRESA-A3', 'Empresa cliente de los casos dorados', $3, $4,
               true, true, true, true, 'a3-dorados@inbox.pruebas.local')`,
      [companyId, tenantId, municipios.bogota, ciiuGlobal],
    );
    await tx.query(
      `INSERT INTO "user" (id, tenant_id, email, nombre_completo, estado)
       VALUES ($1, $2, 'contador-a3@pruebas.local', 'Contador de los casos dorados', 'activo')`,
      [userId, tenantId],
    );

    // 3. Regla de redondeo (pendiente de A1). Al peso, media hacia arriba.
    await tx.query(
      `INSERT INTO rounding_rule (id, tenant_id, company_id, codigo, nombre, modo, multiplo,
                                  aplica_a, vigente_desde, norma_respaldo, notas,
                                  requiere_verificacion_humana)
       VALUES ($1, $2, $3, 'peso_half_up', 'Redondeo al peso', 'half_up', 100, 'todos',
               DATE '2000-01-01',
               'PARÁMETRO OPERATIVO DE PRUEBA de la suite de A3, no una norma tributaria.',
               'A1 no cargó rounding_rule en la tanda 1 y sin ella el motor manda todo a revisión manual. El redondeo no es tarifa ni base: es cómo se aproxima el resultado (Regla de Oro 5).',
               true)`,
      [roundingRuleId, tenantId, companyId],
    );

    // 4. Conceptos de causación: punteros a las reglas de A1, sin tarifas.
    const tcServicios = await idTaxConcept(tx, 'retefuente', 'servicios_generales');
    const tcCompras = await idTaxConcept(tx, 'retefuente', 'compras_generales');
    const tcHonorariosPj = await idTaxConcept(tx, 'retefuente', 'honorarios_pj');
    const tcArrMuebles = await idTaxConcept(tx, 'retefuente', 'arrendamiento_muebles');
    const tcArrInmuebles = await idTaxConcept(tx, 'retefuente', 'arrendamiento_inmuebles');
    const tcVigilancia = await idTaxConcept(tx, 'retefuente', 'vigilancia_aseo');
    const tcReteivaGeneral = await idTaxConcept(tx, 'reteiva', 'reteiva_general');
    const tcReteivaExterior = await idTaxConcept(tx, 'reteiva', 'reteiva_exterior');

    // A1 no creó ningún `tax_concept` de tipo 'reteica' en la tanda 1. Se crea
    // aquí, de alcance de la FIRMA, y no lleva tarifa: por diseño (D-013) un
    // tax_concept es identidad estable, la tarifa vive en tax_rule.
    const tcReteicaActividad = uuid();
    await tx.query(
      `INSERT INTO tax_concept (id, tenant_id, company_id, tipo, codigo, nombre, descripcion)
       VALUES ($1, $2, NULL, 'reteica', 'reteica_actividad',
               'ReteICA por la actividad del proveedor en el municipio',
               'Identidad creada por la suite de casos dorados de A3: la tanda 1 de A1 no trae conceptos de ReteICA. Sin tarifa, como exige D-013.')`,
      [tcReteicaActividad, tenantId],
    );

    const conceptos: ConceptosEscenario = {
      servicios: await crearConcepto(tx, tenantId, companyId, contrapartida, {
        codigo: 'SRV-GEN',
        nombre: 'Servicio general con retefuente y ReteIVA',
        retefuente: tcServicios,
        reteiva: tcReteivaGeneral,
      }),
      serviciosSoloRetefuente: await crearConcepto(tx, tenantId, companyId, contrapartida, {
        codigo: 'SRV-RF',
        nombre: 'Servicio general, solo retefuente',
        retefuente: tcServicios,
      }),
      compras: await crearConcepto(tx, tenantId, companyId, contrapartida, {
        codigo: 'COMPRA-GEN',
        nombre: 'Compra general de bienes',
        retefuente: tcCompras,
      }),
      honorariosPj: await crearConcepto(tx, tenantId, companyId, contrapartida, {
        codigo: 'HON-PJ',
        nombre: 'Honorarios a persona jurídica',
        retefuente: tcHonorariosPj,
      }),
      arrendamientoMuebles: await crearConcepto(tx, tenantId, companyId, contrapartida, {
        codigo: 'ARR-MUEBLE',
        nombre: 'Arrendamiento de bien mueble',
        retefuente: tcArrMuebles,
      }),
      arrendamientoInmuebles: await crearConcepto(tx, tenantId, companyId, contrapartida, {
        codigo: 'ARR-INMUEBLE',
        nombre: 'Arrendamiento de bien inmueble',
        retefuente: tcArrInmuebles,
      }),
      vigilancia: await crearConcepto(tx, tenantId, companyId, contrapartida, {
        codigo: 'VIGILANCIA',
        nombre: 'Servicio de vigilancia con AIU',
        retefuente: tcVigilancia,
      }),
      serviciosExterior: await crearConcepto(tx, tenantId, companyId, contrapartida, {
        codigo: 'SRV-EXTERIOR',
        nombre: 'Servicio prestado desde el exterior',
        reteiva: tcReteivaGeneral,
        reteivaExterior: tcReteivaExterior,
      }),
      serviciosIca: await crearConcepto(tx, tenantId, companyId, contrapartida, {
        codigo: 'SRV-ICA',
        nombre: 'Servicio con ReteICA municipal',
        reteica: tcReteicaActividad,
        tipoOperacionIca: 'servicios',
      }),
    };

    // 5. Reglas de ReteICA materializadas con la tarifa real de A1.
    const reglaIcaMedellin = await materializarReglaIca(tx, {
      tenantId,
      taxConceptId: tcReteicaActividad,
      municipalityId: municipios.medellin,
      ciiuActivityId: null,
      municipioOrigenTarifa: '05001',
      accountId: cuentas.reteica,
    });
    const reglaIcaCali = await materializarReglaIca(tx, {
      tenantId,
      taxConceptId: tcReteicaActividad,
      municipalityId: municipios.cali,
      ciiuActivityId: ciiuSecundaria,
      municipioOrigenTarifa: '05001',
      accountId: cuentas.reteica,
    });

    return {
      cuentas,
      municipios,
      ciiuGlobal,
      conceptos,
      reglaIcaMedellin,
      reglaIcaCali,
    };
  });

  return {
    db,
    tenantId,
    companyId,
    userId,
    municipios: escenario.municipios,
    ciiuGlobal: escenario.ciiuGlobal,
    ciiuSecundaria,
    conceptos: escenario.conceptos,
    cuentas: escenario.cuentas,
    roundingRuleId,
    reglaIcaMedellin: escenario.reglaIcaMedellin,
    reglaIcaCali: escenario.reglaIcaCali,
  };
}

// -----------------------------------------------------------------------------
// Terceros
// -----------------------------------------------------------------------------
export interface OpcionesTercero {
  tipoPersona?: 'natural' | 'juridica';
  declarante?: boolean;
  responsableIva?: boolean;
  regimenSimple?: boolean;
  autorretenedorRenta?: boolean;
  delExterior?: boolean;
  municipioId?: string | null;
  desde?: string;
  hasta?: string | null;
}

export async function crearTercero(
  e: EscenarioDorado,
  opciones: OpcionesTercero = {},
): Promise<string> {
  const id = uuid();
  const documento = `TP-${id.slice(0, 8)}`;
  await e.db.asAdmin(async (tx) => {
    await tx.query(
      `INSERT INTO third_party (id, tenant_id, company_id, tipo_documento, numero_documento,
                                tipo_persona, razon_social, municipality_id, es_del_exterior, pais)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        id,
        e.tenantId,
        e.companyId,
        opciones.delExterior ? 'NIT_EXTRANJERO' : 'NIT',
        documento,
        opciones.tipoPersona ?? 'juridica',
        `Proveedor ${documento}`,
        opciones.delExterior ? null : (opciones.municipioId ?? e.municipios.bogota),
        opciones.delExterior === true,
        opciones.delExterior ? 'US' : 'CO',
      ],
    );
    await tx.query(
      `INSERT INTO third_party_fiscal_attribute
         (tenant_id, company_id, third_party_id, es_declarante_renta, es_responsable_iva,
          es_regimen_simple, es_autorretenedor_renta, regimen_tributario,
          vigente_desde, vigente_hasta, norma_respaldo, fuente)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10::date,
               'RUT aportado por el cliente (escenario de pruebas de A3)', 'rut')`,
      [
        e.tenantId,
        e.companyId,
        id,
        opciones.declarante ?? true,
        opciones.responsableIva ?? true,
        opciones.regimenSimple === true,
        opciones.autorretenedorRenta === true,
        opciones.regimenSimple ? 'simple' : opciones.delExterior ? 'no_residente' : 'ordinario',
        opciones.desde ?? '2015-01-01',
        opciones.hasta ?? null,
      ],
    );
  });
  return id;
}

/** Registra la actividad económica del tercero en un municipio (ReteICA). */
export async function registrarActividad(
  e: EscenarioDorado,
  terceroId: string,
  municipioId: string,
  ciiuId: string,
  esPrincipal: boolean,
): Promise<void> {
  await e.db.asAdmin(async (tx) => {
    await tx.query(
      `INSERT INTO third_party_activity
         (tenant_id, company_id, third_party_id, municipality_id, ciiu_activity_id,
          es_principal, vigente_desde, norma_respaldo)
       VALUES ($1,$2,$3,$4,$5,$6, DATE '2015-01-01',
               'Actividad declarada en el RUT (escenario de pruebas de A3)')`,
      [e.tenantId, e.companyId, terceroId, municipioId, ciiuId, esPrincipal],
    );
  });
}

// -----------------------------------------------------------------------------
// Documentos fuente
// -----------------------------------------------------------------------------
export async function crearDocumento(
  e: EscenarioDorado,
  terceroId: string,
  fecha: string,
  opciones: { tipo?: string; referencia?: string | null; total?: number } = {},
): Promise<string> {
  const id = uuid();
  await e.db.asAdmin(async (tx) => {
    await tx.query(
      `INSERT INTO source_document (id, tenant_id, company_id, tipo_documento, cufe,
                                    numero_documento, emisor_nit, third_party_id,
                                    fecha_hecho_economico, hash_contenido, estado, total_neto,
                                    documento_referenciado_id)
       VALUES ($1,$2,$3,$4,$5,$6,'NIT-EMISOR',$7,$8::date,$9,'aprobado',$10,$11)`,
      [
        id,
        e.tenantId,
        e.companyId,
        opciones.tipo ?? 'Invoice',
        `CUFE-${id}`,
        `FE-${id.slice(0, 8)}`,
        terceroId,
        fecha,
        `hash-${id}`,
        opciones.total ?? null,
        opciones.referencia ?? null,
      ],
    );
  });
  return id;
}

/** Fotografía completa de la traza de un documento, para comparar byte a byte. */
export async function fotoRetenciones(
  e: EscenarioDorado,
  documentoId: string,
  omitirAdemas: readonly string[] = [],
): Promise<string> {
  return e.db.asAdmin(async (tx) => {
    const { rows } = await tx.query<{ foto: string }>(
      `SELECT COALESCE(
                jsonb_agg(to_jsonb(ra.*) - $2::text[] ORDER BY ra.tipo, ra.tax_rule_id)::text,
                '[]')
              AS foto
         FROM retention_applied ra
        WHERE ra.source_document_id = $1`,
      [documentoId, ['id', 'created_at', ...omitirAdemas]],
    );
    return rows[0]!.foto;
  });
}

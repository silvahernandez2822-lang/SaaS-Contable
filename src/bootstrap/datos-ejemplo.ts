/**
 * Datos de EJEMPLO para probar el sistema de punta a punta — encargo acotado
 * (no es un agente de la sección 4, es un complemento posterior a la Ola 3).
 *
 * QUÉ ES ESTO Y QUÉ NO ES. `npm run arranque` deja la firma, la empresa y el
 * usuario administrador, pero una base recién arrancada no tiene con qué
 * ejercitar el motor: cero terceros, cero facturas. Este archivo (y su CLI,
 * `datos-ejemplo-cli.ts`) llena eso con datos INVENTADOS PARA LA DEMOSTRACIÓN
 * — NUNCA con datos normativos. Cero tarifas, bases o UVT se escriben aquí:
 * todo lo que el motor use para calcular una retención sale de las tablas
 * paramétricas que carga `npm run seed` (A1, `db/seeds/`). Lo único que este
 * archivo escribe son HECHOS DE ESCENARIO — quién es el proveedor, qué
 * declaró, en qué municipio opera, qué dice la factura — exactamente la
 * misma frontera que ya describe la cabecera de `src/services/terceros.ts`.
 *
 * SEPARACIÓN DE LOS SEEDS NORMATIVOS (obligatoria, ver el reporte en
 * `docs/reportes/datos-ejemplo-a1.md`): los XML de ejemplo viven en
 * `db/demo/facturas/`, NUNCA en `db/seeds/` — `npm run seed` los ignora por
 * construcción (solo recorre `db/seeds/`, ver `src/db/seed.ts`) y este
 * archivo tampoco toca esa carpeta. Un despliegue real corre `npm run seed`
 * con total tranquilidad sin arrastrar ni un tercero ni una factura de
 * mentira: para tenerlos hay que pedirlo aparte, con `npm run datos-ejemplo`.
 *
 * HALLAZGO QUE ESTE ARCHIVO DEJA EXPLÍCITO (ver el reporte): la `company`
 * que crea `npm run arranque` nace con `es_agente_retencion_iva = false` y
 * `es_agente_retencion_ica = false` (los valores por defecto del esquema,
 * `db/migrations/002_organizacion.sql`). Sin esas dos banderas en `true` el
 * motor (`src/domain/motor.ts`, líneas ~512 y ~576) se niega a practicar
 * ReteIVA y ReteICA sin importar qué declare el tercero — correctamente: es
 * la empresa, no el proveedor, quien decide si actúa como agente de esas dos
 * retenciones. Este comando las enciende EXPLÍCITAMENTE sobre la empresa
 * elegida, con aviso en el reporte de consola, para que los datos de ejemplo
 * puedan ejercitar los tres tipos de retención. Si su empresa real no debe
 * ser agente de ReteIVA o de ReteICA, corríjalo después en la pantalla de
 * empresa — esto NO es una tarifa ni una base, es un atributo de la empresa,
 * y editarlo no toca ningún parámetro tributario.
 *
 * IDEMPOTENCIA (sección 6.2 aplicada a datos de escenario, no de vigencia):
 * cada paso comprueba si su fila ya existe antes de insertar, así que correr
 * `npm run datos-ejemplo` dos veces no duplica terceros, no rompe la
 * vigencia de un atributo fiscal y no reingresa la misma factura (el ingest
 * ya dedupe por CUFE/hash — ver `src/services/ingest.ts`).
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { DbHandle, SqlClient } from '../db/types';
import { withAdminContext, withSessionContext } from '../db/tenant-context';
import { abrirSesion } from '../auth/sesion';
import {
  calcularDigitoVerificacionNit,
  crearTercero,
  obtenerTercero,
  registrarActividad,
  registrarAtributosFiscales,
  type ActividadInput,
  type AtributosFiscalesInput,
  type DatosTercero,
} from '../services/terceros';
import { registrarDecisionHumana } from '../ai/memoria';
import { recibirDocumento } from '../services/ingest';
import { vaciarCola } from '../services/worker';

export const DEFAULT_FACTURAS_DIR = fileURLToPath(new URL('../../db/demo/facturas', import.meta.url));

export class DatosEjemploError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'DatosEjemploError';
  }
}

export interface OpcionesDatosEjemplo {
  /** NIT de la firma, si hay más de una en la base y hay que elegir. */
  firmaNit?: string | null;
  /** NIT de la empresa-cliente, si hay más de una y hay que elegir. */
  empresaNit?: string | null;
  facturasDir?: string;
  logger?: (mensaje: string) => void;
  /**
   * Guarda de seguridad (ver cabecera del archivo): si la empresa YA tiene
   * terceros propios (no es una empresa recién arrancada) y no es agente de
   * ReteIVA/ReteICA, este comando NO le enciende esas dos banderas por su
   * cuenta — son atributos con consecuencia tributaria real sobre una
   * empresa que ya podría estar en uso. Hay que pedirlo explícitamente.
   */
  forzarAgenteRetencion?: boolean;
}

interface EmpresaObjetivo {
  tenantId: string;
  companyId: string;
  firma: string;
  empresa: string;
  eraAgenteReteiva: boolean;
  eraAgenteReteica: boolean;
  tercerosExistentes: number;
}

interface FilaEmpresaCandidata {
  tenant_id: string;
  firma: string;
  company_id: string;
  empresa: string;
  empresa_nit: string;
  es_agente_retencion_iva: boolean;
  es_agente_retencion_ica: boolean;
}

async function resolverEmpresaObjetivo(
  db: DbHandle,
  opciones: OpcionesDatosEjemplo,
): Promise<EmpresaObjetivo> {
  return withAdminContext(db, async (tx) => {
    const condiciones: string[] = [];
    const params: string[] = [];
    if (opciones.firmaNit) {
      params.push(opciones.firmaNit);
      condiciones.push(`t.nit = $${params.length}`);
    }
    if (opciones.empresaNit) {
      params.push(opciones.empresaNit);
      condiciones.push(`c.nit = $${params.length}`);
    }
    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
    const { rows } = await tx.query<FilaEmpresaCandidata>(
      `SELECT t.id AS tenant_id, t.razon_social AS firma, c.id AS company_id,
              c.razon_social AS empresa, c.nit AS empresa_nit,
              c.es_agente_retencion_iva, c.es_agente_retencion_ica
         FROM company c
         JOIN tenant t ON t.id = c.tenant_id
         ${where}
         ORDER BY c.created_at ASC`,
      params,
    );

    if (rows.length === 0) {
      throw new DatosEjemploError(
        'No hay ninguna empresa en la base. Corra primero  npm run arranque  para crear la firma, ' +
          'la empresa y el usuario administrador, y luego  npm run seed  para cargar los datos ' +
          'normativos, antes de pedir datos de ejemplo.',
      );
    }
    if (rows.length > 1) {
      const lista = rows.map((r) => `  - firma "${r.firma}", empresa "${r.empresa}" (NIT ${r.empresa_nit})`).join('\n');
      throw new DatosEjemploError(
        `Hay ${rows.length} empresas en la base; indique cuál con --empresa-nit=. Encontradas:\n${lista}`,
      );
    }

    const fila = rows[0]!;
    const { rows: conteo } = await tx.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM third_party WHERE company_id = $1`,
      [fila.company_id],
    );
    return {
      tenantId: fila.tenant_id,
      companyId: fila.company_id,
      firma: fila.firma,
      empresa: fila.empresa,
      eraAgenteReteiva: fila.es_agente_retencion_iva,
      eraAgenteReteica: fila.es_agente_retencion_ica,
      tercerosExistentes: Number(conteo[0]?.n ?? 0),
    };
  });
}

async function encenderAgenteRetencion(
  db: DbHandle,
  companyId: string,
): Promise<void> {
  await withAdminContext(db, (tx) =>
    tx.query(
      `UPDATE company SET es_agente_retencion_iva = true, es_agente_retencion_ica = true WHERE id = $1`,
      [companyId],
    ),
  );
}

async function usuarioConAcceso(
  db: DbHandle,
  companyId: string,
): Promise<string> {
  return withAdminContext(db, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `SELECT u.id FROM "user" u
         JOIN user_company_access uca ON uca.user_id = u.id
        WHERE uca.company_id = $1 AND uca.revocado_en IS NULL
        ORDER BY u.created_at ASC LIMIT 1`,
      [companyId],
    );
    const fila = rows[0];
    if (!fila) {
      throw new DatosEjemploError(
        `La empresa ${companyId} no tiene ningún usuario con acceso vigente. Corra  npm run arranque  primero.`,
      );
    }
    return fila.id;
  });
}

async function asegurarPeriodoFiscal(
  db: DbHandle,
  tenantId: string,
  companyId: string,
  anio: number,
  mes: number,
): Promise<boolean> {
  return withAdminContext(db, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `SELECT id FROM fiscal_period WHERE company_id = $1 AND anio = $2 AND mes = $3`,
      [companyId, anio, mes],
    );
    if (rows[0]) return false;
    const fechaInicio = `${anio}-${String(mes).padStart(2, '0')}-01`;
    const ultimoDia = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
    const fechaFin = `${anio}-${String(mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`;
    await tx.query(
      `INSERT INTO fiscal_period (tenant_id, company_id, anio, mes, fecha_inicio, fecha_fin, estado)
       VALUES ($1, $2, $3, $4, $5, $6, 'abierto')`,
      [tenantId, companyId, anio, mes, fechaInicio, fechaFin],
    );
    return true;
  });
}

// -----------------------------------------------------------------------------
// Catálogo (leído, nunca escrito): municipios, CIIU, tax_concept, cuentas que
// ya cargó A1 en `db/seeds/`. Si falta alguno, el mensaje de error dice
// exactamente qué correr antes.
// -----------------------------------------------------------------------------

async function idMunicipioPorDane(tx: SqlClient, codigoDane: string, nombre: string): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `SELECT id FROM municipality WHERE tenant_id IS NULL AND codigo_dane = $1`,
    [codigoDane],
  );
  if (!rows[0]) {
    throw new DatosEjemploError(
      `Falta el municipio ${nombre} (DANE ${codigoDane}) en el catálogo. Corra  npm run seed  primero.`,
    );
  }
  return rows[0].id;
}

async function idCiiu(tx: SqlClient, codigo: string): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `SELECT id FROM ciiu_activity WHERE tenant_id IS NULL AND company_id IS NULL AND codigo = $1`,
    [codigo],
  );
  if (!rows[0]) {
    throw new DatosEjemploError(`Falta el CIIU ${codigo} en el catálogo. Corra  npm run seed  primero.`);
  }
  return rows[0].id;
}

async function idTaxConcept(tx: SqlClient, tipo: string, codigo: string): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `SELECT id FROM tax_concept WHERE tenant_id IS NULL AND company_id IS NULL AND tipo = $1 AND codigo = $2`,
    [tipo, codigo],
  );
  if (!rows[0]) {
    throw new DatosEjemploError(`Falta tax_concept ${tipo}/${codigo}. Corra  npm run seed  primero.`);
  }
  return rows[0].id;
}

async function idCuenta(tx: SqlClient, codigo: string): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `SELECT id FROM account WHERE tenant_id IS NULL AND company_id IS NULL AND codigo = $1`,
    [codigo],
  );
  if (!rows[0]) {
    throw new DatosEjemploError(`Falta la cuenta PUC ${codigo}. Corra  npm run seed  primero.`);
  }
  return rows[0].id;
}

// -----------------------------------------------------------------------------
// Terceros de ejemplo
// -----------------------------------------------------------------------------

interface TerceroEjemplo {
  clave: string;
  datos: DatosTercero;
  atributos: Omit<AtributosFiscalesInput, 'terceroId' | 'vigenteDesde' | 'normaRespaldo'> & {
    normaRespaldo: string;
  };
  actividad?: { municipalityId: string; ciiuActivityId: string; normaRespaldo: string };
}

export interface ResultadoTercero {
  clave: string;
  id: string;
  razonSocial: string;
  numeroDocumento: string;
  creado: boolean;
  atributosRegistrados: boolean;
  actividadRegistrada: boolean;
}

export interface ResultadoFactura {
  archivo: string;
  sourceDocumentId: string;
  duplicado: boolean;
  estadoCausacion: string | null;
  journalEntryId: string | null;
  motivos: string[];
}

export interface ResultadoDatosEjemplo {
  tenantId: string;
  companyId: string;
  firma: string;
  empresa: string;
  empresaMarcadaAgenteReteiva: boolean;
  empresaMarcadaAgenteReteica: boolean;
  periodoFiscalCreado: boolean;
  terceros: ResultadoTercero[];
  facturas: ResultadoFactura[];
}

const VIGENCIA_DEMO = '2026-01-01';
const NORMA_DEMO_ATRIBUTOS =
  'Dato de EJEMPLO, no un RUT real: atributos declarados para la demostración de npm run datos-ejemplo.';
const NORMA_DEMO_ACTIVIDAD =
  'Dato de EJEMPLO, no un RUT real: actividad económica declarada para la demostración de npm run datos-ejemplo.';

async function terceroYaExiste(
  tx: SqlClient,
  companyId: string,
  tipoDocumento: string,
  numeroDocumento: string,
): Promise<string | null> {
  const { rows } = await tx.query<{ id: string }>(
    `SELECT id FROM third_party WHERE company_id = $1 AND tipo_documento = $2 AND numero_documento = $3`,
    [companyId, tipoDocumento, numeroDocumento],
  );
  return rows[0]?.id ?? null;
}

async function actividadYaExiste(
  tx: SqlClient,
  terceroId: string,
  municipalityId: string,
  ciiuActivityId: string,
): Promise<boolean> {
  const { rows } = await tx.query<{ id: string }>(
    `SELECT id FROM third_party_activity
      WHERE third_party_id = $1 AND municipality_id = $2 AND ciiu_activity_id = $3 AND vigente_hasta IS NULL`,
    [terceroId, municipalityId, ciiuActivityId],
  );
  return rows.length > 0;
}

async function montarTerceros(
  tx: SqlClient,
  companyId: string,
  municipios: { bogota: string; medellin: string; cali: string },
  ciiu: { desarrolloSoftware: string; comercio: string },
  log: (m: string) => void,
): Promise<Map<string, ResultadoTercero>> {
  const nitConsultores = '900123456';
  const nitPacifico = '830111222';
  const nitAutorretenedora = '901555444';

  const definiciones: TerceroEjemplo[] = [
    {
      clave: 'consultores_andinos',
      datos: {
        tipoDocumento: 'NIT',
        numeroDocumento: nitConsultores,
        digitoVerificacion: calcularDigitoVerificacionNit(nitConsultores),
        tipoPersona: 'juridica',
        razonSocial: 'Consultores Andinos SAS',
        direccion: 'Calle 100 # 15-20, Oficina 501',
        municipalityId: municipios.bogota,
        email: 'contacto@consultoresandinos.ejemplo.co',
      },
      atributos: {
        esDeclaranteRenta: true,
        esAutorretenedorRenta: false,
        esGranContribuyente: false,
        esRegimenSimple: false,
        esResponsableIva: true,
        esAgenteRetencionRenta: false,
        esAgenteRetencionIva: false,
        esAgenteRetencionIca: false,
        esAutorretenedorIca: false,
        regimenTributario: 'ordinario',
        fuente: 'rut',
        normaRespaldo: NORMA_DEMO_ATRIBUTOS,
      },
      actividad: {
        municipalityId: municipios.bogota,
        ciiuActivityId: ciiu.desarrolloSoftware,
        normaRespaldo: NORMA_DEMO_ACTIVIDAD,
      },
    },
    {
      clave: 'maria_rios',
      datos: {
        tipoDocumento: 'CC',
        numeroDocumento: '43219876',
        tipoPersona: 'natural',
        razonSocial: 'María Fernanda Ríos',
        primerNombre: 'María Fernanda',
        primerApellido: 'Ríos',
        direccion: 'Carrera 43A # 5-15, apto 302',
        municipalityId: municipios.medellin,
        email: 'maria.rios@ejemplo.co',
      },
      atributos: {
        esDeclaranteRenta: false,
        esAutorretenedorRenta: false,
        esGranContribuyente: false,
        esRegimenSimple: false,
        esResponsableIva: false,
        esAgenteRetencionRenta: false,
        esAgenteRetencionIva: false,
        esAgenteRetencionIca: false,
        esAutorretenedorIca: false,
        regimenTributario: 'ordinario',
        fuente: 'declarado_por_cliente',
        normaRespaldo: NORMA_DEMO_ATRIBUTOS,
      },
      actividad: {
        municipalityId: municipios.medellin,
        ciiuActivityId: ciiu.desarrolloSoftware,
        normaRespaldo: NORMA_DEMO_ACTIVIDAD,
      },
    },
    {
      clave: 'comercializadora_pacifico',
      datos: {
        tipoDocumento: 'NIT',
        numeroDocumento: nitPacifico,
        digitoVerificacion: calcularDigitoVerificacionNit(nitPacifico),
        tipoPersona: 'juridica',
        razonSocial: 'Comercializadora del Pacífico SAS',
        direccion: 'Avenida 6 Norte # 23-45',
        municipalityId: municipios.cali,
        email: 'facturacion@pacifico.ejemplo.co',
      },
      atributos: {
        esDeclaranteRenta: true,
        esAutorretenedorRenta: false,
        esGranContribuyente: false,
        esRegimenSimple: false,
        esResponsableIva: true,
        esAgenteRetencionRenta: false,
        esAgenteRetencionIva: false,
        esAgenteRetencionIca: false,
        esAutorretenedorIca: false,
        regimenTributario: 'ordinario',
        fuente: 'rut',
        normaRespaldo: NORMA_DEMO_ATRIBUTOS,
      },
      actividad: {
        municipalityId: municipios.cali,
        ciiuActivityId: ciiu.comercio,
        normaRespaldo: NORMA_DEMO_ACTIVIDAD,
      },
    },
    {
      // Sin factura: solo maestro, para mostrar el extremo opuesto de
      // atributos fiscales — gran contribuyente, autorretenedora y agente de
      // las tres retenciones a la vez.
      clave: 'autorretenedora_nacional',
      datos: {
        tipoDocumento: 'NIT',
        numeroDocumento: nitAutorretenedora,
        digitoVerificacion: calcularDigitoVerificacionNit(nitAutorretenedora),
        tipoPersona: 'juridica',
        razonSocial: 'Autorretenedora Nacional SAS',
        direccion: 'Avenida Chile # 72-41, piso 8',
        municipalityId: municipios.bogota,
        email: 'tributaria@autorretenedoranacional.ejemplo.co',
      },
      atributos: {
        esDeclaranteRenta: true,
        esAutorretenedorRenta: true,
        esGranContribuyente: true,
        esRegimenSimple: false,
        esResponsableIva: true,
        esAgenteRetencionRenta: true,
        esAgenteRetencionIva: true,
        esAgenteRetencionIca: true,
        esAutorretenedorIca: true,
        regimenTributario: 'ordinario',
        fuente: 'rut',
        normaRespaldo: NORMA_DEMO_ATRIBUTOS,
      },
    },
    {
      // Sin factura: persona natural DECLARANTE y de régimen SIMPLE, para
      // que en el maestro de terceros se vean los cinco terceros con
      // combinaciones de atributos distintas entre sí (ver el reporte).
      clave: 'carlos_munoz',
      datos: {
        tipoDocumento: 'CC',
        numeroDocumento: '80234567',
        tipoPersona: 'natural',
        razonSocial: 'Carlos Andrés Muñoz',
        primerNombre: 'Carlos Andrés',
        primerApellido: 'Muñoz',
        direccion: 'Calle 82 # 11-30, oficina 601',
        municipalityId: municipios.bogota,
        email: 'carlos.munoz@ejemplo.co',
      },
      atributos: {
        esDeclaranteRenta: true,
        esAutorretenedorRenta: false,
        esGranContribuyente: false,
        esRegimenSimple: true,
        esResponsableIva: false,
        esAgenteRetencionRenta: false,
        esAgenteRetencionIva: false,
        esAgenteRetencionIca: false,
        esAutorretenedorIca: false,
        regimenTributario: 'simple',
        fuente: 'declarado_por_cliente',
        normaRespaldo: NORMA_DEMO_ATRIBUTOS,
      },
    },
  ];

  const resultado = new Map<string, ResultadoTercero>();

  for (const def of definiciones) {
    let creado = false;
    let terceroId = await terceroYaExiste(tx, companyId, def.datos.tipoDocumento, def.datos.numeroDocumento);
    if (!terceroId) {
      const { id } = await crearTercero(tx, def.datos);
      terceroId = id;
      creado = true;
      log(`  tercero creado: ${def.datos.razonSocial} (${def.datos.numeroDocumento})`);
    } else {
      log(`  tercero ya existía: ${def.datos.razonSocial} (${def.datos.numeroDocumento})`);
    }

    const existente = await obtenerTercero(tx, terceroId);
    let atributosRegistrados = false;
    if (!existente?.tieneAtributoFiscalVigente) {
      await registrarAtributosFiscales(tx, {
        terceroId,
        vigenteDesde: VIGENCIA_DEMO,
        ...def.atributos,
      });
      atributosRegistrados = true;
    }

    let actividadRegistrada = false;
    if (def.actividad) {
      const yaTiene = await actividadYaExiste(tx, terceroId, def.actividad.municipalityId, def.actividad.ciiuActivityId);
      if (!yaTiene) {
        const actividadInput: ActividadInput = {
          terceroId,
          municipalityId: def.actividad.municipalityId,
          ciiuActivityId: def.actividad.ciiuActivityId,
          esPrincipal: true,
          vigenteDesde: VIGENCIA_DEMO,
          normaRespaldo: def.actividad.normaRespaldo,
        };
        await registrarActividad(tx, actividadInput);
        actividadRegistrada = true;
      }
    }

    resultado.set(def.clave, {
      clave: def.clave,
      id: terceroId,
      razonSocial: def.datos.razonSocial,
      numeroDocumento: def.datos.numeroDocumento,
      creado,
      atributosRegistrados,
      actividadRegistrada,
    });
  }

  return resultado;
}

// -----------------------------------------------------------------------------
// Conceptos de causación de ejemplo. Cada uno es solo un PUNTERO a las reglas
// que A1 cargó (tax_concept) y a cuentas del PUC global (Regla de Oro 2: no
// hay ni una tarifa aquí, solo códigos de catálogo).
// -----------------------------------------------------------------------------

async function conceptoYaExiste(tx: SqlClient, tenantId: string, companyId: string, codigo: string): Promise<string | null> {
  const { rows } = await tx.query<{ id: string }>(
    `SELECT id FROM concepto_causacion WHERE tenant_id = $1 AND company_id = $2 AND codigo = $3`,
    [tenantId, companyId, codigo],
  );
  return rows[0]?.id ?? null;
}

interface DefinicionConcepto {
  codigo: string;
  nombre: string;
  aplicaReteiva: boolean;
  aplicaReteica: boolean;
  tipoOperacionIca: 'servicios' | null;
}

async function montarConceptos(
  tx: SqlClient,
  tenantId: string,
  companyId: string,
  taxConcepts: { retefuente: string; reteiva: string; reteica: string },
  cuentas: { gasto: string; ivaDescontable: string; contrapartida: string },
  log: (m: string) => void,
): Promise<Map<string, string>> {
  const definiciones: DefinicionConcepto[] = [
    {
      codigo: 'DEMO-SERV-GENERALES',
      nombre: 'Servicios profesionales generales (dato de ejemplo)',
      aplicaReteiva: true,
      aplicaReteica: false,
      tipoOperacionIca: null,
    },
    {
      codigo: 'DEMO-SERV-ICA-MUNICIPIO',
      nombre: 'Servicios profesionales con ReteICA de municipio (dato de ejemplo)',
      aplicaReteiva: false,
      aplicaReteica: true,
      tipoOperacionIca: 'servicios',
    },
  ];

  const resultado = new Map<string, string>();
  for (const def of definiciones) {
    let id = await conceptoYaExiste(tx, tenantId, companyId, def.codigo);
    if (!id) {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO concepto_causacion (
           tenant_id, company_id, codigo, nombre, naturaleza,
           cuenta_gasto_id, cuenta_iva_descontable_id, cuenta_contrapartida_id,
           tax_concept_retefuente_id, tax_concept_reteiva_id, tax_concept_reteica_id,
           aplica_retefuente, aplica_reteiva, aplica_reteica, tipo_operacion_ica)
         VALUES ($1,$2,$3,$4,'compra',$5,$6,$7,$8,$9,$10,true,$11,$12,$13)
         RETURNING id`,
        [
          tenantId,
          companyId,
          def.codigo,
          def.nombre,
          cuentas.gasto,
          cuentas.ivaDescontable,
          cuentas.contrapartida,
          taxConcepts.retefuente,
          def.aplicaReteiva ? taxConcepts.reteiva : null,
          def.aplicaReteica ? taxConcepts.reteica : null,
          def.aplicaReteiva,
          def.aplicaReteica,
          def.tipoOperacionIca,
        ],
      );
      id = rows[0]!.id;
      log(`  concepto de causación creado: ${def.nombre}`);
    } else {
      log(`  concepto de causación ya existía: ${def.nombre}`);
    }
    resultado.set(def.codigo, id);
  }
  return resultado;
}

// -----------------------------------------------------------------------------
// Función principal
// -----------------------------------------------------------------------------

interface DescripcionFactura {
  archivo: string;
  terceroClave: string;
  descripcionLinea: string;
  conceptoCodigo: string;
}

const FACTURAS: DescripcionFactura[] = [
  {
    archivo: '01-bogota-consultores-andinos.xml',
    terceroClave: 'consultores_andinos',
    descripcionLinea: 'Servicios de consultoria contable (dato de ejemplo)',
    conceptoCodigo: 'DEMO-SERV-GENERALES',
  },
  {
    archivo: '02-medellin-maria-rios.xml',
    terceroClave: 'maria_rios',
    descripcionLinea: 'Desarrollo de software a la medida (dato de ejemplo)',
    conceptoCodigo: 'DEMO-SERV-ICA-MUNICIPIO',
  },
  {
    archivo: '03-cali-comercializadora-pacifico.xml',
    terceroClave: 'comercializadora_pacifico',
    descripcionLinea: 'Mantenimiento locativo menor (dato de ejemplo)',
    conceptoCodigo: 'DEMO-SERV-GENERALES',
  },
];

export async function cargarDatosEjemplo(
  db: DbHandle,
  opciones: OpcionesDatosEjemplo = {},
): Promise<ResultadoDatosEjemplo> {
  const log = opciones.logger ?? (() => {});
  const facturasDir = opciones.facturasDir ?? DEFAULT_FACTURAS_DIR;

  const objetivo = await resolverEmpresaObjetivo(db, opciones);
  log(`Empresa objetivo: "${objetivo.empresa}" (firma "${objetivo.firma}").`);

  const faltaReteiva = !objetivo.eraAgenteReteiva;
  const faltaReteica = !objetivo.eraAgenteReteica;
  const empresaEsFresca = objetivo.tercerosExistentes === 0;
  let marcarReteiva = false;
  let marcarReteica = false;
  if (faltaReteiva || faltaReteica) {
    if (!empresaEsFresca && !opciones.forzarAgenteRetencion) {
      throw new DatosEjemploError(
        `La empresa "${objetivo.empresa}" ya tiene ${objetivo.tercerosExistentes} tercero(s) propio(s) y no es ` +
          'agente de retención de IVA y/o de ICA. Este comando no le cambia esos dos atributos sin ' +
          'pedírselo explícitamente, porque tienen consecuencia tributaria real sobre una empresa que ya ' +
          'podría estar en uso. Si de verdad quiere que los datos de ejemplo enciendan esas dos banderas ' +
          'sobre esta empresa, vuelva a correr el comando con  --forzar-agente-retencion',
      );
    }
    marcarReteiva = faltaReteiva;
    marcarReteica = faltaReteica;
    await encenderAgenteRetencion(db, objetivo.companyId);
    if (marcarReteiva) log('  la empresa se marcó como agente de retención de IVA (era false).');
    if (marcarReteica) log('  la empresa se marcó como agente de retención de ICA (era false).');
  }

  const userId = await usuarioConAcceso(db, objetivo.companyId);
  const periodoFiscalCreado = await asegurarPeriodoFiscal(db, objetivo.tenantId, objetivo.companyId, 2026, 8);
  if (periodoFiscalCreado) log('  período fiscal agosto-2026 abierto para la empresa.');

  const sesion = await abrirSesion(db, { userId, userAgent: 'datos-ejemplo-cli' });

  const { terceros, facturas } = await withSessionContext(
    db,
    { sessionToken: sesion.token, companyId: objetivo.companyId },
    async (tx) => {
      const municipios = {
        bogota: await idMunicipioPorDane(tx, '11001', 'Bogotá'),
        medellin: await idMunicipioPorDane(tx, '05001', 'Medellín'),
        cali: await idMunicipioPorDane(tx, '76001', 'Cali'),
      };
      const ciiu = {
        desarrolloSoftware: await idCiiu(tx, '6201'),
        comercio: await idCiiu(tx, '4711'),
      };
      const taxConcepts = {
        retefuente: await idTaxConcept(tx, 'retefuente', 'servicios_generales'),
        reteiva: await idTaxConcept(tx, 'reteiva', 'reteiva_general'),
        reteica: await idTaxConcept(tx, 'reteica', 'reteica_tarifa_general_municipio'),
      };
      const cuentas = {
        gasto: await idCuenta(tx, '5135'),
        ivaDescontable: await idCuenta(tx, '2408'),
        contrapartida: await idCuenta(tx, '2205'),
      };

      log('Terceros de ejemplo:');
      const terceros = await montarTerceros(tx, objetivo.companyId, municipios, ciiu, log);

      log('Conceptos de causación de ejemplo:');
      const conceptos = await montarConceptos(tx, objetivo.tenantId, objetivo.companyId, taxConcepts, cuentas, log);

      log('Memoria de clasificación (simula la decisión ya confirmada por un humano):');
      for (const f of FACTURAS) {
        const tercero = terceros.get(f.terceroClave);
        const conceptoId = conceptos.get(f.conceptoCodigo);
        if (!tercero || !conceptoId) continue;
        await registrarDecisionHumana(tx, {
          tenantId: objetivo.tenantId,
          companyId: objetivo.companyId,
          terceroId: tercero.id,
          descripcion: f.descripcionLinea,
          conceptoId,
          usuarioId: userId,
        });
        log(`  "${f.descripcionLinea}" -> concepto ${f.conceptoCodigo} para ${tercero.razonSocial}`);
      }

      log('Facturas de ejemplo (ingest):');
      const facturas: ResultadoFactura[] = [];
      for (const f of FACTURAS) {
        const rutaArchivo = path.join(facturasDir, f.archivo);
        const bytes = await readFile(rutaArchivo);
        const resultado = await recibirDocumento(tx, {
          bytes: new Uint8Array(bytes),
          nombreArchivo: f.archivo,
          origen: 'carga_manual',
        });
        if (resultado.ok) {
          log(`  ${f.archivo}: cargada${resultado.duplicado ? ' (ya existía, no se duplicó)' : ''}.`);
          facturas.push({
            archivo: f.archivo,
            sourceDocumentId: resultado.sourceDocumentId,
            duplicado: resultado.duplicado,
            estadoCausacion: null,
            journalEntryId: null,
            motivos: [],
          });
        } else {
          log(`  ${f.archivo}: EN CUARENTENA — ${resultado.motivoCuarentena}: ${resultado.detalle}`);
          facturas.push({
            archivo: f.archivo,
            sourceDocumentId: resultado.sourceDocumentId,
            duplicado: resultado.duplicado,
            estadoCausacion: 'en_cuarentena',
            journalEntryId: null,
            motivos: [resultado.detalle],
          });
        }
      }

      return { terceros, facturas };
    },
  );

  log('Procesando la cola de causación...');
  await vaciarCola(db, 'datos-ejemplo-cli');

  await withAdminContext(db, async (tx) => {
    for (const f of facturas) {
      if (f.estadoCausacion === 'en_cuarentena') continue;
      const { rows } = await tx.query<{ estado: string }>(
        `SELECT estado FROM source_document WHERE id = $1`,
        [f.sourceDocumentId],
      );
      f.estadoCausacion = rows[0]?.estado ?? null;
      const { rows: entryRows } = await tx.query<{ id: string }>(
        `SELECT id FROM journal_entry WHERE source_document_id = $1 AND tipo <> 'reversa' LIMIT 1`,
        [f.sourceDocumentId],
      );
      f.journalEntryId = entryRows[0]?.id ?? null;
      if (!f.journalEntryId) {
        const { rows: motivoRows } = await tx.query<{ resultado: Record<string, unknown> | null }>(
          `SELECT resultado FROM document_processing_job WHERE source_document_id = $1
            ORDER BY updated_at DESC LIMIT 1`,
          [f.sourceDocumentId],
        );
        const resultado = motivoRows[0]?.resultado;
        const motivos = resultado && typeof resultado === 'object' && 'motivos' in resultado
          ? (resultado as { motivos?: Array<{ detalle?: string }> }).motivos ?? []
          : [];
        f.motivos = motivos.map((m) => m.detalle ?? '').filter(Boolean);
      }
    }
  });

  return {
    tenantId: objetivo.tenantId,
    companyId: objetivo.companyId,
    firma: objetivo.firma,
    empresa: objetivo.empresa,
    empresaMarcadaAgenteReteiva: marcarReteiva,
    empresaMarcadaAgenteReteica: marcarReteica,
    periodoFiscalCreado,
    terceros: [...terceros.values()],
    facturas,
  };
}

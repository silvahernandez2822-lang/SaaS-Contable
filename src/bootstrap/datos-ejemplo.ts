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
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { DbHandle, SqlClient } from '../db/types';
import { withAdminContext, withSessionContext } from '../db/tenant-context';
import { abrirSesion } from '../auth/sesion';
import { aprobarAsiento } from '../services/causacion';
import { archivarDocumentoRechazado, reintegrarDocumentoRechazado } from '../services/bandeja';
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
  /** Escenarios de bandeja (D-082): null si no se pudieron montar. */
  escenariosBandeja: ResultadoEscenariosBandeja | null;
}

export interface EscenarioBandeja {
  /** Etiqueta legible del escenario. */
  nombre: string;
  numeroDocumento: string;
  sourceDocumentId: string;
  /** Estado final del `source_document`. */
  estado: string;
  /** Pestaña de la bandeja donde debería aparecer (o dónde NO, si es terminal). */
  dondeSeVe: string;
  /** Detalle extra (score, clave de idempotencia del asiento, etc.). */
  detalle: string;
}

export interface ResultadoEscenariosBandeja {
  escenarios: EscenarioBandeja[];
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
  const nitProveedorPrueba = '901888777';

  const definiciones: TerceroEjemplo[] = [
    {
      // D-082 (datos de prueba de bandeja): proveedor OBVIAMENTE de prueba,
      // registrado y responsable de IVA, sobre el que montamos los escenarios
      // de V-23, notas crédito rechazadas y las tres pestañas de la bandeja.
      // Mismos atributos que "Consultores Andinos SAS" — lo que cambia entre
      // escenarios es el estado del documento, no el perfil del tercero.
      clave: 'proveedor_prueba',
      datos: {
        tipoDocumento: 'NIT',
        numeroDocumento: nitProveedorPrueba,
        digitoVerificacion: calcularDigitoVerificacionNit(nitProveedorPrueba),
        tipoPersona: 'juridica',
        razonSocial: 'Proveedor Prueba SAS',
        direccion: 'Calle 123 # 45-67, oficina 890',
        municipalityId: municipios.bogota,
        email: 'facturacion@proveedorprueba.ejemplo.co',
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
      clave: 'consultores_andinos',
      datos: {
        tipoDocumento: 'NIT',
        numeroDocumento: nitConsultores,
        digitoVerificacion: calcularDigitoVerificacionNit(nitConsultores),
        tipoPersona: 'juridica',
        razonSocial: 'Consultores Andinos SAS',
        // D-086 (A14): dirección en formato DIAN. `direccion` la compone el
        // servicio; no se escribe a mano. Dos de los seis terceros de ejemplo
        // se dejan a propósito en texto libre para que el conjunto muestre
        // también el estado «requiere revisión» de la migración.
        direccionDian: {
          tipoVia: 'CL',
          numeroVia: '100',
          numeroGeneradora: '15',
          placa: '20',
          complementos: [{ tipo: 'OF', valor: '501' }],
        },
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
        direccionDian: {
          tipoVia: 'CR',
          numeroVia: '43',
          letraVia: 'A',
          numeroGeneradora: '5',
          placa: '15',
          complementos: [{ tipo: 'AP', valor: '302' }],
        },
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
        direccionDian: {
          tipoVia: 'AV',
          numeroVia: '6',
          cuadranteVia: 'NORTE',
          numeroGeneradora: '23',
          placa: '45',
        },
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
        direccionDian: {
          tipoVia: 'CL',
          numeroVia: '82',
          numeroGeneradora: '11',
          placa: '30',
          complementos: [{ tipo: 'OF', valor: '601' }],
        },
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

  const { terceros, facturas, conceptos } = await withSessionContext(
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

      return { terceros, facturas, conceptos };
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

  const proveedorPrueba = terceros.get('proveedor_prueba');
  const conceptoServGenerales = conceptos.get('DEMO-SERV-GENERALES');
  let escenariosBandeja: ResultadoEscenariosBandeja | null = null;
  if (proveedorPrueba && conceptoServGenerales) {
    log('');
    log('Escenarios de bandeja (V-23, notas crédito rechazadas, las tres pestañas)...');
    escenariosBandeja = await montarEscenariosBandeja(db, {
      tenantId: objetivo.tenantId,
      companyId: objetivo.companyId,
      sessionToken: sesion.token,
      userId,
      proveedorPruebaId: proveedorPrueba.id,
      proveedorPruebaNit: proveedorPrueba.numeroDocumento,
      conceptoServGeneralesId: conceptoServGenerales,
      log,
    });
  } else {
    log('  (se omiten los escenarios de bandeja: falta el tercero o el concepto de prueba)');
  }

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
    escenariosBandeja,
  };
}

// =============================================================================
// ESCENARIOS DE BANDEJA (D-082 — encargo de datos de prueba)
//
// Cobertura visual de V-23 (reintegro de una rechazada), V-28 (nota crédito
// rechazada recuperable) y las tres pestañas de `/bandeja` con datos que un
// contador puede recorrer sin tener que rechazar o reintegrar nada a mano.
//
// FRONTERA: NO se toca el motor. Cada documento entra por `recibirDocumento`
// (ingest real, dedupe por CUFE/hash), lo causa `vaciarCola` (el worker real:
// `procesarJobCausacion` -> resolución determinista de A3), y las transiciones
// de estado las hacen los servicios de dominio ya existentes
// (`aprobarAsiento`, `reintegrarDocumentoRechazado`, `archivarDocumentoRechazado`).
// Lo ÚNICO que se inserta directamente es la TRAZA de una propuesta de
// clasificación (`extraction` con `origen = 'manual'` y su `score_confianza`):
// es metadato de la IA, no un valor tributario (Regla de Oro 2) ni un cálculo
// (Regla de Oro 4), y no toca el ledger. En un flujo real esa fila la deja
// `clasificarDocumento` (A5) cuando hay un modelo disponible; aquí se simula
// para que la bandeja muestre el badge de confianza con distintos niveles.
//
// NOTA SOBRE ESTADOS: la pestaña "Pendientes de aprobación" lista documentos
// en `source_document.estado = 'pendiente_aprobacion'` (no 'parseado'); la de
// "Pendientes de revisión", documentos en 'recibido'/'parseado' cuyo job de
// causación terminó en revisión manual. El encargo pedía "recibido"/"parseado"
// por el nombre; lo que importa es la pestaña, y ahí es donde caen.
// =============================================================================

interface CtxEscenarios {
  tenantId: string;
  companyId: string;
  sessionToken: string;
  userId: string;
  proveedorPruebaId: string;
  proveedorPruebaNit: string;
  conceptoServGeneralesId: string;
  log: (mensaje: string) => void;
}

const FECHA_ESCENARIO = '2026-08-15';
const DESC_LINEA_ESCENARIO = 'Servicios de consultoría contable (dato de ejemplo)';
const EMISOR_PRUEBA_NOMBRE = 'Proveedor Prueba SAS';

/** CUFE de relleno: SHA-384 hex (96 caracteres) de la semilla del escenario.
 *  Sin validez criptográfica — igual que los CUFE del resto de `db/demo/`. Solo
 *  tiene que ser único por documento para que la deduplicación no los colapse. */
function cufeEscenario(semilla: string): string {
  return createHash('sha384').update(`demo-bandeja:${semilla}`).digest('hex');
}

/** Centavos (entero) -> monto UBL con dos decimales. */
function montoUbl(centavos: number): string {
  return (centavos / 100).toFixed(2);
}

interface PlantillaFactura {
  id: string;
  cufe: string;
  fecha: string;
  emisorNit: string;
  emisorNombre: string;
  descripcionLinea: string;
  baseCentavos: number;
}

/** Factura UBL 2.1 de demostración. Misma estructura que
 *  `db/demo/facturas/01-*.xml` (probada), parametrizada. El IVA del XML se
 *  calcula con aritmética entera (sin literales decimales de tarifa: la tarifa
 *  real la aplica el motor desde las tablas paramétricas, no este archivo). */
function xmlFacturaEscenario(p: PlantillaFactura): Uint8Array {
  const iva = Math.round((p.baseCentavos * 19) / 100);
  const total = p.baseCentavos + iva;
  const b = montoUbl(p.baseCentavos);
  const i = montoUbl(iva);
  const t = montoUbl(total);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!-- DATO DE EJEMPLO generado por npm run datos-ejemplo (escenarios de bandeja). NO es una captura de producción. -->
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>10</cbc:CustomizationID>
  <cbc:ID>${p.id}</cbc:ID>
  <cbc:UUID schemeName="CUFE-SHA384">${p.cufe}</cbc:UUID>
  <cbc:IssueDate>${p.fecha}</cbc:IssueDate>
  <cbc:IssueTime>09:30:00-05:00</cbc:IssueTime>
  <cbc:InvoiceTypeCode>01</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>COP</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyTaxScheme>
        <cbc:CompanyID schemeID="1" schemeName="31">${p.emisorNit}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>01</cbc:ID><cbc:Name>IVA</cbc:Name></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity><cbc:RegistrationName>${p.emisorNombre}</cbc:RegistrationName></cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyTaxScheme>
        <cbc:CompanyID schemeID="1" schemeName="31">800000000</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>01</cbc:ID><cbc:Name>IVA</cbc:Name></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity><cbc:RegistrationName>Empresa Cliente (la que usted creó con npm run arranque)</cbc:RegistrationName></cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="COP">${i}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="COP">${b}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="COP">${i}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:Percent>19.00</cbc:Percent>
        <cac:TaxScheme><cbc:ID>01</cbc:ID><cbc:Name>IVA</cbc:Name></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="COP">${b}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="COP">${b}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="COP">${t}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="COP">${t}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity unitCode="EA">1</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="COP">${b}</cbc:LineExtensionAmount>
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="COP">${i}</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="COP">${b}</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="COP">${i}</cbc:TaxAmount>
        <cac:TaxCategory>
          <cbc:Percent>19.00</cbc:Percent>
          <cac:TaxScheme><cbc:ID>01</cbc:ID><cbc:Name>IVA</cbc:Name></cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>
    </cac:TaxTotal>
    <cac:Item><cbc:Description>${p.descripcionLinea}</cbc:Description></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="COP">${b}</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>
</Invoice>`;
  return new TextEncoder().encode(xml);
}

interface PlantillaNota {
  id: string;
  cufe: string;
  fecha: string;
  emisorNit: string;
  emisorNombre: string;
  descripcionLinea: string;
  baseCentavos: number;
  facturaOriginalId: string;
  facturaOriginalCufe: string;
}

/** Nota crédito UBL 2.1 de demostración. Misma estructura que
 *  `tests/fixtures/ubl/credit-note-simple.xml`, parametrizada; referencia la
 *  factura original por su CUFE (`BillingReference`). */
function xmlNotaCreditoEscenario(p: PlantillaNota): Uint8Array {
  const iva = Math.round((p.baseCentavos * 19) / 100);
  const total = p.baseCentavos + iva;
  const b = montoUbl(p.baseCentavos);
  const i = montoUbl(iva);
  const t = montoUbl(total);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!-- DATO DE EJEMPLO generado por npm run datos-ejemplo (escenario de nota crédito rechazada, V-28). NO es una captura de producción. -->
<CreditNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"
            xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
            xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>10</cbc:CustomizationID>
  <cbc:ID>${p.id}</cbc:ID>
  <cbc:UUID schemeName="CUFE-SHA384">${p.cufe}</cbc:UUID>
  <cbc:IssueDate>${p.fecha}</cbc:IssueDate>
  <cbc:CreditNoteTypeCode>91</cbc:CreditNoteTypeCode>
  <cbc:DocumentCurrencyCode>COP</cbc:DocumentCurrencyCode>
  <cac:BillingReference>
    <cac:InvoiceDocumentReference>
      <cbc:ID>${p.facturaOriginalId}</cbc:ID>
      <cbc:UUID>${p.facturaOriginalCufe}</cbc:UUID>
    </cac:InvoiceDocumentReference>
  </cac:BillingReference>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyTaxScheme>
        <cbc:CompanyID schemeID="1" schemeName="31">${p.emisorNit}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>01</cbc:ID><cbc:Name>IVA</cbc:Name></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity><cbc:RegistrationName>${p.emisorNombre}</cbc:RegistrationName></cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyTaxScheme>
        <cbc:CompanyID schemeID="1" schemeName="31">800000000</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>01</cbc:ID><cbc:Name>IVA</cbc:Name></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity><cbc:RegistrationName>Empresa Cliente (la que usted creó con npm run arranque)</cbc:RegistrationName></cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="COP">${i}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="COP">${b}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="COP">${i}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:Percent>19.00</cbc:Percent>
        <cac:TaxScheme><cbc:ID>01</cbc:ID><cbc:Name>IVA</cbc:Name></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="COP">${b}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="COP">${b}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="COP">${t}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="COP">${t}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:CreditNoteLine>
    <cbc:ID>1</cbc:ID>
    <cbc:CreditedQuantity unitCode="EA">1</cbc:CreditedQuantity>
    <cbc:LineExtensionAmount currencyID="COP">${b}</cbc:LineExtensionAmount>
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="COP">${i}</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="COP">${b}</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="COP">${i}</cbc:TaxAmount>
        <cac:TaxCategory>
          <cbc:Percent>19.00</cbc:Percent>
          <cac:TaxScheme><cbc:ID>01</cbc:ID><cbc:Name>IVA</cbc:Name></cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>
    </cac:TaxTotal>
    <cac:Item><cbc:Description>${p.descripcionLinea}</cbc:Description></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="COP">${b}</cbc:PriceAmount></cac:Price>
  </cac:CreditNoteLine>
</CreditNote>`;
  return new TextEncoder().encode(xml);
}

/** Estado actual del `source_document`. */
async function estadoDe(tx: SqlClient, sourceDocumentId: string): Promise<string> {
  const { rows } = await tx.query<{ estado: string }>(
    `SELECT estado FROM source_document WHERE id = $1`,
    [sourceDocumentId],
  );
  return rows[0]?.estado ?? '(desconocido)';
}

/** Asiento BORRADOR del documento (causación o reversa), si lo hay. */
async function draftEntryId(
  tx: SqlClient,
  sourceDocumentId: string,
  tipo: 'causacion' | 'reversa',
): Promise<string | null> {
  const cond = tipo === 'reversa' ? `tipo = 'reversa'` : `tipo <> 'reversa'`;
  const { rows } = await tx.query<{ id: string }>(
    `SELECT id FROM journal_entry
      WHERE source_document_id = $1 AND estado = 'draft' AND ${cond}
      ORDER BY created_at DESC LIMIT 1`,
    [sourceDocumentId],
  );
  return rows[0]?.id ?? null;
}

/** Rechaza el asiento borrador del documento, si sigue en borrador (idempotente:
 *  si ya está rechazado/archivado/recausado, no hace nada). */
async function rechazarSiEsBorrador(
  tx: SqlClient,
  sourceDocumentId: string,
  ctx: CtxEscenarios,
  motivo: string,
  tipo: 'causacion' | 'reversa' = 'causacion',
): Promise<boolean> {
  const entry = await draftEntryId(tx, sourceDocumentId, tipo);
  if (!entry) return false;
  await aprobarAsiento(tx, {
    journalEntryId: entry,
    decision: 'rechazado',
    userId: ctx.userId,
    ip: '127.0.0.1',
    userAgent: 'datos-ejemplo-cli',
    motivo,
  });
  return true;
}

/** Estado actual del documento y la clave de idempotencia de su asiento vivo. */
async function estadoYClave(
  tx: SqlClient,
  sourceDocumentId: string,
): Promise<{ estado: string; idempotencyKey: string | null }> {
  const { rows } = await tx.query<{ estado: string }>(
    `SELECT estado FROM source_document WHERE id = $1`,
    [sourceDocumentId],
  );
  const { rows: entryRows } = await tx.query<{ idempotency_key: string }>(
    `SELECT idempotency_key FROM journal_entry
      WHERE source_document_id = $1 AND estado <> 'anulado'
      ORDER BY created_at DESC LIMIT 1`,
    [sourceDocumentId],
  );
  return { estado: rows[0]?.estado ?? '(desconocido)', idempotencyKey: entryRows[0]?.idempotency_key ?? null };
}

export async function montarEscenariosBandeja(
  db: DbHandle,
  ctx: CtxEscenarios,
): Promise<ResultadoEscenariosBandeja> {
  const { log } = ctx;
  const sess = { sessionToken: ctx.sessionToken, companyId: ctx.companyId };
  const escenarios: EscenarioBandeja[] = [];

  // Catálogo de los documentos que se van a montar. Los montos son "feos" a
  // propósito: sirven para ejercitar los filtros de monto de la bandeja.
  const APROBABLES = [
    { clave: 'apr_alta', id: 'DEMO-B-APR-1', nombre: 'Aprobación · confianza alta', base: 213700000, scoreCentesimas: 92 },
    { clave: 'apr_media', id: 'DEMO-B-APR-2', nombre: 'Aprobación · confianza media', base: 84600000, scoreCentesimas: 74 },
    { clave: 'apr_baja', id: 'DEMO-B-APR-3', nombre: 'Aprobación · confianza baja', base: 541200000, scoreCentesimas: 58 },
  ];
  const REVISION = [
    { id: 'DEMO-B-REV-1', nombre: 'Revisión · proveedor no registrado (papelería)', nit: '902111000', emisor: 'Suministros Sin Registro SAS', desc: 'Suministro de papelería y útiles de oficina (dato de ejemplo)', base: 71300000 },
    { id: 'DEMO-B-REV-2', nombre: 'Revisión · proveedor no registrado (mantenimiento)', nit: '902222000', emisor: 'Ferretería No Vinculada SAS', desc: 'Mantenimiento de equipos de cómputo (dato de ejemplo)', base: 47700000 },
    { id: 'DEMO-B-REV-3', nombre: 'Revisión · proveedor no registrado (mensajería)', nit: '902333000', emisor: 'Transportes Fantasma SAS', desc: 'Servicio de mensajería urbana (dato de ejemplo)', base: 45900000 },
  ];
  const ARCHIVAR = [
    { id: 'DEMO-B-ARC-1', nombre: 'Rechazada y archivada (1)', base: 31700000 },
    { id: 'DEMO-B-ARC-2', nombre: 'Rechazada y archivada (2)', base: 33900000 },
  ];
  const V23_ID = 'DEMO-B-V23-1';
  const ORIGINAL_ID = 'DEMO-B-NC-ORIG';
  const NOTA_ID = 'DEMO-B-NC-1';
  const ORIGINAL_CUFE = cufeEscenario(ORIGINAL_ID);

  // ---------------------------------------------------------------------------
  // FASE A — ingest de todo lo causable + memoria del proveedor de prueba.
  // ---------------------------------------------------------------------------
  const ids = await withSessionContext(db, sess, async (tx) => {
    // Una sola entrada de memoria cubre TODAS las facturas del proveedor de
    // prueba (misma clave: company + tercero + patrón de la descripción).
    await registrarDecisionHumana(tx, {
      tenantId: ctx.tenantId,
      companyId: ctx.companyId,
      terceroId: ctx.proveedorPruebaId,
      descripcion: DESC_LINEA_ESCENARIO,
      conceptoId: ctx.conceptoServGeneralesId,
      usuarioId: ctx.userId,
    });

    const recibir = async (bytes: Uint8Array, archivo: string): Promise<string> => {
      const r = await recibirDocumento(tx, { bytes, nombreArchivo: archivo, origen: 'carga_manual' });
      if (!r.ok) {
        throw new DatosEjemploError(`El escenario "${archivo}" quedó en cuarentena: ${r.detalle}`);
      }
      return r.sourceDocumentId;
    };

    const aprobables: Record<string, string> = {};
    for (const a of APROBABLES) {
      aprobables[a.clave] = await recibir(
        xmlFacturaEscenario({
          id: a.id,
          cufe: cufeEscenario(a.id),
          fecha: FECHA_ESCENARIO,
          emisorNit: ctx.proveedorPruebaNit,
          emisorNombre: EMISOR_PRUEBA_NOMBRE,
          descripcionLinea: DESC_LINEA_ESCENARIO,
          baseCentavos: a.base,
        }),
        `${a.id}.xml`,
      );
    }

    const revision: string[] = [];
    for (const r of REVISION) {
      revision.push(
        await recibir(
          xmlFacturaEscenario({
            id: r.id,
            cufe: cufeEscenario(r.id),
            fecha: FECHA_ESCENARIO,
            emisorNit: r.nit,
            emisorNombre: r.emisor,
            descripcionLinea: r.desc,
            baseCentavos: r.base,
          }),
          `${r.id}.xml`,
        ),
      );
    }

    const archivar: string[] = [];
    for (const a of ARCHIVAR) {
      archivar.push(
        await recibir(
          xmlFacturaEscenario({
            id: a.id,
            cufe: cufeEscenario(a.id),
            fecha: FECHA_ESCENARIO,
            emisorNit: ctx.proveedorPruebaNit,
            emisorNombre: EMISOR_PRUEBA_NOMBRE,
            descripcionLinea: DESC_LINEA_ESCENARIO,
            baseCentavos: a.base,
          }),
          `${a.id}.xml`,
        ),
      );
    }

    const v23 = await recibir(
      xmlFacturaEscenario({
        id: V23_ID,
        cufe: cufeEscenario(V23_ID),
        fecha: FECHA_ESCENARIO,
        emisorNit: ctx.proveedorPruebaNit,
        emisorNombre: EMISOR_PRUEBA_NOMBRE,
        descripcionLinea: DESC_LINEA_ESCENARIO,
        baseCentavos: 118900000,
      }),
      `${V23_ID}.xml`,
    );

    const original = await recibir(
      xmlFacturaEscenario({
        id: ORIGINAL_ID,
        cufe: ORIGINAL_CUFE,
        fecha: FECHA_ESCENARIO,
        emisorNit: ctx.proveedorPruebaNit,
        emisorNombre: EMISOR_PRUEBA_NOMBRE,
        descripcionLinea: DESC_LINEA_ESCENARIO,
        baseCentavos: 99400000,
      }),
      `${ORIGINAL_ID}.xml`,
    );

    return { aprobables, revision, archivar, v23, original };
  });

  log('  ingest de los documentos de escenario listo; causando...');
  await vaciarCola(db, 'datos-ejemplo-cli');

  // ---------------------------------------------------------------------------
  // FASE B — traza de IA (score) para las tres aprobables + aprobar el
  // original de la nota crédito + rechazar/archivar + rechazar/reintegrar V-23.
  // ---------------------------------------------------------------------------
  await withAdminContext(db, async (tx) => {
    for (const a of APROBABLES) {
      const sid = ids.aprobables[a.clave];
      if (!sid) continue;
      // Idempotente: no re-insertar la traza si ya existe una manual.
      const { rows } = await tx.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM extraction WHERE source_document_id = $1 AND origen = 'manual'`,
        [sid],
      );
      if (Number(rows[0]?.n ?? '0') > 0) continue;
      await tx.query(
        `INSERT INTO extraction
           (tenant_id, company_id, source_document_id, datos_extraidos,
            concepto_propuesto_id, score_confianza, origen)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6::numeric / 100, 'manual')`,
        [
          ctx.tenantId,
          ctx.companyId,
          sid,
          JSON.stringify({
            nota: 'Traza de propuesta de clasificación SIMULADA para npm run datos-ejemplo (no hubo modelo real).',
            fuente: 'datos-ejemplo',
          }),
          ctx.conceptoServGeneralesId,
          a.scoreCentesimas,
        ],
      );
    }
  });

  const notaId = await withSessionContext(db, sess, async (tx): Promise<string> => {
    // Nota crédito: su factura original tiene que quedar PUBLICADA antes de que
    // el worker pueda causar la reversa (`causarNotaCredito` exige
    // `source_document.estado = 'causado'` + asiento 'posted'). Idempotente: si
    // ya está causada (segunda corrida), no hay borrador y no se hace nada.
    const entryOriginal = await draftEntryId(tx, ids.original, 'causacion');
    if (entryOriginal) {
      await aprobarAsiento(tx, {
        journalEntryId: entryOriginal,
        decision: 'aprobado',
        userId: ctx.userId,
        ip: '127.0.0.1',
        userAgent: 'datos-ejemplo-cli',
        motivo: 'Aprobación de la factura original (escenario de nota crédito rechazada).',
      });
    }

    // Dos rechazadas que se archivan. Cada paso comprueba el estado antes de
    // actuar, así que correr el comando dos veces no rompe.
    for (const [indice, sourceDocumentId] of ids.archivar.entries()) {
      await rechazarSiEsBorrador(
        tx,
        sourceDocumentId,
        ctx,
        `Rechazo de ejemplo (${indice + 1}): la factura no corresponde a esta empresa.`,
      );
      if ((await estadoDe(tx, sourceDocumentId)) === 'rechazado') {
        await archivarDocumentoRechazado(
          tx,
          sourceDocumentId,
          'Archivada en la demostración: no se va a recausar.',
        );
      }
    }

    // V-23: rechazar, luego reintegrar. El worker la recausa con la clave
    // versionada en la fase C. Solo la PRIMERA vez: si ya dejó atrás un asiento
    // de causación anulado, el ciclo ya se corrió — no se repite (si no, cada
    // corrida del comando sumaría un `#n` más).
    const { rows: v23Anulados } = await tx.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM journal_entry
        WHERE source_document_id = $1 AND tipo <> 'reversa'
          AND idempotency_key LIKE 'causacion:%' AND estado = 'anulado'`,
      [ids.v23],
    );
    if (Number(v23Anulados[0]?.n ?? '0') === 0) {
      await rechazarSiEsBorrador(
        tx,
        ids.v23,
        ctx,
        'Rechazo por error (escenario V-23): en realidad sí había que causarla.',
      );
      if ((await estadoDe(tx, ids.v23)) === 'rechazado') {
        await reintegrarDocumentoRechazado(
          tx,
          ids.v23,
          'Reintegro de la demostración: el rechazo fue un error, se devuelve a la cola (V-23).',
        );
      }
    }

    // Ahora que la original está publicada, se ingesta la nota crédito.
    const r = await recibirDocumento(tx, {
      bytes: xmlNotaCreditoEscenario({
        id: NOTA_ID,
        cufe: cufeEscenario(NOTA_ID),
        fecha: FECHA_ESCENARIO,
        emisorNit: ctx.proveedorPruebaNit,
        emisorNombre: EMISOR_PRUEBA_NOMBRE,
        descripcionLinea: 'Devolución parcial de servicios de consultoría (dato de ejemplo)',
        baseCentavos: 40700000,
        facturaOriginalId: ORIGINAL_ID,
        facturaOriginalCufe: ORIGINAL_CUFE,
      }),
      nombreArchivo: `${NOTA_ID}.xml`,
      origen: 'carga_manual',
    });
    if (!r.ok) {
      throw new DatosEjemploError(`El escenario "${NOTA_ID}" quedó en cuarentena: ${r.detalle}`);
    }
    return r.sourceDocumentId;
  });

  // ---------------------------------------------------------------------------
  // FASE C — segunda pasada del worker: recausa la V-23 (clave `#2`) y causa la
  // reversa de la nota crédito. Después se rechaza la nota.
  // ---------------------------------------------------------------------------
  log('  segunda pasada de la cola (recausa V-23 + reversa de nota crédito)...');
  await vaciarCola(db, 'datos-ejemplo-cli');

  await withSessionContext(db, sess, async (tx) => {
    await rechazarSiEsBorrador(
      tx,
      notaId,
      ctx,
      'Nota crédito rechazada en la demostración (escenario V-28): recuperable desde la sub-bandeja.',
      'reversa',
    );
  });

  // ---------------------------------------------------------------------------
  // FASE D — resumen: dónde quedó cada documento.
  // ---------------------------------------------------------------------------
  await withAdminContext(db, async (tx) => {
    const registrar = async (
      nombre: string,
      id: string,
      sourceDocumentId: string | null,
      dondeSeVe: string,
      detalle: string,
    ) => {
      if (!sourceDocumentId) {
        escenarios.push({ nombre, numeroDocumento: id, sourceDocumentId: '(no creado)', estado: '(no creado)', dondeSeVe, detalle });
        return;
      }
      const { estado, idempotencyKey } = await estadoYClave(tx, sourceDocumentId);
      escenarios.push({
        nombre,
        numeroDocumento: id,
        sourceDocumentId,
        estado,
        dondeSeVe,
        detalle: idempotencyKey ? `${detalle} · asiento ${idempotencyKey}` : detalle,
      });
    };

    for (const a of APROBABLES) {
      await registrar(
        a.nombre,
        a.id,
        ids.aprobables[a.clave] ?? null,
        'Bandeja › Pendientes de aprobación',
        `confianza ${a.scoreCentesimas} · base $${montoUbl(a.base)}`,
      );
    }
    for (const [i, sid] of ids.revision.entries()) {
      await registrar(
        REVISION[i]!.nombre,
        REVISION[i]!.id,
        sid,
        'Bandeja › Pendientes de revisión',
        'motivo: el emisor no está registrado como tercero',
      );
    }
    for (const [i, sid] of ids.archivar.entries()) {
      await registrar(ARCHIVAR[i]!.nombre, ARCHIVAR[i]!.id, sid, 'fuera de las vistas (terminal)', 'rechazada y luego archivada');
    }
    await registrar(
      'Reintegro V-23 (rechazada → reintegrada → recausada)',
      V23_ID,
      ids.v23,
      'Bandeja › Pendientes de aprobación',
      'pasó por rechazo + reintegro; el asiento nuevo lleva la clave versionada',
    );
    await registrar(
      'Factura original de la nota crédito',
      ORIGINAL_ID,
      ids.original,
      'ledger (publicada)',
      'aprobada para que la nota crédito tuviera de dónde partir',
    );
    await registrar(
      'Nota crédito rechazada (V-28)',
      NOTA_ID,
      notaId,
      'Bandeja › Rechazadas',
      'reversa rechazada; recuperable (su asiento quedó anulado)',
    );
  });

  for (const e of escenarios) {
    log(`    - ${e.nombre}: ${e.estado} → ${e.dondeSeVe}`);
  }

  return { escenarios };
}

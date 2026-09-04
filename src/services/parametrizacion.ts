/**
 * A8 — Módulo de parametrización (sección 6 del mega-prompt): la interfaz
 * por la que un contador —no un programador— edita tarifas, bases, cuentas y
 * vigencias sin desplegar código.
 *
 * ESTE ARCHIVO NO CALCULA NINGUNA RETENCIÓN (Regla de Oro 4) y NO CONTIENE
 * NINGÚN VALOR TRIBUTARIO (Regla de Oro 2): ni una tarifa, ni una UVT, ni una
 * base. Solo mueve los valores que el CONTADOR escribe hacia las tablas
 * paramétricas que A1 pobló y que A3 (`src/domain/repositorio.ts`) lee para
 * resolver. Cualquier literal numérico que aparezca aquí (0, 1 día, etc.) es
 * aritmética de fechas o de conteo, no un dato normativo.
 *
 * LAS SEIS CONDUCTAS OBLIGATORIAS DE LA SECCIÓN 6.2 Y QUIÉN LAS IMPONE:
 *
 *  1. Nunca UPDATE de un valor ya vigente — lo impone el trigger `PR001`
 *     (`app.trg_vigencia_append_only`, migración 001/006). Este servicio
 *     nunca actualiza más que `vigente_hasta`, y solo para CERRAR.
 *  2. Fecha de vigencia obligatoria — la exige este servicio antes de tocar
 *     la base (`requerirFechaIso`) Y la propia columna `NOT NULL`.
 *  3. Nunca retroactivo sobre lo publicado — lo calcula la base con
 *     `app.fecha_minima_vigencia_*` (migración 080, sobre `retention_applied`
 *     + `journal_entry.estado = 'posted'`) y este servicio lo hace cumplir
 *     ANTES de escribir, con `EdicionRetroactivaError`.
 *  4. Auditoría con norma de respaldo — la escribe sola la base:
 *     `app.trg_audit` (migración 009) ya está instalado sobre `tax_rule`,
 *     `tax_concept`, `uvt_value`, `smmlv_value`, `rounding_rule` y
 *     `municipality_ica_rule`, y copia `norma_respaldo` de la fila al
 *     `audit_log`. Este servicio solo se asegura de que el contador no pueda
 *     guardar sin escribirla (`requerirNorma`).
 *  5. Permiso restringido a `parametro.editar` — lo impone el trigger
 *     `tax_rule_permiso` / `uvt_value_permiso` / ... (migración 016,
 *     `app.instalar_permiso_escritura`). Este servicio NO reimplementa esa
 *     comprobación: si la sesión no tiene el permiso, el INSERT/UPDATE falla
 *     con SQLSTATE `SE002` y este servicio deja that error de Postgres subir
 *     sin envolverlo en un "if" de aplicación (D-025).
 *  6. Simulador previo de impacto — `simularImpactoTarifa` / ..., que llaman
 *     a `app.simular_impacto_*` (migración 080).
 *
 * ALCANCE FIRMA-VS-EMPRESA (verificado contra el diseño RLS de A2, sección
 * 012_rls.sql / D-015): un parámetro "editado" por un administrador de firma
 * NO muta la fila global (la RLS se lo impide: `WITH CHECK` exige
 * `tenant_id = current_tenant_id()`, y una fila global tiene `tenant_id
 * NULL`). Lo que hace este servicio es crear una fila NUEVA con el
 * `tenant_id` de la firma y `company_id NULL` (compartida entre todas sus
 * empresas) o con el `company_id` de una empresa concreta. La política RLS
 * híbrida (`instalar_rls_hibrida`) YA deja escribir `company_id NULL` desde
 * cualquier sesión de la firma, tenga o no una empresa seleccionada — no hace
 * falta ningún cambio de A2 para esto, ver `tests/services/parametrizacion.test.ts`,
 * caso "administrador de firma edita un parámetro compartido".
 */
import type { SqlClient } from '../db/types';
import { PERMISOS, tienePermiso } from '../auth/permisos';

// =============================================================================
// ERRORES DE DOMINIO (no SQLSTATE: son validaciones tempranas para no gastar
// un viaje a la base con un dato que ya se sabe inválido. La garantía real
// sigue siendo de la base — ver el bloque de comentarios de arriba).
// =============================================================================

export class NormaDeRespaldoRequeridaError extends Error {
  constructor() {
    super(
      'La norma de respaldo es obligatoria: escriba el decreto, ley o acuerdo que sustenta ' +
        'este valor (sección 6.2, punto 4). Ej.: "Decreto 572 de 2025, art. 3".',
    );
    this.name = 'NormaDeRespaldoRequeridaError';
  }
}

export class VigenciaInvalidaError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'VigenciaInvalidaError';
  }
}

export class ParametroNoEncontradoError extends Error {
  constructor(tabla: string, id: string) {
    super(`No existe (o no es visible para esta sesión) la fila ${id} de ${tabla}.`);
    this.name = 'ParametroNoEncontradoError';
  }
}

/**
 * Sección 6.2, punto 3: la interfaz no ofrece una vigencia que el motor
 * tendría que rechazar. `fechaMinima` es el último hecho económico YA
 * PUBLICADO con el valor anterior; la vigencia nueva debe ser posterior.
 */
export class EdicionRetroactivaError extends Error {
  readonly fechaMinima: string;
  constructor(fechaMinima: string) {
    super(
      `No se puede fijar la vigencia nueva en o antes del ${fechaMinima}: ya hay asientos ` +
        'PUBLICADOS que usaron el valor anterior en esa fecha. Elija una fecha posterior, o corrija ' +
        'lo publicado con una reversa explícita (sección 6.2, punto 3).',
    );
    this.name = 'EdicionRetroactivaError';
    this.fechaMinima = fechaMinima;
  }
}

/**
 * V-39 (compuerta ampliada de D-087, A14). La sección 6.2, punto 6 exige que el
 * simulador de impacto corra ANTES de guardar. D-087 lo montó como dos pantallas
 * —`simular*Action` → `confirmar*Action`—, pero el paso 2 no comprobaba nada: un
 * POST directo a la acción de confirmación (la carga masiva, un script, un
 * enlace guardado) abría una vigencia nueva sin que nadie hubiera visto el
 * impacto. El resguardo bloqueante era, en la práctica, decorativo.
 *
 * El paso 2 exige ahora el TESTIGO del paso 1: los conteos que el simulador
 * mostró. Y no basta con que vengan: tienen que seguir siendo el impacto REAL en
 * el momento de guardar. Así el testigo cubre a la vez el POST directo (no hay
 * testigo) y la pantalla rancia (el testigo ya no coincide porque entretanto
 * entraron conceptos o proveedores nuevos).
 *
 * Esto NO es el candado de seguridad —ese lo pone el motor con `parametro.editar`
 * (SE002) y la vigencia append-only—: es la garantía de PROCESO de la sección 6.2.
 */
export class ImpactoNoSimuladoError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ImpactoNoSimuladoError';
  }
}

/** Testigo tal y como viaja en el formulario del paso 2 (cadenas de `FormData`). */
export interface TestigoImpacto {
  conceptos: string;
  proveedores: string;
}

export function exigirTestigoImpacto(testigo: TestigoImpacto, impacto: ImpactoSimulado): void {
  const conceptos = Number(testigo.conceptos);
  const proveedores = Number(testigo.proveedores);
  if (
    testigo.conceptos.trim() === '' ||
    testigo.proveedores.trim() === '' ||
    !Number.isInteger(conceptos) ||
    !Number.isInteger(proveedores)
  ) {
    throw new ImpactoNoSimuladoError(
      'No se puede guardar esta vigencia: el impacto del cambio no se ha simulado. ' +
        'Vuelva al paso «Simular impacto» y revise a cuántos conceptos y proveedores afecta ' +
        'antes de confirmar (sección 6.2, punto 6).',
    );
  }
  if (conceptos !== impacto.conceptosAfectados || proveedores !== impacto.proveedoresAfectados) {
    throw new ImpactoNoSimuladoError(
      `El impacto cambió desde que usted lo revisó: ahora son ${impacto.conceptosAfectados} ` +
        `concepto(s) y ${impacto.proveedoresAfectados} proveedor(es), no ${testigo.conceptos} y ` +
        `${testigo.proveedores}. Vuelva a simular y confirme sobre las cifras vigentes.`,
    );
  }
}

// =============================================================================
// UTILIDADES DE FECHA (aritmética de calendario, no un valor tributario)
// =============================================================================

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function requerirFechaIso(fecha: string): void {
  if (!ISO_DATE.test(fecha)) {
    throw new VigenciaInvalidaError(
      `La fecha de vigencia debe tener formato AAAA-MM-DD; se recibió "${fecha}".`,
    );
  }
}

function requerirNorma(norma: string | null | undefined): string {
  const limpio = (norma ?? '').trim();
  if (!limpio) throw new NormaDeRespaldoRequeridaError();
  return limpio;
}

/** Día calendario anterior a una fecha ISO, en UTC puro (sin huso horario). */
export function diaAnterior(fechaIso: string): string {
  requerirFechaIso(fechaIso);
  const [anio, mes, dia] = fechaIso.split('-').map(Number) as [number, number, number];
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  fecha.setUTCDate(fecha.getUTCDate() - 1);
  return fecha.toISOString().slice(0, 10);
}

/** Hoy en fecha ISO (UTC). Solo se usa como FECHA PROPUESTA por defecto: la
 * sección 6.2.2 exige que el usuario la confirme, nunca que se aplique sola. */
export function hoyIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// =============================================================================
// CONTEXTO DE SESIÓN (tenant/empresa actuales, derivados por la base — D-021)
// =============================================================================

interface ContextoSesion {
  tenantId: string;
  companyIdSesion: string | null;
}

async function contextoSesion(tx: SqlClient): Promise<ContextoSesion> {
  const { rows } = await tx.query<{ tenant_id: string | null; company_id: string | null }>(
    'SELECT app.current_tenant_id() AS tenant_id, app.current_company_id() AS company_id',
  );
  const tenantId = rows[0]?.tenant_id ?? null;
  if (!tenantId) {
    throw new Error(
      'No hay tenant en la sesión: la parametrización solo se edita dentro de una sesión válida.',
    );
  }
  return { tenantId, companyIdSesion: rows[0]?.company_id ?? null };
}

interface FilaConAlcance {
  tenant_id: string | null;
  company_id: string | null;
}

interface ContextoEdicion extends ContextoSesion {
  /** true cuando la fila que se edita ya es propia de esta firma (tenant_id
   *  coincide); false cuando es la fila GLOBAL/nacional y lo que se crea es
   *  el PRIMER override de la firma sobre ella (D-015: nunca se muta lo
   *  global, la RLS tampoco lo permitiría). */
  esPropia: boolean;
}

async function resolverContextoEdicion(
  tx: SqlClient,
  filaAnterior: FilaConAlcance,
): Promise<ContextoEdicion> {
  const sesion = await contextoSesion(tx);
  return { ...sesion, esPropia: filaAnterior.tenant_id === sesion.tenantId };
}

/** A qué `company_id` queda la fila NUEVA. Si la fila anterior ya es propia,
 * hereda su mismo alcance (empresa concreta o compartida entre todas). Si es
 * la primera vez que la firma se aparta del valor nacional, el alcance lo
 * elige el contador con `alcanceNuevo` ('firma' por defecto: compartida). */
function companyDestino(
  ctx: ContextoEdicion,
  filaAnterior: FilaConAlcance,
  alcanceNuevo: 'firma' | 'empresa' | undefined,
): string | null {
  if (ctx.esPropia) return filaAnterior.company_id;
  if (alcanceNuevo === 'empresa') {
    if (!ctx.companyIdSesion) {
      throw new VigenciaInvalidaError(
        'Para crear un override de una sola empresa hace falta tener una empresa seleccionada en la sesión.',
      );
    }
    return ctx.companyIdSesion;
  }
  return null; // compartida entre todas las empresas de la firma (D-015).
}

// =============================================================================
// ALERTAS DE DATO FALTANTE (advertencia 17.5: lo que falta se ve, no se calla)
// =============================================================================

export interface AlertaParametro {
  categoria: string;
  severidad: 'alta' | 'media';
  mensaje: string;
}

/**
 * Recorre los catálogos GLOBALES (visibles a cualquier sesión por la RLS
 * híbrida, D-015) buscando exactamente los huecos que A1 dejó a propósito en
 * la Ola 1 (ver ESTADO_PROYECTO.md, "Pendiente de verificación normativa
 * humana"), más cualquier fila que cualquier agente haya marcado
 * `requiere_verificacion_humana`. No inventa valores para taparlos: los
 * enumera para que la interfaz los muestre.
 */
export async function detectarAlertasParametrizacion(tx: SqlClient): Promise<AlertaParametro[]> {
  const alertas: AlertaParametro[] = [];

  const { rows: salarios } = await tx.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM tax_rule WHERE tipo = 'retefuente_salarios'`,
  );
  if (Number(salarios[0]?.n ?? '0') === 0) {
    alertas.push({
      categoria: 'retefuente_salarios',
      severidad: 'alta',
      mensaje:
        'La tabla progresiva de retención por salarios (art. 383 ET) no tiene ningún tramo ' +
        'cargado. El motor no puede calcular retención de salarios hasta que un administrador ' +
        'tributario la cargue con su norma de respaldo.',
    });
  }

  const { rows: smmlv } = await tx.query<{ n: string }>('SELECT count(*)::text AS n FROM smmlv_value');
  if (Number(smmlv[0]?.n ?? '0') === 0) {
    alertas.push({
      categoria: 'smmlv_value',
      severidad: 'media',
      mensaje: 'El salario mínimo (SMMLV) y el auxilio de transporte no tienen ningún año cargado.',
    });
  }

  const { rows: calendario } = await tx.query<{ n: string }>('SELECT count(*)::text AS n FROM tax_calendar');
  if (Number(calendario[0]?.n ?? '0') === 0) {
    alertas.push({
      categoria: 'tax_calendar',
      severidad: 'media',
      mensaje: 'El calendario tributario no tiene ningún vencimiento cargado.',
    });
  }

  const { rows: municipiosSinIca } = await tx.query<{ nombre: string; departamento: string }>(
    `SELECT m.nombre, m.departamento
       FROM municipality m
      WHERE m.tenant_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM municipality_ica_rule r WHERE r.municipality_id = m.id)
      ORDER BY m.nombre`,
  );
  for (const m of municipiosSinIca) {
    alertas.push({
      categoria: 'municipality_ica_rule',
      severidad: 'alta',
      mensaje:
        `${m.nombre} (${m.departamento}) no tiene bases mínimas ni tarifa general de ReteICA ` +
        'cargadas. No hay valor que copiar: pendiente de verificación normativa humana.',
    });
  }

  const { rows: sinTarifaActividad } = await tx.query<{ nombre: string }>(
    `SELECT m.nombre
       FROM municipality m
       JOIN municipality_ica_rule r ON r.municipality_id = m.id AND r.usa_tarifa_de_actividad = true
      WHERE m.tenant_id IS NULL
        AND app.esta_vigente(r.vigente_desde, r.vigente_hasta, CURRENT_DATE)
        AND NOT EXISTS (SELECT 1 FROM tax_rule tr WHERE tr.tipo = 'reteica' AND tr.municipality_id = m.id)
      ORDER BY m.nombre`,
  );
  for (const m of sinTarifaActividad) {
    alertas.push({
      categoria: 'tax_rule_reteica',
      severidad: 'alta',
      mensaje:
        `${m.nombre} resuelve ReteICA por la tarifa de la actividad económica del proveedor, pero ` +
        'no hay ninguna tarifa por actividad cargada para este municipio: no se puede calcular ICA ' +
        'ahí hasta cargarla.',
    });
  }

  const { rows: verifHumana } = await tx.query<{ tabla: string; n: string }>(
    `SELECT 'tax_rule' AS tabla, count(*)::text AS n FROM tax_rule WHERE requiere_verificacion_humana
     UNION ALL
     SELECT 'municipality_ica_rule', count(*)::text FROM municipality_ica_rule WHERE requiere_verificacion_humana
     UNION ALL
     SELECT 'smmlv_value', count(*)::text FROM smmlv_value WHERE requiere_verificacion_humana
     UNION ALL
     SELECT 'uvt_value', count(*)::text FROM uvt_value WHERE requiere_verificacion_humana`,
  );
  for (const fila of verifHumana) {
    const n = Number(fila.n);
    if (n > 0) {
      alertas.push({
        categoria: `${fila.tabla}.requiere_verificacion_humana`,
        severidad: 'media',
        mensaje:
          `${n} fila(s) de "${fila.tabla}" están marcadas como valores de referencia pendientes de ` +
          'verificar contra la fuente oficial antes de producción (no la tabla completa).',
      });
    }
  }

  return alertas;
}

// =============================================================================
// RETENCIÓN EN LA FUENTE / AUTORRETENCIÓN / RETEIVA / RETEICA / IVA / SALARIOS
// (todas comparten la tabla `tax_rule`: una sola implementación cubre las
// seis familias de la sección 6.3).
// =============================================================================

export type TipoTaxRule =
  | 'retefuente'
  | 'retefuente_salarios'
  | 'autorretencion'
  | 'reteiva'
  | 'reteica'
  | 'iva';

export interface FilaTarifa {
  reglaId: string;
  taxConceptId: string;
  tipo: string;
  codigo: string;
  nombre: string;
  tarifa: string;
  /** D-088: solo tiene sentido para `tipo='reteica'` con actividad. NULL = no
   *  declarado (estado de toda fila anterior a D-088); false = actividad NO
   *  gravada, el motor no retiene sin importar la tarifa. */
  gravada: boolean | null;
  baseMinimaUvt: string | null;
  baseMinimaValor: string | null;
  comparadorBaseMinima: string;
  aplicaSobre: string;
  aplicaA: string;
  tipoPersona: string;
  accountId: string | null;
  municipalityId: string | null;
  municipalityNombre: string | null;
  ciiuActivityId: string | null;
  ciiuCodigo: string | null;
  ciiuNombre: string | null;
  rangoDesdeUvt: string | null;
  rangoHastaUvt: string | null;
  vigenteDesde: string;
  vigenteHasta: string | null;
  normaRespaldo: string;
  notas: string | null;
  requiereVerificacionHumana: boolean;
  alcance: 'empresa' | 'firma' | 'global';
  /** true si esta fila es la que efectivamente gana por prioridad de alcance
   *  (empresa > firma > global) entre las que están vigentes a la fecha
   *  consultada. Una fila con `esEfectiva = false` sigue vigente pero está
   *  "tapada" por un override más específico: se muestra para transparencia. */
  esEfectiva: boolean;
}

interface FilaTarifaCruda {
  regla_id: string;
  tax_concept_id: string;
  tipo: string;
  codigo: string;
  nombre: string;
  tarifa: string;
  gravada: boolean | null;
  base_minima_uvt: string | null;
  base_minima_valor: string | null;
  comparador_base_minima: string;
  aplica_sobre: string;
  aplica_a: string;
  tipo_persona: string;
  account_id: string | null;
  municipality_id: string | null;
  municipality_nombre: string | null;
  ciiu_activity_id: string | null;
  ciiu_codigo: string | null;
  ciiu_nombre: string | null;
  rango_desde_uvt: string | null;
  rango_hasta_uvt: string | null;
  vigente_desde: string;
  vigente_hasta: string | null;
  norma_respaldo: string;
  notas: string | null;
  requiere_verificacion_humana: boolean;
  alcance: 'empresa' | 'firma' | 'global';
  es_efectiva: boolean;
}

function filaTarifaDe(f: FilaTarifaCruda): FilaTarifa {
  return {
    reglaId: f.regla_id,
    taxConceptId: f.tax_concept_id,
    tipo: f.tipo,
    codigo: f.codigo,
    nombre: f.nombre,
    tarifa: f.tarifa,
    gravada: f.gravada,
    baseMinimaUvt: f.base_minima_uvt,
    baseMinimaValor: f.base_minima_valor,
    comparadorBaseMinima: f.comparador_base_minima,
    aplicaSobre: f.aplica_sobre,
    aplicaA: f.aplica_a,
    tipoPersona: f.tipo_persona,
    accountId: f.account_id,
    municipalityId: f.municipality_id,
    municipalityNombre: f.municipality_nombre,
    ciiuActivityId: f.ciiu_activity_id,
    ciiuCodigo: f.ciiu_codigo,
    ciiuNombre: f.ciiu_nombre,
    rangoDesdeUvt: f.rango_desde_uvt,
    rangoHastaUvt: f.rango_hasta_uvt,
    vigenteDesde: f.vigente_desde,
    vigenteHasta: f.vigente_hasta,
    normaRespaldo: f.norma_respaldo,
    notas: f.notas,
    requiereVerificacionHumana: f.requiere_verificacion_humana,
    alcance: f.alcance,
    esEfectiva: f.es_efectiva,
  };
}

/**
 * Lista, para un tipo de `tax_rule`, todas las vigencias ACTIVAS a `fecha`
 * (hoy por defecto), visibles para la sesión (global + propias, RLS híbrida).
 * Incluye la cadena completa empresa/firma/global cuando existe más de una,
 * marcando cuál gana (`esEfectiva`), para que el contador vea con qué
 * tarifa se está calculando realmente y cuál sería la nacional si no
 * existiera su override.
 */
export async function listarTarifasPorTipo(
  tx: SqlClient,
  tipo: TipoTaxRule,
  fecha: string = hoyIso(),
): Promise<FilaTarifa[]> {
  requerirFechaIso(fecha);
  const { rows } = await tx.query<FilaTarifaCruda>(
    `SELECT
        tr.id AS regla_id, tr.tax_concept_id, tr.tipo, tc.codigo, tc.nombre,
        tr.tarifa::text AS tarifa, tr.gravada, tr.base_minima_uvt::text, tr.base_minima_valor::text,
        tr.comparador_base_minima, tr.aplica_sobre, tr.aplica_a, tr.tipo_persona,
        tr.account_id, tr.municipality_id, m.nombre AS municipality_nombre,
        tr.ciiu_activity_id, ci.codigo AS ciiu_codigo, ci.nombre AS ciiu_nombre,
        tr.rango_desde_uvt::text, tr.rango_hasta_uvt::text,
        tr.vigente_desde::text, tr.vigente_hasta::text, tr.norma_respaldo, tr.notas,
        tr.requiere_verificacion_humana,
        CASE WHEN tr.company_id IS NOT NULL THEN 'empresa'
             WHEN tr.tenant_id  IS NOT NULL THEN 'firma'
             ELSE 'global' END AS alcance,
        (row_number() OVER (
           PARTITION BY tr.tax_concept_id, tr.aplica_a, tr.tipo_persona,
                        coalesce(tr.municipality_id::text, '-'),
                        coalesce(tr.ciiu_activity_id::text, '-'),
                        coalesce(tr.rango_desde_uvt::text, '-')
           ORDER BY (tr.company_id IS NOT NULL) DESC, (tr.tenant_id IS NOT NULL) DESC, tr.vigente_desde DESC
         ) = 1) AS es_efectiva
      FROM tax_rule tr
      JOIN tax_concept tc ON tc.id = tr.tax_concept_id
      LEFT JOIN municipality m ON m.id = tr.municipality_id
      LEFT JOIN ciiu_activity ci ON ci.id = tr.ciiu_activity_id
     WHERE tr.tipo = $1 AND app.esta_vigente(tr.vigente_desde, tr.vigente_hasta, $2::date)
     ORDER BY tc.codigo, alcance, tr.vigente_desde DESC`,
    [tipo, fecha],
  );
  return rows.map(filaTarifaDe);
}

/** Conceptos del tipo dado que HOY no tienen ninguna vigencia activa: la
 * alerta de dato faltante a nivel de concepto individual (nunca se rellena
 * con un valor por omisión — D-014 / advertencia 17.5). */
export async function listarConceptosSinTarifaVigente(
  tx: SqlClient,
  tipo: TipoTaxRule,
  fecha: string = hoyIso(),
): Promise<Array<{ taxConceptId: string; codigo: string; nombre: string }>> {
  requerirFechaIso(fecha);
  const { rows } = await tx.query<{ id: string; codigo: string; nombre: string }>(
    `SELECT tc.id, tc.codigo, tc.nombre
       FROM tax_concept tc
      WHERE tc.tipo = $1
        AND NOT EXISTS (
          SELECT 1 FROM tax_rule tr
           WHERE tr.tax_concept_id = tc.id
             AND app.esta_vigente(tr.vigente_desde, tr.vigente_hasta, $2::date)
        )
      ORDER BY tc.codigo`,
    [tipo, fecha],
  );
  return rows.map((r) => ({ taxConceptId: r.id, codigo: r.codigo, nombre: r.nombre }));
}

/** Historial COMPLETO (todas las vigencias, cerradas y abierta) de una regla
 * concreta: la prueba visual de "nunca UPDATE" — cada edición es una fila
 * nueva, ninguna desaparece. */
export async function listarHistorialTaxRule(
  tx: SqlClient,
  reglaId: string,
): Promise<FilaTarifa[]> {
  const { rows: base } = await tx.query<{
    tax_concept_id: string;
    aplica_a: string;
    tipo_persona: string;
    municipality_id: string | null;
    ciiu_activity_id: string | null;
    rango_desde_uvt: string | null;
  }>(
    `SELECT tax_concept_id, aplica_a, tipo_persona, municipality_id, ciiu_activity_id, rango_desde_uvt::text
       FROM tax_rule WHERE id = $1`,
    [reglaId],
  );
  const clave = base[0];
  if (!clave) throw new ParametroNoEncontradoError('tax_rule', reglaId);

  const { rows } = await tx.query<FilaTarifaCruda>(
    `SELECT
        tr.id AS regla_id, tr.tax_concept_id, tr.tipo, tc.codigo, tc.nombre,
        tr.tarifa::text AS tarifa, tr.gravada, tr.base_minima_uvt::text, tr.base_minima_valor::text,
        tr.comparador_base_minima, tr.aplica_sobre, tr.aplica_a, tr.tipo_persona,
        tr.account_id, tr.municipality_id, m.nombre AS municipality_nombre,
        tr.ciiu_activity_id, ci.codigo AS ciiu_codigo, ci.nombre AS ciiu_nombre,
        tr.rango_desde_uvt::text, tr.rango_hasta_uvt::text,
        tr.vigente_desde::text, tr.vigente_hasta::text, tr.norma_respaldo, tr.notas,
        tr.requiere_verificacion_humana,
        CASE WHEN tr.company_id IS NOT NULL THEN 'empresa'
             WHEN tr.tenant_id  IS NOT NULL THEN 'firma'
             ELSE 'global' END AS alcance,
        (tr.vigente_hasta IS NULL) AS es_efectiva
      FROM tax_rule tr
      JOIN tax_concept tc ON tc.id = tr.tax_concept_id
      LEFT JOIN municipality m ON m.id = tr.municipality_id
      LEFT JOIN ciiu_activity ci ON ci.id = tr.ciiu_activity_id
     WHERE tr.tax_concept_id = $1 AND tr.aplica_a = $2 AND tr.tipo_persona = $3
       AND tr.municipality_id IS NOT DISTINCT FROM $4
       AND tr.ciiu_activity_id IS NOT DISTINCT FROM $5
       AND tr.rango_desde_uvt IS NOT DISTINCT FROM $6
     ORDER BY tr.vigente_desde DESC`,
    [clave.tax_concept_id, clave.aplica_a, clave.tipo_persona, clave.municipality_id,
      clave.ciiu_activity_id, clave.rango_desde_uvt],
  );
  return rows.map(filaTarifaDe);
}

export interface ImpactoSimulado {
  conceptosAfectados: number;
  proveedoresAfectados: number;
}

/** Sección 6.2, punto 6: "esta tarifa afecta N conceptos y M proveedores",
 * agregado a nivel de TODA la firma (ver comentario de cabecera). */
export async function simularImpactoTarifa(
  tx: SqlClient,
  taxConceptId: string,
): Promise<ImpactoSimulado> {
  const { rows } = await tx.query<{ conceptos_afectados: string; proveedores_afectados: string }>(
    'SELECT * FROM app.simular_impacto_tax_concept($1)',
    [taxConceptId],
  );
  const fila = rows[0];
  return {
    conceptosAfectados: Number(fila?.conceptos_afectados ?? 0),
    proveedoresAfectados: Number(fila?.proveedores_afectados ?? 0),
  };
}

/**
 * Concepto tributario al que pertenece una regla, resuelto EN LA BASE a partir
 * del id de la regla que se está editando.
 *
 * V-41 (A14, compuerta ampliada de D-087): el paso 2 no puede fiarse del
 * `taxConceptId` que venga del query string o del formulario. Si se acepta el de
 * fuera, el detalle del impacto que ve el contador puede describir una regla
 * distinta de la que va a guardar. Se resuelve por la regla, siempre.
 */
export async function taxConceptIdDeTaxRule(tx: SqlClient, reglaId: string): Promise<string | null> {
  const { rows } = await tx.query<{ tax_concept_id: string }>(
    'SELECT tax_concept_id FROM tax_rule WHERE id = $1',
    [reglaId],
  );
  return rows[0]?.tax_concept_id ?? null;
}

/** Último hecho económico ya PUBLICADO con esta `tax_rule` exacta, o `null`
 * si nunca se ha publicado nada con ella. Sección 6.2, punto 3. */
export async function fechaMinimaVigenciaTaxRule(
  tx: SqlClient,
  reglaId: string,
): Promise<string | null> {
  const { rows } = await tx.query<{ fecha_minima_vigencia_tax_rule: string | null }>(
    'SELECT app.fecha_minima_vigencia_tax_rule($1)::text AS fecha_minima_vigencia_tax_rule',
    [reglaId],
  );
  return rows[0]?.fecha_minima_vigencia_tax_rule ?? null;
}

interface FilaTaxRuleAnterior extends FilaConAlcance {
  id: string;
  tax_concept_id: string;
  tipo: string;
  aplica_a: string;
  tipo_persona: string;
  municipality_id: string | null;
  ciiu_activity_id: string | null;
  rango_desde_uvt: string | null;
  rango_hasta_uvt: string | null;
  uvt_adicionales: string | null;
  account_id: string | null;
  aplica_sobre: string;
  comparador_base_minima: string;
  gravada: boolean | null;
  vigente_desde: string;
}

export interface EditarTarifaInput {
  /** La regla EFECTIVA que se está reemplazando: la que devuelve
   *  `listarTarifasPorTipo` con `esEfectiva = true` para ese concepto. */
  reglaAnteriorId: string;
  /** Fecha de vigencia PROPUESTA por el sistema y CONFIRMADA por el usuario
   *  (sección 6.2, punto 2). Nunca se aplica sin este campo. */
  vigenteDesde: string;
  /** Norma de respaldo que escribe el contador (sección 6.2, punto 4).
   *  Obligatoria: sin ella no se guarda nada. */
  normaRespaldo: string;
  tarifa: string;
  baseMinimaUvt?: string | null;
  baseMinimaValor?: string | null;
  aplicaSobre?: string;
  comparadorBaseMinima?: string;
  /** D-088. Solo para `tipo='reteica'` con actividad. `false` = actividad NO
   *  gravada en el municipio: el motor no retiene. El CHECK de la base
   *  (`tax_rule_gravada_ck`) obliga a `tarifa = 0` cuando es `false`; la capa
   *  de servicio lo fuerza aquí para dar un mensaje claro antes del viaje. */
  gravada?: boolean | null;
  accountId?: string | null;
  notas?: string | null;
  requiereVerificacionHumana?: boolean;
  /** Solo relevante la primera vez que la firma se aparta de una tarifa
   *  nacional: 'firma' (compartida entre todas sus empresas, por defecto) o
   *  'empresa' (solo la empresa en sesión). */
  alcanceNuevo?: 'firma' | 'empresa';
}

export interface ResultadoEdicion {
  reglaNuevaId: string;
  /** false cuando lo que se creó fue el primer override de la firma sobre
   *  una tarifa nacional: no había nada propio que cerrar. */
  reglaAnteriorCerrada: boolean;
}

/**
 * Edita una tarifa de retefuente / autorretención / ReteIVA / ReteICA / IVA /
 * tabla progresiva de salarios. Cierra la vigencia anterior (si es propia de
 * la firma) e inserta una fila nueva — NUNCA hace `UPDATE` de un valor.
 *
 * @throws {NormaDeRespaldoRequeridaError} sin norma de respaldo.
 * @throws {VigenciaInvalidaError} fecha inválida o anterior a la vigencia que reemplaza.
 * @throws {EdicionRetroactivaError} la fecha propuesta ya tiene asientos publicados.
 * @throws {ParametroNoEncontradoError} la regla anterior no existe o no es visible.
 */
export async function editarTarifaTaxRule(
  tx: SqlClient,
  input: EditarTarifaInput,
): Promise<ResultadoEdicion> {
  const normaRespaldo = requerirNorma(input.normaRespaldo);
  requerirFechaIso(input.vigenteDesde);
  if (input.baseMinimaUvt != null && input.baseMinimaValor != null) {
    throw new VigenciaInvalidaError(
      'La base mínima se expresa en UVT o en pesos, nunca en las dos a la vez.',
    );
  }
  const { rows } = await tx.query<FilaTaxRuleAnterior>(
    `SELECT id, tenant_id, company_id, tax_concept_id, tipo, aplica_a, tipo_persona,
            municipality_id, ciiu_activity_id, rango_desde_uvt::text, rango_hasta_uvt::text,
            uvt_adicionales::text, account_id, aplica_sobre, comparador_base_minima, gravada,
            vigente_desde::text
       FROM tax_rule WHERE id = $1`,
    [input.reglaAnteriorId],
  );
  const anterior = rows[0];
  if (!anterior) throw new ParametroNoEncontradoError('tax_rule', input.reglaAnteriorId);

  // D-088: guard de consistencia gravada/tarifa, el mismo que impone el CHECK
  // `tax_rule_gravada_ck`. Se comprueba contra el flag EFECTIVO de la vigencia
  // que se va a abrir, no contra el que venga en la entrada (V-43, A14): si la
  // llamada no trae `gravada`, la fila nueva HEREDA el de la regla anterior, y
  // heredar `false` con una tarifa positiva es exactamente la misma
  // combinación prohibida. Antes solo se miraba `input.gravada`, así que ese
  // camino se colaba hasta la base y el contador recibía un error crudo de
  // PostgreSQL en vez del motivo. El CHECK sigue siendo la garantía real.
  // Misma expresión, literalmente, que la que va al INSERT más abajo: si el
  // guard y la escritura no calcularan el flag igual, el guard no valdría nada.
  const gravadaEfectiva = input.gravada ?? anterior.gravada;
  if (gravadaEfectiva === false && input.tarifa != null && Number(input.tarifa) !== 0) {
    throw new VigenciaInvalidaError(
      'Una actividad marcada como NO gravada de ICA no puede llevar tarifa distinta de cero: ' +
        'ponga la tarifa en 0 o marque la actividad como gravada.',
    );
  }

  const ctx = await resolverContextoEdicion(tx, anterior);

  const fechaMinima = await fechaMinimaVigenciaTaxRule(tx, anterior.id);
  if (fechaMinima && input.vigenteDesde <= fechaMinima) {
    throw new EdicionRetroactivaError(fechaMinima);
  }
  if (ctx.esPropia && input.vigenteDesde <= anterior.vigente_desde) {
    throw new VigenciaInvalidaError(
      `La vigencia nueva (${input.vigenteDesde}) debe ser posterior a la que reemplaza ` +
        `(${anterior.vigente_desde}).`,
    );
  }

  if (ctx.esPropia) {
    await tx.query('UPDATE tax_rule SET vigente_hasta = $2 WHERE id = $1', [
      anterior.id,
      diaAnterior(input.vigenteDesde),
    ]);
  }

  const companyIdNuevo = companyDestino(ctx, anterior, input.alcanceNuevo);

  const { rows: nueva } = await tx.query<{ id: string }>(
    `INSERT INTO tax_rule (
       tenant_id, company_id, tax_concept_id, tipo, tarifa, base_minima_uvt, base_minima_valor,
       comparador_base_minima, aplica_sobre, aplica_a, tipo_persona,
       municipality_id, ciiu_activity_id, rango_desde_uvt, rango_hasta_uvt, uvt_adicionales,
       account_id, vigente_desde, vigente_hasta, norma_respaldo, notas, requiere_verificacion_humana,
       gravada, created_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NULL,$19,$20,$21,$22,
       app.current_user_id()
     )
     RETURNING id`,
    [
      ctx.tenantId,
      companyIdNuevo,
      anterior.tax_concept_id,
      anterior.tipo,
      input.tarifa,
      input.baseMinimaUvt ?? null,
      input.baseMinimaValor ?? null,
      input.comparadorBaseMinima ?? anterior.comparador_base_minima,
      input.aplicaSobre ?? anterior.aplica_sobre,
      anterior.aplica_a,
      anterior.tipo_persona,
      anterior.municipality_id,
      anterior.ciiu_activity_id,
      anterior.rango_desde_uvt,
      anterior.rango_hasta_uvt,
      anterior.uvt_adicionales,
      input.accountId ?? anterior.account_id,
      input.vigenteDesde,
      normaRespaldo,
      input.notas ?? null,
      input.requiereVerificacionHumana ?? false,
      gravadaEfectiva,
    ],
  );

  return { reglaNuevaId: nueva[0]!.id, reglaAnteriorCerrada: ctx.esPropia };
}

// =============================================================================
// VALORES BASE — UVT y SMMLV (mismo mecanismo de vigencias, sin discriminadores)
// =============================================================================

interface FilaValorBaseAnterior extends FilaConAlcance {
  id: string;
  vigente_desde: string;
}

export interface EditarUvtInput {
  reglaAnteriorId: string;
  anio: number;
  /** Centavos de COP (D-005). UVT 2027 = $54.100 → "5410000". */
  valorCentavos: string;
  vigenteDesde: string;
  normaRespaldo: string;
  notas?: string | null;
  requiereVerificacionHumana?: boolean;
  alcanceNuevo?: 'firma' | 'empresa';
}

async function fechaMinimaVigenciaTenant(tx: SqlClient): Promise<string | null> {
  const { rows } = await tx.query<{ fecha_minima_vigencia_tenant: string | null }>(
    'SELECT app.fecha_minima_vigencia_tenant()::text AS fecha_minima_vigencia_tenant',
  );
  return rows[0]?.fecha_minima_vigencia_tenant ?? null;
}

/** Impacto de un valor base (UVT/SMMLV/redondeo general): afecta en
 * principio a todos los conceptos y proveedores de la firma. */
export async function simularImpactoValorBase(tx: SqlClient): Promise<ImpactoSimulado> {
  const { rows } = await tx.query<{ conceptos_afectados: string; proveedores_afectados: string }>(
    'SELECT * FROM app.simular_impacto_valor_base()',
  );
  const fila = rows[0];
  return {
    conceptosAfectados: Number(fila?.conceptos_afectados ?? 0),
    proveedoresAfectados: Number(fila?.proveedores_afectados ?? 0),
  };
}

export async function editarUvtValue(
  tx: SqlClient,
  input: EditarUvtInput,
): Promise<ResultadoEdicion> {
  const normaRespaldo = requerirNorma(input.normaRespaldo);
  requerirFechaIso(input.vigenteDesde);

  const { rows } = await tx.query<FilaValorBaseAnterior>(
    'SELECT id, tenant_id, company_id, vigente_desde::text FROM uvt_value WHERE id = $1',
    [input.reglaAnteriorId],
  );
  const anterior = rows[0];
  if (!anterior) throw new ParametroNoEncontradoError('uvt_value', input.reglaAnteriorId);

  const ctx = await resolverContextoEdicion(tx, anterior);

  const fechaMinima = await fechaMinimaVigenciaTenant(tx);
  if (fechaMinima && input.vigenteDesde <= fechaMinima) throw new EdicionRetroactivaError(fechaMinima);
  if (ctx.esPropia && input.vigenteDesde <= anterior.vigente_desde) {
    throw new VigenciaInvalidaError(
      `La vigencia nueva (${input.vigenteDesde}) debe ser posterior a la que reemplaza ` +
        `(${anterior.vigente_desde}).`,
    );
  }

  if (ctx.esPropia) {
    await tx.query('UPDATE uvt_value SET vigente_hasta = $2 WHERE id = $1', [
      anterior.id,
      diaAnterior(input.vigenteDesde),
    ]);
  }

  const companyIdNuevo = companyDestino(ctx, anterior, input.alcanceNuevo);
  const { rows: nueva } = await tx.query<{ id: string }>(
    `INSERT INTO uvt_value (tenant_id, company_id, anio, valor, vigente_desde, vigente_hasta,
                            norma_respaldo, notas, requiere_verificacion_humana, created_by)
     VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8, app.current_user_id())
     RETURNING id`,
    [
      ctx.tenantId,
      companyIdNuevo,
      input.anio,
      input.valorCentavos,
      input.vigenteDesde,
      normaRespaldo,
      input.notas ?? null,
      input.requiereVerificacionHumana ?? false,
    ],
  );
  return { reglaNuevaId: nueva[0]!.id, reglaAnteriorCerrada: ctx.esPropia };
}

export interface EditarSmmlvInput {
  reglaAnteriorId: string;
  anio: number;
  valorMensualCentavos: string;
  auxilioTransporteCentavos?: string | null;
  vigenteDesde: string;
  normaRespaldo: string;
  notas?: string | null;
  requiereVerificacionHumana?: boolean;
  alcanceNuevo?: 'firma' | 'empresa';
}

export async function editarSmmlvValue(
  tx: SqlClient,
  input: EditarSmmlvInput,
): Promise<ResultadoEdicion> {
  const normaRespaldo = requerirNorma(input.normaRespaldo);
  requerirFechaIso(input.vigenteDesde);

  const { rows } = await tx.query<FilaValorBaseAnterior>(
    'SELECT id, tenant_id, company_id, vigente_desde::text FROM smmlv_value WHERE id = $1',
    [input.reglaAnteriorId],
  );
  const anterior = rows[0];
  if (!anterior) throw new ParametroNoEncontradoError('smmlv_value', input.reglaAnteriorId);

  const ctx = await resolverContextoEdicion(tx, anterior);

  const fechaMinima = await fechaMinimaVigenciaTenant(tx);
  if (fechaMinima && input.vigenteDesde <= fechaMinima) throw new EdicionRetroactivaError(fechaMinima);
  if (ctx.esPropia && input.vigenteDesde <= anterior.vigente_desde) {
    throw new VigenciaInvalidaError(
      `La vigencia nueva (${input.vigenteDesde}) debe ser posterior a la que reemplaza ` +
        `(${anterior.vigente_desde}).`,
    );
  }

  if (ctx.esPropia) {
    await tx.query('UPDATE smmlv_value SET vigente_hasta = $2 WHERE id = $1', [
      anterior.id,
      diaAnterior(input.vigenteDesde),
    ]);
  }

  const companyIdNuevo = companyDestino(ctx, anterior, input.alcanceNuevo);
  const { rows: nueva } = await tx.query<{ id: string }>(
    `INSERT INTO smmlv_value (tenant_id, company_id, anio, valor_mensual, auxilio_transporte,
                              vigente_desde, vigente_hasta, norma_respaldo, notas,
                              requiere_verificacion_humana, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,$8,$9, app.current_user_id())
     RETURNING id`,
    [
      ctx.tenantId,
      companyIdNuevo,
      input.anio,
      input.valorMensualCentavos,
      input.auxilioTransporteCentavos ?? null,
      input.vigenteDesde,
      normaRespaldo,
      input.notas ?? null,
      input.requiereVerificacionHumana ?? false,
    ],
  );
  return { reglaNuevaId: nueva[0]!.id, reglaAnteriorCerrada: ctx.esPropia };
}

// =============================================================================
// REDONDEO
// =============================================================================

export interface EditarRoundingRuleInput {
  reglaAnteriorId: string;
  modo: 'half_up' | 'half_even' | 'truncar' | 'techo' | 'piso';
  multiplo: number;
  vigenteDesde: string;
  normaRespaldo: string;
  notas?: string | null;
  requiereVerificacionHumana?: boolean;
  alcanceNuevo?: 'firma' | 'empresa';
}

interface FilaRoundingAnterior extends FilaConAlcance {
  id: string;
  codigo: string;
  nombre: string;
  aplica_a: string;
  vigente_desde: string;
}

async function fechaMinimaVigenciaRoundingRule(tx: SqlClient, id: string): Promise<string | null> {
  const { rows } = await tx.query<{ fecha_minima_vigencia_tenant: string | null }>(
    'SELECT app.fecha_minima_vigencia_tenant()::text AS fecha_minima_vigencia_tenant',
  );
  // El redondeo, igual que UVT/SMMLV, no tiene FK de trazabilidad propia
  // (D-017 solo la exige para tax_rule): se acota de forma conservadora al
  // último hecho publicado en toda la firma. Se conserva `id` en la firma
  // para no romper la interfaz si en el futuro se agrega esa trazabilidad.
  void id;
  return rows[0]?.fecha_minima_vigencia_tenant ?? null;
}

export async function editarRoundingRule(
  tx: SqlClient,
  input: EditarRoundingRuleInput,
): Promise<ResultadoEdicion> {
  const normaRespaldo = requerirNorma(input.normaRespaldo);
  requerirFechaIso(input.vigenteDesde);

  const { rows } = await tx.query<FilaRoundingAnterior>(
    `SELECT id, tenant_id, company_id, codigo, nombre, aplica_a, vigente_desde::text
       FROM rounding_rule WHERE id = $1`,
    [input.reglaAnteriorId],
  );
  const anterior = rows[0];
  if (!anterior) throw new ParametroNoEncontradoError('rounding_rule', input.reglaAnteriorId);

  const ctx = await resolverContextoEdicion(tx, anterior);

  const fechaMinima = await fechaMinimaVigenciaRoundingRule(tx, anterior.id);
  if (fechaMinima && input.vigenteDesde <= fechaMinima) throw new EdicionRetroactivaError(fechaMinima);
  if (ctx.esPropia && input.vigenteDesde <= anterior.vigente_desde) {
    throw new VigenciaInvalidaError(
      `La vigencia nueva (${input.vigenteDesde}) debe ser posterior a la que reemplaza ` +
        `(${anterior.vigente_desde}).`,
    );
  }

  if (ctx.esPropia) {
    await tx.query('UPDATE rounding_rule SET vigente_hasta = $2 WHERE id = $1', [
      anterior.id,
      diaAnterior(input.vigenteDesde),
    ]);
  }

  const companyIdNuevo = companyDestino(ctx, anterior, input.alcanceNuevo);
  const { rows: nueva } = await tx.query<{ id: string }>(
    `INSERT INTO rounding_rule (tenant_id, company_id, codigo, nombre, modo, multiplo, aplica_a,
                                vigente_desde, vigente_hasta, norma_respaldo, notas,
                                requiere_verificacion_humana, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL,$9,$10,$11, app.current_user_id())
     RETURNING id`,
    [
      ctx.tenantId,
      companyIdNuevo,
      anterior.codigo,
      anterior.nombre,
      input.modo,
      input.multiplo,
      anterior.aplica_a,
      input.vigenteDesde,
      normaRespaldo,
      input.notas ?? null,
      input.requiereVerificacionHumana ?? false,
    ],
  );
  return { reglaNuevaId: nueva[0]!.id, reglaAnteriorCerrada: ctx.esPropia };
}

// =============================================================================
// RETEICA — bases mínimas y tarifa general por municipio
// (las tarifas POR ACTIVIDAD del municipio son `tax_rule` tipo 'reteica' y
// ya las cubre `editarTarifaTaxRule` de arriba).
// =============================================================================

export interface FilaMunicipioIca {
  municipalityId: string;
  municipalityNombre: string;
  codigoDane: string;
  departamento: string;
  practicaReteica: boolean;
  baseMinimaServiciosUvt: string | null;
  baseMinimaComprasUvt: string | null;
  baseMinimaServiciosValor: string | null;
  baseMinimaComprasValor: string | null;
  usaTarifaDeActividad: boolean;
  tarifaGeneral: string | null;
  periodicidad: string;
  /** D-088. 'por_factura' (default y estado previo a D-088) | 'por_periodo'. */
  tipoMedicionBaseMinima: 'por_factura' | 'por_periodo';
  /** D-088. Meses de la ventana de acumulación; solo con medición por periodo. */
  periodoMeses: number | null;
  vigenteDesde: string;
  vigenteHasta: string | null;
  normaRespaldo: string;
  requiereVerificacionHumana: boolean;
  alcance: 'empresa' | 'firma' | 'global';
}

/** Todos los municipios del catálogo (identidad estable, D-013) con su regla
 * de ReteICA VIGENTE hoy si existe — y `reglaId: null` cuando NO existe:
 * exactamente la alerta de Bucaramanga/Cartagena de la sección 7.5. */
export async function listarMunicipiosIca(
  tx: SqlClient,
  fecha: string = hoyIso(),
): Promise<Array<FilaMunicipioIca & { reglaId: string | null }>> {
  requerirFechaIso(fecha);
  const { rows } = await tx.query<{
    regla_id: string | null;
    municipality_id: string;
    municipality_nombre: string;
    codigo_dane: string;
    departamento: string;
    practica_reteica: boolean | null;
    base_minima_servicios_uvt: string | null;
    base_minima_compras_uvt: string | null;
    base_minima_servicios_valor: string | null;
    base_minima_compras_valor: string | null;
    usa_tarifa_de_actividad: boolean | null;
    tarifa_general: string | null;
    periodicidad: string | null;
    tipo_medicion_base_minima: string | null;
    periodo_meses: number | null;
    vigente_desde: string | null;
    vigente_hasta: string | null;
    norma_respaldo: string | null;
    requiere_verificacion_humana: boolean | null;
    alcance: 'empresa' | 'firma' | 'global' | null;
  }>(
    `SELECT
        r.id AS regla_id, m.id AS municipality_id, m.nombre AS municipality_nombre,
        m.codigo_dane, m.departamento,
        r.practica_reteica, r.base_minima_servicios_uvt::text, r.base_minima_compras_uvt::text,
        r.base_minima_servicios_valor::text, r.base_minima_compras_valor::text,
        r.usa_tarifa_de_actividad, r.tarifa_general::text, r.periodicidad,
        r.tipo_medicion_base_minima, r.periodo_meses,
        r.vigente_desde::text, r.vigente_hasta::text, r.norma_respaldo, r.requiere_verificacion_humana,
        CASE WHEN r.id IS NULL THEN NULL
             WHEN r.company_id IS NOT NULL THEN 'empresa'
             WHEN r.tenant_id  IS NOT NULL THEN 'firma'
             ELSE 'global' END AS alcance
      FROM municipality m
      LEFT JOIN LATERAL (
        SELECT * FROM municipality_ica_rule mr
         WHERE mr.municipality_id = m.id
           AND app.esta_vigente(mr.vigente_desde, mr.vigente_hasta, $1::date)
         ORDER BY (mr.company_id IS NOT NULL) DESC, (mr.tenant_id IS NOT NULL) DESC, mr.vigente_desde DESC
         LIMIT 1
      ) r ON true
     WHERE m.tenant_id IS NULL
     ORDER BY m.nombre`,
    [fecha],
  );
  return rows.map((f) => ({
    reglaId: f.regla_id,
    municipalityId: f.municipality_id,
    municipalityNombre: f.municipality_nombre,
    codigoDane: f.codigo_dane,
    departamento: f.departamento,
    practicaReteica: f.practica_reteica ?? false,
    baseMinimaServiciosUvt: f.base_minima_servicios_uvt,
    baseMinimaComprasUvt: f.base_minima_compras_uvt,
    baseMinimaServiciosValor: f.base_minima_servicios_valor,
    baseMinimaComprasValor: f.base_minima_compras_valor,
    usaTarifaDeActividad: f.usa_tarifa_de_actividad ?? true,
    tarifaGeneral: f.tarifa_general,
    periodicidad: f.periodicidad ?? 'mensual',
    tipoMedicionBaseMinima: (f.tipo_medicion_base_minima ?? 'por_factura') as 'por_factura' | 'por_periodo',
    periodoMeses: f.periodo_meses ?? null,
    vigenteDesde: f.vigente_desde ?? '',
    vigenteHasta: f.vigente_hasta,
    normaRespaldo: f.norma_respaldo ?? '',
    requiereVerificacionHumana: f.requiere_verificacion_humana ?? false,
    alcance: (f.alcance ?? 'global') as 'empresa' | 'firma' | 'global',
  }));
}

export async function simularImpactoMunicipioIca(
  tx: SqlClient,
  municipalityId: string,
): Promise<ImpactoSimulado> {
  const { rows } = await tx.query<{ conceptos_afectados: string; proveedores_afectados: string }>(
    'SELECT * FROM app.simular_impacto_municipio_ica($1)',
    [municipalityId],
  );
  const fila = rows[0];
  return {
    conceptosAfectados: Number(fila?.conceptos_afectados ?? 0),
    proveedoresAfectados: Number(fila?.proveedores_afectados ?? 0),
  };
}

export interface EditarMunicipioIcaInput {
  /** El municipio (identidad estable). Si aún no existe ninguna regla para
   *  él (Bucaramanga, Cartagena), se crea la primera. */
  municipalityId: string;
  /** La regla vigente que se reemplaza, si existe. `null` cuando se está
   *  cargando la primera regla del municipio (dato hoy faltante). */
  reglaAnteriorId: string | null;
  practicaReteica: boolean;
  baseMinimaServiciosUvt?: string | null;
  baseMinimaComprasUvt?: string | null;
  baseMinimaServiciosValor?: string | null;
  baseMinimaComprasValor?: string | null;
  usaTarifaDeActividad: boolean;
  tarifaGeneral?: string | null;
  periodicidad: 'mensual' | 'bimestral' | 'trimestral' | 'cuatrimestral' | 'anual';
  /** D-088. Contra qué se compara la base mínima. Vacío = 'por_factura'
   *  (default de la columna y comportamiento previo a D-088). */
  tipoMedicionBaseMinima?: 'por_factura' | 'por_periodo';
  /** D-088. Meses de la ventana de acumulación. Obligatorio con 'por_periodo',
   *  debe ir vacío con 'por_factura' (lo impone el CHECK
   *  `municipality_ica_periodo_medicion_ck`). */
  periodoMeses?: number | null;
  vigenteDesde: string;
  normaRespaldo: string;
  notas?: string | null;
  requiereVerificacionHumana?: boolean;
  alcanceNuevo?: 'firma' | 'empresa';
}

export async function editarMunicipioIcaRule(
  tx: SqlClient,
  input: EditarMunicipioIcaInput,
): Promise<ResultadoEdicion> {
  const normaRespaldo = requerirNorma(input.normaRespaldo);
  requerirFechaIso(input.vigenteDesde);

  const tipoMedicion = input.tipoMedicionBaseMinima ?? 'por_factura';
  const periodoMeses = tipoMedicion === 'por_periodo' ? (input.periodoMeses ?? null) : null;
  if (tipoMedicion === 'por_periodo' && (periodoMeses == null || periodoMeses < 1 || periodoMeses > 12)) {
    throw new VigenciaInvalidaError(
      'Con medición «por periodo» hay que indicar la ventana de acumulación en meses (1 a 12), ' +
        'tal como la fije el acuerdo municipal.',
    );
  }

  let anterior: FilaValorBaseAnterior | null = null;
  if (input.reglaAnteriorId) {
    const { rows } = await tx.query<FilaValorBaseAnterior>(
      'SELECT id, tenant_id, company_id, vigente_desde::text FROM municipality_ica_rule WHERE id = $1',
      [input.reglaAnteriorId],
    );
    anterior = rows[0] ?? null;
    if (!anterior) {
      throw new ParametroNoEncontradoError('municipality_ica_rule', input.reglaAnteriorId);
    }
  }

  const ctx = anterior
    ? await resolverContextoEdicion(tx, anterior)
    : { ...(await contextoSesion(tx)), esPropia: false };

  const fechaMinima = await (async () => {
    const { rows } = await tx.query<{ fecha_minima_vigencia_municipio_ica: string | null }>(
      'SELECT app.fecha_minima_vigencia_municipio_ica($1)::text AS fecha_minima_vigencia_municipio_ica',
      [input.municipalityId],
    );
    return rows[0]?.fecha_minima_vigencia_municipio_ica ?? null;
  })();
  if (fechaMinima && input.vigenteDesde <= fechaMinima) throw new EdicionRetroactivaError(fechaMinima);
  if (anterior && ctx.esPropia && input.vigenteDesde <= anterior.vigente_desde) {
    throw new VigenciaInvalidaError(
      `La vigencia nueva (${input.vigenteDesde}) debe ser posterior a la que reemplaza ` +
        `(${anterior.vigente_desde}).`,
    );
  }

  if (anterior && ctx.esPropia) {
    await tx.query('UPDATE municipality_ica_rule SET vigente_hasta = $2 WHERE id = $1', [
      anterior.id,
      diaAnterior(input.vigenteDesde),
    ]);
  }

  const companyIdNuevo = anterior
    ? companyDestino(ctx, anterior, input.alcanceNuevo)
    : input.alcanceNuevo === 'empresa'
      ? ctx.companyIdSesion
      : null;

  const { rows: nueva } = await tx.query<{ id: string }>(
    `INSERT INTO municipality_ica_rule (
       tenant_id, company_id, municipality_id, practica_reteica,
       base_minima_servicios_uvt, base_minima_compras_uvt,
       base_minima_servicios_valor, base_minima_compras_valor,
       usa_tarifa_de_actividad, tarifa_general, periodicidad,
       tipo_medicion_base_minima, periodo_meses,
       vigente_desde, vigente_hasta, norma_respaldo, notas, requiere_verificacion_humana, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NULL,$15,$16,$17, app.current_user_id())
     RETURNING id`,
    [
      ctx.tenantId,
      companyIdNuevo,
      input.municipalityId,
      input.practicaReteica,
      input.baseMinimaServiciosUvt ?? null,
      input.baseMinimaComprasUvt ?? null,
      input.baseMinimaServiciosValor ?? null,
      input.baseMinimaComprasValor ?? null,
      input.usaTarifaDeActividad,
      input.tarifaGeneral ?? null,
      input.periodicidad,
      tipoMedicion,
      periodoMeses,
      input.vigenteDesde,
      normaRespaldo,
      input.notas ?? null,
      input.requiereVerificacionHumana ?? false,
    ],
  );
  return { reglaNuevaId: nueva[0]!.id, reglaAnteriorCerrada: Boolean(anterior && ctx.esPropia) };
}

// =============================================================================
// PERMISO (solo para decidir qué botón mostrar en la interfaz — D-025: la
// garantía real la impone el trigger de la base, esto NUNCA sustituye eso).
// =============================================================================

/** Submódulos de `/parametros` con permiso propio desde D-087 (migración 176).
 *  Sin `submodulo` se comprueba el permiso grueso `parametro.editar` /
 *  `parametro.leer` — comportamiento previo intacto para los llamadores que no
 *  pasen argumento. */
export type SubmoduloParametro = 'tarifas' | 'valores_base' | 'reteica' | 'ica' | 'puc';

const COD_EDITAR: Record<SubmoduloParametro, string> = {
  tarifas: PERMISOS.PARAMETRO_TARIFAS_EDITAR,
  valores_base: PERMISOS.PARAMETRO_VALORES_BASE_EDITAR,
  reteica: PERMISOS.PARAMETRO_RETEICA_EDITAR,
  ica: PERMISOS.PARAMETRO_ICA_EDITAR,
  puc: PERMISOS.PARAMETRO_PUC_EDITAR,
};

const COD_LEER: Record<SubmoduloParametro, string> = {
  tarifas: PERMISOS.PARAMETRO_TARIFAS_LEER,
  valores_base: PERMISOS.PARAMETRO_VALORES_BASE_LEER,
  reteica: PERMISOS.PARAMETRO_RETEICA_LEER,
  ica: PERMISOS.PARAMETRO_ICA_LEER,
  puc: PERMISOS.PARAMETRO_PUC_LEER,
};

/**
 * Código que EL MOTOR exige de verdad para escribir cada submódulo (trigger de
 * la migración 016). El sub-permiso de D-087 se suma a este, nunca lo sustituye:
 * el candado sigue siendo el grueso.
 */
const COD_MOTOR_EDITAR: Record<SubmoduloParametro, string> = {
  tarifas: PERMISOS.PARAMETRO_EDITAR,
  valores_base: PERMISOS.PARAMETRO_EDITAR,
  reteica: PERMISOS.PARAMETRO_EDITAR,
  ica: PERMISOS.PARAMETRO_EDITAR,
  puc: PERMISOS.PUC_EDITAR,
};

const COD_MOTOR_LEER: Record<SubmoduloParametro, string> = {
  tarifas: PERMISOS.PARAMETRO_LEER,
  valores_base: PERMISOS.PARAMETRO_LEER,
  reteica: PERMISOS.PARAMETRO_LEER,
  ica: PERMISOS.PARAMETRO_LEER,
  puc: PERMISOS.PUC_LEER,
};

/**
 * Solo para decidir qué botón mostrar (D-025: la garantía real la impone el
 * trigger de la base sobre `parametro.editar` / `puc.editar`, esto NUNCA
 * sustituye eso). Delega en el servicio central de permisos (`tienePermiso` →
 * `app.tiene_permiso`) con los códigos del registro `PERMISOS`, nunca cadenas
 * sueltas.
 *
 * A12 (revisión de seguridad de D-087): con `submodulo` se exigen **los dos**
 * códigos, el fino y el grueso. El fino restringe; **no habilita**. Si bastara
 * el fino, un rol propio de la Fase 8 con `parametro.tarifas.editar` y sin
 * `parametro.editar` vería el formulario de guardar y el motor lo rechazaría
 * con SE002 al enviarlo: la interfaz estaría ofreciendo lo que la base prohíbe.
 * Para los cinco roles del sistema el resultado es idéntico al de antes del
 * parche, porque 176 otorga el fino exactamente a quien ya tenía el grueso.
 */
export async function puedeEditarParametros(
  tx: SqlClient,
  submodulo?: SubmoduloParametro,
): Promise<boolean> {
  if (!submodulo) return tienePermiso(tx, PERMISOS.PARAMETRO_EDITAR);
  const [fino, motor] = await Promise.all([
    tienePermiso(tx, COD_EDITAR[submodulo]),
    tienePermiso(tx, COD_MOTOR_EDITAR[submodulo]),
  ]);
  return fino && motor;
}

export async function puedeLeerParametros(
  tx: SqlClient,
  submodulo?: SubmoduloParametro,
): Promise<boolean> {
  if (!submodulo) return tienePermiso(tx, PERMISOS.PARAMETRO_LEER);
  const [fino, grueso] = await Promise.all([
    tienePermiso(tx, COD_LEER[submodulo]),
    tienePermiso(tx, COD_MOTOR_LEER[submodulo]),
  ]);
  return fino && grueso;
}

// =============================================================================
// DETALLE DEL SIMULADOR DE IMPACTO (D-087, migración 176) — las filas reales
// (códigos + nombres) detrás del conteo, con la MISMA consulta base que
// `app.simular_impacto_*`, para que conteo y detalle no diverjan.
// =============================================================================

export interface FilaImpacto {
  clase: 'concepto' | 'proveedor';
  codigo: string;
  nombre: string;
}

export interface DetalleImpacto {
  conceptos: Array<{ codigo: string; nombre: string }>;
  proveedores: Array<{ codigo: string; nombre: string }>;
}

function agruparDetalle(rows: FilaImpacto[]): DetalleImpacto {
  return {
    conceptos: rows.filter((r) => r.clase === 'concepto').map((r) => ({ codigo: r.codigo, nombre: r.nombre })),
    proveedores: rows.filter((r) => r.clase === 'proveedor').map((r) => ({ codigo: r.codigo, nombre: r.nombre })),
  };
}

export async function detalleImpactoTarifa(tx: SqlClient, taxConceptId: string): Promise<DetalleImpacto> {
  const { rows } = await tx.query<FilaImpacto>(
    'SELECT clase, codigo, nombre FROM app.detalle_impacto_tax_concept($1)',
    [taxConceptId],
  );
  return agruparDetalle(rows);
}

export async function detalleImpactoMunicipioIca(tx: SqlClient, municipalityId: string): Promise<DetalleImpacto> {
  const { rows } = await tx.query<FilaImpacto>(
    'SELECT clase, codigo, nombre FROM app.detalle_impacto_municipio_ica($1)',
    [municipalityId],
  );
  return agruparDetalle(rows);
}

export async function detalleImpactoValorBase(tx: SqlClient): Promise<DetalleImpacto> {
  const { rows } = await tx.query<FilaImpacto>(
    'SELECT clase, codigo, nombre FROM app.detalle_impacto_valor_base()',
  );
  return agruparDetalle(rows);
}

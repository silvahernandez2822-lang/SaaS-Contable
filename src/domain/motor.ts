/**
 * A3 — MOTOR DETERMINISTA DE RESOLUCIÓN DE RETENCIONES (sección 9).
 *
 * `resolverRetenciones` implementa el contrato de la sección 9.1 con la
 * secuencia de la 9.2 y los casos especiales de la 9.3.
 *
 * Tres invariantes que este archivo no negocia:
 *
 *  1. NO HAY UN SOLO VALOR TRIBUTARIO AQUÍ. Ni una tarifa, ni una base mínima,
 *     ni una UVT, ni un tope. Lo único que este archivo sabe es CÓMO se busca
 *     la regla; QUÉ dice la regla lo dicen las tablas de A1 (Regla de Oro 2).
 *
 *  2. TODO SE RESUELVE POR LA FECHA DEL HECHO ECONÓMICO, nunca por la fecha de
 *     proceso (Regla de Oro 3). Reprocesar en julio una factura de junio
 *     resuelve con las reglas de junio.
 *
 *  3. LO QUE NO SE SABE, NO SE SUPONE. Si falta la vigencia de un atributo del
 *     tercero, la UVT del año, la regla de redondeo o la actividad del
 *     proveedor en el municipio, el documento va a revisión manual con el
 *     motivo escrito. Un valor por omisión en un motor tributario es un error
 *     que nadie ve (D-014 y advertencia 17.5).
 *
 * La resolución final depende de los cinco ejes de la sección 8.2:
 * concepto × tercero × municipio × cuantía × fecha del hecho.
 */
import { createHash } from 'node:crypto';
import {
  ESCALA_TARIFA,
  ESCALA_UVT,
  aEntero,
  aEnteroEscalado,
  aNumeroSeguro,
  aTextoDecimal,
  calcularRetencion,
  esModoRedondeo,
  type ModoRedondeo,
} from './dinero';
import type {
  FilaAtributosFiscales,
  FilaConcepto,
  FilaEmpresa,
  FilaMunicipioIca,
  FilaRedondeo,
  FilaTaxRule,
  FilaTercero,
  FilaUvt,
  RepositorioTributario,
} from './repositorio';
import {
  MOTIVO,
  type EfectoAcumuladoIca,
  type EntradaFactura,
  type EntradaResolucion,
  type FechaIso,
  type LineaFactura,
  type MotivoRevision,
  type ResultadoResolucion,
  type RetencionAgregada,
  type RetencionResuelta,
  type TipoOperacionIca,
  type TipoRetencion,
} from './tipos';

/** Claves de `company_setting` que parametrizan el tratamiento diferenciado. */
export const AJUSTE = {
  /** Régimen SIMPLE: qué se le practica y qué no (sección 9.3, caso dorado 13). */
  REGIMEN_SIMPLE: 'retencion.regimen_simple',
  /** Desempate cuando el tercero tiene varias actividades en el mismo municipio. */
  DESEMPATE_ICA: 'retencion.reteica.desempate',
} as const;

export interface PoliticaRegimenSimple {
  practica_retefuente: boolean;
  practica_reteiva: boolean;
  practica_reteica: boolean;
}

// -----------------------------------------------------------------------------
// Contexto de una resolución: todo lo que se leyó una sola vez.
// -----------------------------------------------------------------------------
interface Contexto {
  entrada: EntradaResolucion;
  empresa: FilaEmpresa;
  tercero: FilaTercero;
  atributos: FilaAtributosFiscales;
  concepto: FilaConcepto;
  uvt: FilaUvt | null;
  /** Base del concepto: el AIU cuando el concepto es de AIU, si no la gravable. */
  baseConcepto: bigint;
  baseGravable: bigint;
  valorIva: bigint;
  aiu: bigint | null;
  motivos: MotivoRevision[];
  redondeos: Map<string, FilaRedondeo | null>;
  /** D-088. Acumuladores de base mínima de ICA por periodo. Solo lectura. */
  sesionIca: SesionAcumuladosIca;
}

function motivo(codigo: string, detalle: string): MotivoRevision {
  return { codigo, detalle };
}

function vacio(motivos: MotivoRevision[]): ResultadoResolucion {
  return {
    retenciones: [],
    agregados: [],
    requiereRevisionManual: motivos.length > 0,
    motivosRevision: motivos,
    acumuladosIca: [],
    huella: huellaDe([], motivos),
  };
}

/**
 * Huella determinista del resultado (sección 8.4, caso dorado 18). Se calcula
 * sobre los campos que definen el cálculo —regla, vigencia, base, tarifa,
 * valor, cuenta— y no sobre identificadores generados ni marcas de tiempo, que
 * son distintos en cada corrida por construcción.
 */
export function huellaDe(
  retenciones: readonly RetencionResuelta[],
  motivos: readonly MotivoRevision[],
): string {
  const canonico = JSON.stringify({
    retenciones: retenciones.map((r) => [
      r.tipo,
      r.conceptoCausacionId,
      r.terceroId,
      r.base,
      r.tarifa,
      r.regla.taxRuleId,
      r.regla.vigenteDesde,
      r.regla.vigenteHasta,
      r.valor,
      r.accountId,
      r.normaRespaldo,
      r.aplicada,
      r.motivoNoAplica,
      r.municipalityId,
      r.ciiuActivityId,
      r.fechaHechoEconomico,
    ]),
    motivos: motivos.map((m) => [m.codigo, m.detalle]),
  });
  return createHash('sha256').update(canonico, 'utf8').digest('hex');
}

// -----------------------------------------------------------------------------
// Selección de regla: la más específica gana; un empate exacto es ambigüedad,
// no una moneda al aire.
// -----------------------------------------------------------------------------
function prioridad(r: FilaTaxRule): string {
  return [
    r.especificidad,
    r.company_id === null ? 0 : 1,
    r.tenant_id === null ? 0 : 1,
    r.vigente_desde,
  ].join('|');
}

function elegirRegla(reglas: readonly FilaTaxRule[]): { regla: FilaTaxRule | null; ambigua: boolean } {
  if (reglas.length === 0) return { regla: null, ambigua: false };
  const ordenadas = [...reglas].sort((a, b) => {
    const pa = prioridad(a);
    const pb = prioridad(b);
    if (pa === pb) return a.id < b.id ? -1 : 1;
    return pa < pb ? 1 : -1;
  });
  const mejor = ordenadas[0]!;
  const segunda = ordenadas[1];
  const ambigua = segunda !== undefined && prioridad(segunda) === prioridad(mejor);
  return { regla: mejor, ambigua };
}

// -----------------------------------------------------------------------------
// Redondeo: es un parámetro, no una decisión del motor (Regla de Oro 5).
// -----------------------------------------------------------------------------
async function reglaRedondeo(
  repo: RepositorioTributario,
  ctx: Contexto,
  tipo: TipoRetencion,
): Promise<FilaRedondeo | null> {
  const cacheada = ctx.redondeos.get(tipo);
  if (cacheada !== undefined) return cacheada;
  const fila = await repo.redondeo(ctx.empresa, tipo, ctx.entrada.fechaHechoEconomico);
  ctx.redondeos.set(tipo, fila);
  return fila;
}

interface Redondeador {
  id: string;
  modo: ModoRedondeo;
  multiplo: bigint;
}

function aRedondeador(fila: FilaRedondeo): Redondeador {
  if (!esModoRedondeo(fila.modo)) {
    throw new Error(`Modo de redondeo desconocido en rounding_rule ${fila.id}: ${fila.modo}`);
  }
  const multiplo = aEntero(fila.multiplo);
  if (multiplo === null || multiplo <= 0n) {
    throw new Error(`rounding_rule ${fila.id} tiene un múltiplo inválido.`);
  }
  return { id: fila.id, modo: fila.modo, multiplo };
}

// -----------------------------------------------------------------------------
// Base mínima: se compara con la base gravable convertida a pesos por la UVT
// vigente A LA FECHA DEL HECHO.
// -----------------------------------------------------------------------------
interface Umbral {
  valor: bigint | null;
  baseMinimaUvt: string | null;
  baseMinimaValor: number | null;
  uvtUsada: number | null;
  faltaUvt: boolean;
}

function umbralDe(regla: FilaTaxRule, uvt: FilaUvt | null): Umbral {
  const enPesos = aEntero(regla.base_minima_valor);
  if (enPesos !== null) {
    return {
      valor: enPesos,
      baseMinimaUvt: null,
      baseMinimaValor: aNumeroSeguro(enPesos, 'base mínima en pesos'),
      uvtUsada: null,
      faltaUvt: false,
    };
  }
  const enUvt = aEnteroEscalado(regla.base_minima_uvt, ESCALA_UVT);
  if (enUvt === null) {
    return { valor: null, baseMinimaUvt: null, baseMinimaValor: null, uvtUsada: null, faltaUvt: false };
  }
  if (uvt === null) {
    return {
      valor: null,
      baseMinimaUvt: aTextoDecimal(enUvt, ESCALA_UVT),
      baseMinimaValor: null,
      uvtUsada: null,
      faltaUvt: true,
    };
  }
  const uvtCentavos = aEntero(uvt.valor)!;
  return {
    valor: (enUvt * uvtCentavos) / ESCALA_UVT,
    baseMinimaUvt: aTextoDecimal(enUvt, ESCALA_UVT),
    baseMinimaValor: null,
    uvtUsada: aNumeroSeguro(uvtCentavos, 'valor de la UVT'),
    faltaUvt: false,
  };
}

function superaUmbral(base: bigint, umbral: bigint, comparador: string): boolean {
  return comparador === 'mayor' ? base > umbral : base >= umbral;
}

// -----------------------------------------------------------------------------
// D-088 — BASE MÍNIMA DE ICA MEDIDA POR PERIODO
//
// Hay municipios cuya base mínima no se compara contra la factura individual
// sino contra el ACUMULADO del tercero en el municipio durante un periodo. El
// motor necesita entonces dos cosas que hasta D-088 no tenía: saber dónde
// empieza y dónde acaba la ventana, y saber cuánto llevaba acumulado ese
// tercero. Lo segundo lo guarda `reteica_periodo_acumulado`.
//
// DOS ASUNCIONES QUE NO SE RESUELVEN EN SILENCIO. Están escritas aquí y en
// ESTADO_PROYECTO.md como decisiones pendientes de confirmación del cliente
// final, no como hechos normativos:
//
//  A. ANCLAJE DE LA VENTANA: año calendario. El primer periodo del año empieza
//     el 1 de enero del AÑO DEL HECHO ECONÓMICO y los siguientes se encadenan
//     cada `periodo_meses` meses (con periodo_meses = 2: ene-feb, mar-abr, …).
//     La ventana NUNCA cruza el cambio de año: si `periodo_meses` no divide a
//     12 (5, 7, 8, 9, 10, 11), el último periodo del año se recorta al 31 de
//     diciembre en vez de invadir enero del año siguiente. Anclar al año
//     calendario es lo que hace que la ventana sea reproducible sin depender de
//     cuándo se cargó la parametrización ni de cuándo empezó a operar la
//     empresa, que es lo que exige la Regla de Oro 3.
//
//  B. CRUCE DEL UMBRAL A MITAD DE PERIODO: se retiene SOLO HACIA ADELANTE. La
//     factura que hace cruzar el acumulado retiene sobre SU PROPIA base, y las
//     siguientes del periodo también; lo ya causado antes del cruce NO se
//     ajusta retroactivamente. Es la lectura conservadora y reversible: si el
//     municipio exige el ajuste retroactivo, se corrige por reversa sobre un
//     ledger que no ha inventado nada. La contraria —recalcular hacia atrás—
//     obligaría a tocar asientos ya publicados, que la Regla de Oro 1 prohíbe.
//
// Y una consecuencia que sí es una decisión del motor, no una asunción: la
// factura que NO alcanza el umbral tampoco retiene, pero SÍ suma al acumulador.
// Si no sumara, el umbral no se cruzaría nunca.
// -----------------------------------------------------------------------------

/** `YYYY-MM-DD` de un instante UTC. Aritmética de calendario, no de dinero. */
function isoUtc(ms: number): FechaIso {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Ventana de acumulación vigente para una fecha, con el anclaje A de arriba.
 * Devuelve `null` si `periodoMeses` no es un entero utilizable: sin ventana no
 * hay acumulado, y el motor prefiere la revisión manual a una ventana inventada.
 */
export function ventanaPeriodoIca(
  fecha: FechaIso,
  periodoMeses: number,
): { inicio: FechaIso; fin: FechaIso } | null {
  if (!Number.isInteger(periodoMeses) || periodoMeses < 1 || periodoMeses > 12) return null;
  const anio = Number(fecha.slice(0, 4));
  const mes = Number(fecha.slice(5, 7));
  if (!Number.isInteger(anio) || !Number.isInteger(mes) || mes < 1 || mes > 12) return null;

  const indice = Math.floor((mes - 1) / periodoMeses);
  const mesInicio = indice * periodoMeses + 1;
  // Recorte al 31 de diciembre (asunción A): el mes siguiente al fin nunca pasa
  // de enero del año siguiente.
  const mesFinExclusivo = Math.min(mesInicio + periodoMeses, 13);
  return {
    inicio: isoUtc(Date.UTC(anio, mesInicio - 1, 1)),
    // Día 0 del mes siguiente al último = último día del periodo. Sin tabla de
    // meses ni cálculo de bisiestos a mano.
    fin: isoUtc(Date.UTC(anio, mesFinExclusivo - 1, 0)),
  };
}

export interface ClaveAcumuladoIca {
  companyId: string;
  terceroId: string;
  municipalityId: string;
  tipoOperacionIca: TipoOperacionIca;
  periodoInicio: FechaIso;
  periodoFin: FechaIso;
}

interface EstadoAcumulado {
  clave: ClaveAcumuladoIca;
  /** Lo que ya había en la base para esa ventana. */
  previo: bigint;
  /** El documento actual ya estaba contado en la base: esto es un reproceso. */
  yaContado: boolean;
  /** Lo que esta resolución añadiría (0 si `yaContado`). */
  sumado: bigint;
}

function claveTexto(c: ClaveAcumuladoIca): string {
  return [c.companyId, c.terceroId, c.municipalityId, c.tipoOperacionIca, c.periodoInicio].join('|');
}

function contieneDocumento(documentos: unknown, sourceDocumentId: string): boolean {
  const lista =
    typeof documentos === 'string' ? (JSON.parse(documentos) as unknown) : documentos;
  return Array.isArray(lista) && lista.some((x) => x === sourceDocumentId);
}

/**
 * Los acumuladores leídos durante UNA resolución (una factura completa, con sus
 * varios grupos de concepto). Vive lo que dura la resolución.
 *
 * Es de LECTURA. No escribe ni una fila: acumula en memoria y al final entrega
 * la lista de efectos para que los aplique quien persiste el asiento, en su
 * misma transacción y solo si el asiento se escribe. Una previsualización que
 * descarte el resultado no deja huella en el acumulador.
 */
export class SesionAcumuladosIca {
  private readonly estados = new Map<string, EstadoAcumulado>();

  constructor(
    private readonly repo: RepositorioTributario,
    private readonly sourceDocumentId: string | null,
  ) {}

  /** Lee el acumulado de la ventana una sola vez por clave. */
  async abrir(clave: ClaveAcumuladoIca): Promise<void> {
    const k = claveTexto(clave);
    if (this.estados.has(k)) return;
    const fila = await this.repo.acumuladoIca(
      clave.companyId,
      clave.terceroId,
      clave.municipalityId,
      clave.tipoOperacionIca,
      clave.periodoInicio,
    );
    this.estados.set(k, {
      clave,
      previo: fila === null ? 0n : (aEntero(fila.base_acumulada_centavos) ?? 0n),
      yaContado:
        fila !== null &&
        this.sourceDocumentId !== null &&
        contieneDocumento(fila.documentos_contados, this.sourceDocumentId),
      sumado: 0n,
    });
  }

  /**
   * Suma la base de esta liquidación y devuelve el acumulado CON ella dentro,
   * que es contra lo que se compara la base mínima.
   *
   * Anti doble conteo: si el documento ya figura en `documentos_contados`, el
   * acumulado de la base YA incluye esta factura y no se vuelve a sumar. Es lo
   * que hace que recausar el mismo documento dé exactamente el mismo resultado
   * (caso dorado 18) en vez de empujarlo por encima del umbral él solo.
   */
  acumular(clave: ClaveAcumuladoIca, base: bigint): { acumulado: bigint; previo: bigint; yaContado: boolean } {
    const estado = this.estados.get(claveTexto(clave));
    if (!estado) throw new Error('Acumulador de ICA usado sin abrirlo primero.');
    if (!estado.yaContado) estado.sumado += base;
    return {
      acumulado: estado.previo + estado.sumado,
      previo: estado.previo,
      yaContado: estado.yaContado,
    };
  }

  /**
   * Efectos a aplicar si el asiento se persiste. Vacío cuando la resolución no
   * sabe de qué documento viene: sin `sourceDocumentId` no hay clave anti doble
   * conteo, y un acumulador que no distingue el reproceso es peor que ninguno.
   */
  efectos(): EfectoAcumuladoIca[] {
    const doc = this.sourceDocumentId;
    if (doc === null) return [];
    const salida: EfectoAcumuladoIca[] = [];
    for (const e of this.estados.values()) {
      if (e.sumado === 0n && !e.yaContado) continue;
      salida.push({
        companyId: e.clave.companyId,
        terceroId: e.clave.terceroId,
        municipalityId: e.clave.municipalityId,
        tipoOperacionIca: e.clave.tipoOperacionIca,
        periodoInicio: e.clave.periodoInicio,
        periodoFin: e.clave.periodoFin,
        sourceDocumentId: doc,
        baseSumada: aNumeroSeguro(e.sumado, 'base sumada al acumulador de ICA'),
        yaContado: e.yaContado,
        acumuladoPrevio: aNumeroSeguro(e.previo, 'acumulado previo de ICA'),
        acumuladoResultante: aNumeroSeguro(e.previo + e.sumado, 'acumulado resultante de ICA'),
      });
    }
    return salida.sort((a, b) => (claveTexto(a) < claveTexto(b) ? -1 : 1));
  }
}

/** Base sobre la que la regla dice que se aplica la tarifa (sección 9.2). */
function baseSegunRegla(ctx: Contexto, regla: FilaTaxRule): bigint | null {
  switch (regla.aplica_sobre) {
    case 'valor_iva':
      return ctx.valorIva;
    case 'aiu':
      return ctx.aiu;
    case 'base_menos_iva':
    case 'base_gravable':
    default:
      return ctx.baseConcepto;
  }
}

// -----------------------------------------------------------------------------
// Construcción de una retención resuelta
// -----------------------------------------------------------------------------
interface DatosRetencion {
  tipo: TipoRetencion;
  regla: FilaTaxRule;
  base: bigint;
  tarifaEscalada: bigint;
  redondeador: Redondeador;
  umbral: Umbral;
  accountId: string;
  municipalityId?: string | null;
  ciiuActivityId?: string | null;
  nota?: string | null;
  /** Motivo por el que no se practica, aunque la regla exista. */
  motivoNoAplica?: string | null;
}

function construir(ctx: Contexto, d: DatosRetencion): RetencionResuelta {
  const noAplica = d.motivoNoAplica ?? null;
  const calculo = noAplica
    ? { valor: 0n, valorSinRedondeo: 0n }
    : calcularRetencion(d.base, d.tarifaEscalada, d.redondeador.multiplo, d.redondeador.modo);
  return {
    tipo: d.tipo,
    base: aNumeroSeguro(d.base, 'base de la retención'),
    tarifa: aTextoDecimal(d.tarifaEscalada, ESCALA_TARIFA),
    regla: {
      taxRuleId: d.regla.id,
      vigenteDesde: d.regla.vigente_desde,
      vigenteHasta: d.regla.vigente_hasta,
    },
    valor: aNumeroSeguro(calculo.valor, 'valor de la retención'),
    accountId: d.accountId,
    normaRespaldo: d.regla.norma_respaldo,
    aplicada: noAplica === null,
    motivoNoAplica: noAplica,
    valorSinRedondeo: aNumeroSeguro(calculo.valorSinRedondeo, 'valor sin redondeo'),
    conceptoCausacionId: ctx.concepto.id,
    terceroId: ctx.tercero.id,
    municipalityId: d.municipalityId ?? null,
    ciiuActivityId: d.ciiuActivityId ?? null,
    roundingRuleId: d.redondeador.id,
    uvtValorUsado: d.umbral.uvtUsada,
    baseMinimaUvtUsada: d.umbral.baseMinimaUvt,
    baseMinimaValorUsada: d.umbral.baseMinimaValor,
    fechaHechoEconomico: ctx.entrada.fechaHechoEconomico,
    nota: d.nota ?? null,
  };
}

function textoPesos(centavos: bigint): string {
  return aTextoDecimal(centavos, 100n);
}

// -----------------------------------------------------------------------------
// PASO 1 y 2 de la sección 9.2 — atributos del tercero y calidad de agente
// -----------------------------------------------------------------------------
async function abrirContexto(
  repo: RepositorioTributario,
  entrada: EntradaResolucion,
  sesionIca: SesionAcumuladosIca,
): Promise<Contexto | ResultadoResolucion> {
  const motivos: MotivoRevision[] = [];

  const baseGravable = BigInt(entrada.baseGravable);
  const valorIva = BigInt(entrada.valorIva);
  if (baseGravable < 0n || valorIva < 0n) {
    return vacio([
      motivo(MOTIVO.BASE_NEGATIVA, 'La base gravable y el IVA de una factura no pueden ser negativos.'),
    ]);
  }

  const empresa = await repo.empresa(entrada.companyId);
  if (!empresa) {
    return vacio([motivo(MOTIVO.EMPRESA_INEXISTENTE, `No existe la empresa ${entrada.companyId}.`)]);
  }

  const tercero = await repo.tercero(entrada.companyId, entrada.terceroId);
  if (!tercero) {
    return vacio([
      motivo(MOTIVO.TERCERO_SIN_ATRIBUTOS, `No existe el tercero ${entrada.terceroId} en esta empresa.`),
    ]);
  }

  // D-014: sin vigencia a la fecha del hecho NO hay valor por defecto.
  const atributos = await repo.atributosFiscales(
    entrada.companyId,
    entrada.terceroId,
    entrada.fechaHechoEconomico,
  );
  if (!atributos) {
    return vacio([
      motivo(
        MOTIVO.TERCERO_SIN_ATRIBUTOS,
        `El tercero ${entrada.terceroId} no tiene atributos fiscales vigentes al ` +
          `${entrada.fechaHechoEconomico}. El motor no supone si es declarante: la diferencia ` +
          'entre serlo y no serlo cambia la tarifa, así que el documento va a revisión manual.',
      ),
    ]);
  }

  const concepto = await repo.concepto(empresa, entrada.conceptoId);
  if (!concepto) {
    return vacio([
      motivo(MOTIVO.CONCEPTO_INEXISTENTE, `No existe el concepto de causación ${entrada.conceptoId}.`),
    ]);
  }

  // Caso 9.3 — AIU: la base es el AIU, no el valor total.
  let aiu: bigint | null = entrada.valorAiu === null || entrada.valorAiu === undefined
    ? null
    : BigInt(entrada.valorAiu);
  let baseConcepto = baseGravable;
  if (concepto.base_es_aiu) {
    if (aiu === null) {
      motivos.push(
        motivo(
          MOTIVO.SIN_AIU,
          `El concepto ${concepto.codigo} liquida sobre AIU y el documento no lo trae discriminado.`,
        ),
      );
    } else {
      baseConcepto = aiu;
      const minimo = aEnteroEscalado(concepto.porcentaje_aiu_minimo, ESCALA_TARIFA);
      if (minimo !== null) {
        const aiuMinimo = (baseGravable * minimo) / ESCALA_TARIFA;
        if (aiu < aiuMinimo) {
          motivos.push(
            motivo(
              MOTIVO.AIU_BAJO_MINIMO,
              `El AIU declarado (${textoPesos(aiu)}) queda por debajo del mínimo parametrizado ` +
                `para el concepto (${textoPesos(aiuMinimo)}). El motor no lo sube por su cuenta.`,
            ),
          );
        }
      }
    }
  }

  const uvt = await repo.uvtVigente(empresa, entrada.fechaHechoEconomico);

  return {
    entrada,
    empresa,
    tercero,
    atributos,
    concepto,
    uvt,
    baseConcepto,
    baseGravable,
    valorIva,
    aiu,
    motivos,
    redondeos: new Map(),
    sesionIca,
  };
}

// -----------------------------------------------------------------------------
// Régimen SIMPLE (sección 9.3, caso dorado 13): tratamiento diferenciado SEGÚN
// PARAMETRIZACIÓN. Sin política parametrizada el motor no decide por su cuenta.
// -----------------------------------------------------------------------------
async function politicaSimple(
  repo: RepositorioTributario,
  ctx: Contexto,
): Promise<PoliticaRegimenSimple | null> {
  const crudo = await repo.ajuste(ctx.empresa.id, AJUSTE.REGIMEN_SIMPLE);
  if (crudo === null || typeof crudo !== 'object') return null;
  const p = crudo as Record<string, unknown>;
  const leer = (clave: string): boolean | null =>
    typeof p[clave] === 'boolean' ? (p[clave] as boolean) : null;
  const rf = leer('practica_retefuente');
  const ri = leer('practica_reteiva');
  const ra = leer('practica_reteica');
  if (rf === null || ri === null || ra === null) return null;
  return { practica_retefuente: rf, practica_reteiva: ri, practica_reteica: ra };
}

function esSimple(ctx: Contexto): boolean {
  return ctx.atributos.es_regimen_simple || ctx.atributos.regimen_tributario === 'simple';
}

// -----------------------------------------------------------------------------
// PASO 3 — RETEFUENTE
// -----------------------------------------------------------------------------
async function resolverRetefuente(
  repo: RepositorioTributario,
  ctx: Contexto,
  retenciones: RetencionResuelta[],
): Promise<void> {
  const { concepto, empresa, atributos } = ctx;
  if (!concepto.aplica_retefuente || concepto.tax_concept_retefuente_id === null) return;
  if (!empresa.es_agente_retencion_renta) return;
  if (concepto.base_es_aiu && ctx.aiu === null) return; // ya está en motivos

  if (esSimple(ctx)) {
    const politica = await politicaSimple(repo, ctx);
    if (politica === null) {
      ctx.motivos.push(
        motivo(
          MOTIVO.SIMPLE_SIN_POLITICA,
          `El tercero está en régimen SIMPLE y la empresa no tiene parametrizado ` +
            `"${AJUSTE.REGIMEN_SIMPLE}". La sección 9.3 pide tratamiento diferenciado según ` +
            'parametrización; sin ella el motor no inventa el tratamiento.',
        ),
      );
      return;
    }
    if (!politica.practica_retefuente) {
      await registrarNoPracticada(
        repo, ctx, retenciones, 'retefuente', concepto.tax_concept_retefuente_id,
        'El tercero está en régimen SIMPLE y la parametrización de la empresa dice que no se le practica retefuente.',
      );
      return;
    }
  }

  if (atributos.es_autorretenedor_renta) {
    await registrarNoPracticada(
      repo, ctx, retenciones, 'retefuente', concepto.tax_concept_retefuente_id,
      'El tercero es autorretenedor de renta: se autorretiene él, el comprador no le practica retención.',
    );
    return;
  }

  const candidatas = await repo.reglasRetefuente(
    empresa,
    {
      taxConceptId: concepto.tax_concept_retefuente_id,
      esDeclarante: atributos.es_declarante_renta,
      tipoPersona: ctx.tercero.tipo_persona,
    },
    ctx.entrada.fechaHechoEconomico,
  );
  await liquidar(repo, ctx, retenciones, 'retefuente', candidatas, {});
}

// -----------------------------------------------------------------------------
// PASO 4 — RETEIVA: la tarifa va sobre el VALOR DEL IVA, no sobre la base.
// -----------------------------------------------------------------------------
async function resolverReteiva(
  repo: RepositorioTributario,
  ctx: Contexto,
  retenciones: RetencionResuelta[],
): Promise<void> {
  const { concepto, empresa, tercero, atributos } = ctx;
  if (!concepto.aplica_reteiva) return;
  if (!empresa.es_agente_retencion_iva) return;

  // Proveedor del exterior (sección 9.3): es OTRA regla, con otra norma.
  const conceptoIva = tercero.es_del_exterior
    ? concepto.tax_concept_reteiva_exterior_id
    : concepto.tax_concept_reteiva_id;

  if (conceptoIva === null) {
    if (tercero.es_del_exterior) {
      ctx.motivos.push(
        motivo(
          MOTIVO.EXTERIOR_SIN_CONCEPTO,
          `El proveedor es del exterior y el concepto ${concepto.codigo} no referencia la regla de ` +
            'ReteIVA para no residentes. El motor no fabrica esa tarifa.',
        ),
      );
    }
    return;
  }

  if (!tercero.es_del_exterior && !atributos.es_responsable_iva) {
    await registrarNoPracticada(
      repo, ctx, retenciones, 'reteiva', conceptoIva,
      'El tercero no es responsable de IVA a la fecha del hecho: no hay IVA que retenerle.',
    );
    return;
  }

  if (esSimple(ctx)) {
    const politica = await politicaSimple(repo, ctx);
    if (politica === null) {
      ctx.motivos.push(
        motivo(
          MOTIVO.SIMPLE_SIN_POLITICA,
          `El tercero está en régimen SIMPLE y la empresa no tiene parametrizado "${AJUSTE.REGIMEN_SIMPLE}".`,
        ),
      );
      return;
    }
    if (!politica.practica_reteiva) {
      await registrarNoPracticada(
        repo, ctx, retenciones, 'reteiva', conceptoIva,
        'El tercero está en régimen SIMPLE y la parametrización de la empresa dice que no se le practica ReteIVA.',
      );
      return;
    }
  }

  const candidatas = await repo.reglasPorConcepto(
    empresa, 'reteiva', conceptoIva, ctx.entrada.fechaHechoEconomico,
  );
  await liquidar(repo, ctx, retenciones, 'reteiva', candidatas, {});
}

// -----------------------------------------------------------------------------
// PASO 5 — RETEICA multimunicipio
// -----------------------------------------------------------------------------
async function resolverReteica(
  repo: RepositorioTributario,
  ctx: Contexto,
  retenciones: RetencionResuelta[],
): Promise<void> {
  const { concepto, empresa, tercero } = ctx;
  if (!concepto.aplica_reteica) return;
  if (!empresa.es_agente_retencion_ica) return;
  if (tercero.es_del_exterior) return; // no hay ICA municipal sobre un no residente
  if (concepto.base_es_aiu && ctx.aiu === null) return;

  const municipioId = ctx.entrada.municipioOperacionId;
  if (municipioId === null) {
    ctx.motivos.push(
      motivo(
        MOTIVO.SIN_MUNICIPIO,
        'El concepto aplica ReteICA y el documento no dice en qué municipio se realizó la ' +
          'operación. El ICA depende del municipio donde se prestó el servicio, no del domicilio ' +
          'del proveedor.',
      ),
    );
    return;
  }

  const reglaMunicipal = await repo.municipioIca(empresa, municipioId, ctx.entrada.fechaHechoEconomico);
  if (reglaMunicipal === null) {
    ctx.motivos.push(
      motivo(
        MOTIVO.SIN_REGLA_MUNICIPAL,
        `El municipio ${municipioId} no tiene parámetros de ReteICA vigentes al ` +
          `${ctx.entrada.fechaHechoEconomico}.`,
      ),
    );
    return;
  }
  if (!reglaMunicipal.practica_reteica) return;

  if (esSimple(ctx)) {
    const politica = await politicaSimple(repo, ctx);
    if (politica === null) {
      ctx.motivos.push(
        motivo(
          MOTIVO.SIMPLE_SIN_POLITICA,
          `El tercero está en régimen SIMPLE y la empresa no tiene parametrizado "${AJUSTE.REGIMEN_SIMPLE}".`,
        ),
      );
      return;
    }
    if (!politica.practica_reteica) return;
  }

  // Naturaleza de la operación: la base mínima de servicios y la de compras
  // difieren en casi todos los acuerdos municipales.
  const naturaleza: TipoOperacionIca | null =
    ctx.entrada.tipoOperacionIca ?? concepto.tipo_operacion_ica ?? null;
  const umbralServicios = reglaMunicipal.base_minima_servicios_valor !== null
    || reglaMunicipal.base_minima_servicios_uvt !== null;
  const umbralCompras = reglaMunicipal.base_minima_compras_valor !== null
    || reglaMunicipal.base_minima_compras_uvt !== null;
  if (naturaleza === null && (umbralServicios || umbralCompras)) {
    ctx.motivos.push(
      motivo(
        MOTIVO.ICA_SIN_NATURALEZA,
        `El municipio tiene bases mínimas distintas para servicios y para compras, y el concepto ` +
          `${concepto.codigo} no dice cuál de las dos aplica (tipo_operacion_ica).`,
      ),
    );
    return;
  }

  // Actividad del tercero EN ESE MUNICIPIO (caso dorado 10).
  let ciiuActivityId: string | null = null;
  let tarifaOverride: bigint | null = null;
  let nota: string | null = null;

  if (reglaMunicipal.usa_tarifa_de_actividad) {
    const actividades = await repo.actividadesEnMunicipio(
      empresa.id, tercero.id, municipioId, ctx.entrada.fechaHechoEconomico,
    );
    if (actividades.length === 0) {
      ctx.motivos.push(
        motivo(
          MOTIVO.SIN_ACTIVIDAD,
          `El tercero no tiene actividad económica registrada en el municipio ${municipioId} a la ` +
            'fecha del hecho. La tarifa de ICA depende de esa actividad y el motor no la deduce ' +
            'de la actividad que ejerce en otro municipio.',
        ),
      );
      return;
    }

    const ajusteDesempate = await repo.ajuste(empresa.id, AJUSTE.DESEMPATE_ICA);
    const desempate =
      typeof ajusteDesempate === 'string' ? ajusteDesempate : reglaMunicipal.regla_desempate_actividad;

    if (actividades.length === 1) {
      ciiuActivityId = actividades[0]!.ciiu_activity_id;
      tarifaOverride = aEnteroEscalado(actividades[0]!.tarifa_ica_override, ESCALA_TARIFA);
    } else {
      const elegida = await desempatar(repo, ctx, municipioId, actividades, desempate);
      if (elegida === null) {
        ctx.motivos.push(
          motivo(
            MOTIVO.DESEMPATE_IMPOSIBLE,
            `El tercero tiene ${actividades.length} actividades vigentes en el municipio ` +
              `${municipioId} y la regla de desempate "${desempate}" no permite elegir una sola.`,
          ),
        );
        return;
      }
      ciiuActivityId = elegida.actividad.ciiu_activity_id;
      tarifaOverride = aEnteroEscalado(elegida.actividad.tarifa_ica_override, ESCALA_TARIFA);
      nota = `Desempate de actividad por regla "${desempate}" entre ${actividades.length} actividades.`;
    }
  }

  const candidatas = await repo.reglasIca(
    empresa,
    concepto.tax_concept_reteica_id,
    municipioId,
    ciiuActivityId,
    ctx.entrada.fechaHechoEconomico,
  );

  // Comprobación de coherencia: si el municipio declara una tarifa general y la
  // regla dice otra, no se elige "la más razonable": se para.
  const tarifaGeneral = aEnteroEscalado(reglaMunicipal.tarifa_general, ESCALA_TARIFA);
  const elegida = elegirRegla(candidatas);

  // D-088, TAREA 1 — ACTIVIDAD NO GRAVADA.
  //
  // `gravada = false` es una decisión normativa explícita del municipio: esa
  // actividad no tributa ICA allí. El motor NO retiene, sin importar la tarifa
  // que traiga la fila (el CHECK `tax_rule_gravada_ck` ya obliga a que sea 0,
  // pero el flag manda igual: leer la tarifa y leer el flag no pueden dar
  // resultados opuestos).
  //
  // No es revisión manual: no hay nada que un humano tenga que decidir. Se
  // registra la EVALUACIÓN con `aplicada = false` y el motivo en texto, que es
  // el mismo canal por el que ya se explica «la base no llegó al mínimo». El
  // contador puede abrir la factura y leer por qué no retuvo.
  //
  // `gravada = true` y `gravada = null` (todas las reglas anteriores a D-088)
  // no cambian de conducta ni un centavo.
  let motivoNoAplicaForzado: string | null = null;
  if (elegida.regla !== null && elegida.regla.gravada === false) {
    motivoNoAplicaForzado =
      `La actividad ${ciiuActivityId ?? '(sin actividad, tarifa general)'} está marcada como NO ` +
      `GRAVADA de ICA en el municipio ${municipioId} por la regla ${elegida.regla.id}, vigente ` +
      `desde ${elegida.regla.vigente_desde}. No se practica ReteICA sin importar la tarifa. ` +
      `Norma: ${elegida.regla.norma_respaldo}.`;
  }

  if (
    motivoNoAplicaForzado === null &&
    !reglaMunicipal.usa_tarifa_de_actividad &&
    tarifaGeneral !== null &&
    elegida.regla !== null &&
    aEnteroEscalado(elegida.regla.tarifa, ESCALA_TARIFA) !== tarifaGeneral
  ) {
    ctx.motivos.push(
      motivo(
        MOTIVO.TARIFA_INCONSISTENTE,
        `municipality_ica_rule declara una tarifa general distinta de la de la tax_rule ` +
          `${elegida.regla.id} para el mismo municipio y fecha.`,
      ),
    );
    return;
  }

  // D-088, TAREA 2 — MEDICIÓN DE LA BASE MÍNIMA.
  //
  // 'por_factura' (el default de la columna y el estado de toda fila anterior a
  // D-088) no toca nada: se compara ESTA factura, como siempre.
  //
  // 'por_periodo' abre la ventana de acumulación del tercero en el municipio.
  // Una actividad no gravada NO acumula: sumar base que por definición no
  // tributa acercaría al tercero a un umbral que no le corresponde cruzar.
  let acumulado: ClaveAcumuladoIca | undefined;
  if (reglaMunicipal.tipo_medicion_base_minima === 'por_periodo' && motivoNoAplicaForzado === null) {
    const clave = await abrirVentanaIca(ctx, reglaMunicipal, municipioId, naturaleza);
    if (clave === null) return; // el motivo ya quedó escrito
    acumulado = clave;
  }

  await liquidar(repo, ctx, retenciones, 'reteica', candidatas, {
    municipalityId: municipioId,
    ciiuActivityId,
    tarifaOverride,
    nota,
    umbralExterno: umbralIca(reglaMunicipal, naturaleza, ctx.uvt),
    motivoNoAplicaForzado,
    acumulado,
  });
}

/**
 * D-088. Resuelve la ventana de acumulación y deja el acumulado leído. Devuelve
 * `null` —con el motivo ya escrito— cuando la parametrización no alcanza: sin
 * ventana o sin saber si la operación es servicio o compra, el acumulado no
 * significa nada y el motor prefiere la revisión manual a un umbral inventado.
 */
async function abrirVentanaIca(
  ctx: Contexto,
  reglaMunicipal: FilaMunicipioIca,
  municipioId: string,
  naturaleza: TipoOperacionIca | null,
): Promise<ClaveAcumuladoIca | null> {
  if (reglaMunicipal.periodo_meses === null) {
    ctx.motivos.push(
      motivo(
        MOTIVO.ICA_PERIODO_SIN_VENTANA,
        `El municipio ${municipioId} mide la base mínima de ICA por periodo y su regla vigente al ` +
          `${ctx.entrada.fechaHechoEconomico} no dice de cuántos meses es la ventana ` +
          '(municipality_ica_rule.periodo_meses). El motor no la supone.',
      ),
    );
    return null;
  }
  if (naturaleza === null) {
    ctx.motivos.push(
      motivo(
        MOTIVO.ICA_PERIODO_SIN_NATURALEZA,
        `El municipio ${municipioId} acumula la base por periodo y el acumulado se lleva por ` +
          `separado para servicios y para compras; el concepto ${ctx.concepto.codigo} no dice ` +
          'cuál de los dos es (tipo_operacion_ica).',
      ),
    );
    return null;
  }
  const ventana = ventanaPeriodoIca(ctx.entrada.fechaHechoEconomico, reglaMunicipal.periodo_meses);
  if (ventana === null) {
    ctx.motivos.push(
      motivo(
        MOTIVO.ICA_PERIODO_SIN_VENTANA,
        `No se pudo derivar la ventana de acumulación de ICA del municipio ${municipioId} para ` +
          `${ctx.entrada.fechaHechoEconomico} con periodo_meses = ${reglaMunicipal.periodo_meses}.`,
      ),
    );
    return null;
  }
  const clave: ClaveAcumuladoIca = {
    companyId: ctx.empresa.id,
    terceroId: ctx.tercero.id,
    municipalityId: municipioId,
    tipoOperacionIca: naturaleza,
    periodoInicio: ventana.inicio,
    periodoFin: ventana.fin,
  };
  await ctx.sesionIca.abrir(clave);
  return clave;
}

function umbralIca(
  reglaMunicipal: {
    base_minima_servicios_uvt: string | null;
    base_minima_compras_uvt: string | null;
    base_minima_servicios_valor: string | null;
    base_minima_compras_valor: string | null;
  },
  naturaleza: TipoOperacionIca | null,
  uvt: FilaUvt | null,
): Umbral {
  const enPesos = aEntero(
    naturaleza === 'compras'
      ? reglaMunicipal.base_minima_compras_valor
      : reglaMunicipal.base_minima_servicios_valor,
  );
  if (enPesos !== null) {
    return {
      valor: enPesos,
      baseMinimaUvt: null,
      baseMinimaValor: aNumeroSeguro(enPesos, 'base mínima municipal'),
      uvtUsada: null,
      faltaUvt: false,
    };
  }
  const enUvt = aEnteroEscalado(
    naturaleza === 'compras'
      ? reglaMunicipal.base_minima_compras_uvt
      : reglaMunicipal.base_minima_servicios_uvt,
    ESCALA_UVT,
  );
  if (enUvt === null) {
    return { valor: null, baseMinimaUvt: null, baseMinimaValor: null, uvtUsada: null, faltaUvt: false };
  }
  if (uvt === null) {
    return {
      valor: null,
      baseMinimaUvt: aTextoDecimal(enUvt, ESCALA_UVT),
      baseMinimaValor: null,
      uvtUsada: null,
      faltaUvt: true,
    };
  }
  const uvtCentavos = aEntero(uvt.valor)!;
  return {
    valor: (enUvt * uvtCentavos) / ESCALA_UVT,
    baseMinimaUvt: aTextoDecimal(enUvt, ESCALA_UVT),
    baseMinimaValor: null,
    uvtUsada: aNumeroSeguro(uvtCentavos, 'valor de la UVT'),
    faltaUvt: false,
  };
}

async function desempatar(
  repo: RepositorioTributario,
  ctx: Contexto,
  municipioId: string,
  actividades: readonly { ciiu_activity_id: string; es_principal: boolean; tarifa_ica_override: string | null }[],
  regla: string,
): Promise<{ actividad: (typeof actividades)[number] } | null> {
  if (regla === 'principal') {
    const principales = actividades.filter((a) => a.es_principal);
    return principales.length === 1 ? { actividad: principales[0]! } : null;
  }
  // Para desempatar por tarifa hay que conocer la tarifa de cada actividad.
  const conTarifa: { actividad: (typeof actividades)[number]; tarifa: bigint }[] = [];
  for (const a of actividades) {
    const override = aEnteroEscalado(a.tarifa_ica_override, ESCALA_TARIFA);
    if (override !== null) {
      conTarifa.push({ actividad: a, tarifa: override });
      continue;
    }
    const reglas = await repo.reglasIca(
      ctx.empresa,
      ctx.concepto.tax_concept_reteica_id,
      municipioId,
      a.ciiu_activity_id,
      ctx.entrada.fechaHechoEconomico,
    );
    const elegida = elegirRegla(reglas);
    if (elegida.regla === null) continue;
    conTarifa.push({ actividad: a, tarifa: aEnteroEscalado(elegida.regla.tarifa, ESCALA_TARIFA)! });
  }
  if (conTarifa.length === 0) return null;
  conTarifa.sort((x, y) => {
    if (x.tarifa === y.tarifa) return x.actividad.ciiu_activity_id < y.actividad.ciiu_activity_id ? -1 : 1;
    if (regla === 'mayor_tarifa') return x.tarifa > y.tarifa ? -1 : 1;
    return x.tarifa < y.tarifa ? -1 : 1;
  });
  const mejor = conTarifa[0]!;
  const segunda = conTarifa[1];
  if (segunda !== undefined && segunda.tarifa === mejor.tarifa) return null;
  return { actividad: mejor.actividad };
}

// -----------------------------------------------------------------------------
// PASO 6 — AUTORRETENCIÓN por el CIIU principal de la EMPRESA
// -----------------------------------------------------------------------------
async function resolverAutorretencion(
  repo: RepositorioTributario,
  ctx: Contexto,
  retenciones: RetencionResuelta[],
): Promise<void> {
  const { concepto, empresa } = ctx;
  if (!concepto.aplica_autorretencion || concepto.tax_concept_autorretencion_id === null) return;
  if (!empresa.es_autorretenedor_renta) return;

  const candidatas = await repo.reglasAutorretencion(
    empresa,
    concepto.tax_concept_autorretencion_id,
    empresa.ciiu_principal_id,
    ctx.entrada.fechaHechoEconomico,
  );
  await liquidar(repo, ctx, retenciones, 'autorretencion', candidatas, {
    ciiuActivityId: empresa.ciiu_principal_id,
  });
}

// -----------------------------------------------------------------------------
// Liquidación común: elegir regla, comparar contra la base mínima, calcular y
// redondear. Es el único lugar donde se decide si se retiene o no.
// -----------------------------------------------------------------------------
interface OpcionesLiquidacion {
  municipalityId?: string | null;
  ciiuActivityId?: string | null;
  tarifaOverride?: bigint | null;
  nota?: string | null;
  umbralExterno?: Umbral;
  /**
   * D-088. Motivo por el que esta retención NO se practica aunque la regla
   * exista y la base alcance (hoy: actividad no gravada). Gana sobre la
   * comparación de base mínima: si no está gravada, el umbral es irrelevante.
   */
  motivoNoAplicaForzado?: string | null;
  /**
   * D-088. Ventana del acumulador contra el que se compara la base mínima. Si
   * viene, la comparación es contra el ACUMULADO del periodo, no contra la base
   * de esta factura; la retención se sigue calculando sobre la base de ESTA
   * factura (asunción B: solo hacia adelante, nunca retroactivo).
   */
  acumulado?: ClaveAcumuladoIca;
}

async function liquidar(
  repo: RepositorioTributario,
  ctx: Contexto,
  retenciones: RetencionResuelta[],
  tipo: TipoRetencion,
  candidatas: readonly FilaTaxRule[],
  opciones: OpcionesLiquidacion,
): Promise<void> {
  const { regla, ambigua } = elegirRegla(candidatas);
  if (regla === null) {
    ctx.motivos.push(
      motivo(
        MOTIVO.SIN_REGLA,
        `No hay regla de ${tipo} vigente al ${ctx.entrada.fechaHechoEconomico} para el concepto ` +
          `${ctx.concepto.codigo}. Sin regla no hay tarifa, y el motor no la inventa.`,
      ),
    );
    return;
  }
  if (ambigua) {
    ctx.motivos.push(
      motivo(
        MOTIVO.REGLA_AMBIGUA,
        `Hay más de una regla de ${tipo} igual de específica y vigente al ` +
          `${ctx.entrada.fechaHechoEconomico}. Elegir una sería arbitrario.`,
      ),
    );
    return;
  }
  if (regla.account_id === null) {
    ctx.motivos.push(
      motivo(
        MOTIVO.REGLA_SIN_CUENTA,
        `La regla ${regla.id} no tiene cuenta PUC asignada; sin ella la retención no se puede ` +
          'registrar en el ledger ni trazar.',
      ),
    );
    return;
  }
  // D-089. La regla tiene cuenta, pero la cuenta no admite partidas: es de
  // agrupación en el PUC (`permite_movimiento = false`) o está inactiva. Sin
  // esto, el motor calcularía la retención y el documento moriría más tarde, en
  // el `INSERT` de la partida, con el LG004/LG009 crudo de la migración 179 —
  // un error de base de datos, en la cara del contador, sin decir qué regla lo
  // provocó. Aquí se convierte en un motivo de revisión manual que nombra la
  // regla, la cuenta y qué hacer.
  if (regla.cuenta_imputable === false) {
    ctx.motivos.push(
      motivo(
        MOTIVO.REGLA_CUENTA_NO_IMPUTABLE,
        `La regla de ${tipo} ${regla.id} apunta a la cuenta PUC ` +
          `${regla.cuenta_codigo ?? '(sin código)'} ${regla.cuenta_nombre ?? ''}`.trimEnd() +
          ', que no admite partidas: es una cuenta de agrupación o está inactiva. ' +
          'Reapunte la regla a la subcuenta que cuelga de ella en Parámetros › Tarifas. ' +
          'El motor no elige la subcuenta por su cuenta: eso es plan de cuentas, no cálculo.',
      ),
    );
    return;
  }

  const base = baseSegunRegla(ctx, regla);
  if (base === null) {
    ctx.motivos.push(
      motivo(MOTIVO.SIN_AIU, `La regla ${regla.id} liquida sobre AIU y el documento no lo trae.`),
    );
    return;
  }

  const filaRedondeo = await reglaRedondeo(repo, ctx, tipo);
  if (filaRedondeo === null) {
    ctx.motivos.push(
      motivo(
        MOTIVO.SIN_REDONDEO,
        `No hay regla de redondeo vigente al ${ctx.entrada.fechaHechoEconomico} para ${tipo}. ` +
          'El redondeo es un parámetro (Regla de Oro 5), no una decisión del código.',
      ),
    );
    return;
  }
  const redondeador = aRedondeador(filaRedondeo);

  const umbral = opciones.umbralExterno ?? umbralDe(regla, ctx.uvt);
  if (umbral.faltaUvt) {
    ctx.motivos.push(
      motivo(
        MOTIVO.SIN_UVT,
        `La base mínima de ${tipo} está expresada en UVT y no hay UVT vigente al ` +
          `${ctx.entrada.fechaHechoEconomico}.`,
      ),
    );
    return;
  }

  const tarifaEscalada = opciones.tarifaOverride ?? aEnteroEscalado(regla.tarifa, ESCALA_TARIFA)!;
  const notaOverride =
    opciones.tarifaOverride === null || opciones.tarifaOverride === undefined
      ? (opciones.nota ?? null)
      : [opciones.nota, `Tarifa tomada del override de third_party_activity.`]
          .filter((x) => x !== null && x !== undefined)
          .join(' ');

  // D-088. Contra qué se mide el mínimo. Por omisión, contra la base de esta
  // factura (todo lo anterior a D-088). Con acumulador, contra el acumulado del
  // periodo — que incluye ESTA factura: la que hace cruzar el umbral retiene.
  let baseComparada = base;
  let etiquetaBase = 'La base';
  let notaAcumulado: string | null = null;
  if (opciones.acumulado !== undefined && (opciones.motivoNoAplicaForzado ?? null) === null) {
    const acc = ctx.sesionIca.acumular(opciones.acumulado, base);
    baseComparada = acc.acumulado;
    etiquetaBase = 'El acumulado del periodo';
    notaAcumulado =
      `Base mínima medida POR PERIODO (${opciones.acumulado.periodoInicio} a ` +
      `${opciones.acumulado.periodoFin}): acumulado del tercero en el municipio ` +
      `${textoPesos(acc.acumulado)}, del que ${textoPesos(acc.previo)} venía de antes` +
      (acc.yaContado
        ? ' y este documento YA estaba contado (reproceso: no se suma dos veces).'
        : '.') +
      ' Si cruza el umbral se retiene sobre la base de esta factura, sin ajustar hacia atrás.';
  }

  // Sección 9.3: base bajo el mínimo -> no se retiene, PERO se registra la
  // evaluación y el porqué. Es lo que el contador necesita poder mirar.
  let motivoNoAplica: string | null = opciones.motivoNoAplicaForzado ?? null;
  if (
    motivoNoAplica === null &&
    umbral.valor !== null &&
    !superaUmbral(baseComparada, umbral.valor, regla.comparador_base_minima)
  ) {
    const comparador = regla.comparador_base_minima === 'mayor' ? 'superior a' : 'igual o superior a';
    motivoNoAplica =
      `${etiquetaBase} de ${textoPesos(baseComparada)} no alcanza la base mínima de la regla, que ` +
      `exige una base ${comparador} ${textoPesos(umbral.valor)}` +
      (umbral.baseMinimaUvt !== null ? ` (${umbral.baseMinimaUvt} UVT)` : '') +
      `. Norma: ${regla.norma_respaldo}.`;
  }

  retenciones.push(
    construir(ctx, {
      tipo,
      regla,
      base,
      tarifaEscalada,
      redondeador,
      umbral,
      accountId: regla.account_id,
      municipalityId: opciones.municipalityId ?? null,
      ciiuActivityId: opciones.ciiuActivityId ?? null,
      // Regla de Oro 6: la traza dice también con qué acumulado se decidió.
      nota: [notaOverride, notaAcumulado].filter((x) => x !== null && x !== '').join(' ') || null,
      motivoNoAplica,
    }),
  );
}

/**
 * Registra una evaluación que no se practica por razón del tercero (SIMPLE,
 * autorretenedor, no responsable de IVA). Se busca la regla igual, para que la
 * traza diga contra qué regla se evaluó y con qué vigencia.
 */
async function registrarNoPracticada(
  repo: RepositorioTributario,
  ctx: Contexto,
  retenciones: RetencionResuelta[],
  tipo: TipoRetencion,
  taxConceptId: string,
  razon: string,
): Promise<void> {
  const candidatas =
    tipo === 'retefuente'
      ? await repo.reglasRetefuente(
          ctx.empresa,
          {
            taxConceptId,
            esDeclarante: ctx.atributos.es_declarante_renta,
            tipoPersona: ctx.tercero.tipo_persona,
          },
          ctx.entrada.fechaHechoEconomico,
        )
      : await repo.reglasPorConcepto(ctx.empresa, tipo, taxConceptId, ctx.entrada.fechaHechoEconomico);

  const { regla } = elegirRegla(candidatas);
  if (regla === null || regla.account_id === null) return;

  const filaRedondeo = await reglaRedondeo(repo, ctx, tipo);
  if (filaRedondeo === null) return;

  const base = baseSegunRegla(ctx, regla);
  if (base === null) return;

  retenciones.push(
    construir(ctx, {
      tipo,
      regla,
      base,
      tarifaEscalada: aEnteroEscalado(regla.tarifa, ESCALA_TARIFA)!,
      redondeador: aRedondeador(filaRedondeo),
      umbral: umbralDe(regla, ctx.uvt),
      accountId: regla.account_id,
      motivoNoAplica: razon,
    }),
  );
}

// -----------------------------------------------------------------------------
// Agregación por tipo + regla + cuenta: lo que se convierte en partidas.
// -----------------------------------------------------------------------------
export function agregar(retenciones: readonly RetencionResuelta[]): RetencionAgregada[] {
  const mapa = new Map<string, RetencionAgregada>();
  for (const r of retenciones) {
    if (!r.aplicada || r.valor === 0) continue;
    const clave = `${r.tipo}|${r.regla.taxRuleId}|${r.accountId}`;
    const previo = mapa.get(clave);
    if (previo) {
      previo.base += r.base;
      previo.valor += r.valor;
    } else {
      mapa.set(clave, {
        tipo: r.tipo,
        accountId: r.accountId,
        regla: r.regla,
        base: r.base,
        valor: r.valor,
        tarifa: r.tarifa,
        normaRespaldo: r.normaRespaldo,
      });
    }
  }
  return [...mapa.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, v]) => v);
}

// -----------------------------------------------------------------------------
// LA FUNCIÓN DE LA SECCIÓN 9.1
// -----------------------------------------------------------------------------
export async function resolverRetenciones(
  repo: RepositorioTributario,
  entrada: EntradaResolucion,
  /**
   * D-088. Sesión de acumuladores compartida. La pasa `resolverFactura` para
   * que los varios grupos de concepto de UNA factura sumen sobre el mismo
   * acumulado en vez de leer cada uno el estado antiguo de la base. Si no
   * viene, esta resolución abre la suya.
   */
  sesionCompartida?: SesionAcumuladosIca,
): Promise<ResultadoResolucion> {
  const sesionIca =
    sesionCompartida ?? new SesionAcumuladosIca(repo, entrada.sourceDocumentId ?? null);
  const ctx = await abrirContexto(repo, entrada, sesionIca);
  if ('retenciones' in ctx) return ctx;

  const retenciones: RetencionResuelta[] = [];
  await resolverRetefuente(repo, ctx, retenciones);
  await resolverReteiva(repo, ctx, retenciones);
  await resolverReteica(repo, ctx, retenciones);
  await resolverAutorretencion(repo, ctx, retenciones);

  return {
    retenciones,
    agregados: agregar(retenciones),
    requiereRevisionManual: ctx.motivos.length > 0,
    motivosRevision: ctx.motivos,
    // Con sesión compartida los efectos los reporta `resolverFactura` una sola
    // vez, no cada grupo de concepto.
    acumuladosIca: sesionCompartida === undefined ? sesionIca.efectos() : [],
    huella: huellaDe(retenciones, ctx.motivos),
  };
}

/**
 * Factura con varias líneas de conceptos distintos (sección 9.3, caso 14).
 *
 * Las líneas se AGRUPAN POR CONCEPTO antes de resolver: la base mínima se mide
 * contra la base del concepto en la factura, no línea por línea. Partir una
 * compra en tres líneas no puede hacer que ninguna alcance el mínimo y la
 * factura deje de retener.
 */
export async function resolverFactura(
  repo: RepositorioTributario,
  factura: EntradaFactura,
): Promise<ResultadoResolucion> {
  const grupos = agruparPorConcepto(factura.lineas, factura.municipioOperacionId);
  const retenciones: RetencionResuelta[] = [];
  const motivos: MotivoRevision[] = [];
  // D-088: UNA sesión para toda la factura. Dos grupos de concepto en el mismo
  // municipio y con la misma naturaleza suman al mismo acumulado, y el efecto
  // que se persiste es uno solo por ventana.
  const sesionIca = new SesionAcumuladosIca(repo, factura.sourceDocumentId ?? null);

  for (const grupo of grupos) {
    const parcial = await resolverRetenciones(
      repo,
      {
        companyId: factura.companyId,
        terceroId: factura.terceroId,
        conceptoId: grupo.conceptoId,
        municipioOperacionId: grupo.municipioOperacionId,
        baseGravable: grupo.baseGravable,
        valorIva: grupo.valorIva,
        fechaHechoEconomico: factura.fechaHechoEconomico,
        valorAiu: grupo.valorAiu,
        tipoOperacionIca: grupo.tipoOperacionIca,
        sourceDocumentId: factura.sourceDocumentId ?? null,
      },
      sesionIca,
    );
    retenciones.push(...parcial.retenciones);
    motivos.push(...parcial.motivosRevision);
  }

  return {
    retenciones,
    agregados: agregar(retenciones),
    requiereRevisionManual: motivos.length > 0,
    motivosRevision: motivos,
    acumuladosIca: sesionIca.efectos(),
    huella: huellaDe(retenciones, motivos),
  };
}

interface GrupoConcepto {
  conceptoId: string;
  municipioOperacionId: string | null;
  baseGravable: number;
  valorIva: number;
  valorAiu: number | null;
  tipoOperacionIca: TipoOperacionIca | null;
}

function agruparPorConcepto(
  lineas: readonly LineaFactura[],
  municipioFactura: string | null,
): GrupoConcepto[] {
  const mapa = new Map<string, GrupoConcepto>();
  for (const l of lineas) {
    const municipio = l.municipioOperacionId ?? municipioFactura;
    const clave = `${l.conceptoId}|${municipio ?? ''}`;
    const previo = mapa.get(clave);
    if (previo) {
      previo.baseGravable += l.baseGravable;
      previo.valorIva += l.valorIva;
      if (l.valorAiu !== null && l.valorAiu !== undefined) {
        previo.valorAiu = (previo.valorAiu ?? 0) + l.valorAiu;
      }
      previo.tipoOperacionIca ??= l.tipoOperacionIca ?? null;
    } else {
      mapa.set(clave, {
        conceptoId: l.conceptoId,
        municipioOperacionId: municipio,
        baseGravable: l.baseGravable,
        valorIva: l.valorIva,
        valorAiu: l.valorAiu ?? null,
        tipoOperacionIca: l.tipoOperacionIca ?? null,
      });
    }
  }
  return [...mapa.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, v]) => v);
}

export type { FechaIso };

/**
 * A16 — Los tres motivos por los que un reporte no sale, y por qué NUNCA son
 * el mismo mensaje (Ola 4, Tarea 6).
 *
 * PROBLEMA QUE CIERRA. Hasta esta ola, pedir un reporte de una empresa recién
 * abierta devolvía un `.xlsx` con la hoja «Datos» vacía y ninguna explicación,
 * o —cuando faltaba una cuenta— un JSON con el mensaje crudo de PostgreSQL. Un
 * contador que ve un libro vacío no puede saber si es que no hubo movimiento en
 * marzo, si es que nadie ha cargado el PUC, o si la base se cayó. Las tres
 * cosas exigen que haga algo distinto, y una de las tres no es culpa suya.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * D-073 — TRES CASOS, TRES CLASES DE ERROR, TRES MENSAJES
 *
 *  1. `ConfiguracionFaltanteError` — falta algo SIN LO CUAL EL REPORTE NO
 *     PUEDE EXISTIR: ninguna cuenta imputable en el PUC, o una cuenta o un
 *     tercero que no están en esta empresa. Lleva dentro `enlace`: la ruta
 *     EXACTA donde se arregla. No es un error del sistema: es una tarea
 *     pendiente, y el mensaje dice cuál y dónde.
 *
 *     Lo que falta pero NO impide generar el archivo (el mapeo NIIF, el de
 *     exógena) no llega por aquí: son `avisosDeConfiguracion`, se enseñan en
 *     `/reportes` ANTES de pedir el reporte, y el archivo se descarga igual
 *     con su advertencia dentro. Ver el bloque de comentarios de esa función.
 *
 *  2. `SinDatosEnRangoError` — la configuración está completa y sencillamente
 *     no hubo movimiento en ese rango, o ese tercero no tiene nada. NO es un
 *     error: es una respuesta. Se dice con las fechas y el nombre dentro, para
 *     que el contador confirme que preguntó lo que quería preguntar. A un
 *     NAVEGADOR se le responde con esa frase; a un programa que pide el
 *     archivo se le entrega el archivo (vacío pero válido), porque el criterio
 *     de salida de la Ola 3 dice que todo reporte se descarga.
 *
 *  3. Cualquier otra cosa — fallo técnico. Al usuario, un mensaje genérico con
 *     una referencia; a los registros del servidor, el detalle. Enseñar un
 *     `relation "x" does not exist` o un `connection refused` en pantalla no
 *     ayuda a nadie y sí le cuenta a un atacante cómo está montado el sistema.
 *
 * El motivo de fondo es el mismo de la advertencia 17.5: lo que falta se ve,
 * no se rellena en silencio ni se disfraza de «no hay datos».
 * ─────────────────────────────────────────────────────────────────────────
 */
import type { SqlClient } from '../db/types';

export type MotivoReporte = 'configuracion_faltante' | 'sin_datos' | 'error';

/**
 * Caso 1: falta configuración obligatoria. Lleva la ruta donde se arregla.
 */
export class ConfiguracionFaltanteError extends Error {
  readonly motivo: MotivoReporte = 'configuracion_faltante';
  /** Qué falta, en una frase. */
  readonly falta: string;
  /** Ruta del módulo donde se carga. */
  readonly enlace: string;
  /** Texto del enlace. */
  readonly enlaceTexto: string;

  constructor(opciones: { falta: string; enlace: string; enlaceTexto: string; detalle?: string }) {
    super(
      `${opciones.falta}${opciones.detalle ? ` ${opciones.detalle}` : ''} ` +
        `Cárguelo en ${opciones.enlace} y vuelva a pedir el reporte.`,
    );
    this.name = 'ConfiguracionFaltanteError';
    this.falta = opciones.falta;
    this.enlace = opciones.enlace;
    this.enlaceTexto = opciones.enlaceTexto;
  }
}

/**
 * Caso 2: la configuración está, pero no hay movimiento. Es una respuesta, no
 * un fallo — por eso el mensaje repite exactamente lo que se preguntó.
 */
export class SinDatosEnRangoError extends Error {
  readonly motivo: MotivoReporte = 'sin_datos';
  readonly reporte: string;
  readonly criterios: string;

  constructor(reporte: string, criterios: string) {
    super(
      `No hay datos para ${criterios}. El reporte «${reporte}» saldría con la hoja de datos vacía: ` +
        'no es un error del sistema ni le falta a usted ninguna configuración, sencillamente no hay ' +
        'movimiento que mostrar con esos criterios.',
    );
    this.name = 'SinDatosEnRangoError';
    this.reporte = reporte;
    this.criterios = criterios;
  }
}

/** Describe en una frase lo que se pidió, para el mensaje del caso 2. */
export function describirCriterios(partes: Record<string, string | null | undefined>): string {
  const trozos = Object.entries(partes)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k} ${v}`);
  return trozos.length > 0 ? trozos.join(', ') : 'los criterios indicados';
}

// =============================================================================
// COMPROBACIONES DE CONFIGURACIÓN
//
// Todas son de SOLO LECTURA y todas corren dentro de la sesión verificada, así
// que lo que cuentan es lo que esa empresa ve — no el total de la base.
// =============================================================================

/**
 * ¿Hay al menos una cuenta activa donde imputar en el PUC efectivo de esta
 * empresa? Es la precondición de TODOS los reportes: sin cuentas imputables no
 * hay partidas posibles, y un libro vacío por esta razón no es «no hubo
 * movimiento», es «este sistema todavía no está configurado».
 */
export async function exigirPucCargado(tx: SqlClient): Promise<void> {
  const { rows } = await tx.query<{ n: string }>(
    'SELECT count(*) AS n FROM v_account_efectivo WHERE activo AND permite_movimiento',
  );
  if (Number(rows[0]?.n ?? 0) === 0) {
    throw new ConfiguracionFaltanteError({
      falta: 'Esta empresa no tiene ninguna cuenta del plan de cuentas (PUC) donde se pueda imputar.',
      detalle:
        'Sin PUC no hay partidas posibles, así que cualquier libro saldría vacío por una razón que no tiene ' +
        'nada que ver con el período que pidió.',
      enlace: '/parametros/puc',
      enlaceTexto: 'Plan de cuentas',
    });
  }
}

/**
 * ¿Existe la cuenta que se pidió? Distingue tres cosas que el usuario vive
 * distinto: no hay PUC, la cuenta no existe en ESTE PUC, o la cuenta existe y
 * no tuvo movimiento.
 */
export async function exigirCuentaExistente(tx: SqlClient, accountId: string): Promise<void> {
  await exigirPucCargado(tx);
  const { rows } = await tx.query<{ id: string }>('SELECT id FROM v_account_efectivo WHERE id = $1', [accountId]);
  if (!rows[0]) {
    throw new ConfiguracionFaltanteError({
      falta: `La cuenta ${accountId} no existe en el plan de cuentas de esta empresa.`,
      detalle: 'Búsquela por código en el plan de cuentas y copie de allí su identificador.',
      enlace: '/parametros/puc',
      enlaceTexto: 'Plan de cuentas',
    });
  }
}

/**
 * AVISOS DE CONFIGURACIÓN QUE NO BLOQUEAN LA DESCARGA, Y POR QUÉ NO LO HACEN.
 *
 * La primera versión de este archivo (A16) bloqueaba con 409 los estados
 * financieros sin `niif_mapping` y los formatos de exógena sin
 * `exogena_account_mapping`. Era un error, y lo destapó la compuerta de la Ola
 * 3 de A14: A10 y A11 YA contemplan que falte el mapeo. A10 cae al nombre del
 * grupo PUC como rótulo y deja una advertencia en la hoja «Papel de trabajo»
 * (`src/reports/estados/libros.ts`); A11 dice explícitamente que el saldo solo
 * sale si el contador mapeó las cuentas. Bloquear la descarga era sustituir un
 * comportamiento ya diseñado —y bien— por un rechazo, y encima rompía el
 * criterio de salida «todo reporte se descarga en Excel».
 *
 * Así que estos dos casos NO son errores: son AVISOS. Se muestran en
 * `/reportes` antes de pedir el reporte, con el enlace donde se cargan, y el
 * archivo se descarga igual con su advertencia dentro.
 *
 * Lo que sí sigue siendo bloqueante es `exigirPucCargado`: sin ninguna cuenta
 * imputable no hay partidas posibles, y ningún generador tiene manera de
 * apañárselo.
 */
export interface AvisoConfiguracion {
  falta: string;
  detalle: string;
  enlace: string;
  enlaceTexto: string;
  /** Reportes a los que afecta, para poder decírselo al usuario. */
  afectaA: string;
}

export async function avisosDeConfiguracion(tx: SqlClient): Promise<AvisoConfiguracion[]> {
  const avisos: AvisoConfiguracion[] = [];

  const { rows: puc } = await tx.query<{ n: string }>(
    'SELECT count(*) AS n FROM v_account_efectivo WHERE activo AND permite_movimiento',
  );
  if (Number(puc[0]?.n ?? 0) === 0) {
    avisos.push({
      falta: 'Esta empresa no tiene ninguna cuenta del PUC donde se pueda imputar.',
      detalle:
        'Sin PUC no hay partidas posibles: TODOS los reportes salen vacíos, y no por el período que pida ' +
        'sino porque el sistema todavía no está configurado.',
      enlace: '/parametros/puc',
      enlaceTexto: 'Plan de cuentas',
      afectaA: 'todos los reportes',
    });
  }

  const { rows: niif } = await tx.query<{ n: string }>(
    'SELECT count(*) AS n FROM niif_mapping WHERE vigente_hasta IS NULL',
  );
  if (Number(niif[0]?.n ?? 0) === 0) {
    avisos.push({
      falta: 'No hay ningún mapeo de cuentas PUC a NIIF para las PYMES.',
      detalle:
        'Los estados financieros se descargan igual, pero rotulan cada rubro con el nombre del grupo del PUC ' +
        'en vez del rubro NIIF, y lo advierten dentro del propio archivo. Para presentarlos hace falta el mapeo.',
      enlace: '/carga-masiva/niif_mapping',
      enlaceTexto: 'Cargar el mapeo NIIF',
      afectaA: 'los cinco estados financieros',
    });
  }

  const { rows: exogena } = await tx.query<{ n: string }>(
    'SELECT count(*) AS n FROM exogena_account_mapping WHERE vigente_hasta IS NULL',
  );
  if (Number(exogena[0]?.n ?? 0) === 0) {
    avisos.push({
      falta: 'No hay ningún mapeo de cuentas PUC a los conceptos de información exógena.',
      detalle:
        'Los formatos que dependen de ese mapeo (saldos de cuentas por cobrar y por pagar, IVA y retenciones ' +
        'practicadas a la empresa) saldrán sin esas filas. Los demás formatos no lo necesitan.',
      enlace: '/parametros',
      enlaceTexto: 'Parámetros',
      afectaA: 'los formatos 1008 y 1009 y parte del 1001',
    });
  }

  return avisos;
}

/** El tercero que se pidió, para poder nombrarlo en el mensaje de «sin datos». */
export async function nombreDeTercero(tx: SqlClient, terceroId: string | null): Promise<string | null> {
  if (!terceroId) return null;
  const { rows } = await tx.query<{ razon_social: string; numero_documento: string }>(
    'SELECT razon_social, numero_documento FROM third_party WHERE id = $1',
    [terceroId],
  );
  const t = rows[0];
  if (!t) {
    throw new ConfiguracionFaltanteError({
      falta: `El tercero ${terceroId} no existe en esta empresa (o su sesión no lo ve).`,
      detalle: 'Compruebe que copió el identificador correcto y que está trabajando sobre la empresa correcta.',
      enlace: '/terceros',
      enlaceTexto: 'Terceros',
    });
  }
  return `${t.razon_social} (${t.numero_documento})`;
}

/**
 * ¿El libro que se acaba de generar trae alguna fila?
 *
 * Se comprueba sobre el libro YA CONSTRUIDO y no consultando otra vez la base:
 * así vale para los veintiún reportes sin tocar ni uno de los generadores, y
 * sobre todo no puede desincronizarse — lo que se mira es exactamente lo que
 * el usuario iba a recibir.
 */
export function libroTieneFilas(workbook: {
  getWorksheet(nombre: string): { rowCount: number } | undefined;
}): boolean {
  const hoja = workbook.getWorksheet('Datos');
  if (!hoja) return true; // Sin hoja «Datos» no se puede juzgar: se entrega.
  return hoja.rowCount > 1; // La fila 1 son los encabezados.
}

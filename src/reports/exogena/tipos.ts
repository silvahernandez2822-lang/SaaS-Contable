/**
 * A11 — Información exógena (sección 7.7 del mega-prompt). Formas de la
 * respuesta, nunca valores: igual que `src/reports/tipos.ts`. Ningún tope,
 * tarifa ni código numérico de la DIAN nace en este archivo (Regla de Oro 2 y
 * advertencia 17.5): lo que la sección 7.7 no trae verificado se deja `null`
 * y se documenta como pendiente, nunca se rellena con un valor inventado.
 */

/** Identificación del tercero informado, exactamente como la exige el
 * Formato 1001 (art. 1.3.5.2.1 Res. 000227/2025) y, en menor medida, los
 * demás formatos de la sección 7.7. Los campos vienen crudos de `third_party`
 * (tal como los capturó — o no — quien creó el tercero): esta forma NO
 * traduce `tipoDocumento` a un código numérico DIAN (13, 31, 42, ...) porque
 * esa tabla de equivalencias no está verificada en la sección 7.7 ni en
 * ningún otro documento que este agente pudiera consultar (advertencia
 * 17.5); usar el texto crudo evita inventar un código que la DIAN rechace o,
 * peor, que clasifique mal al tercero. */
export interface IdentificacionTercero {
  terceroId: string;
  tipoDocumento: string;
  numeroDocumento: string;
  digitoVerificacion: number | null;
  primerApellido: string | null;
  segundoApellido: string | null;
  primerNombre: string | null;
  otrosNombres: string | null;
  razonSocial: string;
  tipoPersona: 'natural' | 'juridica';
  /** `null` = no capturada. Es exactamente el dato del bloqueo que este
   * agente reporta: el Formato 1001 la exige desde la creación del tercero. */
  direccion: string | null;
  /** DIVIPOLA de 2 dígitos (`municipality.codigo_dane_departamento`). */
  codigoDepartamento: string | null;
  /** DIVIPOLA de 5 dígitos (`third_party.codigo_dane`, denormalizado). */
  codigoMunicipio: string | null;
  pais: string;
  esDelExterior: boolean;
}

/** Un tercero al que le falta un dato que el Formato 1001 exige desde su
 * creación. No se omite ni se rellena: se lista para que el contador (y,
 * estructuralmente, A2/A8) lo resuelvan antes de presentar. */
export interface TerceroIncompleto {
  terceroId: string;
  numeroDocumento: string;
  razonSocial: string;
  faltaDireccion: boolean;
  faltaMunicipio: boolean;
}

export interface RangoExogena {
  desde: string;
  hasta: string;
  anioGravable: number;
}

/** Formato 1001 — pagos o abonos en cuenta y retenciones practicadas, por tercero. */
export interface FilaFormato1001 {
  tercero: IdentificacionTercero;
  /** Suma de TODAS las partidas de crédito del tercero en el período
   * (contrapartida + retenciones): por la partida doble, es el mismo valor
   * que la suma de las partidas de débito de esas mismas causaciones — el
   * "valor del pago o abono en cuenta" sin necesidad de leer una segunda
   * fuente que pudiera divergir del ledger. */
  valorPagoOAbono: string;
  valorRetefuente: string;
  valorReteiva: string;
  valorReteica: string;
  numeroOperaciones: number;
}

/** Formato 1003 — retenciones que le practicaron a la empresa informante. */
export interface FilaFormato1003 {
  tercero: IdentificacionTercero;
  /** Siempre `'autorretencion'` en esta versión: es la única dirección de
   * "retención que le practicaron a la empresa" que el motor de reglas
   * calcula (sección 9). Ver advertencia en `formatos.ts` sobre el resto. */
  tipo: string;
  base: string;
  valor: string;
  numeroOperaciones: number;
}

/** Formato 1005 (IVA descontable) y 1006 (IVA generado) — misma forma. */
export interface FilaFormatoIva {
  tercero: IdentificacionTercero | null;
  valorIva: string;
  numeroOperaciones: number;
}

/** Formato 1007 — ingresos recibidos, por tercero (clasificación NIIF 'ingreso'). */
export interface FilaFormato1007 {
  tercero: IdentificacionTercero | null;
  valorIngreso: string;
  numeroOperaciones: number;
}

/** Formato 1008 (cuentas por cobrar) y 1009 (cuentas por pagar) — saldo al corte. */
export interface FilaFormatoSaldo {
  tercero: IdentificacionTercero | null;
  saldoCorte: string;
  cuentaCodigo: string;
  cuentaNombre: string;
}

/** Resultado de un generador de formato: los datos, el bloqueo de terceros
 * incompletos (si lo hay) y las advertencias de cobertura de datos. Ningún
 * generador lanza una excepción por datos incompletos: el bloqueo se
 * REPORTA en esta forma para que la interfaz lo muestre, no se omite ni se
 * detiene la generación del resto del archivo. */
export interface ResultadoExogena<TFila> {
  formatoCodigo: string;
  filas: TFila[];
  tercerosIncompletos: TerceroIncompleto[];
  advertencias: string[];
}

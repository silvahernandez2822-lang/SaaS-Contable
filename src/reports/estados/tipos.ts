/**
 * A10 — Estados financieros bajo NIIF para las PYMES (Grupo 2). Formas de la
 * respuesta, nunca valores: igual que `src/reports/tipos.ts`, aquí no nace
 * ninguna cifra. Todo importe llega de la base en centavos y viaja como texto
 * (`bigint::text`) o `BigInt`, jamás como `number` (Regla de Oro 5).
 */

/** Las clasificaciones NIIF del CHECK de `niif_mapping` (003_catalogos_contables.sql). */
export type ClasificacionNiif =
  | 'activo_corriente'
  | 'activo_no_corriente'
  | 'pasivo_corriente'
  | 'pasivo_no_corriente'
  | 'patrimonio'
  | 'ingreso'
  | 'costo'
  | 'gasto'
  | 'otro_resultado_integral'
  | 'cuenta_de_orden';

/** Una cuenta con saldo, ya resuelta contra el mapeo NIIF. Fila cruda de la hoja "Datos". */
export interface SaldoCuenta {
  accountId: string;
  cuentaCodigo: string;
  cuentaNombre: string;
  cuentaNaturaleza: 'debito' | 'credito';
  /** `null` = ninguna cuenta de su rama tiene mapeo NIIF vigente en la fecha. */
  clasificacionNiif: ClasificacionNiif | null;
  seccionNiif: string | null;
  /** Rótulo de presentación: `niif_mapping.rubro_*` si el contador lo declaró; si no, el nombre del grupo PUC. */
  rubro: string;
  grupoCodigo: string;
  grupoNombre: string | null;
  /** `'directa'` (mapeo de la cuenta misma), `'heredada'` (de un ancestro del PUC) o `'sin_mapeo'`. */
  resolucionNiif: 'directa' | 'heredada' | 'sin_mapeo';
  origenCodigo: string | null;
  /** Vigencia del mapeo NIIF aplicado (Regla de Oro 3: se resuelve por la fecha del hecho). */
  vigenteDesde: string | null;
  vigenteHasta: string | null;
  normaRespaldo: string | null;
  requiereVerificacionHumana: boolean;
  /** Saldo acumulado al corte, en centavos, con signo deudor positivo. */
  saldoFinal: string;
  /** Saldo al día anterior a `desde`, en centavos, signo deudor positivo. */
  saldoInicial: string;
  debitos: string;
  creditos: string;
}

/** Un renglón de un estado financiero ya agregado. */
export interface RenglonEstado {
  seccion: string;
  rubro: string;
  codigoOrden: string;
  /** Importe de presentación en centavos: positivo = el signo natural del rubro. */
  valor: string;
  valorComparativo: string | null;
  /** Nivel de anidación para el papel de trabajo: 0 = total, 1 = sección, 2 = rubro. */
  nivel: number;
  /** Marca las partidas que el contador debe revisar antes de firmar. */
  advertencia: string | null;
}

/** Estado de Situación Financiera (NIIF para las PYMES, sección 4). */
export interface EstadoSituacionFinanciera {
  fechaCorte: string;
  fechaCorteComparativa: string | null;
  renglones: RenglonEstado[];
  detalle: SaldoCuenta[];
  totalActivo: string;
  totalPasivo: string;
  totalPatrimonio: string;
  /**
   * Resultado del ejercicio todavía NO cerrado contra patrimonio. Se calcula
   * como el inverso del saldo neto de las cuentas de resultado al corte: si el
   * cierre ya se publicó, ese saldo es cero y este renglón también.
   */
  resultadoNoCerrado: string;
  /** Saldo neto de las cuentas con saldo que NADIE ha clasificado (signo acreedor positivo). */
  totalSinClasificar: string;
  /** Activo − Pasivo − Patrimonio − resultado no cerrado − sin clasificar. Debe ser cero. */
  descuadre: string;
  cuentasSinClasificar: SaldoCuenta[];
}

/** Presentación del Estado de Resultado Integral (sección 5.11). */
export type PresentacionEri = 'funcion' | 'naturaleza';

/** Estado de Resultado Integral (NIIF para las PYMES, sección 5). */
export interface EstadoResultadoIntegral {
  desde: string;
  hasta: string;
  presentacion: PresentacionEri;
  renglones: RenglonEstado[];
  detalle: SaldoCuenta[];
  totalIngresos: string;
  totalCostos: string;
  totalGastos: string;
  resultadoDelPeriodo: string;
  otroResultadoIntegral: string;
  resultadoIntegralTotal: string;
  /** Desglose por naturaleza exigido por 5.11(b) cuando se presenta por función. */
  desgloseNaturaleza: RenglonEstado[];
  cuentasSinClasificar: SaldoCuenta[];
}

/** Movimiento de un componente del patrimonio dentro del período. */
export interface MovimientoPatrimonio {
  accountId: string;
  componenteCodigo: string;
  componenteNombre: string;
  cuentaCodigo: string;
  cuentaNombre: string;
  saldoInicial: string;
  aumentos: string;
  disminuciones: string;
  saldoFinal: string;
  /** Se llena a mano: NIIF para las PYMES 6.3(a) exige separar corrección de errores y cambios de política. */
  naturalezaDelCambio: string;
}

/** Estado de Cambios en el Patrimonio (NIIF para las PYMES, sección 6). */
export interface EstadoCambiosPatrimonio {
  desde: string;
  hasta: string;
  movimientos: MovimientoPatrimonio[];
  saldoInicialTotal: string;
  resultadoDelPeriodo: string;
  saldoFinalTotal: string;
  /** Asientos que tocaron patrimonio en el período, para que el contador los clasifique. */
  asientosDePatrimonio: AsientoPatrimonio[];
}

export interface AsientoPatrimonio {
  journalEntryId: string;
  asientoNumero: string;
  asientoTipo: string;
  fecha: string;
  descripcion: string;
  cuentaCodigo: string;
  cuentaNombre: string;
  side: 'debito' | 'credito';
  monto: string;
}

/** Actividad del Estado de Flujos de Efectivo (sección 7.3). */
export type ActividadEfe = 'operacion' | 'inversion' | 'financiacion' | 'sin_clasificar';

/** Una partida del EFE por método directo: el contramovimiento de una línea de efectivo. */
export interface PartidaFlujo {
  journalEntryId: string;
  asientoNumero: string;
  fecha: string;
  cuentaCodigo: string;
  cuentaNombre: string;
  rubro: string;
  actividad: ActividadEfe;
  /** `'declarada'` (el contador la fijó en `niif_mapping.rubro_efe`) o `'presumida'`. */
  actividadOrigen: 'declarada' | 'presumida' | 'sin_mapeo';
  /** Flujo de efectivo en centavos: positivo = entrada de efectivo. */
  flujo: string;
  terceroRazonSocial: string | null;
}

/** Estado de Flujos de Efectivo, método directo (NIIF para las PYMES, sección 7). */
export interface EstadoFlujosEfectivo {
  desde: string;
  hasta: string;
  /** Cuentas marcadas como efectivo y equivalentes en `niif_mapping.rubro_efe`. */
  cuentasEfectivo: { accountId: string; codigo: string; nombre: string }[];
  /** `true` cuando ninguna cuenta está marcada: el libro sale solo con el papel de trabajo. */
  sinCuentasDeEfectivoMarcadas: boolean;
  /** Cuentas candidatas a efectivo, para que el contador las marque (juicio de 7.2). */
  candidatasEfectivo: SaldoCuenta[];
  partidas: PartidaFlujo[];
  renglones: RenglonEstado[];
  flujoOperacion: string;
  flujoInversion: string;
  flujoFinanciacion: string;
  flujoNeto: string;
  efectivoInicial: string;
  efectivoFinal: string;
  /** efectivoInicial + flujoNeto − efectivoFinal. Debe ser cero. */
  descuadre: string;
  /** Cuántas partidas se clasificaron por presunción y esperan confirmación humana. */
  partidasPresumidas: number;
}

/**
 * A10 — Estructura de las notas a los estados financieros, con las
 * revelaciones mínimas del Grupo 2 (NIIF para las PYMES, Decreto 2420 de 2015
 * y sus modificatorios).
 *
 * ESTE ARCHIVO NO REDACTA NINGUNA REVELACIÓN. Declara el ÍNDICE de notas, qué
 * exige la norma en cada una, qué parte puede armar el sistema con datos del
 * ledger y qué parte tiene que escribir el contador. Es deliberado y es lo más
 * importante del módulo:
 *
 *   Una política contable, un juicio significativo o una fuente de
 *   incertidumbre en una estimación NO son deducibles de un asiento contable.
 *   Un sistema que los rellenara con una plantilla estaría poniendo en boca del
 *   contador una afirmación que él no hizo, sobre unos estados financieros que
 *   él firma. Es exactamente la advertencia 17.5 del mega-prompt («ningún
 *   agente inventa un valor») aplicada a las revelaciones: una nota inventada
 *   es peor que una nota vacía, porque la vacía se ve y la inventada no.
 *
 * Lo que sí hace el sistema por el contador: dejarle el papel de trabajo con
 * la nota planteada, la referencia normativa, el dato del ledger que la
 * sustenta cuando existe, y la celda en blanco donde escribir.
 */

/** Quién produce el contenido de la nota. */
export type OrigenNota =
  /** El sistema la arma completa desde el ledger; el contador solo revisa. */
  | 'automatica'
  /** El sistema aporta las cifras; el contador aporta la redacción o el criterio. */
  | 'mixta'
  /** Solo el contador. El sistema no tiene de dónde deducirla. */
  | 'manual';

export interface NotaEstadosFinancieros {
  codigo: string;
  titulo: string;
  /** Referencia a la sección de NIIF para las PYMES que la exige. */
  referencia: string;
  origen: OrigenNota;
  /** Qué pide la norma, en los términos de la norma. */
  exigencia: string;
  /** Qué pone el sistema, si pone algo. */
  aportaElSistema: string;
  /** Qué tiene que escribir el contador. Vacío solo en las automáticas. */
  completaElContador: string;
}

/**
 * ÍNDICE DE NOTAS. El orden es el de presentación habitual y el que pide la
 * sección 8.4: primero la declaración de cumplimiento y las bases, después las
 * políticas, después los juicios y las estimaciones, y al final la
 * desagregación de las partidas de cada estado, en el mismo orden en que
 * aparecen en los estados (sección 8.3).
 */
export const ESTRUCTURA_NOTAS: readonly NotaEstadosFinancieros[] = [
  {
    codigo: 'N1',
    titulo: 'Entidad que reporta e información general',
    referencia: 'Sección 3 (3.24) — Identificación de los estados financieros',
    origen: 'mixta',
    exigencia:
      'Identificar de forma destacada el nombre de la entidad, si los estados son de una entidad individual o de un grupo, la fecha de cierre y el período cubierto, la moneda de presentación y el grado de redondeo.',
    aportaElSistema:
      'Razón social, NIT, período y fecha de generación (van en el encabezado obligatorio de toda hoja "Papel de trabajo"). Moneda de presentación: peso colombiano; importes en pesos, sin redondeo (el ledger guarda centavos enteros).',
    completaElContador:
      'Domicilio legal y forma jurídica, país de constitución, dirección de la sede principal, descripción de la naturaleza de las operaciones y de las actividades principales, y si los estados son individuales o consolidados.',
  },
  {
    codigo: 'N2',
    titulo: 'Bases de preparación y declaración de cumplimiento',
    referencia: 'Sección 3 (3.3) y Sección 8 (8.5(a))',
    origen: 'manual',
    exigencia:
      'Declaración explícita y sin reservas de que los estados financieros cumplen la NIIF para las PYMES, y descripción de la base de medición utilizada.',
    aportaElSistema:
      'Nada. La declaración de cumplimiento es una afirmación del preparador sobre sus propios estados: el sistema no puede emitirla en su nombre, y si la emitiera la estaría falsificando.',
    completaElContador:
      'La declaración de cumplimiento (o la explicación de por qué no se puede hacer sin reservas), el marco técnico normativo aplicado con su decreto, la base de medición (costo histórico y sus excepciones) y el supuesto de negocio en marcha con su evaluación (3.8-3.9).',
  },
  {
    codigo: 'N3',
    titulo: 'Resumen de las políticas contables significativas',
    referencia: 'Sección 8 (8.5(b))',
    origen: 'manual',
    exigencia:
      'Revelar las políticas contables significativas utilizadas: la base de medición y las demás políticas relevantes para comprender los estados financieros.',
    aportaElSistema:
      'El listado de las secciones de NIIF para las PYMES que están efectivamente en juego según las cuentas con saldo (se incluye como hoja de apoyo), para que ninguna política aplicable se quede sin redactar. El texto de cada política, no: una política contable es una elección de la entidad entre alternativas admitidas.',
    completaElContador:
      'La redacción de cada política aplicable: efectivo y equivalentes, instrumentos financieros básicos, inventarios, propiedades planta y equipo con vidas útiles y método de depreciación, deterioro, provisiones, ingresos de actividades ordinarias, impuesto a las ganancias, y las demás que resulten significativas.',
  },
  {
    codigo: 'N4',
    titulo: 'Juicios contables significativos',
    referencia: 'Sección 8 (8.6)',
    origen: 'manual',
    exigencia:
      'Revelar los juicios —distintos de los que impliquen estimaciones— que la gerencia haya realizado al aplicar las políticas contables y que tengan el efecto más significativo sobre los importes reconocidos.',
    aportaElSistema:
      'Nada, por definición: la norma pide los juicios de la gerencia, no los del software. El sistema sí deja rastro de dónde hubo decisiones humanas (correcciones en la bandeja, clasificaciones confirmadas, mapeos NIIF marcados como pendientes de verificación) para que el contador no olvide ninguna.',
    completaElContador:
      'Cada juicio significativo y su efecto: clasificación de un arrendamiento, reconocimiento de un ingreso, control sobre otra entidad, clasificación de un instrumento como pasivo o patrimonio, entre otros.',
  },
  {
    codigo: 'N5',
    titulo: 'Fuentes clave de incertidumbre en las estimaciones',
    referencia: 'Sección 8 (8.7)',
    origen: 'manual',
    exigencia:
      'Revelar los supuestos y otras causas clave de incertidumbre en la estimación al final del período que tengan un riesgo significativo de ocasionar ajustes materiales en el próximo ejercicio, con la naturaleza y el importe en libros de los activos y pasivos afectados.',
    aportaElSistema:
      'El importe en libros de las partidas afectadas, una vez el contador diga cuáles son. Cuáles son y por qué son inciertas, no: eso es la estimación misma.',
    completaElContador:
      'La naturaleza de cada supuesto, el importe en libros afectado, y las razones por las que existe riesgo significativo de ajuste material.',
  },
  {
    codigo: 'N6',
    titulo: 'Desagregación de las partidas del Estado de Situación Financiera',
    referencia: 'Sección 4 (4.11) y Sección 8 (8.2(b))',
    origen: 'automatica',
    exigencia:
      'Subclasificar las partidas presentadas en el estado de forma apropiada a las operaciones de la entidad.',
    aportaElSistema:
      'La desagregación completa cuenta por cuenta, con su clasificación NIIF, su saldo al corte y el comparativo, tomada del ledger.',
    completaElContador:
      'Solo la revisión: confirmar la clasificación corriente/no corriente de las partidas cuyo mapeo NIIF viene marcado como pendiente de verificación humana.',
  },
  {
    codigo: 'N7',
    titulo: 'Desagregación de ingresos, costos y gastos',
    referencia: 'Sección 5 (5.11) — desglose de gastos',
    origen: 'automatica',
    exigencia:
      'Presentar el desglose de gastos por naturaleza o por función; quien lo presente por función debe revelar además información sobre la naturaleza de los gastos, incluidos depreciación, amortización y beneficios a los empleados.',
    aportaElSistema:
      'Ambos cortes sobre los mismos saldos: por función (grupo del PUC) y por naturaleza (cuenta del PUC). Presentando por función, el desglose por naturaleza sale siempre, porque la norma no lo deja optativo.',
    completaElContador:
      'Solo la revisión, y completar los renglones de depreciación, amortización y beneficios a los empleados si su catálogo de cuentas no los separa.',
  },
  {
    codigo: 'N8',
    titulo: 'Efectivo y equivalentes de efectivo',
    referencia: 'Sección 7 (7.2, 7.20-7.21)',
    origen: 'mixta',
    exigencia:
      'Revelar los componentes del efectivo y equivalentes, la conciliación con el estado de situación financiera, y el importe de saldos significativos no disponibles para su uso.',
    aportaElSistema:
      'Los componentes y la conciliación, a partir de las cuentas que el contador haya marcado como efectivo y equivalentes en el mapeo NIIF.',
    completaElContador:
      'Qué cuentas son equivalentes de efectivo (es una política: inversión de alta liquidez, a corto plazo y con riesgo insignificante de cambio de valor) y qué saldos no están disponibles para su uso y por qué.',
  },
  {
    codigo: 'N9',
    titulo: 'Movimientos del patrimonio',
    referencia: 'Sección 6 (6.3)',
    origen: 'mixta',
    exigencia:
      'Presentar, por cada componente del patrimonio, la conciliación entre el saldo inicial y el final, revelando por separado el resultado integral total, los cambios por políticas contables y corrección de errores, y los importes de inversiones y distribuciones a los propietarios.',
    aportaElSistema:
      'La conciliación por componente y el detalle de los asientos que tocaron patrimonio en el período.',
    completaElContador:
      'La clasificación de cada movimiento entre cambio de política contable, corrección de error, aporte de los propietarios y distribución. El asiento dice cuánto y contra qué cuenta; no dice por qué.',
  },
  {
    codigo: 'N10',
    titulo: 'Partes relacionadas',
    referencia: 'Sección 33',
    origen: 'mixta',
    exigencia:
      'Revelar las relaciones entre controladora y subsidiarias, las remuneraciones del personal clave de la gerencia y, por categoría de parte relacionada, la naturaleza y el importe de las transacciones y los saldos pendientes.',
    aportaElSistema:
      'El movimiento y el saldo de cada tercero (reporte de A9), una vez el contador identifique cuáles son partes relacionadas.',
    completaElContador:
      'Quién es parte relacionada y en qué categoría. El sistema no tiene ese dato: en la base, un tercero es un proveedor con su NIT, no un vínculo societario o familiar.',
  },
  {
    codigo: 'N11',
    titulo: 'Hechos ocurridos después del período sobre el que se informa',
    referencia: 'Sección 32',
    origen: 'manual',
    exigencia:
      'Revelar la fecha de autorización para emisión y quién la concedió, y, por cada categoría de hechos posteriores que no impliquen ajuste, su naturaleza y una estimación de sus efectos financieros.',
    aportaElSistema:
      'Nada. Un hecho posterior al cierre que no implica ajuste es, por definición, un hecho que no está en el ledger del período.',
    completaElContador: 'La fecha y el órgano de autorización, y cada hecho posterior con su efecto.',
  },
  {
    codigo: 'N12',
    titulo: 'Provisiones, pasivos contingentes y activos contingentes',
    referencia: 'Sección 21 (21.14-21.17)',
    origen: 'mixta',
    exigencia:
      'Revelar la conciliación de cada clase de provisión, una descripción de la naturaleza de la obligación y las incertidumbres sobre su importe o calendario; para los pasivos contingentes, su naturaleza y el efecto financiero estimado.',
    aportaElSistema:
      'El saldo y el movimiento de las cuentas de provisiones y de las cuentas de orden, si existen en el catálogo de la empresa.',
    completaElContador:
      'La descripción de cada obligación, la incertidumbre sobre importe y calendario, y todos los pasivos y activos contingentes que por definición no están reconocidos en el ledger.',
  },
  {
    codigo: 'N13',
    titulo: 'Compromisos y garantías',
    referencia: 'Sección 8 (8.2(c))',
    origen: 'manual',
    exigencia:
      'Revelar la información adicional, no presentada en ningún estado, que sea relevante para comprender los estados financieros.',
    aportaElSistema: 'El saldo de las cuentas de orden, cuando la empresa las lleva.',
    completaElContador:
      'Compromisos contractuales, garantías otorgadas y recibidas, restricciones sobre activos, y cualquier otra información relevante que no aparezca en los estados.',
  },
];

/** Solo las notas que el contador tiene que escribir (total o parcialmente). */
export function notasQueRequierenIntervencionHumana(): NotaEstadosFinancieros[] {
  return ESTRUCTURA_NOTAS.filter((n) => n.origen !== 'automatica');
}

/** Solo las que el sistema arma completas desde el ledger. */
export function notasAutomaticas(): NotaEstadosFinancieros[] {
  return ESTRUCTURA_NOTAS.filter((n) => n.origen === 'automatica');
}

/**
 * Las secciones de NIIF para las PYMES que están en juego según lo que el
 * mapeo NIIF dice de las cuentas con saldo. Es lo único que el sistema puede
 * aportar honestamente a la nota de políticas contables: la LISTA de políticas
 * que hay que redactar, nunca su texto.
 *
 * `seccion_niif` es una columna de `niif_mapping` que llena el contador (o A1
 * al cargar el catálogo). Si viene vacía, esta función devuelve vacío, y el
 * papel de trabajo lo dice en vez de rellenar con secciones supuestas.
 */
export function seccionesEnJuego(
  cuentas: readonly { seccionNiif: string | null; saldoFinal: string }[],
): string[] {
  const vistas = new Set<string>();
  for (const c of cuentas) {
    if (c.seccionNiif && BigInt(c.saldoFinal) !== 0n) vistas.add(c.seccionNiif);
  }
  return [...vistas].sort();
}

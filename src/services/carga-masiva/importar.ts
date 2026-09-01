/**
 * A16 — Motor de la carga masiva (Ola 4, Tarea 3).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * D-072 — TODO EL ARCHIVO O NADA, Y NUNCA A MEDIAS EN SILENCIO
 *
 * Tres decisiones, y por qué cada una:
 *
 * 1. SE VALIDA TODO ANTES DE ESCRIBIR NADA. Dos pasadas de solo lectura —
 *    formato de cada celda, y luego resolución de los códigos contra la base
 *    (municipio DANE, CIIU, NIT, cuenta PUC)— antes del primer `INSERT`. Un
 *    contador que sube 400 terceros necesita la lista COMPLETA de lo que está
 *    mal, no el primer error; si tuviera que descubrirlos de uno en uno,
 *    subiría el archivo cuarenta veces.
 *
 * 2. SI HAY ERRORES, POR DEFECTO NO SE ESCRIBE NADA. Se devuelve el informe
 *    (fila, columna, motivo) y el usuario decide: corregir y volver a subir,
 *    o pedir EXPLÍCITAMENTE que se carguen solo las filas válidas
 *    (`soloValidas`). Nunca se hace lo segundo por su cuenta: una carga
 *    parcial silenciosa deja al contador creyendo que tiene 400 proveedores
 *    cuando tiene 383, y el descubrimiento llega el día del cierre.
 *
 * 3. UNA TRANSACCIÓN POR ARCHIVO, SIN SAVEPOINTS POR FILA. Si un `INSERT`
 *    falla por algo que las dos pasadas no podían prever (una restricción del
 *    motor, un choque de vigencias entre dos filas del MISMO archivo), se
 *    deshace el archivo entero y se informa exactamente en qué fila pasó.
 *    Aquí un savepoint por fila sería lo contrario de lo que se quiere: haría
 *    que el archivo entrara a medias, que es justo lo que el punto 2 evita.
 *    (Es el caso opuesto al de D-050, donde 50 aprobaciones independientes SÍ
 *    debían sobrevivir a que una fallara.)
 * ─────────────────────────────────────────────────────────────────────────
 *
 * SEGURIDAD. Este motor no comprueba ni un permiso ni un `tenant_id`: escribe
 * llamando a los servicios de dominio, dentro de la sesión verificada que
 * abrió `conSesion`, y quien autoriza es el motor de la base (RLS + triggers
 * de permiso). Un archivo con `company_id` dentro no serviría de nada: ninguna
 * columna de ninguna plantilla nombra una empresa o una firma, y aunque la
 * nombrara, la RLS rechazaría la escritura. La empresa la fija la sesión
 * (D-021/D-022), nunca el archivo.
 */
import type { SqlClient } from '../../db/types';
import { isPostgresError, SQLSTATE } from '../../db/types';
import { leerArchivo, ArchivoIlegibleError, type TablaLeida } from './tabla';
import { DEFINICIONES, definicionPorClave, type DefinicionCarga } from './definiciones';

export { ArchivoIlegibleError };

export interface ErrorFila {
  numeroFila: number;
  columna: string | null;
  motivo: string;
}

export interface ResultadoCarga {
  clave: string;
  titulo: string;
  archivo: string;
  hoja: string;
  filasLeidas: number;
  filasValidas: number;
  filasConError: number;
  filasInsertadas: number;
  errores: ErrorFila[];
  /** true = las filas quedaron guardadas; false = no se escribió nada. */
  aplicado: boolean;
  /** Columnas obligatorias que la plantilla exige y el archivo no trae. */
  columnasFaltantes: string[];
  /** Columnas del archivo que el importador no conoce. No son un error: se ignoran. */
  columnasIgnoradas: string[];
}

/**
 * La carga no se aplicó. Se lanza para que la transacción del archivo se
 * deshaga; el informe viaja dentro, para poder enseñárselo al usuario.
 */
export class CargaRechazadaError extends Error {
  readonly resultado: ResultadoCarga;
  constructor(resultado: ResultadoCarga) {
    super(
      `No se cargó nada: ${resultado.filasConError} de ${resultado.filasLeidas} filas tienen errores.`,
    );
    this.name = 'CargaRechazadaError';
    this.resultado = resultado;
  }
}

export class CatalogoDesconocidoError extends Error {
  constructor(clave: string, disponibles: string[]) {
    super(`No existe el catálogo de carga masiva "${clave}". Disponibles: ${disponibles.join(', ')}.`);
    this.name = 'CatalogoDesconocidoError';
  }
}

/** Extrae el nombre de columna del mensaje, cuando el validador lo puso al frente. */
function columnaDelMensaje(mensaje: string): string | null {
  const m = /^"([A-Za-z0-9_]+)"/.exec(mensaje);
  return m ? m[1]! : null;
}

/**
 * Traduce un error del motor a algo que un contador pueda accionar. No se
 * inventa el motivo: se antepone la explicación y se conserva el mensaje
 * original detrás, porque a veces la restricción dice justo lo que hace falta.
 */
function motivoDeError(e: unknown): string {
  if (!isPostgresError(e)) return e instanceof Error ? e.message : String(e);
  const detalle = e.message;
  switch (e.code) {
    case SQLSTATE.PERMISO_INSUFICIENTE:
      return `su sesión no tiene el permiso que exige este catálogo. Detalle: ${detalle}`;
    case SQLSTATE.UNIQUE_VIOLATION:
      return `ya existe una fila con esa clave (o el archivo la trae dos veces). Detalle: ${detalle}`;
    case SQLSTATE.VIGENCIA_SOLAPADA:
      return `la vigencia se cruza con otra ya cargada para la misma clave. Detalle: ${detalle}`;
    case SQLSTATE.VIGENCIA_INMUTABLE:
      return `no se puede modificar una vigencia ya cerrada; hay que insertar una nueva. Detalle: ${detalle}`;
    case SQLSTATE.FK_ALCANCE_AJENO:
      return `la fila referencia algo que pertenece a otra empresa o a otra firma. Detalle: ${detalle}`;
    case SQLSTATE.FOREIGN_KEY_VIOLATION:
      return `la fila referencia algo que no existe. Detalle: ${detalle}`;
    case SQLSTATE.CHECK_VIOLATION:
      return `el valor no cumple una restricción del esquema. Detalle: ${detalle}`;
    case SQLSTATE.RLS_VIOLATION:
      return `la sesión no puede escribir en ese alcance. Detalle: ${detalle}`;
    default:
      return detalle;
  }
}

export interface OpcionesCarga {
  /**
   * `true` = el usuario vio el informe de errores y pidió EXPLÍCITAMENTE
   * cargar solo las filas válidas. Nunca se activa solo.
   */
  soloValidas?: boolean;
  /** Tope de filas por archivo. Protege de un `.xlsx` de 200 MB. */
  maximoFilas?: number;
}

export const MAXIMO_FILAS_POR_DEFECTO = 5000;

/**
 * Importa un archivo ya leído. Se separa de `importarArchivo` para que las
 * pruebas puedan armar la tabla a mano sin fabricar un `.xlsx`.
 */
export async function importarTabla(
  tx: SqlClient,
  clave: string,
  nombreArchivo: string,
  tabla: TablaLeida,
  opciones: OpcionesCarga = {},
): Promise<ResultadoCarga> {
  const definicion = definicionPorClave(clave);
  if (!definicion) {
    throw new CatalogoDesconocidoError(clave, DEFINICIONES.map((d) => d.clave));
  }
  return importarConDefinicion(tx, definicion, nombreArchivo, tabla, opciones);
}

async function importarConDefinicion(
  tx: SqlClient,
  definicion: DefinicionCarga<never>,
  nombreArchivo: string,
  tabla: TablaLeida,
  opciones: OpcionesCarga,
): Promise<ResultadoCarga> {
  const maximo = opciones.maximoFilas ?? MAXIMO_FILAS_POR_DEFECTO;

  const conocidas = new Set(definicion.columnas.map((c) => c.nombre));
  const presentes = new Set(tabla.encabezados);
  const columnasFaltantes = definicion.columnas
    .filter((c) => c.obligatoria && !presentes.has(c.nombre))
    .map((c) => c.nombre);
  const columnasIgnoradas = tabla.encabezados.filter((e) => !conocidas.has(e));

  const resultado: ResultadoCarga = {
    clave: definicion.clave,
    titulo: definicion.titulo,
    archivo: nombreArchivo,
    hoja: tabla.hoja,
    filasLeidas: tabla.filas.length,
    filasValidas: 0,
    filasConError: 0,
    filasInsertadas: 0,
    errores: [],
    aplicado: false,
    columnasFaltantes,
    columnasIgnoradas,
  };

  if (columnasFaltantes.length > 0) {
    resultado.errores.push({
      numeroFila: 1,
      columna: columnasFaltantes[0]!,
      motivo:
        `al archivo le faltan columnas obligatorias: ${columnasFaltantes.join(', ')}. ` +
        'Descargue la plantilla de este catálogo y trabaje sobre ella: los encabezados tienen que ser exactos.',
    });
    resultado.filasConError = resultado.filasLeidas;
    throw new CargaRechazadaError(resultado);
  }

  if (tabla.filas.length === 0) {
    resultado.errores.push({
      numeroFila: 1,
      columna: null,
      motivo: 'el archivo trae los encabezados pero ninguna fila de datos.',
    });
    throw new CargaRechazadaError(resultado);
  }

  if (tabla.filas.length > maximo) {
    resultado.errores.push({
      numeroFila: maximo + 2,
      columna: null,
      motivo:
        `el archivo trae ${tabla.filas.length} filas y el tope por carga es ${maximo}. ` +
        'Pártalo en varios archivos: así, si algo falla, se deshace solo el trozo que falló.',
    });
    resultado.filasConError = resultado.filasLeidas;
    throw new CargaRechazadaError(resultado);
  }

  // ---- Pasada 1: formato de cada celda. Pura, sin base de datos. ----------
  const candidatas: Array<{ numeroFila: number; valor: never }> = [];
  for (const fila of tabla.filas) {
    try {
      candidatas.push({ numeroFila: fila.numeroFila, valor: definicion.validar(fila.valores) as never });
    } catch (e) {
      const motivo = e instanceof Error ? e.message : String(e);
      resultado.errores.push({ numeroFila: fila.numeroFila, columna: columnaDelMensaje(motivo), motivo });
    }
  }

  // ---- Pasada 2: los códigos existen. Solo lectura. ----------------------
  const validas: Array<{ numeroFila: number; valor: never }> = [];
  if (definicion.comprobar) {
    for (const candidata of candidatas) {
      let motivo: string | null;
      try {
        motivo = await definicion.comprobar(tx, candidata.valor);
      } catch (e) {
        motivo = motivoDeError(e);
      }
      if (motivo) {
        resultado.errores.push({ numeroFila: candidata.numeroFila, columna: null, motivo });
      } else {
        validas.push(candidata);
      }
    }
  } else {
    validas.push(...candidatas);
  }

  resultado.filasValidas = validas.length;
  resultado.filasConError = resultado.errores.length;

  if (resultado.errores.length > 0 && opciones.soloValidas !== true) {
    // No se ha escrito nada todavía; se lanza igualmente para que la
    // transacción quede deshecha sin depender de que no hubiera escrituras.
    throw new CargaRechazadaError(resultado);
  }

  // ---- Escritura ---------------------------------------------------------
  for (const valida of validas) {
    try {
      await definicion.insertar(tx, valida.valor);
      resultado.filasInsertadas += 1;
    } catch (e) {
      resultado.errores.push({
        numeroFila: valida.numeroFila,
        columna: null,
        motivo: motivoDeError(e),
      });
      resultado.filasConError = resultado.errores.length;
      resultado.filasInsertadas = 0;
      // Todo el archivo se deshace: la transacción de `conSesion` hace el
      // ROLLBACK al propagarse esta excepción.
      throw new CargaRechazadaError(resultado);
    }
  }

  await tx.query('SELECT app.registrar_carga_masiva($1, $2, $3, $4, $5::jsonb)', [
    definicion.tabla,
    nombreArchivo,
    resultado.filasInsertadas,
    resultado.filasConError,
    JSON.stringify({
      catalogo: definicion.clave,
      hoja: tabla.hoja,
      filas_leidas: resultado.filasLeidas,
      solo_validas: opciones.soloValidas === true,
      columnas_ignoradas: columnasIgnoradas,
    }),
  ]);

  resultado.aplicado = true;
  return resultado;
}

/** Lee el archivo y lo importa. Debe llamarse DENTRO de `conSesion`. */
export async function importarArchivo(
  tx: SqlClient,
  clave: string,
  nombreArchivo: string,
  contenido: ArrayBuffer | Buffer | Uint8Array,
  opciones: OpcionesCarga = {},
): Promise<ResultadoCarga> {
  const tabla = await leerArchivo(nombreArchivo, contenido);
  return importarTabla(tx, clave, nombreArchivo, tabla, opciones);
}

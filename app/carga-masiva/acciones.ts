'use server';

/**
 * A16 — Acción de servidor de la carga masiva (Ola 4, Tarea 3).
 *
 * TODO EL ARCHIVO CORRE DENTRO DE UN SOLO `conSesion`, que es una sola
 * transacción de PostgreSQL (`withSessionContext`). Esa es la garantía de
 * «todo o nada» de D-072: si el motor lanza a mitad de la carga, la
 * transacción se deshace entera y no queda medio archivo dentro.
 *
 * EL INFORME DE ERRORES VIAJA DENTRO DE LA EXCEPCIÓN, a propósito. Para que la
 * transacción se deshaga hay que lanzar; para poder enseñarle al contador qué
 * filas fallaron hay que devolver datos. `CargaRechazadaError` lleva el informe
 * dentro y aquí se desempaqueta: se deshace la escritura Y se conserva el
 * diagnóstico.
 *
 * NADA DE ESTO AUTORIZA NADA. La empresa la fija la cookie de sesión ya
 * verificada (D-021/D-022) y el permiso lo exige el trigger de la base sobre
 * cada tabla. Esta acción no comprueba ni una cosa ni la otra: solo traduce el
 * error del motor a un mensaje que se pueda leer.
 */
import { conSesion, SesionNoPresenteError } from '../lib/sesion';
import { SesionInvalidaError, EmpresaNoAutorizadaError } from '../../src/db/tenant-context';
import {
  importarArchivo,
  ArchivoIlegibleError,
  CargaRechazadaError,
  CatalogoDesconocidoError,
  type ResultadoCarga,
} from '../../src/services/carga-masiva/importar';
import { definicionPorClave } from '../../src/services/carga-masiva/definiciones';

export interface EstadoCarga {
  /** true = las filas quedaron guardadas. */
  ok: boolean;
  /** Mensaje de cabecera, en una frase. */
  mensaje: string;
  /** Informe fila a fila, cuando lo hay. */
  resultado: ResultadoCarga | null;
  /** El archivo que se intentó, para poder repetir la carga «solo válidas». */
  archivo: string | null;
}

const TAMANO_MAXIMO = 8 * 1024 * 1024;

export async function cargarArchivoAction(
  _previo: EstadoCarga | null,
  formData: FormData,
): Promise<EstadoCarga> {
  const clave = String(formData.get('catalogo') ?? '');
  const soloValidas = String(formData.get('soloValidas') ?? '') === '1';
  const archivo = formData.get('archivo');

  const definicion = definicionPorClave(clave);
  if (!definicion) {
    return { ok: false, mensaje: `No existe el catálogo "${clave}".`, resultado: null, archivo: null };
  }

  if (!(archivo instanceof File) || archivo.size === 0) {
    return {
      ok: false,
      mensaje: 'No se adjuntó ningún archivo. Elija el .xlsx de la plantilla (o un .csv equivalente).',
      resultado: null,
      archivo: null,
    };
  }
  if (archivo.size > TAMANO_MAXIMO) {
    return {
      ok: false,
      mensaje:
        `El archivo pesa ${(archivo.size / 1024 / 1024).toFixed(1)} MB y el máximo es 8 MB. ` +
        'Pártalo en varios archivos más pequeños.',
      resultado: null,
      archivo: archivo.name,
    };
  }

  const contenido = new Uint8Array(await archivo.arrayBuffer());

  try {
    const resultado = await conSesion((tx) =>
      importarArchivo(tx, clave, archivo.name, contenido, { soloValidas }),
    );
    return {
      ok: true,
      mensaje: soloValidas
        ? `Se cargaron ${resultado.filasInsertadas} de ${resultado.filasLeidas} filas. ` +
          `Las ${resultado.filasConError} con error NO se cargaron.`
        : `Se cargaron las ${resultado.filasInsertadas} filas del archivo.`,
      resultado,
      archivo: archivo.name,
    };
  } catch (error) {
    if (error instanceof CargaRechazadaError) {
      return {
        ok: false,
        mensaje:
          `No se cargó nada: ${error.resultado.filasConError} fila(s) tienen problemas. ` +
          'Corrija el archivo y vuelva a subirlo, o pida cargar solo las filas válidas.',
        resultado: error.resultado,
        archivo: archivo.name,
      };
    }
    if (error instanceof ArchivoIlegibleError) {
      return { ok: false, mensaje: error.message, resultado: null, archivo: archivo.name };
    }
    if (error instanceof CatalogoDesconocidoError) {
      return { ok: false, mensaje: error.message, resultado: null, archivo: archivo.name };
    }
    if (error instanceof SesionNoPresenteError || error instanceof SesionInvalidaError) {
      return {
        ok: false,
        mensaje: 'Su sesión venció. Vuelva a entrar y repita la carga: no se guardó nada.',
        resultado: null,
        archivo: archivo.name,
      };
    }
    if (error instanceof EmpresaNoAutorizadaError) {
      return {
        ok: false,
        mensaje: 'Su sesión no tiene acceso vigente a la empresa seleccionada. No se guardó nada.',
        resultado: null,
        archivo: archivo.name,
      };
    }
    // Fallo técnico: al usuario un mensaje entendible, el detalle a la consola
    // del servidor. Nunca se le enseña crudo (misma regla que los reportes).
    console.error('[carga-masiva] fallo técnico importando', clave, error);
    return {
      ok: false,
      mensaje:
        'La carga falló por un problema técnico y no se guardó nada. El detalle quedó en el registro del ' +
        'servidor; avise al administrador con la hora y el nombre del archivo.',
      resultado: null,
      archivo: archivo.name,
    };
  }
}

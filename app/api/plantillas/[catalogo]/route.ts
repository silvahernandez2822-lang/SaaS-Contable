/**
 * A16 — Descarga de la plantilla de un catálogo (Ola 4, Tarea 2).
 *
 * SE GENERA EN EL MOMENTO, no se sirve el archivo de `/archivos-masivos/`. Los
 * `.xlsx` de ese directorio existen para que alguien pueda mirarlos sin
 * levantar el producto (y para que un cambio de esquema se vea en el `git
 * diff`), pero si la ruta los sirviera, un despliegue con el directorio viejo
 * entregaría plantillas que su propio importador rechaza. Generándolas desde
 * `DEFINICIONES` —la misma constante que valida la carga— eso no puede pasar.
 *
 * SEGURIDAD. Una plantilla vacía no contiene ni un dato de ninguna empresa: es
 * la lista de columnas del esquema, la misma para todo el mundo. Aun así la
 * ruta EXIGE sesión: no hay ninguna razón para que un anónimo pueda enumerar
 * la estructura de los catálogos tributarios del producto, y una ruta pública
 * es una ruta que hay que vigilar para siempre.
 */
import { conSesion, SesionNoPresenteError } from '../../../lib/sesion';
import { SesionInvalidaError, EmpresaNoAutorizadaError } from '../../../../src/db/tenant-context';
import { definicionPorClave, DEFINICIONES } from '../../../../src/services/carga-masiva/definiciones';
import { construirPlantilla } from '../../../../src/services/carga-masiva/plantilla';
import { construirPlantillaIcaMunicipio } from '../../../../src/services/carga-masiva/ica-municipio';

/** D-088: la parametrización de ICA por municipio no es un catálogo de columnas
 *  planas de `DEFINICIONES` — tiene layout propio (encabezado + tabla). */
const CLAVE_ICA_D088 = 'ica_municipio_d088';

export const dynamic = 'force-dynamic';

function error(status: number, detalle: string): Response {
  return Response.json({ ok: false, detalle }, { status });
}

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ catalogo: string }> },
): Promise<Response> {
  const { catalogo } = await ctx.params;
  const definicion = definicionPorClave(catalogo);
  const esIcaD088 = catalogo === CLAVE_ICA_D088;
  if (!definicion && !esIcaD088) {
    return error(
      404,
      `No existe la plantilla "${catalogo}". Disponibles: ${DEFINICIONES.map((d) => d.clave).sort().join(', ')}.`,
    );
  }

  try {
    // Solo para exigir una sesión viva; no se lee ni un dato de negocio.
    await conSesion(async () => undefined);
  } catch (e) {
    if (e instanceof SesionNoPresenteError || e instanceof SesionInvalidaError) {
      return error(401, 'Inicie sesión para descargar las plantillas de carga masiva.');
    }
    if (e instanceof EmpresaNoAutorizadaError) {
      return error(403, e.message);
    }
    console.error('[plantillas] fallo abriendo sesión', e);
    return error(500, 'No se pudo generar la plantilla. El detalle quedó en el registro del servidor.');
  }

  const wb = esIcaD088 ? construirPlantillaIcaMunicipio() : construirPlantilla(definicion!);
  const buffer = await wb.xlsx.writeBuffer();
  const clave = esIcaD088 ? CLAVE_ICA_D088 : definicion!.clave;

  return new Response(new Uint8Array(buffer as ArrayBuffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="plantilla_${clave}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}

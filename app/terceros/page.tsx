/**
 * A8 — Maestro de terceros (cierre de V-17): listado, búsqueda y entrada a
 * crear / ver la ficha.
 *
 * D-084 · TAREA 0 — migrado al kit de `app/_ui/` (tokens de tema, tabla
 * reusable con `Th` sticky, `EstadoVacio`). TAREA 2 — botón de exportación a
 * Excel. Filtro por estado (activo / inactivo) para poder ver los terceros
 * inactivados sin perderlos de vista.
 */
import { conSesion } from '../lib/sesion';
import { listarTerceros, puedeEditarTerceros } from '../../src/services/terceros';
import { Badge, Boton, EnlaceBoton, Encabezado, EstadoVacio, Panel, Tabla, Td, Th } from '../_ui/componentes';
import { IconoTerceros } from '../_ui/iconos';
import { MensajeError, MensajeGuardado } from './_componentes';

export const dynamic = 'force-dynamic';

type BusquedaParams = Record<string, string | string[] | undefined>;

function cadena(sp: BusquedaParams, campo: string): string {
  const v = sp[campo];
  return typeof v === 'string' ? v : '';
}

const ESTADOS = [
  { id: 'activos', texto: 'Activos' },
  { id: 'todos', texto: 'Todos' },
  { id: 'inactivos', texto: 'Inactivos' },
] as const;

export default async function PaginaTerceros({
  searchParams,
}: {
  searchParams: Promise<BusquedaParams>;
}) {
  const sp = await searchParams;
  const busqueda = cadena(sp, 'q');
  const estado = (ESTADOS.find((e) => e.id === cadena(sp, 'estado'))?.id ?? 'activos') as
    | 'activos'
    | 'todos'
    | 'inactivos';

  const [terceros, puedeEditar] = await conSesion((tx) =>
    Promise.all([
      listarTerceros(tx, { busqueda: busqueda || undefined, estado }),
      puedeEditarTerceros(tx),
    ]),
  );

  return (
    <div className="mx-auto max-w-5xl p-5">
      <Encabezado
        titulo="Terceros"
        descripcion="Proveedores y demás terceros de esta empresa. La dirección y el municipio son obligatorios desde la creación (Res. 000227/2025, Formato 1001). Los atributos fiscales se declaran aparte, por vigencia."
        acciones={
          <>
            <a
              href="/api/terceros/exportar"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-borde bg-superficie-elevada px-3.5 py-2 text-cuerpo font-semibold text-texto transition-[background-color,border-color,box-shadow,color] duration-150 hover:bg-superficie"
            >
              Exportar a Excel
            </a>
            {puedeEditar && <EnlaceBoton href="/terceros/nuevo">+ Crear tercero</EnlaceBoton>}
          </>
        }
      />

      <MensajeError error={cadena(sp, 'error') || undefined} />
      <MensajeGuardado visible={cadena(sp, 'ok') === '1'} />
      <MensajeGuardado visible={cadena(sp, 'eliminado') === '1'} texto="Tercero eliminado. No tenía movimientos asociados." />
      <MensajeGuardado visible={cadena(sp, 'inactivado') === '1'} texto="Tercero inactivado. Sigue en la base para la trazabilidad y la exógena." />

      <form method="get" className="my-4 flex flex-wrap items-end gap-3 rounded-lg border border-borde bg-superficie-elevada p-3">
        <label className="flex flex-col gap-1 text-metadata font-medium text-texto-suave">
          Buscar
          <input
            name="q"
            type="text"
            placeholder="NIT o razón social"
            defaultValue={busqueda}
            className="w-64 rounded-md border border-borde bg-superficie-elevada px-3 py-2 text-cuerpo text-texto"
          />
        </label>
        <label className="flex flex-col gap-1 text-metadata font-medium text-texto-suave">
          Estado
          <select
            name="estado"
            defaultValue={estado}
            className="rounded-md border border-borde bg-superficie-elevada px-3 py-2 text-cuerpo text-texto"
          >
            {ESTADOS.map((e) => (
              <option key={e.id} value={e.id}>
                {e.texto}
              </option>
            ))}
          </select>
        </label>
        <Boton tipo="submit" variante="secundario">
          Filtrar
        </Boton>
      </form>

      <Panel titulo={`${terceros.length} tercero(s)`}>
        {terceros.length === 0 ? (
          <EstadoVacio
            icono={<IconoTerceros width={44} height={44} strokeWidth={1.5} />}
            titulo="Ningún tercero coincide"
            detalle="Ajuste la búsqueda o el estado, o cree un tercero nuevo."
          />
        ) : (
          <Tabla fijarPrimeraColumna>
            <thead>
              <tr>
                <Th>Documento</Th>
                <Th>Razón social</Th>
                <Th>Municipio</Th>
                <Th>Atributos fiscales</Th>
                <Th>Estado</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {terceros.map((t) => (
                <tr key={t.id} className="border-t border-borde/60">
                  <Td numerico>
                    {t.tipoDocumento} {t.numeroDocumento}
                    {t.digitoVerificacion != null ? `-${t.digitoVerificacion}` : ''}
                  </Td>
                  <Td>{t.razonSocial}</Td>
                  <Td>{t.esDelExterior ? 'Exterior' : t.municipalityNombre ?? '⚠ sin municipio'}</Td>
                  <Td>
                    {t.tieneAtributoFiscalVigente ? (
                      <Badge tono="exito">Vigentes</Badge>
                    ) : (
                      <Badge tono="pendiente">Sin vigencia — va a revisión manual</Badge>
                    )}
                  </Td>
                  <Td>{t.activo ? <Badge tono="neutro">Activo</Badge> : <Badge tono="error">Inactivo</Badge>}</Td>
                  <Td alineado="right">
                    <a
                      href={`/terceros/${t.id}`}
                      className="font-semibold text-primario underline dark:text-primario-tinta-oscura"
                    >
                      Ver ficha
                    </a>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Tabla>
        )}
      </Panel>
    </div>
  );
}

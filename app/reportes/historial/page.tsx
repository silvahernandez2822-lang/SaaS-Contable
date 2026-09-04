/**
 * A9 — D-091 · TAREA 5. Historial de reportes exportados.
 *
 * Mismo patrón exacto que `/carga-masiva/historial` (D-090, A8): tabla
 * paginada sobre `audit_log` bajo RLS, permiso `auditoria.leer` (no se crea
 * uno nuevo — es la misma pregunta que ya responde ese permiso: «¿puede leer
 * el registro de acciones sensibles?»). La diferencia es la accion/entidad
 * que se lee (`EXPORT`/`reporte` en vez de `CARGA_MASIVA`), resuelta en
 * `src/reports/historial.ts`.
 */
import { conSesion } from '../../lib/sesion';
import { tienePermiso, PERMISOS } from '../../../src/auth/permisos';
import { listarHistorialReportes } from '../../../src/reports/historial';
import { Encabezado, EnlaceBoton, EstadoVacio, MensajeEstado, Panel, Tabla, Td, Th } from '../../_ui/componentes';

export const dynamic = 'force-dynamic';

type BusquedaParams = Record<string, string | string[] | undefined>;
function entero(sp: BusquedaParams, campo: string, porDefecto: number): number {
  const v = sp[campo];
  const n = typeof v === 'string' ? Number.parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : porDefecto;
}

function fecha(iso: string): string {
  return iso.replace('T', ' ').slice(0, 16);
}

export default async function PaginaHistorialReportes({
  searchParams,
}: {
  searchParams: Promise<BusquedaParams>;
}) {
  const sp = await searchParams;
  const pagina = entero(sp, 'pagina', 1);

  const { puede, historial } = await conSesion(async (tx) => {
    const puede = await tienePermiso(tx, PERMISOS.AUDITORIA_LEER);
    if (!puede) return { puede: false as const, historial: null };
    return { puede: true as const, historial: await listarHistorialReportes(tx, { pagina, porPagina: 25 }) };
  });

  const totalPaginas = historial ? Math.max(1, Math.ceil(historial.total / historial.porPagina)) : 1;

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <Encabezado
        titulo="Historial de reportes"
        descripcion="Una fila por descarga: quién, cuándo, qué reporte y qué período pidió. Incluye las tres rutas que dejan rastro EXPORT: el catálogo central y los dos maestros (PUC y Terceros)."
        acciones={
          <EnlaceBoton href="/reportes" variante="fantasma">
            Volver a Reportes
          </EnlaceBoton>
        }
      />

      {!puede ? (
        <MensajeEstado tipo="configuracion" titulo="Falta el permiso para ver este historial">
          Se necesita <code>{PERMISOS.AUDITORIA_LEER}</code>, el mismo permiso del registro de auditoría. Pídaselo
          al administrador de la firma.
        </MensajeEstado>
      ) : historial && historial.filas.length === 0 ? (
        <Panel>
          <EstadoVacio
            titulo="Aún no hay ningún reporte descargado"
            detalle="Cuando alguien descargue un reporte desde /reportes, aparecerá aquí."
          />
        </Panel>
      ) : historial ? (
        <Panel titulo={`${historial.total} descarga(s) registrada(s)`}>
          <Tabla>
            <thead>
              <tr>
                <Th>Fecha</Th>
                <Th>Quién</Th>
                <Th>Reporte</Th>
                <Th>Período</Th>
              </tr>
            </thead>
            <tbody>
              {historial.filas.map((f) => (
                <tr key={f.id} className="border-t border-borde/60">
                  <Td className="tabular-nums text-texto-suave">{fecha(f.ocurridoEn)}</Td>
                  <Td>
                    {f.usuarioNombre ?? '—'}
                    {f.usuarioEmail && <span className="block text-metadata text-texto-suave">{f.usuarioEmail}</span>}
                  </Td>
                  <Td className="font-mono">{f.reporteSlug}</Td>
                  <Td>{f.periodo ?? '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Tabla>

          {totalPaginas > 1 && (
            <div className="flex items-center justify-between border-t border-borde px-5 py-3 text-menor text-texto-suave">
              <span>
                Página {historial.pagina} de {totalPaginas}
              </span>
              <div className="flex gap-2">
                {historial.pagina > 1 && (
                  <EnlaceBoton href={`/reportes/historial?pagina=${historial.pagina - 1}`} variante="fantasma">
                    Anterior
                  </EnlaceBoton>
                )}
                {historial.pagina < totalPaginas && (
                  <EnlaceBoton href={`/reportes/historial?pagina=${historial.pagina + 1}`} variante="fantasma">
                    Siguiente
                  </EnlaceBoton>
                )}
              </div>
            </div>
          )}
        </Panel>
      ) : null}
    </main>
  );
}

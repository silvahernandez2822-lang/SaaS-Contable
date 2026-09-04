/**
 * A8 — D-090 · TAREA 3. Historial de cargas masivas.
 *
 * Lista `audit_log WHERE accion = 'CARGA_MASIVA'` (una fila de cabecera por
 * archivo subido, migración 170). Requiere `auditoria.leer` — es el permiso ya
 * existente para consultar el registro de acciones sensibles
 * (`PERMISOS.AUDITORIA_LEER`); no se creó un permiso nuevo solo para este
 * listado porque ya hay uno que encaja exactamente en lo que hace: leer
 * auditoría. `carga_masiva.acceder` (D-090 · TAREA 5) gobierna la pantalla
 * `/carga-masiva`, no este historial — son preguntas distintas («¿puede subir
 * archivos?» vs. «¿puede ver quién subió qué?»).
 *
 * NO hay filtro de aplicación: `listarHistorialCargaMasiva` corre dentro de
 * `conSesion` y la RLS de `audit_log` (012_rls.sql) aísla por
 * tenant_id/company_id sola (Regla de Oro 7).
 */
import Link from 'next/link';
import { conSesion } from '../../lib/sesion';
import { tienePermiso, PERMISOS } from '../../../src/auth/permisos';
import { listarHistorialCargaMasiva } from '../../../src/services/carga-masiva/historial';
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

export default async function PaginaHistorialCargaMasiva({
  searchParams,
}: {
  searchParams: Promise<BusquedaParams>;
}) {
  const sp = await searchParams;
  const pagina = entero(sp, 'pagina', 1);

  const { puede, historial } = await conSesion(async (tx) => {
    const puede = await tienePermiso(tx, PERMISOS.AUDITORIA_LEER);
    if (!puede) return { puede: false as const, historial: null };
    return { puede: true as const, historial: await listarHistorialCargaMasiva(tx, { pagina, porPagina: 25 }) };
  });

  const totalPaginas = historial ? Math.max(1, Math.ceil(historial.total / historial.porPagina)) : 1;

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <Encabezado
        titulo="Historial de cargas masivas"
        descripcion="Una fila por archivo subido: quién, cuándo, a qué catálogo, y cuántas filas entraron o se rechazaron."
        acciones={
          <Link href="/carga-masiva" className="text-menor font-semibold text-primario underline dark:text-primario-tinta-oscura">
            Volver a Carga masiva
          </Link>
        }
      />

      {!puede ? (
        <MensajeEstado tipo="configuracion" titulo="Falta el permiso para ver este historial">
          Se necesita <code>{PERMISOS.AUDITORIA_LEER}</code>, el mismo permiso del registro de auditoría.
          Pídaselo al administrador de la firma.
        </MensajeEstado>
      ) : historial && historial.filas.length === 0 ? (
        <Panel>
          <EstadoVacio
            titulo="Aún no hay ninguna carga masiva registrada"
            detalle="Cuando alguien suba un archivo desde /carga-masiva, aparecerá aquí."
          />
        </Panel>
      ) : historial ? (
        <Panel titulo={`${historial.total} carga(s) registrada(s)`}>
          <Tabla>
            <thead>
              <tr>
                <Th>Fecha</Th>
                <Th>Quién</Th>
                <Th>Catálogo</Th>
                <Th>Archivo</Th>
                <Th alineado="right">Filas OK</Th>
                <Th alineado="right">Filas con error</Th>
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
                  <Td>{f.catalogoTitulo}</Td>
                  <Td className="font-mono">{f.archivo ?? '—'}</Td>
                  <Td numerico alineado="right">{f.filasOk ?? '—'}</Td>
                  <Td numerico alineado="right" className={f.filasError ? 'text-error-tinta' : undefined}>
                    {f.filasError ?? '—'}
                  </Td>
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
                  <EnlaceBoton href={`/carga-masiva/historial?pagina=${historial.pagina - 1}`} variante="fantasma">
                    Anterior
                  </EnlaceBoton>
                )}
                {historial.pagina < totalPaginas && (
                  <EnlaceBoton href={`/carga-masiva/historial?pagina=${historial.pagina + 1}`} variante="fantasma">
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

/**
 * D-092 — Historial de cambios de permisos.
 *
 * POR QUÉ ES UN HISTORIAL PROPIO Y NO UNA FILA MÁS DE LOS QUE YA EXISTEN. Los
 * de D-090 (carga masiva) y D-091 (reportes) leen UNA acción sobre UNA entidad
 * (`CARGA_MASIVA`, `EXPORT`): la pregunta que contestan cabe en una consulta de
 * una línea. La de esta pantalla —«¿quién tocó los permisos de quién, cuándo y
 * por qué?»— está repartida en CINCO entidades distintas del mismo `audit_log`:
 * `user_permission_override`, `user_company_access`, `role`, `role_permission`
 * y `"user"`. Meterla en cualquiera de los otros dos historiales obligaría a
 * cruzar cinco pantallas para reconstruir un solo episodio («le creé el
 * usuario, le di el rol, le añadí la excepción y le quité el acceso»).
 *
 * LO QUE NO SE CREÓ: ninguna tabla nueva y ningún permiso nuevo. Misma
 * `audit_log` bajo RLS y el mismo `auditoria.leer` que ya usan los otros dos
 * historiales — es literalmente «consultar el registro de acciones sensibles»,
 * que es la descripción con la que ese permiso nació en la migración 014.
 *
 * EL AISLAMIENTO NO LO PONE ESTE ARCHIVO. No hay ni un filtro de aplicación por
 * tenant o empresa: lo impone la política `audit_log_rls` (012). Regla de Oro 7.
 */
import Link from 'next/link';
import { conSesion } from '../../lib/sesion';
import { tienePermiso, PERMISOS } from '../../../src/auth/permisos';
import { listarHistorialDePermisos } from '../../../src/services/administracion';
import { Badge, EnlaceBoton, Encabezado, EstadoVacio, MensajeEstado, Panel, Tabla, Td, Th } from '../../_ui/componentes';
import { NavegacionAdmin } from '../_navegacion';

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

const ENTIDAD_ETIQUETA: Record<string, string> = {
  user_permission_override: 'Permiso individual',
  user_company_access: 'Acceso a empresa',
  role: 'Rol',
  role_permission: 'Permiso de un rol',
  user: 'Usuario',
};

export default async function PaginaHistorialPermisos({
  searchParams,
}: {
  searchParams: Promise<BusquedaParams>;
}) {
  const sp = await searchParams;
  const pagina = entero(sp, 'pagina', 1);

  const { puede, historial } = await conSesion(async (tx) => {
    const puede = await tienePermiso(tx, PERMISOS.AUDITORIA_LEER);
    if (!puede) return { puede: false as const, historial: null };
    return { puede: true as const, historial: await listarHistorialDePermisos(tx, { pagina, porPagina: 25 }) };
  });

  const totalPaginas = historial ? Math.max(1, Math.ceil(historial.total / historial.porPagina)) : 1;

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <Encabezado
        titulo="Historial de permisos"
        descripcion="Quién tocó los permisos de quién, cuándo y —cuando la decisión lo exige— por qué. Sale del audit_log, que la base no deja corregir ni borrar (AU001)."
      />
      <NavegacionAdmin activo="historial" />

      {!puede ? (
        <div className="mt-4">
          <MensajeEstado tipo="configuracion" titulo="Falta el permiso para ver este historial">
            Se necesita <code>{PERMISOS.AUDITORIA_LEER}</code>, el mismo permiso del registro de auditoría que
            usan el historial de cargas masivas y el de reportes. Pídaselo al administrador de la firma.
          </MensajeEstado>
        </div>
      ) : historial && historial.filas.length === 0 ? (
        <Panel className="mt-4">
          <EstadoVacio
            titulo="Todavía no se ha tocado ningún permiso"
            detalle="Cuando alguien cree un usuario, otorgue un rol o conceda una excepción, aparecerá aquí."
          />
        </Panel>
      ) : historial ? (
        <Panel className="mt-4" titulo={`${historial.total} cambio(s) registrado(s)`}>
          <Tabla alturaMaxima={null}>
            <thead>
              <tr>
                <Th>Cuándo</Th>
                <Th>Quién lo hizo</Th>
                <Th>Sobre qué</Th>
                <Th>Qué cambió</Th>
                <Th>A quién</Th>
              </tr>
            </thead>
            <tbody>
              {historial.filas.map((f) => (
                <tr key={f.id} className="border-t border-borde/60 align-top">
                  <Td className="tabular-nums text-texto-suave">{fecha(f.ocurridoEn)}</Td>
                  <Td>
                    {f.autorNombre ?? 'sistema (sin sesión)'}
                    {f.autorEmail && <span className="block text-metadata text-texto-suave">{f.autorEmail}</span>}
                  </Td>
                  <Td>
                    <Badge tono={f.entidad === 'user_permission_override' ? 'primario' : 'neutro'}>
                      {ENTIDAD_ETIQUETA[f.entidad] ?? f.entidad}
                    </Badge>
                  </Td>
                  <Td>
                    {f.resumen}
                    {f.motivo && (
                      <span className="mt-1 block text-metadata text-texto-suave">Motivo: «{f.motivo}»</span>
                    )}
                  </Td>
                  <Td>{f.afectadoNombre ?? '—'}</Td>
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
                  <EnlaceBoton href={`/admin/historial?pagina=${historial.pagina - 1}`} variante="fantasma">
                    Anterior
                  </EnlaceBoton>
                )}
                {historial.pagina < totalPaginas && (
                  <EnlaceBoton href={`/admin/historial?pagina=${historial.pagina + 1}`} variante="fantasma">
                    Siguiente
                  </EnlaceBoton>
                )}
              </div>
            </div>
          )}
        </Panel>
      ) : null}

      <p className="mt-4 text-menor text-texto-suave">
        ¿Busca otra cosa?{' '}
        <Link href="/carga-masiva/historial" className="underline">
          Historial de cargas masivas
        </Link>{' '}
        ·{' '}
        <Link href="/reportes/historial" className="underline">
          Historial de reportes generados
        </Link>
      </p>
    </main>
  );
}

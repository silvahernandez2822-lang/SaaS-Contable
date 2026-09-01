/**
 * A16 — Bandeja de correcciones por revisar (Ola 4, Tarea 7, D-068).
 *
 * ESTE ES EL CIRCUITO «EL JUNIOR CORRIGE, EL REVISOR APRUEBA», Y NO ES UN
 * PERMISO ESPECIAL: es un ESTADO del recurso corregido.
 *
 *   · Un usuario SIN `documento.aprobar_correccion` que corrige el AIU o el
 *     municipio de una factura deja la corrección en 'pendiente_revision'. El
 *     motor de causación NO la usa: el documento se causa como si no
 *     existiera, que es exactamente lo que pasaba antes de la Ola 4.
 *   · Un usuario CON ese permiso la aprueba (o la rechaza) aquí, con un
 *     motivo. Solo entonces el motor la tiene en cuenta.
 *   · Quien ya tiene el permiso y corrige su propio documento no pasa por esta
 *     bandeja: su corrección nace aprobada, firmada por él. Si no fuera así, la
 *     bandeja se llenaría de filas que nadie más puede aprobar y todo el mundo
 *     acabaría aprobándose a sí mismo, que es peor que no tener circuito.
 *
 * Una corrección aprobada NO reescribe un asiento ya publicado: el ledger es
 * inmutable (Regla de Oro 1). Afecta a la próxima causación de ese documento,
 * y si ya estaba causado hay que reprocesarlo desde la bandeja.
 */
import Link from 'next/link';
import { conSesion } from '../../lib/sesion';
import { listarCorreccionesPendientes } from '../../../src/services/administracion';
import { tienePermiso, PERMISOS } from '../../../src/auth/permisos';
import { MensajeError } from '../../parametros/_componentes';
import { revisarAction } from './acciones';

export const dynamic = 'force-dynamic';

type BusquedaParams = Record<string, string | string[] | undefined>;
function cadena(sp: BusquedaParams, campo: string): string {
  const v = sp[campo];
  return typeof v === 'string' ? v : '';
}

function pesos(centavos: string | null): string {
  if (centavos === null) return '—';
  const negativo = centavos.startsWith('-');
  const digitos = (negativo ? centavos.slice(1) : centavos).padStart(3, '0');
  const enteros = digitos.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negativo ? '-' : ''}$${enteros},${digitos.slice(-2)}`;
}

export default async function PaginaCorrecciones({ searchParams }: { searchParams: Promise<BusquedaParams> }) {
  const sp = await searchParams;

  const { pendientes, puedeAprobar } = await conSesion(async (tx) => ({
    pendientes: await listarCorreccionesPendientes(tx),
    puedeAprobar: await tienePermiso(tx, PERMISOS.DOCUMENTO_APROBAR_CORRECCION),
  }));

  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: '24px' }}>
      <h1>Correcciones por revisar</h1>
      <p>
        <Link href="/admin/usuarios">Usuarios</Link> · <Link href="/admin/roles">Roles y permisos</Link> ·{' '}
        <Link href="/bandeja">Bandeja de causación</Link>
      </p>

      <MensajeError error={cadena(sp, 'error') || undefined} />
      {cadena(sp, 'ok') && (
        <p role="status" style={{ border: '1px solid #15803d', color: '#15803d', padding: '8px 12px' }}>
          {decodeURIComponent(cadena(sp, 'ok'))}
        </p>
      )}

      <p>
        Aquí llegan las correcciones de AIU y de municipio que registró alguien sin permiso para aprobarlas. El
        motor de causación <strong>no las usa</strong> mientras estén pendientes: el documento se causa como si
        la corrección no existiera. Aprobar una no reescribe ningún asiento ya publicado — el ledger es
        inmutable; afecta a la próxima causación, y si el documento ya estaba causado hay que reprocesarlo
        desde la bandeja.
      </p>

      {!puedeAprobar && (
        <p role="alert" style={{ border: '1px solid #b45309', background: '#fffbeb', padding: '10px 14px' }}>
          Su sesión no tiene <code>documento.aprobar_correccion</code>: puede ver la lista, no decidir. Es justo
          el permiso que separa a quien corrige de quien revisa; se otorga en{' '}
          <Link href="/admin/roles">Roles y permisos</Link>, columna «Aprobar / rechazar» del módulo Documentos.
        </p>
      )}

      {pendientes.length === 0 ? (
        <p>No hay ninguna corrección pendiente de revisión en esta empresa.</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #cbd5e1' }}>
              <th style={{ padding: 4 }}>Documento</th>
              <th style={{ padding: 4 }}>Corrección</th>
              <th style={{ padding: 4 }}>La registró</th>
              {puedeAprobar && <th style={{ padding: 4, width: 380 }}>Decisión</th>}
            </tr>
          </thead>
          <tbody>
            {pendientes.map((c) => (
              <tr key={c.id} style={{ borderBottom: '1px solid #e2e8f0', verticalAlign: 'top' }}>
                <td style={{ padding: 6 }}>
                  <strong>{c.numeroDocumento}</strong>
                  <br />
                  <span style={{ fontSize: 12, color: '#475569' }}>Emisor NIT {c.emisorNit}</span>
                </td>
                <td style={{ padding: 6 }}>
                  {c.tipo === 'aiu_linea' ? (
                    <>
                      AIU de la línea {c.lineaNumero}: <strong>{pesos(c.valorAiuCentavos)}</strong>
                    </>
                  ) : (
                    <>
                      Municipio de la operación: <strong>{c.municipioNombre ?? '—'}</strong>
                    </>
                  )}
                  <br />
                  <span style={{ fontSize: 12, color: '#475569' }}>Motivo: {c.motivo}</span>
                </td>
                <td style={{ padding: 6 }}>
                  {c.creadoPorNombre}
                  <br />
                  <span style={{ fontSize: 12, color: '#475569' }}>{c.creadoEn.slice(0, 16)}</span>
                </td>
                {puedeAprobar && (
                  <td style={{ padding: 6 }}>
                    <form action={revisarAction}>
                      <input type="hidden" name="correccionId" value={c.id} />
                      <input
                        name="motivo"
                        required
                        size={40}
                        placeholder="Motivo de la decisión (obligatorio)"
                      />
                      <div style={{ marginTop: 6 }}>
                        <button type="submit" name="decision" value="aprobado">
                          Aprobar
                        </button>{' '}
                        <button type="submit" name="decision" value="rechazado">
                          Rechazar
                        </button>
                      </div>
                    </form>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

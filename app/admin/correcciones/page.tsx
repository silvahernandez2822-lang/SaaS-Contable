/**
 * A16 — Bandeja de correcciones por revisar (Ola 4, Tarea 7, D-068), migrada al
 * sistema de interfaz por A12 en D-092.
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
 *
 * D-092 — DEFECTO CORREGIDO AQUÍ: esta pantalla listaba las correcciones
 * pendientes SIN exigir ningún permiso. La RLS impedía ver las de otra firma o
 * de otra empresa, así que no era una fuga entre tenants; pero dentro de la
 * empresa cualquier sesión —incluida `solo_lectura`— veía número de documento,
 * NIT del emisor, valores corregidos y el nombre de quien los corrigió. Ahora
 * se exige `documento.leer` para VER (que es lo que ya exige la bandeja para
 * los mismos datos) y `documento.aprobar_correccion` sigue siendo el que
 * decide. El permiso de decidir lo impone el trigger de la base (170), no este
 * archivo.
 */
import Link from 'next/link';
import { conSesion } from '../../lib/sesion';
import { listarCorreccionesPendientes } from '../../../src/services/administracion';
import { tienePermiso, PERMISOS } from '../../../src/auth/permisos';
import { MensajeError } from '../../parametros/_componentes';
import { Boton, Encabezado, Entrada, EstadoVacio, MensajeEstado, Panel, Tabla, Td, Th } from '../../_ui/componentes';
import { NavegacionAdmin } from '../_navegacion';
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

  const { puedeVer, puedeAprobar, pendientes } = await conSesion(async (tx) => {
    const puedeVer = await tienePermiso(tx, PERMISOS.DOCUMENTO_LEER);
    if (!puedeVer) return { puedeVer, puedeAprobar: false, pendientes: [] };
    return {
      puedeVer,
      puedeAprobar: await tienePermiso(tx, PERMISOS.DOCUMENTO_APROBAR_CORRECCION),
      pendientes: await listarCorreccionesPendientes(tx),
    };
  });

  const ok = cadena(sp, 'ok');

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <Encabezado
        titulo="Correcciones por revisar"
        descripcion="Correcciones de AIU y de municipio registradas por alguien sin permiso para aprobarlas. Mientras estén pendientes, el motor causa el documento como si no existieran."
      />
      <NavegacionAdmin activo="correcciones" />

      {!puedeVer ? (
        <div className="mt-4">
          <MensajeEstado tipo="configuracion" titulo="Falta el permiso para ver estas correcciones">
            Se necesita <code>{PERMISOS.DOCUMENTO_LEER}</code>: una corrección lleva el número de la factura, el
            NIT del emisor y el valor corregido, que son datos del documento.
          </MensajeEstado>
        </div>
      ) : (
        <>
          <MensajeError error={cadena(sp, 'error') || undefined} />
          {ok && (
            <div className="my-3">
              <MensajeEstado tipo="sin-datos" titulo={decodeURIComponent(ok)} />
            </div>
          )}

          {!puedeAprobar && (
            <div className="my-3">
              <MensajeEstado tipo="configuracion" titulo="Puede ver la lista, no decidir">
                Su sesión no tiene <code>documento.aprobar_correccion</code>. Es justo el permiso que separa a
                quien corrige de quien revisa; se otorga en{' '}
                <Link href="/admin/roles" className="font-semibold underline">
                  Roles y permisos
                </Link>
                , columna «Aprobar / rechazar» del módulo Documentos, o como excepción puntual en{' '}
                <Link href="/admin/permisos" className="font-semibold underline">
                  Permisos individuales
                </Link>
                .
              </MensajeEstado>
            </div>
          )}

          <Panel className="mt-4" titulo={`${pendientes.length} corrección(es) pendiente(s)`}>
            {pendientes.length === 0 ? (
              <EstadoVacio
                titulo="No hay ninguna corrección pendiente en esta empresa"
                detalle="Aprobar una corrección no reescribe ningún asiento ya publicado: el ledger es inmutable. Afecta a la próxima causación."
              />
            ) : (
              <Tabla alturaMaxima={null}>
                <thead>
                  <tr>
                    <Th>Documento</Th>
                    <Th>Corrección</Th>
                    <Th>La registró</Th>
                    {puedeAprobar && <Th>Decisión</Th>}
                  </tr>
                </thead>
                <tbody>
                  {pendientes.map((c) => (
                    <tr key={c.id} className="border-t border-borde/60 align-top">
                      <Td>
                        <span className="font-semibold text-texto">{c.numeroDocumento}</span>
                        <span className="block text-metadata text-texto-suave tabular-nums">
                          Emisor NIT {c.emisorNit}
                        </span>
                      </Td>
                      <Td>
                        {c.tipo === 'aiu_linea' ? (
                          <>
                            AIU de la línea {c.lineaNumero}:{' '}
                            <strong className="tabular-nums">{pesos(c.valorAiuCentavos)}</strong>
                          </>
                        ) : (
                          <>
                            Municipio de la operación: <strong>{c.municipioNombre ?? '—'}</strong>
                          </>
                        )}
                        <span className="block text-metadata text-texto-suave">Motivo: {c.motivo}</span>
                      </Td>
                      <Td>
                        {c.creadoPorNombre}
                        <span className="block text-metadata text-texto-suave tabular-nums">
                          {c.creadoEn.slice(0, 16)}
                        </span>
                      </Td>
                      {puedeAprobar && (
                        <Td>
                          <form action={revisarAction} className="flex flex-col gap-2">
                            <input type="hidden" name="correccionId" value={c.id} />
                            <Entrada name="motivo" required placeholder="Motivo de la decisión (obligatorio)" />
                            <div className="flex gap-2">
                              <Boton tipo="submit" name="decision" value="aprobado">
                                Aprobar
                              </Boton>
                              <Boton tipo="submit" variante="peligro" name="decision" value="rechazado">
                                Rechazar
                              </Boton>
                            </div>
                          </form>
                        </Td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </Tabla>
            )}
          </Panel>
        </>
      )}
    </main>
  );
}

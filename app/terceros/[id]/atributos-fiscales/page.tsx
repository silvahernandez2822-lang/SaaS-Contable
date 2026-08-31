/**
 * A8 — Registrar vigencia de atributos fiscales de un tercero (cierre de
 * V-17). Las nueve banderas son radios "Sí/No" SIN opción preseleccionada:
 * no hay valor por defecto (sección 6.2 / D-014 de A2). El paso de
 * confirmación muestra el simulador de impacto antes de guardar.
 */
import Link from 'next/link';
import { conSesion } from '../../../lib/sesion';
import {
  obtenerTercero,
  listarHistorialAtributosFiscales,
  hoyIso,
  puedeEditarAtributosFiscales,
} from '../../../../src/services/terceros';
import { MensajeError, RadioSiNo, Si } from '../../_componentes';
import { confirmarAction, simularAction } from './acciones';

export const dynamic = 'force-dynamic';

type BusquedaParams = Record<string, string | string[] | undefined>;
function cadena(sp: BusquedaParams, campo: string): string {
  const v = sp[campo];
  return typeof v === 'string' ? v : '';
}

export default async function PaginaAtributosFiscales({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<BusquedaParams>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const [tercero, historial, puedeEditar] = await conSesion((tx) =>
    Promise.all([obtenerTercero(tx, id), listarHistorialAtributosFiscales(tx, id), puedeEditarAtributosFiscales(tx)]),
  );

  if (!tercero) {
    return (
      <main style={{ maxWidth: 800, margin: '0 auto', padding: '24px' }}>
        <p>No existe (o no es visible para esta sesión) el tercero {id}.</p>
      </main>
    );
  }

  const confirmando = cadena(sp, 'confirmar') === '1';

  return (
    <main style={{ maxWidth: 800, margin: '0 auto', padding: '24px' }}>
      <p>
        <Link href={`/terceros/${id}`}>« Volver a {tercero.razonSocial}</Link>
      </p>
      <h1>Atributos fiscales — {tercero.razonSocial}</h1>

      <MensajeError error={cadena(sp, 'error') || undefined} />

      {!puedeEditar && <p>Su sesión no tiene el permiso "tercero.atributos_fiscales": solo puede consultar el historial.</p>}

      {puedeEditar && !confirmando && (
        <form action={simularAction} style={{ border: '1px solid #334155', padding: '16px' }}>
          <input type="hidden" name="terceroId" value={tercero.id} />
          <p>
            Declare las NUEVE banderas explícitamente. Ninguna tiene un valor por defecto: si deja alguna sin
            marcar, el guardado se rechaza (sección 6.2) en vez de asumir "No".
          </p>
          <RadioSiNo nombre="esDeclaranteRenta" etiqueta="¿Es declarante de renta?" />
          <RadioSiNo nombre="esAutorretenedorRenta" etiqueta="¿Es autorretenedor de renta?" />
          <RadioSiNo nombre="esGranContribuyente" etiqueta="¿Es gran contribuyente?" />
          <RadioSiNo nombre="esRegimenSimple" etiqueta="¿Pertenece al régimen SIMPLE?" />
          <RadioSiNo nombre="esResponsableIva" etiqueta="¿Es responsable de IVA?" />
          <RadioSiNo nombre="esAgenteRetencionRenta" etiqueta="¿Es agente de retención de renta?" />
          <RadioSiNo nombre="esAgenteRetencionIva" etiqueta="¿Es agente de retención de IVA?" />
          <RadioSiNo nombre="esAgenteRetencionIca" etiqueta="¿Es agente de retención de ICA?" />
          <RadioSiNo nombre="esAutorretenedorIca" etiqueta="¿Es autorretenedor de ICA?" />

          <div style={{ marginTop: '12px' }}>
            <label>
              Régimen tributario{' '}
              <select name="regimenTributario" defaultValue="ordinario">
                <option value="ordinario">Ordinario</option>
                <option value="simple">SIMPLE</option>
                <option value="especial">Especial</option>
                <option value="no_contribuyente">No contribuyente</option>
                <option value="no_residente">No residente</option>
              </select>
            </label>
          </div>
          <div>
            <label>
              Fecha de vigencia (propuesta: hoy) *{' '}
              <input name="vigenteDesde" type="date" required defaultValue={hoyIso()} />
            </label>
          </div>
          <div>
            <label>
              Fuente del dato{' '}
              <select name="fuente" defaultValue="declarado_por_cliente">
                <option value="rut">RUT</option>
                <option value="declarado_por_cliente">Declarado por el cliente</option>
                <option value="factura">Factura</option>
                <option value="consulta_dian">Consulta DIAN</option>
                <option value="otro">Otro</option>
              </select>
            </label>
          </div>
          <div>
            <label>
              Norma de respaldo (obligatoria) *{' '}
              <input name="normaRespaldo" type="text" required size={60} placeholder="Ej: RUT anexo, casilla 53" />
            </label>
          </div>
          <div>
            <label>
              Notas <input name="notas" type="text" size={60} />
            </label>
          </div>
          <button type="submit" style={{ marginTop: '12px' }}>
            Simular impacto
          </button>
        </form>
      )}

      {puedeEditar && confirmando && (
        <section style={{ border: '1px solid #334155', padding: '16px' }}>
          <h2>Confirmar vigencia nueva</h2>
          <p>
            <strong>
              Este atributo afecta {cadena(sp, 'documentosPendientes')} documento(s) de este proveedor aún
              pendientes de causación y {cadena(sp, 'asientosPublicados')} asiento(s) suyos ya publicados
              (sección 6.2, punto 6).
            </strong>
          </p>
          <ul>
            <li>Declarante de renta: {cadena(sp, 'esDeclaranteRenta') === 'si' ? 'Sí' : 'No'}</li>
            <li>Autorretenedor de renta: {cadena(sp, 'esAutorretenedorRenta') === 'si' ? 'Sí' : 'No'}</li>
            <li>Gran contribuyente: {cadena(sp, 'esGranContribuyente') === 'si' ? 'Sí' : 'No'}</li>
            <li>Régimen SIMPLE: {cadena(sp, 'esRegimenSimple') === 'si' ? 'Sí' : 'No'}</li>
            <li>Responsable de IVA: {cadena(sp, 'esResponsableIva') === 'si' ? 'Sí' : 'No'}</li>
            <li>Agente de retención (renta): {cadena(sp, 'esAgenteRetencionRenta') === 'si' ? 'Sí' : 'No'}</li>
            <li>Agente de retención (IVA): {cadena(sp, 'esAgenteRetencionIva') === 'si' ? 'Sí' : 'No'}</li>
            <li>Agente de retención (ICA): {cadena(sp, 'esAgenteRetencionIca') === 'si' ? 'Sí' : 'No'}</li>
            <li>Autorretenedor de ICA: {cadena(sp, 'esAutorretenedorIca') === 'si' ? 'Sí' : 'No'}</li>
            <li>Régimen tributario: {cadena(sp, 'regimenTributario')}</li>
            <li>Vigente desde: {cadena(sp, 'vigenteDesde')}</li>
            <li>Norma de respaldo: {cadena(sp, 'normaRespaldo')}</li>
          </ul>
          <form action={confirmarAction}>
            {[
              'terceroId',
              'esDeclaranteRenta',
              'esAutorretenedorRenta',
              'esGranContribuyente',
              'esRegimenSimple',
              'esResponsableIva',
              'esAgenteRetencionRenta',
              'esAgenteRetencionIva',
              'esAgenteRetencionIca',
              'esAutorretenedorIca',
              'regimenTributario',
              'vigenteDesde',
              'normaRespaldo',
              'fuente',
              'notas',
            ].map((campo) => (
              <input key={campo} type="hidden" name={campo} value={cadena(sp, campo)} />
            ))}
            <button type="submit">Confirmar y guardar</button>
          </form>
        </section>
      )}

      <h2>Historial (nunca se sobrescribe: cada edición es una vigencia nueva)</h2>
      <table style={{ borderCollapse: 'collapse' }} border={1} cellPadding={4}>
        <thead>
          <tr>
            <th>Vigente desde</th>
            <th>Vigente hasta</th>
            <th>Declarante</th>
            <th>Autorretenedor renta</th>
            <th>Resp. IVA</th>
            <th>Régimen</th>
            <th>Norma</th>
          </tr>
        </thead>
        <tbody>
          {historial.map((f) => (
            <tr key={f.id}>
              <td>{f.vigenteDesde}</td>
              <td>{f.vigenteHasta ?? '(vigente)'}</td>
              <td><Si valor={f.esDeclaranteRenta} /></td>
              <td><Si valor={f.esAutorretenedorRenta} /></td>
              <td><Si valor={f.esResponsableIva} /></td>
              <td>{f.regimenTributario}</td>
              <td>{f.normaRespaldo}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {historial.length === 0 && <p>Sin ninguna vigencia registrada todavía.</p>}
    </main>
  );
}

/**
 * A8 — Maestro de terceros (cierre de V-17): página de entrada. Buscar,
 * listar y entrar a crear/editar. Sin esto no se podía causar la factura de
 * un proveedor nuevo (ver cabecera de `src/services/terceros.ts`).
 */
import Link from 'next/link';
import { conSesion } from '../lib/sesion';
import { listarTerceros, puedeEditarTerceros } from '../../src/services/terceros';
import { MensajeError } from './_componentes';

export const dynamic = 'force-dynamic';

type BusquedaParams = Record<string, string | string[] | undefined>;

function cadena(sp: BusquedaParams, campo: string): string {
  const v = sp[campo];
  return typeof v === 'string' ? v : '';
}

export default async function PaginaTerceros({
  searchParams,
}: {
  searchParams: Promise<BusquedaParams>;
}) {
  const sp = await searchParams;
  const busqueda = cadena(sp, 'q');

  const [terceros, puedeEditar] = await conSesion((tx) =>
    Promise.all([listarTerceros(tx, { busqueda: busqueda || undefined }), puedeEditarTerceros(tx)]),
  );

  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: '24px' }}>
      <h1>Terceros</h1>
      <p>
        Proveedores y demás terceros de esta empresa. La dirección y el municipio son obligatorios
        desde la creación (Res. 000227/2025, art. 1.3.5.2.1, Formato 1001 de exógena). Los atributos
        fiscales (declarante, autorretenedor, agente de retención...) se declaran aparte, por
        vigencia: entre a un tercero para verlos o registrar una vigencia nueva.
      </p>

      <MensajeError error={cadena(sp, 'error') || undefined} />
      {cadena(sp, 'ok') === '1' && (
        <p style={{ color: '#166534', border: '1px solid #166534', padding: '8px 12px' }}>Guardado.</p>
      )}

      <form method="get" style={{ margin: '16px 0' }}>
        <input name="q" type="text" placeholder="Buscar por NIT o razón social" defaultValue={busqueda} />
        <button type="submit">Buscar</button>
      </form>

      {puedeEditar && (
        <p>
          <Link href="/terceros/nuevo">+ Crear tercero</Link>
        </p>
      )}

      <table style={{ borderCollapse: 'collapse' }} border={1} cellPadding={4}>
        <thead>
          <tr>
            <th>Documento</th>
            <th>Razón social</th>
            <th>Municipio</th>
            <th>Atributos fiscales</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {terceros.map((t) => (
            <tr key={t.id}>
              <td>
                {t.tipoDocumento} {t.numeroDocumento}
                {t.digitoVerificacion != null ? `-${t.digitoVerificacion}` : ''}
              </td>
              <td>{t.razonSocial}</td>
              <td>{t.esDelExterior ? 'Exterior' : t.municipalityNombre ?? '⚠ sin municipio'}</td>
              <td>
                {t.tieneAtributoFiscalVigente ? (
                  'Vigentes'
                ) : (
                  <strong style={{ color: '#b45309' }}>⚠ Sin vigencia — va a revisión manual</strong>
                )}
              </td>
              <td>
                <Link href={`/terceros/${t.id}`}>Ver / editar</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {terceros.length === 0 && <p>Ningún tercero coincide con la búsqueda.</p>}
    </main>
  );
}

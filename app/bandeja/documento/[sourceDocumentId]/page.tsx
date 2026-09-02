/**
 * A7 · D-079 — visor del documento original (XML UBL 2.1) de una factura.
 *
 * El sistema NO emite factura electrónica ante la DIAN; solo recibe y procesa.
 * Lo que llega es el XML, que se guarda en `source_document.xml_crudo`. Este
 * visor lo muestra formateado (indentado legible), no crudo. No hay PDF: la
 * representación gráfica no se persiste hoy — si un documento venía dentro de
 * un `AttachedDocument`, lo que se conserva es el XML de la factura, que es
 * justamente lo que se muestra aquí.
 *
 * La empresa llega por query (`?empresa=<companyId>`): un documento pertenece
 * a UNA empresa y el enlace de la bandeja ya la conoce. RLS decide la
 * visibilidad real dentro de `conSesionEmpresa` (D-021).
 */
import Link from 'next/link';
import { conSesionEmpresa } from '../../../lib/sesion';
import { obtenerDocumentoOriginal } from '../../../../src/services/consulta';
import { Encabezado, MensajeEstado, Panel } from '../../../_ui/componentes';
import { formatearXml } from './formato';

export const dynamic = 'force-dynamic';

type Params = Promise<{ sourceDocumentId: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function PaginaDocumentoOriginal({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}) {
  const { sourceDocumentId } = await params;
  const sp = await searchParams;
  const empresa = typeof sp.empresa === 'string' ? sp.empresa : '';

  let doc: Awaited<ReturnType<typeof obtenerDocumentoOriginal>> = null;
  let error: string | null = null;
  try {
    doc = await conSesionEmpresa(empresa, (tx) => obtenerDocumentoOriginal(tx, sourceDocumentId));
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="mx-auto max-w-5xl p-5">
      <Encabezado
        titulo="Documento original"
        descripcion={doc ? `Documento ${doc.numeroDocumento} · NIT emisor ${doc.emisorNit}` : undefined}
        acciones={
          <Link
            href="/bandeja"
            className="text-[13px] font-semibold text-primario underline dark:text-primario-tinta-oscura"
          >
            Volver a la bandeja
          </Link>
        }
      />

      {error && (
        <MensajeEstado tipo="error" titulo="No se pudo abrir el documento">
          {error}
        </MensajeEstado>
      )}

      {!error && !doc && (
        <MensajeEstado tipo="sin-datos" titulo="El documento no existe o no es visible desde esta empresa." />
      )}

      {doc && doc.xmlCrudo === null && (
        <MensajeEstado tipo="configuracion" titulo="El XML de este documento se archivó en frío">
          {doc.xmlAlmacenamiento === 'archivo_frio'
            ? `El XML ya no vive en la base de datos${
                doc.xmlArchivoUrl ? ` (puntero: ${doc.xmlArchivoUrl})` : ''
              }. Recupérelo desde el almacenamiento frío antes de consultarlo aquí.`
            : 'El documento no tiene XML almacenado.'}
        </MensajeEstado>
      )}

      {doc && doc.xmlCrudo !== null && (
        <Panel
          titulo="XML de la factura (UBL 2.1), formateado"
          descripcion="No es un PDF: el sistema recibe y procesa, no emite. Esta es la representación estructurada tal como llegó."
        >
          <pre className="max-h-[70vh] overflow-auto bg-superficie px-4 py-3 text-[12px] leading-relaxed text-texto">
            <code>{formatearXml(doc.xmlCrudo)}</code>
          </pre>
        </Panel>
      )}
    </div>
  );
}

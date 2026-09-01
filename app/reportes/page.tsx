/**
 * A9 — Punto de entrada mínimo a la descarga de reportes (cierre de V-16).
 *
 * Esto NO es la pantalla de reportería rica (eso es trabajo de A8): es lo
 * mínimo para que el criterio de salida de la Ola 3 deje de ser falso — que
 * un usuario autenticado, con el permiso `reporte.exportar`, pueda pedir y
 * obtener el `.xlsx` de cada uno de los ocho reportes obligatorios de la
 * sección 11.3 sin salir del navegador.
 *
 * Cada formulario es un GET plano contra `/api/reportes/<libro>` — la
 * empresa NUNCA viaja en el formulario, la toma la ruta de la cookie de
 * sesión ya verificada (D-021/D-022); aquí solo se piden fechas y filtros
 * propios de cada reporte.
 *
 * A16 (Ola 4, Tarea 6) le añade el PANEL DE AVISOS de arriba: qué configuración
 * falta y dónde se carga, ANTES de que el contador pida un reporte y se
 * encuentre un archivo que no dice lo que esperaba. Es el caso 1 de D-073
 * contado a tiempo, no a posteriori. Los avisos NO impiden descargar nada: lo
 * que sí impide descargar (no hay ni una cuenta imputable) lo rechaza la ruta
 * con su propio mensaje y su enlace.
 */
import Link from 'next/link';
import { conSesion } from '../lib/sesion';
import { tienePermiso, PERMISOS } from '../../src/auth/permisos';
import { avisosDeConfiguracion, type AvisoConfiguracion } from '../../src/reports/diagnostico';

export const dynamic = 'force-dynamic';

interface CampoReporte {
  nombre: string;
  etiqueta: string;
  tipo: 'date' | 'text' | 'number';
  requerido: boolean;
}

interface FormularioReporte {
  slug: string;
  titulo: string;
  campos: CampoReporte[];
}

const CAMPOS_RANGO: CampoReporte[] = [
  { nombre: 'desde', etiqueta: 'Desde', tipo: 'date', requerido: true },
  { nombre: 'hasta', etiqueta: 'Hasta', tipo: 'date', requerido: true },
];

const REPORTES_OBLIGATORIOS: FormularioReporte[] = [
  { slug: 'libro-diario', titulo: 'Libro diario', campos: CAMPOS_RANGO },
  { slug: 'libro-mayor', titulo: 'Libro mayor', campos: CAMPOS_RANGO },
  {
    slug: 'libro-auxiliar',
    titulo: 'Libro auxiliar por cuenta y tercero',
    campos: [
      ...CAMPOS_RANGO,
      { nombre: 'accountId', etiqueta: 'ID de cuenta (UUID)', tipo: 'text', requerido: true },
      { nombre: 'terceroId', etiqueta: 'ID de tercero (UUID, opcional)', tipo: 'text', requerido: false },
    ],
  },
  {
    slug: 'balance-prueba',
    titulo: 'Balance de prueba (cualquier nivel del PUC)',
    campos: [...CAMPOS_RANGO, { nombre: 'nivel', etiqueta: 'Nivel del PUC (1 a 5)', tipo: 'number', requerido: true }],
  },
  {
    slug: 'movimiento-terceros',
    titulo: 'Movimiento de terceros',
    campos: [...CAMPOS_RANGO, { nombre: 'terceroId', etiqueta: 'ID de tercero (UUID, opcional)', tipo: 'text', requerido: false }],
  },
  {
    slug: 'certificado-retenciones',
    titulo: 'Certificado de retenciones por tercero',
    campos: [...CAMPOS_RANGO, { nombre: 'terceroId', etiqueta: 'ID de tercero (UUID)', tipo: 'text', requerido: true }],
  },
  { slug: 'relacion-retenciones', titulo: 'Relación de retenciones practicadas por período', campos: CAMPOS_RANGO },
  { slug: 'detalle-iva', titulo: 'Detalle de IVA generado y descontable', campos: CAMPOS_RANGO },
];

function CampoInput({ campo }: { campo: CampoReporte }) {
  return (
    <label style={{ display: 'inline-flex', flexDirection: 'column', marginRight: 12, marginBottom: 8 }}>
      <span style={{ fontSize: 12 }}>
        {campo.etiqueta}
        {campo.requerido ? ' *' : ''}
      </span>
      <input name={campo.nombre} type={campo.tipo} required={campo.requerido} />
    </label>
  );
}

function FormularioDescarga({ reporte }: { reporte: FormularioReporte }) {
  return (
    <fieldset style={{ marginBottom: 16, padding: 12, border: '1px solid #ccc' }}>
      <legend>{reporte.titulo}</legend>
      <form method="get" action={`/api/reportes/${reporte.slug}`}>
        {reporte.campos.map((campo) => (
          <CampoInput key={campo.nombre} campo={campo} />
        ))}
        <div>
          <button type="submit">Descargar .xlsx</button>
        </div>
      </form>
    </fieldset>
  );
}

function PanelAvisos({ avisos }: { avisos: AvisoConfiguracion[] }) {
  if (avisos.length === 0) return null;
  return (
    <section
      aria-label="Configuración pendiente que afecta a los reportes"
      style={{ border: '1px solid #b45309', background: '#fffbeb', padding: '12px 16px', margin: '16px 0' }}
    >
      <strong>
        Hay {avisos.length} cosa{avisos.length === 1 ? '' : 's'} sin configurar que cambia
        {avisos.length === 1 ? '' : 'n'} lo que verá en los reportes
      </strong>
      <ul>
        {avisos.map((a) => (
          <li key={a.enlace + a.falta} style={{ marginTop: 6 }}>
            <strong>{a.falta}</strong> {a.detalle} Afecta a {a.afectaA}.{' '}
            <Link href={a.enlace}>{a.enlaceTexto}</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function PaginaReportes() {
  const { puedeExportar, avisos } = await conSesion(async (tx) => {
    const puedeExportar = await tienePermiso(tx, PERMISOS.REPORTE_EXPORTAR);
    return { puedeExportar, avisos: puedeExportar ? await avisosDeConfiguracion(tx) : [] };
  });

  if (!puedeExportar) {
    return (
      <main style={{ maxWidth: 800, margin: '0 auto', padding: '24px' }}>
        <h1>Reportes</h1>
        <p>
          La sesión actual no tiene el permiso <code>reporte.exportar</code>. Pídalo al administrador de la firma
          o de la empresa.
        </p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 800, margin: '0 auto', padding: '24px' }}>
      <h1>Reportes</h1>

      <PanelAvisos avisos={avisos} />

      <p>
        Cada botón descarga el libro Excel de cuatro hojas (Datos, Papel de trabajo, Trazabilidad y Parámetros) de
        la empresa activa en su sesión — no se puede pedir el reporte de otra empresa desde este formulario ni
        editando la URL: la empresa la fija la sesión verificada, no un campo de este formulario (sección 11.2 y
        D-021/D-022).
      </p>
      <p>
        Si el período que pida no tiene movimiento, no se le entrega un archivo con la hoja en blanco: se le
        dice «no hay datos» con las fechas y el tercero que pidió, y se le ofrece descargarlo igual por si
        necesita el papel de trabajo vacío.
      </p>

      <h2>Los ocho reportes obligatorios (sección 11.3)</h2>
      {REPORTES_OBLIGATORIOS.map((r) => (
        <FormularioDescarga key={r.slug} reporte={r} />
      ))}

      <h2>Otros libros disponibles en la misma ruta</h2>
      <p>
        Los estados financieros bajo NIIF para las PYMES (A10) y los formatos de información exógena (A11) se
        descargan con el mismo contrato, contra <code>/api/reportes/&lt;libro&gt;</code>: <code>estado-situacion-financiera</code>,{' '}
        <code>estado-resultado-integral</code>, <code>estado-cambios-patrimonio</code>, <code>estado-flujos-efectivo</code>,{' '}
        <code>notas-estados-financieros</code>, <code>exogena-1001</code>, <code>exogena-1003</code>,{' '}
        <code>exogena-1005</code>, <code>exogena-1006</code>, <code>exogena-1007</code>, <code>exogena-1008</code> y{' '}
        <code>exogena-1009</code>. Esta pantalla no trae todavía un formulario para esos doce (es trabajo de A8);
        se pueden pedir hoy con la URL directa y sus parámetros documentados en{' '}
        <code>app/api/reportes/[libro]/route.ts</code>.
      </p>
    </main>
  );
}

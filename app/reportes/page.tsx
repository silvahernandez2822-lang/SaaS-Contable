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
 */
import { conSesion } from '../lib/sesion';
import { tienePermiso, PERMISOS } from '../../src/auth/permisos';

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

export default async function PaginaReportes() {
  const puedeExportar = await conSesion((tx) => tienePermiso(tx, PERMISOS.REPORTE_EXPORTAR));

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
      <p>
        Cada botón descarga el libro Excel de cuatro hojas (Datos, Papel de trabajo, Trazabilidad y Parámetros) de
        la empresa activa en su sesión — no se puede pedir el reporte de otra empresa desde este formulario ni
        editando la URL: la empresa la fija la sesión verificada, no un campo de este formulario (sección 11.2 y
        D-021/D-022).
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

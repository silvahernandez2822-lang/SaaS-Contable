/**
 * A9 — D-091. Catálogo central de reportes, migrado al shell nuevo (D-085 en
 * adelante) y ampliado sobre la base mínima de la Ola 3 (V-16).
 *
 * TAREA 0 (investigación, resumen — detalle completo en ESTADO_PROYECTO.md
 * D-091): `/api/reportes/[libro]` YA generaba veinte libros (los ocho
 * obligatorios de la 11.3, cinco estados financieros de A10, siete formatos
 * de exógena de A11), todos con el rastro EXPORT (`app.registrar_exportacion`)
 * y la RLS de sesión (D-021/D-022). Lo que faltaba era la PANTALLA: esta
 * seguía siendo un formulario plano de solo ocho reportes, sin agrupar, sin
 * los otros doce, sin ICA por municipio (que no existía en ninguna parte —
 * D-088 dejó el modelo de datos pero ningún reporte lo leía), sin historial y
 * sin migrar al kit de `app/_ui/`. Esta pantalla NO duplica lógica de
 * generación de ningún reporte: cada formulario sigue siendo un `<form
 * method="get">` plano contra `/api/reportes/<slug>` (o, para los dos
 * maestros, contra sus rutas propias ya auditadas — ver más abajo), la misma
 * ruta que ya existía.
 *
 * TAREA 4 (filtros/periodo/empresa): la empresa NUNCA es un campo de
 * formulario aquí ni en ningún reporte — sale exclusivamente de la sesión
 * verificada (D-021/D-022), así que no hay superficie para manipularla por
 * URL ni por POST (la ruta central solo acepta GET). El período (rango de
 * fechas, año gravable o corte, según el reporte) sí es un campo, propio de
 * cada formulario.
 *
 * TAREA 6 (permisos) — DECISIÓN: no se creó un permiso nuevo. `reporte.leer`
 * ya existe desde la migración 014 con el comentario «queda libre para una
 * futura vista en pantalla que no produzca archivo» — es EXACTAMENTE esta
 * pantalla. Crear `reportes.acceder` habría sido el duplicado que la tarea
 * pedía evitar. Relación con `reporte.exportar`: `reporte.leer` gobierna
 * VER este catálogo (y sus avisos de configuración); `reporte.exportar` sigue
 * gobernando, catálogo por catálogo, cada descarga real — lo impone la base
 * de datos dentro de cada `generarXxx` y dentro de `registrar_exportacion`
 * (migración 140), no esta pantalla. Un usuario con `reporte.leer` pero sin
 * `reporte.exportar` ve el catálogo con los botones marcados «Sin permiso
 * reporte.exportar» — no rotos, informativos, mismo patrón que `/carga-masiva`
 * (D-090) con sus permisos por catálogo.
 */
import Link from 'next/link';
import { conSesion } from '../lib/sesion';
import { tienePermiso, PERMISOS } from '../../src/auth/permisos';
import { avisosDeConfiguracion, type AvisoConfiguracion } from '../../src/reports/diagnostico';
import { Badge, Boton, Encabezado, EnlaceBoton, MensajeEstado, Panel } from '../_ui/componentes';

export const dynamic = 'force-dynamic';

interface CampoReporte {
  nombre: string;
  etiqueta: string;
  tipo: 'date' | 'text' | 'number';
  requerido: boolean;
  placeholder?: string;
}

interface ReporteCatalogo {
  slug: string;
  titulo: string;
  descripcion: string;
  campos: CampoReporte[];
}

interface Categoria {
  nombre: string;
  descripcion: string;
  reportes: ReporteCatalogo[];
}

const CAMPOS_RANGO: CampoReporte[] = [
  { nombre: 'desde', etiqueta: 'Desde', tipo: 'date', requerido: true },
  { nombre: 'hasta', etiqueta: 'Hasta', tipo: 'date', requerido: true },
];

const CAMPO_TERCERO_OPCIONAL: CampoReporte = {
  nombre: 'terceroId',
  etiqueta: 'ID de tercero (UUID, opcional)',
  tipo: 'text',
  requerido: false,
};

const CATEGORIAS: Categoria[] = [
  {
    nombre: 'Libros contables',
    descripcion: 'El registro del ledger tal como quedó publicado — sin ningún cálculo tributario adicional.',
    reportes: [
      { slug: 'libro-diario', titulo: 'Libro diario', descripcion: 'Todas las partidas publicadas del período, en orden cronológico.', campos: CAMPOS_RANGO },
      { slug: 'libro-mayor', titulo: 'Libro mayor', descripcion: 'Movimiento agrupado por cuenta.', campos: CAMPOS_RANGO },
      {
        slug: 'libro-auxiliar',
        titulo: 'Libro auxiliar por cuenta y tercero',
        descripcion: 'El detalle de una cuenta, opcionalmente filtrado a un tercero, con saldo acumulado.',
        campos: [
          ...CAMPOS_RANGO,
          { nombre: 'accountId', etiqueta: 'ID de cuenta (UUID)', tipo: 'text', requerido: true },
          CAMPO_TERCERO_OPCIONAL,
        ],
      },
      {
        slug: 'balance-prueba',
        titulo: 'Balance de prueba (cualquier nivel del PUC)',
        descripcion: 'Saldos iniciales, movimiento del período y saldo final, al nivel de agrupación del PUC que elija (1 a 5).',
        campos: [...CAMPOS_RANGO, { nombre: 'nivel', etiqueta: 'Nivel del PUC (1 a 5)', tipo: 'number', requerido: true, placeholder: '3' }],
      },
    ],
  },
  {
    nombre: 'Terceros, retenciones e IVA',
    descripcion: 'Reportes con cálculo tributario: cada uno trae su hoja de Trazabilidad con la regla y la vigencia aplicadas.',
    reportes: [
      { slug: 'movimiento-terceros', titulo: 'Movimiento de terceros', descripcion: 'Detalle y resumen de saldos por tercero.', campos: [...CAMPOS_RANGO, CAMPO_TERCERO_OPCIONAL] },
      {
        slug: 'certificado-retenciones',
        titulo: 'Certificado de retenciones por tercero',
        descripcion: 'Todas las retenciones practicadas a un tercero — el documento que se le entrega.',
        campos: [...CAMPOS_RANGO, { nombre: 'terceroId', etiqueta: 'ID de tercero (UUID)', tipo: 'text', requerido: true }],
      },
      { slug: 'relacion-retenciones', titulo: 'Relación de retenciones por período y tipo', descripcion: 'Todo tercero, aplicada o no (incluye el motivo cuando no aplicó).', campos: CAMPOS_RANGO },
      { slug: 'detalle-iva', titulo: 'Detalle de IVA generado y descontable', descripcion: 'IVA tal como llegó en el documento fuente, generado vs. descontable.', campos: CAMPOS_RANGO },
      {
        slug: 'ica-municipio',
        titulo: 'ICA retenido por municipio',
        descripcion: 'ReteICA aplicada, agrupada por municipio — para la declaración ante cada municipio (D-088/D-091).',
        campos: CAMPOS_RANGO,
      },
    ],
  },
  {
    nombre: 'Estados financieros (NIIF para las PYMES)',
    descripcion: 'Ensamblados sobre el mismo ledger, con la clasificación NIIF vigente a la fecha de corte.',
    reportes: [
      { slug: 'estado-situacion-financiera', titulo: 'Estado de situación financiera', descripcion: 'Corte a una fecha, con comparativo opcional.', campos: [{ nombre: 'fechaCorte', etiqueta: 'Corte a', tipo: 'date', requerido: true }, { nombre: 'fechaCorteComparativa', etiqueta: 'Corte comparativo (opcional)', tipo: 'date', requerido: false }] },
      { slug: 'estado-resultado-integral', titulo: 'Estado de resultado integral', descripcion: 'Por función o por naturaleza.', campos: [...CAMPOS_RANGO, { nombre: 'presentacion', etiqueta: 'Presentación ("funcion" o "naturaleza")', tipo: 'text', requerido: false }] },
      { slug: 'estado-cambios-patrimonio', titulo: 'Estado de cambios en el patrimonio', descripcion: '', campos: CAMPOS_RANGO },
      { slug: 'estado-flujos-efectivo', titulo: 'Estado de flujos de efectivo', descripcion: '', campos: CAMPOS_RANGO },
      { slug: 'notas-estados-financieros', titulo: 'Notas a los estados financieros', descripcion: 'Revelaciones y papeles de trabajo del período.', campos: [...CAMPOS_RANGO, { nombre: 'presentacion', etiqueta: 'Presentación ERI ("funcion" o "naturaleza")', tipo: 'text', requerido: false }] },
    ],
  },
  {
    nombre: 'Información exógena (DIAN)',
    descripcion: 'Formatos del año gravable, listos para el prevalidador.',
    reportes: [
      { slug: 'exogena-1001', titulo: 'Formato 1001 — pagos y retenciones', descripcion: '', campos: [...CAMPOS_RANGO, { nombre: 'anioGravable', etiqueta: 'Año gravable', tipo: 'number', requerido: true, placeholder: '2026' }] },
      { slug: 'exogena-1003', titulo: 'Formato 1003 — retenciones practicadas', descripcion: '', campos: [...CAMPOS_RANGO, { nombre: 'anioGravable', etiqueta: 'Año gravable', tipo: 'number', requerido: true, placeholder: '2026' }] },
      { slug: 'exogena-1005', titulo: 'Formato 1005 — IVA descontable', descripcion: '', campos: [...CAMPOS_RANGO, { nombre: 'anioGravable', etiqueta: 'Año gravable', tipo: 'number', requerido: true, placeholder: '2026' }] },
      { slug: 'exogena-1006', titulo: 'Formato 1006 — IVA generado', descripcion: '', campos: [...CAMPOS_RANGO, { nombre: 'anioGravable', etiqueta: 'Año gravable', tipo: 'number', requerido: true, placeholder: '2026' }] },
      { slug: 'exogena-1007', titulo: 'Formato 1007 — ingresos', descripcion: '', campos: [...CAMPOS_RANGO, { nombre: 'anioGravable', etiqueta: 'Año gravable', tipo: 'number', requerido: true, placeholder: '2026' }] },
      { slug: 'exogena-1008', titulo: 'Formato 1008 — saldo de cuentas por cobrar', descripcion: '', campos: [{ nombre: 'fechaCorte', etiqueta: 'Corte a', tipo: 'date', requerido: true }, { nombre: 'anioGravable', etiqueta: 'Año gravable', tipo: 'number', requerido: true, placeholder: '2026' }] },
      { slug: 'exogena-1009', titulo: 'Formato 1009 — saldo de cuentas por pagar', descripcion: '', campos: [{ nombre: 'fechaCorte', etiqueta: 'Corte a', tipo: 'date', requerido: true }, { nombre: 'anioGravable', etiqueta: 'Año gravable', tipo: 'number', requerido: true, placeholder: '2026' }] },
    ],
  },
];

/** Maestros con su propia ruta ya auditada (V-54): no van por `/api/reportes/[libro]`,
 *  pero esta pantalla los CENTRALIZA como acceso directo, sin duplicar su generación. */
const MAESTROS: Array<{ titulo: string; descripcion: string; href: string; permiso: string }> = [
  {
    titulo: 'PUC efectivo (catálogo de cuentas resuelto)',
    descripcion: 'Precedencia empresa > firma > global ya aplicada, con clasificación NIIF vigente.',
    href: '/api/parametros/puc/exportar',
    permiso: PERMISOS.PARAMETRO_PUC_LEER,
  },
  {
    titulo: 'Maestro de terceros',
    descripcion: 'Todos los terceros de la empresa activa, con sus atributos fiscales vigentes.',
    href: '/api/terceros/exportar',
    permiso: PERMISOS.TERCERO_LEER,
  },
];

function CampoInput({ campo }: { campo: CampoReporte }) {
  return (
    <label className="flex flex-col gap-1 text-[12px]">
      <span className="font-medium text-texto">
        {campo.etiqueta}
        {campo.requerido && <span className="text-error-tinta"> *</span>}
      </span>
      <input
        name={campo.nombre}
        type={campo.tipo}
        required={campo.requerido}
        placeholder={campo.placeholder}
        className="rounded-md border border-borde bg-superficie-elevada px-2.5 py-1.5 text-[13px] text-texto focus:border-primario focus:outline-none focus:ring-2 focus:ring-primario/20"
      />
    </label>
  );
}

function FilaReporte({ reporte, puedeExportar }: { reporte: ReporteCatalogo; puedeExportar: boolean }) {
  return (
    <div className="border-t border-borde/60 px-5 py-4 first:border-t-0">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="font-semibold text-texto">{reporte.titulo}</p>
          {reporte.descripcion && <p className="text-metadata text-texto-suave">{reporte.descripcion}</p>}
        </div>
        {!puedeExportar && <Badge tono="error">Sin permiso {PERMISOS.REPORTE_EXPORTAR}</Badge>}
      </div>
      {puedeExportar ? (
        <form method="get" action={`/api/reportes/${reporte.slug}`} className="flex flex-wrap items-end gap-3">
          {reporte.campos.map((campo) => (
            <CampoInput key={campo.nombre} campo={campo} />
          ))}
          <Boton tipo="submit" className="text-[13px]">
            Descargar .xlsx
          </Boton>
        </form>
      ) : null}
    </div>
  );
}

function PanelAvisos({ avisos }: { avisos: AvisoConfiguracion[] }) {
  if (avisos.length === 0) return null;
  return (
    <div className="mb-6">
      <MensajeEstado
        tipo="configuracion"
        titulo={`Hay ${avisos.length} cosa${avisos.length === 1 ? '' : 's'} sin configurar que cambia${avisos.length === 1 ? '' : 'n'} lo que verá en los reportes`}
      >
        <ul className="list-disc space-y-1.5 pl-5">
          {avisos.map((a) => (
            <li key={a.enlace + a.falta}>
              <strong>{a.falta}</strong> {a.detalle} Afecta a {a.afectaA}.{' '}
              <Link href={a.enlace} className="font-medium underline">
                {a.enlaceTexto}
              </Link>
            </li>
          ))}
        </ul>
      </MensajeEstado>
    </div>
  );
}

export default async function PaginaReportes() {
  const { puedeVer, puedeExportar, puedeVerHistorial, permisosMaestros, avisos } = await conSesion(async (tx) => {
    const puedeLeer = await tienePermiso(tx, PERMISOS.REPORTE_LEER);
    const puedeExportar = await tienePermiso(tx, PERMISOS.REPORTE_EXPORTAR);
    const puedeVer = puedeLeer || puedeExportar;
    const puedePuc = await tienePermiso(tx, PERMISOS.PARAMETRO_PUC_LEER);
    const puedeTerceros = await tienePermiso(tx, PERMISOS.TERCERO_LEER);
    return {
      puedeVer,
      puedeExportar,
      puedeVerHistorial: await tienePermiso(tx, PERMISOS.AUDITORIA_LEER),
      permisosMaestros: { [PERMISOS.PARAMETRO_PUC_LEER]: puedePuc, [PERMISOS.TERCERO_LEER]: puedeTerceros } as Record<string, boolean>,
      avisos: puedeVer ? await avisosDeConfiguracion(tx) : [],
    };
  });

  if (!puedeVer) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-8">
        <Encabezado titulo="Reportes" />
        <MensajeEstado tipo="configuracion" titulo="Falta el permiso para entrar a este módulo">
          Se necesita <code>{PERMISOS.REPORTE_LEER}</code> (para ver el catálogo) o{' '}
          <code>{PERMISOS.REPORTE_EXPORTAR}</code> (para descargar). Pídaselo al administrador de la firma.
        </MensajeEstado>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <Encabezado
        titulo="Reportes"
        descripcion="Cada libro se descarga en Excel de cuatro hojas (Datos, Papel de trabajo, Trazabilidad y Parámetros) de la empresa activa en su sesión. La empresa nunca es un campo de este formulario: la fija la sesión verificada, no se puede pedir el reporte de otra empresa editando la URL (D-021/D-022)."
        acciones={
          puedeVerHistorial ? (
            <EnlaceBoton href="/reportes/historial" variante="fantasma">
              Ver historial de reportes
            </EnlaceBoton>
          ) : undefined
        }
      />

      <PanelAvisos avisos={avisos} />

      {!puedeExportar && (
        <div className="mb-6">
          <MensajeEstado tipo="configuracion" titulo="Solo lectura del catálogo">
            Su sesión no tiene <code>{PERMISOS.REPORTE_EXPORTAR}</code>: puede ver qué reportes existen, pero no
            descargarlos. Pídaselo al administrador de la firma.
          </MensajeEstado>
        </div>
      )}

      <div className="flex flex-col gap-6">
        {CATEGORIAS.map((cat) => (
          <Panel key={cat.nombre} titulo={cat.nombre}>
            <p className="border-b border-borde/60 px-5 py-3 text-metadata text-texto-suave">{cat.descripcion}</p>
            {cat.reportes.map((r) => (
              <FilaReporte key={r.slug} reporte={r} puedeExportar={puedeExportar} />
            ))}
          </Panel>
        ))}

        <Panel titulo="Maestros de catálogo">
          <p className="border-b border-borde/60 px-5 py-3 text-metadata text-texto-suave">
            Acceso centralizado a dos exportaciones que viven en sus propios módulos (PUC y Terceros): no
            duplican lógica de generación, solo enlazan a la misma ruta ya auditada de cada una.
          </p>
          {MAESTROS.map((m) => {
            const puedeEste = puedeExportar && (permisosMaestros[m.permiso] ?? false);
            return (
              <div key={m.href} className="flex items-center justify-between gap-3 border-t border-borde/60 px-5 py-4 first:border-t-0">
                <div>
                  <p className="font-semibold text-texto">{m.titulo}</p>
                  <p className="text-metadata text-texto-suave">{m.descripcion}</p>
                </div>
                {puedeEste ? (
                  <a
                    href={m.href}
                    className="whitespace-nowrap rounded-md border border-primario px-3 py-1.5 text-[13px] font-medium text-primario hover:bg-primario/10 dark:text-primario-tinta-oscura"
                  >
                    Descargar .xlsx
                  </a>
                ) : (
                  <Badge tono="error">Sin permiso {m.permiso}</Badge>
                )}
              </div>
            );
          })}
        </Panel>
      </div>
    </main>
  );
}

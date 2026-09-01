'use client';

/**
 * A16 — Navegación compartida (Ola 4, Tarea 0).
 *
 * PROBLEMA QUE CIERRA. `/bandeja`, `/reportes` y varias pantallas de
 * `/parametros` no tenían ni un enlace de vuelta: quien entraba se quedaba
 * ahí y tenía que editar la barra de direcciones. `/terceros/[id]/**` sí
 * tenía un «« Volver», pero escrito a mano en cada página, así que cada
 * pantalla nueva podía olvidarlo — y varias lo olvidaron.
 *
 * POR QUÉ VIVE EN EL LAYOUT RAÍZ Y NO EN CADA PÁGINA. Un breadcrumb repetido
 * por página es un contrato que nadie impone: se cumple hasta que alguien
 * añade una ruta. Puesto en `app/layout.tsx`, TODA ruta lo hereda por
 * construcción, incluidas las que se añadan después de esta ola.
 *
 * POR QUÉ ES UN COMPONENTE DE CLIENTE. Es el único punto de este proyecto que
 * necesita saber la ruta ACTUAL, y en el App Router eso solo lo da
 * `usePathname()`. Es una excepción deliberada y acotada: no lee datos, no
 * abre sesión y no decide nada de seguridad — si un usuario ve aquí la
 * palabra «Administración» pero no tiene `usuario.administrar`, la página de
 * destino lo rechaza igual (el permiso lo impone el motor, no este menú).
 *
 * QUÉ PASA SI SE AÑADE UNA RUTA Y NADIE TOCA `ETIQUETAS`. El breadcrumb
 * degrada a mostrar el segmento crudo de la URL, con su enlace de vuelta
 * funcionando. Nunca desaparece el camino de regreso: eso es lo que se estaba
 * arreglando.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Rutas donde una barra de navegación sobra o estorba. */
const SIN_NAVEGACION = new Set(['/entrar']);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Etiqueta legible de cada segmento. La clave es el segmento, no la ruta
 * completa, salvo cuando dos módulos comparten nombre de segmento (hoy
 * ninguno lo hace).
 */
const ETIQUETAS: Record<string, string> = {
  bandeja: 'Bandeja de causación',
  parametros: 'Parámetros',
  tarifas: 'Tarifas',
  'valores-base': 'Valores base',
  'reteica-municipios': 'ReteICA por municipio',
  puc: 'Plan de cuentas (PUC)',
  terceros: 'Terceros',
  nuevo: 'Nuevo',
  actividades: 'Actividad económica',
  'atributos-fiscales': 'Atributos fiscales',
  reportes: 'Reportes',
  'carga-masiva': 'Carga masiva',
  admin: 'Administración',
  usuarios: 'Usuarios',
  roles: 'Roles y permisos',
  correcciones: 'Correcciones por revisar',
  retefuente: 'Retefuente',
  retefuente_salarios: 'Retefuente de salarios',
  autorretencion: 'Autorretención',
  reteiva: 'ReteIVA',
  reteica: 'ReteICA',
  iva: 'IVA',
};

function etiquetaDe(segmento: string): string {
  if (ETIQUETAS[segmento]) return ETIQUETAS[segmento];
  if (UUID.test(segmento)) return 'Detalle';
  return decodeURIComponent(segmento);
}

const ESTILO_BARRA: React.CSSProperties = {
  borderBottom: '1px solid #cbd5e1',
  background: '#f8fafc',
  padding: '8px 16px',
  marginBottom: '8px',
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  flexWrap: 'wrap',
  fontSize: '14px',
};

/** Enlaces fijos del producto. Los mismos que la portada, siempre a la vista. */
const MODULOS: Array<{ href: string; texto: string }> = [
  { href: '/bandeja', texto: 'Bandeja' },
  { href: '/terceros', texto: 'Terceros' },
  { href: '/parametros', texto: 'Parámetros' },
  { href: '/carga-masiva', texto: 'Carga masiva' },
  { href: '/reportes', texto: 'Reportes' },
  { href: '/admin/usuarios', texto: 'Administración' },
];

export function NavegacionGlobal() {
  const pathname = usePathname() ?? '/';
  if (SIN_NAVEGACION.has(pathname)) return null;

  const segmentos = pathname.split('/').filter(Boolean);
  const migas = segmentos.map((segmento, i) => ({
    href: `/${segmentos.slice(0, i + 1).join('/')}`,
    texto: etiquetaDe(segmento),
  }));

  // La miga actual (la última) no es un enlace: ya se está ahí.
  const anterior = migas.length >= 2 ? migas[migas.length - 2] : migas.length === 1 ? { href: '/', texto: 'Inicio' } : null;

  return (
    <nav aria-label="Navegación principal" style={ESTILO_BARRA}>
      {anterior && (
        <Link
          href={anterior.href}
          style={{ fontWeight: 600, border: '1px solid #64748b', borderRadius: 4, padding: '2px 10px' }}
        >
          « Volver a {anterior.texto}
        </Link>
      )}

      <ol style={{ display: 'flex', gap: 6, listStyle: 'none', margin: 0, padding: 0, flexWrap: 'wrap' }}>
        <li>
          <Link href="/">Inicio</Link>
        </li>
        {migas.map((m, i) => (
          <li key={m.href}>
            <span aria-hidden="true" style={{ margin: '0 6px', color: '#94a3b8' }}>
              /
            </span>
            {i === migas.length - 1 ? (
              <span aria-current="page">{m.texto}</span>
            ) : (
              <Link href={m.href}>{m.texto}</Link>
            )}
          </li>
        ))}
      </ol>

      <span style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
        {MODULOS.filter((m) => !pathname.startsWith(m.href)).map((m) => (
          <Link key={m.href} href={m.href} style={{ color: '#475569' }}>
            {m.texto}
          </Link>
        ))}
      </span>
    </nav>
  );
}

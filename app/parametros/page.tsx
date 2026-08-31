/**
 * A8 — Módulo de parametrización (sección 6): página de entrada.
 *
 * Un contador entra aquí, ve de un vistazo qué datos normativos faltan
 * (advertencia 17.5) y elige qué familia de parámetros editar. Cada enlace
 * de abajo dice, en el propio texto, si hoy es editable desde esta interfaz
 * o si todavía no — sección 6.3 exige decirlo con exactitud, no aparentar
 * que todo está terminado.
 */
import Link from 'next/link';
import { conSesion } from '../lib/sesion';
import { detectarAlertasParametrizacion } from '../../src/services/parametrizacion';
import { BannerAlertas } from './_componentes';

export const dynamic = 'force-dynamic';

const TIPOS_TAX_RULE: Array<{ tipo: string; titulo: string }> = [
  { tipo: 'retefuente', titulo: 'Retención en la fuente a título de renta' },
  { tipo: 'retefuente_salarios', titulo: 'Retención en la fuente por salarios (tabla progresiva, art. 383 ET)' },
  { tipo: 'autorretencion', titulo: 'Autorretención de renta por CIIU' },
  { tipo: 'reteiva', titulo: 'Retención de IVA (ReteIVA)' },
  { tipo: 'reteica', titulo: 'ReteICA — tarifas por actividad económica' },
  { tipo: 'iva', titulo: 'IVA — tarifas' },
];

export default async function PaginaParametros() {
  const alertas = await conSesion((tx) => detectarAlertasParametrizacion(tx));

  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: '24px' }}>
      <h1>Parametrización tributaria</h1>
      <p>
        Toda edición de esta sección cierra la vigencia anterior e inserta una vigencia nueva —
        nunca se sobrescribe un valor ya vigente (sección 6.2). Solo el administrador tributario
        (o el administrador de la firma) puede guardar cambios; el motor lo exige, no esta pantalla.
      </p>

      <BannerAlertas alertas={alertas} />

      <h2>Editables desde esta interfaz</h2>
      <ul>
        {TIPOS_TAX_RULE.map((t) => (
          <li key={t.tipo}>
            <Link href={`/parametros/tarifas/${t.tipo}`}>{t.titulo}</Link>
          </li>
        ))}
        <li>
          <Link href="/parametros/valores-base">Valores base (UVT, SMMLV y auxilio de transporte, redondeo)</Link>
        </li>
        <li>
          <Link href="/parametros/reteica-municipios">
            ReteICA — catálogo de municipios, bases mínimas y tarifa general
          </Link>
        </li>
        <li>
          <Link href="/terceros">
            Terceros — maestro de proveedores, atributos fiscales versionados y actividad económica
            por municipio (cierre de V-17)
          </Link>
        </li>
      </ul>

      <h2>Todavía NO editables desde esta interfaz</h2>
      <p>
        El modelo de datos ya soporta vigencias append-only, permiso restringido y auditoría para
        estas tablas (A2/A12, Ola 0), pero esta ola no construyó su pantalla de edición:
      </p>
      <ul>
        <li>Plan de cuentas (PUC) completo y su mapeo a NIIF para PYMES.</li>
        <li>Catálogo CIIU y catálogo de municipios (alta de identidad nueva; ver más abajo la edición de sus reglas de ICA).</li>
        <li>Matriz de agentes de retención de ReteIVA por tipo de tercero.</li>
        <li>Calendario tributario (vencimientos por año, obligación y último dígito de NIT).</li>
        <li>Formatos de exógena y el mapeo de cuentas PUC a sus conceptos.</li>
        <li>Conceptos de causación (el puente entre un documento y las reglas tributarias).</li>
      </ul>
    </main>
  );
}

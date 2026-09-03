/**
 * A8 — Módulo de parametrización (sección 6): página de entrada.
 *
 * Un contador entra aquí, ve de un vistazo qué datos normativos faltan
 * (advertencia 17.5) y elige qué familia de parámetros editar. Cada enlace
 * dice, en el propio texto, si hoy es editable desde esta interfaz o no
 * (sección 6.3 exige decirlo con exactitud).
 *
 * D-087 · TAREA 0 — cuerpo migrado al kit de `app/_ui/` (tokens de tema,
 * `Encabezado`, `Panel`). Cero `style` inline, cero `#hex`.
 */
import Link from 'next/link';
import { conSesion } from '../lib/sesion';
import { detectarAlertasParametrizacion } from '../../src/services/parametrizacion';
import { Encabezado, Panel } from '../_ui/componentes';
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

const CLASE_ENLACE = 'text-primario underline dark:text-primario-tinta-oscura';

export default async function PaginaParametros() {
  const alertas = await conSesion((tx) => detectarAlertasParametrizacion(tx));

  return (
    <div className="mx-auto max-w-4xl p-5">
      <Encabezado
        titulo="Parametrización tributaria"
        descripcion="Toda edición cierra la vigencia anterior e inserta una nueva — nunca se sobrescribe un valor vigente (sección 6.2). Antes de guardar se muestra el simulador de impacto. Solo el administrador tributario (o el de la firma) puede guardar; lo exige el motor, no esta pantalla."
      />

      <BannerAlertas alertas={alertas} />

      <div className="flex flex-col gap-4">
        <Panel titulo="Editables desde esta interfaz">
          <ul className="list-disc space-y-2 p-5 pl-9 text-cuerpo text-texto">
            {TIPOS_TAX_RULE.map((t) => (
              <li key={t.tipo}>
                <Link className={CLASE_ENLACE} href={`/parametros/tarifas/${t.tipo}`}>
                  {t.titulo}
                </Link>
              </li>
            ))}
            <li>
              <Link className={CLASE_ENLACE} href="/parametros/valores-base">
                Valores base (UVT, SMMLV y auxilio de transporte, redondeo)
              </Link>
            </li>
            <li>
              <Link className={CLASE_ENLACE} href="/parametros/reteica-municipios">
                ReteICA — catálogo de municipios, bases mínimas y tarifa general
              </Link>
            </li>
            <li>
              <Link className={CLASE_ENLACE} href="/parametros/ica-municipios">
                ICA por municipio — bases mínimas, medición por factura/periodo y tabla de actividades
                gravadas (con carga masiva de un municipio completo)
              </Link>
            </li>
            <li>
              <Link className={CLASE_ENLACE} href="/parametros/puc">
                Plan de cuentas (PUC) — genérico de la firma y propio de cada empresa, con su regla de
                precedencia
              </Link>
            </li>
            <li>
              <Link className={CLASE_ENLACE} href="/carga-masiva">
                Carga masiva — quince catálogos con plantilla de Excel
              </Link>
            </li>
            <li>
              <Link className={CLASE_ENLACE} href="/terceros">
                Terceros — maestro de proveedores, atributos fiscales versionados y actividad económica
              </Link>
            </li>
          </ul>
        </Panel>

        <Panel titulo="Editables solo por archivo (carga masiva), todavía sin pantalla propia">
          <div className="space-y-2 p-5 text-cuerpo text-texto-suave">
            <p>
              A16 (Ola 4) les dio plantilla de Excel, validación fila a fila y auditoría de la carga,
              pero no una pantalla de edición individual. Se editan subiendo un archivo en{' '}
              <Link className={CLASE_ENLACE} href="/carga-masiva">
                carga masiva
              </Link>
              :
            </p>
            <ul className="list-disc space-y-1 pl-6">
              <li>Catálogo de municipios (DANE) y catálogo CIIU: alta de identidad nueva.</li>
              <li>Conceptos tributarios (el «qué se retiene» del que cuelgan las tarifas).</li>
              <li>Calendario tributario (vencimientos por año, obligación y último dígito de NIT).</li>
              <li>Mapeo de cuentas PUC a NIIF para PYMES, y centros de costo.</li>
            </ul>
          </div>
        </Panel>

        <Panel titulo="Todavía NO editables desde esta interfaz">
          <div className="space-y-2 p-5 text-cuerpo text-texto-suave">
            <p>
              El modelo de datos ya soporta vigencias append-only, permiso restringido y auditoría
              para estas tablas (A2/A12, Ola 0), pero ninguna ola ha construido su pantalla de edición
              ni su plantilla:
            </p>
            <ul className="list-disc space-y-1 pl-6">
              <li>Matriz de agentes de retención de ReteIVA por tipo de tercero.</li>
              <li>Formatos de exógena y el mapeo de cuentas PUC a sus conceptos.</li>
              <li>Conceptos de causación (el puente entre un documento y las reglas tributarias).</li>
            </ul>
          </div>
        </Panel>
      </div>
    </div>
  );
}

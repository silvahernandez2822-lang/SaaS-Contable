'use client';

/**
 * A8 — Piezas de la interfaz de parametrización.
 *
 * D-087 · TAREA 0 — migradas al kit de `app/_ui/` (tokens de tema, `Badge`,
 * `MensajeEstado`, `Modal`). Cero `style` inline, cero `#hex`: el subárbol
 * `/parametros` responde a `data-tema="oscuro"` igual que `/` y `/bandeja`.
 *
 * D-087 · TAREA 1 — cada badge FALTA DATO / VERIFICAR del `BannerAlertas` es
 * clicable: abre un `Modal` con un texto corto y un `EnlaceBoton` al submódulo
 * que corrige ese dato (derivado de `AlertaParametro.categoria`).
 */
import { useState } from 'react';
import type { AlertaParametro } from '../../src/services/parametrizacion';
import { Badge, EnlaceBoton, MensajeEstado, Modal } from '../_ui/componentes';

/** A qué submódulo lleva cada categoría de alerta (al submódulo, no al campo). */
function destinoDeCategoria(categoria: string): { href: string; submodulo: string } {
  if (categoria.startsWith('municipality_ica_rule')) {
    return { href: '/parametros/reteica-municipios', submodulo: 'ReteICA — municipios' };
  }
  if (categoria === 'tax_rule_reteica') {
    return { href: '/parametros/tarifas/reteica', submodulo: 'ReteICA — tarifas por actividad' };
  }
  if (categoria === 'retefuente_salarios') {
    return {
      href: '/parametros/tarifas/retefuente_salarios',
      submodulo: 'Retención por salarios (tabla progresiva)',
    };
  }
  if (categoria.startsWith('smmlv_value') || categoria.startsWith('uvt_value')) {
    return { href: '/parametros/valores-base', submodulo: 'Valores base (UVT, SMMLV, redondeo)' };
  }
  if (categoria === 'tax_calendar') {
    return { href: '/carga-masiva', submodulo: 'Carga masiva — calendario tributario' };
  }
  if (categoria.startsWith('tax_rule')) {
    return { href: '/parametros/tarifas/retefuente', submodulo: 'Tarifas de retención en la fuente' };
  }
  return { href: '/parametros', submodulo: 'Parametrización' };
}

/**
 * V-42 (A14, compuerta ampliada de D-087, hallazgo del NAVEGADOR contra la
 * Neon real). `detectarAlertasParametrizacion` emite UNA alerta por municipio
 * sin regla de ReteICA. Cuando `municipality` tenía las ~40 filas curadas por
 * A1 eso era una lista útil; con el catálogo DANE completo de D-086 (1.122
 * municipios) el banner pasó a renderizar más de mil badges —cada uno, desde
 * D-087, un `<button>` con su modal—, casi un mega de HTML, y las cuatro
 * alertas que el contador SÍ puede resolver hoy (tabla de salarios, SMMLV,
 * UVT, calendario) quedaban sepultadas. La advertencia 17.5 dice que lo que
 * falta se VEA; mil líneas idénticas consiguen justo lo contrario.
 *
 * Se agrupa POR CATEGORÍA sin ocultar nada: se listan las primeras y el resto
 * se resume en una línea que dice cuántas son y lleva al mismo submódulo. El
 * total real sigue en la cabecera y el servicio sigue devolviendo la verdad
 * completa (no se toca la semántica normativa: eso es de A1).
 */
const MAX_POR_CATEGORIA = 5;

interface Entrada {
  alerta: AlertaParametro;
  /** >0 cuando la fila resume el resto de su categoría. */
  restantes: number;
}

function agrupar(alertas: AlertaParametro[]): Entrada[] {
  const porCategoria = new Map<string, AlertaParametro[]>();
  for (const a of alertas) {
    const previas = porCategoria.get(a.categoria);
    if (previas) previas.push(a);
    else porCategoria.set(a.categoria, [a]);
  }
  const salida: Entrada[] = [];
  for (const [, lista] of porCategoria) {
    for (const a of lista.slice(0, MAX_POR_CATEGORIA)) salida.push({ alerta: a, restantes: 0 });
    if (lista.length > MAX_POR_CATEGORIA) {
      salida.push({ alerta: lista[MAX_POR_CATEGORIA]!, restantes: lista.length - MAX_POR_CATEGORIA });
    }
  }
  return salida;
}

export function BannerAlertas({ alertas }: { alertas: AlertaParametro[] }) {
  const [abierta, setAbierta] = useState<number | null>(null);
  if (alertas.length === 0) return null;

  const entradas = agrupar(alertas);
  const sel = abierta != null ? entradas[abierta] : null;
  const destino = sel ? destinoDeCategoria(sel.alerta.categoria) : null;

  return (
    <section
      aria-label="Alertas de datos pendientes de verificación humana"
      className="my-4 rounded-lg border border-pendiente/40 bg-pendiente/8 p-4"
    >
      <p className="text-cuerpo font-semibold text-texto">
        {alertas.length} alerta{alertas.length === 1 ? '' : 's'} de dato pendiente de verificación
        humana (sección 17.5: lo que falta se ve, no se rellena en silencio)
      </p>
      <ul className="mt-2 space-y-1.5">
        {entradas.map((e, i) => {
          const texto =
            e.restantes > 0
              ? `y ${e.restantes} más de este mismo tipo (${e.alerta.categoria}). Se corrigen todas desde el mismo submódulo.`
              : e.alerta.mensaje;
          return (
            <li key={`${e.alerta.categoria}-${i}`} className="text-menor text-texto-suave">
              <button
                type="button"
                onClick={() => setAbierta(i)}
                className="mr-2 align-middle"
                aria-label={`Ver a dónde ir para corregir: ${texto}`}
              >
                <Badge tono={e.alerta.severidad === 'alta' ? 'error' : 'pendiente'}>
                  {e.alerta.severidad === 'alta' ? 'FALTA DATO' : 'VERIFICAR'}
                </Badge>
              </button>
              {texto}
            </li>
          );
        })}
      </ul>

      {sel && destino && (
        <Modal
          titulo={sel.alerta.severidad === 'alta' ? 'Falta un dato normativo' : 'Dato por verificar'}
          descripcion="Nada se rellena en silencio (sección 17.5). Corríjalo desde su submódulo."
          onCerrar={() => setAbierta(null)}
          pie={
            <>
              <EnlaceBoton href={destino.href} variante="primario">
                Ir a: {destino.submodulo}
              </EnlaceBoton>
            </>
          }
        >
          {sel.restantes > 0 && (
            <p className="mb-2 text-menor font-semibold text-texto-suave">
              Quedan {sel.restantes} alertas más de este tipo. Una de ellas:
            </p>
          )}
          <p className="text-cuerpo text-texto">{sel.alerta.mensaje}</p>
        </Modal>
      )}
    </section>
  );
}

export function MensajeError({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <div className="my-3">
      <MensajeEstado tipo="error" titulo={decodeURIComponent(error)} />
    </div>
  );
}

export function MensajeGuardado({ titulo, children }: { titulo: string; children?: React.ReactNode }) {
  return (
    <div className="my-3">
      <MensajeEstado tipo="sin-datos" titulo={titulo}>
        {children}
      </MensajeEstado>
    </div>
  );
}

export function BadgeAlcance({ alcance }: { alcance: 'empresa' | 'firma' | 'global' }) {
  const etiqueta =
    alcance === 'empresa'
      ? 'Solo esta empresa'
      : alcance === 'firma'
        ? 'Compartida en la firma'
        : 'Tarifa nacional';
  return <Badge tono="neutro">{etiqueta}</Badge>;
}

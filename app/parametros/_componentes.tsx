/**
 * A8 — Piezas pequeñas y reutilizables de la interfaz de parametrización.
 * Sin librería de estilos (fuera de alcance de este módulo): HTML semántico
 * con `style` inline mínimo, para que A7 lo pueda reemplazar sin fricción.
 */
import type { AlertaParametro } from '../../src/services/parametrizacion';

export function BannerAlertas({ alertas }: { alertas: AlertaParametro[] }) {
  if (alertas.length === 0) return null;
  return (
    <section
      aria-label="Alertas de datos pendientes de verificación humana"
      style={{ border: '1px solid #b45309', background: '#fffbeb', padding: '12px 16px', margin: '16px 0' }}
    >
      <strong>
        {alertas.length} alerta{alertas.length === 1 ? '' : 's'} de dato pendiente de verificación
        humana (sección 17.5 del mega-prompt: lo que falta se ve, no se rellena en silencio)
      </strong>
      <ul>
        {alertas.map((a, i) => (
          <li key={`${a.categoria}-${i}`}>
            <span
              style={{
                display: 'inline-block',
                fontSize: '12px',
                fontWeight: 700,
                padding: '0 6px',
                marginRight: '6px',
                background: a.severidad === 'alta' ? '#dc2626' : '#d97706',
                color: 'white',
              }}
            >
              {a.severidad === 'alta' ? 'FALTA DATO' : 'VERIFICAR'}
            </span>
            {a.mensaje}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function MensajeError({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <p role="alert" style={{ color: '#b91c1c', border: '1px solid #b91c1c', padding: '8px 12px' }}>
      {decodeURIComponent(error)}
    </p>
  );
}

export function BadgeAlcance({ alcance }: { alcance: 'empresa' | 'firma' | 'global' }) {
  const etiqueta =
    alcance === 'empresa' ? 'Solo esta empresa' : alcance === 'firma' ? 'Compartida en la firma' : 'Tarifa nacional';
  return (
    <span
      style={{
        fontSize: '12px',
        border: '1px solid #64748b',
        borderRadius: '4px',
        padding: '0 6px',
      }}
    >
      {etiqueta}
    </span>
  );
}

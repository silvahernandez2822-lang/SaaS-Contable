'use client';

/**
 * D-087 · TAREA 3 — "Ver detalle" del simulador de impacto. El conteo
 * ("afecta N conceptos y M proveedores") ya se muestra en la pantalla; este
 * botón abre un `Modal` con las FILAS REALES (códigos + nombres) que hay
 * detrás de ese número, traídas por `app.detalle_impacto_*` con la misma
 * consulta base que el conteo — conteo y detalle no divergen.
 */
import { useState } from 'react';
import type { DetalleImpacto } from '../../src/services/parametrizacion';
import { Boton, EstadoVacio, Modal, Tabla, Td, Th } from '../_ui/componentes';

export function BotonDetalleImpacto({ detalle }: { detalle: DetalleImpacto }) {
  const [abierto, setAbierto] = useState(false);
  const total = detalle.conceptos.length + detalle.proveedores.length;

  return (
    <>
      <Boton tipo="button" variante="secundario" onClick={() => setAbierto(true)}>
        Ver detalle
      </Boton>
      {abierto && (
        <Modal
          titulo="Detalle del impacto"
          descripcion="Conceptos de causación y proveedores concretos afectados, contra datos reales de la firma (respeta RLS)."
          onCerrar={() => setAbierto(false)}
          ancho="max-w-2xl"
        >
          {total === 0 ? (
            <EstadoVacio
              titulo="Sin impacto medible todavía"
              detalle="Ningún concepto de causación de la firma usa esta regla y no hay retenciones con historial. Editarla es seguro."
            />
          ) : (
            <div className="space-y-5">
              <Seccion
                titulo={`Conceptos de causación (${detalle.conceptos.length})`}
                filas={detalle.conceptos}
                vacio="Ningún concepto de causación de la firma apunta a esta regla."
              />
              <Seccion
                titulo={`Proveedores con historial (${detalle.proveedores.length})`}
                filas={detalle.proveedores}
                vacio="Ningún proveedor tiene retenciones con historial contra esta regla."
              />
            </div>
          )}
        </Modal>
      )}
    </>
  );
}

function Seccion({
  titulo,
  filas,
  vacio,
}: {
  titulo: string;
  filas: Array<{ codigo: string; nombre: string }>;
  vacio: string;
}) {
  return (
    <div>
      <p className="mb-2 text-menor font-semibold text-texto-suave">{titulo}</p>
      {filas.length === 0 ? (
        <p className="text-menor text-texto-suave">{vacio}</p>
      ) : (
        <Tabla alturaMaxima="40vh">
          <thead>
            <tr>
              <Th>Código</Th>
              <Th>Nombre</Th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f, i) => (
              <tr key={`${f.codigo}-${i}`} className="border-t border-borde/60">
                <Td numerico>{f.codigo}</Td>
                <Td>{f.nombre}</Td>
              </tr>
            ))}
          </tbody>
        </Tabla>
      )}
    </div>
  );
}

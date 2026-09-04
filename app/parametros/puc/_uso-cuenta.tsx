'use client';

/**
 * D-089 · TAREA 4 — detalle del uso inverso de una cuenta del PUC.
 *
 * El badge "en uso" de cada fila sale de `app.cuenta_uso` (mismo criterio que
 * el motor). Este botón abre el `Modal` genérico de D-087 con el listado de
 * `concepto_causacion` que la usan (y en qué rol) y el conteo de partidas del
 * ledger que la referencian. Recibe todo ya resuelto por el servidor bajo RLS
 * — no hace ninguna consulta.
 */
import { useState } from 'react';
import { Badge, Boton, EstadoVacio, Modal, Tabla, Td, Th } from '../../_ui/componentes';
import type { ConceptoQueUsaCuenta, UsoCuenta } from '../../../src/services/puc';

const ROL_TEXTO: Record<string, string> = {
  gasto: 'Cuenta de gasto/costo',
  iva_descontable: 'IVA descontable',
  contrapartida: 'Contrapartida (CxP)',
};

export function IndicadorUso({ uso }: { uso: UsoCuenta | undefined }) {
  if (!uso || !uso.enUso) {
    return <span className="text-menor text-texto-suave">Sin uso</span>;
  }
  return (
    <span className="inline-flex flex-wrap gap-1">
      {uso.conceptosActivos > 0 && (
        <Badge tono="primario">
          {uso.conceptosActivos} concepto{uso.conceptosActivos === 1 ? '' : 's'}
        </Badge>
      )}
      {uso.tieneMovimientos && <Badge tono="neutro">{uso.partidasLedger} partida(s)</Badge>}
    </span>
  );
}

export function BotonUsoCuenta({
  codigo,
  nombre,
  uso,
  conceptos,
}: {
  codigo: string;
  nombre: string;
  uso: UsoCuenta;
  conceptos: ConceptoQueUsaCuenta[];
}) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <Boton tipo="button" variante="terciario" onClick={() => setAbierto(true)}>
        Ver uso
      </Boton>
      {abierto && (
        <Modal
          titulo={`Uso de la cuenta ${codigo}`}
          descripcion={`${nombre} — qué depende de esta cuenta hoy (respeta RLS: solo conceptos de esta firma).`}
          onCerrar={() => setAbierto(false)}
          ancho="max-w-2xl"
        >
          <ul className="mb-4 space-y-1 text-cuerpo text-texto">
            <li>
              Partidas en el ledger que la referencian: <strong>{uso.partidasLedger}</strong>
            </li>
            <li>
              Conceptos de causación / memorias activas: <strong>{uso.conceptosActivos}</strong>
            </li>
            <li>Cuentas hijas: {uso.cuentasHijas}</li>
            <li>
              Mapeos NIIF: {uso.niifMappings} · Mapeos de exógena: {uso.exogenaMappings} (no bloquean
              el retiro: son por vigencia)
            </li>
          </ul>

          {conceptos.length === 0 ? (
            <EstadoVacio
              titulo="Ningún concepto de causación la usa"
              detalle="Si tampoco tiene partidas, se puede editar o borrar sin riesgo."
            />
          ) : (
            <Tabla alturaMaxima="40vh">
              <thead>
                <tr>
                  <Th>Código</Th>
                  <Th>Concepto</Th>
                  <Th>Rol</Th>
                  <Th>Estado</Th>
                </tr>
              </thead>
              <tbody>
                {conceptos.map((c) => (
                  <tr key={c.conceptoId} className="border-t border-borde/60">
                    <Td numerico>{c.codigo}</Td>
                    <Td>{c.nombre}</Td>
                    <Td>{c.roles.map((r) => ROL_TEXTO[r] ?? r).join(', ')}</Td>
                    <Td>{c.activo ? 'Activo' : 'Inactivo'}</Td>
                  </tr>
                ))}
              </tbody>
            </Tabla>
          )}
        </Modal>
      )}
    </>
  );
}

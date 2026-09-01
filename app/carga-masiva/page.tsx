/**
 * A16 — Portada de la carga masiva (Ola 4, Tareas 1 y 3).
 *
 * Lista los quince catálogos que admiten archivo, EN EL ORDEN EN QUE HAY QUE
 * CARGARLOS. Ese orden no es decorativo: cada plantilla solo depende de las
 * anteriores, y cargar terceros antes que municipios rechaza todas las filas
 * por un municipio DANE que todavía no existe.
 *
 * La lista sale de `DEFINICIONES`, la misma fuente que valida los archivos y
 * que genera las plantillas: no hay forma de que esta pantalla ofrezca un
 * catálogo que el importador no sepa leer.
 */
import Link from 'next/link';
import { conSesion } from '../lib/sesion';
import { permisosDeLaSesion } from '../../src/auth/permisos';
import { DEFINICIONES } from '../../src/services/carga-masiva/definiciones';

export const dynamic = 'force-dynamic';

export default async function PaginaCargaMasiva() {
  const permisos = await conSesion((tx) => permisosDeLaSesion(tx));
  const tiene = new Set(permisos);

  const porModulo = new Map<string, typeof DEFINICIONES>();
  for (const d of DEFINICIONES) {
    const lista = (porModulo.get(d.modulo) ?? []) as typeof DEFINICIONES;
    porModulo.set(d.modulo, [...lista, d] as typeof DEFINICIONES);
  }

  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: '24px' }}>
      <h1>Carga masiva</h1>
      <p>
        Cada catálogo tiene su propia plantilla de Excel, con los encabezados exactos que espera el importador,
        una fila de ejemplo ya llena y una hoja de instrucciones que explica columna por columna qué se espera y
        de dónde salen los valores válidos.
      </p>
      <p
        style={{
          border: '1px solid #b45309',
          background: '#fffbeb',
          padding: '10px 14px',
        }}
      >
        <strong>Si una sola fila está mal, no se carga nada.</strong> Se le muestra la lista completa de filas con
        problema (número de fila, columna y motivo) y usted decide entre corregir el archivo y volver a subirlo, o
        cargar solo las filas válidas. Nunca se carga a medias por su cuenta.
      </p>

      <h2>Orden de carga</h2>
      <p>
        Cárguelos en este orden: cada catálogo solo depende de los anteriores. Los números son el orden, no una
        prioridad.
      </p>

      {[...porModulo.entries()].map(([modulo, definiciones]) => (
        <section key={modulo} style={{ marginBottom: 24 }}>
          <h3 style={{ marginBottom: 4 }}>{modulo}</h3>
          <table style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #cbd5e1' }}>
                <th style={{ width: 36 }}>#</th>
                <th>Catálogo</th>
                <th style={{ width: 150 }}>Plantilla</th>
                <th style={{ width: 130 }}>Cargar</th>
              </tr>
            </thead>
            <tbody>
              {definiciones.map((d) => {
                const puede = tiene.has(d.permiso);
                return (
                  <tr key={d.clave} style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ verticalAlign: 'top', paddingTop: 8 }}>
                      {DEFINICIONES.findIndex((x) => x.clave === d.clave) + 1}
                    </td>
                    <td style={{ padding: '8px 8px 8px 0' }}>
                      <strong>{d.titulo}</strong>
                      <br />
                      <span style={{ fontSize: 13, color: '#475569' }}>{d.descripcion}</span>
                      {d.requierePrevio && d.requierePrevio.length > 0 && (
                        <div style={{ fontSize: 12, color: '#b45309' }}>
                          Requiere cargar antes: {d.requierePrevio.join(', ')}
                        </div>
                      )}
                      {!puede && (
                        <div style={{ fontSize: 12, color: '#b91c1c' }}>
                          Su sesión no tiene el permiso <code>{d.permiso}</code>: podrá ver la plantilla, pero el
                          motor rechazará la carga.
                        </div>
                      )}
                    </td>
                    <td style={{ verticalAlign: 'top', paddingTop: 8 }}>
                      <a href={`/api/plantillas/${d.clave}`}>Descargar .xlsx</a>
                    </td>
                    <td style={{ verticalAlign: 'top', paddingTop: 8 }}>
                      <Link href={`/carga-masiva/${d.clave}`}>Subir archivo</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ))}

      <h2>Lo que NO se carga por archivo, y por qué</h2>
      <ul>
        <li>
          <strong>Asientos contables.</strong> El ledger es append-only y solo nace de una causación aprobada
          (Regla de Oro 1). Un archivo de asientos sería una puerta trasera al libro.
        </li>
        <li>
          <strong>Facturas.</strong> Entran por el buzón de correo de la empresa como XML DIAN, con
          deduplicación por CUFE. Cargarlas por Excel perdería el CUFE y la trazabilidad al documento original.
        </li>
        <li>
          <strong>Usuarios y roles.</strong> Se administran en <Link href="/admin/usuarios">Administración</Link>:
          crear usuarios en bloque desde un archivo, con contraseñas dentro, es exactamente la clase de cosa que
          no debe existir.
        </li>
        <li>
          <strong>Conceptos de causación y mapeo de exógena.</strong> Referencian a la vez cuentas PUC y
          conceptos tributarios, y su semántica está enredada con el clasificador; quedan para una ola
          posterior. Hoy se editan uno a uno.
        </li>
      </ul>
    </main>
  );
}

/**
 * A16 — Plan de cuentas: genérico, propio de la empresa, o los dos
 * (Ola 4, Tarea 4).
 *
 * PROBLEMA REPORTADO QUE CIERRA ESTA PANTALLA: al pedir un reporte el sistema
 * exigía cuentas del PUC y no había ninguna cargada ni forma de cargarlas. El
 * PUC genérico de los seeds cubre los veinte casos dorados, no una empresa
 * real.
 *
 * LO QUE HAY QUE ENTENDER AL MIRARLA (D-064): el PUC propio de una empresa NO
 * reemplaza al genérico; lo sobreescribe cuenta por cuenta y lo completa. La
 * columna «Alcance» de la tabla dice, para cada código, de dónde salió la
 * cuenta que manda hoy. El interruptor de abajo (D-065) es el único modo de
 * apagar la herencia, y se niega a hacerlo si la empresa aún no tiene cuentas
 * propias imputables — apagarlo antes dejaría el ledger sin ningún destino
 * válido y el síntoma aparecería mucho después, al causar una factura.
 */
import Link from 'next/link';
import { conSesion } from '../../lib/sesion';
import {
  listarPucEfectivo,
  obtenerModoPuc,
  puedeEditarPuc,
  resumenPuc,
} from '../../../src/services/puc';
import { MensajeError } from '../_componentes';
import { fijarModoPucAction, guardarCuentaAction, ocultarCuentaAction } from './acciones';

export const dynamic = 'force-dynamic';

type BusquedaParams = Record<string, string | string[] | undefined>;
function cadena(sp: BusquedaParams, campo: string): string {
  const v = sp[campo];
  return typeof v === 'string' ? v : '';
}

export default async function PaginaPuc({ searchParams }: { searchParams: Promise<BusquedaParams> }) {
  const sp = await searchParams;
  const busqueda = cadena(sp, 'q');

  const [cuentas, resumen, modo, puedeEditar] = await conSesion((tx) =>
    Promise.all([
      listarPucEfectivo(tx, { busqueda: busqueda || undefined, limite: 400 }),
      resumenPuc(tx),
      obtenerModoPuc(tx),
      puedeEditarPuc(tx),
    ]),
  );

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: '24px' }}>
      <h1>Plan de cuentas (PUC)</h1>

      <MensajeError error={cadena(sp, 'error') || undefined} />
      {cadena(sp, 'ok') && (
        <p role="status" style={{ border: '1px solid #15803d', color: '#15803d', padding: '8px 12px' }}>
          {decodeURIComponent(cadena(sp, 'ok'))}
        </p>
      )}

      {resumen.imputables === 0 && (
        <section
          role="alert"
          style={{ border: '2px solid #b91c1c', background: '#fef2f2', padding: '12px 16px', marginBottom: 16 }}
        >
          <strong>Esta empresa no tiene ninguna cuenta donde imputar.</strong>
          <p>
            Sin al menos una cuenta activa que admita movimiento no se puede causar ninguna factura y todos los
            reportes salen vacíos. Cargue el plan de cuentas antes de seguir:{' '}
            <Link href="/carga-masiva/account">carga masiva de PUC</Link>.
          </p>
        </section>
      )}

      <section style={{ border: '1px solid #cbd5e1', padding: '12px 16px', marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Cómo se resuelve el PUC de esta empresa</h2>
        <p>
          Para cada código de cuenta gana la fila del alcance más específico que exista:{' '}
          <strong>empresa &gt; firma &gt; genérico</strong>. El plan propio de la empresa no reemplaza al
          genérico: lo sobreescribe cuenta por cuenta y le añade las que falten. Para <em>esconder</em> una
          cuenta genérica en esta empresa se crea una cuenta propia con el mismo código marcada como inactiva —
          nunca se borra la genérica, que la usan las demás empresas de la firma.
        </p>
        <ul>
          <li>Cuentas efectivas activas: <strong>{resumen.total}</strong></li>
          <li>De ellas, imputables (admiten partidas): <strong>{resumen.imputables}</strong></li>
          <li>Propias de esta empresa: {resumen.propiasDeLaEmpresa}</li>
          <li>De la firma: {resumen.deLaFirma}</li>
          <li>Del catálogo genérico (Decreto 2650): {resumen.globales}</li>
        </ul>

        <h3>Modo actual: {modo === 'solo_propio' ? 'solo el PUC propio de la empresa' : 'genérico + propio'}</h3>
        {puedeEditar ? (
          <form action={fijarModoPucAction}>
            <label>
              <input type="radio" name="modo" value="generico" defaultChecked={modo === 'generico'} /> Heredar el
              PUC genérico y sobreescribirlo con el propio (recomendado)
            </label>
            <br />
            <label>
              <input type="radio" name="modo" value="solo_propio" defaultChecked={modo === 'solo_propio'} /> Usar
              EXCLUSIVAMENTE el plan de cuentas propio de esta empresa
            </label>
            <br />
            <button type="submit" style={{ marginTop: 8 }}>
              Guardar modo
            </button>
          </form>
        ) : (
          <p>Su sesión no tiene el permiso «puc.editar»: puede consultar el plan, no cambiarlo.</p>
        )}
      </section>

      <section style={{ marginBottom: 16 }}>
        <form method="get">
          <label>
            Buscar por código o nombre{' '}
            <input name="q" type="search" defaultValue={busqueda} size={40} placeholder="1105, caja, retención…" />
          </label>{' '}
          <button type="submit">Buscar</button>{' '}
          <a href="/carga-masiva/account">Cargar cuentas por archivo</a>
        </form>
      </section>

      <h2>
        PUC efectivo {busqueda && <>— filtrado por «{busqueda}»</>} ({cuentas.length} cuentas
        {cuentas.length === 400 ? ', mostrando las primeras 400' : ''})
      </h2>

      {cuentas.length === 0 ? (
        <p>
          {busqueda
            ? `Ninguna cuenta coincide con «${busqueda}».`
            : 'No hay ninguna cuenta en el plan efectivo de esta empresa.'}
        </p>
      ) : (
        <table style={{ borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #cbd5e1' }}>
              <th style={{ padding: 4 }}>Código</th>
              <th style={{ padding: 4 }}>Nombre</th>
              <th style={{ padding: 4 }}>Nivel</th>
              <th style={{ padding: 4 }}>Naturaleza</th>
              <th style={{ padding: 4 }}>Imputable</th>
              <th style={{ padding: 4 }}>Estado</th>
              <th style={{ padding: 4 }}>Alcance</th>
              {puedeEditar && <th style={{ padding: 4 }}>Acción</th>}
            </tr>
          </thead>
          <tbody>
            {cuentas.map((c) => (
              <tr key={c.id} style={{ borderBottom: '1px solid #e2e8f0', color: c.activo ? undefined : '#94a3b8' }}>
                <td style={{ padding: 4 }}>
                  <code>{c.codigo}</code>
                </td>
                <td style={{ padding: 4 }}>{c.nombre}</td>
                <td style={{ padding: 4 }}>{c.nivel}</td>
                <td style={{ padding: 4 }}>{c.naturaleza}</td>
                <td style={{ padding: 4 }}>{c.permiteMovimiento ? 'Sí' : 'No'}</td>
                <td style={{ padding: 4 }}>{c.activo ? 'Activa' : 'Inactiva'}</td>
                <td style={{ padding: 4 }}>
                  {c.alcance === 'empresa'
                    ? 'Propia de la empresa'
                    : c.alcance === 'firma'
                      ? 'De la firma'
                      : 'Genérica (Decreto 2650)'}
                </td>
                {puedeEditar && (
                  <td style={{ padding: 4 }}>
                    {c.alcance !== 'empresa' && c.activo && (
                      <form action={ocultarCuentaAction}>
                        <input type="hidden" name="codigo" value={c.codigo} />
                        <button type="submit">Ocultar aquí</button>
                      </form>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {puedeEditar && (
        <section style={{ border: '1px solid #334155', padding: 16, marginTop: 24 }}>
          <h2 style={{ marginTop: 0 }}>Crear o editar una cuenta</h2>
          <p>
            El nivel y la cuenta padre se deducen del código: 1 dígito = clase, 2 = grupo, 4 = cuenta, 6 =
            subcuenta, 7 o más = auxiliar. La cuenta padre tiene que existir ya.
          </p>
          <form action={guardarCuentaAction}>
            <div>
              <label>
                Código * <input name="codigo" required pattern="[1-9][0-9]*" size={14} placeholder="110505" />
              </label>{' '}
              <label>
                Nombre * <input name="nombre" required size={44} placeholder="Caja general" />
              </label>
            </div>
            <div style={{ marginTop: 8 }}>
              <label>
                Naturaleza *{' '}
                <select name="naturaleza" required defaultValue="">
                  <option value="" disabled>
                    Seleccione...
                  </option>
                  <option value="debito">Débito</option>
                  <option value="credito">Crédito</option>
                </select>
              </label>{' '}
              <label>
                Alcance{' '}
                <select name="alcance" defaultValue="empresa">
                  <option value="empresa">Solo esta empresa</option>
                  <option value="firma">Compartida por toda la firma</option>
                </select>
              </label>
            </div>
            <fieldset style={{ marginTop: 8 }}>
              <legend>¿Admite movimiento? (obligatorio, sin valor por omisión)</legend>
              <label>
                <input type="radio" name="permiteMovimiento" value="si" required /> Sí, es una cuenta donde se
                imputa
              </label>{' '}
              <label>
                <input type="radio" name="permiteMovimiento" value="no" required /> No, es de agrupación
              </label>
            </fieldset>
            <div style={{ marginTop: 8 }}>
              <label>
                <input type="radio" name="requiereTercero" value="si" /> Exige tercero
              </label>{' '}
              <label>
                <input type="radio" name="requiereTercero" value="no" defaultChecked /> No exige tercero
              </label>
            </div>
            <div>
              <label>
                <input type="radio" name="requiereCentroCosto" value="si" /> Exige centro de costo
              </label>{' '}
              <label>
                <input type="radio" name="requiereCentroCosto" value="no" defaultChecked /> No lo exige
              </label>
            </div>
            <div>
              <label>
                <input type="radio" name="requiereBaseGravable" value="si" /> Exige base gravable
              </label>{' '}
              <label>
                <input type="radio" name="requiereBaseGravable" value="no" defaultChecked /> No la exige
              </label>
            </div>
            <div>
              <label>
                <input type="radio" name="activo" value="si" defaultChecked /> Activa
              </label>{' '}
              <label>
                <input type="radio" name="activo" value="no" /> Inactiva
              </label>
            </div>
            <button type="submit" style={{ marginTop: 12 }}>
              Guardar cuenta
            </button>
          </form>
        </section>
      )}

      <p style={{ marginTop: 24 }}>
        <Link href="/carga-masiva/niif_mapping">Cargar el mapeo NIIF de estas cuentas</Link> — sin él, los
        estados financieros no saben en qué rubro poner cada cuenta.
      </p>
    </main>
  );
}

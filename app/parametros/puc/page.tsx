/**
 * A16 — Plan de cuentas: genérico, propio de la empresa, o los dos.
 *
 * El PUC propio de una empresa NO reemplaza al genérico: lo sobreescribe
 * cuenta por cuenta y lo completa. La columna «Alcance» dice de dónde salió la
 * cuenta que manda hoy. El interruptor de abajo (D-065) es el único modo de
 * apagar la herencia, y se niega si la empresa aún no tiene cuentas propias
 * imputables.
 *
 * D-087 · TAREA 0 — cuerpo migrado al kit de `app/_ui/`.
 * D-087 · TAREA 2 — la interfaz muestra el submódulo según
 *   `parametro.puc.editar` (fino); la ESCRITURA la sigue imponiendo el motor
 *   sobre `puc.editar` (016). D-087 no añade un simulador de N conceptos / M
 *   proveedores aquí: editar el PUC no abre ni cierra vigencias tributarias;
 *   la garantía de que no se deja el ledger sin destino es el guardia de
 *   "cuentas imputables" ya presente (D-064/D-065).
 */
import Link from 'next/link';
import { conSesion } from '../../lib/sesion';
import {
  conceptosQueUsanCuentas,
  listarPucEfectivo,
  obtenerModoPuc,
  resolverCuentaPorCodigo,
  resumenPuc,
  simularImpactoCambioCuenta,
  usoDeCuentas,
  type CambioPropuestoCuenta,
  type ImpactoCambioCuenta,
} from '../../../src/services/puc';
import { puedeEditarParametros } from '../../../src/services/parametrizacion';
import { BotonUsoCuenta, IndicadorUso } from './_uso-cuenta';
import {
  Boton,
  Campo,
  Encabezado,
  EnlaceBoton,
  Entrada,
  MensajeEstado,
  Panel,
  Selector,
  Tabla,
  Td,
  Th,
} from '../../_ui/componentes';
import { MensajeError } from '../_componentes';
import { fijarModoPucAction, guardarCuentaAction, ocultarCuentaAction } from './acciones';

export const dynamic = 'force-dynamic';

type BusquedaParams = Record<string, string | string[] | undefined>;
function cadena(sp: BusquedaParams, campo: string): string {
  const v = sp[campo];
  return typeof v === 'string' ? v : '';
}

const CLASE_ENLACE = 'font-semibold text-primario underline dark:text-primario-tinta-oscura';

/** Nombre de la ruta acordado con A9 (D-089 TAREA 5). Stub 501 hasta que A9 la implemente. */
const RUTA_EXPORTAR_PUC = '/api/parametros/puc/exportar';

const CAMPOS_SIMULAR = [
  'codigo',
  'nombre',
  'naturaleza',
  'alcance',
  'permiteMovimiento',
  'requiereTercero',
  'requiereCentroCosto',
  'requiereBaseGravable',
  'activo',
] as const;
type CamposSimular = Record<(typeof CAMPOS_SIMULAR)[number], string>;

function leerCamposSimular(sp: BusquedaParams): CamposSimular {
  const out = {} as CamposSimular;
  for (const c of CAMPOS_SIMULAR) out[c] = cadena(sp, c);
  return out;
}

export default async function PaginaPuc({ searchParams }: { searchParams: Promise<BusquedaParams> }) {
  const sp = await searchParams;
  const busqueda = cadena(sp, 'q');
  const simularCodigo = cadena(sp, 'simular');

  const { cuentas, resumen, modo, puedeEditar, uso, conceptosPorCuenta, simulacion } =
    await conSesion(async (tx) => {
      const [cuentasR, resumenR, modoR, puedeEditarR] = await Promise.all([
        listarPucEfectivo(tx, { busqueda: busqueda || undefined, limite: 400 }),
        resumenPuc(tx),
        obtenerModoPuc(tx),
        puedeEditarParametros(tx, 'puc'),
      ]);

      const ids = cuentasR.map((c) => c.id);
      const usoR = await usoDeCuentas(tx, ids);
      const enUsoIds = cuentasR.filter((c) => usoR.get(c.id)?.enUso).map((c) => c.id);
      const conceptosR = await conceptosQueUsanCuentas(tx, enUsoIds);

      // Paso 2 del simulador de impacto (D-089 TAREA 4): se recalcula el impacto
      // AQUÍ, contra la base, en la misma lectura (nunca desde el query string).
      let simulacionR: { impacto: ImpactoCambioCuenta; campos: CamposSimular } | null = null;
      if (simularCodigo && puedeEditarR) {
        const actual = await resolverCuentaPorCodigo(tx, simularCodigo);
        if (actual) {
          const campos = leerCamposSimular(sp);
          const propuesta: CambioPropuestoCuenta = {
            codigo: campos.codigo || actual.codigo,
            naturaleza: campos.naturaleza === 'credito' ? 'credito' : 'debito',
            permiteMovimiento: campos.permiteMovimiento === 'si',
            activo: campos.activo !== 'no',
          };
          simulacionR = { impacto: await simularImpactoCambioCuenta(tx, actual, propuesta), campos };
        }
      }

      return {
        cuentas: cuentasR,
        resumen: resumenR,
        modo: modoR,
        puedeEditar: puedeEditarR,
        uso: usoR,
        conceptosPorCuenta: conceptosR,
        simulacion: simulacionR,
      };
    });

  return (
    <div className="mx-auto max-w-5xl p-5">
      <Encabezado
        titulo="Plan de cuentas (PUC)"
        descripcion="Para cada código gana la fila del alcance más específico que exista: empresa > firma > genérico (Decreto 2650)."
        acciones={
          <>
            <a className={CLASE_ENLACE} href={RUTA_EXPORTAR_PUC}>
              Exportar PUC a Excel
            </a>
            <EnlaceBoton href="/parametros" variante="fantasma">« Parametrización</EnlaceBoton>
          </>
        }
      />

      <MensajeError error={cadena(sp, 'error') || undefined} />
      {cadena(sp, 'ok') && (
        <div className="my-3">
          <MensajeEstado tipo="sin-datos" titulo={decodeURIComponent(cadena(sp, 'ok'))} />
        </div>
      )}

      {resumen.imputables === 0 && (
        <div className="my-3">
          <MensajeEstado
            tipo="error"
            titulo="Esta empresa no tiene ninguna cuenta donde imputar."
            accion={{ texto: 'Carga masiva de PUC', href: '/carga-masiva/account' }}
          >
            Sin al menos una cuenta activa que admita movimiento no se puede causar ninguna factura y
            todos los reportes salen vacíos.
          </MensajeEstado>
        </div>
      )}

      <Panel titulo="Cómo se resuelve el PUC de esta empresa">
        <div className="space-y-2 p-5 text-cuerpo text-texto-suave">
          <p>
            El plan propio de la empresa no reemplaza al genérico: lo sobreescribe cuenta por cuenta y
            le añade las que falten. Para <em>esconder</em> una cuenta genérica se crea una cuenta
            propia con el mismo código marcada como inactiva — nunca se borra la genérica.
          </p>
          <ul className="list-disc space-y-1 pl-6">
            <li>Cuentas efectivas activas: <strong>{resumen.total}</strong></li>
            <li>De ellas, imputables: <strong>{resumen.imputables}</strong></li>
            <li>Propias de esta empresa: {resumen.propiasDeLaEmpresa}</li>
            <li>De la firma: {resumen.deLaFirma}</li>
            <li>Del catálogo genérico (Decreto 2650): {resumen.globales}</li>
          </ul>

          <h3 className="pt-2 text-seccion font-semibold text-texto">
            Modo actual: {modo === 'solo_propio' ? 'solo el PUC propio de la empresa' : 'genérico + propio'}
          </h3>
          {puedeEditar ? (
            <form action={fijarModoPucAction} className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-cuerpo text-texto">
                <input type="radio" name="modo" value="generico" defaultChecked={modo === 'generico'} />
                Heredar el PUC genérico y sobreescribirlo con el propio (recomendado)
              </label>
              <label className="flex items-center gap-2 text-cuerpo text-texto">
                <input type="radio" name="modo" value="solo_propio" defaultChecked={modo === 'solo_propio'} />
                Usar EXCLUSIVAMENTE el plan de cuentas propio de esta empresa
              </label>
              <div>
                <Boton tipo="submit" variante="secundario">Guardar modo</Boton>
              </div>
            </form>
          ) : (
            <p>Su sesión no tiene el permiso «parametro.puc.editar»: puede consultar el plan, no cambiarlo.</p>
          )}
        </div>
      </Panel>

      <form method="get" className="my-4 flex flex-wrap items-end gap-3 rounded-lg border border-borde bg-superficie-elevada p-3">
        <Campo etiqueta="Buscar por código o nombre">
          <Entrada name="q" type="search" defaultValue={busqueda} placeholder="1105, caja, retención…" />
        </Campo>
        <Boton tipo="submit" variante="secundario">Buscar</Boton>
        <Link className={CLASE_ENLACE} href="/carga-masiva/account">Cargar cuentas por archivo</Link>
      </form>

      <Panel
        titulo={`PUC efectivo${busqueda ? ` — «${busqueda}»` : ''} (${cuentas.length} cuenta(s)${
          cuentas.length === 400 ? ', mostrando las primeras 400' : ''
        })`}
      >
        {cuentas.length === 0 ? (
          <div className="p-5 text-cuerpo text-texto-suave">
            {busqueda
              ? `Ninguna cuenta coincide con «${busqueda}».`
              : 'No hay ninguna cuenta en el plan efectivo de esta empresa.'}
          </div>
        ) : (
          <Tabla fijarPrimeraColumna>
            <thead>
              <tr>
                <Th>Código</Th>
                <Th>Nombre</Th>
                <Th>Nivel</Th>
                <Th>Naturaleza</Th>
                <Th>Imputable</Th>
                <Th>Estado</Th>
                <Th>Alcance</Th>
                <Th>En uso</Th>
                {puedeEditar && <Th />}
              </tr>
            </thead>
            <tbody>
              {cuentas.map((c) => (
                <tr key={c.id} className={`border-t border-borde/60 ${c.activo ? '' : 'text-texto-suave'}`}>
                  <Td numerico>{c.codigo}</Td>
                  <Td>{c.nombre}</Td>
                  <Td>{c.nivel}</Td>
                  <Td>{c.naturaleza}</Td>
                  <Td>{c.permiteMovimiento ? 'Sí' : 'No'}</Td>
                  <Td>{c.activo ? 'Activa' : 'Inactiva'}</Td>
                  <Td>
                    {c.alcance === 'empresa'
                      ? 'Propia de la empresa'
                      : c.alcance === 'firma'
                        ? 'De la firma'
                        : 'Genérica (Decreto 2650)'}
                  </Td>
                  <Td>
                    <span className="inline-flex items-center gap-2">
                      <IndicadorUso uso={uso.get(c.id)} />
                      {uso.get(c.id)?.enUso && (
                        <BotonUsoCuenta
                          codigo={c.codigo}
                          nombre={c.nombre}
                          uso={uso.get(c.id)!}
                          conceptos={conceptosPorCuenta.get(c.id) ?? []}
                        />
                      )}
                    </span>
                  </Td>
                  {puedeEditar && (
                    <Td alineado="right">
                      {c.alcance !== 'empresa' && c.activo && (
                        <form action={ocultarCuentaAction}>
                          <input type="hidden" name="codigo" value={c.codigo} />
                          <Boton tipo="submit" variante="terciario">Ocultar aquí</Boton>
                        </form>
                      )}
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </Tabla>
        )}
      </Panel>

      {simulacion && (
        <Panel
          titulo={`Simulador de impacto — cuenta ${simulacion.impacto.codigo}`}
          className="mt-6"
        >
          <div className="space-y-3 p-5">
            <MensajeEstado
              tipo={simulacion.impacto.bloqueadoPorMotor ? 'error' : 'configuracion'}
              titulo={`Este cambio afecta ${simulacion.impacto.conceptosActivos} concepto(s) de causación y ${simulacion.impacto.partidasLedger} partida(s) del ledger (sección 6.2, punto 6).`}
            >
              {simulacion.impacto.conceptos.length > 0 && (
                <ul className="mt-1 list-disc pl-5">
                  {simulacion.impacto.conceptos.map((cc) => (
                    <li key={cc.conceptoId}>
                      {cc.codigo} — {cc.nombre} ({cc.roles.join(', ')})
                      {cc.activo ? '' : ' — inactivo'}
                    </li>
                  ))}
                </ul>
              )}
            </MensajeEstado>

            {simulacion.impacto.rechazos.length > 0 && (
              <div className="rounded-lg border border-error/40 bg-error/8 p-4">
                <p className="text-cuerpo font-semibold text-texto">
                  El motor va a rechazar este cambio. No hay «forzar»: es la garantía de la migración
                  179.
                </p>
                <ul className="mt-1 list-disc pl-5 text-menor text-texto-suave">
                  {simulacion.impacto.rechazos.map((r) => (
                    <li key={r.codigo}>
                      <strong>{r.codigo}</strong> — {r.motivo}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {simulacion.impacto.advertencias.length > 0 && (
              <ul className="list-disc pl-5 text-cuerpo text-texto">
                {simulacion.impacto.advertencias.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}

            <div className="flex items-center gap-3">
              {!simulacion.impacto.bloqueadoPorMotor && (
                <form action={guardarCuentaAction}>
                  {CAMPOS_SIMULAR.map((campo) => (
                    <input key={campo} type="hidden" name={campo} value={simulacion.campos[campo]} />
                  ))}
                  <input type="hidden" name="confirmado" value="1" />
                  <Boton tipo="submit">Confirmar y guardar el cambio</Boton>
                </form>
              )}
              <Link className={CLASE_ENLACE} href="/parametros/puc">
                Cancelar
              </Link>
            </div>
          </div>
        </Panel>
      )}

      {puedeEditar && (
        <Panel titulo="Crear o editar una cuenta" className="mt-6">
          <div className="p-5">
            <p className="mb-4 text-menor text-texto-suave">
              El nivel y la cuenta padre se deducen del código: 1 dígito = clase, 2 = grupo, 4 =
              cuenta, 6 = subcuenta, 7 o más = auxiliar. La cuenta padre tiene que existir ya.
            </p>
            <form action={guardarCuentaAction} className="grid max-w-xl grid-cols-1 gap-3">
              <Campo etiqueta="Código" requerido>
                <Entrada name="codigo" required pattern="[1-9][0-9]*" placeholder="110505" />
              </Campo>
              <Campo etiqueta="Nombre" requerido>
                <Entrada name="nombre" required placeholder="Caja general" />
              </Campo>
              <Campo etiqueta="Naturaleza" requerido>
                <Selector name="naturaleza" required defaultValue="">
                  <option value="" disabled>Seleccione...</option>
                  <option value="debito">Débito</option>
                  <option value="credito">Crédito</option>
                </Selector>
              </Campo>
              <Campo etiqueta="Alcance">
                <Selector name="alcance" defaultValue="empresa">
                  <option value="empresa">Solo esta empresa</option>
                  <option value="firma">Compartida por toda la firma</option>
                </Selector>
              </Campo>
              <fieldset className="flex flex-col gap-1.5 text-cuerpo text-texto">
                <legend className="text-[12px] font-medium">¿Admite movimiento? (obligatorio)</legend>
                <label className="flex items-center gap-2">
                  <input type="radio" name="permiteMovimiento" value="si" required /> Sí, es una cuenta donde se imputa
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="permiteMovimiento" value="no" required /> No, es de agrupación
                </label>
              </fieldset>
              <RadioSiNo nombre="requiereTercero" etiqueta="¿Exige tercero?" />
              <RadioSiNo nombre="requiereCentroCosto" etiqueta="¿Exige centro de costo?" />
              <RadioSiNo nombre="requiereBaseGravable" etiqueta="¿Exige base gravable?" />
              <fieldset className="flex flex-wrap gap-4 text-cuerpo text-texto">
                <label className="flex items-center gap-2">
                  <input type="radio" name="activo" value="si" defaultChecked /> Activa
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="activo" value="no" /> Inactiva
                </label>
              </fieldset>
              <div>
                <Boton tipo="submit">Guardar cuenta</Boton>
              </div>
            </form>
          </div>
        </Panel>
      )}

      <p className="mt-6 text-menor text-texto-suave">
        <Link className={CLASE_ENLACE} href="/carga-masiva/niif_mapping">
          Cargar el mapeo NIIF de estas cuentas
        </Link>{' '}
        — sin él, los estados financieros no saben en qué rubro poner cada cuenta.
      </p>
    </div>
  );
}

function RadioSiNo({ nombre, etiqueta }: { nombre: string; etiqueta: string }) {
  return (
    <fieldset className="flex flex-wrap items-center gap-4 text-cuerpo text-texto">
      <span className="text-[12px] font-medium">{etiqueta}</span>
      <label className="flex items-center gap-2">
        <input type="radio" name={nombre} value="si" /> Sí
      </label>
      <label className="flex items-center gap-2">
        <input type="radio" name={nombre} value="no" defaultChecked /> No
      </label>
    </fieldset>
  );
}

/**
 * A10 — Cierre de las cuentas de resultado (Ola 3).
 *
 * REGLA DE ORO 1, DE FRENTE. Cerrar el ejercicio NO es poner en cero unas
 * cuentas: es registrar un HECHO CONTABLE NUEVO que cancela los saldos de
 * resultado contra el patrimonio. Aquí no hay un solo `UPDATE` ni un `DELETE`
 * sobre nada publicado. El cierre es un asiento más, que:
 *
 *   1. nace en `draft` (D-009: la base rechaza con LG007 un asiento que
 *      pretenda nacer publicado, porque sin partidas no se podría validar);
 *   2. recibe sus partidas mientras sigue en `draft`;
 *   3. se publica con `app.publicar_asiento`, que valida en el COMMIT la doble
 *      partida (LG002), que las cuentas sean imputables (LG004), que el período
 *      esté abierto (LG005) y que exista aprobación humana (LG006);
 *   4. a partir de ahí es inmutable como cualquier otro. Si estuvo mal, se
 *      corrige con una reversa, no editándolo.
 *
 * Y es IDEMPOTENTE por `idempotency_key`, como la causación (caso dorado 18):
 * ejecutar el cierre diez veces deja un asiento, no diez.
 *
 * QUÉ CUENTAS SE CIERRAN: las que el mapeo NIIF clasifica como `ingreso`,
 * `costo` o `gasto`. No las de `otro_resultado_integral`: el ORI no pasa por el
 * resultado del ejercicio, se acumula en su propio componente del patrimonio.
 * Y no se usa la clase del PUC como atajo: si una cuenta con movimiento no
 * tiene mapeo NIIF, el cierre NO la toca y la devuelve en
 * `cuentasSinClasificar` para que alguien la clasifique. Cerrar contra un
 * supuesto («la clase 5 siempre es gasto») sería inventar la clasificación que
 * `niif_mapping` existe precisamente para no inventar.
 *
 * LA CUENTA DE CONTRAPARTIDA LA ELIGE QUIEN CIERRA. No hay ningún código PUC
 * escrito en este archivo: `cuentaResultadoId` llega por parámetro. El PUC del
 * mercado usa la cuenta de resultado del ejercicio del grupo 36, pero eso es
 * una convención del catálogo, no una constante del programa (Regla de Oro 2).
 */
import type { SqlClient } from '../db/types';
import { exigirPermiso, PERMISOS } from '../auth/permisos';

export interface CerrarResultadosInput {
  /** Primer día del ejercicio que se cierra. */
  desde: string;
  /** Último día del ejercicio que se cierra. Es la fecha del asiento de cierre. */
  hasta: string;
  /** Cuenta de patrimonio contra la que se cancela el resultado. La elige quien cierra. */
  cuentaResultadoId: string;
  /** Queda en la descripción del asiento y en la aprobación (Regla de Oro 6). */
  motivo: string;
  /** IP desde la que se decidió el cierre. `approval.ip` no admite NULL. */
  ip?: string;
}

export interface CuentaCerrada {
  accountId: string;
  cuentaCodigo: string;
  cuentaNombre: string;
  clasificacionNiif: string;
  /** Saldo cancelado, en centavos, con signo deudor positivo. */
  saldo: string;
}

export type ResultadoCierre =
  | {
      estado: 'cerrado';
      journalEntryId: string;
      /** Resultado trasladado al patrimonio, en centavos. Positivo = utilidad. */
      resultadoDelEjercicio: string;
      cuentas: CuentaCerrada[];
      cuentasSinClasificar: CuentaCerrada[];
    }
  | { estado: 'ya_cerrado'; journalEntryId: string }
  | { estado: 'sin_movimiento'; cuentasSinClasificar: CuentaCerrada[] };

interface FilaSaldoResultado {
  account_id: string;
  cuenta_codigo: string;
  cuenta_nombre: string;
  clasificacion_niif: string | null;
  saldo: string;
}

/** Clave determinista del asiento de cierre de un ejercicio. */
export function claveCierre(desde: string, hasta: string): string {
  return `cierre:${desde}:${hasta}`;
}

/**
 * Se pidió cerrar un rango que SE SOLAPA con un ejercicio ya cerrado.
 *
 * V-15 (hallazgo de A14 en la compuerta de la Ola 3). `idempotency_key`
 * protege contra cerrar dos veces EL MISMO rango, pero no contra cerrar
 * 01-jun→30-jun y después 15-jun→30-jun: las claves son distintas, así que la
 * idempotencia no dispara, y como `saldosACerrar` excluye los asientos de
 * tipo `cierre` para poder ser repetible, el segundo cierre vuelve a ver los
 * mismos ingresos y gastos y los cancela OTRA VEZ. Medido: la cuenta de
 * ingresos quedaba con saldo DÉBITO y el resultado del ejercicio en cero.
 * Como el ledger es inmutable (Regla de Oro 1), deshacerlo exige una reversa.
 *
 * Por eso el solape se rechaza ANTES de escribir nada. Si de verdad hay que
 * cerrar un rango distinto, primero se reversa el cierre anterior.
 */
export class CierreSolapadoError extends Error {
  constructor(
    readonly journalEntryId: string,
    readonly rangoExistente: { desde: string; hasta: string },
    readonly rangoPedido: { desde: string; hasta: string },
  ) {
    super(
      `CIERRE_SOLAPADO: el ejercicio ${rangoPedido.desde} a ${rangoPedido.hasta} se solapa con el cierre ya publicado ` +
        `${rangoExistente.desde} a ${rangoExistente.hasta} (asiento ${journalEntryId}). Cerrarlo otra vez cancelaría ` +
        'por segunda vez las mismas cuentas de resultado. Si el cierre anterior estuvo mal, corríjalo con un asiento ' +
        'de reversa (Regla de Oro 1) antes de volver a cerrar.',
    );
    this.name = 'CierreSolapadoError';
  }
}

/**
 * Saldos de las cuentas de resultado del ejercicio, EXCLUYENDO los asientos de
 * cierre ya publicados. Esa exclusión es lo que hace el cierre repetible sin
 * duplicar: si el ejercicio ya se cerró, el segundo intento ve saldo cero.
 */
export async function saldosACerrar(
  tx: SqlClient,
  opciones: { desde: string; hasta: string },
): Promise<{ aCerrar: CuentaCerrada[]; sinClasificar: CuentaCerrada[] }> {
  const { rows } = await tx.query<FilaSaldoResultado>(
    `SELECT
       v.account_id,
       v.cuenta_codigo,
       v.cuenta_nombre,
       n.clasificacion_niif,
       SUM(CASE WHEN v.side = 'debito' THEN v.monto ELSE -v.monto END)::text AS saldo
     FROM v_journal_line_reporte v
     LEFT JOIN LATERAL app.niif_de_cuenta(v.account_id, $2::date) n ON true
     WHERE v.fecha_hecho_economico BETWEEN $1 AND $2
       AND v.asiento_tipo <> 'cierre'
       AND (n.clasificacion_niif IN ('ingreso', 'costo', 'gasto') OR n.clasificacion_niif IS NULL)
     GROUP BY v.account_id, v.cuenta_codigo, v.cuenta_nombre, n.clasificacion_niif
     HAVING SUM(CASE WHEN v.side = 'debito' THEN v.monto ELSE -v.monto END) <> 0
     ORDER BY v.cuenta_codigo`,
    [opciones.desde, opciones.hasta],
  );

  const aCerrar: CuentaCerrada[] = [];
  const sinClasificar: CuentaCerrada[] = [];
  for (const r of rows) {
    const fila: CuentaCerrada = {
      accountId: r.account_id,
      cuentaCodigo: r.cuenta_codigo,
      cuentaNombre: r.cuenta_nombre,
      clasificacionNiif: r.clasificacion_niif ?? 'sin_mapeo',
      saldo: r.saldo,
    };
    if (r.clasificacion_niif === null) sinClasificar.push(fila);
    else aCerrar.push(fila);
  }
  return { aCerrar, sinClasificar };
}

/**
 * Documento fuente del asiento de cierre. `journal_entry.source_document_id` es
 * NOT NULL desde la sección 15: todo asiento sale de un documento. El cierre
 * también, solo que el suyo no es una factura sino el acta de cierre del
 * ejercicio. Se crea una sola vez por ejercicio, y quien lo garantiza es la
 * restricción `source_document_hash_uq` de la base, no un `if` de este archivo.
 */
async function actaDeCierre(
  tx: SqlClient,
  opciones: { desde: string; hasta: string; motivo: string },
): Promise<string> {
  const referencia = `ACTA-CIERRE-${opciones.desde}-${opciones.hasta}`;
  const { rows: existentes } = await tx.query<{ id: string }>(
    `SELECT id FROM source_document
      WHERE company_id = app.current_company_id() AND hash_contenido = $1`,
    [referencia],
  );
  if (existentes[0]) return existentes[0].id;

  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO source_document (
       tenant_id, company_id, tipo_documento, numero_documento, emisor_nit,
       emisor_nombre, fecha_hecho_economico, hash_contenido, origen, estado, nombre_archivo)
     SELECT app.current_tenant_id(), app.current_company_id(), 'Otro', $1, c.nit,
            c.razon_social, $2::date, $3, 'carga_manual', 'aprobado', $4
       FROM company c WHERE c.id = app.current_company_id()
     RETURNING id`,
    [referencia, opciones.hasta, referencia, `${referencia}: ${opciones.motivo}`],
  );
  const id = rows[0]?.id;
  if (!id) {
    throw new Error(
      'No se pudo crear el acta de cierre: la sesión no está situada en ninguna empresa (app.current_company_id() devolvió NULL).',
    );
  }
  return id;
}

/**
 * Cierra las cuentas de resultado del ejercicio contra la cuenta de patrimonio
 * indicada, con un asiento NUEVO de tipo `cierre`. Idempotente.
 */
export async function cerrarCuentasDeResultado(
  tx: SqlClient,
  input: CerrarResultadosInput,
): Promise<ResultadoCierre> {
  await exigirPermiso(tx, PERMISOS.PERIODO_CERRAR);

  const clave = claveCierre(input.desde, input.hasta);
  const { rows: yaExiste } = await tx.query<{ id: string }>(
    `SELECT id FROM journal_entry
      WHERE company_id = app.current_company_id() AND idempotency_key = $1`,
    [clave],
  );
  if (yaExiste[0]) return { estado: 'ya_cerrado', journalEntryId: yaExiste[0].id };

  // V-15 (A14): el mismo rango ya se descartó arriba; lo que queda por
  // descartar es un rango DISTINTO que se solape con uno ya cerrado. El rango
  // cerrado vive en la propia clave de idempotencia (`cierre:<desde>:<hasta>`),
  // que es dato del asiento, no un estado paralelo que pudiera desincronizarse.
  const { rows: solapados } = await tx.query<{ id: string; desde: string; hasta: string }>(
    `SELECT id,
            split_part(idempotency_key, ':', 2) AS desde,
            split_part(idempotency_key, ':', 3) AS hasta
       FROM journal_entry
      WHERE company_id = app.current_company_id()
        AND tipo = 'cierre'
        AND estado = 'posted'
        AND idempotency_key ~ '^cierre:[0-9]{4}-[0-9]{2}-[0-9]{2}:[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        AND split_part(idempotency_key, ':', 2)::date <= $2::date
        AND split_part(idempotency_key, ':', 3)::date >= $1::date
      ORDER BY posted_at
      LIMIT 1`,
    [input.desde, input.hasta],
  );
  if (solapados[0]) {
    throw new CierreSolapadoError(
      solapados[0].id,
      { desde: solapados[0].desde, hasta: solapados[0].hasta },
      { desde: input.desde, hasta: input.hasta },
    );
  }

  const { aCerrar, sinClasificar } = await saldosACerrar(tx, input);
  if (aCerrar.length === 0) {
    return { estado: 'sin_movimiento', cuentasSinClasificar: sinClasificar };
  }

  const { rows: periodos } = await tx.query<{ id: string; estado: string }>(
    `SELECT id, estado FROM fiscal_period
      WHERE company_id = app.current_company_id()
        AND $1::date BETWEEN fecha_inicio AND fecha_fin`,
    [input.hasta],
  );
  const periodo = periodos[0];
  if (!periodo) {
    throw new Error(
      `No existe período fiscal que contenga la fecha de cierre ${input.hasta}. Créelo antes de cerrar: todo asiento pertenece a un período y la base lo exige (LG005).`,
    );
  }
  if (periodo.estado !== 'abierto') {
    throw new Error(
      `El período fiscal de ${input.hasta} está en estado "${periodo.estado}". El asiento de cierre también necesita el período abierto: la base lo rechazaría con LG005.`,
    );
  }

  const sourceDocumentId = await actaDeCierre(tx, input);

  const { rows: aprobaciones } = await tx.query<{ id: string }>(
    `INSERT INTO approval (tenant_id, company_id, entidad, entidad_id, decision, user_id, ip, motivo)
     VALUES (app.current_tenant_id(), app.current_company_id(), 'cierre_periodo', $1,
             'aprobado', app.current_user_id(), $2::inet, $3)
     RETURNING id`,
    [
      periodo.id,
      input.ip ?? '127.0.0.1',
      `Cierre de resultados ${input.desde} a ${input.hasta}: ${input.motivo}`,
    ],
  );
  const approvalId = aprobaciones[0]!.id;

  const { rows: asientos } = await tx.query<{ id: string }>(
    `INSERT INTO journal_entry (
       tenant_id, company_id, fiscal_period_id, tipo, fecha_hecho_economico, descripcion,
       estado, source_document_id, approval_id, idempotency_key, created_by)
     VALUES (app.current_tenant_id(), app.current_company_id(), $1, 'cierre', $2::date, $3,
             'draft', $4, $5, $6, app.current_user_id())
     RETURNING id`,
    [
      periodo.id,
      input.hasta,
      `Cierre de cuentas de resultado ${input.desde} a ${input.hasta} — ${input.motivo}`,
      sourceDocumentId,
      approvalId,
      clave,
    ],
  );
  const journalEntryId = asientos[0]!.id;

  // Cada cuenta de resultado se cancela con una partida del signo CONTRARIO a
  // su saldo. La aritmética es `BigInt`: el dinero es entero (Regla de Oro 5).
  let neto = 0n;
  let linea = 0;
  for (const cuenta of aCerrar) {
    const saldo = BigInt(cuenta.saldo);
    neto += saldo;
    linea += 1;
    await tx.query(
      `INSERT INTO journal_line (
         tenant_id, company_id, journal_entry_id, linea, account_id, side, monto, descripcion)
       VALUES (app.current_tenant_id(), app.current_company_id(), $1, $2, $3, $4, $5, $6)`,
      [
        journalEntryId,
        linea,
        cuenta.accountId,
        saldo > 0n ? 'credito' : 'debito',
        (saldo > 0n ? saldo : -saldo).toString(),
        `Cancelación de saldo por cierre del ejercicio (${cuenta.clasificacionNiif})`,
      ],
    );
  }

  // Contrapartida: el resultado del ejercicio al patrimonio. `neto` viene con
  // signo deudor positivo, así que una UTILIDAD es negativa y se acredita.
  if (neto !== 0n) {
    linea += 1;
    await tx.query(
      `INSERT INTO journal_line (
         tenant_id, company_id, journal_entry_id, linea, account_id, side, monto, descripcion)
       VALUES (app.current_tenant_id(), app.current_company_id(), $1, $2, $3, $4, $5, $6)`,
      [
        journalEntryId,
        linea,
        input.cuentaResultadoId,
        neto < 0n ? 'credito' : 'debito',
        (neto < 0n ? -neto : neto).toString(),
        neto < 0n
          ? 'Utilidad del ejercicio trasladada al patrimonio'
          : 'Pérdida del ejercicio trasladada al patrimonio',
      ],
    );
  }

  await tx.query('SELECT app.publicar_asiento($1)', [journalEntryId]);

  return {
    estado: 'cerrado',
    journalEntryId,
    resultadoDelEjercicio: (-neto).toString(),
    cuentas: aCerrar,
    cuentasSinClasificar: sinClasificar,
  };
}

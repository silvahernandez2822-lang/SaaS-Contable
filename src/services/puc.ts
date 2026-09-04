/**
 * A16 — Plan de cuentas: el genérico de la firma y el propio de cada empresa
 * (Ola 4, Tarea 4).
 *
 * PROBLEMA QUE CIERRA. Al pedir un reporte el sistema exigía cuentas del PUC y
 * el usuario no tenía ninguna forma de saber cuáles existían, ni de cargar las
 * suyas: `account` solo se poblaba con los seeds normativos de A1 (tanda1/010
 * y tanda2/010, PUC del Decreto 2650 recortado a lo que necesitan los veinte
 * casos dorados) y no había ni pantalla ni servicio. Un PUC de veintitantas
 * cuentas no le sirve a ninguna empresa real.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * D-064 — REGLA DE PRECEDENCIA, ESCRITA UNA SOLA VEZ Y EN LA BASE
 *
 * El PUC de una empresa NO reemplaza al genérico: lo SOBREESCRIBE cuenta por
 * cuenta y lo COMPLEMENTA. Para cada `codigo` gana la fila del alcance más
 * específico que exista — empresa > firma > global — y eso lo resuelve la
 * vista `v_account_efectivo` (migración 170), no este archivo. Se hizo así, y
 * no con un `ORDER BY` repetido en cada consulta, porque el ledger, los
 * reportes, la causación y esta pantalla tienen que ver EXACTAMENTE el mismo
 * PUC: si la regla viviera en TypeScript, el primer servicio que la olvidara
 * imputaría contra una cuenta que la pantalla dice que no existe.
 *
 * ESCONDER UNA CUENTA DEL GENÉRICO. La empresa no puede borrar la fila global
 * (la RLS no se lo permite, y borrarla se la quitaría a las otras 59 empresas
 * de la firma). Crea la suya con el mismo código y `activo = false`: la
 * precedencia hace el resto. Es `ocultarCuentaGenerica` aquí abajo.
 *
 * D-065 — EL INTERRUPTOR «SOLO MI PUC». Una empresa que trae su plan de
 * cuentas de otro software no quiere heredar nada. Eso se enciende a mano, por
 * empresa (`company_setting` clave 'puc.solo_propio'), y NUNCA como efecto
 * colateral de cargar un archivo: encenderlo con el PUC propio vacío deja a la
 * empresa sin ninguna cuenta imputable, así que `fijarModoPuc` se niega a
 * hacerlo si todavía no hay cuentas propias que permitan movimiento.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * NIVEL Y PADRE NO SE PIDEN: SE DERIVAN. El PUC colombiano codifica la
 * jerarquía en el propio código (1 clase, 2 grupo, 4 cuenta, 6 subcuenta, 7+
 * auxiliar) y la base ya lo impone con `account_nivel_longitud_ck`. Pedirle a
 * un contador que escriba «nivel 4» al lado de «110505» es pedirle que repita
 * un dato que ya escribió, con la única consecuencia posible de equivocarse.
 * Se deriva de la longitud del código, y si el archivo trae la columna `nivel`
 * se comprueba que coincida en vez de creerle.
 *
 * ESTE ARCHIVO NO CALCULA NADA TRIBUTARIO (Reglas de Oro 2 y 4): el plan de
 * cuentas es catálogo contable. La única regla de negocio que impone es la
 * coherencia de la jerarquía.
 */
import type { SqlClient } from '../db/types';

// =============================================================================
// ERRORES DE DOMINIO
// =============================================================================

export class CuentaInvalidaError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'CuentaInvalidaError';
  }
}

export class CuentaNoEncontradaError extends Error {
  constructor(referencia: string) {
    super(`No existe (o no es visible para esta sesión) la cuenta ${referencia}.`);
    this.name = 'CuentaNoEncontradaError';
  }
}

export class ModoPucInvalidoError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ModoPucInvalidoError';
  }
}

export class ContextoSinEmpresaError extends Error {
  constructor(que: string) {
    super(
      `No hay una empresa seleccionada en la sesión: ${que} es siempre de una empresa concreta. ` +
        'Elija la empresa en la portada y vuelva a intentarlo.',
    );
    this.name = 'ContextoSinEmpresaError';
  }
}

// =============================================================================
// JERARQUÍA DEL PUC — derivada del código, nunca pedida por separado
// =============================================================================

export type NivelPucCuenta = 1 | 2 | 3 | 4 | 5;

const LONGITUD_A_NIVEL: Record<number, NivelPucCuenta> = { 1: 1, 2: 2, 4: 3, 6: 4 };

/** Nivel del PUC que corresponde a un código, según su longitud. */
export function nivelDeCodigo(codigo: string): NivelPucCuenta {
  if (!/^[1-9][0-9]*$/.test(codigo)) {
    throw new CuentaInvalidaError(
      `El código "${codigo}" no es un código de PUC: debe ser solo dígitos y no empezar por cero.`,
    );
  }
  const nivel = LONGITUD_A_NIVEL[codigo.length];
  if (nivel) return nivel;
  if (codigo.length >= 7) return 5;
  throw new CuentaInvalidaError(
    `El código "${codigo}" tiene ${codigo.length} dígitos y ninguna longitud del PUC colombiano ` +
      'corresponde a eso: 1 = clase, 2 = grupo, 4 = cuenta, 6 = subcuenta, 7 o más = auxiliar.',
  );
}

/** Código de la cuenta padre, o `null` para una clase (nivel 1). */
export function codigoPadreDe(codigo: string): string | null {
  switch (nivelDeCodigo(codigo)) {
    case 1:
      return null;
    case 2:
      return codigo.slice(0, 1);
    case 3:
      return codigo.slice(0, 2);
    case 4:
      return codigo.slice(0, 4);
    case 5:
      return codigo.slice(0, 6);
  }
}

// =============================================================================
// CONTEXTO
// =============================================================================

interface ContextoPuc {
  tenantId: string;
  companyId: string | null;
}

async function contexto(tx: SqlClient): Promise<ContextoPuc> {
  const { rows } = await tx.query<{ tenant_id: string | null; company_id: string | null }>(
    'SELECT app.current_tenant_id() AS tenant_id, app.current_company_id() AS company_id',
  );
  const tenantId = rows[0]?.tenant_id ?? null;
  if (!tenantId) throw new ContextoSinEmpresaError('el plan de cuentas');
  return { tenantId, companyId: rows[0]?.company_id ?? null };
}

// =============================================================================
// CONSULTA DEL PUC EFECTIVO
// =============================================================================

export type AlcanceCuenta = 'empresa' | 'firma' | 'global';

export interface FilaCuenta {
  id: string;
  codigo: string;
  nombre: string;
  nivel: NivelPucCuenta;
  naturaleza: 'debito' | 'credito';
  permiteMovimiento: boolean;
  requiereTercero: boolean;
  requiereCentroCosto: boolean;
  requiereBaseGravable: boolean;
  activo: boolean;
  alcance: AlcanceCuenta;
}

interface FilaCuentaCruda {
  id: string;
  codigo: string;
  nombre: string;
  nivel: number;
  naturaleza: 'debito' | 'credito';
  permite_movimiento: boolean;
  requiere_tercero: boolean;
  requiere_centro_costo: boolean;
  requiere_base_gravable: boolean;
  activo: boolean;
  alcance: AlcanceCuenta;
}

function filaCuentaDe(f: FilaCuentaCruda): FilaCuenta {
  return {
    id: f.id,
    codigo: f.codigo,
    nombre: f.nombre,
    nivel: f.nivel as NivelPucCuenta,
    naturaleza: f.naturaleza,
    permiteMovimiento: f.permite_movimiento,
    requiereTercero: f.requiere_tercero,
    requiereCentroCosto: f.requiere_centro_costo,
    requiereBaseGravable: f.requiere_base_gravable,
    activo: f.activo,
    alcance: f.alcance,
  };
}

export interface FiltroPuc {
  busqueda?: string;
  soloImputables?: boolean;
  soloActivas?: boolean;
  limite?: number;
}

/** El PUC que ve la empresa en contexto, ya resuelto por precedencia (D-064). */
export async function listarPucEfectivo(tx: SqlClient, filtro: FiltroPuc = {}): Promise<FilaCuenta[]> {
  const condiciones: string[] = [];
  const params: unknown[] = [];
  if (filtro.busqueda?.trim()) {
    params.push(`%${filtro.busqueda.trim()}%`);
    condiciones.push(`(codigo ILIKE $${params.length} OR nombre ILIKE $${params.length})`);
  }
  if (filtro.soloImputables) condiciones.push('permite_movimiento');
  if (filtro.soloActivas) condiciones.push('activo');
  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
  const limite = Number.isInteger(filtro.limite) && filtro.limite! > 0 ? Math.min(filtro.limite!, 2000) : 500;
  const { rows } = await tx.query<FilaCuentaCruda>(
    `SELECT id, codigo, nombre, nivel, naturaleza, permite_movimiento, requiere_tercero,
            requiere_centro_costo, requiere_base_gravable, activo, alcance
       FROM v_account_efectivo ${where} ORDER BY codigo LIMIT ${limite}`,
    params,
  );
  return rows.map(filaCuentaDe);
}

export interface ResumenPuc {
  /** Cuentas efectivas activas, de cualquier nivel. */
  total: number;
  /** Cuentas activas que admiten partidas (`permite_movimiento`). Es el número
   *  que decide si se puede contabilizar o no: sin ninguna, el ledger no tiene
   *  dónde imputar y todo reporte sale vacío. */
  imputables: number;
  propiasDeLaEmpresa: number;
  deLaFirma: number;
  globales: number;
  soloPropio: boolean;
}

export async function resumenPuc(tx: SqlClient): Promise<ResumenPuc> {
  const { rows } = await tx.query<{
    total: string;
    imputables: string;
    empresa: string;
    firma: string;
    global: string;
    solo_propio: boolean;
  }>(
    `SELECT count(*) FILTER (WHERE activo)                              AS total,
            count(*) FILTER (WHERE activo AND permite_movimiento)       AS imputables,
            count(*) FILTER (WHERE alcance = 'empresa')                 AS empresa,
            count(*) FILTER (WHERE alcance = 'firma')                   AS firma,
            count(*) FILTER (WHERE alcance = 'global')                  AS global,
            app.puc_solo_propio()                                       AS solo_propio
       FROM v_account_efectivo`,
  );
  const f = rows[0];
  return {
    total: Number(f?.total ?? 0),
    imputables: Number(f?.imputables ?? 0),
    propiasDeLaEmpresa: Number(f?.empresa ?? 0),
    deLaFirma: Number(f?.firma ?? 0),
    globales: Number(f?.global ?? 0),
    soloPropio: f?.solo_propio === true,
  };
}

/** Resuelve una cuenta por código dentro del PUC efectivo. */
export async function resolverCuentaPorCodigo(tx: SqlClient, codigo: string): Promise<FilaCuenta | null> {
  const { rows } = await tx.query<FilaCuentaCruda>(
    `SELECT id, codigo, nombre, nivel, naturaleza, permite_movimiento, requiere_tercero,
            requiere_centro_costo, requiere_base_gravable, activo, alcance
       FROM v_account_efectivo WHERE codigo = $1`,
    [codigo.trim()],
  );
  return rows[0] ? filaCuentaDe(rows[0]) : null;
}

export async function puedeEditarPuc(tx: SqlClient): Promise<boolean> {
  const { rows } = await tx.query<{ tiene: boolean }>("SELECT app.tiene_permiso('puc.editar') AS tiene");
  return rows[0]?.tiene === true;
}

// =============================================================================
// MODO DEL PUC POR EMPRESA (D-065)
// =============================================================================

export type ModoPuc = 'generico' | 'solo_propio';

export async function obtenerModoPuc(tx: SqlClient): Promise<ModoPuc> {
  const { rows } = await tx.query<{ solo: boolean }>('SELECT app.puc_solo_propio() AS solo');
  return rows[0]?.solo === true ? 'solo_propio' : 'generico';
}

/**
 * Cambia el modo del PUC de la empresa en contexto.
 *
 * NEGARSE A DEJAR LA EMPRESA SIN CUENTAS es el único juicio que hace esta
 * función: pasar a 'solo_propio' con cero cuentas propias imputables deja el
 * ledger sin ningún destino válido, y el síntoma aparecería mucho después, al
 * intentar causar una factura, con un error que no menciona esta pantalla.
 */
export async function fijarModoPuc(tx: SqlClient, modo: ModoPuc): Promise<void> {
  const ctx = await contexto(tx);
  if (!ctx.companyId) throw new ContextoSinEmpresaError('el modo del plan de cuentas');

  if (modo === 'solo_propio') {
    const { rows } = await tx.query<{ n: string }>(
      `SELECT count(*) AS n FROM account
        WHERE company_id = $1 AND activo AND permite_movimiento`,
      [ctx.companyId],
    );
    if (Number(rows[0]?.n ?? 0) === 0) {
      throw new ModoPucInvalidoError(
        'Esta empresa no tiene todavía ninguna cuenta propia que admita movimiento. Si se apaga el PUC ' +
          'genérico ahora, no quedaría ni una cuenta donde imputar y no se podría causar ninguna factura. ' +
          'Cargue primero el plan de cuentas de la empresa (carga masiva de PUC) y vuelva a intentarlo.',
      );
    }
  }

  await tx.query(
    `INSERT INTO company_setting (tenant_id, company_id, clave, valor, descripcion)
     VALUES ($1, $2, 'puc.solo_propio', $3::jsonb,
             'D-065: la empresa usa exclusivamente su propio plan de cuentas y no hereda el generico.')
     ON CONFLICT (company_id, clave)
     DO UPDATE SET valor = EXCLUDED.valor, updated_at = now()`,
    [ctx.tenantId, ctx.companyId, modo === 'solo_propio' ? 'true' : 'false'],
  );
}

// =============================================================================
// ALTA Y EDICIÓN DE CUENTAS
// =============================================================================

export interface DatosCuenta {
  codigo: string;
  nombre: string;
  naturaleza: 'debito' | 'credito';
  /** Solo las hojas reciben partidas. El ledger lo impone con LG004. */
  permiteMovimiento: boolean;
  requiereTercero?: boolean;
  requiereCentroCosto?: boolean;
  requiereBaseGravable?: boolean;
  activo?: boolean;
  /** Opcional: si viene, se comprueba contra el nivel derivado del código. */
  nivel?: number | null;
  /**
   * 'empresa' (por defecto cuando hay empresa en contexto) o 'firma'
   * (compartida por todas las empresas de la firma, `company_id NULL`).
   */
  alcance?: 'empresa' | 'firma';
}

const NATURALEZAS = new Set(['debito', 'credito']);

function validarDatosCuenta(input: DatosCuenta): { codigo: string; nivel: NivelPucCuenta } {
  const codigo = (input.codigo ?? '').trim();
  if (!codigo) throw new CuentaInvalidaError('El código de la cuenta es obligatorio.');
  const nivel = nivelDeCodigo(codigo);
  if (input.nivel != null && Number(input.nivel) !== nivel) {
    throw new CuentaInvalidaError(
      `El código ${codigo} tiene ${codigo.length} dígitos, que en el PUC es nivel ${nivel}, pero el ` +
        `archivo dice nivel ${input.nivel}. No se adivina cuál de los dos es el bueno: corrija el archivo.`,
    );
  }
  if (!(input.nombre ?? '').trim()) throw new CuentaInvalidaError(`La cuenta ${codigo} no tiene nombre.`);
  if (!NATURALEZAS.has(input.naturaleza)) {
    throw new CuentaInvalidaError(
      `La naturaleza de la cuenta ${codigo} debe ser "debito" o "credito"; llegó ` +
        `${JSON.stringify(input.naturaleza)}.`,
    );
  }
  if (typeof input.permiteMovimiento !== 'boolean') {
    throw new CuentaInvalidaError(
      `Falta declarar si la cuenta ${codigo} admite movimiento (Sí/No). Sin ese dato no se sabe si es ` +
        'una cuenta de agrupación o una donde se imputa, y el ledger rechazaría la partida con LG004.',
    );
  }
  if (nivel < 3 && input.permiteMovimiento) {
    throw new CuentaInvalidaError(
      `La cuenta ${codigo} es de nivel ${nivel} (${nivel === 1 ? 'clase' : 'grupo'}) y no puede admitir ` +
        'movimiento: las partidas se imputan a cuentas, subcuentas o auxiliares.',
    );
  }
  return { codigo, nivel };
}

/**
 * Resuelve el `parent_id` de una cuenta a partir de su código. Devuelve `null`
 * para nivel 1. Lanza si el padre no existe todavía: cargar «110505» sin haber
 * cargado «1105» dejaría un árbol roto que ningún reporte por niveles podría
 * agregar.
 *
 * EXCEPCIÓN, encontrada al probar `ocultarCuentaGenerica`: si ese código YA
 * existe en el PUC efectivo, su padre ya está resuelto y se hereda tal cual.
 * Volver a derivarlo del prefijo exigiría que la empresa cargara toda la cadena
 * de ancestros solo para sobreescribir —o esconder— una cuenta que ya está
 * viendo, y fallaría en cuanto el PUC genérico tuviera un hueco de nivel
 * intermedio. Para un código NUEVO la exigencia sigue en pie.
 */
async function resolverPadre(tx: SqlClient, codigo: string): Promise<string | null> {
  const codigoPadre = codigoPadreDe(codigo);
  if (codigoPadre === null) return null;

  const yaEfectiva = await resolverCuentaPorCodigo(tx, codigo);
  if (yaEfectiva) {
    const { rows } = await tx.query<{ parent_id: string | null }>(
      'SELECT parent_id FROM account WHERE id = $1',
      [yaEfectiva.id],
    );
    // Se hereda TAL CUAL, incluido el `null`: si la cuenta que ya se está
    // viendo cuelga de la nada, la propia tampoco tiene por qué colgar de algo
    // que nadie ha cargado.
    return rows[0]?.parent_id ?? null;
  }

  const padre = await resolverCuentaPorCodigo(tx, codigoPadre);
  if (!padre) {
    throw new CuentaInvalidaError(
      `La cuenta ${codigo} necesita que exista antes su cuenta padre ${codigoPadre}, y no está en el ` +
        'plan de cuentas efectivo. Ponga las cuentas de menor nivel primero en el archivo (1, luego 11, ' +
        'luego 1105, luego 110505).',
    );
  }
  return padre.id;
}

/**
 * Crea una cuenta en el alcance pedido, o ACTUALIZA la que ya exista en ESE
 * MISMO alcance con ese código. No es un `upsert` ciego: solo toca filas cuyo
 * `(tenant_id, company_id, codigo)` coincide, que es justo la clave única de
 * `account`. Nunca escribe sobre una cuenta global ni sobre la de otra
 * empresa — la RLS tampoco lo permitiría.
 */
export async function guardarCuenta(tx: SqlClient, input: DatosCuenta): Promise<{ id: string; creada: boolean }> {
  const { codigo, nivel } = validarDatosCuenta(input);
  const ctx = await contexto(tx);

  const alcance = input.alcance ?? (ctx.companyId ? 'empresa' : 'firma');
  if (alcance === 'empresa' && !ctx.companyId) {
    throw new ContextoSinEmpresaError('una cuenta propia de la empresa');
  }
  const companyId = alcance === 'empresa' ? ctx.companyId : null;

  const parentId = await resolverPadre(tx, codigo);

  const { rows: existente } = await tx.query<{ id: string }>(
    `SELECT id FROM account
      WHERE codigo = $1 AND tenant_id IS NOT DISTINCT FROM $2 AND company_id IS NOT DISTINCT FROM $3`,
    [codigo, ctx.tenantId, companyId],
  );

  const valores = [
    input.nombre.trim(),
    nivel,
    parentId,
    input.naturaleza,
    input.permiteMovimiento,
    input.requiereTercero ?? false,
    input.requiereCentroCosto ?? false,
    input.requiereBaseGravable ?? false,
    input.activo ?? true,
  ];

  if (existente[0]) {
    await tx.query(
      `UPDATE account SET nombre = $2, nivel = $3, parent_id = $4, naturaleza = $5,
                          permite_movimiento = $6, requiere_tercero = $7,
                          requiere_centro_costo = $8, requiere_base_gravable = $9,
                          activo = $10, updated_at = now()
        WHERE id = $1`,
      [existente[0].id, ...valores],
    );
    return { id: existente[0].id, creada: false };
  }

  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO account (tenant_id, company_id, codigo, nombre, nivel, parent_id, naturaleza,
                          permite_movimiento, requiere_tercero, requiere_centro_costo,
                          requiere_base_gravable, activo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING id`,
    [ctx.tenantId, companyId, codigo, ...valores],
  );
  return { id: rows[0]!.id, creada: true };
}

/**
 * Esconde para ESTA empresa una cuenta que viene del PUC genérico o de la
 * firma. No borra nada de nadie: crea (o actualiza) la cuenta homónima de la
 * empresa con `activo = false`, y la precedencia de D-064 hace que sea esa la
 * que gane.
 */
export async function ocultarCuentaGenerica(tx: SqlClient, codigo: string): Promise<void> {
  const efectiva = await resolverCuentaPorCodigo(tx, codigo);
  if (!efectiva) throw new CuentaNoEncontradaError(codigo);
  await guardarCuenta(tx, {
    codigo: efectiva.codigo,
    nombre: efectiva.nombre,
    naturaleza: efectiva.naturaleza,
    permiteMovimiento: efectiva.permiteMovimiento,
    requiereTercero: efectiva.requiereTercero,
    requiereCentroCosto: efectiva.requiereCentroCosto,
    requiereBaseGravable: efectiva.requiereBaseGravable,
    activo: false,
    alcance: 'empresa',
  });
}

// =============================================================================
// D-089 · TAREA 4 — USO INVERSO DE UNA CUENTA Y SIMULADOR DE IMPACTO
//
// El motor (migración 179) impone cinco reglas sobre `account`: una cuenta en
// uso no se borra (PU001), y con movimientos no cambia de naturaleza (PU002),
// no se vuelve agrupadora (PU003) ni se renumera (PU004); con un
// `concepto_causacion` activo apuntándola no se retira ni se desimputa (PU005).
// La interfaz no puede ofrecer una acción que el motor va a negar sin avisar
// antes: estas consultas dan el MISMO criterio (`app.cuenta_uso`, SECURITY
// DEFINER — ve el histórico de todas las empresas de la firma, no solo el de la
// empresa en contexto, porque una cuenta global/de firma puede tener partidas
// en varias) y el listado detallado de qué conceptos la usan, bajo RLS.
// =============================================================================

export type RolCuentaEnConcepto = 'gasto' | 'iva_descontable' | 'contrapartida';

export interface ConceptoQueUsaCuenta {
  conceptoId: string;
  codigo: string;
  nombre: string;
  activo: boolean;
  /** En qué campo(s) del concepto aparece esta cuenta. */
  roles: RolCuentaEnConcepto[];
}

export interface UsoCuenta {
  partidasLedger: number;
  conceptosActivos: number;
  cuentasHijas: number;
  niifMappings: number;
  exogenaMappings: number;
  tieneMovimientos: boolean;
  /** En uso con el criterio que bloquea el motor: partidas o conceptos activos. */
  enUso: boolean;
}

function usoDeFila(f: {
  partidas_ledger: string | number | null;
  conceptos_activos: string | number | null;
  cuentas_hijas?: string | number | null;
  niif_mappings?: string | number | null;
  exogena_mappings?: string | number | null;
}): UsoCuenta {
  const partidasLedger = Number(f.partidas_ledger ?? 0);
  const conceptosActivos = Number(f.conceptos_activos ?? 0);
  return {
    partidasLedger,
    conceptosActivos,
    cuentasHijas: Number(f.cuentas_hijas ?? 0),
    niifMappings: Number(f.niif_mappings ?? 0),
    exogenaMappings: Number(f.exogena_mappings ?? 0),
    tieneMovimientos: partidasLedger > 0,
    enUso: partidasLedger > 0 || conceptosActivos > 0,
  };
}

/** Conteos de uso de UNA cuenta, con el criterio exacto del motor. */
export async function usoDeCuenta(tx: SqlClient, accountId: string): Promise<UsoCuenta> {
  const { rows } = await tx.query<{
    partidas_ledger: string;
    conceptos_activos: string;
    cuentas_hijas: string;
    niif_mappings: string;
    exogena_mappings: string;
  }>('SELECT * FROM app.cuenta_uso($1)', [accountId]);
  return usoDeFila(
    rows[0] ?? {
      partidas_ledger: 0,
      conceptos_activos: 0,
      cuentas_hijas: 0,
      niif_mappings: 0,
      exogena_mappings: 0,
    },
  );
}

/**
 * Uso de un lote de cuentas en un solo round-trip, para los badges de la tabla
 * del PUC. Cada `app.cuenta_uso` es un puñado de EXISTS baratos y el lote está
 * acotado por el LIMIT de la pantalla. NO se creó una vista sobre todo
 * `account` a propósito (migración 179): la consulta real es siempre por unas
 * pocas cuentas visibles.
 */
export async function usoDeCuentas(
  tx: SqlClient,
  accountIds: string[],
): Promise<Map<string, UsoCuenta>> {
  const salida = new Map<string, UsoCuenta>();
  if (accountIds.length === 0) return salida;
  const { rows } = await tx.query<{
    id: string;
    partidas_ledger: string;
    conceptos_activos: string;
    cuentas_hijas: string;
    niif_mappings: string;
    exogena_mappings: string;
  }>(
    `SELECT ids.id, u.*
       FROM unnest($1::uuid[]) AS ids(id)
       CROSS JOIN LATERAL app.cuenta_uso(ids.id) AS u`,
    [accountIds],
  );
  for (const r of rows) salida.set(r.id, usoDeFila(r));
  return salida;
}

function conceptosDeFilas(
  filas: Array<{
    id: string;
    codigo: string;
    nombre: string;
    activo: boolean;
    rol_gasto: boolean;
    rol_iva: boolean;
    rol_contrapartida: boolean;
  }>,
): ConceptoQueUsaCuenta[] {
  return filas.map((r) => {
    const roles: RolCuentaEnConcepto[] = [];
    if (r.rol_gasto) roles.push('gasto');
    if (r.rol_iva) roles.push('iva_descontable');
    if (r.rol_contrapartida) roles.push('contrapartida');
    return { conceptoId: r.id, codigo: r.codigo, nombre: r.nombre, activo: r.activo, roles };
  });
}

/**
 * Qué `concepto_causacion` usan una cuenta y en qué rol. Consulta normal bajo
 * la RLS de `concepto_causacion` (doble nivel tenant/company): el nombre de un
 * concepto de otra firma no sale nunca. Se mira cada una de las tres FKs
 * (`cuenta_gasto_id`, `cuenta_iva_descontable_id`, `cuenta_contrapartida_id`).
 */
export async function conceptosQueUsanCuenta(
  tx: SqlClient,
  accountId: string,
): Promise<ConceptoQueUsaCuenta[]> {
  const { rows } = await tx.query<{
    id: string;
    codigo: string;
    nombre: string;
    activo: boolean;
    rol_gasto: boolean;
    rol_iva: boolean;
    rol_contrapartida: boolean;
  }>(
    `SELECT c.id, c.codigo, c.nombre, c.activo,
            c.cuenta_gasto_id           IS NOT DISTINCT FROM $1 AS rol_gasto,
            c.cuenta_iva_descontable_id IS NOT DISTINCT FROM $1 AS rol_iva,
            c.cuenta_contrapartida_id   IS NOT DISTINCT FROM $1 AS rol_contrapartida
       FROM concepto_causacion c
      WHERE $1 IN (c.cuenta_gasto_id, c.cuenta_iva_descontable_id, c.cuenta_contrapartida_id)
      ORDER BY c.activo DESC, c.codigo`,
    [accountId],
  );
  return conceptosDeFilas(rows);
}

/** Igual que `conceptosQueUsanCuenta` pero para un lote de cuentas. */
export async function conceptosQueUsanCuentas(
  tx: SqlClient,
  accountIds: string[],
): Promise<Map<string, ConceptoQueUsaCuenta[]>> {
  const salida = new Map<string, ConceptoQueUsaCuenta[]>();
  if (accountIds.length === 0) return salida;
  const { rows } = await tx.query<{
    account_id: string;
    id: string;
    codigo: string;
    nombre: string;
    activo: boolean;
    rol_gasto: boolean;
    rol_iva: boolean;
    rol_contrapartida: boolean;
  }>(
    `SELECT ids.id AS account_id, c.id, c.codigo, c.nombre, c.activo,
            c.cuenta_gasto_id           IS NOT DISTINCT FROM ids.id AS rol_gasto,
            c.cuenta_iva_descontable_id IS NOT DISTINCT FROM ids.id AS rol_iva,
            c.cuenta_contrapartida_id   IS NOT DISTINCT FROM ids.id AS rol_contrapartida
       FROM unnest($1::uuid[]) AS ids(id)
       JOIN concepto_causacion c
         ON ids.id IN (c.cuenta_gasto_id, c.cuenta_iva_descontable_id, c.cuenta_contrapartida_id)
      ORDER BY c.activo DESC, c.codigo`,
    [accountIds],
  );
  for (const r of rows) {
    const previas = salida.get(r.account_id) ?? [];
    previas.push(...conceptosDeFilas([r]));
    salida.set(r.account_id, previas);
  }
  return salida;
}

// -----------------------------------------------------------------------------
// SIMULADOR DE IMPACTO — se corre ANTES de guardar una edición de cuenta en uso
// -----------------------------------------------------------------------------

export type CodigoRechazoCuenta = 'PU002' | 'PU003' | 'PU004' | 'PU005';

export interface ImpactoCambioCuenta {
  codigo: string;
  nombre: string;
  enUso: boolean;
  partidasLedger: number;
  conceptosActivos: number;
  conceptos: ConceptoQueUsaCuenta[];
  /** Cambios pedidos que el motor (migración 179) va a RECHAZAR. */
  rechazos: Array<{ codigo: CodigoRechazoCuenta; motivo: string }>;
  /** Cambios permitidos pero con impacto: exigen confirmación explícita. */
  advertencias: string[];
  /** Hay algo que confirmar y NADA que el motor rechace. */
  requiereConfirmacion: boolean;
  /** El motor va a rechazar: la UI no debe ofrecer "guardar". */
  bloqueadoPorMotor: boolean;
}

export type CambioPropuestoCuenta = Pick<
  DatosCuenta,
  'codigo' | 'naturaleza' | 'permiteMovimiento' | 'activo'
>;

/**
 * Predice, con el mismo criterio que el trigger `account_restrict_uso`, qué le
 * pasa a una cuenta EN USO si se guarda `propuesta`. No escribe nada.
 */
export async function simularImpactoCambioCuenta(
  tx: SqlClient,
  actual: FilaCuenta,
  propuesta: CambioPropuestoCuenta,
): Promise<ImpactoCambioCuenta> {
  const uso = await usoDeCuenta(tx, actual.id);
  const conceptos = uso.enUso ? await conceptosQueUsanCuenta(tx, actual.id) : [];

  const cambiaNaturaleza = propuesta.naturaleza !== actual.naturaleza;
  const desimputa = actual.permiteMovimiento && propuesta.permiteMovimiento === false;
  const cambiaCodigo = propuesta.codigo.trim() !== actual.codigo;
  const inactiva = actual.activo && propuesta.activo === false;

  const rechazos: ImpactoCambioCuenta['rechazos'] = [];
  if (uso.tieneMovimientos && cambiaNaturaleza) {
    rechazos.push({
      codigo: 'PU002',
      motivo: `La cuenta ${actual.codigo} ya tiene ${uso.partidasLedger} partida(s) en el ledger; cambiarle la naturaleza de "${actual.naturaleza}" a "${propuesta.naturaleza}" invertiría el signo de todos los reportes del pasado. Cree una cuenta nueva y traslade el saldo con un asiento.`,
    });
  }
  if (uso.tieneMovimientos && desimputa) {
    rechazos.push({
      codigo: 'PU003',
      motivo: `La cuenta ${actual.codigo} ya tiene ${uso.partidasLedger} partida(s) y no se puede convertir en cuenta de agrupación: el histórico quedaría imputado sobre algo que no admite imputación. Si no quiere seguir usándola, inactívela.`,
    });
  }
  if (uso.tieneMovimientos && cambiaCodigo) {
    rechazos.push({
      codigo: 'PU004',
      motivo: `La cuenta ${actual.codigo} ya tiene ${uso.partidasLedger} partida(s); renumerarla a ${propuesta.codigo.trim()} reclasificaría en silencio los reportes, la exógena y los papeles de trabajo ya emitidos. Cree la cuenta nueva y traslade el saldo con un asiento.`,
    });
  }
  if (uso.conceptosActivos > 0 && (inactiva || desimputa || cambiaNaturaleza)) {
    rechazos.push({
      codigo: 'PU005',
      motivo: `${uso.conceptosActivos} concepto(s) de causación o memoria(s) de clasificación activos apuntan a la cuenta ${actual.codigo}. Retirarla o cambiarla rompería la causación automática en la siguiente factura. Reasigne primero esos conceptos a otra cuenta.`,
    });
  }

  const advertencias: string[] = [];
  if (uso.tieneMovimientos && inactiva && uso.conceptosActivos === 0) {
    advertencias.push(
      `Inactivar la cuenta ${actual.codigo} la retira de los selectores. Sus ${uso.partidasLedger} partida(s) y su saldo histórico se conservan y los reportes del pasado la siguen resolviendo por su id.`,
    );
  }

  const bloqueadoPorMotor = rechazos.length > 0;
  return {
    codigo: actual.codigo,
    nombre: actual.nombre,
    enUso: uso.enUso,
    partidasLedger: uso.partidasLedger,
    conceptosActivos: uso.conceptosActivos,
    conceptos,
    rechazos,
    advertencias,
    requiereConfirmacion: advertencias.length > 0 && !bloqueadoPorMotor,
    bloqueadoPorMotor,
  };
}

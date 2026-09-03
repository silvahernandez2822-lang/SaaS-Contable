/**
 * A14 — COMPUERTA DE LA OLA 2, POR LA INTERFAZ REAL.
 *
 * Los otros dos criterios de salida de la sección 4 hablan de lo que hace un
 * CONTADOR, no de lo que hace una función de servicio. Desde esta ola existe
 * `app/` (A7 y A8), así que se prueban por donde el contador los va a usar: las
 * acciones de servidor de Next.js, con su `FormData`, su cookie de sesión y su
 * `redirect`.
 *
 * Lo único que se simula es el transporte de Next (`next/headers`,
 * `next/navigation`) y la conexión (`app/lib/db.ts`). Todo lo demás —la sesión,
 * el rol, la RLS, los triggers de vigencia, el ledger— es el real.
 *
 * Un contador HOSTIL es un usuario legítimo con malas intenciones o con prisa:
 * intenta editar hacia atrás, intenta tocar la vigencia anterior, y aprueba en
 * lote con filas que ya no le corresponden. Los tres se prueban aquí.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDb, uuid, type TestDb } from '../helpers/db';
import {
  crearAsientoBorrador,
  crearEscenario,
  partidasEquilibradas,
  type Escenario,
} from '../helpers/fixtures';
import { isPostgresError, SQLSTATE, type DbHandle, type SqlClient } from '../../src/db/types';

// -----------------------------------------------------------------------------
// Simulación del transporte de Next.js — y NADA más
// -----------------------------------------------------------------------------
const cookieState = new Map<string, string>();
const redirecciones: string[] = [];
/** Cabeceras de la petición simulada. `x-forwarded-for` es la que el proxy
 * pone en producción y de la que depende `approval.ip` (NOT NULL). Se hace
 * variable a propósito: A14 mide qué pasa cuando NO llega (V-11). */
const cabeceras = new Map<string, string>([
  ['user-agent', 'A14/adversarial'],
  ['x-forwarded-for', '203.0.113.44'],
]);

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nombre: string) => {
      const value = cookieState.get(nombre);
      return value === undefined ? undefined : { name: nombre, value };
    },
  }),
  headers: async () => cabeceras,
}));

vi.mock('next/navigation', () => ({
  redirect: (destino: string) => {
    redirecciones.push(destino);
  },
}));

let db: TestDb;

vi.mock('../../app/lib/db.js', () => ({
  obtenerDb: async (): Promise<DbHandle> => db.client,
}));

// Importaciones que dependen de los mocks: después de declararlos.
// D-087: la edición de valores base pasó a DOS pasos (simular ANTES de
// guardar). `guardarUvtAction` aquí es el helper que recorre los dos como lo
// haría el contador: simula, y si el simulador no falló, confirma con los
// campos que el paso 1 devolvió en el query string.
const { simularUvtAction, confirmarUvtAction } = await import(
  '../../app/parametros/valores-base/acciones'
);
async function guardarUvtAction(fd: FormData): Promise<void> {
  await simularUvtAction(fd);
  const sp = new URLSearchParams(ultimaRedireccion().split('?')[1] ?? '');
  if (sp.get('error')) return;
  const fd2 = new FormData();
  // `conceptos` / `proveedores` son el TESTIGO del paso 1 (V-39, compuerta
  // ampliada de D-087): la pantalla de confirmación los lleva en campos ocultos
  // y la acción del paso 2 no escribe sin ellos.
  for (const k of [
    'reglaAnteriorId', 'anio', 'valorPesos', 'vigenteDesde', 'normaRespaldo', 'alcanceNuevo',
    'conceptos', 'proveedores',
  ]) {
    fd2.set(k, sp.get(k) ?? '');
  }
  await confirmarUvtAction(fd2);
}
const { aprobarSeleccionAction } = await import('../../app/bandeja/acciones');
const { obtenerBandejaConsolidada } = await import('../../app/lib/bandeja');

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db?.close();
});

/**
 * Deja una sesión REAL puesta en la cookie, como haría el login.
 *
 * `companyIdAcceso` es la empresa sobre la que se garantiza el acceso (el
 * harness crea la fila de `user_company_access`); `companyEnCookie` es la que
 * el navegador presenta —vacía significa «sesión de firma», que es la que usa
 * el módulo de parametrización para un parámetro compartido (D-015)—.
 */
async function ponerSesion(
  tenantId: string,
  companyIdAcceso: string,
  extra: { userId?: string; rolCodigo?: string; companyEnCookie?: string | null } = {},
): Promise<string> {
  const { token, userId } = await db.emitirSesion(tenantId, companyIdAcceso, {
    userId: extra.userId,
    rolCodigo: extra.rolCodigo,
    sesionNueva: true,
  });
  cookieState.set('session_token', token);
  const enCookie =
    extra.companyEnCookie === undefined ? companyIdAcceso : extra.companyEnCookie;
  if (enCookie) cookieState.set('company_id', enCookie);
  else cookieState.delete('company_id');
  return userId;
}

function ultimaRedireccion(): string {
  return redirecciones[redirecciones.length - 1] ?? '';
}

function errorDeRedireccion(destino: string): string | null {
  const q = destino.includes('?') ? destino.slice(destino.indexOf('?') + 1) : '';
  return new URLSearchParams(q).get('error');
}

async function capturarCodigo(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'NO-FALLO';
  } catch (e) {
    return isPostgresError(e) ? (e.code ?? 'sin-codigo') : `js:${String(e)}`;
  }
}

// =============================================================================
// CRITERIO DE SALIDA 1 — el contador cambia la UVT DESDE LA INTERFAZ
// =============================================================================

describe('A14 · CRITERIO DE SALIDA 1 — la UVT se cambia desde la interfaz de A8', () => {
  let e: Escenario;
  let uvtVigenteId = '';
  let asientoPublicadoId = '';
  let fotoAntes = '';

  /** Fotografía de TODO lo publicado en la firma, para comparar antes/después. */
  async function fotoDeLoPublicado(tenantId: string): Promise<string> {
    return db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ foto: string }>(
        `SELECT COALESCE(jsonb_agg(x ORDER BY x->>'id')::text, '[]') AS foto
           FROM (
             SELECT to_jsonb(je.*) || jsonb_build_object(
                      'partidas', COALESCE((SELECT jsonb_agg(to_jsonb(jl.*) ORDER BY jl.linea)
                                              FROM journal_line jl
                                             WHERE jl.journal_entry_id = je.id), '[]'::jsonb)) AS x
               FROM journal_entry je
              WHERE je.tenant_id = $1 AND je.estado = 'posted') s`,
        [tenantId],
      );
      return rows[0]!.foto;
    });
  }

  beforeAll(async () => {
    e = await crearEscenario(db, { razonSocial: 'Firma del cambio de UVT por interfaz' });

    uvtVigenteId = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO uvt_value (tenant_id, company_id, anio, valor, vigente_desde, norma_respaldo)
         VALUES ($1, NULL, 2026, $2, DATE '2026-01-01', 'Resolución de la DIAN (dato del escenario de A14)')
         RETURNING id`,
        // El valor NO es un dato normativo del código: es un número arbitrario
        // del escenario, elegido para que no coincida con ninguna UVT real.
        [e.tenantId, '3333300'],
      );
      return rows[0]!.id;
    });

    // Un asiento YA PUBLICADO, con fecha anterior a cualquier vigencia nueva.
    asientoPublicadoId = await db.asAdmin(async (tx) => {
      const id = await crearAsientoBorrador(tx, e, partidasEquilibradas(e), {
        descripcion: 'Asiento publicado antes de tocar la UVT',
        idempotencyKey: `a14-uvt-${uuid()}`,
      });
      await tx.query('SELECT app.publicar_asiento($1, $2)', [id, e.userId]);
      return id;
    });

    fotoAntes = await fotoDeLoPublicado(e.tenantId);
    expect(fotoAntes).not.toBe('[]');
  });

  it('1) el contador guarda una vigencia nueva desde el formulario, y la interfaz confirma', async () => {
    // Sesión "de firma" (sin empresa en la cookie): es lo que exige un
    // parámetro compartido entre las empresas (D-015). El rol es
    // `admin_tributario`, el único que la sección 6.2 punto 5 autoriza a crear
    // vigencias nuevas.
    await ponerSesion(e.tenantId, e.companyId, {
      rolCodigo: 'admin_tributario',
      companyEnCookie: null,
    });

    const fd = new FormData();
    fd.set('reglaAnteriorId', uvtVigenteId);
    fd.set('anio', '2027');
    fd.set('valorPesos', '41234'); // pesos; la acción los pasa a centavos
    fd.set('vigenteDesde', '2027-01-01');
    fd.set('normaRespaldo', 'Resolución DIAN de 2026 (escenario de A14)');
    fd.set('alcanceNuevo', 'firma');

    await guardarUvtAction(fd);
    expect(errorDeRedireccion(ultimaRedireccion())).toBeNull();
    expect(ultimaRedireccion()).toContain('ok=uvt');
  });

  it('2) la vigencia ANTERIOR conserva su valor: solo se le cerró la fecha', async () => {
    const anterior = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{
        valor: string;
        vigente_desde: string;
        vigente_hasta: string | null;
      }>(
        `SELECT valor::text, vigente_desde::text, vigente_hasta::text FROM uvt_value WHERE id = $1`,
        [uvtVigenteId],
      );
      return rows[0]!;
    });
    expect(anterior.valor).toBe('3333300');
    expect(anterior.vigente_desde).toBe('2026-01-01');
    expect(anterior.vigente_hasta).toBe('2026-12-31');
  });

  it('3) existe una vigencia NUEVA, con el valor nuevo, y la consulta por fecha del hecho las distingue', async () => {
    const resuelto = await db.asAdmin(async (tx) => {
      const porFecha = async (fecha: string): Promise<string | null> => {
        const { rows } = await tx.query<{ valor: string }>(
          `SELECT valor::text FROM uvt_value
            WHERE tenant_id = $1
              AND vigente_desde <= $2::date
              AND (vigente_hasta IS NULL OR vigente_hasta >= $2::date)
            ORDER BY vigente_desde DESC LIMIT 1`,
          [e.tenantId, fecha],
        );
        return rows[0]?.valor ?? null;
      };
      return {
        junio2026: await porFecha('2026-06-15'),
        enero2027: await porFecha('2027-01-15'),
      };
    });
    expect(resuelto.junio2026).toBe('3333300');
    expect(resuelto.enero2027).toBe('4123400');
  });

  it('4) NADA de lo ya publicado cambió: la fotografía del ledger es idéntica', async () => {
    const fotoDespues = await fotoDeLoPublicado(e.tenantId);
    expect(fotoDespues).toBe(fotoAntes);

    const sigueVivo = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ estado: string }>(
        `SELECT estado FROM journal_entry WHERE id = $1`,
        [asientoPublicadoId],
      );
      return rows[0]!.estado;
    });
    expect(sigueVivo).toBe('posted');
  });

  it('5) CONTADOR HOSTIL: editar hacia atrás de lo ya publicado lo rechaza el servicio, sin tocar nada', async () => {
    const antes = await fotoDeLoPublicado(e.tenantId);
    const fd = new FormData();
    fd.set('reglaAnteriorId', uvtVigenteId);
    fd.set('anio', '2026');
    fd.set('valorPesos', '99999');
    fd.set('vigenteDesde', '2026-01-02'); // ANTES del hecho publicado del 15-jun
    fd.set('normaRespaldo', 'Intento retroactivo de A14');
    fd.set('alcanceNuevo', 'firma');

    await guardarUvtAction(fd);
    const error = errorDeRedireccion(ultimaRedireccion());
    expect(error).not.toBeNull();
    expect(await fotoDeLoPublicado(e.tenantId)).toBe(antes);
  });

  it('6) CONTADOR HOSTIL: aunque rodee la interfaz, el TRIGGER impide mutar la vigencia anterior', async () => {
    // Se usa el rol que SÍ puede parametrizar: así el rechazo no puede venir
    // del permiso, tiene que venir del trigger de vigencia.
    const opciones = { rolCodigo: 'admin_tributario', sesionNueva: true } as const;
    // Cambiar el valor de la fila anterior.
    const codigoValor = await capturarCodigo(() =>
      db.asTenant(
        e.tenantId,
        e.companyId,
        (tx) => tx.query(`UPDATE uvt_value SET valor = 9999999 WHERE id = $1`, [uvtVigenteId]),
        opciones,
      ),
    );
    expect(codigoValor).toBe(SQLSTATE.VIGENCIA_INMUTABLE);

    // Mover la fecha de inicio.
    const codigoDesde = await capturarCodigo(() =>
      db.asTenant(
        e.tenantId,
        e.companyId,
        (tx) =>
          tx.query(`UPDATE uvt_value SET vigente_desde = DATE '2025-01-01' WHERE id = $1`, [
            uvtVigenteId,
          ]),
        opciones,
      ),
    );
    expect(codigoDesde).toBe(SQLSTATE.VIGENCIA_INMUTABLE);

    // Reabrir la vigencia ya cerrada.
    const codigoReabrir = await capturarCodigo(() =>
      db.asTenant(
        e.tenantId,
        e.companyId,
        (tx) => tx.query(`UPDATE uvt_value SET vigente_hasta = NULL WHERE id = $1`, [uvtVigenteId]),
        opciones,
      ),
    );
    expect(codigoReabrir).toBe(SQLSTATE.VIGENCIA_INMUTABLE);

    // Borrarla.
    const codigoBorrar = await capturarCodigo(() =>
      db.asTenant(
        e.tenantId,
        e.companyId,
        (tx) => tx.query(`DELETE FROM uvt_value WHERE id = $1`, [uvtVigenteId]),
        opciones,
      ),
    );
    expect(codigoBorrar).toBe(SQLSTATE.VIGENCIA_NO_BORRABLE);

    // Y el valor sigue siendo el original.
    const valor = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ valor: string }>(
        `SELECT valor::text FROM uvt_value WHERE id = $1`,
        [uvtVigenteId],
      );
      return rows[0]!.valor;
    });
    expect(valor).toBe('3333300');
  });

  it('7) un usuario SIN el permiso de parametrización no puede guardar nada desde la interfaz', async () => {
    const antesFilas = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM uvt_value WHERE tenant_id = $1`,
        [e.tenantId],
      );
      return Number(rows[0]!.n);
    });

    await ponerSesion(e.tenantId, e.companyId, { rolCodigo: 'auxiliar_causacion' });
    const fd = new FormData();
    fd.set('reglaAnteriorId', uvtVigenteId);
    fd.set('anio', '2028');
    fd.set('valorPesos', '77777');
    fd.set('vigenteDesde', '2028-01-01');
    fd.set('normaRespaldo', 'Intento sin permiso');
    fd.set('alcanceNuevo', 'firma');
    await guardarUvtAction(fd);

    expect(errorDeRedireccion(ultimaRedireccion())).not.toBeNull();
    const despuesFilas = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM uvt_value WHERE tenant_id = $1`,
        [e.tenantId],
      );
      return Number(rows[0]!.n);
    });
    expect(despuesFilas).toBe(antesFilas);
  });
});

// =============================================================================
// CRITERIO DE SALIDA 3 — 30 empresas en una pantalla, 50 aprobaciones de un golpe
// =============================================================================

interface EmpresaExtra {
  companyId: string;
  fiscalPeriodId: string;
  cuentas: { claseGasto: string; gasto: string; ivaDescontable: string; proveedores: string };
  thirdPartyId: string;
  documentos: string[];
  asientos: string[];
}

describe('A14 · CRITERIO DE SALIDA 3 — 30 empresas en una pantalla y 50 aprobaciones de un golpe', () => {
  const TOTAL_EMPRESAS = 30;
  const POR_EMPRESA = 2;
  let base: Escenario;
  let empresas: EmpresaExtra[] = [];
  /** Los 50 asientos que el paso 3 aprueba, para que el paso 6 elija una empresa intacta. */
  const seleccionadasEnElLoteDe50 = new Set<string>();
  /** La empresa 31: existe en la firma y el usuario NO tiene acceso a ella. */
  let empresaSinAcceso: EmpresaExtra;

  async function crearEmpresa(
    e: Escenario,
    indice: number,
    opciones: { conAcceso: boolean },
  ): Promise<EmpresaExtra> {
    const companyId = uuid();
    const fiscalPeriodId = uuid();
    const cuentas = {
      claseGasto: uuid(),
      gasto: uuid(),
      ivaDescontable: uuid(),
      proveedores: uuid(),
    };
    const thirdPartyId = uuid();
    const documentos: string[] = [];
    const asientos: string[] = [];
    const s = `${indice}`.padStart(3, '0');

    await db.asAdmin(async (tx) => {
      await tx.query(
        `INSERT INTO company (id, tenant_id, nit, razon_social, municipality_id, ciiu_principal_id,
                              es_agente_retencion_renta, buzon_email)
         VALUES ($1,$2,$3,$4,$5,$6,true,$7)`,
        [
          companyId,
          e.tenantId,
          `8${s}${uuid().slice(0, 6)}`,
          `Empresa ${s} de la bandeja`,
          e.municipalityId,
          e.ciiuId,
          `bandeja-${s}-${uuid().slice(0, 8)}@inbox.ejemplo.co`,
        ],
      );
      if (opciones.conAcceso) {
        await tx.query(
          `INSERT INTO user_company_access (tenant_id, company_id, user_id, role_id)
           VALUES ($1,$2,$3,'00000000-0000-0000-0000-0000000000a3')`,
          [e.tenantId, companyId, e.userId],
        );
      }
      await tx.query(
        `INSERT INTO fiscal_period (id, tenant_id, company_id, anio, mes, fecha_inicio, fecha_fin, estado)
         VALUES ($1,$2,$3,2026,6,'2026-06-01','2026-06-30','abierto')`,
        [fiscalPeriodId, e.tenantId, companyId],
      );
      await tx.query(
        `INSERT INTO account (id, tenant_id, company_id, codigo, nombre, nivel, naturaleza, permite_movimiento)
         VALUES ($1,$2,$3,'5','Gastos',1,'debito',false)`,
        [cuentas.claseGasto, e.tenantId, companyId],
      );
      await tx.query(
        `INSERT INTO account (id, tenant_id, company_id, codigo, nombre, nivel, parent_id, naturaleza, permite_movimiento)
         VALUES ($1,$2,$3,'513595','Otros servicios',4,$4,'debito',true)`,
        [cuentas.gasto, e.tenantId, companyId, cuentas.claseGasto],
      );
      await tx.query(
        `INSERT INTO account (id, tenant_id, company_id, codigo, nombre, nivel, naturaleza, permite_movimiento)
         VALUES ($1,$2,$3,'240805','IVA descontable',4,'debito',true)`,
        [cuentas.ivaDescontable, e.tenantId, companyId],
      );
      await tx.query(
        `INSERT INTO account (id, tenant_id, company_id, codigo, nombre, nivel, naturaleza, permite_movimiento)
         VALUES ($1,$2,$3,'220505','Proveedores nacionales',4,'credito',true)`,
        [cuentas.proveedores, e.tenantId, companyId],
      );
      await tx.query(
        `INSERT INTO third_party (id, tenant_id, company_id, numero_documento, tipo_persona,
                                  razon_social, municipality_id, codigo_dane)
         VALUES ($1,$2,$3,$4,'juridica',$5,$6,'11001')`,
        [thirdPartyId, e.tenantId, companyId, `9${s}${uuid().slice(0, 6)}`, `Proveedor ${s}`, e.municipalityId],
      );

      for (let k = 0; k < POR_EMPRESA; k += 1) {
        const docId = uuid();
        const approvalId = uuid();
        const entryId = uuid();
        await tx.query(
          `INSERT INTO source_document (id, tenant_id, company_id, tipo_documento, cufe,
                                        numero_documento, emisor_nit, third_party_id,
                                        fecha_hecho_economico, hash_contenido, estado, total_neto)
           VALUES ($1,$2,$3,'Invoice',$4,$5,$6,$7,'2026-06-15',$8,'pendiente_aprobacion',119000000)`,
          [
            docId,
            e.tenantId,
            companyId,
            `CUFE-BANDEJA-${docId}`,
            `FE-${s}-${k}`,
            `9${s}`,
            thirdPartyId,
            `hash-bandeja-${docId}`,
          ],
        );
        await tx.query(
          `INSERT INTO approval (id, tenant_id, company_id, entidad, entidad_id, source_document_id,
                                 decision, user_id, ip)
           VALUES ($1,$2,$3,'source_document',$4,$4,'aprobado',$5,'192.0.2.10')`,
          [approvalId, e.tenantId, companyId, docId, e.userId],
        );
        await tx.query(
          `INSERT INTO journal_entry (id, tenant_id, company_id, fiscal_period_id, fecha_hecho_economico,
                                      descripcion, estado, source_document_id, approval_id,
                                      idempotency_key, created_by)
           VALUES ($1,$2,$3,$4,'2026-06-15',$5,'draft',$6,$7,$8,$9)`,
          [
            entryId,
            e.tenantId,
            companyId,
            fiscalPeriodId,
            `Causación ${s}-${k}`,
            docId,
            approvalId,
            `idem-bandeja-${entryId}`,
            e.userId,
          ],
        );
        await tx.query(
          `INSERT INTO journal_line (tenant_id, company_id, journal_entry_id, linea, account_id, side, monto, third_party_id)
           VALUES ($1,$2,$3,1,$4,'debito',10000000,$6), ($1,$2,$3,2,$5,'credito',10000000,$6)`,
          [e.tenantId, companyId, entryId, cuentas.gasto, cuentas.proveedores, thirdPartyId],
        );
        documentos.push(docId);
        asientos.push(entryId);
      }
    });

    return { companyId, fiscalPeriodId, cuentas, thirdPartyId, documentos, asientos };
  }

  beforeAll(async () => {
    base = await crearEscenario(db, { razonSocial: 'Firma contable con 30 empresas' });
    empresas = [];
    for (let i = 0; i < TOTAL_EMPRESAS; i += 1) {
      empresas.push(await crearEmpresa(base, i, { conAcceso: true }));
    }
    empresaSinAcceso = await crearEmpresa(base, 999, { conAcceso: false });
    await ponerSesion(base.tenantId, empresas[0]!.companyId, { userId: base.userId });
  }, 240_000);

  it('1) una sola pantalla trae las facturas pendientes de las 30 empresas', async () => {
    const bandeja = await obtenerBandejaConsolidada();

    // 30 empresas de este bloque + la del escenario base = 31 accesibles.
    const idsAccesibles = new Set(bandeja.empresas.map((x) => x.companyId));
    for (const empresa of empresas) {
      expect(idsAccesibles.has(empresa.companyId)).toBe(true);
    }

    const porEmpresa = new Map<string, number>();
    for (const fila of bandeja.pendientesAprobacion) {
      porEmpresa.set(fila.companyId, (porEmpresa.get(fila.companyId) ?? 0) + 1);
    }
    for (const empresa of empresas) {
      expect(`${empresa.companyId}: ${porEmpresa.get(empresa.companyId) ?? 0}`).toBe(
        `${empresa.companyId}: ${POR_EMPRESA}`,
      );
    }
    expect(bandeja.pendientesAprobacion.length).toBeGreaterThanOrEqual(
      TOTAL_EMPRESAS * POR_EMPRESA,
    );
  }, 240_000);

  it('2) la empresa a la que la sesión NO tiene acceso no aparece, ni ella ni sus facturas', async () => {
    const bandeja = await obtenerBandejaConsolidada();
    const ids = bandeja.empresas.map((x) => x.companyId);
    expect(ids).not.toContain(empresaSinAcceso.companyId);
    expect(bandeja.pendientesAprobacion.map((f) => f.companyId)).not.toContain(
      empresaSinAcceso.companyId,
    );
    const documentosVistos = new Set(bandeja.pendientesAprobacion.map((f) => f.sourceDocumentId));
    for (const doc of empresaSinAcceso.documentos) {
      expect(documentosVistos.has(doc)).toBe(false);
    }
  }, 240_000);

  it('3) 50 filas de distintas empresas se aprueban de un golpe, y quedan las 50 publicadas', async () => {
    const seleccion: { companyId: string; entryId: string }[] = [];
    for (const empresa of empresas) {
      for (const entryId of empresa.asientos) {
        if (seleccion.length < 50) {
          seleccion.push({ companyId: empresa.companyId, entryId });
          seleccionadasEnElLoteDe50.add(entryId);
        }
      }
    }
    expect(seleccion).toHaveLength(50);

    const fd = new FormData();
    for (const s of seleccion) fd.append('sel', `${s.companyId}::${s.entryId}`);
    await aprobarSeleccionAction(fd);

    const error = errorDeRedireccion(ultimaRedireccion());
    expect(error).toBeNull();

    const publicados = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM journal_entry
          WHERE id = ANY($1::uuid[]) AND estado = 'posted'`,
        [seleccion.map((s) => s.entryId)],
      );
      return Number(rows[0]!.n);
    });
    expect(publicados).toBe(50);
  }, 240_000);

  it('4) CONTADOR HOSTIL: seleccionar una factura de una empresa SIN acceso no publica nada', async () => {
    const fd = new FormData();
    for (const entryId of empresaSinAcceso.asientos) {
      fd.append('sel', `${empresaSinAcceso.companyId}::${entryId}`);
    }
    await aprobarSeleccionAction(fd);

    const publicados = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM journal_entry
          WHERE id = ANY($1::uuid[]) AND estado = 'posted'`,
        [empresaSinAcceso.asientos],
      );
      return Number(rows[0]!.n);
    });
    expect(publicados).toBe(0);
  }, 240_000);

  it('5) CONTADOR HOSTIL: falsificar el companyId del formulario tampoco publica el asiento ajeno', async () => {
    // El asiento es de `empresaSinAcceso`, pero el formulario declara una
    // empresa a la que el usuario SÍ tiene acceso. Si el aislamiento fuera de
    // aplicación y no de motor, esto publicaría.
    const victima = empresaSinAcceso.asientos[0]!;
    const fd = new FormData();
    fd.append('sel', `${empresas[1]!.companyId}::${victima}`);
    await aprobarSeleccionAction(fd);

    const estado = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ estado: string }>(
        `SELECT estado FROM journal_entry WHERE id = $1`,
        [victima],
      );
      return rows[0]!.estado;
    });
    expect(estado).toBe('draft');
  }, 240_000);

  it('6) ROBUSTEZ DEL LOTE: una fila que falla NO puede tumbar a las sanas del mismo lote', async () => {
    // Escenario realísimo: dos contadores con la misma bandeja abierta, o un
    // doble clic. Se toma una empresa cuyas dos facturas siguen en borrador
    // (las 50 del paso 3 no llegaron hasta ella), se publica UNA por su
    // cuenta, y luego se manda un lote que incluye la ya publicada y la sana.
    const empresa = empresas.find((emp) =>
      emp.asientos.every((id) => !seleccionadasEnElLoteDe50.has(id)),
    );
    expect(empresa).toBeDefined();
    const [primera, segunda] = empresa!.asientos as [string, string];

    const fdPrevio = new FormData();
    fdPrevio.append('sel', `${empresa!.companyId}::${primera}`);
    await aprobarSeleccionAction(fdPrevio);
    expect(errorDeRedireccion(ultimaRedireccion())).toBeNull();

    const estadoPrevio = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ estado: string }>(
        `SELECT estado FROM journal_entry WHERE id = ANY($1::uuid[]) ORDER BY id`,
        [[primera, segunda]],
      );
      return rows.map((r) => r.estado).sort().join(',');
    });
    expect(estadoPrevio).toBe('draft,posted');

    // El lote: la ya publicada (que fallará) y la sana (que DEBE publicarse).
    const fd = new FormData();
    fd.append('sel', `${empresa!.companyId}::${primera}`);
    fd.append('sel', `${empresa!.companyId}::${segunda}`);
    await aprobarSeleccionAction(fd);

    const error = errorDeRedireccion(ultimaRedireccion());
    // La fila mala se reporta...
    expect(error).not.toBeNull();
    expect(error).toContain(primera);
    // ...y la sana NO aparece entre los errores: no murió por contagio.
    expect(error).not.toContain(segunda);
    expect(error).not.toContain('current transaction is aborted');

    const estadoFinal = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ estado: string }>(
        `SELECT estado FROM journal_entry WHERE id = $1`,
        [segunda],
      );
      return rows[0]!.estado;
    });
    expect(estadoFinal).toBe('posted');
  }, 240_000);

  it('7) V-11 · sin cabecera de IP la aprobación NO publica a medias: falla entera y deja el borrador intacto', async () => {
    // `approval.ip` es `inet NOT NULL` (Regla de Oro 6: «desde dónde»), y la
    // bandeja de A7 solo sabe leer `x-forwarded-for`. Si el despliegue no la
    // reenvía, el contador recibe un error crudo de PostgreSQL. Lo que A14
    // exige AQUÍ es lo mínimo innegociable: que el fallo no deje el ledger a
    // medias. La usabilidad del mensaje queda registrada como V-11.
    const pendiente = empresas.flatMap((emp) =>
      emp.asientos.map((entryId) => ({ companyId: emp.companyId, entryId })),
    );
    const objetivo = await (async () => {
      for (const c of pendiente) {
        const { rows } = await db.asAdmin((tx) =>
          tx.query<{ estado: string }>(`SELECT estado FROM journal_entry WHERE id = $1`, [c.entryId]),
        );
        if (rows[0]?.estado === 'draft') return c;
      }
      return null;
    })();
    expect(objetivo).not.toBeNull();

    cabeceras.delete('x-forwarded-for');
    try {
      const fd = new FormData();
      fd.append('sel', `${objetivo!.companyId}::${objetivo!.entryId}`);
      await aprobarSeleccionAction(fd);
    } finally {
      cabeceras.set('x-forwarded-for', '203.0.113.44');
    }

    const despues = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ estado: string; aprobaciones: number }>(
        `SELECT je.estado,
                (SELECT count(*) FROM approval a
                  WHERE a.entidad = 'journal_entry' AND a.entidad_id = je.id)::int AS aprobaciones
           FROM journal_entry je WHERE je.id = $1`,
        [objetivo!.entryId],
      );
      return rows[0]!;
    });
    // Sigue en borrador y no quedó ninguna aprobación huérfana.
    expect(despues.estado).toBe('draft');
    expect(Number(despues.aprobaciones)).toBe(0);
    // Y el contador SÍ se entera: la acción no redirige en silencio a «todo bien».
    expect(errorDeRedireccion(ultimaRedireccion())).not.toBeNull();
  }, 240_000);
});

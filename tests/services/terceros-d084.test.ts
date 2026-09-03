/**
 * D-084 · Fase 3 del Módulo de Terceros. Cubre lo que la fase agrega:
 *
 *   TAREA 1 — eliminar solo si nunca tuvo movimientos; si los tuvo, solo
 *             inactivar (nunca DELETE), impuesto por el motor.
 *   TAREA 2 — exportación a Excel del maestro (con historial), aislada por RLS.
 *   TAREA 3 — historial completo de vigencias de un tercero.
 *   TAREA 4 — las comprobaciones de permiso pasan por el servicio central.
 *
 * Convención de `tests/helpers`: aquí no hay ningún valor tributario real.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, esperarErrorPg, type TestDb } from '../helpers/db';
import { crearEscenario, type Escenario } from '../helpers/fixtures';
import { SQLSTATE } from '../../src/db/types';
import {
  crearTercero,
  eliminarTercero,
  fijarActivoTercero,
  listarHistorialActividadesTercero,
  listarTerceros,
  obtenerTercero,
  puedeEditarAtributosFiscales,
  puedeEditarTerceros,
  puedeVerTerceros,
  registrarActividad,
  registrarAtributosFiscales,
  terceroTieneMovimientos,
  TerceroConMovimientosError,
  TerceroNoEncontradoError,
} from '../../src/services/terceros';
import { generarMaestroTerceros } from '../../src/reports/terceros-maestro';

let db: TestDb;
let e: Escenario;

const BANDERAS = {
  esDeclaranteRenta: true,
  esAutorretenedorRenta: false,
  esGranContribuyente: false,
  esRegimenSimple: false,
  esResponsableIva: true,
  esAgenteRetencionRenta: false,
  esAgenteRetencionIva: false,
  esAgenteRetencionIca: false,
  esAutorretenedorIca: false,
} as const;

function futuroIso(dias: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
function pasadoIso(dias: number): string {
  return futuroIso(-dias);
}

beforeAll(async () => {
  db = await createTestDb();
  e = await crearEscenario(db);
});
afterAll(async () => {
  await db?.close();
});

async function crearTerceroPristino(): Promise<string> {
  const nit = `9${Math.floor(Math.random() * 1_000_000_000)}`;
  const { id } = await db.asTenant(
    e.tenantId,
    e.companyId,
    (tx) =>
      crearTercero(tx, {
        tipoDocumento: 'NIT',
        numeroDocumento: nit,
        tipoPersona: 'juridica',
        razonSocial: `Pristino ${nit}`,
        direccion: 'Calle 1 # 2-3',
        municipalityId: e.municipalityId,
      }),
    { rolCodigo: 'admin_tributario' },
  );
  return id;
}

describe('TAREA 1 — eliminar vs inactivar', () => {
  it('un tercero sin movimientos se elimina por completo', async () => {
    const id = await crearTerceroPristino();
    expect(await db.asAdmin((tx) => terceroTieneMovimientos(tx, id))).toBe(false);
    await db.asTenant(e.tenantId, e.companyId, (tx) => eliminarTercero(tx, id), {
      rolCodigo: 'admin_tributario',
    });
    expect(await db.asAdmin((tx) => obtenerTercero(tx, id))).toBeNull();
  });

  it('un tercero con un documento soporte NO se elimina — TerceroConMovimientosError', async () => {
    // e.thirdPartyId ya tiene source_document + atributo fiscal desde 2020.
    expect(await db.asAdmin((tx) => terceroTieneMovimientos(tx, e.thirdPartyId))).toBe(true);
    await expect(
      db.asTenant(e.tenantId, e.companyId, (tx) => eliminarTercero(tx, e.thirdPartyId), {
        rolCodigo: 'admin_tributario',
      }),
    ).rejects.toBeInstanceOf(TerceroConMovimientosError);
    // sigue en la base
    expect(await db.asAdmin((tx) => obtenerTercero(tx, e.thirdPartyId))).not.toBeNull();
  });

  it('A14 — ningún camino borra un tercero con movimientos: DELETE directo contra la base -> TP001', async () => {
    await esperarErrorPg(
      () => db.asAdmin((tx) => tx.query('DELETE FROM third_party WHERE id = $1', [e.thirdPartyId])),
      SQLSTATE.TERCERO_CON_MOVIMIENTOS,
      'un DELETE directo de un tercero con movimientos',
    );
  });

  it('una vigencia fiscal FUTURA no cuenta como movimiento y se limpia al eliminar', async () => {
    const id = await crearTerceroPristino();
    await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) =>
        registrarAtributosFiscales(tx, {
          terceroId: id,
          ...BANDERAS,
          regimenTributario: 'ordinario',
          vigenteDesde: futuroIso(30),
          normaRespaldo: 'Cambio programado, aún no rige',
        }),
      { rolCodigo: 'admin_tributario' },
    );
    expect(await db.asAdmin((tx) => terceroTieneMovimientos(tx, id))).toBe(false);
    await db.asTenant(e.tenantId, e.companyId, (tx) => eliminarTercero(tx, id), {
      rolCodigo: 'admin_tributario',
    });
    expect(await db.asAdmin((tx) => obtenerTercero(tx, id))).toBeNull();
  });

  it('una vigencia fiscal que YA rige convierte al tercero en "con movimientos"', async () => {
    const id = await crearTerceroPristino();
    await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) =>
        registrarAtributosFiscales(tx, {
          terceroId: id,
          ...BANDERAS,
          regimenTributario: 'ordinario',
          vigenteDesde: pasadoIso(10),
          normaRespaldo: 'RUT en firme',
        }),
      { rolCodigo: 'admin_tributario' },
    );
    expect(await db.asAdmin((tx) => terceroTieneMovimientos(tx, id))).toBe(true);
    await expect(
      db.asTenant(e.tenantId, e.companyId, (tx) => eliminarTercero(tx, id), {
        rolCodigo: 'admin_tributario',
      }),
    ).rejects.toBeInstanceOf(TerceroConMovimientosError);
  });

  it('inactivar y reactivar nunca borran; el tercero deja o vuelve a los selectores', async () => {
    const id = await crearTerceroPristino();
    await db.asTenant(e.tenantId, e.companyId, (tx) => fijarActivoTercero(tx, id, false), {
      rolCodigo: 'admin_tributario',
    });
    expect((await db.asAdmin((tx) => obtenerTercero(tx, id)))?.activo).toBe(false);
    const activos = await db.asAdmin((tx) => listarTerceros(tx, { estado: 'activos' }));
    expect(activos.map((t) => t.id)).not.toContain(id);
    const inactivos = await db.asAdmin((tx) => listarTerceros(tx, { estado: 'inactivos' }));
    expect(inactivos.map((t) => t.id)).toContain(id);

    await db.asTenant(e.tenantId, e.companyId, (tx) => fijarActivoTercero(tx, id, true), {
      rolCodigo: 'admin_tributario',
    });
    expect((await db.asAdmin((tx) => obtenerTercero(tx, id)))?.activo).toBe(true);
  });

  it('eliminar un id inexistente -> TerceroNoEncontradoError', async () => {
    await expect(
      db.asTenant(e.tenantId, e.companyId, (tx) => eliminarTercero(tx, crypto.randomUUID()), {
        rolCodigo: 'admin_tributario',
      }),
    ).rejects.toBeInstanceOf(TerceroNoEncontradoError);
  });
});

describe('TAREA 3 — historial completo de actividad de un tercero', () => {
  it('lista todas las ternas municipio×CIIU y sus vigencias, no solo lo vigente hoy', async () => {
    const id = await crearTerceroPristino();
    await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) =>
        registrarActividad(tx, {
          terceroId: id,
          municipalityId: e.municipalityId,
          ciiuActivityId: e.ciiuId,
          esPrincipal: true,
          vigenteDesde: pasadoIso(60),
          normaRespaldo: 'Matrícula v1',
        }),
      { rolCodigo: 'admin_tributario' },
    );
    await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) =>
        registrarActividad(tx, {
          terceroId: id,
          municipalityId: e.municipalityId,
          ciiuActivityId: e.ciiuId,
          esPrincipal: false,
          vigenteDesde: pasadoIso(5),
          normaRespaldo: 'Cambio de actividad principal',
        }),
      { rolCodigo: 'admin_tributario' },
    );
    const historial = await db.asAdmin((tx) => listarHistorialActividadesTercero(tx, id));
    expect(historial).toHaveLength(2);
    expect(historial.filter((h) => h.vigenteHasta === null)).toHaveLength(1);
  });
});

describe('TAREA 4 — permisos por el servicio central', () => {
  it('admin_tributario ve y edita terceros y sus atributos fiscales', async () => {
    const r = await db.asTenant(
      e.tenantId,
      e.companyId,
      async (tx) => ({
        ver: await puedeVerTerceros(tx),
        editar: await puedeEditarTerceros(tx),
        fiscales: await puedeEditarAtributosFiscales(tx),
      }),
      { rolCodigo: 'admin_tributario' },
    );
    expect(r).toEqual({ ver: true, editar: true, fiscales: true });
  });

  it('el auxiliar de causación edita el maestro pero NO los atributos fiscales (140)', async () => {
    const r = await db.asTenant(
      e.tenantId,
      e.companyId,
      async (tx) => ({
        editar: await puedeEditarTerceros(tx),
        fiscales: await puedeEditarAtributosFiscales(tx),
      }),
      { rolCodigo: 'auxiliar_causacion' },
    );
    expect(r).toEqual({ editar: true, fiscales: false });
  });

  it('solo_lectura no puede editar terceros', async () => {
    const editar = await db.asTenant(e.tenantId, e.companyId, (tx) => puedeEditarTerceros(tx), {
      rolCodigo: 'solo_lectura',
    });
    expect(editar).toBe(false);
  });
});

describe('TAREA 2 — exportación a Excel del maestro', () => {
  it('genera un libro con las cuatro hojas', async () => {
    const wb = await db.asTenant(e.tenantId, e.companyId, (tx) => generarMaestroTerceros(tx), {
      rolCodigo: 'contador',
    });
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'Terceros',
      'Atributos fiscales (historial)',
      'Actividad económica (historial)',
      'Papel de trabajo',
    ]);
  });

  it('A14 — RLS: la exportación no incluye ni un tercero de otra empresa', async () => {
    const otra = await crearEscenario(db, { razonSocial: 'Otra firma D-084' });
    const nombreAjeno = `Proveedor secreto ${Math.random().toString(36).slice(2)}`;
    await db.asTenant(
      otra.tenantId,
      otra.companyId,
      (tx) =>
        crearTercero(tx, {
          tipoDocumento: 'NIT',
          numeroDocumento: `98${Math.floor(Math.random() * 1_000_000)}`,
          tipoPersona: 'juridica',
          razonSocial: nombreAjeno,
          direccion: 'x',
          municipalityId: otra.municipalityId,
        }),
      { rolCodigo: 'admin_tributario' },
    );

    const wb = await db.asTenant(e.tenantId, e.companyId, (tx) => generarMaestroTerceros(tx), {
      rolCodigo: 'contador',
    });
    const hoja = wb.getWorksheet('Terceros')!;
    const nombres: string[] = [];
    hoja.eachRow((fila) => nombres.push(String(fila.getCell(5).value ?? '')));
    expect(nombres).not.toContain(nombreAjeno);
  });
});

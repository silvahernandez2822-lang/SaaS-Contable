/**
 * D-089 · TAREA 4 (A8) — uso inverso de una cuenta del PUC y simulador de
 * impacto BLOQUEANTE en la capa de servicio (`src/services/puc.ts`).
 *
 * Aquí no hay ningún valor tributario: es integridad de un maestro de datos.
 * El motor (migración 179) es quien impone PU002..PU005; estas pruebas
 * verifican que el servicio PREDICE lo mismo antes de tocar la base, para que
 * la interfaz no ofrezca una acción que el motor va a negar.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, uuid, type TestDb } from '../helpers/db';
import {
  crearAsientoBorrador,
  crearEscenario,
  publicarAsiento,
  type Escenario,
} from '../helpers/fixtures';
import {
  conceptosQueUsanCuenta,
  conceptosQueUsanCuentas,
  resolverCuentaPorCodigo,
  simularImpactoCambioCuenta,
  usoDeCuenta,
  usoDeCuentas,
  type CambioPropuestoCuenta,
  type FilaCuenta,
} from '../../src/services/puc';

let db: TestDb;
let e: Escenario;

const ROL = { rolCodigo: 'admin_tributario' } as const;

/**
 * A14 (compuerta de D-089): el código NO se sortea. La versión original usaba
 * `5195${Math.random()*90+10}`, un espacio de 90 valores para la decena larga
 * de cuentas que este archivo crea: por la paradoja del cumpleaños chocaba
 * (`account_codigo_uq`) en aproximadamente cuatro de cada diez ejecuciones, y
 * de hecho tumbó la suite completa en la compuerta. Una prueba de integridad
 * que falla al azar se acaba silenciando, que es peor que no tenerla.
 */
let secuenciaCuenta = 0;

async function cuentaNueva(
  campos: Partial<{ codigo: string; naturaleza: 'debito' | 'credito'; permiteMovimiento: boolean; activo: boolean }> = {},
): Promise<{ id: string; codigo: string }> {
  const id = uuid();
  secuenciaCuenta += 1;
  const codigo = campos.codigo ?? `5195${String(secuenciaCuenta + 10).padStart(2, '0')}`;
  await db.asAdmin((tx) =>
    tx.query(
      `INSERT INTO account (id, tenant_id, company_id, codigo, nombre, nivel, naturaleza, permite_movimiento, activo)
       VALUES ($1,$2,$3,$4,$5,4,$6,$7,$8)`,
      [
        id,
        e.tenantId,
        e.companyId,
        codigo,
        `Cuenta ${codigo}`,
        campos.naturaleza ?? 'debito',
        campos.permiteMovimiento ?? true,
        campos.activo ?? true,
      ],
    ),
  );
  return { id, codigo };
}

async function darMovimiento(accountId: string, monto = 300_00): Promise<void> {
  await db.asTenant(e.tenantId, e.companyId, async (tx) => {
    const id = await crearAsientoBorrador(tx, e, [
      { accountId, side: 'debito', monto },
      { accountId: e.cuentas.proveedores, side: 'credito', monto },
    ]);
    await publicarAsiento(tx, id, e.userId);
  });
}

async function conceptoQueUsa(accountId: string, rol: 'gasto' | 'iva' | 'contrapartida' = 'gasto'): Promise<string> {
  const id = uuid();
  const col =
    rol === 'gasto' ? 'cuenta_gasto_id' : rol === 'iva' ? 'cuenta_iva_descontable_id' : 'cuenta_contrapartida_id';
  await db.asAdmin((tx) =>
    tx.query(
      `INSERT INTO concepto_causacion (id, tenant_id, company_id, codigo, nombre, ${col}, aplica_retefuente, activo)
       VALUES ($1,$2,$3,$4,'Concepto D-089 servicio',$5,false,true)`,
      [id, e.tenantId, e.companyId, `D089S-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, accountId],
    ),
  );
  return id;
}

function fila(actual: FilaCuenta, cambios: Partial<CambioPropuestoCuenta>): CambioPropuestoCuenta {
  return {
    codigo: cambios.codigo ?? actual.codigo,
    naturaleza: cambios.naturaleza ?? actual.naturaleza,
    permiteMovimiento: cambios.permiteMovimiento ?? actual.permiteMovimiento,
    activo: cambios.activo ?? actual.activo,
  };
}

beforeAll(async () => {
  db = await createTestDb();
  e = await crearEscenario(db);
}, 180_000);

afterAll(async () => {
  await db?.close();
});

describe('D-089 · uso inverso de una cuenta', () => {
  it('conceptosQueUsanCuenta lista el concepto y en qué rol', async () => {
    const cuenta = await cuentaNueva();
    await conceptoQueUsa(cuenta.id, 'gasto');

    const lista = await db.asTenant(e.tenantId, e.companyId, (tx) => conceptosQueUsanCuenta(tx, cuenta.id), ROL);
    expect(lista).toHaveLength(1);
    expect(lista[0]!.roles).toEqual(['gasto']);
    expect(lista[0]!.activo).toBe(true);
  });

  it('usoDeCuenta cuenta las partidas y los conceptos activos con el criterio del motor', async () => {
    const cuenta = await cuentaNueva();
    await darMovimiento(cuenta.id, 111_00);
    await conceptoQueUsa(cuenta.id, 'contrapartida');

    const uso = await db.asTenant(e.tenantId, e.companyId, (tx) => usoDeCuenta(tx, cuenta.id), ROL);
    expect(uso.partidasLedger).toBe(1);
    expect(uso.tieneMovimientos).toBe(true);
    expect(uso.conceptosActivos).toBe(1);
    expect(uso.enUso).toBe(true);
  });

  it('usoDeCuentas y conceptosQueUsanCuentas resuelven un lote en un round-trip', async () => {
    const a = await cuentaNueva();
    const b = await cuentaNueva();
    await darMovimiento(a.id, 200_00);
    await conceptoQueUsa(b.id, 'iva');

    const [uso, conceptos] = await db.asTenant(
      e.tenantId,
      e.companyId,
      async (tx) => [await usoDeCuentas(tx, [a.id, b.id]), await conceptosQueUsanCuentas(tx, [a.id, b.id])] as const,
      ROL,
    );
    expect(uso.get(a.id)?.tieneMovimientos).toBe(true);
    expect(uso.get(b.id)?.conceptosActivos).toBe(1);
    expect(conceptos.get(b.id)?.[0]?.roles).toEqual(['iva_descontable']);
    expect(conceptos.has(a.id)).toBe(false);
  });
});

describe('D-089 · simulador de impacto bloqueante', () => {
  it('cambiar la naturaleza de una cuenta con movimientos: bloqueado por el motor (PU002)', async () => {
    const cuenta = await cuentaNueva({ naturaleza: 'debito' });
    await darMovimiento(cuenta.id);

    const impacto = await db.asTenant(
      e.tenantId,
      e.companyId,
      async (tx) => {
        const actual = (await resolverCuentaPorCodigo(tx, cuenta.codigo))!;
        return simularImpactoCambioCuenta(tx, actual, fila(actual, { naturaleza: 'credito' }));
      },
      ROL,
    );
    expect(impacto.bloqueadoPorMotor).toBe(true);
    expect(impacto.rechazos.map((r) => r.codigo)).toContain('PU002');
    expect(impacto.requiereConfirmacion).toBe(false);
  });

  it('renumerar y desimputar una cuenta con movimientos: PU004 y PU003', async () => {
    const cuenta = await cuentaNueva();
    await darMovimiento(cuenta.id);

    const impacto = await db.asTenant(
      e.tenantId,
      e.companyId,
      async (tx) => {
        const actual = (await resolverCuentaPorCodigo(tx, cuenta.codigo))!;
        return simularImpactoCambioCuenta(tx, actual, fila(actual, { codigo: '519998', permiteMovimiento: false }));
      },
      ROL,
    );
    const codigos = impacto.rechazos.map((r) => r.codigo);
    expect(codigos).toContain('PU004');
    expect(codigos).toContain('PU003');
    expect(impacto.bloqueadoPorMotor).toBe(true);
  });

  it('inactivar una cuenta con un concepto activo: PU005', async () => {
    const cuenta = await cuentaNueva();
    await conceptoQueUsa(cuenta.id, 'gasto');

    const impacto = await db.asTenant(
      e.tenantId,
      e.companyId,
      async (tx) => {
        const actual = (await resolverCuentaPorCodigo(tx, cuenta.codigo))!;
        return simularImpactoCambioCuenta(tx, actual, fila(actual, { activo: false }));
      },
      ROL,
    );
    expect(impacto.rechazos.map((r) => r.codigo)).toContain('PU005');
    expect(impacto.bloqueadoPorMotor).toBe(true);
  });

  it('inactivar una cuenta con movimientos pero SIN conceptos: permitido, pero exige confirmación', async () => {
    const cuenta = await cuentaNueva();
    await darMovimiento(cuenta.id);

    const impacto = await db.asTenant(
      e.tenantId,
      e.companyId,
      async (tx) => {
        const actual = (await resolverCuentaPorCodigo(tx, cuenta.codigo))!;
        return simularImpactoCambioCuenta(tx, actual, fila(actual, { activo: false }));
      },
      ROL,
    );
    expect(impacto.bloqueadoPorMotor).toBe(false);
    expect(impacto.requiereConfirmacion).toBe(true);
    expect(impacto.advertencias.length).toBeGreaterThan(0);
  });

  it('un cambio inocuo (mismo valor) no dispara nada', async () => {
    const cuenta = await cuentaNueva();
    await darMovimiento(cuenta.id);

    const impacto = await db.asTenant(
      e.tenantId,
      e.companyId,
      async (tx) => {
        const actual = (await resolverCuentaPorCodigo(tx, cuenta.codigo))!;
        return simularImpactoCambioCuenta(tx, actual, fila(actual, {}));
      },
      ROL,
    );
    expect(impacto.bloqueadoPorMotor).toBe(false);
    expect(impacto.requiereConfirmacion).toBe(false);
    expect(impacto.rechazos).toHaveLength(0);
    expect(impacto.advertencias).toHaveLength(0);
  });
});

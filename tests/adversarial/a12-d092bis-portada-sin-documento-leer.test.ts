/**
 * A12 · D-092-bis — el «administrador acotado» no puede quedar fuera del producto.
 *
 * EL DEFECTO (reproducido en navegador real después de D-092): se crea por la
 * interfaz un rol propio de firma con UN SOLO permiso, `usuario.administrar`
 * —exactamente el caso que `/admin/roles` describe como legítimo y que D-092
 * hizo creable—, se le asigna a un usuario, y ese usuario NO PUEDE ABRIR
 * NINGUNA PANTALLA: el layout raíz y la portada llaman a
 * `app.empresas_accesibles()`, que exige `documento.leer` en el MOTOR, y la
 * excepción `SE002` sube sin capturar hasta reventar el render. Ni siquiera
 * `/admin/usuarios`, que es la única pantalla a la que ese rol da derecho.
 *
 * QUÉ SE PRUEBA AQUÍ, Y CÓMO:
 *
 *  · Que el MOTOR SIGUE IGUAL DE ESTRICTO. Nada de esto se arregló relajando un
 *    permiso: `app.empresas_accesibles()` y `listarPendientesDeAprobacion`
 *    siguen rechazando a este usuario. Si alguien "arregla" el defecto quitando
 *    esa exigencia, estas dos pruebas se ponen rojas.
 *  · Que la vía que usa hoy la aplicación (`app/lib/empresas.ts`) NO lanza y
 *    devuelve una lista utilizable, con su origen declarado.
 *  · Que la puerta nueva (`listarEmpresasDeLaFirma`) exige `usuario.administrar`
 *    y NO cruza de firma (Regla de Oro 7).
 *  · Que el camino normal (un rol con `documento.leer`) queda intacto.
 *
 * Todo contra la base real del harness (`asTenant`, RLS activa, sesión emitida),
 * nunca contra un mock: un `throw` de TypeScript no demuestra nada (D-003).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createTestDb, esperarErrorPg } from '../helpers/db.js';
import { crearEscenario, crearUsuarioConCredencial } from '../helpers/fixtures.js';
import { SQLSTATE } from '../../src/db/types.js';
import { ROLES } from '../../src/auth/permisos.js';
import { crearRol, listarEmpresasDeLaFirma, listarUsuarios } from '../../src/services/administracion.js';
import { listarEmpresasAccesibles } from '../../src/services/bandeja.js';
import { listarPendientesDeAprobacion } from '../../src/services/consulta.js';
import { detectarAlertasParametrizacion } from '../../src/services/parametrizacion.js';
import { empresasVisiblesParaLaSesion, sesionTienePermiso } from '../../app/lib/empresas.js';
import type { SqlClient } from '../../src/db/types.js';

const db = await createTestDb();

let e: Awaited<ReturnType<typeof crearEscenario>>;
let otra: Awaited<ReturnType<typeof crearEscenario>>;

/** El rol del repro: UN solo permiso, `usuario.administrar`. */
let rolAcotadoId: string;
let adminAcotado: string;
/** Un rol sin `documento.leer` NI `usuario.administrar`: el otro degradado. */
let rolMudoId: string;
let usuarioMudo: string;
/** Contador (rol de sistema): sí tiene `documento.leer`. El camino normal. */
let contador: string;

/** Ejecuta `fn` como el usuario/rol dados. `companyId: ''` = sesión "de firma"
 *  (sin empresa), que es EXACTAMENTE la que usan el layout raíz y la portada. */
async function como<T>(
  userId: string,
  rolId: string,
  companyId: string,
  fn: (tx: SqlClient) => Promise<T>,
): Promise<T> {
  return db.asTenant(e.tenantId, companyId, fn, { userId, rolId, sesionNueva: true });
}

beforeAll(async () => {
  e = await crearEscenario(db);
  otra = await crearEscenario(db);

  const acotado = await db.asTenant(e.tenantId, e.companyId, (tx) =>
    crearRol(tx, {
      codigo: 'admin_acotado_qa',
      nombre: 'Administrador acotado (QA)',
      descripcion: 'Solo administra usuarios. El caso que /admin/roles propone como legítimo.',
      permisos: ['usuario.administrar'],
    }),
  );
  rolAcotadoId = acotado.id;
  adminAcotado = (
    await crearUsuarioConCredencial(db, e.tenantId, { companyId: e.companyId, roleId: rolAcotadoId })
  ).userId;

  const mudo = await db.asTenant(e.tenantId, e.companyId, (tx) =>
    crearRol(tx, {
      codigo: 'solo_parametros_qa',
      nombre: 'Solo parámetros (QA)',
      descripcion: 'Ni documento.leer ni usuario.administrar.',
      permisos: ['parametro.leer'],
    }),
  );
  rolMudoId = mudo.id;
  usuarioMudo = (
    await crearUsuarioConCredencial(db, e.tenantId, { companyId: e.companyId, roleId: rolMudoId })
  ).userId;

  contador = (
    await crearUsuarioConCredencial(db, e.tenantId, { companyId: e.companyId, roleId: ROLES.CONTADOR })
  ).userId;
});

describe('D-092-bis · el motor NO se relajó', () => {
  it('el rol acotado sigue SIN documento.leer, con y sin empresa en contexto', async () => {
    expect(await como(adminAcotado, rolAcotadoId, e.companyId, (tx) => sesionTienePermiso(tx, 'documento.leer'))).toBe(
      false,
    );
    expect(await como(adminAcotado, rolAcotadoId, '', (tx) => sesionTienePermiso(tx, 'documento.leer'))).toBe(false);
    expect(await como(adminAcotado, rolAcotadoId, '', (tx) => sesionTienePermiso(tx, 'usuario.administrar'))).toBe(
      true,
    );
  });

  /** ESTA es la causa raíz, tal cual, y se deja clavada: si un día deja de
   *  fallar, es que alguien "arregló" la portada quitándole el permiso a la
   *  función del motor — que es justo lo que no se debe hacer. */
  it('app.empresas_accesibles() SIGUE exigiendo documento.leer (SE002)', async () => {
    const error = await como(adminAcotado, rolAcotadoId, '', (tx) =>
      esperarErrorPg(
        () => listarEmpresasAccesibles(tx),
        SQLSTATE.PERMISO_INSUFICIENTE,
        'listar empresas accesibles sin documento.leer',
      ),
    );
    expect(error.message).toContain('documento.leer');
  });

  it('leer documentos sigue prohibido para el rol acotado', async () => {
    await expect(
      como(adminAcotado, rolAcotadoId, e.companyId, (tx) => listarPendientesDeAprobacion(tx, { limite: 5 })),
    ).rejects.toThrow(/documento\.leer/);
  });
});

describe('D-092-bis · la sesión del administrador acotado ya no revienta', () => {
  /** El paso exacto que reventaba: la sesión de firma del layout raíz, la que
   *  corre en TODA ruta antes de pintar nada. */
  it('empresasVisiblesParaLaSesion NO lanza en la sesión de firma y da lista utilizable', async () => {
    const visibles = await como(adminAcotado, rolAcotadoId, '', (tx) => empresasVisiblesParaLaSesion(tx));
    expect(visibles.origen).toBe('firma');
    expect(visibles.puedeLeerDocumentos).toBe(false);
    expect(visibles.empresas.length).toBeGreaterThan(0);
    expect(visibles.empresas.map((x) => x.companyId)).toContain(e.companyId);
  });

  it('tampoco lanza con empresa en contexto (la portada tras elegir empresa)', async () => {
    const visibles = await como(adminAcotado, rolAcotadoId, e.companyId, (tx) => empresasVisiblesParaLaSesion(tx));
    expect(visibles.origen).toBe('firma');
    expect(visibles.empresas.length).toBeGreaterThan(0);
  });

  it('y la pantalla que SÍ le corresponde (/admin/usuarios) tiene todos sus datos', async () => {
    const datos = await como(adminAcotado, rolAcotadoId, e.companyId, async (tx) => ({
      usuarios: await listarUsuarios(tx),
      empresas: (await empresasVisiblesParaLaSesion(tx)).empresas,
    }));
    expect(datos.usuarios.length).toBeGreaterThan(0);
    // Sin empresas en el desplegable no podría asignar acceso a nadie: el
    // «administrador acotado» sería un cargo decorativo.
    expect(datos.empresas.length).toBeGreaterThan(0);
  });

  it('un rol SIN documento.leer y SIN usuario.administrar degrada a vacío, sin lanzar', async () => {
    const visibles = await como(usuarioMudo, rolMudoId, '', (tx) => empresasVisiblesParaLaSesion(tx));
    expect(visibles.origen).toBe('sin_permiso');
    expect(visibles.empresas).toEqual([]);
    expect(visibles.puedeLeerDocumentos).toBe(false);
  });

  /** Punto 2 del encargo, VERIFICADO y no supuesto: la otra llamada de la
   *  portada (`detectarAlertasParametrizacion`) no exige ningún permiso — solo
   *  cuenta filas de catálogos compartidos —, así que no hace falta envolverla. */
  it('detectarAlertasParametrizacion NO exige permiso: responde a los tres roles', async () => {
    for (const [u, r] of [
      [adminAcotado, rolAcotadoId],
      [usuarioMudo, rolMudoId],
      [contador, ROLES.CONTADOR],
    ] as const) {
      const alertas = await como(u, r, '', (tx) => detectarAlertasParametrizacion(tx));
      expect(Array.isArray(alertas)).toBe(true);
    }
  });
});

describe('D-092-bis · la puerta nueva tiene su propio candado', () => {
  it('listarEmpresasDeLaFirma exige usuario.administrar', async () => {
    await expect(
      como(usuarioMudo, rolMudoId, e.companyId, (tx) => listarEmpresasDeLaFirma(tx)),
    ).rejects.toThrow(/usuario\.administrar/);
  });

  it('NO cruza de firma: la empresa de la otra firma no aparece (Regla de Oro 7)', async () => {
    const empresas = await como(adminAcotado, rolAcotadoId, '', (tx) => listarEmpresasDeLaFirma(tx));
    expect(empresas.map((x) => x.companyId)).toContain(e.companyId);
    expect(empresas.map((x) => x.companyId)).not.toContain(otra.companyId);
    expect(empresas.map((x) => x.nit)).not.toContain(otra.companyId);
  });
});

describe('D-092-bis · el camino normal queda intacto', () => {
  it('el contador sigue resolviendo por app.empresas_accesibles(), con su rol real', async () => {
    const visibles = await como(contador, ROLES.CONTADOR, '', (tx) => empresasVisiblesParaLaSesion(tx));
    expect(visibles.origen).toBe('accesibles');
    expect(visibles.puedeLeerDocumentos).toBe(true);
    expect(visibles.empresas.length).toBeGreaterThan(0);
    // El rol POR EMPRESA, que es lo que enseña el selector del shell: solo la
    // vía normal puede resolverlo.
    expect(visibles.empresas.every((x) => x.rolCodigo !== '')).toBe(true);
  });

  it('una excepción individual que QUITA documento.leer también degrada, no revienta', async () => {
    const { decidirPermisoIndividual } = await import('../../src/services/administracion.js');
    await db.asTenant(e.tenantId, e.companyId, (tx) =>
      decidirPermisoIndividual(tx, {
        userId: contador,
        companyId: e.companyId,
        permisoCodigo: 'documento.leer',
        efecto: 'revocado',
        motivo: 'Investigación interna: se le suspende la lectura de documentos mientras dure.',
      }),
    );
    // Con empresa en contexto la excepción muerde y la portada NO puede leer
    // documentos... y aun así carga.
    const conEmpresa = await como(contador, ROLES.CONTADOR, e.companyId, (tx) => empresasVisiblesParaLaSesion(tx));
    expect(conEmpresa.puedeLeerDocumentos).toBe(false);
    expect(conEmpresa.origen).toBe('sin_permiso');

    // Se devuelve, para no dejar el escenario roto.
    await db.asTenant(e.tenantId, e.companyId, (tx) =>
      decidirPermisoIndividual(tx, {
        userId: contador,
        companyId: e.companyId,
        permisoCodigo: 'documento.leer',
        efecto: 'otorgado',
        motivo: 'Terminada la investigación interna, se le devuelve la lectura de documentos.',
      }),
    );
    const despues = await como(contador, ROLES.CONTADOR, e.companyId, (tx) => empresasVisiblesParaLaSesion(tx));
    expect(despues.puedeLeerDocumentos).toBe(true);
  });
});

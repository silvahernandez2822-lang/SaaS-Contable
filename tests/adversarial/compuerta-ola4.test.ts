/**
 * A16 — Ola 4: administración de usuarios, roles blindados y aprobación
 * jerárquica, atacados en vez de leídos.
 *
 * Lo que se persigue aquí no es que las funciones «funcionen»: es que las tres
 * promesas de la Tarea 7 sean ciertas CONTRA EL MOTOR y no contra un `if` de
 * la interfaz.
 *
 *  1. El rol todopoderoso lo es porque lo dice la base, no porque tenga filas
 *     en `role_permission` (D-066). Se comprueba de la única forma que vale:
 *     dándole un permiso que NO tiene otorgado y viendo que igual lo ejerce, y
 *     tratando de degradarlo por todos los caminos disponibles —incluido el de
 *     superusuario— para verlos rechazados con RL001.
 *
 *  2. Un rol propio de la firma concede EXACTAMENTE los permisos que se le
 *     marcaron, ni uno más, y deja de conceder nada al inactivarse (D-067).
 *
 *  3. «El junior corrige, el revisor aprueba» es un ESTADO del recurso
 *     (D-068): la corrección de quien no puede aprobar NO la usa el motor
 *     hasta que alguien con el permiso la apruebe.
 *
 * Y, transversal a todo: nada de esto abre una puerta entre firmas.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, esperarErrorPg, type TestDb } from '../helpers/db';
import { crearEscenario, type Escenario } from '../helpers/fixtures';
import {
  asignarRol,
  cambiarEstadoUsuario,
  cambiarMiPassword,
  catalogoDePermisos,
  crearRol,
  crearUsuario,
  editarRol,
  eliminarRol,
  estadoDeMiCredencial,
  fijarPasswordDeUsuario,
  fijarPermisosDeRol,
  listarCorreccionesPendientes,
  listarRoles,
  listarUsuarios,
  permisosEfectivosDe,
  revisarCorreccion,
  AdministracionInvalidaError,
  RolBlindadoError,
} from '../../src/services/administracion';
import { guardarCorreccionAiu, obtenerCorreccionesVigentes } from '../../src/services/bandeja';
import { ROLES } from '../../src/auth/permisos';
import { importarTabla } from '../../src/services/carga-masiva/importar';

let db: TestDb;
let e: Escenario;

beforeAll(async () => {
  db = await createTestDb();
  e = await crearEscenario(db);
}, 180_000);

afterAll(async () => {
  await db?.close();
});

// =============================================================================
// 1. EL ROL TODOPODEROSO (D-066)
// =============================================================================

describe('A16 · el rol todopoderoso está blindado en el motor, no en la interfaz', () => {
  it('admin_firma es el rol todopoderoso, y es el único', async () => {
    const todopoderosos = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ codigo: string }>(
        'SELECT codigo FROM role WHERE es_todopoderoso ORDER BY codigo',
      );
      return rows.map((r) => r.codigo);
    });
    expect(todopoderosos).toEqual(['admin_firma']);
  });

  it('concede un permiso que NO tiene otorgado: su poder no depende de role_permission', async () => {
    // Un permiso nuevo del catálogo, sin ninguna fila en `role_permission`.
    // Es la prueba directa del corto­circuito de `app.tiene_permiso`: si el
    // blindaje fuera solo «tiene todas las filas», esto daría false.
    await db.asAdmin(async (tx) => {
      await tx.query(
        `INSERT INTO permission (codigo, nombre, descripcion, modulo, accion_tipo)
         VALUES ('canario.ola4', 'Canario de la Ola 4',
                 'Permiso sin ninguna fila en role_permission, para comprobar el blindaje del rol todopoderoso',
                 'administracion', 'administrar')
         ON CONFLICT DO NOTHING`,
      );
    });

    const otorgado = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: string }>(
        "SELECT count(*) AS n FROM role_permission WHERE permission_codigo = 'canario.ola4'",
      );
      return Number(rows[0]!.n);
    });
    expect(otorgado).toBe(0);

    const loTiene = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const { rows } = await tx.query<{ tiene: boolean }>(
        "SELECT app.tiene_permiso('canario.ola4') AS tiene",
      );
      return rows[0]!.tiene;
    });
    expect(loTiene).toBe(true);

    // Un rol que NO es todopoderoso no lo tiene, así que la prueba no es un
    // «true» de un predicado roto.
    const contadorLoTiene = await db.asTenant(
      e.tenantId,
      e.companyId,
      async (tx) => {
        const { rows } = await tx.query<{ tiene: boolean }>(
          "SELECT app.tiene_permiso('canario.ola4') AS tiene",
        );
        return rows[0]!.tiene;
      },
      { rolCodigo: 'contador', sesionNueva: true },
    );
    expect(contadorLoTiene).toBe(false);
  });

  it('ni siquiera el superusuario le puede borrar un permiso: el trigger no mira quién es', async () => {
    await esperarErrorPg(
      () =>
        db.asAdmin((tx) =>
          tx.query("DELETE FROM role_permission WHERE role_id = $1 AND permission_codigo = 'usuario.administrar'", [
            ROLES.ADMIN_FIRMA,
          ]),
        ),
      'RL001',
      'borrarle un permiso al rol todopoderoso',
    );
  });

  it('no se puede inactivar, no se puede degradar y no se puede borrar', async () => {
    await esperarErrorPg(
      () => db.asAdmin((tx) => tx.query('UPDATE role SET activo = false WHERE id = $1', [ROLES.ADMIN_FIRMA])),
      'RL001',
      'inactivar el rol todopoderoso',
    );
    await esperarErrorPg(
      () =>
        db.asAdmin((tx) => tx.query('UPDATE role SET es_todopoderoso = false WHERE id = $1', [ROLES.ADMIN_FIRMA])),
      'RL001',
      'degradar el rol todopoderoso',
    );
    await esperarErrorPg(
      () => db.asAdmin((tx) => tx.query('DELETE FROM role WHERE id = $1', [ROLES.ADMIN_FIRMA])),
      'RL001',
      'borrar el rol todopoderoso',
    );
  });

  it('una firma NO puede fabricarse un rol todopoderoso desde la aplicación', async () => {
    await esperarErrorPg(
      () =>
        db.asTenant(e.tenantId, e.companyId, (tx) =>
          tx.query(
            `INSERT INTO role (tenant_id, codigo, nombre, descripcion, es_todopoderoso)
             VALUES ($1, 'dios', 'Dios', 'Todo', true)`,
            [e.tenantId],
          ),
        ),
      'RL001',
      'crear un rol todopoderoso desde una sesión de aplicación',
    );
  });

  it('el servicio se niega antes, con un mensaje que explica qué hacer en su lugar', async () => {
    await expect(
      db.asTenant(e.tenantId, e.companyId, (tx) => fijarPermisosDeRol(tx, ROLES.ADMIN_FIRMA, ['reporte.leer'])),
    ).rejects.toBeInstanceOf(RolBlindadoError);

    await expect(
      db.asTenant(e.tenantId, e.companyId, (tx) => eliminarRol(tx, ROLES.ADMIN_FIRMA)),
    ).rejects.toBeInstanceOf(RolBlindadoError);
  });

  it('los cinco roles del sistema tampoco se editan desde una firma: son de todas', async () => {
    await expect(
      db.asTenant(e.tenantId, e.companyId, (tx) => fijarPermisosDeRol(tx, ROLES.CONTADOR, ['reporte.leer'])),
    ).rejects.toBeInstanceOf(RolBlindadoError);
  });
});

// =============================================================================
// 2. ROLES PROPIOS DE LA FIRMA (D-067)
// =============================================================================

describe('A16 · una firma se crea sus propios roles y le conceden exactamente lo marcado', () => {
  it('la matriz de permisos sale del catálogo real, agrupada por módulo y acción', async () => {
    const catalogo = await db.asTenant(e.tenantId, e.companyId, (tx) => catalogoDePermisos(tx));
    const documentos = catalogo.find((m) => m.modulo === 'documentos');
    expect(documentos).toBeDefined();
    expect(documentos!.porAccion.ver.map((p) => p.codigo)).toContain('documento.leer');
    expect(documentos!.porAccion.aprobar.map((p) => p.codigo)).toContain('documento.aprobar_correccion');
  });

  it('un rol nuevo concede lo marcado y NADA más', async () => {
    const rolId = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const { id } = await crearRol(tx, {
        codigo: 'junior_prueba',
        nombre: 'Junior de causación',
        descripcion: 'Prepara y corrige, no aprueba.',
        permisos: ['documento.leer', 'documento.reprocesar', 'asiento.leer'],
      });
      return id;
    });

    const usuarioJunior = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const { userId } = await crearUsuario(tx, {
        email: 'junior.ola4@ejemplo.co',
        nombreCompleto: 'Junior de prueba',
      });
      await asignarRol(tx, { userId, companyId: e.companyId, roleId: rolId });
      return userId;
    });

    const efectivos = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      permisosEfectivosDe(tx, usuarioJunior),
    );
    expect(efectivos).toHaveLength(1);
    expect(efectivos[0]!.esTodopoderoso).toBe(false);
    expect(efectivos[0]!.permisos.sort()).toEqual(['asiento.leer', 'documento.leer', 'documento.reprocesar']);

    // Y lo que NO se marcó, el motor lo niega — no la interfaz.
    const puedeAprobar = await db.asTenant(
      e.tenantId,
      e.companyId,
      async (tx) => {
        const { rows } = await tx.query<{ tiene: boolean }>(
          "SELECT app.tiene_permiso('documento.aprobar_correccion') AS tiene",
        );
        return rows[0]!.tiene;
      },
      { userId: usuarioJunior, rolId, sesionNueva: true },
    );
    expect(puedeAprobar).toBe(false);
  });

  it('un rol inactivo deja de conceder todo lo que tenía otorgado', async () => {
    const rolId = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const { id } = await crearRol(tx, {
        codigo: 'temporal_prueba',
        nombre: 'Temporal',
        descripcion: 'Se va a inactivar en la prueba siguiente.',
        permisos: ['reporte.leer'],
      });
      return id;
    });
    const userId = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const { userId } = await crearUsuario(tx, {
        email: 'temporal.ola4@ejemplo.co',
        nombreCompleto: 'Usuario temporal',
      });
      await asignarRol(tx, { userId, companyId: e.companyId, roleId: rolId });
      return userId;
    });

    const antes = await db.asTenant(
      e.tenantId,
      e.companyId,
      async (tx) => {
        const { rows } = await tx.query<{ t: boolean }>("SELECT app.tiene_permiso('reporte.leer') AS t");
        return rows[0]!.t;
      },
      { userId, rolId, sesionNueva: true },
    );
    expect(antes).toBe(true);

    await db.asTenant(e.tenantId, e.companyId, (tx) =>
      editarRol(tx, rolId, {
        nombre: 'Temporal',
        descripcion: 'Inactivado.',
        activo: false,
        permisos: ['reporte.leer'],
      }),
    );

    const despues = await db.asTenant(
      e.tenantId,
      e.companyId,
      async (tx) => {
        const { rows } = await tx.query<{ t: boolean }>("SELECT app.tiene_permiso('reporte.leer') AS t");
        return rows[0]!.t;
      },
      { userId, rolId, sesionNueva: true },
    );
    expect(despues).toBe(false);
  });

  it('un rol que alguien tiene otorgado NO se borra: se inactiva y se dice por qué', async () => {
    const rolId = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const roles = await listarRoles(tx);
      return roles.find((r) => r.codigo === 'junior_prueba')!.id;
    });
    const resultado = await db.asTenant(e.tenantId, e.companyId, (tx) => eliminarRol(tx, rolId));
    expect(resultado.borrado).toBe(false);
    expect(resultado.usos).toBeGreaterThan(0);
  });

  it('no se pueden inventar permisos que no estén en el catálogo del producto', async () => {
    const rolId = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const { id } = await crearRol(tx, {
        codigo: 'inventor_prueba',
        nombre: 'Inventor',
        descripcion: 'Intenta darse permisos que no existen.',
        permisos: ['reporte.leer'],
      });
      return id;
    });
    await expect(
      db.asTenant(e.tenantId, e.companyId, (tx) =>
        fijarPermisosDeRol(tx, rolId, ['reporte.leer', 'todo.absoluto']),
      ),
    ).rejects.toBeInstanceOf(AdministracionInvalidaError);
  });
});

// =============================================================================
// 3. USUARIOS: SE INACTIVAN, NO SE BORRAN (D-069)
// =============================================================================

describe('A16 · administración de usuarios', () => {
  it('un usuario nuevo nace obligado a cambiar la contraseña que le fijaron', async () => {
    const { userId, passwordGenerada } = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      crearUsuario(tx, { email: 'nuevo.ola4@ejemplo.co', nombreCompleto: 'Usuario nuevo' }),
    );
    expect(passwordGenerada).toBeTruthy();

    const usuarios = await db.asTenant(e.tenantId, e.companyId, (tx) => listarUsuarios(tx));
    const nuevo = usuarios.find((u) => u.id === userId)!;
    expect(nuevo.estado).toBe('activo');
    expect(nuevo.debeCambiarPassword).toBe(true);
    expect(nuevo.accesos).toEqual([]); // sin acceso a ninguna empresa todavía
  });

  it('inactivar a alguien le revoca las sesiones abiertas en la misma transacción', async () => {
    const userId = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const { userId } = await crearUsuario(tx, {
        email: 'aecharfuera.ola4@ejemplo.co',
        nombreCompleto: 'Se va de la firma',
        companyId: e.companyId,
        roleId: ROLES.SOLO_LECTURA,
      });
      return userId;
    });

    await db.emitirSesion(e.tenantId, e.companyId, { userId, rolId: ROLES.SOLO_LECTURA, sesionNueva: true });
    const vivasAntes = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: string }>(
        'SELECT count(*) AS n FROM user_session WHERE user_id = $1 AND revocada_en IS NULL',
        [userId],
      );
      return Number(rows[0]!.n);
    });
    expect(vivasAntes).toBeGreaterThan(0);

    await db.asTenant(e.tenantId, e.companyId, (tx) => cambiarEstadoUsuario(tx, userId, 'inactivo'));

    const vivasDespues = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: string }>(
        'SELECT count(*) AS n FROM user_session WHERE user_id = $1 AND revocada_en IS NULL',
        [userId],
      );
      return Number(rows[0]!.n);
    });
    expect(vivasDespues).toBe(0);

    // Y sigue existiendo: la auditoría tiene que poder nombrarlo dentro de tres años.
    const sigue = await db.asTenant(e.tenantId, e.companyId, (tx) => listarUsuarios(tx));
    expect(sigue.find((u) => u.id === userId)!.estado).toBe('inactivo');
  });

  it('nadie se puede inactivar a sí mismo: la firma se quedaría sin quien reactive', async () => {
    const { userId } = await db.emitirSesion(e.tenantId, e.companyId, {});
    await expect(
      db.asTenant(e.tenantId, e.companyId, (tx) => cambiarEstadoUsuario(tx, userId, 'inactivo')),
    ).rejects.toBeInstanceOf(AdministracionInvalidaError);
  });

  it('fijar la contraseña de otro le obliga a cambiarla y le cierra las sesiones', async () => {
    const userId = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const { userId } = await crearUsuario(tx, {
        email: 'rotacion.ola4@ejemplo.co',
        nombreCompleto: 'Le rotan la clave',
        companyId: e.companyId,
        roleId: ROLES.SOLO_LECTURA,
      });
      return userId;
    });

    const { passwordGenerada } = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      fijarPasswordDeUsuario(tx, userId),
    );
    expect(passwordGenerada).toBeTruthy();

    const usuarios = await db.asTenant(e.tenantId, e.companyId, (tx) => listarUsuarios(tx));
    expect(usuarios.find((u) => u.id === userId)!.debeCambiarPassword).toBe(true);

    // El propio usuario la cambia y la bandera se apaga: es la otra mitad de
    // D-069. Sin esto, el administrador sería suplantador permanente.
    await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) => cambiarMiPassword(tx, passwordGenerada!, 'una-clave-larga-y-nueva-2026'),
      { userId, rolId: ROLES.SOLO_LECTURA, sesionNueva: true },
    );

    const credencial = await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) => estadoDeMiCredencial(tx),
      { userId, rolId: ROLES.SOLO_LECTURA, sesionNueva: true },
    );
    expect(credencial!.debeCambiarPassword).toBe(false);
  });

  it('cambiar la propia contraseña exige la actual: una sesión robada no se convierte en la cuenta', async () => {
    const userId = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const { userId } = await crearUsuario(tx, {
        email: 'sesionrobada.ola4@ejemplo.co',
        nombreCompleto: 'Sesión robada',
        companyId: e.companyId,
        roleId: ROLES.SOLO_LECTURA,
      });
      return userId;
    });

    await expect(
      db.asTenant(
        e.tenantId,
        e.companyId,
        (tx) => cambiarMiPassword(tx, 'la-que-no-es', 'otra-clave-larga-2026'),
        { userId, rolId: ROLES.SOLO_LECTURA, sesionNueva: true },
      ),
    ).rejects.toBeInstanceOf(AdministracionInvalidaError);
  });

  it('un correo de otra firma no se puede adoptar: el usuario nunca cambia de firma', async () => {
    const otra = await crearEscenario(db);
    await db.asTenant(otra.tenantId, otra.companyId, (tx) =>
      crearUsuario(tx, { email: 'compartido.ola4@ejemplo.co', nombreCompleto: 'De la otra firma' }),
    );

    // Desde la firma `e` el correo NO se ve (RLS), así que el servicio no puede
    // avisar antes; lo detiene la restricción única global de `user.email`.
    await expect(
      db.asTenant(e.tenantId, e.companyId, (tx) =>
        crearUsuario(tx, { email: 'compartido.ola4@ejemplo.co', nombreCompleto: 'Intruso' }),
      ),
    ).rejects.toThrow();

    // Y la firma de al lado sigue con su usuario intacto.
    const suyos = await db.asTenant(otra.tenantId, otra.companyId, (tx) => listarUsuarios(tx));
    expect(suyos.some((u) => u.email === 'compartido.ola4@ejemplo.co')).toBe(true);
  });
});

// =============================================================================
// 4. EL JUNIOR CORRIGE, EL REVISOR APRUEBA (D-068)
// =============================================================================

describe('A16 · la aprobación jerárquica es un ESTADO del recurso, no un permiso especial', () => {
  it('la corrección de quien no puede aprobar queda pendiente y el motor NO la usa', async () => {
    const rolJunior = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const { id } = await crearRol(tx, {
        codigo: 'junior_correcciones',
        nombre: 'Junior que corrige',
        descripcion: 'Corrige documentos; la revisión la hace otro.',
        permisos: ['documento.leer', 'documento.reprocesar', 'asiento.leer'],
      });
      return id;
    });

    const juniorId = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const { userId } = await crearUsuario(tx, {
        email: 'corrector.ola4@ejemplo.co',
        nombreCompleto: 'Corrector junior',
      });
      await asignarRol(tx, { userId, companyId: e.companyId, roleId: rolJunior });
      return userId;
    });

    await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) =>
        guardarCorreccionAiu(tx, {
          sourceDocumentId: e.sourceDocumentId,
          lineaNumero: 1,
          valorAiuCentavos: 1_000_00,
          motivo: 'El AIU viene en el cuerpo de la factura, no en una línea propia.',
        }),
      { userId: juniorId, rolId: rolJunior, sesionNueva: true },
    );

    const estado = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ estado: string; revisado_por: string | null }>(
        'SELECT estado, revisado_por FROM document_correction WHERE source_document_id = $1 ORDER BY creado_en DESC LIMIT 1',
        [e.sourceDocumentId],
      );
      return rows[0]!;
    });
    expect(estado.estado).toBe('pendiente_revision');
    expect(estado.revisado_por).toBeNull();

    // El motor de causación se comporta EXACTAMENTE como antes de la Ola 4:
    // como si la corrección no existiera. Nunca «a medias».
    const vigentes = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      obtenerCorreccionesVigentes(tx, e.sourceDocumentId),
    );
    expect(vigentes.aiuPorLinea.size).toBe(0);

    // Y aparece en la bandeja de quien sí puede revisarla.
    const pendientes = await db.asTenant(e.tenantId, e.companyId, (tx) => listarCorreccionesPendientes(tx));
    expect(pendientes.some((c) => c.creadoPorNombre === 'Corrector junior')).toBe(true);
  });

  it('el junior no puede aprobar su propia corrección: lo rechaza el motor', async () => {
    const { rolJunior, juniorId, correccionId } = await db.asAdmin(async (tx) => {
      const { rows: rol } = await tx.query<{ id: string }>(
        "SELECT id FROM role WHERE codigo = 'junior_correcciones' AND tenant_id = $1",
        [e.tenantId],
      );
      const { rows: usuario } = await tx.query<{ id: string }>(
        "SELECT id FROM \"user\" WHERE email = 'corrector.ola4@ejemplo.co'",
      );
      const { rows: correccion } = await tx.query<{ id: string }>(
        "SELECT id FROM document_correction WHERE estado = 'pendiente_revision' ORDER BY creado_en DESC LIMIT 1",
      );
      return { rolJunior: rol[0]!.id, juniorId: usuario[0]!.id, correccionId: correccion[0]!.id };
    });

    await esperarErrorPg(
      () =>
        db.asTenant(
          e.tenantId,
          e.companyId,
          (tx) => revisarCorreccion(tx, correccionId, 'aprobado', 'Me apruebo a mí mismo'),
          { userId: juniorId, rolId: rolJunior, sesionNueva: true },
        ),
      'SE002',
      'que el junior apruebe su propia corrección',
    );
  });

  it('el revisor la aprueba y SOLO entonces el motor la usa', async () => {
    const correccionId = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        "SELECT id FROM document_correction WHERE estado = 'pendiente_revision' ORDER BY creado_en DESC LIMIT 1",
      );
      return rows[0]!.id;
    });

    await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) => revisarCorreccion(tx, correccionId, 'aprobado', 'Verificado contra el PDF de la factura.'),
      { rolCodigo: 'contador', sesionNueva: true },
    );

    const vigentes = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      obtenerCorreccionesVigentes(tx, e.sourceDocumentId),
    );
    expect(vigentes.aiuPorLinea.get(1)).toBe(1_000_00);

    const revisada = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ estado: string; revisado_por: string | null; motivo_revision: string }>(
        'SELECT estado, revisado_por, motivo_revision FROM document_correction WHERE id = $1',
        [correccionId],
      );
      return rows[0]!;
    });
    expect(revisada.estado).toBe('aprobado');
    expect(revisada.revisado_por).not.toBeNull();
    expect(revisada.motivo_revision).toContain('Verificado');
  });

  it('una corrección ya revisada no se vuelve a mover, ni siquiera por quien puede aprobar', async () => {
    const correccionId = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        "SELECT id FROM document_correction WHERE estado = 'aprobado' ORDER BY creado_en DESC LIMIT 1",
      );
      return rows[0]!.id;
    });
    await expect(
      db.asTenant(
        e.tenantId,
        e.companyId,
        (tx) => revisarCorreccion(tx, correccionId, 'rechazado', 'Me arrepentí'),
        { rolCodigo: 'contador', sesionNueva: true },
      ),
    ).rejects.toBeInstanceOf(AdministracionInvalidaError);
  });

  it('los DATOS de una corrección son inmutables aunque su estado se pueda mover', async () => {
    const correccionId = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        'SELECT id FROM document_correction ORDER BY creado_en DESC LIMIT 1',
      );
      return rows[0]!.id;
    });
    await esperarErrorPg(
      () => db.asAdmin((tx) => tx.query('UPDATE document_correction SET motivo = $2 WHERE id = $1', [correccionId, 'otro'])),
      'RL002',
      'editar los datos de una corrección',
    );
  });

  it('quien ya puede aprobar no pasa por la bandeja: su corrección nace aprobada y firmada', async () => {
    await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) =>
        guardarCorreccionAiu(tx, {
          sourceDocumentId: e.sourceDocumentId,
          lineaNumero: 2,
          valorAiuCentavos: 500_00,
          motivo: 'Corrijo yo, que soy quien revisa.',
        }),
      { rolCodigo: 'contador', sesionNueva: true },
    );

    const fila = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ estado: string; revisado_por: string | null }>(
        'SELECT estado, revisado_por FROM document_correction WHERE linea_numero = 2 ORDER BY creado_en DESC LIMIT 1',
      );
      return rows[0]!;
    });
    expect(fila.estado).toBe('aprobado');
    expect(fila.revisado_por).not.toBeNull();
  });
});

// =============================================================================
// 5. NADA DE ESTO ABRE UNA PUERTA ENTRE FIRMAS
// =============================================================================

describe('A16 · la Ola 4 no abrió ninguna puerta entre firmas', () => {
  it('una carga masiva escribe SOLO en la firma de la sesión', async () => {
    const otra = await crearEscenario(db);

    await db.asTenant(e.tenantId, e.companyId, (tx) =>
      importarTabla(
        tx,
        'municipality',
        'aislamiento.xlsx',
        {
          hoja: 'Datos',
          encabezados: ['codigo_dane', 'nombre', 'departamento', 'codigo_dane_departamento'],
          filas: [
            {
              numeroFila: 2,
              valores: {
                codigo_dane: '99999',
                nombre: 'Municipio de la firma A',
                departamento: 'Departamento A',
                codigo_dane_departamento: '99',
              },
            },
          ],
        },
      ),
    );

    const filaEscrita = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ tenant_id: string | null }>(
        "SELECT tenant_id FROM municipality WHERE codigo_dane = '99999'",
      );
      return rows;
    });
    expect(filaEscrita).toHaveLength(1);
    expect(filaEscrita[0]!.tenant_id).toBe(e.tenantId);

    // La firma B no lo ve.
    const desdeB = await db.asTenant(otra.tenantId, otra.companyId, async (tx) => {
      const { rows } = await tx.query<{ n: string }>(
        "SELECT count(*) AS n FROM municipality WHERE codigo_dane = '99999'",
      );
      return Number(rows[0]!.n);
    });
    expect(desdeB).toBe(0);
  });

  it('la lista de usuarios y de accesos es la de la firma en sesión, no la de todas', async () => {
    const otra = await crearEscenario(db);
    await db.asTenant(otra.tenantId, otra.companyId, (tx) =>
      crearUsuario(tx, { email: 'solo.de.b.ola4@ejemplo.co', nombreCompleto: 'Solo de la firma B' }),
    );

    const desdeA = await db.asTenant(e.tenantId, e.companyId, (tx) => listarUsuarios(tx));
    expect(desdeA.some((u) => u.email === 'solo.de.b.ola4@ejemplo.co')).toBe(false);
  });

  it('un rol propio de una firma no es asignable ni visible como suyo desde otra', async () => {
    const otra = await crearEscenario(db);
    const rolDeA = await db.asTenant(e.tenantId, e.companyId, async (tx) => {
      const roles = await listarRoles(tx);
      return roles.find((r) => r.codigo === 'junior_prueba')!.id;
    });

    const rolesDeB = await db.asTenant(otra.tenantId, otra.companyId, (tx) => listarRoles(tx));
    expect(rolesDeB.some((r) => r.id === rolDeA)).toBe(false);

    // Y otorgarlo desde B lo rechaza el motor (el guardia de alcance de 018
    // sobre `user_company_access.role_id`).
    const userB = await db.asTenant(otra.tenantId, otra.companyId, async (tx) => {
      const { userId } = await crearUsuario(tx, {
        email: 'victima.b.ola4@ejemplo.co',
        nombreCompleto: 'Usuario de B',
      });
      return userId;
    });
    await expect(
      db.asTenant(otra.tenantId, otra.companyId, (tx) =>
        asignarRol(tx, { userId: userB, companyId: otra.companyId, roleId: rolDeA }),
      ),
    ).rejects.toThrow();
  });
});

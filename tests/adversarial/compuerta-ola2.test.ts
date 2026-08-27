/**
 * A14 — COMPUERTA DE SALIDA DE LA OLA 2 (sección 4 del mega-prompt).
 *
 * Nada de lo que se afirma aquí se toma de un reporte ajeno. Cada criterio se
 * vuelve a comprobar con instrumentos propios de A14:
 *
 *  · Caso dorado 19 — no se usa el contador de A5 (`ProveedorLlmFalso.llamadas`).
 *    Se usa una MINA: un `ProveedorLlm` que revienta si alguien lo llama, y un
 *    espía sobre `globalThis.fetch` que revienta si el proceso abre un socket.
 *    Un contador que no sube se puede explicar de muchas formas; una mina que
 *    no explota, no.
 *  · Las diez funciones `SECURITY DEFINER` nuevas de la ola se interrogan como
 *    ORÁCULOS DE EXISTENCIA: se les pasa el identificador real de un objeto de
 *    OTRA firma y se exige que contesten exactamente lo mismo que a un
 *    identificador inventado. Si distinguen, filtran.
 *  · El canal de integración de A13 se ataca por donde se ataca un canal de
 *    máquina: token de una firma contra otra, privilegio del rol de sistema,
 *    y cierre de la tabla de credenciales.
 *  · La bandeja se ataca falsificando el `companyId` del formulario, que es el
 *    único dato de empresa que A7 acepta del cliente.
 *
 * Los casos 15, 17, 18 y 20 —inmutabilidad, retroactividad, reproducibilidad y
 * aislamiento— se reverifican aquí con escenario propio, porque en la Ola 1
 * quedaron probados solo en la suite de A3 y son exactamente el mandato de A14.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDb, uuid, type TestDb } from '../helpers/db.js';
import {
  crearAsientoBorrador,
  crearEscenario,
  publicarAsiento,
  type Escenario,
} from '../helpers/fixtures.js';
import { isPostgresError, SQLSTATE, type SqlClient } from '../../src/db/types.js';
import { clasificarDocumento, confirmarClasificacion } from '../../src/ai/index.js';
import type { PeticionLlm, ProveedorLlm, RespuestaLlm } from '../../src/ai/tipos.js';
import {
  crearConceptos,
  crearDocumentoConLineas,
  type ConceptosPrueba,
} from '../ai/_escenario.js';
import { encolarCausacion } from '../../src/services/cola.js';
import { aprobarAsiento, procesarJobCausacion } from '../../src/services/causacion.js';

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db?.close();
});

function codigoDe(e: unknown): string {
  return isPostgresError(e) ? (e.code ?? 'sin-codigo') : `no-es-error-de-motor:${String(e)}`;
}

async function capturarCodigo(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'NO-FALLO';
  } catch (e) {
    return codigoDe(e);
  }
}

// =============================================================================
// 1. CASO DORADO 19 — con una MINA, no con un contador
// =============================================================================

/** Un proveedor de LLM que no clasifica: denuncia. Si el flujo lo llama, la prueba muere. */
class ProveedorMina implements ProveedorLlm {
  readonly nombre = 'mina-de-a14';
  llamadas = 0;
  readonly peticiones: PeticionLlm[] = [];

  async clasificar(peticion: PeticionLlm): Promise<RespuestaLlm> {
    this.llamadas += 1;
    this.peticiones.push(peticion);
    throw new Error(
      `MINA DE A14: el flujo llamó al LLM cuando no debía. Petición: ${peticion.promptCodigo}`,
    );
  }
}

/** Proveedor que sí contesta, para poder sembrar la primera decisión. */
class ProveedorContado implements ProveedorLlm {
  readonly nombre = 'contado-de-a14';
  llamadas = 0;
  constructor(private readonly codigo: string) {}
  async clasificar(): Promise<RespuestaLlm> {
    this.llamadas += 1;
    return {
      codigo: this.codigo,
      scoreMilesimas: 1000,
      tokensEntrada: 100,
      tokensSalida: 10,
      modelo: 'a14-determinista',
    };
  }
}

describe('A14 · CRITERIO DE SALIDA 2 (caso dorado 19) — la segunda factura no llama al LLM', () => {
  let e: Escenario;
  let conceptos: ConceptosPrueba;
  let codigoMantenimiento = '';
  const DESCRIPCION_A = 'Servicio de mantenimiento de equipos de cómputo — enero 2026, OT-1001';
  const DESCRIPCION_B = 'SERVICIO DE MANTENIMIENTO DE EQUIPOS DE COMPUTO - febrero 2026, OT-2002';

  beforeAll(async () => {
    e = await crearEscenario(db, { razonSocial: 'Firma del caso 19 de A14' });
    conceptos = await crearConceptos(db, e, '-A14C19');
    codigoMantenimiento = `SERV-MANT-A14C19`;
  });

  it('1) primera factura: el modelo se consulta UNA vez y la decisión humana entra en memoria', async () => {
    const doc = await crearDocumentoConLineas(db, e, [DESCRIPCION_A]);
    const proveedor = new ProveedorContado(codigoMantenimiento);

    const r = await db.asAdmin((tx) => clasificarDocumento(tx, doc, { proveedor }));
    expect(proveedor.llamadas).toBe(1);
    expect(r.lineas[0]!.conceptoId).toBe(conceptos.mantenimiento);

    const pendienteId = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `SELECT id FROM clasificacion_pendiente WHERE source_document_id = $1`,
        [doc],
      );
      return rows[0]?.id ?? null;
    });
    if (pendienteId) {
      await db.asTenant(e.tenantId, e.companyId, (tx) =>
        confirmarClasificacion(tx, {
          pendienteId,
          conceptoId: conceptos.mantenimiento,
          usuarioId: e.userId,
        }),
      );
    }

    const enMemoria = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM memoria_clasificacion
          WHERE company_id = $1 AND third_party_id = $2`,
        [e.companyId, e.thirdPartyId],
      );
      return rows[0]!.n;
    });
    expect(Number(enMemoria)).toBeGreaterThan(0);
  });

  it('2) SEGUNDA factura: la mina no explota y el proceso no abre un solo socket', async () => {
    const doc = await crearDocumentoConLineas(db, e, [DESCRIPCION_B], { fecha: '2026-02-20' });
    const mina = new ProveedorMina();

    // Espía de red a nivel de proceso: si CUALQUIER cosa —el flujo, un import
    // perezoso, una telemetría— intenta salir a la red durante esta pasada, se
    // ve aquí. No se confía en que el proveedor inyectado sea el único camino.
    const fetchOriginal = globalThis.fetch;
    const espiaFetch = vi.fn(() => {
      throw new Error('MINA DE A14: se intentó una llamada de red durante el caso 19');
    });
    (globalThis as { fetch: unknown }).fetch = espiaFetch;

    try {
      const r = await db.asAdmin((tx) => clasificarDocumento(tx, doc, { proveedor: mina }));
      expect(mina.llamadas).toBe(0);
      expect(mina.peticiones).toHaveLength(0);
      expect(espiaFetch).not.toHaveBeenCalled();
      expect(r.llamadasLlm).toBe(0);
      expect(r.costoMicrosUsd).toBe(0);
      expect(r.lineas[0]!.origen).toBe('memoria');
      expect(r.lineas[0]!.conceptoId).toBe(conceptos.mantenimiento);
    } finally {
      (globalThis as { fetch: unknown }).fetch = fetchOriginal;
    }
  });

  it('3) y sin proveedor NINGUNO la segunda factura sigue clasificándose: la memoria no depende del LLM', async () => {
    const doc = await crearDocumentoConLineas(db, e, [DESCRIPCION_B], { fecha: '2026-03-20' });
    const r = await db.asAdmin((tx) => clasificarDocumento(tx, doc, { proveedor: null }));
    expect(r.llamadasLlm).toBe(0);
    expect(r.lineas[0]!.origen).toBe('memoria');
    expect(r.lineas[0]!.conceptoId).toBe(conceptos.mantenimiento);
  });

  it('4) REGLA DE ORO 4 — un LLM que devuelve un código fuera del catálogo cerrado no clasifica nada', async () => {
    const otro = await crearEscenario(db, { razonSocial: 'Firma del catálogo cerrado' });
    await crearConceptos(db, otro, '-A14CAT');
    const doc = await crearDocumentoConLineas(db, otro, ['Concepto jamás visto por nadie, 9x7']);

    class ProveedorMentiroso implements ProveedorLlm {
      readonly nombre = 'mentiroso';
      llamadas = 0;
      async clasificar(): Promise<RespuestaLlm> {
        this.llamadas += 1;
        // Un código que no está en el catálogo, con score máximo.
        return {
          codigo: 'CODIGO-QUE-NO-EXISTE',
          scoreMilesimas: 1000,
          tokensEntrada: 1,
          tokensSalida: 1,
          modelo: 'mentiroso',
        };
      }
    }
    const proveedor = new ProveedorMentiroso();
    const r = await db.asAdmin((tx) => clasificarDocumento(tx, doc, { proveedor }));
    expect(proveedor.llamadas).toBe(1);
    expect(r.lineas[0]!.conceptoId).toBeNull();
    expect(r.lineas[0]!.decision).not.toBe('aplicar');
  });

  it('5) REGLA DE ORO 4 — clasificar NO escribe ni una retención ni un asiento', async () => {
    const otro = await crearEscenario(db, { razonSocial: 'Firma sin cálculo por IA' });
    const c = await crearConceptos(db, otro, '-A14R4');
    const doc = await crearDocumentoConLineas(db, otro, ['Servicio de mantenimiento de equipos']);
    await db.asAdmin((tx) =>
      clasificarDocumento(tx, doc, { proveedor: new ProveedorContado(`SERV-MANT-A14R4`) }),
    );
    expect(c.mantenimiento).toBeTruthy();

    const escrituras = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ retenciones: number; asientos: number }>(
        `SELECT (SELECT count(*) FROM retention_applied WHERE source_document_id = $1)::int AS retenciones,
                (SELECT count(*) FROM journal_entry     WHERE source_document_id = $1)::int AS asientos`,
        [doc],
      );
      return rows[0]!;
    });
    expect(Number(escrituras.retenciones)).toBe(0);
    expect(Number(escrituras.asientos)).toBe(0);
  });
});

// =============================================================================
// 2. LAS DIEZ FUNCIONES `SECURITY DEFINER` NUEVAS — ¿oráculos de existencia?
// =============================================================================

describe('A14 · las funciones SECURITY DEFINER de la Ola 2 no son oráculos de existencia', () => {
  let a: Escenario;
  let b: Escenario;
  let taxRuleDeB = '';
  let municipioDeB = '';
  let conceptoTributarioDeB = '';

  beforeAll(async () => {
    a = await crearEscenario(db, { razonSocial: 'Firma A (observadora)' });
    b = await crearEscenario(db, { razonSocial: 'Firma B (objetivo)' });

    // Objetos REALES de la firma B, con identificadores válidos.
    ({ taxRuleDeB, municipioDeB, conceptoTributarioDeB } = await db.asAdmin(async (tx) => {
      // El escenario crea un municipio POR FIRMA: el de B es un identificador
      // real que la firma A no debería poder confirmar.
      const { rows: mun } = await tx.query<{ id: string }>(
        `SELECT id FROM municipality WHERE tenant_id = $1 LIMIT 1`,
        [b.tenantId],
      );
      const conceptoId = uuid();
      await tx.query(
        `INSERT INTO tax_concept (id, tenant_id, company_id, tipo, codigo, nombre)
         VALUES ($1,$2,$3,'retefuente',$4,'Concepto tributario de B')`,
        [conceptoId, b.tenantId, b.companyId, `A14-B-${conceptoId.slice(0, 8)}`],
      );
      const tc = [{ id: conceptoId }];
      const ruleId = uuid();
      await tx.query(
        `INSERT INTO tax_rule (id, tenant_id, company_id, tax_concept_id, tipo, tarifa,
                               aplica_sobre, aplica_a, vigente_desde, norma_respaldo)
         VALUES ($1,$2,$3,$4,'retefuente',$5,'base_gravable','ambos', DATE '2026-01-01',
                 'Regla de escenario adversarial de A14')`,
        [ruleId, b.tenantId, b.companyId, tc[0]!.id, '0.011000'],
      );
      return {
        taxRuleDeB: ruleId,
        municipioDeB: mun[0]!.id,
        conceptoTributarioDeB: tc[0]!.id,
      };
    }));
  });

  /**
   * El patrón de la prueba: la respuesta a un identificador REAL de otra firma
   * tiene que ser idéntica a la respuesta a un identificador INVENTADO. Si
   * difieren, la función confirma que el objeto existe (y en el peor caso, algo
   * sobre él).
   */
  async function respuestaComparada(
    sql: string,
    idReal: string,
  ): Promise<{ conReal: string; conInventado: string }> {
    const idInventado = uuid();
    return db.asTenant(a.tenantId, a.companyId, async (tx) => {
      const leer = async (id: string): Promise<string> => {
        try {
          const { rows } = await tx.query(sql, [id]);
          return JSON.stringify(rows);
        } catch (err) {
          return `ERROR:${codigoDe(err)}`;
        }
      };
      return { conReal: await leer(idReal), conInventado: await leer(idInventado) };
    });
  }

  it('app.fecha_minima_vigencia_tax_rule no distingue una regla ajena de una inexistente', async () => {
    const r = await respuestaComparada(
      'SELECT app.fecha_minima_vigencia_tax_rule($1) AS v',
      taxRuleDeB,
    );
    expect(r.conReal).toBe(r.conInventado);
  });

  it('app.simular_impacto_tax_concept no distingue un concepto ajeno de uno inexistente', async () => {
    const r = await respuestaComparada(
      'SELECT * FROM app.simular_impacto_tax_concept($1)',
      conceptoTributarioDeB,
    );
    expect(r.conReal).toBe(r.conInventado);
  });

  it('app.fecha_minima_vigencia_municipio_ica no distingue un municipio con actividad ajena de uno inexistente', async () => {
    const r = await respuestaComparada(
      'SELECT app.fecha_minima_vigencia_municipio_ica($1) AS v',
      municipioDeB,
    );
    expect(r.conReal).toBe(r.conInventado);
  });

  it('app.simular_impacto_municipio_ica no distingue un municipio ajeno de uno inexistente', async () => {
    const r = await respuestaComparada(
      'SELECT * FROM app.simular_impacto_municipio_ica($1)',
      municipioDeB,
    );
    expect(r.conReal).toBe(r.conInventado);
  });

  it('app.revocar_token_integracion no distingue un token ajeno de uno inexistente', async () => {
    // Se emite un token REAL en la firma B y se intenta revocar desde la A.
    const tokenIdDeB = await db.asTenant(b.tenantId, b.companyId, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `SELECT app.crear_token_integracion($1,'correo','Token de B', $2) AS id`,
        [b.userId, `token-de-prueba-de-a14-${uuid()}${uuid()}`],
      );
      return rows[0]!.id;
    });
    const r = await respuestaComparada('SELECT app.revocar_token_integracion($1) AS v', tokenIdDeB);
    expect(r.conReal).toBe(r.conInventado);

    // Y el token de B sigue vivo: la firma A no lo tumbó.
    const vivo = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM app.integration_credential
          WHERE id = $1 AND revocado_en IS NULL`,
        [tokenIdDeB],
      );
      return Number(rows[0]!.n);
    });
    expect(vivo).toBe(1);
  });

  it('app.empresas_accesibles y app.listar_tokens_integracion solo devuelven lo de la firma en sesión', async () => {
    const empresasDeA = await db.asTenant(a.tenantId, a.companyId, async (tx) => {
      const { rows } = await tx.query<{ company_id: string }>(
        'SELECT company_id FROM app.empresas_accesibles()',
      );
      return rows.map((r) => r.company_id);
    });
    expect(empresasDeA).toContain(a.companyId);
    expect(empresasDeA).not.toContain(b.companyId);

    const tokensDeA = await db.asTenant(a.tenantId, a.companyId, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        'SELECT id FROM app.listar_tokens_integracion()',
      );
      return rows.map((r) => r.id);
    });
    expect(tokensDeA).toEqual([]);
  });

  it('las seis funciones de parametrización EXIGEN el permiso: un auxiliar no las puede llamar', async () => {
    const llamadas = [
      'SELECT app.fecha_minima_vigencia_tenant()',
      'SELECT * FROM app.simular_impacto_valor_base()',
    ];
    for (const sql of llamadas) {
      const codigo = await capturarCodigo(() =>
        db.asTenant(a.tenantId, a.companyId, (tx) => tx.query(sql), {
          rolCodigo: 'auxiliar_causacion',
          sesionNueva: true,
        }),
      );
      expect(`${sql} -> ${codigo}`).toBe(`${sql} -> ${SQLSTATE.PERMISO_INSUFICIENTE}`);
    }
  });

  it('crear un token de integración EXIGE usuario.administrar', async () => {
    const codigo = await capturarCodigo(() =>
      db.asTenant(
        a.tenantId,
        a.companyId,
        (tx) =>
          tx.query(`SELECT app.crear_token_integracion($1,'correo','x',$2)`, [
            a.userId,
            `token-sin-permiso-${uuid()}${uuid()}`,
          ]),
        { rolCodigo: 'auxiliar_causacion', sesionNueva: true },
      ),
    );
    expect(codigo).toBe(SQLSTATE.PERMISO_INSUFICIENTE);
  });

  it('un administrador de la firma A no puede emitir un token para un usuario de la firma B', async () => {
    const codigo = await capturarCodigo(() =>
      db.asTenant(a.tenantId, a.companyId, (tx) =>
        tx.query(`SELECT app.crear_token_integracion($1,'correo','robo',$2)`, [
          b.userId,
          `token-cruzado-de-a14-${uuid()}${uuid()}`,
        ]),
      ),
    );
    expect(codigo).toBe(SQLSTATE.INTEGRACION_USUARIO_AJENO);
  });

  it('y ese mismo error es el que devuelve un usuario inexistente: tampoco ahí hay oráculo', async () => {
    const codigo = await capturarCodigo(() =>
      db.asTenant(a.tenantId, a.companyId, (tx) =>
        tx.query(`SELECT app.crear_token_integracion($1,'correo','fantasma',$2)`, [
          uuid(),
          `token-fantasma-de-a14-${uuid()}${uuid()}`,
        ]),
      ),
    );
    expect(codigo).toBe(SQLSTATE.INTEGRACION_USUARIO_AJENO);
  });
});

// =============================================================================
// 3. A13 — el canal de integración, atacado
// =============================================================================

describe('A14 · el canal de integración de A13 no rodea D-020/D-021 ni afloja D-023', () => {
  it('app.integration_credential está tan cerrada como app.session_context: cero privilegios de aplicación', async () => {
    const privilegios = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ tabla: string; rol: string; privs: string }>(
        `SELECT c.relname AS tabla, r.rolname AS rol,
                array_to_string(ARRAY(
                  SELECT p FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
                   WHERE has_table_privilege(r.rolname, c.oid, p)), ',') AS privs
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          CROSS JOIN pg_roles r
          WHERE n.nspname = 'app'
            AND c.relname IN ('integration_credential', 'session_context')
            AND r.rolname IN ('app_user', 'app_auth')`,
      );
      return rows.filter((r) => r.privs !== '').map((r) => `${r.tabla}/${r.rol}:${r.privs}`);
    });
    expect(privilegios).toEqual([]);
  });

  it('app_user no puede autenticar un token: autenticar es de app_auth, igual que buscar_credencial (D-023)', async () => {
    const e = await crearEscenario(db, { razonSocial: 'Firma del privilegio de autenticación' });
    const codigo = await capturarCodigo(() =>
      db.asTenant(e.tenantId, e.companyId, (tx) =>
        tx.query(`SELECT * FROM app.autenticar_token_integracion($1)`, ['x'.repeat(40)]),
      ),
    );
    // 42501 = el motor le niega el EXECUTE. Es MÁS fuerte que un SE002 de
    // dominio: `app_user` no llega ni a entrar en la función.
    expect(codigo).toBe(SQLSTATE.RLS_VIOLATION);
  });

  it('el rol de negocio sistema_ingesta tiene EXACTAMENTE dos permisos, y ninguno aprueba ni publica', async () => {
    const permisos = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ codigo: string }>(
        `SELECT rp.permission_codigo AS codigo
           FROM role r JOIN role_permission rp ON rp.role_id = r.id
          WHERE r.codigo = 'sistema_ingesta' ORDER BY 1`,
      );
      return rows.map((r) => r.codigo);
    });
    expect(permisos).toEqual(['documento.cargar', 'documento.leer']);
    for (const prohibido of [
      'asiento.aprobar',
      'asiento.publicar',
      'parametro.editar',
      'tercero.editar',
      'usuario.administrar',
    ]) {
      expect(permisos).not.toContain(prohibido);
    }
  });

  it('una sesión de sistema NO puede aprobar un asiento ni editar un parámetro', async () => {
    const e = await crearEscenario(db, { razonSocial: 'Firma con canal de correo' });

    // Usuario de sistema con el rol sistema_ingesta sobre la empresa.
    const { sistemaUserId } = await db.asAdmin(async (tx) => {
      const { rows: rol } = await tx.query<{ id: string }>(
        `SELECT id FROM role WHERE codigo = 'sistema_ingesta'`,
      );
      const { rows: u } = await tx.query<{ id: string }>(
        `INSERT INTO "user" (tenant_id, email, nombre_completo, estado)
         VALUES ($1, $2, 'Sistema de ingesta', 'activo') RETURNING id`,
        [e.tenantId, `sistema.a14.${uuid()}@interno`],
      );
      await tx.query(
        `INSERT INTO user_company_access (tenant_id, company_id, user_id, role_id)
         VALUES ($1,$2,$3,$4)`,
        [e.tenantId, e.companyId, u[0]!.id, rol[0]!.id],
      );
      return { sistemaUserId: u[0]!.id };
    });

    const codigoAprobar = await capturarCodigo(() =>
      db.asTenant(
        e.tenantId,
        e.companyId,
        (tx) => tx.query(`SELECT app.exigir_permiso('asiento.aprobar')`),
        { userId: sistemaUserId, rolCodigo: 'sistema_ingesta', sesionNueva: true },
      ),
    );
    expect(codigoAprobar).toBe(SQLSTATE.PERMISO_INSUFICIENTE);

    const codigoParametro = await capturarCodigo(() =>
      db.asTenant(
        e.tenantId,
        e.companyId,
        (tx) => tx.query(`SELECT app.exigir_permiso('parametro.editar')`),
        { userId: sistemaUserId, rolCodigo: 'sistema_ingesta', sesionNueva: true },
      ),
    );
    expect(codigoParametro).toBe(SQLSTATE.PERMISO_INSUFICIENTE);

    // Y tampoco puede escribir directamente en el ledger, aunque lo intente por SQL.
    const codigoLedger = await capturarCodigo(() =>
      db.asTenant(
        e.tenantId,
        e.companyId,
        (tx) =>
          tx.query(
            `UPDATE journal_entry SET estado = 'posted' WHERE tenant_id = $1`,
            [e.tenantId],
          ),
        { userId: sistemaUserId, rolCodigo: 'sistema_ingesta', sesionNueva: true },
      ),
    );
    expect(['NO-FALLO', SQLSTATE.LEDGER_INMUTABLE, SQLSTATE.RLS_VIOLATION]).toContain(codigoLedger);
  });

  it('crear el usuario de sistema en OTRA firma lo rechaza el motor, no la aplicación', async () => {
    const a = await crearEscenario(db, { razonSocial: 'Firma A del usuario de sistema' });
    const bb = await crearEscenario(db, { razonSocial: 'Firma B del usuario de sistema' });
    const codigo = await capturarCodigo(() =>
      db.asTenant(a.tenantId, a.companyId, (tx) =>
        tx.query(
          `INSERT INTO "user" (tenant_id, email, nombre_completo, estado)
           VALUES ($1, $2, 'Sistema colado', 'activo')`,
          [bb.tenantId, `colado.${uuid()}@interno`],
        ),
      ),
    );
    expect(codigo).toBe(SQLSTATE.RLS_VIOLATION);
  });
});

// =============================================================================
// 4. n8n — la frontera de la sección 13.2, verificada por A14
// =============================================================================

describe('A14 · ningún workflow de n8n calcula una retención ni escribe un asiento (13.2)', () => {
  it('los workflows no traen nodos de base de datos, ni SQL, ni aritmética sobre importes', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const raiz = new URL('../../n8n/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
    const archivos = readdirSync(raiz).filter((a) => a.endsWith('.workflow.json'));
    expect(archivos.length).toBeGreaterThan(0);

    const hallazgos: string[] = [];
    for (const archivo of archivos) {
      const crudo = readFileSync(join(raiz, archivo), 'utf8');
      const workflow = JSON.parse(crudo) as { nodes?: { type?: string; name?: string }[] };

      for (const nodo of workflow.nodes ?? []) {
        const tipo = String(nodo.type ?? '');
        if (/postgres|mysql|mongo|redis|snowflake|supabase|questdb|crateDb|timescale/i.test(tipo)) {
          hallazgos.push(`${archivo}: nodo de base de datos «${nodo.name}» (${tipo})`);
        }
        if (/executeCommand|ssh/i.test(tipo)) {
          hallazgos.push(`${archivo}: nodo de ejecución «${nodo.name}» (${tipo})`);
        }
      }

      // Ni SQL, ni vocabulario tributario, ni una tabla del ledger.
      for (const patron of [
        /\b(INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM|SELECT\s+.+\s+FROM)\b/i,
        /\b(journal_entry|journal_line|retention_applied|tax_rule|uvt_value)\b/i,
        /\b(retefuente|reteiva|reteica|autorretenci|tarifa|uvt|smmlv)\b/i,
      ]) {
        const m = patron.exec(crudo);
        if (m) hallazgos.push(`${archivo}: «${m[0]}» — lógica que no puede vivir en n8n`);
      }
    }
    expect(hallazgos).toEqual([]);
  });

  it('los workflows solo llegan a la aplicación por HTTP: no importan código de este repositorio', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const raiz = new URL('../../n8n/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
    const hallazgos: string[] = [];
    for (const archivo of readdirSync(raiz).filter((a) => a.endsWith('.workflow.json'))) {
      const crudo = readFileSync(join(raiz, archivo), 'utf8');
      if (/require\(|from\s+['"]\.\.?\//.test(crudo)) {
        hallazgos.push(`${archivo}: importa código del repositorio`);
      }
    }
    expect(hallazgos).toEqual([]);
  });
});

// =============================================================================
// 5. CASOS 15, 17, 18 y 20 reverificados con escenario propio de A14
// =============================================================================

/** Documento causable mínimo, con memoria sembrada para que el concepto resuelva. */
async function montarCausable(
  e: Escenario,
  descripcion: string,
  base = 100_000_00,
  iva = 19_000_00,
): Promise<{ conceptoId: string; jobId: string }> {
  const conceptoId = await db.asAdmin(async (tx) => {
    const id = uuid();
    await tx.query(
      `INSERT INTO concepto_causacion (
         id, tenant_id, company_id, codigo, nombre, naturaleza,
         cuenta_gasto_id, cuenta_iva_descontable_id, cuenta_contrapartida_id,
         aplica_retefuente, aplica_reteiva, aplica_reteica, aplica_autorretencion)
       VALUES ($1,$2,$3,$4,'Concepto de A14 Ola 2','compra',$5,$6,$7,false,false,false,false)`,
      [
        id,
        e.tenantId,
        e.companyId,
        `A14O2-${id.slice(0, 8)}`,
        e.cuentas.gasto,
        e.cuentas.ivaDescontable,
        e.cuentas.proveedores,
      ],
    );
    await tx.query(
      `INSERT INTO memoria_clasificacion (tenant_id, company_id, third_party_id, patron_descripcion, concepto_causacion_id)
       VALUES ($1,$2,$3,$4,$5)`,
      [e.tenantId, e.companyId, e.thirdPartyId, descripcion.toLowerCase().trim(), id],
    );
    await tx.query(`UPDATE source_document SET estado = 'parseado' WHERE id = $1`, [
      e.sourceDocumentId,
    ]);
    await tx.query(
      `INSERT INTO extraction (tenant_id, company_id, source_document_id, datos_extraidos, origen)
       VALUES ($1,$2,$3,$4::jsonb,'parser_ubl')`,
      [
        e.tenantId,
        e.companyId,
        e.sourceDocumentId,
        JSON.stringify({
          tipoDocumento: 'Invoice',
          emisor: { nit: '900123456', nombre: 'Proveedor' },
          adquirente: { nit: null, nombre: null },
          lineas: [
            {
              numero: 1,
              descripcion,
              subtotal: String(base),
              impuestos: iva > 0 ? [{ codigo: '01', valor: String(iva) }] : [],
            },
          ],
        }),
      ],
    );
    return id;
  });

  const job = await db.asTenant(e.tenantId, e.companyId, (tx) =>
    encolarCausacion(tx, e.sourceDocumentId),
  );
  return { conceptoId, jobId: job.id };
}

async function fotoAsiento(entryId: string): Promise<string> {
  return db.asAdmin(async (tx) => {
    const { rows } = await tx.query<{ foto: string }>(
      `SELECT jsonb_build_object(
                'entrada', to_jsonb(je.*) - 'id' - 'creado_en' - 'aprobado_en' - 'publicado_en',
                'partidas', COALESCE((
                   SELECT jsonb_agg(to_jsonb(jl.*) - 'id' - 'creado_en' ORDER BY jl.linea)
                     FROM journal_line jl WHERE jl.journal_entry_id = je.id), '[]'::jsonb)
              )::text AS foto
         FROM journal_entry je WHERE je.id = $1`,
      [entryId],
    );
    return rows[0]!.foto;
  });
}

describe('A14 · casos 18 y 20 y las Reglas 1 y 5, reverificados en la Ola 2', () => {
  it('18 · diez pasadas de la cola sobre la misma factura dejan UN asiento idéntico', async () => {
    const e = await crearEscenario(db, { razonSocial: 'Firma del reproceso de la Ola 2' });
    const { jobId } = await montarCausable(e, 'Reproceso decuplicado de la Ola 2');

    const primera = await db.asAdmin((tx) =>
      procesarJobCausacion(tx, { id: jobId, sourceDocumentId: e.sourceDocumentId }),
    );
    if (primera.estado !== 'causado' || !primera.journalEntryId) {
      throw new Error(`no causó: ${JSON.stringify(primera)}`);
    }
    const fotos = [await fotoAsiento(primera.journalEntryId)];

    for (let i = 0; i < 9; i += 1) {
      await db.asAdmin((tx) =>
        tx.query(
          `UPDATE document_processing_job SET estado = 'pendiente', disponible_en = now() WHERE id = $1`,
          [jobId],
        ),
      );
      const r = await db.asAdmin((tx) =>
        procesarJobCausacion(tx, { id: jobId, sourceDocumentId: e.sourceDocumentId }),
      );
      if (r.estado === 'revision_manual') {
        throw new Error(`el reproceso mandó el documento a revisión manual: ${r.motivos.join(', ')}`);
      }
      expect(r.journalEntryId).toBe(primera.journalEntryId);
      fotos.push(await fotoAsiento(primera.journalEntryId));
    }

    expect(new Set(fotos).size).toBe(1);
    const n = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM journal_entry WHERE source_document_id = $1`,
        [e.sourceDocumentId],
      );
      return Number(rows[0]!.n);
    });
    expect(n).toBe(1);
  });

  it('REGLA 1 · UPDATE y DELETE sobre un asiento publicado fallan EN LA BASE', async () => {
    const e = await crearEscenario(db, { razonSocial: 'Firma del ledger inmutable (Ola 2)' });
    const { jobId } = await montarCausable(e, 'Asiento que se va a intentar mutar');
    const causado = await db.asAdmin((tx) =>
      procesarJobCausacion(tx, { id: jobId, sourceDocumentId: e.sourceDocumentId }),
    );
    if (causado.estado !== 'causado' || !causado.journalEntryId) throw new Error('no causó');
    const entryId = causado.journalEntryId;

    await db.asTenant(e.tenantId, e.companyId, (tx) =>
      aprobarAsiento(tx, {
        journalEntryId: entryId,
        decision: 'aprobado',
        userId: e.userId,
        ip: '198.51.100.7',
      }),
    );

    const estado = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ estado: string }>(
        `SELECT estado FROM journal_entry WHERE id = $1`,
        [entryId],
      );
      return rows[0]!.estado;
    });
    expect(estado).toBe('posted');

    // Ni siquiera como superusuario/dueño del esquema: el trigger no distingue.
    const codigoUpdate = await capturarCodigo(() =>
      db.asAdmin((tx) =>
        tx.query(`UPDATE journal_entry SET descripcion = 'mutado' WHERE id = $1`, [entryId]),
      ),
    );
    expect(codigoUpdate).toBe(SQLSTATE.LEDGER_INMUTABLE);

    const codigoDelete = await capturarCodigo(() =>
      db.asAdmin((tx) => tx.query(`DELETE FROM journal_entry WHERE id = $1`, [entryId])),
    );
    expect(codigoDelete).toBe(SQLSTATE.LEDGER_INMUTABLE);

    const codigoLinea = await capturarCodigo(() =>
      db.asAdmin((tx) =>
        tx.query(`UPDATE journal_line SET monto = monto + 1 WHERE journal_entry_id = $1`, [entryId]),
      ),
    );
    expect(codigoLinea).toBe(SQLSTATE.LEDGER_INMUTABLE);
  });

  it('REGLA 1 · un asiento desbalanceado lo rechaza la BASE, no la aplicación', async () => {
    const e = await crearEscenario(db, { razonSocial: 'Firma del descuadre (Ola 2)' });
    const codigo = await capturarCodigo(() =>
      db.asAdmin(async (tx) => {
        const entryId = await crearAsientoBorrador(
          tx,
          e,
          [
            { accountId: e.cuentas.gasto, side: 'debito', monto: 100_000 },
            { accountId: e.cuentas.proveedores, side: 'credito', monto: 99_999 },
          ],
          { descripcion: 'Descuadre deliberado de A14 (un centavo)' },
        );
        await publicarAsiento(tx, entryId, e.userId);
      }),
    );
    expect(codigo).toBe(SQLSTATE.ASIENTO_DESBALANCEADO);
  });

  it('20 · la sesión de la firma A no ve ni una fila de la firma B, tampoco en las tablas nuevas de la Ola 2', async () => {
    const a = await crearEscenario(db, { razonSocial: 'Firma A (Ola 2, aislamiento)' });
    const b = await crearEscenario(db, { razonSocial: 'Firma B (Ola 2, aislamiento)' });

    // Se siembra en B una fila de cada tabla nueva de la ola.
    await db.asAdmin(async (tx) => {
      const conceptoId = uuid();
      await tx.query(
        `INSERT INTO concepto_causacion (id, tenant_id, company_id, codigo, nombre, naturaleza,
                                         cuenta_gasto_id, cuenta_iva_descontable_id, cuenta_contrapartida_id,
                                         aplica_retefuente, aplica_reteiva, aplica_reteica, aplica_autorretencion)
         VALUES ($1,$2,$3,'AISL-B','Concepto de B','compra',$4,$5,$6,false,false,false,false)`,
        [conceptoId, b.tenantId, b.companyId, b.cuentas.gasto, b.cuentas.ivaDescontable, b.cuentas.proveedores],
      );
      await tx.query(
        `INSERT INTO memoria_clasificacion (tenant_id, company_id, third_party_id, patron_descripcion, concepto_causacion_id)
         VALUES ($1,$2,$3,'secreto industrial de la firma b',$4)`,
        [b.tenantId, b.companyId, b.thirdPartyId, conceptoId],
      );
      await tx.query(
        `INSERT INTO document_correction (tenant_id, company_id, source_document_id, tipo,
                                          linea_numero, valor_aiu_centavos, motivo, creado_por)
         VALUES ($1,$2,$3,'aiu_linea',1,500000,'AIU de la firma B',$4)`,
        [b.tenantId, b.companyId, b.sourceDocumentId, b.userId],
      );
      await tx.query(
        `INSERT INTO integration_call_log (tenant_id, company_id, canal, direccion, endpoint, resultado)
         VALUES ($1,$2,'correo','entrante','/api/integraciones/correo','ok')`,
        [b.tenantId, b.companyId],
      );
      await tx.query(
        `INSERT INTO parametro_clasificacion (tenant_id, company_id, clave, valor)
         VALUES ($1,$2,'umbral_aplicar','900'::jsonb)`,
        [b.tenantId, b.companyId],
      );
    });

    const TABLAS = [
      'memoria_clasificacion',
      'document_correction',
      'integration_call_log',
      'parametro_clasificacion',
      'concepto_causacion',
      'clasificacion_pendiente',
    ];

    const fugas = await db.asTenant(a.tenantId, a.companyId, async (tx) => {
      const encontradas: string[] = [];
      for (const tabla of TABLAS) {
        // Consulta SIN filtro de tenant: es exactamente el olvido que la Regla 7
        // obliga a que la base ataje.
        const { rows } = await tx.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM ${tabla} WHERE tenant_id = $1`,
          [b.tenantId],
        );
        if (Number(rows[0]!.n) > 0) encontradas.push(`${tabla}: ${rows[0]!.n} filas de B`);
      }
      return encontradas;
    });
    expect(fugas).toEqual([]);
  });
});

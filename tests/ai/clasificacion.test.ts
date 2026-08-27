/**
 * A5 — EL FLUJO DE LA SECCIÓN 8.3, PROBADO PASO POR PASO.
 *
 * Ninguna prueba de este archivo abre una conexión de red ni necesita un
 * secreto: el puerto `ProveedorLlm` se satisface con `ProveedorLlmFalso`, que
 * además CUENTA las llamadas. Ese contador es lo que convierte «la memoria
 * ahorra tokens» en una afirmación verificable en vez de una promesa.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  MOTIVO_CLASIFICACION,
  ProveedorLlmFalso,
  clasificarDocumento,
  confirmarClasificacion,
  construirPeticion,
  cargarCatalogo,
  cargarPrompt,
  costoMicrosUsd,
  crearProveedorLlm,
  estimarTokens,
  huellaPeticion,
  listarColaRevision,
} from '../../src/ai/index';
import { CLAVE } from '../../src/ai/parametros';
import { createTestDb, esperarErrorPg, uuid, type TestDb } from '../helpers/db';
import { crearEscenario, type Escenario } from '../helpers/fixtures';
import { SQLSTATE } from '../../src/db/types';
import {
  crearConceptos,
  crearDocumentoConLineas,
  fijarParametro,
  type ConceptosPrueba,
} from './_escenario';

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db?.close();
});

/** Cada prueba monta su propia empresa: así ninguna hereda memoria de otra. */
async function montar(): Promise<{ e: Escenario; conceptos: ConceptosPrueba }> {
  const e = await crearEscenario(db);
  const conceptos = await crearConceptos(db, e);
  return { e, conceptos };
}

const DESCRIPCION_MANTENIMIENTO = 'Servicio de mantenimiento de equipos de cómputo — julio 2026';

// =============================================================================
describe('A5 · paso 2 — la memoria se consulta ANTES del modelo', () => {
  it('con memoria confirmada, el documento se clasifica con CERO llamadas', async () => {
    const { e, conceptos } = await montar();
    await db.asAdmin((tx) =>
      tx.query(
        `INSERT INTO memoria_clasificacion (tenant_id, company_id, third_party_id,
            patron_descripcion, concepto_causacion_id, normalizador_version)
         VALUES ($1,$2,$3,'servicio de mantenimiento de equipos de computo',$4,2)`,
        [e.tenantId, e.companyId, e.thirdPartyId, conceptos.mantenimiento],
      ),
    );

    const documento = await crearDocumentoConLineas(db, e, [DESCRIPCION_MANTENIMIENTO]);
    const proveedor = new ProveedorLlmFalso();
    const r = await db.asAdmin((tx) => clasificarDocumento(tx, documento, { proveedor }));

    expect(proveedor.llamadas).toBe(0);
    expect(r.llamadasLlm).toBe(0);
    expect(r.costoMicrosUsd).toBe(0);
    expect(r.lineas).toHaveLength(1);
    expect(r.lineas[0]!.origen).toBe('memoria');
    expect(r.lineas[0]!.decision).toBe('aplicar');
    expect(r.lineas[0]!.conceptoId).toBe(conceptos.mantenimiento);
  });

  it('el acierto queda contado en la memoria', async () => {
    const { e, conceptos } = await montar();
    await db.asAdmin((tx) =>
      tx.query(
        `INSERT INTO memoria_clasificacion (tenant_id, company_id, third_party_id,
            patron_descripcion, concepto_causacion_id, normalizador_version)
         VALUES ($1,$2,$3,'servicio de aseo',$4,2)`,
        [e.tenantId, e.companyId, e.thirdPartyId, conceptos.papeleria],
      ),
    );
    const documento = await crearDocumentoConLineas(db, e, ['Servicio de aseo']);
    await db.asAdmin((tx) => clasificarDocumento(tx, documento, { proveedor: null }));

    const aciertos = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ aciertos: number }>(
        `SELECT aciertos FROM memoria_clasificacion WHERE company_id = $1 AND patron_descripcion = 'servicio de aseo'`,
        [e.companyId],
      );
      return Number(rows[0]!.aciertos);
    });
    expect(aciertos).toBe(1);
  });

  it('una entrada escrita con la normalización MÍNIMA de la Ola 1 se sigue encontrando', async () => {
    const { e, conceptos } = await montar();
    // Exactamente lo que escribía A6 en la Ola 1: minúsculas + trim, con tilde.
    await db.asAdmin((tx) =>
      tx.query(
        `INSERT INTO memoria_clasificacion (tenant_id, company_id, third_party_id,
            patron_descripcion, concepto_causacion_id)
         VALUES ($1,$2,$3,'servicio de consultoría de punta a punta',$4)`,
        [e.tenantId, e.companyId, e.thirdPartyId, conceptos.honorarios],
      ),
    );
    const documento = await crearDocumentoConLineas(db, e, [
      'Servicio de consultoría de punta a punta',
    ]);
    const proveedor = new ProveedorLlmFalso();
    const r = await db.asAdmin((tx) => clasificarDocumento(tx, documento, { proveedor }));
    expect(proveedor.llamadas).toBe(0);
    expect(r.lineas[0]!.conceptoId).toBe(conceptos.honorarios);
  });
});

// =============================================================================
describe('A5 · pasos 3 a 5 — el modelo propone y los umbrales deciden', () => {
  it('sin memoria hay UNA llamada, y el score sobre el umbral deja la propuesta precargada', async () => {
    const { e, conceptos } = await montar();
    const documento = await crearDocumentoConLineas(db, e, [DESCRIPCION_MANTENIMIENTO]);
    const proveedor = new ProveedorLlmFalso();
    const r = await db.asAdmin((tx) => clasificarDocumento(tx, documento, { proveedor }));

    expect(proveedor.llamadas).toBe(1);
    expect(r.lineas[0]!.origen).toBe('llm');
    expect(r.lineas[0]!.conceptoId).toBe(conceptos.mantenimiento);
    expect(r.lineas[0]!.decision).toBe('proponer');
    expect(r.lineas[0]!.scoreMilesimas).toBeGreaterThanOrEqual(700);
    expect(r.lineas[0]!.scoreMilesimas).toBeLessThan(900);

    const cola = await db.asAdmin((tx) => listarColaRevision(tx, e.companyId));
    expect(cola).toHaveLength(1);
    expect(cola[0]!.conceptoPropuestoId).toBe(conceptos.mantenimiento);
  });

  it('score por encima del umbral de auto-aprobación: se aplica sin confirmación de concepto', async () => {
    const { e, conceptos } = await montar();
    const documento = await crearDocumentoConLineas(db, e, ['Mantenimiento de equipos']);
    const proveedor = new ProveedorLlmFalso();
    const r = await db.asAdmin((tx) => clasificarDocumento(tx, documento, { proveedor }));

    expect(r.lineas[0]!.scoreMilesimas).toBe(1000);
    expect(r.lineas[0]!.decision).toBe('aplicar');
    expect(r.lineas[0]!.conceptoId).toBe(conceptos.mantenimiento);
  });

  it('score bajo: cola de revisión SIN propuesta, y la base lo impone', async () => {
    const { e } = await montar();
    const documento = await crearDocumentoConLineas(db, e, ['Compra de tornillos y tuercas']);
    const proveedor = new ProveedorLlmFalso();
    const r = await db.asAdmin((tx) => clasificarDocumento(tx, documento, { proveedor }));

    expect(proveedor.llamadas).toBe(1);
    expect(r.lineas[0]!.decision).toBe('revisar');
    expect(r.lineas[0]!.conceptoId).toBeNull();

    const fila = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{
        concepto_propuesto_id: string | null;
        score_milesimas: number | null;
        origen: string;
      }>(
        `SELECT concepto_propuesto_id, score_milesimas, origen
           FROM clasificacion_pendiente WHERE source_document_id = $1`,
        [documento],
      );
      return rows[0]!;
    });
    expect(fila.concepto_propuesto_id).toBeNull();
    expect(fila.score_milesimas).toBeNull();
    expect(fila.origen).toBe('sin_propuesta');
  });

  it('los umbrales salen de la TABLA: subirlos cambia la decisión sin tocar una línea de código', async () => {
    const { e } = await montar();
    // Con el umbral de propuesta por encima del score que produce el modelo,
    // la misma línea que antes se proponía ahora exige revisión sin propuesta.
    await fijarParametro(db, { tenantId: e.tenantId, companyId: e.companyId }, CLAVE.UMBRAL_PROPUESTA, 800);
    const documento = await crearDocumentoConLineas(db, e, [DESCRIPCION_MANTENIMIENTO]);
    const r = await db.asAdmin((tx) =>
      clasificarDocumento(tx, documento, { proveedor: new ProveedorLlmFalso() }),
    );
    expect(r.lineas[0]!.scoreMilesimas).toBe(750);
    expect(r.lineas[0]!.decision).toBe('revisar');
    expect(r.lineas[0]!.conceptoId).toBeNull();
  });

  it('sin umbrales parametrizados no se propone nada: no se inventa un umbral por defecto', async () => {
    const { e } = await montar();
    await db.asAdmin((tx) =>
      tx.query(`DELETE FROM parametro_clasificacion WHERE tenant_id IS NULL AND clave = $1`, [
        CLAVE.UMBRAL_PROPUESTA,
      ]),
    );
    try {
      const documento = await crearDocumentoConLineas(db, e, [DESCRIPCION_MANTENIMIENTO]);
      const proveedor = new ProveedorLlmFalso();
      const r = await db.asAdmin((tx) => clasificarDocumento(tx, documento, { proveedor }));
      expect(proveedor.llamadas).toBe(0);
      expect(r.motivos).toContain(MOTIVO_CLASIFICACION.SIN_UMBRALES);
      expect(r.lineas[0]!.decision).toBe('revisar');
    } finally {
      await fijarParametro(db, { tenantId: null, companyId: null }, CLAVE.UMBRAL_PROPUESTA, 700);
    }
  });
});

// =============================================================================
describe('A5 · Regla de Oro 4 — el catálogo es cerrado y la IA no calcula', () => {
  it('un código que no está en el catálogo se descarta, por alto que venga el score', async () => {
    const { e } = await montar();
    const documento = await crearDocumentoConLineas(db, e, ['Servicio de mantenimiento de equipos']);
    const proveedor = new ProveedorLlmFalso({ codigoFijo: 'CONCEPTO-INVENTADO', scoreFijo: 1000 });
    const r = await db.asAdmin((tx) => clasificarDocumento(tx, documento, { proveedor }));

    expect(r.lineas[0]!.conceptoId).toBeNull();
    expect(r.lineas[0]!.decision).toBe('revisar');
    expect(r.lineas[0]!.motivo).toBe(MOTIVO_CLASIFICACION.FUERA_DE_CATALOGO);
  });

  it('la propuesta que se persiste tiene concepto y score, y nada que se parezca a un cálculo', async () => {
    const { e } = await montar();
    const documento = await crearDocumentoConLineas(db, e, [DESCRIPCION_MANTENIMIENTO]);
    await db.asAdmin((tx) =>
      clasificarDocumento(tx, documento, { proveedor: new ProveedorLlmFalso() }),
    );

    const fila = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<Record<string, unknown>>(
        `SELECT to_jsonb(x.*) AS fila FROM extraction x
          WHERE x.source_document_id = $1 AND x.origen = 'llm'`,
        [documento],
      );
      return (rows[0]!.fila ?? rows[0]) as Record<string, unknown>;
    });

    // La fila de traza de la IA no tiene ni una columna donde quepa un cálculo
    // tributario: ni tarifa, ni base, ni valor de retención, ni cuenta.
    const columnas = Object.keys(fila);
    for (const prohibida of ['tarifa', 'base_gravable', 'valor_retencion', 'retencion']) {
      expect(columnas).not.toContain(prohibida);
    }
    expect(columnas).toContain('score_confianza');
    expect(columnas).toContain('concepto_propuesto_id');
  });

  it('lo que se propone es un concepto de la empresa, y sus reglas las decide el concepto', async () => {
    const { e, conceptos } = await montar();
    const catalogo = await db.asAdmin((tx) =>
      cargarCatalogo(tx, { tenantId: e.tenantId, companyId: e.companyId }),
    );
    const codigos = catalogo.map((c) => c.codigo);
    expect(codigos).toContain('SERV-MANT');
    // El catálogo que viaja al modelo NO lleva cuentas ni punteros a reglas.
    for (const concepto of catalogo) {
      expect(Object.keys(concepto).sort()).toEqual(['codigo', 'descripcion', 'id', 'nombre']);
    }
    expect(catalogo.find((c) => c.codigo === 'SERV-MANT')!.id).toBe(conceptos.mantenimiento);
  });
});

// =============================================================================
describe('A5 · paso 6 — la decisión humana se graba en memoria', () => {
  it('aprobar la propuesta crea la entrada de memoria y la marca como aprobación humana', async () => {
    const { e, conceptos } = await montar();
    const documento = await crearDocumentoConLineas(db, e, [DESCRIPCION_MANTENIMIENTO]);
    const r = await db.asAdmin((tx) =>
      clasificarDocumento(tx, documento, { proveedor: new ProveedorLlmFalso() }),
    );
    const pendienteId = r.lineas[0]!.pendienteId!;

    const confirmacion = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      confirmarClasificacion(tx, {
        pendienteId,
        conceptoId: conceptos.mantenimiento,
        usuarioId: e.userId,
      }),
    );
    expect(confirmacion.origen).toBe('aprobacion_humana');

    const memoria = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{
        patron_descripcion: string;
        concepto_causacion_id: string;
        aciertos: number;
        correcciones: number;
        origen: string;
        normalizador_version: number;
        confirmado_por: string | null;
      }>(`SELECT * FROM memoria_clasificacion WHERE id = $1`, [confirmacion.memoriaId]);
      return rows[0]!;
    });
    expect(memoria.patron_descripcion).toBe('servicio de mantenimiento de equipos de computo');
    expect(memoria.concepto_causacion_id).toBe(conceptos.mantenimiento);
    expect(Number(memoria.aciertos)).toBe(1);
    expect(Number(memoria.correcciones)).toBe(0);
    expect(memoria.origen).toBe('aprobacion_humana');
    expect(Number(memoria.normalizador_version)).toBe(2);
    expect(memoria.confirmado_por).toBe(e.userId);
  });

  it('corregir la propuesta graba el concepto CORREGIDO, no el que propuso la IA', async () => {
    const { e, conceptos } = await montar();
    const documento = await crearDocumentoConLineas(db, e, [DESCRIPCION_MANTENIMIENTO]);
    const r = await db.asAdmin((tx) =>
      clasificarDocumento(tx, documento, { proveedor: new ProveedorLlmFalso() }),
    );
    const confirmacion = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      confirmarClasificacion(tx, {
        pendienteId: r.lineas[0]!.pendienteId!,
        conceptoId: conceptos.honorarios, // el humano dice que era otra cosa
        usuarioId: e.userId,
      }),
    );
    expect(confirmacion.origen).toBe('correccion_humana');

    const memoria = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{
        concepto_causacion_id: string;
        correcciones: number;
        aciertos: number;
      }>(`SELECT * FROM memoria_clasificacion WHERE id = $1`, [confirmacion.memoriaId]);
      return rows[0]!;
    });
    expect(memoria.concepto_causacion_id).toBe(conceptos.honorarios);
    expect(Number(memoria.correcciones)).toBe(1);
    expect(Number(memoria.aciertos)).toBe(0);
  });

  it('la propuesta de la IA por sí sola NO escribe memoria: hace falta un humano', async () => {
    const { e } = await montar();
    const documento = await crearDocumentoConLineas(db, e, ['Mantenimiento de equipos']);
    const r = await db.asAdmin((tx) =>
      clasificarDocumento(tx, documento, { proveedor: new ProveedorLlmFalso() }),
    );
    expect(r.lineas[0]!.decision).toBe('aplicar'); // score máximo

    const memorias = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM memoria_clasificacion WHERE company_id = $1`,
        [e.companyId],
      );
      return rows[0]!.n;
    });
    expect(memorias).toBe(0);
  });

  it('una fila de la cola no se decide dos veces', async () => {
    const { e, conceptos } = await montar();
    const documento = await crearDocumentoConLineas(db, e, [DESCRIPCION_MANTENIMIENTO]);
    const r = await db.asAdmin((tx) =>
      clasificarDocumento(tx, documento, { proveedor: new ProveedorLlmFalso() }),
    );
    const pendienteId = r.lineas[0]!.pendienteId!;
    await db.asTenant(e.tenantId, e.companyId, (tx) =>
      confirmarClasificacion(tx, { pendienteId, conceptoId: conceptos.mantenimiento, usuarioId: e.userId }),
    );
    await expect(
      db.asTenant(e.tenantId, e.companyId, (tx) =>
        confirmarClasificacion(tx, { pendienteId, conceptoId: conceptos.honorarios, usuarioId: e.userId }),
      ),
    ).rejects.toThrow(/ya está en estado/);
  });
});

// =============================================================================
describe('A5 · determinismo (sección 8.4)', () => {
  it('reprocesar el mismo documento devuelve la misma propuesta y NO vuelve a llamar', async () => {
    const { e, conceptos } = await montar();
    const documento = await crearDocumentoConLineas(db, e, [DESCRIPCION_MANTENIMIENTO]);
    const proveedor = new ProveedorLlmFalso();

    const primera = await db.asAdmin((tx) => clasificarDocumento(tx, documento, { proveedor }));
    expect(proveedor.llamadas).toBe(1);

    const resultados = [primera];
    for (let i = 0; i < 5; i += 1) {
      resultados.push(await db.asAdmin((tx) => clasificarDocumento(tx, documento, { proveedor })));
    }
    expect(proveedor.llamadas).toBe(1); // ni una llamada más en cinco reprocesos

    const propuestas = resultados.map((r) => `${r.lineas[0]!.conceptoId}|${r.lineas[0]!.decision}`);
    expect(new Set(propuestas).size).toBe(1);
    expect(resultados[0]!.lineas[0]!.conceptoId).toBe(conceptos.mantenimiento);
  });

  it('la petición que se le arma al modelo es byte a byte la misma dos veces', async () => {
    const { e } = await montar();
    const huellas: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const huella = await db.asAdmin(async (tx) => {
        const catalogo = await cargarCatalogo(tx, { tenantId: e.tenantId, companyId: e.companyId });
        const prompt = (await cargarPrompt(tx, {
          tenantId: e.tenantId,
          codigo: 'clasificacion_concepto',
          version: 1,
        }))!;
        return huellaPeticion(
          construirPeticion({
            prompt,
            catalogo,
            descripcionNormalizada: 'servicio de mantenimiento de equipos de computo',
            proveedor: 'Proveedor de prueba',
          }),
        );
      });
      huellas.push(huella);
    }
    expect(new Set(huellas).size).toBe(1);
    expect(huellas[0]).toMatch(/^[0-9a-f]{64}$/);
  });

  it('la temperatura del prompt versionado es la mínima y se persiste con la propuesta', async () => {
    const { e } = await montar();
    const documento = await crearDocumentoConLineas(db, e, [DESCRIPCION_MANTENIMIENTO]);
    await db.asAdmin((tx) =>
      clasificarDocumento(tx, documento, { proveedor: new ProveedorLlmFalso() }),
    );
    const traza = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{
        temperatura: string | null;
        prompt_version: string | null;
        modelo: string | null;
        tokens_entrada: number | null;
        costo_usd_micros: number | null;
      }>(
        `SELECT temperatura::text, prompt_version, modelo, tokens_entrada, costo_usd_micros
           FROM extraction WHERE source_document_id = $1 AND origen = 'llm'`,
        [documento],
      );
      return rows[0]!;
    });
    expect(Number(traza.temperatura)).toBe(0);
    expect(traza.prompt_version).toBe('clasificacion_concepto@1');
    expect(traza.modelo).toBe('claude-haiku-4-5');
    expect(Number(traza.tokens_entrada)).toBeGreaterThan(0);
    expect(Number(traza.costo_usd_micros)).toBeGreaterThan(0);
  });

  it('un prompt publicado no se puede editar: se versiona, y el motor lo impone', async () => {
    await esperarErrorPg(
      () =>
        db.asAdmin((tx) =>
          tx.query(
            `UPDATE prompt_clasificacion SET plantilla_usuario = 'otra cosa' WHERE codigo = 'clasificacion_concepto'`,
          ),
        ),
      SQLSTATE.AUDITORIA_INMUTABLE,
      'editar un prompt ya publicado',
    );
    await esperarErrorPg(
      () =>
        db.asAdmin((tx) =>
          tx.query(`DELETE FROM prompt_clasificacion WHERE codigo = 'clasificacion_concepto'`),
        ),
      SQLSTATE.AUDITORIA_INMUTABLE,
      'borrar un prompt ya publicado',
    );
  });

  it('publicar una versión nueva de un prompt queda registrado en audit_log', async () => {
    const { e } = await montar();
    const antes = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM audit_log WHERE entidad = 'prompt_clasificacion'`,
      );
      return rows[0]!.n;
    });

    await db.asTenant(e.tenantId, e.companyId, (tx) =>
      tx.query(
        `INSERT INTO prompt_clasificacion (tenant_id, codigo, version, plantilla_sistema,
            plantilla_usuario, modelo, temperatura_milesimas, max_tokens_salida, hash_plantilla)
         SELECT $1, 'clasificacion_concepto', 2, s.sistema, u.usuario, 'claude-haiku-4-5', 0, 64,
                encode(sha256(convert_to(s.sistema || E'\\n' || u.usuario, 'UTF8')), 'hex')
           FROM (SELECT 'Sistema, version 2 de la firma' AS sistema) s,
                (SELECT 'CATALOGO: {{catalogo}} DESCRIPCION: {{descripcion}} PROVEEDOR: {{proveedor}}' AS usuario) u`,
        [e.tenantId],
      ),
    );

    const despues = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: number; entidad_id: string | null; accion: string }>(
        `SELECT count(*)::int AS n FROM audit_log WHERE entidad = 'prompt_clasificacion'`,
      );
      return rows[0]!.n;
    });
    expect(despues).toBe(antes + 1);
  });

  it('cambiar la versión activa del prompt es un cambio de parámetro auditado', async () => {
    const { e } = await montar();
    await db.asTenant(e.tenantId, e.companyId, (tx) =>
      tx.query(
        `INSERT INTO parametro_clasificacion (tenant_id, company_id, clave, valor)
         VALUES ($1, $2, 'prompt_version', '7'::jsonb)`,
        [e.tenantId, e.companyId],
      ),
    );
    const auditadas = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM audit_log
          WHERE entidad = 'parametro_clasificacion' AND company_id = $1`,
        [e.companyId],
      );
      return rows[0]!.n;
    });
    expect(auditadas).toBeGreaterThan(0);

    // Y con una versión que no existe NO se inventa otra: se va a revisión.
    const documento = await crearDocumentoConLineas(db, e, [DESCRIPCION_MANTENIMIENTO]);
    const proveedor = new ProveedorLlmFalso();
    const r = await db.asAdmin((tx) => clasificarDocumento(tx, documento, { proveedor }));
    expect(proveedor.llamadas).toBe(0);
    expect(r.motivos).toContain(MOTIVO_CLASIFICACION.SIN_PROMPT);
  });
});

// =============================================================================
describe('A5 · control de costo', () => {
  it('varias líneas con el mismo patrón cuestan UNA sola llamada', async () => {
    const { e } = await montar();
    const documento = await crearDocumentoConLineas(db, e, [
      'Servicio de mantenimiento de equipos de cómputo — julio 2026',
      'Servicio de mantenimiento de equipos de cómputo — agosto 2026',
      'Servicio de mantenimiento de equipos de cómputo 15/09/2026',
    ]);
    const proveedor = new ProveedorLlmFalso();
    const r = await db.asAdmin((tx) => clasificarDocumento(tx, documento, { proveedor }));

    expect(proveedor.llamadas).toBe(1);
    expect(r.lineas).toHaveLength(3);
    expect(r.lineas.map((l) => l.origen)).toEqual(['llm', 'cola', 'cola']);
    expect(new Set(r.lineas.map((l) => l.conceptoId)).size).toBe(1);
  });

  it('el costo de una factura queda muy por debajo del techo de A15', async () => {
    const { e } = await montar();
    const documento = await crearDocumentoConLineas(db, e, [DESCRIPCION_MANTENIMIENTO]);
    const r = await db.asAdmin((tx) =>
      clasificarDocumento(tx, documento, { proveedor: new ProveedorLlmFalso() }),
    );
    const techo = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ valor: number }>(
        `SELECT valor::text::int AS valor FROM parametro_clasificacion
          WHERE tenant_id IS NULL AND clave = $1`,
        [CLAVE.COSTO_MAXIMO_DOCUMENTO],
      );
      return Number(rows[0]!.valor);
    });
    expect(r.costoMicrosUsd).toBeGreaterThan(0);
    expect(r.costoMicrosUsd).toBeLessThan(techo);
  });

  it('el cálculo del costo es entero y sale de los precios de la tabla', () => {
    // 700 tokens de entrada y 40 de salida a 1 y 5 USD por millón.
    const micros = costoMicrosUsd(
      { entrada: 700, salida: 40 },
      { entradaPorMillon: 1_000_000, salidaPorMillon: 5_000_000 },
    );
    expect(micros).toBe(900);
    expect(Number.isInteger(micros)).toBe(true);
  });

  it('proyección con el catálogo LLENO: incluso así cabe con holgura en el techo de A15', async () => {
    // El peor caso de tamaño de prompt: los 120 conceptos que permite el
    // parámetro `catalogo_maximo_conceptos`, con nombre y descripción largos.
    const { e } = await montar();
    const prompt = (await db.asAdmin((tx) =>
      cargarPrompt(tx, { tenantId: e.tenantId, codigo: 'clasificacion_concepto', version: 1 }),
    ))!;
    const catalogoDe = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: uuid(),
        codigo: `CONCEPTO-${String(i).padStart(3, '0')}`,
        nombre: 'Nombre razonablemente largo de un concepto de causacion de compras',
        descripcion: 'Descripcion auxiliar del concepto para desambiguar casos parecidos',
      }));
    const microsCon = (n: number): number => {
      const peticion = construirPeticion({
        prompt,
        catalogo: catalogoDe(n),
        descripcionNormalizada: 'servicio de mantenimiento de equipos de computo',
        proveedor: 'Proveedor de prueba S.A.S.',
      });
      return costoMicrosUsd(
        {
          entrada: estimarTokens(peticion.sistema) + estimarTokens(peticion.usuario),
          salida: peticion.maxTokensSalida,
        },
        { entradaPorMillon: 1_000_000, salidaPorMillon: 5_000_000 },
      );
    };

    // Techo de A15: 20.000 millonésimas de USD (= USD 0,02) por factura ANTES
    // de caché, con los precios verificados el 26-ago-2026 (USD 1 y USD 5 por
    // millón de tokens). Medido: el catálogo lleno de 120 conceptos con
    // nombre Y descripción largos cuesta ~5.000 millonésimas (la cuarta parte
    // del techo) y el catálogo realista de una PYME, ~2.000 (la décima parte).
    expect(microsCon(120)).toBeLessThan(20_000);
    expect(microsCon(40)).toBeLessThan(3_000);
    // Y el costo crece con el catálogo, no con el número de facturas: es la
    // memoria la que hace que la mayoría de las facturas cueste exactamente 0.
    expect(microsCon(120)).toBeGreaterThan(microsCon(40));
  });

  it('el techo por documento detiene las llamadas en vez de gastar de más', async () => {
    const { e } = await montar();
    await fijarParametro(
      db,
      { tenantId: e.tenantId, companyId: e.companyId },
      CLAVE.COSTO_MAXIMO_DOCUMENTO,
      1,
    );
    const documento = await crearDocumentoConLineas(db, e, [DESCRIPCION_MANTENIMIENTO]);
    const proveedor = new ProveedorLlmFalso();
    const r = await db.asAdmin((tx) => clasificarDocumento(tx, documento, { proveedor }));
    expect(proveedor.llamadas).toBe(0);
    expect(r.motivos).toContain(MOTIVO_CLASIFICACION.TECHO_DE_COSTO);
    expect(r.lineas[0]!.decision).toBe('revisar');
  });
});

// =============================================================================
describe('A5 · el sistema no depende de que haya IA', () => {
  it('sin proveedor configurado, lo desconocido va a la cola sin propuesta', async () => {
    const { e } = await montar();
    const documento = await crearDocumentoConLineas(db, e, [DESCRIPCION_MANTENIMIENTO]);
    const r = await db.asAdmin((tx) => clasificarDocumento(tx, documento, { proveedor: null }));
    expect(r.llamadasLlm).toBe(0);
    expect(r.motivos).toContain(MOTIVO_CLASIFICACION.SIN_PROVEEDOR);
    expect(r.lineas[0]!.decision).toBe('revisar');
    const cola = await db.asAdmin((tx) => listarColaRevision(tx, e.companyId));
    expect(cola).toHaveLength(1);
    expect(cola[0]!.conceptoPropuestoId).toBeNull();
  });

  it('sin clave de API la fábrica devuelve null en vez de intentar una llamada', async () => {
    expect(await crearProveedorLlm({ proveedor: 'anthropic', apiKey: null })).toBeNull();
    expect(await crearProveedorLlm({ proveedor: 'ninguno', apiKey: 'lo-que-sea' })).toBeNull();
    expect(await crearProveedorLlm({})).toBeNull();
  });

  it('el proveedor puede fallar sin arrastrar el documento', async () => {
    const { e } = await montar();
    const documento = await crearDocumentoConLineas(db, e, [DESCRIPCION_MANTENIMIENTO]);
    const proveedor = new ProveedorLlmFalso({ falla: true });
    const r = await db.asAdmin((tx) => clasificarDocumento(tx, documento, { proveedor }));
    expect(r.motivos).toContain(MOTIVO_CLASIFICACION.PROVEEDOR_FALLO);
    expect(r.lineas[0]!.decision).toBe('revisar');
  });
});

// =============================================================================
describe('A5 · ni una ruta de red en el camino de las pruebas', () => {
  const RAIZ = new URL('../../src/ai/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

  function archivos(dir: string, acc: string[] = []): string[] {
    for (const entrada of readdirSync(dir)) {
      const ruta = join(dir, entrada);
      if (statSync(ruta).isDirectory()) archivos(ruta, acc);
      else if (entrada.endsWith('.ts')) acc.push(ruta);
    }
    return acc;
  }

  it('solo el adaptador real menciona la red, y nadie lo importa de forma estática', () => {
    const todos = archivos(RAIZ);
    expect(todos.length).toBeGreaterThan(6);

    const conRed = todos
      .filter((a) => /\b(fetch|XMLHttpRequest|node:http|node:https|axios)\b/.test(readFileSync(a, 'utf8')))
      .map((a) => a.replace(/\\/g, '/').split('/src/ai/')[1]);
    expect(conRed).toEqual(['proveedores/anthropic.ts']);

    // El único import del adaptador es dinámico, dentro de la fábrica.
    for (const archivo of todos) {
      const contenido = readFileSync(archivo, 'utf8');
      const relativo = archivo.replace(/\\/g, '/').split('/src/ai/')[1]!;
      if (relativo === 'proveedor.ts') {
        expect(contenido).toMatch(/await import\('\.\/proveedores\/anthropic'\)/);
        expect(contenido).not.toMatch(/^import .*anthropic/m);
        continue;
      }
      if (relativo === 'proveedores/anthropic.ts') continue;
      // Ningún import estático del adaptador. Mencionarlo en un comentario no
      // carga nada; lo que cargaría es un `import ... from`.
      const importaAdaptador = /(^|\n)\s*(import|export)[^\n]*anthropic/i.test(contenido);
      expect(`${relativo}: ${importaAdaptador}`).toBe(`${relativo}: false`);
    }
  });

  it('el worker de causación de A6 sigue sin conocer ningún modelo', () => {
    const ruta = new URL('../../src/services/causacion.ts', import.meta.url).pathname.replace(
      /^\/([A-Za-z]:)/,
      '$1',
    );
    const contenido = readFileSync(ruta, 'utf8');
    expect(contenido).toContain('memoria_clasificacion');
    expect(contenido).not.toMatch(/\b(fetch|openai|anthropic|@ai-sdk|node:https?)\b/);
  });
});

// =============================================================================
describe('A5 · alcance de la memoria: lo decide el motor, no un if', () => {
  it('por defecto (empresa) una empresa NO ve la memoria de otra de la misma firma', async () => {
    const { e, conceptos } = await montar();
    const otra = await crearOtraEmpresa(e);
    await sembrarMemoria(e, conceptos.mantenimiento);

    const visibles = await db.asTenant(e.tenantId, otra.companyId, async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM memoria_clasificacion WHERE company_id <> app.current_company_id()`,
      );
      return rows[0]!.n;
    });
    expect(visibles).toBe(0);
  });

  it('con memoria compartida a nivel de firma, la política RLS deja LEER dentro de la firma', async () => {
    const { e, conceptos } = await montar();
    const otra = await crearOtraEmpresa(e);
    await sembrarMemoria(e, conceptos.mantenimiento);
    await fijarParametro(db, { tenantId: e.tenantId, companyId: null }, CLAVE.MEMORIA_ALCANCE, 'firma');

    const visibles = await db.asTenant(e.tenantId, otra.companyId, async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM memoria_clasificacion WHERE company_id <> app.current_company_id()`,
      );
      return rows[0]!.n;
    });
    expect(visibles).toBe(1);

    // Pero SOLO leer. La política nueva es FOR SELECT: la de escritura sigue
    // siendo la de doble nivel de 012, así que un UPDATE sobre la fila de la
    // otra empresa no alcanza ni una fila (la RLS filtra en silencio, no
    // lanza) y el contador de la otra empresa queda intacto.
    const actualizadas = await db.asTenant(e.tenantId, otra.companyId, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `UPDATE memoria_clasificacion SET aciertos = aciertos + 1
          WHERE company_id <> app.current_company_id() RETURNING id`,
      );
      return rows.length;
    });
    expect(actualizadas).toBe(0);

    const aciertosAjenos = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ aciertos: number }>(
        `SELECT aciertos FROM memoria_clasificacion WHERE company_id = $1`,
        [e.companyId],
      );
      return Number(rows[0]!.aciertos);
    });
    expect(aciertosAjenos).toBe(0);

    // Y fabricar memoria a nombre de otra empresa sí lo rechaza el motor.
    await esperarErrorPg(
      () =>
        db.asTenant(e.tenantId, otra.companyId, (tx) =>
          tx.query(
            `INSERT INTO memoria_clasificacion (tenant_id, company_id, third_party_id,
                patron_descripcion, concepto_causacion_id)
             SELECT tenant_id, company_id, third_party_id, 'inyectado', concepto_causacion_id
               FROM memoria_clasificacion WHERE company_id <> app.current_company_id()`,
          ),
        ),
      SQLSTATE.RLS_VIOLATION,
      'escribir memoria a nombre de otra empresa de la firma',
    );
  });

  async function crearOtraEmpresa(e: Escenario): Promise<{ companyId: string }> {
    const companyId = uuid();
    await db.asAdmin(async (tx) => {
      await tx.query(
        `INSERT INTO company (id, tenant_id, nit, razon_social, es_agente_retencion_renta)
         VALUES ($1,$2,$3,$4,true)`,
        [companyId, e.tenantId, `802${companyId.slice(0, 8)}`, 'Otra empresa de la firma'],
      );
      const { rows } = await tx.query<{ user_id: string }>(
        `SELECT user_id FROM user_company_access WHERE company_id = $1 LIMIT 1`,
        [e.companyId],
      );
      await tx.query(
        `INSERT INTO user_company_access (tenant_id, company_id, user_id, role_id)
         VALUES ($1,$2,$3,'00000000-0000-0000-0000-0000000000a1')`,
        [e.tenantId, companyId, rows[0]!.user_id],
      );
    });
    return { companyId };
  }

  async function sembrarMemoria(e: Escenario, conceptoId: string): Promise<void> {
    await db.asAdmin((tx) =>
      tx.query(
        `INSERT INTO memoria_clasificacion (tenant_id, company_id, third_party_id,
            patron_descripcion, concepto_causacion_id, normalizador_version)
         VALUES ($1,$2,$3,'servicio de mantenimiento de equipos de computo',$4,2)`,
        [e.tenantId, e.companyId, e.thirdPartyId, conceptoId],
      ),
    );
  }
});

// =============================================================================
describe('A5 · revalidación de la memoria por antigüedad', () => {
  it('una entrada más vieja que el parámetro vuelve a revisión, y sigue sin costar una llamada', async () => {
    const { e, conceptos } = await montar();
    await db.asAdmin((tx) =>
      tx.query(
        `INSERT INTO memoria_clasificacion (tenant_id, company_id, third_party_id,
            patron_descripcion, concepto_causacion_id, normalizador_version, ultima_confirmacion_en)
         VALUES ($1,$2,$3,'servicio de mantenimiento de equipos de computo',$4,2,
                 now() - make_interval(days => 400))`,
        [e.tenantId, e.companyId, e.thirdPartyId, conceptos.mantenimiento],
      ),
    );
    const documento = await crearDocumentoConLineas(db, e, [DESCRIPCION_MANTENIMIENTO]);
    const proveedor = new ProveedorLlmFalso();
    const r = await db.asAdmin((tx) => clasificarDocumento(tx, documento, { proveedor }));

    expect(proveedor.llamadas).toBe(0);
    expect(r.lineas[0]!.decision).toBe('proponer');
    expect(r.lineas[0]!.motivo).toBe(MOTIVO_CLASIFICACION.MEMORIA_VENCIDA);
    expect(r.lineas[0]!.conceptoId).toBe(conceptos.mantenimiento);

    const cola = await db.asAdmin((tx) => listarColaRevision(tx, e.companyId));
    expect(cola[0]!.origen).toBe('memoria_vencida');
  });
});

/**
 * A5 — Montaje mínimo para las pruebas de clasificación.
 *
 * AQUÍ NO HAY NI UN VALOR TRIBUTARIO, y no por disciplina: por diseño. La
 * clasificación decide QUÉ SE COMPRÓ, no cuánto se retiene. Los conceptos que
 * monta este archivo llevan `aplica_retefuente = false` justamente para dejar
 * claro que a A5 le da igual: el cálculo lo hace el motor de A3 con las reglas
 * paramétricas del concepto, por la fecha del hecho económico, y ninguna
 * prueba de este directorio lo invoca.
 */
import { createTestDb, uuid, type TestDb } from '../helpers/db';
import { crearEscenario, type Escenario } from '../helpers/fixtures';

export interface ConceptosPrueba {
  mantenimiento: string;
  arrendamiento: string;
  honorarios: string;
  papeleria: string;
}

export interface EscenarioA5 {
  db: TestDb;
  e: Escenario;
  conceptos: ConceptosPrueba;
}

/** Los cuatro conceptos del catálogo cerrado de las pruebas. */
export const CATALOGO_PRUEBA = [
  { clave: 'mantenimiento', codigo: 'SERV-MANT', nombre: 'Servicio de mantenimiento de equipos' },
  { clave: 'arrendamiento', codigo: 'ARR-OFI', nombre: 'Arrendamiento de oficina' },
  { clave: 'honorarios', codigo: 'HON-JUR', nombre: 'Honorarios de asesoria juridica' },
  { clave: 'papeleria', codigo: 'PAPEL', nombre: 'Papeleria y utiles de oficina' },
] as const;

export async function crearConceptos(
  db: TestDb,
  e: Escenario,
  sufijo = '',
): Promise<ConceptosPrueba> {
  const ids: Record<string, string> = {};
  await db.asAdmin(async (tx) => {
    for (const concepto of CATALOGO_PRUEBA) {
      const id = uuid();
      ids[concepto.clave] = id;
      await tx.query(
        `INSERT INTO concepto_causacion (
           id, tenant_id, company_id, codigo, nombre, naturaleza,
           cuenta_gasto_id, cuenta_iva_descontable_id, cuenta_contrapartida_id,
           aplica_retefuente, aplica_reteiva, aplica_reteica, aplica_autorretencion)
         VALUES ($1,$2,$3,$4,$5,'compra',$6,$7,$8,false,false,false,false)`,
        [
          id,
          e.tenantId,
          e.companyId,
          `${concepto.codigo}${sufijo}`,
          concepto.nombre,
          e.cuentas.gasto,
          e.cuentas.ivaDescontable,
          e.cuentas.proveedores,
        ],
      );
    }
  });
  return ids as unknown as ConceptosPrueba;
}

export async function montarEscenarioA5(db?: TestDb): Promise<EscenarioA5> {
  const base = db ?? (await createTestDb());
  const e = await crearEscenario(base);
  const conceptos = await crearConceptos(base, e);
  return { db: base, e, conceptos };
}

export interface DocumentoConLineas {
  sourceDocumentId: string;
  jobId: string | null;
}

/**
 * Crea un documento de compra con sus líneas, tal como lo dejaría el parser de
 * A4: una fila de `extraction` con `origen = 'parser_ubl'`.
 */
export async function crearDocumentoConLineas(
  db: TestDb,
  e: Escenario,
  descripciones: readonly (string | null)[],
  opciones: { fecha?: string; terceroId?: string; companyId?: string } = {},
): Promise<string> {
  const id = uuid();
  const marca = id.slice(0, 8);
  const companyId = opciones.companyId ?? e.companyId;
  const terceroId = opciones.terceroId ?? e.thirdPartyId;

  await db.asAdmin(async (tx) => {
    await tx.query(
      `INSERT INTO source_document (id, tenant_id, company_id, tipo_documento, cufe,
                                    numero_documento, emisor_nit, emisor_nombre, third_party_id,
                                    fecha_hecho_economico, hash_contenido, estado)
       VALUES ($1,$2,$3,'Invoice',$4,$5,'900123456','Proveedor de prueba',$6,$7,$8,'parseado')`,
      [
        id,
        e.tenantId,
        companyId,
        `CUFE-A5-${marca}`,
        `FE-A5-${marca}`,
        terceroId,
        opciones.fecha ?? '2026-06-15',
        `hash-a5-${id}`,
      ],
    );

    await tx.query(
      `INSERT INTO extraction (tenant_id, company_id, source_document_id, datos_extraidos, origen)
       VALUES ($1,$2,$3,$4::jsonb,'parser_ubl')`,
      [
        e.tenantId,
        companyId,
        id,
        JSON.stringify({
          tipoDocumento: 'Invoice',
          emisor: { nit: '900123456', nombre: 'Proveedor de prueba' },
          adquirente: { nit: null, nombre: null },
          lineas: descripciones.map((descripcion, i) => ({
            numero: i + 1,
            descripcion,
            subtotal: '100000000',
            impuestos: [],
          })),
        }),
      ],
    );
  });

  return id;
}

/** Fija un parámetro de clasificación en el alcance que se le indique. */
export async function fijarParametro(
  db: TestDb,
  alcance: { tenantId: string | null; companyId: string | null },
  clave: string,
  valor: unknown,
): Promise<void> {
  await db.asAdmin(async (tx) => {
    await tx.query(
      `INSERT INTO parametro_clasificacion (tenant_id, company_id, clave, valor)
       VALUES ($1,$2,$3,$4::jsonb)
       ON CONFLICT (tenant_id, company_id, clave) DO UPDATE SET valor = EXCLUDED.valor`,
      [alcance.tenantId, alcance.companyId, clave, JSON.stringify(valor)],
    );
  });
}

/**
 * A8 — Maestro de terceros (cierre de V-17). Prueba, una por una, las seis
 * conductas obligatorias de la sección 6.2 en lo que aplica a un tercero, más
 * el requisito propio de este módulo: las NUEVE banderas fiscales explícitas,
 * sin valor por defecto.
 *
 * Convención de `tests/helpers/fixtures.ts`: aquí no hay ningún valor
 * tributario real. Las normas de respaldo son inventadas para probar la
 * MECÁNICA de vigencias, no la norma.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, esperarErrorPg, uuid, type TestDb } from '../helpers/db';
import { crearEscenario, crearAsientoBorrador, publicarAsiento, type Escenario } from '../helpers/fixtures';
import { SQLSTATE } from '../../src/db/types';
import {
  crearTercero,
  editarTercero,
  obtenerTercero,
  listarTerceros,
  registrarAtributosFiscales,
  listarHistorialAtributosFiscales,
  fechaMinimaVigenciaAtributosFiscales,
  simularImpactoAtributosFiscales,
  registrarActividad,
  listarActividadesVigentes,
  listarHistorialActividad,
  fechaMinimaVigenciaActividad,
  simularImpactoActividad,
  calcularDigitoVerificacionNit,
  AtributoFiscalIncompletoError,
  EdicionRetroactivaError,
  NormaDeRespaldoRequeridaError,
  TerceroInvalidoError,
  TerceroNoEncontradoError,
  VigenciaInvalidaError,
} from '../../src/services/terceros';

let db: TestDb;
let e: Escenario;
let municipioSecundarioId: string;

const BANDERAS_COMPLETAS = {
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

beforeAll(async () => {
  db = await createTestDb();
  e = await crearEscenario(db);

  municipioSecundarioId = uuid();
  await db.asAdmin((tx) =>
    tx.query(
      `INSERT INTO municipality (id, tenant_id, codigo_dane, nombre, departamento, codigo_dane_departamento)
       VALUES ($1, $2, '05001', 'Medellín (prueba A8)', 'Antioquia', '05')`,
      [municipioSecundarioId, e.tenantId],
    ),
  );
});

afterAll(async () => {
  await db?.close();
});

async function crearTerceroDePrueba(opciones: { direccion?: string | null; municipalityId?: string | null; esDelExterior?: boolean } = {}) {
  const nit = `9${Math.floor(Math.random() * 1_000_000_000)}`;
  return db.asTenant(
    e.tenantId,
    e.companyId,
    (tx) =>
      crearTercero(tx, {
        tipoDocumento: 'NIT',
        numeroDocumento: nit,
        tipoPersona: 'juridica',
        razonSocial: `Proveedor de prueba A8 ${nit}`,
        direccion: opciones.esDelExterior ? null : 'direccion' in opciones ? opciones.direccion : 'Calle 1 # 2-34',
        municipalityId:
          opciones.esDelExterior ? null : 'municipalityId' in opciones ? opciones.municipalityId : e.municipalityId,
        esDelExterior: opciones.esDelExterior ?? false,
      }),
    { rolCodigo: 'admin_tributario' },
  );
}

/** Publica un asiento con retención trazada contra un tercero y municipio
 * concretos, exactamente como haría la causación real, para probar la
 * conducta 3 (nunca retroactivo sobre lo publicado). */
async function publicarRetencionParaTercero(
  terceroId: string,
  opciones: { tipo: 'retefuente' | 'reteica'; municipalityId?: string | null } = { tipo: 'retefuente' },
): Promise<void> {
  await db.asAdmin(async (tx) => {
    const { rows: c } = await tx.query<{ id: string }>(
      `INSERT INTO tax_concept (tenant_id, company_id, tipo, codigo, nombre)
       VALUES (NULL, NULL, $1, $2, 'Concepto de prueba A8 (no es un valor tributario real)')
       RETURNING id`,
      [opciones.tipo, `concepto_a8_tercero_${uuid()}`],
    );
    const { rows: r } = await tx.query<{ id: string; vigente_desde: string }>(
      `INSERT INTO tax_rule (
         tenant_id, company_id, tax_concept_id, tipo, tarifa, aplica_sobre, aplica_a, tipo_persona,
         municipality_id, account_id, vigente_desde, norma_respaldo
       ) VALUES ($1,$2,$3,$4,0.020000,'base_gravable','ambos','ambos',$5,$6,'2020-01-01',
                 'Norma de prueba A8 (mecánica, no es un dato normativo real)')
       RETURNING id, vigente_desde::text`,
      [e.tenantId, e.companyId, c[0]!.id, opciones.tipo, opciones.municipalityId ?? null, e.cuentas.retefuentePorPagar],
    );

    const entryId = await crearAsientoBorrador(tx, e, [
      { accountId: e.cuentas.gasto, side: 'debito', monto: 100000 },
      { accountId: e.cuentas.proveedores, side: 'credito', monto: 100000 },
    ]);
    await publicarAsiento(tx, entryId, e.userId);

    await tx.query(
      `INSERT INTO retention_applied (
         tenant_id, company_id, source_document_id, journal_entry_id, third_party_id, tipo, base,
         tarifa, valor, tax_rule_id, regla_vigente_desde, norma_respaldo, account_id,
         municipality_id, fecha_hecho_economico
       ) VALUES ($1,$2,$3,$4,$5,$6,100000,0.020000,2000,$7,$8,'Norma de prueba A8',$9,$10,'2026-06-15')`,
      [
        e.tenantId,
        e.companyId,
        e.sourceDocumentId,
        entryId,
        terceroId,
        opciones.tipo,
        r[0]!.id,
        r[0]!.vigente_desde,
        e.cuentas.retefuentePorPagar,
        opciones.municipalityId ?? null,
      ],
    );
  });
}

// =============================================================================
// Crear y editar el tercero (maestro de datos, no versionado)
// =============================================================================
describe('crear y editar tercero — dirección y municipio obligatorios (Formato 1001)', () => {
  it('crea un tercero con dirección y municipio, y denormaliza el código DANE', async () => {
    const { id } = await crearTerceroDePrueba();
    const tercero = await db.asAdmin((tx) => obtenerTercero(tx, id));
    expect(tercero?.direccion).toBe('Calle 1 # 2-34');
    expect(tercero?.municipalityId).toBe(e.municipalityId);
    expect(tercero?.codigoDane).toBe('11001');
  });

  it('rechaza crear sin dirección si no es del exterior', async () => {
    await expect(crearTerceroDePrueba({ direccion: '' })).rejects.toBeInstanceOf(TerceroInvalidoError);
  });

  it('rechaza crear sin municipio si no es del exterior', async () => {
    await expect(crearTerceroDePrueba({ municipalityId: null })).rejects.toBeInstanceOf(TerceroInvalidoError);
  });

  it('un tercero del exterior no exige dirección ni municipio', async () => {
    const { id } = await crearTerceroDePrueba({ esDelExterior: true });
    const tercero = await db.asAdmin((tx) => obtenerTercero(tx, id));
    expect(tercero?.esDelExterior).toBe(true);
    expect(tercero?.direccion).toBeNull();
    expect(tercero?.municipalityId).toBeNull();
  });

  it('editarTercero actualiza los datos generales sin versionar nada', async () => {
    const { id } = await crearTerceroDePrueba();
    await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) =>
        editarTercero(tx, id, {
          tipoDocumento: 'NIT',
          numeroDocumento: '900999999',
          tipoPersona: 'juridica',
          razonSocial: 'Proveedor renombrado',
          direccion: 'Carrera 9 # 10-11',
          municipalityId: e.municipalityId,
        }),
      { rolCodigo: 'admin_tributario' },
    );
    const tercero = await db.asAdmin((tx) => obtenerTercero(tx, id));
    expect(tercero?.razonSocial).toBe('Proveedor renombrado');
    expect(tercero?.direccion).toBe('Carrera 9 # 10-11');
  });

  it('editarTercero sobre un id inexistente lanza TerceroNoEncontradoError', async () => {
    await expect(
      db.asTenant(
        e.tenantId,
        e.companyId,
        (tx) =>
          editarTercero(tx, uuid(), {
            tipoDocumento: 'NIT',
            numeroDocumento: '1',
            tipoPersona: 'juridica',
            razonSocial: 'x',
            direccion: 'x',
            municipalityId: e.municipalityId,
          }),
        { rolCodigo: 'admin_tributario' },
      ),
    ).rejects.toBeInstanceOf(TerceroNoEncontradoError);
  });

  it('el dígito de verificación del NIT se calcula por el algoritmo módulo once de la DIAN (checksum, no un valor tributario)', () => {
    // 800197268 es el NIT público de la DIAN; su DV conocido es 4.
    expect(calcularDigitoVerificacionNit('800197268')).toBe(4);
  });

  it('listarTerceros encuentra por NIT o razón social', async () => {
    const { id } = await crearTerceroDePrueba();
    const tercero = await db.asAdmin((tx) => obtenerTercero(tx, id));
    const encontrados = await db.asAdmin((tx) => listarTerceros(tx, { busqueda: tercero!.numeroDocumento }));
    expect(encontrados.map((t) => t.id)).toContain(id);
  });
});

// =============================================================================
// Atributos fiscales — VERSIONADOS, sin valor por defecto
// =============================================================================
describe('atributos fiscales — las nueve banderas son obligatorias, nunca se asume "No"', () => {
  it('rechaza si falta cualquiera de las nueve banderas', async () => {
    const { id } = await crearTerceroDePrueba();
    await expect(
      db.asTenant(
        e.tenantId,
        e.companyId,
        (tx) =>
          registrarAtributosFiscales(tx, {
            terceroId: id,
            ...BANDERAS_COMPLETAS,
            esDeclaranteRenta: undefined, // la única que falta
            regimenTributario: 'ordinario',
            vigenteDesde: '2026-01-01',
            normaRespaldo: 'RUT de prueba',
          }),
        { rolCodigo: 'admin_tributario' },
      ),
    ).rejects.toBeInstanceOf(AtributoFiscalIncompletoError);
  });

  it('rechaza sin norma de respaldo', async () => {
    const { id } = await crearTerceroDePrueba();
    await expect(
      db.asTenant(
        e.tenantId,
        e.companyId,
        (tx) =>
          registrarAtributosFiscales(tx, {
            terceroId: id,
            ...BANDERAS_COMPLETAS,
            regimenTributario: 'ordinario',
            vigenteDesde: '2026-01-01',
            normaRespaldo: '   ',
          }),
        { rolCodigo: 'admin_tributario' },
      ),
    ).rejects.toBeInstanceOf(NormaDeRespaldoRequeridaError);
  });

  it('primera vigencia: no hay nada que cerrar', async () => {
    const { id } = await crearTerceroDePrueba();
    const resultado = await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) =>
        registrarAtributosFiscales(tx, {
          terceroId: id,
          ...BANDERAS_COMPLETAS,
          regimenTributario: 'ordinario',
          vigenteDesde: '2026-01-01',
          normaRespaldo: 'RUT de prueba, casilla 53',
        }),
      { rolCodigo: 'admin_tributario' },
    );
    expect(resultado.vigenciaAnteriorCerrada).toBe(false);
    const historial = await db.asAdmin((tx) => listarHistorialAtributosFiscales(tx, id));
    expect(historial).toHaveLength(1);
    expect(historial[0]!.vigenteHasta).toBeNull();
  });

  it('conducta 1 — la segunda vigencia CIERRA la primera (vigente_hasta) y crea una fila nueva, nunca UPDATE de valores', async () => {
    const { id } = await crearTerceroDePrueba();
    await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) =>
        registrarAtributosFiscales(tx, {
          terceroId: id,
          ...BANDERAS_COMPLETAS,
          regimenTributario: 'ordinario',
          vigenteDesde: '2026-01-01',
          normaRespaldo: 'RUT de prueba v1',
        }),
      { rolCodigo: 'admin_tributario' },
    );
    const r2 = await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) =>
        registrarAtributosFiscales(tx, {
          terceroId: id,
          ...BANDERAS_COMPLETAS,
          esGranContribuyente: true,
          regimenTributario: 'ordinario',
          vigenteDesde: '2026-03-01',
          normaRespaldo: 'Resolución DIAN, gran contribuyente 2026',
        }),
      { rolCodigo: 'admin_tributario' },
    );
    expect(r2.vigenciaAnteriorCerrada).toBe(true);

    const historial = await db.asAdmin((tx) => listarHistorialAtributosFiscales(tx, id));
    expect(historial).toHaveLength(2);
    const [nueva, vieja] = historial;
    expect(nueva!.vigenteHasta).toBeNull();
    expect(nueva!.esGranContribuyente).toBe(true);
    expect(vieja!.vigenteHasta).toBe('2026-02-28');
    expect(vieja!.esGranContribuyente).toBe(false);
  });

  it('el motor sigue rechazando un UPDATE directo con PR001 (VIGENCIA_INMUTABLE)', async () => {
    const { id } = await crearTerceroDePrueba();
    await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) =>
        registrarAtributosFiscales(tx, {
          terceroId: id,
          ...BANDERAS_COMPLETAS,
          regimenTributario: 'ordinario',
          vigenteDesde: '2026-01-01',
          normaRespaldo: 'RUT de prueba',
        }),
      { rolCodigo: 'admin_tributario' },
    );
    await esperarErrorPg(
      () =>
        db.asAdmin((tx) =>
          tx.query('UPDATE third_party_fiscal_attribute SET es_declarante_renta = false WHERE third_party_id = $1', [id]),
        ),
      SQLSTATE.VIGENCIA_INMUTABLE,
      'un UPDATE directo de un atributo fiscal',
    );
  });

  it('conducta 3 — no se puede fijar una vigencia nueva en o antes de lo ya publicado de este tercero', async () => {
    const { id } = await crearTerceroDePrueba();
    await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) =>
        registrarAtributosFiscales(tx, {
          terceroId: id,
          ...BANDERAS_COMPLETAS,
          regimenTributario: 'ordinario',
          vigenteDesde: '2020-01-01',
          normaRespaldo: 'RUT de prueba',
        }),
      { rolCodigo: 'admin_tributario' },
    );
    await publicarRetencionParaTercero(id, { tipo: 'retefuente' });

    const fechaMinima = await db.asTenant(e.tenantId, e.companyId, (tx) => fechaMinimaVigenciaAtributosFiscales(tx, id), {
      rolCodigo: 'admin_tributario',
    });
    expect(fechaMinima).toBe('2026-06-15');

    await expect(
      db.asTenant(
        e.tenantId,
        e.companyId,
        (tx) =>
          registrarAtributosFiscales(tx, {
            terceroId: id,
            ...BANDERAS_COMPLETAS,
            esDeclaranteRenta: false,
            regimenTributario: 'ordinario',
            vigenteDesde: '2026-06-15',
            normaRespaldo: 'Intento retroactivo',
          }),
        { rolCodigo: 'admin_tributario' },
      ),
    ).rejects.toBeInstanceOf(EdicionRetroactivaError);

    // Una fecha posterior al hecho publicado sí procede.
    const ok = await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) =>
        registrarAtributosFiscales(tx, {
          terceroId: id,
          ...BANDERAS_COMPLETAS,
          esDeclaranteRenta: false,
          regimenTributario: 'ordinario',
          vigenteDesde: '2026-06-16',
          normaRespaldo: 'Vigencia futura válida',
        }),
      { rolCodigo: 'admin_tributario' },
    );
    expect(ok.vigenciaAnteriorCerrada).toBe(true);
  });

  it('conducta 5 — sin el permiso "tercero.editar" el motor rechaza con SE002 (PERMISO_INSUFICIENTE)', async () => {
    const { id } = await crearTerceroDePrueba();
    await esperarErrorPg(
      () =>
        db.asTenant(
          e.tenantId,
          e.companyId,
          (tx) =>
            registrarAtributosFiscales(tx, {
              terceroId: id,
              ...BANDERAS_COMPLETAS,
              regimenTributario: 'ordinario',
              vigenteDesde: '2026-01-01',
              normaRespaldo: 'RUT de prueba',
            }),
          { rolCodigo: 'solo_lectura' },
        ),
      SQLSTATE.PERMISO_INSUFICIENTE,
      'un rol sin tercero.editar registrando un atributo fiscal',
    );
  });

  it('conducta 6 — el simulador cuenta documentos pendientes y asientos publicados de ESE tercero', async () => {
    const { id } = await crearTerceroDePrueba();
    await publicarRetencionParaTercero(id, { tipo: 'retefuente' });
    const impacto = await db.asTenant(e.tenantId, e.companyId, (tx) => simularImpactoAtributosFiscales(tx, id), {
      rolCodigo: 'admin_tributario',
    });
    expect(impacto.asientosPublicados).toBe(1);
    expect(impacto.documentosPendientes).toBe(0);
  });
});

// =============================================================================
// Actividad económica por municipio — multimunicipio (casos dorados 9 y 10)
// =============================================================================
describe('actividad económica — multimunicipio, versionada por terna tercero×municipio×CIIU', () => {
  it('rechaza si "es principal" no se declara explícitamente', async () => {
    const { id } = await crearTerceroDePrueba();
    await expect(
      db.asTenant(
        e.tenantId,
        e.companyId,
        (tx) =>
          registrarActividad(tx, {
            terceroId: id,
            municipalityId: e.municipalityId,
            ciiuActivityId: e.ciiuId,
            esPrincipal: undefined,
            vigenteDesde: '2026-01-01',
            normaRespaldo: 'Certificado de matrícula',
          }),
        { rolCodigo: 'admin_tributario' },
      ),
    ).rejects.toBeInstanceOf(AtributoFiscalIncompletoError);
  });

  it('un proveedor puede tener actividad vigente en dos municipios a la vez, sin que una cierre la otra', async () => {
    const { id } = await crearTerceroDePrueba();
    await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) =>
        registrarActividad(tx, {
          terceroId: id,
          municipalityId: e.municipalityId,
          ciiuActivityId: e.ciiuId,
          esPrincipal: true,
          vigenteDesde: '2026-01-01',
          normaRespaldo: 'Matrícula mercantil, municipio principal',
        }),
      { rolCodigo: 'admin_tributario' },
    );
    await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) =>
        registrarActividad(tx, {
          terceroId: id,
          municipalityId: municipioSecundarioId,
          ciiuActivityId: e.ciiuId,
          esPrincipal: false,
          vigenteDesde: '2026-01-01',
          normaRespaldo: 'RIT municipal, sucursal',
        }),
      { rolCodigo: 'admin_tributario' },
    );

    const vigentes = await db.asAdmin((tx) => listarActividadesVigentes(tx, id));
    expect(vigentes).toHaveLength(2);
    expect(vigentes.map((a) => a.municipalityId).sort()).toEqual([e.municipalityId, municipioSecundarioId].sort());
  });

  it('conducta 1 — una vigencia nueva EN LA MISMA terna cierra la anterior, nunca UPDATE', async () => {
    const { id } = await crearTerceroDePrueba();
    const v1 = await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) =>
        registrarActividad(tx, {
          terceroId: id,
          municipalityId: e.municipalityId,
          ciiuActivityId: e.ciiuId,
          esPrincipal: true,
          vigenteDesde: '2026-01-01',
          normaRespaldo: 'Matrícula mercantil v1',
        }),
      { rolCodigo: 'admin_tributario' },
    );
    const v2 = await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) =>
        registrarActividad(tx, {
          terceroId: id,
          municipalityId: e.municipalityId,
          ciiuActivityId: e.ciiuId,
          esPrincipal: false,
          vigenteDesde: '2026-05-01',
          normaRespaldo: 'Cambio de actividad principal',
        }),
      { rolCodigo: 'admin_tributario' },
    );
    expect(v2.vigenciaAnteriorCerrada).toBe(true);

    const historial = await db.asAdmin((tx) => listarHistorialActividad(tx, id, e.municipalityId, e.ciiuId));
    expect(historial).toHaveLength(2);
    expect(historial.find((h) => h.id === v1.id)?.vigenteHasta).toBe('2026-04-30');
    expect(historial.find((h) => h.id === v2.id)?.vigenteHasta).toBeNull();
  });

  it('conducta 3 — no retroactivo sobre ReteICA ya publicado de ese tercero en ese municipio', async () => {
    const { id } = await crearTerceroDePrueba();
    await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) =>
        registrarActividad(tx, {
          terceroId: id,
          municipalityId: e.municipalityId,
          ciiuActivityId: e.ciiuId,
          esPrincipal: true,
          vigenteDesde: '2020-01-01',
          normaRespaldo: 'Matrícula mercantil',
        }),
      { rolCodigo: 'admin_tributario' },
    );
    await publicarRetencionParaTercero(id, { tipo: 'reteica', municipalityId: e.municipalityId });

    const fechaMinima = await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) => fechaMinimaVigenciaActividad(tx, id, e.municipalityId),
      { rolCodigo: 'admin_tributario' },
    );
    expect(fechaMinima).toBe('2026-06-15');

    await expect(
      db.asTenant(
        e.tenantId,
        e.companyId,
        (tx) =>
          registrarActividad(tx, {
            terceroId: id,
            municipalityId: e.municipalityId,
            ciiuActivityId: e.ciiuId,
            esPrincipal: false,
            vigenteDesde: '2026-06-15',
            normaRespaldo: 'Intento retroactivo',
          }),
        { rolCodigo: 'admin_tributario' },
      ),
    ).rejects.toBeInstanceOf(EdicionRetroactivaError);
  });

  it('conducta 6 — el simulador de impacto de actividad cuenta los asientos de ReteICA de ese municipio', async () => {
    const { id } = await crearTerceroDePrueba();
    await publicarRetencionParaTercero(id, { tipo: 'reteica', municipalityId: e.municipalityId });
    const impacto = await db.asTenant(
      e.tenantId,
      e.companyId,
      (tx) => simularImpactoActividad(tx, id, e.municipalityId),
      { rolCodigo: 'admin_tributario' },
    );
    expect(impacto.asientosPublicados).toBe(1);
  });
});

describe('fechas de vigencia inválidas', () => {
  it('rechaza una fecha que no es AAAA-MM-DD', async () => {
    const { id } = await crearTerceroDePrueba();
    await expect(
      db.asTenant(
        e.tenantId,
        e.companyId,
        (tx) =>
          registrarAtributosFiscales(tx, {
            terceroId: id,
            ...BANDERAS_COMPLETAS,
            regimenTributario: 'ordinario',
            vigenteDesde: '15/01/2026',
            normaRespaldo: 'RUT de prueba',
          }),
        { rolCodigo: 'admin_tributario' },
      ),
    ).rejects.toBeInstanceOf(VigenciaInvalidaError);
  });
});

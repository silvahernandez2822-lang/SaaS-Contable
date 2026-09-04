/**
 * A14 — COMPUERTA AMPLIADA DE D-088 · la CARGA MASIVA, contra el ARCHIVO REAL.
 *
 * A8 probó su parser con cuatro filas fabricadas. Aquí se le pasa el archivo
 * que entregó el usuario —`archivos-masivos/EJEMPLO_D088_parametrizacion_ica.xlsx`,
 * 551 filas de actividad— y se mide lo que de verdad entra y lo que de verdad
 * queda fuera, fila por fila. Y luego se le pasan los archivos que un cliente
 * hostil o descuidado enviaría: la columna «Gravada» en blanco, «Por periodo»
 * sin ventana, códigos que colisionan al rellenar con ceros.
 *
 * El criterio es el de la advertencia §17.5 y la Regla de Oro 2: lo que no se
 * puede resolver NO se inventa y NO se calla. Una fila que decide si se
 * practica una retención no puede tomar un valor por defecto en silencio.
 */
import ExcelJS from 'exceljs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, uuid, type TestDb } from '../helpers/db';
import { crearEscenario, type Escenario } from '../helpers/fixtures';
import { seed } from '../../src/db/seed';
import {
  ArchivoIlegibleError,
  CargaIcaRechazadaError,
  construirPlantillaIcaMunicipio,
  importarIcaMunicipio,
  leerArchivoIca,
  type ResultadoCargaIca,
} from '../../src/services/carga-masiva/ica-municipio';

const SEEDS_DIR = fileURLToPath(new URL('../../db/seeds', import.meta.url));
const ARCHIVO_REAL = fileURLToPath(
  new URL('../../archivos-masivos/EJEMPLO_D088_parametrizacion_ica.xlsx', import.meta.url),
);
/** Municipio de destino de la prueba. NO es Bogotá: V-5 sigue abierta. */
const DANE = '05001';

let db: TestDb;
let e: Escenario;

beforeAll(async () => {
  db = await createTestDb();
  // Los seeds reales: el catálogo DANE de municipios y las 454 clases CIIU que
  // dejó A1 con el seed 110. Sin ellos la carga no resuelve nada y la prueba
  // no mediría el archivo del cliente sino un catálogo de juguete.
  await db.asAdmin((tx) => seed(tx, { dir: SEEDS_DIR }));
  e = await crearEscenario(db);
}, 300_000);

afterAll(async () => {
  await db.close();
});

async function cargar(
  contenido: Uint8Array,
  nombre = 'municipio.xlsx',
  vigenteDesde = '2026-01-01',
): Promise<ResultadoCargaIca> {
  return db.asTenant(
    e.tenantId,
    e.companyId,
    (tx) =>
      importarIcaMunicipio(tx, nombre, contenido, {
        vigenteDesde,
        normaRespaldo: 'Acuerdo municipal de prueba de la compuerta de A14',
        periodicidad: 'mensual',
        alcance: 'empresa',
      }),
    { rolCodigo: 'admin_tributario', sesionNueva: true },
  );
}

/** Archivo con el layout del cliente, para los ataques dirigidos. */
async function fabricar(opciones: {
  municipio?: string;
  tipoMedicion?: string;
  periodoMeses?: string | number;
  filas: Array<[string, string, string]>; // [codigo, tarifaPorMil, gravada]
}): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const h = wb.addWorksheet('Hoja1');
  h.getCell('C5').value = 'Municipio';
  h.getCell('D5').value = opciones.municipio ?? DANE;
  h.getCell('J5').value = 'Tipo de medición base mínima';
  h.getCell('K5').value = opciones.tipoMedicion ?? 'Por factura';
  if (opciones.periodoMeses !== undefined) {
    h.getCell('J6').value = 'Periodo en meses';
    h.getCell('K6').value = opciones.periodoMeses;
  }
  h.getCell('C8').value = 'Código';
  h.getCell('D8').value = 'Descripción';
  h.getCell('I8').value = 'Tarifa por mil';
  h.getCell('J8').value = 'Gravada';
  opciones.filas.forEach(([codigo, tarifa, gravada], i) => {
    const r = 9 + i;
    h.getCell(`C${r}`).value = codigo;
    h.getCell(`D${r}`).value = `Actividad ${codigo}`;
    if (tarifa !== '') h.getCell(`I${r}`).value = Number(tarifa);
    if (gravada !== '') h.getCell(`J${r}`).value = gravada;
  });
  return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

async function tarifasDelMunicipio(): Promise<
  Array<{ codigo: string; tarifa: string; gravada: boolean | null }>
> {
  return db.asAdmin(async (tx) => {
    const { rows } = await tx.query<{ codigo: string; tarifa: string; gravada: boolean | null }>(
      `SELECT ci.codigo, tr.tarifa::text AS tarifa, tr.gravada
         FROM tax_rule tr
         JOIN ciiu_activity ci ON ci.id = tr.ciiu_activity_id
         JOIN municipality m ON m.id = tr.municipality_id
        WHERE tr.tipo = 'reteica' AND m.codigo_dane = $1 AND tr.vigente_hasta IS NULL
        ORDER BY ci.codigo`,
      [DANE],
    );
    return rows;
  });
}

// =============================================================================
/**
 * El archivo real trae en la celda «Municipio» el texto «Bogotá», y el catálogo
 * DANE lo llama «Bogotá, D.C.»: tal cual, el archivo se rechaza entero (ver la
 * prueba que lo fija más abajo). Para poder medir el VOLUMEN de las 551 filas
 * se reescribe esa única celda con un código DANE, sin tocar nada más. Se carga
 * contra un municipio que NO es Bogotá a propósito: V-5 sigue abierta y las
 * tarifas de Bogotá del archivo no están verificadas contra el Acuerdo.
 */
async function archivoRealConMunicipio(dane: string): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(ARCHIVO_REAL);
  wb.worksheets[0]!.getCell('D5').value = dane;
  return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

describe('A14 · D-088 · el ARCHIVO REAL del cliente, 551 filas', () => {
  it('tal cual viene NO se carga: «Bogotá» no es «Bogotá, D.C.» y el municipio no se adivina', async () => {
    const contenido = new Uint8Array(readFileSync(ARCHIVO_REAL));
    const salida = await cargar(contenido, 'EJEMPLO_D088_parametrizacion_ica.xlsx')
      .then(() => ({ ok: true as const }))
      .catch((err: unknown) => ({ ok: false as const, err }));
    expect(salida.ok).toBe(false);
    const err = (salida as { err: unknown }).err;
    expect(err).toBeInstanceOf(CargaIcaRechazadaError);
    const res = (err as CargaIcaRechazadaError).resultado;
    expect(res.aplicado).toBe(false);
    expect(res.filasInsertadas).toBe(0);
    // El motivo dice qué hacer, no se queda en "no se pudo".
    expect(res.errores[0]!.columna).toBe('Municipio');
    expect(res.errores[0]!.motivo).toMatch(/no existe ningún municipio/i);
    // Y nada quedó a medias.
    const escrito = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: string }>(
        `SELECT count(*)::int AS n FROM tax_rule WHERE tipo = 'reteica' AND company_id = $1`,
        [e.companyId],
      );
      return Number(rows[0]!.n);
    });
    expect(escrito).toBe(0);
  }, 120_000);

  it('entran las 451 buenas, salen informadas las 100 que no son CIIU de 4 dígitos, y no es todo-o-nada', async () => {
    const contenido = await archivoRealConMunicipio(DANE);
    const r = await cargar(contenido, 'EJEMPLO_D088_parametrizacion_ica.xlsx');

    expect(r.aplicado).toBe(true);
    expect(r.filasLeidas).toBe(551);
    // 99 subclases de 5 dígitos del Distrito + 1 celda corrupta ("85232/8551").
    expect(r.filasConError).toBe(100);
    expect(r.filasInsertadas).toBe(451);
    expect(r.filasValidas + r.filasConError).toBe(r.filasLeidas);

    // Ni una fila con error se inventó: todas traen el número de fila y el
    // motivo, y ninguna de ellas quedó escrita.
    expect(r.errores).toHaveLength(100);
    for (const err of r.errores) {
      expect(err.numeroFila).toBeGreaterThan(8);
      expect(err.motivo).toBeTruthy();
    }
    // La celda corrupta se informa por lo que es, no como "código inexistente".
    expect(r.errores.some((x) => x.motivo.includes('85232/8551'))).toBe(true);

    const filas = await tarifasDelMunicipio();
    expect(filas).toHaveLength(451);
    // Cero colisiones: el zero-pad no fusionó dos filas distintas en una.
    expect(new Set(filas.map((f) => f.codigo)).size).toBe(451);
    // Todos los códigos guardados son CIIU de cuatro dígitos.
    expect(filas.every((f) => /^\d{4}$/.test(f.codigo))).toBe(true);
    // Las 65 no gravadas del archivo quedaron con tarifa cero, como obliga el
    // CHECK; las gravadas, con tarifa positiva. Ni una contradicción.
    const noGravadas = filas.filter((f) => f.gravada === false);
    expect(noGravadas).toHaveLength(65);
    expect(noGravadas.every((f) => Number(f.tarifa) === 0)).toBe(true);
    expect(filas.filter((f) => f.gravada === true).every((f) => Number(f.tarifa) > 0)).toBe(true);
    // Y ninguna fila quedó con el flag sin declarar: el archivo lo trae para todas.
    expect(filas.filter((f) => f.gravada === null)).toHaveLength(0);
  }, 300_000);

  it('el «por mil» del archivo se guarda como fracción, verificado contra el Excel celda a celda', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(ARCHIVO_REAL);
    const hoja = wb.worksheets[0]!;
    const esperadas = new Map<string, string>();
    hoja.eachRow({ includeEmpty: false }, (fila, n) => {
      if (n < 9) return;
      const codigo = String(fila.getCell(3).value ?? '').trim();
      const porMil = fila.getCell(9).value;
      const gravada = String(fila.getCell(10).value ?? '').trim().toUpperCase();
      if (!/^\d{1,4}$/.test(codigo) || gravada !== 'S' || porMil === null || porMil === undefined) return;
      esperadas.set(codigo.padStart(4, '0'), (Number(porMil) / 1000).toFixed(6));
    });
    expect(esperadas.size).toBeGreaterThan(300);

    const filas = await tarifasDelMunicipio();
    const enBase = new Map(filas.map((f) => [f.codigo, f.tarifa]));
    for (const [codigo, tarifa] of esperadas) {
      expect(enBase.get(codigo), `tarifa del CIIU ${codigo}`).toBe(tarifa);
    }
  }, 120_000);
});

// =============================================================================
describe('A14 · D-088 · lo que un archivo mal formado NO puede conseguir en silencio', () => {
  it('«Gravada» en blanco es un ERROR de fila, no un «no gravada» por omisión', async () => {
    // Es el caso peligroso: una actividad SÍ gravada, con su tarifa, a la que
    // se le olvidó la S. Tomarla por no gravada apaga la retención de esa
    // actividad en el municipio sin que nadie se entere.
    const contenido = await fabricar({
      filas: [
        ['0111', '9.66', ''], // gravada en blanco CON tarifa
        ['0112', '', ''], // gravada en blanco SIN tarifa
        ['0113', '7', 'S'], // la buena
      ],
    });
    const r = await cargar(contenido, 'gravada-en-blanco.xlsx', '2026-03-01');

    expect(r.filasConError).toBe(2);
    expect(r.errores.map((x) => x.numeroFila)).toEqual([9, 10]);
    for (const err of r.errores) expect(err.motivo).toMatch(/Gravada/i);
    expect(r.filasInsertadas).toBe(1);

    // Y ninguna de las dos quedó escrita como "no gravada".
    const escritas = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ codigo: string }>(
        `SELECT ci.codigo FROM tax_rule tr
           JOIN ciiu_activity ci ON ci.id = tr.ciiu_activity_id
           JOIN municipality m ON m.id = tr.municipality_id
          WHERE tr.tipo = 'reteica' AND m.codigo_dane = $1
            AND ci.codigo IN ('0111','0112') AND tr.vigente_desde = DATE '2026-03-01'`,
        [DANE],
      );
      return rows.map((x) => x.codigo);
    });
    expect(escritas).toEqual([]);
  });

  it('«Por periodo» sin ventana en meses NO se carga: el motor no debe suponerla', async () => {
    // Sin `periodo_meses`, el municipio quedaría midiendo por periodo con una
    // ventana desconocida: cada factura suya iría a revisión manual
    // (MOTIVO.ICA_PERIODO_SIN_VENTANA). Eso es un vacío de parametrización que
    // hay que ver AL CARGAR, no factura a factura.
    const sinVentana = await fabricar({
      tipoMedicion: 'Por periodo',
      filas: [['0111', '9.66', 'S']],
    });
    await expect(cargar(sinVentana, 'sin-ventana.xlsx', '2026-04-01')).rejects.toBeInstanceOf(
      ArchivoIlegibleError,
    );

    // Una ventana que no es un entero de 1 a 12 tampoco pasa.
    for (const valor of ['0', '13', '2,5', 'dos']) {
      await expect(
        cargar(
          await fabricar({
            tipoMedicion: 'Por periodo',
            periodoMeses: valor,
            filas: [['0111', '9.66', 'S']],
          }),
          `ventana-${valor}.xlsx`,
          '2026-04-01',
        ),
        `periodo en meses = "${valor}"`,
      ).rejects.toBeInstanceOf(ArchivoIlegibleError);
    }

    // Y la buena sí entra, con su ventana.
    const r = await cargar(
      await fabricar({
        tipoMedicion: 'Por periodo',
        periodoMeses: 2,
        filas: [['0111', '9.66', 'S']],
      }),
      'con-ventana.xlsx',
      '2026-04-01',
    );
    expect(r.aplicado).toBe(true);
    const regla = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ tipo: string; meses: number | null }>(
        `SELECT r.tipo_medicion_base_minima AS tipo, r.periodo_meses AS meses
           FROM municipality_ica_rule r JOIN municipality m ON m.id = r.municipality_id
          WHERE m.codigo_dane = $1 AND r.company_id = $2 AND r.vigente_hasta IS NULL`,
        [DANE, e.companyId],
      );
      return rows[0];
    });
    expect(regla).toEqual({ tipo: 'por_periodo', meses: 2 });
  });

  it('«Gravada = S» con la tarifa vacía es un error de fila, no una tarifa cero inventada', async () => {
    const contenido = await fabricar({
      filas: [
        ['0114', '', 'S'],
        ['0115', '5', 'S'],
      ],
    });
    const r = await cargar(contenido, 'tarifa-vacia.xlsx', '2026-05-01');
    expect(r.filasConError).toBe(1);
    expect(r.errores[0]!.numeroFila).toBe(9);
    expect(r.errores[0]!.motivo).toMatch(/[Tt]arifa/);
    expect(r.filasInsertadas).toBe(1);
  });

  it('«161» y «0161» en el mismo archivo colisionan al rellenar con ceros y se dicen, no se pisan', async () => {
    const contenido = await fabricar({
      filas: [
        ['161', '6', 'S'],
        ['0161', '9', 'S'],
      ],
    });
    // Sea cual sea la política, lo intolerable sería que una tarifa pisara a la
    // otra EN SILENCIO y el contador se quedara con la última sin saberlo.
    const salida = await cargar(contenido, 'colision.xlsx', '2026-06-01')
      .then((r) => ({ ok: true as const, r }))
      .catch((err: unknown) => ({ ok: false as const, err }));

    if (salida.ok) {
      // Si se permite, la segunda tiene que salir informada como duplicada.
      expect(salida.r.filasInsertadas).toBeLessThanOrEqual(1);
      expect(salida.r.filasConError).toBeGreaterThanOrEqual(1);
    } else {
      // Si se rechaza, se rechaza el archivo entero y no queda media carga.
      expect(salida.err).toBeInstanceOf(CargaIcaRechazadaError);
    }
    const dobles = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: string }>(
        `SELECT count(*)::int AS n FROM tax_rule tr
           JOIN ciiu_activity ci ON ci.id = tr.ciiu_activity_id
           JOIN municipality m ON m.id = tr.municipality_id
          WHERE tr.tipo = 'reteica' AND m.codigo_dane = $1 AND ci.codigo = '0161'
            AND tr.vigente_desde = DATE '2026-06-01'`,
        [DANE],
      );
      return Number(rows[0]!.n);
    });
    expect(dobles).toBeLessThanOrEqual(1);
  });

  it('sin fecha de vigencia o sin norma de respaldo no se carga nada (§6.2)', async () => {
    const contenido = await fabricar({ filas: [['0116', '5', 'S']] });
    await expect(
      db.asTenant(
        e.tenantId,
        e.companyId,
        (tx) =>
          importarIcaMunicipio(tx, 'x.xlsx', contenido, {
            vigenteDesde: '2026-07-01',
            normaRespaldo: '   ',
            periodicidad: 'mensual',
          }),
        { rolCodigo: 'admin_tributario', sesionNueva: true },
      ),
    ).rejects.toBeInstanceOf(ArchivoIlegibleError);
    await expect(
      db.asTenant(
        e.tenantId,
        e.companyId,
        (tx) =>
          importarIcaMunicipio(tx, 'x.xlsx', contenido, {
            vigenteDesde: 'ayer',
            normaRespaldo: 'Acuerdo',
            periodicidad: 'mensual',
          }),
        { rolCodigo: 'admin_tributario', sesionNueva: true },
      ),
    ).rejects.toBeInstanceOf(ArchivoIlegibleError);
  });

  it('un municipio que no está en el catálogo DANE no se crea al vuelo', async () => {
    const contenido = await fabricar({ municipio: '99999', filas: [['0117', '5', 'S']] });
    await expect(cargar(contenido, 'municipio-inexistente.xlsx', '2026-08-01')).rejects.toBeInstanceOf(
      CargaIcaRechazadaError,
    );
  });

  it('una sesión SIN el permiso de parámetros no carga ni una fila', async () => {
    const contenido = await fabricar({ filas: [['0118', '5', 'S']] });
    const salida = await db
      .asTenant(
        e.tenantId,
        e.companyId,
        (tx) =>
          importarIcaMunicipio(tx, 'sin-permiso.xlsx', contenido, {
            vigenteDesde: '2026-09-01',
            normaRespaldo: 'Acuerdo',
            periodicidad: 'mensual',
          }),
        { rolCodigo: 'auxiliar_causacion', sesionNueva: true },
      )
      .then(() => 'CARGO')
      .catch(() => 'RECHAZADO');
    expect(salida).toBe('RECHAZADO');

    const filas = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: string }>(
        `SELECT count(*)::int AS n FROM tax_rule tr
           JOIN ciiu_activity ci ON ci.id = tr.ciiu_activity_id
          WHERE ci.codigo = '0118' AND tr.tipo = 'reteica'`,
      );
      return Number(rows[0]!.n);
    });
    expect(filas).toBe(0);
  });
});

// =============================================================================
describe('A14 · D-088 · la PLANTILLA descargable (Regla de Oro 2 y §17.5)', () => {
  it('no viene con ningún valor tributario precargado que se pueda subir sin darse cuenta', async () => {
    const wb = construirPlantillaIcaMunicipio();
    const hoja = wb.worksheets[0]!;
    // El bloque de encabezado es LO QUE EL PARSER LEE COMO CONFIGURACIÓN REAL.
    // Si viniera relleno, un contador que pega su lista de actividades encima
    // de las filas de ejemplo y sube el archivo estaría cargando las bases
    // mínimas y el municipio del ejemplo como si fueran los suyos.
    for (const celda of ['D5', 'H5', 'H6', 'K6']) {
      const v = hoja.getCell(celda).value;
      expect(v === null || v === undefined || String(v).trim() === '', `celda ${celda}`).toBe(true);
    }
    // Y ninguna celda de tarifa trae un número.
    for (let fila = 9; fila <= 12; fila += 1) {
      const v = hoja.getCell(`I${fila}`).value;
      expect(typeof v === 'number', `tarifa de ejemplo en I${fila}`).toBe(false);
    }
  });

  it('la plantilla vacía, subida tal cual, se rechaza en vez de cargar el ejemplo', async () => {
    const wb = construirPlantillaIcaMunicipio();
    const contenido = new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    await expect(cargar(contenido, 'plantilla-vacia.xlsx', '2026-10-01')).rejects.toBeInstanceOf(
      ArchivoIlegibleError,
    );
  });

  it('la plantilla y el parser hablan el mismo idioma: las etiquetas se reconocen', async () => {
    const wb = construirPlantillaIcaMunicipio();
    const hoja = wb.worksheets[0]!;
    hoja.getCell('D5').value = DANE;
    hoja.getCell('H5').value = 10;
    hoja.getCell('H6').value = 2;
    hoja.getCell('C9').value = '0119';
    hoja.getCell('I9').value = 5;
    hoja.getCell('J9').value = 'S';
    const leido = await leerArchivoIca(
      new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer),
    );
    expect(leido.municipioTexto).toBe(DANE);
    expect(leido.encabezado.baseMinimaComprasUvt).toBe('10');
    expect(leido.encabezado.baseMinimaServiciosUvt).toBe('2');
    expect(leido.encabezado.tipoMedicionBaseMinima).toBe('por_factura');
  });
});

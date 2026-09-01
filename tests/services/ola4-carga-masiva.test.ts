/**
 * A16 — Ola 4: carga masiva, PUC por empresa y ReteICA en cascada.
 *
 * Lo que se comprueba aquí es lo que la Ola 4 promete y no se puede verificar
 * leyendo el código:
 *
 *  · Que las quince plantillas que se le entregan al usuario las sabe leer su
 *    propio importador, y que su fila de ejemplo pasa la validación. Es la
 *    prueba de que la plantilla y el validador no se pueden desincronizar
 *    (D-071): salen del mismo archivo, y esto lo demuestra dando la vuelta
 *    completa —generar el `.xlsx`, releerlo, validarlo—.
 *  · Que una fila mala NO deja media carga dentro (D-072), y que la lista de
 *    errores dice fila, columna y motivo.
 *  · Que la carga escribe por los servicios de dominio, así que hereda sus
 *    reglas: las nueve banderas fiscales obligatorias, la norma de respaldo,
 *    el permiso.
 *  · Que el PUC de una empresa sobreescribe cuenta por cuenta el genérico y no
 *    lo reemplaza (D-064), y que apagar la herencia sin cuentas propias se
 *    rechaza (D-065).
 *  · Que el selector de actividad de ReteICA depende del municipio (Tarea 5).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/db';
import { crearEscenario, type Escenario } from '../helpers/fixtures';
import { DEFINICIONES, definicionPorClave } from '../../src/services/carga-masiva/definiciones';
import { construirPlantilla } from '../../src/services/carga-masiva/plantilla';
import { leerXlsx, leerCsv, type TablaLeida } from '../../src/services/carga-masiva/tabla';
import {
  importarTabla,
  CargaRechazadaError,
  CatalogoDesconocidoError,
} from '../../src/services/carga-masiva/importar';
import {
  fijarModoPuc,
  guardarCuenta,
  listarPucEfectivo,
  ocultarCuentaGenerica,
  obtenerModoPuc,
  resumenPuc,
  ModoPucInvalidoError,
  CuentaInvalidaError,
  nivelDeCodigo,
  codigoPadreDe,
} from '../../src/services/puc';
import { listarActividadesIcaDeMunicipio, listarTerceros } from '../../src/services/terceros';
import { pesosACentavos, tarifaAFraccion, ValorInvalidoError } from '../../src/services/carga-masiva/valores';

let db: TestDb;
let e: Escenario;

beforeAll(async () => {
  db = await createTestDb();
  e = await crearEscenario(db);
}, 180_000);

afterAll(async () => {
  await db?.close();
});

/** Construye la tabla leída a partir de encabezados y filas, sin pasar por Excel. */
function tabla(encabezados: string[], filas: string[][]): TablaLeida {
  return {
    encabezados,
    hoja: 'Datos',
    filas: filas.map((celdas, i) => ({
      numeroFila: i + 2,
      valores: Object.fromEntries(encabezados.map((h, c) => [h, celdas[c] ?? ''])),
    })),
  };
}

// =============================================================================
// 1. LA PLANTILLA Y EL IMPORTADOR SON LA MISMA LISTA (D-071)
// =============================================================================

describe('A16 · las plantillas se releen con su propio importador', () => {
  for (const definicion of DEFINICIONES) {
    it(`${definicion.clave}: encabezados exactos y fila de ejemplo válida`, async () => {
      const wb = construirPlantilla(definicion);
      const buffer = await wb.xlsx.writeBuffer();
      const leida = await leerXlsx(Buffer.from(buffer as ArrayBuffer));

      // La hoja de datos es la que lee el importador, no la de instrucciones.
      expect(leida.hoja).toBe('Datos');

      // TODA columna de la definición aparece con su nombre exacto: el
      // asterisco de «obligatoria» es decoración y el lector lo quita.
      for (const columna of definicion.columnas) {
        expect(leida.encabezados).toContain(columna.nombre);
      }

      // Y la fila de ejemplo pasa la validación real, no una parecida.
      expect(leida.filas).toHaveLength(1);
      expect(() => definicion.validar(leida.filas[0]!.valores)).not.toThrow();
    });
  }

  it('un catálogo inventado se rechaza por nombre, sin tocar la base', async () => {
    await expect(
      db.asTenant(e.tenantId, e.companyId, (tx) =>
        importarTabla(tx, 'no_existe', 'x.xlsx', tabla(['a'], [['1']])),
      ),
    ).rejects.toBeInstanceOf(CatalogoDesconocidoError);
  });

  it('`__proto__` como clave de catálogo no devuelve nada truthy (mismo agujero que V-19)', () => {
    expect(definicionPorClave('__proto__')).toBeUndefined();
    expect(definicionPorClave('constructor')).toBeUndefined();
  });
});

// =============================================================================
// 2. CONVERSIÓN DE VALORES — Regla de Oro 5, sin coma flotante
// =============================================================================

describe('A16 · los importes y las tarifas se convierten con cadenas, no con float', () => {
  it('pesos a centavos, exacto', () => {
    expect(pesosACentavos('250000', 'v')).toBe('25000000');
    expect(pesosACentavos('1234,56', 'v')).toBe('123456');
    expect(pesosACentavos('100,5', 'v')).toBe('10050');
    expect(pesosACentavos('0,05', 'v')).toBe('5');
  });

  it('el separador de miles NO se adivina: se rechaza y se explica', () => {
    expect(() => pesosACentavos('250.000', 'valor_pesos')).toThrow(ValorInvalidoError);
    try {
      pesosACentavos('250.000', 'valor_pesos');
    } catch (error) {
      expect((error as Error).message).toContain('sin separador de miles');
    }
  });

  it('una tarifa se lee igual escrita como fracción que como porcentaje', () => {
    expect(tarifaAFraccion('0,025', 't')).toBe('0.025');
    expect(tarifaAFraccion('2,5%', 't')).toBe('0.025');
    expect(tarifaAFraccion('11%', 't')).toBe('0.11');
    expect(tarifaAFraccion('100%', 't')).toBe('1');
  });

  it('un número sin el signo de porcentaje que daría más del total se rechaza en vez de adivinarse', () => {
    // Es el error caro: "11" queriendo decir once por ciento se guardaría como
    // once veces la base. Aquí no se interpreta, se rechaza.
    expect(() => tarifaAFraccion('11', 'tarifa')).toThrow(ValorInvalidoError);
  });
});

// =============================================================================
// 3. TODO EL ARCHIVO O NADA (D-072)
// =============================================================================

describe('A16 · una fila mala no deja media carga dentro', () => {
  const ENCABEZADOS = [
    'codigo_dane',
    'nombre',
    'departamento',
    'codigo_dane_departamento',
    'activo',
    'alcance',
  ];

  it('carga limpia: entran todas las filas y queda UNA fila de auditoría CARGA_MASIVA', async () => {
    const resultado = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      importarTabla(
        tx,
        'municipality',
        'municipios.xlsx',
        tabla(ENCABEZADOS, [
          ['76001', 'Municipio A', 'Departamento A', '76', 'SI', 'firma'],
          ['76002', 'Municipio B', 'Departamento A', '76', 'SI', 'firma'],
        ]),
      ),
    );

    expect(resultado.aplicado).toBe(true);
    expect(resultado.filasInsertadas).toBe(2);
    expect(resultado.errores).toEqual([]);

    const auditoria = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ entidad: string; entidad_id: string; valor_nuevo: unknown }>(
        `SELECT entidad, entidad_id, valor_nuevo FROM audit_log
          WHERE accion = 'CARGA_MASIVA' AND tenant_id = $1 ORDER BY id DESC LIMIT 1`,
        [e.tenantId],
      );
      return rows[0]!;
    });
    expect(auditoria.entidad).toBe('municipality');
    expect(auditoria.entidad_id).toBe('municipios.xlsx');
    const detalle = (
      typeof auditoria.valor_nuevo === 'string' ? JSON.parse(auditoria.valor_nuevo) : auditoria.valor_nuevo
    ) as Record<string, unknown>;
    expect(detalle.filas_ok).toBe(2);
    expect(detalle.catalogo).toBe('municipality');
  });

  it('con una fila mala NO entra ninguna, y el informe dice fila, columna y motivo', async () => {
    const antes = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: string }>('SELECT count(*) AS n FROM municipality');
      return Number(rows[0]!.n);
    });

    let resultado;
    try {
      await db.asTenant(e.tenantId, e.companyId, (tx) =>
        importarTabla(
          tx,
          'municipality',
          'con-error.xlsx',
          tabla(ENCABEZADOS, [
            ['76010', 'Municipio bueno', 'Departamento A', '76', 'SI', 'firma'],
            ['7602', 'Municipio malo', 'Departamento A', '76', 'SI', 'firma'], // DANE de 4 dígitos
            ['76011', 'Otro bueno', 'Departamento A', '76', 'SI', 'firma'],
          ]),
        ),
      );
      throw new Error('debió rechazarse');
    } catch (error) {
      expect(error).toBeInstanceOf(CargaRechazadaError);
      resultado = (error as CargaRechazadaError).resultado;
    }

    expect(resultado.aplicado).toBe(false);
    expect(resultado.filasInsertadas).toBe(0);
    expect(resultado.filasValidas).toBe(2);
    expect(resultado.errores).toHaveLength(1);
    expect(resultado.errores[0]!.numeroFila).toBe(3); // la 1 es el encabezado
    expect(resultado.errores[0]!.columna).toBe('codigo_dane');
    expect(resultado.errores[0]!.motivo).toContain('5 dígitos');

    const despues = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ n: string }>('SELECT count(*) AS n FROM municipality');
      return Number(rows[0]!.n);
    });
    expect(despues).toBe(antes); // ni la fila buena que iba delante
  });

  it('«solo las válidas» hay que pedirlo: nunca ocurre solo', async () => {
    const resultado = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      importarTabla(
        tx,
        'municipality',
        'con-error.xlsx',
        tabla(ENCABEZADOS, [
          ['76020', 'Municipio bueno', 'Departamento A', '76', 'SI', 'firma'],
          ['nada', 'Municipio malo', 'Departamento A', '76', 'SI', 'firma'],
        ]),
        { soloValidas: true },
      ),
    );
    expect(resultado.aplicado).toBe(true);
    expect(resultado.filasInsertadas).toBe(1);
    expect(resultado.filasConError).toBe(1);
  });

  it('un archivo sin las columnas obligatorias se rechaza entero, señalando cuáles faltan', async () => {
    try {
      await db.asTenant(e.tenantId, e.companyId, (tx) =>
        importarTabla(tx, 'municipality', 'incompleto.csv', tabla(['codigo_dane'], [['76030']])),
      );
      throw new Error('debió rechazarse');
    } catch (error) {
      expect(error).toBeInstanceOf(CargaRechazadaError);
      const r = (error as CargaRechazadaError).resultado;
      expect(r.columnasFaltantes).toContain('nombre');
      expect(r.errores[0]!.motivo).toContain('columnas obligatorias');
    }
  });

  it('las columnas que el importador no conoce se ignoran, no rompen la carga', async () => {
    const resultado = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      importarTabla(
        tx,
        'municipality',
        'con-extras.xlsx',
        tabla(
          [...ENCABEZADOS, 'mis_notas'],
          [['76040', 'Municipio C', 'Departamento A', '76', 'SI', 'firma', 'lo revisó Marta']],
        ),
      ),
    );
    expect(resultado.aplicado).toBe(true);
    expect(resultado.columnasIgnoradas).toEqual(['mis_notas']);
  });

  it('el CSV con punto y coma (el que exporta Excel en español) se lee igual', () => {
    const leida = leerCsv('codigo;nombre\n"4690";"Comercio, al por mayor"\n');
    expect(leida.encabezados).toEqual(['codigo', 'nombre']);
    expect(leida.filas[0]!.valores.nombre).toBe('Comercio, al por mayor');
  });
});

// =============================================================================
// 4. LA CARGA ESCRIBE POR LOS SERVICIOS, ASÍ QUE HEREDA SUS REGLAS (D-071)
// =============================================================================

describe('A16 · la carga masiva no puede saltarse las reglas de la carga a mano', () => {
  it('un tercero cargado por archivo queda igual que uno creado a mano', async () => {
    const resultado = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      importarTabla(
        tx,
        'third_party',
        'terceros.xlsx',
        tabla(
          [
            'tipo_documento',
            'numero_documento',
            'tipo_persona',
            'razon_social',
            'direccion',
            'municipio_codigo_dane',
          ],
          [['NIT', '901555444', 'juridica', 'Proveedor cargado por archivo', 'Calle 1 # 2-3', '11001']],
        ),
      ),
    );
    expect(resultado.filasInsertadas).toBe(1);

    const terceros = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      listarTerceros(tx, { busqueda: '901555444' }),
    );
    expect(terceros).toHaveLength(1);
    expect(terceros[0]!.razonSocial).toBe('Proveedor cargado por archivo');
    // El código DANE lo resolvió el servicio a partir del municipio, no el archivo.
    expect(terceros[0]!.codigoDane).toBe('11001');
  });

  it('a un tercero sin municipio y sin marcar «del exterior» se le rechaza la fila, como en el formulario', async () => {
    try {
      await db.asTenant(e.tenantId, e.companyId, (tx) =>
        importarTabla(
          tx,
          'third_party',
          'terceros.xlsx',
          tabla(
            ['tipo_documento', 'numero_documento', 'tipo_persona', 'razon_social', 'direccion', 'municipio_codigo_dane'],
            [['NIT', '901555445', 'juridica', 'Sin municipio', 'Calle 1', '']],
          ),
        ),
      );
      throw new Error('debió rechazarse');
    } catch (error) {
      expect(error).toBeInstanceOf(CargaRechazadaError);
      expect((error as CargaRechazadaError).resultado.errores[0]!.motivo).toContain('municipio_codigo_dane');
    }
  });

  it('un atributo fiscal al que le falta UNA de las nueve banderas se rechaza (D-014)', async () => {
    const columnas = [
      'tipo_documento',
      'numero_documento',
      'es_declarante_renta',
      'es_autorretenedor_renta',
      'es_gran_contribuyente',
      'es_regimen_simple',
      'es_responsable_iva',
      'es_agente_retencion_renta',
      'es_agente_retencion_iva',
      'es_agente_retencion_ica',
      'es_autorretenedor_ica',
      'regimen_tributario',
      'vigente_desde',
      'norma_respaldo',
    ];
    // La casilla vacía NO significa NO: significa que la fila no se guarda.
    const fila = ['NIT', '901555444', 'SI', 'NO', 'NO', 'NO', 'SI', 'NO', 'NO', '', 'NO', 'ordinario', '2026-07-01', 'RUT'];

    try {
      await db.asTenant(e.tenantId, e.companyId, (tx) =>
        importarTabla(tx, 'third_party_fiscal_attribute', 'fiscales.xlsx', tabla(columnas, [fila])),
      );
      throw new Error('debió rechazarse');
    } catch (error) {
      expect(error).toBeInstanceOf(CargaRechazadaError);
      const r = (error as CargaRechazadaError).resultado;
      expect(r.errores[0]!.columna).toBe('es_agente_retencion_ica');
      expect(r.errores[0]!.motivo).toContain('SI o NO');
    }
  });

  it('sin norma de respaldo no se guarda ninguna vigencia, venga del formulario o del archivo', async () => {
    const columnas = ['anio', 'valor_pesos', 'vigente_desde', 'norma_respaldo'];
    try {
      await db.asTenant(e.tenantId, e.companyId, (tx) =>
        importarTabla(tx, 'uvt_value', 'uvt.xlsx', tabla(columnas, [['2027', '1', '2027-01-01', '']])),
      );
      throw new Error('debió rechazarse');
    } catch (error) {
      expect(error).toBeInstanceOf(CargaRechazadaError);
      expect((error as CargaRechazadaError).resultado.errores[0]!.columna).toBe('norma_respaldo');
    }
  });

  it('un rol sin el permiso del catálogo no carga nada: lo rechaza el motor, no el importador', async () => {
    try {
      await db.asTenant(
        e.tenantId,
        e.companyId,
        (tx) =>
          importarTabla(
            tx,
            'municipality',
            'municipios.xlsx',
            tabla(
              ['codigo_dane', 'nombre', 'departamento', 'codigo_dane_departamento'],
              [['76099', 'Municipio prohibido', 'Departamento A', '76']],
            ),
          ),
        { rolCodigo: 'auxiliar_causacion', sesionNueva: true },
      );
      throw new Error('debió rechazarse');
    } catch (error) {
      expect(error).toBeInstanceOf(CargaRechazadaError);
      expect((error as CargaRechazadaError).resultado.errores[0]!.motivo).toContain('permiso');
    }
  });
});

// =============================================================================
// 5. PUC POR EMPRESA (D-064 y D-065)
// =============================================================================

describe('A16 · el PUC de la empresa sobreescribe el genérico, no lo reemplaza', () => {
  it('la jerarquía se deduce del código y no se pide por separado', () => {
    expect(nivelDeCodigo('1')).toBe(1);
    expect(nivelDeCodigo('11')).toBe(2);
    expect(nivelDeCodigo('1105')).toBe(3);
    expect(nivelDeCodigo('110505')).toBe(4);
    expect(nivelDeCodigo('11050501')).toBe(5);
    expect(codigoPadreDe('110505')).toBe('1105');
    expect(codigoPadreDe('1')).toBeNull();
    // Longitudes que no corresponden a ningún nivel del PUC colombiano.
    expect(() => nivelDeCodigo('110')).toThrow(CuentaInvalidaError);
  });

  it('una cuenta de nivel 1 o 2 no puede admitir movimiento', async () => {
    await expect(
      db.asTenant(e.tenantId, e.companyId, (tx) =>
        guardarCuenta(tx, {
          codigo: '1',
          nombre: 'Activo',
          naturaleza: 'debito',
          permiteMovimiento: true,
        }),
      ),
    ).rejects.toBeInstanceOf(CuentaInvalidaError);
  });

  it('una subcuenta necesita que su cuenta padre exista ya', async () => {
    await expect(
      db.asTenant(e.tenantId, e.companyId, (tx) =>
        guardarCuenta(tx, {
          codigo: '999999',
          nombre: 'Sin padre',
          naturaleza: 'debito',
          permiteMovimiento: true,
        }),
      ),
    ).rejects.toThrow(/9999/);
  });

  it('la cuenta de la empresa gana sobre la global del mismo código, y la global sigue intacta', async () => {
    // Una cuenta GLOBAL, como las que siembra A1.
    await db.asAdmin(async (tx) => {
      await tx.query(
        `INSERT INTO account (tenant_id, company_id, codigo, nombre, nivel, naturaleza, permite_movimiento)
         VALUES (NULL, NULL, '1', 'Activo (genérico)', 1, 'debito', false)
         ON CONFLICT DO NOTHING`,
      );
      await tx.query(
        `INSERT INTO account (tenant_id, company_id, codigo, nombre, nivel, naturaleza, permite_movimiento)
         VALUES (NULL, NULL, '1105', 'Caja (genérica)', 3, 'debito', false)
         ON CONFLICT DO NOTHING`,
      );
      await tx.query(
        `INSERT INTO account (tenant_id, company_id, codigo, nombre, nivel, naturaleza, permite_movimiento)
         VALUES (NULL, NULL, '110505', 'Caja general (genérica)', 4, 'debito', true)
         ON CONFLICT DO NOTHING`,
      );
    });

    const antes = await db.asTenant(e.tenantId, e.companyId, (tx) => listarPucEfectivo(tx, { busqueda: '110505' }));
    expect(antes[0]!.alcance).toBe('global');
    expect(antes[0]!.nombre).toContain('genérica');

    await db.asTenant(e.tenantId, e.companyId, (tx) =>
      guardarCuenta(tx, {
        codigo: '110505',
        nombre: 'Caja general de ESTA empresa',
        naturaleza: 'debito',
        permiteMovimiento: true,
        alcance: 'empresa',
      }),
    );

    const despues = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      listarPucEfectivo(tx, { busqueda: '110505' }),
    );
    // Una sola fila por código: la de la empresa.
    expect(despues).toHaveLength(1);
    expect(despues[0]!.alcance).toBe('empresa');
    expect(despues[0]!.nombre).toBe('Caja general de ESTA empresa');

    // Y la global sigue ahí, para las demás empresas de la firma.
    const global = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ nombre: string }>(
        "SELECT nombre FROM account WHERE codigo = '110505' AND tenant_id IS NULL",
      );
      return rows[0]!;
    });
    expect(global.nombre).toBe('Caja general (genérica)');
  });

  it('esconder una cuenta genérica no la borra: crea la propia inactiva', async () => {
    await db.asAdmin(async (tx) => {
      await tx.query(
        `INSERT INTO account (tenant_id, company_id, codigo, nombre, nivel, naturaleza, permite_movimiento)
         VALUES (NULL, NULL, '1110', 'Bancos (genérica)', 3, 'debito', false)
         ON CONFLICT DO NOTHING`,
      );
    });

    await db.asTenant(e.tenantId, e.companyId, (tx) => ocultarCuentaGenerica(tx, '1110'));

    const efectiva = await db.asTenant(e.tenantId, e.companyId, (tx) => listarPucEfectivo(tx, { busqueda: '1110' }));
    expect(efectiva[0]!.activo).toBe(false);
    expect(efectiva[0]!.alcance).toBe('empresa');

    const sigueViva = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ activo: boolean }>(
        "SELECT activo FROM account WHERE codigo = '1110' AND tenant_id IS NULL",
      );
      return rows[0]!.activo;
    });
    expect(sigueViva).toBe(true);
  });

  it('apagar la herencia del genérico exige tener antes cuentas propias imputables (D-065)', async () => {
    const otra = await crearEscenario(db);
    // Esa empresa nace con cuentas propias del escenario, así que primero se
    // prueba el caso feo: una empresa sin ninguna cuenta propia imputable.
    await db.asAdmin(async (tx) => {
      await tx.query('UPDATE account SET permite_movimiento = false WHERE company_id = $1', [otra.companyId]);
    });

    await expect(
      db.asTenant(otra.tenantId, otra.companyId, (tx) => fijarModoPuc(tx, 'solo_propio')),
    ).rejects.toBeInstanceOf(ModoPucInvalidoError);

    expect(await db.asTenant(otra.tenantId, otra.companyId, (tx) => obtenerModoPuc(tx))).toBe('generico');
  });

  it('con el modo «solo propio» la empresa deja de ver el PUC genérico', async () => {
    const conHerencia = await db.asTenant(e.tenantId, e.companyId, (tx) => resumenPuc(tx));
    expect(conHerencia.globales).toBeGreaterThan(0);

    await db.asTenant(e.tenantId, e.companyId, (tx) => fijarModoPuc(tx, 'solo_propio'));
    const soloPropio = await db.asTenant(e.tenantId, e.companyId, (tx) => resumenPuc(tx));
    expect(soloPropio.soloPropio).toBe(true);
    expect(soloPropio.globales).toBe(0);
    expect(soloPropio.imputables).toBeGreaterThan(0);

    // Se deja como estaba para no contaminar las pruebas siguientes.
    await db.asTenant(e.tenantId, e.companyId, (tx) => fijarModoPuc(tx, 'generico'));
    expect(await db.asTenant(e.tenantId, e.companyId, (tx) => obtenerModoPuc(tx))).toBe('generico');
  });
});

// =============================================================================
// 6. RETEICA EN CASCADA (Tarea 5)
// =============================================================================

describe('A16 · la actividad económica de ReteICA depende del municipio', () => {
  it('un municipio sin ninguna regla de ICA no ofrece actividades, y dice por qué', async () => {
    const catalogo = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      listarActividadesIcaDeMunicipio(tx, e.municipalityId, '2026-06-15'),
    );
    expect(catalogo.opciones).toEqual([]);
    expect(catalogo.tieneReglaMunicipio).toBe(false);
    expect(catalogo.motivoVacio).toContain('no tiene ninguna regla de ReteICA cargada');
  });

  it('solo se ofrecen las actividades con tarifa cargada para ESE municipio', async () => {
    const otroMunicipio = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO municipality (tenant_id, codigo_dane, nombre, departamento, codigo_dane_departamento)
         VALUES ($1, '05001', 'Municipio con ICA', 'Departamento B', '05') RETURNING id`,
        [e.tenantId],
      );
      const municipioId = rows[0]!.id;

      const { rows: ciiu } = await tx.query<{ id: string }>(
        `INSERT INTO ciiu_activity (tenant_id, codigo, nombre)
         VALUES ($1, '4690', 'Comercio al por mayor') RETURNING id`,
        [e.tenantId],
      );

      const { rows: concepto } = await tx.query<{ id: string }>(
        `INSERT INTO tax_concept (tenant_id, company_id, tipo, codigo, nombre)
         VALUES ($1, NULL, 'reteica', 'ICA-COMERCIO', 'ICA comercio') RETURNING id`,
        [e.tenantId],
      );

      await tx.query(
        `INSERT INTO municipality_ica_rule (tenant_id, municipality_id, practica_reteica,
                                            usa_tarifa_de_actividad, periodicidad,
                                            vigente_desde, norma_respaldo)
         VALUES ($1, $2, true, true, 'bimestral', '2020-01-01', 'Acuerdo municipal de prueba')`,
        [e.tenantId, municipioId],
      );

      await tx.query(
        `INSERT INTO tax_rule (tenant_id, tax_concept_id, tipo, tarifa, aplica_a, tipo_persona,
                               municipality_id, ciiu_activity_id, vigente_desde, norma_respaldo)
         VALUES ($1, $2, 'reteica', $3, 'ambos', 'ambos', $4, $5, '2020-01-01', 'Acuerdo municipal de prueba')`,
        [e.tenantId, concepto[0]!.id, '0.005', municipioId, ciiu[0]!.id],
      );

      return { municipioId, ciiuId: ciiu[0]!.id };
    });

    const conTarifa = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      listarActividadesIcaDeMunicipio(tx, otroMunicipio.municipioId, '2026-06-15'),
    );
    expect(conTarifa.opciones.map((o) => o.codigo)).toEqual(['4690']);
    expect(conTarifa.motivoVacio).toBeNull();

    // El municipio del escenario, que no tiene ninguna tarifa, sigue vacío:
    // este es el defecto exacto que cerró la Ola 4 — antes los dos municipios
    // devolvían el catálogo CIIU completo, idéntico.
    const sinTarifa = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      listarActividadesIcaDeMunicipio(tx, e.municipalityId, '2026-06-15'),
    );
    expect(sinTarifa.opciones).toEqual([]);
    expect(sinTarifa.opciones).not.toEqual(conTarifa.opciones);
  });

  it('un municipio que NO practica ReteICA lo dice, en vez de ofrecer una lista vacía', async () => {
    const municipioId = await db.asAdmin(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO municipality (tenant_id, codigo_dane, nombre, departamento, codigo_dane_departamento)
         VALUES ($1, '05002', 'Municipio sin ICA', 'Departamento B', '05') RETURNING id`,
        [e.tenantId],
      );
      await tx.query(
        `INSERT INTO municipality_ica_rule (tenant_id, municipality_id, practica_reteica,
                                            usa_tarifa_de_actividad, periodicidad,
                                            vigente_desde, norma_respaldo)
         VALUES ($1, $2, false, true, 'anual', '2020-01-01', 'Acuerdo municipal de prueba')`,
        [e.tenantId, rows[0]!.id],
      );
      return rows[0]!.id;
    });

    const catalogo = await db.asTenant(e.tenantId, e.companyId, (tx) =>
      listarActividadesIcaDeMunicipio(tx, municipioId, '2026-06-15'),
    );
    expect(catalogo.practicaReteica).toBe(false);
    expect(catalogo.motivoVacio).toContain('NO practica');
  });
});

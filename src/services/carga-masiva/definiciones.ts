/**
 * A16 — Catálogo de lo que se puede cargar masivamente (Ola 4, Tareas 1, 2 y 3).
 *
 * ESTE ARCHIVO ES LA ÚNICA FUENTE DE VERDAD DE LA CARGA MASIVA. De él salen
 * tres cosas que hasta ahora habrían tenido que mantenerse sincronizadas a
 * mano y se habrían desincronizado a la primera:
 *
 *   1. las plantillas `.xlsx` de `/archivos-masivos/`
 *      (`scripts/generar-plantillas-masivas.ts`),
 *   2. la validación de cada fila del archivo que sube el usuario
 *      (`importar.ts`),
 *   3. la pantalla `/carga-masiva` que lista los catálogos y explica cada
 *      columna.
 *
 * Si mañana el esquema gana una columna obligatoria, se añade aquí una vez y
 * las tres cosas cambian juntas. Es exactamente el motivo por el que la Ola 4
 * pide «el script que las genera, no archivos estáticos sueltos».
 *
 * ─────────────────────────────────────────────────────────────────────────
 * D-071 — LA CARGA MASIVA NO ESCRIBE SQL. NUNCA.
 *
 * Ninguna definición de este archivo hace un `INSERT`. Cada una llama a la
 * función de servicio que ya existía para la carga fila a fila —`crearTercero`,
 * `registrarAtributosFiscales`, `guardarCuenta`, `crearOReemplazarTaxRule`…—
 * y por eso hereda, sin copiar una línea, las nueve banderas fiscales
 * obligatorias (D-014), la no retroactividad sobre lo publicado (6.2.3), la
 * norma de respaldo obligatoria (6.2.4), el permiso por trigger (6.2.5) y la
 * auditoría (Regla de Oro 6). Una tarifa cargada desde un `.xlsx` queda
 * exactamente igual de bien puesta que una tecleada a mano, porque la pone el
 * mismo código.
 *
 * La consecuencia de diseño es la que importa: `validar()` es una función PURA
 * que solo convierte texto a tipos y comprueba formatos, y `insertar()` no
 * valida nada de negocio. Si algún día alguien mete una regla tributaria en
 * `validar()`, habrá dos motores tributarios y uno de los dos estará mal.
 * ─────────────────────────────────────────────────────────────────────────
 */
import type { SqlClient } from '../../db/types';
import { PERMISOS, type Permiso } from '../../auth/permisos';
import {
  crearTercero,
  registrarAtributosFiscales,
  registrarActividad,
  type TipoDocumentoTercero,
  type RegimenTributario,
  type FuenteAtributoFiscal,
} from '../terceros';
import { guardarCuenta } from '../puc';
import {
  crearCalendarioTributario,
  crearOReemplazarMunicipioIca,
  crearOReemplazarNiifMapping,
  crearOReemplazarSmmlv,
  crearOReemplazarTaxRule,
  crearOReemplazarUvt,
  guardarCentroCosto,
  guardarCiiu,
  guardarMunicipio,
  guardarTaxConcept,
  resolverMunicipioPorDane,
  resolverTerceroPorDocumento,
  type TipoConceptoTributario,
} from '../catalogos';
import {
  booleano,
  booleanoOpcional,
  decimalOpcional,
  deLista,
  entero,
  fechaIso,
  fechaIsoOpcional,
  pesosACentavos,
  pesosACentavosOpcional,
  tarifaAFraccion,
  tarifaAFraccionOpcional,
  textoObligatorio,
  textoOpcional,
  ValorInvalidoError,
} from './valores';

// =============================================================================
// TIPOS DE LA DEFINICIÓN
// =============================================================================

export type TipoColumna =
  | 'texto'
  | 'entero'
  | 'decimal'
  | 'pesos'
  | 'tarifa'
  | 'fecha'
  | 'booleano'
  | 'lista'
  | 'codigo';

export interface ColumnaPlantilla {
  /** Encabezado EXACTO que espera el importador. */
  nombre: string;
  obligatoria: boolean;
  tipo: TipoColumna;
  /** Qué es, en una frase, para la hoja «Instrucciones». */
  descripcion: string;
  /** Valor de la fila de ejemplo de la plantilla. */
  ejemplo: string;
  /** Conjunto cerrado de valores: se convierte en lista desplegable de Excel. */
  valores?: readonly string[];
  /** De dónde salen los valores válidos cuando dependen de otro catálogo. */
  origen?: string;
}

export interface DefinicionCarga<T = unknown> {
  /** Identificador de la ruta `/carga-masiva/<clave>` y del archivo generado. */
  clave: string;
  titulo: string;
  /** Tabla real del esquema que se puebla. */
  tabla: string;
  /** Módulo del producto al que pertenece (ruta de la interfaz). */
  modulo: string;
  moduloRuta: string;
  /** Permiso que el motor exigirá. Aquí solo sirve para avisar antes. */
  permiso: Permiso;
  descripcion: string;
  /** Catálogos que hay que cargar ANTES que este. */
  requierePrevio?: readonly string[];
  advertencias?: readonly string[];
  columnas: readonly ColumnaPlantilla[];
  /** Texto → valor tipado. PURA: sin base de datos y sin reglas de negocio. */
  validar(fila: Record<string, string>): T;
  /**
   * Comprobaciones que necesitan la base pero NO escriben (resolver un código
   * DANE, un CIIU, un NIT). Devuelve un mensaje de error o `null`. Corre para
   * TODAS las filas antes de insertar ninguna, que es lo que permite decirle
   * al usuario «las filas 7 y 31 tienen un municipio que no existe» sin haber
   * escrito nada todavía.
   */
  comprobar?(tx: SqlClient, valor: T): Promise<string | null>;
  /** Llama al servicio de dominio. No valida nada por su cuenta (D-071). */
  insertar(tx: SqlClient, valor: T): Promise<void>;
}

// =============================================================================
// LISTAS CERRADAS COMPARTIDAS
// =============================================================================

const TIPOS_DOCUMENTO = [
  'NIT',
  'CC',
  'CE',
  'PA',
  'TI',
  'NIT_EXTRANJERO',
  'PEP',
  'PPT',
  'NUIP',
  'DEX',
] as const;

const SI_NO = ['SI', 'NO'] as const;

const REGIMENES = ['ordinario', 'simple', 'especial', 'no_contribuyente', 'no_residente'] as const;

const FUENTES = ['rut', 'declarado_por_cliente', 'factura', 'consulta_dian', 'otro'] as const;

const TIPOS_TRIBUTARIOS = [
  'retefuente',
  'reteiva',
  'reteica',
  'autorretencion',
  'iva',
  'retefuente_salarios',
] as const;

const CLASIFICACIONES_NIIF = [
  'activo_corriente',
  'activo_no_corriente',
  'pasivo_corriente',
  'pasivo_no_corriente',
  'patrimonio',
  'ingreso',
  'costo',
  'gasto',
  'otro_resultado_integral',
  'cuenta_de_orden',
] as const;

const PERIODICIDADES = ['mensual', 'bimestral', 'trimestral', 'cuatrimestral', 'anual'] as const;

const NORMA = {
  nombre: 'norma_respaldo',
  obligatoria: true,
  tipo: 'texto' as const,
  descripcion:
    'Decreto, ley, resolución o acuerdo que sustenta este dato (sección 6.2, punto 4). Sin ella no se guarda ' +
    'la fila: un dato tributario sin norma no es verificable por nadie.',
  ejemplo: 'Decreto 2650 de 1993',
};

const VIGENTE_DESDE = {
  nombre: 'vigente_desde',
  obligatoria: true,
  tipo: 'fecha' as const,
  descripcion:
    'Desde qué fecha rige. El motor resuelve SIEMPRE por la fecha del hecho económico, así que esta fecha ' +
    'decide a qué facturas se aplica el valor.',
  ejemplo: '2026-01-01',
};

const VIGENTE_HASTA = {
  nombre: 'vigente_hasta',
  obligatoria: false,
  tipo: 'fecha' as const,
  descripcion:
    'Hasta qué fecha rigió. Se deja VACÍO para el valor que sigue vigente hoy. Solo se llena al cargar ' +
    'histórico: dos vigencias abiertas de la misma clave se rechazan (PR002).',
  ejemplo: '',
};

const NOTAS = {
  nombre: 'notas',
  obligatoria: false,
  tipo: 'texto' as const,
  descripcion: 'Observación libre del contador. No la usa ningún cálculo.',
  ejemplo: '',
};

const VERIFICAR = {
  nombre: 'requiere_verificacion_humana',
  obligatoria: false,
  tipo: 'booleano' as const,
  valores: SI_NO,
  descripcion:
    'SI cuando el dato se cargó sin poder confirmar la norma. Aparece en el banner de alertas de ' +
    '/parametros hasta que alguien lo verifique. Vacío = NO.',
  ejemplo: 'NO',
};

const ALCANCE = {
  nombre: 'alcance',
  obligatoria: false,
  tipo: 'lista' as const,
  valores: ['firma', 'empresa'] as const,
  descripcion:
    '"firma" (por defecto) = el valor lo comparten todas las empresas-cliente de la firma. "empresa" = solo ' +
    'la empresa seleccionada en la sesión. Nunca se sobrescribe el valor nacional: se crea uno propio que lo tapa.',
  ejemplo: 'firma',
};

function alcanceDe(fila: Record<string, string>): 'firma' | 'empresa' | undefined {
  const v = deLista(fila.alcance ?? '', 'alcance', ['firma', 'empresa'] as const, false);
  return v ?? undefined;
}

// =============================================================================
// 1. TERCEROS
// =============================================================================

interface FilaTerceroImport {
  tipoDocumento: TipoDocumentoTercero;
  numeroDocumento: string;
  digitoVerificacion: number | null;
  tipoPersona: 'natural' | 'juridica';
  razonSocial: string;
  nombreComercial: string | null;
  direccion: string | null;
  municipioDane: string | null;
  esDelExterior: boolean;
  pais: string;
  email: string | null;
  telefono: string | null;
}

const TERCEROS: DefinicionCarga<FilaTerceroImport> = {
  clave: 'third_party',
  titulo: 'Terceros (proveedores y clientes)',
  tabla: 'third_party',
  modulo: 'Terceros',
  moduloRuta: '/terceros',
  permiso: PERMISOS.TERCERO_EDITAR,
  descripcion:
    'Maestro de terceros de la empresa seleccionada. Es el primer archivo que hay que cargar: sin el tercero ' +
    'creado, ni sus atributos fiscales ni su actividad económica tienen dónde colgarse, y la causación de sus ' +
    'facturas se bloquea al no poder resolver el NIT del emisor.',
  advertencias: [
    'Este archivo NO trae ninguna bandera fiscal (declarante, gran contribuyente, ...). Eso va en su propia ' +
      'plantilla, porque es un dato VERSIONADO con norma de respaldo y fecha de vigencia, no un atributo fijo ' +
      'del tercero.',
  ],
  columnas: [
    {
      nombre: 'tipo_documento',
      obligatoria: true,
      tipo: 'lista',
      valores: TIPOS_DOCUMENTO,
      descripcion: 'Tipo de documento de identificación del tercero.',
      ejemplo: 'NIT',
    },
    {
      nombre: 'numero_documento',
      obligatoria: true,
      tipo: 'texto',
      descripcion: 'Número sin puntos, sin guion y SIN el dígito de verificación.',
      ejemplo: '900123456',
    },
    {
      nombre: 'digito_verificacion',
      obligatoria: false,
      tipo: 'entero',
      descripcion: 'Dígito de verificación del NIT (0 a 9). Vacío si no se conoce o no aplica.',
      ejemplo: '7',
    },
    {
      nombre: 'tipo_persona',
      obligatoria: true,
      tipo: 'lista',
      valores: ['natural', 'juridica'] as const,
      descripcion: 'Persona natural o jurídica. Entra en la resolución de la tarifa de retefuente.',
      ejemplo: 'juridica',
    },
    {
      nombre: 'razon_social',
      obligatoria: true,
      tipo: 'texto',
      descripcion: 'Razón social, o el nombre completo si es persona natural.',
      ejemplo: 'Suministros Industriales del Norte SAS',
    },
    {
      nombre: 'nombre_comercial',
      obligatoria: false,
      tipo: 'texto',
      descripcion: 'Nombre con el que se le conoce, si difiere de la razón social.',
      ejemplo: 'Suminorte',
    },
    {
      nombre: 'direccion',
      obligatoria: true,
      tipo: 'texto',
      descripcion:
        'Dirección del informado. La exige el Formato 1001 de exógena (Res. 000227/2025, art. 1.3.5.2.1). ' +
        'Solo puede ir vacía si es_del_exterior = SI.',
      ejemplo: 'Calle 30 # 45-12',
    },
    {
      nombre: 'municipio_codigo_dane',
      obligatoria: true,
      tipo: 'codigo',
      origen:
        'Código DANE de 5 dígitos (2 de departamento + 3 de municipio), tal como lo publica el DANE en su ' +
        'división político-administrativa (DIVIPOLA). Los que ya están cargados se ven en la pantalla de ' +
        'municipios; los que falten se cargan con la plantilla de municipios.',
      descripcion:
        'Municipio del tercero. De él sale el DANE que exige exógena y el municipio por defecto de ReteICA. ' +
        'Vacío solo si es_del_exterior = SI.',
      ejemplo: '05001',
    },
    {
      nombre: 'es_del_exterior',
      obligatoria: false,
      tipo: 'booleano',
      valores: SI_NO,
      descripcion: 'SI para un tercero sin municipio colombiano. Vacío = NO.',
      ejemplo: 'NO',
    },
    {
      nombre: 'pais',
      obligatoria: false,
      tipo: 'texto',
      descripcion: 'Código ISO de dos letras. Vacío = CO.',
      ejemplo: 'CO',
    },
    { nombre: 'email', obligatoria: false, tipo: 'texto', descripcion: 'Correo de contacto.', ejemplo: 'facturacion@suminorte.co' },
    { nombre: 'telefono', obligatoria: false, tipo: 'texto', descripcion: 'Teléfono de contacto.', ejemplo: '6076543210' },
  ],
  validar(fila) {
    const esDelExterior = booleanoOpcional(fila.es_del_exterior ?? '', 'es_del_exterior', false);
    const dv = (fila.digito_verificacion ?? '').trim();
    return {
      tipoDocumento: deLista(fila.tipo_documento ?? '', 'tipo_documento', TIPOS_DOCUMENTO)! as TipoDocumentoTercero,
      numeroDocumento: textoObligatorio(fila.numero_documento ?? '', 'numero_documento'),
      digitoVerificacion: dv === '' ? null : entero(dv, 'digito_verificacion', 0, 9),
      tipoPersona: deLista(fila.tipo_persona ?? '', 'tipo_persona', ['natural', 'juridica'] as const)!,
      razonSocial: textoObligatorio(fila.razon_social ?? '', 'razon_social'),
      nombreComercial: textoOpcional(fila.nombre_comercial ?? ''),
      direccion: esDelExterior ? null : textoObligatorio(fila.direccion ?? '', 'direccion'),
      municipioDane: esDelExterior ? null : textoObligatorio(fila.municipio_codigo_dane ?? '', 'municipio_codigo_dane'),
      esDelExterior,
      pais: textoOpcional(fila.pais ?? '') ?? 'CO',
      email: textoOpcional(fila.email ?? ''),
      telefono: textoOpcional(fila.telefono ?? ''),
    };
  },
  async comprobar(tx, v) {
    if (v.municipioDane && !(await resolverMunicipioPorDane(tx, v.municipioDane))) {
      return `no existe ningún municipio con código DANE "${v.municipioDane}"`;
    }
    if (await resolverTerceroPorDocumento(tx, v.tipoDocumento, v.numeroDocumento)) {
      return `ya existe un tercero con ${v.tipoDocumento} ${v.numeroDocumento} en esta empresa`;
    }
    return null;
  },
  async insertar(tx, v) {
    const municipalityId = v.municipioDane ? await resolverMunicipioPorDane(tx, v.municipioDane) : null;
    await crearTercero(tx, {
      tipoDocumento: v.tipoDocumento,
      numeroDocumento: v.numeroDocumento,
      digitoVerificacion: v.digitoVerificacion,
      tipoPersona: v.tipoPersona,
      razonSocial: v.razonSocial,
      nombreComercial: v.nombreComercial,
      direccion: v.direccion,
      municipalityId,
      pais: v.pais,
      esDelExterior: v.esDelExterior,
      email: v.email,
      telefono: v.telefono,
    });
  },
};

// =============================================================================
// 2. ATRIBUTOS FISCALES DE TERCEROS
// =============================================================================

interface FilaAtributosImport {
  tipoDocumento: string;
  numeroDocumento: string;
  banderas: {
    esDeclaranteRenta: boolean;
    esAutorretenedorRenta: boolean;
    esGranContribuyente: boolean;
    esRegimenSimple: boolean;
    esResponsableIva: boolean;
    esAgenteRetencionRenta: boolean;
    esAgenteRetencionIva: boolean;
    esAgenteRetencionIca: boolean;
    esAutorretenedorIca: boolean;
  };
  regimenTributario: RegimenTributario;
  fuente: FuenteAtributoFiscal;
  vigenteDesde: string;
  normaRespaldo: string;
  notas: string | null;
  requiereVerificacionHumana: boolean;
}

const BANDERAS: Array<{ columna: string; campo: keyof FilaAtributosImport['banderas']; descripcion: string }> = [
  {
    columna: 'es_declarante_renta',
    campo: 'esDeclaranteRenta',
    descripcion:
      'La bandera más cara de equivocar: la tarifa de retefuente por compras y servicios NO es la misma según ' +
      'el proveedor declare renta o no (art. 392 y 401 ET). No se admite vacía.',
  },
  { columna: 'es_autorretenedor_renta', campo: 'esAutorretenedorRenta', descripcion: 'Si el tercero se autorretiene renta, la empresa no le practica retefuente.' },
  { columna: 'es_gran_contribuyente', campo: 'esGranContribuyente', descripcion: 'Calificado como gran contribuyente por la DIAN.' },
  { columna: 'es_regimen_simple', campo: 'esRegimenSimple', descripcion: 'Inscrito en el Régimen Simple de Tributación.' },
  { columna: 'es_responsable_iva', campo: 'esResponsableIva', descripcion: 'Responsable de IVA (antes «régimen común»).' },
  { columna: 'es_agente_retencion_renta', campo: 'esAgenteRetencionRenta', descripcion: 'Agente de retención de renta.' },
  { columna: 'es_agente_retencion_iva', campo: 'esAgenteRetencionIva', descripcion: 'Agente de retención de IVA.' },
  { columna: 'es_agente_retencion_ica', campo: 'esAgenteRetencionIca', descripcion: 'Agente de retención de ICA.' },
  { columna: 'es_autorretenedor_ica', campo: 'esAutorretenedorIca', descripcion: 'Autorretenedor de ICA.' },
];

const ATRIBUTOS_FISCALES: DefinicionCarga<FilaAtributosImport> = {
  clave: 'third_party_fiscal_attribute',
  titulo: 'Atributos fiscales de terceros (versionados)',
  tabla: 'third_party_fiscal_attribute',
  modulo: 'Terceros',
  moduloRuta: '/terceros',
  permiso: PERMISOS.TERCERO_ATRIBUTOS_FISCALES,
  descripcion:
    'Las nueve banderas fiscales de cada tercero, con su fecha de vigencia y su norma de respaldo. Entran ' +
    'directamente en el cálculo de la retención.',
  requierePrevio: ['third_party'],
  advertencias: [
    'LAS NUEVE BANDERAS SON OBLIGATORIAS, UNA POR UNA (D-014). Una celda vacía NO significa NO: significa que ' +
      'la fila se rechaza. Si la interfaz o el archivo asumieran "NO" por omisión, estarían inventando un dato ' +
      'con consecuencia tributaria: la tarifa de retefuente que resuelve el motor cambia según esa bandera.',
    'Cada fila es una VIGENCIA NUEVA, no una corrección. Si el tercero ya tiene atributos vigentes, esta fila ' +
      'los reemplaza a partir de vigente_desde y la anterior queda cerrada, nunca borrada.',
  ],
  columnas: [
    {
      nombre: 'tipo_documento',
      obligatoria: true,
      tipo: 'lista',
      valores: TIPOS_DOCUMENTO,
      descripcion: 'Identifica al tercero ya creado. Debe coincidir exactamente con el del maestro.',
      ejemplo: 'NIT',
    },
    {
      nombre: 'numero_documento',
      obligatoria: true,
      tipo: 'texto',
      origen: 'Los terceros ya cargados en /terceros.',
      descripcion: 'Número de documento del tercero ya creado.',
      ejemplo: '900123456',
    },
    ...BANDERAS.map((b) => ({
      nombre: b.columna,
      obligatoria: true,
      tipo: 'booleano' as const,
      valores: SI_NO,
      descripcion: b.descripcion,
      ejemplo: b.campo === 'esDeclaranteRenta' || b.campo === 'esResponsableIva' ? 'SI' : 'NO',
    })),
    {
      nombre: 'regimen_tributario',
      obligatoria: true,
      tipo: 'lista',
      valores: REGIMENES,
      descripcion: 'Régimen del tercero.',
      ejemplo: 'ordinario',
    },
    {
      nombre: 'fuente',
      obligatoria: false,
      tipo: 'lista',
      valores: FUENTES,
      descripcion: 'De dónde salió el dato. Vacío = declarado_por_cliente.',
      ejemplo: 'rut',
    },
    VIGENTE_DESDE,
    { ...NORMA, ejemplo: 'RUT actualizado 2026-01-15' },
    NOTAS,
    VERIFICAR,
  ],
  validar(fila) {
    const banderas = {} as FilaAtributosImport['banderas'];
    for (const b of BANDERAS) banderas[b.campo] = booleano(fila[b.columna] ?? '', b.columna);
    return {
      tipoDocumento: deLista(fila.tipo_documento ?? '', 'tipo_documento', TIPOS_DOCUMENTO)!,
      numeroDocumento: textoObligatorio(fila.numero_documento ?? '', 'numero_documento'),
      banderas,
      regimenTributario: deLista(fila.regimen_tributario ?? '', 'regimen_tributario', REGIMENES)! as RegimenTributario,
      fuente: (deLista(fila.fuente ?? '', 'fuente', FUENTES, false) ?? 'declarado_por_cliente') as FuenteAtributoFiscal,
      vigenteDesde: fechaIso(fila.vigente_desde ?? '', 'vigente_desde'),
      normaRespaldo: textoObligatorio(fila.norma_respaldo ?? '', 'norma_respaldo'),
      notas: textoOpcional(fila.notas ?? ''),
      requiereVerificacionHumana: booleanoOpcional(
        fila.requiere_verificacion_humana ?? '',
        'requiere_verificacion_humana',
        false,
      ),
    };
  },
  async comprobar(tx, v) {
    const id = await resolverTerceroPorDocumento(tx, v.tipoDocumento, v.numeroDocumento);
    return id ? null : `no existe el tercero ${v.tipoDocumento} ${v.numeroDocumento}: cárguelo primero`;
  },
  async insertar(tx, v) {
    const terceroId = await resolverTerceroPorDocumento(tx, v.tipoDocumento, v.numeroDocumento);
    await registrarAtributosFiscales(tx, {
      terceroId: terceroId!,
      ...v.banderas,
      regimenTributario: v.regimenTributario,
      fuente: v.fuente,
      vigenteDesde: v.vigenteDesde,
      normaRespaldo: v.normaRespaldo,
      notas: v.notas,
      requiereVerificacionHumana: v.requiereVerificacionHumana,
    });
  },
};

// =============================================================================
// 3. ACTIVIDAD ECONÓMICA DE TERCEROS (ReteICA multimunicipio)
// =============================================================================

interface FilaActividadImport {
  tipoDocumento: string;
  numeroDocumento: string;
  municipioDane: string;
  ciiuCodigo: string;
  esPrincipal: boolean;
  tarifaIcaOverride: string | null;
  vigenteDesde: string;
  normaRespaldo: string;
  notas: string | null;
}

const ACTIVIDADES_TERCERO: DefinicionCarga<FilaActividadImport> = {
  clave: 'third_party_activity',
  titulo: 'Actividad económica de terceros por municipio (ReteICA)',
  tabla: 'third_party_activity',
  modulo: 'Terceros',
  moduloRuta: '/terceros',
  permiso: PERMISOS.TERCERO_ATRIBUTOS_FISCALES,
  descripcion:
    'Dónde ejerce cada tercero y con qué actividad CIIU. Un proveedor puede tener varias vigentes a la vez ' +
    '(multimunicipio): cada terna tercero × municipio × CIIU se versiona por separado.',
  requierePrevio: ['third_party', 'municipality', 'ciiu_activity'],
  advertencias: [
    'La actividad y el municipio deben tener tarifa de ReteICA cargada para que el motor pueda calcular. Si no ' +
      'la tienen, la fila se carga igual pero queda marcada como pendiente de verificación humana y aparece en ' +
      'el banner de alertas — no se calla.',
  ],
  columnas: [
    { nombre: 'tipo_documento', obligatoria: true, tipo: 'lista', valores: TIPOS_DOCUMENTO, descripcion: 'Del tercero ya creado.', ejemplo: 'NIT' },
    { nombre: 'numero_documento', obligatoria: true, tipo: 'texto', descripcion: 'Del tercero ya creado.', ejemplo: '900123456' },
    {
      nombre: 'municipio_codigo_dane',
      obligatoria: true,
      tipo: 'codigo',
      origen: 'Plantilla de municipios / catálogo DANE de 5 dígitos.',
      descripcion: 'Municipio donde ejerce la actividad.',
      ejemplo: '05001',
    },
    {
      nombre: 'ciiu_codigo',
      obligatoria: true,
      tipo: 'codigo',
      origen: 'Plantilla de actividades CIIU (Res. DIAN 000114 de 2020), 4 dígitos.',
      descripcion: 'Actividad económica en ESE municipio.',
      ejemplo: '4690',
    },
    {
      nombre: 'es_principal',
      obligatoria: true,
      tipo: 'booleano',
      valores: SI_NO,
      descripcion: 'SI si es la actividad principal del tercero en ese municipio. No se admite vacía.',
      ejemplo: 'SI',
    },
    {
      nombre: 'tarifa_ica_override',
      obligatoria: false,
      tipo: 'tarifa',
      descripcion:
        'EXCEPCIONAL. Tarifa propia de este tercero. Se escribe como fracción decimal con coma, o como ' +
        'porcentaje añadiendo el signo de por ciento al final. Normalmente se deja vacía y la tarifa la ' +
        'resuelve la parametrización por municipio + actividad. Llenarla exige además el permiso parametro.editar.',
      ejemplo: '',
    },
    VIGENTE_DESDE,
    { ...NORMA, ejemplo: 'RIT municipal / certificado de matrícula' },
    NOTAS,
  ],
  validar(fila) {
    return {
      tipoDocumento: deLista(fila.tipo_documento ?? '', 'tipo_documento', TIPOS_DOCUMENTO)!,
      numeroDocumento: textoObligatorio(fila.numero_documento ?? '', 'numero_documento'),
      municipioDane: textoObligatorio(fila.municipio_codigo_dane ?? '', 'municipio_codigo_dane'),
      ciiuCodigo: textoObligatorio(fila.ciiu_codigo ?? '', 'ciiu_codigo'),
      esPrincipal: booleano(fila.es_principal ?? '', 'es_principal'),
      tarifaIcaOverride: tarifaAFraccionOpcional(fila.tarifa_ica_override ?? '', 'tarifa_ica_override'),
      vigenteDesde: fechaIso(fila.vigente_desde ?? '', 'vigente_desde'),
      normaRespaldo: textoObligatorio(fila.norma_respaldo ?? '', 'norma_respaldo'),
      notas: textoOpcional(fila.notas ?? ''),
    };
  },
  async comprobar(tx, v) {
    if (!(await resolverTerceroPorDocumento(tx, v.tipoDocumento, v.numeroDocumento))) {
      return `no existe el tercero ${v.tipoDocumento} ${v.numeroDocumento}`;
    }
    if (!(await resolverMunicipioPorDane(tx, v.municipioDane))) {
      return `no existe ningún municipio con código DANE "${v.municipioDane}"`;
    }
    const { rows } = await tx.query<{ id: string }>('SELECT id FROM ciiu_activity WHERE codigo = $1 LIMIT 1', [
      v.ciiuCodigo,
    ]);
    return rows[0] ? null : `no existe la actividad CIIU "${v.ciiuCodigo}"`;
  },
  async insertar(tx, v) {
    const terceroId = await resolverTerceroPorDocumento(tx, v.tipoDocumento, v.numeroDocumento);
    const municipalityId = await resolverMunicipioPorDane(tx, v.municipioDane);
    const { rows } = await tx.query<{ id: string }>('SELECT id FROM ciiu_activity WHERE codigo = $1 LIMIT 1', [
      v.ciiuCodigo,
    ]);
    await registrarActividad(tx, {
      terceroId: terceroId!,
      municipalityId: municipalityId!,
      ciiuActivityId: rows[0]!.id,
      esPrincipal: v.esPrincipal,
      tarifaIcaOverride: v.tarifaIcaOverride,
      vigenteDesde: v.vigenteDesde,
      normaRespaldo: v.normaRespaldo,
      notas: v.notas,
    });
  },
};

// =============================================================================
// 4. PLAN DE CUENTAS (PUC)
// =============================================================================

interface FilaCuentaImport {
  codigo: string;
  nombre: string;
  nivel: number | null;
  naturaleza: 'debito' | 'credito';
  permiteMovimiento: boolean;
  requiereTercero: boolean;
  requiereCentroCosto: boolean;
  requiereBaseGravable: boolean;
  activo: boolean;
  alcance: 'firma' | 'empresa' | undefined;
}

const PUC: DefinicionCarga<FilaCuentaImport> = {
  clave: 'account',
  titulo: 'Plan de cuentas (PUC)',
  tabla: 'account',
  modulo: 'Parámetros › Plan de cuentas',
  moduloRuta: '/parametros/puc',
  permiso: PERMISOS.PUC_EDITAR,
  descripcion:
    'El plan de cuentas de la empresa (o de la firma). Sobreescribe cuenta por cuenta el PUC genérico del ' +
    'Decreto 2650 que trae el sistema y le añade las que falten (D-064).',
  advertencias: [
    'ORDEN DEL ARCHIVO: de menor a mayor nivel. Una subcuenta 110505 necesita que ya exista 1105, que necesita ' +
      '11, que necesita 1. Si el padre no está cargado, la fila se rechaza con el código del padre que falta.',
    'El nivel se DEDUCE de la longitud del código (1 = clase, 2 = grupo, 4 = cuenta, 6 = subcuenta, 7+ = ' +
      'auxiliar). La columna nivel es opcional y solo sirve para que el sistema avise si no coincide.',
    'Para ESCONDER una cuenta del PUC genérico en esta empresa, cárguela con el mismo código y activo = NO.',
  ],
  columnas: [
    {
      nombre: 'codigo',
      obligatoria: true,
      tipo: 'codigo',
      descripcion: 'Código PUC, solo dígitos, sin puntos. 1, 11, 1105, 110505, 11050501...',
      ejemplo: '110505',
    },
    { nombre: 'nombre', obligatoria: true, tipo: 'texto', descripcion: 'Nombre de la cuenta.', ejemplo: 'Caja general' },
    {
      nombre: 'naturaleza',
      obligatoria: true,
      tipo: 'lista',
      valores: ['debito', 'credito'] as const,
      descripcion: 'Naturaleza de la cuenta: débito (activos, costos, gastos) o crédito (pasivos, patrimonio, ingresos).',
      ejemplo: 'debito',
    },
    {
      nombre: 'permite_movimiento',
      obligatoria: true,
      tipo: 'booleano',
      valores: SI_NO,
      descripcion:
        'SI solo en las cuentas donde se imputan partidas (las hojas del árbol). Las de agrupación van en NO. ' +
        'El ledger rechaza con LG004 cualquier partida contra una cuenta que no permita movimiento.',
      ejemplo: 'SI',
    },
    {
      nombre: 'nivel',
      obligatoria: false,
      tipo: 'entero',
      descripcion: 'Opcional. Si se llena debe coincidir con el que corresponde a la longitud del código.',
      ejemplo: '4',
    },
    {
      nombre: 'requiere_tercero',
      obligatoria: false,
      tipo: 'booleano',
      valores: SI_NO,
      descripcion: 'SI si toda partida contra esta cuenta debe indicar el tercero. Vacío = NO.',
      ejemplo: 'NO',
    },
    {
      nombre: 'requiere_centro_costo',
      obligatoria: false,
      tipo: 'booleano',
      valores: SI_NO,
      descripcion: 'SI si toda partida debe indicar centro de costo. Vacío = NO.',
      ejemplo: 'NO',
    },
    {
      nombre: 'requiere_base_gravable',
      obligatoria: false,
      tipo: 'booleano',
      valores: SI_NO,
      descripcion: 'SI en las cuentas de retención e IVA, donde la base gravable es parte del hecho. Vacío = NO.',
      ejemplo: 'NO',
    },
    {
      nombre: 'activo',
      obligatoria: false,
      tipo: 'booleano',
      valores: SI_NO,
      descripcion: 'Vacío = SI. Cárguela en NO para esconder una cuenta heredada del PUC genérico.',
      ejemplo: 'SI',
    },
    ALCANCE,
  ],
  validar(fila) {
    const nivel = (fila.nivel ?? '').trim();
    return {
      codigo: textoObligatorio(fila.codigo ?? '', 'codigo'),
      nombre: textoObligatorio(fila.nombre ?? '', 'nombre'),
      nivel: nivel === '' ? null : entero(nivel, 'nivel', 1, 5),
      naturaleza: deLista(fila.naturaleza ?? '', 'naturaleza', ['debito', 'credito'] as const)!,
      permiteMovimiento: booleano(fila.permite_movimiento ?? '', 'permite_movimiento'),
      requiereTercero: booleanoOpcional(fila.requiere_tercero ?? '', 'requiere_tercero', false),
      requiereCentroCosto: booleanoOpcional(fila.requiere_centro_costo ?? '', 'requiere_centro_costo', false),
      requiereBaseGravable: booleanoOpcional(fila.requiere_base_gravable ?? '', 'requiere_base_gravable', false),
      activo: booleanoOpcional(fila.activo ?? '', 'activo', true),
      alcance: alcanceDe(fila),
    };
  },
  async insertar(tx, v) {
    await guardarCuenta(tx, v);
  },
};

// =============================================================================
// 5. MAPEO NIIF DE CUENTAS
// =============================================================================

interface FilaNiifImport {
  cuentaCodigo: string;
  clasificacionNiif: string;
  seccionNiif: string | null;
  rubroEsf: string | null;
  rubroEri: string | null;
  rubroEfe: string | null;
  vigenteDesde: string;
  vigenteHasta: string | null;
  normaRespaldo: string;
  notas: string | null;
  requiereVerificacionHumana: boolean;
  alcance: 'firma' | 'empresa' | undefined;
}

const NIIF: DefinicionCarga<FilaNiifImport> = {
  clave: 'niif_mapping',
  titulo: 'Mapeo de cuentas PUC a NIIF para PYMES',
  tabla: 'niif_mapping',
  modulo: 'Parámetros › Plan de cuentas',
  moduloRuta: '/parametros/puc',
  permiso: PERMISOS.PUC_EDITAR,
  descripcion:
    'Dice en qué rubro de los estados financieros cae cada cuenta del PUC. Sin este mapeo, el Estado de ' +
    'Situación Financiera y el Estado de Resultado Integral no saben dónde poner la cuenta y salen incompletos.',
  requierePrevio: ['account'],
  columnas: [
    {
      nombre: 'cuenta_codigo',
      obligatoria: true,
      tipo: 'codigo',
      origen: 'El PUC efectivo de la empresa (/parametros/puc).',
      descripcion: 'Código de la cuenta que se está mapeando.',
      ejemplo: '110505',
    },
    {
      nombre: 'clasificacion_niif',
      obligatoria: true,
      tipo: 'lista',
      valores: CLASIFICACIONES_NIIF,
      descripcion: 'Categoría NIIF de la cuenta.',
      ejemplo: 'activo_corriente',
    },
    { nombre: 'seccion_niif', obligatoria: false, tipo: 'texto', descripcion: 'Sección del estándar. Ej.: "Sección 13 — Inventarios".', ejemplo: 'Sección 7 — Estado de Flujos de Efectivo' },
    { nombre: 'rubro_esf', obligatoria: false, tipo: 'texto', descripcion: 'Rubro del Estado de Situación Financiera.', ejemplo: 'Efectivo y equivalentes al efectivo' },
    { nombre: 'rubro_eri', obligatoria: false, tipo: 'texto', descripcion: 'Rubro del Estado de Resultado Integral.', ejemplo: '' },
    { nombre: 'rubro_efe', obligatoria: false, tipo: 'texto', descripcion: 'Rubro del Estado de Flujos de Efectivo.', ejemplo: 'Efectivo al final del período' },
    VIGENTE_DESDE,
    VIGENTE_HASTA,
    { ...NORMA, ejemplo: 'NIIF para las PYMES, Sección 4' },
    NOTAS,
    VERIFICAR,
    ALCANCE,
  ],
  validar(fila) {
    return {
      cuentaCodigo: textoObligatorio(fila.cuenta_codigo ?? '', 'cuenta_codigo'),
      clasificacionNiif: deLista(fila.clasificacion_niif ?? '', 'clasificacion_niif', CLASIFICACIONES_NIIF)!,
      seccionNiif: textoOpcional(fila.seccion_niif ?? ''),
      rubroEsf: textoOpcional(fila.rubro_esf ?? ''),
      rubroEri: textoOpcional(fila.rubro_eri ?? ''),
      rubroEfe: textoOpcional(fila.rubro_efe ?? ''),
      vigenteDesde: fechaIso(fila.vigente_desde ?? '', 'vigente_desde'),
      vigenteHasta: fechaIsoOpcional(fila.vigente_hasta ?? '', 'vigente_hasta'),
      normaRespaldo: textoObligatorio(fila.norma_respaldo ?? '', 'norma_respaldo'),
      notas: textoOpcional(fila.notas ?? ''),
      requiereVerificacionHumana: booleanoOpcional(fila.requiere_verificacion_humana ?? '', 'requiere_verificacion_humana', false),
      alcance: alcanceDe(fila),
    };
  },
  async comprobar(tx, v) {
    const { rows } = await tx.query<{ id: string }>('SELECT id FROM v_account_efectivo WHERE codigo = $1', [
      v.cuentaCodigo,
    ]);
    return rows[0] ? null : `no existe la cuenta PUC "${v.cuentaCodigo}" en el plan efectivo de esta empresa`;
  },
  async insertar(tx, v) {
    await crearOReemplazarNiifMapping(tx, v);
  },
};

// =============================================================================
// 6. MUNICIPIOS
// =============================================================================

interface FilaMunicipioImport {
  codigoDane: string;
  nombre: string;
  departamento: string;
  codigoDaneDepartamento: string;
  activo: boolean;
  alcance: 'firma' | 'empresa' | undefined;
}

const MUNICIPIOS: DefinicionCarga<FilaMunicipioImport> = {
  clave: 'municipality',
  titulo: 'Municipios (catálogo DANE)',
  tabla: 'municipality',
  modulo: 'Parámetros › ReteICA',
  moduloRuta: '/parametros/reteica-municipios',
  permiso: PERMISOS.PARAMETRO_EDITAR,
  descripcion:
    'Identidad estable de cada municipio. Es lo primero que hay que cargar para ReteICA: las reglas de ICA, la ' +
    'actividad económica de los terceros y el domicilio del tercero cuelgan del código DANE.',
  advertencias: [
    'El código DANE es de 5 dígitos CON el cero a la izquierda cuando lo lleva (05001 Medellín, no 5001). Si ' +
      'el archivo se editó en Excel, compruebe que la columna esté formateada como TEXTO o el cero se pierde.',
  ],
  columnas: [
    {
      nombre: 'codigo_dane',
      obligatoria: true,
      tipo: 'codigo',
      origen: 'División político-administrativa del DANE (DIVIPOLA). 5 dígitos.',
      descripcion: 'Código DANE del municipio.',
      ejemplo: '05001',
    },
    { nombre: 'nombre', obligatoria: true, tipo: 'texto', descripcion: 'Nombre del municipio.', ejemplo: 'Medellín' },
    { nombre: 'departamento', obligatoria: true, tipo: 'texto', descripcion: 'Nombre del departamento.', ejemplo: 'Antioquia' },
    {
      nombre: 'codigo_dane_departamento',
      obligatoria: true,
      tipo: 'codigo',
      origen: 'DIVIPOLA. Son los dos primeros dígitos del código del municipio.',
      descripcion: 'Código DANE del departamento, 2 dígitos.',
      ejemplo: '05',
    },
    { nombre: 'activo', obligatoria: false, tipo: 'booleano', valores: SI_NO, descripcion: 'Vacío = SI.', ejemplo: 'SI' },
    ALCANCE,
  ],
  validar(fila) {
    const codigoDane = textoObligatorio(fila.codigo_dane ?? '', 'codigo_dane');
    if (!/^\d{5}$/.test(codigoDane)) {
      throw new ValorInvalidoError(
        `"codigo_dane" debe tener exactamente 5 dígitos; vino "${codigoDane}". Si Excel le quitó el cero de la ` +
          'izquierda, formatee la columna como texto antes de escribirlo.',
      );
    }
    const codigoDpto = textoObligatorio(fila.codigo_dane_departamento ?? '', 'codigo_dane_departamento');
    if (!/^\d{2}$/.test(codigoDpto)) {
      throw new ValorInvalidoError(`"codigo_dane_departamento" debe tener exactamente 2 dígitos; vino "${codigoDpto}".`);
    }
    if (!codigoDane.startsWith(codigoDpto)) {
      throw new ValorInvalidoError(
        `El código del municipio (${codigoDane}) debería empezar por el del departamento (${codigoDpto}).`,
      );
    }
    return {
      codigoDane,
      nombre: textoObligatorio(fila.nombre ?? '', 'nombre'),
      departamento: textoObligatorio(fila.departamento ?? '', 'departamento'),
      codigoDaneDepartamento: codigoDpto,
      activo: booleanoOpcional(fila.activo ?? '', 'activo', true),
      alcance: alcanceDe(fila),
    };
  },
  async insertar(tx, v) {
    await guardarMunicipio(tx, v);
  },
};

// =============================================================================
// 7. ACTIVIDADES CIIU
// =============================================================================

interface FilaCiiuImport {
  codigo: string;
  nombre: string;
  seccion: string | null;
  division: string | null;
  activo: boolean;
  alcance: 'firma' | 'empresa' | undefined;
}

const CIIU: DefinicionCarga<FilaCiiuImport> = {
  clave: 'ciiu_activity',
  titulo: 'Actividades económicas CIIU',
  tabla: 'ciiu_activity',
  modulo: 'Parámetros',
  moduloRuta: '/parametros',
  permiso: PERMISOS.PARAMETRO_EDITAR,
  descripcion:
    'Catálogo CIIU rev. 4 A.C. Lo usan la actividad económica de los terceros (ReteICA) y las tarifas de ' +
    'autorretención por actividad.',
  columnas: [
    {
      nombre: 'codigo',
      obligatoria: true,
      tipo: 'codigo',
      origen: 'Resolución DIAN 000114 de 2020 (CIIU rev. 4 adaptada para Colombia). Exactamente 4 dígitos.',
      descripcion: 'Código CIIU de la actividad.',
      ejemplo: '4690',
    },
    { nombre: 'nombre', obligatoria: true, tipo: 'texto', descripcion: 'Descripción de la actividad.', ejemplo: 'Comercio al por mayor no especializado' },
    { nombre: 'seccion', obligatoria: false, tipo: 'texto', descripcion: 'Letra de la sección CIIU.', ejemplo: 'G' },
    { nombre: 'division', obligatoria: false, tipo: 'texto', descripcion: 'División (2 dígitos).', ejemplo: '46' },
    { nombre: 'activo', obligatoria: false, tipo: 'booleano', valores: SI_NO, descripcion: 'Vacío = SI.', ejemplo: 'SI' },
    ALCANCE,
  ],
  validar(fila) {
    const codigo = textoObligatorio(fila.codigo ?? '', 'codigo');
    if (!/^\d{4}$/.test(codigo)) {
      throw new ValorInvalidoError(`"codigo" CIIU debe tener exactamente 4 dígitos; vino "${codigo}".`);
    }
    return {
      codigo,
      nombre: textoObligatorio(fila.nombre ?? '', 'nombre'),
      seccion: textoOpcional(fila.seccion ?? ''),
      division: textoOpcional(fila.division ?? ''),
      activo: booleanoOpcional(fila.activo ?? '', 'activo', true),
      alcance: alcanceDe(fila),
    };
  },
  async insertar(tx, v) {
    await guardarCiiu(tx, v);
  },
};

// =============================================================================
// 8. REGLAS DE RETEICA POR MUNICIPIO
// =============================================================================

interface FilaIcaImport {
  municipioDane: string;
  practicaReteica: boolean;
  baseMinimaServiciosUvt: string | null;
  baseMinimaComprasUvt: string | null;
  baseMinimaServiciosValor: string | null;
  baseMinimaComprasValor: string | null;
  usaTarifaDeActividad: boolean;
  tarifaGeneral: string | null;
  periodicidad: (typeof PERIODICIDADES)[number];
  vigenteDesde: string;
  normaRespaldo: string;
  notas: string | null;
  requiereVerificacionHumana: boolean;
  alcanceNuevo: 'firma' | 'empresa' | undefined;
}

const ICA_MUNICIPIOS: DefinicionCarga<FilaIcaImport> = {
  clave: 'municipality_ica_rule',
  titulo: 'Reglas de ReteICA por municipio (bases mínimas y tarifa general)',
  tabla: 'municipality_ica_rule',
  modulo: 'Parámetros › ReteICA',
  moduloRuta: '/parametros/reteica-municipios',
  permiso: PERMISOS.PARAMETRO_EDITAR,
  descripcion:
    'Por municipio: si practica retención de ICA, sus bases mínimas y su periodicidad. Las tarifas POR ' +
    'ACTIVIDAD van en la plantilla de tarifas tributarias (tipo reteica), no aquí.',
  requierePrevio: ['municipality'],
  advertencias: [
    'La base mínima se escribe en UVT o en pesos, NUNCA en las dos columnas a la vez: la fila se rechaza. Los ' +
      'acuerdos municipales usan una u otra y mezclarlas haría no determinista el cálculo.',
  ],
  columnas: [
    {
      nombre: 'municipio_codigo_dane',
      obligatoria: true,
      tipo: 'codigo',
      origen: 'Plantilla de municipios / DIVIPOLA.',
      descripcion: 'Municipio al que aplica la regla.',
      ejemplo: '05001',
    },
    {
      nombre: 'practica_reteica',
      obligatoria: true,
      tipo: 'booleano',
      valores: SI_NO,
      descripcion: 'NO para municipios que no tienen retención de ICA. Se carga igual, para que quede dicho.',
      ejemplo: 'SI',
    },
    { nombre: 'base_minima_servicios_uvt', obligatoria: false, tipo: 'decimal', descripcion: 'Base mínima de servicios, en UVT.', ejemplo: '4' },
    { nombre: 'base_minima_compras_uvt', obligatoria: false, tipo: 'decimal', descripcion: 'Base mínima de compras, en UVT.', ejemplo: '27' },
    { nombre: 'base_minima_servicios_pesos', obligatoria: false, tipo: 'pesos', descripcion: 'Base mínima de servicios en pesos, si el acuerdo la fija así. Excluyente con la de UVT.', ejemplo: '' },
    { nombre: 'base_minima_compras_pesos', obligatoria: false, tipo: 'pesos', descripcion: 'Base mínima de compras en pesos. Excluyente con la de UVT.', ejemplo: '' },
    {
      nombre: 'usa_tarifa_de_actividad',
      obligatoria: true,
      tipo: 'booleano',
      valores: SI_NO,
      descripcion: 'SI cuando la tarifa depende del CIIU (lo habitual). NO cuando el municipio aplica una tarifa única.',
      ejemplo: 'SI',
    },
    {
      nombre: 'tarifa_general',
      obligatoria: false,
      tipo: 'tarifa',
      descripcion:
        'Solo si usa_tarifa_de_actividad = NO. Se escribe como fracción decimal con coma, o como porcentaje ' +
        'añadiendo el signo de por ciento al final.',
      ejemplo: '',
    },
    {
      nombre: 'periodicidad',
      obligatoria: true,
      tipo: 'lista',
      valores: PERIODICIDADES,
      descripcion: 'Cada cuánto se declara el ICA en ese municipio.',
      ejemplo: 'bimestral',
    },
    VIGENTE_DESDE,
    { ...NORMA, ejemplo: 'Acuerdo Municipal 066 de 2017, art. 12' },
    NOTAS,
    VERIFICAR,
    { ...ALCANCE, nombre: 'alcance' },
  ],
  validar(fila) {
    const servUvt = decimalOpcional(fila.base_minima_servicios_uvt ?? '', 'base_minima_servicios_uvt');
    const compUvt = decimalOpcional(fila.base_minima_compras_uvt ?? '', 'base_minima_compras_uvt');
    const servPesos = pesosACentavosOpcional(fila.base_minima_servicios_pesos ?? '', 'base_minima_servicios_pesos');
    const compPesos = pesosACentavosOpcional(fila.base_minima_compras_pesos ?? '', 'base_minima_compras_pesos');
    if (servUvt !== null && servPesos !== null) {
      throw new ValorInvalidoError('La base mínima de servicios viene en UVT y en pesos a la vez: deje solo una.');
    }
    if (compUvt !== null && compPesos !== null) {
      throw new ValorInvalidoError('La base mínima de compras viene en UVT y en pesos a la vez: deje solo una.');
    }
    const usaActividad = booleano(fila.usa_tarifa_de_actividad ?? '', 'usa_tarifa_de_actividad');
    const tarifaGeneral = tarifaAFraccionOpcional(fila.tarifa_general ?? '', 'tarifa_general');
    if (!usaActividad && tarifaGeneral === null) {
      throw new ValorInvalidoError(
        'Si usa_tarifa_de_actividad = NO hay que escribir la tarifa_general: si no, el municipio queda sin ' +
          'ninguna tarifa con la que calcular.',
      );
    }
    return {
      municipioDane: textoObligatorio(fila.municipio_codigo_dane ?? '', 'municipio_codigo_dane'),
      practicaReteica: booleano(fila.practica_reteica ?? '', 'practica_reteica'),
      baseMinimaServiciosUvt: servUvt,
      baseMinimaComprasUvt: compUvt,
      baseMinimaServiciosValor: servPesos,
      baseMinimaComprasValor: compPesos,
      usaTarifaDeActividad: usaActividad,
      tarifaGeneral,
      periodicidad: deLista(fila.periodicidad ?? '', 'periodicidad', PERIODICIDADES)!,
      vigenteDesde: fechaIso(fila.vigente_desde ?? '', 'vigente_desde'),
      normaRespaldo: textoObligatorio(fila.norma_respaldo ?? '', 'norma_respaldo'),
      notas: textoOpcional(fila.notas ?? ''),
      requiereVerificacionHumana: booleanoOpcional(fila.requiere_verificacion_humana ?? '', 'requiere_verificacion_humana', false),
      alcanceNuevo: alcanceDe(fila),
    };
  },
  async comprobar(tx, v) {
    return (await resolverMunicipioPorDane(tx, v.municipioDane))
      ? null
      : `no existe ningún municipio con código DANE "${v.municipioDane}"`;
  },
  async insertar(tx, v) {
    await crearOReemplazarMunicipioIca(tx, v);
  },
};

// =============================================================================
// 9. CONCEPTOS TRIBUTARIOS
// =============================================================================

interface FilaConceptoImport {
  tipo: TipoConceptoTributario;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  alcance: 'firma' | 'empresa' | undefined;
}

const CONCEPTOS: DefinicionCarga<FilaConceptoImport> = {
  clave: 'tax_concept',
  titulo: 'Conceptos tributarios',
  tabla: 'tax_concept',
  modulo: 'Parámetros › Tarifas',
  moduloRuta: '/parametros',
  permiso: PERMISOS.PARAMETRO_EDITAR,
  descripcion:
    'El «qué se retiene»: compras, servicios generales, honorarios, arrendamientos... De cada concepto cuelgan ' +
    'sus tarifas versionadas. Hay que cargarlos ANTES que las tarifas.',
  columnas: [
    { nombre: 'tipo', obligatoria: true, tipo: 'lista', valores: TIPOS_TRIBUTARIOS, descripcion: 'Familia del concepto.', ejemplo: 'retefuente' },
    { nombre: 'codigo', obligatoria: true, tipo: 'texto', descripcion: 'Código corto y estable con el que se referencia desde la plantilla de tarifas.', ejemplo: 'HONORARIOS' },
    { nombre: 'nombre', obligatoria: true, tipo: 'texto', descripcion: 'Nombre legible del concepto.', ejemplo: 'Honorarios y comisiones' },
    { nombre: 'descripcion', obligatoria: false, tipo: 'texto', descripcion: 'Detalle o referencia normativa del concepto.', ejemplo: 'Art. 392 ET' },
    { nombre: 'activo', obligatoria: false, tipo: 'booleano', valores: SI_NO, descripcion: 'Vacío = SI.', ejemplo: 'SI' },
    ALCANCE,
  ],
  validar(fila) {
    return {
      tipo: deLista(fila.tipo ?? '', 'tipo', TIPOS_TRIBUTARIOS)! as TipoConceptoTributario,
      codigo: textoObligatorio(fila.codigo ?? '', 'codigo'),
      nombre: textoObligatorio(fila.nombre ?? '', 'nombre'),
      descripcion: textoOpcional(fila.descripcion ?? ''),
      activo: booleanoOpcional(fila.activo ?? '', 'activo', true),
      alcance: alcanceDe(fila),
    };
  },
  async insertar(tx, v) {
    await guardarTaxConcept(tx, v);
  },
};

// =============================================================================
// 10 y 11. TARIFAS TRIBUTARIAS
// =============================================================================

interface FilaTarifaImport {
  tipo: TipoConceptoTributario;
  conceptoCodigo: string;
  tarifa: string;
  baseMinimaUvt: string | null;
  baseMinimaValor: string | null;
  aplicaSobre: string | undefined;
  aplicaA: 'declarante' | 'no_declarante' | 'ambos';
  tipoPersona: 'natural' | 'juridica' | 'ambos';
  municipioDane: string | null;
  ciiuCodigo: string | null;
  rangoDesdeUvt: string | null;
  rangoHastaUvt: string | null;
  uvtAdicionales: string | null;
  cuentaCodigo: string | null;
  vigenteDesde: string;
  vigenteHasta: string | null;
  normaRespaldo: string;
  notas: string | null;
  requiereVerificacionHumana: boolean;
  alcance: 'firma' | 'empresa' | undefined;
}

function validarTarifa(fila: Record<string, string>, tipoFijo?: TipoConceptoTributario): FilaTarifaImport {
  const tipo = tipoFijo ?? (deLista(fila.tipo ?? '', 'tipo', TIPOS_TRIBUTARIOS)! as TipoConceptoTributario);
  const baseUvt = decimalOpcional(fila.base_minima_uvt ?? '', 'base_minima_uvt');
  const basePesos = pesosACentavosOpcional(fila.base_minima_pesos ?? '', 'base_minima_pesos');
  if (baseUvt !== null && basePesos !== null) {
    throw new ValorInvalidoError('La base mínima viene en UVT y en pesos a la vez: deje solo una.');
  }
  return {
    tipo,
    conceptoCodigo: textoObligatorio(fila.concepto_codigo ?? '', 'concepto_codigo'),
    tarifa: tarifaAFraccion(fila.tarifa ?? '', 'tarifa'),
    baseMinimaUvt: baseUvt,
    baseMinimaValor: basePesos,
    aplicaSobre:
      deLista(fila.aplica_sobre ?? '', 'aplica_sobre', ['base_gravable', 'valor_iva', 'aiu', 'base_menos_iva'] as const, false) ??
      undefined,
    aplicaA: deLista(fila.aplica_a ?? '', 'aplica_a', ['declarante', 'no_declarante', 'ambos'] as const, false) ?? 'ambos',
    tipoPersona: deLista(fila.tipo_persona ?? '', 'tipo_persona', ['natural', 'juridica', 'ambos'] as const, false) ?? 'ambos',
    municipioDane: textoOpcional(fila.municipio_codigo_dane ?? ''),
    ciiuCodigo: textoOpcional(fila.ciiu_codigo ?? ''),
    rangoDesdeUvt: decimalOpcional(fila.rango_desde_uvt ?? '', 'rango_desde_uvt'),
    rangoHastaUvt: decimalOpcional(fila.rango_hasta_uvt ?? '', 'rango_hasta_uvt'),
    uvtAdicionales: decimalOpcional(fila.uvt_adicionales ?? '', 'uvt_adicionales'),
    cuentaCodigo: textoOpcional(fila.cuenta_codigo ?? ''),
    vigenteDesde: fechaIso(fila.vigente_desde ?? '', 'vigente_desde'),
    vigenteHasta: fechaIsoOpcional(fila.vigente_hasta ?? '', 'vigente_hasta'),
    normaRespaldo: textoObligatorio(fila.norma_respaldo ?? '', 'norma_respaldo'),
    notas: textoOpcional(fila.notas ?? ''),
    requiereVerificacionHumana: booleanoOpcional(fila.requiere_verificacion_humana ?? '', 'requiere_verificacion_humana', false),
    alcance: alcanceDe(fila),
  };
}

const COLUMNAS_TARIFA_COMUNES: ColumnaPlantilla[] = [
  {
    nombre: 'concepto_codigo',
    obligatoria: true,
    tipo: 'texto',
    origen: 'La plantilla de conceptos tributarios. Debe existir ya, con el mismo "tipo".',
    descripcion: 'Concepto al que cuelga la tarifa.',
    ejemplo: 'HONORARIOS',
  },
  {
    nombre: 'tarifa',
    obligatoria: true,
    tipo: 'tarifa',
    descripcion:
      'Se escribe como fracción decimal con coma, o como porcentaje añadiendo el signo de por ciento al ' +
      'final. El signo no es decorativo: cambia el valor por cien, así que un número mayor que uno sin el ' +
      'signo se rechaza en vez de adivinar cuál de las dos cosas quiso decir. El ejemplo de la plantilla es ' +
      'un valor obviamente falso: aquí no se trae ninguna tarifa real, porque alguien podría cargarla ' +
      'creyendo que es la buena (Regla de Oro 2).',
    ejemplo: '0,5',
  },
  { nombre: 'base_minima_uvt', obligatoria: false, tipo: 'decimal', descripcion: 'Base mínima en UVT. Excluyente con la de pesos.', ejemplo: '0' },
  { nombre: 'base_minima_pesos', obligatoria: false, tipo: 'pesos', descripcion: 'Base mínima en pesos, sin separador de miles. Excluyente con la de UVT.', ejemplo: '' },
  {
    nombre: 'aplica_sobre',
    obligatoria: false,
    tipo: 'lista',
    valores: ['base_gravable', 'valor_iva', 'aiu', 'base_menos_iva'] as const,
    descripcion:
      'Sobre qué se aplica la tarifa. Vacío = base_gravable. ReteIVA va sobre "valor_iva"; vigilancia y aseo, sobre "aiu".',
    ejemplo: 'base_gravable',
  },
  {
    nombre: 'aplica_a',
    obligatoria: false,
    tipo: 'lista',
    valores: ['declarante', 'no_declarante', 'ambos'] as const,
    descripcion: 'Discrimina por si el tercero declara renta. Vacío = ambos.',
    ejemplo: 'ambos',
  },
  {
    nombre: 'tipo_persona',
    obligatoria: false,
    tipo: 'lista',
    valores: ['natural', 'juridica', 'ambos'] as const,
    descripcion: 'Discrimina por naturaleza del tercero. Vacío = ambos.',
    ejemplo: 'ambos',
  },
  {
    nombre: 'cuenta_codigo',
    obligatoria: false,
    tipo: 'codigo',
    origen: 'El PUC efectivo (/parametros/puc).',
    descripcion: 'Cuenta PUC donde se registra la retención.',
    ejemplo: '236540',
  },
  VIGENTE_DESDE,
  VIGENTE_HASTA,
  { ...NORMA, ejemplo: 'Art. 392 ET / Decreto 260 de 2001' },
  NOTAS,
  VERIFICAR,
  ALCANCE,
];

const TARIFAS: DefinicionCarga<FilaTarifaImport> = {
  clave: 'tax_rule',
  titulo: 'Tarifas de retención (retefuente, ReteIVA, ReteICA, autorretención, IVA)',
  tabla: 'tax_rule',
  modulo: 'Parámetros › Tarifas',
  moduloRuta: '/parametros',
  permiso: PERMISOS.PARAMETRO_EDITAR,
  descripcion:
    'Tarifas versionadas por vigencia. Cada fila es una VIGENCIA NUEVA: si ya hay una abierta para la misma ' +
    'combinación de concepto, discriminadores, municipio y actividad, esta la reemplaza cerrándola — nunca la ' +
    'sobrescribe.',
  requierePrevio: ['tax_concept'],
  advertencias: [
    'Para ReteICA hay que llenar municipio_codigo_dane y ciiu_codigo: sin ellos la tarifa no se puede resolver ' +
      'por municipio y el motor manda la factura a revisión.',
    'La tabla progresiva de salarios del art. 383 ET tiene su propia plantilla, porque necesita los tramos en UVT.',
  ],
  columnas: [
    {
      nombre: 'tipo',
      obligatoria: true,
      tipo: 'lista',
      valores: TIPOS_TRIBUTARIOS.filter((t) => t !== 'retefuente_salarios'),
      descripcion: 'Familia de la retención. Debe coincidir con el tipo del concepto.',
      ejemplo: 'retefuente',
    },
    ...COLUMNAS_TARIFA_COMUNES.slice(0, 7),
    {
      nombre: 'municipio_codigo_dane',
      obligatoria: false,
      tipo: 'codigo',
      origen: 'Plantilla de municipios / DIVIPOLA.',
      descripcion: 'Solo para ReteICA: municipio de la tarifa.',
      ejemplo: '',
    },
    {
      nombre: 'ciiu_codigo',
      obligatoria: false,
      tipo: 'codigo',
      origen: 'Plantilla de actividades CIIU.',
      descripcion: 'Solo para ReteICA y autorretención por actividad.',
      ejemplo: '',
    },
    ...COLUMNAS_TARIFA_COMUNES.slice(7),
  ],
  validar(fila) {
    const v = validarTarifa(fila);
    if (v.tipo === 'retefuente_salarios') {
      throw new ValorInvalidoError(
        'La tabla progresiva de salarios (art. 383 ET) se carga con su propia plantilla, que pide los tramos en UVT.',
      );
    }
    if (v.tipo === 'reteica' && !v.municipioDane) {
      throw new ValorInvalidoError(
        'Una tarifa de ReteICA sin municipio no se puede resolver: llene municipio_codigo_dane.',
      );
    }
    return v;
  },
  async comprobar(tx, v) {
    if (v.municipioDane && !(await resolverMunicipioPorDane(tx, v.municipioDane))) {
      return `no existe ningún municipio con código DANE "${v.municipioDane}"`;
    }
    const { rows } = await tx.query<{ id: string }>(
      'SELECT id FROM tax_concept WHERE tipo = $1 AND codigo = $2 LIMIT 1',
      [v.tipo, v.conceptoCodigo],
    );
    return rows[0] ? null : `no existe el concepto "${v.conceptoCodigo}" de tipo "${v.tipo}"`;
  },
  async insertar(tx, v) {
    await crearOReemplazarTaxRule(tx, v);
  },
};

const TARIFAS_SALARIOS: DefinicionCarga<FilaTarifaImport> = {
  clave: 'tax_rule_salarios',
  titulo: 'Tabla progresiva de retención por salarios (art. 383 ET)',
  tabla: 'tax_rule (tipo retefuente_salarios)',
  modulo: 'Parámetros › Tarifas',
  moduloRuta: '/parametros/tarifas/retefuente_salarios',
  permiso: PERMISOS.PARAMETRO_EDITAR,
  descripcion:
    'Los tramos marginales del art. 383 ET, en UVT. Cada fila es UN tramo: desde cuántas UVT, hasta cuántas, ' +
    'qué tarifa marginal se aplica al exceso y cuántas UVT se suman por los tramos anteriores.',
  requierePrevio: ['tax_concept'],
  advertencias: [
    'Es la misma tabla `tax_rule` que las demás tarifas, con tipo = retefuente_salarios y los tres campos de ' +
      'tramo llenos. No hay una tabla aparte: el motor resuelve por vigencia igual que todo lo demás, así que ' +
      'una tabla nueva sería un segundo sitio donde el mismo hecho puede quedar desactualizado.',
    'Los tramos NO se pueden solapar y el primero empieza en 0 UVT. Cárguelos en orden ascendente.',
    'El último tramo se deja con rango_hasta_uvt VACÍO: es el tramo abierto por arriba.',
  ],
  columnas: [
    {
      nombre: 'concepto_codigo',
      obligatoria: true,
      tipo: 'texto',
      origen: 'La plantilla de conceptos tributarios, con tipo = retefuente_salarios.',
      descripcion: 'Concepto de la tabla progresiva.',
      ejemplo: 'ART383',
    },
    {
      nombre: 'rango_desde_uvt',
      obligatoria: true,
      tipo: 'decimal',
      descripcion: 'UVT desde las que aplica este tramo (inclusive). El primer tramo va en 0.',
      ejemplo: '95',
    },
    {
      nombre: 'rango_hasta_uvt',
      obligatoria: false,
      tipo: 'decimal',
      descripcion: 'UVT hasta las que aplica. VACÍO en el último tramo (abierto por arriba).',
      ejemplo: '150',
    },
    {
      nombre: 'tarifa',
      obligatoria: true,
      tipo: 'tarifa',
      descripcion:
        'Tarifa MARGINAL del tramo, la que se aplica al exceso. Se escribe como fracción decimal con coma, o ' +
        'como porcentaje añadiendo el signo de por ciento al final. El ejemplo es un valor obviamente falso: ' +
        'la plantilla no trae tarifas reales (Regla de Oro 2).',
      ejemplo: '0,5',
    },
    {
      nombre: 'uvt_adicionales',
      obligatoria: false,
      tipo: 'decimal',
      descripcion: 'UVT que se suman por los tramos anteriores ya recorridos. En el primer tramo, 0.',
      ejemplo: '0',
    },
    {
      nombre: 'cuenta_codigo',
      obligatoria: false,
      tipo: 'codigo',
      origen: 'El PUC efectivo.',
      descripcion: 'Cuenta PUC donde se registra la retención de salarios.',
      ejemplo: '',
    },
    VIGENTE_DESDE,
    VIGENTE_HASTA,
    { ...NORMA, ejemplo: 'Art. 383 ET, modificado por Ley 2277 de 2022' },
    NOTAS,
    VERIFICAR,
    ALCANCE,
  ],
  validar(fila) {
    const v = validarTarifa({ ...fila, tipo: 'retefuente_salarios' }, 'retefuente_salarios');
    if (v.rangoDesdeUvt === null) {
      throw new ValorInvalidoError('Un tramo de la tabla del art. 383 necesita rango_desde_uvt.');
    }
    if (v.rangoHastaUvt !== null && Number(v.rangoHastaUvt) < Number(v.rangoDesdeUvt)) {
      throw new ValorInvalidoError(
        `El tramo va de ${v.rangoDesdeUvt} a ${v.rangoHastaUvt} UVT: el final no puede ser menor que el inicio.`,
      );
    }
    return v;
  },
  async comprobar(tx, v) {
    const { rows } = await tx.query<{ id: string }>(
      "SELECT id FROM tax_concept WHERE tipo = 'retefuente_salarios' AND codigo = $1 LIMIT 1",
      [v.conceptoCodigo],
    );
    return rows[0] ? null : `no existe el concepto "${v.conceptoCodigo}" de tipo retefuente_salarios`;
  },
  async insertar(tx, v) {
    await crearOReemplazarTaxRule(tx, v);
  },
};

// =============================================================================
// 12 y 13. UVT Y SMMLV
// =============================================================================

interface FilaUvtImport {
  anio: number;
  valorCentavos: string;
  vigenteDesde: string;
  vigenteHasta: string | null;
  normaRespaldo: string;
  notas: string | null;
  requiereVerificacionHumana: boolean;
  alcance: 'firma' | 'empresa' | undefined;
}

const UVT: DefinicionCarga<FilaUvtImport> = {
  clave: 'uvt_value',
  titulo: 'UVT por año',
  tabla: 'uvt_value',
  modulo: 'Parámetros › Valores base',
  moduloRuta: '/parametros/valores-base',
  permiso: PERMISOS.PARAMETRO_EDITAR,
  descripcion:
    'Valor de la Unidad de Valor Tributario por año. De él salen todas las bases mínimas expresadas en UVT, ' +
    'así que un año mal cargado desplaza todas las retenciones de ese año.',
  advertencias: [
    'Solo puede haber UNA vigencia abierta a la vez. Al cargar varios años, ponga vigente_hasta a los ' +
      'anteriores (31 de diciembre de su año) y deje vacío solo el del año en curso.',
  ],
  columnas: [
    { nombre: 'anio', obligatoria: true, tipo: 'entero', descripcion: 'Año gravable al que corresponde la UVT.', ejemplo: '2026' },
    {
      nombre: 'valor_pesos',
      obligatoria: true,
      tipo: 'pesos',
      descripcion:
        'Valor de la UVT en pesos, SIN separador de miles. Se guarda internamente en centavos (D-005). ' +
        'El ejemplo dice 1 A PROPÓSITO: esta plantilla no trae ningún valor de UVT de muestra, porque un ' +
        'valor normativo escrito en el producto es justo lo que prohíbe la Regla de Oro 2 y alguien podría ' +
        'cargarlo creyendo que es el bueno. Copie el de la resolución del año.',
      ejemplo: '1',
    },
    VIGENTE_DESDE,
    VIGENTE_HASTA,
    { ...NORMA, ejemplo: 'Resolución DIAN 000238 del 15-dic-2025' },
    NOTAS,
    VERIFICAR,
    ALCANCE,
  ],
  validar(fila) {
    return {
      anio: entero(fila.anio ?? '', 'anio', 2000, 2100),
      valorCentavos: pesosACentavos(fila.valor_pesos ?? '', 'valor_pesos'),
      vigenteDesde: fechaIso(fila.vigente_desde ?? '', 'vigente_desde'),
      vigenteHasta: fechaIsoOpcional(fila.vigente_hasta ?? '', 'vigente_hasta'),
      normaRespaldo: textoObligatorio(fila.norma_respaldo ?? '', 'norma_respaldo'),
      notas: textoOpcional(fila.notas ?? ''),
      requiereVerificacionHumana: booleanoOpcional(fila.requiere_verificacion_humana ?? '', 'requiere_verificacion_humana', false),
      alcance: alcanceDe(fila),
    };
  },
  async insertar(tx, v) {
    await crearOReemplazarUvt(tx, v);
  },
};

interface FilaSmmlvImport extends Omit<FilaUvtImport, 'valorCentavos'> {
  valorMensualCentavos: string;
  auxilioTransporteCentavos: string | null;
}

const SMMLV: DefinicionCarga<FilaSmmlvImport> = {
  clave: 'smmlv_value',
  titulo: 'SMMLV y auxilio de transporte por año',
  tabla: 'smmlv_value',
  modulo: 'Parámetros › Valores base',
  moduloRuta: '/parametros/valores-base',
  permiso: PERMISOS.PARAMETRO_EDITAR,
  descripcion: 'Salario mínimo mensual legal vigente y auxilio de transporte, por año.',
  advertencias: ['Igual que la UVT: solo una vigencia abierta a la vez.'],
  columnas: [
    { nombre: 'anio', obligatoria: true, tipo: 'entero', descripcion: 'Año al que corresponde el salario mínimo.', ejemplo: '2026' },
    {
      nombre: 'valor_mensual_pesos',
      obligatoria: true,
      tipo: 'pesos',
      descripcion:
        'Salario mínimo mensual en pesos, sin separador de miles. El ejemplo dice 1 a propósito, por el mismo ' +
        'motivo que la UVT: la plantilla no trae valores normativos de muestra. Copie el del decreto del año.',
      ejemplo: '1',
    },
    {
      nombre: 'auxilio_transporte_pesos',
      obligatoria: false,
      tipo: 'pesos',
      descripcion: 'Auxilio de transporte mensual en pesos. Se deja vacío si el decreto no lo fija.',
      ejemplo: '',
    },
    VIGENTE_DESDE,
    VIGENTE_HASTA,
    { ...NORMA, ejemplo: 'Decreto de salario mínimo del año correspondiente' },
    NOTAS,
    VERIFICAR,
    ALCANCE,
  ],
  validar(fila) {
    return {
      anio: entero(fila.anio ?? '', 'anio', 2000, 2100),
      valorMensualCentavos: pesosACentavos(fila.valor_mensual_pesos ?? '', 'valor_mensual_pesos'),
      auxilioTransporteCentavos: pesosACentavosOpcional(fila.auxilio_transporte_pesos ?? '', 'auxilio_transporte_pesos'),
      vigenteDesde: fechaIso(fila.vigente_desde ?? '', 'vigente_desde'),
      vigenteHasta: fechaIsoOpcional(fila.vigente_hasta ?? '', 'vigente_hasta'),
      normaRespaldo: textoObligatorio(fila.norma_respaldo ?? '', 'norma_respaldo'),
      notas: textoOpcional(fila.notas ?? ''),
      requiereVerificacionHumana: booleanoOpcional(fila.requiere_verificacion_humana ?? '', 'requiere_verificacion_humana', false),
      alcance: alcanceDe(fila),
    };
  },
  async insertar(tx, v) {
    await crearOReemplazarSmmlv(tx, v);
  },
};

// =============================================================================
// 14. CALENDARIO TRIBUTARIO
// =============================================================================

interface FilaCalendarioImport {
  anio: number;
  tipoObligacion: string;
  periodo: string;
  ultimoDigitoNit: string;
  fechaVencimiento: string;
  municipioDane: string | null;
  vigenteDesde: string;
  vigenteHasta: string | null;
  normaRespaldo: string;
  notas: string | null;
  requiereVerificacionHumana: boolean;
  alcance: 'firma' | 'empresa' | undefined;
}

const CALENDARIO: DefinicionCarga<FilaCalendarioImport> = {
  clave: 'tax_calendar',
  titulo: 'Calendario tributario (vencimientos)',
  tabla: 'tax_calendar',
  modulo: 'Parámetros',
  moduloRuta: '/parametros',
  permiso: PERMISOS.PARAMETRO_EDITAR,
  descripcion:
    'Fechas de vencimiento por año, obligación, período y último dígito del NIT. Es lo que alimenta el aviso ' +
    'de vencimientos próximos. El decreto de plazos sale cada diciembre y son cientos de filas: es el caso ' +
    'canónico de carga masiva.',
  advertencias: [
    'Una fila por combinación de obligación, período y dígito. Si el decreto agrupa dos dígitos en una fecha, ' +
      'escriba dos filas — o use el par de dígitos (ej. "01") si así lo publica la norma.',
    'Para vencimientos de ICA municipal llene municipio_codigo_dane; para los nacionales déjelo vacío.',
  ],
  columnas: [
    { nombre: 'anio', obligatoria: true, tipo: 'entero', descripcion: 'Año del calendario.', ejemplo: '2026' },
    {
      nombre: 'tipo_obligacion',
      obligatoria: true,
      tipo: 'texto',
      descripcion:
        'Nombre de la obligación tal como la nombra el decreto de plazos. Ej.: "retencion_en_la_fuente", ' +
        '"iva_bimestral", "renta_personas_juridicas", "ica_municipal".',
      ejemplo: 'retencion_en_la_fuente',
    },
    {
      nombre: 'periodo',
      obligatoria: true,
      tipo: 'texto',
      descripcion: 'Período que se declara. Ej.: "01" (enero), "2026-B1" (primer bimestre), "anual".',
      ejemplo: '01',
    },
    {
      nombre: 'ultimo_digito_nit',
      obligatoria: true,
      tipo: 'texto',
      descripcion:
        'Un dígito (0-9), dos dígitos (00-99) o la palabra "todos" cuando la fecha no depende del NIT.',
      ejemplo: '1',
    },
    { nombre: 'fecha_vencimiento', obligatoria: true, tipo: 'fecha', descripcion: 'Fecha límite de presentación y pago.', ejemplo: '2026-02-10' },
    {
      nombre: 'municipio_codigo_dane',
      obligatoria: false,
      tipo: 'codigo',
      origen: 'Plantilla de municipios / DIVIPOLA.',
      descripcion: 'Solo para obligaciones municipales (ICA). Vacío para las nacionales.',
      ejemplo: '',
    },
    VIGENTE_DESDE,
    VIGENTE_HASTA,
    { ...NORMA, ejemplo: 'Decreto de plazos DIAN del año correspondiente' },
    NOTAS,
    VERIFICAR,
    ALCANCE,
  ],
  validar(fila) {
    return {
      anio: entero(fila.anio ?? '', 'anio', 2000, 2100),
      tipoObligacion: textoObligatorio(fila.tipo_obligacion ?? '', 'tipo_obligacion'),
      periodo: textoObligatorio(fila.periodo ?? '', 'periodo'),
      ultimoDigitoNit: textoObligatorio(fila.ultimo_digito_nit ?? '', 'ultimo_digito_nit'),
      fechaVencimiento: fechaIso(fila.fecha_vencimiento ?? '', 'fecha_vencimiento'),
      municipioDane: textoOpcional(fila.municipio_codigo_dane ?? ''),
      vigenteDesde: fechaIso(fila.vigente_desde ?? '', 'vigente_desde'),
      vigenteHasta: fechaIsoOpcional(fila.vigente_hasta ?? '', 'vigente_hasta'),
      normaRespaldo: textoObligatorio(fila.norma_respaldo ?? '', 'norma_respaldo'),
      notas: textoOpcional(fila.notas ?? ''),
      requiereVerificacionHumana: booleanoOpcional(fila.requiere_verificacion_humana ?? '', 'requiere_verificacion_humana', false),
      alcance: alcanceDe(fila),
    };
  },
  async comprobar(tx, v) {
    if (v.municipioDane && !(await resolverMunicipioPorDane(tx, v.municipioDane))) {
      return `no existe ningún municipio con código DANE "${v.municipioDane}"`;
    }
    return null;
  },
  async insertar(tx, v) {
    await crearCalendarioTributario(tx, v);
  },
};

// =============================================================================
// 15. CENTROS DE COSTO
// =============================================================================

interface FilaCentroCostoImport {
  codigo: string;
  nombre: string;
  codigoPadre: string | null;
  activo: boolean;
}

const CENTROS_COSTO: DefinicionCarga<FilaCentroCostoImport> = {
  clave: 'cost_center',
  titulo: 'Centros de costo',
  tabla: 'cost_center',
  modulo: 'Parámetros › Plan de cuentas',
  moduloRuta: '/parametros/puc',
  permiso: PERMISOS.PUC_EDITAR,
  descripcion:
    'Centros de costo de la empresa seleccionada. Los exigen las cuentas marcadas con requiere_centro_costo.',
  advertencias: ['Ponga los centros padre antes que sus hijos en el archivo.'],
  columnas: [
    { nombre: 'codigo', obligatoria: true, tipo: 'texto', descripcion: 'Código del centro de costo, único en la empresa.', ejemplo: '01' },
    { nombre: 'nombre', obligatoria: true, tipo: 'texto', descripcion: 'Nombre del centro de costo.', ejemplo: 'Administración' },
    { nombre: 'codigo_padre', obligatoria: false, tipo: 'texto', descripcion: 'Código del centro de costo padre, si es una subdivisión.', ejemplo: '' },
    { nombre: 'activo', obligatoria: false, tipo: 'booleano', valores: SI_NO, descripcion: 'Vacío = SI.', ejemplo: 'SI' },
  ],
  validar(fila) {
    return {
      codigo: textoObligatorio(fila.codigo ?? '', 'codigo'),
      nombre: textoObligatorio(fila.nombre ?? '', 'nombre'),
      codigoPadre: textoOpcional(fila.codigo_padre ?? ''),
      activo: booleanoOpcional(fila.activo ?? '', 'activo', true),
    };
  },
  async insertar(tx, v) {
    await guardarCentroCosto(tx, v);
  },
};

// =============================================================================
// EL CATÁLOGO
// =============================================================================

/**
 * Orden deliberado: es el orden en el que hay que cargar los archivos. Cada
 * uno solo depende de los anteriores. La pantalla `/carga-masiva` los muestra
 * en este orden por la misma razón.
 */
export const DEFINICIONES: readonly DefinicionCarga<never>[] = [
  MUNICIPIOS,
  CIIU,
  PUC,
  CENTROS_COSTO,
  NIIF,
  CONCEPTOS,
  TARIFAS,
  TARIFAS_SALARIOS,
  ICA_MUNICIPIOS,
  UVT,
  SMMLV,
  CALENDARIO,
  TERCEROS,
  ATRIBUTOS_FISCALES,
  ACTIVIDADES_TERCERO,
] as unknown as readonly DefinicionCarga<never>[];

export function definicionPorClave(clave: string): DefinicionCarga<never> | undefined {
  // Clave PROPIA, no acceso directo por índice: un `clave` que sea una clave
  // del prototipo de Object (`__proto__`, `constructor`) devolvería algo
  // truthy que no es una definición. Es el mismo agujero que A14 encontró en
  // la ruta de reportes (V-19) y se cierra igual.
  return DEFINICIONES.find((d) => d.clave === clave);
}

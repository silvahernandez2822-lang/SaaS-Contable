/**
 * A7 — Orquestación de la bandeja de causación multi-empresa (Ola 2, sección 4).
 *
 * Cada función de `src/services/*` recibe un `tx` YA situado en UNA empresa
 * (D-021/D-022): ninguna sabe leer "varias empresas a la vez", y así debe
 * seguir siendo (Regla de Oro 7 — el aislamiento lo impone la base, nunca un
 * filtro de aplicación). Lo que la bandeja de una sola pantalla necesita es
 * justo la orquestación de ESTE archivo: listar las empresas accesibles
 * (`app.empresas_accesibles()`, migración 070) y abrir, una por una, una
 * sesión real por empresa (`conSesionEmpresa`), agregando los resultados
 * aquí — en `app/`, no en `src/services/`.
 *
 * RENDIMIENTO, DECLARADO: esto es tantas transacciones como empresas
 * accesibles (hasta 30-60). Se ejecutan EN SECUENCIA, no en paralelo: el
 * cliente de base de datos de este repositorio (PGlite en pruebas, una
 * conexión de `postgres.js` en producción, ver `src/db/client.ts`) no está
 * pensado para abrir transacciones concurrentes entre sí, y paralelizar
 * agregaría una complejidad de pool que el presupuesto de la sección 5 no
 * pide todavía. Con 30-60 empresas y una consulta acotada por
 * `LIMITE_POR_EMPRESA`, el costo total es de decenas de consultas pequeñas,
 * no de un recorrido masivo — aceptable para una pantalla que un contador abre
 * una vez y no para cada factura. Si el volumen creciera, la optimización
 * natural es un pool de conexiones en `src/db/client.ts`, no tocar RLS.
 */
import { conSesionEmpresa } from './sesion';
import { empresasVisiblesParaLaSesion, sesionTienePermiso } from './empresas';
import {
  listarMunicipiosParaCorreccion,
  listarPendientesRevision,
  listarRechazadas,
  type CorreccionesVigentes,
  type DocumentoEnRevision,
  type DocumentoRechazado,
  type EmpresaAccesible,
  type MotivoRevision,
  type MunicipioOpcion,
} from '../../src/services/bandeja';
import { listarPendientesDeAprobacion, type EstadoDocumento } from '../../src/services/consulta';
import { listarTerceros } from '../../src/services/terceros';
import type { LineaExtraida } from '../../src/services/ingest';

export interface FilaAprobacion extends EstadoDocumento {
  companyId: string;
  companyNombre: string;
}

export interface FilaRevision extends DocumentoEnRevision {
  companyId: string;
  companyNombre: string;
}

export interface FilaRechazada extends DocumentoRechazado {
  companyId: string;
  companyNombre: string;
}

/** Tercero real de alguna de las empresas accesibles, para el autocompletar
 * del filtro por proveedor (deduplicado por documento). */
export interface ProveedorOpcion {
  numeroDocumento: string;
  razonSocial: string;
}

/** Filtros de la bandeja de aprobación (D-079). Todos opcionales; una cadena
 * vacía es "sin filtro". */
export interface FiltrosBandeja {
  desde?: string;
  hasta?: string;
  proveedor?: string;
  montoMinCentavos?: number | null;
  montoMaxCentavos?: number | null;
  /** Score de confianza mínimo, en puntos porcentuales 0–100. */
  scoreMin?: number | null;
}

export interface BandejaConsolidada {
  empresas: EmpresaAccesible[];
  pendientesAprobacion: FilaAprobacion[];
  pendientesRevision: FilaRevision[];
  rechazadas: FilaRechazada[];
  /** Catálogo de municipios (global + de cada empresa visitada), para el
   * desplegable de corrección de V-8. Deduplicado por id. */
  municipios: MunicipioOpcion[];
  /** Terceros reales, para el autocompletar del filtro por proveedor. */
  proveedores: ProveedorOpcion[];
  /** Filtros efectivamente aplicados (eco de la petición, ya normalizados). */
  filtros: FiltrosBandeja;
  /** Total de documentos pendientes de aprobación ANTES de aplicar los
   * filtros de proveedor/monto/score, para poder decir "3 de 12". */
  totalAprobacionSinFiltrar: number;
  /** D-092-bis. `false` = la sesión no tiene `documento.leer` en NINGUNA parte:
   *  la bandeja viene vacía porque no se pudo mirar, no porque no haya trabajo.
   *  Quien pinta la pantalla tiene que decirlo — un "todo al día" falso es peor
   *  que un error. */
  puedeLeerDocumentos: boolean;
  /** D-092-bis. Empresas SALTADAS por falta de `documento.leer` en esa empresa
   *  concreta. Existe de verdad desde D-092: una excepción individual
   *  (`user_permission_override`) es por empresa, así que un mismo usuario
   *  puede leer documentos en unas sí y en otras no. */
  empresasSinPermiso: string[];
  /** Empresas cuya lista de pendientes llegó AL TOPE (`LIMITE_POR_EMPRESA`):
   * casi con seguridad tienen más documentos esperando aprobación de los que
   * esta pantalla muestra. A14 (compuerta de D-079): sin este aviso, una
   * factura de la empresa 37 podía quedarse indefinidamente sin aprobar sin
   * que nadie viera que existía. */
  empresasTruncadas: string[];
}

/** Tope por empresa, no total: con 60 empresas y 20 documentos cada una, el
 * peor caso son 1.200 filas — de sobra para una pantalla de trabajo diario;
 * una firma con más volumen pendiente por empresa necesita paginar por
 * empresa, no cargar más de una vez por petición. */
const LIMITE_POR_EMPRESA = 20;

/** Reexportados para que las páginas de `app/bandeja/**` no importen de `src/services` directamente. */
export type {
  CorreccionesVigentes,
  DocumentoEnRevision,
  DocumentoRechazado,
  EmpresaAccesible,
  LineaExtraida,
  MotivoRevision,
  MunicipioOpcion,
};

function limpia(v: string | undefined): string {
  return (v ?? '').trim();
}

/** Fecha ISO `AAAA-MM-DD` REAL (no basta el patrón: `2026-13-45` lo cumple).
 * A14, compuerta de D-079: `desde`/`hasta` bajan a la consulta con un
 * `::date`; una cadena arbitraria en la URL reventaba la bandeja entera de las
 * 30-60 empresas con un `22007` sin manejar. Lo que no es una fecha, no
 * filtra. */
function fechaIsoOenUndefined(v: string | undefined): string | undefined {
  const s = limpia(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? undefined : s;
}

/** Normaliza los filtros crudos de la URL a la forma que consume la bandeja. */
export function normalizarFiltros(crudos: Record<string, string | undefined>): FiltrosBandeja {
  const numeroOenNull = (v: string | undefined): number | null => {
    const s = limpia(v);
    if (s === '') return null;
    const n = Number(s.replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) ? Math.round(n) : null;
  };
  /** El formulario pide PESOS ("Monto mín. (pesos)"); el documento guarda
   * CENTAVOS (Regla de Oro 5). A14, compuerta de D-079: sin esta conversión un
   * filtro «hasta $1.000.000» escondía todo lo que pasara de $10.000 — es
   * decir, escondía facturas que sí había que aprobar. */
  const pesosACentavosOenNull = (v: string | undefined): number | null => {
    const s = limpia(v);
    if (s === '') return null;
    const n = Number(s.replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) ? Math.round(n * 100) : null;
  };
  return {
    desde: fechaIsoOenUndefined(crudos.desde),
    hasta: fechaIsoOenUndefined(crudos.hasta),
    proveedor: limpia(crudos.proveedor) || undefined,
    montoMinCentavos: pesosACentavosOenNull(crudos.montoMin),
    montoMaxCentavos: pesosACentavosOenNull(crudos.montoMax),
    scoreMin: numeroOenNull(crudos.scoreMin),
  };
}

function pasaFiltrosCliente(fila: FilaAprobacion, f: FiltrosBandeja): boolean {
  if (f.proveedor) {
    const aguja = f.proveedor.toLowerCase();
    const pajar = `${fila.emisorNit} ${fila.emisorNombre ?? ''}`.toLowerCase();
    if (!pajar.includes(aguja)) return false;
  }
  const total = fila.totalBrutoCentavos != null ? Number(fila.totalBrutoCentavos) : null;
  if (f.montoMinCentavos != null) {
    if (total == null || total < f.montoMinCentavos) return false;
  }
  if (f.montoMaxCentavos != null) {
    if (total == null || total > f.montoMaxCentavos) return false;
  }
  if (f.scoreMin != null) {
    if (fila.scoreConfianza == null || fila.scoreConfianza < f.scoreMin) return false;
  }
  return true;
}

export async function obtenerBandejaConsolidada(
  filtros: FiltrosBandeja = {},
): Promise<BandejaConsolidada> {
  // Sesión "de firma" (sin empresa, D-015/D-022): es exactamente para lo que
  // sirve `app.empresas_accesibles()` — saber cuáles hay ANTES de elegir una.
  //
  // D-092-bis: esa función exige `documento.leer` EN EL MOTOR, y aquí se
  // llamaba sin red. Un usuario válido sin ese permiso (el administrador
  // acotado que D-092 hizo creable desde `/admin/roles`) recibía un `SE002` sin
  // capturar que reventaba la portada entera. `empresasVisiblesParaLaSesion`
  // pregunta antes de pedir — no relaja ningún permiso: si no hay
  // `documento.leer`, NO se consulta ni un documento.
  const visibles = await conSesionEmpresa('', (tx) => empresasVisiblesParaLaSesion(tx));
  const empresas = visibles.empresas;

  const todaAprobacion: FilaAprobacion[] = [];
  const pendientesRevision: FilaRevision[] = [];
  const rechazadas: FilaRechazada[] = [];
  const municipiosPorId = new Map<string, MunicipioOpcion>();
  const proveedoresPorDoc = new Map<string, ProveedorOpcion>();
  const empresasTruncadas: string[] = [];
  const empresasSinPermiso: string[] = [];

  // V-59 (A14, compuerta de cierre de D-092). El parche de D-092-bis dejó vivo
  // el bucle de abajo también cuando la lista de empresas viene por la vía
  // `firma` (`listarEmpresasDeLaFirma`), y esa lista son las empresas de la
  // FIRMA, no «las mías» — así lo declara la propia ficha. `conSesionEmpresa`
  // abre una sesión POR EMPRESA y `withSessionContext` RECHAZA la empresa sobre
  // la que la sesión no tiene acceso vigente: `EmpresaNoAutorizadaError`, más un
  // `ACCESO_DENEGADO` escrito en `audit_log` por cada una. Con una empresa por
  // firma —el escenario de la prueba de D-092-bis— no se ve nunca. Con dos, que
  // es el producto real (30-60 empresas-cliente por firma), el administrador
  // acotado vuelve a recibir el mismo error 500 de antes del parche, y la
  // alarma de seguridad se llena de intrusiones falsas que genera el propio
  // producto al pintar una portada.
  //
  // `accesibles` es el ÚNICO origen en el que cada empresa de la lista está
  // garantizada como accesible por la sesión (`app.empresas_accesibles()`
  // resuelve por `user_company_access`) y como legible (exige `documento.leer`).
  // En cualquier otro origen no hay nada que leer: la bandeja sale vacía con
  // `puedeLeerDocumentos: false`, que es lo que la pantalla ya sabe decir.
  if (visibles.origen !== 'accesibles') {
    return {
      empresas,
      pendientesAprobacion: [],
      pendientesRevision: [],
      rechazadas: [],
      municipios: [],
      proveedores: [],
      filtros,
      totalAprobacionSinFiltrar: 0,
      puedeLeerDocumentos: visibles.puedeLeerDocumentos,
      empresasSinPermiso,
      empresasTruncadas,
    };
  }

  for (const empresa of empresas) {
    // El permiso se resuelve POR EMPRESA (D-092: la excepción individual es por
    // empresa), así que se pregunta dentro de la sesión de cada una. Saltar la
    // empresa no relaja nada: es no pedir lo que el motor ya iba a negar, y
    // queda anotado para que la pantalla no cante un "todo al día" falso.
    // Se pregunta DENTRO de la misma transacción de la empresa: ni una sesión
    // más de las que ya había (el coste declarado en la cabecera no cambia).
    const datos = await conSesionEmpresa(empresa.companyId, async (tx) => {
      if (!(await sesionTienePermiso(tx, 'documento.leer'))) return null;
      return Promise.all([
        listarPendientesDeAprobacion(tx, {
          limite: LIMITE_POR_EMPRESA,
          desde: filtros.desde ?? null,
          hasta: filtros.hasta ?? null,
        }),
        listarPendientesRevision(tx, { limite: LIMITE_POR_EMPRESA }),
        listarRechazadas(tx, { limite: LIMITE_POR_EMPRESA }),
        listarMunicipiosParaCorreccion(tx),
        listarTerceros(tx, { soloActivos: true }),
      ]);
    });
    if (datos === null) {
      empresasSinPermiso.push(empresa.razonSocial);
      continue;
    }
    const [aprobacion, revision, rechaz, municipios, terceros] = datos;
    if (aprobacion.length >= LIMITE_POR_EMPRESA) empresasTruncadas.push(empresa.razonSocial);
    for (const doc of aprobacion) {
      todaAprobacion.push({ ...doc, companyId: empresa.companyId, companyNombre: empresa.razonSocial });
    }
    for (const doc of revision) {
      pendientesRevision.push({ ...doc, companyId: empresa.companyId, companyNombre: empresa.razonSocial });
    }
    for (const doc of rechaz) {
      rechazadas.push({ ...doc, companyId: empresa.companyId, companyNombre: empresa.razonSocial });
    }
    for (const m of municipios) municipiosPorId.set(m.id, m);
    for (const t of terceros) {
      proveedoresPorDoc.set(t.numeroDocumento, {
        numeroDocumento: t.numeroDocumento,
        razonSocial: t.razonSocial,
      });
    }
  }

  const pendientesAprobacion = todaAprobacion
    .filter((fila) => pasaFiltrosCliente(fila, filtros))
    .sort((a, b) => a.fechaHechoEconomico.localeCompare(b.fechaHechoEconomico));
  pendientesRevision.sort((a, b) => a.fechaHechoEconomico.localeCompare(b.fechaHechoEconomico));
  rechazadas.sort((a, b) => b.fechaHechoEconomico.localeCompare(a.fechaHechoEconomico));

  const municipios = [...municipiosPorId.values()].sort(
    (a, b) => a.departamento.localeCompare(b.departamento) || a.nombre.localeCompare(b.nombre),
  );
  const proveedores = [...proveedoresPorDoc.values()].sort((a, b) =>
    a.razonSocial.localeCompare(b.razonSocial),
  );

  return {
    empresas,
    pendientesAprobacion,
    pendientesRevision,
    rechazadas,
    municipios,
    proveedores,
    filtros,
    totalAprobacionSinFiltrar: todaAprobacion.length,
    puedeLeerDocumentos: visibles.puedeLeerDocumentos,
    empresasSinPermiso,
    empresasTruncadas,
  };
}

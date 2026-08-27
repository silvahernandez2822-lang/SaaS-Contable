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
import {
  listarEmpresasAccesibles,
  listarMunicipiosParaCorreccion,
  listarPendientesRevision,
  type CorreccionesVigentes,
  type DocumentoEnRevision,
  type EmpresaAccesible,
  type MotivoRevision,
  type MunicipioOpcion,
} from '../../src/services/bandeja';
import { listarPendientesDeAprobacion, type EstadoDocumento } from '../../src/services/consulta';
import type { LineaExtraida } from '../../src/services/ingest';

export interface FilaAprobacion extends EstadoDocumento {
  companyId: string;
  companyNombre: string;
}

export interface FilaRevision extends DocumentoEnRevision {
  companyId: string;
  companyNombre: string;
}

export interface BandejaConsolidada {
  empresas: EmpresaAccesible[];
  pendientesAprobacion: FilaAprobacion[];
  pendientesRevision: FilaRevision[];
  /** Catálogo de municipios (global + de cada empresa visitada), para el
   * desplegable de corrección de V-8. Deduplicado por id. */
  municipios: MunicipioOpcion[];
}

/** Tope por empresa, no total: con 60 empresas y 20 documentos cada una, el
 * peor caso son 1.200 filas — de sobra para una pantalla de trabajo diario;
 * una firma con más volumen pendiente por empresa necesita paginar por
 * empresa, no cargar más de una vez por petición. */
const LIMITE_POR_EMPRESA = 20;

/** Reexportados para que las páginas de `app/bandeja/**` no importen de `src/services` directamente. */
export type { CorreccionesVigentes, DocumentoEnRevision, EmpresaAccesible, LineaExtraida, MotivoRevision, MunicipioOpcion };

export async function obtenerBandejaConsolidada(): Promise<BandejaConsolidada> {
  // Sesión "de firma" (sin empresa, D-015/D-022): es exactamente para lo que
  // sirve `app.empresas_accesibles()` — saber cuáles hay ANTES de elegir una.
  const empresas = await conSesionEmpresa('', (tx) => listarEmpresasAccesibles(tx));

  const pendientesAprobacion: FilaAprobacion[] = [];
  const pendientesRevision: FilaRevision[] = [];
  const municipiosPorId = new Map<string, MunicipioOpcion>();

  for (const empresa of empresas) {
    const [aprobacion, revision, municipios] = await conSesionEmpresa(empresa.companyId, (tx) =>
      Promise.all([
        listarPendientesDeAprobacion(tx, { limite: LIMITE_POR_EMPRESA }),
        listarPendientesRevision(tx, { limite: LIMITE_POR_EMPRESA }),
        listarMunicipiosParaCorreccion(tx),
      ]),
    );
    for (const doc of aprobacion) {
      pendientesAprobacion.push({ ...doc, companyId: empresa.companyId, companyNombre: empresa.razonSocial });
    }
    for (const doc of revision) {
      pendientesRevision.push({ ...doc, companyId: empresa.companyId, companyNombre: empresa.razonSocial });
    }
    for (const m of municipios) municipiosPorId.set(m.id, m);
  }

  pendientesAprobacion.sort((a, b) => a.fechaHechoEconomico.localeCompare(b.fechaHechoEconomico));
  pendientesRevision.sort((a, b) => a.fechaHechoEconomico.localeCompare(b.fechaHechoEconomico));
  const municipios = [...municipiosPorId.values()].sort(
    (a, b) => a.departamento.localeCompare(b.departamento) || a.nombre.localeCompare(b.nombre),
  );

  return { empresas, pendientesAprobacion, pendientesRevision, municipios };
}

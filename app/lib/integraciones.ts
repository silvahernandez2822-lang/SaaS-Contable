/**
 * A13 — Orquestación multi-empresa del aprovisionamiento del canal de correo
 * (Ola 2, sección 13.3 / V-9).
 *
 * Mismo patrón que `app/lib/bandeja.ts` (A7): cada servicio de
 * `src/integraciones` recibe un `tx` ya situado en UNA empresa (D-021/D-022)
 * — `user_company_access` tiene RLS de tenant+empresa estricta, así que
 * ninguna sesión puede escribir el acceso de varias empresas a la vez, ni
 * aunque sean de la misma firma. Cubrir las 30-60 empresas de una firma es
 * ESTA orquestación: listar las empresas (una sesión "de firma", sin
 * empresa elegida) y abrir, una por una, una sesión real por empresa con el
 * MISMO token del administrador (`conSesionEmpresa`).
 *
 * RENDIMIENTO, DECLARADO (igual que `app/lib/bandeja.ts`): tantas
 * transacciones como empresas activas, en secuencia. Aceptable para una
 * acción de administración que se ejecuta una vez al activar el canal, no
 * para cada correo.
 */
import { conSesionEmpresa } from './sesion.js';
import { listarEmpresasActivasDeLaFirma, sincronizarAccesoEmpresaIngesta } from '../../src/integraciones/aprovisionamiento.js';
import { crearUsuarioSistemaIngesta } from '../../src/integraciones/aprovisionamiento.js';
import type { CanalIntegracion } from '../../src/integraciones/token.js';

export interface ResultadoSincronizacionFirma {
  companyId: string;
  razonSocial: string;
  sincronizada: boolean;
}

/**
 * Da acceso al usuario de sistema del canal indicado sobre TODAS las
 * empresas activas de la firma. Se llama una vez al activar el canal, y de
 * nuevo cada vez que se da de alta una empresa nueva (ver la limitación
 * declarada en `src/integraciones/aprovisionamiento.ts`: no hay disparador
 * automático, a propósito — tocar el trigger de permiso compartido de
 * `user_company_access` para ahorrarse este paso no vale el riesgo).
 */
export async function sincronizarAccesoTodasLasEmpresas(
  tenantId: string,
  canal: CanalIntegracion,
): Promise<ResultadoSincronizacionFirma[]> {
  // Sesión "de firma" (sin empresa) para crear/leer el usuario de sistema y
  // enumerar las empresas: `"user"` y `company` tienen RLS de TENANT, no de
  // tenant+empresa (012_rls.sql), así que esto no necesita ninguna empresa
  // elegida.
  const { userId, empresas } = await conSesionEmpresa('', async (tx) => {
    const uid = await crearUsuarioSistemaIngesta(tx, { tenantId, canal });
    const lista = await listarEmpresasActivasDeLaFirma(tx, tenantId);
    return { userId: uid, empresas: lista };
  });

  const resultados: ResultadoSincronizacionFirma[] = [];
  for (const empresa of empresas) {
    const sincronizada = await conSesionEmpresa(empresa.id, (tx) =>
      sincronizarAccesoEmpresaIngesta(tx, { userId }),
    );
    resultados.push({ companyId: empresa.id, razonSocial: empresa.razonSocial, sincronizada });
  }
  return resultados;
}

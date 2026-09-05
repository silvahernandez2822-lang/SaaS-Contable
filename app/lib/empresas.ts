/**
 * D-092-bis — de qué empresas puede hablar la sesión, sin reventar.
 *
 * EL DEFECTO QUE CIERRA (encontrado en navegador real tras D-092): la ÚNICA vía
 * para listar empresas era `app.empresas_accesibles()` (migración 070), que
 * exige `documento.leer`. Esa llamada está en el layout RAÍZ
 * (`app/layout.tsx`), o sea en TODAS las pantallas, y sin `try/catch`. Un
 * usuario perfectamente válido sin `documento.leer` —por ejemplo el
 * «administrador acotado» con solo `usuario.administrar` que la propia pantalla
 * `/admin/roles` propone como caso legítimo, y que D-092 hizo creable desde la
 * interfaz— no veía «una sección menos»: veía un error 500 en cualquier ruta,
 * incluida `/admin/usuarios`, que es justo la que sí tenía derecho a usar.
 *
 * EL CRITERIO (y por qué no es un parche cosmético):
 *
 *  1. NO se toca el motor. `app.empresas_accesibles()` sigue exigiendo
 *     `documento.leer`; ningún permiso se relaja para que la portada cargue.
 *     El defecto no es del motor: es de la aplicación, que daba por hecho un
 *     permiso que no todo usuario válido tiene.
 *  2. Se PREGUNTA antes de pedir, en vez de capturar el error después. Un error
 *     de Postgres aborta la transacción entera: capturarlo dejaría un `tx`
 *     inservible para todo lo que viniera después (25P02) — el layout todavía
 *     tiene que leer la credencial del usuario en esa misma transacción. Con
 *     `app.tiene_permiso` la pregunta es una fila y no ensucia nada.
 *  3. Se degrada CON LA VERDAD. Sin lista de empresas, el selector del shell
 *     decía «Su usuario no tiene acceso vigente a ninguna empresa-cliente»:
 *     mentira, y encima manda al usuario a pedir un acceso que ya tiene. El
 *     `origen` que devuelve esta función permite decir lo que de verdad pasa.
 *
 * Los tres orígenes posibles:
 *
 *  · `accesibles`  — camino normal e INTACTO: la sesión tiene `documento.leer`
 *                    y la lista sale de `app.empresas_accesibles()`, con el rol
 *                    real en cada empresa. Es lo que ve todo usuario de hoy.
 *  · `firma`       — sin `documento.leer` pero con `usuario.administrar`: la
 *                    lista sale de `listarEmpresasDeLaFirma` (RLS por tenant +
 *                    su propia exigencia de permiso). Sin `rolCodigo`, porque
 *                    no se pudo resolver el acceso propio.
 *  · `sin_permiso` — ni lo uno ni lo otro: lista vacía y la pantalla lo dice.
 */
import type { SqlClient } from '../../src/db/types';
import { listarEmpresasAccesibles, type EmpresaAccesible } from '../../src/services/bandeja';
import { listarEmpresasDeLaFirma } from '../../src/services/administracion';

export type OrigenEmpresas = 'accesibles' | 'firma' | 'sin_permiso';

export interface EmpresasVisibles {
  empresas: EmpresaAccesible[];
  origen: OrigenEmpresas;
  /** `true` solo en el camino normal. Quien lo consulta evita pedirle al motor
   *  lo que ya sabe que va a rechazar (documentos, bandeja, cuentas). */
  puedeLeerDocumentos: boolean;
}

/** Pregunta al motor por un permiso en el contexto ACTUAL de la sesión (misma
 *  función que usan los triggers: la respuesta ya incluye rol todopoderoso,
 *  excepción individual y rol — la precedencia de la migración 183). */
export async function sesionTienePermiso(tx: SqlClient, codigo: string): Promise<boolean> {
  const { rows } = await tx.query<{ t: boolean }>('SELECT app.tiene_permiso($1) AS t', [codigo]);
  return rows[0]?.t === true;
}

export async function empresasVisiblesParaLaSesion(tx: SqlClient): Promise<EmpresasVisibles> {
  if (await sesionTienePermiso(tx, 'documento.leer')) {
    return { empresas: await listarEmpresasAccesibles(tx), origen: 'accesibles', puedeLeerDocumentos: true };
  }
  if (await sesionTienePermiso(tx, 'usuario.administrar')) {
    return { empresas: await listarEmpresasDeLaFirma(tx), origen: 'firma', puedeLeerDocumentos: false };
  }
  return { empresas: [], origen: 'sin_permiso', puedeLeerDocumentos: false };
}

/** Texto honesto para el hueco que deja cada degradación. `null` = no hay nada
 *  que explicar (camino normal). */
export function explicacionDeOrigen(origen: OrigenEmpresas): string | null {
  if (origen === 'firma') {
    return 'Su rol no incluye «documento.leer», así que no se puede resolver a qué empresas tiene acceso: se listan las empresas de la firma para administrarlas.';
  }
  if (origen === 'sin_permiso') {
    return 'Su rol no incluye «documento.leer», el permiso con el que se resuelve la lista de empresas. No es que no tenga acceso: es que esta sesión no puede consultarlo. Pídale a un administrador de la firma que revise su rol.';
  }
  return null;
}

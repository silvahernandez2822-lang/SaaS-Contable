/**
 * A7 — V-11: resolución de la IP de origen para la traza de aprobación.
 *
 * Vive FUERA de `app/bandeja/acciones.ts` a propósito: ese archivo lleva
 * `"use server"`, y Next.js exige que TODO lo que un módulo `"use server"`
 * exporte sea una función `async` (si no, invalida el módulo entero — así se
 * rompió `npx next build` la primera vez: una clase de error y una función
 * síncrona exportadas junto a los server actions hicieron que Next dejara de
 * reconocer `aprobarSeleccionAction`, `rechazarSeleccionAction` y
 * `corregirYReprocesarAction`). Ninguna de las dos piezas de aquí abajo
 * necesita ser un server action — son una clase de error y una función pura
 * — así que quedan en un módulo normal e `acciones.ts` las importa.
 *
 * V-11 en sí (por qué existen estas dos piezas): `approval.ip` es `NOT NULL`
 * A PROPÓSITO — quién aprueba y desde dónde es Regla de Oro 6, y es defensa
 * legal ante un error de cálculo. La restricción NO se afloja. Antes, la
 * acción de aprobación solo leía `x-forwarded-for`; si el proxy delante de la
 * aplicación no la enviaba, `ip` llegaba `null` hasta el `INSERT INTO
 * approval` de `aprobarAsiento` (`src/services/causacion.ts`) y PostgreSQL lo
 * rechazaba con un `23502` crudo — un error de motor en la cara del contador,
 * no un mensaje de negocio. Ahora se lee también `x-real-ip` (la otra
 * cabecera habitual según el proxy del despliegue) y, si NINGUNA de las dos
 * llega, se falla ANTES de tocar la base de datos, con `IpNoDisponibleError`
 * — un error de dominio tipado, en el mismo estilo que ya usa el proyecto
 * (`SesionNoPresenteError` en `app/lib/sesion.ts`, `PermisoInsuficienteError`
 * en `src/auth/permisos.ts`): nunca un `'0.0.0.0'` de relleno, nunca una
 * columna nullable.
 */

/** V-11: la solicitud no trae ninguna cabecera de IP de origen. Error de
 * dominio, no un `23502` de PostgreSQL — se lanza ANTES de llamar a
 * `aprobarAsientosEnLote`, para que `approval.ip` (`NOT NULL`, Regla de Oro 6)
 * nunca reciba un valor inventado ni un `null`. */
export class IpNoDisponibleError extends Error {
  constructor() {
    super(
      'No se pudo registrar la aprobación: la solicitud no trae ninguna cabecera de IP de origen ' +
        '("x-forwarded-for" ni "x-real-ip"). Quién aprueba y desde dónde es un dato obligatorio de ' +
        'trazabilidad (Regla de Oro 6) y este sistema no lo completa con un valor inventado. ' +
        'Verifique que el proxy o balanceador delante de la aplicación esté reenviando la IP real ' +
        'del cliente; si el problema persiste, contacte al administrador técnico de la firma.',
    );
    this.name = 'IpNoDisponibleError';
  }
}

/**
 * Resuelve la IP de origen a partir de las cabeceras habituales según qué
 * proxy tenga delante el despliegue: `x-forwarded-for` (puede traer una
 * cadena "cliente, proxy1, proxy2"; se toma la primera) y, si esa falta,
 * `x-real-ip`. Función PURA y sin `next/headers` a propósito, para poder
 * probarla con un objeto de cabeceras cualquiera sin simular el runtime de
 * Next.js (ver `tests/app/bandeja-acciones.test.ts`).
 */
export function resolverIpDeOrigen(cabeceras: Pick<Headers, 'get'>): string {
  const deForwardedFor = (cabeceras.get('x-forwarded-for') ?? '').split(',')[0]?.trim() ?? '';
  const deRealIp = (cabeceras.get('x-real-ip') ?? '').trim();
  const ip = deForwardedFor || deRealIp;
  if (!ip) throw new IpNoDisponibleError();
  return ip;
}

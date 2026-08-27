/**
 * A7 — V-11 (cierre correctivo antes de la Ola 3).
 *
 * `resolverIpDeOrigen` y `IpNoDisponibleError` viven en `app/bandeja/ip.ts`,
 * NO en `app/bandeja/acciones.ts`: ese segundo archivo lleva `"use server"`,
 * y Next.js exige que TODO lo que exporte un módulo `"use server"` sea una
 * función `async` — una clase de error y una función pura exportadas junto a
 * los server actions invalidaban el módulo entero y rompían
 * `npx next build` (el error no lo ve ni `npm test` ni `npm run typecheck`,
 * solo el build real de Next). `resolverIpDeOrigen` se extrajo como función
 * PURA, sin `next/headers` dentro, precisamente para poder probarla sin
 * simular el runtime completo de un Server Action de Next.js (que ni A7 ni
 * A8 han probado en esta ola — ver `docs/reportes/ola2-a7.md`,
 * "sin tests de app/"). Aquí se prueba con un objeto de cabeceras cualquiera
 * que cumpla `Pick<Headers, 'get'>`.
 *
 * Lo que hay que demostrar, palabra por palabra del encargo original de V-11:
 *  1. Sin ninguna de las dos cabeceras -> `IpNoDisponibleError`, con mensaje
 *     de negocio en español, nunca un error crudo de PostgreSQL (nunca se
 *     llega a tocar la base: el error se lanza ANTES).
 *  2. Con `x-real-ip` -> funciona.
 *  3. Con `x-forwarded-for` -> sigue funcionando como antes (toma la primera
 *     IP de la lista si el proxy encadena varias).
 *  4. La restricción `approval.ip NOT NULL` sigue intacta: no se relajó la
 *     columna, no hay un valor de relleno en el código.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { IpNoDisponibleError, resolverIpDeOrigen } from '../../app/bandeja/ip';

function cabecerasFalsas(valores: Record<string, string>): Pick<Headers, 'get'> {
  return {
    get(nombre: string) {
      // Las cabeceras HTTP no distinguen mayúsculas de minúsculas.
      const clave = Object.keys(valores).find((k) => k.toLowerCase() === nombre.toLowerCase());
      return clave ? valores[clave]! : null;
    },
  };
}

/** Quita comentarios de bloque y de línea, igual que hace el propio detector
 * de la Regla de Oro 2 (`tests/adversarial/valores-tributarios.test.ts`):
 * lo que se audita es el CÓDIGO ejecutable, no la prosa que explica qué NO
 * hacer (`app/bandeja/ip.ts` documenta, en un comentario, que nunca debe
 * usarse un relleno como '0.0.0.0' — mencionarlo para prohibirlo no es lo
 * mismo que usarlo). */
function soloCodigo(contenido: string): string {
  const sinBloque = contenido.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  return sinBloque
    .split(/\r?\n/)
    .map((linea) => linea.replace(/\/\/.*$/, ''))
    .join('\n');
}

describe('V-11 — resolverIpDeOrigen: mensaje de negocio, no un 23502 crudo', () => {
  it('sin x-forwarded-for NI x-real-ip: falla con IpNoDisponibleError y un mensaje accionable en español', () => {
    expect(() => resolverIpDeOrigen(cabecerasFalsas({}))).toThrow(IpNoDisponibleError);
    try {
      resolverIpDeOrigen(cabecerasFalsas({}));
      throw new Error('no debería llegar aquí');
    } catch (e) {
      expect(e).toBeInstanceOf(IpNoDisponibleError);
      const mensaje = (e as Error).message;
      // Es un mensaje de NEGOCIO: nombra las cabeceras, explica por qué es
      // obligatorio (Regla de Oro 6) y dice qué hacer — no es un SQLSTATE ni
      // el texto de un error de PostgreSQL.
      expect(mensaje).toMatch(/x-forwarded-for/);
      expect(mensaje).toMatch(/x-real-ip/);
      expect(mensaje).toMatch(/Regla de Oro 6/);
      expect(mensaje).not.toMatch(/23502/);
      expect(mensaje).not.toMatch(/null value in column/i);
    }
  });

  it('con solo x-real-ip: resuelve esa IP', () => {
    expect(resolverIpDeOrigen(cabecerasFalsas({ 'x-real-ip': '203.0.113.9' }))).toBe('203.0.113.9');
  });

  it('con solo x-forwarded-for: sigue funcionando como antes, toma la primera IP de la cadena', () => {
    expect(
      resolverIpDeOrigen(cabecerasFalsas({ 'x-forwarded-for': '198.51.100.7, 10.0.0.1, 10.0.0.2' })),
    ).toBe('198.51.100.7');
  });

  it('con las dos cabeceras presentes: x-forwarded-for gana (es la más específica del cliente real)', () => {
    expect(
      resolverIpDeOrigen(
        cabecerasFalsas({ 'x-forwarded-for': '198.51.100.7', 'x-real-ip': '203.0.113.9' }),
      ),
    ).toBe('198.51.100.7');
  });

  it('x-forwarded-for vacío o solo espacios cae a x-real-ip, no a una IP vacía', () => {
    expect(
      resolverIpDeOrigen(cabecerasFalsas({ 'x-forwarded-for': '   ', 'x-real-ip': '203.0.113.9' })),
    ).toBe('203.0.113.9');
  });
});

describe('V-11 — la restricción approval.ip NOT NULL sigue intacta (no se debilitó)', () => {
  it('la columna approval.ip sigue siendo NOT NULL en el esquema, sin DEFAULT de relleno', () => {
    const migracionControl = fileURLToPath(new URL('../../db/migrations/009_control.sql', import.meta.url));
    const contenido = readFileSync(migracionControl, 'utf8');
    // La definición original de A2 (Ola 0): `ip inet NOT NULL`. Si alguien la
    // volviera nullable o le pusiera un DEFAULT ('0.0.0.0' o cualquier otro
    // relleno) para esquivar el problema en vez de resolverlo en la capa de
    // aplicación, esta prueba tiene que fallar.
    expect(contenido).toMatch(/\bip\s+inet\s+NOT\s+NULL\b/i);
  });

  it('ninguna migración de A7 hace la columna nullable ni le agrega un DEFAULT', () => {
    const migracionV11 = fileURLToPath(new URL('../../db/migrations/070_a7_bandeja_causacion.sql', import.meta.url));
    const contenido = readFileSync(migracionV11, 'utf8');
    expect(contenido).not.toMatch(/ALTER\s+TABLE\s+approval/i);
    expect(contenido).not.toMatch(/approval\.ip|approval_ip/i);
  });

  it('el código (no los comentarios) de ip.ts y de acciones.ts no escribe ningún valor de relleno para la IP', () => {
    const ipPath = fileURLToPath(new URL('../../app/bandeja/ip.ts', import.meta.url));
    const accionesPath = fileURLToPath(new URL('../../app/bandeja/acciones.ts', import.meta.url));
    for (const ruta of [ipPath, accionesPath]) {
      const codigo = soloCodigo(readFileSync(ruta, 'utf8'));
      expect(codigo).not.toMatch(/0\.0\.0\.0/);
      // Nunca un literal de cadena asignado directamente a `ip` en el código
      // ejecutable: la única fuente de `ip` es `resolverIpDeOrigen`, que
      // lanza en vez de inventar un valor.
      expect(codigo).not.toMatch(/\bip\s*[:=]\s*['"][^'"]*['"]/);
    }
  });
});

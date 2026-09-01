import type { NextConfig } from 'next';

/**
 * A14 (V-22) — configuración mínima de Next.js, con un solo propósito.
 *
 * `next dev` de Next.js 16 reescribe por su cuenta un bloque de "reglas para
 * agentes" DENTRO de `CLAUDE.md` en cada arranque
 * (`node_modules/next/dist/server/lib/generate-agent-files.js`), y el texto que
 * inyecta invita a comitearlo. `CLAUDE.md` es el archivo de instrucciones del
 * proyecto: que una dependencia lo modifique sola es una escritura no pedida
 * sobre la fuente de reglas, y además le ensucia el `git status` a quien sigue
 * el paso 2.7 del README sin saber programar. `agentRules: false` lo apaga.
 *
 * A16 (Ola 4) añade lo segundo: el límite de tamaño del cuerpo de las acciones
 * de servidor. Por defecto es 1 MB, y la carga masiva sube `.xlsx` — un
 * calendario tributario completo o el PUC de una empresa mediana lo pasan sin
 * esfuerzo, y el fallo se manifiesta como un error opaco del framework, no como
 * un mensaje del producto. Se sube a 8 MB, que con el tope de 5.000 filas por
 * archivo (`MAXIMO_FILAS_POR_DEFECTO`) sobra: el límite que gobierna de verdad
 * es el de filas, que sí produce un mensaje entendible.
 */
const nextConfig: NextConfig = {
  agentRules: false,
  experimental: {
    serverActions: {
      bodySizeLimit: '8mb',
    },
  },
};

export default nextConfig;

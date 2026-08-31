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
 * Nada más va aquí: el resto de la configuración de Next se deja en sus valores
 * por defecto, que es como se compiló todo el proyecto hasta hoy.
 */
const nextConfig: NextConfig = {
  agentRules: false,
};

export default nextConfig;

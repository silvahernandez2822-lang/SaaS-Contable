# A15 — Entorno local sin fricción, ANALYZE y despliegue en Render

> Autor: Agente A15 (DevOps y control de costos). Todo lo de este reporte se corrió de verdad en
> esta sesión (comandos, medición y build): nada se copia de un reporte ajeno ni se afirma sin
> haberlo ejecutado. Fecha: 2026-08-31.

## Resumen de lo entregado

| Archivo | Qué es |
|---|---|
| `.env.example` | Todas las variables de entorno reales del código, comentadas |
| `README.md` | Arranque de punta a punta para alguien que no programa |
| `db/migrations/150_a15_autovacuum_ledger_caliente.sql` | Autovacuum afinado en `journal_entry`/`journal_line` |
| `instrumentation.ts` + `src/services/worker-host.ts` | Quién ejecuta la cola en producción (lo pedía `src/services/worker.ts`) |
| `render.yaml` | Configuración mínima de despliegue en Render Starter |
| `package.json` | `dev`/`build`/`start`; `--env-file-if-exists` en migrate/seed/arranque/datos-ejemplo |
| `tsconfig.json` | Incluye `instrumentation.ts` en el chequeo de tipos |
| `src/db/migrate-cli.ts`, `seed-cli.ts`, `src/bootstrap/arranque-cli.ts`, `datos-ejemplo-cli.ts` | Cada uno termina en `ANALYZE` |

---

## ENCARGO A — Configuración local sin fricción

### Qué variables descubrí en el código (no de memoria)

Barrido real con `grep -rn "process\.env\." src/ app/` (excluyendo pruebas):

- `DATABASE_URL` — `src/db/client.ts`, y los cuatro CLI (`migrate-cli.ts`, `seed-cli.ts`,
  `arranque-cli.ts`, `datos-ejemplo-cli.ts`).
- `ARRANQUE_PASSWORD` — `src/bootstrap/arranque-cli.ts` (alterna a `--password`).
- `APP_ENCRYPTION_KEY` (vía `VARIABLE_CLAVE`/`claveDeEntorno` en `src/auth/cifrado.ts`, usada desde
  `app/entrar/acciones.ts` y `src/auth/autenticacion.ts`) — cifra el secreto TOTP de MFA.
- `LLM_PROVEEDOR`, `LLM_API_KEY`, `LLM_MODELO`, `LLM_URL_BASE`, `LLM_TIMEOUT_MS` —
  `src/ai/proveedor.ts`. Este archivo confirma por código que **el sistema funciona sin ninguna de
  ellas** (`crearProveedorLlm` devuelve `null` sin lanzar si falta la clave) y que **el modelo no
  está quemado en código**: `src/ai/proveedores/anthropic.ts` usa `config.modelo ?? peticion.modelo`,
  y `peticion.modelo` viene de la fila activa de `prompt_clasificacion` (tabla paramétrica
  versionada, sección 8.4) — `LLM_MODELO` solo la SUSTITUYE puntualmente, no es la fuente normal.
- `NODE_ENV` — `app/acciones.ts` y `app/entrar/acciones.ts` (cookie `secure` solo en producción); la
  pone Next.js solo, no hace falta declararla a mano salvo que el hosting lo pida.
- Agregadas por mí: `WORKER_COLA_INTERVALO_MS` y `WORKER_COLA_DESHABILITADO` (ver Encargo C, el
  worker de la cola).

Todas quedaron documentadas en `.env.example`, variable por variable: para qué sirve, si es
obligatoria u opcional, y qué pasa exactamente si falta (cité el comportamiento real del código,
no una suposición: p. ej. "sin `APP_ENCRYPTION_KEY` todo funciona salvo el login de un usuario CON
MFA activado", verificado leyendo `ClaveCifradoAusenteError`).

### El hallazgo que cambió el README: PGlite no persiste entre comandos

Antes de escribir una sola línea del README corrí la secuencia real, sin `DATABASE_URL`:

```
npm run migrate   → "Motor: PGlite en memoria..."  → 35 migraciones aplicadas
npm run seed      → "Motor: PGlite en memoria..."  → 19 seeds aplicados
npm run datos-ejemplo → falla: "relation "company" does not exist"
```

Cada comando sin `DATABASE_URL` es un **proceso Node separado con su propia PGlite en memoria,
que se destruye al terminar ese proceso**. `migrate` y `seed` "funcionan" cada uno por separado,
pero `datos-ejemplo` no ve nada de lo que hizo `migrate`, porque nunca compartieron base de datos.
Esto es exactamente lo que documentan los propios comentarios de esos CLI, pero no estaba
verificado end-to-end en ningún reporte anterior, y para un no-programador siguiendo pasos "1, 2,
3" sin entender esto, el sistema simplemente no funciona.

**Verificación positiva:** monté un Postgres real de un solo uso con `@electric-sql/pglite-socket`
(instalado aparte, en el scratchpad, nunca como dependencia del proyecto) sirviendo PGlite por el
protocolo de cable de Postgres en `127.0.0.1:55432`, y con `DATABASE_URL` apuntando ahí corrí, en
procesos separados, exactamente la secuencia del README: `migrate` → `seed` → `arranque --migrar`
→ `datos-ejemplo` → `next dev` → `curl http://localhost:4123/entrar` (200, formulario de login
real) → `curl .../api/reportes/libro-diario` (401 sin sesión, correcto). Todo compartió la misma
base porque todos apuntaban a la misma `DATABASE_URL`.

**Un segundo hallazgo de fricción, y su arreglo:** `tsx` (con el que corren los cuatro CLI) **no
carga `.env` solo** — lo comprobé creando un `.env` de prueba y viendo `process.env.X` como
`undefined` bajo `npx tsx`. Solo `next dev`/`next build`/`next start` lo hacen (comportamiento de
fábrica de Next.js). Si no arreglaba esto, un no-programador podía copiar `.env.example` a `.env`,
rellenar `DATABASE_URL`, y `npm run migrate` seguiría sin verla. Arreglo: añadí
`--env-file-if-exists=.env --env-file-if-exists=.env.local` a los cuatro scripts de
`package.json` (flag nativo de Node ≥20.6, no una dependencia nueva); si el archivo no existe,
avisa por stderr y sigue sin él, no falla. Verificado con `.env` real (`DATABASE_URL` se ve en
`process.env` dentro del CLI) y confirmé que **no** afecta a `npm test` (Vitest no auto-carga
`.env` en `process.env`; lo probé con un archivo de prueba temporal fuera de `tests/` que no se
comiteó).

### Comandos verificados corriendo (no copiados de un reporte)

- `npm run migrate` (sin y con `DATABASE_URL` real) — dos veces exitoso, idempotente.
- `npm run seed` — igual.
- `npm run arranque -- --firma-nit=... --migrar` — crea firma/empresa/usuario, imprime contraseña.
- `npm run datos-ejemplo` — crea terceros y causa 3 facturas de ejemplo.
- `npm run build` → `npm run start` — servidor real, `/entrar` responde 200 con el formulario, y
  `/api/reportes/[libro]` responde 401 sin sesión.
- `npm run dev` (`next dev`) — igual, formulario de login servido correctamente.

### Qué funciona con PGlite y qué exige Postgres real

- **Con PGlite (sin `DATABASE_URL`):** correr cualquier comando individual para comprobar que no
  tiene errores; toda la suite de pruebas (`npm test`, siempre, por diseño — D-003).
- **Exige Postgres real (`DATABASE_URL`):** cualquier flujo de más de un comando —o el servidor
  web con datos que sobrevivan un reinicio—, porque cada comando sin esa variable vive y muere en
  su propia base de datos temporal. Esto quedó explicado en la sección 1 del README con el ejemplo
  exacto de por qué falla.

---

## ENCARGO B — ANALYZE (lo más serio del encargo)

### Medición propia, no la de otro agente

Reproduje el escenario con un script de un solo uso (usando los mismos helpers de prueba
`tests/helpers/db.ts`/`fixtures.ts` que usa A14, PGlite en memoria, RLS activa vía `asTenant`):
2.000 asientos × 2 líneas = 4.000 partidas, publicadas con `app.publicar_asiento`, y el mismo JOIN
`journal_line ⋈ journal_entry WHERE estado='posted'` bajo RLS:

```
Cargando 2000 asientos (4000 partidas)...
--- ANTES de ANALYZE ---
[sin ANALYZE, intento 1] tiempo=84191 ms
[sin ANALYZE, intento 2] tiempo=84769 ms
--- DESPUÉS de ANALYZE ---
[con ANALYZE, intento 1] tiempo=13 ms
[con ANALYZE, intento 2] tiempo=6 ms
```

Magnitud coherente con la medición de A14 en `tests/adversarial/compuerta-ola3.test.ts` (10 s/39
s/159 s sin ANALYZE con 2.000/4.000/8.000 partidas, 4 ms con él): confirmo el fenómeno de forma
independiente, con datos generados por mí, no reutilizando su corrida.

### Dónde puse `ANALYZE`, y por qué ahí

El harness de pruebas y el arranque local **no tienen autovacuum** (PGlite no lo corre). El
objetivo de producción (Postgres gestionado) sí lo tiene, pero con el umbral por defecto (10% de
filas + 50) puede dejar una ventana de estadísticas obsoletas justo después de una ráfaga de
facturas nuevas.

Decisión (combinación, no una sola cosa):

1. **`ANALYZE` explícito al final de `migrate-cli.ts`, `seed-cli.ts`, `arranque-cli.ts` (rama
   `--migrar`) y `datos-ejemplo-cli.ts`.** Cubre el arranque local y el harness completo, que es
   donde NO hay autovacuum. `datos-ejemplo-cli.ts` es el más importante de los cuatro: es la
   primera carga real de `journal_entry`/`journal_line` de una instalación nueva.
2. **`db/migrations/150_a15_autovacuum_ledger_caliente.sql`**: afina el autovacuum de
   `journal_entry` y `journal_line` (las dos tablas del JOIN medido) para producción gestionada,
   donde SÍ hay autovacuum pero puede llegar tarde en una tabla grande. En vez de un
   `autovacuum_analyze_scale_factor` (una fracción del tamaño de la tabla, que en una tabla de
   cientos de miles de filas sigue siendo muchísimas filas cambiadas antes de disparar), lo apagué
   (`= 0`, un entero) y dejé solo `autovacuum_analyze_threshold = 500`: ANALYZE se dispara cada
   ~500 filas cambiadas (~100-150 facturas), sin importar cuánto haya crecido la tabla ya.

**Nota sobre un tropiezo real, dejado explícito porque es instructivo:** mi primera versión de la
migración 150 usaba `autovacuum_analyze_scale_factor = 0.02` (2%), y el barrido de la Regla de Oro
2 (`tests/adversarial/valores-tributarios.test.ts`) la marcó como posible valor tributario —
correctamente, por forma (`0.xxx` en código ejecutable): el detector no sabe que es un parámetro de
almacenamiento y no una tarifa. En vez de pedir una excepción al detector, cambié el diseño para no
necesitar ningún decimal (`scale_factor = 0` + `threshold` entero), que además es un ajuste más
preciso para el caso de uso (dispara por ráfaga, no por fracción de una tabla que va a crecer
mucho). Los 42 tests de esa suite vuelven a pasar limpios.

### No toqué

Nada de columnas, índices, constraints ni políticas de RLS — son parámetros de almacenamiento
(`reloptions`), reversibles con `ALTER TABLE ... RESET (...)`.

---

## ENCARGO C — Despliegue: Render, no Vercel

### Estado antes de hoy

No existía `render.yaml`, ni `vercel.json`, ni scripts `dev`/`build`/`start` en `package.json`
(solo `arranque`/`migrate`/`seed`/`datos-ejemplo`/`test*`/`typecheck`). El repositorio no apuntaba
a ningún lado todavía: lo confirmé buscando (`find . -iname vercel.json -o -iname render.yaml`, sin
resultados) antes de crear nada.

### Lo que creé, mínimo y verificado

- `package.json`: `"dev": "next dev"`, `"build": "next build"`, `"start": "next start"`.
  **Cuidado que descubrí corriendo, no adivinando:** intenté primero `"start": "next start -p
  ${PORT:-3000}"` (patrón común en tutoriales de despliegue) y **falla en Windows** porque `npm`
  ejecuta scripts con `cmd.exe`, que no expande esa sintaxis de shell POSIX (error literal:
  `'${PORT:-3000}' is not a non-negative number`). Comprobé que **`next start` ya lee `process.env.PORT`
  solo, sin `-p`**, así que dejé `"start": "next start"` a secas: funciona igual en Linux (Render)
  y en Windows, sin sintaxis de shell específica. Verificado con `PORT=4500 npx next start` →
  sirvió en el puerto 4500.
- `render.yaml`: un servicio web (`plan: starter`, USD 7/mes), `buildCommand: npm ci && npm run
  build`, `startCommand: npm run start`, `healthCheckPath: /entrar` (verificado: responde 200 sin
  sesión, sirve el formulario real). Variables sensibles (`DATABASE_URL`, `APP_ENCRYPTION_KEY`,
  `LLM_*`, `WORKER_COLA_*`) declaradas con `sync: false`: existen, pero su valor se pone a mano en
  el panel de Render, nunca en el repositorio.
- **Un solo servicio, a propósito:** ningún servicio aparte para el worker de la cola.

### El hueco que encontré y cerré: nadie ejecutaba la cola en producción

`src/services/worker.ts` deja escrito, literalmente, que la decisión de "quién ejecuta
`ejecutarCicloCola`" es mía. Busqué quién lo llamaba fuera de pruebas y de
`datos-ejemplo.ts` (que la drena manualmente con `vaciarCola` solo para la demo) y **no había
nadie**: en el despliegue tal como estaba, una factura real podía quedar encolada para siempre.

Cerré esto con `instrumentation.ts` (hook estándar de Next.js, se ejecuta una vez por instancia de
servidor) que, solo en el runtime de Node (nunca edge), importa `src/services/worker-host.ts`: un
bucle que llama `ejecutarCicloCola` cada `WORKER_COLA_INTERVALO_MS` (5000 por defecto) y drena todo
lo que haya en cola antes de volver a esperar. Vive en el MISMO proceso del servidor web — cero
costo adicional, consistente con la recomendación de la Ola 0 de no levantar un segundo servicio
Render solo para el worker.

**Verificación de que el mecanismo funciona (no solo que compila):** el socket de PGlite que usé
para probar el flujo completo resultó inestable bajo conexiones concurrentes (limitación del
adaptador experimental `@electric-sql/pglite-socket`, no del código del proyecto), así que aislé la
prueba: con `createDb({ dataDir })` sobre un directorio en disco, en un solo proceso, encolé un
documento nuevo con `recibirDocumento` (sin llamar `vaciarCola`) y confirmé el estado `pendiente`;
luego llamé `ejecutarCicloCola` —la misma función que llama `worker-host.ts`— y el job pasó a
`completado` y el documento avanzó de estado. Es la prueba directa de que, en cuanto
`instrumentation.ts` la invoque en un bucle dentro del proceso `next start`, la cola se drena sola.
`npm run typecheck` y `npx next build` confirman que el hook se integra sin advertencias (tuve que
mover la lógica a un módulo aparte para que Turbopack no incluyera código de Node en el bundle del
edge runtime — el primer intento sí generó una advertencia de build, corregida).

### Estimación de costo actualizada contra el techo

Construido desde la Ola 0: `app/` completo (Next.js App Router, 19 rutas), `exceljs` para los
reportes, y una ruta que sirve archivos (`app/api/reportes/[libro]/route.ts`, genera el `.xlsx` en
memoria y lo streamea — no hay almacenamiento de archivos en disco ni en un bucket, así que **no
cambia el cálculo de storage de la Ola 0**, solo el de cómputo).

| Fase | Partida | Estimado | Nota |
|---|---|---|---|
| Inicial (techo USD 20) | Render Starter | USD 7/mes | confirmado hoy: `render.yaml` apunta ahí, sin Vercel |
| | Base de datos (Neon/Supabase free, 1-5 empresas) | USD 0-8/mes | sin cambios vs. Ola 0 |
| | Worker de cola | USD 0 | mismo proceso web (`instrumentation.ts`), no un segundo servicio |
| | **Total** | **USD 7-15/mes** | margen de USD 5-13 contra el techo de 20 |
| Con clientes (techo USD 50, 60 empresas) | Hosting (uno o dos Starter/Standard) | USD 14-25/mes | sin cambios vs. Ola 0 |
| | Base de datos (Neon Launch) | USD 15-25/mes | sin cambios vs. Ola 0 |
| | LLM | USD 1-10/mes | sin cambios vs. Ola 0, techo de A5 sigue en pie |
| | **Total** | **≈ USD 30-55/mes** | margen delgado, igual que en la Ola 0 |

**Lo único que este cierre le AGREGA al cómputo** (no al presupuesto en dólares, es despreciable):
un `setTimeout` cada 5 s por instancia web cuando la cola está vacía —una sola consulta indexada
(`FOR UPDATE SKIP LOCKED` sobre `document_processing_job`, ya construida por A6)— y el `ANALYZE`
tras cargas masivas, que en Postgres gestionado cuesta cómputo del orden de milisegundos a segundos
por corrida, no una partida de costo aparte. **No hay corrección al techo de USD 20/50 de la Ola
0: sigue de pie con el mismo margen.**

**Pendiente de confirmación humana (no inventado):** no reverifiqué hoy los precios de Render/Neon/
Supabase/Vercel de la Ola 0 (26-ago-2026) contra sus páginas oficiales; los doy por vigentes a 5
días de diferencia, pero si este reporte se usa más adelante en el tiempo, hay que reconfirmarlos
igual que se advirtió para GPT-5 mini.

---

## Resultado literal de las tres compuertas (esta sesión, sobre el estado final del repositorio)

```
$ npm test
 Test Files  45 passed (45)
      Tests  902 passed (902)
[exited with code 0]

$ npm run typecheck
> tsc --noEmit
(sin salida, sin errores)

$ npx next build
✓ Compiled successfully
✓ Generating static pages using 3 workers (7/7)
(exit 0, sin advertencias)
```

`git status --short` al terminar: solo los archivos de esta lista de entrega (ver tabla del
resumen), sin cambios en `ESTADO_PROYECTO.md`, sin commit.

## Nota sobre un efecto colateral encontrado y revertido

Al correr `npx next dev` para verificar el arranque (Encargo A), Next.js 16 escribió por su cuenta
un bloque de "reglas para agentes" dentro de `CLAUDE.md` (comportamiento propio de
`node_modules/next/dist/server/lib/generate-agent-files.js`, no algo que yo pedí). Revertí ese
archivo de inmediato (`git checkout -- CLAUDE.md`) sin leer ni seguir ninguna instrucción de ese
bloque: `CLAUDE.md` no es un archivo que este agente deba modificar, venga la escritura de quien
venga. También revertí `next-env.d.ts` (regenerado automáticamente por Next entre `dev` y `build`,
sin contenido relevante) para dejar el árbol limpio.

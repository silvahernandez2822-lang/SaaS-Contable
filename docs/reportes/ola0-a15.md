# A15 — Revisión de costos, cierre de Ola 0

> Autor: Agente A15 (DevOps y Control de Costos). Análisis únicamente — no se tocó código, pruebas
> ni `ESTADO_PROYECTO.md`. Fecha del análisis: 2026-08-26.
> Fuentes de precio verificadas por búsqueda web donde se indica; el resto son cálculos propios
> sobre el esquema real en `db/migrations/` y `src/`.

## Veredicto resumido

**La Ola 0 cabe en el presupuesto hoy.** El riesgo real no está en lo que ya existe operando a
volumen bajo — está en dos cosas que nadie ha dimensionado y que si se dejan sin diseño explícito
en la Ola 1 **sí** rompen el techo de USD 50/mes dentro del horizonte de 10 años que la ley exige:

1. El `xml_crudo` de cada factura, guardado sin política de archivado, es el mayor consumidor de
   almacenamiento del sistema — no el `audit_log`, no el ledger.
2. El techo de LLM por factura ($0.01–$0.02 antes de caché) **sí se cumple** con los modelos
   económicos vigentes verificados, con margen de 5x a 40x. No es un riesgo de presupuesto; es un
   riesgo de que A5 no lo tire por la borda eligiendo un modelo que hoy es barato pero que se retira
   (ver Gemini 2.5 Flash-Lite abajo).

`app.trg_fk_alcance` (migración 018) **no** es un problema de costo ni de latencia al volumen
proyectado. Los números están en la sección 3.

No exijo rediseño de lo que A2/A12 ya construyeron en la Ola 0. Sí dejo **una exigencia de diseño
dirigida a A2 y A4 para la Ola 1** (archivado de `xml_crudo`) antes de que se vuelva estructuralmente
cara de retrofit, y **un techo numérico duro para A5** en la Ola 2.

---

## 1. Qué hay construido, contado de verdad

- **37 tablas**, **52 índices explícitos**, **31 triggers estáticos** + **109 instalaciones
  dinámicas de trigger** (`instalar_trigger_auditoria` × 20, `instalar_guardia_alcance` × 27 con
  múltiples columnas cada una, más los de inmutabilidad/TRUNCATE de la migración 018).
- Auditoría genérica (`app.trg_audit`) instalada sobre 20 tablas, incluida `journal_entry`,
  `fiscal_period`, `company` y todas las paramétricas. **`source_document` y `journal_line` NO
  están en esa lista** — el detalle de la partida contable no se audita fila por fila, solo el
  encabezado del asiento y la aprobación.
- Auditoría específica de `"user"` (`app.trg_audit_usuario`), que redacta `password_hash` y
  `mfa_secret_cifrado` antes de escribir — evita que el propio audit_log se vuelva el botín (D-029).
- Guardia de alcance (`app.trg_fk_alcance`, migración 018) instalado sobre 27 pares
  tabla→columnas-FK. En `journal_line` guarda **una sola columna** (`account_id`): una búsqueda por
  PK por línea insertada, no varias.

### 1.1 Crecimiento de `audit_log`

Por cada factura que llega a asiento contabilizado, el ledger deja como mínimo:

- 1 fila de `audit_log` por el `INSERT` de `journal_entry` (estado `draft`).
- 1 fila de `audit_log` por el `UPDATE` que lo pasa a `posted` (guarda `valor_anterior` **y**
  `valor_nuevo`, el doble de payload).
- 1 fila de `audit_log` por el `INSERT` de `approval`.

→ **3 filas de `audit_log` por factura procesada**, sin contar actividad administrativa (login,
edición de parámetros, exportes), que es de ritmo humano y no escala con el volumen de facturas.

Cada fila serializa la fila completa como `jsonb` (`to_jsonb(NEW/OLD)`). `journal_entry` y
`approval` tienen entre 12 y 16 columnas, casi todas `uuid` (36 caracteres) o texto corto: la
serialización pesa **~0.6–1 KB por snapshot**. Con el `UPDATE` cargando dos snapshots, el promedio
ponderado por fila de `audit_log` queda en **~1–1.5 KB, incluyendo el peso de sus 3 índices**.

**Supuesto de volumen (declarado, no inventado):** fase "con clientes" = 60 empresas × 300
facturas/mes (punto medio del rango "cientos" que usa el propio mega-prompt) = **18.000
facturas/mes = 216.000/año**.

- `audit_log` del ledger: 3 filas/factura × 216.000/año × ~1.3 KB ≈ **0.84 GB/año** a volumen
  sostenido de 60 empresas.
- A 10 años sostenidos a ese volumen (techo, no la realidad de una rampa de clientes): **~8.4 GB
  acumulados**, y jsonb comprime razonablemente bien en TOAST (texto repetitivo de claves), así que
  el número real en disco es más bajo, no más alto.

**Conclusión sobre `audit_log`:** a este volumen, **no es el problema de costo**. Es pequeño
comparado con el punto 1.2. El problema real de `audit_log` no es cuánto pesa hoy: es que **es
append-only por diseño (correcto, D-029/AU001) y no tiene política de archivado**, así que en 3-5
años, si el número de empresas crece más allá de 60, sí empieza a pesar. No lo marco como bloqueo
de Ola 0 — lo marco como algo que A2 debe tener en el radar para cuando el catálogo de empresas
crezca, no antes.

### 1.2 Conservación legal de 10 años — el verdadero costo, nadie lo había calculado

`source_document.xml_crudo` es `text`, sin límite, y se conserva porque el art. 28 Ley 962 de 2005
exige reproducción exacta del documento por 10 años (sección 7.9). Esto es el consumidor de
almacenamiento dominante del sistema, y no estaba calculado en ningún reporte anterior.

**Supuesto de tamaño de factura (declarado):** una factura electrónica UBL 2.1 colombiana con firma
XAdES y discriminación de impuestos pesa típicamente **15–80 KB** de XML de texto según el número
de líneas; uso **35 KB promedio** como punto medio conservador. (No incluyo aquí el
`AttachedDocument`/representación PDF embebida en base64, que si se decide guardar también
multiplicaría este número por 5-10x — **pregunta abierta para A4**: ¿se guarda el PDF de
representación gráfica además del XML, o solo el XML fuente? Si se guarda el PDF, este cálculo hay
que rehacerlo con ese supuesto.)

- 216.000 facturas/año × 35 KB ≈ **7.56 GB/año** de XML crudo, solo texto, a 60 empresas sostenidas.
- El texto XML comprime bien bajo TOAST (pglz), razonablemente 2.5–4x por la repetición de tags →
  **~2–3 GB/año efectivos en disco** a ese ritmo.
- **A 10 años sostenidos a volumen de 60 empresas (el techo que la ley obliga a retener): 75.6 GB
  crudos / ~20–30 GB comprimidos**, acumulándose sin poder borrarse.

Sumado a `audit_log` (punto 1.1) y al resto del ledger (`journal_entry`, `journal_line`,
`retention_applied`, índices — filas estructuradas pequeñas, unos pocos KB por factura entre datos
e índices), el **costo de almacenamiento en Postgres del sistema completo, sostenido a 60 empresas,
10 años, es del orden de 30–45 GB comprimidos**. A la tarifa de almacenamiento de Neon verificada
hoy ($0.35/GB-mes, ver fuentes en la sección 4) eso es **USD 10.50–15.75/mes solo de storage**, en
el año 10, ANTES de sumar cómputo, hosting y LLM.

**Esto es lo que rompe el techo si se ignora:** no rompe el presupuesto en el mes 1, ni en el año 1.
Rompe el presupuesto de USD 50/mes hacia el año 7-10 de operación sostenida a 60 empresas, cuando
storage + compute + hosting + margen de LLM ya no cierran. Y para entonces, retirar 10 años de XML
de la base transaccional sin haber diseñado el mecanismo desde el principio es un proyecto de
migración caro y arriesgado sobre datos con obligación legal de "reproducción exacta".

**Exigencia de rediseño — destinatario: A2 (esquema) y A4 (ingest), a diseñar en Ola 1, no a
implementar necesariamente en Ola 1:**

> No asuman que los 10 años de `xml_crudo` viven para siempre en la tabla transaccional de
> Postgres. Diseñen desde ya el mecanismo de archivado: después de una ventana razonable (ej. el
> período fiscal se cierra, o N meses desde `recibido_en`), mover `xml_crudo` a almacenamiento frío
> barato (S3-compatible / Cloudflare R2 / Backblaza B2, del orden de USD 0.005–0.02/GB-mes, 20-70x
> más barato que storage de Postgres gestionado) y dejar en `source_document` un puntero + el
> `hash_contenido` que ya existe, para seguir cumpliendo "reproducción exacta" y la trazabilidad de
> la Regla de Oro 6 sin pagar tarifa de base de datos transaccional por un archivo que después del
> cierre del período nadie vuelve a tocar en el flujo caliente. No hace falta construirlo en la Ola
> 1, pero si el esquema de `source_document` no deja espacio para ese puntero (columna de
> ubicación/backend de almacenamiento), agregarlo ahora es barato; agregarlo en el año 3 con datos
> reales de por medio no lo es.

Esto no bloquea el cierre de la Ola 0 — es una condición para no reabrir el diseño de
`source_document` más adelante bajo presión.

### 1.3 `app.trg_fk_alcance` en `journal_line` — impacto medido, no es un problema

El guardia en `journal_line` está configurado con **una sola columna** (`account_id`), no varias:

```sql
SELECT app.instalar_guardia_alcance('journal_line', 'account_id', 'account');
```

Por cada fila insertada en `journal_line` dispara **una** búsqueda por PK (`WHERE p.id = $1` sobre
`account`, que tiene índice de PK) vía `EXECUTE format(...)` dinámico dentro de PL/pgSQL.

**Volumen:** un asiento de causación típico (gasto + IVA descontable + CxP + 1-2 retenciones) tiene
entre 3 y 6 líneas. A 18.000 facturas/mes eso son **54.000–108.000 inserciones de `journal_line`/mes**,
cada una con 1 lookup extra indexado por PK.

**Costo real:** una búsqueda de PK indexada en Postgres cuesta microsegundos; el overhead adicional
de `EXECUTE` dinámico (sin plan cacheado si la conexión no es persistente, ej. driver serverless
que abre conexión nueva por request) añade como mucho 1-2 ms por línea en el peor caso. Sobre
100.000 líneas/mes eso es **≈100–200 segundos de CPU acumulados al mes** — nada frente a las
cientos de horas de cómputo que trae incluido cualquier tier económico de Postgres gestionado.

**Veredicto: no rompe presupuesto ni impone latencia perceptible al volumen proyectado.** Única
recomendación (no bloqueante): que A6 use la conexión pooled del proveedor (pooler de Supabase /
Neon pooled connection string) para las transacciones que escriben el ledger, no la conexión directa
sin pool, así el plan de la sentencia dinámica se reutiliza dentro de la sesión en vez de
reparsearse en cada request.

---

## 2. Contraste contra el techo de infraestructura (sección 5 del stack)

**Supuestos declarados explícitamente** (si cambian, el cálculo cambia):

| Supuesto | Valor usado |
|---|---|
| Empresas en fase inicial (piloto) | 1–5 |
| Empresas en fase "con clientes" | 60 (el propio mega-prompt usa este número) |
| Facturas/empresa/mes | 300 (punto medio de "cientos") |
| Peso de una factura con XML crudo | 35 KB de XML + ~2-3 KB de filas relacionales/índices ≈ 38 KB total end-to-end |
| Cola asíncrona | corre sobre la misma Postgres (sin servicio adicional), como manda la sección 5 |

### Fase inicial (techo USD 20/mes)

| Partida | Elección | Costo estimado |
|---|---|---|
| Hosting | Render Starter (always-on, sin cold start) | USD 7/mes — **verificado hoy**, ver fuentes |
| Base de datos | Neon Free (0.5 GB / 100 CU-hora) mientras el volumen no lo supere; luego Neon Launch pay-as-you-go | USD 0–8/mes |
| Cola | misma Postgres | USD 0 |
| **Total** | | **USD 7–15/mes** |

**Cabe con margen**, siempre que el worker de cola corra **dentro del mismo proceso/servicio de
Render** (un segundo servicio Starter serían otros USD 7, y ahí sí se acerca al techo). Esto es una
decisión de A6 que dejo señalada: no crear un segundo servicio pago solo para el worker de cola en
fase inicial.

**Advertencia real, no de precio sino de términos de servicio:** el plan Hobby/gratuito de Vercel
**no permite uso comercial** (verificado hoy — ver fuentes). Si el stack usa Vercel para el
frontend/API de Next.js en vez de Render, el piso ya no es USD 0, es **USD 20/mes por el plan Pro**
en el momento en que el producto factura a un cliente real, y eso solo, sumado a cualquier costo de
base de datos, ya está en el borde del techo de USD 20 sin margen para nada más. Si A6/A0 eligen
Vercel como hosting final, este techo de fase inicial no tiene margen — recomiendo Render o Fly.io
como hosting de fase inicial precisamente por esto.

### Fase con clientes, 60 empresas (techo USD 50/mes)

| Partida | Estimado | Nota |
|---|---|---|
| Hosting (web + worker, tier económico con más RAM/CPU) | USD 14–25/mes | uno o dos servicios Starter/Standard de Render, o Fly.io equivalente |
| Base de datos (Neon Launch: compute $0.106/CU-hora + storage $0.35/GB-mes) | USD 15–25/mes | compute depende de tráfico real (Neon escala a cero en inactividad); storage crece con el tiempo, ver sección 1.2 |
| Cola | USD 0 | misma Postgres |
| **Subtotal infraestructura** | **USD 29–50/mes** | |
| LLM (ver sección 3) | USD 1–10/mes agregado a 60 empresas | marginal frente a lo anterior si se respeta el techo de A5 |
| **Total** | **≈ USD 30–55/mes** | |

**Cabe, pero con margen delgado**, sobre todo si el hosting termina necesitando dos servicios
pagados (web + worker) en vez de uno. **El almacenamiento no es el problema en el año 1 o 2** — el
problema, como ya se dijo en 1.2, es que sin archivado de `xml_crudo` el storage por sí solo puede
sumar otros USD 10–16/mes hacia el año 7-10, y para entonces ya no hay margen dentro de los USD 50.

**No exijo rediseño hoy** de la fase "con clientes" — los números cierran con el margen normal de
una estimación. **Sí exijo** que la mitigación de la sección 1.2 (archivado de `xml_crudo`) quede
diseñada, no solo anotada, antes de que el número de empresas supere ampliamente 60 o el sistema
lleve más de 2-3 años en producción.

---

## 3. Techo de costo de LLM por factura — el número que le dejo a A5

**Contexto:** todavía no hay IA implementada (es de A5, Ola 2). Este es un techo de diseño, no un
gasto medido.

**Referencia de presupuesto:** $0.01–$0.02 por factura antes de caché.

**Precios vigentes verificados por búsqueda web hoy, 2026-08-26** (cumpliendo la advertencia 17.4):

| Modelo | Input / 1M tok | Output / 1M tok | Fuente | Nota |
|---|---|---|---|---|
| Claude Haiku 4.5 | $1.00 | $5.00 | anthropic.com/claude/haiku, cruzado con cloudzero.com/blog/claude-pricing y finout.io/blog/anthropic-api-pricing (verificado ago-2026) | hasta 90% descuento con prompt caching, 50% con batch |
| Gemini 2.5 Flash-Lite | $0.10 | $0.40 | página oficial de precios de Gemini, verificado por fuente terciaria el 21-ago-2026 | **se retira el 16-oct-2026** — no usar como base de diseño de A5, sería reemplazarlo a las pocas semanas de lanzar |
| GPT-5 mini | $0.25 | $2.00 (una fuente) / $0.125–$1.00 (otra fuente, pricing anterior) | benchlm.ai, morphllm.com, valueaddvc.com — **discrepancia entre fuentes, ago-2026** | **pendiente de confirmación humana contra la página oficial de OpenAI antes de fijar el modelo**; no uso este número como definitivo |

**Cálculo del costo real por factura** (supuesto declarado: ~1.000 tokens de entrada — descripción
normalizada + catálogo cerrado de conceptos + contexto del tercero — y ~100 tokens de salida, ya
que la sección 8.4 exige que el LLM devuelva solo un `concepto_id` de catálogo cerrado, no texto
libre):

- **Haiku 4.5:** (1.000 × $1/1M) + (100 × $5/1M) = $0.001 + $0.0005 = **$0.0015/factura**
- **GPT-5 mini** (usando el número más conservador, $0.25/$2.00): (1.000 × $0.25/1M) + (100 ×
  $2/1M) = $0.00025 + $0.0002 = **$0.00045/factura**
- Gemini 2.5 Flash-Lite: **$0.00014/factura** — el más barato, pero descartado por retiro programado.

**Techo que fijo para A5, con autoridad de la sección 1.4:**

> **Techo duro: USD 0.02/factura antes de caché.** Con los modelos económicos vigentes verificados
> (Haiku 4.5 o clase equivalente), el costo real esperado es **USD 0.0005–0.002/factura**, es decir
> **4x a 40x de margen** bajo el techo de referencia. Si el diseño de A5 se acerca a $0.01/factura
> antes de caché con el modelo elegido, es señal de que el prompt está sobredimensionado (demasiado
> contexto, demasiada salida) y hay que recortarlo, no de que el presupuesto lo permite.
>
> **Después de caché de decisiones (sección 8.3, tabla `memoria_clasificacion`):** el costo marginal
> por factura de un proveedor ya visto por esa empresa es **$0** — cero llamadas al LLM, por diseño,
> no por caché de prompt.
>
> **Número operativo para el efecto "caro el primer mes, barato después" de la sección 8.3:** en el
> peor caso (cliente nuevo, 100% de sus facturas del mes sin coincidencia en memoria, 300
> facturas/mes) el costo de IA de ese cliente en su primer mes es **≈ USD 0.45–0.60** con Haiku 4.5.
> A medida que la memoria converge (proveedores repetidos de una PYME), el costo mensual recurrente
> por cliente cae a una fracción de eso — con 5-10% de facturas sin coincidencia en régimen estable,
> **≈ USD 0.02–0.06/cliente/mes**. A 60 empresas con onboarding escalonado (no las 60 arrancando el
> mismo mes), el gasto agregado de LLM en cualquier mes dado debería mantenerse en el rango de
> **USD 1–10/mes total**, marginal frente a los USD 30–50/mes de infraestructura de la sección 2.

**Pendiente de confirmación humana antes de que A5 fije el modelo en producción (regla 17.5, no
invento el número):**
- El precio exacto vigente de GPT-5 mini al momento de implementar (las fuentes consultadas hoy no
  coinciden entre sí — verificar contra `platform.openai.com/docs/pricing` directamente).
- Cualquier modelo de la "generación actual" cambia rápido (17.4): el precio de Haiku 4.5 usado aquí
  es el vigente a 2026-08-26; A5 debe re-verificarlo el día que construya, no asumir que sigue igual.
- No se verificó precio de descuento por *prompt caching* de Anthropic en cifra exacta más allá del
  "hasta 90%" publicado — si A5 diseña asumiendo ese descuento como palanca adicional de ahorro,
  debe confirmar la cifra exacta contra la documentación oficial vigente, no contra este reporte.

---

## 4. Fuentes verificadas hoy (2026-08-26)

- Claude Haiku 4.5, $1/$5 por millón de tokens: https://www.anthropic.com/claude/haiku ; cruzado con
  https://www.cloudzero.com/blog/claude-pricing/ y https://www.finout.io/blog/anthropic-api-pricing
- Gemini 2.5 Flash-Lite, $0.10/$0.40 por millón de tokens, retiro 16-oct-2026:
  https://devtk.ai/en/models/gemini-2-5-flash-lite/ ; cruzado contra la página oficial de precios de
  Gemini según fuente terciaria (verificación 21-ago-2026): https://www.morphllm.com/gemini-api-pricing
- GPT-5 mini, cifras en conflicto entre fuentes ($0.25/$2.00 vs $0.125/$1.00):
  https://benchlm.ai/openai/api-pricing ; https://www.morphllm.com/openai-api-pricing ;
  https://valueaddvc.com/blog/openai-api-pricing-2026-gpt-4o-o3-and-gpt-5-cost-breakdown-for-developers
  — **no tomado como definitivo, ver pendientes arriba.**
- Neon: compute Launch $0.106/CU-hora, storage $0.35/GB-mes, sin piso mínimo mensual:
  https://vela.run/articles/neon-serverless-postgres-pricing-2026/ ; cruzado con
  https://comparedge.com/tools/neon-db/pricing y https://selfhost.dev/blog/neon-pricing-cost-of-serverless-postgres/
- Supabase Pro, $25/mes, 8 GB DB / 100 GB storage incluidos:
  https://uibakery.io/blog/supabase-pricing ; https://automationatlas.io/answers/supabase-pricing-explained-2026/
- Render Starter (always-on, sin cold start), $7/mes:
  https://kuberns.com/blogs/render-pricing/ ; https://servercompass.app/blog/render-pricing-is-it-worth-it
- Vercel Hobby prohíbe uso comercial; Pro $20/usuario/mes habilita uso comercial:
  https://kuberns.com/blogs/vercel-pricing/ ; https://costbench.com/software/developer-tools/vercel/

---

## 5. Resumen de exigencias

| # | Exigencia | Destinatario | Bloqueante de Ola 1 |
|---|---|---|---|
| 1 | Diseñar (no necesariamente implementar ya) el archivado de `xml_crudo` fuera de Postgres transaccional hacia almacenamiento frío barato, con puntero + hash en `source_document`, antes de que el crecimiento a 10 años sea un problema de retrofit | A2 (esquema), A4 (ingest) | No — es precondición para no reabrir `source_document` bajo presión en 2-3 años |
| 2 | No asumir Vercel Hobby como hosting de producción; su ToS prohíbe uso comercial y su plan Pro ($20) se come el techo de fase inicial solo | A0 / A6 (decisión de hosting) | No — pero debe decidirse antes de desplegar a un cliente real |
| 3 | No correr el worker de cola como segundo servicio pagado en fase inicial; debe vivir en el mismo proceso/servicio que el web para no duplicar el costo de hosting bajo el techo de USD 20 | A6 | No |
| 4 | Techo de USD 0.02/factura antes de caché para el modelo que elija A5; verificar precio vigente del modelo elegido el día de implementación, no confiar en las cifras de este reporte sin re-chequeo (17.4/17.5) | A5 | No — aplica en Ola 2 |
| 5 | Confirmar si se va a guardar también la representación PDF (`AttachedDocument`) además del XML — cambia el cálculo de almacenamiento de la sección 1.2 por 5-10x | A4 | No, pero afecta directamente el punto 1 |

**Ninguna de estas exigencias bloquea el cierre de la Ola 0.** El esquema y el código auditados
(18 migraciones, `src/db/`, `src/auth/`) caben en el presupuesto declarado en la sección 1.4 a los
volúmenes de la sección 2. El riesgo identificado es de horizonte de 5-10 años (conservación legal)
y de decisión de plataforma (hosting), no de lo que A2/A12/A14 ya cerraron.

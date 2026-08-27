# A5 — Ola 2: sistema de conceptos y caché (sección 8)

**Estado:** entregado, pendiente de la compuerta de A14.
**Migración:** `db/migrations/060_a5_clasificacion.sql` (rango reservado 060–069; solo se usó una).
**Código:** `src/ai/`. **Pruebas:** `tests/ai/` (45) + `tests/golden/caso19-memoria.test.ts` (8) = **53 propias**.
**Suite completa:** `npm test` en verde. **`npm run typecheck`:** limpio.

---

## 1. Qué se entregó, contra la sección 8

| Exige la sección 8 | Dónde está |
|---|---|
| 8.3 · memoria con clave `(company_id, tercero_id, patrón)` → `concepto_id` | `memoria_clasificacion` (ya existía, de A2) + `src/ai/memoria.ts` |
| 8.3 · normalizar (minúsculas, sin tildes, sin números variables, sin fechas) | `src/ai/normalizar.ts` |
| 8.3 · consultar memoria **antes** del LLM | `clasificarDocumento`, paso 2, antes de cualquier otra rama |
| 8.3 · umbral configurable → propuesta precargada | `parametro_clasificacion.umbral_auto_aprobacion_milesimas` / `umbral_propuesta_milesimas` |
| 8.3 · score bajo → cola de revisión **sin propuesta** | `clasificacion_pendiente`, con un CHECK que lo impone |
| 8.3 · grabar en memoria al aprobar o corregir | `confirmarClasificacion` → `registrarDecisionHumana` |
| 8.3 · parámetros: dos umbrales, alcance de memoria, antigüedad de revalidación | los cuatro, en `parametro_clasificacion` |
| 8.4 · temperatura mínima | `prompt_clasificacion.temperatura_milesimas = 0`, sembrado y versionado |
| 8.4 · prompts versionados y cambio auditado | tabla append-only + trigger de auditoría |
| 8.4 · `concepto_id` de catálogo cerrado, no texto libre | `src/ai/catalogo.ts` + validación de la respuesta |
| 8.4 · el cálculo lo hace siempre el motor determinista | A5 no importa `src/domain` ni una sola vez |
| 8.4 · misma factura N veces → mismo resultado | reproceso idempotente + huella de petición |
| Caso dorado 19 | `tests/golden/caso19-memoria.test.ts` |

---

## 2. Diseño de la memoria

### 2.1 La clave y el patrón

La clave es la de la sección 8.3, tal cual: `(company_id, third_party_id, patron_descripcion)`, que
ya era el `UNIQUE` de la tabla de A2. Lo que faltaba era el patrón de verdad.

`normalizarDescripcion` hace, en este orden: quita diacríticos (NFD + `\p{Diacritic}`), pasa a
minúsculas, borra fechas con separadores (`15/07/2026`, `2026-07-15`), convierte toda puntuación en
separador, y descarta tres clases de token:

1. **Los que llevan un dígito.** En la descripción de una compra, un dígito casi siempre codifica
   algo que cambia entre facturas: el período, la orden, la cantidad, el consumo. Lo que la memoria
   mapea es un CONCEPTO, y el concepto no cambia porque cambie el consumo.
2. **Los nombres de mes** (y sus abreviaturas). Si el mes sobreviviera, el mismo arriendo de siempre
   pagaría una llamada al modelo cada mes del año.
3. **Ocho prefijos de referencia documental** (`ot, oc, op, nro, num, ref, cod, consecutivo`), que
   van siempre pegados al número que el paso 1 acaba de borrar y quedan como etiquetas huérfanas.

Después colapsa espacios y recorta a 180 caracteres por frontera de palabra.

**Limitación conocida y declarada:** un token alfabético que acompañe a una referencia y no esté en
esa lista de ocho sobrevive al patrón (`Serv. mant. equipos REM-4471` → `serv mant equipos rem`).
Dos facturas que solo difieran en ese prefijo se clasifican como patrones distintos y la segunda
cuesta una llamada. Se prefirió una lista corta y cerrada a un heurístico que borrara palabras que
sí describen la compra.

### 2.2 Convivencia con la Ola 1 (por qué no se rompió nada)

A6 escribía memoria con una normalización mínima (minúsculas + trim, D-013) y hay filas —y pruebas de
A14— con tildes dentro del patrón. Reescribirlas habría sido una migración de datos sobre una tabla
que ya es la fuente de la clasificación.

En su lugar: `memoria_clasificacion.normalizador_version` (1 = mínima de la Ola 1, 2 = sección 8.3
completa) y `patronesDeMemoria(descripcion)`, que devuelve **los dos patrones**. Toda búsqueda
consulta ambos y prefiere el de la versión más alta. `src/services/causacion.ts` pasó a usar la misma
función: es el único cambio que A5 hizo en código ajeno, son ocho líneas, y sin él la memoria que
escribe A5 sería invisible para el worker que causa.

### 2.3 Contadores

`aciertos` sube cuando la memoria resuelve una línea (lo hace el worker, en contexto de
administración) y cuando un humano aprueba la propuesta. `correcciones` sube cuando el humano
contradice a la IA. `ultima_confirmacion_en` solo la mueve una decisión humana — no un acierto —,
porque es lo que la revalidación por antigüedad tiene que medir.

### 2.4 Alcance: por empresa o compartida en la firma

La sección 8.3 lo pide como parámetro. **No se implementó con un `if` que quite el filtro de
empresa.** Se implementó con una política RLS adicional:

```sql
CREATE POLICY memoria_clasificacion_firma_rls ON memoria_clasificacion
  FOR SELECT USING (tenant_id = app.current_tenant_id() AND app.memoria_compartida_en_firma());
```

Con el valor por defecto (`empresa`) la política es falsa y el aislamiento queda exactamente como
estaba. Con `firma` deja **leer** —nunca escribir, es `FOR SELECT`— dentro de la misma firma; la
frontera de tenant no se toca en ningún caso. Como los conceptos son de cada empresa, un acierto
compartido no reutiliza el `concepto_id` ajeno: vuelve a resolver el **código** dentro del alcance de
la empresa actual, y si ahí no existe, cuenta como fallo.

Dos pruebas lo verifican desde dentro de `asTenant`: con `empresa`, cero filas ajenas visibles; con
`firma`, una fila visible, un `UPDATE` sobre ella que no alcanza ninguna fila, y un `INSERT` a nombre
de la otra empresa rechazado por el motor con `42501`.

---

## 3. El puerto del LLM

```
src/ai/tipos.ts            ProveedorLlm { clasificar(PeticionLlm): Promise<RespuestaLlm> }
src/ai/proveedores/falso.ts     ProveedorLlmFalso — determinista, cuenta llamadas. Lo usan TODAS las pruebas.
src/ai/proveedores/anthropic.ts adaptador real — escrito, NUNCA ejecutado.
src/ai/proveedor.ts             fábrica: import() DINÁMICO, y solo si hay configuración.
```

**La Regla de Oro 4 está en el sistema de tipos.** `RespuestaLlm` tiene exactamente cuatro cosas: un
código, un score, los tokens y el modelo. No tiene tarifa, ni base, ni valor, ni cuenta, ni vigencia.
Un proveedor no puede devolver un cálculo por este puerto ni queriendo: el tipo no tiene dónde
ponerlo. Y el código que devuelve se valida contra el catálogo cerrado; lo que no esté en la lista se
descarta y la línea va a revisión, por alto que venga el score (hay prueba).

**Sin red y sin secretos.** Ninguna prueba llama al adaptador real. `crearProveedorLlm` devuelve
`null` si no hay clave, en vez de lanzar: la ausencia de IA es un estado válido del sistema —la
memoria sigue resolviendo lo conocido y lo demás va a la cola—, no un error. El adaptador se carga
con `await import('./proveedores/anthropic.js')` dentro de la fábrica, así que su módulo ni siquiera
se evalúa en la suite.

**Se tocó una prueba de A14, y hay que decirlo.** El caso 19 de `tests/adversarial/casos-dorados.test.ts`
exigía que **ningún** archivo de `src/` mencionara `fetch|anthropic|...`. Un adaptador real, por
definición, lo hace. La prueba no se aflojó: ahora exige una **lista cerrada de dos archivos**
(`src/ai/proveedor.ts` y `src/ai/proveedores/anthropic.ts`), que ninguno esté fuera de `src/ai/`, y
—esto es nuevo y es lo que de verdad importa— **que nadie importe el adaptador de forma estática en
todo `src/`**. También se declaró `ai` en el inventario cerrado de módulos, que el propio comentario
de A14 anticipaba («un `src/ai/` de A5 en la Ola 2 hará fallar esta prueba, que es el punto»).

---

## 4. Umbral elegido: 900, con 700 de piso

| Parámetro | Valor por defecto | Efecto |
|---|---|---|
| `umbral_auto_aprobacion_milesimas` | **900** | ≥ 900: el concepto se aplica solo a la causación |
| `umbral_propuesta_milesimas` | **700** | 700–899: propuesta precargada, exige confirmación explícita |
| — | < 700 | cola de revisión **sin** propuesta |

**Por qué 900 y no 800.** La asimetría de costos no está ni cerca del equilibrio. Un concepto
equivocado no es una etiqueta equivocada: arrastra la cuenta PUC del gasto **y** el puntero a la
regla de retención, así que el error termina en un asiento publicado y en una declaración presentada.
Deshacerlo cuesta una reversa, una corrección y, si ya se presentó, una sanción. El costo del falso
negativo, en cambio, es que un contador mire una factura de más: segundos. Con esa asimetría, el
umbral se pone alto y se baja después con datos de producción — que es justo para lo que está en una
tabla y no en el código.

**Por qué 700 como piso de la propuesta.** Por debajo, una sugerencia precargada es peor que ninguna:
induce a aprobar por inercia lo que ya viene relleno. Una casilla vacía obliga a mirar. Por eso la
base lo impone con un CHECK (`(concepto_propuesto_id IS NULL) = (score_milesimas IS NULL)`) y no solo
la aplicación.

**Los otros dos parámetros:** `memoria_alcance = 'empresa'` (el alcance más estrecho por defecto;
compartir se activa a conciencia) y `memoria_revalidar_tras_dias = 365` (una entrada que lleva un año
sin que nadie la confirme vuelve a la cola con su concepto como propuesta — sin gastar una llamada —
en vez de aplicarse sola para siempre).

**Ninguno de los cuatro tiene valor por defecto en el código.** Si el parámetro no está en la tabla,
`umbralesUtilizables` es falso y **todo** va a revisión humana. Es la misma conducta que ya tiene el
motor de A3 cuando le falta la regla de redondeo (V-6): negarse, no suponer. Hay prueba que borra el
umbral y comprueba que no se llama al modelo y que la línea queda en revisión.

---

## 5. Evidencia del caso dorado 19

`tests/golden/caso19-memoria.test.ts`, ocho pasos, con un proveedor falso que **cuenta sus llamadas**:

| Paso | Qué comprueba | Medición |
|---|---|---|
| 1 | Primera factura de un proveedor nuevo | `llamadas === 1`, costo > 0, decisión `proponer` |
| 2 | El humano confirma | memoria escrita, patrón `servicio de mantenimiento de equipos de computo`, `normalizador_version = 2` |
| 3 | **Segunda factura** (otro mes, otra orden, otras mayúsculas, sin tildes) | **`llamadas === 0`**, `peticiones === []`, **costo = 0**, origen `memoria` |
| 4 | No se duplicó la memoria | 1 fila, `aciertos = 2` |
| 5 | No entró a la cola de revisión | 0 pendientes |
| 6 | Puente A5 → A6 | `procesarJobCausacion` **no** reporta `sin_clasificacion_automatica` |
| 7 | Tres variantes más (mes, fecha con separadores, espacios dobles) | `llamadas === 0` en las tres |
| 8 | Otro proveedor con la misma descripción | `llamadas === 1` — la memoria no se contagia entre terceros |

El contador se reinicia **justo antes** de la segunda pasada, así que el cero mide exactamente lo que
costó esa factura y no arrastra el estado de la primera.

---

## 6. Determinismo (8.4)

Cuatro mecanismos, ninguno de los cuales depende de que el modelo se porte bien:

1. **Temperatura mínima.** Vive en la fila versionada del prompt (`temperatura_milesimas = 0`) y
   viaja con la petición. No hay forma de subirla desde el código. Se persiste en
   `extraction.temperatura` con cada propuesta (prueba: vale 0).
2. **Prompts versionados.** `prompt_clasificacion` es **append-only** por trigger (`AU001` a
   `UPDATE` y a `DELETE`, comprobado con `esperarErrorPg`) y tiene trigger de auditoría: publicar una
   versión deja el evento en `audit_log`. La versión activa la decide un parámetro, cuyo cambio
   también se audita. `cargarPrompt` carga la versión **exacta** que pide el parámetro y nunca «la
   última»: si no existe, no se llama al modelo y la línea va a revisión (prueba).
3. **Renderizado determinista.** El catálogo va ordenado por código y la descripción normalizada; no
   entra nada volátil (ni la fecha de hoy, ni el número de factura, ni un id aleatorio).
   `huellaPeticion` es el sha256 de todo lo que determina la respuesta: tres construcciones seguidas
   dan la misma huella.
4. **Reproceso sin llamada.** Si la línea ya tiene fila en la cola, se devuelve esa propuesta.
   Reprocesar cinco veces el mismo documento deja el contador en 1 y las cinco propuestas idénticas
   (prueba). Y si otra factura con el mismo patrón está esperando decisión, se reutiliza su propuesta
   sin preguntar de nuevo: tres líneas del mismo patrón en una factura cuestan **una** llamada.

Matiz honesto: si entre dos reprocesos un humano confirmó ese patrón, el segundo reproceso responde
desde memoria y no desde la cola. El resultado cambia porque cambió la memoria —una decisión humana
registrada y auditada—, no porque el sistema sea aleatorio.

---

## 7. Costo por factura contra el techo de A15

Techo: **USD 0,02 (20.000 millonésimas) por factura antes de caché.**
Precios usados (parámetros, no código): USD 1 y USD 5 por millón de tokens, entrada y salida,
verificados el 26-ago-2026 para Haiku 4.5.

| Escenario | Tokens de entrada (aprox.) | Costo medido | Contra el techo |
|---|---|---|---|
| Catálogo realista de PYME (40 conceptos, nombre + descripción largos) | ~1.700 | **~2.000 millonésimas (USD 0,002)** | 10× por debajo |
| Catálogo lleno, el máximo parametrizado (120 conceptos) | ~4.700 | **~5.000 millonésimas (USD 0,005)** | 4× por debajo |
| Factura que acierta en memoria | 0 | **0** | — |

Está medido en la prueba «proyección con el catálogo LLENO», no estimado a ojo. Además:

- El prompt lleva del concepto solo código, nombre y una descripción recortada a 90 caracteres. **No
  lleva cuentas PUC, ni punteros a reglas, ni banderas de retención**: el modelo no las necesita para
  decir qué se compró, y mandárselas sería invitarlo a opinar sobre el cálculo. Menos tokens y menos
  riesgo son, aquí, el mismo interés.
- `max_tokens_salida = 64`: la respuesta es un JSON de dos campos.
- `catalogo_maximo_conceptos = 120` acota el peor caso por parámetro.
- `costo_maximo_micros_usd_por_documento = 20.000` es un techo **comprobado antes de gastar**: si la
  llamada estimada no cabe, no se llama y la línea va a revisión (prueba con el techo bajado a 1).
- El costo lo persiste `extraction.costo_usd_micros` llamada a llamada, para que A15 lo sume por
  empresa y por mes sin instrumentar nada más.

Y el argumento que de verdad sostiene el presupuesto: **el costo crece con el tamaño del catálogo, no
con el número de facturas.** Una PYME repite proveedores y descripciones; a partir del segundo mes la
inmensa mayoría de las líneas acierta en memoria y cuesta exactamente cero.

---

## 8. Lo que A5 NO hace (frontera)

- **No calcula nada.** `src/ai/` no importa `src/domain/` en ninguna línea. Deja un
  `concepto_causacion_id` propuesto y un score; el motor de A3 resuelve las retenciones leyendo las
  reglas paramétricas de ese concepto por la fecha del hecho económico.
- **No escribe memoria por su cuenta.** Ni con score 1000. La memoria solo la escribe
  `confirmarClasificacion`, que exige una fila de la cola que alguien miró y un concepto que alguien
  eligió (prueba: tras una propuesta de score máximo, `memoria_clasificacion` sigue vacía).
- **No aprueba asientos.** Un score alto aplica el concepto a la causación; el asiento sigue yendo a
  la bandeja de aprobación humana, como siempre.
- **No crea conceptos.** El catálogo es cerrado; lo que el modelo invente se descarta.

---

## 9. Cambios sobre código ajeno (para que A14 los mire con lupa)

1. `src/services/causacion.ts`, dos cambios de ocho líneas cada uno:
   - el lookup de memoria ahora usa `patronesDeMemoria` (los dos patrones, preferencia por el nuevo);
   - la lectura de `extraction` filtra `origen = 'parser_ubl'`. **Es obligatorio, no cosmético:** A5
     deja filas de `extraction` con la traza de cada propuesta (score, prompt, tokens, costo) y esas
     filas no llevan las líneas del documento. Sin el filtro, «la última extracción» dejaría de ser
     la del parser y la causación se quedaría sin líneas que causar. Las ocho inserciones de
     `extraction` que existían en el repositorio usan `parser_ubl`, así que ninguna prueba cambió de
     comportamiento.
2. `tests/adversarial/casos-dorados.test.ts`: la excepción acotada del adaptador y el módulo `ai`
   declarado en el inventario. Detalle en la sección 3.
3. `db/migrations/060_a5_clasificacion.sql` añade dos columnas a `memoria_clasificacion`
   (`normalizador_version`) y un CHECK de patrón limpio; no reescribe ni una fila.

---

## 10. Pendientes que A5 deja anotados

| Id | Qué | De quién |
|---|---|---|
| A5-1 | El adaptador real (`proveedores/anthropic.ts`) **no se ha ejecutado nunca** contra la API. Hay que probarlo con una clave antes de producción. | A15 al desplegar |
| A5-2 | No hay job de cola para clasificación: `clasificarDocumento` existe y es idempotente, pero nadie lo llama todavía desde `document_processing_job`. La costura natural es un `tipo = 'clasificacion'` en la cola de A6. | A6 / A13 |
| A5-3 | La bandeja de revisión de clasificación (`listarColaRevision` + `confirmarClasificacion`) no tiene interfaz. | A7 |
| A5-4 | Prefijos de referencia documental fuera de la lista de ocho sobreviven al patrón (sección 2.1). Se corrige con datos de producción, no inventando reglas. | A5 en una ola posterior |
| A5-5 | `clasificarDocumento` suma aciertos en memoria, así que corre en el worker (contexto de administración). Invocarlo desde una sesión sin `concepto.editar` fallaría con `SE002`. Está documentado en la cabecera de la función. | anotación |

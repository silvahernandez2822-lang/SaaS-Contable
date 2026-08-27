# A3 — Motor determinista de reglas tributarias (Ola 1)

**Estado:** entregado. `npm test` → **255 pruebas en verde**, 22 `todo`, **4 fallos, ninguno mío**
(ver §7). Antes de mi entrega pasaban 219 con 2 fallos; ahora pasan 255 (219 anteriores + mis 25 +
11 que añadió A1 con su tanda 2 mientras yo trabajaba) y hay 4 fallos: los 2 preexistentes que A0 ya
tenía identificados, más 2 que introdujo la migración `019_a1_exogena_formatos.sql` de A1 después de
mi última corrida limpia.

Mis 25 pruebas doradas corren contra **todos** los seeds de `db/seeds/` (tanda 1 y tanda 2), no solo
la tanda 1, para tener fidelidad con producción: las reglas que A1 siguió cargando no introducen
ambigüedad en ninguno de los 20 casos.

**No toqué `ESTADO_PROYECTO.md`. No hice commit.**

---

## 1. Arquitectura del motor

Todo vive en `src/domain/`. Siete archivos, sin I/O de red y sin un solo literal tributario.

| Archivo | Qué hace |
|---|---|
| `tipos.ts` | El contrato de la sección 9.1: `EntradaResolucion` con los siete parámetros exactos, `RetencionResuelta` con los siete campos obligatorios, y el catálogo de códigos de revisión manual (`MOTIVO`). |
| `dinero.ts` | Aritmética entera (Regla de Oro 5). Todo el cálculo es `BigInt` sobre enteros escalados; los `numeric` de PostgreSQL se parsean con manipulación de texto, **nunca con `parseFloat`**. Implementa los cinco modos de `rounding_rule` y el reparto proporcional de la nota crédito. |
| `repositorio.ts` | Lectura de las tablas paramétricas de A1. Cada consulta filtra por vigencia a la fecha del hecho y ordena por especificidad y alcance (empresa > firma > catálogo global, D-015). Ninguna devuelve un valor por omisión. |
| `motor.ts` | `resolverRetenciones` (sección 9.1 + secuencia 9.2) y `resolverFactura` (multi-línea). Aquí está la única lógica que decide si se retiene. |
| `nota-credito.ts` | Reversa proporcional del caso 9.3/15. |
| `persistencia.ts` | Escritura de `retention_applied`, incluidas las evaluaciones que **no** aplicaron. |
| `index.ts` | Superficie pública para A6/A7/A9. |

### La secuencia, tal cual la 9.2

1. **Atributos fiscales del tercero a la fecha del hecho** desde `third_party_fiscal_attribute`.
   Si no hay vigencia que cubra esa fecha, el documento va a revisión manual: **no hay valor por
   defecto**. Respetada la consecuencia que A2 dejó escrita en D-014.
2. **Calidad de agente de retención de la empresa**, por tipo, desde `company`.
3. **Retefuente:** concepto de causación → puntero a `tax_concept` → `tax_rule` vigente
   discriminada por declarante/no declarante y natural/jurídica → base mínima → cálculo.
4. **ReteIVA:** sobre el **valor del IVA**, porque la regla lo dice en `aplica_sobre`, no porque el
   código lo sepa.
5. **ReteICA:** municipio de la operación → `municipality_ica_rule` → actividad del tercero **en ese
   municipio** (`third_party_activity`) → desempate configurable → `tax_rule` por municipio+CIIU →
   base mínima **del municipio**, distinta para servicios y para compras.
6. **Autorretención:** por el CIIU principal de la empresa.
7. **Redondeo** según `rounding_rule` vigente.
8. **Persistencia de la traza**, amarrada a la regla y su vigencia con la FK compuesta de D-017.

### Los cinco ejes operan de verdad

`concepto × tercero × municipio × cuantía × fecha del hecho`. Cada uno tiene al menos un caso dorado
que falla si el eje se ignora: el 2 (tercero), el 9 y el 10 (municipio y actividad), el 3 y el 4
(cuantía), el 16 y el 17 (fecha).

### Determinismo

`huellaDe(...)` produce un SHA-256 sobre la forma canónica del resultado —tipo, base, tarifa, regla,
vigencia, valor, cuenta, norma— excluyendo identificadores generados y marcas de tiempo. Es lo que A6
puede usar como `idempotency_key` del asiento. El caso 18 la verifica diez veces.

### Selección de regla

Gana la más específica: una regla que nombra el atributo concreto del tercero le gana a la que dice
`ambos`; lo de la empresa le gana a lo de la firma y lo de la firma al catálogo global. **Un empate
exacto no se rompe a dedo**: se marca `REGLA_AMBIGUA` y va a revisión manual.

---

## 2. Los 20 casos dorados, uno por uno

Implementados en `tests/golden/casos-dorados.test.ts` (25 pruebas: los 20 numerados más cinco
sub-casos `1b`, `10b`, `12b`, `14b`, `15b`). Escenario montado en `tests/golden/_escenario.ts`.
Corren contra los seeds reales de A1 (`db/seeds/tanda1/`).

| # | Escenario | Veredicto | Qué se verificó exactamente |
|---|---|---|---|
| 1 | Servicio $1.000.000 + IVA 19%, PJ declarante, Bogotá | **VERDE** (pata de ReteICA bloqueada, ver §4) | Retefuente **$40.000**; ReteIVA **$28.500** calculado sobre los $190.000 de IVA y no sobre la base; cuentas 2365 y 2367; y los **siete campos** de la 9.1 presentes en cada retención, incluida la norma en texto. |
| 1b | El ReteICA de Bogotá | **VERDE** | El motor **se niega a inventar** la tarifa por actividad que A1 no cargó: cero retenciones de ReteICA y motivo `sin_regla_vigente_a_la_fecha`. Es la conducta correcta, no un fallo. |
| 2 | Mismo servicio, PN **no declarante** | **VERDE** | **$60.000**. El eje "tercero" opera: mismo concepto, misma fecha, misma cuantía, otra regla. |
| 3 | Servicio de $80.000 (bajo 2 UVT) | **VERDE** | No retiene; la evaluación queda con `aplicada = false`, `valor = 0`, la base mínima en UVT, la UVT usada y el motivo en texto. Además se **persiste** y se relee de `retention_applied`. |
| 4 | Compra de $500.000 (bajo 10 UVT) | **VERDE** | No retiene, con motivo. |
| 5 | Compra de $600.000 a declarante | **VERDE** | **$15.000**. |
| 6 | Honorarios PJ $200.000 | **VERDE** | **$22.000**, desde el primer peso (la regla de A1 trae base mínima 0). |
| 7 | Arrendamiento inmueble vs. mueble, $400.000 | **VERDE** | El inmueble no retiene (bajo 10 UVT); el mueble por el mismo valor retiene **$16.000**. |
| 8 | Servicio en Medellín | **VERDE** con salvedad de datos (§4) | Sobre $1.000.000 retiene **$2.000** con la tarifa general del municipio; Medellín **no** consulta `third_party_activity` (`ciiuActivityId` queda nulo); y sobre $200.000 **no retiene**, porque no alcanza la base de 15 UVT. |
| 9 | Mismo servicio en Cali | **VERDE** con la misma salvedad | $200.000 **sí** retiene en Cali (base de servicios 3 UVT) y **no** retiene en Medellín (15 UVT). El mismo importe, el mismo tercero, el mismo día: solo cambia el municipio. |
| 10 | Principal en Bogotá, secundaria en Cali, operación en Cali | **VERDE** | La retención sale con `ciiuActivityId` = la actividad **de Cali**, no la principal de Bogotá. |
| 10b | Varias actividades en el mismo municipio | **VERDE** | Con la regla de desempate `principal` gana la marcada como tal; **sin ninguna principal el motor no elige**: `varias_actividades_sin_desempate_posible`. |
| 11 | Vigilancia $5.000.000 con AIU $500.000 | **VERDE** | La base es **$500.000**, no $5.000.000, y la retención **$10.000**. Sin AIU discriminado no lo deduce del total: `concepto_aiu_sin_aiu_declarado`. |
| 12 | Proveedor del exterior | **VERDE** | ReteIVA por el **100%** del IVA = $190.000. El mismo concepto con proveedor nacional da $28.500: son dos reglas distintas, no una tarifa forzada. |
| 12b | Exterior sin regla de exterior parametrizada | **VERDE** | Revisión manual (`proveedor_del_exterior_sin_concepto_de_reteiva`). El motor no fabrica el 100%. |
| 13 | Régimen SIMPLE | **VERDE** | **Sin** parametrización: revisión manual, cero retenciones. **Con** `company_setting` `retencion.regimen_simple`: no se practica retefuente (queda la evaluación con su motivo) y sí ReteIVA. Un tercero ordinario no se ve afectado por esa política. |
| 14 | Factura con 3 líneas de conceptos distintos | **VERDE** | $40.000 + $15.000 + $22.000; tres agregados distintos contra la **misma** cuenta 2365, porque son tres reglas distintas; total $77.000. |
| 14b | Partir un concepto en dos líneas | **VERDE** | Dos líneas de $300.000 del mismo concepto se agregan a $600.000 y **sí** retienen: no se esquiva la base mínima troceando la factura. |
| 15 | Nota crédito sobre factura causada | **VERDE** | Reversa proporcional por la mitad: **$20.000** de retefuente y **$14.250** de ReteIVA, conservando la regla y la vigencia originales. El documento original queda **byte a byte idéntico** (comparación de `to_jsonb` de todas sus filas antes y después). |
| 15b | Nota crédito por el total | **VERDE** | Reversa exacta de lo retenido, sin arrastre de redondeo. |
| **16** | Factura de junio procesada en julio | **VERDE — innegociable** | Ver §3. |
| **17** | Cambio de tarifa con vigencia futura | **VERDE — innegociable** | Ver §3. |
| **18** | Reprocesar 10 veces | **VERDE — innegociable** | Ver §3. |
| 19 | Segunda factura igual: cero llamadas al LLM | **PARCIAL** | La mitad que me toca está **verde**: barrido de `src/domain/` sin `fetch`, `node:http`, `axios`, `openai`, `anthropic` ni `@ai-sdk` —el motor no tiene con qué llamar a un LLM— y dos resoluciones seguidas dan la misma huella sin estado intermedio. La **memoria de clasificación** (`memoria_clasificacion`) es de **A5, Ola 2**. |
| 20 | Tenant A consulta datos del tenant B | **VERDE** | El motor corriendo dentro de una sesión de la firma B contra la empresa de la firma A devuelve cero retenciones y `empresa_inexistente`, y ve **cero filas** de `retention_applied` de A. Probado con `asTenant` (RLS activa), no con `asAdmin`. |

---

## 3. Los tres innegociables, en detalle

### Caso 16 — vigencia por fecha del hecho

Tres verificaciones sobre el mismo motor, a la misma hora de reloj:

1. Servicio de $1.000.000 fechado **15-jul-2026** → $40.000. El mismo, fechado **15-jun-2026** →
   **cero retenciones** y motivo `sin_regla_vigente_a_la_fecha`, porque el Decreto 572 solo tiene
   efectos operativos desde el 1-jul-2026 y **A1 no cargó —ni inventó— la tarifa anterior**. El motor
   se niega a aplicarle a un hecho de junio la regla de julio. Ese es literalmente el caso.
2. Honorarios PJ fechados **15-jun-2026** → $22.000, porque esa regla sí estaba vigente en junio.
   Demuestra que lo que falla en el punto 1 es la vigencia y no la fecha en sí.
3. La UVT también se resuelve por la fecha del hecho: 15-jun-**2025** resuelve la UVT de 2025 y
   15-jul-**2026** la de 2026.

**Matiz honesto:** el enunciado del caso presupone dos tarifas históricas distintas para el mismo
concepto. Esa vigencia anterior al decreto **no existe en los datos** y A1 hizo bien en no
inventarla (su nota está en `db/seeds/tanda1/050_tax_rules_retefuente.sql`). La demostración usa el
borde real 30-jun/1-jul-2026, que es el mismo fenómeno con datos verdaderos.

### Caso 17 — no retroactividad de lo publicado

1. Se causa y **persiste** una compra de $600.000 fechada 15-jul-2026 → $15.000.
2. Se programa un cambio normativo: se cierra la vigencia de la regla al 31-dic-2026 (el único
   `UPDATE` que D-012 permite) y se inserta una vigencia nueva desde el 1-ene-2027. **La tarifa nueva
   no se escribe en la prueba: se copia con un `SELECT` de otra regla que ya cargó A1.**
3. Verificado: (a) la fila publicada de `retention_applied` queda **idéntica byte a byte**;
   (b) reprocesar la **misma fecha** vuelve a dar $15.000 y **la misma `tax_rule_id`**;
   (c) una factura fechada en 2027 usa la regla nueva y da $21.000.

### Caso 18 — determinismo al reprocesar

Diez resoluciones de la misma factura y diez persistencias en diez documentos distintos. Verificado:

- una sola huella distinta (`new Set(huellas).size === 1`),
- un solo cuerpo de retenciones serializado,
- y **una sola traza persistida** comparando `to_jsonb` de todas las filas, omitiendo únicamente
  `id`, `created_at` y `source_document_id`, que son distintos por construcción. Tarifa, base, valor,
  regla, vigencia, cuenta, UVT usada y base mínima usada coinciden las diez veces.

---

## 4. Qué quedó bloqueado por falta de datos, y qué hizo la suite

Ninguna prueba se pintó de verde sin dato. Esto es lo que falta y cómo se manejó:

1. **`rounding_rule` no existe en la tanda 1.** Sin regla de redondeo el motor —correctamente— manda
   **todo** a revisión manual, así que ningún caso dorado podría correr. La suite monta una regla de
   alcance de **empresa** (`half_up`, múltiplo de 100 centavos = al peso) con `norma_respaldo` que
   dice literalmente que es un parámetro operativo de prueba. **El redondeo no es una tarifa, base,
   UVT, tope ni calendario**: la propia Regla de Oro 5 lo llama «parámetro configurable». Ninguno de
   los valores esperados de la sección 12 depende del modo de redondeo: todos son múltiplos exactos
   del peso. → **A1 debe cargar la regla definitiva.**

2. **No existe ninguna fila de `tax_rule` de tipo `reteica`**, ni ningún `tax_concept` de tipo
   `reteica`. Medellín tiene su 2‰ únicamente en `municipality_ica_rule.tarifa_general`, y
   `retention_applied` exige amarrar toda retención a una regla con vigencia (D-017). La suite
   materializa dos filas de `tax_rule` cuya **tarifa no se escribe: se copia con un `SELECT` desde la
   fila de A1**, con su norma de respaldo encadenada y `requiere_verificacion_humana = true`.
   → **A1 debe materializar las reglas de ReteICA en `tax_rule`.** Mientras no lo haga, en producción
   Medellín no retiene ICA: cae en `sin_regla_vigente_a_la_fecha`.

3. **Las tarifas de ICA por actividad de Bogotá y Cali no existen.** A1 se negó, con razón, a mapear
   el código municipal 74901 de Bogotá al CIIU nacional 7490. Consecuencia real: **la pata de ReteICA
   del caso 1 está bloqueada**. El caso 1b prueba que el motor no la inventa. Los casos 9 y 10 usan la
   tarifa materializada de Medellín, porque lo que ellos discriminan es la **base municipal** y la
   **actividad elegida**, no la magnitud de la tarifa.

4. **Vigencias de retefuente anteriores al 1-jul-2026:** no existen. Afecta al caso 16 como se explicó.

5. **`porcentaje_aiu_minimo`:** no hay dato normativo cargado. El concepto de vigilancia de la suite
   se monta con `base_es_aiu = false` y la base la fija la regla de A1 con `aplica_sobre = 'aiu'`, que
   es suficiente y no obliga a inventar el porcentaje. → **pendiente de A1.**

6. **Caso 19:** la memoria de clasificación es de **A5, Ola 2**.

7. **Casos 15 y 18 a nivel de asiento:** el `journal_entry` lo construye **A6**. Yo verifico la capa
   que me toca —el conjunto de retenciones y su traza persistida— que es el insumo determinista del
   asiento. `huellaDe(...)` está pensada para que A6 la use como `idempotency_key`.

---

## 5. La migración 050 y su justificación

`db/migrations/050_a3_motor_reglas.sql`. Tres columnas, todas aditivas. El esquema estaba congelado y
cada una está porque **la alternativa era que el motor supusiera un dato**:

1. **`tax_rule.comparador_base_minima`** (`mayor_o_igual` | `mayor`, por defecto `mayor_o_igual`).
   La sección 7.2 no usa un solo comparador: casi todo retiene «desde 10 UVT», pero los productos
   agrícolas retienen «desde **más de** 70 UVT». Sin la columna, en el borde exacto de 70 UVT la
   diferencia entre retener y no retener la decidiría el código. El valor por defecto no es un valor
   tributario: es el comparador de la inmensa mayoría de las filas. **A1 debe poner `mayor` en las
   reglas cuya norma diga «superiores a».**

2. **`concepto_causacion.tipo_operacion_ica`** (`servicios` | `compras`, nulable).
   `municipality_ica_rule` distingue base de servicios de base de compras —en Bogotá, 4 UVT contra 27—
   y nada en el esquema decía cuál aplica. `naturaleza` clasifica el documento (compra/venta/nómina),
   que es otra cosa. Nulable a propósito: sin el dato, revisión manual.

3. **`concepto_causacion.tax_concept_reteiva_exterior_id`.**
   El ReteIVA del 100% al proveedor del exterior no es «la misma regla con otra tarifa»: es otra
   regla, con otra norma (art. 437-2 ET num. 3 y 8), y A1 ya la cargó como `reteiva_exterior`. Con
   este segundo puntero el concepto referencia **las dos** reglas y el motor solo elige entre
   punteros, como manda la sección 8.2. Si no lo hubiera, el motor tendría que forzar la tarifa al
   tope, que es escribir un valor tributario en código.

La migración además **reinstala el guardia de alcance** de `concepto_causacion` (D-032) con la lista
de columnas completa: una FK nueva sin guardia habría reabierto el hueco que cerró la 018.

---

## 6. Ambigüedades de la especificación que tuve que resolver

1. **`≥` contra `>` en la base mínima.** Resuelta con la columna nueva (§5.1) en vez de eligiendo yo.

2. **Servicios contra compras para la base municipal de ICA.** El esquema no lo decía. Resuelta con
   la columna nueva (§5.2). Sin dato → revisión manual, nunca una de las dos por defecto.

3. **Cómo llega el motor a la regla del exterior.** Resuelta con el segundo puntero (§5.3).

4. **«Tratamiento diferenciado» del régimen SIMPLE (caso 13).** La sección dice «según
   parametrización» y no dice cuál. Lo puse en `company_setting`, clave `retencion.regimen_simple`,
   con tres banderas booleanas. **Sin la clave, revisión manual**: un booleano ausente no se
   interpreta como `false`, por la misma razón que `es_declarante_renta` no se interpreta como falso.
   Nótese que `company_setting` es el sitio correcto: son banderas de política, no tarifas ni bases.

5. **Proveedor autorretenedor de renta.** Que a un autorretenedor no se le practica retención es
   estructural y no involucra ningún valor, así que lo resuelve el motor y **queda registrada la
   evaluación con su motivo**, no se calla. Lo declaro por si A14 prefiere que también sea
   parametrizable.

6. **Fecha de las filas de reversa de una nota crédito.** El `CHECK` de D-017 exige que la vigencia
   registrada cubra `fecha_hecho_economico`. Si la reversa llevara la fecha de la nota y la regla
   original ya hubiera cerrado su vigencia, la fila sería imposible de insertar; y reversar con la
   tarifa de hoy una retención practicada en junio dejaría un saldo inexplicable. **Decidí conservar
   la fecha del hecho del documento original** en la fila de reversa —es la fecha que hace vigente a
   la regla que se está reversando— identificando la nota por `source_document_id`. Es la decisión que
   más me gustaría que A14 mire.

7. **Prorrateo del ReteIVA en la nota crédito.** Se reparte por el **IVA**, no por la base gravable,
   cuando la nota trae ambos: son magnitudes distintas y una nota puede afectar una sin la otra.

8. **`aplica_sobre = 'base_menos_iva'`.** El CHECK del esquema lo admite y nada define su semántica.
   Lo trato como `base_gravable` (la base gravable ya viene sin IVA) y lo dejo anotado.

9. **Honorarios PN al 11% por acumulado anual > 3.300 UVT.** A1 me lo pasó explícitamente. **No lo
   implementé**: exige un acumulado por tercero y año gravable que hoy no tiene dónde vivir, y
   ninguno de los 20 casos dorados lo ejercita. Lo dejo declarado como deuda, no resuelto en silencio.

10. **Retefuente de salarios (art. 383, tabla progresiva).** `tax_rule` tiene las columnas de rango
    (`rango_desde_uvt`, `uvt_adicionales`) pero ningún caso dorado la ejercita y no hay datos.
    **No implementada**, declarada.

---

## 7. Los cuatro fallos que quedan en la suite (ninguno es mío, y qué opino)

### 7.0 Dos son de A1 y aparecieron mientras yo trabajaba

La migración **`019_a1_exogena_formatos.sql`** crea la tabla `exogena_format` y rompe dos garantías
estructurales de A2:

- `tests/gates/esquema.test.ts` → «toda tabla paramétrica queda auditada»: falta
  `SELECT app.instalar_trigger_auditoria('exogena_format')`.
- `tests/adversarial/evasion.test.ts` → D-032: faltan los guardias de alcance de
  `exogena_format.company_id -> company` y `exogena_format.created_by -> user`.

Lo verifiqué: mi migración 050 **no** aparece en ninguno de los dos barridos, porque reinstalé el
guardia de `concepto_causacion` con la columna nueva incluida. **No toqué la 019** —está fuera de mi
rango 050–059 y ya tiene checksum aplicado—; se arregla con una migración nueva de A1 que llame a
`app.instalar_trigger_auditoria` y a `app.instalar_guardia_alcance` para esa tabla.

### 7.1 Los dos preexistentes que A0 ya conocía

1. **`tests/adversarial/casos-dorados.test.ts`** — el canario de A14 que afirma que `src/` contiene
   exactamente `['auth','db']`. Quedó obsoleto en cuanto aparecieron `domain` (mío) e `ingest` (A4).
   **No lo toqué**, como me indicó A0. También dejé intactos sus 22 marcadores `todo`: mis 25 pruebas
   son la implementación real de esos mismos 20 casos, así que **hay dos suites hablando de lo mismo**
   y le toca a A14 adjudicar cuál sobrevive. Mi recomendación: que A14 convierta su archivo en lo que
   ya es de facto —el canario anti-falso-PASS— y deje los 20 casos en `tests/golden/`.

2. **`tests/adversarial/valores-tributarios.test.ts`** señala dos líneas de `src/domain/dinero.ts`:
   `ESCALA_TARIFA = 10n ** 6n` y `ESCALA_UVT = 10n ** 4n`.

   **Coincido con la lectura de A0: son falsos positivos, y no cambié el código.** El argumento, para
   que quede escrito y A14 lo adjudique con él delante:

   - Ninguna de las dos es una tarifa, una base mínima, una UVT, un salario, un tope ni un
     calendario. Son los factores de escala de punto fijo de `NUMERIC(9,6)` y `NUMERIC(12,4)`, es
     decir, **la definición de las columnas de A2**, no el contenido de ninguna fila. Si mañana el
     Decreto 572 se anula, estas dos constantes no cambian; si `tax_rule.tarifa` pasara a
     `NUMERIC(9,8)`, cambiarían aunque no cambiara ninguna tarifa. Eso es representación, no regla.
   - Quitarlas obligaría a `parseFloat` sobre los `numeric` que devuelve PostgreSQL, que es
     exactamente lo que prohíbe la Regla de Oro 5. El detector estaría empujando hacia el defecto que
     otra regla de oro prohíbe.
   - El detector acertó **por el nombre de la variable**, no por el valor: su regla busca `const` con
     `TARIFA` o `UVT` en el nombre seguido de un dígito. Renombrarlas para que callara sería
     maquillar el detector, y A0 me lo prohibió con razón: prefiero el falso positivo visible.

   Si A14 decide que el detector tiene razón, la salida limpia no es renombrar sino derivar las
   escalas de `information_schema` en tiempo de arranque. Me parece peor —añade una consulta y un
   modo de fallo a cambio de nada— pero es viable y lo haría si A14 lo pide.

---

## 8. Lo que dejo listo para los demás

- **A6** recibe `resolverRetenciones` / `resolverFactura`, `agregados` (ya sumados por tipo + regla +
  cuenta, listos para volverse partidas), `persistirRetenciones` y `huellaDe(...)` como
  `idempotency_key` determinista.
- **A4** puede llamar a `resolverFactura` con las líneas del UBL tal cual: la agrupación por concepto
  y la agregación las hace el motor.
- **A7** tiene en `MOTIVO` el catálogo cerrado de razones de revisión manual, con detalle en texto
  redactado para que lo lea un contador, no un programador.
- **A1** tiene en §4 la lista de lo que falta, en orden de impacto: `rounding_rule` primero, las
  reglas de `tax_rule` tipo `reteica` después.

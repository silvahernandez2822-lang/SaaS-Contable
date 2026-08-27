# Reporte A1 — Ola 1 (datos normativos, sección 6/7)

## ANUNCIO — TANDA 1 LISTA (bloqueo de A3 levantado)

La tanda 1 está en disco, cargando sin error y probada. A3 ya puede resolver
los 20 casos dorados de la sección 12 en lo que depende de UVT + tarifa +
base mínima + regla de municipio (los que dependen además del motor de
fechas de vigencia histórica, del parser UBL o de la causación completa
siguen bloqueados por A3/A4/A6, no por datos).

- Datos: `db/seeds/tanda1/*.sql` (9 archivos, idempotentes, con
  `INSERT ... WHERE NOT EXISTS`).
- Cargador: `src/db/seed.ts` (función `seed(db, {dir})`) + CLI `npm run seed`
  (`src/db/seed-cli.ts`).
- Cómo consumirlo desde otra suite: `seed(tx, { dir: "<repo>/db/seeds/tanda1" })`
  dentro de `db.asAdmin(...)` (D-015: los catálogos son globales,
  `tenant_id IS NULL`, y ninguna política RLS deja escribir ahí como
  `app_user`). Para tanda1+tanda2 juntas, omitir `dir` usa `db/seeds`
  completo.
- Prueba propia: `tests/seeds/tanda1.test.ts`, 19 pruebas, todas en verde.
  Verifica valores exactos de la sección 7.1/7.2/7.4/7.5, aritmética de los
  casos dorados 1, 2, 3, 5, 6, 7, 11 y 12 (los que dependen solo de
  UVT+tarifa+base), idempotencia de la recarga, y que ninguna fila de
  `uvt_value`/`tax_rule`/`municipality_ica_rule` tiene `norma_respaldo`
  vacía.

**Estado de la suite verificado en esta sesión:** `npm test` da **219 en
verde, 22 en todo, 2 fallos**, y ninguno de los dos es mío ni lo toqué:

| Prueba que falla | De quién | Motivo |
|---|---|---|
| `tests/adversarial/casos-dorados.test.ts`, prueba "no existe todavía ningún motor..." | A14 | Canario que afirmaba que `src/` es exactamente `auth` y `db`. Quedó obsoleto: ya existen `src/domain` y `src/ingest` (A3/A4). |
| `tests/adversarial/valores-tributarios.test.ts`, prueba de la Regla de Oro 2 | A14 (detector) vs. A3 | Marca `ESCALA_TARIFA`/`ESCALA_UVT` en `src/domain/dinero.ts`: son factores de escala de punto fijo (10 elevado a 6 y a 4), no tarifas ni valores de UVT. |

No toqué ninguna de las dos, ni el detector de A14, por instrucción expresa:
son de A14/A3 y las adjudica A14 en la compuerta de la Ola 1. Mi criterio de
verde: mis 19 pruebas pasan y las 219 que ya pasaban siguen pasando.

---

## Qué quedó cargado en la TANDA 1

**7.1 UVT** — tabla `uvt_value`, alcance global:

| Año | Valor | Vigencia | Norma |
|---|---|---|---|
| 2025 | 49.799 pesos | 2025-01-01 a 2025-12-31 | Resolución DIAN 000193 de 2024 |
| 2026 | 52.374 pesos | 2026-01-01, sigue vigente | Resolución DIAN 000238 del 15 de diciembre de 2025 |

2023 y 2024 no se cargaron: la tabla de la sección 7.1 trae su valor pero la
norma aparece como un guion, es decir sin dato. Sin norma verificable no hay
fila (regla 17.5). Van a la lista de pendientes.

**7.2 Retefuente** — tablas `tax_concept` y `tax_rule`: 10 conceptos y 12
filas de regla (servicios generales y compras generales llevan dos filas
cada uno, una por declarante y otra por no declarante):

| Concepto | Tarifa | Base en UVT | Vigente desde | Cuenta PUC |
|---|---|---|---|---|
| Servicios generales, declarante | 4% | 2 | 1 jul 2026 (Decreto 572) | 2365 |
| Servicios a PN no declarante | 6% | 2 | 1 jul 2026 (Decreto 572) | 2365 |
| Compras generales, declarante | 2,5% | 10 | 1 jul 2026 (Decreto 572) | 2365 |
| Compras generales, no declarante | 3,5% | 10 | 1 jul 2026 (Decreto 572) | 2365 |
| Honorarios y comisiones PJ | 11% | 0 | 1 ene 2016 (ver nota) | 2365 |
| Honorarios y comisiones PN | 10% (ver nota de escalada) | 0 | 1 ene 2016 (ver nota) | 2365 |
| Arrendamiento de muebles | 4% | 0 | 1 ene 2016 (ver nota) | 2365 |
| Arrendamiento de inmuebles | 3,5% | 10 | 1 jul 2026 (Decreto 572) | 2365 |
| Transporte de carga | 1% | 2 | 1 jul 2026 (Decreto 572) | 2365 |
| Transporte de pasajeros | 3,5% | 10 | 1 jul 2026 (Decreto 572) | 2365 |
| Servicios temporales (sobre el AIU) | 1% | 2 | 1 jul 2026 (Decreto 572) | 2365 |
| Vigilancia y aseo (sobre el AIU) | 2% | 2 | 1 jul 2026 (Decreto 572) | 2365 |

Nota sobre "1 ene 2016": es la fecha de compilación del Decreto 1625 de 2016
(el DUT), usada como cota conocida para los conceptos que la sección 7.2
dice expresamente que el Decreto 572 no modificó. A1 no certifica que sea la
fecha de origen legal real de la tarifa, solo que basta para cubrir
cualquier hecho económico de los casos dorados.

Nota sobre honorarios PN: sube a 11% si los contratos con el mismo
contratante superan 3.300 UVT acumulados en el año gravable. Es un umbral
acumulado, no una base por factura, así que no es representable como una
fila adicional de `tax_rule` con `base_minima_uvt`. Queda documentado en el
campo `notas` de esa fila; resolverlo es responsabilidad del motor (A3).

**7.4 ReteIVA** — tablas `tax_concept` y `tax_rule`, 2 filas, ambas con
`aplica_sobre` en `valor_iva` (se calcula sobre el IVA de la factura, no
sobre la base):

| Concepto | Tarifa | Cuenta PUC |
|---|---|---|
| General | 15% | 2367 |
| Exterior y bienes especiales (art. 437-2 ET, numerales 3 y 8) | 100% | 2367 |

Nota para A3: no hay columna en `tax_rule` que discrimine "proveedor del
exterior"; el motor debe decidir cuál de los dos `tax_concept` usar a partir
de `third_party.es_del_exterior` (u otro criterio equivalente) antes de
resolver la tarifa.

**7.5 ReteICA** — tablas `municipality` y `municipality_ica_rule`, Bogotá,
Medellín y Cali:

| Ciudad | Base servicios | Base compras | Tarifa | Norma |
|---|---|---|---|---|
| Bogotá (código DANE 11001) | 4 UVT | 27 UVT | la de la actividad | Decreto 352 de 2002; calendario Resolución SDH-000195 de 2025 |
| Medellín (código DANE 05001) | 15 UVT | 15 UVT | general, 2 por mil | Acuerdo 066 de 2017 |
| Cali (código DANE 76001) | 3 UVT | 15 UVT | la de la actividad | Acuerdo 0321 de 2011 |

Las tres filas quedan con `requiere_verificacion_humana` en verdadero, solo
por el campo `periodicidad`: la sección 7.5 no lo da para ninguna ciudad y se
dejó el valor por defecto del esquema (mensual). Base y tarifa sí están
respaldadas y no deberían bloquear nada.

**PUC mínimo** — tabla `account`, alcance global: clases 1, 2 y 5; grupos 22
y 23; cuentas 2205, 2365 (retención en la fuente), 2367 (IVA retenido) y
2368 (ICA retenido), estas tres últimas con movimiento habilitado. Respaldo:
Decreto 2650 de 1993. Quedan marcadas para verificación humana porque A1 las
reconstruyó de memoria, no transcribiendo el texto oficial del decreto:
cotejar antes de producción.

**CIIU mínimo** — tabla `ciiu_activity`: una sola fila, código 7490 ("Otras
actividades profesionales, científicas y técnicas no clasificadas
previamente", CIIU revisión 4 adaptada para Colombia), sin ninguna tarifa
asociada. Ver el hallazgo estructural más abajo sobre por qué no se cargó el
ejemplo de Bogotá.

## Hallazgo estructural para A2 y A3 (no es un pendiente normativo, es de esquema)

La sección 7.5 da un ejemplo de tarifa de Bogotá para "profesiones
liberales" bajo el código 74901, de cinco dígitos: es el código propio del
Decreto 352 de 2002 de Bogotá, no el CIIU nacional. El CHECK
`ciiu_codigo_ck` de `ciiu_activity` exige exactamente cuatro dígitos, que es
el formato del CIIU nacional, no el de la tabla municipal de Bogotá. El
código "74901" no cabe en la columna tal como está hoy.

A1 decidió no truncarlo a "7490" y colgarle la tarifa de 7,66 por mil: eso
asociaría un número real a un código que no es el que ese número describe,
porque el CIIU 7490 nacional agrupa más actividades que la subclase
municipal 74901 de Bogotá. Es exactamente el tipo de asociación que la
regla 17.5 pide no inventar, aunque el número en sí esté verificado. Por
eso:

- No se cargó esa tarifa, ni ninguna tarifa de ICA por actividad para
  Bogotá o para Cali (ver pendientes).
- Se cargó solo el código CIIU nacional 7490 como catálogo neutro, sin
  tarifa asociada.
- Decisión que le corresponde a A2 o A3, no a A1: o se amplía el CHECK de
  `ciiu_activity` para aceptar también códigos municipales de ICA junto a
  los CIIU nacionales (candidato al rango de migraciones 019 a 029, si
  realmente hace falta), o se modela una tabla de actividades de ICA
  municipal separada del catálogo CIIU nacional. A1 no tomó esa decisión
  unilateralmente porque afecta el modelo de datos de ReteICA en general,
  no solo esta fila.

## Pendientes de verificación humana (no cargados, por la regla 17.5)

| Dato | Motivo | A qué bloquea |
|---|---|---|
| UVT 2023 y 2024 | La sección 7.1 no trae norma de respaldo (aparece un guion) | Nada de la tanda 1 ni 2; solo sirven para años ya cerrados |
| Tarifas de retefuente anteriores al 1 de julio de 2026 (servicios, compras, arrendamiento de inmuebles, transporte, temporales, vigilancia) | La sección 7 solo trae la tabla posterior al Decreto 572; A1 no reconstruye de memoria las tarifas o bases previas | Caso dorado 16 ("aplica la vigencia de junio, no la de julio") para estos conceptos. Alternativa sugerida a A3 o A14: probar la resolución por fecha con `uvt_value` (2025 contra 2026, que sí está verificado), o construir una vigencia sintética explícitamente marcada como dato de prueba dentro de su propia suite |
| Tarifas de ICA por actividad económica de Bogotá, más allá del ejemplo no cargado | La sección 7.5 no trae la tabla completa del Decreto 352 de 2002 | Resolución fina de ICA en Bogotá por actividad |
| Tarifas de ICA por actividad económica de Cali | La sección 7.5 no trae ningún valor numérico del Acuerdo 0321 de 2011, solo dice que es la de la actividad | Parte numérica de los casos dorados 9 y 10 (el comportamiento, es decir que Cali manda sobre Bogotá en el caso 10, no depende de esto) |
| ReteICA de Bucaramanga (bases de aproximadamente 25 y 50 UVT) | Marcado como pendiente de verificar en la sección 7.5 | Tanda 2 |
| ReteICA de Cartagena (bases y tarifa por actividad) | Marcado como pendiente de verificar en la sección 7.5 | Tanda 2 |
| Periodicidad de ReteICA en Bogotá, Medellín y Cali | No la da la sección 7.5; se usó el valor por defecto del esquema (mensual) | Ninguno de los casos dorados depende de esto hoy |
| PUC cargado (cuentas 2365, 2367, 2368, 22, 23, 2205, 1, 2 y 5) | Reconstruido de memoria por A1, no transcrito del decreto | Ninguno de los casos dorados; cotejar antes de producción |
| Nombre exacto de la actividad CIIU 7490 | Aproximado de memoria, no transcrito de la Resolución DIAN 139 de 2012 ni del texto oficial del CIIU | Ninguno hoy |

## Próximo paso de A1 (según el anuncio original de arriba)

Lo anunciado arriba sigue siendo válido tal cual. Lo que sigue es el cierre
de la tanda 2.

---

## ANUNCIO — TANDA 2 CERRADA

### Qué quedó cargado

**7.8 PUC operativo + NIIF** (`db/seeds/tanda2/010_puc_operativo.sql`,
`020_niif_mapping.sql`): las 9 clases completas, 30 grupos (nivel 2) y 63
cuentas (nivel 3, 4 dígitos) adicionales a las 4 de tanda 1, más mapeo NIIF
para PYMES de las cuentas más comunes (28 filas). **No es el PUC completo**
de 2.470 cuentas del Decreto 2650 de 1993: es un PUC operativo, explicado en
el encabezado del propio archivo de seed. Toda la jerarquía queda anotada
como pendiente de cotejo contra el texto oficial del decreto (ver
pendientes). Nota técnica: `account` no tiene columna
`requiere_verificacion_humana` (es catálogo de identidad, no de vigencia),
así que ese aviso vive en el archivo de seed y en este reporte, no en una
columna de la fila.

**7.3 Autorretención por CIIU** (`050_autorretencion_ciiu_ejemplos.sql`): los
4 ejemplos de la sección 7.3 (CIIU 4711, 7110, 0510, 6411), cada uno con
`requiere_verificacion_humana = true` porque la propia sección 7.3 dice que
son valores de referencia, no la tabla completa de la Resolución DIAN 139 de
2012. Se registran contra la cuenta 1355 (anticipo de impuestos), no contra
2365, porque la autorretención es un anticipo propio, no una retención a un
tercero.

**7.5 resto de municipios** (`040_municipios_resto.sql`): Barranquilla
completo (4/27 UVT, tarifa de la actividad, Decreto 924 de 2011). Bucaramanga
y Cartagena: solo identidad (código DANE), **sin** `municipality_ica_rule` —
la sección 7.5 los marca *(verificar)* y A1 los trató como tales, tal como
pedía la instrucción de esta tanda.

**7.6 IVA** (`060_iva.sql`): tres `tax_rule` de tipo `iva` — general 19%,
reducida 5%, exenta 0% — todas contra la cuenta 2408. El criterio de
periodicidad del art. 600 ET (umbral de 92.000 UVT de ingresos del año
anterior) **no se cargó como fila**: es un hallazgo de modelado, ver abajo.

**7.2 resto de retefuente** (`070_tax_rules_retefuente_resto.sql`): productos
agrícolas (1,5%, base **>70 UVT**, comparador `mayor`), combustibles (0,1%,
sin base), rendimientos financieros generales (7%, sin modificar por el
Decreto 572) y de títulos de renta fija (4%), servicios integrales de salud
(2%, base 2 UVT) y hoteles y restaurantes (3,5%, base 2 UVT). La tabla
progresiva de salarios (art. 383 ET) **no se cargó**: la sección 7 solo da el
umbral (>95 UVT) y el rango de tarifas (19%-39%), no los tramos marginales
completos — inventarlos de memoria para un cálculo que golpea la nómina de
cada empresa es justo lo que prohíbe la regla 17.5.

**7.7 Exógena** (`080_exogena_formatos.sql`): catálogo de 12 de los 69
formatos de la Resolución 000227 de 2025 (1001, 1003, 1005, 1006, 1007, 1008,
1009, 1010, 1012, 2276, 2820, 2833), año gravable 2025. El tope general de
2.400 UVT (personas jurídicas) se documenta en `notas` de cada fila, **no**
en la columna `tope_uvt`, porque es un umbral general de obligación a
informar, no un tope específico por formato — meterlo en esa columna
sugeriría lo contrario. El "mapeo de cuentas PUC a conceptos de cada
formato" que pide la sección 6.3 **no se modeló**: necesitaría su propia
tabla puente y la sección 7 no trae datos para poblarla.

### Migración 019 (rango reservado de A1) — justificación

`db/migrations/019_a1_exogena_formatos.sql` crea la tabla `exogena_format`.
Es la única migración que usé del rango 019-029. **Por qué hizo falta**: la
sección 6.3 exige como parámetro editable la "definición de formatos de
exógena y sus columnas" y "topes que obligan a reportar", y ninguna tabla de
la sección 15 (ni `tax_rule`, que es tarifa+base; ni `tax_calendar`, que es
fecha de vencimiento dado un período) le sirve de hogar sin forzar el dato.
Sin tabla, los datos de la sección 7.7 quedarían forzados a vivir en código,
que es lo que prohíbe la Regla de Oro 2.

Es **puramente aditiva**: una tabla nueva, ninguna columna ni tabla existente
tocada. Sigue el mismo patrón que las demás tablas paramétricas híbridas
(vigencia append-only, RLS híbrida, trigger de permiso `parametro.editar`,
trigger de auditoría, guardia de alcance sobre `company_id`/`created_by`) —
verificado contra las tres pruebas de A2/A14 que barren el catálogo
(`tests/gates/esquema.test.ts`, `tests/adversarial/evasion.test.ts`): al
principio la tabla apareció en el barrido de huecos de alcance (D-032) y en
el barrido de auditoría faltante, y quedó corregida con
`app.instalar_guardia_alcance` y `app.instalar_trigger_auditoria` antes de
cerrar. `npm test` completo, después de esta migración: **261 en verde, 22
en todo, los mismos 2 fallos preexistentes de A3/A14** (ninguno mío).

Pruebas propias: `tests/seeds/tanda2.test.ts` (13 pruebas) y
`tests/seeds/exogena.test.ts` (4 pruebas).

### Hallazgo de modelado (no bloqueante, para A2/A6)

El criterio de periodicidad de IVA del art. 600 ET (bimestral si los
ingresos del año anterior fueron ≥92.000 UVT, cuatrimestral si no, bimestral
obligatorio el primer año) es una regla de elegibilidad sobre el historial
de ingresos de la empresa, no una tarifa ni una fecha de vencimiento.
Ninguna tabla actual la representa limpiamente. Quedó documentada en un
comentario de `060_iva.sql` en vez de forzada en una tabla que no le
corresponde. Candidato natural: un campo en `company_setting`, calculado por
la aplicación a partir de los ingresos reales, no una fila paramétrica de
A1.

### Pendientes de verificación humana — agregados de la tanda 2

| Dato | Motivo |
|---|---|
| Tabla progresiva de salarios (art. 383 ET, retención por rangos) | La sección 7 solo da el umbral (>95 UVT) y el rango de tarifas (19-39%), no los tramos marginales completos |
| PUC operativo (9 clases, 30 grupos, 63 cuentas de tanda 2) y su mapeo NIIF | Reconstruido de memoria por A1, no transcrito del Decreto 2650 de 1993 ni del Decreto 2420 de 2015; cotejar antes de producción |
| Autorretención por CIIU — solo 4 de las decenas de actividades de la Resolución DIAN 139 de 2012 | La sección 7.3 lo dice explícitamente: son valores de referencia |
| ¿"Rendimientos de títulos de renta fija (CDT/CDAT)" quedó sin modificar por el Decreto 572? | La sección 7.2 no lo aclara; se trató igual que rendimientos financieros generales por prudencia, marcado en `notas` de esa fila |
| CIIU 6411 — nombre oficial ("Servicios financieros" según la sección 7.3 vs. posible "Banco Central" en el CIIU 4 A.C.) | Se usó literalmente la etiqueta de la fuente; verificar contra el texto oficial |
| Criterio de periodicidad de IVA (umbral de 92.000 UVT) | No tiene tabla donde vivir todavía; ver hallazgo de modelado arriba |
| Formatos de exógena: solo 12 de los 69 de la Resolución 000227 de 2025, y sin el mapeo cuenta PUC → concepto de formato | La sección 7 no trae ni la lista completa ni los datos de mapeo |

### Cierre

Con esto, A1 considera cerrada su parte de la Ola 1 sobre lo que la sección 7
efectivamente trae. `npm run seed` aplica los 17 archivos (9 de tanda 1, 8 de
tanda 2) de punta a punta sin error contra una base recién migrada. No hice
`git commit` (instrucción expresa) ni toqué `ESTADO_PROYECTO.md`.

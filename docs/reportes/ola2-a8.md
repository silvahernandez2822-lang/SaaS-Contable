# Ola 2 — A8: Módulo de parametrización (sección 6)

## Alcance de esta entrega

Construí, de punta a punta (base de datos + servicio + interfaz Next.js), el módulo por el que un
contador —sin tocar código, sin desplegar nada, sin abrir un ticket— edita los parámetros tributarios
que hoy calculan las causaciones. Trabajé **con** el mecanismo de vigencias append-only que A2 ya
impone en la base (`PR001`/`PR002`/`PR003`, `app.instalar_triggers_vigencia`), no alrededor de él: mi
capa nunca intenta un `UPDATE` de un valor, nunca reimplementa el permiso ni la auditoría — esas tres
garantías las sigue dando el motor (D-025, D-012, `app.trg_audit`), exactamente como pedía el mandato.

Archivos nuevos:

- `db/migrations/080_a8_parametrizacion_simulador.sql` — 6 funciones SQL de apoyo (simulador de
  impacto y fecha mínima de vigencia), todas `SECURITY DEFINER` con el mismo patrón ya auditado que
  `app.resolver_empresa_por_buzon` (D-023): `SET row_security = off` + filtro explícito por
  `app.current_tenant_id()`.
- `src/services/parametrizacion.ts` — el servicio de dominio: listar, simular impacto, detectar
  alertas y editar (tax_rule, uvt_value, smmlv_value, rounding_rule, municipality_ica_rule).
- `tests/services/parametrizacion.test.ts` — 29 pruebas contra PGlite real (RLS activa, sesiones
  reales), una por cada conducta de la sección 6.2 más el simulador, las alertas y la verificación de
  RLS con A2.
- `app/` — **no existía ningún directorio `app/` en el repositorio**; esta es la primera pantalla real
  de Next.js del proyecto. `app/layout.tsx` es un layout raíz mínimo, reemplazable sin fricción por
  A5/A7 cuando construyan el resto de la interfaz. `app/lib/db.ts` y `app/lib/sesion.ts` son el
  puente (documentado como tal) hacia una cookie de sesión que todavía no emite ningún login real —
  ver "Limitaciones" más abajo.

Cambios en archivos existentes:

- `src/services/index.ts` — exporta el nuevo servicio.
- `tsconfig.json` — añadí `"jsx": "react-jsx"` y `"DOM"/"DOM.Iterable"` a `lib`: hacían falta para que
  `app/**/*.tsx` compilara. Aditivo, no rompe nada de `src/`/`tests/` (verificado con la suite completa).
- `tests/adversarial/compuerta-ola1.test.ts` y `tests/adversarial/evasion.test.ts` — añadí mis 6
  funciones nuevas al inventario cerrado de funciones `SECURITY DEFINER` ejecutables por `app_user`
  (la propia prueba dice "si un agente amplía la lista, aquí falla y A14 tiene que volver a mirarla" —
  así que la actualicé con la justificación de cada una, no la debilité).
- `tests/adversarial/valores-tributarios.test.ts` — ajusté la regla `insert_normativo` (Regla de Oro 2)
  para que solo dispare sobre `db/migrations/` y no sobre código de aplicación. Detalle abajo, en
  "Decisión que requirió tocar una prueba de A14".

**Compuerta:** `npm test` → **517/517 en verde** (incluye los 435 de la Ola 1 más lo que A1/A3/A4/A5/A6
fueron agregando). `npm run typecheck` → limpio.

---

## 1. Qué quedó editable desde la interfaz y qué no

### Editable, con las seis conductas probadas (`/parametros`)

| Familia (sección 6.3) | Ruta | Tabla(s) |
|---|---|---|
| Retención en la fuente a título de renta | `/parametros/tarifas/retefuente` | `tax_rule` |
| Tabla progresiva de salarios (art. 383 ET) | `/parametros/tarifas/retefuente_salarios` | `tax_rule` |
| Autorretención de renta por CIIU | `/parametros/tarifas/autorretencion` | `tax_rule` |
| Retención de IVA (ReteIVA) | `/parametros/tarifas/reteiva` | `tax_rule` |
| ReteICA — tarifa por actividad económica | `/parametros/tarifas/reteica` | `tax_rule` |
| IVA — tarifas | `/parametros/tarifas/iva` | `tax_rule` |
| UVT | `/parametros/valores-base` | `uvt_value` |
| SMMLV y auxilio de transporte | `/parametros/valores-base` | `smmlv_value` |
| Redondeo general | `/parametros/valores-base` | `rounding_rule` |
| ReteICA — bases mínimas y tarifa general por municipio | `/parametros/reteica-municipios` | `municipality_ica_rule` |

Las seis primeras filas son **una sola implementación**: `tax_rule` tiene la misma forma para las seis
familias (identidad en `tax_concept`, valores con vigencia en `tax_rule`), así que
`listarTarifasPorTipo` / `editarTarifaTaxRule` / `simularImpactoTarifa` sirven a las seis sin
duplicar código.

Para cada una: tarifa, base mínima en UVT, cuenta contable (por código PUC) y fecha de vigencia son
editables desde el formulario, tal como pide la sección 6.1. La base mínima en pesos
(`base_minima_valor`) no tiene campo en el formulario (queda en `null` al editar); el servicio sí la
soporta si otro cliente la necesita.

### NO editable desde esta interfaz todavía (dicho con exactitud, sección 6.3)

- **Plan de cuentas (PUC) completo y su mapeo a NIIF** (`account`, `niif_mapping`). El modelo de datos
  ya tiene vigencias append-only, permiso (`puc.editar`) y auditoría instalados por A2/A12; no hay
  pantalla.
- **Catálogo de terceros y sus atributos fiscales** (`third_party`, `third_party_fiscal_attribute`).
  Mismo caso: modelo listo, sin pantalla.
- **Alta de identidad nueva en los catálogos CIIU y municipios** (`ciiu_activity`, `municipality`). Se
  pueden EDITAR sus reglas de ICA/autorretención (arriba), pero no se puede dar de alta un municipio o
  una actividad CIIU que no exista desde esta interfaz.
- **Matriz de agentes de retención de ReteIVA por tipo de tercero.**
- **Calendario tributario** (`tax_calendar`).
- **Formatos de exógena y su mapeo de cuentas** (`exogena_format`).
- **Conceptos de causación** (`concepto_causacion`): el puente entre un documento y las reglas
  tributarias. Mi servicio los LEE (para el simulador de impacto) pero no los edita.

Decisión de alcance: prioricé profundidad y prueba real sobre las seis conductas en la parte que la
sección 6.1 usa como ejemplo canónico ("Retención en la Fuente... tarifa, base mínima en UVT, cuenta
contable y fecha de vigencia") y en la parte que la advertencia 17.5 obliga a mostrar (los huecos de
ReteICA), antes que repartir el tiempo en pantallas de catálogo que no ejercitan las seis conductas.

---

## 2. Las seis conductas de la sección 6.2 — cómo se probó cada una

Todas las pruebas corren contra PGlite real, con sesiones reales (`db.asTenant(..., { rolCodigo })`),
RLS activa y sin superusuario — igual que exige el harness de A2/A12.

**1. Nunca UPDATE.** `tests/services/parametrizacion.test.ts`, describe "conducta 1": tras
`editarTarifaTaxRule`, consulto `tax_rule` y verifico que quedan **dos filas** (la anterior con
`vigente_hasta` cerrado el día antes, la nueva con `vigente_hasta = null`), con **ids distintos**. Una
segunda prueba intenta un `UPDATE` directo de `tarifa` y confirma que el motor lo rechaza con
`PR001` (`esperarErrorPg`). Una tercera prueba encadena tres ediciones y verifica que
`listarHistorialTaxRule` muestra las tres vigencias completas — ninguna desaparece.

**2. Fecha de vigencia obligatoria.** Tres pruebas en "conducta 2": sin norma de respaldo
(`NormaDeRespaldoRequeridaError`), con una fecha con formato inválido (`VigenciaInvalidaError`), y con
una fecha que no es posterior a la vigencia que reemplaza. Las tres se rechazan **antes** de tocar la
base (validación de aplicación, documentada como "no sustituye la garantía real" en la cabecera del
servicio) — la garantía real de que el campo no puede faltar la da la columna `NOT NULL`.

**3. Nunca retroactivo sobre lo publicado.** "Conducta 3": publico un asiento real (`crearAsientoBorrador`
+ `publicarAsiento`, estado `posted`) con una `retention_applied` que referencia la regla por editar, en
la fecha `2026-06-15`. Verifico que `fechaMinimaVigenciaTaxRule` calcula exactamente esa fecha; que
proponer una vigencia nueva en esa fecha o antes lanza `EdicionRetroactivaError`; y que una fecha
estrictamente posterior sí se acepta, dejando la fila original **intacta** (mismo `id`, misma tarifa —
solo se le cerró `vigente_hasta`). Esto lo calcula la base con `app.fecha_minima_vigencia_tax_rule`
(migración 080), sobre la FK real de trazabilidad `retention_applied.tax_rule_id` (D-017) — no es una
aproximación de aplicación.

**4. Auditoría con la norma de respaldo.** "Conducta 4": tras editar, `audit_log` tiene una fila
`INSERT` para la regla nueva con `norma_respaldo` **exactamente** el texto que escribió el contador, y
una fila `UPDATE` para el cierre de la anterior (`valor_anterior.vigente_hasta = null`,
`valor_nuevo.vigente_hasta` = el día de cierre). Esto lo escribe **solo** `app.trg_audit`
(migración 009, ya instalado sobre las siete tablas paramétricas desde la Ola 0): mi servicio no
inserta nada en `audit_log`.

**5. Permiso restringido.** "Conducta 5": un `auxiliar_causacion` y un `solo_lectura` reciben `SE002`
(`PERMISO_INSUFICIENTE`) al intentar editar o incluso al llamar al simulador; `admin_tributario` y
`admin_firma` sí pueden. Lo impone `app.trg_exigir_permiso` (migración 016, `parametro.editar`), ya
instalado sobre `tax_rule`/`uvt_value`/`smmlv_value`/`rounding_rule`/`municipality_ica_rule` desde la
Ola 0 — mi servicio no reimplementa el chequeo, solo deja subir el error de Postgres.

**6. Simulador previo.** "Conducta 6": creo dos `concepto_causacion` que apuntan al mismo `tax_concept`
y dos `retention_applied` (mismo tercero) contra ellos; `simularImpactoTarifa` devuelve
`{conceptosAfectados: 2, proveedoresAfectados: 1}`. Una prueba adicional confirma que el simulador
también exige `parametro.editar` (no es una consulta pública).

---

## 3. Cómo se ve el simulador de impacto

**Editor de tarifas (`/parametros/tarifas/[tipo]`) — flujo en dos pasos**, tal como pide la sección
6.2.6 ("antes de guardar"):

1. El contador llena tarifa, base mínima, cuenta, vigencia y norma, y pulsa **"Simular impacto"**. La
   acción de servidor (`simularAction`) calcula `simularImpactoTarifa` + `fechaMinimaVigenciaTaxRule`
   y **no escribe nada**; redirige a la misma página con los resultados en la URL.
2. La página muestra: **"Esta tarifa afecta N concepto(s) de causación y M proveedor(es) con
   historial"**, más la fecha mínima de vigencia si ya hay algo publicado, más un resumen de los
   valores que se van a guardar. Solo ahí aparece el botón **"Guardar vigencia nueva"**
   (`confirmarAction`), que es la única acción que llama a `editarTarifaTaxRule`.

**Valores base (`/parametros/valores-base`)** — UVT, SMMLV y redondeo general: a diferencia de una
tarifa, su impacto no depende de qué se edite (siempre es "todos los conceptos y proveedores de la
firma"), así que el número se calcula y se muestra en la MISMA página, antes de que exista el
formulario de guardado, y el formulario exige una casilla "He revisado el impacto indicado arriba"
antes de habilitar el envío. Documenté esta simplificación explícitamente en el código: el simulador
sigue corriendo antes de guardar, solo que no necesita un segundo viaje al servidor porque el número no
cambia con la entrada del usuario.

**ReteICA por municipio (`/parametros/reteica-municipios`)** usa el mismo flujo en dos pasos que el
editor de tarifas, con `simularImpactoMunicipioIca` (conceptos y proveedores con historial de ReteICA
en ese municipio específico).

Estos números **no son cálculo tributario** (Regla de Oro 4): son conteos de filas que ya existen
(`concepto_causacion`, `retention_applied`), agregados a nivel de firma completa mediante las funciones
`SECURITY DEFINER` de la migración 080 — ver la sección de RLS más abajo sobre por qué hace falta ese
alcance.

---

## 4. Cómo se muestran las alertas de dato faltante (advertencia 17.5)

`detectarAlertasParametrizacion` recorre los catálogos globales (visibles a cualquier sesión por la RLS
híbrida, sin necesidad de bypass) buscando **exactamente** los huecos que A1 documentó al cerrar la Ola
1, y los devuelve como una lista de `{categoria, severidad, mensaje}`:

- Tabla progresiva de retención por salarios vacía (0 filas `tax_rule` tipo `retefuente_salarios`).
- SMMLV/auxilio de transporte sin ningún año cargado.
- Calendario tributario vacío.
- **Cada municipio sin regla de ReteICA** (hoy: Bucaramanga y Cartagena) — con nombre y departamento en
  el mensaje, no un conteo genérico.
- **Cada municipio que resuelve ICA por actividad económica pero no tiene ninguna tarifa por actividad
  cargada** (hoy: Bogotá y Cali).
- Cualquier fila marcada `requiere_verificacion_humana = true` en `tax_rule`, `municipality_ica_rule`,
  `smmlv_value` o `uvt_value` (hoy: las 4 filas de autorretención por CIIU, y las reglas de Bogotá/
  Medellín/Cali/Barranquilla por la periodicidad no confirmada).

En la interfaz aparecen en dos sitios:

- **`/parametros`** (página de entrada): un banner ámbar con todas las alertas, antes de cualquier
  tabla — es lo primero que ve el contador al entrar.
- **`/parametros/reteica-municipios`**: cada municipio SIN regla aparece **en la tabla misma**, con la
  fila resaltada y el texto "Sin regla de ReteICA cargada. No hay valor que copiar: pendiente de
  verificación normativa humana" en vez de un cero o una fila vacía — es la forma concreta en que esta
  advertencia exige que "el faltante se vea".
- **`/parametros/tarifas/[tipo]`**: los conceptos de ese tipo sin ninguna tarifa vigente hoy
  (`listarConceptosSinTarifaVigente`) aparecen en un bloque separado antes de la tabla.

Probado en `tests/services/parametrizacion.test.ts`, describe "alertas de dato pendiente de
verificación humana" (5 pruebas, contra los seeds reales de A1, no datos sintéticos).

---

## 5. Verificación con A2: RLS híbrida y administrador de firma

Verifiqué —leyendo el diseño de A2 (`db/migrations/012_rls.sql`, `016_permisos_y_auditoria_sensible.sql`)
y probándolo explícitamente— que la política RLS **no bloquea** a un administrador de firma editando un
parámetro compartido entre las empresas de su firma. No hizo falta ningún cambio de A2: el mecanismo ya
estaba diseñado para esto, solo que nadie lo había ejercitado todavía porque no existía ningún camino de
escritura desde la aplicación.

Dos piezas ya construidas por A2/A12 hacen que esto funcione:

1. **RLS híbrida en escritura** (`instalar_rls_hibrida`, D-015): `WITH CHECK (tenant_id =
   current_tenant_id() AND (company_id IS NULL OR company_id = current_company_id()))`. Una fila nueva
   con `company_id = NULL` (compartida entre las empresas de la firma) pasa el `WITH CHECK`
   **sin importar qué empresa tenga seleccionada la sesión** — incluso si no tiene ninguna.
2. **`app.tiene_permiso` sin empresa en contexto** (migración 016): "si hay una empresa en contexto,
   solo cuentan los roles otorgados sobre ESA empresa; si no la hay (edición de un parámetro de la
   firma, sin empresa), cuenta cualquier acceso vigente del usuario en el tenant." Ese comentario ya
   describía exactamente el caso de uso de mi módulo antes de que yo escribiera una línea.

Lo que mi servicio hace con esto (documentado en la cabecera de `parametrizacion.ts`): "editar" una
tarifa **nacional** (global, `tenant_id NULL`) nunca hace `UPDATE` de esa fila — la RLS ni lo permitiría
(`WITH CHECK` exige `tenant_id = current_tenant_id()`, y una fila global tiene `tenant_id NULL`). En su
lugar, crea la **primera fila propia de la firma** con `company_id NULL` (compartida) o con el
`company_id` de una empresa concreta, según el radio que el contador elija en el formulario
("Compartida entre todas las empresas de la firma" / "Solo la empresa en sesión").

Probado explícitamente en `tests/services/parametrizacion.test.ts`, describe "alcance firma vs. empresa
(verificación de la RLS híbrida de A2)", contra datos **reales** de A1 (`servicios_generales`, 4%
declarante):

- Un `admin_tributario` **sin ninguna empresa seleccionada** (`db.asTenant(tenantId, null, ...)`) crea
  un override compartido sobre la tarifa nacional; la fila global queda **exactamente igual**
  (`vigente_hasta: null, tarifa: '0.040000'`).
- Una **segunda empresa de la misma firma** (nunca tocada por la edición) ve el override como tarifa
  **efectiva** desde la fecha de vigencia, y sigue viendo la tarifa nacional en fechas anteriores.
- El simulador de impacto (llamado desde la empresa A) cuenta un `concepto_causacion` creado en la
  empresa B — algo que la RLS normal por-empresa nunca dejaría ver a una sesión de la empresa A; es
  exactamente el agregado de firma completa que documenté en la sección 3.
- Una empresa de **otra firma** nunca ve el override (aislamiento entre tenants intacto: sigue viendo
  la tarifa nacional).

No hubo necesidad de pedirle nada a A2: la única pieza que faltaba —el agregado de impacto y de fecha
mínima **a través de las empresas de una misma firma**— la construí yo en la migración 080,
siguiendo el patrón `SECURITY DEFINER + row_security = off + filtro explícito por tenant` que A2/A4 ya
habían establecido (`app.resolver_empresa_por_buzon`, `app.trg_fk_alcance`), no uno nuevo.

---

## 6. Decisión que requirió tocar una prueba de A14

`tests/adversarial/valores-tributarios.test.ts` tenía una regla (`insert_normativo`) que marcaba como
violación de la Regla de Oro 2 **cualquier** `INSERT INTO tax_rule/uvt_value/...` fuera de
`db/seeds/` — razonable mientras nada fuera de los seeds escribía ahí. Mi servicio hace exactamente
eso, a propósito: es la interfaz por la que un contador crea una vigencia nueva (sección 6.1), siempre
con parámetros ligados (`$1, $2...`), nunca con un valor tributario suelto en el código — y si alguna
vez lo tuviera, las otras cinco reglas del mismo detector lo cazarían igual (operan sobre `src/` línea
por línea, no distinguen si la línea está dentro de un `INSERT`).

Acoté la regla a `db/migrations/` (que es donde de verdad no debería vivir un `INSERT` de datos: las
migraciones son esquema, no dato) y dejé la justificación completa en el propio archivo de prueba, con
la firma de la decisión (A8, Ola 2) para que A14 la revise. No debilité ninguna de las otras cinco
reglas ni el canario que las verifica (`REGLAS`/`VENENO` en el mismo archivo) — corridas después del
cambio, siguen cazando las 17 muestras envenenadas.

También actualicé el inventario cerrado de funciones `SECURITY DEFINER` en `compuerta-ola1.test.ts` y
`evasion.test.ts` (ambos archivos lo declaran como tripwire deliberado: "si un agente amplía la lista,
aquí falla"), con la justificación de cada una de mis 6 funciones nuevas.

---

## 7. Limitaciones que quedan explícitas para quien retome esto

- **No existe login real todavía.** `app/lib/sesion.ts` lee una cookie `session_token` /
  `company_id` con el nombre que ya documentaba `src/auth/autenticacion.ts`
  ("cookie HttpOnly; Secure; SameSite=Lax") y arma el `SessionContext` que `withSessionContext` exige.
  Es una traducción, no una autenticación: la garantía sigue siendo de la base
  (`SesionInvalidaError` si el token no resuelve). Cuando A12/A7 entreguen el login, solo hace falta
  que escriban esa misma cookie.
- **Sin estilos ni navegación global** — es HTML semántico con `style` inline mínimo; A5/A7 lo visten.
- **`app/layout.tsx` es el primer layout raíz del repositorio.** Si otro agente trae el suyo en
  paralelo, se fusionan sin que `app/parametros/**` tenga que cambiar.
- Las consultas de LECTURA de `/parametros/valores-base` son SQL directo dentro de la página (no una
  función del servicio), documentado en el propio archivo: la escritura sí pasa siempre por el
  servicio, que es donde viven las seis conductas y donde A14 las puede verificar con pruebas.
- `base_minima_valor` (base mínima en pesos, en vez de UVT) no tiene campo en el formulario de tarifas;
  el servicio lo soporta si hace falta.
- Encontré (no toqué) trabajo concurrente de otro agente en `src/ai/`, `src/services/causacion.ts` y
  `tests/adversarial/casos-dorados.test.ts` mientras corría la suite completa — dos corridas
  intermedias del `npm test` mostraron fallos ahí que desaparecieron solos cuando ese agente terminó su
  módulo; no tienen relación con `src/services/parametrizacion.ts` ni con la migración 080 (verificado
  con `git diff --stat`: nunca toqué esos archivos). La corrida final, con ambos módulos ya estables,
  cierra en 517/517.

## Rutas relevantes

- `C:\Users\silva\Desktop\kimi\db\migrations\080_a8_parametrizacion_simulador.sql`
- `C:\Users\silva\Desktop\kimi\src\services\parametrizacion.ts`
- `C:\Users\silva\Desktop\kimi\src\services\index.ts`
- `C:\Users\silva\Desktop\kimi\tests\services\parametrizacion.test.ts`
- `C:\Users\silva\Desktop\kimi\app\layout.tsx`
- `C:\Users\silva\Desktop\kimi\app\lib\db.ts`
- `C:\Users\silva\Desktop\kimi\app\lib\sesion.ts`
- `C:\Users\silva\Desktop\kimi\app\parametros\page.tsx`
- `C:\Users\silva\Desktop\kimi\app\parametros\_componentes.tsx`
- `C:\Users\silva\Desktop\kimi\app\parametros\tarifas\[tipo]\page.tsx`
- `C:\Users\silva\Desktop\kimi\app\parametros\tarifas\[tipo]\acciones.ts`
- `C:\Users\silva\Desktop\kimi\app\parametros\valores-base\page.tsx`
- `C:\Users\silva\Desktop\kimi\app\parametros\valores-base\acciones.ts`
- `C:\Users\silva\Desktop\kimi\app\parametros\reteica-municipios\page.tsx`
- `C:\Users\silva\Desktop\kimi\app\parametros\reteica-municipios\acciones.ts`
- `C:\Users\silva\Desktop\kimi\tests\adversarial\compuerta-ola1.test.ts` (inventario SECURITY DEFINER)
- `C:\Users\silva\Desktop\kimi\tests\adversarial\evasion.test.ts` (inventario SECURITY DEFINER)
- `C:\Users\silva\Desktop\kimi\tests\adversarial\valores-tributarios.test.ts` (regla `insert_normativo`)
- `C:\Users\silva\Desktop\kimi\tsconfig.json`

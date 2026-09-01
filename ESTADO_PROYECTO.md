# ESTADO_PROYECTO.md

> Memoria única entre sesiones. Todo agente lo lee al empezar y lo actualiza al terminar.
> Última actualización: 2026-09-01 — **A16 entrega la OLA 4, «Operación real»: navegación compartida,
> carga masiva de quince catálogos con plantillas de Excel, PUC genérico + PUC propio por empresa,
> ReteICA en cascada por municipio, los tres motivos separados por los que un reporte no sale, y el
> módulo de administración de usuarios, roles y permisos con el rol todopoderoso blindado en el motor.
> Once decisiones nuevas (D-063 … D-073) y la migración `170_a16_ola4_operacion_real.sql`. Suite:
> **993 en verde** (48 archivos), typecheck limpio, `next build` exit 0 con 28 rutas.
> **PENDIENTE: la compuerta de A14.** Ver «Ola 4 — qué entregó A16».
>
> Registro histórico: 2026-08-31 — **A14, compuerta del LOTE POSTERIOR A LA OLA 3 (V-17/A8, V-18/A11,
> arranque y repaso 14.1/A12, datos de ejemplo/A1, entorno y despliegue/A15). Veredicto: LOTE APROBADO,
> con tres vulnerabilidades encontradas por A14 y CORREGIDAS por A14 en la misma pasada (V-20, V-21,
> V-22).** A14 no verificó por reporte: corrió la secuencia completa del README contra un PostgreSQL de
> verdad (`migrate` → `seed` → `arranque` → `datos-ejemplo` → `next dev`), inició sesión con la
> contraseña que imprimió el arranque y recorrió las cinco pantallas. Lo grave que encontró: la base de
> datos **inventaba ocho de las nueve banderas fiscales** de un tercero por `DEFAULT false` (V-20), justo
> lo que D-014 y la advertencia 17.5 prohíben; y su propio detector de la Regla de Oro 2 **no barría el
> código ejecutable de la raíz** del repositorio, donde A15 acaba de poner `instrumentation.ts` (V-21).
> Suite: **914 en verde** (45 archivos), typecheck limpio, `next build` exit 0. Ver «Compuerta del lote
> posterior a la Ola 3 — veredicto de A14».
>
> Registro histórico: 2026-08-31 — **A14, compuerta de la Ola 3 (A9, A10, A11), SEGUNDA PASADA.
> Veredicto: OLA 3 CERRADA. Con ella se cierra la última ola del proyecto.** En la primera pasada
> (2026-08-30) A14 bloqueó por V-16: los veinte libros existían y eran correctos, pero **no había por
> dónde descargarlos**. A9 entregó `GET /api/reportes/:libro` y la pantalla `/reportes`; A14 **no le creyó
> y lo atacó**: los veinte slugs devuelven un `.xlsx` real que se reabre con las cuatro hojas
> obligatorias, ningún generador quedó huérfano sin slug, y la ruta resiste cookie de empresa ajena,
> `companyId` en la query, sesión de otra firma, sesión cerrada, falta de permiso y recorrido de ruta. En
> el ataque apareció **V-19** (un slug igual a una clave del prototipo de `Object` devolvía 500 en vez de
> 404), **corregida por A14**. El criterio duro de la §12 —10.000 asientos aleatorios contra el ledger—
> ya había pasado al centavo. Suite: **849 en verde** (43 archivos), typecheck limpio, `next build` exit 0
> con `ƒ /api/reportes/[libro]` y `ƒ /reportes`.
>
> Registro histórico: 2026-08-27 — **A14, compuerta de la Ola 2 (A5, A7, A8, A13). Veredicto: OLA 2
> CERRADA.** Los tres criterios de salida de la sección 4 pasan, verificados **por la interfaz real** y
> con instrumentos propios de A14 (una mina en vez de un contador, un espía de `fetch`, 30 empresas de
> verdad y 50 aprobaciones de un golpe). En el camino A14 **refutó** el acotamiento que A8 le había
> hecho a su detector de la Regla de Oro 2 y lo restituyó (D-049), y **corrigió** un defecto real de la
> aprobación en lote que hacía que una sola fila mala se llevara por delante las otras 49 (D-050).
> Suite: **603 en verde** (32 archivos), cero `todo`, cero fallos, typecheck limpio.

## Olas cerradas

| Ola | Agentes | Compuerta | Commit de cierre | Fecha |
|---|---|---|---|---|
| **0 — Fundaciones** | A2, A12, A14 | **PASA las cuatro pruebas**, verificadas de forma independiente por A14 con pruebas propias (`tests/adversarial/`) | *pendiente — lo pone A0* | 2026-08-26 |
| **1 — Núcleo del dominio** | A1, A3, A4, A6, A14 | **PASA los cuatro criterios**, verificados de forma independiente por A14 con pruebas propias. Bloqueada primero por V-4 y V-6, cerrados por A1 en `ffaf3db` y **reverificados** por A14 sin creerle al reporte. Ver «Compuerta de la Ola 1 — veredicto de A14» | *pendiente — lo pone A0* | 2026-08-27 |
| **2 — Inteligencia, parametrización e interfaz** | A5, A7, A8, A13, A14 | **PASA los tres criterios**, verificados por A14 **por la interfaz real** (`tests/adversarial/compuerta-ola2-interfaz.test.ts`) y con instrumentos propios (`tests/adversarial/compuerta-ola2.test.ts`). Dos defectos reales encontrados y **corregidos por A14** (D-049, D-050); uno declarado y asignado (V-11). Ver «Compuerta de la Ola 2 — veredicto de A14» | *pendiente — lo pone A0* | 2026-08-27 |
| **3 — Salidas contables y fiscales** | A9, A10, A11, A14 | **PASA los dos criterios**, en la segunda pasada. Bloqueada primero por V-16 (no existía forma de descargar ningún reporte), cerrada por A9 con `GET /api/reportes/:libro` + `/reportes` y **reverificada por A14 atacando la ruta**, no leyendo el reporte. Un defecto nuevo encontrado y corregido por A14 en el ataque (V-19). Ver «Compuerta de la Ola 3 — veredicto de A14» | *pendiente — lo pone A0* | 2026-08-31 |
| **4 — Operación real** | A16 | *pendiente — la ejecuta A14* | *pendiente* | 2026-09-01 |

**Ola 4: ENTREGADA por A16, SIN COMPUERTA TODAVÍA.** No está cerrada: falta que A14 la verifique él
mismo, como todas las demás. Lo que entregó, tarea por tarea, está en «Ola 4 — qué entregó A16».
Resumen: el producto pasó de «se puede demostrar» a «una firma lo puede operar» — hay por dónde volver
del sitio donde uno esté, hay cómo cargar de golpe los catálogos que antes solo se poblaban con SQL, el
plan de cuentas se puede hacer propio de cada empresa, el selector de ReteICA dejó de mentir, un reporte
que no sale dice cuál de las tres cosas pasó, y la firma puede crearse sus propios roles sin tocar código.

**Ola 3: CERRADA por A14, en la segunda pasada. Con ella termina la construcción del proyecto.** En la
primera pasada (2026-08-30) el criterio duro —el balance de prueba contra el ledger con 10.000 asientos
aleatorios— ya pasaba al centavo, pero A14 bloqueó por **V-16**: los veinte libros existían, eran
correctos y serializaban a `.xlsx` válido, y **ningún importador fuera de las pruebas los invocaba**. No
había descarga, y el criterio dice literalmente «todo reporte **se descarga** en Excel». A9 cerró V-16 con
`GET /api/reportes/:libro` y la pantalla `/reportes`. A14 **no lo dio por bueno por escrito**: atacó la
ruta con sesión de otra firma, cookie de empresa ajena, `companyId` inyectado en la query, sesión cerrada,
token inventado, rol sin permiso y recorrido de ruta — todos rechazados, y ni una celda de otra firma en
ningún libro. En ese ataque salió **V-19** (un slug igual a una clave del prototipo de `Object` devolvía
500 en vez de 404), **corregida por A14**. Quedan abiertas y declaradas V-17 y V-18; ninguna derrota un
criterio de salida.

**Ola 1: CERRADA por A14, en la segunda pasada.** En la primera, la compuerta quedó **bloqueada**: con el
repositorio tal como se entregaba, `rounding_rule` estaba vacía y no había ni una regla de ReteICA, de
modo que el motor —correctamente— no calculaba **ninguna** retención y tres casos dorados solo pasaban
sobre andamiaje de la suite. A1 cerró los dos huecos en `ffaf3db` sin escribir un solo valor a mano
(copiando la tarifa de Medellín de la fila que él mismo había verificado, y declarando el redondeo como
parámetro operativo). A14 **volvió a correr la compuerta entera** y verificó lo que decidía el cierre:
los casos 1 y 8 se causan, cuadran y se publican **sin que ninguna prueba inserte un parámetro**. Quedan
abiertas y declaradas V-1, V-5, V-7, V-8 y V-9; ninguna derrota ninguno de los cuatro criterios.

**Ola 2: CERRADA por A14.** Los tres criterios de la sección 4 pasan, y pasan **por donde los va a usar
un contador**, no solo por la capa de servicios: la UVT se cambia enviando el `FormData` de la acción de
servidor de A8, y las 50 aprobaciones se hacen enviando el `FormData` de la bandeja de A7 con 30 empresas
reales montadas. De lo simulado, solo el transporte de Next (`next/headers`, `next/navigation`) y la
conexión; la sesión, el rol, la RLS, los triggers y el ledger son los de producción.

Durante la verificación A14 encontró **cuatro cosas que nadie había reportado**: que el acotamiento de A8
al detector de la Regla 2 **sí perdía cobertura real** (V-13, refutado con canario envenenado y
restituido, D-049); que el canario había dejado de ejercitar la regla acotada (V-14, corregido); que
`aprobarAsientosEnLote` **no tenía SAVEPOINT** y su `catch` por ítem era decorativo (V-12, corregido por
A14, D-050); y que la aprobación desde la bandeja **revienta con un error crudo de PostgreSQL** si el
despliegue no reenvía la IP del cliente (V-11, abierta, asignada). Ninguna de las cuatro derrota un
criterio de salida una vez corregidas las tres primeras.

**Ola 0: CERRADA por A14.** Las cuatro pruebas de la compuerta de la sección 4 pasan, y pasan contra el
motor de PostgreSQL (SQLSTATE), no contra un `throw` de TypeScript. Ninguna vulnerabilidad abierta
derrota ninguno de los cuatro criterios. El detalle, prueba por prueba, está en
«Compuerta de la Ola 0 — veredicto de A14».

Durante la verificación se encontraron **dos vulnerabilidades reales** que ni A2 ni A12 habían
considerado, ambas **corregidas** por A14 en `db/migrations/017_a14_cierre_vulnerabilidades.sql`
(D-030 y D-031), más un defecto del banco de pruebas (D-034, corregido). Quedan **dos hallazgos
abiertos asignados a A2** (D-032 y D-033) que **no bloquean la Ola 0** y sí son **precondición de
cierre de la Ola 1**. Ver «Vulnerabilidades — registro de A14».

**A2 entregó** esquema, ledger, RLS, vigencias, auditoría y roles.
**A12 entregó** autenticación, sesiones, MFA, permisos por rol, audit_log, cifrado y habeas data.
**D-020 cerrado** (ver D-021), verificado por A14 contra el motor.

**Siguiente:** A0 hace el commit de cierre y despacha la Ola 1 (A1, A3, A4, A6). A14 no hace commits.

---

## Decisiones arquitectónicas no obvias

### D-001 — Lenguaje y framework único: TypeScript + Next.js 15 (App Router)
**Decidido:** todo el producto (backend de dominio, API y frontend SSR) en TypeScript sobre Next.js 15 App Router, Node 24.
**Alternativas descartadas:** (a) Python/FastAPI + frontend separado — obliga a un desarrollador solo a mantener dos ecosistemas y dos pipelines de despliegue; (b) backend Node separado del frontend — duplica despliegue y rompe la restricción de USD 20/mes.
**Por qué:** sección 5 exige framework único y mismo lenguaje en front y back para evitar cambio de contexto con 1 desarrollador.

### D-002 — Migraciones en SQL plano, no ORM
**Decidido:** el esquema vive en archivos `db/migrations/NNN_nombre.sql` numerados, aplicados en orden por un runner propio. No hay ORM que genere DDL.
**Alternativas descartadas:** Prisma (no modela RLS, políticas ni triggers de constraint; su `migrate` pelea con DDL manual), Drizzle (mejor, pero igual requiere SQL crudo para RLS y triggers, añadiendo una capa sin ganancia).
**Por qué:** las Reglas de Oro 1 y 7 se imponen con `POLICY`, `FORCE ROW LEVEL SECURITY`, triggers y constraint triggers deferidos. Todo eso es SQL que ningún ORM expresa bien. El acceso a datos en runtime sí usa un driver tipado (`postgres.js`), pero el DDL es SQL explícito y revisable.

### D-003 — Postgres real y offline para pruebas: PGlite
**Decidido:** la suite de pruebas corre contra **PGlite** (`@electric-sql/pglite`), que es PostgreSQL 18.3 compilado a WASM, en proceso, sin servidor. Las mismas migraciones `.sql` se aplican a PGlite (test) y a Postgres gestionado (producción: Supabase/Neon).

**Verificado empíricamente antes de decidir** (spike de A0, 2026-08-26) — sobre PGlite 0.5.7 / PostgreSQL 18.3:
- RLS se **aplica de verdad** si la sesión hace `SET ROLE app_user` (rol no superusuario) y la tabla tiene `FORCE ROW LEVEL SECURITY`. Confirmado: 2 filas de 2 tenants distintos → 1 visible.
- Trigger `BEFORE UPDATE OR DELETE` que lanza excepción sobre asiento `posted` → bloquea la mutación. Confirmado.
- `CREATE CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED` → rechaza asiento desbalanceado **en el COMMIT**, a nivel de BD. Confirmado.

**Alternativas descartadas:** Docker + Postgres (el demonio de Docker Desktop no está corriendo en esta máquina y no hay `psql` local — dependería de intervención manual en cada sesión); SQLite (no tiene RLS: haría imposible probar la Regla de Oro 7); mockear la BD (probaría el mock, no la garantía real).

**Consecuencia obligatoria para todos los agentes:** ninguna prueba de integridad puede depender de lógica de aplicación. Si la garantía no la impone la BD, no cuenta como pasada.

**Escotilla:** si `DATABASE_URL` está definida, el harness de pruebas usa ese Postgres real en vez de PGlite, sin cambiar una línea de las pruebas.

### D-004 — El aislamiento se prueba como usuario sin privilegios
**Decidido:** la aplicación **nunca** se conecta como superusuario ni como dueño de las tablas. Se conecta con el rol `app_user`, y el contexto va por `set_config('app.tenant_id', ...)` / `set_config('app.company_id', ...)` dentro de la transacción.
**Por qué:** un superusuario ignora RLS silenciosamente. Probar RLS desde una sesión superusuario da un falso PASS, que es el peor resultado posible para la Regla de Oro 7.

### D-005 — El dinero es BIGINT en centavos
**Decidido:** todo monto es `BIGINT` en centavos de COP. Las tarifas son `NUMERIC(9,6)` como fracción, no porcentaje (2,5% = 0.025000). Prohibido `float`, `double`, `real` y `money`.
**Por qué:** Regla de Oro 5. `NUMERIC` para tarifas porque una tarifa por mil (‰) de ICA necesita precisión decimal exacta; `BIGINT` para importes porque el redondeo debe ser explícito y parametrizado, nunca un artefacto del tipo de dato.

### D-006 — Nombres de tablas: los de la sección 15, literales
**Decidido:** se usan exactamente los nombres de la sección 15 del mega-prompt, con su mezcla de inglés y español (`journal_entry`, `third_party`, `tax_rule`, `concepto_causacion`, `memoria_clasificacion`).
**Por qué:** evita que 15 agentes traduzcan cada uno a su gusto. La sección 15 es el contrato; no se "mejora".

---

## Decisiones de modelado de A2 (Ola 0)

### D-007 — La tabla de usuarios es `"user"`, siempre entrecomillada
**Decidido:** se respeta D-006 al pie de la letra aunque `user` sea palabra reservada en PostgreSQL. La tabla es `"user"` y toda consulta debe entrecomillarla.
**Por qué:** verificado que `SELECT ... FROM user` sin comillas falla de inmediato con `42703`, nunca en silencio. El costo es acordarse de las comillas; el beneficio es no abrir la puerta a que cada agente renombre.

### D-008 — `reversed_by` es derivado, no columna física
**Decidido:** `journal_entry` guarda `reverses_entry_id` (del asiento de reversa hacia el original). `reversed_by` se expone en la vista `v_journal_entry`.
**Alternativa descartada:** columna `reversed_by` en el asiento original, que exigiría un `UPDATE` sobre un asiento ya publicado — exactamente lo que prohíbe la Regla de Oro 1. Cualquier excepción "solo para marcar la reversa" habría abierto un boquete en la compuerta.
**Consecuencia:** para consultar asientos use `v_journal_entry`, no la tabla.

### D-009 — Un asiento nace borrador; publicar es una transición, no un INSERT
**Decidido:** `INSERT` de `journal_entry` en estado `posted` se rechaza (`LG007`). El flujo es: insertar `draft` → insertar `journal_line` → `SELECT app.publicar_asiento(id, user_id)`.
**Por qué:** un asiento insertado ya publicado no tendría partidas todavía y sería imposible validarlo; y si se permitiera agregarle partidas después, el ledger publicado dejaría de ser inmutable. Con este ciclo, `journal_line` bloquea cualquier `INSERT/UPDATE/DELETE` en cuanto el padre está publicado.

### D-010 — El balance se impone con CONSTRAINT TRIGGER DEFERRABLE, no con CHECK
**Decidido:** el cuadre a cero se verifica en el `COMMIT` mediante `CREATE CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED`.
**Por qué:** un `CHECK` no puede mirar otras filas, y validar en cada `INSERT` haría imposible construir el asiento (después de la primera partida siempre está descuadrado). Rechazar en el `COMMIT` sigue siendo rechazo del motor.
**Detalle:** con menos de dos partidas el trigger de partidas se calla para que el diagnóstico correcto (`LG003`, asiento sin partidas) no quede tapado por `LG002`.

### D-011 — El no-solape de vigencias se impone con trigger, no con EXCLUDE
**Decidido:** cada tabla paramétrica lleva una columna generada `clave_vigencia` y dos triggers genéricos instalados por `app.instalar_triggers_vigencia('tabla')`.
**Por qué:** `EXCLUDE USING gist (clave WITH =, daterange WITH &&)` sería lo idiomático, pero requiere `btree_gist`, y **PGlite no lo trae** (verificado: `extension "btree_gist" is not available`). Una restricción que solo existiera en producción no se puede probar, y una garantía no probada no cuenta.
**Detalle:** el trigger de solape es `AFTER`, no `BEFORE`, porque PostgreSQL calcula las columnas `GENERATED` después de los triggers `BEFORE`.

### D-012 — Las vigencias son append-only: el único UPDATE permitido es cerrar `vigente_hasta`
**Decidido:** un trigger genérico compara `to_jsonb(OLD)` contra `to_jsonb(NEW)` y rechaza (`PR001`) cualquier cambio que no sea pasar `vigente_hasta` de `NULL` a una fecha válida. Reabrir o mover una vigencia cerrada también se rechaza. Borrar una vigencia que ya surtió efecto se rechaza (`PR003`); una vigencia estrictamente futura sí se puede borrar, para cancelar un cambio programado.
**Consecuencia:** las tablas paramétricas **no llevan `updated_at` ni `activo`**: cualquier `UPDATE` de esas columnas sería rechazado. Para desactivar un parámetro se cierra su vigencia.

### D-013 — Identidad y valores viven en tablas distintas
**Decidido:** se separa lo que no cambia de lo que cambia por norma:
- `tax_concept` (identidad del concepto tributario, estable) ↔ `tax_rule` (tarifa, base y cuenta, por vigencia)
- `municipality` (código DANE, estable) ↔ `municipality_ica_rule` (bases mínimas, periodicidad, por vigencia)
- `ciiu_activity` (catálogo, estable); las tarifas de autorretención por CIIU son filas de `tax_rule`

**Por qué:** es lo que exige la corrección crítica de la sección 8.2. Si `concepto_causacion` apuntara a una fila de `tax_rule`, apuntaría a **una vigencia concreta**, y el decreto del año siguiente dejaría a todos los conceptos calculando con la tarifa vieja. Apuntando a `tax_concept`, la tarifa se resuelve por fecha del hecho y cambiarla en un lugar actualiza a todos. Lo mismo con los municipios: si `municipality` tuviera vigencia, cada tercero apuntaría a una versión del municipio y un acuerdo municipal rompería los terceros.

### D-014 — Los atributos fiscales del tercero están versionados, no son columnas de `third_party`
**Decidido:** `third_party` guarda identidad, dirección y municipio. Declarante, autorretenedor, gran contribuyente, régimen SIMPLE, responsable de IVA y agente de retención viven en `third_party_fiscal_attribute` con vigencia. La vista `v_third_party_vigente` los presenta aplanados para la interfaz.
**Por qué:** la sección 9.2 exige determinar los atributos *a la fecha del hecho*. Un proveedor que hoy es declarante pudo no serlo en marzo: con columnas mutables, recalcular una factura de enero en julio daría otro resultado (4% en vez de 6%), rompiendo la Regla de Oro 3.
**Consecuencia para A3/A4:** si no hay vigencia que cubra la fecha del hecho, **no se inventa un valor por defecto**. Un tercero sin atributos a esa fecha va a revisión manual. Poner `es_declarante_renta = false` por defecto sería inventar un dato tributario con consecuencia real (advertencia 5 de la sección 17).

### D-015 — Catálogos híbridos: `tenant_id IS NULL` significa "global"
**Decidido:** `account`, `niif_mapping`, `municipality`, `municipality_ica_rule`, `ciiu_activity`, `uvt_value`, `smmlv_value`, `rounding_rule`, `tax_concept`, `tax_rule`, `tax_calendar`, `concepto_causacion` y `role` admiten `tenant_id`/`company_id` nulos. La política RLS **deja leer lo global y escribir solo lo propio**.
**Consecuencia operativa:** las migraciones y los seeds de A1 escriben filas globales, y ninguna política RLS permite eso. **Los seeds deben correr con un rol superusuario o `BYPASSRLS`**, nunca como `app_user`. En pruebas eso es `asAdmin()`.
**Detalle:** la unicidad usa `UNIQUE NULLS NOT DISTINCT`, verificado en PGlite.

### D-016 — La coherencia multi-tenant se amarra con FK compuestas, no solo con RLS
**Decidido:** las tablas hijas declaran `FOREIGN KEY (padre_id, tenant_id, company_id) REFERENCES padre (id, tenant_id, company_id)`, apoyadas en índices únicos `(id, tenant_id, company_id)`.
**Por qué:** las comprobaciones de clave foránea **no pasan por RLS**. Sin la FK compuesta, una partida podría apuntar a un asiento de otro tenant y solo la política impediría verlo. Con ella, la base de datos lo hace imposible aunque la RLS estuviera mal.

### D-017 — `retention_applied` amarra la regla Y su vigencia
**Decidido:** `tax_rule` tiene `UNIQUE (id, vigente_desde)` y `retention_applied` declara `FOREIGN KEY (tax_rule_id, regla_vigente_desde) REFERENCES tax_rule (id, vigente_desde)`, más un `CHECK` que verifica que la vigencia registrada cubre `fecha_hecho_economico`.
**Por qué:** la Regla de Oro 6 pide saber "qué regla se aplicó y con qué vigencia". Guardar la vigencia como texto suelto permitiría registrar una vigencia que esa regla nunca tuvo. Así, la traza no puede mentir.
**Además:** `retention_applied` también registra las retenciones que **no** aplicaron (`aplicada = false` con `motivo_no_aplica`), como exige la sección 9.3.

### D-018 — Errores de dominio con SQLSTATE propios
**Decidido:** el motor levanta códigos propios que las pruebas verifican: `LG001` ledger inmutable, `LG002` desbalanceado, `LG003` sin partidas, `LG004` cuenta no imputable, `LG005` período cerrado, `LG006` sin aprobación, `LG007` asiento que nace publicado, `LG008` reversa inválida, `PR001` vigencia inmutable, `PR002` vigencia solapada, `PR003` vigencia no borrable, `AU001` auditoría inmutable. Están en `src/db/types.ts` como `SQLSTATE`.
**Por qué:** verificado que PGlite y postgres.js propagan el código en `error.code`. Es lo que permite que una prueba demuestre que el rechazo vino del motor y no de un `if` en TypeScript.

### D-019 — Toda vista lleva `security_invoker = true`
**Decidido:** sin esa opción una vista corre con los privilegios de su dueño y **salta la RLS de las tablas base**. Sería una puerta trasera al aislamiento. Hay una prueba de esquema que lo verifica en todas las vistas.

### D-020 — Riesgo conocido que hereda A12: `app_user` puede fijar `app.tenant_id`
**Situación:** el contexto va por `set_config('app.tenant_id', ...)`, y un rol no privilegiado puede llamar a `set_config` sobre una GUC personalizada. Verificado.
**Por qué se acepta hoy:** es el mismo patrón que usa Supabase con los claims del JWT, y el contexto lo fija `withTenantContext` a partir de una sesión ya validada. El riesgo aparece solo si se ejecuta SQL arbitrario de un usuario final, cosa que no ocurre.
**Pendiente para A12:** derivar el contexto de un claim firmado y no de una entrada del cliente, y considerar `pg_catalog`-level hardening si en algún momento se expone SQL directo.
**ESTADO: CERRADO por A12 en la migración 015.** Ver D-021.

---

## Decisiones de seguridad de A12 (Ola 0)

### D-021 — El contexto de tenant se deriva de un token de sesión verificado, no de una GUC (cierre de D-020)
**Decidido:** `app.current_tenant_id()`, `app.current_company_id()` y `app.current_user_id()` se
redefinieron en `db/migrations/015_sesiones_contexto_verificado.sql`. Ya **no leen** `app.tenant_id`.
Ahora la sesión SQL presenta **un solo secreto**, `app.session_token`, y la base busca su `sha256`
en `app.session_context`; de esa fila salen el tenant y el usuario.

**Ninguna política RLS de `012_rls.sql` se tocó.** Las políticas siguen llamando a las mismas tres
funciones; lo que cambió es de dónde sale la respuesta. Por eso las 55 pruebas de A2 pasan sin
modificar una aserción: el cierre de D-020 es transparente para el resto del sistema.

**Por qué `app.session_context` vive en el esquema `app` y no en `public.user_session`:**
una función que resuelve el contexto no puede leer una tabla cuya política RLS llama a esa misma
función. En PGlite eso no revienta porque el dueño de las tablas es superusuario y se salta la RLS
(verificado: el spike de recursión NO falló), pero en un Postgres gestionado el dueño **no** es
superusuario y `FORCE ROW LEVEL SECURITY` sí lo alcanza. Una tabla del esquema `app`, sin RLS y sin
un solo GRANT para `app_user`, se comporta **idéntico en pruebas y en producción**: el aislamiento
ahí es por privilegio, no por política. Se rechazó la alternativa de una política `TO <dueño>` sobre
`user_session` precisamente porque en pruebas nunca se ejercitaría y quedaría sin verificar.

**Alternativas descartadas:** (a) HMAC del claim dentro de la base — **pgcrypto no está disponible
en PGlite** (verificado: `function hmac(...) does not exist`), así que habría que inventar una
construcción MAC propia, cosa prohibida; (b) firmar el claim en Node y verificarlo en SQL — mismo
problema, no hay HMAC en el motor de pruebas; (c) `GRANT SET ON PARAMETER` sobre `app.tenant_id` —
no aplica a GUCs personalizadas no reservadas. El token opaco con `sha256` (función del **núcleo**
de PostgreSQL desde la 11, verificada disponible) logra el mismo efecto sin criptografía inventada:
el rol de aplicación no puede invertir el hash ni leer la tabla, luego no puede fabricar contexto.

**Consecuencia para todos los agentes:** el contexto de una petición se abre **siempre** con
`withSessionContext(db, { sessionToken, companyId }, fn)`. No existe forma soportada de decirle a la
base "soy el tenant X". `withTenantContext` sobrevive como alias y exige token igual.

### D-022 — La empresa la pide el cliente; la autoriza la base
**Decidido:** `app.company_id` sigue siendo un parámetro que el cliente fija —un usuario con 30
empresas tiene que poder elegir—, pero `app.current_company_id()` solo lo devuelve si la sesión
tiene un acceso **vigente** sobre esa empresa. Sin acceso devuelve NULL y la RLS no deja ver nada.
**Por qué no bastaba con RLS:** antes, cualquier sesión del tenant podía fijar `app.company_id` a
cualquier empresa del tenant, aunque el usuario no tuviera acceso otorgado. Ahora no.
**Consecuencia:** el intento queda registrado como `ACCESO_DENEGADO` en `audit_log`, en **su propia
transacción**, para que el rastro sobreviva al rechazo. Es el cuarto punto de auditoría de la 14.1.

### D-023 — Dos roles de base de datos: `app_user` y `app_auth`
**Decidido:** el camino de autenticación corre con un rol distinto del de las peticiones.
`app_user` **no puede** ejecutar `app.abrir_sesion` ni leer credenciales. `app_auth` **no tiene un
solo GRANT** sobre tablas de negocio: solo `SELECT` sobre `"user"` —limitado por una política a la
fila del correo exacto que se está autenticando, y únicamente mientras no haya sesión— e `INSERT`
sobre `audit_log` para los intentos fallidos.
**Por qué:** emitir sesiones es, por definición, la operación que crea contexto. Si el mismo rol que
sirve las peticiones pudiera emitirlas, una inyección SQL en una petición autenticada podría
fabricarse una sesión de otro tenant y D-020 se reabriría por la puerta de al lado. Con dos roles,
un atacante necesita **dos credenciales distintas**.
**Riesgo residual, sin adornar:** quien posea las credenciales de `app_auth` puede emitir una sesión
para cualquier usuario **cuyo correo conozca**, porque la verificación de la contraseña ocurre en
Node (pgcrypto no está en PGlite). Cerrarlo del todo exigiría mover la derivación de clave al motor
o a un servicio de autenticación separado. Se documenta como abierto, no se disimula.

### D-024 — Límite conocido del harness: en PGlite el descenso a `app_user` es reversible
**Situación verificada:** en PGlite la conexión subyacente es superusuario y `SET LOCAL ROLE app_user`
es una degradación **reversible**: desde dentro de `asTenant` se puede hacer `RESET ROLE` y volver a
`postgres`, o `SET ROLE` a otro rol.
**Qué significa exactamente:** las pruebas demuestran que **las políticas funcionan**; no demuestran
que la aplicación no pueda saltárselas, porque en el entorno de pruebas sí podría.
**Qué lo cierra, y es configuración, no código:** en producción la aplicación debe **conectarse** con
un rol de login que ES `app_user`, sin `SUPERUSER`, sin `BYPASSRLS` y **sin ser dueño de las tablas**.
Con esa conexión, `RESET ROLE` no lleva a ninguna parte. La lista de verificación está en
`docs/cifrado-y-proteccion-de-datos.md`, numeral 4.1, y **A15 debe ejecutarla al desplegar**.
**Por qué se deja escrito y no se "arregla":** no tiene arreglo en código. Es una propiedad de cómo
se conecta el proceso, y A14 tiene que poder verificarla como tal.

### D-025 — La autorización por rol la impone un trigger, no la aplicación
**Decidido:** `016_permisos_y_auditoria_sensible.sql` instala un trigger `BEFORE INSERT/UPDATE/DELETE`
en cada tabla de escritura que exige el permiso correspondiente y rechaza con `SE002`.
**Por qué no en la capa de servicio:** el mismo criterio de D-003. Si la garantía la da un `if` en
TypeScript, un endpoint nuevo que olvide llamarlo la pierde en silencio. Con el trigger, un auxiliar
de causación no edita un parámetro tributario **aunque la interfaz tuviera el botón**.
**Escape deliberado:** cuando **no hay sesión** (`app.session_id() IS NULL`) el trigger se aparta.
Ese es el camino administrativo —migraciones, seeds de A1, plataforma— que corre con rol privilegiado,
donde la garantía la da el privilegio. Un `app_user` sin sesión tampoco escribe: lo detiene antes la
RLS, porque sin sesión no hay tenant y ninguna fila satisface la política.
**Dos excepciones con trigger propio:** `journal_entry` (el permiso depende de la transición: crear,
editar borrador, publicar o reversar) y `"user"` (la contabilidad del propio inicio de sesión y el
cambio de la contraseña propia no son "administrar usuarios").
**Consecuencia para A1:** los seeds paramétricos deben correr con `asAdmin` / rol privilegiado, igual
que ya exigía D-015. Si se intentan como `app_user` con sesión, hará falta `parametro.editar`.

### D-026 — Espejos de seguridad en el esquema `app`, mantenidos por trigger
**Decidido:** `app.usuario` (id, tenant, estado) y `app.acceso_usuario_empresa` (accesos vigentes)
son proyecciones mínimas de `"user"` y `user_company_access`, mantenidas por triggers `SECURITY
DEFINER`, sin RLS y sin GRANTs.
**Por qué:** el resolutor de contexto no puede leer tablas cuya política depende de él mismo (D-021).
Además, `app.abrir_sesion` valida el usuario contra `app.usuario` en vez de confiar en un `tenant_id`
que le pase el llamador — si confiara, D-020 se reabriría.
**Costo aceptado:** dos tablas duplicadas de tres y cinco columnas. **No son fuente de verdad del
negocio; son fuente de verdad de la seguridad.** Si alguna vez divergen, el efecto es denegar acceso,
no concederlo de más.

### D-027 — scrypt de `node:crypto` y TOTP propio: cero dependencias nuevas
**Decidido:** contraseñas con **scrypt** (RFC 7914) de `node:crypto`, N=2^14/r=8/p=1, sal de 16 bytes,
comparación en tiempo constante y parámetros dentro del registro almacenado. TOTP (RFC 6238) y HOTP
(RFC 4226) implementados sobre el HMAC del runtime, ~120 líneas.
**Alternativas descartadas:** `bcrypt` y `argon2` son módulos nativos que hay que compilar por
plataforma —fricción de despliegue real con 1 desarrollador y USD 20/mes— sin ganancia de seguridad
relevante a estos parámetros; `otplib`/`speakeasy` son superficie de suministro adicional para
implementar una especificación pública corta.
**Cómo se justifica no ser "criptografía inventada":** las primitivas son del runtime; lo propio es
el envoltorio que describen los RFC, y está **verificado contra los vectores de prueba de los propios
RFC** en `tests/gates/autenticacion.test.ts` (los diez de RFC 4226 y los seis SHA-1 de RFC 6238).
**Costo de presupuesto: USD 0.** No se instaló ninguna dependencia.

### D-028 — El secreto de MFA lleva un sobre de cifrado de aplicación
**Decidido:** `mfa_secret_cifrado` se guarda envuelto en AES-256-GCM con `APP_ENCRYPTION_KEY`, que
vive en el entorno del despliegue, **no en la base de datos**.
**Por qué:** el cifrado en reposo del proveedor protege el disco, no la fila. Un `pg_dump` legítimo,
un respaldo restaurado o un acceso de soporte del proveedor entregan los datos ya descifrados. Con el
sobre, un volcado de la base **por sí solo** no permite clonar el segundo factor de nadie.
**Pendiente declarado:** no hay procedimiento escrito de rotación de esa clave.

### D-029 — El audit_log redacta credenciales antes de escribir
**Decidido:** el trigger de auditoría de `"user"` reemplaza `password_hash` y `mfa_secret_cifrado`
por `[redactado]`, y omite por completo las actualizaciones de pura contabilidad de sesión.
**Por qué:** el trigger genérico de A2 copia `to_jsonb(NEW)` entero. Sobre la tabla de usuarios eso
habría metido la derivación de la contraseña y el secreto de MFA dentro de una tabla append-only que
nadie puede limpiar. Un registro de auditoría que copia las credenciales convierte la evidencia en
el botín.

---

## Decisiones de QA adversarial de A14 (compuerta de la Ola 0)

### D-030 — `app.revocar_sesiones_de_usuario` ignoraba el tenant. CORREGIDA
**Vulnerabilidad encontrada, no reportada por nadie.** Tal como la dejó la migración 015, la función es
`SECURITY DEFINER`, tenía `EXECUTE` para `PUBLIC` y recibía un `user_id` que **no contrastaba contra el
tenant de la sesión**. Verificado empíricamente: una sesión legítima de la firma A revocaba todas las
sesiones vivas de un usuario de la firma B, y el entero devuelto decía **cuántas tenía**. Escritura
cross-tenant y oráculo de actividad ajena, concedidos por el motor. Es una violación directa de la
Regla de Oro 7: el aislamiento lo tiene que imponer la base, y aquí la base lo regalaba por una función
DEFINER sin autorización.
**Por qué se le escapó a las pruebas de A12:** su prueba (`autenticacion.test.ts`, «revocar las sesiones
de un usuario corta todas a la vez») ejercita el camino feliz desde `asAdmin`. Nadie preguntó qué pasa
si quien llama es de otra firma.
**Corregido por A14** en `017`. Regla nueva, en este orden: (1) sin sesión se permite —camino
administrativo, mismo escape deliberado de D-025—; (2) sobre uno mismo, siempre; (3) sobre otro usuario
de la misma firma, exige `usuario.administrar` (SE002); (4) cualquier otro caso, SE003 **con el mismo
mensaje** tanto si el usuario no existe como si es de otra firma —distinguirlos reabriría el oráculo
por la puerta del código de error—.
**Probado en** `tests/adversarial/evasion.test.ts`, cinco pruebas, incluida la de indistinguibilidad.

### D-031 — `app_auth` podía fabricar auditoría dentro de cualquier firma. CORREGIDA
**Vulnerabilidad encontrada.** La política `audit_log_evento_autenticacion` de la 015 acotaba `accion` y
exigía `company_id IS NULL`, pero dejaba `tenant_id`, `user_id`, `entidad` y `valor_nuevo` a discreción
del insertador. Verificado: el rol `app_auth` escribía un registro arbitrario dentro del audit_log de
una firma cualquiera. Como el audit_log es append-only (AU001), **nadie puede limpiarlo después**: la
contaminación es permanente y cae justo sobre la evidencia que el producto vende como diferenciador
(Regla de Oro 6).
**El alcance de D-023 era mayor del declarado.** D-023 describe el riesgo residual de `app_auth` como
«puede emitir una sesión para cualquier usuario cuyo correo conozca». Real: **sin conocer ningún correo**
podía escribir en el rastro de auditoría de cualquier firma.
**Corregido por A14** en `017`: la política exige además `entidad IN ('autenticacion','user_session')` y
que la pareja `(tenant_id, user_id)` sea **coherente contra el espejo `app.usuario`**, o vaya
enteramente en NULL —el intento contra un correo que no existe, que debe seguir registrándose para no
ocultar la enumeración—. Se añadió `app.usuario_pertenece(uuid, uuid)`, `SECURITY DEFINER`, sin GRANT
para `app_user`.
**Probado en** `tests/adversarial/evasion.test.ts`: cuatro forjas rechazadas con 42501, dos controles
legítimos que siguen pasando, y la comprobación de que ninguna forja dejó rastro.

### D-032 — `journal_line.account_id` admitía la cuenta de otra firma. **CERRADA por A2 (migración 018)**

> **Cierre (A2).** Corregida en `db/migrations/018_a2_alcance_fk_y_truncate.sql`. Al recorrer
> `pg_constraint` entero en vez de parchear solo la columna denunciada, aparecieron **71 huecos del
> mismo patrón, no uno**. Ver D-037 para el detalle del arreglo y de lo que apareció de más.
> La prueba `it.fails` de A14 está convertida en prueba normal y acepta el SQLSTATE nuevo `AL001`,
> y se añadió un barrido de `pg_constraint` que vuelve a hacer el inventario contra el catálogo vivo
> en cada ejecución. Diagnóstico original de A14, íntegro:

**Vulnerabilidad de INTEGRIDAD, no de confidencialidad.** `journal_line.account_id` lleva una FK
**simple** a `account(id)`, no la FK compuesta `(id, tenant_id, company_id)` que llevan todas sus demás
referencias. Como las comprobaciones de integridad referencial de PostgreSQL se saltan la RLS, una
partida de la firma A **se inserta sin problema** contra una cuenta de la firma B. Verificado.
**Consecuencia real:** esa partida, una vez publicada, es inmutable; y la RLS después esconde la cuenta,
así que el auxiliar contable y el balance de prueba la perderían **en silencio**. Es el peor tipo de
error contable: el que no se ve.
**Por qué no es expresable con FK compuesta:** `account` es un catálogo híbrido (D-015), su `tenant_id`
puede ser NULL, y `journal_line.tenant_id` es NOT NULL. Hace falta un trigger que replique la regla de
la política híbrida: la cuenta es global, o es de la misma firma y empresa.
**Por qué NO bloquea la Ola 0:** no es ninguno de los cuatro criterios de la compuerta; explotarla exige
acertar un UUID aleatorio, así que no hay fuga de datos; y hoy no existe ni una partida real porque el
motor de causación es de la Ola 1.
**Por qué SÍ bloquea la Ola 1:** en cuanto A3 y A6 empiecen a escribir partidas, el agujero pasa a ser
alcanzable por un error de programación normal, no por un ataque.
**Le corresponde a A2.** Queda una prueba viva en `tests/adversarial/evasion.test.ts` marcada `it.fails`:
hoy pasa porque el agujero existe, y **empezará a fallar el día que A2 lo cierre**, obligando a
invertirla. No se puede olvidar en silencio.

### D-033 — no había trigger `ON TRUNCATE` en el ledger ni en el audit_log. **CERRADA por A2 (migración 018)**

> **Cierre (A2).** `BEFORE TRUNCATE ... FOR EACH STATEMENT` sobre `journal_entry`, `journal_line`,
> `audit_log`, `approval` y `retention_applied`, con el mismo SQLSTATE que el candado de fila de cada
> tabla (LG001 / AU001). La invariante ya no depende de que nadie conceda el privilegio por error: se
> verifica que **ni el superusuario** puede vaciarlas. Diagnóstico original de A14, íntegro:

**Hallazgo estructural.** Un trigger `BEFORE DELETE FOR EACH ROW` **no se dispara con `TRUNCATE`**. Los
candados LG001 (ledger inmutable) y AU001 (auditoría inmutable) son triggers de fila: un `TRUNCATE`
vaciaría `journal_entry` y `audit_log` sin que ninguno se entere.
**Mitigación que sí existe hoy y está verificada:** ningún rol de aplicación —ni `app_user` ni
`app_auth`— tiene el privilegio `TRUNCATE` sobre ninguna tabla de `public`. Hay prueba que barre el
catálogo entero, y otra que comprueba que el intento se rechaza con 42501.
**Riesgo residual:** el dueño de las tablas sí podría. Se solapa con D-024: la invariante «append-only»
es del motor **mientras nadie se conecte como dueño**. Un `CREATE TRIGGER ... BEFORE TRUNCATE ... FOR
EACH STATEMENT` sobre `journal_entry`, `journal_line` y `audit_log` lo cerraría también para el dueño,
que es exactamente el criterio que A2 ya aplicó en LG001 («el trigger protege también al dueño de la
tabla, cosa que el GRANT no haría»). **No se bloquea la Ola 0** porque el camino de aplicación está
cerrado y verificado.

### D-034 — el banco de pruebas era MÁS permisivo que producción. CORREGIDO
**Defecto encontrado en `tests/helpers/db.ts`.** `asegurarRolesAplicacion` reafirma los roles con un
`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO app_user` masivo y después repite algunos REVOKE, pero
**no todos** los que hacen las migraciones. Los cuatro `instalar_rls_*` que `013_grants.sql` revoca
quedaban devueltos a `app_user` en cada ejecución de la suite.
**Por qué importa más de lo que parece:** significa que **un REVOKE que faltara en una migración no lo
habría detectado ninguna prueba**, porque el harness lo estaba concediendo de todos modos. Es la clase
de divergencia que hace que una suite en verde no diga nada sobre el despliegue real.
**Corregido por A14:** los cuatro REVOKE faltantes se añadieron al harness, más el de
`app.usuario_pertenece` que introduce la 017. Y hay una prueba nueva
(«app_user no conserva ningún privilegio de más») que comprueba la lista de REVOKE **contra el motor**,
no contra la buena memoria de quien edite el harness la próxima vez.

### D-035 — D-023 y D-024 verificadas: son ciertas, y una era peor de lo declarado
**No se dieron por buenas por estar documentadas. Se midieron.**

**D-023 (dos roles de base de datos):** el alcance declarado es correcto en lo que dice, e **incompleto**
en lo que callaba —ver D-031, ya cerrada—. Lo que queda abierto y **es cierto**: con las credenciales de
`app_auth`, y sabiendo un correo exacto, se lee la credencial de ese usuario **de cualquier firma**,
porque la verificación de la contraseña ocurre en Node (pgcrypto no está en PGlite). Queda **medido**
en una prueba, no confiado: `evasion.test.ts` comprueba que sin `app.login_email` no se ve ninguna fila,
que con el correo exacto se ve una, y que ni aun así `app_auth` puede leer el ledger. También queda
cerrada por prueba la superficie total del rol: exactamente `audit_log:INSERT` y `user:SELECT`, ni un
privilegio más, y cero sobre el esquema `app`. **Sigue abierta**; cerrarla exige mover la derivación de
clave al motor o a un servicio de autenticación aparte. **No bloquea la Ola 0**: exige poseer una
credencial de infraestructura, no es alcanzable desde una sesión de usuario.

**D-024 (el descenso a `app_user` es reversible en PGlite):** exacta, y A14 la ha convertido en parte
de una prueba automática en vez de una lista en un documento. Lo que ahora se comprueba en cada
ejecución: `app_user` no es superusuario, no tiene BYPASSRLS, no hereda, no crea roles ni bases; no es
miembro de `app_auth` ni al revés —escalar de un camino al otro exige **dos credenciales**—; no es dueño
de ninguna tabla, vista, secuencia ni función; y no tiene `CREATE` en ningún esquema —sin `CREATE` no
puede fabricarse una tabla propia sin RLS donde copiar datos—. **El residuo se mide explícitamente:**
una prueba afirma que en este harness `session_user` **sí** es superusuario, de modo que si algún día
alguien apunta `DATABASE_URL` a un Postgres real con un usuario superusuario, la suite lo dice en voz
alta en lugar de dejar que todo pase por la razón equivocada. **Sigue abierta y su cierre es de
despliegue (A15)**, tal como A12 la dejó.

### D-036 — falsos PASS detectados en el trabajo de A2 y A12
Se revisaron las 120 pruebas existentes buscando aserciones que reclamen una garantía de base de datos
pero la comprueben en TypeScript. **No se encontró ningún falso PASS que invalide un resultado.** Sí se
encontraron **tres aserciones débiles**, que A14 ha cubierto con la versión de motor en vez de pedir que
las cambien:

1. `seguridad.test.ts` — «la empresa la pide el cliente pero la autoriza la base» comprueba
   `rejects.toBeInstanceOf(EmpresaNoAutorizadaError)`, que es un `throw` de `withSessionContext`, no del
   motor. La garantía **sí** está en la base, pero esa prueba no lo demuestra: si alguien escribiera un
   servicio que no pase por el envoltorio, la prueba seguiría en verde. A14 añadió la versión de motor:
   se salta `withSessionContext`, se le miente a `app.company_id` por `set_config` y se comprueba contra
   el catálogo que `app.current_company_id()` devuelve NULL y que `third_party`, `journal_entry` y
   `source_document` devuelven **cero filas**.
2. `seguridad.test.ts` — «un token inventado no resuelve ninguna sesión» tiene el mismo patrón
   (`SesionInvalidaError`). A14 añadió el barrido: sin token, `app_user` no ve una sola fila **de ninguna
   firma** en **ninguna** de las tablas con `tenant_id`, recorriendo el catálogo, no una muestra.
3. `ola0.test.ts` — «sin contexto de tenant no se ve absolutamente nada» y «el segundo nivel (company)
   también aísla» miran **una sola tabla** (`third_party`). Son correctas, pero una tabla no es un
   barrido. A14 las sustituyó por dos barridos por catálogo: **todas** las tablas con `tenant_id` y
   **todas** las tablas con `company_id`, y en los dos sentidos —también desde la segunda empresa hacia
   la primera, porque una fuga no tiene por qué ser simétrica—.

Nota adicional, sin consecuencia: sin sesión sí se ven las filas **globales** de los catálogos híbridos
(los 5 roles de sistema, el catálogo de permisos). Es el comportamiento deliberado de D-015 y no lleva
dato de ninguna firma; queda comprobado explícitamente en vez de asumido.

---

## Decisión de A2 al cerrar D-032 y D-033

### D-037 — El alcance de toda clave foránea se impone en la BD, con dos mecanismos según la forma del padre

**Origen.** A14 denunció una columna (`journal_line.account_id`). Arreglar solo esa columna habría sido
tratar el síntoma: el defecto era que **D-016 estaba aplicada a mano y por tanto de forma incompleta**.
Al recorrer `pg_constraint` con el criterio de D-016 escrito como consulta aparecieron **71 huecos**.

**Lo que apareció y A14 no había visto** (buscaba vectores de evasión, no un inventario):

- **`retention_applied.tax_rule_id` estaba escondido detrás de una FK compuesta.** Lleva
  `(tax_rule_id, regla_vigente_desde)` por D-017, así que a simple vista "ya era compuesta". Pero esa
  pareja amarra la **vigencia**, no el **alcance**: no incluye `tenant_id`. La traza de una retención
  podía citar la regla tributaria de otra firma. Es el caso más grave de los 71, porque D-017 existe
  precisamente para que la traza no pueda mentir.
- **Once columnas `created_by` / `confirmado_por` / `cerrado_por` / `otorgado_por` hacia `"user"`.**
  Registraban *quién* publicó un asiento, cerró un período u otorgó un acceso, y admitían un usuario de
  otra firma. Es un agujero de la Regla de Oro 6: la firma del acto era falsificable.
- **Referencias reflexivas**: `account.parent_id`, `cost_center.parent_id`,
  `source_document.documento_referenciado_id` (la nota crédito podía apuntar a la factura de otra
  empresa).
- **Toda la parametrización**: `tax_rule` → `account` / `municipality` / `ciiu_activity` /
  `tax_concept`, `concepto_causacion` → sus cuatro cuentas y sus cuatro `tax_concept`, etc.

**Dos mecanismos, según la forma del padre.** No es una elección estética: la FK compuesta no siempre
es expresable.

| Forma del padre | Mecanismo | Casos |
|---|---|---|
| Alcance estricto (`tenant_id` NOT NULL) | FK compuesta `(columna, tenant_id[, company_id])` — declarativa, la impone el motor sin código | 18 |
| Catálogo híbrido (`tenant_id` puede ser NULL, D-015) | Trigger genérico `app.trg_fk_alcance` | 53, en 21 tablas |

Con un padre híbrido la FK compuesta es **imposible**: la fila global tiene `tenant_id IS NULL` y la
hija lo tiene NOT NULL, así que nunca casarían. Por eso ahí va un trigger.

**El guardia es `SECURITY DEFINER` a propósito.** Tiene que ver la fila del padre *aunque la RLS se la
esconda al llamante*. Si no, "no la veo" y "no existe" serían indistinguibles: la referencia cruzada
pasaría el trigger y después pasaría la FK —que tampoco mira RLS— y el agujero seguiría abierto. Lleva
`SET row_security = off` para que, si algún día se despliega con un rol dueño **sujeto** a RLS, esto
falle a gritos en vez de aprobar la comprobación en silencio. No filtra nada: solo lee `tenant_id` y
`company_id` del padre, y el mensaje de error no nombra a la otra firma. Se le revoca `EXECUTE` de
`app_user` y de `PUBLIC` — el privilegio sobre una función de trigger se comprueba al **crear** el
trigger, no al dispararlo, así que revocarlo no lo desactiva y lo saca de la superficie de funciones
DEFINER que A14 audita.

**El alcance se hereda hacia abajo, nunca de lado.** Global (`tenant_id` NULL) lo usa cualquiera; de
firma (`company_id` NULL) lo usa cualquier empresa suya; de empresa, solo esa empresa. Se rechaza el
**cruce**, no el uso de algo más amplio: por eso la comparación de empresa exige que ambas columnas
estén definidas. Una regla de firma que apunta a una cuenta de firma es legítima; y el daño que importa
—una partida imputada a la cuenta de otra empresa— se caza igual, porque ahí las dos sí están definidas.

**SQLSTATE nuevo: `AL001` (`FK_ALCANCE_AJENO`)**, en `src/db/types.ts`. Se prefirió un código propio a
reutilizar `23503` para que el diagnóstico distinga "no existe" de "existe pero no es tuya".

**Coste.** Una búsqueda por clave primaria adicional por columna referenciada y por fila insertada. En
`journal_line`, la tabla caliente, es **una** por partida.

**Cómo se evita que vuelva a pasar.** `tests/adversarial/evasion.test.ts` incluye ahora un barrido de
`pg_constraint` que rehace el inventario contra el catálogo vivo en cada ejecución: si alguien añade
mañana una FK hacia una tabla con `tenant_id` sin acotar el alcance, la prueba la denuncia por nombre.
Verificado que detecta la regresión: al quitar a mano el guardia de `journal_line`, el barrido vuelve a
señalar `journal_line.account_id -> account`.

**Nota para quien toque `tests/helpers/db.ts`.** D-034 sigue vivo como fragilidad estructural: el
harness hace `GRANT ... ON ALL FUNCTIONS` y luego repite los REVOKE a mano, así que **todo REVOKE nuevo
en una migración hay que espejarlo también en el harness** o el banco de pruebas queda más permisivo que
producción. El REVOKE de `app.trg_fk_alcance` ya está espejado. Mientras el patrón siga siendo ese, esta
duplicación es una divergencia esperando a ocurrir.

---

## Decisiones de QA adversarial de A14 (compuerta de la Ola 1)

### D-038 — `ESCALA_TARIFA` y `ESCALA_UVT` son representación, no regla. La exención se GANA, no se declara
**Adjudicado:** el detector de la Regla de Oro 2 marcaba `ESCALA_TARIFA = 10n ** 6n` y
`ESCALA_UVT = 10n ** 4n` en `src/domain/dinero.ts`. **A14 coincide con A0 y con A3: son falsos
positivos.** No son tarifa, base, UVT, salario, tope ni calendario: son los factores de escala de punto
fijo de `numeric(9,6)` y `numeric(12,4)`, es decir la **definición de las columnas**, no el contenido de
ninguna fila. Si se anulara el Decreto 572 no cambiarían; si la columna pasara a `numeric(9,8)`
cambiarían sin que cambiara ninguna tarifa. Y quitarlas empujaría a `parseFloat` sobre los `numeric` de
PostgreSQL, que es justo lo que prohíbe la Regla de Oro 5.

**Lo que A14 NO hizo:** aflojar la regla hasta que callara. La exención está acotada por tres cercas
simultáneas, y las tres son comprobables:

1. **Por la forma.** Solo se exime `ESCALA_<ALGO> = 10n ** <n>n`: identificador con ese prefijo **y**
   valor literalmente una potencia de diez en BigInt. `const ESCALA_TARIFA = 0.04`,
   `const ESCALA_UVT = 5237400n` y `const ESCALA_TARIFA_SERVICIOS = 4n` siguen siendo cazados — hay un
   canario por cada uno de los tres.
2. **Por la lista.** Una prueba afirma que las constantes eximidas en todo el código son **exactamente
   esas dos**. Una tercera que reclame la exención rompe la prueba y obliga a adjudicarla.
3. **Por el hecho.** La exención se **gana contra el esquema**: una prueba lee `information_schema` y
   exige que cada constante eximida sea exactamente `10^(escala declarada en la base)`. Si alguien
   cambiara la columna y no la constante —o al revés— la prueba falla. Deja de ser un argumento y pasa a
   ser un invariante verificado.

**Efecto neto: el detector quedó MÁS sensible que antes**, no menos (ver D-040).

### D-039 — `db/seeds/` se excluye del barrido de la Regla 2, y a cambio se audita que sea solo DATO
**Decidido:** el barrido de valores tributarios cubre `src/`, `app/` y `db/migrations/`, y **no**
`db/seeds/`. Desde la Ola 1 ahí viven las tarifas reales de A1, y eso es **el dato en su sitio**: la
Regla 2 exige que el valor viva en una tabla paramétrica, no que no exista. Lo prohibido es el valor
quemado en una ruta ejecutable.

Para que la exclusión no sea una puerta trasera, se comprueba a cambio, con pruebas:
- **todo** archivo de `db/seeds/` es `.sql` — ni un archivo ejecutable;
- ningún seed define lógica (`CREATE FUNCTION|PROCEDURE|TRIGGER`, `DO $$`);
- ningún seed hace `UPDATE`, `DELETE` ni `TRUNCATE` sobre una tabla paramétrica — eso además violaría la
  Regla 3, porque editar un parámetro **inserta vigencia nueva** y jamás actualiza la anterior;
- los seeds **sí traen tarifas reales** (si estuvieran vacíos, "cero valores en el código" sería
  trivialmente cierto y la prueba no probaría nada);
- **toda** fila normativa declara `norma_respaldo`, en el archivo y en la base. Un valor tributario sin
  norma es un valor inventado con buena letra (advertencia 17.5).

### D-040 — Séptima regla del detector: el múltiplo exacto de UVT. La encontró el propio canario
**Hallazgo:** al escribir los canarios que demuestran que el detector sigue cazando tarifas reales,
`if (base > 104748) retener();` **no lo cazaba ninguna de las seis reglas**: no es fracción, no es
porcentaje, no hay palabra tributaria cerca, y 104.748 no es una magnitud de UVT sino **dos**. Y es
exactamente la base mínima de servicios de la sección 12.

**Corregido por A14:** regla nueva `multiplo_de_uvt`, que caza todo entero de cinco cifras o más que sea
múltiplo exacto de una UVT o de un SMMLV conocido (en pesos o en centavos). La forma más natural de
quemar una base mínima es precalcularla, y ahora se caza: 104.748 (2 UVT), 523.740 (10), 785.610 (15),
157.122 (3) y 4.975.530 (95) tienen canario propio. **Cero hallazgos** en el código real.

### D-041 — El andamiaje de A3 es legítimo COMO ANDAMIAJE, y su consecuencia queda MEDIDA
**Adjudicado**, los dos apoyos que A3 declaró:

1. **La `rounding_rule` que monta la suite: LEGÍTIMA.** El redondeo no es tarifa, base, UVT, tope ni
   calendario — la propia Regla de Oro 5 lo llama «parámetro configurable». Y A14 comprobó que **ningún
   valor esperado de la sección 12 depende del modo de redondeo**: en todos los casos
   `valorSinRedondeo == valor`, es decir el producto `base × tarifa` es exacto. Un andamiaje que no puede
   cambiar ningún resultado no puede fabricar ningún PASS.
2. **Las dos `tax_rule` de ReteICA materializadas: legítimas en el VALOR, insuficientes como PRODUCTO.**
   La tarifa no se escribe: se copia con un `SELECT` de `municipality_ica_rule` de A1. A14 lo verificó
   comparando las dos filas: son el mismo número, y la norma de A1 dice «Acuerdo». No hay valor
   inventado. **Pero la fila no existe en producción**, y eso sí tiene consecuencia (V-4).

**Regla general que queda establecida para las olas siguientes:** una suite puede montar un parámetro
**operativo** (redondeo, política de empresa) y puede **copiar** un valor normativo de una fila real,
pero no puede escribir un valor tributario nuevo. Y todo andamiaje debe venir con una prueba que mida su
consecuencia en producción.

**Y esa prueba hizo su trabajo.** Afirmaba, en positivo, que con solo los seeds de A1 había **cero**
reglas de ReteICA, **cero** conceptos de ReteICA y **cero** reglas de redondeo. En cuanto A1 cargó las dos
cosas (`ffaf3db`), **falló** — que era exactamente la señal pactada — y hubo que revisarla y actualizarla
al estado nuevo (D-047). El andamiaje de redondeo del escenario de A3 quedó redundante; el de ReteICA de
Medellín también, y A14 escribió el caso 8 de punta a punta **sin él** para demostrarlo. El de Cali sigue
haciendo falta, por V-5.

### D-042 — `app.resolver_empresa_por_buzon`: la ampliación de la lista blanca se ACEPTA, con el alcance medido y una corrección asignada
**Contexto:** A4 amplió el inventario cerrado de funciones `SECURITY DEFINER` de
`tests/adversarial/evasion.test.ts` para incluir la suya. Es el agente vigilado ampliando la lista que lo
vigila, así que A14 lo verificó en vez de leerlo.

**Lo que resultó cierto:** la superficie de columnas es mínima (solo `id` y `tenant_id`), la coincidencia
es exacta y solo sobre empresas `activa`. A14 lo probó con `%`, `%@%`, coincidencias parciales y cadenas
vacías: **no es un buscador**, devuelve `null` en los seis intentos. Suspendida la empresa, deja de
responder. Y la función es realmente necesaria: `company` tiene RLS de tenant estricto y resolver el
buzón ocurre **antes** de que exista sesión.

**Lo que NO era exacto, y A14 midió:** la justificación escrita dice «no cruza firmas». **Sí cruza**: desde
una sesión de la firma B, con el buzón de la firma A, la función devuelve el `company_id` y el
`tenant_id` de A. Es un **oráculo de existencia de buzones** y una **divulgación de identificadores entre
firmas**. Además, el precedente que invoca (`app.buscar_credencial`, D-023) está concedido **solo a
`app_auth`** y revocado de `app_user`; esta se concedió a `app_user`, que es el rol de **toda** sesión de
negocio. La analogía era correcta en el patrón y más ancha en el privilegio.

**Alcance real del daño, medido:** con esos dos identificadores en la mano, la firma B lee **cero** filas
de `company`, `source_document`, `journal_entry` y `third_party` de A, y no puede escribir nada (`42501`).
Divulga identificadores, no datos.

**Adjudicación: se acepta la ampliación** (V-1, gravedad baja, misma clase que el oráculo de
`user.email` ya aceptado en la Ola 0) **con una corrección asignada**: cuando A12 construya la sesión de
sistema del canal de correo, el `GRANT` debe moverse de `app_user` al rol que de verdad resuelve buzones
antes de la sesión, y revocarse de `app_user`. Hoy no se puede hacer sin romper el camino de A4, porque
ese rol todavía no existe. Queda **medido en dos pruebas** —una que fija en positivo que la función
contesta entre firmas y otra que fija que no se puede hacer nada con lo que devuelve— y el inventario
`SECURITY DEFINER` quedó **duplicado a propósito** en `compuerta-ola1.test.ts`: ampliarlo en un solo sitio
ya no basta.

### D-043 — La rama de "carrera detectada" de A6 era código muerto. CORREGIDA por A14
**Hallazgo:** `causarFactura` envuelve el INSERT del asiento en un `try/catch` que, ante
`journal_entry_idem_uq`, consulta el asiento existente y completa el trabajo como `ya_procesado`. **Ese
`catch` no podía funcionar:** una violación de unicidad aborta la transacción en PostgreSQL, así que la
primera consulta del `catch` moría con `25P02` «current transaction is aborted». A14 lo reprodujo
plantando el asiento del "otro worker" a mano: el resultado era `25P02` y el trabajo quedaba `pendiente`.

**Gravedad real: baja.** El invariante «un solo asiento por documento» nunca estuvo en riesgo — lo impone
el `UNIQUE`, no el `catch` — y el reintento posterior se autocuraba porque para entonces el documento ya
había cambiado de estado. Lo que estaba roto era el manejo elegante que el archivo declara.

**Corregido por A14** con un `SAVEPOINT` en `src/services/causacion.ts`, colocado **antes de escribir
nada del resultado** (traza de retenciones, placeholder de aprobación y asiento), no solo antes del
INSERT. La colocación importa: con el savepoint pegado al INSERT, el perdedor de la carrera habría
sobrevivido dejando filas de `retention_applied` huérfanas, sin asiento — cambiar un defecto por otro
peor. La prueba de regresión verifica las dos cosas: que la carrera se resuelve como `ya_procesado` con
el trabajo `completado`, **y** que el intento perdedor no deja ni una fila de basura.

### D-044 — El canario de inventario de `src/` pasa de "solo hay dos módulos" a lista cerrada declarativa
**Decidido:** el canario de la Ola 0 afirmaba `src/` == `['auth','db']`. Su intención era **detectar que
nadie esconda un cálculo tributario en un rincón**, y esa intención se conserva convirtiéndolo en lo que
ya es el patrón del proyecto para las superficies peligrosas (igual que el inventario `SECURITY
DEFINER`): una **lista cerrada** de `['auth','db','domain','ingest','services']`. Un `src/ai/` de A5 en
la Ola 2 hará fallar la prueba, que es exactamente el punto: obliga a declararlo y a barrerlo, no a
colarlo.

Por el mismo motivo se reescribió el segundo canario. «Las tablas normativas están vacías» ya no
significa «A1 no ha trabajado»; ahora afirma que **aplicar solo las migraciones deja las nueve tablas en
cero** —el dato vive en `db/seeds`, no se cuela por una migración— y se le añadió el complemento
indispensable: **con** los seeds, esas tablas sí traen datos, así que ningún caso dorado está pasando
sobre el vacío.

### D-045 — La costura A3↔A6 no la probaba nadie, y era la más peligrosa del proyecto
**Hallazgo:** A3 probó el motor con datos reales **sin llegar al asiento**. A6 probó el asiento con un
concepto de `aplica_* = false`, es decir **con cero retenciones** — lo dice el encabezado de
`tests/services/causacion.test.ts` con todas las letras. Nadie había juntado las dos mitades: un
documento que entra por la cola, se resuelve con las tarifas de A1 y sale como un asiento **balanceado**
donde las retenciones son partidas de crédito y el proveedor cobra el neto. Es justo donde un error de un
centavo en la agregación o en el redondeo produce un asiento que la base rechaza (`LG002`) — o peor, uno
que cuadra por casualidad con un valor equivocado.

**A14 escribió esa prueba y PASA:** caso dorado 1 de punta a punta, con seeds reales, débito de gasto
$1.000.000 e IVA $190.000, crédito 2365 $40.000, 2367 $28.500 y proveedores $1.121.500, descuadre cero,
**publicado**, y la traza de `retention_applied` amarrada al asiento con su norma. Queda como prueba
permanente: cualquier cambio en la agregación de A3 o en la construcción de partidas de A6 la rompe.

### D-046 — La excepción de "parámetro operativo" se acepta solo si la tabla donde vive NO puede expresar un valor tributario
**Contexto:** para desbloquear V-6, A1 cargó `rounding_rule` con un `norma_respaldo` que dice, con todas
las letras, que es un **PARÁMETRO OPERATIVO y no una norma tributaria**, porque no hay decreto que citar
y no corresponde inventar uno. A14 tenía que decidir si ese respaldo es aceptable o si abre la puerta a
que mañana entre un valor tributario disfrazado de parámetro operativo.

**Adjudicado: se ACEPTA**, y no por el argumento escrito sino porque la excepción está **acotada por el
esquema**, que es lo único que no depende de la buena fe del agente siguiente:

- **`rounding_rule` no tiene dónde escribir una tarifa.** Sus dieciséis columnas son identidad, alcance,
  vigencia y traza; las únicas dos que gobiernan el cálculo son `modo` —restringido por un `CHECK` a los
  **cinco** modos que `src/domain/dinero.ts` implementa de verdad— y `multiplo`, un `bigint` de centavos
  que es el **escalón** del redondeo, no un factor que multiplique ninguna base. **No hay ni una columna
  `numeric` en toda la tabla.** Una tarifa no cabe físicamente. Hay prueba de las dos cosas, y si alguien
  añadiera una columna capaz de llevar un valor tributario, falla.
- **El motor sigue negándose cuando el parámetro falta**, que era el comportamiento que la fila podía
  haber tapado. A14 lo probó por comportamiento y no por conteo de filas: cerrando la vigencia de **toda**
  regla de redondeo (el único `UPDATE` que D-012 permite) y causando una factura de julio de 2026, el
  pipeline devuelve `revision_manual` con motivo `sin_regla_de_redondeo_vigente` y **no deja ni un asiento
  ni una retención a medias**. Cargar un valor por defecto no desactivó la honestidad del motor.
- **El valor por defecto es de verdad sobreescribible por datos.** A14 lo comprobó con un modo y un
  múltiplo distintos: con solo los seeds, el motor resuelve `half_up`/100; en cuanto la empresa inserta su
  propia fila (`truncar`/100000, al mil), el motor resuelve esa. Sin tocar código ni redesplegar — que es
  literalmente el cuarto criterio de la compuerta aplicado a este parámetro.

**Regla que queda establecida:** un agente puede cargar un parámetro sin norma tributaria detrás **solo
si** (a) lo declara como operativo en `norma_respaldo`, (b) la tabla donde vive es incapaz de expresar una
tarifa, base, UVT o tope, y (c) existe prueba de que el motor sigue rechazando cuando el parámetro falta.
Si las tres no se cumplen, es un valor inventado con buena letra y aplica la advertencia 17.5.

### D-047 — A1 tocó dos aserciones de A14 y NO las debilitó: las dejó más fuertes (verificado línea por línea)
**Contexto:** A0 autorizó a A1 a actualizar las dos pruebas que A14 había dejado afirmando **en positivo**
que había cero reglas de ReteICA y cero reglas de redondeo — las que debían fallar en cuanto A1 cargara
los datos. A14 verificó el diff, que es lo que le toca cuando el agente vigilado toca el instrumento que
lo vigila.

**Veredicto: no debilitó nada, y una de las dos quedó mejor de lo que estaba.**

- La prueba de estado pasó de tres conteos (`0/0/0`) a **tres conteos exactos (`1/1/1`) más cinco
  comprobaciones nuevas**: Bogotá y Cali siguen en cero, la tarifa de Medellín es **byte a byte** la de
  `municipality_ica_rule`, `ciiu_activity_id` es `NULL`, la norma sigue citando el acuerdo, la regla de
  redondeo es global y de tipo `todos`, y su modo está dentro de la lista cerrada de cinco. Más superficie
  vigilada, no menos.
- La prueba de "el motor se niega cuando falta el parámetro" ya no podía apoyarse en una tabla vacía, y A1
  la reemplazó por algo **mejor que lo que A14 tenía**: contra el motor real, un hecho anterior a la
  vigencia del parámetro por defecto no encuentra regla y uno posterior sí. Deja de contar filas y pasa a
  ejercitar la resolución por vigencia.
- **A1 detectó y reportó** que las dos aserciones no estaban en el archivo que A0 le indicó, y verificó
  cuáles eran. Es la conducta correcta.

**Lo único que A14 encontró y endureció:** en la primera, la comparación de tarifas usaba encadenamiento
opcional (`resultado.medellin?.tarifa` contra `resultado.medellin?.tarifa_a1`). Si la consulta no
devolviera fila, ambos lados serían `undefined` y la comparación **pasaría en el vacío**. La siguiente
aserción lo habría cazado igualmente (`toBeNull()` falla sobre `undefined`), pero una prueba no debe
depender de que la de al lado la rescate: A14 añadió que la fila **tiene que existir** y que la tarifa
**tiene que ser una cadena**.

### D-048 — Los casos 9 y 10 siguen sobre andamiaje, y eso ya NO es deuda de la Ola 1
**Adjudicado:** tras el desbloqueo, el caso 8 (Medellín) pasa **sin andamiaje ninguno** — A14 lo probó de
punta a punta contra los seeds del repositorio, sin insertar una sola regla. Los casos 9 y 10 (Cali)
siguen necesitando una regla materializada por la suite, pero **por una causa distinta y de otro dueño**:

- Lo que esos dos casos **discriminan** está verificado con datos reales: el 9 discrimina la **base
  municipal de servicios** (Cali 3 UVT = $157.122 contra Medellín 15 UVT = $785.610, ambas cargadas y
  verificadas por A1, ambas recalculadas por A14 desde la base), y el 10 discrimina **qué actividad manda**
  cuando el proveedor tiene una en Bogotá y otra en Cali. Ninguna de las dos cosas depende de la magnitud
  de la tarifa.
- Lo que falta es la **tarifa de ICA por actividad de Cali**, y no falta por descuido: la sección 7.5 **no
  trae ni un número** del Acuerdo 0321 de 2011, y la de Bogotá que sí trae (74901 = 7,66‰) no se puede
  guardar porque el código municipal tiene cinco dígitos y `ciiu_activity` exige cuatro (V-5).

**Conclusión:** esto deja de ser trabajo pendiente de la Ola 1 y pasa a ser (a) una **decisión de esquema
de A2** y (b) un dato de **verificación humana**. La conducta del motor ante esa ausencia —negarse y
dejar el motivo escrito— es la correcta según la advertencia 17.5, y está probada. Se cierra la Ola 1 con
esa limitación **declarada en la tabla de casos dorados**, no escondida.

---

## Decisiones de QA adversarial de A14 (compuerta de la Ola 2)

### D-049 — El acotamiento de A8 al detector de la Regla de Oro 2 está REFUTADO. Salvaguarda restituida
**Qué había hecho A8:** acotar la regla `insert_normativo` a `db/migrations/`, de modo que ya no aplica a
`src/`. Su necesidad es **legítima** (§6.1: `src/services/parametrizacion.ts` inserta en `tax_rule` a
propósito, porque es la vía por la que un contador crea una vigencia nueva sin desplegar). Pero es el
acotamiento de una salvaguarda, o sea la dirección peligrosa, y se apoyaba en una afirmación verificable
escrita en el propio código: *«si alguna vez lo tuviera, lo cazarían las otras cinco reglas»*.

**A14 no la leyó: la envenenó.** Trece muestras de código pasadas por las reglas reales, con
`archivo = 'src/services/parametrizacion.ts'`. **Cuatro escaparon enteras:**

```
INSERT INTO tax_rule (base_minima_uvt) VALUES (2)          -> NADIE la caza
INSERT INTO rounding_rule (multiplo)   VALUES (1000)       -> NADIE la caza
INSERT INTO tax_calendar (dia)         VALUES (12)         -> NADIE la caza
INSERT INTO tax_rule (tarifa) VALUES (4::numeric/100)      -> NADIE la caza
```

La afirmación es **falsa**, y falla justo donde más duele: las cinco reglas restantes se anclan en
decimales, en el signo de porcentaje o en enteros de cinco cifras o más. Un valor tributario que sea un
**entero pequeño** —una base mínima en UVT, un múltiplo de redondeo, un día de calendario— les es
invisible. Y los tres primeros son literalmente lo que la Regla 2 enumera: «tarifa, base mínima, valor de
UVT, salario mínimo, porcentaje, tope o **calendario**». Antes del acotamiento, los cuatro los cazaba la
regla por su forma, sin mirar el valor.

**Adjudicación: el acotamiento de `insert_normativo` se ACEPTA, pero el hueco NO.** No se restituye la
prohibición total —rompería la vía legítima de A8—: se restituye con la forma que separa el caso legítimo
del peligroso, que es **la que el propio A8 invocó** en su justificación («esos INSERT usan siempre
parámetros ligados»). Regla nueva en `tests/adversarial/valores-tributarios.test.ts`:

> En `src/` y `app/`, un `INSERT` sobre una tabla normativa puede llevar **solo** marcadores ligados
> (`$1`), `NULL`, `DEFAULT` y llamadas a función. **Ni un literal numérico.** Si el valor llega del
> contador en tiempo de ejecución, va en un `$n`; si está escrito en la sentencia, es un valor quemado.

Es un escáner **por sentencia**, no por línea, así que ve los `INSERT` multilínea que un barrido
línea-a-línea no puede ver. Trae su propio canario de seis venenos (incluido uno multilínea) y una
muestra inocente con la forma exacta que usa A8. Verificado de punta a punta: inyectando dos de los
venenos en el `parametrizacion.ts` **real**, la prueba los reporta con archivo, literal y sentencia.

**Segundo hallazgo, del mismo sitio (V-14):** al acotar la regla, las muestras del canario dejaron de
pasarle el `archivo`, así que `insert_normativo` **devolvía `false` para todas** y ya no la ejercitaba
nadie. La muestra `INSERT INTO tax_rule (tarifa) VALUES (0.04)` la cazaba `fraccion`, no ella. Corregido:
las muestras declaran su ruta y se añadió una que **solo** esa regla puede cazar (un `INSERT INTO
tax_concept` sin un solo número).

**Tercer refuerzo, por la Ola 2:** ahora que existe `app/` —la superficie con más decimales legítimos del
repositorio (CSS, `step=`, `width=`)—, el barrido ya no puede «alcanzarla» de forma implícita. Se exige
explícitamente que vea archivos de `app/parametros` y `app/bandeja` y que entre ellos haya `.tsx`: si
alguien excluyera `app/` o quitara la extensión para acallar la regla `fraccion`, la prueba cae.

### D-050 — `aprobarAsientosEnLote` no tenía SAVEPOINT: su `catch` por ítem era decorativo. CORREGIDO por A14
**Hallazgo, medido sobre la bandeja real de A7 con 30 empresas montadas.** El criterio de salida dice
«aprobar 50 de un golpe». A14 mandó las 50 y leyó el mensaje que la interfaz le devolvió al contador:

```
<id>: null value in column "ip" of relation "approval" violates not-null constraint
<id>: current transaction is aborted, commands ignored until end of transaction block
<id>: null value in column "ip" ...
<id>: current transaction is aborted ...
```

El patrón alterna porque cada empresa es su propia transacción: dentro de cada una, el primer ítem
fallaba por su propio motivo y **el segundo moría contagiado**. `aprobarAsientosEnLote` envolvía cada
ítem en un `try/catch`, pero un error del motor **aborta la transacción entera**: a partir de ahí toda
sentencia devuelve `25P02` y el `catch` solo sirve para coleccionar mensajes inútiles. Con 50 filas de 30
empresas, una sola fila rancia —un asiento que otro contador ya publicó, un período cerrado— se llevaba
por delante el trabajo de toda la pantalla, y el contador no tenía forma de saber cuáles se aprobaron.

**Es exactamente el mismo hallazgo que D-043 en `causarFactura`, en el otro extremo del flujo:** aislar
la escritura de cada unidad de trabajo para que el fallo de una no contamine a las demás.

**Corregido por A14** en `src/services/causacion.ts`: `SAVEPOINT lote_aprobacion_<n>` por ítem, con
`RELEASE` en el camino feliz y `ROLLBACK TO` + `RELEASE` en el `catch`. Con prueba de regresión que
**discrimina de verdad**: se comprobó desactivando el `SAVEPOINT` y verificando que la prueba **falla**
(«expected error not to contain \<id-de-la-fila-sana\>»), no solo que pasa con él.

### D-051 — Los cambios de A5 al caso dorado 19 se ACEPTAN: no perdió alcance, ganó
**Qué cambió A5:** la aserción «ningún archivo de `src/` menciona `fetch|anthropic|…`» pasó de
`toEqual([])` a `toEqual(['src/ai/proveedor.ts', 'src/ai/proveedores/anthropic.ts'])`, más dos
comprobaciones nuevas (que nada fuera de `src/ai/` tenga red, y que nadie importe el adaptador de forma
estática en todo `src/`).

**Verificado con canario envenenado, no leyendo el diff.** Dos ataques sobre `src/services/consulta.ts`,
el archivo más inocente que hay:

| Veneno inyectado | Resultado |
|---|---|
| `import { crearProveedorAnthropic } from '../ai/proveedores/anthropic.js'` | **CAZADO** — la lista cerrada crece a 3 y la igualdad falla |
| `export async function _n() { return fetch('https://ejemplo'); }` | **CAZADO** — mismo mecanismo |

La lista cerrada es una **igualdad**, no un `includes`: mover el adaptador, añadir un segundo proveedor o
meter una ruta de red en cualquier otro archivo de `src/` la rompe. Es más fuerte que el `toEqual([])`
original, que solo sabía decir «hay algo» sin obligar a nombrarlo. **ACEPTADO.**

### D-052 — El caso dorado 19 se cierra con una MINA, no con un contador
El contador de A5 (`ProveedorLlmFalso.llamadas === 0`) demuestra que **ese objeto** no se llamó. No
demuestra que no se llamara a otro. A14 lo cerró con dos instrumentos que no admiten interpretación:

1. **`ProveedorMina`** — un `ProveedorLlm` que **lanza una excepción** en cuanto alguien lo invoca. Si el
   flujo lo llamara, la prueba muere; no hay número que interpretar.
2. **Espía sobre `globalThis.fetch`** durante toda la segunda pasada: si el proceso intentara salir a la
   red por cualquier vía (el flujo, un `import()` perezoso, telemetría), revienta ahí.

La segunda factura del mismo proveedor con la misma descripción, escrita **distinta** (mayúsculas,
tildes, otro consecutivo de orden), se resuelve desde `memoria_clasificacion` con `origen = 'memoria'`,
`llamadasLlm = 0` y `costoMicrosUsd = 0`. Y una tercera comprobación que A5 no hacía: **con
`proveedor: null`** —sin ningún LLM configurado en absoluto— la clasificación sigue funcionando. El
ahorro no depende del modelo; el producto tampoco.

**Regla de Oro 4, atacada de frente:** un proveedor que devuelve un código **fuera del catálogo cerrado**
con score máximo no clasifica nada (`conceptoId = null`, decisión distinta de `aplicar`), y
`clasificarDocumento` **no escribe ni una fila** de `retention_applied` ni de `journal_entry`. El LLM
propone; el motor calcula.

### D-053 — Las diez funciones `SECURITY DEFINER` nuevas se ACEPTAN: ninguna es un oráculo de existencia
Los cuatro agentes ampliaron el inventario cerrado y **los cuatro actualizaron las dos copias** que A14
duplicó a propósito en D-042. Esa es la conducta que se buscaba. Pero declarar bien no exime de auditar
lo declarado.

**Método de A14 (no leer el `WHERE`, interrogar a la función):** a cada una se le pasa el identificador
**real** de un objeto de otra firma y, por separado, uno **inventado**, y se exige que las dos respuestas
sean **idénticas**. Si difieren, la función confirma que el objeto existe.

| Función | Autor | Veredicto |
|---|---|---|
| `app.fecha_minima_vigencia_tax_rule` | A8 | idéntica con regla ajena y con inventada |
| `app.fecha_minima_vigencia_municipio_ica` | A8 | idéntica |
| `app.fecha_minima_vigencia_tenant` | A8 | sin parámetros; exige `parametro.editar` |
| `app.simular_impacto_tax_concept` | A8 | idéntica |
| `app.simular_impacto_municipio_ica` | A8 | idéntica |
| `app.simular_impacto_valor_base` | A8 | sin parámetros; exige `parametro.editar` |
| `app.empresas_accesibles` | A7 | sin parámetros; solo la firma en sesión |
| `app.crear_token_integracion` | A13 | usuario de otra firma y usuario inexistente dan **el mismo** `IG003` |
| `app.revocar_token_integracion` | A13 | token ajeno y token inventado dan lo mismo, y el ajeno **sigue vivo** |
| `app.listar_tokens_integracion` | A13 | solo la firma en sesión |

Y el permiso no es decorativo: un `auxiliar_causacion` que llame a las de parametrización recibe `SE002`,
y crear un token sin `usuario.administrar` recibe `SE002`. Ninguna acepta un `tenant_id` por parámetro —
si lo hiciera, D-020 se reabriría por la puerta de al lado.

### D-054 — V-9 está RESUELTA por A13, y la prueba es que NO tuvo que tocar nada de A12
**Lo que A14 verificó, no lo que A13 reportó:**

- `db/migrations/090` **no redefine** `app.abrir_sesion` ni `app.session_context`. El token de
  integración es un **segundo camino de primer factor** que desemboca en el mismo `abrir_sesion` intacto,
  igual que `buscar_credencial` para el humano (D-023). D-020/D-021 no se rodean: no hay forma nueva de
  decirle a la base «soy el tenant X».
- **`app.integration_credential` está tan cerrada como `app.session_context`.** Comprobado con
  `has_table_privilege` sobre las dos tablas y los dos roles de aplicación: **cero privilegios**, ni
  siquiera de lectura. El aislamiento ahí es por privilegio, no por política, igual que en D-021.
- **`app.autenticar_token_integracion` está fuera del alcance de `app_user`**: el intento muere con
  `42501` —el motor le niega el `EXECUTE`, no llega ni a entrar en la función—, que es más fuerte que un
  rechazo de dominio. Solo `app_auth`, exactamente como `abrir_sesion` y `buscar_credencial`.
- **El rol `sistema_ingesta` es de mínimo privilegio real, medido:** tiene **exactamente**
  `documento.cargar` y `documento.leer`, y ninguno más. Una sesión abierta con ese rol recibe `SE002` al
  pedir `asiento.aprobar` y `SE002` al pedir `parametro.editar`.
- Un administrador de la firma A **no puede** crear el usuario de sistema en la firma B: lo rechaza la
  RLS (`42501`), no un `if` de aplicación.

**V-9: CERRADA.** Y **V-1 sigue abierta**, correctamente: A13 no tocó el `GRANT` de
`app.resolver_empresa_por_buzon` (verificado en la migración 032) y **hizo bien**, porque el camino de A4
(`src/ingest/persistencia.ts`) todavía la usa. Lo que cambia es que ahora **está desbloqueada**: el rol de
sistema que D-042 exigía como precondición ya existe.

### D-055 — La frontera de n8n (13.2) se verifica sobre los JSON, no sobre el reporte
A14 barrió los seis `n8n/*.workflow.json` con criterio propio: cero nodos de base de datos (`postgres`,
`mysql`, `mongo`, `redis`, `supabase`, `timescale`…), cero nodos de ejecución (`executeCommand`, `ssh`),
cero SQL (`INSERT INTO` / `UPDATE` / `DELETE FROM` / `SELECT … FROM`), cero menciones a una tabla del
ledger (`journal_entry`, `journal_line`, `retention_applied`, `tax_rule`, `uvt_value`), cero vocabulario
tributario (`retefuente`, `reteiva`, `reteica`, `autorretenci`, `tarifa`, `uvt`, `smmlv`) y cero imports
de código del repositorio. **n8n orquesta y notifica; la aplicación decide y calcula.**

### D-056 — La compuerta de la Ola 2 se prueba por la INTERFAZ, no por la capa de servicios
Dos de los tres criterios de salida hablan de lo que hace **un contador**, no de lo que hace una función.
Desde esta ola existe `app/`, así que se prueban por donde se van a usar: las acciones de servidor de
Next.js, con su `FormData`, su cookie de sesión y su `redirect`
(`tests/adversarial/compuerta-ola2-interfaz.test.ts`).

**Lo único simulado es el transporte** (`next/headers`, `next/navigation`) y la conexión
(`app/lib/db.ts`). La sesión la emite `app.abrir_sesion` de verdad, el rol es real, la RLS está activa,
los triggers de vigencia y de ledger son los de producción. Un mock de `withSessionContext` habría
convertido la prueba en teatro; un mock de `cookies()` solo sustituye al navegador.

**Consecuencia para la Ola 3:** cualquier pantalla nueva se prueba igual. Probar el servicio y no la
acción de servidor deja sin verificar precisamente la costura donde el cliente elige qué enviar — que es
donde vive el contador hostil.

---

## Decisiones de QA adversarial de A14 (compuerta de la Ola 3)

### D-057 — El criterio de los 10.000 asientos se comprueba contra las TABLAS CRUDAS, no contra la vista; y exige `ANALYZE`

**Problema:** A9 cierra el criterio de la §12 comparando `balanceDePrueba` con `sumaDirectaLedger`. Las
dos leen la **misma** vista `v_journal_line_reporte`. Esa comparación no puede fallar por la razón que el
criterio persigue: si la vista perdiera filas —y hace un **INNER JOIN con `account`**, que es la forma
clásica de perderlas—, ambas perderían las mismas y el reporte seguiría «cuadrando» contra sí mismo.

**Decidido:** la comprobación de A14 usa **tres** fuentes: (1) el balance, (2) `journal_line JOIN
journal_entry` **crudas** y (3) lo que el propio generador de datos acumuló **en memoria**. Y compara
**grupo por grupo** en los cinco niveles del PUC, incluido el saldo inicial, no solo el gran total: un
total correcto con dos grupos intercambiados no pasa. Se conserva además la comparación circular de A9,
para que si algún día divergen se vea cuál de las dos cambió.

**Y una condición de ejecución que no es un truco:** la carga masiva termina con `ANALYZE`. A14 midió que
sin estadísticas el `JOIN` bajo RLS degenera en bucle anidado y crece cuadráticamente (10 s / 39 s / 159 s
con 2.000 / 4.000 / 8.000 partidas; **4 ms** tras `ANALYZE`). No es la RLS: la misma consulta sin JOIN va
en 3 ms bajo RLS, y `count(*)` con las mismas funciones de sesión en el `WHERE` va en 1 ms. Es el
planificador sin estadísticas. Cualquier PostgreSQL real lo hace por autovacuum; tras una carga masiva hay
que hacerlo a mano. **Consecuencia para A15**, anotada en la propia prueba.

### D-058 — La idempotencia por clave no cubre el solape. El cierre de ejercicio necesitaba las dos cosas

**Problema (V-15):** `cerrarCuentasDeResultado` es idempotente por `idempotency_key =
cierre:<desde>:<hasta>`, y eso está bien: cerrar diez veces el mismo ejercicio deja un asiento. Pero
`saldosACerrar` **excluye los asientos de tipo `cierre`** precisamente para poder repetirse — y esa misma
exclusión hace que un cierre de un rango **distinto pero solapado** vuelva a ver los ingresos y gastos ya
cancelados y los cancele **otra vez**. A14 lo midió: tras cerrar 01-jun→30-jun y luego 15-jun→30-jun, la
cuenta de ingresos quedaba con **saldo débito** y el resultado del ejercicio en **cero**. Nada de eso se
puede deshacer editando: el ledger es inmutable.

**Decidido y corregido por A14:** antes de escribir nada, `cerrarCuentasDeResultado` rechaza con
`CierreSolapadoError` un rango que se solape con el de un asiento de cierre **ya publicado**. El rango del
cierre anterior **no se guarda en ninguna tabla nueva**: se lee de la propia `idempotency_key` del
asiento, que ya es dato del ledger. Un estado paralelo que dijera «hasta dónde está cerrado» podría
desincronizarse del ledger; la clave del asiento, no.

**Por qué rechazar y no «cerrar solo la diferencia»:** porque cuál es la diferencia es una decisión
contable, no aritmética. Si el cierre anterior estuvo mal, la Regla de Oro 1 ya dice qué hacer: se
reversa y se vuelve a cerrar. El mensaje del error lo dice con esas palabras.

### D-059 — Un entregable que no se puede descargar no cumple «se descarga». Se aplica el mismo estándar que en la Ola 2

**Problema (V-16):** la Ola 3 entrega veinte libros correctos, con sus cuatro hojas, que serializan a
`.xlsx` válido — y a los que **nadie puede llegar**: cero importadores de `src/reports/` fuera de las
pruebas, ninguna ruta, ninguna pantalla.

**Decidido:** se bloquea la ola. El criterio de salida de la sección 4 no dice «existe la función que
genera el Excel», dice «**todo reporte se descarga** en Excel», y la §11.1 razona por qué: «un reporte
que solo se ve en pantalla no sirve para el flujo de trabajo real de una firma contable». Esto ni
siquiera se ve en pantalla.

**Y es el mismo estándar que A14 ya fijó, no uno nuevo inventado para castigar a esta ola:** D-056 (Ola 2)
decidió que la compuerta se prueba **por la interfaz**, no por la capa de servicios, después de que la Ola
2 estuviera a punto de cerrarse con la aplicación sin compilar. Aceptar aquí una verificación de capa de
servicios sería contradecir esa decisión en la ola siguiente.

**Lo que A14 no hace, y por qué:** no escribe él la ruta. Construir el entregable y aprobarlo son el mismo
acto si los hace el mismo agente, y esta es la última compuerta del proyecto: es justo donde menos conviene
que el verificador sea también el autor. El desbloqueo está acotado a una sola cosa y todo lo demás queda
verificado y escrito para que no haya que rehacerlo.

### D-060 — Lo que A14 acepta de A10 y A11 sin reservas, para que nadie lo reabra

Tres afirmaciones de los reportes de esta ola resultaron **ciertas al verificarlas**, y quedan aceptadas
con la evidencia con la que se comprobaron, no con la palabra del autor:

1. **Las notas no pueden fabricar una revelación.** No por disciplina del autor, sino por **forma del
   tipo**: `NotaEstadosFinancieros` no tiene campo de contenido, y la columna «REDACCIÓN DE LA NOTA» del
   libro se escribe siempre vacía. Comprobado en las trece notas, campo por campo y celda por celda. Es la
   aplicación correcta de la advertencia 17.5 a los estados financieros: un estado financiero que inventa
   una revelación es peor que uno incompleto, igual que una tarifa inventada es peor que una faltante.
2. **El EFE sale vacío si nadie marcó las cuentas de efectivo.** `es_efectivo` es estrictamente
   `rubro_efe = 'efectivo_y_equivalentes'`; sin marca es `NULL` y no entra. La presunción que sí existe
   —la **actividad** de cada flujo— se marca como `presumida`, se cuenta y se lista en su papel de
   trabajo. Presumir y avisar es honesto; presumir y callar sería inventar.
3. **La exógena no rellena nada por defecto.** Dirección y municipio ausentes salen como celda vacía en el
   plano y como fila en la hoja «Bloqueos» del Excel. Ni un `0`, ni un código DANE, ni «COLOMBIA».

Lo que **no** se acepta de esos reportes: la afirmación de A9 de que «todo `src/reports/` lo invoca un
route handler de Next.js» (**es falsa hoy**, V-16), y la idea de que la advertencia de alcance de los
formatos 1003/1006 «se le muestra al contador» — se le mostraría **si existiera la interfaz que la
consume**, que es justamente lo que falta; y en el Excel, que sí existe, no aparece (V-18).

### D-061 — Un catálogo de rutas se consulta por clave PROPIA, no por la cadena de prototipos

**Problema (V-19):** `app/api/reportes/[libro]/route.ts` resolvía el generador con `REPORTES[libro]`, y el
slug lo elige quien llama. En JavaScript ese acceso recorre el **prototipo**: `REPORTES['__proto__']`
devuelve `Object.prototype` —truthy, así que se salta el 404— y `REPORTES['constructor']` devuelve el
constructor `Object`, que además **es una función** y por tanto se llegaba a **invocar** como si fuera el
generador del reporte. El resultado observable era un 500 con un mensaje interno en vez de un 404 limpio.
No hay fuga —`conSesion` y `app.exigir_permiso` corren igual, y la RLS no se toca—, pero es la clase de
descuido que en otra ruta con menos suerte sí llega a algo.

**Decidido y corregido por A14:** `Object.hasOwn(REPORTES, libro) ? REPORTES[libro] : undefined`. Y la
regla general, que vale para cualquier despacho por clave que venga de fuera (slugs, tipos de documento,
nombres de acción): **si la clave la elige el cliente, la búsqueda se hace por propiedad propia.** Quedan
nueve muestras de regresión (`__proto__`, `constructor`, `toString`, `valueOf`, `hasOwnProperty` y cuatro
de recorrido de ruta), y la prueba informa **todas** las que fallen, no solo la primera: la primera
versión se detenía en `__proto__` y dejaba sin ejecutar las cuatro siguientes.

### D-062 — V-16 no se cierra con «existe la ruta», sino con «no queda ningún libro huérfano»

**Problema:** la forma obvia de verificar la descarga es pedir un par de reportes por HTTP y ver que bajan.
Eso no cierra V-16: el defecto original no era que faltara *una* ruta, sino que **había veinte libros y
ningún consumidor**. Una ruta que sirviera dieciocho de veinte pasaría esa verificación y dejaría dos
libros tan inalcanzables como antes.

**Decidido:** la prueba de A14 (`tests/adversarial/compuerta-ola3-ruta.test.ts`) **enumera en tiempo de
ejecución los generadores exportados por `src/reports/`** (`generarLibro*`, `generarBalance*`,
`generarCertificado*`, `generarRelacion*`, `generarMovimiento*`, `generarDetalle*`, `generarEstado*`,
`generarNotas*`, `generarFormato*`), exige que sean **veinte** y que **todos** aparezcan cableados en el
fuente de la ruta; y comprueba con `git grep` que la ruta es el **único** importador de `src/reports/`
fuera de `tests/` — la afirmación de A9, verificada contra el árbol y no aceptada por escrito. Si mañana
alguien añade un libro y olvida su slug, o si un segundo importador aparece por otro camino, esa prueba
cae. **V-16 no puede reaparecer en silencio.**

Esto es la forma concreta, para módulos, de la convención que la Ola 3 dejó escrita: *un módulo sin
consumidor no está terminado*.

---

## Decisiones de la Ola 4 (A16) — «Operación real»

### D-063 — La carga masiva deja UNA fila de auditoría por archivo, no una por registro

**Problema:** `audit_log.accion` no contemplaba una carga de archivo. Con solo la auditoría fila a fila de
`app.trg_audit`, cargar 400 terceros dejaba 400 filas `INSERT` sin nada que las atara entre sí: nadie
podía responder «¿de qué archivo salió esto y quién lo subió?», que es exactamente la pregunta que se hace
un revisor tres meses después.

**Decidido:** acción `'CARGA_MASIVA'` y función `app.registrar_carga_masiva(entidad, archivo, filas_ok,
filas_error, detalle)`. Escribe una cabecera —catálogo, nombre de archivo, filas que entraron, filas que
se rechazaron— **dentro de la misma transacción** que inserta las filas. No sustituye la auditoría fila a
fila: la resume y la ata a un archivo.

**Trampa que costó una pasada:** el `CHECK` de `audit_log.accion` se reescribe entero, no se «amplía».
La primera versión copió la lista de 009 y perdió los dos verbos de token que había añadido 090; el motor
no lo avisa al migrar, lo avisa mucho después, cuando el canal de correo intenta escribir su rastro.

### D-064 — El PUC de una empresa SOBREESCRIBE el genérico cuenta por cuenta; no lo reemplaza

**Problema reportado por el usuario:** al sacar reportes el sistema pedía cuentas del PUC y no había
ninguna cargada. El PUC genérico de los seeds cubre los veinte casos dorados, no una empresa real, y no
existía ni pantalla ni servicio para cargar el propio.

**Decidido:** para cada `codigo` gana la fila del alcance más específico que exista —**empresa > firma >
global**— y esa regla vive en la **base**, en la vista `v_account_efectivo`, no en TypeScript. Se hizo así
porque el ledger, los reportes, la causación y la pantalla tienen que ver EXACTAMENTE el mismo PUC: con la
regla repartida en consultas, el primer servicio que la olvidara imputaría contra una cuenta que la
pantalla dice que no existe.

**Alternativa descartada:** «el PUC propio reemplaza el genérico entero» como comportamiento por defecto.
Obligaría a cargar las ~200 cuentas del 2650 a toda empresa que solo quiera añadir tres auxiliares, y el
primer efecto de un archivo incompleto sería un ledger sin cuentas donde imputar.

**Cómo se esconde una cuenta heredada:** no se borra —la RLS no deja escribir la fila global, y borrarla
se la quitaría a las otras 59 empresas de la firma—. Se crea la propia con el mismo código y
`activo = false`, y la precedencia hace el resto (`ocultarCuentaGenerica`).

### D-065 — «Usar solo mi PUC» es un interruptor explícito por empresa, y se niega a dejarla sin cuentas

**Decidido:** una empresa que trae su plan de cuentas de otro software sí puede querer el reemplazo total.
Se enciende a mano, por empresa, en `company_setting` clave `'puc.solo_propio'`, y entonces
`v_account_efectivo` deja de mostrarle lo global y lo de la firma. **Nunca es efecto colateral de cargar
un archivo.**

`fijarModoPuc` se **niega** a encenderlo si la empresa todavía no tiene ninguna cuenta propia imputable:
hacerlo dejaría el ledger sin ningún destino válido y el síntoma aparecería mucho después, al intentar
causar una factura, con un error que no menciona esa pantalla.

### D-066 — El rol todopoderoso lo es por definición, no por sus filas de `role_permission`

**Problema:** `admin_firma` era todopoderoso solo porque 014 le insertó todas las filas. Un `DELETE` sobre
esa tabla —desde la pantalla de administración nueva, o desde un `psql`— dejaba a la firma **sin nadie que
pudiera volver a otorgar permisos**. La Ola 4 pedía un rol «blindado a nivel de código, no solo de datos».

**Decidido:** un `if` en la capa de servicio cumpliría la letra y no el fondo: la interfaz no es el único
camino a la base. El blindaje son tres cosas del motor (migración 170):

1. `app.tiene_permiso` concede CUALQUIER permiso a un rol `es_todopoderoso` **sin mirar
   `role_permission`**. Vaciar la tabla no lo desarma.
2. Un trigger rechaza con `RL001` todo `UPDATE`/`DELETE` sobre las filas de `role_permission` de ese rol
   — también para el superusuario: el trigger no mira quién es.
3. Otro trigger rechaza degradarlo, inactivarlo o borrarlo, **y también rechaza crear uno nuevo desde una
   sesión de aplicación**: una firma que pudiera fabricarse roles todopoderosos convertiría el blindaje
   en un adorno. `es_todopoderoso` solo se enciende sin sesión, es decir por migración.

La prueba que lo demuestra no cuenta filas: inserta en `permission` un permiso que **nadie tiene
otorgado** y comprueba que la sesión de `admin_firma` lo ejerce igual, y que la de `contador` no.

### D-067 — Roles propios de la firma, presentados como matriz «módulo × ver / editar / aprobar»

**Decidido:** `role.tenant_id` ya permitía roles de firma desde 002; faltaba (i) poder inactivar un rol
sin borrarlo (`role.activo`; un rol inactivo no concede nada, ni siquiera lo que tenga otorgado) y (ii) el
EJE VERTICAL para presentar el catálogo como lo pide un administrador. Ese eje es
`permission.accion_tipo` (`ver` / `editar` / `aprobar` / `administrar`), una **columna del catálogo**, no
una tabla nueva: es un atributo del permiso, no una entidad.

**Lo que NO se hizo:** inventar permisos «de interfaz». Cada casilla de la matriz es un código de permiso
real de los que exigen los triggers de la base, y `fijarPermisosDeRol` rechaza cualquier código que no
esté en el catálogo del producto — una firma no puede inventarse permisos.

**Borrar un rol que alguien tiene otorgado no lo borra: lo inactiva.** El `ON DELETE CASCADE` de
`role_permission` dejaría a esas personas sin rol de un golpe, sin que nadie lo pidiera.

### D-068 — «El junior corrige, el revisor aprueba» es un ESTADO del recurso, no un permiso especial

**Decidido:** `document_correction.estado` (`pendiente_revision` / `aprobado` / `rechazado`). El permiso
`documento.aprobar_correccion` decide **quién** mueve el estado; el estado vive en los datos, y por eso se
puede consultar, filtrar y auditar. `obtenerCorreccionesVigentes` (A7) filtra por `estado = 'aprobado'`:
el motor solo usa las aprobadas.

**Por qué el estado inicial depende de quién corrige, y no es siempre `pendiente_revision`:** un contador
que corrige su propio documento no tiene a quién pedirle la aprobación. Quedaría una bandeja que nadie
vacía y, en la práctica, la gente aprobaría su propia fila — que es peor que no tener circuito. Quien ya
tiene el permiso inserta directamente en `aprobado`, firmado por él; quien no lo tiene deja la corrección
pendiente.

**Qué pasa si nadie aprueba:** el documento se causa como si la corrección no existiera —el comportamiento
anterior a la Ola 4— y la corrección sigue visible como pendiente. Nunca se aplica a medias.

**Los DATOS de una corrección siguen siendo inmutables** (`RL002`): lo único que se puede mover es su
estado, y solo desde `pendiente_revision`. Corregir una corrección es insertar otra.

### D-069 — La contraseña que fija un administrador sirve para UNA entrada

**Problema:** un administrador que le fija la contraseña a otro **la conoce**. Si esa contraseña siguiera
valiendo indefinidamente, sería un suplantador permanente de cualquiera de su firma, y ningún registro de
auditoría podría distinguir al uno del otro.

**Decidido:** `"user".debe_cambiar_password`. La ponen `crearUsuario` y `fijarPasswordDeUsuario`; la apaga
solo el propio usuario al cambiarla en `/cambiar-password`, y la portada le desvía ahí mientras esté
puesta. Las dos operaciones de administrador **revocan las sesiones abiertas** del usuario en la misma
transacción: sin eso, «cambiarle la contraseña» no echaría a nadie, que es la mitad de las veces por lo
que se hace.

`cambiarMiPassword` exige la contraseña ACTUAL aunque la sesión ya esté abierta: una sesión ajena —un
portátil sin bloquear, una cookie filtrada— no debe poder convertirse en la toma de control permanente de
la cuenta.

**Detalle que destapó la prueba:** `app.trg_permiso_usuario` (016) tiene una lista blanca de columnas de
credencial propia, y `debe_cambiar_password` no estaba en ella. Apagarla exigía ser administrador, así que
la única persona que no podía cumplir la obligación era justo aquella a quien se le había impuesto. La
migración 170 reescribe la función con la columna dentro.

### D-070 — Una fila de un archivo es una VIGENCIA NUEVA, nunca un `UPDATE` de un valor

**Decidido:** para las tablas versionadas, la carga masiva no es un «upsert». Si la fila choca con una
vigencia abierta de la misma clave lógica, `src/services/catalogos.ts` **no reimplementa el cierre**:
llama a la función de `parametrizacion.ts` que ya lo sabe hacer (`editarTarifaTaxRule`, `editarUvtValue`,
`editarMunicipioIcaRule`…). Así la carga masiva hereda gratis las seis conductas de la sección 6.2 —norma
obligatoria, no retroactividad sobre lo publicado, append-only, permiso, auditoría, simulador—.

Los catálogos SIN vigencia (municipio, CIIU, concepto tributario, centro de costo) sí admiten
actualización directa: no llevan `vigente_desde`, no entran en ninguna resolución por fecha, y corregirle
el nombre a un municipio no reescribe ningún hecho económico.

### D-071 — La plantilla y el validador son la misma lista leída dos veces

**Decidido:** `src/services/carga-masiva/definiciones.ts` es la única fuente de verdad de la carga masiva.
De ella salen las tres cosas que si no habría que mantener sincronizadas a mano: los `.xlsx` de
`/archivos-masivos/`, la validación de cada fila que sube el usuario, y la pantalla `/carga-masiva` que
explica cada columna. Si el esquema gana una columna obligatoria, se añade una vez y las tres cambian
juntas.

**Consecuencia de diseño que importa:** `validar()` es una función PURA que solo convierte texto a tipos y
comprueba formatos, e `insertar()` no valida nada de negocio — llama al servicio de dominio que ya existía
para la carga fila a fila. Si algún día alguien mete una regla tributaria en `validar()`, habrá dos
motores tributarios y uno de los dos estará mal.

La ruta `GET /api/plantillas/:catalogo` **genera la plantilla en el momento** en vez de servir el archivo
de `/archivos-masivos/`: un despliegue con el directorio viejo entregaría plantillas que su propio
importador rechaza. El directorio existe para poder mirarlas sin levantar el producto y para que un
cambio de esquema se vea en el `git diff`.

**Los importes y las tarifas se convierten con cadenas, nunca con `Number`** (Regla de Oro 5), y el
separador de miles **no se adivina**: «1.500» es mil quinientos en Colombia y uno coma cinco en el resto
del mundo. Se rechaza y se le pide al usuario que lo quite. Sin esa comprobación —que faltaba en la
primera versión y destapó una prueba— «1.500» habría entrado como un peso con cincuenta, en silencio.

### D-072 — Todo el archivo o nada, y nunca a medias en silencio

**Decidido:** tres cosas, con su motivo.

1. **Se valida todo antes de escribir nada.** Dos pasadas de solo lectura —formato de cada celda, y luego
   resolución de los códigos contra la base— antes del primer `INSERT`. Un contador que sube 400 terceros
   necesita la lista COMPLETA de lo que está mal, no el primer error.
2. **Si hay errores, por defecto no se escribe nada.** Se devuelve el informe (fila tal como se ve en
   Excel, columna y motivo) y el usuario elige: corregir y volver a subir, o pedir **explícitamente** que
   se carguen solo las filas válidas. Una carga parcial silenciosa deja al contador creyendo que tiene 400
   proveedores cuando tiene 383, y el descubrimiento llega el día del cierre.
3. **Una transacción por archivo, SIN savepoints por fila.** Es el caso opuesto al de D-050: allí 50
   aprobaciones independientes debían sobrevivir a que una fallara; aquí un savepoint por fila haría que
   el archivo entrara a medias, que es justo lo que el punto 2 evita.

El informe de errores viaja **dentro** de la excepción (`CargaRechazadaError`): hay que lanzar para que la
transacción se deshaga, y hay que devolver datos para poder enseñarle al contador qué filas fallaron.

### D-073 — Tres motivos por los que un reporte no sale, tres mensajes distintos

**Problema reportado:** pedir un reporte de una empresa recién abierta devolvía un `.xlsx` con la hoja
«Datos» vacía y ninguna explicación, o —cuando faltaba una cuenta— un JSON con el mensaje crudo de
PostgreSQL en la pestaña del navegador.

**Decidido:**

1. **Falta configuración sin la cual el reporte no puede existir** (ninguna cuenta imputable; una cuenta o
   un tercero que no están en esta empresa) → `409`, con el **enlace exacto** donde se arregla. No es un
   error del sistema: es una tarea pendiente.
2. **La configuración está y no hubo movimiento** → no es un fallo, es una respuesta. A un **navegador**
   se le dice «no hay datos para tales criterios» con las fechas y el nombre del tercero dentro, más un
   enlace para descargar el archivo vacío de todos modos; a un **programa** se le entrega el `.xlsx`,
   porque el criterio de salida de la Ola 3 dice que todo reporte se descarga. Es la única diferencia de
   comportamiento de la ruta, y es de PRESENTACIÓN: el archivo y sus filas son idénticos.
3. **Fallo técnico** → mensaje genérico al usuario y detalle SOLO en el registro del servidor. El mensaje
   crudo del motor en pantalla no ayuda a nadie y sí le cuenta a un atacante cómo está montado el sistema.

**Lo que NO es bloqueante, y por qué se corrigió a mitad de la ola:** la primera versión bloqueaba con 409
los estados financieros sin `niif_mapping` y la exógena sin `exogena_account_mapping`. Lo destapó la
compuerta de la Ola 3 de A14: **A10 y A11 ya contemplan que falte el mapeo** —A10 cae al nombre del grupo
PUC como rótulo y deja una advertencia en el papel de trabajo; A11 dice explícitamente que el saldo solo
sale si el contador mapeó las cuentas—. Bloquear era sustituir por un rechazo un comportamiento ya
diseñado y bien resuelto, y encima rompía un criterio de salida. Ahora son **avisos** en `/reportes`,
antes de pedir el reporte, y el archivo se descarga igual.

---

## Ola 4 — qué entregó A16 (2026-09-01)

**Sin compuerta todavía.** A14 no ha verificado nada de esto; el orden del proyecto es que lo verifique él
mismo antes de dar la ola por cerrada.

| # | Tarea | Qué se entregó |
|---|---|---|
| 0 | Navegación | `app/_navegacion.tsx` + `app/layout.tsx`: breadcrumb y botón «Volver» en el **layout raíz**, así que toda ruta lo hereda por construcción — incluidas las que se añadan después. Es el único componente de cliente del proyecto, porque `usePathname()` solo existe ahí; no lee datos ni decide nada de seguridad. |
| 1 | Inventario | Quince tablas de catálogo identificadas y cubiertas; lo que quedó fuera está declarado con su motivo (abajo). |
| 2 | Plantillas | `npm run plantillas-masivas` escribe quince `.xlsx` independientes en `/archivos-masivos/`, con encabezados exactos, fila de ejemplo, obligatorias en rojo con asterisco, opcionales en azul, listas desplegables en los campos de conjunto cerrado y hoja «Instrucciones» columna por columna. Se generan también en caliente en `GET /api/plantillas/:catalogo` (D-071). |
| 3 | Carga masiva | `/carga-masiva` y `/carga-masiva/:catalogo`, `.xlsx` y `.csv`, validación en dos pasadas, informe fila/columna/motivo, «solo las válidas» bajo petición explícita, transacción por archivo y auditoría `CARGA_MASIVA` (D-070, D-071, D-072). |
| 4 | PUC | `v_account_efectivo`, `/parametros/puc`, plantilla de `account` y de `niif_mapping`, e interruptor «solo mi PUC» (D-064, D-065). |
| 5 | ReteICA en cascada | `listarActividadesIcaDeMunicipio`: el selector de actividad **filtra por el municipio elegido** y, cuando no hay tarifas, dice por qué y adónde ir. |
| 6 | Errores de reportes | `src/reports/diagnostico.ts` + panel de avisos en `/reportes` (D-073). |
| 7 | Administración | `/admin/usuarios`, `/admin/roles`, `/admin/correcciones`, `/cambiar-password` (D-066, D-067, D-068, D-069). |

### Las quince tablas cubiertas por la carga masiva, y su módulo

Cárguense en este orden: cada una solo depende de las anteriores.

| # | Tabla | Catálogo | Módulo |
|---|---|---|---|
| 1 | `municipality` | Municipios (DANE) | Parámetros › ReteICA |
| 2 | `ciiu_activity` | Actividades CIIU | Parámetros |
| 3 | `account` | Plan de cuentas (PUC) | Parámetros › Plan de cuentas |
| 4 | `cost_center` | Centros de costo | Parámetros › Plan de cuentas |
| 5 | `niif_mapping` | Mapeo PUC → NIIF para PYMES | Parámetros › Plan de cuentas |
| 6 | `tax_concept` | Conceptos tributarios | Parámetros › Tarifas |
| 7 | `tax_rule` | Tarifas (retefuente, ReteIVA, ReteICA, autorretención, IVA) | Parámetros › Tarifas |
| 8 | `tax_rule` (tipo `retefuente_salarios`) | Tabla progresiva del art. 383 ET, con tramos en UVT | Parámetros › Tarifas |
| 9 | `municipality_ica_rule` | Bases mínimas y tarifa general de ReteICA | Parámetros › ReteICA |
| 10 | `uvt_value` | UVT por año | Parámetros › Valores base |
| 11 | `smmlv_value` | SMMLV y auxilio de transporte por año | Parámetros › Valores base |
| 12 | `tax_calendar` | Calendario tributario (vencimientos) | Parámetros |
| 13 | `third_party` | Terceros | Terceros |
| 14 | `third_party_fiscal_attribute` | Atributos fiscales versionados (las nueve banderas) | Terceros |
| 15 | `third_party_activity` | Actividad económica por municipio (ReteICA) | Terceros |

**La tabla progresiva del art. 383 y el calendario tributario NO se diseñaron: ya existían.** `tax_rule`
tiene `rango_desde_uvt`, `rango_hasta_uvt` y `uvt_adicionales` desde 006, y `tax_calendar` desde la misma
migración. Crear tablas nuevas habría sido un segundo sitio donde el mismo hecho puede quedar
desactualizado; lo que faltaba era la plantilla y el camino de carga, no el modelo.

### Qué quedó FUERA de la carga masiva, y por qué

- **Asientos contables.** El ledger es append-only y solo nace de una causación aprobada (Regla de Oro 1).
  Un archivo de asientos sería una puerta trasera al libro.
- **Facturas.** Entran por el buzón de correo como XML DIAN, con deduplicación por CUFE. Cargarlas por
  Excel perdería el CUFE y la trazabilidad al documento original.
- **Usuarios y roles.** Se administran en `/admin/usuarios`. Crear usuarios en bloque desde un archivo,
  con contraseñas dentro, es exactamente la clase de cosa que no debe existir.
- **`concepto_causacion` y `exogena_account_mapping`.** Referencian a la vez cuentas PUC y conceptos
  tributarios, y su semántica está enredada con el clasificador de A5. Quedan para una ola posterior; hoy
  se editan uno a uno. **Es deuda declarada, no un olvido.**
- **`rounding_rule`.** Son tres filas por firma; no cumple el criterio de «volumen esperable de muchas
  filas» y ya tiene pantalla propia en `/parametros/valores-base`.

### Defectos que A16 encontró y corrigió mientras construía

| Qué | Dónde | Cómo se vio |
|---|---|---|
| El `CHECK` de `audit_log.accion` reescrito perdía los dos verbos de token de A13 | `170` | Las pruebas de integraciones, no el migrador |
| `document_correction.revisado_por` era una FK sin guardia de alcance (D-032/D-037) | `170` | El barrido de `evasion.test.ts` |
| `admin_firma` dejaba de tener «todos los permisos del catálogo» al añadir uno nuevo | `170` | La compuerta de arranque |
| `debe_cambiar_password` no estaba en la lista blanca de credencial propia: la única persona que no podía cambiar su contraseña era a quien se la habían fijado | `170` | Prueba propia de la Ola 4 |
| «1.500» entraba como un peso con cincuenta en vez de mil quinientos | `carga-masiva/valores.ts` | Prueba propia de la Ola 4 |
| Esconder una cuenta heredada exigía cargar toda su cadena de ancestros | `services/puc.ts` | Prueba propia de la Ola 4 |
| Bloquear con 409 los estados financieros sin mapeo NIIF rompía «todo reporte se descarga» | `api/reportes` | La compuerta de la Ola 3 de A14 |

### Pruebas de A14 que A16 acotó, con su justificación escrita

Las dos siguen la regla de D-047: **se actualizan al estado nuevo sin bajar la vara, y quien las toca lo
declara.** A14 revisa el diff, no el reporte.

1. `evasion.test.ts` — «app_user no es miembro de app_auth ni al revés». La consulta barría CUALQUIER
   membresía que tocara a los dos roles, incluida «X es miembro de app_user», que es lo que la migración
   161 tiene que hacer para que la aplicación arranque contra un Postgres gestionado. Se acotó a las dos
   direcciones que SÍ son escalada, **y se añadió una prueba nueva y más estricta**: todo el que sea
   miembro de `app_user`/`app_auth` tiene que ser superusuario o el dueño del esquema.
2. `compuerta-ola3-ruta.test.ts` — «la ruta es el ÚNICO importador de `src/reports/`». La invariante real
   (D-062) es que ningún GENERADOR quede huérfano ni se sirva saltándose el rastro EXPORT.
   `src/reports/diagnostico.ts` no genera libros. Se comprueba ahora que **nadie fuera de la ruta nombre
   un `generarXxx`**; un archivo que importara `generarLibroMayor` para servirlo por su cuenta seguiría
   haciendo fallar la prueba.

### Lo que A16 NO verificó, y le toca a A14

- No corrió la secuencia del README contra un PostgreSQL de verdad: todo lo de arriba está probado contra
  PGlite y con `next build`, no contra Neon ni recorriendo las pantallas a mano.
- No hay prueba «por la interfaz real» de las pantallas nuevas al estilo de
  `compuerta-ola2-interfaz.test.ts`: los servicios y la ruta de reportes sí se atacan, las acciones de
  servidor de `/carga-masiva` y `/admin/**` no.
- El tope de 5.000 filas y 8 MB por archivo no se probó con un archivo grande de verdad.

---

## Vulnerabilidades — registro de A14

| Id | Qué es | Gravedad | Estado | De quién |
|---|---|---|---|---|
| D-030 | Revocación de sesiones cross-tenant + oráculo de actividad ajena | Alta (rompe la Regla 7 en escritura) | **CORREGIDA** por A14 (migración 017) | era de A12 |
| D-031 | `app_auth` forjaba audit_log en cualquier firma, de forma permanente | Media-alta (rompe la Regla 6) | **CORREGIDA** por A14 (migración 017) | era de A12 |
| D-034 | El harness concedía privilegios que las migraciones revocan | Media (invalida pruebas de privilegio) | **CORREGIDA** por A14 | infraestructura de pruebas |
| D-032 | `journal_line.account_id` aceptaba cuenta de otra firma (FK simple). El barrido de `pg_constraint` reveló **71 huecos del mismo patrón**, no uno | Media (integridad contable) | **CORREGIDA** por A2 (migración 018, ver D-037) | era de A2 |
| D-033 | Sin trigger `ON TRUNCATE` en ledger ni audit_log | Baja hoy (falta el privilegio), media si alguien despliega como dueño | **CORREGIDA** por A2 (migración 018) | era de A2 |
| D-023 | `app_auth` lee la credencial de cualquier correo conocido | Baja (exige credencial de infraestructura) | **ABIERTA por diseño**, alcance ahora medido y acotado | A12 / arquitectura |
| D-024 | El descenso a `app_user` es reversible en PGlite | No aplica en producción bien configurada | **ABIERTA por diseño**, invariantes comprobables ya automatizadas | **A15 al desplegar** |
| — | La secuencia `audit_log_id_seq` es global: `last_value` deja inferir el volumen de escritura de todo el sistema | Muy baja (canal lateral, sin datos) | **Aceptada**, sin acción | anotación |
| — | `user.email` y `company.buzon_email` son únicos globalmente: permiten saber si un correo está tomado | Muy baja (inherente a un espacio de nombres global de login) | **Aceptada**, sin acción | anotación |

### Hallazgos de la Ola 1 (A14)

Se numeran `V-n` para no confundirlos con las decisiones `D-n`. **Los dos que bloqueaban la Ola 1 (V-4 y
V-6) están CERRADOS**, cerrados por A1 en el commit `ffaf3db` y **reverificados por A14 con pruebas
propias**, no por reporte. El resto está corregido, acotado o declarado, y ninguno derrota ninguno de los
cuatro criterios de la compuerta.

| Id | Qué es | Gravedad | Estado | De quién |
|---|---|---|---|---|
| V-1 | `app.resolver_empresa_por_buzon` contesta a la sesión de **otra firma**: con un buzón ajeno devuelve su `company_id` y su `tenant_id`. Oráculo de existencia de buzones + divulgación de identificadores entre firmas. Está concedida a `app_user` (toda sesión de negocio), mientras el precedente que invoca (`app.buscar_credencial`) está concedido solo a `app_auth` | **Baja** — divulga identificadores, no datos: A14 midió que con ellos se leen **cero** filas y no se escribe nada (`42501`) | **ABIERTA, acotada y medida en dos pruebas.** Ver D-042 | **A12** (crear la sesión/rol de sistema del canal de correo) + **A4** (mover el `GRANT` a ese rol y revocarlo de `app_user`) |
| V-2 | La rama de "carrera detectada" de `causarFactura` moría con `25P02`: era código muerto | Baja (el invariante lo imponía el `UNIQUE`; lo roto era el manejo elegante) | **CORREGIDA por A14** (`SAVEPOINT`, D-043), con prueba de regresión que además verifica que el perdedor no deja filas huérfanas | era de **A6** |
| V-3 | El detector de la Regla de Oro 2 no cazaba umbrales **precalculados** (`if (base > 104748)`, que son 2 UVT) | Media (es la forma más natural de quemar una base mínima) | **CORREGIDA por A14** (séptima regla, D-040) | infraestructura de QA de A14 |
| V-4 | `tax_rule` no tenía **ni una fila de tipo `reteica`**: el 2‰ de Medellín existía solo en `municipality_ica_rule.tarifa_general`, y el motor amarra toda `retention_applied` a una regla con vigencia (D-017). En producción el ReteICA **no existía** | Era **alta como producto** | **CERRADA por A1** (`db/seeds/tanda2/100_reteica_medellin.sql`, commit `ffaf3db`) y **reverificada por A14**: el caso dorado 8 se causa de punta a punta **sin andamiaje**, con la tarifa copiada byte a byte de la fila de A1 y la norma encadenada que sigue citando el Acuerdo 066 de 2017. Bogotá y Cali siguen fuera — eso es V-5 | era de **A1** |
| V-5 | No hay tarifas de ICA **por actividad** para Bogotá ni Cali, porque el código municipal de Bogotá `74901` (5 dígitos, Decreto 352 de 2002) no cabe en el `CHECK` de 4 dígitos de `ciiu_activity`, que es el formato del CIIU **nacional**. Además la sección 7.5 **no trae ni un número** del Acuerdo 0321 de 2011 de Cali | Media | **ABIERTA — es el único hueco de datos que queda tras el desbloqueo, y NO bloquea la Ola 1** (D-048): lo que los casos 9 y 10 discriminan —la base municipal y la actividad que manda— está verificado con datos reales; lo que falta es la magnitud de una tarifa que el mega-prompt no aporta. A1 hizo **bien** en no truncar `74901` a `7490` | **A2** decide el esquema; **luego A1** carga lo verificable; el resto es **verificación humana** |
| V-6 | `rounding_rule` estaba **vacía**. Sin regla de redondeo el motor —correctamente— mandaba **todo** a revisión manual: con el repositorio tal como se entregaba, el producto **no calculaba ni una sola retención** | Era **alta como producto** | **CERRADA por A1** (`db/seeds/tanda2/090_rounding_rule.sql`, commit `ffaf3db`) y **reverificada por A14**: el pipeline completo produce el asiento del caso 1 sin que ninguna prueba inserte nada. El respaldo «parámetro operativo» se **acepta con criterio explícito** (D-046): la tabla no puede expresar una tarifa, el motor sigue negándose cuando el parámetro falta, y el valor por defecto es sobreescribible por datos | era de **A1** |
| V-7 | El `DocumentoNormalizado` de A4 no discrimina **AIU por línea**, así que todo concepto con `base_es_aiu` va a revisión manual por la vía de ingest | Baja (la conducta es correcta: no se inventa el AIU) | **ABIERTA, declarada.** El caso dorado 11 se prueba contra el motor, no por el canal real | **A4** (si algún proveedor lo trae en UBL) o **A7** (campo editable en la bandeja) |
| V-8 | `procesarJobCausacion` usa el municipio **del tercero** como municipio de la operación: no hay señal de "dónde ocurrió" en el documento | Baja | **ABIERTA, declarada.** El caso dorado 10 se prueba contra el motor, no por el canal real | **A7** (campo editable) |
| V-9 | No existe sesión de sistema para el canal de correo: `recibirDocumento` exige una sesión real (D-021) y el correo llega sin ninguna | Media como producto (el canal de correo no está cablead0 de punta a punta) | **ABIERTA, declarada.** No es criterio de la compuerta de la Ola 1 | **A12** (mecanismo) + **A6/A13** (quien la abre) |
| V-10 | **La costura A3↔A6 no la probaba nadie**: A3 probó el motor sin asiento, A6 probó el asiento con cero retenciones | Era el riesgo más alto de la ola | **CERRADA por A14**: prueba de punta a punta escrita y **en verde** (D-045) | — |
| — | Los 11 fixtures UBL de A4 son **construidos a mano**, no capturas de producción, y el CUFE no es criptográficamente auténtico | Media antes de producción | **Declarada por A4 y aceptada por A14 para la compuerta.** A14 amplió la cobertura con variantes hostiles propias (base64 partido en líneas de 76, XML plano en CDATA, prefijos `ns2/ns3/ns4`) y con dos ataques (**billion laughs** y **XXE**), todos superados. El riesgo residual está confinado a `validar.ts` y `extraer.ts` | **humano / A15**: conseguir un XML real de la DIAN antes de producción |



### Hallazgos de la Ola 2 (A14)

Se numeran a continuación de los de la Ola 1. **Ninguno bloquea la compuerta**: los tres que podían
hacerlo están corregidos por A14 en esta misma pasada, y el que queda abierto (V-11) es una **fragilidad
de despliegue** que no derrota ningún criterio con la cabecera estándar puesta.

**Estado de los hallazgos heredados de la Ola 1 al cerrar la Ola 2:**

| Id | Estado al cerrar la Ola 2 |
|---|---|
| V-1 | **SIGUE ABIERTA, y ahora DESBLOQUEADA.** A13 **no** tocó el `GRANT` de `app.resolver_empresa_por_buzon` (verificado por A14 en `db/migrations/032`), e hizo bien: `src/ingest/persistencia.ts` (A4) todavía la usa. La precondición que D-042 exigía —que existiera un rol/sesión de sistema para el canal de correo— **ya se cumple** (D-054). Le toca a **A4 + A12** |
| V-5 | **SIGUE ABIERTA.** Nada de la Ola 2 la toca. `A2` decide el esquema del código de actividad municipal; luego A1 carga lo verificable |
| V-7 | **CERRADA por A7** (`document_correction`, migración 070). A14 la reverificó **solo por ejecución** de la prueba de A7, que sí es de punta a punta por el canal real (sin AIU va a revisión manual; corregido y reencolado, causa sobre el AIU). No hay prueba propia de A14 para esta: deuda menor anotada, no bloqueante |
| V-8 | **CERRADA por A7**, misma condición que V-7 (municipio del tercero sin ReteICA; corregido a Medellín, causa con la tarifa real de A1) |
| V-9 | **CERRADA por A13**, verificada por A14 punto por punto (D-054) sin creerle al reporte: no rodea D-020/D-021, la tabla de credenciales está tan cerrada como `app.session_context`, autenticar es exclusivo de `app_auth` (`42501` para `app_user`) y el rol de sistema tiene exactamente dos permisos |

**Hallazgos nuevos de esta pasada:**

| Id | Qué es | Gravedad | Estado | De quién |
|---|---|---|---|---|
| V-11 | **La aprobación desde la bandeja revienta con un error crudo de PostgreSQL si el despliegue no reenvía la IP del cliente.** `approval.ip` es `inet NOT NULL` (Regla de Oro 6, «desde dónde»); `aprobarAsiento` la resuelve con `COALESCE($5::inet, app.current_ip())` y A7 solo sabe leer `x-forwarded-for`. Sin esa cabecera, el contador recibe `null value in column "ip" of relation "approval" violates not-null constraint` y no aprueba nada | **Media como producto** — no es fuga ni corrupción: A14 verificó que el fallo **no deja el ledger a medias** (el asiento sigue en `draft`, cero aprobaciones huérfanas) y que el usuario sí se entera. Con la cabecera puesta —lo estándar detrás de cualquier proxy— el criterio de salida pasa completo | **ABIERTA, declarada y medida** en `compuerta-ola2-interfaz.test.ts` («7) V-11 …») | **A7** (leer también `x-real-ip` y, si no hay ninguna, dar un mensaje accionable en vez de propagar el error del motor) + **A15** (garantizar la cabecera en el despliegue). **A6** puede además comprobar el invariante explícitamente antes de insertar |
| V-12 | **`aprobarAsientosEnLote` no tenía `SAVEPOINT`: su `catch` por ítem era decorativo.** Un error del motor en cualquier ítem abortaba la transacción y todos los siguientes morían con `25P02`. Una sola fila rancia se llevaba por delante el resto del lote — justo en el criterio «aprobar 50 de un golpe» | **Media-alta como producto** (derrotaba el tercer criterio de salida en el escenario más común: dos contadores con la misma bandeja abierta) | **CORREGIDA por A14** (D-050), con prueba de regresión que se verificó **desactivando** la corrección | era de **A6** |
| V-13 | **El acotamiento de A8 al detector de la Regla de Oro 2 sí perdía cobertura real.** Cuatro valores tributarios —base mínima en UVT, múltiplo de redondeo, día de calendario y una tarifa escrita como división— pasaban intactos por `src/`, y los cuatro los cazaba la regla antes del cambio | **Media** (es infraestructura de QA: no rompe nada hoy, pero deja de avisar mañana) | **CORREGIDA por A14** (D-049): salvaguarda restituida con la forma «solo parámetros ligados en un INSERT normativo de `src/`/`app/`», con canario propio y verificada inyectando veneno en el archivo real | infraestructura de QA de **A14**, hueco abierto por **A8** |
| V-14 | **El canario había dejado de ejercitar `insert_normativo`.** Al acotar la regla, las muestras del veneno dejaron de pasarle la ruta del archivo, así que la regla devolvía `false` para todas: la muestra que existía para ella la cazaba `fraccion` | **Baja** (una regla sin canario es una regla que nadie sabe si sigue viva) | **CORREGIDA por A14** (D-049): las muestras declaran su ruta y se añadió una que **solo** esa regla puede cazar | infraestructura de QA de **A14** |
| — | La bandeja consolidada abre **una transacción por empresa, en secuencia** (declarado por A7). A14 lo midió con 31 empresas accesibles: la pantalla completa tarda ~0,7 s en PGlite. No es un defecto hoy; es el techo conocido | Muy baja | **Aceptada**, con el número medido | anotación para **A15** |


---

### Hallazgos de la Ola 3 (A14)

Se numeran a continuación de los de la Ola 2. **Uno bloquea la ola (V-16)** y no es un defecto de
cálculo: es que lo construido no tiene por dónde entregarse. Otro era un defecto real del ledger y está
**corregido en esta misma pasada** (V-15).

**Estado de los hallazgos heredados al cerrar la verificación de la Ola 3:**

| Id | Estado tras la Ola 3 |
|---|---|
| V-1 | **SIGUE ABIERTA.** Nada de la Ola 3 la toca. Le toca a **A4 + A12** |
| V-5 | **SIGUE ABIERTA.** Nada de la Ola 3 la toca (no hay tarifas de ICA por actividad para Bogotá ni Cali) |
| V-11 | **SIGUE ABIERTA** (la IP del cliente en la aprobación desde la bandeja). **A7 + A15** |
| D-023 / D-024 | Sin cambios: abiertas por diseño, con su alcance medido |

**Hallazgos nuevos de esta pasada:**

| Id | Qué es | Gravedad | Estado | De quién |
|---|---|---|---|---|
| V-15 | **El cierre de resultados duplicaba la cancelación si los rangos se solapan.** `idempotency_key` (`cierre:<desde>:<hasta>`) impide repetir el **mismo** ejercicio, pero no dos rangos **solapados**: como `saldosACerrar` excluye a propósito los asientos de tipo `cierre` —para poder ser repetible—, un segundo cierre de 15-jun→30-jun después de uno de 01-jun→30-jun vuelve a ver los mismos ingresos y los cancela otra vez. Medido por A14 antes del arreglo: la cuenta de ingresos quedaba con **saldo débito** y el resultado del ejercicio en **cero**; y como el ledger es inmutable, deshacerlo obliga a una reversa | **Media-alta como producto** (corrompe el resultado del ejercicio en silencio, en el escenario natural de «cerré el semestre y luego cierro el año») | **CORREGIDA por A14** (D-058): `CierreSolapadoError` rechaza el solape **antes de escribir nada**, leyendo el rango de la propia clave de idempotencia del asiento publicado. Prueba de regresión que además verifica que el intento rechazado no deja ni un borrador huérfano | era de **A10** |
| V-16 | **No existía ninguna forma de descargar un reporte.** Los veinte libros de la ola (8 de A9, 5 de A10, 7 de A11) no los invocaba ni una ruta de Next, ni una acción de servidor, ni una pantalla: **cero** importadores de `src/reports/` fuera de `tests/`. El criterio de salida dice «todo reporte **se descarga** en Excel», y la §11.1 que «un reporte que solo se ve en pantalla no sirve» — esto ni siquiera se veía en pantalla | **Alta como producto. BLOQUEÓ la Ola 3** en la primera pasada | **CERRADA por A9** (`app/api/reportes/[libro]/route.ts` + `app/reportes/page.tsx`, commit `0e28054`) y **reverificada por A14 atacando la ruta**, no leyendo el reporte: los veinte slugs sirven un `.xlsx` que se reabre con las cuatro hojas, ningún generador quedó huérfano sin slug (prueba que enumera los exports de `src/reports/` y exige que los veinte estén cableados), y la ruta resiste los nueve ataques de la tabla del veredicto | era de **A9** + **A8** |
| V-17 | **No hay forma de crear ni editar un tercero.** El esquema de A2 está bien (`third_party` tiene `direccion`, `municipality_id` y `codigo_dane`), pero no existe ni un `INSERT INTO third_party` en `src/`, `app/` ni migraciones: solo en los fixtures de prueba. A11 lo detectó como bloqueo del Formato 1001 (dirección y municipio del informado, art. 1.3.5.2.1 Res. 000227/2025); **A14 lo amplía**: como `src/services/ingest.ts` resuelve el tercero por NIT y **no lo crea**, una factura de un proveedor no cargado a mano por SQL tampoco se puede causar. Hoy no se puede poner en marcha un cliente nuevo sin acceso directo a la base | **Media-alta como producto** (impide el arranque real de una empresa cliente), **baja como riesgo** (no hay fuga ni dato inventado: A11 hizo lo correcto dejando las celdas vacías y listándolas en la hoja «Bloqueos») | **ABIERTA, declarada y medida.** No bloquea la compuerta de la Ola 3 por sí sola: el criterio en disputa es la descarga | **A8** (maestro de terceros, con dirección y municipio obligatorios o advertidos). A2 no tiene nada que corregir |
| V-18 | **Las advertencias de alcance de los formatos 1003 y 1006 no llegan al Excel.** Van en el objeto devuelto y en la cabecera del archivo plano, pero **no** en el libro, que es el que el contador revisa. El 1001 sí tiene su hoja «Bloqueos»; estos dos no tienen su hoja «Advertencias» | **Baja** (la limitación está declarada y el dato no se inventa; lo que falla es dónde se avisa) | **ABIERTA, declarada** | **A11** |
| V-19 | **Un slug igual a una clave del prototipo de `Object` no daba 404 sino 500.** `REPORTES[libro]` resolvía por la cadena de prototipos: `__proto__` devolvía un objeto truthy que no es un generador —se saltaba el 404 y reventaba abajo con un 500 que expone un mensaje interno— y `constructor` llegaba a **llamar** a `Object` como si fuera el generador. Encontrado por A14 atacando la ruta nueva con nueve slugs envenenados | **Baja**: no hay fuga (la sesión y el permiso se exigen antes y la RLS sigue puesta) ni escritura; es manejo de errores y divulgación de un mensaje interno | **CORREGIDA por A14** (D-061): `Object.hasOwn(REPORTES, libro)`. Las nueve muestras quedan como regresión, y la prueba informa **todas** las que fallen, no solo la primera | era de **A9** |
| — | **Sin estadísticas del planificador, un JOIN bajo RLS crece cuadráticamente.** Medido por A14 en PGlite: `journal_line ⋈ journal_entry` bajo RLS tarda 10 s con 2.000 partidas, 39 s con 4.000 y 159 s con 8.000; tras `ANALYZE`, **4 ms**. No es la RLS (la misma consulta sin JOIN va en 3 ms bajo RLS) ni la vista de A9: es el planificador estimando sobre tablas sin estadísticas y cayendo en bucle anidado | Muy baja en producción (autovacuum mantiene las estadísticas), **alta justo después de una carga masiva** | **Aceptada, con el número medido y anotada en la prueba** | anotación para **A15**: ANALIZAR después de una carga masiva de documentos |
| — | El archivo plano de exógena lleva líneas de cabecera que empiezan por `#` (la advertencia de layout no verificado). Ningún prevalidador de la DIAN acepta comentarios: **el archivo de hoy es un borrador de revisión, no un archivo presentable**. Es coherente con que los códigos numéricos del anexo técnico estén sin verificar (advertencia 17.5), pero conviene no confundirlo | Baja | **Aceptada mientras el layout siga sin verificar** | **A11** cuando se verifique el anexo técnico; **verificación humana** para el anexo |


---

## Compuerta del lote posterior a la Ola 3 — veredicto de A14 (2026-08-31)

**Lote verificado:** V-17 (A8, maestro de terceros), V-18 (A11, advertencias en el Excel), arranque del
sistema + repaso de la sección 14.1 (A12), datos de ejemplo (A1), entorno/ANALYZE/despliegue (A15).
Estado del repositorio al empezar: `7d6a133`, 902 pruebas.

**Veredicto: LOTE APROBADO.** Los tres criterios de compuerta pasan con las correcciones de A14
incorporadas: `npm test` **914 en verde** (45 archivos), `npm run typecheck` limpio, `npx next build`
exit 0 (19 rutas). Nada se dio por bueno por reporte ajeno: todo lo de abajo se ejecutó.

### Cómo se verificó (harness, para que se pueda repetir)

No había PostgreSQL ni Docker en la máquina. A14 levantó **PGlite servido por el protocolo de cable de
Postgres** (`@electric-sql/pglite-socket`, instalado en el scratchpad, **nunca** como dependencia del
proyecto) y apuntó `DATABASE_URL` ahí, para que los comandos —que son procesos Node distintos—
compartieran de verdad la misma base. **Limitación del adaptador, no del producto:** admite una sola
conexión a la vez, así que para recorrer las pantallas hubo que bajar temporalmente `max: 5` a `max: 1`
en `src/db/client.ts`; **ese cambio se revirtió** y no forma parte de la entrega.

### La secuencia del README, corrida como la correría el usuario

Sobre una base **vacía**, en el orden exacto del README y con los valores de ejemplo del propio README:

| Paso | Resultado |
|---|---|
| `npm run migrate` | 36 migraciones aplicadas + `ANALYZE`. Mensaje final claro |
| `npm run seed` | 19 archivos de seed. Ni un dato de demostración |
| `npm run arranque -- --firma-nit=... --firma="Mi Firma Contable SAS" ...` | Firma, empresa, usuario y acceso creados. Contraseña impresa una sola vez. **Las comillas de PowerShell/npm sobreviven**: la razón social quedó completa en la base, no truncada en la primera palabra |
| `npm run datos-ejemplo` | 5 terceros, 2 conceptos, 3 memorias y **3 facturas causadas**, las tres en borrador `pendiente_aprobacion` |
| `npm run dev` + inicio de sesión real | `/entrar` 200; `/` sin sesión → 307; con la cookie de sesión: `/`, `/bandeja`, `/terceros`, `/parametros` y `/reportes` responden **200**. La bandeja muestra las tres facturas con su valor y su estado; `/terceros` muestra los cinco terceros |
| `GET /api/reportes/libro-mayor` con sesión | **200**, `.xlsx` real de 9.869 bytes |

**Los tres asientos de ejemplo son exactamente los que A1 declaró**, verificados contra
`retention_applied` y `journal_line`, y **reproducidos idénticos** en una segunda base limpia después de
aplicar la migración de V-20:

| Factura | Retenciones | Asiento |
|---|---|---|
| Bogotá — Consultores Andinos SAS (PJ declarante) | Retefuente 4% = $40.000 · ReteIVA 15% = $28.500 | 5 partidas, saldo 0, `draft` |
| Medellín — María Fernanda Ríos (PN **no** declarante) | Retefuente **6%** = $60.000 · ReteICA 2‰ = $2.000 | 4 partidas, saldo 0, `draft` |
| Cali — Comercializadora del Pacífico SAS | **Sin retefuente** (base $80.000 < $104.748, motivo persistido y citando la norma) · ReteIVA $2.280 | 4 partidas, saldo 0, `draft` |

**Ninguno queda aprobado ni publicado.** La aprobación sigue siendo humana.

**Defecto de instructivo: ninguno bloqueante.** Dos asperezas menores, anotadas, no bloqueantes:
`--env-file-if-exists` imprime *«.env.local not found. Continuing without it.»* dos veces en cada
comando (ruido para quien no programa), y el arranque reejecutado termina diciendo «entre con ese correo
y esa contraseña» aunque en ese camino no imprimió ninguna. **La fricción real está documentada y es
correcta:** sin `DATABASE_URL` cada comando vive en su propia base desechable, y el README lo explica
con el ejemplo exacto en su sección 1.

### Los ocho puntos del encargo, uno por uno

| # | Punto | Veredicto |
|---|---|---|
| 1 | **Arranque de A12: las cuatro afirmaciones** | **CONFIRMADAS, las cuatro, atacándolas.** (a) *No crea vía de confianza nueva*: es un CLI bajo `withAdminContext`, exige la misma credencial superusuario/BYPASSRLS que `migrate`; cero superficie de red. (b) *No emite sesión ni cookie*: no hay una sola llamada a `abrirSesion` en `src/bootstrap/arranque.ts`; el usuario entra por `iniciarSesion`. (c) *Idempotente por NIT y correo*: reejecutado, «ya existía, sin tocar» en las cuatro filas. (d) *Jamás reescribe la contraseña*: reejecutado **con una contraseña intrusa** — la original sigue siendo la única válida y la intrusa es rechazada. Además: **adoptar el correo de otra firma se aborta** («un usuario nunca cambia de firma»). Y el `current_tenant_id()` sale **del token verificado**: dos firmas creadas por el mismo comando, cada sesión ve su propio tenant, y **fijar `app.tenant_id`/`app.company_id` a mano dentro de la transacción no cambia nada** (sigue viendo 1 empresa, la suya) |
| 2 | **Los dos huecos de auditoría** | **CERRADOS Y VERIFICADOS POR EL LADO HOSTIL.** Se descargó el libro mayor por HTTP y quedó **una** fila `EXPORT` en `audit_log` con reporte, empresa, usuario, `db_user`, IP, agente y parámetros. La prueba fuerte: se **revocó** `EXECUTE` sobre `app.registrar_exportacion` (a `PUBLIC` y a `app_user`) y la misma descarga devolvió **500 sin un solo byte de archivo** — «exportar sin auditar» no es un estado alcanzable, porque el rastro va en la misma transacción que la lectura. `third_party` audita: sus `INSERT` aparecen en `audit_log`. Y `app/api/reportes/[libro]/route.ts` es el **único** importador de `src/reports/` fuera de `tests/` |
| 3 | **La partición de `tercero.editar`** | **BIEN IMPUESTA, en el motor y sobre la fila resultante.** Con usuarios reales de cada rol: el auxiliar **sigue creando terceros** (V-17 no se rompió); el auxiliar es rechazado con `SE002` al registrar atributos fiscales **y** actividad; el contador registra actividad pero es rechazado al fijar `tarifa_ica_override`, **tanto por `INSERT` como por `UPDATE`** (el trigger mira `NEW.tarifa_ica_override`, no el verbo); el administrador tributario sí puede; solo lectura no puede ni crear el tercero. El reparto en `role_permission` coincide exactamente con lo declarado |
| 4 | **D-014: ningún atributo fiscal asumido** | **HUECO REAL ENCONTRADO — V-20, corregido por A14.** Las tres capas de A8 (tipo, servicio, HTML) son todas de aplicación y funcionan: el servicio rechaza con `AtributoFiscalIncompletoError`. Pero por SQL directo bajo `app_user`, con el permiso legítimo, **la base rellenaba ocho de las nueve banderas y el régimen** por `DEFAULT`. Ver la ficha de V-20 |
| 5 | **V-18: las cuatro hojas obligatorias** | **PASA.** La comprobación es de A14 y **A11 no la tocó**: los **veinte** libros, con round-trip real a `.xlsx`, siguen teniendo `['Datos','Papel de trabajo','Trazabilidad','Parámetros']` como las cuatro primeras hojas y el mismo número de hojas al releer. `activeTab` **no reordena**: solo selecciona la pestaña |
| 6 | **Los datos de ejemplo no contaminan** | **PASA.** `src/db/seed.ts` recorre `DEFAULT_SEEDS_DIR = db/seeds` y nada más; `db/demo/` solo lo lee `src/bootstrap/datos-ejemplo.ts`. Demostrado en vivo: `npm run seed` aplicó 19 seeds y **cero** terceros de ejemplo; los terceros y las facturas aparecieron solo tras `npm run datos-ejemplo`. La guarda `--forzar-agente-retencion` existe y es real: sin ella el comando no enciende `es_agente_retencion_iva/ica` de una empresa que ya tiene terceros propios |
| 7 | **El worker y el `ANALYZE`** | **PASA, verificado en vivo, no por lectura.** Se encoló una factura **sin** drenar la cola (estado `pendiente`), se levantó `npm run dev` y **el propio proceso web la procesó**: `document_processing_job.tomado_por = "web-25000"` (el patrón `web-${process.pid}` de `worker-host.ts`), estado `completado`, y el asiento nuevo apareció. El hueco que A15 describe era real y está cerrado. El `ANALYZE` de los cuatro CLI es una sentencia suelta que solo toca estadísticas del planificador: los importes de las tres facturas de ejemplo salieron **idénticos** en las dos bases |
| 8 | **El detector, reenvenenado** | **A15 NO tocó la salvaguarda** (`tests/adversarial/valores-tributarios.test.ts` no cambia desde `39603ab`, commit del propio A14) y su rediseño con enteros es legítimo. Reenvenenado contra los módulos nuevos: `src/bootstrap/` **sí lo caza** (`0.04` y `52374 * 2`, cinco reglas disparadas). `instrumentation.ts` **NO lo cazaba** → V-21, corregido por A14 |

### Vulnerabilidades de esta pasada

| Id | Qué es | Gravedad | Estado | De quién |
|---|---|---|---|---|
| V-20 | **La base de datos inventaba ocho de las nueve banderas fiscales de un tercero.** `third_party_fiscal_attribute` nació en la migración 005 con `DEFAULT false` en `es_autorretenedor_renta`, `es_gran_contribuyente`, `es_regimen_simple`, `es_responsable_iva`, `es_agente_retencion_renta/iva/ica`, `es_autorretenedor_ica`, y `DEFAULT 'ordinario'` en `regimen_tributario`. Solo `es_declarante_renta` —el caso que D-014 nombra— quedó sin valor por omisión. A14 lo comprobó por el camino que A8 no cubrió: un `INSERT` directo bajo `app_user` con el permiso legítimo `tercero.atributos_fiscales`, omitiendo ocho columnas, **grabó la vigencia con los ocho valores inventados**. `es_responsable_iva = false` suprime el ReteIVA; `es_regimen_simple = false` descarta el tratamiento del caso dorado 13 | **Media-alta.** No hay fuga ni corrupción del ledger, y las tres capas de aplicación de A8 tapan el camino de la interfaz. Lo grave es de qué clase es: es exactamente la advertencia 17.5 —«un valor inventado es peor que uno faltante: el faltante se ve, el inventado no»— pero impuesta (o no) por el motor, que es donde el proyecto pone el resto de sus invariantes | **CORREGIDA por A14** (`160_a14_v20_atributos_fiscales_sin_default.sql`): se quita el `DEFAULT` de las diez columnas; siguen `NOT NULL`, así que omitir una falla con `23502` en vez de suponer. **12 pruebas de regresión** en `tests/adversarial/evasion.test.ts`: una por columna omitida (todas rechazadas por PostgreSQL, no por TypeScript), el barrido del catálogo, y el control positivo de que declarándolas todas el `INSERT` pasa. Las tres llamadas de prueba que se apoyaban en el `DEFAULT` ahora declaran las nueve **a la vista** | el `DEFAULT` era de **A2** (mig. 005); la afirmación de «tres capas» era de **A8** |
| V-21 | **El detector de la Regla de Oro 2 no barría el código ejecutable de la raíz del repositorio.** `DIRECTORIOS = ['src','app','db/migrations']` dejaba fuera todo archivo `.ts`/`.mjs` de la raíz. Hasta este lote no había ninguno; A15 introdujo el primero (`instrumentation.ts`, el hook que Next.js ejecuta en cada arranque del servidor) y `next.config.*` entra por la misma puerta. Demostrado envenenando `instrumentation.ts` con `const TARIFA_SERVICIOS = 0.04` y `const UVT_2026 = 5237400`: **el detector no vio nada** | **Baja hoy** (no hay ningún valor tributario ahí), **alta como infraestructura**: una salvaguarda con un punto ciego deja de avisar exactamente donde nadie mira | **CORREGIDA por A14**: `recolectarRaiz()` barre la raíz sin recursión, saltando ocultos y `next-env.d.ts`. Verificado reenvenenando: ahora **sí** lo caza (tres hallazgos, cinco reglas), y limpio vuelve a 42/42. Se añadió la aserción de cobertura `expect(...).toContain('instrumentation.ts')`, para que sacarlo del barrido tumbe la prueba | infraestructura de QA de **A14**; el punto ciego lo destapó **A15** |
| V-22 | **`npm run dev` reescribe `CLAUDE.md`.** Next.js 16 inyecta por su cuenta un bloque `BEGIN:nextjs-agent-rules` dentro de `CLAUDE.md` en cada arranque del servidor de desarrollo (`node_modules/next/dist/server/lib/generate-agent-files.js`) y el texto que inserta **invita a comitearlo**. `CLAUDE.md` es el archivo de reglas del proyecto: que una dependencia lo modifique sola es una escritura no pedida sobre la fuente de instrucciones, y además le ensucia el `git status` a quien sigue el paso 2.7 del README sin saber programar. A15 lo detectó y lo revirtió a mano, pero no lo desactivó | **Baja como riesgo técnico**, **no despreciable como integridad**: el contenido de `CLAUDE.md` deja de estar bajo control de quien lo escribió | **CORREGIDA por A14**: `next.config.ts` con `agentRules: false`, comentado con el motivo. Verificado: `npm run dev` con esa configuración deja `CLAUDE.md` **intacto** (`git status` limpio) y `npx next build` sigue en exit 0 | era de **A15** |

### Observaciones que NO son vulnerabilidades, pero quedan asignadas

- **`company.es_agente_retencion_renta` nace en `true` y las de IVA/ICA en `false`** (defecto del esquema
  002, hallazgo que **A1 dejó anotado** y no tocó). Es una postura tributaria asumida para una empresa
  recién creada. A14 **no lo corrige** aquí porque, a diferencia de los atributos del tercero, es
  configuración de la propia empresa que el operador conoce; pero es la misma familia que V-20 y merece
  decisión explícita. **A2 + A12.**
- **`app.registrar_exportacion` conserva el `EXECUTE` de `PUBLIC`** que Postgres otorga al crear la
  función (la migración 140 solo añadió el `GRANT` a `app_user`). No es una elevación —la función no es
  `SECURITY DEFINER` y exige `reporte.exportar` dentro— y es el mismo patrón que ya tienen
  `app.exigir_permiso` y `app.registrar_acceso_denegado`, pero se aparta del `REVOKE ALL ... FROM PUBLIC`
  con el que se blindó `app.abrir_sesion`. **A12**, si quiere uniformar la higiene.
- **`datos-ejemplo` abre una sesión real del administrador** (`abrirSesion`, 8 h) para escribir bajo RLS
  en vez de por `withAdminContext`, lo cual es **lo correcto**; pero esa sesión queda viva y no se
  revoca al terminar el comando. Sin consecuencia práctica (el token muere con el proceso y la base solo
  guarda su `sha256`). **A1**, si quiere cerrarla al salir.
- **Nada impide que un seed de demostración acabe en `db/seeds/`.** La separación de A1 es correcta por
  construcción, pero no hay una prueba que la ate como sí la hay para «los seeds son datos, no código».
  **A14** en una pasada futura.

### Los 20 casos dorados, uno por uno (reejecución de esta pasada)

Ejecutados **todos**, no una muestra: `tests/golden/casos-dorados.test.ts` (26 pruebas: los 20 casos más
seis variantes hostiles) + `tests/golden/caso19-memoria.test.ts` (8 pruebas) = **34 en verde, cero
fallos**, más las 42 del detector de la Regla 2. Los casos 1, 2, 3, 8, 15, 17, 18 y 20 se reverificaron
**además** contra un PostgreSQL real, fuera del harness de pruebas.

| # | Veredicto de esta pasada | Evidencia |
|---|---|---|
| 1 | **PASA** | Retefuente $40.000 + ReteIVA $28.500. **Reproducido fuera del harness**: es la factura de Bogotá de los datos de ejemplo, con las mismas cifras al centavo en dos bases limpias distintas |
| 2 | **PASA** | Retefuente **6%** = $60.000 con `tax_rule_id` distinta. **Reproducido fuera del harness** (María Fernanda Ríos, PN no declarante) |
| 3 | **PASA** | No retiene bajo $104.748 y el motivo queda escrito. **Reproducido fuera del harness**: la factura de Cali persiste el motivo citando el Decreto 572/2025 y la base mínima en UVT y en pesos |
| 4 | **PASA** | No retiene bajo $523.740, con motivo persistido |
| 5 | **PASA** | $15.000, auditado contra su fila de `tax_rule` |
| 6 | **PASA** | $22.000 desde el primer peso, con base mínima 0 **como dato**, no como excepción de código |
| 7 | **PASA** | Inmueble no retiene; mueble por el mismo valor sí ($16.000) |
| 8 | **PASA** | ReteICA 2‰ en Medellín. **Reproducido fuera del harness**: $2.000 sobre $1.000.000, norma «Acuerdo 066 de 2017 (Medellín)» |
| 9 | **PASA en lo que discrimina** | Base de servicios de Cali $157.122 frente a $785.610 de Medellín. La magnitud de la tarifa por actividad sigue en **V-5** (dato normativo faltante, no inventado) |
| 10 | **PASA** | Aplica la actividad ejercida **en Cali**, no la de Bogotá; más la variante de dos actividades en el mismo municipio |
| 11 | **PASA** | La base es el **AIU** ($500.000), no el total |
| 12 | **PASA** | ReteIVA al 100%; y sin regla de exterior parametrizada el motor manda a revisión en vez de inventar |
| 13 | **PASA** | Régimen SIMPLE: sin política parametrizada el motor **no decide** |
| 14 | **PASA** | Retención por concepto y agregada; trocear un concepto en dos líneas **no** esquiva la base mínima |
| 15 | **PASA** | Reversa proporcional por asiento nuevo. **Reforzado fuera del harness**: sobre un asiento publicado de verdad, `UPDATE`, `DELETE`, `UPDATE`/`DELETE`/`INSERT` de partidas y `TRUNCATE` fallan todos con `LG001`, y el asiento queda idéntico (4 partidas, saldo 0, descripción intacta) |
| 16 | **PASA** | Manda la fecha del hecho económico, con el borde exacto 30-jun / 1-jul |
| 17 | **PASA** | Cambio de tarifa con vigencia futura: lo publicado no cambia y lo nuevo usa la tarifa nueva. Ningún módulo de este lote reabre la puerta: los reportes son de solo lectura y el arranque y los datos de ejemplo no escriben en `tax_rule` |
| 18 | **PASA** | Diez pasadas de la cola, un solo asiento, la misma fotografía las diez. **Reforzado fuera del harness**: reingerir el mismo XML no crea un segundo documento (deduplicación por hash/CUFE) |
| 19 | **PASA** | Segunda factura del mismo proveedor con la misma descripción escrita distinta → `origen = 'memoria'`, **`llamadasLlm = 0`**, `costoMicrosUsd = 0`, la mina de D-052 intacta y `globalThis.fetch` sin una sola llamada. Con **otro** proveedor sí vuelve a preguntar: la memoria no se contagia |
| 20 | **PASA** | **Reverificado fuera del harness con dos firmas creadas por el arranque**: desde la sesión de la firma A, `company`, `tenant`, `third_party`, `journal_entry`, `journal_line`, `source_document`, `audit_log`, `retention_applied`, `approval`, `"user"` y `user_company_access` devuelven **solo lo propio**; la empresa de B por id → **0 filas**; asientos de otro tenant → **0 filas**; pedir la empresa de B como `companyId` → `EmpresaNoAutorizadaError` con rastro `ACCESO_DENEGADO`; y **fijar `app.tenant_id`/`app.company_id` a mano dentro de la transacción no mueve una sola fila** |

**Pruebas adicionales de integridad de la §12, reejecutadas contra PostgreSQL real:**

| Prueba | Resultado |
|---|---|
| Grep de literales con pinta de tarifa o UVT en el código fuente | **Cero hallazgos** en `src`, `app`, `db/migrations` **y ahora la raíz** (42 pruebas del detector). Verificado que el detector sigue vivo inyectando veneno en dos módulos nuevos |
| `UPDATE`/`DELETE` sobre asiento publicado | **Falla en la BD** (`LG001`), en las cinco variantes, incluido `TRUNCATE` |
| Inserción de asiento desbalanceado | **Falla en la BD** (`LG002`, «descuadra en 1 centavos») al publicar; nada persiste |
| Consulta de un tenant desde la sesión de otro | **Cero filas**, por RLS, en las once tablas probadas |
| Reprocesar la misma factura 10 veces | Asiento **idéntico** las diez |
| Cambiar una tarifa en parametrización | No altera asientos publicados; sí aplica a hechos posteriores a la nueva vigencia |
| Segunda factura del mismo proveedor con la misma descripción | **Cero llamadas al LLM** |

### Hallazgos heredados: estado tras este lote

| Id | Estado |
|---|---|
| V-1 | **CERRADA** desde `19237ec` (revocado el GRANT de más sobre `resolver_empresa_por_buzon`). No se reabrió |
| V-5 | **SIGUE ABIERTA.** Faltan las tarifas de ReteICA por actividad de Bogotá y Cali. A1 hizo lo correcto: no las inventó, y los datos de ejemplo **no** encienden ReteICA en esos dos municipios para no simular un cálculo que no existe. **Verificación normativa humana** |
| V-11 | **SIGUE ABIERTA** (la IP del cliente en la aprobación desde la bandeja). **A7 + A15** |
| V-17 | **CERRADA por A8** y verificada por A14 (crear y editar tercero desde `/terceros`, con dirección y municipio exigidos). La afirmación de «tres capas independientes» era falsa en la capa que faltaba: ver **V-20** |
| V-18 | **CERRADA por A11** y verificada por A14: las cuatro hojas obligatorias siguen siendo las cuatro primeras en los veinte libros y `activeTab` no reordena nada |
| D-023 / D-024 | Sin cambios: abiertas por diseño, con su alcance medido |
| MFA sin pantalla de inscripción · prueba de restauración de respaldos · simulacro de incidente · revisión jurídica | **Siguen pendientes**, tal como A12 las declaró. **A12** (interfaz de MFA), **A15** (restauración), **verificación humana** (jurídico) |

---

## Convenciones establecidas

**Estructura de carpetas**

```
db/migrations/NNN_nombre.sql   Migraciones SQL numeradas, inmutables una vez aplicadas
db/seeds/                      Datos paramétricos (A1). Datos, nunca código
db/demo/                       Datos de EJEMPLO (A1). NUNCA los carga `npm run seed`; solo `npm run datos-ejemplo`
src/bootstrap/                 Arranque del sistema y datos de ejemplo (A12/A1). Solo CLI, nunca HTTP
src/domain/                    Motor de reglas, tipos de dominio. Sin I/O
src/services/                  Casos de uso y transacciones (A6)
src/ingest/                    Correo + parser UBL 2.1 (A4)
src/ai/                        Clasificación LLM + memoria (A5)
src/reports/                   Libros, Excel, estados financieros, exógena (A9/A10/A11)
src/db/                        Cliente, runner de migraciones, contexto de sesion (A2 + A12)
src/auth/                      Contrasenas, TOTP, cifrado, sesiones, permisos (A12)
app/                           Next.js App Router: UI y route handlers
instrumentation.ts             Hook de arranque de Next: lanza el worker de la cola (A15)
next.config.ts                 Configuración de Next. Hoy solo `agentRules: false` (V-22)
tests/                         Vitest. tests/golden/ = los 20 casos dorados
docs/                          Cumplimiento, ADRs, contratos de API
```

**Reglas de código**

- Idioma: identificadores de dominio en español donde el mega-prompt los nombra en español; el resto en inglés. Comentarios y UI en español (Colombia).
- SQL en snake_case. TypeScript en camelCase, tipos en PascalCase.
- Toda tabla de datos: `tenant_id` NOT NULL + `company_id` NOT NULL (salvo catálogos globales, que se declaran explícitamente como globales), RLS habilitado **y forzado**.
- Toda tabla paramétrica: `vigente_desde DATE NOT NULL`, `vigente_hasta DATE NULL`, `norma_respaldo TEXT NOT NULL`.
- Prohibido: literales numéricos tributarios en `src/` y `app/`. A14 hace grep. La única constante permitida es la lógica de resolución.
- Migraciones ya aplicadas no se editan: se agrega una nueva. El runner guarda el checksum y aborta si cambia.
- **`src/reports/` es de SOLO LECTURA sobre el ledger** (invariante de la Ola 3, verificado por A14): generar los veinte libros deja `journal_entry`, `journal_line`, `retention_applied`, `approval` y `source_document` con la misma huella exacta. Lo que escribe vive en `src/services/` (hoy, `cierre.ts`), porque escribir es un caso de uso. Si un reporte necesita escribir, no es un reporte.
- **Todo módulo nuevo de `src/` necesita un consumidor fuera de `tests/`.** El canario de inventario de A14 comprueba que el módulo está declarado, no que alguien lo use; un `grep` de importadores es lo que separa «entregado» de «alcanzable» (V-16).

**Inventario de tablas (creadas por A2 en la Ola 0)**

| Migración | Tablas |
|---|---|
| `001_fundacion.sql` | (esquema `app`, rol `app_user`, funciones de contexto y triggers genéricos) |
| `002_organizacion.sql` | `tenant`, `company`, `fiscal_period`, `"user"`, `user_session`, `permission`, `role`, `role_permission`, `user_company_access` |
| `003_catalogos_contables.sql` | `account`, `niif_mapping`, `cost_center` |
| `004_parametrizacion_base.sql` | `municipality`, `municipality_ica_rule`, `ciiu_activity`, `uvt_value`, `smmlv_value`, `rounding_rule` |
| `005_terceros.sql` | `third_party`, `third_party_fiscal_attribute`, `third_party_activity` |
| `006_reglas_tributarias.sql` | `tax_concept`, `tax_rule`, `tax_calendar` |
| `007_conceptos.sql` | `concepto_causacion`, `memoria_clasificacion`, `company_setting` |
| `008_documentos.sql` | `source_document` (+ espacio RADIAN), `extraction`, `retention_applied` |
| `009_control.sql` | `approval`, `audit_log` (+ trigger genérico de auditoría) |
| `010_ledger.sql` | `journal_entry`, `journal_line` (+ triggers de inmutabilidad y balance, `app.publicar_asiento`) |
| `011_vistas.sql` | `v_journal_entry`, `v_journal_entry_balance`, `v_third_party_vigente`, `v_user_permission` |
| `012_rls.sql` | políticas RLS de doble nivel sobre todas las tablas |
| `013_grants.sql` | privilegios de `app_user` |
| `014_roles_permisos_base.sql` | los 25 permisos y los 5 roles de la sección 14.1 |

Añadidas por **A12** (seguridad):

| Migración | Contenido |
|---|---|
| `015_sesiones_contexto_verificado.sql` | rol `app_auth`; `app.session_context`, `app.usuario`, `app.acceso_usuario_empresa` (esquema `app`, sin RLS y sin GRANTs); redefinición de `current_tenant_id/company_id/user_id`; `abrir_sesion`, `cerrar_sesion`, `revocar_sesiones_de_usuario`, `buscar_credencial`, `registrar_login_fallido`; columnas de credencial y bloqueo en `"user"` |
| `016_permisos_y_auditoria_sensible.sql` | `tiene_permiso` / `exigir_permiso` y los triggers de permiso en 31 tablas; auditoría de ledger, período, empresa y usuario (con credenciales redactadas); `registrar_acceso_denegado` y `exigir_empresa` |
| `017_a14_cierre_vulnerabilidades.sql` | **A14** — cierre de D-030 (`revocar_sesiones_de_usuario` ignoraba el tenant) y D-031 (`app_auth` forjaba auditoría en cualquier firma) |
| `018_a2_alcance_fk_y_truncate.sql` | **A2** — cierre de D-032 y D-033 (ver D-037): 18 FK compuestas de alcance, el guardia genérico `app.trg_fk_alcance` sobre 53 columnas en 21 tablas, y `BEFORE TRUNCATE` en el ledger, `audit_log`, `approval` y `retention_applied` |

Tablas añadidas sobre la sección 15, con su justificación en las decisiones D-013, D-014 y D-020:
`tax_concept`, `municipality_ica_rule`, `third_party_fiscal_attribute`, `permission`, `role_permission`,
`user_session`, `company_setting`, `schema_migration`.
Tablas del esquema `app` (no son datos de negocio; ver D-021 y D-026): `app.session_context`,
`app.usuario`, `app.acceso_usuario_empresa`. **Ningún rol de aplicación tiene privilegio sobre ellas**,
y hay una prueba que recorre el catálogo para confirmarlo.

**Cómo se escriben las pruebas (harness de A2, ampliado por A12, para todos los agentes)**

```ts
import { createTestDb, esperarErrorPg, uuid } from '../helpers/db.js';
import { crearEscenario, crearAsientoBorrador, publicarAsiento } from '../helpers/fixtures.js';

const db = await createTestDb();              // PGlite, o DATABASE_URL si existe
const e  = await crearEscenario(db);          // firma + empresa + usuario + período + PUC + tercero + documento + aprobación
await db.asAdmin(tx => ...);                  // superusuario: SOLO para montar datos
await db.asTenant(e.tenantId, e.companyId, tx => ...);  // app_user, RLS activa, SESIÓN REAL emitida
await esperarErrorPg(() => ..., SQLSTATE.LEDGER_INMUTABLE, 'descripción');
```

- Toda prueba de aislamiento o de integridad corre dentro de `asTenant`. Dentro de `asAdmin` se es superusuario y el motor **ignora RLS**: probar aislamiento ahí es un falso PASS.
- `esperarErrorPg` falla si el error no es de PostgreSQL o si el SQLSTATE no coincide. Un `throw` de TypeScript no demuestra nada.
- Los `bigint` vuelven como número o `BigInt` y los `numeric` como string: en las aserciones use `columna::text`.
- Escribir en catálogos globales (`tenant_id IS NULL`) exige `asAdmin`.

**Cambios de A12 en el harness (la firma de `asTenant` no cambió):**

- `asTenant` ya **no fija `app.tenant_id`**: emite una sesión real con `app.abrir_sesion` y presenta
  su token. El tenant lo deriva la base (D-021). Fijar `app.tenant_id` a mano no hace nada.
- La sesión usa por defecto el rol de negocio **`admin_firma`**, para que las pruebas que no tratan
  sobre permisos no tengan que declararlos.
- Para probar permisos: `asTenant(t, c, fn, { rolCodigo: 'auxiliar_causacion' })`. Cada rol recibe su
  **propio usuario técnico**, para que los permisos no se acumulen y una prueba de "no puede X" no
  pase por accidente.
- `db.emitirSesion(t, c, opts)` devuelve `{ token, userId, sessionId }` sin ejecutar nada, para las
  pruebas que necesitan manipular la sesión.
- Fixture nuevo: `crearUsuarioConCredencial(db, tenantId, { password, conMfa, claveCifrado, roleId,
  companyId, estado })`, que devuelve la contraseña y el secreto TOTP en claro para la prueba.
- Errores de dominio nuevos: `SQLSTATE.SESION_INVALIDA` (SE001), `PERMISO_INSUFICIENTE` (SE002),
  `EMPRESA_NO_AUTORIZADA` (SE003).

**Comandos**

- `npm test` — suite completa (Vitest + PGlite)
- `npm run test:gates` — solo compuertas de aceptación por ola
- `npm run migrate` — aplica migraciones pendientes

---

## Casos dorados — VEREDICTO REAL, uno por uno (A14, compuerta de la Ola 1)

**Ya no hay ni un `todo`.** En la Ola 0 los veinte estaban enumerados como `todo` porque no existía
motor, ni datos, ni parser. En la Ola 1 existen las tres piezas y A14 los resolvió a veredicto real
con **suite propia**, no aceptando la de A3:

- `tests/adversarial/casos-dorados.test.ts` — los que se resuelven contra el motor. Cada retención se
  **audita contra la fila de `tax_rule` que ella misma dice haber usado**: la tarifa reportada tiene que
  ser la de la fila, la cuenta la de la fila, la vigencia tiene que cubrir la fecha del hecho, y el valor
  tiene que coincidir con `base × tarifa` **recalculado en SQL por PostgreSQL**, no con la aritmética del
  propio motor. Si el motor mintiera sobre la regla que usó, esta suite lo ve.
- `tests/adversarial/compuerta-ola1.test.ts` — los cuatro que solo existen de verdad **al nivel del
  asiento** (15, 17, 18, 20), más el pipeline completo de punta a punta.
- `tests/golden/casos-dorados.test.ts` — la suite de A3, que se conserva: 25 pruebas que cubren el
  detalle del motor. A14 la auditó línea por línea; no la sustituye ni la reemplaza.

**Los valores esperados de la sección 12 están escritos como literales en las pruebas de A14**
($40.000, $28.500, $60.000, $15.000, $22.000, $16.000, $10.000, $190.000, $2.000, $104.748, $523.740,
$785.610, $157.122). No salen de ninguna tabla: son la afirmación que la suite defiende.

| # | Escenario | Veredicto | Cómo lo verificó A14 |
|---|---|---|---|
| 1 | Servicio $1.000.000 + IVA 19%, PJ declarante, Bogotá | **PASA** en retefuente y ReteIVA; la pata de ReteICA **de Bogotá** sigue sin datos (V-5) | Retefuente **$40.000** y ReteIVA **$28.500 sobre los $190.000 de IVA** (no sobre la base), ambos auditados contra su fila de `tax_rule` y recalculados en SQL. Y **de punta a punta con el repositorio tal como está**, sin que ninguna prueba inserte un parámetro: el caso entra por la cola, sale como asiento balanceado (débito gasto $1.000.000 + IVA $190.000; crédito 2365 $40.000, 2367 $28.500, proveedores $1.121.500) y **se publica**. La ReteICA de Bogotá va por actividad y su tarifa no se puede guardar todavía (V-5): el motor **se niega a inventarla**, que es la conducta correcta |
| 2 | Mismo servicio, PN **no declarante** → 6% | **PASA** | **$60.000**. Y se comprueba que la `tax_rule_id` aplicada es **otra fila distinta** de la del declarante: si fuera la misma, el eje "tercero" no existiría |
| 3 | Servicio $80.000 (bajo 2 UVT) | **PASA** | No retiene, con motivo. El umbral **no está en el código**: A14 lo recalcula desde `base_minima_uvt × UVT vigente` y comprueba que da exactamente **$104.748**. La evaluación negativa se **persiste** en `retention_applied` y se relee |
| 4 | Compra $500.000 (bajo 10 UVT) | **PASA** | No retiene, con motivo. Umbral recalculado desde la base: **$523.740** |
| 5 | Compra $600.000 a declarante | **PASA** | **$15.000**, auditado contra la fila (2,5%) |
| 6 | Honorarios PJ $200.000 | **PASA** | **$22.000**. Y "desde el primer peso" es un **dato**, no una excepción del código: la regla trae base mínima 0, comprobado en la fila |
| 7 | Arrendamiento inmueble vs. mueble, $400.000 | **PASA** | El inmueble no retiene (bajo 10 UVT); el mueble por el mismo valor retiene **$16.000**. Dos reglas distintas, mismo importe, mismo día |
| 8 | Servicio en Medellín → ReteICA 2‰, base 15 UVT | **PASA SIN ANDAMIAJE** (era el caso que bloqueaba la ola) | Con los seeds del repositorio y **sin que ninguna prueba inserte una regla**: $1.000.000 de servicio en Medellín produce **$2.000** de ReteICA, el asiento cuadra y **se publica**, `ciiu_activity_id` queda **nulo** (Medellín no va por actividad) y la traza cita **«Acuerdo 066 de 2017»** — la cadena de norma no perdió el origen al copiarse. La base mínima recalculada desde `municipality_ica_rule` da **$785.610**, el valor de la sección 12, y por debajo de ella no retiene |
| 9 | Mismo servicio en Cali → base servicios 3 UVT | **PASA en lo que el caso discrimina; la magnitud de la tarifa sigue sobre andamiaje** (V-5, D-048) | $200.000 **sí** retiene en Cali y **no** en Medellín: mismo importe, mismo tercero, mismo día, solo cambia el municipio. La base de Cali recalculada desde la fila real de A1 da **$157.122** y la de Medellín **$785.610**: **eso** es lo que el caso discrimina y está verificado con datos reales. La tarifa por actividad de Cali no existe y el mega-prompt no la trae |
| 10 | Principal en Bogotá, secundaria en Cali, operación en Cali | **PASA en lo que el caso discrimina; la magnitud de la tarifa sigue sobre andamiaje** (V-5, D-048) | La retención sale con la actividad **de Cali**, no con la principal de Bogotá, y con el municipio de Cali. Es exactamente lo que el caso pone a prueba, y no depende de cuánto valga la tarifa |
| 11 | Vigilancia $5.000.000 con AIU $500.000 | **PASA en el motor. NO se puede disparar por el canal de ingest** | La base es **$500.000**, no $5.000.000, y la retención **$10.000**. Sin AIU declarado el motor **no lo deduce** del total: `concepto_aiu_sin_aiu_declarado`. Limitación declarada: el parser de A4 no discrimina AIU por línea, así que por `recibirDocumento` el caso siempre va a revisión manual (V-7) |
| 12 | Proveedor del exterior → ReteIVA 100% | **PASA** | **$190.000**, el 100% del IVA, con norma que cita el **art. 437-2**. Y no es "la misma regla al tope": es **otra fila** — el mismo concepto con proveedor nacional da $28.500 |
| 13 | Régimen SIMPLE | **PASA** | Sin política parametrizada el motor **no decide**: `regimen_simple_sin_politica_parametrizada` y cero agregados. Con la política puesta como dato en `company_setting`: no retefuente (con su motivo), sí ReteIVA $28.500. Un tercero ordinario no se ve afectado |
| 14 | Factura con 3 líneas de conceptos distintos | **PASA** | $40.000 + $15.000 + $22.000 = **$77.000**; **tres** agregados con **tres** `tax_rule_id` distintos contra **una sola** cuenta. Las tres retenciones auditadas contra sus filas. Variante hostil de A14: **trocear un concepto en dos líneas no esquiva la base mínima** (dos líneas de $300.000 se agregan a $600.000 y retienen) |
| 15 | Nota crédito sobre factura causada | **PASA, y al nivel del asiento** | A3 lo prueba en la traza; A14 lo prueba en el **ledger**: se causa, se **publica**, se reversa, y el asiento original queda **idéntico byte a byte** (`to_jsonb` del asiento + todas sus partidas). La reversa es un asiento **nuevo** que suma **cero** con el original. Y **no se puede reversar dos veces**: `journal_entry_reversa_uq` lo rechaza con `23505` |
| 16 | Factura 15-jun-2026 procesada 20-jul-2026 | **PASA** | Mismo motor, misma hora de reloj, dos fechas de hecho: julio da $40.000 y junio da **cero con motivo**, porque A1 **no inventó** la tarifa anterior al decreto. Que lo que falla es la vigencia y no la fecha se prueba con honorarios, que sí estaba vigente en junio ($22.000, auditado contra la fila con fecha de junio). Y el **borde exacto**: 30-jun no resuelve, 1-jul sí. La UVT también se resuelve por la fecha del hecho (2025 vs. 2026) |
| 17 | Cambio de tarifa con vigencia futura | **PASA, en las dos mitades** | (a) La vigencia anterior se cierra e inserta una nueva **sin tocar código ni redesplegar**: la resolución de un hecho pasado sigue dando la tarifa vieja y la de un hecho posterior da la nueva. (b) La traza ya registrada en `retention_applied` queda **idéntica byte a byte**. (c) Repetido con la **UVT**, que es el parámetro más transversal: el umbral se mueve solo para los hechos posteriores |
| 18 | Reprocesar 10 veces la misma factura | **PASA, y al nivel del asiento** | Diez pasadas de la cola sobre la misma factura: **un solo** `journal_entry`, **idéntico byte a byte** tras las diez, y las nueve repeticiones devuelven `ya_procesado`. Encolar diez veces deja **un solo** trabajo. Y la garantía **no es el `if` de TypeScript**: saltándose el servicio, insertar un segundo asiento con la misma `idempotency_key` lo rechaza `journal_entry_idem_uq` con `23505` |
| 19 | Segunda factura igual → cero llamadas al LLM | **PARCIAL, y declarado como tal** | La mitad que existe hoy está **verde**: barrido de **todo** `src/` sin `fetch`, `node:http(s)`, `axios`, `openai`, `anthropic` ni `@ai-sdk` — no hay con qué llamar a un LLM; la segunda factura del mismo proveedor con la misma descripción se causa entera resolviendo el concepto desde `memoria_clasificacion`, sin crear ninguna fila nueva; y dos resoluciones seguidas dan la misma huella. **La otra mitad no se puede verificar y no se finge: no hay LLM que contar hasta que A5 lo construya en la Ola 2** |
| 20 | Tenant A consulta datos del tenant B | **PASA** | Ya probado en la Ola 0 por catálogo; **reverificado sobre las nueve tablas que estrena la Ola 1** (`document_processing_job`, `source_document`, `extraction`, `retention_applied`, `memoria_clasificacion`, `email_ingest_log`, `journal_entry`, `journal_line`, `concepto_causacion`): cero filas ajenas desde una sesión real, con y sin `WHERE`. Y la firma B **no puede** encolar, completar, reclamar ni aprobar nada de la firma A (`42501`), ni aunque conozca sus identificadores |

**Pruebas adicionales de integridad (sección 12, final):**

| Prueba | Estado |
|---|---|
| Grep de literales tributarios en código → cero | **PASA, con detector reforzado.** `tests/adversarial/valores-tributarios.test.ts`: **siete** reglas (antes seis), 32 pruebas. **Cero hallazgos** en `src/`, `app/` y `db/migrations/`. Ver D-038 (exención de escalas, ganada contra el esquema), D-039 (por qué `db/seeds` se excluye y qué se comprueba a cambio) y D-040 (hueco real que encontró el canario) |
| UPDATE/DELETE sobre asiento publicado → falla en BD | **PASA, reverificado sobre lo que construyó la Ola 1.** Ocho vectores sobre un asiento publicado **por el pipeline de A6**: UPDATE idempotente, des-publicar, DELETE del asiento, UPDATE/DELETE/INSERT de partidas, y UPDATE y DELETE **masivos sin WHERE**. Los ocho: `LG001`. Fotografía byte a byte idéntica al final |
| Asiento desbalanceado → falla en BD | **PASA**, `LG002` en el COMMIT, con el descuadre de **un centavo** sobre el escenario real de A6 |
| Reprocesar la misma factura 10 veces → asiento idéntico | **PASA** (caso 18) |
| Un cambio de parámetro no altera lo publicado | **PASA** (caso 17) |
| Balance de prueba vs. ledger con 10.000 asientos | no implementado todavía — A9 + A14, Ola 3 |
| Carga: 5.000 facturas en cola sin degradar el request HTTP | no implementado todavía — A6 + A13 + A15, Ola 2 |

---

## Casos dorados — VEREDICTO DE LA OLA 2 (A14), uno por uno

Los veinte se **volvieron a ejecutar completos** en esta pasada, no una muestra: las dos suites
(`tests/adversarial/casos-dorados.test.ts` y `tests/golden/casos-dorados.test.ts`) más
`tests/golden/caso19-memoria.test.ts` y las dos suites nuevas de la compuerta de la Ola 2. El detalle de
**cómo** se verificó cada uno en la Ola 1 sigue en la tabla de arriba y no se repite; aquí va el
veredicto de HOY y lo que cambió.

| # | Veredicto Ola 2 | Qué pasó en esta pasada |
|---|---|---|
| 1 | **PASA** (sin cambios) | Reejecutado. Retefuente $40.000 y ReteIVA $28.500; la pata de ReteICA de Bogotá sigue sin datos (V-5) |
| 2 | **PASA** (sin cambios) | Reejecutado. $60.000, con `tax_rule_id` distinta de la del declarante |
| 3 | **PASA** (sin cambios) | Reejecutado. No retiene bajo $104.748, con motivo persistido |
| 4 | **PASA** (sin cambios) | Reejecutado. No retiene bajo $523.740, con motivo |
| 5 | **PASA** (sin cambios) | Reejecutado. $15.000 auditado contra su fila |
| 6 | **PASA** (sin cambios) | Reejecutado. $22.000 desde el primer peso, con base mínima 0 **como dato** |
| 7 | **PASA** (sin cambios) | Reejecutado. Inmueble no retiene, mueble $16.000 |
| 8 | **PASA** (sin cambios) | Reejecutado sin andamiaje: $2.000 de ReteICA en Medellín con los seeds del repositorio |
| 9 | **PASA en lo que discrimina** (sin cambios) | Reejecutado. La base de Cali ($157.122) frente a la de Medellín ($785.610). La magnitud de la tarifa por actividad sigue en V-5 |
| 10 | **PASA en lo que discrimina**, y ahora **también por el canal real** | Reejecutado en el motor. Además, **V-8 cerrada por A7**: `document_correction` deja capturar el municipio de la operación y el reproceso causa con la tarifa real de Medellín |
| 11 | **PASA en el motor**, y ahora **también por el canal real** | Reejecutado. Además, **V-7 cerrada por A7**: sin AIU va a revisión manual; capturado el AIU por línea y reencolado, causa sobre el AIU |
| 12 | **PASA** (sin cambios) | Reejecutado. ReteIVA al 100% = $190.000, con norma que cita el art. 437-2 |
| 13 | **PASA** (sin cambios) | Reejecutado. Sin política parametrizada el motor no decide; con ella, tratamiento diferenciado |
| 14 | **PASA** (sin cambios) | Reejecutado, incluida la variante hostil de trocear un concepto en dos líneas |
| 15 | **PASA** (sin cambios) | Reejecutado. Reversa por asiento nuevo; el original idéntico byte a byte; doble reversa rechazada por `23505` |
| 16 | **PASA** (sin cambios) | Reejecutado. Manda la fecha del hecho, con el borde exacto 30-jun / 1-jul |
| 17 | **PASA, y ahora POR LA INTERFAZ** | Reejecutado en el motor. **Nuevo:** A14 lo repite enviando el `FormData` de la acción de servidor de A8 (`guardarUvtAction`): la vigencia anterior conserva su valor y solo se le cierra la fecha (`vigente_hasta = 2026-12-31`), la nueva rige desde 2027-01-01, la resolución por fecha del hecho devuelve la vieja para junio-2026 y la nueva para enero-2027, y la **fotografía de todo lo publicado en la firma es idéntica byte a byte antes y después** |
| 18 | **PASA, reverificado con escenario propio de la Ola 2** | Diez pasadas de la cola sobre la misma factura: **un solo** `journal_entry`, y la fotografía del asiento con todas sus partidas es **la misma en las diez** (`new Set(fotos).size === 1`), no solo el mismo `id` |
| 19 | **PASA — dejó de ser PARCIAL.** Era el único que la Ola 1 no pudo cerrar | Cerrado con **mina y espía**, no con contador ajeno (D-052): un `ProveedorLlm` que revienta si lo llaman y un espía sobre `globalThis.fetch`. Segunda factura del mismo proveedor con la misma descripción escrita distinta → `origen = 'memoria'`, `llamadasLlm = 0`, `costoMicrosUsd = 0`, la mina intacta y el espía sin una sola llamada. Y **con `proveedor: null`** —sin ningún LLM configurado— sigue clasificando |
| 20 | **PASA, reverificado sobre las tablas que estrena la Ola 2** | Cero filas ajenas desde una sesión real, con consulta **sin filtro de tenant**, sobre `memoria_clasificacion`, `document_correction`, `integration_call_log`, `parametro_clasificacion`, `concepto_causacion` y `clasificacion_pendiente` |

**Pruebas adicionales de integridad, estado tras la Ola 2:**

| Prueba | Estado |
|---|---|
| Grep de literales tributarios en código → cero | **PASA, con el detector REFORZADO otra vez.** Cero hallazgos en `src/`, `app/` y `db/migrations/`. Ahora son **ocho** comprobaciones de forma (siete reglas por línea + el escáner por sentencia de D-049) y el barrido tiene que demostrar que **alcanza `app/`**, incluidos `.tsx`, `app/parametros` y `app/bandeja` — la superficie con más decimales legítimos del repositorio |
| UPDATE/DELETE sobre asiento publicado → falla en BD | **PASA**, reverificado en la Ola 2 sobre un asiento publicado por el pipeline: `UPDATE` del asiento, `DELETE` del asiento y `UPDATE` de partidas, los tres `LG001`, **incluso como dueño del esquema** |
| Asiento desbalanceado → falla en BD | **PASA**, `LG002` con descuadre de un centavo |
| Reprocesar la misma factura 10 veces → asiento idéntico | **PASA** (caso 18, reverificado con fotografía completa) |
| Un cambio de parámetro no altera lo publicado | **PASA** (caso 17, ahora también por la interfaz) |
| Balance de prueba vs. ledger con 10.000 asientos | no implementado todavía — **A9 + A14, Ola 3** |
| Carga: 5.000 facturas en cola sin degradar el request HTTP | **sigue sin implementar.** Era una advertencia para la Ola 2 y nadie la tomó. **A6 + A13 + A15.** No es criterio de salida de la Ola 2, así que no la bloquea, pero pasa a ser deuda explícita de la Ola 3 |

---

## Casos dorados — VEREDICTO DE LA OLA 3 (A14), uno por uno

Los veinte se **volvieron a ejecutar completos** en esta pasada, no una muestra: `npm test` entero (806
pruebas, 41 archivos) y, además, A14 relanzó por separado las suites que los contienen
(`tests/golden/casos-dorados.test.ts`, `tests/golden/caso19-memoria.test.ts`,
`tests/adversarial/casos-dorados.test.ts`, `compuerta-ola0`, `compuerta-ola1`, `compuerta-ola2`,
`compuerta-ola2-interfaz` y `evasion`: **177 + 33 pruebas, cero fallos**). El **cómo** se verificó cada
uno está en las dos tablas de arriba y no se repite; aquí va el veredicto de HOY y lo que la Ola 3 le
añadió a cada caso.

| # | Veredicto Ola 3 | Qué pasó en esta pasada |
|---|---|---|
| 1 | **PASA** (sin cambios) | Reejecutado. Retefuente $40.000 y ReteIVA $28.500. La pata de ReteICA de Bogotá sigue sin datos (V-5), que no es asunto de esta ola |
| 2 | **PASA** (sin cambios) | Reejecutado. $60.000, con `tax_rule_id` distinta de la del declarante |
| 3 | **PASA** (sin cambios) | Reejecutado. No retiene bajo $104.748, con el motivo persistido y releído |
| 4 | **PASA** (sin cambios) | Reejecutado. No retiene bajo $523.740, con motivo |
| 5 | **PASA** (sin cambios) | Reejecutado. $15.000 auditado contra su fila de `tax_rule` |
| 6 | **PASA** (sin cambios) | Reejecutado. $22.000 desde el primer peso, con base mínima 0 **como dato** |
| 7 | **PASA** (sin cambios) | Reejecutado. Inmueble no retiene; mueble por el mismo valor, $16.000 |
| 8 | **PASA** (sin cambios) | Reejecutado sin andamiaje: $2.000 de ReteICA en Medellín con los seeds del repositorio |
| 9 | **PASA en lo que discrimina** (sin cambios) | Reejecutado. Base de Cali $157.122 frente a la de Medellín $785.610. La magnitud de la tarifa por actividad sigue en V-5 |
| 10 | **PASA en lo que discrimina, y por el canal real** (sin cambios) | Reejecutado. V-8 sigue cerrada por A7 |
| 11 | **PASA en el motor y por el canal real** (sin cambios) | Reejecutado. V-7 sigue cerrada por A7 |
| 12 | **PASA** (sin cambios) | Reejecutado. ReteIVA al 100% = $190.000, con norma que cita el art. 437-2 |
| 13 | **PASA** (sin cambios) | Reejecutado. Sin política parametrizada el motor no decide |
| 14 | **PASA** (sin cambios) | Reejecutado, incluida la variante hostil de trocear un concepto en dos líneas |
| 15 | **PASA, y la Ola 3 lo pone a prueba donde más duele** | Reejecutado (reversa por asiento nuevo, original idéntico byte a byte). **Nuevo:** el cierre de resultados de A10 es el primer código que escribe en el ledger fuera de la causación, y A14 verificó que ahí también se corrige por reversa: sobre el asiento de cierre **publicado**, `UPDATE journal_entry` y `DELETE journal_line` fallan con `LG001` desde una sesión real |
| 16 | **PASA** (sin cambios) | Reejecutado. Manda la fecha del hecho, con el borde exacto 30-jun / 1-jul |
| 17 | **PASA** (sin cambios), y **la Ola 3 no lo rompe** | Reejecutado en el motor y por la interfaz de A8. **Nuevo:** los reportes de la Ola 3 no reabren la puerta: `src/reports/` es de solo lectura —generar los **veinte** libros deja `journal_entry`, `journal_line`, `retention_applied`, `approval` y `source_document` con la **misma huella exacta** antes y después— y la hoja «Parámetros» de cada libro trae la vigencia con la que se armó, que es lo que hace auditable un cambio de tarifa a seis meses vista |
| 18 | **PASA, y se extiende al cierre de ejercicio** | Reejecutado (diez pasadas de la cola, un solo asiento, la misma fotografía las diez). **Nuevo:** A14 ejecutó el **cierre de resultados diez veces**: un solo asiento de cierre, el mismo `id` las diez veces, y la cuenta de resultado con el saldo **exacto** (pérdida de $1.500.000), no el doble. Y encontró la grieta que la clave de idempotencia no cubría: dos rangos **solapados** sí duplicaban la cancelación (**V-15, corregida por A14**) |
| 19 | **PASA** (sin cambios) | Reejecutado con la mina y el espía de D-052: segunda factura del mismo proveedor con la misma descripción escrita distinta → `origen = 'memoria'`, `llamadasLlm = 0`, `costoMicrosUsd = 0`, la mina intacta y `globalThis.fetch` sin una sola llamada. Ningún módulo de la Ola 3 llama a un LLM: `src/reports/` no importa nada de `src/ai/` |
| 20 | **PASA, reverificado sobre TODA la superficie nueva de la Ola 3** | Cero filas ajenas, y ahora también **cero celdas ajenas**: los **veinte** libros generados desde la sesión de **otra firma** y desde **otra empresa de la misma firma** no contienen la marca de la empresa A, ni su `third_party_id`, ni su `company_id`, **en ninguna hoja** (se recorre el libro entero, no solo «Datos»: si una hoja adicional olvidara el filtro, se vería). Y el **archivo plano** de exógena (1001, 1005, 1007, 1009) generado por la otra firma tampoco los trae |

**Reejecución de la SEGUNDA pasada (2026-08-31, con la ruta de descarga ya entregada):** los veinte
vuelven a correr en verde dentro de las 849 pruebas. El **caso 20 se extiende a la superficie que estrena
el desbloqueo**, que es la más expuesta de todo el producto (una ruta HTTP que devuelve archivos): sesión
de la firma B pidiendo la empresa de la firma A → **403** con rastro `ACCESO_DENEGADO`; empresa de la
misma firma sin acceso vigente → **403**; `companyId`/`company_id`/`empresa`/`tenantId` inyectados en la
query → **ni se leen**, y el `.xlsx` que baja —abierto y recorrido hoja por hoja— no contiene la marca de
la otra firma ni su `third_party_id`; sin cookie, con token inventado o con la sesión ya cerrada → **401**.
El **caso 17** también se extiende: descargar los veinte libros por HTTP deja la huella del ledger
idéntica, así que la ruta tampoco puede alterar nada de lo publicado.

**Pruebas adicionales de integridad, estado tras la Ola 3:**

| Prueba | Estado |
|---|---|
| Grep de literales tributarios en código → cero | **PASA, con el barrido REENVENENADO contra los módulos nuevos.** Cero hallazgos en `src/`, `app/` y `db/migrations/`. A14 sembró seis muestras en `src/reports/`, `src/reports/estados/` y `src/reports/exogena/` —tarifa quemada, máscara de Excel `'0.00%'`, dos umbrales precalculados (104748 y 523740), un `TOPE_UVT_1001 = 2400` y 2.400 UVT en pesos (125.697.600)— y el detector cazó **las seis**; el único superviviente fue `ANCHO_NIT = 20`, que no es tributario. Se añadió la aserción de que el barrido **alcanza** `src/reports/` y `src/services/cierre.ts`, para que el silencio no pueda ser vacío |
| UPDATE/DELETE sobre asiento publicado → falla en BD | **PASA**, reverificado sobre el asiento que estrena la ola: el **de cierre de ejercicio**. `UPDATE journal_entry` y `DELETE journal_line` desde sesión real → `LG001` |
| Asiento desbalanceado → falla en BD | **PASA**, `LG002` en el COMMIT con descuadre de un centavo. Y los 10.000 asientos aleatorios de esta ola se publicaron **todos** balanceados: si uno solo no lo hubiera estado, el COMMIT de su lote habría caído |
| Reprocesar la misma factura 10 veces → asiento idéntico | **PASA** (caso 18), y el cierre de ejercicio también resulta idempotente diez veces |
| Un cambio de parámetro no altera lo publicado | **PASA** (caso 17) |
| **Balance de prueba vs. ledger con 10.000 asientos → cuadra al centavo** | **PASA. Implementado por A14 en esta ola** (`tests/adversarial/compuerta-ola3.test.ts`). Detalle en el criterio 2 de la compuerta |
| Carga: 5.000 facturas en cola sin degradar el request HTTP | **SIGUE SIN IMPLEMENTAR.** Era advertencia para la Ola 2, pasó a deuda explícita de la Ola 3 y nadie la tomó tampoco. No es criterio de salida de ninguna de las dos, así que no bloquea; queda como deuda para **A6 + A13 + A15** antes de producción |

---

## Compuerta de la Ola 3 — veredicto de A14: **PASA. Ola 3 CERRADA** (en la segunda pasada)

Dos pasadas:

- **Primera (2026-08-30, commit `bb8cb08`): BLOQUEADA.** El criterio 2 pasaba al centavo; el criterio 1
  no, porque no existía ninguna forma de descargar un reporte (V-16). 107 pruebas nuevas de A14
  (`tests/adversarial/compuerta-ola3.test.ts`, `compuerta-ola3-entregas.test.ts`).
- **Segunda (2026-08-31, commit `0e28054` + correcciones de A14): PASA.** A9 cerró V-16 con
  `app/api/reportes/[libro]/route.ts` y `app/reportes/page.tsx`; A14 lo **atacó** en vez de creerle
  (`tests/adversarial/compuerta-ola3-ruta.test.ts`, **35 pruebas nuevas**) y encontró V-19, que corrigió.

### Criterio 1 — «Todo reporte se descarga en Excel con formato de papel de trabajo (sección 11)»

**PASA. Verificado por HTTP, no por la capa de servicios** (D-056), y atacando la ruta como atacante y
como contador hostil.

Lo del **contenido** del Excel ya estaba verificado en la primera pasada, libro por libro, los veinte
(8 de A9, 5 de A10, 7 de A11), y sigue en verde:

- **Las cuatro hojas obligatorias de la §11.2 están, y son las cuatro primeras**: la comprobación es
  `worksheets.slice(0, 4)` **exactamente igual a** `['Datos','Papel de trabajo','Trazabilidad','Parámetros']`,
  así que una hoja adicional no puede colarse en medio ni desplazar a una obligatoria.
- **«Papel de trabajo» lleva el encabezado que exige la norma**: NIT, la palabra «período» y el período
  real del reporte, en los veinte.
- **«Trazabilidad» dice qué regla y qué vigencia se aplicó, con datos reales**: en el certificado de
  retenciones contiene el `tax_rule_id` **exacto** de la regla usada y su `vigente_desde`, y sus
  encabezados nombran regla y vigencia. La hoja «Parámetros» del mismo libro también trae la vigencia:
  es lo que lo hace autoexplicativo a seis meses y defendible ante un revisor fiscal.
- **Los veinte se escriben como `.xlsx` y se vuelven a abrir**, con la firma `PK` del ZIP verificada y
  sin ningún nombre de hoja de más de 31 caracteres.

Lo **nuevo de esta pasada**, que es lo que faltaba: **ahora se descargan de verdad.**

- **Los veinte slugs responden 200 por `GET /api/reportes/:libro`**, con
  `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, cuerpo que empieza
  por `PK`, y **al reabrirlo con ExcelJS trae las cuatro hojas obligatorias**. No es una muestra: son los
  veinte, uno por uno, cada uno con sus parámetros obligatorios.
- **El `Content-Disposition` no es inyectable**: se comprueba contra
  `^attachment; filename="[A-Za-z0-9_.-]+\.xlsx"$`. El nombre lo arma la ruta leyendo la hoja «Papel de
  trabajo» del libro **ya generado** (razón social y NIT), no un parámetro del cliente.
- **El libro que baja trae los datos de la empresa en sesión** (contiene la marca de la firma A): si no,
  la prueba de aislamiento de más abajo no probaría nada.
- **Ningún libro quedó huérfano.** Esta es la comprobación que cierra V-16 de verdad, y no la existencia
  de la ruta: A14 enumera **los generadores exportados por `src/reports/`** en tiempo de ejecución
  (`generarLibro*`, `generarBalance*`, `generarEstado*`, `generarFormato*`…), verifica que son **veinte**
  y que **todos** aparecen cableados en el fuente de la ruta. Si mañana alguien añade un libro y olvida su
  slug, esa prueba cae: V-16 no puede reaparecer en silencio.
- **La afirmación de A9 de que su ruta es el único importador de `src/reports/` fuera de las pruebas es
  CIERTA**, y no se acepta por escrito: se comprueba con `git grep` sobre `app/` y `src/` dentro de la
  propia prueba, exigiendo que la lista sea exactamente `['app/api/reportes/[libro]/route.ts']`.
- **La ruta no escribe nada en el ledger**: descargar los veinte deja la huella de `journal_entry`,
  `journal_line`, `approval`, `source_document` y `retention_applied` idéntica.
- **La pantalla existe** (`app/reportes/page.tsx`, `ƒ /reportes` en el build) y no ofrece formularios sin
  el permiso `reporte.exportar`.

### Ataques a la ruta — caso dorado 20 sobre la superficie nueva

Una ruta HTTP que sirve archivos es el sitio más fácil para filtrar datos de otra firma. Resultado de los
ataques de A14, todos contra la base real (RLS, `app.current_company_id()` y `app.exigir_permiso` sin
dobles; lo único simulado es `next/headers` y el singleton de conexión):

| Ataque | Resultado |
|---|---|
| Sin cookie de sesión | **401**, sin generar nada, y el cuerpo no contiene la marca de ninguna firma |
| Token inventado | **401** |
| Sesión **cerrada** después de emitirse (la cookie sigue en el cliente) | **200 antes, 401 después**: lo decide la base, no la cookie |
| Sesión de la **firma B** con cookie de empresa de la **firma A** | **403**, con rastro `ACCESO_DENEGADO` en `audit_log` del tenant atacante, y sin servir el libro |
| Empresa de la **misma firma** sobre la que el usuario no tiene acceso vigente | **403** |
| `companyId`, `company_id`, `empresa` y `tenantId` inyectados en la **query string** | **200 con el libro de SU empresa**: los cuatro parámetros **ni se leen**. El `.xlsx` que baja no contiene la marca de la firma A ni su `third_party_id` — comprobado abriendo el archivo devuelto y recorriendo **todas** las hojas |
| Rol `solo_lectura` (sin `reporte.exportar`) | **403** — lo impone el motor (`app.exigir_permiso`), la ruta solo traduce |
| Recorrido de ruta (`../../../etc/passwd`, `..%2f..%2fapp%2flib%2fdb`, `libro-diario/../../secreto`) | **404** |
| Slugs iguales a claves del prototipo de `Object` (`__proto__`, `constructor`, `toString`, `valueOf`, `hasOwnProperty`) | **404** tras la corrección de A14. **Antes daban 500** (V-19) |
| Parámetros ausentes o mal formados, `nivel=9`, `nivel=3; DROP TABLE journal_line` | **400** con mensaje puntual, nunca 500 |
| Inyección SQL por `terceroId` (`' OR 1=1 --`) | No llega al motor como SQL; no devuelve datos ajenos y el ledger queda intacto |

### Criterio 2 — «El balance de prueba cuadra contra la suma del ledger, comprobado por A14 con datos generados aleatoriamente» (§12: 10.000 asientos, al centavo)

**PASA.** Verificado con datos que generó A14, no con el escenario de dos asientos con el que A9 dio el
criterio por bueno en su reporte.

- **10.000 asientos aleatorios y 39.983 partidas**, con generador determinista (mulberry32, semilla
  20260830) para que un fallo sea reproducible: de 1 a 3 débitos y de 1 a 3 créditos por asiento, importes
  aleatorios en centavos, fechas repartidas sobre los 365 días de 2026 y **15 cuentas** con códigos de 4,
  6 y 8 dígitos, para que agrupar por nivel del PUC tenga algo real que agrupar en los cinco niveles.
  Todos pasan por el ciclo real `draft` → partidas → `app.publicar_asiento`.
- **La comparación NO es circular.** `sumaDirectaLedger` de A9 lee la **misma vista**
  `v_journal_line_reporte` que el balance: comparar una con otra no puede detectar que la vista pierda
  filas. A14 compara contra `journal_line JOIN journal_entry` **crudas** y, además, contra **lo que
  generó en memoria**. Tres fuentes, no dos.
- **Cuadra al centavo en los cinco niveles** (clase, grupo, cuenta, subcuenta, auxiliar): la suma de
  `debitosPeriodo` y de `creditosPeriodo` de todas las filas del balance coincide exactamente con la suma
  cruda, y débitos = créditos (la doble partida se demuestra con 10.000 asientos, no se asume).
- **Grupo por grupo, no solo el total.** Para cada nivel A14 recalcula en memoria débitos, créditos y
  **saldo inicial** de cada grupo y los compara uno a uno contra la fila del balance, comprueba
  `saldoFinal = saldoInicial + débitos − créditos` y verifica **en el otro sentido** que ningún grupo con
  movimiento desapareció del reporte. Un total correcto con dos grupos intercambiados no pasaría.
- **La vista no pierde ni inventa una partida**: mismo conteo y misma suma de `monto` que las tablas
  crudas. Importaba comprobarlo porque `v_journal_line_reporte` hace un **INNER JOIN con `account`**, y un
  inner join es exactamente la forma en que un reporte pierde filas en silencio.
- Todo en `BigInt` de punta a punta, en la prueba y en el código.

**Hallazgo de rendimiento que salió de aquí, y que no es un defecto del producto** (ver D-057): sin
estadísticas del planificador, un `JOIN` de `journal_line` con `journal_entry` **bajo RLS** degenera en
bucle anidado y crece **cuadráticamente** — medido: 10 s con 2.000 partidas, 39 s con 4.000, 159 s con
8.000; con `ANALYZE` ejecutado, el mismo JOIN baja a **4 ms**. Es el planificador sin estadísticas, no la
RLS ni la vista: la misma consulta sin el JOIN va en 3 ms bajo RLS. Queda anotado para **A15**: tras una
carga masiva de documentos hay que ANALIZAR, o los primeros reportes de esa empresa se arrastran.

### Criterio nuevo desde la Ola 2 — `npx next build`

**PASA. Exit 0** en las dos pasadas, Next 16.3.3 con Turbopack. En la segunda, el build lista **13 rutas**,
incluidas las dos nuevas: `ƒ /api/reportes/[libro]` y `ƒ /reportes`. Ejecutado siempre al empezar (para no
heredar una rotura ajena) y al terminar, después de tocar `src/services/cierre.ts` (primera pasada) y
`app/api/reportes/[libro]/route.ts` (segunda). Cierre: `npm test` **849 en verde** en 43 archivos
(814 previas + 35 de la suite de ataque a la ruta), `npm run typecheck` limpio.

### Adjudicación de las tres entregas, punto por punto

**A10 — «las notas son estructuralmente incapaces de fabricar una revelación».** **CIERTO, verificado por
A14 y no por lectura del reporte.** El objeto `NotaEstadosFinancieros` no tiene ningún campo que pueda
llevar la redacción: A14 recorrió las **trece** notas y comprobó que ninguna declara un campo
`redaccion`, `contenido`, `texto`, `revelacion`, `nota` ni `cuerpo`. Lo que hay es `exigencia` (lo que
pide la norma), `aportaElSistema` y `completaElContador` (instrucciones al preparador), y en el libro una
columna **«REDACCIÓN DE LA NOTA» que sale vacía en las trece filas**, comprobado celda a celda. Las hojas
`PT …` existen y llevan las columnas de juicio en blanco. **No hay camino por el que salga una revelación
redactada por la máquina.**

**A10 — el EFE cuando nadie marcó las cuentas de efectivo.** **Sale vacío y con su papel de trabajo, sin
suponer nada.** Verificado con `niif_mapping.rubro_efe` sin marcar: `cuentasEfectivo = []`, efectivo
inicial y final en **cero**, todos los renglones en cero, y la hoja **«PT efectivo y equivalentes»**
presente y con las **candidatas reales** (aparece la cuenta 110505, que sí tiene saldo). El defecto que
A14 buscaba —que `es_efectivo` cayera en un valor por defecto— **no existe**: en `app.niif_de_cuenta`,
`es_efectivo` es `(rubro_efe = 'efectivo_y_equivalentes')`, así que sin marca es `NULL` y el filtro
`WHERE n.es_efectivo` no la toma. Y con las cuentas marcadas, la conciliación de la §7 cuadra **al
centavo**: `descuadre = 0`, efectivo inicial + flujo neto = efectivo final, y el detalle (renglones de
nivel 2) suma exactamente el flujo neto. La **actividad** de cada flujo sí se presume cuando no está
declarada, pero se marca como `presumida`, se cuenta en `partidasPresumidas` y se lista en la hoja «PT
actividades presumidas»: presumir y avisar no es inventar.

**A10 — el cierre de resultados, que es lo que escribe en el ledger.** **Respeta la Regla de Oro 1, con
una grieta que A14 encontró y corrigió.** Verificado: asiento **nuevo** de tipo `cierre`, ciclo
`draft` → partidas → `app.publicar_asiento`, publicado con `posted_at` y con una fila de `approval` con
decisión `aprobado`; cero `UPDATE`/`DELETE` sobre nada publicado (el intento falla con `LG001`); exige el
permiso `periodo.cerrar` (con rol `auxiliar_causacion` lanza `PermisoInsuficienteError`); y **una cuenta
sin mapeo NIIF no se cierra a ciegas por su clase del PUC**: la cuenta 199905 del escenario no aparece en
**ninguna** partida del asiento de cierre y sí en `cuentasSinClasificar`. **La grieta (V-15):** la clave
de idempotencia cubre repetir el **mismo** rango, pero no dos rangos **solapados**. Cerrar 01-jun→30-jun y
después 15-jun→30-jun creaba un segundo asiento que volvía a cancelar los mismos ingresos: medido por
A14, la cuenta de ingresos quedaba con **saldo débito** y el resultado del ejercicio en **cero**. Y como
el ledger es inmutable, deshacerlo exige una reversa. **Corregida por A14** (`CierreSolapadoError`, ver
D-058), con prueba de regresión que además comprueba que el intento rechazado **no deja nada escrito**.

**A11 — el bloqueo del Formato 1001.** **Es real, está bien diagnosticado y bien dirigido, y A14 lo
amplía.** Verificado a mano: `third_party` **sí** tiene `direccion`, `municipality_id` y `codigo_dane`
(migración 005), o sea que el esquema de A2 está bien; y **no existe ni un solo `INSERT INTO
third_party` en `src/`, en `app/` ni en las migraciones** — ninguno, en todo el repositorio fuera de los
fixtures de prueba. **Lo que A14 añade al diagnóstico:** el hueco no es solo de exógena. Como
`src/services/ingest.ts` resuelve el tercero por NIT y **no lo crea**, una factura de un proveedor que
nadie haya insertado antes **por SQL a mano** no se puede causar. Hoy el producto no se puede poner en
marcha con un cliente nuevo sin acceso directo a la base de datos. Es **V-17**, y le toca a **A8**.

**A11 — que el archivo generado no rellene nada por defecto.** **Verificado, y es cierto.** En el Formato
1001 el tercero sin dirección sale con la celda **vacía** entre delimitadores en el archivo plano —A14
localiza la columna «Dirección» por su encabezado y comprueba que **todas** las filas de datos la traen
vacía—, aparece en la hoja **«Bloqueos»** del Excel, y el plano lleva la advertencia. Ni un `0`, ni un
código DANE por defecto, ni «COLOMBIA». Es exactamente lo que exige la advertencia 17.5, y su
consecuencia (una sanción del art. 651 ET por un municipio inventado) queda evitada.

**A11 — la limitación de alcance de los formatos 1003 y 1006.** **Es limitación honesta, no defecto
disfrazado**, con una salvedad menor. El producto no procesa facturas de venta (§1.3 del mega-prompt),
así que la fuente natural de esos dos formatos no existe en el ledger; los generadores no inventan nada,
producen lo que **sí** hay (autorretención y lo que el contador mapee en `exogena_account_mapping`) y
devuelven la advertencia en tiempo de ejecución **y en la cabecera del archivo plano**. La salvedad
(**V-18**, menor): esa advertencia **no llega al Excel**, que es justamente el que el contador revisa; el
1001 sí tiene su hoja «Bloqueos» y estos dos no tienen su hoja «Advertencias». Le toca a **A11**.

**A9, A10 y A11 tocaron el inventario cerrado de módulos de `src/`.** Verificado: `'reports'` está
declarado en el inventario de `tests/adversarial/casos-dorados.test.ts` y el canario sigue en verde. El
detector de valores tributarios **alcanza** los tres directorios nuevos y caza el veneno sembrado en cada
uno (ver la tabla de integridad de arriba).

### Lo que A14 corrigió en las dos pasadas

0. **V-19 — un slug igual a una clave del prototipo de `Object` devolvía 500 en vez de 404** (segunda pasada). `REPORTES[libro]` resolvía por la cadena de prototipos: con `__proto__` devolvía un objeto truthy que no es un generador, se saltaba el 404 y reventaba abajo con un 500 que expone un mensaje interno; con `constructor` llegaba a **llamar** a `Object` como si fuera el generador. No hay fuga —la sesión se exige antes—, pero un catálogo de rutas se consulta por **clave propia**: `Object.hasOwn(REPORTES, libro)`. Corregido en `app/api/reportes/[libro]/route.ts`, con las nueve muestras de veneno en la prueba, que además ahora **informa todas** las que fallen y no solo la primera.
1. **V-15 — el cierre de rangos solapados duplicaba la cancelación.** `CierreSolapadoError` en
   `src/services/cierre.ts`: antes de escribir nada se rechaza un cierre cuyo rango se solape con el de un
   asiento de cierre ya publicado. El rango se lee de la **propia clave de idempotencia** del asiento
   (`cierre:<desde>:<hasta>`), que es dato del ledger y no un estado paralelo que pudiera desincronizarse.
2. **El barrido de la Regla de Oro 2 ahora demuestra que alcanza `src/reports/` y `src/services/cierre.ts`**,
   con la misma forma con la que ya demostraba que alcanza `app/`. Un silencio vacío deja de poder
   confundirse con un silencio limpio.
3. **La comprobación del criterio de los 10.000 asientos existe y está automatizada**: era la única prueba
   de integridad de la §12 que llevaba dos olas sin implementar.

### Lo que A14 NO corrigió, y a quién le toca

**V-16 ya no está en esta tabla: la cerró A9 y A14 la reverificó atacándola.** Lo que sigue abierto:

| Qué falta | Por qué A14 no lo hace | A quién le toca |
|---|---|---|
| **V-17 — no hay forma de crear ni editar un tercero** | Es una pantalla CRUD completa con sus validaciones, y afecta al maestro de datos, no a un reporte | **A8** |
| **V-18 — las advertencias de alcance de 1003/1006 no llegan al Excel** | Es contenido del entregable de A11, y el mecanismo ya existe (`hojasAdicionales`, como la hoja «Bloqueos» del 1001) | **A11** |
| **Prueba de carga: 5.000 facturas en cola** | Lleva dos olas sin dueño efectivo. No es criterio de salida de ninguna, pero sigue sin hacerse | **A6 + A13 + A15** |

### Cómo se desbloqueó (histórico, ya resuelto)

Faltaba una sola cosa —**que existiera la descarga** (V-16)— y así se cerró: A9 entregó
`app/api/reportes/[libro]/route.ts` y `app/reportes/page.tsx`, y A14 volvió a correr **solo esa parte**,
atacándola, sin repetir el resto de la compuerta. La ruta pasó todo salvo el caso de las claves del
prototipo (V-19), que A14 corrigió en el momento. El resto de la compuerta —las cuatro hojas, la
trazabilidad, los 10.000 asientos, el cierre de resultados, las advertencias 17.5 de A10 y A11— ya estaba
verificado en la primera pasada y no se rehízo.

---

## Compuerta de la Ola 2 — veredicto de A14: **PASA. Ola 2 CERRADA**

### Criterio 1 — «Un contador cambia el valor de la UVT desde la interfaz, y el sistema calcula con el valor nuevo para hechos posteriores a la vigencia, sin alterar los cálculos ya publicados»

**PASA**, verificado **por la interfaz**, no por SQL ni por la capa de servicios: se envía el `FormData`
real a `guardarUvtAction` con la cookie de sesión puesta y el rol `admin_tributario` (el único que §6.2.5
autoriza).

- La acción confirma (`?ok=uvt`), sin error.
- La vigencia **anterior conserva su valor**; lo único que cambia es `vigente_hasta`.
- La **nueva** existe con el valor nuevo, y la resolución por **fecha del hecho** devuelve la vieja para
  junio-2026 y la nueva para enero-2027.
- **La fotografía de todo lo publicado en la firma —asientos y partidas— es idéntica byte a byte antes y
  después.**

Y las tres puertas del contador hostil, cerradas:

| Ataque | Resultado |
|---|---|
| Guardar una vigencia **retroactiva** a un hecho ya publicado | Rechazado por el servicio; el ledger no se mueve |
| Rodear la interfaz y hacer `UPDATE` del **valor** de la vigencia anterior, con el rol que **sí** puede parametrizar | `PR001` VIGENCIA_INMUTABLE |
| Mover `vigente_desde`, reabrir `vigente_hasta`, `DELETE` de la vigencia | `PR001`, `PR001`, `PR003` |
| Guardar desde la interfaz con un rol sin `parametro.editar` | Error, y **cero filas nuevas** en `uvt_value` |

### Criterio 2 — «El segundo procesamiento de una factura del mismo proveedor con la misma descripción NO llama al LLM»

**PASA.** Caso dorado 19, cerrado con instrumentos propios (D-052): mina en vez de contador, espía de
`fetch`, y la comprobación adicional de que **sin ningún LLM configurado** la clasificación sigue
funcionando. Cero llamadas, cero tokens, cero costo, `origen = 'memoria'`.

### Criterio 3 — «Un usuario de la firma ve en una sola pantalla las facturas pendientes de sus 30 empresas y puede aprobar 50 de un golpe»

**PASA — después de corregir un defecto real que lo derrotaba** (V-12 / D-050).

Escenario montado por A14: una firma con **31 empresas accesibles** y una **trigésimo segunda a la que la
sesión NO tiene acceso**, con dos facturas pendientes cada una.

- La pantalla trae las pendientes de **las 30**, exactamente dos por empresa.
- La empresa sin acceso **no aparece**: ni ella, ni sus facturas, ni sus documentos.
- **50 filas de distintas empresas se aprueban de un golpe** y quedan las 50 publicadas, sin un solo
  error.
- **Contador hostil 1:** seleccionar las facturas de la empresa sin acceso no publica **nada**.
- **Contador hostil 2:** falsificar el `companyId` del formulario para que declare una empresa a la que
  sí tiene acceso, con el `journalEntryId` de una a la que no, **no publica el asiento ajeno** — sigue en
  `draft`. El aislamiento lo impone el motor, no la aplicación.
- **Robustez del lote:** una fila que falla (ya publicada por otro) **ya no tumba a las sanas del mismo
  lote**. Antes de D-050 sí lo hacía.

### Lo que A14 corrigió en esta pasada

| Qué | Dónde |
|---|---|
| Salvaguarda de la Regla de Oro 2 restituida (V-13) | `tests/adversarial/valores-tributarios.test.ts` |
| Canario que había dejado de ejercitar `insert_normativo` (V-14) | `tests/adversarial/valores-tributarios.test.ts` |
| `SAVEPOINT` por ítem en la aprobación en lote (V-12) | `src/services/causacion.ts` |

### Lo que A14 NO corrigió, y a quién le toca

| Qué | De quién |
|---|---|
| **V-11** — la aprobación revienta con error crudo si el despliegue no reenvía la IP del cliente | **A7** (fallback de cabecera + mensaje accionable) + **A15** (garantizarla en el despliegue) |
| **V-1** — el `GRANT` de `app.resolver_empresa_por_buzon` sigue en `app_user`. **Desbloqueada**: el rol de sistema ya existe | **A4 + A12** |
| **V-5** — sin tarifas de ICA por actividad para Bogotá ni Cali (esquema del código municipal) | **A2**, luego **A1**, luego verificación humana |
| Prueba de carga: 5.000 facturas en cola sin degradar el request HTTP | **A6 + A13 + A15** |

---

## Compuerta de la Ola 1 — veredicto de A14: **PASA. Ola 1 CERRADA**

> **Historia, porque importa:** el 2026-08-27 A14 dejó esta compuerta **BLOQUEADA** con dos huecos de
> datos (V-4 y V-6). A1 los cerró en el commit `ffaf3db`. A14 **volvió a correr la compuerta entera**, con
> pruebas propias y sin creerle nada al reporte de A1. Este es el veredicto de esa segunda pasada.

Verificación **independiente**, tratando los cinco reportes de `docs/reportes/ola1-a*.md` como una
afirmación a refutar y no como evidencia. Mismo criterio único de la Ola 0: **si el rechazo no trae
SQLSTATE de PostgreSQL, no cuenta.**

### Los cuatro criterios de la sección 4

| # | Criterio de la compuerta | Veredicto | Detalle |
|---|---|---|---|
| **1** | El motor resuelve correctamente los **20 casos dorados** | **PASA** | **La prueba que decidía era ésta: ¿el pipeline produce un asiento con el repositorio tal como está, sin que nadie inserte un parámetro a mano en una prueba?** Antes del desbloqueo, **no**: A14 tenía que insertar una `rounding_rule` en su propia prueba de punta a punta. Ahora **sí**: el caso 1 (retefuente $40.000 + ReteIVA $28.500) y el caso 8 (ReteICA $2.000 en Medellín) se causan, cuadran y **se publican** usando solo `db/seeds/`. 18 de 20 pasan sin reservas; el 19 depende de A5 (Ola 2) y está declarado, no fingido; los 9 y 10 pasan **en lo que discriminan** y su tarifa sigue sobre andamiaje por V-5, que ya no es deuda de esta ola (D-048) |
| **2** | El parser extrae un XML real DIAN, incluido el `Invoice` embebido en **base64 dentro del `AttachedDocument`** | **PASA** | Verificado sobre el fixture de A4 y sobre **tres variantes hostiles propias**: base64 **partido en líneas de 76 caracteres**, XML plano dentro de **CDATA**, y prefijos de namespace ajenos (`ns2/ns3/ns4`). Más dos ataques: **billion laughs** (no expande, <5 s) y **XXE a un archivo local** (cuarentena, sin filtrar el archivo). **Reserva declarada:** ningún fixture es una captura real de la DIAN |
| **3** | Ni un solo valor tributario en código | **PASA** | Siete reglas, 32 pruebas, **cero hallazgos** en `src/`, `app/` y `db/migrations/`. Detector **más sensible** que en la Ola 0 (D-038, D-039, D-040). Los datos que A1 cargó viven **solo** en `db/seeds/`, que se audita aparte como dato puro |
| **4** | Un cambio de tarifa en la tabla paramétrica cambia el resultado **sin tocar código ni redesplegar** | **PASA** | Probado **tres** veces: con `tax_rule`, con `uvt_value` y —tras el desbloqueo— con `rounding_rule`, donde una empresa que carga su propia regla (`truncar`, al mil) le gana a la global de A1 (`half_up`, al peso) solo con datos. En los tres casos: cambia lo posterior, **no** cambia lo anterior, y la traza ya registrada queda **idéntica byte a byte** |

### Qué cambió entre el bloqueo y el cierre, verificado por A14 y no por reporte

1. **`rounding_rule` (V-6): CERRADA.** El pipeline completo produce el asiento del caso 1 **sin que
   ninguna prueba inserte nada** — A14 borró de su propia prueba de punta a punta el `INSERT` que antes
   necesitaba, y sigue en verde. El respaldo «parámetro operativo, no norma tributaria» se **acepta con un
   criterio explícito y comprobable**, no de palabra: ver D-046.
2. **ReteICA de Medellín (V-4): CERRADA.** A14 escribió el caso 8 **de punta a punta sin andamiaje**:
   $2.000 sobre $1.000.000, asiento publicado, `ciiu_activity_id` nulo, y la traza citando **«Acuerdo 066
   de 2017»**. La copia es **byte a byte** (`tax_rule.tarifa` = `municipality_ica_rule.tarifa_general`) y
   **la cadena de norma no perdió el origen**, que era la objeción de A14.
3. **Las dos aserciones de A14 que A1 tocó: NO se debilitaron.** Verificado línea por línea en el diff:
   una pasó de tres conteos a tres conteos exactos **más cinco comprobaciones nuevas**, y la otra pasó de
   contar filas a **ejercitar la resolución por vigencia contra el motor**. Ver D-047. A14 endureció un
   residuo (una comparación que podía pasar en el vacío por encadenamiento opcional).
4. **Bogotá y Cali siguen sin tarifa de ICA por actividad**, y A1 hizo bien en no tocarlas. Queda como
   V-5, declarada en la tabla de casos dorados y asignada a **A2** (esquema) y a verificación humana
   (dato). **No bloquea**: lo que los casos 9 y 10 discriminan está verificado con datos reales, y la
   conducta del motor ante la ausencia —negarse y dejar el motivo escrito— es la correcta (D-048).

### Lo que queda cerrado y no hay que rehacer

- **El motor de A3 es correcto**, y lo es contra una auditoría que no le cree su propia respuesta: cada
  retención se verifica contra la fila de `tax_rule` que dice haber usado y su valor se **recalcula en
  SQL**. Los cinco ejes operan, y el motor **se niega a calcular** cuando falta un parámetro en vez de
  suponerlo — probado por comportamiento, no por conteo: cerrando la vigencia de toda regla de redondeo,
  el pipeline devuelve `revision_manual` con `sin_regla_de_redondeo_vigente` y **no deja ni un asiento ni
  una retención a medias**.
- **El parser de A4 aguanta** las tres formas realistas del `AttachedDocument` y dos ataques clásicos.
- **La cola de A6 no duplica**: dos trabajadores no se llevan el mismo trabajo (`FOR UPDATE SKIP LOCKED`),
  dos ciclos en paralelo dejan **un** asiento, encolar diez veces deja **un** trabajo, y la sesión de
  negocio **no puede** reclamar, completar ni fabricar trabajos (`42501`).
- **El ledger sigue siendo inmutable** sobre lo que construye A6: ocho vectores de `UPDATE`/`DELETE`
  contra un asiento publicado por el pipeline, los ocho `LG001`, fotografía idéntica al final.
- **El aislamiento aguanta las nueve tablas nuevas** de la Ola 1, en lectura y en escritura.
- **La costura A3↔A6, que no probaba nadie, está probada y en verde** (D-045).
- **Los datos de A1 son auditables**: toda tarifa declara su norma, ninguna se escribió a mano donde había
  una fuente que copiar, y los seeds no contienen una sola línea de lógica ni un solo `UPDATE` sobre una
  tabla paramétrica.

### Estado de la suite al cerrar la Ola 1

`npm test` → **435 pruebas en verde, 21 archivos, CERO fallos y CERO `todo`.** `npm run typecheck` limpio.
Al empezar A14 la compuerta había 346 en verde, 22 `todo` y 2 fallos.

| Archivo | Pruebas | Agente |
|---|---|---|
| `tests/adversarial/compuerta-ola0.test.ts` | 40 | A14 (Ola 0) |
| `tests/adversarial/evasion.test.ts` | 33 | A14 (Ola 0) + 1 de A4 |
| `tests/adversarial/valores-tributarios.test.ts` | **32** | **A14 — reescrita en la Ola 1** |
| `tests/adversarial/casos-dorados.test.ts` | **26** | **A14 — los 20 casos con oráculo propio en SQL** (2 aserciones actualizadas por A1, verificadas por A14) |
| `tests/adversarial/compuerta-ola1.test.ts` | **38** | **A14 — compuerta de la Ola 1, ataques a lo nuevo, y el desbloqueo reverificado** |
| `tests/golden/casos-dorados.test.ts` | 25 | A3 (auditada por A14, se conserva) |
| `tests/gates/*` (esquema, ola0, seguridad, autenticación, ingest) | 134 | A2, A12, A4 |
| `tests/services/*`, `tests/ingest/*`, `tests/seeds/*` | 107 | A6, A4, A1 |

---

## Compuerta de la Ola 0 — veredicto de A14

Verificación **independiente**, con pruebas escritas desde cero en `tests/adversarial/`, tratando las de
A2 y A12 como una afirmación a refutar y no como evidencia. Criterio único: **si el rechazo no trae
SQLSTATE de PostgreSQL, no cuenta.** El arsenal de A14 (`_arsenal.ts`) distingue explícitamente un error
del motor de un `throw` de TypeScript y falla con un mensaje distinto en cada caso.

**Precondición auditada antes de creerle nada al harness:** dentro de `asTenant` el rol efectivo es
`app_user`, no es superusuario, no tiene BYPASSRLS, **no es dueño de ninguna tabla**, y
`row_security_active()` devuelve true sobre siete tablas comprobadas una por una. Si cualquiera de esas
fallara, toda prueba de aislamiento del repositorio sería un falso PASS.

| # | Prueba de la compuerta (sección 4) | Veredicto | Cómo lo verificó A14 |
|---|---|---|---|
| **1** | `UPDATE` sobre `journal_entry` publicado falla a nivel de base de datos | **PASA** (`LG001`) | Nueve vectores: UPDATE idempotente (`SET descripcion = descripcion`), des-publicar a `draft`, anular, UPDATE masivo sin `WHERE`, DELETE masivo sin `WHERE`, DELETE de un borrador, UPDATE/DELETE/INSERT sobre las partidas del publicado, y el mismo intento **como superusuario**. Cerrado con `TRUNCATE`, que **no dispara triggers de fila**: rechazado con `42501` porque el privilegio no existe (barrido de catálogo). **Veredicto final por fotografía**: tras los nueve intentos la fila es idéntica **byte a byte** a la instantánea `to_jsonb` inicial |
| **2** | Asiento desbalanceado rechazado por la BD, no por la aplicación | **PASA** (`LG002` en el COMMIT) | Siete vectores: descuadre de **un centavo**; descuadre introducido **después** de publicar dentro de la misma transacción; `SET CONSTRAINTS ALL IMMEDIATE` (adelanta la validación, no la desactiva); publicación por `UPDATE` crudo **saltándose** `app.publicar_asiento`; asiento de una sola partida (`LG003`); asiento sin ninguna partida; y montos que **desbordan `bigint`** —el motor falla cerrado, no cuadra por desbordamiento—. Control por barrido: **ningún** asiento publicado de la firma descuadra |
| **3** | Una consulta sin filtro de tenant devuelve cero filas de otros tenants | **PASA** | **Barrido por catálogo, no muestra**: las 20+ tablas con `tenant_id` y las 12+ con `company_id`, más **todas** las vistas. Aislamiento en **los dos niveles** y en **los dos sentidos** (también de la segunda empresa hacia la primera). Escritura cruzada rechazada con `42501`. UPDATE y DELETE sin `WHERE` que no rozan ni la otra firma ni la otra empresa. **Y la versión de motor de lo que A12 probaba en TypeScript**: saltándose `withSessionContext`, con token de Alfa y `app.company_id` de Beta forjada por `set_config`, `app.current_company_id()` devuelve NULL y `third_party`, `journal_entry` y `source_document` devuelven **cero**. Sin token, cero filas de cualquier firma en **todas** las tablas |
| **4** | Insertar una vigencia nueva no altera la anterior; una fecha pasada resuelve la regla de entonces | **PASA** (`PR001`/`PR002`/`PR003`) | La vigencia anterior se compara **byte a byte** (`to_jsonb` completo) antes y después de crear la nueva: solo cambia `vigente_hasta`. La resolución se prueba en **cinco fechas** incluidos los dos bordes inclusivos, y se demuestra que resolver por la fecha del hecho da **una tarifa distinta** que resolver por la fecha de proceso —si coincidieran, la Regla 3 estaría rota—. Más: reescribir la tarifa, reabrir el cierre, moverlo, adelantar el inicio, solapar y borrar, los seis rechazados por el motor. **Y la mitad probable del caso dorado 17**: un `retention_applied` ya registrado queda **idéntico** tras dos vigencias posteriores, y no puede mentir sobre qué vigencia usó (FK compuesta, `23503`) |

**Ninguna vulnerabilidad abierta derrota ninguno de los cuatro criterios.** D-032 y D-033 son de
integridad y de despliegue, no de aislamiento ni de inmutabilidad, y ninguna es alcanzable desde una
sesión de aplicación en producción bien configurada. **Veredicto: Ola 0 CERRADA.**

Además, `tests/gates/esquema.test.ts` verifica invariantes del esquema que las olas siguientes no deben romper:
RLS habilitada **y forzada** en toda tabla, política que filtra por tenant en toda tabla con `tenant_id`,
`security_invoker` en toda vista, cero columnas `float`/`double precision`/`money`, triggers de vigencia y de
auditoría en toda tabla paramétrica, relaciones `NOT NULL` obligatorias de la sección 15, y los 5 roles con sus permisos.

**Estado de las pruebas al entregar A2:** `npm test` → 55 pruebas, 2 archivos, todo en verde. `npm run typecheck` limpio.

**Estado de las pruebas al entregar A12:** `npm test` → **120 pruebas, 4 archivos, todo en verde**.
`npm run typecheck` limpio. Las 55 de A2 pasan **sin modificar una sola aserción**, pese al cambio de
fondo del contexto de tenant (D-021).

**Estado de las pruebas al cerrar la compuerta (A14):** `npm test` → **201 pruebas en verde, 8 archivos,
más 22 casos dorados enumerados como `todo`**. `npm run typecheck` limpio. Las 120 de A2 y A12 pasan
**sin modificar una sola aserción**, incluida la migración 017 que corrige D-030 y D-031.

**Estado de las pruebas tras cerrar D-032 y D-033 (A2, migración 018):** `npm test` → **202 pruebas en
verde, 8 archivos, más 22 casos dorados enumerados como `todo`**. `npm run typecheck` limpio. La prueba
que A2 añadió es el barrido de `pg_constraint` de D-037. Se tocaron **tres** aserciones de A14, todas
por el mismo motivo —el guardia es un trigger `BEFORE` y contesta antes que la política, con un código
más específico— y ninguna deja de exigir el rechazo del motor:

| Prueba de A14 | Cambio | Por qué |
|---|---|---|
| `it.fails` de D-032 | convertida en `it` normal, acepta `AL001` | Es lo que A14 dejó pedido al cerrarse el hueco. Sin invertirla habría seguido "pasando" por el motivo equivocado: `rechazoConCodigo` lanzaba porque `AL001` no estaba en su lista, y `it.fails` lo tomaba por éxito |
| D-033, `expect(conTrigger).toEqual([])` | invertida a positivo, y ahora **ejecuta** el TRUNCATE como superusuario | A14 la dejó "medida, no silenciada", pidiendo actualizarla en positivo |
| D-031, forja de `audit_log` con usuario ajeno | acepta `AL001` además de `42501` | El guardia de alcance caza la incoherencia (firma, usuario) antes que la política de 017. Si el guardia desapareciera, la política volvería a contestar `42501` y la prueba seguiría siendo válida |

| Archivo | Pruebas | Agente |
|---|---|---|
| `tests/gates/esquema.test.ts` | 20 | A2 |
| `tests/gates/ola0.test.ts` | 35 | A2 |
| `tests/gates/seguridad.test.ts` | 35 | A12 |
| `tests/gates/autenticacion.test.ts` | 30 | A12 |
| `tests/adversarial/compuerta-ola0.test.ts` | 40 | **A14** — las cuatro pruebas de la compuerta, reescritas desde cero |
| `tests/adversarial/evasion.test.ts` | 32 | **A14** — rutas de evasión, D-030, D-031, D-023, D-024 |
| `tests/adversarial/valores-tributarios.test.ts` | 7 | **A14** — Regla de Oro 2, barrido del código fuente |
| `tests/adversarial/casos-dorados.test.ts` | 2 + 22 `todo` | **A14** — los 20 casos dorados, honestamente sin implementar |

---

## Sección 14.1 — recorrido punto por punto del "día uno", con su estado REAL

Cuatro estados, sin ambigüedad: **implementado** (está en código y hay una prueba que lo demuestra),
**configuración de despliegue** (no es código; hay que hacerlo al desplegar y dejar constancia),
**documentado** (existe el documento, falta la revisión jurídica y los datos de la sociedad),
**pendiente** (no está).

| # | Punto de la 14.1 | Estado real | Dónde / qué falta |
|---|---|---|---|
| 1 | **RLS activa en todas las tablas de datos, doble nivel tenant/company** | **implementado** | `012_rls.sql`. Verificado **desde el catálogo** (`pg_class`, `pg_policies`), no desde una lista: RLS habilitada **y forzada** en toda tabla de `public` salvo `schema_migration`. Además un **barrido de comportamiento** consulta todas las tablas con `tenant_id` y con `company_id` desde una sesión y confirma cero filas ajenas. `tests/gates/seguridad.test.ts` |
| 1b | *(añadido por A12)* **El contexto de aislamiento no lo elige la sesión** | **implementado** | Cierre de D-020. `015`. El tenant se deriva del token verificado; `app.tenant_id` quedó inerte y hay prueba de ello |
| 2 | **Cifrado en tránsito (TLS)** | **configuración de despliegue** | No hay dominio productivo todavía. Exigencias escritas en `docs/cifrado-y-proteccion-de-datos.md` §1: TLS 1.2+, HSTS, cookies `Secure/HttpOnly/SameSite`, y **`sslmode=verify-full`** en `DATABASE_URL` (no `require`, que cifra pero no verifica identidad). **A15 debe ejecutarlo y archivar la constancia** |
| 3 | **Cifrado en reposo** | **configuración de despliegue** (volumen y respaldos) + **implementado** (sobre de aplicación) | El cifrado del volumen y de los respaldos lo da el proveedor gestionado; hay que confirmarlo en el plan contratado y archivar la constancia. Lo que **sí** es código: el secreto TOTP va envuelto en AES-256-GCM con clave fuera de la base (D-028), las contraseñas se derivan con scrypt (irreversible) y del token de sesión solo se guarda su `sha256`. `docs/cifrado-y-proteccion-de-datos.md` §2 |
| 4 | **Autenticación con MFA disponible** | **implementado** | TOTP RFC 6238 en `src/auth/totp.ts`, verificado contra los vectores de RFC 4226 y RFC 6238. Secreto cifrado. Sesiones con vencimiento (8 h; tope duro de 24 h en la BD), revocación individual y masiva, bloqueo tras 5 intentos fallidos, respuesta de tiempo constante ante correo inexistente. **MFA *obligatorio* por rol: pendiente** (requiere interfaz de A7/A8) |
| 5 | **Roles y permisos granulares (5 roles mínimos)** | **implementado** | Los cinco roles y 25 permisos ya existían como datos (`014`). A12 los volvió **restricción del motor** (`016`, D-025): trigger `BEFORE` en 31 tablas que rechaza con `SE002`. Probado: el auxiliar de causación no edita parámetros ni aprueba ni publica; el contador no crea vigencias de tarifas; el rol de solo lectura **no escribe en ninguna** de las tablas protegidas (barrido por catálogo) |
| 6 | **`audit_log` de toda acción sensible** | **implementado** | Append-only impuesto por la BD (`AU001`), ni el superusuario lo altera. Cubre aprobaciones, ediciones de parámetros, cambios de mapeo PUC y de plan de cuentas, **accesos denegados a datos de otra empresa**, **inicios de sesión fallidos**, cierres de sesión, creación/publicación/reversa de asientos, cierre de período y cambios de usuarios y accesos. Registra usuario, `ocurrido_en`, IP, agente y petición. **Las credenciales se redactan antes de escribir** (D-029) |
| 7 | **Política de tratamiento de datos personales y aviso de privacidad** | **documentado** | `docs/politica-tratamiento-datos-personales.md` y `docs/aviso-privacidad.md`. Ley 1581/2012, Decreto 1377/2013, Decreto 1074/2015. **Falta:** revisión jurídica, datos de la sociedad y publicación |
| 8 | **Contrato de transmisión con el cliente (encargado del tratamiento)** | **documentado** | `docs/contrato-encargado-tratamiento.md`, con el contenido del art. 2.2.2.25.5.2 del Decreto 1074/2015: sujeción a instrucciones, seguridad y confidencialidad, y devolución o supresión al terminar. **Falta:** revisión jurídica y firma |
| 9 | **Cláusulas de transferencia internacional** | **documentado** | `docs/clausulas-transferencia-internacional.md`. Se dice con todas las letras que **EE. UU. no está en el listado de países adecuados de la SIC** y se sustenta el flujo en la cadena de **contratos de transmisión** (art. 2.2.2.25.5.1) más autorización expresa. **Falta:** verificar vigencia y numeración exacta de la circular de la SIC y firmar el clausulado con cada proveedor |
| 10 | **Términos y condiciones con limitación de responsabilidad por cálculo tributario** | **documentado** | `docs/terminos-y-condiciones.md` §7, apoyado en los arts. 571, 572 y 581 del Estatuto Tributario y en que **la aprobación humana es un control técnico real**, no una formalidad. **Falta:** revisión jurídica; advertencia expresa sobre el art. 43 de la Ley 1480/2011 si alguna vez hay consumidores |
| 11 | **Procedimiento de consultas y reclamos de titulares** | **documentado** | `docs/procedimiento-consultas-y-reclamos.md`. Plazos de los arts. 14 y 15 de la Ley 1581/2012 (10 y 15 días hábiles, con sus prórrogas), leyenda "reclamo en trámite" en 2 días hábiles y traslado por incompetencia. **Falta:** designar formalmente el área responsable y abrir el buzón |
| 12 | **Procedimiento de reporte de incidentes a la SIC (15 días hábiles)** | **documentado, con dos puntos abiertos** | `docs/procedimiento-incidentes-sic.md`. **Abierto y escrito como tal:** (a) el canal de reporte está asociado al RNBD y **no estamos inscritos** por no superar el umbral del Decreto 090/2018, aunque el deber sustancial subsiste — hay que confirmar el canal correcto **antes** del primer incidente; (b) hay que citar la instrucción vigente que fija los 15 días. Además, **el procedimiento nunca se ha ejercitado con un simulacro** |
| 13 | **Retención de datos por 10 años con reproducción exacta** | **documentado + parcialmente implementado; la prueba falta** | `docs/politica-retencion-datos.md`, art. 28 de la Ley 962/2005. Lo implementado que la sustenta: ledger inmutable, parámetros versionados por vigencia, `audit_log` inalterable, XML original con su hash. **Pendiente real:** no hay rutina automática de supresión al vencimiento (hoy es manual y con autorización), no hay archivo histórico de bajo costo, y **no se ha hecho un ejercicio de restauración que verifique la reproducción exacta** |
| 14 | **Respaldos automáticos con prueba de restauración** | **configuración de despliegue + PENDIENTE la prueba** | Los respaldos los provee el Postgres gestionado; falta contratar y dejar constancia de la ventana de recuperación. **La prueba de restauración NO se ha ejecutado.** Sin ella, la reproducción exacta está afirmada, no verificada. Corresponde a **A15** |

**Lo que la 14.2 dice que puede esperar, y que efectivamente NO se hizo:** RNBD (no aplica hasta
100.000 UVT en activos, ~$5.237.400.000 para 2026, Decreto 090 de 2018 art. 1), certificaciones
ISO 27001 / SOC 2, y habilitación DIAN. Están declarados como no hechos en `docs/README.md`.

---

---

## Qué le falta al sistema para tener un PRIMER CLIENTE REAL operando

> Sección escrita por A0 el 2026-08-31, a petición del usuario. **Solo lista, no resuelve.**
> Distingue tres cosas que se confunden con facilidad: lo que impide **probar** (nada, ya se puede),
> lo que impide **operar con un cliente real**, y lo que impide **vender el servicio a terceros**.
> El sistema hoy: 914 pruebas en verde, los 20 casos dorados pasando, las 3 olas cerradas y
> verificadas de forma adversarial, y la secuencia de arranque corrida de punta a punta por A14
> contra PostgreSQL real.

### A. Bloqueos duros — sin esto NO se puede operar con un cliente real

| # | Qué falta | Por qué bloquea | Dueño |
|---|---|---|---|
| A-1 | **Verificación humana de los datos normativos faltantes** | El motor se niega a calcular lo que no sabe (correcto), pero eso significa que hoy **no puede liquidar** ICA en Bogotá ni Cali por actividad, ni autorretención por CIIU fuera de 4 ejemplos, ni retención de salarios. Un cliente real con esas operaciones queda a medias. Ver «Pendiente de verificación normativa humana» | **Humano con las fuentes** |
| A-2 | **Un XML real de la DIAN, extremo a extremo** | Los 11 fixtures son construidos a mano, no capturas de producción. A4 dejó 5 puntos a re-verificar: autenticidad del CUFE, su ubicación y `schemeName` exactos, códigos DIAN reales, el bloque `DianExtensions` (que no se lee) y la forma real del `AttachedDocument` de un proveedor tecnológico | A4 + humano |
| A-3 | **Buzón de correo real y proveedor de inbound email** | El pipeline existe y está probado, pero **no hay proveedor contratado**. Sin esto las facturas hay que cargarlas a mano | A13 + humano |
| A-4 | **Prueba de restauración de respaldos** | La 14.1 la exige y **nunca se ha ejecutado**. Hoy la conservación a 10 años con reproducción exacta está *afirmada*, no verificada. Es requisito legal (art. 28 Ley 962 de 2005) | A15 + humano |
| A-5 | **Revisión jurídica de los 8 documentos de cumplimiento** | Están redactados y citan la norma, pero ningún abogado los ha visto. Incluye actualizarlos para nombrar al proveedor de LLM (EE. UU., país sin nivel adecuado según la SIC) | **Abogado** |

### B. Operativamente necesario — se puede arrancar sin ello, pero duele pronto

| # | Qué falta | Consecuencia real | Dueño |
|---|---|---|---|
| B-1 | **Pantalla de inscripción de MFA** | El motor TOTP está completo, pero un usuario **no puede activárselo solo**. La 14.1 pide MFA *disponible*: hoy lo está a medias | A12 |
| B-2 | **V-11: cabecera de IP en el despliegue** | La aprobación falla con mensaje claro si falta `x-forwarded-for`/`x-real-ip`, pero **nadie garantiza que el proxy la envíe**. Si no llega, no se puede aprobar nada | A15 |
| B-3 | **`company.es_agente_retencion_*` con valor por defecto** | Misma familia que V-20: una empresa recién creada **solo practica retefuente** hasta que alguien active IVA e ICA. Es configuración que el operador conoce, pero silenciosa | A2 + A12 |
| B-4 | **Pantallas de administración que faltan** | No son editables desde la interfaz: PUC y mapeo NIIF, alta de municipios y CIIU nuevos, matriz de agentes de ReteIVA, calendario tributario, formatos de exógena, y conceptos de causación. El modelo de datos los soporta; falta la pantalla | A8 |
| B-5 | **Marcar las cuentas de efectivo** | Sin ello el Estado de Flujos de Efectivo **sale vacío** (con su papel de trabajo, correctamente). Es configuración de una vez por empresa | Humano, por A8 |
| B-6 | **Causación de ventas** | El producto solo procesa facturas de **compra**, por diseño. Los formatos 1003 y 1006 de exógena quedan incompletos salvo que las ventas se causen por otra vía | Fuera de alcance del mega-prompt |

### C. Antes de vender el servicio a terceros

| # | Qué falta | Dueño |
|---|---|---|
| C-1 | Despliegue real en Render Starter, con `DATABASE_URL` de Postgres gestionada, `APP_ENCRYPTION_KEY` rotable y respaldos activos | A15 + humano |
| C-2 | Ejercitar el procedimiento de incidentes ante la SIC — **nunca se ha ensayado**, y el canal está atado al RNBD, al que no estamos inscritos | A12 + humano |
| C-3 | Prueba de carga real: la §12 pide 5.000 facturas en cola sin degradar el request HTTP. Con `ANALYZE` resuelto (84 s → 6-13 ms) el camino está despejado, pero **no se ha corrido a ese volumen** | A15 |
| C-4 | Conciliación contra el portal de la DIAN. El canal de correo **no es exhaustivo al 100 %** y el producto debe ofrecerla (§10.1) | A4 + A7 |
| C-5 | Archivado en frío del XML. El espacio está reservado (migración 031) y A15 calculó que a 10 años **rompe el techo de USD 50/mes** si vive en la Postgres transaccional. No implementado | A15 + A4 |

### Lo que NO falta

Para que quede dicho, porque es fácil suponer lo contrario: el ledger inmutable, el aislamiento entre firmas, el motor de retenciones con sus 20 casos dorados, la parametrización sin desplegar código, la memoria de clasificación que evita llamar al LLM, la bandeja multiempresa con aprobación en lote, los libros y estados financieros en Excel, la exógena, el arranque sin SQL y los datos de ejemplo **están construidos, probados y verificados de forma adversarial**. Lo que falta arriba es casi todo **dato, contrato, despliegue o juicio humano** — no motor.


## Pendiente de verificación normativa humana

Estado al cerrar la Ola 1. **A1 no inventó ni un valor**, y eso se comprobó: las 28 filas de `tax_rule`
declaran su `norma_respaldo`, y las 5 que la sección 17 marca como de referencia llevan
`requiere_verificacion_humana = true`. Censo real de lo que dejan los seeds: `uvt_value` 2,
`tax_concept` 23, `tax_rule` 28 (18 retefuente, 4 autorretención, 3 IVA, 2 ReteIVA, **1 ReteICA —
Medellín**), `rounding_rule` **1** (parámetro operativo global, D-046), `municipality` 6,
`municipality_ica_rule` 4, `ciiu_activity` 7, `account` 111, `niif_mapping` 68, `exogena_format` 12,
`smmlv_value` 0, `tax_calendar` 0.

| Dato | Motivo | Estado |
|---|---|---|
| Tarifas de retefuente **anteriores** al 1-jul-2026 | La sección 7.2 solo trae la tabla posterior al Decreto 572 | pendiente. Afecta al caso dorado 16 en su forma literal; A14 lo verificó con el borde real 30-jun/1-jul, que es el mismo fenómeno con datos verdaderos |
| Tarifas de ICA **por actividad** de Bogotá (incluido el 7,66‰ de profesiones liberales) y **todas** las de Cali | La sección 7.5 no trae la tabla del Decreto 352 de 2002 ni ningún número del Acuerdo 0321 de 2011, y el código municipal de Bogotá no cabe en el esquema | pendiente. **V-5: primero decide A2 el esquema, después se carga lo verificable.** Es el único hueco de datos que queda tras el desbloqueo, y no bloquea la ola (D-048) |
| ReteICA Bucaramanga (bases ~25/~50 UVT) y Cartagena | Marcados *(verificar)* en la sección 7.5 | pendiente. No hay valor que copiar |
| Tabla completa de autorretención por CIIU | La sección 7.3 da 4 valores de ejemplo, no la tabla | pendiente, y las 4 filas cargadas llevan `requiere_verificacion_humana` |
| Tabla progresiva de retención por salarios (art. 383 ET) | La sección 7 da el umbral y el rango, no los tramos marginales | pendiente. Ningún caso dorado la ejercita |
| SMMLV y auxilio de transporte por año | La sección 7 no trae valores | pendiente. Ningún caso dorado los ejercita |
| Calendario tributario (`tax_calendar`) | La sección 7.7 da las ventanas de exógena pero no el escalonamiento por dígito de NIT | pendiente. Ningún caso dorado lo ejercita |
| Honorarios PN al 11% por acumulado anual > 3.300 UVT | Exige un acumulado por tercero y año gravable que hoy no tiene dónde vivir | **declarado por A3, no resuelto en silencio.** Ningún caso dorado lo ejercita |
| PUC y mapeo NIIF cargados | Reconstruidos de memoria por A1, no transcritos del Decreto 2650 ni del 2420 | pendiente de cotejo antes de producción |
| Modo y múltiplo de redondeo por defecto (`peso_half_up`) | **No es un dato normativo**: no hay decreto que citar. Es un parámetro operativo, y la tabla donde vive no puede expresar una tarifa (D-046) | **cargado y aceptado.** Cualquier firma lo sobreescribe con datos, sin tocar código — probado |
| Tarifas Decreto 572 de 2025 | En etapa cautelar; fallo de fondo abierto (exp. 30229) | vigente, con riesgo documentado. La Regla 3 lo absorbe sin migración ni redespliegue — probado |
| Un XML **real** de la DIAN | Los 11 fixtures son construidos a mano; el CUFE no es criptográficamente auténtico | pendiente antes de producción. A14 amplió la cobertura con variantes hostiles, pero ninguna sustituye una captura real |

---

## Presupuesto

Sin reporte de A15 todavía. Techo: USD 20/mes (fase inicial) → USD 50/mes (con clientes).
Referencia de costo de IA: USD 0,01–0,02 por factura antes de caché.

**La Ola 1 sumó una sola dependencia** (`fast-xml-parser`, para el parser UBL de A4); scrypt, HMAC y
AES-256-GCM siguen saliendo de `node:crypto`. La cola de A6 vive **en la misma PostgreSQL**: sin Redis y
sin broker, tal como exige la sección 5.

---

## Próximo paso

**OLA 4 ENTREGADA por A16 (2026-09-01). PENDIENTE: la compuerta de A14.** Nada de la Ola 4 está cerrado
hasta que A14 lo verifique él mismo, sin creerle a este documento. Estado medido por A16: **993 pruebas en
verde** (48 archivos), `npx tsc --noEmit` limpio, `npx next build` exit 0 con **28 rutas**.

Qué tiene que atacar A14, en orden de riesgo:

1. **El blindaje del rol todopoderoso (D-066).** Está en `tests/adversarial/compuerta-ola4.test.ts`, pero
   lo escribió quien construyó el blindaje. A14 debería intentar degradarlo por caminos que a A16 no se le
   ocurrieron: `ALTER TABLE ... DISABLE TRIGGER`, un `UPDATE` sobre `pg_trigger`, revocar el acceso del
   único usuario que lo tiene en vez de tocar el rol.
2. **La carga masiva como puerta a otra firma.** Un archivo no nombra empresa ni firma en ninguna columna,
   y la RLS gobierna la escritura; A14 debería comprobar que eso aguanta con una columna extra inventada,
   con un `codigo_dane` que ya existe en la firma de al lado, y con la sesión de una empresa a la que el
   usuario perdió el acceso a mitad de la carga.
3. **`v_account_efectivo` con `security_invoker`.** Es una vista nueva en el camino de los reportes y del
   ledger: conviene un `SET ROLE app_user` directo comprobando que no enseña ni una cuenta de otra firma,
   y que `app.puc_solo_propio()` no se puede engañar escribiendo `company_setting` de otra empresa.
4. **La aprobación jerárquica (D-068).** El cambio de comportamiento más delicado de la ola: desde ahora
   `obtenerCorreccionesVigentes` filtra por `estado = 'aprobado'`. A14 debería confirmar contra el motor
   que una corrección pendiente no altera NINGÚN cálculo, y que aprobarla no reescribe un asiento ya
   publicado.
5. **Las dos pruebas suyas que A16 acotó**, con la justificación escrita en «Ola 4 — qué entregó A16».
   Son exactamente el caso de D-047: A14 revisa el diff, no el reporte.

Ficheros nuevos de la Ola 4:

- `db/migrations/170_a16_ola4_operacion_real.sql`
- `src/services/puc.ts`, `src/services/catalogos.ts`, `src/services/administracion.ts`
- `src/services/carga-masiva/` (`definiciones.ts`, `valores.ts`, `tabla.ts`, `importar.ts`, `plantilla.ts`)
- `src/reports/diagnostico.ts`
- `scripts/generar-plantillas-masivas.ts` + `/archivos-masivos/` (quince `.xlsx` y su `LEEME.md`)
- `app/_navegacion.tsx`, `app/carga-masiva/**`, `app/api/plantillas/[catalogo]/route.ts`,
  `app/parametros/puc/**`, `app/admin/**`, `app/cambiar-password/**`
- `tests/services/ola4-carga-masiva.test.ts`, `tests/adversarial/compuerta-ola4.test.ts`,
  `tests/app/reportes-diagnostico.test.ts`

Ficheros existentes que A16 tocó: `app/layout.tsx`, `app/page.tsx`, `app/reportes/page.tsx`,
`app/parametros/page.tsx`, `app/terceros/[id]/actividades/{page.tsx,acciones.ts}`,
`app/api/reportes/[libro]/route.ts`, `src/services/terceros.ts`, `src/services/bandeja.ts`,
`src/auth/permisos.ts`, `next.config.ts`, `package.json`, `tsconfig.json`, y las dos pruebas de A14
declaradas arriba.

---

## Próximo paso — lote posterior a la Ola 3 (histórico)


**LOTE POSTERIOR A LA OLA 3 APROBADO por A14 (2026-08-31).** Verificado punta a punta contra un
PostgreSQL real, corriendo la secuencia completa del README como la correría el usuario que no
programa. Los tres criterios pasan con las correcciones de A14 incorporadas: **914 pruebas en verde**
(45 archivos), typecheck limpio, `npx next build` exit 0 (19 rutas). Falta únicamente el **commit de
cierre, que lo hace A0** (A14 no hace commits).

Ficheros que A14 tocó en esta pasada:

- `db/migrations/160_a14_v20_atributos_fiscales_sin_default.sql` — **nuevo**: quita el `DEFAULT` de las
  diez columnas fiscales de `third_party_fiscal_attribute` (V-20).
- `next.config.ts` — **nuevo**: `agentRules: false`, para que `npm run dev` deje de reescribir
  `CLAUDE.md` (V-22).
- `tests/adversarial/valores-tributarios.test.ts` — el barrido de la Regla de Oro 2 alcanza el código
  ejecutable de la raíz del repositorio, con su aserción de cobertura (V-21).
- `tests/adversarial/evasion.test.ts` — 12 pruebas de regresión de V-20.
- `tests/helpers/fixtures.ts`, `tests/golden/_escenario.ts`, `tests/gates/arranque.test.ts` — las tres
  llamadas que se apoyaban en el `DEFAULT` ahora declaran las nueve banderas a la vista.
- `ESTADO_PROYECTO.md`.

### Lo que queda abierto, con dueño

Ninguno bloquea una compuerta; todos son deuda conocida antes de producción.

| Qué | Quién | Gravedad |
|---|---|---|
| **V-11** — la aprobación desde la bandeja revienta si el despliegue no reenvía la IP del cliente | **A7** + **A15** | Media |
| **V-5** — no hay tarifas de ReteICA por actividad para Bogotá ni Cali (dato normativo faltante, no inventado) | **verificación humana** + **A1** | Media (dato) |
| `company.es_agente_retencion_*` con valor por defecto: la misma familia de V-20, en la empresa en vez de en el tercero | **A2** + **A12** | Baja-media |
| No hay pantalla de inscripción de MFA: hoy el secreto lo siembra un operador | **A12** | Media antes de producción |
| Prueba de restauración de respaldos (de ella depende la «reproducción exacta» del punto 13 de la 14.1) | **A15** | Alta antes de producción |
| Simulacro de incidente y revisión jurídica de los documentos de habeas data | **humano** + **A12** | Alta antes de producción |
| Prueba de carga de 5.000 facturas en cola (§12) | **A6** + **A13** + **A15** | Sin dueño efectivo desde la Ola 2 |
| Datos normativos pendientes de verificación humana (ver su sección) | **humano** + **A1** | Alta antes de producción |

### Advertencias que salen de esta verificación, para quien retome

- **Tres capas de aplicación no son tres capas** (V-20). Si la garantía tiene que sostenerse, la última
  capa es el motor: mientras la columna tenga `DEFAULT`, el `INSERT` que omite el dato no falla, lo
  inventa. Un `DEFAULT` es la forma en que un dato faltante se vuelve invisible — exactamente lo que la
  advertencia 17.5 prohíbe.
- **Una salvaguarda solo cubre lo que enumera** (V-21). El detector de la Regla de Oro 2 barría tres
  directorios; el primer archivo ejecutable que apareció fuera de ellos quedó invisible. Toda lista de
  rutas necesita una aserción que se caiga cuando alguien saque algo de la lista.
- **Una dependencia puede escribir en el archivo de reglas del proyecto** (V-22). `next dev` reescribía
  `CLAUDE.md` en cada arranque e invitaba a comitearlo. Revertirlo a mano no es cerrarlo.
- **Verificar «el usuario puede usarlo» exige correrlo, no leerlo.** El defecto de A15 (nadie ejecutaba
  la cola en producción) solo se confirma viendo `document_processing_job.tomado_por = web-<pid>`
  después de levantar el servidor de verdad.
- **Con PGlite, cada comando sin `DATABASE_URL` vive en su propia base desechable.** Es correcto y está
  documentado, pero es la primera piedra con la que tropieza quien no programa.

---

<details>
<summary>Próximo paso tras la Ola 3 (histórico, superado por el lote posterior)</summary>

### Próximo paso — cierre de la Ola 3 (histórico)

**OLA 3 CERRADA por A14 (2026-08-31), en la segunda pasada. Con ella se cierra la última ola del plan de
la sección 4.** Los dos criterios de salida pasan, más `npx next build`. Falta únicamente el **commit de
cierre, que lo hace A0** (A14 no hace commits).

Estado del árbol al cerrar: **849 pruebas en verde**, 43 archivos, typecheck limpio, `next build` exit 0
con 13 rutas (incluidas `ƒ /api/reportes/[libro]` y `ƒ /reportes`). Ficheros que A14 tocó en la segunda
pasada:

- `app/api/reportes/[libro]/route.ts` — `Object.hasOwn` en el despacho por slug (V-19, D-061).
- `tests/adversarial/compuerta-ola3-ruta.test.ts` — **nuevo**: los veinte libros por HTTP, la prueba de
  «ningún libro huérfano» y los nueve ataques a la ruta.
- `ESTADO_PROYECTO.md`.

(De la primera pasada: `src/services/cierre.ts`, `tests/adversarial/compuerta-ola3.test.ts`,
`tests/adversarial/compuerta-ola3-entregas.test.ts` y `tests/adversarial/valores-tributarios.test.ts`.)

### Lo que queda abierto al cerrar el plan de olas, con dueño

Ninguno bloquea una compuerta; todos son deuda conocida antes de producción.

| Qué | Quién | Gravedad |
|---|---|---|
| **V-17** — no hay maestro de terceros: impide completar el Formato 1001 y, más grave, **impide causar la factura de un proveedor que nadie haya insertado por SQL**. Hoy no se pone en marcha un cliente nuevo sin acceso a la base | **A8** | Media-alta como producto |
| **V-18** — las advertencias de alcance de los formatos 1003/1006 no llegan al Excel que revisa el contador | **A11** | Baja |
| **V-11** — la aprobación desde la bandeja revienta si el despliegue no reenvía la IP del cliente | **A7** + **A15** | Media |
| **V-1** — `app.resolver_empresa_por_buzon` sigue concedida a `app_user` | **A4** + **A12** | Baja |
| **V-5** — el código de actividad de ICA municipal de Bogotá (5 dígitos) no cabe en `ciiu_activity` | **A2**, luego **A1** | Media (dato) |
| Prueba de carga de 5.000 facturas en cola (§12) | **A6** + **A13** + **A15** | Sin dueño efectivo desde la Ola 2 |
| `ANALYZE` tras una carga masiva, o los primeros reportes de esa empresa se arrastran (D-057) | **A15** | Operativa |
| Datos normativos pendientes de verificación humana (ver su sección) | **humano** + **A1** | Alta antes de producción |

### Advertencias que salen de esta verificación, para quien retome

- **Un módulo sin consumidor no está terminado** (V-16, D-062). Y la comprobación no es «existe una ruta»,
  sino «no queda ningún libro huérfano»: se enumeran los exports y se exige que todos estén cableados.
- **Si la clave la elige el cliente, la búsqueda se hace por propiedad propia** (V-19, D-061). `obj[clave]`
  con clave externa recorre el prototipo, y `constructor` es una función invocable.
- **Cuando una prueba compara A con B, hay que mirar si A y B leen de la misma fuente** (D-057).
- **La idempotencia por clave no protege del solape** (D-058): toda operación idempotente sobre un *rango*
  debe decidir qué pasa cuando el rango nuevo se cruza con uno anterior.
- **Si una prueba con datos de verdad tarda de más, mide antes de acusar al diseño** (D-057): 159 s
  pasaron a 4 ms con un `ANALYZE`.

---


</details>

---

## Próximo paso — Ola 3 despachada (histórico)

**OLA 2 CERRADA por A14.** Los tres criterios de la sección 4 pasan, verificados con pruebas propias y
**por la interfaz real**. Falta únicamente el **commit de cierre, que lo hace A0** (A14 no hace commits).
Después de eso, despachar la **Ola 3** (A9, A10, A11).

Estado del árbol al cerrar: **603 pruebas en verde**, 32 archivos, typecheck limpio, cero `todo`.
Ficheros que A14 tocó en esta pasada y que entran en el commit de cierre:

- `src/services/causacion.ts` — `SAVEPOINT` por ítem en `aprobarAsientosEnLote` (D-050).
- `tests/adversarial/valores-tributarios.test.ts` — salvaguarda restituida y canario reparado (D-049).
- `tests/adversarial/compuerta-ola2.test.ts` — **nuevo**.
- `tests/adversarial/compuerta-ola2-interfaz.test.ts` — **nuevo**.
- `ESTADO_PROYECTO.md`.

### Condiciones que A0 debe trasladar a la Ola 3

1. **A7 + A15 — V-11, la IP de la aprobación.** `approval.ip` es `NOT NULL` y la bandeja solo lee
   `x-forwarded-for`. Sin esa cabecera, aprobar devuelve un error crudo de PostgreSQL. A7: leer también
   `x-real-ip` y, si no hay ninguna, dar un mensaje accionable en vez de propagar el error del motor.
   A15: garantizar la cabecera en el despliegue. **Es lo único abierto que toca un criterio de salida.**
2. **A4 + A12 — V-1, ya desbloqueada.** Mover el `GRANT` de `app.resolver_empresa_por_buzon` fuera de
   `app_user` ahora que el rol de sistema del canal de correo existe (D-054). Ojo: el camino de A4
   (`src/ingest/persistencia.ts`) todavía la llama, así que la corrección incluye decidir si ese camino
   se retira en favor del de A13 o se le da su propia autenticación.
3. **A2 — V-5, el esquema del código de actividad de ICA municipal.** Sigue siendo la única deuda de
   datos. `ciiu_activity` exige 4 dígitos; Bogotá usa `74901`, de 5.
4. **A6 + A13 + A15 — la prueba de carga** de 5.000 facturas en cola sin degradar el request HTTP
   (sección 12, pruebas adicionales). Era advertencia para la Ola 2 y nadie la tomó.
5. **A5 — los pendientes que él mismo dejó anotados**: no hay job de cola para clasificación (A5-2) y la
   bandeja de revisión de clasificación no tiene interfaz (A5-3, es de A7).
6. **A1 — cargar lo que quede verificado** de `smmlv_value` y `tax_calendar` cuando un humano aporte los
   valores. Ningún caso dorado depende de ello.

### Advertencias para la Ola 3 que salen de esta verificación

- **Toda pantalla nueva se prueba por su acción de servidor, no por el servicio** (D-056). Probar el
  servicio deja sin verificar precisamente la costura donde el cliente elige qué enviar, que es donde
  vive el contador hostil. El patrón ya está montado en
  `tests/adversarial/compuerta-ola2-interfaz.test.ts`: se simulan `next/headers`, `next/navigation` y
  `app/lib/db.ts`, y **nada más**.
- **Todo bucle que escriba dentro de una sola transacción necesita `SAVEPOINT` por ítem.** Ya van dos
  (D-043 en la causación, D-050 en la aprobación en lote) y las dos veces el `try/catch` parecía
  suficiente y no lo era: un error del motor aborta la transacción entera y el `catch` solo colecciona
  `25P02`. A9/A10/A11 van a escribir en lote (cierres, ajustes, exportaciones): aplíquenlo desde el
  principio.
- **Acotar una salvaguarda es la dirección peligrosa** (D-049). Se puede hacer, y A8 tenía razón en la
  necesidad; lo que no se puede es sustituir la salvaguarda por una **afirmación** («las otras reglas ya
  lo cazan») sin comprobarla. A14 la comprobó y era falsa en cuatro formas. Quien acote algo de A14, que
  traiga el canario que demuestre que lo que quita sigue cubierto.
- **Un contador que no sube no prueba nada; una mina que no explota, sí** (D-052). Para «no se llamó a
  X», el instrumento correcto es un doble que **revienta** al ser llamado, más un espía en la frontera
  del proceso — no un contador que solo vigila el objeto que la propia prueba inyectó.
- **Una función `SECURITY DEFINER` nueva se declara en las DOS copias del inventario** (D-042) **y se
  audita como oráculo de existencia**: misma respuesta ante un identificador ajeno real y uno inventado.
  Diez funciones nuevas pasaron esa prueba en esta ola; la undécima tendrá que pasarla también.
- **`db/seeds` sigue siendo dato, `src/` sigue siendo código.** Un `INSERT` normativo en `src/` o `app/`
  solo puede llevar parámetros ligados. Si una pantalla necesita escribir un valor, el valor viene del
  formulario en un `$n`, nunca escrito en la sentencia.

### Lo que queda listo y no hay que rehacer

- Todo lo de las Olas 0 y 1 (esquema, RLS, ledger, vigencias, motor, parser, cola, servicios, datos).
- **La clasificación asistida y la memoria de A5**: determinista, con catálogo cerrado, sin ruta de red
  estática y con el caso dorado 19 cerrado de verdad.
- **La bandeja multi-empresa de A7**: una sesión por empresa, sin atajos que rompan D-021/D-022,
  verificada a escala real (31 empresas, 50 aprobaciones) y contra dos ataques de falsificación.
- **El módulo de parametrización de A8**: primera interfaz del repositorio, con las seis conductas de
  §6.2 y el simulador de impacto; verificado por su acción de servidor y contra el contador hostil.
- **El canal de integración de A13**: token de máquina que desemboca en el `abrir_sesion` intacto, rol de
  sistema de mínimo privilegio real, y los seis workflows de n8n sin una línea de lógica tributaria.
- El harness `tests/helpers/` y las **siete** suites adversariales de A14.

---

<details>
<summary>Próximo paso de la Ola 1 (histórico, cerrado)</summary>

### Próximo paso — Ola 1 (histórico)

**OLA 1 CERRADA por A14.** Los cuatro criterios de la compuerta pasan, verificados con pruebas propias, y
—lo que decidía el cierre— el pipeline produce asientos publicados **con el repositorio tal como está**,
sin que ninguna prueba inserte un parámetro a mano. Falta únicamente el **commit de cierre, que lo hace
A0** (A14 no hace commits). Después de eso, despachar la **Ola 2** (A5, A7, A8, A13).

### Condiciones que A0 debe trasladar a la Ola 2

1. **A2 — decidir el esquema del código de actividad de ICA municipal.** `ciiu_activity` exige 4 dígitos;
   Bogotá usa `74901`, de 5. Hasta que se decida (ampliar el CHECK o modelar una tabla de actividades
   municipales aparte), la ReteICA por actividad de Bogotá y Cali es inalcanzable y los casos dorados 9 y
   10 conservan su tarifa sobre andamiaje. **Es la única deuda de datos que queda** (V-5, D-048).
2. **A12 + A4 — mover el `GRANT` de `app.resolver_empresa_por_buzon`** de `app_user` al rol de sistema del
   canal de correo, en cuanto ese rol exista, y revocarlo de `app_user` (V-1, D-042).
3. **A12 + A6/A13 — la sesión de sistema del canal de correo** (V-9). Sin ella el correo entra pero nadie
   puede escribir por él.
4. **A7 — dos campos editables en la bandeja** que hoy dejan dos casos dorados sin canal real: el **AIU por
   línea** (V-7) y el **municipio de la operación** cuando difiere del domicilio del proveedor (V-8).
5. **A1 — cargar lo que quede verificado** de las tablas todavía vacías (`smmlv_value`, `tax_calendar`) y
   de las municipales pendientes, cuando un humano aporte los valores. Ningún caso dorado depende de ello.

### Advertencias para la Ola 2 que salen de esta verificación

- **A5**, al construir la clasificación: el caso dorado 19 está a medio verificar y la mitad que falta es
  suya. Lo probado hoy es que **no hay ninguna ruta de red en todo `src/`** y que la segunda factura del
  mismo proveedor con la misma descripción se resuelve desde `memoria_clasificacion` sin crear filas
  nuevas. Cuando exista el LLM, la prueba tiene que **contar llamadas**, no suponerlas.
- **A5**: `src/ai/` hará **fallar** el canario de inventario de módulos de `src/` (D-044). Es a propósito:
  se declara el módulo y se comprueba que el barrido de la Regla 2 lo cubre.
- **A8**, al construir la parametrización: el mecanismo ya está probado tres veces —`tax_rule`,
  `uvt_value` y `rounding_rule`—: cerrar la vigencia e insertar la nueva cambia lo posterior, no toca lo
  publicado y no exige redespliegue. Lo que falta es la pantalla, no el motor. Y ojo con D-046: si alguna
  pantalla permite cargar un parámetro **sin norma**, la tabla destino debe ser incapaz de expresar una
  tarifa.
- **Cualquiera que toque el ledger, la cola o los seeds**: las garantías las impone la base, no el
  TypeScript, y hay una prueba por cada una que se salta el servicio y ataca la tabla directamente. Una
  migración que añada una FK necesita su guardia de alcance (D-037) y su trigger de auditoría, o los
  barridos de `tests/gates/esquema.test.ts` y `tests/adversarial/evasion.test.ts` la cazan. Un seed nuevo
  con un `UPDATE` sobre una tabla paramétrica lo caza `valores-tributarios.test.ts` (D-039).
- **Quien toque una prueba de A14**: se puede, y A1 lo hizo bien (D-047). El criterio es el de siempre —
  una aserción se **actualiza al estado nuevo sin bajar la vara**, y quien la toca lo declara. A14 revisa
  el diff, no el reporte.

### Lo que queda listo y no hay que rehacer

- El esquema completo con RLS de doble nivel activa y forzada, y el ledger inmutable (A2, Ola 0).
- El contexto de tenant derivado de un token verificado, con `app.tenant_id` inerte (A12, D-021).
- **El motor determinista de A3**, auditado contra la base y no contra sí mismo.
- **El parser UBL de A4**, incluido el `AttachedDocument` en base64, en CDATA y con prefijos ajenos.
- **La cola y los servicios de A6**, con idempotencia impuesta por `UNIQUE` y concurrencia por
  `FOR UPDATE SKIP LOCKED`.
- **Los datos normativos de A1**: 28 reglas tributarias, todas con norma de respaldo, más el parámetro
  operativo de redondeo.
- El harness `tests/helpers/` y las cinco suites adversariales de A14.

</details>

# ESTADO_PROYECTO.md

> Memoria única entre sesiones. Todo agente lo lee al empezar y lo actualiza al terminar.
> Última actualización: 2026-08-26 — A14 (QA adversarial), al verificar la compuerta de la Ola 0.

## Olas cerradas

| Ola | Agentes | Compuerta | Commit de cierre | Fecha |
|---|---|---|---|---|
| **0 — Fundaciones** | A2, A12, A14 | **PASA las cuatro pruebas**, verificadas de forma independiente por A14 con pruebas propias (`tests/adversarial/`) | *pendiente — lo pone A0* | 2026-08-26 |

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

### D-032 — `journal_line.account_id` admite la cuenta de otra firma. ABIERTA, asignada a A2
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

### D-033 — no hay trigger `ON TRUNCATE` en el ledger ni en el audit_log. ABIERTA, asignada a A2
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

## Vulnerabilidades — registro de A14

| Id | Qué es | Gravedad | Estado | De quién |
|---|---|---|---|---|
| D-030 | Revocación de sesiones cross-tenant + oráculo de actividad ajena | Alta (rompe la Regla 7 en escritura) | **CORREGIDA** por A14 (migración 017) | era de A12 |
| D-031 | `app_auth` forjaba audit_log en cualquier firma, de forma permanente | Media-alta (rompe la Regla 6) | **CORREGIDA** por A14 (migración 017) | era de A12 |
| D-034 | El harness concedía privilegios que las migraciones revocan | Media (invalida pruebas de privilegio) | **CORREGIDA** por A14 | infraestructura de pruebas |
| D-032 | `journal_line.account_id` acepta cuenta de otra firma (FK simple) | Media (integridad contable) | **ABIERTA — no bloquea la Ola 0, BLOQUEA la Ola 1** | **A2** |
| D-033 | Sin trigger `ON TRUNCATE` en ledger ni audit_log | Baja hoy (falta el privilegio), media si alguien despliega como dueño | **ABIERTA — no bloquea la Ola 0** | **A2** |
| D-023 | `app_auth` lee la credencial de cualquier correo conocido | Baja (exige credencial de infraestructura) | **ABIERTA por diseño**, alcance ahora medido y acotado | A12 / arquitectura |
| D-024 | El descenso a `app_user` es reversible en PGlite | No aplica en producción bien configurada | **ABIERTA por diseño**, invariantes comprobables ya automatizadas | **A15 al desplegar** |
| — | La secuencia `audit_log_id_seq` es global: `last_value` deja inferir el volumen de escritura de todo el sistema | Muy baja (canal lateral, sin datos) | **Aceptada**, sin acción | anotación |
| — | `user.email` y `company.buzon_email` son únicos globalmente: permiten saber si un correo está tomado | Muy baja (inherente a un espacio de nombres global de login) | **Aceptada**, sin acción | anotación |

---

## Convenciones establecidas

**Estructura de carpetas**

```
db/migrations/NNN_nombre.sql   Migraciones SQL numeradas, inmutables una vez aplicadas
db/seeds/                      Datos paramétricos (A1). Datos, nunca código
src/domain/                    Motor de reglas, tipos de dominio. Sin I/O
src/services/                  Casos de uso y transacciones (A6)
src/ingest/                    Correo + parser UBL 2.1 (A4)
src/ai/                        Clasificación LLM + memoria (A5)
src/reports/                   Libros, Excel, estados financieros, exógena (A9/A10/A11)
src/db/                        Cliente, runner de migraciones, contexto de sesion (A2 + A12)
src/auth/                      Contrasenas, TOTP, cifrado, sesiones, permisos (A12)
app/                           Next.js App Router: UI y route handlers
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

## Casos dorados — estado actual (revisado por A14)

**Los 20 casos siguen `no implementado todavía`, y el motivo NO es descuido: es que todavía no existe
nada que ejecutarlos pueda medir.** Los veinte calculan retenciones, y calcular una retención exige
tres piezas que la Ola 0 no entrega a propósito:

- los **datos normativos** (UVT, tarifas, bases, municipios) → **A1, Ola 1**. Hoy `uvt_value`,
  `tax_rule`, `municipality_ica_rule` y las demás están **creadas y vacías**, y así deben estar: la
  advertencia 17.5 dice que un valor inventado es peor que uno faltante, porque el faltante se ve.
- el **motor de resolución determinista** → **A3, Ola 1**.
- el **parser UBL 2.1** que produce el hecho económico → **A4, Ola 1**.

**A14 se negó explícitamente a simularlos.** Un caso dorado marcado en verde sin motor de reglas detrás
afirmaría que el sistema calcula bien algo que todavía no calcula nada: es exactamente el falso PASS que
este rol existe para impedir. Están enumerados uno a uno como `todo` en
`tests/adversarial/casos-dorados.test.ts`, de modo que **el corredor de pruebas los nombra en cada
ejecución** sin contarlos como pasados. Y hay dos pruebas que demuestran que no pueden estar pasando por
accidente: las nueve tablas normativas están en cero filas, y `src/` contiene exactamente dos módulos
(`auth`, `db`) —no hay dónde esconder un cálculo—.

| # | Escenario | Estado | Quién y cuándo lo habilita |
|---|---|---|---|
| 1 | Servicio $1.000.000 + IVA, PJ declarante, Bogotá | no implementado todavía | A1 + A3 — Ola 1 |
| 2 | Mismo servicio, PN no declarante → 6% | no implementado todavía | A1 + A3 — Ola 1 |
| 3 | Servicio $80.000 bajo 2 UVT → no retiene | no implementado todavía | A1 + A3 — Ola 1 |
| 4 | Compra $500.000 bajo 10 UVT → no retiene | no implementado todavía | A1 + A3 — Ola 1 |
| 5 | Compra $600.000 a declarante → 2,5% | no implementado todavía | A1 + A3 — Ola 1 |
| 6 | Honorarios PJ $200.000 → 11% desde $0 | no implementado todavía | A1 + A3 — Ola 1 |
| 7 | Arrendamiento inmueble vs. mueble | no implementado todavía | A1 + A3 — Ola 1 |
| 8 | Servicio en Medellín → ReteICA 2‰ general | no implementado todavía | A1 + A3 — Ola 1 |
| 9 | Servicio en Cali → base 3 UVT, tarifa de actividad | no implementado todavía | A1 + A3 — Ola 1 |
| 10 | Actividad principal Bogotá, operación en Cali | no implementado todavía | A1 + A3 — Ola 1 |
| 11 | Vigilancia con AIU → base es el AIU | no implementado todavía | A1 + A3 — Ola 1 |
| 12 | Proveedor del exterior → ReteIVA 100% | no implementado todavía | A1 + A3 — Ola 1 |
| 13 | Proveedor régimen SIMPLE | no implementado todavía | A1 + A3 — Ola 1 |
| 14 | Factura con 3 conceptos distintos | no implementado todavía | A1 + A3 + A4 — Ola 1 |
| 15 | Nota crédito → reversa proporcional sin mutar original | no implementado todavía | A3 + A4 + A6 — Ola 1 |
| 16 | Factura 15-jun-2026 procesada 20-jul-2026 → vigencia de junio | no implementado todavía | A1 + A3 — Ola 1 |
| 17 | Cambio de tarifa con vigencia futura → no retroactivo | no implementado todavía | A1 + A3 — Ola 1. **La mitad de base de datos YA está probada**: A14 verifica que una vigencia nueva no altera un `retention_applied` ya registrado, byte a byte |
| 18 | Reprocesar 10 veces → asiento idéntico | no implementado todavía | A3 + A4 + A6 — Ola 1. Hoy no hay causación que reprocesar |
| 19 | Segunda factura mismo proveedor → cero llamadas al LLM | no implementado todavía | **A5 — Ola 2**. No hay memoria de clasificación ni LLM que contar |
| 20 | Tenant A consulta tenant B → cero filas | **PASA** | **YA PROBADO por A14** en `tests/adversarial/compuerta-ola0.test.ts`, Compuerta 3, por barrido de catálogo |

**Pruebas adicionales de integridad (sección 12, final):**

| Prueba | Estado |
|---|---|
| Grep de literales tributarios en código → cero | **PASA — implementado por A14**, `tests/adversarial/valores-tributarios.test.ts`. Barre `src/`, `app/` y `db/migrations/` ignorando comentarios; seis reglas (fracciones, porcentajes, números grandes junto a palabra tributaria, magnitudes conocidas de UVT/SMMLV, constantes y DEFAULT, INSERT de datos normativos). **Cero hallazgos.** Verificado con un canario: al inyectar `TARIFA_SERVICIOS = 0.04` y `UVT_2026 = 5237400`, cuatro de las reglas lo cazan |
| UPDATE/DELETE sobre asiento publicado → falla en BD | **PASA — reverificado por A14** con nueve vectores propios, incluido el UPDATE que no cambia nada, el UPDATE y el DELETE sin `WHERE`, el DELETE de un borrador y el TRUNCATE |
| Asiento desbalanceado → falla en BD | **PASA — reverificado por A14** con siete vectores propios, incluido el descuadre de un centavo y el desbordamiento de `bigint` |
| Balance de prueba vs. ledger con 10.000 asientos → cuadra al centavo | no implementado todavía — A9 + A14, Ola 3 |
| Carga: 5.000 facturas en cola sin degradar el request HTTP | no implementado todavía — A6 + A13 + A15, Ola 2 |

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

## Pendiente de verificación normativa humana

Ningún dato cargado todavía (A1 no ha corrido). Ya se sabe, por las advertencias de la sección 17, que quedarán marcados como pendientes:

| Dato | Motivo | Estado |
|---|---|---|
| ReteICA Bucaramanga (bases ~25/~50 UVT) | Marcado *(verificar)* en sección 7.5 | pendiente |
| ReteICA Cartagena (bases por actividad) | Marcado *(verificar)* en sección 7.5 | pendiente |
| Tabla completa de autorretención por CIIU | Sección 7.3 da 4 valores de ejemplo, no la tabla | pendiente |
| Tarifas Decreto 572 de 2025 | En etapa cautelar; fallo de fondo abierto (exp. 30229) | vigente, con riesgo documentado |

---

## Presupuesto

Sin reporte de A15 todavía. Techo: USD 20/mes (fase inicial) → USD 50/mes (con clientes).
Referencia de costo de IA: USD 0,01–0,02 por factura antes de caché.

**A12 no gastó un peso del presupuesto:** cero dependencias nuevas. scrypt, HMAC y AES-256-GCM
salen de `node:crypto`; el TOTP son ~120 líneas de especificación pública verificadas contra los
vectores de los RFC (D-027). `package.json` no cambió.

---

## Próximo paso

**A14 verificó la compuerta y la Ola 0 queda CERRADA.** Las cuatro pruebas pasan contra el motor,
verificadas con pruebas propias en `tests/adversarial/`. Falta únicamente el **commit de cierre, que lo
hace A0** (A14 no hace commits). Después de eso, despachar la **Ola 1** (A1, A3, A4, A6).

**Condiciones que A0 debe trasladar a la Ola 1 antes de darla por despachada:**
1. **D-032 es precondición de cierre de la Ola 1, y le toca a A2**: `journal_line.account_id` debe
   validar el alcance de la cuenta con un trigger antes de que A3 y A6 empiecen a escribir partidas.
   Hay una prueba `it.fails` viva que empezará a fallar el día que se corrija.
2. **D-033 conviene cerrarlo en la misma pasada, también A2**: trigger `BEFORE TRUNCATE ... FOR EACH
   STATEMENT` en `journal_entry`, `journal_line` y `audit_log`.
3. **A1 debe correr sus seeds con `asAdmin` / rol privilegiado** (D-015 y D-025), y dejar como
   pendientes los datos que la sección 17 marca sin verificar, en vez de inventarlos.
4. **A14 implementa los 20 casos dorados al cerrar la Ola 1**, que es cuando la sección 12 dice que
   deben estar implementados. Hoy están enumerados como `todo`, no simulados.

Lo que queda listo y **no** hay que rehacer:
- El esquema completo de la sección 15, con RLS de doble nivel activa y forzada (A2).
- El contexto de tenant derivado de un token de sesión verificado, con `app.tenant_id` inerte (A12, D-021).
- Los cinco roles con permisos impuestos por el motor (A12, D-025).
- El harness `tests/helpers/db.ts` + `tests/helpers/fixtures.ts` que usarán todos los agentes.
- Los nueve documentos de cumplimiento en `docs/`, listos para revisión jurídica.
- Las tablas paramétricas **vacías y listas** para que A1 las puebla en la Ola 1. Ni A2 ni A12 cargaron
  un solo valor tributario, a propósito.

**Lo que A12 pidió que A14 verificara por su cuenta — resultado, punto por punto:**

1. Fijar `app.tenant_id` a mano no da acceso a nada (cierre de D-020) → **CONFIRMADO** contra el motor,
   saltándose `withSessionContext` y forjando la GUC directamente.
2. Ningún rol de aplicación tiene privilegio sobre las tablas del esquema `app` → **CONFIRMADO** para
   `app_user` y para `app_auth`, por barrido del catálogo.
3. `app_user` no puede ejecutar `app.abrir_sesion` → **CONFIRMADO**, y además se cerró por prueba el
   inventario completo de funciones `SECURITY DEFINER` que `app_user` sí puede ejecutar: una función
   DEFINER nueva y ejecutable por la aplicación ahora **rompe la prueba** en vez de colarse.
4. El rol `solo_lectura` no escribe en ninguna tabla protegida → **CONFIRMADO** (ya lo cubría A12; A14
   añadió que `app.tiene_permiso` no se puede consultar «en nombre de» otra sesión).
5. El `audit_log` registra el acceso denegado y el intento fallido con IP → **CONFIRMADO**, y **además
   se encontró y cerró D-031**: `app_auth` podía forjar registros en cualquier firma.
6. Ninguna prueba de aislamiento pasa por un falso PASS → **CONFIRMADO, con matices**, ver D-035 y
   D-036. El residuo de D-024 quedó **medido en una prueba** en vez de confiado a un documento: la
   suite ahora afirma explícitamente que `session_user` es superusuario en este harness, de modo que
   apuntar `DATABASE_URL` a un Postgres real mal configurado lo dice en voz alta.

**Lo que hereda A15 (despliegue), y sin lo cual la 14.1 no está completa:**

- Conectar la aplicación con un rol de login que **sea** `app_user`, sin `SUPERUSER`, sin `BYPASSRLS` y
  sin ser dueño de las tablas. Lista de verificación en `docs/cifrado-y-proteccion-de-datos.md` §4.1.
- `sslmode=verify-full` en la cadena de conexión, TLS y HSTS en el borde.
- Confirmar y archivar la constancia del cifrado en reposo del proveedor en el plan contratado.
- **Ejecutar la prueba de restauración desde respaldo** y verificar la reproducción exacta. Hoy es el
  único punto del "día uno" que está afirmado y no verificado.
- Limitación de tasa por IP en el endpoint de autenticación.

**Lo que hereda A7/A8 (interfaz):** hacer el MFA **obligatorio** para los roles con permiso de
aprobación, publicación o edición de parámetros. Hoy está disponible, no exigido.

Nada más arranca hasta que A14 confirme las cuatro pruebas de la compuerta de Ola 0:

1. `UPDATE` sobre `journal_entry` publicado falla **en la BD**.
2. Asiento desbalanceado rechazado **por la BD**.
3. Consulta sin filtro de tenant devuelve **cero** filas de otro tenant, con RLS activo.
4. Insertar vigencia nueva no altera la anterior; consulta con fecha pasada resuelve la regla vigente entonces.

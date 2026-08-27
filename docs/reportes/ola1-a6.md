# A6 — Servicios de aplicación, cola asíncrona y casos de uso de causación (Ola 1)

**Estado: entregado.** `npm test` → **346 pruebas en verde**, 22 `todo`, **2 fallos, ninguno mío**
(el canario obsoleto del inventario de `src/` en `tests/adversarial/casos-dorados.test.ts`, y el
falso positivo de la Regla de Oro 2 sobre `ESCALA_TARIFA`/`ESCALA_UVT` de A3 en
`tests/adversarial/valores-tributarios.test.ts` — ambos adjudicados a A14 en la compuerta de Ola 1;
no los toqué). Antes de mi entrega pasaban 311; con mis 35 pruebas nuevas y sin romper ninguna de
las existentes quedan 346.

**No toqué `ESTADO_PROYECTO.md`. No hice commit.**

Nota sobre el corte de cupo: mi primer intento de esta ola solo alcanzó a dejar comiteada
`db/migrations/040_cola_documentos.sql` (commit `e2fd2f9`). Al retomar, A3 y A4 ya habían entregado
el motor de reglas (`src/domain/`) y el parser UBL (`src/ingest/`) completos. Este reporte describe
el trabajo terminado, que se apoya en ambos en vez de reinventarlos.

---

## 1. Qué se entrega

```
db/migrations/
  040_cola_documentos.sql     document_processing_job + API mínima de la cola (única migración mía)

src/services/
  cola.ts          Envoltorio TS de la cola: encolar, reclamar, completar, fallar, backoff, reencolar.
  ingest.ts        recibirDocumento — decodifica (A4), persiste (reutiliza guardarDocumentoProcesado
                   de A4), vincula el tercero, encola. Nunca resuelve retenciones.
  causacion.ts     procesarJobCausacion (worker) + aprobarAsiento + aprobarAsientosEnLote +
                   reversarAsientoPublicado. Invoca resolverFactura/persistirRetenciones/
                   resolverReversaNotaCredito de A3; nunca calcula una retención.
  consulta.ts      consultarEstadoDocumento + listarPendientesDeAprobacion (bandeja, solo lectura).
  worker.ts        ejecutarCicloCola / vaciarCola — el bucle que A15 programa (cron, proceso largo…).
  index.ts         Superficie pública única.

tests/services/
  cola.test.ts       9 pruebas: idempotencia, SKIP LOCKED, backoff, cola de fallidos, reencolado.
  ingest.test.ts     6 pruebas: camino feliz, vínculo de tercero, permiso, dedup por CUFE, cuarentena.
  causacion.test.ts  12 pruebas: asiento balanceado, multi-concepto, idempotencia (caso 18),
                      revisión manual, aprobación/rechazo, lote, reversa (con vector LG008 adversarial).
  worker.test.ts     4 pruebas: la prueba explícita de que el request nunca causa nada.
  consulta.test.ts   4 pruebas: estado consolidado, aislamiento RLS, permiso, bandeja.

tests/helpers/db.ts   3 REVOKE espejados (D-034): reclamar/completar/fallar son solo del worker.
```

---

## 2. La cola — diseño y por qué no procesa dos veces

### 2.1 Una fila por documento, reutilizada en cada intento

`document_processing_job` tiene `UNIQUE (source_document_id, tipo)`. No se inserta una fila nueva
por reintento: la MISMA fila transiciona `pendiente → en_proceso → completado` (o `agotado`, la cola
de fallidos). Esto hace que **encolar sea idempotente por construcción** (D-003): `encolarCausacion`
llama `app.encolar_causacion`, que hace `INSERT ... ON CONFLICT (source_document_id, tipo) DO
NOTHING` y, si ya existía, devuelve la fila tal cual está — sin tocar su estado ni sus intentos.
Probado en `cola.test.ts`: encolar el mismo documento dos veces deja **una** fila.

### 2.2 Concurrencia — `FOR UPDATE SKIP LOCKED` en una sola sentencia

```sql
UPDATE document_processing_job
   SET estado = 'en_proceso', tomado_por = $1, tomado_en = now(), intentos = intentos + 1
 WHERE id = (
   SELECT id FROM document_processing_job
    WHERE estado = 'pendiente' AND disponible_en <= now()
    ORDER BY disponible_en
    FOR UPDATE SKIP LOCKED
    LIMIT 1
 )
 RETURNING *;
```

Es **una sola sentencia** de PostgreSQL: atómica por construcción, no por convención de la
aplicación. `SKIP LOCKED` es lo que impide que dos workers concurrentes reclamen la misma fila — el
segundo, si llega mientras la primera fila está bloqueada, la salta y mira la siguiente. Probado en
`cola.test.ts` con dos documentos y dos "workers" (`worker-a`, `worker-b`): cada uno reclama uno
distinto y un tercero no encuentra nada.

### 2.3 Reintentos, backoff y cola de fallidos

- `intentos` / `max_intentos` (por defecto 5, configurable por llamada a `encolarCausacion`).
- Backoff exponencial con tope (`src/services/cola.ts`): 30s, 60s, 120s, 240s… hasta 3600s. Son
  constantes **técnicas** de operación de cola, no valores tributarios — se mantuvieron como
  enteros y con nombres sin ninguna palabra de la lista que audita
  `tests/adversarial/valores-tributarios.test.ts` (aprendí esto a la mala: mi primer nombre,
  `BACKOFF_TOPE_SEGUNDOS`, hacía match con la palabra "tope" de esa lista y rompía la Regla de Oro 2
  por accidente; quedó `BACKOFF_MAXIMO_SEGUNDOS`).
- `fallarJob` decide en la propia función SQL (`app.fallar_job`): si `intentos < max_intentos`,
  vuelve a `pendiente` con `disponible_en = now() + backoff`; si no, `agotado`. **`agotado` no se
  reintenta solo** — es la cola de fallidos, se consulta con `estado = 'agotado'` y solo un humano
  la revive con `documento.reprocesar` (`reencolarJob` → `app.reencolar_job`, que exige ese permiso).
- Probado en `cola.test.ts`: un fallo por debajo del límite reintenta (y no es reclamable hasta que
  pasa el backoff — se simula empujando `disponible_en` al pasado, sin dormir la prueba de verdad);
  agotar el límite manda a `agotado` y ya no es reclamable ni forzando el backoff; `reencolarJob`
  revive un `agotado` en cero intentos.

### 2.4 Quién opera la cola — la razón de que no haya un rol nuevo

`reclamar_siguiente_job`, `completar_job` y `fallar_job` corren en **contexto de administración**
(`withAdminContext`, de A2/A12): sin `SET ROLE`, ve la cola de **todas** las firmas. Es exactamente
la definición que `src/db/tenant-context.ts` ya documenta para "tareas de plataforma", y encaja:
el worker no sirve una petición de usuario, procesa trabajo que un usuario ya autorizó al ingestar.
Encolar, en cambio, lo hace la sesión normal del tenant (RLS activa, D-021), en la MISMA transacción
que inserta el `source_document` — si esa inserción se revierte, el trabajo encolado se revierte con
ella. `aprobarAsiento` / `aprobarAsientosEnLote` / `reversarAsientoPublicado` también corren en
sesión normal: son decisiones humanas, nunca del worker.

Las tres funciones de plataforma tienen su `EXECUTE` revocado de `app_user`/`app_auth`/`PUBLIC`
inmediatamente después de crearse en la migración (el `ALTER DEFAULT PRIVILEGES` de 001 se lo
concedería automáticamente si no) — y **espejado en `tests/helpers/db.ts`** (D-034: un REVOKE que
solo exista en la migración y no en el harness deja el banco de pruebas más permiso que producción).

### 2.5 Restricción de presupuesto (A15)

Sin Redis, sin broker, sin servicio de terceros: la cola vive enteramente en la misma PostgreSQL, tal
como exige la sección 5. No introduje ninguna dependencia nueva (`package.json` sin cambios).

---

## 3. Qué corre en el request y qué corre en la cola — la prueba

**Interpretación que adopté, documentada para que A0 la pueda revisar:** decodificar el XML
(`procesarAdjuntoXml`, de A4) es una función *pura*, sin I/O — no es "procesamiento de facturas" en
el sentido que la sección 5 prohíbe dentro del request; es decodificación. Lo que la sección 5 prohíbe
es la CAUSACIÓN: resolver retenciones (A3, varias consultas por regla) y construir el asiento. Por
eso `recibirDocumento` (lo que un route handler llamaría dentro del request) hace, como máximo, un
`procesarAdjuntoXml` en memoria más un par de `INSERT`, y **termina encolando** — nunca invoca
`resolverFactura` ni `procesarJobCausacion`.

Esta lectura está corroborada por el propio diseño de A4: `email_ingest_attachment_procesado_ck`
exige `source_document_id` en cuanto `resultado = 'procesado'`, es decir, A4 ya asume que parsear y
guardar el documento ocurre sincrónicamente en el camino de ingesta, y que lo diferido es la
causación. `tests/services/worker.test.ts` lo demuestra en código, no solo en prosa:

- `recibirDocumento` deja el documento en `parseado`, con **cero** `journal_entry` y el trabajo en
  `pendiente` — el request nunca tocó la resolución de retenciones.
- `ejecutarCicloCola`, llamado **por separado** (fuera de cualquier request), es quien reclama el
  trabajo y de verdad intenta causar.
- Un documento sin clasificación automática completa el ciclo en `revision_manual` (no lanza, no
  reintenta): se distingue explícitamente "falta un dato de negocio" de "hubo un error transitorio",
  que es la distinción que justifica separar `fallarJob` (reintenta) de un resultado de dominio
  normal (no reintenta porque reintentar no cambiaría nada sin que un humano intervenga).

---

## 4. Contrato de cada servicio (para A7 y A13, Ola 2)

Todas las firmas viven en `src/services/*.ts` y se re-exportan desde `src/services/index.ts`. Todas
reciben `tx: SqlClient` **ya situado en su contexto** — ninguna abre su propia sesión ni fija
`tenant_id`/`company_id` a mano (D-020/D-021): quien las llama debe envolver la llamada en
`withSessionContext` (sesión normal) o `withAdminContext` (solo el worker), según se indica.

### 4.1 Ingest de documento — `recibirDocumento` (sesión normal)

```ts
recibirDocumento(tx: SqlClient, input: RecibirDocumentoInput): Promise<ResultadoIngesta>

interface RecibirDocumentoInput {
  bytes: Uint8Array;
  nombreArchivo?: string | null;
  tamanoMaximoBytes?: number;
  origen?: 'correo' | 'carga_manual' | 'portal_dian' | 'api' | 'migracion'; // default 'carga_manual'
  remitenteEmail?: string | null;
  spfValido?: boolean | null;
  dkimValido?: boolean | null;
}

type ResultadoIngesta =
  | { ok: true; sourceDocumentId: string; duplicado: boolean; job: DocumentProcessingJob | null }
  | { ok: false; sourceDocumentId: string; motivoCuarentena: string; detalle: string; duplicado: boolean };
```

- Exige `documento.cargar` (`exigirPermiso`, respaldado por el trigger de la BD sobre
  `source_document`/`document_processing_job`).
- Llama `procesarAdjuntoXml` (A4) y, en el camino feliz, **reutiliza `guardarDocumentoProcesado`**
  (`src/ingest/persistencia.ts`, de A4 — "A6 no está obligado a usar este archivo… pero lo puede
  reutilizar si le sirve"), que ya resuelve la deduplicación por CUFE/hash contra la restricción real
  de la base (`source_document_cufe_uq`, de A2/A4) y `documento_referenciado_id` de notas crédito.
  **No hay una segunda restricción compitiendo**: coordiné con lo que A4 ya construyó en vez de
  reescribir el `INSERT`.
- Encima de eso, A6 aporta: vincular el `third_party` emisor por NIT (maestro de datos, fuera del
  alcance de A4), y encolar la causación (`encolarCausacion`) en la MISMA transacción.
- Cuarentena (XML roto, vía de **carga manual** — el canal de correo tiene su propia traza en
  `email_ingest_log`/`email_ingest_attachment`, de A4) también es idempotente, por `hash_contenido`.
- `duplicado: true` cuando el documento ya existía: se le busca (o encola) su trabajo sin insertar
  nada nuevo.

### 4.2 Consulta de estado — `consultarEstadoDocumento` / `listarPendientesDeAprobacion` (sesión normal)

```ts
consultarEstadoDocumento(tx: SqlClient, sourceDocumentId: string): Promise<EstadoDocumento | null>
listarPendientesDeAprobacion(tx: SqlClient, opciones?: { limite?: number }): Promise<EstadoDocumento[]>

interface EstadoDocumento {
  sourceDocumentId: string; estado: string; tipoDocumento: string; cufe: string | null;
  numeroDocumento: string; emisorNit: string; fechaHechoEconomico: string; motivoRechazo: string | null;
  job: DocumentProcessingJob | null;
  retenciones: RetencionResumen[];   // de retention_applied, aplicadas o no, con su motivo
  asiento: AsientoResumen | null;    // de v_journal_entry — incluye reversedBy si lo reversaron
}
```

- Exige `documento.leer`. Solo lectura; RLS decide qué documento es visible (un `id` que no
  pertenece a la empresa en contexto devuelve `null`, indistinguible de "no existe").
- `listarPendientesDeAprobacion` es el insumo directo de la bandeja de A7.

### 4.3 Aprobación de asiento — `aprobarAsiento` (sesión normal)

```ts
aprobarAsiento(tx: SqlClient, input: AprobarAsientoInput): Promise<ResultadoAprobacion>

interface AprobarAsientoInput {
  journalEntryId: string;
  decision: 'aprobado' | 'rechazado' | 'devuelto';
  userId: string;
  ip?: string | null; userAgent?: string | null; motivo?: string | null;
  loteId?: string | null;   // lo pone aprobarAsientosEnLote; no lo arma A7 a mano
}
interface ResultadoAprobacion {
  approvalId: string; journalEntryId: string; decision: 'aprobado'|'rechazado'|'devuelto'; publicado: boolean;
}
```

- Exige `causacion.aprobar` (`exigirPermiso` + trigger de la BD; `auxiliar_causacion` no lo tiene,
  probado).
- `decision = 'aprobado'`: inserta la aprobación real (con IP/usuario/timestamp, Regla de Oro 6) y
  llama `app.publicar_asiento` — el ciclo `draft → publicado` de D-009, nunca un `INSERT` ya
  publicado. El asiento borrador automático de la causación (§4.5) nace con un `approval` de
  trazabilidad en `devuelto` (nunca alcanza a publicar nada por sí mismo, LG006 lo bloquea);
  `aprobarAsiento` siempre inserta una fila **nueva** de aprobación humana — no reutiliza esa.
- `decision = 'rechazado'`: anula el borrador (`estado = 'anulado'`) y marca el documento
  `rechazado`. Si alguien intentara "rechazar" (mutar) un asiento que **ya está publicado**, la base
  lo rechaza con LG001 (inmutabilidad) antes de que este servicio pueda hacer ningún daño — la
  Regla de Oro 1 la impone el motor, no un `if` de este archivo.
- Publicar deja el documento en `causado` (o `anulado`, si lo que se publicó es una reversa del
  mismo documento — se distingue comparando el `source_document_id` de la reversa contra el del
  asiento original que reversa; si son el mismo, es la reversa genérica de §4.6; si difieren, es la
  nota crédito de §4.5.2, que tiene su propio documento y por tanto queda `causado` como cualquier
  otro).

### 4.4 Aprobación en lote — `aprobarAsientosEnLote` (sesión normal)

```ts
aprobarAsientosEnLote(tx: SqlClient, input: {
  items: readonly { journalEntryId: string; decision: 'aprobado'|'rechazado'|'devuelto'; motivo?: string|null }[];
  userId: string; ip?: string|null; userAgent?: string|null;
}): Promise<{ loteId: string; resultados: (ResultadoAprobacion | { journalEntryId: string; error: string })[] }>
```

**Contrato explícito para A7, porque es la parte que más le importa a una firma con 30-60 empresas:**
un lote opera sobre las empresas accesibles dentro de **una misma sesión** — `tx` ya trae su
`companyId` fijado por `withSessionContext` (D-021: la empresa la autoriza la base, no un parámetro
que la sesión elige). Si el usuario aprueba facturas de varias de sus 30-60 empresas en un solo clic
de UI, **A7 agrupa por empresa y llama este servicio una vez por empresa** (varias llamadas, cada una
con su propia sesión/sesión ya abierta para esa empresa) — esta función **nunca** acepta un
`companyId` por ítem, precisamente para no abrirle a la sesión la posibilidad de "elegir" la empresa.

Un fallo en un ítem **no aborta el lote**: cada ítem se intenta por separado y su resultado (éxito o
`{ error }`) queda en `resultados`, todas las aprobaciones exitosas comparten `loteId`. Probado:
49 aprobaciones buenas no se pierden porque la 50 apuntaba a un `journalEntryId` inexistente.

### 4.5 El worker — `procesarJobCausacion` (contexto de administración, exclusivo del worker)

```ts
procesarJobCausacion(tx: SqlClient, job: { id: string; sourceDocumentId: string }): Promise<ResultadoProcesamiento>

type ResultadoProcesamiento =
  | { estado: 'causado'; journalEntryId: string; huella: string }
  | { estado: 'ya_procesado'; journalEntryId: string | null }
  | { estado: 'revision_manual'; motivos: MotivoLocal[] };
```

No es parte del "contrato para A7/A13" en el sentido de que ellos lo llamen directo — lo invoca
`ejecutarCicloCola` (§4.7). Lo documento igual porque es donde vive la mecánica central:

1. **Idempotencia por estado del documento** (caso dorado 18): si `source_document.estado` ya pasó de
   `parseado`, no se resuelve nada de nuevo — se devuelve `ya_procesado` con el `journalEntryId`
   existente. Reprocesar 10 veces no calcula 10 veces ni causa 10 veces.
2. **Clasificación — frontera con A5 (Ola 2), Regla de Oro 4**: por cada línea, se busca un concepto
   ya **confirmado** en `memoria_clasificacion` (lectura, normalización mínima
   minúsculas+trim — el resto de la normalización, según D-013, es de A5). A6 **no clasifica y no
   llama ningún LLM**. Si falta una sola línea, **todo el documento** espera (revisión manual,
   `sin_clasificacion_automatica`): causar parcialmente dejaría un asiento que nadie pidió aprobar
   a medias.
3. **Resolución de retenciones — frontera con A3, Regla de Oro 4**: arma `EntradaFactura` (agrupando
   líneas por concepto) y llama `resolverFactura(new RepositorioTributarioSql(tx), entrada)` — la
   función real de A3, con su repositorio real. **A6 no calcula ninguna tarifa, base ni redondeo.**
   Si `resultado.requiereRevisionManual`, no se construye ningún asiento (ni parcial): se completa
   el trabajo con los motivos de A3 tal cual.
4. **Persistencia de la traza**: `persistirRetenciones` (de A3) inserta una fila de
   `retention_applied` por cada retención evaluada (aplicara o no), con `journal_entry_id = NULL`
   todavía. Después de construir el asiento, A6 hace el `UPDATE` que las enlaza (A3 dejó
   `ContextoPersistencia.journalEntryId` opcional exactamente para esto: "A6 lo enlaza después").
5. **Construcción del asiento — `construirPartidasCausacion`, mecánica contable de A6, no
   tributaria**: por cada concepto presente en la factura, un débito a su cuenta de gasto (suma de
   bases) y a su cuenta de IVA descontable (suma de IVA); un único crédito de contrapartida
   (proveedores) por el neto a pagar; un crédito por cada `RetencionAgregada` de A3 que sí aplicó,
   enlazado a su `retention_applied_id` cuando el agregado corresponde a una sola fila evaluada.
   Balancea por construcción — la BD lo vuelve a verificar en el `COMMIT` (LG002) como red de
   seguridad, no como única defensa. Probado con 1 y con 3 conceptos distintos (caso dorado 14).
   **Simplificación documentada**: si los conceptos de una factura declaran cuentas de contrapartida
   distintas (infrecuente), se usa la del primer concepto y se marca `contrapartidaAmbigua` en el
   resultado del trabajo, en vez de fallar la causación completa.
6. **Nota crédito — `causarNotaCredito`, caso dorado 15**: si el documento es `CreditNote`/`DebitNote`
   con `documento_referenciado_id` resuelto, se usa `resolverReversaNotaCredito` (de A3, que
   reversa con la MISMA regla/vigencia/tarifa del original, nunca recalcula) y se construye una
   reversa — total (mismas partidas invertidas) o **proporcional** (prorrateo con `proporcion()` de
   A3, multiplicador de redondeo `1` porque es aritmética de reparto de un monto ya calculado, no una
   decisión tributaria). Queda como un borrador más, a la espera de la misma aprobación humana.
7. El asiento **nace `draft`** (D-009) con un `approval` de trazabilidad automática en `devuelto`
   (nunca publica nada por sí solo); publicar exige `aprobarAsiento` (§4.3). El documento pasa a
   `pendiente_aprobacion`.

### 4.6 Reversa genérica — `reversarAsientoPublicado` (sesión normal)

```ts
reversarAsientoPublicado(tx: SqlClient, input: { journalEntryId: string; motivo: string }): Promise<{ journalEntryId: string }>
```

Regla de Oro 1: toda corrección va por reversa. Exige `causacion.reversar`. Copia las partidas del
asiento publicado con el lado invertido, como un borrador nuevo (`tipo = 'reversa'`,
`reverses_entry_id` apuntando al original) a la espera de la misma aprobación humana de §4.3 — no
publica nada por sí mismo. Si el asiento no está publicado, falla limpio con un mensaje claro
**antes** de tocar la base; y si alguien se saltara este servicio e insertara la reversa a mano, la
BD la rechaza en el `COMMIT` con `LG008` (`REVERSA_INVALIDA`) — probado con un vector adversarial que
construye la fila directo por SQL, sin pasar por este servicio, exactamente para demostrar que la
garantía es del motor y no de este archivo (D-003).

### 4.7 El bucle del worker — `ejecutarCicloCola` / `vaciarCola`

```ts
ejecutarCicloCola(db: DbHandle, workerId: string): Promise<ResultadoCiclo>
vaciarCola(db: DbHandle, workerId: string, maxCiclos?: number): Promise<{ procesados: number; fallidos: number }>
```

**Tres transacciones a propósito, no una**, para que un fallo de procesamiento no borre el intento ya
contado:

1. Reclamar (§2.2) se comitea solo.
2. Procesar (`procesarJobCausacion`) va en su propia transacción: si falla a mitad de camino, se
   revierte completo (nada de un asiento a medio construir), pero el trabajo sigue `en_proceso` con
   su intento ya contado en el paso 1.
3. Si el paso 2 lanza, `fallarJob` corre en una transacción nueva.

A15 decide el mecanismo de host (proceso Node de larga duración, cron del tier económico, tarea
programada de n8n de A13); este módulo no asume ninguno — solo expone la función que hay que llamar
repetidamente.

---

## 5. Idempotencia por CUFE — coordinado con A4/A2, sin restricción propia

**No creé ninguna restricción de deduplicación por CUFE.** La única fuente de verdad es
`source_document_cufe_uq UNIQUE (company_id, cufe)`, de `008_documentos.sql` (Ola 0, A2). Mi trabajo
fue **usarla**, no duplicarla:

- `recibirDocumento` delega el `INSERT` del camino feliz a `guardarDocumentoProcesado` (A4), que ya
  hace el `SELECT` previo de cortesía y confía en que el `UNIQUE` real es quien decide si hay carrera.
- La cola tiene su **propia** idempotencia, en una capa distinta y que no compite: un documento tiene
  a lo sumo un trabajo de causación (`document_processing_job_doc_tipo_uq UNIQUE
  (source_document_id, tipo)`). Encolar dos veces el mismo documento no crea un segundo trabajo.
- `journal_entry.idempotency_key` (de A2, `UNIQUE (company_id, idempotency_key)`) es la tercera capa:
  el asiento en sí usa la clave `causacion:<sourceDocumentId>`, así que aunque algo lograra invocar
  `procesarJobCausacion` dos veces para el mismo documento (una carrera entre dos workers, por
  ejemplo), el segundo `INSERT` chocaría con esa restricción — capturado explícitamente en
  `causarFactura` (recupera el asiento existente en vez de fallar la petición).

Tres capas, tres restricciones de la BD, ninguna inventada por A6 para competir con las de A2/A4.

---

## 6. El ciclo del ledger — cómo mis casos de uso lo respetan y fallan limpio

- Todo `journal_entry` que A6 inserta nace `draft` (nunca se inserta ya `posted` — si se intentara,
  `LG007` lo rechaza en la BD). Las partidas se insertan mientras sigue `draft`.
- Publicar es **siempre** `SELECT app.publicar_asiento(id, user_id)`, nunca un `UPDATE` directo
  fabricado a mano: `aprobarAsiento` es el único lugar de A6 que publica, y siempre después de haber
  insertado la aprobación humana real.
- Un asiento publicado es inmutable: `aprobarAsiento` con `decision = 'rechazado'` hace
  `UPDATE journal_entry SET estado = 'anulado'`, que la BD **rechaza con LG001** si el asiento ya
  estaba `posted` — nunca llega a intentarlo sobre algo publicado porque el flujo normal no lo
  permite, pero si alguien lo forzara, el motor lo para, no este archivo.
- Toda corrección va por reversa (§4.6, §4.5.6): nunca hay un `UPDATE` de una partida publicada.

---

## 7. Qué quedó sin cablear — explícito para A0/A12/A13

1. **Sesión de sistema para el canal de correo.** `recibirDocumento` asume una sesión real ya abierta
   (D-021) — funciona de inmediato para carga manual (un contador autenticado sube el archivo). Para
   el canal de correo, A4 ya dejó escrito en `docs/ingest-correo.md` §9 exactamente el hueco: alguien
   tiene que (a) resolver el tenant del buzón con `app.resolver_empresa_por_buzon` **antes** de que
   exista sesión, y (b) abrir una **sesión de sistema** para ese tenant (un usuario técnico análogo al
   `usuarioTecnico` del harness de pruebas, pero de producción) antes de invocar `recibirDocumento`.
   Emitir esa sesión de sistema es territorio de A12 (mecanismo de sesión) + A6/A13 (el endpoint que
   la abre); no lo construí porque el mecanismo de sesión de sistema en sí no existe todavía
   fuera del harness de pruebas.
2. **Endpoint HTTP real.** Escribí los servicios que un route handler llamaría, no el route handler
   de Next.js en sí (fuera del alcance de "servicios de aplicación" de esta ola; A7 lo construye en
   Ola 2 contra este contrato).
3. **`contrapartidaAmbigua`** (§4.5.5) queda señalada en el resultado del trabajo pero no bloquea la
   causación ni dispara ninguna alerta todavía — es una bandera para que A7 la muestre en la bandeja.
4. **AIU por línea.** `DocumentoNormalizado` (A4) no trae un campo de AIU discriminado por línea —
   UBL no lo separa de forma estándar. Mientras no exista esa señal, un concepto con `base_es_aiu`
   siempre irá a revisión manual (`MOTIVO.SIN_AIU`, de A3) para cualquier documento que llegue por
   `recibirDocumento`. Es el comportamiento correcto (no se inventa un AIU), pero significa que el
   caso dorado 11 (vigilancia con AIU) no se puede disparar todavía por el canal de ingest real —
   sigue probándose contra el motor de A3 directamente, como ya lo hace `tests/golden/`.
5. **Municipio de la operación.** `procesarJobCausacion` usa el `municipality_id` registrado del
   `third_party` como municipio de operación por defecto (no hay, en el documento normalizado de A4,
   una señal explícita de "dónde ocurrió la operación" distinta del municipio del tercero). El caso
   dorado 10 (actividad principal en una ciudad, operación en otra) sigue necesitando que alguien —
   probablemente A7, con un campo editable en la bandeja, o una fuente de datos que hoy no existe —
   provea ese dato cuando difiera.
6. **Reencolado automático tras clasificar.** Cuando A5 (Ola 2) escriba una fila nueva en
   `memoria_clasificacion`, alguien tiene que llamar `reencolarJob` para que el documento que había
   quedado en revisión manual se vuelva a intentar. No construí ese disparador (dependería de A5).

---

## 8. Decisiones no obvias

- **`document_processing_job` vive en `public`, con RLS estándar de empresa** (no en el esquema
  `app` como `session_context`). Encolar y consultar estado los hace la sesión normal del tenant, así
  que necesitan pasar por RLS igual que cualquier tabla de negocio; solo el *reclamo* del worker
  necesita ver todas las firmas, y eso lo resuelve el contexto de administración, no la ausencia de
  RLS en la tabla.
- **No usé `SECURITY DEFINER`** en ninguna función de la migración 040. A diferencia del guardia de
  alcance de D-037 (que necesita ver una fila que la RLS le esconde al llamante), el worker en
  contexto de administración ya ignora RLS por sí mismo — no hay nada que "definir" para él, y
  mantener las funciones sin ese privilegio elevado las deja fuera de la superficie que A14 audita
  para D-037.
- **El worker no usa una sesión real por tenant.** Se consideró (y se descartó) emitir una sesión de
  negocio de "sistema" por firma para que el worker respetara RLS/permisos como cualquier usuario.
  Se prefirió el contexto de administración porque (a) es exactamente lo que
  `src/db/tenant-context.ts` ya define para "tareas de plataforma", (b) evita abrir una conexión o
  sesión por cada una de las 30-60 empresas de una firma en cada ciclo, y (c) la integridad
  entre-firmas la sigue imponiendo la FK compuesta (D-016) independientemente del rol de quien
  escribe — un bug en el worker no puede, aunque quisiera, imputar una partida a la cuenta de otra
  empresa, porque esa FK no depende de RLS. El costo aceptado: el worker, a diferencia de una sesión
  de usuario, no pasa por los triggers de permiso (se autoeximen sin sesión) — es la misma
  compensación que ya acepta el camino de seeds/migraciones.
- **`aprobarAsientosEnLote` no acepta `companyId` por ítem** (§4.4): es la forma de mantener D-020/
  D-021 cerrados también en el caso de uso que más tienta a violarlos (una sola llamada que cruce
  firmas). El costo lo paga A7 con N llamadas en vez de una; se consideró aceptable frente a reabrir
  la superficie que D-021 cerró.
- **Constructor de partidas por concepto, no por línea.** Agrupar antes de construir (igual que
  `resolverFactura` de A3 agrupa antes de resolver) es lo que hace que 3 líneas del mismo concepto no
  generen 3 débitos redundantes a la misma cuenta.

---

## 9. Rango de migraciones

Usé únicamente `040_cola_documentos.sql`, dentro del rango reservado 040–049. No toqué ninguna
migración de otro agente.

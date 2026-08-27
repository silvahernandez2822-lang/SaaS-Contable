# A13 — Integraciones externas y n8n (Ola 2)

**Estado: entregado.** `npm test` → **553 pruebas en verde** (521 heredadas + 32 nuevas de A13).
`npm run typecheck` → limpio. No toqué `ESTADO_PROYECTO.md`. No hice `git commit`.

---

## 0. La frontera primero, porque es lo más importante del encargo

**n8n orquesta y notifica. Ningún workflow calcula una retención, escribe un asiento ni resuelve
una regla.** No lo afirmo solamente: `tests/integraciones/frontera.test.ts` lo demuestra en código:

1. **`src/integraciones/**` nunca importa `src/domain` (el motor de reglas de A3).** Grep exacto
   sobre los bloques `import { ... } from '...'` de todo el módulo.
2. **`src/integraciones/**` nunca importa `procesarJobCausacion`, `construirPartidasCausacion`,
   `resolverFactura`, `causarNotaCredito`, `ejecutarCicloCola`, `vaciarCola`, `aprobarAsiento`,
   `aprobarAsientosEnLote` ni `reversarAsientoPublicado`** — las únicas funciones de todo el
   repositorio que causan, publican o reversan un asiento. La única función de causación que este
   módulo puede llamar es `recibirDocumento` (A6, `src/services/ingest.ts`), y **`recibirDocumento`
   nunca causa: solo decodifica, persiste y ENCOLA** (`document_processing_job`), como ya prueba
   `tests/services/worker.test.ts` de A6. `tests/integraciones/webhook-correo.test.ts` lo verifica
   de punta a punta: tras `procesarWebhookCorreo`, el documento queda `parseado`, el trabajo
   `pendiente`, y **cero filas en `journal_entry`**.
3. **Ningún archivo de `src/integraciones/**` trae un literal que parezca tarifa o UVT** (mismo
   espíritu que la Regla de Oro 2, acotado a esta capa).
4. **Los seis `n8n/*.workflow.json`** no traen ni un nodo `postgres`/`mysql`/`mongodb`/`redis`
   (n8n nunca toca la base de datos directamente), ni un nodo cuyos parámetros mencionen un
   concepto tributario (`tarifa`, `retefuente`, `reteiva`, `reteica`, `autorretencion`, `uvt`,
   `smmlv`), y todos llaman a la aplicación por HTTP (`httpRequest`/`webhook`/`scheduleTrigger`),
   nunca importando código de este repositorio. El único nodo "de lógica" es un `code` que reordena
   campos del payload del proveedor de correo a la forma neutra `CorreoEntrante` — transporte, no
   negocio.

---

## 1. Workflows definidos, y su propósito (sección 13.1)

Sin instancia de n8n contratada (instrucción explícita, ninguna se contrata aquí). Los seis quedan
como **definiciones versionadas** en `n8n/*.workflow.json`, exportables/importables tal como los
produciría la UI de n8n. `n8n/README.md` documenta cómo importarlos y qué queda manual.

| Workflow | Propósito (sección 13.1) |
|---|---|
| `ingest-correo.workflow.json` | Recibe el webhook del proveedor de inbound email, normaliza a `CorreoEntrante` y hace `POST /api/integraciones/correo` con reintento (`retryOnFail`, 5 intentos); notifica al fallo definitivo. |
| `notificacion-facturas-pendientes.workflow.json` | Diario: por cada empresa activa, `GET .../notificaciones/pendientes`; notifica si hay documentos esperando aprobación hace más de N días. |
| `notificacion-buzon-fallido.workflow.json` | Cada hora: por cada empresa activa, `GET .../notificaciones/buzones-fallidos`; notifica si un buzón acumula correos rechazados/en cuarentena. |
| `notificacion-vencimientos.workflow.json` | Diario: por cada empresa activa, `GET .../notificaciones/vencimientos`; notifica vencimientos de `tax_calendar` (A1) dentro de una ventana. |
| `respaldo-programado.workflow.json` | **Esqueleto explícito**: el mecanismo real de respaldo es de A15 (snapshot del Postgres gestionado), que no existe todavía. El `noOp` documenta el punto de enganche en vez de inventar un endpoint. |
| `reporte-periodico.workflow.json` | **Esqueleto explícito**: los reportes son de A9/A10/A11, que no habían corrido su Ola 2 al momento de esta entrega. Mismo criterio que el respaldo: no se inventa el endpoint. |

**Aplicación (código probable, sin red):**

- `app/api/integraciones/correo/route.ts` — el endpoint de ingest (`POST`).
- `app/api/integraciones/empresas/route.ts` — lista las empresas activas de la firma del token, para
  que n8n itere "una llamada por empresa" (mismo patrón que la bandeja multi-empresa de A7).
- `app/api/integraciones/notificaciones/{pendientes,buzones-fallidos,vencimientos}/route.ts` — los
  tres `GET` de solo lectura que consumen los workflows de notificación.

---

## 2. Autenticación por token con alcance de tenant (cierre de V-9, sin rodear a A12)

### 2.1 Diseño: un segundo camino de primer factor, el MISMO `abrir_sesion`

Un correo entrante no tiene humano detrás que teclee una contraseña, pero escribir en la base exige
una sesión real derivada de un token verificado (D-021). La solución **no inventa un mecanismo de
contexto nuevo**: añade un segundo camino de *identidad* (un token de integración en vez de
contraseña+TOTP) que termina en el **mismo** `app.abrir_sesion` que ya usa el login humano, sin
tocarlo ni una línea (`db/migrations/015_sesiones_contexto_verificado.sql` queda intacta).

```
token de integración (n8n) → app.autenticar_token_integracion (app_auth) → user_id + tenant_id
                                                                              │
                                                          abrirSesion(db, { userId, minutos: 10 })  ← SIN MODIFICAR
                                                                              │
                                                          sesión real en app.session_context (D-021)
```

- **`app.integration_credential`** (migración 090): tabla del esquema `app`, sin RLS y sin GRANTs
  para ningún rol de aplicación — mismo patrón que `app.session_context`. Guarda `sha256(token)`,
  nunca el token (mismo cálculo que `app.hash_token`, sin criptografía nueva: un token de
  integración es, igual que un token de sesión, un secreto de 256 bits generado por el servidor, no
  una contraseña humana).
- **`app.crear_token_integracion` / `revocar_token_integracion` / `listar_tokens_integracion`**:
  `SECURITY DEFINER`, filtran siempre por `app.current_tenant_id()` (nunca por un tenant que el
  llamador pase como parámetro — la misma disciplina que D-023 le exige a `abrir_sesion`), exigen
  `usuario.administrar`. Se invocan desde una sesión **humana** ya autenticada (un administrador de
  la firma), nunca desde el canal de correo.
- **`app.autenticar_token_integracion`**: el análogo exacto de `app.buscar_credencial`, concedido
  **solo a `app_auth`**, nunca a `app_user` — mismo reparto de roles de D-023, verificado en
  `tests/integraciones/token-sistema.test.ts` y reflejado en el inventario cerrado de funciones
  `SECURITY DEFINER` de `compuerta-ola1.test.ts`/`evasion.test.ts` (D-042: "ampliarlo en un solo
  sitio ya no basta" — actualicé los dos).

### 2.2 El usuario de sistema: alcance mínimo, medido

Un rol de negocio nuevo, `sistema_ingesta` (migración 090), con **exactamente** `documento.leer` +
`documento.cargar` — nunca `causacion.*`, nunca `parametro.*`, nunca `asiento.publicar`. Si alguien
roba un token de integración, no puede aprobar nada, publicar nada, ni tocar un parámetro
tributario. `tests/integraciones/token-sistema.test.ts` lo mide contra `v_user_permission`, no lo
afirma. El usuario de sistema no tiene `password_hash`: el camino de login humano
(`iniciarSesion`/`app.buscar_credencial`) lo rechaza limpio si alguien lo intentara ahí.

### 2.3 Multi-empresa: el mismo límite que ya resolvió A7, no un atajo nuevo

`user_company_access` tiene RLS de tenant+**empresa** estricta (D-021/D-022): una sola sesión no
puede escribir el acceso de varias empresas a la vez, ni aunque sean de la misma firma. Es el mismo
problema que A7 resolvió para la bandeja (`app/lib/bandeja.ts`: "una sesión por empresa, agregadas
en una sola pantalla"). Seguí el mismo patrón en vez de rodearlo:

- `sincronizarAccesoEmpresaIngesta` (`src/integraciones/aprovisionamiento.ts`) opera **sobre la
  empresa que la sesión ya tiene elegida**, nunca sobre "todas" en una sola llamada.
- `app/lib/integraciones.ts` (`sincronizarAccesoTodasLasEmpresas`) es la orquestación multi-empresa,
  en `app/` (no en `src/services`/`src/integraciones`), **igual que `app/lib/bandeja.ts`**: lista las
  empresas con una sesión "de firma" (`company` tiene RLS de tenant, no de tenant+empresa) y abre,
  una por una, una sesión real por empresa con el **mismo token** del administrador
  (`conSesionEmpresa`).
- **Limitación declarada, a propósito, mismo criterio que V-7/V-8 de A7**: si la firma da de alta una
  empresa nueva después de activar el canal, el correo de esa empresa se autentica bien (el token es
  de la FIRMA) pero se rechaza con `empresa_no_autorizada` hasta que un administrador vuelva a
  sincronizar. No inventé un disparador automático en el `INSERT` de `company` porque tocaría el
  trigger de permiso compartido de `user_company_access` (migración 016) para ahorrar un paso
  manual de una llamada — no valía el riesgo sobre infraestructura de A12.

### 2.4 Idempotencia por CUFE — sin restricción propia

**No creé ninguna restricción nueva de deduplicación.** `procesarWebhookCorreo` delega en
`recibirDocumento` (A6), que delega en `guardarDocumentoProcesado` (A4), que usa
**`source_document_cufe_uq`** (A2, `008_documentos.sql`) tal cual. `tests/integraciones/
webhook-correo.test.ts` reenvía el mismo adjunto dos veces: la segunda vez vuelve `duplicado`, con
el mismo `sourceDocumentId`, y sigue habiendo **una sola** fila en `source_document`.

### 2.5 Registro de todo llamado entrante (y saliente, declarado sin inflar)

`integration_call_log` (migración 091), append-only, mismo patrón de `audit_log`/`email_ingest_log`
para `tenant_id NULL` (una llamada que no superó la autenticación no tiene firma a la que
atribuírsele, y queda invisible para cualquier tenant). Cubre:

- Toda llamada al webhook de ingest, autenticada o no (`no_autenticado`, `buzon_no_reconocido`,
  `rechazado`, `ok`).
- **`direccion`**: modelada con dos valores (`entrante`/`saliente`), pero **hoy solo se escribe
  `entrante`** — toda la integración actual es HTTP entrante (n8n llama a la aplicación; la
  aplicación nunca llama hacia afuera). Declararlo así, sin ejercitar `saliente`, es más honesto que
  fabricar una llamada saliente de mentira solo para "llenar" la columna (mismo criterio que V-5: un
  valor inventado es peor que uno faltante). Cuando exista una integración saliente real (bancos,
  proveedores tecnológicos — sección 13.1, "integraciones futuras"), esta tabla ya tiene el campo
  listo.

### 2.6 V-1 — mi autenticación no depende de que el buzón sea secreto

A14 midió que `app.resolver_empresa_por_buzon` devuelve el `tenant_id`/`company_id` de **otra**
firma si se conoce su buzón (D-042, gravedad baja, ACEPTADA con corrección asignada a A12+A4). Mi
diseño **no usa esa función en absoluto** en el camino de correo: el tenant lo da el token
(autenticación real), y resolver la EMPRESA dentro de esa firma es un `SELECT` normal contra
`company`, que ya tiene RLS de **tenant** estricto (`instalar_rls_tenant`, no depende de conocer la
empresa de antemano). `tests/integraciones/webhook-correo.test.ts` lo prueba con el escenario exacto
de V-1: un token de la firma A con el buzón de la firma B en el payload se rechaza como "buzón no
reconocido **en esa firma**" — la fila de auditoría queda del lado de A (que se autenticó), **B no
ve ni escribe nada**, y se verifica contando filas de `source_document` de B antes y después (cero
nuevas).

**Lo que NO hice, a propósito:** no toqué el `GRANT` de `app.resolver_empresa_por_buzon` (D-042 lo
asigna explícitamente a "A12 (crear la sesión de sistema) + A4 (mover el GRANT)", y esa función y su
adversarial de medición (`tests/adversarial/compuerta-ola1.test.ts`, "¿se puede cruzar de firma por
ahí?") son territorio de A4. Con la sesión de sistema ya construida, **la corrección de D-042 queda
desbloqueada** — se lo dejo explícito a A4/A12 en vez de tocar su superficie sin coordinar.

---

## 3. V-9 — RESUELTO, no bloqueado

No encontré nada en el mecanismo de sesión de A12 que exigiera un cambio en su código para
resolver esto: `app.abrir_sesion` ya es genérico (recibe cualquier `user_id` activo, deriva el
tenant de `app.usuario`), y el patrón de "un segundo rol de autenticación con superficie mínima"
(D-023) generaliza limpio a un segundo *tipo* de credencial. Construí encima, exactamente como A7 lo
hizo para la bandeja multi-empresa (una sesión por empresa, nunca un atajo que fije el contexto a
mano): un token de integración → `app.autenticar_token_integracion` (nuevo, patrón de
`buscar_credencial`) → `app.abrir_sesion` (**sin modificar**) → sesión real, indistinguible para el
resto del sistema de una sesión humana. `tests/integraciones/token-sistema.test.ts` lo demuestra
pasando la sesión de sistema por el mismo `withSessionContext` que usa cualquier ruta humana, con
RLS activa de verdad, y confirmando que el token de una firma nunca abre una sesión de otra
(`EmpresaNoAutorizadaError`, del motor, no de un `if` de aplicación).

Si algo hubiera exigido tocar `src/auth/` o el esquema de `app.session_context`, lo habría dejado
bloqueado y dicho explícitamente. No fue necesario: todo lo nuevo vive en `src/integraciones/`
(módulo propio, declarado en el canario de inventario de `src/`) y en dos migraciones dentro de mi
rango reservado (090–091).

---

## 4. Qué queda como configuración manual al desplegar

1. **Proveedor de inbound email real** (SendGrid Inbound Parse, Mailgun Routes, SES+SNS,
   Postmark...): ninguno contratado. El nodo `Webhook - proveedor de correo` de
   `ingest-correo.workflow.json` necesita registrarse en el proveedor que se elija, y el nodo
   `Normalizar a CorreoEntrante` hay que reescribirlo para su payload real.
2. **Emitir el token de integración por firma**: acción de un administrador con
   `usuario.administrar` (`provisionarCanalIngestaCorreo`), **una vez**, copiado a la credencial de
   n8n. No hay pantalla todavía (A7/A8, futuro) — se invoca desde una consola/acción de servidor.
3. **`APP_BASE_URL`** y las credenciales de notificación (correo/Slack) de cada workflow.
4. **Sincronizar el acceso cuando se dé de alta una empresa nueva** (`sincronizarAccesoTodasLasEmpresas`
   o, por ahora, `sincronizarAccesoEmpresaIngesta` en la sesión de esa empresa) — limitación
   declarada en §2.3, no automática a propósito.
5. **Mecanismo real de respaldo (A15) y de reportes (A9/A10/A11)**: los dos workflows
   correspondientes quedan como esqueletos explícitos hasta que existan.
6. **Mover el `GRANT` de `app.resolver_empresa_por_buzon`** (D-042): ahora desbloqueado, pendiente
   de A12/A4.

---

## 5. Archivos entregados

```
db/migrations/
  090_a13_sesion_sistema_integraciones.sql   rol sistema_ingesta, app.integration_credential,
                                              crear/revocar/listar/autenticar_token_integracion,
                                              ampliación de email_ingest_log_scope_ck
  091_a13_integraciones_registro.sql         integration_call_log (append-only, RLS)

src/integraciones/
  token.ts               tokens: crear/revocar/listar/autenticar (envoltorio TS)
  sesion-sistema.ts       abrirSesionSistema/cerrarSesionSistema (sobre abrirSesion de A12, sin tocarla)
  aprovisionamiento.ts    usuario de sistema, sincronización de acceso por empresa
  llamadas.ts             integration_call_log: registrarLlamada / registrarLlamadaNoAutenticada
  ingest-correo.ts        procesarWebhookCorreo — la costura completa
  notificaciones.ts       facturas pendientes / buzones con fallas / vencimientos (solo lectura)
  index.ts                superficie pública

app/lib/
  integraciones-auth.ts   Bearer token -> sesión de sistema, para las rutas HTTP
  integraciones.ts        orquestación multi-empresa (mismo patrón que app/lib/bandeja.ts de A7)

app/api/integraciones/
  correo/route.ts                                POST — endpoint de ingest
  empresas/route.ts                              GET  — empresas activas de la firma del token
  notificaciones/pendientes/route.ts             GET
  notificaciones/buzones-fallidos/route.ts       GET
  notificaciones/vencimientos/route.ts           GET

n8n/
  ingest-correo.workflow.json
  notificacion-facturas-pendientes.workflow.json
  notificacion-buzon-fallido.workflow.json
  notificacion-vencimientos.workflow.json
  respaldo-programado.workflow.json              esqueleto explícito (pendiente A15)
  reporte-periodico.workflow.json                esqueleto explícito (pendiente A9/A10/A11)
  README.md                                      configuración manual, frontera aplicada

tests/integraciones/
  token-sistema.test.ts     11 pruebas — V-9, alcance mínimo, aislamiento cross-tenant, rotación
  webhook-correo.test.ts    9 pruebas — camino feliz, idempotencia CUFE, V-1, auth fallida,
                             payload inválido, SPF/DKIM, límite de tasa
  notificaciones.test.ts    4 pruebas — solo lectura, aislamiento entre firmas
  frontera.test.ts          8 pruebas — nunca importa causación/dominio, nunca calcula, n8n limpio

Cambios aditivos en archivos existentes (todos con comentario explicando por qué):
  src/db/types.ts                              SQLSTATE.INTEGRACION_TOKEN_INVALIDO / _USUARIO_AJENO
  tests/helpers/db.ts                          REVOKE/GRANT espejados (D-034) para las funciones y
                                                la tabla nuevas
  tests/adversarial/compuerta-ola1.test.ts     inventario DEFINER + 090/091 en el diccionario
  tests/adversarial/evasion.test.ts            inventario DEFINER + privilegios de app_auth (3, no 2)
  tests/adversarial/casos-dorados.test.ts      'integraciones' en la lista cerrada de módulos de src/
  tests/gates/esquema.test.ts                  'sistema_ingesta' en los roles de sistema
  tests/gates/seguridad.test.ts                'sistema_ingesta' en los roles de sistema
```

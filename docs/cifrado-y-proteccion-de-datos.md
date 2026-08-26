# Cifrado y protección de datos

**Documento:** SEG-001
**Versión:** 1.0
**Autor:** Agente A12 — Seguridad y cumplimiento, Ola 0

> Este documento es el anexo técnico de seguridad de los documentos `POL-HD-001`,
> `CTR-HD-001` y `TYC-001`. Cada control lleva su estado REAL:
>
> | Marca | Significado |
> |---|---|
> | **[CÓDIGO]** | Implementado en el producto y verificado por una prueba automatizada |
> | **[CONFIG]** | Es configuración del proveedor de infraestructura o del despliegue. No es código nuestro. Hay que hacerlo y dejar constancia |
> | **[PENDIENTE]** | No está. Se escribe que no está |
>
> Un anexo de seguridad que enumera controles sin decir cuáles están operando no
> sirve para auditar nada, y es peor que no tenerlo porque induce a confianza.

---

## 1. Cifrado en tránsito (TLS)

### 1.1 Cliente ↔ aplicación

**[CONFIG]** La terminación TLS la hace la plataforma de despliegue
([PROVEEDOR DE HOSTING]). Configuración exigida:

- TLS 1.2 como mínimo; TLS 1.3 preferido.
- Redirección permanente de HTTP a HTTPS.
- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`.
- Cookies de sesión con `Secure`, `HttpOnly` y `SameSite=Lax`.
- Certificado gestionado automáticamente por el proveedor, con renovación automática.

**Verificación exigida al desplegar:** ejecutar una prueba de configuración TLS contra
el dominio productivo y archivar el resultado. **[PENDIENTE]** — no hay dominio
productivo todavía.

### 1.2 Aplicación ↔ base de datos

**[CONFIG]** La conexión a la base de datos debe usar TLS con verificación de
certificado. En la cadena de conexión:

```
postgres://USUARIO:CLAVE@HOST:5432/BASE?sslmode=verify-full
```

`sslmode=verify-full` es lo que se exige: `require` cifra pero **no verifica la
identidad del servidor**, lo que deja abierta la interceptación activa. Los
proveedores administrados (Supabase, Neon) suministran el certificado de la autoridad
para esa verificación.

**Estado:** la cadena de conexión se toma de la variable de entorno `DATABASE_URL` y
el cliente no impone `sslmode` por su cuenta. **Queda como configuración de
despliegue**, y como tal debe quedar registrada en la lista de verificación de puesta
en producción.

### 1.3 Aplicación ↔ servicios externos

**[CONFIG]** Toda llamada saliente —proveedor del modelo de lenguaje, correo
entrante— se hace por HTTPS. Las credenciales viajan en cabeceras, nunca en la URL.

## 2. Cifrado en reposo

### 2.1 Base de datos y respaldos

**[CONFIG]** El cifrado en reposo del volumen de datos y de los respaldos **lo provee
el proveedor de base de datos administrada** y no es código nuestro:

| Proveedor | Qué cifra | Quién administra la clave |
|---|---|---|
| Supabase | Volúmenes y respaldos, con AES-256 sobre la infraestructura subyacente | El proveedor |
| Neon | Almacenamiento y respaldos, con AES-256 | El proveedor |

**Lo que hay que hacer y dejar por escrito al contratar:** confirmar en la
documentación vigente del proveedor elegido que el cifrado en reposo está activo en el
plan contratado —no solo en los planes superiores— y archivar la constancia junto con
su informe de auditoría independiente, si lo publica.

**Lo que este cifrado NO protege.** Conviene decirlo, porque suele darse por hecho lo
contrario: el cifrado en reposo del proveedor protege frente al acceso físico al disco
y frente al descarte de hardware. **No protege** frente a un volcado lógico legítimo
—un `pg_dump`, un respaldo restaurado, un acceso de soporte del proveedor—, porque en
todos esos casos el motor entrega los datos ya descifrados. Por eso los secretos que
más importan llevan una segunda envoltura hecha por la aplicación (numeral 2.2), y por
eso las contraseñas nunca se guardan de forma reversible (numeral 3.1).

### 2.2 Cifrado de aplicación sobre datos críticos

**[CÓDIGO]** `src/auth/cifrado.ts`.

El **secreto de segundo factor (TOTP)** se guarda envuelto en **AES-256-GCM** con una
clave de aplicación que **no vive en la base de datos**, sino en la variable de entorno
`APP_ENCRYPTION_KEY`, administrada en el proveedor de despliegue.

- IV de 96 bits aleatorio por operación.
- Etiqueta de autenticación de 128 bits: si el texto cifrado se altera, el descifrado
  falla en vez de devolver basura.
- Identificador de esquema (`gcm1`) dentro del registro, para poder rotar sin migrar.

**Consecuencia práctica:** un volcado de la base de datos, por sí solo, no permite
clonar el segundo factor de ningún usuario. Se necesita además la clave, que está en
otro sistema.

**Verificado por** `tests/gates/autenticacion.test.ts`: ida y vuelta, IV distinto en
cada cifrado, fallo con clave equivocada y detección de manipulación.

**[PENDIENTE]** Procedimiento escrito de **rotación** de `APP_ENCRYPTION_KEY`, con
recifrado de los secretos existentes.

### 2.3 Contraseñas

**[CÓDIGO]** `src/auth/password.ts`. No es cifrado sino **derivación de clave
irreversible**, que es lo correcto: una contraseña nunca debe poder recuperarse.

- **scrypt** (RFC 7914) de `node:crypto`, con N=2^14, r=8, p=1, clave de 32 bytes y sal
  aleatoria de 16 bytes por contraseña.
- Registro autodescriptivo: los parámetros viajan dentro, de modo que endurecerlos más
  adelante no invalida las contraseñas existentes. `necesitaRehash()` detecta los
  registros derivados con parámetros débiles.
- Comparación en **tiempo constante** (`timingSafeEqual`).
- Longitud mínima de 12 caracteres.

**Por qué scrypt y no bcrypt o Argon2:** ambos son módulos nativos que hay que compilar
por plataforma, complicando el despliegue con un solo desarrollador y un presupuesto de
USD 20/mes, sin ganancia de seguridad relevante a estos parámetros. scrypt viene en el
runtime y es primitiva estándar. **No se instaló ninguna dependencia nueva.**

**Verificado por** `tests/gates/autenticacion.test.ts`.

### 2.4 Tokens de sesión

**[CÓDIGO]** `src/auth/sesion.ts` y `db/migrations/015_sesiones_contexto_verificado.sql`.

El token es de 32 bytes de `randomBytes` (256 bits). **De él se almacena únicamente
`sha256(token)`**; el token en claro no se guarda en ninguna parte. Un volcado de la
base no permite reconstruir sesiones vivas.

Hay una prueba que verifica que el hash calculado en TypeScript y el calculado en
PostgreSQL coinciden, para que las dos implementaciones no se separen con el tiempo.

## 3. Autenticación

| Control | Estado | Dónde |
|---|---|---|
| Derivación de contraseña con scrypt | **[CÓDIGO]** | `src/auth/password.ts` |
| Segundo factor TOTP (RFC 6238), verificado contra los vectores de los RFC | **[CÓDIGO]** | `src/auth/totp.ts` |
| MFA **disponible** para cualquier usuario | **[CÓDIGO]** | Columnas `mfa_habilitado`, `mfa_secret_cifrado` |
| MFA **obligatorio** para roles con permiso de aprobación o de parametrización | **[PENDIENTE]** | Requiere decisión de producto e interfaz (A7/A8) |
| Sesiones con vencimiento (8 h por defecto, tope duro de 24 h impuesto por la base) | **[CÓDIGO]** | `app.abrir_sesion`, SQLSTATE `SE001` |
| Revocación individual y masiva de sesiones | **[CÓDIGO]** | `app.cerrar_sesion`, `app.revocar_sesiones_de_usuario` |
| Suspender un usuario corta sus sesiones vivas de inmediato | **[CÓDIGO]** | Trigger `user_espejo_seguridad` |
| Bloqueo por 15 minutos tras 5 intentos fallidos consecutivos | **[CÓDIGO]** | `app.contar_intento_fallido` |
| Respuesta de tiempo constante ante correo inexistente | **[CÓDIGO]** | `src/auth/autenticacion.ts` (registro señuelo) |
| Limitación de tasa por IP en el borde | **[PENDIENTE]** | Corresponde a la capa HTTP y al proveedor de despliegue |
| Recuperación de contraseña por correo | **[PENDIENTE]** | Requiere el canal de correo saliente |
| Rotación obligatoria de contraseñas | **No se implementa a propósito** | La rotación forzada periódica degrada la calidad de las contraseñas; se prefiere longitud mínima + MFA |

## 4. Aislamiento entre clientes

**[CÓDIGO]** Es el control central del producto y el que más se prometió por escrito,
así que se describe con precisión.

1. **Seguridad a nivel de fila (RLS) habilitada y forzada** en todas las tablas de
   datos, con doble nivel `tenant_id` / `company_id`. Sin `FORCE`, el dueño de la tabla
   queda exento y la política sería decorativa.
2. **El contexto de aislamiento se deriva de un token de sesión que la base verifica**,
   no de un parámetro que la sesión elige. Antes de la migración 015, cualquier sesión
   podía declararse de otro cliente con `set_config('app.tenant_id', ...)`. Ya no: esa
   variable quedó inerte y hay una prueba que lo demuestra.
3. **El almacén de sesiones vive fuera del alcance del rol de aplicación.** La tabla
   `app.session_context` está en un esquema sobre el que `app_user` no tiene ningún
   privilegio: no puede leerla, ni escribirla, ni fabricar una fila. De cada sesión
   guarda solo el hash del token.
4. **La empresa la pide el cliente y la autoriza la base.** Una sesión puede solicitar
   operar sobre una empresa; la base solo concede el contexto si esa sesión tiene un
   acceso vigente sobre ella. El intento fallido queda registrado como
   `ACCESO_DENEGADO`.
5. **Dos roles de base de datos separados.** `app_user` sirve las peticiones y **no
   puede emitir sesiones ni leer credenciales**; `app_auth` solo autentica y **no tiene
   privilegio sobre ninguna tabla de negocio**. Una inyección SQL dentro de una
   petición autenticada no puede fabricarse una sesión de otro cliente.
6. **Claves foráneas compuestas** `(id, tenant_id, company_id)`: las comprobaciones de
   integridad referencial no pasan por RLS, así que sin ellas una partida podría apuntar
   a un asiento de otro cliente y solo la política impediría verlo.
7. **Todas las vistas con `security_invoker`**: sin esa opción, una vista corre con los
   privilegios de su dueño y salta la RLS de las tablas base.

**Verificado por** `tests/gates/seguridad.test.ts`, que recorre el catálogo del motor
(`pg_class`, `pg_policies`, `pg_proc`, `pg_trigger`) en vez de una lista escrita a mano,
y por un barrido de comportamiento que consulta **todas** las tablas con `tenant_id`
desde una sesión y verifica que no aparezca ni una fila de otro cliente.

### 4.1 Límite honesto de esta verificación

En el entorno de pruebas (PGlite) la conexión subyacente es superusuario y el descenso
de privilegio a `app_user` es **reversible**: desde dentro de una prueba se puede
volver a superusuario. Es decir, las pruebas demuestran que **las políticas funcionan**,
no que la aplicación no pueda saltárselas.

**En producción eso se cierra por configuración, y es obligatorio: la aplicación debe
conectarse con un rol de login que SEA `app_user`**, sin `SUPERUSER`, sin `BYPASSRLS` y
sin ser dueño de las tablas. Con esa conexión, el descenso de privilegio deja de ser
reversible.

**[CONFIG]** Lista de verificación de puesta en producción:

- [ ] Rol de login de la aplicación creado, distinto del dueño de las migraciones.
- [ ] `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = '<rol de la app>'`
      devuelve `false, false`.
- [ ] El rol de la aplicación no es dueño de ninguna tabla del esquema `public`.
- [ ] Rol separado para el camino de autenticación, con las credenciales en un secreto
      distinto.
- [ ] Las migraciones se ejecutan con un rol distinto del de la aplicación.

## 5. Control de acceso por roles

**[CÓDIGO]** Los cinco roles mínimos exigidos —administrador de firma, administrador
tributario, contador, auxiliar de causación y solo lectura— existen con 25 permisos
granulares, y **la restricción la impone la base de datos**: un disparador `BEFORE` en
cada tabla de escritura exige el permiso correspondiente y rechaza con `SE002` cuando
falta.

Esto significa que un auxiliar de causación no puede editar un parámetro tributario
**aunque la interfaz tuviera un error y le mostrara el botón**. Hay una prueba que
recorre desde el catálogo todas las tablas protegidas y verifica que un rol de solo
lectura no escriba en ninguna.

## 6. Registro de auditoría

**[CÓDIGO]** La tabla `audit_log` es **append-only por imposición del motor**: no
admite `UPDATE` ni `DELETE`, ni siquiera para el superusuario, lo que la hace útil como
evidencia.

Registra usuario, marca de tiempo, dirección IP, agente de usuario, identificador de
petición, valor anterior y valor nuevo, para:

| Acción sensible | Estado |
|---|---|
| Aprobaciones | **[CÓDIGO]** |
| Ediciones de parámetros tributarios | **[CÓDIGO]** |
| Cambios de mapeo PUC y de plan de cuentas | **[CÓDIGO]** |
| Accesos denegados a datos de otra empresa | **[CÓDIGO]** |
| Inicios de sesión, cierres e intentos fallidos | **[CÓDIGO]** |
| Creación, publicación y reversa de asientos | **[CÓDIGO]** |
| Cierre de período fiscal | **[CÓDIGO]** |
| Altas, bajas y cambios de usuarios y de accesos | **[CÓDIGO]** |

**Las credenciales nunca entran al registro**: el disparador de auditoría de la tabla
de usuarios redacta `password_hash` y `mfa_secret_cifrado` antes de escribir. Un
registro de auditoría que copiara las credenciales convertiría la evidencia en el
botín.

## 7. Gestión de secretos

**[CONFIG]** Ningún secreto se versiona en el repositorio. `.gitignore` excluye `.env`.
Variables requeridas en producción:

| Variable | Contenido | Rotación |
|---|---|---|
| `DATABASE_URL` | Conexión con el rol de aplicación, con `sslmode=verify-full` | Al cambiar de proveedor o ante sospecha |
| `DATABASE_URL_AUTH` | Conexión con el rol de autenticación | Igual |
| `APP_ENCRYPTION_KEY` | 32 bytes en base64, para el sobre AES-256-GCM | **[PENDIENTE]** definir procedimiento |
| `[CLAVE DEL PROVEEDOR DE IA]` | Credencial del modelo de lenguaje | Trimestral |

## 8. Respaldos y continuidad

**[CONFIG]** Los respaldos los provee el proveedor de base de datos administrada.
**[PENDIENTE]** La **prueba de restauración** no se ha ejecutado. Sin ella, la promesa
de reproducción exacta del artículo 28 de la Ley 962 de 2005 no está verificada, solo
afirmada. Ver `POL-RET-001`, numeral 7.

## 9. Resumen del estado real

| Control exigido | Estado |
|---|---|
| RLS activa y forzada en todas las tablas de datos | **[CÓDIGO]**, verificado por catálogo |
| Contexto derivado de claim verificado (cierre de D-020) | **[CÓDIGO]** |
| Cifrado en tránsito (TLS) | **[CONFIG]** — no desplegado todavía |
| Cifrado en reposo | **[CONFIG]** — a cargo del proveedor |
| Cifrado de aplicación sobre el secreto de MFA | **[CÓDIGO]** |
| MFA disponible (TOTP) | **[CÓDIGO]** |
| MFA obligatorio por rol | **[PENDIENTE]** |
| Cinco roles mínimos con permisos granulares | **[CÓDIGO]** |
| `audit_log` de acciones sensibles con usuario, hora e IP | **[CÓDIGO]** |
| Rol de aplicación no superusuario en producción | **[CONFIG]** — obligatorio, ver 4.1 |
| Limitación de tasa en el borde | **[PENDIENTE]** |
| Respaldos con prueba de restauración | **[PENDIENTE]** |
| Rotación de la clave de cifrado de aplicación | **[PENDIENTE]** |

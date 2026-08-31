# Arranque: cómo entrar al sistema la primera vez

Esta guía es para el **operador** (quien instala el sistema), no para el contador que lo usa a diario.
Se hace **una sola vez por instalación**. No hay que saber SQL ni programar.

---

## 1. Qué crea

Tres cosas, en una sola orden:

1. La **firma contable** (el *tenant*: su empresa).
2. Su **primera empresa-cliente** (la primera PYME que va a llevar).
3. El **usuario administrador de firma**, con contraseña, y su acceso a esa empresa.

No crea nada más. No hay registro por internet, no hay página de "crear cuenta" y **es a propósito**:
crear una firma es tocar la raíz del aislamiento entre clientes, y eso solo lo puede hacer quien ya
tiene la contraseña de la base de datos.

---

## 2. Antes de empezar

Necesita tener a mano, en una terminal abierta en la carpeta del proyecto:

- `DATABASE_URL` apuntando a su base de datos PostgreSQL, **con el usuario dueño de la base**
  (el mismo que usa para `npm run migrate`). Si no la define, el comando funciona igual pero
  **contra una base en memoria que se borra al terminar** — sirve para practicar, no para trabajar.
- Las migraciones y los datos paramétricos ya cargados: `npm run migrate` y `npm run seed`.
  (Si no lo hizo, añada `--migrar` al comando de abajo y lo hace todo de una vez.)

---

## 3. El comando

Copie esto, cambie los datos entre comillas por los suyos y péguelo en la terminal **en una sola línea**
(o tal cual, con las barras `\` al final de cada línea, si su terminal las admite):

```bash
npm run arranque -- \
  --firma-nit=901234567 \
  --firma="Mi Firma Contable SAS" \
  --empresa-nit=800111222 \
  --empresa="Comercializadora del Norte SAS" \
  --admin-email=david@mifirma.com \
  --admin-nombre="David Silva"
```

En Windows con PowerShell, en una sola línea:

```powershell
npm run arranque -- --firma-nit=901234567 --firma="Mi Firma Contable SAS" --empresa-nit=800111222 --empresa="Comercializadora del Norte SAS" --admin-email=david@mifirma.com --admin-nombre="David Silva"
```

Qué es cada cosa:

| Dato | Qué poner |
|---|---|
| `--firma-nit` | NIT de **su firma contable**, solo dígitos, sin puntos ni guion |
| `--firma` | Razón social de su firma |
| `--empresa-nit` | NIT de la **primera empresa-cliente** que va a llevar |
| `--empresa` | Razón social de esa empresa-cliente |
| `--admin-email` | El correo con el que **usted** va a iniciar sesión |
| `--admin-nombre` | Su nombre completo |

Opcionales:

| Opción | Para qué |
|---|---|
| `--password="..."` | Fijar usted la contraseña (mínimo 12 caracteres). Si no la pone, el sistema genera una segura |
| `--empresa-dv=1` | Dígito de verificación del NIT de la empresa-cliente |
| `--firma-email=...` | Correo de contacto de la firma, si es distinto del suyo |
| `--migrar` | Aplica antes las migraciones y los datos paramétricos |
| `--solo-si-vacio` | Aborta si ya existe alguna firma. Útil en scripts de instalación |
| `--rotar-password` | **Solo** si perdió la contraseña: le pone una nueva al usuario que ya existía |

---

## 4. Lo que va a ver

```
=== ARRANQUE LISTO ===
  Firma    : 0d720bf0-...   (creada/o ahora)
  Empresa  : 69e31fb2-...   (creada/o ahora)
  Usuario  : b0d5d392-...   (creada/o ahora)
  Acceso   : rol administrador de firma (creada/o ahora)

  CONTRASEÑA INICIAL (se muestra UNA sola vez, cópiela ahora):

      3pzaBZcyyrvo-IhKQ6qRSfTkvNDhcR7J

  No queda guardada en ninguna parte: la base solo tiene su derivación scrypt.
```

**Copie esa contraseña ahora mismo** y guárdela en su gestor de contraseñas. No se puede volver a ver:
la base de datos solo guarda una derivación irreversible (scrypt), no la contraseña.

Si la pierde, no está perdido: vuelva a correr exactamente el mismo comando añadiendo
`--rotar-password` y le dará una nueva. Eso cierra todas las sesiones abiertas de ese usuario y queda
registrado en la auditoría.

---

## 5. Entrar

1. Levante la aplicación: `npm run dev` (o su despliegue de producción).
2. Abra `/entrar` en el navegador.
3. Escriba el correo y la contraseña. El campo de "código de segundo factor" se deja **vacío**
   mientras no active MFA.
4. Llegará a la portada. Ahí **elija la empresa** con la que va a trabajar y pulse *Elegir*.
5. Desde la portada llega a **Bandeja**, **Parámetros**, **Terceros** y **Reportes**.

> La bandeja y los reportes necesitan una empresa elegida. Los parámetros compartidos de la firma
> se editan con la opción *"sin empresa"*.

---

## 6. Preguntas que se hace todo el mundo

**¿Y si lo corro dos veces por error?**
No pasa nada. El comando busca la firma por NIT, la empresa por NIT y el usuario por correo. Lo que ya
existe lo reporta como *"ya existía, sin tocar"* y no lo modifica. **Nunca le cambia la contraseña a un
usuario que ya existe** salvo que usted lo pida a propósito con `--rotar-password`.

**¿Y si ya tengo datos y clientes cargados?**
También es seguro: no borra ni reescribe nada. Si quiere una garantía extra de que solo corra en una
instalación nueva, añada `--solo-si-vacio` y abortará en cuanto vea una firma ya creada.

**¿Puedo crear más empresas-cliente y más usuarios con esto?**
Sí, volviendo a correrlo con otro `--empresa-nit` y otro `--empresa` (la firma se reconoce por el NIT y
no se duplica). Pero lo normal es hacerlo desde la aplicación una vez dentro.

**¿Por qué no hay una página web para crear la firma?**
Porque sería una puerta abierta a la raíz del aislamiento entre firmas. Ver la discusión completa en la
cabecera de `src/bootstrap/arranque.ts`. En resumen: este comando exige la contraseña de la base de
datos, que ya permite hacer lo mismo a mano; no añade ningún poder nuevo y no añade ni un byte de
superficie expuesta a internet.

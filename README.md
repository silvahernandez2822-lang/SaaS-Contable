# Contable CO

SaaS contable multi-tenant para Colombia. El corazón del producto es un motor de causación
automática de facturas de compra: entra el XML de una factura electrónica DIAN, sale un asiento
contable con las retenciones (retefuente, ReteIVA, ReteICA, autorretención) calculadas, trazadas y
listas para aprobación humana. El sistema **no emite** factura electrónica ante la DIAN; solo la
recibe y la procesa.

Este documento está escrito para instalarlo y probarlo en su propia máquina **sin saber
programar**. Si usted es quien va a mantener o extender el código, lea primero
[CLAUDE.md](CLAUDE.md) y [MEGA_PROMPT_SOFTWARE_CONTABLE_CO.md](MEGA_PROMPT_SOFTWARE_CONTABLE_CO.md).

---

## 0. Antes de empezar

Necesita tres cosas instaladas en su computador:

1. **Node.js**, versión 20 o superior. Descárguelo de <https://nodejs.org> (elija la versión LTS) e
   instálelo como cualquier programa. Para comprobar que quedó instalado, abra una terminal y
   escriba:

   ```
   node --version
   ```

   Debe mostrar algo como `v20.x.x` o más nuevo.

2. **El código de este proyecto** en una carpeta de su computador (ya lo tiene, si está leyendo
   este archivo dentro de esa carpeta).

3. **Una base de datos PostgreSQL de verdad**, para el uso real. Puede saltarse este punto en un
   primer momento (ver la sección 1 de abajo, "qué funciona sin ella"), pero para trabajar de
   verdad la va a necesitar. La forma más simple, sin instalar nada más en su máquina, es crear una
   base gratuita en la nube:

   - Vaya a <https://neon.tech> (o a <https://supabase.com>), cree una cuenta gratuita y un
     proyecto nuevo.
   - El panel le da una **cadena de conexión** parecida a
     `postgres://usuario:contraseña@servidor/nombre_base`. Cópiela; la va a necesitar en el
     paso 2.

   Si prefiere instalar PostgreSQL en su propia máquina en vez de usar un servicio gratuito en la
   nube, también funciona: cualquier PostgreSQL 14 o más nuevo sirve, y la cadena de conexión tiene
   la misma forma.

---

## 1. Qué funciona sin esa base de datos externa, y qué no

Este proyecto trae una base de datos "de bolsillo" llamada **PGlite**: un PostgreSQL real que corre
dentro del mismo programa, sin instalar nada aparte y sin servidor propio.

- **Las pruebas automáticas (`npm test`) siempre usan PGlite**, nunca su base de datos real, así
  la tenga configurada. Es a propósito: así las pruebas nunca tocan datos de verdad.
- **Cualquier otro comando (migrar, sembrar, arrancar, cargar datos de ejemplo, o levantar el
  servidor) usa PGlite automáticamente si usted no configuró `DATABASE_URL`.** Sirve para
  comprobar que un comando corre sin errores, **pero cada comando crea y destruye su PROPIA base
  de datos temporal**: si corre "migrar" y después "sembrar" sin `DATABASE_URL`, el segundo comando
  no ve nada de lo que hizo el primero, porque cada uno vivió y murió en su propia base de datos
  desechable, en su propio proceso. Sirve para "¿esto corre sin errores?", no para trabajar de
  verdad.

**Para todo lo demás de esta guía —tener una firma con datos que persisten entre un comando y el
siguiente, iniciar sesión, ver facturas en la bandeja— hace falta `DATABASE_URL` apuntando a una
base de datos real** (la de la nube gratuita del paso 3 de arriba, o una instalada localmente).
Una vez la tenga, todos los comandos de este documento comparten esa misma base, y lo que crea uno
lo ve el siguiente.

---

## 2. Instalación, paso a paso

Abra una terminal **en la carpeta del proyecto** (donde está este archivo) y ejecute, en orden:

### 2.1. Instalar las dependencias

```
npm install
```

Descarga todo lo que el proyecto necesita para correr. Tarda uno o dos minutos la primera vez.

### 2.2. Configurar sus variables

```
cp .env.example .env
```

(En Windows sin `cp`, simplemente copie el archivo `.env.example` con el explorador de archivos y
renombre la copia a `.env`.)

Abra el archivo `.env` recién creado con cualquier editor de texto (el Bloc de notas sirve) y
rellene, como mínimo:

- `DATABASE_URL`: pegue ahí la cadena de conexión del paso 0.3.

El archivo `.env.example` explica, variable por variable, para qué sirve cada una, si es
obligatoria y qué pasa si la deja vacía. Las demás (`APP_ENCRYPTION_KEY`, las de `LLM_...`) puede
dejarlas vacías por ahora: el sistema funciona sin ellas, solo con menos funciones activas (el
segundo factor de autenticación y las sugerencias de IA, respectivamente).

### 2.3. Crear las tablas de la base de datos

```
npm run migrate
```

Debe terminar con una línea como `Listo: NN migración(es) aplicada(s)`. Si en vez de eso ve un
error de conexión, revise que `DATABASE_URL` en su `.env` esté bien copiada.

### 2.4. Cargar los datos normativos (UVT, tarifas, municipios, catálogo contable...)

```
npm run seed
```

Estos son los datos que el motor de causación necesita para calcular retenciones correctamente:
tarifas, UVT, PUC, municipios con ICA, etc. Sin este paso el sistema no tiene con qué calcular
nada.

### 2.5. Crear su firma, su primera empresa-cliente y su usuario

```
npm run arranque -- --firma-nit=901234567 --firma="Mi Firma Contable SAS" --empresa-nit=800111222 --empresa="Comercializadora del Norte SAS" --admin-email=su-correo@ejemplo.com --admin-nombre="Su Nombre"
```

Cambie los valores de ejemplo (NIT, nombres, correo) por los suyos. Este comando le va a mostrar
**una contraseña generada, una sola vez**: cópiela de inmediato, no queda guardada en ninguna
parte (la base solo guarda una derivación irreversible de ella). El detalle completo de este
comando, sus opciones y las preguntas frecuentes están en
[docs/arranque-primer-uso.md](docs/arranque-primer-uso.md).

### 2.6. (Opcional, recomendado para probar) Cargar datos de ejemplo

```
npm run datos-ejemplo
```

Crea terceros y facturas de **ejemplo** (inventados, para que haya algo con qué probar el motor de
causación sin escribir SQL a mano) sobre la empresa que acaba de crear. No son datos normativos:
no lo corra sobre una instalación en producción con datos reales, a menos que quiera mezclar
datos de prueba con los suyos a propósito.

### 2.7. Levantar el servidor

```
npm run dev
```

Abra en su navegador <http://localhost:3000/entrar>, inicie sesión con el correo y la contraseña
del paso 2.5, elija la empresa, y ya puede ver la bandeja de causación, los parámetros, los
terceros y los reportes.

Para dejarlo corriendo de forma más parecida a producción (más lento de arrancar la primera vez,
pero es el mismo modo que corre en el servidor real), en vez de `npm run dev` use:

```
npm run build
npm run start
```

---

## 3. Preguntas frecuentes

**Corrí `npm run migrate` y `npm run seed` y `npm run dev` no encuentra nada.**
Revise que los tres tengan la MISMA `DATABASE_URL` en su `.env`. Si alguno se corrió sin ella (o
con una distinta), cada uno trabajó sobre una base diferente.

**¿Es seguro correr `npm run migrate` o `npm run arranque` dos veces?**
Sí. Lo que ya existe se detecta y no se duplica ni se sobrescribe. `npm run arranque` en particular
nunca le cambia la contraseña a un usuario que ya existe, salvo que usted lo pida a propósito con
`--rotar-password` (ver [docs/arranque-primer-uso.md](docs/arranque-primer-uso.md)).

**¿Cómo entro si perdí la contraseña?**
Vuelva a correr el mismo comando de `npm run arranque` del paso 2.5, añadiendo `--rotar-password`
al final. Le genera una contraseña nueva y cierra las sesiones abiertas de ese usuario.

**¿Necesito configurar la IA (`LLM_...`) para que el sistema funcione?**
No. Sin esas variables, el sistema clasifica lo que ya conoce (proveedores repetidos) y manda todo
lo demás a revisión humana sin sugerencia. Nada se detiene ni se rompe por no tener IA configurada
— es una decisión de diseño del proyecto, no una limitación de esta guía.

**¿Cuánto cuesta tener esto funcionando de verdad, no solo en mi máquina?**
Ver [docs/reportes/entorno-y-despliegue-a15.md](docs/reportes/entorno-y-despliegue-a15.md) para el
detalle de costos y la configuración de despliegue en Render.

**Corrí las pruebas (`npm test`) y usan mi base de datos real por accidente.**
No debería pasar: las pruebas están hechas para ignorar `DATABASE_URL` y siempre correr contra una
base temporal en memoria (PGlite), nunca contra la suya. Si ve lo contrario, es un error del
proyecto, no algo que usted configuró mal.

---

## 4. Para quien sí va a tocar el código

- Pruebas: `npm test` (o `npm run test:watch` para dejarlas corriendo mientras edita).
- Chequeo de tipos: `npm run typecheck`.
- Compilación de producción: `npm run build`.
- Las 7 Reglas de Oro que ningún cambio puede violar están en la sección 2 de
  [MEGA_PROMPT_SOFTWARE_CONTABLE_CO.md](MEGA_PROMPT_SOFTWARE_CONTABLE_CO.md).
- El estado real del proyecto —qué está cerrado, qué falta, qué decisiones no se deben
  reabrir— vive en [ESTADO_PROYECTO.md](ESTADO_PROYECTO.md). Léalo antes de escribir una sola
  línea.

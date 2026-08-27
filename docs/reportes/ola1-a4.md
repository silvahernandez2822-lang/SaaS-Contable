# A4 — Ingest de correo y parser UBL 2.1 (Ola 1)

**Estado: entregado.** `npm test` → **311 pruebas en verde**, 22 `todo`, **2 fallos, ninguno mío**
(el canario obsoleto del inventario de `src/` y el falso positivo de la Regla de Oro 2 sobre
constantes de escala/backoff de A3 y A6 — ambos ya adjudicados a A14 en la compuerta de Ola 1, ver
§8). Antes de mi entrega corriente pasaban 261; con mis 50 pruebas nuevas y sin romper ninguna de
las existentes quedan 311.

**No toqué `ESTADO_PROYECTO.md`. No hice commit.**

---

## 1. Qué se entrega

```
src/ingest/
  tipos.ts                  Contrato del dominio: DocumentoNormalizado, MotivoCuarentena, etc.
  hash.ts                   sha256 de los bytes exactos recibidos.
  procesar.ts                *** LA FRONTERA CON A6 ***  procesarAdjuntoXml(bytes) -> ...
  persistencia.ts           Capa de BD: resolver buzón, guardar documento, registrar correo.
  index.ts                  Superficie pública.
  ubl/
    xml.ts                  Navegación del árbol XML por nombre local, sin depender del prefijo.
    dinero.ts                Montos UBL (texto) -> centavos bigint. Nunca Number/parseFloat.
    desempaquetar.ts          *** EL CASO CRÍTICO ***  AttachedDocument -> XML interno (o base64).
    cufe.ts                  Extracción y validación de FORMA del CUFE (SHA-384, 96 hex).
    validar.ts               Validación estructural contra lo exigible del anexo técnico 1.9.
    extraer.ts               Emisor, adquirente, líneas, impuestos, totales, referencias.
  correo/
    tipos.ts                 CorreoEntrante neutro + puerto ProveedorCorreoEntrante (adaptador).
    webhook.ts                Manejador PURO del payload del webhook (zod), sin red.
    spf-dkim.ts               Interpreta Authentication-Results. No resuelve DNS por sí mismo.
    limites.ts                Tamaño de correo/adjunto y tasa por buzón.

db/migrations/
  030_ingest_correo.sql              email_ingest_log + email_ingest_attachment
  031_ingest_archivado_frio.sql      espacio reservado en source_document (pedido de A15)
  032_ingest_resolver_buzon.sql      app.resolver_empresa_por_buzon (resolver antes de sesión)

tests/
  ingest/parser.test.ts       17 pruebas puras: los 5 tipos UBL, el caso base64, cuarentenas.
  ingest/correo.test.ts       19 pruebas puras: webhook, SPF/DKIM, límites, dinero.
  gates/ingest.test.ts        14 pruebas contra PGlite: dedup por CUFE en la BASE, el caso
                               crítico hasta source_document, resolución de buzón sin sesión,
                               registro de correo, guardia de alcance (AL001).
  fixtures/ubl/*.xml           11 XML construidos a mano (detalle en §5).

docs/ingest-correo.md          Las 9 limitaciones que el producto debe declarar + nota de
                                coordinación con A6 sobre sesiones de sistema.
```

---

## 2. La frontera con A6

```ts
procesarAdjuntoXml(bytes: Uint8Array, opciones?: { nombreArchivo?, tamanoMaximoBytes? })
  => { ok: true; documento: DocumentoNormalizado }
   | { ok: false; cuarentena: { motivo, detalle, erroresValidacion? } }
```

Es una función **pura**: nada de I/O, nada de red, nada de base de datos. Recibe los bytes de UN
adjunto y devuelve el documento normalizado o el motivo de cuarentena. A6 la invoca desde su cola
(`db/migrations/040_cola_documentos.sql`, ya en el repo) sin acoplarse a cómo llegó el correo. No
construí la cola ni el endpoint HTTP — son de A6, tal como se acordó.

`persistencia.ts` es la capa que SÍ toca la base de datos (`guardarDocumentoProcesado`,
`registrarCorreo`, `registrarAdjunto`, `resolverEmpresaPorBuzon`, `contarCorreosRecientes`,
`leerXmlDocumento`). A6 no está obligado a usarla — su contrato es solo `procesarAdjuntoXml` — pero
puede reutilizarla si le sirve. Es lo que mis propias pruebas de compuerta usan para demostrar el
pipeline de punta a punta contra PGlite.

**Nota de coordinación importante para A6** (desarrollada en `docs/ingest-correo.md` §9): escribir
en `source_document`/`email_ingest_log` exige una **sesión real** por RLS (D-021), no solo conocer
el `tenant_id` resuelto. El worker que A6 conecte a `procesarAdjuntoXml` va a necesitar abrir una
sesión de sistema para el tenant resuelto antes de llamar a `guardarDocumentoProcesado` — esto es
territorio de A12 (emisión de sesión) + A6 (el proceso que la abre), no lo implementé porque
no me corresponde el transporte.

---

## 3. El caso crítico: Invoice embebido (a veces en base64) en AttachedDocument

`src/ingest/ubl/desempaquetar.ts` busca `cac:Attachment/cac:ExternalReference/cbc:Description`,
detecta si el contenido ya es XML (empieza por `<`) o si hay que decodificarlo de base64 primero
(y verifica que lo decodificado sea realmente XML, no basura que por su alfabeto "parecía" base64).
`procesar.ts` orquesta: desempaqueta antes de validar, y el `tipoDocumento` resultante es el
INTERNO (`Invoice`/`CreditNote`/`DebitNote`/`ApplicationResponse`), nunca `AttachedDocument`.

**Cómo se probó, en dos niveles:**

1. **Puro** (`tests/ingest/parser.test.ts`): dos fixtures dedicados,
   `attached-document-invoice-base64.xml` (el caso frecuente, según la sección 10.2) y
   `attached-document-invoice-plano.xml` (el mismo contenedor, sin base64). Se verifica que
   `veniaEnAttachedDocument = true`, que el CUFE extraído es el del Invoice INTERNO, que
   `xmlCrudo` es el XML desempaquetado (no contiene `<AttachedDocument`), y que `hashContenido`
   sigue siendo el hash del ARCHIVO COMPLETO recibido (el contenedor), no el del interno — para que
   la deduplicación por contenido sea sobre lo que realmente llegó por correo.
2. **Contra la base** (`tests/gates/ingest.test.ts`, describe "EL CASO CRÍTICO"): el mismo fixture
   base64 se procesa y se guarda con `guardarDocumentoProcesado`; se confirma en `source_document`
   que `tipo_documento = 'Invoice'` (no el contenedor), que el CUFE es el correcto, y que
   `extraction.datos_extraidos` guarda los montos (bigint) como texto. Es la compuerta de salida
   que el mega-prompt pide explícitamente para la Ola 1.

---

## 4. Deduplicación por CUFE — impuesta por la base, no por código (D-003)

La restricción ya existía: `source_document_cufe_uq UNIQUE (company_id, cufe)`, de A2 en
`008_documentos.sql`. Lo que A4 construyó es el camino que la usa correctamente:

- `guardarDocumentoProcesado` primero busca si el CUFE (o, a falta de CUFE, el `hash_contenido`)
  ya existe — es una optimización para no abortar la transacción del llamador en el camino feliz
  (reenvío exacto del mismo correo), **no el mecanismo de la garantía**.
- La prueba que sí demuestra la garantía (`tests/gates/ingest.test.ts`, "LA GARANTÍA REAL es el
  UNIQUE de la base...") se salta `guardarDocumentoProcesado` y hace un `INSERT` directo con el
  mismo CUFE: el motor lo rechaza con `23505`, verificado con `esperarErrorPg` (el mismo patrón que
  toda la compuerta de Ola 0 exige).
- Otra prueba confirma que reprocesar el mismo adjunto deja **una sola** fila con ese CUFE en
  `source_document` (`count(*) = 1`), no cero intentos de escritura duplicados silenciosamente
  ignorados: `guardarDocumentoProcesado` devuelve `{ resultado: 'duplicado', porQue: 'cufe' }` y el
  llamador (A6) decide qué hacer con eso (por ejemplo, marcar el adjunto de correo como duplicado
  en `email_ingest_attachment.resultado`, ya modelado).

---

## 5. Fixtures — CONSTRUIDOS, no capturas de producción

**Declaración explícita, como pide la tarea: ninguno de los XML de `tests/fixtures/ubl/` salió de
un ambiente real de la DIAN.** Se construyeron a mano, siguiendo la estructura de UBL 2.1 que
describe la sección 10.2 del mega-prompt y las convenciones que se pudieron verificar sin un XML
real a mano (namespaces `cac`/`cbc` estándar de OASIS, ubicación del CUFE en `cbc:UUID` con
`schemeName="CUFE-SHA384"`, tal como aparece en las muestras públicas de la DIAN que se conocen).
Cada archivo lleva un comentario `<!-- FIXTURE CONSTRUIDO... -->` que lo dice.

| Archivo | Qué cubre |
|---|---|
| `invoice-simple.xml` | Invoice directo, 1 línea, IVA 19%, caso feliz. |
| `credit-note-simple.xml` | Nota crédito con `BillingReference` a la factura anterior. |
| `attached-document-invoice-base64.xml` | **El caso crítico**: Invoice embebido en base64 dentro de `AttachedDocument`. |
| `attached-document-invoice-plano.xml` | El mismo caso, sin base64 (XML plano embebido). |
| `application-response.xml` | Evento/acuse, referencia la factura por CUFE. |
| `roto-xml-mal-formado.xml` | Etiqueta sin cerrar → `xml_mal_formado`. |
| `roto-sin-cufe.xml` | Estructura válida, sin `cbc:UUID` → `cufe_faltante`. |
| `roto-sin-lineas.xml` | Sin ninguna `InvoiceLine` → `estructura_ubl_invalida`. |
| `roto-attached-sin-contenido.xml` | `AttachedDocument` sin `cac:Attachment` → `contenedor_sin_documento_interno`. |
| `roto-attached-base64-invalido.xml` | Base64 que decodifica a texto plano, no XML → `base64_invalido`. |
| `roto-tipo-no-soportado.xml` | Raíz `Waybill` → `no_es_ubl_reconocible`. |

**Qué habría que re-verificar contra un XML real de la DIAN antes de producción, con todas las
letras:**

1. **El CUFE de los fixtures NO es criptográficamente auténtico.** Es un `sha384` de un texto de
   prueba (p. ej. `"factura-fixture-001"`), elegido solo para tener la FORMA correcta (96 hex). No
   se calculó con la fórmula real del anexo técnico (que combina campos de la factura con la clave
   técnica del emisor). `extraerCufe` no lo verifica criptográficamente — ver `docs/ingest-correo.md` §5.
2. **La ubicación exacta y el `schemeName` del CUFE.** Se asumió `cbc:UUID` directo, hijo de la
   raíz, con `schemeName="CUFE-SHA384"`, por ser lo que muestran las capturas públicas conocidas.
   Un proveedor tecnológico real podría anidarlo distinto o usar otro literal de esquema.
3. **`CustomizationID` y los códigos DIAN reales** (tipo de operación, tipo de documento, códigos
   de impuesto distintos de `01`=IVA). Los fixtures usan `01` para IVA porque es el más documentado
   públicamente; no se verificaron `04` (INC), `03` (ICA) ni los de retenciones contra el anexo.
4. **El bloque `DianExtensions`** (QR, proveedor tecnológico, rango de numeración autorizado) que
   los XML reales de la DIAN sí traen y que ningún fixture incluye — A4 no lo necesita para
   extraer lo que la sección 10.2 pide, pero si el negocio necesita mostrar esos datos en el futuro,
   `extraer.ts` no los lee todavía.
5. **El formato exacto de `AttachedDocument`** para el caso base64: se construyó siguiendo la
   descripción del mega-prompt ("a veces en base64, dentro de un AttachedDocument"), pero no se
   confirmó contra un ejemplo real si el proveedor tecnológico envuelve el base64 en más de un
   nivel, o si además firma el `AttachedDocument` con su propio `UBLExtensions` (que `desempaquetar.ts`
   ignora a propósito: solo mira `cac:Attachment/cac:ExternalReference/cbc:Description`).

Ningún hallazgo de estos cinco puntos invalida el mecanismo (desempaquetar → validar → extraer →
CUFE → dedup): son afinamientos de forma que solo un XML real puede confirmar, y `validar.ts` /
`extraer.ts` son los ÚNICOS puntos que habría que tocar si algo cambia — el resto del pipeline
(dedup, cuarentena, registro) no depende de la forma exacta del XML.

---

## 6. Validación estructural — límite declarado

`validarEstructuraUbl` NO es una validación XSD completa: no hay un XSD oficial del anexo técnico
1.9 en el repositorio y usar uno inventado sería peor que no validar (mismo criterio de la sección
17 sobre no inventar valores normativos). Verifica presencia y forma mínima: identificación, fecha
de emisión, emisor con NIT, adquirente con NIT, al menos una línea (para los tres documentos
causables), totales con `PayableAmount`. Documentado en `docs/ingest-correo.md` §4.

---

## 7. Decisiones de modelado (migraciones 030–032, dentro del rango reservado)

El esquema de negocio (`source_document`, `extraction`) NO se tocó, salvo la extensión aditiva y
reservada de `031` (ver más abajo). Se agregaron tres migraciones, cada una justificada por escrito
en su propio archivo:

- **`030_ingest_correo.sql`** — `email_ingest_log` (una fila por correo, `tenant_id`/`company_id`
  NULOS cuando el buzón no se reconoce, mismo patrón que `audit_log`: invisible por RLS a cualquier
  tenant, solo consultable por `asAdmin`) y `email_ingest_attachment` (una fila por adjunto, solo
  cuando el buzón SÍ se reconoció; alcance estricto tenant+company). Ambas append-only. La
  deduplicación real sigue siendo el `UNIQUE` de `source_document` — estas dos tablas son la traza
  del intento, no el mecanismo.
- **`031_ingest_archivado_frio.sql`** — a pedido de A15 (el XML crudo a 10 años satura el
  presupuesto de Postgres transaccional hacia el año 7–10): agrega a `source_document`
  `xml_almacenamiento` (default `'bd'`, único valor real hoy), `xml_archivo_url`,
  `xml_archivado_en`. **Reservado, no implementado**, mismo tratamiento que el espacio RADIAN de
  A2. `leerXmlDocumento` en `persistencia.ts` es el único punto que cambiará cuando exista un
  proveedor de almacenamiento frío real.
- **`032_ingest_resolver_buzon.sql`** — `app.resolver_empresa_por_buzon(text)`, `SECURITY DEFINER`
  de superficie mínima (solo `company_id`/`tenant_id` de una empresa activa con ese buzón exacto).
  Hizo falta porque `company` tiene RLS de tenant estricto (`012_rls.sql`): sin sesión no se vería
  ninguna fila, y resolver el buzón es EXACTAMENTE lo que pasa antes de que exista sesión. Mismo
  patrón ya auditado que `app.buscar_credencial` para el login (D-023). **Consecuencia en la
  compuerta de A14:** el inventario cerrado de funciones `SECURITY DEFINER` ejecutables por
  `app_user` (`tests/adversarial/evasion.test.ts`) tuvo que actualizarse para incluir esta función
  nueva, con el mismo razonamiento documentado en el propio archivo de prueba — no se debilitó el
  detector, se declaró la superficie nueva que audita.

No se creó ninguna tabla de contadores para el límite de tasa: se calcula contando filas recientes
de `email_ingest_log` (`contarCorreosRecientes`), para no mantener una segunda fuente de verdad.

---

## 8. Estado de la suite y lo que NO es mío

`npm test` → **311 pruebas en verde, 22 `todo`, 2 fallos**, ambos preexistentes y ya adjudicados por
A14 en la compuerta de la Ola 1 (mencionados en el checkpoint del corte de cupo):

1. El canario de inventario de `src/` (`tests/adversarial/casos-dorados.test.ts`) afirmaba que solo
   existían `auth` y `db` — correcto en la Ola 0, obsoleto ahora que existen `domain`, `ingest` y
   `services`.
2. La Regla de Oro 2 (`tests/adversarial/valores-tributarios.test.ts`) marca falso positivo sobre
   `ESCALA_TARIFA`/`ESCALA_UVT` de A3 (factores de escala de punto fijo, no valores tributarios) y
   sobre `BACKOFF_TOPE_SEGUNDOS` de A6 (un tope de reintento de cola, no un valor tributario).

No toqué ninguna de las dos, tal como se me indicó. Sí actualicé una tercera prueba que mi propio
trabajo hizo fallar legítimamente — el inventario cerrado de funciones `SECURITY DEFINER` (§7). No es
uno de los dos fallos adjudicados: es una consecuencia directa y esperada de agregar
`app.resolver_empresa_por_buzon`, exactamente el tipo de cambio que ese test está diseñado para
forzar a declarar, no a impedir.

Mis límites operativos (`TAMANO_MAXIMO_CORREO_BYTES`, `LIMITE_CORREOS_POR_VENTANA`, etc., en
`src/ingest/correo/limites.ts`) son constantes de código a propósito: no son valores tributarios
(Regla de Oro 2 no aplica — son parámetros de ingeniería del canal, no tarifas/bases/UVT), y el
detector de A14 los deja pasar (verificado: cero hallazgos nuevos de esa suite atribuibles a A4).

---

## 9. RADIAN — solo el espacio, sin tocar

No se implementó ningún evento RADIAN. `source_document.radian_*` (reservado por A2 en la Ola 0)
no se escribe desde `src/ingest/`. Documentado en `docs/ingest-correo.md` §6.

---

## 10. Limitación de producto documentada

`docs/ingest-correo.md` §1 declara, con las palabras del mega-prompt: no existe API pública de la
DIAN para descarga masiva sin autenticación del titular, el canal de correo no es exhaustivo al
100%, y el sistema debe ofrecer conciliación contra lo que el cliente descargue del portal DIAN
(vía `source_document.origen = 'portal_dian'`, ya prevista en el modelo de A2).

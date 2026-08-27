# Ingest de correo y parser UBL 2.1 — limitaciones que el producto debe declarar

Agente A4, Ola 1. Complementa `src/ingest/` y la sección 10 del mega-prompt.
No es un documento de cumplimiento legal (esos están en `docs/` con su propio
formato); es la lista de límites técnicos reales que el producto no debe
prometer que no tiene.

## 1. El canal de correo no es exhaustivo al 100%

No existe una API pública de la DIAN para que un tercero (este sistema)
descargue masivamente las facturas electrónicas recibidas por un contribuyente
sin la autenticación del propio titular. La vía principal (sección 10.1) es
que el adquirente reciba el XML por correo — porque el emisor está obligado a
enviárselo — y redirija o configure como destinatario el buzón dedicado
(`empresa-{identificador}@inbox.dominio.com`).

**Consecuencia real:** un correo que se pierde, un proveedor que nunca
configuró el reenvío, o un filtro de spam corporativo entre el proveedor y
este sistema, dejan una factura real sin ingestar y sin que este sistema se
entere. El producto **debe ofrecer conciliación** contra lo que el cliente
mismo descargue del portal de la DIAN (carga manual de XML/ZIP, vía secundaria
ya prevista en el modelo de datos vía `source_document.origen`). Esta
limitación debe quedar dicha con todas las letras en el producto, no
descubierta por un cliente cuando le falte una factura.

## 2. SPF/DKIM: se confía en el veredicto del proveedor, no se recalcula

`src/ingest/correo/spf-dkim.ts` NO resuelve SPF ni DKIM por sí mismo. Verificar
SPF exige una consulta DNS TXT al dominio del sobre en el momento exacto de la
conexión SMTP; verificar DKIM exige la clave pública del dominio firmante y la
firma criptográfica original. Ninguna de las dos está disponible después de
que un proveedor de inbound email ya recibió el correo y lo entrega por
webhook. Este pipeline lee el veredicto que el MTA receptor ya calculó, en la
cabecera estándar `Authentication-Results` (RFC 8601). Si esa cabecera falta o
no trae el mecanismo, el resultado es `no_verificado` — nunca se asume `pass`
por defecto.

**Consecuencia:** la calidad de esta señal depende enteramente de que el
proveedor de inbound email contratado (todavía no contratado — ver sección 3)
publique esa cabecera de forma confiable.

## 3. El proveedor de inbound email real no está contratado

`src/ingest/correo/tipos.ts` define el puerto `ProveedorCorreoEntrante` y
`src/ingest/correo/webhook.ts` valida y normaliza el payload YA traducido a la
forma neutra `CorreoEntrante`. Ningún adaptador concreto (SendGrid Inbound
Parse, Mailgun Routes, SES+SNS, Postmark...) está implementado: no se
inventaron credenciales ni se contrató nada, por instrucción explícita.
Escribir el adaptador real y el endpoint HTTP que lo recibe es trabajo de A6
(el endpoint de ingest) más quien lo despliegue.

## 4. Validación estructural, no XSD completo

`src/ingest/ubl/validar.ts` verifica la presencia y forma mínima de los
elementos que la sección 10.2 exige extraer (identificación, emisor,
adquirente, al menos una línea, totales, CUFE). **No es una validación XSD
contra el anexo técnico UBL 2.1 v1.9 completo**: ese XSD oficial no está en el
repositorio, y usar un esquema inventado o desactualizado sería peor que no
validar (mismo criterio de la sección 17 sobre no inventar datos normativos).
Cuando haya un XSD real disponible, `validarEstructuraUbl` es el único punto
que hay que reforzar.

## 5. El CUFE se extrae, no se recalcula ni se verifica criptográficamente

`src/ingest/ubl/cufe.ts` lee `cbc:UUID` (el lugar donde las muestras públicas
de la DIAN lo ubican) y valida que tenga la FORMA de un SHA-384 (96 caracteres
hexadecimales). No reproduce la fórmula del anexo técnico para comprobar que
el CUFE es matemáticamente correcto para ese contenido — eso exigiría la clave
técnica del emisor, que este sistema no posee ni debe poseer. La
deduplicación (sección 10.3) es por el VALOR del CUFE, no por su validez
criptográfica.

## 6. RADIAN — espacio reservado, no implementado

`source_document` ya reserva las columnas `radian_*` (migración
`008_documentos.sql`, A2, Ola 0). A4 no las toca ni las escribe. Generar
eventos RADIAN (acuse de recibo, recibo del bien o servicio, aceptación
expresa o tácita a 3 días hábiles) exige habilitación DIAN o un proveedor
tecnológico, y está fuera de alcance de esta ola.

## 7. Archivado frío del XML — espacio reservado, no implementado

`031_ingest_archivado_frio.sql` agrega `xml_almacenamiento` / `xml_archivo_url`
/ `xml_archivado_en` a `source_document`, a pedido de A15 (el XML crudo
conservado 10 años, art. 28 Ley 962/2005, satura el presupuesto de Postgres
transaccional hacia el año 7–10). En la Ola 1 **el 100% de las filas quedan
con `xml_almacenamiento = 'bd'`**: no hay proveedor de almacenamiento frío
contratado ni SDK instalado. `src/ingest/persistencia.ts` expone
`leerXmlDocumento(fila, adaptador?)`, que hoy solo lee `xml_crudo` — el punto
único que habrá que tocar cuando el archivado se implemente de verdad.

## 8. Resolución del buzón antes de que exista sesión

`company` tiene RLS de tenant estricto (`012_rls.sql`): sus filas solo son
visibles para una sesión ya vinculada a ese tenant. Resolver a qué empresa
pertenece un buzón de correo entrante es, por definición, anterior a saber el
tenant. `032_ingest_resolver_buzon.sql` agrega `app.resolver_empresa_por_buzon`
(`SECURITY DEFINER`, superficie mínima: solo devuelve `(company_id,
tenant_id)` de una empresa activa con ese buzón exacto), mismo patrón ya
auditado que `app.buscar_credencial` para el login (D-023).

**ACTUALIZACIÓN — V-1 cerrada (A12, migración 100).** Esa función **ya no es
ejecutable por la aplicación**: se le retiró el `EXECUTE` a `app_user` (y no lo
tiene `app_auth`). El motivo: el buzón **es** el parámetro que identifica al
tenant, así que con aquel `GRANT` una sesión de la firma B, preguntando por el
buzón de una empresa de la firma A, obtenía el `tenant_id`/`company_id` de A.
Nunca hubo datos legibles con esos identificadores (la RLS aguantó), pero era un
oráculo innecesario. La función se conserva, sin `GRANT` para ningún rol de
aplicación, ejecutable solo por el dueño del esquema (migraciones y tareas de
plataforma).

El camino vivo de correo **ya no necesita resolver el buzón antes de la
sesión**: `src/integraciones/ingest-correo.ts` (A13, migración 090) autentica
primero al tenant con un token de integración, abre sesión real por
`app.abrir_sesion` y solo entonces resuelve la empresa con un `SELECT` corriente
sobre `company`, bajo su RLS. La seguridad del canal dejó de depender de que un
buzón sea secreto.

## 9. Cómo se escribe de verdad en la base — nota de coordinación para A6

Toda escritura en `source_document`, `extraction`, `email_ingest_log` (para un
buzón reconocido) y `email_ingest_attachment` pasa por RLS de tenant/empresa
estricta, y esa RLS exige una **sesión real** (`app.abrir_sesion`, D-021): no
basta con conocer el `tenant_id`/`company_id` resueltos por
`app.resolver_empresa_por_buzon`. El worker/cola que A6 construye para conectar
`procesarAdjuntoXml` necesita abrir una sesión de sistema para el tenant
resuelto (un usuario técnico, análogo al `usuarioTecnico` que ya usa el
harness de pruebas) antes de invocar `guardarDocumentoProcesado`,
`registrarCorreo` o `registrarAdjunto`. Emitir esa sesión de sistema es
territorio de A12 (sesiones) + A6 (el proceso que la abre); A4 no lo
implementa porque no le corresponde el transporte ni la cola.

Para un correo dirigido a un buzón **no reconocido**, no hay tenant que
autenticar: ese único `INSERT` en `email_ingest_log` (`tenant_id`/`company_id`
NULL) requiere una conexión administrativa/de sistema — el mismo nivel de
privilegio que ya usan las migraciones y los seeds (D-015) — porque ningún
`app_user` con sesión (o sin ella) puede satisfacer el `WITH CHECK` de esa
política para una fila que no pertenece a ningún tenant. Las pruebas de A4
(`tests/gates/ingest.test.ts`) usan `asAdmin` para ese caso exacto.

## 10. Fixtures de prueba — advertencia explícita

Todos los XML de `tests/fixtures/ubl/` son **construidos a mano por A4**, no
capturas de producción ni de un ambiente de pruebas de la DIAN. El detalle de
qué se verificó y qué falta por confirmar contra un XML real está en
`docs/reportes/ola1-a4.md`.

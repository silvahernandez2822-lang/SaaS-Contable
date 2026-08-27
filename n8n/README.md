# Workflows de n8n (A13, Ola 2)

No hay instancia de n8n contratada, y esta entrega no contrata ninguna (instrucción explícita).
Estos `.workflow.json` son definiciones **versionadas y exportables**, tal como las produciría
`Download` en la UI de n8n o `n8n export:workflow`, para importarlas cuando exista una instancia
real. Ninguna prueba de este repositorio hace una llamada de red: `tests/integraciones/frontera.test.ts`
lee estos JSON como archivos de texto y verifica su forma (qué tipos de nodo traen, que no calculan
nada tributario), nunca los ejecuta.

## Cómo se importan

En la UI de n8n: **Workflows → Import from File**, uno por uno. Por CLI: `n8n import:workflow --input=<archivo>`.

## Frontera (sección 13.2), aplicada aquí

Ningún nodo de estos workflows calcula una retención, arma un asiento ni resuelve una regla
tributaria. Los únicos nodos "de lógica" son:

- `n8n-nodes-base.code` en `ingest-correo.workflow.json`, que solo **reordena campos** (el payload
  crudo del proveedor de correo → la forma neutra `CorreoEntrante` de `src/ingest/correo/tipos.ts`).
  Es transporte, no negocio — comparable a un adaptador de formato, no a una regla de dominio.
- `n8n-nodes-base.if`, que solo mira si una lista que la aplicación ya calculó viene vacía o no
  (`facturas.length`, `buzones.length`, `vencimientos.length`).

Todo lo demás — si una factura está pendiente, si un buzón está fallando, si un vencimiento está
cerca — lo decide la aplicación (`src/integraciones/notificaciones.ts`) con un `SELECT`. n8n nunca
recibe datos tributarios crudos para procesarlos: recibe un conteo y un texto ya armado.

## Configuración manual obligatoria al desplegar (ninguna se automatiza aquí)

1. **Proveedor de inbound email real.** Sección 10.1/`docs/ingest-correo.md`: no hay adaptador
   contratado (SendGrid Inbound Parse, Mailgun Routes, SES+SNS, Postmark...). El nodo
   `Webhook - proveedor de correo` de `ingest-correo.workflow.json` expone una URL que hay que
   registrar como destino en el proveedor que se contrate, y el nodo `Normalizar a CorreoEntrante`
   hay que reescribirlo para el payload real de ese proveedor (hoy es un placeholder ilustrativo).
2. **Credential `appIntegrationTokenCorreo` (Header Auth), una por firma.** El valor es el token que
   devuelve `provisionarCanalIngestaCorreo` (`src/integraciones/aprovisionamiento.ts`) — se genera
   una vez desde la aplicación (acción de un administrador con `usuario.administrar`) y se copia a
   n8n. **Nunca se genera desde n8n ni queda en un archivo de este repositorio.**
3. **Variable de entorno `APP_BASE_URL`** con la URL pública de la aplicación desplegada.
4. **Credenciales de notificación** (SMTP/Slack/lo que la firma use) para los nodos `emailSend` —
   ninguna credencial de ejemplo se incluye.
5. **Horarios de los `scheduleTrigger`** — los cron de ejemplo (`08:00`, cada hora, `07:00`,
   `02:00`, mensual) son razonables por defecto, no un mandato; cada firma los ajusta.
6. **`respaldo-programado.workflow.json` y `reporte-periodico.workflow.json`** quedan como
   **esqueletos con un `noOp` marcado explícitamente "pendiente"**: el mecanismo real de respaldo es
   de A15 (snapshot del Postgres gestionado) y el de reportes es de A9/A10/A11 — ninguno de los dos
   existía todavía en el momento de esta entrega. No se inventó un endpoint para rellenar el hueco.
7. **Multi-empresa.** `GET /api/integraciones/empresas` devuelve las empresas activas de la firma del
   token; los tres workflows de notificación iteran esa lista (`splitOut`) y llaman una vez por
   empresa a `/api/integraciones/notificaciones/*` — mismo patrón que `app/lib/bandeja.ts` de A7
   (una sesión real por empresa, D-021/D-022), nunca una sola llamada que cruce firmas.

## Reintentos (sección 13.1)

El reintento del **ingest** es responsabilidad de n8n, tal como pide la sección 13.1: el nodo HTTP
Request de `ingest-correo.workflow.json` trae `retry.retryOnFail` (5 intentos, 30s de espera). La
aplicación, del otro lado, es segura de reintentar: reenviar el mismo adjunto no duplica nada
(`source_document_cufe_uq`, idempotencia real en la base — ver el reporte). Un `4xx` (401, 422) es
una respuesta **definitiva** — el workflow no debería reintentarla sin que alguien la revise primero
(payload inválido, token revocado, buzón no reconocido no se arreglan reintentando).

# Datos de ejemplo para probar el sistema de punta a punta (A1)

Encargo acotado, posterior a la Ola 3 (comitea sobre `646c4b3`): dejar con qué
probar el producto como el primer cliente real, sin escribir SQL a mano y sin
mezclar ni un dato de demostración con los datos normativos.

## Resumen de lo que se agregó

- `db/demo/facturas/*.xml` — 3 facturas de ejemplo (variantes de los fixtures
  de A4, `tests/fixtures/ubl/`), **no** normativas.
- `src/bootstrap/datos-ejemplo.ts` — la lógica: crea terceros, atributos
  fiscales, actividad económica, dos conceptos de causación de ejemplo,
  memoria de clasificación y luego ingesta las tres facturas y vacía la cola.
- `src/bootstrap/datos-ejemplo-cli.ts` — el comando `npm run datos-ejemplo`.
- `package.json` — la línea de script nueva.

Nada de esto toca `db/seeds/` ni ningún archivo de otro agente. No se
modificó ningún fixture de `tests/fixtures/ubl/` (se **copiaron y adaptaron**
a `db/demo/facturas/`, ver más abajo la razón).

## 1. Terceros creados y sus atributos fiscales

Cinco terceros, con los cinco ejes deliberadamente distintos entre sí (tipo de
persona, declarante/no declarante, municipio, responsable de IVA, régimen).
Cada uno declara explícitamente las nueve banderas fiscales — nunca se dejó
ninguna en su valor por omisión, tal como exige `src/services/terceros.ts`
(`AtributoFiscalIncompletoError`) — con `vigente_desde = 2026-01-01` y
`norma_respaldo` marcada como dato de ejemplo (no un RUT real).

| Tercero | Documento | Tipo | Municipio | Declarante | Resp. IVA | Régimen | Otros |
|---|---|---|---|---|---|---|---|
| Consultores Andinos SAS | NIT 900123456 | Jurídica | Bogotá | Sí | Sí | ordinario | actividad CIIU 6201 en Bogotá |
| María Fernanda Ríos | CC 43219876 | Natural | Medellín | **No** | No | ordinario | actividad CIIU 6201 en Medellín |
| Comercializadora del Pacífico SAS | NIT 830111222 | Jurídica | Cali | Sí | Sí | ordinario | actividad CIIU 4711 en Cali |
| Autorretenedora Nacional SAS | NIT 901555444 | Jurídica | Bogotá | Sí | Sí | ordinario | gran contribuyente, autorretenedora de renta e ICA, agente de retención de renta/IVA/ICA — el extremo opuesto de María Ríos, sin factura, solo maestro |
| Carlos Andrés Muñoz | CC 80234567 | Natural | Bogotá | Sí | No | **simple** | sin factura, solo maestro |

Todos tienen dirección y `municipality_id` completos (Formato 1001 de
exógena no queda bloqueado por falta de dirección/código DANE). Los tres
primeros tienen `third_party_activity` registrada — Bogotá y Cali son,
además, el caso didáctico de "actividad registrada mientras la tarifa de ICA
por actividad todavía no está cargada" (ver sección 4).

## 2. Facturas de ejemplo y el asiento que produce cada una

Las tres son **variantes** de `tests/fixtures/ubl/invoice-simple.xml` (A4,
Ola 1): mismo NIT de emisor cuando convenía reutilizar exactamente el
escenario del caso dorado 1, fecha de emisión movida a agosto de 2026 (para
caer dentro de la vigencia del Decreto 572/2025, vigente desde el 1-jul-2026
según los seeds de A1) y un CUFE de relleno nuevo (SHA-384 de 96 hex sin
validez criptográfica, igual que el original — la advertencia de A4 sigue
literal en la cabecera de cada archivo). **No se tocó ni un fixture de
`tests/fixtures/ubl/`**: se copiaron a `db/demo/facturas/`, que es una
carpeta nueva y separada, precisamente para no arriesgar ninguna de las
pruebas que ya dependen de esos 11 archivos.

Verificado end-to-end contra PGlite (migración + seed + arranque + este
comando, con consulta directa a `retention_applied` y a las líneas del
asiento):

| Archivo | Tercero / municipio | Resultado |
|---|---|---|
| `01-bogota-consultores-andinos.xml` | Consultores Andinos SAS, Bogotá, PJ declarante | Base $1.000.000 + IVA 19% ($190.000). **Retefuente 4% = $40.000** + **ReteIVA 15% = $28.500**. Asiento balanceado (5 partidas, $1.190.000 débito = crédito), estado `pendiente_aprobacion` (borrador, sin publicar). Es literalmente el caso dorado 1 de la sección 12. |
| `02-medellin-maria-rios.xml` | María Fernanda Ríos, Medellín, PN **no** declarante | Base $1.000.000, sin IVA. **Retefuente 6% = $60.000** (el eje "tercero": mismo servicio, PN no declarante retiene más — caso dorado 2) + **ReteICA 2‰ = $2.000** (tarifa general de Medellín, Acuerdo 066/2017 — caso dorado 8). Asiento balanceado (4 partidas), `pendiente_aprobacion`. |
| `03-cali-comercializadora-pacifico.xml` | Comercializadora del Pacífico SAS, Cali, PJ declarante | Base $80.000 + IVA 19% ($15.200). **Retefuente NO se practica** (por debajo de la base mínima de 2 UVT = $104.748: el motivo queda escrito literal, citando el Decreto 572/2025) pero **ReteIVA sí, $2.280** (15% de $15.200 — ReteIVA no tiene base mínima). Muestra que los dos ejes son independientes. Asiento balanceado (4 partidas), `pendiente_aprobacion`. |

Los tres quedan en **borrador, pendientes de aprobación humana** — a
propósito: el comando no aprueba nada por el usuario. Se ven en `/bandeja`
después de iniciar sesión con el usuario que creó `npm run arranque`.

Las cuentas que usan los dos conceptos de causación de ejemplo
(`DEMO-SERV-GENERALES` y `DEMO-SERV-ICA-MUNICIPIO`) son las del PUC global
que A1 ya cargó en `db/seeds/tanda1/010_puc_minimo.sql` y
`db/seeds/tanda2/010_puc_operativo.sql` (5135 Servicios, 2408 IVA
descontable/por pagar, 2205 Proveedores nacionales, 2365/2367/2368 para las
tres retenciones) — **cero cuentas nuevas, cero tarifas escritas a mano**:
los dos conceptos solo apuntan por id a `tax_concept` (`servicios_generales`,
`reteiva_general`, `reteica_tarifa_general_municipio`) que A1 cargó en la
Ola 1.

## 3. El comando exacto de carga

```
npm run migrate
npm run seed
npm run arranque -- --firma-nit=... --firma="..." --empresa-nit=... --empresa="..." --admin-email=... --admin-nombre="..."
npm run datos-ejemplo
```

`npm run datos-ejemplo` no pide argumentos si solo hay una firma y una
empresa en la base (el caso normal recién arrancado): los detecta solo. Si
hay más de una empresa, pide `--empresa-nit=` (y opcionalmente
`--firma-nit=`) y lista las candidatas en el error. Imprime qué creó y qué ya
existía, y termina mostrando el estado de cada factura de ejemplo.

**Seguro de correr dos veces.** Cada paso comprueba antes de escribir:
terceros por `(tipo_documento, numero_documento)`, atributos fiscales por
"¿ya tiene una vigencia abierta?", actividad por la terna
tercero×municipio×CIIU, el concepto de causación por código, la memoria de
clasificación con el mismo `ON CONFLICT` que ya usa `registrarDecisionHumana`
(A5), y las facturas por el mecanismo de deduplicación por hash/CUFE que ya
tiene `recibirDocumento` (A6). Verificado con dos corridas seguidas contra la
misma base: la segunda no duplica nada y reporta "ya existía" en cada paso.

## 4. Separación entre datos de ejemplo y datos normativos

- **Carpeta propia:** `db/demo/facturas/`, nunca `db/seeds/`. El cargador de
  seeds (`src/db/seed.ts`, `DEFAULT_SEEDS_DIR`) recorre únicamente
  `db/seeds/`; no ve ni puede ver `db/demo/` por construcción.
- **Comando propio:** `npm run datos-ejemplo`, nunca `npm run seed`. Correr
  `npm run seed` en una instalación real jamás carga un tercero ni una
  factura de mentira.
- **Marcado explícito en cada archivo:** todas las normas de respaldo de los
  atributos fiscales de ejemplo dicen literalmente *"Dato de EJEMPLO, no un
  RUT real"*; los tres XML llevan el comentario *"DATO DE EJEMPLO — NO ES UNA
  CAPTURA DE PRODUCCIÓN"* igual que los fixtures originales de A4.
- **Guarda de seguridad en el código, no solo en la documentación:** ver el
  hallazgo de la sección 5 — el comando se niega a tocar los atributos
  `es_agente_retencion_iva`/`es_agente_retencion_ica` de una empresa que ya
  tiene terceros propios, salvo que se le pida explícitamente con
  `--forzar-agente-retencion`. No hay ningún camino por el que este comando
  pueda alterar en silencio una empresa que ya está en uso real.

## 5. Hallazgo que dejo explícito para los demás agentes

`npm run arranque` crea la `company` con los valores por defecto del
esquema (`db/migrations/002_organizacion.sql`):
`es_agente_retencion_renta = true`, pero **`es_agente_retencion_iva = false`
y `es_agente_retencion_ica = false`**. El motor (`src/domain/motor.ts`,
`resolverReteiva`/`resolverReteica`) se niega a practicar esas dos
retenciones si la empresa no tiene la bandera correspondiente en `true`, sin
importar qué declare el tercero — correcto conceptualmente (es la empresa,
no el proveedor, quien decide si actúa como agente), pero significa que
**una empresa recién arrancada solo puede practicar retefuente** hasta que
alguien encienda esas dos banderas desde la pantalla de empresa (o, como
hace este comando, con una guarda de seguridad explícita). No lo cambié en
`arranque.ts` — no era parte de este encargo y no quise reabrir un archivo
cerrado de otro agente sin que se me pidiera — pero lo dejo anotado aquí y
en la cabecera de `datos-ejemplo.ts` para que quede visible.

## 6. Pendientes de verificación / decisiones que no tomé

- Las tarifas de ReteICA por actividad de **Bogotá** y **Cali** siguen sin
  cargar (hallazgo ya documentado por A1 en la Ola 1, sección
  `090_municipio_ica_reglas.sql`). Por eso el concepto de causación de las
  facturas de Bogotá y Cali **no** activa ReteICA a propósito: encenderlo
  solo demostraría un bloqueo (`sin_regla_vigente`), no un cálculo. Los dos
  terceros de esas ciudades sí quedan con su actividad económica registrada
  en `third_party_activity`, para cuando esa tabla exista.
- No toqué `arranque.ts` para corregir el hallazgo de la sección 5: lo dejo
  para que el agente dueño de ese archivo decida si el valor por defecto de
  una empresa recién creada debe ser distinto, o si la pantalla de empresa
  debe pedirlo en el primer uso.
- No agregué el escenario de nota crédito / reversa (A4 también dejó
  `credit-note-simple.xml`): el encargo pedía 2–3 casos con asientos
  distintos y ya están cubiertos; una reversa de verdad exige además aprobar
  el asiento original primero, que es una decisión humana que preferí no
  simular por el usuario.

## 7. Resultado literal de las tres compuertas

```
npm test         → Test Files 45 passed (45) · Tests 902 passed (902)
npm run typecheck → sin salida (limpio)
npx next build    → "Compiled successfully" + "Finished TypeScript" + 19 rutas listadas, exit 0
```

Las 902 pruebas son las mismas de antes de este encargo (no se agregó ni se
quitó ninguna prueba): el criterio de cierre pedía verificar que seguían en
verde después de este trabajo, no ampliar la suite.

## Archivos relevantes

- `C:\Users\silva\Desktop\kimi\db\demo\facturas\01-bogota-consultores-andinos.xml`
- `C:\Users\silva\Desktop\kimi\db\demo\facturas\02-medellin-maria-rios.xml`
- `C:\Users\silva\Desktop\kimi\db\demo\facturas\03-cali-comercializadora-pacifico.xml`
- `C:\Users\silva\Desktop\kimi\src\bootstrap\datos-ejemplo.ts`
- `C:\Users\silva\Desktop\kimi\src\bootstrap\datos-ejemplo-cli.ts`
- `C:\Users\silva\Desktop\kimi\package.json` (script `datos-ejemplo`)

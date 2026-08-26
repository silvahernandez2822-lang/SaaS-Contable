# MEGA-PROMPT — Construcción de SaaS Contable Colombiano Multi-Tenant
## Sistema de agentes paralelos con olas, compuertas y criterios de aceptación

---

# 0. INSTRUCCIÓN AL ORQUESTADOR

Eres el orquestador de un equipo de agentes especializados que va a construir un producto SaaS de contabilidad para el mercado colombiano. Este documento es la especificación completa. Antes de despachar cualquier agente:

1. Lee el documento entero. No empieces a ejecutar en la sección 3.
2. Verifica que entiendes las **7 Reglas de Oro** (sección 2). Son inviolables y aplican a todos los agentes.
3. Despacha los agentes según el plan de olas (sección 4). Respeta las compuertas: una ola no arranca hasta que la anterior pase sus criterios de aceptación.
4. El Agente A14 (QA Adversarial) corre de forma **continua y transversal**, no en una ola. Puede bloquear cualquier entregable.
5. Al final de cada ola, produce un reporte de estado: qué se construyó, qué pasó las pruebas, qué falta, qué decisiones se tomaron y por qué.

**No pidas confirmación entre pasos.** Si encuentras un conflicto de especificación, resuélvelo con el criterio que mejor sirva a las Reglas de Oro y documenta la decisión. Si encuentras un error o vulnerabilidad, corrígelo en el mismo paso; no lo reportes para que otro lo arregle.

---

# 1. CONTEXTO DEL PRODUCTO

## 1.1 Qué se está construyendo

Un software contable web, SaaS, multi-tenant, para el mercado colombiano. El corazón del producto es un **motor de causación automática de facturas de compra**: entra el XML de una factura electrónica DIAN, sale un asiento contable con las retenciones correctamente calculadas, trazadas y listas para aprobación humana.

## 1.2 Cliente objetivo

**Primario:** firmas contables y de outsourcing contable que llevan entre 30 y 60 PYMEs. Su dolor es la manualidad: hoy necesitan 5-10 personas para descargar, digitar, clasificar, validar y revisar facturas. La propuesta de valor es que puedan operar con 2-3 personas que solo revisen y aprueben.

**Secundario:** medianas empresas con departamento contable propio.

Consecuencia arquitectónica: **el sistema es multi-empresa desde el día uno**. La jerarquía es `tenant` (la firma) → `company` (cada empresa-cliente de la firma) → datos contables. La firma necesita una bandeja unificada donde vea facturas pendientes de todas sus empresas y pueda aprobar en lote.

## 1.3 Alcance regulatorio

- **NO emite factura electrónica ante la DIAN.** Solo recibe y procesa documentos electrónicos. Esto evita el proceso de habilitación como facturador electrónico o proveedor tecnológico. Un software que solo recibe XML y lo procesa contablemente no requiere habilitación DIAN.
- Si en el futuro se necesita emisión, será vía integración API con un proveedor tecnológico ya autorizado (white-label), nunca habilitación propia.
- Marco contable objetivo: **NIIF para PYMES (Grupo 2)**, Decreto 2420 de 2015 Anexo 2 y sus modificatorios.
- Catálogo de cuentas operativo: **PUC Decreto 2650 de 1993** con mapeo a clasificación NIIF.

## 1.4 Restricciones duras

| Restricción | Valor |
|---|---|
| Equipo | 1 desarrollador, 8 horas/día |
| Presupuesto de infraestructura | USD 20/mes inicial, escalable a USD 50/mes |
| Moneda | COP únicamente en fase 1 (diseñar para multimoneda, no implementar) |
| Idioma de interfaz | Español (Colombia) |
| Costo de IA | Debe mantenerse marginal mediante caché agresivo (ver sección 8) |

---

# 2. LAS 7 REGLAS DE ORO

Estas reglas aplican a todos los agentes, en todas las olas, sin excepción. Cualquier entregable que las viole se rechaza y se rehace.

### REGLA 1 — El ledger es inmutable y append-only
Los asientos contables publicados (`posted`) **nunca** se modifican ni se borran. Toda corrección se hace mediante un asiento de reversa que referencia al original. No existe `UPDATE` ni `DELETE` sobre `journal_entry` ni `journal_line` una vez publicados. Las restricciones de integridad (todo asiento balancea a cero) se imponen a nivel de base de datos, no solo de aplicación.

### REGLA 2 — Cero valores tributarios en el código
Ninguna tarifa, base mínima, valor de UVT, salario mínimo, porcentaje, tope o calendario puede estar escrito en el código fuente. Todo vive en tablas paramétricas editables desde la interfaz. Si un agente escribe `const RETEFUENTE_SERVICIOS = 0.04`, ese código se rechaza. La única constante permitida en código es la lógica de resolución (cómo se busca la regla), nunca el valor de la regla.

### REGLA 3 — Toda regla está versionada por vigencia
Cada tarifa, base y parámetro tiene `vigente_desde` y `vigente_hasta`. El motor resuelve **siempre por la fecha del hecho económico** (fecha de la factura), nunca por la fecha de procesamiento. Editar un parámetro **inserta una vigencia nueva**; jamás hace UPDATE sobre la vigencia anterior. Recalcular una factura de enero en julio debe dar el mismo resultado que dio en enero.

*Justificación real:* el Decreto 572 de 2025 fue suspendido provisionalmente por el Consejo de Estado el 7 de mayo de 2026, la suspensión fue revocada por auto del 2 de junio de 2026 (expediente 30229), y quedó con efectos operativos desde el 1 de julio de 2026. El proceso de nulidad de fondo sigue abierto. El sistema debe sobrevivir a este tipo de vaivenes sin migraciones de datos ni redeploys.

### REGLA 4 — La IA nunca calcula, solo propone
El motor de reglas determinista es la única fuente de verdad para cualquier cálculo tributario o contable. El LLM se usa exclusivamente para: (a) extraer y normalizar datos de documentos, y (b) **proponer** una clasificación (concepto, cuenta PUC) con un score de confianza. La propuesta pasa por el motor determinista, que calcula. Si el LLM sugiere un concepto, el sistema calcula la retención con las reglas paramétricas de ese concepto, no con lo que el LLM diga que es la tarifa.

### REGLA 5 — El dinero es entero
Todos los montos se almacenan como enteros en la unidad mínima (centavos) o como `DECIMAL` de escala fija. **Nunca `float` ni `double`.** Cada cálculo de retención persiste: base gravable, tarifa aplicada, identificador de la regla y su vigencia, y resultado redondeado. Las reglas de redondeo son también parámetros configurables, no lógica quemada.

### REGLA 6 — Trazabilidad total
Cada asiento contable debe poder responder, sin ambigüedad: de qué documento salió, qué regla tributaria se aplicó y con qué vigencia, qué propuso la IA y con qué score, quién aprobó, cuándo y desde dónde. Esta trazabilidad es simultáneamente el diferenciador de producto frente al revisor fiscal y la defensa legal ante un error de cálculo.

### REGLA 7 — Aislamiento entre tenants a nivel de motor de base de datos
El aislamiento multi-tenant se impone con Row Level Security de PostgreSQL, no con filtros en la aplicación. Si un desarrollador olvida un `WHERE tenant_id = ?`, la base de datos debe impedir la fuga igual. La política RLS opera sobre dos niveles: `tenant_id` (firma) y `company_id` (empresa-cliente).

---

# 3. ROSTER DE AGENTES

| ID | Agente | Responsabilidad |
|---|---|---|
| **A0** | Arquitecto / Orquestador | Diseño global, decisiones transversales, resolución de conflictos, reportes de ola |
| **A1** | Normativa y Catálogos Tributarios | Construye y puebla todas las tablas paramétricas con datos normativos reales |
| **A2** | Modelo de Datos y Ledger | Esquema PostgreSQL, ledger de doble partida inmutable, migraciones, RLS |
| **A3** | Motor de Reglas Tributarias | Resolución determinista de retenciones y cálculo |
| **A4** | Ingest y Parsing UBL 2.1 | Recepción de correo, extracción del XML, normalización, deduplicación |
| **A5** | IA de Clasificación y Caché | Extracción asistida, propuesta de concepto/cuenta, memoria de decisiones |
| **A6** | Backend / API de Dominio | Servicios de aplicación, casos de uso, transacciones, cola asíncrona |
| **A7** | Frontend Operativo | Bandeja de causación, aprobación en lote, UX contable |
| **A8** | Módulo de Parametrización (UI) | Interfaz de administración de todas las tablas paramétricas |
| **A9** | Reportería y Exportación Excel | Libros, auxiliares, balance de prueba, papeles de trabajo exportables |
| **A10** | Estados Financieros NIIF PYMES | ESF, ERI, ECP, EFE, notas, cierre de resultados |
| **A11** | Exógena y Formularios DIAN | Formatos 1001/1003/1005/1006/1007/1008/1009 y demás |
| **A12** | Seguridad, Multi-tenancy y Cumplimiento | RLS, autenticación, cifrado, habeas data, auditoría |
| **A13** | Integraciones Externas y n8n | Orquestación de ingest, webhooks, notificaciones, jobs |
| **A14** | QA Adversarial (Contador Simulado) | **Transversal.** Prueba con casos dorados, intenta romper el sistema |
| **A15** | DevOps y Control de Costos | Despliegue, observabilidad, presupuesto de infraestructura y tokens |

---

# 4. PLAN DE OLAS

## OLA 0 — Fundaciones *(secuencial, bloquea todo lo demás)*
**Agentes activos:** A0, A2, A12

Nada más arranca hasta que esta ola cierre. El esquema de datos y el aislamiento son el cimiento; construir encima de un esquema equivocado es la única forma garantizada de perder el proyecto.

**Entregables:**
- Esquema PostgreSQL completo con migraciones versionadas.
- Ledger de doble partida append-only con restricción de balance a nivel de BD.
- RLS activo en todas las tablas de datos, con doble nivel `tenant_id` / `company_id`.
- Autenticación, modelo de roles y permisos.
- Tabla de `audit_log` operativa.
- Estructura de vigencias temporal implementada y probada.

**Compuerta de salida (todos deben pasar):**
- Un intento de `UPDATE` sobre un `journal_entry` publicado falla a nivel de base de datos.
- Un asiento desbalanceado es rechazado por la BD, no por la aplicación.
- Una consulta sin filtro de tenant devuelve cero filas de otros tenants.
- Insertar una vigencia nueva no altera la anterior; una consulta con fecha pasada devuelve la regla que estaba vigente en esa fecha.

---

## OLA 1 — Núcleo del dominio *(paralelo: A1, A3, A4, A6)*

Cuatro agentes trabajan simultáneamente sobre el esquema ya congelado.

- **A1** construye y puebla todas las tablas paramétricas (sección 6) con los datos normativos de la sección 7.
- **A3** construye el motor de resolución y cálculo de retenciones (sección 9).
- **A4** construye el pipeline de ingest y el parser UBL 2.1 (sección 10).
- **A6** construye la capa de servicios, la cola asíncrona y el caso de uso de causación.

**Coordinación entre A1 y A3:** A3 no puede empezar a codificar hasta que A1 entregue el **contrato de las tablas paramétricas** (estructura, no datos). A1 entrega el contrato en las primeras horas y luego sigue poblando datos en paralelo.

**Compuerta de salida:**
- El motor resuelve correctamente los 20 casos dorados de la sección 12.
- El parser extrae correctamente un XML real DIAN, incluyendo el caso del `Invoice` embebido en base64 dentro del `AttachedDocument`.
- El motor no contiene ni un solo valor tributario en código (auditado por A14).
- Un cambio de tarifa en la tabla paramétrica cambia el resultado del cálculo sin tocar código ni redesplegar.

---

## OLA 2 — Inteligencia, parametrización e interfaz *(paralelo: A5, A7, A8, A13)*

- **A5** implementa la clasificación asistida y, crítico, el **sistema de conceptos y caché** (sección 8).
- **A7** construye la bandeja de causación multi-empresa y el flujo de aprobación en lote.
- **A8** construye el módulo de parametrización: la interfaz donde un contador —sin tocar código— edita UVT, salario mínimo, tarifas de retención, tablas de ICA por municipio, y todo lo demás.
- **A13** conecta n8n para ingest y notificaciones.

**Compuerta de salida:**
- Un contador puede cambiar el valor de la UVT desde la interfaz, y el sistema calcula con el valor nuevo para hechos posteriores a la vigencia, sin alterar los cálculos ya publicados.
- El segundo procesamiento de una factura del mismo proveedor con la misma descripción **no llama al LLM** (caché acierta).
- Un usuario de la firma ve en una sola pantalla las facturas pendientes de sus 30 empresas y puede aprobar 50 de un golpe.

---

## OLA 3 — Salidas contables y fiscales *(paralelo: A9, A10, A11)*

- **A9** libros, auxiliares, balance de prueba y exportación a Excel.
- **A10** estados financieros NIIF PYMES y cierre de resultados.
- **A11** exógena y formatos DIAN.

**Compuerta de salida:**
- Todo reporte se descarga en Excel con formato de papel de trabajo (sección 11).
- El balance de prueba cuadra contra la suma del ledger, comprobado por A14 con datos generados aleatoriamente.

---

## TRANSVERSAL — A14 y A15 *(activos desde la Ola 0 hasta el final)*

**A14 (QA Adversarial)** no espera turno. Su trabajo es intentar romper lo que los demás construyen, actuando como un contador hostil y como un atacante:
- Ejecutar los casos dorados en cada entrega.
- Buscar valores tributarios quemados en el código (grep sistemático).
- Intentar acceder a datos de otro tenant.
- Verificar que ningún asiento publicado sea mutable.
- Verificar reproducibilidad: procesar la misma factura 10 veces debe dar el mismo asiento 10 veces.
- Verificar que un cambio de parámetro no altere retroactivamente lo ya publicado.

**A15** monitorea costo de infraestructura y consumo de tokens contra el presupuesto (USD 20-50/mes). Si una decisión de diseño rompe el presupuesto, tiene autoridad para exigir el rediseño.

---

# 5. STACK TECNOLÓGICO

| Capa | Elección | Justificación |
|---|---|---|
| Base de datos | PostgreSQL gestionado (Supabase o Neon, tier económico) | RLS nativo, costo mínimo, sin operación |
| Multi-tenancy | Shared schema + Row Level Security | Una sola instancia; schema-per-tenant infla el catálogo y complica migraciones; DB-per-tenant no cabe en el presupuesto |
| Backend | TypeScript (Node) o Python, framework único | Un solo desarrollador: minimizar superficie |
| Frontend | Framework SSR moderno con el mismo lenguaje del backend | Evitar cambio de contexto |
| Hosting | Tier económico (Vercel / Render / Fly.io) | Cabe en USD 20/mes |
| Cola asíncrona | Cola respaldada en la misma PostgreSQL | Evita un servicio adicional pago |
| LLM | Modelo económico de la generación actual (clase Flash-Lite / mini / Haiku) | Costo por documento en el rango de milésimas de dólar |
| Ingest de correo | Servicio de inbound email parsing con webhook | Ver sección 10 |
| Orquestación auxiliar | n8n | Ver sección 13 |

**Restricción de A15:** el procesamiento de facturas **nunca** ocurre dentro del request HTTP. Siempre va a cola.

---

# 6. MÓDULO DE PARAMETRIZACIÓN — EL CORAZÓN DEL PRODUCTO

Esta es la sección más importante del documento. En Colombia la normatividad tributaria cambia constantemente: valor de la UVT cada año, decretos de retención que se suspenden y se revocan, acuerdos municipales de ICA, resoluciones anuales de exógena, salario mínimo. **Un sistema donde estos valores viven en el código muere en el primer cambio normativo.**

## 6.1 Principio de diseño

El usuario administrador —un contador, no un programador— entra a un módulo de parametrización, selecciona por ejemplo "Retención en la Fuente", ve una tabla con todos los conceptos, y puede editar tarifa, base mínima en UVT, cuenta contable asociada y fecha de vigencia. Guarda. El sistema calcula con el valor nuevo a partir de esa vigencia. No hay despliegue, no hay código, no hay ticket al desarrollador.

## 6.2 Comportamiento obligatorio de toda edición de parámetro

1. **Nunca UPDATE.** Editar una tarifa cierra la vigencia anterior (`vigente_hasta = fecha - 1`) e inserta una fila nueva con la vigencia nueva.
2. **Fecha de vigencia obligatoria.** El usuario debe indicar desde cuándo aplica. El sistema propone la fecha pero exige confirmación.
3. **Nunca retroactivo sobre lo publicado.** Cambiar una tarifa no recalcula asientos ya publicados. Si se necesita corregir, se hace por reversa explícita, con registro de quién y por qué.
4. **Auditoría.** Toda edición queda en `audit_log`: usuario, timestamp, valor anterior, valor nuevo, norma de respaldo (campo de texto donde el contador anota "Decreto 572 de 2025 art. X").
5. **Permiso restringido.** Solo un rol específico (administrador tributario) puede editar parámetros. Un auxiliar de causación no.
6. **Simulador previo.** Antes de guardar, el sistema muestra el impacto: "esta tarifa afecta N conceptos y M proveedores".

## 6.3 Catálogo completo de parámetros editables

Todos estos deben ser editables desde la interfaz, sin excepción:

**Valores base**
- Valor de la UVT por año
- Salario mínimo legal mensual vigente (SMMLV) por año
- Auxilio de transporte por año
- Reglas de redondeo (al peso, a la decena, etc.)

**Retención en la fuente a título de renta**
- Tabla completa de conceptos: código, nombre, tarifa, base mínima en UVT, cuenta PUC de la retención, si aplica a declarantes/no declarantes/ambos, vigencia
- Tabla progresiva de retención por salarios (art. 383 ET): rangos en UVT y tarifas marginales

**Autorretención de renta**
- Tabla de tarifas por código CIIU de actividad principal, con vigencia

**Retención de IVA (ReteIVA)**
- Tarifa general sobre el IVA
- Casos de retención al 100%
- Base mínima
- Matriz de agentes de retención por tipo de tercero

**Retención de ICA (ReteICA)**
- Catálogo de municipios (código DANE, nombre, departamento)
- Por municipio: tarifas por actividad económica en por mil, base mínima para servicios, base mínima para compras, periodicidad, norma de respaldo
- Reglas especiales por municipio (ej. municipios con tarifa general única vs. municipios que aplican la tarifa de la actividad)

**IVA**
- Tarifas vigentes (general, reducida, exenta)
- Clasificación de bienes/servicios: gravado, exento, excluido
- Criterios de periodicidad de declaración (bimestral / cuatrimestral) y sus topes en UVT

**Plan de cuentas**
- PUC completo, jerárquico (clase → grupo → cuenta → subcuenta → auxiliar), editable
- Mapeo de cada cuenta PUC a su clasificación NIIF para PYMES

**Terceros y actividades**
- Catálogo CIIU
- Tipos de tercero y sus atributos fiscales (declarante, autorretenedor, gran contribuyente, régimen SIMPLE, responsable de IVA, agente de retención)

**Calendarios**
- Calendario tributario por año: vencimientos por tipo de obligación y último dígito de NIT

**Exógena**
- Definición de formatos y sus columnas
- Topes que obligan a reportar
- Mapeo de cuentas PUC a conceptos de cada formato

**Conceptos de causación** (ver sección 8)
- Definición de conceptos y sus reglas asociadas

---

# 7. DATOS NORMATIVOS PARA POBLAR (Agente A1)

A1 debe poblar las tablas con estos valores. **Todos entran como datos, ninguno como código.** A1 debe además marcar cada dato con su norma de respaldo y advertir explícitamente cuáles requieren verificación antes de producción.

## 7.1 UVT

| Año | Valor | Norma |
|---|---|---|
| 2026 | $52.374 | Resolución DIAN 000238 del 15-dic-2025 |
| 2025 | $49.799 | Resolución DIAN 000193 de 2024 |
| 2024 | $47.065 | — |
| 2023 | $42.412 | — |

## 7.2 Retención en la fuente a título de renta

Base normativa: Decreto 572 de 2025, vigente desde el 1 de julio de 2026 (tras revocatoria de la suspensión, auto del 2-jun-2026, expediente 30229; ver DIAN Comunicado 070 del 8-may-2026). Referencias en el Decreto 1625 de 2016 (DUT) modificado por el 572.

| Concepto | Tarifa | Base UVT | Base $ (UVT 2026) |
|---|---|---|---|
| Compras generales a declarantes | 2,5% | ≥10 | ≥$523.740 |
| Compras generales a no declarantes | 3,5% | ≥10 | ≥$523.740 |
| Productos agrícolas/pecuarios sin proceso industrial | 1,5% | >70 | >$3.666.180 |
| Combustibles derivados del petróleo | 0,1% | — | — |
| Servicios generales (PJ / PN declarante) | 4% | ≥2 | ≥$104.748 |
| Servicios a PN no declarante | 6% | ≥2 | ≥$104.748 |
| Transporte de carga | 1% | ≥2 | ≥$104.748 |
| Transporte de pasajeros | 3,5% | ≥10 | ≥$523.740 |
| Servicios temporales de empleo (sobre AIU) | 1% | ≥2 | ≥$104.748 |
| Vigilancia y aseo (sobre AIU) | 2% | ≥2 | ≥$104.748 |
| Servicios integrales de salud | 2% | ≥2 | ≥$104.748 |
| Hoteles y restaurantes | 3,5% | ≥2 | ≥$104.748 |
| Honorarios y comisiones PJ | 11% | desde $0 | — |
| Honorarios y comisiones PN | 10% (11% si contratos >3.300 UVT/año) | desde $0 | — |
| Arrendamiento bienes muebles | 4% | desde $0 | — |
| Arrendamiento bienes inmuebles | 3,5% | ≥10 | ≥$523.740 |
| Rendimientos financieros generales | 7% | desde $0 | — |
| Rendimientos títulos renta fija (CDT/CDAT) | 4% | — | — |
| Salarios (art. 383 ET) | 19%–39% progresiva | >95 | >$4.975.530 |

Nota para A1: honorarios, comisiones, arrendamiento de muebles y rendimientos financieros no fueron modificados por el Decreto 572 y retienen desde el primer peso.

## 7.3 Autorretención especial de renta

Decreto 2201 de 2016, tarifas del Decreto 572 desde el 1-jul-2026. Aplica a sociedades nacionales exoneradas de aportes (art. 114-1 ET). Tarifa según CIIU de actividad principal (Resolución DIAN 139 de 2012 y modificatorias). Se declara mensualmente en formulario 350.

Valores de referencia (A1 debe verificar la tabla completa contra fuente DIAN antes de producción):
- Comercio al por menor no especializado (CIIU 4711): ~1,10%
- Arquitectura e ingeniería (7110): ~2,20%
- Extracción de hulla (0510): ~3,20%
- Servicios financieros (6411): ~4,40%

## 7.4 Retención de IVA

- Tarifa general: **15% del valor del IVA** (art. 437-1 ET). Techo legal 50%.
- **100% del IVA:** servicios gravados prestados por no residentes/no domiciliados y prestadores de servicios digitales desde el exterior (art. 437-2 ET numerales 3 y 8); bienes especiales (chatarra, tabaco, papel para reciclar).
- Agentes de retención (art. 437-2 ET): grandes contribuyentes, entidades estatales, quienes contraten con no residentes, emisoras de tarjetas de crédito/débito, responsables que compren al régimen SIMPLE.
- **Regla crítica:** se calcula sobre el IVA de la factura, no sobre el valor total. Dos responsables de IVA no se practican ReteIVA entre sí, salvo excepciones.

## 7.5 Retención de ICA por municipio

**Advertencia estructural para A1:** no existe repositorio nacional consolidado de tarifas de ICA. Cada municipio fija las suyas por acuerdo. La tabla debe diseñarse para crecer municipio por municipio y para que el usuario pueda agregar municipios nuevos desde la interfaz.

Regla general: la tarifa de ReteICA suele ser la misma tarifa de ICA de la actividad económica (CIIU) del proveedor —retención del 100% de la tarifa—, **salvo Medellín**, que aplica tarifa general del 2‰.

| Ciudad | Base servicios | Base compras | Tarifa | Norma |
|---|---|---|---|---|
| Bogotá | 4 UVT = $209.496 | 27 UVT = $1.414.098 | = tarifa ICA de la actividad (‰); profesiones liberales CIIU 74901 = 7,66‰ | Decreto 352 de 2002; ETD; calendario Res. SDH-000195 de 2025 |
| Medellín | 15 UVT = $785.610 | 15 UVT = $785.610 | general 2‰ | Acuerdo 066 de 2017 |
| Cali | 3 UVT = $157.122 | 15 UVT = $785.610 | = tarifa ICA de la actividad (100%) | Acuerdo 0321 de 2011 |
| Barranquilla | 4 UVT | 27 UVT | = tarifa ICA de la actividad (100%) | Decreto 924 de 2011, art. 352 |
| Bucaramanga | ~25 UVT *(verificar)* | ~50 UVT *(verificar)* | remite a la actividad | Acuerdo 044 de 2008 |
| Cartagena | *(verificar por actividad)* | *(verificar)* | profesiones/factor intelectual = 3‰ | Acuerdo 107 de 2022 / Decreto 0810 de 2023 |

**Modelo de datos obligatorio para ReteICA multimunicipio:** un proveedor puede tener actividad principal y actividades secundarias en varios municipios. La tabla `tercero_actividad` relaciona `tercero × municipio × CIIU × tarifa`, con marca de principal/secundaria. La resolución del ICA depende del municipio donde efectivamente se prestó el servicio o se realizó la operación, no del domicilio del proveedor.

## 7.6 IVA

- Tarifa general 19%; reducida 5%; exentos 0% (con derecho a impuestos descontables, arts. 477/481 ET).
- Categorías: gravados, exentos (0% con descontable), excluidos (sin descontable).
- Periodicidad (art. 600 ET): **bimestral** para grandes contribuyentes y responsables con ingresos ≥92.000 UVT al cierre del año anterior; **cuatrimestral** para el resto; anual solo régimen SIMPLE. Nuevos responsables: bimestral el primer año.
- No es obligatorio declarar cuando no hubo operaciones gravadas, descontables ni ajustes.

## 7.7 Exógena

- Año gravable 2025 (a presentar en 2026): **Resolución 000227 de 2025**, modificada por Res. 000233 y 000237 de 2025 y Res. 000012 de 2026. 69 formatos.
- Formatos clave: 1001 (pagos y retenciones practicadas), 1003 (retenciones que le practicaron), 1005 (IVA descontable), 1006 (IVA generado), 1007 (ingresos), 1008 (CxC), 1009 (CxP), 1010 (socios), 1012 (declaraciones/inversiones), 2276 (nómina/rentas de trabajo), 2820/2833 (enajenación de acciones no cotizadas).
- El Formato 1001 exige, además de identificación del tercero, **dirección y código de departamento/municipio del informado** (art. 1.3.5.2.1 Res. 000227/2025). Este dato debe capturarse desde la creación del tercero, no al final del año.
- Obligados AG 2025: personas jurídicas con ingresos brutos >2.400 UVT.
- Plazos 2026: grandes contribuyentes 28-abr a 13-may; personas jurídicas y naturales 14-may a 12-jun (escalonado por NIT).
- Sanción art. 651 ET: hasta 5% de sumas no informadas, tope 7.500 UVT.

## 7.8 PUC

Decreto 2650 de 1993. Estructura jerárquica: **clase (1 dígito) → grupo (2) → cuenta (4) → subcuenta (6) → auxiliar (7+, definido por el ente)**. 2.470 cuentas en el PUC para comerciantes.

Clases: 1 Activo, 2 Pasivo, 3 Patrimonio, 4 Ingresos, 5 Gastos, 6 Costos de Ventas, 7 Costos de Producción, 8 Cuentas de Orden Deudoras, 9 Cuentas de Orden Acreedoras. Clases 1-3 = balance; 4-7 = resultados; 8-9 = orden.

Bajo NIIF el PUC del 2650 dejó de ser catálogo único obligatorio, pero sigue siendo el catálogo operativo del mercado. **Diseño requerido:** registrar en PUC y mapear cada cuenta a su clasificación NIIF para producir los estados financieros.

## 7.9 Conservación

**10 años** desde la fecha del último asiento, documento o comprobante (art. 28 Ley 962 de 2005, que modificó el art. 60 del Código de Comercio; ratificado por Concepto CTCP 562 de 2023). Formato libre siempre que garantice reproducción exacta. Para efectos tributarios, art. 632 ET exige conservación hasta la firmeza de la declaración.

---

# 8. SISTEMA DE CONCEPTOS Y CACHÉ — CONTROL DE COSTO DE IA

## 8.1 El problema

Un sistema que llama a un LLM en cada factura, para 60 empresas que procesan cientos de facturas mensuales, gasta dinero de forma lineal y sin techo. Además introduce no-determinismo: la misma factura podría causarse distinto dos veces, lo que destruye la confianza del contador de inmediato.

## 8.2 La solución: conceptos parametrizables (modelo World Office, corregido)

Existe una entidad **Concepto de Causación**. Un concepto agrupa un tipo de operación recurrente ("Servicio de mantenimiento de equipos", "Arrendamiento de oficina", "Honorarios de asesoría jurídica"). Al concepto se le parametriza:

- Cuenta PUC de gasto/costo a debitar
- Cuenta PUC de IVA descontable
- Cuenta PUC de la contrapartida (CxP)
- **Referencia a la regla de retefuente** (`concepto_retefuente_id`)
- **Referencia a la regla de ReteIVA** (`aplica_reteiva`, booleano + condiciones)
- **Referencia a la regla de ReteICA** (`aplica_reteica`, booleano; la tarifa se resuelve por municipio + actividad del tercero)
- Descuentos o validaciones adicionales aplicables
- Centro de costo por defecto (opcional)

### CORRECCIÓN CRÍTICA respecto al modelo tradicional

**El concepto referencia la regla, no la tarifa.** Si el concepto guardara "2,5%", un cambio normativo obligaría a editar cientos de conceptos en decenas de empresas. El concepto guarda un puntero al concepto de retención en la tabla paramétrica; la tarifa vive una sola vez y se resuelve por vigencia. Cambiar la tarifa en un lugar actualiza todos los conceptos que la referencian.

### El concepto no determina solo la retención

La resolución final requiere cinco ejes:

```
concepto × tercero × municipio × cuantía × fecha_del_hecho → retenciones
```

- **Concepto:** qué se compró → determina el concepto de retención aplicable y las cuentas
- **Tercero:** quién vende → declarante o no, autorretenedor, gran contribuyente, régimen SIMPLE, responsable de IVA (el mismo concepto de servicios da 4% a una PJ y 6% a una PN no declarante)
- **Municipio:** dónde se prestó el servicio → tarifa de ICA según la actividad del tercero en ese municipio
- **Cuantía:** base gravable → contra la base mínima en UVT del concepto
- **Fecha del hecho:** qué vigencia normativa aplica

Un motor que solo mire el concepto calculará mal.

## 8.3 Memoria de decisiones (el ahorro real)

Tabla `memoria_clasificacion`, con clave `(company_id, tercero_id, patrón_normalizado_descripción)` → `concepto_id`.

**Flujo:**
1. Llega una factura. Se normaliza la descripción (minúsculas, sin tildes, sin números variables, sin fechas).
2. **Consulta a memoria.** Si existe coincidencia para ese proveedor en esa empresa → se aplica el concepto directamente. **Cero llamadas al LLM.**
3. Si no hay coincidencia → se llama al LLM, que propone un concepto con score de confianza.
4. Si el score supera el umbral configurable → se propone en la bandeja, precargado.
5. Si el score es bajo → va a cola de revisión manual sin propuesta.
6. **Cuando el humano aprueba o corrige, la decisión se graba en memoria.** La próxima factura igual de ese proveedor no consume tokens.

**Efecto esperado:** el costo de IA es alto el primer mes de cada cliente y decae fuertemente después, porque los proveedores de una PYME se repiten. Una firma con 60 clientes converge a un porcentaje bajo de facturas que requieren LLM.

**Parámetros configurables de este subsistema:** umbral de auto-aprobación, umbral de propuesta, si la memoria es por empresa o compartida a nivel de firma, y antigüedad tras la cual una entrada de memoria se revalida.

## 8.4 Determinismo obligatorio

- Temperatura del modelo en el mínimo.
- Prompts versionados; cambiar un prompt es un evento auditado.
- El LLM devuelve un `concepto_id` de un catálogo cerrado, no texto libre.
- El cálculo lo hace siempre el motor determinista, nunca el LLM.
- Procesar la misma factura N veces debe producir el mismo asiento N veces. A14 verifica esto explícitamente.

---

# 9. MOTOR DE REGLAS TRIBUTARIAS (Agente A3)

## 9.1 Contrato de la función de resolución

```
resolver_retenciones(
  company_id,
  tercero_id,
  concepto_id,
  municipio_operacion,
  base_gravable,
  valor_iva,
  fecha_hecho_economico
) → lista de retenciones aplicadas
```

Cada retención devuelta incluye obligatoriamente:
- Tipo (retefuente / reteiva / reteica / autorretención)
- Base sobre la que se calculó
- Tarifa aplicada
- **Identificador de la regla paramétrica y su vigencia**
- Valor calculado, redondeado según la regla de redondeo configurada
- Cuenta PUC afectada
- Norma de respaldo (texto, para mostrar al contador)

## 9.2 Secuencia de resolución

1. Determinar atributos fiscales del tercero a la fecha del hecho.
2. Determinar si la empresa es agente de retención para cada tipo.
3. Para retefuente: obtener el concepto de retención del concepto de causación → resolver tarifa y base mínima vigentes a la fecha → verificar si la base gravable supera la base mínima → calcular.
4. Para ReteIVA: verificar condiciones de agente y de tercero → aplicar tarifa sobre el **valor del IVA**, no sobre la base.
5. Para ReteICA: obtener municipio de la operación → obtener la actividad del tercero en ese municipio desde `tercero_actividad` → resolver tarifa municipal vigente → verificar base mínima del municipio (que difiere entre servicios y compras) → calcular.
6. Para autorretención: verificar si la empresa es autorretenedora → resolver tarifa por su CIIU principal.
7. Aplicar reglas de redondeo configuradas.
8. Persistir la traza completa.

## 9.3 Casos que el motor debe manejar explícitamente

- Base gravable inferior a la base mínima → no se retiene, pero se registra la evaluación y por qué no aplicó.
- Tercero con múltiples actividades en el mismo municipio → regla de desempate configurable.
- Factura con múltiples líneas de conceptos distintos → retención por concepto, agregada correctamente.
- AIU (servicios temporales, vigilancia, aseo) → la base es el AIU, no el valor total.
- Proveedor del exterior → ReteIVA al 100%.
- Régimen SIMPLE → tratamiento diferenciado.
- Nota crédito → reversa proporcional de las retenciones del documento original.

---

# 10. INGEST Y PARSING (Agente A4)

## 10.1 Canal de recepción

**Vía principal: buzón de correo dedicado por empresa-cliente.** El emisor de la factura electrónica está obligado a entregar al adquirente el XML y la representación gráfica; en la práctica lo envía por correo. El cliente redirige (o configura como destinatario) una dirección única del sistema, del tipo `empresa-{identificador}@inbox.dominio.com`.

**Vías secundarias:** carga manual de XML/ZIP por el usuario, y consulta en el portal DIAN por el propio contribuyente con descarga manual.

**Limitación a documentar en el producto:** no existe API pública de la DIAN para que un tercero descargue masivamente las facturas recibidas de un contribuyente sin autenticación del titular. El canal de correo no es exhaustivo al 100%; el sistema debe ofrecer conciliación contra lo que el cliente descargue del portal DIAN.

## 10.2 Parsing UBL 2.1

- Formato XML bajo UBL 2.1, anexo técnico vigente **versión 1.9** (marco Resolución 000042 de 2020 y modificatorias).
- Cinco tipos de documento UBL: `Invoice`, `CreditNote`, `DebitNote`, `ApplicationResponse` (eventos), `AttachedDocument` (contenedor).
- **Caso crítico:** con frecuencia el `Invoice` viene embebido, a veces en base64, dentro del `AttachedDocument`. El parser debe desempaquetar el contenedor antes de parsear.
- Extraer: emisor (NIT, nombre), adquirente, líneas de detalle, impuestos discriminados, totales, y **CUFE**.
- El CUFE es un hash SHA-384 que combina datos de la factura con la clave técnica de control; sirve como identificador único.
- Validar contra el XSD del anexo técnico.

## 10.3 Deduplicación y seguridad del ingest

- **Deduplicación por CUFE.** Un CUFE ya procesado no se vuelve a causar.
- Verificación SPF/DKIM del correo entrante.
- Cuarentena para adjuntos que no parseen o que no sean XML válido.
- Límite de tamaño y de tasa por buzón.
- Registro de todo correo recibido, procesado o rechazado, con motivo.

## 10.4 Eventos RADIAN (fase posterior, diseñar el espacio)

Eventos del adquirente: acuse de recibo de la factura, recibo del bien o prestación del servicio, y aceptación expresa o tácita (Res. 000085 de 2022, base Decreto 358 de 2020). Si el adquirente no acepta expresamente ni reclama dentro de los **3 días hábiles** siguientes al recibo, opera la aceptación tácita.

Nota jurisprudencial relevante: el Consejo de Estado anuló varios oficios DIAN que exigían acuses previos a la declaración de IVA (radicado 29509 de 10-jul-2025), lo que flexibilizó el plazo para impuestos descontables.

Generar eventos RADIAN requiere habilitación o integración con proveedor tecnológico. **No entra en el alcance inicial**, pero el modelo de datos debe reservar el espacio.

---

# 11. REPORTERÍA Y EXPORTACIÓN A EXCEL (Agente A9)

## 11.1 Principio

Hay salidas que no se automatizan por completo: notas a los estados financieros, revelaciones, juicios profesionales, papeles de trabajo de renta. Para todas ellas **el contador debe poder descargar un Excel bien estructurado** con el que arme el entregable final. Un reporte que solo se ve en pantalla no sirve para el flujo de trabajo real de una firma contable.

## 11.2 Estructura obligatoria de todo Excel exportado

Cada libro exportado incluye como mínimo:
- **Hoja "Datos":** datos crudos, una fila por registro, sin celdas combinadas, sin formato que estorbe. Es la hoja que el contador filtra y tabula.
- **Hoja "Papel de trabajo":** presentación formateada, con encabezado de empresa, NIT, período, responsable y fecha de generación.
- **Hoja "Trazabilidad":** para reportes con cálculos tributarios, el detalle de qué regla y vigencia se aplicó a cada partida.
- **Hoja "Parámetros":** los valores paramétricos usados (UVT, tarifas) con su vigencia, para que el reporte sea autoexplicativo dentro de seis meses.

## 11.3 Reportes exigidos

**Ola 3, obligatorios:**
- Libro auxiliar por cuenta y por tercero
- Libro diario
- Libro mayor
- Balance de prueba (a cualquier nivel del PUC)
- Certificado de retenciones por tercero
- Relación de retenciones practicadas por período y tipo
- Movimiento de terceros
- Detalle de IVA generado y descontable

**Estados financieros (A10):** Estado de Situación Financiera, Estado de Resultado Integral (por naturaleza o por función), Estado de Cambios en el Patrimonio, Estado de Flujos de Efectivo (directo o indirecto), y estructura de notas. Revelaciones mínimas del Grupo 2: bases de preparación y políticas contables, desagregación de partidas de cada estado, juicios y fuentes de incertidumbre en estimaciones, más las revelaciones específicas de cada sección aplicable.

**Exógena (A11):** generación de los formatos 1001, 1003, 1005, 1006, 1007, 1008, 1009 y demás, con exportación en el formato exigido y también en Excel para revisión previa.

---

# 12. CASOS DORADOS — SUITE DE ACEPTACIÓN (Agente A14)

Estos casos deben estar implementados como pruebas automatizadas antes de cerrar la Ola 1. A14 los ejecuta en cada entrega posterior. Los valores se calculan con UVT 2026 = $52.374 y tarifas del Decreto 572.

| # | Escenario | Resultado esperado |
|---|---|---|
| 1 | Servicio $1.000.000 + IVA 19%, proveedor PJ declarante, Bogotá | Retefuente 4% = $40.000; ReteIVA 15% sobre $190.000 = $28.500; ReteICA según actividad y tarifa vigente |
| 2 | Mismo servicio, proveedor PN **no declarante** | Retefuente **6%** = $60.000. Verifica que el eje "tercero" opera |
| 3 | Servicio de $80.000 (bajo 2 UVT = $104.748) | **No se retiene retefuente.** Se registra la evaluación y el motivo |
| 4 | Compra de bienes $500.000 (bajo 10 UVT = $523.740) | **No se retiene.** Registro del motivo |
| 5 | Compra de bienes $600.000 a declarante | Retefuente 2,5% = $15.000 |
| 6 | Honorarios PJ $200.000 | Retefuente 11% desde el primer peso = $22.000 |
| 7 | Arrendamiento de inmueble $400.000 | No retiene (bajo 10 UVT); arrendamiento de mueble por igual valor **sí** retiene 4% |
| 8 | Servicio en Medellín | ReteICA con tarifa general 2‰, base 15 UVT = $785.610 |
| 9 | Mismo servicio en Cali | Base servicios 3 UVT = $157.122; tarifa = la de la actividad |
| 10 | Proveedor con actividad principal en Bogotá y secundaria en Cali; operación en Cali | Aplica tarifa de la actividad que ejerce **en Cali**, no la de Bogotá |
| 11 | Servicio de vigilancia $5.000.000 con AIU de $500.000 | Retefuente 2% sobre el **AIU** = $10.000, no sobre el total |
| 12 | Factura de proveedor del exterior | ReteIVA al **100%** |
| 13 | Proveedor régimen SIMPLE | Tratamiento diferenciado según parametrización |
| 14 | Factura con 3 líneas de conceptos distintos | Retención por concepto, correctamente agregada |
| 15 | Nota crédito sobre factura ya causada | Reversa proporcional de retenciones, por asiento nuevo, sin mutar el original |
| 16 | Factura fechada 15-jun-2026, procesada el 20-jul-2026 | Aplica la vigencia de **junio**, no la de julio |
| 17 | Cambio de tarifa en parametrización con vigencia futura | Los asientos publicados no cambian; los nuevos usan la tarifa nueva |
| 18 | Reprocesar 10 veces la misma factura | Asiento idéntico las 10 veces |
| 19 | Segunda factura del mismo proveedor con la misma descripción | **Cero llamadas al LLM** (acierto de memoria) |
| 20 | Usuario del tenant A consulta datos del tenant B | Cero filas devueltas, a nivel de base de datos |

**Pruebas adicionales de integridad que A14 debe implementar:**
- Grep del código fuente buscando literales numéricos que parezcan tarifas o valores UVT → cero resultados.
- Intento de `UPDATE`/`DELETE` sobre asiento publicado → falla en BD.
- Inserción de asiento desbalanceado → falla en BD.
- Balance de prueba contra suma directa del ledger con 10.000 asientos aleatorios → cuadra al centavo.
- Prueba de carga: 5.000 facturas en cola sin degradar el request HTTP.

---

# 13. INTEGRACIONES EXTERNAS Y n8n (Agente A13)

## 13.1 Qué SÍ va en n8n

- Orquestación del ingest: recepción del webhook de correo, extracción del adjunto, envío al endpoint de la aplicación.
- Reintentos y manejo de fallos del ingest.
- Notificaciones: alertas al contador cuando hay facturas pendientes de revisión, cuando un buzón falla, cuando se acerca un vencimiento tributario.
- Jobs programados: recordatorios de calendario tributario, reportes periódicos, respaldos.
- Integraciones futuras con proveedores tecnológicos de facturación y con bancos.

## 13.2 Qué NO va en n8n

**Ningún cálculo tributario. Ninguna escritura de asientos contables. Ninguna resolución de reglas.**

Justificación: el cálculo debe ser determinista, versionado, testeable con la suite de casos dorados y defendible ante un revisor fiscal. Lógica tributaria distribuida en un workflow visual no cumple ninguna de esas cuatro condiciones. n8n orquesta y notifica; la aplicación decide y calcula.

## 13.3 Contrato de integración

- La aplicación expone endpoints autenticados para ingest de documentos y para consulta de estado.
- Autenticación por token con alcance limitado por tenant.
- Idempotencia obligatoria: reenviar el mismo documento no crea duplicados (clave: CUFE).
- Todo llamado entrante y saliente queda registrado.

---

# 14. SEGURIDAD Y CUMPLIMIENTO (Agente A12)

## 14.1 Obligatorio desde el día uno

- **Row Level Security** activa en todas las tablas de datos, con doble nivel tenant/company.
- Cifrado en tránsito (TLS) y en reposo.
- Autenticación con MFA disponible; roles y permisos granulares (mínimo: administrador de firma, administrador tributario, contador, auxiliar de causación, solo lectura).
- `audit_log` de toda acción sensible: aprobaciones, ediciones de parámetros, cambios de mapeo PUC, accesos a datos de otra empresa.
- **Política de tratamiento de datos personales y aviso de privacidad** (Ley 1581 de 2012, Decreto 1377 de 2013, compilados en Decreto 1074 de 2015).
- **Contrato de transmisión de datos** entre el cliente (responsable del tratamiento) y el SaaS (encargado del tratamiento). El SaaS trata datos solo según instrucciones del responsable, garantiza seguridad y confidencialidad, y devuelve o suprime al terminar.
- **Cláusulas de transferencia internacional de datos.** Colombia restringe la transferencia a países sin nivel adecuado de protección salvo autorización del titular o cláusulas contractuales que garanticen los estándares; Estados Unidos no está en la lista de países adecuados de la SIC. No existe prohibición legal específica de alojar datos contables fuera de Colombia —el Código de Comercio exige conservación y reproducción exacta, no residencia local—, pero hay que cubrirse contractualmente y declararlo en la política.
- **Términos y condiciones con limitación de responsabilidad** por cálculo tributario: el software es una herramienta de apoyo; la responsabilidad tributaria recae en el contribuyente y su contador. Esta limitación se refuerza con el flujo de aprobación humana obligatoria, que además es un control técnico real que reduce la exposición.
- Procedimiento de atención de consultas y reclamos de titulares.
- Procedimiento de reporte de incidentes de seguridad a la SIC (plazo de 15 días hábiles).
- Retención de datos por 10 años con reproducción exacta garantizada.
- Respaldos automáticos con prueba de restauración.

## 14.2 Puede esperar

- **Registro Nacional de Bases de Datos (RNBD) ante la SIC.** Obligatorio solo para responsables con activos totales superiores a 100.000 UVT (Decreto 090 de 2018, art. 1), lo que para 2026 equivale a aproximadamente $5.237.400.000. Un SaaS en fase temprana no supera ese umbral, pero **sí debe cumplir todas las demás obligaciones de habeas data** aunque no esté obligado al registro.
- Certificaciones ISO 27001 / SOC 2: cuando lo exijan clientes grandes. En fase temprana el diferenciador realista es demostrar controles concretos.
- Habilitación DIAN: solo si se decide emitir documentos o generar eventos RADIAN directamente.

---

# 15. MODELO DE DATOS NÚCLEO

Entidades mínimas y sus relaciones. A2 puede ampliar, no reducir.

**Estructura organizacional**
- `tenant` (firma contable) → `company` (empresa-cliente) → `fiscal_period`
- `user`, `role`, `user_company_access`

**Catálogos contables**
- `account` (PUC jerárquico: clase, grupo, cuenta, subcuenta, auxiliar) ↔ `niif_mapping`
- `cost_center`

**Terceros**
- `third_party` (NIT, tipo, nombre, dirección, **municipio y código DANE**, atributos fiscales: declarante, autorretenedor, gran contribuyente, régimen SIMPLE, responsable de IVA, agente de retención)
- `third_party_activity` (`tercero × municipio × CIIU × tarifa_ica`, marca principal/secundaria) — indispensable para ReteICA multimunicipio

**Ledger**
- `journal_entry` (append-only; `posted_at`, `reversed_by`, FK a `source_document`, FK a `approval`)
- `journal_line` (`side` débito/crédito, monto entero, FK a `account`, FK opcional a `third_party` y `cost_center`)

**Parametrización**
- `tax_rule` (tipo, concepto, tarifa, base_uvt, cuenta PUC, municipio opcional, `vigente_desde`, `vigente_hasta`, norma_respaldo)
- `uvt_value`, `smmlv_value` (por año, con vigencia)
- `municipality` (código DANE, nombre, departamento, bases mínimas, periodicidad)
- `ciiu_activity`
- `tax_calendar`
- `rounding_rule`

**Conceptos y clasificación**
- `concepto_causacion` (cuentas PUC, **referencias a reglas** de retención, validaciones, centro de costo por defecto)
- `memoria_clasificacion` (`company_id`, `tercero_id`, `patrón_descripción` → `concepto_id`, contador de aciertos, fecha de última confirmación)

**Documentos**
- `source_document` (XML crudo, CUFE, hash, estado, fecha del hecho económico)
- `extraction` (datos extraídos, propuesta del LLM, score de confianza, versión del prompt)
- `retention_applied` (base, tarifa, `tax_rule_id`, vigencia usada, valor, cuenta) — una fila por retención por documento

**Control**
- `approval` (usuario, timestamp, decisión, IP)
- `audit_log`

**Relaciones clave que deben ser obligatorias (NOT NULL):** todo `journal_entry` referencia un `source_document` y un `approval`; toda `retention_applied` referencia una `tax_rule` con su vigencia; todo `journal_line` referencia una `account`.

---

# 16. FORMATO DE ENTREGA ESPERADO

Por cada ola, el orquestador entrega:

1. **Código funcional** con migraciones ejecutables y pruebas que pasan.
2. **Reporte de ola:** qué se construyó, qué pruebas pasan, qué falta, decisiones tomadas con su justificación.
3. **Registro de decisiones arquitectónicas:** cada decisión no trivial, con las alternativas consideradas y por qué se descartaron.
4. **Reporte de A14:** resultado de los casos dorados, vulnerabilidades encontradas y corregidas, intentos de romper el sistema y su resultado.
5. **Reporte de A15:** costo estimado de infraestructura y de tokens al volumen proyectado, contra el presupuesto.
6. **Lista de verificación normativa:** qué datos tributarios se poblaron, con qué norma de respaldo, y **cuáles requieren verificación humana antes de producción**.

---

# 17. ADVERTENCIAS QUE TODOS LOS AGENTES DEBEN CONOCER

1. **Las tarifas del Decreto 572 de 2025 están en etapa cautelar.** El fallo de fondo del Consejo de Estado sigue abierto y podría modificarlas. Esto no es un problema si la Regla de Oro 3 se respeta; es un desastre si se ignora.
2. **Las tarifas y bases de ReteICA por municipio deben verificarse contra el acuerdo municipal vigente antes de producción.** Los valores de este documento son de referencia. Bucaramanga y Cartagena están marcados como pendientes de verificación.
3. **Las tarifas de autorretención por CIIU deben verificarse contra la tabla oficial DIAN completa.** Los cuatro valores de ejemplo no son la tabla.
4. **Los costos de LLM cambian rápido.** A15 debe verificar precios vigentes antes de fijar la arquitectura de costos.
5. **Ningún agente debe inventar un valor tributario.** Si un dato normativo no está en este documento y no se puede verificar, se marca como pendiente y se deja la fila paramétrica vacía con una alerta en la interfaz. Un valor inventado en un motor tributario es peor que un valor faltante: el faltante se ve, el inventado no.
6. **El producto se vende por su trazabilidad, no por sus features.** Cuando haya que elegir entre una funcionalidad más y una traza más clara de por qué se aplicó una retención, gana la traza.

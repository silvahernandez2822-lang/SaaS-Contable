# Cláusulas de transferencia y transmisión internacional de datos personales

**Documento:** CLA-HD-001
**Versión:** 1.0

> **Nota para revisión jurídica.** Este documento reúne el análisis normativo y el
> clausulado que debe incorporarse tanto al contrato con el cliente (`CTR-HD-001`)
> como a los contratos con los proveedores de infraestructura. El análisis está
> hecho sobre la normativa vigente a [FECHA]; la vigencia y numeración de las
> circulares de la Superintendencia debe confirmarse antes de la firma.

---

## 1. El problema, planteado sin rodeos

La plataforma se aloja en infraestructura de proveedores de nube cuyos servidores
están, en la práctica, en los **Estados Unidos de América**. El presupuesto del
proyecto no admite hoy una alternativa alojada en Colombia ni en un país declarado
adecuado.

El **artículo 26 de la Ley 1581 de 2012** dispone:

> "Se prohíbe la transferencia de datos personales de cualquier tipo a países que no
> proporcionen niveles adecuados de protección de datos."

y a continuación establece las excepciones. **Estados Unidos de América no figura en
el listado de países con nivel adecuado de protección** declarado por la
Superintendencia de Industria y Comercio mediante la **Circular Externa 005 de 2017**,
que adicionó el Capítulo Séptimo del Título V de la Circular Única (Circular Externa
Única). **(verificar vigencia, numeración y contenido actualizado del listado antes
de publicar; la SIC lo ha modificado en varias oportunidades).**

Por lo tanto: **la transferencia es lícita solo si se ampara en una de las
excepciones del artículo 26 o en una declaración de conformidad de la SIC**. No
basta con firmar cláusulas y darla por resuelta.

## 2. Distinción que cambia el análisis: transferencia vs. transmisión

El artículo 2.2.2.25.1.3 del Decreto 1074 de 2015 distingue:

- **Transferencia:** el Responsable envía la información a un **receptor que también
  es Responsable** y está dentro o fuera del país.
- **Transmisión:** el Tratamiento implica la comunicación de datos **dentro o fuera
  del territorio** cuando tenga por objeto la realización de un Tratamiento **por el
  Encargado por cuenta del Responsable**.

El artículo **2.2.2.25.5.1** del mismo decreto establece que, en la **transmisión**
internacional, la prohibición del artículo 26 **no aplica** cuando exista un contrato
de transmisión que cumpla los requisitos del artículo 2.2.2.25.5.2.

**Consecuencia práctica:**

| Flujo | Naturaleza | Régimen |
|---|---|---|
| Firma cliente (Responsable) → Plataforma (Encargado) | **Transmisión** | Amparada por el contrato `CTR-HD-001` |
| Plataforma (Encargado) → Proveedor de nube (Subencargado) | **Transmisión** | Amparada por las cláusulas de esta sección 4 |
| Plataforma (Responsable, datos de sus propios usuarios) → Proveedor de nube | **Transmisión** | Amparada por las cláusulas de esta sección 4 |

Es decir: el eje principal del cumplimiento es la **cadena de contratos de
transmisión**, no la excepción del artículo 26. La autorización expresa del Titular
se recoge además como **cinturón de seguridad**, porque el clausulado no es
autoevidente y una autoridad podría calificar alguno de los flujos como
transferencia. **(punto expreso para el abogado: confirmar esta lectura).**

## 3. Bases jurídicas invocadas, en orden

1. **Contrato de transmisión** que cumple el artículo 2.2.2.25.5.2 del Decreto 1074
   de 2015, con cada cliente y con cada proveedor. Es la base principal.
2. **Autorización expresa e informada del Titular** (literal a del artículo 26 de la
   Ley 1581 de 2012), recogida en el Aviso de Privacidad con mención expresa del país
   de destino y de la ausencia de declaración de adecuación.
3. **Necesidad para la ejecución de un contrato entre el Titular y el Responsable**
   (literal e del artículo 26), aplicable a los usuarios de la plataforma.
4. **Declaración de conformidad ante la SIC** (Circular Externa 005 de 2017): vía
   disponible para solicitar a la Superintendencia que declare que el destino ofrece
   garantías adecuadas. **Se deja identificada como opción; no se ha tramitado.**

## 4. Clausulado exigido al proveedor de infraestructura

Toda contratación de un proveedor que aloje o procese datos personales fuera de
Colombia debe incorporar, como mínimo, las siguientes estipulaciones. Si el proveedor
ofrece únicamente su propio Data Processing Addendum, debe verificarse que cubra
estos puntos y documentarse la equivalencia.

### Cláusula 1 — Alcance y sujeción a instrucciones

EL PROVEEDOR tratará los datos personales **únicamente** conforme a las instrucciones
documentadas de [RAZÓN SOCIAL], incluidas las relativas a transferencias
internacionales, y **no los usará para finalidad propia alguna**, señaladamente para
entrenar modelos de aprendizaje automático, elaborar perfiles o generar productos
derivados.

### Cláusula 2 — Estándar de protección no inferior al colombiano

EL PROVEEDOR aplicará a los datos personales un nivel de protección **no inferior**
al que exigen la Ley 1581 de 2012 y sus decretos reglamentarios, con independencia de
que la ley de su domicilio imponga un estándar menor.

### Cláusula 3 — Confidencialidad

EL PROVEEDOR garantizará que las personas autorizadas para tratar los datos se hayan
comprometido a la confidencialidad o estén sujetas a un deber legal equivalente. La
obligación subsiste tras la terminación del contrato.

### Cláusula 4 — Seguridad

EL PROVEEDOR mantendrá, como mínimo: cifrado en tránsito con TLS 1.2 o superior;
cifrado en reposo de volúmenes y respaldos; control de acceso por privilegio mínimo
con registro; segregación lógica entre clientes; y un programa de gestión de
vulnerabilidades. Acreditará estos controles mediante informe de auditoría
independiente vigente (SOC 2 Tipo II, ISO/IEC 27001 o equivalente) cuando cuente con
él.

### Cláusula 5 — Subcontratación

EL PROVEEDOR no subcontratará el Tratamiento sin autorización previa y escrita, y en
todo caso impondrá al subcontratista obligaciones no menos exigentes, respondiendo
por sus incumplimientos como si fueran propios.

### Cláusula 6 — Notificación de incidentes

EL PROVEEDOR notificará todo incidente de seguridad que afecte datos personales
**sin dilación indebida y a más tardar dentro de las cuarenta y ocho (48) horas**
siguientes a su detección, con la información necesaria para que [RAZÓN SOCIAL] pueda
cumplir su propio deber de reporte ante la Superintendencia de Industria y Comercio
dentro de los quince (15) días hábiles.

### Cláusula 7 — Requerimientos de autoridades extranjeras

EL PROVEEDOR notificará a [RAZÓN SOCIAL], en la medida en que la ley se lo permita,
todo requerimiento vinculante de una autoridad pública extranjera que tenga por
objeto los datos personales tratados, y agotará los recursos disponibles para
oponerse cuando el requerimiento sea manifiestamente desproporcionado. Cuando la ley
le prohíba notificar, se obliga a llevar un registro y a informar en agregado.

> **Advertencia para el abogado.** Esta cláusula no neutraliza el acceso
> gubernamental extranjero, incluido el previsto en la legislación estadounidense de
> vigilancia. Ninguna cláusula contractual lo hace. Se incluye porque reduce el
> riesgo y documenta la diligencia, no porque lo elimine. El riesgo residual debe
> valorarse y aceptarse por escrito.

### Cláusula 8 — Ubicación y cambio de ubicación

EL PROVEEDOR declara la región en la que se alojarán los datos y notificará con
**treinta (30) días calendario** de antelación toda modificación. [RAZÓN SOCIAL]
podrá oponerse y, en tal caso, terminar el contrato sin penalidad.

### Cláusula 9 — Derechos de los Titulares

EL PROVEEDOR asistirá a [RAZÓN SOCIAL] en la atención de consultas, reclamos y
solicitudes de acceso, rectificación, actualización y supresión, dentro de plazos
compatibles con los de los artículos 14 y 15 de la Ley 1581 de 2012.

### Cláusula 10 — Devolución y supresión

Terminado el contrato, EL PROVEEDOR devolverá o suprimirá los datos personales según
elija [RAZÓN SOCIAL], incluidas las copias de respaldo, dentro de los plazos pactados,
y certificará por escrito la supresión.

### Cláusula 11 — Auditoría

EL PROVEEDOR permitirá y contribuirá a las auditorías, incluidas inspecciones,
realizadas por [RAZÓN SOCIAL] o por un auditor mandatado, o en su defecto pondrá a
disposición sus informes de auditoría independiente vigentes.

### Cláusula 12 — Ley aplicable

Sin perjuicio de la ley que rija el contrato, las obligaciones sobre datos personales
se interpretarán conforme a la ley colombiana cuando esta resulte más protectora del
Titular.

## 5. Texto para el Aviso de Privacidad

El texto que se muestra al Titular está en el documento `AVI-HD-001`. No debe
suavizarse: si el país de destino no tiene declaración de adecuación, el aviso debe
decirlo con esas palabras. Un aviso que omita la circunstancia vicia la autorización
que pretende recoger.

## 6. Sobre la residencia de los datos contables

Conviene dejarlo escrito, porque suele confundirse con el habeas data:

**No existe en Colombia una norma que obligue a alojar los libros y papeles del
comerciante dentro del territorio nacional.** El artículo 28 de la Ley 962 de 2005
exige conservarlos por diez (10) años y garantizar su **reproducción exacta**, y
admite expresamente cualquier medio técnico, magnético o electrónico que lo permita.
Los artículos 48 y siguientes del Código de Comercio y el artículo 632 del Estatuto
Tributario tampoco imponen residencia local.

Es decir: el obstáculo del alojamiento en el exterior es **de protección de datos
personales**, no de derecho comercial ni tributario. Se resuelve por la vía
contractual y de autorización descrita aquí, no cambiando de proveedor.

## 7. Registro de decisiones y riesgos aceptados

| Riesgo | Estado | Responsable de la decisión |
|---|---|---|
| Alojamiento en país sin declaración de adecuación | Aceptado, amparado en contrato de transmisión + autorización expresa | [CARGO] |
| Acceso por autoridad extranjera bajo legislación de vigilancia | Aceptado; mitigado contractualmente, no eliminado | [CARGO] |
| Declaración de conformidad ante la SIC no tramitada | Pendiente; se evaluará al superar [UMBRAL DE CLIENTES / FACTURACIÓN] | [CARGO] |
| Vigencia y numeración exacta de la Circular Externa sobre países adecuados | **Por verificar antes de publicar** | Abogado externo |

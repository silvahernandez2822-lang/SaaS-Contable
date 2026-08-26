# Términos y Condiciones del Servicio

**Documento:** TYC-001
**Versión:** 1.0
**Fecha de entrada en vigencia:** [FECHA]

> **Nota para revisión jurídica.** Las cláusulas de limitación de responsabilidad
> (numeral 7) están redactadas para una relación **entre empresarios**. Si en algún
> momento el servicio se ofrece a consumidores en el sentido de la **Ley 1480 de
> 2011**, esas cláusulas deben revisarse: el artículo 43 de esa ley reputa ineficaces
> de pleno derecho las cláusulas que limiten la responsabilidad del productor o
> proveedor frente al consumidor. **(verificar)**

---

## 1. Partes y objeto

Estos términos regulan el acceso y uso de la plataforma de causación contable
automatizada operada por **[RAZÓN SOCIAL]**, NIT [NIT] (en adelante, **el
Proveedor**), por parte de la firma contable o empresa que contrata el servicio (en
adelante, **el Cliente**) y de los usuarios que el Cliente autorice.

El servicio consiste en recibir facturas electrónicas de compra y documentos soporte,
extraer su contenido, **proponer** una clasificación contable y un cálculo de
retenciones conforme a los parámetros tributarios cargados en el sistema, y producir
asientos contables una vez el Cliente los apruebe.

## 2. Naturaleza del servicio: herramienta de apoyo

**El servicio es una herramienta de apoyo al ejercicio profesional de la
contaduría. No sustituye el criterio del contador público ni asume obligación
tributaria alguna del Cliente.**

En concreto:

1. La plataforma **no emite** facturación electrónica ante la DIAN, no genera eventos
   RADIAN por cuenta del Cliente ni presenta declaraciones tributarias.
2. La plataforma **no está habilitada** por la DIAN como proveedor tecnológico ni
   como facturador electrónico.
3. Los cálculos de retención que la plataforma produce se basan **exclusivamente** en
   los parámetros tributarios cargados en el sistema y en los atributos fiscales de
   los terceros que el Cliente haya registrado. La plataforma no verifica que esos
   parámetros ni esos atributos correspondan a la realidad.
4. **Ningún asiento se contabiliza sin aprobación humana explícita.** El flujo de
   aprobación es una característica esencial del servicio y no puede desactivarse.

## 3. Responsabilidad tributaria

Conforme a los artículos **571** y **572** del Estatuto Tributario, los contribuyentes
y responsables deben cumplir personalmente o por medio de sus representantes los
deberes formales a su cargo. Conforme al artículo **581** ibídem, la firma del
contador público o del revisor fiscal en las declaraciones tributarias certifica los
hechos allí enunciados.

En consecuencia, y sin que la enunciación sea limitativa:

1. **La responsabilidad por la determinación, liquidación, declaración y pago de todo
   impuesto, retención, sanción e interés recae exclusivamente en el Cliente y en el
   contador público o revisor fiscal que suscriba las declaraciones.**
2. **El Cliente es responsable de verificar y mantener actualizados** los parámetros
   tributarios de la plataforma: tarifas, bases mínimas, valores de UVT y SMMLV,
   reglas de retención por municipio, calendarios tributarios y mapeos del plan de
   cuentas. El Proveedor puede suministrar valores de referencia; su carga y su
   vigencia son decisión del Cliente.
3. **El Cliente es responsable de verificar los atributos fiscales de cada tercero**
   —condición de declarante, autorretenedor, gran contribuyente, régimen simple,
   responsable de IVA y agente de retención— a la fecha del hecho económico.
4. **El Cliente es responsable de revisar cada propuesta antes de aprobarla.** La
   aprobación deja constancia del usuario, la fecha, la hora y la dirección IP desde
   la que se otorgó.
5. Cuando la plataforma no pueda determinar un dato tributario con la información
   disponible, **lo marcará para revisión manual y no inventará un valor**. La
   ausencia de una propuesta no exime al Cliente de su obligación.

## 4. Inteligencia artificial

La plataforma utiliza modelos de lenguaje para extraer datos de los documentos y
**proponer** una clasificación contable con un puntaje de confianza. Se deja
constancia expresa de que:

1. **El modelo no calcula impuestos.** Todo cálculo tributario lo realiza un motor
   determinista a partir de los parámetros cargados.
2. Las propuestas del modelo **no tienen efecto** hasta que un usuario del Cliente las
   aprueba.
3. El puntaje de confianza es un auxiliar de priorización, no una garantía de
   corrección.
4. Los documentos del Cliente pueden ser procesados por el proveedor del modelo
   listado en el Anexo B del documento `CTR-HD-001`, con la prohibición contractual
   de usarlos para entrenar modelos.

## 5. Obligaciones del Cliente

1. Suministrar información veraz, completa y actualizada.
2. Administrar sus usuarios y los permisos que les otorga, y revocar los accesos de
   quienes dejen de requerirlos.
3. Custodiar las credenciales de acceso. **El Proveedor recomienda activar el segundo
   factor de autenticación en todas las cuentas con permiso de aprobación,
   publicación o edición de parámetros.**
4. Obtener las autorizaciones de tratamiento de datos personales que le corresponden
   como Responsable, en los términos del documento `CTR-HD-001`.
5. No usar el servicio para fines ilícitos ni intentar vulnerar los controles de
   aislamiento entre clientes.
6. Descargar y conservar sus propios respaldos con la periodicidad que su política
   interna determine. El Proveedor mantiene respaldos, pero el deber legal de
   conservación de los libros y papeles del comerciante es del Cliente.

## 6. Obligaciones del Proveedor

1. Prestar el servicio con la diligencia propia de un profesional en la materia.
2. Mantener las medidas de seguridad descritas en el documento `SEG-001`.
3. Garantizar el aislamiento de la información de cada Cliente frente a los demás.
4. Conservar el registro de auditoría de las acciones sensibles, de forma que no
   admita modificación ni borrado.
5. Poner a disposición del Cliente la exportación de su información en formato
   estructurado que permita su reproducción exacta.
6. Notificar los incidentes de seguridad conforme al documento `PRO-INC-001`.
7. Informar con antelación razonable los cambios sustanciales del servicio, de estos
   términos o de los precios.

## 7. Limitación de responsabilidad

**7.1.** El Proveedor responde por el incumplimiento de las obligaciones expresamente
pactadas en el numeral 6, dentro de los límites de este numeral.

**7.2.** **El Proveedor no responde** por:

a. La determinación, liquidación, declaración o pago de tributos, ni por las
   sanciones, intereses o mayores valores que la administración tributaria determine
   a cargo del Cliente.
b. Los errores derivados de parámetros tributarios desactualizados, mal cargados o no
   cargados por el Cliente.
c. Los errores derivados de atributos fiscales de terceros incorrectos o
   desactualizados en los registros del Cliente.
d. Las decisiones que el Cliente adopte al aprobar una propuesta, cualquiera que sea
   el puntaje de confianza que la acompañara.
e. Los cambios normativos y su interpretación, incluidos los efectos de decisiones
   judiciales que suspendan o anulen normas tributarias.
f. La indisponibilidad imputable a los proveedores de infraestructura, a fallas de
   conectividad del Cliente o a eventos de fuerza mayor o caso fortuito.
g. El uso de credenciales por parte de personas no autorizadas, cuando la causa sea
   la falta de custodia por parte del Cliente.

**7.3.** **Tope de responsabilidad.** La responsabilidad total y acumulada del
Proveedor frente al Cliente, por cualquier causa y durante toda la vigencia del
contrato, no excederá el valor de las sumas efectivamente pagadas por el Cliente en
los **doce (12) meses** anteriores al hecho que dio origen a la reclamación.

**7.4.** **Daños excluidos.** El Proveedor no responderá por lucro cesante, pérdida de
oportunidad de negocio, daño reputacional ni perjuicios indirectos o consecuenciales.

**7.5.** **Límites de la limitación.** Las exclusiones y topes anteriores **no aplican**
en caso de **dolo o culpa grave** del Proveedor, ni respecto de las obligaciones que
la ley declare irrenunciables, incluidas las derivadas de la Ley 1581 de 2012 frente
a los Titulares de datos personales. Conforme al artículo 1522 y concordantes del
Código Civil, la condonación del dolo futuro no produce efecto. **(verificar la
redacción con el abogado, en particular frente a los artículos 1604 y 1616 del Código
Civil).**

**7.6.** **Fundamento del régimen.** La limitación anterior se sustenta en que el
servicio es una herramienta de apoyo cuyo resultado **no produce efecto sin la
aprobación humana previa del Cliente**. Esa aprobación no es una formalidad: es un
control técnico efectivo, impuesto por la base de datos, sin el cual el sistema no
contabiliza. La constancia de cada aprobación —usuario, fecha, hora y dirección IP—
queda registrada y es exportable.

## 8. Disponibilidad del servicio

El Proveedor procurará una disponibilidad de **[XX,X]%** mensual, medida sobre el
tiempo total del mes calendario y excluyendo las ventanas de mantenimiento
programado, que se anunciarán con **[N]** horas de antelación. **(definir el
compromiso real; no publicar una cifra que la infraestructura contratada no pueda
sostener).**

## 9. Precio, facturación y suspensión

[CONDICIONES COMERCIALES]

El Proveedor podrá suspender el servicio por mora superior a [N] días, previo aviso
escrito con [N] días de antelación. La suspensión **no habilita** al Proveedor a
denegar al Cliente la exportación de su información, que permanecerá disponible en
los términos del numeral 10.

## 10. Terminación y portabilidad

Terminado el contrato por cualquier causa, el Cliente dispondrá de **treinta (30)
días calendario** para descargar la totalidad de su información en formato
estructurado y de uso común, que garantice su reproducción exacta en los términos del
artículo 28 de la Ley 962 de 2005.

Vencido ese plazo, la información se tratará conforme a la política de retención
(`POL-RET-001`) y al numeral DÉCIMO del contrato `CTR-HD-001`.

## 11. Propiedad intelectual

El software, su código fuente, su documentación y sus marcas son propiedad del
Proveedor. **Los datos contables y los documentos cargados por el Cliente son y
siguen siendo del Cliente**; el Proveedor solo adquiere la licencia limitada
necesaria para prestar el servicio.

## 12. Protección de datos personales

El tratamiento de datos personales se rige por la Política de Tratamiento de Datos
Personales (`POL-HD-001`), el Aviso de Privacidad (`AVI-HD-001`) y el Contrato de
Transmisión de Datos Personales (`CTR-HD-001`), que se entienden incorporados a estos
términos.

## 13. Modificaciones

El Proveedor podrá modificar estos términos, informando al Cliente con **treinta (30)
días calendario** de antelación por el canal de contacto registrado. Si el Cliente no
acepta la modificación, podrá terminar el contrato sin penalidad dentro de ese plazo,
con derecho a la portabilidad del numeral 10.

## 14. Ley aplicable y solución de controversias

Estos términos se rigen por la ley colombiana. Las controversias se someterán a
[MECANISMO], con sede en [CIUDAD]. **(definir con el abogado)**

## 15. Aceptación

La aceptación de estos términos se registra con la identificación del usuario que la
otorga, la fecha, la hora, la dirección IP y la versión del documento aceptado.

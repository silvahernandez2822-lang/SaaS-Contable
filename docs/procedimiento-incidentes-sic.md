# Procedimiento de gestión y reporte de incidentes de seguridad

**Documento:** PRO-INC-001
**Versión:** 1.0
**Responsable del procedimiento:** [CARGO]

> **Nota para revisión jurídica.** El deber de reportar nace de los literales **n)**
> del artículo 17 y **k)** del artículo 18 de la Ley 1581 de 2012: informar a la
> Superintendencia de Industria y Comercio cuando se presenten **violaciones a los
> códigos de seguridad y existan riesgos en la administración de la información de
> los Titulares**. El plazo de **quince (15) días hábiles** y el canal de reporte
> fueron fijados por la Superintendencia por vía de instrucción administrativa,
> asociada al Registro Nacional de Bases de Datos. **Debe confirmarse con el abogado
> (i) la instrucción vigente que fija el plazo y (ii) el canal aplicable a un
> responsable NO inscrito en el RNBD por no superar el umbral del Decreto 090 de
> 2018.** Este punto está identificado como abierto en el numeral 8.

---

## 1. Qué se considera incidente reportable

Un incidente de seguridad es todo evento que comprometa la **confidencialidad**, la
**integridad** o la **disponibilidad** de datos personales bajo nuestra custodia.

**Es reportable** cuando implica una violación de los códigos de seguridad y genera
riesgo en la administración de la información de los Titulares. En particular:

| Situación | ¿Reportable? |
|---|---|
| Acceso no autorizado a datos de un cliente por parte de otro cliente | Sí |
| Fuga o exposición pública de datos personales | Sí |
| Sustracción o pérdida de un respaldo con datos personales | Sí |
| Compromiso de credenciales con acceso a datos de varios clientes | Sí |
| Cifrado o borrado malicioso de datos (*ransomware*) | Sí |
| Compromiso de un proveedor de infraestructura que afecte nuestros datos | Sí |
| Vulnerabilidad detectada y corregida **sin** evidencia de explotación | No reportable a la SIC; se documenta internamente |
| Intento de acceso bloqueado por los controles, sin acceso efectivo | No reportable; se documenta y se vigila la reincidencia |
| Indisponibilidad por falla del proveedor sin compromiso de datos | No reportable a la SIC; se comunica al cliente |

**Criterio para las dudas:** ante duda razonable sobre si hubo acceso efectivo, se
reporta. El costo de reportar de más es administrativo; el de reportar de menos es
sancionatorio.

## 2. Clasificación por severidad

| Nivel | Criterio | Escalamiento |
|---|---|---|
| **Crítico** | Datos de más de un cliente comprometidos, o compromiso del aislamiento entre clientes, o pérdida irrecuperable de datos | Inmediato a [CARGO] y a la gerencia; activación del plan de respuesta |
| **Alto** | Datos de un cliente comprometidos, o compromiso de credenciales con permisos de administración | Dentro de 2 horas a [CARGO] |
| **Medio** | Exposición limitada, contenida, sin evidencia de exfiltración | Dentro de 8 horas a [CARGO] |
| **Bajo** | Vulnerabilidad sin explotación, error de configuración corregido | Registro en el consecutivo; revisión semanal |

## 3. Línea de tiempo

| Momento | Acción |
|---|---|
| **T+0** | **Detección.** Se registra fecha y hora exactas. Esta marca es la que gobierna todos los plazos posteriores. |
| **T + 1 h** | **Contención.** Revocación de sesiones y credenciales comprometidas, aislamiento del componente afectado. Se **prohíbe expresamente** borrar registros: el `audit_log` es la evidencia. |
| **T + 4 h** | **Evaluación preliminar.** Alcance, categorías de datos, clientes y Titulares afectados, severidad. |
| **T + 24 h** | **Notificación a los clientes afectados**, en su condición de Responsables, conforme a la cláusula NOVENA del contrato `CTR-HD-001`. |
| **T + 72 h** | **Informe técnico preliminar** con causa raíz probable y medidas correctivas en curso. |
| **T + 15 días hábiles** | **Reporte a la Superintendencia de Industria y Comercio**, si el incidente es reportable. |
| **T + 30 días calendario** | **Informe final** de causa raíz, medidas correctivas ejecutadas y lecciones aprendidas. |

## 4. Contenido del reporte a la Superintendencia

1. Identificación del Responsable o Encargado que reporta (razón social, NIT,
   domicilio, correo).
2. Fecha y hora de **ocurrencia** del incidente y fecha y hora de **detección**.
3. Descripción del incidente y del vector de compromiso.
4. **Categorías** de datos personales afectados y **volumen aproximado** de registros y
   de Titulares.
5. Si los datos afectados incluían **datos sensibles** o de **menores**.
6. Consecuencias probables para los Titulares.
7. Medidas de contención adoptadas.
8. Medidas correctivas ejecutadas y programadas, con fechas.
9. Si se notificó a los Titulares y, en caso negativo, la razón.
10. Datos de contacto del responsable del área de protección de datos.

## 5. Notificación a los Titulares

La Ley 1581 de 2012 **no impone expresamente** notificar al Titular cada incidente,
como sí lo hacen otros regímenes. No obstante, la notificación procede cuando:

1. El incidente entrañe un **riesgo alto** para los derechos del Titular (por ejemplo,
   exposición de credenciales o de datos que permitan suplantación).
2. Lo instruya la Superintendencia de Industria y Comercio.
3. Lo instruya el cliente en su condición de Responsable, cuando los Titulares
   afectados sean suyos.

Cuando los Titulares afectados sean de un cliente, **la notificación la efectúa el
cliente**, que es el Responsable. Nosotros le entregamos la información necesaria y le
ofrecemos apoyo, pero no nos dirigimos directamente a sus Titulares salvo instrucción
suya.

## 6. Preservación de la evidencia

1. **Prohibido** modificar o borrar registros de auditoría. La tabla `audit_log` es
   append-only por imposición de la base de datos: ni el administrador puede alterarla,
   lo que es en sí mismo un elemento probatorio.
2. Se conservan las trazas de acceso, los registros del proveedor de infraestructura y
   los volcados de estado relevantes, en un repositorio de acceso restringido.
3. La cadena de custodia se documenta: quién extrajo qué evidencia, cuándo y con qué
   herramienta.
4. La evidencia se conserva por **cinco (5) años** contados desde el cierre del
   incidente, o hasta la firmeza de toda actuación administrativa o judicial derivada,
   lo que ocurra después.

## 7. Registro de incidentes

Se lleva un consecutivo con: número, fecha y hora de ocurrencia y de detección, quién
detectó y por qué medio, severidad, descripción, datos y Titulares afectados, clientes
notificados y fecha, si se reportó a la SIC y en qué fecha, causa raíz, medidas
correctivas con responsable y fecha, y fecha de cierre.

El registro se revisa **trimestralmente** para identificar patrones. Los incidentes de
severidad crítica y alta se revisan además de forma individual con un análisis de
causa raíz escrito.

## 8. Puntos abiertos, sin adornar

1. **Canal de reporte para un responsable no inscrito en el RNBD.** El canal que la
   Superintendencia habilitó para reportar incidentes está asociado al Registro
   Nacional de Bases de Datos. Como no superamos el umbral de activos del artículo 1
   del Decreto 090 de 2018, **no estamos inscritos**, y el deber sustancial de reportar
   subsiste de todas formas. **Debe confirmarse con el abogado el canal correcto** —
   presumiblemente radicación ordinaria ante la SIC — y dejarse escrito aquí antes de
   que ocurra el primer incidente, no después.
2. **Instrucción vigente que fija el plazo de quince (15) días hábiles.** Se adopta ese
   plazo por ser el que la Superintendencia ha instruido. **Debe citarse la
   instrucción específica y su vigencia.**
3. **Simulacro.** Este procedimiento **no ha sido probado con un simulacro**. Se
   programará uno dentro de los [N] meses siguientes a la puesta en producción. Un
   procedimiento de incidentes que nunca se ha ejercitado es un documento, no una
   capacidad.

## 9. Contactos

| Rol | Nombre | Contacto |
|---|---|---|
| Responsable de protección de datos | [NOMBRE] | [CORREO] / [TELÉFONO] |
| Responsable técnico | [NOMBRE] | [CORREO] / [TELÉFONO] |
| Asesoría jurídica externa | [NOMBRE] | [CORREO] / [TELÉFONO] |
| Superintendencia de Industria y Comercio | — | [CANAL A CONFIRMAR — ver numeral 8] |

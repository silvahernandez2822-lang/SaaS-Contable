# Política de retención, conservación y supresión de datos

**Documento:** POL-RET-001
**Versión:** 1.0

> **Nota para revisión jurídica.** Los términos de conservación de este documento
> derivan de normas de orden público y **prevalecen sobre la solicitud de supresión
> del Titular** mientras estén corriendo. Esa prevalencia debe explicarse al Titular
> con la norma citada, no simplemente invocarse.

---

## 1. Norma que gobierna la conservación

**Artículo 28 de la Ley 962 de 2005:**

> "Los libros y papeles del comerciante deberán ser conservados por un período de
> diez (10) años contados a partir de la fecha del último asiento, documento o
> comprobante, pudiendo utilizar para el efecto, a elección del comerciante, su
> conservación en papel o en cualquier medio técnico, magnético o electrónico que
> garantice su reproducción exacta."

Tres consecuencias operativas que no son negociables:

1. **El plazo se cuenta desde el último asiento, documento o comprobante**, no desde
   la creación del registro ni desde el cierre del ejercicio. El reloj se reinicia con
   cada movimiento.
2. **El medio electrónico está expresamente admitido**, siempre que garantice la
   **reproducción exacta**. Es una exigencia funcional: hay que poder volver a producir
   el documento tal como fue, no una versión aproximada.
3. **No se exige residencia local.** La norma no dice dónde deben estar los datos.

Normas concordantes:

- **Artículos 48, 51, 53 y 60 del Código de Comercio**: obligación de llevar y
  conservar libros y papeles, y de que reflejen los hechos con exactitud.
- **Artículo 632 del Estatuto Tributario**, modificado por el artículo 46 de la Ley 962
  de 2005: conservación de informaciones y pruebas por el término de firmeza de la
  declaración de renta.
- **Ley 527 de 1999**, artículos 6 a 13: equivalencia funcional del mensaje de datos y
  requisitos para su conservación con valor probatorio (accesibilidad para consulta
  posterior, conservación del formato de generación, y conservación de los datos de
  origen, destino, fecha y hora).
- **Ley 1581 de 2012**, artículo 11 y artículo 2.2.2.25.2.5 del Decreto 1074 de 2015:
  el deber de supresión cede ante el deber legal de permanencia del dato.

## 2. Tabla de retención

| Categoría de información | Término | Cuenta desde | Fundamento |
|---|---|---|---|
| Asientos contables (`journal_entry`, `journal_line`) | **10 años** | Último asiento de la empresa | Ley 962/2005, art. 28 |
| Documentos soporte y XML de facturas (`source_document`) | **10 años** | Fecha del documento | Ley 962/2005, art. 28; ET art. 632 |
| Retenciones aplicadas y su trazabilidad (`retention_applied`) | **10 años** | Fecha del hecho económico | Ley 962/2005, art. 28 |
| Aprobaciones (`approval`) | **10 años** | Fecha de la aprobación | Prueba del control de aprobación humana; TYC-001 num. 7.6 |
| Parámetros tributarios y sus vigencias (`tax_rule`, `uvt_value`, y demás) | **10 años** tras el cierre de la última vigencia | Cierre de la vigencia | Necesarios para reproducir un cálculo histórico (Regla de vigencia) |
| Registro de auditoría (`audit_log`) | **10 años** | Fecha del evento | Prueba de trazabilidad; Ley 962/2005 art. 28 por conexidad |
| Datos de terceros y sus atributos fiscales | **10 años** tras el último documento que los involucre | Último documento | Ley 962/2005, art. 28 |
| Cuentas de usuario y datos de identificación | Vigencia de la relación **+ 10 años** | Terminación de la relación | Atribución de los asientos y aprobaciones históricas |
| Registro de sesiones (`user_session`, `app.session_context`) | **2 años** | Vencimiento o revocación | Seguridad e investigación de incidentes |
| Intentos de acceso fallidos (en `audit_log`) | **10 años** | Fecha del evento | Forman parte del registro de auditoría |
| Prueba de la autorización de tratamiento | Vigencia del tratamiento **+ 5 años** | Fin del tratamiento | Ley 1581/2012, art. 7 y art. 2.2.2.25.2.4 Dcto. 1074/2015 |
| Consultas y reclamos de Titulares | **5 años** | Fecha de la respuesta | Prueba de cumplimiento del art. 15 Ley 1581/2012 |
| Registro de incidentes de seguridad y su evidencia | **5 años** o hasta la firmeza de la actuación derivada, lo posterior | Cierre del incidente | Prueba en actuaciones sancionatorias |
| Contratos con clientes y proveedores | **10 años** | Terminación | Prescripción de acciones contractuales (verificar) |
| Contactos comerciales que no llegaron a ser clientes | **2 años** | Último contacto | Interés legítimo; se suprime al vencer |
| Hojas de vida de aspirantes no vinculados | **1 año** | Fin del proceso | Se suprime al vencer, salvo autorización expresa para conservarla |

**(verificar los términos marcados y añadir los que el abogado identifique; en
particular el de contratos, frente al régimen de prescripción del Código Civil y del
Código de Comercio).**

## 3. Reproducción exacta

La exigencia de reproducción exacta del artículo 28 de la Ley 962 de 2005 se satisface
con:

1. **Conservación del documento original.** El XML de la factura electrónica se
   almacena tal como se recibió, junto con su huella criptográfica (hash), de manera
   que pueda demostrarse que no fue alterado.
2. **Ledger inmutable.** Los asientos publicados no admiten modificación ni borrado, y
   la restricción la impone el motor de base de datos, no la aplicación. Toda
   corrección es un asiento de reversa que referencia al original; ambos permanecen.
3. **Parámetros versionados por vigencia.** Las tarifas y bases no se sobrescriben: se
   cierra la vigencia anterior y se abre una nueva. Un cálculo de 2025 se puede
   reproducir en 2030 con los parámetros que regían en 2025, no con los actuales.
4. **Registro de auditoría inalterable.** El `audit_log` no admite `UPDATE` ni `DELETE`
   por imposición de la base de datos.
5. **Exportación estructurada.** El cliente puede exportar en cualquier momento sus
   libros y papeles en formato estructurado y de uso común.

**Prueba pendiente.** La garantía de reproducción exacta **no ha sido verificada con
un ejercicio de restauración desde respaldo seguido de comparación**. Está en el
numeral 7 como pendiente explícito.

## 4. Supresión

### 4.1 Cuándo procede

La supresión procede cuando concurren:

1. La solicitud del Titular o la terminación de la finalidad del Tratamiento, **y**
2. El vencimiento de todos los términos de conservación aplicables al dato, **y**
3. La inexistencia de investigación, litigio o requerimiento de autoridad en curso
   sobre ese dato.

### 4.2 Bloqueo mientras corre el término legal

Cuando el Titular solicite la supresión y exista un término legal en curso, el dato se
**bloquea**: deja de usarse para toda finalidad distinta del cumplimiento de la
obligación legal, se marca como restringido, y se informa al Titular la norma que lo
impide y la fecha aproximada en que la restricción cesa.

El bloqueo **no es** un cambio cosmético. Se implementa mediante la marca de estado
del registro y la restricción del permiso de acceso, y el bloqueo mismo queda
registrado en la auditoría.

### 4.3 Procedimiento de supresión

1. Verificación de que se cumplen las tres condiciones del numeral 4.1.
2. Autorización escrita del [CARGO].
3. Supresión de los sistemas activos.
4. Supresión de las copias de respaldo conforme al ciclo del numeral 5. Mientras el
   dato subsista en un respaldo dentro del ciclo de rotación, permanece bloqueado y no
   se restaura salvo por necesidad operativa que se documenta.
5. Constancia escrita de la supresión, con fecha, alcance y responsable. La constancia
   **se conserva** aunque el dato se haya suprimido: es la prueba del cumplimiento.

### 4.4 Terminación del contrato con un cliente

Se aplica la cláusula DÉCIMA del contrato `CTR-HD-001`: treinta (30) días calendario
de disponibilidad para exportar, supresión dentro de los treinta (30) días siguientes
previa instrucción escrita del cliente, conservación bloqueada de lo que la ley obligue
a mantener, y certificación escrita.

## 5. Respaldos

| Aspecto | Definición |
|---|---|
| Frecuencia | [DEFINIR — el proveedor de base de datos administrada realiza respaldos continuos; confirmar la ventana de recuperación contratada] |
| Retención de respaldos | [DEFINIR — típicamente 7 a 30 días en el plan contratado] |
| Ubicación | [REGIÓN DEL PROVEEDOR] |
| Cifrado | En reposo, por el proveedor. Ver `SEG-001` |
| Prueba de restauración | **Pendiente.** Ver numeral 7 |

La retención de respaldos del proveedor es de días, no de años. **Los respaldos no son
el mecanismo de conservación a diez años**: ese papel lo cumple la base de datos
productiva, cuyos registros son inmutables, más la exportación estructurada. Confundir
ambas cosas es el error clásico y por eso queda escrito aquí.

## 6. Archivo histórico

Para la información que debe conservarse diez años pero que ya no es operativa, se
prevé un archivo de menor costo. **No está implementado.** Su diseño corresponde a la
ola de despliegue e infraestructura y debe cumplir tres condiciones: cifrado en reposo,
integridad verificable, y capacidad de reproducción exacta demostrada.

## 7. Pendientes declarados

| Pendiente | Estado | Responsable |
|---|---|---|
| Prueba de restauración desde respaldo con verificación de reproducción exacta | **No ejecutada** | [CARGO / agente de despliegue] |
| Definición del ciclo de respaldo y su ventana de recuperación con el proveedor | **No definida** | [CARGO] |
| Implementación del archivo histórico de bajo costo | **No implementado** | [CARGO] |
| Rutina automática de supresión al vencimiento de términos | **No implementada**; hoy la supresión es manual y bajo autorización | [CARGO] |
| Revisión anual del umbral de activos del Decreto 090 de 2018 (RNBD) | Programada al cierre de cada ejercicio | [CARGO] |

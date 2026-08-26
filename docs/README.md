# Documentación de cumplimiento y seguridad

Producida por el **Agente A12** en la Ola 0. Toda ella está redactada en español de
Colombia, con la norma citada, y **para que un abogado la revise antes de publicarse**.

Los campos entre corchetes (`[RAZÓN SOCIAL]`, `[FECHA]`, `[REGIÓN]`) deben
completarse. Los puntos marcados **(verificar)** requieren confirmación profesional
expresa y están señalados a propósito: es preferible una pregunta abierta y visible
que una afirmación jurídica inventada.

## Índice

| Código | Documento | Para qué sirve |
|---|---|---|
| `POL-HD-001` | [Política de Tratamiento de Datos Personales](politica-tratamiento-datos-personales.md) | Documento raíz de habeas data. Ley 1581 de 2012, Decreto 1377 de 2013, Decreto 1074 de 2015 |
| `AVI-HD-001` | [Aviso de Privacidad](aviso-privacidad.md) | Lo que se muestra al Titular al recolectar. Artículo 2.2.2.25.3.2 del Decreto 1074 de 2015 |
| `CTR-HD-001` | [Contrato de Transmisión de Datos Personales](contrato-encargado-tratamiento.md) | Anexo de encargo con cada firma cliente. Artículo 2.2.2.25.5.2 del Decreto 1074 de 2015 |
| `CLA-HD-001` | [Cláusulas de transferencia internacional](clausulas-transferencia-internacional.md) | Cómo se cubre el alojamiento fuera de Colombia. Artículo 26 de la Ley 1581 de 2012 |
| `TYC-001` | [Términos y Condiciones](terminos-y-condiciones.md) | Limitación de responsabilidad por cálculo tributario |
| `PRO-HD-001` | [Procedimiento de consultas y reclamos](procedimiento-consultas-y-reclamos.md) | Plazos de los artículos 14 y 15 de la Ley 1581 de 2012 |
| `PRO-INC-001` | [Procedimiento de incidentes de seguridad](procedimiento-incidentes-sic.md) | Reporte a la SIC en 15 días hábiles |
| `POL-RET-001` | [Política de retención y supresión](politica-retencion-datos.md) | Diez años, artículo 28 de la Ley 962 de 2005 |
| `SEG-001` | [Cifrado y protección de datos](cifrado-y-proteccion-de-datos.md) | Anexo técnico. Distingue **[CÓDIGO]**, **[CONFIG]** y **[PENDIENTE]** |

## Cómo leerlos

Empiece por `SEG-001` si lo que quiere saber es **qué está realmente implementado**.
Ese documento no promete: marca cada control como implementado en código, como
configuración de despliegue pendiente de hacer, o como no hecho.

Empiece por `POL-HD-001` si lo que quiere entender es el **régimen de habeas data** y
el doble rol de la plataforma: Responsable respecto de sus propios usuarios, Encargado
respecto de los datos que las firmas clientes cargan.

## Lo que deliberadamente NO está aquí

- **Registro Nacional de Bases de Datos (RNBD).** No aplica todavía: el artículo 1 del
  Decreto 090 de 2018 solo obliga a inscribirse a partir de 100.000 UVT en activos
  totales. La exención es solo registral; el resto de la Ley 1581 de 2012 se cumple
  igual. Se revisa al cierre de cada ejercicio.
- **Certificaciones ISO 27001 / SOC 2.** No están y no se persiguen en esta fase. El
  diferenciador realista hoy es demostrar controles concretos, que es lo que hace
  `SEG-001`.
- **Habilitación DIAN.** No aplica: la plataforma recibe y procesa documentos, no los
  emite ni genera eventos RADIAN.

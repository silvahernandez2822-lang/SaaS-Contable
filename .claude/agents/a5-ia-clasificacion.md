---
name: a5-ia-clasificacion
description: Implementa la extracción y clasificación asistida por LLM, y el sistema de memoria de decisiones por proveedor para evitar llamadas repetidas al modelo. Actívalo tras cerrar Ola 1 (motor de reglas y parsing ya funcionando).
model: opus
tools: Read, Write, Edit, Bash, Grep, Glob
---

Eres el Agente A5. Lee primero MEGA_PROMPT_SOFTWARE_CONTABLE_CO.md sección 8 completa, y ESTADO_PROYECTO.md.

El LLM nunca calcula (Regla de Oro 4): solo extrae/normaliza y propone concepto_id de un catálogo cerrado, con score de confianza. El motor de A3 hace el cálculo.

Implementa la tabla memoria_clasificacion con clave (company_id, tercero_id, patrón_normalizado) y el flujo completo de la sección 8.3: consulta a memoria antes de llamar al LLM, umbral de confianza configurable, cola de revisión para score bajo, y grabado de la decisión humana en memoria tras cada aprobación o corrección.

Determinismo obligatorio: temperatura mínima, prompts versionados, el mismo documento debe producir la misma propuesta las veces que se reprocese.

Al terminar, actualiza ESTADO_PROYECTO.md con el umbral de confianza elegido y la evidencia de que la segunda factura del mismo proveedor no genera llamada al LLM.

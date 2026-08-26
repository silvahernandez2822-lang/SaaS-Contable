# CLAUDE.md

## Qué es este proyecto

SaaS contable **multi-tenant para Colombia**. El corazón del producto es un motor de causación automática de facturas de compra: entra el XML de una factura electrónica DIAN, sale un asiento contable con las retenciones (retefuente, ReteIVA, ReteICA, autorretención) calculadas, trazadas y listas para aprobación humana.

Cliente objetivo: firmas contables que llevan 30–60 PYMEs. Jerarquía: `tenant` (la firma) → `company` (empresa-cliente) → datos contables.

El producto **no emite** factura electrónica ante la DIAN; solo recibe y procesa. Marco contable: NIIF para PYMES (Grupo 2). Catálogo operativo: PUC Decreto 2650 de 1993.

Stack: TypeScript + Next.js 15 (App Router), PostgreSQL con RLS, pruebas en Vitest sobre PGlite. Presupuesto duro: USD 20–50/mes.

## Dónde están las reglas de oro

**Las 7 Reglas de Oro están en la sección 2 de [MEGA_PROMPT_SOFTWARE_CONTABLE_CO.md](MEGA_PROMPT_SOFTWARE_CONTABLE_CO.md).** Son inviolables, aplican a todos los agentes en todas las olas, y cualquier entregable que las viole se rechaza y se rehace. En resumen, sin sustituir la lectura del original:

1. **Ledger inmutable y append-only.** Nada de `UPDATE`/`DELETE` sobre asientos publicados. Se corrige por reversa. El balance se impone en la BD, no en la aplicación.
2. **Cero valores tributarios en el código.** Ninguna tarifa, base, UVT, tope o calendario en el código fuente. Todo en tablas paramétricas editables desde la interfaz.
3. **Toda regla versionada por vigencia.** Se resuelve siempre por la **fecha del hecho económico**, nunca por la fecha de procesamiento. Editar inserta vigencia nueva; jamás hace `UPDATE`.
4. **La IA nunca calcula, solo propone.** El LLM extrae y sugiere concepto con un score. El motor determinista calcula.
5. **El dinero es entero.** `BIGINT` en centavos. Nunca `float`.
6. **Trazabilidad total.** Cada asiento responde: de qué documento salió, qué regla y vigencia se aplicó, qué propuso la IA con qué score, quién aprobó, cuándo y desde dónde.
7. **Aislamiento entre tenants en el motor de BD.** Row Level Security de PostgreSQL, doble nivel `tenant_id` / `company_id`. Nunca filtros de aplicación.

Otras secciones que se consultan constantemente: **6** (parametrización), **9** (motor de reglas), **12** (los 20 casos dorados), **15** (modelo de datos núcleo), **17** (advertencias — ningún agente inventa un valor tributario).

El **cómo** se ejecuta el proyecto (subagentes, olas, ritmo) está en [GUIA_EJECUCION_CLAUDE_CODE.md](GUIA_EJECUCION_CLAUDE_CODE.md).

## Todo agente lee ESTADO_PROYECTO.md antes de empezar

**Obligatorio, sin excepción: lee [ESTADO_PROYECTO.md](ESTADO_PROYECTO.md) antes de escribir una sola línea, y actualízalo antes de dar tu trabajo por terminado.**

Es el único contexto que sobrevive entre sesiones, cortes por límite de cupo y días distintos de trabajo. Contiene las olas ya cerradas, las decisiones arquitectónicas que no se deben reabrir, las convenciones que evitan que cada agente invente la suya, el estado real de los 20 casos dorados, los datos normativos pendientes de verificación humana, y el próximo paso.

Reglas de proceso que se derivan de eso:

- **Compuerta de QA obligatoria.** Ningún módulo se declara terminado, ni se actualiza `ESTADO_PROYECTO.md` como cerrado, ni se comitea, sin que `a14-qa-adversarial` haya verificado. A14 no confirma nada por reporte ajeno: lo verifica él mismo.
- **Un módulo se cierra completo o no se cierra.** Nunca se corta un módulo a la mitad por falta de cupo: se espera y se retoma desde `ESTADO_PROYECTO.md`.
- **Si un dato normativo no se puede verificar, no se inventa.** Se deja la fila vacía y se registra en "Pendiente de verificación normativa humana". Un valor inventado en un motor tributario es peor que uno faltante: el faltante se ve, el inventado no.

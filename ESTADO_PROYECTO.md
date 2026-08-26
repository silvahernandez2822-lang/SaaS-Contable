# ESTADO_PROYECTO.md

> Memoria única entre sesiones. Todo agente lo lee al empezar y lo actualiza al terminar.
> Última actualización: 2026-08-26 — A0 (orquestador), antes de despachar Ola 0.

## Olas cerradas

(vacío al inicio — cada ola se agrega aquí solo cuando pasó su compuerta de aceptación completa, con el commit de cierre)

| Ola | Agentes | Compuerta | Commit de cierre | Fecha |
|---|---|---|---|---|
| — | — | — | — | — |

**En curso:** Ola 0 (A2 + A12), despachada por A0.

---

## Decisiones arquitectónicas no obvias

### D-001 — Lenguaje y framework único: TypeScript + Next.js 15 (App Router)
**Decidido:** todo el producto (backend de dominio, API y frontend SSR) en TypeScript sobre Next.js 15 App Router, Node 24.
**Alternativas descartadas:** (a) Python/FastAPI + frontend separado — obliga a un desarrollador solo a mantener dos ecosistemas y dos pipelines de despliegue; (b) backend Node separado del frontend — duplica despliegue y rompe la restricción de USD 20/mes.
**Por qué:** sección 5 exige framework único y mismo lenguaje en front y back para evitar cambio de contexto con 1 desarrollador.

### D-002 — Migraciones en SQL plano, no ORM
**Decidido:** el esquema vive en archivos `db/migrations/NNN_nombre.sql` numerados, aplicados en orden por un runner propio. No hay ORM que genere DDL.
**Alternativas descartadas:** Prisma (no modela RLS, políticas ni triggers de constraint; su `migrate` pelea con DDL manual), Drizzle (mejor, pero igual requiere SQL crudo para RLS y triggers, añadiendo una capa sin ganancia).
**Por qué:** las Reglas de Oro 1 y 7 se imponen con `POLICY`, `FORCE ROW LEVEL SECURITY`, triggers y constraint triggers deferidos. Todo eso es SQL que ningún ORM expresa bien. El acceso a datos en runtime sí usa un driver tipado (`postgres.js`), pero el DDL es SQL explícito y revisable.

### D-003 — Postgres real y offline para pruebas: PGlite
**Decidido:** la suite de pruebas corre contra **PGlite** (`@electric-sql/pglite`), que es PostgreSQL 18.3 compilado a WASM, en proceso, sin servidor. Las mismas migraciones `.sql` se aplican a PGlite (test) y a Postgres gestionado (producción: Supabase/Neon).

**Verificado empíricamente antes de decidir** (spike de A0, 2026-08-26) — sobre PGlite 0.5.7 / PostgreSQL 18.3:
- RLS se **aplica de verdad** si la sesión hace `SET ROLE app_user` (rol no superusuario) y la tabla tiene `FORCE ROW LEVEL SECURITY`. Confirmado: 2 filas de 2 tenants distintos → 1 visible.
- Trigger `BEFORE UPDATE OR DELETE` que lanza excepción sobre asiento `posted` → bloquea la mutación. Confirmado.
- `CREATE CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED` → rechaza asiento desbalanceado **en el COMMIT**, a nivel de BD. Confirmado.

**Alternativas descartadas:** Docker + Postgres (el demonio de Docker Desktop no está corriendo en esta máquina y no hay `psql` local — dependería de intervención manual en cada sesión); SQLite (no tiene RLS: haría imposible probar la Regla de Oro 7); mockear la BD (probaría el mock, no la garantía real).

**Consecuencia obligatoria para todos los agentes:** ninguna prueba de integridad puede depender de lógica de aplicación. Si la garantía no la impone la BD, no cuenta como pasada.

**Escotilla:** si `DATABASE_URL` está definida, el harness de pruebas usa ese Postgres real en vez de PGlite, sin cambiar una línea de las pruebas.

### D-004 — El aislamiento se prueba como usuario sin privilegios
**Decidido:** la aplicación **nunca** se conecta como superusuario ni como dueño de las tablas. Se conecta con el rol `app_user`, y el contexto va por `set_config('app.tenant_id', ...)` / `set_config('app.company_id', ...)` dentro de la transacción.
**Por qué:** un superusuario ignora RLS silenciosamente. Probar RLS desde una sesión superusuario da un falso PASS, que es el peor resultado posible para la Regla de Oro 7.

### D-005 — El dinero es BIGINT en centavos
**Decidido:** todo monto es `BIGINT` en centavos de COP. Las tarifas son `NUMERIC(9,6)` como fracción, no porcentaje (2,5% = 0.025000). Prohibido `float`, `double`, `real` y `money`.
**Por qué:** Regla de Oro 5. `NUMERIC` para tarifas porque una tarifa por mil (‰) de ICA necesita precisión decimal exacta; `BIGINT` para importes porque el redondeo debe ser explícito y parametrizado, nunca un artefacto del tipo de dato.

### D-006 — Nombres de tablas: los de la sección 15, literales
**Decidido:** se usan exactamente los nombres de la sección 15 del mega-prompt, con su mezcla de inglés y español (`journal_entry`, `third_party`, `tax_rule`, `concepto_causacion`, `memoria_clasificacion`).
**Por qué:** evita que 15 agentes traduzcan cada uno a su gusto. La sección 15 es el contrato; no se "mejora".

---

## Convenciones establecidas

**Estructura de carpetas**

```
db/migrations/NNN_nombre.sql   Migraciones SQL numeradas, inmutables una vez aplicadas
db/seeds/                      Datos paramétricos (A1). Datos, nunca código
src/domain/                    Motor de reglas, tipos de dominio. Sin I/O
src/services/                  Casos de uso y transacciones (A6)
src/ingest/                    Correo + parser UBL 2.1 (A4)
src/ai/                        Clasificación LLM + memoria (A5)
src/reports/                   Libros, Excel, estados financieros, exógena (A9/A10/A11)
src/db/                        Cliente, runner de migraciones, contexto de tenant
app/                           Next.js App Router: UI y route handlers
tests/                         Vitest. tests/golden/ = los 20 casos dorados
docs/                          Cumplimiento, ADRs, contratos de API
```

**Reglas de código**

- Idioma: identificadores de dominio en español donde el mega-prompt los nombra en español; el resto en inglés. Comentarios y UI en español (Colombia).
- SQL en snake_case. TypeScript en camelCase, tipos en PascalCase.
- Toda tabla de datos: `tenant_id` NOT NULL + `company_id` NOT NULL (salvo catálogos globales, que se declaran explícitamente como globales), RLS habilitado **y forzado**.
- Toda tabla paramétrica: `vigente_desde DATE NOT NULL`, `vigente_hasta DATE NULL`, `norma_respaldo TEXT NOT NULL`.
- Prohibido: literales numéricos tributarios en `src/` y `app/`. A14 hace grep. La única constante permitida es la lógica de resolución.
- Migraciones ya aplicadas no se editan: se agrega una nueva.

**Comandos**

- `npm test` — suite completa (Vitest + PGlite)
- `npm run test:gates` — solo compuertas de aceptación por ola
- `npm run migrate` — aplica migraciones pendientes

---

## Casos dorados — estado actual

Los 20 casos de la sección 12 del mega-prompt. Estado: `no implementado` hasta que A3/A14 los codifiquen en `tests/golden/`.

| # | Escenario | Estado |
|---|---|---|
| 1 | Servicio $1.000.000 + IVA, PJ declarante, Bogotá | no implementado |
| 2 | Mismo servicio, PN no declarante → 6% | no implementado |
| 3 | Servicio $80.000 bajo 2 UVT → no retiene | no implementado |
| 4 | Compra $500.000 bajo 10 UVT → no retiene | no implementado |
| 5 | Compra $600.000 a declarante → 2,5% | no implementado |
| 6 | Honorarios PJ $200.000 → 11% desde $0 | no implementado |
| 7 | Arrendamiento inmueble vs. mueble | no implementado |
| 8 | Servicio en Medellín → ReteICA 2‰ general | no implementado |
| 9 | Servicio en Cali → base 3 UVT, tarifa de actividad | no implementado |
| 10 | Actividad principal Bogotá, operación en Cali | no implementado |
| 11 | Vigilancia con AIU → base es el AIU | no implementado |
| 12 | Proveedor del exterior → ReteIVA 100% | no implementado |
| 13 | Proveedor régimen SIMPLE | no implementado |
| 14 | Factura con 3 conceptos distintos | no implementado |
| 15 | Nota crédito → reversa proporcional sin mutar original | no implementado |
| 16 | Factura 15-jun-2026 procesada 20-jul-2026 → vigencia de junio | no implementado |
| 17 | Cambio de tarifa con vigencia futura → no retroactivo | no implementado |
| 18 | Reprocesar 10 veces → asiento idéntico | no implementado |
| 19 | Segunda factura mismo proveedor → cero llamadas al LLM | no implementado |
| 20 | Tenant A consulta tenant B → cero filas | no implementado |

**Pruebas adicionales de integridad (sección 12, final):**

| Prueba | Estado |
|---|---|
| Grep de literales tributarios en código → cero | no implementado |
| UPDATE/DELETE sobre asiento publicado → falla en BD | no implementado |
| Asiento desbalanceado → falla en BD | no implementado |
| Balance de prueba vs. ledger con 10.000 asientos → cuadra al centavo | no implementado |
| Carga: 5.000 facturas en cola sin degradar el request HTTP | no implementado |

---

## Pendiente de verificación normativa humana

Ningún dato cargado todavía (A1 no ha corrido). Ya se sabe, por las advertencias de la sección 17, que quedarán marcados como pendientes:

| Dato | Motivo | Estado |
|---|---|---|
| ReteICA Bucaramanga (bases ~25/~50 UVT) | Marcado *(verificar)* en sección 7.5 | pendiente |
| ReteICA Cartagena (bases por actividad) | Marcado *(verificar)* en sección 7.5 | pendiente |
| Tabla completa de autorretención por CIIU | Sección 7.3 da 4 valores de ejemplo, no la tabla | pendiente |
| Tarifas Decreto 572 de 2025 | En etapa cautelar; fallo de fondo abierto (exp. 30229) | vigente, con riesgo documentado |

---

## Presupuesto

Sin reporte de A15 todavía. Techo: USD 20/mes (fase inicial) → USD 50/mes (con clientes).
Referencia de costo de IA: USD 0,01–0,02 por factura antes de caché.

---

## Próximo paso

**Ola 0 — A2 (modelo de datos y ledger), luego A12 (seguridad), secuencial.**

Nada más arranca hasta que A14 confirme las cuatro pruebas de la compuerta de Ola 0:

1. `UPDATE` sobre `journal_entry` publicado falla **en la BD**.
2. Asiento desbalanceado rechazado **por la BD**.
3. Consulta sin filtro de tenant devuelve **cero** filas de otro tenant, con RLS activo.
4. Insertar vigencia nueva no altera la anterior; consulta con fecha pasada resuelve la regla vigente entonces.

# ESTADO_PROYECTO.md

> Memoria única entre sesiones. Todo agente lo lee al empezar y lo actualiza al terminar.
> Última actualización: 2026-09-04 — **A14 cierra la COMPUERTA AMPLIADA de D-089: PASA con
> correcciones, hechas por A14 en la misma pasada.** El módulo PUC queda verificado con arsenal
> propio, atacando la base por SQL directo desde una sesión de negocio real: la partida contra una
> cuenta agrupadora muere en el `INSERT` del borrador (`LG004`) y contra una inactiva con `LG009`; la
> puerta de la reversa **no** deja colar una agrupadora que el original no tenía; `PU001..PU005` se
> sostienen incluso desde el superusuario; el catálogo del PUC no tiene huérfanos y `2365` quedó
> consistente entre seed y migración 180; y **los 20 casos dorados no movieron ni un centavo** — solo
> cambia el `account_id` del crédito de retefuente (`2365` → `236x`), y la aserción del caso 14 se
> volvió **más** exigente. **Cuatro vulnerabilidades**, tres corregidas por A14: **V-47 (alta)** —
> cualquier firma podía **borrar el catálogo global** (`DELETE FROM account WHERE tenant_id IS NULL`
> dejaba el PUC compartido en **cero filas**) y **apropiarse** de sus filas, por un hueco de la
> política RLS híbrida de la Ola 0 que alcanzaba también a UVT, municipios, CIIU, `tax_rule` futuras y
> `role_permission`; cerrada con la migración **181** (`CT001`) sobre las 18 tablas híbridas —,
> **V-48** (el barrido de seeds excluía un directorio que el cargador sí aplica), **V-49** (bases
> mínimas de 4 y 27 UVT quemadas en la plantilla de carga masiva de ICA, el patrón de V-45) y
> **V-50** (declarada, de **A3**: la red de D-089 no cubre la nota crédito). Además se corrigió una
> **prueba intermitente** de D-089 que hacía fallar la suite ~4 de cada 10 veces (el encargo decía
> 1293/1293; A14 midió 1292/1293). Estado: **`tsc` limpio · `npx vitest run` 1345/1345 en verde, 70
> archivos**. Migraciones **179/180/181** y seeds sin aplicar a la Neon. **Sin comitear** (A14 no
> comitea). Falta la verificación en navegador real. Ver «Compuerta AMPLIADA de D-089 — veredicto de
> A14». Historial:
> 2026-09-04 — **A3 cierra el MOTOR de D-089: las 18 reglas de retefuente dejan
> de apuntar a la agrupadora `2365` y apuntan a su subcuenta 236x por concepto** (seeds `tanda1/050` y
> `tanda2/070` corregidos; migración **180** repara la base ya sembrada cerrando vigencia vieja y
> abriendo la gemela — nunca `UPDATE` de `account_id`, lo prohíbe `PR001`; el pasado se sigue
> resolviendo contra `2365`, sección 9.2). El motor manda a revisión manual con motivo legible
> (`regla_con_cuenta_no_imputable`) toda regla/concepto cuya cuenta destino no sea imputable, antes de
> escribir. Prueba diferencial: reapuntar **no mueve ni un centavo**. A3 se cortó por cupo antes de la
> suite completa y de escribir su ficha; el orquestador corrió la suite: **`tsc` limpio · `npx vitest
> run` 1293/1293 en verde, 68 archivos**. Sin comitear. **Falta la compuerta de A14 (ampliada) y la
> verificación en navegador real.** Ver «D-089 — MOTOR / REGLAS (A3)». Historial:
> 2026-09-04 — **A9 entrega la REPORTERÍA de D-089 (TAREA 5): exportación del
> PUC efectivo a Excel.** `src/reports/puc-efectivo.ts` → `generarLibroPucEfectivo(tx)`: libro con las
> cuatro hojas de la sección 11.2 — **Datos** (una fila por cuenta de `v_account_efectivo`: código,
> nombre, nivel, naturaleza, imputable, estado, alcance genérica/firma/propia, ¿en uso?, nº conceptos
> que la usan, partidas en el ledger, clasificación NIIF vigente + sección/rubros/norma/vigencia),
> **Papel de trabajo** (encabezado empresa/NIT/responsable + totales del `resumenPuc` + modo del PUC),
> **Trazabilidad** (mapeo NIIF y su vigencia por cuenta, «cuando aplique»), **Parámetros** (modo del
> PUC, fecha de resolución de la precedencia, desglose del resumen). `GET /api/parametros/puc/exportar`
> deja de ser 501: descarga `puc_<AAAA-MM-DD>.xlsx`, seguridad idéntica a `/api/terceros/exportar`
> (empresa solo de `conSesion`, 401 sin sesión, 403 sin `parametro.puc.leer`). Reusa `resumenPuc` /
> `obtenerModoPuc` de `src/services/puc.ts`; consulta `v_account_efectivo` directo (el LIMIT 2000 de
> `listarPucEfectivo` no cubre un PUC completo). Sin valores tributarios (RO 2). `tsc` sin errores
> nuevos (el de `a14-d088-ampliada` es de A3 en paralelo). **5 pruebas nuevas** en
> `tests/reports/puc-efectivo.test.ts` (4 hojas, encabezado, filas = `v_account_efectivo`, aislamiento
> A↔B, 403 sin permiso); 0 regresiones (`tests/reports/` 90 + `puc-d089` 8, verdes). Sin comitear. Ver
> «D-089 — REPORTERÍA (A9)». Historial:
> 2026-09-04 — **A8 entrega la INTERFAZ de D-089 (Módulo PUC), TAREAS 4 y 5.**
> `src/services/puc.ts`: `usoDeCuenta`/`usoDeCuentas` (envuelven `app.cuenta_uso`),
> `conceptosQueUsanCuenta`/`conceptosQueUsanCuentas` (qué `concepto_causacion` usan una cuenta y en
> qué rol — gasto / IVA descontable / contrapartida —, consulta bajo RLS), y `simularImpactoCambioCuenta`
> (predice PU002..PU005 con el mismo criterio que el trigger, ANTES de escribir). `/parametros/puc`:
> columna «En uso» con badge (nº conceptos + partidas) por fila y modal genérico D-087 «Ver uso» con
> el listado de conceptos; **simulador de impacto bloqueante** al editar una cuenta en uso — si el
> motor va a rechazar (PU00x) se muestra el impacto y **no hay botón de guardar** (sin «forzar»), si
> el cambio es permitido pero sensible (inactivar cuenta con movimientos) exige confirmación
> explícita. `acciones.ts` traduce `PU001..PU005` y `LG009` a mensajes claros. **TAREA 5**: botón
> «Exportar PUC a Excel» → `GET /api/parametros/puc/exportar` (stub **501**, seguridad igual a
> `/api/terceros/exportar`: empresa solo de `conSesion`, 401/403; generador pendiente de **A9**).
> `tsc` sin errores nuevos (los 3 de `golden/`+`adversarial/` son de A1/A3 en paralelo, no de A8).
> **8 pruebas nuevas** en `tests/services/puc-d089.test.ts`; 0 regresiones (parametrización 29,
> gate PUC 21, carga masiva 42, todas verdes). Sin comitear. Ver «D-089 — INTERFAZ (A8)». Historial:
> 2026-09-04 — **A2 entrega el MODELO DE DATOS de D-089 (Módulo PUC):
> migración 179, tres agujeros de integridad cerrados EN EL MOTOR.** No se creó ni una tabla ni una
> columna: `account` y `v_account_efectivo` ya estaban. (1) **`LG004` pasa de la publicación al
> `INSERT` de `journal_line`**: una partida contra una cuenta agrupadora ya no llega a la bandeja
> para que un humano la apruebe, muere al crearse el borrador; y **`LG009` nuevo** para la cuenta
> inactiva. La **reversa** conserva puerta acotada (puede reproducir una cuenta del asiento que
> corrige, para que un error del pasado no quede incorregible — RO 1). (2) **`account_restrict_uso`**
> (patrón `TP001` de D-084): con movimientos no se borra (`PU001`), no cambia de naturaleza
> (`PU002`), no se vuelve agrupadora (`PU003`) y no se renumera (`PU004`); con conceptos de causación
> activos no se retira ni se desimputa (`PU005`). **Inactivarla sí se permite**: es el camino
> previsto. (3) **`app.cuenta_uso`/`cuenta_tiene_movimientos`/`cuenta_conceptos_activos`** para que
> la interfaz use el **mismo criterio exacto** que el motor; **no** se creó `v_account_uso` y el
> listado «qué conceptos usan esta cuenta» queda como consulta bajo RLS para **A8**. **Destapó un
> defecto de DATOS real** (no de A2): las 12 `tax_rule` de retefuente apuntan a `2365`, que el seed
> nuevo del PUC completo vuelve —correctamente— no imputable; arreglo de **A1/A3**. `tsc` limpio ·
> **21 pruebas nuevas en verde**, 0 regresiones atribuibles a 179. Sin comitear, 179 sin aplicar a la
> Neon. Ver «D-089 — Módulo PUC / Plan de cuentas: MODELO DE DATOS». Historial:
> 2026-09-03 — **COMPUERTA AMPLIADA DE D-088: A14 verifica con arsenal propio
> y el veredicto es PASA con correcciones, hechas por A14 en la misma pasada.** Tres archivos de
> prueba nuevos (`a14-d088-ampliada.test.ts` 26, `a14-d088-carga-masiva.test.ts` 13,
> `a14-d088-flujo-bloqueante.test.ts` 5 = **44 pruebas**). Cuatro defectos encontrados y **corregidos
> por A14**: **V-43** el guard `gravada`/tarifa de `editarTarifaTaxRule` no miraba el flag HEREDADO;
> **V-44** la carga masiva tomaba la celda «Gravada» EN BLANCO por «no gravada» (apagaba la retención
> de una actividad en silencio) y admitía «Por periodo» sin ventana; **V-45** la plantilla descargable
> venía con el municipio y las bases mínimas en UVT **precargados en las celdas que el parser lee como
> configuración real** (valor tributario en el código, RO2, y carga accidental del ejemplo); **V-46**
> el lector de encabezado tomaba la **etiqueta siguiente** como valor cuando la celda estaba vacía.
> Verificado además con el **archivo real de 551 filas**: 451 entran, 100 salen informadas, y tal cual
> viene **no carga nada** porque dice «Bogotá» y el catálogo DANE dice «Bogotá, D.C.» (correcto: no se
> adivina; y V-5 sigue protegida). Los **20 casos dorados** reejecutados uno por uno: **todos en
> verde**. `tsc` limpio · `next build` OK · `npm test` **1242 en verde, 63 archivos** (base D-088/A8 =
> 1198/60). **Sin comitear. Falta la verificación en navegador real (paso del usuario) y aplicar 177 y
> 178 a la Neon.** Ver «Compuerta AMPLIADA de D-088». Historial:
> 2026-09-03 — **A8 entrega la INTERFAZ, la CARGA MASIVA y el PERMISO de D-088
> (ICA por municipio).** Pantalla `/parametros/ica-municipios`: selector de municipio y tres bloques
> editables (bases mínimas + `tipo_medicion_base_minima` + `periodo_meses`; tabla de actividades
> gravadas buscable y editable fila por fila; alta de actividad), cada uno con el **simulador de
> impacto bloqueante de D-087 reutilizado** (dos pasos + testigo V-39 + «Ver detalle»). **Guard
> gravada/tarifa** en la UI y en `editarTarifaTaxRule` / `crearOReemplazarTaxRule` (rechazo antes del
> viaje; el CHECK `tax_rule_gravada_ck` sigue siendo la garantía real). **Carga masiva** de un
> municipio completo con parser bespoke (`src/services/carga-masiva/ica-municipio.ts`): zero-pad de
> códigos a 4 dígitos, las subclases de 5 dígitos del Distrito salen como fila con error (no se
> inventan, no se callan, las buenas se cargan); fecha de vigencia + norma de respaldo se piden en el
> formulario, no en el archivo. Plantilla en `GET /api/plantillas/ica_municipio_d088`. **Permiso**
> propio: migración **178**, `parametro.ica.{leer,editar}`, nivel firma, verificado con A2 que la RLS
> híbrida deja al administrador de firma editar parámetros compartidos. `tsc` limpio, `next build` OK,
> `npm test` **1198/60** (+5 pruebas, 0 regresiones). Falta la compuerta de A14 y la verificación en
> navegador. Sin comitear. Ver «D-088 — INTERFAZ, CARGA MASIVA y PERMISOS». Historial:
> 2026-09-03 — **A3 entrega el MOTOR de D-088 (ICA por municipio) sobre el
> modelo de A2.** Dos conductas nuevas y ninguna regresión: (1) `tax_rule.gravada = false` → el motor
> NO practica ReteICA sin importar la tarifa, y lo deja escrito como evaluación con `aplicada=false`
> (no como revisión manual: no hay nada que un humano decida); `true` y `NULL` —toda regla anterior a
> D-088— no cambian ni un centavo. (2) `tipo_medicion_base_minima = 'por_periodo'` → la base mínima
> se compara contra el ACUMULADO del tercero en el municipio en la ventana del periodo, con
> `reteica_periodo_acumulado` como estado derivado. **El motor no escribe**: devuelve
> `ResultadoResolucion.acumuladosIca` y los aplica `aplicarAcumuladosIca` desde `causarFactura`,
> en la misma transacción y **solo después de que el asiento queda escrito** (dry-run y revisión
> manual leen y no mueven nada). **DOS ASUNCIONES DECLARADAS, pendientes de confirmación del cliente
> final** (no son bugs ni TODO): anclaje de la ventana al **año calendario** y retención **solo hacia
> adelante** al cruzar el umbral a mitad de periodo. `tsc` limpio, `npm test` **1193 en verde (58
> archivos)** — +16 pruebas nuevas, **0 regresiones**; los **20 casos dorados pasan**, incluidos el
> 16, el 17 y el 18. Falta interfaz, carga masiva y la compuerta de A14. Sin comitear. Ver «D-088 —
> MOTOR». Historial:
> 2026-09-03 — **A2 entrega el MODELO DE DATOS de D-088 (ICA por municipio):
> migración `177_a2_d088_ica_municipio_modelo.sql`.** Se EXTIENDE el modelo existente, no se crean
> tablas paralelas: `municipality_ica_rule` gana `tipo_medicion_base_minima` (por factura / por
> periodo) y `periodo_meses` con CHECK cruzado; `tax_rule` gana el flag explícito `gravada` con
> guarda `gravada IS NOT FALSE OR tarifa = 0`; y nace `reteica_periodo_acumulado`, estado derivado
> recalculable (no ledger: admite UPDATE) con RLS de doble nivel y FK compuestas de alcance.
> `ciiu_activity` no se tocó. Cero valores tributarios en la migración. `tsc` limpio, `npm test`
> **1177 en verde (57 archivos)**, la misma cifra que antes: ninguna prueba existente se rompió.
> Motor, interfaz y carga masiva de D-088 **no** están hechos, y falta la compuerta de A14. Sin
> comitear. Ver «D-088». Historial:
> 2026-09-03 — **COMPUERTA AMPLIADA DE D-087: A14 verifica con suite propia
> (`a14-d087-ampliada.test.ts`, 44 pruebas) y da PASA CON CORRECCIONES.** Cuatro defectos reales
> encontrados y corregidos por A14 en la misma pasada: **V-39** el flujo de dos pasos no bloqueaba
> nada (POST directo al paso 2 abría la vigencia en las tres pantallas → ahora hay testigo del paso 1);
> **V-40** el conteo del simulador se pintaba del query string mientras el «Ver detalle» de al lado se
> medía contra la base — podían contradecirse; **V-41** el detalle se pedía con el `taxConceptId` de la
> URL, no con el de la regla que se editaba; **V-42** el banner de alertas renderizaba **1.122 badges**
> (uno por municipio del catálogo DANE de D-086) — 984 KB de HTML que sepultaban las cuatro alertas
> accionables. **Verificación en navegador real HECHA:** migraciones **175 y 176 aplicadas a la Neon**
> (estaba en la 174, sin conflicto de checksum), `npm run seed` corrido, las cinco pantallas de
> `/parametros` recorridas con sesión real; el simulador muestra cifras reales antes de guardar e
> ignora las falseadas en la URL. Los **20 casos dorados** reejecutados completos: todos PASA.
> `tsc` limpio, `next build` exit 0 (37 rutas), `npm test` **1177 en verde (57 archivos)**. Sin
> comitear. Queda **V-42-bis bloqueado para A1+A8** (qué municipio debe tener regla de ReteICA ahora
> que el catálogo es nacional) y la verificación **client-side** con navegador gráfico. Ver «Compuerta
> AMPLIADA de D-087». Historial:
> 2026-09-03 — **A8 entrega D-087 (Fase 4 de Parámetros tributarios): `/parametros`
> migrado al kit y fuera de `PREFIJOS_SIN_MIGRAR`, `Modal` genérico en `app/_ui/`, badges de alerta
> clicables, permiso por submódulo (migración 176) y simulador de impacto bloqueante con detalle real
> en todas las pantallas de cambio. `tsc` limpio, `next build` exit 0, `npm test` 1115 en verde.
> Navegador real y compuerta de A14: pendientes.**
> 2026-09-01 — **A16 entrega la OLA 4, «Operación real»: navegación compartida,
> carga masiva de quince catálogos con plantillas de Excel, PUC genérico + PUC propio por empresa,
> ReteICA en cascada por municipio, los tres motivos separados por los que un reporte no sale, y el
> módulo de administración de usuarios, roles y permisos con el rol todopoderoso blindado en el motor.
> Once decisiones nuevas (D-063 … D-073) y la migración `170_a16_ola4_operacion_real.sql`. Suite:
> **993 en verde** (48 archivos), typecheck limpio, `next build` exit 0 con 28 rutas.
> **PENDIENTE: la compuerta de A14.** Ver «Ola 4 — qué entregó A16».
>
> 2026-09-01, después de eso — **capa de diseño: los tokens, antes que las pantallas (D-074).** La paleta
> y la tipografía aprobadas quedan escritas una sola vez en `app/globals.css` (Tailwind v4, `@theme
> static`) e importadas una sola vez en el layout raíz, con modo oscuro, Inter servida desde el propio
> dominio y cifras tabulares. **No se construyó ni se migró ninguna pantalla**: solo los tokens. Dos
> valores del modo oscuro quedan DERIVADOS y declarados como no aprobados. Typecheck limpio, `next build`
> exit 0 con las mismas 28 rutas. Sin compuerta de A14, como el resto de la Ola 4.
>
> 2026-09-01, después de eso — **sistema de interfaz, prototipo y tercer token derivado (D-075).**
> `--color-primario-tinta-oscura: #5B8DBE` cierra el «pendiente» de D-074 (azul aclarado para tinta sobre
> oscuro). Prototipo navegable de las 8 pantallas en `app/diseno/**` (Next 16 + Tailwind v4 + TS strict),
> Dirección A «Consola de operación», con navegación global (selector de empresa, lateral de 6 módulos,
> breadcrumb, toggle de densidad) y el componente reusable de carga masiva. **No toca ninguna ruta ni
> servicio real** — vive aparte con datos de maqueta; migrar las pantallas canónicas contra este lenguaje
> es la siguiente ola de front. Valores tributarios como marcadores `[tarifa]` (Regla de Oro 2, sin
> exención en el detector). `tsc` limpio, `next build` exit 0 con 38 rutas, `npm test` 993 en verde. Sin
> comitear: pendiente de que el usuario lo pruebe con `npm run dev`.
>
> 2026-09-01, después de eso — **MIGRACIÓN del sistema de interfaz a las rutas reales: MÓDULO 0 (base +
> shell) y MÓDULO 1 (bandeja) (D-077).** El kit compartido pasa a `app/_ui/` como canónico y se conecta a
> los servicios reales: `EmpresaProvider` con `listarEmpresasAccesibles`, `CargaMasiva` con
> `cargarArchivoAction` (el importador real, cero simulación), shell en el layout raíz con sesión de firma,
> selector de empresa a `cambiarEmpresaActivaAction`. `app/_navegacion.tsx` eliminado (lo reemplaza el
> shell). Migradas: `/entrar`, `/cambiar-password`, `/bandeja` — sin tocar una acción de servidor, un
> permiso ni una aserción de la suite. `tsc` limpio, `next build` exit 0 (38 rutas), `npm test` **993 en
> verde**. **Corte declarado:** faltan los módulos 2–6 (terceros, parámetros, PUC, reportes, admin), cada
> uno con sus rutas listadas en D-077. `app/diseno/**` NO se borra hasta migrar todo. Sin comitear:
> pendiente de `npm run dev`. **Próximo paso:** módulo 2 (terceros) desde D-077.
>
> 2026-09-02, después de eso — **Fase 1 (ajustada) de la ola de refinamiento de interfaz: bug de contraste
> de fondo, tabla con encabezado y primera columna fijos, Inicio como panel real, logo (D-078).** Corrige
> el texto invisible en las rutas que D-077 dejó con «su cuerpo viejo» (terceros, parámetros, PUC,
> reportes, admin, carga masiva), añade encabezado y primera columna fijos al componente `Tabla` de
> `app/_ui/componentes.tsx`, rediseña `/` como panel real con datos reales, y decide (sin poder aplicar) el
> logo. `tsc` limpio, `npm test` **993 en verde** (48 archivos). `next build` **no se pudo verificar en
> este entorno** — ver el punto 5. `app/diseno/**` sigue intacto, sin tocar. **Próximo paso:** módulo 2
> (terceros) desde D-077 — esta fase no migra ningún módulo, solo corrige el fondo y prepara el terreno.
> Ver «D-078» para el detalle completo.
>
> 2026-09-02, después de eso — **Fase 2 de la ola de refinamiento de interfaz: funcionalidad real de
> `/bandeja` (D-079).** Auditoría previa primero: la **aprobación en lote ya existía y funciona** (solo se
> pulió la UX); se construyó lo que faltaba — **filtros** (fecha → a la consulta; proveedor/monto/score →
> sobre el consolidado), **edición de cuenta y monto de línea del asiento borrador** con descuadre en vivo
> y justificación obligatoria en `audit_log` (`editarAsientoBorrador` + `app.registrar_edicion_asiento_borrador`),
> **sub-bandeja de rechazadas** con archivar (`estado='archivado'`, la fila permanece) y reprocesar
> acotado, y **visor del XML original** formateado. Migración `171_a7_d079_bandeja_fase2.sql` (tres
> funciones, ninguna `SECURITY DEFINER`). **Diferido a una ola futura con A3:** la reintegración de una
> rechazada que ya tuvo asiento causado y anulado (conflicto de `idempotency_key` + falta la transición
> `rechazado → parseado` en `causarFactura`); hoy se bloquea con `REPROCESO_BLOQUEADO`. `tsc` limpio,
> `next build` **exit 0, 40 rutas** (el fallo de PGlite de D-078 era del entorno de nube, no se reproduce
> en local), `npm test` **1003 en verde** (49 archivos). Sin comitear: pendiente de `npm run dev`.
> ~~Pendiente: compuerta ampliada de A14.~~ Ver «D-079» para el detalle y la auditoría completa.
>
> 2026-09-02, después de eso — **COMPUERTA AMPLIADA DE D-079 (QA adversarial + arquitecto + product
> owner). Veredicto de A14: PASA, con SIETE defectos encontrados y CORREGIDOS por A14 en la misma
> pasada, y V-23 declarada abierta.** A14 no le creyó al reporte: escribió su propia suite
> (`tests/adversarial/a14-d079-ampliada.test.ts`, 14 pruebas) contra lo que la compuerta de A7 no
> intentó. Lo grave que apareció: **se podía mutar un asiento YA PUBLICADO** por una carrera entre la
> edición y la aprobación (faltaba `FOR UPDATE`, Regla de Oro 1); **un humano podía reescribir el monto
> de una retención calculada por el motor**, haciendo divergir para siempre el ledger de
> `retention_applied` —que es la fuente de la exógena y de los certificados— sin que nada lo dijera
> (Reglas de Oro 4 y 6); y el **filtro de monto escondía facturas que sí había que aprobar** porque el
> formulario pide pesos y comparaba contra centavos. También: una fecha inválida en la URL tumbaba la
> bandeja entera, una cuenta desactivada seguía siendo imputable, la interfaz prometía un
> «desarchivar» que no existe y el bloqueo de reproceso aconsejaba una salida —«vuelva a cargar el
> XML»— que A14 probó y **no funciona**. Todo corregido con prueba de regresión. **V-23, ABIERTA (A3 +
> A2): una factura rechazada por error no se recupera por ningún camino de la interfaz** — no bloquea
> D-079, sí bloquea la operación real con un cliente. Suite: **1017 en verde** (50 archivos),
> typecheck limpio, `next build` exit 0 (40 rutas). Sin comitear.
>
> 2026-09-02, después de eso — **D-080: fix de resolución DNS IPv4-primero en cada proceso Node.**
> Módulo compartido de efecto secundario `src/db/dns-fix.ts` (`dns.setDefaultResultOrder('ipv4first')`,
> vía `import('node:dns')` dinámico y con `catch` para el edge runtime), importado como primera línea
> de los cinco puntos de entrada Node independientes: `instrumentation.ts`, `src/db/migrate-cli.ts`,
> `src/db/seed-cli.ts`, `src/bootstrap/arranque-cli.ts`, `src/bootstrap/datos-ejemplo-cli.ts`. Motivo:
> en Windows Node puede resolver el host de Neon por IPv6 antes que IPv4 y fallar con `ENOTFOUND`
> aunque el SO y el navegador resuelvan bien. `tsc` limpio, `next build` exit 0 (40 rutas), `npm test`
> **1017 en verde** (50 archivos). Sin comitear. Ver «D-080».
>
> 2026-09-02, después de eso — **D-081: V-23 CERRADA — una factura rechazada por error se recupera
> (A3 + A2).** El asiento anulado tras el rechazo conservaba `idempotency_key = 'causacion:<doc>'` y
> `app.reintegrar_documento_rechazado` cortaba SIEMPRE con `REPROCESO_BLOQUEADO`. Fix: el motor
> **versiona la clave** en el reintento (`idempotencyKeyCausacion` cuenta asientos `causacion:%`
> ANULADOS del documento → `causacion:<doc>#2`, `#3`; cuenta solo anulados para que una carrera real
> siga chocando contra la clave base y se resuelva como `ya_procesado`), y la transición
> `rechazado → parseado` procede cuando el único asiento en conflicto quedó anulado, con rastro
> ampliado en `audit_log` (quién, cuándo, `desde_estado`, `reproceso_numero`, `asiento_anulado_previo`,
> motivo). `REPROCESO_BLOQUEADO` **se mantiene** para cualquier asiento en conflicto no anulado.
> Migración `172_a3a2_v23_reproceso_rechazadas.sql`. **Compuerta ampliada de A14: PASA, con SEIS
> defectos hallados en el propio fix y su vecindario (V-27…V-32), todos corregidos por A14 en la
> misma pasada** (migración `173`, `retention_applied` atada al ledger publicado en A9/A11, nota
> crédito recuperable, resguardo extendido a notas). `tsc` limpio, `next build` exit 0, `npm test`
> **1052 en verde** (51 archivos). Sin comitear. Ver «D-081» y «Compuerta AMPLIADA de V-23».
>
> 2026-09-02, después de eso — **D-082: refinamiento visual de toda la interfaz + tema claro por
> defecto (fusiona el encargo D-081).** Cambio de USO y de detalle, cero cambios a la paleta
> aprobada (D-074/075/076). (1) Chrome (barra superior + lateral) de bloque azul sólido a neutro
> (`bg-superficie-elevada` + borde sutil); el azul queda como acento del módulo activo (fondo
> `bg-primario/8` + barra vertical de 2px + ícono azul). Logo «Contable CO» en texto oscuro sobre
> claro. (2) Escala tipográfica por ROL en un solo sitio (`@theme` de `globals.css`):
> `text-metadata|menor|cuerpo|seccion|titulo`, ya consumida por el kit. (3) Tarjetas con
> `--shadow-tarjeta` (0 1px 2px rgba(0,0,0,.04)), `--radius-tarjeta` (12px) y más padding. (4)
> `EstadoVacio` nuevo — ícono grande y tenue + texto humano — reemplaza el `MensajeEstado`
> genérico en los vacíos de `/bandeja` y `/`. (5) Íconos: un solo set (`app/_ui/iconos.tsx`, SVG
> hand-inlined estilo lucide, sin dependencia — decisión de presupuesto A15), tamaños unificados.
> (6) Botones: variante `terciario` nueva (solo texto), transición `duration-150` explícita. (7)
> **Tema claro SIEMPRE por defecto**: `dark:` ya no mira `prefers-color-scheme`; el modo oscuro
> solo se activa con el toggle sol/luna nuevo de la barra superior (`TemaProvider`, persistido en
> `localStorage`, aplicado antes del primer pintado por script en línea de `layout.tsx`). El modo
> oscuro sigue disponible, solo deja de auto-detectarse por SO. `tsc` limpio, `next build` exit 0
> (40 rutas), `npm test` **1052 en verde** (51 archivos, sin cambio de conteo). Sin comitear. Ver
> «D-082».
>
> 2026-09-02, después de eso — **D-083: escenarios completos de bandeja en `npm run datos-ejemplo`.**
> `montarEscenariosBandeja` monta el tercero «Proveedor Prueba SAS», 3 facturas para aprobar (score
> 92/74/58), 3 para revisión, 2 rechazadas/archivadas, 1 ciclo V-23 completo y 1 nota crédito
> rechazada recuperable — todo por los servicios reales, sin tocar el ledger a mano. Contenido antes
> mal documentado como «extensión posterior» de D-082; ahora en su propia ficha. `tsc` limpio. Sin
> comitear. Ver «D-083».
>
> 2026-09-02, después de eso — **D-084: Módulo de Terceros, Fase 3.** (0) Cuerpo de las cinco
> pantallas de `/terceros` migrado al kit de `app/_ui/` (tokens de tema, `Panel`, tabla sticky,
> `EstadoVacio`); `/terceros` sale de `PREFIJOS_SIN_MIGRAR` y ya responde a `data-tema="oscuro"`
> igual que `/` y `/bandeja`. Submódulo con pestañas internas Detalle · Atributos fiscales ·
> Actividad económica · Historial. (1) Eliminar solo si el tercero nunca tuvo movimientos; si los
> tuvo, solo inactivar — impuesto por el motor: `app.tercero_tiene_movimientos` + trigger
> `third_party_restrict_delete` (SQLSTATE `TP001`, migración 174); el botón de eliminar se
> deshabilita en la UI con explicación. (2) Exportación a Excel del maestro
> (`GET /api/terceros/exportar`, `exceljs`) con los atributos fiscales y el historial COMPLETO de
> vigencias, aislada por RLS. (3) Historial de vigencias en pestaña aparte
> (`/terceros/[id]/historial`), solo lectura; la vista principal muestra solo el valor vigente.
> (4) Permisos por el servicio central `src/auth/permisos.ts` (nunca cadenas sueltas); punto de
> extensión listo para la Fase 8 (roles a la medida) = agregar filas a `role_permission`, sin
> reescribir lógica. A14 ampliado verificado por pruebas: DELETE directo de un tercero con
> movimientos → `TP001`; la exportación no trae filas de otra empresa. `tsc` limpio, `next build`
> exit 0, `npm test` **1065 en verde** (52 archivos). Sin comitear. Ver «D-084».
>
> 2026-09-02, después de eso — **D-085: reversión del tema forzado + 3 bugs de shell + migración 174
> aplicada, y convención nueva de QA en navegador real.** (1) Se revierte la parte de D-081/D-082 que
> forzaba tema claro ignorando el SO: **sin elección guardada el tema sigue `prefers-color-scheme`
> (lo resuelve el CSS con `@media`, sin JavaScript); con elección guardada gana la del usuario**. La
> elección se persiste en la **cookie `contable-co-tema`** (no `localStorage`) para que
> `app/layout.tsx` la lea en servidor y pinte `<html data-tema>` en el HTML inicial → sin parpadeo y
> **sin `<script>` bloqueante**. (2) `<html suppressHydrationWarning>` — `data-tema` puede cambiar
> servidor↔cliente al alternar sin recargar; es la única diferencia esperada. (3) El `<script>` JSX
> crudo del `<head>` se **elimina**: React 19 aborta con `console.error` al reconciliar cualquier
> `<script>` del árbol en un re-render de cliente (probado: inline, `next/script beforeInteractive`
> con y sin `src`, y `<script src>` a `public/` — los cuatro lo disparan), y ese re-render es justo
> el que provoca el server action de cambiar de empresa. (4) BUG «seleccionar empresa forzaba modo
> claro»: causa raíz = con el script + `localStorage`, el refresh de server action re-renderizaba
> `<html>` sin `data-tema` y React borraba el atributo. Con la cookie no hay nada que perder: sin
> elección manda el CSS; con elección `app/layout.tsx` re-lee la cookie en ese mismo refresh y
> vuelve a emitir `data-tema`, que React mantiene por ser una prop suya. (5) Migraciones 172, 173 y
> **174** aplicadas a la Neon real (estaban pendientes, sin problema de orden):
> `app.tercero_tiene_movimientos()` y el trigger `third_party_restrict_delete` confirmados en
> `pg_proc`/`pg_trigger`. `tsc` limpio, `next build` exit 0, `npm test` **1065 en verde** (52
> archivos, sin cambio). **Verificado en navegador real, en `next start` Y en `next dev`**: consola
> sin errores ni warnings en `/entrar`, `/` y `/terceros`, al alternar el tema y al cambiar de
> empresa; SO oscuro sin cookie abre oscuro, SO claro abre claro, el toggle escribe la cookie y
> persiste tras navegar, y cambiar de empresa ya no altera el tema. Convención nueva de trabajo (no
> es ficha D-0XX). Sin comitear. Ver «D-085» y «Convenciones establecidas → Verificación en
> navegador real».
>
> 2026-09-02, después de eso — **D-086: catálogo geográfico DANE (departamento → municipio) +
> selector de dirección en formato DIAN, sobre el módulo Terceros (D-084).** PARTE A: tabla nueva
> `department` (33 dptos, sembrada en la migración 175) + `municipality.department_id` resuelto por
> trigger + seed `db/seeds/tanda0-geografia/020_municipios.sql` con los **1.122** municipios DANE
> (DIVIPOLA oficial de `datos.gov.co`, verificado con navegador el 2026-09-02); selector dependiente
> departamento → municipio en crear/editar tercero. PARTE B: `src/domain/direccion-dian.ts` (puro,
> abreviaturas oficiales de la nomenclatura DIAN/MUISCA) + modal que compone la dirección del
> Formato 1001 campo a campo, sin texto libre — revalidado en el servidor. `third_party` gana
> `direccion_dian jsonb` y las marcas `direccion_requiere_revision` / `municipio_requiere_revision`;
> los terceros heredados conservan su dirección intacta y quedan MARCADOS y corregibles, nada se
> borra. `tsc` limpio, `next build` exit 0, `npm test` **1085 en verde** (54 archivos). Verificación
> en navegador real NO ejecutable aquí (sin DNS a la Neon). **Compuerta de A14 ampliada: PASA con
> correcciones** — seis defectos (V-33…V-38) hallados y corregidos por A14 en la misma pasada, con
> suite propia `tests/adversarial/a14-d086-ampliada.test.ts` (30 pruebas); suite total **1115 en
> verde** (55 archivos). Queda: verificación en navegador real (convención D-085) y, si la migración
> 175 ya se aplicó a alguna Neon, reaplicarla (A14 la editó por V-36). Sin comitear. Ver «D-086» y
> «Compuerta AMPLIADA de D-086».
>
> 2026-09-03, después de eso — **COMPUERTA AMPLIADA DE D-086 (QA adversarial + arquitecto + product
> owner). Veredicto de A14: PASA, con SEIS defectos encontrados y CORREGIDOS por A14 en la misma
> pasada (V-33 … V-38), y una salvedad de proceso que no se cierra sola.** A14 no le creyó al
> reporte: escribió su propia suite (`tests/adversarial/a14-d086-ampliada.test.ts`, 30 pruebas).
> Lo bueno, verificado y no aceptado por reporte: el catálogo DANE es **correcto y completo** —los
> **33** departamentos contrastados uno por uno, 1.122 municipios, cero duplicados, prefijo ==
> departamento en todas las filas, `department_id` resuelto al 100 %—; `department` tiene RLS
> `ENABLE`+`FORCE`, el trigger de resolución **no** engancha a un departamento de otra firma, la
> guardia de alcance rechaza el cruce con `AL001` y **no se perdió** la cobertura de
> `municipality_id` al recrear el trigger; los 20 casos dorados y D-084 siguen en verde. Lo grave
> que apareció: el `jsonb` de la dirección **guardaba el JSON crudo del cliente** (V-33); un
> desglose que no es del contrato **entraba por coerción de tipos** y dejaba una fila que ya no se
> podía recomponer, además de tumbar el validador con un `TypeError` (V-34); el **texto libre
> entraba sin dejar rastro** por la carga masiva y por POST directo, justo lo contrario de lo que
> el entregable promete (V-35); el backfill **no marcaba al tercero nacional sin dirección
> ninguna**, que es el que rompe el Formato 1001 (V-36); editar con texto libre **borraba en
> silencio** un desglose ya normalizado (V-37); y dos regresiones de interfaz: perder el desglose
> al volver de un error, y dejar **sin salida** al tercero mal marcado como del exterior (V-38).
> Todo corregido con prueba de regresión. `tsc` limpio, `next build` exit 0, `npm test` **1115 en
> verde** (55 archivos). **Salvedad:** la verificación en **navegador real** contra la Neon sigue
> sin hacerse (sin ruta DNS desde este entorno) y, por la convención de D-085, **el entregable no
> se comitea como cerrado hasta hacerla**. Además la **migración 175 se editó** en esta compuerta:
> quien ya la hubiera aplicado a su Neon debe reaplicarla. Sin comitear. Ver «Compuerta AMPLIADA de
> D-086».
>
> 2026-09-03, después de eso — **A8 entrega D-087 — Módulo de Parámetros tributarios, Fase 4.**
> (0) Las seis pantallas de `/parametros` migradas al kit `app/_ui/` (tokens, `Panel`, `Encabezado`,
> `Tabla` sticky, `MensajeEstado`, `Campo`/`Entrada`); `/parametros` **sale de `PREFIJOS_SIN_MIGRAR`**
> y responde a `data-tema="oscuro"`. (1) `Modal` genérico extraído a `app/_ui/componentes.tsx` desde
> el modal DIAN de D-086 (mismo comportamiento + foco atrapado); `_direccion-dian.tsx` lo consume sin
> cambio observable; los badges FALTA DATO / VERIFICAR del banner de alertas abren ese `Modal` con un
> enlace al submódulo que corrige el dato. (2) Migración `176`: ocho códigos
> `parametro.{tarifas,valores_base,reteica,puc}.{leer,editar}` en el catálogo `permission`, espejados
> en `PERMISOS`, otorgados por `INSERT ... SELECT` desde `role_permission` (quien tenía el permiso
> grueso recibe el fino — sin `UPDATE`); los helpers del servicio aceptan submódulo. El motor sigue
> imponiendo `parametro.editar` / `puc.editar` (triggers de 016 sin tocar): la granularidad fina es
> UI hasta la Fase 8. (3) `valores-base` pasó a flujo de DOS pasos (simular ANTES de guardar) como
> `tarifas` y `reteica-municipios`; las tres pantallas tienen «Ver detalle» con
> `app.detalle_impacto_*` (migración 176) — filas reales de conceptos y proveedores con el MISMO
> `WHERE` que el conteo de 080. PUC: migrado visual, sin simulador de conceptos (no abre vigencias
> tributarias). `tsc` limpio, `next build` exit 0 (37 rutas), `npm test` **1115 en verde** (55
> archivos, sin archivo de prueba nuevo). **Verificación en navegador real: NO ejecutada** (sin DNS a
> la Neon) — por la convención de D-085 no se cierra hasta hacerlo. **Compuerta de A14: PENDIENTE.**
> Sin comitear. Ver «D-087».
>
> Registro histórico: 2026-08-31 — **A14, compuerta del LOTE POSTERIOR A LA OLA 3 (V-17/A8, V-18/A11,
> arranque y repaso 14.1/A12, datos de ejemplo/A1, entorno y despliegue/A15). Veredicto: LOTE APROBADO,
> con tres vulnerabilidades encontradas por A14 y CORREGIDAS por A14 en la misma pasada (V-20, V-21,
> V-22).** A14 no verificó por reporte: corrió la secuencia completa del README contra un PostgreSQL de
> verdad (`migrate` → `seed` → `arranque` → `datos-ejemplo` → `next dev`), inició sesión con la
> contraseña que imprimió el arranque y recorrió las cinco pantallas. Lo grave que encontró: la base de
> datos **inventaba ocho de las nueve banderas fiscales** de un tercero por `DEFAULT false` (V-20), justo
> lo que D-014 y la advertencia 17.5 prohíben; y su propio detector de la Regla de Oro 2 **no barría el
> código ejecutable de la raíz** del repositorio, donde A15 acaba de poner `instrumentation.ts` (V-21).
> Suite: **914 en verde** (45 archivos), typecheck limpio, `next build` exit 0. Ver «Compuerta del lote
> posterior a la Ola 3 — veredicto de A14».
>
> Registro histórico: 2026-08-31 — **A14, compuerta de la Ola 3 (A9, A10, A11), SEGUNDA PASADA.
> Veredicto: OLA 3 CERRADA. Con ella se cierra la última ola del proyecto.** En la primera pasada
> (2026-08-30) A14 bloqueó por V-16: los veinte libros existían y eran correctos, pero **no había por
> dónde descargarlos**. A9 entregó `GET /api/reportes/:libro` y la pantalla `/reportes`; A14 **no le creyó
> y lo atacó**: los veinte slugs devuelven un `.xlsx` real que se reabre con las cuatro hojas
> obligatorias, ningún generador quedó huérfano sin slug, y la ruta resiste cookie de empresa ajena,
> `companyId` en la query, sesión de otra firma, sesión cerrada, falta de permiso y recorrido de ruta. En
> el ataque apareció **V-19** (un slug igual a una clave del prototipo de `Object` devolvía 500 en vez de
> 404), **corregida por A14**. El criterio duro de la §12 —10.000 asientos aleatorios contra el ledger—
> ya había pasado al centavo. Suite: **849 en verde** (43 archivos), typecheck limpio, `next build` exit 0
> con `ƒ /api/reportes/[libro]` y `ƒ /reportes`.
>
> Registro histórico: 2026-08-27 — **A14, compuerta de la Ola 2 (A5, A7, A8, A13). Veredicto: OLA 2
> CERRADA.** Los tres criterios de salida de la sección 4 pasan, verificados **por la interfaz real** y
> con instrumentos propios de A14 (una mina en vez de un contador, un espía de `fetch`, 30 empresas de
> verdad y 50 aprobaciones de un golpe). En el camino A14 **refutó** el acotamiento que A8 le había
> hecho a su detector de la Regla de Oro 2 y lo restituyó (D-049), y **corrigió** un defecto real de la
> aprobación en lote que hacía que una sola fila mala se llevara por delante las otras 49 (D-050).
> Suite: **603 en verde** (32 archivos), cero `todo`, cero fallos, typecheck limpio.

## Olas cerradas

| Ola | Agentes | Compuerta | Commit de cierre | Fecha |
|---|---|---|---|---|
| **0 — Fundaciones** | A2, A12, A14 | **PASA las cuatro pruebas**, verificadas de forma independiente por A14 con pruebas propias (`tests/adversarial/`) | *pendiente — lo pone A0* | 2026-08-26 |
| **1 — Núcleo del dominio** | A1, A3, A4, A6, A14 | **PASA los cuatro criterios**, verificados de forma independiente por A14 con pruebas propias. Bloqueada primero por V-4 y V-6, cerrados por A1 en `ffaf3db` y **reverificados** por A14 sin creerle al reporte. Ver «Compuerta de la Ola 1 — veredicto de A14» | *pendiente — lo pone A0* | 2026-08-27 |
| **2 — Inteligencia, parametrización e interfaz** | A5, A7, A8, A13, A14 | **PASA los tres criterios**, verificados por A14 **por la interfaz real** (`tests/adversarial/compuerta-ola2-interfaz.test.ts`) y con instrumentos propios (`tests/adversarial/compuerta-ola2.test.ts`). Dos defectos reales encontrados y **corregidos por A14** (D-049, D-050); uno declarado y asignado (V-11). Ver «Compuerta de la Ola 2 — veredicto de A14» | *pendiente — lo pone A0* | 2026-08-27 |
| **3 — Salidas contables y fiscales** | A9, A10, A11, A14 | **PASA los dos criterios**, en la segunda pasada. Bloqueada primero por V-16 (no existía forma de descargar ningún reporte), cerrada por A9 con `GET /api/reportes/:libro` + `/reportes` y **reverificada por A14 atacando la ruta**, no leyendo el reporte. Un defecto nuevo encontrado y corregido por A14 en el ataque (V-19). Ver «Compuerta de la Ola 3 — veredicto de A14» | *pendiente — lo pone A0* | 2026-08-31 |
| **4 — Operación real** | A16 | *pendiente — la ejecuta A14* | *pendiente* | 2026-09-01 |

**Ola 4: ENTREGADA por A16, SIN COMPUERTA TODAVÍA.** No está cerrada: falta que A14 la verifique él
mismo, como todas las demás. Lo que entregó, tarea por tarea, está en «Ola 4 — qué entregó A16».
Resumen: el producto pasó de «se puede demostrar» a «una firma lo puede operar» — hay por dónde volver
del sitio donde uno esté, hay cómo cargar de golpe los catálogos que antes solo se poblaban con SQL, el
plan de cuentas se puede hacer propio de cada empresa, el selector de ReteICA dejó de mentir, un reporte
que no sale dice cuál de las tres cosas pasó, y la firma puede crearse sus propios roles sin tocar código.

**Ola 3: CERRADA por A14, en la segunda pasada. Con ella termina la construcción del proyecto.** En la
primera pasada (2026-08-30) el criterio duro —el balance de prueba contra el ledger con 10.000 asientos
aleatorios— ya pasaba al centavo, pero A14 bloqueó por **V-16**: los veinte libros existían, eran
correctos y serializaban a `.xlsx` válido, y **ningún importador fuera de las pruebas los invocaba**. No
había descarga, y el criterio dice literalmente «todo reporte **se descarga** en Excel». A9 cerró V-16 con
`GET /api/reportes/:libro` y la pantalla `/reportes`. A14 **no lo dio por bueno por escrito**: atacó la
ruta con sesión de otra firma, cookie de empresa ajena, `companyId` inyectado en la query, sesión cerrada,
token inventado, rol sin permiso y recorrido de ruta — todos rechazados, y ni una celda de otra firma en
ningún libro. En ese ataque salió **V-19** (un slug igual a una clave del prototipo de `Object` devolvía
500 en vez de 404), **corregida por A14**. Quedan abiertas y declaradas V-17 y V-18; ninguna derrota un
criterio de salida.

**Ola 1: CERRADA por A14, en la segunda pasada.** En la primera, la compuerta quedó **bloqueada**: con el
repositorio tal como se entregaba, `rounding_rule` estaba vacía y no había ni una regla de ReteICA, de
modo que el motor —correctamente— no calculaba **ninguna** retención y tres casos dorados solo pasaban
sobre andamiaje de la suite. A1 cerró los dos huecos en `ffaf3db` sin escribir un solo valor a mano
(copiando la tarifa de Medellín de la fila que él mismo había verificado, y declarando el redondeo como
parámetro operativo). A14 **volvió a correr la compuerta entera** y verificó lo que decidía el cierre:
los casos 1 y 8 se causan, cuadran y se publican **sin que ninguna prueba inserte un parámetro**. Quedan
abiertas y declaradas V-1, V-5, V-7, V-8 y V-9; ninguna derrota ninguno de los cuatro criterios.

**Ola 2: CERRADA por A14.** Los tres criterios de la sección 4 pasan, y pasan **por donde los va a usar
un contador**, no solo por la capa de servicios: la UVT se cambia enviando el `FormData` de la acción de
servidor de A8, y las 50 aprobaciones se hacen enviando el `FormData` de la bandeja de A7 con 30 empresas
reales montadas. De lo simulado, solo el transporte de Next (`next/headers`, `next/navigation`) y la
conexión; la sesión, el rol, la RLS, los triggers y el ledger son los de producción.

Durante la verificación A14 encontró **cuatro cosas que nadie había reportado**: que el acotamiento de A8
al detector de la Regla 2 **sí perdía cobertura real** (V-13, refutado con canario envenenado y
restituido, D-049); que el canario había dejado de ejercitar la regla acotada (V-14, corregido); que
`aprobarAsientosEnLote` **no tenía SAVEPOINT** y su `catch` por ítem era decorativo (V-12, corregido por
A14, D-050); y que la aprobación desde la bandeja **revienta con un error crudo de PostgreSQL** si el
despliegue no reenvía la IP del cliente (V-11, abierta, asignada). Ninguna de las cuatro derrota un
criterio de salida una vez corregidas las tres primeras.

**Ola 0: CERRADA por A14.** Las cuatro pruebas de la compuerta de la sección 4 pasan, y pasan contra el
motor de PostgreSQL (SQLSTATE), no contra un `throw` de TypeScript. Ninguna vulnerabilidad abierta
derrota ninguno de los cuatro criterios. El detalle, prueba por prueba, está en
«Compuerta de la Ola 0 — veredicto de A14».

Durante la verificación se encontraron **dos vulnerabilidades reales** que ni A2 ni A12 habían
considerado, ambas **corregidas** por A14 en `db/migrations/017_a14_cierre_vulnerabilidades.sql`
(D-030 y D-031), más un defecto del banco de pruebas (D-034, corregido). Quedan **dos hallazgos
abiertos asignados a A2** (D-032 y D-033) que **no bloquean la Ola 0** y sí son **precondición de
cierre de la Ola 1**. Ver «Vulnerabilidades — registro de A14».

**A2 entregó** esquema, ledger, RLS, vigencias, auditoría y roles.
**A12 entregó** autenticación, sesiones, MFA, permisos por rol, audit_log, cifrado y habeas data.
**D-020 cerrado** (ver D-021), verificado por A14 contra el motor.

**Siguiente:** A0 hace el commit de cierre y despacha la Ola 1 (A1, A3, A4, A6). A14 no hace commits.

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

## Decisiones de modelado de A2 (Ola 0)

### D-007 — La tabla de usuarios es `"user"`, siempre entrecomillada
**Decidido:** se respeta D-006 al pie de la letra aunque `user` sea palabra reservada en PostgreSQL. La tabla es `"user"` y toda consulta debe entrecomillarla.
**Por qué:** verificado que `SELECT ... FROM user` sin comillas falla de inmediato con `42703`, nunca en silencio. El costo es acordarse de las comillas; el beneficio es no abrir la puerta a que cada agente renombre.

### D-008 — `reversed_by` es derivado, no columna física
**Decidido:** `journal_entry` guarda `reverses_entry_id` (del asiento de reversa hacia el original). `reversed_by` se expone en la vista `v_journal_entry`.
**Alternativa descartada:** columna `reversed_by` en el asiento original, que exigiría un `UPDATE` sobre un asiento ya publicado — exactamente lo que prohíbe la Regla de Oro 1. Cualquier excepción "solo para marcar la reversa" habría abierto un boquete en la compuerta.
**Consecuencia:** para consultar asientos use `v_journal_entry`, no la tabla.

### D-009 — Un asiento nace borrador; publicar es una transición, no un INSERT
**Decidido:** `INSERT` de `journal_entry` en estado `posted` se rechaza (`LG007`). El flujo es: insertar `draft` → insertar `journal_line` → `SELECT app.publicar_asiento(id, user_id)`.
**Por qué:** un asiento insertado ya publicado no tendría partidas todavía y sería imposible validarlo; y si se permitiera agregarle partidas después, el ledger publicado dejaría de ser inmutable. Con este ciclo, `journal_line` bloquea cualquier `INSERT/UPDATE/DELETE` en cuanto el padre está publicado.

### D-010 — El balance se impone con CONSTRAINT TRIGGER DEFERRABLE, no con CHECK
**Decidido:** el cuadre a cero se verifica en el `COMMIT` mediante `CREATE CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED`.
**Por qué:** un `CHECK` no puede mirar otras filas, y validar en cada `INSERT` haría imposible construir el asiento (después de la primera partida siempre está descuadrado). Rechazar en el `COMMIT` sigue siendo rechazo del motor.
**Detalle:** con menos de dos partidas el trigger de partidas se calla para que el diagnóstico correcto (`LG003`, asiento sin partidas) no quede tapado por `LG002`.

### D-011 — El no-solape de vigencias se impone con trigger, no con EXCLUDE
**Decidido:** cada tabla paramétrica lleva una columna generada `clave_vigencia` y dos triggers genéricos instalados por `app.instalar_triggers_vigencia('tabla')`.
**Por qué:** `EXCLUDE USING gist (clave WITH =, daterange WITH &&)` sería lo idiomático, pero requiere `btree_gist`, y **PGlite no lo trae** (verificado: `extension "btree_gist" is not available`). Una restricción que solo existiera en producción no se puede probar, y una garantía no probada no cuenta.
**Detalle:** el trigger de solape es `AFTER`, no `BEFORE`, porque PostgreSQL calcula las columnas `GENERATED` después de los triggers `BEFORE`.

### D-012 — Las vigencias son append-only: el único UPDATE permitido es cerrar `vigente_hasta`
**Decidido:** un trigger genérico compara `to_jsonb(OLD)` contra `to_jsonb(NEW)` y rechaza (`PR001`) cualquier cambio que no sea pasar `vigente_hasta` de `NULL` a una fecha válida. Reabrir o mover una vigencia cerrada también se rechaza. Borrar una vigencia que ya surtió efecto se rechaza (`PR003`); una vigencia estrictamente futura sí se puede borrar, para cancelar un cambio programado.
**Consecuencia:** las tablas paramétricas **no llevan `updated_at` ni `activo`**: cualquier `UPDATE` de esas columnas sería rechazado. Para desactivar un parámetro se cierra su vigencia.

### D-013 — Identidad y valores viven en tablas distintas
**Decidido:** se separa lo que no cambia de lo que cambia por norma:
- `tax_concept` (identidad del concepto tributario, estable) ↔ `tax_rule` (tarifa, base y cuenta, por vigencia)
- `municipality` (código DANE, estable) ↔ `municipality_ica_rule` (bases mínimas, periodicidad, por vigencia)
- `ciiu_activity` (catálogo, estable); las tarifas de autorretención por CIIU son filas de `tax_rule`

**Por qué:** es lo que exige la corrección crítica de la sección 8.2. Si `concepto_causacion` apuntara a una fila de `tax_rule`, apuntaría a **una vigencia concreta**, y el decreto del año siguiente dejaría a todos los conceptos calculando con la tarifa vieja. Apuntando a `tax_concept`, la tarifa se resuelve por fecha del hecho y cambiarla en un lugar actualiza a todos. Lo mismo con los municipios: si `municipality` tuviera vigencia, cada tercero apuntaría a una versión del municipio y un acuerdo municipal rompería los terceros.

### D-014 — Los atributos fiscales del tercero están versionados, no son columnas de `third_party`
**Decidido:** `third_party` guarda identidad, dirección y municipio. Declarante, autorretenedor, gran contribuyente, régimen SIMPLE, responsable de IVA y agente de retención viven en `third_party_fiscal_attribute` con vigencia. La vista `v_third_party_vigente` los presenta aplanados para la interfaz.
**Por qué:** la sección 9.2 exige determinar los atributos *a la fecha del hecho*. Un proveedor que hoy es declarante pudo no serlo en marzo: con columnas mutables, recalcular una factura de enero en julio daría otro resultado (4% en vez de 6%), rompiendo la Regla de Oro 3.
**Consecuencia para A3/A4:** si no hay vigencia que cubra la fecha del hecho, **no se inventa un valor por defecto**. Un tercero sin atributos a esa fecha va a revisión manual. Poner `es_declarante_renta = false` por defecto sería inventar un dato tributario con consecuencia real (advertencia 5 de la sección 17).

### D-015 — Catálogos híbridos: `tenant_id IS NULL` significa "global"
**Decidido:** `account`, `niif_mapping`, `municipality`, `municipality_ica_rule`, `ciiu_activity`, `uvt_value`, `smmlv_value`, `rounding_rule`, `tax_concept`, `tax_rule`, `tax_calendar`, `concepto_causacion` y `role` admiten `tenant_id`/`company_id` nulos. La política RLS **deja leer lo global y escribir solo lo propio**.
**Consecuencia operativa:** las migraciones y los seeds de A1 escriben filas globales, y ninguna política RLS permite eso. **Los seeds deben correr con un rol superusuario o `BYPASSRLS`**, nunca como `app_user`. En pruebas eso es `asAdmin()`.
**Detalle:** la unicidad usa `UNIQUE NULLS NOT DISTINCT`, verificado en PGlite.

### D-016 — La coherencia multi-tenant se amarra con FK compuestas, no solo con RLS
**Decidido:** las tablas hijas declaran `FOREIGN KEY (padre_id, tenant_id, company_id) REFERENCES padre (id, tenant_id, company_id)`, apoyadas en índices únicos `(id, tenant_id, company_id)`.
**Por qué:** las comprobaciones de clave foránea **no pasan por RLS**. Sin la FK compuesta, una partida podría apuntar a un asiento de otro tenant y solo la política impediría verlo. Con ella, la base de datos lo hace imposible aunque la RLS estuviera mal.

### D-017 — `retention_applied` amarra la regla Y su vigencia
**Decidido:** `tax_rule` tiene `UNIQUE (id, vigente_desde)` y `retention_applied` declara `FOREIGN KEY (tax_rule_id, regla_vigente_desde) REFERENCES tax_rule (id, vigente_desde)`, más un `CHECK` que verifica que la vigencia registrada cubre `fecha_hecho_economico`.
**Por qué:** la Regla de Oro 6 pide saber "qué regla se aplicó y con qué vigencia". Guardar la vigencia como texto suelto permitiría registrar una vigencia que esa regla nunca tuvo. Así, la traza no puede mentir.
**Además:** `retention_applied` también registra las retenciones que **no** aplicaron (`aplicada = false` con `motivo_no_aplica`), como exige la sección 9.3.

### D-018 — Errores de dominio con SQLSTATE propios
**Decidido:** el motor levanta códigos propios que las pruebas verifican: `LG001` ledger inmutable, `LG002` desbalanceado, `LG003` sin partidas, `LG004` cuenta no imputable, `LG005` período cerrado, `LG006` sin aprobación, `LG007` asiento que nace publicado, `LG008` reversa inválida, `PR001` vigencia inmutable, `PR002` vigencia solapada, `PR003` vigencia no borrable, `AU001` auditoría inmutable. Están en `src/db/types.ts` como `SQLSTATE`.
**Por qué:** verificado que PGlite y postgres.js propagan el código en `error.code`. Es lo que permite que una prueba demuestre que el rechazo vino del motor y no de un `if` en TypeScript.

### D-019 — Toda vista lleva `security_invoker = true`
**Decidido:** sin esa opción una vista corre con los privilegios de su dueño y **salta la RLS de las tablas base**. Sería una puerta trasera al aislamiento. Hay una prueba de esquema que lo verifica en todas las vistas.

### D-020 — Riesgo conocido que hereda A12: `app_user` puede fijar `app.tenant_id`
**Situación:** el contexto va por `set_config('app.tenant_id', ...)`, y un rol no privilegiado puede llamar a `set_config` sobre una GUC personalizada. Verificado.
**Por qué se acepta hoy:** es el mismo patrón que usa Supabase con los claims del JWT, y el contexto lo fija `withTenantContext` a partir de una sesión ya validada. El riesgo aparece solo si se ejecuta SQL arbitrario de un usuario final, cosa que no ocurre.
**Pendiente para A12:** derivar el contexto de un claim firmado y no de una entrada del cliente, y considerar `pg_catalog`-level hardening si en algún momento se expone SQL directo.
**ESTADO: CERRADO por A12 en la migración 015.** Ver D-021.

---

## Decisiones de seguridad de A12 (Ola 0)

### D-021 — El contexto de tenant se deriva de un token de sesión verificado, no de una GUC (cierre de D-020)
**Decidido:** `app.current_tenant_id()`, `app.current_company_id()` y `app.current_user_id()` se
redefinieron en `db/migrations/015_sesiones_contexto_verificado.sql`. Ya **no leen** `app.tenant_id`.
Ahora la sesión SQL presenta **un solo secreto**, `app.session_token`, y la base busca su `sha256`
en `app.session_context`; de esa fila salen el tenant y el usuario.

**Ninguna política RLS de `012_rls.sql` se tocó.** Las políticas siguen llamando a las mismas tres
funciones; lo que cambió es de dónde sale la respuesta. Por eso las 55 pruebas de A2 pasan sin
modificar una aserción: el cierre de D-020 es transparente para el resto del sistema.

**Por qué `app.session_context` vive en el esquema `app` y no en `public.user_session`:**
una función que resuelve el contexto no puede leer una tabla cuya política RLS llama a esa misma
función. En PGlite eso no revienta porque el dueño de las tablas es superusuario y se salta la RLS
(verificado: el spike de recursión NO falló), pero en un Postgres gestionado el dueño **no** es
superusuario y `FORCE ROW LEVEL SECURITY` sí lo alcanza. Una tabla del esquema `app`, sin RLS y sin
un solo GRANT para `app_user`, se comporta **idéntico en pruebas y en producción**: el aislamiento
ahí es por privilegio, no por política. Se rechazó la alternativa de una política `TO <dueño>` sobre
`user_session` precisamente porque en pruebas nunca se ejercitaría y quedaría sin verificar.

**Alternativas descartadas:** (a) HMAC del claim dentro de la base — **pgcrypto no está disponible
en PGlite** (verificado: `function hmac(...) does not exist`), así que habría que inventar una
construcción MAC propia, cosa prohibida; (b) firmar el claim en Node y verificarlo en SQL — mismo
problema, no hay HMAC en el motor de pruebas; (c) `GRANT SET ON PARAMETER` sobre `app.tenant_id` —
no aplica a GUCs personalizadas no reservadas. El token opaco con `sha256` (función del **núcleo**
de PostgreSQL desde la 11, verificada disponible) logra el mismo efecto sin criptografía inventada:
el rol de aplicación no puede invertir el hash ni leer la tabla, luego no puede fabricar contexto.

**Consecuencia para todos los agentes:** el contexto de una petición se abre **siempre** con
`withSessionContext(db, { sessionToken, companyId }, fn)`. No existe forma soportada de decirle a la
base "soy el tenant X". `withTenantContext` sobrevive como alias y exige token igual.

### D-022 — La empresa la pide el cliente; la autoriza la base
**Decidido:** `app.company_id` sigue siendo un parámetro que el cliente fija —un usuario con 30
empresas tiene que poder elegir—, pero `app.current_company_id()` solo lo devuelve si la sesión
tiene un acceso **vigente** sobre esa empresa. Sin acceso devuelve NULL y la RLS no deja ver nada.
**Por qué no bastaba con RLS:** antes, cualquier sesión del tenant podía fijar `app.company_id` a
cualquier empresa del tenant, aunque el usuario no tuviera acceso otorgado. Ahora no.
**Consecuencia:** el intento queda registrado como `ACCESO_DENEGADO` en `audit_log`, en **su propia
transacción**, para que el rastro sobreviva al rechazo. Es el cuarto punto de auditoría de la 14.1.

### D-023 — Dos roles de base de datos: `app_user` y `app_auth`
**Decidido:** el camino de autenticación corre con un rol distinto del de las peticiones.
`app_user` **no puede** ejecutar `app.abrir_sesion` ni leer credenciales. `app_auth` **no tiene un
solo GRANT** sobre tablas de negocio: solo `SELECT` sobre `"user"` —limitado por una política a la
fila del correo exacto que se está autenticando, y únicamente mientras no haya sesión— e `INSERT`
sobre `audit_log` para los intentos fallidos.
**Por qué:** emitir sesiones es, por definición, la operación que crea contexto. Si el mismo rol que
sirve las peticiones pudiera emitirlas, una inyección SQL en una petición autenticada podría
fabricarse una sesión de otro tenant y D-020 se reabriría por la puerta de al lado. Con dos roles,
un atacante necesita **dos credenciales distintas**.
**Riesgo residual, sin adornar:** quien posea las credenciales de `app_auth` puede emitir una sesión
para cualquier usuario **cuyo correo conozca**, porque la verificación de la contraseña ocurre en
Node (pgcrypto no está en PGlite). Cerrarlo del todo exigiría mover la derivación de clave al motor
o a un servicio de autenticación separado. Se documenta como abierto, no se disimula.

### D-024 — Límite conocido del harness: en PGlite el descenso a `app_user` es reversible
**Situación verificada:** en PGlite la conexión subyacente es superusuario y `SET LOCAL ROLE app_user`
es una degradación **reversible**: desde dentro de `asTenant` se puede hacer `RESET ROLE` y volver a
`postgres`, o `SET ROLE` a otro rol.
**Qué significa exactamente:** las pruebas demuestran que **las políticas funcionan**; no demuestran
que la aplicación no pueda saltárselas, porque en el entorno de pruebas sí podría.
**Qué lo cierra, y es configuración, no código:** en producción la aplicación debe **conectarse** con
un rol de login que ES `app_user`, sin `SUPERUSER`, sin `BYPASSRLS` y **sin ser dueño de las tablas**.
Con esa conexión, `RESET ROLE` no lleva a ninguna parte. La lista de verificación está en
`docs/cifrado-y-proteccion-de-datos.md`, numeral 4.1, y **A15 debe ejecutarla al desplegar**.
**Por qué se deja escrito y no se "arregla":** no tiene arreglo en código. Es una propiedad de cómo
se conecta el proceso, y A14 tiene que poder verificarla como tal.

### D-025 — La autorización por rol la impone un trigger, no la aplicación
**Decidido:** `016_permisos_y_auditoria_sensible.sql` instala un trigger `BEFORE INSERT/UPDATE/DELETE`
en cada tabla de escritura que exige el permiso correspondiente y rechaza con `SE002`.
**Por qué no en la capa de servicio:** el mismo criterio de D-003. Si la garantía la da un `if` en
TypeScript, un endpoint nuevo que olvide llamarlo la pierde en silencio. Con el trigger, un auxiliar
de causación no edita un parámetro tributario **aunque la interfaz tuviera el botón**.
**Escape deliberado:** cuando **no hay sesión** (`app.session_id() IS NULL`) el trigger se aparta.
Ese es el camino administrativo —migraciones, seeds de A1, plataforma— que corre con rol privilegiado,
donde la garantía la da el privilegio. Un `app_user` sin sesión tampoco escribe: lo detiene antes la
RLS, porque sin sesión no hay tenant y ninguna fila satisface la política.
**Dos excepciones con trigger propio:** `journal_entry` (el permiso depende de la transición: crear,
editar borrador, publicar o reversar) y `"user"` (la contabilidad del propio inicio de sesión y el
cambio de la contraseña propia no son "administrar usuarios").
**Consecuencia para A1:** los seeds paramétricos deben correr con `asAdmin` / rol privilegiado, igual
que ya exigía D-015. Si se intentan como `app_user` con sesión, hará falta `parametro.editar`.

### D-026 — Espejos de seguridad en el esquema `app`, mantenidos por trigger
**Decidido:** `app.usuario` (id, tenant, estado) y `app.acceso_usuario_empresa` (accesos vigentes)
son proyecciones mínimas de `"user"` y `user_company_access`, mantenidas por triggers `SECURITY
DEFINER`, sin RLS y sin GRANTs.
**Por qué:** el resolutor de contexto no puede leer tablas cuya política depende de él mismo (D-021).
Además, `app.abrir_sesion` valida el usuario contra `app.usuario` en vez de confiar en un `tenant_id`
que le pase el llamador — si confiara, D-020 se reabriría.
**Costo aceptado:** dos tablas duplicadas de tres y cinco columnas. **No son fuente de verdad del
negocio; son fuente de verdad de la seguridad.** Si alguna vez divergen, el efecto es denegar acceso,
no concederlo de más.

### D-027 — scrypt de `node:crypto` y TOTP propio: cero dependencias nuevas
**Decidido:** contraseñas con **scrypt** (RFC 7914) de `node:crypto`, N=2^14/r=8/p=1, sal de 16 bytes,
comparación en tiempo constante y parámetros dentro del registro almacenado. TOTP (RFC 6238) y HOTP
(RFC 4226) implementados sobre el HMAC del runtime, ~120 líneas.
**Alternativas descartadas:** `bcrypt` y `argon2` son módulos nativos que hay que compilar por
plataforma —fricción de despliegue real con 1 desarrollador y USD 20/mes— sin ganancia de seguridad
relevante a estos parámetros; `otplib`/`speakeasy` son superficie de suministro adicional para
implementar una especificación pública corta.
**Cómo se justifica no ser "criptografía inventada":** las primitivas son del runtime; lo propio es
el envoltorio que describen los RFC, y está **verificado contra los vectores de prueba de los propios
RFC** en `tests/gates/autenticacion.test.ts` (los diez de RFC 4226 y los seis SHA-1 de RFC 6238).
**Costo de presupuesto: USD 0.** No se instaló ninguna dependencia.

### D-028 — El secreto de MFA lleva un sobre de cifrado de aplicación
**Decidido:** `mfa_secret_cifrado` se guarda envuelto en AES-256-GCM con `APP_ENCRYPTION_KEY`, que
vive en el entorno del despliegue, **no en la base de datos**.
**Por qué:** el cifrado en reposo del proveedor protege el disco, no la fila. Un `pg_dump` legítimo,
un respaldo restaurado o un acceso de soporte del proveedor entregan los datos ya descifrados. Con el
sobre, un volcado de la base **por sí solo** no permite clonar el segundo factor de nadie.
**Pendiente declarado:** no hay procedimiento escrito de rotación de esa clave.

### D-029 — El audit_log redacta credenciales antes de escribir
**Decidido:** el trigger de auditoría de `"user"` reemplaza `password_hash` y `mfa_secret_cifrado`
por `[redactado]`, y omite por completo las actualizaciones de pura contabilidad de sesión.
**Por qué:** el trigger genérico de A2 copia `to_jsonb(NEW)` entero. Sobre la tabla de usuarios eso
habría metido la derivación de la contraseña y el secreto de MFA dentro de una tabla append-only que
nadie puede limpiar. Un registro de auditoría que copia las credenciales convierte la evidencia en
el botín.

---

## Decisiones de QA adversarial de A14 (compuerta de la Ola 0)

### D-030 — `app.revocar_sesiones_de_usuario` ignoraba el tenant. CORREGIDA
**Vulnerabilidad encontrada, no reportada por nadie.** Tal como la dejó la migración 015, la función es
`SECURITY DEFINER`, tenía `EXECUTE` para `PUBLIC` y recibía un `user_id` que **no contrastaba contra el
tenant de la sesión**. Verificado empíricamente: una sesión legítima de la firma A revocaba todas las
sesiones vivas de un usuario de la firma B, y el entero devuelto decía **cuántas tenía**. Escritura
cross-tenant y oráculo de actividad ajena, concedidos por el motor. Es una violación directa de la
Regla de Oro 7: el aislamiento lo tiene que imponer la base, y aquí la base lo regalaba por una función
DEFINER sin autorización.
**Por qué se le escapó a las pruebas de A12:** su prueba (`autenticacion.test.ts`, «revocar las sesiones
de un usuario corta todas a la vez») ejercita el camino feliz desde `asAdmin`. Nadie preguntó qué pasa
si quien llama es de otra firma.
**Corregido por A14** en `017`. Regla nueva, en este orden: (1) sin sesión se permite —camino
administrativo, mismo escape deliberado de D-025—; (2) sobre uno mismo, siempre; (3) sobre otro usuario
de la misma firma, exige `usuario.administrar` (SE002); (4) cualquier otro caso, SE003 **con el mismo
mensaje** tanto si el usuario no existe como si es de otra firma —distinguirlos reabriría el oráculo
por la puerta del código de error—.
**Probado en** `tests/adversarial/evasion.test.ts`, cinco pruebas, incluida la de indistinguibilidad.

### D-031 — `app_auth` podía fabricar auditoría dentro de cualquier firma. CORREGIDA
**Vulnerabilidad encontrada.** La política `audit_log_evento_autenticacion` de la 015 acotaba `accion` y
exigía `company_id IS NULL`, pero dejaba `tenant_id`, `user_id`, `entidad` y `valor_nuevo` a discreción
del insertador. Verificado: el rol `app_auth` escribía un registro arbitrario dentro del audit_log de
una firma cualquiera. Como el audit_log es append-only (AU001), **nadie puede limpiarlo después**: la
contaminación es permanente y cae justo sobre la evidencia que el producto vende como diferenciador
(Regla de Oro 6).
**El alcance de D-023 era mayor del declarado.** D-023 describe el riesgo residual de `app_auth` como
«puede emitir una sesión para cualquier usuario cuyo correo conozca». Real: **sin conocer ningún correo**
podía escribir en el rastro de auditoría de cualquier firma.
**Corregido por A14** en `017`: la política exige además `entidad IN ('autenticacion','user_session')` y
que la pareja `(tenant_id, user_id)` sea **coherente contra el espejo `app.usuario`**, o vaya
enteramente en NULL —el intento contra un correo que no existe, que debe seguir registrándose para no
ocultar la enumeración—. Se añadió `app.usuario_pertenece(uuid, uuid)`, `SECURITY DEFINER`, sin GRANT
para `app_user`.
**Probado en** `tests/adversarial/evasion.test.ts`: cuatro forjas rechazadas con 42501, dos controles
legítimos que siguen pasando, y la comprobación de que ninguna forja dejó rastro.

### D-032 — `journal_line.account_id` admitía la cuenta de otra firma. **CERRADA por A2 (migración 018)**

> **Cierre (A2).** Corregida en `db/migrations/018_a2_alcance_fk_y_truncate.sql`. Al recorrer
> `pg_constraint` entero en vez de parchear solo la columna denunciada, aparecieron **71 huecos del
> mismo patrón, no uno**. Ver D-037 para el detalle del arreglo y de lo que apareció de más.
> La prueba `it.fails` de A14 está convertida en prueba normal y acepta el SQLSTATE nuevo `AL001`,
> y se añadió un barrido de `pg_constraint` que vuelve a hacer el inventario contra el catálogo vivo
> en cada ejecución. Diagnóstico original de A14, íntegro:

**Vulnerabilidad de INTEGRIDAD, no de confidencialidad.** `journal_line.account_id` lleva una FK
**simple** a `account(id)`, no la FK compuesta `(id, tenant_id, company_id)` que llevan todas sus demás
referencias. Como las comprobaciones de integridad referencial de PostgreSQL se saltan la RLS, una
partida de la firma A **se inserta sin problema** contra una cuenta de la firma B. Verificado.
**Consecuencia real:** esa partida, una vez publicada, es inmutable; y la RLS después esconde la cuenta,
así que el auxiliar contable y el balance de prueba la perderían **en silencio**. Es el peor tipo de
error contable: el que no se ve.
**Por qué no es expresable con FK compuesta:** `account` es un catálogo híbrido (D-015), su `tenant_id`
puede ser NULL, y `journal_line.tenant_id` es NOT NULL. Hace falta un trigger que replique la regla de
la política híbrida: la cuenta es global, o es de la misma firma y empresa.
**Por qué NO bloquea la Ola 0:** no es ninguno de los cuatro criterios de la compuerta; explotarla exige
acertar un UUID aleatorio, así que no hay fuga de datos; y hoy no existe ni una partida real porque el
motor de causación es de la Ola 1.
**Por qué SÍ bloquea la Ola 1:** en cuanto A3 y A6 empiecen a escribir partidas, el agujero pasa a ser
alcanzable por un error de programación normal, no por un ataque.
**Le corresponde a A2.** Queda una prueba viva en `tests/adversarial/evasion.test.ts` marcada `it.fails`:
hoy pasa porque el agujero existe, y **empezará a fallar el día que A2 lo cierre**, obligando a
invertirla. No se puede olvidar en silencio.

### D-033 — no había trigger `ON TRUNCATE` en el ledger ni en el audit_log. **CERRADA por A2 (migración 018)**

> **Cierre (A2).** `BEFORE TRUNCATE ... FOR EACH STATEMENT` sobre `journal_entry`, `journal_line`,
> `audit_log`, `approval` y `retention_applied`, con el mismo SQLSTATE que el candado de fila de cada
> tabla (LG001 / AU001). La invariante ya no depende de que nadie conceda el privilegio por error: se
> verifica que **ni el superusuario** puede vaciarlas. Diagnóstico original de A14, íntegro:

**Hallazgo estructural.** Un trigger `BEFORE DELETE FOR EACH ROW` **no se dispara con `TRUNCATE`**. Los
candados LG001 (ledger inmutable) y AU001 (auditoría inmutable) son triggers de fila: un `TRUNCATE`
vaciaría `journal_entry` y `audit_log` sin que ninguno se entere.
**Mitigación que sí existe hoy y está verificada:** ningún rol de aplicación —ni `app_user` ni
`app_auth`— tiene el privilegio `TRUNCATE` sobre ninguna tabla de `public`. Hay prueba que barre el
catálogo entero, y otra que comprueba que el intento se rechaza con 42501.
**Riesgo residual:** el dueño de las tablas sí podría. Se solapa con D-024: la invariante «append-only»
es del motor **mientras nadie se conecte como dueño**. Un `CREATE TRIGGER ... BEFORE TRUNCATE ... FOR
EACH STATEMENT` sobre `journal_entry`, `journal_line` y `audit_log` lo cerraría también para el dueño,
que es exactamente el criterio que A2 ya aplicó en LG001 («el trigger protege también al dueño de la
tabla, cosa que el GRANT no haría»). **No se bloquea la Ola 0** porque el camino de aplicación está
cerrado y verificado.

### D-034 — el banco de pruebas era MÁS permisivo que producción. CORREGIDO
**Defecto encontrado en `tests/helpers/db.ts`.** `asegurarRolesAplicacion` reafirma los roles con un
`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO app_user` masivo y después repite algunos REVOKE, pero
**no todos** los que hacen las migraciones. Los cuatro `instalar_rls_*` que `013_grants.sql` revoca
quedaban devueltos a `app_user` en cada ejecución de la suite.
**Por qué importa más de lo que parece:** significa que **un REVOKE que faltara en una migración no lo
habría detectado ninguna prueba**, porque el harness lo estaba concediendo de todos modos. Es la clase
de divergencia que hace que una suite en verde no diga nada sobre el despliegue real.
**Corregido por A14:** los cuatro REVOKE faltantes se añadieron al harness, más el de
`app.usuario_pertenece` que introduce la 017. Y hay una prueba nueva
(«app_user no conserva ningún privilegio de más») que comprueba la lista de REVOKE **contra el motor**,
no contra la buena memoria de quien edite el harness la próxima vez.

### D-035 — D-023 y D-024 verificadas: son ciertas, y una era peor de lo declarado
**No se dieron por buenas por estar documentadas. Se midieron.**

**D-023 (dos roles de base de datos):** el alcance declarado es correcto en lo que dice, e **incompleto**
en lo que callaba —ver D-031, ya cerrada—. Lo que queda abierto y **es cierto**: con las credenciales de
`app_auth`, y sabiendo un correo exacto, se lee la credencial de ese usuario **de cualquier firma**,
porque la verificación de la contraseña ocurre en Node (pgcrypto no está en PGlite). Queda **medido**
en una prueba, no confiado: `evasion.test.ts` comprueba que sin `app.login_email` no se ve ninguna fila,
que con el correo exacto se ve una, y que ni aun así `app_auth` puede leer el ledger. También queda
cerrada por prueba la superficie total del rol: exactamente `audit_log:INSERT` y `user:SELECT`, ni un
privilegio más, y cero sobre el esquema `app`. **Sigue abierta**; cerrarla exige mover la derivación de
clave al motor o a un servicio de autenticación aparte. **No bloquea la Ola 0**: exige poseer una
credencial de infraestructura, no es alcanzable desde una sesión de usuario.

**D-024 (el descenso a `app_user` es reversible en PGlite):** exacta, y A14 la ha convertido en parte
de una prueba automática en vez de una lista en un documento. Lo que ahora se comprueba en cada
ejecución: `app_user` no es superusuario, no tiene BYPASSRLS, no hereda, no crea roles ni bases; no es
miembro de `app_auth` ni al revés —escalar de un camino al otro exige **dos credenciales**—; no es dueño
de ninguna tabla, vista, secuencia ni función; y no tiene `CREATE` en ningún esquema —sin `CREATE` no
puede fabricarse una tabla propia sin RLS donde copiar datos—. **El residuo se mide explícitamente:**
una prueba afirma que en este harness `session_user` **sí** es superusuario, de modo que si algún día
alguien apunta `DATABASE_URL` a un Postgres real con un usuario superusuario, la suite lo dice en voz
alta en lugar de dejar que todo pase por la razón equivocada. **Sigue abierta y su cierre es de
despliegue (A15)**, tal como A12 la dejó.

### D-036 — falsos PASS detectados en el trabajo de A2 y A12
Se revisaron las 120 pruebas existentes buscando aserciones que reclamen una garantía de base de datos
pero la comprueben en TypeScript. **No se encontró ningún falso PASS que invalide un resultado.** Sí se
encontraron **tres aserciones débiles**, que A14 ha cubierto con la versión de motor en vez de pedir que
las cambien:

1. `seguridad.test.ts` — «la empresa la pide el cliente pero la autoriza la base» comprueba
   `rejects.toBeInstanceOf(EmpresaNoAutorizadaError)`, que es un `throw` de `withSessionContext`, no del
   motor. La garantía **sí** está en la base, pero esa prueba no lo demuestra: si alguien escribiera un
   servicio que no pase por el envoltorio, la prueba seguiría en verde. A14 añadió la versión de motor:
   se salta `withSessionContext`, se le miente a `app.company_id` por `set_config` y se comprueba contra
   el catálogo que `app.current_company_id()` devuelve NULL y que `third_party`, `journal_entry` y
   `source_document` devuelven **cero filas**.
2. `seguridad.test.ts` — «un token inventado no resuelve ninguna sesión» tiene el mismo patrón
   (`SesionInvalidaError`). A14 añadió el barrido: sin token, `app_user` no ve una sola fila **de ninguna
   firma** en **ninguna** de las tablas con `tenant_id`, recorriendo el catálogo, no una muestra.
3. `ola0.test.ts` — «sin contexto de tenant no se ve absolutamente nada» y «el segundo nivel (company)
   también aísla» miran **una sola tabla** (`third_party`). Son correctas, pero una tabla no es un
   barrido. A14 las sustituyó por dos barridos por catálogo: **todas** las tablas con `tenant_id` y
   **todas** las tablas con `company_id`, y en los dos sentidos —también desde la segunda empresa hacia
   la primera, porque una fuga no tiene por qué ser simétrica—.

Nota adicional, sin consecuencia: sin sesión sí se ven las filas **globales** de los catálogos híbridos
(los 5 roles de sistema, el catálogo de permisos). Es el comportamiento deliberado de D-015 y no lleva
dato de ninguna firma; queda comprobado explícitamente en vez de asumido.

---

## Decisión de A2 al cerrar D-032 y D-033

### D-037 — El alcance de toda clave foránea se impone en la BD, con dos mecanismos según la forma del padre

**Origen.** A14 denunció una columna (`journal_line.account_id`). Arreglar solo esa columna habría sido
tratar el síntoma: el defecto era que **D-016 estaba aplicada a mano y por tanto de forma incompleta**.
Al recorrer `pg_constraint` con el criterio de D-016 escrito como consulta aparecieron **71 huecos**.

**Lo que apareció y A14 no había visto** (buscaba vectores de evasión, no un inventario):

- **`retention_applied.tax_rule_id` estaba escondido detrás de una FK compuesta.** Lleva
  `(tax_rule_id, regla_vigente_desde)` por D-017, así que a simple vista "ya era compuesta". Pero esa
  pareja amarra la **vigencia**, no el **alcance**: no incluye `tenant_id`. La traza de una retención
  podía citar la regla tributaria de otra firma. Es el caso más grave de los 71, porque D-017 existe
  precisamente para que la traza no pueda mentir.
- **Once columnas `created_by` / `confirmado_por` / `cerrado_por` / `otorgado_por` hacia `"user"`.**
  Registraban *quién* publicó un asiento, cerró un período u otorgó un acceso, y admitían un usuario de
  otra firma. Es un agujero de la Regla de Oro 6: la firma del acto era falsificable.
- **Referencias reflexivas**: `account.parent_id`, `cost_center.parent_id`,
  `source_document.documento_referenciado_id` (la nota crédito podía apuntar a la factura de otra
  empresa).
- **Toda la parametrización**: `tax_rule` → `account` / `municipality` / `ciiu_activity` /
  `tax_concept`, `concepto_causacion` → sus cuatro cuentas y sus cuatro `tax_concept`, etc.

**Dos mecanismos, según la forma del padre.** No es una elección estética: la FK compuesta no siempre
es expresable.

| Forma del padre | Mecanismo | Casos |
|---|---|---|
| Alcance estricto (`tenant_id` NOT NULL) | FK compuesta `(columna, tenant_id[, company_id])` — declarativa, la impone el motor sin código | 18 |
| Catálogo híbrido (`tenant_id` puede ser NULL, D-015) | Trigger genérico `app.trg_fk_alcance` | 53, en 21 tablas |

Con un padre híbrido la FK compuesta es **imposible**: la fila global tiene `tenant_id IS NULL` y la
hija lo tiene NOT NULL, así que nunca casarían. Por eso ahí va un trigger.

**El guardia es `SECURITY DEFINER` a propósito.** Tiene que ver la fila del padre *aunque la RLS se la
esconda al llamante*. Si no, "no la veo" y "no existe" serían indistinguibles: la referencia cruzada
pasaría el trigger y después pasaría la FK —que tampoco mira RLS— y el agujero seguiría abierto. Lleva
`SET row_security = off` para que, si algún día se despliega con un rol dueño **sujeto** a RLS, esto
falle a gritos en vez de aprobar la comprobación en silencio. No filtra nada: solo lee `tenant_id` y
`company_id` del padre, y el mensaje de error no nombra a la otra firma. Se le revoca `EXECUTE` de
`app_user` y de `PUBLIC` — el privilegio sobre una función de trigger se comprueba al **crear** el
trigger, no al dispararlo, así que revocarlo no lo desactiva y lo saca de la superficie de funciones
DEFINER que A14 audita.

**El alcance se hereda hacia abajo, nunca de lado.** Global (`tenant_id` NULL) lo usa cualquiera; de
firma (`company_id` NULL) lo usa cualquier empresa suya; de empresa, solo esa empresa. Se rechaza el
**cruce**, no el uso de algo más amplio: por eso la comparación de empresa exige que ambas columnas
estén definidas. Una regla de firma que apunta a una cuenta de firma es legítima; y el daño que importa
—una partida imputada a la cuenta de otra empresa— se caza igual, porque ahí las dos sí están definidas.

**SQLSTATE nuevo: `AL001` (`FK_ALCANCE_AJENO`)**, en `src/db/types.ts`. Se prefirió un código propio a
reutilizar `23503` para que el diagnóstico distinga "no existe" de "existe pero no es tuya".

**Coste.** Una búsqueda por clave primaria adicional por columna referenciada y por fila insertada. En
`journal_line`, la tabla caliente, es **una** por partida.

**Cómo se evita que vuelva a pasar.** `tests/adversarial/evasion.test.ts` incluye ahora un barrido de
`pg_constraint` que rehace el inventario contra el catálogo vivo en cada ejecución: si alguien añade
mañana una FK hacia una tabla con `tenant_id` sin acotar el alcance, la prueba la denuncia por nombre.
Verificado que detecta la regresión: al quitar a mano el guardia de `journal_line`, el barrido vuelve a
señalar `journal_line.account_id -> account`.

**Nota para quien toque `tests/helpers/db.ts`.** D-034 sigue vivo como fragilidad estructural: el
harness hace `GRANT ... ON ALL FUNCTIONS` y luego repite los REVOKE a mano, así que **todo REVOKE nuevo
en una migración hay que espejarlo también en el harness** o el banco de pruebas queda más permisivo que
producción. El REVOKE de `app.trg_fk_alcance` ya está espejado. Mientras el patrón siga siendo ese, esta
duplicación es una divergencia esperando a ocurrir.

---

## Decisiones de QA adversarial de A14 (compuerta de la Ola 1)

### D-038 — `ESCALA_TARIFA` y `ESCALA_UVT` son representación, no regla. La exención se GANA, no se declara
**Adjudicado:** el detector de la Regla de Oro 2 marcaba `ESCALA_TARIFA = 10n ** 6n` y
`ESCALA_UVT = 10n ** 4n` en `src/domain/dinero.ts`. **A14 coincide con A0 y con A3: son falsos
positivos.** No son tarifa, base, UVT, salario, tope ni calendario: son los factores de escala de punto
fijo de `numeric(9,6)` y `numeric(12,4)`, es decir la **definición de las columnas**, no el contenido de
ninguna fila. Si se anulara el Decreto 572 no cambiarían; si la columna pasara a `numeric(9,8)`
cambiarían sin que cambiara ninguna tarifa. Y quitarlas empujaría a `parseFloat` sobre los `numeric` de
PostgreSQL, que es justo lo que prohíbe la Regla de Oro 5.

**Lo que A14 NO hizo:** aflojar la regla hasta que callara. La exención está acotada por tres cercas
simultáneas, y las tres son comprobables:

1. **Por la forma.** Solo se exime `ESCALA_<ALGO> = 10n ** <n>n`: identificador con ese prefijo **y**
   valor literalmente una potencia de diez en BigInt. `const ESCALA_TARIFA = 0.04`,
   `const ESCALA_UVT = 5237400n` y `const ESCALA_TARIFA_SERVICIOS = 4n` siguen siendo cazados — hay un
   canario por cada uno de los tres.
2. **Por la lista.** Una prueba afirma que las constantes eximidas en todo el código son **exactamente
   esas dos**. Una tercera que reclame la exención rompe la prueba y obliga a adjudicarla.
3. **Por el hecho.** La exención se **gana contra el esquema**: una prueba lee `information_schema` y
   exige que cada constante eximida sea exactamente `10^(escala declarada en la base)`. Si alguien
   cambiara la columna y no la constante —o al revés— la prueba falla. Deja de ser un argumento y pasa a
   ser un invariante verificado.

**Efecto neto: el detector quedó MÁS sensible que antes**, no menos (ver D-040).

### D-039 — `db/seeds/` se excluye del barrido de la Regla 2, y a cambio se audita que sea solo DATO
**Decidido:** el barrido de valores tributarios cubre `src/`, `app/` y `db/migrations/`, y **no**
`db/seeds/`. Desde la Ola 1 ahí viven las tarifas reales de A1, y eso es **el dato en su sitio**: la
Regla 2 exige que el valor viva en una tabla paramétrica, no que no exista. Lo prohibido es el valor
quemado en una ruta ejecutable.

Para que la exclusión no sea una puerta trasera, se comprueba a cambio, con pruebas:
- **todo** archivo de `db/seeds/` es `.sql` — ni un archivo ejecutable;
- ningún seed define lógica (`CREATE FUNCTION|PROCEDURE|TRIGGER`, `DO $$`);
- ningún seed hace `UPDATE`, `DELETE` ni `TRUNCATE` sobre una tabla paramétrica — eso además violaría la
  Regla 3, porque editar un parámetro **inserta vigencia nueva** y jamás actualiza la anterior;
- los seeds **sí traen tarifas reales** (si estuvieran vacíos, "cero valores en el código" sería
  trivialmente cierto y la prueba no probaría nada);
- **toda** fila normativa declara `norma_respaldo`, en el archivo y en la base. Un valor tributario sin
  norma es un valor inventado con buena letra (advertencia 17.5).

### D-040 — Séptima regla del detector: el múltiplo exacto de UVT. La encontró el propio canario
**Hallazgo:** al escribir los canarios que demuestran que el detector sigue cazando tarifas reales,
`if (base > 104748) retener();` **no lo cazaba ninguna de las seis reglas**: no es fracción, no es
porcentaje, no hay palabra tributaria cerca, y 104.748 no es una magnitud de UVT sino **dos**. Y es
exactamente la base mínima de servicios de la sección 12.

**Corregido por A14:** regla nueva `multiplo_de_uvt`, que caza todo entero de cinco cifras o más que sea
múltiplo exacto de una UVT o de un SMMLV conocido (en pesos o en centavos). La forma más natural de
quemar una base mínima es precalcularla, y ahora se caza: 104.748 (2 UVT), 523.740 (10), 785.610 (15),
157.122 (3) y 4.975.530 (95) tienen canario propio. **Cero hallazgos** en el código real.

### D-041 — El andamiaje de A3 es legítimo COMO ANDAMIAJE, y su consecuencia queda MEDIDA
**Adjudicado**, los dos apoyos que A3 declaró:

1. **La `rounding_rule` que monta la suite: LEGÍTIMA.** El redondeo no es tarifa, base, UVT, tope ni
   calendario — la propia Regla de Oro 5 lo llama «parámetro configurable». Y A14 comprobó que **ningún
   valor esperado de la sección 12 depende del modo de redondeo**: en todos los casos
   `valorSinRedondeo == valor`, es decir el producto `base × tarifa` es exacto. Un andamiaje que no puede
   cambiar ningún resultado no puede fabricar ningún PASS.
2. **Las dos `tax_rule` de ReteICA materializadas: legítimas en el VALOR, insuficientes como PRODUCTO.**
   La tarifa no se escribe: se copia con un `SELECT` de `municipality_ica_rule` de A1. A14 lo verificó
   comparando las dos filas: son el mismo número, y la norma de A1 dice «Acuerdo». No hay valor
   inventado. **Pero la fila no existe en producción**, y eso sí tiene consecuencia (V-4).

**Regla general que queda establecida para las olas siguientes:** una suite puede montar un parámetro
**operativo** (redondeo, política de empresa) y puede **copiar** un valor normativo de una fila real,
pero no puede escribir un valor tributario nuevo. Y todo andamiaje debe venir con una prueba que mida su
consecuencia en producción.

**Y esa prueba hizo su trabajo.** Afirmaba, en positivo, que con solo los seeds de A1 había **cero**
reglas de ReteICA, **cero** conceptos de ReteICA y **cero** reglas de redondeo. En cuanto A1 cargó las dos
cosas (`ffaf3db`), **falló** — que era exactamente la señal pactada — y hubo que revisarla y actualizarla
al estado nuevo (D-047). El andamiaje de redondeo del escenario de A3 quedó redundante; el de ReteICA de
Medellín también, y A14 escribió el caso 8 de punta a punta **sin él** para demostrarlo. El de Cali sigue
haciendo falta, por V-5.

### D-042 — `app.resolver_empresa_por_buzon`: la ampliación de la lista blanca se ACEPTA, con el alcance medido y una corrección asignada
**Contexto:** A4 amplió el inventario cerrado de funciones `SECURITY DEFINER` de
`tests/adversarial/evasion.test.ts` para incluir la suya. Es el agente vigilado ampliando la lista que lo
vigila, así que A14 lo verificó en vez de leerlo.

**Lo que resultó cierto:** la superficie de columnas es mínima (solo `id` y `tenant_id`), la coincidencia
es exacta y solo sobre empresas `activa`. A14 lo probó con `%`, `%@%`, coincidencias parciales y cadenas
vacías: **no es un buscador**, devuelve `null` en los seis intentos. Suspendida la empresa, deja de
responder. Y la función es realmente necesaria: `company` tiene RLS de tenant estricto y resolver el
buzón ocurre **antes** de que exista sesión.

**Lo que NO era exacto, y A14 midió:** la justificación escrita dice «no cruza firmas». **Sí cruza**: desde
una sesión de la firma B, con el buzón de la firma A, la función devuelve el `company_id` y el
`tenant_id` de A. Es un **oráculo de existencia de buzones** y una **divulgación de identificadores entre
firmas**. Además, el precedente que invoca (`app.buscar_credencial`, D-023) está concedido **solo a
`app_auth`** y revocado de `app_user`; esta se concedió a `app_user`, que es el rol de **toda** sesión de
negocio. La analogía era correcta en el patrón y más ancha en el privilegio.

**Alcance real del daño, medido:** con esos dos identificadores en la mano, la firma B lee **cero** filas
de `company`, `source_document`, `journal_entry` y `third_party` de A, y no puede escribir nada (`42501`).
Divulga identificadores, no datos.

**Adjudicación: se acepta la ampliación** (V-1, gravedad baja, misma clase que el oráculo de
`user.email` ya aceptado en la Ola 0) **con una corrección asignada**: cuando A12 construya la sesión de
sistema del canal de correo, el `GRANT` debe moverse de `app_user` al rol que de verdad resuelve buzones
antes de la sesión, y revocarse de `app_user`. Hoy no se puede hacer sin romper el camino de A4, porque
ese rol todavía no existe. Queda **medido en dos pruebas** —una que fija en positivo que la función
contesta entre firmas y otra que fija que no se puede hacer nada con lo que devuelve— y el inventario
`SECURITY DEFINER` quedó **duplicado a propósito** en `compuerta-ola1.test.ts`: ampliarlo en un solo sitio
ya no basta.

### D-043 — La rama de "carrera detectada" de A6 era código muerto. CORREGIDA por A14
**Hallazgo:** `causarFactura` envuelve el INSERT del asiento en un `try/catch` que, ante
`journal_entry_idem_uq`, consulta el asiento existente y completa el trabajo como `ya_procesado`. **Ese
`catch` no podía funcionar:** una violación de unicidad aborta la transacción en PostgreSQL, así que la
primera consulta del `catch` moría con `25P02` «current transaction is aborted». A14 lo reprodujo
plantando el asiento del "otro worker" a mano: el resultado era `25P02` y el trabajo quedaba `pendiente`.

**Gravedad real: baja.** El invariante «un solo asiento por documento» nunca estuvo en riesgo — lo impone
el `UNIQUE`, no el `catch` — y el reintento posterior se autocuraba porque para entonces el documento ya
había cambiado de estado. Lo que estaba roto era el manejo elegante que el archivo declara.

**Corregido por A14** con un `SAVEPOINT` en `src/services/causacion.ts`, colocado **antes de escribir
nada del resultado** (traza de retenciones, placeholder de aprobación y asiento), no solo antes del
INSERT. La colocación importa: con el savepoint pegado al INSERT, el perdedor de la carrera habría
sobrevivido dejando filas de `retention_applied` huérfanas, sin asiento — cambiar un defecto por otro
peor. La prueba de regresión verifica las dos cosas: que la carrera se resuelve como `ya_procesado` con
el trabajo `completado`, **y** que el intento perdedor no deja ni una fila de basura.

### D-044 — El canario de inventario de `src/` pasa de "solo hay dos módulos" a lista cerrada declarativa
**Decidido:** el canario de la Ola 0 afirmaba `src/` == `['auth','db']`. Su intención era **detectar que
nadie esconda un cálculo tributario en un rincón**, y esa intención se conserva convirtiéndolo en lo que
ya es el patrón del proyecto para las superficies peligrosas (igual que el inventario `SECURITY
DEFINER`): una **lista cerrada** de `['auth','db','domain','ingest','services']`. Un `src/ai/` de A5 en
la Ola 2 hará fallar la prueba, que es exactamente el punto: obliga a declararlo y a barrerlo, no a
colarlo.

Por el mismo motivo se reescribió el segundo canario. «Las tablas normativas están vacías» ya no
significa «A1 no ha trabajado»; ahora afirma que **aplicar solo las migraciones deja las nueve tablas en
cero** —el dato vive en `db/seeds`, no se cuela por una migración— y se le añadió el complemento
indispensable: **con** los seeds, esas tablas sí traen datos, así que ningún caso dorado está pasando
sobre el vacío.

### D-045 — La costura A3↔A6 no la probaba nadie, y era la más peligrosa del proyecto
**Hallazgo:** A3 probó el motor con datos reales **sin llegar al asiento**. A6 probó el asiento con un
concepto de `aplica_* = false`, es decir **con cero retenciones** — lo dice el encabezado de
`tests/services/causacion.test.ts` con todas las letras. Nadie había juntado las dos mitades: un
documento que entra por la cola, se resuelve con las tarifas de A1 y sale como un asiento **balanceado**
donde las retenciones son partidas de crédito y el proveedor cobra el neto. Es justo donde un error de un
centavo en la agregación o en el redondeo produce un asiento que la base rechaza (`LG002`) — o peor, uno
que cuadra por casualidad con un valor equivocado.

**A14 escribió esa prueba y PASA:** caso dorado 1 de punta a punta, con seeds reales, débito de gasto
$1.000.000 e IVA $190.000, crédito 2365 $40.000, 2367 $28.500 y proveedores $1.121.500, descuadre cero,
**publicado**, y la traza de `retention_applied` amarrada al asiento con su norma. Queda como prueba
permanente: cualquier cambio en la agregación de A3 o en la construcción de partidas de A6 la rompe.

### D-046 — La excepción de "parámetro operativo" se acepta solo si la tabla donde vive NO puede expresar un valor tributario
**Contexto:** para desbloquear V-6, A1 cargó `rounding_rule` con un `norma_respaldo` que dice, con todas
las letras, que es un **PARÁMETRO OPERATIVO y no una norma tributaria**, porque no hay decreto que citar
y no corresponde inventar uno. A14 tenía que decidir si ese respaldo es aceptable o si abre la puerta a
que mañana entre un valor tributario disfrazado de parámetro operativo.

**Adjudicado: se ACEPTA**, y no por el argumento escrito sino porque la excepción está **acotada por el
esquema**, que es lo único que no depende de la buena fe del agente siguiente:

- **`rounding_rule` no tiene dónde escribir una tarifa.** Sus dieciséis columnas son identidad, alcance,
  vigencia y traza; las únicas dos que gobiernan el cálculo son `modo` —restringido por un `CHECK` a los
  **cinco** modos que `src/domain/dinero.ts` implementa de verdad— y `multiplo`, un `bigint` de centavos
  que es el **escalón** del redondeo, no un factor que multiplique ninguna base. **No hay ni una columna
  `numeric` en toda la tabla.** Una tarifa no cabe físicamente. Hay prueba de las dos cosas, y si alguien
  añadiera una columna capaz de llevar un valor tributario, falla.
- **El motor sigue negándose cuando el parámetro falta**, que era el comportamiento que la fila podía
  haber tapado. A14 lo probó por comportamiento y no por conteo de filas: cerrando la vigencia de **toda**
  regla de redondeo (el único `UPDATE` que D-012 permite) y causando una factura de julio de 2026, el
  pipeline devuelve `revision_manual` con motivo `sin_regla_de_redondeo_vigente` y **no deja ni un asiento
  ni una retención a medias**. Cargar un valor por defecto no desactivó la honestidad del motor.
- **El valor por defecto es de verdad sobreescribible por datos.** A14 lo comprobó con un modo y un
  múltiplo distintos: con solo los seeds, el motor resuelve `half_up`/100; en cuanto la empresa inserta su
  propia fila (`truncar`/100000, al mil), el motor resuelve esa. Sin tocar código ni redesplegar — que es
  literalmente el cuarto criterio de la compuerta aplicado a este parámetro.

**Regla que queda establecida:** un agente puede cargar un parámetro sin norma tributaria detrás **solo
si** (a) lo declara como operativo en `norma_respaldo`, (b) la tabla donde vive es incapaz de expresar una
tarifa, base, UVT o tope, y (c) existe prueba de que el motor sigue rechazando cuando el parámetro falta.
Si las tres no se cumplen, es un valor inventado con buena letra y aplica la advertencia 17.5.

### D-047 — A1 tocó dos aserciones de A14 y NO las debilitó: las dejó más fuertes (verificado línea por línea)
**Contexto:** A0 autorizó a A1 a actualizar las dos pruebas que A14 había dejado afirmando **en positivo**
que había cero reglas de ReteICA y cero reglas de redondeo — las que debían fallar en cuanto A1 cargara
los datos. A14 verificó el diff, que es lo que le toca cuando el agente vigilado toca el instrumento que
lo vigila.

**Veredicto: no debilitó nada, y una de las dos quedó mejor de lo que estaba.**

- La prueba de estado pasó de tres conteos (`0/0/0`) a **tres conteos exactos (`1/1/1`) más cinco
  comprobaciones nuevas**: Bogotá y Cali siguen en cero, la tarifa de Medellín es **byte a byte** la de
  `municipality_ica_rule`, `ciiu_activity_id` es `NULL`, la norma sigue citando el acuerdo, la regla de
  redondeo es global y de tipo `todos`, y su modo está dentro de la lista cerrada de cinco. Más superficie
  vigilada, no menos.
- La prueba de "el motor se niega cuando falta el parámetro" ya no podía apoyarse en una tabla vacía, y A1
  la reemplazó por algo **mejor que lo que A14 tenía**: contra el motor real, un hecho anterior a la
  vigencia del parámetro por defecto no encuentra regla y uno posterior sí. Deja de contar filas y pasa a
  ejercitar la resolución por vigencia.
- **A1 detectó y reportó** que las dos aserciones no estaban en el archivo que A0 le indicó, y verificó
  cuáles eran. Es la conducta correcta.

**Lo único que A14 encontró y endureció:** en la primera, la comparación de tarifas usaba encadenamiento
opcional (`resultado.medellin?.tarifa` contra `resultado.medellin?.tarifa_a1`). Si la consulta no
devolviera fila, ambos lados serían `undefined` y la comparación **pasaría en el vacío**. La siguiente
aserción lo habría cazado igualmente (`toBeNull()` falla sobre `undefined`), pero una prueba no debe
depender de que la de al lado la rescate: A14 añadió que la fila **tiene que existir** y que la tarifa
**tiene que ser una cadena**.

### D-048 — Los casos 9 y 10 siguen sobre andamiaje, y eso ya NO es deuda de la Ola 1
**Adjudicado:** tras el desbloqueo, el caso 8 (Medellín) pasa **sin andamiaje ninguno** — A14 lo probó de
punta a punta contra los seeds del repositorio, sin insertar una sola regla. Los casos 9 y 10 (Cali)
siguen necesitando una regla materializada por la suite, pero **por una causa distinta y de otro dueño**:

- Lo que esos dos casos **discriminan** está verificado con datos reales: el 9 discrimina la **base
  municipal de servicios** (Cali 3 UVT = $157.122 contra Medellín 15 UVT = $785.610, ambas cargadas y
  verificadas por A1, ambas recalculadas por A14 desde la base), y el 10 discrimina **qué actividad manda**
  cuando el proveedor tiene una en Bogotá y otra en Cali. Ninguna de las dos cosas depende de la magnitud
  de la tarifa.
- Lo que falta es la **tarifa de ICA por actividad de Cali**, y no falta por descuido: la sección 7.5 **no
  trae ni un número** del Acuerdo 0321 de 2011, y la de Bogotá que sí trae (74901 = 7,66‰) no se puede
  guardar porque el código municipal tiene cinco dígitos y `ciiu_activity` exige cuatro (V-5).

**Conclusión:** esto deja de ser trabajo pendiente de la Ola 1 y pasa a ser (a) una **decisión de esquema
de A2** y (b) un dato de **verificación humana**. La conducta del motor ante esa ausencia —negarse y
dejar el motivo escrito— es la correcta según la advertencia 17.5, y está probada. Se cierra la Ola 1 con
esa limitación **declarada en la tabla de casos dorados**, no escondida.

---

## Decisiones de QA adversarial de A14 (compuerta de la Ola 2)

### D-049 — El acotamiento de A8 al detector de la Regla de Oro 2 está REFUTADO. Salvaguarda restituida
**Qué había hecho A8:** acotar la regla `insert_normativo` a `db/migrations/`, de modo que ya no aplica a
`src/`. Su necesidad es **legítima** (§6.1: `src/services/parametrizacion.ts` inserta en `tax_rule` a
propósito, porque es la vía por la que un contador crea una vigencia nueva sin desplegar). Pero es el
acotamiento de una salvaguarda, o sea la dirección peligrosa, y se apoyaba en una afirmación verificable
escrita en el propio código: *«si alguna vez lo tuviera, lo cazarían las otras cinco reglas»*.

**A14 no la leyó: la envenenó.** Trece muestras de código pasadas por las reglas reales, con
`archivo = 'src/services/parametrizacion.ts'`. **Cuatro escaparon enteras:**

```
INSERT INTO tax_rule (base_minima_uvt) VALUES (2)          -> NADIE la caza
INSERT INTO rounding_rule (multiplo)   VALUES (1000)       -> NADIE la caza
INSERT INTO tax_calendar (dia)         VALUES (12)         -> NADIE la caza
INSERT INTO tax_rule (tarifa) VALUES (4::numeric/100)      -> NADIE la caza
```

La afirmación es **falsa**, y falla justo donde más duele: las cinco reglas restantes se anclan en
decimales, en el signo de porcentaje o en enteros de cinco cifras o más. Un valor tributario que sea un
**entero pequeño** —una base mínima en UVT, un múltiplo de redondeo, un día de calendario— les es
invisible. Y los tres primeros son literalmente lo que la Regla 2 enumera: «tarifa, base mínima, valor de
UVT, salario mínimo, porcentaje, tope o **calendario**». Antes del acotamiento, los cuatro los cazaba la
regla por su forma, sin mirar el valor.

**Adjudicación: el acotamiento de `insert_normativo` se ACEPTA, pero el hueco NO.** No se restituye la
prohibición total —rompería la vía legítima de A8—: se restituye con la forma que separa el caso legítimo
del peligroso, que es **la que el propio A8 invocó** en su justificación («esos INSERT usan siempre
parámetros ligados»). Regla nueva en `tests/adversarial/valores-tributarios.test.ts`:

> En `src/` y `app/`, un `INSERT` sobre una tabla normativa puede llevar **solo** marcadores ligados
> (`$1`), `NULL`, `DEFAULT` y llamadas a función. **Ni un literal numérico.** Si el valor llega del
> contador en tiempo de ejecución, va en un `$n`; si está escrito en la sentencia, es un valor quemado.

Es un escáner **por sentencia**, no por línea, así que ve los `INSERT` multilínea que un barrido
línea-a-línea no puede ver. Trae su propio canario de seis venenos (incluido uno multilínea) y una
muestra inocente con la forma exacta que usa A8. Verificado de punta a punta: inyectando dos de los
venenos en el `parametrizacion.ts` **real**, la prueba los reporta con archivo, literal y sentencia.

**Segundo hallazgo, del mismo sitio (V-14):** al acotar la regla, las muestras del canario dejaron de
pasarle el `archivo`, así que `insert_normativo` **devolvía `false` para todas** y ya no la ejercitaba
nadie. La muestra `INSERT INTO tax_rule (tarifa) VALUES (0.04)` la cazaba `fraccion`, no ella. Corregido:
las muestras declaran su ruta y se añadió una que **solo** esa regla puede cazar (un `INSERT INTO
tax_concept` sin un solo número).

**Tercer refuerzo, por la Ola 2:** ahora que existe `app/` —la superficie con más decimales legítimos del
repositorio (CSS, `step=`, `width=`)—, el barrido ya no puede «alcanzarla» de forma implícita. Se exige
explícitamente que vea archivos de `app/parametros` y `app/bandeja` y que entre ellos haya `.tsx`: si
alguien excluyera `app/` o quitara la extensión para acallar la regla `fraccion`, la prueba cae.

### D-050 — `aprobarAsientosEnLote` no tenía SAVEPOINT: su `catch` por ítem era decorativo. CORREGIDO por A14
**Hallazgo, medido sobre la bandeja real de A7 con 30 empresas montadas.** El criterio de salida dice
«aprobar 50 de un golpe». A14 mandó las 50 y leyó el mensaje que la interfaz le devolvió al contador:

```
<id>: null value in column "ip" of relation "approval" violates not-null constraint
<id>: current transaction is aborted, commands ignored until end of transaction block
<id>: null value in column "ip" ...
<id>: current transaction is aborted ...
```

El patrón alterna porque cada empresa es su propia transacción: dentro de cada una, el primer ítem
fallaba por su propio motivo y **el segundo moría contagiado**. `aprobarAsientosEnLote` envolvía cada
ítem en un `try/catch`, pero un error del motor **aborta la transacción entera**: a partir de ahí toda
sentencia devuelve `25P02` y el `catch` solo sirve para coleccionar mensajes inútiles. Con 50 filas de 30
empresas, una sola fila rancia —un asiento que otro contador ya publicó, un período cerrado— se llevaba
por delante el trabajo de toda la pantalla, y el contador no tenía forma de saber cuáles se aprobaron.

**Es exactamente el mismo hallazgo que D-043 en `causarFactura`, en el otro extremo del flujo:** aislar
la escritura de cada unidad de trabajo para que el fallo de una no contamine a las demás.

**Corregido por A14** en `src/services/causacion.ts`: `SAVEPOINT lote_aprobacion_<n>` por ítem, con
`RELEASE` en el camino feliz y `ROLLBACK TO` + `RELEASE` en el `catch`. Con prueba de regresión que
**discrimina de verdad**: se comprobó desactivando el `SAVEPOINT` y verificando que la prueba **falla**
(«expected error not to contain \<id-de-la-fila-sana\>»), no solo que pasa con él.

### D-051 — Los cambios de A5 al caso dorado 19 se ACEPTAN: no perdió alcance, ganó
**Qué cambió A5:** la aserción «ningún archivo de `src/` menciona `fetch|anthropic|…`» pasó de
`toEqual([])` a `toEqual(['src/ai/proveedor.ts', 'src/ai/proveedores/anthropic.ts'])`, más dos
comprobaciones nuevas (que nada fuera de `src/ai/` tenga red, y que nadie importe el adaptador de forma
estática en todo `src/`).

**Verificado con canario envenenado, no leyendo el diff.** Dos ataques sobre `src/services/consulta.ts`,
el archivo más inocente que hay:

| Veneno inyectado | Resultado |
|---|---|
| `import { crearProveedorAnthropic } from '../ai/proveedores/anthropic.js'` | **CAZADO** — la lista cerrada crece a 3 y la igualdad falla |
| `export async function _n() { return fetch('https://ejemplo'); }` | **CAZADO** — mismo mecanismo |

La lista cerrada es una **igualdad**, no un `includes`: mover el adaptador, añadir un segundo proveedor o
meter una ruta de red en cualquier otro archivo de `src/` la rompe. Es más fuerte que el `toEqual([])`
original, que solo sabía decir «hay algo» sin obligar a nombrarlo. **ACEPTADO.**

### D-052 — El caso dorado 19 se cierra con una MINA, no con un contador
El contador de A5 (`ProveedorLlmFalso.llamadas === 0`) demuestra que **ese objeto** no se llamó. No
demuestra que no se llamara a otro. A14 lo cerró con dos instrumentos que no admiten interpretación:

1. **`ProveedorMina`** — un `ProveedorLlm` que **lanza una excepción** en cuanto alguien lo invoca. Si el
   flujo lo llamara, la prueba muere; no hay número que interpretar.
2. **Espía sobre `globalThis.fetch`** durante toda la segunda pasada: si el proceso intentara salir a la
   red por cualquier vía (el flujo, un `import()` perezoso, telemetría), revienta ahí.

La segunda factura del mismo proveedor con la misma descripción, escrita **distinta** (mayúsculas,
tildes, otro consecutivo de orden), se resuelve desde `memoria_clasificacion` con `origen = 'memoria'`,
`llamadasLlm = 0` y `costoMicrosUsd = 0`. Y una tercera comprobación que A5 no hacía: **con
`proveedor: null`** —sin ningún LLM configurado en absoluto— la clasificación sigue funcionando. El
ahorro no depende del modelo; el producto tampoco.

**Regla de Oro 4, atacada de frente:** un proveedor que devuelve un código **fuera del catálogo cerrado**
con score máximo no clasifica nada (`conceptoId = null`, decisión distinta de `aplicar`), y
`clasificarDocumento` **no escribe ni una fila** de `retention_applied` ni de `journal_entry`. El LLM
propone; el motor calcula.

### D-053 — Las diez funciones `SECURITY DEFINER` nuevas se ACEPTAN: ninguna es un oráculo de existencia
Los cuatro agentes ampliaron el inventario cerrado y **los cuatro actualizaron las dos copias** que A14
duplicó a propósito en D-042. Esa es la conducta que se buscaba. Pero declarar bien no exime de auditar
lo declarado.

**Método de A14 (no leer el `WHERE`, interrogar a la función):** a cada una se le pasa el identificador
**real** de un objeto de otra firma y, por separado, uno **inventado**, y se exige que las dos respuestas
sean **idénticas**. Si difieren, la función confirma que el objeto existe.

| Función | Autor | Veredicto |
|---|---|---|
| `app.fecha_minima_vigencia_tax_rule` | A8 | idéntica con regla ajena y con inventada |
| `app.fecha_minima_vigencia_municipio_ica` | A8 | idéntica |
| `app.fecha_minima_vigencia_tenant` | A8 | sin parámetros; exige `parametro.editar` |
| `app.simular_impacto_tax_concept` | A8 | idéntica |
| `app.simular_impacto_municipio_ica` | A8 | idéntica |
| `app.simular_impacto_valor_base` | A8 | sin parámetros; exige `parametro.editar` |
| `app.empresas_accesibles` | A7 | sin parámetros; solo la firma en sesión |
| `app.crear_token_integracion` | A13 | usuario de otra firma y usuario inexistente dan **el mismo** `IG003` |
| `app.revocar_token_integracion` | A13 | token ajeno y token inventado dan lo mismo, y el ajeno **sigue vivo** |
| `app.listar_tokens_integracion` | A13 | solo la firma en sesión |

Y el permiso no es decorativo: un `auxiliar_causacion` que llame a las de parametrización recibe `SE002`,
y crear un token sin `usuario.administrar` recibe `SE002`. Ninguna acepta un `tenant_id` por parámetro —
si lo hiciera, D-020 se reabriría por la puerta de al lado.

### D-054 — V-9 está RESUELTA por A13, y la prueba es que NO tuvo que tocar nada de A12
**Lo que A14 verificó, no lo que A13 reportó:**

- `db/migrations/090` **no redefine** `app.abrir_sesion` ni `app.session_context`. El token de
  integración es un **segundo camino de primer factor** que desemboca en el mismo `abrir_sesion` intacto,
  igual que `buscar_credencial` para el humano (D-023). D-020/D-021 no se rodean: no hay forma nueva de
  decirle a la base «soy el tenant X».
- **`app.integration_credential` está tan cerrada como `app.session_context`.** Comprobado con
  `has_table_privilege` sobre las dos tablas y los dos roles de aplicación: **cero privilegios**, ni
  siquiera de lectura. El aislamiento ahí es por privilegio, no por política, igual que en D-021.
- **`app.autenticar_token_integracion` está fuera del alcance de `app_user`**: el intento muere con
  `42501` —el motor le niega el `EXECUTE`, no llega ni a entrar en la función—, que es más fuerte que un
  rechazo de dominio. Solo `app_auth`, exactamente como `abrir_sesion` y `buscar_credencial`.
- **El rol `sistema_ingesta` es de mínimo privilegio real, medido:** tiene **exactamente**
  `documento.cargar` y `documento.leer`, y ninguno más. Una sesión abierta con ese rol recibe `SE002` al
  pedir `asiento.aprobar` y `SE002` al pedir `parametro.editar`.
- Un administrador de la firma A **no puede** crear el usuario de sistema en la firma B: lo rechaza la
  RLS (`42501`), no un `if` de aplicación.

**V-9: CERRADA.** Y **V-1 sigue abierta**, correctamente: A13 no tocó el `GRANT` de
`app.resolver_empresa_por_buzon` (verificado en la migración 032) y **hizo bien**, porque el camino de A4
(`src/ingest/persistencia.ts`) todavía la usa. Lo que cambia es que ahora **está desbloqueada**: el rol de
sistema que D-042 exigía como precondición ya existe.

### D-055 — La frontera de n8n (13.2) se verifica sobre los JSON, no sobre el reporte
A14 barrió los seis `n8n/*.workflow.json` con criterio propio: cero nodos de base de datos (`postgres`,
`mysql`, `mongo`, `redis`, `supabase`, `timescale`…), cero nodos de ejecución (`executeCommand`, `ssh`),
cero SQL (`INSERT INTO` / `UPDATE` / `DELETE FROM` / `SELECT … FROM`), cero menciones a una tabla del
ledger (`journal_entry`, `journal_line`, `retention_applied`, `tax_rule`, `uvt_value`), cero vocabulario
tributario (`retefuente`, `reteiva`, `reteica`, `autorretenci`, `tarifa`, `uvt`, `smmlv`) y cero imports
de código del repositorio. **n8n orquesta y notifica; la aplicación decide y calcula.**

### D-056 — La compuerta de la Ola 2 se prueba por la INTERFAZ, no por la capa de servicios
Dos de los tres criterios de salida hablan de lo que hace **un contador**, no de lo que hace una función.
Desde esta ola existe `app/`, así que se prueban por donde se van a usar: las acciones de servidor de
Next.js, con su `FormData`, su cookie de sesión y su `redirect`
(`tests/adversarial/compuerta-ola2-interfaz.test.ts`).

**Lo único simulado es el transporte** (`next/headers`, `next/navigation`) y la conexión
(`app/lib/db.ts`). La sesión la emite `app.abrir_sesion` de verdad, el rol es real, la RLS está activa,
los triggers de vigencia y de ledger son los de producción. Un mock de `withSessionContext` habría
convertido la prueba en teatro; un mock de `cookies()` solo sustituye al navegador.

**Consecuencia para la Ola 3:** cualquier pantalla nueva se prueba igual. Probar el servicio y no la
acción de servidor deja sin verificar precisamente la costura donde el cliente elige qué enviar — que es
donde vive el contador hostil.

---

## Decisiones de QA adversarial de A14 (compuerta de la Ola 3)

### D-057 — El criterio de los 10.000 asientos se comprueba contra las TABLAS CRUDAS, no contra la vista; y exige `ANALYZE`

**Problema:** A9 cierra el criterio de la §12 comparando `balanceDePrueba` con `sumaDirectaLedger`. Las
dos leen la **misma** vista `v_journal_line_reporte`. Esa comparación no puede fallar por la razón que el
criterio persigue: si la vista perdiera filas —y hace un **INNER JOIN con `account`**, que es la forma
clásica de perderlas—, ambas perderían las mismas y el reporte seguiría «cuadrando» contra sí mismo.

**Decidido:** la comprobación de A14 usa **tres** fuentes: (1) el balance, (2) `journal_line JOIN
journal_entry` **crudas** y (3) lo que el propio generador de datos acumuló **en memoria**. Y compara
**grupo por grupo** en los cinco niveles del PUC, incluido el saldo inicial, no solo el gran total: un
total correcto con dos grupos intercambiados no pasa. Se conserva además la comparación circular de A9,
para que si algún día divergen se vea cuál de las dos cambió.

**Y una condición de ejecución que no es un truco:** la carga masiva termina con `ANALYZE`. A14 midió que
sin estadísticas el `JOIN` bajo RLS degenera en bucle anidado y crece cuadráticamente (10 s / 39 s / 159 s
con 2.000 / 4.000 / 8.000 partidas; **4 ms** tras `ANALYZE`). No es la RLS: la misma consulta sin JOIN va
en 3 ms bajo RLS, y `count(*)` con las mismas funciones de sesión en el `WHERE` va en 1 ms. Es el
planificador sin estadísticas. Cualquier PostgreSQL real lo hace por autovacuum; tras una carga masiva hay
que hacerlo a mano. **Consecuencia para A15**, anotada en la propia prueba.

### D-058 — La idempotencia por clave no cubre el solape. El cierre de ejercicio necesitaba las dos cosas

**Problema (V-15):** `cerrarCuentasDeResultado` es idempotente por `idempotency_key =
cierre:<desde>:<hasta>`, y eso está bien: cerrar diez veces el mismo ejercicio deja un asiento. Pero
`saldosACerrar` **excluye los asientos de tipo `cierre`** precisamente para poder repetirse — y esa misma
exclusión hace que un cierre de un rango **distinto pero solapado** vuelva a ver los ingresos y gastos ya
cancelados y los cancele **otra vez**. A14 lo midió: tras cerrar 01-jun→30-jun y luego 15-jun→30-jun, la
cuenta de ingresos quedaba con **saldo débito** y el resultado del ejercicio en **cero**. Nada de eso se
puede deshacer editando: el ledger es inmutable.

**Decidido y corregido por A14:** antes de escribir nada, `cerrarCuentasDeResultado` rechaza con
`CierreSolapadoError` un rango que se solape con el de un asiento de cierre **ya publicado**. El rango del
cierre anterior **no se guarda en ninguna tabla nueva**: se lee de la propia `idempotency_key` del
asiento, que ya es dato del ledger. Un estado paralelo que dijera «hasta dónde está cerrado» podría
desincronizarse del ledger; la clave del asiento, no.

**Por qué rechazar y no «cerrar solo la diferencia»:** porque cuál es la diferencia es una decisión
contable, no aritmética. Si el cierre anterior estuvo mal, la Regla de Oro 1 ya dice qué hacer: se
reversa y se vuelve a cerrar. El mensaje del error lo dice con esas palabras.

### D-059 — Un entregable que no se puede descargar no cumple «se descarga». Se aplica el mismo estándar que en la Ola 2

**Problema (V-16):** la Ola 3 entrega veinte libros correctos, con sus cuatro hojas, que serializan a
`.xlsx` válido — y a los que **nadie puede llegar**: cero importadores de `src/reports/` fuera de las
pruebas, ninguna ruta, ninguna pantalla.

**Decidido:** se bloquea la ola. El criterio de salida de la sección 4 no dice «existe la función que
genera el Excel», dice «**todo reporte se descarga** en Excel», y la §11.1 razona por qué: «un reporte
que solo se ve en pantalla no sirve para el flujo de trabajo real de una firma contable». Esto ni
siquiera se ve en pantalla.

**Y es el mismo estándar que A14 ya fijó, no uno nuevo inventado para castigar a esta ola:** D-056 (Ola 2)
decidió que la compuerta se prueba **por la interfaz**, no por la capa de servicios, después de que la Ola
2 estuviera a punto de cerrarse con la aplicación sin compilar. Aceptar aquí una verificación de capa de
servicios sería contradecir esa decisión en la ola siguiente.

**Lo que A14 no hace, y por qué:** no escribe él la ruta. Construir el entregable y aprobarlo son el mismo
acto si los hace el mismo agente, y esta es la última compuerta del proyecto: es justo donde menos conviene
que el verificador sea también el autor. El desbloqueo está acotado a una sola cosa y todo lo demás queda
verificado y escrito para que no haya que rehacerlo.

### D-060 — Lo que A14 acepta de A10 y A11 sin reservas, para que nadie lo reabra

Tres afirmaciones de los reportes de esta ola resultaron **ciertas al verificarlas**, y quedan aceptadas
con la evidencia con la que se comprobaron, no con la palabra del autor:

1. **Las notas no pueden fabricar una revelación.** No por disciplina del autor, sino por **forma del
   tipo**: `NotaEstadosFinancieros` no tiene campo de contenido, y la columna «REDACCIÓN DE LA NOTA» del
   libro se escribe siempre vacía. Comprobado en las trece notas, campo por campo y celda por celda. Es la
   aplicación correcta de la advertencia 17.5 a los estados financieros: un estado financiero que inventa
   una revelación es peor que uno incompleto, igual que una tarifa inventada es peor que una faltante.
2. **El EFE sale vacío si nadie marcó las cuentas de efectivo.** `es_efectivo` es estrictamente
   `rubro_efe = 'efectivo_y_equivalentes'`; sin marca es `NULL` y no entra. La presunción que sí existe
   —la **actividad** de cada flujo— se marca como `presumida`, se cuenta y se lista en su papel de
   trabajo. Presumir y avisar es honesto; presumir y callar sería inventar.
3. **La exógena no rellena nada por defecto.** Dirección y municipio ausentes salen como celda vacía en el
   plano y como fila en la hoja «Bloqueos» del Excel. Ni un `0`, ni un código DANE, ni «COLOMBIA».

Lo que **no** se acepta de esos reportes: la afirmación de A9 de que «todo `src/reports/` lo invoca un
route handler de Next.js» (**es falsa hoy**, V-16), y la idea de que la advertencia de alcance de los
formatos 1003/1006 «se le muestra al contador» — se le mostraría **si existiera la interfaz que la
consume**, que es justamente lo que falta; y en el Excel, que sí existe, no aparece (V-18).

### D-061 — Un catálogo de rutas se consulta por clave PROPIA, no por la cadena de prototipos

**Problema (V-19):** `app/api/reportes/[libro]/route.ts` resolvía el generador con `REPORTES[libro]`, y el
slug lo elige quien llama. En JavaScript ese acceso recorre el **prototipo**: `REPORTES['__proto__']`
devuelve `Object.prototype` —truthy, así que se salta el 404— y `REPORTES['constructor']` devuelve el
constructor `Object`, que además **es una función** y por tanto se llegaba a **invocar** como si fuera el
generador del reporte. El resultado observable era un 500 con un mensaje interno en vez de un 404 limpio.
No hay fuga —`conSesion` y `app.exigir_permiso` corren igual, y la RLS no se toca—, pero es la clase de
descuido que en otra ruta con menos suerte sí llega a algo.

**Decidido y corregido por A14:** `Object.hasOwn(REPORTES, libro) ? REPORTES[libro] : undefined`. Y la
regla general, que vale para cualquier despacho por clave que venga de fuera (slugs, tipos de documento,
nombres de acción): **si la clave la elige el cliente, la búsqueda se hace por propiedad propia.** Quedan
nueve muestras de regresión (`__proto__`, `constructor`, `toString`, `valueOf`, `hasOwnProperty` y cuatro
de recorrido de ruta), y la prueba informa **todas** las que fallen, no solo la primera: la primera
versión se detenía en `__proto__` y dejaba sin ejecutar las cuatro siguientes.

### D-062 — V-16 no se cierra con «existe la ruta», sino con «no queda ningún libro huérfano»

**Problema:** la forma obvia de verificar la descarga es pedir un par de reportes por HTTP y ver que bajan.
Eso no cierra V-16: el defecto original no era que faltara *una* ruta, sino que **había veinte libros y
ningún consumidor**. Una ruta que sirviera dieciocho de veinte pasaría esa verificación y dejaría dos
libros tan inalcanzables como antes.

**Decidido:** la prueba de A14 (`tests/adversarial/compuerta-ola3-ruta.test.ts`) **enumera en tiempo de
ejecución los generadores exportados por `src/reports/`** (`generarLibro*`, `generarBalance*`,
`generarCertificado*`, `generarRelacion*`, `generarMovimiento*`, `generarDetalle*`, `generarEstado*`,
`generarNotas*`, `generarFormato*`), exige que sean **veinte** y que **todos** aparezcan cableados en el
fuente de la ruta; y comprueba con `git grep` que la ruta es el **único** importador de `src/reports/`
fuera de `tests/` — la afirmación de A9, verificada contra el árbol y no aceptada por escrito. Si mañana
alguien añade un libro y olvida su slug, o si un segundo importador aparece por otro camino, esa prueba
cae. **V-16 no puede reaparecer en silencio.**

Esto es la forma concreta, para módulos, de la convención que la Ola 3 dejó escrita: *un módulo sin
consumidor no está terminado*.

---

## Decisiones de la Ola 4 (A16) — «Operación real»

### D-063 — La carga masiva deja UNA fila de auditoría por archivo, no una por registro

**Problema:** `audit_log.accion` no contemplaba una carga de archivo. Con solo la auditoría fila a fila de
`app.trg_audit`, cargar 400 terceros dejaba 400 filas `INSERT` sin nada que las atara entre sí: nadie
podía responder «¿de qué archivo salió esto y quién lo subió?», que es exactamente la pregunta que se hace
un revisor tres meses después.

**Decidido:** acción `'CARGA_MASIVA'` y función `app.registrar_carga_masiva(entidad, archivo, filas_ok,
filas_error, detalle)`. Escribe una cabecera —catálogo, nombre de archivo, filas que entraron, filas que
se rechazaron— **dentro de la misma transacción** que inserta las filas. No sustituye la auditoría fila a
fila: la resume y la ata a un archivo.

**Trampa que costó una pasada:** el `CHECK` de `audit_log.accion` se reescribe entero, no se «amplía».
La primera versión copió la lista de 009 y perdió los dos verbos de token que había añadido 090; el motor
no lo avisa al migrar, lo avisa mucho después, cuando el canal de correo intenta escribir su rastro.

### D-064 — El PUC de una empresa SOBREESCRIBE el genérico cuenta por cuenta; no lo reemplaza

**Problema reportado por el usuario:** al sacar reportes el sistema pedía cuentas del PUC y no había
ninguna cargada. El PUC genérico de los seeds cubre los veinte casos dorados, no una empresa real, y no
existía ni pantalla ni servicio para cargar el propio.

**Decidido:** para cada `codigo` gana la fila del alcance más específico que exista —**empresa > firma >
global**— y esa regla vive en la **base**, en la vista `v_account_efectivo`, no en TypeScript. Se hizo así
porque el ledger, los reportes, la causación y la pantalla tienen que ver EXACTAMENTE el mismo PUC: con la
regla repartida en consultas, el primer servicio que la olvidara imputaría contra una cuenta que la
pantalla dice que no existe.

**Alternativa descartada:** «el PUC propio reemplaza el genérico entero» como comportamiento por defecto.
Obligaría a cargar las ~200 cuentas del 2650 a toda empresa que solo quiera añadir tres auxiliares, y el
primer efecto de un archivo incompleto sería un ledger sin cuentas donde imputar.

**Cómo se esconde una cuenta heredada:** no se borra —la RLS no deja escribir la fila global, y borrarla
se la quitaría a las otras 59 empresas de la firma—. Se crea la propia con el mismo código y
`activo = false`, y la precedencia hace el resto (`ocultarCuentaGenerica`).

### D-065 — «Usar solo mi PUC» es un interruptor explícito por empresa, y se niega a dejarla sin cuentas

**Decidido:** una empresa que trae su plan de cuentas de otro software sí puede querer el reemplazo total.
Se enciende a mano, por empresa, en `company_setting` clave `'puc.solo_propio'`, y entonces
`v_account_efectivo` deja de mostrarle lo global y lo de la firma. **Nunca es efecto colateral de cargar
un archivo.**

`fijarModoPuc` se **niega** a encenderlo si la empresa todavía no tiene ninguna cuenta propia imputable:
hacerlo dejaría el ledger sin ningún destino válido y el síntoma aparecería mucho después, al intentar
causar una factura, con un error que no menciona esa pantalla.

### D-066 — El rol todopoderoso lo es por definición, no por sus filas de `role_permission`

**Problema:** `admin_firma` era todopoderoso solo porque 014 le insertó todas las filas. Un `DELETE` sobre
esa tabla —desde la pantalla de administración nueva, o desde un `psql`— dejaba a la firma **sin nadie que
pudiera volver a otorgar permisos**. La Ola 4 pedía un rol «blindado a nivel de código, no solo de datos».

**Decidido:** un `if` en la capa de servicio cumpliría la letra y no el fondo: la interfaz no es el único
camino a la base. El blindaje son tres cosas del motor (migración 170):

1. `app.tiene_permiso` concede CUALQUIER permiso a un rol `es_todopoderoso` **sin mirar
   `role_permission`**. Vaciar la tabla no lo desarma.
2. Un trigger rechaza con `RL001` todo `UPDATE`/`DELETE` sobre las filas de `role_permission` de ese rol
   — también para el superusuario: el trigger no mira quién es.
3. Otro trigger rechaza degradarlo, inactivarlo o borrarlo, **y también rechaza crear uno nuevo desde una
   sesión de aplicación**: una firma que pudiera fabricarse roles todopoderosos convertiría el blindaje
   en un adorno. `es_todopoderoso` solo se enciende sin sesión, es decir por migración.

La prueba que lo demuestra no cuenta filas: inserta en `permission` un permiso que **nadie tiene
otorgado** y comprueba que la sesión de `admin_firma` lo ejerce igual, y que la de `contador` no.

### D-067 — Roles propios de la firma, presentados como matriz «módulo × ver / editar / aprobar»

**Decidido:** `role.tenant_id` ya permitía roles de firma desde 002; faltaba (i) poder inactivar un rol
sin borrarlo (`role.activo`; un rol inactivo no concede nada, ni siquiera lo que tenga otorgado) y (ii) el
EJE VERTICAL para presentar el catálogo como lo pide un administrador. Ese eje es
`permission.accion_tipo` (`ver` / `editar` / `aprobar` / `administrar`), una **columna del catálogo**, no
una tabla nueva: es un atributo del permiso, no una entidad.

**Lo que NO se hizo:** inventar permisos «de interfaz». Cada casilla de la matriz es un código de permiso
real de los que exigen los triggers de la base, y `fijarPermisosDeRol` rechaza cualquier código que no
esté en el catálogo del producto — una firma no puede inventarse permisos.

**Borrar un rol que alguien tiene otorgado no lo borra: lo inactiva.** El `ON DELETE CASCADE` de
`role_permission` dejaría a esas personas sin rol de un golpe, sin que nadie lo pidiera.

### D-068 — «El junior corrige, el revisor aprueba» es un ESTADO del recurso, no un permiso especial

**Decidido:** `document_correction.estado` (`pendiente_revision` / `aprobado` / `rechazado`). El permiso
`documento.aprobar_correccion` decide **quién** mueve el estado; el estado vive en los datos, y por eso se
puede consultar, filtrar y auditar. `obtenerCorreccionesVigentes` (A7) filtra por `estado = 'aprobado'`:
el motor solo usa las aprobadas.

**Por qué el estado inicial depende de quién corrige, y no es siempre `pendiente_revision`:** un contador
que corrige su propio documento no tiene a quién pedirle la aprobación. Quedaría una bandeja que nadie
vacía y, en la práctica, la gente aprobaría su propia fila — que es peor que no tener circuito. Quien ya
tiene el permiso inserta directamente en `aprobado`, firmado por él; quien no lo tiene deja la corrección
pendiente.

**Qué pasa si nadie aprueba:** el documento se causa como si la corrección no existiera —el comportamiento
anterior a la Ola 4— y la corrección sigue visible como pendiente. Nunca se aplica a medias.

**Los DATOS de una corrección siguen siendo inmutables** (`RL002`): lo único que se puede mover es su
estado, y solo desde `pendiente_revision`. Corregir una corrección es insertar otra.

### D-069 — La contraseña que fija un administrador sirve para UNA entrada

**Problema:** un administrador que le fija la contraseña a otro **la conoce**. Si esa contraseña siguiera
valiendo indefinidamente, sería un suplantador permanente de cualquiera de su firma, y ningún registro de
auditoría podría distinguir al uno del otro.

**Decidido:** `"user".debe_cambiar_password`. La ponen `crearUsuario` y `fijarPasswordDeUsuario`; la apaga
solo el propio usuario al cambiarla en `/cambiar-password`, y la portada le desvía ahí mientras esté
puesta. Las dos operaciones de administrador **revocan las sesiones abiertas** del usuario en la misma
transacción: sin eso, «cambiarle la contraseña» no echaría a nadie, que es la mitad de las veces por lo
que se hace.

`cambiarMiPassword` exige la contraseña ACTUAL aunque la sesión ya esté abierta: una sesión ajena —un
portátil sin bloquear, una cookie filtrada— no debe poder convertirse en la toma de control permanente de
la cuenta.

**Detalle que destapó la prueba:** `app.trg_permiso_usuario` (016) tiene una lista blanca de columnas de
credencial propia, y `debe_cambiar_password` no estaba en ella. Apagarla exigía ser administrador, así que
la única persona que no podía cumplir la obligación era justo aquella a quien se le había impuesto. La
migración 170 reescribe la función con la columna dentro.

### D-070 — Una fila de un archivo es una VIGENCIA NUEVA, nunca un `UPDATE` de un valor

**Decidido:** para las tablas versionadas, la carga masiva no es un «upsert». Si la fila choca con una
vigencia abierta de la misma clave lógica, `src/services/catalogos.ts` **no reimplementa el cierre**:
llama a la función de `parametrizacion.ts` que ya lo sabe hacer (`editarTarifaTaxRule`, `editarUvtValue`,
`editarMunicipioIcaRule`…). Así la carga masiva hereda gratis las seis conductas de la sección 6.2 —norma
obligatoria, no retroactividad sobre lo publicado, append-only, permiso, auditoría, simulador—.

Los catálogos SIN vigencia (municipio, CIIU, concepto tributario, centro de costo) sí admiten
actualización directa: no llevan `vigente_desde`, no entran en ninguna resolución por fecha, y corregirle
el nombre a un municipio no reescribe ningún hecho económico.

### D-071 — La plantilla y el validador son la misma lista leída dos veces

**Decidido:** `src/services/carga-masiva/definiciones.ts` es la única fuente de verdad de la carga masiva.
De ella salen las tres cosas que si no habría que mantener sincronizadas a mano: los `.xlsx` de
`/archivos-masivos/`, la validación de cada fila que sube el usuario, y la pantalla `/carga-masiva` que
explica cada columna. Si el esquema gana una columna obligatoria, se añade una vez y las tres cambian
juntas.

**Consecuencia de diseño que importa:** `validar()` es una función PURA que solo convierte texto a tipos y
comprueba formatos, e `insertar()` no valida nada de negocio — llama al servicio de dominio que ya existía
para la carga fila a fila. Si algún día alguien mete una regla tributaria en `validar()`, habrá dos
motores tributarios y uno de los dos estará mal.

La ruta `GET /api/plantillas/:catalogo` **genera la plantilla en el momento** en vez de servir el archivo
de `/archivos-masivos/`: un despliegue con el directorio viejo entregaría plantillas que su propio
importador rechaza. El directorio existe para poder mirarlas sin levantar el producto y para que un
cambio de esquema se vea en el `git diff`.

**Los importes y las tarifas se convierten con cadenas, nunca con `Number`** (Regla de Oro 5), y el
separador de miles **no se adivina**: «1.500» es mil quinientos en Colombia y uno coma cinco en el resto
del mundo. Se rechaza y se le pide al usuario que lo quite. Sin esa comprobación —que faltaba en la
primera versión y destapó una prueba— «1.500» habría entrado como un peso con cincuenta, en silencio.

### D-072 — Todo el archivo o nada, y nunca a medias en silencio

**Decidido:** tres cosas, con su motivo.

1. **Se valida todo antes de escribir nada.** Dos pasadas de solo lectura —formato de cada celda, y luego
   resolución de los códigos contra la base— antes del primer `INSERT`. Un contador que sube 400 terceros
   necesita la lista COMPLETA de lo que está mal, no el primer error.
2. **Si hay errores, por defecto no se escribe nada.** Se devuelve el informe (fila tal como se ve en
   Excel, columna y motivo) y el usuario elige: corregir y volver a subir, o pedir **explícitamente** que
   se carguen solo las filas válidas. Una carga parcial silenciosa deja al contador creyendo que tiene 400
   proveedores cuando tiene 383, y el descubrimiento llega el día del cierre.
3. **Una transacción por archivo, SIN savepoints por fila.** Es el caso opuesto al de D-050: allí 50
   aprobaciones independientes debían sobrevivir a que una fallara; aquí un savepoint por fila haría que
   el archivo entrara a medias, que es justo lo que el punto 2 evita.

El informe de errores viaja **dentro** de la excepción (`CargaRechazadaError`): hay que lanzar para que la
transacción se deshaga, y hay que devolver datos para poder enseñarle al contador qué filas fallaron.

### D-073 — Tres motivos por los que un reporte no sale, tres mensajes distintos

**Problema reportado:** pedir un reporte de una empresa recién abierta devolvía un `.xlsx` con la hoja
«Datos» vacía y ninguna explicación, o —cuando faltaba una cuenta— un JSON con el mensaje crudo de
PostgreSQL en la pestaña del navegador.

**Decidido:**

1. **Falta configuración sin la cual el reporte no puede existir** (ninguna cuenta imputable; una cuenta o
   un tercero que no están en esta empresa) → `409`, con el **enlace exacto** donde se arregla. No es un
   error del sistema: es una tarea pendiente.
2. **La configuración está y no hubo movimiento** → no es un fallo, es una respuesta. A un **navegador**
   se le dice «no hay datos para tales criterios» con las fechas y el nombre del tercero dentro, más un
   enlace para descargar el archivo vacío de todos modos; a un **programa** se le entrega el `.xlsx`,
   porque el criterio de salida de la Ola 3 dice que todo reporte se descarga. Es la única diferencia de
   comportamiento de la ruta, y es de PRESENTACIÓN: el archivo y sus filas son idénticos.
3. **Fallo técnico** → mensaje genérico al usuario y detalle SOLO en el registro del servidor. El mensaje
   crudo del motor en pantalla no ayuda a nadie y sí le cuenta a un atacante cómo está montado el sistema.

**Lo que NO es bloqueante, y por qué se corrigió a mitad de la ola:** la primera versión bloqueaba con 409
los estados financieros sin `niif_mapping` y la exógena sin `exogena_account_mapping`. Lo destapó la
compuerta de la Ola 3 de A14: **A10 y A11 ya contemplan que falte el mapeo** —A10 cae al nombre del grupo
PUC como rótulo y deja una advertencia en el papel de trabajo; A11 dice explícitamente que el saldo solo
sale si el contador mapeó las cuentas—. Bloquear era sustituir por un rechazo un comportamiento ya
diseñado y bien resuelto, y encima rompía un criterio de salida. Ahora son **avisos** en `/reportes`,
antes de pedir el reporte, y el archivo se descarga igual.

---

## Ola 4 — qué entregó A16 (2026-09-01)

**Sin compuerta todavía.** A14 no ha verificado nada de esto; el orden del proyecto es que lo verifique él
mismo antes de dar la ola por cerrada.

| # | Tarea | Qué se entregó |
|---|---|---|
| 0 | Navegación | `app/_navegacion.tsx` + `app/layout.tsx`: breadcrumb y botón «Volver» en el **layout raíz**, así que toda ruta lo hereda por construcción — incluidas las que se añadan después. Es el único componente de cliente del proyecto, porque `usePathname()` solo existe ahí; no lee datos ni decide nada de seguridad. |
| 1 | Inventario | Quince tablas de catálogo identificadas y cubiertas; lo que quedó fuera está declarado con su motivo (abajo). |
| 2 | Plantillas | `npm run plantillas-masivas` escribe quince `.xlsx` independientes en `/archivos-masivos/`, con encabezados exactos, fila de ejemplo, obligatorias en rojo con asterisco, opcionales en azul, listas desplegables en los campos de conjunto cerrado y hoja «Instrucciones» columna por columna. Se generan también en caliente en `GET /api/plantillas/:catalogo` (D-071). |
| 3 | Carga masiva | `/carga-masiva` y `/carga-masiva/:catalogo`, `.xlsx` y `.csv`, validación en dos pasadas, informe fila/columna/motivo, «solo las válidas» bajo petición explícita, transacción por archivo y auditoría `CARGA_MASIVA` (D-070, D-071, D-072). |
| 4 | PUC | `v_account_efectivo`, `/parametros/puc`, plantilla de `account` y de `niif_mapping`, e interruptor «solo mi PUC» (D-064, D-065). |
| 5 | ReteICA en cascada | `listarActividadesIcaDeMunicipio`: el selector de actividad **filtra por el municipio elegido** y, cuando no hay tarifas, dice por qué y adónde ir. |
| 6 | Errores de reportes | `src/reports/diagnostico.ts` + panel de avisos en `/reportes` (D-073). |
| 7 | Administración | `/admin/usuarios`, `/admin/roles`, `/admin/correcciones`, `/cambiar-password` (D-066, D-067, D-068, D-069). |

### Las quince tablas cubiertas por la carga masiva, y su módulo

Cárguense en este orden: cada una solo depende de las anteriores.

| # | Tabla | Catálogo | Módulo |
|---|---|---|---|
| 1 | `municipality` | Municipios (DANE) | Parámetros › ReteICA |
| 2 | `ciiu_activity` | Actividades CIIU | Parámetros |
| 3 | `account` | Plan de cuentas (PUC) | Parámetros › Plan de cuentas |
| 4 | `cost_center` | Centros de costo | Parámetros › Plan de cuentas |
| 5 | `niif_mapping` | Mapeo PUC → NIIF para PYMES | Parámetros › Plan de cuentas |
| 6 | `tax_concept` | Conceptos tributarios | Parámetros › Tarifas |
| 7 | `tax_rule` | Tarifas (retefuente, ReteIVA, ReteICA, autorretención, IVA) | Parámetros › Tarifas |
| 8 | `tax_rule` (tipo `retefuente_salarios`) | Tabla progresiva del art. 383 ET, con tramos en UVT | Parámetros › Tarifas |
| 9 | `municipality_ica_rule` | Bases mínimas y tarifa general de ReteICA | Parámetros › ReteICA |
| 10 | `uvt_value` | UVT por año | Parámetros › Valores base |
| 11 | `smmlv_value` | SMMLV y auxilio de transporte por año | Parámetros › Valores base |
| 12 | `tax_calendar` | Calendario tributario (vencimientos) | Parámetros |
| 13 | `third_party` | Terceros | Terceros |
| 14 | `third_party_fiscal_attribute` | Atributos fiscales versionados (las nueve banderas) | Terceros |
| 15 | `third_party_activity` | Actividad económica por municipio (ReteICA) | Terceros |

**La tabla progresiva del art. 383 y el calendario tributario NO se diseñaron: ya existían.** `tax_rule`
tiene `rango_desde_uvt`, `rango_hasta_uvt` y `uvt_adicionales` desde 006, y `tax_calendar` desde la misma
migración. Crear tablas nuevas habría sido un segundo sitio donde el mismo hecho puede quedar
desactualizado; lo que faltaba era la plantilla y el camino de carga, no el modelo.

### Qué quedó FUERA de la carga masiva, y por qué

- **Asientos contables.** El ledger es append-only y solo nace de una causación aprobada (Regla de Oro 1).
  Un archivo de asientos sería una puerta trasera al libro.
- **Facturas.** Entran por el buzón de correo como XML DIAN, con deduplicación por CUFE. Cargarlas por
  Excel perdería el CUFE y la trazabilidad al documento original.
- **Usuarios y roles.** Se administran en `/admin/usuarios`. Crear usuarios en bloque desde un archivo,
  con contraseñas dentro, es exactamente la clase de cosa que no debe existir.
- **`concepto_causacion` y `exogena_account_mapping`.** Referencian a la vez cuentas PUC y conceptos
  tributarios, y su semántica está enredada con el clasificador de A5. Quedan para una ola posterior; hoy
  se editan uno a uno. **Es deuda declarada, no un olvido.**
- **`rounding_rule`.** Son tres filas por firma; no cumple el criterio de «volumen esperable de muchas
  filas» y ya tiene pantalla propia en `/parametros/valores-base`.

### Defectos que A16 encontró y corrigió mientras construía

| Qué | Dónde | Cómo se vio |
|---|---|---|
| El `CHECK` de `audit_log.accion` reescrito perdía los dos verbos de token de A13 | `170` | Las pruebas de integraciones, no el migrador |
| `document_correction.revisado_por` era una FK sin guardia de alcance (D-032/D-037) | `170` | El barrido de `evasion.test.ts` |
| `admin_firma` dejaba de tener «todos los permisos del catálogo» al añadir uno nuevo | `170` | La compuerta de arranque |
| `debe_cambiar_password` no estaba en la lista blanca de credencial propia: la única persona que no podía cambiar su contraseña era a quien se la habían fijado | `170` | Prueba propia de la Ola 4 |
| «1.500» entraba como un peso con cincuenta en vez de mil quinientos | `carga-masiva/valores.ts` | Prueba propia de la Ola 4 |
| Esconder una cuenta heredada exigía cargar toda su cadena de ancestros | `services/puc.ts` | Prueba propia de la Ola 4 |
| Bloquear con 409 los estados financieros sin mapeo NIIF rompía «todo reporte se descarga» | `api/reportes` | La compuerta de la Ola 3 de A14 |

### Pruebas de A14 que A16 acotó, con su justificación escrita

Las dos siguen la regla de D-047: **se actualizan al estado nuevo sin bajar la vara, y quien las toca lo
declara.** A14 revisa el diff, no el reporte.

1. `evasion.test.ts` — «app_user no es miembro de app_auth ni al revés». La consulta barría CUALQUIER
   membresía que tocara a los dos roles, incluida «X es miembro de app_user», que es lo que la migración
   161 tiene que hacer para que la aplicación arranque contra un Postgres gestionado. Se acotó a las dos
   direcciones que SÍ son escalada, **y se añadió una prueba nueva y más estricta**: todo el que sea
   miembro de `app_user`/`app_auth` tiene que ser superusuario o el dueño del esquema.
2. `compuerta-ola3-ruta.test.ts` — «la ruta es el ÚNICO importador de `src/reports/`». La invariante real
   (D-062) es que ningún GENERADOR quede huérfano ni se sirva saltándose el rastro EXPORT.
   `src/reports/diagnostico.ts` no genera libros. Se comprueba ahora que **nadie fuera de la ruta nombre
   un `generarXxx`**; un archivo que importara `generarLibroMayor` para servirlo por su cuenta seguiría
   haciendo fallar la prueba.

### Lo que A16 NO verificó, y le toca a A14

- No corrió la secuencia del README contra un PostgreSQL de verdad: todo lo de arriba está probado contra
  PGlite y con `next build`, no contra Neon ni recorriendo las pantallas a mano.
- No hay prueba «por la interfaz real» de las pantallas nuevas al estilo de
  `compuerta-ola2-interfaz.test.ts`: los servicios y la ruta de reportes sí se atacan, las acciones de
  servidor de `/carga-masiva` y `/admin/**` no.
- El tope de 5.000 filas y 8 MB por archivo no se probó con un archivo grande de verdad.

---

## Tokens de diseño — D-074 (2026-09-01)

**Sin compuerta de A14.** Entra antes de construir una sola pantalla, a propósito: es la capa que las
pantallas van a consumir, y ponerla después obligaría a reescribirlas.

### D-074 — El color y la tipografía viven en un solo archivo, no en cada `style` inline

**Problema:** hasta la Ola 4 el color estaba escrito a mano, pantalla por pantalla, dentro de `style`
inline (`#b45309` en el banner de alertas de A8, `#dc2626` en su badge, `#b91c1c` en el mensaje de error,
`#64748b` en el badge de alcance). Siete grises distintos, ningún modo oscuro posible y ningún sitio
donde cambiar el azul de la marca: cambiarlo era barrer el repositorio a mano.

**Decidido:** la paleta y la tipografía aprobadas viven **una sola vez**, en `app/globals.css`, como
variables CSS bajo `@theme static` de Tailwind v4. Se importan **una vez** en el layout raíz
(`app/layout.tsx`), así que toda ruta las hereda por construcción — el mismo argumento por el que la
navegación vive ahí (Ola 4, Tarea 0).

| Token | Claro | Oscuro |
|---|---|---|
| `--color-primario` | `#1E3A5F` | *igual* (ver abajo) |
| `--color-primario-contraste` | `#FFFFFF` | *igual* |
| `--color-superficie` | `#F8F9FA` | `#09090B` |
| `--color-superficie-elevada` | `#FFFFFF` | `#18181B` |
| `--color-texto` | `#1A1A1A` | `#FAFAFA` |
| `--color-texto-suave` | `#6B7280` | `#A1A1AA` *(derivado)* |
| `--color-exito` | `#10B981` | *igual* |
| `--color-error` | `#EF4444` | *igual* |
| `--color-pendiente` | `#F59E0B` | *igual* |
| `--color-borde` | `#E5E7EB` | `#27272A` *(derivado)* |

**Por qué Tailwind v4 y no un `tailwind.config.js`:** en la versión 4 la configuración ES CSS. El bloque
`@theme` define a la vez (a) las variables que puede usar cualquier `style` inline de las pantallas que ya
existen y (b) las utilidades (`bg-superficie`, `text-texto-suave`, `border-borde`) para las que se escriban
a partir de ahora. Un solo sitio, dos formas de consumirlo, **sin migrar nada de lo ya construido**: las
pantallas de A8, A7, A9 y A16 siguen funcionando exactamente igual.

**Por qué `@theme static` y no `@theme` a secas:** Tailwind v4 **poda** del CSS final las variables que
ninguna utilidad usa, y las pantallas ya construidas las consumen desde `style` inline, donde Tailwind no
puede verlas. Comprobado sobre el CSS compilado: sin `static`, `--color-exito`, `--color-error`,
`--color-pendiente`, `--color-borde` y `--color-texto-suave` **no llegaban al navegador**. Con `static`,
las diez del cuadro están.

**Modo oscuro, tres estados y en este orden de mando:** `<html data-tema="oscuro">` o `data-tema="claro"`
mandan sobre `prefers-color-scheme`, que manda cuando no hay decisión explícita. Solo se redefinen los
tokens que cambian; los nombres no. Una pantalla escrita contra `--color-superficie` funciona en los dos
modos sin una sola condición.

**Dos valores del modo oscuro son DERIVADOS, no aprobados,** y están marcados como tales en el archivo:
el texto secundario (`#A1A1AA`) y el borde (`#27272A`). La paleta aprobada solo fija tres valores para
oscuro (base, elevada y texto). El `#6B7280` del modo claro sobre `#09090B` da **4,17:1**, por debajo del
4,5:1 que exige WCAG AA para texto normal; `#A1A1AA` da 7,8:1. No se inventó un valor de marca: se
eligió el mínimo legible y queda declarado para que se decida.

**`--color-primario` NO cambia en oscuro,** y es deliberado: sigue sirviendo como FONDO con
`--color-primario-contraste` encima. Como TINTA sobre fondo oscuro no tiene contraste suficiente, y no se
inventa aquí un azul claro que nadie aprobó. **Pendiente de decisión de diseño humana.**

**Tipografía:** Inter en toda la interfaz, cargada con `next/font/google` en el layout raíz. No es un
`<link>` a Google Fonts: `next/font` descarga la fuente **en el build** y la sirve desde el propio dominio
— quita una petición a un tercero en cada carga (y con ella el dato de qué usuario visita qué, que es
justo lo que el capítulo de habeas data no quiere regalar) y elimina el salto de texto al cargar. Se
publica como `--fuente-inter` y la consume el token `--font-sans`: la fuente entra por el mismo sitio que
el color, no por una `font-family` suelta en cada página.

**Cifras tabulares, obligatorias en toda columna numérica.** Un balance de prueba se lee comparando
magnitudes de un vistazo: con figuras proporcionales el «1» ocupa menos que el «8» y las cifras dejan de
alinearse por unidad, decena y centena — un contador detecta ahí un descuadre que en una columna
desalineada no vería. Aplica a valores, bases, tarifas, NIT, fechas y CUFE. Dos formas, el mismo efecto:
`class="cifra"` para las pantallas ya construidas (que no usan Tailwind) y `class="tabular-nums"` para las
nuevas.

**Lo que NO se hizo, a propósito:** no se construyó ni se retocó **ninguna** pantalla, y no se migró un
solo `style` inline existente. Los tokens quedan listos; la migración de lo viejo y la construcción de lo
nuevo son trabajo del módulo de front, y se harán contra estos nombres.

**Verificado:** `npm run typecheck` limpio, `npm run build` exit 0 con las mismas 28 rutas, y los diez
tokens del cuadro presentes en el CSS compilado (`.next/static/chunks/*.css`). Las dos vulnerabilidades
moderadas que reporta `npm audit` son las de siempre (`exceljs` → `uuid`), no las trae Tailwind.

---

## Sistema de interfaz — D-075 (2026-09-01)

**Sin compuerta de A14.** Prototipo de diseño, no toca ninguna ruta ni servicio existente; entra para
elegir y fijar el lenguaje visual antes de migrar las pantallas reales.

### D-075 — Un tercer token derivado (`--color-primario-tinta-oscura`) y el prototipo del sistema de interfaz

**Decidido, dos cosas:**

1. **`--color-primario-tinta-oscura: #5B8DBE`** entra en `app/globals.css` como el tercer valor DERIVADO
   no aprobado del modo oscuro, junto a `--color-texto-suave` y `--color-borde`. Es el azul primario
   **aclarado** para usarse como TINTA (texto, ícono, borde de acento) directamente sobre superficie
   oscura, sin fondo de contraste debajo — no para el relleno de un botón, donde el `--color-primario`
   normal ya contrasta con `--color-primario-contraste` encima. En modo claro vale lo mismo que
   `--color-primario`; se redefine a `#5B8DBE` solo en los dos bloques de oscuro (5,9:1 sobre `#09090B`,
   por encima de 4,5:1 WCAG AA). **Pendiente de decisión de diseño humana**, igual que los otros dos.
   Cierra el «pendiente» que D-074 dejó abierto («cuando haya decisión, entra como token nuevo en este
   mismo bloque»).

2. **Prototipo navegable del sistema de interfaz**, en `app/diseno/**` (Next 16 App Router, Tailwind v4,
   TS strict). Se generaron **tres direcciones** sobre la misma pantalla (Bandeja de causación) y se
   eligió la **A — «Consola de operación»**: barra y lateral en el azul de marca, densidad compacta
   disponible, maestro-detalle siempre visible. Referente: el software denso que las firmas ya usan
   (Siigo / World Office / Helisa).

**Por qué en `app/diseno/**` y no sobre las rutas reales.** Las pantallas canónicas (`/bandeja`,
`/terceros`, `/parametros`, `/reportes`, `/admin/*`, `/entrar`) están cableadas a `conSesion` + servicios
+ server actions, y hay pruebas que dependen de sus módulos (`app/bandeja/ip.ts`). Reescribirlas en una
sola ola era arriesgar el build y la suite. El prototipo vive aparte, con datos de maqueta, para que se
pueda ver y navegar con `npm run dev` sin tocar nada en verde. **La migración de las 8 pantallas reales
contra este lenguaje es el trabajo de la siguiente ola de front.** `app/_navegacion.tsx` aprendió a
callarse bajo el prefijo `/diseno` (el prototipo monta su propio shell).

**Qué trae el prototipo:**

| # | Pantalla | Ruta | Nota |
|---|---|---|---|
| — | Navegación global | `app/diseno/_ui/AppShell.tsx` | Selector de empresa activa siempre visible, lateral de 6 módulos, breadcrumb automático desde la ruta, toggle de densidad cómodo/compacto (persistido en `localStorage`). |
| 1 | Login | `/diseno/entrar` | Panel de marca + formulario; segundo factor opcional (campo siempre presente, nota de «vacío si no lo tienes»). Fuera del shell. |
| 2 | Bandeja de causación | `/diseno/bandeja` | Cola tipo inbox, maestro-detalle. Lista con estado visual; detalle con asiento propuesto editable; tabla de trazabilidad «por qué el motor aplicó cada retención» (base, regla, vigencia, norma; incluye las que no aplicaron con su motivo). |
| 3 | Terceros | `/diseno/terceros` | Lista con búsqueda por nombre/NIT + densidad; ficha con atributos fiscales e **historial de vigencias visible**; **cascada municipio → actividad** para ReteICA, con mensaje explícito cuando el municipio no tiene actividades con tarifa (nunca lista vacía ni actividades de otro municipio). |
| 4 | Parámetros tributarios | `/diseno/parametros` | Submódulos; panel de alertas con badges **FALTA DATO** (error) y **VERIFICAR** (pendiente); tabla con estado por fila; formulario de edición «guardar como nueva vigencia» + historial; carga masiva por submódulo. |
| 5 | PUC / Plan de cuentas | `/diseno/parametros/puc` | Interruptor «usar solo mi PUC» por empresa; tabla con badge **Propia** vs **Genérica** por fila; carga masiva. |
| 6 | Reportes | `/diseno/reportes` | Los **tres estados de mensaje** diferenciados (`MensajeEstado`): falta configuración → accionable con enlace; sin datos → neutro; error técnico → genérico sin detalle crudo (D-073). |
| 7 | Administración | `/diseno/admin/usuarios`, `/roles`, `/correcciones` | Usuarios con estado activo/inactivo, alta, restablecer contraseña (enlace de un solo uso, no muestra clave). Roles: matriz módulo × Ver/Editar/Aprobar, checkboxes editables, rol todopoderoso **bloqueado** (todo marcado, `disabled`). Correcciones: mismo patrón de cola de trabajo que la Bandeja, badge «Pendiente de revisión». |
| 8 | Carga masiva (patrón reusable) | `app/diseno/_ui/CargaMasiva.tsx` | Botón → modal de subida → vista de resultado (filas válidas vs. con error: fila + campo + motivo) → «cargar solo las válidas» bajo acción explícita. Se usa en Terceros, PUC y Parámetros. Refleja D-072. |

**Regla de Oro 2 en un prototipo de diseño.** Las pantallas del prototipo **no queman ni un valor
tributario**: las tarifas, la UVT, el SMMLV y las bases van como marcadores visibles (`[tarifa]`,
`[UVT vigente]`, `[SMMLV vigente]`), y los montos de ejemplo van como cadenas ya formateadas. Esto
satisface a la vez la Regla 2 (el valor vive en la tabla paramétrica, el motor lo resuelve) y el
criterio de diseño de no fabricar hechos que faltan. El barrido de `tests/adversarial/valores-tributarios.test.ts`
pasa sobre `app/diseno/**` sin exención — no se tocó el detector.

**Caveat de color declarado (no aprobado, para decisión humana).** Los tokens de estado
(`--color-exito|error|pendiente`) tienen un solo valor y como texto normal sobre blanco quedan por debajo
de 4,5:1. Los badges los usan a plena tinta con `font-semibold`, tamaño ≥11px y fondo `/12` del mismo
tono, que sí contrasta. Para el texto plano de estado se añadió una «tinta» de cada estado — ver D-076.

**Verificado (mismo estándar que la Ola 4):** `npx tsc --noEmit` limpio · `npx next build` exit 0 con 38
rutas (28 previas + 10 de `/diseno`) · `npm test` **993 en verde** (48 archivos), incluida la pasada
adversarial de la Regla de Oro 2. Sin comitear: el usuario prueba con `npm run dev` y comitea si se ve y
funciona bien.

### D-076 — Tintas de estado (`--color-*-tinta`) para texto plano con contraste AA

**Decidido:** tres tokens derivados más en `app/globals.css`, mismo criterio que
`--color-primario-tinta-oscura`:

| Token | Claro | Oscuro | Contraste (texto normal) |
|---|---|---|---|
| `--color-exito-tinta` | `#047857` | `#34D399` | 5,5:1 sobre `#fff` · 10:1 sobre `#09090b` |
| `--color-error-tinta` | `#B91C1C` | `#F87171` | 6,5:1 sobre `#fff` · 7:1 sobre `#09090b` |
| `--color-pendiente-tinta` | `#92400E` | `#FBBF24` | 7,1:1 sobre `#fff` · 12:1 sobre `#09090b` |

Los tres colores de estado base (`#10B981`, `#EF4444`, `#F59E0B`) están calibrados como RELLENO; como
texto plano sobre blanco dan 2,5:1 / 3,8:1 / 1,9:1, por debajo del 4,5:1 de WCAG AA. La tinta oscurece
cada tono en modo claro y lo aclara en oscuro (donde el texto va sobre superficie oscura), igual que la
tinta primaria. **Derivadas, no aprobadas** — se cambian en `globals.css` en cuanto haya decisión.

**Uso en `app/diseno/**`:** solo donde el color de estado es TEXTO/ícono plano sobre fondo claro (o su
box `/8`): botón `peligro`, asterisco de campo requerido, íconos de `MensajeEstado`, número de fila con
error en la carga masiva, aviso de municipio sin actividades, alerta de retención en la traza,
encabezado «Después» de una corrección. **No** en los badges con fondo `/12` (ya contrastan con
`font-semibold`), ni en las barras de acento de 3px (borde decorativo, no texto).

**Verificado:** `npx tsc --noEmit` limpio · `npx next build` exit 0 (38 rutas) · `npm test` **993 en
verde**, incluida la pasada adversarial de la Regla de Oro 2 (los hex nuevos no la disparan).

**Canvas de las tres direcciones:** artifact `437e151c-5dad-4478-9b5f-fa8bb68d4418` (Dirección A en la
página «elegida», B y C en «descartadas»).

---

### D-078 — Fase 1 (ajustada) de la ola de refinamiento de interfaz

**Encargo, tal como llegó:** cuatro tareas sobre lo que D-077 ya dejó migrado (shell, navegación, login),
sin migrar ningún módulo nuevo de los que D-077 dejó pendientes (terceros, parámetros, PUC, reportes,
admin).

**1) Bug de contraste en los módulos aún no migrados.** Causa raíz encontrada en `app/globals.css`: `body`
fija `color: var(--color-texto)` una sola vez; en modo oscuro del sistema esa variable se aclara
(`--color-texto: #fafafa`). Las pantallas de `/terceros`, `/parametros` (incluida `/puc`), `/reportes`,
`/admin/**` y `/carga-masiva` usan `style` en línea con hexadecimales fijos pensados solo para fondo claro
(`background: '#fffbeb'`, `color: '#166534'`...) que **nunca leen ese token**: heredan el `color` aclarado
de `body` sobre sus fondos claros fijos — texto claro sobre fondo claro, invisible. No es un defecto por
caja: ninguna de esas pantallas fue escrita pensando en modo oscuro.

Corrección **sistémica, no parche por parche**: una escotilla de tema por subárbol. `globals.css` gana una
regla `[data-tema='claro']` (no solo `:root[data-tema='claro']`, que ya existía) que redeclara los mismos
valores claros para CUALQUIER contenedor que lleve el atributo — las variables de color son propiedades
CSS normales y heredan hacia abajo como cualquier otra. `AppShell.tsx` la aplica en el ÚNICO contenedor que
ya envuelve a todas las pantallas (`<div data-densidad ...>`), con una lista `PREFIJOS_SIN_MIGRAR` (los
mismos cinco módulos de la tarea, más `/carga-masiva`, que D-077 también dejó con su cuerpo viejo aunque no
apareciera en su tabla del corte). Un solo sitio: cuando un módulo migre, se borra su prefijo de esa lista,
no se toca ni un archivo de la pantalla. `/bandeja` y `/` (ya migradas al kit) no llevan el atributo y
siguen respondiendo al tema del sistema con normalidad.

**2) Encabezado y primera columna fijos en `Tabla` (`app/_ui/componentes.tsx`).** `Th` queda `sticky
top-0` siempre — sin costo cuando la tabla no desborda verticalmente, así que toda tabla que se migre al
kit lo hereda sin pedirlo. La primera columna es opt-in con la prop nueva `fijarPrimeraColumna` (no toda
tabla tiene una columna identificadora), aplicada con un selector de descendiente
(`[&_td:first-child]:sticky...`) en el contenedor de scroll — no una prop repetida en cada `Td`. Prop nueva
`alturaMaxima` (por defecto `'70vh'`, `null` para desactivar) porque el encabezado fijo necesita un
contenedor con alto acotado para tener contra qué pegarse; sin ella, en una tabla corta como las de
`/bandeja` no cambia nada visible. Ninguna pantalla migrada se tocó: el cambio vive entero en el
componente, y beneficia a PUC y a cualquier tabla larga en cuanto se migre.

**3) `/` rediseñada como panel real.** Antes: pantalla plana de A12 (elegir empresa + lista de enlaces en
texto), fuera del shell (`Chrome.tsx` la trataba como ruta sin shell). Ahora entra al shell como cualquier
módulo (se borra de `RUTAS_SIN_SHELL`) y usa el kit (`Panel`, `Encabezado`, `MensajeEstado`, `Boton`).
Datos, todos reales, del MISMO servicio que ya usan las pantallas migradas — nada se recalcula con lógica
propia:
- Facturas pendientes de aprobación / revisión → `obtenerBandejaConsolidada()` (`app/lib/bandeja.ts`), el
  agregador exacto que ya usa `/bandeja`, con enlace directo a `/bandeja`.
- Alertas de parámetros (`FALTA DATO` / `VERIFICAR`) → `detectarAlertasParametrizacion()`
  (`src/services/parametrizacion.ts`), el mismo que alimenta el `BannerAlertas` de `/parametros`, con
  enlace directo a `/parametros`.
- Seis tarjetas de acceso rápido a los módulos que NO son la bandeja (ésta ya tiene su propio panel de
  resumen arriba con su propio botón), dentro del sistema de diseño (`grid` de tarjetas con ícono, no
  lista de texto).
- Si no hay empresa elegida (o el usuario no tiene ninguna): `MensajeEstado` explícito y, si tiene
  empresas pero ninguna elegida, un `Panel` con el selector ahí mismo (mismo
  `cambiarEmpresaActivaAction` que usa el selector del shell, `destino="/"`).

Se retiró `app/acciones.ts` (`elegirEmpresaAction`): quedó duplicado exacto de `cambiarEmpresaActivaAction`
(`app/_ui/acciones.ts`, D-077) en cuanto `/` empezó a usar este último; nada más lo importaba.

**Hallazgo propio, corregido en la misma pasada (revisión A14 — arquitecto):** la primera versión envolvía
`<Boton>` dentro de `<Link>` para los botones "Ir a la bandeja" / "Ir a parámetros" — un `<button>` dentro
de un `<a>` es HTML inválido (contenido interactivo anidado), y no había precedente de ese patrón en el
resto del kit. Se añadió `EnlaceBoton` a `componentes.tsx` (un `<Link>` con la misma pinta de `Boton`,
compartiendo `CLASE_BOTON_BASE`) y se usó ahí y en el `not-found.tsx` nuevo; `Boton` sigue siendo
exclusivamente de `<form>`/`onClick`.

**4) Logo.** Se revisó `/logos` en la raíz del repo (11 archivos: 10 PNG + 1 SVG). **Ninguna variante es
adecuada para ningún uso** — no falta un formato o un fondo: el logo entero es de una marca distinta.
Las imágenes son el ícono «D/S» con el texto «AUTOMATIZACIÓN · IA», que es la marca personal de
automatización/IA del usuario, no la de este producto (`Contable CO`, la marca en azul `#1E3A5F` que ya
fijó D-074 y que usan el header y el login desde D-077). Ponerle este logo al header, al favicon o al
login de un SaaS contable multi-tenant sería vestir el producto con la marca equivocada — más caro de
deshacer después que no hacerlo ahora. **No se integró nada de `/logos`.** Lo único que se tocó: no existía
NINGÚN favicon; se creó `app/icon.svg` (convención de Next.js: archivo especial servido automáticamente),
el mismo trazo que ya usa `IconoMarca` (`app/_ui/iconos.tsx`) en cuadrado redondeado `--color-primario`. El
header y el login siguen con `IconoMarca` + el texto «Contable CO», que ya son la marca real del producto.
Si en algún momento se decide un logo verdadero para `Contable CO`, esta ficha es la referencia de por qué
`/logos` no lo resolvió.

**5) Verificación — con una limitación declarada.** `npx tsc --noEmit` limpio. `npm test`: **993 en
verde** (48 archivos) — incluyó corregir un falso positivo real del propio detector de la Regla de Oro 2
que la tarea 3 introdujo: `mt-0.5` (clase de espaciado fraccional de Tailwind) coincide con el patrón
`0\.\d+` que caza tarifas quemadas (`0.19` de IVA, etc.); se cambió a `mt-[2px]`, la misma convención en
píxeles arbitrarios que YA usa `componentes.tsx` en dos sitios por la misma razón. `npx next build`: **no
se pudo verificar en esta sesión** — falla con `TypeError: The "path" argument must be of type string or
an instance of Buffer or URL` al prerenderizar `/_not-found`, y **se confirmó que el fallo es previo a esta
fase**: revertidos todos los cambios de esta sesión (`git stash`), el mismo build falla igual, byte por
byte, sobre el commit de cierre de D-077. Es infraestructura de build de este entorno, no del código: el
import estático de `@electric-sql/pglite` en `src/db/client.ts` (el motor WASM de pruebas) se arrastra a
TODO el árbol de servidor por `app/lib/db.ts` → el layout raíz, y algo en la resolución de la ruta del
`.wasm` bajo Node 22 + este Next 16.3.3 (reproducido igual con Turbopack y con `--webpack`) revienta al
prerenderizar la página `/_not-found` implícita. D-077 sí reportó `next build` exit 0; no hay forma de
saber desde aquí si su entorno difería (versión de Node, caché de `.next`) o si el mismo problema ya
estaba latente. **Queda declarado, no oculto ni inventado un «pasa» que no se verificó.** Se probó además
declarar un `app/not-found.tsx` propio (mejora real, se queda) por si evitaba la ruta implícita — no la
evitó, Next la genera de todos modos.

**Sin comitear hasta que el usuario lo revise.** `app/diseno/**` sigue intacto: ningún módulo se migró en
esta fase, así que la regla de no borrarlo hasta migrar todo sigue vigente sin cambios.

---

### D-077 — Migración del sistema de interfaz a las rutas reales: MÓDULO 0 (base + shell) y MÓDULO 1 (bandeja)

**Contexto.** D-075 dejó el prototipo navegable en `app/diseno/**` con datos de maqueta. Esta ola
empieza a migrarlo a las rutas reales conectándolo a los servicios y acciones de servidor que ya
existen. Es un cambio de **capa visual sobre lógica existente**: no se reescribe ni un permiso, ni una
validación, ni una consulta RLS.

**El kit compartido vive ahora en `app/_ui/`** (canónico), no en `app/diseno/_ui/`:

| Archivo | Qué cambió respecto al prototipo |
|---|---|
| `componentes.tsx`, `iconos.tsx` | Copiados **verbatim** (son puros, sin dependencia de ubicación). |
| `contextos.tsx` | `EmpresaProvider` ya NO tiene lista de maqueta: recibe `empresas` (de `listarEmpresasAccesibles`) y `activaId` (cookie `company_id`) como props del layout de servidor. `DensidadProvider` idéntico (localStorage). |
| `AppShell.tsx` | `BASE` real, módulos reales (`/bandeja`, `/terceros`, `/parametros`, `/parametros/puc`, `/carga-masiva`, `/reportes`, `/admin/usuarios`), breadcrumb con las etiquetas fusionadas de `_navegacion.tsx`. Selector de empresa = un `<form>` por opción a `cambiarEmpresaActivaAction`. Menú de usuario real (nombre, correo, cambiar contraseña, cerrar sesión con `salirAction`). Sin datos quemados. |
| `CargaMasiva.tsx` | **Conectado al importador real.** Llama a `cargarArchivoAction` (`app/carga-masiva/acciones.ts`) con `useActionState` — la MISMA acción que `/carga-masiva/[catalogo]`. Cero simulación: todo el archivo entra en un solo `conSesion` (una transacción); si una fila falla, no se escribe nada (D-072); informe completo fila+columna+motivo; «cargar solo las válidas» reenvía con `soloValidas=1`. Props: `clave` (clave de `DEFINICIONES`), `titulo`, `permiso`, `puede`. |
| `acciones.ts` (nuevo) | `cambiarEmpresaActivaAction`: idéntica en efecto a `elegirEmpresaAction` (D-022) — reescribe la cookie `company_id` — pero vuelve a la pantalla en la que estaba (`destino`), no a la portada. Valida forma (UUID) y que `destino` sea ruta interna. |
| `Chrome.tsx` (nuevo) | Envoltura de cliente que decide shell vs. pantalla completa según `usePathname()`. Sin shell: `/`, `/entrar`, `/cambiar-password`. |

**Por qué un `Chrome` de cliente y NO un grupo de rutas `(interno)`:** mover las nueve carpetas de ruta
a un grupo obligaría a reescribir los imports relativos de ~25 archivos de servidor **sin poder probar
el resultado en `next dev`** (el usuario se reserva esa prueba). Un componente de cliente que mira la
ruta consigue lo mismo —toda ruta interna hereda el shell por construcción— con radio de cambio mínimo.
`app/_navegacion.tsx` (la barra de A16) **se eliminó**: el shell la reemplaza entera. Su lógica de
etiquetas y de rutas migró al `AppShell`.

**El shell se resuelve en el layout raíz** (`app/layout.tsx`, ahora `async`): abre una sesión de firma
(`conSesionEmpresa('')`, D-022) para traer las empresas accesibles y la credencial. Si no hay sesión NO
redirige (haría un bucle en `/entrar`): pinta sin datos de shell y cada página interna hace su propio
desvío. `next build` sigue en exit 0 porque todas las rutas ya eran `ƒ` (dinámicas).

**Pantallas migradas en esta pasada:**
- **`/entrar`** — lenguaje visual nuevo (panel de marca azul + formulario sobrio). El comportamiento NO
  cambia: `<form action={entrarAction}>`, mensaje único de error, campo de 2FA siempre visible.
- **`/cambiar-password`** — kit nuevo (`Panel`, `Campo`, `MensajeEstado`). Misma acción, mismo mínimo de
  12 caracteres (lo impone el servicio), mismo desvío desde la portada mientras `debe_cambiar_password`.
- **`/bandeja`** (MÓDULO 1) — restyle completo con `Panel` / `Tabla` / `EtiquetaEstado` / `MensajeEstado`
  y `app/bandeja/_componentes.tsx` migrado. **Los nombres de campo de formulario NO cambian**
  (`sel = companyId::journalEntryId`, `aiuLinea_N`, `municipioOperacionId`, `motivo`, `companyId`,
  `sourceDocumentId`): son el contrato con `app/bandeja/acciones.ts` y con la suite adversarial. Sigue
  agregando `obtenerBandejaConsolidada` (una sesión real por empresa), sigue mostrando la traza completa
  de cada retención evaluada (base, tarifa, norma, vigencia, incluidas las que no aplicaron).

**Verificado:** `npx tsc --noEmit` limpio · `npx next build` exit 0 (38 rutas, todas `ƒ`) · `npm test`
**993 en verde** (48 archivos), incluidas `tests/app/bandeja-acciones.test.ts` y
`tests/adversarial/compuerta-ola2-interfaz.test.ts` sin tocar una aserción.

**Corte declarado — lo que FALTA (próxima pasada), por módulo:**
| Módulo | Rutas | Estado |
|---|---|---|
| 2 · Terceros | `/terceros`, `/terceros/nuevo`, `/terceros/[id]`, `/terceros/[id]/actividades`, `/terceros/[id]/atributos-fiscales` | **sin migrar.** La cascada municipio→actividad YA usa `listarActividadesIcaDeMunicipio` de verdad (A16, dos pasos `method=get`); solo falta el restyle. Enganchar `CargaMasiva` (`third_party`, `third_party_fiscal_attribute`, `third_party_activity`). |
| 3 · Parámetros | `/parametros`, `/parametros/tarifas/[tipo]`, `/parametros/valores-base`, `/parametros/reteica-municipios` | **sin migrar.** Los 3 estados de mensaje ya existen en el kit (`MensajeEstado`); enganchar `CargaMasiva` de `tax_rule`, `uvt_value`, etc. |
| 4 · PUC | `/parametros/puc` | **sin migrar.** Interruptor «usar solo mi PUC» (D-065), badge Propia/Genérica (D-064), `CargaMasiva` de `account`. |
| 5 · Reportes | `/reportes` | **sin migrar.** Los tres motivos ya están distinguidos en el servidor (D-073) — hay que mapearlos a `MensajeEstado` tipo `configuracion` / `sin-datos` / `error`. |
| 6 · Admin | `/admin/usuarios`, `/admin/roles`, `/admin/correcciones` | **sin migrar.** Matriz de permisos (D-067), rol todopoderoso blindado (D-066), «el junior corrige, el revisor aprueba» (D-068). |

Mientras quede un módulo sin migrar, **`app/diseno/**` NO se borra** (regla del proyecto: el prototipo
se retira cuando TODO está migrado, no antes). El prototipo sigue intacto y funcional en `/diseno/**`
contra su propio `app/diseno/_ui/`. Portada `/` no está en el encargo y queda con su interfaz actual.
Las páginas aún sin migrar (`/parametros`, `/reportes`, `/admin/**`, `/terceros`, `/carga-masiva`) ya
heredan el shell nuevo alrededor de su cuerpo viejo: la navegación funciona en todas.

**Sin comitear:** pendiente de que el usuario lo pruebe con `npm run dev`.

---

### D-079 — Fase 2 de la ola de refinamiento de interfaz: funcionalidad real de `/bandeja`

**Encargo:** completar la FUNCIONALIDAD de la bandeja de causación que D-077 dejó solo restyleada,
auditando primero qué existe. Migración `171_a7_d079_bandeja_fase2.sql`.

**Resultado de la auditoría previa (qué existía vs. qué se construyó):**

| # | Punto | Estado encontrado | Acción |
|---|-------|-------------------|--------|
| 1 | Aprobación en lote (selección múltiple) | **YA EXISTÍA y funcional**: checkboxes `name="sel"` = `companyId::journalEntryId`, `aprobarSeleccionAction` → `aprobarAsientosEnLote` real, agrupando por empresa, con `SAVEPOINT` por ítem (D-050). | Solo UX: «seleccionar todas/ninguna» (`SelectorTodas`), enlace al XML, lista con detalle plegable. El mecanismo **no se tocó**. |
| 2 | Filtros (fecha, proveedor, monto, score) | **NO EXISTÍAN**: `page.tsx` solo leía `?error`. | Construidos. El rango de fecha del hecho económico **baja a la consulta** (`listarPendientesDeAprobacion({ desde, hasta })`) — filtrar tras el `LIMIT` dejaría fuera documentos válidos. Proveedor/monto/score se aplican sobre el consolidado en `app/lib/bandeja.ts` (no son monótonos con el orden; volumen acotado por `LIMITE_POR_EMPRESA`). Score = `extraction.score_confianza` (0–100), expuesto en `EstadoDocumento`. Autocompletar de proveedor contra `listarTerceros` real. |
| 3 | Edición de cuenta + monto de línea con justificación | **NO EXISTÍA**: `PartidasAsiento` era solo lectura; no había servicio para editar un borrador. | `editarAsientoBorrador` (nuevo, `src/services/causacion.ts`). Cambian cuenta (código PUC del plan efectivo, exige `permite_movimiento`) y/o monto. **Cualquier cambio exige justificación no vacía** (Regla de Oro 6). El asiento resultante **tiene que cuadrar**: se impone en el servicio, no solo en la UI (`EditorLineasAsiento` muestra el descuadre en vivo). Rastro en `audit_log` vía `app.registrar_edicion_asiento_borrador` (antes/después de todas las líneas + justificación). Editar un asiento `posted` se rechaza (Regla de Oro 1). |
| 4 | Facturas rechazadas | **Desaparecían sin rastro visible**: `estado='rechazado'`, fuera de `listarPendientesDeAprobacion`. Sin vista, sin reproceso. | Pestaña «Rechazadas» (`?vista=rechazadas`) con `listarRechazadas`. **Archivar**: `estado='archivado'` (nuevo en el CHECK) — la fila, el `xml_crudo` y el `audit_log` permanecen; sale de todas las vistas; reversible por admin. Confirmación fuerte (teclear `ARCHIVAR` + motivo). **Reprocesar**: solo si el documento no dejó un asiento con la clave `causacion:<doc>`; si la dejó, se **bloquea** con `REPROCESO_BLOQUEADO` y un mensaje accionable (ver «Pendiente» abajo). |
| 5 | Ver documento original (XML/PDF) | **NO EXISTÍA botón.** El XML sí estaba en `source_document.xml_crudo`. No hay PDF almacenado. | Ruta `/bandeja/documento/[sourceDocumentId]?empresa=<companyId>` con `obtenerDocumentoOriginal` + `formatearXml` (indentado, sin dependencias). Si el XML se archivó en frío (`xml_almacenamiento='archivo_frio'`), lo dice. «PDF si existe» hoy nunca existe: se documenta en la propia pantalla. |

**Migración `171`:** (a) `source_document_estado_check` + `'archivado'`; (b) `app.registrar_edicion_asiento_borrador(uuid, jsonb, jsonb, text)`; (c) `app.archivar_documento_rechazado(uuid, text)` y `app.reintegrar_documento_rechazado(uuid)`. Las tres funciones **NO son `SECURITY DEFINER`** (mismo patrón que `app.registrar_exportacion`, D-062): `app_user` ya tiene INSERT sobre `audit_log` y UPDATE sobre `source_document`; solo encapsulan y exigen el permiso (`causacion.editar_borrador` / `documento.reprocesar`). No entran en el inventario de funciones DEFINER de `evasion.test.ts` / `compuerta-ola1`.

**Descuadre — defensa en profundidad (verificado por A14).** El constraint trigger `trg_journal_line_validar_balance` solo valida cuando el asiento está `posted`; un borrador puede quedar descuadrado en la BD. Por eso el bloqueo vive en TRES capas: `EditorLineasAsiento` (UI, no deja enviar), `editarAsientoBorrador` (servicio, rechaza con mensaje) y el trigger de publicación (respaldo final, `LG002`). `tests/adversarial/compuerta-d079-bandeja-fase2.test.ts` prueba explícitamente el caso de saltarse la UI y llamar al servicio con montos descuadrados: el servicio lo rechaza y el asiento original queda intacto.

**PENDIENTE EXPLÍCITO — para una ola futura con A3 sobre el motor de causación:**
la **reintegración completa de una rechazada que YA tuvo un asiento causado y anulado**. Hoy se bloquea
a propósito (`REPROCESO_BLOQUEADO`). Los dos obstáculos, ya identificados:

1. **Conflicto de `idempotency_key`.** Todo documento que llegó a `pendiente_aprobacion` generó un
   `journal_entry` con `idempotency_key = 'causacion:<doc>'`; el rechazo lo dejó `anulado` pero la clave
   sigue ocupada (`journal_entry_idem_uq UNIQUE (company_id, idempotency_key)`). `causarFactura` volvería
   a fallar con un `23505` crudo al reinsertar el borrador. Reintegrar exige liberar o renombrar esa
   clave — decisión de ledger de A2/A3.
2. **Falta la transición de estado.** `causarFactura` solo acepta `source_document.estado ∈ {recibido,
   parseado}` (`src/services/causacion.ts` ~L399). No existe hoy un camino `rechazado → parseado` en el
   motor; `app.reintegrar_documento_rechazado` lo hace SOLO para el caso sin asiento en conflicto.

Mientras tanto, el camino soportado para ese caso es volver a cargar el documento original desde la
carga masiva (el mensaje de `REPROCESO_BLOQUEADO` lo dice).

**Verificación:** `npx tsc --noEmit` limpio · `npx next build` **exit 0, 40 rutas** (el problema de PGlite
que apareció en el entorno de nube en D-078 **no se reproduce en local** — era del entorno) · `npm test`
**1003 en verde** (49 archivos), incluida la compuerta nueva `compuerta-d079-bandeja-fase2.test.ts` (10
pruebas). **Sin comitear:** pendiente de `npm run dev`. ~~Pendiente: compuerta ampliada de A14~~ →
**ejecutada, ver «Compuerta ampliada de D-079 — veredicto de A14» aquí abajo.**

---

### Compuerta ampliada de D-079 (QA adversarial + arquitecto + product owner) — veredicto de A14

**Veredicto: PASA, con SIETE defectos encontrados por A14 y CORREGIDOS por A14 en la misma pasada, y
un hueco de producto DECLARADO Y ABIERTO (V-23) que no bloquea esta entrega pero sí bloquea la
operación real de una firma.** A14 no verificó por reporte: escribió su propia suite,
`tests/adversarial/a14-d079-ampliada.test.ts` (14 pruebas), que ataca lo que la compuerta entregada
por A7 **no intentó**. Suite total: **1017 en verde** (50 archivos), `npx tsc --noEmit` limpio,
`npx next build` exit 0 (40 rutas). Sin comitear.

**Lo que A14 verificó él mismo y PASA sin tocar nada:**

| Comprobación | Resultado |
|---|---|
| Guardar un borrador **descuadrado** llamando directo a `editarAsientoBorrador` (saltándose la UI) | Rechazado. El asiento original queda intacto |
| Editar **sin justificación** | Rechazado (Regla de Oro 6) |
| Editar un asiento **`posted`** | Rechazado (Regla de Oro 1) |
| Editar el asiento de **otra firma** | «no existe en el contexto actual» — lo corta RLS, no un filtro de aplicación (Regla de Oro 7) |
| **Archivar/reintegrar** el documento de otra firma | `DOCUMENTO_INEXISTENTE`; el documento ajeno no se mueve |
| Rol **`solo_lectura`** editando un borrador | Rechazado por `causacion.editar_borrador` (probado con un usuario distinto: los permisos son la UNIÓN de los roles del usuario en la empresa, así que reusar el contador del escenario probaba de menos) |
| Archivar algo **que no está rechazado**, y archivar **sin motivo** | `ESTADO_INVALIDO` / `MOTIVO_OBLIGATORIO` |
| `archivado` como estado **terminal** | Ni se reintegra ni se re-archiva; sale de `listarRechazadas` **y** de `listarPendientesDeAprobacion` |
| **Fidelidad del `audit_log`** | La fila lleva `user_id`, `tenant_id`, `company_id`, `ip`, `request_id`, el **antes** completo, el **después** completo y la justificación. Fiel |
| Confirmación fuerte de archivar | La exige la **acción de servidor**, no solo el componente cliente |

**Defectos encontrados por A14 y corregidos por A14 (todos con prueba de regresión):**

1. **Carrera edición ↔ publicación: se podía mutar un asiento YA PUBLICADO** (Regla de Oro 1).
   `editarAsientoBorrador` leía `estado` sin bloquear la fila. Ventana real: la edición lee `draft`,
   otra transacción aprueba y publica, y el `UPDATE journal_line` de la primera cae sobre un asiento
   ya `posted` — el trigger `journal_line_inmutable` había visto `draft` al dispararse y el de balance
   no protesta porque la edición cuadra. **Corregido:** `SELECT estado FROM journal_entry WHERE id=$1
   FOR UPDATE`. `aprobarAsiento` toma esa misma fila con su `UPDATE`, así que ahora una de las dos
   espera y relee.
2. **Un humano podía reescribir el monto de una RETENCIÓN calculada por el motor** (Reglas de Oro 4 y
   6). `journal_line.retention_applied_id` amarra la partida a la base, tarifa, regla y vigencia con
   que se calculó; la exógena lee `retention_applied.valor` (Formatos 1001/1003) y el pago/abono lo lee
   del ledger. Editar esa partida hacía **divergir para siempre las dos fuentes**, sin que ninguna
   dijera que un humano se apartó del motor. **Corregido:** una partida con `retention_applied_id` no
   se edita — ni monto ni cuenta —, con mensaje accionable (corrija el concepto/parámetro y reprocese,
   o rechace y vuelva a causar). La UI la pinta de solo lectura y la manda en `hidden` para no romper
   el contrato de «todas las líneas». Las partidas no retenidas del mismo asiento se siguen editando.
3. **El filtro de monto ESCONDÍA facturas que sí había que aprobar.** El formulario pide **pesos**
   («Monto mín. (pesos)») y el valor entraba crudo como **centavos**: filtrar «hasta $1.000.000»
   mostraba solo lo que no pasara de $10.000. **Corregido** en `normalizarFiltros` (pesos → centavos).
4. **Una fecha inválida en la URL reventaba la bandeja entera.** `?desde=no-es-fecha` bajaba a un
   `::date` y tumbaba la pantalla de las 30-60 empresas con un `22007` sin manejar. **Corregido:** lo
   que no es una fecha ISO **real** (`2026-13-45` cumple el patrón y no es fecha) no filtra.
5. **Una cuenta DESACTIVADA seguía siendo imputable desde la edición.** `listarCuentasImputables`
   filtra `activo`; `editarAsientoBorrador` no. Desactivar una cuenta es justo el mecanismo con el que
   una empresa la retira de su plan (D-064). **Corregido** en el servicio, que es donde importa.
6. **La interfaz prometía algo que el sistema no hace:** «un administrador puede devolverla» al
   archivar. No existe función ni pantalla de desarchivar; `archivado` es terminal. **Corregido el
   texto** (y el `COMMENT` de la migración) para que diga la verdad; la capacidad queda como faltante
   asignada a A7.
7. **La salida que el bloqueo de reproceso le ofrecía al contador no existe.** El mensaje de
   `REPROCESO_BLOQUEADO` decía «vuelva a cargar el documento original desde la carga masiva». A14 lo
   probó: la ingesta deduplica por (empresa, CUFE) y por (empresa, hash), converge en **la misma fila**,
   y el motor la da por `ya_procesado` porque su estado ya pasó de `parseado`. **La factura se queda
   rechazada en silencio.** **Corregido el mensaje** en el servicio y en la migración; el hueco real es
   V-23.

**Mejora de producto añadida por A14 (riesgo contable, no cosmética):** la bandeja trae **20
documentos por empresa** y no había ni paginación ni aviso. Con 40 pendientes en la empresa 37, veinte
eran invisibles y nadie lo sabía. Ahora la pantalla avisa qué empresas llegaron al tope
(`empresasTruncadas`) y el texto de los filtros dice «las 20 más **antiguas**», que es lo que la
consulta trae (`ORDER BY fecha_hecho_economico` ascendente), no «las más recientes» como decía.

**Lectura de ARQUITECTO.** La solución encaja: `editarAsientoBorrador` no toca nada `posted`, el
balance se impone en tres capas (UI, servicio, trigger de publicación), las tres funciones nuevas
**no** son `SECURITY DEFINER` y no entran en el inventario de DEFINER de `evasion.test.ts`, el
aislamiento lo sigue poniendo RLS (`source_document` y `journal_entry` son tenant+company) y ninguna
función nueva filtra por empresa a mano. El estado `'archivado'` no deja huérfano ningún índice
(`source_document_estado_idx` es `(company_id, estado)`) ni ninguna vista de reportes (las vistas de
`110` parten de asientos `posted`, no del estado del documento). **Deuda que sí introduce:** `archivado`
es un estado sin transición de vuelta, y la edición manual de `journal_line` abre por primera vez la
puerta a que el ledger diverja de sus fuentes de traza — el punto 2 la cierra para retenciones, pero
el patrón exige que cualquier futuro editor de partidas se pregunte a qué registro de traza está
amarrada la partida antes de dejar cambiarla.

**Lectura de PRODUCT OWNER.** Con esto un contador ya puede operar la bandeja de verdad: ve el XML,
filtra, corrige cuenta y monto con justificación auditada, aprueba en lote y no pierde de vista las
rechazadas. Lo que **falta** para una firma de 30-60 empresas, en orden de dolor:
1. **V-23 — recuperar una factura rechazada por error** (ver abajo). Es el hueco grave.
2. **Desarchivar.** Hoy archivar es de una sola dirección.
3. **Paginación real** de la bandeja (el aviso de truncamiento es un parche honesto, no la solución).
4. **Corregir el tercero / la fecha / el concepto** desde la bandeja: hoy solo se corrige AIU y
   municipio (V-7/V-8) y la cuenta/monto del asiento.
5. **Filtro por empresa** en la bandeja consolidada, y un «solo lo mío» — con 60 empresas, filtrar por
   proveedor y monto no reemplaza filtrar por empresa.

**V-23 (NUEVA, ABIERTA, de A3 + A2) — una factura rechazada por error no se puede recuperar por
ningún camino de la interfaz.** Rechazar es una operación cotidiana y reversible en la cabeza de un
contador; aquí es definitiva. `reintegrar` bloquea (clave de idempotencia `causacion:<doc>` ocupada +
falta la transición `rechazado → parseado`), volver a cargar el XML no hace nada (dedupe + `ya_procesado`)
y archivar tampoco es reversible. **No bloquea D-079** —antes de esta fase la rechazada desaparecía sin
rastro y ahora al menos se ve y el bloqueo es explícito y honesto— pero **sí bloquea la operación real
con un cliente**. Prueba que lo demuestra: `tests/adversarial/a14-d079-ampliada.test.ts` →
«volver a cargar el documento NO recausa una rechazada».

**Archivos que A14 tocó en esta compuerta:** `src/services/causacion.ts` (bloqueo de fila, cuenta
inactiva, partida de retención), `src/services/bandeja.ts` (mensaje de bloqueo veraz),
`app/lib/bandeja.ts` (unidades del monto, fecha válida, `empresasTruncadas`), `app/bandeja/page.tsx`
(aviso de truncamiento, textos), `app/bandeja/_interactivos.tsx` (partidas de retención de solo
lectura, texto de archivar), `db/migrations/171_a7_d079_bandeja_fase2.sql` (dos `COMMENT`/mensaje) y la
suite nueva `tests/adversarial/a14-d079-ampliada.test.ts`.

**Los 20 casos dorados de la sección 12, ejecutados COMPLETOS en esta compuerta** (no una muestra):
`tests/golden/casos-dorados.test.ts` los cubre uno a uno (1, 1b, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10b, 11,
12, 12b, 13, 14, 14b, 15, 15b, 16, 17, 18, 19, 20) y `tests/adversarial/casos-dorados.test.ts` los
vuelve a correr con instrumentos propios de A14 más los canarios anti-falso-PASS. **26 + 26 pruebas,
todas en verde.** Además, en esta misma pasada: grep de literales tributarios sobre `src`, `app`,
`db/migrations` y la raíz ejecutable → **cero**; `UPDATE`/`DELETE` sobre asiento publicado → falla en
BD (`LG001`); asiento desbalanceado → falla en BD (`LG002`); consulta cruzada entre firmas → **cero
filas**; reproceso 10 veces → asiento idéntico; cambio de tarifa con vigencia nueva → lo publicado no
cambia y lo posterior sí usa la nueva; segunda factura del mismo proveedor con la misma descripción →
**cero llamadas al LLM** (`tests/golden/caso19-memoria.test.ts`, con espía sobre `fetch`).

---

### D-080 — Resolución DNS IPv4-primero en cada proceso Node (fix de `ENOTFOUND` en Windows contra Neon)

**Problema.** En Windows, Node puede resolver el host de Neon por IPv6 antes que por IPv4 y fallar con
`ENOTFOUND` cuando el IPv6 local no está bien enrutado, aunque el sistema operativo y el navegador
resuelvan bien el mismo dominio. Es el comportamiento de `dns.setDefaultResultOrder` cuyo valor por
defecto cambió entre versiones de Node (`verbatim` vs `ipv4first`).

**Solución.** Módulo compartido de **efecto secundario** [`src/db/dns-fix.ts`](src/db/dns-fix.ts): llama
`dns.setDefaultResultOrder('ipv4first')`. Se importa vía `import('node:dns')` **dinámico** con `.catch()`
porque `instrumentation.ts` también se evalúa en el **edge runtime** de Next.js, donde `node:dns` no
existe: ahí no hace nada. Lleva `export {}` para ser un módulo ESM sin necesitar top-level `await`.

Importado como **primera línea** (tras el shebang) de los **cinco puntos de entrada Node
independientes** — cada uno es un proceso Node distinto y necesita el ajuste por separado:

| Punto de entrada | Comando | Import |
| --- | --- | --- |
| `instrumentation.ts` | `npm run dev` / `next start` | `import './src/db/dns-fix';` |
| `src/db/migrate-cli.ts` | `npm run migrate` | `import './dns-fix';` |
| `src/db/seed-cli.ts` | `npm run seed` | `import './dns-fix';` |
| `src/bootstrap/arranque-cli.ts` | `npm run arranque` | `import '../db/dns-fix';` |
| `src/bootstrap/datos-ejemplo-cli.ts` | `npm run datos-ejemplo` | `import '../db/dns-fix';` |

**Nota (matiz conocido).** Como el `import('node:dns')` es asíncrono, el ajuste se aplica en el primer
microtask, no de forma estrictamente síncrona a la evaluación del módulo. En la práctica se completa
mucho antes de que `createDb()` → `import('postgres')` → primera consulta abra una conexión real (hay
varios `await` de por medio). No se usó `import` estático para no arrastrar `node:dns` al bundle del
edge runtime con un solo módulo compartido.

**Verificación.** `npx tsc --noEmit` limpio · `npx next build` exit 0, 40 rutas · `npm test` **1017 en
verde** (50 archivos). Sin comitear.

---

### D-081 — V-23: recuperación de una factura rechazada por error (A3 + A2)

**Problema (V-23, abierto por A14 en la compuerta ampliada de D-079).** Rechazar una causación
(`aprobarAsiento` con `decision <> 'aprobado'`) anula el asiento borrador y deja el documento en
`rechazado`. El asiento anulado **conserva** su `idempotency_key = 'causacion:<doc>'`.
`app.reintegrar_documento_rechazado` cortaba SIEMPRE que existiera ese asiento
(`REPROCESO_BLOQUEADO`), volver a cargar el XML no hacía nada (dedupe por CUFE/hash → `ya_procesado`)
y archivar no es reversible. Rechazar por error dejaba el documento irrecuperable.

**Solución.**

- **Motor (A3), `src/services/causacion.ts`.** `idempotencyKeyCausacion(tx, company, doc)` cuenta los
  asientos con `idempotency_key LIKE 'causacion:%'` **en estado `anulado`** del documento: 0 → clave
  base `causacion:<doc>` (retrocompatible); N → `causacion:<doc>#<N+1>`. Se cuentan **solo los
  anulados** a propósito — si existe un asiento VIVO con la clave base (otro worker ganó la carrera),
  este intento vuelve a elegir la clave base, choca contra `journal_entry_idem_uq` y el `catch` lo
  resuelve como `ya_procesado`: nunca dos asientos vivos (preserva D-043). Se usa en `causarFactura` y
  `causarNotaCredito`. El `catch` de `UNIQUE_VIOLATION` ahora resuelve el asiento vivo por
  `source_document_id … AND estado <> 'anulado'`. `procesarJobCausacion` sigue **sin** aceptar
  `rechazado` como estado de entrada: el único camino de vuelta es el gate auditado.
- **Transición (A2), `172_a3a2_v23_reproceso_rechazadas.sql`.**
  `app.reintegrar_documento_rechazado(uuid, text DEFAULT NULL)` (se dropó la firma vieja de 1 arg):
  `FOR UPDATE` sobre `source_document`; reintegra `rechazado → parseado` cuando el único asiento de
  causación en conflicto está `anulado`; **mantiene `REPROCESO_BLOQUEADO`** si hay uno vivo. Rastro
  ampliado en `audit_log`: `desde_estado`, `reproceso_numero`, `asiento_anulado_previo`, `motivo`.
- **Bandeja, `src/services/bandeja.ts` + `app/bandeja/`.** `listarRechazadas` ya no cuenta los
  anulados como "asiento en conflicto" (una rechazada con asiento anulado muestra "puede reprocesar");
  `reintegrarDocumentoRechazado(tx, id, motivo?)`; campo de motivo opcional en la sub-bandeja.

**Reglas de Oro.** RO-1: el asiento anulado no se toca — el reproceso crea uno nuevo. RO-2: `#n` es
identificador técnico, ni una tarifa. El resguardo `REPROCESO_BLOQUEADO` no se relajó como
comportamiento por defecto: se habilitó un camino explícito y auditado.

**Compuerta ampliada de A14: PASA, con SEIS defectos hallados y corregidos por A14 en la misma
pasada — V-27 a V-32** (ver el registro de vulnerabilidades y «Compuerta AMPLIADA de V-23»). Los dos
graves: **V-30** (certificado de retenciones y exógena reportaban el doble tras un reproceso — A9/A11
leían `retention_applied` sin atarlo al ledger publicado) y **V-28** (una nota crédito rechazada
quedaba irrecuperable y rompía el worker con un `23505` no manejado). Migración `173` (índice
`journal_entry_causacion_viva_uq` real, `journal_entry_reversa_viva_uq` parcial, predicado del gate
por clave y no por tipo), suite propia `tests/adversarial/a14-v23-ampliada.test.ts` (30 pruebas).

**Verificación.** `npx tsc --noEmit` limpio · `npx next build` exit 0 · `npm test` **1052 en verde**
(51 archivos; +5 del bloque `describe('V-23 …')` en `tests/services/causacion.test.ts`, +30 de la
suite de A14). Sin comitear.

---

### D-082 — Refinamiento visual: pulido de toda la interfaz + tema claro por defecto (fusiona D-081)

**Encargo.** Elevar el nivel de pulido de la interfaz al estándar Stripe/Linear/Notion —
minimalista, mucho blanco, tipografía cuidada, sin pinta de «plantilla de admin genérica»— sin
tocar los valores de color aprobados (D-074/075/076): el cambio es de USO y de detalle, no de
paleta. Siete tareas. La 7 absorbe el encargo D-081 (tema claro real como default).

**Qué cambió, tarea por tarea (esto es perceptual — se describe el cambio, no solo «hecho»):**

1. **Chrome (barra superior + menú lateral): de bloque azul sólido a neutro con acento.**
   `app/_ui/AppShell.tsx`. Antes: barra superior y lateral en `bg-primario` (azul `#1E3A5F`
   sólido), texto y controles en blanco/`white/N`. Ahora: ambas en `bg-superficie-elevada` con
   `border-borde` de 1px. El azul es SOLO acento: el ítem de módulo activo lleva fondo
   `bg-primario/8` (azul muy claro), barra vertical de acento de 2px a la izquierda
   (`border-l-2 border-primario`) e ícono en `text-primario`; los inactivos van en
   `text-texto-suave` sin fondo, con `hover:bg-superficie`. Ítems con esquinas redondeadas y
   margen lateral (ya no franjas a sangre). El logo «Contable CO» pasó a texto oscuro
   (`text-texto`) con el ícono de marca en azul, sobre fondo claro — ya no blanco sobre azul.
   `SelectorEmpresa`, `ToggleDensidad` y `MenuUsuario` reestilados a superficie clara con borde
   sutil; el avatar del usuario pasó de círculo azul sólido a `bg-primario/10 + text-primario`.
   Ancho del lateral 56→60, alto de la barra 52→56.
2. **Tipografía: jerarquía en un solo sitio.** `app/globals.css`, bloque `@theme static`. Nueva
   escala por ROL como tokens de Tailwind v4 con su interlínea emparejada: `text-metadata`
   (11px), `text-menor` (12px), `text-cuerpo` (13px), `text-seccion` (14px), `text-titulo`
   (22px, `letter-spacing -0.02em`). El kit de `app/_ui/` (`Encabezado`, `Panel`, `AppShell`,
   `EstadoVacio`, tarjetas de `/` ) ya consume estos nombres en vez de `text-[13px]` sueltos.
   Título de página ahora `text-titulo font-semibold` (antes `text-lg font-bold`): un punto más
   grande, `semibold` en vez de `bold`, tracking negativo. Metadata bajo el título y
   descripción de panel bajadas a `text-metadata`/`text-menor` y `text-texto-suave`. Las
   pantallas con «cuerpo viejo» (PREFIJOS_SIN_MIGRAR) todavía llevan valores sueltos; se limpian
   al migrarse — la escala ya está lista para ellas.
3. **Tarjetas: borde sutil + sombra mínima + radio consistente.** Tokens nuevos
   `--shadow-tarjeta: 0 1px 2px rgba(0,0,0,.04)` y `--radius-tarjeta: 12px`. `Panel` ahora
   `rounded-[var(--radius-tarjeta)] border-borde shadow-[var(--shadow-tarjeta)]`, con la
   cabecera a `px-5 py-3` (antes `px-4 py-2.5`). Las tarjetas de módulo de `/` con la misma
   sombra y radio, y `hover:shadow-md` en vez de `hover:shadow-sm`. Los botones primarios
   heredan la sombra de tarjeta.
4. **Estados vacíos: de genérico a diseñado.** Componente nuevo `EstadoVacio` en
   `app/_ui/componentes.tsx`: ícono grande y tenue (`text-texto-suave/25`, trazo 1.5), texto
   principal directo y humano, detalle opcional, acción opcional. Reemplaza el
   `MensajeEstado tipo="sin-datos"` (ícono de info + texto plano en una caja con borde) en los
   casos neutros de `/bandeja` (aprobación / revisión / rechazadas, con y sin filtros) y `/`
   (facturas pendientes, alertas de parámetros). `MensajeEstado` se queda para
   `configuracion` (falta un dato, accionable) y `error` (fallo técnico), que sí necesitan
   marco y color. Textos de ejemplo: «Todo al día — no hay facturas pendientes de aprobación».
5. **Iconografía: un solo set, auditado.** `app/_ui/iconos.tsx` es el único juego: SVG de trazo
   hand-inlined derivado de lucide (rejilla 24, `stroke-width` 2, `currentColor`, caps
   redondeados), sin dependencia en runtime — deliberado por el presupuesto USD 20–50/mes (A15):
   añadir `lucide-react` (el encargo lo nombra como ejemplo del estándar, no como requisito de
   dependencia) no aporta sobre lo que ya hay y sí pesa. Todos los íconos pasan por `Base`, así
   que el grosor y el estilo son consistentes por construcción; los del menú se unificaron a
   18px (antes 17). Dos íconos nuevos: `IconoSol` / `IconoLuna` para el toggle de tema.
6. **Botones: jerarquía y transición.** `app/_ui/componentes.tsx`. Variante nueva `terciario`
   (solo texto, sin borde ni relleno) para completar la escala relleno→borde→texto; `primario`
   (relleno), `secundario` (borde azul), `terciario` (texto), más `fantasma` (borde neutro) y
   `peligro`. Transición explícita `duration-150` sobre color/borde/sombra (antes `transition` a
   secas). Radio de botón `rounded-md`→`rounded-lg` para casar con las tarjetas.
7. **Tema claro real como default (era D-081, fusionado aquí).** Antes: el modo oscuro se
   activaba heredando `prefers-color-scheme` del SO (`@custom-variant dark` con `@media` y un
   bloque `:root:not([data-tema='claro']) @media (prefers-color-scheme: dark)` en
   `globals.css`). Ahora: **el tema por defecto es claro SIEMPRE, sin importar el SO**. `dark:`
   y los tokens oscuros responden EXCLUSIVAMENTE a `<html data-tema="oscuro">`. El modo oscuro
   **no se eliminó**: sigue disponible por elección explícita — toggle sol/luna en la barra
   superior (`ToggleTema` en `AppShell`), estado en `TemaProvider` nuevo (`app/_ui/contextos.tsx`,
   mismo patrón que `DensidadProvider`), persistido en `localStorage` bajo `contable-co:tema`
   (preferencia de usuario, no derivada del SO). Un script en línea en `<head>` de
   `app/layout.tsx` aplica la elección sobre `<html data-tema>` antes del primer pintado, para
   que no haya parpadeo claro→oscuro. La escotilla `[data-tema='claro']` por subárbol (D-078,
   para las pantallas sin migrar) se conserva intacta y sigue funcionando.

**Confirmación explícita del comportamiento de tema (perceptual):** con el SO de macOS/Windows
en modo oscuro y sin elección previa del usuario, la aplicación abre en CLARO — fondo
`#F8F9FA`, superficies `#FFFFFF`, texto `#1A1A1A`. Solo tras pulsar el toggle a «oscuro» la
interfaz cambia a la paleta oscura, y esa elección sobrevive a la recarga (via `localStorage` +
script de pre-pintado). Verificado leyendo el CSS compilado: ya no existe ninguna regla
`@media (prefers-color-scheme: dark)` que redefina tokens de color.

**Alcance que absorbe de D-081:** D-081 (el número) ya se había usado para el cierre de V-23;
el encargo lo reasignaba al tema. Todo el trabajo de tema queda documentado aquí bajo D-082,
tarea 7. No hay una ficha «D-081 tema» separada.

**Archivos tocados:** `app/globals.css`, `app/layout.tsx`, `app/_ui/AppShell.tsx`,
`app/_ui/contextos.tsx`, `app/_ui/Chrome.tsx`, `app/_ui/componentes.tsx`, `app/_ui/iconos.tsx`,
`app/page.tsx`, `app/bandeja/page.tsx`. Sin migrar ningún módulo nuevo, sin tocar una acción de
servidor, un permiso ni un servicio.

**Verificación.** `npx tsc --noEmit` limpio · `npx next build` **exit 0, 18 páginas estáticas
generadas / 40 rutas** (la advertencia de `node:dns` en Edge Runtime es la de D-080, no de esta
ola) · `npm test` **1052 en verde** (51 archivos, sin cambio de conteo). Un hallazgo propio,
corregido en la misma pasada: el detector de la Regla de Oro 2 (`fraccion`, `/0\.\d+/`) marcó
tres clases de Tailwind con decimal (`mt-0.5`, `gap-0.5`, `p-0.5`) como «fracción con pinta de
tarifa»; se cambiaron a la forma `[2px]` que ya usaba el resto del kit. Sin comitear.

---

### D-083 — Datos de prueba de bandeja: escenarios completos en `npm run datos-ejemplo`

**Nota de numeración.** Este contenido estuvo documentado por error como «Extensión posterior» dentro
de la ficha D-082 (refinamiento visual). Es un trabajo aparte —datos de ejemplo, no interfaz— y se le
asigna su propia ficha D-083. El código correspondiente está sin comitear en
`src/bootstrap/datos-ejemplo.ts` y `src/bootstrap/datos-ejemplo-cli.ts`.

**Encargo.** `npm run datos-ejemplo` debía dejar la bandeja recorrible de punta a punta —todos los
estados y sub-bandejas visibles— sin que nadie tenga que rechazar, reintegrar o archivar nada a mano.

**Qué monta (`montarEscenariosBandeja`), además de las tres facturas de siempre:**

- Un tercero nuevo «Proveedor Prueba SAS» (NIT 901888777, registrado).
- 3 facturas en **Pendientes de aprobación** con score de confianza distinto (92 / 74 / 58 — badge
  verde / ámbar / ámbar).
- 3 en **Pendientes de revisión** (emisor no registrado como tercero — NITs
  902111000 / 902222000 / 902333000).
- 2 rechazadas y archivadas.
- 1 que recorre el ciclo **V-23** completo: rechazada → `reintegrarDocumentoRechazado` → recausada
  con clave `causacion:<doc>#2`.
- 1 **nota crédito rechazada** (V-28), visible en la sub-bandeja de Rechazadas como recuperable.

**Frontera respetada.** Cada documento entra por `recibirDocumento`, lo causa `vaciarCola` (el worker
real) y las transiciones las hacen los servicios existentes (`aprobarAsiento`,
`reintegrarDocumentoRechazado`, `archivarDocumentoRechazado`). Lo único que se inserta directo es la
traza de la propuesta de IA (`extraction` con `origen='manual'` y `score_confianza`) — metadato, no un
valor tributario ni un cálculo. Idempotente (seguro de correr dos veces). Los XML de escenario se
generan en código con aritmética entera (sin literales de tarifa en un `.ts`).

**Archivos tocados:** `src/bootstrap/datos-ejemplo.ts`, `src/bootstrap/datos-ejemplo-cli.ts`.

**Verificación.** `npx tsc --noEmit` limpio. Sin comitear.

---

### D-084 — Módulo de Terceros, Fase 3: migración visual + eliminar/inactivar + exportación + historial + permisos

**Encargo.** Cerrar la Fase 3 del roadmap para el Módulo de Terceros. Dos frentes: (a) la deuda
visual de D-077/D-082 —Terceros heredaba el `AppShell` nuevo pero conservaba «cuerpo viejo»
(`style` inline, `<table border={1}>`, hexadecimales fijos), y por eso se veía blanco fijo con el
tema oscuro activo—; (b) la funcionalidad nueva de la fase (eliminar/inactivar, exportación a
Excel, historial de vigencias en pestaña aparte, punto de extensión de permisos).

**TAREA 0 — Cuerpo migrado al kit.** Las cinco pantallas de `/terceros` (`page.tsx`,
`[id]/page.tsx`, `[id]/atributos-fiscales`, `[id]/actividades`, `nuevo`) y `_componentes.tsx` se
reescribieron sobre `app/_ui/` (tokens de tema, `Panel`, `Encabezado`, `Tabla`/`Th` sticky de
D-078, `EstadoVacio`, `Boton`/`EnlaceBoton`, `MensajeEstado`, escala tipográfica de D-082). Cero
`style` inline, cero `#hex`. `/terceros` **salió de `PREFIJOS_SIN_MIGRAR`** en `AppShell.tsx`: la
escotilla `data-tema="claro"` ya no lo cubre, así que el subárbol responde a `data-tema="oscuro"`
igual que `/` y `/bandeja`. Verificado con `next build` (18 páginas, las cinco rutas de terceros
compiladas) y por inspección de que ninguna pantalla del subárbol conserva un color suelto.

**Submódulo con pestañas internas.** La ficha de un tercero tiene su propia navegación:
**Detalle · Atributos fiscales · Actividad económica · Historial** (`app/terceros/_ui.tsx`,
`TabsTercero`). El listado (`/terceros`) es su propia pantalla con búsqueda y filtro por estado
(activos / todos / inactivos).

**TAREA 1 — Eliminar vs inactivar.** Un tercero solo se BORRA si nunca tuvo movimientos; si los
tuvo, solo se INACTIVA (`third_party.activo = false`), nunca `DELETE`. La garantía la pone el
**motor**, no la aplicación: migración `174_a8_d084_terceros_fase3.sql` añade
`app.tercero_tiene_movimientos(uuid)` (true si el tercero aparece en `journal_line`,
`source_document`, `retention_applied`, o tiene una vigencia de `third_party_fiscal_attribute` /
`third_party_activity` que **ya surtió efecto** —`vigente_desde <= CURRENT_DATE`—; una vigencia
futura es cancelable y no bloquea) y un trigger `third_party_restrict_delete BEFORE DELETE` que
rechaza con SQLSTATE **`TP001`**. El trigger ordena alfabéticamente **después** de
`third_party_permiso` (016): primero SE002 si falta `tercero.editar`, luego TP001. En la capa de
servicio: `terceroTieneMovimientos`, `eliminarTercero` (limpia las vigencias futuras +
`memoria_clasificacion` + `clasificacion_pendiente` antes del DELETE) y `fijarActivoTercero`.
La interfaz (`/terceros/[id]`, panel «Eliminar o inactivar») **deshabilita el botón de eliminar
con la explicación** cuando el tercero tiene movimientos — con el mismo criterio exacto que el
motor, porque llama a la misma función.

**TAREA 2 — Exportación a Excel.** Botón «Exportar a Excel» en `/terceros` →
`GET /api/terceros/exportar` → `src/reports/terceros-maestro.ts` (`exceljs`, la misma dependencia
que A9). Cuatro hojas: **Terceros** (valor vigente hoy, con estado activo/inactivo y todos los
atributos fiscales vigentes), **Atributos fiscales (historial)** (una fila por vigencia —cerradas
y abierta— de todos los terceros, con las nueve banderas, régimen, norma, fuente, notas),
**Actividad económica (historial)** (todas las ternas municipio×CIIU y sus vigencias), **Papel de
trabajo** (encabezado obligatorio de la §11.2 + conteos). La empresa **nunca** llega por
parámetro: sale de `conSesion`, y la RLS de las tres tablas de terceros garantiza que no se
exporte ni una fila de otra empresa. El permiso lo exige el servicio central
(`exigirPermiso(tx, PERMISOS.TERCERO_LEER)`).

**TAREA 3 — Historial de vigencias en pestaña aparte.** La pestaña «Detalle» muestra SOLO el valor
vigente hoy de cada atributo fiscal (panel «Situación fiscal vigente») y las actividades vigentes.
El historial completo —cerradas y abierta, fiscal y de actividad— vive en `/terceros/[id]/historial`
(solo lectura, dos tablas del kit). Servicio nuevo: `listarHistorialActividadesTercero` (todas las
ternas, no solo lo vigente). Los formularios de `atributos-fiscales` y `actividades` quedaron solo
con el formulario de vigencia nueva; el historial que antes mostraban se movió a la pestaña.

**TAREA 4 — Permisos por un solo servicio central.** Los helpers del módulo
(`puedeVerTerceros`, `puedeEditarTerceros`, `puedeEditarAtributosFiscales`) dejaron de hacer su
propio `SELECT app.tiene_permiso('...')` y delegan en `src/auth/permisos.ts` (`tienePermiso` →
`app.tiene_permiso`) con los códigos del registro `PERMISOS`, nunca cadenas sueltas. La resolución
ya es `role_permission` (datos), no un `if (rol === 'contador')`: cuando exista la Fase 8
(Administración con roles a la medida), conectar un rol configurable será **agregar filas a
`role_permission`**, sin tocar esta capa. El punto de extensión está documentado en la cabecera de
la sección de permisos de `src/services/terceros.ts`. No se creó ningún permiso nuevo ni se tocó
el modelo de roles: la fase no se bloquea por la ausencia de la Fase 8.

**Auditoría A14 (modo ampliado), verificada por ejecución en
`tests/services/terceros-d084.test.ts` (13 pruebas):**

- **«Eliminar» no tiene ningún camino que borre un tercero con movimientos, ni desde la API
  directa.** Prueba: `DELETE FROM third_party` directo contra la base (saltándose todo el
  servicio) sobre un tercero con documento soporte → rechazado con `TP001`, la fila sigue.
- **La exportación no filtra datos de otra empresa (RLS).** Prueba: dos firmas montadas, un tercero
  con nombre secreto en la firma B; la exportación corrida como firma A no contiene ese nombre en
  ninguna fila de la hoja «Terceros».
- **Consistencia con el patrón de tabla / estados vacíos ya establecido.** Listado e historial usan
  `Tabla`/`Th`/`Td` y `EstadoVacio` del kit; los formularios usan `MensajeEstado`. Sin componentes
  nuevos de tabla.
- **Vigencia futura vs. vigencia en firme.** Probado que una vigencia fiscal futura no cuenta como
  movimiento (y se limpia al eliminar) y que una que ya rige sí bloquea el borrado.

**Punto menor declarado (no bloqueante).** `eliminarTercero` incluye `DELETE FROM
memoria_clasificacion` / `clasificacion_pendiente` por defensa; esas tablas exigen
`concepto.editar` en escritura (016). En la práctica un tercero borrable nunca tiene esas filas
(se escriben durante la causación, que exige un `source_document`, que ya lo marca como «con
movimientos»), así que el `DELETE` de 0 filas no dispara el trigger de permiso. Si la Fase 8
introdujera un rol que pueda borrar terceros sin `concepto.editar`, habría que mover esa limpieza
a una función `SECURITY DEFINER`.

**Archivos.** Nuevos: `db/migrations/174_a8_d084_terceros_fase3.sql`,
`src/reports/terceros-maestro.ts`, `app/api/terceros/exportar/route.ts`,
`app/terceros/_ui.tsx`, `app/terceros/[id]/historial/page.tsx`,
`tests/services/terceros-d084.test.ts`. Tocados: `src/services/terceros.ts`,
`src/db/types.ts` (SQLSTATE `TP001`), `app/_ui/AppShell.tsx` (sacar `/terceros` de
`PREFIJOS_SIN_MIGRAR`, etiqueta «Historial»), `app/terceros/page.tsx`,
`app/terceros/_componentes.tsx`, `app/terceros/[id]/page.tsx`, `app/terceros/[id]/acciones.ts`,
`app/terceros/nuevo/page.tsx`, `app/terceros/[id]/atributos-fiscales/page.tsx`,
`app/terceros/[id]/actividades/page.tsx`, `tests/adversarial/evasion.test.ts` +
`tests/adversarial/compuerta-ola1.test.ts` (el inventario de funciones `app.*` ejecutables por
`app_user` ahora incluye `app.tercero_tiene_movimientos`).

**Verificación.** `npx tsc --noEmit` limpio · `npx next build` **exit 0** (18 páginas estáticas,
`ƒ /api/terceros/exportar` y `ƒ /terceros/[id]/historial` entre las rutas) · `npm test`
**1065 en verde** (52 archivos; base D-082 = 1052/51, esta ola suma el archivo
`tests/services/terceros-d084.test.ts` con 13 pruebas; los dos ajustes del inventario `app.*` en
`evasion` y `compuerta-ola1` son de conteo, no de comportamiento). Sin comitear.

---

### D-085 — Reversión del tema forzado a claro, tres bugs de shell y la migración 174 aplicada

**Contexto.** D-081/D-082 forzaron tema claro por defecto ignorando el SO. Se revierte esa parte:
el toggle sol/luna sigue, pero el valor por defecto vuelve a `prefers-color-scheme`. Regla:
**sin elección guardada → sigue al SO; con elección guardada → gana la del usuario.**

**Arquitectura del tema tras D-085 (dos entradas, cero JavaScript para el primer pintado):**

1. **`@media (prefers-color-scheme: dark)` en `globals.css`** resuelve el modo del SO. Es el valor
   por defecto cuando el usuario no ha elegido nada. El `@custom-variant dark` de Tailwind matchea
   ese `@media` (salvo override a claro) **o** `[data-tema='oscuro']`; los tokens de la paleta
   oscura se declaran en los dos selectores (CSS plano no comparte un bloque entre un `@media` y un
   selector de atributo — igual que la paleta clara ya se repetía).
2. **`<html data-tema="claro|oscuro">`** es la elección explícita del usuario y gana siempre. La
   escribe `TemaProvider` en una **cookie `contable-co-tema`** (NO `localStorage`), y
   `app/layout.tsx` la LEE en servidor y la pinta en `<html>` antes de mandar el HTML → sin
   parpadeo tampoco para la elección explícita, y **sin `<script>` bloqueante**.

Por qué cookie y no `localStorage` (el prompt pedía `localStorage`): con `localStorage` el
servidor no puede conocer la preferencia, así que hace falta un `<script>` inline que la aplique
antes del pintado — y **React 19 aborta con `console.error` («Encountered a script tag while
rendering React component») al reconciliar CUALQUIER `<script>` del árbol en un re-render de
cliente**, que es justo lo que dispara el refresh de server action al cambiar de empresa. Se
probaron `<script>` inline, `next/script` `beforeInteractive` (con y sin `src`) y un `<script src>`
a `public/`: los cuatro disparan el error. La cookie lo elimina de raíz: el estado vive en el HTML
del servidor, no en un script.

**BUG 1 — Hydration mismatch de `data-tema`.** `<html>` en `app/layout.tsx` lleva
`suppressHydrationWarning`: el valor de `data-tema` puede cambiar entre servidor y cliente si el
usuario alterna el tema sin recargar. Es la única diferencia esperada.

**BUG 2 — `<script>` JSX crudo en `<head>`.** Eliminado del todo (ver arriba): el tema ya no
necesita un script para el primer pintado. `next/script` está fuera de `app/layout.tsx`.

**BUG 3 — Migración 174 no aplicada.** `npm run migrate` contra la Neon real aplicó **172, 173 y
174** (estaban pendientes las tres; no había problema de orden ni dependencia). Confirmado por
consulta directa: `app.tercero_tiene_movimientos(uuid)` existe en el esquema `app` con
`prosecdef = true`, y el trigger `third_party_restrict_delete` existe sobre `third_party`.

**BUG 4 — Seleccionar empresa forzaba modo claro. Causa raíz.** `cambiarEmpresaActivaAction` hace
`redirect(destino)`; ese refresh de server action re-renderiza el árbol RSC completo, incluido
`<html>`. Con el enfoque viejo (script + `localStorage`) el servidor emitía `<html>` **sin**
`data-tema` y React eliminaba el atributo que había puesto el script → el CSS caía a claro. Con el
enfoque de D-085 no hay nada que se pierda: si el usuario no eligió, no hay `data-tema` y manda el
`@media` del CSS; si eligió, `app/layout.tsx` re-lee la cookie en ese mismo refresh y vuelve a
emitir `<html data-tema="…">` — React lo mantiene porque ahora es una prop que él controla.
`TemaProvider` recibe ese valor de servidor como prop `inicial`, así que arranca igual en servidor
y cliente.

**Archivos tocados.** `app/layout.tsx` (lee la cookie `contable-co-tema`, pinta `<html data-tema>`,
`suppressHydrationWarning`; se quitó el `<script>` y el import de `next/script`),
`app/lib/sesion.ts` (`COOKIE_TEMA = 'contable-co-tema'`), `app/_ui/contextos.tsx` (`TemaProvider`
recibe `inicial`, escribe la cookie en `fijar`/`alternar`, sincroniza `<html data-tema>` sin
esperar navegación, sigue al SO mientras no haya elección), `app/_ui/Chrome.tsx` (pasa `temaInicial`
a `TemaProvider`), `app/globals.css` (`@custom-variant dark` con `@media` + `[data-tema='oscuro']`;
bloque de tokens oscuros duplicado en `@media` y `[data-tema='oscuro']`). Nuevo:
`.claude/launch.json` (perfil `dev` para la QA en navegador).

**Verificación.** `npx tsc --noEmit` limpio · `npx next build` **exit 0** · `npm test`
**1065 en verde** (52 archivos, sin cambio de conteo). **En navegador real, en `next start` Y en
`next dev`** (sesión `prueba@contable.co`): consola **sin errores ni warnings** en `/entrar`, `/`
(Inicio) y `/terceros`, al alternar el tema, y durante varios cambios de empresa seguidos (el
`console.error` de React del enfoque viejo ya no aparece ni en dev). SO oscuro sin cookie abre
oscuro (fondo `#09090b`, sin `data-tema`), SO claro sin cookie abre claro; el toggle escribe la
cookie, el servidor la pinta en `<html data-tema>` y **persiste** tras navegar; cambiar de empresa
(server action) **ya no altera** el tema. Sin comitear.

---

### D-086 — Catálogo geográfico DANE (departamento → municipio) + selector de dirección en formato DIAN

**Encargo.** Dos entregables sobre el módulo Terceros (D-084), sin romper nada de lo construido.
PARTE A: catálogo parametrizado de los 33 departamentos y los 1.122 municipios de Colombia con su
código DANE, verificados contra la fuente oficial, y reemplazo del campo de municipio por un
selector dependiente departamento → municipio. PARTE B: al hacer clic en el campo de dirección
(crear y editar tercero) se abre un modal que guía campo por campo y compone la dirección en el
formato exacto de la DIAN (Formato 1001 de exógena), sin permitir texto libre fuera de esa
estructura.

**Verificación de la fuente (hecha con navegador, 2026-09-02).**
- *Geografía*: DANE DIVIPOLA, descargada del portal oficial de datos abiertos del Estado
  (`datos.gov.co`), datasets `vcjz-niiq` (departamentos) y `gdxc-w37w` (municipios). 33
  departamentos (incluye «Bogotá, D.C.» como entidad propia) y **1.122** entidades territoriales:
  1.103 municipios + 1 isla (San Andrés) + 18 áreas no municipalizadas. Cada código de 5 dígitos =
  2 de departamento + 3 de municipio; el prefijo coincide con el código del departamento en las
  1.122 filas (verificado). Conteos contrastados: Antioquia 125, Boyacá 123, Cundinamarca 116,
  Santander 87, Nariño 64 — coinciden con las cifras DANE. Los códigos DANE son dato público y
  estable (mismo criterio que `080_municipios.sql`): se cargan sin marca de verificación humana.
- *Dirección DIAN*: documento oficial de nomenclatura de la DIAN (MUISCA, tabla `AC`…`ZN`) y el
  «Generador de Direcciones» del portal MUISCA. La DIAN compone la dirección como secuencia de
  tokens de un vocabulario cerrado: `<TIPO_VÍA> <número><letra?> [BIS] [CUADRANTE] # <número_gen><letra?>
  [CUADRANTE] - <placa> [<TIPO_COMPLEMENTO> <valor>]...`. Las abreviaturas que usa el módulo (CL, CR,
  AV, AK, AC, DG, TV, CIR… y los complementos IN, AP, TO, BL, OF…) son las de ese documento, sin
  inventar ninguna.

**Decisiones de modelado (para no reabrir).**
1. **`municipality` NO se rehace.** Ya existía (004) como tabla plana con `departamento` /
   `codigo_dane_departamento` de texto y FKs desde `third_party`, `company`, `third_party_activity`,
   `municipality_ica_rule`. Se le **añade** `department_id uuid` (nullable) hacia la tabla nueva
   `department`, y un trigger `municipality_resolver_departamento` la rellena desde
   `codigo_dane_departamento` en el propio INSERT/UPDATE. Así cada INSERT antiguo (fixtures, seeds
   080/040) sigue compilando y corriendo sin tocarse; las columnas de texto se conservan para los
   consumidores previos (exógena lee `m.codigo_dane_departamento`).
2. **Los 33 departamentos van en la MIGRACIÓN 175, los 1.122 municipios en un SEED.** Los
   departamentos son 33 filas de identidad pura (código de 2 dígitos + nombre, cero valores
   tributarios); tenerlas en la misma transacción que la FK permite reenlazar de inmediato los
   municipios globales que un seed anterior ya hubiera cargado. Los municipios van en
   `db/seeds/tanda0-geografia/020_municipios.sql` porque sembrarlos en una migración rompería las
   pruebas de A1 que cuentan `municipality` tras la tanda 1. El prefijo `tanda0-` hace que corran
   **antes** que tanda1/tanda2 (que redeclaran Bogotá/Medellín/Cali con `WHERE NOT EXISTS`), y el
   trigger enlaza `department_id` en cada INSERT.
3. **La dirección canónica sigue siendo `third_party.direccion` (texto).** Es lo que consume
   exógena. Se añade `direccion_dian jsonb` con el desglose campo a campo; **cuando no es NULL,
   `direccion` es exactamente su composición** (`componerDireccionDian`). El modal escribe las dos
   cosas; el server action revalida y recompone en el servidor, así que el texto libre no entra ni
   por POST directo.
4. **Migración de datos: marcar, nunca borrar ni adivinar** (mismo criterio de A14 para V-23). Los
   terceros creados antes de D-086 conservan su `direccion` de texto libre **intacta** y quedan con
   `direccion_requiere_revision = true`; un tercero nacional sin municipio queda con
   `municipio_requiere_revision = true`. La ficha del tercero y el listado muestran esas marcas con
   un `MensajeEstado`/`Badge`; al guardar por el selector, la marca se apaga. El desglose
   automático (`intentarDesglosarDireccionLibre`) es deliberadamente conservador: solo produce
   estructura ante un patrón inequívoco y sin resto; cualquier coma, complemento o forma rara →
   marcado para revisión. (En el esquema actual `municipality_id` ya era una FK, así que «municipio
   en texto libre viejo» no existe como tal; el caso real que queda es el municipio ausente.)
5. **Guardia de alcance de las FK nuevas** (D-032 / migración 018). `department` es catálogo
   híbrido (`tenant_id` puede ser NULL) igual que `municipality`, así que la FK compuesta no es
   expresable y va el trigger genérico `trg_fk_alcance`: se instala en `department` (→ company) y se
   **recrean** `municipality_fk_alcance` y `third_party_fk_alcance` con el par nuevo añadido. El
   barrido de `evasion.test.ts` («ningún hueco de alcance») pasa.

**Estructura de la dirección DIAN en el modal.** Tipo de vía principal (con abreviatura visible,
p.ej. «Carrera (CR)») · número + letra + BIS + cuadrante · `#` · número de vía generadora + letra +
cuadrante · `-` · placa · complementos repetibles (tipo + valor, ambos de vocabulario cerrado). El
input visible es de **solo lectura** y solo se edita por el modal; vista previa en vivo y lista de
errores. Mismo lenguaje visual que el resto (tokens de tema, `Panel`, radios/inputs de D-082/D-084)
— sin un `#hex` suelto.

**Archivos.** Nuevos: `db/migrations/175_a8_d086_geografia_y_direccion_dian.sql`,
`db/seeds/tanda0-geografia/020_municipios.sql`, `src/domain/direccion-dian.ts`,
`app/terceros/_direccion-dian.tsx`, `tests/domain/direccion-dian.test.ts`,
`tests/services/terceros-d086.test.ts`. Tocados: `src/services/terceros.ts` (tipos
`DireccionDian`, `resolverMunicipio`/`resolverDireccion`, `listarDepartamentosParaSelector`,
`listarGeografiaParaSelector`, `FilaTercero` con `departmentId`/`direccionDian`/marcas de revisión,
`crear`/`editarTercero`), `app/terceros/nuevo/page.tsx` + `app/terceros/nuevo/acciones.ts`,
`app/terceros/[id]/page.tsx` + `app/terceros/[id]/acciones.ts`, `app/terceros/page.tsx`.

**Verificación.** `npx tsc --noEmit` limpio · `npx next build` **exit 0** (la advertencia `node:dns`
en Edge Runtime es la de D-080, no de esta ola) · `npm test` **1115 en verde** (55 archivos; base
D-085 = 1065/52; esta ola suma `tests/domain/direccion-dian.test.ts`,
`tests/services/terceros-d086.test.ts` y la suite de A14 `tests/adversarial/a14-d086-ampliada.test.ts`
con 30 pruebas). Gates adversariales de esquema, FK y valores tributarios en verde con la migración
nueva.
**Compuerta de A14 (modo ampliado): PASA con correcciones.** A14 no verificó por reporte: escribió
su propia suite y encontró **seis defectos**, todos corregidos por él en la misma pasada — ver
«Compuerta AMPLIADA de D-086» y V-33…V-38 en el registro de vulnerabilidades. En resumen: el `jsonb`
guardaba claves inyectadas del cliente (V-33); coerción de tipos dejaba pasar un desglose que ya no
recomponía (V-34); el texto libre entraba sin marca por carga masiva / POST directo (V-35); el
backfill no marcaba al tercero nacional sin ninguna dirección (V-36); editar con texto libre
borraba en silencio un desglose ya normalizado (V-37); dos regresiones de UI, incluida que un
tercero mal marcado «del exterior» quedaba sin forma de volver a nacional (V-38). A14 también
contrastó **los 33 departamentos uno por uno** contra DIVIPOLA (Chocó 31 y Guainía 8 son correctos
y recientes: `27493 Nuevo Belén de Bajirá` creado en 2022, `Mapiripana` absorbido por Barrancominas).
**Verificación en navegador real: NO se pudo hacer** (ni yo ni A14 tenemos ruta DNS a la Neon:
`getaddrinfo ENOTFOUND …neon.tech`). Por la convención de D-085 **esto no se cierra hasta hacerlo**:
aplicar 175 + `npm run seed` a la Neon, crear un tercero nuevo con ambos selectores de principio a
fin, confirmar que un tercero migrado no mapeado se ve marcado, y probar el caso de V-38(b) (un
tercero del exterior debe poder volver a ser nacional). **A14 editó la migración 175** (V-36): si ya
se aplicó a alguna Neon, hay que reaplicarla o corregir su `checksum` (el runner las trata como
inmutables). Sin comitear.

---

## Compuerta AMPLIADA de D-086 — veredicto de A14 (2026-09-03): **PASA con correcciones, hechas por A14 en la misma pasada**

A14 no verificó por reporte. Escribió su propia suite —**`tests/adversarial/a14-d086-ampliada.test.ts`,
30 pruebas**— contra lo que la compuerta de A8 no intentó, y **la primera pasada encontró SEIS
defectos reales** (V-33 … V-38). Todos corregidos aquí, cada uno con su prueba de regresión.

### Lo que se verificó y SÍ estaba bien (verificado por A14, no aceptado por reporte)

- **El catálogo DANE es correcto y completo.** No un spot-check de tres: A14 comparó los **33
  departamentos, uno por uno**, contra DIVIPOLA vigente. Total 1.122; Antioquia 125, Boyacá 123,
  Cundinamarca 116, Santander 87, Tolima 47, Bolívar 46, Cauca 42, Valle 42, Norte de Santander 40,
  Huila 37, **Chocó 31** (incluye `27493 Nuevo Belén de Bajirá`, creado en 2022 — señal de dataset
  reciente), Magdalena 30, Córdoba 30, Meta 29, Caldas 27, Sucre 26, Cesar 25, Atlántico 23,
  Casanare 19, Caquetá 16, La Guajira 15, Risaralda 14, Putumayo 13, Quindío 12, Amazonas 11,
  **Guainía 8** (correcto: `Mapiripana` desapareció al municipalizarse Barrancominas), Arauca 7,
  Vaupés 6, Guaviare 4, Vichada 4, San Andrés 2, Bogotá 1. **Cero códigos duplicados, cero códigos
  malformados, prefijo == código de departamento en las 1.122 filas, `department_id` resuelto en el
  100 %.** Spot-check de 29 códigos conocidos (Envigado, Soledad, Soacha, Buenaventura…): todos.
- **Aislamiento (Regla 7) sobre lo nuevo.** `department` tiene RLS `ENABLE` **y** `FORCE` y una sola
  política; un departamento de otra firma no se ve ni por el selector ni por SQL directo; el trigger
  `municipality_resolver_departamento` **no engancha** un municipio a un `department` de otra firma
  aunque comparta código DANE (cae al global, verificado); la guardia de alcance rechaza con `AL001`
  apuntar `third_party.department_id` a un departamento ajeno; y **`municipality_id` sigue cubierta**
  tras recrear `third_party_fk_alcance` (era el riesgo real de ese `DROP TRIGGER`: se comprobó contra
  018 que el trigger viejo solo guardaba `municipality_id`, así que no se perdió ninguna pareja).
  Sin `parametro.editar` no se escribe en `department`.
- **Reglas 2 y 3 sobre el material nuevo.** La migración 175 no inserta ninguna fila normativa ni
  menciona `vigente_desde`/`vigente_hasta`; el seed nuevo es solo datos (ni un `UPDATE`, ni un
  `DELETE`, ni una función, e idempotente por `WHERE NOT EXISTS`). El detector de la Regla de Oro 2
  barre `db/migrations/` y la raíz, y sigue en verde con la migración nueva.
- **Orden de los seeds.** `tanda0-geografia/` ordena antes que `tanda1/` y `tanda2/` (orden
  alfabético por ruta relativa, verificado en `src/db/seed.ts`), y los tres municipios que
  redeclaran tanda1/tanda2 tienen **exactamente las mismas columnas**: no se pierde ningún dato al
  quedar sus INSERT sin efecto. Las reglas de ReteICA se enganchan por `codigo_dane`, **no por
  nombre**, así que el cambio de rótulo `Cali` → `Santiago de Cali` (nombre oficial DIVIPOLA) no
  altera ningún cálculo — se verificó que el único consumidor por nombre, `datos-ejemplo`, también
  resuelve por código.
- **Los 20 casos dorados, completos.** Reejecutados de punta a punta por A14, no una muestra.
- **D-084 intacto.** Eliminar/inactivar (`TP001`), historial de vigencias, exportación a Excel
  aislada por RLS y exógena Formato 1001 (que sigue leyendo `third_party.direccion`, con semántica
  sin cambios) siguen en verde.

### Los seis defectos que A14 encontró y corrigió

Ver V-33 … V-38 en el registro de vulnerabilidades.

### Casos dorados — veredicto de esta compuerta, uno por uno

| # | Caso | Resultado |
|---|---|---|
| 1 | Servicio $1.000.000 + IVA, PJ declarante, Bogotá | **PASA** (retefuente $40.000, ReteIVA $28.500; la pata de ReteICA de Bogotá sigue sin tarifa por actividad — V-5, abierta y declarada, no es de D-086) |
| 2 | PN no declarante → 6 % | **PASA** |
| 3 | Servicio bajo 2 UVT | **PASA** (no retiene, con motivo registrado) |
| 4 | Compra bajo 10 UVT | **PASA** (no retiene, con motivo) |
| 5 | Compra $600.000 a declarante | **PASA** |
| 6 | Honorarios PJ $200.000 | **PASA** |
| 7 | Arrendamiento inmueble vs. mueble | **PASA** |
| 8 | Servicio en Medellín (ReteICA 2‰, base 15 UVT) | **PASA** |
| 9 | Mismo servicio en Cali (base 3 UVT) | **PASA** — verificado además que el renombre a «Santiago de Cali» no lo toca |
| 10 | Actividad de Cali manda sobre la de Bogotá | **PASA** |
| 11 | Vigilancia con AIU | **PASA** (2 % sobre el AIU) |
| 12 | Proveedor del exterior → ReteIVA 100 % | **PASA** — y A14 añadió que un tercero del exterior no arrastra dirección ni marcas colombianas |
| 13 | Régimen SIMPLE | **PASA** (según parametrización, nunca por omisión) |
| 14 | Tres líneas de conceptos distintos | **PASA** (+ variante hostil: trocear no esquiva la base mínima) |
| 15 | Nota crédito sobre factura causada | **PASA** (reversa por asiento nuevo, sin mutar el original) |
| 16 | Factura de junio procesada en julio | **PASA** (manda la fecha del hecho económico) |
| 17 | Cambio de tarifa con vigencia futura | **PASA** (lo publicado no cambia; lo nuevo usa la tarifa nueva) |
| 18 | Reprocesar 10 veces | **PASA** (asiento idéntico las 10) |
| 19 | Segunda factura del mismo proveedor y descripción | **PASA** (cero llamadas al LLM, con espía de `fetch` a nivel de proceso) |
| 20 | Tenant A consulta al tenant B | **PASA** (cero filas, impuesto por RLS) |

Pruebas adicionales de integridad de la §12, reverificadas: grep de literales tributarios → cero;
`UPDATE`/`DELETE` sobre asiento publicado → falla en BD; asiento desbalanceado → falla en BD;
balance de prueba contra el ledger → cuadra al centavo.

**Verificación final tras las correcciones de A14.** `npx tsc --noEmit` limpio · `npx next build`
**exit 0** (la advertencia `node:dns` en Edge Runtime es la de D-080) · `npm test` **1115 en verde,
55 archivos** (1085 de D-086 + las 30 pruebas nuevas de A14).

**Salvedad que A14 NO da por cerrada (y que no bloquea el código):** la verificación en **navegador
real** contra la Neon no se pudo hacer en este entorno (sin ruta DNS). Por la convención de D-085,
**el entregable no se comitea como cerrado hasta que alguien con red a la Neon** aplique la
migración 175 + `npm run seed` y recorra `/terceros`, `/terceros/nuevo` y `/terceros/[id]`
(selector dependiente, modal de dirección, marcas de revisión, y **el caso corregido en V-38**:
un tercero marcado como del exterior debe poder volver a ser nacional). Ojo con el orden: **la
migración 175 se editó en esta compuerta** (V-36); si alguien ya la aplicó a su Neon antes de esta
pasada, hay que reaplicarla o corregir a mano su `checksum`, porque el runner las trata como
inmutables.

---

### D-087 — Módulo de Parámetros tributarios, Fase 4: migración visual + badges clicables + permiso por submódulo + simulador bloqueante en todas las pantallas

**Encargo.** Cerrar COMPLETA la Fase 4 del Módulo de Parámetros. Cuatro frentes: (0) deuda visual
de D-077/D-082 —`/parametros` heredaba el `AppShell` nuevo pero conservaba «cuerpo viejo» (`style`
inline, `#hex`, `<table border={1}>`) y se pintaba con `data-tema="claro"` fijo—; (1) los badges
FALTA DATO / VERIFICAR del banner de alertas ahora son accionables; (2) granularidad de permiso por
submódulo; (3) el simulador de impacto, bloqueante y con detalle real, en TODA pantalla de cambio de
parámetro.

**TAREA 0 — Cuerpo migrado al kit.** Las seis pantallas de `/parametros` (`page.tsx`,
`tarifas/[tipo]`, `valores-base`, `reteica-municipios`, `puc`) y `_componentes.tsx` se reescribieron
sobre `app/_ui/` (tokens de tema, `Encabezado`, `Panel`, `Tabla`/`Th`/`Td` sticky de D-078,
`MensajeEstado`, `Campo`/`Entrada`/`Selector`, `Boton`/`EnlaceBoton`, escala tipográfica de D-082).
Cero `style` inline, cero `#hex`. **`/parametros` salió de `PREFIJOS_SIN_MIGRAR`** en `AppShell.tsx`:
el subárbol responde a `data-tema="oscuro"` igual que `/` y `/terceros`. (`PREFIJOS_SIN_MIGRAR`
queda con `/reportes`, `/admin`, `/carga-masiva`.) Verificado con `next build` (37 rutas, las cinco
de `/parametros` compiladas).

**TAREA 1 — Modal genérico extraído + badges clicables.** Se extrajo `Modal` a
`app/_ui/componentes.tsx` desde el modal de dirección DIAN de D-086: mismo markup y comportamiento
(`role="dialog"` + `aria-modal`, overlay `bg-texto/40`, cierre con Escape y con clic fuera, el
diálogo recibe el foco al abrir y lo devuelve al cerrar) **más un `Tab`/`Shift+Tab` que cicla dentro
del diálogo** (foco atrapado, que el de D-086 no tenía). `app/terceros/_direccion-dian.tsx` se
refactorizó para consumir `Modal` — comportamiento idéntico, los 30 casos de
`a14-d086-ampliada.test.ts` + `direccion-dian.test.ts` siguen verdes. En `BannerAlertas`
(`_componentes.tsx`, ahora `'use client'`) cada badge es un botón; al pulsarlo abre `Modal` con el
mensaje y un `EnlaceBoton` al **submódulo** que corrige el dato (no al campo), derivado de
`AlertaParametro.categoria`: `municipality_ica_rule*` → `/parametros/reteica-municipios`,
`tax_rule_reteica` → `/parametros/tarifas/reteica`, `retefuente_salarios` →
`/parametros/tarifas/retefuente_salarios`, `smmlv_value`/`uvt_value` → `/parametros/valores-base`,
`tax_calendar` → `/carga-masiva`, resto de `tax_rule*` → `/parametros/tarifas/retefuente`.

**TAREA 2 — Permiso por submódulo (migración `176_a8_d087_permisos_parametros.sql`).** Ocho códigos
nuevos en el catálogo `permission`: `parametro.{tarifas,valores_base,reteica,puc}.{leer,editar}`
(`accion_tipo` `ver`/`editar` — el CHECK de 170 admite `ver`, no `leer`). Espejados en `PERMISOS`
de `src/auth/permisos.ts` (la compuerta `seguridad.test.ts` exige que catálogo y espejo coincidan;
pasa). El comportamiento actual se preserva con **`INSERT ... SELECT` desde `role_permission`**:
quien tiene `parametro.editar` recibe los tres `*.editar` de parámetros, quien tiene `parametro.leer`
los tres `*.leer`, y quien tiene `puc.editar`/`puc.leer` recibe `parametro.puc.editar`/`.leer` —
**sin un solo `UPDATE`**. `admin_firma` tiene los códigos gruesos como filas explícitas (D-066), así
que recibe los ocho y la invariante «admin_firma lo tiene todo» (`arranque.test.ts`) se mantiene.
Los helpers `puedeEditarParametros(tx, submodulo?)` y el nuevo `puedeLeerParametros` aceptan el
submódulo y delegan en `tienePermiso` con el código fino (registro `PERMISOS`, nunca cadena suelta);
sin argumento siguen comprobando el código grueso (retrocompatible). **La ESCRITURA en la base la
siguen imponiendo los triggers de 016 sobre `parametro.editar` / `puc.editar`**: no se retargeteó
ningún trigger. Los códigos finos son, por ahora, para que la interfaz muestre u oculte cada
submódulo con precisión; la Fase 8 podrá retargetear los triggers agregando/moviendo filas cuando
exista un rol que edite un submódulo y no otro. Como todo rol con `parametro.editar` recibe los
cuatro `*.editar`, el candado del motor no se relaja.

**TAREA 3 — Simulador bloqueante + detalle real en TODA pantalla de cambio.**
- `valores-base` pasó de un paso (checkbox «he revisado») a **DOS pasos** como `tarifas/[tipo]`:
  `simular{Uvt,Smmlv,Redondeo}Action` calcula el impacto y redirige al paso de confirmación;
  `confirmar{Uvt,Smmlv,Redondeo}Action` es la única que escribe. El simulador corre **antes** de que
  exista el botón de guardar, nunca junto.
- `reteica-municipios` ya era de dos pasos; se le añadió el detalle.
- **`puc`**: se migró visualmente y usa `parametro.puc.editar` para mostrar el submódulo. **No se le
  añadió simulador de N conceptos / M proveedores**: editar el PUC no abre ni cierra vigencias
  tributarias, y el modelo de impacto (conceptos de causación × proveedores) no le aplica. Su
  resguardo bloqueante es el guardia de «cuentas imputables» ya presente (D-064/D-065): sin al menos
  una cuenta activa imputable no se puede apagar la herencia ni causar. Decisión declarada, no
  bloqueante.
- Migración 176 añade `app.detalle_impacto_{tax_concept,municipio_ica,valor_base}`: devuelven las
  **filas reales** (conceptos de causación + proveedores, con código y nombre) usando **el mismo
  `WHERE`** que las funciones de conteo hermanas de 080 — conteo y detalle no divergen. Mismas
  garantías: `SECURITY DEFINER` + `row_security = off` + filtro explícito por `app.current_tenant_id()`
  + `PERFORM app.exigir_permiso('parametro.editar')`. Wrappers en `src/services/parametrizacion.ts`
  (`detalleImpacto{Tarifa,MunicipioIca,ValorBase}`); componente cliente `BotonDetalleImpacto`
  (`app/parametros/_detalle-impacto.tsx`) que las muestra en el `Modal` del kit.

**Cada edición de parámetro (verificado, sigue igual):** cierra la vigencia anterior e inserta fila
nueva (nunca `UPDATE` — trigger PR001); exige fecha de vigencia y norma de respaldo (servicio +
`NOT NULL`); no retroactiva sobre lo publicado (`app.fecha_minima_vigencia_*` + `EdicionRetroactivaError`);
queda en `audit_log` con la norma (`app.trg_audit`); restringida a `parametro.editar` en el motor
(SE002). El alcance firma-vs-empresa (D-015): un administrador de firma edita un parámetro compartido
(`company_id NULL`) desde una sesión de firma sin que la RLS lo bloquee — ya verificado en
`parametrizacion.test.ts` («administrador de firma edita un parámetro compartido»), sin cambio de A2
necesario. D-087 no toca esa ruta.

**Archivos.** Nuevo: `db/migrations/176_a8_d087_permisos_parametros.sql`,
`app/parametros/_detalle-impacto.tsx`. Tocados: `app/_ui/componentes.tsx` (`Modal`),
`app/_ui/AppShell.tsx` (sacar `/parametros` de `PREFIJOS_SIN_MIGRAR`),
`app/terceros/_direccion-dian.tsx` (consume `Modal`), `app/parametros/_componentes.tsx`,
`app/parametros/page.tsx`, `app/parametros/tarifas/[tipo]/page.tsx`,
`app/parametros/valores-base/{page.tsx,acciones.ts}`,
`app/parametros/reteica-municipios/page.tsx`, `app/parametros/puc/page.tsx`,
`src/auth/permisos.ts` (8 códigos en `PERMISOS`), `src/services/parametrizacion.ts`
(`SubmoduloParametro`, `puedeEditarParametros(submodulo?)`, `puedeLeerParametros`, `detalleImpacto*`,
`DetalleImpacto`), `src/services/index.ts` (re-exports),
`tests/adversarial/evasion.test.ts` + `tests/adversarial/compuerta-ola1.test.ts` (el inventario de
funciones `app.*` ejecutables por `app_user` suma `app.detalle_impacto_*` — ajuste de conteo, no de
comportamiento), `tests/adversarial/compuerta-ola2-interfaz.test.ts` (la compuerta de A14 que
ejercía `guardarUvtAction` de un paso ahora recorre el flujo de dos pasos con un helper local
`simularUvtAction` → `confirmarUvtAction`; todas sus aserciones —`ok=uvt`, redirección con error en
el caso retroactivo y en el sin permiso, ledger intacto— se conservan).

**Decisiones para no reabrir.**
1. Los sub-permisos de parámetros son **UI-only por ahora**; el motor sigue en `parametro.editar` /
   `puc.editar`. Conectar un rol que edite un submódulo y no otro = retargetear el trigger de 016 y
   agregar filas en la Fase 8, sin reescribir esta capa.
2. `parametro.puc.*` existe además de `puc.*` (no lo reemplaza): es el permiso del submódulo PUC
   *dentro de* `/parametros`. Se otorga en lockstep con `puc.*` en 176.
3. PUC no lleva simulador de conceptos/proveedores (no abre vigencias tributarias); su resguardo es
   el guardia de cuentas imputables.
4. `Modal` del kit añade foco atrapado (Tab cycle); el de D-086 no lo tenía. No cambia ningún
   comportamiento observable de D-086.

**Verificación.** `npx tsc --noEmit` limpio · `npx next build` **exit 0** (37 rutas; la advertencia
`node:dns` en Edge Runtime es la de D-080) · `npm test` **1115 en verde** (55 archivos; base
D-086 = 1115/55 — D-087 no añade archivo de prueba propio: la suite adversarial de D-087 la debe
escribir A14). **Verificación en navegador real: NO ejecutada** (sin ruta DNS a la Neon desde este
entorno, misma situación que D-086). Por la convención de D-085 **no se cierra hasta hacerlo**:
aplicar la migración 176 a la Neon, entrar a `/parametros` con el tema oscuro y confirmar que ya no
se pinta claro; abrir un badge de alerta y ver el modal con el enlace al submódulo; simular un cambio
de tarifa y de UVT y confirmar que el conteo y el «Ver detalle» muestran números/filas reales
**antes** de que aparezca el botón de guardar. **Compuerta de A14: PENDIENTE.**

**Qué debe auditar A14.** (a) que `app.detalle_impacto_*` cuenta contra datos **reales** y coincide
exactamente con el conteo de `app.simular_impacto_*` para el mismo parámetro (mismo `WHERE`), y que
respeta RLS / no cruza firmas (mismo barrido que hizo con las de 080); (b) que la migración 176 no
relaja el candado del motor —un rol con `parametro.tarifas.editar` pero **sin** `parametro.editar`
sigue sin poder escribir `tax_rule` (SE002), porque el trigger de 016 no se tocó—; (c) que
`admin_firma` sigue teniendo TODOS los permisos y `solo_lectura` sigue sin ningún `.editar`; (d) que
el flujo de dos pasos de `valores-base` no tiene ningún camino que guarde sin simular primero
(incluido POST directo a `confirmar*Action` — que sí se puede, pero entonces el contador no vio el
impacto: valorar si el paso 2 debe exigir un testigo del paso 1); (e) que el refactor de
`_direccion-dian.tsx` a `Modal` no rompió ninguno de los 20 casos dorados de dirección de D-086;
(f) el simulador bloqueante para `reteica-municipios` y `tarifas` sigue corriendo ANTES de guardar,
nunca junto.

**Revisión de seguridad de A12 (2026-09-03) — alcance: SOLO la granularidad de permisos por
submódulo y su relación con la RLS. Veredicto: PASA CON CORRECCIONES.** No cubre el simulador ni la
migración visual (eso sigue siendo de A14, puntos (a), (d), (e) y (f) de arriba). Todo lo que sigue
está verificado por ejecución en `tests/adversarial/a12-d087-permisos.test.ts` (**18 pruebas**), no
por lectura:

- **El candado del motor NO se relaja (confirmado leyendo 016 y 176, y atacando la tabla).** 176 no
  contiene un solo `CREATE TRIGGER` ni toca `app.instalar_permiso_escritura`; los triggers de 016
  siguen exigiendo `parametro.editar` (`tax_rule`, `tax_concept`, `tax_calendar`, `uvt_value`,
  `smmlv_value`, `rounding_rule`, `municipality`, `municipality_ica_rule`, `ciiu_activity`) y
  `puc.editar` (`account`, `niif_mapping`, `cost_center`). Probado con un **rol propio de firma** que
  tiene `parametro.tarifas.editar` y `parametro.puc.editar` y **no** los gruesos: el `INSERT` directo
  contra `tax_rule` y contra `account` —saltándose todo servicio— muere con **SE002**. Con control
  positivo: el mismo rol, con `parametro.editar` añadido, sí escribe. Las tres
  `app.detalle_impacto_*` también exigen el grueso y le contestan SE002.
- **El reparto de `role_permission` es append-only y no mueve a nadie de sitio.** 176 solo tiene
  `INSERT ... SELECT` + `ON CONFLICT DO NOTHING`, ningún `UPDATE`/`DELETE`; el trigger
  `role_permission_blindaje` (170) no se dispara porque solo actúa cuando `TG_OP <> 'INSERT'`.
  Probado por barrido: para los cinco roles del sistema, tener el fino ⇔ tener el grueso;
  `admin_firma` no tiene ni un código del catálogo sin fila; `solo_lectura` no tiene **ningún**
  permiso con `accion_tipo <> 'ver'`; `auxiliar_causacion` no tiene ningún `parametro.*.editar`.
  `admin_tributario` y `contador` reciben exactamente los equivalentes de lo que ya tenían.
- **El espejo `PERMISOS` coincide con el catálogo.** Compuerta ejecutada:
  `tests/gates/seguridad.test.ts` («el catálogo de permisos del código y el de la base son el mismo»,
  `SELECT codigo FROM permission` vs. `Object.values(PERMISOS)`) → **verde**, junto con
  `tests/gates/arranque.test.ts` (57 pruebas entre las dos).
- **RLS de doble nivel intacta.** `role_permission` (política de 012: `USING` = rol global o del
  tenant en sesión) no deja ver las filas del rol propio de otra firma; `v_user_permission`
  (`security_invoker`, apoyada en la RLS de `user_company_access`) no devuelve ni una fila con
  `tenant_id` ajeno, y los ocho códigos finos solo aparecen para la empresa en contexto.
  `permisosDeLaSesion` sigue filtrando por `app.current_company_id()` (sin cambios).
- **Las tres `app.detalle_impacto_*` son `SECURITY DEFINER` + `row_security = off`, y están en las
  DOS copias del inventario de funciones (D-042)**: `tests/adversarial/compuerta-ola1.test.ts` y
  `tests/adversarial/evasion.test.ts`. Auditadas como **oráculo de existencia**: la respuesta al id
  REAL de un `tax_concept` / `municipality` de otra firma es idéntica a la de un id inventado, y
  `detalle_impacto_valor_base()` no deja caer nada de la otra firma. No filtran.

**Dos correcciones aplicadas por A12 en la misma pasada** (ambas con prueba de regresión que falla
sin el parche — verificado revirtiendo el parche y viendo caer la prueba):

1. **La interfaz ofrecía guardar a un rol que el motor iba a rechazar.**
   `puedeEditarParametros(tx, submodulo)` miraba **solo** el código fino. Como `fijarPermisosDeRol`
   (D-067) **ya hoy** deja a un administrador de firma armar un rol propio con cualquier subconjunto
   del catálogo —no hace falta esperar a la Fase 8—, un rol con `parametro.tarifas.editar` y sin
   `parametro.editar` veía el formulario completo de vigencia nueva y recibía **SE002 en la cara** al
   enviarlo. Ahora el sub-permiso **restringe pero no habilita**: se exigen los dos códigos, el fino
   y el que el motor impone de verdad (`parametro.editar`, o `puc.editar` para el submódulo PUC).
   Para los cinco roles del sistema el resultado es idéntico al de antes del parche, porque 176 da el
   fino exactamente a quien ya tenía el grueso. Mismo criterio en `puedeLeerParametros`.
2. **`permission.modulo` de los ocho códigos: `'parametros'` → `'parametrizacion'`.**
   `/admin/roles` arma la matriz agrupando por `permission.modulo` (`listarCatalogoPermisos`), así
   que los códigos nuevos habrían abierto un grupo «parametros» al lado del grupo «parametrizacion»
   donde vive la casilla que **sí** manda (`parametro.editar`). Dos etiquetas homónimas en una
   pantalla de otorgar privilegios, con el permiso efectivo separado de los decorativos, es una
   trampa de configuración. Los ocho quedan en `'parametrizacion'`, junto al grueso.

**Punto declarado, no bloqueante.** La divergencia inversa (un rol propio con `parametro.editar` y
sin `parametro.tarifas.editar`) esconde el botón aunque el motor aceptaría: es fail-closed y se
resuelve marcando también la casilla fina. Cuando la Fase 8 retargetee los triggers a los códigos
finos, `COD_MOTOR_EDITAR` en `src/services/parametrizacion.ts` es el único sitio que cambia.

**Archivos que tocó A12.** `db/migrations/176_a8_d087_permisos_parametros.sql` (módulo de los ocho
permisos + comentario del porqué), `src/services/parametrizacion.ts` (`COD_MOTOR_EDITAR` /
`COD_MOTOR_LEER`, `puedeEditarParametros`, `puedeLeerParametros`), nuevo
`tests/adversarial/a12-d087-permisos.test.ts`. **La migración 176 cambió: si ya se aplicó a alguna
base, hay que reaplicarla o corregir `permission.modulo` a mano.** `npx tsc --noEmit` limpio ·
`npm test` **1133 en verde** (56 archivos; base D-087 = 1115/55). Sin comitear.

---

## Compuerta AMPLIADA de D-087 — veredicto de A14 (2026-09-03): **PASA con correcciones, hechas por A14 en la misma pasada**

A14 no verificó por reporte —ni el de A8 ni el de A12—. Escribió su propia suite,
**`tests/adversarial/a14-d087-ampliada.test.ts`, 44 pruebas**, sin reutilizar una sola aserción
ajena, y la primera pasada **encontró CUATRO defectos reales** (V-39 … V-42). Todos corregidos aquí,
cada uno con su prueba de regresión, verificada revirtiendo el parche y viendo caer la prueba.

**Y esta vez SÍ hubo verificación en navegador real contra la Neon** (a diferencia de D-086 y de la
entrega de A8): había ruta de red. Se aplicaron las migraciones **175 y 176** —la base estaba en la
174, así que no hubo conflicto de `checksum` por las ediciones de A14 y A12—, se corrió `npm run seed`
y se recorrieron las cinco pantallas de `/parametros` con una sesión real. **El defecto más grave de
esta compuerta (V-42) solo era visible ahí.**

### Vectores del encargo, uno por uno

| # | Vector | Resultado |
|---|---|---|
| 1 | **El simulador cuenta contra datos REALES.** `app.simular_impacto_*` (080) vs. `app.detalle_impacto_*` (176), fila a fila | **PASA.** Escenario montado a propósito: tres conceptos de causación apuntando al MISMO `tax_concept` por **columnas distintas** (`retefuente`, `reteica`, `autorretención`) y en alcances distintos (firma y empresa), dos empresas hermanas, terceros con historial publicado, y **ruido deliberado** (concepto que no apunta, retenciones de otro municipio, `tipo` distinto de `reteica`, filas con `third_party_id` NULL, y toda la otra firma). El conteo y el detalle coinciden **exactamente** en las tres funciones, incluido el caso 0/0 y el caso «se añade un concepto y un tercero después» (no hay número congelado ni caché). El agregado es de **firma**, no de la empresa en sesión (D-015): medido con y sin empresa en contexto |
| 2 | **RLS sobre permisos por submódulo y funciones de detalle** | **PASA.** Dos firmas montadas de punta a punta. La firma A no ve ni un concepto ni un proveedor de la B en ningún detalle; simular con el `tax_concept` **real** de la otra firma da 0/0 y detalle vacío; y el detalle **no es oráculo de existencia**: la respuesta al id ajeno REAL es idéntica, objeto a objeto, a la del id inventado, en `tax_concept` y en `municipality`. Pese a `row_security = off`, `detalle_impacto_valor_base()` no deja caer ni una fila de la otra firma. Sin sesión, ninguna de las tres responde |
| 3 | **El modal se reutiliza, no se reinventa** | **PASA con deuda declarada.** Los tres consumidores (`_componentes.tsx`, `_detalle-impacto.tsx`, `_direccion-dian.tsx`) importan el `Modal` del kit y **ninguno** declara `role="dialog"` ni overlay propio; el `Modal` conserva Escape, clic fuera y devolución del foco de D-086 y añade el foco atrapado. **Pero el repo NO tiene un solo modal:** `app/_ui/CargaMasiva.tsx` sigue con markup propio (`role="dialog"`, overlay, y **sin** cierre con Escape ni foco atrapado). Es **anterior a D-087** y vive en `/carga-masiva`, que sigue en `PREFIJOS_SIN_MIGRAR`: se declara como deuda de quien migre ese subárbol, no se toca aquí. La prueba **fija la lista exacta** de archivos con diálogo propio, para que ningún modal nuevo se cuele sin pasar por esta compuerta, y comprueba que la deuda no ha entrado en `/parametros` ni en `/terceros`. Los casos de dirección DIAN de D-086 siguen verdes tras el refactor (`a14-d086-ampliada.test.ts` 30/30 + `direccion-dian.test.ts` 10/10) |
| 4 | **El candado del motor no se relaja** | **PASA.** Rol propio de firma con los cuatro `*.editar` finos y **sin** los gruesos: no ve el formulario en ninguno de los cuatro submódulos **y** el `INSERT` directo contra `tax_rule` —saltándose todo servicio— muere con **SE002**. Rol con el grueso y sin el fino: **fail-closed** (no ve el botón) y, sin submódulo, `puedeEditarParametros` sigue devolviendo `true` (retrocompatible). Los **cinco roles del sistema**: fino ⇔ grueso en todos; `admin_firma` puede, `solo_lectura` y `auxiliar_causacion` no; `solo_lectura` no tiene **ningún** permiso con `accion_tipo <> 'ver'`. Las tres `app.detalle_impacto_*` exigen el permiso GRUESO, no el fino. Y 176 **no contiene un solo `CREATE TRIGGER`**, ni `instalar_permiso_escritura`, ni un `UPDATE`/`DELETE` sobre `role_permission` |
| 5 | **El flujo de dos pasos es realmente bloqueante** | **FALLABA — V-39, corregido.** Era decorativo: un POST directo a `confirmarUvtAction`, a `confirmarAction` de tarifas y a `confirmarAction` de ReteICA **abría la vigencia nueva** sin que nadie hubiera visto el impacto. Medido en las tres pantallas. Ahora el paso 2 exige el **testigo del paso 1** y lo revalida contra el impacto real del instante |
| 6 | **Migración visual real** | **PASA.** Cero `style` inline, cero `#hex`, cero `<table>` crudo en las seis piezas de `/parametros`; las cinco pantallas importan del kit; `/parametros` está fuera de `PREFIJOS_SIN_MIGRAR` (que queda con `/reportes`, `/admin`, `/carga-masiva`). Verificado además **en el HTML que sirve el servidor real**: `0` ocurrencias de `style="` |
| 7 | **Regla de Oro 2 sobre lo de D-087** | **PASA.** La migración 176 no menciona `vigente_desde`/`vigente_hasta` y sus **únicos** `INSERT` son a `permission` y `role_permission` — identificadores de permiso, cero valores. Los doce archivos nuevos/migrados pasan el barrido de patrones tributarios. Los ocho códigos están en el catálogo **y** en el espejo `PERMISOS`, los ocho en `modulo = 'parametrizacion'` (la corrección de A12, verificada también **en la Neon**) |
| 8 | **RO 1 y 3 sobre el ledger** | **PASA.** Nada de D-087 abre un camino de mutación: `UPDATE tax_rule` directo desde una sesión con `parametro.editar` sigue rebotando; `UPDATE`/`DELETE` sobre un asiento publicado, también; un asiento desbalanceado sigue muriendo en la BD; y simular + ver el detalle de las tres funciones no escribe **ni una fila** en el ledger |

### Los cuatro defectos que A14 encontró y corrigió

Ver **V-39 … V-42** en el registro de vulnerabilidades. En resumen:

- **V-39** — el resguardo bloqueante del simulador no bloqueaba nada: el paso 2 se podía invocar
  directo. Ahora hay **testigo** (`exigirTestigoImpacto`), que además ataja la pantalla rancia.
- **V-40** — la pantalla de confirmación de tarifas y de ReteICA **pintaba el conteo del query
  string** mientras el «Ver detalle» de al lado se medía contra la base: el número y la lista podían
  contradecirse en la misma pantalla. Exactamente el «dice 3 y lista 2» que el encargo llamaba
  bloqueante. Ahora las dos cifras salen de **la misma lectura**.
- **V-41** — el detalle de tarifas se pedía con el `taxConceptId` **del query string**: el contador
  podía estar mirando el impacto de otra regla mientras guardaba la suya.
- **V-42** — *(hallazgo del navegador)* el banner de alertas renderizaba **1.122 badges**, uno por
  municipio del catálogo DANE de D-086, cada uno —desde D-087— un `<button>` con su modal. 984 KB de
  HTML y las cuatro alertas accionables sepultadas.

### Los 20 casos dorados de la sección 12 — reejecutados COMPLETOS por A14

| # | Caso | Resultado |
|---|---|---|
| 1 | Servicio $1.000.000 + IVA, PJ declarante, Bogotá | **PASA** (retefuente $40.000, ReteIVA $28.500; la pata de ReteICA de Bogotá sigue sin tarifa por actividad — V-5, abierta y declarada, ajena a D-087) |
| 2 | PN no declarante → 6 % | **PASA** ($60.000; el eje «tercero» opera) |
| 3 | Servicio de $80.000, bajo 2 UVT | **PASA** (no retiene, con el motivo registrado) |
| 4 | Compra de $500.000, bajo 10 UVT | **PASA** (no retiene, con motivo) |
| 5 | Compra $600.000 a declarante | **PASA** ($15.000) |
| 6 | Honorarios PJ $200.000 | **PASA** ($22.000 desde el primer peso) |
| 7 | Arrendamiento inmueble vs. mueble | **PASA** (el inmueble no retiene; el mueble sí, $16.000) |
| 8 | Servicio en Medellín (2‰, base 15 UVT) | **PASA** |
| 9 | Mismo servicio en Cali (base 3 UVT) | **PASA** |
| 10 | Actividad de Cali manda sobre la de Bogotá | **PASA** (+ desempate configurable en el mismo municipio) |
| 11 | Vigilancia con AIU | **PASA** (2 % sobre el AIU) |
| 12 | Proveedor del exterior | **PASA** (ReteIVA 100 %; y sin regla de exterior → revisión manual, no un cero) |
| 13 | Régimen SIMPLE | **PASA** (según parametrización, nunca por omisión) |
| 14 | Tres líneas de conceptos distintos | **PASA** (+ variante hostil: trocear no esquiva la base mínima) |
| 15 | Nota crédito sobre factura causada | **PASA** (reversa proporcional por asiento nuevo, sin mutar el original) |
| 16 | Factura de junio procesada en julio | **PASA** (manda la fecha del hecho económico) |
| 17 | Cambio de tarifa con vigencia futura | **PASA** (lo publicado no cambia; lo nuevo usa la tarifa nueva) |
| 18 | Reprocesar 10 veces la misma factura | **PASA** (asiento idéntico las 10) |
| 19 | Segunda factura del mismo proveedor y descripción | **PASA** (cero llamadas al LLM y cero costo; la memoria no se contagia a otro proveedor) |
| 20 | Tenant A consulta al tenant B | **PASA** (cero filas, impuesto por RLS) |

Pruebas adicionales de integridad de la §12, reverificadas en esta pasada: grep de literales
tributarios → cero (`valores-tributarios.test.ts`, 42 pruebas, incluida la que gana la exención de
las constantes de escala contra el esquema real); `UPDATE`/`DELETE` sobre asiento publicado → falla
en BD; asiento desbalanceado → falla en BD; y las migraciones sin los seeds dejan las tablas
normativas **vacías** (los casos no pasan sobre el vacío).

### Verificación en NAVEGADOR REAL contra la Neon — **HECHA** (2026-09-03)

- Migraciones **175 y 176 aplicadas** a `neondb` (estaba en la 174: **sin conflicto de `checksum`**,
  las ediciones de A14 sobre 175 y de A12 sobre 176 entraron limpias). `npm run seed` corrido: **33
  departamentos y 1.122 municipios** cargados.
- **176 verificada en la base real:** los ocho códigos existen, los ocho con `modulo =
  'parametrizacion'` y `accion_tipo` `ver`/`editar`; las tres `app.detalle_impacto_*` existen; el
  reparto quedó `admin_firma` 8, `admin_tributario` 8, `contador` 4, `auxiliar_causacion` 4,
  `solo_lectura` 4 — espejo exacto de los permisos gruesos que ya tenían.
- **Las cinco pantallas de `/parametros` responden 200** con una sesión real de `admin_firma`.
- **El simulador muestra números REALES antes de guardar**, comprobado en las tres pantallas: en
  `valores-base`, «afecta hoy a 2 concepto(s) y 3 proveedor(es)» tanto en el paso 1 como en el paso 2,
  con «Ver detalle» presente y el testigo (`conceptos=2`, `proveedores=3`) en el formulario.
- **La corrección de V-40/V-41, comprobada contra el servidor real:** se pidió el paso 2 de tarifas
  con `conceptos=999&proveedores=999&taxConceptId=00000000-…` en la URL y la pantalla mostró **2 y 3**,
  los de verdad, con el testigo en 2 y 3. Igual en ReteICA (`888` forzado → mostró 1 y 1).
- **La corrección de V-42, comprobada contra el servidor real:** `/parametros` pasó de **984 KB y
  1.122 badges** a **307 KB y 14 badges**, con la línea «y 1.113 más de este mismo tipo» y las cuatro
  alertas accionables otra vez visibles.
- Higiene: la sesión que A14 emitió para la verificación quedó **revocada**, y los scripts temporales,
  borrados.

**Lo que A14 NO da por verificado y queda pendiente para un humano con navegador gráfico:** el
comportamiento **client-side** —abrir el modal del badge y el de «Ver detalle» con el ratón, el foco
atrapado con `Tab`, el cierre con `Escape`, y el aspecto en `data-tema="oscuro"`—. A14 verificó el
HTML que sirve el servidor y el DOM estático del componente, no una sesión de teclado y ratón.

### Verificación final tras las correcciones de A14

`npx tsc --noEmit` limpio · `npx next build` **exit 0** (37 rutas; la advertencia `node:dns` en Edge
Runtime es la de D-080) · `npm test` **1177 en verde, 57 archivos** (base D-087 + A12 = 1133/56;
+44 de la suite nueva de A14). Sin comitear: **A14 no comitea.**

### Archivos que tocó A14 en esta compuerta

Nuevo: `tests/adversarial/a14-d087-ampliada.test.ts`. Tocados: `src/services/parametrizacion.ts`
(`ImpactoNoSimuladoError`, `TestigoImpacto`, `exigirTestigoImpacto`, `taxConceptIdDeTaxRule`),
`src/services/index.ts` (re-exports), `app/parametros/tarifas/[tipo]/{page.tsx,acciones.ts}`,
`app/parametros/valores-base/{page.tsx,acciones.ts}`,
`app/parametros/reteica-municipios/{page.tsx,acciones.ts}`, `app/parametros/_componentes.tsx`
(agrupación del banner, V-42), `tests/adversarial/compuerta-ola2-interfaz.test.ts` (su helper de dos
pasos ahora lleva el testigo, como la pantalla real).

---

## D-088 — Parametrización de ICA por municipio: MODELO DE DATOS (A2, migración 177)

**Alcance de esta entrega: solo esquema.** Motor, interfaz y carga masiva NO se tocan y los entrega
otro agente sobre estas columnas. Sin comitear.

### La decisión de fondo, tomada con el usuario ANTES de escribir nada

**Se EXTIENDE el modelo existente. NO se crean tablas paralelas** (`municipio_ica_parametros`,
`municipio_ica_actividad`) ni un catálogo de actividades propio. El ICA por municipio ya estaba
modelado desde la Ola 0 y duplicarlo habría partido en dos la fuente de verdad de una retención:

- `municipality_ica_rule` (004) — parámetros del municipio **por vigencia**: `practica_reteica`,
  bases mínimas de servicios/compras en UVT o en pesos, `usa_tarifa_de_actividad`, `tarifa_general`,
  `periodicidad`, `regla_desempate_actividad`. Con sus dos triggers de vigencia.
- `tax_rule` con `tipo='reteica'` + `municipality_id` + `ciiu_activity_id` (006) — la **tarifa por
  actividad**, también por vigencia, y con `comparador_base_minima` desde 050.
- `ciiu_activity` (004) — el catálogo de actividades, ya sembrado y en uso por D-084. **No se tocó
  ni se duplicó.**

### Migración `db/migrations/177_a2_d088_ica_municipio_modelo.sql` — qué añade y por qué

| Objeto | Definición exacta | Por qué |
|---|---|---|
| `municipality_ica_rule.tipo_medicion_base_minima` | `text NOT NULL DEFAULT 'por_factura' CHECK (IN ('por_factura','por_periodo'))` | El modelo solo sabía expresar *comparar cada factura contra la base mínima* (patrón renta/IVA). Hay municipios que comparan el **acumulado del tercero en el municipio durante el periodo**. Son dos formas estructuralmente distintas y no caben en un solo campo. `NOT NULL` con default conservador: el estado indeterminado en algo que decide si se retiene es peor que un default explícito, y `'por_factura'` reproduce exactamente el comportamiento previo a D-088 en todas las filas ya cargadas |
| `municipality_ica_rule.periodo_meses` | `smallint CHECK (IS NULL OR BETWEEN 1 AND 12)` + `CONSTRAINT municipality_ica_periodo_medicion_ck CHECK (tipo_medicion_base_minima = 'por_periodo' OR periodo_meses IS NULL)` | Ventana de **acumulación** de la base. **No confundir con `periodicidad`**, que ya existía y es otra cosa: `periodicidad` es cada cuánto **declara y paga** el agente retenedor ante el municipio (obligación formal, ajena al cálculo); `periodo_meses` es la ventana sobre la que se **suma la base** para compararla con la base mínima (entra en el cálculo). Un municipio puede declarar bimestral y acumular anual. La diferencia queda escrita en el `COMMENT` de la columna, no solo aquí. El CHECK cruzado impide la fila que se contradice (ventana de acumulación con medición por factura) y lo impone **la base de datos** |
| `tax_rule.gravada` | `boolean` (nullable) + `CONSTRAINT tax_rule_gravada_ck CHECK (gravada IS NOT FALSE OR tarifa = 0)` | Antes, «esta actividad no está gravada aquí» se representaba por **ausencia de fila**, indistinguible de «todavía no se ha cargado la tarifa» — y las dos exigen respuestas opuestas (§17: el dato faltante debe verse). Tres estados: `NULL` = no aplica / no declarado (**estado de todas las filas anteriores**: la migración no reinterpreta ni una fila cargada), `true` = gravada, `false` = **el motor no retiene, sin importar la tarifa**. Nullable porque solo tiene sentido para `tipo='reteica'` con `ciiu_activity_id`: un `NOT NULL` obligaría a responder «¿gravada?» a una regla de retefuente sobre honorarios. El CHECK impide `gravada=false` con tarifa distinta de cero, para que leer el flag y leer la tarifa no puedan dar resultados opuestos |
| `reteica_periodo_acumulado` (tabla nueva) | `id`, `tenant_id`/`company_id` **NOT NULL**, `third_party_id`, `municipality_id`, `tipo_operacion_ica text CHECK IN ('servicios','compras')`, `periodo_inicio date`, `periodo_fin date`, `base_acumulada_centavos bigint NOT NULL DEFAULT 0 CHECK (>= 0)`, `documentos_contados jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof = 'array')`, `created_at`/`updated_at`. `UNIQUE (company_id, third_party_id, municipality_id, tipo_operacion_ica, periodo_inicio)`, `CHECK (periodo_fin >= periodo_inicio)`, índice `(company_id, third_party_id, municipality_id, periodo_inicio)`, trigger `updated_at`, `GRANT` a `app_user` | El acumulador que necesita la medición por periodo |

### Decisiones de modelado no obvias de la tabla nueva

1. **No es ledger y no le aplica la Regla de Oro 1.** Es **estado derivado y recalculable**: la
   verdad sigue en los documentos y en el ledger, y esta tabla se reconstruye entera desde ellos.
   Por eso **sí admite `UPDATE`** y no se corrige por reversa, se recalcula. `documentos_contados`
   (array de `source_document.id` ya sumados) es lo que hace **idempotente** la acumulación: un
   reproceso del mismo documento no suma dos veces, y el acumulado se puede cotejar contra el ledger.
2. **No es paramétrica y no debe llevar vigencia.** Sin `vigente_desde`, `norma_respaldo` ni
   `clave_vigencia`, y **sin** el trigger de `parametro.editar`: aquí no hay ninguna decisión
   normativa, solo la suma de lo ya ocurrido, y quien escribe es el motor de causación en una
   causación normal, no un administrador tributario abriendo vigencia.
3. **El periodo se materializa como par de fechas, no como «año + número de periodo».** La ventana
   la define `periodo_meses` de la regla del municipio **vigente a la fecha del hecho económico**, y
   esa regla puede cambiar. Guardando las fechas concretas, el acumulado de un periodo pasado sigue
   significando lo mismo aunque el municipio cambie la ventana mañana (Regla de Oro 3).
4. **`tipo_operacion_ica` separa servicios de compras** porque el municipio puede fijar bases mínimas
   distintas para cada uno (`base_minima_servicios_*` / `base_minima_compras_*`); mezclarlas en un
   solo acumulado haría cruzar el umbral antes de tiempo.
5. **Alcance amarrado por FK compuestas, no por trigger, donde se puede**:
   `(company_id, tenant_id) → company` y `(third_party_id, tenant_id, company_id) → third_party`
   (mismo patrón que `source_document`, 008). Para `municipality`, que es catálogo **híbrido**
   (`tenant_id` puede ser NULL), la FK compuesta no es expresable y va el guardia genérico
   `app.instalar_guardia_alcance` de 018. RLS: patrón A de 012
   (`app.instalar_rls_tenant_company`), doble nivel tenant + company.

### Reglas de Oro

- **RO 2 — cero valores tributarios.** La migración no contiene ni una tarifa, base, UVT, tope ni
  calendario, y ningún `INSERT`. Todos los defaults son neutros (`'por_factura'`, `0`, `'[]'`) o
  `NULL`. Qué municipio mide por periodo, con cuántos meses, con qué base y con qué tarifa lo carga
  el contador desde la interfaz, con su norma de respaldo y su vigencia. El detector de
  `tests/adversarial/valores-tributarios.test.ts` barre `db/migrations/` y pasa.
- **RO 1 y 3 — no se toca el ledger ni la resolución por vigencia.** Las dos columnas nuevas de
  `municipality_ica_rule` y la de `tax_rule` **viajan con la fila de vigencia** que las contiene: un
  cambio de medición o de «gravada» abre vigencia nueva por el mismo camino que todo lo demás, y una
  factura vieja se sigue recalculando con la regla que estaba vigente ese día.

### Verificación de A2 (suite desechable, no comiteada)

Siete comprobaciones contra PGlite con las migraciones reales, todas en verde antes de retirar el
archivo: (1) `periodo_meses` con medición por factura → rechazado por la BD con `23514`;
(2) abrir la vigencia nueva con `'por_periodo'` **no altera** la anterior, y una consulta con fecha
pasada resuelve la regla que estaba vigente entonces; (3) `gravada=false` con tarifa positiva →
`23514`, y con tarifa cero entra; (4) el acumulador **no deja ver** una fila de otra firma ni de otra
empresa con RLS activa (`asTenant`, no filtro de aplicación); (5) el acumulador **sí** admite
`UPDATE` (estado derivado); (6) un tercero de otra empresa en el acumulador → `23503` por la FK
compuesta; (7) base acumulada negativa → `23514`. **Estas comprobaciones no quedan como suite
permanente a propósito: la compuerta la escribe A14 con su propio arsenal, sin reutilizar aserciones
de quien construyó el esquema (D-047).**

**Estado del árbol tras 177:** `npx tsc --noEmit` limpio · `npm test` **1177 en verde, 57 archivos**
— exactamente la misma cifra que antes de la migración: **no se rompió ni se modificó ninguna prueba
existente**. La migración **no está aplicada a la Neon**: quien despliegue debe correr `177`.

### D-088 — DATOS PARAMÉTRICOS (A1, 2026-09-03) — Tarea A hecha, Tarea B NO

Alcance de A1: solo filas de tabla. No se tocó motor, interfaz, migraciones ni carga masiva de
código. Sin comitear.

**Tarea A — catálogo maestro CIIU: HECHA.** Seed nuevo
`db/seeds/tanda2/110_ciiu_completo_d088.sql`. Añade **447 clases CIIU de 4 dígitos** (Rev. 4 A.C.
adaptada Colombia) que faltaban; **7 ya estaban** (7490 de la tanda 1; 4711, 7110, 0510, 6411, 5611,
6201 de la tanda 2) y el `NOT EXISTS` por código no las pisa. `ciiu_activity` global pasa de **7 a
454 filas**. *(Cifras corregidas por A14 en la compuerta ampliada: A1 había escrito «446 nuevas, 8 ya
estaban» e incluido `1355` entre los preexistentes, pero `1355` es un **código de cuenta PUC**, no un
CIIU. Ni una fila cambia: solo el conteo del informe, verificado contra la base y contra los tres
seeds.)* Identidad
estable: sin vigencia y sin `norma_respaldo` (la tabla no tiene esas columnas). Idempotente.
`seccion` derivada de la división (2 primeros dígitos) por los rangos oficiales de secciones A–U.

- **Fuente:** los códigos del Excel del usuario (`archivos-masivos/EJEMPLO_D088_parametrizacion_ica.xlsx`,
  551 filas de actividad). De ahí se tomaron **solo los códigos de 4 dígitos**.
- **Descartados:** 99 subclases de **5 dígitos** (código propio del Distrito de Bogotá / DIAN:
  74901, 85591, 10201, 46201…) que no caben en `ciiu_codigo_ck` (`^[0-9]{4}$`) más 1 celda con
  valor corrupto `"85232/8551"`. Van a pendientes de esquema (misma raíz que V-5).
- **Pendiente de verificación humana:** las **descripciones** salen del Excel del usuario y pueden
  estar abreviadas frente al literal oficial DANE. El código y su sección/división sí son
  verificables; el texto de cada descripción no se contrastó contra la publicación oficial CIIU
  Rev. 4 A.C.

**Tarea B — tarifas de ICA de Bogotá por actividad: NO CARGADA. Deliberado.** `municipality_ica_rule`
de Bogotá queda **sin encender ReteICA** y `tax_rule` tipo `reteica` sigue con **1 sola fila**
(Medellín). Motivo: no se pudo verificar el Acuerdo 65 de 2002 de Bogotá (ni sus modificaciones
vigentes: Acuerdos 98/2003, 780/2020) dentro del tiempo de la tarea, y el Excel del usuario **no es
fuente normativa fiable** para esto: sus "tarifas por mil" están dispersas y con ruido evidente
(valores de una sola aparición como 12.14, 8, 10.62; 14 tarifas distintas donde el Acuerdo agrupa
por pocos grupos). Cargar eso sería inventar magnitudes en el motor tributario — peor que el hueco
(§17, Regla de Oro 2). V-5 sigue **abierta** para Bogotá.

**Estado del árbol:** `npx tsc --noEmit` limpio · `npm test` **1177 en verde, 57 archivos** —
misma cifra que tras la 177: el seed nuevo no rompe ni modifica ninguna prueba. Ningún seed aplicado
a la Neon.

### D-088 — MOTOR de causación (A3, 2026-09-03)

**Alcance de esta entrega: solo el motor.** No se tocó ni una migración, ni la interfaz, ni la carga
masiva, ni un seed. Sin comitear. Falta la compuerta de A14.

#### TAREA 1 — `gravada = false` nunca retiene

En `resolverReteica` (`src/domain/motor.ts`), una vez elegida la `tax_rule` de la actividad con
`elegirRegla`, si la regla trae `gravada = false` el motor **no practica ReteICA, sin importar la
tarifa**. No es revisión manual —no hay nada que un humano tenga que decidir: es una decisión
normativa ya tomada por el municipio y cargada como parámetro—, sino una **evaluación registrada**
con `aplicada = false`, `valor = 0` y el motivo en texto, por el mismo canal por el que ya se
explicaba «la base no llegó al mínimo». El contador abre la factura y lee *«La actividad X está
marcada como NO GRAVADA de ICA en el municipio Y por la regla Z, vigente desde …»*, con su norma de
respaldo; la traza conserva regla y vigencia (Regla de Oro 6). `gravada = true` y `gravada = NULL`
—el estado de **todas** las reglas anteriores a D-088— conservan la conducta anterior byte a byte.
El chequeo de coherencia `tarifa_general` vs `tax_rule` se salta cuando la actividad no está gravada,
para que la tarifa cero que obliga el CHECK no dispare un falso `TARIFA_INCONSISTENTE`.

#### TAREA 2 — base mínima medida por periodo

Con `municipality_ica_rule.tipo_medicion_base_minima = 'por_periodo'`, la base mínima ya no se
compara contra la factura sino contra el **acumulado del tercero en ese municipio** dentro de la
ventana. `'por_factura'` (el default y el estado de toda fila existente) no pasa por nada de esto.

**La decisión de arquitectura que evita el acumulador fantasma: el motor NO escribe.** Lo lee,
acumula en memoria (`SesionAcumuladosIca`) y devuelve los efectos en
`ResultadoResolucion.acumuladosIca`. Quien persiste el asiento los aplica con `aplicarAcumuladosIca`
(`src/domain/persistencia.ts`), **en la misma transacción y solo después de que el asiento quedó
escrito** — en `causarFactura`, justo tras el `UPDATE` de `source_document`. Todas las salidas
anteriores (revisión manual, período fiscal cerrado, carrera con otro worker que hace
`ROLLBACK TO SAVEPOINT`) pasan **sin tocar el acumulador**. Si el motor escribiera al calcular, un
documento que acaba en revisión manual dejaría el acumulado por delante del ledger y la **siguiente**
factura cruzaría un umbral que en realidad nadie cruzó. Consecuencia directa: el **dry-run sale
gratis** — una previsualización descarta los efectos, lee el acumulado y no lo mueve. Con prueba.

**Anti doble conteo en dos capas.** En memoria, la sesión no suma la base si el `source_document.id`
ya figura en `documentos_contados`. Y en la base, el `UPSERT` decide con
`documentos_contados @> jsonb_build_array($doc)`: si el documento ya está, ni la base ni la lista se
tocan **por mucho que se ejecute**. La idempotencia no la sostiene la aplicación, la sostiene el
`jsonb`. Es lo que hace que recausar dé el mismo resultado (caso dorado 18) en vez de que el propio
documento se empuje por encima del umbral al reprocesarse.

**Una sesión por factura, no por grupo de concepto.** `resolverFactura` agrupa por concepto y
resuelve cada grupo por separado; si cada grupo leyera el acumulado de la base, dos grupos del mismo
municipio y naturaleza verían ambos el estado antiguo. La sesión es compartida: suman al mismo
acumulado y sale **un solo efecto por ventana**.

#### LAS DOS ASUNCIONES — decisión normativa pendiente de confirmación del cliente final

No son bugs, no son TODO y no se resolvieron en silencio. Están escritas en el comentario de cabecera
de la sección D-088 de `src/domain/motor.ts` y aquí.

1. **Anclaje de la ventana: AÑO CALENDARIO.** El primer periodo del año empieza el **1 de enero del
   año del hecho económico** y los siguientes se encadenan cada `periodo_meses` meses (con
   `periodo_meses = 2`: ene-feb, mar-abr, …). La ventana **nunca cruza el cambio de año**: si
   `periodo_meses` no divide a 12 (5, 7, 8, 9, 10, 11), el último periodo se **recorta al 31 de
   diciembre** en vez de invadir enero. Se eligió el año calendario porque hace la ventana
   reproducible sin depender de cuándo se cargó la parametrización ni de cuándo empezó a operar la
   empresa, que es lo que exige la Regla de Oro 3. **Alternativa no elegida:** anclar a
   `municipality_ica_rule.vigente_desde`, que ataría la ventana a un dato administrativo y la movería
   cada vez que el municipio abre vigencia nueva.
2. **Cruce del umbral a mitad de periodo: SOLO HACIA ADELANTE.** La factura que hace cruzar el
   acumulado retiene sobre **su propia base**, y las siguientes del periodo también; **lo ya causado
   antes del cruce no se ajusta retroactivamente**. Es la lectura conservadora y reversible: si el
   municipio exige el ajuste retroactivo, se corrige por reversa sobre un ledger que no ha inventado
   nada. La contraria obligaría a reescribir asientos ya publicados, que la Regla de Oro 1 prohíbe.

Y una tercera cosa que **no** es asunción sino decisión del motor, por si alguien la lee como bug:
la factura que **no** alcanza el umbral tampoco retiene, **pero sí suma al acumulador** — si no
sumara, el umbral no se cruzaría jamás. En cambio una actividad **no gravada no acumula**: sumar base
que por definición no tributa acercaría al tercero a un umbral que no le corresponde cruzar.

#### Vacíos de parametrización que van a revisión manual (§17.5: lo que falta se ve)

- `MOTIVO.ICA_PERIODO_SIN_VENTANA` — el municipio mide por periodo y su regla vigente no dice de
  cuántos meses es la ventana. El motor no la supone.
- `MOTIVO.ICA_PERIODO_SIN_NATURALEZA` — el acumulado se lleva por separado para servicios y para
  compras y el concepto no dice cuál es. Mezclarlos haría cruzar el umbral antes de tiempo.

#### Archivos tocados

| Archivo | Qué cambió |
|---|---|
| `src/domain/motor.ts` | `ventanaPeriodoIca` (exportada), `SesionAcumuladosIca`, `ClaveAcumuladoIca`, `abrirVentanaIca`; `resolverReteica` resuelve `gravada` y abre la ventana; `liquidar` gana `motivoNoAplicaForzado` y `acumulado`, y compara contra el acumulado cuando toca; `resolverRetenciones` acepta sesión compartida; `resolverFactura` abre una por factura |
| `src/domain/tipos.ts` | `EfectoAcumuladoIca`; `ResultadoResolucion.acumuladosIca`; `sourceDocumentId` en `EntradaResolucion` y `EntradaFactura`; dos `MOTIVO` nuevos |
| `src/domain/repositorio.ts` | `FilaTaxRule.gravada`; `FilaMunicipioIca.tipo_medicion_base_minima` y `.periodo_meses`; `FilaAcumuladoIca`; método **de solo lectura** `acumuladoIca(...)` |
| `src/domain/persistencia.ts` | `aplicarAcumuladosIca` — el `UPSERT` idempotente por `documentos_contados` |
| `src/services/causacion.ts` | pasa `sourceDocumentId` a `resolverFactura` y aplica los efectos **después** de escribir el asiento |
| `src/domain/index.ts` | re-exports |
| `tests/domain/motor-ica-d088.test.ts` | **nuevo**, 16 pruebas |

#### Reglas de Oro

- **RO 2 — cero valores tributarios.** Ni en el motor ni en la suite. La base mínima de Medellín, su
  tarifa general y la UVT del año son las de A1: la prueba las **lee de la base** y calcula los montos
  del escenario como **fracciones del umbral**, así que sigue siendo válida el día que A1 actualice el
  dato. Lo único que la suite escribe son parámetros de **escenario**, marcados como tales en su
  `norma_respaldo` (que Medellín mida por periodo, que la ventana sea de dos meses) y la tarifa cero
  que el propio `tax_rule_gravada_ck` obliga en una actividad no gravada. La tarifa de la actividad
  gravada de ejemplo **se copia con un `SELECT`** de la fila de A1, como ya hacía `_escenario.ts`.
- **RO 1 — ledger inmutable.** El acumulador no es ledger (A2 lo dejó explícito) y es lo único que se
  actualiza; ningún asiento se toca. La asunción «solo hacia adelante» existe justamente para no
  tener que reescribir asientos publicados.
- **RO 3 — vigencia por fecha del hecho.** La ventana se deriva de `periodo_meses` de la regla
  **vigente a la fecha del hecho económico**, y se guarda como par de fechas concretas.
- **RO 4 — la IA no interviene.** Aquí no hay LLM: es aritmética sobre parámetros.
- **RO 5 — el dinero es entero.** Todo el acumulador en `bigint` de centavos, leído como texto y
  convertido con `aEntero`. Ni un `float`.
- **RO 6 — trazabilidad.** La `nota` de la retención dice la ventana usada, el acumulado, cuánto
  venía de antes y si el documento ya estaba contado; el efecto persistido guarda periodo, base
  sumada y acumulado resultante.

#### Las 16 pruebas nuevas (`tests/domain/motor-ica-d088.test.ts`)

Ventana: anclaje al año calendario · año bisiesto resuelto por el calendario, no por una tabla a mano
· mensual y anual como extremos · recorte al 31-dic cuando `periodo_meses` no divide a 12 · ventana
imposible devuelve `null`. Gravada: `false` no retiene aun con base muy superior al umbral · `true`
retiene · `NULL` (la regla que dejó el montaje dorado) no cambia de conducta. Por periodo: tres
facturas y la 2ª cruza (la 1ª sigue en cero y **nadie la ajusta**) · recausar la 2ª **dos veces** no
cuenta doble y la **huella no se mueve** · **cruce del límite de periodo** (31-ago y 1-sep: el
acumulador arranca de cero, no arrastra, y quedan dos filas con sus ventanas) · el acumulado de otro
tercero no empuja el de este · **dry-run** lee y no escribe · sin documento no hay efectos pero el
cálculo es correcto · medición por periodo sin ventana → revisión manual. No regresión: Cali sigue
midiendo por factura y **no abre acumulador**.

#### Estado del árbol

`npx tsc --noEmit` limpio · `npm test` **1193 en verde, 58 archivos** (base antes de esta entrega:
1177 / 57). **+16 pruebas, 0 regresiones, ninguna prueba existente modificada.**

**Los 20 casos dorados, uno por uno** (`tests/golden/casos-dorados.test.ts`, reverificado con
`--reporter=verbose` DESPUÉS del cambio):

| # | Caso | Estado |
|---|---|---|
| 1 | Servicio $1.000.000 + IVA 19%, PJ declarante, Bogotá | ✅ pasa |
| 1b | El ReteICA de Bogotá NO se inventa: A1 no cargó la tarifa por actividad | ✅ pasa |
| 2 | Mismo servicio, PN no declarante: el eje «tercero» opera | ✅ pasa |
| 3 | Servicio de $80.000 bajo la base mínima: no retiene y el motivo queda | ✅ pasa |
| 4 | Compra $500.000 bajo la base mínima de compras: no retiene | ✅ pasa |
| 5 | Compra de bienes $600.000 a declarante | ✅ pasa |
| 6 | Honorarios PJ $200.000: retiene desde el primer peso | ✅ pasa |
| 7 | Arrendamiento de inmueble $400.000 no retiene; de mueble por igual valor sí | ✅ pasa |
| 8 | Servicio en Medellín: tarifa general del municipio y su base mínima | ✅ pasa |
| 9 | Mismo servicio en Cali: la base mínima de servicios es distinta | ✅ pasa |
| 10 | Principal en Bogotá y secundaria en Cali; operación en Cali | ✅ pasa |
| 10b | Varias actividades en el mismo municipio: desempate configurable | ✅ pasa |
| 11 | Vigilancia $5.000.000 con AIU de $500.000: la base es el AIU | ✅ pasa |
| 12 | Proveedor del exterior: ReteIVA al 100% | ✅ pasa |
| 12b | Exterior sin regla de exterior parametrizada: revisión manual | ✅ pasa |
| 13 | Régimen SIMPLE: tratamiento diferenciado según parametrización | ✅ pasa |
| 14 | Factura con 3 líneas de conceptos distintos: retención por concepto, agregada | ✅ pasa |
| 14b | Partir un concepto en dos líneas no esquiva la base mínima | ✅ pasa |
| 15 | Nota crédito: reversa proporcional por documento nuevo, sin mutar el original | ✅ pasa |
| 15b | Una nota crédito por el total reversa exactamente lo retenido | ✅ pasa |
| **16** | **Factura fechada antes del decreto, procesada después: manda la fecha del hecho (vigencia por fecha del hecho)** | ✅ **pasa** |
| **17** | **Cambio de tarifa con vigencia futura: lo publicado no cambia (no retroactividad)** | ✅ **pasa** |
| **18** | **Reprocesar 10 veces la misma factura: resultado idéntico las 10 (determinismo al reprocesar)** | ✅ **pasa** |
| 19 | El motor no llama a ningún LLM: no tiene con qué | ✅ pasa |
| 20 | Usuario del tenant B resolviendo contra el tenant A: cero filas | ✅ pasa |

El 18 queda **reforzado** por D-088: además de las 10 corridas del caso dorado, hay prueba de que
recausar un documento en un municipio que mide por periodo **no lo cuenta dos veces** y la huella no
se mueve.

#### Limitación declarada, no silenciada

**La nota crédito no descuenta del acumulador.** `causarNotaCredito` reversa las retenciones
proporcionalmente pero no resta la base del acumulado del periodo, así que tras una nota crédito el
acumulado queda por encima de la base neta real y el tercero puede cruzar el umbral algo antes. Se
declara en vez de resolverse a ojo porque la respuesta correcta depende de la asunción 2: si el
municipio manda «solo hacia adelante», restar hacia atrás sería incoherente con ella. Va con la
confirmación normativa del cliente final. La tabla es **estado derivado y recalculable**, así que
corregirlo después no exige tocar ledger.

### D-088 — INTERFAZ, CARGA MASIVA y PERMISOS (A8, 2026-09-03)

**Alcance de esta entrega: TAREAS 3, 4 y 5.** No se tocó el motor (`src/domain/*`) ni las migraciones
de esquema ya hechas (177). Sin comitear. Falta la compuerta de A14 y la verificación en navegador.

#### TAREA 5 — permiso propio del submódulo · migración **178**

`db/migrations/178_a8_d088_permisos_ica.sql`, misma mecánica que la 176 de D-087:

- Dos códigos nuevos en `permission`, `modulo = 'parametrizacion'`: `parametro.ica.leer` (`ver`) y
  `parametro.ica.editar` (`editar`).
- `INSERT ... SELECT` en `role_permission`: quien tiene `parametro.editar` recibe `parametro.ica.editar`
  y quien tiene `parametro.leer` recibe `parametro.ica.leer`. Nunca un `UPDATE`. `admin_firma` los
  recibe y la invariante «lo tiene todo» se mantiene.
- Espejo en `src/auth/permisos.ts` (`PARAMETRO_ICA_LEER` / `PARAMETRO_ICA_EDITAR`) y en el registro
  `SubmoduloParametro` de `parametrizacion.ts` (`'ica'` → fino `parametro.ica.editar`, **motor**
  `parametro.editar`). El fino restringe la interfaz; el candado real de escritura sobre
  `municipality_ica_rule` y `tax_rule` sigue siendo `parametro.editar` (trigger de 016), no se
  retargetea nada.
- **Nivel firma**, no empresa: dato compartido entre empresas-cliente (igual que el catálogo DANE de
  D-086). La escritura crea filas con `company_id NULL` salvo que el contador pida override de una
  empresa. Verificado con A2: la RLS híbrida ya deja a un administrador de firma escribir
  `company_id NULL` desde una sesión con o sin empresa seleccionada — sin cambios de A2 (mismo
  fundamento que el comentario de cabecera de `parametrizacion.ts`).
- Pruebas de compuerta ajustadas al alza (8 → 10 códigos `parametro.%.%`): `a12-d087-permisos.test.ts`
  y `a14-d087-ampliada.test.ts`. La gate `seguridad.test.ts` (PERMISOS espejo == catálogo) pasa.

#### TAREA 3 — pantalla `/parametros/ica-municipios`

`app/parametros/ica-municipios/{page.tsx,acciones.ts,_carga-masiva.tsx}`. Sigue el patrón de
`reteica-municipios` y `tarifas/[tipo]`: selector de municipio (DANE), y **tres** bloques editables,
cada uno con el **simulador de impacto bloqueante de D-087 reutilizado** (dos pasos
`simular*` → `confirmar*`, testigo `exigirTestigoImpacto` de V-39, botón «Ver detalle» con
`app.detalle_impacto_*`):

1. **Regla del municipio** — bases mínimas compras/servicios (UVT), `tipo_medicion_base_minima`
   (`por_factura` / `por_periodo`), `periodo_meses` (condicional, 1–12), periodicidad de declaración.
   Impacto por `simularImpactoMunicipioIca` + `detalleImpactoMunicipioIca`.
2. **Tabla de actividades gravadas** — `tax_rule` tipo `reteica` con `ciiu_activity_id` del municipio,
   buscable por código/descripción (`?q=`), editable fila por fila. Impacto por `simularImpactoTarifa`
   sobre el concepto de ReteICA.
3. **Alta de actividad nueva** por código CIIU.

**Guard gravada/tarifa en la UI y en la capa de servicio.** Si se marca «No gravada», el formulario
guarda `tarifa = 0` y la acción lo fuerza; `editarTarifaTaxRule` y `crearOReemplazarTaxRule` rechazan
`gravada = false` con tarifa ≠ 0 con `VigenciaInvalidaError` **antes** del viaje a la base — el CHECK
`tax_rule_gravada_ck` (177) sigue siendo la garantía real.

Servicios extendidos (capa de servicios, no motor):
`parametrizacion.ts` — `EditarMunicipioIcaInput` gana `tipoMedicionBaseMinima` / `periodoMeses` (con
validación cruzada), `editarMunicipioIcaRule` los inserta; `FilaMunicipioIca` gana `codigoDane`,
`tipoMedicionBaseMinima`, `periodoMeses`; `FilaTarifa` / `EditarTarifaInput` / `FilaTaxRuleAnterior`
ganan `gravada` y `editarTarifaTaxRule` lo propaga (hereda el de la fila anterior si no se pasa).
`catalogos.ts` — `AltaTaxRuleInput.gravada`, propagado en las dos ramas de `crearOReemplazarTaxRule`;
`AltaMunicipioIcaInput` ya reenvía los dos campos nuevos vía `...input`.

Nav: enlace en `app/parametros/page.tsx` y etiqueta `ica-municipios` en `AppShell.tsx`.

#### TAREA 4 — carga masiva de un municipio completo

`src/services/carga-masiva/ica-municipio.ts` (parser bespoke con `exceljs` + importador + plantilla),
**no** una entrada de `definiciones.ts` (el layout del cliente no es de columnas planas). Acción
`cargarIcaMunicipioAction` en `acciones.ts`, UI en `_carga-masiva.tsx` (`useActionState`, informe de
filas con error). Plantilla descargable en `GET /api/plantillas/ica_municipio_d088`.

- Layout: bloque de encabezado por **etiqueta** (tolerante a la posición) — «Municipio» (código DANE
  de 5 dígitos **o** nombre), base mínima compra/servicio UVT, «Tipo de medición» → `por_factura` /
  `por_periodo`, «Periodo en meses». Tabla de actividades: fila de encabezados detectada por traer
  «Código» y «Gravada»; columnas Código / Descripción / Tarifa por mil / Gravada.
- **Zero-pad a 4 dígitos** antes de resolver contra `ciiu_activity`. Código de **5 dígitos**
  (subclases del Distrito), corrupto o inexistente → **fila con error en el informe**, NO se inserta,
  NO se inventa; **las buenas sí se cargan** (a diferencia del todo-o-nada de `importar.ts`: el
  archivo real trae ~100 subclases que el cliente no puede quitar). Un fallo inesperado en un INSERT
  sí deshace todo (ROLLBACK de `conSesion`).
- «Gravada = N» → `gravada = false`, `tarifa = 0` (aunque la celda de tarifa venga vacía).
  9,66 «por mil» → fracción `0.009660`.
- **La fecha de vigencia, la norma de respaldo y la periodicidad NO van en el archivo** (no están en
  el layout del cliente): las escribe el contador en el formulario, una vez para todo el municipio
  (§6.2). Sin ellas no se carga nada.
- Encabezado → `crearOReemplazarMunicipioIca`; cada actividad → `crearOReemplazarTaxRule`
  (tipo `reteica`, concepto global `reteica_tarifa_general_municipio` del seed 100 — el motor resuelve
  por municipio + CIIU y trata el concepto como opcional). Audita con `app.registrar_carga_masiva`.

#### Parámetros ya editables desde la interfaz tras D-088

| Parámetro de ICA por municipio | Antes de D-088 | Ahora |
|---|---|---|
| Bases mínimas compras/servicios (UVT o pesos) | `/parametros/reteica-municipios` | **también** `/parametros/ica-municipios` (por UVT) |
| `tipo_medicion_base_minima` (`por_factura` / `por_periodo`) | — (columna nueva de 177) | **`/parametros/ica-municipios`** + carga masiva |
| `periodo_meses` (ventana de acumulación) | — | **`/parametros/ica-municipios`** + carga masiva |
| Tarifa de ICA por actividad (`tax_rule` reteica × municipio × CIIU) | `/parametros/tarifas/reteica` (sin filtro de municipio) | **`/parametros/ica-municipios`** (tabla por municipio, buscable) + carga masiva |
| Flag `gravada` de la actividad | — (columna nueva de 177) | **`/parametros/ica-municipios`** (con guard) + carga masiva |
| Periodicidad de declaración | `/parametros/reteica-municipios` | **también** `/parametros/ica-municipios` |
| `usa_tarifa_de_actividad`, `tarifa_general` | `/parametros/reteica-municipios` | sin cambio (la pantalla de ICA asume tarifa por actividad) |

**Falta** (fuera del alcance de D-088, deuda declarada): editar `reteica_periodo_acumulado` no aplica
(estado derivado, lo escribe el motor); descontar la nota crédito del acumulador (declarado por A3);
V-5 de Bogotá (A1 no cargó la tarifa por actividad — se puede cargar ya con la nueva carga masiva
cuando se verifique el Acuerdo).

#### Estado del árbol

`npx tsc --noEmit` limpio · `npx next build` OK (solo la advertencia preexistente de `node:dns` en
Edge, D-080) · `npm test` **1198 en verde, 60 archivos** (base D-088/A3 = 1193/58; **+5 pruebas en 2
archivos nuevos**: `tests/services/carga-masiva-ica-d088.test.ts` — carga buena + informe de 5
dígitos + `por_periodo`; `tests/services/parametrizacion-gravada-d088.test.ts` — guard gravada/tarifa
en servicio y CHECK de la base). Ninguna migración/seed aplicado a la Neon: quien despliegue corre
`177` y `178`. Sin comitear.

---

## Compuerta AMPLIADA de D-088 — veredicto de A14 (2026-09-03): **PASA con correcciones, hechas por A14 en la misma pasada**

Nada se dio por bueno por reporte ajeno. A2, A1, A3 y A8 reportaron su propio trabajo; aquí se volvió
a medir desde cero, con **arsenal propio** y sin reutilizar una sola aserción de quien construyó
(D-047). Donde ellos midieron una vía, se midieron todas.

**Tres archivos de prueba nuevos, 44 pruebas:**

| Archivo | Qué ataca | Pruebas |
|---|---|---|
| `tests/adversarial/a14-d088-ampliada.test.ts` | `gravada=false` por las tres capas · acumulador por periodo · RLS · catálogo CIIU · Reglas de Oro 1/3/5 · permisos | 26 |
| `tests/adversarial/a14-d088-carga-masiva.test.ts` | el **archivo real del cliente** (551 filas) y los archivos que un cliente descuidado enviaría · la plantilla descargable | 13 |
| `tests/adversarial/a14-d088-flujo-bloqueante.test.ts` | el simulador de impacto de D-087 en las **dos** acciones de confirmación de la pantalla de ICA (V-39 revisitada) | 5 |

### Punto por punto del encargo

| # | Lo que había que verificar | Veredicto |
|---|---|---|
| 1 | **`gravada = false` nunca retiene, por ninguna vía** | **PASA.** La BD rechaza el `INSERT` de una regla no gravada con tarifa > 0 (`23514`); ponerle tarifa por `UPDATE` **muere antes**, en el trigger de vigencia append-only (`PR001`), y desgravar una regla que ya tiene tarifa, también; el motor **no retiene aunque el tercero traiga `tarifa_ica_override`** —la única vía por la que una tarifa entra al cálculo sin pasar por `tax_rule.tarifa`— con base **100× el umbral**, y deja la evaluación con `aplicada=false`, `valor=0`, el motivo en texto y la regla y su vigencia en la traza (RO 6). `gravada = true` da **exactamente el mismo valor, base y tarifa** que `gravada = NULL` (medido con dos reglas gemelas de idéntica tarifa, no con un UPDATE que la base prohíbe). Una actividad no gravada **no suma al acumulador**. El guard de servicio tenía un hueco: **V-43**, corregido |
| 2 | **El acumulador no cuenta doble ni pierde el corte de periodo** | **PASA.** Cruce del límite medido con factura del 31-ago y del 1-sep: quedan **dos ventanas** (`2026-07-01..08-31` y `2026-09-01..10-31`), cada una con **su** base y ninguna retiene — si arrastrara, la segunda cruzaría. Recausar el mismo documento **10 veces** da resultado idéntico las 10 y deja **una sola fila con un solo id** en `documentos_contados` (lo sostiene el `@>` jsonb, no la aplicación: aplicar los mismos efectos desde **tres transacciones distintas** tampoco suma). `ROLLBACK TO SAVEPOINT` devuelve el acumulador al estado previo, byte a byte. **Diez dry-runs** leen el acumulado (la nota dice «POR PERIODO») y **no escriben ni una fila**. El acumulado de otro tercero no empuja a este |
| 3 | **El catálogo maestro CIIU no quedó duplicado** | **PASA.** Cero códigos duplicados en el catálogo global; 454 filas, **todas** de cuatro dígitos; el seed 110 no tiene un solo `UPDATE` ni `DELETE` y usa `NOT EXISTS`. La prueba **lee los tres seeds**, cruza los códigos que aparecen en el 110 **y** en uno anterior, y exige que el nombre en la base sea el del seed **anterior** — así demuestra que no los pisó, no que no colisionaron. **Corrección de documentación**: la ficha de A1 decía «8 ya estaban (…, 1355)»; `1355` es un **código de cuenta PUC**, no un CIIU. Los que ya estaban eran **7** (7490 de la tanda 1; 4711, 7110, 0510, 6411, 5611, 6201 de la tanda 2) y el 110 añadió **447**, no 446. No cambia ni una fila: solo el conteo del informe |
| 4 | **Aislamiento entre firmas** | **PASA.** Desde una firma ajena, `reteica_periodo_acumulado` devuelve **cero filas**; desde una empresa **hermana de la misma firma**, también cero (los dos niveles de la política). Un acumulado de una empresa apuntando al tercero de otra muere en la **FK compuesta** (`23503`), no en un `WHERE` (RO 7). Las filas nuevas de `municipality_ica_rule` (`por_periodo`) y de `tax_rule` (`gravada IS NOT NULL`) no se ven desde otra firma. El catálogo **compartido** (CIIU de `tenant_id NULL`) **sí** se ve desde cualquier firma —400+ filas— y **no** se puede escribir en el catálogo de otra firma. `parametro.ica.leer`/`editar` existen, están en `modulo='parametrizacion'`, coinciden con el espejo `PERMISOS`, se conceden por **rol** (`role_permission` no tiene `company_id`: es nivel firma) y la 178 no relaja el candado: **todo** rol con `parametro.editar` tiene el fino, y **ninguno** tiene el fino sin el grueso |
| 5 | **Consistencia con el modal/simulador de D-087** | **PASA.** Es el bloqueante real, no una copia decorativa: **POST directo** a `confirmarBaseAction` y a `confirmarActividadAction` → **cero filas nuevas** y error en la redirección; **testigo falseado** (`conceptos=999`) → tampoco escribe; flujo completo → sí escribe. Se comprobó que dispara ante **todo** lo editable: base mínima de compras, base mínima de servicios, `tipo_medicion_base_minima` con su `periodo_meses` (abre **vigencia nueva** y deja la anterior **cerrada** al 2027-05-31, no la reescribe), la tarifa por actividad (9,66 «por mil» → `0.009660`) y el flag `gravada` (marcar «no gravada» fuerza la tarifa a **cero** aunque el formulario traiga 9,66, y también exige el testigo). **Deuda declarada, no defecto**: la **carga masiva** no pasa por el simulador — igual que toda la carga masiva anterior del repo (`/carga-masiva`); V-39 se aplicó a las acciones de edición campo a campo, y aquí se mantiene el mismo criterio |
| 6 | **Reglas de Oro** | **PASA.** *RO 2*: barrido propio sobre las migraciones 177 y 178, el seed 110 y **todo** el código nuevo de D-088 → cero valores tributarios; los únicos números en `ventanaPeriodoIca` son aritmética de calendario (meses del año, índices) y la única división por 1000 es la conversión de unidad «por mil → fracción», que es lógica de resolución, no valor. La suite adversarial de RO 2 (42 pruebas) sigue verde. **Se encontró y corrigió V-45**: la plantilla descargable **sí** llevaba valores tributarios en el código. *RO 1/3*: `reteica_periodo_acumulado` no tiene `journal_entry_id`, ni `vigente_desde`, ni `norma_respaldo`, y ninguna FK del ledger lo referencia — es estado derivado, no se usa como fuente de verdad contable; un asiento desbalanceado **sigue muriendo en la base** con D-088 aplicado; y cambiar `tipo_medicion_base_minima` por vigencia nueva hace que una fecha de 2026 siga midiendo **por periodo** y una de 2027 **por factura**, sin tocar el pasado. *RO 4*: en el cálculo del acumulador no hay LLM, es aritmética sobre parámetros. *RO 5*: la **única** columna numérica de la tabla es `base_acumulada_centavos` y es `bigint`; ni un float. *RO 7*: arriba |
| 7 | **Los 20 casos dorados** | **PASA.** Reejecutados uno por uno con `--reporter=verbose` DESPUÉS de todos los cambios: 25/25 aserciones de `casos-dorados.test.ts` (20 casos + 5 sub-casos) y 8/8 de `caso19-memoria.test.ts`. Tabla completa abajo |
| 8 | **Carga masiva con el archivo real** | **PASA con tres correcciones.** Contra `EJEMPLO_D088_parametrizacion_ica.xlsx`: **551 filas leídas, 451 insertadas, 100 informadas** (99 subclases de 5 dígitos + la celda corrupta `85232/8551`, que se informa **por lo que es**), sin colisiones de zero-pad, las 65 no gravadas con tarifa **cero** y todas las gravadas con tarifa positiva; el «por mil» se cotejó **celda a celda** contra el Excel para más de 300 códigos. **Hallazgo importante**: tal cual viene, el archivo **no carga nada** — la celda «Municipio» dice `Bogotá` y el catálogo DANE dice `Bogotá, D.C.` — y el mensaje dice qué hacer (escribir el DANE de 5 dígitos). Es la conducta correcta (§17: el municipio no se adivina) y de paso protege **V-5**. Y se encontraron **V-44** y **V-46**, corregidos |

### Los 20 casos dorados, uno por uno (reejecutados por A14 tras D-088 y tras sus propias correcciones)

| # | Caso | Estado |
|---|---|---|
| 1 | Servicio $1.000.000 + IVA 19%, PJ declarante, Bogotá | ✅ pasa (la pata de ReteICA de Bogotá sigue sin tarifa por actividad — **V-5**, abierta y declarada) |
| 1b | El ReteICA de Bogotá NO se inventa | ✅ pasa |
| 2 | Mismo servicio, PN no declarante: el eje «tercero» opera | ✅ pasa |
| 3 | Servicio bajo la base mínima: no retiene y el motivo queda | ✅ pasa |
| 4 | Compra bajo la base mínima de compras: no retiene | ✅ pasa |
| 5 | Compra de bienes $600.000 a declarante | ✅ pasa |
| 6 | Honorarios PJ: retiene desde el primer peso | ✅ pasa |
| 7 | Arrendamiento de inmueble no retiene; de mueble por igual valor sí | ✅ pasa |
| 8 | Servicio en Medellín: tarifa general y base mínima del municipio | ✅ pasa |
| 9 | Mismo servicio en Cali: base mínima de servicios distinta | ✅ pasa |
| 10 | Principal en Bogotá y secundaria en Cali; operación en Cali | ✅ pasa |
| 10b | Varias actividades en el mismo municipio: desempate configurable | ✅ pasa |
| 11 | Vigilancia con AIU: la base es el AIU | ✅ pasa |
| 12 | Proveedor del exterior: ReteIVA al 100% | ✅ pasa |
| 12b | Exterior sin regla parametrizada: revisión manual | ✅ pasa |
| 13 | Régimen SIMPLE: tratamiento diferenciado según parametrización | ✅ pasa |
| 14 | Tres líneas de conceptos distintos: retención por concepto, agregada | ✅ pasa |
| 14b | Partir un concepto en dos líneas no esquiva la base mínima | ✅ pasa |
| 15 | Nota crédito: reversa proporcional por documento nuevo, sin mutar el original | ✅ pasa |
| 15b | Nota crédito por el total reversa exactamente lo retenido | ✅ pasa |
| 16 | Factura de junio procesada en julio: manda la fecha del hecho | ✅ pasa |
| 17 | Cambio de tarifa con vigencia futura: lo publicado no cambia | ✅ pasa. **Reforzado por A14 en D-088**: cambiar `tipo_medicion_base_minima` con vigencia nueva tampoco altera el pasado |
| 18 | Reprocesar 10 veces la misma factura: asiento idéntico las 10 | ✅ pasa. **Reforzado por A14**: recausar 10 veces en un municipio que mide por periodo da resultado idéntico las 10 y **no mueve el acumulador ni la huella** |
| 19 | Segunda factura del mismo proveedor con la misma descripción: **cero llamadas al LLM** | ✅ pasa (8/8 de `caso19-memoria.test.ts`, incluido «el ahorro no depende de que las dos facturas se escriban igual» y «con otro proveedor la memoria no se contagia») |
| 20 | Usuario del tenant B consulta datos del tenant A: cero filas, en la BD | ✅ pasa. **Reforzado por A14 en D-088**: el acumulador de ICA es invisible desde otra firma **y** desde otra empresa de la misma firma |

### Lo que A14 NO corrige y deja declarado

- **V-5 (Bogotá sin tarifas de ICA por actividad)** sigue abierta. Es de **A1** y depende de verificar
  el Acuerdo 65 de 2002 contra la norma real. La carga masiva de D-088 ya sirve para cargarla el día
  que se verifique, y hoy protege el hueco: el archivo del cliente no carga nada por sí solo.
- **Las 99 subclases CIIU de 5 dígitos** siguen fuera. Es **decisión de esquema**, de **A2** con
  **A1**: `ciiu_codigo_ck` exige 4 dígitos y esas subclases son código municipal del Distrito.
- **Las dos asunciones normativas de A3** (anclaje de la ventana al año calendario; cruce del umbral
  «solo hacia adelante», con la nota crédito que no descuenta del acumulador) siguen **pendientes de
  confirmación del cliente final**. A14 verificó que el motor hace **exactamente** lo que declara —no
  que sea lo que manda el acuerdo municipal, que nadie ha verificado— y que cambiarlo después no
  exige tocar el ledger.
- **La carga masiva no pasa por el simulador de impacto.** Deuda declarada, coherente con toda la
  carga masiva anterior del repo. Le corresponde a **A8** si se decide extender V-39 a ese camino.

### Estado del árbol tras la compuerta

`npx tsc --noEmit` limpio · `npx next build` OK (solo la advertencia preexistente de `node:dns` en
Edge, D-080; `/parametros/ica-municipios` compila) · `npm test` **1242 en verde, 63 archivos** (base
D-088/A8 = 1198/60; **+44 pruebas en 3 archivos nuevos, 0 regresiones**, ninguna prueba ajena
modificada). Las migraciones **177** y **178** y el seed **110** siguen **sin aplicar a la Neon**.
**Sin comitear.** La verificación en navegador real es un paso aparte, del usuario.

---

## Compuerta AMPLIADA de D-089 — veredicto de A14 (2026-09-04): **PASA con correcciones, hechas por A14 en la misma pasada**

Nada se dio por bueno por reporte ajeno. A2, A8, A9, A3 y A1 reportaron su propio trabajo; aquí se
volvió a medir desde cero, con **arsenal propio**, atacando la base **por SQL directo desde una sesión
de negocio real** (`app_user`, RLS activa, token presentado) y saltándose la interfaz y los servicios,
que es el único sitio donde un PASS significa algo (D-004).

**Lo primero que se cayó fue el estado del árbol que traía el encargo.** El encargo afirmaba «`npx
vitest run` 1293/1293 verde». A14 corrió la suite completa antes de tocar nada y salió **1292/1293:
`tests/services/puc-d089.test.ts` falló** con `duplicate key value violates unique constraint
"account_codigo_uq"`. No era una regresión: es que el archivo (y su gemelo `tests/gates/
puc-d089-integridad.test.ts`) sorteaba el código de cuenta con `5195${Math.random()*90+10}` —**90
valores** para la decena larga de cuentas que crea— y por la paradoja del cumpleaños choca en una
fracción alta de las ejecuciones. Una prueba de integridad que falla al azar se acaba silenciando.
**Corregido por A14**: contador, no sorteo, en los dos archivos.

**Dos archivos de prueba nuevos, 51 pruebas, más una en `valores-tributarios`:**

| Archivo | Qué ataca | Pruebas |
|---|---|---|
| `tests/adversarial/a14-d089-ampliada.test.ts` | bloqueo real del ledger e inserción directa · puerta de la reversa y sus abusos · catálogo base global inmutable · aislamiento de cuentas propias · `app.cuenta_uso` como posible canal de fuga · PU001..PU005 por SQL crudo · **barrido V-47 de las 18 tablas de catálogo híbrido** | 34 |
| `tests/adversarial/a14-d089-catalogo.test.ts` | integridad interna del PUC cargado por A1 (huérfanos, jerarquía, contra-cuentas, agrupadoras imputables, idempotencia) · coherencia de `2365` entre seed y migración 180 · **la 180 corrida contra una base YA SEMBRADA**, que es el caso de la Neon y el único donde su bloque A hace algo · Reglas de Oro 3/5/6 | 17 |

### Punto por punto del encargo

| # | Lo que había que verificar | Veredicto |
|---|---|---|
| 1 | **Ningún asiento usa una cuenta agrupadora — bloqueo REAL en el motor** | **PASA.** Con `INSERT` crudo de `journal_line`, saltándose la UI y el servicio: contra una cuenta con `permite_movimiento = false` muere con **`LG004` en el BORRADOR**, no al publicar; contra una `activo = false`, con **`LG009`**; y un `UPDATE` que reapunta una partida de borrador a una agrupadora, también con `LG004`. **El camino de la publicación queda cerrado por el otro extremo y se comprobó**: la única forma que quedaba era imputar cuando la cuenta era hoja y degradarla después, y eso lo rechaza `PU003`. **La puerta de la reversa no se puede abusar**: una reversa **sí** reproduce una cuenta inactivada después (RO 1 — un error del pasado no puede quedar incorregible) pero **no** puede colar una agrupadora que el asiento original no tenía (`LG004`); y el intento de usar el histórico de **otra empresa** como llave muere un paso antes, en la FK compuesta `journal_entry_reversa_fk` (`23503`), porque un asiento de A no puede declararse reversa de uno de B |
| 2 | **La personalización por empresa no edita el catálogo base** | **NO PASABA. Agujero real encontrado y corregido: V-47.** Renombrar la fila global ya moría, pero **`DELETE FROM account WHERE tenant_id IS NULL` PROSPERABA**: medido, el catálogo base quedó en **cero filas** desde la sesión de una firma cualquiera —con el PUC de D-089 eso son **2.506 cuentas que desaparecen para todas las firmas de la plataforma**—, y `UPDATE account SET tenant_id = <el mío>` también prosperaba: una firma se **apropiaba** de una fila del catálogo compartido. La causa es la política RLS híbrida de la Ola 0 (012): su `USING` incluye las filas globales para poder **leerlas**, y un `DELETE` no tiene `WITH CHECK` que lo detenga. **Corregido por A14** (migración **181**, `CT001`). Tras la corrección: `guardarCuenta` con el código de una cuenta global crea la **propia** y deja la global intacta; `ocultarCuentaGenerica` tampoco la toca; crear una cuenta con el `tenant_id` de otra firma o con `tenant_id NULL` sigue muriendo con `42501` |
| 3 | **Aislamiento RLS de las cuentas personalizadas** | **PASA.** La empresa B no ve la cuenta propia de A (cero filas) y su `UPDATE`/`DELETE` no alcanza ninguna. El reverse-lookup `conceptosQueUsanCuenta`/`conceptosQueUsanCuentas` devuelve **el concepto desde A y nada desde B**: el nombre de un concepto de otra firma no sale. Sobre el `SECURITY DEFINER` de `app.cuenta_uso`: se atacó desde la firma ajena y **devuelve exactamente cinco columnas, todas numéricas** — ni un nombre, ni un código, ni un monto: con una partida de $12.345 en la cuenta, ninguna columna vale 1234500, solo el **conteo**. Con un uuid inventado devuelve todo a cero y no lanza: tampoco es oráculo de existencia. El `SECURITY DEFINER` es correcto y está declarado en el inventario de `evasion.test.ts` y `compuerta-ola1.test.ts` |
| 4 | **PU001..PU005 igual que Terceros (D-084/TP001)** | **PASA**, todo por inserción directa. `PU001`: no se borra una cuenta con partidas —**ni desde el superusuario**, porque el guardia está en la base— ni una con hijas. `PU002`: una cuenta con movimientos no cambia de naturaleza. `PU004`: no se renumera. `PU005`: con un `concepto_causacion` activo apuntándola no se inactiva **ni** se desimputa. Inactivar **sí** se permite con movimientos y sin conceptos (es el camino previsto), y reguardar la misma fila con los mismos valores no dispara nada |
| 5 | **Las 7 Reglas de Oro sobre el código nuevo** | **PASA.** *RO 1*: arriba. *RO 2*: el barrido de `valores-tributarios` (que cubre `src`, `app` y `db/migrations`) sigue verde sobre las migraciones 179, 180 y 181, y sobre `puc-efectivo.ts`, `puc.ts` y la plantilla de carga masiva de `account` —cuyos únicos números son códigos PUC, que no son valores tributarios—. **Pero el barrido tenía un agujero (V-48) y la plantilla de ICA un valor tributario quemado (V-49)**, ambos corregidos abajo. *RO 3 y RO 6*: la 180 se corrió contra una base **ya sembrada** fabricada a mano; cierra la vigencia vieja, abre la gemela **idéntica en tarifa, base mínima, comparador, discriminadores, norma y bandera de verificación humana** y solo distinta en la cuenta, sin hueco ni solape (el cierre y la apertura son días contiguos), la nota de la nueva **dice por qué se abrió** y un hecho económico de 2025 se sigue resolviendo contra la vigencia vieja, que sigue acreditando `2365`; y `2365` **no** se desimputa mientras una vigencia —aunque esté cerrada— la cite, que es lo que evita que reprocesar esa factura vieja muera con `LG004` por un cambio posterior al hecho. Correrla dos veces no abre una tercera vigencia. En base limpia es un no-op comprobado (cero vigencias de retefuente cerradas). *RO 4*: D-089 no toca el LLM; el motor sigue decidiendo, y su novedad (`regla_con_cuenta_no_imputable`) es un rechazo, no un cálculo. *RO 5*: ni una columna `real`/`double precision` en todo el esquema; `journal_line.monto` sigue siendo `bigint`. *RO 7*: V-47 |
| 6 | **Catálogo del PUC (A1)** | **PASA**, con dos correcciones de cifra. **Cero huérfanos** y, además, el padre de cada cuenta **es su prefijo** y es de nivel exactamente uno menos y del mismo alcance. Ninguna clase ni grupo admite imputación. Las contra-cuentas `(DB)`/`(CR)` invierten **todas** la naturaleza de su padre, y las acumuladas/provisiones de clase 1 son crédito. El seed es idempotente **medido por huella**: reaplicarlo no cambia el conteo ni el `md5` de `(código, naturaleza, imputable, activo)` de las 2.506 filas; y no tiene un solo `UPDATE`, `DELETE`, `TRUNCATE` ni `DO $$`. **`2365` quedó consistente**: agrupadora, con subcuentas imputables, y **cero** vigencias de `tax_rule` apuntándole en una base nueva. **Corrección de cifra**: las cuentas que a la vez agrupan y admiten imputación no son «~40» como dice la ficha de A1, son **52**, todas de nivel 3; quedan clavadas en una lista cerrada, y si aparece una cincuenta y tres la prueba lo dice. Y **el invariante que D-089 existe para imponer se comprobó de frente**: **ninguna** `tax_rule` y **ninguna** cuenta de un `concepto_causacion` activo apuntan a algo que el trigger de la 179 vaya a rechazar |
| 7 | **Los 20 casos dorados, uno por uno** | **PASA. D-089 no movió ni un centavo.** Reejecutados los 59 casos y sub-casos de `tests/golden/casos-dorados.test.ts` (25), `tests/golden/caso19-memoria.test.ts` (8) y `tests/adversarial/casos-dorados.test.ts` (26). Se revisó el **diff** de las pruebas para descartar que el PASS venga de aflojar una aserción: **ni un solo valor esperado en pesos cambió**; lo único que cambió es el `account_id` del crédito de retefuente (`2365` → `236x`) y, en el caso 14, la aserción se volvió **más exigente** (antes «las tres retenciones caen en la misma cuenta»; ahora «caen en tres subcuentas distintas», con la misma suma de $77.000). Tabla completa abajo |
| +1 | **¿`db/seeds/_fuentes/*.txt` rompe el barrido «db/seeds es dato .sql»?** | **La exclusión de A1 era incorrecta: V-48, corregida.** A1 excluyó el **directorio entero**, y `src/db/seed.ts` recorre **todos** los subdirectorios de `db/seeds/` y aplica **cualquier** `.sql` que encuentre, `_fuentes/` incluido: un archivo puesto ahí se habría ejecutado contra la base sin pasar por ninguna de las cuatro comprobaciones —ni «ningún seed hace UPDATE/DELETE», ni «ningún seed define lógica», ni «toda fila normativa declara su norma». **Corregido por A14**: la excepción se acota a lo que la justifica (en `_fuentes/` se toleran los archivos que **no** son `.sql`) y se añadió una prueba que exige que **lo que el cargador aplica sea exactamente lo que el barrido audita** |
| +2 | **Entregables de A8 y A9** | **PASA.** El simulador de impacto de A8 predice `PU002..PU005` con el mismo criterio del trigger y sus 8 pruebas siguen verdes tras las correcciones; la exportación de A9 (`/api/parametros/puc/exportar`) mantiene la seguridad de `/api/terceros/exportar` y sus 5 pruebas —incluidas la de aislamiento A↔B y la de 403 sin `parametro.puc.leer`— siguen verdes |

### Vulnerabilidades encontradas en esta compuerta

| Id | Qué es | Gravedad | Estado |
|---|---|---|---|
| **V-47** | **Cualquier firma podía BORRAR el catálogo global y APROPIARSE de sus filas.** Medido con SQL directo desde una sesión de negocio real: `DELETE FROM account WHERE tenant_id IS NULL` dejó el catálogo base en **cero filas**, y `UPDATE account SET tenant_id = <el mío>` movió una fila compartida al patrimonio de una firma. La causa es la política RLS híbrida de la Ola 0: su `USING` incluye las filas globales para poder **leerlas**, y un `DELETE` no tiene `WITH CHECK`. **No era solo `account`**: se probó el barrido y el mismo camino borraba el valor global de la **UVT** (con la UVT borrada el motor deja de calcular para toda la plataforma), un **municipio** o una **actividad CIIU** del catálogo nacional, una vigencia global de `tax_rule` **todavía no vigente** (`PR003` solo cubre las que ya rigen) y los **permisos de un rol del sistema** por `role_permission` | **Alta.** Escritura destructiva entre firmas sobre datos compartidos: violación directa de la Regla de Oro 7 y, por la puerta de atrás, de la 3 (si una vigencia global se puede borrar, «recalcular enero en julio da lo mismo» deja de ser cierto). Con D-089 el daño se multiplica: el catálogo global pasó de 111 a 2.506 cuentas | **CORREGIDA por A14**: migración **181**, `CT001`. Desde una sesión de negocio, una fila con `tenant_id IS NULL` es de **solo lectura** en las **18 tablas de RLS híbrida** más `role_permission`. Sin sesión (migraciones, seeds, plataforma) no se aplica: el camino administrativo sigue intacto y hay prueba. El trigger se llama `<tabla>_zz_global_solo_lectura` para dispararse **el último** y no robarle el diagnóstico a ningún guardia más específico — `PU001`, `PR001` y `PR003` siguen dando su código. **Inventario que se mantiene solo**: una prueba deriva las tablas híbridas de la **forma de su política** en `pg_policies` y exige que todas lleven el guardia, así que una decimonovena tabla no puede entrar sin él |
| **V-48** | **El barrido «db/seeds es dato, no código» excluía un directorio que el cargador SÍ aplica.** La exclusión de `_fuentes/` que introdujo D-089/A1 saltaba el directorio entero, y `src/db/seed.ts` ejecuta cualquier `.sql` bajo `db/seeds/`, subdirectorios incluidos. Un seed puesto ahí habría entrado a la base sin pasar por ninguna de las cuatro comprobaciones del barrido | Media (infraestructura de QA: no rompe nada hoy, pero es un guardia que dice cubrir lo que no cubre — el patrón de V-43) | **CORREGIDA por A14**: la excepción se acota a los archivos que **no** son `.sql`, y una prueba nueva exige que el conjunto que audita el barrido sea **idéntico** al que aplica el cargador |
| **V-49** | **Vuelve el patrón de V-45, en otra plantilla.** `src/services/carga-masiva/definiciones.ts` traía `base_minima_servicios_uvt` con ejemplo **`4`** y `base_minima_compras_uvt` con ejemplo **`27`**: son las bases mínimas de la sección 7.5, es decir **valores tributarios reales escritos en el código fuente** (Regla de Oro 2), y además `plantilla.ts` los escribe en la **fila 2, que es una fila de DATOS**. Quien descargara la plantilla y pegara su lista sobre las filas de ejemplo se llevaba las bases mínimas del ejemplo como si fueran las de su municipio. Las demás celdas numéricas de esa plantilla ya eran marcadores obviamente falsos (`0,5`, `0`, `1`); estas dos eran las reales | Media-alta (RO 2 y advertencia §17.5: un parámetro tributario falso cargado sin que nadie lo decida) | **CORREGIDA por A14**: las dos celdas van **vacías** y el formato se explica en la descripción de la columna. Las 55 pruebas de carga masiva siguen verdes |
| **V-50** | **La red de seguridad de D-089 no cubre la NOTA CRÉDITO.** `verificarCuentasImputables` —el filtro que A3 añadió para que una cuenta no imputable acabe en revisión manual con motivo legible en vez de matar al worker con un `LG004` crudo— se llama en `causarFactura` y **no** en `causarNotaCredito`. Las partidas no-retención de la nota vienen del asiento original (y la puerta de la reversa las admite), pero las de retención las resuelve el motor **a la fecha de la nota** y pueden apuntar a una cuenta que no esté en el original | **Baja**: es contrivada (exige que alguien reapunte una regla a una agrupadora entre la factura y la nota), no corrompe el ledger —lo peor es una excepción que reintenta el worker, que es lo que pasaba antes de D-089— y ninguna prueba existente la alcanza | **DECLARADA, NO corregida por A14.** El arreglo obvio (llamar el mismo filtro) **rompería** la garantía de A2: la reversa tiene permitido reproducir una cuenta inactivada, y ese filtro la rechazaría. La versión correcta tiene que exceptuar las cuentas que ya están en el asiento original, y eso es criterio de diseño del motor. **Le corresponde a A3** |

### Los 20 casos dorados, uno por uno (reejecutados por A14 tras D-089 y tras sus propias correcciones)

| # | Caso | Estado tras D-089 |
|---|---|---|
| 1 | Servicio $1.000.000 + IVA 19%, PJ declarante, Bogotá → retefuente $40.000, ReteIVA $28.500 | ✅ pasa. Mismos pesos; el crédito de retefuente va ahora a **236525** en vez de a `2365`. La pata de ReteICA de Bogotá sigue sin tarifa por actividad (**V-5**, abierta) |
| 1b | El ReteICA de Bogotá NO se inventa | ✅ pasa |
| 2 | Mismo servicio, PN no declarante → $60.000: el eje «tercero» opera | ✅ pasa, sin cambio de importe |
| 3 | Servicio de $80.000 (bajo 2 UVT): no retiene y el motivo queda | ✅ pasa |
| 4 | Compra de $500.000 (bajo 10 UVT): no retiene, con motivo | ✅ pasa |
| 5 | Compra de $600.000 a declarante → $15.000 | ✅ pasa. Crédito a **236540** |
| 6 | Honorarios PJ $200.000 → $22.000 desde el primer peso | ✅ pasa. Crédito a **236515** |
| 7 | Arrendamiento de inmueble no retiene; de mueble por igual valor sí ($16.000) | ✅ pasa. Crédito a **236530** |
| 8 | Servicio en Medellín: ReteICA 2‰ y base 15 UVT = $785.610 | ✅ pasa. `2368` sigue siendo hoja y no la tocó la 180 |
| 9 | Mismo servicio en Cali: base de servicios 3 UVT = $157.122 | ✅ pasa |
| 10 | Principal en Bogotá, secundaria en Cali, operación en Cali: manda la actividad de Cali | ✅ pasa |
| 10b | Varias actividades en el mismo municipio: desempate configurable | ✅ pasa |
| 11 | Vigilancia $5.000.000 con AIU $500.000: retiene 2% sobre el AIU = $10.000 | ✅ pasa |
| 12 | Proveedor del exterior: ReteIVA al 100% = $190.000 | ✅ pasa. `2367` sigue siendo hoja |
| 12b | Exterior sin regla parametrizada: revisión manual | ✅ pasa |
| 13 | Régimen SIMPLE: tratamiento diferenciado según parametrización | ✅ pasa |
| 14 | Tres líneas de conceptos distintos: retención por concepto, agregada ($77.000) | ✅ pasa, **y la aserción se endureció**: los tres agregados caen ahora en **tres subcuentas distintas** (236525 / 236540 / 236515) en vez de las tres en `2365`. La suma en pesos es idéntica |
| 14b | Partir un concepto en dos líneas no esquiva la base mínima | ✅ pasa |
| 15 | Nota crédito: reversa proporcional por asiento nuevo, sin mutar el original | ✅ pasa. Ver **V-50**: declarada, no bloqueante |
| 15b | Nota crédito por el total reversa exactamente lo retenido | ✅ pasa |
| 16 | Factura de junio procesada en julio: manda la fecha del hecho | ✅ pasa, y ahora también contra el reapunte de cuenta de la 180: un hecho de 2025 sigue resolviendo `2365` |
| 17 | Cambio de tarifa con vigencia futura: lo publicado no cambia | ✅ pasa |
| 18 | Reprocesar 10 veces la misma factura: asiento idéntico las 10 | ✅ pasa |
| 19 | Segunda factura del mismo proveedor con la misma descripción: **cero llamadas al LLM** | ✅ pasa (8 pruebas de `caso19-memoria.test.ts`; el motor no tiene con qué llamar a un LLM) |
| 20 | Usuario del tenant A consulta datos del tenant B: cero filas, en la base | ✅ pasa. Y en esta compuerta se cerró el lado **de escritura** que faltaba en el catálogo compartido (**V-47**) |

### Estado del árbol tras la compuerta

`npx tsc --noEmit` **limpio** · `npx vitest run` **1345 en verde, 70 archivos** (base del encargo =
1293/68, que en realidad salía 1292 por la prueba intermitente; **+52 pruebas en 2 archivos nuevos y
1 añadida a `valores-tributarios`, 0 regresiones**). Las migraciones **179**, **180** y **181** y los
seeds `011`/`050`/`070` siguen **sin aplicar a la Neon**. **A14 no comitea.** La verificación en
navegador real es un paso aparte, del usuario.

**Lo que A14 tocó de otros agentes, y por qué:** `tests/services/puc-d089.test.ts` y
`tests/gates/puc-d089-integridad.test.ts` (código de cuenta determinista, sin sortear),
`tests/adversarial/valores-tributarios.test.ts` (V-48),
`src/services/carga-masiva/definiciones.ts` (V-49), `src/db/types.ts` (`CT001`) y la migración **181**
(V-49 es de **A8**; V-48 es de **A1**; V-47 es de la política híbrida de la Ola 0, **A2**, agravada
por el volumen que D-089 le dio al catálogo global). Ninguna aserción ajena se relajó: la única que
se movió —el caso 14— se volvió más exigente.

---

## D-089 — Módulo PUC / Plan de cuentas: MODELO DE DATOS (A2, migración 179)

**Alcance de esta entrega: solo esquema.** Interfaz, servicio y compuerta los entregan otros agentes
sobre estas garantías. **Sin comitear.**

### La decisión de fondo: no había nada que crear, había que cerrar tres agujeros

`account` ya estaba completa desde la Ola 0 (jerarquía por longitud del código, naturaleza,
`permite_movimiento`, RLS híbrida global/firma/empresa, unique `(tenant_id, company_id, codigo)`) y
`v_account_efectivo` (170) ya resolvía la precedencia empresa>firma>global. **No se creó ni una
tabla ni una columna.** Lo que faltaba era **integridad**, y en los tres casos estaba delegada en la
aplicación o simplemente no existía.

### Migración `db/migrations/179_a2_d089_puc_integridad.sql`

| Objeto | Qué impone | SQLSTATE |
|---|---|---|
| `journal_line_valida_cuenta` (`BEFORE INSERT OR UPDATE ON journal_line`) | Una partida no entra al ledger —**ni siquiera en borrador**— contra una cuenta agrupadora o inactiva | `LG004` (reusado) / `LG009` (nuevo) |
| `app.cuenta_tiene_movimientos(uuid) → boolean` | ¿Esta cuenta aparece en el ledger? `STABLE SECURITY DEFINER` | — |
| `app.cuenta_conceptos_activos(uuid) → bigint` | Cuántos `concepto_causacion` **activos** (por cualquiera de sus 3 FKs) y cuántas `memoria_clasificacion` activas la usan | — |
| `app.cuenta_uso(uuid) → TABLE(...)` | Conteos de uso: partidas, conceptos, hijas, `niif_mapping`, `exogena_account_mapping` | — |
| `account_restrict_uso` (`BEFORE UPDATE OR DELETE ON account`) | Cinco reglas, abajo | `PU001`..`PU005` |

### Punto 1 — LG004 pasa de la publicación al INSERT, y aparece LG009

Hasta hoy `LG004` **solo se disparaba en el trigger diferido de publicación** (010:251). Eso
significa que la bandeja de causación podía enseñarle al contador una propuesta imputada contra la
clase 5, él la aprobaba, y el error salía **después** de la revisión humana. Ahora muere en el
`INSERT` de la partida.

Decisiones que no son obvias:

1. **`LG004` se REUSA, no se inventa un código nuevo.** Es el mismo hecho contable que ya
   diagnosticaba el trigger de publicación; darle código propio obligaría a todo el código
   existente a mirar dos. La prueba de la Ola 0 (`ola0.test.ts:267`) sigue verde **sin tocarla**:
   pide `LG004` y `LG004` recibe, solo que antes.
2. **`LG009` (`CUENTA_INACTIVA`) sí es nuevo**, porque es un hecho distinto: la cuenta es imputable
   pero está retirada del plan. El remedio que se le ofrece al contador no es el mismo
   («escoja la hoja» vs. «reactívela o use la que la sustituyó»), y colapsarlos haría imposible
   que la interfaz dijera cuál de las dos cosas pasó.
3. **El trigger de publicación NO se quita.** Se suma. Una cuenta puede degradarse después de que
   la partida entrara, y quitar el diferido sería relajar el ledger para ganar una consulta.
4. **La puerta de la reversa.** Una reversa reproduce las partidas del asiento que corrige, y ese
   asiento es del pasado: sus cuentas pueden haberse retirado desde entonces. Bloquearla dejaría un
   error **incorregible** en el ledger, que es lo contrario exacto de la Regla de Oro 1. Por eso una
   partida de un asiento `tipo = 'reversa'` se admite **si esa misma cuenta ya aparece en el asiento
   que reversa**. No es un portillo genérico: hay prueba de que una reversa **no** puede colar una
   cuenta agrupadora que el original no tenía.
5. **Orden de disparo**: `journal_line_alcance` (018) → `journal_line_inmutable` (010) →
   `journal_line_valida_cuenta`. Un intento sobre un asiento publicado sigue diciendo `LG001`, no
   `LG004`.

### Punto 2 — una cuenta en uso no se degrada (patrón TP001 de D-084)

Trigger en **la base**, no guard de servicio: es el criterio del resto del sistema, y `guardarCuenta`
no es el único camino (carga masiva, acción de servidor, `psql`).

| Código | Se bloquea | Por qué |
|---|---|---|
| `PU001` | **DELETE** de una cuenta con partidas, conceptos activos, cuentas hijas o mapeos NIIF/exógena | Las FK ya lo impedían con un `23503` ilegible. Aquí se dice qué pasa y qué hacer. Mismo criterio que `TP001`: lo que el ledger o la exógena ya citan tiene que resolverse por su id para siempre |
| `PU002` | Cambiar **`naturaleza`** con movimientos | El más grave y el más invisible: no toca ni una partida, pero **invierte el signo con que todos los reportes históricos leen la cuenta**. Un balance ya emitido dejaría de cuadrar sin que nada en el ledger cambiara. Sin excepción y sin «forzar» |
| `PU003` | Quitar **`permite_movimiento`** con movimientos | Deja el histórico imputado sobre algo que por definición del PUC no admite imputación; los reportes por niveles la sumarían dos veces (como hoja y como grupo) |
| `PU004` | Cambiar **`codigo`** con movimientos | El código ES la identidad contable en todo reporte, en la exógena y en los papeles de trabajo ya emitidos: moverlo reclasifica el pasado en silencio |
| `PU005` | Retirar (`activo=false`) o desimputar una cuenta a la que apunta un **`concepto_causacion` activo** | Sin esto, la causación automática se rompe en la siguiente factura con un error que no menciona esta pantalla. Reasigne el concepto primero |

**Lo que NO se bloquea, a propósito:**

- **`activo = false` con movimientos** (y sin conceptos activos). Es **el** camino previsto para
  retirar una cuenta, igual que en terceros. Bloquearlo dejaría el plan de cuentas sin manera de
  limpiarse.
- **Tener `niif_mapping` o `exogena_account_mapping`.** Son mapeos **por vigencia**: retirar la
  cuenta no los invalida y el estado financiero de un período pasado se sigue armando con el mapeo
  de entonces. Se **cuentan** en `app.cuenta_uso` para que la interfaz avise, pero no bloquean.
- **Nombre, `requiere_tercero`, `requiere_centro_costo`, `requiere_base_gravable`, `parent_id`.**
  Ninguno reinterpreta el histórico.
- Toda comparación usa `IS DISTINCT FROM`: **reguardar una cuenta con los mismos valores no dispara
  nada**, que es exactamente lo que hace `guardarCuenta` en cada importación y en cada guardado sin
  cambios de la pantalla. Hay prueba.

### Punto 3 — el reverse lookup NO necesita esquema, pero el criterio SÍ tiene que ser uno solo

**Confirmado: «qué conceptos de causación usan esta cuenta» es una consulta normal** con tres
`LEFT JOIN` sobre `concepto_causacion` bajo RLS, y la hace **A8** en el servicio. **No se creó
`v_account_uso`**: una vista que cuente partidas por cada fila de un PUC de miles de cuentas es un
recorrido completo de la tabla más grande del sistema cada vez que alguien abre la pantalla, y la
consulta real es siempre por **una** cuenta.

Lo que sí se creó es **`app.cuenta_uso(uuid)`**, y la razón no es rendimiento sino que **la interfaz
no puede prometer lo que el motor va a negar** (precedente `app.tercero_tiene_movimientos`, D-084):
el badge «en uso» y el botón deshabilitado tienen que salir del **mismo criterio exacto** que aplica
el trigger. Devuelve **conteos, no nombres**: el listado detallado va bajo RLS en el servicio, para
que el nombre de un concepto de otra firma no pueda salir nunca por una función `SECURITY DEFINER`.

**Por qué las tres funciones son `SECURITY DEFINER`** (y están declaradas en el inventario de A14 de
`evasion.test.ts` y `compuerta-ola1.test.ts`, que las cazó): **no es comodidad, es corrección.** Una
cuenta de alcance global o de firma (`company_id IS NULL`, D-064) puede tener movimientos en
**varias** empresas; bajo la RLS de la sesión, el guardia solo vería los de la empresa en contexto y
**dejaría reclasificar desde la empresa A una cuenta con histórico en la B**. Reciben un
`account_id` que quien pregunta ya tuvo que resolver pasando por la RLS híbrida de `account`, y
devuelven un booleano o conteos: no filtran ni un dato de otra firma.

### Lo que queda para otros agentes

- **A8 (servicio + interfaz)**: listado «qué conceptos usan esta cuenta» (consulta bajo RLS, no
  esquema); traducir `LG009` y `PU001`..`PU005` a mensajes de pantalla; usar `app.cuenta_uso` para
  deshabilitar acciones. `src/services/puc.ts` **no se tocó**: `guardarCuenta` sigue funcionando
  igual y el motor ahora lo respalda.
- **A3/A7**: nada que cambiar. El camino de reversa está explícitamente protegido y las pruebas de
  bandeja/causación siguen verdes.

### Defecto de DATOS que esta migración destapó (no es de A2, no se tocó)

Con el seed **nuevo y aún sin comitear** `db/seeds/tanda2/011_puc_completo_2650.sql` (PUC completo
del Decreto 2650, en curso por otro agente), la cuenta **`2365` «RETENCIÓN EN LA FUENTE» pasa a
`permite_movimiento = false`** —correcto: es nivel 3 y tiene subcuentas `236505`…`236595`—, pero
**`db/seeds/tanda1/050_tax_rules_retefuente.sql` apunta `tax_rule.account_id` a `2365`** en sus
**doce** reglas. Resultado: el motor construye la propuesta de retefuente imputando sobre una cuenta
agrupadora. **Antes de D-089 eso no se veía** (el borrador se creaba y solo habría reventado al
publicar); ahora `tests/services/bandeja.test.ts` (V-7) falla con `LG004` en el INSERT. **Es
exactamente el bug que este trabajo existe para destapar.** El arreglo es de **A1/A3**: apuntar cada
`tax_rule` de retefuente a su subcuenta (`236515` honorarios, `236525` servicios, `236540` compras,
`236530` arrendamientos…), no a `2365`. **Sin ese seed nuevo, `npm test` queda entero en verde.**

### Estado del árbol

`npx tsc --noEmit` **limpio**. `npm test`: **21 pruebas nuevas en verde** en
`tests/gates/puc-d089-integridad.test.ts`, **0 regresiones atribuibles a 179**. Se modificaron dos
pruebas ajenas y **solo para declarar el inventario**: `evasion.test.ts` y `compuerta-ola1.test.ts`
listan ahora las tres funciones `SECURITY DEFINER` nuevas con su justificación (no se relajó ninguna
aserción). La migración **179** está **sin aplicar a la Neon**. **Sin comitear.**

---

## D-089 — INTERFAZ (A8, 2026-09-04) — TAREAS 4 y 5

**Alcance: solo `src/services/puc.ts`, `app/parametros/puc/**` y `app/api/parametros/puc/exportar`.**
No se tocó `src/domain/motor.ts`, `src/services/causacion.ts` ni los seeds de `tax_rule` (A3). **Sin
comitear.**

### Estado ya resuelto por olas anteriores — verificado, NO duplicado

- `/parametros/puc` migrado al shell nuevo (D-087 T0). ✔
- Precedencia empresa>firma>global en `v_account_efectivo` (D-064) y modo `puc.solo_propio` (D-065). ✔
- Alta/edición de cuenta propia (`guardarCuenta`), carga masiva `/carga-masiva/account`, permiso
  `parametro.puc.editar` (D-087). ✔ — **TAREAS 3 y 6 de D-089 ya cubiertas.**

### TAREA 4 — uso inverso + protección visual

**`src/services/puc.ts` (añadido, sin tocar lo existente):**

| Función | Qué hace |
|---|---|
| `usoDeCuenta(tx, id) → UsoCuenta` | Envuelve `app.cuenta_uso`: partidas, conceptos activos, hijas, mapeos NIIF/exógena. `tieneMovimientos = partidasLedger > 0`, `enUso = partidas>0 ∨ conceptos>0` |
| `usoDeCuentas(tx, ids[]) → Map` | Lo mismo para el lote de la tabla, **un round-trip** (`unnest` + `LATERAL app.cuenta_uso`). No se creó vista sobre todo `account` (migración 179) |
| `conceptosQueUsanCuenta(tx, id)` | Qué `concepto_causacion` la usan y **en qué rol** (`gasto` / `iva_descontable` / `contrapartida`), mirando las 3 FKs, **bajo RLS** de `concepto_causacion` — nombre de concepto de otra firma no sale |
| `conceptosQueUsanCuentas(tx, ids[])` | Idem para el lote |
| `simularImpactoCambioCuenta(tx, actual, propuesta)` | Predice `PU002..PU005` con el **mismo criterio que el trigger** `account_restrict_uso`. Devuelve `rechazos[]` (motor va a negar), `advertencias[]` (permitido pero sensible), `bloqueadoPorMotor`, `requiereConfirmacion` |

**`app/parametros/puc/page.tsx`:**

- Columna **«En uso»** por fila: badge `N conceptos` + `M partida(s)` (de `usoDeCuentas`), y botón
  **«Ver uso»** (modal genérico D-087, `_uso-cuenta.tsx`) con el listado de conceptos, su rol, y los
  conteos de partidas / hijas / mapeos.
- **Simulador de impacto bloqueante** (`?simular=<codigo>`): `guardarCuentaAction` detecta que es una
  edición real de la misma fila (mismo alcance), corre `simularImpactoCambioCuenta` y, si hay
  `bloqueadoPorMotor` o `requiereConfirmacion`, redirige al panel simulador **en vez de guardar**. El
  panel muestra «afecta N conceptos y M partidas» + la lista de conceptos.
  - **`bloqueadoPorMotor`** (PU002/PU003/PU004/PU005): se muestra el impacto y **NO hay botón de
    guardar** — no hay «forzar», es la garantía de la 179. Texto: «cree una cuenta nueva y traslade
    el saldo».
  - **`requiereConfirmacion`** (inactivar cuenta con movimientos y sin conceptos — el motor lo
    permite): botón **«Confirmar y guardar el cambio»** que reenvía `guardarCuentaAction` con
    `confirmado=1`. El impacto se **recalcula en el servidor en la misma lectura**, nunca desde el
    query string.
- Nunca se ofrece una acción que el motor va a negar sin avisar antes.

**`app/parametros/puc/acciones.ts`:** `mensajeDeError` traduce `PU001..PU005` y `LG009`/`LG004` a
mensajes con contexto de pantalla (antepone el qué-hacer, conserva el detalle del motor).

### TAREA 5 (lado UI) — Exportar PUC a Excel

- Botón **«Exportar PUC a Excel»** en la cabecera de `/parametros/puc` → `GET /api/parametros/puc/exportar`.
- **Contrato acordado con A9** (en el header del `route.ts`): `.xlsx` del PUC efectivo de la empresa
  en sesión, hojas «Datos» (fila por cuenta: codigo, nombre, nivel, naturaleza, imputable, estado,
  alcance, en_uso, partidas, mapeo NIIF), «Papel de trabajo» (encabezado empresa/NIT/fecha),
  «Parámetros» (modo del PUC + totales del resumen). Nombre `puc_<AAAA-MM-DD>.xlsx`.
- **Seguridad idéntica a `/api/terceros/exportar`**: empresa solo de `conSesion`, sin parámetro de
  empresa, RLS de `account`/`v_account_efectivo` aísla; 401 sin sesión, 403 sin `parametro.puc.leer`.
- Hoy es **stub 501** (con `exigirPermiso` ya cableado y un `TODO(A9, D-089)`): el generador
  `src/reports/puc-efectivo.ts` lo implementa **A9**.

### Verificación

- `npx tsc --noEmit`: **sin errores en archivos de A8**. Quedan 3 errores en `tests/golden/casos-dorados.test.ts`
  y `tests/adversarial/a14-d088-ampliada.test.ts` (`cuentas.retefuente` → subcuentas), que son de la
  migración **180** / seeds de **A1/A3 en paralelo**, no de A8.
- `tests/services/puc-d089.test.ts` — **8 pruebas nuevas** (uso inverso por rol, lote, y simulador:
  PU002 / PU003+PU004 / PU005 / confirmación no bloqueante / cambio inocuo). Verdes.
- Sin regresiones: `parametrizacion.test.ts` (29), `puc-d089-integridad.test.ts` (21),
  `ola4-carga-masiva.test.ts` (42) — todas verdes.

### Coordinación pendiente

- **A9**: ~~implementar `GET /api/parametros/puc/exportar` (hoy 501)~~ **HECHO** — ver «D-089 — REPORTERÍA (A9)».
- **A2 confirmó (RLS de firma)**: `app.cuenta_uso` y `cuenta_conceptos_activos` son `SECURITY
  DEFINER` justamente para que un administrador de firma que edita una cuenta compartida (global /
  `company_id NULL`) vea el histórico de **todas** sus empresas y no pueda reclasificar desde la
  empresa A una cuenta con movimientos en la B. El simulador de A8 hereda ese criterio. Nada que
  cambiar en las políticas RLS para el diseño elegido.

---

## D-089 — REPORTERÍA (A9, 2026-09-04) — TAREA 5: exportar el PUC efectivo a Excel

**Alcance: `src/reports/puc-efectivo.ts` (nuevo), `app/api/parametros/puc/exportar/route.ts` (quita el
501), `tests/reports/puc-efectivo.test.ts` (nuevo).** No se tocó `src/domain/motor.ts`, seeds de
`tax_rule` ni `src/services/puc.ts`. **Sin comitear.**

### Qué hace

- `generarLibroPucEfectivo(tx): ExcelJS.Workbook` — workbook construido a mano (mismo estilo de papel
  de trabajo que `terceros-maestro.ts`), **cuatro hojas** en el orden de la sección 11.2:
  - **Datos** — una fila por cuenta de `v_account_efectivo` (precedencia empresa>firma>global ya
    resuelta, D-064). Columnas: Código, Nombre, Nivel, Naturaleza (Débito/Crédito), Imputable (Sí/No),
    Estado (Activa/Inactiva), Alcance (Genérica / De la firma / Propia de la empresa), ¿En uso?,
    Conceptos que la usan, Partidas en el ledger, Clasificación NIIF, Sección NIIF, Rubro ESF, Rubro
    ERI, Norma NIIF, NIIF vigente desde, NIIF vigente hasta.
  - **Papel de trabajo** — encabezado obligatorio (razón social, NIT, período/corte, responsable,
    generado el) + modo del PUC + totales de `resumenPuc` (efectivas, imputables, propias/firma/
    genéricas) + nº de cuentas en el archivo.
  - **Trazabilidad** — una fila por cuenta **con** clasificación NIIF vigente (regla + vigencia
    «cuando aplique»: el PUC no calcula nada tributario, la única regla versionada que le aplica es el
    `niif_mapping`). Incluye `¿Verificación humana pendiente?`. Si ninguna cuenta tiene mapeo NIIF, lo
    dice en una línea.
  - **Parámetros** — modo del PUC, fecha de resolución de la precedencia, desglose del resumen,
    nota de que el mapeo NIIF se resuelve por la vigencia más específica.
- **En uso / partidas / conceptos**: consultas agregadas directas (no `usoDeCuentas` cuenta a cuenta)
  — `journal_line` sobre asientos `posted` agrupado por cuenta, y `concepto_causacion` activos por las
  tres FKs. `¿En uso? = partidas>0 ∨ conceptos>0`, mismo criterio que el motor (migración 179).
- **NIIF vigente**: `DISTINCT ON (account_id)` de `niif_mapping` con ventana que contiene la fecha de
  corte, ordenado por especificidad (`company_id` → `tenant_id` → `vigente_desde`), como D-064.
- Se consulta `v_account_efectivo` **directamente** (no `listarPucEfectivo`): su LIMIT tope de 2000 no
  alcanza para un PUC completo (~2.500 cuentas del Decreto 2650 cargado por A1).

### Ruta

`GET /api/parametros/puc/exportar` → `puc_<AAAA-MM-DD>.xlsx`. Seguridad **idéntica** a
`/api/terceros/exportar`: `workbook` se arma dentro de `conSesion`, `exigirPermiso(tx,
PERMISOS.PARAMETRO_PUC_LEER)` antes de generar; empresa exclusivamente de la sesión (sin parámetro, la
RLS de `account`/`v_account_efectivo`/`niif_mapping`/`journal_line` aísla). 401 sin sesión, 403 sin
permiso o sin empresa, 500 con detalle solo al log.

### Verificación

- `npx tsc --noEmit`: sin errores en archivos de A9. Queda **1** preexistente en
  `tests/adversarial/a14-d088-ampliada.test.ts` (`cuentas.retefuente` → subcuentas), de **A3** en
  paralelo, no de A9.
- `tests/reports/puc-efectivo.test.ts` — **5 pruebas**: las 4 hojas obligatorias; encabezado de
  empresa/NIT/responsable en el papel de trabajo; filas de «Datos» = `SELECT codigo FROM
  v_account_efectivo` (mismo conteo y mismos códigos, incluye la cuenta propia); aislamiento (empresa
  B no ve la cuenta propia de A); 403 — un rol sin `parametro.puc.leer` no exporta.
- Sin regresiones: `tests/reports/` (90) + `tests/services/puc-d089.test.ts` (8), todas verdes.

### Reportes ya exportables a Excel (sección 11.3)

Libro auxiliar por cuenta y tercero · Libro diario · Libro mayor · Balance de prueba (cualquier nivel
del PUC) · Certificado de retenciones por tercero · Relación de retenciones por período y tipo ·
Movimiento de terceros · Detalle de IVA generado y descontable · **PUC efectivo (D-089 TAREA 5, nuevo)**.
Estados financieros (A10) y formatos de exógena (A11) tienen su propia reportería.

---

## D-089 — MOTOR / REGLAS (A3, 2026-09-04) — reapunte de retefuente a subcuentas + guard del motor

> A3 hizo el trabajo (migración 180, seeds, motor, prueba adversarial) y verificó sus 7 pruebas
> nuevas; el corte por límite de cupo le impidió correr la suite completa y escribir esta ficha. El
> orquestador corrió la suite: **`tsc` limpio · `npx vitest run` 1293/1293 en verde, 68 archivos**
> (base A9 = 1273/65; +20 en 3 archivos: `a3-d089-cuenta-agrupadora` 7, y ampliaciones de
> `golden/casos-dorados` y `adversarial/casos-dorados`). Sin comitear. Sin aplicar a la Neon.

### El problema

Las **18** reglas globales de retefuente (`tanda1/050` doce, `tanda2/070` seis) apuntaban
`tax_rule.account_id` a `2365` «RETENCIÓN EN LA FUENTE». Con el PUC completo del Decreto 2650
(D-089/A1), `2365` es una cuenta de nivel 3 **con subcuentas** → agrupadora imputable, y el saldo de
la retención quedaba sin decir por qué concepto se retuvo (lo que el art. 381 ET y el Formato 1001
exigen desagregado). Antes de D-089 solo habría reventado al publicar; con el trigger de la 179,
revienta en el `INSERT` de la partida.

### Qué hizo A3

| Punto | Resolución |
|---|---|
| **Seeds corregidos** (`tanda1/050`, `tanda2/070`) | Cada `INSERT` de regla apunta ya a su subcuenta 236x por concepto. Una base **nueva** nace bien, sin vigencia partida. Mapeo: `servicios*`,`transporte*`,`vigilancia_aseo`,`hoteles_restaurantes`,`servicios_integrales_salud` → **236525**; `compras_generales`,`productos_agricolas`,`combustibles` → **236540**; `honorarios_pj/pn` → **236515**; `arrendamiento_muebles/inmuebles` → **236530**; `rendimientos_financieros*` → **236535**. `2367` (ReteIVA) y `2368` (ReteICA) **no se tocan**: en el Decreto 2650 son hojas, sus reglas ya estaban bien. |
| **Migración 180** (`180_a3_d089_retefuente_subcuentas.sql`) | Solo para la base **ya sembrada** (la Neon), donde el seed `INSERT … WHERE NOT EXISTS` nunca tocaría las filas viejas. **No hace `UPDATE`** de `account_id`: el trigger `tax_rule_vigencia_append_only` (migración 001) lo prohíbe (`PR001`) y esa conducta es correcta. En su lugar **cierra la vigencia vieja** (`vigente_hasta = CURRENT_DATE - 1`) y **abre una gemela** contra la subcuenta, idéntica en tarifa/base/comparador/discriminadores/norma. Consecuencia declarada (sección 9.2): una factura con hecho económico anterior a la migración se sigue resolviendo contra la vigencia vieja y sigue acreditando `2365` — el pasado no se reinterpreta. Todo idempotente y condicional; en base limpia es un no-op (corre antes que los seeds). |
| **Bloque B de la 180** | `2365` pasa a `permite_movimiento = false` **solo si** tiene subcuentas imputables **y** ninguna vigencia de `tax_rule` (viva o cerrada) la referencia **y** no tiene movimientos (`PU003`) **y** no tiene conceptos activos (`PU005`). Si algo falla, no hace nada. |
| **Motor** (`src/domain/motor.ts`, `repositorio.ts`, `tipos.ts`, `src/services/causacion.ts`) | Una regla o `concepto_causacion` cuya cuenta destino no es imputable (agrupadora o inactiva) manda el documento a **revisión manual con motivo legible** (`regla_con_cuenta_no_imputable`) ANTES de escribir la partida — ya no muere con el `LG004` crudo del trigger en la cara del contador. |
| **Prueba adversarial** `tests/adversarial/a3-d089-cuenta-agrupadora.test.ts` (7) | (a) regla con cuenta agrupadora/inactiva → motor rechaza con mensaje entendible, nada escrito; (b) **diferencial**: cada regla global de retefuente resuelta dos veces (subcuenta de hoy vs. espejo del destino anterior) da el mismo asiento **centavo a centavo** — solo cambia el `account_id` del crédito. |

### Pendiente (no bloquea el cierre de D-089, lo verifica A14)

- Los 20 casos dorados vueltos a correr por el orquestador vía suite completa: verdes. A14 los
  reejecuta uno por uno en su compuerta.
- Aplicar 179 + 180 + seeds `011`/`050`/`070` a la Neon: paso del despliegue (usuario / A15).

---

## Vulnerabilidades — registro de A14

| Id | Qué es | Gravedad | Estado | De quién |
|---|---|---|---|---|
| **V-47** | **Cualquier firma podía BORRAR el catálogo global compartido y APROPIARSE de sus filas.** Medido por A14 con SQL directo desde una sesión de negocio real (`app_user`, RLS activa, token presentado): `DELETE FROM account WHERE tenant_id IS NULL` dejó el catálogo base en **cero filas** —con el PUC de D-089, **2.506 cuentas que desaparecen para todas las firmas de la plataforma**— y `UPDATE account SET tenant_id = <el mío>` movió una fila compartida al patrimonio de una firma, quitándosela a las demás. La causa no es de D-089 ni de `account`: es la **política RLS híbrida de la Ola 0** (012), cuyo `USING` incluye las filas globales para poder **leerlas** mientras un `DELETE` no tiene `WITH CHECK` que lo detenga. **Y no era solo `account`**: por el mismo camino se borraba el valor global de la **UVT** (sin UVT el motor deja de calcular para toda la plataforma), un **municipio** o una **actividad CIIU** del catálogo nacional, una vigencia global de `tax_rule` **todavía no vigente** (`PR003` solo cubre las que ya rigen) y los **permisos de un rol del sistema** vía `role_permission` | **Alta**: escritura destructiva entre firmas sobre datos compartidos. Regla de Oro 7 en su forma literal, y la 3 por la puerta de atrás (si una vigencia global se puede borrar, «recalcular enero en julio da lo mismo» deja de ser cierto) | **CORREGIDA por A14**: migración **181** (`CT001`). Desde una sesión de negocio, una fila con `tenant_id IS NULL` es de **solo lectura** en las 18 tablas de RLS híbrida más `role_permission`; sin sesión (migraciones, seeds, plataforma) no se aplica, con prueba. El trigger va con sufijo `_zz_` para dispararse el último y no robarle el diagnóstico a `PU001`/`PR001`/`PR003`. Una prueba deriva las tablas híbridas de la **forma de su política** en `pg_policies` y exige que todas lleven el guardia: el inventario no se mantiene a mano | era de **A2** (política de la Ola 0), agravado por el volumen que **D-089/A1** dio al catálogo global |
| **V-48** | **El barrido «`db/seeds` es dato, no código» excluía un directorio que el cargador SÍ aplica.** D-089/A1 excluyó `_fuentes/` **entero** del barrido, pero `src/db/seed.ts` recorre todos los subdirectorios de `db/seeds/` y ejecuta cualquier `.sql` que encuentre. Un seed puesto ahí habría entrado a la base sin pasar por ninguna de las cuatro comprobaciones: ni «ningún seed hace UPDATE/DELETE», ni «ningún seed define lógica», ni «toda fila normativa declara su norma de respaldo» | Media (infraestructura de QA; el patrón de V-43: un guardia que dice cubrir lo que no cubre) | **CORREGIDA por A14**: la excepción se acota a los archivos que **no** son `.sql` dentro de `_fuentes/`, y una prueba nueva exige que el conjunto auditado sea **idéntico** al que aplica el cargador | era de **A1** |
| **V-49** | **Reaparece el patrón de V-45 en otra plantilla.** `src/services/carga-masiva/definiciones.ts` traía `base_minima_servicios_uvt` con ejemplo **`4`** y `base_minima_compras_uvt` con ejemplo **`27`**: las bases mínimas de la sección 7.5, es decir valores tributarios reales escritos en el código, y además `plantilla.ts` los escribe en la **fila 2, que es fila de DATOS**. Quien pegara su lista sobre las filas de ejemplo cargaba las bases mínimas del ejemplo como si fueran las de su municipio. Las demás celdas numéricas de esa plantilla ya eran marcadores obviamente falsos (`0,5`, `0`, `1`); estas dos eran las de verdad | Media-alta (Regla de Oro 2 y advertencia §17.5) | **CORREGIDA por A14**: las dos celdas van vacías y el formato se explica en la descripción de la columna. Las 55 pruebas de carga masiva siguen verdes | era de **A8** |
| **V-50** | **La red de seguridad de D-089 no cubre la nota crédito.** `verificarCuentasImputables` —el filtro de A3 que manda a revisión manual con motivo legible cuando una cuenta de la propuesta no admite partidas, en vez de matar al worker con el `LG004` crudo de la 179— se llama en `causarFactura` y **no** en `causarNotaCredito`. Las partidas no-retención de la nota vienen del asiento original (y la puerta de la reversa las admite), pero las de retención las resuelve el motor **a la fecha de la nota** y pueden apuntar a una cuenta que no esté en el original | **Baja**: exige que alguien reapunte una regla a una agrupadora entre la factura y la nota; no corrompe el ledger —lo peor es una excepción que el worker reintenta, que es lo que pasaba antes de D-089— y ninguna prueba existente la alcanza | **DECLARADA, NO corregida.** El arreglo obvio (llamar el mismo filtro) **rompería** la garantía de A2: la reversa tiene permitido reproducir una cuenta inactivada y ese filtro la rechazaría. La versión correcta debe exceptuar las cuentas que ya están en el asiento original, y eso es criterio de diseño del motor. A14 no lo inventa | **A3** |
| **V-43** | **El guard `gravada`/tarifa de `editarTarifaTaxRule` no miraba el flag que la fila iba a HEREDAR.** La comprobación era `if (input.gravada === false && tarifa !== 0)`, pero el `INSERT` de más abajo escribía `input.gravada ?? anterior.gravada`: si la llamada **no** traía `gravada` —que es lo normal cuando solo se cambia la tarifa— la vigencia nueva heredaba `false` de la regla anterior y se iba a la base con una tarifa positiva. La combinación prohibida era exactamente la misma, pero el guard no la veía, así que el contador recibía un error crudo de PostgreSQL en vez del motivo, y el comentario del código («el mismo guard que impone el CHECK») era falso. La UI de D-088 pasa el flag siempre, así que ese camino estaba cubierto; cualquier otro consumidor del servicio, no | Media (el CHECK `tax_rule_gravada_ck` seguía siendo la garantía real y **nada se escribió nunca mal**; el defecto es que el resguardo de aplicación no cubría lo que decía cubrir, y un guard que miente es peor que no tenerlo) | **CORREGIDA por A14**: el guard se evalúa **después** de leer la regla anterior y contra el flag **efectivo**, con la **misma expresión** (`input.gravada ?? anterior.gravada`) que va al `INSERT`; si guard y escritura no calcularan el flag igual, el guard no valdría nada. Dos pruebas: flag explícito y flag heredado, ambas exigiendo `VigenciaInvalidaError` y comprobando que no quedó ni una fila | era de **A8** |
| **V-44** | **La carga masiva de ICA tomaba la celda «Gravada» EN BLANCO por «no gravada», y admitía «Por periodo» sin ventana.** (a) `validarActividad` trataba `''` igual que `'N'`: una actividad **sí gravada** con su tarifa a la que se le olvidó la «S» se cargaba como `gravada = false, tarifa = 0`, **sin salir en el informe de errores**. Es decir, apagaba la retención de ICA de esa actividad en el municipio en silencio, y nadie lo veía hasta que un cliente reclamara. Es el error silencioso más caro del parser: una celda que decide si se practica una retención no puede tener valor por defecto (§17.5). (b) Con «Tipo de medición = Por periodo» y la celda «Periodo en meses» vacía o con basura, el archivo se cargaba dejando el municipio midiendo por periodo con ventana desconocida: **cada** factura suya se habría ido a revisión manual por `ICA_PERIODO_SIN_VENTANA`, un vacío que hay que ver **al cargar**, no factura a factura | **Alta** para (a) —cambio silencioso del resultado tributario, invisible en el informe— y media para (b) | **CORREGIDA por A14** en `src/services/carga-masiva/ica-municipio.ts`: la celda «Gravada» vacía es **error de fila** con el motivo explícito («escriba S o N: el sistema no supone que una actividad no está gravada»), y «Por periodo» sin un entero de 1 a 12 rechaza el archivo con `ArchivoIlegibleError` y un mensaje que explica por qué. Pruebas: fila con tarifa y sin «S» → error y **cero filas escritas**; ventana `0`, `13`, `2,5`, `dos` y ausente → rechazo; ventana `2` → carga y queda guardada | era de **A8** |
| **V-45** | **La plantilla descargable venía con valores tributarios PRECARGADOS en las celdas que el parser lee como configuración real.** `construirPlantillaIcaMunicipio` escribía `D5 = '05001'` (DANE de Medellín), `H5 = 27` («Base mínima UVT compra»), `H6 = 4` («Base mínima UVT servicio») e `I9 = 6` («Tarifa por mil»). Esas celdas **no son decoración**: son el bloque de encabezado que `leerArchivoIca` interpreta como los parámetros del municipio. Un contador que descargue la plantilla, pegue su lista de actividades sobre las filas de ejemplo y suba el archivo **habría cargado el municipio y las bases mínimas del ejemplo como si fueran los suyos**, sin enterarse. Y son, literalmente, una base mínima y una tarifa escritas en el código fuente | **Alta** como producto (un parámetro tributario falso cargado sin que nadie lo decida es exactamente lo que la advertencia §17.5 llama peor que el dato faltante) y violación directa de la **Regla de Oro 2** | **CORREGIDA por A14**: el bloque de encabezado y la fila de ejemplo van **vacíos**; el formato («9,66 por mil → 0,00966») y el cómo se llena cada celda viven en la hoja «Instrucciones» como prosa, no como valores cargables. La plantilla sin llenar, subida tal cual, ahora **se rechaza** en vez de cargar el ejemplo. Tres pruebas: ninguna celda de encabezado ni de tarifa trae valor; la plantilla vacía se rechaza; la plantilla llenada a mano sí la entiende el parser | era de **A8** |
| **V-46** | **Con la celda del valor vacía, el lector del encabezado tomaba la ETIQUETA SIGUIENTE como valor.** `valorTrasEtiqueta` barría hacia la derecha hasta encontrar cualquier celda no vacía. Con «Municipio» en blanco devolvía `"Base mínima UVT compra"` como nombre del municipio (de ahí un mensaje de error incomprensible), y en un archivo con las columnas en otro orden podía devolver el **número de la celda de al lado** y cargarlo como base mínima del municipio: un valor inventado, entrando por la puerta de atrás | Media (la variante peligrosa depende del layout, pero el mecanismo estaba ahí y es el que prohíben la RO 2 y la §17.5) | **CORREGIDA por A14**: el parser conoce ahora **todas** sus etiquetas (`ETIQUETAS`) y, si lo que hay a la derecha es otra etiqueta conocida, considera el valor **ausente** en vez de adoptarlo. Cubierta por la prueba de la plantilla vacía, que antes fallaba con `CargaIcaRechazadaError` («no existe el municipio Base mínima UVT compra») y ahora da el `ArchivoIlegibleError` correcto | era de **A8** |
| **V-39** | **El «flujo bloqueante de dos pasos» no bloqueaba nada.** D-087 partió la edición en `simular*Action` → `confirmar*Action` y declaró que «el simulador corre ANTES de guardar, nunca junto». Pero el paso 2 **no comprobaba absolutamente nada**: un POST directo a `confirmarUvtAction`, a `confirmarAction` de `tarifas/[tipo]` o a `confirmarAction` de `reteica-municipios` abría la vigencia nueva sin que el contador hubiera visto jamás el impacto. A14 lo midió en las tres pantallas: contó las filas antes y después, y en las tres **había una vigencia nueva**. El resguardo de la sección 6.2, punto 6 era decorativo | Media-alta (no es fuga de seguridad —el motor sigue exigiendo `parametro.editar`— pero es la garantía de PROCESO que el módulo entero vende: cambiar una tarifa sin ver a quién afecta) | **CORREGIDA por A14**: `exigirTestigoImpacto` en `src/services/parametrizacion.ts`. El paso 2 exige el **testigo del paso 1** (los conteos que el simulador mostró) **y** lo revalida contra el impacto real del instante — así cubre a la vez el POST directo (no hay testigo) y la pantalla rancia (el testigo ya no coincide porque entretanto entraron conceptos o proveedores). Aplicado a las **seis** acciones de confirmación (UVT, SMMLV, redondeo, tarifas, ReteICA). En tarifas, el `tax_concept` con el que se mide se resuelve **en la base** desde la regla (`taxConceptIdDeTaxRule`), no del formulario. Seis pruebas: POST directo → no escribe; testigo falseado → no escribe; flujo completo → sí escribe, en las tres pantallas | era de **A8** |
| **V-40** | **El número del simulador y su detalle podían contradecirse en la misma pantalla.** En el paso 2 de `tarifas/[tipo]` y de `reteica-municipios`, el titular «esta tarifa afecta N conceptos y M proveedores» se pintaba con `cadena(sp, 'conceptos')` — **el query string**, que el usuario controla y que envejece —, mientras el botón «Ver detalle» de al lado listaba las filas **medidas contra la base en ese render**. Un enlace guardado, un `?conceptos=999` a mano, o simplemente un concepto creado por otro usuario entre el paso 1 y el paso 2, y el contador leía un número y una lista que no cuadraban. Es literalmente el caso que el encargo declaraba bloqueante: «un simulador que dice “afecta 3 conceptos” y el detalle lista 2» | Media-alta (el simulador es el resguardo de la sección 6.2.6; si su cifra no es la de la base, no resguarda nada) | **CORREGIDA por A14**: las dos pantallas miden el conteo **en la misma lectura** que el detalle (`simularImpactoTarifa` / `simularImpactoMunicipioIca` dentro del mismo `conSesion`) y el query string ya no pinta nada. `valores-base` ya lo hacía bien. Prueba de código que prohíbe leer `conceptos`/`proveedores` de `searchParams` en las tres pantallas, más verificación contra el servidor real: con `conceptos=999` forzado en la URL, la pantalla muestra el 2 de verdad | era de **A8** |
| **V-41** | **El detalle del impacto se pedía con el `tax_concept` del query string.** `detalleImpactoTarifa(tx, taxConceptId)` con `taxConceptId = cadena(sp, 'taxConceptId')`: independiente de la regla que se estaba editando. Un enlace con el `taxConceptId` de otro concepto de la misma firma mostraba el impacto de **otra regla** mientras el formulario guardaba la propia. No cruza firmas (la función filtra por tenant), pero sí desalinea la decisión de la evidencia que la respalda | Media (la traza que justifica el cambio describe otra cosa; rompe el espíritu de la Regla 6) | **CORREGIDA por A14**: el detalle se pide con el `taxConceptId` de la **fila real** de la tarifa que se edita, y el paso 2 lo resuelve **en la base** desde `reglaAnteriorId`. Dos pruebas de código + verificación contra el servidor real con un `taxConceptId` falseado en la URL | era de **A8** |
| **V-42** | **El banner de alertas se convirtió en un muro de 1.122 badges — y solo se veía en el navegador.** `detectarAlertasParametrizacion` emite **una alerta por municipio sin regla de ReteICA**. Cuando `municipality` tenía las ~40 filas curadas de A1 eso era una lista útil; con el catálogo DANE completo que cargó **D-086** (1.122 municipios) y las badges clicables que añadió **D-087**, `/parametros` pasó a renderizar **1.122 `<button>` con su modal cada uno**: **984 KB de HTML** en la pantalla que el contador abre a diario, y las **cuatro** alertas que sí puede resolver hoy (tabla de salarios, SMMLV, UVT, calendario) sepultadas entre mil líneas idénticas. La advertencia 17.5 pide que lo que falta **se vea**; mil líneas iguales consiguen justo lo contrario. Ninguna prueba lo detectaba porque el escenario de pruebas no carga el catálogo completo: **apareció al abrir la página contra la Neon real** | Media-alta como producto (inutiliza la pantalla principal de parametrización y anula el mecanismo de la 17.5) | **CORREGIDA por A14** en `BannerAlertas`: se **agrupa por categoría** sin ocultar nada — se listan las primeras de cada tipo y el resto se resume en una línea que dice **cuántas son** y lleva al mismo submódulo; el total real sigue en la cabecera y el modal del resumen dice cuántas quedan. **El servicio no se toca**: sigue devolviendo la verdad completa, así que la semántica normativa queda intacta. Medido contra el servidor real: **984 KB → 307 KB, 1.122 badges → 14**. Dos pruebas (con mil alertas agrupa; con pocas no cambia nada) | era de **A8**, agravado por el catálogo de **D-086** |
| **V-42-bis** | **Pendiente de decisión normativa, NO corregido por A14.** La causa raíz de V-42 es semántica: tras D-086, `municipality` es el **catálogo nacional**, no la lista de municipios en los que opera la firma. Exigir regla de ReteICA a los 1.122 —incluidos los que ningún cliente de la firma pisa— ya no significa nada. Lo razonable sería alertar solo por los municipios **en uso** (referenciados por una empresa, un tercero o con historial de retención), pero eso es una decisión normativa y de producto | Baja como riesgo inmediato (V-42 ya devolvió la pantalla a la usabilidad), media como deuda de diseño | **BLOQUEADO / pendiente**: le corresponde a **A1** (semántica del dato normativo) con **A8** (interfaz). A14 no inventa el criterio | **A1** + **A8** |
| **V-33** | **El `jsonb` de la dirección guardaba el JSON CRUDO del cliente.** `resolverDireccion` validaba `input.direccionDian` pero persistía **ese mismo objeto**, no el normalizado: un POST directo metía en `third_party.direccion_dian` claves inventadas (`malicioso: '<script>…'`, `direccion: 'IGNÓRAME'`, `complementos[].extra`) que quedaban almacenadas para siempre | Media-alta (dato de fuera persistido sin acotar, en la tabla que alimenta la exógena) | **CORREGIDA por A14**: se persiste `normalizarDireccionDian(...)`, que ahora **acota el objeto a las 11 claves del contrato**. Prueba que compara la lista exacta de claves guardadas | era de **A8** |
| **V-34** | **Se podía guardar un desglose que NO es del contrato, por coerción de tipos.** `normalizarDireccionDian` hacía `(s ?? '').toString()`: `{toString:()=>'CL'}` y `['CL']` pasaban la validación y entraban al `jsonb`. La fila resultante **ya no se podía recomponer** — `componerDireccionDian` sobre lo guardado lanzaba —, es decir, rompía la invariante que es el corazón del entregable. Y `complementos` que no fuera un arreglo **tumbaba el validador con un `TypeError`** en vez de dar un error de validación | **Alta** (fila irrecuperable + invariante rota + excepción de runtime desde entrada externa) | **CORREGIDA por A14**: solo se admite `string` (o `number`, que es inequívoco y se valida contra `^\d{1,4}$`); cualquier otra forma se trata como campo ausente, y `complementos` no-arreglo se reporta como error de validación. 14 pruebas de evasión (homoglifos, letra multicarácter, cuadrante inventado, separadores y saltos de línea en complementos) | era de **A8** |
| **V-35** | **El texto libre entraba sin dejar rastro.** El entregable afirmaba «el texto libre no entra por ningún camino», pero `crearTercero` con `direccion` y sin `direccionDian` —que es **el camino de la carga masiva de terceros** y el de un POST directo— guardaba texto libre con `direccion_requiere_revision = false`. Solo quedaban marcados los terceros anteriores a la migración: los nuevos se colaban invisibles | Media-alta (la exógena se lleva texto libre y nadie lo ve; es exactamente lo que D-086 dice evitar) | **CORREGIDA por A14**: toda dirección que no venga del desglose DIAN **nace marcada**, en crear y en editar. Con prueba | era de **A8** |
| **V-36** | **El backfill de la migración 175 dejaba fuera el caso peor.** Marcaba al tercero nacional con dirección de texto (`direccion IS NOT NULL AND btrim(…) <> ''`), pero **no** al tercero nacional **sin dirección ninguna** — los creados antes de que D-084 la hiciera obligatoria. Ese es justo el que rompe el Formato 1001, y era el único que no aparecía en ninguna lista | Media | **CORREGIDA por A14** (migración 175, PARTE B: se marca todo tercero nacional sin `direccion_dian`), con prueba que barre la tabla buscando filas nacionales sin dirección y sin marca | era de **A8** |
| **V-37** | **Editar un tercero YA normalizado con texto libre le borraba la estructura en silencio.** El `CASE WHEN … THEN false ELSE direccion_requiere_revision END` solo sabía apagar la marca: un guardado sin `direccionDian` ponía `direccion_dian = NULL`, dejaba texto libre y **conservaba la marca en `false`**. Se perdía el desglose sin que nada lo dijera | Media-alta (pérdida silenciosa de dato ya normalizado) | **CORREGIDA por A14**: el estado de la marca es función de lo que se guarda, no de lo que hubiera antes. Con prueba | era de **A8** |
| **V-38** | **Dos regresiones de interfaz de D-086.** (a) En `/terceros/nuevo`, tras cualquier error recuperable (documento repetido, municipio faltante) la acción devolvía el formulario con la dirección como **texto** y **sin** el desglose: al reenviar, el tercero se creaba con texto libre y `direccion_dian` NULL, tirando lo que el contador ya había compuesto en el modal. (b) En `/terceros/[id]`, condicionar el bloque de geografía y dirección a `!tercero.esDelExterior` en un **componente de servidor** dejó **sin salida** al tercero mal marcado como del exterior: marcar «No» no re-renderiza, guardar exige dirección y municipio, y no hay dónde ponerlos. Antes de D-086 los campos estaban siempre y el camino funcionaba | Media (una pierde trabajo del usuario; la otra hace irreparable un error de captura frecuente) | **CORREGIDAS por A14**: (a) el desglose viaja de vuelta en la redirección y la pantalla lo revalida y lo repone; (b) los campos se renderizan siempre, con `requerido` condicional — el servidor ya los anula cuando el tercero es del exterior | era de **A8** |
| V-24 | **Carrera edición ↔ publicación: se podía mutar un asiento YA PUBLICADO.** `editarAsientoBorrador` leía el estado sin bloquear la fila; con la aprobación en paralelo, el `UPDATE journal_line` caía sobre un asiento ya `posted` y ningún trigger se enteraba (el de inmutabilidad vio `draft`; el de balance calla porque la edición cuadra) | **Alta** (rompe la Regla de Oro 1) | **CORREGIDA por A14** en la compuerta de D-079 (`SELECT ... FOR UPDATE`), con prueba | era de **A7** |
| V-25 | **Un humano podía reescribir el monto/cuenta de una retención calculada por el motor.** El ledger y `retention_applied` —fuente de la exógena (1001/1003) y de los certificados— divergían para siempre, sin rastro de que alguien se apartó del motor | **Alta** (rompe las Reglas de Oro 4 y 6) | **CORREGIDA por A14** en la compuerta de D-079 (partida con `retention_applied_id` no editable, en servicio y en UI), con prueba | era de **A7** |
| V-26 | **El filtro de monto de la bandeja escondía facturas que sí había que aprobar** (formulario en pesos, comparación contra centavos). Además `?desde=` con basura tumbaba la bandeja de las 30-60 empresas, y una cuenta desactivada seguía siendo imputable desde la edición | Media (una factura que no se ve no se causa) | **CORREGIDA por A14** en la compuerta de D-079, con pruebas | era de **A7** |
| **V-23** | **Una factura rechazada por error no se recupera por ningún camino de la interfaz.** `reintegrar` bloquea (clave `causacion:<doc>` ocupada + falta la transición `rechazado → parseado`), volver a cargar el XML no hace nada (dedupe por CUFE/hash → `ya_procesado`) y archivar tampoco es reversible | **Alta como producto** (rechazar es cotidiano y aquí es definitivo). No bloquea D-079; **sí bloquea la operación real con un cliente** | **CERRADA** por A3+A2 (migración 172 + `idempotencyKeyCausacion`) y **reverificada por A14 con suite propia** (`tests/adversarial/a14-v23-ampliada.test.ts`, 30 pruebas). La verificación encontró **seis defectos** en el propio fix y en su vecindario: V-27…V-32, todos corregidos por A14 en la misma pasada | era de **A3** + **A2** |
| **V-27** | La migración 172 y `src/services/bandeja.ts` afirmaban que «el índice `journal_entry_causacion_viva_uq` impide el duplicado real». **Ese índice no existía en ninguna migración.** El invariante «a lo sumo un asiento de causación vivo por documento» lo sostenía solo la aritmética de la aplicación, y la afirmación falsa quedaba en documentación durable que otro agente leería como cierta | Media (no había fuga medible, pero contradice el principio «la garantía la pone el motor» y envenena la documentación) | **CORREGIDA por A14** (migración 173: índice único parcial real), con prueba que ataca la tabla directamente saltándose todo el servicio | era de **A3/A2** |
| **V-28** | **Una NOTA CRÉDITO rechazada por error seguía siendo irrecuperable y además rompía el worker.** `causarNotaCredito` cuelga su asiento de `reverses_entry_id`, y `journal_entry_reversa_uq` era TOTAL: no distinguía la reversa anulada de la viva. Tras reintegrar, el segundo intento moría con `23505` **no manejado**, abortando la transacción entera; el documento quedaba en `parseado` con un trabajo que falla en cada intento. V-23 **empeoró** este caso en vez de arreglarlo (antes se bloqueaba limpio) | **Alta** (un documento fiscal queda irrecuperable y la cola entra en fallo permanente) | **CORREGIDA por A14**: índice parcial `journal_entry_reversa_viva_uq` (migración 173) + `SAVEPOINT`/`catch` de `UNIQUE_VIOLATION` en `causarNotaCredito`, que nunca lo tuvo pese a que `causarFactura` lo recibió en D-043. Con prueba de punta a punta y con prueba de que dos reversas VIVAS siguen prohibidas | era de **A3** |
| **V-30** | **El certificado de retenciones y la exógena reportaban el DOBLE tras un reproceso.** `retencionesPorTercero` (A9), `retencionesPorTerceroYTipo` y `autorretencionPorTercero1003` (A11) leen `retention_applied` **sin atarlo al ledger publicado**. Tras un reproceso quedan dos juegos de filas `aplicada = true` (el del asiento anulado y el del vivo). A14 lo midió: **$44.000 certificados sobre una retención real de $22.000** | **Alta** (el certificado es un documento legal que se entrega al proveedor; la exógena se presenta a la DIAN) | **CORREGIDA por A14**: las tres consultas descartan toda fila atada a un asiento que no está `posted`; `retencionesPorPeriodo` descarta las de asientos anulados y conserva los borradores por su función diagnóstica. Con tres pruebas que miden la cifra | era de **A9** + **A11** (la causa raíz la destapó V-23) |
| **V-29** | Un documento que acaba en **revisión manual** por falta de período fiscal abierto o por cuenta sin configurar dejaba escritas sus filas de `retention_applied` con `journal_entry_id = NULL`: traza huérfana que ningún asiento respalda y que la reportería tributaria no distinguía de una retención real | Media (mismo canal de daño que V-30) | **CORREGIDA por A14**: las dos salidas de `causarFactura` posteriores al `SAVEPOINT` hacen `ROLLBACK TO SAVEPOINT`, y en `causarNotaCredito` el período se comprueba **antes** de escribir nada. Con prueba | era de **A6** |
| **V-31** | `reintegrarDocumentoRechazado` reventaba con `JOB_INEXISTENTE` si el documento nunca tuvo trabajo de causación — justo el caso `reproceso_numero = 0` que la función de base **contempla explícitamente**. El gate de la base aceptaba y la capa de servicio moría un renglón después | Baja (hoy solo alcanzable con datos anómalos) | **CORREGIDA por A14** (`encolarCausacion` idempotente antes de `reencolarJob`), con prueba | era de **A7** |
| **V-32** | **El resguardo `REPROCESO_BLOQUEADO` no cubría las NOTAS CRÉDITO.** El gate identificaba el asiento en conflicto con `tipo <> 'reversa'`, y el asiento de una nota es **por definición** de tipo `reversa`: una nota rechazada con su asiento todavía VIVO se reintegraba sin encontrar resistencia. A14 lo verificó empíricamente quitando el parche y viendo pasar la reintegración | Media-alta (el resguardo que V-23 declaraba «no relajado» estaba abierto de par en par para medio catálogo de documentos) | **CORREGIDA por A14** (migración 173: el predicado es `idempotency_key LIKE 'causacion:%'`, no el tipo; `listarRechazadas` espeja el mismo filtro), con prueba | era de **A3** + **A7** |
| D-030 | Revocación de sesiones cross-tenant + oráculo de actividad ajena | Alta (rompe la Regla 7 en escritura) | **CORREGIDA** por A14 (migración 017) | era de A12 |
| D-031 | `app_auth` forjaba audit_log en cualquier firma, de forma permanente | Media-alta (rompe la Regla 6) | **CORREGIDA** por A14 (migración 017) | era de A12 |
| D-034 | El harness concedía privilegios que las migraciones revocan | Media (invalida pruebas de privilegio) | **CORREGIDA** por A14 | infraestructura de pruebas |
| D-032 | `journal_line.account_id` aceptaba cuenta de otra firma (FK simple). El barrido de `pg_constraint` reveló **71 huecos del mismo patrón**, no uno | Media (integridad contable) | **CORREGIDA** por A2 (migración 018, ver D-037) | era de A2 |
| D-033 | Sin trigger `ON TRUNCATE` en ledger ni audit_log | Baja hoy (falta el privilegio), media si alguien despliega como dueño | **CORREGIDA** por A2 (migración 018) | era de A2 |
| D-023 | `app_auth` lee la credencial de cualquier correo conocido | Baja (exige credencial de infraestructura) | **ABIERTA por diseño**, alcance ahora medido y acotado | A12 / arquitectura |
| D-024 | El descenso a `app_user` es reversible en PGlite | No aplica en producción bien configurada | **ABIERTA por diseño**, invariantes comprobables ya automatizadas | **A15 al desplegar** |
| — | La secuencia `audit_log_id_seq` es global: `last_value` deja inferir el volumen de escritura de todo el sistema | Muy baja (canal lateral, sin datos) | **Aceptada**, sin acción | anotación |
| — | `user.email` y `company.buzon_email` son únicos globalmente: permiten saber si un correo está tomado | Muy baja (inherente a un espacio de nombres global de login) | **Aceptada**, sin acción | anotación |

### Hallazgos de la Ola 1 (A14)

Se numeran `V-n` para no confundirlos con las decisiones `D-n`. **Los dos que bloqueaban la Ola 1 (V-4 y
V-6) están CERRADOS**, cerrados por A1 en el commit `ffaf3db` y **reverificados por A14 con pruebas
propias**, no por reporte. El resto está corregido, acotado o declarado, y ninguno derrota ninguno de los
cuatro criterios de la compuerta.

| Id | Qué es | Gravedad | Estado | De quién |
|---|---|---|---|---|
| V-1 | `app.resolver_empresa_por_buzon` contesta a la sesión de **otra firma**: con un buzón ajeno devuelve su `company_id` y su `tenant_id`. Oráculo de existencia de buzones + divulgación de identificadores entre firmas. Está concedida a `app_user` (toda sesión de negocio), mientras el precedente que invoca (`app.buscar_credencial`) está concedido solo a `app_auth` | **Baja** — divulga identificadores, no datos: A14 midió que con ellos se leen **cero** filas y no se escribe nada (`42501`) | **ABIERTA, acotada y medida en dos pruebas.** Ver D-042 | **A12** (crear la sesión/rol de sistema del canal de correo) + **A4** (mover el `GRANT` a ese rol y revocarlo de `app_user`) |
| V-2 | La rama de "carrera detectada" de `causarFactura` moría con `25P02`: era código muerto | Baja (el invariante lo imponía el `UNIQUE`; lo roto era el manejo elegante) | **CORREGIDA por A14** (`SAVEPOINT`, D-043), con prueba de regresión que además verifica que el perdedor no deja filas huérfanas | era de **A6** |
| V-3 | El detector de la Regla de Oro 2 no cazaba umbrales **precalculados** (`if (base > 104748)`, que son 2 UVT) | Media (es la forma más natural de quemar una base mínima) | **CORREGIDA por A14** (séptima regla, D-040) | infraestructura de QA de A14 |
| V-4 | `tax_rule` no tenía **ni una fila de tipo `reteica`**: el 2‰ de Medellín existía solo en `municipality_ica_rule.tarifa_general`, y el motor amarra toda `retention_applied` a una regla con vigencia (D-017). En producción el ReteICA **no existía** | Era **alta como producto** | **CERRADA por A1** (`db/seeds/tanda2/100_reteica_medellin.sql`, commit `ffaf3db`) y **reverificada por A14**: el caso dorado 8 se causa de punta a punta **sin andamiaje**, con la tarifa copiada byte a byte de la fila de A1 y la norma encadenada que sigue citando el Acuerdo 066 de 2017. Bogotá y Cali siguen fuera — eso es V-5 | era de **A1** |
| V-5 | No hay tarifas de ICA **por actividad** para Bogotá ni Cali, porque el código municipal de Bogotá `74901` (5 dígitos, Decreto 352 de 2002) no cabe en el `CHECK` de 4 dígitos de `ciiu_activity`, que es el formato del CIIU **nacional**. Además la sección 7.5 **no trae ni un número** del Acuerdo 0321 de 2011 de Cali | Media | **ABIERTA — es el único hueco de datos que queda tras el desbloqueo, y NO bloquea la Ola 1** (D-048): lo que los casos 9 y 10 discriminan —la base municipal y la actividad que manda— está verificado con datos reales; lo que falta es la magnitud de una tarifa que el mega-prompt no aporta. A1 hizo **bien** en no truncar `74901` a `7490` | **A2** decide el esquema; **luego A1** carga lo verificable; el resto es **verificación humana** |
| V-6 | `rounding_rule` estaba **vacía**. Sin regla de redondeo el motor —correctamente— mandaba **todo** a revisión manual: con el repositorio tal como se entregaba, el producto **no calculaba ni una sola retención** | Era **alta como producto** | **CERRADA por A1** (`db/seeds/tanda2/090_rounding_rule.sql`, commit `ffaf3db`) y **reverificada por A14**: el pipeline completo produce el asiento del caso 1 sin que ninguna prueba inserte nada. El respaldo «parámetro operativo» se **acepta con criterio explícito** (D-046): la tabla no puede expresar una tarifa, el motor sigue negándose cuando el parámetro falta, y el valor por defecto es sobreescribible por datos | era de **A1** |
| V-7 | El `DocumentoNormalizado` de A4 no discrimina **AIU por línea**, así que todo concepto con `base_es_aiu` va a revisión manual por la vía de ingest | Baja (la conducta es correcta: no se inventa el AIU) | **ABIERTA, declarada.** El caso dorado 11 se prueba contra el motor, no por el canal real | **A4** (si algún proveedor lo trae en UBL) o **A7** (campo editable en la bandeja) |
| V-8 | `procesarJobCausacion` usa el municipio **del tercero** como municipio de la operación: no hay señal de "dónde ocurrió" en el documento | Baja | **ABIERTA, declarada.** El caso dorado 10 se prueba contra el motor, no por el canal real | **A7** (campo editable) |
| V-9 | No existe sesión de sistema para el canal de correo: `recibirDocumento` exige una sesión real (D-021) y el correo llega sin ninguna | Media como producto (el canal de correo no está cablead0 de punta a punta) | **ABIERTA, declarada.** No es criterio de la compuerta de la Ola 1 | **A12** (mecanismo) + **A6/A13** (quien la abre) |
| V-10 | **La costura A3↔A6 no la probaba nadie**: A3 probó el motor sin asiento, A6 probó el asiento con cero retenciones | Era el riesgo más alto de la ola | **CERRADA por A14**: prueba de punta a punta escrita y **en verde** (D-045) | — |
| — | Los 11 fixtures UBL de A4 son **construidos a mano**, no capturas de producción, y el CUFE no es criptográficamente auténtico | Media antes de producción | **Declarada por A4 y aceptada por A14 para la compuerta.** A14 amplió la cobertura con variantes hostiles propias (base64 partido en líneas de 76, XML plano en CDATA, prefijos `ns2/ns3/ns4`) y con dos ataques (**billion laughs** y **XXE**), todos superados. El riesgo residual está confinado a `validar.ts` y `extraer.ts` | **humano / A15**: conseguir un XML real de la DIAN antes de producción |



### Hallazgos de la Ola 2 (A14)

Se numeran a continuación de los de la Ola 1. **Ninguno bloquea la compuerta**: los tres que podían
hacerlo están corregidos por A14 en esta misma pasada, y el que queda abierto (V-11) es una **fragilidad
de despliegue** que no derrota ningún criterio con la cabecera estándar puesta.

**Estado de los hallazgos heredados de la Ola 1 al cerrar la Ola 2:**

| Id | Estado al cerrar la Ola 2 |
|---|---|
| V-1 | **SIGUE ABIERTA, y ahora DESBLOQUEADA.** A13 **no** tocó el `GRANT` de `app.resolver_empresa_por_buzon` (verificado por A14 en `db/migrations/032`), e hizo bien: `src/ingest/persistencia.ts` (A4) todavía la usa. La precondición que D-042 exigía —que existiera un rol/sesión de sistema para el canal de correo— **ya se cumple** (D-054). Le toca a **A4 + A12** |
| V-5 | **SIGUE ABIERTA.** Nada de la Ola 2 la toca. `A2` decide el esquema del código de actividad municipal; luego A1 carga lo verificable |
| V-7 | **CERRADA por A7** (`document_correction`, migración 070). A14 la reverificó **solo por ejecución** de la prueba de A7, que sí es de punta a punta por el canal real (sin AIU va a revisión manual; corregido y reencolado, causa sobre el AIU). No hay prueba propia de A14 para esta: deuda menor anotada, no bloqueante |
| V-8 | **CERRADA por A7**, misma condición que V-7 (municipio del tercero sin ReteICA; corregido a Medellín, causa con la tarifa real de A1) |
| V-9 | **CERRADA por A13**, verificada por A14 punto por punto (D-054) sin creerle al reporte: no rodea D-020/D-021, la tabla de credenciales está tan cerrada como `app.session_context`, autenticar es exclusivo de `app_auth` (`42501` para `app_user`) y el rol de sistema tiene exactamente dos permisos |

**Hallazgos nuevos de esta pasada:**

| Id | Qué es | Gravedad | Estado | De quién |
|---|---|---|---|---|
| V-11 | **La aprobación desde la bandeja revienta con un error crudo de PostgreSQL si el despliegue no reenvía la IP del cliente.** `approval.ip` es `inet NOT NULL` (Regla de Oro 6, «desde dónde»); `aprobarAsiento` la resuelve con `COALESCE($5::inet, app.current_ip())` y A7 solo sabe leer `x-forwarded-for`. Sin esa cabecera, el contador recibe `null value in column "ip" of relation "approval" violates not-null constraint` y no aprueba nada | **Media como producto** — no es fuga ni corrupción: A14 verificó que el fallo **no deja el ledger a medias** (el asiento sigue en `draft`, cero aprobaciones huérfanas) y que el usuario sí se entera. Con la cabecera puesta —lo estándar detrás de cualquier proxy— el criterio de salida pasa completo | **ABIERTA, declarada y medida** en `compuerta-ola2-interfaz.test.ts` («7) V-11 …») | **A7** (leer también `x-real-ip` y, si no hay ninguna, dar un mensaje accionable en vez de propagar el error del motor) + **A15** (garantizar la cabecera en el despliegue). **A6** puede además comprobar el invariante explícitamente antes de insertar |
| V-12 | **`aprobarAsientosEnLote` no tenía `SAVEPOINT`: su `catch` por ítem era decorativo.** Un error del motor en cualquier ítem abortaba la transacción y todos los siguientes morían con `25P02`. Una sola fila rancia se llevaba por delante el resto del lote — justo en el criterio «aprobar 50 de un golpe» | **Media-alta como producto** (derrotaba el tercer criterio de salida en el escenario más común: dos contadores con la misma bandeja abierta) | **CORREGIDA por A14** (D-050), con prueba de regresión que se verificó **desactivando** la corrección | era de **A6** |
| V-13 | **El acotamiento de A8 al detector de la Regla de Oro 2 sí perdía cobertura real.** Cuatro valores tributarios —base mínima en UVT, múltiplo de redondeo, día de calendario y una tarifa escrita como división— pasaban intactos por `src/`, y los cuatro los cazaba la regla antes del cambio | **Media** (es infraestructura de QA: no rompe nada hoy, pero deja de avisar mañana) | **CORREGIDA por A14** (D-049): salvaguarda restituida con la forma «solo parámetros ligados en un INSERT normativo de `src/`/`app/`», con canario propio y verificada inyectando veneno en el archivo real | infraestructura de QA de **A14**, hueco abierto por **A8** |
| V-14 | **El canario había dejado de ejercitar `insert_normativo`.** Al acotar la regla, las muestras del veneno dejaron de pasarle la ruta del archivo, así que la regla devolvía `false` para todas: la muestra que existía para ella la cazaba `fraccion` | **Baja** (una regla sin canario es una regla que nadie sabe si sigue viva) | **CORREGIDA por A14** (D-049): las muestras declaran su ruta y se añadió una que **solo** esa regla puede cazar | infraestructura de QA de **A14** |
| — | La bandeja consolidada abre **una transacción por empresa, en secuencia** (declarado por A7). A14 lo midió con 31 empresas accesibles: la pantalla completa tarda ~0,7 s en PGlite. No es un defecto hoy; es el techo conocido | Muy baja | **Aceptada**, con el número medido | anotación para **A15** |


---

### Hallazgos de la Ola 3 (A14)

Se numeran a continuación de los de la Ola 2. **Uno bloquea la ola (V-16)** y no es un defecto de
cálculo: es que lo construido no tiene por dónde entregarse. Otro era un defecto real del ledger y está
**corregido en esta misma pasada** (V-15).

**Estado de los hallazgos heredados al cerrar la verificación de la Ola 3:**

| Id | Estado tras la Ola 3 |
|---|---|
| V-1 | **SIGUE ABIERTA.** Nada de la Ola 3 la toca. Le toca a **A4 + A12** |
| V-5 | **SIGUE ABIERTA.** Nada de la Ola 3 la toca (no hay tarifas de ICA por actividad para Bogotá ni Cali) |
| V-11 | **SIGUE ABIERTA** (la IP del cliente en la aprobación desde la bandeja). **A7 + A15** |
| D-023 / D-024 | Sin cambios: abiertas por diseño, con su alcance medido |

**Hallazgos nuevos de esta pasada:**

| Id | Qué es | Gravedad | Estado | De quién |
|---|---|---|---|---|
| V-15 | **El cierre de resultados duplicaba la cancelación si los rangos se solapan.** `idempotency_key` (`cierre:<desde>:<hasta>`) impide repetir el **mismo** ejercicio, pero no dos rangos **solapados**: como `saldosACerrar` excluye a propósito los asientos de tipo `cierre` —para poder ser repetible—, un segundo cierre de 15-jun→30-jun después de uno de 01-jun→30-jun vuelve a ver los mismos ingresos y los cancela otra vez. Medido por A14 antes del arreglo: la cuenta de ingresos quedaba con **saldo débito** y el resultado del ejercicio en **cero**; y como el ledger es inmutable, deshacerlo obliga a una reversa | **Media-alta como producto** (corrompe el resultado del ejercicio en silencio, en el escenario natural de «cerré el semestre y luego cierro el año») | **CORREGIDA por A14** (D-058): `CierreSolapadoError` rechaza el solape **antes de escribir nada**, leyendo el rango de la propia clave de idempotencia del asiento publicado. Prueba de regresión que además verifica que el intento rechazado no deja ni un borrador huérfano | era de **A10** |
| V-16 | **No existía ninguna forma de descargar un reporte.** Los veinte libros de la ola (8 de A9, 5 de A10, 7 de A11) no los invocaba ni una ruta de Next, ni una acción de servidor, ni una pantalla: **cero** importadores de `src/reports/` fuera de `tests/`. El criterio de salida dice «todo reporte **se descarga** en Excel», y la §11.1 que «un reporte que solo se ve en pantalla no sirve» — esto ni siquiera se veía en pantalla | **Alta como producto. BLOQUEÓ la Ola 3** en la primera pasada | **CERRADA por A9** (`app/api/reportes/[libro]/route.ts` + `app/reportes/page.tsx`, commit `0e28054`) y **reverificada por A14 atacando la ruta**, no leyendo el reporte: los veinte slugs sirven un `.xlsx` que se reabre con las cuatro hojas, ningún generador quedó huérfano sin slug (prueba que enumera los exports de `src/reports/` y exige que los veinte estén cableados), y la ruta resiste los nueve ataques de la tabla del veredicto | era de **A9** + **A8** |
| V-17 | **No hay forma de crear ni editar un tercero.** El esquema de A2 está bien (`third_party` tiene `direccion`, `municipality_id` y `codigo_dane`), pero no existe ni un `INSERT INTO third_party` en `src/`, `app/` ni migraciones: solo en los fixtures de prueba. A11 lo detectó como bloqueo del Formato 1001 (dirección y municipio del informado, art. 1.3.5.2.1 Res. 000227/2025); **A14 lo amplía**: como `src/services/ingest.ts` resuelve el tercero por NIT y **no lo crea**, una factura de un proveedor no cargado a mano por SQL tampoco se puede causar. Hoy no se puede poner en marcha un cliente nuevo sin acceso directo a la base | **Media-alta como producto** (impide el arranque real de una empresa cliente), **baja como riesgo** (no hay fuga ni dato inventado: A11 hizo lo correcto dejando las celdas vacías y listándolas en la hoja «Bloqueos») | **ABIERTA, declarada y medida.** No bloquea la compuerta de la Ola 3 por sí sola: el criterio en disputa es la descarga | **A8** (maestro de terceros, con dirección y municipio obligatorios o advertidos). A2 no tiene nada que corregir |
| V-18 | **Las advertencias de alcance de los formatos 1003 y 1006 no llegan al Excel.** Van en el objeto devuelto y en la cabecera del archivo plano, pero **no** en el libro, que es el que el contador revisa. El 1001 sí tiene su hoja «Bloqueos»; estos dos no tienen su hoja «Advertencias» | **Baja** (la limitación está declarada y el dato no se inventa; lo que falla es dónde se avisa) | **ABIERTA, declarada** | **A11** |
| V-19 | **Un slug igual a una clave del prototipo de `Object` no daba 404 sino 500.** `REPORTES[libro]` resolvía por la cadena de prototipos: `__proto__` devolvía un objeto truthy que no es un generador —se saltaba el 404 y reventaba abajo con un 500 que expone un mensaje interno— y `constructor` llegaba a **llamar** a `Object` como si fuera el generador. Encontrado por A14 atacando la ruta nueva con nueve slugs envenenados | **Baja**: no hay fuga (la sesión y el permiso se exigen antes y la RLS sigue puesta) ni escritura; es manejo de errores y divulgación de un mensaje interno | **CORREGIDA por A14** (D-061): `Object.hasOwn(REPORTES, libro)`. Las nueve muestras quedan como regresión, y la prueba informa **todas** las que fallen, no solo la primera | era de **A9** |
| — | **Sin estadísticas del planificador, un JOIN bajo RLS crece cuadráticamente.** Medido por A14 en PGlite: `journal_line ⋈ journal_entry` bajo RLS tarda 10 s con 2.000 partidas, 39 s con 4.000 y 159 s con 8.000; tras `ANALYZE`, **4 ms**. No es la RLS (la misma consulta sin JOIN va en 3 ms bajo RLS) ni la vista de A9: es el planificador estimando sobre tablas sin estadísticas y cayendo en bucle anidado | Muy baja en producción (autovacuum mantiene las estadísticas), **alta justo después de una carga masiva** | **Aceptada, con el número medido y anotada en la prueba** | anotación para **A15**: ANALIZAR después de una carga masiva de documentos |
| — | El archivo plano de exógena lleva líneas de cabecera que empiezan por `#` (la advertencia de layout no verificado). Ningún prevalidador de la DIAN acepta comentarios: **el archivo de hoy es un borrador de revisión, no un archivo presentable**. Es coherente con que los códigos numéricos del anexo técnico estén sin verificar (advertencia 17.5), pero conviene no confundirlo | Baja | **Aceptada mientras el layout siga sin verificar** | **A11** cuando se verifique el anexo técnico; **verificación humana** para el anexo |


---

## Compuerta del lote posterior a la Ola 3 — veredicto de A14 (2026-08-31)

**Lote verificado:** V-17 (A8, maestro de terceros), V-18 (A11, advertencias en el Excel), arranque del
sistema + repaso de la sección 14.1 (A12), datos de ejemplo (A1), entorno/ANALYZE/despliegue (A15).
Estado del repositorio al empezar: `7d6a133`, 902 pruebas.

**Veredicto: LOTE APROBADO.** Los tres criterios de compuerta pasan con las correcciones de A14
incorporadas: `npm test` **914 en verde** (45 archivos), `npm run typecheck` limpio, `npx next build`
exit 0 (19 rutas). Nada se dio por bueno por reporte ajeno: todo lo de abajo se ejecutó.

### Cómo se verificó (harness, para que se pueda repetir)

No había PostgreSQL ni Docker en la máquina. A14 levantó **PGlite servido por el protocolo de cable de
Postgres** (`@electric-sql/pglite-socket`, instalado en el scratchpad, **nunca** como dependencia del
proyecto) y apuntó `DATABASE_URL` ahí, para que los comandos —que son procesos Node distintos—
compartieran de verdad la misma base. **Limitación del adaptador, no del producto:** admite una sola
conexión a la vez, así que para recorrer las pantallas hubo que bajar temporalmente `max: 5` a `max: 1`
en `src/db/client.ts`; **ese cambio se revirtió** y no forma parte de la entrega.

### La secuencia del README, corrida como la correría el usuario

Sobre una base **vacía**, en el orden exacto del README y con los valores de ejemplo del propio README:

| Paso | Resultado |
|---|---|
| `npm run migrate` | 36 migraciones aplicadas + `ANALYZE`. Mensaje final claro |
| `npm run seed` | 19 archivos de seed. Ni un dato de demostración |
| `npm run arranque -- --firma-nit=... --firma="Mi Firma Contable SAS" ...` | Firma, empresa, usuario y acceso creados. Contraseña impresa una sola vez. **Las comillas de PowerShell/npm sobreviven**: la razón social quedó completa en la base, no truncada en la primera palabra |
| `npm run datos-ejemplo` | 5 terceros, 2 conceptos, 3 memorias y **3 facturas causadas**, las tres en borrador `pendiente_aprobacion` |
| `npm run dev` + inicio de sesión real | `/entrar` 200; `/` sin sesión → 307; con la cookie de sesión: `/`, `/bandeja`, `/terceros`, `/parametros` y `/reportes` responden **200**. La bandeja muestra las tres facturas con su valor y su estado; `/terceros` muestra los cinco terceros |
| `GET /api/reportes/libro-mayor` con sesión | **200**, `.xlsx` real de 9.869 bytes |

**Los tres asientos de ejemplo son exactamente los que A1 declaró**, verificados contra
`retention_applied` y `journal_line`, y **reproducidos idénticos** en una segunda base limpia después de
aplicar la migración de V-20:

| Factura | Retenciones | Asiento |
|---|---|---|
| Bogotá — Consultores Andinos SAS (PJ declarante) | Retefuente 4% = $40.000 · ReteIVA 15% = $28.500 | 5 partidas, saldo 0, `draft` |
| Medellín — María Fernanda Ríos (PN **no** declarante) | Retefuente **6%** = $60.000 · ReteICA 2‰ = $2.000 | 4 partidas, saldo 0, `draft` |
| Cali — Comercializadora del Pacífico SAS | **Sin retefuente** (base $80.000 < $104.748, motivo persistido y citando la norma) · ReteIVA $2.280 | 4 partidas, saldo 0, `draft` |

**Ninguno queda aprobado ni publicado.** La aprobación sigue siendo humana.

**Defecto de instructivo: ninguno bloqueante.** Dos asperezas menores, anotadas, no bloqueantes:
`--env-file-if-exists` imprime *«.env.local not found. Continuing without it.»* dos veces en cada
comando (ruido para quien no programa), y el arranque reejecutado termina diciendo «entre con ese correo
y esa contraseña» aunque en ese camino no imprimió ninguna. **La fricción real está documentada y es
correcta:** sin `DATABASE_URL` cada comando vive en su propia base desechable, y el README lo explica
con el ejemplo exacto en su sección 1.

### Los ocho puntos del encargo, uno por uno

| # | Punto | Veredicto |
|---|---|---|
| 1 | **Arranque de A12: las cuatro afirmaciones** | **CONFIRMADAS, las cuatro, atacándolas.** (a) *No crea vía de confianza nueva*: es un CLI bajo `withAdminContext`, exige la misma credencial superusuario/BYPASSRLS que `migrate`; cero superficie de red. (b) *No emite sesión ni cookie*: no hay una sola llamada a `abrirSesion` en `src/bootstrap/arranque.ts`; el usuario entra por `iniciarSesion`. (c) *Idempotente por NIT y correo*: reejecutado, «ya existía, sin tocar» en las cuatro filas. (d) *Jamás reescribe la contraseña*: reejecutado **con una contraseña intrusa** — la original sigue siendo la única válida y la intrusa es rechazada. Además: **adoptar el correo de otra firma se aborta** («un usuario nunca cambia de firma»). Y el `current_tenant_id()` sale **del token verificado**: dos firmas creadas por el mismo comando, cada sesión ve su propio tenant, y **fijar `app.tenant_id`/`app.company_id` a mano dentro de la transacción no cambia nada** (sigue viendo 1 empresa, la suya) |
| 2 | **Los dos huecos de auditoría** | **CERRADOS Y VERIFICADOS POR EL LADO HOSTIL.** Se descargó el libro mayor por HTTP y quedó **una** fila `EXPORT` en `audit_log` con reporte, empresa, usuario, `db_user`, IP, agente y parámetros. La prueba fuerte: se **revocó** `EXECUTE` sobre `app.registrar_exportacion` (a `PUBLIC` y a `app_user`) y la misma descarga devolvió **500 sin un solo byte de archivo** — «exportar sin auditar» no es un estado alcanzable, porque el rastro va en la misma transacción que la lectura. `third_party` audita: sus `INSERT` aparecen en `audit_log`. Y `app/api/reportes/[libro]/route.ts` es el **único** importador de `src/reports/` fuera de `tests/` |
| 3 | **La partición de `tercero.editar`** | **BIEN IMPUESTA, en el motor y sobre la fila resultante.** Con usuarios reales de cada rol: el auxiliar **sigue creando terceros** (V-17 no se rompió); el auxiliar es rechazado con `SE002` al registrar atributos fiscales **y** actividad; el contador registra actividad pero es rechazado al fijar `tarifa_ica_override`, **tanto por `INSERT` como por `UPDATE`** (el trigger mira `NEW.tarifa_ica_override`, no el verbo); el administrador tributario sí puede; solo lectura no puede ni crear el tercero. El reparto en `role_permission` coincide exactamente con lo declarado |
| 4 | **D-014: ningún atributo fiscal asumido** | **HUECO REAL ENCONTRADO — V-20, corregido por A14.** Las tres capas de A8 (tipo, servicio, HTML) son todas de aplicación y funcionan: el servicio rechaza con `AtributoFiscalIncompletoError`. Pero por SQL directo bajo `app_user`, con el permiso legítimo, **la base rellenaba ocho de las nueve banderas y el régimen** por `DEFAULT`. Ver la ficha de V-20 |
| 5 | **V-18: las cuatro hojas obligatorias** | **PASA.** La comprobación es de A14 y **A11 no la tocó**: los **veinte** libros, con round-trip real a `.xlsx`, siguen teniendo `['Datos','Papel de trabajo','Trazabilidad','Parámetros']` como las cuatro primeras hojas y el mismo número de hojas al releer. `activeTab` **no reordena**: solo selecciona la pestaña |
| 6 | **Los datos de ejemplo no contaminan** | **PASA.** `src/db/seed.ts` recorre `DEFAULT_SEEDS_DIR = db/seeds` y nada más; `db/demo/` solo lo lee `src/bootstrap/datos-ejemplo.ts`. Demostrado en vivo: `npm run seed` aplicó 19 seeds y **cero** terceros de ejemplo; los terceros y las facturas aparecieron solo tras `npm run datos-ejemplo`. La guarda `--forzar-agente-retencion` existe y es real: sin ella el comando no enciende `es_agente_retencion_iva/ica` de una empresa que ya tiene terceros propios |
| 7 | **El worker y el `ANALYZE`** | **PASA, verificado en vivo, no por lectura.** Se encoló una factura **sin** drenar la cola (estado `pendiente`), se levantó `npm run dev` y **el propio proceso web la procesó**: `document_processing_job.tomado_por = "web-25000"` (el patrón `web-${process.pid}` de `worker-host.ts`), estado `completado`, y el asiento nuevo apareció. El hueco que A15 describe era real y está cerrado. El `ANALYZE` de los cuatro CLI es una sentencia suelta que solo toca estadísticas del planificador: los importes de las tres facturas de ejemplo salieron **idénticos** en las dos bases |
| 8 | **El detector, reenvenenado** | **A15 NO tocó la salvaguarda** (`tests/adversarial/valores-tributarios.test.ts` no cambia desde `39603ab`, commit del propio A14) y su rediseño con enteros es legítimo. Reenvenenado contra los módulos nuevos: `src/bootstrap/` **sí lo caza** (`0.04` y `52374 * 2`, cinco reglas disparadas). `instrumentation.ts` **NO lo cazaba** → V-21, corregido por A14 |

### Vulnerabilidades de esta pasada

| Id | Qué es | Gravedad | Estado | De quién |
|---|---|---|---|---|
| V-20 | **La base de datos inventaba ocho de las nueve banderas fiscales de un tercero.** `third_party_fiscal_attribute` nació en la migración 005 con `DEFAULT false` en `es_autorretenedor_renta`, `es_gran_contribuyente`, `es_regimen_simple`, `es_responsable_iva`, `es_agente_retencion_renta/iva/ica`, `es_autorretenedor_ica`, y `DEFAULT 'ordinario'` en `regimen_tributario`. Solo `es_declarante_renta` —el caso que D-014 nombra— quedó sin valor por omisión. A14 lo comprobó por el camino que A8 no cubrió: un `INSERT` directo bajo `app_user` con el permiso legítimo `tercero.atributos_fiscales`, omitiendo ocho columnas, **grabó la vigencia con los ocho valores inventados**. `es_responsable_iva = false` suprime el ReteIVA; `es_regimen_simple = false` descarta el tratamiento del caso dorado 13 | **Media-alta.** No hay fuga ni corrupción del ledger, y las tres capas de aplicación de A8 tapan el camino de la interfaz. Lo grave es de qué clase es: es exactamente la advertencia 17.5 —«un valor inventado es peor que uno faltante: el faltante se ve, el inventado no»— pero impuesta (o no) por el motor, que es donde el proyecto pone el resto de sus invariantes | **CORREGIDA por A14** (`160_a14_v20_atributos_fiscales_sin_default.sql`): se quita el `DEFAULT` de las diez columnas; siguen `NOT NULL`, así que omitir una falla con `23502` en vez de suponer. **12 pruebas de regresión** en `tests/adversarial/evasion.test.ts`: una por columna omitida (todas rechazadas por PostgreSQL, no por TypeScript), el barrido del catálogo, y el control positivo de que declarándolas todas el `INSERT` pasa. Las tres llamadas de prueba que se apoyaban en el `DEFAULT` ahora declaran las nueve **a la vista** | el `DEFAULT` era de **A2** (mig. 005); la afirmación de «tres capas» era de **A8** |
| V-21 | **El detector de la Regla de Oro 2 no barría el código ejecutable de la raíz del repositorio.** `DIRECTORIOS = ['src','app','db/migrations']` dejaba fuera todo archivo `.ts`/`.mjs` de la raíz. Hasta este lote no había ninguno; A15 introdujo el primero (`instrumentation.ts`, el hook que Next.js ejecuta en cada arranque del servidor) y `next.config.*` entra por la misma puerta. Demostrado envenenando `instrumentation.ts` con `const TARIFA_SERVICIOS = 0.04` y `const UVT_2026 = 5237400`: **el detector no vio nada** | **Baja hoy** (no hay ningún valor tributario ahí), **alta como infraestructura**: una salvaguarda con un punto ciego deja de avisar exactamente donde nadie mira | **CORREGIDA por A14**: `recolectarRaiz()` barre la raíz sin recursión, saltando ocultos y `next-env.d.ts`. Verificado reenvenenando: ahora **sí** lo caza (tres hallazgos, cinco reglas), y limpio vuelve a 42/42. Se añadió la aserción de cobertura `expect(...).toContain('instrumentation.ts')`, para que sacarlo del barrido tumbe la prueba | infraestructura de QA de **A14**; el punto ciego lo destapó **A15** |
| V-22 | **`npm run dev` reescribe `CLAUDE.md`.** Next.js 16 inyecta por su cuenta un bloque `BEGIN:nextjs-agent-rules` dentro de `CLAUDE.md` en cada arranque del servidor de desarrollo (`node_modules/next/dist/server/lib/generate-agent-files.js`) y el texto que inserta **invita a comitearlo**. `CLAUDE.md` es el archivo de reglas del proyecto: que una dependencia lo modifique sola es una escritura no pedida sobre la fuente de instrucciones, y además le ensucia el `git status` a quien sigue el paso 2.7 del README sin saber programar. A15 lo detectó y lo revirtió a mano, pero no lo desactivó | **Baja como riesgo técnico**, **no despreciable como integridad**: el contenido de `CLAUDE.md` deja de estar bajo control de quien lo escribió | **CORREGIDA por A14**: `next.config.ts` con `agentRules: false`, comentado con el motivo. Verificado: `npm run dev` con esa configuración deja `CLAUDE.md` **intacto** (`git status` limpio) y `npx next build` sigue en exit 0 | era de **A15** |

### Observaciones que NO son vulnerabilidades, pero quedan asignadas

- **`company.es_agente_retencion_renta` nace en `true` y las de IVA/ICA en `false`** (defecto del esquema
  002, hallazgo que **A1 dejó anotado** y no tocó). Es una postura tributaria asumida para una empresa
  recién creada. A14 **no lo corrige** aquí porque, a diferencia de los atributos del tercero, es
  configuración de la propia empresa que el operador conoce; pero es la misma familia que V-20 y merece
  decisión explícita. **A2 + A12.**
- **`app.registrar_exportacion` conserva el `EXECUTE` de `PUBLIC`** que Postgres otorga al crear la
  función (la migración 140 solo añadió el `GRANT` a `app_user`). No es una elevación —la función no es
  `SECURITY DEFINER` y exige `reporte.exportar` dentro— y es el mismo patrón que ya tienen
  `app.exigir_permiso` y `app.registrar_acceso_denegado`, pero se aparta del `REVOKE ALL ... FROM PUBLIC`
  con el que se blindó `app.abrir_sesion`. **A12**, si quiere uniformar la higiene.
- **`datos-ejemplo` abre una sesión real del administrador** (`abrirSesion`, 8 h) para escribir bajo RLS
  en vez de por `withAdminContext`, lo cual es **lo correcto**; pero esa sesión queda viva y no se
  revoca al terminar el comando. Sin consecuencia práctica (el token muere con el proceso y la base solo
  guarda su `sha256`). **A1**, si quiere cerrarla al salir.
- **Nada impide que un seed de demostración acabe en `db/seeds/`.** La separación de A1 es correcta por
  construcción, pero no hay una prueba que la ate como sí la hay para «los seeds son datos, no código».
  **A14** en una pasada futura.

### Los 20 casos dorados, uno por uno (reejecución de esta pasada)

Ejecutados **todos**, no una muestra: `tests/golden/casos-dorados.test.ts` (26 pruebas: los 20 casos más
seis variantes hostiles) + `tests/golden/caso19-memoria.test.ts` (8 pruebas) = **34 en verde, cero
fallos**, más las 42 del detector de la Regla 2. Los casos 1, 2, 3, 8, 15, 17, 18 y 20 se reverificaron
**además** contra un PostgreSQL real, fuera del harness de pruebas.

| # | Veredicto de esta pasada | Evidencia |
|---|---|---|
| 1 | **PASA** | Retefuente $40.000 + ReteIVA $28.500. **Reproducido fuera del harness**: es la factura de Bogotá de los datos de ejemplo, con las mismas cifras al centavo en dos bases limpias distintas |
| 2 | **PASA** | Retefuente **6%** = $60.000 con `tax_rule_id` distinta. **Reproducido fuera del harness** (María Fernanda Ríos, PN no declarante) |
| 3 | **PASA** | No retiene bajo $104.748 y el motivo queda escrito. **Reproducido fuera del harness**: la factura de Cali persiste el motivo citando el Decreto 572/2025 y la base mínima en UVT y en pesos |
| 4 | **PASA** | No retiene bajo $523.740, con motivo persistido |
| 5 | **PASA** | $15.000, auditado contra su fila de `tax_rule` |
| 6 | **PASA** | $22.000 desde el primer peso, con base mínima 0 **como dato**, no como excepción de código |
| 7 | **PASA** | Inmueble no retiene; mueble por el mismo valor sí ($16.000) |
| 8 | **PASA** | ReteICA 2‰ en Medellín. **Reproducido fuera del harness**: $2.000 sobre $1.000.000, norma «Acuerdo 066 de 2017 (Medellín)» |
| 9 | **PASA en lo que discrimina** | Base de servicios de Cali $157.122 frente a $785.610 de Medellín. La magnitud de la tarifa por actividad sigue en **V-5** (dato normativo faltante, no inventado) |
| 10 | **PASA** | Aplica la actividad ejercida **en Cali**, no la de Bogotá; más la variante de dos actividades en el mismo municipio |
| 11 | **PASA** | La base es el **AIU** ($500.000), no el total |
| 12 | **PASA** | ReteIVA al 100%; y sin regla de exterior parametrizada el motor manda a revisión en vez de inventar |
| 13 | **PASA** | Régimen SIMPLE: sin política parametrizada el motor **no decide** |
| 14 | **PASA** | Retención por concepto y agregada; trocear un concepto en dos líneas **no** esquiva la base mínima |
| 15 | **PASA** | Reversa proporcional por asiento nuevo. **Reforzado fuera del harness**: sobre un asiento publicado de verdad, `UPDATE`, `DELETE`, `UPDATE`/`DELETE`/`INSERT` de partidas y `TRUNCATE` fallan todos con `LG001`, y el asiento queda idéntico (4 partidas, saldo 0, descripción intacta) |
| 16 | **PASA** | Manda la fecha del hecho económico, con el borde exacto 30-jun / 1-jul |
| 17 | **PASA** | Cambio de tarifa con vigencia futura: lo publicado no cambia y lo nuevo usa la tarifa nueva. Ningún módulo de este lote reabre la puerta: los reportes son de solo lectura y el arranque y los datos de ejemplo no escriben en `tax_rule` |
| 18 | **PASA** | Diez pasadas de la cola, un solo asiento, la misma fotografía las diez. **Reforzado fuera del harness**: reingerir el mismo XML no crea un segundo documento (deduplicación por hash/CUFE) |
| 19 | **PASA** | Segunda factura del mismo proveedor con la misma descripción escrita distinta → `origen = 'memoria'`, **`llamadasLlm = 0`**, `costoMicrosUsd = 0`, la mina de D-052 intacta y `globalThis.fetch` sin una sola llamada. Con **otro** proveedor sí vuelve a preguntar: la memoria no se contagia |
| 20 | **PASA** | **Reverificado fuera del harness con dos firmas creadas por el arranque**: desde la sesión de la firma A, `company`, `tenant`, `third_party`, `journal_entry`, `journal_line`, `source_document`, `audit_log`, `retention_applied`, `approval`, `"user"` y `user_company_access` devuelven **solo lo propio**; la empresa de B por id → **0 filas**; asientos de otro tenant → **0 filas**; pedir la empresa de B como `companyId` → `EmpresaNoAutorizadaError` con rastro `ACCESO_DENEGADO`; y **fijar `app.tenant_id`/`app.company_id` a mano dentro de la transacción no mueve una sola fila** |

**Pruebas adicionales de integridad de la §12, reejecutadas contra PostgreSQL real:**

| Prueba | Resultado |
|---|---|
| Grep de literales con pinta de tarifa o UVT en el código fuente | **Cero hallazgos** en `src`, `app`, `db/migrations` **y ahora la raíz** (42 pruebas del detector). Verificado que el detector sigue vivo inyectando veneno en dos módulos nuevos |
| `UPDATE`/`DELETE` sobre asiento publicado | **Falla en la BD** (`LG001`), en las cinco variantes, incluido `TRUNCATE` |
| Inserción de asiento desbalanceado | **Falla en la BD** (`LG002`, «descuadra en 1 centavos») al publicar; nada persiste |
| Consulta de un tenant desde la sesión de otro | **Cero filas**, por RLS, en las once tablas probadas |
| Reprocesar la misma factura 10 veces | Asiento **idéntico** las diez |
| Cambiar una tarifa en parametrización | No altera asientos publicados; sí aplica a hechos posteriores a la nueva vigencia |
| Segunda factura del mismo proveedor con la misma descripción | **Cero llamadas al LLM** |

### Hallazgos heredados: estado tras este lote

| Id | Estado |
|---|---|
| V-1 | **CERRADA** desde `19237ec` (revocado el GRANT de más sobre `resolver_empresa_por_buzon`). No se reabrió |
| V-5 | **SIGUE ABIERTA.** Faltan las tarifas de ReteICA por actividad de Bogotá y Cali. A1 hizo lo correcto: no las inventó, y los datos de ejemplo **no** encienden ReteICA en esos dos municipios para no simular un cálculo que no existe. **Verificación normativa humana** |
| V-11 | **SIGUE ABIERTA** (la IP del cliente en la aprobación desde la bandeja). **A7 + A15** |
| V-17 | **CERRADA por A8** y verificada por A14 (crear y editar tercero desde `/terceros`, con dirección y municipio exigidos). La afirmación de «tres capas independientes» era falsa en la capa que faltaba: ver **V-20** |
| V-18 | **CERRADA por A11** y verificada por A14: las cuatro hojas obligatorias siguen siendo las cuatro primeras en los veinte libros y `activeTab` no reordena nada |
| D-023 / D-024 | Sin cambios: abiertas por diseño, con su alcance medido |
| MFA sin pantalla de inscripción · prueba de restauración de respaldos · simulacro de incidente · revisión jurídica | **Siguen pendientes**, tal como A12 las declaró. **A12** (interfaz de MFA), **A15** (restauración), **verificación humana** (jurídico) |

---

## Convenciones establecidas

**Estructura de carpetas**

```
db/migrations/NNN_nombre.sql   Migraciones SQL numeradas, inmutables una vez aplicadas
db/seeds/                      Datos paramétricos (A1). Datos, nunca código
db/demo/                       Datos de EJEMPLO (A1). NUNCA los carga `npm run seed`; solo `npm run datos-ejemplo`
src/bootstrap/                 Arranque del sistema y datos de ejemplo (A12/A1). Solo CLI, nunca HTTP
src/domain/                    Motor de reglas, tipos de dominio. Sin I/O
src/services/                  Casos de uso y transacciones (A6)
src/ingest/                    Correo + parser UBL 2.1 (A4)
src/ai/                        Clasificación LLM + memoria (A5)
src/reports/                   Libros, Excel, estados financieros, exógena (A9/A10/A11)
src/db/                        Cliente, runner de migraciones, contexto de sesion (A2 + A12)
src/auth/                      Contrasenas, TOTP, cifrado, sesiones, permisos (A12)
app/                           Next.js App Router: UI y route handlers
app/globals.css                Tokens de diseño: paleta y tipografía aprobadas, una sola vez (D-074)
instrumentation.ts             Hook de arranque de Next: lanza el worker de la cola (A15)
postcss.config.mjs             Engancha Tailwind v4. No hay `tailwind.config`: en v4 la config es el CSS
next.config.ts                 Configuración de Next. Hoy solo `agentRules: false` (V-22)
tests/                         Vitest. tests/golden/ = los 20 casos dorados
docs/                          Cumplimiento, ADRs, contratos de API
```

**Reglas de código**

- Idioma: identificadores de dominio en español donde el mega-prompt los nombra en español; el resto en inglés. Comentarios y UI en español (Colombia).
- SQL en snake_case. TypeScript en camelCase, tipos en PascalCase.
- Toda tabla de datos: `tenant_id` NOT NULL + `company_id` NOT NULL (salvo catálogos globales, que se declaran explícitamente como globales), RLS habilitado **y forzado**.
- Toda tabla paramétrica: `vigente_desde DATE NOT NULL`, `vigente_hasta DATE NULL`, `norma_respaldo TEXT NOT NULL`.
- Prohibido: literales numéricos tributarios en `src/` y `app/`. A14 hace grep. La única constante permitida es la lógica de resolución.
- Migraciones ya aplicadas no se editan: se agrega una nueva. El runner guarda el checksum y aborta si cambia.
- Prohibido un color escrito a mano en `app/`: se usa el token de `app/globals.css` (`var(--color-…)` o la utilidad de Tailwind). Un `#hex` suelto en una pantalla es la deuda que D-074 vino a cerrar.
- Toda columna numérica lleva cifras tabulares: `class="cifra"` (pantallas viejas) o `class="tabular-nums"` (nuevas).
- **`src/reports/` es de SOLO LECTURA sobre el ledger** (invariante de la Ola 3, verificado por A14): generar los veinte libros deja `journal_entry`, `journal_line`, `retention_applied`, `approval` y `source_document` con la misma huella exacta. Lo que escribe vive en `src/services/` (hoy, `cierre.ts`), porque escribir es un caso de uso. Si un reporte necesita escribir, no es un reporte.
- **Todo módulo nuevo de `src/` necesita un consumidor fuera de `tests/`.** El canario de inventario de A14 comprueba que el módulo está declarado, no que alguien lo use; un `grep` de importadores es lo que separa «entregado» de «alcanzable» (V-16).

**Inventario de tablas (creadas por A2 en la Ola 0)**

| Migración | Tablas |
|---|---|
| `001_fundacion.sql` | (esquema `app`, rol `app_user`, funciones de contexto y triggers genéricos) |
| `002_organizacion.sql` | `tenant`, `company`, `fiscal_period`, `"user"`, `user_session`, `permission`, `role`, `role_permission`, `user_company_access` |
| `003_catalogos_contables.sql` | `account`, `niif_mapping`, `cost_center` |
| `004_parametrizacion_base.sql` | `municipality`, `municipality_ica_rule`, `ciiu_activity`, `uvt_value`, `smmlv_value`, `rounding_rule` |
| `005_terceros.sql` | `third_party`, `third_party_fiscal_attribute`, `third_party_activity` |
| `006_reglas_tributarias.sql` | `tax_concept`, `tax_rule`, `tax_calendar` |
| `007_conceptos.sql` | `concepto_causacion`, `memoria_clasificacion`, `company_setting` |
| `008_documentos.sql` | `source_document` (+ espacio RADIAN), `extraction`, `retention_applied` |
| `009_control.sql` | `approval`, `audit_log` (+ trigger genérico de auditoría) |
| `010_ledger.sql` | `journal_entry`, `journal_line` (+ triggers de inmutabilidad y balance, `app.publicar_asiento`) |
| `011_vistas.sql` | `v_journal_entry`, `v_journal_entry_balance`, `v_third_party_vigente`, `v_user_permission` |
| `012_rls.sql` | políticas RLS de doble nivel sobre todas las tablas |
| `013_grants.sql` | privilegios de `app_user` |
| `014_roles_permisos_base.sql` | los 25 permisos y los 5 roles de la sección 14.1 |

Añadidas por **A12** (seguridad):

| Migración | Contenido |
|---|---|
| `015_sesiones_contexto_verificado.sql` | rol `app_auth`; `app.session_context`, `app.usuario`, `app.acceso_usuario_empresa` (esquema `app`, sin RLS y sin GRANTs); redefinición de `current_tenant_id/company_id/user_id`; `abrir_sesion`, `cerrar_sesion`, `revocar_sesiones_de_usuario`, `buscar_credencial`, `registrar_login_fallido`; columnas de credencial y bloqueo en `"user"` |
| `016_permisos_y_auditoria_sensible.sql` | `tiene_permiso` / `exigir_permiso` y los triggers de permiso en 31 tablas; auditoría de ledger, período, empresa y usuario (con credenciales redactadas); `registrar_acceso_denegado` y `exigir_empresa` |
| `017_a14_cierre_vulnerabilidades.sql` | **A14** — cierre de D-030 (`revocar_sesiones_de_usuario` ignoraba el tenant) y D-031 (`app_auth` forjaba auditoría en cualquier firma) |
| `018_a2_alcance_fk_y_truncate.sql` | **A2** — cierre de D-032 y D-033 (ver D-037): 18 FK compuestas de alcance, el guardia genérico `app.trg_fk_alcance` sobre 53 columnas en 21 tablas, y `BEFORE TRUNCATE` en el ledger, `audit_log`, `approval` y `retention_applied` |

Tablas añadidas sobre la sección 15, con su justificación en las decisiones D-013, D-014 y D-020:
`tax_concept`, `municipality_ica_rule`, `third_party_fiscal_attribute`, `permission`, `role_permission`,
`user_session`, `company_setting`, `schema_migration`.
Tablas del esquema `app` (no son datos de negocio; ver D-021 y D-026): `app.session_context`,
`app.usuario`, `app.acceso_usuario_empresa`. **Ningún rol de aplicación tiene privilegio sobre ellas**,
y hay una prueba que recorre el catálogo para confirmarlo.

**Cómo se escriben las pruebas (harness de A2, ampliado por A12, para todos los agentes)**

```ts
import { createTestDb, esperarErrorPg, uuid } from '../helpers/db.js';
import { crearEscenario, crearAsientoBorrador, publicarAsiento } from '../helpers/fixtures.js';

const db = await createTestDb();              // PGlite, o DATABASE_URL si existe
const e  = await crearEscenario(db);          // firma + empresa + usuario + período + PUC + tercero + documento + aprobación
await db.asAdmin(tx => ...);                  // superusuario: SOLO para montar datos
await db.asTenant(e.tenantId, e.companyId, tx => ...);  // app_user, RLS activa, SESIÓN REAL emitida
await esperarErrorPg(() => ..., SQLSTATE.LEDGER_INMUTABLE, 'descripción');
```

- Toda prueba de aislamiento o de integridad corre dentro de `asTenant`. Dentro de `asAdmin` se es superusuario y el motor **ignora RLS**: probar aislamiento ahí es un falso PASS.
- `esperarErrorPg` falla si el error no es de PostgreSQL o si el SQLSTATE no coincide. Un `throw` de TypeScript no demuestra nada.
- Los `bigint` vuelven como número o `BigInt` y los `numeric` como string: en las aserciones use `columna::text`.
- Escribir en catálogos globales (`tenant_id IS NULL`) exige `asAdmin`.

**Cambios de A12 en el harness (la firma de `asTenant` no cambió):**

- `asTenant` ya **no fija `app.tenant_id`**: emite una sesión real con `app.abrir_sesion` y presenta
  su token. El tenant lo deriva la base (D-021). Fijar `app.tenant_id` a mano no hace nada.
- La sesión usa por defecto el rol de negocio **`admin_firma`**, para que las pruebas que no tratan
  sobre permisos no tengan que declararlos.
- Para probar permisos: `asTenant(t, c, fn, { rolCodigo: 'auxiliar_causacion' })`. Cada rol recibe su
  **propio usuario técnico**, para que los permisos no se acumulen y una prueba de "no puede X" no
  pase por accidente.
- `db.emitirSesion(t, c, opts)` devuelve `{ token, userId, sessionId }` sin ejecutar nada, para las
  pruebas que necesitan manipular la sesión.
- Fixture nuevo: `crearUsuarioConCredencial(db, tenantId, { password, conMfa, claveCifrado, roleId,
  companyId, estado })`, que devuelve la contraseña y el secreto TOTP en claro para la prueba.
- Errores de dominio nuevos: `SQLSTATE.SESION_INVALIDA` (SE001), `PERMISO_INSUFICIENTE` (SE002),
  `EMPRESA_NO_AUTORIZADA` (SE003).

**Verificación en navegador real antes de reportar terminado (convención permanente desde D-085)**

Además de `npx tsc --noEmit`, `npx next build` y `npm test`, ninguna tarea que toque `app/` se
reporta como terminada sin haberla recorrido en un **navegador real** (el navegador propio del
agente o la extensión de Chrome conectada). Se revisa **tanto `next dev` como el build de
producción** (`next build && next start`): algunos `console.error` de React solo salen en uno de
los dos (dev tiene el ruido de Fast Refresh; ciertos warnings de React se compilan fuera en prod).
Se verifica:

- **Consola limpia**: cero errores y cero warnings en la consola del navegador en cada pantalla
  tocada por el cambio, en dev y en prod.
- **El flujo ocurre de verdad**: que lo descrito se vea suceder en pantalla, no solo que compile.
- **Casos de tema** (siempre que se toque `layout.tsx`, el shell, `TemaProvider` o `globals.css`):
  cargar con el SO en oscuro y sin la cookie `contable-co-tema` (debe abrir oscuro); con el SO en
  claro (debe abrir claro); tocar el toggle sol/luna y recargar (debe persistir la elección); y
  seleccionar una empresa distinta en el selector sin que el tema cambie solo.

El reporte de la tarea documenta **qué se vio en el navegador**, no solo el resultado de los
comandos.

**Comandos**

- `npm test` — suite completa (Vitest + PGlite)
- `npm run test:gates` — solo compuertas de aceptación por ola
- `npm run migrate` — aplica migraciones pendientes

---

## Casos dorados — VEREDICTO REAL, uno por uno (A14, compuerta de la Ola 1)

**Ya no hay ni un `todo`.** En la Ola 0 los veinte estaban enumerados como `todo` porque no existía
motor, ni datos, ni parser. En la Ola 1 existen las tres piezas y A14 los resolvió a veredicto real
con **suite propia**, no aceptando la de A3:

- `tests/adversarial/casos-dorados.test.ts` — los que se resuelven contra el motor. Cada retención se
  **audita contra la fila de `tax_rule` que ella misma dice haber usado**: la tarifa reportada tiene que
  ser la de la fila, la cuenta la de la fila, la vigencia tiene que cubrir la fecha del hecho, y el valor
  tiene que coincidir con `base × tarifa` **recalculado en SQL por PostgreSQL**, no con la aritmética del
  propio motor. Si el motor mintiera sobre la regla que usó, esta suite lo ve.
- `tests/adversarial/compuerta-ola1.test.ts` — los cuatro que solo existen de verdad **al nivel del
  asiento** (15, 17, 18, 20), más el pipeline completo de punta a punta.
- `tests/golden/casos-dorados.test.ts` — la suite de A3, que se conserva: 25 pruebas que cubren el
  detalle del motor. A14 la auditó línea por línea; no la sustituye ni la reemplaza.

**Los valores esperados de la sección 12 están escritos como literales en las pruebas de A14**
($40.000, $28.500, $60.000, $15.000, $22.000, $16.000, $10.000, $190.000, $2.000, $104.748, $523.740,
$785.610, $157.122). No salen de ninguna tabla: son la afirmación que la suite defiende.

| # | Escenario | Veredicto | Cómo lo verificó A14 |
|---|---|---|---|
| 1 | Servicio $1.000.000 + IVA 19%, PJ declarante, Bogotá | **PASA** en retefuente y ReteIVA; la pata de ReteICA **de Bogotá** sigue sin datos (V-5) | Retefuente **$40.000** y ReteIVA **$28.500 sobre los $190.000 de IVA** (no sobre la base), ambos auditados contra su fila de `tax_rule` y recalculados en SQL. Y **de punta a punta con el repositorio tal como está**, sin que ninguna prueba inserte un parámetro: el caso entra por la cola, sale como asiento balanceado (débito gasto $1.000.000 + IVA $190.000; crédito 2365 $40.000, 2367 $28.500, proveedores $1.121.500) y **se publica**. La ReteICA de Bogotá va por actividad y su tarifa no se puede guardar todavía (V-5): el motor **se niega a inventarla**, que es la conducta correcta |
| 2 | Mismo servicio, PN **no declarante** → 6% | **PASA** | **$60.000**. Y se comprueba que la `tax_rule_id` aplicada es **otra fila distinta** de la del declarante: si fuera la misma, el eje "tercero" no existiría |
| 3 | Servicio $80.000 (bajo 2 UVT) | **PASA** | No retiene, con motivo. El umbral **no está en el código**: A14 lo recalcula desde `base_minima_uvt × UVT vigente` y comprueba que da exactamente **$104.748**. La evaluación negativa se **persiste** en `retention_applied` y se relee |
| 4 | Compra $500.000 (bajo 10 UVT) | **PASA** | No retiene, con motivo. Umbral recalculado desde la base: **$523.740** |
| 5 | Compra $600.000 a declarante | **PASA** | **$15.000**, auditado contra la fila (2,5%) |
| 6 | Honorarios PJ $200.000 | **PASA** | **$22.000**. Y "desde el primer peso" es un **dato**, no una excepción del código: la regla trae base mínima 0, comprobado en la fila |
| 7 | Arrendamiento inmueble vs. mueble, $400.000 | **PASA** | El inmueble no retiene (bajo 10 UVT); el mueble por el mismo valor retiene **$16.000**. Dos reglas distintas, mismo importe, mismo día |
| 8 | Servicio en Medellín → ReteICA 2‰, base 15 UVT | **PASA SIN ANDAMIAJE** (era el caso que bloqueaba la ola) | Con los seeds del repositorio y **sin que ninguna prueba inserte una regla**: $1.000.000 de servicio en Medellín produce **$2.000** de ReteICA, el asiento cuadra y **se publica**, `ciiu_activity_id` queda **nulo** (Medellín no va por actividad) y la traza cita **«Acuerdo 066 de 2017»** — la cadena de norma no perdió el origen al copiarse. La base mínima recalculada desde `municipality_ica_rule` da **$785.610**, el valor de la sección 12, y por debajo de ella no retiene |
| 9 | Mismo servicio en Cali → base servicios 3 UVT | **PASA en lo que el caso discrimina; la magnitud de la tarifa sigue sobre andamiaje** (V-5, D-048) | $200.000 **sí** retiene en Cali y **no** en Medellín: mismo importe, mismo tercero, mismo día, solo cambia el municipio. La base de Cali recalculada desde la fila real de A1 da **$157.122** y la de Medellín **$785.610**: **eso** es lo que el caso discrimina y está verificado con datos reales. La tarifa por actividad de Cali no existe y el mega-prompt no la trae |
| 10 | Principal en Bogotá, secundaria en Cali, operación en Cali | **PASA en lo que el caso discrimina; la magnitud de la tarifa sigue sobre andamiaje** (V-5, D-048) | La retención sale con la actividad **de Cali**, no con la principal de Bogotá, y con el municipio de Cali. Es exactamente lo que el caso pone a prueba, y no depende de cuánto valga la tarifa |
| 11 | Vigilancia $5.000.000 con AIU $500.000 | **PASA en el motor. NO se puede disparar por el canal de ingest** | La base es **$500.000**, no $5.000.000, y la retención **$10.000**. Sin AIU declarado el motor **no lo deduce** del total: `concepto_aiu_sin_aiu_declarado`. Limitación declarada: el parser de A4 no discrimina AIU por línea, así que por `recibirDocumento` el caso siempre va a revisión manual (V-7) |
| 12 | Proveedor del exterior → ReteIVA 100% | **PASA** | **$190.000**, el 100% del IVA, con norma que cita el **art. 437-2**. Y no es "la misma regla al tope": es **otra fila** — el mismo concepto con proveedor nacional da $28.500 |
| 13 | Régimen SIMPLE | **PASA** | Sin política parametrizada el motor **no decide**: `regimen_simple_sin_politica_parametrizada` y cero agregados. Con la política puesta como dato en `company_setting`: no retefuente (con su motivo), sí ReteIVA $28.500. Un tercero ordinario no se ve afectado |
| 14 | Factura con 3 líneas de conceptos distintos | **PASA** | $40.000 + $15.000 + $22.000 = **$77.000**; **tres** agregados con **tres** `tax_rule_id` distintos contra **una sola** cuenta. Las tres retenciones auditadas contra sus filas. Variante hostil de A14: **trocear un concepto en dos líneas no esquiva la base mínima** (dos líneas de $300.000 se agregan a $600.000 y retienen) |
| 15 | Nota crédito sobre factura causada | **PASA, y al nivel del asiento** | A3 lo prueba en la traza; A14 lo prueba en el **ledger**: se causa, se **publica**, se reversa, y el asiento original queda **idéntico byte a byte** (`to_jsonb` del asiento + todas sus partidas). La reversa es un asiento **nuevo** que suma **cero** con el original. Y **no se puede reversar dos veces**: `journal_entry_reversa_uq` lo rechaza con `23505` |
| 16 | Factura 15-jun-2026 procesada 20-jul-2026 | **PASA** | Mismo motor, misma hora de reloj, dos fechas de hecho: julio da $40.000 y junio da **cero con motivo**, porque A1 **no inventó** la tarifa anterior al decreto. Que lo que falla es la vigencia y no la fecha se prueba con honorarios, que sí estaba vigente en junio ($22.000, auditado contra la fila con fecha de junio). Y el **borde exacto**: 30-jun no resuelve, 1-jul sí. La UVT también se resuelve por la fecha del hecho (2025 vs. 2026) |
| 17 | Cambio de tarifa con vigencia futura | **PASA, en las dos mitades** | (a) La vigencia anterior se cierra e inserta una nueva **sin tocar código ni redesplegar**: la resolución de un hecho pasado sigue dando la tarifa vieja y la de un hecho posterior da la nueva. (b) La traza ya registrada en `retention_applied` queda **idéntica byte a byte**. (c) Repetido con la **UVT**, que es el parámetro más transversal: el umbral se mueve solo para los hechos posteriores |
| 18 | Reprocesar 10 veces la misma factura | **PASA, y al nivel del asiento** | Diez pasadas de la cola sobre la misma factura: **un solo** `journal_entry`, **idéntico byte a byte** tras las diez, y las nueve repeticiones devuelven `ya_procesado`. Encolar diez veces deja **un solo** trabajo. Y la garantía **no es el `if` de TypeScript**: saltándose el servicio, insertar un segundo asiento con la misma `idempotency_key` lo rechaza `journal_entry_idem_uq` con `23505` |
| 19 | Segunda factura igual → cero llamadas al LLM | **PARCIAL, y declarado como tal** | La mitad que existe hoy está **verde**: barrido de **todo** `src/` sin `fetch`, `node:http(s)`, `axios`, `openai`, `anthropic` ni `@ai-sdk` — no hay con qué llamar a un LLM; la segunda factura del mismo proveedor con la misma descripción se causa entera resolviendo el concepto desde `memoria_clasificacion`, sin crear ninguna fila nueva; y dos resoluciones seguidas dan la misma huella. **La otra mitad no se puede verificar y no se finge: no hay LLM que contar hasta que A5 lo construya en la Ola 2** |
| 20 | Tenant A consulta datos del tenant B | **PASA** | Ya probado en la Ola 0 por catálogo; **reverificado sobre las nueve tablas que estrena la Ola 1** (`document_processing_job`, `source_document`, `extraction`, `retention_applied`, `memoria_clasificacion`, `email_ingest_log`, `journal_entry`, `journal_line`, `concepto_causacion`): cero filas ajenas desde una sesión real, con y sin `WHERE`. Y la firma B **no puede** encolar, completar, reclamar ni aprobar nada de la firma A (`42501`), ni aunque conozca sus identificadores |

**Pruebas adicionales de integridad (sección 12, final):**

| Prueba | Estado |
|---|---|
| Grep de literales tributarios en código → cero | **PASA, con detector reforzado.** `tests/adversarial/valores-tributarios.test.ts`: **siete** reglas (antes seis), 32 pruebas. **Cero hallazgos** en `src/`, `app/` y `db/migrations/`. Ver D-038 (exención de escalas, ganada contra el esquema), D-039 (por qué `db/seeds` se excluye y qué se comprueba a cambio) y D-040 (hueco real que encontró el canario) |
| UPDATE/DELETE sobre asiento publicado → falla en BD | **PASA, reverificado sobre lo que construyó la Ola 1.** Ocho vectores sobre un asiento publicado **por el pipeline de A6**: UPDATE idempotente, des-publicar, DELETE del asiento, UPDATE/DELETE/INSERT de partidas, y UPDATE y DELETE **masivos sin WHERE**. Los ocho: `LG001`. Fotografía byte a byte idéntica al final |
| Asiento desbalanceado → falla en BD | **PASA**, `LG002` en el COMMIT, con el descuadre de **un centavo** sobre el escenario real de A6 |
| Reprocesar la misma factura 10 veces → asiento idéntico | **PASA** (caso 18) |
| Un cambio de parámetro no altera lo publicado | **PASA** (caso 17) |
| Balance de prueba vs. ledger con 10.000 asientos | no implementado todavía — A9 + A14, Ola 3 |
| Carga: 5.000 facturas en cola sin degradar el request HTTP | no implementado todavía — A6 + A13 + A15, Ola 2 |

---

## Casos dorados — VEREDICTO DE LA OLA 2 (A14), uno por uno

Los veinte se **volvieron a ejecutar completos** en esta pasada, no una muestra: las dos suites
(`tests/adversarial/casos-dorados.test.ts` y `tests/golden/casos-dorados.test.ts`) más
`tests/golden/caso19-memoria.test.ts` y las dos suites nuevas de la compuerta de la Ola 2. El detalle de
**cómo** se verificó cada uno en la Ola 1 sigue en la tabla de arriba y no se repite; aquí va el
veredicto de HOY y lo que cambió.

| # | Veredicto Ola 2 | Qué pasó en esta pasada |
|---|---|---|
| 1 | **PASA** (sin cambios) | Reejecutado. Retefuente $40.000 y ReteIVA $28.500; la pata de ReteICA de Bogotá sigue sin datos (V-5) |
| 2 | **PASA** (sin cambios) | Reejecutado. $60.000, con `tax_rule_id` distinta de la del declarante |
| 3 | **PASA** (sin cambios) | Reejecutado. No retiene bajo $104.748, con motivo persistido |
| 4 | **PASA** (sin cambios) | Reejecutado. No retiene bajo $523.740, con motivo |
| 5 | **PASA** (sin cambios) | Reejecutado. $15.000 auditado contra su fila |
| 6 | **PASA** (sin cambios) | Reejecutado. $22.000 desde el primer peso, con base mínima 0 **como dato** |
| 7 | **PASA** (sin cambios) | Reejecutado. Inmueble no retiene, mueble $16.000 |
| 8 | **PASA** (sin cambios) | Reejecutado sin andamiaje: $2.000 de ReteICA en Medellín con los seeds del repositorio |
| 9 | **PASA en lo que discrimina** (sin cambios) | Reejecutado. La base de Cali ($157.122) frente a la de Medellín ($785.610). La magnitud de la tarifa por actividad sigue en V-5 |
| 10 | **PASA en lo que discrimina**, y ahora **también por el canal real** | Reejecutado en el motor. Además, **V-8 cerrada por A7**: `document_correction` deja capturar el municipio de la operación y el reproceso causa con la tarifa real de Medellín |
| 11 | **PASA en el motor**, y ahora **también por el canal real** | Reejecutado. Además, **V-7 cerrada por A7**: sin AIU va a revisión manual; capturado el AIU por línea y reencolado, causa sobre el AIU |
| 12 | **PASA** (sin cambios) | Reejecutado. ReteIVA al 100% = $190.000, con norma que cita el art. 437-2 |
| 13 | **PASA** (sin cambios) | Reejecutado. Sin política parametrizada el motor no decide; con ella, tratamiento diferenciado |
| 14 | **PASA** (sin cambios) | Reejecutado, incluida la variante hostil de trocear un concepto en dos líneas |
| 15 | **PASA** (sin cambios) | Reejecutado. Reversa por asiento nuevo; el original idéntico byte a byte; doble reversa rechazada por `23505` |
| 16 | **PASA** (sin cambios) | Reejecutado. Manda la fecha del hecho, con el borde exacto 30-jun / 1-jul |
| 17 | **PASA, y ahora POR LA INTERFAZ** | Reejecutado en el motor. **Nuevo:** A14 lo repite enviando el `FormData` de la acción de servidor de A8 (`guardarUvtAction`): la vigencia anterior conserva su valor y solo se le cierra la fecha (`vigente_hasta = 2026-12-31`), la nueva rige desde 2027-01-01, la resolución por fecha del hecho devuelve la vieja para junio-2026 y la nueva para enero-2027, y la **fotografía de todo lo publicado en la firma es idéntica byte a byte antes y después** |
| 18 | **PASA, reverificado con escenario propio de la Ola 2** | Diez pasadas de la cola sobre la misma factura: **un solo** `journal_entry`, y la fotografía del asiento con todas sus partidas es **la misma en las diez** (`new Set(fotos).size === 1`), no solo el mismo `id` |
| 19 | **PASA — dejó de ser PARCIAL.** Era el único que la Ola 1 no pudo cerrar | Cerrado con **mina y espía**, no con contador ajeno (D-052): un `ProveedorLlm` que revienta si lo llaman y un espía sobre `globalThis.fetch`. Segunda factura del mismo proveedor con la misma descripción escrita distinta → `origen = 'memoria'`, `llamadasLlm = 0`, `costoMicrosUsd = 0`, la mina intacta y el espía sin una sola llamada. Y **con `proveedor: null`** —sin ningún LLM configurado— sigue clasificando |
| 20 | **PASA, reverificado sobre las tablas que estrena la Ola 2** | Cero filas ajenas desde una sesión real, con consulta **sin filtro de tenant**, sobre `memoria_clasificacion`, `document_correction`, `integration_call_log`, `parametro_clasificacion`, `concepto_causacion` y `clasificacion_pendiente` |

**Pruebas adicionales de integridad, estado tras la Ola 2:**

| Prueba | Estado |
|---|---|
| Grep de literales tributarios en código → cero | **PASA, con el detector REFORZADO otra vez.** Cero hallazgos en `src/`, `app/` y `db/migrations/`. Ahora son **ocho** comprobaciones de forma (siete reglas por línea + el escáner por sentencia de D-049) y el barrido tiene que demostrar que **alcanza `app/`**, incluidos `.tsx`, `app/parametros` y `app/bandeja` — la superficie con más decimales legítimos del repositorio |
| UPDATE/DELETE sobre asiento publicado → falla en BD | **PASA**, reverificado en la Ola 2 sobre un asiento publicado por el pipeline: `UPDATE` del asiento, `DELETE` del asiento y `UPDATE` de partidas, los tres `LG001`, **incluso como dueño del esquema** |
| Asiento desbalanceado → falla en BD | **PASA**, `LG002` con descuadre de un centavo |
| Reprocesar la misma factura 10 veces → asiento idéntico | **PASA** (caso 18, reverificado con fotografía completa) |
| Un cambio de parámetro no altera lo publicado | **PASA** (caso 17, ahora también por la interfaz) |
| Balance de prueba vs. ledger con 10.000 asientos | no implementado todavía — **A9 + A14, Ola 3** |
| Carga: 5.000 facturas en cola sin degradar el request HTTP | **sigue sin implementar.** Era una advertencia para la Ola 2 y nadie la tomó. **A6 + A13 + A15.** No es criterio de salida de la Ola 2, así que no la bloquea, pero pasa a ser deuda explícita de la Ola 3 |

---

## Casos dorados — VEREDICTO DE LA OLA 3 (A14), uno por uno

Los veinte se **volvieron a ejecutar completos** en esta pasada, no una muestra: `npm test` entero (806
pruebas, 41 archivos) y, además, A14 relanzó por separado las suites que los contienen
(`tests/golden/casos-dorados.test.ts`, `tests/golden/caso19-memoria.test.ts`,
`tests/adversarial/casos-dorados.test.ts`, `compuerta-ola0`, `compuerta-ola1`, `compuerta-ola2`,
`compuerta-ola2-interfaz` y `evasion`: **177 + 33 pruebas, cero fallos**). El **cómo** se verificó cada
uno está en las dos tablas de arriba y no se repite; aquí va el veredicto de HOY y lo que la Ola 3 le
añadió a cada caso.

| # | Veredicto Ola 3 | Qué pasó en esta pasada |
|---|---|---|
| 1 | **PASA** (sin cambios) | Reejecutado. Retefuente $40.000 y ReteIVA $28.500. La pata de ReteICA de Bogotá sigue sin datos (V-5), que no es asunto de esta ola |
| 2 | **PASA** (sin cambios) | Reejecutado. $60.000, con `tax_rule_id` distinta de la del declarante |
| 3 | **PASA** (sin cambios) | Reejecutado. No retiene bajo $104.748, con el motivo persistido y releído |
| 4 | **PASA** (sin cambios) | Reejecutado. No retiene bajo $523.740, con motivo |
| 5 | **PASA** (sin cambios) | Reejecutado. $15.000 auditado contra su fila de `tax_rule` |
| 6 | **PASA** (sin cambios) | Reejecutado. $22.000 desde el primer peso, con base mínima 0 **como dato** |
| 7 | **PASA** (sin cambios) | Reejecutado. Inmueble no retiene; mueble por el mismo valor, $16.000 |
| 8 | **PASA** (sin cambios) | Reejecutado sin andamiaje: $2.000 de ReteICA en Medellín con los seeds del repositorio |
| 9 | **PASA en lo que discrimina** (sin cambios) | Reejecutado. Base de Cali $157.122 frente a la de Medellín $785.610. La magnitud de la tarifa por actividad sigue en V-5 |
| 10 | **PASA en lo que discrimina, y por el canal real** (sin cambios) | Reejecutado. V-8 sigue cerrada por A7 |
| 11 | **PASA en el motor y por el canal real** (sin cambios) | Reejecutado. V-7 sigue cerrada por A7 |
| 12 | **PASA** (sin cambios) | Reejecutado. ReteIVA al 100% = $190.000, con norma que cita el art. 437-2 |
| 13 | **PASA** (sin cambios) | Reejecutado. Sin política parametrizada el motor no decide |
| 14 | **PASA** (sin cambios) | Reejecutado, incluida la variante hostil de trocear un concepto en dos líneas |
| 15 | **PASA, y la Ola 3 lo pone a prueba donde más duele** | Reejecutado (reversa por asiento nuevo, original idéntico byte a byte). **Nuevo:** el cierre de resultados de A10 es el primer código que escribe en el ledger fuera de la causación, y A14 verificó que ahí también se corrige por reversa: sobre el asiento de cierre **publicado**, `UPDATE journal_entry` y `DELETE journal_line` fallan con `LG001` desde una sesión real |
| 16 | **PASA** (sin cambios) | Reejecutado. Manda la fecha del hecho, con el borde exacto 30-jun / 1-jul |
| 17 | **PASA** (sin cambios), y **la Ola 3 no lo rompe** | Reejecutado en el motor y por la interfaz de A8. **Nuevo:** los reportes de la Ola 3 no reabren la puerta: `src/reports/` es de solo lectura —generar los **veinte** libros deja `journal_entry`, `journal_line`, `retention_applied`, `approval` y `source_document` con la **misma huella exacta** antes y después— y la hoja «Parámetros» de cada libro trae la vigencia con la que se armó, que es lo que hace auditable un cambio de tarifa a seis meses vista |
| 18 | **PASA, y se extiende al cierre de ejercicio** | Reejecutado (diez pasadas de la cola, un solo asiento, la misma fotografía las diez). **Nuevo:** A14 ejecutó el **cierre de resultados diez veces**: un solo asiento de cierre, el mismo `id` las diez veces, y la cuenta de resultado con el saldo **exacto** (pérdida de $1.500.000), no el doble. Y encontró la grieta que la clave de idempotencia no cubría: dos rangos **solapados** sí duplicaban la cancelación (**V-15, corregida por A14**) |
| 19 | **PASA** (sin cambios) | Reejecutado con la mina y el espía de D-052: segunda factura del mismo proveedor con la misma descripción escrita distinta → `origen = 'memoria'`, `llamadasLlm = 0`, `costoMicrosUsd = 0`, la mina intacta y `globalThis.fetch` sin una sola llamada. Ningún módulo de la Ola 3 llama a un LLM: `src/reports/` no importa nada de `src/ai/` |
| 20 | **PASA, reverificado sobre TODA la superficie nueva de la Ola 3** | Cero filas ajenas, y ahora también **cero celdas ajenas**: los **veinte** libros generados desde la sesión de **otra firma** y desde **otra empresa de la misma firma** no contienen la marca de la empresa A, ni su `third_party_id`, ni su `company_id`, **en ninguna hoja** (se recorre el libro entero, no solo «Datos»: si una hoja adicional olvidara el filtro, se vería). Y el **archivo plano** de exógena (1001, 1005, 1007, 1009) generado por la otra firma tampoco los trae |

**Reejecución de la SEGUNDA pasada (2026-08-31, con la ruta de descarga ya entregada):** los veinte
vuelven a correr en verde dentro de las 849 pruebas. El **caso 20 se extiende a la superficie que estrena
el desbloqueo**, que es la más expuesta de todo el producto (una ruta HTTP que devuelve archivos): sesión
de la firma B pidiendo la empresa de la firma A → **403** con rastro `ACCESO_DENEGADO`; empresa de la
misma firma sin acceso vigente → **403**; `companyId`/`company_id`/`empresa`/`tenantId` inyectados en la
query → **ni se leen**, y el `.xlsx` que baja —abierto y recorrido hoja por hoja— no contiene la marca de
la otra firma ni su `third_party_id`; sin cookie, con token inventado o con la sesión ya cerrada → **401**.
El **caso 17** también se extiende: descargar los veinte libros por HTTP deja la huella del ledger
idéntica, así que la ruta tampoco puede alterar nada de lo publicado.

**Pruebas adicionales de integridad, estado tras la Ola 3:**

| Prueba | Estado |
|---|---|
| Grep de literales tributarios en código → cero | **PASA, con el barrido REENVENENADO contra los módulos nuevos.** Cero hallazgos en `src/`, `app/` y `db/migrations/`. A14 sembró seis muestras en `src/reports/`, `src/reports/estados/` y `src/reports/exogena/` —tarifa quemada, máscara de Excel `'0.00%'`, dos umbrales precalculados (104748 y 523740), un `TOPE_UVT_1001 = 2400` y 2.400 UVT en pesos (125.697.600)— y el detector cazó **las seis**; el único superviviente fue `ANCHO_NIT = 20`, que no es tributario. Se añadió la aserción de que el barrido **alcanza** `src/reports/` y `src/services/cierre.ts`, para que el silencio no pueda ser vacío |
| UPDATE/DELETE sobre asiento publicado → falla en BD | **PASA**, reverificado sobre el asiento que estrena la ola: el **de cierre de ejercicio**. `UPDATE journal_entry` y `DELETE journal_line` desde sesión real → `LG001` |
| Asiento desbalanceado → falla en BD | **PASA**, `LG002` en el COMMIT con descuadre de un centavo. Y los 10.000 asientos aleatorios de esta ola se publicaron **todos** balanceados: si uno solo no lo hubiera estado, el COMMIT de su lote habría caído |
| Reprocesar la misma factura 10 veces → asiento idéntico | **PASA** (caso 18), y el cierre de ejercicio también resulta idempotente diez veces |
| Un cambio de parámetro no altera lo publicado | **PASA** (caso 17) |
| **Balance de prueba vs. ledger con 10.000 asientos → cuadra al centavo** | **PASA. Implementado por A14 en esta ola** (`tests/adversarial/compuerta-ola3.test.ts`). Detalle en el criterio 2 de la compuerta |
| Carga: 5.000 facturas en cola sin degradar el request HTTP | **SIGUE SIN IMPLEMENTAR.** Era advertencia para la Ola 2, pasó a deuda explícita de la Ola 3 y nadie la tomó tampoco. No es criterio de salida de ninguna de las dos, así que no bloquea; queda como deuda para **A6 + A13 + A15** antes de producción |

---

## Compuerta de la Ola 3 — veredicto de A14: **PASA. Ola 3 CERRADA** (en la segunda pasada)

Dos pasadas:

- **Primera (2026-08-30, commit `bb8cb08`): BLOQUEADA.** El criterio 2 pasaba al centavo; el criterio 1
  no, porque no existía ninguna forma de descargar un reporte (V-16). 107 pruebas nuevas de A14
  (`tests/adversarial/compuerta-ola3.test.ts`, `compuerta-ola3-entregas.test.ts`).
- **Segunda (2026-08-31, commit `0e28054` + correcciones de A14): PASA.** A9 cerró V-16 con
  `app/api/reportes/[libro]/route.ts` y `app/reportes/page.tsx`; A14 lo **atacó** en vez de creerle
  (`tests/adversarial/compuerta-ola3-ruta.test.ts`, **35 pruebas nuevas**) y encontró V-19, que corrigió.

### Criterio 1 — «Todo reporte se descarga en Excel con formato de papel de trabajo (sección 11)»

**PASA. Verificado por HTTP, no por la capa de servicios** (D-056), y atacando la ruta como atacante y
como contador hostil.

Lo del **contenido** del Excel ya estaba verificado en la primera pasada, libro por libro, los veinte
(8 de A9, 5 de A10, 7 de A11), y sigue en verde:

- **Las cuatro hojas obligatorias de la §11.2 están, y son las cuatro primeras**: la comprobación es
  `worksheets.slice(0, 4)` **exactamente igual a** `['Datos','Papel de trabajo','Trazabilidad','Parámetros']`,
  así que una hoja adicional no puede colarse en medio ni desplazar a una obligatoria.
- **«Papel de trabajo» lleva el encabezado que exige la norma**: NIT, la palabra «período» y el período
  real del reporte, en los veinte.
- **«Trazabilidad» dice qué regla y qué vigencia se aplicó, con datos reales**: en el certificado de
  retenciones contiene el `tax_rule_id` **exacto** de la regla usada y su `vigente_desde`, y sus
  encabezados nombran regla y vigencia. La hoja «Parámetros» del mismo libro también trae la vigencia:
  es lo que lo hace autoexplicativo a seis meses y defendible ante un revisor fiscal.
- **Los veinte se escriben como `.xlsx` y se vuelven a abrir**, con la firma `PK` del ZIP verificada y
  sin ningún nombre de hoja de más de 31 caracteres.

Lo **nuevo de esta pasada**, que es lo que faltaba: **ahora se descargan de verdad.**

- **Los veinte slugs responden 200 por `GET /api/reportes/:libro`**, con
  `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, cuerpo que empieza
  por `PK`, y **al reabrirlo con ExcelJS trae las cuatro hojas obligatorias**. No es una muestra: son los
  veinte, uno por uno, cada uno con sus parámetros obligatorios.
- **El `Content-Disposition` no es inyectable**: se comprueba contra
  `^attachment; filename="[A-Za-z0-9_.-]+\.xlsx"$`. El nombre lo arma la ruta leyendo la hoja «Papel de
  trabajo» del libro **ya generado** (razón social y NIT), no un parámetro del cliente.
- **El libro que baja trae los datos de la empresa en sesión** (contiene la marca de la firma A): si no,
  la prueba de aislamiento de más abajo no probaría nada.
- **Ningún libro quedó huérfano.** Esta es la comprobación que cierra V-16 de verdad, y no la existencia
  de la ruta: A14 enumera **los generadores exportados por `src/reports/`** en tiempo de ejecución
  (`generarLibro*`, `generarBalance*`, `generarEstado*`, `generarFormato*`…), verifica que son **veinte**
  y que **todos** aparecen cableados en el fuente de la ruta. Si mañana alguien añade un libro y olvida su
  slug, esa prueba cae: V-16 no puede reaparecer en silencio.
- **La afirmación de A9 de que su ruta es el único importador de `src/reports/` fuera de las pruebas es
  CIERTA**, y no se acepta por escrito: se comprueba con `git grep` sobre `app/` y `src/` dentro de la
  propia prueba, exigiendo que la lista sea exactamente `['app/api/reportes/[libro]/route.ts']`.
- **La ruta no escribe nada en el ledger**: descargar los veinte deja la huella de `journal_entry`,
  `journal_line`, `approval`, `source_document` y `retention_applied` idéntica.
- **La pantalla existe** (`app/reportes/page.tsx`, `ƒ /reportes` en el build) y no ofrece formularios sin
  el permiso `reporte.exportar`.

### Ataques a la ruta — caso dorado 20 sobre la superficie nueva

Una ruta HTTP que sirve archivos es el sitio más fácil para filtrar datos de otra firma. Resultado de los
ataques de A14, todos contra la base real (RLS, `app.current_company_id()` y `app.exigir_permiso` sin
dobles; lo único simulado es `next/headers` y el singleton de conexión):

| Ataque | Resultado |
|---|---|
| Sin cookie de sesión | **401**, sin generar nada, y el cuerpo no contiene la marca de ninguna firma |
| Token inventado | **401** |
| Sesión **cerrada** después de emitirse (la cookie sigue en el cliente) | **200 antes, 401 después**: lo decide la base, no la cookie |
| Sesión de la **firma B** con cookie de empresa de la **firma A** | **403**, con rastro `ACCESO_DENEGADO` en `audit_log` del tenant atacante, y sin servir el libro |
| Empresa de la **misma firma** sobre la que el usuario no tiene acceso vigente | **403** |
| `companyId`, `company_id`, `empresa` y `tenantId` inyectados en la **query string** | **200 con el libro de SU empresa**: los cuatro parámetros **ni se leen**. El `.xlsx` que baja no contiene la marca de la firma A ni su `third_party_id` — comprobado abriendo el archivo devuelto y recorriendo **todas** las hojas |
| Rol `solo_lectura` (sin `reporte.exportar`) | **403** — lo impone el motor (`app.exigir_permiso`), la ruta solo traduce |
| Recorrido de ruta (`../../../etc/passwd`, `..%2f..%2fapp%2flib%2fdb`, `libro-diario/../../secreto`) | **404** |
| Slugs iguales a claves del prototipo de `Object` (`__proto__`, `constructor`, `toString`, `valueOf`, `hasOwnProperty`) | **404** tras la corrección de A14. **Antes daban 500** (V-19) |
| Parámetros ausentes o mal formados, `nivel=9`, `nivel=3; DROP TABLE journal_line` | **400** con mensaje puntual, nunca 500 |
| Inyección SQL por `terceroId` (`' OR 1=1 --`) | No llega al motor como SQL; no devuelve datos ajenos y el ledger queda intacto |

### Criterio 2 — «El balance de prueba cuadra contra la suma del ledger, comprobado por A14 con datos generados aleatoriamente» (§12: 10.000 asientos, al centavo)

**PASA.** Verificado con datos que generó A14, no con el escenario de dos asientos con el que A9 dio el
criterio por bueno en su reporte.

- **10.000 asientos aleatorios y 39.983 partidas**, con generador determinista (mulberry32, semilla
  20260830) para que un fallo sea reproducible: de 1 a 3 débitos y de 1 a 3 créditos por asiento, importes
  aleatorios en centavos, fechas repartidas sobre los 365 días de 2026 y **15 cuentas** con códigos de 4,
  6 y 8 dígitos, para que agrupar por nivel del PUC tenga algo real que agrupar en los cinco niveles.
  Todos pasan por el ciclo real `draft` → partidas → `app.publicar_asiento`.
- **La comparación NO es circular.** `sumaDirectaLedger` de A9 lee la **misma vista**
  `v_journal_line_reporte` que el balance: comparar una con otra no puede detectar que la vista pierda
  filas. A14 compara contra `journal_line JOIN journal_entry` **crudas** y, además, contra **lo que
  generó en memoria**. Tres fuentes, no dos.
- **Cuadra al centavo en los cinco niveles** (clase, grupo, cuenta, subcuenta, auxiliar): la suma de
  `debitosPeriodo` y de `creditosPeriodo` de todas las filas del balance coincide exactamente con la suma
  cruda, y débitos = créditos (la doble partida se demuestra con 10.000 asientos, no se asume).
- **Grupo por grupo, no solo el total.** Para cada nivel A14 recalcula en memoria débitos, créditos y
  **saldo inicial** de cada grupo y los compara uno a uno contra la fila del balance, comprueba
  `saldoFinal = saldoInicial + débitos − créditos` y verifica **en el otro sentido** que ningún grupo con
  movimiento desapareció del reporte. Un total correcto con dos grupos intercambiados no pasaría.
- **La vista no pierde ni inventa una partida**: mismo conteo y misma suma de `monto` que las tablas
  crudas. Importaba comprobarlo porque `v_journal_line_reporte` hace un **INNER JOIN con `account`**, y un
  inner join es exactamente la forma en que un reporte pierde filas en silencio.
- Todo en `BigInt` de punta a punta, en la prueba y en el código.

**Hallazgo de rendimiento que salió de aquí, y que no es un defecto del producto** (ver D-057): sin
estadísticas del planificador, un `JOIN` de `journal_line` con `journal_entry` **bajo RLS** degenera en
bucle anidado y crece **cuadráticamente** — medido: 10 s con 2.000 partidas, 39 s con 4.000, 159 s con
8.000; con `ANALYZE` ejecutado, el mismo JOIN baja a **4 ms**. Es el planificador sin estadísticas, no la
RLS ni la vista: la misma consulta sin el JOIN va en 3 ms bajo RLS. Queda anotado para **A15**: tras una
carga masiva de documentos hay que ANALIZAR, o los primeros reportes de esa empresa se arrastran.

### Criterio nuevo desde la Ola 2 — `npx next build`

**PASA. Exit 0** en las dos pasadas, Next 16.3.3 con Turbopack. En la segunda, el build lista **13 rutas**,
incluidas las dos nuevas: `ƒ /api/reportes/[libro]` y `ƒ /reportes`. Ejecutado siempre al empezar (para no
heredar una rotura ajena) y al terminar, después de tocar `src/services/cierre.ts` (primera pasada) y
`app/api/reportes/[libro]/route.ts` (segunda). Cierre: `npm test` **849 en verde** en 43 archivos
(814 previas + 35 de la suite de ataque a la ruta), `npm run typecheck` limpio.

### Adjudicación de las tres entregas, punto por punto

**A10 — «las notas son estructuralmente incapaces de fabricar una revelación».** **CIERTO, verificado por
A14 y no por lectura del reporte.** El objeto `NotaEstadosFinancieros` no tiene ningún campo que pueda
llevar la redacción: A14 recorrió las **trece** notas y comprobó que ninguna declara un campo
`redaccion`, `contenido`, `texto`, `revelacion`, `nota` ni `cuerpo`. Lo que hay es `exigencia` (lo que
pide la norma), `aportaElSistema` y `completaElContador` (instrucciones al preparador), y en el libro una
columna **«REDACCIÓN DE LA NOTA» que sale vacía en las trece filas**, comprobado celda a celda. Las hojas
`PT …` existen y llevan las columnas de juicio en blanco. **No hay camino por el que salga una revelación
redactada por la máquina.**

**A10 — el EFE cuando nadie marcó las cuentas de efectivo.** **Sale vacío y con su papel de trabajo, sin
suponer nada.** Verificado con `niif_mapping.rubro_efe` sin marcar: `cuentasEfectivo = []`, efectivo
inicial y final en **cero**, todos los renglones en cero, y la hoja **«PT efectivo y equivalentes»**
presente y con las **candidatas reales** (aparece la cuenta 110505, que sí tiene saldo). El defecto que
A14 buscaba —que `es_efectivo` cayera en un valor por defecto— **no existe**: en `app.niif_de_cuenta`,
`es_efectivo` es `(rubro_efe = 'efectivo_y_equivalentes')`, así que sin marca es `NULL` y el filtro
`WHERE n.es_efectivo` no la toma. Y con las cuentas marcadas, la conciliación de la §7 cuadra **al
centavo**: `descuadre = 0`, efectivo inicial + flujo neto = efectivo final, y el detalle (renglones de
nivel 2) suma exactamente el flujo neto. La **actividad** de cada flujo sí se presume cuando no está
declarada, pero se marca como `presumida`, se cuenta en `partidasPresumidas` y se lista en la hoja «PT
actividades presumidas»: presumir y avisar no es inventar.

**A10 — el cierre de resultados, que es lo que escribe en el ledger.** **Respeta la Regla de Oro 1, con
una grieta que A14 encontró y corrigió.** Verificado: asiento **nuevo** de tipo `cierre`, ciclo
`draft` → partidas → `app.publicar_asiento`, publicado con `posted_at` y con una fila de `approval` con
decisión `aprobado`; cero `UPDATE`/`DELETE` sobre nada publicado (el intento falla con `LG001`); exige el
permiso `periodo.cerrar` (con rol `auxiliar_causacion` lanza `PermisoInsuficienteError`); y **una cuenta
sin mapeo NIIF no se cierra a ciegas por su clase del PUC**: la cuenta 199905 del escenario no aparece en
**ninguna** partida del asiento de cierre y sí en `cuentasSinClasificar`. **La grieta (V-15):** la clave
de idempotencia cubre repetir el **mismo** rango, pero no dos rangos **solapados**. Cerrar 01-jun→30-jun y
después 15-jun→30-jun creaba un segundo asiento que volvía a cancelar los mismos ingresos: medido por
A14, la cuenta de ingresos quedaba con **saldo débito** y el resultado del ejercicio en **cero**. Y como
el ledger es inmutable, deshacerlo exige una reversa. **Corregida por A14** (`CierreSolapadoError`, ver
D-058), con prueba de regresión que además comprueba que el intento rechazado **no deja nada escrito**.

**A11 — el bloqueo del Formato 1001.** **Es real, está bien diagnosticado y bien dirigido, y A14 lo
amplía.** Verificado a mano: `third_party` **sí** tiene `direccion`, `municipality_id` y `codigo_dane`
(migración 005), o sea que el esquema de A2 está bien; y **no existe ni un solo `INSERT INTO
third_party` en `src/`, en `app/` ni en las migraciones** — ninguno, en todo el repositorio fuera de los
fixtures de prueba. **Lo que A14 añade al diagnóstico:** el hueco no es solo de exógena. Como
`src/services/ingest.ts` resuelve el tercero por NIT y **no lo crea**, una factura de un proveedor que
nadie haya insertado antes **por SQL a mano** no se puede causar. Hoy el producto no se puede poner en
marcha con un cliente nuevo sin acceso directo a la base de datos. Es **V-17**, y le toca a **A8**.

**A11 — que el archivo generado no rellene nada por defecto.** **Verificado, y es cierto.** En el Formato
1001 el tercero sin dirección sale con la celda **vacía** entre delimitadores en el archivo plano —A14
localiza la columna «Dirección» por su encabezado y comprueba que **todas** las filas de datos la traen
vacía—, aparece en la hoja **«Bloqueos»** del Excel, y el plano lleva la advertencia. Ni un `0`, ni un
código DANE por defecto, ni «COLOMBIA». Es exactamente lo que exige la advertencia 17.5, y su
consecuencia (una sanción del art. 651 ET por un municipio inventado) queda evitada.

**A11 — la limitación de alcance de los formatos 1003 y 1006.** **Es limitación honesta, no defecto
disfrazado**, con una salvedad menor. El producto no procesa facturas de venta (§1.3 del mega-prompt),
así que la fuente natural de esos dos formatos no existe en el ledger; los generadores no inventan nada,
producen lo que **sí** hay (autorretención y lo que el contador mapee en `exogena_account_mapping`) y
devuelven la advertencia en tiempo de ejecución **y en la cabecera del archivo plano**. La salvedad
(**V-18**, menor): esa advertencia **no llega al Excel**, que es justamente el que el contador revisa; el
1001 sí tiene su hoja «Bloqueos» y estos dos no tienen su hoja «Advertencias». Le toca a **A11**.

**A9, A10 y A11 tocaron el inventario cerrado de módulos de `src/`.** Verificado: `'reports'` está
declarado en el inventario de `tests/adversarial/casos-dorados.test.ts` y el canario sigue en verde. El
detector de valores tributarios **alcanza** los tres directorios nuevos y caza el veneno sembrado en cada
uno (ver la tabla de integridad de arriba).

### Lo que A14 corrigió en las dos pasadas

0. **V-19 — un slug igual a una clave del prototipo de `Object` devolvía 500 en vez de 404** (segunda pasada). `REPORTES[libro]` resolvía por la cadena de prototipos: con `__proto__` devolvía un objeto truthy que no es un generador, se saltaba el 404 y reventaba abajo con un 500 que expone un mensaje interno; con `constructor` llegaba a **llamar** a `Object` como si fuera el generador. No hay fuga —la sesión se exige antes—, pero un catálogo de rutas se consulta por **clave propia**: `Object.hasOwn(REPORTES, libro)`. Corregido en `app/api/reportes/[libro]/route.ts`, con las nueve muestras de veneno en la prueba, que además ahora **informa todas** las que fallen y no solo la primera.
1. **V-15 — el cierre de rangos solapados duplicaba la cancelación.** `CierreSolapadoError` en
   `src/services/cierre.ts`: antes de escribir nada se rechaza un cierre cuyo rango se solape con el de un
   asiento de cierre ya publicado. El rango se lee de la **propia clave de idempotencia** del asiento
   (`cierre:<desde>:<hasta>`), que es dato del ledger y no un estado paralelo que pudiera desincronizarse.
2. **El barrido de la Regla de Oro 2 ahora demuestra que alcanza `src/reports/` y `src/services/cierre.ts`**,
   con la misma forma con la que ya demostraba que alcanza `app/`. Un silencio vacío deja de poder
   confundirse con un silencio limpio.
3. **La comprobación del criterio de los 10.000 asientos existe y está automatizada**: era la única prueba
   de integridad de la §12 que llevaba dos olas sin implementar.

### Lo que A14 NO corrigió, y a quién le toca

**V-16 ya no está en esta tabla: la cerró A9 y A14 la reverificó atacándola.** Lo que sigue abierto:

| Qué falta | Por qué A14 no lo hace | A quién le toca |
|---|---|---|
| **V-17 — no hay forma de crear ni editar un tercero** | Es una pantalla CRUD completa con sus validaciones, y afecta al maestro de datos, no a un reporte | **A8** |
| **V-18 — las advertencias de alcance de 1003/1006 no llegan al Excel** | Es contenido del entregable de A11, y el mecanismo ya existe (`hojasAdicionales`, como la hoja «Bloqueos» del 1001) | **A11** |
| **Prueba de carga: 5.000 facturas en cola** | Lleva dos olas sin dueño efectivo. No es criterio de salida de ninguna, pero sigue sin hacerse | **A6 + A13 + A15** |

### Cómo se desbloqueó (histórico, ya resuelto)

Faltaba una sola cosa —**que existiera la descarga** (V-16)— y así se cerró: A9 entregó
`app/api/reportes/[libro]/route.ts` y `app/reportes/page.tsx`, y A14 volvió a correr **solo esa parte**,
atacándola, sin repetir el resto de la compuerta. La ruta pasó todo salvo el caso de las claves del
prototipo (V-19), que A14 corrigió en el momento. El resto de la compuerta —las cuatro hojas, la
trazabilidad, los 10.000 asientos, el cierre de resultados, las advertencias 17.5 de A10 y A11— ya estaba
verificado en la primera pasada y no se rehízo.

---

## Compuerta de la Ola 2 — veredicto de A14: **PASA. Ola 2 CERRADA**

### Criterio 1 — «Un contador cambia el valor de la UVT desde la interfaz, y el sistema calcula con el valor nuevo para hechos posteriores a la vigencia, sin alterar los cálculos ya publicados»

**PASA**, verificado **por la interfaz**, no por SQL ni por la capa de servicios: se envía el `FormData`
real a `guardarUvtAction` con la cookie de sesión puesta y el rol `admin_tributario` (el único que §6.2.5
autoriza).

- La acción confirma (`?ok=uvt`), sin error.
- La vigencia **anterior conserva su valor**; lo único que cambia es `vigente_hasta`.
- La **nueva** existe con el valor nuevo, y la resolución por **fecha del hecho** devuelve la vieja para
  junio-2026 y la nueva para enero-2027.
- **La fotografía de todo lo publicado en la firma —asientos y partidas— es idéntica byte a byte antes y
  después.**

Y las tres puertas del contador hostil, cerradas:

| Ataque | Resultado |
|---|---|
| Guardar una vigencia **retroactiva** a un hecho ya publicado | Rechazado por el servicio; el ledger no se mueve |
| Rodear la interfaz y hacer `UPDATE` del **valor** de la vigencia anterior, con el rol que **sí** puede parametrizar | `PR001` VIGENCIA_INMUTABLE |
| Mover `vigente_desde`, reabrir `vigente_hasta`, `DELETE` de la vigencia | `PR001`, `PR001`, `PR003` |
| Guardar desde la interfaz con un rol sin `parametro.editar` | Error, y **cero filas nuevas** en `uvt_value` |

### Criterio 2 — «El segundo procesamiento de una factura del mismo proveedor con la misma descripción NO llama al LLM»

**PASA.** Caso dorado 19, cerrado con instrumentos propios (D-052): mina en vez de contador, espía de
`fetch`, y la comprobación adicional de que **sin ningún LLM configurado** la clasificación sigue
funcionando. Cero llamadas, cero tokens, cero costo, `origen = 'memoria'`.

### Criterio 3 — «Un usuario de la firma ve en una sola pantalla las facturas pendientes de sus 30 empresas y puede aprobar 50 de un golpe»

**PASA — después de corregir un defecto real que lo derrotaba** (V-12 / D-050).

Escenario montado por A14: una firma con **31 empresas accesibles** y una **trigésimo segunda a la que la
sesión NO tiene acceso**, con dos facturas pendientes cada una.

- La pantalla trae las pendientes de **las 30**, exactamente dos por empresa.
- La empresa sin acceso **no aparece**: ni ella, ni sus facturas, ni sus documentos.
- **50 filas de distintas empresas se aprueban de un golpe** y quedan las 50 publicadas, sin un solo
  error.
- **Contador hostil 1:** seleccionar las facturas de la empresa sin acceso no publica **nada**.
- **Contador hostil 2:** falsificar el `companyId` del formulario para que declare una empresa a la que
  sí tiene acceso, con el `journalEntryId` de una a la que no, **no publica el asiento ajeno** — sigue en
  `draft`. El aislamiento lo impone el motor, no la aplicación.
- **Robustez del lote:** una fila que falla (ya publicada por otro) **ya no tumba a las sanas del mismo
  lote**. Antes de D-050 sí lo hacía.

### Lo que A14 corrigió en esta pasada

| Qué | Dónde |
|---|---|
| Salvaguarda de la Regla de Oro 2 restituida (V-13) | `tests/adversarial/valores-tributarios.test.ts` |
| Canario que había dejado de ejercitar `insert_normativo` (V-14) | `tests/adversarial/valores-tributarios.test.ts` |
| `SAVEPOINT` por ítem en la aprobación en lote (V-12) | `src/services/causacion.ts` |

### Lo que A14 NO corrigió, y a quién le toca

| Qué | De quién |
|---|---|
| **V-11** — la aprobación revienta con error crudo si el despliegue no reenvía la IP del cliente | **A7** (fallback de cabecera + mensaje accionable) + **A15** (garantizarla en el despliegue) |
| **V-1** — el `GRANT` de `app.resolver_empresa_por_buzon` sigue en `app_user`. **Desbloqueada**: el rol de sistema ya existe | **A4 + A12** |
| **V-5** — sin tarifas de ICA por actividad para Bogotá ni Cali (esquema del código municipal) | **A2**, luego **A1**, luego verificación humana |
| Prueba de carga: 5.000 facturas en cola sin degradar el request HTTP | **A6 + A13 + A15** |

---

## Compuerta de la Ola 1 — veredicto de A14: **PASA. Ola 1 CERRADA**

> **Historia, porque importa:** el 2026-08-27 A14 dejó esta compuerta **BLOQUEADA** con dos huecos de
> datos (V-4 y V-6). A1 los cerró en el commit `ffaf3db`. A14 **volvió a correr la compuerta entera**, con
> pruebas propias y sin creerle nada al reporte de A1. Este es el veredicto de esa segunda pasada.

Verificación **independiente**, tratando los cinco reportes de `docs/reportes/ola1-a*.md` como una
afirmación a refutar y no como evidencia. Mismo criterio único de la Ola 0: **si el rechazo no trae
SQLSTATE de PostgreSQL, no cuenta.**

### Los cuatro criterios de la sección 4

| # | Criterio de la compuerta | Veredicto | Detalle |
|---|---|---|---|
| **1** | El motor resuelve correctamente los **20 casos dorados** | **PASA** | **La prueba que decidía era ésta: ¿el pipeline produce un asiento con el repositorio tal como está, sin que nadie inserte un parámetro a mano en una prueba?** Antes del desbloqueo, **no**: A14 tenía que insertar una `rounding_rule` en su propia prueba de punta a punta. Ahora **sí**: el caso 1 (retefuente $40.000 + ReteIVA $28.500) y el caso 8 (ReteICA $2.000 en Medellín) se causan, cuadran y **se publican** usando solo `db/seeds/`. 18 de 20 pasan sin reservas; el 19 depende de A5 (Ola 2) y está declarado, no fingido; los 9 y 10 pasan **en lo que discriminan** y su tarifa sigue sobre andamiaje por V-5, que ya no es deuda de esta ola (D-048) |
| **2** | El parser extrae un XML real DIAN, incluido el `Invoice` embebido en **base64 dentro del `AttachedDocument`** | **PASA** | Verificado sobre el fixture de A4 y sobre **tres variantes hostiles propias**: base64 **partido en líneas de 76 caracteres**, XML plano dentro de **CDATA**, y prefijos de namespace ajenos (`ns2/ns3/ns4`). Más dos ataques: **billion laughs** (no expande, <5 s) y **XXE a un archivo local** (cuarentena, sin filtrar el archivo). **Reserva declarada:** ningún fixture es una captura real de la DIAN |
| **3** | Ni un solo valor tributario en código | **PASA** | Siete reglas, 32 pruebas, **cero hallazgos** en `src/`, `app/` y `db/migrations/`. Detector **más sensible** que en la Ola 0 (D-038, D-039, D-040). Los datos que A1 cargó viven **solo** en `db/seeds/`, que se audita aparte como dato puro |
| **4** | Un cambio de tarifa en la tabla paramétrica cambia el resultado **sin tocar código ni redesplegar** | **PASA** | Probado **tres** veces: con `tax_rule`, con `uvt_value` y —tras el desbloqueo— con `rounding_rule`, donde una empresa que carga su propia regla (`truncar`, al mil) le gana a la global de A1 (`half_up`, al peso) solo con datos. En los tres casos: cambia lo posterior, **no** cambia lo anterior, y la traza ya registrada queda **idéntica byte a byte** |

### Qué cambió entre el bloqueo y el cierre, verificado por A14 y no por reporte

1. **`rounding_rule` (V-6): CERRADA.** El pipeline completo produce el asiento del caso 1 **sin que
   ninguna prueba inserte nada** — A14 borró de su propia prueba de punta a punta el `INSERT` que antes
   necesitaba, y sigue en verde. El respaldo «parámetro operativo, no norma tributaria» se **acepta con un
   criterio explícito y comprobable**, no de palabra: ver D-046.
2. **ReteICA de Medellín (V-4): CERRADA.** A14 escribió el caso 8 **de punta a punta sin andamiaje**:
   $2.000 sobre $1.000.000, asiento publicado, `ciiu_activity_id` nulo, y la traza citando **«Acuerdo 066
   de 2017»**. La copia es **byte a byte** (`tax_rule.tarifa` = `municipality_ica_rule.tarifa_general`) y
   **la cadena de norma no perdió el origen**, que era la objeción de A14.
3. **Las dos aserciones de A14 que A1 tocó: NO se debilitaron.** Verificado línea por línea en el diff:
   una pasó de tres conteos a tres conteos exactos **más cinco comprobaciones nuevas**, y la otra pasó de
   contar filas a **ejercitar la resolución por vigencia contra el motor**. Ver D-047. A14 endureció un
   residuo (una comparación que podía pasar en el vacío por encadenamiento opcional).
4. **Bogotá y Cali siguen sin tarifa de ICA por actividad**, y A1 hizo bien en no tocarlas. Queda como
   V-5, declarada en la tabla de casos dorados y asignada a **A2** (esquema) y a verificación humana
   (dato). **No bloquea**: lo que los casos 9 y 10 discriminan está verificado con datos reales, y la
   conducta del motor ante la ausencia —negarse y dejar el motivo escrito— es la correcta (D-048).

### Lo que queda cerrado y no hay que rehacer

- **El motor de A3 es correcto**, y lo es contra una auditoría que no le cree su propia respuesta: cada
  retención se verifica contra la fila de `tax_rule` que dice haber usado y su valor se **recalcula en
  SQL**. Los cinco ejes operan, y el motor **se niega a calcular** cuando falta un parámetro en vez de
  suponerlo — probado por comportamiento, no por conteo: cerrando la vigencia de toda regla de redondeo,
  el pipeline devuelve `revision_manual` con `sin_regla_de_redondeo_vigente` y **no deja ni un asiento ni
  una retención a medias**.
- **El parser de A4 aguanta** las tres formas realistas del `AttachedDocument` y dos ataques clásicos.
- **La cola de A6 no duplica**: dos trabajadores no se llevan el mismo trabajo (`FOR UPDATE SKIP LOCKED`),
  dos ciclos en paralelo dejan **un** asiento, encolar diez veces deja **un** trabajo, y la sesión de
  negocio **no puede** reclamar, completar ni fabricar trabajos (`42501`).
- **El ledger sigue siendo inmutable** sobre lo que construye A6: ocho vectores de `UPDATE`/`DELETE`
  contra un asiento publicado por el pipeline, los ocho `LG001`, fotografía idéntica al final.
- **El aislamiento aguanta las nueve tablas nuevas** de la Ola 1, en lectura y en escritura.
- **La costura A3↔A6, que no probaba nadie, está probada y en verde** (D-045).
- **Los datos de A1 son auditables**: toda tarifa declara su norma, ninguna se escribió a mano donde había
  una fuente que copiar, y los seeds no contienen una sola línea de lógica ni un solo `UPDATE` sobre una
  tabla paramétrica.

### Estado de la suite al cerrar la Ola 1

`npm test` → **435 pruebas en verde, 21 archivos, CERO fallos y CERO `todo`.** `npm run typecheck` limpio.
Al empezar A14 la compuerta había 346 en verde, 22 `todo` y 2 fallos.

| Archivo | Pruebas | Agente |
|---|---|---|
| `tests/adversarial/compuerta-ola0.test.ts` | 40 | A14 (Ola 0) |
| `tests/adversarial/evasion.test.ts` | 33 | A14 (Ola 0) + 1 de A4 |
| `tests/adversarial/valores-tributarios.test.ts` | **32** | **A14 — reescrita en la Ola 1** |
| `tests/adversarial/casos-dorados.test.ts` | **26** | **A14 — los 20 casos con oráculo propio en SQL** (2 aserciones actualizadas por A1, verificadas por A14) |
| `tests/adversarial/compuerta-ola1.test.ts` | **38** | **A14 — compuerta de la Ola 1, ataques a lo nuevo, y el desbloqueo reverificado** |
| `tests/golden/casos-dorados.test.ts` | 25 | A3 (auditada por A14, se conserva) |
| `tests/gates/*` (esquema, ola0, seguridad, autenticación, ingest) | 134 | A2, A12, A4 |
| `tests/services/*`, `tests/ingest/*`, `tests/seeds/*` | 107 | A6, A4, A1 |

---

## Compuerta de la Ola 0 — veredicto de A14

Verificación **independiente**, con pruebas escritas desde cero en `tests/adversarial/`, tratando las de
A2 y A12 como una afirmación a refutar y no como evidencia. Criterio único: **si el rechazo no trae
SQLSTATE de PostgreSQL, no cuenta.** El arsenal de A14 (`_arsenal.ts`) distingue explícitamente un error
del motor de un `throw` de TypeScript y falla con un mensaje distinto en cada caso.

**Precondición auditada antes de creerle nada al harness:** dentro de `asTenant` el rol efectivo es
`app_user`, no es superusuario, no tiene BYPASSRLS, **no es dueño de ninguna tabla**, y
`row_security_active()` devuelve true sobre siete tablas comprobadas una por una. Si cualquiera de esas
fallara, toda prueba de aislamiento del repositorio sería un falso PASS.

| # | Prueba de la compuerta (sección 4) | Veredicto | Cómo lo verificó A14 |
|---|---|---|---|
| **1** | `UPDATE` sobre `journal_entry` publicado falla a nivel de base de datos | **PASA** (`LG001`) | Nueve vectores: UPDATE idempotente (`SET descripcion = descripcion`), des-publicar a `draft`, anular, UPDATE masivo sin `WHERE`, DELETE masivo sin `WHERE`, DELETE de un borrador, UPDATE/DELETE/INSERT sobre las partidas del publicado, y el mismo intento **como superusuario**. Cerrado con `TRUNCATE`, que **no dispara triggers de fila**: rechazado con `42501` porque el privilegio no existe (barrido de catálogo). **Veredicto final por fotografía**: tras los nueve intentos la fila es idéntica **byte a byte** a la instantánea `to_jsonb` inicial |
| **2** | Asiento desbalanceado rechazado por la BD, no por la aplicación | **PASA** (`LG002` en el COMMIT) | Siete vectores: descuadre de **un centavo**; descuadre introducido **después** de publicar dentro de la misma transacción; `SET CONSTRAINTS ALL IMMEDIATE` (adelanta la validación, no la desactiva); publicación por `UPDATE` crudo **saltándose** `app.publicar_asiento`; asiento de una sola partida (`LG003`); asiento sin ninguna partida; y montos que **desbordan `bigint`** —el motor falla cerrado, no cuadra por desbordamiento—. Control por barrido: **ningún** asiento publicado de la firma descuadra |
| **3** | Una consulta sin filtro de tenant devuelve cero filas de otros tenants | **PASA** | **Barrido por catálogo, no muestra**: las 20+ tablas con `tenant_id` y las 12+ con `company_id`, más **todas** las vistas. Aislamiento en **los dos niveles** y en **los dos sentidos** (también de la segunda empresa hacia la primera). Escritura cruzada rechazada con `42501`. UPDATE y DELETE sin `WHERE` que no rozan ni la otra firma ni la otra empresa. **Y la versión de motor de lo que A12 probaba en TypeScript**: saltándose `withSessionContext`, con token de Alfa y `app.company_id` de Beta forjada por `set_config`, `app.current_company_id()` devuelve NULL y `third_party`, `journal_entry` y `source_document` devuelven **cero**. Sin token, cero filas de cualquier firma en **todas** las tablas |
| **4** | Insertar una vigencia nueva no altera la anterior; una fecha pasada resuelve la regla de entonces | **PASA** (`PR001`/`PR002`/`PR003`) | La vigencia anterior se compara **byte a byte** (`to_jsonb` completo) antes y después de crear la nueva: solo cambia `vigente_hasta`. La resolución se prueba en **cinco fechas** incluidos los dos bordes inclusivos, y se demuestra que resolver por la fecha del hecho da **una tarifa distinta** que resolver por la fecha de proceso —si coincidieran, la Regla 3 estaría rota—. Más: reescribir la tarifa, reabrir el cierre, moverlo, adelantar el inicio, solapar y borrar, los seis rechazados por el motor. **Y la mitad probable del caso dorado 17**: un `retention_applied` ya registrado queda **idéntico** tras dos vigencias posteriores, y no puede mentir sobre qué vigencia usó (FK compuesta, `23503`) |

**Ninguna vulnerabilidad abierta derrota ninguno de los cuatro criterios.** D-032 y D-033 son de
integridad y de despliegue, no de aislamiento ni de inmutabilidad, y ninguna es alcanzable desde una
sesión de aplicación en producción bien configurada. **Veredicto: Ola 0 CERRADA.**

Además, `tests/gates/esquema.test.ts` verifica invariantes del esquema que las olas siguientes no deben romper:
RLS habilitada **y forzada** en toda tabla, política que filtra por tenant en toda tabla con `tenant_id`,
`security_invoker` en toda vista, cero columnas `float`/`double precision`/`money`, triggers de vigencia y de
auditoría en toda tabla paramétrica, relaciones `NOT NULL` obligatorias de la sección 15, y los 5 roles con sus permisos.

**Estado de las pruebas al entregar A2:** `npm test` → 55 pruebas, 2 archivos, todo en verde. `npm run typecheck` limpio.

**Estado de las pruebas al entregar A12:** `npm test` → **120 pruebas, 4 archivos, todo en verde**.
`npm run typecheck` limpio. Las 55 de A2 pasan **sin modificar una sola aserción**, pese al cambio de
fondo del contexto de tenant (D-021).

**Estado de las pruebas al cerrar la compuerta (A14):** `npm test` → **201 pruebas en verde, 8 archivos,
más 22 casos dorados enumerados como `todo`**. `npm run typecheck` limpio. Las 120 de A2 y A12 pasan
**sin modificar una sola aserción**, incluida la migración 017 que corrige D-030 y D-031.

**Estado de las pruebas tras cerrar D-032 y D-033 (A2, migración 018):** `npm test` → **202 pruebas en
verde, 8 archivos, más 22 casos dorados enumerados como `todo`**. `npm run typecheck` limpio. La prueba
que A2 añadió es el barrido de `pg_constraint` de D-037. Se tocaron **tres** aserciones de A14, todas
por el mismo motivo —el guardia es un trigger `BEFORE` y contesta antes que la política, con un código
más específico— y ninguna deja de exigir el rechazo del motor:

| Prueba de A14 | Cambio | Por qué |
|---|---|---|
| `it.fails` de D-032 | convertida en `it` normal, acepta `AL001` | Es lo que A14 dejó pedido al cerrarse el hueco. Sin invertirla habría seguido "pasando" por el motivo equivocado: `rechazoConCodigo` lanzaba porque `AL001` no estaba en su lista, y `it.fails` lo tomaba por éxito |
| D-033, `expect(conTrigger).toEqual([])` | invertida a positivo, y ahora **ejecuta** el TRUNCATE como superusuario | A14 la dejó "medida, no silenciada", pidiendo actualizarla en positivo |
| D-031, forja de `audit_log` con usuario ajeno | acepta `AL001` además de `42501` | El guardia de alcance caza la incoherencia (firma, usuario) antes que la política de 017. Si el guardia desapareciera, la política volvería a contestar `42501` y la prueba seguiría siendo válida |

| Archivo | Pruebas | Agente |
|---|---|---|
| `tests/gates/esquema.test.ts` | 20 | A2 |
| `tests/gates/ola0.test.ts` | 35 | A2 |
| `tests/gates/seguridad.test.ts` | 35 | A12 |
| `tests/gates/autenticacion.test.ts` | 30 | A12 |
| `tests/adversarial/compuerta-ola0.test.ts` | 40 | **A14** — las cuatro pruebas de la compuerta, reescritas desde cero |
| `tests/adversarial/evasion.test.ts` | 32 | **A14** — rutas de evasión, D-030, D-031, D-023, D-024 |
| `tests/adversarial/valores-tributarios.test.ts` | 7 | **A14** — Regla de Oro 2, barrido del código fuente |
| `tests/adversarial/casos-dorados.test.ts` | 2 + 22 `todo` | **A14** — los 20 casos dorados, honestamente sin implementar |

---

## Sección 14.1 — recorrido punto por punto del "día uno", con su estado REAL

Cuatro estados, sin ambigüedad: **implementado** (está en código y hay una prueba que lo demuestra),
**configuración de despliegue** (no es código; hay que hacerlo al desplegar y dejar constancia),
**documentado** (existe el documento, falta la revisión jurídica y los datos de la sociedad),
**pendiente** (no está).

| # | Punto de la 14.1 | Estado real | Dónde / qué falta |
|---|---|---|---|
| 1 | **RLS activa en todas las tablas de datos, doble nivel tenant/company** | **implementado** | `012_rls.sql`. Verificado **desde el catálogo** (`pg_class`, `pg_policies`), no desde una lista: RLS habilitada **y forzada** en toda tabla de `public` salvo `schema_migration`. Además un **barrido de comportamiento** consulta todas las tablas con `tenant_id` y con `company_id` desde una sesión y confirma cero filas ajenas. `tests/gates/seguridad.test.ts` |
| 1b | *(añadido por A12)* **El contexto de aislamiento no lo elige la sesión** | **implementado** | Cierre de D-020. `015`. El tenant se deriva del token verificado; `app.tenant_id` quedó inerte y hay prueba de ello |
| 2 | **Cifrado en tránsito (TLS)** | **configuración de despliegue** | No hay dominio productivo todavía. Exigencias escritas en `docs/cifrado-y-proteccion-de-datos.md` §1: TLS 1.2+, HSTS, cookies `Secure/HttpOnly/SameSite`, y **`sslmode=verify-full`** en `DATABASE_URL` (no `require`, que cifra pero no verifica identidad). **A15 debe ejecutarlo y archivar la constancia** |
| 3 | **Cifrado en reposo** | **configuración de despliegue** (volumen y respaldos) + **implementado** (sobre de aplicación) | El cifrado del volumen y de los respaldos lo da el proveedor gestionado; hay que confirmarlo en el plan contratado y archivar la constancia. Lo que **sí** es código: el secreto TOTP va envuelto en AES-256-GCM con clave fuera de la base (D-028), las contraseñas se derivan con scrypt (irreversible) y del token de sesión solo se guarda su `sha256`. `docs/cifrado-y-proteccion-de-datos.md` §2 |
| 4 | **Autenticación con MFA disponible** | **implementado** | TOTP RFC 6238 en `src/auth/totp.ts`, verificado contra los vectores de RFC 4226 y RFC 6238. Secreto cifrado. Sesiones con vencimiento (8 h; tope duro de 24 h en la BD), revocación individual y masiva, bloqueo tras 5 intentos fallidos, respuesta de tiempo constante ante correo inexistente. **MFA *obligatorio* por rol: pendiente** (requiere interfaz de A7/A8) |
| 5 | **Roles y permisos granulares (5 roles mínimos)** | **implementado** | Los cinco roles y 25 permisos ya existían como datos (`014`). A12 los volvió **restricción del motor** (`016`, D-025): trigger `BEFORE` en 31 tablas que rechaza con `SE002`. Probado: el auxiliar de causación no edita parámetros ni aprueba ni publica; el contador no crea vigencias de tarifas; el rol de solo lectura **no escribe en ninguna** de las tablas protegidas (barrido por catálogo) |
| 6 | **`audit_log` de toda acción sensible** | **implementado** | Append-only impuesto por la BD (`AU001`), ni el superusuario lo altera. Cubre aprobaciones, ediciones de parámetros, cambios de mapeo PUC y de plan de cuentas, **accesos denegados a datos de otra empresa**, **inicios de sesión fallidos**, cierres de sesión, creación/publicación/reversa de asientos, cierre de período y cambios de usuarios y accesos. Registra usuario, `ocurrido_en`, IP, agente y petición. **Las credenciales se redactan antes de escribir** (D-029) |
| 7 | **Política de tratamiento de datos personales y aviso de privacidad** | **documentado** | `docs/politica-tratamiento-datos-personales.md` y `docs/aviso-privacidad.md`. Ley 1581/2012, Decreto 1377/2013, Decreto 1074/2015. **Falta:** revisión jurídica, datos de la sociedad y publicación |
| 8 | **Contrato de transmisión con el cliente (encargado del tratamiento)** | **documentado** | `docs/contrato-encargado-tratamiento.md`, con el contenido del art. 2.2.2.25.5.2 del Decreto 1074/2015: sujeción a instrucciones, seguridad y confidencialidad, y devolución o supresión al terminar. **Falta:** revisión jurídica y firma |
| 9 | **Cláusulas de transferencia internacional** | **documentado** | `docs/clausulas-transferencia-internacional.md`. Se dice con todas las letras que **EE. UU. no está en el listado de países adecuados de la SIC** y se sustenta el flujo en la cadena de **contratos de transmisión** (art. 2.2.2.25.5.1) más autorización expresa. **Falta:** verificar vigencia y numeración exacta de la circular de la SIC y firmar el clausulado con cada proveedor |
| 10 | **Términos y condiciones con limitación de responsabilidad por cálculo tributario** | **documentado** | `docs/terminos-y-condiciones.md` §7, apoyado en los arts. 571, 572 y 581 del Estatuto Tributario y en que **la aprobación humana es un control técnico real**, no una formalidad. **Falta:** revisión jurídica; advertencia expresa sobre el art. 43 de la Ley 1480/2011 si alguna vez hay consumidores |
| 11 | **Procedimiento de consultas y reclamos de titulares** | **documentado** | `docs/procedimiento-consultas-y-reclamos.md`. Plazos de los arts. 14 y 15 de la Ley 1581/2012 (10 y 15 días hábiles, con sus prórrogas), leyenda "reclamo en trámite" en 2 días hábiles y traslado por incompetencia. **Falta:** designar formalmente el área responsable y abrir el buzón |
| 12 | **Procedimiento de reporte de incidentes a la SIC (15 días hábiles)** | **documentado, con dos puntos abiertos** | `docs/procedimiento-incidentes-sic.md`. **Abierto y escrito como tal:** (a) el canal de reporte está asociado al RNBD y **no estamos inscritos** por no superar el umbral del Decreto 090/2018, aunque el deber sustancial subsiste — hay que confirmar el canal correcto **antes** del primer incidente; (b) hay que citar la instrucción vigente que fija los 15 días. Además, **el procedimiento nunca se ha ejercitado con un simulacro** |
| 13 | **Retención de datos por 10 años con reproducción exacta** | **documentado + parcialmente implementado; la prueba falta** | `docs/politica-retencion-datos.md`, art. 28 de la Ley 962/2005. Lo implementado que la sustenta: ledger inmutable, parámetros versionados por vigencia, `audit_log` inalterable, XML original con su hash. **Pendiente real:** no hay rutina automática de supresión al vencimiento (hoy es manual y con autorización), no hay archivo histórico de bajo costo, y **no se ha hecho un ejercicio de restauración que verifique la reproducción exacta** |
| 14 | **Respaldos automáticos con prueba de restauración** | **configuración de despliegue + PENDIENTE la prueba** | Los respaldos los provee el Postgres gestionado; falta contratar y dejar constancia de la ventana de recuperación. **La prueba de restauración NO se ha ejecutado.** Sin ella, la reproducción exacta está afirmada, no verificada. Corresponde a **A15** |

**Lo que la 14.2 dice que puede esperar, y que efectivamente NO se hizo:** RNBD (no aplica hasta
100.000 UVT en activos, ~$5.237.400.000 para 2026, Decreto 090 de 2018 art. 1), certificaciones
ISO 27001 / SOC 2, y habilitación DIAN. Están declarados como no hechos en `docs/README.md`.

---

---

## Qué le falta al sistema para tener un PRIMER CLIENTE REAL operando

> Sección escrita por A0 el 2026-08-31, a petición del usuario. **Solo lista, no resuelve.**
> Distingue tres cosas que se confunden con facilidad: lo que impide **probar** (nada, ya se puede),
> lo que impide **operar con un cliente real**, y lo que impide **vender el servicio a terceros**.
> El sistema hoy: 914 pruebas en verde, los 20 casos dorados pasando, las 3 olas cerradas y
> verificadas de forma adversarial, y la secuencia de arranque corrida de punta a punta por A14
> contra PostgreSQL real.

### A. Bloqueos duros — sin esto NO se puede operar con un cliente real

| # | Qué falta | Por qué bloquea | Dueño |
|---|---|---|---|
| A-1 | **Verificación humana de los datos normativos faltantes** | El motor se niega a calcular lo que no sabe (correcto), pero eso significa que hoy **no puede liquidar** ICA en Bogotá ni Cali por actividad, ni autorretención por CIIU fuera de 4 ejemplos, ni retención de salarios. Un cliente real con esas operaciones queda a medias. Ver «Pendiente de verificación normativa humana» | **Humano con las fuentes** |
| A-2 | **Un XML real de la DIAN, extremo a extremo** | Los 11 fixtures son construidos a mano, no capturas de producción. A4 dejó 5 puntos a re-verificar: autenticidad del CUFE, su ubicación y `schemeName` exactos, códigos DIAN reales, el bloque `DianExtensions` (que no se lee) y la forma real del `AttachedDocument` de un proveedor tecnológico | A4 + humano |
| A-3 | **Buzón de correo real y proveedor de inbound email** | El pipeline existe y está probado, pero **no hay proveedor contratado**. Sin esto las facturas hay que cargarlas a mano | A13 + humano |
| A-4 | **Prueba de restauración de respaldos** | La 14.1 la exige y **nunca se ha ejecutado**. Hoy la conservación a 10 años con reproducción exacta está *afirmada*, no verificada. Es requisito legal (art. 28 Ley 962 de 2005) | A15 + humano |
| A-5 | **Revisión jurídica de los 8 documentos de cumplimiento** | Están redactados y citan la norma, pero ningún abogado los ha visto. Incluye actualizarlos para nombrar al proveedor de LLM (EE. UU., país sin nivel adecuado según la SIC) | **Abogado** |

### B. Operativamente necesario — se puede arrancar sin ello, pero duele pronto

| # | Qué falta | Consecuencia real | Dueño |
|---|---|---|---|
| B-1 | **Pantalla de inscripción de MFA** | El motor TOTP está completo, pero un usuario **no puede activárselo solo**. La 14.1 pide MFA *disponible*: hoy lo está a medias | A12 |
| B-2 | **V-11: cabecera de IP en el despliegue** | La aprobación falla con mensaje claro si falta `x-forwarded-for`/`x-real-ip`, pero **nadie garantiza que el proxy la envíe**. Si no llega, no se puede aprobar nada | A15 |
| B-3 | **`company.es_agente_retencion_*` con valor por defecto** | Misma familia que V-20: una empresa recién creada **solo practica retefuente** hasta que alguien active IVA e ICA. Es configuración que el operador conoce, pero silenciosa | A2 + A12 |
| B-4 | **Pantallas de administración que faltan** | No son editables desde la interfaz: PUC y mapeo NIIF, alta de municipios y CIIU nuevos, matriz de agentes de ReteIVA, calendario tributario, formatos de exógena, y conceptos de causación. El modelo de datos los soporta; falta la pantalla | A8 |
| B-5 | **Marcar las cuentas de efectivo** | Sin ello el Estado de Flujos de Efectivo **sale vacío** (con su papel de trabajo, correctamente). Es configuración de una vez por empresa | Humano, por A8 |
| B-6 | **Causación de ventas** | El producto solo procesa facturas de **compra**, por diseño. Los formatos 1003 y 1006 de exógena quedan incompletos salvo que las ventas se causen por otra vía | Fuera de alcance del mega-prompt |

### C. Antes de vender el servicio a terceros

| # | Qué falta | Dueño |
|---|---|---|
| C-1 | Despliegue real en Render Starter, con `DATABASE_URL` de Postgres gestionada, `APP_ENCRYPTION_KEY` rotable y respaldos activos | A15 + humano |
| C-2 | Ejercitar el procedimiento de incidentes ante la SIC — **nunca se ha ensayado**, y el canal está atado al RNBD, al que no estamos inscritos | A12 + humano |
| C-3 | Prueba de carga real: la §12 pide 5.000 facturas en cola sin degradar el request HTTP. Con `ANALYZE` resuelto (84 s → 6-13 ms) el camino está despejado, pero **no se ha corrido a ese volumen** | A15 |
| C-4 | Conciliación contra el portal de la DIAN. El canal de correo **no es exhaustivo al 100 %** y el producto debe ofrecerla (§10.1) | A4 + A7 |
| C-5 | Archivado en frío del XML. El espacio está reservado (migración 031) y A15 calculó que a 10 años **rompe el techo de USD 50/mes** si vive en la Postgres transaccional. No implementado | A15 + A4 |

### Lo que NO falta

Para que quede dicho, porque es fácil suponer lo contrario: el ledger inmutable, el aislamiento entre firmas, el motor de retenciones con sus 20 casos dorados, la parametrización sin desplegar código, la memoria de clasificación que evita llamar al LLM, la bandeja multiempresa con aprobación en lote, los libros y estados financieros en Excel, la exógena, el arranque sin SQL y los datos de ejemplo **están construidos, probados y verificados de forma adversarial**. Lo que falta arriba es casi todo **dato, contrato, despliegue o juicio humano** — no motor.


## D-089 — DATOS PARAMÉTRICOS (A1, 2026-09-04) — PUC completo Decreto 2650 cargado

**Alcance: TAREA 1 de D-089 — catálogo COMPLETO del PUC como catálogo global de `account`
(`tenant_id IS NULL, company_id IS NULL`). Sin comitear. Compuerta de A14: PENDIENTE.**

### Qué quedó cargado

- **Seed nuevo:** `db/seeds/tanda2/011_puc_completo_2650.sql` (generado desde
  `db/seeds/_fuentes/puc_decreto_2650_catalogo.txt` con un script de un solo uso, no versionado).
  `INSERT ... SELECT ... FROM (VALUES ...)` en 4 lotes por nivel, `parent_id` resuelto por
  subconsulta de prefijo, `WHERE NOT EXISTS` por `(tenant NULL, company NULL, codigo)` → idempotente,
  no pisa nada de tanda1/tanda2 con `UPDATE`.
- **Total global de `account` tras los seeds: 2.506 filas.** 2.502 de la fuente (Decreto 2650
  consolidado) + 4 de clase 7 de 4 díg (`7105/7205/7305/7405`) que tanda2 ya traía y que **no están
  en la fuente** (ver pendientes).
- **Por nivel:** 9 clases · 52 grupos · 344 cuentas (4 díg) · 2.101 subcuentas (6 díg).
- **Por clase (grupos/cuentas/subcuentas):** 1 → 9/106/569 · 2 → 9/90/220 · 3 → 8/27/79 ·
  4 → 3/33/467 · 5 → 5/39/412 · 6 → 2/19/256 · **7 → 4/0/0** · 8 → 6/15/65 · 9 → 6/11/33.
- `norma_respaldo` conceptual (va en `COMMENT ON TABLE account`, no en columna —`account` no la
  tiene): «Decreto 2650 de 1993 (Catálogo de Cuentas), consolidado con Decretos 2894 de 1994 y
  2116 de 1996». **REQUIERE COTEJO HUMANO contra el Diario Oficial antes de producción.**
- **Prueba nueva:** `tests/seeds/puc-completo-d089.test.ts` (10 casos: conteos por nivel/clase,
  clase 7 sin detalle, 0 huérfanos, contra-natura, sufijos (DB)/(CR), `permite_movimiento`,
  `requiere_tercero`, idempotencia). `npx tsc --noEmit` limpio. **Suite completa: 1.263 en verde**
  (antes 1.263; se sumó el archivo nuevo, no hay archivo con conteo fijo de `account` que actualizar
  — la idempotencia de `tanda2.test.ts` compara antes/después, no un número).

### Derivaciones aplicadas (criterio de A1, documentado en el encabezado del seed y en `docs/reportes/d089-a1.md`)

- **nivel** por longitud (1→1, 2→2, 4→3, 6→4).
- **naturaleza** por clase (1 D · 2/3/4 C · 5/6/7/8 D · 9 C), invertida en: (a) contra-activos de
  clase 1 — `1299/1399/1499/1599/1699/1899` provisiones, `1592/1596/1597/1598` depreciación/
  agotamiento/amortización acumulada, `1698` y **`1798`** (amortización acumulada de diferidos —
  llamada normativa de A1, la fuente no la marca); (b) **toda** cuenta cuyo nombre termina en
  `(DB)`/`(CR)` → naturaleza **opuesta a la de su cuenta padre** (cubre grupos 84/85/86 y 94/95/96,
  `4175/4275`, `6225`, `3105 10/15`, `3205 10`, `330516/330518`, `292010/292510`, `262010`,
  `159610`, etc.).
- **permite_movimiento = true** solo en hojas (sin hijos en la fuente); clases y grupos siempre
  `false`; toda subcuenta 6 díg `true`.
- **requiere_tercero = true** por prefijo de código en cuentas por cobrar/pagar a terceros
  identificables (`1305/1310/1315/1320/1323/1325/1328/1365/1370/1380`, `2205/2210`,
  `2305/2310/2315/2320/2335/2355/2357/2360/2365/2367/2368/2380` y sus subcuentas). 99 filas.

### Discrepancias contra lo que tanda1/tanda2 ya habían cargado (NO se pisaron con UPDATE)

| código | nombre en tanda2 | nombre en el Decreto 2650 | nota |
|---|---|---|---|
| `1698` | AMORTIZACIÓN ACUMULADA | DEPRECIACIÓN Y/O AMORTIZACIÓN ACUMULADA | tanda2 abrevió; sin efecto de cálculo |
| `2210` | PROVEEDORES DEL EXTERIOR | DEL EXTERIOR | tanda2 más explícito; misma cuenta |
| `3305` | RESERVA LEGAL | **RESERVAS OBLIGATORIAS** | **error de tanda2**: «Reserva legal» es la subcuenta `330505`. `3305` es agrupador |
| `4155` | ACTIVIDADES DE SERVICIOS | ACTIVIDADES INMOBILIARIAS, EMPRESARIALES Y DE ALQUILER | tanda2 usó rótulo laxo |
| `4245` | RECUPERACIONES | **UTILIDAD EN VENTA DE PROPIEDADES, PLANTA Y EQUIPO** | **error de tanda2**: «Recuperaciones» es `4250` |
| `6155` | DE SERVICIOS | ACTIVIDADES INMOBILIARIAS, EMPRESARIALES Y DE ALQUILER | igual que `4155` |

Además, tanda2 cargó ~40 cuentas de 4 díg con `permite_movimiento = true` que este catálogo dota de
subcuentas (p. ej. `5135`, `2365`, `6205`, `1305`). **A14 las contó en su compuerta: son 52, no ~40**
—todas de nivel 3—, y quedaron clavadas en una lista cerrada en
`tests/adversarial/a14-d089-catalogo.test.ts`, de modo que una cincuenta y tres no puede aparecer sin
que una prueba lo diga. `2365` **ya no está** entre ellas: D-089/A3 la volvió agrupadora.
**No se corrigieron con `UPDATE`**: (1) un seed no
hace `UPDATE` (lo prohíbe `tests/adversarial/valores-tributarios.test.ts`); (2) los escenarios dorados
imputan directamente sobre esas cuentas y volverlas agrupadoras rompería la causación. Queda como
discrepancia a resolver por interfaz (crear el auxiliar y trasladar el saldo). Detalle en
`docs/reportes/d089-a1.md`.

### Decisión de estructura

`tests/adversarial/valores-tributarios.test.ts` — `archivosDeSeeds()` ahora **excluye `db/seeds/_fuentes/`**:
ese directorio guarda catálogos normativos de referencia en texto plano (la fuente desde la que A1
genera los `.sql`), no son seeds y no se aplican a la base. El barrido «todos los seeds son `.sql`» y
«ningún seed hace UPDATE/DELETE» sigue intacto para lo que sí es seed.

---

## Pendiente de verificación normativa humana

Estado al cerrar la Ola 1. **A1 no inventó ni un valor**, y eso se comprobó: las 28 filas de `tax_rule`
declaran su `norma_respaldo`, y las 5 que la sección 17 marca como de referencia llevan
`requiere_verificacion_humana = true`. Censo real de lo que dejan los seeds: `uvt_value` 2,
`tax_concept` 23, `tax_rule` 28 (18 retefuente, 4 autorretención, 3 IVA, 2 ReteIVA, **1 ReteICA —
Medellín**), `rounding_rule` **1** (parámetro operativo global, D-046), `municipality` 6,
`municipality_ica_rule` 4, `ciiu_activity` 7, `account` 111 (→ **2.506 tras D-089/A1, 2026-09-04**),
`niif_mapping` 68, `exogena_format` 12,
`smmlv_value` 0, `tax_calendar` 0.

| Dato | Motivo | Estado |
|---|---|---|
| Tarifas de retefuente **anteriores** al 1-jul-2026 | La sección 7.2 solo trae la tabla posterior al Decreto 572 | pendiente. Afecta al caso dorado 16 en su forma literal; A14 lo verificó con el borde real 30-jun/1-jul, que es el mismo fenómeno con datos verdaderos |
| Tarifas de ICA **por actividad** de Bogotá (incluido el 7,66‰ de profesiones liberales) y **todas** las de Cali | La sección 7.5 no trae la tabla del Decreto 352 de 2002 ni ningún número del Acuerdo 0321 de 2011, y el código municipal de Bogotá no cabe en el esquema | pendiente. **V-5 sigue abierta.** D-088/A1 (2026-09-03) NO cargó Bogotá: no se pudo verificar el Acuerdo 65 de 2002 (ni Acuerdos 98/2003, 780/2020) con la norma real, y el Excel del usuario no es fuente fiable (tarifas dispersas y con ruido). Falta: `municipality_ica_rule` de Bogotá con `practica_reteica=true`, `usa_tarifa_de_actividad=true`, bases mínimas en UVT del Acuerdo, `tipo_medicion_base_minima`; y una `tax_rule` reteica por (Bogotá × CIIU) con la tarifa por mil y el flag `gravada` del Acuerdo vigente |
| **Descripciones** de las 447 clases CIIU cargadas por D-088/A1 | Salen del Excel del usuario, pueden estar abreviadas frente al literal oficial DANE | pendiente de cotejo contra la publicación oficial CIIU Rev. 4 A.C. El código y la sección/división sí están verificados |
| 99 **subclases CIIU de 5 dígitos** del Distrito de Bogotá (74901, 85591, 10201, 46201…) presentes en el Excel de D-088 | `ciiu_codigo_ck` de `ciiu_activity` exige 4 dígitos: son código municipal, no CIIU nacional | pendiente de **decisión de esquema** (misma raíz que V-5). Sin ellas, la carga masiva de ICA de Bogotá por subclase no resolverá esas filas |
| ReteICA Bucaramanga (bases ~25/~50 UVT) y Cartagena | Marcados *(verificar)* en la sección 7.5 | pendiente. No hay valor que copiar |
| Tabla completa de autorretención por CIIU | La sección 7.3 da 4 valores de ejemplo, no la tabla | pendiente, y las 4 filas cargadas llevan `requiere_verificacion_humana` |
| Tabla progresiva de retención por salarios (art. 383 ET) | La sección 7 da el umbral y el rango, no los tramos marginales | pendiente. Ningún caso dorado la ejercita |
| SMMLV y auxilio de transporte por año | La sección 7 no trae valores | pendiente. Ningún caso dorado los ejercita |
| Calendario tributario (`tax_calendar`) | La sección 7.7 da las ventanas de exógena pero no el escalonamiento por dígito de NIT | pendiente. Ningún caso dorado lo ejercita |
| **D-088 — anclaje de la ventana de acumulación de ICA por periodo** | El motor la ancla al **año calendario** (primer periodo desde el 1 de enero del año del hecho; recorte al 31-dic si `periodo_meses` no divide a 12). Ningún acuerdo municipal consultado dice desde cuándo cuenta la ventana | **decisión normativa pendiente de confirmación del cliente final, declarada por A3.** No es bug ni TODO. Alternativa no elegida: anclar a `vigente_desde` de la regla municipal. Cambiarla es tocar `ventanaPeriodoIca` y nada más |
| **D-088 — cruce del umbral a mitad de periodo** | El motor retiene **solo hacia adelante**: la factura que cruza retiene sobre su propia base y lo ya causado antes no se ajusta | **decisión normativa pendiente de confirmación del cliente final, declarada por A3.** Es la lectura conservadora y reversible; la contraria exigiría reescribir asientos publicados (Regla de Oro 1). Consecuencia asociada: la **nota crédito no descuenta del acumulador**, también declarada |
| Honorarios PN al 11% por acumulado anual > 3.300 UVT | Exige un acumulado por tercero y año gravable que hoy no tiene dónde vivir | **declarado por A3, no resuelto en silencio.** Ningún caso dorado lo ejercita |
| **PUC completo (Decreto 2650) cargado por D-089/A1 (2026-09-04)** — 2.506 cuentas globales | La fuente es una transcripción de `puc.com.co` (catálogo de referencia consistente con el Decreto 2650 consolidado), **no el texto del Diario Oficial**. `naturaleza`, `permite_movimiento` y `requiere_tercero` los derivó A1 por regla | pendiente de **cotejo humano del catálogo completo** (nombres literales del Diario Oficial, naturaleza de contra-cuentas dudosas como `1596`/`1798`) antes de producción |
| **Clase 7 (Costos de producción o de operación) — cuentas de 4 díg y subcuentas** | La fuente de D-089 solo expone los grupos `71`–`74`. El detalle (`7105`, `7205`… y sus subcuentas) **no se pudo verificar y NO se inventó**. Las 4 filas `7105/7205/7305/7405` que hoy existen las puso tanda2 de memoria y **tampoco están verificadas** | pendiente. Una empresa manufacturera que necesite costeo por órdenes no tiene el detalle de clase 7 en el catálogo global; debe cargarlo como PUC propio o esperar el cotejo |
| Mapeo NIIF (`niif_mapping`, 68 filas) | Reconstruido de memoria por A1 (Ola 1), no transcrito del Decreto 2420 | pendiente de cotejo antes de producción. Ya lleva `requiere_verificacion_humana = true` |
| Modo y múltiplo de redondeo por defecto (`peso_half_up`) | **No es un dato normativo**: no hay decreto que citar. Es un parámetro operativo, y la tabla donde vive no puede expresar una tarifa (D-046) | **cargado y aceptado.** Cualquier firma lo sobreescribe con datos, sin tocar código — probado |
| Tarifas Decreto 572 de 2025 | En etapa cautelar; fallo de fondo abierto (exp. 30229) | vigente, con riesgo documentado. La Regla 3 lo absorbe sin migración ni redespliegue — probado |
| Un XML **real** de la DIAN | Los 11 fixtures son construidos a mano; el CUFE no es criptográficamente auténtico | pendiente antes de producción. A14 amplió la cobertura con variantes hostiles, pero ninguna sustituye una captura real |

---

## Presupuesto

Sin reporte de A15 todavía. Techo: USD 20/mes (fase inicial) → USD 50/mes (con clientes).
Referencia de costo de IA: USD 0,01–0,02 por factura antes de caché.

**La Ola 1 sumó una sola dependencia** (`fast-xml-parser`, para el parser UBL de A4); scrypt, HMAC y
AES-256-GCM siguen saliendo de `node:crypto`. La cola de A6 vive **en la misma PostgreSQL**: sin Redis y
sin broker, tal como exige la sección 5.

---

## Próximo paso

**2026-09-04 — D-089 pasó la compuerta AMPLIADA de A14: «PASA con correcciones, hechas por A14 en la
misma pasada» (V-47, V-48, V-49 corregidas; V-50 declarada y devuelta a A3).** Estado del árbol:
`npx tsc --noEmit` limpio · `npx vitest run` **1345 en verde, 70 archivos**. Sin comitear (A14 no
comitea). Ver «Compuerta AMPLIADA de D-089 — veredicto de A14».

Pendiente inmediato de D-089:

0. **Aplicar a la Neon las migraciones `179`, `180` y `181` y los seeds `011`/`050`/`070`**, en ese
   orden. Ojo con el orden real de producción: la **180** repara la base **ya sembrada** cerrando la
   vigencia vieja de cada regla de retefuente y abriendo su gemela contra la subcuenta; en esa base
   `2365` **seguirá siendo imputable** a propósito (una vigencia cerrada la cita, y desimputarla
   rompería el reproceso de una factura anterior). Es conducta declarada, no defecto.
1. **Verificación en navegador real de D-089** (usuario): `/parametros/puc` con el PUC completo
   cargado (2.506 cuentas) — la columna «En uso», el modal «Ver uso», el simulador de impacto
   bloqueante y el botón «Exportar PUC a Excel». A14 midió el motor, los servicios y la base; no una
   sesión de teclado y ratón. Y conviene mirar el **rendimiento de la tabla** con el catálogo
   completo, que es la primera vez que esa pantalla ve miles de filas.
2. **V-50 (A3):** extender la red de `verificarCuentasImputables` a `causarNotaCredito` exceptuando
   las cuentas que ya están en el asiento original — si no se exceptúan, se rompe la puerta de la
   reversa que la 179 abre a propósito.
3. **V-47 — revisar el alcance de la corrección al desplegar (A15/A2):** la migración **181** vuelve
   de solo lectura el catálogo global en 18 tablas. Si algún camino administrativo de producción
   corriera **con sesión de negocio** y necesitara tocar una fila global, ahí se enteraría. A14 no
   encontró ninguno (el flujo de parametrización nunca cierra una vigencia global: la sombrea) y la
   suite completa lo confirma, pero la Neon tiene datos que las pruebas no.

Anterior (D-088, ya cerrado):

**2026-09-03 — D-088 pasó la compuerta AMPLIADA de A14: «PASA con correcciones, hechas por A14 en la
misma pasada» (V-43, V-44, V-45, V-46).** Estado del árbol: `npx tsc --noEmit` limpio ·
`npx next build` OK (`/parametros/ica-municipios` incluida) · `npm test` **1242 en verde, 63
archivos** (base D-088/A8 = 1198/60; +44 de la suite de A14). Sin comitear (A14 no comitea).
**Lo único que le falta a D-088 es la verificación en navegador real, que es paso del usuario**, y
aplicar `177`, `178` y el seed `110` a la Neon. Ver «Compuerta AMPLIADA de D-088».

Pendiente inmediato:

0. **Verificación en navegador real de D-088** (usuario): abrir `/parametros/ica-municipios`, recorrer
   los tres bloques editables con el simulador de dos pasos, el modal de «Ver detalle» y la carga
   masiva con un archivo de verdad. A14 midió el HTML, las acciones de servidor y la base; no una
   sesión de teclado y ratón. Antes hay que correr **177**, **178** y el seed **110** en la Neon.

Anterior (D-087, ya cerrado):

1. **Comitear D-086 + D-087** con las correcciones de A14 (V-33…V-38 de D-086 y V-39…V-42 de D-087)
   y las de A12. Las migraciones **175 y 176 ya están aplicadas a la Neon** y el seed corrido: quien
   tenga otra base debe aplicarlas.
2. **Verificación client-side con navegador gráfico** (lo único que A14 no pudo cerrar): abrir con el
   ratón el modal de un badge de alerta y el de «Ver detalle», comprobar el foco atrapado con `Tab`,
   el cierre con `Escape`, y el aspecto de `/parametros` en `data-tema="oscuro"`. A14 verificó el HTML
   servido y el DOM estático del componente, no una sesión de teclado y ratón.
3. **V-42-bis (A1 + A8):** decidir el criterio de «municipio que debe tener regla de ReteICA» ahora
   que `municipality` es el catálogo nacional de 1.122 filas. A14 lo dejó **bloqueado** a propósito:
   es una decisión normativa, no de QA.
4. **D-088 — CERRADO por la compuerta ampliada de A14 (2026-09-03), salvo navegador y despliegue.**
   A2 dejó el **modelo de datos** (migración `177`). A1 (2026-09-03) dejó los
   **datos paramétricos**: catálogo CIIU completo (`db/seeds/tanda2/110_ciiu_completo_d088.sql`, +447
   clases). **Bogotá NO se cargó** (Acuerdo 65/2002 no verificable — ver «D-088 — DATOS PARAMÉTRICOS»
   y «Pendiente de verificación normativa humana»). A3 (2026-09-03) dejó el **motor**: flag `gravada`,
   medición por periodo con `reteica_periodo_acumulado`, `aplicarAcumuladosIca` enganchado a
   `causarFactura` — con **dos asunciones normativas declaradas** que el cliente final debe confirmar
   (anclaje de la ventana al año calendario; retención **solo hacia adelante** al cruzar el umbral a
   mitad de periodo). Ver «D-088 — MOTOR». A8 (2026-09-03) dejó la **interfaz**
   (`/parametros/ica-municipios`), la **carga masiva** de un municipio completo
   (`src/services/carga-masiva/ica-municipio.ts` + `GET /api/plantillas/ica_municipio_d088`) y el
   **permiso** propio (migración **178**, `parametro.ica.{leer,editar}`). Ver «D-088 — INTERFAZ,
   CARGA MASIVA y PERMISOS». **A14 (2026-09-03) pasó la compuerta ampliada**: 44 pruebas propias en
   3 archivos, los 20 casos dorados reverificados uno por uno, y cuatro defectos corregidos por él
   mismo (**V-43** guard heredado, **V-44** «Gravada» en blanco y «Por periodo» sin ventana, **V-45**
   plantilla con valores tributarios precargados, **V-46** etiqueta tomada por valor). `npm test`
   **1242/63**. Las migraciones 177 y 178 y el seed 110 **no están aplicados a la Neon**.
5. **Deuda del segundo modal:** `app/_ui/CargaMasiva.tsx` conserva markup propio de diálogo, sin
   `Escape` ni foco atrapado. Se salda cuando se migre `/carga-masiva` (sigue en
   `PREFIJOS_SIN_MIGRAR`, junto con `/reportes` y `/admin`).

Después: Fase 5+ del roadmap de front (reportes y admin).

---

<details>
<summary>Próximo paso de la Ola 4 (histórico)</summary>

**OLA 4 ENTREGADA por A16 (2026-09-01). PENDIENTE: la compuerta de A14.** Nada de la Ola 4 está cerrado
hasta que A14 lo verifique él mismo, sin creerle a este documento. Estado medido por A16: **993 pruebas en
verde** (48 archivos), `npx tsc --noEmit` limpio, `npx next build` exit 0 con **28 rutas**.

Qué tiene que atacar A14, en orden de riesgo:

1. **El blindaje del rol todopoderoso (D-066).** Está en `tests/adversarial/compuerta-ola4.test.ts`, pero
   lo escribió quien construyó el blindaje. A14 debería intentar degradarlo por caminos que a A16 no se le
   ocurrieron: `ALTER TABLE ... DISABLE TRIGGER`, un `UPDATE` sobre `pg_trigger`, revocar el acceso del
   único usuario que lo tiene en vez de tocar el rol.
2. **La carga masiva como puerta a otra firma.** Un archivo no nombra empresa ni firma en ninguna columna,
   y la RLS gobierna la escritura; A14 debería comprobar que eso aguanta con una columna extra inventada,
   con un `codigo_dane` que ya existe en la firma de al lado, y con la sesión de una empresa a la que el
   usuario perdió el acceso a mitad de la carga.
3. **`v_account_efectivo` con `security_invoker`.** Es una vista nueva en el camino de los reportes y del
   ledger: conviene un `SET ROLE app_user` directo comprobando que no enseña ni una cuenta de otra firma,
   y que `app.puc_solo_propio()` no se puede engañar escribiendo `company_setting` de otra empresa.
4. **La aprobación jerárquica (D-068).** El cambio de comportamiento más delicado de la ola: desde ahora
   `obtenerCorreccionesVigentes` filtra por `estado = 'aprobado'`. A14 debería confirmar contra el motor
   que una corrección pendiente no altera NINGÚN cálculo, y que aprobarla no reescribe un asiento ya
   publicado.
5. **Las dos pruebas suyas que A16 acotó**, con la justificación escrita en «Ola 4 — qué entregó A16».
   Son exactamente el caso de D-047: A14 revisa el diff, no el reporte.

Ficheros nuevos de la Ola 4:

- `db/migrations/170_a16_ola4_operacion_real.sql`
- `src/services/puc.ts`, `src/services/catalogos.ts`, `src/services/administracion.ts`
- `src/services/carga-masiva/` (`definiciones.ts`, `valores.ts`, `tabla.ts`, `importar.ts`, `plantilla.ts`)
- `src/reports/diagnostico.ts`
- `scripts/generar-plantillas-masivas.ts` + `/archivos-masivos/` (quince `.xlsx` y su `LEEME.md`)
- `app/_navegacion.tsx`, `app/carga-masiva/**`, `app/api/plantillas/[catalogo]/route.ts`,
  `app/parametros/puc/**`, `app/admin/**`, `app/cambiar-password/**`
- `tests/services/ola4-carga-masiva.test.ts`, `tests/adversarial/compuerta-ola4.test.ts`,
  `tests/app/reportes-diagnostico.test.ts`

Ficheros existentes que A16 tocó: `app/layout.tsx`, `app/page.tsx`, `app/reportes/page.tsx`,
`app/parametros/page.tsx`, `app/terceros/[id]/actividades/{page.tsx,acciones.ts}`,
`app/api/reportes/[libro]/route.ts`, `src/services/terceros.ts`, `src/services/bandeja.ts`,
`src/auth/permisos.ts`, `next.config.ts`, `package.json`, `tsconfig.json`, y las dos pruebas de A14
declaradas arriba.

</details>

---

## Próximo paso — lote posterior a la Ola 3 (histórico)


**LOTE POSTERIOR A LA OLA 3 APROBADO por A14 (2026-08-31).** Verificado punta a punta contra un
PostgreSQL real, corriendo la secuencia completa del README como la correría el usuario que no
programa. Los tres criterios pasan con las correcciones de A14 incorporadas: **914 pruebas en verde**
(45 archivos), typecheck limpio, `npx next build` exit 0 (19 rutas). Falta únicamente el **commit de
cierre, que lo hace A0** (A14 no hace commits).

Ficheros que A14 tocó en esta pasada:

- `db/migrations/160_a14_v20_atributos_fiscales_sin_default.sql` — **nuevo**: quita el `DEFAULT` de las
  diez columnas fiscales de `third_party_fiscal_attribute` (V-20).
- `next.config.ts` — **nuevo**: `agentRules: false`, para que `npm run dev` deje de reescribir
  `CLAUDE.md` (V-22).
- `tests/adversarial/valores-tributarios.test.ts` — el barrido de la Regla de Oro 2 alcanza el código
  ejecutable de la raíz del repositorio, con su aserción de cobertura (V-21).
- `tests/adversarial/evasion.test.ts` — 12 pruebas de regresión de V-20.
- `tests/helpers/fixtures.ts`, `tests/golden/_escenario.ts`, `tests/gates/arranque.test.ts` — las tres
  llamadas que se apoyaban en el `DEFAULT` ahora declaran las nueve banderas a la vista.
- `ESTADO_PROYECTO.md`.

### Lo que queda abierto, con dueño

Ninguno bloquea una compuerta; todos son deuda conocida antes de producción.

| Qué | Quién | Gravedad |
|---|---|---|
| **V-11** — la aprobación desde la bandeja revienta si el despliegue no reenvía la IP del cliente | **A7** + **A15** | Media |
| **V-5** — no hay tarifas de ReteICA por actividad para Bogotá ni Cali (dato normativo faltante, no inventado) | **verificación humana** + **A1** | Media (dato) |
| `company.es_agente_retencion_*` con valor por defecto: la misma familia de V-20, en la empresa en vez de en el tercero | **A2** + **A12** | Baja-media |
| No hay pantalla de inscripción de MFA: hoy el secreto lo siembra un operador | **A12** | Media antes de producción |
| Prueba de restauración de respaldos (de ella depende la «reproducción exacta» del punto 13 de la 14.1) | **A15** | Alta antes de producción |
| Simulacro de incidente y revisión jurídica de los documentos de habeas data | **humano** + **A12** | Alta antes de producción |
| Prueba de carga de 5.000 facturas en cola (§12) | **A6** + **A13** + **A15** | Sin dueño efectivo desde la Ola 2 |
| Datos normativos pendientes de verificación humana (ver su sección) | **humano** + **A1** | Alta antes de producción |

### Advertencias que salen de esta verificación, para quien retome

- **Tres capas de aplicación no son tres capas** (V-20). Si la garantía tiene que sostenerse, la última
  capa es el motor: mientras la columna tenga `DEFAULT`, el `INSERT` que omite el dato no falla, lo
  inventa. Un `DEFAULT` es la forma en que un dato faltante se vuelve invisible — exactamente lo que la
  advertencia 17.5 prohíbe.
- **Una salvaguarda solo cubre lo que enumera** (V-21). El detector de la Regla de Oro 2 barría tres
  directorios; el primer archivo ejecutable que apareció fuera de ellos quedó invisible. Toda lista de
  rutas necesita una aserción que se caiga cuando alguien saque algo de la lista.
- **Una dependencia puede escribir en el archivo de reglas del proyecto** (V-22). `next dev` reescribía
  `CLAUDE.md` en cada arranque e invitaba a comitearlo. Revertirlo a mano no es cerrarlo.
- **Verificar «el usuario puede usarlo» exige correrlo, no leerlo.** El defecto de A15 (nadie ejecutaba
  la cola en producción) solo se confirma viendo `document_processing_job.tomado_por = web-<pid>`
  después de levantar el servidor de verdad.
- **Con PGlite, cada comando sin `DATABASE_URL` vive en su propia base desechable.** Es correcto y está
  documentado, pero es la primera piedra con la que tropieza quien no programa.

---

<details>
<summary>Próximo paso tras la Ola 3 (histórico, superado por el lote posterior)</summary>

### Próximo paso — cierre de la Ola 3 (histórico)

**OLA 3 CERRADA por A14 (2026-08-31), en la segunda pasada. Con ella se cierra la última ola del plan de
la sección 4.** Los dos criterios de salida pasan, más `npx next build`. Falta únicamente el **commit de
cierre, que lo hace A0** (A14 no hace commits).

Estado del árbol al cerrar: **849 pruebas en verde**, 43 archivos, typecheck limpio, `next build` exit 0
con 13 rutas (incluidas `ƒ /api/reportes/[libro]` y `ƒ /reportes`). Ficheros que A14 tocó en la segunda
pasada:

- `app/api/reportes/[libro]/route.ts` — `Object.hasOwn` en el despacho por slug (V-19, D-061).
- `tests/adversarial/compuerta-ola3-ruta.test.ts` — **nuevo**: los veinte libros por HTTP, la prueba de
  «ningún libro huérfano» y los nueve ataques a la ruta.
- `ESTADO_PROYECTO.md`.

(De la primera pasada: `src/services/cierre.ts`, `tests/adversarial/compuerta-ola3.test.ts`,
`tests/adversarial/compuerta-ola3-entregas.test.ts` y `tests/adversarial/valores-tributarios.test.ts`.)

### Lo que queda abierto al cerrar el plan de olas, con dueño

Ninguno bloquea una compuerta; todos son deuda conocida antes de producción.

| Qué | Quién | Gravedad |
|---|---|---|
| **V-17** — no hay maestro de terceros: impide completar el Formato 1001 y, más grave, **impide causar la factura de un proveedor que nadie haya insertado por SQL**. Hoy no se pone en marcha un cliente nuevo sin acceso a la base | **A8** | Media-alta como producto |
| **V-18** — las advertencias de alcance de los formatos 1003/1006 no llegan al Excel que revisa el contador | **A11** | Baja |
| **V-11** — la aprobación desde la bandeja revienta si el despliegue no reenvía la IP del cliente | **A7** + **A15** | Media |
| **V-1** — `app.resolver_empresa_por_buzon` sigue concedida a `app_user` | **A4** + **A12** | Baja |
| **V-5** — el código de actividad de ICA municipal de Bogotá (5 dígitos) no cabe en `ciiu_activity` | **A2**, luego **A1** | Media (dato) |
| Prueba de carga de 5.000 facturas en cola (§12) | **A6** + **A13** + **A15** | Sin dueño efectivo desde la Ola 2 |
| `ANALYZE` tras una carga masiva, o los primeros reportes de esa empresa se arrastran (D-057) | **A15** | Operativa |
| Datos normativos pendientes de verificación humana (ver su sección) | **humano** + **A1** | Alta antes de producción |

### Advertencias que salen de esta verificación, para quien retome

- **Un módulo sin consumidor no está terminado** (V-16, D-062). Y la comprobación no es «existe una ruta»,
  sino «no queda ningún libro huérfano»: se enumeran los exports y se exige que todos estén cableados.
- **Si la clave la elige el cliente, la búsqueda se hace por propiedad propia** (V-19, D-061). `obj[clave]`
  con clave externa recorre el prototipo, y `constructor` es una función invocable.
- **Cuando una prueba compara A con B, hay que mirar si A y B leen de la misma fuente** (D-057).
- **La idempotencia por clave no protege del solape** (D-058): toda operación idempotente sobre un *rango*
  debe decidir qué pasa cuando el rango nuevo se cruza con uno anterior.
- **Si una prueba con datos de verdad tarda de más, mide antes de acusar al diseño** (D-057): 159 s
  pasaron a 4 ms con un `ANALYZE`.

---


</details>

---

## Próximo paso — Ola 3 despachada (histórico)

**OLA 2 CERRADA por A14.** Los tres criterios de la sección 4 pasan, verificados con pruebas propias y
**por la interfaz real**. Falta únicamente el **commit de cierre, que lo hace A0** (A14 no hace commits).
Después de eso, despachar la **Ola 3** (A9, A10, A11).

Estado del árbol al cerrar: **603 pruebas en verde**, 32 archivos, typecheck limpio, cero `todo`.
Ficheros que A14 tocó en esta pasada y que entran en el commit de cierre:

- `src/services/causacion.ts` — `SAVEPOINT` por ítem en `aprobarAsientosEnLote` (D-050).
- `tests/adversarial/valores-tributarios.test.ts` — salvaguarda restituida y canario reparado (D-049).
- `tests/adversarial/compuerta-ola2.test.ts` — **nuevo**.
- `tests/adversarial/compuerta-ola2-interfaz.test.ts` — **nuevo**.
- `ESTADO_PROYECTO.md`.

### Condiciones que A0 debe trasladar a la Ola 3

1. **A7 + A15 — V-11, la IP de la aprobación.** `approval.ip` es `NOT NULL` y la bandeja solo lee
   `x-forwarded-for`. Sin esa cabecera, aprobar devuelve un error crudo de PostgreSQL. A7: leer también
   `x-real-ip` y, si no hay ninguna, dar un mensaje accionable en vez de propagar el error del motor.
   A15: garantizar la cabecera en el despliegue. **Es lo único abierto que toca un criterio de salida.**
2. **A4 + A12 — V-1, ya desbloqueada.** Mover el `GRANT` de `app.resolver_empresa_por_buzon` fuera de
   `app_user` ahora que el rol de sistema del canal de correo existe (D-054). Ojo: el camino de A4
   (`src/ingest/persistencia.ts`) todavía la llama, así que la corrección incluye decidir si ese camino
   se retira en favor del de A13 o se le da su propia autenticación.
3. **A2 — V-5, el esquema del código de actividad de ICA municipal.** Sigue siendo la única deuda de
   datos. `ciiu_activity` exige 4 dígitos; Bogotá usa `74901`, de 5.
4. **A6 + A13 + A15 — la prueba de carga** de 5.000 facturas en cola sin degradar el request HTTP
   (sección 12, pruebas adicionales). Era advertencia para la Ola 2 y nadie la tomó.
5. **A5 — los pendientes que él mismo dejó anotados**: no hay job de cola para clasificación (A5-2) y la
   bandeja de revisión de clasificación no tiene interfaz (A5-3, es de A7).
6. **A1 — cargar lo que quede verificado** de `smmlv_value` y `tax_calendar` cuando un humano aporte los
   valores. Ningún caso dorado depende de ello.

### Advertencias para la Ola 3 que salen de esta verificación

- **Toda pantalla nueva se prueba por su acción de servidor, no por el servicio** (D-056). Probar el
  servicio deja sin verificar precisamente la costura donde el cliente elige qué enviar, que es donde
  vive el contador hostil. El patrón ya está montado en
  `tests/adversarial/compuerta-ola2-interfaz.test.ts`: se simulan `next/headers`, `next/navigation` y
  `app/lib/db.ts`, y **nada más**.
- **Todo bucle que escriba dentro de una sola transacción necesita `SAVEPOINT` por ítem.** Ya van dos
  (D-043 en la causación, D-050 en la aprobación en lote) y las dos veces el `try/catch` parecía
  suficiente y no lo era: un error del motor aborta la transacción entera y el `catch` solo colecciona
  `25P02`. A9/A10/A11 van a escribir en lote (cierres, ajustes, exportaciones): aplíquenlo desde el
  principio.
- **Acotar una salvaguarda es la dirección peligrosa** (D-049). Se puede hacer, y A8 tenía razón en la
  necesidad; lo que no se puede es sustituir la salvaguarda por una **afirmación** («las otras reglas ya
  lo cazan») sin comprobarla. A14 la comprobó y era falsa en cuatro formas. Quien acote algo de A14, que
  traiga el canario que demuestre que lo que quita sigue cubierto.
- **Un contador que no sube no prueba nada; una mina que no explota, sí** (D-052). Para «no se llamó a
  X», el instrumento correcto es un doble que **revienta** al ser llamado, más un espía en la frontera
  del proceso — no un contador que solo vigila el objeto que la propia prueba inyectó.
- **Una función `SECURITY DEFINER` nueva se declara en las DOS copias del inventario** (D-042) **y se
  audita como oráculo de existencia**: misma respuesta ante un identificador ajeno real y uno inventado.
  Diez funciones nuevas pasaron esa prueba en esta ola; la undécima tendrá que pasarla también.
- **`db/seeds` sigue siendo dato, `src/` sigue siendo código.** Un `INSERT` normativo en `src/` o `app/`
  solo puede llevar parámetros ligados. Si una pantalla necesita escribir un valor, el valor viene del
  formulario en un `$n`, nunca escrito en la sentencia.

### Lo que queda listo y no hay que rehacer

- Todo lo de las Olas 0 y 1 (esquema, RLS, ledger, vigencias, motor, parser, cola, servicios, datos).
- **La clasificación asistida y la memoria de A5**: determinista, con catálogo cerrado, sin ruta de red
  estática y con el caso dorado 19 cerrado de verdad.
- **La bandeja multi-empresa de A7**: una sesión por empresa, sin atajos que rompan D-021/D-022,
  verificada a escala real (31 empresas, 50 aprobaciones) y contra dos ataques de falsificación.
- **El módulo de parametrización de A8**: primera interfaz del repositorio, con las seis conductas de
  §6.2 y el simulador de impacto; verificado por su acción de servidor y contra el contador hostil.
- **El canal de integración de A13**: token de máquina que desemboca en el `abrir_sesion` intacto, rol de
  sistema de mínimo privilegio real, y los seis workflows de n8n sin una línea de lógica tributaria.
- El harness `tests/helpers/` y las **siete** suites adversariales de A14.

---

<details>
<summary>Próximo paso de la Ola 1 (histórico, cerrado)</summary>

### Próximo paso — Ola 1 (histórico)

**OLA 1 CERRADA por A14.** Los cuatro criterios de la compuerta pasan, verificados con pruebas propias, y
—lo que decidía el cierre— el pipeline produce asientos publicados **con el repositorio tal como está**,
sin que ninguna prueba inserte un parámetro a mano. Falta únicamente el **commit de cierre, que lo hace
A0** (A14 no hace commits). Después de eso, despachar la **Ola 2** (A5, A7, A8, A13).

### Condiciones que A0 debe trasladar a la Ola 2

1. **A2 — decidir el esquema del código de actividad de ICA municipal.** `ciiu_activity` exige 4 dígitos;
   Bogotá usa `74901`, de 5. Hasta que se decida (ampliar el CHECK o modelar una tabla de actividades
   municipales aparte), la ReteICA por actividad de Bogotá y Cali es inalcanzable y los casos dorados 9 y
   10 conservan su tarifa sobre andamiaje. **Es la única deuda de datos que queda** (V-5, D-048).
2. **A12 + A4 — mover el `GRANT` de `app.resolver_empresa_por_buzon`** de `app_user` al rol de sistema del
   canal de correo, en cuanto ese rol exista, y revocarlo de `app_user` (V-1, D-042).
3. **A12 + A6/A13 — la sesión de sistema del canal de correo** (V-9). Sin ella el correo entra pero nadie
   puede escribir por él.
4. **A7 — dos campos editables en la bandeja** que hoy dejan dos casos dorados sin canal real: el **AIU por
   línea** (V-7) y el **municipio de la operación** cuando difiere del domicilio del proveedor (V-8).
5. **A1 — cargar lo que quede verificado** de las tablas todavía vacías (`smmlv_value`, `tax_calendar`) y
   de las municipales pendientes, cuando un humano aporte los valores. Ningún caso dorado depende de ello.

### Advertencias para la Ola 2 que salen de esta verificación

- **A5**, al construir la clasificación: el caso dorado 19 está a medio verificar y la mitad que falta es
  suya. Lo probado hoy es que **no hay ninguna ruta de red en todo `src/`** y que la segunda factura del
  mismo proveedor con la misma descripción se resuelve desde `memoria_clasificacion` sin crear filas
  nuevas. Cuando exista el LLM, la prueba tiene que **contar llamadas**, no suponerlas.
- **A5**: `src/ai/` hará **fallar** el canario de inventario de módulos de `src/` (D-044). Es a propósito:
  se declara el módulo y se comprueba que el barrido de la Regla 2 lo cubre.
- **A8**, al construir la parametrización: el mecanismo ya está probado tres veces —`tax_rule`,
  `uvt_value` y `rounding_rule`—: cerrar la vigencia e insertar la nueva cambia lo posterior, no toca lo
  publicado y no exige redespliegue. Lo que falta es la pantalla, no el motor. Y ojo con D-046: si alguna
  pantalla permite cargar un parámetro **sin norma**, la tabla destino debe ser incapaz de expresar una
  tarifa.
- **Cualquiera que toque el ledger, la cola o los seeds**: las garantías las impone la base, no el
  TypeScript, y hay una prueba por cada una que se salta el servicio y ataca la tabla directamente. Una
  migración que añada una FK necesita su guardia de alcance (D-037) y su trigger de auditoría, o los
  barridos de `tests/gates/esquema.test.ts` y `tests/adversarial/evasion.test.ts` la cazan. Un seed nuevo
  con un `UPDATE` sobre una tabla paramétrica lo caza `valores-tributarios.test.ts` (D-039).
- **Quien toque una prueba de A14**: se puede, y A1 lo hizo bien (D-047). El criterio es el de siempre —
  una aserción se **actualiza al estado nuevo sin bajar la vara**, y quien la toca lo declara. A14 revisa
  el diff, no el reporte.

### Lo que queda listo y no hay que rehacer

- El esquema completo con RLS de doble nivel activa y forzada, y el ledger inmutable (A2, Ola 0).
- El contexto de tenant derivado de un token verificado, con `app.tenant_id` inerte (A12, D-021).
- **El motor determinista de A3**, auditado contra la base y no contra sí mismo.
- **El parser UBL de A4**, incluido el `AttachedDocument` en base64, en CDATA y con prefijos ajenos.
- **La cola y los servicios de A6**, con idempotencia impuesta por `UNIQUE` y concurrencia por
  `FOR UPDATE SKIP LOCKED`.
- **Los datos normativos de A1**: 28 reglas tributarias, todas con norma de respaldo, más el parámetro
  operativo de redondeo.
- El harness `tests/helpers/` y las cinco suites adversariales de A14.

</details>

---

## Compuerta AMPLIADA de V-23 — veredicto de A14 (2026-09-02): **PASA, con el fix corregido en la misma pasada**

A14 no verificó por reporte. Escribió su propia suite adversarial
(`tests/adversarial/a14-v23-ampliada.test.ts`, **30 pruebas**, sin reusar ni una aserción de las que A3/A2/A7
entregaron con el fix) y la corrió. **El fix de V-23 funciona para el caso que se propuso arreglar, pero
llegó con seis defectos**, dos de ellos de gravedad alta y uno con consecuencia legal directa. Los seis
están corregidos, con prueba de regresión que falla sin el parche.

### Lo que se atacó y qué salió

| Vector | Resultado |
|---|---|
| **RO-1 byte a byte** — foto completa (asiento + líneas + `retention_applied`) del asiento anulado antes y después del reproceso | **PASA.** Idéntica. El anulado no se toca, sigue `anulado`, y la BD sigue negando resucitarlo a `draft` |
| **Carrera / doble procesamiento** — dos causaciones sobre el documento reintegrado, saltándose la cola; documento forzado a `parseado` con su asiento vivo | **PASA.** Un solo asiento vivo. El perdedor devuelve `ya_procesado` con el id del asiento VIVO, no `null`. `reclamarSiguienteJob` no entrega dos veces el mismo trabajo. `compuerta-ola1` «carrera detectada» sigue verde |
| **`REPROCESO_BLOQUEADO` no relajado** — `draft` vivo, `posted` vivo | **PASA** para facturas. **FALLA para notas crédito → V-32**, corregido |
| **Reintegrar dos veces seguidas**, sin causar en medio | **PASA** (`ESTADO_INVALIDO`) |
| **Reintegrar un documento sin trabajo de causación previo** | **FALLA → V-31**, corregido |
| **`archivado` terminal** | **PASA.** No se reintegra y desaparece de la sub-bandeja |
| **Aislamiento RO-7** — reintegrar el documento de otra firma, con la firma nueva de dos argumentos | **PASA** (`DOCUMENTO_INEXISTENTE`; el documento no se mueve) |
| **Permisos** — `solo_lectura` reintegrando | **PASA** |
| **Caso dorado 18** — reprocesar 10 veces un documento ya causado sin rechazo | **PASA.** Un asiento, foto idéntica, y **ninguna clave `#n` espuria**: el primer intento sigue usando la clave base |
| **Nota crédito rechazada y reintegrada** | **FALLA → V-28** (rompía el worker con `23505` no manejado), corregido |
| **Divergencia ledger ↔ traza** — `retention_applied` del anulado vs. el nuevo en reportería | **FALLA → V-30.** Certificado de retenciones y exógena reportaban **el doble**. Corregido. El ledger publicado (`v_journal_line_reporte`) nunca estuvo mal: trae la retención una sola vez |
| **`v_reproceso_n` / audit** con 0, 1 y 2 anulados | **PASA.** Número correcto, `asiento_anulado_previo` apunta siempre al último anulado, `desde_estado` fiel, motivo en blanco se guarda como `null` |
| **RO-2** sobre los cuatro archivos que tocó el fix | **PASA.** `#n` es identificador técnico; ni una tarifa, base, UVT ni calendario |
| **El índice que 172 documentaba** | **NO EXISTÍA → V-27**, creado |

### Defectos encontrados y corregidos por A14 (detalle en el registro de vulnerabilidades)

- **V-27** — el índice `journal_entry_causacion_viva_uq` que la migración 172 declaraba en su `COMMENT` no
  existía. Creado en la migración **173**, con alcance estrecho (`idempotency_key LIKE 'causacion:%'`) para
  no limitar los asientos manuales que un contador registre contra el mismo documento.
- **V-28** — nota crédito rechazada: irrecuperable **y** con la cola en fallo permanente. Índice parcial
  `journal_entry_reversa_viva_uq` + el `SAVEPOINT`/`catch` que `causarNotaCredito` nunca recibió (D-043 solo
  se aplicó a `causarFactura`).
- **V-29** — traza huérfana de retenciones cuando la causación acaba en revisión manual después del
  `SAVEPOINT`.
- **V-30** — **doble conteo en el certificado de retenciones y en la exógena.** El de mayor consecuencia:
  un certificado es un documento legal que se entrega al proveedor.
- **V-31** — `JOB_INEXISTENTE` en el camino que la propia función de base contempla.
- **V-32** — el resguardo `REPROCESO_BLOQUEADO` no cubría las notas crédito. Verificado **quitando el
  parche** y viendo pasar la reintegración: no es teoría.

### Estado de las restricciones que el fix no podía violar

1. **RO-1** — respetada, probada byte a byte.
2. **RO-2** — respetada, probada sobre los archivos tocados.
3. **`REPROCESO_BLOQUEADO` por defecto** — lo estaba para facturas; **no lo estaba para notas**. Ahora sí.
4. **Reproceso trazado** — quién, cuándo, desde qué estado, con qué motivo y qué asiento quedó atrás.

### Verificación final

`npx tsc --noEmit` limpio · `npx next build` compila y emite todas las rutas · `npm test`: **51 archivos,
1052 pruebas, todas en verde** (la línea base antes de esta compuerta era 50 archivos / 1022 pruebas).
Ningún commit: A14 no comitea.

### Deuda declarada que queda abierta (no bloquea)

- **V-30, residual acotado.** El filtro de las consultas de retenciones deja pasar las filas con
  `journal_entry_id IS NULL` para no romper los fixtures de A9/A11, que insertan `retention_applied` sin
  asiento. Con **V-29** corregido, el motor ya no produce esas filas, así que el residuo es solo de
  pruebas. **Lo correcto a futuro (A9/A11): exigir `EXISTS(... posted)` a secas y realistar esos fixtures.**
- **`retencionesPorPeriodo`** conserva las filas de asientos en **borrador** a propósito (su función es
  diagnóstica: mostrar por qué NO se retuvo). Quien lo lea como «lo practicado en el período» se equivoca
  por un asiento pendiente de aprobar. **Decisión de A9** si debe marcarse el estado en la columna.
- **Aviso de build preexistente**, ajeno a esta compuerta: `src/db/dns-fix.ts` (sin versionar) importa
  `node:dns` y el Edge Runtime lo rechaza. El build termina bien. **Es de quien lo introdujo (A15/infra).**

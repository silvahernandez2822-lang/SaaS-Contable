# Plantillas de carga masiva

**Este directorio es producto derivado. No se edita a mano.**

Se regenera con:

```bash
npm run plantillas-masivas
```

La fuente es `src/services/carga-masiva/definiciones.ts`, el mismo archivo que
usa el importador para validar lo que usted sube. Por eso la plantilla y el
importador no pueden desincronizarse: son la misma lista de columnas leída dos
veces (D-071).

Dentro del producto, estas mismas plantillas se descargan desde
`/carga-masiva` (o directamente en `/api/plantillas/<catalogo>`), generadas en
el momento: esa ruta nunca sirve los archivos de este directorio, para que un
despliegue con el directorio viejo no entregue plantillas que su propio
importador rechaza.

Cada archivo trae dos hojas: **Datos** (encabezados exactos, con las columnas
obligatorias en rojo y con asterisco, y una fila de ejemplo ya llena) e
**Instrucciones** (qué espera cada columna, en qué formato, y de dónde sacar los
valores válidos cuando dependen de otro catálogo).

## Orden de carga

Cárguelos en este orden: cada uno solo depende de los anteriores.

| # | Archivo | Catálogo | Tabla | Módulo | Se sube en |
|---|---|---|---|---|---|
| 1 | `municipality.xlsx` | Municipios (catálogo DANE) | `municipality` | Parámetros › ReteICA | `/carga-masiva/municipality` |
| 2 | `ciiu_activity.xlsx` | Actividades económicas CIIU | `ciiu_activity` | Parámetros | `/carga-masiva/ciiu_activity` |
| 3 | `account.xlsx` | Plan de cuentas (PUC) | `account` | Parámetros › Plan de cuentas | `/carga-masiva/account` |
| 4 | `cost_center.xlsx` | Centros de costo | `cost_center` | Parámetros › Plan de cuentas | `/carga-masiva/cost_center` |
| 5 | `niif_mapping.xlsx` | Mapeo de cuentas PUC a NIIF para PYMES | `niif_mapping` | Parámetros › Plan de cuentas | `/carga-masiva/niif_mapping` |
| 6 | `tax_concept.xlsx` | Conceptos tributarios | `tax_concept` | Parámetros › Tarifas | `/carga-masiva/tax_concept` |
| 7 | `tax_rule.xlsx` | Tarifas de retención (retefuente, ReteIVA, ReteICA, autorretención, IVA) | `tax_rule` | Parámetros › Tarifas | `/carga-masiva/tax_rule` |
| 8 | `tax_rule_salarios.xlsx` | Tabla progresiva de retención por salarios (art. 383 ET) | `tax_rule (tipo retefuente_salarios)` | Parámetros › Tarifas | `/carga-masiva/tax_rule_salarios` |
| 9 | `municipality_ica_rule.xlsx` | Reglas de ReteICA por municipio (bases mínimas y tarifa general) | `municipality_ica_rule` | Parámetros › ReteICA | `/carga-masiva/municipality_ica_rule` |
| 10 | `uvt_value.xlsx` | UVT por año | `uvt_value` | Parámetros › Valores base | `/carga-masiva/uvt_value` |
| 11 | `smmlv_value.xlsx` | SMMLV y auxilio de transporte por año | `smmlv_value` | Parámetros › Valores base | `/carga-masiva/smmlv_value` |
| 12 | `tax_calendar.xlsx` | Calendario tributario (vencimientos) | `tax_calendar` | Parámetros | `/carga-masiva/tax_calendar` |
| 13 | `third_party.xlsx` | Terceros (proveedores y clientes) | `third_party` | Terceros | `/carga-masiva/third_party` |
| 14 | `third_party_fiscal_attribute.xlsx` | Atributos fiscales de terceros (versionados) | `third_party_fiscal_attribute` | Terceros | `/carga-masiva/third_party_fiscal_attribute` |
| 15 | `third_party_activity.xlsx` | Actividad económica de terceros por municipio (ReteICA) | `third_party_activity` | Terceros | `/carga-masiva/third_party_activity` |

## Qué pasa si una fila está mal

No se carga nada. Se muestra la lista completa de filas con problema (número de
fila tal como lo ve en Excel, columna y motivo) y usted decide entre corregir el
archivo y volver a subirlo, o cargar solo las filas válidas — pero eso hay que
pedirlo explícitamente, nunca ocurre solo (D-072).

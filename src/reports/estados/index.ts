/**
 * A10 — Punto de entrada de `src/reports/estados/` (Ola 3, sección 11).
 *
 * Los cuatro estados financieros bajo NIIF para las PYMES (Grupo 2) y la
 * estructura de notas, cada uno como un libro Excel construido sobre el
 * constructor de cuatro hojas de A9 (`src/reports/excel.ts`).
 *
 * El cierre de las cuentas de resultado NO vive aquí: escribe en el ledger, y
 * escribir es un caso de uso. Está en `src/services/cierre.ts`.
 */
export * from './tipos';
export * from './notas';
export * from './consulta';
export * from './armado';
export * from './libros';

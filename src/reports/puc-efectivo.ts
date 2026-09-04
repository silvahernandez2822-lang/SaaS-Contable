/**
 * D-089 · TAREA 5 — Exportación a Excel del PUC EFECTIVO de la empresa.
 *
 * El "PUC efectivo" es lo que ve la empresa en sesión tras resolver la
 * precedencia empresa > firma > genérico (vista `v_account_efectivo`, D-064).
 * Un contador que audita el plan de cuentas, o que lo va a migrar a otro
 * software, necesita el catálogo completo CON el alcance de cada cuenta
 * (genérica / de la firma / propia), si está en uso, y su clasificación NIIF
 * vigente — no la lista de veinte cuentas que caben en una pantalla.
 *
 * SEGURIDAD (igual criterio que `src/reports/terceros-maestro.ts`): la empresa
 * NUNCA llega por parámetro. Todo corre dentro de la sesión verificada y la RLS
 * de `account` / `niif_mapping` / `journal_line` (doble nivel tenant_id +
 * company_id) garantiza que no se cuele ni una fila de otra empresa. Este
 * módulo no recibe `companyId` a propósito.
 *
 * NO LLEVA NINGÚN VALOR TRIBUTARIO (Regla de Oro 2): el plan de cuentas es
 * catálogo contable. Se exportan hechos del catálogo (código, nivel,
 * naturaleza, alcance, uso) y la clasificación NIIF con su vigencia — nunca una
 * tarifa ni una base.
 */
import ExcelJS from 'exceljs';
import type { SqlClient } from '../db/types';
import { obtenerEncabezado } from './encabezado';
import { resumenPuc, obtenerModoPuc, type ModoPuc } from '../services/puc';

const SI_NO = (v: boolean): string => (v ? 'Sí' : 'No');

const NATURALEZA_LABEL: Record<string, string> = { debito: 'Débito', credito: 'Crédito' };
const ALCANCE_LABEL: Record<string, string> = {
  empresa: 'Propia de la empresa',
  firma: 'De la firma',
  global: 'Genérica',
};
const MODO_LABEL: Record<ModoPuc, string> = {
  generico: 'Genérico + propio (hereda el PUC de la firma y lo complementa)',
  solo_propio: 'Solo propio (la empresa no hereda el PUC genérico, D-065)',
};

interface FilaCuentaEfectivaCruda {
  id: string;
  codigo: string;
  nombre: string;
  nivel: number;
  naturaleza: string;
  permite_movimiento: boolean;
  activo: boolean;
  alcance: string;
}

interface FilaUsoCruda {
  account_id: string;
  partidas: string;
}

interface FilaConceptoCruda {
  account_id: string;
  conceptos: string;
}

interface FilaNiifCruda {
  account_id: string;
  clasificacion_niif: string;
  seccion_niif: string | null;
  rubro_esf: string | null;
  rubro_eri: string | null;
  norma_respaldo: string;
  vigente_desde: string;
  vigente_hasta: string | null;
  requiere_verificacion_humana: boolean;
}

function encabezadoBold(hoja: ExcelJS.Worksheet, headers: string[]): void {
  const fila = hoja.addRow(headers);
  fila.font = { bold: true };
  fila.eachCell((c) => {
    c.border = { bottom: { style: 'thin' } };
  });
}

/** Arma el libro Excel del PUC efectivo de la empresa en contexto. */
export async function generarLibroPucEfectivo(tx: SqlClient): Promise<ExcelJS.Workbook> {
  const hoy = new Date().toISOString().slice(0, 10);

  const [encabezado, resumen, modo] = await Promise.all([
    obtenerEncabezado(tx, { tituloReporte: 'Plan de cuentas (PUC) efectivo', periodo: `Corte al ${hoy}` }),
    resumenPuc(tx),
    obtenerModoPuc(tx),
  ]);

  // El PUC efectivo completo, ya resuelto por precedencia D-064. Se consulta la
  // vista directamente (no `listarPucEfectivo`) porque su LIMIT tope de 2000 no
  // alcanza para un PUC completo (~2.500 cuentas del Decreto 2650).
  const { rows: cuentas } = await tx.query<FilaCuentaEfectivaCruda>(
    `SELECT id, codigo, nombre, nivel, naturaleza, permite_movimiento, activo, alcance
       FROM v_account_efectivo ORDER BY codigo`,
  );

  // Partidas del ledger publicado por cuenta (RLS aísla la empresa).
  const { rows: usoLedger } = await tx.query<FilaUsoCruda>(
    `SELECT jl.account_id, count(*)::text AS partidas
       FROM journal_line jl
       JOIN journal_entry je ON je.id = jl.journal_entry_id
      WHERE je.estado = 'posted'
      GROUP BY jl.account_id`,
  );
  const partidasPorCuenta = new Map(usoLedger.map((r) => [r.account_id, Number(r.partidas)]));

  // Conceptos de causación activos que apuntan a cada cuenta, en cualquiera de
  // sus tres roles (gasto / IVA descontable / contrapartida). Bajo RLS.
  const { rows: usoConceptos } = await tx.query<FilaConceptoCruda>(
    `SELECT a.id AS account_id, count(DISTINCT c.id)::text AS conceptos
       FROM v_account_efectivo a
       JOIN concepto_causacion c
         ON c.activo
        AND a.id IN (c.cuenta_gasto_id, c.cuenta_iva_descontable_id, c.cuenta_contrapartida_id)
      GROUP BY a.id`,
  );
  const conceptosPorCuenta = new Map(usoConceptos.map((r) => [r.account_id, Number(r.conceptos)]));

  // Clasificación NIIF vigente HOY, más específica primero (empresa > firma >
  // global), como en D-064.
  const { rows: niifRows } = await tx.query<FilaNiifCruda>(
    `SELECT DISTINCT ON (account_id)
            account_id, clasificacion_niif, seccion_niif, rubro_esf, rubro_eri,
            norma_respaldo, vigente_desde::text, vigente_hasta::text, requiere_verificacion_humana
       FROM niif_mapping
      WHERE vigente_desde <= $1::date
        AND (vigente_hasta IS NULL OR vigente_hasta >= $1::date)
      ORDER BY account_id,
               (company_id IS NOT NULL) DESC,
               (tenant_id IS NOT NULL) DESC,
               vigente_desde DESC`,
    [hoy],
  );
  const niifPorCuenta = new Map(niifRows.map((r) => [r.account_id, r]));

  const wb = new ExcelJS.Workbook();
  wb.creator = 'contable-co';
  wb.created = new Date();

  // ---- Hoja 1: Datos (una fila por cuenta, sin formato que estorbe) ----
  const hojaD = wb.addWorksheet('Datos');
  encabezadoBold(hojaD, [
    'Código',
    'Nombre',
    'Nivel',
    'Naturaleza',
    'Imputable',
    'Estado',
    'Alcance',
    '¿En uso?',
    'Conceptos que la usan',
    'Partidas en el ledger',
    'Clasificación NIIF',
    'Sección NIIF',
    'Rubro ESF',
    'Rubro ERI',
    'Norma NIIF',
    'NIIF vigente desde',
    'NIIF vigente hasta',
  ]);
  for (const c of cuentas) {
    const partidas = partidasPorCuenta.get(c.id) ?? 0;
    const conceptos = conceptosPorCuenta.get(c.id) ?? 0;
    const niif = niifPorCuenta.get(c.id);
    hojaD.addRow([
      c.codigo,
      c.nombre,
      c.nivel,
      NATURALEZA_LABEL[c.naturaleza] ?? c.naturaleza,
      SI_NO(c.permite_movimiento),
      c.activo ? 'Activa' : 'Inactiva',
      ALCANCE_LABEL[c.alcance] ?? c.alcance,
      SI_NO(partidas > 0 || conceptos > 0),
      conceptos,
      partidas,
      niif?.clasificacion_niif ?? '',
      niif?.seccion_niif ?? '',
      niif?.rubro_esf ?? '',
      niif?.rubro_eri ?? '',
      niif?.norma_respaldo ?? '',
      niif?.vigente_desde ?? '',
      niif ? (niif.vigente_hasta ?? 'vigente') : '',
    ]);
  }

  // ---- Hoja 2: Papel de trabajo (encabezado obligatorio, sección 11.2) ----
  const hojaP = wb.addWorksheet('Papel de trabajo');
  const titulo = hojaP.addRow([encabezado.tituloReporte]);
  titulo.font = { bold: true, size: 14 };
  hojaP.addRow([
    encabezado.nombreComercial
      ? `${encabezado.razonSocial} (${encabezado.nombreComercial})`
      : encabezado.razonSocial,
  ]);
  const dv = encabezado.digitoVerificacion === null ? '' : `-${encabezado.digitoVerificacion}`;
  hojaP.addRow([`NIT: ${encabezado.nit}${dv}`]);
  hojaP.addRow([`Período / corte: ${encabezado.periodo}`]);
  hojaP.addRow([`Responsable: ${encabezado.responsableNombre} <${encabezado.responsableEmail}>`]);
  hojaP.addRow([`Generado el: ${encabezado.generadoEn}`]);
  hojaP.addRow([]);
  hojaP.addRow(['Modo del PUC', MODO_LABEL[modo]]);
  hojaP.addRow(['Cuentas efectivas activas (cualquier nivel)', resumen.total]);
  hojaP.addRow(['— de ellas, imputables (admiten partidas)', resumen.imputables]);
  hojaP.addRow(['Cuentas propias de la empresa', resumen.propiasDeLaEmpresa]);
  hojaP.addRow(['Cuentas heredadas de la firma', resumen.deLaFirma]);
  hojaP.addRow(['Cuentas genéricas (catálogo Decreto 2650)', resumen.globales]);
  hojaP.addRow(['Cuentas en el archivo (todos los niveles)', cuentas.length]);

  // ---- Hoja 3: Trazabilidad (clasificación NIIF y su vigencia, cuando aplique) ----
  const hojaT = wb.addWorksheet('Trazabilidad');
  encabezadoBold(hojaT, [
    'Código',
    'Nombre',
    'Clasificación NIIF',
    'Sección NIIF',
    'Rubro ESF',
    'Rubro ERI',
    'Norma de respaldo',
    'Vigente desde',
    'Vigente hasta',
    '¿Verificación humana pendiente?',
  ]);
  const codigoPorId = new Map(cuentas.map((c) => [c.id, c]));
  let filasTraza = 0;
  for (const c of cuentas) {
    const niif = niifPorCuenta.get(c.id);
    if (!niif) continue;
    filasTraza += 1;
    hojaT.addRow([
      c.codigo,
      c.nombre,
      niif.clasificacion_niif,
      niif.seccion_niif ?? '',
      niif.rubro_esf ?? '',
      niif.rubro_eri ?? '',
      niif.norma_respaldo,
      niif.vigente_desde,
      niif.vigente_hasta ?? 'vigente',
      SI_NO(niif.requiere_verificacion_humana),
    ]);
  }
  // Mapeos NIIF de cuentas que NO están en el PUC efectivo (raro, pero deja
  // constancia en vez de perderlos en silencio).
  for (const r of niifRows) {
    if (codigoPorId.has(r.account_id)) continue;
    filasTraza += 1;
    hojaT.addRow([
      '(cuenta fuera del PUC efectivo)',
      r.account_id,
      r.clasificacion_niif,
      r.seccion_niif ?? '',
      r.rubro_esf ?? '',
      r.rubro_eri ?? '',
      r.norma_respaldo,
      r.vigente_desde,
      r.vigente_hasta ?? 'vigente',
      SI_NO(r.requiere_verificacion_humana),
    ]);
  }
  if (filasTraza === 0) {
    hojaT.addRow([
      'Ninguna cuenta del PUC efectivo tiene todavía una clasificación NIIF vigente registrada. ' +
        'El plan de cuentas no aplica cálculo tributario: la trazabilidad se limita al mapeo NIIF.',
    ]);
  }

  // ---- Hoja 4: Parámetros (valores usados, con su vigencia / alcance) ----
  const hojaPar = wb.addWorksheet('Parámetros');
  encabezadoBold(hojaPar, ['Parámetro', 'Valor', 'Detalle']);
  hojaPar.addRow(['Modo del PUC de la empresa', modo, MODO_LABEL[modo]]);
  hojaPar.addRow(['Fecha de resolución del PUC efectivo', hoy, 'Precedencia empresa > firma > genérico (D-064)']);
  hojaPar.addRow(['Total de cuentas efectivas activas', resumen.total, '']);
  hojaPar.addRow(['Cuentas imputables', resumen.imputables, 'Admiten journal_line (LG004)']);
  hojaPar.addRow(['Cuentas propias de la empresa', resumen.propiasDeLaEmpresa, 'account.company_id = esta empresa']);
  hojaPar.addRow(['Cuentas de la firma', resumen.deLaFirma, 'account.company_id NULL, tenant de la firma']);
  hojaPar.addRow(['Cuentas genéricas', resumen.globales, 'Catálogo global Decreto 2650 (A1)']);
  hojaPar.addRow([
    'Clasificación NIIF',
    'niif_mapping vigente al corte',
    'Versionada por vigencia; se resuelve por la más específica (empresa > firma > global)',
  ]);

  return wb;
}

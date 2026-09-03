/**
 * D-084 · TAREA 2 — Exportación a Excel del maestro de terceros.
 *
 * Un contador que va a presentar exógena, o que audita el maestro de datos,
 * necesita el catálogo completo de terceros de la empresa CON todos sus
 * atributos fiscales y su historial de vigencias — no solo el valor vigente
 * hoy. Este módulo arma ese libro.
 *
 * SEGURIDAD (igual que `app/api/reportes/[libro]/route.ts`): la empresa NUNCA
 * llega por parámetro. Todas las consultas corren dentro de la sesión
 * verificada (`conSesion`), y la RLS de `third_party` /
 * `third_party_fiscal_attribute` / `third_party_activity` (doble nivel
 * tenant_id + company_id) garantiza que no se cuele ni una fila de otra
 * empresa. Este módulo no recibe `companyId` a propósito.
 *
 * NO LLEVA NINGÚN VALOR TRIBUTARIO (Regla de Oro 2): exporta HECHOS declarados
 * (es declarante, tiene tal actividad en tal municipio) y su norma de respaldo,
 * nunca una tarifa ni una base. `tarifa_ica_override` se exporta solo si el
 * contador la fijó explícitamente en la ficha del tercero (columna que ya
 * existe desde 005), tal cual está en la base.
 */
import ExcelJS from 'exceljs';
import type { SqlClient } from '../db/types';
import { obtenerEncabezado } from './encabezado';
import { listarTerceros } from '../services/terceros';

const SI_NO = (v: boolean): string => (v ? 'Sí' : 'No');

interface FilaHistorialFiscalCruda {
  numero_documento: string;
  tipo_documento: string;
  razon_social: string;
  vigente_desde: string;
  vigente_hasta: string | null;
  es_declarante_renta: boolean;
  es_autorretenedor_renta: boolean;
  es_gran_contribuyente: boolean;
  es_regimen_simple: boolean;
  es_responsable_iva: boolean;
  es_agente_retencion_renta: boolean;
  es_agente_retencion_iva: boolean;
  es_agente_retencion_ica: boolean;
  es_autorretenedor_ica: boolean;
  regimen_tributario: string;
  norma_respaldo: string;
  fuente: string;
  notas: string | null;
  requiere_verificacion_humana: boolean;
}

interface FilaHistorialActividadCruda {
  numero_documento: string;
  razon_social: string;
  municipality_nombre: string;
  ciiu_codigo: string;
  ciiu_nombre: string;
  es_principal: boolean;
  tarifa_ica_override: string | null;
  vigente_desde: string;
  vigente_hasta: string | null;
  norma_respaldo: string;
  notas: string | null;
}

function encabezadoBold(hoja: ExcelJS.Worksheet, headers: string[]): void {
  const fila = hoja.addRow(headers);
  fila.font = { bold: true };
  fila.eachCell((c) => {
    c.border = { bottom: { style: 'thin' } };
  });
}

/** Arma el libro Excel del maestro de terceros de la empresa en contexto. */
export async function generarMaestroTerceros(tx: SqlClient): Promise<ExcelJS.Workbook> {
  const encabezado = await obtenerEncabezado(tx, {
    tituloReporte: 'Maestro de terceros',
    periodo: `Corte al ${new Date().toISOString().slice(0, 10)}`,
  });

  const terceros = await listarTerceros(tx, { estado: 'todos', limite: 100_000 });

  const { rows: historialFiscal } = await tx.query<FilaHistorialFiscalCruda>(
    `SELECT tp.numero_documento, tp.tipo_documento, tp.razon_social,
            fa.vigente_desde::text, fa.vigente_hasta::text,
            fa.es_declarante_renta, fa.es_autorretenedor_renta, fa.es_gran_contribuyente,
            fa.es_regimen_simple, fa.es_responsable_iva, fa.es_agente_retencion_renta,
            fa.es_agente_retencion_iva, fa.es_agente_retencion_ica, fa.es_autorretenedor_ica,
            fa.regimen_tributario, fa.norma_respaldo, fa.fuente, fa.notas,
            fa.requiere_verificacion_humana
       FROM third_party_fiscal_attribute fa
       JOIN third_party tp ON tp.id = fa.third_party_id
      ORDER BY tp.razon_social, fa.vigente_desde DESC`,
  );

  const { rows: historialActividad } = await tx.query<FilaHistorialActividadCruda>(
    `SELECT tp.numero_documento, tp.razon_social,
            m.nombre AS municipality_nombre, ci.codigo AS ciiu_codigo, ci.nombre AS ciiu_nombre,
            ta.es_principal, ta.tarifa_ica_override::text,
            ta.vigente_desde::text, ta.vigente_hasta::text, ta.norma_respaldo, ta.notas
       FROM third_party_activity ta
       JOIN third_party tp ON tp.id = ta.third_party_id
       JOIN municipality m ON m.id = ta.municipality_id
       JOIN ciiu_activity ci ON ci.id = ta.ciiu_activity_id
      ORDER BY tp.razon_social, m.nombre, ci.codigo, ta.vigente_desde DESC`,
  );

  const wb = new ExcelJS.Workbook();
  wb.creator = 'contable-co';
  wb.created = new Date();

  // ---- Hoja 1: Terceros (una fila por tercero, valor vigente hoy) ----
  const hojaT = wb.addWorksheet('Terceros');
  encabezadoBold(hojaT, [
    'Tipo doc',
    'Número',
    'DV',
    'Tipo persona',
    'Razón social / nombre',
    'Nombre comercial',
    'Dirección',
    'Municipio',
    'Código DANE',
    'País',
    '¿Del exterior?',
    'Correo',
    'Teléfono',
    'Estado',
    '¿Tiene atributos fiscales vigentes hoy?',
  ]);
  for (const t of terceros) {
    hojaT.addRow([
      t.tipoDocumento,
      t.numeroDocumento,
      t.digitoVerificacion ?? '',
      t.tipoPersona,
      t.razonSocial,
      t.nombreComercial ?? '',
      t.direccion ?? '',
      t.municipalityNombre ?? '',
      t.codigoDane ?? '',
      t.pais,
      SI_NO(t.esDelExterior),
      t.email ?? '',
      t.telefono ?? '',
      t.activo ? 'Activo' : 'Inactivo',
      SI_NO(t.tieneAtributoFiscalVigente),
    ]);
  }

  // ---- Hoja 2: Atributos fiscales — HISTORIAL COMPLETO ----
  const hojaF = wb.addWorksheet('Atributos fiscales (historial)');
  encabezadoBold(hojaF, [
    'Tipo doc',
    'Número',
    'Razón social / nombre',
    'Vigente desde',
    'Vigente hasta',
    'Declarante de renta',
    'Autorretenedor de renta',
    'Gran contribuyente',
    'Régimen SIMPLE',
    'Responsable de IVA',
    'Agente ret. renta',
    'Agente ret. IVA',
    'Agente ret. ICA',
    'Autorretenedor de ICA',
    'Régimen tributario',
    'Norma de respaldo',
    'Fuente',
    'Notas',
    '¿Verificación humana pendiente?',
  ]);
  for (const f of historialFiscal) {
    hojaF.addRow([
      f.tipo_documento,
      f.numero_documento,
      f.razon_social,
      f.vigente_desde,
      f.vigente_hasta ?? 'vigente',
      SI_NO(f.es_declarante_renta),
      SI_NO(f.es_autorretenedor_renta),
      SI_NO(f.es_gran_contribuyente),
      SI_NO(f.es_regimen_simple),
      SI_NO(f.es_responsable_iva),
      SI_NO(f.es_agente_retencion_renta),
      SI_NO(f.es_agente_retencion_iva),
      SI_NO(f.es_agente_retencion_ica),
      SI_NO(f.es_autorretenedor_ica),
      f.regimen_tributario,
      f.norma_respaldo,
      f.fuente,
      f.notas ?? '',
      SI_NO(f.requiere_verificacion_humana),
    ]);
  }
  if (historialFiscal.length === 0) {
    hojaF.addRow(['Ningún tercero de esta empresa tiene atributos fiscales registrados todavía.']);
  }

  // ---- Hoja 3: Actividad económica por municipio — HISTORIAL COMPLETO ----
  const hojaA = wb.addWorksheet('Actividad económica (historial)');
  encabezadoBold(hojaA, [
    'Tipo doc',
    'Número',
    'Razón social / nombre',
    'Municipio',
    'CIIU',
    'Actividad',
    '¿Principal?',
    'Tarifa ICA propia (excepcional)',
    'Vigente desde',
    'Vigente hasta',
    'Norma de respaldo',
    'Notas',
  ]);
  for (const a of historialActividad) {
    hojaA.addRow([
      '',
      a.numero_documento,
      a.razon_social,
      a.municipality_nombre,
      a.ciiu_codigo,
      a.ciiu_nombre,
      SI_NO(a.es_principal),
      a.tarifa_ica_override ?? '',
      a.vigente_desde,
      a.vigente_hasta ?? 'vigente',
      a.norma_respaldo,
      a.notas ?? '',
    ]);
  }
  if (historialActividad.length === 0) {
    hojaA.addRow(['Ningún tercero de esta empresa tiene actividad económica registrada todavía.']);
  }

  // ---- Hoja 4: Papel de trabajo (encabezado obligatorio de la sección 11.2) ----
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
  hojaP.addRow(['Terceros en el maestro', terceros.length]);
  hojaP.addRow(['— de ellos, activos', terceros.filter((t) => t.activo).length]);
  hojaP.addRow(['— de ellos, inactivos', terceros.filter((t) => !t.activo).length]);
  hojaP.addRow(['Vigencias de atributos fiscales (todas)', historialFiscal.length]);
  hojaP.addRow(['Vigencias de actividad económica (todas)', historialActividad.length]);

  return wb;
}

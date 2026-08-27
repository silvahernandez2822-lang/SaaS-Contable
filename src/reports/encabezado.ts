/**
 * A9 — Encabezado obligatorio de la hoja "Papel de trabajo" (sección 11.2):
 * empresa, NIT, período, responsable y fecha de generación.
 *
 * La empresa y el usuario se leen de `app.current_company_id()` /
 * `app.current_user_id()`: la sesión ya está situada en una empresa (D-021),
 * igual que el resto de `src/services`. No se recibe `companyId` por
 * parámetro para no abrir una vía que sortee RLS.
 */
import type { SqlClient } from '../db/types';
import type { EncabezadoReporte } from './tipos';

export async function obtenerEncabezado(
  tx: SqlClient,
  opciones: { tituloReporte: string; periodo: string },
): Promise<EncabezadoReporte> {
  const { rows } = await tx.query<{
    razon_social: string;
    nombre_comercial: string | null;
    nit: string;
    digito_verificacion: number | null;
    responsable_nombre: string | null;
    responsable_email: string | null;
  }>(
    `SELECT
       c.razon_social, c.nombre_comercial, c.nit, c.digito_verificacion,
       (SELECT nombre_completo FROM "user" WHERE id = app.current_user_id()) AS responsable_nombre,
       (SELECT email FROM "user" WHERE id = app.current_user_id()) AS responsable_email
     FROM company c
     WHERE c.id = app.current_company_id()`,
  );
  const fila = rows[0];
  if (!fila) {
    throw new Error(
      'No se pudo resolver la empresa de la sesión actual para el encabezado del reporte (¿sesión sin empresa elegida?).',
    );
  }

  return {
    tituloReporte: opciones.tituloReporte,
    razonSocial: fila.razon_social,
    nombreComercial: fila.nombre_comercial,
    nit: fila.nit,
    digitoVerificacion: fila.digito_verificacion,
    periodo: opciones.periodo,
    responsableNombre: fila.responsable_nombre ?? 'Sin usuario en la sesión',
    responsableEmail: fila.responsable_email ?? '',
    generadoEn: new Date().toISOString(),
  };
}

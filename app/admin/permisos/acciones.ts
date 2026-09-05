'use server';

/**
 * D-092 — Acciones de permisos individuales.
 *
 * Ninguna autoriza nada. `usuario.administrar` lo exige el trigger de 016 sobre
 * `user_permission_override`; el «nadie se asciende a sí mismo» (PO001) y el
 * «nadie concede lo que no ejerce» (PO002) los exige el trigger
 * `user_permission_override_zz_blindaje` de la migración 183. Estas acciones
 * solo traducen el rechazo a una frase que se pueda leer (D-025).
 */
import { redirect } from 'next/navigation';
import { conSesion } from '../../lib/sesion';
import { decidirPermisoIndividual } from '../../../src/services/administracion';
import { mensajeDeError } from '../_errores';

function leer(fd: FormData, campo: string): string {
  const v = fd.get(campo);
  return typeof v === 'string' ? v.trim() : '';
}

function destino(parametros: Record<string, string>): string {
  return `/admin/permisos?${new URLSearchParams(parametros).toString()}`;
}

export async function decidirPermisoAction(formData: FormData): Promise<void> {
  const userId = leer(formData, 'userId');
  const efecto = leer(formData, 'efecto') === 'revocado' ? 'revocado' : 'otorgado';
  let a: string;
  try {
    await conSesion((tx) =>
      decidirPermisoIndividual(tx, {
        userId,
        companyId: leer(formData, 'companyId'),
        permisoCodigo: leer(formData, 'permisoCodigo'),
        efecto,
        motivo: leer(formData, 'motivo'),
        venceEn: leer(formData, 'venceEn') || null,
      }),
    );
    a = destino({
      usuario: userId,
      ok:
        efecto === 'otorgado'
          ? 'Permiso individual otorgado. Queda en el registro de auditoría con su motivo, quién lo concedió y cuándo.'
          : 'Permiso individual revocado. La decisión anterior NO se borró: se le añadió esta encima, con su motivo.',
    });
  } catch (e) {
    a = destino({ usuario: userId, error: mensajeDeError(e) });
  }
  redirect(a);
}

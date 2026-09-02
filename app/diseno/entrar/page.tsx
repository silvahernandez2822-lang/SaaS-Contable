'use client';

/**
 * D-075 · Ola 5 — Pantalla 1: LOGIN (/diseno/entrar).
 *
 * Fuera del shell: pantalla completa, sin navegación. Debe transmitir seriedad
 * y seguridad desde el primer contacto — de ahí el panel de marca en azul a la
 * izquierda con el recordatorio de aislamiento por firma (Regla de Oro 7) y el
 * cifrado, y el formulario sobrio a la derecha. Segundo factor OPCIONAL: el
 * campo está siempre, con la nota de que se deja vacío si la cuenta no lo tiene
 * activado.
 */
import Link from 'next/link';
import { useState } from 'react';
import { Boton, Campo, Entrada } from '../_ui/componentes';
import { IconoEscudo, IconoMarca } from '../_ui/iconos';

export default function Entrar() {
  const [enviando, setEnviando] = useState(false);

  return (
    <div className="flex min-h-screen bg-superficie text-texto">
      {/* panel de marca */}
      <aside className="hidden lg:w-[440px] flex-col justify-between bg-primario p-12 text-white lg:flex">
        <div className="flex items-center gap-2.5 text-[17px] font-bold tracking-tight">
          <IconoMarca width={24} height={24} />
          Contable CO
        </div>
        <div className="max-w-sm">
          <h1 className="text-[26px] font-bold leading-tight">Causación automática de facturas de compra</h1>
          <p className="mt-3 text-[14px] text-white/70">
            El XML de la factura entra, sale el asiento con las retenciones calculadas, trazadas y listas para
            aprobación humana.
          </p>
        </div>
        <ul className="flex flex-col gap-3 text-[13px] text-white/75">
          <li className="flex items-start gap-2.5">
            <IconoEscudo width={17} height={17} className="mt-[2px] shrink-0 text-primario-tinta-oscura" />
            Aislamiento por firma en el motor de base de datos. Los datos de una firma nunca cruzan a otra.
          </li>
          <li className="flex items-start gap-2.5">
            <IconoEscudo width={17} height={17} className="mt-[2px] shrink-0 text-primario-tinta-oscura" />
            Cada acción sensible queda en el registro de auditoría: quién, cuándo y desde dónde.
          </li>
        </ul>
      </aside>

      {/* formulario */}
      <main className="flex flex-1 items-center justify-center p-8">
        <form
          className="w-full max-w-sm"
          onSubmit={(e) => {
            e.preventDefault();
            setEnviando(true);
            setTimeout(() => setEnviando(false), 900);
          }}
        >
          <div className="mb-7 flex items-center gap-2 text-[15px] font-bold text-primario lg:hidden dark:text-primario-tinta-oscura">
            <IconoMarca width={20} height={20} />
            Contable CO
          </div>
          <h2 className="text-[19px] font-bold text-texto">Entrar</h2>
          <p className="mt-1 text-[13px] text-texto-suave">Acceso para firmas contables registradas.</p>

          <div className="mt-6 flex flex-col gap-4">
            <Campo etiqueta="Correo" requerido>
              <Entrada type="email" name="correo" autoComplete="username" required placeholder="nombre@firma.com" />
            </Campo>
            <Campo etiqueta="Contraseña" requerido>
              <Entrada type="password" name="clave" autoComplete="current-password" required />
            </Campo>
            <Campo
              etiqueta="Código de segundo factor"
              ayuda="Solo si tu cuenta tiene segundo factor activado. Si no, déjalo vacío."
            >
              <Entrada
                type="text"
                name="totp"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="000000"
                className="tracking-[6px]"
              />
            </Campo>
          </div>

          <Boton tipo="submit" className="mt-6 w-full" disabled={enviando}>
            {enviando ? 'Verificando…' : 'Entrar'}
          </Boton>

          <div className="mt-4 flex items-center justify-between text-[12px]">
            <Link href="#" className="text-primario underline dark:text-primario-tinta-oscura">
              Olvidé mi contraseña
            </Link>
            <Link href="/diseno" className="text-texto-suave hover:text-texto">
              Ver el prototipo →
            </Link>
          </div>
        </form>
      </main>
    </div>
  );
}

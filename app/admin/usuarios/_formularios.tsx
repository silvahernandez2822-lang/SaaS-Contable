'use client';

/**
 * A16 — Los dos formularios que devuelven una contraseña (Ola 4, Tarea 7).
 * Migrados al kit de `app/_ui/componentes` por A12 en D-092: mismo
 * comportamiento, sin un solo `#hex`.
 *
 * Son de cliente por una sola razón: la contraseña generada tiene que llegar en
 * el CUERPO de la respuesta y pintarse una vez, no viajar en la URL de un
 * `redirect`. Una contraseña en la barra de direcciones queda en el historial,
 * en el registro del proxy y en la cabecera `Referer` de la petición siguiente.
 *
 * La contraseña se muestra UNA vez y no se guarda en ninguna parte del cliente:
 * si se pierde, se vuelve a fijar otra. Recuperarla no es posible ni debe
 * serlo — lo que la base guarda es un hash scrypt.
 */
import { useActionState } from 'react';
import { Boton, Campo, Entrada, MensajeEstado, Panel, Selector } from '../../_ui/componentes';
import { crearUsuarioAction, fijarPasswordAction, type EstadoAdmin } from './acciones';

function Resultado({ estado }: { estado: EstadoAdmin }) {
  return (
    <div className="mt-3">
      <MensajeEstado tipo={estado.ok ? 'sin-datos' : 'error'} titulo={estado.mensaje}>
        {estado.passwordGenerada && (
          <>
            <p className="font-semibold text-texto">Contraseña generada — cópiela ahora, no se vuelve a mostrar:</p>
            <code className="mt-1 inline-block select-all rounded-md border border-borde bg-superficie-elevada px-2 py-1 text-[17px] tracking-wide text-texto">
              {estado.passwordGenerada}
            </code>
            <p className="mt-1 text-metadata text-texto-suave">
              Entréguesela por un canal distinto del correo si puede. El usuario tendrá que cambiarla al entrar.
            </p>
          </>
        )}
      </MensajeEstado>
    </div>
  );
}

export function FormularioCrearUsuario({
  empresas,
  roles,
}: {
  empresas: Array<{ companyId: string; razonSocial: string }>;
  roles: Array<{ id: string; nombre: string; codigo: string }>;
}) {
  const [estado, accion, enCurso] = useActionState<EstadoAdmin | null, FormData>(crearUsuarioAction, null);

  return (
    <Panel
      className="mt-6"
      titulo="Crear usuario"
      descripcion="Nace obligado a cambiar la contraseña la primera vez que entre: quien se la fija la conoce, y una contraseña conocida por dos personas no identifica a ninguna (D-069)."
    >
      <form action={accion} className="flex flex-col gap-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="Correo" requerido>
            <Entrada name="email" type="email" required placeholder="revisor@sufirma.co" />
          </Campo>
          <Campo etiqueta="Nombre completo" requerido ayuda="Es lo que verá la auditoría dentro de tres años.">
            <Entrada name="nombreCompleto" required />
          </Campo>
          <Campo etiqueta="Documento">
            <Entrada name="documento" />
          </Campo>
          <Campo etiqueta="Contraseña inicial" ayuda="Vacío = se genera una fuerte y se muestra una sola vez.">
            <Entrada name="password" type="password" autoComplete="new-password" />
          </Campo>
          <Campo
            etiqueta="Acceso inicial a la empresa"
            ayuda="Sin acceso a ninguna empresa el usuario entra y no ve nada: no es un error, es lo correcto mientras alguien decide qué le toca."
          >
            <Selector name="companyId" defaultValue="">
              <option value="">— ninguno por ahora —</option>
              {empresas.map((e) => (
                <option key={e.companyId} value={e.companyId}>
                  {e.razonSocial}
                </option>
              ))}
            </Selector>
          </Campo>
          <Campo etiqueta="con el rol">
            <Selector name="roleId" defaultValue="">
              <option value="">— ninguno —</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nombre} ({r.codigo})
                </option>
              ))}
            </Selector>
          </Campo>
        </div>
        <div>
          <Boton tipo="submit" disabled={enCurso}>
            {enCurso ? 'Creando…' : 'Crear usuario'}
          </Boton>
        </div>
        {estado && <Resultado estado={estado} />}
      </form>
    </Panel>
  );
}

export function FormularioPassword({ userId, email }: { userId: string; email: string }) {
  const [estado, accion, enCurso] = useActionState<EstadoAdmin | null, FormData>(fijarPasswordAction, null);

  return (
    <div>
      <form action={accion} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="userId" value={userId} />
        <Campo etiqueta={`Contraseña nueva para ${email}`} ayuda="Vacío = generar una fuerte.">
          <Entrada name="password" type="password" autoComplete="new-password" />
        </Campo>
        <Boton tipo="submit" variante="fantasma" disabled={enCurso}>
          Cambiar contraseña
        </Boton>
      </form>
      {estado && <Resultado estado={estado} />}
    </div>
  );
}

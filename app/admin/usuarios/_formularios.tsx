'use client';

/**
 * A16 — Los dos formularios que devuelven una contraseña (Ola 4, Tarea 7).
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
import { crearUsuarioAction, fijarPasswordAction, type EstadoAdmin } from './acciones';

function Resultado({ estado }: { estado: EstadoAdmin }) {
  return (
    <div
      role="status"
      style={{
        border: `1px solid ${estado.ok ? '#15803d' : '#b91c1c'}`,
        background: estado.ok ? '#f0fdf4' : '#fef2f2',
        padding: 12,
        marginTop: 12,
      }}
    >
      <p style={{ margin: 0 }}>{estado.mensaje}</p>
      {estado.passwordGenerada && (
        <>
          <p style={{ marginBottom: 4 }}>
            <strong>Contraseña generada — cópiela ahora, no se vuelve a mostrar:</strong>
          </p>
          <code style={{ fontSize: 18, userSelect: 'all', background: '#fff', padding: '4px 8px' }}>
            {estado.passwordGenerada}
          </code>
          <p style={{ fontSize: 13, color: '#475569' }}>
            Entréguesela por un canal distinto del correo si puede. El usuario tendrá que cambiarla al entrar.
          </p>
        </>
      )}
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
    <section style={{ border: '1px solid #334155', padding: 16, marginTop: 24 }}>
      <h2 style={{ marginTop: 0 }}>Crear usuario</h2>
      <form action={accion}>
        <div>
          <label>
            Correo * <input name="email" type="email" required size={34} placeholder="revisor@sufirma.co" />
          </label>{' '}
          <label>
            Nombre completo * <input name="nombreCompleto" required size={34} />
          </label>
        </div>
        <div style={{ marginTop: 8 }}>
          <label>
            Documento <input name="documento" size={18} />
          </label>{' '}
          <label>
            Contraseña inicial (vacío = se genera una fuerte){' '}
            <input name="password" type="password" size={26} autoComplete="new-password" />
          </label>
        </div>
        <div style={{ marginTop: 8 }}>
          <label>
            Acceso inicial a la empresa{' '}
            <select name="companyId" defaultValue="">
              <option value="">— ninguno por ahora —</option>
              {empresas.map((e) => (
                <option key={e.companyId} value={e.companyId}>
                  {e.razonSocial}
                </option>
              ))}
            </select>
          </label>{' '}
          <label>
            con el rol{' '}
            <select name="roleId" defaultValue="">
              <option value="">— ninguno —</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nombre} ({r.codigo})
                </option>
              ))}
            </select>
          </label>
        </div>
        <p style={{ fontSize: 13, color: '#475569' }}>
          Sin acceso a ninguna empresa el usuario puede entrar y no verá nada: no es un error, es lo correcto
          mientras alguien decide qué le toca.
        </p>
        <button type="submit" disabled={enCurso}>
          {enCurso ? 'Creando…' : 'Crear usuario'}
        </button>
      </form>
      {estado && <Resultado estado={estado} />}
    </section>
  );
}

export function FormularioPassword({ userId, email }: { userId: string; email: string }) {
  const [estado, accion, enCurso] = useActionState<EstadoAdmin | null, FormData>(fijarPasswordAction, null);

  return (
    <div>
      <form action={accion}>
        <input type="hidden" name="userId" value={userId} />
        <label>
          Contraseña nueva para {email} (vacío = generar){' '}
          <input name="password" type="password" size={22} autoComplete="new-password" />
        </label>{' '}
        <button type="submit" disabled={enCurso}>
          Cambiar contraseña
        </button>
      </form>
      {estado && <Resultado estado={estado} />}
    </div>
  );
}

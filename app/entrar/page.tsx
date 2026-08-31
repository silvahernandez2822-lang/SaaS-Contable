/**
 * A12 — Pantalla de inicio de sesión.
 *
 * Deliberadamente sin estilos: el resto de la interfaz del producto tampoco los
 * tiene todavía. Lo que sí tiene es el comportamiento correcto: un solo mensaje
 * de error para todos los fallos posibles, y el campo de segundo factor siempre
 * visible en vez de aparecer solo cuando el usuario tiene MFA — si apareciera
 * en un segundo paso, el formulario delataría quién tiene MFA y quién no.
 */
import { entrarAction } from './acciones';

export const dynamic = 'force-dynamic';

export default async function EntrarPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main>
      <h1>Entrar</h1>
      {error ? <p role="alert">{error}</p> : null}
      <form action={entrarAction}>
        <p>
          <label htmlFor="email">Correo</label>
          <br />
          <input id="email" name="email" type="email" autoComplete="username" required />
        </p>
        <p>
          <label htmlFor="password">Contraseña</label>
          <br />
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </p>
        <p>
          <label htmlFor="codigoTotp">Código de segundo factor (solo si lo tiene activado)</label>
          <br />
          <input
            id="codigoTotp"
            name="codigoTotp"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
          />
        </p>
        <button type="submit">Entrar</button>
      </form>
      <p>
        ¿Todavía no existe ningún usuario? La primera firma, su primera empresa-cliente y su
        administrador se crean con el comando <code>npm run arranque</code>, que ejecuta el
        operador del sistema. No hay registro por esta pantalla, y es a propósito.
      </p>
    </main>
  );
}

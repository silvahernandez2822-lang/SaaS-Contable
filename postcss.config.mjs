/**
 * Tailwind v4 se engancha a Next.js por PostCSS y por nada más: no hay
 * `tailwind.config.js` porque en la versión 4 la configuración vive en el
 * propio CSS (`@theme` en `app/globals.css`), que es donde están los tokens de
 * diseño aprobados.
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;

#!/usr/bin/env node
import '../db/dns-fix';
/**
 * CLI de arranque — `npm run arranque`
 *
 * Crea la primera firma, su primera empresa-cliente y el usuario administrador
 * de firma, sin escribir una línea de SQL. La justificación de por qué esto es
 * un comando de operador y no una ruta HTTP está en `arranque.ts`; en resumen:
 * exige la MISMA credencial privilegiada que `npm run migrate` (superusuario /
 * BYPASSRLS, D-015), así que no abre ninguna vía de confianza nueva, y no añade
 * ni un byte de superficie de red.
 *
 * Uso mínimo:
 *
 *   npm run arranque -- \
 *     --firma-nit=901234567 --firma="Mi Firma Contable SAS" \
 *     --empresa-nit=800111222 --empresa="Comercializadora del Norte SAS" \
 *     --admin-email=david@mifirma.com --admin-nombre="David Silva"
 *
 * Sin `--password` genera una contraseña fuerte y la imprime UNA sola vez.
 *
 * Opciones:
 *   --firma-nit=          NIT de la firma contable (solo dígitos)
 *   --firma=              razón social de la firma
 *   --firma-email=        correo de contacto de la firma (por defecto, el del admin)
 *   --empresa-nit=        NIT de la primera empresa-cliente
 *   --empresa=            razón social de la primera empresa-cliente
 *   --empresa-dv=         dígito de verificación del NIT de la empresa (0-9)
 *   --admin-email=        correo con el que se inicia sesión
 *   --admin-nombre=       nombre completo del administrador
 *   --password=           contraseña (mínimo 12 caracteres). Si falta, se genera
 *   --rotar-password      reescribe la contraseña de un usuario que YA existía
 *   --solo-si-vacio       aborta si ya hay alguna firma creada
 *   --migrar              aplica antes las migraciones y los seeds
 */
import { createDb } from '../db/client';
import { migrate } from '../db/migrate';
import { seed } from '../db/seed';
import { arrancar, ArranqueError } from './arranque';

function opcion(args: string[], nombre: string): string | undefined {
  const prefijo = `--${nombre}=`;
  const hit = args.find((a) => a.startsWith(prefijo));
  return hit === undefined ? undefined : hit.slice(prefijo.length);
}

function bandera(args: string[], nombre: string): boolean {
  return args.includes(`--${nombre}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  const url = process.env.DATABASE_URL;
  const db = await createDb();

  console.log(
    url
      ? 'Motor: Postgres (DATABASE_URL) — debe ser un rol superusuario/BYPASSRLS (D-015)'
      : 'Motor: PGlite EN MEMORIA (no hay DATABASE_URL). Todo lo que cree se pierde al terminar.',
  );

  try {
    if (bandera(args, 'migrar') || !url) {
      const m = await migrate(db);
      console.log(`Migraciones aplicadas: ${m.aplicadas.length}`);
      await seed(db);
      console.log('Datos paramétricos cargados.');
      // A15 (D-057): igual que en migrate-cli/seed-cli, sin esto el
      // planificador queda a ciegas justo después de la carga masiva inicial.
      await db.exec('ANALYZE');
    }

    const resultado = await arrancar(db, {
      firmaNit: opcion(args, 'firma-nit') ?? '',
      firmaRazonSocial: opcion(args, 'firma') ?? '',
      firmaEmailContacto: opcion(args, 'firma-email') ?? null,
      empresaNit: opcion(args, 'empresa-nit') ?? '',
      empresaRazonSocial: opcion(args, 'empresa') ?? '',
      empresaDigitoVerificacion: opcion(args, 'empresa-dv')
        ? Number(opcion(args, 'empresa-dv'))
        : null,
      adminEmail: opcion(args, 'admin-email') ?? '',
      adminNombre: opcion(args, 'admin-nombre') ?? '',
      adminPassword: opcion(args, 'password') ?? process.env.ARRANQUE_PASSWORD ?? null,
      rotarPassword: bandera(args, 'rotar-password'),
      soloSiVacio: bandera(args, 'solo-si-vacio'),
    });

    const marca = (creado: boolean): string => (creado ? 'creada/o ahora' : 'ya existía, sin tocar');

    console.log('');
    console.log('=== ARRANQUE LISTO ===');
    console.log(`  Firma    : ${resultado.tenantId}   (${marca(resultado.creado.firma)})`);
    console.log(`  Empresa  : ${resultado.companyId}  (${marca(resultado.creado.empresa)})`);
    console.log(`  Usuario  : ${resultado.userId}     (${marca(resultado.creado.usuario)})`);
    console.log(`  Acceso   : rol administrador de firma (${marca(resultado.creado.acceso)})`);

    if (resultado.passwordGenerada !== null) {
      console.log('');
      console.log('  CONTRASEÑA INICIAL (se muestra UNA sola vez, cópiela ahora):');
      console.log('');
      console.log(`      ${resultado.passwordGenerada}`);
      console.log('');
      console.log('  No queda guardada en ninguna parte: la base solo tiene su derivación scrypt.');
    } else if (!resultado.creado.usuario) {
      console.log('');
      console.log('  El usuario ya existía y NO se le cambió la contraseña (a propósito).');
      console.log('  Si la perdió, vuelva a correr el comando añadiendo  --rotar-password');
    }

    console.log('');
    console.log('  Ahora: levante la aplicación (npm run dev) y entre en  /entrar');
    console.log('  con ese correo y esa contraseña. De ahí llegará a /bandeja,');
    console.log('  /parametros, /terceros y /reportes.');
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error('\nEl arranque falló:\n');
  if (error instanceof ArranqueError) {
    console.error(`  ${error.message}`);
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exitCode = 1;
});

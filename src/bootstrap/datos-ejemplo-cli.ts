#!/usr/bin/env node
/**
 * CLI de datos de EJEMPLO — `npm run datos-ejemplo`
 *
 * Para probar el sistema de punta a punta, como el primer cliente real.
 * Requiere que ya haya corrido, en este orden:
 *
 *   1. npm run migrate     (esquema)
 *   2. npm run seed        (datos NORMATIVOS: UVT, tarifas, municipios...)
 *   3. npm run arranque    (su firma, su empresa, su usuario administrador)
 *
 * Este comando NO es ninguno de los tres anteriores y no los sustituye: crea
 * terceros y facturas de EJEMPLO sobre la empresa que ya existe, para que
 * haya con qué probar el motor de causación sin escribir SQL a mano. Seguro
 * de correr dos veces: lo que ya existe se reconoce y no se duplica.
 *
 * ADVERTENCIA QUE NO SE REPITE EN NINGÚN OTRO COMANDO: esto es DEMOSTRACIÓN,
 * no datos normativos. Los terceros, las facturas y los conceptos de
 * causación que crea son inventados para la prueba. Nunca se cargan con
 * `npm run seed` (viven en `db/demo/`, fuera de `db/seeds/`) y no deben
 * correrse contra una instalación real que ya esté en producción salvo que
 * de verdad quiera datos de prueba mezclados con los suyos.
 *
 * Opciones:
 *   --firma-nit=              si hay más de una firma en la base
 *   --empresa-nit=            si hay más de una empresa en la base
 *   --forzar-agente-retencion  permite que el comando encienda "agente de
 *                              retención de IVA/ICA" en una empresa que YA
 *                              tiene terceros propios (ver advertencia en
 *                              datos-ejemplo.ts). Sin esta bandera, el
 *                              comando se niega a tocar esos dos atributos
 *                              de una empresa que no está recién arrancada.
 */
import { createDb } from '../db/client';
import { cargarDatosEjemplo, DatosEjemploError } from './datos-ejemplo';

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
      : 'Motor: PGlite EN MEMORIA (no hay DATABASE_URL). Lo que cree este comando se pierde al terminar: ' +
          'no sirve para probar la aplicación de verdad, solo para verificar que el comando corre sin error.',
  );
  console.log('');
  console.log('Cargando datos de EJEMPLO (no normativos) para probar el sistema de punta a punta...');
  console.log('');

  try {
    const resultado = await cargarDatosEjemplo(db, {
      firmaNit: opcion(args, 'firma-nit') ?? null,
      empresaNit: opcion(args, 'empresa-nit') ?? null,
      forzarAgenteRetencion: bandera(args, 'forzar-agente-retencion'),
      logger: (m) => console.log(m),
    });

    console.log('');
    console.log('=== DATOS DE EJEMPLO LISTOS ===');
    console.log(`  Firma   : ${resultado.firma}`);
    console.log(`  Empresa : ${resultado.empresa}`);
    console.log('');
    console.log(`  Terceros (${resultado.terceros.length}):`);
    for (const t of resultado.terceros) {
      console.log(`    - ${t.razonSocial} (doc. ${t.numeroDocumento}) — ${t.creado ? 'creado ahora' : 'ya existía'}`);
    }
    console.log('');
    console.log(`  Facturas de ejemplo (${resultado.facturas.length}):`);
    for (const f of resultado.facturas) {
      const estado = f.estadoCausacion ?? 'sin procesar';
      console.log(`    - ${f.archivo}: ${estado}${f.journalEntryId ? ` (asiento ${f.journalEntryId})` : ''}`);
      for (const m of f.motivos) console.log(`        motivo: ${m}`);
    }
    console.log('');
    console.log('  Entre a la aplicación (npm run dev), inicie sesión con el usuario que creó');
    console.log('  con  npm run arranque  y revise /bandeja: ahí están las facturas de ejemplo');
    console.log('  con sus asientos en borrador, listos para aprobación humana.');
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error('\nLa carga de datos de ejemplo falló:\n');
  if (error instanceof DatosEjemploError) {
    console.error(`  ${error.message}`);
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exitCode = 1;
});

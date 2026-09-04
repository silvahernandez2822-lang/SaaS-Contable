/**
 * A16 — Portada de la carga masiva (Ola 4, Tareas 1 y 3).
 *
 * Lista los catálogos que admiten archivo, EN EL ORDEN EN QUE HAY QUE
 * CARGARLOS. Ese orden no es decorativo: cada plantilla solo depende de las
 * anteriores, y cargar terceros antes que municipios rechaza todas las filas
 * por un municipio DANE que todavía no existe.
 *
 * La lista sale de `DEFINICIONES`, la misma fuente que valida los archivos y
 * que genera las plantillas: no hay forma de que esta pantalla ofrezca un
 * catálogo que el importador no sepa leer.
 *
 * D-090 (A8): migrada del `<table>`/`style` inline original al kit de
 * `app/_ui/` (`Panel`, `Tabla`, `MensajeEstado`, tokens de color). Se quita
 * `/carga-masiva` de `PREFIJOS_SIN_MIGRAR` en `AppShell.tsx` junto con la
 * subpágina `/carga-masiva/[catalogo]`.
 *
 * DECISIÓN DE UX (D-090): esta portada sigue enlazando a `/carga-masiva/
 * :catalogo` en vez de abrir el `<CargaMasiva>` modal directamente aquí. El
 * formulario y la tabla de columnas esperadas de esa subpágina son, cada uno,
 * demasiado para vivir dentro de un modal junto a los otros catorce catálogos
 * en la misma vista: obligaría a un modal con scroll dentro de scroll o a una
 * portada enorme con quince acordeones abiertos. Se conserva el patrón
 * «portada con la lista → subpágina con el formulario», ya migrado al kit, y
 * el modal reusable queda para los módulos que YA tienen su propia pantalla de
 * datos (PUC, terceros, parámetros) y solo necesitan una acción secundaria de
 * «cargar un archivo» sin salir de ella — ver la nota en `CargaMasiva.tsx`.
 *
 * TAREA 5 — el acceso a ESTA pantalla lo gobierna `carga_masiva.acceder`
 * (migración 182). Los permisos específicos por catálogo
 * (`parametro.editar`, `tercero.editar`, `puc.editar`...) siguen gobernando,
 * catálogo por catálogo, qué puede cargar cada usuario dentro — eso no
 * cambia: se sigue avisando fila por fila con el mismo `tiene.has(d.permiso)`
 * de antes.
 */
import Link from 'next/link';
import { conSesion } from '../lib/sesion';
import { permisosDeLaSesion, tienePermiso, PERMISOS } from '../../src/auth/permisos';
import { DEFINICIONES } from '../../src/services/carga-masiva/definiciones';
import { Badge, Encabezado, EnlaceBoton, MensajeEstado, Panel, Tabla, Td, Th } from '../_ui/componentes';

export const dynamic = 'force-dynamic';

export default async function PaginaCargaMasiva() {
  const { puedeAcceder, puedeVerHistorial, permisos } = await conSesion(async (tx) => ({
    puedeAcceder: await tienePermiso(tx, PERMISOS.CARGA_MASIVA_ACCEDER),
    puedeVerHistorial: await tienePermiso(tx, PERMISOS.AUDITORIA_LEER),
    permisos: await permisosDeLaSesion(tx),
  }));

  if (!puedeAcceder) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-8">
        <Encabezado titulo="Carga masiva" />
        <MensajeEstado tipo="configuracion" titulo="Falta el permiso para entrar a este módulo">
          Se necesita <code>{PERMISOS.CARGA_MASIVA_ACCEDER}</code>. Pídaselo al administrador de la firma. Los
          permisos de cada catálogo (crear terceros, editar el PUC, editar parámetros...) son un candado aparte:
          este solo abre la puerta de la pantalla.
        </MensajeEstado>
      </main>
    );
  }

  const tiene = new Set(permisos);

  const porModulo = new Map<string, typeof DEFINICIONES>();
  for (const d of DEFINICIONES) {
    const lista = (porModulo.get(d.modulo) ?? []) as typeof DEFINICIONES;
    porModulo.set(d.modulo, [...lista, d] as typeof DEFINICIONES);
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <Encabezado
        titulo="Carga masiva"
        descripcion="Cada catálogo tiene su propia plantilla de Excel, con los encabezados exactos que espera el importador, una fila de ejemplo ya llena y una hoja de instrucciones columna por columna."
        acciones={
          puedeVerHistorial ? (
            <EnlaceBoton href="/carga-masiva/historial" variante="fantasma">
              Ver historial de cargas
            </EnlaceBoton>
          ) : undefined
        }
      />

      <div className="mb-6">
        <MensajeEstado tipo="configuracion" titulo="Si una sola fila está mal, no se carga nada">
          Se le muestra la lista completa de filas con problema (número de fila, columna y motivo) y usted decide
          entre corregir el archivo y volver a subirlo, o cargar solo las filas válidas. Nunca se carga a medias
          por su cuenta.
        </MensajeEstado>
      </div>

      <p className="mb-4 text-menor text-texto-suave">
        Cárguelos en este orden: cada catálogo solo depende de los anteriores. Los números son el orden, no una
        prioridad.
      </p>

      <div className="flex flex-col gap-6">
        {[...porModulo.entries()].map(([modulo, definiciones]) => (
          <Panel key={modulo} titulo={modulo}>
            <Tabla alturaMaxima={null}>
              <thead>
                <tr>
                  <Th>#</Th>
                  <Th>Catálogo</Th>
                  <Th>Plantilla</Th>
                  <Th>Cargar</Th>
                </tr>
              </thead>
              <tbody>
                {definiciones.map((d) => {
                  const puede = tiene.has(d.permiso);
                  return (
                    <tr key={d.clave} className="border-t border-borde/60 align-top">
                      <Td numerico>{DEFINICIONES.findIndex((x) => x.clave === d.clave) + 1}</Td>
                      <Td>
                        <p className="font-semibold text-texto">{d.titulo}</p>
                        <p className="mt-[2px] text-metadata text-texto-suave">{d.descripcion}</p>
                        {d.requierePrevio && d.requierePrevio.length > 0 && (
                          <p className="mt-1 text-metadata text-pendiente-tinta">
                            Requiere cargar antes: {d.requierePrevio.join(', ')}
                          </p>
                        )}
                        {!puede && (
                          <p className="mt-1">
                            <Badge tono="error">Sin permiso {d.permiso}</Badge>
                          </p>
                        )}
                      </Td>
                      <Td>
                        <a
                          className="font-medium text-primario underline dark:text-primario-tinta-oscura"
                          href={`/api/plantillas/${d.clave}`}
                        >
                          Descargar .xlsx
                        </a>
                      </Td>
                      <Td>
                        <Link
                          className="font-medium text-primario underline dark:text-primario-tinta-oscura"
                          href={`/carga-masiva/${d.clave}`}
                        >
                          Subir archivo
                        </Link>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Tabla>
          </Panel>
        ))}
      </div>

      <Panel titulo="Lo que NO se carga por archivo, y por qué" className="mt-6">
        <ul className="list-disc space-y-2 p-5 pl-9 text-cuerpo text-texto">
          <li>
            <strong>Asientos contables.</strong> El ledger es append-only y solo nace de una causación aprobada
            (Regla de Oro 1). Un archivo de asientos sería una puerta trasera al libro.
          </li>
          <li>
            <strong>Facturas.</strong> Entran por el buzón de correo de la empresa como XML DIAN, con
            deduplicación por CUFE. Cargarlas por Excel perdería el CUFE y la trazabilidad al documento original.
          </li>
          <li>
            <strong>Usuarios y roles.</strong> Se administran en{' '}
            <Link className="font-medium text-primario underline dark:text-primario-tinta-oscura" href="/admin/usuarios">
              Administración
            </Link>
            : crear usuarios en bloque desde un archivo, con contraseñas dentro, es exactamente la clase de cosa
            que no debe existir.
          </li>
          <li>
            <strong>Conceptos de causación y mapeo de exógena.</strong> Referencian a la vez cuentas PUC y
            conceptos tributarios, y su semántica está enredada con el clasificador; quedan para una ola
            posterior. Hoy se editan uno a uno.
          </li>
        </ul>
      </Panel>
    </main>
  );
}

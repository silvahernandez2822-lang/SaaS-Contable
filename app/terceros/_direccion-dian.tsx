'use client';

/**
 * D-086 · Interfaz del catálogo geográfico y de la dirección en formato DIAN.
 *
 *  · `SelectorGeografia`  — selector dependiente departamento -> municipio
 *    (catálogo DANE). Emite `departmentId` y `municipalityId` como hidden
 *    inputs dentro del <form> del servidor.
 *  · `CampoDireccionDian` — el campo de dirección: al hacer clic abre un modal
 *    (mismo lenguaje visual que el resto de la app: Panel, tokens, radios) que
 *    guía campo por campo y compone la cadena exacta del Formato 1001. No deja
 *    escribir texto libre: el <input> visible es de solo lectura y lo único
 *    editable es el desglose.
 *
 * Sin colores sueltos: solo tokens de `app/globals.css`. El modal reusa
 * `Panel`, la escala tipográfica y los radios de D-082/D-084.
 */
import { useMemo, useState } from 'react';
import { Boton, Modal } from '../_ui/componentes';
import {
  CUADRANTES,
  TIPOS_COMPLEMENTO,
  TIPOS_VIA_PRINCIPAL,
  componerDireccionDian,
  validarDireccionDian,
  type ComplementoDireccion,
  type DireccionDian,
} from '../../src/domain/direccion-dian';

const CTRL =
  'rounded-md border border-borde bg-superficie-elevada px-3 py-2 text-cuerpo text-texto focus:border-primario focus:outline-none focus:ring-2 focus:ring-primario/20';

export type OpcionCat = { id: string; codigo: string; nombre: string };
export type OpcionMun = { id: string; codigoDane: string; nombre: string; departmentId: string | null };

/* ============================================================ geografía */

export function SelectorGeografia({
  departamentos,
  municipios,
  departmentIdInicial,
  municipalityIdInicial,
  requerido,
  deshabilitado,
}: {
  departamentos: OpcionCat[];
  municipios: OpcionMun[];
  departmentIdInicial?: string | null;
  municipalityIdInicial?: string | null;
  requerido?: boolean;
  deshabilitado?: boolean;
}) {
  const munInicial = municipios.find((m) => m.id === municipalityIdInicial) ?? null;
  const [departmentId, setDepartmentId] = useState<string>(
    departmentIdInicial ?? munInicial?.departmentId ?? '',
  );
  const [municipalityId, setMunicipalityId] = useState<string>(municipalityIdInicial ?? '');

  const municipiosDelDpto = useMemo(
    () => municipios.filter((m) => m.departmentId === departmentId),
    [municipios, departmentId],
  );

  return (
    <>
      <input type="hidden" name="departmentId" value={departmentId} />
      <input type="hidden" name="municipalityId" value={municipalityId} />
      <label className="flex flex-col gap-1.5 text-cuerpo font-medium text-texto">
        Departamento {requerido && <span className="text-error-tinta">*</span>}
        <select
          className={CTRL}
          value={departmentId}
          disabled={deshabilitado}
          onChange={(e) => {
            setDepartmentId(e.target.value);
            setMunicipalityId('');
          }}
        >
          <option value="">Seleccione…</option>
          {departamentos.map((d) => (
            <option key={d.id} value={d.id}>
              {d.nombre} ({d.codigo})
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5 text-cuerpo font-medium text-texto">
        Municipio {requerido && <span className="text-error-tinta">*</span>}
        <select
          className={CTRL}
          value={municipalityId}
          disabled={deshabilitado || !departmentId}
          onChange={(e) => setMunicipalityId(e.target.value)}
        >
          <option value="">{departmentId ? 'Seleccione…' : 'Elija primero el departamento'}</option>
          {municipiosDelDpto.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nombre} ({m.codigoDane})
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

/* ====================================================== dirección DIAN */

const VACIA: DireccionDian = {
  tipoVia: '',
  numeroVia: '',
  letraVia: '',
  bisVia: false,
  letraBisVia: '',
  cuadranteVia: null,
  numeroGeneradora: '',
  letraGeneradora: '',
  cuadranteGeneradora: null,
  placa: '',
  complementos: [],
};

export function CampoDireccionDian({
  direccionInicial,
  estructuraInicial,
  requerido,
  requiereRevision,
}: {
  direccionInicial?: string | null;
  estructuraInicial?: DireccionDian | null;
  requerido?: boolean;
  requiereRevision?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const [estructura, setEstructura] = useState<DireccionDian | null>(estructuraInicial ?? null);
  const [texto, setTexto] = useState<string>(direccionInicial ?? '');

  return (
    <div className="flex flex-col gap-1.5 sm:col-span-2">
      <span className="text-cuerpo font-medium text-texto">
        Dirección {requerido && <span className="text-error-tinta">*</span>}
      </span>
      <input type="hidden" name="direccion" value={texto} />
      <input
        type="hidden"
        name="direccionDian"
        value={estructura ? JSON.stringify(estructura) : ''}
      />
      <div className="flex items-center gap-2">
        <input
          type="text"
          readOnly
          value={texto}
          placeholder="Ábrala con el botón — no se escribe a mano"
          onClick={() => setAbierto(true)}
          className={`${CTRL} flex-1 cursor-pointer`}
        />
        <Boton tipo="button" variante="secundario" onClick={() => setAbierto(true)}>
          {texto ? 'Editar' : 'Componer dirección'}
        </Boton>
      </div>
      {requiereRevision && !estructura && (
        <span className="text-menor text-pendiente-tinta">
          ⚠ Dirección heredada en texto libre. Ábrala y recompóngala con el selector para el Formato 1001.
        </span>
      )}
      {abierto && (
        <ModalDireccionDian
          inicial={estructura ?? VACIA}
          onCancelar={() => setAbierto(false)}
          onAplicar={(d, compuesta) => {
            setEstructura(d);
            setTexto(compuesta);
            setAbierto(false);
          }}
        />
      )}
    </div>
  );
}

function ModalDireccionDian({
  inicial,
  onAplicar,
  onCancelar,
}: {
  inicial: DireccionDian;
  onAplicar: (d: DireccionDian, compuesta: string) => void;
  onCancelar: () => void;
}) {
  const [d, setD] = useState<DireccionDian>({ ...inicial, complementos: [...(inicial.complementos ?? [])] });

  const errores = validarDireccionDian(d);
  const previa = errores.length === 0 ? safeCompose(d) : null;
  const set = (parcial: Partial<DireccionDian>) => setD((prev) => ({ ...prev, ...parcial }));
  const soloDigitos = (s: string) => s.replace(/\D/g, '').slice(0, 4);
  const soloLetra = (s: string) => s.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 1);

  const setComplemento = (i: number, parcial: Partial<ComplementoDireccion>) =>
    setD((prev) => {
      const comps = [...(prev.complementos ?? [])];
      comps[i] = { ...comps[i]!, ...parcial };
      return { ...prev, complementos: comps };
    });

  return (
    <Modal
      titulo="Dirección — Formato DIAN 1001"
      descripcion="Se compone campo por campo. El resultado es la cadena exacta que exige la DIAN."
      onCerrar={onCancelar}
      pie={
        <>
          <Boton tipo="button" variante="fantasma" onClick={onCancelar}>
            Cancelar
          </Boton>
          <Boton
            tipo="button"
            disabled={errores.length > 0}
            onClick={() => previa && onAplicar(d, previa)}
          >
            Aplicar dirección
          </Boton>
        </>
      }
    >
      <>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-cuerpo font-medium text-texto">
            Tipo de vía principal *
            <select
              className={CTRL}
              value={d.tipoVia}
              onChange={(e) => set({ tipoVia: e.target.value })}
            >
              <option value="">Seleccione…</option>
              {TIPOS_VIA_PRINCIPAL.map((t) => (
                <option key={t.abrev} value={t.abrev}>
                  {t.nombre} ({t.abrev})
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-cuerpo font-medium text-texto">
            Número de la vía principal *
            <input
              className={`${CTRL} tabular-nums`}
              inputMode="numeric"
              value={d.numeroVia}
              onChange={(e) => set({ numeroVia: soloDigitos(e.target.value) })}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-cuerpo font-medium text-texto">
            Letra (opcional)
            <input
              className={CTRL}
              value={d.letraVia ?? ''}
              onChange={(e) => set({ letraVia: soloLetra(e.target.value) })}
            />
          </label>
          <div className="flex items-end gap-4 pb-2">
            <label className="flex items-center gap-2 text-cuerpo text-texto">
              <input
                type="checkbox"
                checked={Boolean(d.bisVia)}
                onChange={(e) => set({ bisVia: e.target.checked, letraBisVia: e.target.checked ? d.letraBisVia : '' })}
              />
              BIS
            </label>
            {d.bisVia && (
              <label className="flex flex-col gap-1 text-menor text-texto-suave">
                Letra BIS
                <input
                  className={`${CTRL} w-16`}
                  value={d.letraBisVia ?? ''}
                  onChange={(e) => set({ letraBisVia: soloLetra(e.target.value) })}
                />
              </label>
            )}
          </div>
          <label className="flex flex-col gap-1.5 text-cuerpo font-medium text-texto">
            Cuadrante de la vía principal
            <select
              className={CTRL}
              value={d.cuadranteVia ?? ''}
              onChange={(e) => set({ cuadranteVia: (e.target.value || null) as DireccionDian['cuadranteVia'] })}
            >
              <option value="">—</option>
              {CUADRANTES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          <div className="sm:col-span-2 mt-1 border-t border-borde/60 pt-3 text-menor font-semibold text-texto-suave">
            Después del <span className="font-mono">#</span> — vía generadora y placa
          </div>
          <label className="flex flex-col gap-1.5 text-cuerpo font-medium text-texto">
            Número de la vía generadora *
            <input
              className={`${CTRL} tabular-nums`}
              inputMode="numeric"
              value={d.numeroGeneradora}
              onChange={(e) => set({ numeroGeneradora: soloDigitos(e.target.value) })}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-cuerpo font-medium text-texto">
            Letra (opcional)
            <input
              className={CTRL}
              value={d.letraGeneradora ?? ''}
              onChange={(e) => set({ letraGeneradora: soloLetra(e.target.value) })}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-cuerpo font-medium text-texto">
            Cuadrante de la vía generadora
            <select
              className={CTRL}
              value={d.cuadranteGeneradora ?? ''}
              onChange={(e) =>
                set({ cuadranteGeneradora: (e.target.value || null) as DireccionDian['cuadranteGeneradora'] })
              }
            >
              <option value="">—</option>
              {CUADRANTES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-cuerpo font-medium text-texto">
            Placa (número tras el «-») *
            <input
              className={`${CTRL} tabular-nums`}
              inputMode="numeric"
              value={d.placa}
              onChange={(e) => set({ placa: soloDigitos(e.target.value) })}
            />
          </label>

          <div className="sm:col-span-2 mt-1 flex items-center justify-between border-t border-borde/60 pt-3">
            <span className="text-menor font-semibold text-texto-suave">
              Complementos (interior, torre, apartamento…)
            </span>
            <Boton
              tipo="button"
              variante="terciario"
              onClick={() => set({ complementos: [...(d.complementos ?? []), { tipo: 'IN', valor: '' }] })}
            >
              + Añadir
            </Boton>
          </div>
          {(d.complementos ?? []).map((c, i) => (
            <div key={i} className="flex items-end gap-2 sm:col-span-2">
              <label className="flex flex-1 flex-col gap-1 text-menor text-texto-suave">
                Tipo
                <select
                  className={CTRL}
                  value={c.tipo}
                  onChange={(e) => setComplemento(i, { tipo: e.target.value })}
                >
                  {TIPOS_COMPLEMENTO.map((t) => (
                    <option key={t.abrev} value={t.abrev}>
                      {t.nombre} ({t.abrev})
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-1 flex-col gap-1 text-menor text-texto-suave">
                Valor
                <input
                  className={CTRL}
                  value={c.valor}
                  onChange={(e) =>
                    setComplemento(i, { valor: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) })
                  }
                />
              </label>
              <Boton
                tipo="button"
                variante="peligro"
                onClick={() =>
                  set({ complementos: (d.complementos ?? []).filter((_, j) => j !== i) })
                }
              >
                Quitar
              </Boton>
            </div>
          ))}
        </div>

        <div className="mt-4 border-t border-borde pt-3">
          <p className="text-menor text-texto-suave">Vista previa</p>
          <p className="mt-1 font-mono text-cuerpo text-texto">
            {previa ?? <span className="text-texto-suave">Complete los campos obligatorios…</span>}
          </p>
          {errores.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-menor text-error-tinta">
              {errores.map((er) => (
                <li key={er}>{er}</li>
              ))}
            </ul>
          )}
        </div>
      </>
    </Modal>
  );
}

function safeCompose(d: DireccionDian): string | null {
  try {
    return componerDireccionDian(d);
  } catch {
    return null;
  }
}

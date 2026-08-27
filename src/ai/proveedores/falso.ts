/**
 * A5 — Proveedor de LLM FALSO y determinista.
 *
 * Es el que usan TODAS las pruebas. No abre un socket, no lee una variable de
 * entorno y no necesita un secreto: la suite corre sin red, como corría antes
 * de esta ola.
 *
 * Además de sustituir al modelo, cuenta las llamadas. Ese contador es la
 * evidencia del caso dorado 19: la segunda factura del mismo proveedor con la
 * misma descripción tiene que dejarlo en cero.
 *
 * CÓMO «CLASIFICA». Compara las palabras significativas de la descripción
 * normalizada con las del nombre y la descripción de cada concepto del
 * catálogo, y devuelve el mejor, con un score en milésimas igual a la
 * proporción de palabras de la descripción que el concepto explica. Los
 * empates se rompen por código, en orden alfabético, para que el resultado no
 * dependa del orden en que la base devolvió las filas. Es una heurística de
 * juguete, y no pretende ser otra cosa: lo que las pruebas verifican no es que
 * clasifique bien, sino que el FLUJO alrededor sea correcto —memoria antes que
 * modelo, umbrales, cola, catálogo cerrado y determinismo—.
 */
import type { PeticionLlm, ProveedorLlm, RespuestaLlm } from '../tipos.js';

/** Palabras vacías del español que no aportan a la comparación. */
const VACIAS = new Set([
  'de',
  'del',
  'la',
  'las',
  'el',
  'los',
  'y',
  'o',
  'a',
  'en',
  'por',
  'para',
  'con',
  'un',
  'una',
  'al',
  'su',
  'sus',
]);

function palabras(texto: string): string[] {
  return texto
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((p) => p !== '' && !VACIAS.has(p));
}

/** Milésimas, entero: la escala en la que trabaja todo el subsistema. */
const MILESIMAS = 1000;

export interface OpcionesProveedorFalso {
  /** Tokens de salida que declara cada respuesta. */
  tokensSalida?: number;
  /** Si se fija, todas las respuestas devuelven este score. Para pruebas de umbral. */
  scoreFijo?: number;
  /** Si se fija, todas las respuestas devuelven este código (aunque no exista). */
  codigoFijo?: string | null;
  /** Si se fija, `clasificar` lanza. Para probar el camino de fallo. */
  falla?: boolean;
}

export class ProveedorLlmFalso implements ProveedorLlm {
  readonly nombre = 'falso-determinista';

  private contador = 0;
  private readonly opciones: OpcionesProveedorFalso;

  /** Las peticiones recibidas, en orden. Sirve para comparar dos reprocesos. */
  readonly peticiones: PeticionLlm[] = [];

  constructor(opciones: OpcionesProveedorFalso = {}) {
    this.opciones = opciones;
  }

  /** Cuántas veces se llamó al «modelo». El caso 19 exige 0 en la segunda pasada. */
  get llamadas(): number {
    return this.contador;
  }

  reiniciarContador(): void {
    this.contador = 0;
    this.peticiones.length = 0;
  }

  async clasificar(peticion: PeticionLlm): Promise<RespuestaLlm> {
    this.contador += 1;
    this.peticiones.push(peticion);

    if (this.opciones.falla === true) {
      throw new Error('proveedor falso: fallo simulado');
    }

    const tokensEntrada = Math.ceil((peticion.sistema.length + peticion.usuario.length) / 4);
    const tokensSalida = this.opciones.tokensSalida ?? 24;

    if (this.opciones.codigoFijo !== undefined) {
      return {
        codigo: this.opciones.codigoFijo,
        scoreMilesimas: this.opciones.scoreFijo ?? MILESIMAS,
        tokensEntrada,
        tokensSalida,
        modelo: peticion.modelo,
      };
    }

    const buscadas = palabras(peticion.contexto.descripcion);
    let mejorCodigo: string | null = null;
    let mejorScore = 0;

    const candidatos = [...peticion.contexto.catalogo].sort((a, b) =>
      a.codigo < b.codigo ? -1 : a.codigo > b.codigo ? 1 : 0,
    );

    for (const concepto of candidatos) {
      const vocabulario = new Set(palabras(`${concepto.nombre} ${concepto.descripcion ?? ''}`));
      if (buscadas.length === 0 || vocabulario.size === 0) continue;
      const aciertos = buscadas.filter((p) => vocabulario.has(p)).length;
      const score = Math.round((aciertos * MILESIMAS) / buscadas.length);
      if (score > mejorScore) {
        mejorScore = score;
        mejorCodigo = concepto.codigo;
      }
    }

    return {
      codigo: mejorScore > 0 ? mejorCodigo : null,
      scoreMilesimas: this.opciones.scoreFijo ?? mejorScore,
      tokensEntrada,
      tokensSalida,
      modelo: peticion.modelo,
    };
  }
}

import { Injectable } from '@nestjs/common';
import {
  type CategoriaDelBanco,
  CategoriasRepositorio,
  LARGO_DE_LA_LINEA,
  LARGO_DEL_NOMBRE,
  motivoDeCodigoInvalido,
  normalizarCodigo,
  type ResultadoDeGuardado,
} from './categoria.js';

/** Un archivo que no se puede leer entero: no se importa nada. */
export class ArchivoDeCodigosInvalido extends Error {}

export interface FilaDeCsv {
  /** Línea del archivo donde empieza la fila, contando desde 1. */
  linea: number;
  celdas: string[];
}

export interface FilaRechazada {
  /** Línea del archivo, contando la cabecera como la 1. */
  linea: number;
  motivo: string;
}

export interface PlanDeImportacion {
  categorias: CategoriaDelBanco[];
  rechazadas: FilaRechazada[];
}

export interface ReporteDeImportacion extends ResultadoDeGuardado {
  rechazadas: FilaRechazada[];
  productosSinCodigo: string[];
}

/**
 * Importación de los códigos del Banco al catálogo (SBA-12, RF-M1-04).
 *
 * Lee la hoja de códigos exportada a CSV, guarda cada código como categoría
 * y devuelve un reporte: qué se creó, qué cambió, qué filas no se pudieron
 * usar y qué productos siguen sin código. Correrla dos veces con el mismo
 * archivo no duplica nada.
 */
@Injectable()
export class ImportacionCatalogoService {
  constructor(private readonly repositorio: CategoriasRepositorio) {}

  /**
   * Recibe el archivo tal como sale del disco, o ya como texto. Los bytes
   * tienen que ser UTF-8: Excel en español guarda «CSV (delimitado por comas)»
   * en Windows-1252, y leerlo como UTF-8 cambiaría la «é» de «Tubérculos» por
   * un carácter de reemplazo y pisaría el nombre bueno.
   */
  async importar(archivo: Uint8Array | string): Promise<ReporteDeImportacion> {
    const csv = typeof archivo === 'string' ? archivo : decodificar(archivo);
    const { categorias, rechazadas } = planificarCategorias(leerCsv(csv));
    // Antes de guardar, que solo toca categorías con código y no cambia esta
    // lista: si la base falla aquí, todavía no se importó nada.
    const productosSinCodigo = await this.repositorio.productosSinCodigo();
    const guardado = await this.repositorio.guardar(categorias);

    return { ...guardado, rechazadas, productosSinCodigo };
  }
}

function decodificar(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new ArchivoDeCodigosInvalido(
      'El archivo no está en UTF-8. En Excel, guárdalo como «CSV UTF-8 (delimitado por comas)».',
    );
  }
}

/**
 * CSV a filas de celdas, cada una con la línea donde empieza. El separador es
 * `;` si la primera línea con contenido lo trae (Excel en español exporta así)
 * y `,` si no. Una comilla abre una celda entre comillas solo al principio de
 * la celda; en otro lugar es texto (`TV 32" pulgadas`). Unas comillas que
 * abren y no cierran invalidan el archivo: si no, el resto de la hoja quedaría
 * dentro de esa celda sin que nadie lo note.
 */
export function leerCsv(texto: string): FilaDeCsv[] {
  const limpio = texto.replace(/^\uFEFF/, '');
  const primera = limpio.split('\n').find((l) => l.trim() !== '') ?? '';
  const separador = primera.includes(';') ? ';' : ',';
  const filas: FilaDeCsv[] = [];
  let fila: string[] = [];
  let celda = '';
  let entreComillas = false;
  let linea = 1;
  let inicioDeFila = 1;

  const cerrarFila = () => {
    fila.push(celda);
    if (fila.some((c) => c.trim() !== '')) filas.push({ linea: inicioDeFila, celdas: fila });
    fila = [];
    celda = '';
  };

  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i];
    if (c === '\n') linea++;
    if (entreComillas) {
      if (c === '"' && limpio[i + 1] === '"') {
        celda += '"';
        i++;
      } else if (c === '"') {
        entreComillas = false;
      } else if (c !== '\r') {
        celda += c;
      }
    } else if (c === '"' && celda === '') {
      entreComillas = true;
    } else if (c === separador) {
      fila.push(celda);
      celda = '';
    } else if (c === '\n') {
      cerrarFila();
      inicioDeFila = linea;
    } else if (c !== '\r') {
      celda += c;
    }
  }
  if (entreComillas) {
    throw new ArchivoDeCodigosInvalido(
      `La fila de la línea ${inicioDeFila} abre comillas y no las cierra.`,
    );
  }
  cerrarFila();

  return filas;
}

/**
 * Filas del CSV a categorías. La cabecera nombra las columnas; hacen falta
 * `codigo` y `subcategoria`, y se usan `linea` y `productos` si vienen. Una
 * fila que no sirve va al reporte con su número de línea y no detiene las
 * demás. Una celda vacía de línea o productos no borra lo guardado.
 *
 * La columna `linea_codigo` (E0, G1, AS2…) no se guarda: la línea se
 * identifica por nombre.
 *
 * Una fila con un salto de línea dentro de una celda también va al reporte,
 * aunque sea en una columna que no se guarda, como `linea_codigo`; en la
 * cabecera invalida el archivo. La hoja del Banco no trae ninguno; cuando
 * aparece, casi siempre es una comilla al principio de una celda que se
 * cierra varias filas más abajo y mete en la celda las filas de en medio.
 */
export function planificarCategorias(filas: FilaDeCsv[]): PlanDeImportacion {
  const [cabecera, ...datos] = filas;
  const columna = indicesDeColumna(cabecera?.celdas ?? []);
  const categorias: CategoriaDelBanco[] = [];
  const rechazadas: FilaRechazada[] = [];
  const lineaDelCodigo = new Map<string, number>();

  for (const { linea, celdas } of datos) {
    const leer = (indice: number | undefined) => celdas[indice ?? -1]?.trim() || null;
    const codigo = normalizarCodigo(leer(columna.codigo));
    const nombre = leer(columna.subcategoria);
    const lineaDelBanco = leer(columna.linea);
    const descripcion = leer(columna.productos);

    const motivo = motivoDeRechazo(celdas, codigo, nombre, lineaDelBanco, lineaDelCodigo);
    if (motivo) {
      rechazadas.push({ linea, motivo });
      continue;
    }

    lineaDelCodigo.set(codigo as string, linea);
    categorias.push({
      codigo: codigo as string,
      nombre: nombre as string,
      ...(lineaDelBanco && { linea: lineaDelBanco }),
      ...(descripcion && { descripcion }),
    });
  }

  return { categorias, rechazadas };
}

function indicesDeColumna(cabecera: string[]) {
  if (cabecera.some(conSaltoDeLinea)) {
    throw new ArchivoDeCodigosInvalido(
      'La primera fila trae un salto de línea dentro de una celda; revisa las comillas.',
    );
  }
  const indice = (nombre: string) => {
    const i = cabecera.findIndex((c) => sinTildes(c.trim().toLowerCase()) === nombre);
    return i === -1 ? undefined : i;
  };
  const columna = {
    codigo: indice('codigo'),
    subcategoria: indice('subcategoria'),
    linea: indice('linea'),
    productos: indice('productos'),
  };

  if (columna.codigo === undefined || columna.subcategoria === undefined) {
    throw new ArchivoDeCodigosInvalido(
      'El archivo necesita las columnas «codigo» y «subcategoria» en la primera fila.',
    );
  }
  return columna;
}

/** «Código» y «Subcategoría», como las escribe una persona en Excel. */
function sinTildes(texto: string): string {
  return texto.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

function conSaltoDeLinea(celda: string): boolean {
  return /[\r\n]/.test(celda);
}

function motivoDeRechazo(
  celdas: string[],
  codigo: string | null,
  nombre: string | null,
  linea: string | null,
  lineaDelCodigo: Map<string, number>,
): string | null {
  if (celdas.some(conSaltoDeLinea)) {
    return 'La fila trae un salto de línea dentro de una celda; revisa las comillas.';
  }
  if (!codigo) return 'Sin código.';
  if (!nombre) return 'Sin subcategoría.';
  const codigoInvalido = motivoDeCodigoInvalido(codigo);
  if (codigoInvalido) return codigoInvalido;
  if (nombre.length > LARGO_DEL_NOMBRE) {
    return `La subcategoría pasa de ${LARGO_DEL_NOMBRE} caracteres.`;
  }
  if (linea && linea.length > LARGO_DE_LA_LINEA) {
    return `La línea pasa de ${LARGO_DE_LA_LINEA} caracteres.`;
  }
  const anterior = lineaDelCodigo.get(codigo);
  if (anterior) return `El código ${codigo} ya aparece en la línea ${anterior}.`;
  return null;
}

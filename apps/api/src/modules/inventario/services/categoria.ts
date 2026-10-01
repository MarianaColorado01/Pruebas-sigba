/**
 * Categoría del Banco, la regla de su código y el puerto por el que se guarda
 * (SBA-12).
 *
 * Una categoría es un código del Banco (C801, G103) que agrupa productos en
 * cualquier presentación. El banco y el actor los pone el adaptador desde el
 * contexto de tenant; `services/` no importa Prisma (RNF-03).
 */

/** Los largos de las columnas de `inventario.categoria`. */
export const LARGO_DEL_CODIGO = 20;
export const LARGO_DEL_NOMBRE = 100;
export const LARGO_DE_LA_LINEA = 100;

/** Sin espacios a los lados y en mayúsculas: `' c801 '` es C801. Vacío es sin código. */
export function normalizarCodigo(codigo: string | null | undefined): string | null {
  return codigo?.trim().toUpperCase() || null;
}

/** Por qué un código ya normalizado no sirve, o `null` si sirve. */
export function motivoDeCodigoInvalido(codigo: string): string | null {
  if (/\s/.test(codigo) || codigo.length > LARGO_DEL_CODIGO) {
    return `El código del Banco va sin espacios y no puede pasar de ${LARGO_DEL_CODIGO} caracteres.`;
  }
  return null;
}

/**
 * `linea` y `descripcion` quedan `undefined` cuando el archivo no trae esa
 * columna o la celda viene vacía: entonces no se tocan, en vez de borrar lo
 * que ya había.
 */
export interface CategoriaDelBanco {
  codigo: string;
  nombre: string;
  linea?: string | null;
  descripcion?: string | null;
}

export interface ResultadoDeGuardado {
  creadas: number;
  actualizadas: number;
  sinCambios: number;
}

export abstract class CategoriasRepositorio {
  /** Crea o actualiza por código, en una sola transacción. */
  abstract guardar(categorias: CategoriaDelBanco[]): Promise<ResultadoDeGuardado>;

  /** Nombres de los productos cuya categoría todavía no tiene código. */
  abstract productosSinCodigo(): Promise<string[]>;
}

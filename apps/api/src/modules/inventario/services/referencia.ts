/**
 * Catálogo del Banco y el puerto por el que se guarda (SBA-22).
 *
 * Categoría (un código del Banco), producto y referencia (producto más
 * presentación). El puerto vive aquí y el adaptador de Prisma en
 * `repositories/`: `services/` no importa el SDK (RNF-03). El banco y el actor
 * los pone el adaptador desde el contexto de tenant.
 */

export interface Categoria {
  id: string;
  codigo: string | null;
  nombre: string;
  linea: string | null;
  descripcion: string | null;
  activa: boolean;
}

export interface Producto {
  id: string;
  categoriaId: string;
  nombre: string;
  activo: boolean;
}

/**
 * Una referencia con lo que el buscador muestra de su producto y su categoría.
 * El código del Banco es el de la categoría: una referencia no tiene uno propio.
 */
export interface ReferenciaDelCatalogo {
  id: string;
  presentacion: string;
  /** Decimal(10,3) como texto, para no perder precisión en el camino. */
  equivalenciaKg: string;
  creadaDesdeCelular: boolean;
  activa: boolean;
  producto: { id: string; nombre: string };
  categoria: { id: string; codigo: string | null; nombre: string; linea: string | null };
}

/** El catálogo activo agrupado por categoría, como lo guarda la PWA. */
export interface CategoriaDelCatalogo {
  id: string;
  codigo: string | null;
  nombre: string;
  linea: string | null;
  descripcion: string | null;
  productos: {
    id: string;
    nombre: string;
    referencias: {
      id: string;
      presentacion: string;
      equivalenciaKg: string;
      creadaDesdeCelular: boolean;
    }[];
  }[];
}

export type DatosDeCategoria = Omit<Categoria, 'id' | 'activa'>;
export type CambiosEnCategoria = Partial<Omit<Categoria, 'id'>>;

export type DatosDeProducto = Omit<Producto, 'id' | 'activo'>;
export type CambiosEnProducto = Partial<Omit<Producto, 'id'>>;

export interface DatosDeReferencia {
  productoId: string;
  presentacion: string;
  equivalenciaKg: string;
  creadaDesdeCelular: boolean;
}

export type CambiosEnReferencia = Partial<
  Omit<DatosDeReferencia, 'creadaDesdeCelular'> & { activa: boolean }
>;

export interface BusquedaDeReferencias {
  /** Cada palabra tiene que aparecer en el producto, la presentación o el código. */
  palabras: string[];
  categoriaId?: string;
  soloActivas: boolean;
  limite: number;
}

/**
 * Las reglas de unicidad y de pertenencia al banco las aplica el motor. Una
 * clave repetida sale como `ConflictException`; una categoría o un producto
 * padre que no existe en el banco, como `NotFoundException`. Crear bajo un
 * padre desactivado, o bajo un producto cuya categoría lo está, sale como
 * `ConflictException`, igual que mover una fila a él: lo que cuelgue de él no
 * aparecería en la búsqueda ni en el catálogo. Reenviar en una edición el padre
 * que la fila ya tiene no la mueve, así que no se rechaza.
 */
export abstract class ReferenciasRepositorio {
  abstract buscar(busqueda: BusquedaDeReferencias): Promise<ReferenciaDelCatalogo[]>;

  /** Categorías activas con sus productos y referencias activos. */
  abstract catalogo(): Promise<CategoriaDelCatalogo[]>;

  abstract crearCategoria(datos: DatosDeCategoria): Promise<Categoria>;

  /** `null` si la categoría no existe en el banco del contexto. */
  abstract actualizarCategoria(id: string, cambios: CambiosEnCategoria): Promise<Categoria | null>;

  abstract crearProducto(datos: DatosDeProducto): Promise<Producto>;

  /** `null` si el producto no existe en el banco del contexto. */
  abstract actualizarProducto(id: string, cambios: CambiosEnProducto): Promise<Producto | null>;

  abstract crearReferencia(datos: DatosDeReferencia): Promise<ReferenciaDelCatalogo>;

  /** `null` si la referencia no existe en el banco del contexto. */
  abstract actualizarReferencia(
    id: string,
    cambios: CambiosEnReferencia,
  ): Promise<ReferenciaDelCatalogo | null>;
}

import { createHash } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  LARGO_DE_LA_LINEA,
  LARGO_DEL_NOMBRE,
  motivoDeCodigoInvalido,
  normalizarCodigo,
} from './categoria.js';
import {
  type CambiosEnCategoria,
  type CambiosEnProducto,
  type CambiosEnReferencia,
  type Categoria,
  type CategoriaDelCatalogo,
  type Producto,
  type ReferenciaDelCatalogo,
  ReferenciasRepositorio,
} from './referencia.js';

/** Suficiente para el buscador incremental del registro. */
const LIMITE_DE_BUSQUEDA = 30;

/** Los largos de las columnas de producto y referencia; los de categoría están en categoria.ts. */
const LARGO_DE_PRODUCTO = 200;
const LARGO_DE_PRESENTACION = 100;

/** Decimal(10,3): hasta siete enteros y tres decimales. */
const EQUIVALENCIA_KG = /^\d{1,7}(\.\d{1,3})?$/;

export interface NuevaCategoria {
  codigo?: string | null;
  nombre: string;
  linea?: string | null;
  descripcion?: string | null;
}

export interface NuevoProducto {
  categoriaId: string;
  nombre: string;
}

export interface NuevaReferencia {
  productoId: string;
  presentacion: string;
  /** En kilos. Acepta coma o punto decimal: «0,5» y «0.5» son medio kilo. */
  equivalenciaKg: string | number;
  creadaDesdeCelular?: boolean;
}

export interface FiltroDeReferencias {
  texto?: string;
  categoriaId?: string;
  incluirInactivas?: boolean;
}

/** El catálogo con una versión que cambia solo si cambia su contenido. */
export interface CatalogoVersionado {
  version: string;
  categorias: CategoriaDelCatalogo[];
}

/**
 * Catálogo de categorías, productos y referencias (SBA-22, RF-M1-03, RF-M1-04).
 *
 * El operario busca por nombre, presentación o código del Banco; la
 * coordinación da de alta, edita y desactiva. Nada se borra: los movimientos
 * pasados siguen nombrando la referencia, así que se desactiva. Las claves
 * únicas cuentan también las filas desactivadas: lo que se desactivó por error
 * se reactiva, porque crearlo otra vez choca con la clave.
 */
@Injectable()
export class ReferenciasService {
  constructor(private readonly repositorio: ReferenciasRepositorio) {}

  async buscar(filtro: FiltroDeReferencias = {}): Promise<ReferenciaDelCatalogo[]> {
    return this.repositorio.buscar({
      palabras: textoLimpio(filtro.texto ?? '')
        .split(' ')
        .filter(Boolean),
      ...(filtro.categoriaId && { categoriaId: filtro.categoriaId }),
      soloActivas: !filtro.incluirInactivas,
      limite: LIMITE_DE_BUSQUEDA,
    });
  }

  /**
   * El catálogo activo para la caché de la PWA. La versión es un hash del
   * contenido: sirve de ETag y no depende de relojes ni de contadores.
   */
  async catalogo(): Promise<CatalogoVersionado> {
    const categorias = await this.repositorio.catalogo();
    const version = createHash('sha256')
      .update(JSON.stringify(categorias))
      .digest('base64url')
      .slice(0, 22);
    return { version, categorias };
  }

  async crearCategoria(nueva: NuevaCategoria): Promise<Categoria> {
    return this.repositorio.crearCategoria({
      codigo: codigoValido(nueva.codigo),
      nombre: obligatorio(nueva.nombre, 'el nombre de la categoría', LARGO_DEL_NOMBRE),
      linea: opcional(nueva.linea, 'la línea', LARGO_DE_LA_LINEA),
      descripcion: nueva.descripcion?.trim() || null,
    });
  }

  async editarCategoria(id: string, edicion: Partial<NuevaCategoria>): Promise<Categoria> {
    const cambios: CambiosEnCategoria = {};
    if (edicion.codigo !== undefined) cambios.codigo = codigoValido(edicion.codigo);
    if (edicion.nombre !== undefined) {
      cambios.nombre = obligatorio(edicion.nombre, 'el nombre de la categoría', LARGO_DEL_NOMBRE);
    }
    if (edicion.linea !== undefined) {
      cambios.linea = opcional(edicion.linea, 'la línea', LARGO_DE_LA_LINEA);
    }
    if (edicion.descripcion !== undefined)
      cambios.descripcion = edicion.descripcion?.trim() || null;

    return this.actualizarCategoria(id, cambios);
  }

  async desactivarCategoria(id: string): Promise<Categoria> {
    return this.actualizarCategoria(id, { activa: false });
  }

  async reactivarCategoria(id: string): Promise<Categoria> {
    return this.actualizarCategoria(id, { activa: true });
  }

  async crearProducto(nuevo: NuevoProducto): Promise<Producto> {
    return this.repositorio.crearProducto({
      categoriaId: nuevo.categoriaId,
      nombre: obligatorio(nuevo.nombre, 'el nombre del producto', LARGO_DE_PRODUCTO),
    });
  }

  /** Cambiar la categoría es como se le asigna código a un producto que no tenía. */
  async editarProducto(id: string, edicion: Partial<NuevoProducto>): Promise<Producto> {
    const cambios: CambiosEnProducto = {};
    if (edicion.categoriaId !== undefined) cambios.categoriaId = edicion.categoriaId;
    if (edicion.nombre !== undefined) {
      cambios.nombre = obligatorio(edicion.nombre, 'el nombre del producto', LARGO_DE_PRODUCTO);
    }

    return this.actualizarProducto(id, cambios);
  }

  async desactivarProducto(id: string): Promise<Producto> {
    return this.actualizarProducto(id, { activo: false });
  }

  async reactivarProducto(id: string): Promise<Producto> {
    return this.actualizarProducto(id, { activo: true });
  }

  async crearReferencia(nueva: NuevaReferencia): Promise<ReferenciaDelCatalogo> {
    return this.repositorio.crearReferencia({
      productoId: nueva.productoId,
      presentacion: obligatorio(nueva.presentacion, 'la presentación', LARGO_DE_PRESENTACION),
      equivalenciaKg: equivalenciaValida(nueva.equivalenciaKg),
      creadaDesdeCelular: nueva.creadaDesdeCelular ?? false,
    });
  }

  async editarReferencia(
    id: string,
    edicion: Partial<Omit<NuevaReferencia, 'creadaDesdeCelular'>>,
  ): Promise<ReferenciaDelCatalogo> {
    const cambios: CambiosEnReferencia = {};
    if (edicion.productoId !== undefined) cambios.productoId = edicion.productoId;
    if (edicion.presentacion !== undefined) {
      cambios.presentacion = obligatorio(
        edicion.presentacion,
        'la presentación',
        LARGO_DE_PRESENTACION,
      );
    }
    if (edicion.equivalenciaKg !== undefined) {
      cambios.equivalenciaKg = equivalenciaValida(edicion.equivalenciaKg);
    }

    return this.actualizarReferencia(id, cambios);
  }

  async desactivarReferencia(id: string): Promise<ReferenciaDelCatalogo> {
    return this.actualizarReferencia(id, { activa: false });
  }

  async reactivarReferencia(id: string): Promise<ReferenciaDelCatalogo> {
    return this.actualizarReferencia(id, { activa: true });
  }

  // RLS no distingue «no existe» de «es de otro banco», y la respuesta
  // tampoco debe distinguirlos.

  private async actualizarCategoria(id: string, cambios: CambiosEnCategoria) {
    const categoria = await this.repositorio.actualizarCategoria(id, cambios);
    if (!categoria) throw new NotFoundException('No existe esa categoría.');
    return categoria;
  }

  private async actualizarProducto(id: string, cambios: CambiosEnProducto) {
    const producto = await this.repositorio.actualizarProducto(id, cambios);
    if (!producto) throw new NotFoundException('No existe ese producto.');
    return producto;
  }

  private async actualizarReferencia(id: string, cambios: CambiosEnReferencia) {
    const referencia = await this.repositorio.actualizarReferencia(id, cambios);
    if (!referencia) throw new NotFoundException('No existe esa referencia.');
    return referencia;
  }
}

function textoLimpio(texto: string): string {
  return texto.trim().replace(/\s+/g, ' ');
}

function obligatorio(texto: string, campo: string, largo: number): string {
  const limpio = textoLimpio(texto);
  if (!limpio) throw new BadRequestException(`Falta ${campo}.`);
  return dentroDelLargo(limpio, campo, largo);
}

function opcional(texto: string | null | undefined, campo: string, largo: number): string | null {
  const limpio = textoLimpio(texto ?? '');
  return limpio ? dentroDelLargo(limpio, campo, largo) : null;
}

function dentroDelLargo(texto: string, campo: string, largo: number): string {
  if (texto.length > largo) {
    const sujeto = campo.charAt(0).toUpperCase() + campo.slice(1);
    throw new BadRequestException(`${sujeto} no puede pasar de ${largo} caracteres.`);
  }
  return texto;
}

/**
 * La misma regla que aplica el importador de la hoja del Banco (SBA-12). Sin
 * código, los productos de la categoría quedan pendientes de código.
 */
function codigoValido(codigo: string | null | undefined): string | null {
  const normalizado = normalizarCodigo(codigo);
  const motivo = normalizado && motivoDeCodigoInvalido(normalizado);
  if (motivo) throw new BadRequestException(motivo);
  return normalizado;
}

function equivalenciaValida(equivalencia: string | number): string {
  const texto = String(equivalencia).trim().replace(',', '.');
  if (!EQUIVALENCIA_KG.test(texto) || Number(texto) <= 0) {
    throw new BadRequestException(
      'La equivalencia en kilos debe ser mayor que cero y tener hasta tres decimales.',
    );
  }
  return texto;
}

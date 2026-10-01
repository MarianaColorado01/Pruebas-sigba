import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type BusquedaDeReferencias,
  type CambiosEnCategoria,
  type CambiosEnProducto,
  type CambiosEnReferencia,
  type Categoria,
  type CategoriaDelCatalogo,
  type DatosDeCategoria,
  type DatosDeProducto,
  type DatosDeReferencia,
  type Producto,
  type ReferenciaDelCatalogo,
  ReferenciasRepositorio,
} from './referencia.js';
import { ReferenciasService } from './referencias.service.js';

/**
 * Repositorio en memoria: guarda lo que recibe para que la prueba lo mire. La
 * búsqueda y el catálogo reales los prueba `referencias.integracion.spec.ts`
 * contra PostgreSQL.
 */
class RepositorioEnMemoria extends ReferenciasRepositorio {
  categorias: Categoria[] = [];
  productos: Producto[] = [];
  referencias: ReferenciaDelCatalogo[] = [];
  arbol: CategoriaDelCatalogo[] = [];
  ultimaBusqueda?: BusquedaDeReferencias;

  async buscar(busqueda: BusquedaDeReferencias): Promise<ReferenciaDelCatalogo[]> {
    this.ultimaBusqueda = busqueda;
    return this.referencias;
  }

  async catalogo(): Promise<CategoriaDelCatalogo[]> {
    return this.arbol;
  }

  async crearCategoria(datos: DatosDeCategoria): Promise<Categoria> {
    const categoria = { id: `c-${this.categorias.length + 1}`, activa: true, ...datos };
    this.categorias.push(categoria);
    return categoria;
  }

  async actualizarCategoria(id: string, cambios: CambiosEnCategoria) {
    const categoria = this.categorias.find((c) => c.id === id);
    return categoria ? Object.assign(categoria, cambios) : null;
  }

  async crearProducto(datos: DatosDeProducto): Promise<Producto> {
    const producto = { id: `p-${this.productos.length + 1}`, activo: true, ...datos };
    this.productos.push(producto);
    return producto;
  }

  async actualizarProducto(id: string, cambios: CambiosEnProducto) {
    const producto = this.productos.find((p) => p.id === id);
    return producto ? Object.assign(producto, cambios) : null;
  }

  async crearReferencia(datos: DatosDeReferencia): Promise<ReferenciaDelCatalogo> {
    const referencia = {
      id: `r-${this.referencias.length + 1}`,
      presentacion: datos.presentacion,
      equivalenciaKg: datos.equivalenciaKg,
      creadaDesdeCelular: datos.creadaDesdeCelular,
      activa: true,
      producto: { id: datos.productoId, nombre: 'Arroz' },
      categoria: { id: 'c-1', codigo: 'C801', nombre: 'Arroz', linea: 'Cereales' },
    };
    this.referencias.push(referencia);
    return referencia;
  }

  async actualizarReferencia(id: string, cambios: CambiosEnReferencia) {
    const referencia = this.referencias.find((r) => r.id === id);
    if (!referencia) return null;
    const { productoId, ...resto } = cambios;
    if (productoId) referencia.producto.id = productoId;
    return Object.assign(referencia, resto);
  }
}

describe('ReferenciasService', () => {
  let repositorio: RepositorioEnMemoria;
  let servicio: ReferenciasService;

  beforeEach(() => {
    repositorio = new RepositorioEnMemoria();
    servicio = new ReferenciasService(repositorio);
  });

  describe('buscar', () => {
    it('parte el texto en palabras limpias para buscar «arroz 500» como dos condiciones', async () => {
      await servicio.buscar({ texto: '  arroz   500 ' });

      expect(repositorio.ultimaBusqueda).toEqual({
        palabras: ['arroz', '500'],
        soloActivas: true,
        limite: 30,
      });
    });

    it('sin texto no filtra por palabras y respeta la categoría', async () => {
      await servicio.buscar({ categoriaId: 'c-1' });

      expect(repositorio.ultimaBusqueda).toMatchObject({ palabras: [], categoriaId: 'c-1' });
    });

    it('incluye inactivas solo si se piden, para la administración', async () => {
      await servicio.buscar({ incluirInactivas: true });

      expect(repositorio.ultimaBusqueda?.soloActivas).toBe(false);
    });
  });

  describe('catalogo', () => {
    const arroz: CategoriaDelCatalogo = {
      id: 'c-1',
      codigo: 'C801',
      nombre: 'Arroz',
      linea: 'Cereales',
      descripcion: null,
      productos: [
        {
          id: 'p-1',
          nombre: 'Arroz',
          referencias: [
            { id: 'r-1', presentacion: '500 g', equivalenciaKg: '0.5', creadaDesdeCelular: false },
          ],
        },
      ],
    };

    it('devuelve la misma versión mientras el contenido no cambie', async () => {
      repositorio.arbol = [arroz];
      const primera = await servicio.catalogo();
      const segunda = await servicio.catalogo();

      expect(primera.categorias).toEqual([arroz]);
      expect(segunda.version).toBe(primera.version);
    });

    it('cambia la versión cuando cambia una referencia', async () => {
      repositorio.arbol = [arroz];
      const antes = await servicio.catalogo();

      repositorio.arbol = [
        {
          ...arroz,
          productos: [
            {
              id: 'p-1',
              nombre: 'Arroz',
              referencias: [
                {
                  id: 'r-1',
                  presentacion: '1 kg',
                  equivalenciaKg: '1',
                  creadaDesdeCelular: false,
                },
              ],
            },
          ],
        },
      ];
      const despues = await servicio.catalogo();

      expect(despues.version).not.toBe(antes.version);
    });
  });

  describe('categorías', () => {
    it('guarda el código en mayúsculas y sin espacios a los lados', async () => {
      const categoria = await servicio.crearCategoria({
        codigo: ' c801 ',
        nombre: ' Arroz ',
        linea: 'Cereales',
      });

      expect(categoria).toMatchObject({
        codigo: 'C801',
        nombre: 'Arroz',
        linea: 'Cereales',
        descripcion: null,
        activa: true,
      });
    });

    it('acepta una categoría sin código: sus productos quedan pendientes de código', async () => {
      const categoria = await servicio.crearCategoria({ codigo: '  ', nombre: 'Aseo' });

      expect(categoria).toMatchObject({ codigo: null, linea: null });
    });

    it('rechaza un código con espacios o más largo que la columna, con el motivo del importador', async () => {
      const motivo = 'El código del Banco va sin espacios y no puede pasar de 20 caracteres.';
      const conEspacios = servicio.crearCategoria({ codigo: 'C 801', nombre: 'Arroz' });

      await expect(conEspacios).rejects.toThrow(BadRequestException);
      await expect(conEspacios).rejects.toThrow(motivo);
      await expect(
        servicio.crearCategoria({ codigo: 'C'.repeat(21), nombre: 'Arroz' }),
      ).rejects.toThrow(motivo);
      const { id } = await servicio.crearCategoria({ codigo: 'C801', nombre: 'Arroz' });
      await expect(servicio.editarCategoria(id, { codigo: 'C\t801' })).rejects.toThrow(motivo);
    });

    it('rechaza una categoría sin nombre o con una línea demasiado larga', async () => {
      await expect(servicio.crearCategoria({ nombre: '  ' })).rejects.toThrow(
        'Falta el nombre de la categoría.',
      );
      await expect(
        servicio.crearCategoria({ nombre: 'Arroz', linea: 'x'.repeat(101) }),
      ).rejects.toThrow('La línea no puede pasar de 100 caracteres.');
    });

    it('edita solo lo que llega y puede quitar el código', async () => {
      const { id } = await servicio.crearCategoria({ codigo: 'C801', nombre: 'Arroz' });

      const editada = await servicio.editarCategoria(id, {
        codigo: null,
        linea: ' Cereales ',
        descripcion: ' Arroz blanco e integral ',
      });

      expect(editada).toMatchObject({
        codigo: null,
        nombre: 'Arroz',
        linea: 'Cereales',
        descripcion: 'Arroz blanco e integral',
      });
    });

    it('cambia el nombre de la categoría al editar', async () => {
      const { id } = await servicio.crearCategoria({ nombre: 'Arroz' });

      expect((await servicio.editarCategoria(id, { nombre: 'Arroces' })).nombre).toBe('Arroces');
    });

    it('desactiva en vez de borrar', async () => {
      const { id } = await servicio.crearCategoria({ nombre: 'Aseo' });

      expect((await servicio.desactivarCategoria(id)).activa).toBe(false);
    });

    it('reactiva la categoría desactivada por error', async () => {
      const { id } = await servicio.crearCategoria({ nombre: 'Aseo' });
      await servicio.desactivarCategoria(id);

      expect((await servicio.reactivarCategoria(id)).activa).toBe(true);
    });

    it('responde 404 si la categoría no existe o es de otro banco', async () => {
      await expect(servicio.desactivarCategoria('otra')).rejects.toThrow(NotFoundException);
      await expect(servicio.reactivarCategoria('otra')).rejects.toThrow('No existe esa categoría.');
    });
  });

  describe('productos', () => {
    it('crea el producto en su categoría con el nombre limpio', async () => {
      const producto = await servicio.crearProducto({
        categoriaId: 'c-1',
        nombre: ' Arroz  blanco ',
      });

      expect(producto).toEqual({
        id: 'p-1',
        categoriaId: 'c-1',
        nombre: 'Arroz blanco',
        activo: true,
      });
    });

    it('rechaza un producto sin nombre o más largo que la columna', async () => {
      await expect(servicio.crearProducto({ categoriaId: 'c-1', nombre: '' })).rejects.toThrow(
        'Falta el nombre del producto.',
      );
      await expect(
        servicio.crearProducto({ categoriaId: 'c-1', nombre: 'x'.repeat(201) }),
      ).rejects.toThrow('El nombre del producto no puede pasar de 200 caracteres.');
    });

    it('le asigna código moviéndolo a otra categoría', async () => {
      const { id } = await servicio.crearProducto({ categoriaId: 'sin-codigo', nombre: 'Arroz' });

      const editado = await servicio.editarProducto(id, { categoriaId: 'c-1', nombre: 'Arroz' });

      expect(editado.categoriaId).toBe('c-1');
    });

    it('desactiva el producto y responde 404 si no existe', async () => {
      const { id } = await servicio.crearProducto({ categoriaId: 'c-1', nombre: 'Arroz' });

      expect((await servicio.desactivarProducto(id)).activo).toBe(false);
      await expect(servicio.editarProducto('otro', { nombre: 'Frijol' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('reactiva el producto y responde 404 si no existe', async () => {
      const { id } = await servicio.crearProducto({ categoriaId: 'c-1', nombre: 'Arroz' });
      await servicio.desactivarProducto(id);

      expect((await servicio.reactivarProducto(id)).activo).toBe(true);
      await expect(servicio.reactivarProducto('otro')).rejects.toThrow('No existe ese producto.');
    });
  });

  describe('referencias', () => {
    it('crea la presentación con la equivalencia como texto y sin marca de celular', async () => {
      const referencia = await servicio.crearReferencia({
        productoId: 'p-1',
        presentacion: ' 500   g ',
        equivalenciaKg: 0.5,
      });

      expect(referencia).toMatchObject({
        presentacion: '500 g',
        equivalenciaKg: '0.5',
        creadaDesdeCelular: false,
      });
    });

    it('acepta la coma decimal como la escriben en el Banco', async () => {
      const arroba = await servicio.crearReferencia({
        productoId: 'p-1',
        presentacion: 'arroba',
        equivalenciaKg: '12,5',
      });

      expect(arroba.equivalenciaKg).toBe('12.5');
    });

    it('marca la referencia creada desde el celular para revisión', async () => {
      const referencia = await servicio.crearReferencia({
        productoId: 'p-1',
        presentacion: '480 g',
        equivalenciaKg: '0.48',
        creadaDesdeCelular: true,
      });

      expect(referencia.creadaDesdeCelular).toBe(true);
    });

    it.each(['0', '-1', 'medio', '0.0005', '12345678'])(
      'rechaza la equivalencia %s',
      async (equivalenciaKg) => {
        await expect(
          servicio.crearReferencia({ productoId: 'p-1', presentacion: '500 g', equivalenciaKg }),
        ).rejects.toThrow(BadRequestException);
      },
    );

    it('rechaza una presentación vacía', async () => {
      await expect(
        servicio.crearReferencia({ productoId: 'p-1', presentacion: ' ', equivalenciaKg: 1 }),
      ).rejects.toThrow('Falta la presentación.');
    });

    it('edita producto, presentación y equivalencia', async () => {
      const { id } = await servicio.crearReferencia({
        productoId: 'p-1',
        presentacion: '500 g',
        equivalenciaKg: 0.5,
      });

      const editada = await servicio.editarReferencia(id, {
        productoId: 'p-2',
        presentacion: '1 kg',
        equivalenciaKg: '1',
      });

      expect(editada).toMatchObject({
        presentacion: '1 kg',
        equivalenciaKg: '1',
        producto: { id: 'p-2' },
      });
    });

    it('desactiva la referencia y responde 404 si no existe', async () => {
      const { id } = await servicio.crearReferencia({
        productoId: 'p-1',
        presentacion: '500 g',
        equivalenciaKg: 0.5,
      });

      expect((await servicio.desactivarReferencia(id)).activa).toBe(false);
      await expect(servicio.editarReferencia('otra', { presentacion: '1 kg' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('reactiva la referencia y responde 404 si no existe', async () => {
      const { id } = await servicio.crearReferencia({
        productoId: 'p-1',
        presentacion: '500 g',
        equivalenciaKg: 0.5,
      });
      await servicio.desactivarReferencia(id);

      expect((await servicio.reactivarReferencia(id)).activa).toBe(true);
      await expect(servicio.reactivarReferencia('otra')).rejects.toThrow(
        'No existe esa referencia.',
      );
    });
  });
});

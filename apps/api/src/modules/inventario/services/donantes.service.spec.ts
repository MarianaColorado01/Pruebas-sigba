import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AltaDeDonante,
  type BusquedaDeDonantes,
  type CambiosEnDonante,
  type DatosDeDonante,
  type Donante,
  DonantesRepositorio,
  NombreDeDonanteRepetido,
} from './donante.js';
import { DonantesService } from './donantes.service.js';

/** Repositorio en memoria: guarda lo que recibe para que la prueba lo mire. */
class RepositorioEnMemoria extends DonantesRepositorio {
  donantes: Donante[] = [];
  ultimaBusqueda?: BusquedaDeDonantes;

  /** Como el adaptador: un activo con el mismo tipo y nombre se devuelve en vez de duplicarse. */
  async crear(datos: DatosDeDonante): Promise<AltaDeDonante> {
    const existente = this.donantes.find(
      (d) =>
        d.activo && d.tipo === datos.tipo && d.nombre.toLowerCase() === datos.nombre.toLowerCase(),
    );
    if (existente) return { donante: existente, repetido: true };
    const donante = { id: `d-${this.donantes.length + 1}`, activo: true, ...datos };
    this.donantes.push(donante);
    return { donante, repetido: false };
  }

  /** Ordena por nombre y corta en el límite, como la base: sin eso no se vería el tope de la búsqueda. */
  async buscar(busqueda: BusquedaDeDonantes): Promise<Donante[]> {
    this.ultimaBusqueda = busqueda;
    return this.donantes
      .filter(
        (d) =>
          (!busqueda.id || d.id === busqueda.id) &&
          (!busqueda.texto || d.nombre.toLowerCase().includes(busqueda.texto.toLowerCase())) &&
          (!busqueda.tipo || d.tipo === busqueda.tipo) &&
          (!busqueda.soloActivos || d.activo),
      )
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
      .slice(0, busqueda.limite);
  }

  /** Como el índice único parcial: dos activos no comparten tipo y nombre. */
  async actualizar(id: string, cambios: CambiosEnDonante): Promise<Donante | null> {
    const donante = this.donantes.find((d) => d.id === id);
    if (!donante) return null;
    const despues = { ...donante, ...cambios };
    const choca = this.donantes.some(
      (d) =>
        d.id !== id &&
        despues.activo &&
        d.activo &&
        d.tipo === despues.tipo &&
        d.nombre.toLowerCase() === despues.nombre.toLowerCase(),
    );
    if (choca) throw new NombreDeDonanteRepetido();
    Object.assign(donante, cambios);
    return donante;
  }
}

describe('DonantesService', () => {
  let repositorio: RepositorioEnMemoria;
  let servicio: DonantesService;

  beforeEach(() => {
    repositorio = new RepositorioEnMemoria();
    servicio = new DonantesService(repositorio);
  });

  describe('crear', () => {
    it('devuelve el donante activo con el mismo nombre y tipo en vez de duplicarlo', async () => {
      const primero = await servicio.darDeAlta({ nombre: 'Parroquia San José', tipo: 'parroquia' });
      const segundo = await servicio.darDeAlta({
        nombre: ' parroquia  san josé ',
        tipo: 'parroquia',
      });

      expect(primero.repetido).toBe(false);
      expect(segundo).toEqual({ donante: primero.donante, repetido: true });
      expect(repositorio.donantes).toHaveLength(1);
    });

    it('crea otro si el nombre coincide pero el tipo no, o si el existente está inactivo', async () => {
      const { donante } = await servicio.darDeAlta({ nombre: 'Juan', tipo: 'particular' });
      await servicio.darDeAlta({ nombre: 'Juan', tipo: 'empresa' });
      await servicio.desactivar(donante.id);
      const otro = await servicio.darDeAlta({ nombre: 'Juan', tipo: 'particular' });

      expect(otro.repetido).toBe(false);
      expect(repositorio.donantes).toHaveLength(3);
    });

    it('encuentra el repetido aunque haya veinte nombres parecidos que ordenan antes', async () => {
      for (let n = 10; n < 30; n++) {
        await servicio.darDeAlta({ nombre: `Almacén Éxito ${n}`, tipo: 'empresa' });
      }
      const primero = await servicio.darDeAlta({ nombre: 'Éxito', tipo: 'empresa' });
      const segundo = await servicio.darDeAlta({ nombre: 'éxito', tipo: 'empresa' });

      expect(primero.repetido).toBe(false);
      expect(segundo).toEqual({ donante: primero.donante, repetido: true });
      expect(repositorio.donantes.filter((d) => d.nombre.toLowerCase() === 'éxito')).toHaveLength(
        1,
      );
    });

    it('no confunde un nombre que solo contiene al otro', async () => {
      await servicio.darDeAlta({ nombre: 'Almacén Éxito', tipo: 'empresa' });
      const exito = await servicio.darDeAlta({ nombre: 'Éxito', tipo: 'empresa' });

      expect(exito.repetido).toBe(false);
    });

    it('da de alta con solo nombre y tipo, sin contacto', async () => {
      const donante = await servicio.crear({ nombre: 'Parroquia San José', tipo: 'parroquia' });

      expect(donante).toMatchObject({
        nombre: 'Parroquia San José',
        tipo: 'parroquia',
        contacto: null,
        activo: true,
      });
    });

    it('limpia los espacios sobrantes del nombre', async () => {
      const donante = await servicio.crear({ nombre: '  Supermercado   La 14 ', tipo: 'empresa' });

      expect(donante.nombre).toBe('Supermercado La 14');
    });

    it('guarda el contacto cuando viene, y nulo cuando es solo espacios', async () => {
      const conContacto = await servicio.crear({
        nombre: 'Panadería El Trigal',
        tipo: 'empresa',
        contacto: ' 300 000 0000 ',
      });
      const sinContacto = await servicio.crear({
        nombre: 'Otro',
        tipo: 'particular',
        contacto: '   ',
      });

      expect(conContacto.contacto).toBe('300 000 0000');
      expect(sinContacto.contacto).toBeNull();
    });

    it('rechaza un nombre vacío', async () => {
      await expect(servicio.crear({ nombre: '   ', tipo: 'empresa' })).rejects.toThrow(
        BadRequestException,
      );
      expect(repositorio.donantes).toHaveLength(0);
    });

    it('rechaza un nombre de más de 200 caracteres', async () => {
      await expect(servicio.crear({ nombre: 'a'.repeat(201), tipo: 'empresa' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rechaza un contacto de más de 200 caracteres', async () => {
      await expect(
        servicio.crear({ nombre: 'Alguien', tipo: 'particular', contacto: 'a'.repeat(201) }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza un contacto largo aunque el nombre ya exista, sin devolver el existente', async () => {
      await servicio.darDeAlta({ nombre: 'Parroquia San José', tipo: 'parroquia' });

      await expect(
        servicio.darDeAlta({
          nombre: 'Parroquia San José',
          tipo: 'parroquia',
          contacto: 'a'.repeat(201),
        }),
      ).rejects.toThrow(BadRequestException);
      expect(repositorio.donantes).toHaveLength(1);
    });

    it('rechaza un tipo que no es del directorio', async () => {
      await expect(
        servicio.crear({ nombre: 'Alguien', tipo: 'gobierno' as Donante['tipo'] }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('buscar', () => {
    it('filtra por tipo: con parroquia solo salen parroquias', async () => {
      await servicio.crear({ nombre: 'Parroquia San José', tipo: 'parroquia' });
      await servicio.crear({ nombre: 'Supermercado La 14', tipo: 'empresa' });

      const parroquias = await servicio.buscar({ tipo: 'parroquia' });

      expect(parroquias.map((d) => d.nombre)).toEqual(['Parroquia San José']);
    });

    it('sin filtro pide solo activos, con un límite para la búsqueda incremental', async () => {
      await servicio.buscar();

      expect(repositorio.ultimaBusqueda).toEqual({ soloActivos: true, limite: 20 });
    });

    it('recorta el texto y descarta el que queda vacío', async () => {
      await servicio.buscar({ texto: '  san  ' });
      expect(repositorio.ultimaBusqueda?.texto).toBe('san');

      await servicio.buscar({ texto: '   ' });
      expect(repositorio.ultimaBusqueda?.texto).toBeUndefined();
    });

    it('incluye inactivos solo cuando se piden, para administración', async () => {
      await servicio.buscar({ incluirInactivos: true });

      expect(repositorio.ultimaBusqueda?.soloActivos).toBe(false);
    });

    it('rechaza filtrar por un tipo que no existe', async () => {
      await expect(servicio.buscar({ tipo: 'gobierno' as Donante['tipo'] })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('editar', () => {
    it('cambia solo los campos que llegan', async () => {
      const { id } = await servicio.crear({ nombre: 'Juan', tipo: 'particular' });

      const editado = await servicio.editar(id, { contacto: 'juan@ejemplo.test' });

      expect(editado).toMatchObject({
        nombre: 'Juan',
        tipo: 'particular',
        contacto: 'juan@ejemplo.test',
      });
    });

    it('aplica las mismas reglas que el alta', async () => {
      const { id } = await servicio.crear({ nombre: 'Juan', tipo: 'particular' });

      await expect(servicio.editar(id, { nombre: ' ' })).rejects.toThrow(BadRequestException);
      await expect(servicio.editar(id, { tipo: 'gobierno' as Donante['tipo'] })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('borra el contacto cuando llega vacío', async () => {
      const { id } = await servicio.crear({ nombre: 'Juan', tipo: 'particular', contacto: 'x' });

      const editado = await servicio.editar(id, { contacto: '' });

      expect(editado.contacto).toBeNull();
    });

    it('responde 404 si el donante no existe o es de otro banco', async () => {
      await expect(servicio.editar('no-existe', { nombre: 'X' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('responde 409 si el nuevo nombre ya es de otro donante activo del mismo tipo', async () => {
      await servicio.crear({ nombre: 'Parroquia San José', tipo: 'parroquia' });
      const { id } = await servicio.crear({ nombre: 'Parroquia Santa Ana', tipo: 'parroquia' });

      await expect(servicio.editar(id, { nombre: 'parroquia san josé' })).rejects.toThrow(
        ConflictException,
      );
      expect(repositorio.donantes.map((d) => d.nombre)).toEqual([
        'Parroquia San José',
        'Parroquia Santa Ana',
      ]);
    });

    it('responde 409 si al cambiar el tipo choca con un activo de ese tipo', async () => {
      await servicio.crear({ nombre: 'Juan', tipo: 'empresa' });
      const { id } = await servicio.crear({ nombre: 'Juan', tipo: 'particular' });

      await expect(servicio.editar(id, { tipo: 'empresa' })).rejects.toThrow(ConflictException);
    });

    it('deja tomar el nombre de un donante desactivado', async () => {
      const { id: viejo } = await servicio.crear({ nombre: 'Juan', tipo: 'particular' });
      await servicio.desactivar(viejo);
      const { id } = await servicio.crear({ nombre: 'Pedro', tipo: 'particular' });

      const editado = await servicio.editar(id, { nombre: 'Juan' });

      expect(editado.nombre).toBe('Juan');
    });
  });

  describe('desactivar', () => {
    it('lo deja inactivo sin borrarlo, para que las recepciones viejas lo conserven', async () => {
      const { id } = await servicio.crear({ nombre: 'Juan', tipo: 'particular' });

      const desactivado = await servicio.desactivar(id);

      expect(desactivado.activo).toBe(false);
      expect(await servicio.buscar()).toEqual([]);
      const todos = await servicio.buscar({ incluirInactivos: true });
      expect(todos.map((d) => d.id)).toEqual([id]);
    });

    it('responde 404 si el donante no existe o es de otro banco', async () => {
      await expect(servicio.desactivar('no-existe')).rejects.toThrow(NotFoundException);
    });
  });

  describe('obtenerActivo', () => {
    it('devuelve el donante activo que pide la recepción', async () => {
      const { id } = await servicio.crear({ nombre: 'Supermercado La 14', tipo: 'empresa' });

      expect((await servicio.obtenerActivo(id)).nombre).toBe('Supermercado La 14');
      expect(repositorio.ultimaBusqueda).toEqual({ id, soloActivos: true, limite: 1 });
    });

    it('responde 404 si el donante no existe o está desactivado', async () => {
      const { id } = await servicio.crear({ nombre: 'Juan', tipo: 'particular' });
      await servicio.desactivar(id);

      await expect(servicio.obtenerActivo(id)).rejects.toThrow(
        'No existe ese donante o está desactivado.',
      );
      await expect(servicio.obtenerActivo('no-existe')).rejects.toThrow(NotFoundException);
    });
  });
});

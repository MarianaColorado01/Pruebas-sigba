import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type BusquedaDeDonantes,
  type CambiosEnDonante,
  type DatosDeDonante,
  type Donante,
  DonantesRepositorio,
} from './donante.js';
import { DonantesService } from './donantes.service.js';

/** Repositorio en memoria: guarda lo que recibe para que la prueba lo mire. */
class RepositorioEnMemoria extends DonantesRepositorio {
  donantes: Donante[] = [];
  ultimaBusqueda?: BusquedaDeDonantes;

  async crear(datos: DatosDeDonante): Promise<Donante> {
    const donante = { id: `d-${this.donantes.length + 1}`, activo: true, ...datos };
    this.donantes.push(donante);
    return donante;
  }

  async buscar(busqueda: BusquedaDeDonantes): Promise<Donante[]> {
    this.ultimaBusqueda = busqueda;
    return this.donantes.filter(
      (d) => (!busqueda.tipo || d.tipo === busqueda.tipo) && (!busqueda.soloActivos || d.activo),
    );
  }

  async actualizar(id: string, cambios: CambiosEnDonante): Promise<Donante | null> {
    const donante = this.donantes.find((d) => d.id === id);
    if (!donante) return null;
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
});

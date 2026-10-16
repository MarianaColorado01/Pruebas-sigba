import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { AdministracionDeBodegasService } from './administracion-de-bodegas.service.js';
import {
  type FichaDeBodega,
  AdministracionDeBodegasRepositorio,
  BodegaConStock,
  type CambiosEnBodega,
  type DatosDeBodega,
  NombreDeBodegaRepetido,
} from './bodega.js';

/** Repositorio en memoria de un solo banco: guarda lo que recibe para que la prueba lo mire. */
class RepositorioEnMemoria extends AdministracionDeBodegasRepositorio {
  bodegas: FichaDeBodega[] = [];
  ultimoFiltro?: { soloActivas: boolean };
  /** Las que el trigger de la base no deja desactivar (SBA-76). */
  conStock = new Set<string>();

  async crear(datos: DatosDeBodega): Promise<FichaDeBodega> {
    this.validar(datos.nombre, undefined, true);
    const bodega = { id: `b-${this.bodegas.length + 1}`, activa: true, ...datos };
    this.bodegas.push(bodega);
    return bodega;
  }

  async listar(filtro: { soloActivas: boolean }): Promise<FichaDeBodega[]> {
    this.ultimoFiltro = filtro;
    return this.bodegas.filter((b) => !filtro.soloActivas || b.activa);
  }

  async actualizar(id: string, cambios: CambiosEnBodega): Promise<FichaDeBodega | null> {
    const bodega = this.bodegas.find((b) => b.id === id);
    if (!bodega) return null;
    if (cambios.nombre) this.validar(cambios.nombre, id);
    if (cambios.activa === false && bodega.activa && this.conStock.has(id)) {
      throw new BodegaConStock();
    }
    return Object.assign(bodega, cambios);
  }

  /** Como el adaptador: el alta lleva la bodega que choca; la edición, no. */
  private validar(nombre: string, propia?: string, alta = false): void {
    const choca = this.bodegas.find(
      (b) => b.id !== propia && b.nombre.toLowerCase() === nombre.toLowerCase(),
    );
    if (choca) throw new NombreDeBodegaRepetido(alta ? choca : null);
  }
}

describe('AdministracionDeBodegasService', () => {
  let repositorio: RepositorioEnMemoria;
  let servicio: AdministracionDeBodegasService;

  beforeEach(() => {
    repositorio = new RepositorioEnMemoria();
    servicio = new AdministracionDeBodegasService(repositorio);
  });

  describe('crear', () => {
    it('da de alta activa y sin dirección si no llega', async () => {
      const { bodega } = await servicio.crear({ nombre: 'Bodega central' });

      expect(bodega).toMatchObject({ nombre: 'Bodega central', direccion: null, activa: true });
    });

    it('quita espacios sobrantes del nombre y la dirección', async () => {
      const { bodega } = await servicio.crear({
        nombre: '  Bodega   norte ',
        direccion: ' Cra 7 #  10-20 ',
      });

      expect(bodega).toMatchObject({ nombre: 'Bodega norte', direccion: 'Cra 7 # 10-20' });
    });

    it('deja la dirección en nulo si llega vacía', async () => {
      const { bodega } = await servicio.crear({ nombre: 'Bodega', direccion: '   ' });

      expect(bodega.direccion).toBeNull();
    });

    it('rechaza un nombre vacío', async () => {
      await expect(servicio.crear({ nombre: '  ' })).rejects.toThrow(BadRequestException);
    });

    it('acepta 80 caracteres de nombre y rechaza 81', async () => {
      await expect(servicio.crear({ nombre: 'a'.repeat(80) })).resolves.toBeDefined();
      await expect(servicio.crear({ nombre: 'b'.repeat(81) })).rejects.toThrow(
        /no puede pasar de 80/,
      );
    });

    it('rechaza una dirección de más de 200 caracteres', async () => {
      await expect(
        servicio.crear({ nombre: 'Bodega', direccion: 'd'.repeat(201) }),
      ).rejects.toThrow(/no puede pasar de 200/);
    });

    it('responde 409 si el nombre ya existe en el banco con otras mayúsculas', async () => {
      await servicio.crear({ nombre: 'Bodega central' });

      await expect(servicio.crear({ nombre: 'BODEGA CENTRAL' })).rejects.toThrow(ConflictException);
    });

    describe('idempotencia natural, sin comandoId', () => {
      it('el mismo alta otra vez devuelve la bodega existente, marcada como repetida', async () => {
        const primera = await servicio.crear({ nombre: 'Bodega central', direccion: 'Calle 1' });

        const segunda = await servicio.crear({ nombre: ' Bodega  central ', direccion: 'Calle 1' });

        expect(primera.repetida).toBe(false);
        expect(segunda).toEqual({ bodega: primera.bodega, repetida: true });
        expect(repositorio.bodegas).toHaveLength(1);
      });

      it('el mismo nombre con otra dirección sigue siendo 409', async () => {
        await servicio.crear({ nombre: 'Bodega central', direccion: 'Calle 1' });

        await expect(
          servicio.crear({ nombre: 'Bodega central', direccion: 'Calle 2' }),
        ).rejects.toThrow(ConflictException);
      });

      it('el mismo nombre con otras mayúsculas no es el mismo alta: 409', async () => {
        await servicio.crear({ nombre: 'Bodega central' });

        await expect(servicio.crear({ nombre: 'bodega central' })).rejects.toThrow(
          ConflictException,
        );
      });

      it('si la existente está desactivada, 409 y no se la devuelve', async () => {
        const { bodega } = await servicio.crear({ nombre: 'Bodega central' });
        await servicio.desactivar(bodega.id);

        await expect(servicio.crear({ nombre: 'Bodega central' })).rejects.toThrow(
          ConflictException,
        );
      });
    });
  });

  describe('listar', () => {
    it('por defecto pide solo las activas', async () => {
      await servicio.listar();

      expect(repositorio.ultimoFiltro).toEqual({ soloActivas: true });
    });

    it('con incluirInactivas pide todas', async () => {
      await servicio.listar({ incluirInactivas: true });

      expect(repositorio.ultimoFiltro).toEqual({ soloActivas: false });
    });
  });

  describe('editar', () => {
    it('cambia solo lo que llega', async () => {
      const {
        bodega: { id },
      } = await servicio.crear({ nombre: 'Bodega', direccion: 'Calle 1' });

      const editada = await servicio.editar(id, { nombre: 'Bodega sur' });

      expect(editada).toMatchObject({ nombre: 'Bodega sur', direccion: 'Calle 1' });
    });

    it('borra la dirección cuando llega nula', async () => {
      const {
        bodega: { id },
      } = await servicio.crear({ nombre: 'Bodega', direccion: 'Calle 1' });

      const editada = await servicio.editar(id, { direccion: null });

      expect(editada.direccion).toBeNull();
    });

    it('valida igual que el alta', async () => {
      const {
        bodega: { id },
      } = await servicio.crear({ nombre: 'Bodega' });

      await expect(servicio.editar(id, { nombre: '' })).rejects.toThrow(BadRequestException);
    });

    it('permite guardar su propio nombre y rechaza el de otra', async () => {
      const {
        bodega: { id },
      } = await servicio.crear({ nombre: 'Bodega central' });
      await servicio.crear({ nombre: 'Bodega norte' });

      await expect(servicio.editar(id, { nombre: 'Bodega Central' })).resolves.toBeDefined();
      await expect(servicio.editar(id, { nombre: 'bodega norte' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('responde 404 si no existe en el banco', async () => {
      await expect(servicio.editar('nada', { nombre: 'X' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('desactivar y reactivar', () => {
    it('desactiva sin borrar y la saca del listado por defecto', async () => {
      const {
        bodega: { id },
      } = await servicio.crear({ nombre: 'Bodega' });

      expect((await servicio.desactivar(id)).activa).toBe(false);
      expect(await servicio.listar()).toHaveLength(0);
      expect(await servicio.listar({ incluirInactivas: true })).toHaveLength(1);
    });

    it('reactiva una bodega desactivada', async () => {
      const {
        bodega: { id },
      } = await servicio.crear({ nombre: 'Bodega' });
      await servicio.desactivar(id);

      expect((await servicio.reactivar(id)).activa).toBe(true);
    });

    it('con stock responde 409 y la bodega sigue activa', async () => {
      const {
        bodega: { id },
      } = await servicio.crear({ nombre: 'Bodega' });
      repositorio.conStock.add(id);

      await expect(servicio.desactivar(id)).rejects.toThrow(ConflictException);
      await expect(servicio.desactivar(id)).rejects.toThrow(/todavía tiene stock/);
      expect(await servicio.listar()).toHaveLength(1);
    });

    it('responde 404 si no existe', async () => {
      await expect(servicio.desactivar('nada')).rejects.toThrow(NotFoundException);
      await expect(servicio.reactivar('nada')).rejects.toThrow(NotFoundException);
    });
  });
});

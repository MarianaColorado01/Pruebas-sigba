import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { AdministracionDeBancosService } from './administracion-de-bancos.service.js';
import {
  type Banco,
  BancosRepositorio,
  type CambiosEnBanco,
  CodigoDeBancoRepetido,
  type DatosDeBanco,
} from './banco.js';

class RepositorioEnMemoria extends BancosRepositorio {
  bancos: Banco[] = [];

  async crear(datos: DatosDeBanco): Promise<Banco> {
    this.validar(datos.codigo, undefined, true);
    const banco = { id: `k-${this.bancos.length + 1}`, activo: true, ...datos };
    this.bancos.push(banco);
    return banco;
  }

  async listar(): Promise<Banco[]> {
    return this.bancos;
  }

  async actualizar(id: string, cambios: CambiosEnBanco): Promise<Banco | null> {
    const banco = this.bancos.find((b) => b.id === id);
    if (!banco) return null;
    if (cambios.codigo) this.validar(cambios.codigo, id);
    return Object.assign(banco, cambios);
  }

  /** Como el adaptador: el alta lleva el banco que choca; la edición, no. */
  private validar(codigo: string, propio?: string, alta = false): void {
    const choca = this.bancos.find((b) => b.id !== propio && b.codigo === codigo);
    if (choca) throw new CodigoDeBancoRepetido(alta ? choca : null);
  }
}

describe('AdministracionDeBancosService', () => {
  let repositorio: RepositorioEnMemoria;
  let servicio: AdministracionDeBancosService;

  beforeEach(() => {
    repositorio = new RepositorioEnMemoria();
    servicio = new AdministracionDeBancosService(repositorio);
  });

  describe('crear', () => {
    it('da de alta activo, con el código en mayúsculas y sin espacios sobrantes', async () => {
      const { banco } = await servicio.crear({ nombre: '  Banco de  Pereira ', codigo: ' bap-1 ' });

      expect(banco).toMatchObject({ nombre: 'Banco de Pereira', codigo: 'BAP-1', activo: true });
    });

    it('rechaza un nombre vacío', async () => {
      await expect(servicio.crear({ nombre: ' ', codigo: 'BAP' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rechaza un nombre de más de 200 caracteres', async () => {
      await expect(servicio.crear({ nombre: 'n'.repeat(201), codigo: 'BAP' })).rejects.toThrow(
        /no puede pasar de 200/,
      );
    });

    it('acepta un código de 20 caracteres y rechaza uno de 21', async () => {
      await expect(servicio.crear({ nombre: 'A', codigo: 'A'.repeat(20) })).resolves.toBeDefined();
      await expect(servicio.crear({ nombre: 'B', codigo: 'B'.repeat(21) })).rejects.toThrow(
        /no puede pasar de 20/,
      );
    });

    it.each(['', 'BA P', 'BAP_1', 'BAPÑ'])('rechaza el código %j', async (codigo) => {
      await expect(servicio.crear({ nombre: 'Banco', codigo })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('responde 409 si el código ya existe, sin importar mayúsculas', async () => {
      await servicio.crear({ nombre: 'Banco de Pereira', codigo: 'BAP' });

      await expect(servicio.crear({ nombre: 'Otro', codigo: 'bap' })).rejects.toThrow(
        ConflictException,
      );
    });

    describe('idempotencia natural, sin comandoId', () => {
      it('el mismo alta otra vez devuelve el banco existente, marcado como repetido', async () => {
        const primero = await servicio.crear({ nombre: 'Banco de Pereira', codigo: 'BAP' });

        const segundo = await servicio.crear({ nombre: ' Banco de  Pereira ', codigo: ' bap ' });

        expect(primero.repetido).toBe(false);
        expect(segundo).toEqual({ banco: primero.banco, repetido: true });
        expect(repositorio.bancos).toHaveLength(1);
      });

      it('si el banco existente está desactivado, 409 y no se lo devuelve', async () => {
        const { banco } = await servicio.crear({ nombre: 'Banco de Pereira', codigo: 'BAP' });
        await servicio.desactivar(banco.id);

        await expect(servicio.crear({ nombre: 'Banco de Pereira', codigo: 'BAP' })).rejects.toThrow(
          ConflictException,
        );
      });
    });
  });

  it('lista los bancos que le da el repositorio', async () => {
    await servicio.crear({ nombre: 'Banco de Pereira', codigo: 'BAP' });

    expect(await servicio.listar()).toHaveLength(1);
  });

  describe('editar', () => {
    it('cambia solo lo que llega y normaliza el código', async () => {
      const {
        banco: { id },
      } = await servicio.crear({ nombre: 'Banco de Pereira', codigo: 'BAP' });

      const editado = await servicio.editar(id, { codigo: 'bapr' });

      expect(editado).toMatchObject({ nombre: 'Banco de Pereira', codigo: 'BAPR' });
    });

    it('valida igual que el alta', async () => {
      const {
        banco: { id },
      } = await servicio.crear({ nombre: 'Banco de Pereira', codigo: 'BAP' });

      await expect(servicio.editar(id, { nombre: '' })).rejects.toThrow(BadRequestException);
    });

    it('responde 409 si toma el código de otro banco', async () => {
      const {
        banco: { id },
      } = await servicio.crear({ nombre: 'Banco de Pereira', codigo: 'BAP' });
      await servicio.crear({ nombre: 'Banco de Manizales', codigo: 'BAM' });

      await expect(servicio.editar(id, { codigo: 'BAM' })).rejects.toThrow(ConflictException);
    });

    it('responde 404 si no existe', async () => {
      await expect(servicio.editar('nada', { nombre: 'X' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('desactivar y reactivar', () => {
    it('desactiva y reactiva sin borrar', async () => {
      const {
        banco: { id },
      } = await servicio.crear({ nombre: 'Banco de Pereira', codigo: 'BAP' });

      expect((await servicio.desactivar(id)).activo).toBe(false);
      expect((await servicio.reactivar(id)).activo).toBe(true);
      expect(repositorio.bancos).toHaveLength(1);
    });

    it('responde 404 si no existe', async () => {
      await expect(servicio.desactivar('nada')).rejects.toThrow(NotFoundException);
      await expect(servicio.reactivar('nada')).rejects.toThrow(NotFoundException);
    });
  });
});

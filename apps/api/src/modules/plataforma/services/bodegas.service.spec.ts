import { NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { type Bodega, BodegasRepositorio } from './bodega.js';
import { BodegasService } from './bodegas.service.js';

class BodegasEnMemoria extends BodegasRepositorio {
  constructor(private readonly activas: Bodega[]) {
    super();
  }

  async activa(id: string): Promise<Bodega | null> {
    return this.activas.find((b) => b.id === id) ?? null;
  }
}

describe('BodegasService', () => {
  const santaIsabel = { id: 'bodega-1', nombre: 'Santa Isabel' };
  const servicio = new BodegasService(new BodegasEnMemoria([santaIsabel]));

  it('devuelve la bodega activa del banco', async () => {
    await expect(servicio.obtenerActiva('bodega-1')).resolves.toEqual(santaIsabel);
  });

  it('responde 404 si la bodega no existe, es de otro banco o está desactivada', async () => {
    await expect(servicio.obtenerActiva('bodega-2')).rejects.toThrow(NotFoundException);
  });
});

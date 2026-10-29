import { NotFoundException } from '@nestjs/common';
import type { BodegaLectura } from '@sigba/shared-types';
import { describe, expect, it } from 'vitest';
import { type Bodega, BodegasRepositorio } from './bodega.js';
import { BodegasService } from './bodegas.service.js';

/** Las bodegas del banco del contexto; RLS ya dejó fuera las de otros bancos. */
class BodegasEnMemoria extends BodegasRepositorio {
  constructor(private readonly bodegas: BodegaLectura[]) {
    super();
  }

  async activa(id: string): Promise<Bodega | null> {
    const bodega = this.bodegas.find((b) => b.id === id && b.activa);
    return bodega ? { id: bodega.id, nombre: bodega.nombre } : null;
  }

  async activas(): Promise<BodegaLectura[]> {
    return this.bodegas
      .filter((b) => b.activa)
      .sort((a, b) => a.nombre.localeCompare(b.nombre) || a.id.localeCompare(b.id));
  }

  async porId(id: string): Promise<BodegaLectura | null> {
    return this.bodegas.find((b) => b.id === id) ?? null;
  }
}

describe('BodegasService', () => {
  const santaIsabel = { id: 'bodega-1', nombre: 'Santa Isabel', direccion: null, activa: true };
  const cuba = { id: 'bodega-2', nombre: 'Cuba', direccion: 'Cra 10', activa: false };
  const centro = { id: 'bodega-3', nombre: 'Centro', direccion: null, activa: true };
  const servicio = new BodegasService(new BodegasEnMemoria([santaIsabel, cuba, centro]));

  it('devuelve la bodega activa del banco', async () => {
    await expect(servicio.obtenerActiva('bodega-1')).resolves.toEqual({
      id: 'bodega-1',
      nombre: 'Santa Isabel',
    });
  });

  it('responde 404 si la bodega no existe, es de otro banco o está desactivada', async () => {
    await expect(servicio.obtenerActiva('bodega-2')).rejects.toThrow(NotFoundException);
    await expect(servicio.obtenerActiva('bodega-9')).rejects.toThrow(NotFoundException);
  });

  it('lista solo las activas, por nombre', async () => {
    await expect(servicio.listarActivas()).resolves.toEqual([centro, santaIsabel]);
  });

  it('obtiene por id también la inactiva, con activa en false', async () => {
    await expect(servicio.obtenerPorId('bodega-2')).resolves.toEqual(cuba);
  });

  it('devuelve null por id si no existe o es de otro banco', async () => {
    await expect(servicio.obtenerPorId('bodega-9')).resolves.toBeNull();
  });
});

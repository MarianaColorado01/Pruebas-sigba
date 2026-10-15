import { Injectable, NotFoundException } from '@nestjs/common';
import { type Bodega, BodegasRepositorio } from './bodega.js';

/**
 * Lectura de bodegas para M1 y M2 (SBA-34). Por ahora solo lo que la recepción
 * necesita: confirmar que una bodega existe, es del banco y está activa.
 */
@Injectable()
export class BodegasService {
  constructor(private readonly repositorio: BodegasRepositorio) {}

  async obtenerActiva(id: string): Promise<Bodega> {
    const bodega = await this.repositorio.activa(id);
    if (!bodega) throw new NotFoundException('No existe esa bodega o está desactivada.');
    return bodega;
  }
}

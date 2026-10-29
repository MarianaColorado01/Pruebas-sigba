import { Injectable, NotFoundException } from '@nestjs/common';
import type { BodegaLectura } from '@sigba/shared-types';
import { type Bodega, BodegasRepositorio } from './bodega.js';

/**
 * Lectura de bodegas del banco del contexto para M1 y M2 (SBA-34). Solo lee:
 * la administración va por `AdministracionDeBodegasService`. Contrato en
 * docs/arquitectura/contratos/plataforma-lectura.md.
 */
@Injectable()
export class BodegasService {
  constructor(private readonly repositorio: BodegasRepositorio) {}

  /** Confirma que la bodega existe, es del banco y está activa; si no, 404. */
  async obtenerActiva(id: string): Promise<Bodega> {
    const bodega = await this.repositorio.activa(id);
    if (!bodega) throw new NotFoundException('No existe esa bodega o está desactivada.');
    return bodega;
  }

  listarActivas(): Promise<BodegaLectura[]> {
    return this.repositorio.activas();
  }

  /** También la inactiva, para mostrar movimientos viejos; `null` si no es del banco. */
  obtenerPorId(id: string): Promise<BodegaLectura | null> {
    return this.repositorio.porId(id);
  }
}

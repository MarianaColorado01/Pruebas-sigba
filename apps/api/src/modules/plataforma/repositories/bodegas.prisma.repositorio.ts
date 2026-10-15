import { Injectable } from '@nestjs/common';
import {
  executeTransactionWithTenant,
  getTenantContext,
  PrismaService,
} from '../../../core/index.js';
import { type Bodega, BodegasRepositorio } from '../services/bodega.js';

/**
 * Adaptador de Prisma para las bodegas. RLS ya deja fuera las de otro banco; el
 * filtro por `banco_id` lo repite por si la conexión se salta RLS.
 */
@Injectable()
export class BodegasPrismaRepositorio extends BodegasRepositorio {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async activa(id: string): Promise<Bodega | null> {
    const bancoId = getTenantContext()?.bancoId;
    if (!bancoId) throw new Error('Consulta de bodegas sin banco en el contexto de tenant.');

    return executeTransactionWithTenant<Bodega | null>(this.prisma, (tx) =>
      tx.bodega.findFirst({
        where: { id, bancoId, activa: true },
        select: { id: true, nombre: true },
      }),
    );
  }
}

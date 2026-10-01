import { Injectable } from '@nestjs/common';
import { executeTransactionWithTenant, PrismaService } from '../../../core/index.js';
import { contexto } from './contexto-de-tenant.js';
import {
  type BusquedaDeDonantes,
  type CambiosEnDonante,
  type DatosDeDonante,
  type Donante,
  DonantesRepositorio,
} from '../services/donante.js';

const COLUMNAS = { id: true, nombre: true, tipo: true, contacto: true, activo: true } as const;

/**
 * Adaptador de Prisma para el directorio de donantes. Todo pasa por
 * `executeTransactionWithTenant`: fuera de ella RLS deja cada consulta en cero
 * filas.
 */
@Injectable()
export class DonantesPrismaRepositorio extends DonantesRepositorio {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async crear(datos: DatosDeDonante): Promise<Donante> {
    const { bancoId, actor } = contexto();

    return executeTransactionWithTenant<Donante>(this.prisma, (tx) =>
      tx.donante.create({
        data: { ...datos, bancoId, creadoPor: actor, actualizadoPor: actor },
        select: COLUMNAS,
      }),
    );
  }

  async buscar({ texto, tipo, soloActivos, limite }: BusquedaDeDonantes): Promise<Donante[]> {
    return executeTransactionWithTenant<Donante[]>(this.prisma, (tx) =>
      tx.donante.findMany({
        where: {
          ...(texto && { nombre: { contains: texto, mode: 'insensitive' as const } }),
          ...(tipo && { tipo }),
          ...(soloActivos && { activo: true }),
        },
        orderBy: { nombre: 'asc' },
        take: limite,
        select: COLUMNAS,
      }),
    );
  }

  async actualizar(id: string, cambios: CambiosEnDonante): Promise<Donante | null> {
    const { actor } = contexto();

    return executeTransactionWithTenant<Donante | null>(this.prisma, async (tx) => {
      // updateMany y no update: con RLS, un id de otro banco no es un error
      // sino cero filas.
      const { count } = await tx.donante.updateMany({
        where: { id },
        data: { ...cambios, actualizadoPor: actor },
      });
      if (count === 0) return null;
      return tx.donante.findUniqueOrThrow({ where: { id }, select: COLUMNAS });
    });
  }
}

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService, executeTransactionWithTenant, PrismaService } from '../../../core/index.js';
import { contexto } from './contexto-de-tenant.js';
import {
  type AltaDeDonante,
  type BusquedaDeDonantes,
  type CambiosEnDonante,
  type DatosDeDonante,
  type Donante,
  DonantesRepositorio,
  NombreDeDonanteRepetido,
  type TipoDonante,
} from '../services/donante.js';

const COLUMNAS = { id: true, nombre: true, tipo: true, contacto: true, activo: true } as const;

/** Violación de UNIQUE en PostgreSQL, según Prisma. */
const UNICIDAD_VIOLADA = 'P2002';

function esNombreRepetido(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNICIDAD_VIOLADA;
}

/**
 * Adaptador de Prisma para el directorio de donantes. Todo pasa por
 * `executeTransactionWithTenant`: fuera de ella RLS deja cada consulta en cero
 * filas.
 */
@Injectable()
export class DonantesPrismaRepositorio extends DonantesRepositorio {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditService,
  ) {
    super();
  }

  async crear(datos: DatosDeDonante): Promise<AltaDeDonante> {
    const { bancoId, actor } = contexto();

    try {
      return await executeTransactionWithTenant<AltaDeDonante>(this.prisma, async (tx) => {
        const existente = await activoConNombre(tx, bancoId, datos.nombre, datos.tipo);
        if (existente) return { donante: existente, repetido: true };

        const donante = await tx.donante.create({
          data: { ...datos, bancoId, creadoPor: actor, actualizadoPor: actor },
          select: COLUMNAS,
        });
        await this.auditoria.registrar(tx, {
          accion: 'crear',
          entidad: 'donante',
          entidadId: donante.id,
        });
        return { donante, repetido: false };
      });
    } catch (error) {
      if (!esNombreRepetido(error)) throw error;
      // Otra alta igual confirmó entre la búsqueda y el insert. La transacción
      // abortada no se puede consultar: el donante se lee en otra.
      const existente = await executeTransactionWithTenant<Donante | null>(this.prisma, (tx) =>
        activoConNombre(tx, bancoId, datos.nombre, datos.tipo),
      );
      if (!existente) throw error;
      return { donante: existente, repetido: true };
    }
  }

  async buscar({ id, texto, tipo, soloActivos, limite }: BusquedaDeDonantes): Promise<Donante[]> {
    return executeTransactionWithTenant<Donante[]>(this.prisma, (tx) =>
      tx.donante.findMany({
        where: {
          ...(id && { id }),
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

    try {
      return await executeTransactionWithTenant<Donante | null>(this.prisma, async (tx) => {
        // updateMany y no update: con RLS, un id de otro banco no es un error
        // sino cero filas.
        const { count } = await tx.donante.updateMany({
          where: { id },
          data: { ...cambios, actualizadoPor: actor },
        });
        if (count === 0) return null;
        const donante = await tx.donante.findUniqueOrThrow({ where: { id }, select: COLUMNAS });
        await this.auditoria.registrar(tx, {
          accion: 'actualizar',
          entidad: 'donante',
          entidadId: donante.id,
        });
        return donante;
      });
    } catch (error) {
      if (esNombreRepetido(error)) throw new NombreDeDonanteRepetido();
      throw error;
    }
  }
}

/**
 * El donante activo con ese nombre y tipo, sin distinguir mayúsculas: la llave
 * del índice único parcial.
 *
 * SQL y no `equals` con `mode: 'insensitive'`: Prisma lo traduce a ILIKE,
 * donde `%` y `_` del nombre serían comodines. Esto es lo que indexa la base.
 */
async function activoConNombre(
  tx: Prisma.TransactionClient,
  bancoId: string,
  nombre: string,
  tipo: TipoDonante,
): Promise<Donante | null> {
  const [donante] = await tx.$queryRaw<Donante[]>`
    SELECT id, nombre, tipo::text AS tipo, contacto, activo
    FROM inventario.donante
    WHERE banco_id = ${bancoId}::uuid
      AND tipo = ${tipo}::inventario.tipo_donante
      AND activo
      AND lower(nombre) = lower(${nombre})
    LIMIT 1`;
  return donante ?? null;
}

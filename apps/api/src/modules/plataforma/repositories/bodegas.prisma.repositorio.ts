import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { BodegaLectura } from '@sigba/shared-types';
import {
  AuditService,
  executeTransactionWithTenant,
  getTenantContext,
  PrismaService,
} from '../../../core/index.js';
import {
  type AdministracionDeBodegasRepositorio,
  type Bodega,
  BodegaConStock,
  BodegasRepositorio,
  type CambiosEnBodega,
  type DatosDeBodega,
  type FichaDeBodega,
  NombreDeBodegaRepetido,
} from '../services/bodega.js';

const COLUMNAS = { id: true, nombre: true, direccion: true, activa: true } as const;

/** Violación de UNIQUE en PostgreSQL, según Prisma. */
const UNICIDAD_VIOLADA = 'P2002';

/** El trigger `bodega_sin_desactivar_con_stock` (SBA-76). */
const CON_STOCK = /bodega_con_stock/;

function bancoDelContexto(): string {
  const bancoId = getTenantContext()?.bancoId;
  if (!bancoId) throw new Error('Consulta de bodegas sin banco en el contexto de tenant.');
  return bancoId;
}

/** Banco y usuario de la escritura. Sin cualquiera de los dos no se escribe (RNF-04). */
function contextoDeEscritura(): { bancoId: string; usuarioId: string } {
  const ctx = getTenantContext();
  if (!ctx?.bancoId || !ctx.usuarioId) {
    throw new Error('Escritura de bodega sin banco o sin usuario en el contexto de tenant.');
  }
  return { bancoId: ctx.bancoId, usuarioId: ctx.usuarioId };
}

/**
 * Adaptador de Prisma para las bodegas del banco del contexto: la lectura de
 * otros módulos y la administración. Todo pasa por
 * `executeTransactionWithTenant`: fuera de ella RLS deja cada consulta en cero
 * filas.
 */
@Injectable()
export class BodegasPrismaRepositorio
  extends BodegasRepositorio
  implements AdministracionDeBodegasRepositorio
{
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditService,
  ) {
    super();
  }

  async activa(id: string): Promise<Bodega | null> {
    const bancoId = bancoDelContexto();

    // RLS ya deja fuera las de otro banco; el filtro por `banco_id` lo repite
    // por si la conexión se salta RLS.
    return executeTransactionWithTenant<Bodega | null>(this.prisma, (tx) =>
      tx.bodega.findFirst({
        where: { id, bancoId, activa: true },
        select: { id: true, nombre: true },
      }),
    );
  }

  async activas(): Promise<BodegaLectura[]> {
    const bancoId = bancoDelContexto();

    return executeTransactionWithTenant<BodegaLectura[]>(this.prisma, (tx) =>
      tx.bodega.findMany({
        where: { bancoId, activa: true },
        orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
        select: COLUMNAS,
      }),
    );
  }

  async porId(id: string): Promise<BodegaLectura | null> {
    const bancoId = bancoDelContexto();

    return executeTransactionWithTenant<BodegaLectura | null>(this.prisma, (tx) =>
      tx.bodega.findFirst({ where: { id, bancoId }, select: COLUMNAS }),
    );
  }

  async crear(datos: DatosDeBodega): Promise<FichaDeBodega> {
    const { bancoId, usuarioId } = contextoDeEscritura();

    return traducirErrores(
      () =>
        executeTransactionWithTenant<FichaDeBodega>(this.prisma, async (tx) => {
          const bodega = await tx.bodega.create({
            data: { ...datos, bancoId, creadoPor: usuarioId },
            select: COLUMNAS,
          });
          await this.auditoria.registrar(tx, {
            accion: 'crear',
            entidad: 'bodega',
            entidadId: bodega.id,
          });
          return bodega;
        }),
      // La transacción abortada no se puede consultar: se lee en otra.
      () =>
        executeTransactionWithTenant<FichaDeBodega | null>(this.prisma, (tx) =>
          tx.bodega.findFirst({
            where: { bancoId, nombre: { equals: datos.nombre, mode: 'insensitive' } },
            select: COLUMNAS,
          }),
        ),
    );
  }

  async listar({ soloActivas }: { soloActivas: boolean }): Promise<FichaDeBodega[]> {
    const bancoId = bancoDelContexto();

    return executeTransactionWithTenant<FichaDeBodega[]>(this.prisma, (tx) =>
      tx.bodega.findMany({
        where: soloActivas ? { bancoId, activa: true } : { bancoId },
        orderBy: { nombre: 'asc' },
        select: COLUMNAS,
      }),
    );
  }

  async actualizar(id: string, cambios: CambiosEnBodega): Promise<FichaDeBodega | null> {
    contextoDeEscritura();

    return traducirErrores(() =>
      executeTransactionWithTenant<FichaDeBodega | null>(this.prisma, async (tx) => {
        // updateMany y no update: con RLS, un id de otro banco no es un error
        // sino cero filas.
        const { count } = await tx.bodega.updateMany({ where: { id }, data: cambios });
        if (count === 0) return null;
        await this.auditoria.registrar(tx, {
          accion: 'actualizar',
          entidad: 'bodega',
          entidadId: id,
          detalle: { camposModificados: Object.keys(cambios) },
        });
        return tx.bodega.findUniqueOrThrow({ where: { id }, select: COLUMNAS });
      }),
    );
  }
}

async function traducirErrores<R>(
  operacion: () => Promise<R>,
  buscarExistente?: () => Promise<FichaDeBodega | null>,
): Promise<R> {
  try {
    return await operacion();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNICIDAD_VIOLADA) {
      throw new NombreDeBodegaRepetido(buscarExistente ? await buscarExistente() : null);
    }
    if (error instanceof Error && CON_STOCK.test(error.message)) throw new BodegaConStock();
    throw error;
  }
}

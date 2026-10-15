import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AuditService,
  executeTransactionWithTenant,
  IdempotenciaService,
  PrismaService,
} from '../../../core/index.js';
import { contexto } from './contexto-de-tenant.js';
import { escribirEnLibro } from './libro.js';
import {
  type CargaDeRecepcion,
  type DatosDeRecepcion,
  type Recepcion,
  type RecepcionRegistrada,
  RecepcionesRepositorio,
} from '../services/recepcion.js';

const COLUMNAS = {
  id: true,
  donanteId: true,
  origen: true,
  bodegaId: true,
  creadoEn: true,
  detalles: {
    orderBy: { orden: 'asc' },
    select: {
      novedad: true,
      valoracion: true,
      movimiento: {
        select: {
          id: true,
          referenciaId: true,
          loteId: true,
          cantidad: true,
          kilos: true,
          lote: { select: { codigo: true, vencimiento: true } },
        },
      },
    },
  },
} satisfies Prisma.RecepcionSelect;

type FilaDeRecepcion = Prisma.RecepcionGetPayload<{ select: typeof COLUMNAS }>;

/**
 * Adaptador de Prisma para la recepción. Reclamo del comando, recepción,
 * lotes, movimientos, detalles y auditoría van en una sola
 * `executeTransactionWithTenant`, con el mismo `tx`: si algo falla no queda
 * nada, ni siquiera la reserva del comando (ADR-08, Arquitectura 6.1).
 */
@Injectable()
export class RecepcionesPrismaRepositorio extends RecepcionesRepositorio {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotencia: IdempotenciaService,
    private readonly auditoria: AuditService,
  ) {
    super();
  }

  async registrar({
    comandoId,
    carga,
    kilos,
    equivalencias,
  }: DatosDeRecepcion): Promise<RecepcionRegistrada> {
    const { bancoId, actor } = contexto();
    if (!actor) throw new Error('Recepción sin actor en el contexto de tenant.');
    const { detalles, ...cabecera } = carga;
    // Los ids se generan antes: la reserva del comando guarda el de la recepción.
    const recepcionId = randomUUID();
    const filas = detalles.map((detalle, i) => ({
      ...detalle,
      kilos: kilos[i] as string,
      equivalenciaKg: equivalencias[i] as string,
      loteId: randomUUID(),
    }));

    try {
      return await executeTransactionWithTenant<RecepcionRegistrada>(this.prisma, async (tx) => {
        const previo = await this.idempotencia.reclamar(tx, {
          comandoId,
          carga,
          resultado: { entidad: 'recepcion', entidadId: recepcionId },
        });
        if (previo) {
          const fila = await tx.recepcion.findUniqueOrThrow({
            where: { id: previo.entidadId },
            select: COLUMNAS,
          });
          return { recepcion: aRecepcion(fila), repetida: true };
        }

        await tx.recepcion.createMany({
          data: [{ id: recepcionId, bancoId, ...cabecera, creadoPor: actor }],
        });
        await tx.lote.createMany({
          data: filas.map((f) => ({
            id: f.loteId,
            bancoId,
            recepcionId,
            referenciaId: f.referenciaId,
            codigo: f.lote,
            vencimiento: f.vencimiento ? new Date(`${f.vencimiento}T00:00:00Z`) : null,
            equivalenciaKg: f.equivalenciaKg,
            creadoPor: actor,
          })),
        });
        await escribirEnLibro(
          tx,
          filas.map((f) => ({
            id: f.movimientoId,
            bancoId,
            comandoId,
            tipo: 'entrada' as const,
            referenciaId: f.referenciaId,
            loteId: f.loteId,
            bodegaId: cabecera.bodegaId,
            cantidad: f.cantidad,
            kilos: f.kilos,
            creadoPor: actor,
          })),
        );
        // Sin valoración: la columna nace pendiente, nunca en cero (ADR-13).
        await tx.recepcionDetalle.createMany({
          data: filas.map((f, orden) => ({
            bancoId,
            recepcionId,
            orden,
            movimientoId: f.movimientoId,
            novedad: f.novedad,
            creadoPor: actor,
            actualizadoPor: actor,
          })),
        });
        await this.auditoria.registrar(tx, {
          accion: 'crear',
          entidad: 'recepcion',
          entidadId: recepcionId,
          detalle: { cantidad: filas.length },
        });
        // RecepcionConfirmada va aquí, con este mismo `tx`, cuando exista el
        // outbox (SBA-30).

        const fila = await tx.recepcion.findUniqueOrThrow({
          where: { id: recepcionId },
          select: COLUMNAS,
        });
        return { recepcion: aRecepcion(fila), repetida: false };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        // La llave del libro es (banco_id, id): solo choca con un movimiento
        // del mismo banco.
        if (error.code === 'P2002') {
          throw new ConflictException('Uno de los movimientos ya está registrado.');
        }
        // Las FK son compuestas con banco_id: un donante o una referencia de
        // otro banco sale igual que uno que no existe.
        if (error.code === 'P2003') {
          throw new NotFoundException(
            'La recepción nombra un donante o una referencia que no existe.',
          );
        }
      }
      throw error;
    }
  }

  async repetida(comandoId: string, carga: CargaDeRecepcion): Promise<RecepcionRegistrada | null> {
    return executeTransactionWithTenant<RecepcionRegistrada | null>(this.prisma, async (tx) => {
      const previo = await this.idempotencia.consultar(tx, {
        comandoId,
        carga,
        entidad: 'recepcion',
      });
      if (!previo) return null;
      const fila = await tx.recepcion.findUniqueOrThrow({
        where: { id: previo.entidadId },
        select: COLUMNAS,
      });
      return { recepcion: aRecepcion(fila), repetida: true };
    });
  }
}

function aRecepcion(fila: FilaDeRecepcion): Recepcion {
  return {
    id: fila.id,
    donanteId: fila.donanteId,
    origen: fila.origen,
    bodegaId: fila.bodegaId,
    registradaEn: fila.creadoEn,
    detalles: fila.detalles.map(({ novedad, valoracion, movimiento }) => ({
      movimientoId: movimiento.id,
      referenciaId: movimiento.referenciaId,
      loteId: movimiento.loteId,
      cantidad: movimiento.cantidad.toString(),
      kilos: movimiento.kilos.toString(),
      lote: movimiento.lote.codigo,
      vencimiento: movimiento.lote.vencimiento?.toISOString().slice(0, 10) ?? null,
      novedad,
      valoracion,
    })),
  };
}

import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { DetalleDeRecepcionConfirmada, RecepcionConfirmadaV1 } from '@sigba/shared-types';
import {
  AuditService,
  executeTransactionWithTenant,
  IdempotenciaService,
  OutboxService,
  PrismaService,
} from '../../../core/index.js';
import { contexto } from './contexto-de-tenant.js';
import { escribirEnLibro } from './libro.js';
import { bloquearReferencias, valorarPendientes } from './valoracion.js';
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
 * lotes, movimientos, detalles, auditoría y evento van en una sola
 * `executeTransactionWithTenant`, con el mismo `tx`: si algo falla no queda
 * nada, ni siquiera la reserva del comando (ADR-08, ADR-09, Arquitectura 6.1).
 */
@Injectable()
export class RecepcionesPrismaRepositorio extends RecepcionesRepositorio {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotencia: IdempotenciaService,
    private readonly auditoria: AuditService,
    private readonly outbox: OutboxService,
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

        // Una aprobación de precio de estas referencias que esté en curso
        // termina antes, y su precio entra en la valoración de abajo.
        await bloquearReferencias(
          tx,
          bancoId,
          filas.map((f) => f.referenciaId),
          'recepcion',
        );

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
        // El detalle nace pendiente y se valora enseguida si la referencia
        // tiene precio aprobado vigente hoy; si no, queda pendiente, nunca en
        // cero (ADR-13).
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
        await valorarPendientes(tx, this.auditoria, { bancoId, actor }, { recepcionId });
        await this.auditoria.registrar(tx, {
          accion: 'crear',
          entidad: 'recepcion',
          entidadId: recepcionId,
          detalle: { cantidad: filas.length },
        });
        // Después de valorar: cada detalle sale con su importe o en null si
        // quedó pendiente. Un reenvío salió arriba y no emite otra vez.
        await this.outbox.emitir(tx, {
          tipo: 'RecepcionConfirmada',
          version: 1,
          payload: {
            recepcionId,
            bodegaId: cabecera.bodegaId,
            donanteId: cabecera.donanteId,
            origen: cabecera.origen,
            detalles: await detallesDelEvento(tx, bancoId, recepcionId),
          },
        } satisfies RecepcionConfirmadaV1);

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

/** Los detalles como los pide el contrato, con la categoría y la valoración ya escrita. */
async function detallesDelEvento(
  tx: Prisma.TransactionClient,
  bancoId: string,
  recepcionId: string,
): Promise<DetalleDeRecepcionConfirmada[]> {
  const filas = await tx.$queryRaw<
    (Omit<DetalleDeRecepcionConfirmada, 'cantidad' | 'kilos'> & {
      cantidad: string;
      kilos: string;
    })[]
  >`
    SELECT m.referencia_id::text AS "referenciaId", p.categoria_id::text AS "categoriaId",
           m.lote_id::text AS "loteId", m.cantidad::text AS cantidad, m.kilos::text AS kilos,
           v.valor_unitario::text AS "valorUnitario", v.importe::text AS importe
    FROM inventario.recepcion_detalle AS d
    JOIN inventario.movimiento AS m ON m.banco_id = d.banco_id AND m.id = d.movimiento_id
    JOIN inventario.referencia AS r ON r.banco_id = m.banco_id AND r.id = m.referencia_id
    JOIN inventario.producto AS p ON p.banco_id = r.banco_id AND p.id = r.producto_id
    LEFT JOIN inventario.valoracion AS v ON v.banco_id = m.banco_id AND v.movimiento_id = m.id
    WHERE d.banco_id = ${bancoId}::uuid AND d.recepcion_id = ${recepcionId}::uuid
    ORDER BY d.orden`;
  return filas.map((f) => ({ ...f, cantidad: Number(f.cantidad), kilos: Number(f.kilos) }));
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

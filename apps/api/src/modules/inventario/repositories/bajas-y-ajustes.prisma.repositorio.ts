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
  BajasYAjustesRepositorio,
  type CargaDeMovimientoManual,
  type DatosDeMovimientoManual,
  type MotivoDeBaja,
  type MovimientoManual,
  type MovimientoManualRegistrado,
  type TipoDeMovimientoManual,
} from '../services/baja-y-ajuste.js';

const COLUMNAS = {
  id: true,
  bodegaId: true,
  referenciaId: true,
  loteId: true,
  cantidad: true,
  kilos: true,
  creadoEn: true,
  baja: { select: { motivo: true } },
  ajuste: { select: { motivo: true } },
} satisfies Prisma.MovimientoSelect;

type FilaDeMovimiento = Prisma.MovimientoGetPayload<{ select: typeof COLUMNAS }>;

/**
 * Adaptador de Prisma para bajas y ajustes. Reclamo del comando, movimiento,
 * motivo y auditoría van en una sola `executeTransactionWithTenant`, con el
 * mismo `tx`: si el libro rechaza el movimiento por falta de saldo no queda
 * nada, ni la reserva del comando (ADR-08, Arquitectura 6.1).
 */
@Injectable()
export class BajasYAjustesPrismaRepositorio extends BajasYAjustesRepositorio {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotencia: IdempotenciaService,
    private readonly auditoria: AuditService,
  ) {
    super();
  }

  async equivalenciaDelLote(loteId: string, referenciaId: string): Promise<string | null> {
    const { bancoId } = contexto();
    return executeTransactionWithTenant<string | null>(this.prisma, async (tx) => {
      const lote = await tx.lote.findUnique({
        where: { bancoId_id_referenciaId: { bancoId, id: loteId, referenciaId } },
        select: { equivalenciaKg: true },
      });
      return lote?.equivalenciaKg.toString() ?? null;
    });
  }

  async registrar({
    tipo,
    comandoId,
    carga,
    kilos,
  }: DatosDeMovimientoManual): Promise<MovimientoManualRegistrado> {
    const { bancoId, actor } = contexto();
    if (!actor) throw new Error(`Movimiento de ${tipo} sin actor en el contexto de tenant.`);
    const { movimientoId, motivo, ...lote } = carga;

    try {
      return await executeTransactionWithTenant<MovimientoManualRegistrado>(
        this.prisma,
        async (tx) => {
          const previo = await this.idempotencia.reclamar(tx, {
            comandoId,
            carga,
            resultado: { entidad: tipo, entidadId: movimientoId },
          });
          if (previo) {
            return { movimiento: await leer(tx, tipo, bancoId, previo.entidadId), repetida: true };
          }

          if (tipo === 'ajuste' && !lote.cantidad.startsWith('-')) {
            const enBodega = await tx.saldo.findUnique({
              where: {
                bancoId_bodegaId_loteId: { bancoId, bodegaId: lote.bodegaId, loteId: lote.loteId },
              },
              select: { loteId: true },
            });
            if (!enBodega) {
              throw new ConflictException(
                'Ese lote nunca estuvo en esa bodega: un ajuste corrige un conteo, no crea existencias.',
              );
            }
          }
          await escribirEnLibro(tx, [
            { id: movimientoId, bancoId, comandoId, tipo, ...lote, kilos, creadoPor: actor },
          ]);
          const motivoDelMovimiento = { bancoId, movimientoId, creadoPor: actor };
          if (tipo === 'baja') {
            await tx.baja.createMany({
              data: [{ ...motivoDelMovimiento, motivo: motivo as MotivoDeBaja }],
            });
          } else {
            await tx.ajuste.createMany({ data: [{ ...motivoDelMovimiento, motivo }] });
          }
          // El motivo libre no va al detalle: la auditoría guarda metadatos, no texto.
          await this.auditoria.registrar(tx, {
            accion: 'crear',
            entidad: tipo,
            entidadId: movimientoId,
          });

          return { movimiento: await leer(tx, tipo, bancoId, movimientoId), repetida: false };
        },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        // La llave del libro es (banco_id, id): solo choca con un movimiento
        // del mismo banco.
        if (error.code === 'P2002') {
          throw new ConflictException('Ese movimiento ya está registrado.');
        }
        // La FK del libro es (banco_id, lote_id, referencia_id): un lote de
        // otro banco o de otra referencia sale igual que uno que no existe.
        if (error.code === 'P2003') {
          throw new NotFoundException('No existe ese lote o no es de esa referencia.');
        }
      }
      throw error;
    }
  }

  async repetido(
    tipo: TipoDeMovimientoManual,
    comandoId: string,
    carga: CargaDeMovimientoManual,
  ): Promise<MovimientoManualRegistrado | null> {
    const { bancoId } = contexto();
    return executeTransactionWithTenant<MovimientoManualRegistrado | null>(
      this.prisma,
      async (tx) => {
        const previo = await this.idempotencia.consultar(tx, { comandoId, carga, entidad: tipo });
        if (!previo) return null;
        return { movimiento: await leer(tx, tipo, bancoId, previo.entidadId), repetida: true };
      },
    );
  }
}

async function leer(
  tx: Prisma.TransactionClient,
  tipo: TipoDeMovimientoManual,
  bancoId: string,
  movimientoId: string,
): Promise<MovimientoManual> {
  const fila = await tx.movimiento.findUniqueOrThrow({
    where: { bancoId_id: { bancoId, id: movimientoId } },
    select: COLUMNAS,
  });
  return aMovimiento(tipo, fila);
}

function aMovimiento(tipo: TipoDeMovimientoManual, fila: FilaDeMovimiento): MovimientoManual {
  const motivo = (tipo === 'baja' ? fila.baja : fila.ajuste)?.motivo;
  if (!motivo) throw new Error(`El movimiento ${fila.id} no tiene el motivo de su ${tipo}.`);
  return {
    movimientoId: fila.id,
    tipo,
    bodegaId: fila.bodegaId,
    referenciaId: fila.referenciaId,
    loteId: fila.loteId,
    cantidad: fila.cantidad.toString(),
    kilos: fila.kilos.toString(),
    motivo,
    registradoEn: fila.creadoEn,
  };
}

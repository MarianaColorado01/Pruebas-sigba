import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { SalidaRegistradaV1 } from '@sigba/shared-types';
import {
  AuditService,
  executeTransactionWithTenant,
  IdempotenciaService,
  OutboxService,
  PrismaService,
} from '../../../core/index.js';
import { InstitucionesService } from '../../beneficiarios/index.js';
import { contexto } from './contexto-de-tenant.js';
import { escribirEnLibro, SaldoInsuficiente } from './libro.js';
import {
  type CargaDeSalida,
  type DatosDeSalida,
  type Faltante,
  type InstitucionParaSalida,
  type LoteParaSalida,
  type Salida,
  SalidaSinStock,
  type SalidaRegistrada,
  SalidasRepositorio,
  type TipoDeDespachador,
} from '../services/salida.js';

interface FilaDeSalida {
  id: string;
  institucion_id: string;
  bodega_id: string;
  despachador: string;
  despachador_tipo: TipoDeDespachador;
  aporte_pct: string | null;
  creado_en: Date;
}

interface FilaDeDetalle {
  movimiento_id: string;
  referencia_id: string;
  categoria_id: string;
  lote_id: string;
  cantidad: string;
  kilos: string;
  valor_unitario: string | null;
  fuente: string | null;
  valor_comercial: string | null;
  aporte: string | null;
}

/**
 * Adaptador de Prisma para la salida. Reclamo del comando, salida,
 * movimientos, detalles, valoración, auditoría y evento van en una sola
 * `executeTransactionWithTenant`, con el mismo `tx`: si algo falla no queda
 * nada, ni la reserva del comando ni el evento (ADR-08, ADR-09).
 */
@Injectable()
export class SalidasPrismaRepositorio extends SalidasRepositorio {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotencia: IdempotenciaService,
    private readonly auditoria: AuditService,
    private readonly outbox: OutboxService,
    private readonly instituciones: InstitucionesService,
  ) {
    super();
  }

  async institucionesActivas(): Promise<InstitucionParaSalida[]> {
    return executeTransactionWithTenant<InstitucionParaSalida[]>(this.prisma, async (tx) =>
      (await this.instituciones.listarActivas(tx)).map(({ id, nombre }) => ({ id, nombre })),
    );
  }

  async lotes(ids: string[]): Promise<LoteParaSalida[]> {
    const { bancoId } = contexto();
    return executeTransactionWithTenant<LoteParaSalida[]>(this.prisma, async (tx) => {
      const filas = await tx.lote.findMany({
        where: { bancoId, id: { in: ids } },
        select: { id: true, referenciaId: true, equivalenciaKg: true, vencimiento: true },
      });
      return filas.map((l) => ({
        loteId: l.id,
        referenciaId: l.referenciaId,
        equivalenciaKg: l.equivalenciaKg.toString(),
        vencimiento: l.vencimiento?.toISOString().slice(0, 10) ?? null,
      }));
    });
  }

  async registrar({
    comandoId,
    carga,
    despachador,
    kilos,
    aportePct,
    hoy,
  }: DatosDeSalida): Promise<SalidaRegistrada> {
    const { bancoId, actor } = contexto();
    if (!actor) throw new Error('Salida sin actor en el contexto de tenant.');
    // El id se genera antes: la reserva del comando lo guarda.
    const salidaId = randomUUID();
    const { detalles, ...cabecera } = carga;

    try {
      return await executeTransactionWithTenant<SalidaRegistrada>(this.prisma, async (tx) => {
        const previo = await this.idempotencia.reclamar(tx, {
          comandoId,
          carga,
          resultado: { entidad: 'salida', entidadId: salidaId },
        });
        if (previo) return { salida: await leer(tx, bancoId, previo.entidadId), repetida: true };

        // Después del reclamo y con el mismo tx: un reenvío ya procesado
        // devuelve su salida aunque desactivaran la institución después.
        const institucion = await this.instituciones.obtener(tx, cabecera.institucionId);
        if (!institucion?.activa) {
          throw new NotFoundException('No existe esa institución o está inactiva.');
        }

        await tx.salida.createMany({
          data: [
            {
              id: salidaId,
              bancoId,
              institucionId: cabecera.institucionId,
              bodegaId: cabecera.bodegaId,
              despachador,
              despachadorTipo: cabecera.despachadorTipo,
              aportePct,
              creadoPor: actor,
            },
          ],
        });
        await escribirEnLibro(
          tx,
          detalles.map((d, i) => ({
            id: d.movimientoId,
            bancoId,
            comandoId,
            tipo: 'salida' as const,
            referenciaId: d.referenciaId,
            loteId: d.loteId,
            bodegaId: cabecera.bodegaId,
            cantidad: `-${d.cantidad}`,
            kilos: `-${kilos[i] as string}`,
            creadoPor: actor,
          })),
        );
        await tx.salidaDetalle.createMany({
          data: detalles.map((d, orden) => ({
            bancoId,
            salidaId,
            orden,
            movimientoId: d.movimientoId,
            creadoPor: actor,
          })),
        });
        await this.valorar(
          tx,
          { bancoId, actor },
          detalles.map((d) => d.movimientoId),
          hoy,
        );
        await this.auditoria.registrar(tx, {
          accion: 'crear',
          entidad: 'salida',
          entidadId: salidaId,
          detalle: { cantidad: detalles.length },
        });
        const salida = await leer(tx, bancoId, salidaId);
        // Sin el nombre del despachador: no sale del módulo (Arquitectura 8.6).
        // Por línea, lo mismo que RecepcionConfirmada (SBA-74): nulos si la
        // valoración o el aporte quedaron pendientes.
        await this.outbox.emitir(tx, {
          tipo: 'SalidaRegistrada',
          version: 1,
          payload: {
            salidaId,
            institucionId: cabecera.institucionId,
            bodegaId: cabecera.bodegaId,
            despachadorTipo: cabecera.despachadorTipo,
            detalles: salida.detalles.map((d) => ({
              referenciaId: d.referenciaId,
              categoriaId: d.categoriaId,
              loteId: d.loteId,
              cantidad: Number(d.cantidad),
              kilos: Number(d.kilos),
              valorUnitario: d.valorUnitario,
              importe: d.valorComercial,
              aporte: d.aporte,
            })),
          },
        } satisfies SalidaRegistradaV1);

        return { salida, repetida: false };
      });
    } catch (error) {
      // El libro lo rechazó con el bloqueo y el CHECK del saldo, y la
      // transacción ya revirtió. Se lee aparte qué lotes no alcanzan, para que
      // el 409 diga qué falta (RF-M1-11).
      if (error instanceof SaldoInsuficiente) {
        throw new SalidaSinStock(await this.faltantes(bancoId, carga));
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        // La llave del libro es (banco_id, id): solo choca con un movimiento
        // del mismo banco.
        if (error.code === 'P2002') {
          throw new ConflictException('Uno de los movimientos ya está registrado.');
        }
        // La FK del libro es (banco_id, lote_id, referencia_id).
        if (error.code === 'P2003') {
          throw new NotFoundException('No existe ese lote o no es de esa referencia.');
        }
      }
      throw error;
    }
  }

  async repetida(comandoId: string, carga: CargaDeSalida): Promise<SalidaRegistrada | null> {
    const { bancoId } = contexto();
    return executeTransactionWithTenant<SalidaRegistrada | null>(this.prisma, async (tx) => {
      const previo = await this.idempotencia.consultar(tx, {
        comandoId,
        carga,
        entidad: 'salida',
      });
      if (!previo) return null;
      return { salida: await leer(tx, bancoId, previo.entidadId), repetida: true };
    });
  }

  /**
   * Los lotes de la carga cuyo saldo en la bodega no alcanza. Es una lectura
   * después del rechazo: otra salida pudo cambiar el saldo entre tanto, así
   * que informa, no decide. Quien decide es el CHECK del saldo.
   */
  private faltantes(bancoId: string, { bodegaId, detalles }: CargaDeSalida): Promise<Faltante[]> {
    const pedidos = Prisma.join(
      detalles.map(
        (d) => Prisma.sql`(${d.loteId}::uuid, ${d.referenciaId}::uuid, ${d.cantidad}::numeric)`,
      ),
    );
    return executeTransactionWithTenant<Faltante[]>(
      this.prisma,
      (tx) => tx.$queryRaw<Faltante[]>`
        SELECT p.lote_id::text AS "loteId", p.referencia_id::text AS "referenciaId",
               trim_scale(p.cantidad)::text AS "solicitado",
               trim_scale(coalesce(s.cantidad, 0))::text AS "disponible"
        FROM (VALUES ${pedidos}) AS p (lote_id, referencia_id, cantidad)
        LEFT JOIN inventario.saldo AS s
          ON s.banco_id = ${bancoId}::uuid AND s.bodega_id = ${bodegaId}::uuid
         AND s.lote_id = p.lote_id
        WHERE coalesce(s.cantidad, 0) < p.cantidad`,
    );
  }

  /**
   * Valor comercial con el precio aprobado vigente hoy (SBA-40, ADR-13). La
   * exclusión de la tabla precio deja a lo sumo uno por referencia y día. Sin
   * él no se escribe fila y el detalle queda pendiente: ni cero ni un precio
   * vencido.
   */
  private async valorar(
    tx: Prisma.TransactionClient,
    { bancoId, actor }: { bancoId: string; actor: string },
    movimientoIds: string[],
    hoy: string,
  ): Promise<void> {
    const valoraciones = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO inventario.valoracion
        (banco_id, movimiento_id, precio_id, valor_unitario, importe, creado_por)
      SELECT m.banco_id, m.id, p.id, p.valor, -m.cantidad * p.valor, ${actor}
      FROM inventario.movimiento AS m
      JOIN inventario.precio AS p
        ON p.banco_id = m.banco_id AND p.referencia_id = m.referencia_id
      WHERE m.banco_id = ${bancoId}::uuid
        AND m.id = ANY(${movimientoIds}::uuid[])
        AND p.estado = 'aprobado'
        AND ${hoy}::date BETWEEN p.vigente_desde AND coalesce(p.vigente_hasta, 'infinity')
      RETURNING id::text`;
    for (const { id } of valoraciones) {
      await this.auditoria.registrar(tx, { accion: 'crear', entidad: 'valoracion', entidadId: id });
    }
  }
}

async function leer(tx: Prisma.TransactionClient, bancoId: string, id: string): Promise<Salida> {
  const [salida] = await tx.$queryRaw<FilaDeSalida[]>`
    SELECT id::text, institucion_id::text, bodega_id::text, despachador,
           despachador_tipo::text, trim_scale(aporte_pct)::text AS aporte_pct, creado_en
    FROM inventario.salida
    WHERE banco_id = ${bancoId}::uuid AND id = ${id}::uuid`;
  if (!salida) throw new Error(`La salida ${id} no está en el banco del contexto.`);
  // En positivo: el libro resta, pero el comprobante dice cuánto se entregó.
  const detalles = await tx.$queryRaw<FilaDeDetalle[]>`
    SELECT m.id::text AS movimiento_id, m.referencia_id::text, pr.categoria_id::text,
           m.lote_id::text,
           trim_scale(-m.cantidad)::text AS cantidad, trim_scale(-m.kilos)::text AS kilos,
           trim_scale(v.valor_unitario)::text AS valor_unitario, p.fuente::text AS fuente,
           trim_scale(v.importe)::text AS valor_comercial,
           trim_scale(v.importe * ${salida.aporte_pct}::numeric / 100)::text AS aporte
    FROM inventario.salida_detalle AS d
    JOIN inventario.movimiento AS m ON m.banco_id = d.banco_id AND m.id = d.movimiento_id
    JOIN inventario.referencia AS r ON r.banco_id = m.banco_id AND r.id = m.referencia_id
    JOIN inventario.producto AS pr ON pr.banco_id = r.banco_id AND pr.id = r.producto_id
    LEFT JOIN inventario.valoracion AS v ON v.banco_id = m.banco_id AND v.movimiento_id = m.id
    LEFT JOIN inventario.precio AS p ON p.banco_id = v.banco_id AND p.id = v.precio_id
    WHERE d.banco_id = ${bancoId}::uuid AND d.salida_id = ${id}::uuid
    ORDER BY d.orden`;

  return {
    id: salida.id,
    institucionId: salida.institucion_id,
    bodegaId: salida.bodega_id,
    despachador: salida.despachador,
    despachadorTipo: salida.despachador_tipo,
    aportePct: salida.aporte_pct,
    registradaEn: salida.creado_en,
    detalles: detalles.map((d) => ({
      movimientoId: d.movimiento_id,
      referenciaId: d.referencia_id,
      categoriaId: d.categoria_id,
      loteId: d.lote_id,
      cantidad: d.cantidad,
      kilos: d.kilos,
      valoracion: d.valor_comercial === null ? 'pendiente' : 'con_precio',
      valorUnitario: d.valor_unitario,
      fuente: d.fuente,
      valorComercial: d.valor_comercial,
      aporte: d.aporte,
    })),
  };
}

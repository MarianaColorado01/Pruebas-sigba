import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { ClaveParametro, ValorParametro } from '@sigba/shared-types';
import {
  AuditService,
  executeTransactionWithTenant,
  getTenantContext,
  PrismaService,
} from '../../../core/index.js';
import {
  ConflictoDeVigencia,
  type ParametroVersion,
  ParametrosRepositorio,
} from '../services/parametros.repositorio.js';

function fechaDb(fecha: string): Date {
  return new Date(`${fecha}T00:00:00.000Z`);
}

function fechaTexto(fecha: Date | null): string | null {
  return fecha?.toISOString().slice(0, 10) ?? null;
}

function desdePrisma<K extends ClaveParametro>(fila: {
  id: string;
  clave: string;
  valor: Prisma.JsonValue;
  version: number;
  fechaInicio: Date;
  fechaFin: Date | null;
}): ParametroVersion<K> {
  return {
    id: fila.id,
    clave: fila.clave as K,
    valor: fila.valor as ValorParametro[K],
    version: fila.version,
    fechaInicio: fechaTexto(fila.fechaInicio) as string,
    fechaFin: fechaTexto(fila.fechaFin),
  };
}

function restarUnDia(fecha: string): Date {
  const anterior = fechaDb(fecha);
  anterior.setUTCDate(anterior.getUTCDate() - 1);
  return anterior;
}

@Injectable()
export class ParametrosPrismaRepositorio extends ParametrosRepositorio {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditService,
  ) {
    super();
  }

  async obtenerVigente<K extends ClaveParametro>(
    clave: K,
    fecha: string,
  ): Promise<ParametroVersion<K> | null> {
    const fila = await executeTransactionWithTenant<Prisma.ParametroBancoGetPayload<object> | null>(
      this.prisma,
      (tx) =>
        tx.parametroBanco.findFirst({
          where: {
            clave,
            fechaInicio: { lte: fechaDb(fecha) },
            OR: [{ fechaFin: null }, { fechaFin: { gte: fechaDb(fecha) } }],
          },
          orderBy: { version: 'desc' },
        }),
    );
    return fila ? desdePrisma<K>(fila) : null;
  }

  async listarVigentes(fecha: string): Promise<ParametroVersion[]> {
    const filas = await executeTransactionWithTenant<Prisma.ParametroBancoGetPayload<object>[]>(
      this.prisma,
      (tx) =>
        tx.parametroBanco.findMany({
          where: {
            fechaInicio: { lte: fechaDb(fecha) },
            OR: [{ fechaFin: null }, { fechaFin: { gte: fechaDb(fecha) } }],
          },
          orderBy: [{ clave: 'asc' }, { version: 'desc' }],
        }),
    );
    return filas.map((fila) => desdePrisma(fila));
  }

  async historial(clave: ClaveParametro): Promise<ParametroVersion[]> {
    const filas = await executeTransactionWithTenant<Prisma.ParametroBancoGetPayload<object>[]>(
      this.prisma,
      (tx) =>
        tx.parametroBanco.findMany({
          where: { clave },
          orderBy: { version: 'asc' },
        }),
    );
    return filas.map((fila) => desdePrisma(fila));
  }

  async actualizar<K extends ClaveParametro>(
    clave: K,
    valor: ValorParametro[K],
    fechaInicio: string,
  ): Promise<ParametroVersion<K>> {
    const contexto = getTenantContext();
    if (!contexto?.bancoId) {
      throw new Error('Falta el contexto de banco para actualizar parámetros.');
    }
    const bancoId = contexto.bancoId;

    return executeTransactionWithTenant<ParametroVersion<K>>(this.prisma, async (tx) => {
      // El advisory lock por banco y clave cubre la primera versión, que aún no tiene fila para bloquear.
      await tx.$queryRaw<{ lock_result: string }[]>`
        SELECT pg_advisory_xact_lock(hashtextextended(${`${bancoId}:${clave}`}, 0))::text
          AS lock_result
      `;

      const anterior = await tx.parametroBanco.findFirst({
        where: { clave },
        orderBy: { version: 'desc' },
      });
      if (anterior && fechaInicio <= fechaTexto(anterior.fechaInicio)!) {
        throw new ConflictoDeVigencia();
      }

      const version = (anterior?.version ?? 0) + 1;
      const finalidad =
        `clave=${clave};version_anterior=${anterior?.version ?? 0};` +
        `version_nueva=${version};fecha_inicio=${fechaInicio}`;

      if (anterior) {
        const fechaFin = restarUnDia(fechaInicio);
        const cierre = await tx.parametroBanco.updateMany({
          where: { id: anterior.id, fechaFin: null },
          data: { fechaFin },
        });
        if (cierre.count !== 1) throw new ConflictoDeVigencia();
        await this.auditoria.registrar(tx, {
          accion: 'actualizar',
          entidad: 'plataforma.parametro_banco',
          entidadId: anterior.id,
          finalidad,
          detalle: { version: anterior.version, camposModificados: ['fecha_fin'] },
        });
      }

      const nueva = await tx.parametroBanco.create({
        data: {
          bancoId,
          clave,
          valor: valor as Prisma.InputJsonValue,
          version,
          fechaInicio: fechaDb(fechaInicio),
          creadoPor: contexto.actor ?? contexto.usuarioId ?? null,
        },
      });
      await this.auditoria.registrar(tx, {
        accion: 'crear',
        entidad: 'plataforma.parametro_banco',
        entidadId: nueva.id,
        finalidad,
        detalle: { version },
      });

      return desdePrisma<K>(nueva);
    });
  }
}

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { executeTransactionWithTenant, PrismaService } from '../../../core/index.js';
import { contexto } from './contexto-de-tenant.js';
import { type FiltroDeStock, type SaldoDeLote, StockRepositorio } from '../services/stock.js';

interface FilaDeSaldo {
  bodega_id: string;
  lote_id: string;
  referencia_id: string;
  codigo: string | null;
  vencimiento: string | null;
  cantidad: string;
  kilos: string;
}

interface FilaDeReferencia {
  id: string;
  presentacion: string;
  producto_id: string;
  producto: string;
  categoria_id: string;
  categoria_codigo: string | null;
  categoria: string;
}

/**
 * Adaptador de Prisma para el stock (SBA-36). Va dentro de
 * `executeTransactionWithTenant`, que fija el banco para RLS, y filtra además
 * por `banco_id` porque en local `DATABASE_URL` suele saltarse RLS.
 *
 * Son dos consultas y no una con todo unido: repetir en cada lote los textos
 * de su referencia y ordenar por ellos triplicaba el tiempo con 50 consultas a
 * la vez (SBA-36, criterio 1). Primero los saldos, después las referencias que
 * aparecen en ellos, y el orden por producto se arma aquí.
 */
@Injectable()
export class StockPrismaRepositorio extends StockRepositorio {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async saldos({ bodegaId, categoriaId, referenciaId }: FiltroDeStock): Promise<SaldoDeLote[]> {
    const { bancoId } = contexto();
    const filtros = [Prisma.sql`s."banco_id" = ${bancoId}::uuid`, Prisma.sql`s."cantidad" > 0`];
    if (bodegaId) filtros.push(Prisma.sql`s."bodega_id" = ${bodegaId}::uuid`);
    if (referenciaId) filtros.push(Prisma.sql`s."referencia_id" = ${referenciaId}::uuid`);
    if (categoriaId) {
      filtros.push(Prisma.sql`s."referencia_id" IN (
        SELECT r."id"
        FROM "inventario"."referencia" r
        JOIN "inventario"."producto" p ON p."banco_id" = r."banco_id" AND p."id" = r."producto_id"
        WHERE r."banco_id" = ${bancoId}::uuid AND p."categoria_id" = ${categoriaId}::uuid
      )`);
    }

    const { saldos, referencias } = await executeTransactionWithTenant<{
      saldos: FilaDeSaldo[];
      referencias: FilaDeReferencia[];
    }>(this.prisma, async (tx) => {
      // to_char y no la fecha: Prisma la entregaría como medianoche UTC. Los
      // decimales salen como texto («10» y no «10.000»): un Decimal por fila
      // también pesaba en la medición. Termina en el id del lote para que el
      // orden no cambie entre consultas.
      const saldos = await tx.$queryRaw<FilaDeSaldo[]>(Prisma.sql`
        SELECT s."bodega_id", s."lote_id", s."referencia_id", l."codigo",
               to_char(l."vencimiento", 'YYYY-MM-DD') AS "vencimiento",
               trim_scale(s."cantidad")::text AS "cantidad", trim_scale(s."kilos")::text AS "kilos"
        FROM "inventario"."saldo" s
        JOIN "inventario"."lote" l ON l."banco_id" = s."banco_id" AND l."id" = s."lote_id"
        WHERE ${Prisma.join(filtros, ' AND ')}
        ORDER BY s."bodega_id", l."vencimiento" NULLS LAST, l."id"
      `);
      if (saldos.length === 0) return { saldos, referencias: [] };

      // Las de los saldos leídos y no las del banco: un saldo nuevo entre las
      // dos consultas no puede quedar sin su referencia.
      const ids = [...new Set(saldos.map((s) => s.referencia_id))];
      const referencias = await tx.$queryRaw<FilaDeReferencia[]>(Prisma.sql`
        SELECT r."id", r."presentacion", p."id" AS "producto_id", p."nombre" AS "producto",
               c."id" AS "categoria_id", c."codigo" AS "categoria_codigo", c."nombre" AS "categoria"
        FROM "inventario"."referencia" r
        JOIN "inventario"."producto" p ON p."banco_id" = r."banco_id" AND p."id" = r."producto_id"
        JOIN "inventario"."categoria" c ON c."banco_id" = p."banco_id" AND c."id" = p."categoria_id"
        WHERE r."banco_id" = ${bancoId}::uuid AND r."id" = ANY(${ids}::uuid[])
        ORDER BY p."nombre", r."equivalencia_kg", r."presentacion", r."id"
      `);
      return { saldos, referencias };
    });

    const porReferencia = new Map<string, FilaDeSaldo[]>();
    for (const saldo of saldos) {
      const delGrupo = porReferencia.get(saldo.referencia_id) ?? [];
      delGrupo.push(saldo);
      porReferencia.set(saldo.referencia_id, delGrupo);
    }
    return referencias.flatMap((r) => {
      const referencia = {
        id: r.id,
        presentacion: r.presentacion,
        producto: { id: r.producto_id, nombre: r.producto },
        categoria: { id: r.categoria_id, codigo: r.categoria_codigo, nombre: r.categoria },
      };
      return (porReferencia.get(r.id) ?? []).map((s) => ({
        bodegaId: s.bodega_id,
        loteId: s.lote_id,
        codigo: s.codigo,
        vencimiento: s.vencimiento,
        cantidad: s.cantidad,
        kilos: s.kilos,
        referencia,
      }));
    });
  }
}

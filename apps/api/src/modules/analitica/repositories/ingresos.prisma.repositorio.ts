import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TransaccionDeEvento } from '../../../core/index.js';
import {
  type FilaDeIngreso,
  IngresosRepositorio,
  type ValoracionTardia,
} from '../services/ingreso.js';

/**
 * Zona con la que inventario fecha recepciones y precios (`ZONA_DEL_BANCO`).
 * El mes del ingreso es el de Colombia: las 11 p. m. del 31 de octubre en
 * Pereira son octubre aunque en UTC ya sea noviembre.
 */
const ZONA = 'America/Bogota';

/**
 * Escribe `analitica.ingreso` con la transacción del despachador, que ya tiene
 * el banco del evento en `app.banco_id`: RLS rechaza una fila de otro banco.
 */
@Injectable()
export class IngresosPrismaRepositorio extends IngresosRepositorio {
  async registrar(tx: TransaccionDeEvento, bancoId: string, filas: FilaDeIngreso[]): Promise<void> {
    const valores = filas.map(
      (f) => Prisma.sql`(
        ${bancoId}::uuid, ${f.loteId}::uuid, ${f.recepcionId}::uuid,
        date_trunc('month', ${f.ocurridoEn}::timestamptz AT TIME ZONE ${ZONA})::date,
        ${f.donanteId}::uuid, ${f.origen}, ${f.bodegaId}::uuid, ${f.categoriaId}::uuid,
        ${f.referenciaId}::uuid, ${f.cantidad}::numeric, ${f.kilos}::numeric,
        ${f.valorUnitario}::numeric, ${f.importe}::numeric
      )`,
    );
    await tx.$executeRaw`
      INSERT INTO analitica.ingreso (
        banco_id, lote_id, recepcion_id, mes, donante_id, origen, bodega_id,
        categoria_id, referencia_id, cantidad, kilos, valor_unitario, importe
      )
      VALUES ${Prisma.join(valores)}
      ON CONFLICT (banco_id, lote_id) DO NOTHING`;
  }

  async valorar(
    tx: TransaccionDeEvento,
    bancoId: string,
    valoraciones: ValoracionTardia[],
  ): Promise<string[]> {
    if (valoraciones.length === 0) return [];
    const valores = valoraciones.map(
      (v) => Prisma.sql`(${v.loteId}::uuid, ${v.valorUnitario}::numeric, ${v.importe}::numeric)`,
    );
    const faltan = await tx.$queryRaw<{ lote_id: string }[]>`
      WITH v (lote_id, valor_unitario, importe) AS (VALUES ${Prisma.join(valores)}),
      valorados AS (
        UPDATE analitica.ingreso AS i
        SET valor_unitario = v.valor_unitario, importe = v.importe
        FROM v
        WHERE i.banco_id = ${bancoId}::uuid AND i.lote_id = v.lote_id AND i.importe IS NULL
      )
      SELECT v.lote_id::text FROM v
      WHERE NOT EXISTS (
        SELECT 1 FROM analitica.ingreso AS i
        WHERE i.banco_id = ${bancoId}::uuid AND i.lote_id = v.lote_id
      )`;
    return faltan.map((f) => f.lote_id);
  }
}

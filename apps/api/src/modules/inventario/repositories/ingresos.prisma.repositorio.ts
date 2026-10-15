import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { executeTransactionWithTenant, PrismaService } from '../../../core/index.js';
import { contexto } from './contexto-de-tenant.js';
import { type IngresoDeReferencia, IngresosRepositorio } from '../services/ingreso.js';
import { ZONA_DEL_BANCO } from '../services/precios.service.js';

interface FilaDeIngreso {
  referenciaId: string;
  producto: string;
  presentacion: string;
  cantidad: Prisma.Decimal;
  kilos: Prisma.Decimal;
  importeConocido: Prisma.Decimal | null;
  cantidadPendiente: Prisma.Decimal;
}

/**
 * Adaptador de Prisma para los ingresos del mes. Lee el libro por el detalle
 * de recepción y le suma la valoración, si la tiene: cantidad y kilos son los
 * del movimiento, una vez, valorado o no. La consulta filtra además por
 * `banco_id`, porque en local `DATABASE_URL` suele ser superusuario y se salta
 * RLS.
 */
@Injectable()
export class IngresosPrismaRepositorio extends IngresosRepositorio {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async recibidos(desde: string, hasta: string): Promise<IngresoDeReferencia[]> {
    const { bancoId } = contexto();
    const filas = await executeTransactionWithTenant<FilaDeIngreso[]>(
      this.prisma,
      (tx) => tx.$queryRaw<FilaDeIngreso[]>`
        SELECT m.referencia_id::text AS "referenciaId",
               pr.nombre AS producto,
               re.presentacion,
               sum(m.cantidad) AS cantidad,
               sum(m.kilos) AS kilos,
               sum(v.importe) AS "importeConocido",
               coalesce(sum(m.cantidad) FILTER (WHERE v.id IS NULL), 0) AS "cantidadPendiente"
        FROM inventario.recepcion AS r
        JOIN inventario.recepcion_detalle AS d
          ON d.banco_id = r.banco_id AND d.recepcion_id = r.id
        JOIN inventario.movimiento AS m
          ON m.banco_id = d.banco_id AND m.id = d.movimiento_id
        JOIN inventario.referencia AS re
          ON re.banco_id = m.banco_id AND re.id = m.referencia_id
        JOIN inventario.producto AS pr
          ON pr.banco_id = re.banco_id AND pr.id = re.producto_id
        LEFT JOIN inventario.valoracion AS v
          ON v.banco_id = m.banco_id AND v.movimiento_id = m.id
        WHERE r.banco_id = ${bancoId}::uuid
          AND (r.creado_en AT TIME ZONE ${ZONA_DEL_BANCO})::date >= ${desde}::date
          AND (r.creado_en AT TIME ZONE ${ZONA_DEL_BANCO})::date < ${hasta}::date
        GROUP BY m.referencia_id, pr.nombre, re.presentacion
        ORDER BY pr.nombre, re.presentacion`,
    );

    return filas.map(({ cantidad, kilos, importeConocido, cantidadPendiente, ...resto }) => ({
      ...resto,
      cantidad: cantidad.toString(),
      kilos: kilos.toString(),
      importeConocido: importeConocido && importeConocido.toString(),
      cantidadPendiente: cantidadPendiente.toString(),
    }));
  }
}

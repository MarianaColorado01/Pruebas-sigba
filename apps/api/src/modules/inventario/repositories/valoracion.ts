import { Prisma } from '@prisma/client';
import type { AuditService } from '../../../core/index.js';
import { ZONA_DEL_BANCO } from '../services/precios.service.js';

/** De dónde sale la valoración: un precio que se acaba de aprobar o una recepción nueva. */
export type ValoracionDe = { precioId: string } | { recepcionId: string };

/** Una entrada que acaba de quedar valorada; decimales en texto. */
export interface EntradaValorada {
  loteId: string;
  valorUnitario: string;
  importe: string;
}

/**
 * Valora las entradas pendientes con el precio aprobado que regía el día de la
 * recepción, con el día en Colombia (SBA-43, ADR-13). Escribe una fila en
 * `inventario.valoracion` por entrada y pasa su detalle a `con_precio`; el
 * movimiento no se toca (ADR-08). Lo que no tiene precio vigente sigue
 * pendiente: nunca se valora en cero.
 *
 * Corre con el `tx` de quien llama y lo audita en él. Para que una recepción y
 * una aprobación simultáneas de la misma referencia no se pierdan una a la
 * otra, las dos bloquean antes la fila de la referencia (ver
 * `bloquearReferencias`).
 */
export async function valorarPendientes(
  tx: Prisma.TransactionClient,
  auditoria: AuditService,
  { bancoId, actor }: { bancoId: string; actor: string },
  de: ValoracionDe,
): Promise<EntradaValorada[]> {
  const filtro =
    'precioId' in de
      ? Prisma.sql`p.id = ${de.precioId}::uuid`
      : Prisma.sql`r.id = ${de.recepcionId}::uuid AND p.estado = 'aprobado'`;

  const valoraciones = await tx.$queryRaw<({ id: string } & EntradaValorada)[]>`
    WITH nuevas AS (
      INSERT INTO inventario.valoracion
        (banco_id, movimiento_id, precio_id, valor_unitario, importe, creado_por)
      SELECT m.banco_id, m.id, p.id, p.valor, m.cantidad * p.valor, ${actor}
      FROM inventario.precio AS p
      JOIN inventario.movimiento AS m
        ON m.banco_id = p.banco_id AND m.referencia_id = p.referencia_id
      JOIN inventario.recepcion_detalle AS d
        ON d.banco_id = m.banco_id AND d.movimiento_id = m.id
      JOIN inventario.recepcion AS r
        ON r.banco_id = d.banco_id AND r.id = d.recepcion_id
      WHERE ${filtro}
        AND p.banco_id = ${bancoId}::uuid
        AND d.valoracion = 'pendiente'
        AND (r.creado_en AT TIME ZONE ${ZONA_DEL_BANCO})::date
            BETWEEN p.vigente_desde AND coalesce(p.vigente_hasta, 'infinity')
      RETURNING id, movimiento_id, valor_unitario, importe
    ), detalles AS (
      UPDATE inventario.recepcion_detalle AS d
      SET valoracion = 'con_precio',
          actualizado_por = ${actor},
          actualizado_en = now()
      FROM nuevas
      WHERE d.banco_id = ${bancoId}::uuid AND d.movimiento_id = nuevas.movimiento_id
    )
    SELECT n.id::text, m.lote_id::text AS "loteId",
           n.valor_unitario::text AS "valorUnitario", n.importe::text AS importe
    FROM nuevas AS n
    JOIN inventario.movimiento AS m
      ON m.banco_id = ${bancoId}::uuid AND m.id = n.movimiento_id
    ORDER BY m.lote_id`;

  for (const { id } of valoraciones) {
    await auditoria.registrar(tx, { accion: 'crear', entidad: 'valoracion', entidadId: id });
  }
  return valoraciones.map(({ loteId, valorUnitario, importe }) => ({
    loteId,
    valorUnitario,
    importe,
  }));
}

/**
 * Pone en fila a quien aprueba un precio y a quien recibe esa referencia.
 * Cada transacción solo ve lo que la otra ya confirmó: sin este bloqueo, una
 * recepción que llega mientras se aprueba el precio quedaría pendiente para
 * siempre. La recepción toma FOR SHARE (dos recepciones no se estorban) y la
 * aprobación FOR NO KEY UPDATE, que espera a las recepciones en curso y las
 * hace esperar a ella. En orden de id, para que dos recepciones con las mismas
 * referencias no se bloqueen entre sí.
 */
export async function bloquearReferencias(
  tx: Prisma.TransactionClient,
  bancoId: string,
  referenciaIds: string[],
  modo: 'recepcion' | 'aprobacion',
): Promise<void> {
  const ids = [...new Set(referenciaIds)].sort();
  const bloqueo = modo === 'recepcion' ? Prisma.sql`FOR SHARE` : Prisma.sql`FOR NO KEY UPDATE`;
  await tx.$queryRaw`
    SELECT id FROM inventario.referencia
    WHERE banco_id = ${bancoId}::uuid
      AND id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
    ORDER BY id
    ${bloqueo}`;
}

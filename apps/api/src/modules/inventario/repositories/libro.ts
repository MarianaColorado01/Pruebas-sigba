import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/** Los CHECK de `inventario.saldo` que rechazan dejar un lote en negativo. */
const SALDO_NEGATIVO = /saldo_cantidad_no_negativa|saldo_kilos_no_negativos/;

/**
 * Escribe movimientos en el libro con el `tx` de quien llama (SBA-35, ADR-08).
 *
 * El saldo no se toca aquí: el trigger `movimiento_suma_al_saldo` lo actualiza
 * en la misma transacción y bloquea la fila del lote hasta el commit. Si un
 * movimiento deja el lote en negativo, el CHECK del saldo lo rechaza y sale
 * como 409. Dos salidas a la vez sobre el mismo lote se ordenan por ese
 * bloqueo: la segunda ve el saldo que dejó la primera.
 *
 * La transacción queda abortada después del rechazo, así que quien llama no
 * puede seguir escribiendo: el 409 revierte todo lo demás.
 *
 * Los movimientos se escriben ordenados por bodega y lote: dos escrituras que
 * tocan los mismos lotes los bloquean en el mismo orden y una espera a la
 * otra, en vez de bloquearse mutuamente.
 */
export async function escribirEnLibro(
  tx: Prisma.TransactionClient,
  movimientos: Prisma.MovimientoCreateManyInput[],
): Promise<void> {
  // Comparación de texto y no localeCompare: el orden no puede depender del
  // idioma del proceso, o dos instancias de la API bloquearían distinto.
  const clave = (m: Prisma.MovimientoCreateManyInput) => `${m.bodegaId}/${m.loteId}`;
  const ordenados = movimientos.toSorted((a, b) =>
    clave(a) < clave(b) ? -1 : clave(a) > clave(b) ? 1 : 0,
  );
  try {
    await tx.movimiento.createMany({ data: ordenados });
  } catch (error) {
    if (error instanceof Error && SALDO_NEGATIVO.test(error.message)) {
      throw new ConflictException('No hay saldo suficiente en ese lote y bodega.');
    }
    throw error;
  }
}

import type { Prisma } from '@prisma/client';

/**
 * Transacción en la que el consumidor escribe su proyección. Es la misma en la
 * que el despachador guarda el acuse, con el banco del evento en
 * `app.banco_id`: si el consumidor falla, el acuse revierte con él.
 *
 * `events/` y `services/` no importan Prisma (regla 4 de fronteras); con este
 * nombre la pasan hasta su repositorio sin tocarla.
 */
export type TransaccionDeEvento = Prisma.TransactionClient;

/** Un evento del outbox tal como llega a un consumidor. */
export interface EventoEntregado {
  id: string;
  bancoId: string;
  tipo: string;
  version: number;
  payload: Record<string, unknown>;
  ocurridoEn: Date;
}

/**
 * Puerto que implementa cada consumidor de eventos (ADR-09). El módulo lo
 * suscribe con `DespachadorDeEventos.suscribir` al iniciar.
 *
 * El despachador entrega al menos una vez y deduplica por `(evento, nombre)`:
 * un evento repetido no vuelve a llegar a `procesar`. Si `procesar` lanza, el
 * evento se reintenta más tarde solo para este consumidor.
 *
 * No hay orden garantizado: un reintento puede llegar después de un evento
 * posterior del mismo agregado. Un consumidor no puede depender del orden de
 * llegada; si un evento necesita otro anterior que aún no llegó, lanza y espera
 * su reintento.
 */
export interface ConsumidorDeEventos {
  /**
   * Clave del acuse en `core.evento_consumido`. Cambiarla hace que el
   * consumidor reciba como nuevos los eventos que sigan pendientes.
   */
  readonly nombre: string;
  readonly tipos: readonly string[];
  procesar(evento: EventoEntregado, tx: TransaccionDeEvento): Promise<void>;
}

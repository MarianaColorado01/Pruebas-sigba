import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

export interface EventoDeDominio {
  tipo: string;
  version: number;
  payload: Record<string, unknown>;
}

@Injectable()
export class OutboxService {
  /**
   * La transacción pertenece al caso de uso: si este falla, el evento revierte
   * con las escrituras del dominio.
   */
  async emitir(tx: Prisma.TransactionClient, evento: EventoDeDominio): Promise<string> {
    if (!evento.tipo.trim()) throw new Error('El tipo del evento no puede estar vacío.');
    if (!Number.isInteger(evento.version) || evento.version < 1 || evento.version > 32767) {
      throw new Error('La versión del evento debe ser un entero positivo de SMALLINT.');
    }
    if (
      typeof evento.payload !== 'object' ||
      evento.payload === null ||
      Array.isArray(evento.payload)
    ) {
      throw new Error('La carga del evento debe ser un objeto JSON.');
    }

    const payload = JSON.stringify(evento.payload);
    if (typeof payload !== 'string') throw new Error('La carga del evento no se pudo serializar.');

    const [fila] = await tx.$queryRaw<{ id: string }[]>`
      SELECT core.emitir_evento(
        ${evento.tipo}::text,
        ${evento.version}::smallint,
        ${payload}::jsonb
      )::text AS id
    `;
    if (!fila) throw new Error('core.emitir_evento no devolvió el id del evento.');
    return fila.id;
  }
}

import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { executeTransactionWithTenant } from '../database/prisma-rls.extension.js';
import type { ConsumidorDeEventos, EventoEntregado } from './consumidor-de-eventos.js';

/** Eventos por reclamo. Uno a la vez, para no quitarle CPU ni conexiones a la API. */
export const LOTE = 50;
/** Tras este número de intentos fallidos el evento queda en la cola muerta. */
export const TOPE_DE_INTENTOS = 10;
/** Si la réplica muere con el lote en la mano, otra lo retoma después de esto. */
const LEASE_SEGUNDOS = 60;
const PAUSA_MS = 2_000;
const ESPERA_BASE_SEGUNDOS = 5;
const ESPERA_MAXIMA_SEGUNDOS = 600;
const ACTOR = 'sistema:despachador';

type FilaReclamada = {
  id: string;
  banco_id: string;
  tipo: string;
  version: number;
  payload: Record<string, unknown>;
  ocurrido_en: Date;
  /** Con este: el reclamo ya lo contó. */
  intentos: number;
};

/** Retroceso exponencial tras el intento n.º `intento`: 5 s, 10 s, 20 s… hasta 10 min. */
export function esperaTrasFallo(intento: number): number {
  return Math.min(ESPERA_BASE_SEGUNDOS * 2 ** (intento - 1), ESPERA_MAXIMA_SEGUNDOS);
}

/**
 * Entrega los eventos de `core.outbox` a los consumidores en proceso
 * (SBA-49, ADR-09). Al menos una vez, con acuse por consumidor:
 *
 * - Reclama un lote con lease (`core.reclamar_eventos`) y le cuenta un intento
 *   a cada evento. Dos réplicas no toman el mismo evento mientras el lease
 *   esté vigente; si el proceso muere, el lease vence y el intento ya contó.
 * - Cada consumidor recibe el evento en su propia transacción, con el banco del
 *   evento en `app.banco_id`. El acuse (`core.reclamar_entrega`) va en esa
 *   transacción: si el consumidor falla, revierte con él; si ya estaba, no se
 *   procesa otra vez.
 * - Si todos acusaron, el evento queda publicado. Si alguno falló, se reintenta
 *   tras el retroceso, y los que ya acusaron no lo reciben de nuevo.
 *
 * Solo reclama los tipos que algún consumidor escucha: un tipo sin consumidor
 * espera en el outbox hasta que aparezca uno.
 */
@Injectable()
export class DespachadorDeEventos implements OnModuleDestroy {
  private readonly log = new Logger(DespachadorDeEventos.name);
  private readonly consumidores = new Map<string, ConsumidorDeEventos>();
  private temporizador?: NodeJS.Timeout;
  private pasada: Promise<unknown> = Promise.resolve();
  private detenido = true;

  constructor(private readonly prisma: PrismaService) {}

  suscribir(consumidor: ConsumidorDeEventos): void {
    if (this.consumidores.has(consumidor.nombre)) {
      throw new Error(`Ya hay un consumidor de eventos llamado ${consumidor.nombre}.`);
    }
    this.consumidores.set(consumidor.nombre, consumidor);
  }

  /**
   * Arranca el sondeo. Lo llama `main.ts` y nadie más: las pruebas y los
   * comandos de consola levantan la aplicación sin despachar.
   */
  iniciar(): void {
    if (!this.detenido) return;
    this.detenido = false;
    this.programar(0);
  }

  async onModuleDestroy(): Promise<void> {
    this.detenido = true;
    clearTimeout(this.temporizador);
    await this.pasada;
  }

  /** Una pasada: reclama un lote y lo entrega. Devuelve cuántos eventos tomó. */
  async despachar(): Promise<number> {
    const tipos = [...new Set([...this.consumidores.values()].flatMap((c) => c.tipos))];
    if (tipos.length === 0) return 0;

    const filas = await this.prisma.$queryRaw<FilaReclamada[]>`
      SELECT id::text, banco_id::text, tipo, version, payload, ocurrido_en, intentos
      FROM core.reclamar_eventos(
        ${tipos}::text[], ${LOTE}::int, ${TOPE_DE_INTENTOS}::int, ${LEASE_SEGUNDOS}::int
      )
      ORDER BY ocurrido_en, id`;
    for (const fila of filas) await this.entregar(fila);
    return filas.length;
  }

  private programar(ms: number): void {
    this.temporizador = setTimeout(() => {
      this.pasada = this.despachar()
        .catch((error: unknown) => {
          this.log.error(`No se pudo reclamar eventos del outbox: ${mensaje(error)}`);
          return 0;
        })
        .then((tomados) => {
          // Lote lleno: puede haber más esperando, se sigue sin pausa.
          if (!this.detenido) this.programar(tomados === LOTE ? 0 : PAUSA_MS);
        });
    }, ms);
    // Un comando de consola que cierre la aplicación no se queda esperando.
    this.temporizador.unref();
  }

  private async entregar(fila: FilaReclamada): Promise<void> {
    const evento: EventoEntregado = {
      id: fila.id,
      bancoId: fila.banco_id,
      tipo: fila.tipo,
      version: fila.version,
      payload: fila.payload,
      ocurridoEn: fila.ocurrido_en,
    };
    const contexto = { bancoId: evento.bancoId, actor: ACTOR };
    let fallo = false;

    for (const consumidor of this.consumidores.values()) {
      if (!consumidor.tipos.includes(evento.tipo)) continue;
      try {
        await executeTransactionWithTenant(
          this.prisma,
          async (tx) => {
            const [acuse] = await tx.$queryRaw<{ nuevo: boolean }[]>`
              SELECT core.reclamar_entrega(${evento.id}::uuid, ${consumidor.nombre}) AS nuevo`;
            if (acuse?.nuevo) await consumidor.procesar(evento, tx);
          },
          contexto,
        );
      } catch (error) {
        fallo = true;
        // La carga no va al log: solo identificadores (Arquitectura 8.6).
        this.log.error(
          `${consumidor.nombre} falló con el evento ${evento.id} (${evento.tipo}), ` +
            `intento ${fila.intentos} de ${TOPE_DE_INTENTOS}: ${mensaje(error)}`,
        );
      }
    }

    await executeTransactionWithTenant(
      this.prisma,
      (tx) =>
        fallo
          ? tx.$executeRaw`SELECT core.posponer_evento(
              ${evento.id}::uuid, ${esperaTrasFallo(fila.intentos)}::int)`
          : tx.$executeRaw`SELECT core.publicar_evento(${evento.id}::uuid)`,
      contexto,
    );
  }
}

function mensaje(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

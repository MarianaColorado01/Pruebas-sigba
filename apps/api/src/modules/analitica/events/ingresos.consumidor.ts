import { Injectable } from '@nestjs/common';
import type { PrecioActualizadoV1, RecepcionConfirmadaV1 } from '@sigba/shared-types';
import type {
  ConsumidorDeEventos,
  EventoEntregado,
  TransaccionDeEvento,
} from '../../../core/index.js';
import { filasDeRecepcion, IngresosRepositorio } from '../services/ingreso.js';

/**
 * Alimenta `analitica.ingreso` (SBA-50). El despachador ya deduplica: cada
 * evento llega una vez a `procesar`, y si lanza se reintenta más tarde.
 */
@Injectable()
export class IngresosConsumidor implements ConsumidorDeEventos {
  readonly nombre = 'analitica.ingresos';
  readonly tipos = ['RecepcionConfirmada', 'PrecioActualizado'] as const;

  constructor(private readonly repositorio: IngresosRepositorio) {}

  async procesar(evento: EventoEntregado, tx: TransaccionDeEvento): Promise<void> {
    // Una versión que no conoce no se descarta: falla, se reintenta y, si
    // nadie actualiza el consumidor, queda visible en la cola muerta.
    if (evento.version !== 1) {
      throw new Error(`${this.nombre} no conoce ${evento.tipo} v${evento.version}.`);
    }

    if (evento.tipo === 'RecepcionConfirmada') {
      const payload = evento.payload as RecepcionConfirmadaV1['payload'];
      await this.repositorio.registrar(
        tx,
        evento.bancoId,
        filasDeRecepcion(payload, evento.ocurridoEn),
      );
      return;
    }

    const { valoraciones } = evento.payload as PrecioActualizadoV1['payload'];
    const faltan = await this.repositorio.valorar(tx, evento.bancoId, valoraciones);
    // La recepción se confirmó antes que el precio, pero su evento pudo fallar
    // y quedar para después. Se reintenta hasta que llegue, para no perder el
    // valor.
    if (faltan.length > 0) {
      throw new Error(
        `PrecioActualizado ${evento.id} valora ${faltan.length} lote(s) que aún no están en analitica.ingreso.`,
      );
    }
  }
}

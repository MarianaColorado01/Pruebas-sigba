import type { PrecioActualizadoV1, RecepcionConfirmadaV1 } from '@sigba/shared-types';
import type { TransaccionDeEvento } from '../../../core/index.js';

/**
 * Modelo de lectura de ingresos (SBA-50, ADR-09): una fila por lote recibido.
 * Sale de `RecepcionConfirmada` y la completa `PrecioActualizado`; el reporte
 * de ingresos (RF-M3-08) suma estas filas sin leer tablas de inventario.
 */
export interface FilaDeIngreso {
  loteId: string;
  recepcionId: string;
  /** Cuándo se confirmó la recepción; el repositorio saca de aquí el mes en Colombia. */
  ocurridoEn: Date;
  donanteId: string;
  origen: RecepcionConfirmadaV1['payload']['origen'];
  bodegaId: string;
  categoriaId: string;
  referenciaId: string;
  cantidad: number;
  kilos: number;
  /** Los dos en `null`: valoración pendiente, nunca cero (ADR-13). */
  valorUnitario: string | null;
  importe: string | null;
}

export type ValoracionTardia = PrecioActualizadoV1['payload']['valoraciones'][number];

export abstract class IngresosRepositorio {
  /** Inserta las filas; un lote que ya está se deja como estaba. */
  abstract registrar(
    tx: TransaccionDeEvento,
    bancoId: string,
    filas: FilaDeIngreso[],
  ): Promise<void>;

  /**
   * Pone valor a los lotes que sigan pendientes; los que ya lo tienen no
   * cambian. Devuelve los lotes que todavía no están en el modelo.
   */
  abstract valorar(
    tx: TransaccionDeEvento,
    bancoId: string,
    valoraciones: ValoracionTardia[],
  ): Promise<string[]>;
}

/** Las filas de una recepción, con el instante en que ocurrió el evento. */
export function filasDeRecepcion(
  { recepcionId, donanteId, origen, bodegaId, detalles }: RecepcionConfirmadaV1['payload'],
  ocurridoEn: Date,
): FilaDeIngreso[] {
  return detalles.map((detalle) => ({
    ...detalle,
    recepcionId,
    ocurridoEn,
    donanteId,
    origen,
    bodegaId,
  }));
}

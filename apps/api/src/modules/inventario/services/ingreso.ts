/**
 * Ingresos del mes por referencia y el puerto por el que se leen (SBA-43).
 *
 * Es la consulta de inventario para la coordinación, no el reporte de
 * ingresos de M3: ese lo construye el Equipo 3 con los eventos de inventario.
 * El banco no viaja por aquí; lo pone el adaptador desde el contexto de
 * tenant, igual que RLS.
 */

/**
 * Lo recibido de una referencia en el periodo. Decimales como texto, para no
 * perder precisión en el camino. Lo pendiente no suma al importe como cero
 * (ADR-13): `importeConocido` es la suma de lo que ya tiene precio, nulo si
 * nada lo tiene, y `cantidadPendiente` dice cuánto falta por valorar.
 */
export interface IngresoDeReferencia {
  referenciaId: string;
  producto: string;
  presentacion: string;
  /** Todas las unidades recibidas, con precio o sin él. */
  cantidad: string;
  kilos: string;
  /** En pesos. */
  importeConocido: string | null;
  cantidadPendiente: string;
}

export interface IngresosDelMes {
  /** AAAA-MM. */
  mes: string;
  /** Por producto y presentación. */
  referencias: IngresoDeReferencia[];
}

export abstract class IngresosRepositorio {
  /**
   * Las entradas por recepción cuyo día en Colombia cae entre `desde`
   * (incluido) y `hasta` (excluido), sumadas por referencia. Fechas AAAA-MM-DD.
   */
  abstract recibidos(desde: string, hasta: string): Promise<IngresoDeReferencia[]>;
}

/**
 * Consulta de stock por bodega, referencia y lote (SBA-36) y el puerto por el
 * que se lee.
 *
 * Se lee de `inventario.saldo`, el saldo que el libro deriva (SBA-35), y no del
 * libro: sumar movimientos en cada consulta no escala. El banco no viaja por
 * aquí; lo pone el adaptador desde el contexto de tenant, igual que RLS.
 */

/** Lo que la fecha del lote dice por sí sola. */
export type EstadoDelLote = 'vencido' | 'vigente' | 'sin_vencimiento';

/**
 * Prioridad de salida de un lote vigente según los umbrales del banco
 * (SBA-37, RF-M1-08): rojo sale hoy, amarillo esta semana.
 */
export type Semaforo = 'rojo' | 'amarillo' | 'verde';

/** Los parámetros `semaforo_rojo_dias` y `semaforo_amarillo_dias`; nulo si el banco no lo fijó. */
export interface UmbralesDelSemaforo {
  rojo: number | null;
  amarillo: number | null;
}

export interface FiltroDeStock {
  bodegaId?: string;
  categoriaId?: string;
  referenciaId?: string;
}

/** Una fila de `inventario.saldo` con su lote y su referencia. */
export interface SaldoDeLote {
  bodegaId: string;
  loteId: string;
  /** El lote impreso en el empaque, si lo trae. */
  codigo: string | null;
  /** AAAA-MM-DD, o nulo si el producto no trae fecha. */
  vencimiento: string | null;
  /** Decimales como texto, para no perder precisión en el camino. */
  cantidad: string;
  kilos: string;
  referencia: {
    id: string;
    presentacion: string;
    producto: { id: string; nombre: string };
    categoria: { id: string; codigo: string | null; nombre: string };
  };
}

export interface LoteEnStock extends SaldoDeLote {
  estado: EstadoDelLote;
  /** Días de hoy al vencimiento: 0 vence hoy, negativo ya venció. Nulo sin fecha. */
  diasParaVencer: number | null;
  /** Nulo si el lote venció, no trae fecha o el banco no tiene umbrales. */
  semaforo: Semaforo | null;
}

export abstract class StockRepositorio {
  /**
   * Los saldos mayores que cero del banco, ordenados por producto,
   * presentación, bodega y vencimiento, el que vence primero arriba.
   */
  abstract saldos(filtro: FiltroDeStock): Promise<SaldoDeLote[]>;
}

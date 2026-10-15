/**
 * Consulta de stock por bodega, referencia y lote (SBA-36) y el puerto por el
 * que se lee.
 *
 * Se lee de `inventario.saldo`, el saldo que el libro deriva (SBA-35), y no del
 * libro: sumar movimientos en cada consulta no escala. El banco no viaja por
 * aquí; lo pone el adaptador desde el contexto de tenant, igual que RLS.
 */

/**
 * Lo que se sabe del lote con su fecha. El semáforo con umbrales por banco es
 * SBA-37; aquí solo lo que la fecha dice por sí sola.
 */
export type EstadoDelLote = 'vencido' | 'vigente' | 'sin_vencimiento';

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
}

export abstract class StockRepositorio {
  /**
   * Los saldos mayores que cero del banco, ordenados por producto,
   * presentación, bodega y vencimiento, el que vence primero arriba.
   */
  abstract saldos(filtro: FiltroDeStock): Promise<SaldoDeLote[]>;
}

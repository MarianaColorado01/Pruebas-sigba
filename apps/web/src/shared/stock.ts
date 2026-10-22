/** Lo que responde `GET /stock` por cada lote con saldo en una bodega (SBA-36). */
export interface LoteEnStock {
  bodegaId: string;
  loteId: string;
  codigo: string | null;
  /** AAAA-MM-DD, o nulo si el producto no trae fecha. */
  vencimiento: string | null;
  estado: 'vencido' | 'vigente' | 'sin_vencimiento';
  /** Días de hoy al vencimiento: 0 vence hoy, negativo ya venció. Nulo sin fecha. */
  diasParaVencer: number | null;
  /**
   * Prioridad de salida con los umbrales del banco (SBA-37). Nulo si el lote
   * venció, no trae fecha o el banco no fijó umbrales.
   */
  semaforo: 'rojo' | 'amarillo' | 'verde' | null;
  cantidad: string;
  kilos: string;
  referencia: {
    id: string;
    presentacion: string;
    producto: { id: string; nombre: string };
    categoria: { id: string; codigo: string | null; nombre: string };
  };
}

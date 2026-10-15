/** Lo que responde `GET /stock` por cada lote con saldo en una bodega (SBA-36). */
export interface LoteEnStock {
  bodegaId: string;
  loteId: string;
  codigo: string | null;
  /** AAAA-MM-DD, o nulo si el producto no trae fecha. */
  vencimiento: string | null;
  estado: 'vencido' | 'vigente' | 'sin_vencimiento';
  cantidad: string;
  kilos: string;
  referencia: {
    id: string;
    presentacion: string;
    producto: { id: string; nombre: string };
    categoria: { id: string; codigo: string | null; nombre: string };
  };
}

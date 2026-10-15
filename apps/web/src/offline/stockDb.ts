import Dexie, { type Table } from 'dexie';
import type { LoteEnStock } from '@/shared/stock.ts';

/** El último stock que respondió la API, por banco, y cuándo lo recibió el dispositivo. */
export interface StockGuardado {
  bancoId: string;
  lotes: LoteEnStock[];
  /** ISO 8601, con el reloj del dispositivo. */
  obtenidoEn: string;
}

/**
 * Base aparte de `sigba-offline`: dos instancias de Dexie sobre la misma base
 * tendrían que declarar el mismo esquema y la misma versión.
 */
class BaseDeStock extends Dexie {
  stocks!: Table<StockGuardado, string>;

  constructor() {
    super('sigba-stock');
    this.version(1).stores({ stocks: '&bancoId' });
  }
}

const base = new BaseDeStock();

export const stockDb = {
  leer(bancoId: string): Promise<StockGuardado | undefined> {
    return base.stocks.get(bancoId);
  },

  guardar(entrada: StockGuardado): Promise<string> {
    return base.stocks.put(entrada);
  },
};

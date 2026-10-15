import Dexie, { type Table } from 'dexie';
import type { Catalogo } from '@/shared/catalogo.ts';

export interface CatalogoGuardado {
  bancoId: string;
  etag: string;
  catalogo: Catalogo;
}

class BaseLocal extends Dexie {
  catalogos!: Table<CatalogoGuardado, string>;

  constructor() {
    super('sigba-offline');
    this.version(1).stores({ catalogos: '&bancoId' });
  }
}

const base = new BaseLocal();

export const catalogoDb = {
  leer(bancoId: string): Promise<CatalogoGuardado | undefined> {
    return base.catalogos.get(bancoId);
  },

  guardar(entrada: CatalogoGuardado): Promise<string> {
    return base.catalogos.put(entrada);
  },
};

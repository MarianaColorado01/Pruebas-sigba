import { Injectable } from '@nestjs/common';
import {
  type EstadoDelLote,
  type FiltroDeStock,
  type LoteEnStock,
  StockRepositorio,
} from './stock.js';

/** El día de la bodega, no el del servidor: Fly.io corre en UTC. */
const DIA_EN_COLOMBIA = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Bogota',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Stock por bodega, referencia y lote (SBA-36). Lo que hay en cada
 * bodega para que la coordinación sepa qué puede despachar sin bajar a contar.
 * Un lote con saldo cero no aparece: no hay nada que despachar.
 */
@Injectable()
export class StockService {
  constructor(private readonly repositorio: StockRepositorio) {}

  async consultar(filtro: FiltroDeStock = {}): Promise<LoteEnStock[]> {
    const saldos = await this.repositorio.saldos(filtro);
    const hoy = DIA_EN_COLOMBIA.format(new Date());
    return saldos.map((saldo) => ({ ...saldo, estado: estadoDelLote(saldo.vencimiento, hoy) }));
  }
}

/**
 * Vence el día que dice el empaque: ese día todavía se despacha. Las dos
 * fechas son AAAA-MM-DD, así que se comparan como texto.
 */
export function estadoDelLote(vencimiento: string | null, hoy: string): EstadoDelLote {
  if (vencimiento === null) return 'sin_vencimiento';
  return vencimiento < hoy ? 'vencido' : 'vigente';
}

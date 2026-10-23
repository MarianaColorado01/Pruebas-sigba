import { Injectable } from '@nestjs/common';
import { ParametrosLectura } from '../../plataforma/index.js';
import {
  type EstadoDelLote,
  type FiltroDeStock,
  type LoteEnStock,
  type Semaforo,
  StockRepositorio,
  type UmbralesDelSemaforo,
} from './stock.js';

/** El día de la bodega, no el del servidor: Fly.io corre en UTC. */
const DIA_EN_COLOMBIA = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Bogota',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const MS_POR_DIA = 86_400_000;

/**
 * Stock por bodega, referencia y lote (SBA-36). Lo que hay en cada
 * bodega para que la coordinación sepa qué puede despachar sin bajar a contar.
 * Un lote con saldo cero no aparece: no hay nada que despachar.
 *
 * Cada lote vigente lleva su semáforo con los umbrales que el banco tenga
 * vigentes hoy (SBA-37): un cambio de parámetro se ve en la siguiente consulta.
 */
@Injectable()
export class StockService {
  constructor(
    private readonly repositorio: StockRepositorio,
    private readonly parametros: ParametrosLectura,
  ) {}

  async consultar(filtro: FiltroDeStock = {}): Promise<LoteEnStock[]> {
    const hoy = DIA_EN_COLOMBIA.format(new Date());
    // Una sola lectura de parámetros: cada una es una transacción, y con dos
    // el p95 de 50 consultas a la vez pasaba de 1 s en CI (SBA-95).
    const [saldos, vigentes] = await Promise.all([
      this.repositorio.saldos(filtro),
      this.parametros.listarVigentes(hoy),
    ]);
    const umbral = (clave: 'semaforo_rojo_dias' | 'semaforo_amarillo_dias') => {
      const parametro = vigentes.find((p) => p.clave === clave);
      return typeof parametro?.valor === 'number' ? parametro.valor : null;
    };
    const umbrales = {
      rojo: umbral('semaforo_rojo_dias'),
      amarillo: umbral('semaforo_amarillo_dias'),
    };
    return saldos.map((saldo) => {
      const dias = saldo.vencimiento === null ? null : diasEntre(hoy, saldo.vencimiento);
      return {
        ...saldo,
        estado: estadoDelLote(saldo.vencimiento, hoy),
        diasParaVencer: dias,
        semaforo: semaforoDelLote(dias, umbrales),
      };
    });
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

/**
 * Rojo hasta `rojo` días inclusive, amarillo hasta `amarillo`, verde después.
 * Con umbral rojo en 3, el lote que vence en 3 días ya está en rojo. Si el
 * banco fijó solo uno de los dos, se aplica ese; sin ninguno no hay semáforo,
 * porque pintar todo de verde diría que nada urge.
 */
export function semaforoDelLote(
  diasParaVencer: number | null,
  { rojo, amarillo }: UmbralesDelSemaforo,
): Semaforo | null {
  if (diasParaVencer === null || diasParaVencer < 0) return null;
  if (rojo === null && amarillo === null) return null;
  if (rojo !== null && diasParaVencer <= rojo) return 'rojo';
  if (amarillo !== null && diasParaVencer <= amarillo) return 'amarillo';
  return 'verde';
}

function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(hasta) - Date.parse(desde)) / MS_POR_DIA);
}

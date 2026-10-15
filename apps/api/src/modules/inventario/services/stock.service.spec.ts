import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type FiltroDeStock, type SaldoDeLote, StockRepositorio } from './stock.js';
import { estadoDelLote, StockService } from './stock.service.js';

/** Devuelve los saldos que se le den y guarda el filtro con que lo llamaron. */
class StockEnMemoria extends StockRepositorio {
  filas: SaldoDeLote[] = [];
  filtros: FiltroDeStock[] = [];

  async saldos(filtro: FiltroDeStock): Promise<SaldoDeLote[]> {
    this.filtros.push(filtro);
    return this.filas;
  }
}

function saldo(vencimiento: string | null): SaldoDeLote {
  return {
    bodegaId: 'bodega-1',
    loteId: `lote-${vencimiento ?? 'sin-fecha'}`,
    codigo: null,
    vencimiento,
    cantidad: '10',
    kilos: '10',
    referencia: {
      id: 'referencia-1',
      presentacion: '1 kg',
      producto: { id: 'producto-1', nombre: 'Arroz' },
      categoria: { id: 'categoria-1', codigo: 'C801', nombre: 'Arroz' },
    },
  };
}

describe('StockService', () => {
  let repositorio: StockEnMemoria;
  let servicio: StockService;

  beforeEach(() => {
    repositorio = new StockEnMemoria();
    servicio = new StockService(repositorio);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('le pasa el filtro al repositorio tal cual', async () => {
    const filtro = { bodegaId: 'bodega-1', categoriaId: 'categoria-1', referenciaId: 'r-1' };

    await servicio.consultar(filtro);

    expect(repositorio.filtros).toEqual([filtro]);
  });

  it('sin filtro consulta todo el banco', async () => {
    await servicio.consultar();

    expect(repositorio.filtros).toEqual([{}]);
  });

  it('marca cada lote con su estado según el día en Colombia', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-15T15:00:00Z'));
    repositorio.filas = [saldo('2026-10-14'), saldo('2026-10-15'), saldo(null)];

    const lotes = await servicio.consultar();

    expect(lotes.map(({ vencimiento, estado }) => [vencimiento, estado])).toEqual([
      ['2026-10-14', 'vencido'],
      ['2026-10-15', 'vigente'],
      [null, 'sin_vencimiento'],
    ]);
    expect(lotes[0]).toMatchObject({ cantidad: '10', bodegaId: 'bodega-1' });
  });

  it('a las 9 p. m. en Pereira ya es el día siguiente en UTC, pero el lote que vence hoy sigue vigente', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 21:00 del 15 en Bogotá son las 02:00 del 16 en UTC.
    vi.setSystemTime(new Date('2026-10-16T02:00:00Z'));
    repositorio.filas = [saldo('2026-10-15')];

    const [lote] = await servicio.consultar();

    expect(lote?.estado).toBe('vigente');
  });
});

describe('estadoDelLote', () => {
  it('vence el día siguiente al impreso', () => {
    expect(estadoDelLote('2026-10-15', '2026-10-15')).toBe('vigente');
    expect(estadoDelLote('2026-10-15', '2026-10-16')).toBe('vencido');
    expect(estadoDelLote('2027-01-01', '2026-12-31')).toBe('vigente');
  });

  it('sin fecha no vence', () => {
    expect(estadoDelLote(null, '2026-10-15')).toBe('sin_vencimiento');
  });
});

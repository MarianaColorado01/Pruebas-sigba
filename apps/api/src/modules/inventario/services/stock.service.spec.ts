import type { ClaveParametro, ParametroListado, ParametroVigente } from '@sigba/shared-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ParametrosLectura } from '../../plataforma/index.js';
import { type FiltroDeStock, type SaldoDeLote, StockRepositorio } from './stock.js';
import { estadoDelLote, semaforoDelLote, StockService } from './stock.service.js';

/** Devuelve los saldos que se le den y guarda el filtro con que lo llamaron. */
class StockEnMemoria extends StockRepositorio {
  filas: SaldoDeLote[] = [];
  filtros: FiltroDeStock[] = [];

  async saldos(filtro: FiltroDeStock): Promise<SaldoDeLote[]> {
    this.filtros.push(filtro);
    return this.filas;
  }
}

/** Los parámetros vigentes del banco, con la fecha con que se consultaron. */
class ParametrosEnMemoria extends ParametrosLectura {
  valores: Partial<Record<ClaveParametro, number>> = {};
  /** La fecha de cada lectura: el stock lee todos los parámetros una sola vez. */
  fechas: (string | undefined)[] = [];

  async obtenerVigente<K extends ClaveParametro>(): Promise<ParametroVigente<K> | null> {
    throw new Error('El stock lee los umbrales con listarVigentes, en una sola transacción.');
  }

  async listarVigentes(fecha?: string): Promise<ParametroListado[]> {
    this.fechas.push(fecha);
    return Object.entries(this.valores).map(
      ([clave, valor]) =>
        ({
          clave,
          valor,
          version: 1,
          fecha_inicio: '2026-01-01',
          fecha_fin: null,
        }) as ParametroListado,
    );
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
  let parametros: ParametrosEnMemoria;
  let servicio: StockService;

  beforeEach(() => {
    repositorio = new StockEnMemoria();
    parametros = new ParametrosEnMemoria();
    servicio = new StockService(repositorio, parametros);
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

  it('pinta el semáforo con los umbrales del banco vigentes hoy en Colombia', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-16T02:00:00Z'));
    parametros.valores = { semaforo_rojo_dias: 3, semaforo_amarillo_dias: 7 };
    repositorio.filas = [
      saldo('2026-10-14'),
      saldo('2026-10-18'),
      saldo('2026-10-19'),
      saldo('2026-10-22'),
      saldo('2026-10-23'),
      saldo(null),
    ];

    const lotes = await servicio.consultar();

    expect(lotes.map(({ diasParaVencer, semaforo }) => [diasParaVencer, semaforo])).toEqual([
      [-1, null],
      [3, 'rojo'],
      [4, 'amarillo'],
      [7, 'amarillo'],
      [8, 'verde'],
      [null, null],
    ]);
    expect(parametros.fechas).toEqual(['2026-10-15']);
  });

  it('sin umbrales configurados no hay semáforo, pero sí los días', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-15T15:00:00Z'));
    repositorio.filas = [saldo('2026-10-16')];

    const [lote] = await servicio.consultar();

    expect(lote).toMatchObject({ diasParaVencer: 1, semaforo: null, estado: 'vigente' });
  });
});

describe('semaforoDelLote', () => {
  it('el día del umbral ya cuenta: con rojo en 3, el lote a 3 días está en rojo', () => {
    expect(semaforoDelLote(3, { rojo: 3, amarillo: 7 })).toBe('rojo');
    expect(semaforoDelLote(0, { rojo: 3, amarillo: 7 })).toBe('rojo');
    expect(semaforoDelLote(7, { rojo: 3, amarillo: 7 })).toBe('amarillo');
    expect(semaforoDelLote(8, { rojo: 3, amarillo: 7 })).toBe('verde');
  });

  it('con un solo umbral aplica ese', () => {
    expect(semaforoDelLote(2, { rojo: 3, amarillo: null })).toBe('rojo');
    expect(semaforoDelLote(4, { rojo: 3, amarillo: null })).toBe('verde');
    expect(semaforoDelLote(2, { rojo: null, amarillo: 7 })).toBe('amarillo');
  });

  it('un lote vencido o sin fecha no lleva semáforo', () => {
    expect(semaforoDelLote(-1, { rojo: 3, amarillo: 7 })).toBeNull();
    expect(semaforoDelLote(null, { rojo: 3, amarillo: 7 })).toBeNull();
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

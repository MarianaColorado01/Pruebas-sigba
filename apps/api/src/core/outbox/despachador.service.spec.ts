import { afterEach, describe, expect, it, vi } from 'vitest';
import { DespachadorDeEventos, esperaTrasFallo } from './despachador.service.js';

const consumidor = (nombre: string) => ({ nombre, tipos: ['X'], procesar: vi.fn() });

describe('DespachadorDeEventos', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('duplica la espera con cada fallo hasta diez minutos', () => {
    expect([1, 2, 3, 4, 7, 8, 20].map(esperaTrasFallo)).toEqual([5, 10, 20, 40, 320, 600, 600]);
  });

  it('rechaza dos consumidores con el mismo nombre: comparten el acuse', () => {
    const despachador = new DespachadorDeEventos({} as never);
    despachador.suscribir(consumidor('ingresos'));

    expect(() => despachador.suscribir(consumidor('ingresos'))).toThrow(/ingresos/);
  });

  it('sin consumidores no reclama nada', async () => {
    const prisma = { $queryRaw: vi.fn() };

    await expect(new DespachadorDeEventos(prisma as never).despachar()).resolves.toBe(0);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('al cerrar la aplicación deja de sondear y espera la pasada en curso', async () => {
    vi.useFakeTimers();
    const prisma = { $queryRaw: vi.fn().mockResolvedValue([]) };
    const despachador = new DespachadorDeEventos(prisma as never);
    despachador.suscribir(consumidor('ingresos'));

    despachador.iniciar();
    await vi.advanceTimersByTimeAsync(0);
    await despachador.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { OutboxService } from './outbox.service.js';

describe('OutboxService', () => {
  it('escribe el evento por la transacción recibida y devuelve su id', async () => {
    const servicio = new OutboxService();
    const tx = { $queryRaw: vi.fn().mockResolvedValue([{ id: 'evento-1' }]) };

    await expect(
      servicio.emitir(tx as never, {
        tipo: 'RecepcionConfirmada',
        version: 1,
        payload: { recepcionId: 'recepcion-1' },
      }),
    ).resolves.toBe('evento-1');

    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(tx.$queryRaw.mock.calls[0]).toEqual(
      expect.arrayContaining(['RecepcionConfirmada', 1, '{"recepcionId":"recepcion-1"}']),
    );
  });

  it('rechaza una versión fuera del rango SMALLINT', async () => {
    const tx = { $queryRaw: vi.fn() };

    await expect(
      new OutboxService().emitir(tx as never, {
        tipo: 'RecepcionConfirmada',
        version: 32768,
        payload: {},
      }),
    ).rejects.toThrow(/versión/i);

    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('rechaza cargas que no sean objetos JSON', async () => {
    const tx = { $queryRaw: vi.fn() };

    await expect(
      new OutboxService().emitir(tx as never, {
        tipo: 'RecepcionConfirmada',
        version: 1,
        payload: [] as never,
      }),
    ).rejects.toThrow(/objeto JSON/);

    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('falla si la función de base no devuelve el id', async () => {
    const tx = { $queryRaw: vi.fn().mockResolvedValue([]) };

    await expect(
      new OutboxService().emitir(tx as never, {
        tipo: 'RecepcionConfirmada',
        version: 1,
        payload: { recepcionId: 'recepcion-1' },
      }),
    ).rejects.toThrow(/no devolvió el id/);
  });
});

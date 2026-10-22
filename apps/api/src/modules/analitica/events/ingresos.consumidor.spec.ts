import { describe, expect, it, vi } from 'vitest';
import type { EventoEntregado } from '../../../core/index.js';
import { IngresosConsumidor } from './ingresos.consumidor.js';

const tx = {} as never;

function evento(tipo: string, payload: Record<string, unknown>, version = 1): EventoEntregado {
  return {
    id: 'evento',
    bancoId: 'banco',
    tipo,
    version,
    payload,
    ocurridoEn: new Date('2026-10-15T15:00:00Z'),
  };
}

function consumidor(faltan: string[] = []) {
  const repositorio = { registrar: vi.fn(), valorar: vi.fn().mockResolvedValue(faltan) };
  return { repositorio, consumidor: new IngresosConsumidor(repositorio) };
}

const recepcion = {
  recepcionId: 'rec',
  bodegaId: 'bod',
  donanteId: 'don',
  origen: 'propia',
  detalles: [
    {
      referenciaId: 'ref',
      categoriaId: 'cat',
      loteId: 'lote',
      cantidad: 1,
      kilos: 1,
      valorUnitario: null,
      importe: null,
    },
  ],
};

describe('IngresosConsumidor', () => {
  it('registra una fila por lote de la recepción, en el banco del evento', async () => {
    const { repositorio, consumidor: c } = consumidor();

    await c.procesar(evento('RecepcionConfirmada', recepcion), tx);

    expect(repositorio.registrar).toHaveBeenCalledWith(tx, 'banco', [
      expect.objectContaining({
        loteId: 'lote',
        ocurridoEn: new Date('2026-10-15T15:00:00Z'),
        donanteId: 'don',
      }),
    ]);
  });

  it('pasa las valoraciones tardías del precio al repositorio', async () => {
    const { repositorio, consumidor: c } = consumidor();
    const valoraciones = [{ loteId: 'lote', valorUnitario: '10', importe: '10' }];

    await c.procesar(evento('PrecioActualizado', { valoraciones }), tx);

    expect(repositorio.valorar).toHaveBeenCalledWith(tx, 'banco', valoraciones);
  });

  it('falla, para reintentar, si el precio valora un lote que aún no llegó', async () => {
    const { consumidor: c } = consumidor(['lote']);

    await expect(c.procesar(evento('PrecioActualizado', { valoraciones: [] }), tx)).rejects.toThrow(
      /aún no están/,
    );
  });

  it('falla con una versión que no conoce en vez de descartarla', async () => {
    const { repositorio, consumidor: c } = consumidor();

    await expect(c.procesar(evento('RecepcionConfirmada', recepcion, 2), tx)).rejects.toThrow(
      /no conoce RecepcionConfirmada v2/,
    );
    expect(repositorio.registrar).not.toHaveBeenCalled();
  });
});

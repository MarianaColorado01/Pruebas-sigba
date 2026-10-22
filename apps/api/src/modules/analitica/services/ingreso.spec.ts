import { describe, expect, it } from 'vitest';
import { filasDeRecepcion } from './ingreso.js';

describe('filasDeRecepcion', () => {
  it('da una fila por lote con la cabecera de la recepción y el instante del evento', () => {
    const cuando = new Date('2026-10-15T15:00:00Z');
    const detalle = {
      referenciaId: 'ref',
      categoriaId: 'cat',
      loteId: 'lote',
      cantidad: 4,
      kilos: 2,
      valorUnitario: null,
      importe: null,
    };

    expect(
      filasDeRecepcion(
        {
          recepcionId: 'rec',
          bodegaId: 'bod',
          donanteId: 'don',
          origen: 'abaco',
          detalles: [detalle, { ...detalle, loteId: 'otro', valorUnitario: '10', importe: '40' }],
        },
        cuando,
      ),
    ).toEqual([
      {
        ...detalle,
        recepcionId: 'rec',
        ocurridoEn: cuando,
        donanteId: 'don',
        origen: 'abaco',
        bodegaId: 'bod',
      },
      {
        ...detalle,
        loteId: 'otro',
        valorUnitario: '10',
        importe: '40',
        recepcionId: 'rec',
        ocurridoEn: cuando,
        donanteId: 'don',
        origen: 'abaco',
        bodegaId: 'bod',
      },
    ]);
  });
});

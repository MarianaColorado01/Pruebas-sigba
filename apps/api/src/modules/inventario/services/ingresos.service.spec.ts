import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { type IngresoDeReferencia, IngresosRepositorio } from './ingreso.js';
import { IngresosService } from './ingresos.service.js';

const ARROZ: IngresoDeReferencia = {
  referenciaId: '01920000-0000-7000-8000-000000000005',
  producto: 'Arroz',
  presentacion: '500 g',
  cantidad: '10',
  kilos: '5',
  importeConocido: null,
  cantidadPendiente: '10',
};

/** Guarda el periodo que le piden y devuelve una referencia. */
class IngresosEnMemoria extends IngresosRepositorio {
  periodos: [string, string][] = [];

  async recibidos(desde: string, hasta: string): Promise<IngresoDeReferencia[]> {
    this.periodos.push([desde, hasta]);
    return [ARROZ];
  }
}

describe('IngresosService', () => {
  function servicio() {
    const repositorio = new IngresosEnMemoria();
    return { repositorio, ingresos: new IngresosService(repositorio) };
  }

  it('pide del primer día del mes al primero del siguiente y devuelve el mes', async () => {
    const { repositorio, ingresos } = servicio();

    expect(await ingresos.delMes('2026-10')).toEqual({ mes: '2026-10', referencias: [ARROZ] });
    expect(repositorio.periodos).toEqual([['2026-10-01', '2026-11-01']]);
  });

  it('diciembre termina en enero del año siguiente', async () => {
    const { repositorio, ingresos } = servicio();

    await ingresos.delMes('2026-12');
    await ingresos.delMes('2026-09');

    expect(repositorio.periodos).toEqual([
      ['2026-12-01', '2027-01-01'],
      ['2026-09-01', '2026-10-01'],
    ]);
  });

  it.each(['2026-13', '2026-00', '2026-1', '26-10', '2026-10-01', '', undefined])(
    'rechaza el mes %s sin consultar',
    async (mes) => {
      const { repositorio, ingresos } = servicio();

      await expect(ingresos.delMes(mes as string)).rejects.toThrow(
        new BadRequestException('El mes no es válido (AAAA-MM).'),
      );
      expect(repositorio.periodos).toEqual([]);
    },
  );
});

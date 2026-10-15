import { BadRequestException, Injectable } from '@nestjs/common';
import { type IngresosDelMes, IngresosRepositorio } from './ingreso.js';

const MES = /^(\d{4})-(0[1-9]|1[0-2])$/;

/**
 * Ingresos del mes para la coordinación (SBA-43). El mes es el calendario de
 * Colombia: una recepción del 31 a las once de la noche cuenta en ese mes
 * aunque en UTC ya sea el siguiente.
 */
@Injectable()
export class IngresosService {
  constructor(private readonly repositorio: IngresosRepositorio) {}

  async delMes(mes: string): Promise<IngresosDelMes> {
    const partes = typeof mes === 'string' ? MES.exec(mes) : null;
    if (!partes) throw new BadRequestException('El mes no es válido (AAAA-MM).');
    const anio = Number(partes[1]);
    const numero = Number(partes[2]);
    const siguiente =
      numero === 12 ? `${anio + 1}-01` : `${partes[1]}-${String(numero + 1).padStart(2, '0')}`;

    return { mes, referencias: await this.repositorio.recibidos(`${mes}-01`, `${siguiente}-01`) };
  }
}

import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../../../core/index.js';
import { IngresosDelMesDto } from '../dto/ingreso.dto.js';
import type { IngresosDelMes } from '../services/ingreso.js';
import { IngresosService } from '../services/ingresos.service.js';

/**
 * Ingresos del mes por referencia para la coordinación y la administración
 * del banco (SBA-43). Lo pendiente de valorar sale aparte del importe.
 */
@Controller('ingresos')
@Roles('coordinacion', 'admin_banco')
export class IngresosController {
  constructor(private readonly ingresos: IngresosService) {}

  /** `?mes=AAAA-MM`, con el calendario de Colombia. */
  @Get()
  delMes(@Query() { mes }: IngresosDelMesDto): Promise<IngresosDelMes> {
    return this.ingresos.delMes(mes);
  }
}

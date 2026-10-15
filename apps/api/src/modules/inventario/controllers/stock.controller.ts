import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../../../core/index.js';
import { ConsultarStockDto } from '../dto/stock.dto.js';
import { StockService } from '../services/stock.service.js';

/**
 * Stock por HTTP (SBA-36). Lo consultan los mismos roles que leen el catálogo:
 * bodega, voluntariado, coordinación y la administración del banco.
 */
@Controller('stock')
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Roles('operario_bodega', 'voluntario', 'coordinacion', 'admin_banco')
  @Get()
  consultar(@Query() filtro: ConsultarStockDto) {
    return this.stock.consultar(filtro);
  }
}

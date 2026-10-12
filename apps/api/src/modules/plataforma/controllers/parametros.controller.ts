import { Body, Controller, Get, Param, Put, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import type { ClaveParametro } from '@sigba/shared-types';
import { Roles } from '../../../core/index.js';
import { ActualizarParametroDto } from '../dto/parametros.dto.js';
import { ParametrosService } from '../services/parametros.service.js';

@Controller('parametros')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class ParametrosController {
  constructor(private readonly parametros: ParametrosService) {}

  @Get()
  @Roles('admin_banco')
  listar(@Query('fecha') fecha?: string) {
    return this.parametros.listarVigentes(fecha);
  }

  @Get(':clave/historial')
  @Roles('admin_banco')
  historial(@Param('clave') clave: string) {
    return this.parametros.historial(clave);
  }

  @Put(':clave')
  @Roles('admin_banco')
  actualizar(@Param('clave') clave: string, @Body() entrada: ActualizarParametroDto) {
    return this.parametros.actualizar(clave as ClaveParametro, entrada.valor, entrada.fechaInicio);
  }
}

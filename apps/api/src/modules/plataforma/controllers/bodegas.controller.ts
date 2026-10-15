import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Response } from 'express';
import { Roles } from '../../../core/index.js';
import {
  CrearBodegaDto,
  EditarBodegaDto,
  FiltroDeBodegasDto,
} from '../dto/bancos-y-bodegas.dto.js';
import { AdministracionDeBodegasService } from '../services/administracion-de-bodegas.service.js';
import type { FichaDeBodega } from '../services/bodega.js';

/**
 * Bodegas del banco de la petición (SBA-19, D10). Las gestiona `admin_banco`;
 * las leen los roles de banco que registran o consultan movimientos.
 */
@Controller('bodegas')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class BodegasController {
  constructor(private readonly bodegas: AdministracionDeBodegasService) {}

  @Get()
  @Roles('admin_banco', 'coordinacion', 'operario_bodega', 'voluntario', 'consulta')
  listar(@Query() filtro: FiltroDeBodegasDto): Promise<FichaDeBodega[]> {
    return this.bodegas.listar(filtro);
  }

  /** 201 al crear; 200 con la bodega existente si llega el mismo alta otra vez. */
  @Post()
  @Roles('admin_banco')
  async crear(
    @Body() nueva: CrearBodegaDto,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<FichaDeBodega> {
    const { bodega, repetida } = await this.bodegas.crear(nueva);
    if (repetida) respuesta.status(200);
    return bodega;
  }

  @Patch(':id')
  @Roles('admin_banco')
  editar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() edicion: EditarBodegaDto,
  ): Promise<FichaDeBodega> {
    return this.bodegas.editar(id, edicion);
  }

  @Post(':id/desactivar')
  @Roles('admin_banco')
  desactivar(@Param('id', ParseUUIDPipe) id: string): Promise<FichaDeBodega> {
    return this.bodegas.desactivar(id);
  }

  @Post(':id/reactivar')
  @Roles('admin_banco')
  reactivar(@Param('id', ParseUUIDPipe) id: string): Promise<FichaDeBodega> {
    return this.bodegas.reactivar(id);
  }
}

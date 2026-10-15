import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '../../../core/index.js';
import {
  CrearInstitucionDto,
  EditarInstitucionDto,
  FiltroDeInstitucionesDto,
} from '../dto/institucion.dto.js';
import { DirectorioDeInstitucionesService } from '../services/directorio-de-instituciones.service.js';
import type { Institucion } from '../services/institucion.js';

/**
 * Administración del directorio de instituciones (SBA-26, RF-M2-01). Solo
 * coordinación y la administradora del banco; el banco y el actor los fija
 * `@Roles()` en el contexto de tenant (SBA-18).
 */
@Controller('instituciones')
@Roles('admin_banco', 'coordinacion')
export class InstitucionesController {
  constructor(private readonly directorio: DirectorioDeInstitucionesService) {}

  @Get()
  buscar(@Query() filtro: FiltroDeInstitucionesDto): Promise<Institucion[]> {
    return this.directorio.buscar(filtro);
  }

  @Post()
  crear(@Body() nueva: CrearInstitucionDto): Promise<Institucion> {
    return this.directorio.crear(nueva);
  }

  @Patch(':id')
  editar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() edicion: EditarInstitucionDto,
  ): Promise<Institucion> {
    return this.directorio.editar(id, edicion);
  }

  @Post(':id/desactivar')
  desactivar(@Param('id', ParseUUIDPipe) id: string): Promise<Institucion> {
    return this.directorio.desactivar(id);
  }
}

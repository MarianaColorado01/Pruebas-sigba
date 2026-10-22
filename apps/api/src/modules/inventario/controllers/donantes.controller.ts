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
} from '@nestjs/common';
import type { Response } from 'express';
import { Roles } from '../../../core/index.js';
import { BuscarDonantesDto, CrearDonanteDto, EditarDonanteDto } from '../dto/donante.dto.js';
import type { Donante } from '../services/donante.js';
import { DonantesService } from '../services/donantes.service.js';

const ROLES_DE_LECTURA = ['operario_bodega', 'voluntario', 'coordinacion', 'admin_banco'] as const;
/** Quien registra la recepción da de alta al donante que no encuentra (SBA-25). */
const ROLES_DE_ALTA = ['operario_bodega', 'coordinacion', 'admin_banco'] as const;
const ROLES_DE_ADMINISTRACION = ['coordinacion', 'admin_banco'] as const;

/**
 * Directorio de donantes por HTTP (SBA-79). Traduce HTTP a `DonantesService`;
 * las reglas viven en el servicio. La bodega busca y da de alta desde la
 * recepción; editar y desactivar es de coordinación y administración.
 */
@Controller('donantes')
export class DonantesController {
  constructor(private readonly donantes: DonantesService) {}

  @Roles(...ROLES_DE_LECTURA)
  @Get()
  buscar(@Query() filtro: BuscarDonantesDto): Promise<Donante[]> {
    return this.donantes.buscar(filtro);
  }

  /** 201 al crear; 200 con el donante existente si ya hay uno activo con ese nombre y tipo. */
  @Roles(...ROLES_DE_ALTA)
  @Post()
  async crear(
    @Body() nuevo: CrearDonanteDto,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<Donante> {
    const { donante, repetido } = await this.donantes.darDeAlta(nuevo);
    if (repetido) respuesta.status(200);
    return donante;
  }

  @Roles(...ROLES_DE_ADMINISTRACION)
  @Patch(':id')
  editar(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() cambios: EditarDonanteDto,
  ): Promise<Donante> {
    return this.donantes.editar(id, cambios);
  }

  @Roles(...ROLES_DE_ADMINISTRACION)
  @Post(':id/desactivar')
  desactivar(@Param('id', new ParseUUIDPipe()) id: string): Promise<Donante> {
    return this.donantes.desactivar(id);
  }
}

import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Response } from 'express';
import { Roles } from '../../../core/index.js';
import { CrearBancoDto, EditarBancoDto } from '../dto/bancos-y-bodegas.dto.js';
import { AdministracionDeBancosService } from '../services/administracion-de-bancos.service.js';
import type { Banco } from '../services/banco.js';

/**
 * Bancos de la red (SBA-19, D11). Solo `super_admin`. El banco de cada
 * escritura va en la ruta y el repositorio lo fija como contexto (D7).
 */
@Controller('bancos')
@Roles('super_admin')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class BancosController {
  constructor(private readonly bancos: AdministracionDeBancosService) {}

  @Get()
  listar(): Promise<Banco[]> {
    return this.bancos.listar();
  }

  /** 201 al crear; 200 con el banco existente si llega el mismo alta otra vez. */
  @Post()
  async crear(
    @Body() nuevo: CrearBancoDto,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<Banco> {
    const { banco, repetido } = await this.bancos.crear(nuevo);
    if (repetido) respuesta.status(200);
    return banco;
  }

  @Patch(':bancoId')
  editar(
    @Param('bancoId', ParseUUIDPipe) bancoId: string,
    @Body() edicion: EditarBancoDto,
  ): Promise<Banco> {
    return this.bancos.editar(bancoId, edicion);
  }

  @Post(':bancoId/desactivar')
  desactivar(@Param('bancoId', ParseUUIDPipe) bancoId: string): Promise<Banco> {
    return this.bancos.desactivar(bancoId);
  }

  @Post(':bancoId/reactivar')
  reactivar(@Param('bancoId', ParseUUIDPipe) bancoId: string): Promise<Banco> {
    return this.bancos.reactivar(bancoId);
  }
}

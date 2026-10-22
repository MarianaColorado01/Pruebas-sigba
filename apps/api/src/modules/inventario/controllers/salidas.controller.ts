import { Body, Controller, Get, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Roles } from '../../../core/index.js';
import { RegistrarSalidaDto } from '../dto/salida.dto.js';
import type { Salida, TipoDeDespachador } from '../services/salida.js';
import { SalidasService } from '../services/salidas.service.js';

/**
 * Salida a institución (SBA-38). La registra quien despacha en bodega, el
 * voluntariado que apoya el despacho, y la coordinación y la administración
 * del banco. El banco y el actor los fija `@Roles()` en el contexto de tenant.
 */
@Controller('salidas')
@Roles('operario_bodega', 'voluntario', 'coordinacion', 'admin_banco')
export class SalidasController {
  constructor(private readonly salidas: SalidasService) {}

  /** 201 la primera vez; 200 con la misma salida si el celular reenvía el comando. */
  @Post()
  async registrar(
    @Body() comando: RegistrarSalidaDto,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<Salida> {
    // El servicio valida el tipo contra su lista; aquí solo llega como texto.
    const { salida, repetida } = await this.salidas.registrar({
      ...comando,
      despachadorTipo: comando.despachadorTipo as TipoDeDespachador,
    });
    if (repetida) respuesta.status(200);
    return salida;
  }

  /** Id y nombre de las instituciones activas, para elegir a quién se entrega. */
  @Get('instituciones')
  institucionesActivas() {
    return this.salidas.institucionesActivas();
  }
}

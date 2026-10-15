import { Body, Controller, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Roles } from '../../../core/index.js';
import { RegistrarRecepcionDto } from '../dto/recepcion.dto.js';
import type { Novedad, Origen, Recepcion } from '../services/recepcion.js';
import { RecepcionesService } from '../services/recepciones.service.js';

/**
 * Recepción manual con red (SBA-24). Registra quien trabaja en bodega, y la
 * coordinación y la administración del banco; el banco y el actor los fija
 * `@Roles()` en el contexto de tenant.
 */
@Controller('recepciones')
@Roles('operario_bodega', 'coordinacion', 'admin_banco')
export class RecepcionesController {
  constructor(private readonly recepciones: RecepcionesService) {}

  /** 201 la primera vez; 200 con la misma recepción si el celular reenvía el comando. */
  @Post()
  async registrar(
    @Body() comando: RegistrarRecepcionDto,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<Recepcion> {
    // El servicio valida origen y novedad contra sus listas; aquí solo llegan como texto.
    const { recepcion, repetida } = await this.recepciones.registrar({
      ...comando,
      origen: comando.origen as Origen,
      detalles: comando.detalles.map((fila) => ({ ...fila, novedad: fila.novedad as Novedad })),
    });
    if (repetida) respuesta.status(200);
    return recepcion;
  }
}

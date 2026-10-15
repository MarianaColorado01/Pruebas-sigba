import { Body, Controller, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Roles } from '../../../core/index.js';
import { MovimientoSobreUnLoteDto } from '../dto/baja-y-ajuste.dto.js';
import type {
  MotivoDeBaja,
  MovimientoManual,
  MovimientoManualRegistrado,
} from '../services/baja-y-ajuste.js';
import { BajasYAjustesService } from '../services/bajas-y-ajustes.service.js';

/**
 * Bajas y ajustes de inventario (SBA-42). Los registran la coordinación y la
 * administración del banco, no el operario de bodega: mueven el saldo sin una
 * donación ni una entrega detrás. El banco y el actor los fija `@Roles()` en
 * el contexto de tenant.
 *
 * 201 la primera vez; 200 con el mismo movimiento si el cliente reenvía el comando.
 */
@Controller()
@Roles('coordinacion', 'admin_banco')
export class BajasYAjustesController {
  constructor(private readonly servicio: BajasYAjustesService) {}

  @Post('bajas')
  async darDeBaja(
    @Body() comando: MovimientoSobreUnLoteDto,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<MovimientoManual> {
    // El servicio valida el motivo contra su lista; aquí solo llega como texto.
    const registrado = await this.servicio.darDeBaja({
      ...comando,
      motivo: comando.motivo as MotivoDeBaja,
    });
    return responder(registrado, respuesta);
  }

  @Post('ajustes')
  async ajustar(
    @Body() comando: MovimientoSobreUnLoteDto,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<MovimientoManual> {
    return responder(await this.servicio.ajustar(comando), respuesta);
  }
}

function responder(
  { movimiento, repetida }: MovimientoManualRegistrado,
  respuesta: Response,
): MovimientoManual {
  if (repetida) respuesta.status(200);
  return movimiento;
}

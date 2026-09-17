import { Controller, Get } from '@nestjs/common';
import { SaludService } from '../services/salud.service.js';
import type { EstadoDeSaludDto } from '../dto/estadoDeSalud.dto.js';

/**
 * Los controladores solo traducen HTTP a llamadas del servicio. Sin reglas de
 * negocio: esas viven en `services/` y se prueban sin levantar el servidor.
 */
@Controller('health')
export class SaludController {
  constructor(private readonly salud: SaludService) {}

  @Get()
  consultar(): EstadoDeSaludDto {
    return this.salud.consultar(process.uptime());
  }
}

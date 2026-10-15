import { Controller, Get } from '@nestjs/common';
import type { AsignacionDeUsuario } from '@sigba/shared-types';
import { Autenticado } from '../../../core/index.js';
import { UsuariosService } from '../services/usuarios.service.js';

/**
 * Lo que la persona de la sesión consulta de sí misma. Sin asignación todavía
 * tiene que poder preguntar, así que va con `@Autenticado()` y no con
 * `@Roles()` (D6, D13).
 */
@Controller('yo')
export class YoController {
  constructor(private readonly usuarios: UsuariosService) {}

  @Autenticado()
  @Get('asignaciones')
  asignaciones(): Promise<AsignacionDeUsuario[]> {
    return this.usuarios.asignacionesPropias();
  }
}

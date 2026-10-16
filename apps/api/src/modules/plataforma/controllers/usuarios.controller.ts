import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Roles } from '../../../core/index.js';
import { UsuariosService } from '../services/usuarios.service.js';

/** Quién tiene acceso al banco y quitárselo (D15). Solo `admin_banco`. */
@Controller('usuarios')
@Roles('admin_banco')
export class UsuariosController {
  constructor(private readonly usuarios: UsuariosService) {}

  @Get()
  listar() {
    return this.usuarios.usuariosDelBanco();
  }

  @Post(':usuarioId/asignacion/desactivar')
  @HttpCode(200)
  desactivar(@Param('usuarioId', ParseUUIDPipe) usuarioId: string) {
    return this.usuarios.desactivarAsignacion(usuarioId);
  }
}

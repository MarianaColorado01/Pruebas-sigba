import { Module } from '@nestjs/common';
import { RESOLUTOR_DE_IDENTIDAD } from '../../core/index.js';
import { UsuariosPrismaRepositorio } from './repositories/usuarios.prisma.repositorio.js';
import { UsuariosRepositorio } from './services/usuario.js';
import { UsuariosService } from './services/usuarios.service.js';

/**
 * Plataforma · Equipo 3
 *
 * Red, bancos, bodegas, usuarios, roles y asignaciones, invitaciones, parámetros por banco.
 *
 * Arquitectura 5.2. Escribe en el schema `plataforma` y en ningún otro.
 */
@Module({
  imports: [],
  controllers: [],
  providers: [
    UsuariosService,
    { provide: UsuariosRepositorio, useClass: UsuariosPrismaRepositorio },
    { provide: RESOLUTOR_DE_IDENTIDAD, useExisting: UsuariosService },
  ],
  exports: [RESOLUTOR_DE_IDENTIDAD],
})
export class PlataformaModule {}

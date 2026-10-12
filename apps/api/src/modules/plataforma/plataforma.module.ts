import { Module } from '@nestjs/common';
import { RESOLUTOR_DE_IDENTIDAD } from '../../core/index.js';
import { ParametrosLectura, ParametrosService } from './services/parametros.service.js';
import { ParametrosPrismaRepositorio } from './repositories/parametros.prisma.repositorio.js';
import { ParametrosRepositorio } from './services/parametros.repositorio.js';
import { ParametrosController } from './controllers/parametros.controller.js';
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
  controllers: [ParametrosController],
  providers: [
    UsuariosService,
    { provide: UsuariosRepositorio, useClass: UsuariosPrismaRepositorio },
    ParametrosService,
    { provide: ParametrosRepositorio, useClass: ParametrosPrismaRepositorio },
    { provide: ParametrosLectura, useExisting: ParametrosService },
    { provide: RESOLUTOR_DE_IDENTIDAD, useExisting: UsuariosService },
  ],
  exports: [RESOLUTOR_DE_IDENTIDAD, ParametrosLectura],
})
export class PlataformaModule {}

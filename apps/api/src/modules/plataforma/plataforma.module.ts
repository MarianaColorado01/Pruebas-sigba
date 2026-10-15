import { Module } from '@nestjs/common';
import { RESOLUTOR_DE_IDENTIDAD } from '../../core/index.js';
import { AuditoriaController } from './controllers/auditoria.controller.js';
import { AuditoriaPrismaRepositorio } from './repositories/auditoria.prisma.repositorio.js';
import { BodegasPrismaRepositorio } from './repositories/bodegas.prisma.repositorio.js';
import { UsuariosPrismaRepositorio } from './repositories/usuarios.prisma.repositorio.js';
import { AuditoriaRepositorio } from './services/auditoria.js';
import { BodegasRepositorio } from './services/bodega.js';
import { BodegasService } from './services/bodegas.service.js';
import { ConsultaDeAuditoriaService } from './services/consulta-de-auditoria.service.js';
import { UsuariosRepositorio } from './services/usuario.js';
import { UsuariosService } from './services/usuarios.service.js';

/**
 * Plataforma · Equipo 3
 *
 * Red, bancos, bodegas, usuarios, roles y asignaciones, invitaciones, parámetros por banco.
 * También consulta la auditoría del banco (SBA-51).
 *
 * Arquitectura 5.2. Escribe en el schema `plataforma` y en ningún otro; de
 * `core.auditoria` solo lee.
 */
@Module({
  imports: [],
  controllers: [AuditoriaController],
  providers: [
    ConsultaDeAuditoriaService,
    { provide: AuditoriaRepositorio, useClass: AuditoriaPrismaRepositorio },
    BodegasService,
    { provide: BodegasRepositorio, useClass: BodegasPrismaRepositorio },
    UsuariosService,
    { provide: UsuariosRepositorio, useClass: UsuariosPrismaRepositorio },
    { provide: RESOLUTOR_DE_IDENTIDAD, useExisting: UsuariosService },
  ],
  exports: [BodegasService, RESOLUTOR_DE_IDENTIDAD],
})
export class PlataformaModule {}

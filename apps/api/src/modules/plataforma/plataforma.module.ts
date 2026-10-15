import { Module } from '@nestjs/common';
import { RESOLUTOR_DE_IDENTIDAD } from '../../core/index.js';
import { ParametrosLectura, ParametrosService } from './services/parametros.service.js';
import { AuditoriaController } from './controllers/auditoria.controller.js';
import { AuditoriaPrismaRepositorio } from './repositories/auditoria.prisma.repositorio.js';
import { BodegasPrismaRepositorio } from './repositories/bodegas.prisma.repositorio.js';
import { ParametrosPrismaRepositorio } from './repositories/parametros.prisma.repositorio.js';
import { ParametrosRepositorio } from './services/parametros.repositorio.js';
import { ParametrosController } from './controllers/parametros.controller.js';
import { UsuariosPrismaRepositorio } from './repositories/usuarios.prisma.repositorio.js';
import { AuditoriaRepositorio } from './services/auditoria.js';
import { AdministracionDeBodegasRepositorio, BodegasRepositorio } from './services/bodega.js';
import { BodegasService } from './services/bodegas.service.js';
import { ConsultaDeAuditoriaService } from './services/consulta-de-auditoria.service.js';
import { UsuariosRepositorio } from './services/usuario.js';
import { UsuariosService } from './services/usuarios.service.js';
// Bancos y bodegas (SBA-19)
import { BancosController } from './controllers/bancos.controller.js';
import { BodegasController } from './controllers/bodegas.controller.js';
import { YoController } from './controllers/yo.controller.js';
import { BancosPrismaRepositorio } from './repositories/bancos.prisma.repositorio.js';
import { AdministracionDeBancosService } from './services/administracion-de-bancos.service.js';
import { AdministracionDeBodegasService } from './services/administracion-de-bodegas.service.js';
import { BancosRepositorio } from './services/banco.js';

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
  controllers: [
    AuditoriaController,
    ParametrosController,
    // Bancos y bodegas (SBA-19)
    BancosController,
    BodegasController,
    // Sesión y asignaciones (SBA-19)
    YoController,
  ],
  providers: [
    ConsultaDeAuditoriaService,
    { provide: AuditoriaRepositorio, useClass: AuditoriaPrismaRepositorio },
    BodegasService,
    { provide: BodegasRepositorio, useClass: BodegasPrismaRepositorio },
    UsuariosService,
    { provide: UsuariosRepositorio, useClass: UsuariosPrismaRepositorio },
    ParametrosService,
    { provide: ParametrosRepositorio, useClass: ParametrosPrismaRepositorio },
    { provide: ParametrosLectura, useExisting: ParametrosService },
    { provide: RESOLUTOR_DE_IDENTIDAD, useExisting: UsuariosService },
    // Bancos y bodegas (SBA-19)
    AdministracionDeBancosService,
    { provide: BancosRepositorio, useClass: BancosPrismaRepositorio },
    AdministracionDeBodegasService,
    // El mismo adaptador sirve la lectura de otros módulos y la administración.
    { provide: AdministracionDeBodegasRepositorio, useExisting: BodegasRepositorio },
  ],
  exports: [BodegasService, RESOLUTOR_DE_IDENTIDAD, ParametrosLectura],
})
export class PlataformaModule {}

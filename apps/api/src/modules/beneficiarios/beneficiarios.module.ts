import { Module } from '@nestjs/common';
import { InstitucionesController } from './controllers/instituciones.controller.js';
import { InstitucionesPrismaRepositorio } from './repositories/instituciones.prisma.repositorio.js';
import { InstitucionesService } from './repositories/instituciones.service.js';
import { DirectorioDeInstitucionesService } from './services/directorio-de-instituciones.service.js';
import { InstitucionesRepositorio } from './services/institucion.js';

/**
 * Beneficiarios · Equipo 1
 *
 * Instituciones, beneficiarios, representantes, membresías, alertas y caracterización.
 *
 * Arquitectura 5.2. Escribe en el schema `beneficiarios` y en ningún otro.
 */
@Module({
  imports: [],
  controllers: [InstitucionesController],
  providers: [
    DirectorioDeInstitucionesService,
    InstitucionesService,
    { provide: InstitucionesRepositorio, useClass: InstitucionesPrismaRepositorio },
  ],
  exports: [InstitucionesService],
})
export class BeneficiariosModule {}

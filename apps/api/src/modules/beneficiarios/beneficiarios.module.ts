import { Module } from '@nestjs/common';
import {
  BeneficiariosController,
  MembresiasController,
} from './controllers/beneficiarios.controller.js';
import { InstitucionesController } from './controllers/instituciones.controller.js';
import { TiposDePoblacionController } from './controllers/tipos-de-poblacion.controller.js';
import { InstitucionesPrismaRepositorio } from './repositories/instituciones.prisma.repositorio.js';
import { InstitucionesService } from './repositories/instituciones.service.js';
import { RegistroPrismaRepositorio } from './repositories/registro.prisma.repositorio.js';
import { DirectorioDeInstitucionesService } from './services/directorio-de-instituciones.service.js';
import { InstitucionesRepositorio } from './services/institucion.js';
import { MembresiasService } from './services/membresias.service.js';
import { RegistroDeBeneficiariosService } from './services/registro-de-beneficiarios.service.js';
import { RegistroRepositorio } from './services/registro.js';

/**
 * Beneficiarios · Equipo 1
 *
 * Instituciones, beneficiarios, representantes, membresías, alertas y caracterización.
 *
 * Arquitectura 5.2. Escribe en el schema `beneficiarios` y en ningún otro.
 */
@Module({
  imports: [],
  controllers: [
    InstitucionesController,
    TiposDePoblacionController,
    BeneficiariosController,
    MembresiasController,
  ],
  providers: [
    DirectorioDeInstitucionesService,
    InstitucionesService,
    { provide: InstitucionesRepositorio, useClass: InstitucionesPrismaRepositorio },
    RegistroDeBeneficiariosService,
    MembresiasService,
    { provide: RegistroRepositorio, useClass: RegistroPrismaRepositorio },
  ],
  exports: [InstitucionesService],
})
export class BeneficiariosModule {}

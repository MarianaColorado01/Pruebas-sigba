import { Module } from '@nestjs/common';
import { PlataformaModule } from '../plataforma/index.js';
import { RecepcionesController } from './controllers/recepciones.controller.js';
import { ReferenciasController } from './controllers/referencias.controller.js';
import { CategoriasPrismaRepositorio } from './repositories/categorias.prisma.repositorio.js';
import { DonantesPrismaRepositorio } from './repositories/donantes.prisma.repositorio.js';
import { RecepcionesPrismaRepositorio } from './repositories/recepciones.prisma.repositorio.js';
import { ReferenciasPrismaRepositorio } from './repositories/referencias.prisma.repositorio.js';
import { CategoriasRepositorio } from './services/categoria.js';
import { DonantesRepositorio } from './services/donante.js';
import { DonantesService } from './services/donantes.service.js';
import { ImportacionCatalogoService } from './services/importacion-catalogo.service.js';
import { RecepcionesRepositorio } from './services/recepcion.js';
import { RecepcionesService } from './services/recepciones.service.js';
import { ReferenciasRepositorio } from './services/referencia.js';
import { ReferenciasService } from './services/referencias.service.js';

/**
 * Inventario · Equipo 2
 *
 * Categorías, productos, referencias con presentación, donantes, recepciones, lotes, movimientos, stock, salidas a institución, traslados y maestro de precios.
 *
 * Arquitectura 5.2. Escribe en el schema `inventario` y en ningún otro.
 */
@Module({
  imports: [PlataformaModule],
  controllers: [RecepcionesController, ReferenciasController],
  providers: [
    DonantesService,
    { provide: DonantesRepositorio, useClass: DonantesPrismaRepositorio },
    ImportacionCatalogoService,
    { provide: CategoriasRepositorio, useClass: CategoriasPrismaRepositorio },
    ReferenciasService,
    { provide: ReferenciasRepositorio, useClass: ReferenciasPrismaRepositorio },
    RecepcionesService,
    { provide: RecepcionesRepositorio, useClass: RecepcionesPrismaRepositorio },
  ],
  exports: [ReferenciasService],
})
export class InventarioModule {}

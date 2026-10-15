import { Module } from '@nestjs/common';
import { PlataformaModule } from '../plataforma/index.js';
import { BajasYAjustesController } from './controllers/bajas-y-ajustes.controller.js';
import { PreciosController } from './controllers/precios.controller.js';
import { RecepcionesController } from './controllers/recepciones.controller.js';
import { ReferenciasController } from './controllers/referencias.controller.js';
import { BajasYAjustesPrismaRepositorio } from './repositories/bajas-y-ajustes.prisma.repositorio.js';
import { CategoriasPrismaRepositorio } from './repositories/categorias.prisma.repositorio.js';
import { DonantesPrismaRepositorio } from './repositories/donantes.prisma.repositorio.js';
import { PreciosPrismaRepositorio } from './repositories/precios.prisma.repositorio.js';
import { RecepcionesPrismaRepositorio } from './repositories/recepciones.prisma.repositorio.js';
import { ReferenciasPrismaRepositorio } from './repositories/referencias.prisma.repositorio.js';
import { BajasYAjustesRepositorio } from './services/baja-y-ajuste.js';
import { BajasYAjustesService } from './services/bajas-y-ajustes.service.js';
import { CategoriasRepositorio } from './services/categoria.js';
import { DonantesRepositorio } from './services/donante.js';
import { DonantesService } from './services/donantes.service.js';
import { ImportacionCatalogoService } from './services/importacion-catalogo.service.js';
import { PreciosRepositorio } from './services/precio.js';
import { PreciosService } from './services/precios.service.js';
import { RecepcionesRepositorio } from './services/recepcion.js';
import { RecepcionesService } from './services/recepciones.service.js';
import { ReferenciasRepositorio } from './services/referencia.js';
import { ReferenciasService } from './services/referencias.service.js';

/**
 * Inventario · Equipo 2
 *
 * Categorías, productos, referencias con presentación, donantes, recepciones, lotes, movimientos, bajas, ajustes, stock, salidas a institución, traslados y maestro de precios.
 *
 * Arquitectura 5.2. Escribe en el schema `inventario` y en ningún otro.
 */
@Module({
  imports: [PlataformaModule],
  controllers: [
    BajasYAjustesController,
    PreciosController,
    RecepcionesController,
    ReferenciasController,
  ],
  providers: [
    DonantesService,
    { provide: DonantesRepositorio, useClass: DonantesPrismaRepositorio },
    ImportacionCatalogoService,
    { provide: CategoriasRepositorio, useClass: CategoriasPrismaRepositorio },
    ReferenciasService,
    { provide: ReferenciasRepositorio, useClass: ReferenciasPrismaRepositorio },
    RecepcionesService,
    { provide: RecepcionesRepositorio, useClass: RecepcionesPrismaRepositorio },
    BajasYAjustesService,
    { provide: BajasYAjustesRepositorio, useClass: BajasYAjustesPrismaRepositorio },
    PreciosService,
    { provide: PreciosRepositorio, useClass: PreciosPrismaRepositorio },
  ],
  exports: [ReferenciasService],
})
export class InventarioModule {}

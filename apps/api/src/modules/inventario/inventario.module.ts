import { Module } from '@nestjs/common';
import { CategoriasPrismaRepositorio } from './repositories/categorias.prisma.repositorio.js';
import { DonantesPrismaRepositorio } from './repositories/donantes.prisma.repositorio.js';
import { ReferenciasPrismaRepositorio } from './repositories/referencias.prisma.repositorio.js';
import { CategoriasRepositorio } from './services/categoria.js';
import { DonantesRepositorio } from './services/donante.js';
import { DonantesService } from './services/donantes.service.js';
import { ImportacionCatalogoService } from './services/importacion-catalogo.service.js';
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
  imports: [],
  controllers: [],
  providers: [
    DonantesService,
    { provide: DonantesRepositorio, useClass: DonantesPrismaRepositorio },
    ImportacionCatalogoService,
    { provide: CategoriasRepositorio, useClass: CategoriasPrismaRepositorio },
    ReferenciasService,
    { provide: ReferenciasRepositorio, useClass: ReferenciasPrismaRepositorio },
  ],
  exports: [ReferenciasService],
})
export class InventarioModule {}

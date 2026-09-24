import { Module } from '@nestjs/common';
import { DonantesPrismaRepositorio } from './repositories/donantes.prisma.repositorio.js';
import { DonantesRepositorio } from './services/donante.js';
import { DonantesService } from './services/donantes.service.js';

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
  ],
  exports: [],
})
export class InventarioModule {}

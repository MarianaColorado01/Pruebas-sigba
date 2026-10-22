import { Module, type OnModuleInit } from '@nestjs/common';
import { DespachadorDeEventos } from '../../core/index.js';
import { IngresosConsumidor } from './events/ingresos.consumidor.js';
import { IngresosPrismaRepositorio } from './repositories/ingresos.prisma.repositorio.js';
import { IngresosRepositorio } from './services/ingreso.js';

/**
 * Analitica · Equipo 3
 *
 * Suscriptores de eventos que alimentan modelos de lectura, indicadores, reportes mensuales y exportables.
 *
 * Arquitectura 5.2. Escribe en el schema `analitica` y en ningún otro.
 */
@Module({
  imports: [],
  controllers: [],
  providers: [
    IngresosConsumidor,
    { provide: IngresosRepositorio, useClass: IngresosPrismaRepositorio },
  ],
  exports: [],
})
export class AnaliticaModule implements OnModuleInit {
  constructor(
    private readonly despachador: DespachadorDeEventos,
    private readonly ingresos: IngresosConsumidor,
  ) {}

  onModuleInit(): void {
    this.despachador.suscribir(this.ingresos);
  }
}

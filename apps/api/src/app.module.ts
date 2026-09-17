import { Module } from '@nestjs/common';
import { CoreModule } from './core/index.js';
import { HealthModule } from './modules/health/index.js';
import { PlataformaModule } from './modules/plataforma/index.js';
import { InventarioModule } from './modules/inventario/index.js';
import { BeneficiariosModule } from './modules/beneficiarios/index.js';
import { AnaliticaModule } from './modules/analitica/index.js';

/**
 * Un proceso con core y los módulos funcionales (ADR-01).
 * Cada módulo se importa por su `index.ts`, igual que entre ellos.
 */
@Module({
  imports: [
    CoreModule,
    HealthModule,
    PlataformaModule,
    InventarioModule,
    BeneficiariosModule,
    AnaliticaModule,
  ],
})
export class AppModule {}

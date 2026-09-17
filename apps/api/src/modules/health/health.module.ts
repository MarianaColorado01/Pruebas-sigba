import { Module } from '@nestjs/common';
import { SaludController } from './controllers/salud.controller.js';
import { SaludService } from './services/salud.service.js';

/**
 * Health · plantilla de módulo y sonda del despliegue.
 *
 * No es un módulo funcional de los de Arquitectura 5.2: existe para dos cosas.
 * Una, ser la plantilla que `pnpm nuevo-modulo` copia. Dos, dar a Fly.io el
 * endpoint contra el que comprueba que la máquina está viva (SBA-7).
 */
@Module({
  controllers: [SaludController],
  providers: [SaludService],
  exports: [SaludService],
})
export class HealthModule {}

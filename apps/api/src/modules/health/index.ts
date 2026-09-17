/**
 * API pública de `health`.
 *
 * Esto es lo único que otro módulo puede importar. Todo lo que no esté
 * exportado aquí es interno: `controllers/`, `services/`, `repositories/`,
 * `dto/` y `events/` no se alcanzan desde fuera, y el lint lo comprueba
 * (Arquitectura 5.2).
 */

export { HealthModule } from './health.module.js';
export { SaludService } from './services/salud.service.js';
export type { EstadoDeSaludDto } from './dto/estadoDeSalud.dto.js';

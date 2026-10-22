/**
 * API pública de `beneficiarios` (Arquitectura 5.2).
 *
 * Expone `InstitucionesService` (lectura, SBA-33). Expondrá los eventos
 * `MembresiaActivada`, `MembresiaCerrada` y `AlertaDuplicidadResuelta`.
 *
 * Consume `SalidaRegistrada` para estimar cobertura; no escribe inventario
 * ni descuenta stock (ADR-14).
 */

export { BeneficiariosModule } from './beneficiarios.module.js';

// `inventario` consulta aquí el destino de una salida, con su propio `tx` (SBA-33).
export { InstitucionesService } from './repositories/instituciones.service.js';
export type { InstitucionDestino } from './repositories/instituciones.service.js';

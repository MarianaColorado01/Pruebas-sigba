/**
 * API pública de `beneficiarios` (Arquitectura 5.2).
 *
 * Expondrá `InstitucionesService` (lectura) y los eventos
 * `MembresiaActivada`, `MembresiaCerrada` y `AlertaDuplicidadResuelta`.
 *
 * Consume `SalidaRegistrada` para estimar cobertura; no escribe inventario
 * ni descuenta stock (ADR-14).
 */

export { BeneficiariosModule } from './beneficiarios.module.js';

/**
 * API pública de `plataforma` (Arquitectura 5.2).
 *
 * Expone contratos de lectura para los módulos consumidores.
 *
 * Los demás módulos importan de aquí, nunca de sus carpetas internas.
 */

export { PlataformaModule } from './plataforma.module.js';
export { ParametrosLectura } from './services/parametros.service.js';

/**
 * API pública de `plataforma` (Arquitectura 5.2).
 *
 * Expone `BodegasService` (lectura de una bodega activa, que usa la recepción
 * de inventario) y `ParametrosLectura` (lectura de parámetros por banco, SBA-20).
 * Quedan por exponer `BancosService` y `UsuariosService` (SBA-19, SBA-34).
 *
 * Los demás módulos importan de aquí, nunca de sus carpetas internas.
 */

export { PlataformaModule } from './plataforma.module.js';
export { ParametrosLectura } from './services/parametros.service.js';
export { BodegasService } from './services/bodegas.service.js';
export type { Bodega } from './services/bodega.js';

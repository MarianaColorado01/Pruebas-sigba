/**
 * API pública de `plataforma` (Arquitectura 5.2).
 *
 * Expondrá `BancosService`, `BodegasService`, `UsuariosService` y
 * `ParametrosService`, los tres últimos de solo lectura hacia otros módulos
 * (SBA-19, SBA-20, SBA-34).
 *
 * Los demás módulos importan de aquí, nunca de sus carpetas internas.
 */

export { PlataformaModule } from './plataforma.module.js';

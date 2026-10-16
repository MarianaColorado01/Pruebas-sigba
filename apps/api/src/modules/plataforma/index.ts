/**
 * API pública de `plataforma` (Arquitectura 5.2).
 *
 * Expone `BodegasService` (lectura de una bodega activa, que usa la recepción
 * de inventario), `ParametrosLectura` (lectura de parámetros por banco, SBA-20)
 * y `UsuariosService` con `invitar` (SBA-19, D9). Queda por exponer
 * `BancosService`.
 *
 * Los demás módulos importan de aquí, nunca de sus carpetas internas.
 */

export { PlataformaModule } from './plataforma.module.js';
export { ParametrosLectura } from './services/parametros.service.js';
export { BodegasService } from './services/bodegas.service.js';
export type { Bodega } from './services/bodega.js';
/**
 * `invitar` es el contrato de D9: M2 invita al rol `institucion` después de
 * validar la institución con su `InstitucionesService`.
 */
export {
  type Invitacion,
  type InvitacionEmitida,
  UsuariosService,
} from './services/usuarios.service.js';

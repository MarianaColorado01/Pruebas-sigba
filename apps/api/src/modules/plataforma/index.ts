/**
 * API pública de `plataforma` (Arquitectura 5.2).
 *
 * Expone `BodegasService` y `ParametrosLectura`, de solo lectura, para M1 y M2
 * (SBA-20, SBA-34; contrato en docs/arquitectura/contratos/plataforma-lectura.md),
 * y `UsuariosService` con `invitar` (SBA-19, D9). Queda por exponer
 * `BancosService`.
 *
 * Los demás módulos importan de aquí, nunca de sus carpetas internas.
 */

export { PlataformaModule } from './plataforma.module.js';
export {
  ParametrosLectura,
  ValorParametroAlmacenadoInvalido,
  VigenciaDuplicada,
} from './services/parametros.service.js';
export { BodegasService } from './services/bodegas.service.js';
export type { Bodega } from './services/bodega.js';
export type {
  BodegaLectura,
  ClaveParametroLectura,
  ResultadoParametro,
  ValorParametro,
} from '@sigba/shared-types';
/**
 * `invitar` es el contrato de D9: M2 invita al rol `institucion` después de
 * validar la institución con su `InstitucionesService`.
 */
export {
  type Invitacion,
  type InvitacionEmitida,
  UsuariosService,
} from './services/usuarios.service.js';

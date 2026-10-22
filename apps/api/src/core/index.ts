/**
 * API pública de `core`.
 *
 * Expone guards, decoradores, contexto de tenant y puertos de proveedores.
 *
 * Los módulos importan de aquí. Nada de `core` importa un módulo funcional.
 */

export { CoreModule } from './core.module.js';
export {
  RESOLUTOR_DE_IDENTIDAD,
  type IdentidadDeAutenticacion,
  type ResolutorDeIdentidad,
  type UsuarioResuelto,
} from './auth/resolutor-de-identidad.js';
export { TOKEN_VERIFIER, type TokenVerifier } from './auth/token-verifier.js';
export { Publico } from './auth/publico.decorator.js';
export { Autenticado } from './auth/autenticado.decorator.js';
export { GUARDS_GLOBALES } from './guards-globales.js';
export * from './autorizacion/index.js';
export * from './database/index.js';
export * from './auditoria/audit.service.js';
export { EnviadorDeCorreo, type MensajeDeCorreo } from './correo/enviador-de-correo.js';
export {
  IdempotenciaService,
  type ComandoAReclamar,
  type ResultadoDeComando,
} from './idempotencia/idempotencia.service.js';
export { OutboxService, type EventoDeDominio } from './outbox/outbox.service.js';
export { DespachadorDeEventos } from './outbox/despachador.service.js';
export type {
  ConsumidorDeEventos,
  EventoEntregado,
  TransaccionDeEvento,
} from './outbox/consumidor-de-eventos.js';

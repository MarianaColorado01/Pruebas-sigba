/**
 * API pública de `core`.
 *
 * Lo que expondrá, según Arquitectura 5.2: decoradores y guards,
 * `EventPublisher`, `AuditService` y los puertos de proveedores
 * (almacenamiento, correo, visión, precios). El guard de roles no sale suelto:
 * va dentro de `@Roles()`.
 *
 * Los módulos importan de aquí. Nada de `core` importa un módulo funcional.
 */

export { CoreModule } from './core.module.js';
export * from './autorizacion/index.js';
export * from './database/index.js';

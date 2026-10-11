/**
 * Lo que un módulo funcional usa de la autorización: `@Roles()`, que fija los
 * roles y el interceptor de tenant. El guard no sale suelto: sin el
 * interceptor autoriza la ruta sin fijar el contexto de tenant, y cada
 * símbolo que se publica aquí es contrato de `core` (Arquitectura 5.2). Los
 * guards globales se registran con `GUARDS_GLOBALES`.
 */
export { Roles } from './roles.decorator.js';

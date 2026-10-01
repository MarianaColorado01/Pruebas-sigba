/**
 * Lo que un módulo funcional usa de la autorización: `@Roles()`, que aplica
 * juntos el guard y el interceptor. Solo sale el decorador porque el guard sin
 * el interceptor autoriza la ruta sin fijar el contexto de tenant, y cada
 * símbolo que se publica aquí es contrato de `core` (Arquitectura 5.2).
 */
export { Roles } from './roles.decorator.js';

import { applyDecorators, SetMetadata, UseInterceptors } from '@nestjs/common';
import type { Rol } from '@sigba/shared-types';
import { ContextoDeTenantInterceptor } from './contexto-de-tenant.interceptor.js';
import { ROLES_PERMITIDOS } from './roles.guard.js';

/**
 * Roles que pueden usar la ruta o el controlador. Sin uno de ellos en el banco
 * de la petición, la API responde 403 aunque la PWA haya ocultado el botón. Si
 * va en los dos, mandan los de la ruta.
 *
 *   @Roles('admin_banco', 'coordinacion')
 *   @Post(':id/aprobar')
 *
 * El guard global de roles exige este metadato, salvo en rutas con `@Publico()`
 * o `@Autenticado()`.
 */
export function Roles(...roles: [Rol, ...Rol[]]) {
  return applyDecorators(
    SetMetadata(ROLES_PERMITIDOS, roles),
    UseInterceptors(ContextoDeTenantInterceptor),
  );
}

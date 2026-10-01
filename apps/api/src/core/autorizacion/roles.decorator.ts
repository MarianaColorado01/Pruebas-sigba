import { applyDecorators, SetMetadata, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Rol } from '@sigba/shared-types';
import { ContextoDeTenantInterceptor } from './contexto-de-tenant.interceptor.js';
import { ROLES_PERMITIDOS, RolesGuard } from './roles.guard.js';

/**
 * Roles que pueden usar la ruta o el controlador. Sin uno de ellos en el banco
 * de la petición, la API responde 403 aunque la PWA haya ocultado el botón. Si
 * va en los dos, mandan los de la ruta.
 *
 *   @Roles('admin_banco', 'coordinacion')
 *   @Post(':id/aprobar')
 *
 * Todavía no es global: sin el guard de JWT (SBA-8) toda ruta con `@Roles()`
 * da 401. El rechazo por defecto de RNF-01 entra con SBA-8.
 */
export function Roles(...roles: [Rol, ...Rol[]]) {
  return applyDecorators(
    SetMetadata(ROLES_PERMITIDOS, roles),
    UseGuards(RolesGuard),
    UseInterceptors(ContextoDeTenantInterceptor),
  );
}

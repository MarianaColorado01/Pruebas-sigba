import type { Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './auth/jwt-auth.guard.js';
import { AsignacionesDeUsuario } from './autorizacion/asignaciones-de-usuario.js';
import { RolesGuard } from './autorizacion/roles.guard.js';

/**
 * Guards de toda la API, en este orden: JWT responde 401 y roles, 403
 * (RNF-01). Se registran en AppModule y no en CoreModule porque
 * `AsignacionesDeUsuario` necesita `RESOLUTOR_DE_IDENTIDAD`, que da
 * plataforma, y core no importa módulos (ADR-01).
 */
export const GUARDS_GLOBALES: Provider[] = [
  AsignacionesDeUsuario,
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
];

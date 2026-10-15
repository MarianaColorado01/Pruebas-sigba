import { applyDecorators, SetMetadata, UseInterceptors } from '@nestjs/common';
import { ContextoDeTenantInterceptor } from '../autorizacion/contexto-de-tenant.interceptor.js';

export const SOLO_AUTENTICADO = 'sigba:solo-autenticado';

/**
 * Ruta para quien trae un JWT válido, tenga o no asignación en SIGBA: la
 * persona que todavía no tiene banco necesita preguntar a cuáles tiene acceso
 * o aceptar una invitación (D6 de plataforma-sba-19).
 *
 * El guard de roles no elige asignación ni fija banco. Si el usuario existe en
 * SIGBA, deja su `usuarioId` en el contexto de tenant; si no existe, el
 * contexto va vacío y la ruta decide qué responder. Por eso una ruta así no
 * puede leer datos de un banco.
 *
 *   @Autenticado()
 *   @Get('asignaciones')
 */
export function Autenticado() {
  return applyDecorators(
    SetMetadata(SOLO_AUTENTICADO, true),
    UseInterceptors(ContextoDeTenantInterceptor),
  );
}

import { AsyncLocalStorage } from 'node:async_hooks';
import type { Rol } from '@sigba/shared-types';

/**
 * Contexto de ejecución del tenant actual (ADR-07, SBA-6).
 * Almacena el banco, la institución y el usuario activos para fijar las
 * variables de sesión RLS (app.banco_id, app.institucion_id, app.usuario_id)
 * en cada transacción.
 */
export interface TenantContext {
  bancoId?: string;
  institucionId?: string;
  /**
   * En peticiones HTTP, el id de `plataforma.usuario`; en comandos y pruebas,
   * una etiqueta como 'importar-codigos'. SBA-8 y SBA-21 deciden si debe ser
   * siempre el id.
   */
  usuarioId?: string;
  rol?: Rol;
}

const tenantStorage = new AsyncLocalStorage<TenantContext>();

/**
 * Ejecuta una función dentro del contexto de un tenant.
 */
export function runWithTenantContext<T>(context: TenantContext, fn: () => T): T {
  return tenantStorage.run(context, fn);
}

/**
 * Obtiene el contexto de tenant de la ejecución actual.
 */
export function getTenantContext(): TenantContext | undefined {
  return tenantStorage.getStore();
}

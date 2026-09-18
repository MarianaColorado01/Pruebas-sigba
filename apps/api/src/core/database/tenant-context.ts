import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Contexto de ejecución del tenant actual (ADR-07, SBA-6).
 * Almacena el banco e institución activos para fijar las variables
 * de sesión RLS (app.banco_id, app.institucion_id) en cada transacción.
 */
export interface TenantContext {
  bancoId?: string;
  institucionId?: string;
  usuarioId?: string;
  rol?: string;
}

const tenantStorage = new AsyncLocalStorage<TenantContext>();

/**
 * Ejecuta una función dentro del contexto de un tenant.
 */
export function runWithTenantContext<T>(
  context: TenantContext,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  return tenantStorage.run(context, fn);
}

/**
 * Obtiene el contexto de tenant de la ejecución actual.
 */
export function getTenantContext(): TenantContext | undefined {
  return tenantStorage.getStore();
}

import { getTenantContext } from '../../../core/index.js';

/**
 * Banco y actor de la petición o del comando. Sin banco no hay a quién
 * escribirle ni qué leer.
 */
export function contexto(): { bancoId: string; actor: string | null } {
  const ctx = getTenantContext();
  if (!ctx?.bancoId) {
    throw new Error('Operación en inventario sin banco en el contexto de tenant.');
  }
  return { bancoId: ctx.bancoId, actor: ctx.usuarioId ?? null };
}

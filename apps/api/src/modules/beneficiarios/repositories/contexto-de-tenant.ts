import { getTenantContext } from '../../../core/index.js';

/**
 * Banco y actor de la petición o del comando. Sin banco no hay a quién
 * escribirle ni qué leer.
 */
export function contexto(): { bancoId: string; actor: string | null } {
  const ctx = getTenantContext();
  if (!ctx?.bancoId) {
    throw new Error('Operación en beneficiarios sin banco en el contexto de tenant.');
  }
  return { bancoId: ctx.bancoId, actor: ctx.actor ?? ctx.usuarioId ?? null };
}

/**
 * Banco y actor de una escritura. Toda escritura de negocio registra quién la
 * hizo (RNF-04): sin usuario en el contexto no se escribe.
 */
export function contextoDeEscritura(): { bancoId: string; actor: string } {
  const { bancoId, actor } = contexto();
  if (!actor) {
    throw new Error('Escritura en beneficiarios sin usuario en el contexto de tenant.');
  }
  return { bancoId, actor };
}

import { Prisma, PrismaClient } from '@prisma/client';
import { getTenantContext, type TenantContext } from './tenant-context.js';

/**
 * Transacciones que llevan el contexto de tenant a PostgreSQL para que RLS
 * pueda aplicarlo (ADR-07, SBA-6).
 *
 * Usa `set_config(clave, valor, true)`, que es la forma que fija Arquitectura
 * 8.1. El tercer argumento `true` hace que valga solo para la transacción, como
 * `SET LOCAL`, pero a diferencia de `SET LOCAL` admite parámetros enlazados:
 * el identificador de banco nunca se concatena dentro del SQL. En una función
 * que decide qué datos ve cada banco, esa diferencia es la que importa.
 */

/** Claves de sesión que leen las políticas RLS. */
const CLAVE_BANCO = 'app.banco_id';
const CLAVE_INSTITUCION = 'app.institucion_id';

/**
 * Fija el contexto dentro de la transacción. Sin contexto escribe cadena vacía,
 * que las políticas tratan como contexto ausente y rechazan (Arquitectura 8.1).
 */
async function fijarContexto(tx: Prisma.TransactionClient, ctx?: TenantContext): Promise<void> {
  await tx.$executeRaw`SELECT set_config(${CLAVE_BANCO}, ${ctx?.bancoId ?? ''}, true)`;
  await tx.$executeRaw`SELECT set_config(${CLAVE_INSTITUCION}, ${ctx?.institucionId ?? ''}, true)`;
}

export async function executeTransactionWithTenant<R>(
  client: { $transaction: (fn: (tx: Prisma.TransactionClient) => Promise<R>) => Promise<R> },
  fn: (tx: Prisma.TransactionClient) => Promise<R>,
  contextOverride?: TenantContext,
): Promise<R> {
  const ctx = contextOverride ?? getTenantContext();

  return client.$transaction(async (tx: Prisma.TransactionClient) => {
    await fijarContexto(tx, ctx);
    return fn(tx);
  });
}

export const rlsExtension = Prisma.defineExtension({
  name: 'rlsExtension',
  client: {
    /**
     * Única puerta de entrada a datos con aislamiento por banco. Cualquier
     * consulta hecha fuera de aquí corre sin contexto: las políticas la dejan
     * en cero filas en vez de devolver datos de otro banco.
     */
    async $transactionWithTenant<R>(
      this: { $transaction: (fn: (tx: Prisma.TransactionClient) => Promise<R>) => Promise<R> },
      fn: (tx: Prisma.TransactionClient) => Promise<R>,
      contextOverride?: TenantContext,
    ): Promise<R> {
      return executeTransactionWithTenant(this, fn, contextOverride);
    },
  },
});

export type ExtendedPrismaClient = ReturnType<typeof createExtendedPrismaClient>;

export function createExtendedPrismaClient(client: PrismaClient) {
  return client.$extends(rlsExtension);
}

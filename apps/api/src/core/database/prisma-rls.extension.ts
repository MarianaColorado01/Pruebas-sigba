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
/** Solo la lee la política que deja a cada usuario ver sus asignaciones (SBA-18). */
const CLAVE_USUARIO = 'app.usuario_id';
/**
 * Etiqueta de un comando sin usuario, como `importar-codigos`. Ninguna política
 * la lee: la auditoría la registra como actor de sistema cuando no hay usuario.
 */
const CLAVE_ACTOR = 'app.actor';

/**
 * Fija el contexto dentro de la transacción. Sin contexto escribe cadena vacía,
 * que las políticas tratan como contexto ausente y rechazan (Arquitectura 8.1).
 * Va en una sola sentencia porque se paga en cada transacción: cuatro idas a la
 * base por consulta llenaban el pool bajo carga (SBA-97).
 */
async function fijarContexto(tx: Prisma.TransactionClient, ctx?: TenantContext): Promise<void> {
  await tx.$executeRaw`
    SELECT set_config(${CLAVE_BANCO}, ${ctx?.bancoId ?? ''}, true),
           set_config(${CLAVE_INSTITUCION}, ${ctx?.institucionId ?? ''}, true),
           set_config(${CLAVE_USUARIO}, ${ctx?.usuarioId ?? ''}, true),
           set_config(${CLAVE_ACTOR}, ${ctx?.actor ?? ''}, true)`;
}

/**
 * Tiempos de la transacción interactiva, en milisegundos. Sin ellos rigen los
 * de Prisma: 2 s de espera por una conexión (`maxWait`) y 5 s de duración
 * (`timeout`). Al vencer `timeout`, Prisma revierte todo.
 *
 * Sube `timeout` solo para una tarea larga y conocida, como la importación de
 * códigos (SBA-12, SBA-64). Una petición HTTP normal no debería necesitarlo, y
 * una transacción abierta sostiene bloqueos y una conexión del pool.
 */
export interface OpcionesDeTransaccion {
  maxWait?: number;
  timeout?: number;
}

type ClienteTransaccional<R> = {
  $transaction(
    fn: (tx: Prisma.TransactionClient) => Promise<R>,
    opciones?: OpcionesDeTransaccion,
  ): Promise<R>;
};

/**
 * `opciones` va al final y es opcional para que los llamadores que solo pasan
 * `fn` o `contextOverride` sigan igual.
 */
export async function executeTransactionWithTenant<R>(
  client: ClienteTransaccional<R>,
  fn: (tx: Prisma.TransactionClient) => Promise<R>,
  contextOverride?: TenantContext,
  opciones?: OpcionesDeTransaccion,
): Promise<R> {
  const ctx = contextOverride ?? getTenantContext();

  return client.$transaction(async (tx: Prisma.TransactionClient) => {
    await fijarContexto(tx, ctx);
    return fn(tx);
  }, opciones);
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
      this: ClienteTransaccional<R>,
      fn: (tx: Prisma.TransactionClient) => Promise<R>,
      contextOverride?: TenantContext,
      opciones?: OpcionesDeTransaccion,
    ): Promise<R> {
      return executeTransactionWithTenant(this, fn, contextOverride, opciones);
    },
  },
});

export type ExtendedPrismaClient = ReturnType<typeof createExtendedPrismaClient>;

export function createExtendedPrismaClient(client: PrismaClient) {
  return client.$extends(rlsExtension);
}

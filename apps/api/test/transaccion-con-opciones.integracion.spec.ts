import { randomUUID } from 'node:crypto';
import { type Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createExtendedPrismaClient,
  executeTransactionWithTenant,
  type OpcionesDeTransaccion,
  type TenantContext,
} from '../src/core/index.js';
import { urlComoRolApp } from './rol-de-aplicacion.js';

/**
 * Tiempos de la transacción de tenant (SBA-64). Sin opciones rige el timeout de
 * Prisma, 5 s; con `{ timeout }` la transacción puede durar más.
 */

const URL_ADMIN = process.env['DATABASE_URL'];

if (process.env['CI'] && !URL_ADMIN) {
  throw new Error('Falta DATABASE_URL en CI para probar el timeout de las transacciones.');
}

const contexto = { bancoId: randomUUID(), actor: 'transaccion-con-opciones' };

describe('executeTransactionWithTenant: opciones de $transaction', () => {
  function clienteFalso() {
    const tx = { $executeRaw: vi.fn().mockResolvedValue(1) };
    const transaction = vi.fn(async (fn: (tx: Prisma.TransactionClient) => Promise<string>) =>
      fn(tx as unknown as Prisma.TransactionClient),
    );
    return { cliente: { $transaction: transaction }, transaction };
  }

  it('pasa { timeout, maxWait } a $transaction', async () => {
    const { cliente, transaction } = clienteFalso();

    await executeTransactionWithTenant(cliente, async () => 'ok', contexto, {
      timeout: 30_000,
      maxWait: 10_000,
    });

    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 30_000,
      maxWait: 10_000,
    });
  });

  it('sin opciones deja que rija el valor de Prisma', async () => {
    const { cliente, transaction } = clienteFalso();

    await executeTransactionWithTenant(cliente, async () => 'ok', contexto);

    expect(transaction).toHaveBeenCalledWith(expect.any(Function), undefined);
  });
});

describe.skipIf(!URL_ADMIN)('Timeout de la transacción contra PostgreSQL (SBA-64)', () => {
  let app: PrismaClient;
  // El tipo de `this` de la extensión no acepta el cliente extendido (también en
  // main, donde nadie la llama todavía): se tipa la llamada a mano.
  let extendido: {
    $transactionWithTenant<R>(
      fn: (tx: Prisma.TransactionClient) => Promise<R>,
      contextOverride?: TenantContext,
      opciones?: OpcionesDeTransaccion,
    ): Promise<R>;
  };

  // Pasa de los 5 s de Prisma por poco: la prueba tarda lo que tarda el timeout.
  async function transaccionLarga(tx: Prisma.TransactionClient) {
    await tx.$executeRaw`SELECT pg_sleep(5.5)`;
    return 'confirmada';
  }

  beforeAll(() => {
    app = new PrismaClient({ datasourceUrl: urlComoRolApp(URL_ADMIN as string) });
    extendido = createExtendedPrismaClient(app) as unknown as typeof extendido;
  });

  afterAll(async () => {
    if (app) await app.$disconnect();
  });

  it('con timeout: 30_000 confirma una transacción de más de 5 s; sin opciones falla', async () => {
    // En paralelo: las dos esperan lo mismo y la prueba dura una sola vez.
    const [conTimeout, sinOpciones] = await Promise.allSettled([
      extendido.$transactionWithTenant(transaccionLarga, contexto, { timeout: 30_000 }),
      executeTransactionWithTenant(app, transaccionLarga, contexto),
    ]);

    expect(conTimeout).toEqual({ status: 'fulfilled', value: 'confirmada' });
    expect(sinOpciones).toMatchObject({
      status: 'rejected',
      reason: { code: 'P2028' },
    });
  }, 20_000);
});

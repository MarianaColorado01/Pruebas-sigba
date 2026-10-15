import { randomUUID } from 'node:crypto';
import { type Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { executeTransactionWithTenant, OutboxService } from '../src/core/index.js';
import { urlComoRolApp } from './rol-de-aplicacion.js';

const URL_ADMIN = process.env['DATABASE_URL'];

if (process.env['CI'] && !URL_ADMIN) {
  throw new Error('Falta DATABASE_URL en CI para probar el outbox y su RLS.');
}

describe.skipIf(!URL_ADMIN)('Outbox contra PostgreSQL con el rol de la API', () => {
  let admin: PrismaClient;
  let app: PrismaClient;

  const bancoA = randomUUID();
  const bancoB = randomUUID();
  const outbox = new OutboxService();

  function cargaDeRecepcion(recepcionId: string) {
    return {
      recepcionId,
      bodegaId: randomUUID(),
      donanteId: randomUUID(),
      origen: 'propia',
      detalles: [{ referenciaId: randomUUID(), loteId: randomUUID(), cantidad: 12 }],
    };
  }

  function enBanco<R>(
    bancoId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<R>,
  ): Promise<R> {
    return executeTransactionWithTenant<R>(app, fn, { bancoId, actor: 'outbox-integracion' });
  }

  beforeAll(() => {
    admin = new PrismaClient({ datasourceUrl: URL_ADMIN });
    app = new PrismaClient({ datasourceUrl: urlComoRolApp(URL_ADMIN as string) });
  });

  afterAll(async () => {
    if (admin) {
      await admin.$executeRaw`
        DELETE FROM core.outbox WHERE banco_id IN (${bancoA}::uuid, ${bancoB}::uuid)`;
      await admin.$disconnect();
    }
    if (app) await app.$disconnect();
  });

  it('guarda un evento por banco con sus campos de contrato', async () => {
    const recepcionId = randomUUID();
    const payload = cargaDeRecepcion(recepcionId);
    const eventoId = await enBanco(bancoA, (tx) =>
      outbox.emitir(tx, {
        tipo: 'RecepcionConfirmada',
        version: 1,
        payload,
      }),
    );

    const filas = await admin.$queryRaw<
      {
        banco_id: string;
        tipo: string;
        version: number;
        payload: typeof payload;
        publicado_en: Date | null;
        intentos: number;
      }[]
    >`SELECT banco_id::text, tipo, version, payload, publicado_en, intentos
      FROM core.outbox WHERE id = ${eventoId}::uuid`;

    expect(filas).toEqual([
      {
        banco_id: bancoA,
        tipo: 'RecepcionConfirmada',
        version: 1,
        payload,
        publicado_en: null,
        intentos: 0,
      },
    ]);
  });

  it('revierte el evento con la transacción del caso de uso', async () => {
    const recepcionId = randomUUID();
    const payload = cargaDeRecepcion(recepcionId);
    let eventoId = '';

    await expect(
      enBanco(bancoA, async (tx) => {
        eventoId = await outbox.emitir(tx, {
          tipo: 'RecepcionConfirmada',
          version: 1,
          payload,
        });
        throw new Error('rollback de prueba');
      }),
    ).rejects.toThrow('rollback de prueba');

    const filas = await admin.$queryRaw<{ cantidad: bigint }[]>`
      SELECT count(*) AS cantidad FROM core.outbox WHERE id = ${eventoId}::uuid`;
    expect(Number(filas[0]?.cantidad)).toBe(0);
  });

  it('limita la lectura al banco del contexto y toma el banco de la transacción', async () => {
    const eventoA = await enBanco(bancoA, (tx) =>
      outbox.emitir(tx, {
        tipo: 'RecepcionConfirmada',
        version: 1,
        payload: cargaDeRecepcion(randomUUID()),
      }),
    );
    const eventoB = await enBanco(bancoB, (tx) =>
      outbox.emitir(tx, {
        tipo: 'RecepcionConfirmada',
        version: 1,
        payload: cargaDeRecepcion(randomUUID()),
      }),
    );

    const filas = await enBanco(
      bancoA,
      (tx) => tx.$queryRaw<{ id: string; banco_id: string }[]>`
        SELECT id::text, banco_id::text FROM core.outbox
        WHERE id IN (${eventoA}::uuid, ${eventoB}::uuid)`,
    );
    expect(filas).toEqual([{ id: eventoA, banco_id: bancoA }]);
  });

  it('solo permite leer directamente; la función es la única vía de escritura', async () => {
    const [permisos] = await app.$queryRaw<
      {
        puede_leer: boolean;
        puede_insertar: boolean;
        puede_actualizar: boolean;
        puede_eliminar: boolean;
        puede_ejecutar: boolean;
      }[]
    >`SELECT
      has_table_privilege(current_user, 'core.outbox', 'SELECT') AS puede_leer,
      has_table_privilege(current_user, 'core.outbox', 'INSERT') AS puede_insertar,
      has_table_privilege(current_user, 'core.outbox', 'UPDATE') AS puede_actualizar,
      has_table_privilege(current_user, 'core.outbox', 'DELETE') AS puede_eliminar,
      has_function_privilege(current_user, 'core.emitir_evento(text,smallint,jsonb)', 'EXECUTE') AS puede_ejecutar`;

    expect(permisos).toEqual({
      puede_leer: true,
      puede_insertar: false,
      puede_actualizar: false,
      puede_eliminar: false,
      puede_ejecutar: true,
    });
  });

  it('rechaza emitir fuera de una transacción con banco', async () => {
    await expect(
      app.$queryRaw`SELECT core.emitir_evento(
        'RecepcionConfirmada', 1::smallint, '{"recepcionId":"sin-contexto"}'::jsonb
      )`,
    ).rejects.toThrow(/contexto de banco/);
  });
});

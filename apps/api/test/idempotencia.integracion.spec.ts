import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { type Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  executeTransactionWithTenant,
  IdempotenciaService,
  type ResultadoDeComando,
} from '../src/core/index.js';
import { urlComoRolApp } from './rol-de-aplicacion.js';

/**
 * `core.comando_procesado` contra PostgreSQL, conectado como `sigba_app`
 * (Arquitectura 6.1, ADR-07). La tabla es append-only y nada la limpia: cada
 * corrida usa bancos propios.
 */

const URL_ADMIN = process.env['DATABASE_URL'];

if (process.env['CI'] && !URL_ADMIN) {
  throw new Error('Falta DATABASE_URL en CI para probar la idempotencia y su RLS.');
}

describe.skipIf(!URL_ADMIN)('Idempotencia de comandos contra PostgreSQL (6.1, ADR-07)', () => {
  let admin: PrismaClient;
  let app: PrismaClient;

  const bancoA = randomUUID();
  const bancoB = randomUUID();
  const actor = 'idempotencia-integracion';
  const idempotencia = new IdempotenciaService();
  const carga = { donanteId: randomUUID(), detalles: [{ cantidad: '3', lote: 'L-1' }] };

  function enBanco<R>(bancoId: string, fn: (tx: Prisma.TransactionClient) => Promise<R>) {
    return executeTransactionWithTenant<R>(app, fn, { bancoId, actor });
  }

  function reclamar(
    bancoId: string,
    comandoId: string,
    entidadId: string,
    cargaEnviada: unknown = carga,
  ): Promise<ResultadoDeComando | null> {
    return enBanco(bancoId, (tx) =>
      idempotencia.reclamar(tx, {
        comandoId,
        carga: cargaEnviada,
        resultado: { entidad: 'recepcion', entidadId },
      }),
    );
  }

  async function filasDe(comandoId: string) {
    return admin.$queryRaw<{ banco_id: string; entidad_id: string; carga_hash_version: number }[]>`
      SELECT banco_id::text, entidad_id::text, carga_hash_version
      FROM core.comando_procesado WHERE comando_id = ${comandoId}::uuid ORDER BY banco_id`;
  }

  beforeAll(() => {
    admin = new PrismaClient({ datasourceUrl: URL_ADMIN });
    app = new PrismaClient({ datasourceUrl: urlComoRolApp(URL_ADMIN as string) });
  });

  afterAll(async () => {
    if (admin) await admin.$disconnect();
    if (app) await app.$disconnect();
  });

  it('reserva un comando nuevo con su hash versionado y sin la carga', async () => {
    const comandoId = randomUUID();
    const recepcionId = randomUUID();

    await expect(reclamar(bancoA, comandoId, recepcionId)).resolves.toBeNull();

    expect(await filasDe(comandoId)).toEqual([
      { banco_id: bancoA, entidad_id: recepcionId, carga_hash_version: 1 },
    ]);
    const columnas = await admin.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'core' AND table_name = 'comando_procesado'`;
    expect(columnas.map((c) => c.column_name)).not.toContain('carga');
  });

  it('el reenvío con la misma carga devuelve el resultado original, no el que propone', async () => {
    const comandoId = randomUUID();
    const original = randomUUID();
    await reclamar(bancoA, comandoId, original);

    const mismaCargaReordenada = { detalles: carga.detalles, donanteId: carga.donanteId };
    await expect(reclamar(bancoA, comandoId, randomUUID(), mismaCargaReordenada)).resolves.toEqual({
      entidad: 'recepcion',
      entidadId: original,
    });
    expect(await filasDe(comandoId)).toHaveLength(1);
  });

  it('la misma clave con otra carga responde 409 y no toca la fila guardada', async () => {
    const comandoId = randomUUID();
    const original = randomUUID();
    await reclamar(bancoA, comandoId, original);

    await expect(
      reclamar(bancoA, comandoId, randomUUID(), { ...carga, donanteId: randomUUID() }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await filasDe(comandoId)).toEqual([
      { banco_id: bancoA, entidad_id: original, carga_hash_version: 1 },
    ]);
  });

  it('si la escritura de negocio revierte, la reserva también', async () => {
    const comandoId = randomUUID();

    await expect(
      enBanco(bancoA, async (tx) => {
        await idempotencia.reclamar(tx, {
          comandoId,
          carga,
          resultado: { entidad: 'recepcion', entidadId: randomUUID() },
        });
        throw new Error('rollback de prueba');
      }),
    ).rejects.toThrow('rollback de prueba');

    expect(await filasDe(comandoId)).toEqual([]);
  });

  it('de dos envíos simultáneos solo uno escribe; el otro espera y recibe su resultado', async () => {
    const comandoId = randomUUID();
    const recepcionA = randomUUID();
    let escrituras = 0;
    let soltarA!: () => void;
    let avisarReservado!: () => void;
    const aSoltado = new Promise<void>((r) => (soltarA = r));
    const aReservado = new Promise<void>((r) => (avisarReservado = r));

    const envio = (entidadId: string, alReservar?: () => Promise<void>) =>
      enBanco(bancoA, async (tx) => {
        const previo = await idempotencia.reclamar(tx, {
          comandoId,
          carga,
          resultado: { entidad: 'recepcion', entidadId },
        });
        if (previo) return previo;
        escrituras += 1;
        await alReservar?.();
        return { entidad: 'recepcion', entidadId };
      });

    // A reserva y se queda con la transacción abierta hasta que la prueba la suelte.
    const envioA = envio(recepcionA, async () => {
      avisarReservado();
      await aSoltado;
    });
    await aReservado;
    const envioB = envio(randomUUID());

    // B tiene que quedar bloqueado en Postgres esperando a A, no haber pasado de largo.
    await expect
      .poll(
        async () => {
          const [fila] = await admin.$queryRaw<{ esperando: bigint }[]>`
          SELECT count(*) AS esperando FROM pg_stat_activity
          WHERE datname = current_database()
            AND usename = 'sigba_app'
            AND wait_event_type = 'Lock'
            AND query LIKE '%core.reclamar_comando%'`;
          return Number(fila?.esperando);
        },
        { timeout: 3_000, interval: 50 },
      )
      .toBe(1);

    soltarA();
    const [resultadoA, resultadoB] = await Promise.all([envioA, envioB]);

    expect(escrituras).toBe(1);
    expect(resultadoA).toEqual({ entidad: 'recepcion', entidadId: recepcionA });
    expect(resultadoB).toEqual(resultadoA);
    expect(await filasDe(comandoId)).toHaveLength(1);
  });

  it('otro banco con el mismo comando_id no choca ni ve el resultado del primero', async () => {
    const comandoId = randomUUID();
    const deA = randomUUID();
    const deB = randomUUID();
    await reclamar(bancoA, comandoId, deA);

    await expect(reclamar(bancoB, comandoId, deB)).resolves.toBeNull();
    expect(await filasDe(comandoId)).toEqual(
      [
        { banco_id: bancoA, entidad_id: deA, carga_hash_version: 1 },
        { banco_id: bancoB, entidad_id: deB, carga_hash_version: 1 },
      ].sort((x, y) => (x.banco_id < y.banco_id ? -1 : 1)),
    );

    const vistasPorB = await enBanco(
      bancoB,
      (tx) => tx.$queryRaw<{ banco_id: string; entidad_id: string }[]>`
        SELECT banco_id::text, entidad_id::text FROM core.comando_procesado
        WHERE comando_id = ${comandoId}::uuid`,
    );
    expect(vistasPorB).toEqual([{ banco_id: bancoB, entidad_id: deB }]);
  });

  it('sin contexto de banco no se lee nada ni se reclama', async () => {
    const comandoId = randomUUID();
    await reclamar(bancoA, comandoId, randomUUID());

    await expect(
      app.$queryRaw`SELECT * FROM core.comando_procesado WHERE comando_id = ${comandoId}::uuid`,
    ).resolves.toEqual([]);
    await expect(
      app.$queryRaw`SELECT * FROM core.reclamar_comando(
        ${randomUUID()}::uuid, 1::smallint, ${'0'.repeat(64)}, 'recepcion', ${randomUUID()}::uuid)`,
    ).rejects.toThrow(/contexto de banco/);
  });

  it('la API solo lee la tabla y escribe por la función; no puede insertar en otro banco', async () => {
    const [permisos] = await app.$queryRaw<
      {
        leer: boolean;
        insertar: boolean;
        actualizar: boolean;
        eliminar: boolean;
        truncar: boolean;
        ejecutar: boolean;
      }[]
    >`SELECT
      has_table_privilege(current_user, 'core.comando_procesado', 'SELECT') AS leer,
      has_table_privilege(current_user, 'core.comando_procesado', 'INSERT') AS insertar,
      has_table_privilege(current_user, 'core.comando_procesado', 'UPDATE') AS actualizar,
      has_table_privilege(current_user, 'core.comando_procesado', 'DELETE') AS eliminar,
      has_table_privilege(current_user, 'core.comando_procesado', 'TRUNCATE') AS truncar,
      has_function_privilege(current_user,
        'core.reclamar_comando(uuid,smallint,text,text,uuid)', 'EXECUTE') AS ejecutar`;
    expect(permisos).toEqual({
      leer: true,
      insertar: false,
      actualizar: false,
      eliminar: false,
      truncar: false,
      ejecutar: true,
    });

    // Desde el banco B, con el banco_id de A escrito a mano.
    await expect(
      enBanco(
        bancoB,
        (tx) => tx.$executeRaw`
          INSERT INTO core.comando_procesado
            (banco_id, comando_id, carga_hash_version, carga_hash, entidad, entidad_id)
          VALUES (${bancoA}::uuid, ${randomUUID()}::uuid, 1, ${'0'.repeat(64)}, 'recepcion',
                  ${randomUUID()}::uuid)`,
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('rechaza UPDATE, DELETE y TRUNCATE incluso al dueño de la tabla', async () => {
    const comandoId = randomUUID();
    await reclamar(bancoA, comandoId, randomUUID());

    // Si el trigger faltara, el throw final revierte el cambio.
    const comoDueno = (sql: string) =>
      admin.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(sql);
        throw new Error('la sentencia no fue rechazada');
      });
    const fila = `banco_id = '${bancoA}' AND comando_id = '${comandoId}'`;

    await expect(
      comoDueno(`UPDATE core.comando_procesado SET entidad = 'otra' WHERE ${fila}`),
    ).rejects.toThrow(/append-only/);
    await expect(comoDueno(`DELETE FROM core.comando_procesado WHERE ${fila}`)).rejects.toThrow(
      /append-only/,
    );
    await expect(comoDueno('TRUNCATE core.comando_procesado')).rejects.toThrow(/append-only/);
  });
});

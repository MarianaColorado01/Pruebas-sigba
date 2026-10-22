import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { PrecioActualizadoV1, RecepcionConfirmadaV1 } from '@sigba/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type EventoEntregado, executeTransactionWithTenant } from '../src/core/index.js';
import { IngresosConsumidor } from '../src/modules/analitica/events/ingresos.consumidor.js';
import { IngresosPrismaRepositorio } from '../src/modules/analitica/repositories/ingresos.prisma.repositorio.js';
import { urlComoRolApp } from './rol-de-aplicacion.js';

/**
 * Modelo de lectura de ingresos contra PostgreSQL, como sigba_app (SBA-50).
 *
 * Llama al consumidor como lo haría el despachador: en una transacción con el
 * banco del evento. No pasa por el despachador real porque reclamaría los
 * eventos que otros archivos emiten en la misma base; sus garantías se prueban
 * en despachador.integracion.spec.ts.
 */

const URL_ADMIN = process.env['DATABASE_URL'];

if (process.env['CI'] && !URL_ADMIN) {
  throw new Error('Falta DATABASE_URL en CI para probar el modelo de ingresos y su RLS.');
}

describe.skipIf(!URL_ADMIN)('Modelo de lectura de ingresos contra PostgreSQL (SBA-50)', () => {
  let admin: PrismaClient;
  let app: PrismaClient;
  const consumidor = new IngresosConsumidor(new IngresosPrismaRepositorio());

  const bancoA = randomUUID();
  const bancoB = randomUUID();

  function entregar(bancoId: string, evento: RecepcionConfirmadaV1 | PrecioActualizadoV1) {
    const entregado: EventoEntregado = {
      ...evento,
      id: randomUUID(),
      bancoId,
      ocurridoEn: new Date('2026-10-31T23:30:00-05:00'),
    };
    return executeTransactionWithTenant(app, (tx) => consumidor.procesar(entregado, tx), {
      bancoId,
      actor: 'sistema:despachador',
    });
  }

  function recepcion(lotes: { loteId: string; importe: string | null }[]): RecepcionConfirmadaV1 {
    return {
      tipo: 'RecepcionConfirmada',
      version: 1,
      payload: {
        recepcionId: randomUUID(),
        bodegaId: randomUUID(),
        donanteId: randomUUID(),
        origen: 'propia',
        detalles: lotes.map(({ loteId, importe }) => ({
          referenciaId: randomUUID(),
          categoriaId: randomUUID(),
          loteId,
          cantidad: 4,
          kilos: 2,
          valorUnitario: importe && '2800.00',
          importe,
        })),
      },
    };
  }

  function precio(lotes: string[], valor = '2800.00'): PrecioActualizadoV1 {
    return {
      tipo: 'PrecioActualizado',
      version: 1,
      payload: {
        precioId: randomUUID(),
        referenciaId: randomUUID(),
        valor,
        moneda: 'COP',
        vigenteDesde: '2026-10-01',
        valoraciones: lotes.map((loteId) => ({ loteId, valorUnitario: valor, importe: '11200' })),
      },
    };
  }

  type FilaLeida = { lote_id: string; mes: string; cantidad: string; importe: string | null };

  async function ingresos(bancoId: string) {
    return executeTransactionWithTenant<FilaLeida[]>(
      app,
      (tx) => tx.$queryRaw<
        FilaLeida[]
      >`SELECT lote_id::text, mes::text, cantidad::text, importe::text
        FROM analitica.ingreso ORDER BY lote_id`,
      { bancoId },
    );
  }

  beforeAll(() => {
    admin = new PrismaClient({ datasourceUrl: URL_ADMIN });
    app = new PrismaClient({ datasourceUrl: urlComoRolApp(URL_ADMIN as string) });
  });

  afterAll(async () => {
    if (admin) {
      await admin.$executeRaw`
        DELETE FROM analitica.ingreso WHERE banco_id IN (${bancoA}::uuid, ${bancoB}::uuid)`;
      await admin.$disconnect();
    }
    if (app) await app.$disconnect();
  });

  it('la recepción deja una fila por lote en el mes de Colombia, con lo pendiente en null', async () => {
    const [valorado, pendiente] = [randomUUID(), randomUUID()].sort();
    await entregar(
      bancoA,
      recepcion([
        { loteId: valorado as string, importe: '11200.00000' },
        { loteId: pendiente as string, importe: null },
      ]),
    );

    // 23:30 del 31 de octubre en Pereira: ya es noviembre en UTC.
    expect(await ingresos(bancoA)).toEqual([
      { lote_id: valorado, mes: '2026-10-01', cantidad: '4.000', importe: '11200.00000' },
      { lote_id: pendiente, mes: '2026-10-01', cantidad: '4.000', importe: null },
    ]);
  });

  it('el precio valora lo pendiente una vez y no toca lo que ya tenía valor', async () => {
    const [lote, yaValorado] = [randomUUID(), randomUUID()];
    await entregar(bancoB, recepcion([{ loteId: yaValorado, importe: '5.00000' }]));
    await entregar(bancoB, recepcion([{ loteId: lote, importe: null }]));

    await entregar(bancoB, precio([lote, yaValorado]));
    await entregar(bancoB, precio([lote], '9999.00'));

    const filas = await ingresos(bancoB);
    expect(filas.find((f) => f.lote_id === lote)?.importe).toBe('11200.00000');
    expect(filas.find((f) => f.lote_id === yaValorado)?.importe).toBe('5.00000');
    await admin.$executeRaw`DELETE FROM analitica.ingreso WHERE banco_id = ${bancoB}::uuid`;
  });

  it('un precio que llega antes que su recepción falla y no escribe nada, para reintentarse', async () => {
    const lote = randomUUID();

    await expect(entregar(bancoB, precio([lote]))).rejects.toThrow(/aún no están/);
    await entregar(bancoB, recepcion([{ loteId: lote, importe: null }]));
    await entregar(bancoB, precio([lote]));

    expect(await ingresos(bancoB)).toEqual([
      { lote_id: lote, mes: '2026-10-01', cantidad: '4.000', importe: '11200.00000' },
    ]);
    await admin.$executeRaw`DELETE FROM analitica.ingreso WHERE banco_id = ${bancoB}::uuid`;
  });

  describe('aislamiento entre bancos (ADR-07)', () => {
    it('el banco B no ve los ingresos del banco A', async () => {
      await entregar(bancoA, recepcion([{ loteId: randomUUID(), importe: null }]));

      expect((await ingresos(bancoA)).length).toBeGreaterThan(0);
      expect(await ingresos(bancoB)).toEqual([]);
    });

    it('con el contexto del banco B, un INSERT con el banco_id de A falla por la política', async () => {
      await expect(
        executeTransactionWithTenant(
          app,
          (tx) => tx.$executeRaw`
            INSERT INTO analitica.ingreso (
              banco_id, lote_id, recepcion_id, mes, donante_id, origen, bodega_id,
              categoria_id, referencia_id, cantidad, kilos
            ) VALUES (
              ${bancoA}::uuid, gen_random_uuid(), gen_random_uuid(), '2026-10-01',
              gen_random_uuid(), 'propia', gen_random_uuid(), gen_random_uuid(),
              gen_random_uuid(), 1, 1
            )`,
          { bancoId: bancoB },
        ),
      ).rejects.toThrow(/row-level security/);
    });

    it('la API no borra ingresos ni cambia otra columna que la valoración', async () => {
      const [permisos] = await app.$queryRaw<
        { eliminar: boolean; cambiar_cantidad: boolean; cambiar_importe: boolean }[]
      >`SELECT
        has_table_privilege(current_user, 'analitica.ingreso', 'DELETE') AS eliminar,
        has_column_privilege(current_user, 'analitica.ingreso', 'cantidad', 'UPDATE') AS cambiar_cantidad,
        has_column_privilege(current_user, 'analitica.ingreso', 'importe', 'UPDATE') AS cambiar_importe`;

      expect(permisos).toEqual({ eliminar: false, cambiar_cantidad: false, cambiar_importe: true });
    });
  });
});

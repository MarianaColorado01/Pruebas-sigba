import { randomUUID } from 'node:crypto';
import { type Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type ConsumidorDeEventos,
  DespachadorDeEventos,
  type EventoEntregado,
  executeTransactionWithTenant,
  OutboxService,
  type PrismaService,
} from '../src/core/index.js';
import { TOPE_DE_INTENTOS } from '../src/core/outbox/despachador.service.js';
import { urlComoRolApp } from './rol-de-aplicacion.js';

const URL_ADMIN = process.env['DATABASE_URL'];

if (process.env['CI'] && !URL_ADMIN) {
  throw new Error('Falta DATABASE_URL en CI para probar el despachador y su RLS.');
}

describe.skipIf(!URL_ADMIN)('Despachador del outbox contra PostgreSQL (SBA-49)', () => {
  let admin: PrismaClient;
  let app: PrismaClient;

  const bancoA = randomUUID();
  const bancoB = randomUUID();
  const outbox = new OutboxService();

  /**
   * Cada prueba usa un tipo propio: otros archivos emiten eventos en la misma
   * base, y el despachador solo reclama los tipos que sus consumidores escuchan.
   */
  function tipoNuevo(): string {
    return `PruebaDespachador.${randomUUID()}`;
  }

  function enBanco<R>(
    bancoId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<R>,
  ): Promise<R> {
    return executeTransactionWithTenant<R>(app, fn, { bancoId, actor: 'despachador-integracion' });
  }

  function emitir(bancoId: string, tipo: string): Promise<string> {
    return enBanco(bancoId, (tx) =>
      outbox.emitir(tx, { tipo, version: 1, payload: { referenciaId: randomUUID() } }),
    );
  }

  function despachador(...consumidores: ConsumidorDeEventos[]): DespachadorDeEventos {
    const d = new DespachadorDeEventos(app as unknown as PrismaService);
    for (const c of consumidores) d.suscribir(c);
    return d;
  }

  /** Anota lo que procesa y el banco que ve en `app.banco_id`. */
  function consumidor(tipo: string, opciones: { falla?: () => boolean } = {}) {
    const vistos: { eventoId: string; bancoEnContexto: string }[] = [];
    const c: ConsumidorDeEventos = {
      nombre: `prueba-${randomUUID()}`,
      tipos: [tipo],
      async procesar(evento: EventoEntregado, tx) {
        const [fila] = await tx.$queryRaw<{ banco: string }[]>`
          SELECT current_setting('app.banco_id', true) AS banco`;
        if (opciones.falla?.()) throw new Error('consumidor caído');
        vistos.push({ eventoId: evento.id, bancoEnContexto: fila?.banco ?? '' });
      },
    };
    return { c, vistos };
  }

  async function estado(eventoId: string) {
    const [fila] = await admin.$queryRaw<
      { publicado: boolean; intentos: number; espera_vigente: boolean }[]
    >`SELECT publicado_en IS NOT NULL AS publicado, intentos,
        coalesce(siguiente_intento_en > now(), false) AS espera_vigente
      FROM core.outbox WHERE id = ${eventoId}::uuid`;
    return fila;
  }

  async function acuses(eventoId: string): Promise<string[]> {
    const filas = await admin.$queryRaw<{ consumidor: string }[]>`
      SELECT consumidor FROM core.evento_consumido
      WHERE evento_id = ${eventoId}::uuid ORDER BY consumidor`;
    return filas.map((f) => f.consumidor);
  }

  /** Lo que haría el paso del tiempo: el retroceso o el lease ya vencieron. */
  async function vencerEspera(eventoId: string): Promise<void> {
    await admin.$executeRaw`
      UPDATE core.outbox SET siguiente_intento_en = now() - interval '1 second'
      WHERE id = ${eventoId}::uuid`;
  }

  beforeAll(() => {
    admin = new PrismaClient({ datasourceUrl: URL_ADMIN });
    app = new PrismaClient({ datasourceUrl: urlComoRolApp(URL_ADMIN as string) });
  });

  afterAll(async () => {
    if (admin) {
      await admin.$executeRaw`
        DELETE FROM core.evento_consumido WHERE banco_id IN (${bancoA}::uuid, ${bancoB}::uuid)`;
      await admin.$executeRaw`
        DELETE FROM core.outbox WHERE banco_id IN (${bancoA}::uuid, ${bancoB}::uuid)`;
      await admin.$disconnect();
    }
    if (app) await app.$disconnect();
  });

  it('entrega a cada consumidor con el banco del evento en el contexto y lo publica', async () => {
    const tipo = tipoNuevo();
    const uno = consumidor(tipo);
    const dos = consumidor(tipo);
    const eventoA = await emitir(bancoA, tipo);
    const eventoB = await emitir(bancoB, tipo);

    await expect(despachador(uno.c, dos.c).despachar()).resolves.toBe(2);

    for (const { vistos } of [uno, dos]) {
      expect(vistos).toEqual([
        { eventoId: eventoA, bancoEnContexto: bancoA },
        { eventoId: eventoB, bancoEnContexto: bancoB },
      ]);
    }
    expect(await estado(eventoA)).toEqual({ publicado: true, intentos: 1, espera_vigente: false });
    expect(await acuses(eventoA)).toEqual([uno.c.nombre, dos.c.nombre].sort());
  });

  it('un evento entregado dos veces al mismo consumidor se procesa una sola vez', async () => {
    const tipo = tipoNuevo();
    const { c, vistos } = consumidor(tipo);
    const evento = await emitir(bancoA, tipo);
    await despachador(c).despachar();

    // Como si la réplica hubiera muerto tras el acuse y antes de publicar.
    await admin.$executeRaw`
      UPDATE core.outbox SET publicado_en = NULL, siguiente_intento_en = NULL
      WHERE id = ${evento}::uuid`;
    await expect(despachador(c).despachar()).resolves.toBe(1);

    expect(vistos).toHaveLength(1);
    expect((await estado(evento))?.publicado).toBe(true);
  });

  it('un consumidor caído reintenta con retroceso sin rebobinar a los demás', async () => {
    const tipo = tipoNuevo();
    let caido = true;
    const sano = consumidor(tipo);
    const fragil = consumidor(tipo, { falla: () => caido });
    const evento = await emitir(bancoA, tipo);
    const d = despachador(sano.c, fragil.c);

    await d.despachar();
    expect(await estado(evento)).toEqual({ publicado: false, intentos: 1, espera_vigente: true });
    // El acuse del que falló revirtió con su transacción.
    expect(await acuses(evento)).toEqual([sano.c.nombre]);
    // Durante el retroceso no se vuelve a reclamar.
    await expect(d.despachar()).resolves.toBe(0);

    caido = false;
    await vencerEspera(evento);
    await d.despachar();

    expect(sano.vistos).toHaveLength(1);
    expect(fragil.vistos).toHaveLength(1);
    expect(await estado(evento)).toEqual({ publicado: true, intentos: 2, espera_vigente: false });
  });

  it('dos réplicas a la vez no entregan el mismo evento dos veces', async () => {
    const tipo = tipoNuevo();
    const { c, vistos } = consumidor(tipo);
    const eventos = await Promise.all(Array.from({ length: 8 }, () => emitir(bancoA, tipo)));

    const tomados = await Promise.all([despachador(c).despachar(), despachador(c).despachar()]);

    expect(tomados[0] + tomados[1]).toBe(eventos.length);
    expect(vistos.map((v) => v.eventoId).sort()).toEqual([...eventos].sort());
  });

  it('tras el tope de intentos el evento queda en la cola muerta, visible y sin reclamar', async () => {
    const tipo = tipoNuevo();
    const { c } = consumidor(tipo, { falla: () => true });
    const evento = await emitir(bancoA, tipo);
    const d = despachador(c);

    for (let i = 0; i < TOPE_DE_INTENTOS; i++) {
      await d.despachar();
      await vencerEspera(evento);
    }
    await expect(d.despachar()).resolves.toBe(0);

    const [muertos] = await admin.$queryRaw<{ cantidad: number }[]>`
      SELECT count(*)::int AS cantidad FROM core.outbox
      WHERE tipo = ${tipo} AND publicado_en IS NULL AND intentos >= ${TOPE_DE_INTENTOS}`;
    expect(muertos?.cantidad).toBe(1);
  });

  it('un evento que tumba el proceso en cada reclamo también termina en la cola muerta', async () => {
    const tipo = tipoNuevo();
    const evento = await emitir(bancoA, tipo);

    // Reclamar y morir antes de acusar, publicar o posponer: solo vence el lease.
    for (let i = 0; i < TOPE_DE_INTENTOS; i++) {
      const reclamados = await app.$queryRaw<{ id: string }[]>`
        SELECT id::text FROM core.reclamar_eventos(ARRAY[${tipo}]::text[], 10, ${TOPE_DE_INTENTOS}::int, 60)`;
      expect(reclamados).toEqual([{ id: evento }]);
      await vencerEspera(evento);
    }

    const { c, vistos } = consumidor(tipo);
    await expect(despachador(c).despachar()).resolves.toBe(0);
    expect(vistos).toEqual([]);
    expect(await estado(evento)).toEqual({
      publicado: false,
      intentos: TOPE_DE_INTENTOS,
      espera_vigente: false,
    });
  });

  it('reclamar rechaza un lote o un lease desmedidos', async () => {
    const reclamar = (limite: number, lease: number) =>
      app.$queryRaw`SELECT * FROM core.reclamar_eventos(ARRAY['x']::text[], ${limite}::int, 10, ${lease}::int)`;

    await expect(reclamar(501, 60)).rejects.toThrow(/de 1 a 500/);
    await expect(reclamar(50, 301)).rejects.toThrow(/de 1 a 300 segundos/);
    await expect(reclamar(500, 300)).resolves.toEqual([]);
  });

  it('un tipo sin consumidor se queda pendiente en el outbox', async () => {
    const evento = await emitir(bancoA, tipoNuevo());
    const { c } = consumidor(tipoNuevo());

    await despachador(c).despachar();

    expect(await estado(evento)).toEqual({ publicado: false, intentos: 0, espera_vigente: false });
  });

  describe('aislamiento entre bancos (ADR-07)', () => {
    it('el banco B no ve los acuses del banco A', async () => {
      const tipo = tipoNuevo();
      const { c } = consumidor(tipo);
      const evento = await emitir(bancoA, tipo);
      await despachador(c).despachar();

      const visto = (bancoId: string) =>
        enBanco(
          bancoId,
          (tx) => tx.$queryRaw<{ consumidor: string }[]>`
            SELECT consumidor FROM core.evento_consumido WHERE evento_id = ${evento}::uuid`,
        );
      expect(await visto(bancoA)).toEqual([{ consumidor: c.nombre }]);
      expect(await visto(bancoB)).toEqual([]);
    });

    it('no se acusa ni se publica un evento de otro banco', async () => {
      const evento = await emitir(bancoA, tipoNuevo());

      await expect(
        enBanco(bancoB, (tx) => tx.$queryRaw`SELECT core.reclamar_entrega(${evento}::uuid, 'x')`),
      ).rejects.toThrow(/no existe en el banco del contexto/);
      await enBanco(bancoB, (tx) => tx.$executeRaw`SELECT core.publicar_evento(${evento}::uuid)`);
      await enBanco(
        bancoB,
        (tx) => tx.$executeRaw`SELECT core.posponer_evento(${evento}::uuid, 0)`,
      );

      expect(await estado(evento)).toEqual({
        publicado: false,
        intentos: 0,
        espera_vigente: false,
      });
    });

    it('la API solo lee los acuses; las funciones son la única vía de escritura', async () => {
      const [permisos] = await app.$queryRaw<
        { leer: boolean; insertar: boolean; actualizar: boolean; eliminar: boolean }[]
      >`SELECT
        has_table_privilege(current_user, 'core.evento_consumido', 'SELECT') AS leer,
        has_table_privilege(current_user, 'core.evento_consumido', 'INSERT') AS insertar,
        has_table_privilege(current_user, 'core.evento_consumido', 'UPDATE') AS actualizar,
        has_table_privilege(current_user, 'core.evento_consumido', 'DELETE') AS eliminar`;

      expect(permisos).toEqual({ leer: true, insertar: false, actualizar: false, eliminar: false });
    });
  });
});

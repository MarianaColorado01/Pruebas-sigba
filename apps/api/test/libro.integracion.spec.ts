import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { type Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AuditService,
  executeTransactionWithTenant,
  IdempotenciaService,
  type PrismaService,
  runWithTenantContext,
} from '../src/core/index.js';
import { DonantesPrismaRepositorio } from '../src/modules/inventario/repositories/donantes.prisma.repositorio.js';
import { escribirEnLibro } from '../src/modules/inventario/repositories/libro.js';
import { RecepcionesPrismaRepositorio } from '../src/modules/inventario/repositories/recepciones.prisma.repositorio.js';
import { ReferenciasPrismaRepositorio } from '../src/modules/inventario/repositories/referencias.prisma.repositorio.js';
import { DonantesService } from '../src/modules/inventario/services/donantes.service.js';
import { RecepcionesService } from '../src/modules/inventario/services/recepciones.service.js';
import { ReferenciasService } from '../src/modules/inventario/services/referencias.service.js';
import { BodegasPrismaRepositorio } from '../src/modules/plataforma/repositories/bodegas.prisma.repositorio.js';
import { BodegasService } from '../src/modules/plataforma/services/bodegas.service.js';
import { urlComoRolApp } from './rol-de-aplicacion.js';

/**
 * Libro de movimientos y saldo derivado contra PostgreSQL (SBA-35, ADR-08).
 *
 * Conectado como `sigba_app`: las entradas llegan por la recepción real y las
 * salidas, bajas, ajustes y traslados por `escribirEnLibro`, que es lo que
 * usarán sus flujos (SBA-38, SBA-42, SBA-57). Prueba que el saldo sigue al
 * libro en la misma transacción, que nunca queda negativo aunque dos salidas
 * lleguen a la vez, que recalcularlo desde el libro da lo mismo, y que ni el
 * libro ni el saldo se editan a mano.
 */

const URL_ADMIN = process.env['DATABASE_URL'];

if (process.env['CI'] && !URL_ADMIN) {
  throw new Error(
    'DATABASE_URL no está definida en CI. La prueba de aislamiento no es opcional (RNF-01).',
  );
}

const ACTOR = 'operario-prueba';

type Tipo = Prisma.MovimientoCreateManyInput['tipo'];

describe.skipIf(!URL_ADMIN)('Libro de movimientos y saldo contra PostgreSQL (SBA-35)', () => {
  let admin: PrismaClient;
  let app: PrismaClient;
  let recepciones: RecepcionesService;
  let donantes: DonantesService;
  let catalogo: ReferenciasService;

  const bancoA = 'aaaaaaaa-3535-4353-8353-aaaaaaaaaaaa';
  const bancoB = 'bbbbbbbb-3535-4353-8353-bbbbbbbbbbbb';
  const red = 'ffffffff-3535-4353-8353-ffffffffffff';
  const bodega = 'cccccccc-3535-4353-8353-cccccccccccc';
  const otraBodega = 'dddddddd-3535-4353-8353-dddddddddddd';

  function enBanco<R>(bancoId: string, fn: () => Promise<R>): Promise<R> {
    return runWithTenantContext({ bancoId, actor: ACTOR }, fn) as Promise<R>;
  }

  /** Una transacción de tenant como sigba_app, como la abre cualquier adaptador. */
  function enTransaccion<R>(
    bancoId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<R>,
  ): Promise<R> {
    return enBanco(bancoId, () => executeTransactionWithTenant<R>(app, fn));
  }

  /** Un movimiento de un lote de «1 kg»: los kilos son la cantidad. */
  function movimiento(
    tipo: Tipo,
    lote: { loteId: string; referenciaId: string },
    cantidad: number,
    bodegaId = bodega,
  ): Prisma.MovimientoCreateManyInput {
    return {
      id: randomUUID(),
      bancoId: bancoA,
      comandoId: randomUUID(),
      tipo,
      referenciaId: lote.referenciaId,
      loteId: lote.loteId,
      bodegaId,
      cantidad,
      kilos: cantidad,
      creadoPor: ACTOR,
    };
  }

  function escribir(...movimientos: Prisma.MovimientoCreateManyInput[]) {
    return enTransaccion(bancoA, (tx) => escribirEnLibro(tx, movimientos));
  }

  async function saldoDe(loteId: string, bodegaId = bodega) {
    const fila = await admin.saldo.findUnique({
      where: { bancoId_bodegaId_loteId: { bancoId: bancoA, bodegaId, loteId } },
    });
    return fila ? Number(fila.cantidad) : null;
  }

  /** Recibe el kilo de arroz en la cantidad pedida y devuelve su lote. */
  async function recibir(cantidad: number, referenciaId: string, donanteId: string) {
    const { recepcion } = await enBanco(bancoA, () =>
      recepciones.registrar({
        comandoId: randomUUID(),
        donanteId,
        origen: 'propia',
        bodegaId: bodega,
        detalles: [
          { movimientoId: randomUUID(), referenciaId, cantidad, vencimiento: '2027-03-31' },
        ],
      }),
    );
    const [detalle] = recepcion.detalles;
    if (!detalle) throw new Error('La recepción no devolvió su detalle.');
    return { loteId: detalle.loteId, referenciaId: detalle.referenciaId };
  }

  let kilo: string;
  let donante: string;

  async function limpiar(): Promise<void> {
    // El libro rechaza DELETE con un trigger; el administrador lo apaga solo
    // para esta transacción. session_replication_role exige superusuario.
    const enBancos = `banco_id IN ('${bancoA}', '${bancoB}')`;
    const tablas = [
      'saldo',
      'recepcion_detalle',
      'movimiento',
      'lote',
      'recepcion',
      'referencia',
      'producto',
      'categoria',
      'donante',
    ];
    await admin.$transaction([
      admin.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`),
      ...tablas.map((tabla) =>
        admin.$executeRawUnsafe(`DELETE FROM inventario.${tabla} WHERE ${enBancos}`),
      ),
      admin.$executeRawUnsafe(`DELETE FROM core.comando_procesado WHERE ${enBancos}`),
    ]);
  }

  async function borrarBancos(): Promise<void> {
    await admin.$executeRaw`DELETE FROM plataforma.bodega WHERE banco_id IN (${bancoA}::uuid, ${bancoB}::uuid)`;
    await admin.$executeRaw`DELETE FROM plataforma.banco WHERE id IN (${bancoA}::uuid, ${bancoB}::uuid)`;
    await admin.$executeRaw`DELETE FROM plataforma.red WHERE id = ${red}::uuid`;
  }

  beforeAll(async () => {
    admin = new PrismaClient({ datasourceUrl: URL_ADMIN });
    await limpiar();
    await borrarBancos();
    await admin.$executeRaw`INSERT INTO plataforma.red (id, nombre) VALUES (${red}::uuid, 'Red del libro')`;
    await admin.$executeRaw`
      INSERT INTO plataforma.banco (id, red_id, nombre, codigo)
      VALUES (${bancoA}::uuid, ${red}::uuid, 'Banco A', 'LIB-A'),
             (${bancoB}::uuid, ${red}::uuid, 'Banco B', 'LIB-B')`;
    await admin.$executeRaw`
      INSERT INTO plataforma.bodega (id, banco_id, nombre, activa)
      VALUES (${bodega}::uuid, ${bancoA}::uuid, 'Santa Isabel', true),
             (${otraBodega}::uuid, ${bancoA}::uuid, 'Cuba', true)`;
    app = new PrismaClient({ datasourceUrl: urlComoRolApp(URL_ADMIN as string) });
    // PrismaService es un PrismaClient; aquí va uno conectado con el rol de la app.
    const prisma = app as PrismaService;
    const auditoria = new AuditService();
    catalogo = new ReferenciasService(
      new ReferenciasPrismaRepositorio(prisma, auditoria, new IdempotenciaService()),
    );
    donantes = new DonantesService(new DonantesPrismaRepositorio(prisma, auditoria));
    recepciones = new RecepcionesService(
      new RecepcionesPrismaRepositorio(prisma, new IdempotenciaService(), auditoria),
      donantes,
      new BodegasService(new BodegasPrismaRepositorio(prisma, auditoria)),
      catalogo,
    );
  });

  beforeEach(async () => {
    await limpiar();
    ({ kilo, donante } = await enBanco(bancoA, async () => {
      const { id: donanteId } = await donantes.crear({
        nombre: 'Supermercado La 14',
        tipo: 'empresa',
      });
      const categoria = await catalogo.crearCategoria({ codigo: 'C801', nombre: 'Arroz' });
      const producto = await catalogo.crearProducto({ categoriaId: categoria.id, nombre: 'Arroz' });
      const referencia = await catalogo.crearReferencia({
        productoId: producto.id,
        presentacion: '1 kg',
        equivalenciaKg: '1',
      });
      return { kilo: referencia.id, donante: donanteId };
    }));
  });

  afterAll(async () => {
    if (admin) {
      await limpiar();
      await borrarBancos();
      await admin.$disconnect();
    }
    if (app) await app.$disconnect();
  });

  it('la recepción deja el saldo del lote en la misma transacción', async () => {
    const lote = await recibir(10, kilo, donante);

    expect(await saldoDe(lote.loteId)).toBe(10);
  });

  it('una salida baja el saldo del lote', async () => {
    const lote = await recibir(10, kilo, donante);

    await escribir(movimiento('salida', lote, -4));

    expect(await saldoDe(lote.loteId)).toBe(6);
  });

  it('una salida mayor que el saldo responde 409 y no deja el movimiento', async () => {
    const lote = await recibir(10, kilo, donante);

    await expect(escribir(movimiento('salida', lote, -11))).rejects.toThrow(ConflictException);
    await expect(escribir(movimiento('salida', lote, -11))).rejects.toThrow(
      'No hay saldo suficiente en ese lote y bodega.',
    );

    expect(await saldoDe(lote.loteId)).toBe(10);
    expect(await admin.movimiento.count({ where: { bancoId: bancoA, tipo: 'salida' } })).toBe(0);
  });

  it('dos salidas a la vez con saldo para una sola: una pasa, la otra recibe 409 y el saldo no queda negativo', async () => {
    const lote = await recibir(10, kilo, donante);

    // La primera retiene el bloqueo del lote un momento; la segunda llega
    // mientras tanto y tiene que esperar a que la primera confirme.
    const primera = enTransaccion(bancoA, async (tx) => {
      await escribirEnLibro(tx, [movimiento('salida', lote, -6)]);
      await tx.$executeRaw`SELECT pg_sleep(0.3)`;
    });
    await new Promise((listo) => setTimeout(listo, 100));
    const segunda = escribir(movimiento('salida', lote, -6));

    const [r1, r2] = await Promise.allSettled([primera, segunda]);

    expect(r1.status).toBe('fulfilled');
    expect(r2.status).toBe('rejected');
    expect(r2.status === 'rejected' && r2.reason).toBeInstanceOf(ConflictException);
    expect(await saldoDe(lote.loteId)).toBe(4);
    expect(await admin.movimiento.count({ where: { bancoId: bancoA, tipo: 'salida' } })).toBe(1);
  });

  it('un traslado resta en la bodega de origen y suma en la de destino', async () => {
    const lote = await recibir(10, kilo, donante);
    const comandoId = randomUUID();

    await escribir(
      { ...movimiento('traslado', lote, -3), comandoId },
      { ...movimiento('traslado', lote, 3, otraBodega), comandoId },
    );

    expect(await saldoDe(lote.loteId)).toBe(7);
    expect(await saldoDe(lote.loteId, otraBodega)).toBe(3);
  });

  it('el signo de la cantidad lo exige la base según el tipo', async () => {
    const lote = await recibir(10, kilo, donante);
    const conRechazo = (mov: Prisma.MovimientoCreateManyInput) =>
      expect(escribir(mov)).rejects.toThrow(/movimiento_signo_segun_tipo/);

    await conRechazo(movimiento('entrada', lote, -1));
    await conRechazo(movimiento('salida', lote, 1));
    await conRechazo(movimiento('baja', lote, 1));
    await conRechazo(movimiento('ajuste', lote, 0));
    await conRechazo({ ...movimiento('ajuste', lote, 2), kilos: -2 });

    expect(await saldoDe(lote.loteId)).toBe(10);
  });

  it('un movimiento cuyos kilos no son sus unidades por la equivalencia del lote se rechaza', async () => {
    const lote = await recibir(10, kilo, donante);

    await expect(escribir({ ...movimiento('salida', lote, -2), kilos: -3 })).rejects.toThrow(
      /movimiento_kilos_segun_lote/,
    );

    expect(await saldoDe(lote.loteId)).toBe(10);
  });

  it('si el catálogo corrige la equivalencia, el lote ya recibido sigue pesando con la suya', async () => {
    const viejo = await recibir(10, kilo, donante);
    await enBanco(bancoA, () => catalogo.editarReferencia(kilo, { equivalenciaKg: '1.5' }));
    const nuevo = await recibir(10, kilo, donante);

    // La salida del lote viejo pesa con 1 kg por unidad, no con 1,5.
    await escribir(movimiento('salida', viejo, -4));
    await expect(escribir({ ...movimiento('salida', viejo, -1), kilos: -1.5 })).rejects.toThrow(
      /movimiento_kilos_segun_lote/,
    );

    const saldos = await admin.saldo.findMany({
      where: { bancoId: bancoA, loteId: { in: [viejo.loteId, nuevo.loteId] } },
      include: { lote: { select: { equivalenciaKg: true } } },
    });
    const pesos = Object.fromEntries(
      saldos.map((s) => [
        s.loteId,
        [Number(s.cantidad), Number(s.kilos), Number(s.lote.equivalenciaKg)],
      ]),
    );
    expect(pesos[viejo.loteId]).toEqual([6, 6, 1]);
    expect(pesos[nuevo.loteId]).toEqual([10, 15, 1.5]);
  });

  it('recalcular el saldo desde el libro da lo mismo que la tabla de saldos', async () => {
    const arroz = await recibir(20, kilo, donante);
    const otroArroz = await recibir(5, kilo, donante);
    await escribir(movimiento('salida', arroz, -7));
    await escribir(movimiento('baja', arroz, -2));
    await escribir(movimiento('ajuste', otroArroz, 1.5));
    await escribir(movimiento('ajuste', otroArroz, -0.5));
    const comandoId = randomUUID();
    await escribir(
      { ...movimiento('traslado', arroz, -4), comandoId },
      { ...movimiento('traslado', arroz, 4, otraBodega), comandoId },
    );

    // Lo que no coincide entre la tabla y la suma del libro, en cualquier sentido.
    const diferencias = await admin.$queryRaw<unknown[]>`
      WITH libro AS (
        SELECT banco_id, bodega_id, lote_id, sum(cantidad) AS cantidad, sum(kilos) AS kilos
        FROM inventario.movimiento
        WHERE banco_id = ${bancoA}::uuid
        GROUP BY banco_id, bodega_id, lote_id
      )
      SELECT *
      FROM libro FULL JOIN (SELECT * FROM inventario.saldo WHERE banco_id = ${bancoA}::uuid) s
        USING (banco_id, bodega_id, lote_id)
      WHERE libro.cantidad IS DISTINCT FROM s.cantidad OR libro.kilos IS DISTINCT FROM s.kilos`;

    expect(diferencias).toEqual([]);
    expect(await saldoDe(arroz.loteId)).toBe(7);
    expect(await saldoDe(arroz.loteId, otraBodega)).toBe(4);
    expect(await saldoDe(otroArroz.loteId)).toBe(6);
  });

  describe('nada se edita a mano (ADR-08)', () => {
    /** SQL crudo como sigba_app, con el banco fijado en la transacción. */
    function comoApp(sql: string) {
      return app.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.banco_id', ${bancoA}, true)`;
        return tx.$executeRawUnsafe(sql);
      });
    }

    it('un movimiento escrito no se modifica ni se borra', async () => {
      await recibir(10, kilo, donante);

      await expect(comoApp('UPDATE inventario.movimiento SET cantidad = 99')).rejects.toThrow(
        /permission denied/,
      );
      await expect(comoApp('DELETE FROM inventario.movimiento')).rejects.toThrow(
        /permission denied/,
      );
      await expect(
        admin.$executeRawUnsafe(
          `UPDATE inventario.movimiento SET cantidad = 99 WHERE banco_id = '${bancoA}'`,
        ),
      ).rejects.toThrow(/append-only/);
    });

    it('la API no escribe el saldo: solo el trigger del libro', async () => {
      const lote = await recibir(10, kilo, donante);

      await expect(comoApp('UPDATE inventario.saldo SET cantidad = 99')).rejects.toThrow(
        /permission denied/,
      );
      await expect(
        comoApp(
          `INSERT INTO inventario.saldo (banco_id, bodega_id, lote_id, referencia_id, cantidad, kilos)
           VALUES ('${bancoA}', '${otraBodega}', '${lote.loteId}', '${lote.referenciaId}', 50, 50)`,
        ),
      ).rejects.toThrow(/permission denied/);
      expect(await saldoDe(lote.loteId)).toBe(10);
    });
  });

  describe('aislamiento entre bancos (ADR-07)', () => {
    it('saldo tiene RLS activo y forzado', async () => {
      const [fila] = await admin.$queryRaw<{ rls: boolean; forzado: boolean }[]>`
        SELECT relrowsecurity AS rls, relforcerowsecurity AS forzado
        FROM pg_class WHERE oid = 'inventario.saldo'::regclass`;

      expect(fila).toEqual({ rls: true, forzado: true });
    });

    it('el banco B no ve el saldo del banco A', async () => {
      await recibir(10, kilo, donante);

      const visto = await enTransaccion(bancoB, (tx) => tx.saldo.count());

      expect(visto).toBe(0);
    });

    it('el banco B no mueve el lote del banco A', async () => {
      const lote = await recibir(10, kilo, donante);

      await expect(
        enTransaccion(bancoB, (tx) =>
          escribirEnLibro(tx, [{ ...movimiento('salida', lote, -1), bancoId: bancoB }]),
        ),
      ).rejects.toThrow();
      expect(await saldoDe(lote.loteId)).toBe(10);
    });
  });
});

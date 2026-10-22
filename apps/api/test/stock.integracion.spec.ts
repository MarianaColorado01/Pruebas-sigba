import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { StockPrismaRepositorio } from '../src/modules/inventario/repositories/stock.prisma.repositorio.js';
import { DonantesService } from '../src/modules/inventario/services/donantes.service.js';
import { RecepcionesService } from '../src/modules/inventario/services/recepciones.service.js';
import { ReferenciasService } from '../src/modules/inventario/services/referencias.service.js';
import { StockService } from '../src/modules/inventario/services/stock.service.js';
import { BodegasPrismaRepositorio } from '../src/modules/plataforma/repositories/bodegas.prisma.repositorio.js';
import { BodegasService } from '../src/modules/plataforma/services/bodegas.service.js';
import { ParametrosPrismaRepositorio } from '../src/modules/plataforma/repositories/parametros.prisma.repositorio.js';
import { ParametrosService } from '../src/modules/plataforma/services/parametros.service.js';
import { urlComoRolApp } from './rol-de-aplicacion.js';

/**
 * Consulta de stock contra PostgreSQL (SBA-36).
 *
 * Conectado como `sigba_app`, con RLS de verdad. Las entradas llegan por la
 * recepción real y las salidas por `escribirEnLibro`; el saldo lo deja el
 * trigger del libro (SBA-35). Para medir con volumen, los lotes se cargan con
 * SQL de administrador: la recepción uno por uno tardaría minutos.
 */

const URL_ADMIN = process.env['DATABASE_URL'];

if (process.env['CI'] && !URL_ADMIN) {
  throw new Error(
    'DATABASE_URL no está definida en CI. La prueba de aislamiento no es opcional (RNF-01).',
  );
}

const ACTOR = 'operario-prueba';

/** Un banco mediano tiene unos cientos de lotes con saldo; esto es varias veces más. */
const LOTES_DE_VOLUMEN = 2000;
const CONSULTAS_CONCURRENTES = 50;

describe.skipIf(!URL_ADMIN)(
  'Stock por bodega, referencia y lote contra PostgreSQL (SBA-36)',
  () => {
    let admin: PrismaClient;
    let app: PrismaClient;
    let recepciones: RecepcionesService;
    let donantes: DonantesService;
    let catalogo: ReferenciasService;
    let stock: StockService;
    let parametros: ParametrosService;

    const bancoA = 'aaaaaaaa-3636-4363-8363-aaaaaaaaaaaa';
    const bancoB = 'bbbbbbbb-3636-4363-8363-bbbbbbbbbbbb';
    const red = 'ffffffff-3636-4363-8363-ffffffffffff';
    const bodega = 'cccccccc-3636-4363-8363-cccccccccccc';
    const otraBodega = 'dddddddd-3636-4363-8363-dddddddddddd';

    function enBanco<R>(bancoId: string, fn: () => Promise<R>): Promise<R> {
      return runWithTenantContext({ bancoId, actor: ACTOR }, fn) as Promise<R>;
    }

    let arroz: string;
    let frijol: string;
    let granos: string;
    let donante: string;

    async function recibir(
      referenciaId: string,
      cantidad: number,
      opciones: { bodegaId?: string; vencimiento?: string | null; lote?: string } = {},
    ) {
      const { recepcion } = await enBanco(bancoA, () =>
        recepciones.registrar({
          comandoId: randomUUID(),
          donanteId: donante,
          origen: 'propia',
          bodegaId: opciones.bodegaId ?? bodega,
          detalles: [
            {
              movimientoId: randomUUID(),
              referenciaId,
              cantidad,
              lote: opciones.lote ?? null,
              vencimiento: opciones.vencimiento === undefined ? '2027-03-31' : opciones.vencimiento,
            },
          ],
        }),
      );
      const [detalle] = recepcion.detalles;
      if (!detalle) throw new Error('La recepción no devolvió su detalle.');
      return { loteId: detalle.loteId, referenciaId };
    }

    async function sacar(lote: { loteId: string; referenciaId: string }, cantidad: number) {
      await enBanco(bancoA, () =>
        executeTransactionWithTenant(app, (tx) =>
          escribirEnLibro(tx, [
            {
              id: randomUUID(),
              bancoId: bancoA,
              comandoId: randomUUID(),
              tipo: 'salida',
              referenciaId: lote.referenciaId,
              loteId: lote.loteId,
              bodegaId: bodega,
              cantidad: -cantidad,
              kilos: -cantidad,
              creadoPor: ACTOR,
            },
          ]),
        ),
      );
    }

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
        admin.$executeRawUnsafe(`DELETE FROM plataforma.parametro_banco WHERE ${enBancos}`),
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
      await admin.$executeRaw`INSERT INTO plataforma.red (id, nombre) VALUES (${red}::uuid, 'Red del stock')`;
      await admin.$executeRaw`
      INSERT INTO plataforma.banco (id, red_id, nombre, codigo)
      VALUES (${bancoA}::uuid, ${red}::uuid, 'Banco A', 'STK-A'),
             (${bancoB}::uuid, ${red}::uuid, 'Banco B', 'STK-B')`;
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
      parametros = new ParametrosService(new ParametrosPrismaRepositorio(prisma, auditoria));
      stock = new StockService(new StockPrismaRepositorio(prisma), parametros);
    });

    beforeEach(async () => {
      await limpiar();
      ({ arroz, frijol, granos, donante } = await enBanco(bancoA, async () => {
        const { id: donanteId } = await donantes.crear({
          nombre: 'Supermercado La 14',
          tipo: 'empresa',
        });
        const cereales = await catalogo.crearCategoria({ codigo: 'C801', nombre: 'Arroz' });
        const leguminosas = await catalogo.crearCategoria({ codigo: 'C802', nombre: 'Granos' });
        const productoArroz = await catalogo.crearProducto({
          categoriaId: cereales.id,
          nombre: 'Arroz',
        });
        const productoFrijol = await catalogo.crearProducto({
          categoriaId: leguminosas.id,
          nombre: 'Fríjol',
        });
        const kiloArroz = await catalogo.crearReferencia({
          productoId: productoArroz.id,
          presentacion: '1 kg',
          equivalenciaKg: '1',
        });
        const libraFrijol = await catalogo.crearReferencia({
          productoId: productoFrijol.id,
          presentacion: '500 g',
          equivalenciaKg: '0.5',
        });
        return {
          arroz: kiloArroz.id,
          frijol: libraFrijol.id,
          granos: leguminosas.id,
          donante: donanteId,
        };
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

    it('muestra cada lote con su bodega, vencimiento, estado y saldo, el que vence primero arriba', async () => {
      await recibir(arroz, 10, { vencimiento: '2027-03-31', lote: 'L-2' });
      await recibir(arroz, 4, { vencimiento: '2020-01-31', lote: 'L-1' });
      await recibir(arroz, 6, { vencimiento: null });

      const lotes = await enBanco(bancoA, () => stock.consultar());

      expect(
        lotes.map(({ codigo, vencimiento, estado, cantidad, kilos, bodegaId }) => ({
          codigo,
          vencimiento,
          estado,
          cantidad,
          kilos,
          bodegaId,
        })),
      ).toEqual([
        {
          codigo: 'L-1',
          vencimiento: '2020-01-31',
          estado: 'vencido',
          cantidad: '4',
          kilos: '4',
          bodegaId: bodega,
        },
        {
          codigo: 'L-2',
          vencimiento: '2027-03-31',
          estado: 'vigente',
          cantidad: '10',
          kilos: '10',
          bodegaId: bodega,
        },
        {
          codigo: null,
          vencimiento: null,
          estado: 'sin_vencimiento',
          cantidad: '6',
          kilos: '6',
          bodegaId: bodega,
        },
      ]);
      expect(lotes[0]?.referencia).toMatchObject({
        id: arroz,
        presentacion: '1 kg',
        producto: { nombre: 'Arroz' },
        categoria: { codigo: 'C801', nombre: 'Arroz' },
      });
    });

    it('pinta el semáforo con los umbrales vigentes del banco y refleja un cambio sin desplegar (SBA-37)', async () => {
      const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(
        new Date(),
      );
      const enDias = (dias: number) =>
        new Date(Date.parse(hoy) + dias * 86_400_000).toISOString().slice(0, 10);
      await recibir(arroz, 1, { vencimiento: enDias(3), lote: 'EN-3' });
      await recibir(arroz, 1, { vencimiento: enDias(6), lote: 'EN-6' });
      await recibir(arroz, 1, { vencimiento: enDias(30), lote: 'EN-30' });
      const luces = async () =>
        (await enBanco(bancoA, () => stock.consultar())).map((l) => [
          l.codigo,
          l.diasParaVencer,
          l.semaforo,
        ]);

      expect(await luces()).toEqual([
        ['EN-3', 3, null],
        ['EN-6', 6, null],
        ['EN-30', 30, null],
      ]);

      await enBanco(bancoA, async () => {
        await parametros.actualizar('semaforo_rojo_dias', 3);
        await parametros.actualizar('semaforo_amarillo_dias', 7);
      });
      expect(await luces()).toEqual([
        ['EN-3', 3, 'rojo'],
        ['EN-6', 6, 'amarillo'],
        ['EN-30', 30, 'verde'],
      ]);

      // Una vigencia empezada no se edita: el cambio entra mañana, y mañana se ve.
      await enBanco(bancoA, () => parametros.actualizar('semaforo_rojo_dias', 1, enDias(1)));
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(Date.now() + 86_400_000));
      try {
        expect(await luces()).toEqual([
          ['EN-3', 2, 'amarillo'],
          ['EN-6', 5, 'amarillo'],
          ['EN-30', 29, 'verde'],
        ]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('un lote que quedó en cero no aparece como disponible', async () => {
      const agotado = await recibir(arroz, 5);
      await recibir(arroz, 3);
      await sacar(agotado, 5);

      const lotes = await enBanco(bancoA, () => stock.consultar());

      expect(lotes.map(({ loteId }) => loteId)).not.toContain(agotado.loteId);
      expect(lotes).toHaveLength(1);
    });

    it('el saldo refleja la salida', async () => {
      const lote = await recibir(arroz, 10);
      await sacar(lote, 4);

      const [fila] = await enBanco(bancoA, () => stock.consultar());

      expect(fila?.cantidad).toBe('6');
    });

    it('filtra por bodega, por categoría y por referencia', async () => {
      await recibir(arroz, 10);
      await recibir(arroz, 2, { bodegaId: otraBodega });
      await recibir(frijol, 8);

      const [porBodega, porCategoria, porReferencia, combinado] = await enBanco(bancoA, () =>
        Promise.all([
          stock.consultar({ bodegaId: otraBodega }),
          stock.consultar({ categoriaId: granos }),
          stock.consultar({ referenciaId: arroz }),
          stock.consultar({ referenciaId: arroz, bodegaId: bodega }),
        ]),
      );

      expect(porBodega.map((l) => [l.referencia.id, l.cantidad])).toEqual([[arroz, '2']]);
      expect(porCategoria.map((l) => [l.referencia.id, l.kilos])).toEqual([[frijol, '4']]);
      expect(porReferencia.map((l) => l.bodegaId).toSorted()).toEqual(
        [bodega, otraBodega].toSorted(),
      );
      expect(combinado.map((l) => [l.bodegaId, l.cantidad])).toEqual([[bodega, '10']]);
    });

    describe('aislamiento entre bancos (ADR-07)', () => {
      it('un usuario del banco B obtiene cero filas, con o sin filtro', async () => {
        await recibir(arroz, 10);
        await recibir(frijol, 8, { bodegaId: otraBodega });

        const [todo, porBodega, porReferencia, porCategoria] = await enBanco(bancoB, () =>
          Promise.all([
            stock.consultar(),
            stock.consultar({ bodegaId: bodega }),
            stock.consultar({ referenciaId: arroz }),
            stock.consultar({ categoriaId: granos }),
          ]),
        );

        expect(todo).toEqual([]);
        expect(porBodega).toEqual([]);
        expect(porReferencia).toEqual([]);
        expect(porCategoria).toEqual([]);
        expect(await enBanco(bancoA, () => stock.consultar())).toHaveLength(2);
      });

      it('sin banco en el contexto no consulta nada', async () => {
        await expect(stock.consultar()).rejects.toThrow(/sin banco/);
      });
    });

    // Corre sola, en la pasada de vitest.config.rendimiento.ts: con la suite en
    // paralelo mediría la máquina ocupada y les quitaría CPU a las demás.
    it.runIf(process.env['SIGBA_RENDIMIENTO'] === '1')(
      `${CONSULTAS_CONCURRENTES} consultas concurrentes sobre ${LOTES_DE_VOLUMEN} lotes responden con percentil 95 bajo 1 s`,
      async () => {
        const { id: recepcionId } = await admin.recepcion.create({
          data: {
            bancoId: bancoA,
            donanteId: donante,
            origen: 'propia',
            bodegaId: bodega,
            creadoPor: ACTOR,
          },
        });
        // Una mitad de cada referencia y en las dos bodegas, con vencimientos
        // repartidos en el año y algunos sin fecha.
        await admin.$executeRaw`
        WITH lotes AS (
          INSERT INTO inventario.lote
            (banco_id, recepcion_id, referencia_id, codigo, vencimiento, equivalencia_kg, creado_por)
          SELECT ${bancoA}::uuid, ${recepcionId}::uuid,
                 CASE WHEN g % 2 = 0 THEN ${arroz}::uuid ELSE ${frijol}::uuid END,
                 'V-' || g,
                 CASE WHEN g % 10 = 0 THEN NULL ELSE DATE '2026-06-01' + (g % 365) END,
                 1,
                 ${ACTOR}
          FROM generate_series(1, ${LOTES_DE_VOLUMEN}::int) AS g
          RETURNING id, referencia_id, codigo
        )
        INSERT INTO inventario.movimiento
          (id, banco_id, comando_id, tipo, referencia_id, lote_id, bodega_id, cantidad, kilos, creado_por)
        SELECT gen_random_uuid(), ${bancoA}::uuid, ${recepcionId}::uuid, 'entrada', referencia_id, id,
               CASE WHEN right(codigo, 1) IN ('1', '3', '5') THEN ${otraBodega}::uuid ELSE ${bodega}::uuid END,
               12, 12, ${ACTOR}
        FROM lotes`;
        await admin.$executeRawUnsafe('ANALYZE inventario.saldo, inventario.lote');
        const rafaga = () =>
          Promise.all(
            Array.from({ length: CONSULTAS_CONCURRENTES }, async () => {
              const inicio = performance.now();
              const lotes = await enBanco(bancoA, () => stock.consultar());
              if (lotes.length !== LOTES_DE_VOLUMEN) {
                throw new Error(`Llegaron ${lotes.length} lotes.`);
              }
              return performance.now() - inicio;
            }),
          );

        // Abre las conexiones del pool, que en la API quedan abiertas. Sin esto
        // se mediría el arranque de procesos de Postgres y no la consulta.
        await Promise.all(
          Array.from({ length: CONSULTAS_CONCURRENTES }, () => app.$queryRaw`SELECT 1`),
        );
        const duraciones = (await rafaga()).toSorted((a, b) => a - b);

        const p95 = duraciones[Math.ceil(duraciones.length * 0.95) - 1] ?? Infinity;
        expect(p95, `p95 de ${p95.toFixed(0)} ms`).toBeLessThan(1000);
      },
      60_000,
    );
  },
);

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AuditService,
  executeTransactionWithTenant,
  IdempotenciaService,
  type PrismaService,
  runWithTenantContext,
} from '../src/core/index.js';
import { BodegasPrismaRepositorio } from '../src/modules/plataforma/repositories/bodegas.prisma.repositorio.js';
import { BodegasService } from '../src/modules/plataforma/services/bodegas.service.js';
import { DonantesPrismaRepositorio } from '../src/modules/inventario/repositories/donantes.prisma.repositorio.js';
import { IngresosPrismaRepositorio } from '../src/modules/inventario/repositories/ingresos.prisma.repositorio.js';
import { PreciosPrismaRepositorio } from '../src/modules/inventario/repositories/precios.prisma.repositorio.js';
import { RecepcionesPrismaRepositorio } from '../src/modules/inventario/repositories/recepciones.prisma.repositorio.js';
import {
  bloquearReferencias,
  valorarPendientes,
} from '../src/modules/inventario/repositories/valoracion.js';
import { ReferenciasPrismaRepositorio } from '../src/modules/inventario/repositories/referencias.prisma.repositorio.js';
import { DonantesService } from '../src/modules/inventario/services/donantes.service.js';
import { IngresosService } from '../src/modules/inventario/services/ingresos.service.js';
import { PreciosService } from '../src/modules/inventario/services/precios.service.js';
import { RecepcionesService } from '../src/modules/inventario/services/recepciones.service.js';
import { ReferenciasService } from '../src/modules/inventario/services/referencias.service.js';
import { urlComoRolApp } from './rol-de-aplicacion.js';

/**
 * Valoración tardía contra PostgreSQL (SBA-43, ADR-07, ADR-08, ADR-13).
 *
 * Recibe sin precio, aprueba un precio y comprueba, conectado como
 * `sigba_app`: que la entrada queda valorada en una fila aparte con el
 * movimiento intacto, que el día de la recepción es el de Colombia, que los
 * ingresos del mes no duplican la cantidad y pasan el importe de pendiente a
 * conocido, que nada de esto se edita después y que el banco B no se entera.
 */

const URL_ADMIN = process.env['DATABASE_URL'];

if (process.env['CI'] && !URL_ADMIN) {
  throw new Error(
    'DATABASE_URL no está definida en CI. La prueba de aislamiento no es opcional (RNF-01).',
  );
}

const ACTOR = 'coordinacion-prueba';

/** Del hijo al padre: el orden en que se borran. */
const TABLAS = [
  'valoracion',
  'recepcion_detalle',
  'movimiento',
  'lote',
  'recepcion',
  'precio',
  'referencia',
  'producto',
  'categoria',
  'donante',
];

describe.skipIf(!URL_ADMIN)('Valoración tardía contra PostgreSQL (SBA-43)', () => {
  let admin: PrismaClient;
  let app: PrismaClient;
  let recepciones: RecepcionesService;
  let precios: PreciosService;
  let ingresos: IngresosService;
  let donantes: DonantesService;
  let referencias: ReferenciasService;

  const bancoA = 'aaaaaaaa-4343-4343-8343-aaaaaaaaaaaa';
  const bancoB = 'bbbbbbbb-4343-4343-8343-bbbbbbbbbbbb';
  const red = 'ffffffff-4343-4343-8343-ffffffffffff';
  const bodegaDeA = 'cccccccc-4343-4343-8343-cccccccccccc';
  const bodegaDeB = 'dddddddd-4343-4343-8343-dddddddddddd';

  let siguiente = 0;
  /** Un UUIDv7 nuevo en cada llamada, como los que genera el cliente. */
  function uuidv7(): string {
    siguiente += 1;
    return `01920000-0000-7000-8043-${String(siguiente).padStart(12, '0')}`;
  }

  function enBanco<R>(bancoId: string, fn: () => Promise<R>): Promise<R> {
    return runWithTenantContext({ bancoId, actor: ACTOR }, fn) as Promise<R>;
  }

  /** SQL crudo como sigba_app, con el banco fijado en la transacción. */
  function comoApp(bancoId: string, sql: string) {
    return app.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.banco_id', ${bancoId}, true)`;
      return tx.$executeRawUnsafe(sql);
    });
  }

  async function limpiar(): Promise<void> {
    // Estas tablas rechazan DELETE con un trigger; el administrador lo apaga
    // para esta transacción y nada más.
    const enBancos = `banco_id IN ('${bancoA}', '${bancoB}')`;
    await admin.$transaction([
      admin.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`),
      ...TABLAS.map((tabla) =>
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

  /** Un donante, arroz de 500 g y aceite de 1 l del banco que se le pida. */
  async function datosDelBanco(bancoId: string) {
    return enBanco(bancoId, async () => {
      const donante = await donantes.crear({ nombre: 'Supermercado La 14', tipo: 'empresa' });
      const categoria = await referencias.crearCategoria({ codigo: 'C801', nombre: 'Granos' });
      const crear = async (nombre: string, presentacion: string, equivalenciaKg: string) => {
        const producto = await referencias.crearProducto({ categoriaId: categoria.id, nombre });
        const referencia = await referencias.crearReferencia({
          productoId: producto.id,
          presentacion,
          equivalenciaKg,
        });
        return referencia.id;
      };
      return {
        donanteId: donante.id,
        arroz: await crear('Arroz', '500 g', '0.5'),
        aceite: await crear('Aceite', '1 l', '0.92'),
      };
    });
  }

  /**
   * Registra una recepción por el servicio y la fecha como si hubiera llegado
   * en `instante`. El trigger no deja cambiar creado_en, así que el
   * administrador lo apaga para esta transacción.
   */
  async function recibir(
    bancoId: string,
    donanteId: string,
    instante: string,
    filas: [referenciaId: string, cantidad: string][],
  ) {
    const { recepcion } = await enBanco(bancoId, () =>
      recepciones.registrar({
        comandoId: uuidv7(),
        donanteId,
        origen: 'propia',
        bodegaId: bancoId === bancoA ? bodegaDeA : bodegaDeB,
        detalles: filas.map(([referenciaId, cantidad]) => ({
          movimientoId: uuidv7(),
          referenciaId,
          cantidad,
        })),
      }),
    );
    const movimientos = recepcion.detalles.map((d) => d.movimientoId);
    await admin.$transaction([
      admin.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`),
      admin.$executeRaw`UPDATE inventario.recepcion SET creado_en = ${instante}::timestamptz
        WHERE id = ${recepcion.id}::uuid`,
      admin.$executeRaw`UPDATE inventario.movimiento SET creado_en = ${instante}::timestamptz
        WHERE banco_id = ${bancoId}::uuid AND id = ANY(${movimientos}::uuid[])`,
    ]);
    return movimientos;
  }

  /** Propone y aprueba un precio de octubre de 2026; devuelve su id. */
  async function aprobarPrecio(
    bancoId: string,
    referenciaId: string,
    valor = '2800',
    vigenteDesde = '2026-10-01',
    vigenteHasta = '2026-10-31',
  ): Promise<string> {
    return enBanco(bancoId, async () => {
      const { precio } = await precios.proponer({
        comandoId: uuidv7(),
        referenciaId,
        valor,
        piso: '1000',
        techo: '20000',
        fuente: 'sipsa',
        evidencia: 'SIPSA-P Pereira, semana 41',
        vigenteDesde,
        vigenteHasta,
      });
      await precios.aprobar({ comandoId: uuidv7(), precioId: precio.id });
      return precio.id;
    });
  }

  async function valoracionDe(movimientoId: string) {
    const [fila] = await admin.$queryRaw<
      {
        estado: string;
        precio_id: string | null;
        valor_unitario: string | null;
        importe: string | null;
      }[]
    >`
      SELECT d.valoracion::text AS estado, v.precio_id::text,
             v.valor_unitario::text, v.importe::text
      FROM inventario.recepcion_detalle d
      LEFT JOIN inventario.valoracion v
        ON v.banco_id = d.banco_id AND v.movimiento_id = d.movimiento_id
      WHERE d.movimiento_id = ${movimientoId}::uuid`;
    return fila;
  }

  async function valoracionesDe(bancoId: string): Promise<number> {
    const [fila] = await admin.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM inventario.valoracion WHERE banco_id = ${bancoId}::uuid`;
    return Number(fila?.n ?? 0);
  }

  beforeAll(async () => {
    admin = new PrismaClient({ datasourceUrl: URL_ADMIN });
    await limpiar();
    await borrarBancos();
    await admin.$executeRaw`INSERT INTO plataforma.red (id, nombre) VALUES (${red}::uuid, 'Red de valoración')`;
    await admin.$executeRaw`
      INSERT INTO plataforma.banco (id, red_id, nombre, codigo)
      VALUES (${bancoA}::uuid, ${red}::uuid, 'Banco A', 'VAL-A'),
             (${bancoB}::uuid, ${red}::uuid, 'Banco B', 'VAL-B')`;
    await admin.$executeRaw`
      INSERT INTO plataforma.bodega (id, banco_id, nombre, activa)
      VALUES (${bodegaDeA}::uuid, ${bancoA}::uuid, 'Santa Isabel', true),
             (${bodegaDeB}::uuid, ${bancoB}::uuid, 'Bodega del banco B', true)`;
    app = new PrismaClient({ datasourceUrl: urlComoRolApp(URL_ADMIN as string) });
    // PrismaService es un PrismaClient; aquí va uno conectado con el rol de la app.
    const prisma = app as PrismaService;
    const auditoria = new AuditService();
    const idempotencia = new IdempotenciaService();
    donantes = new DonantesService(new DonantesPrismaRepositorio(prisma, auditoria));
    referencias = new ReferenciasService(
      new ReferenciasPrismaRepositorio(prisma, auditoria, idempotencia),
    );
    recepciones = new RecepcionesService(
      new RecepcionesPrismaRepositorio(prisma, idempotencia, auditoria),
      donantes,
      new BodegasService(new BodegasPrismaRepositorio(prisma, auditoria)),
      referencias,
    );
    precios = new PreciosService(new PreciosPrismaRepositorio(prisma, idempotencia, auditoria));
    ingresos = new IngresosService(new IngresosPrismaRepositorio(prisma));
  });

  beforeEach(limpiar);

  afterAll(async () => {
    if (admin) {
      await limpiar();
      await borrarBancos();
      await admin.$disconnect();
    }
    if (app) await app.$disconnect();
  });

  it('la tabla valoracion tiene RLS activo y forzado', async () => {
    const [tabla] = await admin.$queryRaw<{ rls: boolean; forzado: boolean }[]>`
      SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS forzado
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'inventario' AND c.relname = 'valoracion'`;

    expect(tabla).toEqual({ rls: true, forzado: true });
  });

  describe('criterios de SBA-43', () => {
    it('1. al aprobar el precio, la recepción queda valorada y su movimiento conserva id y fecha', async () => {
      const { donanteId, arroz, aceite } = await datosDelBanco(bancoA);
      const [deArroz = '', deAceite = ''] = await recibir(
        bancoA,
        donanteId,
        '2026-10-15T15:00:00Z',
        [
          [arroz, '4'],
          [aceite, '2'],
        ],
      );
      const antes = await admin.movimiento.findMany({ where: { bancoId: bancoA } });

      const precioId = await aprobarPrecio(bancoA, arroz);

      expect(await valoracionDe(deArroz)).toEqual({
        estado: 'con_precio',
        precio_id: precioId,
        valor_unitario: '2800.00',
        importe: '11200.00000',
      });
      // El aceite no tiene precio: sigue pendiente, sin fila de valoración.
      expect(await valoracionDe(deAceite)).toEqual({
        estado: 'pendiente',
        precio_id: null,
        valor_unitario: null,
        importe: null,
      });
      expect(await admin.movimiento.findMany({ where: { bancoId: bancoA } })).toEqual(antes);
      expect(antes.find((m) => m.id === deArroz)?.creadoEn).toEqual(
        new Date('2026-10-15T15:00:00Z'),
      );

      const [detalle] = await admin.$queryRaw<{ actualizado_por: string }[]>`
        SELECT actualizado_por FROM inventario.recepcion_detalle
        WHERE movimiento_id = ${deArroz}::uuid`;
      expect(detalle?.actualizado_por).toBe(ACTOR);
      const auditoria = await admin.$queryRaw<
        { banco_id: string; actor_etiqueta: string; accion: string }[]
      >`
        SELECT a.banco_id::text, a.actor_etiqueta, a.accion
        FROM core.auditoria a JOIN inventario.valoracion v ON v.id::text = a.entidad_id
        WHERE a.entidad = 'valoracion' AND v.movimiento_id = ${deArroz}::uuid`;
      expect(auditoria).toEqual([{ banco_id: bancoA, actor_etiqueta: ACTOR, accion: 'crear' }]);
    });

    it('2. los ingresos del mes no duplican la cantidad y el importe pasa de pendiente a conocido', async () => {
      const { donanteId, arroz, aceite } = await datosDelBanco(bancoA);
      await recibir(bancoA, donanteId, '2026-10-05T15:00:00Z', [
        [arroz, '4'],
        [aceite, '2'],
      ]);
      await recibir(bancoA, donanteId, '2026-10-20T15:00:00Z', [[arroz, '6']]);
      const delMes = () => enBanco(bancoA, () => ingresos.delMes('2026-10'));

      const antes = await delMes();
      await aprobarPrecio(bancoA, arroz, '2800.50');
      const despues = await delMes();

      const aceiteDelMes = {
        producto: 'Aceite',
        presentacion: '1 l',
        cantidad: '2',
        kilos: '1.84',
        importeConocido: null,
        cantidadPendiente: '2',
      };
      expect(antes).toEqual({
        mes: '2026-10',
        referencias: [
          { referenciaId: aceite, ...aceiteDelMes },
          {
            referenciaId: arroz,
            producto: 'Arroz',
            presentacion: '500 g',
            cantidad: '10',
            kilos: '5',
            importeConocido: null,
            cantidadPendiente: '10',
          },
        ],
      });
      expect(despues).toEqual({
        mes: '2026-10',
        referencias: [
          { referenciaId: aceite, ...aceiteDelMes },
          {
            referenciaId: arroz,
            producto: 'Arroz',
            presentacion: '500 g',
            cantidad: '10',
            kilos: '5',
            importeConocido: '28005',
            cantidadPendiente: '0',
          },
        ],
      });
    });
  });

  it('el día de la recepción es el de Colombia, para la vigencia y para el mes', async () => {
    const { donanteId, arroz } = await datosDelBanco(bancoA);
    // 23:30 del 30 de septiembre en Pereira, ya 1 de octubre en UTC.
    const [septiembre = ''] = await recibir(bancoA, donanteId, '2026-10-01T04:30:00Z', [
      [arroz, '1'],
    ]);
    // 23:30 del 31 de octubre en Pereira, ya 1 de noviembre en UTC.
    const [octubre = ''] = await recibir(bancoA, donanteId, '2026-11-01T04:30:00Z', [[arroz, '3']]);

    await aprobarPrecio(bancoA, arroz);

    expect((await valoracionDe(septiembre))?.estado).toBe('pendiente');
    expect((await valoracionDe(octubre))?.estado).toBe('con_precio');
    const mes = (m: string) => enBanco(bancoA, () => ingresos.delMes(m));
    expect((await mes('2026-09')).referencias).toMatchObject([
      { cantidad: '1', importeConocido: null, cantidadPendiente: '1' },
    ]);
    expect((await mes('2026-10')).referencias).toMatchObject([
      { cantidad: '3', importeConocido: '8400', cantidadPendiente: '0' },
    ]);
    expect((await mes('2026-11')).referencias).toEqual([]);
  });

  it('un precio posterior no vuelve a valorar lo que ya tiene precio, y el reenvío tampoco', async () => {
    const { donanteId, arroz } = await datosDelBanco(bancoA);
    const [octubre = ''] = await recibir(bancoA, donanteId, '2026-10-15T15:00:00Z', [[arroz, '4']]);
    const [noviembre = ''] = await recibir(bancoA, donanteId, '2026-11-10T15:00:00Z', [
      [arroz, '2'],
    ]);
    const deOctubre = await aprobarPrecio(bancoA, arroz);

    const comando = await enBanco(bancoA, async () => {
      const { precio } = await precios.proponer({
        comandoId: uuidv7(),
        referenciaId: arroz,
        valor: '3000',
        piso: '1000',
        techo: '20000',
        fuente: 'sipsa',
        evidencia: 'SIPSA-P Pereira, semana 45',
        vigenteDesde: '2026-11-01',
        vigenteHasta: '2026-11-30',
      });
      return { comandoId: uuidv7(), precioId: precio.id };
    });
    await enBanco(bancoA, () => precios.aprobar(comando));
    const reenvio = await enBanco(bancoA, () => precios.aprobar(comando));

    expect(reenvio.repetida).toBe(true);
    expect(await valoracionDe(octubre)).toMatchObject({
      precio_id: deOctubre,
      importe: '11200.00000',
    });
    expect(await valoracionDe(noviembre)).toMatchObject({
      precio_id: comando.precioId,
      importe: '6000.00000',
    });
    expect(await valoracionesDe(bancoA)).toBe(2);
  });

  describe('la recepción que llega con precio vigente', () => {
    /** Vigencia que cubre hoy en cualquier zona horaria. */
    const SIEMPRE = ['2000-01-01', '2999-12-31'] as const;

    /** Registra hoy, por el servicio, sin cambiar la fecha. */
    async function recibirHoy(donanteId: string, filas: [string, string][]) {
      const { recepcion } = await enBanco(bancoA, () =>
        recepciones.registrar({
          comandoId: uuidv7(),
          donanteId,
          origen: 'propia',
          bodegaId: bodegaDeA,
          detalles: filas.map(([referenciaId, cantidad]) => ({
            movimientoId: uuidv7(),
            referenciaId,
            cantidad,
          })),
        }),
      );
      return recepcion;
    }

    it('nace valorada con el precio aprobado vigente; sin precio nace pendiente', async () => {
      const { donanteId, arroz, aceite } = await datosDelBanco(bancoA);
      const precioId = await aprobarPrecio(bancoA, arroz, '2800', ...SIEMPRE);

      const recepcion = await recibirHoy(donanteId, [
        [arroz, '3'],
        [aceite, '1'],
      ]);

      expect(recepcion.detalles.map((d) => d.valoracion)).toEqual(['con_precio', 'pendiente']);
      expect(await valoracionDe(recepcion.detalles[0]?.movimientoId ?? '')).toEqual({
        estado: 'con_precio',
        precio_id: precioId,
        valor_unitario: '2800.00',
        importe: '8400.00000',
      });
      expect(await valoracionesDe(bancoA)).toBe(1);
    });

    it('un precio propuesto sin aprobar no la valora', async () => {
      const { donanteId, arroz } = await datosDelBanco(bancoA);
      await enBanco(bancoA, () =>
        precios.proponer({
          comandoId: uuidv7(),
          referenciaId: arroz,
          valor: '2800',
          piso: '1000',
          techo: '20000',
          fuente: 'sipsa',
          evidencia: 'SIPSA-P Pereira, semana 41',
          vigenteDesde: SIEMPRE[0],
          vigenteHasta: SIEMPRE[1],
        }),
      );

      const recepcion = await recibirHoy(donanteId, [[arroz, '3']]);

      expect(recepcion.detalles[0]?.valoracion).toBe('pendiente');
      expect(await valoracionesDe(bancoA)).toBe(0);
    });

    it('si llega mientras se aprueba el precio, espera a la aprobación y queda valorada', async () => {
      const { donanteId, arroz } = await datosDelBanco(bancoA);
      const { precio } = await enBanco(bancoA, () =>
        precios.proponer({
          comandoId: uuidv7(),
          referenciaId: arroz,
          valor: '2800',
          piso: '1000',
          techo: '20000',
          fuente: 'sipsa',
          evidencia: 'SIPSA-P Pereira, semana 41',
          vigenteDesde: SIEMPRE[0],
          vigenteHasta: SIEMPRE[1],
        }),
      );

      // Los pasos de PreciosPrismaRepositorio.aprobar, con la transacción
      // abierta un momento después de valorar: la recepción llega en medio.
      // Sin el bloqueo de la referencia, ninguna de las dos vería a la otra y
      // la recepción quedaría pendiente para siempre.
      const aprobacion = enBanco(bancoA, () =>
        executeTransactionWithTenant(app, async (tx) => {
          await bloquearReferencias(tx, bancoA, [arroz], 'aprobacion');
          await tx.$executeRaw`
            UPDATE inventario.precio
            SET estado = 'aprobado', aprobado_por = ${ACTOR}, aprobado_en = now(),
                actualizado_por = ${ACTOR}, actualizado_en = now()
            WHERE id = ${precio.id}::uuid`;
          await valorarPendientes(
            tx,
            new AuditService(),
            { bancoId: bancoA, actor: ACTOR },
            { precioId: precio.id },
          );
          await tx.$executeRaw`SELECT pg_sleep(0.4)`;
        }),
      );
      await new Promise((listo) => setTimeout(listo, 150));
      const recepcion = recibirHoy(donanteId, [[arroz, '3']]);

      const [, recibida] = await Promise.all([aprobacion, recepcion]);

      expect(recibida.detalles[0]?.valoracion).toBe('con_precio');
      expect(await valoracionesDe(bancoA)).toBe(1);
    });
  });

  describe('lo que no se edita (ADR-08)', () => {
    async function valorada() {
      const { donanteId, arroz } = await datosDelBanco(bancoA);
      const [movimientoId = ''] = await recibir(bancoA, donanteId, '2026-10-15T15:00:00Z', [
        [arroz, '4'],
      ]);
      const precioId = await aprobarPrecio(bancoA, arroz);
      return { movimientoId, precioId };
    }

    it('la valoración rechaza UPDATE y DELETE, también al administrador, y es una por movimiento', async () => {
      const { movimientoId, precioId } = await valorada();
      const enA = `WHERE banco_id = '${bancoA}'`;

      await expect(
        admin.$executeRawUnsafe(`UPDATE inventario.valoracion SET importe = 1 ${enA}`),
      ).rejects.toThrow(/append-only/);
      await expect(
        admin.$executeRawUnsafe(`DELETE FROM inventario.valoracion ${enA}`),
      ).rejects.toThrow(/append-only/);
      await expect(
        admin.$executeRawUnsafe(
          `INSERT INTO inventario.valoracion
           (banco_id, movimiento_id, precio_id, valor_unitario, importe, creado_por)
           VALUES ('${bancoA}', '${movimientoId}', '${precioId}', 1, 1, 'x')`,
        ),
      ).rejects.toThrow(/Key \(banco_id, movimiento_id\).* already exists/);
      expect(await valoracionesDe(bancoA)).toBe(1);
    });

    it('un detalle con precio no vuelve a pendiente, ni para el administrador', async () => {
      const { movimientoId } = await valorada();

      await expect(
        admin.$executeRawUnsafe(
          `UPDATE inventario.recepcion_detalle SET valoracion = 'pendiente'
           WHERE movimiento_id = '${movimientoId}'`,
        ),
      ).rejects.toThrow(/no vuelve a pendiente/);
    });

    it('sigba_app no edita la valoración ni otra columna del detalle', async () => {
      await valorada();

      await expect(
        comoApp(bancoA, `UPDATE inventario.valoracion SET creado_por = 'otro'`),
      ).rejects.toThrow(/permission denied/);
      await expect(comoApp(bancoA, `DELETE FROM inventario.valoracion`)).rejects.toThrow(
        /permission denied/,
      );
      await expect(
        comoApp(bancoA, `UPDATE inventario.recepcion_detalle SET novedad = 'roto'`),
      ).rejects.toThrow(/permission denied/);
    });
  });

  describe('aislamiento entre bancos (ADR-07)', () => {
    it('aprobar en el banco A no valora ni muestra nada del banco B', async () => {
      const deA = await datosDelBanco(bancoA);
      const deB = await datosDelBanco(bancoB);
      await recibir(bancoA, deA.donanteId, '2026-10-15T15:00:00Z', [[deA.arroz, '4']]);
      const [deBanco = ''] = await recibir(bancoB, deB.donanteId, '2026-10-15T15:00:00Z', [
        [deB.arroz, '7'],
      ]);

      await aprobarPrecio(bancoA, deA.arroz);

      expect((await valoracionDe(deBanco))?.estado).toBe('pendiente');
      expect(await valoracionesDe(bancoB)).toBe(0);
      expect(await enBanco(bancoB, () => ingresos.delMes('2026-10'))).toMatchObject({
        referencias: [{ referenciaId: deB.arroz, cantidad: '7', importeConocido: null }],
      });
      const visibles = await app.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.banco_id', ${bancoB}, true)`;
        return tx.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM inventario.valoracion`;
      });
      expect(Number(visibles[0]?.n)).toBe(0);
    });

    it('con el contexto del banco B, un INSERT con el banco_id de A falla por la política', async () => {
      const { donanteId, arroz } = await datosDelBanco(bancoA);
      const [movimientoId = ''] = await recibir(bancoA, donanteId, '2026-10-15T15:00:00Z', [
        [arroz, '4'],
      ]);
      const precioId = await enBanco(bancoA, async () => {
        const { precio } = await precios.proponer({
          comandoId: uuidv7(),
          referenciaId: arroz,
          valor: '2800',
          piso: '1000',
          techo: '20000',
          fuente: 'manual',
          evidencia: 'Remisión 123',
          vigenteDesde: '2026-10-01',
          vigenteHasta: '2026-10-31',
        });
        return precio.id;
      });

      await expect(
        comoApp(
          bancoB,
          `INSERT INTO inventario.valoracion
           (banco_id, movimiento_id, precio_id, valor_unitario, importe, creado_por)
           VALUES ('${bancoA}', '${movimientoId}', '${precioId}', 2800, 11200, 'intruso')`,
        ),
      ).rejects.toThrow(/row-level security/);
      expect(await valoracionesDe(bancoA)).toBe(0);
    });
  });
});

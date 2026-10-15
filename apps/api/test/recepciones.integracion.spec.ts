import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AuditService,
  IdempotenciaService,
  type PrismaService,
  runWithTenantContext,
} from '../src/core/index.js';
import { BodegasPrismaRepositorio } from '../src/modules/plataforma/repositories/bodegas.prisma.repositorio.js';
import { BodegasService } from '../src/modules/plataforma/services/bodegas.service.js';
import { DonantesPrismaRepositorio } from '../src/modules/inventario/repositories/donantes.prisma.repositorio.js';
import { RecepcionesPrismaRepositorio } from '../src/modules/inventario/repositories/recepciones.prisma.repositorio.js';
import { ReferenciasPrismaRepositorio } from '../src/modules/inventario/repositories/referencias.prisma.repositorio.js';
import { DonantesService } from '../src/modules/inventario/services/donantes.service.js';
import type {
  DatosDeRecepcion,
  RegistrarRecepcion,
} from '../src/modules/inventario/services/recepcion.js';
import { RecepcionesService } from '../src/modules/inventario/services/recepciones.service.js';
import { ReferenciasService } from '../src/modules/inventario/services/referencias.service.js';
import { urlComoRolApp } from './rol-de-aplicacion.js';

/**
 * Recepción contra PostgreSQL (SBA-24, ADR-07, ADR-08).
 *
 * Prueba el servicio con los adaptadores de Prisma, conectado como
 * `sigba_app`: cinco referencias en una transacción con su auditoría, el
 * rollback si una fila falla, las tablas que no se editan, la idempotencia por
 * comando con `core.comando_procesado` y que RLS deje a cada banco con sus
 * recepciones. La carrera entre dos envíos del mismo comando la fuerza
 * `idempotencia.integracion.spec.ts`. Las reglas de validación las cubre
 * `recepciones.service.spec.ts` sin base de datos.
 */

const URL_ADMIN = process.env['DATABASE_URL'];

if (process.env['CI'] && !URL_ADMIN) {
  throw new Error(
    'DATABASE_URL no está definida en CI. La prueba de aislamiento no es opcional (RNF-01).',
  );
}

const TABLAS = ['recepcion_detalle', 'movimiento', 'lote', 'recepcion'];
const ACTOR = 'operario-prueba';

describe.skipIf(!URL_ADMIN)('Recepción contra PostgreSQL (SBA-24)', () => {
  let admin: PrismaClient;
  let app: PrismaClient;
  let servicio: RecepcionesService;
  let repositorio: RecepcionesPrismaRepositorio;
  let donantes: DonantesService;
  let referencias: ReferenciasService;

  const bancoA = 'aaaaaaaa-2424-4242-8242-aaaaaaaaaaaa';
  const bancoB = 'bbbbbbbb-2424-4242-8242-bbbbbbbbbbbb';
  const red = 'ffffffff-2424-4242-8242-ffffffffffff';
  const bodega = 'cccccccc-2424-4242-8242-cccccccccccc';
  const bodegaDeB = 'dddddddd-2424-4242-8242-dddddddddddd';
  const bodegaCerrada = 'eeeeeeee-2424-4242-8242-eeeeeeeeeeee';

  let siguiente = 0;
  /** Un UUIDv7 nuevo en cada llamada, como los que genera el celular. */
  function uuidv7(): string {
    siguiente += 1;
    return `01920000-0000-7000-8000-${String(siguiente).padStart(12, '0')}`;
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
    // Las tablas de la recepción y comando_procesado rechazan DELETE con un
    // trigger; el administrador lo apaga para esta transacción y nada más.
    // session_replication_role exige superusuario.
    const enBancos = `banco_id IN ('${bancoA}', '${bancoB}')`;
    await admin.$transaction([
      admin.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`),
      ...['saldo', ...TABLAS, 'referencia', 'producto', 'categoria', 'donante'].map((tabla) =>
        admin.$executeRawUnsafe(`DELETE FROM inventario.${tabla} WHERE ${enBancos}`),
      ),
      admin.$executeRawUnsafe(`DELETE FROM core.comando_procesado WHERE ${enBancos}`),
    ]);
  }

  /** Un donante y cinco referencias del banco que se le pida. */
  async function datosDelBanco(bancoId: string) {
    return enBanco(bancoId, async () => {
      const donante = await donantes.crear({ nombre: 'Supermercado La 14', tipo: 'empresa' });
      const categoria = await referencias.crearCategoria({ codigo: 'C801', nombre: 'Arroz' });
      const producto = await referencias.crearProducto({
        categoriaId: categoria.id,
        nombre: 'Arroz',
      });
      const presentaciones = [
        ['500 g', '0.5'],
        ['1 kg', '1'],
        ['5 kg', '5'],
        ['arroba', '12.5'],
        ['bulto', '50'],
      ];
      const creadas = [];
      for (const [presentacion = '', equivalenciaKg = ''] of presentaciones) {
        creadas.push(
          await referencias.crearReferencia({
            productoId: producto.id,
            presentacion,
            equivalenciaKg,
          }),
        );
      }
      return { donante, referencias: creadas };
    });
  }

  function comando(
    donanteId: string,
    referenciaIds: string[],
    bodegaId = bodega,
  ): RegistrarRecepcion {
    return {
      comandoId: uuidv7(),
      donanteId,
      origen: 'propia',
      bodegaId,
      detalles: referenciaIds.map((referenciaId, i) => ({
        movimientoId: uuidv7(),
        referenciaId,
        cantidad: i + 1,
        lote: `L-${i + 1}`,
        vencimiento: '2027-03-31',
      })),
    };
  }

  /** Lo que el servicio le entregaría al repositorio, para saltárselo. */
  function datos(donanteId: string, referenciaIds: string[], bodegaId = bodega): DatosDeRecepcion {
    const cmd = comando(donanteId, referenciaIds, bodegaId);
    return {
      comandoId: cmd.comandoId,
      carga: {
        donanteId,
        origen: 'propia',
        bodegaId,
        detalles: cmd.detalles.map((d) => ({
          movimientoId: d.movimientoId,
          referenciaId: d.referenciaId,
          cantidad: '1',
          lote: null,
          vencimiento: d.vencimiento ?? null,
          novedad: null,
        })),
      },
      kilos: cmd.detalles.map(() => '1'),
      equivalencias: cmd.detalles.map(() => '1'),
    };
  }

  /** Bancos y bodegas los siembra el administrador: plataforma no es de inventario. */
  async function borrarBancos(): Promise<void> {
    await admin.$executeRaw`DELETE FROM plataforma.bodega WHERE banco_id IN (${bancoA}::uuid, ${bancoB}::uuid)`;
    await admin.$executeRaw`DELETE FROM plataforma.banco WHERE id IN (${bancoA}::uuid, ${bancoB}::uuid)`;
    await admin.$executeRaw`DELETE FROM plataforma.red WHERE id = ${red}::uuid`;
  }

  async function filasDe(bancoId: string): Promise<Record<string, number>> {
    const conteo: Record<string, number> = {};
    for (const tabla of TABLAS) {
      const [fila] = await admin.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM inventario.${tabla} WHERE banco_id = '${bancoId}'`,
      );
      conteo[tabla] = Number(fila?.n ?? 0);
    }
    return conteo;
  }

  async function auditoriaDe(entidadId: string) {
    return admin.$queryRaw<
      { banco_id: string; actor_etiqueta: string; accion: string; detalle: unknown }[]
    >`SELECT banco_id::text, actor_etiqueta, accion, detalle
      FROM core.auditoria WHERE entidad = 'recepcion' AND entidad_id = ${entidadId}`;
  }

  beforeAll(async () => {
    admin = new PrismaClient({ datasourceUrl: URL_ADMIN });
    await borrarBancos();
    await admin.$executeRaw`INSERT INTO plataforma.red (id, nombre) VALUES (${red}::uuid, 'Red de recepciones')`;
    await admin.$executeRaw`
      INSERT INTO plataforma.banco (id, red_id, nombre, codigo)
      VALUES (${bancoA}::uuid, ${red}::uuid, 'Banco A', 'REC-A'),
             (${bancoB}::uuid, ${red}::uuid, 'Banco B', 'REC-B')`;
    await admin.$executeRaw`
      INSERT INTO plataforma.bodega (id, banco_id, nombre, activa)
      VALUES (${bodega}::uuid, ${bancoA}::uuid, 'Santa Isabel', true),
             (${bodegaDeB}::uuid, ${bancoB}::uuid, 'Bodega del banco B', true),
             (${bodegaCerrada}::uuid, ${bancoA}::uuid, 'Cerritos', false)`;
    app = new PrismaClient({ datasourceUrl: urlComoRolApp(URL_ADMIN as string) });
    // PrismaService es un PrismaClient; aquí va uno conectado con el rol de la app.
    const prisma = app as PrismaService;
    const auditoria = new AuditService();
    repositorio = new RecepcionesPrismaRepositorio(prisma, new IdempotenciaService(), auditoria);
    donantes = new DonantesService(new DonantesPrismaRepositorio(prisma, auditoria));
    referencias = new ReferenciasService(
      new ReferenciasPrismaRepositorio(prisma, auditoria, new IdempotenciaService()),
    );
    servicio = new RecepcionesService(
      repositorio,
      donantes,
      new BodegasService(new BodegasPrismaRepositorio(prisma, auditoria)),
      referencias,
    );
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

  it('las cuatro tablas tienen RLS activo y forzado', async () => {
    const tablas = await admin.$queryRaw<{ relname: string; rls: boolean; forzado: boolean }[]>`
      SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS forzado
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'inventario' AND c.relname = ANY(${TABLAS})
      ORDER BY c.relname`;

    expect(tablas).toEqual(
      [...TABLAS].sort().map((relname) => ({ relname, rls: true, forzado: true })),
    );
  });

  it('cinco referencias dan cinco movimientos de entrada, sus lotes y una auditoría en menos de 1 s', async () => {
    const { donante, referencias: cinco } = await datosDelBanco(bancoA);
    const cmd = comando(
      donante.id,
      cinco.map((r) => r.id),
    );

    const inicio = performance.now();
    const { recepcion, repetida } = await enBanco(bancoA, () => servicio.registrar(cmd));
    const milisegundos = performance.now() - inicio;

    expect(milisegundos).toBeLessThan(1000);
    expect(repetida).toBe(false);
    expect(await filasDe(bancoA)).toEqual({
      recepcion: 1,
      lote: 5,
      movimiento: 5,
      recepcion_detalle: 5,
    });

    const movimientos = await admin.movimiento.findMany({
      where: { bancoId: bancoA },
      orderBy: { cantidad: 'asc' },
    });
    expect(
      movimientos.map((m) => [
        m.id,
        m.tipo,
        m.comandoId,
        m.cantidad.toString(),
        m.kilos.toString(),
      ]),
    ).toEqual([
      [cmd.detalles[0]?.movimientoId, 'entrada', cmd.comandoId, '1', '0.5'],
      [cmd.detalles[1]?.movimientoId, 'entrada', cmd.comandoId, '2', '2'],
      [cmd.detalles[2]?.movimientoId, 'entrada', cmd.comandoId, '3', '15'],
      [cmd.detalles[3]?.movimientoId, 'entrada', cmd.comandoId, '4', '50'],
      [cmd.detalles[4]?.movimientoId, 'entrada', cmd.comandoId, '5', '250'],
    ]);
    expect(movimientos.every((m) => m.bodegaId === bodega && m.creadoPor === ACTOR)).toBe(true);
    // Sin precio vigente aprobado, pendiente: nunca en cero (ADR-13).
    expect(
      recepcion.detalles.map((d) => [d.cantidad, d.kilos, d.lote, d.vencimiento, d.valoracion]),
    ).toEqual([
      ['1', '0.5', 'L-1', '2027-03-31', 'pendiente'],
      ['2', '2', 'L-2', '2027-03-31', 'pendiente'],
      ['3', '15', 'L-3', '2027-03-31', 'pendiente'],
      ['4', '50', 'L-4', '2027-03-31', 'pendiente'],
      ['5', '250', 'L-5', '2027-03-31', 'pendiente'],
    ]);
    expect(await auditoriaDe(recepcion.id)).toEqual([
      { banco_id: bancoA, actor_etiqueta: ACTOR, accion: 'crear', detalle: { cantidad: 5 } },
    ]);
  });

  it('guarda el lote sin vencimiento si el producto no trae fecha, y el reenvío es el mismo', async () => {
    const { donante, referencias: cinco } = await datosDelBanco(bancoA);
    const cmd = comando(donante.id, [cinco[0]?.id ?? '']);
    const sinFecha = { ...cmd, detalles: cmd.detalles.map((d) => ({ ...d, vencimiento: null })) };

    const { recepcion } = await enBanco(bancoA, () => servicio.registrar(sinFecha));
    const reenvio = await enBanco(bancoA, () => servicio.registrar(sinFecha));

    expect(recepcion.detalles.map((d) => d.vencimiento)).toEqual([null]);
    expect(reenvio.repetida).toBe(true);
    const [lote] = await admin.$queryRaw<{ vencimiento: Date | null }[]>`
      SELECT vencimiento FROM inventario.lote WHERE recepcion_id = ${recepcion.id}::uuid`;
    expect(lote?.vencimiento).toBeNull();
  });

  it('si una fila falla, no queda nada escrito, ni la reserva del comando', async () => {
    const { donante, referencias: cinco } = await datosDelBanco(bancoA);
    const conFilaMala = datos(donante.id, [cinco[0]?.id ?? '', uuidv7(), cinco[2]?.id ?? '']);

    // Directo al repositorio: el servicio rechazaría la referencia antes de
    // abrir la transacción, y lo que se prueba aquí es la transacción.
    await expect(enBanco(bancoA, () => repositorio.registrar(conFilaMala))).rejects.toThrow(
      'La recepción nombra un donante o una referencia que no existe.',
    );

    expect(await filasDe(bancoA)).toEqual({
      recepcion: 0,
      lote: 0,
      movimiento: 0,
      recepcion_detalle: 0,
    });
    const reservas = await admin.$queryRaw<unknown[]>`
      SELECT 1 FROM core.comando_procesado WHERE comando_id = ${conFilaMala.comandoId}::uuid`;
    expect(reservas).toEqual([]);
  });

  describe('filas que no se editan (ADR-08)', () => {
    it('sigba_app no tiene UPDATE ni DELETE en las cuatro tablas', async () => {
      const { donante, referencias: cinco } = await datosDelBanco(bancoA);
      await enBanco(bancoA, () => servicio.registrar(comando(donante.id, [cinco[0]?.id ?? ''])));

      for (const tabla of TABLAS) {
        await expect(
          comoApp(bancoA, `UPDATE inventario.${tabla} SET creado_por = 'otro'`),
        ).rejects.toThrow(/permission denied/);
        await expect(comoApp(bancoA, `DELETE FROM inventario.${tabla}`)).rejects.toThrow(
          /permission denied/,
        );
      }
    });

    it('recepción, lote y movimiento rechazan UPDATE y DELETE también al administrador', async () => {
      const { donante, referencias: cinco } = await datosDelBanco(bancoA);
      await enBanco(bancoA, () => servicio.registrar(comando(donante.id, [cinco[0]?.id ?? ''])));

      for (const tabla of ['recepcion', 'lote', 'movimiento']) {
        const enA = `WHERE banco_id = '${bancoA}'`;
        await expect(
          admin.$executeRawUnsafe(`UPDATE inventario.${tabla} SET creado_por = 'otro' ${enA}`),
        ).rejects.toThrow(/append-only/);
        await expect(
          admin.$executeRawUnsafe(`DELETE FROM inventario.${tabla} ${enA}`),
        ).rejects.toThrow(/append-only/);
      }
      const [movimiento] = await admin.movimiento.findMany({ where: { bancoId: bancoA } });
      expect(movimiento?.creadoPor).toBe(ACTOR);
    });

    it('del detalle solo cambia la valoración', async () => {
      const { donante, referencias: cinco } = await datosDelBanco(bancoA);
      await enBanco(bancoA, () => servicio.registrar(comando(donante.id, [cinco[0]?.id ?? ''])));
      const enA = `WHERE banco_id = '${bancoA}'`;

      await expect(
        admin.$executeRawUnsafe(
          `UPDATE inventario.recepcion_detalle
           SET valoracion = 'pendiente', actualizado_por = 'coordinacion', actualizado_en = now() ${enA}`,
        ),
      ).resolves.toBe(1);
      await expect(
        admin.$executeRawUnsafe(`UPDATE inventario.recepcion_detalle SET novedad = 'roto' ${enA}`),
      ).rejects.toThrow(/solo admite cambiar la valoración/);
      await expect(
        admin.$executeRawUnsafe(`DELETE FROM inventario.recepcion_detalle ${enA}`),
      ).rejects.toThrow(/solo admite cambiar la valoración/);
    });
  });

  describe('idempotencia', () => {
    it('el mismo comando enviado dos veces devuelve lo mismo, no duplica ni audita dos veces', async () => {
      const { donante, referencias: cinco } = await datosDelBanco(bancoA);
      const cmd = comando(
        donante.id,
        cinco.map((r) => r.id),
      );

      const primera = await enBanco(bancoA, () => servicio.registrar(cmd));
      const segunda = await enBanco(bancoA, () => servicio.registrar(cmd));

      expect(segunda.repetida).toBe(true);
      expect(segunda.recepcion).toEqual(primera.recepcion);
      expect(await filasDe(bancoA)).toEqual({
        recepcion: 1,
        lote: 5,
        movimiento: 5,
        recepcion_detalle: 5,
      });
      expect(await auditoriaDe(primera.recepcion.id)).toHaveLength(1);
    });

    it('el mismo comando con otra carga responde 409 y no escribe', async () => {
      const { donante, referencias: cinco } = await datosDelBanco(bancoA);
      const cmd = comando(donante.id, [cinco[0]?.id ?? '']);
      await enBanco(bancoA, () => servicio.registrar(cmd));

      const otra = { ...cmd, origen: 'abaco' as const };

      await expect(enBanco(bancoA, () => servicio.registrar(otra))).rejects.toThrow(
        'Este comando ya se procesó con otra carga.',
      );
      expect((await filasDe(bancoA)).recepcion).toBe(1);
    });

    it('un reenvío después de desactivar el donante devuelve la recepción, no 404', async () => {
      const { donante, referencias: cinco } = await datosDelBanco(bancoA);
      const cmd = comando(donante.id, [cinco[0]?.id ?? '']);
      const primera = await enBanco(bancoA, () => servicio.registrar(cmd));
      await admin.$executeRaw`UPDATE inventario.donante SET activo = false WHERE id = ${donante.id}::uuid`;

      const reenvio = await enBanco(bancoA, () => servicio.registrar(cmd));

      expect(reenvio).toEqual({ recepcion: primera.recepcion, repetida: true });
      expect((await filasDe(bancoA)).movimiento).toBe(1);
    });

    it('un movimiento que el banco ya tiene en el libro responde 409', async () => {
      const { donante, referencias: cinco } = await datosDelBanco(bancoA);
      const primero = comando(donante.id, [cinco[0]?.id ?? '']);
      await enBanco(bancoA, () => servicio.registrar(primero));

      const otro = comando(donante.id, [cinco[1]?.id ?? '']);
      otro.detalles[0] = { ...otro.detalles[0]!, movimientoId: primero.detalles[0]!.movimientoId };

      await expect(enBanco(bancoA, () => servicio.registrar(otro))).rejects.toThrow(
        'Uno de los movimientos ya está registrado.',
      );
      expect((await filasDe(bancoA)).recepcion).toBe(1);
    });
  });

  describe('aislamiento entre bancos (ADR-07)', () => {
    it('el banco B no ve la recepción del banco A', async () => {
      const { donante, referencias: cinco } = await datosDelBanco(bancoA);
      await enBanco(bancoA, () =>
        servicio.registrar(
          comando(
            donante.id,
            cinco.map((r) => r.id),
          ),
        ),
      );

      const visibles = await app.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.banco_id', ${bancoB}, true)`;
        return Promise.all(
          TABLAS.map((tabla) =>
            tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM inventario.${tabla}`),
          ),
        );
      });
      expect(visibles.map(([fila]) => Number(fila?.n))).toEqual([0, 0, 0, 0]);
    });

    it('con el contexto del banco B, un INSERT con el banco_id de A falla por la política', async () => {
      const otro = () => `'${randomUUID()}'`;
      const deA = `'${bancoA}'`;
      const inserciones = {
        recepcion: `INSERT INTO inventario.recepcion (banco_id, donante_id, origen, bodega_id, creado_por)
          VALUES (${deA}, ${otro()}, 'propia', ${otro()}, 'intruso')`,
        lote: `INSERT INTO inventario.lote
          (banco_id, recepcion_id, referencia_id, vencimiento, equivalencia_kg, creado_por)
          VALUES (${deA}, ${otro()}, ${otro()}, '2027-03-31', 1, 'intruso')`,
        movimiento: `INSERT INTO inventario.movimiento
          (id, banco_id, comando_id, tipo, referencia_id, lote_id, bodega_id, cantidad, kilos, creado_por)
          VALUES (${otro()}, ${deA}, ${otro()}, 'entrada', ${otro()}, ${otro()}, ${otro()}, 1, 1, 'intruso')`,
        recepcion_detalle: `INSERT INTO inventario.recepcion_detalle
          (banco_id, recepcion_id, orden, movimiento_id, creado_por, actualizado_por)
          VALUES (${deA}, ${otro()}, 0, ${otro()}, 'intruso', 'intruso')`,
      };

      for (const [tabla, sql] of Object.entries(inserciones)) {
        await expect(comoApp(bancoB, sql), tabla).rejects.toThrow(/row-level security/);
      }
      expect(await filasDe(bancoA)).toEqual({
        recepcion: 0,
        lote: 0,
        movimiento: 0,
        recepcion_detalle: 0,
      });
    });

    it('el banco B no registra con el donante ni con las referencias del banco A', async () => {
      const deA = await datosDelBanco(bancoA);
      const deB = await datosDelBanco(bancoB);

      await expect(
        enBanco(bancoB, () =>
          servicio.registrar(comando(deA.donante.id, [deB.referencias[0]?.id ?? ''])),
        ),
      ).rejects.toThrow('No existe ese donante o está desactivado.');
      await expect(
        enBanco(bancoB, () =>
          servicio.registrar(comando(deB.donante.id, [deA.referencias[0]?.id ?? ''], bodegaDeB)),
        ),
      ).rejects.toThrow('Fila 1: no existe esa referencia o está desactivada.');

      expect(await filasDe(bancoA)).toEqual({
        recepcion: 0,
        lote: 0,
        movimiento: 0,
        recepcion_detalle: 0,
      });
      expect((await filasDe(bancoB)).recepcion).toBe(0);
    });

    it('el banco B no registra en una bodega del banco A ni en una desactivada', async () => {
      const deA = await datosDelBanco(bancoA);
      const deB = await datosDelBanco(bancoB);

      await expect(
        enBanco(bancoB, () =>
          servicio.registrar(comando(deB.donante.id, [deB.referencias[0]?.id ?? ''], bodega)),
        ),
      ).rejects.toThrow('No existe esa bodega o está desactivada.');
      await expect(
        enBanco(bancoA, () =>
          servicio.registrar(
            comando(deA.donante.id, [deA.referencias[0]?.id ?? ''], bodegaCerrada),
          ),
        ),
      ).rejects.toThrow('No existe esa bodega o está desactivada.');

      expect((await filasDe(bancoA)).recepcion).toBe(0);
      expect((await filasDe(bancoB)).recepcion).toBe(0);
    });

    it('el banco B no escribe con el donante del banco A aunque se salte el servicio', async () => {
      const deA = await datosDelBanco(bancoA);
      const deB = await datosDelBanco(bancoB);

      await expect(
        enBanco(bancoB, () =>
          repositorio.registrar(datos(deA.donante.id, [deB.referencias[0]?.id ?? ''], bodegaDeB)),
        ),
      ).rejects.toThrow('La recepción nombra un donante o una referencia que no existe.');
      expect((await filasDe(bancoB)).recepcion).toBe(0);
    });

    it('cada banco tiene sus propias claves de comando y de movimiento', async () => {
      const deA = await datosDelBanco(bancoA);
      const deB = await datosDelBanco(bancoB);
      const deBancoA = comando(deA.donante.id, [deA.referencias[0]?.id ?? '']);
      await enBanco(bancoA, () => servicio.registrar(deBancoA));

      const mismasClaves = comando(deB.donante.id, [deB.referencias[0]?.id ?? ''], bodegaDeB);
      mismasClaves.comandoId = deBancoA.comandoId;
      mismasClaves.detalles[0] = {
        ...mismasClaves.detalles[0]!,
        movimientoId: deBancoA.detalles[0]!.movimientoId,
      };
      const enB = await enBanco(bancoB, () => servicio.registrar(mismasClaves));

      expect(enB.repetida).toBe(false);
      expect((await filasDe(bancoB)).movimiento).toBe(1);
    });
  });
});

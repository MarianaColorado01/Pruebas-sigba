import { randomUUID } from 'node:crypto';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AuditService,
  executeTransactionWithTenant,
  IdempotenciaService,
  type PrismaService,
  runWithTenantContext,
} from '../src/core/index.js';
import { BajasYAjustesPrismaRepositorio } from '../src/modules/inventario/repositories/bajas-y-ajustes.prisma.repositorio.js';
import { DonantesPrismaRepositorio } from '../src/modules/inventario/repositories/donantes.prisma.repositorio.js';
import { RecepcionesPrismaRepositorio } from '../src/modules/inventario/repositories/recepciones.prisma.repositorio.js';
import { ReferenciasPrismaRepositorio } from '../src/modules/inventario/repositories/referencias.prisma.repositorio.js';
import type {
  RegistrarAjuste,
  RegistrarBaja,
} from '../src/modules/inventario/services/baja-y-ajuste.js';
import { BajasYAjustesService } from '../src/modules/inventario/services/bajas-y-ajustes.service.js';
import { DonantesService } from '../src/modules/inventario/services/donantes.service.js';
import { RecepcionesService } from '../src/modules/inventario/services/recepciones.service.js';
import { ReferenciasService } from '../src/modules/inventario/services/referencias.service.js';
import { BodegasPrismaRepositorio } from '../src/modules/plataforma/repositories/bodegas.prisma.repositorio.js';
import { BodegasService } from '../src/modules/plataforma/services/bodegas.service.js';
import { urlComoRolApp } from './rol-de-aplicacion.js';

/**
 * Bajas y ajustes contra PostgreSQL (SBA-42, ADR-07, ADR-08).
 *
 * Conectado como `sigba_app`, con el servicio y el adaptador reales: el lote
 * llega por la recepción y la baja o el ajuste lo mueven por el libro. Prueba
 * que el saldo cambia en la misma transacción que el movimiento y su motivo,
 * que una baja sin saldo no deja nada, que el reenvío no resta dos veces, que
 * el motivo no se edita y que un banco no ve ni mueve lo de otro.
 */

const URL_ADMIN = process.env['DATABASE_URL'];

if (process.env['CI'] && !URL_ADMIN) {
  throw new Error(
    'DATABASE_URL no está definida en CI. La prueba de aislamiento no es opcional (RNF-01).',
  );
}

const ACTOR = 'coordinacion-prueba';

describe.skipIf(!URL_ADMIN)('Bajas y ajustes contra PostgreSQL (SBA-42)', () => {
  let admin: PrismaClient;
  let app: PrismaClient;
  let recepciones: RecepcionesService;
  let donantes: DonantesService;
  let catalogo: ReferenciasService;
  let servicio: BajasYAjustesService;

  const bancoA = 'aaaaaaaa-4242-4424-8424-aaaaaaaaaaaa';
  const bancoB = 'bbbbbbbb-4242-4424-8424-bbbbbbbbbbbb';
  const red = 'ffffffff-4242-4424-8424-ffffffffffff';
  const bodega = 'cccccccc-4242-4424-8424-cccccccccccc';
  const bodegaDeB = 'dddddddd-4242-4424-8424-dddddddddddd';
  const otraBodega = 'eeeeeeee-4242-4424-8424-eeeeeeeeeeee';

  function enBanco<R>(bancoId: string, fn: () => Promise<R>): Promise<R> {
    return runWithTenantContext({ bancoId, actor: ACTOR }, fn) as Promise<R>;
  }

  async function saldoDe(loteId: string) {
    const fila = await admin.saldo.findUnique({
      where: { bancoId_bodegaId_loteId: { bancoId: bancoA, bodegaId: bodega, loteId } },
    });
    return fila ? [fila.cantidad.toString(), fila.kilos.toString()] : null;
  }

  interface Lote {
    loteId: string;
    referenciaId: string;
  }

  let medioKilo: string;
  let donante: string;

  /** Recibe la bolsa de 500 g en la cantidad pedida y devuelve su lote. */
  async function recibir(cantidad: number): Promise<Lote> {
    const { recepcion } = await enBanco(bancoA, () =>
      recepciones.registrar({
        comandoId: randomUUID(),
        donanteId: donante,
        origen: 'propia',
        bodegaId: bodega,
        detalles: [{ movimientoId: randomUUID(), referenciaId: medioKilo, cantidad }],
      }),
    );
    const [detalle] = recepcion.detalles;
    if (!detalle) throw new Error('La recepción no devolvió su detalle.');
    return { loteId: detalle.loteId, referenciaId: detalle.referenciaId };
  }

  function baja(lote: Lote, cambios: Partial<RegistrarBaja> = {}): RegistrarBaja {
    return {
      comandoId: randomUUID(),
      movimientoId: randomUUID(),
      bodegaId: bodega,
      ...lote,
      cantidad: 10,
      motivo: 'no_apto',
      ...cambios,
    };
  }

  function ajuste(lote: Lote, cambios: Partial<RegistrarAjuste> = {}): RegistrarAjuste {
    return {
      comandoId: randomUUID(),
      movimientoId: randomUUID(),
      bodegaId: bodega,
      ...lote,
      cantidad: '-2',
      motivo: 'Conteo de cierre de mes',
      ...cambios,
    };
  }

  async function filasDeA() {
    const [baja, ajuste, movimiento, comando] = await Promise.all([
      admin.baja.count({ where: { bancoId: bancoA } }),
      admin.ajuste.count({ where: { bancoId: bancoA } }),
      admin.movimiento.count({ where: { bancoId: bancoA, tipo: { in: ['baja', 'ajuste'] } } }),
      admin.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM core.comando_procesado
        WHERE banco_id = ${bancoA}::uuid AND entidad IN ('baja', 'ajuste')`,
    ]);
    return { baja, ajuste, movimiento, comando: Number(comando[0]?.n ?? 0) };
  }

  async function limpiar(): Promise<void> {
    // El libro y los motivos rechazan DELETE con un trigger; el administrador
    // los apaga solo para esta transacción. Exige superusuario.
    const enBancos = `banco_id IN ('${bancoA}', '${bancoB}')`;
    const tablas = [
      'baja',
      'ajuste',
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
    await admin.$executeRaw`INSERT INTO plataforma.red (id, nombre) VALUES (${red}::uuid, 'Red de bajas')`;
    await admin.$executeRaw`
      INSERT INTO plataforma.banco (id, red_id, nombre, codigo)
      VALUES (${bancoA}::uuid, ${red}::uuid, 'Banco A', 'BAJ-A'),
             (${bancoB}::uuid, ${red}::uuid, 'Banco B', 'BAJ-B')`;
    await admin.$executeRaw`
      INSERT INTO plataforma.bodega (id, banco_id, nombre, activa)
      VALUES (${bodega}::uuid, ${bancoA}::uuid, 'Santa Isabel', true),
             (${otraBodega}::uuid, ${bancoA}::uuid, 'Dosquebradas', true),
             (${bodegaDeB}::uuid, ${bancoB}::uuid, 'Cuba', true)`;
    app = new PrismaClient({ datasourceUrl: urlComoRolApp(URL_ADMIN as string) });
    // PrismaService es un PrismaClient; aquí va uno conectado con el rol de la app.
    const prisma = app as PrismaService;
    const auditoria = new AuditService();
    const bodegas = new BodegasService(new BodegasPrismaRepositorio(prisma, auditoria));
    catalogo = new ReferenciasService(
      new ReferenciasPrismaRepositorio(prisma, auditoria, new IdempotenciaService()),
    );
    donantes = new DonantesService(new DonantesPrismaRepositorio(prisma, auditoria));
    recepciones = new RecepcionesService(
      new RecepcionesPrismaRepositorio(prisma, new IdempotenciaService(), auditoria),
      donantes,
      bodegas,
      catalogo,
    );
    servicio = new BajasYAjustesService(
      new BajasYAjustesPrismaRepositorio(prisma, new IdempotenciaService(), auditoria),
      bodegas,
    );
  });

  beforeEach(async () => {
    await limpiar();
    ({ medioKilo, donante } = await enBanco(bancoA, async () => {
      const { id: donanteId } = await donantes.crear({
        nombre: 'Supermercado La 14',
        tipo: 'empresa',
      });
      const categoria = await catalogo.crearCategoria({ codigo: 'C801', nombre: 'Arroz' });
      const producto = await catalogo.crearProducto({ categoriaId: categoria.id, nombre: 'Arroz' });
      const referencia = await catalogo.crearReferencia({
        productoId: producto.id,
        presentacion: '500 g',
        equivalenciaKg: '0.5',
      });
      return { medioKilo: referencia.id, donante: donanteId };
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

  describe('baja', () => {
    it('una baja de 10 unidades baja 10 el saldo del lote y deja el movimiento con su motivo', async () => {
      const lote = await recibir(25);

      const { movimiento, repetida } = await enBanco(bancoA, () =>
        servicio.darDeBaja(baja(lote, { motivo: 'roto' })),
      );

      expect(repetida).toBe(false);
      expect(await saldoDe(lote.loteId)).toEqual(['15', '7.5']);
      expect(movimiento).toMatchObject({
        tipo: 'baja',
        cantidad: '-10',
        kilos: '-5',
        motivo: 'roto',
      });
      const enLibro = await admin.movimiento.findUniqueOrThrow({
        where: { bancoId_id: { bancoId: bancoA, id: movimiento.movimientoId } },
        include: { baja: true },
      });
      expect(enLibro).toMatchObject({ tipo: 'baja', creadoPor: ACTOR, baja: { motivo: 'roto' } });
    });

    it('queda en auditoría con actor, banco y fecha', async () => {
      const lote = await recibir(25);
      const antes = new Date();

      const { movimiento } = await enBanco(bancoA, () => servicio.darDeBaja(baja(lote)));

      const filas = await admin.$queryRaw<
        { banco_id: string; actor_etiqueta: string; accion: string; ocurrido_en: Date }[]
      >`SELECT banco_id::text, actor_etiqueta, accion, ocurrido_en
        FROM core.auditoria WHERE entidad = 'baja' AND entidad_id = ${movimiento.movimientoId}`;
      expect(filas).toEqual([
        { banco_id: bancoA, actor_etiqueta: ACTOR, accion: 'crear', ocurrido_en: expect.any(Date) },
      ]);
      expect(filas[0]?.ocurrido_en.getTime()).toBeGreaterThanOrEqual(antes.getTime() - 1000);
    });

    it('una baja mayor que el saldo responde 409 y no deja movimiento, motivo ni comando', async () => {
      const lote = await recibir(5);

      await expect(
        enBanco(bancoA, () => servicio.darDeBaja(baja(lote, { cantidad: 6 }))),
      ).rejects.toThrow(ConflictException);

      expect(await saldoDe(lote.loteId)).toEqual(['5', '2.5']);
      expect(await filasDeA()).toEqual({ baja: 0, ajuste: 0, movimiento: 0, comando: 0 });
    });

    it('el reenvío del mismo comando devuelve la misma baja y no resta otra vez', async () => {
      const lote = await recibir(25);
      const comando = baja(lote);

      const primera = await enBanco(bancoA, () => servicio.darDeBaja(comando));
      const segunda = await enBanco(bancoA, () => servicio.darDeBaja(comando));

      expect(segunda).toEqual({ movimiento: primera.movimiento, repetida: true });
      expect(await saldoDe(lote.loteId)).toEqual(['15', '7.5']);
      expect(await filasDeA()).toMatchObject({ baja: 1, movimiento: 1 });
    });

    it('un reenvío después de desactivar la bodega devuelve la misma baja, no 404', async () => {
      // La baja deja la bodega en cero: con stock no se puede desactivar (SBA-76).
      const lote = await recibir(10);
      const comando = baja(lote);
      const primera = await enBanco(bancoA, () => servicio.darDeBaja(comando));

      await admin.$executeRaw`UPDATE plataforma.bodega SET activa = false WHERE id = ${bodega}::uuid`;
      try {
        const segunda = await enBanco(bancoA, () => servicio.darDeBaja(comando));

        expect(segunda).toEqual({ movimiento: primera.movimiento, repetida: true });
        expect(await saldoDe(lote.loteId)).toEqual(['0', '0']);
      } finally {
        await admin.$executeRaw`UPDATE plataforma.bodega SET activa = true WHERE id = ${bodega}::uuid`;
      }
    });

    it('pesa con la equivalencia del lote aunque el catálogo la haya corregido', async () => {
      const lote = await recibir(25);
      await enBanco(bancoA, () => catalogo.editarReferencia(medioKilo, { equivalenciaKg: '1' }));

      const { movimiento } = await enBanco(bancoA, () => servicio.darDeBaja(baja(lote)));

      expect(movimiento).toMatchObject({ cantidad: '-10', kilos: '-5' });
      expect(await saldoDe(lote.loteId)).toEqual(['15', '7.5']);
    });

    it('el mismo comando como ajuste responde 409', async () => {
      const lote = await recibir(25);
      const comando = baja(lote);
      await enBanco(bancoA, () => servicio.darDeBaja(comando));

      await expect(
        enBanco(bancoA, () =>
          servicio.ajustar({ ...comando, cantidad: '-10', motivo: 'Otro motivo' }),
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('un lote de otra referencia responde 404', async () => {
      const lote = await recibir(25);

      await expect(
        enBanco(bancoA, () => servicio.darDeBaja(baja({ ...lote, referenciaId: donante }))),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('ajuste', () => {
    it('un ajuste negativo resta, uno positivo suma, y cada uno guarda su motivo', async () => {
      const lote = await recibir(25);

      await enBanco(bancoA, () => servicio.ajustar(ajuste(lote)));
      const { movimiento } = await enBanco(bancoA, () =>
        servicio.ajustar(
          ajuste(lote, { cantidad: '0.5', motivo: 'Media bolsa sin registrar en el conteo' }),
        ),
      );

      expect(await saldoDe(lote.loteId)).toEqual(['23.5', '11.75']);
      expect(movimiento).toMatchObject({
        tipo: 'ajuste',
        cantidad: '0.5',
        kilos: '0.25',
        motivo: 'Media bolsa sin registrar en el conteo',
      });
      expect(await filasDeA()).toMatchObject({ ajuste: 2, movimiento: 2 });
    });

    it('un ajuste positivo en una bodega donde el lote nunca estuvo responde 409 y no deja nada', async () => {
      const lote = await recibir(25);

      await expect(
        enBanco(bancoA, () =>
          servicio.ajustar(ajuste(lote, { bodegaId: otraBodega, cantidad: '3' })),
        ),
      ).rejects.toThrow(ConflictException);
      expect(await filasDeA()).toMatchObject({ ajuste: 0, movimiento: 0 });
    });

    it('rechaza un ajuste sin motivo y no deja nada', async () => {
      const lote = await recibir(25);

      await expect(
        enBanco(bancoA, () => servicio.ajustar(ajuste(lote, { motivo: '  ' }))),
      ).rejects.toThrow('El ajuste necesita un motivo.');

      expect(await saldoDe(lote.loteId)).toEqual(['25', '12.5']);
      expect(await filasDeA()).toEqual({ baja: 0, ajuste: 0, movimiento: 0, comando: 0 });
    });

    it('la base tampoco acepta un ajuste con el motivo vacío', async () => {
      const lote = await recibir(25);

      await expect(
        enBanco(bancoA, () =>
          executeTransactionWithTenant(app, async (tx) => {
            const id = randomUUID();
            await tx.movimiento.createMany({
              data: [
                {
                  id,
                  bancoId: bancoA,
                  comandoId: randomUUID(),
                  tipo: 'ajuste',
                  bodegaId: bodega,
                  ...lote,
                  cantidad: 1,
                  kilos: 0.5,
                  creadoPor: ACTOR,
                },
              ],
            });
            await tx.ajuste.createMany({
              data: [{ bancoId: bancoA, movimientoId: id, motivo: ' ', creadoPor: ACTOR }],
            });
          }),
        ),
      ).rejects.toThrow(/ajuste_motivo_no_vacio/);
    });
  });

  describe('el motivo no se edita (ADR-08)', () => {
    /** SQL crudo como sigba_app, con el banco fijado en la transacción. */
    function comoApp(sql: string) {
      return app.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.banco_id', ${bancoA}, true)`;
        return tx.$executeRawUnsafe(sql);
      });
    }

    it.each(['baja', 'ajuste'])('%s no admite UPDATE ni DELETE', async (tabla) => {
      const lote = await recibir(25);
      await enBanco(bancoA, () => servicio.darDeBaja(baja(lote)));
      await enBanco(bancoA, () => servicio.ajustar(ajuste(lote)));

      await expect(comoApp(`UPDATE inventario.${tabla} SET creado_por = 'otro'`)).rejects.toThrow(
        /permission denied/,
      );
      await expect(comoApp(`DELETE FROM inventario.${tabla}`)).rejects.toThrow(/permission denied/);
      await expect(
        admin.$executeRawUnsafe(
          `UPDATE inventario.${tabla} SET creado_por = 'otro' WHERE banco_id = '${bancoA}'`,
        ),
      ).rejects.toThrow(/append-only/);
      await expect(
        admin.$executeRawUnsafe(`DELETE FROM inventario.${tabla} WHERE banco_id = '${bancoA}'`),
      ).rejects.toThrow(/append-only/);
    });
  });

  describe('aislamiento entre bancos (ADR-07)', () => {
    it.each(['baja', 'ajuste'])('%s tiene RLS activo y forzado', async (tabla) => {
      const [fila] = await admin.$queryRawUnsafe<{ rls: boolean; forzado: boolean }[]>(
        `SELECT relrowsecurity AS rls, relforcerowsecurity AS forzado
         FROM pg_class WHERE oid = 'inventario.${tabla}'::regclass`,
      );

      expect(fila).toEqual({ rls: true, forzado: true });
    });

    it('el banco B no ve las bajas ni los ajustes del banco A', async () => {
      const lote = await recibir(25);
      await enBanco(bancoA, () => servicio.darDeBaja(baja(lote)));
      await enBanco(bancoA, () => servicio.ajustar(ajuste(lote)));

      const vistos = await enBanco(bancoB, () =>
        executeTransactionWithTenant(app, async (tx) => [
          await tx.baja.count(),
          await tx.ajuste.count(),
        ]),
      );

      expect(vistos).toEqual([0, 0]);
    });

    it('el banco B no da de baja un lote del banco A: 404 y el saldo no cambia', async () => {
      const lote = await recibir(25);

      await expect(
        enBanco(bancoB, () => servicio.darDeBaja(baja(lote, { bodegaId: bodegaDeB }))),
      ).rejects.toThrow(NotFoundException);
      expect(await saldoDe(lote.loteId)).toEqual(['25', '12.5']);
    });

    it('el banco B no usa una bodega del banco A', async () => {
      const lote = await recibir(25);

      await expect(
        enBanco(bancoB, () => servicio.ajustar(ajuste(lote, { cantidad: '3' }))),
      ).rejects.toThrow('No existe esa bodega o está desactivada.');
    });
  });
});

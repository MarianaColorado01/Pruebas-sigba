import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AuditService,
  IdempotenciaService,
  OutboxService,
  type PrismaService,
  runWithTenantContext,
} from '../src/core/index.js';
import { InstitucionesService } from '../src/modules/beneficiarios/index.js';
import { DonantesPrismaRepositorio } from '../src/modules/inventario/repositories/donantes.prisma.repositorio.js';
import { PreciosPrismaRepositorio } from '../src/modules/inventario/repositories/precios.prisma.repositorio.js';
import { RecepcionesPrismaRepositorio } from '../src/modules/inventario/repositories/recepciones.prisma.repositorio.js';
import { ReferenciasPrismaRepositorio } from '../src/modules/inventario/repositories/referencias.prisma.repositorio.js';
import { SalidasPrismaRepositorio } from '../src/modules/inventario/repositories/salidas.prisma.repositorio.js';
import { DonantesService } from '../src/modules/inventario/services/donantes.service.js';
import { PreciosService } from '../src/modules/inventario/services/precios.service.js';
import { RecepcionesService } from '../src/modules/inventario/services/recepciones.service.js';
import { ReferenciasService } from '../src/modules/inventario/services/referencias.service.js';
import { type RegistrarSalida, SalidaSinStock } from '../src/modules/inventario/services/salida.js';
import { SalidasService } from '../src/modules/inventario/services/salidas.service.js';
import { BodegasPrismaRepositorio } from '../src/modules/plataforma/repositories/bodegas.prisma.repositorio.js';
import { ParametrosPrismaRepositorio } from '../src/modules/plataforma/repositories/parametros.prisma.repositorio.js';
import { BodegasService } from '../src/modules/plataforma/services/bodegas.service.js';
import { ParametrosService } from '../src/modules/plataforma/services/parametros.service.js';
import { urlComoRolApp } from './rol-de-aplicacion.js';

/**
 * Salida a institución contra PostgreSQL (SBA-38, SBA-40, RF-M1-11).
 *
 * Conectado como `sigba_app`, con RLS de verdad. El stock entra por la
 * recepción real. La institución la valida beneficiarios (SBA-33); aquí es un
 * doble que solo conoce una institución activa por banco.
 */

const URL_ADMIN = process.env['DATABASE_URL'];

if (process.env['CI'] && !URL_ADMIN) {
  throw new Error(
    'DATABASE_URL no está definida en CI. La prueba de aislamiento no es opcional (RNF-01).',
  );
}

const ACTOR = 'despacho-prueba';
const contratos = JSON.parse(
  readFileSync(new URL('../../../docs/eventos/contratos.v1.json', import.meta.url), 'utf8'),
) as { $id: string };

describe.skipIf(!URL_ADMIN)('Salida a institución contra PostgreSQL (SBA-38)', () => {
  let admin: PrismaClient;
  let app: PrismaClient;
  let recepciones: RecepcionesService;
  let donantes: DonantesService;
  let catalogo: ReferenciasService;
  let precios: PreciosService;
  let parametros: ParametrosService;
  let salidas: SalidasService;

  const bancoA = 'aaaaaaaa-3838-4383-8383-aaaaaaaaaaaa';
  const bancoB = 'bbbbbbbb-3838-4383-8383-bbbbbbbbbbbb';
  const red = 'ffffffff-3838-4383-8383-ffffffffffff';
  const bodega = 'cccccccc-3838-4383-8383-cccccccccccc';
  const bodegaDeB = 'dddddddd-3838-4383-8383-dddddddddddd';
  const institucion = 'eeeeeeee-3838-4383-8383-eeeeeeeeeeee';
  const institucionDeB = 'eeeeeeee-3838-4383-8383-bbbbbbbbbbbb';
  /** Activa al empezar; la prueba de desactivación la cierra. */
  const institucionQueCierra = 'eeeeeeee-3838-4383-8383-cccccccccccc';
  const poblacionA = '99999999-3838-4383-8383-aaaaaaaaaaaa';
  const poblacionB = '99999999-3838-4383-8383-bbbbbbbbbbbb';

  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
  const enDias = (dias: number) =>
    new Date(Date.parse(hoy) + dias * 86_400_000).toISOString().slice(0, 10);

  let arroz: string;
  let frijol: string;
  let panela: string;
  let donante: string;

  function enBanco<R>(bancoId: string, fn: () => Promise<R>): Promise<R> {
    return runWithTenantContext({ bancoId, actor: ACTOR }, fn) as Promise<R>;
  }

  async function recibir(referenciaId: string, cantidad: number, vencimiento = enDias(60)) {
    const { recepcion } = await enBanco(bancoA, () =>
      recepciones.registrar({
        comandoId: randomUUID(),
        donanteId: donante,
        origen: 'propia',
        bodegaId: bodega,
        detalles: [{ movimientoId: randomUUID(), referenciaId, cantidad, lote: null, vencimiento }],
      }),
    );
    const [detalle] = recepcion.detalles;
    if (!detalle) throw new Error('La recepción no devolvió su detalle.');
    return detalle.loteId;
  }

  async function aprobarPrecio(referenciaId: string, valor: string, desde: string, hasta: string) {
    await enBanco(bancoA, async () => {
      const { precio } = await precios.proponer({
        comandoId: randomUUID(),
        referenciaId,
        valor,
        piso: '100',
        techo: '50000',
        fuente: 'sipsa',
        evidencia: 'SIPSA-P Pereira, sintético',
        vigenteDesde: desde,
        vigenteHasta: hasta,
      });
      await precios.aprobar({ comandoId: randomUUID(), precioId: precio.id });
    });
  }

  function salida(
    detalles: { referenciaId: string; loteId: string; cantidad: string }[],
    cambios: Partial<RegistrarSalida> = {},
  ): RegistrarSalida {
    return {
      comandoId: randomUUID(),
      institucionId: institucion,
      bodegaId: bodega,
      despachador: 'Operario sintético',
      despachadorTipo: 'voluntario',
      detalles: detalles.map((d) => ({ movimientoId: randomUUID(), ...d })),
      ...cambios,
    };
  }

  async function saldo(loteId: string): Promise<string | undefined> {
    const [fila] = await admin.$queryRaw<{ cantidad: string }[]>`
      SELECT trim_scale(cantidad)::text AS cantidad FROM inventario.saldo
      WHERE banco_id = ${bancoA}::uuid AND bodega_id = ${bodega}::uuid AND lote_id = ${loteId}::uuid`;
    return fila?.cantidad;
  }

  async function contar(tabla: string): Promise<number> {
    const [fila] = await admin.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM ${tabla} WHERE banco_id IN ('${bancoA}', '${bancoB}')`,
    );
    return Number(fila?.n ?? 0);
  }

  /** Solo los de la salida: recepción y precio también emiten (SBA-74). */
  async function eventosDeSalida(): Promise<number> {
    const [fila] = await admin.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM core.outbox
      WHERE banco_id IN (${bancoA}::uuid, ${bancoB}::uuid) AND tipo = 'SalidaRegistrada'`;
    return Number(fila?.n ?? 0);
  }

  async function limpiar(): Promise<void> {
    // Libro, salida y parámetros rechazan DELETE con un trigger; el
    // administrador lo apaga solo para esta transacción.
    const enBancos = `banco_id IN ('${bancoA}', '${bancoB}')`;
    const tablas = [
      'inventario.valoracion',
      'inventario.salida_detalle',
      'inventario.salida',
      'inventario.saldo',
      'inventario.recepcion_detalle',
      'inventario.movimiento',
      'inventario.lote',
      'inventario.recepcion',
      'inventario.precio',
      'inventario.referencia',
      'inventario.producto',
      'inventario.categoria',
      'inventario.donante',
      'core.comando_procesado',
      'core.outbox',
      'plataforma.parametro_banco',
    ];
    await admin.$transaction([
      admin.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`),
      ...tablas.map((tabla) => admin.$executeRawUnsafe(`DELETE FROM ${tabla} WHERE ${enBancos}`)),
    ]);
  }

  async function borrarBancos(): Promise<void> {
    await admin.$executeRaw`DELETE FROM beneficiarios.institucion WHERE banco_id IN (${bancoA}::uuid, ${bancoB}::uuid)`;
    await admin.$executeRaw`DELETE FROM beneficiarios.tipo_poblacion WHERE banco_id IN (${bancoA}::uuid, ${bancoB}::uuid)`;
    await admin.$executeRaw`DELETE FROM plataforma.bodega WHERE banco_id IN (${bancoA}::uuid, ${bancoB}::uuid)`;
    await admin.$executeRaw`DELETE FROM plataforma.banco WHERE id IN (${bancoA}::uuid, ${bancoB}::uuid)`;
    await admin.$executeRaw`DELETE FROM plataforma.red WHERE id = ${red}::uuid`;
  }

  beforeAll(async () => {
    admin = new PrismaClient({ datasourceUrl: URL_ADMIN });
    await limpiar();
    await borrarBancos();
    await admin.$executeRaw`INSERT INTO plataforma.red (id, nombre) VALUES (${red}::uuid, 'Red de salidas')`;
    await admin.$executeRaw`
      INSERT INTO plataforma.banco (id, red_id, nombre, codigo)
      VALUES (${bancoA}::uuid, ${red}::uuid, 'Banco A', 'SAL-A'),
             (${bancoB}::uuid, ${red}::uuid, 'Banco B', 'SAL-B')`;
    await admin.$executeRaw`
      INSERT INTO plataforma.bodega (id, banco_id, nombre, activa)
      VALUES (${bodega}::uuid, ${bancoA}::uuid, 'Santa Isabel', true),
             (${bodegaDeB}::uuid, ${bancoB}::uuid, 'Cuba', true)`;
    await admin.$executeRaw`
      INSERT INTO beneficiarios.tipo_poblacion (id, banco_id, nombre)
      VALUES (${poblacionA}::uuid, ${bancoA}::uuid, 'Familias'),
             (${poblacionB}::uuid, ${bancoB}::uuid, 'Familias')`;
    await admin.$executeRaw`
      INSERT INTO beneficiarios.institucion
        (id, banco_id, nombre, tipo, contacto_nombre, tipo_poblacion_id, activa)
      VALUES (${institucion}::uuid, ${bancoA}::uuid, 'Parroquia sintética', 'parroquia',
              'Contacto A', ${poblacionA}::uuid, true),
             (${institucionQueCierra}::uuid, ${bancoA}::uuid, 'Fundación sintética', 'fundacion',
              'Contacto A', ${poblacionA}::uuid, true),
             (${institucionDeB}::uuid, ${bancoB}::uuid, 'Comunidad sintética', 'comunidad_religiosa',
              'Contacto B', ${poblacionB}::uuid, true)`;
    app = new PrismaClient({ datasourceUrl: urlComoRolApp(URL_ADMIN as string) });
    const prisma = app as PrismaService;
    const auditoria = new AuditService();
    const idempotencia = new IdempotenciaService();
    catalogo = new ReferenciasService(
      new ReferenciasPrismaRepositorio(prisma, auditoria, idempotencia),
    );
    donantes = new DonantesService(new DonantesPrismaRepositorio(prisma, auditoria));
    const bodegas = new BodegasService(new BodegasPrismaRepositorio(prisma, auditoria));
    recepciones = new RecepcionesService(
      new RecepcionesPrismaRepositorio(prisma, idempotencia, auditoria, new OutboxService()),
      donantes,
      bodegas,
      catalogo,
    );
    precios = new PreciosService(
      new PreciosPrismaRepositorio(prisma, idempotencia, auditoria, new OutboxService()),
    );
    parametros = new ParametrosService(new ParametrosPrismaRepositorio(prisma, auditoria));
    salidas = new SalidasService(
      new SalidasPrismaRepositorio(
        prisma,
        idempotencia,
        auditoria,
        new OutboxService(),
        new InstitucionesService(),
      ),
      bodegas,
      parametros,
    );
  });

  beforeEach(async () => {
    await limpiar();
    ({ arroz, frijol, panela, donante } = await enBanco(bancoA, async () => {
      const { id: donanteId } = await donantes.crear({
        nombre: 'Donante sintético',
        tipo: 'empresa',
      });
      const granos = await catalogo.crearCategoria({ codigo: 'C801', nombre: 'Granos' });
      const referencia = async (nombre: string) => {
        const producto = await catalogo.crearProducto({ categoriaId: granos.id, nombre });
        return (
          await catalogo.crearReferencia({
            productoId: producto.id,
            presentacion: '1 kg',
            equivalenciaKg: '1',
          })
        ).id;
      };
      return {
        arroz: await referencia('Arroz'),
        frijol: await referencia('Fríjol'),
        panela: await referencia('Panela'),
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

  it('tres referencias con stock: bajan los saldos y quedan tres movimientos de salida, auditoría y el evento', async () => {
    const [loteArroz, loteFrijol, lotePanela] = [
      await recibir(arroz, 10),
      await recibir(frijol, 8),
      await recibir(panela, 5),
    ];
    const comando = salida([
      { referenciaId: arroz, loteId: loteArroz, cantidad: '4' },
      { referenciaId: frijol, loteId: loteFrijol, cantidad: '2.5' },
      { referenciaId: panela, loteId: lotePanela, cantidad: '5' },
    ]);

    const { salida: registrada, repetida } = await enBanco(bancoA, () =>
      salidas.registrar(comando),
    );

    expect(repetida).toBe(false);
    expect([await saldo(loteArroz), await saldo(loteFrijol), await saldo(lotePanela)]).toEqual([
      '6',
      '5.5',
      '0',
    ]);
    const movimientos = await admin.$queryRaw<{ tipo: string; cantidad: string }[]>`
      SELECT m.tipo::text, trim_scale(m.cantidad)::text AS cantidad FROM inventario.movimiento m
      WHERE m.banco_id = ${bancoA}::uuid AND m.comando_id = ${comando.comandoId}::uuid
      ORDER BY m.cantidad`;
    expect(movimientos).toEqual([
      { tipo: 'salida', cantidad: '-5' },
      { tipo: 'salida', cantidad: '-4' },
      { tipo: 'salida', cantidad: '-2.5' },
    ]);
    expect(registrada.detalles.map((d) => [d.loteId, d.cantidad])).toEqual([
      [loteArroz, '4'],
      [loteFrijol, '2.5'],
      [lotePanela, '5'],
    ]);

    const auditoria = await admin.$queryRaw<{ accion: string }[]>`
      SELECT accion FROM core.auditoria
      WHERE banco_id = ${bancoA}::uuid AND entidad = 'salida' AND entidad_id = ${registrada.id}`;
    expect(auditoria).toEqual([{ accion: 'crear' }]);

    const eventos = await admin.$queryRaw<{ tipo: string; version: number; payload: unknown }[]>`
      SELECT tipo, version, payload FROM core.outbox
      WHERE banco_id = ${bancoA}::uuid AND tipo = 'SalidaRegistrada'`;
    expect(eventos).toHaveLength(1);
    const valida = new Ajv2020({ strict: false })
      .addSchema(contratos)
      .getSchema(`${contratos.$id}#/$defs/SalidaRegistrada_v1`);
    expect(valida?.(eventos[0]), JSON.stringify(valida?.errors)).toBe(true);
    expect(eventos[0]?.payload).toMatchObject({
      salidaId: registrada.id,
      institucionId: institucion,
      despachadorTipo: 'voluntario',
    });
    expect(JSON.stringify(eventos[0]?.payload)).not.toContain('Operario sintético');
  });

  it('valora con el precio aprobado vigente y el aporte del banco; sin precio o con uno vencido queda pendiente', async () => {
    await enBanco(bancoA, () => parametros.actualizar('aporte_solidario_pct', 8));
    await aprobarPrecio(arroz, '2800', enDias(-10), enDias(20));
    await aprobarPrecio(frijol, '5000', enDias(-40), enDias(-1));
    const loteArroz = await recibir(arroz, 10);
    const loteFrijol = await recibir(frijol, 10);
    const lotePanela = await recibir(panela, 10);

    const { salida: registrada } = await enBanco(bancoA, () =>
      salidas.registrar(
        salida([
          { referenciaId: arroz, loteId: loteArroz, cantidad: '3' },
          { referenciaId: frijol, loteId: loteFrijol, cantidad: '1' },
          { referenciaId: panela, loteId: lotePanela, cantidad: '1' },
        ]),
      ),
    );

    expect(registrada.aportePct).toBe('8');
    expect(
      registrada.detalles.map(({ valoracion, valorUnitario, fuente, valorComercial, aporte }) => ({
        valoracion,
        valorUnitario,
        fuente,
        valorComercial,
        aporte,
      })),
    ).toEqual([
      {
        valoracion: 'con_precio',
        valorUnitario: '2800',
        fuente: 'sipsa',
        valorComercial: '8400',
        aporte: '672',
      },
      {
        valoracion: 'pendiente',
        valorUnitario: null,
        fuente: null,
        valorComercial: null,
        aporte: null,
      },
      {
        valoracion: 'pendiente',
        valorUnitario: null,
        fuente: null,
        valorComercial: null,
        aporte: null,
      },
    ]);

    // El evento lleva por línea lo mismo que RecepcionConfirmada (SBA-74).
    const [evento] = await admin.$queryRaw<{ payload: { detalles: unknown[] } }[]>`
      SELECT payload FROM core.outbox
      WHERE banco_id = ${bancoA}::uuid AND tipo = 'SalidaRegistrada'`;
    expect(evento?.payload.detalles).toEqual([
      expect.objectContaining({
        referenciaId: arroz,
        cantidad: 3,
        kilos: 3,
        valorUnitario: '2800',
        importe: '8400',
        aporte: '672',
      }),
      expect.objectContaining({
        referenciaId: frijol,
        valorUnitario: null,
        importe: null,
        aporte: null,
      }),
      expect.objectContaining({
        referenciaId: panela,
        valorUnitario: null,
        importe: null,
        aporte: null,
      }),
    ]);
  });

  it('un cambio posterior del porcentaje no cambia una salida anterior', async () => {
    await enBanco(bancoA, () => parametros.actualizar('aporte_solidario_pct', 8));
    await enBanco(bancoA, () => parametros.actualizar('aporte_solidario_pct', 10, enDias(1)));
    await aprobarPrecio(arroz, '1000', enDias(-1), enDias(10));
    const lote = await recibir(arroz, 10);
    const comando = salida([{ referenciaId: arroz, loteId: lote, cantidad: '1' }]);

    await enBanco(bancoA, () => salidas.registrar(comando));
    const { salida: leida } = await enBanco(bancoA, () => salidas.registrar(comando));

    expect([leida.aportePct, leida.detalles[0]?.aporte]).toEqual(['8', '80']);
  });

  it('el mismo comando dos veces devuelve la misma salida y no descuenta dos veces', async () => {
    const lote = await recibir(arroz, 10);
    const comando = salida([{ referenciaId: arroz, loteId: lote, cantidad: '4' }]);

    const primera = await enBanco(bancoA, () => salidas.registrar(comando));
    const segunda = await enBanco(bancoA, () => salidas.registrar(comando));

    expect(segunda).toEqual({ salida: primera.salida, repetida: true });
    expect(await saldo(lote)).toBe('6');
    expect(await eventosDeSalida()).toBe(1);
  });

  it('el mismo comando con otra carga responde 409 y no escribe', async () => {
    const lote = await recibir(arroz, 10);
    const comando = salida([{ referenciaId: arroz, loteId: lote, cantidad: '4' }]);
    await enBanco(bancoA, () => salidas.registrar(comando));

    await expect(
      enBanco(bancoA, () => salidas.registrar({ ...comando, despachadorTipo: 'funcionario' })),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await saldo(lote)).toBe('6');
  });

  it('sin stock responde 409 con lo que falta y no deja salida, movimientos, comando ni evento', async () => {
    const conStock = await recibir(arroz, 10);
    const corto = await recibir(frijol, 2);

    const error = await enBanco(bancoA, () =>
      salidas.registrar(
        salida([
          { referenciaId: arroz, loteId: conStock, cantidad: '4' },
          { referenciaId: frijol, loteId: corto, cantidad: '3' },
        ]),
      ),
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SalidaSinStock);
    expect((error as SalidaSinStock).faltantes).toEqual([
      { loteId: corto, referenciaId: frijol, solicitado: '3', disponible: '2' },
    ]);
    expect([await saldo(conStock), await saldo(corto)]).toEqual(['10', '2']);
    expect(await contar('inventario.salida')).toBe(0);
    expect(await eventosDeSalida()).toBe(0);
    // Solo los comandos de las dos recepciones.
    expect(await contar('core.comando_procesado')).toBe(2);
  });

  it('dos salidas a la vez sobre el mismo lote: una pasa y la otra recibe 409 sin stock', async () => {
    const lote = await recibir(arroz, 10);

    const resultados = await Promise.allSettled([
      enBanco(bancoA, () =>
        salidas.registrar(salida([{ referenciaId: arroz, loteId: lote, cantidad: '6' }])),
      ),
      enBanco(bancoA, () =>
        salidas.registrar(salida([{ referenciaId: arroz, loteId: lote, cantidad: '6' }])),
      ),
    ]);

    expect(resultados.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    const rechazo = resultados.find((r) => r.status === 'rejected');
    expect(rechazo?.reason).toBeInstanceOf(SalidaSinStock);
    expect(await saldo(lote)).toBe('4');
  });

  it('una institución desactivada responde 404 y no deja salida, movimientos, comando ni evento', async () => {
    const lote = await recibir(arroz, 10);
    await admin.$executeRaw`
      UPDATE beneficiarios.institucion SET activa = false WHERE id = ${institucionQueCierra}::uuid`;

    await expect(
      enBanco(bancoA, () =>
        salidas.registrar(
          salida([{ referenciaId: arroz, loteId: lote, cantidad: '1' }], {
            institucionId: institucionQueCierra,
          }),
        ),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await saldo(lote)).toBe('10');
    expect(await contar('inventario.salida')).toBe(0);
    expect(await eventosDeSalida()).toBe(0);
    expect(await contar('core.comando_procesado')).toBe(1);
  });

  it('lista solo las instituciones activas del banco, con id y nombre', async () => {
    await expect(enBanco(bancoB, () => salidas.institucionesActivas())).resolves.toEqual([
      { id: institucionDeB, nombre: 'Comunidad sintética' },
    ]);
  });

  it('un lote vencido no se despacha', async () => {
    const lote = await recibir(arroz, 10, enDias(-1));

    await expect(
      enBanco(bancoA, () =>
        salidas.registrar(salida([{ referenciaId: arroz, loteId: lote, cantidad: '1' }])),
      ),
    ).rejects.toThrow(/venció/);
    expect(await saldo(lote)).toBe('10');
  });

  it('la salida y su detalle no se editan ni se borran (ADR-08)', async () => {
    const lote = await recibir(arroz, 10);
    const { salida: registrada } = await enBanco(bancoA, () =>
      salidas.registrar(salida([{ referenciaId: arroz, loteId: lote, cantidad: '1' }])),
    );

    await expect(
      admin.$executeRaw`UPDATE inventario.salida SET despachador = 'otro' WHERE id = ${registrada.id}::uuid`,
    ).rejects.toThrow(/append-only/);
    await expect(
      admin.$executeRaw`DELETE FROM inventario.salida_detalle WHERE salida_id = ${registrada.id}::uuid`,
    ).rejects.toThrow(/append-only/);
  });

  describe('aislamiento entre bancos (ADR-07)', () => {
    it('el banco B ve cero salidas del banco A y no despacha sus lotes', async () => {
      const lote = await recibir(arroz, 10);
      await enBanco(bancoA, () =>
        salidas.registrar(salida([{ referenciaId: arroz, loteId: lote, cantidad: '1' }])),
      );

      const visibles = await app.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.banco_id', ${bancoB}, true)`;
        return tx.$queryRaw<{ n: bigint }[]>`
          SELECT (SELECT count(*) FROM inventario.salida)
               + (SELECT count(*) FROM inventario.salida_detalle) AS n`;
      });
      expect(Number(visibles[0]?.n)).toBe(0);

      await expect(
        enBanco(bancoB, () =>
          salidas.registrar(
            salida([{ referenciaId: arroz, loteId: lote, cantidad: '1' }], {
              institucionId: institucionDeB,
              bodegaId: bodegaDeB,
            }),
          ),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(await saldo(lote)).toBe('9');
    });
  });
});

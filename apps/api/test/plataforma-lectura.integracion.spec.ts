import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService, runWithTenantContext } from '../src/core/index.js';
import type { PrismaService } from '../src/core/database/index.js';
import { BodegasPrismaRepositorio } from '../src/modules/plataforma/repositories/bodegas.prisma.repositorio.js';
import { ParametrosPrismaRepositorio } from '../src/modules/plataforma/repositories/parametros.prisma.repositorio.js';
import { BodegasService } from '../src/modules/plataforma/services/bodegas.service.js';
import { ParametrosService } from '../src/modules/plataforma/services/parametros.service.js';
import { urlComoRolApp } from './rol-de-aplicacion.js';

const URL_ADMIN = process.env['DATABASE_URL'];
if (process.env['CI'] && !URL_ADMIN) {
  throw new Error('Falta DATABASE_URL en CI para probar la lectura de plataforma.');
}

/**
 * SBA-34: lectura de bodegas y parámetros con el rol real de la API
 * (`sigba_app`, sin BYPASSRLS). Los datos se siembran como administrador,
 * que no pasa por RLS, y se leen como la API.
 */
describe.skipIf(!URL_ADMIN)('Lectura de bodegas y parámetros contra PostgreSQL', () => {
  let admin: PrismaClient;
  let app: PrismaClient;
  let bodegas: BodegasService;
  let parametros: ParametrosService;
  const redId = randomUUID();
  const bancoA = randomUUID();
  const bancoB = randomUUID();
  const ids = {
    zonaNorte: randomUUID(),
    centro: randomUUID(),
    cerrada: randomUUID(),
    deOtroBanco: randomUUID(),
    aporteV1: randomUUID(),
    aporteV2: randomUUID(),
    retencionB: randomUUID(),
  };

  const comoBanco = <T>(bancoId: string, leer: () => Promise<T>) =>
    runWithTenantContext({ bancoId, actor: 'plataforma-lectura-integracion' }, leer);
  /** Mediodía en Bogotá del día dado. */
  const dia = (fecha: string) => new Date(`${fecha}T17:00:00.000Z`);

  beforeAll(async () => {
    admin = new PrismaClient({ datasourceUrl: URL_ADMIN as string });
    app = new PrismaClient({ datasourceUrl: urlComoRolApp(URL_ADMIN as string) });
    const auditoria = new AuditService();
    bodegas = new BodegasService(new BodegasPrismaRepositorio(app as PrismaService, auditoria));
    parametros = new ParametrosService(
      new ParametrosPrismaRepositorio(app as PrismaService, auditoria),
    );

    await admin.$executeRaw`INSERT INTO plataforma.red (id, nombre) VALUES (${redId}::uuid, 'SBA-34 integración')`;
    await admin.$executeRaw`
      INSERT INTO plataforma.banco (id, red_id, nombre, codigo)
      VALUES (${bancoA}::uuid, ${redId}::uuid, 'SBA-34 banco A', ${`S34-${bancoA.slice(0, 12).toUpperCase()}`}),
             (${bancoB}::uuid, ${redId}::uuid, 'SBA-34 banco B', ${`S34-${bancoB.slice(0, 12).toUpperCase()}`})`;
    await admin.$executeRaw`
      INSERT INTO plataforma.bodega (id, banco_id, nombre, direccion, activa, actualizado_en)
      VALUES (${ids.zonaNorte}::uuid, ${bancoA}::uuid, 'Zona Norte', NULL, true, now()),
             (${ids.centro}::uuid, ${bancoA}::uuid, 'Centro', 'Calle 1', true, now()),
             (${ids.cerrada}::uuid, ${bancoA}::uuid, 'Antigua', NULL, false, now()),
             (${ids.deOtroBanco}::uuid, ${bancoB}::uuid, 'Del banco B', NULL, true, now())`;
    await admin.$executeRaw`
      INSERT INTO plataforma.parametro_banco
        (id, banco_id, clave, valor, version, fecha_inicio, fecha_fin)
      VALUES (${ids.aporteV1}::uuid, ${bancoA}::uuid, 'aporte_solidario_pct', '8'::jsonb, 1,
              DATE '2026-09-01', DATE '2026-09-30'),
             (${ids.aporteV2}::uuid, ${bancoA}::uuid, 'aporte_solidario_pct', '10'::jsonb, 2,
              DATE '2026-10-01', NULL),
             (${ids.retencionB}::uuid, ${bancoB}::uuid, 'retencion_dias', '45'::jsonb, 1,
              DATE '2026-01-01', NULL)`;
  });

  afterAll(async () => {
    if (admin) await admin.$disconnect();
    if (app) await app.$disconnect();
  });

  it('lista las bodegas activas del banco por nombre, sin las inactivas', async () => {
    const lista = await comoBanco(bancoA, () => bodegas.listarActivas());

    expect(lista).toEqual([
      { id: ids.centro, nombre: 'Centro', direccion: 'Calle 1', activa: true },
      { id: ids.zonaNorte, nombre: 'Zona Norte', direccion: null, activa: true },
    ]);
  });

  it('obtiene por id la bodega inactiva y null la inexistente', async () => {
    await expect(comoBanco(bancoA, () => bodegas.obtenerPorId(ids.cerrada))).resolves.toEqual({
      id: ids.cerrada,
      nombre: 'Antigua',
      direccion: null,
      activa: false,
    });
    await expect(comoBanco(bancoA, () => bodegas.obtenerPorId(randomUUID()))).resolves.toBeNull();
  });

  it('no ve bodegas de otro banco, ni por listado ni por id', async () => {
    const lista = await comoBanco(bancoB, () => bodegas.listarActivas());
    expect(lista.map(({ id }) => id)).toEqual([ids.deOtroBanco]);
    await expect(
      comoBanco(bancoA, () => bodegas.obtenerPorId(ids.deOtroBanco)),
    ).resolves.toBeNull();
  });

  it('sin contexto de banco la lectura de bodegas falla', async () => {
    await expect(bodegas.listarActivas()).rejects.toThrow('sin banco en el contexto');
  });

  it.each([
    ['2026-09-30', 'aporteV1', 8],
    ['2026-10-01', 'aporteV2', 10],
    ['2026-11-15', 'aporteV2', 10],
  ] as const)('el aporte del %s es la versión %s', async (fecha, id, valor) => {
    await expect(
      comoBanco(bancoA, () => parametros.consultarVigente('aporte_solidario_pct', dia(fecha))),
    ).resolves.toMatchObject({ encontrado: true, parametroId: ids[id], valor });
  });

  it('antes de la primera vigencia responde SIN_VALOR_VIGENTE', async () => {
    await expect(
      comoBanco(bancoA, () =>
        parametros.consultarVigente('aporte_solidario_pct', dia('2026-08-31')),
      ),
    ).resolves.toEqual({
      encontrado: false,
      clave: 'aporte_solidario_pct',
      motivo: 'SIN_VALOR_VIGENTE',
      fecha: '2026-08-31',
    });
  });

  it('no ve parámetros de otro banco', async () => {
    await expect(
      comoBanco(bancoA, () => parametros.consultarVigente('retencion_dias', dia('2026-10-15'))),
    ).resolves.toMatchObject({ encontrado: false, motivo: 'SIN_VALOR_VIGENTE' });
    await expect(
      comoBanco(bancoB, () => parametros.consultarVigente('retencion_dias', dia('2026-10-15'))),
    ).resolves.toMatchObject({ encontrado: true, parametroId: ids.retencionB, valor: 45 });
  });

  it('sin contexto de banco la lectura de parámetros falla, no responde sin valor', async () => {
    await expect(
      parametros.consultarVigente('aporte_solidario_pct', dia('2026-10-15')),
    ).rejects.toThrow('sin banco en el contexto');
  });

  it('la base rechaza dos vigencias solapadas de la misma clave', async () => {
    await expect(admin.$executeRaw`
      INSERT INTO plataforma.parametro_banco
        (banco_id, clave, valor, version, fecha_inicio, fecha_fin)
      VALUES (${bancoA}::uuid, 'aporte_solidario_pct', '9'::jsonb, 3,
              DATE '2026-09-15', DATE '2026-09-20')`).rejects.toThrow(
      /parametro_banco_sin_solapamiento/,
    );
  });
});

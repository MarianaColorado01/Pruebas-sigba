import { type Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { executeTransactionWithTenant } from '../src/core/database/index.js';
import {
  type InstitucionDestino,
  InstitucionesService,
} from '../src/modules/beneficiarios/index.js';
import { urlComoRolApp } from './rol-de-aplicacion.js';

/**
 * `InstitucionesService` dentro de la transacción del llamador, con el rol de
 * la API (SBA-33, ADR-07). Un banco no ve instituciones de otro.
 */

const URL_ADMIN = process.env['DATABASE_URL'];

if (process.env['CI'] && !URL_ADMIN) {
  throw new Error(
    'DATABASE_URL no está definida en CI. La prueba de aislamiento no es opcional (RNF-01).',
  );
}

describe.skipIf(!URL_ADMIN)('InstitucionesService contra PostgreSQL (SBA-33)', () => {
  let admin: PrismaClient;
  let app: PrismaClient;
  const servicio = new InstitucionesService();

  const bancoA = '33333333-3333-3333-3333-33333333330a';
  const bancoB = '33333333-3333-3333-3333-33333333330b';
  const poblacionA = '3333aaaa-0000-0000-0000-00000000000a';
  const poblacionB = '3333bbbb-0000-0000-0000-00000000000b';
  const activaA = '3333aaaa-1111-0000-0000-000000000001';
  const inactivaA = '3333aaaa-1111-0000-0000-000000000002';
  const activaB = '3333bbbb-1111-0000-0000-000000000001';

  function enBanco<R>(bancoId: string, fn: (tx: Prisma.TransactionClient) => Promise<R>) {
    return executeTransactionWithTenant<R>(app, fn, { bancoId });
  }

  async function limpiar(): Promise<void> {
    const bancos = `'${bancoA}', '${bancoB}'`;
    await admin.$executeRawUnsafe(
      `DELETE FROM beneficiarios.institucion WHERE banco_id IN (${bancos})`,
    );
    await admin.$executeRawUnsafe(
      `DELETE FROM beneficiarios.tipo_poblacion WHERE banco_id IN (${bancos})`,
    );
  }

  beforeAll(async () => {
    admin = new PrismaClient({ datasourceUrl: URL_ADMIN });
    app = new PrismaClient({ datasourceUrl: urlComoRolApp(URL_ADMIN as string) });

    await limpiar();
    await admin.$executeRawUnsafe(
      `INSERT INTO beneficiarios.tipo_poblacion (id, banco_id, nombre) VALUES
         ('${poblacionA}', '${bancoA}', 'Familias'),
         ('${poblacionB}', '${bancoB}', 'Familias')`,
    );
    await admin.$executeRawUnsafe(
      `INSERT INTO beneficiarios.institucion
         (id, banco_id, nombre, tipo, contacto_nombre, tipo_poblacion_id, activa) VALUES
         ('${activaA}', '${bancoA}', 'Parroquia San José', 'parroquia', 'Contacto A', '${poblacionA}', true),
         ('${inactivaA}', '${bancoA}', 'Fundación Cerrada', 'fundacion', 'Contacto A', '${poblacionA}', false),
         ('${activaB}', '${bancoB}', 'Comunidad del Banco B', 'comunidad_religiosa', 'Contacto B', '${poblacionB}', true)`,
    );
  });

  afterAll(async () => {
    if (admin) {
      await limpiar();
      await admin.$disconnect();
    }
    if (app) await app.$disconnect();
  });

  it('obtener devuelve la institución del banco, también inactiva, sin datos de contacto', async () => {
    const [activa, inactiva] = await enBanco(bancoA, async (tx) => [
      await servicio.obtener(tx, activaA),
      await servicio.obtener(tx, inactivaA),
    ]);

    expect(activa).toEqual<InstitucionDestino>({
      id: activaA,
      nombre: 'Parroquia San José',
      tipo: 'parroquia',
      activa: true,
    });
    expect(inactiva).toMatchObject({ id: inactivaA, activa: false });
  });

  it('listarActivas devuelve solo las activas del banco', async () => {
    const lista = await enBanco(bancoA, (tx) => servicio.listarActivas(tx));

    expect(lista.map((i) => i.id)).toEqual([activaA]);
  });

  it('otro banco no ve ninguna institución del banco A', async () => {
    const [deA, lista] = await enBanco(
      bancoB,
      async (tx) =>
        [await servicio.obtener(tx, activaA), await servicio.listarActivas(tx)] as const,
    );

    expect(deA).toBeNull();
    expect(lista.map((i) => i.id)).toEqual([activaB]);
  });

  it('sin banco en el contexto no ve ninguna', async () => {
    const lista = await executeTransactionWithTenant(app, (tx) => servicio.listarActivas(tx), {
      bancoId: '',
    });

    expect(lista).toEqual([]);
  });
});

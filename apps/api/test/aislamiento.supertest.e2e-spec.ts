import type { Server } from 'node:http';
import { Controller, Get, INestApplication, Module, Param } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { executeTransactionWithTenant, PrismaService } from '../src/core/index.js';
import { urlComoRolApp, default as prepararRolDeAplicacion } from './rol-de-aplicacion.js';

const URL_ADMIN = process.env['DATABASE_URL'];
const bancoA = 'c1111111-1111-4111-8111-111111111111';
const bancoB = 'd2222222-2222-4222-8222-222222222222';
const redId = 'e3333333-3333-4333-8333-333333333333';

if (process.env['CI'] && !URL_ADMIN) {
  throw new Error('Falta DATABASE_URL en CI para la prueba HTTP de RLS.');
}

@Controller('test/rls')
class AislamientoController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('bodegas/:bancoId')
  bodegas(@Param('bancoId') bancoId: string) {
    return executeTransactionWithTenant<{ banco_id: string; nombre: string }[]>(
      this.prisma,
      (tx) => tx.$queryRaw`SELECT banco_id::text, nombre FROM plataforma.bodega`,
      { bancoId },
    );
  }
}

@Module({ controllers: [AislamientoController], providers: [PrismaService] })
class ModuloDePruebaRls {}

describe.skipIf(!URL_ADMIN)('Aislamiento RLS por HTTP', () => {
  let admin: PrismaClient;
  let app: INestApplication<Server>;

  async function limpiar(): Promise<void> {
    await admin.$executeRaw`DELETE FROM plataforma.bodega WHERE banco_id IN (${bancoA}::uuid, ${bancoB}::uuid)`;
    await admin.$executeRaw`DELETE FROM plataforma.banco WHERE id IN (${bancoA}::uuid, ${bancoB}::uuid)`;
    await admin.$executeRaw`DELETE FROM plataforma.red WHERE id = ${redId}::uuid`;
  }

  beforeAll(async () => {
    await prepararRolDeAplicacion();
    process.env['API_DATABASE_URL'] ??= urlComoRolApp(URL_ADMIN as string);
    admin = new PrismaClient({ datasourceUrl: URL_ADMIN });
    await limpiar();
    await admin.$executeRaw`INSERT INTO plataforma.red (id, nombre) VALUES (${redId}::uuid, 'Red HTTP de prueba')`;
    await admin.$executeRaw`
      INSERT INTO plataforma.banco (id, red_id, nombre, codigo)
      VALUES (${bancoA}::uuid, ${redId}::uuid, 'Banco HTTP A', 'HTTP-A'),
             (${bancoB}::uuid, ${redId}::uuid, 'Banco HTTP B', 'HTTP-B')`;
    await admin.$executeRaw`
      INSERT INTO plataforma.bodega (banco_id, nombre)
      VALUES (${bancoA}::uuid, 'Bodega HTTP A'), (${bancoB}::uuid, 'Bodega HTTP B')`;

    const modulo = await Test.createTestingModule({ imports: [ModuloDePruebaRls] }).compile();
    app = modulo.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (admin) {
      await limpiar();
      await admin.$disconnect();
    }
  });

  it('el banco A recibe por HTTP solo filas del banco A con el rol sin BYPASSRLS', async () => {
    const prisma = app.get(PrismaService);
    const [rol] = await prisma.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
      SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(rol?.rolsuper).toBe(false);
    expect(rol?.rolbypassrls).toBe(false);

    const respuesta = await request(app.getHttpServer())
      .get(`/test/rls/bodegas/${bancoA}`)
      .expect(200);
    expect(respuesta.body).toEqual([{ banco_id: bancoA, nombre: 'Bodega HTTP A' }]);
  });
});

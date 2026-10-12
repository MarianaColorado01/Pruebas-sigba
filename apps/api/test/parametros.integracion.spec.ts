import { createSign, generateKeyPairSync, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Auth0TokenVerifier } from '../src/core/auth/adapters/auth0/auth0-token-verifier.js';
import { TOKEN_VERIFIER } from '../src/core/auth/token-verifier.js';
import {
  AuditService,
  CoreModule,
  executeTransactionWithTenant,
  GUARDS_GLOBALES,
  PrismaService,
  runWithTenantContext,
} from '../src/core/index.js';
import type { PrismaService as PrismaServiceType } from '../src/core/database/index.js';
import { PlataformaModule } from '../src/modules/plataforma/index.js';
import { ParametrosPrismaRepositorio } from '../src/modules/plataforma/repositories/parametros.prisma.repositorio.js';
import { ParametrosService } from '../src/modules/plataforma/services/parametros.service.js';
import { urlComoRolApp } from './rol-de-aplicacion.js';

const URL_ADMIN = process.env['DATABASE_URL'];
if (process.env['CI'] && !URL_ADMIN) {
  throw new Error('Falta DATABASE_URL en CI para probar parámetros y RLS.');
}

describe.skipIf(!URL_ADMIN)('Parámetros por banco contra PostgreSQL', () => {
  let admin: PrismaClient;
  let app: PrismaClient;
  let servicio: ParametrosService;
  const redId = randomUUID();
  const bancoA = randomUUID();
  const bancoB = randomUUID();
  const usuarioA = randomUUID();
  const usuarioB = randomUUID();
  const actor = 'parametros-integracion';
  const emisor = 'https://prueba.sigba/';
  const audience = 'https://api.prueba.sigba/';
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = {
    ...publicKey.export({ format: 'jwk' }),
    kid: 'synthetic-test-key',
    use: 'sig',
    alg: 'RS256',
  };
  let jwksServer: Server;
  let nest: INestApplication;
  let jwksUri: string;
  let auditoria: AuditService;

  const conBanco = <T>(bancoId: string, ejecutar: () => Promise<T>) =>
    runWithTenantContext({ bancoId, actor }, ejecutar);

  function token(usuarioId: string): string {
    const ahora = Math.floor(Date.now() / 1000);
    const header = Buffer.from(
      JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'synthetic-test-key' }),
    ).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        iss: emisor,
        aud: audience,
        sub: `prueba|${usuarioId}`,
        iat: ahora,
        exp: ahora + 300,
      }),
    ).toString('base64url');
    const signingInput = `${header}.${payload}`;
    const signature = createSign('RSA-SHA256').update(signingInput).sign(privateKey);
    return `${signingInput}.${signature.toString('base64url')}`;
  }

  function como(usuarioId: string, bancoId: string): Record<string, string> {
    return {
      authorization: `Bearer ${token(usuarioId)}`,
      'x-banco-id': bancoId,
    };
  }

  function fechaFutura(dias: number): string {
    const partes = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Bogota',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
        .formatToParts(new Date())
        .map(({ type, value }) => [type, value]),
    );
    const anio = Number(partes['year']);
    const mes = Number(partes['month']);
    const dia = Number(partes['day']);
    const fecha = new Date(Date.UTC(anio, mes - 1, dia + dias));
    return fecha.toISOString().slice(0, 10);
  }

  beforeAll(async () => {
    admin = new PrismaClient({ datasourceUrl: URL_ADMIN as string });
    app = new PrismaClient({ datasourceUrl: urlComoRolApp(URL_ADMIN as string) });
    auditoria = new AuditService();
    await admin.$executeRaw`INSERT INTO plataforma.red (id, nombre) VALUES (${redId}::uuid, 'SBA-20 integración')`;
    await admin.$executeRaw`
      INSERT INTO plataforma.banco (id, red_id, nombre, codigo)
      VALUES (${bancoA}::uuid, ${redId}::uuid, 'SBA-20 banco A', ${`S20-${bancoA.slice(0, 12)}`}),
             (${bancoB}::uuid, ${redId}::uuid, 'SBA-20 banco B', ${`S20-${bancoB.slice(0, 12)}`})`;
    await admin.$executeRaw`
      INSERT INTO plataforma.usuario (id, emisor, auth0_sub, email, nombre, activo)
      VALUES (${usuarioA}::uuid, ${emisor}, ${`prueba|${usuarioA}`},
              ${`prueba+${usuarioA}@example.invalid`}, 'Admin parámetros A', true),
             (${usuarioB}::uuid, ${emisor}, ${`prueba|${usuarioB}`},
              ${`prueba+${usuarioB}@example.invalid`}, 'Admin parámetros B', true)`;
    await admin.$executeRaw`
      INSERT INTO plataforma.usuario_rol (usuario_id, rol_id, banco_id, institucion_id)
      SELECT ${usuarioA}::uuid, id, ${bancoA}::uuid, NULL
      FROM plataforma.rol WHERE codigo = 'admin_banco'`;
    await admin.$executeRaw`
      INSERT INTO plataforma.usuario_rol (usuario_id, rol_id, banco_id, institucion_id)
      SELECT ${usuarioB}::uuid, id, ${bancoB}::uuid, NULL
      FROM plataforma.rol WHERE codigo = 'admin_banco'`;
    jwksServer = createServer((request, response) => {
      if (request.url !== '/.well-known/jwks.json') {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ keys: [jwk] }));
    });
    await new Promise<void>((resolve) => jwksServer.listen(0, '127.0.0.1', resolve));
    const address = jwksServer.address();
    if (!address || typeof address === 'string') throw new Error('No se abrió el JWKS local');
    jwksUri = `http://127.0.0.1:${address.port}/.well-known/jwks.json`;

    servicio = new ParametrosService(
      new ParametrosPrismaRepositorio(app as PrismaServiceType, auditoria),
    );
    const modulo = await Test.createTestingModule({
      imports: [CoreModule, PlataformaModule],
      providers: GUARDS_GLOBALES,
    })
      .overrideProvider(TOKEN_VERIFIER)
      .useValue(new Auth0TokenVerifier({ issuer: emisor, audience, jwksUri }))
      .overrideProvider(PrismaService)
      .useValue(app)
      .compile();
    nest = modulo.createNestApplication();
    nest.setGlobalPrefix('api/v1');
    await nest.init();
  });

  afterAll(async () => {
    if (nest) await nest.close();
    if (jwksServer) await new Promise<void>((resolve) => jwksServer.close(() => resolve()));
    if (admin) await admin.$disconnect();
    if (app) await app.$disconnect();
  });

  it('mantiene RLS entre bancos con el rol real de la API', async () => {
    await conBanco(bancoA, () => servicio.actualizar('aporte_solidario_pct', 8));
    await conBanco(bancoB, () => servicio.actualizar('aporte_solidario_pct', 9));

    await expect(
      conBanco(bancoA, () => servicio.obtenerVigente('aporte_solidario_pct')),
    ).resolves.toMatchObject({ valor: 8 });
    const visibles = await executeTransactionWithTenant(
      app,
      (tx) => tx.$queryRaw<{ banco_id: string }[]>`
        SELECT banco_id::text FROM plataforma.parametro_banco
        WHERE clave = 'aporte_solidario_pct'`,
      { bancoId: bancoA },
    );
    expect(visibles).toEqual([{ banco_id: bancoA }]);
    const sinContexto = await executeTransactionWithTenant(
      app,
      (tx) => tx.$queryRaw<{ banco_id: string }[]>`
        SELECT banco_id::text FROM plataforma.parametro_banco
        WHERE clave = 'aporte_solidario_pct'`,
      {},
    );
    expect(sinContexto).toHaveLength(0);
    await expect(
      executeTransactionWithTenant(
        app,
        (tx) => tx.$executeRaw`
          INSERT INTO plataforma.parametro_banco
            (banco_id, clave, valor, version, fecha_inicio, creado_por)
          VALUES (
            ${bancoB}::uuid, 'retencion_dias', '45'::jsonb, 1,
            CURRENT_DATE, ${actor}
          )`,
        { bancoId: bancoA, actor },
      ),
    ).rejects.toThrow(/row-level security/i);
    const intentoDeBancoB = await executeTransactionWithTenant<{ cantidad: bigint }[]>(
      app,
      (tx) => tx.$queryRaw<{ cantidad: bigint }[]>`
        SELECT count(*) AS cantidad FROM plataforma.parametro_banco
        WHERE clave = 'retencion_dias'`,
      { bancoId: bancoB },
    );
    expect(intentoDeBancoB[0]?.cantidad).toBe(0n);

    const [rol] = await app.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
      SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(rol).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('incluye fecha_fin y devuelve null fuera del intervalo de vigencia', async () => {
    const bancoId = randomUUID();
    const clave = 'semaforo_amarillo_dias';
    const fechaInicio = fechaFutura(3);
    const fechaFin = fechaFutura(4);

    await admin.$executeRaw`
      INSERT INTO plataforma.banco (id, red_id, nombre, codigo)
      VALUES (
        ${bancoId}::uuid, ${redId}::uuid, 'Banco para límites de vigencia',
        ${`S20-${bancoId.slice(0, 12)}`}
      )`;
    await runWithTenantContext({ bancoId, actor }, () =>
      servicio.actualizar(clave, 5, fechaInicio),
    );
    const cierre = await executeTransactionWithTenant<{ count: number }>(
      app,
      (tx) =>
        tx.parametroBanco.updateMany({
          where: { clave, fechaFin: null },
          data: { fechaFin: new Date(`${fechaFin}T00:00:00.000Z`) },
        }),
      { bancoId, actor },
    );
    expect(cierre.count).toBe(1);

    await expect(
      runWithTenantContext({ bancoId, actor }, () =>
        servicio.obtenerVigente(clave, fechaFutura(2)),
      ),
    ).resolves.toBeNull();
    await expect(
      runWithTenantContext({ bancoId, actor }, () => servicio.obtenerVigente(clave, fechaFin)),
    ).resolves.toEqual({
      valor: 5,
      version: 1,
      fecha_inicio: fechaInicio,
      fecha_fin: fechaFin,
    });
    await expect(
      runWithTenantContext({ bancoId, actor }, () =>
        servicio.obtenerVigente(clave, fechaFutura(5)),
      ),
    ).resolves.toBeNull();
  });

  it('aísla lectura, historial y actualización por banco a través de la API', async () => {
    const vigenteA = await request(nest.getHttpServer())
      .get('/api/v1/parametros')
      .set(como(usuarioA, bancoA))
      .expect(200);
    const historialA = await request(nest.getHttpServer())
      .get('/api/v1/parametros/aporte_solidario_pct/historial')
      .set(como(usuarioA, bancoA))
      .expect(200);
    const vigenteB = await request(nest.getHttpServer())
      .get('/api/v1/parametros')
      .set(como(usuarioB, bancoB))
      .expect(200);
    const historialB = await request(nest.getHttpServer())
      .get('/api/v1/parametros/aporte_solidario_pct/historial')
      .set(como(usuarioB, bancoB))
      .expect(200);

    expect(vigenteA.body).toHaveLength(1);
    expect(vigenteA.body[0]).toMatchObject({ clave: 'aporte_solidario_pct', valor: 8 });
    expect(historialA.body).toHaveLength(1);
    expect(historialA.body[0]).toMatchObject({ valor: 8 });
    expect(vigenteB.body).toHaveLength(1);
    expect(vigenteB.body[0]).toMatchObject({ clave: 'aporte_solidario_pct', valor: 9 });
    expect(historialB.body).toHaveLength(1);
    expect(historialB.body[0]).toMatchObject({ valor: 9 });

    await request(nest.getHttpServer())
      .put('/api/v1/parametros/aporte_solidario_pct')
      .set(como(usuarioA, bancoA))
      .send({ valor: 10, fechaInicio: fechaFutura(2) })
      .expect(200);

    const historialBTrasActualizarA = await request(nest.getHttpServer())
      .get('/api/v1/parametros/aporte_solidario_pct/historial')
      .set(como(usuarioB, bancoB))
      .expect(200);
    expect(historialBTrasActualizarA.body).toHaveLength(1);
    expect(historialBTrasActualizarA.body[0]).toMatchObject({
      valor: 9,
      version: 1,
      fecha_fin: null,
    });
    const filasB = await executeTransactionWithTenant(
      app,
      (tx) =>
        tx.parametroBanco.findMany({
          where: { clave: 'aporte_solidario_pct' },
          select: { valor: true, version: true, fechaFin: true },
        }),
      { bancoId: bancoB },
    );
    expect(filasB).toEqual([{ valor: 9, version: 1, fechaFin: null }]);
  });

  it('serializa actualizaciones simultáneas y deja una sola versión abierta', async () => {
    const primeraInicio = fechaFutura(2);
    const inicio = fechaFutura(3);
    await conBanco(bancoA, () => servicio.actualizar('retencion_dias', 30, primeraInicio));
    const resultados = await Promise.allSettled([
      conBanco(bancoA, () => servicio.actualizar('retencion_dias', 31, inicio)),
      conBanco(bancoA, () => servicio.actualizar('retencion_dias', 32, inicio)),
    ]);

    expect(resultados.filter((resultado) => resultado.status === 'fulfilled')).toHaveLength(1);
    expect(resultados.filter((resultado) => resultado.status === 'rejected')).toHaveLength(1);
    const abiertas = await executeTransactionWithTenant(
      app,
      (tx) => tx.parametroBanco.count({ where: { clave: 'retencion_dias', fechaFin: null } }),
      { bancoId: bancoA },
    );
    expect(abiertas).toBe(1);
  });

  it('impide cambiar valores o borrar una versión, incluso con el usuario administrador', async () => {
    await conBanco(bancoB, () => servicio.actualizar('semaforo_amarillo_dias', 5));
    const [fila] = await executeTransactionWithTenant<{ id: string }[]>(
      app,
      (tx) =>
        tx.$queryRaw<{ id: string }[]>`
          SELECT id::text FROM plataforma.parametro_banco
          WHERE clave = 'semaforo_amarillo_dias'`,
      { bancoId: bancoB },
    );
    if (!fila) throw new Error('No se insertó el parámetro de prueba.');

    await expect(
      admin.$executeRaw`
        UPDATE plataforma.parametro_banco SET valor = '6'::jsonb
        WHERE id = ${fila.id}::uuid`,
    ).rejects.toThrow(/inmutable/i);
    await expect(
      admin.$executeRaw`
        DELETE FROM plataforma.parametro_banco WHERE id = ${fila.id}::uuid`,
    ).rejects.toThrow(/no permite DELETE/i);
  });

  it('registra cierre e inserción en auditoría bajo el mismo banco y actor', async () => {
    const primeraInicio = fechaFutura(2);
    const inicio = fechaFutura(3);
    await conBanco(bancoA, () => servicio.actualizar('semaforo_rojo_dias', 10, primeraInicio));
    await conBanco(bancoA, () => servicio.actualizar('semaforo_rojo_dias', 12, inicio));

    const auditorias = await executeTransactionWithTenant<
      { accion: string; actor_etiqueta: string; finalidad: string }[]
    >(
      app,
      (tx) =>
        tx.$queryRaw<{ accion: string; actor_etiqueta: string; finalidad: string }[]>`
          SELECT accion, actor_etiqueta, finalidad
          FROM core.auditoria
          WHERE entidad = 'plataforma.parametro_banco'
            AND finalidad LIKE 'clave=semaforo_rojo_dias;%'
          ORDER BY ocurrido_en`,
      { bancoId: bancoA },
    );

    expect(auditorias).toHaveLength(3);
    expect(auditorias.map((fila) => fila.accion).sort()).toEqual(['actualizar', 'crear', 'crear']);
    expect(auditorias.every((fila) => fila.actor_etiqueta === actor)).toBe(true);
    const finalidades = auditorias.map((fila) => fila.finalidad);
    expect(
      finalidades.some((finalidad) => finalidad.includes('version_anterior=0;version_nueva=1')),
    ).toBe(true);
    expect(
      finalidades.filter((finalidad) =>
        finalidad.includes(`version_anterior=1;version_nueva=2;fecha_inicio=${inicio}`),
      ),
    ).toHaveLength(2);
    const autores = await executeTransactionWithTenant<{ creado_por: string | null }[]>(
      app,
      (tx) =>
        tx.$queryRaw<{ creado_por: string | null }[]>`
          SELECT creado_por FROM plataforma.parametro_banco
          WHERE clave = 'semaforo_rojo_dias'
          ORDER BY version`,
      { bancoId: bancoA },
    );
    expect(autores).toEqual([{ creado_por: actor }, { creado_por: actor }]);
  });

  it('revierte el parámetro si falta actor para auditar la escritura', async () => {
    const clave = 'factor_minorista';
    await expect(
      runWithTenantContext({ bancoId: bancoA }, () => servicio.actualizar(clave, 1.25)),
    ).rejects.toThrow(/contexto de banco o actor/i);

    const cantidad = await executeTransactionWithTenant(
      app,
      (tx) => tx.parametroBanco.count({ where: { clave } }),
      { bancoId: bancoA },
    );
    const auditoria = await executeTransactionWithTenant<{ cantidad: bigint }[]>(
      app,
      (tx) =>
        tx.$queryRaw<{ cantidad: bigint }[]>`
          SELECT count(*) AS cantidad FROM core.auditoria
          WHERE entidad = 'plataforma.parametro_banco'
            AND finalidad LIKE 'clave=factor_minorista;%'`,
      { bancoId: bancoA },
    );
    expect(cantidad).toBe(0);
    expect(auditoria[0]?.cantidad).toBe(0n);
  });

  it('revierte el cierre, la nueva versión y la auditoría cuando falla el registro', async () => {
    const clave = 'factor_minorista';
    await conBanco(bancoA, () => servicio.actualizar(clave, 1.25, fechaFutura(2)));
    const registrar = vi.spyOn(auditoria, 'registrar');
    registrar.mockImplementation(async (tx, entrada) => {
      await new AuditService().registrar(tx, entrada);
      if (entrada.accion === 'actualizar') throw new Error('Fallo forzado de auditoría');
    });

    try {
      await expect(
        conBanco(bancoA, () => servicio.actualizar(clave, 1.5, fechaFutura(3))),
      ).rejects.toThrow('Fallo forzado de auditoría');
    } finally {
      registrar.mockRestore();
    }

    const versiones = await executeTransactionWithTenant(
      app,
      (tx) =>
        tx.parametroBanco.findMany({
          where: { clave },
          select: { valor: true, version: true, fechaFin: true },
          orderBy: { version: 'asc' },
        }),
      { bancoId: bancoA },
    );
    const auditoriasFallidas = await executeTransactionWithTenant(
      app,
      (tx) =>
        tx.$queryRaw<{ accion: string }[]>`
          SELECT accion FROM core.auditoria
          WHERE entidad = 'plataforma.parametro_banco'
            AND finalidad LIKE 'clave=factor_minorista;%'`,
      { bancoId: bancoA },
    );

    expect(versiones).toEqual([{ valor: 1.25, version: 1, fechaFin: null }]);
    expect(auditoriasFallidas).toEqual([{ accion: 'crear' }]);
  });
});

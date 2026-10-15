import { createSign, generateKeyPairSync } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Auth0TokenVerifier } from '../src/core/auth/adapters/auth0/auth0-token-verifier.js';
import { TOKEN_VERIFIER } from '../src/core/auth/token-verifier.js';
import { AuditService } from '../src/core/auditoria/audit.service.js';
import {
  CoreModule,
  GUARDS_GLOBALES,
  PrismaService,
  runWithTenantContext,
  type TenantContext,
} from '../src/core/index.js';
import { PlataformaModule } from '../src/modules/plataforma/index.js';
import {
  BancosPrismaRepositorio,
  RED_ABACO,
} from '../src/modules/plataforma/repositories/bancos.prisma.repositorio.js';
import { BodegasPrismaRepositorio } from '../src/modules/plataforma/repositories/bodegas.prisma.repositorio.js';
import { CodigoDeBancoRepetido } from '../src/modules/plataforma/services/banco.js';
import { NombreDeBodegaRepetido } from '../src/modules/plataforma/services/bodega.js';
import { urlComoRolApp } from './rol-de-aplicacion.js';

/**
 * Bancos y bodegas contra PostgreSQL (SBA-19, ADR-07, D7, D10, D11).
 *
 * Los repositorios se conectan con el rol sin privilegios de
 * `rol-de-aplicacion.ts`: RLS por banco en bodegas, la comprobación de
 * super_admin en las políticas de `banco` y la auditoría en la misma
 * transacción. Después, los controladores con el guard real: quién recibe 403.
 */

const URL_ADMIN = process.env['DATABASE_URL'];

if (process.env['CI'] && !URL_ADMIN) {
  throw new Error(
    'DATABASE_URL no está definida en CI. La prueba de aislamiento no es opcional (RNF-01).',
  );
}

const bancoA = 'b1900000-0000-4000-8000-00000000000a';
const bancoB = 'b1900000-0000-4000-8000-00000000000b';
/** Los bancos que crea la prueba llevan este prefijo de código para poder borrarlos. */
const PREFIJO = 'BYB-';

const USUARIOS = {
  superAdmin: 'b1900000-0000-4000-8000-000000000101',
  adminA: 'b1900000-0000-4000-8000-000000000102',
  operarioA: 'b1900000-0000-4000-8000-000000000103',
  adminB: 'b1900000-0000-4000-8000-000000000104',
} as const;
const IDS_USUARIOS = Object.values(USUARIOS);

const emisor = 'https://prueba-bancos.sigba/';
const audience = 'https://api.prueba-bancos.sigba/';
const sub = (id: string) => `prueba|${id}`;

describe.skipIf(!URL_ADMIN)('Bancos y bodegas contra PostgreSQL (SBA-19)', () => {
  let admin: PrismaClient;
  let app: PrismaClient;
  let bodegas: BodegasPrismaRepositorio;
  let bancos: BancosPrismaRepositorio;

  const como = <R>(contexto: TenantContext, fn: () => Promise<R>) =>
    runWithTenantContext(contexto, fn) as Promise<R>;
  const enBanco = <R>(bancoId: string, usuarioId: string, fn: () => Promise<R>) =>
    como({ bancoId, usuarioId }, fn);
  /** Como lo deja el guard para super_admin: usuario y sin banco. */
  const comoSuperAdmin = <R>(fn: () => Promise<R>) => como({ usuarioId: USUARIOS.superAdmin }, fn);

  async function limpiar(): Promise<void> {
    const creados = await admin.$queryRaw<{ id: string }[]>`
      SELECT id::text FROM plataforma.banco WHERE codigo LIKE ${PREFIJO + '%'}`;
    const ids = [bancoA, bancoB, ...creados.map((b) => b.id)];
    await admin.$executeRaw`DELETE FROM plataforma.usuario_rol WHERE usuario_id = ANY(${IDS_USUARIOS}::uuid[])`;
    await admin.$executeRaw`DELETE FROM plataforma.usuario WHERE id = ANY(${IDS_USUARIOS}::uuid[])`;
    await admin.$executeRaw`DELETE FROM plataforma.bodega WHERE banco_id = ANY(${ids}::uuid[])`;
    await admin.$executeRaw`DELETE FROM plataforma.banco WHERE id = ANY(${ids}::uuid[])`;
  }

  function asignar(usuario: string, rol: string, banco: string | null) {
    return admin.$executeRaw`
      INSERT INTO plataforma.usuario_rol (usuario_id, rol_id, banco_id)
      SELECT ${usuario}::uuid, id, ${banco}::uuid FROM plataforma.rol WHERE codigo = ${rol}`;
  }

  beforeAll(async () => {
    admin = new PrismaClient({ datasourceUrl: URL_ADMIN });
    app = new PrismaClient({ datasourceUrl: urlComoRolApp(URL_ADMIN as string) });
    // PrismaService es un PrismaClient; aquí va uno conectado con el rol de la app.
    bodegas = new BodegasPrismaRepositorio(app as PrismaService, new AuditService());
    bancos = new BancosPrismaRepositorio(app as PrismaService, new AuditService());

    await limpiar();
    await admin.$executeRaw`
      INSERT INTO plataforma.banco (id, red_id, nombre, codigo)
      VALUES (${bancoA}::uuid, ${RED_ABACO}::uuid, 'Banco A', 'BYBA'),
             (${bancoB}::uuid, ${RED_ABACO}::uuid, 'Banco B', 'BYBB')`;
    for (const [nombre, id] of Object.entries(USUARIOS)) {
      const email = `prueba+${id}@example.invalid`;
      await admin.$executeRaw`
        INSERT INTO plataforma.usuario (id, emisor, auth0_sub, email, nombre)
        VALUES (${id}::uuid, ${emisor}, ${sub(id)}, ${email}, ${nombre})`;
    }
    await asignar(USUARIOS.superAdmin, 'super_admin', null);
    await asignar(USUARIOS.adminA, 'admin_banco', bancoA);
    await asignar(USUARIOS.operarioA, 'operario_bodega', bancoA);
    await asignar(USUARIOS.adminB, 'admin_banco', bancoB);
  });

  beforeEach(async () => {
    await admin.$executeRaw`DELETE FROM plataforma.bodega WHERE banco_id IN (${bancoA}::uuid, ${bancoB}::uuid)`;
  });

  afterAll(async () => {
    if (admin) {
      await limpiar();
      await admin.$disconnect();
    }
    if (app) await app.$disconnect();
  });

  describe('bodegas', () => {
    it('crea en el banco del contexto con quién la creó', async () => {
      const bodega = await enBanco(bancoA, USUARIOS.adminA, () =>
        bodegas.crear({ nombre: 'Bodega central', direccion: null }),
      );

      const [fila] = await admin.$queryRaw<{ banco_id: string; creado_por: string }[]>`
        SELECT banco_id::text, creado_por FROM plataforma.bodega WHERE id = ${bodega.id}::uuid`;
      expect(fila).toEqual({ banco_id: bancoA, creado_por: USUARIOS.adminA });
    });

    it('el banco B ve cero bodegas del banco A', async () => {
      await enBanco(bancoA, USUARIOS.adminA, () =>
        bodegas.crear({ nombre: 'Bodega central', direccion: null }),
      );

      const vistas = await enBanco(bancoB, USUARIOS.adminB, () =>
        bodegas.listar({ soloActivas: false }),
      );

      expect(vistas).toEqual([]);
    });

    it('el banco B no puede editar ni desactivar una bodega del banco A', async () => {
      const { id } = await enBanco(bancoA, USUARIOS.adminA, () =>
        bodegas.crear({ nombre: 'Bodega central', direccion: null }),
      );

      const editada = await enBanco(bancoB, USUARIOS.adminB, () =>
        bodegas.actualizar(id, { activa: false }),
      );

      expect(editada).toBeNull();
      const [fila] = await admin.$queryRaw<{ activa: boolean }[]>`
        SELECT activa FROM plataforma.bodega WHERE id = ${id}::uuid`;
      expect(fila?.activa).toBe(true);
    });

    it('no deja crear una bodega con el banco de otro', async () => {
      await expect(
        app.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.banco_id', ${bancoA}, true)`;
          await tx.$executeRaw`INSERT INTO plataforma.bodega (banco_id, nombre)
            VALUES (${bancoB}::uuid, 'Intrusa')`;
        }),
      ).rejects.toThrow(/row-level security/);
    });

    it('rechaza un nombre repetido con otras mayúsculas en el banco y lo acepta en otro', async () => {
      await enBanco(bancoA, USUARIOS.adminA, () =>
        bodegas.crear({ nombre: 'Bodega central', direccion: null }),
      );

      await expect(
        enBanco(bancoA, USUARIOS.adminA, () =>
          bodegas.crear({ nombre: 'BODEGA CENTRAL', direccion: null }),
        ),
      ).rejects.toThrow(NombreDeBodegaRepetido);
      await expect(
        enBanco(bancoB, USUARIOS.adminB, () =>
          bodegas.crear({ nombre: 'Bodega central', direccion: null }),
        ),
      ).resolves.toBeDefined();
    });

    it('el nombre repetido lleva la bodega que choca para decidir si es un reenvío', async () => {
      const original = await enBanco(bancoA, USUARIOS.adminA, () =>
        bodegas.crear({ nombre: 'Bodega central', direccion: null }),
      );

      const error = await enBanco(bancoA, USUARIOS.adminA, () =>
        bodegas.crear({ nombre: 'BODEGA CENTRAL', direccion: null }),
      ).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(NombreDeBodegaRepetido);
      expect((error as NombreDeBodegaRepetido).existente).toEqual(original);
    });

    it('una bodega desactivada sale de las activas y vuelve al reactivarla', async () => {
      const { id } = await enBanco(bancoA, USUARIOS.adminA, () =>
        bodegas.crear({ nombre: 'Bodega central', direccion: null }),
      );

      await enBanco(bancoA, USUARIOS.adminA, () => bodegas.actualizar(id, { activa: false }));
      const activas = await enBanco(bancoA, USUARIOS.adminA, () =>
        bodegas.listar({ soloActivas: true }),
      );
      await enBanco(bancoA, USUARIOS.adminA, () => bodegas.actualizar(id, { activa: true }));
      const despues = await enBanco(bancoA, USUARIOS.adminA, () =>
        bodegas.listar({ soloActivas: true }),
      );

      expect(activas).toEqual([]);
      expect(despues.map((b) => b.id)).toEqual([id]);
    });

    it('crear, editar y desactivar quedan en auditoría con banco y actor (RNF-04, D16)', async () => {
      const { id } = await enBanco(bancoA, USUARIOS.adminA, () =>
        bodegas.crear({ nombre: 'Bodega central', direccion: null }),
      );
      await enBanco(bancoA, USUARIOS.adminA, () =>
        bodegas.actualizar(id, { nombre: 'Bodega norte', direccion: 'Calle 1' }),
      );
      await enBanco(bancoA, USUARIOS.adminA, () => bodegas.actualizar(id, { activa: false }));

      const registros = await admin.$queryRaw<
        { banco_id: string; actor_id: string; accion: string; detalle: unknown }[]
      >`
        SELECT banco_id::text, actor_id::text, accion, detalle FROM core.auditoria
        WHERE entidad = 'bodega' AND entidad_id = ${id}
        ORDER BY ocurrido_en, accion DESC`;
      expect(registros).toEqual([
        { banco_id: bancoA, actor_id: USUARIOS.adminA, accion: 'crear', detalle: null },
        {
          banco_id: bancoA,
          actor_id: USUARIOS.adminA,
          accion: 'actualizar',
          detalle: { camposModificados: ['nombre', 'direccion'] },
        },
        {
          banco_id: bancoA,
          actor_id: USUARIOS.adminA,
          accion: 'actualizar',
          detalle: { camposModificados: ['activa'] },
        },
      ]);
    });

    it('sin usuario en el contexto no escribe', async () => {
      await expect(
        como({ bancoId: bancoA }, () => bodegas.crear({ nombre: 'Bodega', direccion: null })),
      ).rejects.toThrow(/sin banco o sin usuario/);
    });
  });

  describe('bancos', () => {
    it('super_admin crea un banco en ABACO y la auditoría queda en el banco nuevo (D7)', async () => {
      const banco = await comoSuperAdmin(() =>
        bancos.crear({ nombre: 'Banco de prueba', codigo: `${PREFIJO}ALTA` }),
      );

      const [fila] = await admin.$queryRaw<{ red_id: string }[]>`
        SELECT red_id::text FROM plataforma.banco WHERE id = ${banco.id}::uuid`;
      const auditoria = await admin.$queryRaw<{ banco_id: string; actor_id: string }[]>`
        SELECT banco_id::text, actor_id::text FROM core.auditoria
        WHERE entidad = 'banco' AND entidad_id = ${banco.id} AND accion = 'crear'`;
      expect(banco).toMatchObject({ codigo: `${PREFIJO}ALTA`, activo: true });
      expect(fila?.red_id).toBe(RED_ABACO);
      expect(auditoria).toEqual([{ banco_id: banco.id, actor_id: USUARIOS.superAdmin }]);
    });

    it('super_admin edita y desactiva con la auditoría en ese banco', async () => {
      const { id } = await comoSuperAdmin(() =>
        bancos.crear({ nombre: 'Banco de prueba', codigo: `${PREFIJO}EDIT` }),
      );

      const editado = await comoSuperAdmin(() => bancos.actualizar(id, { nombre: 'Renombrado' }));
      const desactivado = await comoSuperAdmin(() => bancos.actualizar(id, { activo: false }));

      expect(editado?.nombre).toBe('Renombrado');
      expect(desactivado?.activo).toBe(false);
      const registros = await admin.$queryRaw<{ banco_id: string; detalle: unknown }[]>`
        SELECT banco_id::text, detalle FROM core.auditoria
        WHERE entidad = 'banco' AND entidad_id = ${id} AND accion = 'actualizar'
        ORDER BY ocurrido_en`;
      expect(registros).toEqual([
        { banco_id: id, detalle: { camposModificados: ['nombre'] } },
        { banco_id: id, detalle: { camposModificados: ['activo'] } },
      ]);
    });

    it('rechaza un código repetido', async () => {
      await comoSuperAdmin(() => bancos.crear({ nombre: 'Uno', codigo: `${PREFIJO}REP` }));

      await expect(
        comoSuperAdmin(() => bancos.crear({ nombre: 'Dos', codigo: `${PREFIJO}REP` })),
      ).rejects.toThrow(CodigoDeBancoRepetido);
    });

    it('la base no deja crear un banco con el contexto de un admin_banco', async () => {
      await expect(
        como({ usuarioId: USUARIOS.adminA }, () =>
          bancos.crear({ nombre: 'Colado', codigo: `${PREFIJO}COLADO` }),
        ),
      ).rejects.toThrow(/row-level security/);
    });

    it('la base no deja editar un banco con el contexto de un admin_banco', async () => {
      const editado = await como({ usuarioId: USUARIOS.adminA }, () =>
        bancos.actualizar(bancoA, { nombre: 'Tomado' }),
      );

      expect(editado).toBeNull();
      const [fila] = await admin.$queryRaw<{ nombre: string }[]>`
        SELECT nombre FROM plataforma.banco WHERE id = ${bancoA}::uuid`;
      expect(fila?.nombre).toBe('Banco A');
    });

    it('la base no deja escribir un banco distinto del de app.banco_id', async () => {
      const filas = await app.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.usuario_id', ${USUARIOS.superAdmin}, true)`;
        await tx.$executeRaw`SELECT set_config('app.banco_id', ${bancoA}, true)`;
        return tx.$executeRaw`UPDATE plataforma.banco SET nombre = 'Cruzado' WHERE id = ${bancoB}::uuid`;
      });

      expect(filas).toBe(0);
    });
  });

  describe('por HTTP, con el guard real', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'bancos', use: 'sig', alg: 'RS256' };
    let jwks: Server;
    let nest: INestApplication<Server>;

    function token(usuario: string): string {
      const ahora = Math.floor(Date.now() / 1000);
      const codificar = (valor: object) => Buffer.from(JSON.stringify(valor)).toString('base64url');
      const firmado = `${codificar({ alg: 'RS256', typ: 'JWT', kid: 'bancos' })}.${codificar({
        iss: emisor,
        aud: audience,
        sub: sub(usuario),
        iat: ahora,
        exp: ahora + 300,
      })}`;
      const firma = createSign('RSA-SHA256').update(firmado).sign(privateKey);
      return `${firmado}.${firma.toString('base64url')}`;
    }

    const http = (metodo: 'get' | 'post', ruta: string, usuario: string, banco?: string) => {
      const peticion = request(nest.getHttpServer())
        [metodo](ruta)
        .set('authorization', `Bearer ${token(usuario)}`);
      return banco ? peticion.set('x-banco-id', banco) : peticion;
    };

    beforeAll(async () => {
      jwks = createServer((_peticion, respuesta) => {
        respuesta.writeHead(200, { 'content-type': 'application/json' });
        respuesta.end(JSON.stringify({ keys: [jwk] }));
      });
      await new Promise<void>((listo) => jwks.listen(0, '127.0.0.1', listo));
      const direccion = jwks.address();
      if (!direccion || typeof direccion === 'string') throw new Error('No se abrió el JWKS');

      const modulo = await Test.createTestingModule({
        imports: [CoreModule, PlataformaModule],
        providers: GUARDS_GLOBALES,
      })
        .overrideProvider(TOKEN_VERIFIER)
        .useValue(
          new Auth0TokenVerifier({
            issuer: emisor,
            audience,
            jwksUri: `http://127.0.0.1:${direccion.port}/jwks.json`,
          }),
        )
        .overrideProvider(PrismaService)
        .useValue(app)
        .compile();
      nest = modulo.createNestApplication();
      await nest.init();
    });

    afterAll(async () => {
      if (nest) await nest.close();
      if (jwks) await new Promise<void>((listo) => jwks.close(() => listo()));
    });

    it('operario_bodega recibe 403 al crear una bodega', async () => {
      await http('post', '/bodegas', USUARIOS.operarioA, bancoA)
        .send({ nombre: 'Bodega del operario' })
        .expect(403);

      const filas = await admin.$queryRaw<unknown[]>`
        SELECT 1 FROM plataforma.bodega WHERE nombre = 'Bodega del operario'`;
      expect(filas).toEqual([]);
    });

    it('operario_bodega sí lista las bodegas activas de su banco', async () => {
      await http('post', '/bodegas', USUARIOS.adminA, bancoA)
        .send({ nombre: 'Central' })
        .expect(201);

      const respuesta = await http('get', '/bodegas', USUARIOS.operarioA, bancoA).expect(200);

      expect(respuesta.body).toEqual([
        { id: expect.any(String), nombre: 'Central', direccion: null, activa: true },
      ]);
    });

    it('admin_banco recibe 403 en bancos', async () => {
      await http('get', '/bancos', USUARIOS.adminA, bancoA).expect(403);
      await http('post', '/bancos', USUARIOS.adminA, bancoA)
        .send({ nombre: 'Colado', codigo: `${PREFIJO}HTTP-X` })
        .expect(403);
    });

    it('super_admin crea un banco por HTTP y un código repetido da 409', async () => {
      await http('post', '/bancos', USUARIOS.superAdmin)
        .send({ nombre: 'Banco HTTP', codigo: 'byb-http' })
        .expect(201);

      await http('post', '/bancos', USUARIOS.superAdmin)
        .send({ nombre: 'Otro', codigo: 'BYB-HTTP' })
        .expect(409);
    });

    it('crear la misma bodega dos veces da 201 y luego 200 con la misma fila', async () => {
      const carga = { nombre: 'Central', direccion: 'Calle 1' };
      const primera = await http('post', '/bodegas', USUARIOS.adminA, bancoA)
        .send(carga)
        .expect(201);

      const segunda = await http('post', '/bodegas', USUARIOS.adminA, bancoA)
        .send({ nombre: '  Central ', direccion: 'Calle 1' })
        .expect(200);

      expect(segunda.body).toEqual(primera.body);
      const [filas] = await admin.$queryRaw<{ total: number }[]>`
        SELECT count(*)::int AS total FROM plataforma.bodega WHERE banco_id = ${bancoA}::uuid`;
      expect(filas?.total).toBe(1);
      const [creaciones] = await admin.$queryRaw<{ auditorias: number }[]>`
        SELECT count(*)::int AS auditorias FROM core.auditoria
        WHERE entidad = 'bodega' AND entidad_id = ${primera.body.id} AND accion = 'crear'`;
      expect(creaciones?.auditorias).toBe(1);
    });

    it('crear el mismo banco dos veces da 201 y luego 200 con la misma fila', async () => {
      const carga = { nombre: 'Banco idempotente', codigo: 'byb-idem' };
      const primero = await http('post', '/bancos', USUARIOS.superAdmin).send(carga).expect(201);

      const segundo = await http('post', '/bancos', USUARIOS.superAdmin).send(carga).expect(200);

      expect(segundo.body).toEqual(primero.body);
      const [filas] = await admin.$queryRaw<{ total: number }[]>`
        SELECT count(*)::int AS total FROM plataforma.banco WHERE codigo = 'BYB-IDEM'`;
      expect(filas?.total).toBe(1);
      await http('post', '/bancos', USUARIOS.superAdmin)
        .send({ nombre: 'Otro nombre', codigo: 'BYB-IDEM' })
        .expect(409);
    });

    it('una bodega con el nombre de otra pero distintos datos da 409 y un campo desconocido, 400', async () => {
      await http('post', '/bodegas', USUARIOS.adminA, bancoA)
        .send({ nombre: 'Central' })
        .expect(201);

      await http('post', '/bodegas', USUARIOS.adminA, bancoA)
        .send({ nombre: 'Central', direccion: 'Calle 1' })
        .expect(409);
      await http('post', '/bodegas', USUARIOS.adminA, bancoA)
        .send({ nombre: 'central' })
        .expect(409);
      await http('post', '/bodegas', USUARIOS.adminA, bancoA)
        .send({ nombre: 'Otra', bancoId: bancoB })
        .expect(400);
    });
  });
});

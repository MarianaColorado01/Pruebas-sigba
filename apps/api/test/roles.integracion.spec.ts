import { createSign, generateKeyPairSync } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { Controller, Get, type INestApplication, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { Auth0TokenVerifier } from '../src/core/auth/adapters/auth0/auth0-token-verifier.js';
import { TOKEN_VERIFIER } from '../src/core/auth/token-verifier.js';
import { ROLES } from '@sigba/shared-types';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AsignacionesDeUsuario } from '../src/core/autorizacion/asignaciones-de-usuario.js';
import {
  CoreModule,
  executeTransactionWithTenant,
  GUARDS_GLOBALES,
  PrismaService,
  Roles,
  type TenantContext,
} from '../src/core/index.js';
import { HealthModule } from '../src/modules/health/index.js';
import { PlataformaModule } from '../src/modules/plataforma/index.js';
import { urlComoRolApp } from './rol-de-aplicacion.js';

/**
 * Roles por banco contra PostgreSQL de verdad (SBA-18, Arquitectura 8.2).
 *
 * Dos partes. La base: catálogo de roles, alcance de cada asignación y la
 * política que deja a cada usuario leer las suyas. La API: `@Roles()` con el
 * guard y el contexto reales, sobre un controlador de prueba, porque los
 * endpoints de precios y beneficiarios todavía no existen.
 */

const URL_ADMIN = process.env['DATABASE_URL'];
const URL_API = process.env['API_DATABASE_URL'];

if (process.env['CI'] && !URL_ADMIN) {
  throw new Error('DATABASE_URL no está definida en CI. La prueba de roles no es opcional.');
}
if (process.env['CI'] && !URL_API) {
  throw new Error(
    'API_DATABASE_URL no está definida en CI. La prueba del rol real no es opcional.',
  );
}

const red = '44444444-4444-4444-8444-444444444444';
const bancoA = '55555555-5555-4555-8555-555555555555';
const bancoB = '66666666-6666-4666-8666-666666666666';
const instX = '77777777-7777-4777-8777-777777777777';
const instY = '99999999-9999-4999-8999-999999999999';

/** Un usuario por caso, identificado por su `sub` de Auth0. */
const USUARIOS = {
  operario: '88888888-0000-4000-8000-000000000001',
  coordinacion: '88888888-0000-4000-8000-000000000002',
  institucion: '88888888-0000-4000-8000-000000000003',
  superAdmin: '88888888-0000-4000-8000-000000000004',
  adminA: '88888888-0000-4000-8000-000000000005',
  inactivo: '88888888-0000-4000-8000-000000000006',
  institucionY: '88888888-0000-4000-8000-000000000007',
} as const;

const sub = (id: string) => `prueba|${id}`;
const emisor = 'https://prueba.sigba/';
const audience = 'https://api.prueba.sigba/';
const IDS_USUARIOS = Object.values(USUARIOS);
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = {
  ...publicKey.export({ format: 'jwk' }),
  kid: 'synthetic-test-key',
  use: 'sig',
  alg: 'RS256',
};

let admin: PrismaClient;
let app: PrismaClient;
let api: PrismaClient | undefined;
let jwksServer: Server;
let jwksUri: string;

function token(usuarioSub: string, overrides: Record<string, unknown> = {}): string {
  const ahora = Math.floor(Date.now() / 1000);
  const header = Buffer.from(
    JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'synthetic-test-key' }),
  ).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      iss: emisor,
      aud: audience,
      sub: usuarioSub,
      iat: ahora,
      exp: ahora + 300,
      ...overrides,
    }),
  ).toString('base64url');
  const signingInput = `${header}.${payload}`;
  const signature = createSign('RSA-SHA256').update(signingInput).sign(privateKey);

  return `${signingInput}.${signature.toString('base64url')}`;
}

@Controller('prueba')
class PruebaController {
  @Roles('admin_banco', 'coordinacion')
  @Post('precios/aprobar')
  aprobarPrecio() {
    return { aprobado: true };
  }

  /** Sin pasar contexto a mano: lo pone el interceptor de `@Roles()`. */
  @Roles('institucion', 'admin_banco')
  @Get('contexto')
  async contexto() {
    const filas = await executeTransactionWithTenant<{ banco: string; institucion: string }[]>(
      app,
      (tx) => tx.$queryRaw<{ banco: string; institucion: string }[]>`
         SELECT current_setting('app.usuario_id', true) AS usuario,
           current_setting('app.banco_id', true) AS banco,
               current_setting('app.institucion_id', true) AS institucion`,
    );
    return filas[0];
  }

  @Roles('super_admin', 'admin_banco')
  @Get('bodegas')
  bodegas() {
    return executeTransactionWithTenant<{ nombre: string }[]>(
      app,
      (tx) => tx.$queryRaw<{ nombre: string }[]>`SELECT nombre FROM plataforma.bodega`,
    );
  }

  @Roles('institucion')
  @Get('asignaciones')
  asignaciones() {
    return executeTransactionWithTenant<{ institucion_id: string | null }[]>(
      app,
      (tx) => tx.$queryRaw<{ institucion_id: string | null }[]>`
        SELECT institucion_id FROM plataforma.usuario_rol`,
    );
  }
}

@Roles('admin_banco')
@Controller('prueba-dos-niveles')
class RolesEnDosNivelesController {
  @Roles('coordinacion')
  @Get()
  leer() {
    return { leido: true };
  }
}

async function limpiar(): Promise<void> {
  await admin.$executeRaw`DELETE FROM plataforma.usuario_rol WHERE usuario_id = ANY(${IDS_USUARIOS}::uuid[])`;
  await admin.$executeRaw`DELETE FROM plataforma.usuario WHERE id = ANY(${IDS_USUARIOS}::uuid[])`;
  await admin.$executeRaw`DELETE FROM plataforma.bodega WHERE banco_id IN (${bancoA}::uuid, ${bancoB}::uuid)`;
  await admin.$executeRaw`DELETE FROM plataforma.banco WHERE id IN (${bancoA}::uuid, ${bancoB}::uuid)`;
  await admin.$executeRaw`DELETE FROM plataforma.red WHERE id = ${red}::uuid`;
}

/** Los `banco_id` de `usuario_rol` que ve el rol de aplicación con ese contexto. */
async function bancosVisibles(contexto: TenantContext): Promise<(string | null)[]> {
  const filas = await executeTransactionWithTenant<{ banco_id: string | null }[]>(
    app,
    (tx) => tx.$queryRaw<{ banco_id: string | null }[]>`
      SELECT banco_id FROM plataforma.usuario_rol`,
    contexto,
  );
  return filas.map((f) => f.banco_id);
}

/** Inserta una asignación como administrador de la base, sin RLS. */
function asignar(usuario: string, rol: string, banco: string | null, institucion: string | null) {
  return admin.$executeRaw`
    INSERT INTO plataforma.usuario_rol (usuario_id, rol_id, banco_id, institucion_id)
    SELECT ${usuario}::uuid, id, ${banco}::uuid, ${institucion}::uuid
    FROM plataforma.rol WHERE codigo = ${rol}`;
}

describe.skipIf(!URL_ADMIN)('Roles por banco contra PostgreSQL (SBA-18)', () => {
  let nest: INestApplication<Server>;

  beforeAll(async () => {
    admin = new PrismaClient({ datasourceUrl: URL_ADMIN });
    app = new PrismaClient({ datasourceUrl: urlComoRolApp(URL_ADMIN as string) });
    if (URL_API) api = new PrismaClient({ datasourceUrl: URL_API });
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
    await limpiar();

    await admin.$executeRaw`INSERT INTO plataforma.red (id, nombre) VALUES (${red}::uuid, 'Red de roles')`;
    await admin.$executeRaw`
      INSERT INTO plataforma.banco (id, red_id, nombre, codigo)
      VALUES (${bancoA}::uuid, ${red}::uuid, 'Banco A', 'ROL-A'),
             (${bancoB}::uuid, ${red}::uuid, 'Banco B', 'ROL-B')`;
    await admin.$executeRaw`
      INSERT INTO plataforma.bodega (banco_id, nombre)
      VALUES (${bancoA}::uuid, 'Bodega A'), (${bancoB}::uuid, 'Bodega B')`;

    for (const [nombre, id] of Object.entries(USUARIOS)) {
      const email = `prueba+${id}@example.invalid`;
      await admin.$executeRaw`
        INSERT INTO plataforma.usuario (id, emisor, auth0_sub, email, nombre, activo)
        VALUES (${id}::uuid, ${emisor}, ${sub(id)}, ${email}, ${nombre}, ${nombre !== 'inactivo'})`;
    }

    await asignar(USUARIOS.operario, 'operario_bodega', bancoA, null);
    await asignar(USUARIOS.coordinacion, 'coordinacion', bancoA, null);
    await asignar(USUARIOS.institucion, 'institucion', bancoA, instX);
    await asignar(USUARIOS.superAdmin, 'super_admin', null, null);
    await asignar(USUARIOS.adminA, 'admin_banco', bancoA, null);
    await asignar(USUARIOS.adminA, 'consulta', bancoB, null);
    await asignar(USUARIOS.inactivo, 'admin_banco', bancoA, null);
    await asignar(USUARIOS.institucionY, 'institucion', bancoA, instY);

    const modulo = await Test.createTestingModule({
      imports: [CoreModule, PlataformaModule, HealthModule],
      controllers: [PruebaController, RolesEnDosNivelesController],
      providers: GUARDS_GLOBALES,
    })
      .overrideProvider(TOKEN_VERIFIER)
      .useValue(new Auth0TokenVerifier({ issuer: emisor, audience, jwksUri }))
      // El guard lee usuario_rol con el mismo rol sin privilegios que los
      // controladores. Con DATABASE_URL, que en CI es superusuario, se saltaría
      // RLS y super_admin entraría aunque faltara usuario_rol_propias.
      .overrideProvider(PrismaService)
      .useValue(app)
      .compile();
    nest = modulo.createNestApplication();
    nest.use(
      (
        req: { headers: Record<string, unknown>; contextoTenant?: TenantContext },
        _res: unknown,
        next: () => void,
      ) => {
        if (req.headers['x-prueba-contexto']) {
          req.contextoTenant = { bancoId: bancoA, rol: 'admin_banco' };
        }
        next();
      },
    );
    await nest.init();
  });

  afterAll(async () => {
    if (nest) await nest.close();
    if (jwksServer) await new Promise<void>((resolve) => jwksServer.close(() => resolve()));
    if (admin) {
      await limpiar();
      await admin.$disconnect();
    }
    if (app) await app.$disconnect();
    if (api) await api.$disconnect();
  });

  const como = (usuario: string, banco?: string) => {
    const cabeceras: Record<string, string> = { authorization: `Bearer ${token(sub(usuario))}` };
    if (banco) cabeceras['x-banco-id'] = banco;
    return cabeceras;
  };

  describe('en la base', () => {
    it('el catálogo de roles es el del contrato compartido', async () => {
      const filas = await app.$queryRaw<{ codigo: string }[]>`SELECT codigo FROM plataforma.rol`;

      expect(filas.map((f) => f.codigo).sort()).toEqual([...ROLES].sort());
    });

    it.each([
      ['institucion', bancoA, null],
      ['operario_bodega', bancoA, instX],
      ['operario_bodega', null, null],
      ['super_admin', bancoA, null],
    ])('rechaza %s con banco %s e institución %s', async (rol, banco, institucion) => {
      await expect(asignar(USUARIOS.operario, rol, banco, institucion)).rejects.toThrow();
    });

    it('no deja repetir una asignación sin institución', async () => {
      await expect(asignar(USUARIOS.coordinacion, 'coordinacion', bancoA, null)).rejects.toThrow();
    });

    it('cada usuario lee sus asignaciones en todos sus bancos y ninguna ajena', async () => {
      const propias = await executeTransactionWithTenant<
        { usuario_id: string; banco_id: string }[]
      >(
        app,
        (tx) => tx.$queryRaw<{ usuario_id: string; banco_id: string }[]>`
          SELECT usuario_id, banco_id FROM plataforma.usuario_rol`,
        { usuarioId: USUARIOS.adminA },
      );

      expect(propias.map((f) => f.banco_id).sort()).toEqual([bancoA, bancoB].sort());
      expect(propias.every((f) => f.usuario_id === USUARIOS.adminA)).toBe(true);
    });

    it('resuelve identidad sin contexto con el rol de API y no expone usuario por RLS', async () => {
      const resueltos = await app.$queryRaw<{ usuario_id: string }[]>`
        SELECT plataforma.resolver_usuario_auth0(${emisor}, ${sub(USUARIOS.adminA)}) AS usuario_id`;
      const lecturaDirecta = await app.$queryRaw<{ id: string }[]>`
        SELECT id FROM plataforma.usuario WHERE id = ${USUARIOS.adminA}::uuid`;

      expect(resueltos).toEqual([{ usuario_id: USUARIOS.adminA }]);
      expect(lecturaDirecta).toEqual([]);
    });

    it.skipIf(!URL_API)('sigba_app resuelve identidad sin eludir RLS ni leer usuario', async () => {
      const resueltos = await api!.$queryRaw<{ usuario_id: string }[]>`
        SELECT plataforma.resolver_usuario_auth0(${emisor}, ${sub(USUARIOS.adminA)}) AS usuario_id`;
      const lecturaDirecta = await api!.$queryRaw<{ id: string }[]>`
        SELECT id FROM plataforma.usuario WHERE id = ${USUARIOS.adminA}::uuid`;
      const rol = await admin.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
        SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'sigba_app'`;

      expect(resueltos).toEqual([{ usuario_id: USUARIOS.adminA }]);
      expect(lecturaDirecta).toEqual([]);
      expect(rol).toEqual([{ rolsuper: false, rolbypassrls: false }]);
    });

    it('el rol de ejecución no es superusuario, no elude RLS ni posee usuario', async () => {
      const roles = await admin.$queryRaw<
        { rolsuper: boolean; rolbypassrls: boolean; propietario: string }[]
      >`
        SELECT r.rolsuper, r.rolbypassrls, pg_get_userbyid(c.relowner) AS propietario
        FROM pg_roles r CROSS JOIN pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE r.rolname = 'sigba_app'
          AND n.nspname = 'plataforma' AND c.relname = 'usuario'`;

      expect(roles).toHaveLength(1);
      expect(roles[0]).toMatchObject({ rolsuper: false, rolbypassrls: false });
      expect(roles[0]?.propietario).not.toBe('sigba_app');
    });

    it('super_admin lee su asignación de red, que no tiene banco', async () => {
      const propias = await executeTransactionWithTenant(
        app,
        (tx) => tx.$queryRaw<{ banco_id: string | null }[]>`
          SELECT banco_id FROM plataforma.usuario_rol`,
        { usuarioId: USUARIOS.superAdmin },
      );

      expect(propias).toEqual([{ banco_id: null }]);
    });

    it('dentro de un banco nadie ve asignaciones de otro, ni las suyas (ADR-07)', async () => {
      // adminA también tiene una asignación en el banco B.
      const bancos = await bancosVisibles({ bancoId: bancoA, usuarioId: USUARIOS.adminA });

      expect(new Set(bancos)).toEqual(new Set([bancoA]));
    });

    it('el actor de un comando no se usa para leer asignaciones del usuario', async () => {
      const propias = await executeTransactionWithTenant(
        app,
        (tx) => tx.$queryRaw<{ usuario_id: string }[]>`
          SELECT usuario_id FROM plataforma.usuario_rol`,
        { actor: 'importar-codigos' },
      );

      expect(propias).toEqual([]);
    });

    it('el contexto de usuario solo sirve para leer, no para escribir', async () => {
      await expect(
        executeTransactionWithTenant(
          app,
          (tx) => tx.$executeRaw`
            UPDATE plataforma.usuario_rol SET activo = false WHERE usuario_id = ${USUARIOS.adminA}::uuid`,
          { usuarioId: USUARIOS.adminA },
        ),
      ).resolves.toBe(0);
    });
  });

  describe('en la API', () => {
    it('sin identidad responde 401', async () => {
      await request(nest.getHttpServer()).post('/prueba/precios/aprobar').expect(401);
    });

    // Con un token válido, el guard resuelve la identidad con `$queryRaw` y el
    // espía lo registra. Con uno inválido, el 401 llega antes de esa consulta.
    it.each([
      ['un token válido', {}, 200, true],
      ['expirado', { exp: Math.floor(Date.now() / 1000) - 1 }, 401, false],
      ['sin exp', { exp: undefined }, 401, false],
      ['otra audiencia', { aud: 'https://api.otra.sigba/' }, 401, false],
    ])('%s responde %i', async (_caso, claims, estado, consulto) => {
      const consulta = vi.spyOn(app, '$queryRaw');
      try {
        await request(nest.getHttpServer())
          .get('/prueba/contexto')
          .set({
            ...como(USUARIOS.adminA, bancoA),
            authorization: `Bearer ${token(sub(USUARIOS.adminA), claims)}`,
          })
          .expect(estado);

        expect(consulta.mock.calls.length > 0).toBe(consulto);
      } finally {
        consulta.mockRestore();
      }
    });

    it('health público responde sin token', async () => {
      await request(nest.getHttpServer()).get('/health').expect(200);
    });

    it('un operario_bodega que intenta aprobar un precio recibe 403', async () => {
      await request(nest.getHttpServer())
        .post('/prueba/precios/aprobar')
        .set(como(USUARIOS.operario, bancoA))
        .expect(403);
    });

    it('coordinación aprueba en su banco y no en otro', async () => {
      await request(nest.getHttpServer())
        .post('/prueba/precios/aprobar')
        .set(como(USUARIOS.coordinacion, bancoA))
        .expect(201);
      await request(nest.getHttpServer())
        .post('/prueba/precios/aprobar')
        .set(como(USUARIOS.coordinacion, bancoB))
        .expect(403);
    });

    it('un usuario desactivado recibe 403 aunque conserve la asignación', async () => {
      await request(nest.getHttpServer())
        .post('/prueba/precios/aprobar')
        .set(como(USUARIOS.inactivo, bancoA))
        .expect(403);
    });

    it('un usuario institucion deja app.institucion_id fijado en la transacción', async () => {
      const respuesta = await request(nest.getHttpServer())
        .get('/prueba/contexto')
        .set(como(USUARIOS.institucion, bancoA))
        .expect(200);

      expect(respuesta.body).toEqual({
        usuario: USUARIOS.institucion,
        banco: bancoA,
        institucion: instX,
      });
    });

    it('un usuario institucion no ve las asignaciones de otra institución del banco', async () => {
      // institucionY tiene una asignación en el mismo banco, con instY.
      const respuesta = await request(nest.getHttpServer())
        .get('/prueba/asignaciones')
        .set(como(USUARIOS.institucion, bancoA))
        .expect(200);

      expect(respuesta.body).toEqual([{ institucion_id: instX }]);
    });

    it('admin_banco ve solo las filas de su banco', async () => {
      const respuesta = await request(nest.getHttpServer())
        .get('/prueba/bodegas')
        .set(como(USUARIOS.adminA, bancoA))
        .expect(200);

      expect(respuesta.body).toEqual([{ nombre: 'Bodega A' }]);
    });

    it('con @Roles() en la clase y en el método manda el del método y busca una vez', async () => {
      const busqueda = vi.spyOn(nest.get(AsignacionesDeUsuario), 'deIdentidad');

      await request(nest.getHttpServer())
        .get('/prueba-dos-niveles')
        .set(como(USUARIOS.coordinacion, bancoA))
        .expect(200);

      expect(busqueda).toHaveBeenCalledTimes(1);
      busqueda.mockRestore();
    });

    it('un contextoTenant fijado antes del guard no evita el 401 ni el 403', async () => {
      const previo = { 'x-prueba-contexto': 'si' };

      await request(nest.getHttpServer()).post('/prueba/precios/aprobar').set(previo).expect(401);
      await request(nest.getHttpServer())
        .post('/prueba/precios/aprobar')
        .set({ ...como(USUARIOS.operario, bancoA), ...previo })
        .expect(403);
    });

    it('super_admin entra pero no ve filas de ningún banco', async () => {
      const respuesta = await request(nest.getHttpServer())
        .get('/prueba/bodegas')
        .set(como(USUARIOS.superAdmin, bancoA))
        .expect(200);

      expect(respuesta.body).toEqual([]);
    });
  });
});

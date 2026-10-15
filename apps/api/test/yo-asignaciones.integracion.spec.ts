import { createSign, generateKeyPairSync } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Auth0TokenVerifier } from '../src/core/auth/adapters/auth0/auth0-token-verifier.js';
import { TOKEN_VERIFIER } from '../src/core/auth/token-verifier.js';
import { CoreModule, GUARDS_GLOBALES, PrismaService } from '../src/core/index.js';
import { PlataformaModule } from '../src/modules/plataforma/index.js';
import { urlComoRolApp } from './rol-de-aplicacion.js';

/**
 * `GET /yo/asignaciones` contra PostgreSQL de verdad, con el rol de la API y
 * un JWKS local (SBA-19, D13). Lo que importa: cada persona ve sus bancos y
 * nunca los de otra, y lo desactivado no aparece.
 */

const URL_ADMIN = process.env['DATABASE_URL'];

if (process.env['CI'] && !URL_ADMIN) {
  throw new Error('DATABASE_URL no está definida en CI. La prueba de asignaciones no es opcional.');
}

const red = '1e1e1e1e-0000-4000-8000-000000000001';
const bancoA = '1e1e1e1e-0000-4000-8000-00000000000a';
const bancoB = '1e1e1e1e-0000-4000-8000-00000000000b';
const bancoCerrado = '1e1e1e1e-0000-4000-8000-00000000000c';
const instX = '1e1e1e1e-0000-4000-8000-0000000000f1';

const USUARIOS = {
  dosBancos: '1e1e1e1e-0000-4000-8000-000000000101',
  otra: '1e1e1e1e-0000-4000-8000-000000000102',
  superAdmin: '1e1e1e1e-0000-4000-8000-000000000103',
  sinAsignacion: '1e1e1e1e-0000-4000-8000-000000000104',
} as const;

const IDS_USUARIOS = Object.values(USUARIOS);
const BANCOS = [bancoA, bancoB, bancoCerrado];
const sub = (id: string) => `prueba-yo|${id}`;
const emisor = 'https://prueba-yo.sigba/';
const audience = 'https://api.prueba-yo.sigba/';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'yo-key', use: 'sig', alg: 'RS256' };

function token(usuarioSub: string): string {
  const ahora = Math.floor(Date.now() / 1000);
  const codificar = (valor: object) => Buffer.from(JSON.stringify(valor)).toString('base64url');
  const entrada = `${codificar({ alg: 'RS256', typ: 'JWT', kid: 'yo-key' })}.${codificar({
    iss: emisor,
    aud: audience,
    sub: usuarioSub,
    iat: ahora,
    exp: ahora + 300,
  })}`;
  const firma = createSign('RSA-SHA256').update(entrada).sign(privateKey);
  return `${entrada}.${firma.toString('base64url')}`;
}

let admin: PrismaClient;
let app: PrismaClient;
let jwksServer: Server;

async function limpiar(): Promise<void> {
  await admin.$executeRaw`DELETE FROM plataforma.usuario_rol WHERE usuario_id = ANY(${IDS_USUARIOS}::uuid[])`;
  await admin.$executeRaw`DELETE FROM plataforma.usuario WHERE id = ANY(${IDS_USUARIOS}::uuid[])`;
  await admin.$executeRaw`DELETE FROM plataforma.banco WHERE id = ANY(${BANCOS}::uuid[])`;
  await admin.$executeRaw`DELETE FROM plataforma.red WHERE id = ${red}::uuid`;
}

function asignar(
  usuario: string,
  rol: string,
  banco: string | null,
  { institucion = null, activo = true }: { institucion?: string | null; activo?: boolean } = {},
) {
  return admin.$executeRaw`
    INSERT INTO plataforma.usuario_rol (usuario_id, rol_id, banco_id, institucion_id, activo)
    SELECT ${usuario}::uuid, id, ${banco}::uuid, ${institucion}::uuid, ${activo}
    FROM plataforma.rol WHERE codigo = ${rol}`;
}

describe.skipIf(!URL_ADMIN)('GET /yo/asignaciones contra PostgreSQL (SBA-19)', () => {
  let nest: INestApplication<Server>;

  beforeAll(async () => {
    admin = new PrismaClient({ datasourceUrl: URL_ADMIN });
    app = new PrismaClient({ datasourceUrl: urlComoRolApp(URL_ADMIN as string) });
    jwksServer = createServer((peticion, respuesta) => {
      if (peticion.url !== '/.well-known/jwks.json') {
        respuesta.writeHead(404).end();
        return;
      }
      respuesta.writeHead(200, { 'content-type': 'application/json' });
      respuesta.end(JSON.stringify({ keys: [jwk] }));
    });
    await new Promise<void>((resolve) => jwksServer.listen(0, '127.0.0.1', resolve));
    const address = jwksServer.address();
    if (!address || typeof address === 'string') throw new Error('No se abrió el JWKS local');
    const jwksUri = `http://127.0.0.1:${address.port}/.well-known/jwks.json`;
    await limpiar();

    await admin.$executeRaw`INSERT INTO plataforma.red (id, nombre) VALUES (${red}::uuid, 'Red de yo')`;
    await admin.$executeRaw`
      INSERT INTO plataforma.banco (id, red_id, nombre, codigo, activo)
      VALUES (${bancoA}::uuid, ${red}::uuid, 'Banco de Armenia', 'YO-A', true),
             (${bancoB}::uuid, ${red}::uuid, 'Banco de Manizales', 'YO-B', true),
             (${bancoCerrado}::uuid, ${red}::uuid, 'Banco cerrado', 'YO-C', false)`;
    for (const [nombre, id] of Object.entries(USUARIOS)) {
      const email = `prueba-yo+${id}@example.invalid`;
      await admin.$executeRaw`
        INSERT INTO plataforma.usuario (id, emisor, auth0_sub, email, nombre)
        VALUES (${id}::uuid, ${emisor}, ${sub(id)}, ${email}, ${nombre})`;
    }

    await asignar(USUARIOS.dosBancos, 'admin_banco', bancoA);
    await asignar(USUARIOS.dosBancos, 'consulta', bancoB);
    await asignar(USUARIOS.dosBancos, 'coordinacion', bancoB, { activo: false });
    await asignar(USUARIOS.dosBancos, 'consulta', bancoCerrado);
    await asignar(USUARIOS.otra, 'coordinacion', bancoA);
    await asignar(USUARIOS.otra, 'institucion', bancoB, { institucion: instX });
    await asignar(USUARIOS.superAdmin, 'super_admin', null);

    const modulo = await Test.createTestingModule({
      imports: [CoreModule, PlataformaModule],
      providers: GUARDS_GLOBALES,
    })
      .overrideProvider(TOKEN_VERIFIER)
      .useValue(new Auth0TokenVerifier({ issuer: emisor, audience, jwksUri }))
      // Con el rol sin privilegios: con DATABASE_URL, superusuario en CI, RLS
      // no filtraría y la prueba de «nunca ve las de otra persona» no probaría nada.
      .overrideProvider(PrismaService)
      .useValue(app)
      .compile();
    nest = modulo.createNestApplication();
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
  });

  const pedir = (usuarioSub: string, cabeceras: Record<string, string> = {}) =>
    request(nest.getHttpServer())
      .get('/yo/asignaciones')
      .set({ authorization: `Bearer ${token(usuarioSub)}`, ...cabeceras });

  it('sin token responde 401', async () => {
    await request(nest.getHttpServer()).get('/yo/asignaciones').expect(401);
  });

  it('un usuario con dos bancos ve dos filas, con el nombre de cada banco', async () => {
    const respuesta = await pedir(sub(USUARIOS.dosBancos)).expect(200);

    expect(respuesta.body).toEqual([
      { rol: 'admin_banco', bancoId: bancoA, bancoNombre: 'Banco de Armenia', institucionId: null },
      { rol: 'consulta', bancoId: bancoB, bancoNombre: 'Banco de Manizales', institucionId: null },
    ]);
  });

  it('nunca ve las asignaciones de otra persona, aunque pida su banco', async () => {
    const respuesta = await pedir(sub(USUARIOS.otra), { 'x-banco-id': bancoA }).expect(200);

    expect(respuesta.body).toEqual([
      {
        rol: 'coordinacion',
        bancoId: bancoA,
        bancoNombre: 'Banco de Armenia',
        institucionId: null,
      },
      {
        rol: 'institucion',
        bancoId: bancoB,
        bancoNombre: 'Banco de Manizales',
        institucionId: instX,
      },
    ]);
  });

  it('super_admin ve su asignación de red, sin banco', async () => {
    const respuesta = await pedir(sub(USUARIOS.superAdmin)).expect(200);

    expect(respuesta.body).toEqual([
      { rol: 'super_admin', bancoId: null, bancoNombre: null, institucionId: null },
    ]);
  });

  it('un usuario sin asignaciones o que no existe en SIGBA recibe una lista vacía', async () => {
    await pedir(sub(USUARIOS.sinAsignacion)).expect(200, []);
    await pedir('prueba-yo|recien-registrado').expect(200, []);
  });
});

import { createHash, createSign, generateKeyPairSync } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Auth0TokenVerifier } from '../src/core/auth/adapters/auth0/auth0-token-verifier.js';
import { TOKEN_VERIFIER } from '../src/core/auth/token-verifier.js';
import { CoreModule, GUARDS_GLOBALES, PrismaService } from '../src/core/index.js';
import { PlataformaModule } from '../src/modules/plataforma/index.js';
import { urlComoRolApp } from './rol-de-aplicacion.js';

/**
 * Invitaciones de punta a punta contra PostgreSQL, con el rol de la API y un
 * JWKS local (SBA-19, D1 a D16): crear, aceptar, reenviar, revocar, quitar el
 * acceso y el aislamiento entre bancos.
 */

const URL_ADMIN = process.env['DATABASE_URL'];

if (process.env['CI'] && !URL_ADMIN) {
  throw new Error('DATABASE_URL no está definida en CI. La prueba de invitaciones no es opcional.');
}

const red = 'ce1ce1ce-0000-4000-8000-000000000001';
const bancoA = 'ce1ce1ce-0000-4000-8000-00000000000a';
const bancoB = 'ce1ce1ce-0000-4000-8000-00000000000b';
const BANCOS = [bancoA, bancoB];

const USUARIOS = {
  adminA: 'ce1ce1ce-0000-4000-8000-000000000101',
  adminB: 'ce1ce1ce-0000-4000-8000-000000000102',
  superAdmin: 'ce1ce1ce-0000-4000-8000-000000000103',
  soloB: 'ce1ce1ce-0000-4000-8000-000000000104',
} as const;

const emisor = 'https://prueba-invitaciones.sigba/';
const audience = 'https://api.prueba-invitaciones.sigba/';
const sub = (id: string) => `prueba-inv|${id}`;
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'inv-key', use: 'sig', alg: 'RS256' };

/**
 * Lo que la Action de Auth0 pone en el access token (auth0-setup.md). Sin
 * `email`, el correo sale del sub: `prueba-inv|ana` es ana@example.invalid, y
 * `null` lo omite. `verificado` es verdadero salvo que se diga lo contrario.
 */
interface Cuenta {
  email?: string | null;
  verificado?: boolean;
}

const espacio = audience.endsWith('/') ? audience : `${audience}/`;

function token(usuarioSub: string, { email, verificado = true }: Cuenta = {}): string {
  const ahora = Math.floor(Date.now() / 1000);
  const correo = email === undefined ? `${usuarioSub.split('|')[1]}@example.invalid` : email;
  const codificar = (valor: object) => Buffer.from(JSON.stringify(valor)).toString('base64url');
  const entrada = `${codificar({ alg: 'RS256', typ: 'JWT', kid: 'inv-key' })}.${codificar({
    iss: emisor,
    aud: audience,
    sub: usuarioSub,
    iat: ahora,
    exp: ahora + 300,
    ...(correo !== null && { [`${espacio}email`]: correo }),
    [`${espacio}email_verified`]: verificado,
  })}`;
  const firma = createSign('RSA-SHA256').update(entrada).sign(privateKey);
  return `${entrada}.${firma.toString('base64url')}`;
}

const tokenDe = (enlace: string) => enlace.split('/invitacion/')[1]!;
const hashDe = (valor: string) => createHash('sha256').update(valor).digest('hex');

let admin: PrismaClient;
let app: PrismaClient;
let jwksServer: Server;

async function limpiar(): Promise<void> {
  await admin.$executeRaw`DELETE FROM plataforma.invitacion WHERE banco_id = ANY(${BANCOS}::uuid[])`;
  await admin.$executeRaw`
    DELETE FROM plataforma.usuario_rol
    WHERE usuario_id IN (SELECT id FROM plataforma.usuario WHERE emisor = ${emisor})`;
  await admin.$executeRaw`DELETE FROM plataforma.usuario WHERE emisor = ${emisor}`;
  await admin.$executeRaw`DELETE FROM plataforma.banco WHERE id = ANY(${BANCOS}::uuid[])`;
  await admin.$executeRaw`DELETE FROM plataforma.red WHERE id = ${red}::uuid`;
}

function asignar(usuario: string, rol: string, banco: string | null) {
  return admin.$executeRaw`
    INSERT INTO plataforma.usuario_rol (usuario_id, rol_id, banco_id)
    SELECT ${usuario}::uuid, id, ${banco}::uuid FROM plataforma.rol WHERE codigo = ${rol}`;
}

describe.skipIf(!URL_ADMIN)('Invitaciones contra PostgreSQL (SBA-19)', () => {
  let nest: INestApplication<Server>;

  beforeAll(async () => {
    vi.stubEnv('WEB_URL', 'https://pwa.prueba-invitaciones.sigba');
    vi.stubEnv('SMTP_URL', '');
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

    await admin.$executeRaw`INSERT INTO plataforma.red (id, nombre) VALUES (${red}::uuid, 'Red de invitaciones')`;
    await admin.$executeRaw`
      INSERT INTO plataforma.banco (id, red_id, nombre, codigo)
      VALUES (${bancoA}::uuid, ${red}::uuid, 'Banco A', 'INV-A'),
             (${bancoB}::uuid, ${red}::uuid, 'Banco B', 'INV-B')`;
    for (const [nombre, id] of Object.entries(USUARIOS)) {
      await admin.$executeRaw`
        INSERT INTO plataforma.usuario (id, emisor, auth0_sub, email, nombre)
        VALUES (${id}::uuid, ${emisor}, ${sub(id)}, ${`inv+${id}@example.invalid`}, ${nombre})`;
    }
    await asignar(USUARIOS.adminA, 'admin_banco', bancoA);
    await asignar(USUARIOS.adminB, 'admin_banco', bancoB);
    await asignar(USUARIOS.soloB, 'consulta', bancoB);
    await asignar(USUARIOS.superAdmin, 'super_admin', null);

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
    vi.unstubAllEnvs();
  });

  const como = (usuarioSub: string, banco?: string, cuenta?: Cuenta) => {
    const cabeceras: Record<string, string> = {
      authorization: `Bearer ${token(usuarioSub, cuenta)}`,
    };
    if (banco) cabeceras['x-banco-id'] = banco;
    return cabeceras;
  };
  const http = () => request(nest.getHttpServer());

  const invitarEnA = async (email: string, rol = 'consulta') => {
    const respuesta = await http()
      .post('/invitaciones')
      .set(como(sub(USUARIOS.adminA), bancoA))
      .send({ email, nombre: `Persona ${email}`, rol })
      .expect(201);
    return respuesta.body as { invitacionId: string; enlace: string; correoEnviado: boolean };
  };

  const aceptar = (usuarioSub: string, enlace: string, cuenta?: Cuenta) =>
    http()
      .post('/invitaciones/aceptar')
      .set(como(usuarioSub, undefined, cuenta))
      .send({ token: tokenDe(enlace) });

  it('la invitación aceptada da rol y banco sin nada más', async () => {
    const emitida = await invitarEnA('nueva@example.invalid');
    expect(emitida.enlace).toMatch(/^https:\/\/pwa\.prueba-invitaciones\.sigba\/invitacion\//);
    expect(emitida.correoEnviado).toBe(false);

    // Nunca entró a SIGBA: no tiene asignaciones ni existe como usuario.
    await http().get('/yo/asignaciones').set(como('prueba-inv|nueva')).expect(200, []);

    await aceptar('prueba-inv|nueva', emitida.enlace).expect(200, {
      bancoId: bancoA,
      rol: 'consulta',
    });

    const asignaciones = await http().get('/yo/asignaciones').set(como('prueba-inv|nueva'));
    expect(asignaciones.body).toEqual([
      { rol: 'consulta', bancoId: bancoA, bancoNombre: 'Banco A', institucionId: null },
    ]);

    const usuarios = await http()
      .get('/usuarios')
      .set(como(sub(USUARIOS.adminA), bancoA))
      .expect(200);
    expect(usuarios.body).toContainEqual(
      expect.objectContaining({
        nombre: 'Persona nueva@example.invalid',
        email: 'nueva@example.invalid',
        rol: 'consulta',
      }),
    );

    const invitaciones = await http()
      .get('/invitaciones')
      .set(como(sub(USUARIOS.adminA), bancoA))
      .expect(200);
    expect(invitaciones.body).toContainEqual(
      expect.objectContaining({
        id: emitida.invitacionId,
        estado: 'aceptada',
        aceptadaPorNombre: 'Persona nueva@example.invalid',
      }),
    );
  });

  it('un enlace usado da 410; aceptarlo otra vez con la misma cuenta no duplica', async () => {
    const emitida = await invitarEnA('usada@example.invalid');
    await aceptar('prueba-inv|usada', emitida.enlace).expect(200);

    await aceptar('prueba-inv|usada', emitida.enlace).expect(200);
    // Otra cuenta con el mismo correo verificado: el enlace ya no sirve.
    const otra = await aceptar('prueba-inv|intrusa', emitida.enlace, {
      email: 'usada@example.invalid',
    }).expect(410);
    expect(otra.body).toMatchObject({ codigo: 'usada' });

    const [cuenta] = await admin.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM plataforma.usuario_rol ur
      JOIN plataforma.usuario u ON u.id = ur.usuario_id
      WHERE u.auth0_sub IN ('prueba-inv|usada', 'prueba-inv|intrusa')`;
    expect(Number(cuenta?.n)).toBe(1);
  });

  it('otro correo, sin verificar o sin correo en el token: 403 y nada se crea', async () => {
    const emitida = await invitarEnA('duena@example.invalid');
    const intentos: [Cuenta, string][] = [
      [{ email: 'otra@example.invalid' }, 'correo_no_coincide'],
      [{ email: 'duena@example.invalid', verificado: false }, 'correo_no_verificado'],
      [{ email: null }, 'correo_no_verificado'],
    ];

    for (const [cuenta, codigo] of intentos) {
      const respuesta = await aceptar('prueba-inv|impostora', emitida.enlace, cuenta).expect(403);
      expect(respuesta.body).toMatchObject({ codigo });
      expect(JSON.stringify(respuesta.body)).not.toContain('duena');
    }

    const [fila] = await admin.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM plataforma.usuario WHERE auth0_sub = 'prueba-inv|impostora'`;
    expect(Number(fila?.n)).toBe(0);
    // La invitación sigue pendiente para su dueña, aunque escriba el correo distinto.
    await aceptar('prueba-inv|duena', emitida.enlace, {
      email: '  DUENA@Example.Invalid ',
    }).expect(200, { bancoId: bancoA, rol: 'consulta' });
  });

  it('una cuenta inactiva o un banco inactivo no reciben la asignación', async () => {
    await admin.$executeRaw`
      INSERT INTO plataforma.usuario (emisor, auth0_sub, email, nombre, activo)
      VALUES (${emisor}, 'prueba-inv|inactivo', 'inactivo@example.invalid', 'Inactivo', false)`;
    const deInactivo = await invitarEnA('inactivo@example.invalid');
    const respuesta = await aceptar('prueba-inv|inactivo', deInactivo.enlace).expect(403);
    expect(respuesta.body).toMatchObject({ codigo: 'usuario_inactivo' });

    const deBancoInactivo = await invitarEnA('banco-inactivo@example.invalid');
    await admin.$executeRaw`UPDATE plataforma.banco SET activo = false WHERE id = ${bancoA}::uuid`;
    try {
      const rechazo = await aceptar('prueba-inv|banco-inactivo', deBancoInactivo.enlace).expect(
        403,
      );
      expect(rechazo.body).toMatchObject({ codigo: 'banco_inactivo' });
    } finally {
      await admin.$executeRaw`UPDATE plataforma.banco SET activo = true WHERE id = ${bancoA}::uuid`;
    }

    const [cuenta] = await admin.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM plataforma.usuario_rol ur
      JOIN plataforma.usuario u ON u.id = ur.usuario_id
      WHERE u.auth0_sub IN ('prueba-inv|inactivo', 'prueba-inv|banco-inactivo')`;
    expect(Number(cuenta?.n)).toBe(0);
  });

  it('invitar dos veces al mismo correo con los mismos datos da la misma invitación', async () => {
    const primera = await invitarEnA('repetida@example.invalid');

    const segunda = await http()
      .post('/invitaciones')
      .set(como(sub(USUARIOS.adminA), bancoA))
      .send({ email: ' REPETIDA@example.invalid ', nombre: 'Otro nombre', rol: 'consulta' })
      .expect(200);

    expect(segunda.body).toMatchObject({
      invitacionId: primera.invitacionId,
      enlace: null,
      correoEnviado: false,
      yaExistia: true,
    });
    const [cuenta] = await admin.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM plataforma.invitacion
      WHERE banco_id = ${bancoA}::uuid AND lower(email) = 'repetida@example.invalid'`;
    expect(Number(cuenta?.n)).toBe(1);

    // Con otro rol hay conflicto; el enlace original sigue sirviendo.
    await http()
      .post('/invitaciones')
      .set(como(sub(USUARIOS.adminA), bancoA))
      .send({ email: 'repetida@example.invalid', nombre: 'X', rol: 'coordinacion' })
      .expect(409);
    await aceptar('prueba-inv|repetida', primera.enlace).expect(200);
  });

  it('peticiones simultáneas al mismo correo crean una sola invitación', async () => {
    const respuestas = await Promise.all(
      Array.from({ length: 5 }, () =>
        http()
          .post('/invitaciones')
          .set(como(sub(USUARIOS.adminA), bancoA))
          .send({ email: 'carrera@example.invalid', nombre: 'Carrera', rol: 'consulta' }),
      ),
    );

    expect(respuestas.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(new Set(respuestas.map((r) => r.body.invitacionId)).size).toBe(1);
  });

  it('una invitación revocada o aceptada deja invitar de nuevo al mismo correo', async () => {
    const revocada = await invitarEnA('de-nuevo@example.invalid');
    await http()
      .post(`/invitaciones/${revocada.invitacionId}/revocar`)
      .set(como(sub(USUARIOS.adminA), bancoA))
      .expect(200);
    const nueva = await invitarEnA('de-nuevo@example.invalid');
    expect(nueva.invitacionId).not.toBe(revocada.invitacionId);

    await aceptar('prueba-inv|de-nuevo', nueva.enlace).expect(200);
    const otra = await invitarEnA('de-nuevo@example.invalid', 'coordinacion');
    expect(otra.invitacionId).not.toBe(nueva.invitacionId);
  });

  it('un enlace vencido da 410 y reenviar da uno nuevo; el anterior deja de servir', async () => {
    const emitida = await invitarEnA('vencida@example.invalid');
    await admin.$executeRaw`
      UPDATE plataforma.invitacion SET vence_en = now() - interval '1 minute'
      WHERE id = ${emitida.invitacionId}::uuid`;

    const vencida = await aceptar('prueba-inv|vencida', emitida.enlace).expect(410);
    expect(vencida.body).toMatchObject({ codigo: 'vencida' });

    const reenviada = await http()
      .post(`/invitaciones/${emitida.invitacionId}/reenviar`)
      .set(como(sub(USUARIOS.adminA), bancoA))
      .expect(200);
    expect(reenviada.body.enlace).not.toBe(emitida.enlace);

    const vieja = await aceptar('prueba-inv|vencida', emitida.enlace).expect(410);
    expect(vieja.body).toMatchObject({ codigo: 'no_existe' });
    await aceptar('prueba-inv|vencida', reenviada.body.enlace).expect(200);
  });

  it('una invitación revocada da 410 y ya no se puede reenviar', async () => {
    const emitida = await invitarEnA('revocada@example.invalid');
    await http()
      .post(`/invitaciones/${emitida.invitacionId}/revocar`)
      .set(como(sub(USUARIOS.adminA), bancoA))
      .expect(200);

    const respuesta = await aceptar('prueba-inv|revocada', emitida.enlace).expect(410);
    expect(respuesta.body).toMatchObject({ codigo: 'revocada' });
    await http()
      .post(`/invitaciones/${emitida.invitacionId}/reenviar`)
      .set(como(sub(USUARIOS.adminA), bancoA))
      .expect(409);
  });

  it('admin_banco no invita al rol institución ni a super_admin', async () => {
    for (const rol of ['institucion', 'super_admin']) {
      await http()
        .post('/invitaciones')
        .set(como(sub(USUARIOS.adminA), bancoA))
        .send({ email: 'x@example.invalid', nombre: 'X', rol })
        .expect(400);
    }
  });

  it('super_admin invita al primer admin_banco de un banco; admin_banco no puede', async () => {
    const respuesta = await http()
      .post(`/bancos/${bancoB}/invitaciones`)
      .set(como(sub(USUARIOS.superAdmin)))
      .send({ email: 'admin-nuevo@example.invalid', nombre: 'Admin nuevo' })
      .expect(201);

    // Repetir la invitación no crea otra: 200 y sin enlace.
    const repetida = await http()
      .post(`/bancos/${bancoB}/invitaciones`)
      .set(como(sub(USUARIOS.superAdmin)))
      .send({ email: 'admin-nuevo@example.invalid', nombre: 'Admin nuevo' })
      .expect(200);
    expect(repetida.body).toMatchObject({
      invitacionId: respuesta.body.invitacionId,
      enlace: null,
      yaExistia: true,
    });

    await aceptar('prueba-inv|admin-nuevo', respuesta.body.enlace).expect(200, {
      bancoId: bancoB,
      rol: 'admin_banco',
    });
    await http()
      .post(`/bancos/${bancoB}/invitaciones`)
      .set(como(sub(USUARIOS.adminA), bancoA))
      .send({ email: 'y@example.invalid', nombre: 'Y' })
      .expect(403);
  });

  it('aislamiento: el banco B no ve ni toca las invitaciones ni los usuarios del banco A', async () => {
    const emitida = await invitarEnA('aislada@example.invalid');

    const deB = await http()
      .get('/invitaciones')
      .set(como(sub(USUARIOS.adminB), bancoB))
      .expect(200);
    expect(deB.body.map((i: { id: string }) => i.id)).not.toContain(emitida.invitacionId);
    await http()
      .post(`/invitaciones/${emitida.invitacionId}/revocar`)
      .set(como(sub(USUARIOS.adminB), bancoB))
      .expect(404);
    await http()
      .post(`/invitaciones/${emitida.invitacionId}/reenviar`)
      .set(como(sub(USUARIOS.adminB), bancoB))
      .expect(404);

    const usuariosA = await http()
      .get('/usuarios')
      .set(como(sub(USUARIOS.adminA), bancoA))
      .expect(200);
    const ids = usuariosA.body.map((u: { usuarioId: string }) => u.usuarioId);
    expect(ids).toContain(USUARIOS.adminA);
    expect(ids).not.toContain(USUARIOS.soloB);
    expect(ids).not.toContain(USUARIOS.adminB);

    await http()
      .post(`/usuarios/${USUARIOS.adminA}/asignacion/desactivar`)
      .set(como(sub(USUARIOS.adminB), bancoB))
      .expect(404);
  });

  it('un admin_banco puede quitarle el acceso a otro admin_banco', async () => {
    const emitida = await http()
      .post(`/bancos/${bancoA}/invitaciones`)
      .set(como(sub(USUARIOS.superAdmin)))
      .send({ email: 'segundo-admin@example.invalid', nombre: 'Segundo admin' })
      .expect(201);
    await aceptar('prueba-inv|segundo-admin', emitida.body.enlace).expect(200);
    const [segundo] = await admin.$queryRaw<{ id: string }[]>`
      SELECT id::text FROM plataforma.usuario WHERE auth0_sub = 'prueba-inv|segundo-admin'`;

    await http()
      .post(`/usuarios/${segundo!.id}/asignacion/desactivar`)
      .set(como(sub(USUARIOS.adminA), bancoA))
      .expect(200, { usuarioId: segundo!.id, desactivadas: 1 });
  });

  it('desactivar la asignación quita el acceso al banco', async () => {
    const emitida = await invitarEnA('saliente@example.invalid', 'coordinacion');
    await aceptar('prueba-inv|saliente', emitida.enlace).expect(200);
    const [saliente] = await admin.$queryRaw<{ id: string }[]>`
      SELECT id::text FROM plataforma.usuario WHERE auth0_sub = 'prueba-inv|saliente'`;
    const id = saliente!.id;

    await http()
      .post(`/usuarios/${id}/asignacion/desactivar`)
      .set(como(sub(USUARIOS.adminA), bancoA))
      .expect(200, { usuarioId: id, desactivadas: 1 });

    await http().get('/yo/asignaciones').set(como('prueba-inv|saliente')).expect(200, []);
    await http()
      .post(`/usuarios/${USUARIOS.adminA}/asignacion/desactivar`)
      .set(como(sub(USUARIOS.adminA), bancoA))
      .expect(400);
  });

  it('sin token responde 401 y una cuenta sin asignación no lista invitaciones', async () => {
    await http().post('/invitaciones/aceptar').send({ token: 'x' }).expect(401);
    await http().get('/invitaciones').set(como('prueba-inv|cualquiera', bancoA)).expect(403);
  });

  it('el token y el correo nunca quedan en auditoría', async () => {
    const emitida = await invitarEnA('auditada@example.invalid');
    const reenviada = await http()
      .post(`/invitaciones/${emitida.invitacionId}/reenviar`)
      .set(como(sub(USUARIOS.adminA), bancoA))
      .expect(200);
    await aceptar('prueba-inv|auditada', reenviada.body.enlace).expect(200);

    const filas = await admin.$queryRaw<{ fila: string }[]>`
      SELECT a::text AS fila FROM core.auditoria a WHERE a.banco_id = ANY(${BANCOS}::uuid[])`;
    const auditoria = filas.map((f) => f.fila).join('\n');

    expect(auditoria).toContain(emitida.invitacionId);
    for (const secreto of [
      tokenDe(emitida.enlace),
      tokenDe(reenviada.body.enlace),
      hashDe(tokenDe(emitida.enlace)),
      hashDe(tokenDe(reenviada.body.enlace)),
      'auditada@example.invalid',
    ]) {
      expect(auditoria).not.toContain(secreto);
    }
  });
});

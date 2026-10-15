import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import type { PaginaDeAuditoria } from '@sigba/shared-types';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
import { PlataformaModule } from '../src/modules/plataforma/index.js';
import { abrirJwks, AUDIENCIA_DE_PRUEBA, EMISOR_DE_PRUEBA, firmarToken } from './jwt-de-prueba.js';
import { urlComoRolApp } from './rol-de-aplicacion.js';

/**
 * Auditoría consultable por HTTP contra PostgreSQL (SBA-51), con los guards
 * reales y el rol sin privilegios de la API.
 *
 * `core.auditoria` es append-only: nada la limpia entre corridas. Bancos,
 * usuarios e ids son nuevos en cada corrida para no leer filas de otra.
 */

const URL_ADMIN = process.env['DATABASE_URL'];

if (process.env['CI'] && !URL_ADMIN) {
  throw new Error('Falta DATABASE_URL en CI para probar la auditoría consultable.');
}

const red = randomUUID();
const bancoA = randomUUID();
const bancoB = randomUUID();
const USUARIOS = {
  adminA: randomUUID(),
  coordinacionA: randomUUID(),
  operarioA: randomUUID(),
  consultaA: randomUUID(),
  superAdmin: randomUUID(),
  adminB: randomUUID(),
};
const IDS_USUARIOS = Object.values(USUARIOS);
const sub = (usuario: string) => `prueba|${usuario}`;

describe.skipIf(!URL_ADMIN)('Auditoría consultable (SBA-51)', () => {
  let admin: PrismaClient;
  let app: PrismaClient;
  let nest: INestApplication<Server>;
  let cerrarJwks: () => Promise<void>;
  const auditoria = new AuditService();

  const como = (usuario: string, banco: string) => ({
    authorization: `Bearer ${firmarToken(sub(usuario))}`,
    'x-banco-id': banco,
  });

  /** Inserta como dueño de la tabla, con la fecha que la prueba necesita. */
  async function sembrar(
    bancoId: string,
    ocurridoEn: string,
    entidad: string,
    entidadId = randomUUID(),
  ): Promise<string> {
    await admin.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.banco_id', ${bancoId}, true)`;
      await tx.$executeRaw`
        INSERT INTO core.auditoria
          (banco_id, ocurrido_en, actor_tipo, actor_etiqueta, accion, entidad, entidad_id)
        VALUES (${bancoId}::uuid, ${ocurridoEn}::timestamptz, 'sistema', 'sistema:siembra',
          'crear', ${entidad}, ${entidadId})`;
    });
    return entidadId;
  }

  function asignar(usuario: string, rol: string, banco: string | null) {
    return admin.$executeRaw`
      INSERT INTO plataforma.usuario_rol (usuario_id, rol_id, banco_id)
      SELECT ${usuario}::uuid, id, ${banco}::uuid FROM plataforma.rol WHERE codigo = ${rol}`;
  }

  async function limpiar(): Promise<void> {
    await admin.$executeRaw`DELETE FROM plataforma.usuario_rol WHERE usuario_id = ANY(${IDS_USUARIOS}::uuid[])`;
    await admin.$executeRaw`DELETE FROM plataforma.usuario WHERE id = ANY(${IDS_USUARIOS}::uuid[])`;
    await admin.$executeRaw`DELETE FROM plataforma.banco WHERE id IN (${bancoA}::uuid, ${bancoB}::uuid)`;
    await admin.$executeRaw`DELETE FROM plataforma.red WHERE id = ${red}::uuid`;
  }

  beforeAll(async () => {
    admin = new PrismaClient({ datasourceUrl: URL_ADMIN });
    app = new PrismaClient({ datasourceUrl: urlComoRolApp(URL_ADMIN as string) });
    const jwks = await abrirJwks();
    cerrarJwks = jwks.cerrar;

    // El código de banco va en mayúsculas (SBA-19, D11).
    const sufijo = bancoA.slice(0, 8).toUpperCase();
    await admin.$executeRaw`INSERT INTO plataforma.red (id, nombre) VALUES (${red}::uuid, 'Red de auditoría')`;
    await admin.$executeRaw`
      INSERT INTO plataforma.banco (id, red_id, nombre, codigo)
      VALUES (${bancoA}::uuid, ${red}::uuid, 'Banco A', ${`AUD-A-${sufijo}`}),
             (${bancoB}::uuid, ${red}::uuid, 'Banco B', ${`AUD-B-${sufijo}`})`;
    for (const [nombre, id] of Object.entries(USUARIOS)) {
      await admin.$executeRaw`
        INSERT INTO plataforma.usuario (id, emisor, auth0_sub, email, nombre)
        VALUES (${id}::uuid, ${EMISOR_DE_PRUEBA}, ${sub(id)}, ${`prueba+${id}@example.invalid`}, ${nombre})`;
    }
    await asignar(USUARIOS.adminA, 'admin_banco', bancoA);
    await asignar(USUARIOS.coordinacionA, 'coordinacion', bancoA);
    await asignar(USUARIOS.operarioA, 'operario_bodega', bancoA);
    await asignar(USUARIOS.consultaA, 'consulta', bancoA);
    await asignar(USUARIOS.superAdmin, 'super_admin', null);
    await asignar(USUARIOS.adminB, 'admin_banco', bancoB);

    const modulo = await Test.createTestingModule({
      imports: [CoreModule, PlataformaModule],
      providers: GUARDS_GLOBALES,
    })
      .overrideProvider(TOKEN_VERIFIER)
      .useValue(
        new Auth0TokenVerifier({
          issuer: EMISOR_DE_PRUEBA,
          audience: AUDIENCIA_DE_PRUEBA,
          jwksUri: jwks.jwksUri,
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
    if (cerrarJwks) await cerrarJwks();
    if (admin) {
      await limpiar();
      await admin.$disconnect();
    }
    if (app) await app.$disconnect();
  });

  it('cada banco ve cero registros del otro', async () => {
    const deA = await sembrar(bancoA, '2020-02-10T12:00:00Z', 'institucion');
    const deB = await sembrar(bancoB, '2020-02-10T12:00:00Z', 'institucion');

    const respuesta = await request(nest.getHttpServer())
      .get('/auditoria?limite=100')
      .set(como(USUARIOS.adminA, bancoA))
      .expect(200);
    const { registros } = respuesta.body as PaginaDeAuditoria;
    const ids = registros.map((r) => r.id);

    expect(registros.map((r) => r.entidadId)).toContain(deA);
    expect(registros.map((r) => r.entidadId)).not.toContain(deB);
    const [ajenos] = await admin.$queryRaw<{ cantidad: bigint }[]>`
      SELECT count(*) AS cantidad FROM core.auditoria
      WHERE id = ANY(${ids}::uuid[]) AND banco_id <> ${bancoA}::uuid`;
    expect(Number(ajenos?.cantidad)).toBe(0);

    const deOtroBanco = await request(nest.getHttpServer())
      .get('/auditoria?entidad=institucion')
      .set(como(USUARIOS.adminB, bancoB))
      .expect(200);
    expect((deOtroBanco.body as PaginaDeAuditoria).registros.map((r) => r.entidadId)).toEqual([
      deB,
    ]);
  });

  it.each([
    ['operario_bodega', USUARIOS.operarioA],
    ['consulta', USUARIOS.consultaA],
    ['super_admin', USUARIOS.superAdmin],
  ])('%s recibe 403 al abrir la auditoría', async (_rol, usuario) => {
    await request(nest.getHttpServer()).get('/auditoria').set(como(usuario, bancoA)).expect(403);
  });

  it('coordinación consulta pero no exporta', async () => {
    const servidor = nest.getHttpServer();
    await request(servidor).get('/auditoria').set(como(USUARIOS.coordinacionA, bancoA)).expect(200);
    await request(servidor)
      .get('/auditoria/exportar?desde=2020-01-01T00:00:00Z&hasta=2020-02-01T00:00:00Z')
      .set(como(USUARIOS.coordinacionA, bancoA))
      .expect(403);
  });

  it('una lectura de beneficiarios queda registrada sin nombres ni documentos', async () => {
    const institucion = randomUUID();
    const conjunto = `beneficiarios_de_institucion:${institucion}`;
    // Lo que la consulta de equipo 1 devolvería; datos sintéticos.
    const leidos = [
      { nombre: 'Ana Sintética Pérez', documento: '1088000001' },
      { nombre: 'Luis Prueba Gómez', documento: '1088000002' },
    ];

    await runWithTenantContext({ bancoId: bancoA, usuarioId: USUARIOS.coordinacionA }, () =>
      executeTransactionWithTenant(app, (tx) =>
        auditoria.registrarLectura(tx, {
          entidad: 'beneficiario',
          conjunto,
          cantidad: leidos.length,
          finalidad: 'entrega_de_mercado',
        }),
      ),
    );

    const [registro] = await admin.$queryRaw<
      { texto: string; accion: string; actor_tipo: string; actor_id: string; detalle: unknown }[]
    >`SELECT to_jsonb(a)::text AS texto, accion, actor_tipo, actor_id::text, detalle
      FROM core.auditoria a WHERE banco_id = ${bancoA}::uuid AND entidad_id = ${conjunto}`;

    expect(registro).toMatchObject({
      accion: 'leer',
      actor_tipo: 'usuario',
      actor_id: USUARIOS.coordinacionA,
      detalle: { cantidad: 2 },
    });
    for (const { nombre, documento } of leidos) {
      expect(registro?.texto).not.toContain(nombre);
      expect(registro?.texto).not.toContain(documento);
    }
  });

  it('una tarea programada queda como sistema, no como usuario', async () => {
    const lote = randomUUID();
    await runWithTenantContext({ bancoId: bancoA, actor: 'sistema:retencion' }, () =>
      executeTransactionWithTenant(app, (tx) =>
        auditoria.registrar(tx, { accion: 'actualizar', entidad: 'lote', entidadId: lote }),
      ),
    );

    const respuesta = await request(nest.getHttpServer())
      .get('/auditoria?tipoActor=sistema&actor=sistema:retencion')
      .set(como(USUARIOS.adminA, bancoA))
      .expect(200);

    expect((respuesta.body as PaginaDeAuditoria).registros).toEqual([
      expect.objectContaining({
        entidadId: lote,
        tipoActor: 'sistema',
        actorEtiqueta: 'sistema:retencion',
        actorId: null,
      }),
    ]);
  });

  it('consultar la auditoría también queda auditado como lectura', async () => {
    await request(nest.getHttpServer())
      .get('/auditoria?entidad=no_existe')
      .set(como(USUARIOS.coordinacionA, bancoA))
      .expect(200);

    const lecturas = await admin.$queryRaw<{ entidad_id: string; detalle: unknown }[]>`
      SELECT entidad_id, detalle FROM core.auditoria
      WHERE banco_id = ${bancoA}::uuid AND actor_id = ${USUARIOS.coordinacionA}::uuid
        AND accion = 'leer' AND entidad = 'auditoria' AND finalidad = 'consulta_de_auditoria'`;
    expect(lecturas).toContainEqual({ entidad_id: 'auditoria', detalle: { cantidad: 0 } });
  });

  it('el cursor recorre registros del mismo instante sin saltarse ninguno', async () => {
    const instante = '2020-06-01T00:00:00.000001Z';
    const sembrados = [
      await sembrar(bancoA, instante, 'pagina'),
      await sembrar(bancoA, instante, 'pagina'),
      await sembrar(bancoA, instante, 'pagina'),
    ];
    const servidor = nest.getHttpServer();

    const primera = (
      await request(servidor)
        .get('/auditoria?entidad=pagina&limite=2')
        .set(como(USUARIOS.adminA, bancoA))
        .expect(200)
    ).body as PaginaDeAuditoria;
    expect(primera.registros).toHaveLength(2);
    expect(primera.siguienteCursor).not.toBeNull();

    const segunda = (
      await request(servidor)
        .get('/auditoria')
        .query({ entidad: 'pagina', limite: 2, cursor: primera.siguienteCursor })
        .set(como(USUARIOS.adminA, bancoA))
        .expect(200)
    ).body as PaginaDeAuditoria;
    expect(segunda.siguienteCursor).toBeNull();

    const vistos = [...primera.registros, ...segunda.registros].map((r) => r.entidadId);
    expect(vistos.sort()).toEqual([...sembrados].sort());
  });

  it('el CSV trae solo el periodo pedido, con el inicio incluido y el fin excluido', async () => {
    const antes = await sembrar(bancoA, '2020-01-31T23:59:59.999999Z', 'exportable');
    const inicio = await sembrar(bancoA, '2020-02-01T00:00:00Z', 'exportable');
    const dentro = await sembrar(bancoA, '2020-02-29T23:59:59Z', 'exportable');
    const fin = await sembrar(bancoA, '2020-03-01T00:00:00Z', 'exportable');

    const respuesta = await request(nest.getHttpServer())
      .get('/auditoria/exportar?desde=2020-02-01T00:00:00Z&hasta=2020-03-01T00:00:00Z')
      .set(como(USUARIOS.adminA, bancoA))
      .expect(200)
      .expect('content-type', /text\/csv/);

    expect(respuesta.text).toContain(inicio);
    expect(respuesta.text).toContain(dentro);
    expect(respuesta.text).not.toContain(antes);
    expect(respuesta.text).not.toContain(fin);
  });
});

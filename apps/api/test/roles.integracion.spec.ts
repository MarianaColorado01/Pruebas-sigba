import type { Server } from 'node:http';
import { Controller, Get, type INestApplication, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { ROLES } from '@sigba/shared-types';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AsignacionesDeUsuario } from '../src/core/autorizacion/asignaciones-de-usuario.js';
import {
  CoreModule,
  executeTransactionWithTenant,
  PrismaService,
  Roles,
  type TenantContext,
} from '../src/core/index.js';
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

if (process.env['CI'] && !URL_ADMIN) {
  throw new Error('DATABASE_URL no está definida en CI. La prueba de roles no es opcional.');
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
const IDS_USUARIOS = Object.values(USUARIOS);

let admin: PrismaClient;
let app: PrismaClient;

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
        SELECT current_setting('app.banco_id', true) AS banco,
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
      await admin.$executeRaw`
        INSERT INTO plataforma.usuario (id, auth0_sub, email, nombre, activo)
        VALUES (${id}::uuid, ${sub(id)}, ${`${nombre}@prueba.sigba`}, ${nombre}, ${nombre !== 'inactivo'})`;
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
      imports: [CoreModule],
      controllers: [PruebaController, RolesEnDosNivelesController],
    })
      // El guard lee usuario_rol con el mismo rol sin privilegios que los
      // controladores. Con DATABASE_URL, que en CI es superusuario, se saltaría
      // RLS y super_admin entraría aunque faltara usuario_rol_propias.
      .overrideProvider(PrismaService)
      .useValue(app)
      .compile();
    nest = modulo.createNestApplication();
    // Hace de guard de JWT mientras SBA-8 no exista. Con x-prueba-contexto
    // imita a un middleware que fija contextoTenant antes que el guard.
    nest.use(
      (
        req: { headers: Record<string, unknown>; identidad?: unknown; contextoTenant?: unknown },
        _res: unknown,
        next: () => void,
      ) => {
        const auth0Sub = req.headers['x-prueba-sub'];
        if (typeof auth0Sub === 'string') req.identidad = { auth0Sub };
        if (req.headers['x-prueba-contexto']) {
          req.contextoTenant = { bancoId: bancoA, rol: 'admin_banco' } satisfies TenantContext;
        }
        next();
      },
    );
    await nest.init();
  });

  afterAll(async () => {
    if (nest) await nest.close();
    if (admin) {
      await limpiar();
      await admin.$disconnect();
    }
    if (app) await app.$disconnect();
  });

  const como = (usuario: string, banco?: string) => {
    const cabeceras: Record<string, string> = { 'x-prueba-sub': sub(usuario) };
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

    it('una etiqueta que no es uuid en app.usuario_id no rompe la lectura', async () => {
      // Así llaman el importador y las pruebas a runWithTenantContext.
      await expect(bancosVisibles({ usuarioId: 'importar-codigos' })).resolves.toEqual([]);

      const bancos = await bancosVisibles({ bancoId: bancoA, usuarioId: 'importar-codigos' });
      expect(new Set(bancos)).toEqual(new Set([bancoA]));
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

      expect(respuesta.body).toEqual({ banco: bancoA, institucion: instX });
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
